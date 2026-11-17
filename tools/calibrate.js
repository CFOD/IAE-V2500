// Prints steady-state lines used to calibrate the FADEC tables (see also tools/dp.js)
// and to compare the model against published data. Run: node tools/calibrate.js
import { Engine } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
const e = new Engine(), f = new Fadec(e);
const run = (T) => { for (let t = 0; t < T; t += 1 / 60) { f.update(1 / 60); e.step(1 / 60); } };
const row = (tag) => { const o = e.out; console.log(`${tag.padEnd(22)} Fn=${(o.thrust / 1000).toFixed(1).padStart(6)}kN EPR=${o.epr.toFixed(3)} N1=${o.N1pct.toFixed(1)} N2=${o.N2pct.toFixed(1)} EGT=${(o.egt - 273.15).toFixed(0)}C FF=${(o.wf * 3600).toFixed(0)}kg/h TSFC=${o.sfc.toFixed(3)} W2=${o.W2.toFixed(0)} BPR=${o.bpr.toFixed(2)} OPR=${o.opr.toFixed(1)} T4=${o.T4.toFixed(0)}K Wf/P3=${(o.wf / (o.P3 / 1e5)).toFixed(4)} surges=${e.events.filter((x) => x.type.startsWith('surge')).length}`); };
f.mode = 'ign'; f.master = true; run(100); row('ground idle');
f.rating = "V2533-A5";
for (const tla of [0.3, 0.7, 0.85, 1]) { f.tla = tla; run(30); row(`SLS TLA ${tla}`); }
f.rating = 'V2527-A5'; f.tla = 1; run(30); row('V2527 TO');
Object.assign(e.u, { alt: 10668, mach: 0.78 }); f.tla = 0.85; run(60); row('FL350 M0.78 TLA .85');
f.tla = 1; run(30); row('FL350 M0.78 TOGA');
Object.assign(e.u, { alt: 0, mach: 0, dTisa: 30 }); run(60); row('SLS ISA+30 TOGA');
