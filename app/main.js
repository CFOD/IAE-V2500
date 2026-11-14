// Game shell: owns the simulation loop and wires UI <-> sim <-> views.
import { Engine, defaultMods } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
import { RATINGS } from '../src/sim/v2500.js';
import { Cutaway } from './cutaway.js';
import { Scene3D } from './scene3d.js';
import { drawEcam, drawMaps, drawTrends, pushTrend } from './gauges.js';
import { EngineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const eng = new Engine();
const fadec = new Fadec(eng);
const view2d = new Cutaway($('cutaway'));
const audio = new EngineAudio();
let view3d = null;
try { view3d = new Scene3D($('stage3d')); } catch (e) { console.error('3D view unavailable, using section view', e); }
const peaks = { egt: 0, n1: 0, n2: 0 };
const log = [];
const active = { drawer: 'ctl', sd: 'maps' };
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let paused = false, speed = 1, evIdx = 0, overTemp = 0, mode = view3d ? '3d' : '2d';
eng.u.rh = 50; // relative humidity %, only used for the inlet condensation / vortex visuals
window.sim = { eng, fadec, view3d }; // handy from the dev console (F12)

const stamp = () => { const t = eng.s.t; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
function logMsg(m) { log.unshift(`<b>${stamp()}</b>${esc(m)}`); if (log.length > 200) log.pop(); }

// ------------------------------------------------------------ inlet weather physics
/**
 * Condensation in the intake and the ground vortex are driven by real quantities:
 * the inlet throat Mach number from the mass flow, the static temperature and
 * pressure drop that go with it, and the dew point of the ambient air.
 */
function inletWeather(o) {
  const A = 1.84, g = 1.4, R = 287.05; // throat area m^2
  const f = (Math.max(o.W2, 0) * Math.sqrt(o.T2)) / (o.P2 * A) / Math.sqrt(g / R);
  let M = f; for (let i = 0; i < 8; i++) M = Math.min(0.95, f * Math.pow(1 + 0.2 * M * M, 3));
  const k = 1 + 0.2 * M * M, Ts = o.T2 / k, V = M * Math.sqrt(g * R * Ts);
  const Tc = o.amb.T0 - 273.15;
  const es = 610.94 * Math.exp((17.625 * Tc) / (Tc + 243.04));
  const e = (eng.u.rh / 100) * es * Math.pow(k, -3.5) * (o.P2 / o.P0); // vapour pressure follows the static pressure drop
  const ln = Math.log(Math.max(e, 1) / 610.94), Td = (243.04 * ln) / (17.625 - ln) + 273.15;
  // droplets need a few degrees of supercooling below the dew point before they are visible
  const fog = Math.min(1, Math.max(0, (Td - Ts - 4) / 5));
  // a ground vortex needs a stationary engine close to the ground and a strong sink
  const vortex = eng.u.mach < 0.06 ? Math.min(1, Math.max(0, (V - 70) / 80)) : 0;
  return { M, Ts, V, Td, fog, vortex };
}

// ------------------------------------------------------------ control rows
const rows = [];
function addRow(parent, d) {
  const el = document.createElement('div'); el.className = 'ctl';
  el.innerHTML = `<span class="name" title="${d.tip || ''}">${d.name}</span>${d.ovr ? '<button>Auto</button>' : '<span></span>'}<input type="range" min="${d.min}" max="${d.max}" step="${d.step}"><span class="val"></span>`;
  parent.appendChild(el);
  const [, btn, inp, val] = el.children;
  const row = { d, el, inp, val, man: !d.ovr };
  inp.value = d.get();
  inp.addEventListener('input', () => { if (row.man) d.set(+inp.value); });
  if (d.ovr) {
    inp.disabled = true;
    btn.addEventListener('click', () => {
      row.man = !row.man; btn.textContent = row.man ? 'Manual' : 'Auto'; btn.classList.toggle('on', row.man);
      el.classList.toggle('man', row.man); inp.disabled = !row.man;
      d.set(row.man ? +inp.value : null);
      logMsg(`${d.name}: ${row.man ? 'MANUAL' : 'FADEC AUTO'}`);
    });
  }
  rows.push(row);
  return row;
}
function refreshRows() { for (const r of rows) { if (!r.man) r.inp.value = r.d.get(); r.val.textContent = r.d.fmt(+r.inp.value); } }
function resetRows(tabEl) { for (const r of rows) if (tabEl.contains(r.el) && r.man && !r.d.ovr) { r.inp.value = r.d.def; r.d.set(r.d.def); } }

const ov = fadec.ovr, u = eng.u, m = eng.mods;
const onoff = (v) => (v >= 0.5 ? 'ON' : 'OFF');
const ctl = $('t-ctl');
[
  { name: 'Fuel flow', tip: 'Metered fuel flow. Needs ENG MASTER on (fuel shut-off valve).', ovr: 1, min: 0, max: 8000, step: 10, get: () => fadec.auto.fuel * 3600 || 0, set: (v) => (ov.fuel = v == null ? null : v / 3600), fmt: (v) => `${v.toFixed(0)} kg/h` },
  { name: 'Igniters', ovr: 1, min: 0, max: 1, step: 1, get: () => +!!fadec.auto.ignition, set: (v) => (ov.ignition = v == null ? null : v >= 0.5), fmt: onoff },
  { name: 'Starter air valve', ovr: 1, min: 0, max: 1, step: 1, get: () => +!!fadec.auto.starter, set: (v) => (ov.starter = v == null ? null : v >= 0.5), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  { name: 'Starter air pressure', tip: 'APU / ground cart duct pressure', min: 0, max: 60, step: 1, def: 40, get: () => u.starterPsi, set: (v) => (u.starterPsi = v), fmt: (v) => `${v.toFixed(0)} psi` },
  { name: 'Variable stator vanes', tip: 'HPC inlet guide vanes + 3 stator rows. Degrees closed.', ovr: 1, min: -10, max: 50, step: 0.5, get: () => eng.out.vsvSched, set: (v) => (ov.vsv = v), fmt: (v) => `${v.toFixed(1)}° shut` },
  { name: 'LPC 2.5 bleed ring', tip: 'Booster bleed ring, dumps into bypass duct', ovr: 1, min: 0, max: 1, step: 0.01, get: () => fadec.auto.bleed25, set: (v) => (ov.bleed25 = v), fmt: (v) => `${(v * 100).toFixed(0)} % open` },
  { name: 'HPC stage 7 bleeds', tip: 'Three handling bleed valves', ovr: 1, min: 0, max: 3, step: 1, get: () => fadec.auto.bleed7, set: (v) => (ov.bleed7 = v), fmt: (v) => `${v} / 3 open` },
  { name: 'HPC stage 10 bleed', tip: 'Start / handling bleed valve', ovr: 1, min: 0, max: 1, step: 1, get: () => fadec.auto.bleed10, set: (v) => (ov.bleed10 = v), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  { name: 'Customer bleed', tip: 'Air taken for cabin / anti-ice, % of core flow', min: 0, max: 10, step: 0.1, def: 0, get: () => u.custBleed * 100, set: (v) => (u.custBleed = v / 100), fmt: (v) => `${v.toFixed(1)} % core` },
  { name: 'Power off-take', tip: 'Generator + hydraulic pump load on the HP spool', min: 0, max: 300, step: 5, def: 60, get: () => u.offtakeW / 1000, set: (v) => (u.offtakeW = v * 1000), fmt: (v) => `${v.toFixed(0)} kW` },
].forEach((d) => addRow(ctl, d));
ctl.insertAdjacentHTML('beforeend', '<p class="note">On Auto the engine computer (FADEC) has authority and each slider follows what it commands. Switch a channel to Manual to take it away from the computer and find out why the schedules exist.</p>');

const amb = $('t-amb'); amb.innerHTML = '<div class="presets"></div>';
const ambRows = [
  { name: 'Altitude', min: 0, max: 12500, step: 50, def: 0, get: () => u.alt, set: (v) => (u.alt = v), fmt: (v) => `${(v * 3.28084).toFixed(0)} ft` },
  { name: 'ISA deviation', min: -40, max: 40, step: 1, def: 0, get: () => u.dTisa, set: (v) => (u.dTisa = v), fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} K · OAT ${(eng.out.amb.T0 - 273.15).toFixed(0)} °C` },
  { name: 'Mach number', min: 0, max: 0.85, step: 0.01, def: 0, get: () => u.mach, set: (v) => (u.mach = v), fmt: (v) => `M ${v.toFixed(2)}` },
  { name: 'Relative humidity', tip: 'Drives condensation in the intake. Does not change engine performance in this model.', min: 0, max: 100, step: 1, def: 50, get: () => u.rh, set: (v) => (u.rh = v), fmt: (v) => `${v.toFixed(0)} %` },
].map((d) => { const r = addRow(amb, d); r.inp.addEventListener('input', () => (ambGoal = null)); return r; });
let ambGoal = null; // presets slew over a few seconds so the engine is not teleported
function slewAmbient(dt) {
  if (!ambGoal) return;
  let done = true;
  ambRows.forEach((r, i) => { const cur = r.d.get(), span = r.d.max - r.d.min, d = ambGoal[i] - cur, stepMax = span * dt * 0.12; const nv = Math.abs(d) <= stepMax ? ambGoal[i] : cur + Math.sign(d) * stepMax; if (nv !== ambGoal[i]) done = false; r.d.set(nv); r.inp.value = nv; });
  if (done) ambGoal = null;
}
const presets = { 'Sea level, standard day': [0, 0, 0, 50], 'Humid morning': [0, -5, 0, 98], 'Hot day': [0, 30, 0, 30], 'Hot and high': [2438, 25, 0, 30], 'Climb FL200': [6096, 0, 0.6, 40], 'Cruise FL350': [10668, 0, 0.78, 20] };
for (const [name, v] of Object.entries(presets)) {
  const b = document.createElement('button'); b.textContent = name;
  b.onclick = () => { ambGoal = v; logMsg(`Ambient: ${name}`); };
  amb.firstChild.appendChild(b);
}
amb.insertAdjacentHTML('beforeend', '<p class="note">This is an altitude test cell, not a flight model: presets slew over a few seconds, sliders act instantly. Fog forms in the intake when the air accelerating into the fan cools below its dew point; a ground vortex forms when the engine is stationary and pulling hard.</p>');

const hw = $('t-hw'); hw.innerHTML = '<div class="presets"><button id="hwReset">Restore new-engine condition</button></div>';
const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %`;
const effRow = (name, key) => ({ name, tip: 'Isentropic efficiency change (wear, fouling, damage)', min: -15, max: 3, step: 0.1, def: 0, get: () => m[key] * 100, set: (v) => (m[key] = v / 100), fmt: (v) => `${pct(v)} pts` });
const mulRow = (name, key, lo, hi, tip) => ({ name, tip, min: lo, max: hi, step: 0.5, def: 0, get: () => (m[key] - 1) * 100, set: (v) => (m[key] = 1 + v / 100), fmt: pct });
[
  effRow('Fan efficiency', 'effFan'), effRow('LPC efficiency', 'effLpc'), effRow('HPC efficiency', 'effHpc'), effRow('HPT efficiency', 'effHpt'), effRow('LPT efficiency', 'effLpt'),
  mulRow('HPC flow capacity', 'flowHpc', -20, 10, 'Compressor fouling reduces flow'), mulRow('HPT nozzle area', 'flowHpt', -15, 15, 'Turbine flow capacity. Smaller = HPC pushed towards surge'), mulRow('LPT nozzle area', 'flowLpt', -15, 15),
  mulRow('Final nozzle area', 'a9', -30, 30, 'Common exhaust nozzle. Smaller = fan pushed towards surge'), mulRow('Core mixer area', 'a8', -30, 30, 'Core stream area at the mixing plane'), mulRow('Bypass mixer area', 'a18', -30, 30, 'Bypass stream area at the mixing plane'),
  mulRow('Turbine cooling air', 'cooling', -100, 50, 'Cooling air taken from the HPC'),
  { name: 'Fuel heating value', tip: 'Lower heating value. Jet A ≈ 43.1 MJ/kg', min: 25, max: 50, step: 0.1, def: 43.1, get: () => m.lhv / 1e6, set: (v) => (m.lhv = v * 1e6), fmt: (v) => `${v.toFixed(1)} MJ/kg` },
].forEach((d) => addRow(hw, d));
$('hwReset').onclick = () => { resetRows(hw); Object.assign(m, defaultMods()); logMsg('Hardware restored to new condition'); };

// ------------------------------------------------------------ pedestal
const sel = $('rating');
for (const k of Object.keys(RATINGS)) sel.add(new Option(`${k} · ${(RATINGS[k].toLbf / 1000).toFixed(1)}k lbf`, k));
sel.value = fadec.rating; sel.onchange = () => { fadec.rating = sel.value; logMsg(`Rating ${sel.value}`); };
const setMaster = (v) => { fadec.master = v; if (v && fadec.phase === 'abort') fadec.phase = 'off'; $('master').setAttribute('aria-pressed', v); logMsg(`ENG MASTER ${v ? 'ON' : 'OFF'}`); };
$('master').onclick = () => setMaster(!fadec.master);
$('manStart').onclick = () => { fadec.manStart = !fadec.manStart; $('manStart').setAttribute('aria-pressed', fadec.manStart); };
const tla = $('tla');
const detent = (t) => (t >= 0.995 ? 'TOGA' : Math.abs(t - 0.85) < 0.012 ? 'Max continuous' : Math.abs(t - 0.7) < 0.012 ? 'Climb' : t < 0.005 ? 'Idle' : `${(t * 100).toFixed(0)} %`);
const setTla = (v) => { fadec.tla = Math.min(1, Math.max(0, v)); tla.value = fadec.tla; $('tlaOut').textContent = detent(fadec.tla); };
tla.oninput = () => { let v = +tla.value; for (const d of [0.7, 0.85]) if (Math.abs(v - d) < 0.02) v = d; setTla(v); };

// ------------------------------------------------------------ top bar
$('btnPause').onclick = () => { paused = !paused; $('btnPause').classList.toggle('on', paused); $('btnPause').textContent = paused ? 'Resume' : 'Pause'; };
const QUAL = ['high', 'medium', 'low']; let qi = 0;
$('btnQ').onclick = () => { qi = (qi + 1) % 3; view3d && view3d.setQuality(QUAL[qi]); $('btnQ').textContent = `Quality: ${QUAL[qi][0].toUpperCase()}${QUAL[qi].slice(1)}`; };
for (const b of $('speed').children) b.onclick = () => { speed = +b.dataset.v; for (const c of $('speed').children) c.classList.toggle('on', c === b); };
$('btnSound').onclick = () => { if (audio.on) audio.stop(); else audio.start(); $('btnSound').classList.toggle('on', audio.on); };
function setMode(v) {
  mode = v === '3d' && view3d ? '3d' : '2d';
  $('stage3d').hidden = mode !== '3d'; $('cutaway').hidden = mode !== '2d';
  for (const c of $('viewMode').children) c.classList.toggle('on', c.dataset.v === mode);
  $('partcard').style.display = mode === '3d' ? '' : 'none';
  requestAnimationFrame(() => { view2d.resize(); frame3d(); });
}
for (const b of $('viewMode').children) b.onclick = () => setMode(b.dataset.v);
$('btnCut').onclick = () => { const on = !$('btnCut').classList.contains('on'); $('btnCut').classList.toggle('on', on); view3d && view3d.setCutaway(on); };
$('btnFlow').onclick = () => { const on = !$('btnFlow').classList.contains('on'); $('btnFlow').classList.toggle('on', on); if (view3d) view3d.showFlow = on; };
$('explode').oninput = () => view3d && view3d.setExplode(+$('explode').value);
for (const b of $('cams').children) b.onclick = () => view3d && view3d.view(b.dataset.v);
const frame3d = () => { if (!view3d) return; const shut = $('drawer').classList.contains('shut'); document.body.classList.toggle('nodrawer', shut); view3d.offsetX = shut ? 0 : 210; view3d.offsetY = 56; view3d.resize(); };
$('btnDrawer').onclick = () => { const shut = $('drawer').classList.toggle('shut'); $('btnDrawer').classList.toggle('on', !shut); frame3d(); };
function reset(running) {
  eng.initCold(); eng.events.length = 0; evIdx = 0; fadec._evIdx = 0; fadec.phase = 'off'; fadec.wf = 0; eng.s.fuelUsed = 0;
  peaks.egt = peaks.n1 = peaks.n2 = 0; setTla(0); setMaster(running);
  if (running) { for (let i = 0; i < 100 * 60; i++) { fadec.update(1 / 60); eng.step(1 / 60); } eng.s.t = 0; eng.s.fuelUsed = 0; eng.events.length = 0; fadec._evIdx = 0; }
  log.length = 0; logMsg(running ? 'Reset: engine running at ground idle' : 'Reset: cold and dark');
}
$('btnCold').onclick = () => reset(false);
$('btnIdle').onclick = () => reset(true);
for (const nav of document.querySelectorAll('nav.tabs')) for (const b of nav.children) b.onclick = () => {
  active[nav.dataset.group] = b.dataset.t;
  for (const c of nav.children) { c.classList.toggle('on', c === b); $('t-' + c.dataset.t).classList.toggle('on', c === b); }
  hist = 0;
};
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowUp') { setTla(fadec.tla + 0.05); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { setTla(fadec.tla - 0.05); e.preventDefault(); }
  else if (e.key === 'm' || e.key === 'M') setMaster(!fadec.master);
  else if (e.key === 'c' || e.key === 'C') $('btnCut').click();
  else if (e.key === ' ') { $('btnPause').click(); e.preventDefault(); }
});
window.addEventListener('resize', () => { view2d.resize(); frame3d(); });

// ------------------------------------------------------------ component inspector
let selPart = null, hist = 0;
const HINT = 'Drag to orbit, scroll to zoom, right-drag to pan. Click any part of the engine to inspect it.';
function showPart(p) {
  selPart = p;
  $('pcName').textContent = p ? p.name : 'Nothing selected';
  $('pcDesc').textContent = p ? p.desc : HINT;
  $('pcRemove').hidden = !p;
  if (!p) $('pcLive').textContent = '';
}
function refreshRemoved() {
  const gone = view3d.parts.filter((p) => p.removed);
  $('removedWrap').hidden = gone.length === 0;
  $('removed').replaceChildren(...gone.map((p) => { const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => { view3d.setRemoved(p.id, false); refreshRemoved(); }; return b; }));
}
if (view3d) {
  view3d.onSelect = showPart; showPart(null);
  view3d.onHover = (p, e) => { const tip = $('tip'); tip.hidden = !p; if (p) { tip.textContent = p.name; const r = $('stage').getBoundingClientRect(); tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`; } };
  $('pcRemove').onclick = () => { if (!selPart) return; view3d.setRemoved(selPart.id, true); logMsg(`Removed for inspection: ${selPart.name}`); showPart(null); refreshRemoved(); };
  $('restoreAll').onclick = () => { view3d.restoreAll(); refreshRemoved(); };
}

// ------------------------------------------------------------ events & wear
const EV = { lightoff: 'Light-off', 'flameout-lean': 'FLAME-OUT (mixture too lean)', 'flameout-rich': 'FLAME-OUT (rich / no airflow)', 'surge-fan': 'FAN SURGE', 'surge-lpc': 'LPC SURGE', 'surge-hpc': 'HPC SURGE' };
let lastBang = -1, lastSurgeLog = -10;
function handleEvents(dt) {
  for (; evIdx < eng.events.length; evIdx++) {
    const ev = eng.events[evIdx];
    if (ev.type.startsWith('surge')) {
      if (ev.t - lastBang > 0.08) { const w = ev.type.slice(6); view2d.surge(w); view3d && view3d.surge(w); audio.bang(w === 'fan' ? 1.3 : 1); lastBang = ev.t; }
      if (ev.t - lastSurgeLog > 1) { logMsg(EV[ev.type]); lastSurgeLog = ev.t; }
    } else logMsg(EV[ev.type] || ev.type);
  }
  if (eng.events.length > 2000) { eng.events.length = 0; evIdx = 0; fadec._evIdx = 0; }
  const o = eng.out, egt = o.egt - 273.15, red = RATINGS[fadec.rating].egtTO;
  peaks.egt = Math.max(peaks.egt, egt); peaks.n1 = Math.max(peaks.n1, o.N1pct); peaks.n2 = Math.max(peaks.n2, o.N2pct);
  // over-temperature burns turbine life: HPT efficiency is permanently lost
  if (egt > red) {
    if (overTemp === 0) logMsg('EGT OVER LIMIT - turbine damage accumulating');
    overTemp += dt;
    m.effHpt = Math.max(m.effHpt - 0.00004 * (egt - red) * dt, -0.15);
  } else overTemp = 0;
}

// ------------------------------------------------------------ stations page
function dataHtml(o, w) {
  const C = (T) => (T - 273.15).toFixed(0), B = (p) => (p / 1e5).toFixed(2), K = (x) => x.toFixed(1), MW = (p) => `${(p / 1e6).toFixed(2)} MW`;
  const st = [['Ambient', o.amb.T0, o.P0, null], ['2 · Fan face', o.T2, o.P2, o.W2], ['13 · Bypass duct', o.T13, o.P13, o.Wbypass], ['2.5 · LPC exit', o.T25, o.P25, o.Wlpc], ['3 · HPC exit', o.T3, o.P3, o.Wcore], ['4 · Combustor exit', o.T4, o.P4, o.W4], ['4.5 · HPT exit', o.T45, o.P45, o.W45], ['4.9 · LPT exit', o.T5, o.P5, o.W8], ['7 · Mixed exhaust', o.T7, o.Pt7, o.W9]];
  const kv = [
    ['Bypass ratio', o.bpr.toFixed(2)], ['Overall pressure ratio', o.opr.toFixed(1)],
    ['Fan / LPC / HPC pressure ratio', `${o.fan.PR.toFixed(2)} / ${o.lpc.PR.toFixed(2)} / ${o.hpc.PR.toFixed(1)}`],
    ['Fuel/air ratio (lean limit)', `${o.far.toFixed(4)} (${o.leanLimit.toFixed(4)})`], ['Equivalence ratio', o.phi.toFixed(2)],
    ['Combustion efficiency', `${(o.etab * 100).toFixed(1)} %`], ['Unburnt fuel', `${(o.wfUnburnt * 3600).toFixed(0)} kg/h`],
    ['HPT / LPT expansion ratio', `${o.hptPR.toFixed(2)} / ${o.lptPR.toFixed(2)}`],
    ['Power: fan, LPC, HPC', `${MW(o.pwrFan)}, ${MW(o.pwrLpc)}, ${MW(o.pwrHpc)}`], ['Power: HPT, LPT', `${MW(o.pwrHpt)}, ${MW(o.pwrLpt)}`],
    ['Jet velocity', `${o.V9.toFixed(0)} m/s · Mach ${o.M9.toFixed(2)}`], ['Mixing plane static pressure', `${B(o.Pm)} bar`],
    ['Turbine metal', `${C(o.Tm)} °C`], ['N1 / N2', `${o.N1.toFixed(0)} / ${o.N2.toFixed(0)} rpm`],
    ['Bleeds 2.5 / stg 7 / stg 10', `${o.Wb25.toFixed(1)} / ${o.Wb7.toFixed(1)} / ${o.Wb10.toFixed(1)} kg/s`], ['Turbine cooling air', `${o.Wcool.toFixed(1)} kg/s`],
    ['Intake Mach / velocity', `${w.M.toFixed(2)} / ${w.V.toFixed(0)} m/s`], ['Intake static temp / dew point', `${(w.Ts - 273.15).toFixed(1)} / ${(w.Td - 273.15).toFixed(1)} °C`],
    ['Intake fog / ground vortex', `${(w.fog * 100).toFixed(0)} % / ${(w.vortex * 100).toFixed(0)} %`],
  ];
  return `<table class="st"><tr><th>Station</th><th>°C</th><th>bar</th><th>kg/s</th></tr>${st.map(([n, T, P, W]) => `<tr><td>${n}</td><td>${C(T)}</td><td>${B(P)}</td><td>${W == null ? '' : K(W)}</td></tr>`).join('')}</table><div class="kv">${kv.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>`;
}

// ------------------------------------------------------------ status line
function statusHtml(o) {
  const chips = [], egt = o.egt - 273.15, add = (t, c = '') => chips.push(`<span class="${c}">${esc(t)}</span>`);
  if (o.hpc.stalled || o.lpc.stalled || o.fan.stalled) add('Compressor stall', 'bad');
  if (egt > RATINGS[fadec.rating].egtTO) add('EGT over limit', 'bad');
  if (o.N1pct > 100 || o.N2pct > 100) add('Overspeed', 'bad');
  if (fadec.msg) add(fadec.msg[0] + fadec.msg.slice(1).toLowerCase(), /ABORT|STALL|FLAME|HUNG/.test(fadec.msg) ? 'warn' : 'ok');
  add(o.lit ? 'Flame on' : 'No flame', o.lit ? 'ok' : '');
  if (o.ignOn) add('Igniters sparking', 'ok');
  if (o.tStart > 0) add('Starter engaged', 'ok');
  if (fadec.master && fadec.limiter) add(`Governing on ${fadec.limiter}`);
  if (Object.values(fadec.ovr).some((v) => v != null)) add('Manual override active', 'warn');
  if (peaks.egt > 1) add(`Peak EGT ${peaks.egt.toFixed(0)} °C`);
  return chips.join('');
}
const stateText = (o) => (!fadec.master ? (o.N2pct > 1 ? 'Spooling down' : 'Cold') : fadec.phase === 'run' ? (fadec.tla < 0.01 ? 'Running · idle' : 'Running') : fadec.phase === 'abort' ? 'Start aborted' : 'Starting');

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
  const o = eng.out, vdt = paused ? 0 : real * Math.min(speed, 2), w = inletWeather(o);
  if (mode === '3d') view3d.update(o, vdt, w); else view2d.draw(o, vdt);
  audio.update(o, real);
  drawEcam($('ecam'), o, fadec, peaks, RATINGS[fadec.rating].egtTO);
  if (frame++ % 3 === 0) {
    refreshRows();
    $('clock').textContent = stamp();
    if (selPart) $('pcLive').textContent = selPart.live(o);
    $('status').innerHTML = statusHtml(o); $('state').textContent = stateText(o);
    if (active.drawer === 'mon') {
      if (active.sd === 'maps') drawMaps($('maps'), eng);
      else if (active.sd === 'trend') drawTrends($('trend'));
      else if (active.sd === 'data' && hist++ % 3 === 0) $('data').innerHTML = dataHtml(o, w);
      else if (active.sd === 'log') $('log').innerHTML = log.join('<br>');
    }
  }
  requestAnimationFrame(tick);
}
// An authored model can replace generated components: see docs/MODEL.md
if (view3d) fetch('assets/model.json').then((r) => (r.ok ? r.json() : null)).then((mf) => mf && view3d.loadExternalModel('assets/', mf)).then((taken) => { if (taken) { logMsg(`External model loaded: ${taken.join(', ') || 'no components matched'}`); window.sim.externalParts = taken; } }).catch(() => {});
setMode(mode);
logMsg('Cold and dark. Set ENG MASTER to ON for an automatic start.');
requestAnimationFrame(tick);
