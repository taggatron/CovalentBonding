// Covalent Builder core

const ELEMENTS = [
  { symbol: 'H', name: 'Hydrogen', Z: 1, valence: 1, color: '#38bdf8' },
  { symbol: 'C', name: 'Carbon', Z: 6, valence: 4, color: '#f97316' },
  { symbol: 'N', name: 'Nitrogen', Z: 7, valence: 3, color: '#22c55e' },
  { symbol: 'O', name: 'Oxygen', Z: 8, valence: 2, color: '#a855f7' },
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

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify(el));
    });

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
  const maxPairDistance = 24;
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i];
      const b = atoms[j];
      const baseAngleA = Math.atan2(b.y - a.y, b.x - a.x);
      const baseAngleB = Math.atan2(a.y - b.y, a.x - b.x);

      const candidatesA = a.electrons.map((e) => ({ atom: a, e })).sort(
        (p, q) => Math.abs(normalizeAngle(p.e.baseAngle - baseAngleA)) - Math.abs(normalizeAngle(q.e.baseAngle - baseAngleA))
      );
      const candidatesB = b.electrons.map((e) => ({ atom: b, e })).sort(
        (p, q) => Math.abs(normalizeAngle(p.e.baseAngle - baseAngleB)) - Math.abs(normalizeAngle(q.e.baseAngle - baseAngleB))
      );

      const eA = candidatesA[0].e;
      const eB = candidatesB[0].e;

      const posA = electronPosition(a, eA);
      const posB = electronPosition(b, eB);
      if (distance(posA, posB) <= maxPairDistance) {
        bonds.push({
          id: `${a.id}-${b.id}`,
          aId: a.id,
          bId: b.id,
          eAId: eA.id,
          eBId: eB.id,
        });
      }
    }
  }
}

function reorientBondElectrons() {
  if (!needsBondReorientation || bonds.length === 0) return;

  bonds.forEach((b) => {
    const a = atoms.find((x) => x.id === b.aId);
    const c = atoms.find((x) => x.id === b.bId);
    if (!a || !c) return;

    const eA = a.electrons.find((e) => e.id === b.eAId);
    const eB = c.electrons.find((e) => e.id === b.eBId);
    if (!eA || !eB) return;

    const angleAC = Math.atan2(c.y - a.y, c.x - a.x);
    const angleCA = Math.atan2(a.y - c.y, a.x - c.x);

    eA.angleOffset = normalizeAngle(angleAC - eA.baseAngle);
    eB.angleOffset = normalizeAngle(angleCA - eB.baseAngle);
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
