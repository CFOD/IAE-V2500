// 3D view of the engine. Pure view: reads the simulation output, never writes to it.
//
// The model is generated from the same section profiles as the 2D view. An
// externally authored glTF model can replace any of the generated components:
// see loadExternalModel() and docs/MODEL.md.
import * as THREE from './vendor/three.module.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from './vendor/jsm/postprocessing/SMAAPass.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';
import { P, ROWS, rAt, tempRGB, lipLoop, scarfX, scarfDroop } from './cutaway.js';
import { Billows, Streaks, Shards, Sparks, Particles, FX, noiseTexture, DepthCapturePass, SoftFxPass } from './fx.js';
import { setSurfaceQuality, finish, FINISH } from './surfaces.js';
import { ApronView } from './apron3d.js';
import { applyDamage } from './damage3d.js';
import { Borescope, BorescopeShader } from './borescope.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const FLOOR_Y = -1.87;   // ground: the nacelle's low point 0.76 m above it, as on an A320 (src/sim/ground.js)
// Cutaway wedge: the sector of casing that is removed, in the angle convention
// used for instances (y = r cos th, z = r sin th). Camera side, upper quarter.
const CUT_A = -8 * DEG, CUT_B = 112 * DEG;
// Deep cut: the lower, camera-facing part of the wedge, where the rotors are sectioned too so the
// discs, shafts and bearings can be seen. Its lower face is shared with the casing cut.
const DEEP_A = 60 * DEG;
const inDeep = (th) => { const t = ((th % TAU) + TAU) % TAU; return t > DEEP_A && t < CUT_B; };
// Cowls that open for maintenance (Airbus TTM, ATA 71): the fan cowl doors hinge on the pylon either
// side and stand open on hold-open struts; each thrust reverser C-duct (outer cowl, inner barrel and
// bifurcation walls together) hinges on the pylon and opens to 45 deg on two hold-open rods.
const HINGES = {
  fan: { L: { th: 9 * DEG, r: 1.0 }, R: { th: -9 * DEG, r: 1.0 }, open: 50 * DEG },     // fan cowls open 50 deg, reverser halves 45 (Airbus AC fig. 2-12-0-991-033/034)
  cd: { L: { th: 7 * DEG, r: 0.985 }, R: { th: -7 * DEG, r: 0.985 }, open: 45 * DEG },
};
const _spinQ = new THREE.Quaternion(), _X = new THREE.Vector3(1, 0, 0);
const inCut = (th) => { const t = ((th % TAU) + TAU) % TAU; return t > TAU + CUT_A || t < CUT_B; };

// Materials of the authored internals (tools/blender/internals.py names them i_*). Where a part has a material of
// its own for that role (blades of a rotor part, its casing...), the part's material is used, so heat tint, glow
// and highlight follow it; otherwise each part gets its own copy of these.
const INT_MATS = {
  i_tifan: { color: 0xaab1b8, metalness: 1, roughness: 0.26, f: 'titanium' }, i_ti: { color: 0xa3abb3, metalness: 1, roughness: 0.3, f: 'compressorBlade' },
  i_nickel: { color: 0x9b9c99, metalness: 1, roughness: 0.34, f: 'compressorBlade' }, i_disc: { color: 0x8a9096, metalness: 1, roughness: 0.36, f: 'bareSteel' },
  i_case: { color: 0x7c8186, metalness: 0.8, roughness: 0.45, f: 'castPaint' }, i_filler: { color: 0x8d959c, metalness: 0.4, roughness: 0.45, f: 'castPaint' },
  i_rubber: { color: 0x111214, metalness: 0, roughness: 0.75, f: 'rubber' }, i_vsv: { color: 0x6f7c88, metalness: 0.9, roughness: 0.3, f: 'titanium' },
  i_steel: { color: 0xa0a5aa, metalness: 1, roughness: 0.3, f: 'stainlessTube' }, i_liner: { color: 0xa39a90, metalness: 0.9, roughness: 0.5, f: 'hotCase' },
  i_ceramic: { color: 0xe9e8e2, metalness: 0, roughness: 0.35, f: 'polished' }, i_hptb: { color: 0x8f8a82, metalness: 1, roughness: 0.4, f: 'turbineBlade' },
  i_tbc: { color: 0xd5ccb4, metalness: 0, roughness: 0.62, f: 'hotCase' }, i_honey: { color: 0xaeaea8, metalness: 0.85, roughness: 0.55, f: 'castBare' },
  i_hot: { color: 0x8a7f72, metalness: 0.9, roughness: 0.45, f: 'hotCase' }, i_lptb: { color: 0x9a8a68, metalness: 1, roughness: 0.4, f: 'turbineBlade' },
  i_tec: { color: 0x9c8263, metalness: 0.9, roughness: 0.45, f: 'hotCase' }, i_shaft: { color: 0x7a8188, metalness: 1, roughness: 0.28, f: 'bareSteel' },
  i_race: { color: 0xc4c9cd, metalness: 1, roughness: 0.18, f: 'bareSteel', bottom: 0, grime: 0.05 }, i_bronze: { color: 0xb58a4c, metalness: 1, roughness: 0.35, f: 'cadmium' },
  i_carbon: { color: 0x1a1a1c, metalness: 0, roughness: 0.5, f: 'darkBox' }, i_gear: { color: 0x74787d, metalness: 1, roughness: 0.27, f: 'gearSteel' }, i_hole: { color: 0x0e0b09, metalness: 0, roughness: 0.9, f: 'darkBox' },
};
const INT_PART_MAT = { fan: ['i_tifan'], lpc: ['i_ti'], hpc: ['i_ti'], hpt: ['i_hptb'], lpt: ['i_lptb'], liner: ['i_liner'], tec: ['i_tec'], lpshaft: ['i_shaft'], hpshaft: ['i_shaft'],
  lpccase: ['i_case'], hpccase: ['i_case'], combcase: ['i_case'], hptcase: ['i_hot'], lptcase: ['i_hot'] };
const INT_HEAT = { hpt: [2.0, 2.45, 0.8], lpt: [2.3, 3.05, 0.7], hptcase: [2.0, 2.5, 0.9], lptcase: [2.3, 3.1, 0.9], combcase: [1.75, 2.6, 0.5], liner: [1.9, 2.25, 0.9], tec: [2.7, 3.5, 1.0], fuel: [1.85, 2.3, 0.35], ign: [1.9, 2.3, 0.35] };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(...repeat); t.anisotropy = 8; return t;
}
const softSprite = () => { const t = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }); t.colorSpace = THREE.SRGBColorSpace; return t; };
// perforated acoustic liner
const linerTex = () => canvasTex(64, 64, (g) => { g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#1c1c1c'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 3.2, 0, 7); g.fill(); } }, [150, 18]);
// fine circumferential machining marks
// braided harness sleeve: diagonal over-under weave (u round the loom, v along it)
const braidTex = () => { const t = canvasTex(64, 64, (g, W, H) => { g.fillStyle = '#cfccc4'; g.fillRect(0, 0, W, H);
  for (let i = -8; i < 16; i++) for (const sgn of [1, -1]) { g.strokeStyle = sgn > 0 ? 'rgba(255,255,250,0.9)' : 'rgba(150,146,138,0.85)'; g.lineWidth = 3; g.beginPath(); g.moveTo(i * 8, 0); g.lineTo(i * 8 + sgn * 64, 64); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) g.fillRect(x, y, 4, 4); }, [3, 1]); t.colorSpace = THREE.SRGBColorSpace; return t; };
const brushedTex = () => canvasTex(8, 256, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 110 + Math.random() * 80; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, w, 1); } }, [1, 6]);

// Shared GLSL: value noise and fractal noise. All inputs are finite and all pow / smoothstep
// arguments are kept inside their defined ranges (see the note above HeatHaze).
const NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y); }
  float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.3); a*=0.5; } return s; }
`;
// soft, lumpy puff for mist, smoke and fireballs (not a plain disc)
const puffSprite = () => { const t = canvasTex(128, 128, (g) => { g.clearRect(0, 0, 128, 128); let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 26; i++) { const x = 64 + (r() - 0.5) * 56, y = 64 + (r() - 0.5) * 56, rad = 16 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const m = g.createRadialGradient(64, 64, 30, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = m; g.fillRect(0, 0, 128, 128); }); t.colorSpace = THREE.SRGBColorSpace; return t; };

// Blade surface (u = round the section from the leading edge, v = root to tip): spanwise polishing
// marks, a brighter worn leading edge and tip, dirt collecting towards the root.
const bladeTex = (fan) => { let s = 5; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const t = canvasTex(256, 512, (g, W, H) => {
    g.fillStyle = fan ? '#d9dcdf' : '#d2d2d2'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) { const v = r() > 0.5 ? 255 : 90; g.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.05})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 40 + r() * 260); }
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(70,66,60,${0.03 + r() * 0.05})`; const x = r() * W, y = H - r() * r() * H * 0.5; g.fillRect(x, y, 3 + r() * 10, 6 + r() * 40); } // v = 0 is the bottom row
    const root = g.createLinearGradient(0, H, 0, H * 0.72); root.addColorStop(0, 'rgba(60,58,54,0.5)'); root.addColorStop(1, 'rgba(60,58,54,0)'); g.fillStyle = root; g.fillRect(0, H * 0.72, W, H * 0.28);
    for (const [x0, x1] of [[0, 0.045], [0.955, 1]]) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x0 * W, 0, (x1 - x0) * W, H); } // leading edge, both surfaces
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(0, 0, W, H * (fan ? 0.012 : 0.03)); // tip rub
    if (fan) { g.fillStyle = 'rgba(40,40,44,0.35)'; g.fillRect(0, H * 0.93, W, 2); } // platform line
  }); t.colorSpace = THREE.SRGBColorSpace; return t; };
// Sand-cast / forged casing: fine pitting for the bump map
const castTex = () => { let s = 23; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) { const v = 96 + r() * 64; g.fillStyle = `rgb(${v},${v},${v})`; const d = 1 + r() * 2.5; g.fillRect(r() * W, r() * H, d, d); } }, [26, 5]); };

