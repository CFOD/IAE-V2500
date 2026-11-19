import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
import { Apron, APRON } from '../src/sim/ground.js';

const run = (e, f, T) => { for (let t = 0; t < T; t += 1 / 60) { f.update(1 / 60); e.step(1 / 60); } };
function at(lever) { const e = new Engine(), f = new Fadec(e); f.mode = 'ign'; f.master = true; run(e, f, 100); f.mode = 'norm'; if (lever) { f.setLever(lever); run(e, f, 40); } e.events.length = 0; return { e, f }; }
const IDLE = at(0), TO = at(45);
const apron = (r) => { const a = new Apron(); a.setFlow(r.e.out); return a; };
// step the objects with the engine held where it is
const fly = (a, r, T) => { for (let t = 0; t < T; t += 1 / 60) { a.setFlow(r.e.out); a.step(1 / 60, r.e); } };

test('intake: danger radius against Airbus AC 6-3 (2.74 m at idle; take-off more cautious than 5.18 m)', () => {
  const ri = apron(IDLE).dangerRadius(), rt = apron(TO).dangerRadius();
  assert.ok(Math.abs(ri - 2.74) < 0.3, `idle ${ri.toFixed(2)} m`);
  assert.ok(rt > 5.18 && rt < 8, `take-off ${rt.toFixed(2)} m`);
});

test('intake: no air passes through the ground', () => {
  const a = apron(TO); a.vtx.k = 0;
  for (const [x, z] of [[-3, 0], [-1.5, 1], [0, 2.5], [-6, -2]]) { const u = a.air(x, APRON.groundY, z); assert.ok(Math.abs(u[1]) < 1e-6 * Math.max(1, Math.hypot(u[0], u[2])) + 1e-9, `${x},${z}: ${u[1]}`); }
});

test('exhaust: take-off jet against the Airbus velocity contours (60 m/s to ~40 m, 30 m/s to ~78 m)', () => {
  const a = apron(TO), r60 = a.jetReach(60), r30 = a.jetReach(30);
  assert.ok(r60 > 30 && r60 < 50, `60 m/s to ${r60.toFixed(0)} m`);
  assert.ok(r30 > 65 && r30 < 95, `30 m/s to ${r30.toFixed(0)} m`);
  const ai = apron(IDLE), i15 = ai.jetReach(15);
  assert.ok(i15 > 20 && i15 < 50, `idle 15 m/s to ${i15.toFixed(0)} m`);
});

test('a rag in front of the intake at take-off is drawn in; at idle 4 m away it stays put', () => {
  const r = at(45), a = apron(r); const rag = a.add('rag', APRON.inletX - 2, 0.3);
  fly(a, r, 6); assert.equal(rag.state, 'ingested');
  assert.ok(r.e.events.some((x) => x.type === 'fod-ingested'));
  const ri = at(0), b = apron(ri); const rag2 = b.add('rag', APRON.inletX - 4, 0.5);
  fly(b, ri, 4); assert.ok(rag2.state !== 'ingested' && Math.hypot(rag2.x - (APRON.inletX - 4), rag2.z - 0.5) < 0.5, `${rag2.state} ${rag2.x}`);
});

test('birds: one a metre from the lip at take-off is caught, one crossing 6 m out at idle flies on', () => {
  const r = at(45), a = apron(r); const g = a.add('pigeon', APRON.inletX - 1.0, 0.8, { h: 1.87, heading: -Math.PI / 2 });
  fly(a, r, 4); assert.equal(g.state, 'ingested');
  const ri = at(0), b = apron(ri); const p = b.add('pigeon', APRON.inletX - 6, 4, { h: 1.87, heading: -Math.PI / 2 });
  fly(b, ri, 3); assert.notEqual(p.state, 'ingested');
});

test('jet blast: a cone 10 m behind the nozzle is knocked over and blown away at take-off', () => {
  const r = at(45), a = apron(r); const c = a.add('cone', APRON.nozzleX + 10, 0.5);
  fly(a, r, 3); assert.ok(!c.upright, 'toppled'); assert.ok(c.x > APRON.nozzleX + 18, `x ${c.x.toFixed(1)}`);
});

test('ingestion damage follows the energy: a pigeon at idle does nothing, a goose at take-off hurts', () => {
  const ri = at(0); const res = ri.e.fail.ingest('pigeon', { name: 'Pigeon', m: 0.35, size: 0.3, hit: 'soft', fly: 12 }, 0.6, { U: 0.212 * 592 * 0.6, Vax: 40, w2: 900, rand: () => 0.99 });
  assert.ok(res.fan < 0.01 && !res.blades, `fan ${res.fan}`);
  const r = at(45); const v0 = r.e.out.vib1;
  const g = r.e.fail.ingest('goose', { name: 'Canada goose', m: 3.6, size: 0.75, hit: 'soft', fly: 15 }, 0.6, { U: 0.837 * 592 * 0.6, Vax: 170, w2: 1400, rand: () => 0.99 });
  run(r.e, r.f, 3);
  assert.ok(g.fan > 0.3, `fan ${g.fan}`); assert.ok(r.e.out.vib1 > v0 + 2, `vib ${v0} -> ${r.e.out.vib1}`);
  assert.ok(r.e.events.some((x) => x.type === 'bird-strike'));
});
