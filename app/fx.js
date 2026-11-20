// Smoke, fire, mist and the bits a failure throws out.
//
// Billows: camera-facing quads driven from the CPU (so each puff lives where it was born, smoke can be
// sorted back to front, and bursts can be emitted from anywhere). Their look comes from a tileable noise
// texture baked once at start-up (smooth fbm, fine fbm, cauliflower "billow" noise and ridged turbulence):
//  - smoke is lit: a normal is worked out from the puff's shape and noise, lit by the key light and the sky,
//    shadowed by its own density towards the light, and glows from below when a fire burns under it;
//  - fire is tongues of flame: each quad is stretched along its motion into a teardrop, eaten away by
//    scrolling turbulence, and coloured by temperature (black-body ramp: white-yellow core, orange, deep
//    red at the tips). It is blended as emitted light with partial occlusion, so layers build into a body
//    of flame instead of adding up to a white blob.
// Streaks draw fast small things (embers, glowing fragments, spray) as short lines along their velocity;
// Shards are real tumbling fragments of metal.
//
// GPU-safe GLSL: no pow() of a negative base, smoothstep edges always ordered, no normalize(0).
import * as THREE from './vendor/three.module.js';
import { Pass, FullScreenQuad } from './vendor/jsm/postprocessing/Pass.js';

/** Shared by every effect: the baked noise, the key light direction in view space, and the camera for sorting. */
export const FX = { uDepth: { value: null }, uSoftOn: { value: 0 }, uScreen: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 100 }, uNoise: { value: null }, uLightV: { value: new THREE.Vector3(0.3, 0.8, 0.5) }, uSky: { value: new THREE.Vector3(0.42, 0.45, 0.5) }, uSun: { value: new THREE.Vector3(1.0, 0.96, 0.9) }, camera: null };

