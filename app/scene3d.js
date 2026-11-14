// 3D view of the engine, built procedurally from the same section profiles as
// the 2D cutaway. Pure view: reads the simulation output, never writes to it.
import * as THREE from './vendor/three.module.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { P, ROWS, rAt, tempRGB } from './cutaway.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const FLOOR_Y = -1.75;

function softSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Solid of revolution about the engine (x) axis from a closed [x, r] loop. */
function latheGeo(loop, seg = 96) {
  const pts = loop.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0008), x));
  pts.push(pts[0].clone());
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
const sample = (prof, x0, x1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const x = lerp(x0, x1, i / n); return [x, rAt(prof, x)]; });
const CONST = (r) => [[-9, r], [9, r]];
/** Annular shell between two radius profiles over an axial range. */
const shell = (inner, outer, x0, x1, n) => latheGeo([...sample(outer, x0, x1, n), ...sample(inner, x0, x1, n).reverse()]);

/** One blade: a tapered, twisted plate. Root at y = 0, span along +y, chord along x. */
function bladeGeo(chord, span, thick, stagger, twist, taper = 0.75) {
  const g = new THREE.BoxGeometry(chord, span, thick, 2, 6, 1);
  g.translate(0, span / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = p.getY(i) / span, a = stagger + twist * f, k = lerp(1, taper, f);
    const x = p.getX(i) * k, z = p.getZ(i) + 0.18 * chord * Math.sin(Math.PI * (p.getX(i) / chord + 0.5)) * (thick > 0 ? 1 : 0) * 0.35;
    p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a));
  }
  g.computeVertexNormals();
  return g;
}

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0c0f12);
    scene.fog = new THREE.Fog(0x0c0f12, 14, 38);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;
    this.camera = new THREE.PerspectiveCamera(32, 2, 0.05, 80);
    this.orbit = { az: -0.75, el: 0.2, dist: 7.4, target: new THREE.Vector3(1.45, -0.05, 0) };
    this.offsetX = 0; // px: shifts the picture so the engine sits clear of side panels
    const key = new THREE.DirectionalLight(0xfff1dc, 1.5); key.position.set(-3, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb7ff, 0.7); rim.position.set(6, 2, -6); scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1410, 0.18));
    this.flameLight = new THREE.PointLight(0xff8a30, 0, 3.5, 1.6); this.flameLight.position.set(2.05, 0, 0); scene.add(this.flameLight);

    this.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.cutaway = true; this.explode = 0; this.showFlow = true;
    this.parts = []; this.byId = {}; this.vsvRows = []; this.hover = null; this.selected = null;
    this.sprite = softSprite();
    this.t = 0; this.flash = 0;
    this.engine = new THREE.Group(); scene.add(this.engine);
    this.g1 = new THREE.Group(); this.g2 = new THREE.Group(); this.engine.add(this.g1, this.g2);
    this._buildCell();
    this._buildEngine();
    this._buildEffects();
    this._controls();
    this.resize();
  }

  // ------------------------------------------------------------------ parts
  _mat(o) { return new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o }); }
  _part(d) {
    const part = { removed: false, ex: 0, objs: [], clipped: false, glow: null, ...d };
    part.mat = this._mat(d.mat);
    if (part.clipped) part.mat.clippingPlanes = [this.clip];
    this.parts.push(part); this.byId[part.id] = part;
    return part;
  }
  _add(part, obj, parent = this.engine) {
    obj.traverse((m) => { if (m.isMesh) { if (!m.userData.keepMat && !m.isInstancedMesh) m.material = part.mat; m.userData.part = part; } });
    part.objs.push(obj); parent.add(obj);
    return obj;
  }
  _mesh(geo) { return new THREE.Mesh(geo); }

  _row(part, row, count, parent, o = {}) {
    const xm = (row.x0 + row.x1) / 2, lo = rAt(row.lo, xm) - 0.004, hi = rAt(row.hi, xm) - (row.kind === 'rotor' ? 0.004 : 0);
    const span = hi - lo, chord = (row.x1 - row.x0) * (o.chordK || 1.15);
    const geo = bladeGeo(chord, span, o.thick || Math.min(0.012, chord * 0.14), o.stagger ?? 0.6, o.twist ?? 0.35, o.taper ?? 0.8);
    const im = new THREE.InstancedMesh(geo, part.mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < count; i++) {
      const th = (i / count) * TAU; q.setFromAxisAngle(ax, th);
      m.compose(new THREE.Vector3(xm, lo * Math.cos(th), lo * Math.sin(th)), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
    }
    im.userData.row = { xm, lo, count };
    this._add(part, im, parent);
    return im;
  }

  _buildEngine() {
    const paint = { color: 0x9aa3ab, metalness: 0.35, roughness: 0.42 };
    const alu = { color: 0xb9c0c6, metalness: 1, roughness: 0.2 };
    const ti = { color: 0x9aa4ad, metalness: 0.95, roughness: 0.28 };
    const steel = { color: 0x6c7781, metalness: 0.85, roughness: 0.42 };
    const caseM = { color: 0x56606a, metalness: 0.8, roughness: 0.5 };
    const hot = { color: 0x74675c, metalness: 0.85, roughness: 0.45 };
    const lpBlade = { color: 0x8fa3b8, metalness: 0.9, roughness: 0.3 };
    const hpBlade = { color: 0xb49a6a, metalness: 0.9, roughness: 0.32 };
    const vane = { color: 0x4d555d, metalness: 0.8, roughness: 0.5 };
    const C = (T) => `${(T - 273.15).toFixed(0)} °C`, B = (p) => `${(p / 1e5).toFixed(2)} bar`;
    const A = (d) => this._part(d);

    // ---- nacelle
    const inlet = A({ id: 'inlet', name: 'Inlet cowl', ex: -1.5, clipped: true, mat: paint, desc: 'Slows and straightens the incoming air for the fan. The lip is heated with bleed air to stop ice forming.', live: (o) => `Airflow ${o.W2.toFixed(0)} kg/s · inlet ${C(o.T2)}, ${B(o.P2)}` });
    this._add(inlet, this._mesh(latheGeo([...sample(P.nacelle, -0.7, 0.0, 12), ...sample(P.inletInner, -0.7, 0.0, 12).reverse()])));
    const lip = A({ id: 'lip', name: 'Inlet lip', ex: -1.7, clipped: true, mat: alu, desc: 'Polished aluminium leading edge of the nacelle.', live: () => '' });
    this._add(lip, this._mesh(latheGeo([[-0.7, 0.782], [-0.74, 0.79], [-0.785, 0.83], [-0.775, 0.875], [-0.7, 0.925], [-0.7, 0.782]].slice(0, 5))));
    const fanCase = A({ id: 'fancase', name: 'Fan case and outlet guide vanes', ex: -0.55, clipped: true, mat: paint, desc: 'Contains the fan (and a released blade). The outlet guide vanes take the swirl out of the bypass air.', live: (o) => `Bypass ${o.Wbypass.toFixed(0)} kg/s · fan pressure ratio ${o.fan.PR.toFixed(2)} · ${C(o.T13)}` });
    this._add(fanCase, this._mesh(shell(P.bypOuter, P.nacelle, 0.0, 1.2, 14)));
    const cna = A({ id: 'cna', name: 'Thrust reverser cowls and common nozzle', ex: 0.2, clipped: true, mat: paint, desc: 'The long duct carries bypass air aft, where it mixes with the core exhaust and leaves through one common nozzle.', live: (o) => `Mixed jet ${o.V9.toFixed(0)} m/s (Mach ${o.M9.toFixed(2)}) · ${C(o.T7)} · ${o.W9.toFixed(0)} kg/s` });
    this._add(cna, this._mesh(shell(P.bypOuter, P.nacelle, 1.2, 3.55, 22)));

    // ---- fan
    const spinner = A({ id: 'spinner', name: 'Spinner', ex: -1.25, mat: { color: 0x2b3036, metalness: 0.5, roughness: 0.4 }, desc: 'Nose cone on the fan disc. Turns with the low-pressure spool.', live: (o) => `N1 ${o.N1.toFixed(0)} rpm` });
    this._add(spinner, this._mesh(latheGeo([...sample(P.spinner, -0.45, 0.02, 14), [0.02, 0.0]])), this.g1);
    const swirl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff })); swirl.position.set(-0.22, 0.125, 0); swirl.rotation.z = 0.55; swirl.userData.keepMat = true;
    this._add(spinner, swirl, this.g1);
    const fan = A({ id: 'fan', name: 'Fan — 22 wide-chord blades', ex: -1.0, mat: ti, desc: 'Hollow titanium wide-chord blades, 1.6 m across. Produces most of the thrust by moving a large mass of bypass air.', live: (o) => `N1 ${o.N1pct.toFixed(1)} % · absorbs ${(o.pwrFan / 1e6).toFixed(1)} MW · efficiency ${(o.fan.eff * 100).toFixed(0)} %` });
    this._row(fan, ROWS[0], 22, this.g1, { stagger: 0.3, twist: 0.6, thick: 0.02, chordK: 1.5, taper: 1.15 });
    this._add(fan, this._mesh(latheGeo([[0.02, 0.05], [0.02, 0.24], [0.3, 0.27], [0.3, 0.05]])), this.g1);
    this._row(fanCase, ROWS[1], 56, this.engine, { stagger: -0.25, twist: 0, thick: 0.008 }).material = fanCase.mat;

    // ---- low pressure compressor
    const lpc = A({ id: 'lpc', name: 'Low-pressure compressor (4 booster stages)', ex: -0.45, mat: lpBlade, desc: 'Booster stages on the fan shaft that supercharge the core.', live: (o) => `Pressure ratio ${o.lpc.PR.toFixed(2)} · exit ${C(o.T25)}, ${B(o.P25)} · ${o.Wlpc.toFixed(1)} kg/s` });
    const lpcCase = A({ id: 'lpccase', name: 'LPC case, stators and 2.5 bleed ring', ex: -0.3, clipped: true, mat: caseM, desc: 'Fixed vanes between the booster rotors. The bleed ring dumps air into the bypass duct at low power so the booster does not surge.', live: (o) => `2.5 bleed ${(o.b25 * 100).toFixed(0)} % open · ${o.Wb25.toFixed(1)} kg/s dumped` });
    const hpc = A({ id: 'hpc', name: 'High-pressure compressor (10 stages)', ex: 0, mat: hpBlade, desc: 'Ten stages on the high-pressure spool raise the air to over 30 times ambient pressure at take-off.', live: (o) => `N2 ${o.N2pct.toFixed(1)} % · pressure ratio ${o.hpc.PR.toFixed(1)} · exit ${C(o.T3)}, ${B(o.P3)} · absorbs ${(o.pwrHpc / 1e6).toFixed(1)} MW` });
    const hpcCase = A({ id: 'hpccase', name: 'HPC case and variable stator vanes', ex: 0.05, clipped: true, mat: caseM, desc: 'The inlet guide vanes and first three stator rows (green) rotate to keep the front stages out of stall at low speed.', live: (o) => `Stators ${o.vsv.toFixed(1)}° closed (schedule ${o.vsvSched.toFixed(1)}°) · surge margin ${(100 * (o.hpc.xs - o.hpc.x) / o.hpc.xs).toFixed(0)} %` });
    const vsvMat = this._mat({ color: 0x3fb27f, metalness: 0.6, roughness: 0.4 });
    const hpt = A({ id: 'hpt', name: 'High-pressure turbine (2 stages)', ex: 0.55, mat: { ...hot, color: 0x8a7a66 }, glow: (o) => o.T41 - 250, desc: 'Drives the HP compressor. Single-crystal blades run in gas hotter than their melting point and survive on cooling air.', live: (o) => `Entry ${C(o.T4)} · delivers ${(o.pwrHpt / 1e6).toFixed(1)} MW · cooling air ${o.Wcool.toFixed(1)} kg/s` });
    const hptCase = A({ id: 'hptcase', name: 'HPT case and nozzle guide vanes', ex: 0.6, clipped: true, mat: hot, glow: (o) => o.T4 - 350, desc: 'The guide vanes form the choked throat that sets how much air the core can pass.', live: (o) => `Expansion ratio ${o.hptPR.toFixed(2)} · exit ${C(o.T45)}, ${B(o.P45)}` });
    const lpt = A({ id: 'lpt', name: 'Low-pressure turbine (5 stages)', ex: 0.95, mat: { ...hot, color: 0x7f8590 }, glow: (o) => o.T45 - 120, desc: 'Extracts the remaining energy to drive the fan and booster through the long central shaft.', live: (o) => `Delivers ${(o.pwrLpt / 1e6).toFixed(1)} MW · expansion ratio ${o.lptPR.toFixed(2)} · efficiency ${(o.lpt.eff * 100).toFixed(0)} %` });
    const lptCase = A({ id: 'lptcase', name: 'LPT case and vanes', ex: 1.0, clipped: true, mat: hot, glow: (o) => o.T45 - 200, desc: 'Flared casing around the five low-pressure turbine stages.', live: (o) => `Turbine metal ${C(o.Tm)}` });

    for (let i = 2; i < ROWS.length; i++) {
      const row = ROWS[i], xm = (row.x0 + row.x1) / 2;
      const turbine = xm > 2.2, hp = row.spool === 2 || (row.kind === 'stator' && xm > 1.1 && xm < 2.45);
      const n = turbine ? (hp ? 64 : 70) : xm < 1.1 ? 54 : 58;
      const s = turbine ? -1 : 1;
      if (row.kind === 'rotor') {
        const part = turbine ? (row.spool === 2 ? hpt : lpt) : row.spool === 2 ? hpc : lpc;
        this._row(part, row, n, row.spool === 2 ? this.g2 : this.g1, { stagger: s * 0.7, twist: s * 0.2 });
      } else {
        const part = turbine ? (xm < 2.45 ? hptCase : lptCase) : xm < 1.1 ? lpcCase : hpcCase;
        const im = this._row(part, row, n, this.engine, { stagger: -s * 0.45, twist: 0, thick: 0.006 });
        if (row.vsv) { im.material = vsvMat; if (this.cutaway) vsvMat.clippingPlanes = []; this.vsvRows.push(im); }
      }
    }
    // drums and discs
    this._add(lpc, this._mesh(shell(CONST(0.2), P.coreInner, 0.42, 0.9, 8)), this.g1);
    this._add(hpc, this._mesh(shell(CONST(0.11), P.coreInner, 1.17, 1.86, 10)), this.g2);
    this._add(hpt, this._mesh(shell(CONST(0.08), P.coreInner, 2.26, 2.42, 4)), this.g2);
    this._add(lpt, this._mesh(shell(CONST(0.12), P.coreInner, 2.5, 3.0, 8)), this.g1);
    // casings
    this._add(lpcCase, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.025), 0.4, 1.15, 14)));
    const ring = this._mesh(new THREE.TorusGeometry(0.47, 0.022, 10, 64)); ring.rotation.y = Math.PI / 2; ring.position.x = 0.92; this._add(lpcCase, ring);
    this._add(hpcCase, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.03), 1.15, 1.9, 14)));
    this._add(hptCase, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.03), 2.2, 2.45, 6)));
    this._add(lptCase, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.025), 2.45, 3.02, 10)));

    // ---- shafts
    const lpShaft = A({ id: 'lpshaft', name: 'LP shaft', ex: 0, mat: { color: 0x3f6aa3, metalness: 0.8, roughness: 0.35 }, desc: 'Runs the length of the engine inside the HP spool, connecting the LP turbine to the fan and booster.', live: (o) => `${o.N1.toFixed(0)} rpm · net torque ${o.tq1.toFixed(0)} N·m` });
    const s1 = this._mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.85, 24)); s1.rotation.z = Math.PI / 2; s1.position.x = 1.55; this._add(lpShaft, s1, this.g1);
    const hpShaft = A({ id: 'hpshaft', name: 'HP shaft', ex: 0.02, mat: { color: 0xb07a2a, metalness: 0.8, roughness: 0.35 }, desc: 'Short hollow shaft joining the HP turbine to the HP compressor. The accessory gearbox is driven from it.', live: (o) => `${o.N2.toFixed(0)} rpm · net torque ${o.tq2.toFixed(0)} N·m · starter ${o.tStart.toFixed(0)} N·m` });
    const s2 = this._mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 24, 1, true)); s2.rotation.z = Math.PI / 2; s2.position.x = 2.05; this._add(hpShaft, s2, this.g2);

    // ---- combustor
    const comb = A({ id: 'combcase', name: 'Diffuser and combustor case', ex: 0.3, clipped: true, mat: caseM, desc: 'Pressure vessel around the combustor. Slows the compressor delivery air before it enters the flame tube.', live: (o) => `${B(o.P3)} · ${C(o.T3)}` });
    this._add(comb, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.035), 1.9, 2.2, 6)));
    this._add(comb, this._mesh(shell(CONST(0.13), P.coreInner, 1.88, 2.24, 6)));
    const liner = A({ id: 'liner', name: 'Annular combustor liner', ex: 0.32, clipped: true, glow: (o) => (o.lit ? o.T4 - 500 : 300), mat: { color: 0x9a8f85, metalness: 0.7, roughness: 0.5, transparent: true, opacity: 0.55 }, desc: 'Flame tube. Only about a third of the air is burned; the rest cools the liner and dilutes the gas to a temperature the turbine can survive.', live: (o) => (o.lit ? `Flame on · fuel/air ${o.far.toFixed(4)} (φ ${o.phi.toFixed(2)}) · exit ${C(o.T4)}` : `No flame · lean limit ${o.leanLimit.toFixed(4)}`) });
    this._add(liner, this._mesh(latheGeo([[1.96, 0.3], [2.17, 0.305], [2.19, 0.29], [1.97, 0.285]], 72)));
    this._add(liner, this._mesh(latheGeo([[1.96, 0.21], [2.17, 0.225], [2.19, 0.215], [1.97, 0.2]], 72)));
    const noz = A({ id: 'fuel', name: 'Fuel manifold and 20 fuel nozzles', ex: 0.3, mat: { color: 0xc9a23a, metalness: 0.9, roughness: 0.3 }, desc: 'Twenty airblast nozzles spray fuel into the front of the combustor.', live: (o) => `Fuel flow ${(o.wf * 3600).toFixed(0)} kg/h · ${(o.wf * 3600 / 20).toFixed(0)} kg/h per nozzle${o.wfUnburnt > 0.001 ? ` · unburnt ${(o.wfUnburnt * 3600).toFixed(0)} kg/h` : ''}` });
    const man = this._mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 80)); man.rotation.y = Math.PI / 2; man.position.x = 1.92; this._add(noz, man);
    const ng = new THREE.CylinderGeometry(0.008, 0.012, 0.17, 8); ng.translate(0, 0.335, 0);
    const nim = new THREE.InstancedMesh(ng, noz.mat, 20), mm = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) { mm.makeRotationX((i / 20) * TAU + 0.157); mm.setPosition(1.94, 0, 0); nim.setMatrixAt(i, mm); }
    this._add(noz, nim);
    const pipe = this._mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8)); pipe.position.set(1.92, -0.66, 0); this._add(noz, pipe);
    const ign = A({ id: 'ign', name: 'Igniter plugs (2)', ex: 0.3, mat: { color: 0xe6e9ec, metalness: 0.6, roughness: 0.3 }, desc: 'Two high-energy spark igniters. Only needed to light the flame; combustion is self-sustaining afterwards.', live: (o) => (o.ignOn ? 'Sparking' : 'Off') });
    for (const a of [0.9, -0.9]) { const g = new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8); g.translate(0, 0.39, 0); const m = this._mesh(g); m.rotation.x = Math.PI + a; m.position.x = 2.01; this._add(ign, m); }

    // ---- core cowl, exhaust
    const cowl = A({ id: 'corecowl', name: 'Core cowl (inner fixed structure)', ex: 0.15, clipped: true, mat: { color: 0x2f353b, metalness: 0.6, roughness: 0.55 }, desc: 'Inner wall of the bypass duct, wrapped around the core engine.', live: (o) => `Bypass duct ${B(o.P13)} · mixing plane ${B(o.Pm)}` });
    this._add(cowl, this._mesh(shell(offset(P.bypInner, -0.018), P.bypInner, 0.42, 3.12, 30)));
    const tec = A({ id: 'tec', name: 'Turbine exhaust case and plug', ex: 1.35, clipped: true, mat: hot, glow: (o) => o.T5 - 150, desc: 'Carries the rear bearing. The EGT thermocouples and the P4.9 pressure probes used for EPR sit in its struts.', live: (o) => `EGT ${C(o.egt)} · EPR ${o.epr.toFixed(3)} · core jet Mach ${o.M8.toFixed(2)}` });
    this._add(tec, this._mesh(latheGeo([...sample(P.coreInner, 3.0, 3.75, 14), [3.0, 0.0]])));
    this._add(tec, this._mesh(shell(P.coreOuter, offset(P.coreOuter, 0.022), 3.02, 3.12, 3)));
    const sg = new THREE.BoxGeometry(0.07, 0.19, 0.012); sg.translate(0, 0.37, 0);
    const sim = new THREE.InstancedMesh(sg, tec.mat, 12);
    for (let i = 0; i < 12; i++) { mm.makeRotationX((i / 12) * TAU); mm.setPosition(3.06, 0, 0); sim.setMatrixAt(i, mm); }
    this._add(tec, sim);

    // ---- accessories
    const agb = A({ id: 'agb', name: 'Accessory gearbox, starter, generator, fuel pump', ex: -0.2, mat: { color: 0x7d858c, metalness: 0.7, roughness: 0.5 }, desc: 'Driven from the HP spool. Carries the air turbine starter, the generator, hydraulic and fuel pumps and the fuel metering unit.', live: (o) => `Starter torque ${o.tStart.toFixed(0)} N·m · N2 ${o.N2pct.toFixed(1)} %` });
    const box = this._mesh(new THREE.BoxGeometry(0.75, 0.22, 0.5)); box.position.set(0.7, -1.12, 0); this._add(agb, box);
    for (const [x, z, rr, l] of [[0.5, 0.18, 0.1, 0.34], [0.86, -0.16, 0.12, 0.4], [0.9, 0.2, 0.07, 0.3], [0.52, -0.2, 0.08, 0.26]]) { const c = this._mesh(new THREE.CylinderGeometry(rr, rr, l, 16)); c.rotation.z = Math.PI / 2; c.position.set(x, -1.2, z); this._add(agb, c); }
    const duct = this._mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10)); duct.position.set(0.5, -0.86, 0.18); this._add(agb, duct);
    const eec = A({ id: 'eec', name: 'Electronic engine control (FADEC)', ex: -0.4, mat: { color: 0x1d2227, metalness: 0.4, roughness: 0.5 }, desc: 'Dual-channel computer on the fan case. Sets fuel flow, stator angle and bleed valves, and protects the engine limits.', live: () => '' });
    const eb = this._mesh(new THREE.BoxGeometry(0.4, 0.09, 0.3)); eb.position.set(0.55, 0.62, -0.83); eb.rotation.x = -0.92; this._add(eec, eb);
    for (const p of this.parts) for (const ob of p.objs) ob.userData.home = ob.position.x;
    function offset(prof, d) { return prof.map(([x, r]) => [x, r + d]); }
  }

  _buildCell() {
    const s = this.scene;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.2, roughness: 0.75 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; s.add(floor);
    const grid = new THREE.GridHelper(40, 40, 0x2c3238, 0x1c2126); grid.position.y = FLOOR_Y + 0.002; s.add(grid);
    // overhead thrust frame and pylon
    const m = new THREE.MeshStandardMaterial({ color: 0x343a40, metalness: 0.6, roughness: 0.55 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 0.3), m); beam.position.set(1.4, 1.75, 0); s.add(beam);
    const py = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.68, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a2f34, metalness: 0.6, roughness: 0.5 })); py.position.set(1.2, 1.33, 0); s.add(py);
    for (const x of [-1.1, 3.9]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.3), m); c.position.set(x, 0.05, 0); c.position.z = -1.9; s.add(c); const a = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 2.2), m); a.position.set(x, 1.75, -0.95); s.add(a); }
  }

  // ---------------------------------------------------------------- effects
  _points(n, size, blending = THREE.AdditiveBlending) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.PointsMaterial({ size, map: this.sprite, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
    const p = new THREE.Points(g, m); p.frustumCulled = false; this.scene.add(p);
    return p;
  }
  _buildEffects() {
    const N = (this.nAir = 3400);
    this.air = this._points(N, 0.03);
    this.airP = Array.from({ length: N }, (_, i) => ({ core: i % 4 === 0, u: Math.random(), v: Math.random(), th: Math.random() * TAU }));
    this.flame = this._points(260, 0.16);
    this.fuelP = this._points(200, 0.035);
    this.fog = this._points(420, 0.5, THREE.NormalBlending); this.fog.material.opacity = 0;
    this.fogSeed = Array.from({ length: 420 }, () => [Math.random(), Math.random(), Math.random() * TAU]);
    this.vortex = this._points(320, 0.11, THREE.NormalBlending); this.vortex.material.opacity = 0;
    this.torch = this._points(160, 0.4);
    this.bang = this._points(120, 0.7);
    // exhaust plume: nested cones with an animated noise shader
    const plumeMat = (rgb) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uC: { value: new THREE.Color(...rgb) }, uSpeed: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT,uA,uSpeed; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} 
        float n(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);} 
        void main(){ float along=1.0-vUv.y; float t=uT*uSpeed; float nz=n(vec2(vUv.x*14.0, along*7.0-t*3.0))*0.6+n(vec2(vUv.x*31.0, along*18.0-t*6.0))*0.4;
          float body=pow(1.0-along,1.6)*smoothstep(0.0,0.06,along); float rimF=pow(abs(dot(vN,vV)),1.4);
          gl_FragColor=vec4(uC*(0.55+0.9*nz), uA*body*rimF*(0.35+0.75*nz)); }`,
    });
    const cone = (r0, r1, len, rgb) => { const g = new THREE.CylinderGeometry(r1, r0, len, 48, 24, true); g.translate(0, len / 2, 0); g.rotateZ(-Math.PI / 2); const m = new THREE.Mesh(g, plumeMat(rgb)); m.frustumCulled = false; this.scene.add(m); return m; };
    this.plumeOuter = cone(0.6, 0.78, 1, [0.55, 0.75, 1.0]); this.plumeOuter.position.x = 3.55;
    this.plumeCore = cone(0.4, 0.5, 1, [1.0, 0.55, 0.2]); this.plumeCore.position.x = 3.2;
    this.plumeHot = cone(0.26, 0.2, 1, [1.0, 0.85, 0.6]); this.plumeHot.position.x = 3.15;
    // heated-air shimmer on the floor behind the engine
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.83, 48), new THREE.MeshBasicMaterial({ color: 0xaeb8c2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.y = Math.PI / 2; blur.position.x = 0.16; this.fanBlur = blur; this.scene.add(blur);
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
        if (drag.pan) { const k = o.dist * 0.0012; const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1); o.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); }
        else { o.az -= dx * 0.006; o.el = clamp(o.el + dy * 0.006, -0.35, 1.45); }
      } else this._pick(e, false);
    });
    el.addEventListener('pointerup', (e) => { if (drag && moved < 5 && e.button === 0) this._pick(e, true); drag = null; });
    el.addEventListener('pointerleave', () => { this.hover = null; this.onHover && this.onHover(null); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); o.dist = clamp(o.dist * Math.exp(e.deltaY * 0.0011), 1.6, 22); }, { passive: false });
    this.ray = new THREE.Raycaster();
  }
  _pick(e, click) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects(this.engine.children, true);
    let part = null;
    for (const h of hits) {
      const p = h.object.userData.part;
      if (!p || p.removed || !h.object.visible) continue;
      if (this.cutaway && p.clipped && h.point.z > 0.0005) continue; // that half is cut away
      part = p; break;
    }
    if (click) { this.selected = part; this.onSelect && this.onSelect(part); }
    else if (part !== this.hover) { this.hover = part; this.canvas.style.cursor = part ? 'pointer' : 'grab'; this.onHover && this.onHover(part, e); }
  }

  view(name) {
    const v = { hero: [-0.75, 0.2, 7.4, 1.45], front: [-1.35, 0.08, 6.5, 0.4], rear: [0.95, 0.14, 8.5, 3.6], side: [0, 0.02, 7.6, 1.45], top: [0, 1.3, 8.5, 1.45], core: [-0.25, 0.1, 3.6, 2.0] }[name];
    if (v) Object.assign(this.orbit, { az: v[0], el: v[1], dist: v[2] }), this.orbit.target.set(v[3], -0.05, 0);
  }
  setCutaway(on) { this.cutaway = on; for (const p of this.parts) if (p.clipped) { p.mat.clippingPlanes = on ? [this.clip] : []; p.mat.needsUpdate = true; } }
  setExplode(v) { this.explode = v; for (const p of this.parts) for (const ob of p.objs) ob.position.x = ob.userData.home + p.ex * v * 1.5; }
  setRemoved(id, removed) { const p = this.byId[id]; if (!p) return; p.removed = removed; for (const ob of p.objs) ob.visible = !removed; if (removed && this.selected === p) this.selected = null; }
  restoreAll() { for (const p of this.parts) this.setRemoved(p.id, false); }
  surge(which) { this.flash = 1; this.flashFront = which !== 'hpc'; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    if (this.offsetX) this.camera.setViewOffset(r.width, r.height, this.offsetX, 0, r.width, r.height); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ frame
  update(o, dt, env) {
    this.t += dt;
    const t = this.t, ob = this.orbit;
    // camera
    const ce = Math.cos(ob.el);
    this.camera.position.set(ob.target.x + ob.dist * Math.sin(ob.az) * ce, ob.target.y + ob.dist * Math.sin(ob.el), ob.target.z + ob.dist * Math.cos(ob.az) * ce);
    if (this.flash > 0.05) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(0.05 * this.flash));
    this.camera.lookAt(ob.target);

    // spools (display speed is compressed so blades stay readable; blur disc sells the rest)
    const p1 = Math.abs(o.N1pct) / 100, p2 = o.N2pct / 100;
    this.g1.rotation.x += Math.sign(o.N1) * Math.pow(p1, 0.55) * 16 * dt;
    this.g2.rotation.x += Math.pow(p2, 0.55) * 26 * dt;
    this.fanBlur.material.opacity = this.byId.fan.removed ? 0 : clamp(p1 * 0.16, 0, 0.13);
    this.fanBlur.position.x = 0.16 + this.byId.fan.ex * this.explode * 1.5;

    // variable stators
    if (Math.abs(o.vsv - (this._vsv ?? 1e9)) > 0.2) {
      this._vsv = o.vsv;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      for (const im of this.vsvRows) {
        const { xm, lo, count } = im.userData.row;
        for (let i = 0; i < count; i++) { const th = (i / count) * TAU; q.setFromAxisAngle(ax, th); q2.setFromAxisAngle(ay, (o.vsv * Math.PI) / 180); q.multiply(q2); m.compose(new THREE.Vector3(xm, lo * Math.cos(th), lo * Math.sin(th)), q, one); im.setMatrixAt(i, m); }
        im.instanceMatrix.needsUpdate = true;
      }
    }

    // incandescent metal + hover / selection highlight
    for (const p of this.parts) {
      let r = 0, g = 0, b = 0;
      if (p.glow) { const k = clamp((p.glow(o) - 800) / 650, 0, 1); r = 1.6 * k; g = (0.18 + 0.55 * k) * k; b = 0.25 * k * k; }
      if (p === this.selected) { r += 0.02; g += 0.13; b += 0.2; } else if (p === this.hover) { r += 0.01; g += 0.06; b += 0.1; }
      p.mat.emissive.setRGB(r, g, b);
    }

    // ---- air particles
    const show = this.showFlow;
    this.air.visible = show;
    if (show) {
      const pos = this.air.geometry.attributes.position.array, col = this.air.geometry.attributes.color.array;
      const vB = Math.sign(o.Wbypass) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wbypass) / 315)) * (Math.abs(o.Wbypass) > 0.5 ? 1 : 0);
      const vC = Math.sign(o.Wcore) * (0.12 + 3.2 * Math.sqrt(Math.abs(o.Wcore) / 70)) * (Math.abs(o.Wcore) > 0.05 ? 1 : 0);
      const cB = tempRGB(o.T13 + 120), c2 = tempRGB(o.T2 + 120), c25 = tempRGB(o.T25 + 150), c3 = tempRGB(o.T3 + 150), c4 = tempRGB(o.T4 + 150), c5 = tempRGB(o.T5 + 150);
      const ex = this.explode, x0 = -1.8, span = 6.2;
      for (let i = 0; i < this.nAir; i++) {
        const p = this.airP[i], v = p.core ? vC : vB;
        p.u += (v * dt) / span;
        if (p.u > 1 || p.u < 0) { p.u -= Math.floor(p.u); p.v = Math.random(); p.th = Math.random() * TAU; }
        const x = x0 + p.u * span;
        let lo, hi, c, a = 1;
        if (x < 0) { const far = x < -0.78 ? 1 + (-0.78 - x) * 0.75 : 1; hi = rAt(P.inletInner, Math.max(x, -0.78)) * far; lo = 0; c = c2; if (p.core) hi *= 0.42; else lo = hi * 0.42; a = x < -0.78 ? 0.45 : 0.8; }
        else if (x < 0.4) { lo = rAt(P.spinner, x); hi = 0.8; c = c2; const m = lerp(lo, hi, 0.36); if (p.core) hi = m; else lo = m; }
        else if (p.core) { lo = rAt(P.coreInner, Math.min(x, 3.7)); hi = x > 3.12 ? lerp(0.44, 0.3, clamp((x - 3.12) / 1.3, 0, 1)) : rAt(P.coreOuter, x); c = x < 1.0 ? c25 : x < 1.9 ? c3 : x < 2.3 ? c4 : c5; a = x > 3.3 ? clamp(1 - (x - 3.3) / 1.1, 0, 1) : 1; }
        else { lo = x > 3.12 ? lerp(0.46, 0.3, clamp((x - 3.12) / 1.3, 0, 1)) : rAt(P.bypInner, x); hi = rAt(P.bypOuter, Math.min(x, 3.55)); c = cB; a = x > 3.55 ? clamp(1 - (x - 3.55) / 0.85, 0, 1) : 1; }
        const rr = lerp(lo, hi, 0.06 + 0.88 * p.v);
        const th = p.th + (x > 0.3 && x < 3 ? 0.25 * Math.sin(x * 3 + i) : 0);
        const j = i * 3;
        pos[j] = x + ex * 0.2 * (x - 1.5); pos[j + 1] = rr * Math.cos(th); pos[j + 2] = rr * Math.sin(th);
        const k = v === 0 ? 0 : a * 0.75;
        col[j] = c[0] * k; col[j + 1] = c[1] * k; col[j + 2] = c[2] * k;
      }
      this.air.geometry.attributes.position.needsUpdate = true; this.air.geometry.attributes.color.needsUpdate = true;
    }

    // ---- fuel spray and flame
    const fill = (pts, n, fn) => { const pos = pts.geometry.attributes.position.array, col = pts.geometry.attributes.color.array; for (let i = 0; i < n; i++) fn(i, pos, col, i * 3); pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; };
    const exC = this.byId.liner.ex * this.explode * 1.5;
    const fuelOn = o.wf > 0.002 && show;
    this.fuelP.visible = fuelOn;
    if (fuelOn) fill(this.fuelP, 200, (i, pos, col, j) => { const nz = i % 20, th = (nz / 20) * TAU + 0.157, f = (t * 3 + i * 0.137) % 1, r = 0.25 + (((i * 7) % 11) / 11 - 0.5) * 0.05 * f; pos[j] = 1.95 + f * 0.09 + exC; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = (1 - f) * clamp(o.wf / 0.4, 0.25, 1); col[j] = 1.0 * k; col[j + 1] = 0.85 * k; col[j + 2] = 0.25 * k; });
    const inten = o.lit ? clamp(o.farBurn / 0.026, 0.2, 1.4) : 0;
    this.flame.visible = inten > 0;
    this.flameLight.intensity = inten * (2.2 + 0.5 * Math.sin(t * 40)); this.flameLight.position.x = 2.05 + exC;
    if (inten > 0) fill(this.flame, 260, (i, pos, col, j) => { const th = Math.random() * TAU, f = Math.random(), r = 0.25 + (Math.random() - 0.5) * 0.06; pos[j] = 1.98 + f * 0.2 * Math.min(1.2, inten + 0.3) + exC; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = (1 - f * 0.7) * inten * 0.5; col[j] = k; col[j + 1] = k * (0.35 + 0.5 * (1 - f)); col[j + 2] = k * 0.12 * (1 - f); });
    // unburnt fuel torching from the tailpipe
    const torch = o.wfUnburnt > 0.01 || (o.lit && o.pool > 0.02) ? 1 : 0;
    this.torch.visible = torch > 0;
    if (torch) fill(this.torch, 160, (i, pos, col, j) => { const f = Math.random(), th = Math.random() * TAU, r = Math.random() * (0.3 + 0.25 * f); pos[j] = 3.1 + f * 2.2; pos[j + 1] = r * Math.cos(th) + f * f * 0.3; pos[j + 2] = r * Math.sin(th); const k = (1 - f) * 0.5; col[j] = k; col[j + 1] = k * 0.5; col[j + 2] = k * 0.08; });

    // ---- exhaust plume
    const thr = clamp(o.Fg / 140e3, 0, 1), hotK = clamp((o.T5 - 400) / 500, 0, 1);
    const L = 1.2 + 5.5 * Math.sqrt(thr);
    const setPl = (m, len, a, sp) => { m.scale.set(len, 1, 1); m.material.uniforms.uT.value = t; m.material.uniforms.uA.value = a; m.material.uniforms.uSpeed.value = sp; m.visible = a > 0.004; };
    setPl(this.plumeOuter, L, o.W9 > 5 ? 0.1 + 0.55 * thr : 0, 0.6 + 2.5 * thr);
    setPl(this.plumeCore, L * 0.8, (0.3 + 1.0 * thr) * hotK, 0.8 + 3 * thr);
    setPl(this.plumeHot, L * 0.45, (0.4 + 0.9 * thr) * clamp((o.T5 - 560) / 300, 0, 1), 1 + 3 * thr);
    this.plumeCore.material.uniforms.uC.value.setRGB(1.0, 0.35 + 0.35 * hotK, 0.12 + 0.2 * hotK);

    // ---- inlet condensation and ground vortex (see envEffects in main.js for the physics)
    const fogA = env ? env.fog : 0, vx = env ? env.vortex : 0;
    this.fog.material.opacity += (fogA * 0.3 - this.fog.material.opacity) * Math.min(1, dt * 2);
    this.fog.visible = this.fog.material.opacity > 0.004;
    if (this.fog.visible) fill(this.fog, 420, (i, pos, col, j) => { const s = this.fogSeed[i], f = (s[0] + t * (0.25 + 0.5 * p1)) % 1, x = -1.0 + f * 1.0, r = Math.sqrt(s[1]) * 0.76 * (x < -0.78 ? 1.05 : 1); const th = s[2] + t * 0.2; pos[j] = x; pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = Math.sin(f * Math.PI); col[j] = col[j + 1] = col[j + 2] = 0.9 * k; });
    this.vortex.material.opacity += (vx * (0.25 + 0.6 * fogA) - this.vortex.material.opacity) * Math.min(1, dt * 1.5);
    this.vortex.visible = this.vortex.material.opacity > 0.004;
    if (this.vortex.visible) {
      const gx = -1.25 + 0.12 * Math.sin(t * 0.7), gz = 0.25 * Math.sin(t * 0.43); // the foot wanders over the floor
      fill(this.vortex, 320, (i, pos, col, j) => { const f = ((i / 320) + t * 0.6) % 1, e = f * f * (3 - 2 * f); const cx = lerp(gx, -0.45, e), cy = lerp(FLOOR_Y, -0.5, f), cz = lerp(gz, 0, e); const jit = ((i * 7919) % 97) / 97, rad = (lerp(0.22, 0.03, Math.min(1, f * 2.2)) + 0.03 * f) * (0.55 + 0.6 * jit), a = f * 22 - t * 9 + jit * 6.283; pos[j] = cx + rad * Math.cos(a); pos[j + 1] = cy; pos[j + 2] = cz + rad * Math.sin(a); const k = 0.75 * Math.sin(Math.min(1, f * 1.15) * Math.PI) + 0.1; col[j] = col[j + 1] = col[j + 2] = k; });
    }

    // ---- surge flash: flame out of the front (and back)
    this.bang.visible = this.flash > 0.03;
    if (this.bang.visible) {
      const fl = this.flash, front = this.flashFront;
      fill(this.bang, 120, (i, pos, col, j) => { const f = Math.random(), th = Math.random() * TAU, back = i % 3 === 0 || !front; const r = Math.random() * (back ? 0.4 : 0.75); pos[j] = back ? 3.2 + f * 2 : -0.2 - f * 1.4 * (1.2 - fl); pos[j + 1] = r * Math.cos(th); pos[j + 2] = r * Math.sin(th); const k = fl * (1 - f) * 0.7; col[j] = k; col[j + 1] = k * 0.55; col[j + 2] = k * 0.12; });
      this.flash *= Math.pow(0.004, dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
