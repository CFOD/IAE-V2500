// Borescope inspection: a probe in through one of the ports modelled on the cases (model.json 'ports'), with a
// light at its tip and a fisheye lens; turn the spool a blade at a time and look for damage, as an engineer
// does after a bird strike or an overheat. The engine should be stopped: a turning spool just blurs past.
import * as THREE from './vendor/three.module.js';
import { P, rAt } from './cutaway.js';
import { describe, ngvBurnAt } from './damage3d.js';

const DEG = Math.PI / 180, TAU = 2 * Math.PI, clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => ((a % TAU) + 3 * Math.PI) % TAU - Math.PI;
// two ports that are not on a case: the fan is looked at from the intake, and booster stage 1 by passing the
// probe between the fan blades and through the core inlet guide vanes
const FAN_PORT = { id: 'fan', part: 'fan', x: -0.3, th: 24, r: 0.62, rIn: 0.8, sees: 'fan blades and annulus fillers, from the intake' };
const LPC_PORT = { id: 'lpc1', part: 'lpccase', x: 0.456, th: 24, r: 0.47, rIn: 0.46, sees: 'booster stage 1 blades, through the core inlet guide vanes' };
const FAN = { x: 0.1, hub: 0.3, tip: 0.79 };   // fan blade leading edge station and span, for aiming

