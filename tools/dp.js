// Open-loop steady-state sweep: prints the tables embedded in fadec.js
import { Engine } from '../src/sim/engine.js';
const e = new Engine(); e.initDesign();
const dp = e.cfg.dp; const T = [], RU = [];
for (const f of [1.06, 1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.42, 0.35, 0.28, 0.224, 0.18, 0.15, 0.12, 0.09, 0.08, 0.07]) {
  e.u.wfCmd = dp.wf * f; e.u.bleed25 = f < 0.3 ? 1 : 0; e.u.bleed7 = f < 0.1 ? 3 : f < 0.16 ? 2 : f < 0.2 ? 1 : 0;
  for (let i = 0; i < 900; i++) e.step(0.05);
  const o = e.out;
  T.unshift([+(o.thrust / 1000).toFixed(1), +o.epr.toFixed(3)]); RU.unshift([+o.N2pct.toFixed(1), +(o.wf / (o.P3 / 1e5)).toFixed(4)]);
  console.log(`wf=${o.wf.toFixed(3)} Fn=${(o.thrust/1000).toFixed(1)} EPR=${o.epr.toFixed(3)} N1=${o.N1pct.toFixed(1)} N2=${o.N2pct.toFixed(1)} EGT=${(o.T5-273.15).toFixed(0)} BPR=${o.bpr.toFixed(2)} OPR=${o.opr.toFixed(1)} W2=${o.W2.toFixed(0)} xF=${o.fan.x.toFixed(2)}/${o.fan.xs.toFixed(2)} xL=${o.lpc.x.toFixed(2)}/${o.lpc.xs.toFixed(2)} xH=${o.hpc.x.toFixed(2)}/${o.hpc.xs.toFixed(2)} surges=${e.events.length}`);
}
console.log('EPR_VS_THRUST', JSON.stringify(T)); console.log('RU', JSON.stringify(RU));
