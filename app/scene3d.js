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
import { P, ROWS, rAt, tempRGB } from './cutaway.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const FLOOR_Y = -1.75;
// Cutaway wedge: the sector of casing that is removed, in the angle convention
// used for instances (y = r cos th, z = r sin th). Camera side, upper quarter.
const CUT_A = -8 * DEG, CUT_B = 112 * DEG;
const inCut = (th) => { const t = ((th % TAU) + TAU) % TAU; return t > TAU + CUT_A || t < CUT_B; };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(...repeat); t.anisotropy = 8; return t;
}
const softSprite = () => { const t = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }); t.colorSpace = THREE.SRGBColorSpace; return t; };
// perforated acoustic liner
const linerTex = () => canvasTex(64, 64, (g) => { g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#1c1c1c'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 3.2, 0, 7); g.fill(); } }, [150, 18]);
// fine circumferential machining marks
const brushedTex = () => canvasTex(8, 256, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 110 + Math.random() * 80; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, w, 1); } }, [1, 6]);

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
  const nS = o.nSpan || 7, nP = o.nProf || 9, pos = [], idx = [];
  const prof = [];
  for (let i = 0; i <= nP; i++) prof.push([i / nP, 1]);
  for (let i = nP - 1; i >= 1; i--) prof.push([i / nP, -1]);
  const L = prof.length;
  for (let s = 0; s <= nS; s++) {
    const f = s / nS, c = lerp(o.chord[0], o.chord[1], f), a = lerp(o.stagger[0], o.stagger[1], f), m = lerp(o.camber[0], o.camber[1], f), t = lerp(o.thick[0], o.thick[1], f);
    const sw = (o.sweep || 0) * Math.sin(f * Math.PI * 0.9) + (o.rake || 0) * f, ca = Math.cos(a), sa = Math.sin(a);
    for (const [x, side] of prof) {
      const xx = 0.5 * (1 - Math.cos(Math.PI * x)); // cluster points at the edges
      const yt = 5 * t * (0.2969 * Math.sqrt(xx) - 0.126 * xx - 0.3516 * xx * xx + 0.2843 * xx ** 3 - 0.1036 * xx ** 4);
      const X = (xx - 0.5) * c, Z = (m * 4 * xx * (1 - xx) + side * yt) * c;
      pos.push(X * ca - Z * sa + sw, f * o.span, X * sa + Z * ca);
    }
  }
  for (let s = 0; s < nS; s++) for (let i = 0; i < L; i++) { const a = s * L + i, b = s * L + ((i + 1) % L), c2 = a + L, d = b + L; idx.push(a, c2, b, b, c2, d); }
  const tip = nS * L; for (let i = 1; i < L - 1; i++) idx.push(tip, tip + i + 1, tip + i);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
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
    scene.background = new THREE.Color(0x0e0f11);
    scene.fog = new THREE.Fog(0x0e0f11, 16, 42);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.05, 90);
    this.orbit = { az: -0.72, el: 0.2, dist: 9.6, target: new THREE.Vector3(1.45, -0.05, 0) };
    this.offsetX = 0; this.offsetY = 0;
    const key = (this.key = new THREE.DirectionalLight(0xfff4e6, 2.0)); key.position.set(-2.5, 7, 6); key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 2.5;
    Object.assign(key.shadow.camera, { left: -4.5, right: 5.5, top: 4, bottom: -4, near: 1, far: 22 }); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2ff, 1.4); rim.position.set(5, 3, -7); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(2, -1, 6); scene.add(fill);
    this.flameLight = new THREE.PointLight(0xff8a30, 0, 3.5, 1.6); this.flameLight.position.set(2.05, 0, 0); scene.add(this.flameLight);

    this.cutaway = true; this.explode = 0; this.showFlow = true; this.quality = 'medium';
    this.parts = []; this.byId = {}; this.vsvRows = []; this.cutInst = []; this.hover = null; this.selected = null;
    this.sprite = softSprite(); this.tex = { liner: linerTex(), brushed: brushedTex() };
    this.capMat = new THREE.MeshStandardMaterial({ color: 0xb8402a, metalness: 0.1, roughness: 0.7, side: THREE.DoubleSide });
    this.t = 0; this.flash = 0;
    this.engine = new THREE.Group(); scene.add(this.engine);
    this.g1 = new THREE.Group(); this.g2 = new THREE.Group(); this.engine.add(this.g1, this.g2);
    this._buildStage();
    this._buildEngine();
    this._buildEffects();
    this._buildPost();
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
  _reg(part, obj, parent = this.engine) {
    obj.traverse((m) => { if (m.isMesh) { m.userData.part = part; m.castShadow = true; m.receiveShadow = true; } });
    part.objs.push(obj); parent.add(obj); return obj;
  }
  /** Solid of revolution. Static parts get a full version and a wedge-cut version with section faces. */
  _solid(part, loop, o = {}) {
    const mat = o.mat || part.mat, seg = o.seg || 120, parent = o.parent || this.engine, g = new THREE.Group();
    const full = new THREE.Mesh(lathe(loop, seg), mat); g.add(full);
    if (o.cut !== false && parent === this.engine) {
      // lathe angle phi relates to instance angle th by th = phi + 90 deg
      const cut = new THREE.Mesh(lathe(loop, Math.round(seg * 0.67), CUT_B - Math.PI / 2, TAU - (CUT_B - CUT_A)), mat);
      const caps = new THREE.Group();
      caps.add(new THREE.Mesh(capGeo(loop, CUT_B), this.capMat), new THREE.Mesh(capGeo(loop, CUT_A), this.capMat));
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
  _row(part, row, count, parent, b, o = {}) {
    const xm = (row.x0 + row.x1) / 2, lo = rAt(row.lo, xm) - 0.004, hi = rAt(row.hi, xm) - (row.kind === 'rotor' ? 0.005 : 0);
    const c = (row.x1 - row.x0) * (b.chordK || 1.15);
    const geo = bladeGeo({ span: hi - lo, chord: [c * (b.rootK || 1), c * (b.tipK || 0.85)], stagger: b.stagger, camber: b.camber || [0.08, 0.04], thick: b.thick || [0.1, 0.06], sweep: b.sweep, rake: b.rake, nSpan: b.nSpan, nProf: b.nProf });
    const q = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1);
    const im = this._ring(part, geo, count, (m, th) => { q.setFromAxisAngle(ax, th); m.compose(new THREE.Vector3(xm, lo * Math.cos(th), lo * Math.sin(th)), q, one); }, { parent, mat: o.mat });
    im.userData.row = { xm, lo };
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
    const caseM = { color: 0x7d858c, metalness: 0.9, roughness: 0.46, roughnessMap: T.brushed };
    const hotM = { color: 0x8a7868, metalness: 0.95, roughness: 0.42, roughnessMap: T.brushed };
    const composite = { color: 0x24272b, metalness: 0.1, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.5 };
    const linerM = new THREE.MeshPhysicalMaterial({ color: 0x8f959b, metalness: 0.5, roughness: 0.75, map: T.liner, side: THREE.DoubleSide });
    this.boltMat = new THREE.MeshStandardMaterial({ color: 0xbfc5ca, metalness: 1, roughness: 0.3 });
    const pipeSteel = new THREE.MeshStandardMaterial({ color: 0xc3c8cc, metalness: 1, roughness: 0.25 });
    const pipeGold = new THREE.MeshStandardMaterial({ color: 0xc79a3b, metalness: 1, roughness: 0.3 });
    const harness = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.1, roughness: 0.7 });
    this.shared = { paint: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...paint }), lip: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...polished }), section: this.capMat };
    const C = (K) => `${(K - 273.15).toFixed(0)} °C`, B = (p) => `${(p / 1e5).toFixed(2)} bar`;
    const A = (d) => this._part(d);

    // ---------------- nacelle
    const inlet = A({ id: 'inlet', name: 'Inlet cowl', ex: -1.5, mat: paint, desc: 'Slows and straightens the incoming air for the fan. The inner barrel is a perforated acoustic liner that absorbs fan noise.', live: (o) => `Airflow ${o.W2.toFixed(0)} kg/s · inlet ${C(o.T2)}, ${B(o.P2)}` });
    this._solid(inlet, [...sample(P.nacelle, -0.69, 0.0, 12), ...sample(offset(P.inletInner, 0.012), -0.69, 0.0, 12).reverse()], { tag: 'skin' });
    this._solid(inlet, [...sample(offset(P.inletInner, 0.012), -0.66, 0.0, 10), ...sample(P.inletInner, -0.66, 0.0, 10).reverse()], { mat: linerM });
    const lip = A({ id: 'lip', name: 'Inlet lip', ex: -1.7, mat: polished, desc: 'Polished aluminium leading edge, heated with engine bleed air so ice cannot build up and break off into the fan.', live: () => '' });
    this._solid(lip, [[-0.66, 0.768], [-0.7, 0.772], [-0.745, 0.782], [-0.778, 0.805], [-0.79, 0.84], [-0.778, 0.885], [-0.74, 0.918], [-0.69, 0.93], [-0.69, 0.9], [-0.72, 0.89], [-0.75, 0.862], [-0.757, 0.84], [-0.748, 0.815], [-0.72, 0.798], [-0.66, 0.79]], { tag: 'skin' });
    const fanCase = A({ id: 'fancase', name: 'Fan case and outlet guide vanes', ex: -0.55, mat: paint, desc: 'Contains the fan, and a released blade if one ever fails. The outlet guide vanes take the swirl out of the bypass air.', live: (o) => `Bypass ${o.Wbypass.toFixed(0)} kg/s · fan pressure ratio ${o.fan.PR.toFixed(2)} · ${C(o.T13)}` });
    const fanCowl = A({ id: 'fancowl', name: 'Fan cowl doors', ex: -0.55, mat: paint, desc: 'Two hinged doors that close around the fan case. Remove them to see the bare fan case with the oil tank, the accessory gearbox and the pipework that normally hide underneath.', live: () => '' });
    this._solid(fanCowl, band(offset(P.bypOuter, 0.014), P.nacelle, 0.0, 1.2, 14), { tag: 'skin' });
    this._solid(fanCase, band(P.bypOuter, offset(P.bypOuter, 0.014), 0.36, 1.2, 10), { mat: linerM });
    // light blue abradable fan track liner around the blade tips (reference photos)
    this._solid(fanCase, band(P.bypOuter, offset(P.bypOuter, 0.014), 0.0, 0.36, 4), { mat: new THREE.MeshStandardMaterial({ color: 0x9cc9e6, metalness: 0, roughness: 0.8, side: THREE.DoubleSide }) });
    const cna = A({ id: 'cna', name: 'Thrust reverser cowls and common nozzle', ex: 0.2, mat: paint, desc: 'The long duct carries bypass air aft, where it mixes with the core exhaust and leaves through one common nozzle.', live: (o) => `Mixed jet ${o.V9.toFixed(0)} m/s (Mach ${o.M9.toFixed(2)}) · ${C(o.T7)} · ${o.W9.toFixed(0)} kg/s` });
    this._solid(cna, band(offset(P.bypOuter, 0.012), P.nacelle, 1.2, 2.86, 20), { tag: 'skin' });
    // unpainted common nozzle at the rear, with a visible step from the painted cowl
    this._solid(cna, band(offset(P.bypOuter, 0.012), offset(P.nacelle, -0.008), 2.86, 3.55, 10), { tag: 'skin', mat: (this.shared.bare = new THREE.MeshPhysicalMaterial({ color: 0x8e9499, metalness: 1, roughness: 0.36, roughnessMap: T.brushed, side: THREE.DoubleSide })) });
    // nacelle strake, high on the side
    const stS = new THREE.Shape(); stS.moveTo(0, 0); stS.lineTo(0.62, 0); stS.lineTo(0.56, 0.1); stS.lineTo(0.2, 0.035); stS.lineTo(0, 0);
    const strake = new THREE.Mesh(new THREE.ExtrudeGeometry(stS, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 }).translate(0.25, 1.03, -0.006), fanCowl.mat);
    strake.rotation.x = -0.42; strake.userData.tag = 'skin'; this._reg(fanCowl, strake);
    this._solid(cna, band(P.bypOuter, offset(P.bypOuter, 0.012), 1.2, 3.5, 20), { tag: 'liner', mat: new THREE.MeshPhysicalMaterial({ ...composite, side: THREE.DoubleSide }) });

    // ---------------- fan
    // Spinner per reference photos: a long straight cone in two pieces. Dark nose cone with a
    // white tip and white crescent; light grey rear fairing with recessed bolt pockets.
    const spinner = A({ id: 'spinner', name: 'Spinner', ex: -1.25, mat: { color: 0x2a2e33, metalness: 0.1, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.5 }, desc: 'Two-piece nose cone on the fan disc. The white crescent makes a turning fan obvious to people on the ground.', live: (o) => `N1 ${o.N1.toFixed(0)} rpm` });
    const sr = (x) => rAt(P.spinner, x);
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.55, side: THREE.DoubleSide });
    const fairing = new THREE.MeshPhysicalMaterial({ color: 0xa9aeb3, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
    this._solid(spinner, [[-0.5, sr(-0.5)], [-0.19, sr(-0.19)], [-0.19, 0]], { parent: this.g1 });
    this._solid(spinner, [[-0.56, 0.0008], [-0.5, sr(-0.5)], [-0.5, 0]], { parent: this.g1, mat: white, seg: 48 });
    this._solid(spinner, [[-0.19, sr(-0.19) + 0.004], [0.02, sr(0.02) + 0.004], [0.02, 0.05], [-0.19, 0.05]], { parent: this.g1, mat: fairing });
    this._solid(spinner, [[-0.196, sr(-0.196) + 0.001], [-0.186, sr(-0.186) + 0.006], [-0.186, sr(-0.186) - 0.004]], { parent: this.g1, mat: fairing, seg: 96 });
    // white crescent: a band on the cone whose width tapers smoothly to a point at each end
    {
      const N = 96, xc = -0.34, pos = [], idx = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N, phi = 0.15 + t * 3.9, hw = 0.036 * Math.pow(Math.sin(Math.PI * t), 0.6) + 0.0005;
        for (const x of [xc - hw, xc + hw]) { const r = sr(x) + 0.0018; pos.push(x, r * Math.cos(phi), r * Math.sin(phi)); }
        if (k < N) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      this._reg(spinner, new THREE.Mesh(g, white), this.g1);
    }
    const pocket = new THREE.SphereGeometry(0.02, 10, 8); pocket.scale(1.5, 0.45, 1);
    this._ring(spinner, pocket, 11, (m, th) => { m.makeRotationX(th); m.multiply(new THREE.Matrix4().makeRotationZ(0.405)); m.setPosition(-0.08, (sr(-0.08) + 0.004) * Math.cos(th), (sr(-0.08) + 0.004) * Math.sin(th)); }, { parent: this.g1, mat: new THREE.MeshStandardMaterial({ color: 0x3a3e43, metalness: 0.6, roughness: 0.5 }) });
    const fan = A({ id: 'fan', name: 'Fan — 22 wide-chord blades', ex: -1.0, mat: titanium, desc: 'Hollow titanium wide-chord blades, 1.6 m across. Produces most of the thrust by moving a large mass of bypass air.', live: (o) => `N1 ${o.N1pct.toFixed(1)} % · absorbs ${(o.pwrFan / 1e6).toFixed(1)} MW · efficiency ${(o.fan.eff * 100).toFixed(0)} %` });
    this._row(fan, ROWS[0], 22, this.g1, { chordK: 1.0, rootK: 0.8, tipK: 1.32, stagger: [0.22, 1.02], camber: [0.14, 0.02], thick: [0.085, 0.022], sweep: 0.035, nSpan: 14, nProf: 12 });
    this._solid(fan, [[0.02, 0.05], [0.02, 0.247], [0.3, 0.27], [0.3, 0.05]], { parent: this.g1, mat: fairing }); // annulus fillers
    this._row(fanCase, ROWS[1], 60, this.engine, { stagger: [-0.3, -0.3], camber: [-0.1, -0.1], thick: [0.07, 0.07], chordK: 1.3, tipK: 1 }, { mat: new THREE.MeshPhysicalMaterial({ ...titanium, color: 0x8c949b }) });

    // ---------------- compressors and turbines
    const lpc = A({ id: 'lpc', name: 'Low-pressure compressor (4 booster stages)', ex: -0.45, mat: { ...titanium, color: 0x9fb0c0 }, desc: 'Booster stages on the fan shaft that supercharge the core.', live: (o) => `Pressure ratio ${o.lpc.PR.toFixed(2)} · exit ${C(o.T25)}, ${B(o.P25)} · ${o.Wlpc.toFixed(1)} kg/s` });
    const lpcCase = A({ id: 'lpccase', name: 'LPC case, stators and 2.5 bleed ring', ex: -0.3, mat: caseM, desc: 'Fixed vanes between the booster rotors. The bleed ring dumps air into the bypass duct at low power so the booster does not surge.', live: (o) => `2.5 bleed ${(o.b25 * 100).toFixed(0)} % open · ${o.Wb25.toFixed(1)} kg/s dumped` });
    const hpc = A({ id: 'hpc', name: 'High-pressure compressor (10 stages)', ex: 0, mat: { color: 0xc2a878, metalness: 1, roughness: 0.3 }, desc: 'Ten stages on the high-pressure spool raise the air to over 30 times ambient pressure at take-off.', live: (o) => `N2 ${o.N2pct.toFixed(1)} % · pressure ratio ${o.hpc.PR.toFixed(1)} · exit ${C(o.T3)}, ${B(o.P3)} · absorbs ${(o.pwrHpc / 1e6).toFixed(1)} MW` });
    const hpcCase = A({ id: 'hpccase', name: 'HPC case and variable stator vanes', ex: 0.05, mat: caseM, desc: 'The inlet guide vanes and first three stator rows (green) are turned by unison rings to keep the front stages out of stall at low speed.', live: (o) => `Stators ${o.vsv.toFixed(1)}° closed (schedule ${o.vsvSched.toFixed(1)}°) · surge margin ${(100 * (o.hpc.xs - o.hpc.x) / o.hpc.xs).toFixed(0)} %` });
    const vsvMat = new THREE.MeshPhysicalMaterial({ color: 0x2f9d6e, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide });
    const hpt = A({ id: 'hpt', name: 'High-pressure turbine (2 stages)', ex: 0.55, mat: { color: 0x9a8a76, metalness: 1, roughness: 0.36 }, glow: (o) => o.T41 - 250, desc: 'Drives the HP compressor. Single-crystal blades run in gas hotter than their melting point and survive on cooling air.', live: (o) => `Entry ${C(o.T4)} · delivers ${(o.pwrHpt / 1e6).toFixed(1)} MW · cooling air ${o.Wcool.toFixed(1)} kg/s` });
    const hptCase = A({ id: 'hptcase', name: 'HPT case and nozzle guide vanes', ex: 0.6, mat: hotM, glow: (o) => o.T4 - 380, desc: 'The guide vanes form the choked throat that sets how much air the core can pass.', live: (o) => `Expansion ratio ${o.hptPR.toFixed(2)} · exit ${C(o.T45)}, ${B(o.P45)}` });
    const lpt = A({ id: 'lpt', name: 'Low-pressure turbine (5 stages)', ex: 0.95, mat: { color: 0x8d9299, metalness: 1, roughness: 0.36 }, glow: (o) => o.T45 - 130, desc: 'Extracts the remaining energy to drive the fan and booster through the long central shaft.', live: (o) => `Delivers ${(o.pwrLpt / 1e6).toFixed(1)} MW · expansion ratio ${o.lptPR.toFixed(2)} · efficiency ${(o.lpt.eff * 100).toFixed(0)} %` });
    const lptCase = A({ id: 'lptcase', name: 'LPT case and vanes', ex: 1.0, mat: hotM, glow: (o) => o.T45 - 230, desc: 'Flared casing around the five low-pressure turbine stages.', live: (o) => `Turbine metal ${C(o.Tm)}` });

    for (let i = 2; i < ROWS.length; i++) {
      const row = ROWS[i], xm = (row.x0 + row.x1) / 2, turbine = xm > 2.2, hpSide = xm > 1.1 && xm < 2.45;
      const n = turbine ? (hpSide ? 60 : 64) : xm < 1.1 ? 62 : 68;
      if (row.kind === 'rotor') {
        const part = turbine ? (row.spool === 2 ? hpt : lpt) : row.spool === 2 ? hpc : lpc;
        this._row(part, row, n, row.spool === 2 ? this.g2 : this.g1, turbine ? { stagger: [-0.5, -0.8], camber: [-0.3, -0.22], thick: [0.2, 0.13], chordK: 1.45, tipK: 0.95 } : { stagger: [0.5, 0.85], camber: [0.1, 0.05], thick: [0.08, 0.05], chordK: 1.2 });
      } else {
        const part = turbine ? (xm < 2.45 ? hptCase : lptCase) : xm < 1.1 ? lpcCase : hpcCase;
        const im = this._row(part, row, n, this.engine, turbine ? { stagger: [0.6, 0.6], camber: [0.3, 0.3], thick: [0.15, 0.15], chordK: 1.25, tipK: 1 } : { stagger: [-0.4, -0.4], camber: [-0.12, -0.12], thick: [0.08, 0.08], chordK: 1.2, tipK: 1 }, row.vsv ? { mat: vsvMat } : {});
        if (row.vsv) this.vsvRows.push(im);
      }
    }
    // drums and discs
    this._solid(lpc, band(CONST(0.2), P.coreInner, 0.42, 0.9, 8), { parent: this.g1 });
    this._solid(hpc, band(CONST(0.11), P.coreInner, 1.17, 1.86, 10), { parent: this.g2 });
    this._solid(hpt, band(CONST(0.08), P.coreInner, 2.26, 2.42, 4), { parent: this.g2 });
    this._solid(lpt, band(CONST(0.12), P.coreInner, 2.5, 3.0, 8), { parent: this.g1 });
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
    // handling bleed valves: three on stage 7, one on stage 10
    const valve = new THREE.CylinderGeometry(0.035, 0.03, 0.07, 14); valve.translate(0, 0.33, 0);
    this._ring(hpcCase, valve, 3, (m, th) => { m.makeRotationX(th); m.setPosition(1.62, 0, 0); }, { phase: 2.6, cut: false, mat: pipeSteel });
    this._ring(hpcCase, valve, 1, (m, th) => { m.makeRotationX(th); m.setPosition(1.8, 0, 0); }, { phase: 4.0, cut: false, mat: pipeGold });
    // structural struts of the intermediate case, crossing the swan-neck duct
    this._row(lpcCase, { x0: 0.94, x1: 1.08, kind: 'stator', lo: P.coreInner, hi: P.coreOuter }, 9, this.engine, { stagger: [0, 0], camber: [0, 0], thick: [0.2, 0.2], chordK: 1, tipK: 1 });
    // blanked bleed ports (orange covers on the museum model)
    const port = new THREE.CylinderGeometry(0.045, 0.05, 0.09, 18); port.translate(0, 0.33, 0);
    const capG = new THREE.CylinderGeometry(0.052, 0.052, 0.012, 18); capG.translate(0, 0.38, 0);
    const orange = new THREE.MeshStandardMaterial({ color: 0xe2572b, roughness: 0.5 });
    for (const [x, ph] of [[1.74, 2.55], [1.74, 4.3], [2.1, 3.4]]) for (const [g, mt] of [[port, pipeSteel], [capG, orange]]) this._ring(x > 2 ? hptCase : hpcCase, g, 1, (m, th) => { m.makeRotationX(th - Math.PI / 2); m.setPosition(x, 0, 0); }, { phase: ph, cut: false, mat: mt });
    this._solid(hptCase, band(CO, offset(CO, 0.028), 2.2, 2.45, 6));
    for (const x of [2.21, 2.44]) this._flange(hptCase, x, co(x) + 0.026, 48);
    this._solid(lptCase, band(CO, offset(CO, 0.022), 2.45, 3.02, 10));
    for (const x of [2.62, 2.82, 3.01]) this._flange(lptCase, x, co(x) + 0.02, 52);

    // ---------------- shafts
    const lpShaft = A({ id: 'lpshaft', name: 'LP shaft', ex: 0, mat: { color: 0x4f78a8, metalness: 1, roughness: 0.3 }, desc: 'Runs the length of the engine inside the HP spool, connecting the LP turbine to the fan and booster.', live: (o) => `${o.N1.toFixed(0)} rpm · net torque ${o.tq1.toFixed(0)} N·m` });
    this._solid(lpShaft, [[0.12, 0.03], [0.12, 0.046], [2.98, 0.046], [2.98, 0.03]], { parent: this.g1, seg: 32 });
    const hpShaft = A({ id: 'hpshaft', name: 'HP shaft', ex: 0.02, mat: { color: 0xb88a3a, metalness: 1, roughness: 0.3 }, desc: 'Short hollow shaft joining the HP turbine to the HP compressor. The accessory gearbox is driven from it.', live: (o) => `${o.N2.toFixed(0)} rpm · net torque ${o.tq2.toFixed(0)} N·m · starter ${o.tStart.toFixed(0)} N·m` });
    this._solid(hpShaft, [[1.8, 0.075], [1.8, 0.09], [2.3, 0.09], [2.3, 0.075]], { parent: this.g2, seg: 32 });

    // ---------------- combustor
    const comb = A({ id: 'combcase', name: 'Diffuser and combustor case', ex: 0.3, mat: caseM, desc: 'Pressure vessel around the combustor. Slows the compressor delivery air before it enters the flame tube.', live: (o) => `${B(o.P3)} · ${C(o.T3)}` });
    // diffuser case bulges outward around the combustor (cutaway drawing)
    this._solid(comb, [[1.9, co(1.9)], [1.9, co(1.9) + 0.03], [1.95, 0.372], [2.0, 0.388], [2.1, 0.388], [2.16, 0.372], [2.2, co(2.2) + 0.03], [2.2, co(2.2)], [2.18, 0.33], [1.92, 0.33]]);
    this._solid(comb, band(CONST(0.13), P.coreInner, 1.88, 2.24, 6));
    this._flange(comb, 2.05, 0.386, 48);
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
    this._pipe(noz, [[0.95, 1.02, 180], [1.2, 0.72, 182], [1.6, 0.6, 186], [1.917, 0.44, 190]], 0.012);
    const ign = A({ id: 'ign', name: 'Igniter plugs (2)', ex: 0.3, mat: { color: 0xe6e9ec, metalness: 0.9, roughness: 0.25 }, desc: 'Two high-energy spark igniters. Only needed to light the flame; combustion is self-sustaining afterwards.', live: (o) => (o.ignOn ? 'Sparking' : 'Off') });
    const ig = new THREE.CylinderGeometry(0.011, 0.014, 0.19, 10); ig.translate(0, 0.385, 0);
    this._ring(ign, ig, 2, (m, th) => { m.makeRotationX(th - Math.PI / 2); m.setPosition(2.01, 0, 0); }, { phase: 2.4, cut: false });

    // ---------------- core cowl, exhaust
    const cowl = A({ id: 'corecowl', name: 'Core cowl (inner fixed structure)', ex: 0.15, mat: composite, desc: 'Inner wall of the bypass duct, wrapped around the core engine. Remove it to see the pipework underneath.', live: (o) => `Bypass duct ${B(o.P13)} · mixing plane ${B(o.Pm)}` });
    this._solid(cowl, band(offset(P.bypInner, -0.016), P.bypInner, 0.42, 3.12, 30));
    const tec = A({ id: 'tec', name: 'Turbine exhaust case and plug', ex: 1.35, mat: hotM, glow: (o) => o.T5 - 170, desc: 'Carries the rear bearing. The EGT thermocouples and the P4.9 pressure probes used for EPR sit in its struts.', live: (o) => `EGT ${C(o.egt)} · EPR ${o.epr.toFixed(3)} · core jet Mach ${o.M8.toFixed(2)}` });
    this._solid(tec, [...sample(P.coreInner, 3.0, 3.44, 18), [3.0, 0.0]]);
    this._solid(tec, band(CO, offset(CO, 0.02), 3.02, 3.12, 3));
    const strut = bladeGeo({ span: 0.2, chord: [0.09, 0.09], stagger: [0, 0], camber: [0, 0], thick: [0.16, 0.16], nSpan: 2 });
    this._ring(tec, strut, 13, (m, th) => { m.makeRotationX(th); m.setPosition(3.065, 0.275 * Math.cos(th), 0.275 * Math.sin(th)); });

    // ---------------- accessories and pipework
    const agb = A({ id: 'agb', name: 'Accessory gearbox, starter, generator, fuel pump', ex: -0.55, mat: { color: 0x8a9198, metalness: 0.9, roughness: 0.45 }, desc: 'Hangs under the fan case inside the cowl and is driven from the HP spool by a long shaft. Carries the air turbine starter, the generator, hydraulic and fuel pumps and the fuel metering unit.', live: (o) => `Starter torque ${o.tStart.toFixed(0)} N·m · N2 ${o.N2pct.toFixed(1)} %` });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.46).translate(0.7, -1.13, 0), agb.mat); this._reg(agb, box);
    for (const [x, z, rr, l, mt] of [[0.48, 0.2, 0.1, 0.34, pipeSteel], [0.9, -0.17, 0.12, 0.42, agb.mat], [0.92, 0.2, 0.07, 0.3, pipeGold], [0.5, -0.2, 0.085, 0.28, agb.mat]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr * 0.9, l, 20).rotateZ(Math.PI / 2).translate(x, -1.22, z), mt); this._reg(agb, c);
    }
    this._pipe(agb, [[0.48, 1.2, 171], [0.48, 1.0, 166], [0.6, 0.86, 160], [1.3, 0.8, 150]], 0.034, pipeSteel); // starter air duct
    const eec = A({ id: 'eec', name: 'Electronic engine control (FADEC)', ex: -0.55, mat: { color: 0x15181b, metalness: 0.3, roughness: 0.5 }, desc: 'Dual-channel computer on the fan case. Sets fuel flow, stator angle and bleed valves, and protects the engine limits.', live: () => '' });
    const eb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.3), eec.mat); eb.position.set(0.55, -0.62, -0.84); eb.rotation.x = 0.94; this._reg(eec, eb);
    const ext = A({ id: 'ext', name: 'External pipework and harnesses', ex: 0.1, mat: pipeSteel, desc: 'Fuel, oil, bleed-air and cooling pipes and the electrical harnesses that dress the core. Visible with the core cowl removed.', live: (o) => `Turbine cooling ${o.Wcool.toFixed(1)} kg/s · handling bleed ${(o.Wb7 + o.Wb10).toFixed(1)} kg/s` });
    const run = (th, r0, mat, rad, x0 = 1.15, x1 = 2.9, wob = 6) => this._pipe(ext, Array.from({ length: 9 }, (_, i) => { const f = i / 8, x = lerp(x0, x1, f); return [x, co(x) + r0 + 0.012 * Math.sin(f * 9 + th), th + wob * Math.sin(f * 5 + th * 0.1)]; }), rad, mat);
    [[130, 0.075, pipeSteel, 0.011], [150, 0.07, pipeGold, 0.008], [172, 0.085, harness, 0.013, 0.5], [200, 0.07, pipeSteel, 0.016, 1.5, 2.7], [225, 0.075, harness, 0.009], [246, 0.08, pipeSteel, 0.01], [268, 0.07, pipeGold, 0.007, 1.3, 2.2], [292, 0.085, pipeSteel, 0.014, 1.6, 3.0], [316, 0.07, harness, 0.011, 0.5], [338, 0.075, pipeSteel, 0.009]].forEach((a) => run(...a));
    // turbine case cooling manifolds (active clearance control): a cage of tube rings round the LPT
    for (let k = 0; k < 7; k++) { const x = 2.5 + k * 0.075, rr = co(x) + 0.058; this._solid(ext, [[x - 0.008, rr], [x - 0.008, rr + 0.016], [x + 0.008, rr + 0.016], [x + 0.008, rr]], { seg: 72, mat: pipeSteel }); }
    for (const th of [150, 240, 330]) this._pipe(ext, Array.from({ length: 6 }, (_, i) => { const x = 2.3 + i * 0.135; return [x, co(x) + 0.09, th]; }), 0.014, pipeSteel);
    for (const x of [1.45, 2.0, 2.55]) this._solid(ext, [[x - 0.005, co(x) + 0.095], [x - 0.005, co(x) + 0.103], [x + 0.005, co(x) + 0.103], [x + 0.005, co(x) + 0.095]], { seg: 96, mat: harness }); // clamps
    // pylon the engine hangs from
    const pylon = A({ id: 'pylon', name: 'Pylon', ex: 0, mat: paint, desc: 'Carries the engine under the wing and transmits its thrust to the airframe. Fuel, bleed air, electrical and hydraulic lines run through it.', live: (o) => `Thrust carried ${(o.thrust / 1000).toFixed(1)} kN` });
    { const sh = new THREE.Shape(); sh.moveTo(0.35, 0.98); sh.lineTo(0.2, 1.32); sh.lineTo(3.0, 1.32); sh.lineTo(2.8, 1.02); sh.lineTo(2.2, 0.9); sh.lineTo(0.35, 0.98);
      this._reg(pylon, new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 }).translate(0, 0, -0.1), pylon.mat)); }
    for (const p of this.parts) for (const ob of p.objs) ob.userData.home = ob.position.x;
  }

  _buildStage() {
    const s = this.scene;
    // seamless studio floor that fades into the background
    const fade = canvasTex(256, 256, (g) => { const gr = g.createRadialGradient(128, 128, 20, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(22, 64), new THREE.MeshStandardMaterial({ color: 0x131416, metalness: 0.0, roughness: 0.7, alphaMap: fade, transparent: true }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(1.4, FLOOR_Y, 0); floor.receiveShadow = true; s.add(floor);
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
    const N = (this.nAir = 3600);
    this.air = this._points(N, 0.026);
    this.airP = Array.from({ length: N }, (_, i) => ({ core: i % 4 === 0, u: Math.random(), v: Math.random(), th: Math.random() * TAU }));
    this.flame = this._points(300, 0.15);
    this.fuelP = this._points(200, 0.03);
    this.fog = this._points(520, 0.55, THREE.NormalBlending); this.fog.material.opacity = 0;
    this.fogSeed = Array.from({ length: 520 }, () => [Math.random(), Math.random(), Math.random() * TAU]);
    this.vortex = this._points(360, 0.1, THREE.NormalBlending); this.vortex.material.opacity = 0;
    this.torch = this._points(160, 0.4);
    this.bang = this._points(120, 0.7);
    const plumeMat = (rgb) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Color(...rgb) }, uSpeed: { value: 1 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalMatrix*normal; vV=-mv.xyz; gl_Position=projectionMatrix*mv; }',
      fragmentShader: `uniform float uT,uA,uSpeed; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} 
        float n(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);} 
        void main(){ float along=clamp(1.0-vUv.y,0.0,1.0); float t=uT*uSpeed; float nz=n(vec2(vUv.x*14.0, along*7.0-t*3.0))*0.6+n(vec2(vUv.x*31.0, along*18.0-t*6.0))*0.4;
          float body=pow(max(1.0-along,1e-4),1.6)*smoothstep(0.0,0.06,along);
          float nv=dot(vN,vV)/max(length(vN)*length(vV),1e-4); float rimF=pow(clamp(abs(nv),1e-4,1.0),1.4);
          gl_FragColor=vec4(uC*(0.55+0.9*nz), clamp(uA*body*rimF*(0.35+0.75*nz),0.0,1.0)); }`,
    });
    const cone = (r0, r1, rgb, x) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 48, 24, true); g.translate(0, 0.5, 0); g.rotateZ(-Math.PI / 2); const m = new THREE.Mesh(g, plumeMat(rgb)); m.frustumCulled = false; m.position.x = x; this.scene.add(m); return m; };
    this.plumeOuter = cone(0.6, 0.78, [0.5, 0.7, 1.0], 3.55);
    this.plumeCore = cone(0.4, 0.5, [1.0, 0.55, 0.2], 3.2);
    this.plumeHot = cone(0.26, 0.2, [1.0, 0.85, 0.6], 3.15);
    const blur = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.8, 64), new THREE.MeshBasicMaterial({ color: 0xb8c0c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.y = Math.PI / 2; blur.position.x = 0.16; this.fanBlur = blur; this.scene.add(blur);
  }

  _buildPost() {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    c.addPass(new ShaderPass(Sanitize));
    this.ao = new GTAOPass(this.scene, this.camera, 4, 4);
    this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12 });
    this.ao.enabled = false; c.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.32, 0.5, 1.7); c.addPass(this.bloom);
    this.haze = new ShaderPass(HeatHaze); c.addPass(this.haze);
    c.addPass(new ShaderPass(Sanitize));
    c.addPass(new OutputPass());
    // Anti-aliasing is layered: multisampling on the scene buffer (geometry edges), SMAA on the final
    // image (edges the post-processing passes re-introduce), and optional supersampling on Ultra.
    this.smaa = new SMAAPass(); c.addPass(this.smaa);
    this.fx = { haze: true };
  }

  // ---------------------------------------------------------------- controls
  _controls() {
    const el = this.canvas, o = this.orbit;
    let drag = null, moved = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; moved = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        if (drag.pan) { const k = o.dist * 0.0012; o.target.addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), -dx * k).addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1), dy * k); }
        else { o.az -= dx * 0.006; o.el = clamp(o.el + dy * 0.006, -0.3, 1.45); }
      } else this._pick(e, false);
    });
    el.addEventListener('pointerup', (e) => { if (drag && moved < 5 && e.button === 0) this._pick(e, true); drag = null; });
    el.addEventListener('pointerleave', () => { this.hover = null; this.onHover && this.onHover(null); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); o.dist = clamp(o.dist * Math.exp(e.deltaY * 0.0011), 1.4, 22); }, { passive: false });
    this.ray = new THREE.Raycaster();
  }
  _pick(e, click) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left + this.offsetX) / r.width) * 2 - 1, -((e.clientY - r.top + this.offsetY) / r.height) * 2 + 1);
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
    const e = rev * rev * (3 - 2 * rev), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), e * 1.05); // hinge = door's tangential axis (local Z after the glTF axis conversion)
    for (const n of this.revNodes) { const b = n.userData.rev; n.position.x = b.x + 0.46 * e; if (b.k === 'door') n.quaternion.copy(b.q).multiply(qy); }
  }

  view(name) {
    const v = { hero: [-0.72, 0.2, 9.6, 1.45], front: [-1.3, 0.1, 7.6, 0.3], rear: [0.95, 0.14, 10.5, 3.6], side: [0, 0.03, 9.4, 1.45], core: [-0.2, 0.22, 4.4, 1.95] }[name];
    if (v) Object.assign(this.orbit, { az: v[0], el: v[1], dist: v[2] }), this.orbit.target.set(v[3], -0.05, 0);
  }
  setCutaway(on) {
    this.cutaway = on;
    this.engine.traverse((n) => { if (n.userData.cutPair) { n.userData.cutPair[0].visible = !on; n.userData.cutPair[1].visible = on; } });
    for (const im of this.cutInst) im.count = on ? im.userData.kept : im.userData.ths.length;
    this.engine.traverse((n) => { const v = n.userData.variant; if (v) n.visible = (v === 'cut') === on; });
  }
  setExplode(v) { this.explode = v; for (const p of this.parts) for (const ob of p.objs) ob.position.x = ob.userData.home + p.ex * v * 1.5; }
  setRemoved(id, removed) { const p = this.byId[id]; if (!p) return; p.removed = removed; for (const ob of p.objs) ob.visible = !removed; if (removed && this.selected === p) this.selected = null; }
  restoreAll() { for (const p of this.parts) this.setRemoved(p.id, false); }
  surge(which) { this.flash = 1; this.flashFront = which !== 'hpc'; }
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
    this.resize();
  }

  /**
   * Replace generated components with an authored glTF model.
   * manifest: { file, scale, position:[x,y,z], rotation:[x,y,z] (deg), parts: { partId: { match: "regex on node names", spool: 0|1|2 } } }
   * Matching nodes take over that component (picking, removal, glow, rotation with the spool).
   */
  async loadExternalModel(base, manifest) {
    const gltf = await new GLTFLoader().loadAsync(base + manifest.file);
    const root = gltf.scene; root.scale.setScalar(manifest.scale || 1);
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
        holder.attach(n);
        n.userData.variant = /__cut$/i.test(n.name) ? 'cut' : /__full$/i.test(n.name) || nodes.some((m) => m.name === `${n.name}__cut`) ? 'full' : null;
        n.traverse((m) => {
          if (!m.isMesh) return;
          const swap = (mt) => { const sh = this.shared[mt.name]; if (!sh) { mt.side = THREE.DoubleSide; return mt; } if (mt.name === 'section') return sh; return (own[mt.name] ||= (() => { const c = sh.clone(); part.extMats.push(c); return c; })()); };
          m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        });
      }
      this._reg(part, holder, parent); holder.userData.home = holder.position.x; holder.position.x += part.ex * this.explode * 1.5;
      taken.push(id);
    }
    this.scene.remove(root);
    this.setCutaway(this.cutaway); this.revNodes = null; this._rev = -1;
    return taken;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = this.quality === 'ultra' ? Math.max(dpr, 1.5) : dpr;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(r.width, r.height, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
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

    // spools: display speed is compressed so blades stay readable; the blur disc sells the rest
    const p1 = Math.abs(o.N1pct) / 100, p2 = o.N2pct / 100;
    this.g1.rotation.x += Math.sign(o.N1) * Math.pow(p1, 0.55) * 16 * dt;
    this.g2.rotation.x += Math.pow(p2, 0.55) * 26 * dt;
    this.fanBlur.material.opacity = this.byId.fan.removed ? 0 : clamp(p1 * 0.2, 0, 0.16);
    this.fanBlur.position.x = 0.16 + this.byId.fan.ex * this.explode * 1.5;
    this._reverser(o.rev || 0);

    // variable stators turn about their own radial axis
    if (Math.abs(o.vsv - (this._vsv ?? 1e9)) > 0.2) {
      this._vsv = o.vsv;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.vsv * DEG), ax = new THREE.Vector3(1, 0, 0), one = new THREE.Vector3(1, 1, 1);
      for (const im of this.vsvRows) {
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
      if (p.mat.emissive) p.mat.emissive.setRGB(r, g, b);
      if (p.extMats) for (const m of p.extMats) m.emissive.setRGB(r, g, b);
    }

    const fill = (pts, n, fn) => { const pos = pts.geometry.attributes.position.array, col = pts.geometry.attributes.color.array; for (let i = 0; i < n; i++) fn(i, pos, col, i * 3); pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; };
    // ---- air
    const show = this.showFlow;
    this.air.visible = show;
    if (show) {
      const vB = Math.sign(o.Wbypass) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wbypass) / 315)) * (Math.abs(o.Wbypass) > 0.5 ? 1 : 0);
      const vC = Math.sign(o.Wcore) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wcore) / 70)) * (Math.abs(o.Wcore) > 0.05 ? 1 : 0);
      const cB = tempRGB(o.T13 + 120), c2 = tempRGB(o.T2 + 120), c25 = tempRGB(o.T25 + 150), c3 = tempRGB(o.T3 + 150), c4 = tempRGB(o.T4 + 150), c5 = tempRGB(o.T5 + 150);
      const ex = this.explode, x0 = -1.8, span = 6.2;
      fill(this.air, this.nAir, (i, pos, col, j) => {
        const p = this.airP[i], v = p.core ? vC : vB;
        p.u += (v * dt) / span;
        if (p.u > 1 || p.u < 0) { p.u -= Math.floor(p.u); p.v = Math.random(); p.th = Math.random() * TAU; }
        const x = x0 + p.u * span;
        let lo, hi, c, a = 1;
        if (x < 0) { const far = x < -0.78 ? 1 + (-0.78 - x) * 0.75 : 1; hi = rAt(P.inletInner, Math.max(x, -0.78)) * far; lo = 0; c = c2; if (p.core) hi *= 0.42; else lo = hi * 0.42; a = x < -0.78 ? 0.45 : 0.8; }
        else if (x < 0.4) { lo = rAt(P.spinner, x); hi = 0.8; c = c2; const m = lerp(lo, hi, 0.36); if (p.core) hi = m; else lo = m; }
        else if (p.core) { lo = rAt(P.coreInner, Math.min(x, 3.7)); hi = x > 3.12 ? lerp(0.44, 0.3, clamp((x - 3.12) / 1.3, 0, 1)) : rAt(P.coreOuter, x); c = x < 1.0 ? c25 : x < 1.9 ? c3 : x < 2.3 ? c4 : c5; a = x > 3.3 ? clamp(1 - (x - 3.3) / 1.1, 0, 1) : 1; }
        else { lo = x > 3.12 ? lerp(0.46, 0.3, clamp((x - 3.12) / 1.3, 0, 1)) : rAt(P.bypInner, x); hi = rAt(P.bypOuter, Math.min(x, 3.55)); c = cB; a = x > 3.55 ? clamp(1 - (x - 3.55) / 0.85, 0, 1) : 1; }
        const rr = lerp(lo, hi, 0.06 + 0.88 * p.v), th = p.th + (x > 0.3 && x < 3 ? 0.25 * Math.sin(x * 3 + i) : 0);
        pos[j] = x + ex * 0.2 * (x - 1.5); pos[j + 1] = rr * Math.cos(th); pos[j + 2] = rr * Math.sin(th);
        const k = v === 0 ? 0 : a * 0.6;
        col[j] = c[0] * k; col[j + 1] = c[1] * k; col[j + 2] = c[2] * k;
      });
    }
    // ---- fuel spray and flame
    const exC = this.byId.liner.ex * this.explode * 1.5;
    const fuelOn = o.wf > 0.002 && show;
    this.fuelP.visible = fuelOn;
    if (fuelOn) fill(this.fuelP, 200, (i, pos, col, j) => { const th = ((i % 20) / 20) * TAU + 0.157, f = (t * 3 + i * 0.137) % 1, r = 0.25 + (((i * 7) % 11) / 11 - 0.5) * 0.05 * f; pos[j] = 1.95 + f * 0.09 + exC; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = (1 - f) * clamp(o.wf / 0.4, 0.25, 1); col[j] = k; col[j + 1] = 0.85 * k; col[j + 2] = 0.25 * k; });
    const inten = o.lit ? clamp(o.farBurn / 0.026, 0.2, 1.4) : 0;
    this.flame.visible = inten > 0;
    this.flameLight.intensity = inten * (2.6 + 0.6 * Math.sin(t * 40)); this.flameLight.position.x = 2.05 + exC;
    if (inten > 0) fill(this.flame, 300, (i, pos, col, j) => { const th = Math.random() * TAU, f = Math.random(), r = 0.25 + (Math.random() - 0.5) * 0.06; pos[j] = 1.98 + f * 0.2 * Math.min(1.2, inten + 0.3) + exC; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = (1 - f * 0.7) * inten * 0.5; col[j] = k; col[j + 1] = k * (0.35 + 0.5 * (1 - f)); col[j + 2] = k * 0.12 * (1 - f); });
    const torch = o.wfUnburnt > 0.01 || (o.lit && o.pool > 0.02);
    this.torch.visible = torch;
    if (torch) fill(this.torch, 160, (i, pos, col, j) => { const f = Math.random(), th = Math.random() * TAU, r = Math.random() * (0.3 + 0.25 * f); pos[j] = 3.1 + f * 2.2; pos[j + 1] = r * Math.cos(th) + f * f * 0.3; pos[j + 2] = r * Math.sin(th); const k = (1 - f) * 0.5; col[j] = k; col[j + 1] = k * 0.5; col[j + 2] = k * 0.08; });

    // ---- exhaust plume and heat haze
    const thr = clamp(o.Fg / 140e3, 0, 1), hotK = clamp((o.T5 - 400) / 500, 0, 1);
    const L = 1.2 + 5.5 * Math.sqrt(thr);
    const setPl = (m, len, a, sp) => { m.scale.set(len, 1, 1); m.material.uniforms.uT.value = t % 1000; m.material.uniforms.uA.value = a; m.material.uniforms.uSpeed.value = sp; m.visible = a > 0.004; };
    // Seen end-on (from directly behind or in front) the layered plume would stack into one large
    // opaque blob over the engine, so it fades out as the view lines up with the engine axis.
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const endOn = clamp((Math.abs(fwd.x) - 0.7) / 0.25, 0, 1), pk = 1 - endOn * endOn * (3 - 2 * endOn);
    setPl(this.plumeOuter, L, o.W9 > 5 ? (0.06 + 0.3 * thr) * (1 - 0.8 * (o.rev || 0)) * pk : 0, 0.6 + 2.5 * thr);
    setPl(this.plumeCore, L * 0.8, (0.2 + 0.6 * thr) * hotK * pk, 0.8 + 3 * thr);
    setPl(this.plumeHot, L * 0.45, (0.3 + 0.6 * thr) * clamp((o.T5 - 560) / 300, 0, 1) * pk, 1 + 3 * thr);
    this.plumeCore.material.uniforms.uC.value.setRGB(1.0, 0.35 + 0.35 * hotK, 0.12 + 0.2 * hotK);
    const hz = this.haze.uniforms, a = new THREE.Vector3(3.3, 0, 0).project(this.camera), b = new THREE.Vector3(3.6 + L * 1.1, 0.25, 0).project(this.camera);
    const edge = new THREE.Vector3(3.3, 0.62, 0).project(this.camera);
    hz.uA.value.set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5); hz.uB.value.set(b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
    hz.uR.value = Math.max(0.02, Math.hypot((edge.x - a.x) * 0.5 * this.camera.aspect, (edge.y - a.y) * 0.5)) * 1.3;
    // only when the whole plume axis is in front of the camera (projection is meaningless behind it)
    const va = new THREE.Vector3(3.3, 0, 0).applyMatrix4(this.camera.matrixWorldInverse), vb = new THREE.Vector3(3.6 + L * 1.1, 0.25, 0).applyMatrix4(this.camera.matrixWorldInverse);
    const inFront = va.z < -0.3 && vb.z < -0.3;
    hz.uR.value = clamp(hz.uR.value, 0.01, 0.3);
    hz.uK.value = inFront && this.fx.haze && pk > 0.5 ? clamp((o.T7 - 310) / 120, 0, 1) * clamp(o.W9 / 60, 0, 1) : 0; hz.uT.value = (t * (0.6 + 2 * thr)) % 1000;
    this.haze.enabled = hz.uK.value > 0.01;

    // ---- inlet condensation and ground vortex (physics in main.js inletWeather)
    const fogA = env ? env.fog : 0, vx = env ? env.vortex : 0;
    this.fog.material.opacity += (fogA * 0.12 - this.fog.material.opacity) * Math.min(1, dt * 2);
    this.fog.visible = this.fog.material.opacity > 0.004;
    if (this.fog.visible) fill(this.fog, 520, (i, pos, col, j) => { const s = this.fogSeed[i], f = (s[0] + t * (0.25 + 0.5 * p1)) % 1, x = -1.05 + f * 1.05, r = Math.sqrt(s[1]) * 0.76 * (x < -0.78 ? 1.08 : 1), th = s[2] + t * 0.2; pos[j] = x; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = Math.sin(f * Math.PI); col[j] = col[j + 1] = col[j + 2] = 0.92 * k; });
    this.vortex.material.opacity += (vx * (0.22 + 0.6 * fogA) - this.vortex.material.opacity) * Math.min(1, dt * 1.5);
    this.vortex.visible = this.vortex.material.opacity > 0.004;
    if (this.vortex.visible) {
      const gx = -1.25 + 0.12 * Math.sin(t * 0.7), gz = 0.25 * Math.sin(t * 0.43);
      fill(this.vortex, 360, (i, pos, col, j) => { const f = (i / 360 + t * 0.6) % 1, e = f * f * (3 - 2 * f), jit = ((i * 7919) % 97) / 97; const cx = lerp(gx, -0.45, e), cy = lerp(FLOOR_Y, -0.5, f), cz = lerp(gz, 0, e); const rad = (lerp(0.22, 0.03, Math.min(1, f * 2.2)) + 0.03 * f) * (0.55 + 0.6 * jit), an = f * 22 - t * 9 + jit * 6.283; pos[j] = cx + rad * Math.cos(an); pos[j + 1] = cy; pos[j + 2] = cz + rad * Math.sin(an); const k = 0.75 * Math.sin(Math.min(1, f * 1.15) * Math.PI) + 0.1; col[j] = col[j + 1] = col[j + 2] = k; });
    }
    // ---- surge: flame out of the intake and tailpipe
    this.bang.visible = this.flash > 0.03;
    if (this.bang.visible) {
      const fl = this.flash, front = this.flashFront;
      fill(this.bang, 120, (i, pos, col, j) => { const f = Math.random(), th = Math.random() * TAU, back = i % 3 === 0 || !front, r = Math.random() * (back ? 0.4 : 0.75); pos[j] = back ? 3.2 + f * 2 : -0.2 - f * 1.4 * (1.2 - fl); pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = fl * (1 - f) * 0.7; col[j] = k; col[j + 1] = k * 0.55; col[j + 2] = k * 0.12; });
      this.flash *= Math.pow(0.004, dt);
    }
    if (this.quality === 'low') this.renderer.render(this.scene, this.camera); else this.composer.render();
  }
}
