import { Engine } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
export const row = (o, f) => `t=${o.t.toFixed(1)} ${f ? f.phase.padEnd(7) + (f.limiter||'').padEnd(11) : ''} wf=${(o.wf*3600).toFixed(0)} N1=${o.N1pct.toFixed(1)} N2=${o.N2pct.toFixed(1)} Fn=${(o.thrust/1000).toFixed(1)} EPR=${o.epr.toFixed(3)} EGT=${(o.egt-273.15).toFixed(0)}C T4=${o.T4.toFixed(0)} W2=${o.W2.toFixed(0)} Wc=${o.Wcore.toFixed(1)} P3=${(o.P3/1e5).toFixed(2)} ru=${(o.wf/(o.P3/1e5)).toFixed(3)} xL=${o.lpc.x.toFixed(2)} xH=${o.hpc.x.toFixed(2)}/${o.hpc.xs.toFixed(2)} b=${o.b25.toFixed(1)}/${f?f.eng.u.bleed7:''} lit=${+o.lit} st=${+o.fan.stalled}${+o.lpc.stalled}${+o.hpc.stalled}`;
export function make() { const e = new Engine(); const f = new Fadec(e); return { e, f }; }
export function run(e, f, T, every = 0, dt = 1 / 60) {
  let next = every;
  for (let t = 0; t < T; t += dt) {
    f.update(dt); e.step(dt);
    if (every && t >= next) { console.log(row(e.out, f)); next += every; }
  }
}
if (process.argv[1].endsWith('run.js')) {
  const { e, f } = make();
  f.master = true;
  console.log('--- autostart'); run(e, f, 80, 4); 
  console.log('--- idle settle'); run(e, f, 40, 20);
  console.log('--- slam to TOGA'); f.tla = 1; run(e, f, 10, 1); run(e, f, 30, 15);
  console.log('--- chop to idle'); f.tla = 0; run(e, f, 10, 1); run(e, f, 20, 10);
  console.log(e.events);
}