// ------------------------------------------------------------------ noise texture
/** 256 x 256 tileable noise, four kinds in RGBA: smooth fbm, fine fbm, billows (inverted cellular fbm), ridged turbulence. */
export function noiseTexture(size = 256) {
  let sd = 1234567; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const perm = new Uint8Array(512), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071], GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin = (x, y, P) => {   // periodic gradient noise, about -0.7..0.7
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P, X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
    const g = (X, Y, dx, dy) => { const h = perm[perm[X] + Y] & 7; return GX[h] * dx + GY[h] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(X0, Y0, xf, yf), b = g(X1, Y0, xf - 1, yf), c = g(X0, Y1, xf, yf - 1), d = g(X1, Y1, xf - 1, yf - 1);
    return a + u * (b - a) + v * (c + u * (d - c) - a - u * (b - a));
  };
  const cell = (x, y, P) => {   // periodic cellular noise: distance to the nearest feature point, 0..~1
    const xi = Math.floor(x), yi = Math.floor(y); let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const X = (((xi + i) % P) + P) % P, Y = (((yi + j) % P) + P) % P, h = perm[perm[X] + Y], h2 = perm[h + 17];
      const dx = xi + i + h / 255 - x, dy = yi + j + h2 / 255 - y, dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  };
  const fbm = (fn, x, y, P, oct, map = (v) => v) => { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * map(fn(x * f, y * f, P * f)); n += a; a *= 0.5; f *= 2; } return s / n; };
  const data = new Uint8Array(size * size * 4), ch = [[], [], [], []];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    ch[0].push(fbm(perlin, u * 4, v * 4, 4, 5));
    ch[1].push(fbm(perlin, u * 8 + 3.1, v * 8 + 7.3, 8, 4));
    ch[2].push(fbm(cell, u * 4, v * 4, 4, 3, (c) => 1 - c));
    ch[3].push(fbm(perlin, u * 4 + 11.7, v * 4 + 5.2, 4, 4, (q) => { const r = 1 - Math.abs(q) * 1.6; return r * r; }));
  }
  for (let c = 0; c < 4; c++) {   // stretch each channel to the full 0..255 range
    const a = ch[c]; let lo = Infinity, hi = -Infinity; for (const q of a) { if (q < lo) lo = q; if (q > hi) hi = q; }
    for (let i = 0; i < a.length; i++) data[i * 4 + c] = Math.round(((a[i] - lo) / (hi - lo)) * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ billows
const VERT = `
  attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iSeed; attribute vec3 iMisc;   // size, rotation, age 0..1
  uniform float uStretch;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vFade; varying vec2 vDir; varying float vViewZ;
  void main(){
    float size = iMisc.x, rot = iMisc.y; vAge = iMisc.z; vSeed = iSeed;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec2 q = position.xy;
    vec2 vv = (modelViewMatrix * vec4(iVel, 0.0)).xy;
    float l = length(vv);
    vec2 along = vv / max(l, 1e-4);
    if (l < 1e-4) along = vec2(0.0, 1.0);
    vec2 perp = vec2(along.y, -along.x);   // keeps the quad's winding (a mirrored basis would be back-face culled)
    float c = cos(rot), s = sin(rot);
    // flames and jets: the quad's long axis follows the motion, stretched by how far it moves in a blink;
    // smoke and mist: turned by the puff's own rotation
    float useS = step(1e-5, uStretch), st = 1.0 + uStretch * l / max(size, 0.02);
    vec2 off = mix(vec2(q.x * c - q.y * s, q.x * s + q.y * c), perp * q.x + along * (q.y * st), useS) * size;
    vDir = mix(vec2(s, c), vec2(0.0, 1.0), useS);   // the view's "up" in the quad's own frame, for lighting
    mv.xy += off;
    vFade = smoothstep(0.12, 0.9, -mv.z); vViewZ = -mv.z;   // never fill the camera
    gl_Position = projectionMatrix * mv;
    vUv = q;
  }`;
const SMOKE = `
  uniform sampler2D uNoise; uniform vec3 uColA, uColB, uColC, uLightV, uSky, uSun, uGlow;
  uniform float uAlpha, uLit, uSoft, uDetail;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vFade; varying vec2 vDir;
  uniform sampler2D uDepth; uniform float uSoftOn, uNear, uFar, uSoftDist; uniform vec2 uScreen; varying float vViewZ;
  // Soft particles: compare with the depth of the solid scene. Behind a surface the puff is hidden; close in
  // front of it the puff fades, so smoke meets the engine and the floor without a hard line.
  float soft(){
    if (uSoftOn < 0.5) return 1.0;
    float d = texture2D(uDepth, gl_FragCoord.xy / uScreen).x;
    float sceneZ = (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
    return smoothstep(0.0, uSoftDist, sceneZ - vViewZ);
  }
  float dens(vec2 p){ vec4 n = texture2D(uNoise, p); vec4 m = texture2D(uNoise, p * 2.13 + 0.37); return n.b * 0.62 + n.r * 0.28 + (m.g - 0.5) * 0.32 * uDetail; }
  void main(){
    vec2 uv = vUv * 2.0; float r = length(uv);
    if (r > 1.0) discard;
    vec2 base = vUv * (0.3 + 0.14 * vSeed.x) + vSeed.yz * 9.7 + vec2(vAge * 0.05, -vAge * 0.09);   // the texture drifts slowly inside the puff: it churns
    float n = dens(base);
    float shape = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.55);
    float d = shape * (0.35 + 0.95 * n);
    float erode = (0.1 + 0.55 * vAge) * uSoft;                  // older puffs thin out from the edges inwards
    float a = smoothstep(erode, erode + 0.6, d);
    a *= smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.6, 1.0, vAge)) * vFade;
    if (a < 0.004) discard;
    a *= soft(); if (a < 0.004) discard;
    // normal: a dome over the puff, roughened by the density gradient
    float e = 0.012, gx = dens(base + vec2(e, 0.0)) - n, gy = dens(base + vec2(0.0, e)) - n;
    vec2 g2 = uv * 0.8 - vec2(gx, gy) * 14.0;
    vec2 gv = vec2(g2.x * vDir.y - g2.y * vDir.x, g2.x * vDir.x + g2.y * vDir.y);   // quad frame -> view frame
    vec3 N = normalize(vec3(gv, max(0.15, sqrt(max(0.0, 1.0 - r * r)) + 0.35)));
    // light: wrapped key light, shadowed by the puff's own density towards it, and sky from above
    vec2 Lq = vec2(uLightV.x * vDir.y + uLightV.y * vDir.x, -uLightV.x * vDir.x + uLightV.y * vDir.y);   // view frame -> quad frame
    float occl = dens(base + Lq * 0.09) * shape;
    float sh = mix(1.0, 0.35, smoothstep(0.25, 0.85, occl));
    float dif = clamp(dot(N, uLightV) * 0.6 + 0.4, 0.0, 1.0) * sh;
    float sky = 0.55 + 0.45 * N.y;
    vec3 alb = vAge < 0.3 ? mix(uColA, uColB, vAge / 0.3) : mix(uColB, uColC, (vAge - 0.3) / 0.7);
    vec3 col = alb * (uSky * sky * (1.0 - 0.5 * uLit) + uSun * dif * (0.35 + uLit));
    float yg = (1.0 - vAge) * (1.0 - vAge); col += uGlow * yg * yg * (0.5 + 0.5 * max(0.0, -N.y)) * (0.4 + 0.6 * d);   // lit from below by flames, only near them
    gl_FragColor = vec4(max(col, 0.0), clamp(a * uAlpha, 0.0, 1.0));
  }`;
const FIRE = `
  uniform sampler2D uNoise; uniform float uT, uAlpha, uHeat, uGain, uOcc, uBall;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vFade; varying vec2 vDir;
  uniform sampler2D uDepth; uniform float uSoftOn, uNear, uFar, uSoftDist; uniform vec2 uScreen; varying float vViewZ;
  // Soft particles: compare with the depth of the solid scene. Behind a surface the puff is hidden; close in
  // front of it the puff fades, so smoke meets the engine and the floor without a hard line.
  float soft(){
    if (uSoftOn < 0.5) return 1.0;
    float d = texture2D(uDepth, gl_FragCoord.xy / uScreen).x;
    float sceneZ = (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
    return smoothstep(0.0, uSoftDist, sceneZ - vViewZ);
  }
  vec3 blackbody(float t){   // temperature 0..1.3 -> colour, linear HDR
    vec3 c = mix(vec3(0.0), vec3(0.55, 0.035, 0.0), smoothstep(0.0, 0.25, t));
    c = mix(c, vec3(1.0, 0.3, 0.02), smoothstep(0.2, 0.5, t));
    c = mix(c, vec3(1.0, 0.68, 0.18), smoothstep(0.45, 0.8, t));
    c = mix(c, vec3(1.0, 0.93, 0.72), smoothstep(0.78, 1.2, t));
    return c * (0.35 + 0.9 * smoothstep(0.35, 1.2, t));
  }
  void main(){
    vec2 uv = vUv; float yy = uv.y + 0.5;                       // 0 at the trailing end, 1 at the leading tip
    float w = mix(mix(0.46, 0.1, yy * yy), 0.4, uBall);         // a teardrop narrowing towards the tip, or a ball of flame
    vec2 np = vec2(uv.x * 1.1, uv.y * 0.7) * (0.3 + 0.15 * vSeed.x) + vSeed.yz * 7.3;
    float n = texture2D(uNoise, np + vec2(0.0, -uT * 0.45 - vAge * 0.7)).a;          // ridged turbulence, rising through the tongue
    float n2 = texture2D(uNoise, np * 1.9 + vec2(vSeed.w, -uT * 1.1)).g;
    float edge = abs(uv.x + (n2 - 0.5) * 0.14) / w + (n - 0.55) * 0.85 + (n2 - 0.5) * 0.28;
    float ends = mix(smoothstep(0.0, 0.22, yy) * (1.0 - smoothstep(0.5, 1.0, yy + (n - 0.5) * 0.45)), 1.0 - smoothstep(0.04, 0.48, length(uv) + (n - 0.5) * 0.3), uBall);
    float body = (1.0 - smoothstep(0.4, 1.0, edge)) * ends * (1.0 - smoothstep(0.36, 0.5, length(uv)));   // never reaches the quad's edges
    // hottest at the root of each tongue and in its core, cooling to red at the tips and edges
    float heat = body * (0.55 + 0.6 * n) * mix(1.2 - 0.6 * yy, 1.0, uBall) * (1.0 - 0.8 * vAge) * uHeat;
    float a = clamp(body * (1.0 - smoothstep(0.55, 1.0, vAge)) * smoothstep(0.0, 0.06, vAge) * uAlpha * vFade, 0.0, 1.0);
    if (a < 0.003) discard;
    a *= soft(); if (a < 0.003) discard;
    gl_FragColor = vec4(blackbody(heat) * a * uGain, a * uOcc);   // emitted light, with some occlusion of what is behind
  }`;
const GLOW = `
  uniform sampler2D uNoise; uniform vec3 uColA, uColB, uColC; uniform float uAlpha;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vFade; varying vec2 vDir;
  uniform sampler2D uDepth; uniform float uSoftOn, uNear, uFar, uSoftDist; uniform vec2 uScreen; varying float vViewZ;
  // Soft particles: compare with the depth of the solid scene. Behind a surface the puff is hidden; close in
  // front of it the puff fades, so smoke meets the engine and the floor without a hard line.
  float soft(){
    if (uSoftOn < 0.5) return 1.0;
    float d = texture2D(uDepth, gl_FragCoord.xy / uScreen).x;
    float sceneZ = (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
    return smoothstep(0.0, uSoftDist, sceneZ - vViewZ);
  }
  void main(){
    float r = length(vUv) * 2.0; if (r > 1.0) discard;
    float n = texture2D(uNoise, vUv * 0.5 + vSeed.xy * 5.0 + vec2(-vAge * 0.3, 0.0)).r;
    float a = (1.0 - smoothstep(0.0, 1.0, r + (n - 0.5) * 0.6)) * smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.5, 1.0, vAge)) * uAlpha * vFade;
    a *= soft();
    vec3 col = vAge < 0.3 ? mix(uColA, uColB, vAge / 0.3) : mix(uColB, uColC, (vAge - 0.3) / 0.7);
    gl_FragColor = vec4(col * a * (0.6 + 0.8 * n), 0.0);
  }`;

/**
 * A pool of puffs. o: origin, box, dir, speed, radius, ring, spread, buoy, life, size0, size1, turb, drag,
 * swirl, ground, colA/B/C, alpha, lit, soft, mode ('smoke' | 'fire' | 'glow'), stretch, heat, gain, occ.
 * Emitter settings live in `u` (as {value}) so they can be changed while it runs. set(t, k) every frame:
 * k is the emission rate as a share of the pool; emit() adds single puffs (bursts).
 */
export class Billows {
  constructor(scene, n, o = {}) {
    const V3 = (a) => new THREE.Vector3(...a);
    this.n = n; this.mode = o.mode || (o.additive ? 'glow' : 'smoke');
    this.u = {
      uK: { value: 0 }, uLife: { value: o.life ?? 3 }, uSpeed: { value: o.speed ?? 1 }, uSpread: { value: o.spread ?? 0.1 }, uRadius: { value: o.radius ?? 0.2 }, uRing: { value: o.ring ?? 0 },
      uSize0: { value: o.size0 ?? 0.3 }, uSize1: { value: o.size1 ?? 1.5 }, uTurb: { value: o.turb ?? 0.15 }, uDrag: { value: o.drag ?? 0.35 }, uSwirl: { value: o.swirl ?? 0 }, uGround: { value: o.ground ? 1 : 0 },
      uOrigin: { value: V3(o.origin || [0, 0, 0]) }, uDir: { value: V3(o.dir || [1, 0, 0]) }, uBuoy: { value: V3(o.buoy || [0, 0, 0]) }, uBox: { value: V3(o.box || [0, 0, 0]) },
      uColA: { value: V3(o.colA || [1, 1, 1]) }, uColB: { value: V3(o.colB || [1, 1, 1]) }, uColC: { value: V3(o.colC || [1, 1, 1]) },
      uAlpha: { value: o.alpha ?? 0.5 }, uLit: { value: o.lit ?? 0.5 }, uSoft: { value: o.soft ?? 1 }, uDetail: { value: o.detail ?? 0.6 }, uGlow: { value: V3([0, 0, 0]) },
      uHeat: { value: o.heat ?? 1 }, uBall: { value: o.ball ?? 0 }, uGain: { value: o.gain ?? 0.9 }, uOcc: { value: o.occ ?? 0.6 }, uStretch: { value: o.stretch ?? (this.mode === 'fire' ? 0.05 : 0) },
      uT: { value: 0 }, uNoise: FX.uNoise, uLightV: FX.uLightV, uSky: FX.uSky, uSun: FX.uSun,
      uDepth: FX.uDepth, uSoftOn: FX.uSoftOn, uScreen: FX.uScreen, uNear: FX.uNear, uFar: FX.uFar, uSoftDist: { value: o.softDist ?? (this.mode === 'fire' ? 0.12 : 0.35) },
    };
    // particle state
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1);
    this.seed = new Float32Array(n * 4); this.rot = new Float32Array(n * 2); this.sz = new Float32Array(n); this.grow = new Float32Array(n * 2);
    this.next = 0; this.acc = 0; this._t = null; this.alive = 0;
    let s = o.seed || 7; this.rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    // instanced quads
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ia = (k, w) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * w), w); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a; };
    this.aPos = ia('iPos', 3); this.aVel = ia('iVel', 3); this.aSeed = ia('iSeed', 4); this.aMisc = ia('iMisc', 3);
    g.instanceCount = 0;
    const frag = this.mode === 'fire' ? FIRE : this.mode === 'glow' ? GLOW : SMOKE;
    const blending = this.mode === 'smoke' ? THREE.NormalBlending : this.mode === 'glow' ? THREE.AdditiveBlending : THREE.CustomBlending;
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending, side: THREE.DoubleSide });
    if (this.mode === 'fire') { mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendEquation = THREE.AddEquation; }
    // glow writes light already scaled by its own alpha (alpha 0): add it as is. (THREE.AdditiveBlending multiplies by the source alpha, so it added nothing.)
    if (this.mode === 'glow') { mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation; }
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.userData.softFx = true; this.mesh.renderOrder = o.order ?? (this.mode === 'smoke' ? 5 : 6);
    this.order = new Uint16Array(n); this.depth = new Float32Array(n);
    scene.add(this.mesh);
  }
  /** One puff at a point with a velocity; any of size0, size1, life (seconds) may be overridden. */
  emit(x, y, z, vx, vy, vz, o = {}) {
    const i = this.next; this.next = (i + 1) % this.n; const r = this.rnd, U = this.u;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.V[i * 3] = vx; this.V[i * 3 + 1] = vy; this.V[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = (o.life ?? U.uLife.value) * (0.65 + 0.7 * r());
    for (let k = 0; k < 4; k++) this.seed[i * 4 + k] = r();
    this.rot[i * 2] = r() * 6.2832; this.rot[i * 2 + 1] = (r() - 0.5) * 1.2;
    this.sz[i] = 0.7 + 0.6 * r(); this.grow[i * 2] = o.size0 ?? U.uSize0.value; this.grow[i * 2 + 1] = o.size1 ?? U.uSize1.value;
  }
  _spawn() {
    const U = this.u, r = this.rnd, O = U.uOrigin.value, B = U.uBox.value, D = U.uDir.value;
    const ang = r() * 6.2832, w = r(), rad = U.uRadius.value * (U.uRing.value ? 0.72 + 0.28 * w : Math.sqrt(w));
    const ground = U.uGround.value > 0.5, cy = ground ? 0 : Math.cos(ang), cz = Math.sin(ang), cx = ground ? Math.cos(ang) : 0;
    const sp = U.uSpeed.value * (0.6 + 0.8 * r()), spr = U.uSpread.value * (0.4 + r());
    this.emit(O.x + (r() - 0.5) * B.x + cx * rad, O.y + (r() - 0.5) * B.y + cy * rad, O.z + (r() - 0.5) * B.z + cz * rad,
      D.x * sp + cx * spr, D.y * sp + cy * spr, D.z * sp + cz * spr);
  }
  /** Advance by the time since the last call and draw: k (0..1) is the emission rate. */
  set(t, k) {
    k = Math.min(1, Math.max(0, k)); this.u.uK.value = k;
    let dt = this._t == null ? 0 : t - this._t; this._t = t; if (!(dt > 0 && dt < 0.25)) dt = 0;
    this.u.uT.value = t % 1000;
    if (k > 0.005 && dt > 0) { this.acc += (k * this.n * dt) / Math.max(this.u.uLife.value, 0.05); while (this.acc >= 1) { this.acc -= 1; this._spawn(); } }
    this._step(dt, t); this._draw(t);
  }
  _step(dt, t) {
    if (!dt) return;
    const U = this.u, P = this.P, V = this.V, drag = Math.exp(-U.uDrag.value * 1.6 * dt), B = U.uBuoy.value, tb = U.uTurb.value * 2.5 * dt;
    const sw = U.uSwirl.value * dt, O = U.uOrigin.value, ground = U.uGround.value > 0.5, cs = Math.cos(sw), sn = Math.sin(sw);
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] += dt / this.life[i];
      const j = i * 3, ph = this.seed[i * 4] * 40;
      V[j] = V[j] * drag + B.x * dt + tb * Math.sin(t * 1.3 + ph); V[j + 1] = V[j + 1] * drag + B.y * dt + tb * Math.sin(t * 1.7 + ph * 1.7); V[j + 2] = V[j + 2] * drag + B.z * dt + tb * Math.sin(t * 1.1 + ph * 2.3);
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (sw) {   // swirl about the emitter axis
        if (ground) { const x = P[j] - O.x, z = P[j + 2] - O.z; P[j] = O.x + x * cs - z * sn; P[j + 2] = O.z + x * sn + z * cs; }
        else { const y = P[j + 1] - O.y, z = P[j + 2] - O.z; P[j + 1] = O.y + y * cs - z * sn; P[j + 2] = O.z + y * sn + z * cs; }
      }
    }
  }
  _draw(t) {
    let m = 0;
    const cam = FX.camera, e = cam ? cam.matrixWorldInverse.elements : null;
    for (let i = 0; i < this.n; i++) if (this.age[i] < 1) { this.order[m] = i; if (e) this.depth[i] = e[2] * this.P[i * 3] + e[6] * this.P[i * 3 + 1] + e[10] * this.P[i * 3 + 2]; m++; }
    this.alive = m; this.mesh.visible = m > 0; this.mesh.geometry.instanceCount = m;
    if (!m) return;
    if (this.mode === 'smoke' && e) { const ord = Array.from(this.order.subarray(0, m)); ord.sort((a, b) => this.depth[a] - this.depth[b]); this.order.set(ord); }   // far to near
    const ap = this.aPos.array, av = this.aVel.array, as = this.aSeed.array, am = this.aMisc.array;
    for (let k = 0; k < m; k++) {
      const i = this.order[k], a = this.age[i];
      ap.set(this.P.subarray(i * 3, i * 3 + 3), k * 3); av.set(this.V.subarray(i * 3, i * 3 + 3), k * 3); as.set(this.seed.subarray(i * 4, i * 4 + 4), k * 4);
      am[k * 3] = (this.grow[i * 2] + (this.grow[i * 2 + 1] - this.grow[i * 2]) * Math.sqrt(a)) * this.sz[i];
      am[k * 3 + 1] = this.rot[i * 2] + this.rot[i * 2 + 1] * a * this.life[i];
      am[k * 3 + 2] = a;
    }
    for (const at of [this.aPos, this.aVel, this.aSeed, this.aMisc]) { at.needsUpdate = true; at.clearUpdateRanges && at.clearUpdateRanges(); }
  }
  clear() { this.age.fill(1); this.acc = 0; this._draw(0); }
}

