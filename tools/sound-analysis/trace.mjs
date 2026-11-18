import { Engine } from '../../src/sim/engine.js'; import { Fadec } from '../../src/sim/fadec.js'; import fs from 'fs';
const e = new Engine(), f = new Fadec(e); const fps = 50, rows = []; let t = 0;
const ctl = (tt) => { if (tt >= 2 && tt < 58) { f.mode = 'ign'; f.master = true; } if (tt >= 58) f.mode = 'norm'; if (tt >= 60 && tt < 85) f.setLever(45); if (tt >= 85) f.setLever(0); if (tt >= 100) f.master = false; };
for (let k = 0; k < 150 * fps; k++) { const at = k / fps; while (t < at) { ctl(t); f.update(1 / 100); e.step(1 / 100); t += 1 / 100; } const o = e.out; rows.push([at, Math.abs(o.N1pct), o.N2pct, +o.lit, +(o.tStart > 0), o.wf * 3600]); }
fs.writeFileSync(process.argv[2] || 'trace.json', JSON.stringify(rows)); console.log('rows', rows.length);
