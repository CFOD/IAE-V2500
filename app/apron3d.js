// The apron: the engine on its A320, standing on a painted stand, with loose objects for it to swallow or blow
// away. Physics in src/sim/ground.js; the aircraft is built by tools/blender/apron.py (app/models/apron.glb,
// loaded the first time the apron is shown).
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { finish, FINISH } from './surfaces.js';
import { APRON, OBJECTS } from '../src/sim/ground.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const GY = APRON.groundY, ZF = -5.75;
const X_NOSE = -11.96, X_NLG = X_NOSE + 5.07, X_MLG = X_NOSE + 17.71, L_AC = 37.57;

// ------------------------------------------------------------------ textures
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

/** The stand: 96 m square of concrete slabs centred under the aircraft, with its markings. */
function apronTexture(size) {
  const span = 96, cx = 6, cz = ZF, px = size / span;
  const X = (x) => (x - (cx - span / 2)) * px, Z = (z) => (z - (cz - span / 2)) * px;
  return canvas(size, size, (g) => {
    const r = rnd(4242);
    g.fillStyle = '#9d9c97'; g.fillRect(0, 0, size, size);
    // slabs, 5 m square, each a slightly different tone, with fine grain
    for (let i = 0; i < span / 5; i++) for (let j = 0; j < span / 5; j++) {
      const t = 150 + Math.floor(r() * 16 - 8); g.fillStyle = `rgb(${t},${t - 1},${t - 5})`; g.fillRect(i * 5 * px, j * 5 * px, 5 * px, 5 * px);
    }
    for (let k = 0; k < size * size / 60; k++) { const t = 120 + Math.floor(r() * 70); g.fillStyle = `rgba(${t},${t},${t - 4},0.18)`; g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2); }
    // oil and rubber: under the engines, along the gear tracks, round the stop position
    const blot = (x, z, rad, a) => { const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rad * px); gr.addColorStop(0, `rgba(40,36,30,${a})`); gr.addColorStop(1, 'rgba(40,36,30,0)'); g.fillStyle = gr; g.beginPath(); g.arc(X(x), Z(z), rad * px, 0, 7); g.fill(); };
    for (let k = 0; k < 26; k++) blot(-1 + r() * 7, (r() - 0.5) * 2.5, 0.3 + r() * 0.9, 0.08 + r() * 0.12);
    for (let k = 0; k < 26; k++) blot(-1 + r() * 7, ZF * 2 + (r() - 0.5) * 2.5, 0.3 + r() * 0.9, 0.08 + r() * 0.12);
    for (const zg of [ZF + 3.795, ZF - 3.795, ZF]) { g.strokeStyle = 'rgba(30,30,30,0.13)'; g.lineWidth = 0.35 * px; g.beginPath(); g.moveTo(X(-40), Z(zg)); g.lineTo(X(zg === ZF ? X_NLG : X_MLG), Z(zg)); g.stroke(); }
    // joints: sealant lines between the slabs
    g.strokeStyle = 'rgba(48,46,42,0.75)'; g.lineWidth = Math.max(1, 0.02 * px);
    for (let i = 0; i <= span / 5; i++) { g.beginPath(); g.moveTo(i * 5 * px, 0); g.lineTo(i * 5 * px, size); g.stroke(); g.beginPath(); g.moveTo(0, i * 5 * px); g.lineTo(size, i * 5 * px); g.stroke(); }
    // lead-in line along the aircraft centreline (yellow with black borders) and the A320 stop bar
    const line = (x0, z0, x1, z1, w, col) => { g.strokeStyle = col; g.lineWidth = w * px; g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
    line(X_NLG - 2, ZF, cx + span / 2, ZF, 0.35, '#141414'); line(X_NLG - 2, ZF, cx + span / 2, ZF, 0.15, '#e8b81c');
    line(X_NLG, ZF - 1.6, X_NLG, ZF + 1.6, 0.6, '#141414'); line(X_NLG, ZF - 1.5, X_NLG, ZF + 1.5, 0.4, '#e8b81c');
    g.save(); g.translate(X(X_NLG - 1.2), Z(ZF + 2.4)); g.rotate(-Math.PI / 2); g.fillStyle = '#e8b81c'; g.font = `bold ${Math.round(0.9 * px)}px sans-serif`; g.textAlign = 'center'; g.fillText('A320', 0, 0); g.restore();
    // equipment restraint line round the aircraft (red), stand number at its head
    g.strokeStyle = '#b3261e'; g.lineWidth = 0.15 * px; g.strokeRect(X(X_NOSE - 4), Z(ZF - 21), (L_AC + 8) * px, 42 * px);
    g.save(); g.translate(X(X_NOSE - 6.5), Z(ZF)); g.rotate(-Math.PI / 2); g.fillStyle = '#f2f2ef'; g.font = `bold ${Math.round(3 * px)}px sans-serif`; g.textAlign = 'center'; g.fillText('24', 0, 0); g.restore();
    // keep-clear hatching at the head of the stand
    g.strokeStyle = 'rgba(240,240,236,0.85)'; g.lineWidth = 0.12 * px;
    for (let k = 0; k < 14; k++) { const z = ZF - 7 + k; line(X_NOSE - 10, z, X_NOSE - 8.5, z + 1, 0.12, 'rgba(240,240,236,0.85)'); }
  });
}