// ---- procedural surface textures (u = round the engine, v = along it)
/** Painted cowl: rivet rows along panel edges and frames, faint dirt and oil streaks. Returns colour + bump maps. */
function paintTextures() {
  const W = 2048, H = 512; let s = 11; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rows = [0.035, 0.965, 0.33, 0.66], cols = Array.from({ length: 12 }, (_, i) => (i + 0.5) / 12);
  const col = canvasTex(W, H, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(110,115,120,${0.012 + r() * 0.02})`; const x = r() * W, y = r() * H; g.fillRect(x, y, 30 + r() * 160, 2 + r() * 6); }   // faint mottling
    // grime and fluid streaks collect along the bottom (u = 0.5) and run aft
    for (let i = 0; i < 90; i++) { const u = 0.5 + (r() - 0.5) * 0.22, v0 = r() * 0.7, len = 0.1 + r() * 0.3; const gr = g.createLinearGradient(0, v0 * H, 0, (v0 + len) * H); gr.addColorStop(0, `rgba(60,55,45,${0.05 + r() * 0.1})`); gr.addColorStop(1, 'rgba(60,55,45,0)'); g.fillStyle = gr; g.fillRect(u * W, v0 * H, 2 + r() * 7, len * H); }
    g.fillStyle = 'rgba(70,75,80,0.5)';
    for (const v of rows) for (let x = 4; x < W; x += 10) { g.beginPath(); g.arc(x, v * H, 1.5, 0, 7); g.fill(); }
    for (const u of cols) for (let y = 6; y < H; y += 10) { g.beginPath(); g.arc(u * W, y, 1.3, 0, 7); g.fill(); }
  });
  col.colorSpace = THREE.SRGBColorSpace;
  const bump = canvasTex(W, H, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = 122 + r() * 12; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * W, r() * H, 3, 3); }        // orange peel
    g.fillStyle = '#d8d8d8';
    for (const v of rows) for (let x = 4; x < W; x += 10) { g.beginPath(); g.arc(x, v * H, 2, 0, 7); g.fill(); }
    for (const u of cols) for (let y = 6; y < H; y += 10) { g.beginPath(); g.arc(u * W, y, 1.8, 0, 7); g.fill(); }
  });
  return { col, bump };
}
/** Placard with lettering. "R:" prefix = white on red (danger); "|" separates lines. */
function labelMaterial(spec) {
  const danger = spec.startsWith('R:'), lines = (danger ? spec.slice(2) : spec).split('|');
  const W = 512, H = Math.max(96, Math.round(64 + lines.length * 62));
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = danger ? '#c8161d' : '#f1f0ea'; g.fillRect(0, 0, W, H);
    g.strokeStyle = danger ? '#ffffff' : '#1a1a1a'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = danger ? '#ffffff' : '#141414'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = 64; g.font = `700 ${px}px Inter, Arial, sans-serif`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width)); px = Math.min(64, Math.floor((64 * (W - 44)) / widest), Math.floor((H - 30) / lines.length)); g.font = `700 ${px}px Inter, Arial, sans-serif`;
    lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * px * 1.08));
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; // glTF UV convention
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
/** Polished concrete for the floor: mottled, with faint expansion joints. */
const concreteTex = () => { let s = 5; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; const t = canvasTex(512, 512, (g) => { g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 5000; i++) { const v = 105 + r() * 70; g.fillStyle = `rgba(${v},${v},${v},0.25)`; const d = 2 + r() * 14; g.fillRect(r() * 512, r() * 512, d, d); } g.strokeStyle = 'rgba(40,40,40,0.6)'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510); }, [14, 14]); t.colorSpace = THREE.SRGBColorSpace; return t; };

/**
 * Heat discolouration, added to a standard material's shader. Metal that has run hot goes straw,
 * then bronze, purple and blue; the tint follows position along the engine with a patchy edge.
 * x0..x1 is the axial range over which the colour develops (cold end to hot end).
 */
function heatTint(mat, x0, x1, strength = 1) {
  return finish(mat, { ...(mat.userData.finish ? {} : FINISH.hotCase), heat: [x0, x1, strength] });
}

const sample = (prof, x0, x1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const x = lerp(x0, x1, i / n); return [x, rAt(prof, x)]; });
const CONST = (r) => [[-9, r], [9, r]];
const offset = (prof, d) => prof.map(([x, r]) => [x, r + d]);
const band = (inner, outer, x0, x1, n) => [...sample(outer, x0, x1, n), ...sample(inner, x0, x1, n).reverse()];

function lathe(loop, seg, phiStart = 0, phiLen = TAU) {
  const pts = loop.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0008), x)); pts.push(pts[0].clone());
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLen); g.rotateZ(-Math.PI / 2); g.computeVertexNormals(); return g;
}
/** Flat section face of a revolved loop at instance-angle th. */
function capGeo(loop, th) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(loop.map(([x, r]) => new THREE.Vector2(x, Math.max(r, 0)))));
  g.rotateX(th); return g; // (x, r, 0) -> (x, r cos th, r sin th)
}

/**
 * Blade with a real aerofoil section: NACA-style thickness on a parabolic camber
 * line, with chord, stagger, camber and thickness varying from root to tip.
 * Root at y = 0, span along +y, engine axis along x.
 */
function bladeGeo(o) {
  const nS = o.nSpan || 7, nP = o.nProf || 9, pos = [], idx = [], uv = [];
  const prof = [];
  for (let i = 0; i <= nP; i++) prof.push([i / nP, 1]);
  for (let i = nP - 1; i >= 1; i--) prof.push([i / nP, -1]);
  const L = prof.length;
  for (let s = 0; s <= nS; s++) {
    const f = s / nS, c = lerp(o.chord[0], o.chord[1], f), a = lerp(o.stagger[0], o.stagger[1], f), m = lerp(o.camber[0], o.camber[1], f), t = lerp(o.thick[0], o.thick[1], f);
    const sw = (o.sweep || 0) * Math.sin(f * Math.PI * 0.9) + (o.sweepS || 0) * Math.sin(f * TAU) + (o.rake || 0) * f, ca = Math.cos(a), sa = Math.sin(a);
    let k = 0;
    for (const [x, side] of prof) {
      uv.push(k++ / L, f);
      const xx = 0.5 * (1 - Math.cos(Math.PI * x)); // cluster points at the edges
      const yt = 5 * t * (0.2969 * Math.sqrt(xx) - 0.126 * xx - 0.3516 * xx * xx + 0.2843 * xx ** 3 - 0.1036 * xx ** 4);
      const X = (xx - 0.5) * c, Z = (m * 4 * xx * (1 - xx) + side * yt) * c;
      pos.push(X * ca - Z * sa + sw, f * o.span, X * sa + Z * ca);
    }
  }
  for (let s = 0; s < nS; s++) for (let i = 0; i < L; i++) { const a = s * L + i, b = s * L + ((i + 1) % L), c2 = a + L, d = b + L; idx.push(a, c2, b, b, c2, d); }
  const tip = nS * L; for (let i = 1; i < L - 1; i++) idx.push(tip, tip + i + 1, tip + i);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// Every shader here avoids operations that are undefined in GLSL (pow of a negative base,
// smoothstep with edge0 >= edge1, normalize of a zero vector). Software renderers tolerate
// them; real GPUs return NaN, and bloom then smears a single NaN pixel into large black blocks.
const HeatHaze = {
  uniforms: { tDiffuse: { value: null }, uA: { value: new THREE.Vector2() }, uB: { value: new THREE.Vector2() }, uR: { value: 0.1 }, uK: { value: 0 }, uT: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uA,uB; uniform float uR,uK,uT,uAspect; varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y);}
    void main(){
      vec2 as=vec2(uAspect,1.0); vec2 p=vUv*as, a=uA*as, b=uB*as, ab=b-a;
      float len=max(length(ab),1e-4); vec2 dir=ab/len;
      float t=clamp(dot(p-a,dir)/len,0.0,1.0);
      float d=length(p-(a+ab*t)); float r=max(uR*(1.0+1.6*t),1e-4);
      float m=(1.0-smoothstep(r*0.15,r,d))*smoothstep(0.0,0.08,t)*(1.0-t*0.75)*clamp(uK,0.0,1.0);
      vec2 q=p*38.0-dir*uT*9.0; vec2 off=vec2(n(q)-0.5,n(q+17.3)-0.5)*0.011*m;
      gl_FragColor=texture2D(tDiffuse,clamp(vUv+off/as,0.0,1.0)); }`,
};
// Replaces NaN / infinite pixels with black and caps extreme highlights before they reach bloom.
const Sanitize = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv);
      bool bad = !(c.r==c.r) || !(c.g==c.g) || !(c.b==c.b) || abs(c.r)>1e6 || abs(c.g)>1e6 || abs(c.b)>1e6;
      gl_FragColor = bad ? vec4(0.0,0.0,0.0,1.0) : vec4(clamp(c.rgb,0.0,24.0),1.0); }`,
};

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    const scene = (this.scene = new THREE.Scene());
    scene.background = this.studioBackground = new THREE.Color(0x0e0f11);
    scene.fog = new THREE.Fog(0x0e0f11, 16, 42);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.05, 90);
    this.orbit = { az: -0.72, el: 0.2, dist: 10.4, target: new THREE.Vector3(1.65, -0.05, 0) };
    this.offsetX = 0; this.offsetY = 0;
    const key = (this.key = new THREE.DirectionalLight(0xfff4e6, 2.0)); key.position.set(-2.5, 7, 6); key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 2.5;
    Object.assign(key.shadow.camera, { left: -4.5, right: 5.5, top: 4, bottom: -4, near: 1, far: 22 }); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2ff, 1.4); rim.position.set(5, 3, -7); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(2, -1, 6); scene.add(fill);
    this.flameLight = new THREE.PointLight(0xff8a30, 0, 3.5, 1.6); this.flameLight.position.set(2.05, 0, 0); scene.add(this.flameLight);

    this.cutaway = true; this.explode = 0; this.showFlow = true; this.quality = 'medium';
    this.parts = []; this.byId = {}; this.vsvRows = []; this.cutInst = []; this.rotorRows = []; this.hingePivots = []; this.cowl = { open: false, fan: 0, cd: 0 }; this.hover = null; this.selected = null;
    setSurfaceQuality(this.quality || 'medium', this.renderer);
    this.sprite = softSprite(); this.tex = { liner: linerTex(), brushed: brushedTex(), braid: braidTex(), blade: bladeTex(false), fanBlade: bladeTex(true), cast: castTex(), paint: paintTextures(), concrete: concreteTex() };
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xb8402a, metalness: 0.1, roughness: 0.7, side: THREE.DoubleSide });
    this.t = 0; this.flash = 0;
    this.engine = new THREE.Group(); scene.add(this.engine);
    this.g1 = new THREE.Group(); this.g2 = new THREE.Group(); this.engine.add(this.g1, this.g2);
    this._buildStage();
    this._buildEngine();
    this._buildEffects();
    this.apronView = new ApronView(this);   // the A320 on its stand (app/apron3d.js), hidden until asked for
    this.borescope = new Borescope(this);   // inspection through the case ports (app/borescope.js)
    this._buildPost();
    // Transparent effects (plume, flames, smoke, mist, fan blur) must stay out of the ambient-occlusion
    // pre-pass. That pass redraws the scene with a plain opaque material, so an effect quad or plume
    // shell would be treated as a solid surface and show up as a black square or dark rings.
    this.scene.traverse((n) => { if ((n.isMesh || n.isPoints || n.isLine) && n.material && n.material.transparent && n.material.depthWrite === false) n.layers.set(1); });
    this.camera.layers.enable(1);
    this.scene.traverse((n) => { if (n.userData.softFx) n.layers.set(2); });   // smoke and fire: drawn by their own pass (fx.js SoftFxPass)
    { const ao = this.ao, render = ao.render.bind(ao), cam = this.camera; ao.render = (...a) => { cam.layers.disable(1); try { render(...a); } finally { cam.layers.enable(1); } }; }
    this._controls();
    this.setCutaway(true);
    this.resize();
  }

  // ------------------------------------------------------------------ parts
  _part(d) {
    const part = { removed: false, ex: 0, objs: [], glow: null, external: false, ...d };
    part.mat = d.mat.isMaterial ? d.mat : new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...d.mat });
    this.parts.push(part); this.byId[part.id] = part;
    return part;
  }
  /** Group that turns with one cowl half about its hinge. Objects added to the returned group are given in engine coordinates. */
  _hingeInner(part, kind, side) {
    const key = `${part.id}:${kind}:${side}`; this._hg ||= {};
    if (this._hg[key]) return this._hg[key];
    const h = HINGES[kind][side], wrap = new THREE.Group(), piv = new THREE.Group(), inner = new THREE.Group();
    piv.position.set(0, h.r * Math.cos(h.th), h.r * Math.sin(h.th)); inner.position.copy(piv.position).negate();
    wrap.add(piv); piv.add(inner); this._reg(part, wrap);
    (this.hingePivots ||= []).push({ obj: piv, kind, side });
    return (this._hg[key] = inner);
  }
  _into(group, part, obj) { obj.traverse((m) => { if (m.isMesh) { m.userData.part = part; m.castShadow = true; m.receiveShadow = true; } }); group.add(obj); return obj; }
  /** Part of a solid of revolution between instance angles th0 and th1, turning with one cowl half; it gets a cut variant where it meets the cutaway sector. */
  _halfLathe(part, kind, side, loop, th0, th1, mat, seg = 64) {
    const inner = this._hingeInner(part, kind, side), mk = (a, b, n, capA) => {
      const m = new THREE.Mesh(lathe(loop, n, a - Math.PI / 2, b - a), mat);
      m.add(new THREE.Mesh(capGeo(loop, a), capA || mat), new THREE.Mesh(capGeo(loop, b), mat)); return m; };
    const full = this._into(inner, part, mk(th0, th1, seg));
    if (th0 < CUT_B && th1 > CUT_B) { full.userData.variant = 'full'; this._into(inner, part, mk(CUT_B, th1, Math.max(8, Math.round(seg * (th1 - CUT_B) / (th1 - th0))), this.capMat)).userData.variant = 'cut'; }
    return inner;
  }
  /** Move the authored model's cowl halves (nodes named ..._L / ..._R) onto hinge pivots inside their holder. */
  _rigExternalHinges(holder, kind) {
    const piv = {};
    for (const n of [...holder.children]) {
      const m = /_(L|R)(?:_\d+)?(?:__(?:cut|full))?$/.exec(n.name || ''); if (!m) continue;
      const side = m[1];
      if (!piv[side]) { const h = HINGES[kind][side]; piv[side] = new THREE.Group(); piv[side].position.set(0, h.r * Math.cos(h.th), h.r * Math.sin(h.th)); holder.add(piv[side]); this.hingePivots.push({ obj: piv[side], kind, side }); }
      piv[side].attach(n);
    }
  }
  _reg(part, obj, parent = this.engine) {
    if (this._tagInt && !obj.userData.tag) obj.userData.tag = 'internal';   // generated stand-in for an authored internal (see loadExternalModel)
    obj.traverse((m) => { if (m.isMesh) { m.userData.part = part; m.castShadow = true; m.receiveShadow = true; } });
    part.objs.push(obj); parent.add(obj); return obj;
  }
  /** Solid of revolution. Static parts get a full version and a wedge-cut version with section faces. */
  _solid(part, loop, o = {}) {
    const mat = o.mat || part.mat, seg = o.seg || 120, parent = o.parent || this.engine, g = new THREE.Group();
    const full = new THREE.Mesh(lathe(loop, seg), mat); g.add(full);
    if (o.cut !== false && parent === this.engine) {
      // lathe angle phi relates to instance angle th by th = phi + 90 deg
      const ca = o.deep ? DEEP_A : CUT_A;
      const cut = new THREE.Mesh(lathe(loop, Math.round(seg * (o.deep ? 0.86 : 0.67)), CUT_B - Math.PI / 2, TAU - (CUT_B - ca)), mat);
      const caps = new THREE.Group();
      caps.add(new THREE.Mesh(capGeo(loop, CUT_B), this.capMat), new THREE.Mesh(capGeo(loop, ca), this.capMat));
      cut.add(caps); g.add(cut); g.userData.cutPair = [full, cut];
    }
    if (o.tag) g.userData.tag = o.tag;
    return this._reg(part, g, parent);
  }
  /** Ring of identical items. Static rings can drop the instances inside the cutaway wedge. */
  _ring(part, geo, count, place, o = {}) {
    const parent = o.parent || this.engine, mat = o.mat || part.mat;
    const ths = Array.from({ length: count }, (_, i) => (i / count) * TAU + (o.phase || 0));
    if (parent === this.engine && o.cut !== false) ths.sort((a, b) => inCut(a) - inCut(b));
    const im = new THREE.InstancedMesh(geo, mat, count), m = new THREE.Matrix4();
    ths.forEach((th, i) => { place(m, th); im.setMatrixAt(i, m); });
    im.userData.ths = ths; im.userData.place = place;
    if (parent === this.engine && o.cut !== false) { im.userData.kept = ths.filter((t) => !inCut(t)).length; this.cutInst.push(im); }
    return this._reg(part, im, parent);
  }
  /** The part's material with a blade surface texture; follows the part's glow and highlight. */
  _bladeMat(part, tex) {
    if (!part.bladeMat) { part.bladeMat = part.mat.clone(); part.bladeMat.map = tex; (part.extMats ||= []).push(part.bladeMat); }
    return part.bladeMat;
  }
  /** Rotor drum as discs: rim shell under the blades, a thin web and a thick bore for each stage. Returns a section loop. */
  _discs(xa, xb, xs, d) {
    const rim = (x) => rAt(P.coreInner, x) - 0.004, sh = d.shell || 0.012, w = d.web / 2, bw = d.boreW / 2, loop = sample(offset(P.coreInner, -0.004), xa, xb, 12);
    loop.push([xb, rim(xb) - sh]);
    for (const x of [...xs].sort((a, b) => b - a)) {
      const rb = typeof d.bore === 'function' ? d.bore(x) : d.bore, top = rb + d.boreH;
      loop.push([x + w, rim(x + w) - sh], [x + w, top], [x + bw, top - d.boreH * 0.45], [x + bw, rb], [x - bw, rb], [x - bw, top - d.boreH * 0.45], [x - w, top], [x - w, rim(x - w) - sh]);
    }
    loop.push([xa, rim(xa) - sh]);
    return loop;
  }
  _row(part, row, count, parent, b, o = {}) {
    const xm = (row.x0 + row.x1) / 2, lo = rAt(row.lo, xm) - 0.004, hi = rAt(row.hi, xm) - (row.kind === 'rotor' ? 0.005 : 0);
    const c = (row.x1 - row.x0) * (b.chordK || 1.15);
    const geo = bladeGeo({ span: hi - lo, chord: [c * (b.rootK || 1), c * (b.tipK || 0.85)], stagger: b.stagger, camber: b.camber || [0.08, 0.04], thick: b.thick || [0.1, 0.06], sweep: b.sweep, sweepS: b.sweepS, rake: b.rake, nSpan: b.nSpan, nProf: b.nProf });
    const q = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1);
    const im = this._ring(part, geo, count, (m, th) => { q.setFromAxisAngle(ax, th); m.compose(new THREE.Vector3(xm, lo * Math.cos(th), lo * Math.sin(th)), q, one); }, { parent, mat: o.mat });
    im.userData.row = { xm, lo };
    if (parent !== this.engine && !o.whole) this.rotorRows.push({ im, group: parent, part });
    return im;
  }
  _flange(part, x, r, n = 40, o = {}) {
    this._solid(part, [[x - 0.007, r - 0.004], [x - 0.007, r + 0.032], [x + 0.007, r + 0.032], [x + 0.007, r - 0.004]], { seg: 96, ...o });
    const bolt = new THREE.CylinderGeometry(0.0055, 0.0055, 0.026, 6); bolt.rotateZ(Math.PI / 2);
    this._ring(part, bolt, n, (m, th) => m.makeTranslation(x, (r + 0.019) * Math.cos(th), (r + 0.019) * Math.sin(th)), { mat: this.boltMat });
  }
  _pipe(part, pts, rad, mat) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, r, th]) => new THREE.Vector3(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG))), false, 'catmullrom', 0.4);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 10, rad, 8), mat || part.mat);
    return this._reg(part, m);
  }

  _buildEngine() {
    const T = this.tex;
    const paint = { color: 0xc9cdd1, metalness: 0, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.14 };
    const polished = { color: 0xc9ced3, metalness: 1, roughness: 0.3 }; // matte, not mirror, per photos
    const titanium = { color: 0xa9b0b7, metalness: 1, roughness: 0.34 };
    const caseM = { color: 0x8496a8, metalness: 0.06, roughness: 0.55, bumpMap: T.cast, bumpScale: 0.35 }; // compressor and diffuser cases are painted blue-grey (paint: not metallic)
    const hotM = { color: 0xb4aea6, metalness: 0.95, roughness: 0.46, roughnessMap: T.brushed, bumpMap: T.cast, bumpScale: 0.3 };
    const composite = { color: 0x24272b, metalness: 0.1, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.5 };
    const linerM = new THREE.MeshPhysicalMaterial({ color: 0x8f959b, metalness: 0.5, roughness: 0.75, map: T.liner, side: THREE.DoubleSide });
    this.boltMat = new THREE.MeshStandardMaterial({ color: 0xa9aeb3, metalness: 1, roughness: 0.36 });
    const pipeSteel = new THREE.MeshStandardMaterial({ color: 0xa4a9ad, metalness: 1, roughness: 0.38 });   // stainless: grey, satin, not mirror
    const pipeGold = new THREE.MeshStandardMaterial({ color: 0xb0914e, metalness: 0.95, roughness: 0.38 }); // cadmium-plated / bronze fittings and small-bore lines
    const harness = new THREE.MeshStandardMaterial({ color: 0xc6c0b2, metalness: 0, roughness: 0.92 }); // looms are sleeved in white braid (SR Technics component photos)
    const conduit = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.1, roughness: 0.7 });
    const unitGrey = new THREE.MeshStandardMaterial({ color: 0x8e9398, metalness: 0.7, roughness: 0.45 }); // cast accessory housings (exciters, valve bodies)
    this.shared = { paint: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...paint, map: T.paint.col, bumpMap: T.paint.bump, bumpScale: 0.6 }), lip: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...polished, roughnessMap: T.brushed }), section: this.capMat, loom: new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.braid, roughness: 0.85, metalness: 0, bumpMap: T.braid, bumpScale: 0.4 }) };
    // the authored acoustic panels and bleed grilles use the perforated texture (they carry UVs)
    this.shared.liner_perf = linerM;
    { const t = T.liner.clone(); t.repeat.set(9, 9); t.needsUpdate = true; this.shared.grille = new THREE.MeshStandardMaterial({ color: 0x6c6e70, metalness: 0.8, roughness: 0.5, map: t, side: THREE.DoubleSide }); }
    const C = (K) => `${(K - 273.15).toFixed(0)} °C`, B = (p) => `${(p / 1e5).toFixed(2)} bar`;
    const A = (d) => this._part(d);
    const castM = { color: 0x8a9198, metalness: 0.45, roughness: 0.55 }, chromM = { color: 0xa8894a, metalness: 0.85, roughness: 0.42 };

    // ---------------- nacelle
    const inlet = A({ id: 'inlet', name: 'Inlet cowl', ex: -1.5, mat: paint, desc: 'Slows and straightens the incoming air for the fan. The inner barrel is a perforated acoustic liner that absorbs fan noise.', live: (o) => `Airflow ${o.W2.toFixed(0)} kg/s · inlet ${C(o.T2)}, ${B(o.P2)}` });
    this._solid(inlet, [...sample(P.nacelle, -0.836, 0.0, 14), ...sample(offset(P.inletInner, 0.012), -0.836, 0.0, 14).reverse()], { tag: 'skin' });
    this._tagInt = true; this._solid(inlet, [...sample(offset(P.inletInner, 0.012), -0.8, 0.0, 12), ...sample(P.inletInner, -0.8, 0.0, 12).reverse()], { mat: linerM }); this._tagInt = false;
    const lip = A({ id: 'lip', name: 'Inlet lip', ex: -1.7, mat: polished, desc: 'Polished aluminium leading edge, heated with engine bleed air so ice cannot build up and break off into the fan.', live: () => '' });
    this._solid(lip, lipLoop(), { tag: 'skin' });
    const fanCase = A({ id: 'fancase', name: 'Fan case and outlet guide vanes', ex: -0.55, mat: paint, desc: 'Contains the fan, and a released blade if one ever fails. The outlet guide vanes take the swirl out of the bypass air.', live: (o) => `Bypass ${o.Wbypass.toFixed(0)} kg/s · fan pressure ratio ${o.fan.PR.toFixed(2)} · ${C(o.T13)}` });
    const fanCowl = A({ id: 'fancowl', name: 'Fan cowl doors', ex: -0.55, mat: paint, desc: 'Two hinged doors that close around the fan case. Remove them to see the bare fan case with the oil tank, the accessory gearbox and the pipework that normally hide underneath.', live: () => '' });
    this._solid(fanCowl, band(offset(P.bypOuter, 0.014), P.nacelle, 0.0, 1.2, 14), { tag: 'skin' });
    this._tagInt = true; this._solid(fanCase, band(P.bypOuter, offset(P.bypOuter, 0.014), 0.36, 1.2, 10), { mat: linerM }); this._tagInt = false;
    // light blue abradable fan track liner around the blade tips (reference photos)
    this._tagInt = true; this._solid(fanCase, band(P.bypOuter, offset(P.bypOuter, 0.014), 0.0, 0.36, 4), { mat: new THREE.MeshStandardMaterial({ color: 0x9cc9e6, metalness: 0, roughness: 0.8, side: THREE.DoubleSide }) }); this._tagInt = false;
    const cna = A({ id: 'cna', name: 'Thrust reverser cowls and common nozzle', ex: 0.2, mat: paint, desc: 'The long duct carries bypass air aft, where it mixes with the core exhaust and leaves through one common nozzle.', live: (o) => `Mixed jet ${o.V9.toFixed(0)} m/s (Mach ${o.M9.toFixed(2)}) · ${C(o.T7)} · ${o.W9.toFixed(0)} kg/s` });
    this._solid(cna, band(offset(P.bypOuter, 0.012), P.nacelle, 1.2, 2.86, 20), { tag: 'skin' });
    // unpainted common nozzle at the rear, with a visible step from the painted cowl
    this._solid(cna, band(offset(P.bypOuter, 0.012), offset(P.nacelle, -0.008), 2.86, P.X_EXIT, 16), { tag: 'skin', mat: (this.shared.bare = heatTint(new THREE.MeshPhysicalMaterial({ color: 0xa2a7ab, metalness: 1, roughness: 0.34, side: THREE.DoubleSide }), 2.75, 3.6, 0.8)) });
    // nacelle strake, high on the side
    const stS = new THREE.Shape(); stS.moveTo(0, 0); stS.lineTo(0.62, 0); stS.lineTo(0.56, 0.1); stS.lineTo(0.2, 0.035); stS.lineTo(0, 0);
    const strake = new THREE.Mesh(new THREE.ExtrudeGeometry(stS, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 }).translate(0.25, 1.0, -0.006), fanCowl.mat);
    strake.rotation.x = -0.42; strake.userData.tag = 'skin'; this._reg(fanCowl, strake);
    this._solid(cna, band(P.bypOuter, offset(P.bypOuter, 0.012), 1.2, P.X_EXIT - 0.05, 26), { tag: 'liner', mat: new THREE.MeshPhysicalMaterial({ ...composite, side: THREE.DoubleSide }) });

    // ---------------- fan
    // Spinner per reference photos: a long straight cone in two pieces. Dark nose cone with a
    // white tip and white crescent; light grey rear fairing with recessed bolt pockets.
    const spinner = A({ id: 'spinner', name: 'Spinner', ex: -1.25, mat: { color: 0x2a2e33, metalness: 0.1, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.5 }, desc: 'Glass-fibre nose cone with a soft rubber tip that sheds ice, held to the front blade retaining ring by 18 bolts under a titanium fairing. The white spiral makes a turning fan obvious to people on the ground.', live: (o) => `N1 ${o.N1.toFixed(0)} rpm` });
    const sr = (x) => rAt(P.spinner, x);
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.55, side: THREE.DoubleSide });
    const fairing = new THREE.MeshPhysicalMaterial({ color: 0xa9aeb3, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
    this._solid(spinner, [[-0.5, sr(-0.5)], [-0.19, sr(-0.19)], [-0.19, 0]], { parent: this.g1 });
    this._solid(spinner, [[-0.56, 0.0008], [-0.5, sr(-0.5)], [-0.5, 0]], { parent: this.g1, mat: white, seg: 48 });
    this._solid(spinner, [[-0.19, sr(-0.19) + 0.004], [0.02, sr(0.02) + 0.004], [0.02, 0.05], [-0.19, 0.05]], { parent: this.g1, mat: fairing });
    this._solid(spinner, [[-0.196, sr(-0.196) + 0.001], [-0.186, sr(-0.186) + 0.006], [-0.186, sr(-0.186) - 0.004]], { parent: this.g1, mat: fairing, seg: 96 });
    // white spiral band on the black cone (it makes a turning fan obvious from any angle)
    {
      const N = 140, pos = [], idx = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N, phi = t * TAU * 1.2, xc = -0.47 + 0.25 * t, hw = (0.012 + 0.03 * t) * Math.min(1, Math.sin(Math.PI * t) * 6);
        for (const x of [xc - hw, xc + hw]) { const r = sr(x) + 0.0018; pos.push(x, r * Math.cos(phi), r * Math.sin(phi)); }
        if (k < N) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      this._reg(spinner, new THREE.Mesh(g, white), this.g1);
    }
    const pocket = new THREE.SphereGeometry(0.013, 10, 8); pocket.scale(1.5, 0.45, 1);
    this._ring(spinner, pocket, 18, (m, th) => { m.makeRotationX(th); m.multiply(new THREE.Matrix4().makeRotationZ(0.405)); m.setPosition(-0.08, (sr(-0.08) + 0.004) * Math.cos(th), (sr(-0.08) + 0.004) * Math.sin(th)); }, { parent: this.g1, mat: new THREE.MeshStandardMaterial({ color: 0x3a3e43, metalness: 0.6, roughness: 0.5 }) });
    const fan = A({ id: 'fan', name: 'Fan — 22 wide-chord blades', ex: -1.0, mat: titanium, desc: 'Hollow titanium wide-chord blades, 1.6 m across. Produces most of the thrust by moving a large mass of bypass air.', live: (o) => `N1 ${o.N1pct.toFixed(1)} % · absorbs ${(o.pwrFan / 1e6).toFixed(1)} MW · efficiency ${(o.fan.eff * 100).toFixed(0)} %` });
    // Generated internals (tagged 'internal') stand in until the authored model loads; tools/blender/internals.py builds the real ones.
    this._tagInt = true;
    this._row(fan, ROWS[0], 22, this.g1, { chordK: 1.0, rootK: 0.8, tipK: 1.32, stagger: [0.22, 1.02], camber: [0.14, 0.02], thick: [0.085, 0.022], sweep: 0.035, sweepS: 0.012, nSpan: 16, nProf: 12 }, { mat: this._bladeMat(fan, T.fanBlade), whole: true });
    this._solid(fan, [[0.02, 0.05], [0.02, 0.247], [0.3, 0.27], [0.3, 0.05]], { parent: this.g1, mat: fairing }); // annulus fillers
    // the hub between the blades is 22 separate annulus fillers: show the joints, following the blade root stagger, and a rubber seal strip along each blade root
    { const seam = new THREE.BoxGeometry(0.27, 0.004, 0.004), seal = new THREE.BoxGeometry(0.25, 0.01, 0.012), dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 }), q = new THREE.Quaternion(), qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.22), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1), rh = 0.2595;
      const at = (off) => (m, th) => { q.setFromAxisAngle(ax, th + off).multiply(qs); m.compose(new THREE.Vector3(0.16, rh * Math.cos(th + off), rh * Math.sin(th + off)), q, one); };
      this._ring(fan, seam, 22, at(TAU / 44), { parent: this.g1, mat: dark }); this._ring(fan, seal, 22, at(0.012), { parent: this.g1, mat: dark }); }
    this._tagInt = false;
    // acoustic liner splices in the inlet barrel, and the grey ice-impact panel aft of the fan track
    this._tagInt = true; for (let k = 0; k < 6; k++) { const x = -0.6 + k * 0.1, r = rAt(P.inletInner, x) + 0.0125; this._ring(inlet, new THREE.BoxGeometry(0.1, 0.004, 0.035), 3, (m, th) => { m.makeRotationX(th); m.setPosition(x, r * Math.cos(th), r * Math.sin(th)); }, { phase: 1.05, mat: new THREE.MeshStandardMaterial({ color: 0x9a9fa4, metalness: 0.6, roughness: 0.5 }) }); } this._tagInt = false;
    this._tagInt = true; this._solid(fanCase, band(offset(P.bypOuter, -0.001), offset(P.bypOuter, 0.003), 0.36, 0.52, 4), { mat: new THREE.MeshStandardMaterial({ color: 0x70767c, roughness: 0.85, side: THREE.DoubleSide }) }); this._tagInt = false;
    this._tagInt = true; this._row(fanCase, ROWS[1], 60, this.engine, { stagger: [-0.3, -0.3], camber: [-0.1, -0.1], thick: [0.07, 0.07], chordK: 1.3, tipK: 1 }, { mat: new THREE.MeshPhysicalMaterial({ ...titanium, color: 0x8c949b }) }); this._tagInt = false;

    // ---------------- compressors and turbines
    const lpc = A({ id: 'lpc', name: 'Low-pressure compressor (4 booster stages)', ex: -0.45, mat: { ...titanium, color: 0xa3abb3 }, desc: 'Booster stages on the fan shaft that supercharge the core.', live: (o) => `Pressure ratio ${o.lpc.PR.toFixed(2)} · exit ${C(o.T25)}, ${B(o.P25)} · ${o.Wlpc.toFixed(1)} kg/s` });
    const lpcCase = A({ id: 'lpccase', name: 'LPC case, stators and 2.5 bleed ring', ex: -0.3, mat: caseM, desc: 'Fixed vanes between the booster rotors. The bleed ring dumps air into the bypass duct at low power so the booster does not surge.', live: (o) => `2.5 bleed ${(o.b25 * 100).toFixed(0)} % open · ${o.Wb25.toFixed(1)} kg/s dumped` });
    const hpc = A({ id: 'hpc', name: 'High-pressure compressor (10 stages)', ex: 0, mat: { color: 0x979da3, metalness: 1, roughness: 0.34 }, desc: 'Ten stages on the high-pressure spool raise the air to over 30 times ambient pressure at take-off.', live: (o) => `N2 ${o.N2pct.toFixed(1)} % · pressure ratio ${o.hpc.PR.toFixed(1)} · exit ${C(o.T3)}, ${B(o.P3)} · absorbs ${(o.pwrHpc / 1e6).toFixed(1)} MW` });
    const hpcCase = A({ id: 'hpccase', name: 'HPC case and variable stator vanes', ex: 0.05, mat: caseM, desc: 'The inlet guide vanes and first three stator rows (the darker vanes) are turned by unison rings to keep the front stages out of stall at low speed.', live: (o) => `Stators ${o.vsv.toFixed(1)}° closed (schedule ${o.vsvSched.toFixed(1)}°) · surge margin ${(100 * (o.hpc.xs - o.hpc.x) / o.hpc.xs).toFixed(0)} %` });
    const vsvMat = new THREE.MeshPhysicalMaterial({ color: 0x6f7c88, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }); // variable rows: darker coated steel
    const hpt = A({ id: 'hpt', name: 'High-pressure turbine (2 stages)', ex: 0.55, mat: { color: 0x8f8a82, metalness: 1, roughness: 0.4 }, glow: (o) => o.T41 - 250, desc: 'Drives the HP compressor. Single-crystal blades run in gas hotter than their melting point and survive on cooling air.', live: (o) => `Entry ${C(o.T4)} · delivers ${(o.pwrHpt / 1e6).toFixed(1)} MW · cooling air ${o.Wcool.toFixed(1)} kg/s` });
    const hptCase = A({ id: 'hptcase', name: 'HPT case and nozzle guide vanes', ex: 0.6, mat: hotM, glow: (o) => o.T4 - 380, desc: 'The guide vanes form the choked throat that sets how much air the core can pass.', live: (o) => `Expansion ratio ${o.hptPR.toFixed(2)} · exit ${C(o.T45)}, ${B(o.P45)}` });
    const lpt = A({ id: 'lpt', name: 'Low-pressure turbine (5 stages)', ex: 0.95, mat: { color: 0x9a8a68, metalness: 1, roughness: 0.4 }, glow: (o) => o.T45 - 130, desc: 'Extracts the remaining energy to drive the fan and booster through the long central shaft.', live: (o) => `Delivers ${(o.pwrLpt / 1e6).toFixed(1)} MW · expansion ratio ${o.lptPR.toFixed(2)} · efficiency ${(o.lpt.eff * 100).toFixed(0)} %` });
    const lptCase = A({ id: 'lptcase', name: 'LPT case and vanes', ex: 1.0, mat: hotM, glow: (o) => o.T45 - 230, desc: 'Flared casing around the five low-pressure turbine stages.', live: (o) => `Turbine metal ${C(o.Tm)}` });

    this._tagInt = true;
    for (let i = 2; i < ROWS.length; i++) {
      const row = ROWS[i], xm = (row.x0 + row.x1) / 2, turbine = xm > 2.2, hpSide = xm > 1.1 && xm < 2.45;
      const n = turbine ? (hpSide ? 60 : 64) : xm < 1.1 ? 62 : 68;
      if (row.kind === 'rotor') {
        const part = turbine ? (row.spool === 2 ? hpt : lpt) : row.spool === 2 ? hpc : lpc;
        this._row(part, row, n, row.spool === 2 ? this.g2 : this.g1, turbine ? { stagger: [-0.5, -0.8], camber: [-0.3, -0.22], thick: [0.2, 0.13], chordK: 1.45, tipK: 0.95 } : { stagger: [0.5, 0.85], camber: [0.1, 0.05], thick: [0.08, 0.05], chordK: 1.2 }, { mat: this._bladeMat(part, T.blade) });
      } else {
        const part = turbine ? (xm < 2.45 ? hptCase : lptCase) : xm < 1.1 ? lpcCase : hpcCase;
        const im = this._row(part, row, n, this.engine, turbine ? { stagger: [0.6, 0.6], camber: [0.3, 0.3], thick: [0.15, 0.15], chordK: 1.25, tipK: 1 } : { stagger: [-0.4, -0.4], camber: [-0.12, -0.12], thick: [0.08, 0.08], chordK: 1.2, tipK: 1 }, row.vsv ? { mat: vsvMat } : { mat: this._bladeMat(part, T.blade) });
        if (row.vsv) this.vsvRows.push(im);
      }
    }
    // drums and discs
    // Each is a body of revolution, which looks the same turning or still, so it is built as a
    // fixed solid and sectioned in the deep cut where its discs and webs can be seen.
    const rotX = (lo, hi, sp) => ROWS.filter((r) => r.kind === 'rotor' && r.spool === sp && r.x0 > lo && r.x1 < hi).map((r) => (r.x0 + r.x1) / 2);
    this._solid(lpc, this._discs(0.42, 0.9, rotX(0.4, 1.0, 1), { web: 0.008, boreW: 0.022, boreH: 0.02, bore: (x) => rAt(P.coreInner, x) - 0.085 }), { deep: true });
    this._solid(lpc, [[0.3, 0.2], [0.3, 0.212], [0.43, 0.322], [0.43, 0.31]], { deep: true });                       // booster drum bolted to the back of the fan disc
    this._solid(hpc, this._discs(1.17, 1.86, rotX(1.1, 1.9, 2), { web: 0.007, boreW: 0.03, boreH: 0.034, bore: (x) => 0.082 + (x - 1.17) * 0.02 }), { deep: true });
    this._solid(hpc, [[1.86, 0.2], [1.86, 0.212], [1.93, 0.105], [1.93, 0.093]], { deep: true });                    // rear cone down to the HP shaft
    this._solid(hpt, this._discs(2.26, 2.42, rotX(2.2, 2.45, 2), { shell: 0.016, web: 0.016, boreW: 0.05, boreH: 0.06, bore: 0.095 }), { deep: true });
    this._solid(lpt, this._discs(2.5, 3.0, rotX(2.45, 3.05, 1), { web: 0.008, boreW: 0.026, boreH: 0.03, bore: 0.165 }), { deep: true });
    this._solid(lpt, [[2.76, 0.168], [2.76, 0.18], [2.93, 0.058], [2.93, 0.046]], { deep: true });                   // drive cone to the LP shaft
    // casings with flanges
    const CO = P.coreOuter, co = (x) => rAt(CO, x);
    this._solid(lpcCase, band(CO, offset(CO, 0.022), 0.4, 1.15, 14));
    this._solid(lpcCase, [[0.89, 0.455], [0.89, 0.5], [0.95, 0.5], [0.95, 0.45]], { seg: 96 }); // bleed ring
    for (const x of [0.45, 0.86, 1.14]) this._flange(lpcCase, x, co(x) + 0.02, 44);
    this._solid(hpcCase, band(CO, offset(CO, 0.026), 1.15, 1.9, 14));
    for (const x of [1.17, 1.5, 1.88]) this._flange(hpcCase, x, co(x) + 0.024, 40);
    // unison rings and levers for the variable stators
    for (const x of [1.148, 1.218, 1.286, 1.354]) {
      const rr = co(x) + 0.062;
      this._solid(hpcCase, [[x - 0.006, rr], [x - 0.006, rr + 0.012], [x + 0.006, rr + 0.012], [x + 0.006, rr]], { seg: 96, mat: pipeSteel });
      const arm = new THREE.BoxGeometry(0.03, 0.045, 0.005); arm.translate(0.012, 0.045 + co(x), 0);
      this._ring(hpcCase, arm, 34, (m, th) => { m.makeRotationX(th); m.setPosition(x - 0.012, 0, 0); }, { mat: pipeSteel });
    }
    this._tagInt = false;
    // Handling bleed valves: large perforated domes sealed to the core cowl by orange silicone rings.
    // 7A, 7B and stage 10 on the right of the HPC case, 7C on the left beside the VSV actuator.
    const orange = new THREE.MeshStandardMaterial({ color: 0xc8502a, roughness: 0.6 }), perf = new THREE.MeshStandardMaterial({ color: 0x6c6a64, metalness: 0.9, roughness: 0.55, map: T.liner });
    const onCore = (part, ob, x, th, r, variantCheck = true) => { ob.position.set(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); ob.rotation.x = th * DEG; const o2 = this._reg(part, ob); if (variantCheck && inCut(th * DEG)) o2.userData.variant = 'full'; return o2; };
    this._tagInt = true;   // stand-ins for the authored bleed valves (details.py)
    for (const [x, th] of [[1.6, 262], [1.6, 302], [1.8, 282], [1.6, 128]]) {
      const g = new THREE.Group(), neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 20), pipeSteel), dome = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 10, 0, TAU, 0, Math.PI / 2), perf), seal = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 28), orange), rim = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 24), pipeGold);
      neck.position.y = 0.05; rim.position.y = 0.1; dome.position.y = 0.1; dome.scale.y = 0.45; seal.rotation.x = Math.PI / 2; seal.position.y = 0.105; g.add(neck, rim, dome, seal);
      onCore(hpcCase, g, x, th, co(x) + 0.03);
    }
    this._tagInt = false;
    this._tagInt = true;
    // structural struts of the intermediate case, crossing the swan-neck duct
    this._row(lpcCase, { x0: 0.94, x1: 1.08, kind: 'stator', lo: P.coreInner, hi: P.coreOuter }, 9, this.engine, { stagger: [0, 0], camber: [0, 0], thick: [0.2, 0.2], chordK: 1, tipK: 1 });
    this._solid(hptCase, band(CO, offset(CO, 0.028), 2.2, 2.45, 6));
    for (const x of [2.21, 2.44]) this._flange(hptCase, x, co(x) + 0.026, 48);
    this._solid(lptCase, band(CO, offset(CO, 0.022), 2.45, 3.02, 10));
    for (const x of [2.62, 2.82, 3.01]) this._flange(lptCase, x, co(x) + 0.02, 52);

    // ---------------- shafts
    const lpShaft = A({ id: 'lpshaft', name: 'LP shaft', ex: 0, mat: { color: 0x6c7379, metalness: 1, roughness: 0.28 }, desc: 'Runs the length of the engine inside the HP spool, connecting the LP turbine to the fan and booster.', live: (o) => `${o.N1.toFixed(0)} rpm · net torque ${o.tq1.toFixed(0)} N·m` });
    this._solid(lpShaft, [[0.12, 0.03], [0.12, 0.046], [2.98, 0.046], [2.98, 0.03]], { deep: true, seg: 48 });
    const hpShaft = A({ id: 'hpshaft', name: 'HP shaft', ex: 0.02, mat: { color: 0x858b91, metalness: 1, roughness: 0.3 }, desc: 'Short hollow shaft joining the HP turbine to the HP compressor. The accessory gearbox is driven from it.', live: (o) => `${o.N2.toFixed(0)} rpm · net torque ${o.tq2.toFixed(0)} N·m · starter ${o.tStart.toFixed(0)} N·m` });
    this._solid(hpShaft, [[1.9, 0.078], [1.9, 0.092], [2.3, 0.092], [2.3, 0.078]], { deep: true, seg: 48 });
    // ---------------- bearings
    const brg = A({ id: 'bearings', name: 'Main bearings and supports', ex: 0, mat: { color: 0x5d6770, metalness: 0.9, roughness: 0.4 }, desc: 'Five main bearings carry the two shafts. Nos 1, 2 and 3 share the front compartment at the centre of the intermediate case: No. 1 locates the LP shaft and takes its thrust, No. 2 supports it, No. 3 locates the HP shaft. No. 4 supports the HP shaft under the combustor and No. 5 the LP shaft in the turbine exhaust case. Each sits in a sealed, oil-fed compartment.', live: (o) => `N1 ${o.N1.toFixed(0)} rpm · N2 ${o.N2.toFixed(0)} rpm` });
    const race = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, metalness: 1, roughness: 0.18 }); // polished bearing steel
    for (const [x, r0, r1, wB] of [[0.52, 0.05, 0.105, 0.055], [1.01, 0.05, 0.095, 0.035], [1.1, 0.1, 0.15, 0.04], [2.07, 0.096, 0.128, 0.05], [3.06, 0.05, 0.1, 0.05]]) {
      this._solid(brg, [[x - wB / 2, r0 + 0.016], [x - wB / 2, r1], [x + wB / 2, r1], [x + wB / 2, r0 + 0.016]], { deep: true, seg: 48 });
      this._solid(brg, [[x - wB / 3, r0], [x - wB / 3, r0 + 0.016], [x + wB / 3, r0 + 0.016], [x + wB / 3, r0]], { deep: true, seg: 48, mat: race });
    }
    this._solid(brg, [[0.5, 0.098], [0.5, 0.106], [0.7, 0.2], [0.95, 0.215], [1.13, 0.168], [1.13, 0.16], [0.95, 0.205], [0.71, 0.19]], { deep: true, seg: 64 }); // No. 1 bearing support cone back to the intermediate case
    this._solid(brg, [[0.985, 0.092], [0.985, 0.1], [1.03, 0.16], [1.04, 0.16]], { deep: true, seg: 64 });
    this._solid(brg, [[1.075, 0.146], [1.075, 0.154], [1.13, 0.162], [1.13, 0.154]], { deep: true, seg: 64 });
    this._solid(hpc, [[1.09, 0.086], [1.09, 0.1], [1.2, 0.1], [1.2, 0.086]], { deep: true, seg: 48 }); // HP stub shaft into No. 3 bearing   // front bearing support cone from the intermediate case
    this._solid(brg, [[3.085, 0.09], [3.085, 0.1], [3.12, 0.255], [3.13, 0.255]], { deep: true, seg: 64 });                              // rear bearing support in the exhaust case

    // ---------------- combustor
    const comb = A({ id: 'combcase', name: 'Diffuser and combustor case', ex: 0.3, mat: caseM, desc: 'Pressure vessel around the combustor. Slows the compressor delivery air before it enters the flame tube.', live: (o) => `${B(o.P3)} · ${C(o.T3)}` });
    // diffuser case bulges outward around the combustor (cutaway drawing)
    this._solid(comb, [[1.9, co(1.9)], [1.9, co(1.9) + 0.03], [1.95, 0.372], [2.0, 0.388], [2.1, 0.388], [2.16, 0.372], [2.2, co(2.2) + 0.03], [2.2, co(2.2)], [2.18, 0.33], [1.92, 0.33]]);
    this._solid(comb, band(CONST(0.13), P.coreInner, 1.88, 2.24, 6));
    this._flange(comb, 2.05, 0.386, 48);
    // twenty triangular fuel-nozzle pads round the diffuser case (TTM figure)
    { const pad = new THREE.CylinderGeometry(0.024, 0.028, 0.012, 3); this._ring(comb, pad, 20, (m, th) => { m.makeRotationX(th); m.setPosition(1.955, 0.379 * Math.cos(th), 0.379 * Math.sin(th)); }, { phase: 0.157, mat: this.boltMat }); }
    const liner = A({ id: 'liner', name: 'Annular combustor liner', ex: 0.32, glow: (o) => (o.lit ? o.T4 - 520 : 300), mat: { color: 0xa39a90, metalness: 0.9, roughness: 0.5 }, desc: 'Flame tube. Only about a third of the air is burned; the rest cools the liner and dilutes the gas to a temperature the turbine can survive.', live: (o) => (o.lit ? `Flame on · fuel/air ${o.far.toFixed(4)} (φ ${o.phi.toFixed(2)}) · exit ${C(o.T4)}` : `No flame · lean limit ${o.leanLimit.toFixed(4)}`) });
    this._solid(liner, [[1.965, 0.292], [1.975, 0.303], [2.17, 0.307], [2.195, 0.292], [2.17, 0.297], [1.98, 0.293]]);
    this._solid(liner, [[1.965, 0.208], [1.975, 0.197], [2.17, 0.213], [2.195, 0.228], [2.17, 0.223], [1.98, 0.207]]);
    this._solid(liner, [[1.955, 0.2], [1.955, 0.3], [1.968, 0.3], [1.968, 0.2]]); // dome
    const hole = new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10); hole.translate(0, 0.302, 0);
    this._ring(liner, hole, 40, (m, th) => { m.makeRotationX(th); m.setPosition(2.07, 0, 0); }, { mat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }) });
    const noz = A({ id: 'fuel', name: 'Fuel manifold and 20 fuel nozzles', ex: 0.3, mat: pipeGold, desc: 'Twenty airblast nozzles spray fuel into the front of the combustor.', live: (o) => `Fuel flow ${(o.wf * 3600).toFixed(0)} kg/h · ${(o.wf * 3600 / 20).toFixed(0)} kg/h per nozzle${o.wfUnburnt > 0.001 ? ` · unburnt ${(o.wfUnburnt * 3600).toFixed(0)} kg/h` : ''}` });
    this._solid(noz, [[1.905, 0.412], [1.905, 0.436], [1.929, 0.436], [1.929, 0.412]], { seg: 96, cut: false });
    const ng = new THREE.CylinderGeometry(0.009, 0.013, 0.175, 8); ng.translate(0, 0.33, 0); ng.rotateZ(0.4); ng.translate(0.13, 0, 0); // enter at a steep angle
    this._ring(noz, ng, 20, (m, th) => { m.makeRotationX(th + 0.157 - Math.PI / 2); m.setPosition(1.94, 0, 0); }, { cut: false });
    this._pipe(noz, [[0.95, 1.02, 180], [1.2, 0.72, 182], [1.6, 0.6, 186], [1.917, 0.44, 190]], 0.012);   // stand-in: the routed metered-fuel line replaces it
    const ign = A({ id: 'ign', name: 'Igniter plugs (2)', ex: 0.3, mat: { color: 0xe6e9ec, metalness: 0.9, roughness: 0.25 }, desc: 'Two high-energy spark igniters. Only needed to light the flame; combustion is self-sustaining afterwards.', live: (o) => (o.ignOn ? 'Sparking' : 'Off') });
    const ig = new THREE.CylinderGeometry(0.011, 0.014, 0.19, 10); ig.translate(0, 0.385, 0);
    this._ring(ign, ig, 2, (m, th) => { m.makeRotationX(th - Math.PI / 2); m.setPosition(2.01, 0, 0); }, { phase: 2.4, cut: false });

    this._tagInt = false;
    // ---------------- core cowl, exhaust
    const cowl = A({ id: 'corecowl', name: 'Core cowl (inner fixed structure)', ex: 0.15, mat: composite, desc: 'Inner wall of the bypass duct, wrapped around the core engine. Remove it to see the pipework underneath.', live: (o) => `Bypass duct ${B(o.P13)} · mixing plane ${B(o.Pm)}` });
    this._solid(cowl, band(offset(P.bypInner, -0.016), P.bypInner, 0.42, 1.22, 10));
    this._solid(cowl, band(offset(P.bypInner, -0.016), P.bypInner, 2.86, 3.12, 4));
    { const barrel = band(offset(P.bypInner, -0.016), P.bypInner, 1.22, 2.86, 22), m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...composite });
      this._halfLathe(cowl, 'cd', 'L', barrel, 8 * DEG, 179.75 * DEG, m); this._halfLathe(cowl, 'cd', 'R', barrel, 180.25 * DEG, 352 * DEG, m); }
    const tec = A({ id: 'tec', name: 'Turbine exhaust case and plug', ex: 1.35, mat: { ...hotM, color: 0x9c8263 }, glow: (o) => o.T5 - 170, desc: 'Carries the rear bearing. The EGT thermocouples and the P4.9 pressure probes used for EPR sit in its struts.', live: (o) => `EGT ${C(o.egt)} · EPR ${o.epr.toFixed(3)} · core jet Mach ${o.M8.toFixed(2)}` });
    this._tagInt = true;
    this._solid(tec, [[3.0, rAt(P.coreInner, 3.0)], [3.12, 0.262], [3.12, 0.1], [3.0, 0.1]]);                                 // inner hub of the exhaust case
    this._solid(tec, [[3.12, 0.262], [3.16, 0.258], [3.5, 0.17], [3.93, 0.055], [3.95, 0.045], [3.93, 0.04], [3.5, 0.158], [3.16, 0.246], [3.12, 0.25]], { seg: 96 }); // exhaust cone: thin perforated shell, open at the rear
    this._ring(tec, new THREE.BoxGeometry(0.05, 0.004, 0.02), 13, (m, th) => { m.makeRotationX(th); m.setPosition(3.21, 0.243 * Math.cos(th), 0.243 * Math.sin(th)); }, { mat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }) }); // slots round the mounting flange
    // four struts inside the common nozzle (authored: tools/blender/details.py) (upper, lower and two side) carrying its inner duct
    { const st = bladeGeo({ span: 0.2, chord: [0.26, 0.2], stagger: [0, 0], camber: [0, 0], thick: [0.12, 0.12], nSpan: 2 });
      this._ring(cna, st, 4, (m, th) => { m.makeRotationX(th); m.setPosition(3.22, 0.46 * Math.cos(th), 0.46 * Math.sin(th)); }, { mat: this.shared.bare });
      this._solid(cna, [[3.1, 0.45], [3.1, 0.462], [3.4, 0.43], [3.4, 0.42]], { mat: this.shared.bare, seg: 96 }); }
    this._tagInt = true;
    this._solid(tec, band(CO, offset(CO, 0.02), 3.02, 3.12, 3));
    // bolt circles on the plug and the outer ring, borescope and probe bosses, rear mount lugs at the top
    { const bolt = new THREE.CylinderGeometry(0.006, 0.006, 0.014, 6); bolt.rotateZ(Math.PI / 2);
      this._ring(tec, bolt, 13, (m, th) => m.makeTranslation(3.135, 0.2 * Math.cos(th), 0.2 * Math.sin(th)), { mat: this.boltMat });
      this._ring(tec, bolt, 56, (m, th) => m.makeTranslation(3.02, (co(3.02) + 0.035) * Math.cos(th), (co(3.02) + 0.035) * Math.sin(th)), { mat: this.boltMat });
      this._solid(tec, [[3.013, co(3.02) + 0.018], [3.013, co(3.02) + 0.05], [3.027, co(3.02) + 0.05], [3.027, co(3.02) + 0.018]], { seg: 96 });
      const boss = new THREE.CylinderGeometry(0.018, 0.022, 0.03, 10);   // stand-ins for the authored bosses and ribs
      this._ring(hptCase, boss, 6, (m, th) => { m.makeRotationX(th); m.setPosition(2.3, (co(2.3) + 0.035) * Math.cos(th), (co(2.3) + 0.035) * Math.sin(th)); }, { phase: 0.4, mat: this.boltMat });
      this._ring(lptCase, boss, 8, (m, th) => { m.makeRotationX(th); m.setPosition(2.7, (co(2.7) + 0.03) * Math.cos(th), (co(2.7) + 0.03) * Math.sin(th)); }, { phase: 0.2, mat: this.boltMat });
      // stiffening ribs on both turbine cases
      for (const x of [2.28, 2.36, 2.52, 2.6, 2.7, 2.78, 2.9]) this._solid(x < 2.45 ? hptCase : lptCase, [[x - 0.004, co(x) + 0.02], [x - 0.004, co(x) + 0.034], [x + 0.004, co(x) + 0.034], [x + 0.004, co(x) + 0.02]], { seg: 96 }); }
    this._tagInt = true;
    const strut = bladeGeo({ span: 0.2, chord: [0.09, 0.09], stagger: [0, 0], camber: [0, 0], thick: [0.16, 0.16], nSpan: 2 });
    this._ring(tec, strut, 13, (m, th) => { m.makeRotationX(th); m.setPosition(3.065, 0.275 * Math.cos(th), 0.275 * Math.sin(th)); });
    this._tagInt = false;

    // ---------------- accessories and pipework
    // Gearbox and the units it drives: each is its own part. These simple shapes stand in until the
    // authored model loads (tools/blender/accessories.py builds the real ones).
    const along = (part, x0, x1, th, r, rad, mat = part.mat) => this._reg(part, new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, Math.abs(x1 - x0), 24).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, r * Math.cos(th * DEG), r * Math.sin(th * DEG)), mat));
    const kw = (w) => `${((w || 0) / 1000).toFixed(0)} kW`;
    const agb = A({ id: 'agb', name: 'Accessory gearbox', ex: -0.55, mat: castM, desc: 'Hangs under the fan case. A tower shaft from the HP spool turns the angle gearbox at the fan frame, and a lay shaft carries the drive forward to this casting, whose gears turn every accessory at a fixed ratio to N2. Mechanics turn the core by hand at the cranking pad for borescope inspections.', live: (o) => `Driven at N2 ${o.N2pct.toFixed(1)} % · accessory load ${kw(o.accPower)}` });
    { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.8), agb.mat); b.position.set(0.57, -0.975, 0); this._reg(agb, b); }
    // The accessory drive, gear by gear (tools/blender/drivetrain.py): authored only. Each gear turns from the HP
    // spool's angle at its own ratio (manifest 'spin'), so the cards read their speeds from the same numbers.
    const gr = (n) => (this.spinRatio && this.spinRatio[n]) || 0, rpmOf = (o, n) => `${Math.round(Math.abs(o.N2 * gr(n))).toLocaleString('en-GB')} rpm`;
    const gearM = { color: 0x74787d, metalness: 1, roughness: 0.28 };
    A({ id: 'igb', name: 'Internal gearbox', ex: 0, mat: gearM, desc: 'The take-off for every accessory. A spiral bevel gear splined on the front of the HP stub shaft, held by the No. 3 bearing nut, drives a 30-tooth bevel pinion at right angles, down into the 6 o\'clock strut of the intermediate case. The pinion runs in a duplex ball bearing and a roller bearing in a housing bolted to the bearing support cone, with an oil jet on the mesh. 48 teeth to 30: the tower shaft turns 1.6 times as fast as the HP spool.', live: (o) => `HP bevel gear ${rpmOf(o, 'igb_gear')} · pinion ${rpmOf(o, 'igb_pinion')}` });
    A({ id: 'tower', name: 'Tower shaft (radial drive)', ex: 0, mat: gearM, desc: 'Hollow steel shaft from the internal gearbox out to the angle gearbox on the fan case: down the 6 o\'clock strut of the intermediate case, then across the bypass duct inside the lower strut of the fan frame. Two pieces bolted together at a flange in the intermediate case, with a steady bearing there and splined ends. Small and fast, so it carries the torque with little weight.', live: (o) => `${rpmOf(o, 'tower_shaft')} · carrying ${((o.accPower || 0) / 1000).toFixed(0)} kW to the accessories` });
    A({ id: 'angb', name: 'Angle gearbox', ex: -0.3, mat: castM, desc: 'Small gearbox on the fan case at 6 o\'clock. A spiral bevel pair turns the drive from the tower shaft through a right angle into the lay shaft, 31 teeth to 41. For a start it works the other way, carrying the starter\'s torque back to the core. Chip detector at its low point.', live: (o) => `Tower gear ${rpmOf(o, 'angb_gear1')} · lay gear ${rpmOf(o, 'angb_gear2')}` });
    A({ id: 'layshaft', name: 'Lay shaft (horizontal drive)', ex: -0.4, mat: castM, desc: 'Quill shaft from the angle gearbox forward into the rear face of the main gearbox, inside a flanged housing. A flexible diaphragm coupling takes up misalignment as the fan case and gearbox move. Turns at 1.21 times N2.', live: (o) => rpmOf(o, 'layshaft_shaft') });
    A({ id: 'agbtrain', name: 'Main gearbox gear train', ex: -0.55, mat: gearM, desc: 'Two planes of spur gears inside the gearbox casting, which is split at mid-depth. The lay shaft drives a 20-tooth gear in the rear plane; idlers carry the drive round to the scavenge pumps, fuel pump, hand-cranking pad and the starter / IDG gearshaft, whose second gear drives the front plane: oil pressure pump, hydraulic pump and dedicated alternator. Each accessory turns at a fixed ratio to N2, set by tooth counts (estimated: IAE does not publish them). Open the cutaway, or take the gearbox casing off, to watch it run.', live: (o) => `IDG and starter ${rpmOf(o, 'agbtrain_si')} · hydraulic pump ${rpmOf(o, 'agbtrain_hyd')} · fuel pump ${rpmOf(o, 'agbtrain_fuel')} · alternator ${rpmOf(o, 'agbtrain_pma')} · oil pump ${rpmOf(o, 'agbtrain_oil')}` });
    const starter = A({ id: 'starter', name: 'Air turbine starter', ex: -0.85, mat: castM, desc: 'Air from the APU, a ground cart or the other engine spins a small turbine at high speed; a reduction gear and an overrunning clutch turn the HP spool through the gearbox. The start valve closes at about 43 % N2 and the clutch freewheels from then on.', live: (o) => (o.starterAir ? (o.tStart > 1 ? `Driving: ${o.tStart.toFixed(0)} N·m at the spool · duct ${(o.starterPsi || 0).toFixed(0)} psi` : `Air on, starter run out: no torque left at N2 ${o.N2pct.toFixed(1)} %`) : 'Freewheeling (no air)') });
    along(starter, 0.087, 0.36, 196, 0.975, 0.085);
    const sav = A({ id: 'sav', name: 'Starter air valve', ex: -0.55, mat: castM, desc: 'Butterfly valve in the starter duct. The EEC energises its solenoid and duct pressure opens it. If it will not open, a mechanic can turn it with a wrench through an access panel in the right fan cowl while the crew runs the start.', live: (o, f) => `${f && f.valveOpen ? 'OPEN' : 'CLOSED'} · duct ${(o.starterPsi || 0).toFixed(0)} psi` });
    along(sav, 0.42, 0.568, 222, 0.955, 0.065);
    const idg = A({ id: 'idg', name: 'Integrated drive generator (IDG)', ex: -0.3, mat: castM, desc: 'A constant-speed drive and a generator in one oil-filled case: the drive turns the varying gearbox speed into a steady 12,000 rpm, so the aircraft gets 115 V at 400 Hz. Rated 90 kVA. The crew can disconnect it from the gearbox if it overheats; it can only be reconnected on the ground.', live: (o) => (o.N2pct > 55 ? `On line: 115 V · 400 Hz · drive input N2 ${o.N2pct.toFixed(1)} %` : `Off line: below idle (N2 ${o.N2pct.toFixed(1)} %)`) });
    along(idg, 0.78, 1.14, 198, 0.978, 0.085);
    const hydpump = A({ id: 'hydpump', name: 'Engine-driven hydraulic pump', ex: -0.85, mat: castM, desc: 'Variable-displacement piston pump that holds an aircraft hydraulic system at 3,000 psi (green on engine 1, yellow on engine 2); the thrust reverser runs on it. The crew can depressurise it from the cockpit. Its load and the generator\'s are the power off-take below.', live: (o) => (o.N2pct > 20 ? `About 3,000 psi · driven at N2 ${o.N2pct.toFixed(1)} %` : `Building pressure · N2 ${o.N2pct.toFixed(1)} %`) });
    along(hydpump, 0.15, 0.36, 172, 0.975, 0.065);
    const fuelpump = A({ id: 'fuelpump', name: 'Fuel pump', ex: -0.3, mat: chromM, desc: 'Two stages on one shaft. A centrifugal low-pressure stage lifts fuel from the aircraft tanks and sends it through the fuel-cooled oil cooler and the LP filter; a gear high-pressure stage then delivers more than the engine can use to the metering unit, which spills the surplus back. Delivery shown is an estimate (flow in proportion to N2).', live: (o) => { const d = 9000 * o.N2pct / 100, wf = o.wf * 3600; return `Delivery ≈ ${d.toFixed(0)} kg/h · burned ${wf.toFixed(0)} · spilled back ≈ ${Math.max(0, d - wf).toFixed(0)} kg/h`; } });
    along(fuelpump, 0.78, 0.975, 166, 0.97, 0.075);
    const fmu = A({ id: 'fmu', name: 'Fuel metering unit (FMU)', ex: -0.3, mat: chromM, desc: 'Meters fuel to the nozzles as the EEC commands: a torque motor positions the metering valve and a position sensor reports back to both EEC channels. It shuts the fuel off when the master switch goes off, and sends servo fuel to the stator vane, bleed and clearance-control actuators.', live: (o) => `Metered ${(o.wf * 3600).toFixed(0)} kg/h · shut-off valve ${o.wf > 1e-4 ? 'open' : 'shut'}` });
    { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.14), fmu.mat); b.position.set(1.066, 0.97 * Math.cos(166 * DEG), 0.97 * Math.sin(166 * DEG)); b.rotation.x = 166 * DEG; this._reg(fmu, b); }
    const oilpump = A({ id: 'oilpump', name: 'Oil pump and scavenge filter', ex: -0.85, mat: chromM, desc: 'One pressure element and several scavenge elements on a common shaft. The pressure stage feeds the bearings; the scavenge stages pull the oil back out of the bearing chambers and gearboxes, through the scavenge filter and the chip detectors, to the tank. There is no pressure regulator, so pressure follows N2.', live: (o) => `Oil ${(o.oilP || 0).toFixed(0)} psi · filter ΔP ${(o.oilFilterDp || 0).toFixed(1)} psi · ${(o.oilT || 0).toFixed(0)} °C` });
    along(oilpump, 0.214, 0.36, 160, 0.975, 0.06); along(oilpump, 0.78, 0.995, 154, 0.95, 0.059);
    const pma = A({ id: 'pma', name: 'Dedicated alternator', ex: -0.85, mat: castM, desc: 'Permanent-magnet alternator that powers the EEC by itself once the core turns above about 10 % N2, so engine control does not depend on the aircraft electrical system. Below that the aircraft supplies the EEC.', live: (o) => (o.N2pct > 10 ? `Powering the EEC (N2 ${o.N2pct.toFixed(1)} %)` : 'EEC on aircraft power') });
    along(pma, 0.255, 0.36, 183, 0.99, 0.045);
    const oiltank = A({ id: 'oiltank', name: 'Oil tank', ex: -0.55, mat: castM, desc: 'Holds 25 US quarts usable. Oil coming back from the scavenge pumps passes a de-aerator inside the tank. The level shows on the sight glass and on the ECAM through a quantity transmitter. Several quarts are always out round the system while the engine runs, so the level drops after start and recovers after shutdown.', live: (o) => `Quantity ${(o.oilQ || 0).toFixed(1)} qt · ${(o.oilT || 0).toFixed(0)} °C` });
    { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.36, 24), oiltank.mat); t.position.set(0.52, 0.925 * Math.cos(133.5 * DEG), 0.925 * Math.sin(133.5 * DEG)); t.rotation.x = 133.5 * DEG + Math.PI / 2; this._reg(oiltank, t); }
    const eec = A({ id: 'eec', name: 'Electronic engine control (FADEC)', ex: -0.55, mat: { color: 0x15181b, metalness: 0.3, roughness: 0.5 }, desc: 'Dual-channel computer on the fan case. Sets fuel flow, stator angle and bleed valves, and protects the engine limits.', live: () => '' });
    const eb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.3), eec.mat); eb.position.set(0.55, -0.62, -0.84); eb.rotation.x = 0.94; this._reg(eec, eb);
    const ext = A({ id: 'ext', name: 'External pipework and harnesses', ex: 0.1, mat: pipeSteel, desc: 'Fuel, oil, bleed-air and cooling pipes and the electrical harnesses that dress the core. Visible with the core cowl removed.', live: (o) => `Turbine cooling ${o.Wcool.toFixed(1)} kg/s · handling bleed ${(o.Wb7 + o.Wb10).toFixed(1)} kg/s · clearance control ${(100 * (o.accH || 0)).toFixed(0)} / ${(100 * (o.accL || 0)).toFixed(0)} % (+${(100 * ((o.accEff || [0])[0])).toFixed(1)} pt HPT)` });
    const dress = (ob) => { ob.userData.tag = 'dress'; return ob; }; // fallback pipework, replaced by the routed dressing in the authored model
    const run = (th, r0, mat, rad, x0 = 1.15, x1 = 2.9, wob = 6) => dress(this._pipe(ext, Array.from({ length: 9 }, (_, i) => { const f = i / 8, x = lerp(x0, x1, f); return [x, co(x) + r0 + 0.012 * Math.sin(f * 9 + th), th + wob * Math.sin(f * 5 + th * 0.1)]; }), rad, mat));
    [[130, 0.075, pipeSteel, 0.011], [150, 0.07, pipeGold, 0.008], [172, 0.085, harness, 0.013, 0.5], [200, 0.07, pipeSteel, 0.016, 1.5, 2.7], [225, 0.075, harness, 0.009], [246, 0.08, pipeSteel, 0.01], [268, 0.07, pipeGold, 0.007, 1.3, 2.2], [292, 0.085, pipeSteel, 0.014, 1.6, 3.0], [316, 0.07, harness, 0.011, 0.5], [338, 0.075, pipeSteel, 0.009]].forEach((a) => run(...a));
    // turbine case cooling manifolds (active clearance control): a cage of tube rings round the LPT
    for (let k = 0; k < 20; k++) { const x = 2.25 + k * 0.038, rr = co(x) + 0.05; dress(this._solid(ext, [[x - 0.0045, rr], [x - 0.0045, rr + 0.009], [x + 0.0045, rr + 0.009], [x + 0.0045, rr]], { seg: 72, mat: pipeSteel })); }
    for (const th of [200, 290]) dress(this._pipe(ext, Array.from({ length: 7 }, (_, i) => { const x = 2.24 + i * 0.125; return [x, co(x) + 0.075, th]; }), 0.016, pipeSteel));
    for (const th of [150, 240, 330]) dress(this._pipe(ext, Array.from({ length: 6 }, (_, i) => { const x = 2.3 + i * 0.135; return [x, co(x) + 0.09, th]; }), 0.014, pipeSteel));
    // a pigtail from the fuel manifold to every nozzle
    this._tagInt = true; for (let k = 0; k < 20; k++) { const th = k * 18 + 9; this._pipe(noz, [[1.917, 0.43, th], [1.892, 0.468, th + 3], [1.862, 0.452, th + 6.5], [1.878, 0.405, th + 8]], 0.0045); } this._tagInt = false;
    // more pipe runs: oil feed and scavenge, cooling air, sense lines
    [[118, 0.1, pipeGold, 0.006, 1.2, 2.1, 3], [139, 0.098, pipeSteel, 0.007, 1.5, 2.95, 4], [160, 0.1, harness, 0.008, 0.6, 2.6, 3], [186, 0.095, pipeSteel, 0.012, 1.2, 2.4, 2], [212, 0.1, pipeGold, 0.006, 1.7, 2.9, 5],
     [236, 0.098, pipeSteel, 0.008, 0.7, 2.2, 4], [257, 0.1, harness, 0.007, 1.2, 3.0, 3], [280, 0.098, pipeSteel, 0.009, 0.6, 1.9, 4], [304, 0.1, pipeGold, 0.007, 1.9, 3.0, 3], [327, 0.098, harness, 0.01, 1.2, 2.5, 4], [346, 0.1, pipeSteel, 0.006, 0.9, 2.8, 5]].forEach((a) => run(...a));
    // brackets holding the pipework off the cases
    { const pts = []; for (let th = 118; th < 350; th += 13) for (const x of [1.3, 1.62, 1.95, 2.3, 2.66, 2.92]) if (((th * 7 + x * 31) | 0) % 3 !== 0) pts.push([x, th]);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.07, 0.012), pipeSteel, pts.length), mm = new THREE.Matrix4();
      pts.forEach(([x, th], i) => { mm.makeRotationX(th * DEG - Math.PI / 2); const r = co(x) + 0.055; mm.setPosition(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); im.setMatrixAt(i, mm); });
      dress(this._reg(ext, im)); }
    for (const x of [1.45, 2.0, 2.55]) dress(this._solid(ext, [[x - 0.005, co(x) + 0.095], [x - 0.005, co(x) + 0.103], [x + 0.005, co(x) + 0.103], [x + 0.005, co(x) + 0.095]], { seg: 96, mat: harness })); // clamps
    this._tagInt = true;
    // oil feed, scavenge and vent pipes to the bearing compartments, run through struts at the bottom of the engine
    for (const [pts, rad, mt] of [
      [[[0.98, 0.17, 180], [0.98, 0.3, 180], [0.985, 0.44, 180], [0.95, 0.56, 181], [0.85, 0.66, 182]], 0.009, pipeSteel], [[[1.028, 0.17, 180], [1.028, 0.3, 180], [1.025, 0.46, 181], [1.0, 0.58, 183]], 0.011, pipeGold],
      // No. 4 bearing: in through the inner case and a pre-diffuser strut (144 and 162 deg), so clear of the flame
      [[[2.06, 0.135, 144], [2.0, 0.165, 144], [1.94, 0.18, 144], [1.905, 0.215, 144], [1.9, 0.3, 144], [1.885, 0.4, 147], [1.8, 0.44, 158], [1.6, 0.42, 168]], 0.008, pipeSteel],
      [[[2.09, 0.135, 162], [2.03, 0.168, 162], [1.95, 0.181, 162], [1.908, 0.215, 162], [1.902, 0.3, 162], [1.89, 0.4, 163], [2.0, 0.445, 165], [2.3, 0.44, 166]], 0.011, pipeGold],
      // No. 5 bearing: out through exhaust-case struts 7 and 8
      [[[3.06, 0.105, 166.15], [3.07, 0.2, 166.15], [3.072, 0.3, 166.15], [3.07, 0.47, 168], [2.9, 0.54, 176], [2.5, 0.5, 182]], 0.008, pipeSteel], [[[3.07, 0.105, 193.85], [3.075, 0.3, 193.85], [3.07, 0.47, 194], [2.85, 0.53, 194]], 0.01, pipeGold]]) this._pipe(brg, pts, rad, mt);
    this._tagInt = false;
    this._tagInt = true;   // stand-ins for tools/blender/details.py
    // EGT thermocouples in the exhaust case struts (about 2, 4.30, 7.30 and 9.30 o'clock) with their harness ring
    for (const th of [60, 135, 225, 285]) { const pr = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), pipeSteel), r = co(3.07) + 0.05; pr.position.set(3.07, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); pr.rotation.x = th * DEG; const o2 = this._reg(tec, pr); if (inCut(th * DEG)) o2.userData.variant = 'full'; }
    this._pipe(tec, Array.from({ length: 22 }, (_, i) => [3.1, co(3.1) + 0.085, 118 + i * 11]), 0.007, harness);
    this._tagInt = false;
    // thrust reverser drag links: one per blocker door, from the core cowl across the duct to the door. They pull the doors down as the sleeve slides aft.
    { const g = new THREE.CylinderGeometry(0.008, 0.008, 1, 8), mk = (ths) => { const im = new THREE.InstancedMesh(g, pipeSteel, ths.length); im.userData.ths = ths; return im; };
      const all = Array.from({ length: 10 }, (_, k) => (k * 36 + 18) * DEG);
      const L = all.filter((t) => t < Math.PI), R = all.filter((t) => t > Math.PI);
      this.dragLinks = [mk(L.filter((t) => !inCut(t))), mk(L.filter((t) => inCut(t))), mk(R)];
      this.dragLinks[1].userData.variant = 'full';
      this.dragLinks.forEach((im, i) => this._into(this._hingeInner(this.byId.cna, 'cd', i < 2 ? 'L' : 'R'), this.byId.cna, im)); }
    this._tagInt = true;
    // P4.9 pressure rakes in three exhaust-case struts, joined by a small-bore manifold
    for (const k of [4, 7, 10]) { const th = ((k - 1) * 360) / 13, rk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 8), pipeGold); onCore(tec, rk, 3.03, th, 0.37); } // struts 4, 7 and 10
    this._pipe(tec, Array.from({ length: 16 }, (_, i) => [3.0, co(3.0) + 0.07, 120 + i * 15]), 0.004, pipeGold);
    this._tagInt = false;
    // lower and upper bifurcations: the walls where the two C-ducts meet, splitting the bypass duct at 6 and 12 o'clock
    { const bi = (th, full) => { const sh = new THREE.Shape(); const xs = full ? [1.22, 1.32, 3.06, 3.12] : [1.22, 1.32, 2.6, 2.86];   // the upper one runs aft over the aft mount sh.moveTo(xs[0], rAt(P.bypInner, xs[0])); sh.lineTo(xs[1], rAt(P.bypOuter, xs[1]) - 0.004); sh.lineTo(xs[2], rAt(P.bypOuter, xs[2]) - 0.004); sh.lineTo(xs[3], rAt(P.bypInner, xs[3]) + 0.02); sh.lineTo(2.4, rAt(P.bypInner, 2.4)); sh.lineTo(1.6, rAt(P.bypInner, 1.6)); sh.lineTo(xs[0], rAt(P.bypInner, xs[0]));
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.045, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }); g.translate(0, 0, -0.0225);
        const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ ...composite, side: THREE.DoubleSide })); m.rotation.x = th * DEG; const o2 = this._into(this._hingeInner(cna, 'cd', th < 180 ? 'L' : 'R'), cna, m); if (full) o2.userData.variant = 'full'; (this._genBifur ||= []).push(m); };
      bi(178.4, false); bi(181.6, false); bi(4, true); bi(356, true); }
    // fire detection: two sensing loops clipped side by side round the core, and the nacelle temperature sensor
    for (const dx of [0, 0.012]) dress(this._pipe(ext, Array.from({ length: 40 }, (_, i) => { const f = i / 39; return [1.45 + dx + 1.3 * f, co(1.45 + 1.3 * f) + 0.125, 122 + 226 * (0.5 - 0.5 * Math.cos(f * Math.PI * 3))]; }), 0.003, pipeGold));
    for (const [x, th] of [[1.6, 262], [1.6, 302], [1.8, 282], [1.6, 128]]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.9 })); const r = rAt(P.bypInner, x) + 0.004; h.position.set(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); h.rotation.x = th * DEG; this._into(this._hingeInner(this.byId.corecowl, 'cd', th < 180 ? 'L' : 'R'), this.byId.corecowl, h); }
    // ---- core units placed from the component-location manual. Each is a part of its own; these simple shapes
    // stand in until the authored model loads (tools/blender/core_units.py builds the real ones).
    { const unit = (part, geo, mat, x, th, r) => onCore(part, new THREE.Mesh(geo, mat), x, th, r);
      const exciters = A({ id: 'exciters', name: 'Ignition exciters', ex: 0.1, mat: chromM, desc: 'Two capacitor-discharge units on the HP compressor case. Each turns 115 V AC into high-voltage pulses, one or two a second, and sends them down a shielded lead to its igniter plug. On automatic starts the EEC uses them in turn, so a dead one shows up on alternate starts.', live: (o, f) => (o.ignOn ? `Sparking: igniter ${(f && f.ignSel) || 'A+B'}` : 'Off') });
      for (const th of [222, 240]) unit(exciters, new THREE.BoxGeometry(0.18, 0.06, 0.094), exciters.mat, 1.55, th, co(1.55) + 0.075);
      const vsvact = A({ id: 'vsvact', name: 'VSV actuator', ex: 0.05, mat: chromM, desc: 'A ram worked by fuel pressure from the FMU turns the crank shaft, and four links turn the unison rings: the inlet guide vanes and the first three stator rows of the HP compressor close at low speed, keeping the front stages out of stall, and open as N2 rises. A position sensor reports back to the EEC.', live: (o) => `Vanes ${o.vsv.toFixed(1)}° shut · schedule ${o.vsvSched.toFixed(1)}°` });
      unit(vsvact, new THREE.CylinderGeometry(0.034, 0.034, 0.165, 16).rotateZ(Math.PI / 2), vsvact.mat, 1.25, 138, 0.43);
      unit(vsvact, new THREE.CylinderGeometry(0.01, 0.01, 0.29, 8).rotateZ(Math.PI / 2), pipeSteel, 1.26, 150, 0.398);
      const fdv = A({ id: 'fdv', name: 'Fuel distribution valve', ex: 0.3, mat: chromM, desc: 'Takes the metered fuel from the FMU and shares it between the ten pigtails that feed the fuel manifold and its twenty nozzles. It closes when the pressure falls, so the manifold does not drain through the nozzles after shutdown.', live: (o) => `${(o.wf * 3600).toFixed(0)} kg/h in · ${(o.wf * 360).toFixed(0)} kg/h per outlet` });
      unit(fdv, new THREE.CylinderGeometry(0.05, 0.05, 0.085, 16).rotateZ(Math.PI / 2), fdv.mat, 1.82, 318, co(1.86) + 0.13);
      const accvalves = A({ id: 'accvalves', name: 'Clearance control valves', ex: 0.1, mat: castM, desc: 'Two butterfly valves let fan air through to the spray rings on the HP and LP turbine cases, worked by a fuel-pressure actuator on the EEC\'s command. Opened in climb and cruise, they cool the cases so they shrink onto the blade tips and less gas leaks past.', live: (o) => `HPT ${(100 * (o.accH || 0)).toFixed(0)} % · LPT ${(100 * (o.accL || 0)).toFixed(0)} % open` });
      for (const [th, rr] of [[236, 0.045], [250, 0.05]]) unit(accvalves, new THREE.CylinderGeometry(rr, rr, 0.24, 18).rotateZ(Math.PI / 2), accvalves.mat, 2.2, th, 0.465);
      unit(accvalves, new THREE.BoxGeometry(0.12, 0.06, 0.076), pipeGold, 2.12, 286, co(2.12) + 0.14);
      const acac = A({ id: 'acac', name: 'Buffer air cooler', ex: 0.15, mat: castM, desc: 'Air-to-air heat exchanger: fan air from a scoop in the core cowl cools air taken from the HP compressor before it pressurises the seals of the No. 4 bearing chamber, so the hot air does not cook the oil there.', live: (o) => `Compressor air in at ${(o.T3 - 273.15).toFixed(0)} °C` });
      unit(acac, new THREE.BoxGeometry(0.24, 0.07, 0.14), acac.mat, 2.34, 152, 0.465);
      const egtbox = A({ id: 'egtbox', name: 'EGT junction box', ex: 0.6, mat: chromM, desc: 'Joins the leads from the thermocouples in the exhaust case struts. Their average is the exhaust gas temperature the EEC limits and the crew watch on the ECAM.', live: (o) => `EGT ${(o.egt - 273.15).toFixed(0)} °C` });
      unit(egtbox, new THREE.BoxGeometry(0.12, 0.03, 0.084), egtbox.mat, 2.64, 186, 0.487);
      A({ id: 'mounts', name: 'Engine mounts', ex: 0, mat: castM, desc: 'Forward mount on the intermediate case, at the top: a beam bolted to the pylon, a cross beam, two thrust links down to the engine and a support bearing on the engine\'s forward support shaft. It carries the thrust and the vertical and side loads. Aft mount on the turbine exhaust case: the pylon\'s aft adaptor on a curved beam, hung from the case lugs by two side links and a centre link. It carries torque and the vertical and side loads, and lets the engine grow lengthwise with heat. Shown with the cutaway closed (remove the pylon to see them).', live: (o) => `Thrust carried ${(o.thrust / 1000).toFixed(1)} kN` });
      // ---- pipes, ducts and harnesses exported from the model as parts of their own (tools/blender/dressing.py).
      // They have no stand-in shapes: they appear when the authored model loads, and each can be broken from its card.
      const LINE = (k, name, ex, desc, live) => A({ id: `line_${k}`, name, ex, mat: pipeSteel, desc, live: live || (() => '') });
      const kgh = (o) => `${(o.wf * 3600).toFixed(0)} kg/h`;
      LINE('p3servo', 'P3 servo air lines', 0.1, 'Small steel tubes carrying compressor delivery air (P3) from the solenoid valves on the fan case, down the lower strut, to the handling bleed valves on the HP compressor, which it works.', (o) => `Stage 7 bleeds ${o.Wb7 > 0.05 ? 'open' : 'shut'} · stage 10 ${o.Wb10 > 0.05 ? 'open' : 'shut'}`);
      LINE('acocoil', 'Air-cooled oil cooler lines', -0.55, 'Oil to and from the air-cooled oil cooler at the top of the fan case, where fan air takes heat out of the engine oil.', (o) => `Oil ${(o.oilT || 0).toFixed(0)} °C`);
      LINE('antiice', 'Nacelle anti-ice duct', -0.55, 'Carries hot HP compressor air forward round the fan case, through the anti-ice valve at 2 o\'clock, to the inlet lip.');
      LINE('starterduct', 'Starter air duct', -0.55, 'Brings air from the APU, a ground cart or the other engine down from the pylon, round the back of the fan case and through the starter air valve to the starter.', (o) => (o.starterAir ? `Air to the starter at ${o.starterPsi.toFixed(0)} psi` : 'No air flowing'));
      LINE('hyd', 'Hydraulic lines', -0.55, 'Suction, pressure and case drain lines between the engine-driven pump and the fluid panel at the top of the fan case, where they join the aircraft\'s green system.');
      LINE('fuelsupply', 'Fuel supply lines', -0.55, 'Fuel from the aircraft tanks, through the LP valve in the pylon, down the left side of the fan case to the fuel pump.', kgh);
      LINE('fcoc', 'Fuel-cooled oil cooler lines', -0.55, 'All the engine\'s fuel passes the fuel-cooled oil cooler and LP filter on its way to the HP pump, picking up heat from the oil on the way.', (o) => `${kgh(o)} · oil ${(o.oilT || 0).toFixed(0)} °C`);
      LINE('oilpress', 'Oil pressure sense line', -0.55, 'Thin line from the oil pump to the pressure transmitter and low-pressure switch whose readings go to the ECAM.', (o) => `Oil pressure ${(o.oilP || 0).toFixed(0)} psi`);
      LINE('idgcooler', 'IDG oil cooler lines', -0.55, 'Oil from the drive generator round the back of the gearbox to its own cooler and back.');
      LINE('servofuel', 'Servo fuel lines', 0.1, 'High-pressure fuel from the FMU that works the actuators on the core: the stator ram and the clearance control valves.', (o) => `Stators ${o.vsv.toFixed(1)}° shut`);
      LINE('meteredfuel', 'Metered fuel line', 0.1, 'Carries the fuel the FMU has metered down the lower strut and round the core to the fuel distribution valve.', kgh);
      LINE('no4oil', 'No. 4 bearing oil lines', 0.1, 'Feed and scavenge for the No. 4 bearing chamber under the combustor, the hottest bearing in the engine.', (o) => `Oil pressure ${(o.oilP || 0).toFixed(0)} psi`);
      LINE('harnessA', 'Core harness, channel A', 0.1, 'Electrical harness carrying channel A of the EEC to the sensors and actuators on the core.');
      LINE('harnessB', 'Core harness, channel B', 0.1, 'Electrical harness carrying channel B of the EEC to the sensors and actuators on the core.');
      LINE('htleadA', 'Ignition lead A', 0.1, 'Shielded high-tension lead from exciter A to its igniter plug on the diffuser case.', (o, f) => (o.ignOn && f && /A/.test(f.ignSel) ? 'Sparking' : 'Off'));
      LINE('htleadB', 'Ignition lead B', 0.1, 'Shielded high-tension lead from exciter B, over the top of the core, to its igniter plug.', (o, f) => (o.ignOn && f && /B/.test(f.ignSel) ? 'Sparking' : 'Off'));
      LINE('egtharness', 'EGT harness', 0.4, 'Carries the averaged thermocouple signal from the junction box forward to the EEC.', (o) => (Number.isFinite(o.egtInd ?? o.egt) ? `EGT ${((o.egtInd ?? o.egt) - 273.15).toFixed(0)} °C` : 'EGT XX'));
      LINE('bleed7', 'IP bleed duct (stage 7)', 0.1, 'Takes air from stage 7 of the HP compressor, through a check valve, up the upper bifurcation to the aircraft\'s bleed system (cabin, packs, wing anti-ice).');
      LINE('bleed10', 'HP bleed duct (stage 10)', 0.1, 'Takes hotter air from stage 10 through the HP valve when stage 7 cannot supply enough, at low power.');
      LINE('accduct', 'Clearance control ducts', 0.6, 'Short ducts from the clearance control valves to the collector rings of the turbine case spray manifolds.', (o) => `HPT ${(100 * (o.accH || 0)).toFixed(0)} % · LPT ${(100 * (o.accL || 0)).toFixed(0)} %`);
      LINE('bufferair', 'Buffer air duct', 0.3, 'HP compressor air to the buffer air cooler, then on to pressurise the seals of the No. 4 bearing chamber.');
      // high-pressure bleed valve low on the left
      this._tagInt = true; unit(hpcCase, new THREE.CylinderGeometry(0.05, 0.05, 0.14, 18).rotateZ(Math.PI / 2), pipeGold, 1.86, 140, co(1.86) + 0.13); this._tagInt = false;   // stand-in: the routed stage 10 duct carries the HP valve
      // fuel manifold pigtails from the distribution valve
      for (let k = 0; k < 10; k++) dress(this._pipe(ext, [[1.86, co(1.86) + 0.13 + 0.03 * Math.cos(k * 0.63), 318 + 4 * Math.sin(k * 0.63)], [1.9, 0.47, 318 + (k - 4.5) * 3], [1.917, 0.44, 318 + (k - 4.5) * 7]], 0.004, pipeSteel));
    }
    // ---- upper half of the core. This is the sector the cutaway removes, so it is only shown with the cutaway closed.
    const top = (ob) => { ob.userData.variant = 'full'; return ob; };
    const runT = (...a) => top(run(...a));
    [[-6, 0.078, pipeSteel, 0.011, 1.2, 2.9, 4], [6, 0.1, harness, 0.012, 0.5, 2.6, 3], [17, 0.075, pipeGold, 0.007, 1.3, 2.3, 5], [28, 0.098, pipeSteel, 0.009, 0.7, 2.95, 4], [39, 0.078, pipeSteel, 0.014, 1.5, 2.7, 3],
     [50, 0.1, pipeGold, 0.006, 1.2, 2.1, 5], [61, 0.075, harness, 0.01, 0.6, 2.9, 3], [72, 0.098, pipeSteel, 0.008, 1.7, 3.0, 4], [83, 0.078, pipeSteel, 0.012, 1.2, 2.5, 3], [94, 0.1, harness, 0.008, 0.9, 2.8, 4], [105, 0.075, pipeGold, 0.007, 1.4, 2.4, 5]].forEach((a) => runT(...a));
    for (const th of [30, 90]) dress(top(this._pipe(ext, Array.from({ length: 6 }, (_, i) => { const x = 2.3 + i * 0.135; return [x, co(x) + 0.09, th]; }), 0.014, pipeSteel)));
    // bleed air: stage 7 and stage 10 ducts rise from the HPC case, join at the pressure regulating valve and run up into the pylon
    const duct = new THREE.MeshStandardMaterial({ color: 0xb9bdc0, metalness: 1, roughness: 0.32, roughnessMap: T.brushed });
    dress(top(this._pipe(ext, [[1.62, co(1.62) + 0.03, 38], [1.6, 0.46, 34], [1.5, 0.6, 24], [1.35, 0.72, 14], [1.2, 0.86, 8], [1.12, 0.98, 6]], 0.045, duct)));
    dress(top(this._pipe(ext, [[1.8, co(1.8) + 0.03, -32], [1.78, 0.44, -28], [1.68, 0.56, -18], [1.5, 0.66, -4], [1.4, 0.7, 8]], 0.034, duct)));
    dress(top(this._pipe(ext, [[0.9, 0.97, -4], [1.3, 0.8, -6], [1.9, 0.6, -10], [2.5, 0.52, -8]], 0.016, harness)));                              // main harness trunk
    for (const [x, th, rr, l] of [[1.5, 24, 0.062, 0.16], [1.66, -17, 0.05, 0.13], [1.3, 12, 0.07, 0.12]]) {                                // bleed valves and the precooler inlet flange
      const v = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, l, 20).rotateZ(Math.PI / 2), duct), r = x < 1.4 ? 0.76 : x < 1.6 ? 0.6 : 0.57;
      v.position.set(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); dress(top(this._reg(ext, v)));
      const act = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), harness); act.position.set(x, (r + rr + 0.035) * Math.cos(th * DEG), (r + rr + 0.035) * Math.sin(th * DEG)); act.rotation.x = th * DEG; dress(top(this._reg(ext, act)));
    }
    { const pts = []; for (let th = -8; th < 112; th += 13) for (const x of [1.3, 1.62, 1.95, 2.3, 2.66, 2.92]) if (((th * 7 + x * 31 + 400) | 0) % 3 !== 0) pts.push([x, th]);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.07, 0.012), pipeSteel, pts.length), mm = new THREE.Matrix4();
      pts.forEach(([x, th], i) => { mm.makeRotationX(th * DEG - Math.PI / 2); const r = co(x) + 0.055; mm.setPosition(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG)); im.setMatrixAt(i, mm); });
      dress(top(this._reg(ext, im))); }
    // pylon the engine hangs from
    const pylon = A({ id: 'pylon', name: 'Pylon', ex: 0, mat: paint, desc: 'Carries the engine under the wing and transmits its thrust to the airframe. Fuel, bleed air, electrical and hydraulic lines run through it.', live: (o) => `Thrust carried ${(o.thrust / 1000).toFixed(1)} kN` });
    { const sh = new THREE.Shape(); sh.moveTo(0.35, 0.98); sh.lineTo(0.2, 1.32); sh.lineTo(3.0, 1.32); sh.lineTo(2.8, 1.02); sh.lineTo(2.2, 0.9); sh.lineTo(0.35, 0.98);
      this._reg(pylon, new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 }).translate(0, 0, -0.1), pylon.mat)); }
    // heat discolouration on everything downstream of the combustor
    heatTint(this.byId.hptcase.mat, 2.0, 2.5, 0.9); heatTint(this.byId.lptcase.mat, 2.3, 3.1, 0.9); heatTint(this.byId.tec.mat, 2.7, 3.5, 1.0);
    heatTint(this.byId.hpt.mat, 2.0, 2.45, 0.8); heatTint(this.byId.lpt.mat, 2.3, 3.05, 0.7); heatTint(this.byId.combcase.mat, 1.75, 2.6, 0.5); heatTint(this.byId.liner.mat, 1.9, 2.25, 0.9);
    this.byId.hpc.mat.roughness = 0.46;
    // ---- surface finishes (app/surfaces.js): every material gets wear, grime, heat and relief to match the photos
    {
      const H = (preset, heat, soot) => ({ ...preset, ...(heat ? { heat } : {}), ...(soot ? { soot } : {}) });
      const byPart = {
        inlet: FINISH.nacellePaint, fancowl: FINISH.nacellePaint, cna: FINISH.nacellePaint, pylon: FINISH.nacellePaint, lip: FINISH.polished,
        fancase: FINISH.castPaint, lpccase: FINISH.castPaint, hpccase: FINISH.castPaint, agb: FINISH.castBare, eec: FINISH.darkBox,
        starter: FINISH.castBare, sav: FINISH.castBare, idg: FINISH.castBare, hydpump: FINISH.castBare, pma: FINISH.castBare, oiltank: FINISH.castBare, fuelpump: FINISH.chromate, fmu: FINISH.chromate, oilpump: FINISH.chromate,
        exciters: FINISH.chromate, vsvact: FINISH.chromate, fdv: FINISH.chromate, accvalves: FINISH.castBare, acac: FINISH.castBare, egtbox: FINISH.chromate, mounts: FINISH.castBare,
        spinner: { ...FINISH.darkBox, bottom: 0, grime: 0.08 }, fan: FINISH.titanium, lpc: FINISH.compressorBlade, hpc: FINISH.compressorBlade,
        hpt: H(FINISH.turbineBlade, [2.0, 2.45, 0.8]), lpt: H(FINISH.turbineBlade, [2.3, 3.05, 0.7]),
        hptcase: H(FINISH.hotCase, [2.0, 2.5, 0.9]), lptcase: H(FINISH.hotCase, [2.3, 3.1, 0.9]), combcase: H(FINISH.hotCase, [1.75, 2.6, 0.5]),
        liner: H(FINISH.hotCase, [1.9, 2.25, 0.9]), tec: H(FINISH.hotCase, [2.7, 3.5, 1.0], [3.15, 3.95, 0.7]),
        lpshaft: { ...FINISH.bareSteel, bottom: 0 }, hpshaft: { ...FINISH.bareSteel, bottom: 0 }, bearings: FINISH.bareSteel,
        corecowl: FINISH.acoustic, fuel: FINISH.stainlessTube, ign: FINISH.darkBox, ext: FINISH.stainlessTube,
      };
      const coreHeat = [2.0, 2.9, 0.45];
      const byMat = new Map([
        [pipeSteel, H(FINISH.stainlessTube, coreHeat)], [pipeGold, FINISH.cadmium], [unitGrey, H(FINISH.castBare, coreHeat)], [harness, FINISH.braid], [conduit, FINISH.darkBox],
        [this.boltMat, FINISH.bareSteel], [linerM, FINISH.acoustic], [white, { ...FINISH.nacellePaint, bottom: 0 }], [fairing, { ...FINISH.titanium, bottom: 0 }],
        [vsvMat, FINISH.titanium], [orange, FINISH.rubber], [perf, FINISH.castBare], [race, { ...FINISH.bareSteel, bottom: 0, grime: 0.05 }], [duct, FINISH.stainlessTube],
        [this.shared.paint, FINISH.nacellePaint], [this.shared.lip, FINISH.polished], [this.shared.loom, FINISH.braid],
        [this.shared.bare, { ...FINISH.nozzle, heat: [2.9, 4.45, 0.45], soot: [3.95, 4.37, 0.4] }],  // common nozzle: bare metal, light heat tint, soot only near the exit
      ]);
      const done = new Set([this.capMat]);
      const guess = (m) => {
        const c = m.color || new THREE.Color(1, 1, 1), lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
        if (m.metalness > 0.7) return c.r > c.b * 1.35 ? FINISH.cadmium : FINISH.bareSteel;
        return lum < 0.05 ? FINISH.darkBox : FINISH.castPaint;
      };
      for (const [m, f] of byMat) { finish(m, f); done.add(m); }
      this.engine.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || done.has(m) || !m.isMeshStandardMaterial) continue;
          done.add(m); const pid = o.userData.part && o.userData.part.id;
          finish(m, m.userData.finish ? {} : (byPart[pid] || guess(m)));
        }
      });
      // blade copies made before the heat tint was set on their part
      for (const id of ['hpt', 'lpt']) { const p = this.byId[id]; if (p.bladeMat) finish(p.bladeMat, byPart[id]); }
    }
    for (const p of this.parts) for (const ob of p.objs) ob.userData.home = ob.position.x;
  }

  _buildStage() {
    const s = this.scene;
    // seamless studio floor that fades into the background
    const fade = canvasTex(256, 256, (g) => { const gr = g.createRadialGradient(128, 128, 20, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(22, 64), new THREE.MeshStandardMaterial({ color: 0x2a2c2f, map: this.tex.concrete, metalness: 0.0, roughness: 0.78, alphaMap: fade, transparent: true }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(1.4, FLOOR_Y, 0); floor.receiveShadow = true; s.add(floor); this.floor = floor;
  }

  // ---------------------------------------------------------------- effects
  _points(n, size, blending = THREE.AdditiveBlending) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.PointsMaterial({ size, map: this.sprite, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.scene.add(p); return p;
  }
  _buildEffects() {
    const add = (o) => { o.frustumCulled = false; this.scene.add(o); return o; };
    this.puff = puffSprite();
    // airflow: streaks (head + fading tail) instead of dots, so speed and direction read at a glance
    const N = (this.nAir = 5200);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.air = add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending })));
    this.airP = Array.from({ length: N }, (_, i) => ({ core: i % 4 === 0, u: Math.random(), v: Math.random(), th: Math.random() * TAU, k: 0.6 + 0.8 * Math.random() }));
    this.fuelP = this._points(240, 0.028);

    // flame: nested annular sheets with a flowing fractal-noise shader
    const flameMat = () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uI: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uT,uI,uSeed; varying vec2 vUv; ${NOISE}
        void main(){ float x=clamp(vUv.y,0.0,1.0); float n=fbm(vec2(vUv.x*26.0+uSeed, x*3.2-uT*2.6))*0.65+fbm(vec2(vUv.x*61.0-uSeed, x*7.0-uT*4.4))*0.35;
          float reach=clamp(0.35+0.55*uI,0.05,1.0);
          float body=clamp(1.0-x/reach,0.0,1.0); float tongue=smoothstep(0.25,0.8,n+body*0.7-0.25);
          float a=clamp(tongue*body*(0.3+0.5*uI),0.0,1.0)*smoothstep(0.0,0.04,x);
          vec3 hot=vec3(0.75,0.85,1.0), mid=vec3(1.0,0.78,0.3), cool=vec3(1.0,0.32,0.05);
          vec3 c=mix(mix(hot,mid,smoothstep(0.0,0.28,x)), cool, smoothstep(0.25,0.9,x));
          gl_FragColor=vec4(c*(0.35+0.9*n)*a, a); }`,
    });
    this.flameSheets = [0.222, 0.238, 0.252, 0.266, 0.28].map((r, i) => { const g = new THREE.LatheGeometry([new THREE.Vector2(r, 1.972), new THREE.Vector2(r + (i - 2) * 0.004, 2.19)], 96); g.rotateZ(-Math.PI / 2); const m = add(new THREE.Mesh(g, flameMat())); m.material.uniforms.uSeed.value = i * 3.7; m.visible = false; return m; });

    // smoke, fire and mist (app/fx.js): lit, noise-textured puffs and tongues of flame
    FX.uNoise.value = noiseTexture(); FX.camera = this.camera;
    const S = this.scene, XN = P.X_EXIT;
    // intake condensation: thin mist that forms just inside the lip, hugs the wall and is drawn into the fan
    this.fog = new Billows(S, 420, { origin: [-0.9, -0.03, 0], dir: [1, 0, 0], speed: 1.6, radius: 0.68, ring: 0.75, spread: -0.05, life: 0.55, size0: 0.2, size1: 0.55, turb: 0.05, drag: 0, swirl: 0.6,
      colA: [0.92, 0.95, 1.0], colB: [0.95, 0.97, 1.0], colC: [1.0, 1.0, 1.0], alpha: 0.22, lit: 0.15, soft: 0.85, detail: 0.6, seed: 3 });
    this.fogK = 0;
    // dust and spray spun up where the ground vortex touches down
    this.dust = new Billows(S, 160, { ground: true, origin: [-1.25, FLOOR_Y + 0.06, 0], dir: [0, 1, 0], speed: 0.2, radius: 0.34, ring: 0.6, spread: -0.14, swirl: 6, buoy: [0.12, 0.12, 0], life: 0.9, size0: 0.14, size1: 0.45, turb: 0.05, drag: 0.2,
      colA: [0.62, 0.6, 0.56], colB: [0.7, 0.69, 0.66], colC: [0.78, 0.78, 0.77], alpha: 0.18, lit: 0.3, seed: 41 });
    // exhaust: almost invisible in reality. A faint glow of hot gas close to the nozzle, the rest is heat shimmer.
    this.jetGlow = new Billows(S, 200, { mode: 'glow', origin: [XN - 0.05, 0, 0], dir: [1, 0, 0], speed: 12, radius: 0.36, spread: 0.1, life: 0.45, size0: 0.5, size1: 1.5, turb: 0.08, drag: 0.4,
      colA: [0.3, 0.22, 0.16], colB: [0.12, 0.11, 0.11], colC: [0.03, 0.03, 0.04], alpha: 0.07, seed: 47, order: 4 });
    // failure effects: glowing fragments and molten metal from the tailpipe, black smoke, fire round the core
    this.sparks = new Sparks(S, 420);
    // black smoke trailing from the tailpipe of a damaged or torching engine: sooty near the nozzle, greying as it thins
    this.smokeTail = new Billows(S, 380, { origin: [XN - 0.05, 0, 0], dir: [1, 0, 0], speed: 2.4, radius: 0.32, spread: 0.12, buoy: [0, 0.45, 0], life: 4.5, size0: 0.45, size1: 3.2, turb: 0.3, drag: 0.5,
      colA: [0.07, 0.065, 0.06], colB: [0.06, 0.058, 0.056], colC: [0.17, 0.17, 0.175], alpha: 0.72, lit: 0.6, soft: 1.0, detail: 0.35, seed: 11 });
    // nacelle fire: tongues of flame round the core, embers, and the thick smoke column above, lit from below
    this.smokeFire = new Billows(S, 340, { origin: [2.05, 0.55, 0.15], box: [0.9, 0.1, 0.5], dir: [0.2, 1, 0], speed: 1.2, radius: 0.15, spread: 0.12, buoy: [0.15, 0.4, 0], life: 5, size0: 0.35, size1: 3.0, turb: 0.35, drag: 0.3,
      colA: [0.05, 0.045, 0.04], colB: [0.045, 0.043, 0.042], colC: [0.15, 0.15, 0.155], alpha: 0.85, lit: 0.55, detail: 0.35, seed: 19 });
    this.flames = new Billows(S, 260, { mode: 'fire', origin: [2.0, 0.2, 0.12], box: [0.85, 0.1, 0.1], dir: [0.1, 1, 0], speed: 1.4, radius: 0.36, ring: 0.6, spread: 0.05, buoy: [0, 2.6, 0], life: 0.62, size0: 0.4, size1: 0.2, turb: 0.4, drag: 0.25,
      alpha: 0.85, heat: 0.95, gain: 0.95, occ: 0.6, stretch: 0.07, seed: 23 });
    this.embers = new Streaks(S, 260, { additive: true, len: 0.02 });
    // torching: fuel still burning as it leaves the nozzle, long tongues along the jet
    this.torch = new Billows(S, 260, { mode: 'fire', origin: [XN - 0.25, 0, 0], dir: [1, 0, 0], speed: 7, radius: 0.24, spread: 0.15, buoy: [0, 1.2, 0], life: 0.5, size0: 0.42, size1: 0.26, turb: 0.25, drag: 0.45,
      alpha: 0.65, heat: 1.0, gain: 0.95, occ: 0.5, stretch: 0.035, seed: 29 });
    // bursts: a fireball out of the intake and the nozzle on a surge, and the smoke after it
    this.fireball = new Billows(S, 300, { mode: 'fire', ball: 1, life: 0.38, size0: 0.35, size1: 1.05, turb: 0.3, drag: 2.2, buoy: [0, 1.5, 0], alpha: 0.6, heat: 1.05, gain: 1.0, occ: 0.5, stretch: 0.01, seed: 31 });
    this.burstSmoke = new Billows(S, 180, { life: 2.6, size0: 0.25, size1: 1.6, turb: 0.25, drag: 1.4, buoy: [0, 0.5, 0], colA: [0.09, 0.085, 0.08], colB: [0.12, 0.12, 0.12], colC: [0.22, 0.22, 0.23], alpha: 0.55, lit: 0.6, detail: 0.35, seed: 37 });
    // leaks: fuel vapour and escaping air as faint wisps
    this.mist = new Billows(S, 360, { life: 0.7, size0: 0.05, size1: 0.35, turb: 0.2, drag: 2.5, buoy: [0, 0.2, 0], colA: [0.95, 0.94, 0.88], colB: [0.96, 0.96, 0.95], colC: [1, 1, 1], alpha: 0.16, lit: 0.25, soft: 1.1, detail: 0.8, seed: 43 });
    this.fail = { sparks: 0, smoke: 0, fire: 0 };
    // part failures (failures.js): bursts of debris, leaking fluids and air, parts torn off
    this.debris = new Shards(this.scene, 220);
    this.hotBits = new Streaks(this.scene, 700, { additive: true, len: 0.025 });
    this.liquid = new Particles(this.scene, 1600, { size: 0.016, map: this.sprite });
    this.spray = new Streaks(this.scene, 1600, { additive: false, len: 0.035 });
    this.failedParts = new Set(); this.failState = null; this._leakPts = {}; this._torn = []; this._sep = null;
    this._flameHome = { origin: this.flames.u.uOrigin.value.clone(), box: this.flames.u.uBox.value.clone(), radius: this.flames.u.uRadius.value, ring: this.flames.u.uRing.value, life: this.flames.u.uLife.value, size0: this.flames.u.uSize0.value, size1: this.flames.u.uSize1.value };
    this._smokeHome = { origin: this.smokeFire.u.uOrigin.value.clone(), box: this.smokeFire.u.uBox.value.clone() };
    this.fireLight = new THREE.PointLight(0xff6a20, 0, 6, 1.4); this.fireLight.position.set(2.0, 0.5, 0.4); this.scene.add(this.fireLight);

    // ground vortex: a twisting rope of condensed air, bent in the vertex shader from the floor into the intake
    const rope = (layer) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uK: { value: 0 }, uFoot: { value: new THREE.Vector3(-1.42, FLOOR_Y, 0) }, uTop: { value: new THREE.Vector3(-0.42, -0.5, 0) }, uFat: { value: 1 + layer * 0.9 }, uPhase: { value: layer * 2.1 } },
      vertexShader: `uniform float uT,uFat,uPhase; uniform vec3 uFoot,uTop; varying float vT; varying float vA; varying float vFacing;
        void main(){ float t=clamp(position.y+0.5,0.0,1.0); vT=t; float a=atan(position.z,position.x); vA=a;
          float e=t*t*(3.0-2.0*t);
          vec3 c=vec3(mix(uFoot.x,uTop.x,e), mix(uFoot.y,uTop.y,t), mix(uFoot.z,uTop.z,e));
          float sway=(1.0-t)*t*4.0; c.x+=0.07*sway*sin(t*5.0+uT*1.3+uPhase); c.z+=0.07*sway*cos(t*4.0+uT*1.1+uPhase);
          float r=(mix(0.13,0.022,smoothstep(0.0,0.5,t))+0.008*t)*uFat;
          float tw=a+t*9.0-uT*5.0;
          vec3 p=c+r*vec3(cos(tw),0.0,sin(tw));
          vec4 mv=modelViewMatrix*vec4(p,1.0); vec3 nrm=normalMatrix*vec3(cos(tw),0.0,sin(tw));
          vFacing=abs(nrm.z)/max(length(nrm),1e-4);
          gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT,uK,uPhase; varying float vT; varying float vA; varying float vFacing; ${NOISE}
        void main(){ float streak=fbm(vec2(vA*2.2+vT*16.0-uT*6.0+uPhase, vT*9.0-uT*1.5));
          float ends=smoothstep(0.0,0.06,vT)*(1.0-smoothstep(0.86,1.0,vT));
          float a=clamp(uK,0.0,1.0)*ends*(0.2+0.8*streak)*pow(clamp(vFacing,1e-3,1.0),1.5);
          gl_FragColor=vec4(vec3(0.92,0.95,1.0), clamp(a,0.0,1.0)); }`,
    });
    this.vortexRopes = [0, 1].map((k) => add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 80, true), rope(k))));

    // exhaust plume: nested cones, fractal noise breaking up along the flow
    const plumeMat = (rgb) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Color(...rgb) }, uSpeed: { value: 1 } },
      vertexShader: `uniform float uT,uSpeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv=uv; float along=clamp(1.0-uv.y,0.0,1.0);
          vec3 p=position; float wob=along*along*0.11; p.y+=wob*sin(along*7.0-uT*uSpeed*2.2+uv.x*6.283); p.z+=wob*cos(along*6.0-uT*uSpeed*1.9+uv.x*6.283);
          vec4 mv=modelViewMatrix*vec4(p,1.0); vN=normalMatrix*normal; vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT,uA,uSpeed; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV; ${NOISE}
        void main(){ float along=clamp(1.0-vUv.y,0.0,1.0); float t=uT*uSpeed;
          float nz=fbm(vec2(vUv.x*9.0, along*5.0-t*2.4))*0.6+fbm(vec2(vUv.x*24.0+3.0, along*13.0-t*5.0))*0.4;
          float body=pow(max(1.0-along,1e-4),1.5)*smoothstep(0.0,0.05,along);
          float breakup=smoothstep(0.15,0.75,nz+0.55*(1.0-along));
          float nv=dot(vN,vV)/max(length(vN)*length(vV),1e-4); float rimF=pow(clamp(abs(nv),1e-4,1.0),1.3);
          gl_FragColor=vec4(uC*(0.5+1.1*nz), clamp(uA*body*rimF*breakup,0.0,1.0)); }`,
    });
    const cone = (r0, r1, rgb, x) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 56, 40, true); g.translate(0, 0.5, 0); g.rotateZ(-Math.PI / 2); const m = add(new THREE.Mesh(g, plumeMat(rgb))); m.position.x = x; return m; };
    const dX = (P.X_EXIT - 3.55);
    this.plumeOuter = cone(0.6, 0.86, [0.5, 0.7, 1.0], 3.55 + dX);
    this.plumeMid = cone(0.5, 0.68, [0.85, 0.75, 0.7], 3.4 + dX);
    this.plumeCore = cone(0.4, 0.5, [1.0, 0.55, 0.2], 3.2 + dX);
    this.plumeHot = cone(0.26, 0.2, [1.0, 0.85, 0.6], 3.15 + dX);
    const blur = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.8, 64), new THREE.MeshBasicMaterial({ color: 0xb8c0c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.y = Math.PI / 2; blur.position.x = 0.16; this.fanBlur = blur; this.scene.add(blur);
  }


  _buildPost() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(4, 4);   // the solid scene's depth, read by the soft smoke and fire
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    c.addPass(new DepthCapturePass());
    c.addPass(new ShaderPass(Sanitize));
    this.ao = new GTAOPass(this.scene, this.camera, 4, 4);
    this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12 });
    this.ao.enabled = false; c.addPass(this.ao);
    c.addPass(new SoftFxPass(this.scene, this.camera));   // smoke and fire after the ambient occlusion, before bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.32, 0.5, 1.7); c.addPass(this.bloom);
    this.haze = new ShaderPass(HeatHaze); c.addPass(this.haze);
    c.addPass(new ShaderPass(Sanitize));
    this.bsPass = new ShaderPass(BorescopeShader); this.bsPass.enabled = false; c.addPass(this.bsPass);   // borescope lens, only while inspecting
    c.addPass(new OutputPass());
    // Anti-aliasing is layered: multisampling on the scene buffer (geometry edges), SMAA on the final
    // image (edges the post-processing passes re-introduce), and optional supersampling on Ultra.
    this.smaa = new SMAAPass(); c.addPass(this.smaa);
    this.fx = { haze: true };
  }

  // ---------------------------------------------------------------- controls
  _controls() {
    // Mouse: drag to orbit, right-drag or shift-drag to pan, wheel to zoom, hover highlights, click selects.
    // Touch: one finger orbits, two fingers pinch to zoom and move together to pan, a tap selects.
    const el = this.canvas, o = this.orbit, pts = new Map();
    let drag = null, moved = 0, multi = false, pinch = null;
    const camAxis = (i) => new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, i);
    const pan = (dx, dy) => { const k = o.dist * 0.0012; o.target.addScaledVector(camAxis(0), -dx * k).addScaledVector(camAxis(1), dy * k); };
    const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId);
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, pan: e.pointerType === 'mouse' && (e.button !== 0 || e.shiftKey) }; moved = 0; multi = false; }
      else if (pts.size === 2) { multi = true; drag = null; pinch = two(); }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) { if (e.pointerType === 'mouse') this._pick(e, false); return; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2 && pinch) {
        const n = two();
        if (this.borescope.on) { if (n.d > 1 && pinch.d > 1) this.borescope.push((n.d - pinch.d) * 0.003); pinch = n; return; }
        if (n.d > 1 && pinch.d > 1) o.dist = clamp(o.dist * (pinch.d / n.d), 1.4, this.maxDist || 22);
        pan(n.x - pinch.x, n.y - pinch.y); pinch = n;
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        if (this.borescope.on) this.borescope.look(dx, dy);   // steering the probe tip
        else if (drag.pan) pan(dx, dy); else { o.az -= dx * 0.006; o.el = clamp(o.el + dy * 0.006, -0.3, 1.45); }
      }
    });
    const end = (e) => {
      const had = pts.delete(e.pointerId);
      if (had && drag && !multi && e.type === 'pointerup' && moved < (e.pointerType === 'mouse' ? 5 : 10) && (e.pointerType !== 'mouse' || e.button === 0)) {
        if (this.borescope.on) { /* nothing to pick inside the engine */ }
        else if (this.placeHandler && this.apronView.on) { const g = this.groundAt(e); if (g) this.placeHandler(g); }   // dropping an object on the apron
        else this._pick(e, true);
      }
      if (pts.size === 1) { const [q] = [...pts.values()]; drag = { x: q.x, y: q.y, pan: false }; pinch = null; } // carry on orbiting with the finger left
      else if (pts.size === 0) { drag = null; pinch = null; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { this.hover = null; this.onHover && this.onHover(null); } });
    el.addEventListener('wheel', (e) => { e.preventDefault(); if (this.borescope.on) { this.borescope.push(-e.deltaY * 0.0008); return; } o.dist = clamp(o.dist * Math.exp(e.deltaY * 0.0011), 1.4, this.maxDist || 22); }, { passive: false });
    this.ray = new THREE.Raycaster();
  }
  /** The ground point under a pointer event (engine frame), or null. */
  groundAt(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.apronView.groundPoint(this.ray);
  }
  _pick(e, click) {
    const r = this.canvas.getBoundingClientRect();
    // The camera's projection already includes the view offset used to keep the engine clear of the
    // panels, so the cursor position is used as-is (adding the offset again shifts every hit sideways).
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    let part = null;
    for (const h of this.ray.intersectObjects(this.engine.children, true)) {
      const p = h.object.userData.part; if (!p || p.removed) continue;
      let vis = true; for (let n = h.object; n; n = n.parent) if (!n.visible) { vis = false; break; }
      if (!vis) continue;
      if (h.object.isInstancedMesh && h.instanceId >= h.object.count) continue;
      part = p; break;
    }
    if (click) { this.selected = part; this.onSelect && this.onSelect(part); }
    else if (part !== this.hover) { this.hover = part; this.canvas.style.cursor = part ? 'pointer' : 'grab'; this.onHover && this.onHover(part, e); }
  }

  /** Thrust reverser: sleeve slides aft to uncover the cascades, blocker doors swing into the duct. */
  _reverser(rev) {
    if (rev === this._rev) return; this._rev = rev;
    if (!this.revNodes) { this.revNodes = []; this.engine.traverse((n) => { const k = /^cna_sleeve/i.test(n.name) ? 'sleeve' : /^cna_blocker/i.test(n.name) ? 'door' : null; if (k) { n.userData.rev = { k, x: n.position.x, q: n.quaternion.clone() }; this.revNodes.push(n); } }); }
    const e = rev * rev * (3 - 2 * rev), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -e * 0.61); // hinge = door's tangential axis (local Z after the glTF axis conversion)
    if (this.dragLinks) {
      // ten rods: each runs from a hinge on the core cowl to the aft part of its door and pulls the door down as the sleeve slides aft
      const a = e * 0.61, px = 1.8 + 0.46 * e + 0.34 * Math.cos(a), pr = 0.759 - 0.012 * (1 - e) - 0.34 * Math.sin(a), ax = 2.29, ar = rAt(P.bypInner, 2.29), ex = this.byId.cna.ex * this.explode * 1.5;
      const len = Math.hypot(px - ax, pr - ar), ang = Math.atan2(px - ax, pr - ar), m = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang), ax1 = new THREE.Vector3(1, 0, 0);
      for (const im of this.dragLinks) { im.userData.ths.forEach((th, i) => { const mx = (px + ax) / 2, mr = (pr + ar) / 2; q.setFromAxisAngle(ax1, th).multiply(qz); m.compose(new THREE.Vector3(mx, mr * Math.cos(th), mr * Math.sin(th)), q, new THREE.Vector3(1, len, 1)); im.setMatrixAt(i, m); }); im.instanceMatrix.needsUpdate = true; }
    }
    for (const n of this.revNodes) { const b = n.userData.rev; n.position.x = b.x + 0.46 * e; if (b.k === 'door') n.quaternion.copy(b.q).multiply(qy); }
  }

  view(name) {
    const v = { hero: [-0.72, 0.2, 10.4, 1.65], front: [-1.3, 0.1, 7.8, 0.2], rear: [0.95, 0.14, 11.2, 4.3], side: [0, 0.03, 10.4, 1.65], core: [-0.2, 0.22, 4.4, 1.95] }[name];
    if (v) Object.assign(this.orbit, { az: v[0], el: v[1], dist: v[2] }), this.orbit.target.set(v[3], -0.05, 0);
  }
  /** Open or close the cowls: fan cowl doors first, then the C-ducts (which need the reverser stowed). */
  setCowls(open) { this.cowl.open = open; }
  _cowls(o, dt) {
    const c = this.cowl, rate = dt / 2.5, revOut = (o.rev || 0) > 0.02;
    const fanT = c.open || c.cd > 0.01 ? 1 : 0, cdT = c.open && c.fan > 0.98 && !revOut ? 1 : 0;
    c.fan += clamp(fanT - c.fan, -rate, rate); c.cd += clamp(cdT - c.cd, -rate, rate);
    c.blocked = c.open && revOut;
    const key = `${c.fan.toFixed(4)}:${c.cd.toFixed(4)}:${this.explode}`; if (key === this._cowlApplied) return; this._cowlApplied = key;
    const ease = (k) => k * k * (3 - 2 * k), ang = { fan: HINGES.fan.open * ease(c.fan), cd: HINGES.cd.open * ease(c.cd) };
    for (const h of this.hingePivots) h.obj.rotation.x = (h.side === 'L' ? -1 : 1) * ang[h.kind];
    // hold-open struts and rods: one end fixed on the engine, the other on the door
    if (!this.holdRods) {
      const g = new THREE.CylinderGeometry(0.011, 0.011, 1, 8), m = new THREE.MeshStandardMaterial({ color: 0xc9a02a, metalness: 0.8, roughness: 0.35 }), P3 = (x, th, r) => new THREE.Vector3(x, r * Math.cos(th * DEG), r * Math.sin(th * DEG));
      this.holdRods = [];
      for (const s of [1, -1]) for (const x of [0.35, 0.85]) this.holdRods.push({ kind: 'fan', side: s > 0 ? 'L' : 'R', a: P3(x, s * 128, 0.9), b: P3(x, s * 108, 1.0) });
      for (const s of [1, -1]) for (const x of [1.5, 2.5]) this.holdRods.push({ kind: 'cd', side: s > 0 ? 'L' : 'R', a: P3(x, s * 100, rAt(P.coreOuter, x) + 0.06), b: P3(x, s * 112, rAt(P.bypInner, x) - 0.02) });
      for (const r of this.holdRods) { r.mesh = new THREE.Mesh(g, m); r.mesh.castShadow = true; r.mesh.visible = false; this.engine.add(r.mesh); }
    }
    const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), b = new THREE.Vector3();
    for (const r of this.holdRods) {
      const a = ang[r.kind] * (r.side === 'L' ? -1 : 1), h = HINGES[r.kind][r.side], hy = h.r * Math.cos(h.th), hz = h.r * Math.sin(h.th);
      const y = r.b.y - hy, z = r.b.z - hz; b.set(r.b.x, hy + y * Math.cos(a) - z * Math.sin(a), hz + y * Math.sin(a) + z * Math.cos(a));
      r.mesh.visible = Math.abs(a) > 0.08 && this.explode < 0.01;
      if (!r.mesh.visible) continue;
      d.subVectors(b, r.a); r.mesh.position.copy(r.a).addScaledVector(d, 0.5); r.mesh.scale.set(1, d.length(), 1); r.mesh.quaternion.setFromUnitVectors(up, d.normalize());
    }
  }
  setCutaway(on) {
    this.cutaway = on;
    this.engine.traverse((n) => { if (n.userData.cutPair) { n.userData.cutPair[0].visible = !on; n.userData.cutPair[1].visible = on; } });
    for (const im of this.cutInst) im.count = on ? im.userData.kept : im.userData.ths.length;
    this.engine.traverse((n) => { const v = n.userData.variant; if (v) n.visible = (v === 'cut') === on; if (n.userData.apronHide) n.visible = false; });
    for (const p of this.parts) if (p.removed) for (const ob of p.objs) ob.visible = false;
  }
  setExplode(v) { this.explode = v; for (const p of this.parts) for (const ob of p.objs) ob.position.x = ob.userData.home + p.ex * v * 1.5; }
  setRemoved(id, removed) { const p = this.byId[id]; if (!p) return; p.removed = removed; for (const ob of p.objs) { const v = ob.userData.variant; ob.visible = !removed && (!v || (v === 'cut') === this.cutaway); } if (removed && this.selected === p) this.selected = null; }
  restoreAll() { for (const p of this.parts) this.setRemoved(p.id, false); }

  // ------------------------------------------------------------------ part failures (src/sim/failures.js)
  /** Parts with an active failure pulse red. */
  setFailedParts(ids) { this.failedParts = new Set(ids); }
  /** Centre of a part, in world coordinates (first visible mesh's bounds). */
  _partCentre(id) {
    const p = this.byId[id], box = new THREE.Box3(), b = new THREE.Box3();
    if (!p) return null;
    for (const ob of p.objs) ob.traverse((m) => { if (m.isMesh && m.visible) { b.setFromObject(m); if (!b.isEmpty()) box.union(b); } });
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }
  /** A point on a part's surface to leak from (engine coordinates) and the outward direction there. */
  _leakPoint(id) {
    const c = this._leakPts[id]; if (c && c.at > this.t - 1) return c;
    const p = this.byId[id]; if (!p) return null;
    let best = null, n = 0;
    for (const ob of p.objs) ob.traverse((m) => { if (!m.isMesh || m.isInstancedMesh) return; let vis = true; for (let a = m; a; a = a.parent) if (!a.visible) { vis = false; break; } const k = m.geometry.attributes.position.count; if (vis && k > n) { n = k; best = m; } });
    if (!best) return null;
    const v = new THREE.Vector3().fromBufferAttribute(best.geometry.attributes.position, Math.floor(n * 0.47));
    best.localToWorld(v); this.engine.worldToLocal(v);
    const dir = new THREE.Vector3(0, v.y, v.z).normalize();
    return (this._leakPts[id] = { pos: v, dir, at: this.t });
  }
  /** One-off visuals for a failure event. */
  failEvent(type, ev) {
    if (type === 'bird-strike' || type === 'fod-ingested') { this.apronView.ingestFx(ev || {}); return; }
    const E = this.engine, w = new THREE.Vector3(), rnd = Math.random;
    const burst = (x, r0, n, sp, axial, hot, spread = 1) => {
      for (let i = 0; i < n; i++) {
        const th = rnd() * TAU, r = r0 * (0.4 + 0.6 * rnd()), v = sp * (0.4 + 0.8 * rnd());
        w.set(x, r * Math.cos(th), r * Math.sin(th)); E.localToWorld(w);
        const vx = axial * (0.5 + rnd()), vy = Math.cos(th) * v * spread + 2 * rnd(), vz = Math.sin(th) * v * spread;
        if (hot && i % 3) this.hotBits.emit(w.x, w.y, w.z, vx, vy, vz, 1, 1, 1, 1, 0.5 + rnd() * 0.9, { drag: 0.5, cool: true });   // glowing fragments, cooling as they fly
        else this.debris.emit(w.x, w.y, w.z, vx * 0.8, vy * 0.8, vz * 0.8, 0.014 + 0.045 * rnd() * rnd(), 6 + 6 * rnd());
      }
      if (hot) { w.set(x, 0, 0); E.localToWorld(w); for (let i = 0; i < 14; i++) this.burstSmoke.emit(w.x + (rnd() - 0.5) * 0.6, w.y + (rnd() - 0.5) * 0.6, w.z + (rnd() - 0.5) * 0.6, axial * 0.15 * rnd(), 0.5 + rnd(), (rnd() - 0.5)); }
    };
    if (/fan-blade-off|fan-crack-release/.test(type)) {
      burst(0.15, 0.7, 90, 4, -7, false); burst(0.4, 0.75, 40, 3, 9, false);
      const th = rnd() * TAU; w.set(0.1, 0.7 * Math.cos(th), 0.7 * Math.sin(th)); E.localToWorld(w);
      this.debris.emit(w.x, w.y, w.z, -4 - 2 * rnd(), Math.cos(th) * 3 + 2, Math.sin(th) * 3, 0.13, 20);   // most of the blade itself, out of the intake
    }
    else if (/spinner-lost|liner-ingested/.test(type)) burst(0.1, 0.6, 50, 2, 7, false);
    else if (/lpc-blade|hpc-blade|hpt-blade|lpt-blade/.test(type)) burst(P.X_EXIT, 0.3, 50, 1.5, 14, true, 0.4);   // through the core and out of the nozzle
    else if (/disc-burst|case-burn/.test(type)) { const x = /hp/.test(type) ? 2.3 : 2.75; burst(x, 0.6, 140, 14, 1, true); burst(x, 0.6, 60, 9, -2, false); }   // uncontained
    else if (type === 'starter-burst') { const c = this._partCentre('starter'); if (c) { for (let i = 0; i < 70; i++) this.hotBits.emit(c.x, c.y, c.z, (rnd() - 0.5) * 6, rnd() * 3 - 1, (rnd() - 0.5) * 6, 1, 1, 1, 1, 0.4 + rnd() * 0.6, { drag: 0.5, cool: true }); for (let i = 0; i < 30; i++) this.debris.emit(c.x, c.y, c.z, (rnd() - 0.5) * 5, rnd() * 2, (rnd() - 0.5) * 5, 0.006 + 0.015 * rnd(), 8); } }
    else if (type === 'fan-cowl-lost') this._tearOff('fancowl');
    else if (type === 'engine-separation') this._separate();
  }
  /** The fan cowl doors lift open and are blown away. */
  _tearOff(id) {
    const p = this.byId[id]; if (!p || p.removed) return;
    for (const ob of p.objs) this._torn.push({ ob, part: p, t: 0, pos: ob.position.clone(), quat: ob.quaternion.clone(), v: new THREE.Vector3(3 + Math.random() * 2, 4 + Math.random() * 2, (Math.random() - 0.5) * 3), spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3) });
  }
  /** Both mounts let go: the pylon stays, the engine drops to the floor. */
  _separate() {
    if (this._sep) return;
    const py = this.byId.pylon, kept = py ? py.objs.slice() : [];
    for (const ob of kept) this.scene.attach(ob);
    this._sep = { t: 0, vy: 0, y: 0, kept, landed: false };
  }
  /** Put everything back as it was before any failure visuals. */
  resetFailures() {
    for (const tr of this._torn) { tr.ob.position.copy(tr.pos); tr.ob.quaternion.copy(tr.quat); }
    const cowlTorn = this._torn.length > 0; this._torn = [];
    if (cowlTorn) this.setRemoved('fancowl', false);
    if (this._sep) { this.engine.position.set(0, 0, 0); this.engine.rotation.set(0, 0, 0); this.engine.updateMatrixWorld(true); for (const ob of this._sep.kept) this.engine.attach(ob); this._sep = null; }
    for (const ps of [this.debris, this.hotBits, this.liquid, this.spray, this.mist, this.burstSmoke, this.fireball, this.embers, this.flames, this.smokeFire, this.smokeTail, this.torch]) ps.clear();
    this.failedParts = new Set(); this.failState = null; this._missKey = ''; this._leakPts = {};
  }
  /** Released blades: hidden instances, from the counts the simulation keeps. */
  _missing(fs) {
    const dl = fs && fs.dmg ? `${fs.dmg.fan.length},${fs.dmg.lpc.length},${fs.dmg.hpc.length},${Math.round((fs.ngvBurn || 0) * 20)},${Math.round((fs.hotH || 0) / 25)},${Math.round((fs.hotL || 0) / 25)}` : '';
    const key = fs ? `${fs.missing.fan.length},${fs.missing.lpc.length},${fs.missing.hpc.length},${Math.round(fs.hpt * 100)},${Math.round(fs.lpt * 100)},${dl}` : '';
    if (key === this._missKey) return; this._missKey = key; this._miss = new Map();
    if (!fs) fs = { missing: { fan: [], lpc: [], hpc: [] }, hpt: 0, lpt: 0 };   // repaired: rows rewritten whole below
    // the rotor rows of a part, in build order (the fan's row is drawn whole, so it is not among rotorRows)
    const rows = (id) => { const out = []; for (const ob of (this.byId[id] || { objs: [] }).objs) if (ob.isInstancedMesh && ob.userData.row && ob.parent !== this.engine) out.push({ im: ob }); return out; };
    const put = (im, idx) => { if (!idx.length) return; const s0 = this._miss.get(im) || new Set(); for (const i of idx) s0.add(i); this._miss.set(im, s0); };
    const pick = (n, count, seed) => { const out = []; let sd = seed; n = Math.min(n, count); while (out.length < n) { sd = (sd * 16807) % 2147483647; const i = sd % count; if (!out.includes(i)) out.push(i); } return out; };
    for (const id of ['fan', 'lpc', 'hpc']) { const r = rows(id)[0]; if (r) put(r.im, fs.missing[id].map((f) => Math.floor(f * r.im.count) % r.im.count)); }
    ['hpt', 'lpt'].forEach((id, k) => rows(id).forEach((r, j) => put(r.im, pick(Math.round(fs[id] * r.im.count * (j === 0 ? 1.5 : 0.5 / Math.max(1, j))), r.im.count, 97 + 31 * j + 7 * k))));
    // dented, bent and burnt blades: deformed copies stand in for their instances (app/damage3d.js)
    for (const d of applyDamage(this, fs, rows, put)) { let a = d.im; while (a && a !== this.g1 && a !== this.g2) a = a.parent; d.group = a; }
    // rows that are not redrawn every frame (the fan) are rewritten here, once per change
    const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), live = new Set(this.rotorRows.map((r) => r.im));
    for (const im of new Set([...(this._missStatic || []), ...this._miss.keys()])) {
      if (live.has(im)) continue;
      const gone = this._miss.get(im), ths = im.userData.ths, place = im.userData.place;
      for (let i = 0; i < ths.length; i++) { if (gone && gone.has(i)) im.setMatrixAt(i, zero); else { place(m, ths[i]); im.setMatrixAt(i, m); } }
      im.instanceMatrix.needsUpdate = true;
    }
    this._missStatic = [...this._miss.keys()].filter((im) => !live.has(im));
  }
  _failFrame(o, dt) {
    const fs = this.failState, t = this.t, E = this.engine;
    this._missing(fs);
    // leaks: fuel spraying and misting, oil and hydraulic fluid streaming and dripping, air jets. A leak behind
    // closed cowls is hidden; the liquid finds its way out of the drain at the bottom of the nacelle instead.
    if (fs && fs.leaks.length && dt > 0) {
      const w = new THREE.Vector3(), d = new THREE.Vector3(), rnd = Math.random, j = () => rnd() - 0.5;
      const COL = { fuel: [0.93, 0.88, 0.66, 0.5], oil: [0.3, 0.17, 0.04, 0.95], hyd: [0.55, 0.32, 0.86, 0.85] };
      for (const L of fs.leaks) {
        const lp = this._leakPoint(L.part); if (!lp) continue;
        w.copy(lp.pos); E.localToWorld(w); d.copy(lp.dir).transformDirection(E.matrixWorld);
        if (L.kind === 'air') {   // hot air: faint shimmering wisps, fast
          const n = Math.floor(45 * L.k * dt + rnd());
          for (let i = 0; i < n; i++) { const sp = 5 + 4 * rnd(); this.mist.emit(w.x, w.y, w.z, d.x * sp + j() * 2, d.y * sp + j() * 2, d.z * sp + j() * 2, { size0: 0.04, size1: 0.45, life: 0.45 }); }
          continue;
        }
        const [r, g, b, a] = COL[L.kind], fuel = L.kind === 'fuel';
        const n = Math.min(40, Math.floor(150 * L.k * dt + rnd()));
        for (let i = 0; i < n; i++) {
          const sp = fuel ? 2.5 + 2.5 * rnd() : 1.0 + 1.4 * rnd(), vx = d.x * sp + j() * 0.8, vy = d.y * sp + j() * 0.8, vz = d.z * sp + j() * 0.8;
          this.spray.emit(w.x, w.y, w.z, vx, vy, vz, r, g, b, a, 0.8 + 0.8 * rnd(), { drag: fuel ? 1.2 : 0.3 });
          if (i % 2 === 0) this.liquid.emit(w.x, w.y, w.z, vx, vy, vz, r, g, b, a, 1.2 + rnd(), 9.81, fuel ? 1.2 : 0.3);
          if (fuel && i % 4 === 0) this.mist.emit(w.x, w.y, w.z, vx * 0.6, vy * 0.6, vz * 0.6, { size0: 0.04, size1: 0.3, life: 0.8 });   // atomised fuel
        }
        // behind a closed cowl: out of the nacelle drain instead (fan compartment forward, core compartment aft)
        const lx = lp.pos.x, th = Math.atan2(lp.pos.z, lp.pos.y), exposed = (this.cutaway && inCut(th)) || (lx < 1.2 ? this.cowl.fan > 0.5 : this.cowl.cd > 0.5);
        if (!exposed) {
          w.set(lx < 1.2 ? 0.95 : 2.45, lx < 1.2 ? -rAt(P.nacelleBot || P.nacelle, 0.95) - 0.02 : -0.99, 0); E.localToWorld(w);
          const m = Math.floor(60 * L.k * dt + rnd());
          for (let i = 0; i < m; i++) { const vx = j() * 0.15, vy = -0.3 - 0.4 * rnd(), vz = j() * 0.15; this.spray.emit(w.x + j() * 0.02, w.y, w.z + j() * 0.02, vx, vy, vz, r, g, b, a, 0.9, { drag: 0.2 }); if (i % 2) this.liquid.emit(w.x, w.y, w.z, vx, vy, vz, r, g, b, a, 1.2, 9.81, 0.2); }
        }
      }
    }
    for (const ps of [this.debris, this.liquid, this.spray, this.hotBits, this.embers]) ps.update(dt, FLOOR_Y + 0.01, t);
    this.mist.set(t, 0); this.burstSmoke.set(t, 0); this.fireball.set(t, 0);
    // a leak fire burns where the leak is
    const fp = fs && fs.firePart ? this._leakPoint(fs.firePart) : null, fl = this.flames.u, sm = this.smokeFire.u;
    if (fp) { fl.uOrigin.value.copy(fp.pos).add(fp.dir.clone().multiplyScalar(0.05)); fl.uBox.value.set(0.25, 0.05, 0.25); fl.uRadius.value = 0.06; fl.uRing.value = 0; fl.uLife.value = 0.5; fl.uSize0.value = 0.24; fl.uSize1.value = 0.12; sm.uOrigin.value.copy(fl.uOrigin.value); sm.uBox.value.set(0.3, 0.05, 0.3); this.fireLight.position.copy(fl.uOrigin.value).add(fp.dir.clone().multiplyScalar(0.3)); }
    else { const h = this._flameHome; fl.uOrigin.value.copy(h.origin); fl.uBox.value.copy(h.box); fl.uRadius.value = h.radius; fl.uRing.value = h.ring; fl.uLife.value = h.life; fl.uSize0.value = h.size0; fl.uSize1.value = h.size1; sm.uOrigin.value.copy(this._smokeHome.origin); sm.uBox.value.copy(this._smokeHome.box); this.fireLight.position.set(2.0, 0.5, 0.4); }
    if (this._sep) { const e = E.position; fl.uOrigin.value.add(e); sm.uOrigin.value.add(e); }
    // torn-off parts tumble away, then are gone
    for (const tr of this._torn) {
      tr.t += dt; tr.v.y -= 9.81 * dt; tr.ob.position.addScaledVector(tr.v, dt);
      tr.ob.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.spin.x * dt, tr.spin.y * dt, tr.spin.z * dt)));
      if (tr.t > 1.6 && !tr.part.removed) this.setRemoved(tr.part.id, true);
    }
    // engine separation: a fall of about 0.6 m to the floor, a bounce, settling nose down
    const sp = this._sep;
    let y = 0, rz = 0;
    if (sp) {
      sp.t += dt; const floor = FLOOR_Y + 1.12;
      if (!sp.landed) { sp.vy -= 9.81 * dt; sp.y += sp.vy * dt; if (sp.y < floor) { sp.y = floor; if (Math.abs(sp.vy) > 0.6) sp.vy *= -0.2; else { sp.vy = 0; sp.landed = true; } } }
      y = sp.y; rz = -0.06 * clamp(sp.t / 0.5, 0, 1);
    }
    // heavy vibration shakes the engine on its mounts
    const vib = Math.max(o.vib1 || 0, o.vib2 || 0), amp = sp ? 0 : clamp((vib - 3.5) * 0.0022, 0, 0.012);
    E.position.set(amp ? (Math.random() - 0.5) * amp : 0, y + (amp ? (Math.random() - 0.5) * amp : 0), amp ? (Math.random() - 0.5) * amp : 0);
    E.rotation.z = rz;
  }
  /** Surge: a fireball out of the intake (fan or booster) and the nozzle, then smoke. */
  surge(which) {
    this.flash = 1; this.flashFront = which !== 'hpc';
    const E = this.engine, w = new THREE.Vector3(), rnd = Math.random, puff = (x, r0, n, vx0, vx1) => {
      for (let i = 0; i < n; i++) {
        const th = rnd() * TAU, r = r0 * Math.sqrt(rnd()), vr = 1.5 + 2.5 * rnd();
        w.set(x, r * Math.cos(th), r * Math.sin(th)); E.localToWorld(w);
        this.fireball.emit(w.x, w.y, w.z, vx0 + (vx1 - vx0) * rnd(), Math.cos(th) * vr, Math.sin(th) * vr);
        if (i % 3 === 0) this.burstSmoke.emit(w.x, w.y, w.z, (vx0 + (vx1 - vx0) * rnd()) * 0.35, Math.cos(th) * vr * 0.3 + 0.3, Math.sin(th) * vr * 0.3);
      }
    };
    if (this.flashFront) puff(-0.35, 0.6, 90, -11, -3);
    puff(P.X_EXIT - 0.1, 0.32, 50, 7, 15);
  }
  /**
   * low    : plain render, no post-processing at all (the safe fallback)
   * medium : shadows, bloom, heat haze, anti-aliasing
   * high   : + ambient occlusion
   * ultra  : + supersampling (heavy)
   */
  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low'; this.key.castShadow = q !== 'low';
    this.ao.enabled = q === 'high' || q === 'ultra';
    setSurfaceQuality(q, this.renderer);
    for (const r of this._lodRings || []) this._applyLod(r);   // blade rows: three levels of detail
    this._missKey = null;   // damaged copies are rebuilt from the new templates
    this.resize();
  }

  /**
   * Replace generated components with an authored glTF model.
   * manifest: { file, scale, position:[x,y,z], rotation:[x,y,z] (deg), parts: { partId: { match: "regex on node names", spool: 0|1|2 } } }
   * Matching nodes take over that component (picking, removal, glow, rotation with the spool).
   */
  async loadExternalModel(base, manifest) {
    const coreHeat = [2.0, 2.9, 0.45];
    const authoredFinish = (name, partId, casting) => {
      const tube = { tube_ss: FINISH.stainlessTube, tube_ti: { ...FINISH.titanium, scale: 10, bottom: 0.25 }, tube_cad: FINISH.cadmium, fitting: { ...FINISH.bareSteel, scale: 12 },
        clamp_block: { ...FINISH.castBare, scale: 10, bump: 0.3 }, bracket: { ...FINISH.bareSteel, scale: 10 }, vband: { ...FINISH.bareSteel, scale: 8 }, duct: { ...FINISH.stainlessTube, scale: 4 },
        tube_acc: { ...FINISH.stainlessTube, scale: 9, grime: 0.22, streak: 0.2 } }[name];
      if (tube) return partId === 'ext' && name !== 'tube_acc' ? { ...tube, heat: coreHeat } : tube;   // clearance-control tubes carry cool fan air
      return {
        cast: casting ? FINISH.castBare : FINISH.castPaint, steel: FINISH.bareSteel, gold: FINISH.chromate, dark: FINISH.darkBox, composite: FINISH.composite,
        primer: FINISH.primer, acoustic: FINISH.acoustic, clamp_red: FINISH.rubber, loom_band: FINISH.rubber, connector: FINISH.connector, firesleeve: FINISH.fireSleeve,
        panelline: FINISH.nacellePaint, panelline2: FINISH.nacellePaint, panel2: FINISH.nacellePaint, placard: FINISH.nacellePaint, hazard: FINISH.nacellePaint, marking: FINISH.nacellePaint,
        sp_dark: { ...FINISH.darkBox, bottom: 0, grime: 0.08 }, sp_white: { ...FINISH.nacellePaint, bottom: 0, grime: 0.06 }, sp_fair: { ...FINISH.titanium, bottom: 0 },
        blanket: { ...FINISH.stainlessTube, scale: 7, grime: 0.18, bump: 0.3 }, seal: FINISH.rubber, abradable: { ...FINISH.castPaint, grime: 0.12, bottom: 0.1 }, icepanel: FINISH.castPaint,
      }[name] || null;
    };
    const gltf = (await this._loadPacked(base, manifest)) || await this._loadPlain(base, manifest);
    const root = gltf.scene; root.scale.setScalar(manifest.scale || 1);
    const spinSet = new Map((manifest.spin || []).map((e) => [e.node, e]));   // gears that turn about their own axis
    if (manifest.position) root.position.fromArray(manifest.position);
    if (manifest.rotation) root.rotation.set(...manifest.rotation.map((d) => d * DEG));
    this.scene.add(root); root.updateMatrixWorld(true);
    const taken = [];
    for (const [id, rule] of Object.entries(manifest.parts || {})) {
      const part = this.byId[id]; if (!part) continue;
      const re = new RegExp(rule.match, 'i'), nodes = [];
      root.traverse((n) => { if (n.name && re.test(n.name) && !nodes.some((p) => { for (let a = n.parent; a; a = a.parent) if (a === p) return true; return false; })) nodes.push(n); });
      if (!nodes.length) continue;
      // drop the generated objects this model replaces (all of them, or only those with a listed tag)
      part.objs = part.objs.filter((ob) => { const drop = !rule.drop || rule.drop.includes(ob.userData.tag); if (drop) ob.parent.remove(ob); return !drop; });
      part.external = true; part.extMats = part.extMats || [];
      const parent = rule.spool === 1 ? this.g1 : rule.spool === 2 ? this.g2 : this.engine;
      const holder = new THREE.Group(); holder.name = `ext:${id}`; parent.add(holder);
      const own = {};
      for (const n of nodes) {
        const lvl = this._visLevel(manifest.vis, id, n.name);
        (lvl ? this._visGroup(holder, lvl) : holder).attach(n);
        n.userData.variant = /__cut$/i.test(n.name) ? 'cut' : /__full$/i.test(n.name) || nodes.some((m) => m.name === `${n.name}__cut`) ? 'full' : null;
        if (spinSet.has(n.name)) n.userData.spin = spinSet.get(n.name);
        n.traverse((m) => {
          if (!m.isMesh) return;
          const swap = (mt) => {
            if (/^i_/.test(mt.name)) return this._intMat(part, mt.name);
            if (/^txt:/.test(mt.name)) return (this._labels ||= {})[mt.name] ||= labelMaterial(mt.name.slice(4));
            const sh = this.shared[mt.name];
            if (mt.name === 'section' || mt.name === 'liner_perf' || mt.name === 'grille') return sh || mt;
            const casting = mt.name === 'cast' && /oiltank|gearbox|agb_|angb_|layshaft_|dressing|eec|starter_|sav_|idg_|hydpump_|fuelpump_|fmu_|oilpump_|pma_|exciters_|vsvact_|fdv_|accvalves_|acac_|egtbox_|mounts_/i.test(m.name);
            const key = mt.name + (casting ? ':bare' : '');
            return (own[key] ||= (() => {
              let c;
              if (sh) { c = sh.clone(); c.onBeforeCompile = sh.onBeforeCompile; c.customProgramCacheKey = sh.customProgramCacheKey; }
              else { c = mt.clone(); c.side = THREE.DoubleSide; }
              if (mt.name === 'cast') {   // one material in the file, two finishes: painted fan case, bare cast housings
                if (casting) { c.color.set(0x8c8f8c); c.metalness = 0.45; c.roughness = 0.58; } else { c.metalness = 0.05; c.roughness = 0.55; }
              }
              const f = authoredFinish(mt.name, id, casting);
              if (f) finish(c, f);
              part.extMats.push(c); return c;
            })());
          };
          m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        });
      }
      if (manifest.vis && manifest.vis.parts.includes(id)) this._mergeStatic(holder);
      this._reg(part, holder, parent); holder.userData.home = holder.position.x; holder.position.x += part.ex * this.explode * 1.5;
      taken.push(id);
    }
    this.ports = manifest.ports || this.ports || []; this.ringsMeta = manifest.rings || this.ringsMeta || [];
    // the drive train: each gearshaft keeps its rest orientation and turns about its local X
    this.spinNodes = []; this.spinRatio = {};
    for (const e of manifest.spin || []) {
      this.spinRatio[e.node] = e.ratio;
      const n = this.engine.getObjectByName(e.node); if (!n) continue;
      this.spinNodes.push({ node: n, ratio: e.ratio, q0: n.quaternion.clone(), ang: 0 });
    }
    this._spinA = null;
    if (manifest.rings) this._loadRings(root, manifest);
    this.scene.remove(root);
    // generated rows and rings that were dropped no longer need updating
    const alive = (o) => { for (let a = o; a; a = a.parent) if (a === this.scene) return true; return false; };
    this.rotorRows = this.rotorRows.filter((r) => alive(r.im)); this.vsvRows = this.vsvRows.filter(alive); this.cutInst = this.cutInst.filter(alive);
    for (const [id, kind] of [['fancowl', 'fan'], ['cna', 'cd'], ['corecowl', 'cd']]) { const p = this.byId[id]; if (p && taken.includes(id)) for (const ob of p.objs) if (/^ext:/.test(ob.name)) this._rigExternalHinges(ob, kind); }
    if (this._genBifur && this.byId.cna.objs.some((ob) => ob.getObjectByName && [...ob.children].some((c) => /^cna_bifur/.test(c.name) || [...c.children].some((g) => /^cna_bifur/.test(g.name))))) for (const m of this._genBifur) if (m.parent) m.parent.remove(m);
    this.setCutaway(this.cutaway); this.revNodes = null; this._rev = -1; this._cowlApplied = -1;
    return taken;
  }

  /** The gzipped copy of the model that the web build publishes (manifest.packed), unpacked here; null to load the plain file. */
  /** Fetch a file, or its parts (url.0, url.1 ... before any query) joined, reporting progress. */
  async _fetchJoined(url, parts) {
    const urls = parts ? Array.from({ length: parts }, (_, i) => url.replace(/(\?|$)/, `.${i}$1`)) : [url];
    const rs = await Promise.all(urls.map((u) => fetch(u)));
    for (const [i, r] of rs.entries()) if (!r.ok || !r.body) throw new Error(`${urls[i]}: ${r.status}`);
    const lens = rs.map((r) => +r.headers.get('content-length') || 0), total = lens.every((x) => x) ? lens.reduce((a, b) => a + b, 0) : 0;
    const chunks = []; let got = 0;
    for (const r of rs) {
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.byteLength; if (this.onModelProgress) this.onModelProgress(total ? Math.min(1, got / total) : null); }
    }
    return await new Blob(chunks).arrayBuffer();
  }
  async _loadPacked(base, manifest) {
    if (!manifest.packed || typeof DecompressionStream !== 'function') return null;
    try {
      let buf = await this._fetchJoined(base + manifest.packed, manifest.packedParts);
      const b = new Uint8Array(buf, 0, 4);
      if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();   // else the host already unpacked it
      return await new GLTFLoader().parseAsync(buf, base);
    } catch (e) { console.warn('packed model failed, loading the plain file', e); return null; }
  }
  /** The plain model: one file, or parts on a host with a file size limit (tools/build-web.mjs). */
  async _loadPlain(base, manifest) {
    if (!manifest.fileParts) return new GLTFLoader().loadAsync(base + manifest.file, (e) => this.onModelProgress && this.onModelProgress(e.lengthComputable ? e.loaded / e.total : null));
    return new GLTFLoader().parseAsync(await this._fetchJoined(base + manifest.file, manifest.fileParts), base);
  }
  /**
   * Merge the meshes of an authored part that share a group, a cutaway variant and a material into one mesh each:
   * the internals are hundreds of small bodies of revolution, and one draw call apiece would cost more than their
   * triangles do.
   */
  _mergeStatic(holder) {
    holder.updateMatrixWorld(true);
    const buckets = new Map(), inv = new THREE.Matrix4(), m4 = new THREE.Matrix4();
    holder.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || Array.isArray(m.material)) return;
      for (let a = m; a && a !== holder; a = a.parent) if (a.userData.spin) return;   // gears turn on their own
      let variant = null, grp = holder;
      for (let a = m; a && a !== holder; a = a.parent) { if (variant == null && a.userData.variant) variant = a.userData.variant; if (/^vis_/.test(a.name)) { grp = a; break; } }
      const key = `${grp.uuid}|${variant}|${m.material.uuid}`;
      if (!buckets.has(key)) buckets.set(key, { grp, variant, mat: m.material, meshes: [] });
      buckets.get(key).meshes.push(m);
    });
    for (const { grp, variant, mat, meshes } of buckets.values()) {
      if (meshes.length < 2) continue;
      inv.copy(grp.matrixWorld).invert();
      const geos = meshes.map((m) => {
        const g = new THREE.BufferGeometry(), src = m.geometry;
        g.setAttribute('position', src.getAttribute('position').clone()); g.setAttribute('normal', src.getAttribute('normal').clone());
        g.setIndex(src.index ? src.index.clone() : null); if (!src.index) return g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld)).toNonIndexed();
        return g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
      });
      const merged = mergeGeometries(geos.filter((g) => g.index), false); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat); mesh.name = `merged:${meshes[0].name}`;
      if (variant) mesh.userData.variant = variant;
      grp.add(mesh);
      for (const m of meshes) m.parent.remove(m);
    }
    // drop the groups left empty
    const empty = []; holder.traverse((n) => { if (n !== holder && !n.isMesh && !/^vis_/.test(n.name) && !n.children.length) empty.push(n); });
    for (const n of empty) n.parent.remove(n);
  }
  /** Detail for the quality setting: the full templates (cooling holes, squealer tips, dense airfoils) on high and ultra, a lighter set on medium, simple airfoils on low. */
  _lodGeo(lod) { const q = this.quality; return q === 'low' ? lod.lo : q === 'medium' ? lod.mid : lod.hi; }
  _applyLod(r) {
    r.im.geometry = this._lodGeo(r.lod);
    if (r.inner) r.im.castShadow = this.quality === 'high' || this.quality === 'ultra';   // blades inside the cases cast shadows only at the top settings
  }
  /** Material for an authored internal: the part's own where it has one for that role, else a finished copy owned by the part. */
  _intMat(part, name) {
    const key = `${part.id}:${name}`; this._intMats ||= {};
    if (this._intMats[key]) return this._intMats[key];
    if (name === 'i_bolt') return (this._intMats[key] = this.boltMat);
    if (name === 'i_bare') return (this._intMats[key] = this.shared.bare);
    if ((INT_PART_MAT[part.id] || []).includes(name)) return (this._intMats[key] = part.mat);
    const d = INT_MATS[name] || INT_MATS.i_steel, { f, bottom, grime, ...base } = d;
    const m = new THREE.MeshPhysicalMaterial({ ...base, side: THREE.DoubleSide });
    finish(m, { ...FINISH[f], ...(bottom != null ? { bottom } : {}), ...(grime != null ? { grime } : {}), ...(INT_HEAT[part.id] ? { heat: INT_HEAT[part.id] } : {}) });
    (part.extMats ||= []).push(m);
    return (this._intMats[key] = m);
  }
  /**
   * Visibility tier of an authored internal: 'core' for what sits under the core cowl (cases, flanges, VSV levers,
   * injectors), 'inner' for what is inside the cases; null for what can be seen from outside (fan, booster inlet,
   * exhaust). Hidden tiers are not drawn at all, which keeps the closed engine cheap to render.
   */
  _visLevel(vis, id, name) {
    if (!vis || !vis.parts.includes(id)) return null;
    const base = (name || '').replace(/__(cut|full)$/i, '');
    this._visRe ||= { out: new RegExp(vis.out), core: new RegExp(vis.core) };
    return this._visRe.out.test(base) ? null : this._visRe.core.test(base) ? 'core' : 'inner';
  }
  _visGroup(parent, lvl) {
    const k = `vis_${lvl}`;
    if (!parent.userData[k]) { const g = new THREE.Group(); g.name = k; parent.add(g); parent.userData[k] = g; (this._visGroups ||= { core: [], inner: [] })[lvl].push(g); }
    return parent.userData[k];
  }
  _updateVis() {
    if (!this._visGroups) return;
    const rm = (id) => this.byId[id] && this.byId[id].removed;
    const inner = this.cutaway || this.explode > 0.01 || this.borescope.on || ['lpccase', 'hpccase', 'combcase', 'hptcase', 'lptcase', 'tec', 'agb', 'angb', 'layshaft'].some(rm);
    const core = inner || rm('corecowl') || this.cowl.cd > 0.01;
    for (const g of this._visGroups.inner) g.visible = inner;
    for (const g of this._visGroups.core) g.visible = core;
  }
  /**
   * Rings of identical items from templates (manifest.rings): each template node holds one blade, vane, bolt...
   * at angle 0, and is drawn as one instanced mesh at count equal angles. Rotors turn with their spool and drop
   * the instances inside the deep cut; static rings drop those inside the cutaway wedge (or the deep cut). Blade
   * rows carry a simpler '_lo' template for the low quality setting.
   */
  _loadRings(root, manifest) {
    const inv = root.matrixWorld.clone().invert(), m4 = new THREE.Matrix4();
    root.updateMatrixWorld(true);
    const template = (name) => {
      const node = name && root.getObjectByName(name); if (!node) return null;
      const geos = [], mats = [];
      node.traverse((m) => {
        if (!m.isMesh) return;
        const g = new THREE.BufferGeometry(), src = m.geometry;
        g.setAttribute('position', src.getAttribute('position').clone()); g.setAttribute('normal', src.getAttribute('normal').clone()); if (src.index) g.setIndex(src.index.clone());
        g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
        geos.push(g); mats.push(Array.isArray(m.material) ? m.material[0] : m.material);
      });
      if (!geos.length) return null;
      const geo = geos.length > 1 ? mergeGeometries(geos, true) : geos[0];
      if (geos.length === 1) geo.addGroup(0, geo.index ? geo.index.count : geo.attributes.position.count, 0);
      return { geo, mats };
    };
    const groups = { 0: this.engine, 1: this.g1, 2: this.g2 }, dropped = new Set(), m = new THREE.Matrix4();
    const vsvGain = { hpccase_igv: 1, hpccase_vsv1: 0.85, hpccase_vsv2: 0.65, hpccase_vsv3: 0.45 };
    this._lodRings = [];
    for (const e of manifest.rings) {
      const part = this.byId[e.part]; if (!part) continue;
      if (!dropped.has(part.id)) { dropped.add(part.id); part.objs = part.objs.filter((ob) => { const d = ob.userData.tag === 'internal'; if (d && ob.parent) ob.parent.remove(ob); return !d; }); }
      const hi = template(e.node); if (!hi) continue;
      const lo = template(e.lo), mid = template(e.mid);
      if (lo) { lo.geo.clearGroups(); lo.geo.addGroup(0, lo.geo.index ? lo.geo.index.count : lo.geo.attributes.position.count, 0); }
      if (mid && !mid.mats.every((m, i) => hi.mats[i] && hi.mats[i].name === m.name)) mid.geo = null;   // the levels share their materials (the full one may add some: cooling holes, nuts)
      const spool = e.kind === 'rotor' ? e.spool || 0 : 0, base = e.node.replace(/^ring_/, '');
      const lvl = this._visLevel(manifest.vis, part.id, base);
      const parent = lvl ? this._visGroup(groups[spool], lvl) : groups[spool];
      const mats = hi.mats.map((mt) => (/^i_/.test(mt.name) ? this._intMat(part, mt.name) : mt.name === 'section' ? this.capMat : this._intMat(part, 'i_steel')));
      const ths = Array.from({ length: e.count }, (_, i) => (e.phase || 0) * DEG + (i / e.count) * TAU);
      let place = (mm, th) => mm.makeRotationX(th);
      if (e.kind === 'vsv') {   // variable vanes turn about their spindle (radial, at x = xs)
        const xs = e.xs, gain = vsvGain[base] ?? 0.7, a = new THREE.Matrix4(), b = new THREE.Matrix4(), r = new THREE.Matrix4();
        a.makeTranslation(xs, 0, 0); b.makeTranslation(-xs, 0, 0);
        const at = (deg) => { r.makeRotationY(-deg * gain * DEG); const k = a.clone().multiply(r).multiply(b); return (mm, th) => mm.makeRotationX(th).multiply(k); };
        place = at(0); e._vsvAt = at;
      }
      const hide = spool ? null : e.cut === 'deep' ? inDeep : e.cut ? inCut : null;
      if (hide) ths.sort((p, q) => hide(p) - hide(q));
      const lod = { hi: hi.geo, mid: (mid && mid.geo) || hi.geo, lo: lo ? lo.geo : (mid && mid.geo) || hi.geo };
      const im = new THREE.InstancedMesh(this._lodGeo(lod), mats, e.count);
      ths.forEach((th, i) => { place(m, th); im.setMatrixAt(i, m); });
      im.userData.ths = ths; im.userData.place = place; im.name = e.node;
      if (hide) { im.userData.kept = ths.filter((t) => !hide(t)).length; this.cutInst.push(im); }
      if (spool && e.blade) im.userData.row = { xm: e.x, ring: true };
      const whole = part.id === 'fan' && /^fan_(blade|filler)/.test(base);   // the fan is outside the core: never sectioned
      if (spool && !whole) this.rotorRows.push({ im, group: groups[spool], part });
      if (e.kind === 'vsv') { im.userData.vsvAt = e._vsvAt; this.vsvRows.push(im); }
      im.computeBoundingSphere();
      this._reg(part, im, parent);
      im.userData.home = 0; im.position.x = part.ex * this.explode * 1.5;
      const lr = { im, lod, inner: !!e.blade && lvl === 'inner' }; this._lodRings.push(lr); this._applyLod(lr);
    }
    this._vsv = null;   // re-place the variable vanes on the next frame
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);   // phones: capped lower to spare the GPU
    const pr = this.quality === 'ultra' ? Math.max(dpr, 1.5) : dpr;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(r.width, r.height, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    // The 30 deg field of view is vertical. On a screen narrower than 1.5:1 (a phone held upright) keep the
    // horizontal field instead, so the whole engine still fits across.
    const REF = 1.5, a = this.camera.aspect;
    this.camera.fov = a >= REF ? 30 : Math.min(80, (2 * Math.atan(Math.tan((30 * Math.PI) / 360) * (REF / a)) * 180) / Math.PI);
    if (this.offsetX || this.offsetY) this.camera.setViewOffset(r.width, r.height, this.offsetX, this.offsetY, r.width, r.height); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.haze.uniforms.uAspect.value = r.width / r.height;
  }

  // ------------------------------------------------------------------ frame
  update(o, dt, env) {
    this.t += dt;
    const t = this.t, ob = this.orbit;
    const ce = Math.cos(ob.el);
    this.camera.position.set(ob.target.x + ob.dist * Math.sin(ob.az) * ce, ob.target.y + ob.dist * Math.sin(ob.el), ob.target.z + ob.dist * Math.cos(ob.az) * ce);
    if (this.flash > 0.05) this.camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(0.05 * this.flash));
    this.camera.lookAt(ob.target); this.camera.updateMatrixWorld();
    if (this.borescope.on) this.borescope.apply(this.camera, dt);

    // spools: display speed is compressed so blades stay readable; the blur disc sells the rest
    const p1 = Math.abs(o.N1pct) / 100, p2 = o.N2pct / 100;
    this.g1.rotation.x += Math.sign(o.N1) * Math.pow(p1, 0.55) * 16 * dt;
    this.g2.rotation.x += Math.pow(p2, 0.55) * 26 * dt;
    if (this.spinNodes && this.spinNodes.length) {   // the drive train follows the HP spool's angle
      const a = this.g2.rotation.x, d = this._spinA == null ? 0 : a - this._spinA; this._spinA = a;
      if (d) for (const s of this.spinNodes) { s.ang = (s.ang + s.ratio * d) % TAU; s.node.quaternion.copy(s.q0).multiply(_spinQ.setFromAxisAngle(_X, s.ang)); }
    }
    this._missing(this.failState);
    const miss = this._miss, anyMiss = !!(miss && miss.size);
    if (this.cutaway || this._deepShown || anyMiss || this._missShown) {
      const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (const { im, group } of this.rotorRows) {
        const a = group.rotation.x, ths = im.userData.ths, place = im.userData.place, gone = anyMiss ? miss.get(im) : null;   // released blades stay hidden
        for (let i = 0; i < ths.length; i++) { if ((this.cutaway && inDeep(ths[i] + a)) || (gone && gone.has(i))) im.setMatrixAt(i, zero); else { place(m, ths[i]); im.setMatrixAt(i, m); } }
        im.instanceMatrix.needsUpdate = true;
      }
      this._deepShown = this.cutaway; this._missShown = anyMiss;
    }
    for (const d of this._dmgMeshes || []) {   // damaged copies follow the cutaway like the rows they belong to
      const th = d.im.userData.ths[d.i] + (d.group ? d.group.rotation.x : 0);
      d.mesh.visible = d.im.visible && !(this.cutaway && (d.rotor ? inDeep(th) : inCut(th)));
    }
    this.fanBlur.material.opacity = this.byId.fan.removed ? 0 : clamp(p1 * 0.2, 0, 0.16);
    this.fanBlur.position.x = 0.16 + this.byId.fan.ex * this.explode * 1.5;
    this._reverser(o.rev || 0);
    this._cowls(o, dt);
    this._updateVis();
    this._lastThrust = o.thrust;
    if (this.apronSim) this.apronView.update(this.apronSim, dt, t);

    // variable stators turn about their own radial axis
    if (Math.abs(o.vsv - (this._vsv ?? 1e9)) > 0.2) {
      this._vsv = o.vsv;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.vsv * DEG), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1);
      for (const im of this.vsvRows) {
        if (im.userData.vsvAt) { const pl = (im.userData.place = im.userData.vsvAt(o.vsv)); im.userData.ths.forEach((th, i) => { pl(m, th); im.setMatrixAt(i, m); }); im.instanceMatrix.needsUpdate = true; continue; }
        const { xm, lo } = im.userData.row;
        im.userData.ths.forEach((th, i) => { q.setFromAxisAngle(ax, th).multiply(q2); m.compose(new THREE.Vector3(xm, lo * Math.cos(th), lo * Math.sin(th)), q, one); im.setMatrixAt(i, m); });
        im.instanceMatrix.needsUpdate = true;
      }
    }

    // incandescent metal + hover / selection highlight
    for (const p of this.parts) {
      let r = 0, g = 0, b = 0;
      if (p.glow) { const k = clamp((p.glow(o) - 800) / 650, 0, 1); r = 2.2 * k; g = (0.2 + 0.75 * k) * k; b = 0.3 * k * k; }
      if (p === this.selected) { r += 0.03; g += 0.16; b += 0.26; } else if (p === this.hover) { r += 0.012; g += 0.07; b += 0.12; }
      if (this.failedParts.has(p.id)) { const k = 0.5 + 0.5 * Math.sin(t * 6); r += 0.22 * k; g += 0.01 * k; }   // a failed part pulses red
      if (p.mat.emissive) p.mat.emissive.setRGB(r, g, b);
      if (p.extMats) for (const m of p.extMats) m.emissive.setRGB(r, g, b);
    }

    this._failFrame(o, dt);
    const fill = (pts, n, fn) => { const pos = pts.geometry.attributes.position.array, col = pts.geometry.attributes.color.array; for (let i = 0; i < n; i++) fn(i, pos, col, i * 3); pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; };
    // ---- airflow streaks
    const show = this.showFlow;
    this.air.visible = show;
    if (show) {
      const vB = Math.sign(o.Wbypass) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wbypass) / 315)) * (Math.abs(o.Wbypass) > 0.5 ? 1 : 0);
      const vC = Math.sign(o.Wcore) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wcore) / 70)) * (Math.abs(o.Wcore) > 0.05 ? 1 : 0);
      const cB = tempRGB(o.T13 + 120), c2 = tempRGB(o.T2 + 120), c25 = tempRGB(o.T25 + 150), c3 = tempRGB(o.T3 + 150), c4 = tempRGB(o.T4 + 150), c5 = tempRGB(o.T5 + 150);
      const ex = this.explode, x0 = P.X_IN - 1.1, span = P.X_EXIT + 1.6 - (P.X_IN - 1.1), swirl1 = 0.5 * p1, swirl2 = 0.4 * p2;
      const pos = this.air.geometry.attributes.position.array, col = this.air.geometry.attributes.color.array;
      // where a particle sits for a given progress u along its path
      const at = (p, u, out) => {
        const x = x0 + u * span; let lo, hi, c, a = 1;
        if (x < 0) { const XI = P.X_IN, far = x < XI ? 1 + (XI - x) * 0.8 : 1; hi = rAt(P.inletInner, Math.max(x, XI)) * far; lo = 0; c = c2; if (p.core) hi *= 0.42; else lo = hi * 0.42; a = x < XI ? 0.35 : 0.75; }
        else if (x < 0.4) { lo = rAt(P.spinner, x); hi = 0.8; c = c2; const m = lerp(lo, hi, 0.36); if (p.core) hi = m; else lo = m; }
        else if (p.core) { lo = rAt(P.coreInner, Math.min(x, 3.95)); hi = x > 3.12 ? lerp(0.44, 0.3, clamp((x - 3.12) / 2.0, 0, 1)) : rAt(P.coreOuter, x); c = x < 1.0 ? c25 : x < 1.9 ? c3 : x < 2.3 ? c4 : c5; a = x > P.X_EXIT - 0.2 ? clamp(1 - (x - P.X_EXIT + 0.2) / 1.1, 0, 1) : 1; }
        else { lo = x > 3.12 ? lerp(0.46, 0.3, clamp((x - 3.12) / 2.0, 0, 1)) : rAt(P.bypInner, x); hi = rAt(P.bypOuter, Math.min(x, P.X_EXIT)); c = cB; a = x > P.X_EXIT ? clamp(1 - (x - P.X_EXIT) / 0.9, 0, 1) : 1; }
        const rr = lerp(lo, hi, 0.06 + 0.88 * p.v);
        // swirl picked up from the rotating blade rows, taken out again by the stators behind them
        const sw = p.core ? swirl2 * (bell(x, 1.5, 0.35) + bell(x, 2.32, 0.1)) + swirl1 * (bell(x, 0.65, 0.2) + bell(x, 2.72, 0.25)) : swirl1 * bell(x, 0.35, 0.3);
        const th = p.th + sw * 2.2;
        const yy = rr * Math.cos(th);
        out[0] = scarfX(x, yy) + ex * 0.2 * (x - 1.5); out[1] = yy - scarfDroop(x); out[2] = rr * Math.sin(th); out[3] = c; out[4] = a;
      };
      const h = [0, 0, 0, null, 0], tl = [0, 0, 0, null, 0];
      for (let i = 0; i < this.nAir; i++) {
        const p = this.airP[i], v = (p.core ? vC : vB) * p.k;
        p.u += (v * dt) / span;
        if (p.u > 1 || p.u < 0) { p.u -= Math.floor(p.u); p.v = Math.random(); p.th = Math.random() * TAU; }
        const len = clamp(Math.abs(v) * 0.045, 0.012, 0.16) / span * Math.sign(v || 1);
        at(p, p.u, h); at(p, clamp(p.u - len, 0, 1), tl);
        const j = i * 6, k = v === 0 ? 0 : h[4] * 0.85, c = h[3];
        pos[j] = h[0]; pos[j + 1] = h[1]; pos[j + 2] = h[2]; pos[j + 3] = tl[0]; pos[j + 4] = tl[1]; pos[j + 5] = tl[2];
        col[j] = c[0] * k; col[j + 1] = c[1] * k; col[j + 2] = c[2] * k; col[j + 3] = 0; col[j + 4] = 0; col[j + 5] = 0;
      }
      this.air.geometry.attributes.position.needsUpdate = true; this.air.geometry.attributes.color.needsUpdate = true;
    }
    // ---- fuel spray and flame
    const exC = this.byId.liner.ex * this.explode * 1.5;
    const fuelOn = o.wf > 0.002 && show;
    this.fuelP.visible = fuelOn;
    if (fuelOn) fill(this.fuelP, 240, (i, pos, col, j) => { const th = ((i % 20) / 20) * TAU + 0.157, f = (t * 3 + i * 0.137) % 1, cone = (((i * 7) % 11) / 11 - 0.5) * 0.06 * f, r = 0.25 + cone; pos[j] = 1.955 + f * 0.085 + exC; pos[j + 1] = r * Math.cos(th + cone * 2); pos[j + 2] = r * Math.sin(th + cone * 2); const k = (1 - f) * clamp(o.wf / 0.4, 0.25, 1); col[j] = k; col[j + 1] = 0.85 * k; col[j + 2] = 0.25 * k; });
    const inten = o.lit ? clamp(o.farBurn / 0.026, 0.2, 1.4) : 0;
    this.flameLight.intensity = inten * (1.1 + 0.25 * Math.sin(t * 40)); this.flameLight.position.x = 2.05 + exC;
    for (const m of this.flameSheets) { m.visible = inten > 0; m.position.x = exC; m.material.uniforms.uT.value = t % 1000; m.material.uniforms.uI.value = inten; }
    const F = this.fail, jet = clamp(o.W9 / 150, 0, 1);
    this.sparks.set(t, F.sparks, 3.45, FLOOR_Y);
    this.smokeTail.u.uSpeed.value = 1.2 + 9 * jet;
    this.smokeTail.set(t, F.smoke * (F.fire > 0 && jet < 0.05 ? 0.25 : 1));
    FX.uLightV.value.copy(this.key.position).sub(this.key.target.position).transformDirection(this.camera.matrixWorldInverse);
    const flick = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 6.3 + 1);
    this.smokeFire.u.uGlow.value.set(1.0, 0.4, 0.08).multiplyScalar(0.8 * F.fire * flick);
    this.smokeFire.set(t, F.fire); this.flames.set(t, F.fire);
    if (F.fire > 0.05 && dt > 0) {   // embers lifted out of the flames
      const fo = this.flames.u.uOrigin.value, fb = this.flames.u.uBox.value, ne = Math.floor(30 * F.fire * dt + Math.random());
      for (let i = 0; i < ne; i++) this.embers.emit(fo.x + (Math.random() - 0.5) * fb.x, fo.y + 0.1, fo.z + (Math.random() - 0.5) * (fb.z + 0.3), (Math.random() - 0.5) * 0.6, 1 + 1.5 * Math.random(), (Math.random() - 0.5) * 0.6, 1, 1, 1, 1, 1.2 + 1.5 * Math.random(), { cool: true, up: 9.81 + 0.6, drag: 0.6 });
    }
    this.fireLight.intensity = F.fire * (5 + 2 * Math.sin(t * 23) + 1.5 * Math.sin(t * 37));
    const torchK = clamp(Math.max(o.wfUnburnt, o.torch || 0) / 0.05, 0, 1) + (o.lit && o.pool > 0.02 ? 0.6 : 0);
    this.torch.u.uSpeed.value = 3 + 14 * jet; this.torch.set(t, clamp(torchK, 0, 1));

    // ---- exhaust plume and heat haze
    const thr = clamp(o.Fg / 140e3, 0, 1), hotK = clamp((o.T5 - 400) / 500, 0, 1);
    const L = 1.2 + 5.5 * Math.sqrt(thr);
    const setPl = (m, len, a, sp) => { m.scale.set(len, 1, 1); m.material.uniforms.uT.value = t % 1000; a *= 0.3; m.material.uniforms.uA.value = a; m.material.uniforms.uSpeed.value = sp; m.visible = a > 0.004; };
    // Seen end-on (from directly behind or in front) the layered plume would stack into one large
    // opaque blob over the engine, so it fades out as the view lines up with the engine axis.
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const endOn = clamp((Math.abs(fwd.x) - 0.7) / 0.25, 0, 1), pk = 1 - endOn * endOn * (3 - 2 * endOn);
    for (const m of [this.plumeOuter, this.plumeMid, this.plumeCore, this.plumeHot]) m.visible = false; // the nested shells read as tubes; replaced by the glow below
    this.jetGlow.u.uSpeed.value = 4 + 22 * thr; this.jetGlow.set(t, clamp(hotK * (0.25 + 0.75 * thr) * (o.W9 > 5 ? 1 : 0.3), 0, 1) * pk);
    const XE = P.X_EXIT, hz = this.haze.uniforms, a = new THREE.Vector3(XE - 0.25, 0, 0).project(this.camera), b = new THREE.Vector3(XE + 0.05 + L * 1.1, 0.25, 0).project(this.camera);
    const edge = new THREE.Vector3(XE - 0.25, 0.6, 0).project(this.camera);
    hz.uA.value.set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5); hz.uB.value.set(b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
    hz.uR.value = Math.max(0.02, Math.hypot((edge.x - a.x) * 0.5 * this.camera.aspect, (edge.y - a.y) * 0.5)) * 1.3;
    // only when the whole plume axis is in front of the camera (projection is meaningless behind it)
    const va = new THREE.Vector3(XE - 0.25, 0, 0).applyMatrix4(this.camera.matrixWorldInverse), vb = new THREE.Vector3(XE + 0.05 + L * 1.1, 0.25, 0).applyMatrix4(this.camera.matrixWorldInverse);
    const inFront = va.z < -0.3 && vb.z < -0.3;
    hz.uR.value = clamp(hz.uR.value, 0.01, 0.3);
    hz.uK.value = inFront && this.fx.haze && pk > 0.5 ? clamp((o.T7 - 310) / 120, 0, 1) * clamp(o.W9 / 60, 0, 1) : 0; hz.uT.value = (t * (0.6 + 2 * thr)) % 1000;
    this.haze.enabled = hz.uK.value > 0.01;

    // ---- inlet condensation and ground vortex (physics in main.js inletWeather)
    const fogA = env ? env.fog : 0, vx = env ? env.vortex : 0;
    this.fogK += (fogA - this.fogK) * Math.min(1, dt * 2);
    this.fog.u.uSpeed.value = 0.6 + 2.6 * p1; this.fog.u.uSwirl.value = 0.3 + 0.9 * p1;
    this.fog.set(t, this.fogK);
    const vk = (this._vk = (this._vk || 0) + (vx - (this._vk || 0)) * Math.min(1, dt * 1.5));
    const av = this.apronView && this.apronView.on && this.apronSim ? this.apronSim.vtx : null;   // on the apron the rope follows the simulated vortex
    const foot = av ? [av.x, av.z] : [-1.42 + 0.14 * Math.sin(t * 0.7) + 0.05 * Math.sin(t * 2.3), 0.28 * Math.sin(t * 0.43)];
    this.vortexRopes.forEach((m, k) => { const u = m.material.uniforms; m.visible = vk > 0.01; u.uT.value = t % 1000; u.uK.value = vk * (k === 0 ? 0.3 + 0.4 * fogA : 0.1 + 0.15 * fogA); u.uFoot.value.set(foot[0], FLOOR_Y, foot[1]); });
    // dust and spray kicked up where the vortex touches the ground
    this.dust.u.uOrigin.value.set(foot[0], FLOOR_Y + 0.06, foot[1]); this.dust.set(t, vk);

    // ---- surge: the flash fades (the fireball itself was emitted by surge())
    if (this.flash > 0.03) this.flash *= Math.pow(0.004, dt);
    if (this.quality === 'low' && !this.borescope.on) {   // no post-processing: smoke and fire go in the one render, with plain depth testing
      FX.uSoftOn.value = 0; this.camera.layers.enable(2); this.renderer.render(this.scene, this.camera); this.camera.layers.disable(2);
    } else this.composer.render();
  }
}