/** Records where the solid scene's depth is (the render pass's buffer), for the soft smoke and fire later in the chain. */
export class DepthCapturePass extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) { FX.uDepth.value = readBuffer.depthTexture || null; }
}

/**
 * Smoke and fire (the Billows, on layer 2) drawn into a buffer of their own, hidden and softened against the
 * captured scene depth, then laid over the image (premultiplied) before bloom, so flames still glow.
 */
export class SoftFxPass extends Pass {
  constructor(scene, camera) {
    super(); this.scene = scene; this.camera = camera; this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tFx: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tFx; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tFx, vUv); }',
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this._c = new THREE.Color();
  }
  setSize(w, h) { this.rt.setSize(w, h); FX.uScreen.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, mask = cam.layers.mask, bg = this.scene.background, auto = renderer.autoClear, sm = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this._c); const ca = renderer.getClearAlpha();
    FX.uNear.value = cam.near; FX.uFar.value = cam.far; FX.uSoftOn.value = FX.uDepth.value ? 1 : 0;
    cam.layers.set(2); this.scene.background = null; renderer.shadowMap.autoUpdate = false;   // only the effects; no second shadow pass
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(this.scene, cam);
    this.scene.background = bg; cam.layers.mask = mask; renderer.shadowMap.autoUpdate = sm; renderer.setClearColor(this._c, ca);
    this.quad.material.uniforms.tFx.value = this.rt.texture;
    renderer.autoClear = false; renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this.quad.render(renderer); renderer.autoClear = auto;
  }
  dispose() { this.rt.dispose(); this.quad.dispose(); }
}

