// Game shell: owns the simulation loop and wires UI <-> sim <-> views.
import { Engine, defaultMods } from '../src/sim/engine.js';
import { Fadec, TRA } from '../src/sim/fadec.js';
import { RATINGS } from '../src/sim/v2500.js';
import { Cutaway } from './cutaway.js';
import { Scene3D } from './scene3d.js';
import { drawEcam, drawMaps, drawTrends, pushTrend } from './gauges.js';
import { EngineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const eng = new Engine();
const fadec = new Fadec(eng);
const view2d = new Cutaway($('cutaway'));
// Website builds carry build.json: its commit versions the model and sound URLs, so a new deploy is
// never hidden behind an older copy in the browser cache. The desktop app has none and loads files as is.
const BUILD = await fetch('build.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const assetQuery = BUILD ? `?v=${BUILD.commit}` : '';
const audio = new EngineAudio();
let view3d = null;
try { view3d = new Scene3D($('stage3d')); } catch (e) { console.error('3D view unavailable, using section view', e); }
const peaks = { egt: 0, n1: 0, n2: 0 };
const log = [];
const active = { drawer: 'ctl', sd: 'maps' };
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let paused = false, speed = 1, evIdx = 0, overTemp = 0, mode = view3d ? '3d' : '2d';
eng.u.rh = 50; // relative humidity %, only used for the inlet condensation / vortex visuals
window.sim = { eng, fadec, view3d }; window.simAudio = audio; // handy from the dev console (F12)

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
/**
 * A slider row. Rows with `key` belong to a FADEC channel: Auto follows the computer, Manual overrides it.
 * State lives in the simulation, not the row, so the same control can appear in the panel and on a component card.
 */
function addRow(parent, d) {
  const el = document.createElement('div'); el.className = 'ctl';
  el.innerHTML = `<span class="name" title="${d.tip || ''}">${d.name}</span>${d.key ? '<button>Auto</button>' : '<span></span>'}<input type="range" min="${d.min}" max="${d.max}" step="${d.step}"><span class="val"></span>`;
  parent.appendChild(el);
  const [, btn, inp, val] = el.children;
  const row = { d, el, inp, val, btn };
  inp.value = d.get();
  inp.addEventListener('input', () => { if (!d.key || fadec.ovr[d.key] != null) d.set(+inp.value); });
  if (d.key) btn.addEventListener('click', () => { const man = fadec.ovr[d.key] == null; d.set(man ? +inp.value : null); logMsg(`${d.name}: ${man ? 'manual' : 'FADEC auto'}`); });
  rows.push(row);
  return row;
}
function refreshRows() {
  for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].el.isConnected) rows.splice(i, 1);
  for (const r of rows) {
    const d = r.d, man = d.key ? fadec.ovr[d.key] != null : true;
    if (d.key) { r.btn.textContent = man ? 'Manual' : 'Auto'; r.btn.classList.toggle('on', man); r.el.classList.toggle('man', man); r.inp.disabled = !man; }
    if (document.activeElement !== r.inp) r.inp.value = d.key && man ? d.mv() : d.get();
    r.val.textContent = d.fmt(+r.inp.value);
  }
}
function resetRows(tabEl) { for (const r of rows) if (tabEl.contains(r.el) && !r.d.key && r.d.def != null) { r.inp.value = r.d.def; r.d.set(r.d.def); } }

