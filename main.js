// Covalent Builder core

const ELEMENTS = [
  { symbol: 'H', name: 'Hydrogen', Z: 1, valence: 1, color: '#38bdf8' },
  { symbol: 'C', name: 'Carbon', Z: 6, valence: 4, color: '#f97316' },
  { symbol: 'N', name: 'Nitrogen', Z: 7, valence: 3, color: '#22c55e' },
  { symbol: 'O', name: 'Oxygen', Z: 8, valence: 6, color: '#a855f7' },
];

const canvas = document.createElement('canvas');
const toolbar = document.createElement('div');
const mainPanel = document.createElement('div');

let ctx;
let atoms = [];
let bonds = [];
let draggingAtomId = null;
let dragOffset = { x: 0, y: 0 };
let showForces = false;
let nextId = 1;
let needsBondReorientation = false;
let activePointerId = null;

// Controls how strongly electrons "turn" toward nearby atoms when
// an atom is being dragged.
const ELECTRON_ORIENT_SPEED = 0.08;
const ELECTRON_ORIENT_RANGE = 80; // px around valence shell

function createLayout() {
  const app = document.getElementById('app');

  const header = document.createElement('header');
  const titleBlock = document.createElement('div');
  titleBlock.className = 'title-block';

  const h1 = document.createElement('h1');
  h1.textContent = 'Covalent Builder';
  const pill = document.createElement('div');
  pill.className = 'title-pill';
  const pillDot = document.createElement('div');
  pillDot.className = 'title-pill-dot';
  const pillText = document.createElement('span');
  pillText.textContent = 'Drag non‑metals to build molecules';
  pill.appendChild(pillDot);
  pill.appendChild(pillText);
  titleBlock.appendChild(h1);
  titleBlock.appendChild(pill);

  const controlsRow = document.createElement('div');
  controlsRow.className = 'controls-row';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'primary';
  resetBtn.innerHTML = '<span class="icon-dot"></span><span>Clear canvas</span>';
  resetBtn.addEventListener('click', () => {
    atoms = [];
    bonds = [];
  });

  const forcesBtn = document.createElement('button');
  forcesBtn.className = 'toggle';
  forcesBtn.dataset.active = 'false';
  const toggleDot = document.createElement('span');
  toggleDot.className = 'toggle-dot';
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'Show forces';
  forcesBtn.appendChild(toggleDot);
  forcesBtn.appendChild(toggleLabel);
  forcesBtn.addEventListener('click', () => {
    showForces = !showForces;
    forcesBtn.dataset.active = showForces ? 'true' : 'false';
  });

  controlsRow.appendChild(forcesBtn);
  controlsRow.appendChild(resetBtn);

  header.appendChild(titleBlock);
  header.appendChild(controlsRow);

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';

  const sidebarTitle = document.createElement('h2');
  sidebarTitle.textContent = 'Non‑metal elements';
  sidebar.appendChild(sidebarTitle);

  const palette = document.createElement('div');
  palette.className = 'element-palette';
  ELEMENTS.forEach((el) => {
    const card = document.createElement('div');
    card.className = 'element-card';
    card.draggable = true;

    const symbol = document.createElement('div');
    symbol.className = 'element-symbol';
    symbol.textContent = el.symbol;

    const meta = document.createElement('div');
    meta.className = 'element-meta';

    const name = document.createElement('div');
    name.className = 'element-name';
    name.textContent = el.name;

    const valence = document.createElement('div');
    valence.className = 'element-valence-label';
    valence.textContent = `Valence electrons: ${el.valence}`;

    meta.appendChild(name);
    meta.appendChild(valence);

    card.appendChild(symbol);
    card.appendChild(meta);

    // Desktop drag and drop
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify(el));
    });

    // NOTE: On mobile browsers, native HTML5 drag-and-drop from
    // non-editable elements is often limited. If taps on the
    // palette are creating extra atoms, remove the tap-to-spawn
    // behavior and rely on direct canvas dragging only.

    palette.appendChild(card);
  });

  sidebar.appendChild(palette);

  const sidebarInfo = document.createElement('div');
  sidebarInfo.className = 'sidebar-section';
  sidebarInfo.innerHTML = '<strong>How to use</strong><br/>Drag an element into the field, duplicate as needed, then bring valence shells close to form glowing shared pairs. Toggle forces to see electrostatic attractions.';
  sidebar.appendChild(sidebarInfo);

  mainPanel.className = 'main-panel';

  toolbar.className = 'main-toolbar';
  const tbLabel = document.createElement('span');
  tbLabel.textContent = 'Play area: drag atoms, overlap shells to bond';
  toolbar.appendChild(tbLabel);

  canvas.id = 'builder-canvas';

  mainPanel.appendChild(toolbar);
  mainPanel.appendChild(canvas);

  app.appendChild(header);
  app.appendChild(sidebar);
  app.appendChild(mainPanel);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx = canvas.getContext('2d');
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function spawnAtomFromElement(el, x, y) {
  const id = nextId++;
  const radiusCore = 10;
  const radiusValence = 32;
  const electrons = [];
  const angleStep = (Math.PI * 2) / el.valence;
  for (let i = 0; i < el.valence; i++) {
    electrons.push({
      id: `${id}-e${i}`,
      baseAngle: i * angleStep,
      angleOffset: 0,
      bondedTo: null,
    });
  }
  atoms.push({
    id,
    element: el,
    x,
    y,
    radiusCore,
    radiusValence,
    electrons,
  });
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateBonds() {
  bonds = [];
  const maxPairDistance = 30;

  // Track which electrons are already engaged in bonds so we can
  // respect valence limits (e.g., carbon can use all 4 electrons).
  const usedElectronIds = new Set();

  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i];
      const b = atoms[j];
      const baseAngleA = Math.atan2(b.y - a.y, b.x - a.x);
      const baseAngleB = Math.atan2(a.y - b.y, a.x - b.x);

      // Determine desired number of bond pairs between this atom pair.
      const isCOPair =
        (a.element.symbol === 'C' && b.element.symbol === 'O') ||
        (a.element.symbol === 'O' && b.element.symbol === 'C');
      const isOOPair = a.element.symbol === 'O' && b.element.symbol === 'O';
      const isCHPair =
        (a.element.symbol === 'C' && b.element.symbol === 'H') ||
        (a.element.symbol === 'H' && b.element.symbol === 'C');

      // Default desired bond pairs between two atoms. C–O and O–O
      // can form double bonds; C–H stays as a single bond but we
      // will happily form up to four separate C–H bonds overall as
      // long as carbon still has spare electrons.
      const desiredPairs = isCOPair || isOOPair ? 2 : 1;

      // Attempt to create up to desiredPairs separate electron pairs
      // for this atom pair, respecting available valence electrons.
      for (let pairIndex = 0; pairIndex < desiredPairs; pairIndex++) {
        let availableA = a.electrons.filter((e) => !usedElectronIds.has(e.id));
        let availableB = b.electrons.filter((e) => !usedElectronIds.has(e.id));
        if (availableA.length === 0 || availableB.length === 0) break;

        // For C–O and O–O, we want robust double bonds: always pick
        // the electrons that are best aligned with the internuclear
        // axis and explicitly steer the second pair into place.
        // Special case: when bonding carbon with hydrogen we want
        // hydrogens to grab any remaining carbon electrons, so we
        // favour choosing the electron on carbon that is closest to
        // the approaching hydrogen, and the hydrogen electron
        // nearest to carbon.
        const sortedA = availableA
          .map((e) => ({ e, score: Math.abs(normalizeAngle(e.baseAngle - baseAngleA)) }))
          .sort((p, q) => p.score - q.score);
        const sortedB = availableB
          .map((e) => ({ e, score: Math.abs(normalizeAngle(e.baseAngle - baseAngleB)) }))
          .sort((p, q) => p.score - q.score);

        const eA = sortedA[0].e;
        const eB = sortedB[0].e;

        const posA = electronPosition(a, eA);
        const posB = electronPosition(b, eB);
        const withinRange = distance(posA, posB) <= maxPairDistance;

        if (!withinRange && pairIndex === 0) {
          // If even the first candidate pair is too far, no bond.
          break;
        }

        // For first pair in a double bond, enforce distance; for
        // the second pair on C–O / O–O, allow creation as long as
        // atoms are generally close enough.
        if (withinRange || (pairIndex === 1 && (isCOPair || isOOPair))) {
          bonds.push({
            id: `${a.id}-${b.id}-${eA.id}-${eB.id}`,
            aId: a.id,
            bId: b.id,
            eAId: eA.id,
            eBId: eB.id,
          });
          usedElectronIds.add(eA.id);
          usedElectronIds.add(eB.id);
        } else {
          break;
        }
      }
    }
  }
}