/** Short glowing or wet streaks along each particle's velocity: embers, hot fragments, liquid spray. */
export class Streaks {
  constructor(scene, n, { additive = true, len = 0.03 } = {}) {
    this.n = n; this.next = 0; this.live = 0; this.len = len; this.additive = additive;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 4); this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1);
    this.g = new Float32Array(n); this.drag = new Float32Array(n); this.cool = new Uint8Array(n); this.up = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 8);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.lines.frustumCulled = false; this.lines.visible = false; this.lines.renderOrder = 7; scene.add(this.lines);
  }
  /** cool: colour follows a cooling black-body curve instead of (r, g, b); up: buoyancy (embers rise). */
  emit(x, y, z, vx, vy, vz, r, g, b, a, life, { grav = 9.81, drag = 0, cool = false, up = 0 } = {}) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.c.set([r, g, b, a], i * 4);
    this.age[i] = 0; this.life[i] = life; this.g[i] = grav; this.drag[i] = drag; this.cool[i] = cool ? 1 : 0; this.up[i] = up; this.live = 1;
  }
  update(dt, floorY, t = 0) {
    if (!this.live) return;
    let live = 0; const { p, v, c, pos, col } = this;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, k = i * 8;
      if (this.age[i] >= this.life[i]) { col[k + 3] = col[k + 7] = 0; continue; }
      live++; this.age[i] += dt;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      v[j] *= dr; v[j + 1] = v[j + 1] * dr + (this.up[i] - this.g[i]) * dt; v[j + 2] *= dr;
      if (this.up[i]) { v[j] += Math.sin(t * 3 + i) * dt * 0.8; v[j + 2] += Math.cos(t * 2.6 + i * 1.7) * dt * 0.8; }   // embers flutter
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < floorY) { p[j + 1] = floorY; v[j + 1] *= -0.3; v[j] *= 0.55; v[j + 2] *= 0.55; }
      const f = this.age[i] / this.life[i], L = this.len;
      pos[i * 6] = p[j]; pos[i * 6 + 1] = p[j + 1]; pos[i * 6 + 2] = p[j + 2];
      pos[i * 6 + 3] = p[j] - v[j] * L; pos[i * 6 + 4] = p[j + 1] - v[j + 1] * L; pos[i * 6 + 5] = p[j + 2] - v[j + 2] * L;
      let r = c[i * 4], g = c[i * 4 + 1], b = c[i * 4 + 2], a = c[i * 4 + 3] * (1 - f * f);
      if (this.cool[i]) { const T = 1 - f; r = 1.6 * Math.min(1, T * 2.2); g = 1.6 * Math.max(0, Math.min(1, T * 1.8 - 0.35)) * 0.75; b = 1.6 * Math.max(0, T * 1.6 - 1.0) * 0.6; }
      col[k] = r; col[k + 1] = g; col[k + 2] = b; col[k + 3] = a; col[k + 4] = r; col[k + 5] = g; col[k + 6] = b; col[k + 7] = 0;   // the tail fades out
    }
    this.live = live; this.lines.visible = live > 0;
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
  }
  clear() { this.age.fill(1); this.live = 1; }
}