const ov = fadec.ovr, u = eng.u, m = eng.mods;
const onoff = (v) => (v >= 0.5 ? 'ON' : 'OFF');
const ctl = $('t-ctl');
const onOff = (v) => (v >= 0.5 ? 'On' : 'Off');
const prot = (name, k, tip) => ({ name, tip, min: 0, max: 1, step: 1, def: 1, get: () => +fadec.prot[k], set: (v) => { fadec.prot[k] = v >= 0.5; }, fmt: onOff });
const D = {
  fuel: { name: 'Fuel flow', tip: 'Metered fuel flow. In Manual it flows even with Master off (manual start); switching Master off shuts it.', key: 'fuel', min: 0, max: 8000, step: 10, get: () => fadec.auto.fuel * 3600 || 0, mv: () => ov.fuel * 3600, set: (v) => (ov.fuel = v == null ? null : v / 3600), fmt: (v) => `${v.toFixed(0)} kg/h` },
  ign: { name: 'Igniters', key: 'ignition', min: 0, max: 1, step: 1, get: () => +!!fadec.auto.ignition, mv: () => +ov.ignition, set: (v) => (ov.ignition = v == null ? null : v >= 0.5), fmt: onoff },
  starter: { name: 'Starter air valve', key: 'starter', min: 0, max: 1, step: 1, get: () => +!!fadec.auto.starter, mv: () => +ov.starter, set: (v) => (ov.starter = v == null ? null : v >= 0.5), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  starterPsi: { name: 'Starter air pressure', tip: 'APU / ground cart duct pressure', min: 0, max: 60, step: 1, def: 40, get: () => u.starterPsi, set: (v) => (u.starterPsi = v), fmt: (v) => `${v.toFixed(0)} psi` },
  vsv: { name: 'Variable stator vanes', tip: 'HPC inlet guide vanes + 3 stator rows. Degrees closed.', key: 'vsv', min: -10, max: 50, step: 0.5, get: () => eng.out.vsvSched, mv: () => ov.vsv, set: (v) => (ov.vsv = v), fmt: (v) => `${v.toFixed(1)}° shut` },
  b25: { name: 'LPC 2.5 bleed ring', tip: 'Booster bleed ring, dumps into bypass duct', key: 'bleed25', min: 0, max: 1, step: 0.01, get: () => fadec.auto.bleed25, mv: () => ov.bleed25, set: (v) => (ov.bleed25 = v), fmt: (v) => `${(v * 100).toFixed(0)} % open` },
  b7: { name: 'HPC stage 7 bleeds', tip: 'Three handling bleed valves', key: 'bleed7', min: 0, max: 3, step: 1, get: () => fadec.auto.bleed7, mv: () => ov.bleed7, set: (v) => (ov.bleed7 = v), fmt: (v) => `${v} / 3 open` },
  b10: { name: 'HPC stage 10 bleed', tip: 'Start / handling bleed valve', key: 'bleed10', min: 0, max: 1, step: 1, get: () => fadec.auto.bleed10, mv: () => ov.bleed10, set: (v) => (ov.bleed10 = v), fmt: (v) => (v >= 0.5 ? 'OPEN' : 'CLOSED') },
  accH: { name: 'HPT clearance control', tip: 'Fan air sprayed on the HP turbine case to shrink it onto the blade tips. The FADEC opens it in climb and cruise only; held open through a hard acceleration at sea level, the tips rub.', key: 'accHpt', min: 0, max: 1, step: 0.05, get: () => fadec.auto.accHpt || 0, mv: () => ov.accHpt, set: (v) => (ov.accHpt = v), fmt: (v) => `${(v * 100).toFixed(0)} % open` },
  accL: { name: 'LPT clearance control', tip: 'Fan air on the LP turbine case through the rings of spray tubes. Modulated with altitude in climb and cruise.', key: 'accLpt', min: 0, max: 1, step: 0.05, get: () => fadec.auto.accLpt || 0, mv: () => ov.accLpt, set: (v) => (ov.accLpt = v), fmt: (v) => `${(v * 100).toFixed(0)} % open` },
  cust: { name: 'Customer bleed', tip: 'Air taken for cabin / anti-ice, % of core flow', min: 0, max: 10, step: 0.1, def: 0, get: () => u.custBleed * 100, set: (v) => (u.custBleed = v / 100), fmt: (v) => `${v.toFixed(1)} % core` },
  offtake: { name: 'Power off-take', tip: 'Generator + hydraulic pump load on the HP spool. Certified limit 131 kW continuous, 168 kW for 5 minutes.', min: 0, max: 170, step: 5, def: 60, get: () => u.offtakeW / 1000, set: (v) => (u.offtakeW = v * 1000), fmt: (v) => `${v.toFixed(0)} kW` },
  n1mode: { name: 'Thrust setting mode', tip: 'EPR (normal) or rated-N1 reversion', min: 0, max: 1, step: 1, def: 0, get: () => +fadec.n1Mode, set: (v) => { fadec.n1Mode = v >= 0.5; }, fmt: (v) => (v >= 0.5 ? 'N1 mode' : 'EPR mode') },
  pEgt: prot('EGT limiter', 'egt', 'Off: the FADEC no longer cuts fuel to hold EGT inside its limit'),
  pN1: prot('N1 overspeed limiter', 'n1'), pN2: prot('N2 overspeed limiter', 'n2'),
  pAccel: prot('Acceleration schedule', 'accel', 'Fuel limit that keeps the HP compressor out of surge during accelerations'),
  pDecel: prot('Deceleration schedule', 'decel', 'Fuel floor that keeps the flame alight during decelerations'),
  pSurge: prot('Surge recovery', 'surge', 'On a surge: bleeds open, ignition on, acceleration fuel reduced'),
  pAbort: prot('Hot-start abort', 'startAbort', 'Automatic start abort above the starting EGT limit'),
};
['fuel', 'ign', 'starter', 'starterPsi', 'vsv', 'b25', 'b7', 'b10', 'accH', 'accL', 'cust', 'offtake'].forEach((k) => addRow(ctl, D[k]));
ctl.insertAdjacentHTML('beforeend', '<h4>FADEC protections</h4>');
['n1mode', 'pEgt', 'pN1', 'pN2', 'pAccel', 'pDecel', 'pSurge', 'pAbort'].forEach((k) => addRow(ctl, D[k]));
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
].forEach((d) => { D[d.name] = d; addRow(hw, d); });
$('hwReset').onclick = () => { resetRows(hw); Object.assign(m, defaultMods()); eng.damage.reset(); for (const f of FAULTS) if (f.active && f.mods) { f.active = false; } refreshFaults(); logMsg('Hardware restored to new condition'); };

