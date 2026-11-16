// Compares the model against the ICAO databank points and the published ground idle.
// Usage: node tools/icao.js   (used when re-tuning maps; the same checks are in tests/sim.test.js)
import { Engine } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
import { ICAO_V2527, ICAO } from '../src/sim/v2500.js';
const e = new Engine(), f = new Fadec(e); f.master = true;
const run = (T) => { const dt = 1 / 60; for (let t = 0; t < T; t += dt) { f.update(dt); e.step(dt); } };
run(100);
const o0 = e.out;
console.log(`idle  N1 ${o0.N1pct.toFixed(1)} (21.7)  N2 ${o0.N2pct.toFixed(1)} (58.5-60)  FF ${(o0.wf * 3600).toFixed(0)} kg/h (300-460)  EGT ${(o0.egt - 273.15).toFixed(0)}`);
let wf = e.out.wf;
const hold = (target, n = 60) => { for (let k = 0; k < n; k++) { wf *= 1 + 0.5 * (target - e.out.thrust) / Math.max(target, e.out.thrust); f.ovr.fuel = wf; run(3); } return e.out; };
const pc = (a, b) => `${a.toFixed(3)} vs ${b} (${(((a - b) / b) * 100).toFixed(1)} %)`;
for (const [k, fr] of [['approach', 0.3], ['climb', 0.85], ['takeoff', 1], ['idle', 0.07]]) {
  const o = hold(fr * ICAO_V2527.ratedN);
  console.log(`V2527 ${k.padEnd(8)} wf ${pc(o.wf, ICAO_V2527[k])}  N1 ${o.N1pct.toFixed(1)} N2 ${o.N2pct.toFixed(1)} EGT ${(o.egt - 273.15).toFixed(0)} OPR ${o.opr.toFixed(1)} BPR ${o.bpr.toFixed(2)} b25 ${e.u.bleed25.toFixed(2)}`);
}
for (const [name, ref] of Object.entries(ICAO)) {
  const o = hold(ref.ratedN, 50);
  console.log(`${name} TO wf ${pc(o.wf, ref.takeoff)}  OPR ${pc(o.opr, ref.opr)}  BPR ${pc(o.bpr, ref.bpr)}  EGT ${(o.egt - 273.15).toFixed(0)}`);
}
console.log('surges', e.events.filter((x) => x.type.startsWith('surge')).length);
