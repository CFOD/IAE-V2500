import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../app/vendor/three.module.js';
import { deformBlade, ngvBurnAt, STREAK_TH } from '../app/damage3d.js';

// a flat test blade in the engine frame at angle 0: chord along x (leading edge at x = -0.1), span along y
// (radial) from 0.3 to 0.7, the direction of rotation +z
const blade = () => { const g = new THREE.PlaneGeometry(0.2, 0.4, 20, 40); g.translate(0, 0.5, 0); return g; };
function corner(g, x, y) {   // the vertex nearest (x, y)
  const p = g.attributes.position; let best = 0, bd = Infinity;
  for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i) - x, p.getY(i) - y); if (d < bd) { bd = d; best = i; } }
  return best;
}
const xyz = (g, i) => [g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)];

test('bend: the tip curls back against the rotation; the root does not move', () => {
  const g = blade(), tip = corner(g, -0.1, 0.7), root = corner(g, 0, 0.3), d = deformBlade(g, [{ type: 'bend', sev: 1, span: 0.8 }]);
  assert.ok(xyz(d, tip)[2] < -0.05, `tip z ${xyz(d, tip)[2]}`);
  assert.deepEqual(xyz(d, root), xyz(g, root));
});

test('nick: a notch in the leading edge at its span; the trailing edge is untouched', () => {
  const g = blade(), le = corner(g, -0.1, 0.5), te = corner(g, 0.1, 0.5), d = deformBlade(g, [{ type: 'nick', sev: 1, span: 0.5 }]);
  assert.ok(xyz(d, le)[0] > -0.1 + 0.01, `leading edge x ${xyz(d, le)[0]}`);
  assert.ok(Math.abs(xyz(d, te)[0] - 0.1) < 1e-6);
  const away = corner(g, -0.1, 0.35); assert.ok(Math.abs(xyz(d, away)[0] + 0.1) < 1e-4, 'only near its span');
});

test('tear: the leading-edge corner of the tip is cut away, the trailing-edge corner stays', () => {
  const g = blade(), a = corner(g, -0.1, 0.7), b = corner(g, 0.1, 0.7), d = deformBlade(g, [{ type: 'tear', sev: 1, span: 0.9 }]);
  assert.ok(xyz(d, a)[1] < 0.7 - 0.05, `corner r ${xyz(d, a)[1]}`);
  assert.ok(Math.abs(xyz(d, b)[1] - 0.7) < 1e-6);
});

test('burn: the trailing edge goes back mid-span, not at the root or tip; vanes burn by the streak', () => {
  const g = blade(), mid = corner(g, 0.1, 0.5), root = corner(g, 0.1, 0.3), d = deformBlade(g, [{ type: 'burn', sev: 1, span: 0.5 }]);
  assert.ok(xyz(d, mid)[0] < 0.1 - 0.02, `trailing edge x ${xyz(d, mid)[0]}`);
  assert.ok(Math.abs(xyz(d, root)[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(ngvBurnAt(STREAK_TH, 0.8) - 0.8) < 1e-9 && ngvBurnAt(STREAK_TH + Math.PI, 0.8) < 1e-6);
});