/** Real fragments: small irregular pieces of metal that tumble, bounce, skid and lie on the floor a while. */
export class Shards {
  constructor(scene, n, mat) {
    this.n = n; this.next = 0; this.live = 0;
    const g = new THREE.TetrahedronGeometry(1, 0); g.scale(1, 0.35, 0.7);   // flattened, like torn blade metal
    this.mesh = new THREE.InstancedMesh(g, mat || new THREE.MeshStandardMaterial({ color: 0x8e9296, metalness: 0.85, roughness: 0.42 }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.count = 0; scene.add(this.mesh);
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.q = Array.from({ length: n }, () => new THREE.Quaternion()); this.w = new Float32Array(n * 3);
    this.s = new Float32Array(n); this.age = new Float32Array(n).fill(99); this.life = new Float32Array(n).fill(1);
    this._m = new THREE.Matrix4(); this._e = new THREE.Euler(); this._dq = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._sc = new THREE.Vector3();
  }
  emit(x, y, z, vx, vy, vz, size, life = 8) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.w.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
    this.q[i].setFromEuler(this._e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)); this.s[i] = size; this.age[i] = 0; this.life[i] = life; this.live = 1;
  }
  update(dt, floorY) {
    if (!this.live) return;
    let m = 0; const { p, v, w } = this;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt; const j = i * 3, s = this.s[i];
      v[j + 1] -= 9.81 * dt; const dr = Math.max(0, 1 - 0.15 * dt); v[j] *= dr; v[j + 2] *= dr;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < floorY + s * 0.3) { p[j + 1] = floorY + s * 0.3; v[j + 1] = Math.abs(v[j + 1]) > 1 ? -v[j + 1] * 0.3 : 0; v[j] *= 0.6; v[j + 2] *= 0.6; w[j] *= 0.6; w[j + 1] *= 0.6; w[j + 2] *= 0.6; }
      this._dq.setFromEuler(this._e.set(w[j] * dt, w[j + 1] * dt, w[j + 2] * dt)); this.q[i].multiply(this._dq);
      const fade = Math.min(1, (this.life[i] - this.age[i]) / 1.5);   // shrink away at the end of their life
      this._m.compose(this._v.set(p[j], p[j + 1], p[j + 2]), this.q[i], this._sc.setScalar(s * fade));
      this.mesh.setMatrixAt(m++, this._m);
    }
    this.mesh.count = m; this.live = m; this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.age.fill(99); this.mesh.count = 0; this.live = 0; }
}

