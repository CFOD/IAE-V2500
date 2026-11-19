// Damage you can see: deformed copies of the blades and vanes that something has hit or burnt, standing in for
// their instances in the rows, and heat discolouration of the turbine blades. The records come from the
// simulation (src/sim/failures.js Failures.dmg for ingestion, src/sim/damage.js for burning and overheating).
import * as THREE from './vendor/three.module.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A damaged copy of a blade or vane template. The template is in the engine frame at angle 0: radial is +y,
 * the direction of rotation +z, the axis +x. recs: [{ span 0-1, type, sev 0-1 }]
 *   dent   the leading edge pushed back against the rotation (a soft or semi-rigid object)
 *   nick   a small notch in the leading edge (a bolt or a stone)
 *   bend   the tip curled back against the rotation (a big bird, a cone)
 *   tear   the tip corner at the leading edge torn away
 *   burn   the trailing edge burnt back, raggedly, over the middle of the span (a hot streak)
 */
export function deformBlade(src, recs) {
  const g = src.clone(), p = g.attributes.position, n = p.count, R = new Float32Array(n);
  let r0 = Infinity, r1 = -Infinity;
  for (let i = 0; i < n; i++) { const r = Math.hypot(p.getY(i), p.getZ(i)); R[i] = r; if (r < r0) r0 = r; if (r > r1) r1 = r; }
  // leading and trailing edge of each slice of the span
  const NB = 40, le = new Array(NB).fill(null), te = new Array(NB).fill(null), span = r1 - r0 || 1e-3;
  const bin = (u) => Math.min(NB - 1, Math.max(0, Math.floor(u * NB)));
  for (let i = 0; i < n; i++) {
    const b = bin((R[i] - r0) / span), x = p.getX(i), s = p.getZ(i);
    if (!le[b] || x < le[b][0]) le[b] = [x, s];
    if (!te[b] || x > te[b][0]) te[b] = [x, s];
  }
  for (let b = 0; b < NB; b++) if (!le[b]) { let k = 1; while (!le[b]) { le[b] = le[b - k] || le[b + k]; te[b] = te[b - k] || te[b + k]; k++; if (k > NB) { le[b] = [0, 0]; te[b] = [0.01, 0]; } } }
  for (let i = 0; i < n; i++) {
    const u = (R[i] - r0) / span, b = bin(u), [xl, sl] = le[b], [xt, st] = te[b];
    const cx = xt - xl, cs = st - sl, L = Math.hypot(cx, cs) || 1e-3, ux = cx / L, us = cs / L;
    const x = p.getX(i), z = p.getZ(i), t = ((x - xl) * ux + (z - sl) * us) / L;   // 0 at the leading edge, 1 at the trailing edge
    let dx = 0, dz = 0, rs = 1;
    for (const rc of recs) {
      const sv = rc.sev;
      if (rc.type === 'dent') {
        const w = Math.exp(-(((u - rc.span) / 0.08) ** 2)) * Math.exp(-((Math.max(0, t) / 0.22) ** 2)), d = (0.025 + 0.075 * sv) * L * w;
        dx += 0.35 * d; dz -= d;
      } else if (rc.type === 'nick') {
        const w = Math.exp(-(((u - rc.span) / 0.03) ** 2)) * Math.exp(-((Math.max(0, t) / 0.07) ** 2)), d = (0.03 + 0.05 * sv) * L * w;
        dx += ux * d; dz += us * d;
      } else if (rc.type === 'bend') {
        const u0 = Math.min(0.85, Math.max(0.35, rc.span - 0.2)), k = smooth(u0, 1, u) ** 1.6, d = sv * 0.45 * L * k * (1 - 0.45 * Math.min(1, Math.max(0, t)));
        dz -= d; dx += 0.25 * d;
      } else if (rc.type === 'tear') {
        const a = 0.08 + 0.14 * sv, bb = 0.18 + 0.35 * sv;
        if (t < bb) { const uc = 1 - a + a * Math.max(0, t) / bb; if (u > uc) rs = Math.min(rs, (r0 + uc * span) / R[i]); }
      } else if (rc.type === 'burn') {
        const e = (0.1 + 0.38 * sv) * (0.7 + 0.3 * Math.sin(u * 47 + (rc.seed || 0))) * smooth(0.1, 0.25, u) * (1 - smooth(0.82, 0.96, u));
        if (t > 1 - e) { const back = (t - (1 - e)) * L; dx -= ux * back; dz -= us * back; }
      }
    }
    p.setXYZ(i, x + dx, p.getY(i) * rs, (z + dz) * rs);
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// The streaking nozzle is No. 13 (9 + 12 x 18 = 225 deg). The swirl in the combustor carries its hot streak about
// 13 deg round before it reaches the guide vanes, so it lands in front of the stage 1 borescope port at 210 deg.
export const STREAK_TH = 212 * Math.PI / 180;
/** How badly the stage 1 guide vane at angle th is burnt, 0-1, for the engine's burn figure (damage.js ngvBurn). */
export function ngvBurnAt(th, burn) {
  const d = Math.abs(((th - STREAK_TH) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return burn * Math.exp(-((d / 0.2) ** 2));
}

/**
 * Build the damage on the model from the failure state fs. rows(id) gives a part's rotor rows; hide(im, idx)
 * hides the instances the copies stand in for. Returns the copies, for the per-frame cutaway check.
 */
export function applyDamage(view, fs, rows, hide) {
  for (const d of view._dmgMeshes || []) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); d.mesh.geometry.dispose(); }
  const out = (view._dmgMeshes = []);
  const add = (im, i, list, rotor) => {
    const mesh = new THREE.Mesh(deformBlade(im.geometry, list), im.material);
    mesh.matrixAutoUpdate = false; im.userData.place(mesh.matrix, im.userData.ths[i]);
    mesh.castShadow = im.castShadow; mesh.receiveShadow = true; mesh.userData.part = im.userData.part; mesh.name = `damaged:${im.name}:${i}`;
    im.parent.add(mesh); out.push({ mesh, im, i, rotor, list });
  };
  // blades hit by something that went through the intake
  for (const id of ['fan', 'lpc', 'hpc']) {
    const recs = (fs && fs.dmg && fs.dmg[id]) || []; if (!recs.length) continue;
    const r = rows(id)[0]; if (!r) continue;
    const im = r.im, cnt = im.userData.ths.length, by = new Map(), gone = new Set(((fs.missing && fs.missing[id]) || []).map((f) => Math.floor(f * cnt) % cnt));
    for (const rc of recs) { const i = Math.floor(rc.f * cnt) % cnt; if (gone.has(i)) continue; if (!by.has(i)) by.set(i, []); by.get(i).push(rc); }
    for (const [i, list] of by) add(im, i, list, true);
    hide(im, [...by.keys()]);
  }
  // HP turbine stage 1 guide vanes behind the streaking nozzle: discoloured, then burnt back
  const ngv = (view.byId.hptcase ? view.byId.hptcase.objs : []).find((o) => o.isInstancedMesh && o.name === 'ring_hptcase_ngv1');
  const burn = fs ? fs.ngvBurn || 0 : 0;
  if (ngv) {
    const c = new THREE.Color(), ths = ngv.userData.ths, burnt = [];
    for (let i = 0; i < ths.length; i++) {
      const b = ngvBurnAt(ths[i], burn);
      c.setRGB(1 - 0.5 * b, 1 - 0.6 * b, 1 - 0.68 * b); ngv.setColorAt(i, c);
      if (b > 0.3) burnt.push([i, b]);
    }
    if (ngv.instanceColor) ngv.instanceColor.needsUpdate = true;
    for (const [i, b] of burnt) add(ngv, i, [{ type: 'burn', sev: Math.min(1, (b - 0.3) / 0.6), span: 0.5, seed: i * 1.7 }], false);
    hide(ngv, burnt.map(([i]) => i));
  }
  // turbine blades: straw, bronze and blue as they have been overheated; the streak heats every HP blade a little
  const hot = (id, row, k) => {
    const rr = rows(id)[row]; if (!rr) return;
    const im = rr.im, c = new THREE.Color();
    for (let i = 0; i < im.userData.ths.length; i++) {
      const v = Math.min(1, k * (0.75 + 0.25 * Math.sin(i * 12.9898) ** 2));
      c.setRGB(1 - 0.45 * v, 1 - 0.55 * v, 1 - 0.5 * v + 0.15 * v * v); im.setColorAt(i, c);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };
  const kH = fs ? Math.min(1, Math.max(0, ((fs.hotH || 0) - 1250) / 260) + 0.5 * burn) : 0, kL = fs ? Math.min(1, Math.max(0, ((fs.hotL || 0) - 1180) / 260)) : 0;
  hot('hpt', 0, kH); hot('hpt', 1, kH * 0.7); hot('lpt', 0, kL);
  view._heat = { kH, kL, burn };   // for the borescope readout
  return out;
}

/** Damage records for the borescope readout: what is wrong with the blade (or vane) in view. */
export function describe(list) {
  const words = { dent: 'leading edge dented', nick: 'nick in the leading edge', bend: 'tip curled back', tear: 'tip corner torn off', burn: 'trailing edge burnt away' };
  return list.map((r) => `${words[r.type] || r.type} (${r.sev > 0.66 ? 'severe' : r.sev > 0.33 ? 'moderate' : 'light'})`).join(', ');
}
