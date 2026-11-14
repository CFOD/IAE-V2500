import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, tIsentropic, isa } from '../src/sim/gas.js';
import { Engine } from '../src/sim/engine.js';
import { Fadec, ratedThrustN } from '../src/sim/fadec.js';
import { DESIGN } from '../src/sim/v2500.js';

function rig() { const e = new Engine(); const f = new Fadec(e); return { e, f }; }
function run(e, f, T, each) { const dt = 1 / 60; for (let t = 0; t < T; t += dt) { f.update(dt); e.step(dt); if (each) each(e.out, t); } }
const surges = (e) => e.events.filter((x) => x.type.startsWith('surge')).length;
function idling() { const r = rig(); r.f.master = true; run(r.e, r.f, 100); return r; }

test('gas properties match reference values', () => {
  assert.ok(Math.abs(cp(288.15) - 1003.5) < 2);
  assert.ok(Math.abs(cp(1000) - 1141) < 3);
  assert.ok(Math.abs(tIsentropic(288.15, 2) - 351) < 1.5);
  assert.ok(Math.abs(isa(11000).P - 22632) < 30);
});

test('design point is a steady state of the dynamic model', () => {
  const e = new Engine(); e.initDesign();
  for (let i = 0; i < 600; i++) e.step(0.05);
  const o = e.out;
  assert.ok(Math.abs(o.thrust - DESIGN.thrustN) / DESIGN.thrustN < 0.01, `thrust ${o.thrust}`);
  assert.ok(Math.abs(o.N1 - DESIGN.N1d) / DESIGN.N1d < 0.005);
  assert.ok(Math.abs(o.N2 - DESIGN.N2d) / DESIGN.N2d < 0.005);
  assert.ok(Math.abs(o.bpr - 4.5) < 0.05 && Math.abs(o.opr - 33.4) < 0.3);
  // mass is conserved through the core
  assert.ok(Math.abs(o.W8 - (o.Wlpc + o.wf - o.Wb25 - o.Wb7 - o.Wb10 - o.Wcust)) < 0.05);
});

test('automatic start reaches a realistic ground idle without exceedances', () => {
  const { e, f } = rig(); f.master = true;
  let peakEgt = 0, tIdle = null;
  run(e, f, 120, (o, t) => { peakEgt = Math.max(peakEgt, o.egt - 273.15); if (tIdle == null && f.phase === 'run') tIdle = t; });
  const o = e.out;
  assert.equal(f.phase, 'run');
  assert.ok(tIdle > 25 && tIdle < 90, `time to idle ${tIdle}`);
  assert.ok(peakEgt < 635, `start EGT ${peakEgt}`);
  assert.ok(o.N2pct > 55 && o.N2pct < 62, `N2 ${o.N2pct}`);
  assert.ok(o.N1pct > 18 && o.N1pct < 30, `N1 ${o.N1pct}`);
  assert.ok(o.wf * 3600 > 280 && o.wf * 3600 < 450, `FF ${o.wf * 3600}`);
  assert.equal(surges(e), 0);
});

test('V2527-A5 take-off matches published cycle figures', () => {
  const { e, f } = idling();
  f.tla = 1;
  let t95 = null;
  const rated = ratedThrustN('V2527-A5');
  run(e, f, 40, (o, t) => { if (t95 == null && o.thrust > 0.95 * rated) t95 = t; });
  const o = e.out;
  assert.ok(Math.abs(o.thrust - rated) / rated < 0.03, `thrust ${o.thrust} vs ${rated}`);
  assert.ok(o.bpr > 4.6 && o.bpr < 5.1, `BPR ${o.bpr}`); // published 4.8
  assert.ok(o.opr > 25.5 && o.opr < 29, `OPR ${o.opr}`); // published 27.2
  assert.ok(o.W2 > 335 && o.W2 < 375, `airflow ${o.W2}`); // published ~355-368 kg/s
  assert.ok(o.egt - 273.15 < 610);
  assert.ok(t95 < 8, `accel time ${t95}`);
  assert.equal(surges(e), 0);
  f.tla = 0; run(e, f, 30);
  assert.ok(e.out.lit && surges(e) === 0 && e.out.N2pct < 62);
});

test('every rating delivers its rated thrust at sea level static', () => {
  for (const r of ['V2522-A5', 'V2524-A5', 'V2530-A5', 'V2533-A5']) {
    const { e, f } = idling(); f.rating = r; f.tla = 1; run(e, f, 40);
    const rated = ratedThrustN(r);
    assert.ok(Math.abs(e.out.thrust - rated) / rated < 0.03, `${r}: ${e.out.thrust} vs ${rated}`);
    assert.ok(e.out.N1pct < 100 && e.out.N2pct < 100 && e.out.egt - 273.15 < 650, r);
  }
});

test('over-fuelling by hand surges the HP compressor; FADEC schedule does not', () => {
  const { e, f } = idling();
  f.ovr.fuel = 1.3; run(e, f, 4);
  assert.ok(e.events.some((x) => x.type === 'surge-hpc'), 'expected HPC surge');
});

test('starving the combustor flames it out', () => {
  const { e, f } = idling();
  f.ovr.fuel = 0.008; f.ovr.ignition = false; run(e, f, 5);
  assert.equal(e.out.lit, false);
  assert.ok(e.events.some((x) => x.type === 'flameout-lean'));
});

test('altitude cruise: thrust lapses with density and the engine stays lit', () => {
  const { e, f } = idling();
  f.tla = 0.8; run(e, f, 20);
  const sls = e.out.thrust;
  Object.assign(e.u, { alt: 10668, mach: 0.78 }); run(e, f, 60);
  const o = e.out;
  assert.ok(o.lit, 'lit');
  assert.ok(o.thrust > 12e3 && o.thrust < 0.4 * sls, `cruise thrust ${o.thrust} vs ${sls}`);
  assert.ok(o.sfc > 0.5 && o.sfc < 0.75, `cruise TSFC ${o.sfc}`); // published ~0.54-0.58
  assert.ok(o.N1pct < 100.5 && o.N2pct < 100.5);
});

test('hot day: EGT rises for the same thrust setting', () => {
  const a = idling(); a.f.tla = 1; run(a.e, a.f, 40);
  const b = idling(); b.e.u.dTisa = 15; b.f.tla = 1; run(b.e, b.f, 40);
  assert.ok(b.e.out.egt > a.e.out.egt + 20);
});