/** Glowing fragments: short streaks along their own velocity, falling and cooling. */
export class Sparks {
  constructor(scene, n) {
    this.n = n; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lines.frustumCulled = false; this.lines.visible = false; scene.add(this.lines);
    this.seed = Array.from({ length: n }, (_, i) => Array.from({ length: 7 }, (_, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }));
  }
  /** k: 0..1; origin x of the nozzle exit; floorY where fragments land and skid. */
  set(t, k, x0, floorY) {
    this.lines.visible = k > 0.02; if (!this.lines.visible) return;
    const pos = this.lines.geometry.attributes.position.array, col = this.lines.geometry.attributes.color.array;
    const at = (sd, tt, out, j) => { const th = sd[2] * 6.2831853, r0 = 0.08 + 0.42 * sd[3], v = 7 + 16 * sd[4];
      out[j] = x0 + v * tt * (1 - 0.22 * tt); out[j + 1] = Math.max(floorY + 0.015, r0 * Math.cos(th) * (1 + 0.8 * tt) + (sd[5] - 0.35) * 1.4 * tt - 4.9 * tt * tt); out[j + 2] = r0 * Math.sin(th) * (1 + 1.6 * tt) + (sd[6] - 0.5) * 1.2 * tt; };
    for (let i = 0; i < this.n; i++) {
      const sd = this.seed[i], life = 0.5 + sd[0] * 1.3, f = ((t + sd[1] * 3) % life) / life, tt = f * life, j = i * 6;
      at(sd, tt, pos, j); at(sd, Math.max(0, tt - 0.022 - 0.03 * sd[4]), pos, j + 3);
      const on = sd[6] < k ? 1 : 0, b = on * (1 - f) * (1 - f) * 3.2;
      col[j] = b; col[j + 1] = b * (0.85 - 0.55 * f); col[j + 2] = b * (0.5 - 0.5 * f) * (1 - f);
      col[j + 3] = col[j + 4] = col[j + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
  }
}

/**
 * Free particles for one-off bursts and steady leaks: each has a position, velocity, drag, gravity and a
 * life, and fades out with age. Colours carry alpha, so dark fluids (oil) show against a bright background.
 */
export class Particles {
  constructor(scene, n, { size = 0.03, map = null, additive = false, opacity = 1 } = {}) {
    this.n = n; this.next = 0; this.live = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 4);
    this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1); this.g = new Float32Array(n); this.drag = new Float32Array(n); this.grow = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 6; scene.add(this.points);
  }
  /** One particle: position, velocity (m/s), colour and alpha, life (s), gravity (m/s2), drag (1/s). */
  emit(x, y, z, vx, vy, vz, r, g, b, a, life, grav = 9.81, drag = 0) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.c.set([r, g, b, a], i * 4);
    this.age[i] = 0; this.life[i] = life; this.g[i] = grav; this.drag[i] = drag; this.live = Math.max(this.live, 1);
  }
  update(dt, floorY) {
    if (!this.live) return;
    let live = 0;
    const { p, v, c, pos, col } = this;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, k = i * 4;
      if (this.age[i] >= this.life[i]) { col[k + 3] = 0; continue; }
      live++; this.age[i] += dt;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      v[j] *= dr; v[j + 1] = v[j + 1] * dr - this.g[i] * dt; v[j + 2] *= dr;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < floorY) { p[j + 1] = floorY; v[j + 1] *= -0.25; v[j] *= 0.5; v[j + 2] *= 0.5; }   // land, splash, skid
      const f = this.age[i] / this.life[i];
      pos[j] = p[j]; pos[j + 1] = p[j + 1]; pos[j + 2] = p[j + 2];
      col[k] = c[k]; col[k + 1] = c[k + 1]; col[k + 2] = c[k + 2]; col[k + 3] = c[k + 3] * (1 - f * f);
    }
    this.live = live; this.points.visible = live > 0;
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
  clear() { this.age.fill(1); this.live = 1; }
}
