// Decals drawn when the model loads, from the material name the Blender build gives each one ("dec:<kind>:<text>",
// tools/blender/decals.py). Text travels in the name, so the model file carries no images.
//
//   plate:<title>|<line>|...         etched stainless data plate: title bar, fields, rivets, border, a barcode
//   warn:<LEVEL>|<line>|...          ANSI-style safety placard; LEVEL is DANGER, WARNING, CAUTION or NOTICE
//   tape:<FUNCTION>                  fluid-line identification tape (MIL-STD-1247 colours and shape symbols)
//   sten:<K|W|Y|R>:<text>            painted stencil lettering on a transparent ground (black, white, yellow, red)
//   wire:<code>                      white heat-shrink wire-marker sleeve, the code printed round it
//   tag:<text>                       small engraved aluminium tag, wired to a line or a plug
//
// Every texture is drawn at a size that suits its decal, and cached by name.
import * as THREE from './vendor/three.module.js';

const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';
const MONO = '"B612 Mono", "DejaVu Sans Mono", Menlo, monospace';
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;   // glTF UV convention
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
/** Fit text to a width, bold or regular, returning the font size used. */
function fit(g, text, maxW, px, weight = 700, family = FONT) {
  g.font = `${weight} ${px}px ${family}`; const w = g.measureText(text).width;
  if (w > maxW) { px = Math.max(6, Math.floor((px * maxW) / w)); g.font = `${weight} ${px}px ${family}`; }
  return px;
}
function grime(g, w, h, k = 1) {   // handling marks, dust in the corners, a few scratches
  for (let i = 0; i < 40 * k; i++) { g.fillStyle = `rgba(60,55,45,${0.02 + rnd() * 0.05})`; const r = 4 + rnd() * 30; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill(); }
  const cg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7); cg.addColorStop(0, 'rgba(40,35,25,0)'); cg.addColorStop(1, `rgba(40,35,25,${0.18 * k})`);
  g.fillStyle = cg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.7;
  for (let i = 0; i < 14 * k; i++) { const x = rnd() * w, y = rnd() * h, a = (rnd() - 0.5) * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 40 * rnd(), y + Math.sin(a) * 40 * rnd()); g.stroke(); }
}

