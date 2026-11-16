// Volumetric-looking effects: smoke, fire, torching and mist.
//
// Each effect is a few hundred camera-facing quads, moved entirely in the vertex shader from a
// per-quad random seed (no per-frame CPU work). A quad is not a soft disc: its alpha is a fractal
// noise field that is eroded as the puff ages, so puffs billow, tear into wisps and dissolve, and
// overlapping puffs read as one turbulent body. Colour follows a three-stop ramp over the puff's life.
//
// GPU-safe GLSL: no pow() of a negative base, smoothstep edges always ordered, no normalize(0).
import * as THREE from './vendor/three.module.js';

const VERT = `
  attribute vec4 aSeed;
  uniform float uT, uLife, uSpeed, uSpread, uRadius, uRing, uSize0, uSize1, uTurb, uK, uDrag, uSwirl, uGround;
  uniform vec3 uOrigin, uDir, uBuoy, uBox;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vOn;
  void main(){
    float life = uLife * (0.65 + 0.7 * aSeed.x);
    float age = fract(uT / life + aSeed.y);
    float t = age * life;
    float ang = aSeed.z * 6.2831853 + uSwirl * t;
    float rad = uRadius * mix(sqrt(aSeed.w), 0.72 + 0.28 * aSeed.w, uRing);
    vec3 radial = mix(vec3(0.0, cos(ang), sin(ang)), vec3(cos(ang), 0.0, sin(ang)), uGround); // emitter disc across the engine axis, or lying on the ground
    vec3 p = uOrigin + vec3((aSeed.x - 0.5) * uBox.x, (aSeed.y - 0.5) * uBox.y, (aSeed.w - 0.5) * uBox.z) + radial * rad;
    float tt = t * (1.0 - uDrag * age);                       // puffs slow down as they entrain air
    p += (uDir * uSpeed * (0.6 + 0.8 * aSeed.w) + radial * uSpread * (0.4 + aSeed.x)) * tt;
    p += uBuoy * t * t * 0.5;
    float ph = aSeed.x * 40.0;
    p += uTurb * age * vec3(sin(t * 1.3 + ph), sin(t * 1.7 + ph * 1.7), sin(t * 1.1 + ph * 2.3));
    float size = mix(uSize0, uSize1, sqrt(age)) * (0.7 + 0.6 * aSeed.z);
    float rot = aSeed.y * 6.2831853 + (aSeed.x - 0.5) * 1.6 * t;
    vec2 q = position.xy; float c = cos(rot), s = sin(rot);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * size;
    vOn = step(fract(aSeed.z * 7.31 + aSeed.w * 3.17), uK);   // intensity = share of puffs that exist
    gl_Position = projectionMatrix * mv;
    vUv = position.xy; vAge = age; vSeed = aSeed;
  }`;
const FRAG = `
  uniform vec3 uColA, uColB, uColC; uniform float uAlpha, uLit, uSoft, uAdd, uT;
  varying vec2 vUv; varying float vAge; varying vec4 vSeed; varying float vOn;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y); }
  float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.07+vec2(17.1,9.3); a*=0.5; } return s; }
  void main(){
    if (vOn < 0.5) discard;
    float r = length(vUv) * 2.0;
    if (r > 1.0) discard;
    float body = 1.0 - smoothstep(0.15, 1.0, r);
    vec2 np = vUv * (2.2 + 1.5 * vSeed.x) + vSeed.xy * 31.0;
    float n = fbm(np + vec2(0.0, -vAge * 1.2));
    float n2 = fbm(np * 2.3 + 7.0 + vec2(vAge * 0.8, 0.0));
    float d = body * (0.55 + 0.9 * n);                         // lumpy density
    float cut = 0.12 + 0.62 * vAge * uSoft;                    // the threshold rises with age: the puff is eaten away
    float a = smoothstep(cut, cut + 0.3, d) * smoothstep(0.0, 0.07, vAge) * (1.0 - smoothstep(0.62, 1.0, vAge));
    vec3 col = vAge < 0.3 ? mix(uColA, uColB, vAge / 0.3) : mix(uColB, uColC, (vAge - 0.3) / 0.7);
    col *= 0.7 + 0.6 * n2;                                     // internal structure
    col *= 1.0 + uLit * (vUv.y * 1.1 + 0.15 * (n - 0.5));      // lit from above, shadowed underneath
    a *= uAlpha;
    gl_FragColor = uAdd > 0.5 ? vec4(max(col, 0.0) * a * (0.6 + 0.8 * d), 1.0) : vec4(max(col, 0.0), a);
  }`;

export class Puffs {
  /** o: every uniform below can be given; `additive` for flames. */
  constructor(scene, n, o = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(n * 4); let s = o.seed || 7; for (let i = 0; i < seed.length; i++) { s = (s * 16807) % 2147483647; seed[i] = s / 2147483647; }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = n;
    const V3 = (a) => new THREE.Vector3(...a), u = {
      uT: { value: 0 }, uK: { value: 0 }, uLife: { value: o.life ?? 3 }, uSpeed: { value: o.speed ?? 1 }, uSpread: { value: o.spread ?? 0.1 }, uRadius: { value: o.radius ?? 0.2 }, uRing: { value: o.ring ?? 0 },
      uSize0: { value: o.size0 ?? 0.3 }, uSize1: { value: o.size1 ?? 1.5 }, uTurb: { value: o.turb ?? 0.15 }, uDrag: { value: o.drag ?? 0.35 }, uSwirl: { value: o.swirl ?? 0 }, uGround: { value: o.ground ? 1 : 0 },
      uOrigin: { value: V3(o.origin || [0, 0, 0]) }, uDir: { value: V3(o.dir || [1, 0, 0]) }, uBuoy: { value: V3(o.buoy || [0, 0, 0]) }, uBox: { value: V3(o.box || [0, 0, 0]) },
      uColA: { value: V3(o.colA || [1, 1, 1]) }, uColB: { value: V3(o.colB || [1, 1, 1]) }, uColC: { value: V3(o.colC || [1, 1, 1]) },
      uAlpha: { value: o.alpha ?? 0.5 }, uLit: { value: o.lit ?? 0 }, uSoft: { value: o.soft ?? 1 }, uAdd: { value: o.additive ? 1 : 0 },
    };
    this.u = u;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = o.order ?? 5;
    scene.add(this.mesh);
  }
  /** k: 0..1 intensity. */
  set(t, k) { this.u.uT.value = t % 4000; this.u.uK.value = Math.min(1, Math.max(0, k)); this.mesh.visible = k > 0.01; }
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
