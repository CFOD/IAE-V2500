// Surface finishes: wear, grime, heat discolouration and fine relief for every material.
//
// The engine is built procedurally and much of its geometry has no UVs, so detail is projected
// triplanar from each object's own coordinates (engine frame: x along the axis, y up). It stays
// attached to rotating spools and opening cowls, and needs no unwrapping.
//
// One packed RGBA texture carries four tileable detail layers:
//   R fine grain and pitting (sand-cast and sprayed finishes)
//   G mid/large blotches (oil, dirt, uneven chromate and paint)
//   B fine scratches and brushing marks
//   A drip and flow streaks
//
// Every shader line keeps to defined GLSL behaviour on real GPUs: no pow of a negative base,
// smoothstep edges always ascending, no normalize of a possibly-zero vector.
import * as THREE from './vendor/three.module.js';

// ------------------------------------------------------------------ tileable detail texture
function periodicNoise(size, period, seed) {
  // value noise on a lattice that wraps at `period`, so the image tiles seamlessly
  const h = (i, j) => { let n = ((i % period + period) % period) * 374761393 + ((j % period + period) % period) * 668265263 + seed * 1442695041; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const out = new Float32Array(size * size), cell = size / period;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    out[y * size + x] = (a + (b - a) * su) + ((c + (d - c) * su) - (a + (b - a) * su)) * sv;
  }
  return out;
}
function fbm(size, periods, seed) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0;
  periods.forEach((p, k) => { const n = periodicNoise(size, p, seed + k * 31); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= 0.55; });
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

