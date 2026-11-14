// Game shell: owns the simulation loop and wires UI <-> sim.
import { Engine, defaultMods } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
import { RATINGS, LIMITS } from '../src/sim/v2500.js';
import { Cutaway } from './cutaway.js';
import { drawEcam, drawMaps, drawTrends, pushTrend } from './gauges.js';
import { EngineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const eng = new Engine();
const fadec = new Fadec(eng);
const view = new Cutaway($('cutaway'));
const audio = new EngineAudio();
const peaks = { egt: 0, n1: 0, n2: 0 };
const log = [];
let paused = false, speed = 1, activeTab = 'ctl', evIdx = 0, overTemp = 0;
window.sim = { eng, fadec }; // handy from the dev console (F12)

const stamp = () => { const t = eng.s.t; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
function logMsg(m) { log.unshift(`[${stamp()}] ${m}`); if (log.length > 200) log.pop(); }

// ------------------------------------------------------------ control rows
const rows = [];
/** A slider row. If `ovrKey` is given the row has an AUTO/MAN button and follows the FADEC in AUTO. */
function addRow(parent, d) {
  const el = document.createElement('div'); el.className = 'ctl';
  el.innerHTML = `<span class="name" title="${d.tip || ''}">${d.name}</span>${d.ovr ? '<button>AUTO</button>' : '<span></span>'}<input type="range" min="${d.min}" max="${d.max}" step="${d.step}"><span class="val"></span>`;
  parent.appendChild(el);
  const [, btn, inp, val] = el.children;
  const row = { d, el, inp, val, man: !d.ovr };
  inp.value = d.get();
  inp.addEventListener('input', () => { if (row.man) d.set(+inp.value); });
  if (d.ovr) {
    inp.disabled = true;
    btn.addEventListener('click', () => {
      row.man = !row.man; btn.textContent = row.man ? 'MAN' : 'AUTO'; btn.classList.toggle('on', row.man); btn.classList.toggle('warn', true);
      el.classList.toggle('man', row.man); inp.disabled = !row.man;
      if (row.man) d.set(+inp.value); else d.set(null);
      logMsg(`${d.name}: ${row.man ? 'MANUAL' : 'FADEC AUTO'}`);
    });
  }
  rows.push(row);
  return row;
}
function refreshRows() {
  for (const r of rows) {
    if (!r.man) r.inp.value = r.d.get();
    r.val.textContent = r.d.fmt(+r.inp.value);
  }
}
function resetRows(tabEl) { for (const r of rows) if (tabEl.contains(r.el) && r.man && !r.d.ovr) { r.inp.value = r.d.def; r.d.set(r.d.def); } }

const ov = fadec.ovr, u = eng.u, m = eng.mods;
const onoff = (v) => (v >= 0.5 ? 'ON' : 'OFF');
const ctl = $('t-ctl'); ctl.innerHTML = '<div class="grid"></div>'; const g1 = ctl.firstChild;
[
  { name: 'Fuel flow', tip: 'Metered fuel flow. Needs ENG MASTER on (fuel shut-off valve).', ovr: 1, min: 0, max: 8000, step: 10, get: () => fadec.auto.fuel * 3600 || 0, set: (v) => (ov.fuel = v == null ? null : v / 3600), fmt: (v) => `${v.toFixed(0)} kg/h` },
  { name: 'Igniters', ovr: 1, min: 0, max: 1, step: 1, get: () => +!!fadec.auto.ignition, set: (v) => (ov.ignition = v == null ? null : v >= 0.5), fmt: onoff },
  { name: 'Starter air valve', ovr: 1, min: 0, max: 1, step: 1, get: () => +!!fadec.auto.starter, set: (v) => (ov.starter = v == null ? null : v >= 0.5), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  { name: 'Starter air press.', tip: 'APU / ground cart duct pressure', min: 0, max: 60, step: 1, def: 40, get: () => u.starterPsi, set: (v) => (u.starterPsi = v), fmt: (v) => `${v.toFixed(0)} psi` },
  { name: 'Variable stators', tip: 'HPC inlet guide vanes + 3 stator rows. Degrees closed.', ovr: 1, min: -10, max: 50, step: 0.5, get: () => eng.out.vsvSched, set: (v) => (ov.vsv = v), fmt: (v) => `${v.toFixed(1)}° shut` },
  { name: 'LPC 2.5 bleed', tip: 'Booster bleed ring, dumps into bypass duct', ovr: 1, min: 0, max: 1, step: 0.01, get: () => fadec.auto.bleed25, set: (v) => (ov.bleed25 = v), fmt: (v) => `${(v * 100).toFixed(0)} % open` },
  { name: 'HPC stg 7 bleeds', tip: 'Three handling bleed valves', ovr: 1, min: 0, max: 3, step: 1, get: () => fadec.auto.bleed7, set: (v) => (ov.bleed7 = v), fmt: (v) => `${v} / 3 open` },
  { name: 'HPC stg 10 bleed', tip: 'Start / handling bleed valve', ovr: 1, min: 0, max: 1, step: 1, get: () => fadec.auto.bleed10, set: (v) => (ov.bleed10 = v), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  { name: 'Customer bleed', tip: 'Air taken for cabin / anti-ice, % of core flow', min: 0, max: 10, step: 0.1, def: 0, get: () => u.custBleed * 100, set: (v) => (u.custBleed = v / 100), fmt: (v) => `${v.toFixed(1)} % core` },
  { name: 'Power off-take', tip: 'Generator + hydraulic pump load on the HP spool', min: 0, max: 300, step: 5, def: 60, get: () => u.offtakeW / 1000, set: (v) => (u.offtakeW = v * 1000), fmt: (v) => `${v.toFixed(0)} kW` },
].forEach((d) => addRow(g1, d));
g1.insertAdjacentHTML('beforeend', '<div class="note">AUTO = FADEC has authority and the slider shows what it is commanding. Switch a channel to MAN to take it away from the computer – that is how you find out why the schedules exist.</div>');

const amb = $('t-amb'); amb.innerHTML = '<div class="presets"></div><div class="grid"></div>';
const ambRows = [
  { name: 'Altitude', min: 0, max: 12500, step: 50, def: 0, get: () => u.alt, set: (v) => (u.alt = v), fmt: (v) => `${(v * 3.28084).toFixed(0)} ft` },
  { name: 'ISA deviation', min: -40, max: 40, step: 1, def: 0, get: () => u.dTisa, set: (v) => (u.dTisa = v), fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}K OAT ${(eng.out.amb.T0 - 273.15).toFixed(0)}°C` },
  { name: 'Mach number', min: 0, max: 0.85, step: 0.01, def: 0, get: () => u.mach, set: (v) => (u.mach = v), fmt: (v) => `M ${v.toFixed(2)}` },
].map((d) => { const r = addRow(amb.lastChild, d); r.inp.addEventListener('input', () => (ambGoal = null)); return r; });
let ambGoal = null; // presets slew over a few seconds so the engine is not teleported
function slewAmbient(dt) {
  if (!ambGoal) return;
  let done = true;
  ambRows.forEach((r, i) => { const cur = r.d.get(), span = r.d.max - r.d.min, d = ambGoal[i] - cur, stepMax = span * dt * 0.12; const nv = Math.abs(d) <= stepMax ? ambGoal[i] : cur + Math.sign(d) * stepMax; if (nv !== ambGoal[i]) done = false; r.d.set(nv); r.inp.value = nv; });
  if (done) ambGoal = null;
}
const presets = { 'SEA LEVEL STATIC': [0, 0, 0], 'HOT DAY ISA+30': [0, 30, 0], 'HOT & HIGH 8000 ft': [2438, 25, 0], 'CLIMB FL200 M0.60': [6096, 0, 0.6], 'CRUISE FL350 M0.78': [10668, 0, 0.78] };
for (const [name, v] of Object.entries(presets)) {
  const b = document.createElement('button'); b.textContent = name;
  b.onclick = () => { ambGoal = v; logMsg(`Ambient: ${name}`); };
  amb.firstChild.appendChild(b);
}
amb.lastChild.insertAdjacentHTML('beforeend', '<div class="note">This is an altitude test cell, not a flight model: presets slew over a few seconds, sliders act instantly (yank them and the engine may surge). Thrust falls with air density; ram pressure raises inlet pressure and adds inlet momentum drag.</div>');

const hw = $('t-hw'); hw.innerHTML = '<div class="presets"><button id="hwReset">RESTORE NEW-ENGINE CONDITION</button></div><div class="grid"></div>';
const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %`;
const effRow = (name, key) => ({ name, tip: 'Isentropic efficiency change (wear, fouling, damage)', min: -15, max: 3, step: 0.1, def: 0, get: () => m[key] * 100, set: (v) => (m[key] = v / 100), fmt: (v) => `${pct(v)} pts` });
const mulRow = (name, key, lo, hi, tip) => ({ name, tip, min: lo, max: hi, step: 0.5, def: 0, get: () => (m[key] - 1) * 100, set: (v) => (m[key] = 1 + v / 100), fmt: pct });
[
  effRow('Fan efficiency', 'effFan'), effRow('LPC efficiency', 'effLpc'), effRow('HPC efficiency', 'effHpc'), effRow('HPT efficiency', 'effHpt'), effRow('LPT efficiency', 'effLpt'),
  mulRow('HPC flow capacity', 'flowHpc', -20, 10, 'Compressor fouling reduces flow'), mulRow('HPT nozzle area', 'flowHpt', -15, 15, 'Turbine flow capacity. Smaller = HPC pushed towards surge'), mulRow('LPT nozzle area', 'flowLpt', -15, 15),
  mulRow('Core nozzle area', 'a8', -30, 30, 'Exhaust nozzle area trim'), mulRow('Bypass nozzle area', 'a18', -30, 30, 'Smaller = fan pushed towards surge'),
  mulRow('Turbine cooling air', 'cooling', -100, 50, 'Cooling air taken from the HPC'),
  { name: 'Fuel heating value', tip: 'Lower heating value. Jet A ≈ 43.1 MJ/kg', min: 25, max: 50, step: 0.1, def: 43.1, get: () => m.lhv / 1e6, set: (v) => (m.lhv = v * 1e6), fmt: (v) => `${v.toFixed(1)} MJ/kg` },
].forEach((d) => addRow(hw.lastChild, d));
$('hwReset').onclick = () => { resetRows(hw); Object.assign(m, defaultMods()); logMsg('Hardware restored to new condition'); };

// ------------------------------------------------------------ cockpit
const sel = $('rating');
for (const k of Object.keys(RATINGS)) sel.add(new Option(`${k} ${(RATINGS[k].thrustLbf / 1000).toFixed(1)}k lbf`, k));
sel.value = fadec.rating; sel.onchange = () => { fadec.rating = sel.value; logMsg(`Rating ${sel.value}`); };
const setMaster = (v) => { fadec.master = v; if (v && fadec.phase === 'abort') fadec.phase = 'off'; $('master').textContent = v ? 'ON' : 'OFF'; $('master').classList.toggle('on', v); logMsg(`ENG MASTER ${v ? 'ON' : 'OFF'}`); };
$('master').onclick = () => setMaster(!fadec.master);
$('manStart').onclick = () => { fadec.manStart = !fadec.manStart; $('manStart').textContent = fadec.manStart ? 'ON' : 'OFF'; $('manStart').classList.toggle('on', fadec.manStart); };
const tla = $('tla');
const setTla = (v) => { fadec.tla = Math.min(1, Math.max(0, v)); tla.value = fadec.tla; $('tlaOut').textContent = `${(fadec.tla * 100).toFixed(0)} %`; };
tla.oninput = () => setTla(+tla.value);

// ------------------------------------------------------------ header
$('btnPause').onclick = () => { paused = !paused; $('btnPause').classList.toggle('on', paused); $('btnPause').textContent = paused ? '▶ RESUME' : '❚❚ PAUSE'; };
for (const b of $('speed').children) b.onclick = () => { speed = +b.dataset.v; for (const c of $('speed').children) c.classList.toggle('on', c === b); };
$('btnSound').onclick = () => { if (audio.on) audio.stop(); else audio.start(); $('btnSound').classList.toggle('on', audio.on); $('btnSound').textContent = audio.on ? '🔊 SOUND ON' : '🔇 SOUND OFF'; };
$('btnLabels').onclick = () => { view.showLabels = !view.showLabels; $('btnLabels').classList.toggle('on', view.showLabels); };
function reset(running) {
  eng.initCold(); eng.events.length = 0; evIdx = 0; fadec._evIdx = 0; fadec.phase = 'off'; fadec.wf = 0; eng.s.fuelUsed = 0;
  peaks.egt = peaks.n1 = peaks.n2 = 0; setTla(0); setMaster(running);
  if (running) { for (let i = 0; i < 100 * 60; i++) { fadec.update(1 / 60); eng.step(1 / 60); } eng.s.t = 0; eng.s.fuelUsed = 0; eng.events.length = 0; fadec._evIdx = 0; }
  log.length = 0; logMsg(running ? 'Reset: engine running at ground idle' : 'Reset: cold and dark');
}
$('btnCold').onclick = () => reset(false);
$('btnIdle').onclick = () => reset(true);
for (const b of $('tabs').children) b.onclick = () => { activeTab = b.dataset.t; for (const c of $('tabs').children) c.classList.toggle('on', c === b); for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.id === 't-' + activeTab); };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowUp') { setTla(fadec.tla + 0.05); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { setTla(fadec.tla - 0.05); e.preventDefault(); }
  else if (e.key === 'm' || e.key === 'M') setMaster(!fadec.master);
  else if (e.key === ' ') { $('btnPause').click(); e.preventDefault(); }
});
window.addEventListener('resize', () => view.resize());

// ------------------------------------------------------------ events & wear
const EV = { lightoff: 'Light-off', 'flameout-lean': 'FLAME-OUT (mixture too lean)', 'flameout-rich': 'FLAME-OUT (rich / no airflow)', 'surge-fan': 'FAN SURGE', 'surge-lpc': 'LPC SURGE', 'surge-hpc': 'HPC SURGE' };
let lastBang = -1, lastSurgeLog = -10;
function handleEvents(dt) {
  for (; evIdx < eng.events.length; evIdx++) {
    const ev = eng.events[evIdx];
    if (ev.type.startsWith('surge')) {
      if (ev.t - lastBang > 0.08) { view.surge(ev.type.slice(6)); audio.bang(ev.type === 'surge-fan' ? 1.3 : 1); lastBang = ev.t; }
      if (ev.t - lastSurgeLog > 1) { logMsg(EV[ev.type]); lastSurgeLog = ev.t; }
    } else logMsg(EV[ev.type] || ev.type);
  }
  if (eng.events.length > 2000) { eng.events.length = 0; evIdx = 0; fadec._evIdx = 0; }
  const o = eng.out, egt = o.egt - 273.15;
  peaks.egt = Math.max(peaks.egt, egt); peaks.n1 = Math.max(peaks.n1, o.N1pct); peaks.n2 = Math.max(peaks.n2, o.N2pct);
  // over-temperature burns turbine life: HPT efficiency is permanently lost
  if (egt > LIMITS.EGT_TAKEOFF) {
    if (overTemp === 0) logMsg('EGT OVER LIMIT – turbine damage accumulating');
    overTemp += dt;
    m.effHpt -= 0.00004 * (egt - LIMITS.EGT_TAKEOFF) * dt;
    m.effHpt = Math.max(m.effHpt, -0.15);
  } else overTemp = 0;
}

// ------------------------------------------------------------ data tab
function dataText(o) {
  const C = (T) => `${(T - 273.15).toFixed(0).padStart(5)} °C`, B = (p) => `${(p / 1e5).toFixed(3).padStart(7)} bar`, K = (w) => `${w.toFixed(1).padStart(6)} kg/s`;
  const MW = (p) => `${(p / 1e6).toFixed(2).padStart(6)} MW`;
  return [
    `STATION            Tt          Pt         W        │ CYCLE`,
    `0  ambient      ${C(o.amb.T0)}  ${B(o.P0)}                │ bypass ratio      ${o.bpr.toFixed(2)}`,
    `2  fan face     ${C(o.T2)}  ${B(o.P2)}  ${K(o.W2)}  │ overall press. ratio ${o.opr.toFixed(1)}`,
    `13 bypass duct  ${C(o.T13)}  ${B(o.P13)}  ${K(o.Wbypass)}  │ fan PR ${o.fan.PR.toFixed(3)}  LPC PR ${o.lpc.PR.toFixed(3)}  HPC PR ${o.hpc.PR.toFixed(2)}`,
    `25 LPC exit     ${C(o.T25)}  ${B(o.P25)}  ${K(o.Wlpc)}  │ fuel/air ratio   ${o.far.toFixed(4)}  (φ = ${o.phi.toFixed(2)}, lean limit ${o.leanLimit.toFixed(4)})`,
    `3  HPC exit     ${C(o.T3)}  ${B(o.P3)}  ${K(o.Wcore)}  │ combustion eff.  ${(o.etab * 100).toFixed(1)} %   unburnt ${(o.wfUnburnt * 3600).toFixed(0)} kg/h`,
    `4  comb. exit   ${C(o.T4)}  ${B(o.P4)}  ${K(o.W4)}  │ HPT PR ${o.hptPR.toFixed(2)}  η ${(o.hpt.eff * 100).toFixed(0)}%   LPT PR ${o.lptPR.toFixed(2)}  η ${(o.lpt.eff * 100).toFixed(0)}%`,
    `45 HPT exit     ${C(o.T45)}  ${B(o.P45)}  ${K(o.W45)}  │ power: fan ${MW(o.pwrFan)} LPC ${MW(o.pwrLpc)} HPC ${MW(o.pwrHpc)}`,
    `49 LPT exit     ${C(o.T5)}  ${B(o.P5)}  ${K(o.W8)}  │        HPT ${MW(o.pwrHpt)} LPT ${MW(o.pwrLpt)}`,
    ``,
    `jet velocity   core ${o.V8.toFixed(0).padStart(4)} m/s (M ${o.M8.toFixed(2)})   bypass ${o.V18.toFixed(0).padStart(4)} m/s (M ${o.M18.toFixed(2)})   turbine metal ${C(o.Tm)}`,
    `bleeds         2.5: ${o.Wb25.toFixed(2)}  stg7: ${o.Wb7.toFixed(2)}  stg10: ${o.Wb10.toFixed(2)}  customer: ${o.Wcust.toFixed(2)}  turbine cooling: ${o.Wcool.toFixed(2)} kg/s`,
    `shaft torque   N1 net ${o.tq1.toFixed(0).padStart(6)} N·m   N2 net ${o.tq2.toFixed(0).padStart(6)} N·m   starter ${o.tStart.toFixed(0)} N·m   N1 ${o.N1.toFixed(0)} rpm  N2 ${o.N2.toFixed(0)} rpm`,
  ].join('\n');
}

// ------------------------------------------------------------ main loop
const DT = 1 / 120;
let last = performance.now(), acc = 0, frame = 0;
function tick(now) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    acc += real * speed;
    let n = 0;
    while (acc >= DT && n < 160) { slewAmbient(DT); fadec.update(DT); eng.step(DT); handleEvents(DT); acc -= DT; n++; if (n % 12 === 0) pushTrend(eng.out); }
    if (n >= 160) acc = 0;
  }
  const o = eng.out;
  view.draw(o, paused ? 0 : real * Math.min(speed, 2));
  audio.update(o, real);
  drawEcam($('ecam'), o, fadec, peaks);
  if (frame++ % 3 === 0) {
    refreshRows();
    $('clock').textContent = `T+ ${stamp()}`;
    if (activeTab === 'maps') drawMaps($('maps'), eng);
    else if (activeTab === 'trend') drawTrends($('trend'));
    else if (activeTab === 'data') $('data').textContent = dataText(o);
    else if (activeTab === 'log') $('log').textContent = log.join('\n');
  }
  requestAnimationFrame(tick);
}
logMsg('Cold and dark. Set ENG MASTER to ON for an automatic start.');
requestAnimationFrame(tick);