function concreteTile(size) {
  return canvas(size, size, (g) => {
    const r = rnd(777); g.fillStyle = '#9a9994'; g.fillRect(0, 0, size, size);
    for (let k = 0; k < size * size / 40; k++) { const t = 120 + Math.floor(r() * 70); g.fillStyle = `rgba(${t},${t},${t - 4},0.16)`; g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2); }
    g.strokeStyle = 'rgba(50,48,44,0.7)'; g.lineWidth = 2; g.strokeRect(0, 0, size, size);
  });
}

function skyTexture() {
  return canvas(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2c5c9a'); gr.addColorStop(0.32, '#6a9ad0'); gr.addColorStop(0.49, '#c9dcec'); gr.addColorStop(0.5, '#b9bfc2'); gr.addColorStop(1, '#8c8e8c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function label(text, color = '#ffffff') {
  const c = canvas(512, 96, (g, w, h) => { g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, w / 2, h / 2); g.fillStyle = color; g.fillText(text, w / 2, h / 2); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false })); s.scale.set(0.2, 0.0375, 1); s.renderOrder = 10;
  return s;
}

// ------------------------------------------------------------------ the loose objects, modelled
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
function birdModel(kind) {
  const g = new THREE.Group(), s = OBJECTS[kind].size;
  const col = kind === 'goose' ? [0x6e6458, 0x18181a, 0xd8d4cc] : kind === 'gull' ? [0xf2f2f0, 0x9aa3ab, 0xf2f2f0] : [0x8a92a0, 0x5c6573, 0xa9b1bd];
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), std(col[0], { roughness: 0.8 })); body.scale.set(s * 0.55, s * 0.26, s * 0.28);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), std(kind === 'goose' ? col[1] : col[2], { roughness: 0.8 })); head.scale.setScalar(s * 0.16);
  head.position.set(s * (kind === 'goose' ? 0.42 : 0.3), s * (kind === 'goose' ? 0.16 : 0.08), 0);
  if (kind === 'goose') { const neck = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.035, s * 0.05, s * 0.28, 8), std(col[1])); neck.position.set(s * 0.34, s * 0.06, 0); neck.rotation.z = -1.0; g.add(neck); }
  const beak = new THREE.Mesh(new THREE.ConeGeometry(s * 0.025, s * 0.09, 6), std(kind === 'gull' ? 0xe0b020 : 0x2a2a2a)); beak.rotation.z = -Math.PI / 2; beak.position.copy(head.position).add(new THREE.Vector3(s * 0.1, -s * 0.01, 0));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(s * 0.22, s * 0.02, s * 0.14), std(col[1], { roughness: 0.8 })); tail.position.set(-s * 0.3, 0, 0);
  g.add(body, head, beak, tail);
  const wings = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.02, s * 0.05, side * s * 0.1);
    const geo = new THREE.BufferGeometry(); const sp = s * 0.85 * side;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([s * 0.14, 0, 0, -s * 0.16, 0, 0, -s * 0.1, 0, sp, s * 0.04, 0, sp * 0.9], 3)); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
    const w = new THREE.Mesh(geo, std(col[1], { side: THREE.DoubleSide, roughness: 0.85 })); pivot.add(w); g.add(pivot); wings.push({ pivot, side });
  }
  g.userData.wings = wings;
  return g;
}
function coneModel() {
  const g = new THREE.Group(), orange = std(0xf2551c, { roughness: 0.55 }), white = std(0xf4f4f0, { roughness: 0.25, metalness: 0.2 });
  const prof = (y0, y1) => [new THREE.Vector2(0.125 - 0.1 * y0 / 0.72, y0), new THREE.Vector2(0.125 - 0.1 * y1 / 0.72, y1)];
  const seg = (y0, y1, m) => { const geo = new THREE.LatheGeometry(prof(y0, y1), 28); const mesh = new THREE.Mesh(geo, m); g.add(mesh); };
  seg(0.03, 0.3, orange); seg(0.3, 0.4, white); seg(0.4, 0.5, orange); seg(0.5, 0.58, white); seg(0.58, 0.72, orange);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), orange); tip.position.y = 0.72; g.add(tip);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.38), std(0x1a1a1a, { roughness: 0.9 })); base.position.y = 0.015; g.add(base);
  g.children.forEach((m) => { m.position.y -= 0.3; });   // centred on the height of the wind's push
  return g;
}
function ragModel() {
  const geo = new THREE.PlaneGeometry(0.34, 0.28, 8, 7), p = geo.attributes.position, r = rnd(31);
  for (let i = 0; i < p.count; i++) p.setZ(i, (r() - 0.5) * 0.06 + Math.sin(p.getX(i) * 18) * 0.015);
  geo.computeVertexNormals(); geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, std(0xb02a22, { side: THREE.DoubleSide, roughness: 0.95 }));
}
function bagModel() {
  const geo = new THREE.IcosahedronGeometry(0.18, 2), p = geo.attributes.position, r = rnd(53);
  for (let i = 0; i < p.count; i++) { const k = 0.7 + r() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k); }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.35, transmission: 0.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
}
function boltModel() {
  const g = new THREE.Group(), steel = std(0xa8adb2, { metalness: 1, roughness: 0.3 });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.008, 6), steel); head.position.y = 0.024;
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 10), steel); g.add(head, shank);
  g.rotation.z = Math.PI / 2; const w = new THREE.Group(); w.add(g); return w;
}
function stoneModel() {
  const geo = new THREE.DodecahedronGeometry(0.022, 0); geo.scale(1.2, 0.8, 1);
  return new THREE.Mesh(geo, std(0x77736c, { roughness: 0.95, flatShading: true }));
}
function caseModel() {
  const g = new THREE.Group(), shell = std(0x1f3550, { roughness: 0.4, metalness: 0.1 }), dark = std(0x151515, { roughness: 0.7 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.66, 0.26, 2, 2, 2), shell); g.add(b);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), dark); h.position.y = 0.33; g.add(h);
  for (const x of [-0.17, 0.17]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12), dark); w.rotation.x = Math.PI / 2; w.position.set(x, -0.34, 0.1); g.add(w); }
  g.children.forEach((m) => { m.position.y += 0.0; });
  return g;
}
const MODELS = { pigeon: () => birdModel('pigeon'), gull: () => birdModel('gull'), goose: () => birdModel('goose'), cone: coneModel, rag: ragModel, bag: bagModel, bolt: boltModel, stone: stoneModel, case: caseModel };
const UPRIGHT_LIFT = { cone: 0.3, case: 0.36 };   // models are centred; standing ones sit this far up