function reorientBondElectrons() {
  if (bonds.length === 0) return;

  // Group bonds by atom pair so we can treat double bonds specially.
  const groupedByPair = new Map();
  bonds.forEach((b) => {
    const key = b.aId < b.bId ? `${b.aId}-${b.bId}` : `${b.bId}-${b.aId}`;
    if (!groupedByPair.has(key)) groupedByPair.set(key, []);
    groupedByPair.get(key).push(b);
  });

  groupedByPair.forEach((pairBonds) => {
    const b0 = pairBonds[0];
    const a = atoms.find((x) => x.id === b0.aId);
    const c = atoms.find((x) => x.id === b0.bId);
    if (!a || !c) return;

    const angleAC = Math.atan2(c.y - a.y, c.x - a.x);
    const angleCA = Math.atan2(a.y - c.y, a.x - c.x);

    const isCOorOO =
      (a.element.symbol === 'C' && c.element.symbol === 'O') ||
      (a.element.symbol === 'O' && c.element.symbol === 'C') ||
      (a.element.symbol === 'O' && c.element.symbol === 'O');

    // For C=O and O=O we want exactly two shared
    // electron pairs in the double-bond region. If more
    // than two bonds have been created numerically for
    // this pair (e.g. due to geometry/distance quirks),
    // we still only treat the closest two as the visual
    // double bond and push any others back toward the
    // lone‑pair side so they don't "sit" in between.
    if (isCOorOO && pairBonds.length >= 2) {
      // Arrange two electron pairs symmetrically around bond axis
      // to give a clear double-bond look.
      const offset = 0.25; // radians
      const anglesA = [angleAC - offset, angleAC + offset];
      const anglesC = [angleCA + offset, angleCA - offset];

      // Sort bonds for this pair by how close their current
      // electron positions already are to the ideal double‑bond
      // directions, then pick the best two as the double bond.
      const scored = pairBonds.map((b) => {
        const eA = a.electrons.find((e) => e.id === b.eAId);
        const eC = c.electrons.find((e) => e.id === b.eBId);
        if (!eA || !eC) {
          return { b, score: Number.POSITIVE_INFINITY };
        }
        const angA = normalizeAngle(eA.baseAngle + eA.angleOffset);
        const angC = normalizeAngle(eC.baseAngle + eC.angleOffset);
        const targetA = angleAC;
        const targetC = angleCA;
        const score =
          Math.abs(normalizeAngle(angA - targetA)) +
          Math.abs(normalizeAngle(angC - targetC));
        return { b, score };
      });

      scored.sort((p, q) => p.score - q.score);
      const firstTwo = scored.slice(0, 2).map((s) => s.b);

      firstTwo.forEach((b, idx) => {
        const eA = a.electrons.find((e) => e.id === b.eAId);
        const eC = c.electrons.find((e) => e.id === b.eBId);
        if (!eA || !eC) return;

        eA.angleOffset = normalizeAngle(anglesA[idx] - eA.baseAngle);
        eC.angleOffset = normalizeAngle(anglesC[idx] - eC.baseAngle);
      });

      if (pairBonds.length > 2) {
        pairBonds
          .filter((b) => !firstTwo.includes(b))
          .forEach((b) => {
          const eA = a.electrons.find((e) => e.id === b.eAId);
          const eC = c.electrons.find((e) => e.id === b.eBId);
          if (!eA || !eC) return;

          // Push extra bonds slightly away from the central
          // double‑bond region so they visually rejoin the
          // lone‑pair area instead of appearing as a third
          // shared electron.
          const extraOffset = 0.9;
          eA.angleOffset = normalizeAngle(angleAC + extraOffset - eA.baseAngle);
          eC.angleOffset = normalizeAngle(angleCA - extraOffset - eC.baseAngle);
        });
      }
    } else {
      // Single bond: align electrons exactly on bond axis.
      pairBonds.forEach((b) => {
        const eA = a.electrons.find((e) => e.id === b.eAId);
        const eC = c.electrons.find((e) => e.id === b.eBId);
        if (!eA || !eC) return;

        eA.angleOffset = normalizeAngle(angleAC - eA.baseAngle);
        eC.angleOffset = normalizeAngle(angleCA - eC.baseAngle);
      });
    }
  });

  // After aligning bonding electrons, redistribute all other electrons
  // on each involved atom so that they are evenly spaced (max arc).
  const involvedAtomIds = new Set();
  bonds.forEach((b) => {
    involvedAtomIds.add(b.aId);
    involvedAtomIds.add(b.bId);
  });

  involvedAtomIds.forEach((atomId) => {
    const atom = atoms.find((a) => a.id === atomId);
    if (!atom) return;

    const bondedElectronIds = new Set();
    bonds.forEach((b) => {
      if (b.aId === atomId) bondedElectronIds.add(b.eAId);
      if (b.bId === atomId) bondedElectronIds.add(b.eBId);
    });

    const bondedElectrons = atom.electrons.filter((e) => bondedElectronIds.has(e.id));
  const loneElectrons = atom.electrons.filter((e) => !bondedElectronIds.has(e.id));

  if (loneElectrons.length === 0) return;

    // Compute the current angle of each bonded electron and find the largest gap
    const bondedAngles = bondedElectrons.map((e) => {
      return normalizeAngle(e.baseAngle + e.angleOffset);
    });

    bondedAngles.sort((a, b) => a - b);

    let startAngle;
    if (bondedAngles.length === 0) {
      startAngle = 0;
    } else if (bondedAngles.length === 1) {
      // Place lone electrons on the opposite side of the bond
      startAngle = normalizeAngle(bondedAngles[0] + Math.PI);
    } else {
      // Find largest gap between consecutive bonded electrons on the circle
      let maxGap = -Infinity;
      let bestStart = bondedAngles[0];
      for (let i = 0; i < bondedAngles.length; i++) {
        const a1 = bondedAngles[i];
        const a2 = bondedAngles[(i + 1) % bondedAngles.length];
        let gap = a2 - a1;
        if (i === bondedAngles.length - 1) {
          gap = (bondedAngles[0] + Math.PI * 2) - a1;
        }
        if (gap > maxGap) {
          maxGap = gap;
          bestStart = a1;
        }
      }
      // Start in the middle of the largest gap
      startAngle = normalizeAngle(bestStart + maxGap / 2);
    }

    const loneStep = (Math.PI * 2) / loneElectrons.length;

    // If there is an odd lone electron (e.g. after a single O–O
    // bond where one of oxygen's electrons is still unpaired), try
    // to "pair it up" by putting it directly opposite the bonded
    // region, then distribute the rest around that axis.
    if (loneElectrons.length % 2 === 1 && bondedElectrons.length > 0) {
      const axis = startAngle;
      // Put one electron on the axis and distribute remaining ones
      // symmetrically around it.
      loneElectrons.forEach((e, index) => {
        const offsetIndex = index - (loneElectrons.length - 1) / 2;
        const targetAngle = normalizeAngle(axis + offsetIndex * loneStep);
        e.angleOffset = normalizeAngle(targetAngle - e.baseAngle);
      });
    } else {
      loneElectrons.forEach((e, index) => {
        const targetAngle = normalizeAngle(startAngle + index * loneStep);
        e.angleOffset = normalizeAngle(targetAngle - e.baseAngle);
      });
    }
  });

  needsBondReorientation = false;
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function electronPosition(atom, e) {
  const angle = e.baseAngle + e.angleOffset;
  const ex = atom.x + Math.cos(angle) * atom.radiusValence;
  const ey = atom.y + Math.sin(angle) * atom.radiusValence;
  return { x: ex, y: ey };
}

function orientElectronsTowardNeighbors() {
  if (!draggingAtomId) return;
  const dragged = atoms.find((a) => a.id === draggingAtomId);
  if (!dragged) return;

  atoms.forEach((other) => {
    if (other.id === dragged.id) return;
    const d = distance(dragged, other);
    if (d > ELECTRON_ORIENT_RANGE) return;

    const axisAngle = Math.atan2(other.y - dragged.y, other.x - dragged.x);
    const draggedIsOxygen = dragged.element.symbol === 'O';
    const otherIsCO = other.element.symbol === 'C' || other.element.symbol === 'O';

    if (draggedIsOxygen && otherIsCO) {
      // Oxygen near C or O: tilt TWO electrons toward the neighbor
      // with a slight angular separation to hint at a double bond.
      const sorted = dragged.electrons
        .map((e) => {
          const current = normalizeAngle(e.baseAngle + e.angleOffset);
          const score = Math.abs(normalizeAngle(axisAngle - current));
          return { e, current, score };
        })
        .sort((p, q) => p.score - q.score);

      const first = sorted[0];
      const second = sorted[1] || null;

      if (first) {
        let delta1 = normalizeAngle(axisAngle - first.current);
        delta1 *= ELECTRON_ORIENT_SPEED;
        first.e.angleOffset = normalizeAngle(first.e.angleOffset + delta1);
      }

      if (second) {
        // Offset the second electron slightly around the axis to
        // create an alternating/double-bond look.
        const offsetAxis = axisAngle + (second.score >= 0 ? 0.3 : -0.3);
        let delta2 = normalizeAngle(offsetAxis - second.current);
        delta2 *= ELECTRON_ORIENT_SPEED;
        second.e.angleOffset = normalizeAngle(second.e.angleOffset + delta2);
      }
    } else {
      // Default: only the single closest electron rotates toward
      // the neighbor, keeping the rest stable.
      let bestElectron = null;
      let bestScore = Infinity;
      dragged.electrons.forEach((e) => {
        const current = normalizeAngle(e.baseAngle + e.angleOffset);
        const score = Math.abs(normalizeAngle(axisAngle - current));
        if (score < bestScore) {
          bestScore = score;
          bestElectron = e;
        }
      });

      if (bestElectron) {
        const current = normalizeAngle(bestElectron.baseAngle + bestElectron.angleOffset);
        let delta = normalizeAngle(axisAngle - current);
        delta *= ELECTRON_ORIENT_SPEED;
        bestElectron.angleOffset = normalizeAngle(bestElectron.angleOffset + delta);
      }
    }
  });
}

function render() {
  if (!ctx) return;
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;

  ctx.clearRect(0, 0, w, h);

  const gradientBg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h));
  gradientBg.addColorStop(0, 'rgba(15,23,42,0.2)');
  gradientBg.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = gradientBg;
  ctx.fillRect(0, 0, w, h);

  // While dragging an atom, gently rotate its electrons so they
  // orient toward nearby atoms/electrons to give a sense of
  // dynamic electron-cloud interaction before the bond snaps.
  orientElectronsTowardNeighbors();

  // Reorient electrons on newly formed or adjusted bonds so that
  // nucleus – covalent pair – nucleus lies along a straight line.
  reorientBondElectrons();

  updateBonds();

  bonds.forEach((b) => {
    const a = atoms.find((x) => x.id === b.aId);
    const c = atoms.find((x) => x.id === b.bId);
    if (!a || !c) return;
    const eA = a.electrons.find((e) => e.id === b.eAId);
    const eB = c.electrons.find((e) => e.id === b.eBId);
    if (!eA || !eB) return;

    const pA = electronPosition(a, eA);
    const pB = electronPosition(c, eB);
    const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };

    const g = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, 26);
    g.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
    g.addColorStop(0.5, 'rgba(251, 191, 36, 0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(pA.x, pA.y, 4, 0, Math.PI * 2);
    ctx.arc(pB.x, pB.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (showForces) {
      drawForceArrow(a.x, a.y, mid.x, mid.y);
      drawForceArrow(c.x, c.y, mid.x, mid.y);
    }
  });

  atoms.forEach((atom) => {
    const shellGrad = ctx.createRadialGradient(atom.x, atom.y, atom.radiusCore, atom.x, atom.y, atom.radiusValence + 10);
    shellGrad.addColorStop(0, 'rgba(15,23,42,0)');
    shellGrad.addColorStop(0.5, 'rgba(56,189,248,0.26)');
    shellGrad.addColorStop(1, 'rgba(15,23,42,0)');
    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.arc(atom.x, atom.y, atom.radiusValence + 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(atom.x, atom.y, atom.radiusValence, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const coreGrad = ctx.createRadialGradient(atom.x, atom.y, 0, atom.x, atom.y, atom.radiusCore + 3);
    coreGrad.addColorStop(0, '#f9fafb');
    coreGrad.addColorStop(1, atom.element.color);
    ctx.fillStyle = coreGrad;

    ctx.shadowColor = atom.element.color;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(atom.x, atom.y, atom.radiusCore, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#020617';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(atom.element.symbol, atom.x, atom.y);

    atom.electrons.forEach((e) => {
      const pos = electronPosition(atom, e);
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  requestAnimationFrame(render);
}

function drawForceArrow(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const startX = fromX + ux * 16;
  const startY = fromY + uy * 16;
  const endX = toX - ux * 12;
  const endY = toY - uy * 12;

  ctx.strokeStyle = 'rgba(129, 140, 248, 0.95)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  const headLen = 7;
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 7), endY - headLen * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 7), endY - headLen * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = 'rgba(129, 140, 248, 0.95)';
  ctx.fill();
}

function pickAtom(x, y) {
  for (let i = atoms.length - 1; i >= 0; i--) {
    const atom = atoms[i];
    const d = distance({ x, y }, { x: atom.x, y: atom.y });
    if (d <= atom.radiusValence) return atom;
  }
  return null;
}

function setupCanvasInteractions() {
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const atom = pickAtom(x, y);
    if (atom) {
      draggingAtomId = atom.id;
      dragOffset.x = x - atom.x;
      dragOffset.y = y - atom.y;
      activePointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!draggingAtomId || e.pointerId !== activePointerId) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const atom = atoms.find((a) => a.id === draggingAtomId);
    if (atom) {
      atom.x = x - dragOffset.x;
      atom.y = y - dragOffset.y;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId === activePointerId && draggingAtomId != null) {
      draggingAtomId = null;
      activePointerId = null;
      needsBondReorientation = true;
      canvas.releasePointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerId === activePointerId) {
      draggingAtomId = null;
      activePointerId = null;
      needsBondReorientation = true;
      canvas.releasePointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    let el;
    try {
      el = JSON.parse(data);
    } catch (err) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    spawnAtomFromElement(el, x, y);
  });
}

function init() {
  createLayout();
  resizeCanvas();
  setupCanvasInteractions();
  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(render);
}

window.addEventListener('DOMContentLoaded', init);