// ------------------------------------------------------------ faults
const FAULTS = [
  { id: 'bird', name: 'Bird strike', desc: 'Bent fan blades: fan efficiency -8 points, airflow -6 %. Thrust falls at the same lever position and the fan runs closer to surge.', mods: { effFan: -0.08, flowFan: 0.94 }, bang: 'surge-fan' },
  { id: 'fod', name: 'Debris through the core', desc: 'HP compressor damage: efficiency -6 points, flow -5 %. Surge margin shrinks.', mods: { effHpc: -0.06, flowHpc: 0.95 }, bang: 'surge-hpc' },
  { id: 'hpt', name: 'Turbine blade burn-through', desc: 'HP turbine efficiency -7 points. EGT rises sharply for the same thrust.', mods: { effHpt: -0.07 } },
  { id: 'fuelq', name: 'Contaminated fuel', desc: 'Fuel heating value down 20 %. More fuel flow for the same thrust.', mods: { lhv: 0.8 } },
  { id: 'vsv', name: 'Stator vanes jammed', desc: 'Variable stators freeze where they are now.', on: () => { ov.vsv = eng.out.vsv; }, off: () => { ov.vsv = null; } },
  { id: 'b25', name: '2.5 bleed stuck closed', desc: 'The booster bleed ring cannot open. Risk of LP compressor surge at low power and on decelerations.', on: () => { ov.bleed25 = 0; }, off: () => { ov.bleed25 = null; } },
  { id: 'svopen', name: 'Start valve fails to open', desc: 'No air reaches the starter. An automatic start is aborted after a few seconds: ENG 1 START FAULT, START VALVE NOT OPEN.', on: () => { fadec.faults.svNoOpen = true; }, off: () => { fadec.faults.svNoOpen = false; } },
  { id: 'startv', name: 'Start valve stuck open', desc: 'At 43 % N2 the valve will not close: ENG 1 START VALVE FAULT. Shut the APU bleed, then MASTER OFF. Left alone, the unloaded starter overspeeds and fails.', on: () => { fadec.faults.svNoClose = true; }, off: () => { fadec.faults.svNoClose = false; } },
  { id: 'ignA', name: 'Igniter A failed', desc: 'Automatic starts alternate between igniters, so every other start finds no light: IGNITION FAULT, fuel off, dry crank. Restart and the EEC uses B.', on: () => { fadec.faults.ignA = true; }, off: () => { fadec.faults.ignA = false; } },
  { id: 'ignB', name: 'Igniter B failed', desc: 'As above, for igniter B. With both failed only a manual start would keep trying, and the crew has to stop it.', on: () => { fadec.faults.ignB = true; }, off: () => { fadec.faults.ignB = false; } },
  { id: 'lowair', name: 'Weak starter air', desc: 'APU duct pressure down to 14 psi. Motoring speed only just reaches the light-up window and the start takes much longer.', on: () => { u.starterPsi = 14; }, off: () => { u.starterPsi = 40; } },
  { id: 'accstuck', name: 'Clearance control valves stuck open', desc: 'Both ACC valves jam open on the ground. At idle nothing happens; slam to take-off power and the rotor grows onto the cooled, shrunken turbine cases and rubs the tips.', on: () => { ov.accHpt = 1; ov.accLpt = 1; }, off: () => { ov.accHpt = null; ov.accLpt = null; } },
  { id: 'epr', name: 'EPR sensing lost', desc: 'P4.9 / P2 signal fails. The FADEC reverts to rated-N1 mode.', on: () => { fadec.n1Mode = true; }, off: () => { fadec.n1Mode = false; } },
  { id: 'oilleak', name: 'Oil leak', desc: 'A pipe union lets go: about 3 quarts a minute overboard. Watch the quantity fall, then the pressure.', on: () => { eng.oil.faults.leak = 3; }, off: () => { eng.oil.faults.leak = 0; } },
  { id: 'oilpump', name: 'Oil pump drive failure', desc: 'Pressure drops to zero at once. The bearings last about a minute at take-off power, a few minutes at idle.', on: () => { eng.oil.faults.pumpFail = true; }, off: () => { eng.oil.faults.pumpFail = false; } },
  { id: 'seal4', name: 'No. 4 bearing seal failure', desc: 'Oil is lost into the gas path: quantity falls steadily and smoke trails from the exhaust.', on: () => { eng.oil.faults.seal4 = true; }, off: () => { eng.oil.faults.seal4 = false; } },
  { id: 'acoc', name: 'Oil cooler air valve stuck shut', desc: 'Only the fuel is left to cool the oil. Fine at high power; at idle, with little fuel flowing, the oil overheats.', on: () => { eng.oil.faults.acocStuck = true; }, off: () => { eng.oil.faults.acocStuck = false; } },
  { id: 'oilfilter', name: 'Oil filter clogged', desc: 'Scavenge filter differential pressure rises past the 12 psi switch and the filter bypasses.', on: () => { eng.oil.faults.filterClog = true; }, off: () => { eng.oil.faults.filterClog = false; } },
  { id: 'flame', name: 'Flame-out', desc: 'Blow the flame out now (momentary). With protections on the FADEC relights it.', once: () => { eng.s.lit = false; eng.events.push({ t: eng.s.t, type: 'flameout-lean' }); } },
];
const applyMods = (mods, undo) => { for (const [k, v] of Object.entries(mods)) { if (k.startsWith('eff')) m[k] += undo ? -v : v; else m[k] = undo ? m[k] / v : m[k] * v; } };
function refreshFaults() { for (const f of FAULTS) for (const b of [f.btn, f.cardBtn]) if (b) { b.classList.toggle('on', !!f.active); b.textContent = f.once ? 'Trigger' : f.active ? 'Clear' : 'Inject'; } }
function toggleFault(f) {
  if (f.once) { f.once(); logMsg(`Fault: ${f.name}`); return; }
  f.active = !f.active;
  if (f.mods) applyMods(f.mods, !f.active); else (f.active ? f.on : f.off)();
  if (f.active && f.bang) eng.events.push({ t: eng.s.t, type: f.bang });
  logMsg(`Fault ${f.active ? 'injected' : 'cleared'}: ${f.name}`); refreshFaults();
}
const flt = $('t-flt');
for (const f of FAULTS) {
  const el = document.createElement('div'); el.className = 'fault'; el.innerHTML = `<b>${f.name}</b><button></button><span>${f.desc}</span>`; flt.appendChild(el);
  f.btn = el.querySelector('button');
  f.btn.onclick = () => toggleFault(f);
}
refreshFaults();
flt.insertAdjacentHTML('beforeend', '<p class="note">Faults stack with whatever you have set under Hardware and Control. Restore new-engine condition (Hardware tab) clears the damage-type faults.</p>');

// ------------------------------------------------------------ pedestal
const sel = $('rating');
for (const k of Object.keys(RATINGS)) sel.add(new Option(`${k} · ${(RATINGS[k].toLbf / 1000).toFixed(1)}k lbf`, k));
sel.value = fadec.rating; sel.onchange = () => { fadec.rating = sel.value; logMsg(`Rating ${sel.value}`); };
const setMaster = (v) => { fadec.master = v; if (!v && fadec.ovr.fuel != null) { fadec.ovr.fuel = null; logMsg('Fuel flow: manual released (master off)'); } $('master').setAttribute('aria-pressed', v); logMsg(`ENG MASTER ${v ? 'ON' : 'OFF'}`); };
$('master').onclick = () => setMaster(!fadec.master);
const MODE_NAME = { crank: 'CRANK', norm: 'NORM', ign: 'IGN/START' };
const setEngMode = (v, quiet) => { fadec.mode = v; for (const c of $('engMode').children) c.classList.toggle('on', c.dataset.v === v); if (!quiet) logMsg(`ENG MODE ${MODE_NAME[v]}`); };
for (const b of $('engMode').children) b.onclick = () => setEngMode(b.dataset.v);
const setManStart = (v, quiet) => { fadec.manStart = v; $('manStart').setAttribute('aria-pressed', v); if (!quiet) logMsg(`ENG MAN START ${v ? 'ON' : 'OFF'}`); };
$('manStart').onclick = () => setManStart(!fadec.manStart);
const setApuBleed = (v, quiet) => { fadec.apuBleed = v; $('apuBleed').setAttribute('aria-pressed', v); if (!quiet) logMsg(`APU BLEED ${v ? 'ON' : 'OFF'}`); };
$('apuBleed').onclick = () => setApuBleed(!fadec.apuBleed);
$('agent').onclick = () => { const out = eng.damage.extinguish(); logMsg(out ? 'Fire agent discharged - fire out' : 'Fire agent discharged - STILL BURNING: shut the fuel off first'); };
// Thrust lever in degrees, as on the A320: TOGA 45, FLX/MCT 35, CL 25, IDLE 0, then lifted through
// the latch into reverse: reverse idle -6, max reverse -20. The arrow keys stop at idle; press again to lift into reverse.
const tla = $('tla');
const near = (a, b) => Math.abs(a - b) < 0.3;
const detent = (d) => (d >= TRA.TOGA - 0.1 ? 'TOGA' : near(d, TRA.MCT) ? 'FLX / MCT' : near(d, TRA.CL) ? 'Climb' : d > 0.2 ? `${((d / TRA.TOGA) * 100).toFixed(0)} %`
  : d >= TRA.REV_DEPLOY ? 'Idle' : d > TRA.REV_IDLE - 0.3 ? 'Reverse idle' : d <= TRA.MREV + 0.1 ? 'Max reverse' : `Reverse ${(((TRA.REV_IDLE - d) / (TRA.REV_IDLE - TRA.MREV)) * 100).toFixed(0)} %`);