// ------------------------------------------------------------------------------------------- data plate
function plate(spec) {
  const lines = spec.split('|'), title = lines.shift(), W = 512, H = Math.max(200, 92 + lines.length * 34);
  const tex = canvas(W, H, (g) => {
    // brushed stainless
    g.fillStyle = '#b9bcbe'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y++) { const v = 170 + rnd() * 40; g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`; g.fillRect(0, y, W, 1); }
    // border and title bar (etched black)
    g.strokeStyle = '#151515'; g.lineWidth = 3; g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = '#171717'; g.fillRect(14, 14, W - 28, 50);
    g.fillStyle = '#d8dadb'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, title, W - 70, 30); g.fillText(title, W / 2, 40);
    // fields: label in small capitals, value in a monospace stamp
    g.textAlign = 'left';
    lines.forEach((l, i) => {
      const y = 92 + i * 34, [k, v] = l.includes('=') ? l.split('=') : ['', l];
      if (k) { fit(g, k, 150, 15, 600); g.fillStyle = '#2a2a2a'; g.fillText(k, 34, y); fit(g, v, W - 230, 22, 700, MONO); g.fillStyle = '#0d0d0d'; g.fillText(v, 190, y); }
      else { fit(g, v, W - 70, 20, 600); g.fillStyle = '#121212'; g.fillText(v, 34, y); }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(30, y + 16); g.lineTo(W - 30, y + 16); g.stroke();
    });
    // barcode
    let x = W - 150; const by = H - 52;
    while (x < W - 34) { const w2 = 1 + Math.floor(rnd() * 3); g.fillStyle = '#111'; g.fillRect(x, by, w2, 26); x += w2 + 1 + Math.floor(rnd() * 3); }
    // rivets in the corners
    for (const [cx, cy] of [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]) {
      const rg = g.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 7); rg.addColorStop(0, '#f0f0f0'); rg.addColorStop(1, '#5a5c5e'); g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, 6.5, 0, 7); g.fill();
    }
    grime(g, W, H, 0.6);
  });
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// ------------------------------------------------------------------------------------------- safety placard
const LEVELS = { DANGER: ['#c8102e', '#ffffff'], WARNING: ['#ff7900', '#000000'], CAUTION: ['#ffd100', '#000000'], NOTICE: ['#0057b8', '#ffffff'] };
function warn(spec) {
  const lines = spec.split('|'), level = lines.shift().toUpperCase(), [bg, fg] = LEVELS[level] || LEVELS.CAUTION;
  const W = 512, H = 96 + lines.length * 46;
  const tex = canvas(W, H, (g) => {
    g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111'; g.fillRect(0, 0, W, 84);
    g.fillStyle = bg; g.fillRect(6, 6, W - 12, 72);
    // the alert triangle (or an oval for DANGER), then the signal word
    g.fillStyle = fg; g.textBaseline = 'middle';
    if (level === 'DANGER') { g.beginPath(); g.ellipse(W / 2, 42, W * 0.36, 30, 0, 0, 7); g.fillStyle = bg; g.fill(); g.fillStyle = fg; }
    else if (level !== 'NOTICE') {
      g.beginPath(); g.moveTo(54, 18); g.lineTo(84, 68); g.lineTo(24, 68); g.closePath(); g.fillStyle = fg; g.fill();
      g.fillStyle = bg; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.fillText('!', 54, 52); g.fillStyle = fg;
    }
    g.textAlign = 'center'; fit(g, level, W - 200, 52, 900); g.fillText(level, W / 2, 44);
    g.fillStyle = '#111';
    lines.forEach((l, i) => { fit(g, l, W - 40, 34, 700); g.fillText(l, W / 2, 112 + i * 46); });
    grime(g, W, H, 0.8);
  });
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// ------------------------------------------------------------------------------------------- line identification tape
// Colour code on three quarters of the tape, the shape symbol (for colour-blind readers) on the last quarter,
// the function printed across it. u runs round the tube, v across the tape.
const TAPE = {
  FUEL: { c: ['#c8202a'], sym: 'star' }, LUBE: { c: ['#f2c21b'], sym: 'square' }, HYDRAULIC: { c: ['#1f5fae', '#f2c21b', '#1f5fae'], sym: 'circle' },
  PNEUMATIC: { c: ['#e8731a', '#1f5fae'], sym: 'cross' }, 'INST AIR': { c: ['#e8731a', '#8f969c'], sym: 'cross' }, 'FIRE PROT': { c: ['#7a4a26'], sym: 'diamond' },
  'ANTI-ICE': { c: ['#8f969c', '#e8731a'], sym: 'cross' }, 'BREATHER': { c: ['#f2c21b', '#8f969c'], sym: 'square' },
};
function symbol(g, kind, cx, cy, r) {
  g.beginPath();
  if (kind === 'star') { for (let k = 0; k < 8; k++) { const a = (Math.PI / 4) * k - Math.PI / 2, rr = k % 2 ? r * 0.38 : r; g[k ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a)); } g.closePath(); g.fill(); }
  else if (kind === 'square') { g.fillRect(cx - r * 0.75, cy - r * 0.75, r * 1.5, r * 1.5); }
  else if (kind === 'circle') { g.arc(cx, cy, r * 0.8, 0, 7); g.fill(); }
  else if (kind === 'diamond') { g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill(); }
  else { g.lineWidth = r * 0.42; g.moveTo(cx - r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy + r * 0.7); g.moveTo(cx + r * 0.7, cy - r * 0.7); g.lineTo(cx - r * 0.7, cy + r * 0.7); g.stroke(); }
}
function tape(fn) {
  const d = TAPE[fn] || { c: ['#d8d6cf'], sym: 'square' }, W = 512, H = 128;
  const tex = canvas(W, H, (g) => {
    const w3 = W * 0.75;
    d.c.forEach((col, i) => { g.fillStyle = col; g.fillRect((w3 * i) / d.c.length, 0, w3 / d.c.length + 1, H); });
    g.fillStyle = '#f6f4ee'; g.fillRect(w3, 0, W - w3, H);
    g.fillStyle = '#121212'; g.strokeStyle = '#121212'; symbol(g, d.sym, w3 + (W - w3) / 2, H / 2, 34);
    g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, fn, w3 - 30, 64, 800);
    g.fillStyle = d.c[0] === '#c8202a' || d.c[0] === '#1f5fae' || d.c[0] === '#7a4a26' ? '#ffffff' : '#111111'; g.fillText(fn, w3 / 2, H / 2 + 2);
    // flow arrow
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.moveTo(w3 - 16, H - 16); g.lineTo(w3 - 40, H - 28); g.lineTo(w3 - 40, H - 4); g.closePath(); g.fill();
    grime(g, W, H, 0.5);
  });
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0, roughness: 0.45 });
}

// ------------------------------------------------------------------------------------------- stencil
const INK = { K: '#101010', W: '#f4f4f0', Y: '#f2c21b', R: '#c8202a' };
function sten(spec) {
  const [ink, ...rest] = spec.split(':'), text = rest.join(':'), lines = text.split('|');
  const W = 512, H = Math.max(96, 30 + lines.length * 84);
  const tex = canvas(W, H, (g) => {
    g.clearRect(0, 0, W, H); g.fillStyle = INK[ink] || INK.K; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      fit(g, l, W - 24, 78, 900, '"Arial Black", Impact, ' + FONT); g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 84);
    });
    // stencil bridges: thin gaps across each letter, and worn edges
    g.globalCompositeOperation = 'destination-out';
    for (let x = 18; x < W; x += 37) g.fillRect(x, 0, 3, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.7})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.5 + rnd() * 2.5, 0, 7); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  });
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, metalness: 0, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

// ------------------------------------------------------------------------------------------- wire marker, tag
function wire(code) {
  const W = 256, H = 64;
  const tex = canvas(W, H, (g) => {
    g.fillStyle = '#ecebe4'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#141414'; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, code, W / 2 - 12, 34, 700, MONO);
    g.fillText(code, W / 4, H / 2); g.fillText(code, (3 * W) / 4, H / 2);
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6);
  });
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0, roughness: 0.42 });
}
function tag(text) {
  const lines = text.split('|'), W = 256, H = 40 + lines.length * 40;
  const tex = canvas(W, H, (g) => {
    g.fillStyle = '#c4c7ca'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y++) { const v = 180 + rnd() * 40; g.fillStyle = `rgba(${v},${v},${v},0.3)`; g.fillRect(0, y, W, 1); }
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => { fit(g, l, W - 50, 30, 700, MONO); g.fillText(l, W / 2 + 10, 40 + i * 40 - (lines.length - 1) * 4); });
    g.fillStyle = '#6a6c6e'; g.beginPath(); g.arc(20, H / 2, 8, 0, 7); g.fill(); g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(20, H / 2, 4, 0, 7); g.fill();   // lock-wire hole
    grime(g, W, H, 0.5);
  });
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** Material for a "dec:" material name (without the prefix). */
export function decalMaterial(spec) {
  seed = 7 + [...spec].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 0);   // the same grime every load
  const i = spec.indexOf(':'), kind = spec.slice(0, i), rest = spec.slice(i + 1);
  const m = kind === 'plate' ? plate(rest) : kind === 'warn' ? warn(rest) : kind === 'tape' ? tape(rest) : kind === 'sten' ? sten(rest) : kind === 'wire' ? wire(rest) : kind === 'tag' ? tag(rest) : warn('NOTICE|' + rest);
  m.name = 'dec:' + spec; m.userData.decal = true;
  return m;
}