// fisheye lens and the dark round image of a borescope
export const BorescopeShader = {
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 }, uK: { value: 0.55 }, uT: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAspect, uK, uT; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; c.x *= uAspect; float r = length(c);
      vec2 q = c * (1.0 + uK * r * r); q.x /= uAspect;
      vec3 col = texture2D(tDiffuse, clamp(q + 0.5, 0.0, 1.0)).rgb;
      col *= vec3(1.03, 0.99, 0.9);                                   // warm LED
      col += (h(vUv * 900.0 + uT) - 0.5) * 0.025;                     // sensor noise
      float edge = 1.0 - smoothstep(0.43, 0.47, r);                   // round image
      col *= edge * (1.0 - 0.35 * smoothstep(0.2, 0.45, r));
      gl_FragColor = vec4(max(col, 0.0), 1.0); }`,
};

/** What a ring of the authored model is, in words. */
function rowName(name) {
  const m = name.replace(/^damaged:/, '').replace(/:\d+$/, '').replace(/^ring_/, '').replace(/_(lo|mid)$/, '');
  const st = (s) => (s.match(/\d+/) ? s.match(/\d+/)[0] : '');
  if (/^fan_blade/.test(m)) return 'Fan blade';
  if (/^fan_filler/.test(m)) return 'Annulus filler';
  if (/^lpc_igv/.test(m)) return 'Booster inlet guide vane';
  if (/^lpc_r/.test(m)) return `Booster stage ${st(m)} blade`;
  if (/^lpc_s/.test(m)) return `Booster stage ${st(m)} vane`;
  if (/^hpc_r/.test(m)) return `HP compressor stage ${st(m)} blade`;
  if (/^hpccase_(igv|vsv)/.test(m)) return m.includes('igv') ? 'HP compressor inlet guide vane' : `Variable stator vane, row ${st(m)}`;
  if (/^hpccase_s/.test(m)) return `HP compressor stage ${st(m)} vane`;
  if (/^hpt_r/.test(m)) return `HP turbine stage ${st(m)} blade`;
  if (/^hptcase_ngv/.test(m)) return `HP turbine stage ${st(m)} guide vane`;
  if (/^lpt_r/.test(m)) return `LP turbine stage ${st(m)} blade`;
  if (/^lptcase_v/.test(m)) return `LP turbine stage ${st(m)} vane`;
  if (/^liner_swirler/.test(m)) return 'Swirler';
  if (/^fuel_injector/.test(m)) return 'Fuel injector tip';
  return null;
}
const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
// blades are numbered round the row from the first; a static ring's instances are sorted for the cutaway, so
// its number comes from the angle
function number(im, i) {
  const ths = im.userData.ths, n = ths.length, live = im.userData.row;
  if (live) return i + 1;
  const th0 = Math.min(...ths);
  return (Math.round((ths[i] - th0) / (TAU / n)) % n) + 1;
}

export class Borescope {
  constructor(view) {
    this.v = view; this.on = false; this.port = null;
    this.yaw = 0; this.tilt = 0; this.depth = 0.5; this.turn = 0; this.turned = 0; this.t = 0; this._rt = 0;
    this.dist = 0.1; this.dS = 0.1; this.target = null;
    // the LED ring round the lens: a wide spot, physical fall-off, and a little fill from the probe body
    this.light = new THREE.SpotLight(0xfff0d8, 0, 0, 1.0, 0.8, 2); view.scene.add(this.light, this.light.target);
    this.glow = new THREE.PointLight(0xffe6c8, 0, 0, 2); view.scene.add(this.glow);
    this.info = { what: '', damage: '', blade: '' };
  }
  ports() { return [FAN_PORT, LPC_PORT, ...(this.v.ports || [])]; }

  /** The rotor row a port looks at, and the gap the probe sits in. */
  _layout(port) {
    const rings = this.v.ringsMeta || [], mod = port.part.replace('case', ''), xr = port.x;
    if (port.part === 'fan') return { rotor: rings.find((r) => r.node === 'ring_fan_blade'), x: -0.3, r: 0.6, look: 1, group: this.v.g1, row: 'fan' };
    if (port.part === 'combcase') return { rotor: null, x: 2.1, r: 0.255, look: -1, group: null };
    const rotors = rings.filter((r) => r.kind === 'rotor' && r.blade && r.part === mod), stators = rings.filter((r) => r.kind !== 'rotor' && r.blade && r.part === port.part);
    const rotor = rotors.reduce((a, b) => (Math.abs(b.x - xr) < Math.abs(a.x - xr) ? b : a), rotors[0]);
    if (!rotor) return { rotor: null, x: xr, r: port.rIn - 0.02, look: 1, group: null };
    const side = xr >= rotor.x ? 1 : -1, cand = stators.filter((s) => (s.x - rotor.x) * side > 0);
    const st = cand.reduce((a, b) => (Math.abs(b.x - rotor.x) < Math.abs(a.x - rotor.x) ? b : a), cand[0]);
    const x = st ? (rotor.x + st.x) / 2 : rotor.x + side * 0.02, ci = rAt(P.coreInner, x), co = rAt(P.coreOuter, x);
    return { rotor, x, r: ci + 0.62 * (co - ci), rMin: ci + 0.012, rMax: co - 0.006, look: -side, group: rotor.spool === 2 ? this.v.g2 : this.v.g1 };
  }

  enter(port) {
    const v = this.v;
    if (!this.on) {
      this.saved = { cut: v.cutaway, near: v.camera.near, bg: v.scene.background, env: v.scene.environmentIntensity ?? 1, lights: [] };
      v.scene.traverse((n) => { if (n.isLight && n !== this.light && n !== this.glow) { this.saved.lights.push([n, n.intensity]); n.intensity *= 0.02; } });
      v.scene.environmentIntensity = 0.04; v.scene.background = new THREE.Color(0x000000);
      if (v.cutaway) v.setCutaway(false);
      v.camera.near = 0.002;
      // Low has no post-processing; the lens needs the composer, so run it bare (no bloom, haze or SMAA)
      this.saved.fx = [v.bloom, v.haze, v.smaa].filter(Boolean).map((ps) => [ps, ps.enabled]);
      if (v.quality === 'low') for (const [ps] of this.saved.fx) ps.enabled = false;
    }
    this.on = true; this.port = port; this.L = this._layout(port);
    this.yaw = port.part === 'fan' ? 0.25 : port.part === 'combcase' ? 0 : 0.45; this.tilt = port.part === 'combcase' ? -0.1 : 0.12; this.depth = 0.5; this.turned = 0; this.turn = 0;
    this._rt = 0; this.dS = this.dist = port.part === 'fan' ? 0.3 : 0.04;
    if (v.bsPass) v.bsPass.enabled = true;
  }
  exit() {
    const v = this.v; if (!this.on) return;
    for (const [n, i] of this.saved.lights) n.intensity = i;
    v.scene.environmentIntensity = this.saved.env; v.scene.background = this.saved.bg; v.camera.near = this.saved.near; v.camera.up.set(0, 1, 0);
    if (this.saved.cut) v.setCutaway(true);
    for (const [ps, en] of this.saved.fx || []) ps.enabled = en;
    this.light.intensity = 0; this.glow.intensity = 0; this.on = false; this.port = null; this.target = null;
    if (v.bsPass) v.bsPass.enabled = false;
    v.resize();
  }
  /** Turn the spool by n blades (it eases round). */
  stepBlade(n) { if (this.L && this.L.rotor) this.turn += (n * TAU) / this.L.rotor.count; }
  look(dx, dy) { this.yaw = wrap(this.yaw - dx * 0.005); this.tilt = clamp(this.tilt + dy * 0.005, -1.2, 1.2); }
  push(d) { this.depth = clamp(this.depth + d, 0, 1); }
  /**
   * Bring a blade or vane into the middle of the picture: a rotor is turned round to it, as the mechanic turns
   * the spool; a vane cannot move, so the tip is steered towards it. im: the instanced row, i: the instance,
   * span: 0 hub to 1 tip, where to look.
   */
  aim(im, i, span = 0.6) { this.target = { im, i, span }; }

  _radius() { const L = this.L; return L.rMin != null ? L.rMax - (L.rMax - L.rMin) * (0.15 + 0.7 * this.depth) : L.r + (this.depth - 0.5) * 0.08; }
  _frame() {
    const th = this.port.th * DEG;
    return { rad: new THREE.Vector3(0, Math.cos(th), Math.sin(th)), tan: new THREE.Vector3(0, -Math.sin(th), Math.cos(th)), ax: new THREE.Vector3(1, 0, 0) };
  }
  _dir(F) {
    const d = F.ax.clone().multiplyScalar(this.L.look * Math.cos(this.yaw)).addScaledVector(F.tan, Math.sin(this.yaw));
    return d.multiplyScalar(Math.cos(this.tilt)).addScaledVector(F.rad, -Math.sin(this.tilt)).normalize();
  }
  /** Where a blade's surface is at radius r, in its template (angle 0): mean axial station and angle. */
  _surf(im, r) {
    const k = this.L && this.L.look < 0 ? 0.75 : 0.25;   // a probe behind the row sees the trailing edge
    const key = `${im.geometry.uuid}:${r.toFixed(3)}:${k}`; this._sc = this._sc || new Map();
    if (this._sc.has(key)) return this._sc.get(key);
    const p = im.geometry.attributes.position; let r0 = Infinity, r1 = 0;
    for (let i = 0; i < p.count; i++) { const q = Math.hypot(p.getY(i), p.getZ(i)); if (q < r0) r0 = q; if (q > r1) r1 = q; }
    const rr = clamp(r, r0 + 0.02 * (r1 - r0), r1 - 0.02 * (r1 - r0)), w = 0.04 * (r1 - r0);
    // the leading and trailing edge in that band; aim a quarter of the way back from the leading edge, which is
    // the part a probe in front of the row sees
    let le = null, te = null;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (Math.abs(Math.hypot(y, z) - rr) > w) continue;
      if (!le || x < le[0]) le = [x, Math.atan2(z, y)];
      if (!te || x > te[0]) te = [x, Math.atan2(z, y)];
    }
    const out = le ? { x: le[0] + k * (te[0] - le[0]), d: le[1] + k * wrap(te[1] - le[1]), r: rr } : { x: null, d: 0, r: rr };
    this._sc.set(key, out); return out;
  }
  _aim() {
    const T = this.target, L = this.L, im = T.im; this.target = null;
    const name = im.name.replace(/^ring_/, '').replace(/_(lo|mid)$/, ''), meta = (this.v.ringsMeta || []).find((r) => r.node === `ring_${name}`);
    const fan = /^fan_/.test(name), xm = fan ? FAN.x : meta ? meta.x : L.x;
    const ri = fan ? FAN.hub : rAt(P.coreInner, xm), ro = fan ? FAN.tip : rAt(P.coreOuter, xm);
    // the blade itself at that span: staggered and swept, its surface is well round from its root line
    const S = this._surf(im, ri + clamp(T.span, 0.05, 0.95) * (ro - ri)), xt = S.x ?? xm, rt = S.r;
    const rp = this._radius(), th0 = this.port.th * DEG, F = this._frame(), dx = xt - L.x;
    if (im.userData.row && L.group) {   // a rotor: tilt to the span, then turn the blade to where the tip looks
      this.tilt = clamp(Math.atan2(rp - rt, Math.abs(dx) / Math.max(0.2, Math.abs(Math.cos(this.yaw)))), -1.2, 1.2);
      const d = this._dir(F), t = Math.abs(d.x) > 1e-3 ? dx / d.x : 0.05;
      const p = new THREE.Vector3(L.x, 0, 0).addScaledVector(F.rad, rp).addScaledVector(d, t), thc = Math.atan2(p.z, p.y);
      this.turn += wrap(thc - (im.userData.ths[T.i] + S.d + L.group.rotation.x + this.turn));
    } else {   // a vane: steer the tip round to it
      const dth = wrap(im.userData.ths[T.i] + S.d - th0), s = rt * Math.sin(dth), dr = rp - rt * Math.cos(dth);
      this.yaw = Math.atan2(s, dx * L.look); this.tilt = clamp(Math.atan2(dr, Math.hypot(dx, s)), -1.2, 1.2);
    }
  }

  /** Called by the view each frame after the orbit camera: puts the camera at the probe tip. */
  apply(camera, dt) {
    const L = this.L, E = this.v.engine; this.t += dt;
    if (this.target) this._aim();
    if (this.turn && L.group) {   // the mechanic turns the spool by hand (or with the cranking tool on the gearbox)
      const d = Math.sign(this.turn) * Math.min(Math.abs(this.turn), dt * 1.4);
      L.group.rotation.x += d; this.turn -= d; this.turned += d;
    }
    const F = this._frame(), pos = new THREE.Vector3(L.x, 0, 0).addScaledVector(F.rad, this._radius()), d = this._dir(F);
    pos.applyMatrix4(E.matrixWorld); d.transformDirection(E.matrixWorld);
    camera.position.copy(pos); camera.up.copy(F.rad).transformDirection(E.matrixWorld);
    camera.lookAt(pos.clone().add(d)); camera.fov = 72; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    // automatic gain, like the camera in the probe: the LEDs are dimmed for what is close and brightened for what
    // is far, so a blade a centimetre away is not burnt out and one ten centimetres away is not lost
    this.dS += (this.dist - this.dS) * Math.min(1, dt * 5);
    const g = Math.max(0.006, this.dS) ** 2;
    this.light.intensity = 3.4 * g; this.glow.intensity = 0.6 * g;
    this.light.position.copy(pos).addScaledVector(d, -0.003); this.light.target.position.copy(pos).add(d); this.light.target.updateMatrixWorld();
    this.glow.position.copy(pos).addScaledVector(d, -0.006);
    if (this.v.bsPass) { this.v.bsPass.uniforms.uT.value = this.t % 100; this.v.bsPass.uniforms.uAspect.value = camera.aspect; }
    if ((this._rt -= dt) <= 0) { this._rt = 0.25; this._probe(camera); }
  }

  /** What is in the middle of the picture, what is wrong with it, and how far away the scene is. */
  _probe(camera) {
    const ray = new THREE.Raycaster(), E = this.v.engine.children, ds = [];
    ray.far = 0.8;
    let what = '', dmg = '';
    for (const [k, [sx, sy]] of [[0, 0], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].entries()) {
      ray.setFromCamera(new THREE.Vector2(sx, sy), camera);
      const hits = ray.intersectObjects(E, true).filter((h) => shown(h.object));
      ds.push(hits.length ? hits[0].distance : 0.8);
      if (k) continue;
      for (const h of hits) {
        const o = h.object, nm = rowName(o.name || '');
        if (!nm) { if (o.isMesh && !/^damaged:/.test(o.name)) break; continue; }   // something else is in the way
        const dd = (this.v._dmgMeshes || []).find((q) => q.mesh === o);
        if (dd) { what = `${nm} ${number(dd.im, dd.i)} of ${dd.im.userData.ths.length}`; dmg = describe(dd.list); }
        else if (o.isInstancedMesh && h.instanceId != null) { what = `${nm} ${number(o, h.instanceId)} of ${o.userData.ths.length}`; dmg = this._heat(o, h.instanceId); }
        else what = nm;
        break;
      }
    }
    const c = ds[0]; ds.sort((a, b) => a - b); this.dist = clamp(Math.sqrt(c * ds[2]), 0.008, 0.6);   // centre-weighted: the centre and the median set the gain
    const L = this.L, n = L && L.rotor ? L.rotor.count : 0, k = n ? Math.round(this.turned / (TAU / n)) : 0;
    const blade = n ? `Turned ${k} blade${Math.abs(k) === 1 ? '' : 's'} (row of ${n})` : '';
    this.info = { what, damage: dmg, blade };
  }
  /** Heat damage that is only a colour (app/damage3d.js keeps the figures). */
  _heat(im, i) {
    const h = this.v._heat; if (!h) return '';
    const nm = im.name.replace(/_(lo|mid)$/, '');
    if (nm === 'ring_hptcase_ngv1') { const b = ngvBurnAt(im.userData.ths[i], h.burn); return b > 0.15 ? 'thermal barrier coating burnt off, metal oxidised' : b > 0.04 ? 'coating discoloured by a hot streak' : ''; }
    const k = nm === 'ring_hpt_r1' ? h.kH : nm === 'ring_hpt_r2' ? h.kH * 0.7 : nm === 'ring_lpt_r3' ? h.kL : 0;
    return k > 0.66 ? 'blue heat tint: overheated, blade life used up' : k > 0.33 ? 'bronze heat tint: overheated' : k > 0.08 ? 'straw heat tint: run hot' : '';
  }
}