let revWas = false;
const setLever = (deg) => {
  const d = fadec.setLever(deg); tla.value = d;
  const out = $('tlaOut'); out.textContent = detent(d); out.classList.toggle('rev', fadec.revCmd);
  if (fadec.revCmd !== revWas) { revWas = fadec.revCmd; logMsg(revWas ? (eng.out.N2pct > 45 ? 'Thrust levers to reverse: reverser deploying' : 'Thrust levers to reverse: no hydraulic pressure, reverser stays stowed') : 'Thrust levers out of reverse: reverser stowing'); }
};
tla.oninput = () => { let v = +tla.value; for (const d of [TRA.IDLE, TRA.CL, TRA.MCT, TRA.REV_IDLE]) if (Math.abs(v - d) < 1.2) v = d; setLever(v); };
const leverStep = (up) => { const d = fadec.tra; setLever(up ? (d < TRA.REV_IDLE ? Math.min(TRA.REV_IDLE, d + 2.8) : d < 0 ? 0 : d + 2.25) : d > 0 ? Math.max(0, d - 2.25) : d > TRA.REV_IDLE ? TRA.REV_IDLE : d - 2.8); };

// ------------------------------------------------------------ top bar
$('btnPause').onclick = () => { paused = !paused; $('btnPause').classList.toggle('on', paused); $('btnPause').textContent = paused ? 'Resume' : 'Pause'; };
const QUAL = ['medium', 'high', 'ultra', 'low']; let qi = 0;
const qLabel = () => { $('btnQ').textContent = `Quality: ${QUAL[qi][0].toUpperCase()}${QUAL[qi].slice(1)}`; };
$('btnQ').onclick = () => { qi = (qi + 1) % QUAL.length; view3d && view3d.setQuality(QUAL[qi]); qLabel(); try { localStorage.setItem('v2500.quality', QUAL[qi]); } catch (e) { /* ignore */ } };
try { const saved = localStorage.getItem('v2500.quality'); if (saved && QUAL.includes(saved)) { qi = QUAL.indexOf(saved); view3d && view3d.setQuality(saved); } else if (matchMedia('(pointer: coarse)').matches) { qi = QUAL.indexOf('low'); view3d && view3d.setQuality('low'); } } catch (e) { /* ignore */ }
qLabel();
for (const b of $('speed').children) b.onclick = () => { speed = +b.dataset.v; for (const c of $('speed').children) c.classList.toggle('on', c === b); };
// Sound menu: on / off, and recordings read from a folder on the player's own computer (browser builds
// do not ship a sound pack; the files are decoded locally and never uploaded)
const soundMenu = $('soundMenu'), openSound = (on) => { soundMenu.classList.toggle('open', on); $('btnSound').setAttribute('aria-expanded', on); };
const soundLabel = () => { $('btnSound').classList.toggle('on', audio.on); $('sndToggle').firstChild.textContent = audio.on ? 'Sound off' : 'Sound on'; };
const sndState = (sp) => { $('sndState').textContent = (sp && sp.ready ? `Recordings: ${sp.name} (${sp.layers.length + sp.tracks.length} loops)` : 'Synthesised from the simulation (no recordings found)') + (buildId ? ` · build ${buildId}` : ''); };
$('btnSound').onclick = (e) => { e.stopPropagation(); soundLabel(); openSound(!soundMenu.classList.contains('open')); };
window.addEventListener('pointerdown', (e) => { if (!soundMenu.contains(e.target)) openSound(false); });
$('sndToggle').onclick = () => { if (audio.on) audio.stop(); else audio.start(); soundLabel(); openSound(false); try { localStorage.setItem('v2500.sound', audio.on ? '1' : '0'); } catch (e) { /* ignore */ } };
$('sndFolder').onclick = () => { openSound(false); $('sndPick').click(); };
$('sndPick').onchange = async () => {
  const files = $('sndPick').files; if (!files || !files.length) return;
  logMsg(`Sound: reading ${files.length} files from your computer…`);
  const sp = await audio.loadRecordings(files); soundLabel(); sndState(sp);
  if (sp) audio.onSamples(sp); else logMsg('Sound: no sounds.json or sound.cfg in that folder (see the sound guide); staying synthesised');
  $('sndPick').value = '';
};
// recordings download as soon as the page opens; their progress shows on the Sound button and the pill
let buildId = '';
audio.onSampleProgress = (a, b) => { if (b === 0) return; $('btnSound').textContent = a < b ? `Sound ${Math.round((100 * a) / b)} %` : 'Sound'; $('sndState').textContent = a < b ? `Loading recordings: ${a} of ${b}` : $('sndState').textContent; };
audio.onSamples = (sp) => { if (!sp) { sndState(null); return; } sndState(sp); logMsg(`Sound: playing recordings (${sp.name}: ${sp.layers.length} loops${sp.tracks.length ? `, ${sp.tracks.length} start / spool-down tracks` : ''}, ${Object.keys(sp.shots).length} events)${sp.missing.length ? `; missing files: ${sp.missing.join(', ')}` : ''}`); };
// sound is on unless it was switched off last time; browsers only allow it after the first click
let wantSound = true; try { wantSound = localStorage.getItem('v2500.sound') !== '0'; } catch (e) { /* ignore */ }
try { audio.query = assetQuery; audio.prepare(); } catch (e) { /* no Web Audio */ }
if (BUILD) { buildId = BUILD.commit; logMsg(`Build ${BUILD.commit} (${BUILD.branch}, ${BUILD.time})`); }
if (wantSound) { const go = () => { if (!audio.on) { audio.start(); $('btnSound').classList.add('on'); } }; try { go(); } catch (e) { /* needs a gesture */ } window.addEventListener('pointerdown', go, { once: true }); window.addEventListener('keydown', go, { once: true }); }
function setMode(v) {
  mode = v === '3d' && view3d ? '3d' : '2d';
  $('stage3d').hidden = mode !== '3d'; $('cutaway').hidden = mode !== '2d';
  for (const c of $('viewMode').children) c.classList.toggle('on', c.dataset.v === mode);
  $('partcard').style.display = mode === '3d' ? '' : 'none'; document.body.classList.toggle('mode2d', mode !== '3d');
  requestAnimationFrame(() => { view2d.resize(); frame3d(); });
}
for (const b of $('viewMode').children) b.onclick = () => setMode(b.dataset.v);
$('btnCowl').onclick = () => {
  const on = !$('btnCowl').classList.contains('on'); $('btnCowl').classList.toggle('on', on); if (!view3d) return; view3d.setCowls(on);
  logMsg(on ? 'Opening fan cowl doors, then thrust reverser C-ducts' : 'Closing C-ducts, then fan cowl doors');
  if (on && eng.out.N2pct > 5) logMsg('Cowls open with the engine turning: never done in service');
  if (on && (eng.out.rev || 0) > 0.02) logMsg('C-ducts stay shut until the reverser is stowed');
};
$('btnCut').onclick = () => { const on = !$('btnCut').classList.contains('on'); $('btnCut').classList.toggle('on', on); view3d && view3d.setCutaway(on); };
$('btnFlow').onclick = () => { const on = !$('btnFlow').classList.contains('on'); $('btnFlow').classList.toggle('on', on); if (view3d) view3d.showFlow = on; };
$('explode').oninput = () => view3d && view3d.setExplode(+$('explode').value);
for (const b of $('cams').children) b.onclick = () => view3d && view3d.view(b.dataset.v);
const PHONE = matchMedia('(max-height: 560px), (max-width: 760px)'), TOUCH = matchMedia('(pointer: coarse)').matches;
const frame3d = () => {
  if (!view3d) return; const hud = !document.body.classList.contains('hud-off'), shut = $('drawer').classList.contains('shut'); document.body.classList.toggle('nodrawer', shut);
  if (PHONE.matches) {
    // the panel slides over the view, so the engine stays centred between the top bar and the dock
    const dockTop = $('dock').getBoundingClientRect().top, topH = $('top').getBoundingClientRect().bottom;
    view3d.offsetX = 0; view3d.offsetY = hud ? Math.round((window.innerHeight - dockTop - topH) / 2) : 0;
  } else { view3d.offsetX = hud && !shut ? 210 : 0; view3d.offsetY = hud ? $('top').offsetHeight + 16 : 0; }
  view3d.resize();
};
// the top bar wraps to two rows on narrow windows; the panels below it follow its height
new ResizeObserver(() => { document.documentElement.style.setProperty('--top-h', `${$('top').offsetHeight}px`); frame3d(); }).observe($('top'));
// HUD toggle: hide all overlays for a clear view (button, H key); the engine re-centres in the window
const setHud = (on) => { document.body.classList.toggle('hud-off', !on); requestAnimationFrame(() => { view2d.resize(); frame3d(); }); };
$('btnHud').onclick = () => setHud(false);
$('hudShow').onclick = () => setHud(true);
$('btnDrawer').onclick = () => { const shut = $('drawer').classList.toggle('shut'); $('btnDrawer').classList.toggle('on', !shut); frame3d(); };
function reset(running) {
  fadec.reset(); setEngMode('norm', true); setManStart(false, true); setApuBleed(true, true); eng.damage.reset(); sparkK = 0; lostPrev = 0;
  eng.initCold(); eng.events.length = 0; evIdx = 0; eng.s.fuelUsed = 0;
  Object.assign(fadec.prot, { egt: true, n1: true, n2: true, accel: true, decel: true, surge: true, startAbort: true }); fadec.n1Mode = false;
  for (const f of FAULTS) if (f.active) { if (f.mods) applyMods(f.mods, true); else if (f.off) f.off(); f.active = false; } refreshFaults();
  peaks.egt = peaks.n1 = peaks.n2 = 0; setLever(0); setMaster(running);
  if (running) { fadec.mode = 'ign'; for (let i = 0; i < 100 * 60; i++) { fadec.update(1 / 60); eng.step(1 / 60); } fadec.mode = fadec._modePrev = 'norm'; eng.s.t = 0; eng.s.fuelUsed = 0; eng.events.length = 0; fadec._evIdx = 0; }
  log.length = 0; logMsg(running ? 'Reset: engine running at ground idle' : 'Reset: cold and dark');
}
const resetMenu = $('resetMenu'), openReset = (on) => { resetMenu.classList.toggle('open', on); $('btnReset').setAttribute('aria-expanded', on); };
$('btnReset').onclick = (e) => { e.stopPropagation(); openReset(!resetMenu.classList.contains('open')); };
window.addEventListener('pointerdown', (e) => { if (!resetMenu.contains(e.target)) openReset(false); });
$('btnCold').onclick = (e) => { reset(false); openReset(false); e.currentTarget.blur(); };
$('btnIdle').onclick = (e) => { reset(true); openReset(false); e.currentTarget.blur(); };
for (const nav of document.querySelectorAll('nav.tabs')) for (const b of nav.children) b.onclick = () => {
  active[nav.dataset.group] = b.dataset.t;
  for (const c of nav.children) { c.classList.toggle('on', c === b); $('t-' + c.dataset.t).classList.toggle('on', c === b); }
  hist = 0;
};
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowUp') { leverStep(true); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { leverStep(false); e.preventDefault(); }
  else if (e.key === 'm' || e.key === 'M') setMaster(!fadec.master);
  else if (e.key === 'c' || e.key === 'C') $('btnCut').click();
  else if (e.key === 'o' || e.key === 'O') $('btnCowl').click();
  else if (e.key === 'h' || e.key === 'H') setHud(document.body.classList.contains('hud-off'));
  else if (e.key === ' ') { $('btnPause').click(); e.preventDefault(); }
  else if (e.key === 'Escape') openReset(false);
});
window.addEventListener('resize', () => { view2d.resize(); frame3d(); });
// phones and tablets: the panel starts shut on small screens, rendering is lighter, and a Full screen button
// (which also turns a phone sideways where the browser allows it) replaces F11
if (PHONE.matches && !$('drawer').classList.contains('shut')) { $('drawer').classList.add('shut'); $('btnDrawer').classList.remove('on'); }
if (TOUCH && view3d) view3d.maxDpr = 1.5;
new ResizeObserver(() => frame3d()).observe($('dock'));
PHONE.addEventListener('change', () => requestAnimationFrame(frame3d));
if (document.fullscreenEnabled && (TOUCH || PHONE.matches)) {   // desktop has F11; this keeps its top bar to one row
  const fb = $('btnFull'); fb.hidden = false;
  const label = () => { fb.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; fb.classList.toggle('on', !!document.fullscreenElement); };
  fb.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); if (PHONE.matches && screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {}); }
    } catch (e) { /* refused */ }
  };
  document.addEventListener('fullscreenchange', () => { label(); requestAnimationFrame(frame3d); });
}