export function makeSurfaceTexture(size = 512) {
  let s = 1886; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const grain = fbm(size, [32, 64, 128, 256], 3);
  const blotch = fbm(size, [3, 6, 12, 24, 48], 11);
  const data = new Uint8Array(size * size * 4);
  // scratches and streaks drawn on canvases, wrapped so they tile
  const cv = (draw) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, size, size); draw(g); return g.getImageData(0, 0, size, size).data; };
  const scratch = cv((g) => {
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size, y = rnd() * size, a = (rnd() < 0.7 ? 0.08 : 1) * (rnd() - 0.5) * Math.PI, L = 6 + rnd() * rnd() * 120;
      g.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.35})`; g.lineWidth = rnd() < 0.85 ? 0.6 : 1.4;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L); g.stroke(); }
    }
  });
  const streak = cv((g) => {
    for (let i = 0; i < 260; i++) {
      const x = rnd() * size, y0 = rnd() * size, L = 20 + rnd() * 240, w = 1 + rnd() * 5;
      const gr = g.createLinearGradient(0, y0, 0, y0 + L); gr.addColorStop(0, `rgba(255,255,255,${0.15 + rnd() * 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; for (const ox of [-size, 0, size]) for (const oy of [-size, 0]) g.fillRect(x + ox, y0 + oy + (oy ? size : 0), w, L);
    }
  });
  for (let i = 0; i < size * size; i++) {
    let gr = grain[i];
    if (rnd() < 0.004) gr *= 0.35; // pits
    const bl = Math.min(1, Math.max(0, (blotch[i] - 0.3) * 2.2));
    data[i * 4] = Math.round(Math.min(1, Math.max(0, gr)) * 255);
    data[i * 4 + 1] = Math.round(bl * 255);
    data[i * 4 + 2] = scratch[i * 4];
    data[i * 4 + 3] = streak[i * 4];
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ finishes
// Each preset is a physically motivated look; colours come from the reference photos.
export const FINISH = {
  nacellePaint: { scale: 2.2, grain: 0.03, grime: 0.16, grimeCol: [0.44, 0.41, 0.36], bottom: 0.45, streak: 0.22, rough: 0.12, bump: 0.12 },
  primer: { scale: 2.5, grain: 0.06, mottle: 0.1, grime: 0.32, grimeCol: [0.15, 0.14, 0.09], bottom: 0.7, streak: 0.35, rough: 0.16, bump: 0.2 },
  acoustic: { scale: 3, grain: 0.05, grime: 0.28, grimeCol: [0.06, 0.06, 0.05], bottom: 0.4, rough: 0.12, bump: 0.25 },
  castPaint: { scale: 4.5, grain: 0.06, mottle: 0.05, grime: 0.18, grimeCol: [0.13, 0.11, 0.08], bottom: 0.7, streak: 0.12, rough: 0.16, bump: 0.5 },
  castBare: { scale: 5, grain: 0.11, mottle: 0.1, grime: 0.34, grimeCol: [0.12, 0.1, 0.07], bottom: 0.6, streak: 0.3, rough: 0.2, bump: 0.8, metalLoss: 0.25 },
  bareSteel: { scale: 6, grain: 0.04, scratch: 0.35, grime: 0.16, grimeCol: [0.1, 0.09, 0.08], bottom: 0.3, streak: 0.08, rough: 0.22, bump: 0.18 },
  titanium: { scale: 6, grain: 0.05, scratch: 0.25, mottle: 0.05, grime: 0.12, grimeCol: [0.12, 0.11, 0.1], bottom: 0.0, rough: 0.2, bump: 0.15, tintVar: [0.94, 0.96, 1.06] },
  chromate: { scale: 5, grain: 0.05, grime: 0.2, grimeCol: [0.16, 0.12, 0.06], bottom: 0.45, streak: 0.12, rough: 0.16, bump: 0.25, tintVar: [0.86, 0.8, 0.42], tintAmt: 0.9 },
  cadmium: { scale: 8, grain: 0.05, grime: 0.18, grimeCol: [0.15, 0.12, 0.07], bottom: 0.3, rough: 0.15, bump: 0.12, tintVar: [0.85, 1.0, 0.72], tintAmt: 0.6 },
  stainlessTube: { scale: 10, grain: 0.03, scratch: 0.3, grime: 0.16, grimeCol: [0.12, 0.1, 0.08], bottom: 0.3, streak: 0.12, rough: 0.2, bump: 0.08 },
  darkBox: { scale: 6, grain: 0.06, grime: 0.18, grimeCol: [0.2, 0.19, 0.17], bottom: 0.3, rough: 0.14, bump: 0.3 },
  rubber: { scale: 9, grain: 0.08, grime: 0.2, grimeCol: [0.12, 0.08, 0.06], bottom: 0.3, rough: 0.1, bump: 0.35 },
  braid: { scale: 10, grain: 0.03, grime: 0.3, grimeCol: [0.32, 0.29, 0.24], bottom: 0.5, rough: 0.05, bump: 0.0 },
  connector: { scale: 10, grain: 0.05, grime: 0.15, grimeCol: [0.1, 0.1, 0.08], rough: 0.12, bump: 0.15, tintVar: [0.9, 1.0, 0.8], tintAmt: 0.4 },
  hotCase: { scale: 4, grain: 0.08, mottle: 0.12, scratch: 0.1, grime: 0.22, grimeCol: [0.1, 0.08, 0.06], bottom: 0.25, streak: 0.25, rough: 0.2, bump: 0.45, metalLoss: 0.2 },
  turbineBlade: { scale: 12, grain: 0.06, mottle: 0.1, grime: 0.08, grimeCol: [0.18, 0.12, 0.08], rough: 0.15, bump: 0.2 },
  compressorBlade: { scale: 12, grain: 0.03, scratch: 0.2, grime: 0.06, grimeCol: [0.2, 0.19, 0.17], rough: 0.12, bump: 0.08 },
  nozzle: { scale: 3, grain: 0.05, scratch: 0.15, grime: 0.15, grimeCol: [0.08, 0.07, 0.06], bottom: 0.2, streak: 0.3, rough: 0.18, bump: 0.15, metalLoss: 0.15 },
  composite: { scale: 6, grain: 0.05, grime: 0.2, grimeCol: [0.05, 0.05, 0.05], bottom: 0.3, rough: 0.12, bump: 0.2 },
  polished: { scale: 4, grain: 0.015, scratch: 0.25, grime: 0.06, grimeCol: [0.3, 0.29, 0.27], rough: 0.1, bump: 0.05 },
  fireSleeve: { scale: 12, grain: 0.1, grime: 0.3, grimeCol: [0.2, 0.1, 0.05], bottom: 0.3, rough: 0.08, bump: 0.5 },
};

let SURF_TEX = null;
export const setSurfaceTexture = (t) => { SURF_TEX = t; };

/**
 * Apply a finish to a MeshStandard/Physical material. cfg extends a FINISH preset with optional
 *   heat: [x0, x1, k]  heat discolouration from straw through bronze and purple to blue along the axis
 *   soot: [x0, x1, k]  exhaust soot building up towards x1
 * Calling again merges the new options in.
 */
export function finish(mat, cfg) {
  if (!mat || !mat.isMeshStandardMaterial) return mat;
  const c = (mat.userData.finish = { ...(mat.userData.finish || {}), ...cfg });
  const v3 = (a, d) => new THREE.Vector3(...(a || d));
  mat.onBeforeCompile = (sh) => {
    const U = {
      uSurf: { value: SURF_TEX }, uSurfScale: { value: c.scale || 5 },
      uSurfA: { value: new THREE.Vector4(c.grain || 0, c.mottle || 0, c.scratch || 0, c.streak || 0) },
      uSurfB: { value: new THREE.Vector4(c.grime || 0, c.bottom || 0, c.rough || 0, c.bump || 0) },
      uSurfMetalLoss: { value: c.metalLoss || 0 },
      uGrimeCol: { value: v3(c.grimeCol, [0.12, 0.1, 0.08]) },
      uTintVar: { value: v3(c.tintVar, [1, 1, 1]) }, uTintAmt: { value: c.tintAmt ?? (c.tintVar ? 0.5 : 0) },
      uHeat: { value: new THREE.Vector3(...(c.heat || [0, 1, 0])) }, uSoot: { value: new THREE.Vector3(...(c.soot || [0, 1, 0])) },
    };
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfP; varying vec3 vSurfN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vSurfP = (instanceMatrix * vec4(transformed, 1.0)).xyz; vSurfN = mat3(instanceMatrix) * objectNormal;
        #else
          vSurfP = transformed; vSurfN = objectNormal;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSurfP; varying vec3 vSurfN;
        uniform sampler2D uSurf; uniform float uSurfScale; uniform vec4 uSurfA; uniform vec4 uSurfB; uniform float uSurfMetalLoss;
        uniform vec3 uGrimeCol; uniform vec3 uTintVar; uniform float uTintAmt; uniform vec3 uHeat; uniform vec3 uSoot;
        vec4 surfTri(vec3 p, vec3 w, float s) {
          return texture2D(uSurf, p.yz * s) * w.x + texture2D(uSurf, p.zx * s) * w.y + texture2D(uSurf, p.xy * s) * w.z;
        }
        vec3 surfPerturb(vec3 sp, vec3 sn, vec2 dH, float fd) {
          vec3 dx = dFdx(sp), dy = dFdy(sp);
          vec3 sx = dx / max(length(dx), 1e-7), sy = dy / max(length(dy), 1e-7);
          vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
          float det = dot(sx, r1) * fd;
          vec3 g = (det < 0.0 ? -1.0 : 1.0) * (dH.x * r1 + dH.y * r2);
          vec3 n = abs(det) * sn - g; float l = length(n);
          return l > 1e-6 ? n / l : sn;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sN = vSurfN; float sNl = length(sN); sN = sNl > 1e-6 ? sN / sNl : vec3(0.0, 1.0, 0.0);
        vec3 sW = abs(sN); sW = sW * sW; sW = sW * sW; sW /= max(sW.x + sW.y + sW.z, 1e-5);
        vec4 sFine = surfTri(vSurfP, sW, uSurfScale);
        vec4 sBig = surfTri(vSurfP, sW, uSurfScale * 0.13);
        float surfH = (sFine.r - 0.5) * uSurfA.x * 4.0 + sFine.b * uSurfA.z * 0.6;
        // grain, paint/chromate mottling, scratches
        diffuseColor.rgb *= 1.0 + (sFine.r - 0.5) * uSurfA.x * 2.0 + (sBig.g - 0.5) * uSurfA.y * 2.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTintVar, clamp(sBig.g * uTintAmt, 0.0, 1.0));
        diffuseColor.rgb += sFine.b * uSurfA.z * 0.12;
        // grime: blotches, more of it underneath (engine frame y down) and in drip streaks
        float down = clamp(-sN.y, 0.0, 1.0) * 0.6 + (1.0 - smoothstep(-0.9, 0.1, vSurfP.y)) * 0.4;
        float sGrime = clamp(uSurfB.x * (sBig.g * 1.3 + sFine.g * 0.4) + uSurfB.y * down * (0.35 + sBig.g) + uSurfA.w * sFine.a * (0.4 + down), 0.0, 0.92);
        diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeCol, sGrime);
        // heat discolouration along the axis
        float sHeat = 0.0;
        if (uHeat.z > 0.0) {
          float span = uHeat.y - uHeat.x; span = abs(span) < 1e-3 ? 1e-3 : span;
          sHeat = clamp((vSurfP.x - uHeat.x) / span + (sBig.g - 0.5) * 0.35 + (sFine.r - 0.5) * 0.1, 0.0, 1.0);
          vec3 straw = vec3(0.86, 0.72, 0.44), bronze = vec3(0.62, 0.42, 0.28), purple = vec3(0.46, 0.34, 0.56), blue = vec3(0.36, 0.48, 0.68);
          vec3 tint = mix(vec3(1.0), straw, smoothstep(0.05, 0.3, sHeat)); tint = mix(tint, bronze, smoothstep(0.3, 0.55, sHeat));
          tint = mix(tint, purple, smoothstep(0.55, 0.78, sHeat)); tint = mix(tint, blue, smoothstep(0.78, 1.0, sHeat));
          diffuseColor.rgb *= mix(vec3(1.0), tint, clamp(uHeat.z, 0.0, 1.0));
        }
        // exhaust soot towards the rear
        float sSoot = 0.0;
        if (uSoot.z > 0.0) {
          float span2 = uSoot.y - uSoot.x; span2 = abs(span2) < 1e-3 ? 1e-3 : span2;
          sSoot = clamp(((vSurfP.x - uSoot.x) / span2) * (0.6 + 0.8 * sBig.g) + sFine.a * 0.3 - 0.15, 0.0, 1.0) * clamp(uSoot.z, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), sSoot * 0.85);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (sFine.r - 0.5) * uSurfB.z + sGrime * 0.35 - sFine.b * uSurfA.z * 0.1 + sSoot * 0.4 + sHeat * uHeat.z * 0.08, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = clamp(metalnessFactor * (1.0 - sGrime * 0.7 - sSoot * 0.8 - uSurfMetalLoss * sBig.g), 0.0, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uSurfB.w > 0.0) { vec2 dHs = vec2(dFdx(surfH), dFdy(surfH)) * uSurfB.w * 0.02; normal = surfPerturb(-vViewPosition, normal, dHs, faceDirection); }`);
  };
  const key = JSON.stringify(c);
  mat.customProgramCacheKey = () => 'surf:' + key;
  mat.needsUpdate = true;
  return mat;
}
