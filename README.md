# Covalent Builder

An interactive browser-based simulation that lets you drag non‑metal atoms onto a field, see their valence shells, and visualize covalent bonds with glowing shared electron pairs and optional force arrows.

## Run locally

Use any static file server from this folder. For example, with Python installed:

```bash
cd "CovalentBonding"
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Usage

- Drag elements from the left palette into the play area.
- Drag atoms around; when valence shells overlap appropriately, glowing shared electron pairs appear.
- Toggle **Show forces** to display stylized electrostatic force arrows from each nucleus toward the shared pair.
- Use **Clear canvas** to reset.