// ------------------------------------------------------------ component inspector
let selPart = null, hist = 0;
const HINT = 'Drag to orbit, scroll to zoom, right-drag to pan. Click any part of the engine to inspect it.';
// controls that belong to each component, shown on its card
const PART_CTL = {
  fuel: ['fuel'], ign: ['ign'], liner: ['fuel', 'Fuel heating value'], hpccase: ['vsv', 'b7', 'b10'], lpccase: ['b25'], agb: ['offtake'],
  starter: ['starter', 'starterPsi'], sav: ['starter', 'starterPsi'], idg: ['offtake'], hydpump: ['offtake'], fuelpump: ['fuel'], fmu: ['fuel'],
  eec: ['n1mode', 'pEgt', 'pAccel', 'pDecel'], combcase: ['cust'], fan: ['Fan efficiency'], lpc: ['LPC efficiency'], hpc: ['HPC efficiency', 'HPC flow capacity'],
  hpt: ['HPT efficiency', 'Turbine cooling air'], hptcase: ['HPT nozzle area', 'accH'], lpt: ['LPT efficiency'], lptcase: ['LPT nozzle area', 'accL'], ext: ['accH', 'accL'], cna: ['Final nozzle area', 'Bypass mixer area'], tec: ['Core mixer area'],
};
// faults that belong to each component, injected from its card
const PART_FAULTS = {
  fan: ['bird'], hpc: ['fod'], hpt: ['hpt'], hpccase: ['vsv'], lpccase: ['b25'], ign: ['ignA', 'ignB'], eec: ['epr'], ext: ['accstuck'], liner: ['flame'], bearings: ['seal4'],
  starter: ['lowair', 'startv'], sav: ['svopen', 'startv'], oiltank: ['oilleak'], oilpump: ['oilpump', 'oilfilter'],
};
// The card collapses to one line when its header is clicked. With nothing selected that choice is
// remembered (the help text only needs reading once); picking a part opens it to show the details.
let hintCollapsed = false; try { hintCollapsed = localStorage.getItem('v2500.cardCollapsed') === '1'; } catch (e) { /* ignore */ }
const setCardCollapsed = (on) => { $('partcard').classList.toggle('collapsed', on); $('pcHead').setAttribute('aria-expanded', !on); };
const toggleCard = () => {
  const on = !$('partcard').classList.contains('collapsed'); setCardCollapsed(on);
  if (!selPart) { hintCollapsed = on; try { localStorage.setItem('v2500.cardCollapsed', on ? '1' : '0'); } catch (e) { /* ignore */ } }
};
$('pcHead').onclick = toggleCard;
$('pcHead').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(); } };
function showPart(p) {
  selPart = p; $('partcard').classList.toggle('empty', !p); setCardCollapsed(p ? false : hintCollapsed);
  $('pcCtl').replaceChildren();
  if (p) for (const k of PART_CTL[p.id] || []) if (D[k]) addRow($('pcCtl'), D[k]);
  for (const f of FAULTS) f.cardBtn = null;
  if (p) for (const id of PART_FAULTS[p.id] || []) {
    const f = FAULTS.find((x) => x.id === id); if (!f) continue;
    const el = document.createElement('div'); el.className = 'fault'; el.innerHTML = `<b>${f.name}</b><button></button>`;
    f.cardBtn = el.querySelector('button'); f.cardBtn.onclick = () => toggleFault(f); el.title = f.desc; $('pcCtl').appendChild(el);
  }
  refreshFaults();
  $('pcName').textContent = p ? p.name : 'Nothing selected';
  $('pcDesc').textContent = p ? p.desc : HINT;
  $('pcRemove').hidden = !p;
  $('pcLive').textContent = p ? p.live(eng.out, fadec) : '';
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
const FAIL = {
  'hpt-blade-release': 'HP TURBINE BLADE FAILURE - creep rupture; fragments through the LP turbine',
  'hpt-melting': 'HP TURBINE MELTING - blades and guide vanes burning away',
  'lpt-blade-release': 'LP TURBINE BLADE FAILURE - creep rupture',
  'lpt-melting': 'LP TURBINE MELTING',
  'combustor-burn-through': 'COMBUSTOR BURN-THROUGH - flame escaping the core. ENGINE FIRE',
  'disc-burst-hp': 'HP ROTOR BURST - uncontained failure. ENGINE DESTROYED',
  'disc-burst-lp': 'LP ROTOR BURST - uncontained failure. ENGINE DESTROYED',
  'hpc-blade-damage': 'HP compressor blades damaged by repeated surging',
  'hpc-blade-failure': 'HP COMPRESSOR BLADE FAILURE - debris through the core',
  'tip-rub-shutdown': 'Tip rub: fuel cut at high power, casings shrank onto the hot rotors',
  'chip-detector': 'Metal on the master chip detector - a main bearing is breaking up',
  'bearing-failure': 'MAIN BEARING FAILURE - HP rotor seized. ENGINE DESTROYED',
  'bowed-rotor-rub': 'BOWED ROTOR - hot engine restarted without motoring; blades rubbing',
};
const EV = { ...FAIL, lightoff: 'Light-off', 'flameout-lean': 'FLAME-OUT (mixture too lean)', 'flameout-rich': 'FLAME-OUT (rich / no airflow)', 'surge-fan': 'FAN SURGE', 'surge-lpc': 'LPC SURGE', 'surge-hpc': 'HPC SURGE' };
let lastBang = -1, lastSurgeLog = -10, sparkK = 0, lostPrev = 0;
function handleEvents(dt) {
  for (; evIdx < eng.events.length; evIdx++) {
    const ev = eng.events[evIdx];
    if (ev.type.startsWith('surge')) {
      if (ev.t - lastBang > 0.08) { const w = ev.type.slice(6); view2d.surge(w); view3d && view3d.surge(w); audio.bang(w === 'fan' ? 1.3 : 1); lastBang = ev.t; }
      if (ev.t - lastSurgeLog > 1) { logMsg(EV[ev.type]); lastSurgeLog = ev.t; }
    } else {
      logMsg(EV[ev.type] || ev.type);
      if (FAIL[ev.type]) {
        const big = /burst|release|failure|burn-through/.test(ev.type) && ev.type !== 'chip-detector';
        if (big) { audio.bang(/burst/.test(ev.type) ? 2 : 1.4); view3d && view3d.surge(/lp|fan/.test(ev.type) ? 'fan' : 'hpc'); view2d.surge('hpc'); }
        if (/release|melting|burst|failure/.test(ev.type)) sparkK = 1;
      }
    }
  }
  if (eng.events.length > 2000) { eng.events.length = 0; evIdx = 0; fadec._evIdx = 0; }
  const o = eng.out, egt = o.egt - 273.15, red = RATINGS[fadec.rating].egtTO;
  peaks.egt = Math.max(peaks.egt, egt); peaks.n1 = Math.max(peaks.n1, o.N1pct); peaks.n2 = Math.max(peaks.n2, o.N2pct);
  // over-temperature burns turbine life: HPT efficiency is permanently lost
  if (egt > red) {
    if (overTemp === 0) logMsg('EGT OVER LIMIT - turbine life being used up');
    overTemp += dt;
  } else overTemp = 0;
  // failure visuals follow the damage state
  const dm = eng.damage.d, losing = dm.hptLost + dm.lptLost > lostPrev + 1e-5; lostPrev = dm.hptLost + dm.lptLost;
  sparkK = Math.max(losing && o.N2pct > 5 ? 0.8 : 0, sparkK - dt * 0.35);
  if (view3d) Object.assign(view3d.fail, { sparks: sparkK, fire: dm.fire, smoke: Math.max(dm.fire, o.oilSmoke ? 0.45 : 0, o.W9 > 3 ? Math.min(1, 2 * (dm.hptLost + dm.lptLost) + (o.torch > 0.01 ? 0.5 : 0)) : 0) });
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
    ['Oil pressure / temperature / quantity', `${o.oilP.toFixed(0)} psi / ${o.oilT.toFixed(0)} °C / ${o.oilQ.toFixed(1)} qt`], ['Oil filter differential', `${o.oilFilterDp.toFixed(1)} psi`],
    ['Turbine metal', `${C(o.Tm)} °C`], ['HPT / LPT blade metal', `${C(o.TbH)} / ${C(o.TbL)} °C`], ['Vibration N1 / N2', `${o.vib1.toFixed(1)} / ${o.vib2.toFixed(1)} units`],
    ['Creep life used HPT / LPT', `${(100 * eng.damage.d.hptCreep).toFixed(1)} / ${(100 * eng.damage.d.lptCreep).toFixed(1)} %`], ['Blading lost HPT / LPT', `${(100 * eng.damage.d.hptLost).toFixed(0)} / ${(100 * eng.damage.d.lptLost).toFixed(0)} %`], ['N1 / N2', `${o.N1.toFixed(0)} / ${o.N2.toFixed(0)} rpm`],
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
  const dm = eng.damage.d;
  if (o.fire) add('ENGINE FIRE', 'bad');
  if (o.oilLowP) add('OIL LO PR - shut the engine down', 'bad'); else if (o.N2pct > 20 && o.oilP < 80) add(`Oil pressure ${o.oilP.toFixed(0)} psi`, 'warn'); else if (o.oilP > 390) add(`Oil pressure high ${o.oilP.toFixed(0)} psi`, 'warn');
  if (o.oilT >= 165) add(`OIL HI TEMP ${o.oilT.toFixed(0)} °C`, 'bad'); else if (o.oilT > 157) add(`Oil temperature ${o.oilT.toFixed(0)} °C`, 'warn');
  if (o.oilQ < 5 && o.N2pct > 20) add(`Oil quantity ${o.oilQ.toFixed(1)} qt`, o.oilQ < 2.5 ? 'bad' : 'warn');
  if (o.oilFilterDp > 12) add('Oil filter clogged', 'warn');
  if (o.oilChips) add('Chip detector: metal in the oil', 'bad');
  if (dm.burst) add('Rotor burst - engine destroyed', 'bad'); else if (dm.hptLost > 0.01 || dm.lptLost > 0.01) add(`Turbine damage ${(100 * Math.max(dm.hptLost, dm.lptLost)).toFixed(0)} %`, 'bad');
  else if (dm.hptCreep > 0.2 || dm.lptCreep > 0.2) add(`Turbine creep life ${(100 * Math.max(dm.hptCreep, dm.lptCreep)).toFixed(0)} % used`, 'warn');
  if (dm.hpc > 0.3) add('Compressor blade damage', 'bad');
  if (o.accH > 0.05 || o.accL > 0.05) add(`Clearance control ${(100 * Math.max(o.accH, o.accL)).toFixed(0)} %`, 'ok');
  if (o.torch > 0.004) add('Torching - fuel burning in the turbine', 'bad');
  if (o.vib1 > 4 || o.vib2 > 4) add(`High vibration N1 ${o.vib1.toFixed(1)} / N2 ${o.vib2.toFixed(1)}`, o.vib1 > 6 || o.vib2 > 6 ? 'bad' : 'warn');
  if (dm.bow > 0.25 && o.N2pct < 20) add(`Rotor bow ${(dm.bow * 100).toFixed(0)} % - motor before starting`, 'warn');
  for (const m of fadec.ecam) add(`${m.title} · ${m.line}`, 'warn');
  if (fadec.msg && !fadec.ecam.length) add(fadec.msg[0] + fadec.msg.slice(1).toLowerCase(), /ABORT|STALL|FLAME|HUNG|CHECK|PURGE|SET MODE/.test(fadec.msg) ? 'warn' : 'ok');
  if (o.ignOn && fadec.ignSel) add(`Igniter ${fadec.ignSel}`, 'ok');
  add(o.lit ? 'Flame on' : 'No flame', o.lit ? 'ok' : '');
  if (o.rev > 0.01) add(o.rev > 0.99 ? 'Reverser deployed' : 'Reverser in transit', 'warn');
  if (o.tStart > 0) add('Starter engaged', 'ok');
  if (fadec.master && fadec.limiter) add(`Governing on ${fadec.limiter}`);
  if (Object.values(fadec.ovr).some((v) => v != null)) add('Manual override active', 'warn');
  if (peaks.egt > 1) add(`Peak EGT ${peaks.egt.toFixed(0)} °C`);
  return chips.join('');
}
const PHASE_TEXT = { crank: 'Starting · motoring', lightup: 'Starting · ignition', accel: 'Starting', manual: 'Manual start', wetcrank: 'Wet crank', abort: 'Start aborted · dry crank', aborted: 'Start aborted · master off' };
const stateText = (o) => (!fadec.master ? (o.lit ? 'Running · manual fuel' : fadec.phase === 'crank' ? (fadec._purgeT != null ? 'Dry crank · purging fuel' : 'Dry crank') : o.N2pct > 1 ? 'Spooling down' : 'Cold')
  : fadec.phase === 'run' ? (fadec.revCmd ? 'Running · reverse' : fadec.tla < 0.01 ? 'Running · idle' : 'Running')
  : PHASE_TEXT[fadec.phase] || (fadec.mode === 'norm' ? 'Master on · select IGN/START' : 'Starting'));

// ------------------------------------------------------------ main loop
const DT = 1 / 120;
let last = performance.now(), acc = 0, frame = 0;
function tick(now) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    acc += real * speed;
    let n = 0;
    // the reverser is pinned (deactivated) while the C-ducts are open, as for maintenance on the aircraft
    const lock = !!(view3d && view3d.cowl && view3d.cowl.cd > 0.01);
    if (lock !== fadec.revLockout) { fadec.revLockout = lock; if (lock && (fadec.revCmd || eng.u.reverser)) logMsg('Reverser deactivated while the C-ducts are open'); }
    while (acc >= DT && n < 160) { slewAmbient(DT); fadec.update(DT); eng.step(DT); handleEvents(DT); acc -= DT; n++; if (n % 12 === 0) pushTrend(eng.out); }
    if (n >= 160) acc = 0;
  }
  const o = eng.out, vdt = paused ? 0 : real * Math.min(speed, 2), w = inletWeather(o);
  if (mode === '3d') view3d.update(o, vdt, w); else view2d.draw(o, vdt);
  const ob = view3d && mode === '3d' ? view3d.orbit : null;
  audio.update(o, real, ob ? { front: Math.min(1, Math.max(0, 0.5 - 0.6 * Math.sin(ob.az) * Math.cos(ob.el))), near: Math.min(1.4, Math.max(0.55, 8 / (ob.dist + 2))) } : { front: 0.5, near: 1 });
  drawEcam($('ecam'), o, fadec, peaks, RATINGS[fadec.rating].egtTO);
  if (frame++ % 3 === 0) {
    refreshRows();
    $('clock').textContent = stamp();
    if (selPart) $('pcLive').textContent = selPart.live(o, fadec);
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
// Authored models replace generated components: the project's own (app/models, built by
// tools/blender/build_engine.py), then an optional local override (app/assets, see docs/MODEL.md).
async function loadModels() {
  const taken = [];
  const pill = $('loading'); let shown = false;
  view3d.onModelProgress = (f) => { if (!shown) { pill.hidden = false; shown = true; } pill.classList.toggle('indet', f == null); if (f != null) pill.style.setProperty('--p', `${Math.round(f * 100)}%`); };
  for (const dir of ['models/', 'assets/']) {
    try { const r = await fetch(dir + 'model.json' + assetQuery, { cache: 'no-cache' }); if (!r.ok) continue; const man = await r.json(); man.file += assetQuery; taken.push(...(await view3d.loadExternalModel(dir, man))); } catch (e) { console.warn('model load failed', dir, e); }
  }
  pill.hidden = true;
  window.sim.externalParts = taken;
  if (taken.length) logMsg(`Authored model loaded: ${taken.join(', ')}`);
}
if (view3d) loadModels();
setMode(mode);
logMsg('Cold and dark. Set ENG MASTER to ON for an automatic start.');
if (view3d) { try { const gl = view3d.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); logMsg(`Graphics: ${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'}`); } catch (e) { /* ignore */ } }
requestAnimationFrame(tick);
window.__sim = { eng, fadec, view3d }; // for the console and automated checks