export class ApronView {
  constructor(view) {
    this.v = view; this.on = false; this.loaded = false; this.loading = null;
    this.group = new THREE.Group(); this.group.visible = false; view.scene.add(this.group);
    this.meshes = new Map(); this.showDanger = true; this.showFlow = true; this._ot = 0;
    this._buildGround(); this._buildOverlay(); this._buildFlow();
    this.hemi = new THREE.HemisphereLight(0xbfd6f0, 0x5d5a52, 0.9); this.group.add(this.hemi);
    const sky = new THREE.CanvasTexture(skyTexture()); sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace; this.sky = sky;
  }

  _buildGround() {
    const q = this.v.quality === 'high' || this.v.quality === 'ultra' ? 4096 : 2048;
    const t = new THREE.CanvasTexture(apronTexture(q)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.93, metalness: 0 }); finish(m, { ...FINISH.castBare, scale: 1.5, bottom: 0, grime: 0.1, metalLoss: 0, bump: 0.25 });
    const near = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), m); near.rotation.x = -Math.PI / 2; near.position.set(6, GY, ZF); near.receiveShadow = true;
    const ft = new THREE.CanvasTexture(concreteTile(256)); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(240, 240); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 16;
    const far = new THREE.Mesh(new THREE.CircleGeometry(600, 72), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 })); far.rotation.x = -Math.PI / 2; far.position.set(6, GY - 0.02, ZF); far.receiveShadow = true;
    this.group.add(near, far);
  }

  _buildOverlay() {
    const g = (this.overlay = new THREE.Group()); g.renderOrder = 2; this.group.add(g);
    const fill = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.intakeFill = new THREE.Mesh(new THREE.BufferGeometry(), fill(0xd62a1e, 0.22));
    this.intakeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff4a3a }));
    this.airbusLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.jetFill = new THREE.Mesh(new THREE.BufferGeometry(), fill(0xff8a1e, 0.16));
    this.jetLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffa040 }));
    this.intakeLabel = label('Intake danger area'); this.jetLabel = label('Exhaust danger area', '#ffd08a');
    g.add(this.intakeFill, this.intakeLine, this.airbusLine, this.jetFill, this.jetLine, this.intakeLabel, this.jetLabel);
  }

  _buildFlow() {
    const N = (this.nFlow = 1400);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.flow = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flow.frustumCulled = false; this.group.add(this.flow);
    this.flowP = Array.from({ length: N }, () => this._seedFlow({}));
  }
  _seedFlow(p) {
    const r = Math.random();
    if (r < 0.5) { const a = (Math.random() - 0.5) * Math.PI * 1.6, d = 0.5 + Math.random() * 7; p.x = APRON.inletX - Math.cos(a) * d; p.z = Math.sin(a) * d; }   // round the intake
    else { p.x = APRON.nozzleX + Math.random() * 60; p.z = (Math.random() - 0.5) * (4 + (p.x - APRON.nozzleX) * 0.35); }                                        // behind the nozzle
    p.y = GY + 0.04 + Math.random() * Math.random() * 1.4; p.age = 0; p.life = 0.8 + Math.random() * 1.6;
    return p;
  }

  /** Load the aircraft (first time the apron is shown). */
  load(base, query = '') {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const man = await (await fetch(base + 'apron.json' + query, { cache: 'no-cache' })).json();
      const gltf = (await this.v._loadPacked(base, { packed: man.packed ? man.packed + query : null })) || (await new GLTFLoader().loadAsync(base + man.file + query));
      const own = {};
      gltf.scene.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const swap = (mt) => (own[mt.name] ||= this._mat(mt));
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      });
      this.aircraft = gltf.scene; this.group.add(gltf.scene); this.loaded = true;
    })();
    return this.loading;
  }
  _mat(mt) {
    const c = mt.clone(); c.side = THREE.DoubleSide;
    const f = { ac_paint: FINISH.nacellePaint, ac_wing: { ...FINISH.nacellePaint, grime: 0.22 }, ac_belly: FINISH.nacellePaint, ac_fairing: FINISH.nacellePaint, ac_gear: { ...FINISH.castPaint, bottom: 0.4 },
      ac_chrome: FINISH.polished, ac_tyre: FINISH.rubber, ac_hub: FINISH.bareSteel, ac_chock: FINISH.castPaint, ac_lip: FINISH.polished, ac_hot: { ...FINISH.hotCase, heat: [3.0, 4.0, 0.6] },
      ac_spinner: FINISH.darkBox, ac_fanface: FINISH.darkBox, ac_line: FINISH.nacellePaint }[mt.name];
    if (mt.name === 'ac_window') { c.roughness = 0.05; c.metalness = 0.6; }
    if (/navred|navgreen/.test(mt.name)) { c.emissive = c.color.clone(); c.emissiveIntensity = 2.5; }
    if (f) finish(c, f);
    return c;
  }

  /** Show or hide the apron: aircraft, stand, daylight; the studio floor and the stub wing go. */
  setOn(on) {
    const v = this.v; this.on = on; this.group.visible = on;
    if (v.floor) v.floor.visible = !on;
    v.scene.background = on ? this.sky : v.studioBackground;
    v.scene.fog = on ? new THREE.Fog(0xc6d4e2, 90, 560) : null;
    const k = v.key;
    if (on) { k.intensity = 3.2; k.position.set(-6, 14, 9); Object.assign(k.shadow.camera, { left: -12, right: 14, top: 12, bottom: -12, near: 1, far: 50 }); }
    else { k.intensity = 2.0; k.position.set(-2.5, 7, 6); Object.assign(k.shadow.camera, { left: -4.5, right: 5.5, top: 4, bottom: -4, near: 1, far: 22 }); }
    k.shadow.camera.updateProjectionMatrix();
    // the authored stub wing over the pylon makes way for the whole wing
    v.scene.traverse((n) => { if (/^pylon_wing/.test(n.name)) n.userData.apronHide = on; });
    v.setCutaway(v.cutaway);
    v.maxDist = on ? 70 : 22;
  }

  /** Point on the ground under the cursor (engine frame), or null. */
  groundPoint(ray) {
    const t = (GY - ray.ray.origin.y) / ray.ray.direction.y;
    if (!(t > 0) || t > 400) return null;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    return { x: p.x, z: p.z };
  }

  update(sim, dt, t) {
    if (!this.on) return;
    this._objects(sim, dt);
    this._ot -= dt;
    if (this._ot <= 0) { this._ot = 0.25; this._danger(sim); }
    this.overlay.visible = this.showDanger;
    this.flow.visible = this.showFlow;
    if (this.showFlow && dt > 0) this._flow(sim, dt);
  }

  _objects(sim, dt) {
    const seen = new Set();
    for (const o of sim.objs) {
      if (o.state === 'ingested' || o.state === 'gone') continue;
      seen.add(o.id);
      let m = this.meshes.get(o.id);
      if (!m) { m = MODELS[o.kind](); m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); this.group.add(m); this.meshes.set(o.id, m); }
      const lift = o.upright ? UPRIGHT_LIFT[o.kind] || 0 : 0;
      m.position.set(o.x, o.y + lift, o.z);
      m.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
      if (!o.upright && UPRIGHT_LIFT[o.kind] && o.tip > 0) {   // toppling, then lying on its side
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(o.tipDir), 0, -Math.cos(o.tipDir)), -Math.min(1, o.tip) * Math.PI / 2);
        m.quaternion.premultiply(tilt);
      }
      if (m.userData.wings) { const a = o.state === 'flying' ? Math.sin(o.flap) * 0.9 : 0.1; for (const w of m.userData.wings) w.pivot.rotation.x = -w.side * a; }
    }
    for (const [id, m] of this.meshes) if (!seen.has(id)) { this.group.remove(m); this.meshes.delete(id); }
  }

  /** Danger areas from the model, with the Airbus AC 6-3 figures for comparison. */
  _danger(sim) {
    const R = sim.f.Q > 1 ? sim.dangerRadius() : 0, xi = APRON.inletX, y = GY + 0.02;
    const pts = [], n = 72, behind = 1.2;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (Math.PI * i) / n, x = xi + R * Math.cos(a), z = R * Math.sin(a);
      pts.push(new THREE.Vector3(x, y, z));
    }
    // the area runs back along the nacelle: close it at the lip plane plus a little
    const shape = [...pts, new THREE.Vector3(xi + behind, y, -R), new THREE.Vector3(xi + behind, y, R)];
    const ring = [new THREE.Vector3(xi + behind, y, R), ...pts, new THREE.Vector3(xi + behind, y, -R)];
    const fan = []; const c = new THREE.Vector3(xi + 0.4, y, 0);
    for (let i = 0; i < ring.length - 1; i++) fan.push(c, ring[i], ring[i + 1]);
    this.intakeFill.geometry.setFromPoints(fan); this.intakeLine.geometry.setFromPoints(ring);
    this.intakeFill.visible = this.intakeLine.visible = R > 0.9;
    // Airbus: 2.74 m at idle, 5.0 m at breakaway, 5.18 m at take-off (dashed white)
    const th = clamp((this.v._lastThrust || 0) / 110e3, 0, 1);
    const Ra = th < 0.4 ? 2.74 + (5.0 - 2.74) * th / 0.4 : 5.0 + 0.18 * (th - 0.4) / 0.6, dash = [];
    for (let i = 0; i < 48; i += 2) for (const k of [i, i + 1]) { const a = Math.PI / 2 + (Math.PI * k) / 48; dash.push(new THREE.Vector3(xi + Ra * Math.cos(a), y + 0.005, Ra * Math.sin(a))); }
    this.airbusLine.geometry.setFromPoints(dash); this.airbusLine.visible = R > 0.9;
    this.intakeLabel.position.set(xi - R * 0.55, y + 0.3, 0); this.intakeLabel.visible = R > 0.9;
    const lab = `Intake danger ${R.toFixed(1)} m (Airbus ${Ra.toFixed(1)} m)`;
    if (lab !== this._il) { this._il = lab; this._relabel(this.intakeLabel, lab, '#ffffff'); }
    // exhaust: where the jet at the ground is still above 10 m/s (the Airbus idle area, 55 m, lies about there)
    const Lj = sim.f.Vj > 5 ? Math.min(400, sim.jetReach(10)) : 0, x0 = APRON.nozzleX, half = 15 * Math.PI / 180;
    const jp = [new THREE.Vector3(x0, y, -0.6), new THREE.Vector3(x0 + Lj, y, -0.6 - Lj * Math.tan(half)), new THREE.Vector3(x0 + Lj, y, 0.6 + Lj * Math.tan(half)), new THREE.Vector3(x0, y, 0.6)];
    this.jetFill.geometry.setFromPoints([jp[0], jp[1], jp[2], jp[0], jp[2], jp[3]]); this.jetLine.geometry.setFromPoints([...jp, jp[0]]);
    this.jetFill.visible = this.jetLine.visible = this.jetLabel.visible = Lj > 2;
    this.jetLabel.position.set(x0 + Math.min(Lj, 18) * 0.6, y + 0.35, 0);
    const jl = `Exhaust over 10 m/s: ${Lj.toFixed(0)} m`;
    if (jl !== this._jl) { this._jl = jl; this._relabel(this.jetLabel, jl, '#ffd08a'); }
  }
  _relabel(s, text, color) { const n = label(text, color); s.material.map.dispose(); s.material.map = n.material.map; s.material.needsUpdate = true; }

  /** Streaks of dust carried by the air near the ground. */
  _flow(sim, dt) {
    const pos = this.flow.geometry.attributes.position.array, col = this.flow.geometry.attributes.color.array, u = [0, 0, 0];
    for (let i = 0; i < this.nFlow; i++) {
      const p = this.flowP[i];
      sim.air(p.x, p.y, p.z, u);
      const sp = Math.hypot(u[0], u[1], u[2]);
      p.x += u[0] * dt; p.y = Math.max(GY + 0.02, p.y + u[1] * dt); p.z += u[2] * dt; p.age += dt;
      const ri = Math.hypot(p.y, p.z);
      if (p.age > p.life || sp < 0.4 || (p.x > APRON.inletX - 0.05 && p.x < APRON.inletX + 0.5 && ri < APRON.inletR) || p.x > APRON.nozzleX + 90 || p.y > 3) this._seedFlow(p);
      const k = clamp(0.03 + sp * 0.004, 0.03, 0.25) / Math.max(sp, 1e-3), fade = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1)) * clamp(sp / 6, 0, 1);
      const b = 6 * i;
      pos[b] = p.x; pos[b + 1] = p.y; pos[b + 2] = p.z;
      pos[b + 3] = p.x - u[0] * k; pos[b + 4] = p.y - u[1] * k; pos[b + 5] = p.z - u[2] * k;
      const w = clamp(sp / 60, 0, 1), r = (0.55 + 0.45 * w) * fade, g = (0.5 + 0.45 * w) * fade, bl = (0.42 + 0.55 * w) * fade;
      col[b] = r; col[b + 1] = g; col[b + 2] = bl; col[b + 3] = 0; col[b + 4] = 0; col[b + 5] = 0;
    }
    this.flow.geometry.attributes.position.needsUpdate = true; this.flow.geometry.attributes.color.needsUpdate = true;
  }

  /** What an ingestion looks like: feathers or shreds blown through the fan, sparks from metal. */
  ingestFx(ev) {
    const v = this.v, E = v.engine, w = new THREE.Vector3(), rnd2 = Math.random, soft = !/bolt|stone|case|cone/.test(ev.kind || '');
    for (let i = 0; i < (soft ? 40 : 18); i++) {
      const th = rnd2() * Math.PI * 2, r = 0.25 + rnd2() * 0.5;
      w.set(0.05, r * Math.cos(th), r * Math.sin(th)); E.localToWorld(w);
      if (soft) v.mist.emit(w.x, w.y, w.z, 6 + rnd2() * 10, Math.cos(th) * 2, Math.sin(th) * 2, { size0: 0.05, size1: 0.35, life: 0.6 });
      else v.hotBits.emit(w.x, w.y, w.z, -1 + rnd2() * 3, Math.cos(th) * 4, Math.sin(th) * 4, 1, 0.9, 0.6, 1, 0.25 + rnd2() * 0.3, { drag: 0.6, cool: true });
    }
    // and out of the back of the bypass duct a moment later
    for (let i = 0; i < (soft ? 24 : 8); i++) {
      const th = rnd2() * Math.PI * 2, r = 0.45 + rnd2() * 0.12;
      w.set(APRON.nozzleX, r * Math.cos(th), r * Math.sin(th)); E.localToWorld(w);
      if (soft) v.mist.emit(w.x, w.y, w.z, 20 + rnd2() * 20, Math.cos(th), Math.sin(th), { size0: 0.08, size1: 0.6, life: 1.0 });
      else v.debris.emit(w.x, w.y, w.z, 15 + rnd2() * 10, Math.cos(th) * 2, Math.sin(th) * 2, 0.005 + 0.01 * rnd2(), 10);
    }
  }
}
