// Game shell: owns the simulation loop and wires UI <-> sim <-> views.
import { Engine, defaultMods } from '../src/sim/engine.js';
import { Fadec, TRA } from '../src/sim/fadec.js';
import { RATINGS } from '../src/sim/v2500.js';
import { FAILURES, FAIL_GROUPS } from '../src/sim/failures.js';
import { Apron, APRON, OBJECTS } from '../src/sim/ground.js';
import { Cutaway } from './cutaway.js';
import { Scene3D } from './scene3d.js';
import { ngvBurnAt } from './damage3d.js';
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
window.sim = { eng, fadec, view3d, setLever: (d) => setLever(d) }; window.simAudio = audio; // handy from the dev console (F12)

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
  return { M, Ts, V, Td, fog, vortex, rh: eng.u.rh };   // (rh: how visible the reverser's efflux is)
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

// ------------------------------------------------------------ apron: the engine on its A320, and things for it to swallow or blow away
const apronSim = new Apron(); if (view3d) view3d.apronSim = apronSim;
let apronOn = false, placeKind = null, apronCutWas = false;
const apr = $('t-apr');
apr.innerHTML = `<div class="presets"><button id="aprOn">Show the aircraft on the apron</button></div>
  <div class="aprchk"><label><input type="checkbox" id="aprDanger" checked> Danger areas</label><label><input type="checkbox" id="aprFlow" checked> Air moving over the ground</label></div>
  <h4>Put something near the engine</h4>
  <div class="aprwhere"><select id="aprWhere"><option value="click">Click on the ground to place it</option><option value="front">2 m in front of the intake</option><option value="under">On the ground under the intake</option><option value="side">Beside the intake, 3 m out</option><option value="aft">10 m behind the nozzle</option><option value="far">30 m behind the nozzle</option></select></div>
  <div class="presets" id="aprObjs"></div>
  <div class="presets"><button id="aprClear">Clear them all</button></div>
  <div id="aprList" class="aprlist"></div>
  <p class="note">The intake draws its air from all round, and a vortex forms between it and the ground when the engine runs standing still: it sweeps debris together and lifts it. Birds fly at their own speed and turn away from strong air; one that cannot out-fly the intake goes in. Damage depends on what goes in and how hard the fan hits it: a pigeon at idle does nothing, a goose or a traffic cone at take-off bends fan blades and can break one off, a bolt into the core breaks compressor blades. Behind the engine the jet knocks things over and blows them away. The danger areas are worked out from the same air flow; the dashed line is the published Airbus area.</p>`;
const aprObjs = $('aprObjs');
for (const [k, d] of Object.entries(OBJECTS)) {
  const b = document.createElement('button'); b.textContent = d.name; b.dataset.k = k;
  b.onclick = () => placeObject(k, b);
  aprObjs.appendChild(b);
}
function spot(where) {
  const j = (a) => (Math.random() - 0.5) * a, xi = APRON.inletX, xn = APRON.nozzleX;
  return { front: [xi - 2 + j(0.4), j(1)], under: [xi + 0.2 + j(0.6), j(0.6)], side: [xi - 0.5 + j(0.6), 3 + j(0.6)], aft: [xn + 10 + j(1), j(1.5)], far: [xn + 30 + j(2), j(3)] }[where];
}
function placeObject(kind, btn) {
  if (!apronOn) { logMsg('Show the aircraft on the apron first (Apron tab)'); return; }
  const where = $('aprWhere').value;
  if (where === 'click') {
    const again = placeKind === kind; placeKind = again ? null : kind;
    for (const c of aprObjs.children) c.classList.toggle('on', c.dataset.k === placeKind);
    view3d.placeHandler = placeKind ? (g) => { apronSim.add(placeKind, g.x, g.z); } : null;
    if (placeKind) logMsg(`Apron: click on the ground to put down a ${OBJECTS[kind].name.toLowerCase()} (click its button again when done)`);
    return;
  }
  const [x, z] = spot(where); apronSim.add(kind, x, z);
}
$('aprWhere').onchange = () => { placeKind = null; view3d.placeHandler = null; for (const c of aprObjs.children) c.classList.remove('on'); };
$('aprClear').onclick = () => apronSim.clear();
$('aprDanger').onchange = (e) => { view3d.apronView.showDanger = e.target.checked; };
$('aprFlow').onchange = (e) => { view3d.apronView.showFlow = e.target.checked; };
async function setApron(on) {
  if (!view3d) return;
  const b = $('aprOn');
  if (on && !view3d.apronView.loaded) {
    b.textContent = 'Loading the aircraft...';
    try { await view3d.apronView.load('models/', assetQuery); } catch (e) { console.warn(e); logMsg('Could not load the aircraft model'); b.textContent = 'Show the aircraft on the apron'; return; }
  }
  apronOn = on; view3d.apronView.setOn(on);
  b.textContent = on ? 'Back to the test cell' : 'Show the aircraft on the apron'; b.classList.toggle('on', on);
  if (on) { if (mode !== '3d') setMode('3d'); apronCutWas = view3d.cutaway; if (view3d.cutaway) $('btnCut').click(); Object.assign(view3d.orbit, { az: -0.95, el: 0.22, dist: 15 }); view3d.orbit.target.set(2.5, -0.6, -1.2); logMsg('Apron: the engine on its A320, nose-in on stand 24'); }
  else { apronSim.clear(); placeKind = null; view3d.placeHandler = null; if (apronCutWas && !view3d.cutaway) $('btnCut').click(); Object.assign(view3d.orbit, { az: -0.72, el: 0.2, dist: 10.4 }); view3d.orbit.target.set(1.65, -0.05, 0); }
}
$('aprOn').onclick = () => setApron(!apronOn);
const STATE_WORD = { rest: 'lying still', slide: 'sliding', flying: 'in the air', ingested: 'ingested', gone: 'gone' };
function refreshApronList() {
  const rows = apronSim.objs.slice(-14).reverse().map((o) => {
    const st = o.d.fly && o.state === 'flying' ? (o.panic > 0.5 ? 'flying away from the engine' : 'flying') : o.state === 'rest' && !o.upright && o.d.h ? 'knocked over' : STATE_WORD[o.state];
    const d = Math.hypot(o.x - APRON.inletX, o.y, o.z), db = o.x - APRON.nozzleX;
    const where = o.state === 'ingested' || o.state === 'gone' ? '' : db > 0 ? ` · ${db.toFixed(1)} m behind the nozzle` : ` · ${d.toFixed(1)} m from the intake`;
    return `<div class="${o.state === 'ingested' ? 'bad' : ''}">${o.d.name}: ${st}${where}</div>`;
  });
  $('aprList').innerHTML = rows.join('') || '<div class="dim">Nothing on the ground yet.</div>';
}

// ------------------------------------------------------------ borescope inspection (app/borescope.js)
const bsTab = $('t-bs'), bsOver = $('bscope');
const PORT_GROUPS = [['Fan', /^fan$/], ['Booster', /^lpc/], ['HP compressor', /^hpc/], ['Combustor', /^comb/], ['HP turbine', /^hpt/], ['LP turbine', /^lpt/]];
const portLabel = (p) => (p.id === 'fan' ? 'From the intake' : p.id === 'lpc1' ? 'Stage 1, through the core inlet' : p.id.replace(/^hpc(\d+)/, 'Stage $1').replace(/^hpt1b$/, 'Stage 1, second port').replace(/^hpt(\d)$/, 'Stage $1').replace(/^lpt(\d)$/, 'Stage $1').replace(/^comb(\d)$/, 'Port $1'));
function bsBuild() {
  if (!view3d) { bsTab.innerHTML = '<p class="note">The borescope needs the 3D view.</p>'; return; }
  const ports = view3d.borescope.ports();
  bsTab.innerHTML = '<div class="presets" id="bsTabExit" hidden><button class="on" style="background:rgba(150,28,20,.9);color:#fff">Exit borescope</button></div><p class="note" style="margin-top:2px">Pick a port to put the borescope in. Drag to steer the tip, scroll or pinch to push it in or out, and turn the spool a blade at a time with the buttons. Shut the engine down first: a turning spool just blurs past.</p>'
    + PORT_GROUPS.map(([g, re]) => { const ps = ports.filter((p) => re.test(p.id)); return ps.length ? `<h4>${g}</h4><div class="presets">${ps.map((p) => `<button data-port="${p.id}" title="${p.sees}">${portLabel(p)}</button>`).join('')}</div>` : ''; }).join('')
    + '<h4>Damage recorded</h4><p class="note" style="margin:2px 0 4px">Press <b>Look</b> to put the probe in the right port and turn the spool round to that blade.</p><div id="bsDamage" class="aprlist"></div>';
  for (const b of bsTab.querySelectorAll('button[data-port]')) b.onclick = () => bsEnter(ports.find((p) => p.id === b.dataset.port));
  $('bsTabExit').querySelector('button').onclick = () => bsLeave();
  $('bsDamage').onclick = (e) => { const b = e.target.closest('button[data-go]'); if (b) { const [k, i, sp] = b.dataset.go.split(':'); bsGo(k, +i, +sp); } };
}
// the port and row for each kind of damage the list shows
const BS_GO = { fan: ['fan', 'ring_fan_blade'], lpc: ['lpc1', 'ring_lpc_r1'], hpc: ['hpc3', 'ring_hpc_r3'], ngv: ['hpt1', 'ring_hptcase_ngv1'], hpt: ['hpt1', 'ring_hpt_r1'] };
function bsGo(kind, i, span) {
  const B = view3d.borescope, [pid, node] = BS_GO[kind], port = B.ports().find((p) => p.id === pid), im = view3d.engine.getObjectByName(node);
  if (!port || !im) return;
  if (kind === 'ngv') { const ths = im.userData.ths; i = ths.reduce((a, th, k) => (ngvBurnAt(th, 1) > ngvBurnAt(ths[a], 1) ? k : a), 0); }
  if (!B.on || B.port !== port) bsEnter(port);
  B.aim(im, i, span);
}
function bsEnter(port) {
  if (!view3d || !port) return;
  if (mode !== '3d') setMode('3d');
  if (eng.out.N2pct > 2 || eng.out.N1pct > 2) logMsg('Borescope: the engine is turning. Inspections are done with it shut down; the blades will blur past.');
  const was = view3d.borescope.on;
  view3d.borescope.enter(port); bsOver.hidden = false; document.body.classList.add('bs-on');
  // on tablets and phones the panel would cover the view: close it; and let Back (Android, browser) leave
  if (COMPACT.matches && !$('drawer').classList.contains('shut')) { $('drawer').classList.add('shut'); $('btnDrawer').classList.remove('on'); bsDrawerShut = true; }
  if (!was) { try { history.pushState({ borescope: true }, ''); } catch (e) { /* no history (file://) */ } }
  frame3d(); bsRefresh();
  logMsg(`Borescope in: ${port.sees}. Exit with the button at the top, Esc or Back.`);
}
let bsDrawerShut = false;
function bsLeave(fromHistory = false) {
  if (!view3d || !view3d.borescope.on) return;
  view3d.borescope.exit(); bsOver.hidden = true; document.body.classList.remove('bs-on');
  if (bsDrawerShut) { $('drawer').classList.remove('shut'); $('btnDrawer').classList.add('on'); bsDrawerShut = false; }
  if (!fromHistory && history.state && history.state.borescope) { try { history.back(); } catch (e) { /* ignore */ } }
  frame3d(); bsRefresh();
}
$('bsLeave').onclick = () => bsLeave(); $('bsExit').onclick = () => bsLeave();
addEventListener('popstate', () => { if (view3d && view3d.borescope.on) bsLeave(true); });
for (const b of bsOver.querySelectorAll('button[data-n]')) b.onclick = () => view3d.borescope.stepBlade(+b.dataset.n);
function bsRefresh() {
  if (!view3d) return;
  const B = view3d.borescope;
  const te = $('bsTabExit'); if (te) te.hidden = !B.on;
  if (B.on) {
    const i = B.info, p = B.port, turning = eng.out.N2pct > 2 || eng.out.N1pct > 2;
    $('bsInfo').innerHTML = `<b>${p.part === 'fan' ? 'FAN' : p.id.toUpperCase()}</b> · ${p.sees}<br>${i.what ? `${i.what}${i.damage ? ` — <span class="bad">${i.damage}</span>` : ' — no damage seen'}` : '<span class="dim">aim at a blade or vane</span>'}${i.blade ? `<br><span class="dim">${i.blade}</span>` : ''}${turning ? '<br><span class="bad">Engine turning</span>' : ''}`;
  }
  const el = $('bsDamage'); if (!el) return;
  const f = eng.fail, dm = eng.damage.d, rows = [], meta = view3d.ringsMeta || [];
  const count = (node) => (meta.find((r) => r.node === node) || { count: 1 }).count;
  const words = { dent: 'dented leading edge', nick: 'nicked leading edge', bend: 'tip curled back', tear: 'tip corner torn off' };
  const look = (k, i, sp) => ` <button class="go" data-go="${k}:${i}:${sp.toFixed(2)}">Look</button>`;
  for (const [id, node, name] of [['fan', 'ring_fan_blade', 'Fan blade'], ['lpc', 'ring_lpc_r1', 'Booster stage 1 blade'], ['hpc', 'ring_hpc_r3', 'HP compressor stage 3 blade']]) {
    const n = count(node);
    const gone = new Set(f.missing[id].map((m) => Math.floor(m * n) % n));   // a blade that broke off is listed as missing instead
    for (const r of f.dmg[id]) { const i = Math.floor(r.f * n) % n; if (gone.has(i)) continue; rows.push(`${name} ${i + 1}: ${words[r.type]} (${r.sev > 0.66 ? 'severe' : r.sev > 0.33 ? 'moderate' : 'light'}), ${Math.round(r.span * 100)} % of the span${look(id, i, r.span)}`); }
    for (const m of f.missing[id]) { const i = Math.floor(m * n) % n; rows.push(`<span class="bad">${name} ${i + 1}: missing</span>${look(id, i, 0.5)}`); }
  }
  if (dm.ngvBurn > 0.05) rows.push(`<span class="bad">HP turbine stage 1 guide vanes behind fuel nozzle 13: ${dm.ngvBurn > 0.6 ? 'trailing edges burnt away' : dm.ngvBurn > 0.3 ? 'coating gone, trailing edges burning' : 'coating discoloured'}</span>${look('ngv', 0, 0.5)}`);
  if (dm.TbHmax > 1250) rows.push(`HP turbine blades overheated (metal reached ${(dm.TbHmax - 273).toFixed(0)} °C): heat discolouration${look('hpt', 0, 0.6)}`);
  if (dm.hptLost > 0.001) rows.push(`<span class="bad">HP turbine blading lost: ${(dm.hptLost * 100).toFixed(0)} %</span>`);
  if (dm.lptLost > 0.001) rows.push(`<span class="bad">LP turbine blading lost: ${(dm.lptLost * 100).toFixed(0)} %</span>`);
  const html = rows.map((r) => `<div>${r}</div>`).join('') || '<span class="dim">Nothing recorded: a clean engine.</span>';
  if (el._h !== html) { el.innerHTML = html; el._h = html; }   // rewritten only when it changes, so the buttons can be pressed
}
bsBuild();

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
$('hwReset').onclick = () => { resetRows(hw); Object.assign(m, defaultMods()); eng.damage.reset(); eng.fail.reset(); view3d && view3d.resetFailures(); for (const f of FAULTS) if (f.active && f.mods) { f.active = false; } refreshFaults(); logMsg('Hardware restored to new condition: damage repaired, broken parts replaced'); };

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
// Part failures (src/sim/failures.js): break a blade, shear a shaft, jam a valve, cut a pipe. Momentary ones
// (a blade letting go) are triggered; the rest are injected and cleared, clearing meaning the part is replaced.
const PFAIL = FAILURES.map((fl) => ({ ...fl, sim: true, once: fl.once ? true : null }));
const ALLF = [...FAULTS, ...PFAIL];
const isOn = (f) => (f.sim ? eng.fail.isOn(f.id) : !!f.active);
const countOf = (f) => (f.sim ? eng.fail.count[f.id] || 0 : 0);
function refreshFaults() {
  for (const f of ALLF) for (const b of [f.btn, f.cardBtn]) if (b) {
    const on = isOn(f), n = countOf(f);
    b.classList.toggle('on', on || n > 0); b.textContent = f.once ? (n ? `Again (${n})` : 'Trigger') : on ? 'Clear' : 'Inject';
  }
  if (view3d) view3d.setFailedParts([...PFAIL.filter((f) => isOn(f) || countOf(f)).flatMap((f) => f.parts.slice(0, 1)), ...Object.entries(PART_FAULTS).filter(([, ids]) => ids.some((id) => FAULTS.find((x) => x.id === id && x.active && !x.once))).map(([p]) => p)]);
  const n = eng.fail.active + FAULTS.filter((f) => f.active).length;
  $('fltCount').textContent = n ? `${n} active` : '';
}
function toggleFault(f) {
  if (f.sim) {
    if (f.once) { eng.fail.set(f.id, true); logMsg(`Failure: ${f.name}`); }
    else { const on = !eng.fail.isOn(f.id); eng.fail.set(f.id, on); logMsg(on ? `Failure injected: ${f.name}` : `Repaired: ${f.name}`); }
    refreshFaults(); return;
  }
  if (f.once) { f.once(); logMsg(`Fault: ${f.name}`); return; }
  f.active = !f.active;
  if (f.mods) applyMods(f.mods, !f.active); else (f.active ? f.on : f.off)();
  if (f.active && f.bang) eng.events.push({ t: eng.s.t, type: f.bang });
  logMsg(`Fault ${f.active ? 'injected' : 'cleared'}: ${f.name}`); refreshFaults();
}
const flt = $('t-flt');
flt.innerHTML = '<div class="fhead"><input type="search" id="fltFind" placeholder="Find a failure or a part" aria-label="Find a failure or a part"><span id="fltCount"></span><button id="fltClear">Repair all</button></div>';
const faultRow = (f, parent) => {
  const el = document.createElement('div'); el.className = 'fault'; el.innerHTML = `<b></b><button></button><span></span>`;
  el.querySelector('b').textContent = f.name; el.querySelector('span').textContent = f.desc; parent.appendChild(el);
  f.btn = el.querySelector('button'); f.btn.onclick = () => toggleFault(f); f.row = el;
  if (f.sim && view3d) { const b = el.querySelector('b'); b.classList.add('link'); b.title = 'Show this part'; b.onclick = () => { const p = view3d.byId[f.parts[0]]; if (p) { view3d.selected = p; showPart(p); } }; }
  return el;
};
const fgroup = (title, items, open) => {
  const d = document.createElement('details'); d.className = 'fgroup'; d.open = !!open;
  d.innerHTML = `<summary>${esc(title)} <i>${items.length}</i></summary>`; flt.appendChild(d);
  for (const f of items) faultRow(f, d);
  return d;
};
const fGroups = [fgroup('Whole-engine faults', FAULTS, true), ...FAIL_GROUPS.map(([g, title]) => fgroup(title, PFAIL.filter((f) => f.group === g), false))];
flt.insertAdjacentHTML('beforeend', '<p class="note">Every part can fail: pick one on the engine to see its own failures on its card. Faults stack with Hardware and Control settings. Broken parts pulse red. Repair all, or Restore new-engine condition (Hardware tab), replaces them.</p>');
$('fltFind').oninput = () => {
  const q = $('fltFind').value.trim().toLowerCase();
  for (const f of ALLF) {
    const partNames = f.sim && view3d ? f.parts.map((id) => (view3d.byId[id] || {}).name || '').join(' ') : '';
    f.row.hidden = !!q && !`${f.name} ${f.desc} ${partNames}`.toLowerCase().includes(q);
  }
  for (const d of fGroups) { const any = [...d.querySelectorAll('.fault')].some((r) => !r.hidden); d.hidden = !any; if (q) d.open = any; }
};
$('fltClear').onclick = () => {
  for (const f of FAULTS) if (f.active && !f.once) toggleFault(f);
  eng.fail.reset(); view3d && view3d.resetFailures(); refreshFaults(); logMsg('All part failures repaired');
};

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
const setFirePb = (v, quiet) => { fadec.firePb = v; $('firePb').setAttribute('aria-pressed', v); if (!quiet) logMsg(v ? 'ENG 1 FIRE pushbutton pushed: LP fuel valve shut' : 'ENG 1 FIRE pushbutton reset'); };
$('firePb').onclick = () => setFirePb(!fadec.firePb);
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
// Layout tiers (style.css): desktop, compact (tablets, foldables, small laptops: under 1100 x 700) and phone.
// On compact screens and phones the panel slides over the view instead of squeezing it.
const PHONE = matchMedia('(max-height: 560px), (max-width: 760px)'), COMPACT = matchMedia('(max-width: 1099px), (max-height: 699px)'), TOUCH = matchMedia('(pointer: coarse)').matches;
const frame3d = () => {
  const hud = !document.body.classList.contains('hud-off'), shut = $('drawer').classList.contains('shut'); document.body.classList.toggle('nodrawer', shut);
  const dockTop = hud ? $('dock').getBoundingClientRect().top : window.innerHeight, topB = hud ? $('top').getBoundingClientRect().bottom : 0;
  document.documentElement.style.setProperty('--dock-h', `${Math.round(window.innerHeight - dockTop)}px`);
  // the section view draws inside the space the overlays leave free
  view2d.inset = { top: topB + 4, bottom: window.innerHeight - dockTop + 4, left: 0, right: hud && !shut && !COMPACT.matches ? $('drawer').offsetWidth + 32 : 0 };
  if (!view3d) return;
  if (COMPACT.matches) {
    // the panel slides over the view, so the engine stays centred between the top bar and the dock
    view3d.offsetX = 0; view3d.offsetY = hud ? Math.round((window.innerHeight - dockTop - topB) / 2) : 0;
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
  for (const f of FAULTS) if (f.active) { if (f.mods) applyMods(f.mods, true); else if (f.off) f.off(); f.active = false; }
  eng.fail.reset(); view3d && view3d.resetFailures(); setFirePb(false, true); refreshFaults();
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
  else if (e.key === 'Escape') { openReset(false); if (view3d && view3d.borescope.on) bsLeave(); }
});
window.addEventListener('resize', () => { view2d.resize(); frame3d(); });
// phones and tablets: the panel starts shut on small screens, rendering is lighter, and a Full screen button
// (which also turns a phone sideways where the browser allows it) replaces F11
if (COMPACT.matches && !$('drawer').classList.contains('shut')) { $('drawer').classList.add('shut'); $('btnDrawer').classList.remove('on'); }
if (TOUCH && view3d) view3d.maxDpr = 1.5;
new ResizeObserver(() => frame3d()).observe($('dock'));
for (const q of [PHONE, COMPACT]) q.addEventListener('change', () => requestAnimationFrame(() => { view2d.resize(); frame3d(); }));
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
  exciters: ['ign'], vsvact: ['vsv'], fdv: ['fuel'], accvalves: ['accH', 'accL'],
  eec: ['n1mode', 'pEgt', 'pAccel', 'pDecel'], combcase: ['cust'], fan: ['Fan efficiency'], lpc: ['LPC efficiency'], hpc: ['HPC efficiency', 'HPC flow capacity'],
  hpt: ['HPT efficiency', 'Turbine cooling air'], hptcase: ['HPT nozzle area', 'accH'], lpt: ['LPT efficiency'], lptcase: ['LPT nozzle area', 'accL'], ext: ['accH', 'accL'], cna: ['Final nozzle area', 'Bypass mixer area'], tec: ['Core mixer area'],
};
// faults that belong to each component, injected from its card
const PART_FAULTS = {
  fan: ['bird'], hpc: ['fod'], hpt: ['hpt'], hpccase: ['vsv'], lpccase: ['b25'], ign: ['ignA', 'ignB'], eec: ['epr'], ext: ['accstuck'], liner: ['flame'], bearings: ['seal4'],
  starter: ['lowair', 'startv'], sav: ['svopen', 'startv'], oiltank: ['oilleak'], oilpump: ['oilpump', 'oilfilter'],
  exciters: ['ignA', 'ignB'], vsvact: ['vsv'], accvalves: ['accstuck'], line_acocoil: ['acoc'], line_htleadA: ['ignA'], line_htleadB: ['ignB'],
};
refreshFaults();
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
  for (const f of ALLF) f.cardBtn = null;
  const mine = p ? [...(PART_FAULTS[p.id] || []).map((id) => FAULTS.find((x) => x.id === id)).filter(Boolean), ...PFAIL.filter((f) => f.parts.includes(p.id))] : [];
  if (mine.length) $('pcCtl').insertAdjacentHTML('beforeend', '<h4>Failures</h4>');
  for (const f of mine) {
    const el = document.createElement('div'); el.className = 'fault'; el.innerHTML = '<b></b><button></button>';
    el.querySelector('b').textContent = f.name;
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
  $('removedWrap').hidden = gone.length === 0; $('partcard').classList.toggle('has-removed', gone.length > 0);
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
  // part failures (failures.js)
  'fan-blade-off': 'FAN BLADE RELEASE - contained by the fan case; rotor badly out of balance',
  'fan-crack-release': 'FAN BLADE RELEASE - the cracked blade let go',
  'spinner-lost': 'Spinner fairing broke up and went through the fan',
  'liner-ingested': 'Inlet acoustic panel ingested by the fan',
  'lpc-blade-release': 'BOOSTER BLADE RELEASE - debris through the LP compressor',
  'hpc-blade-release': 'HP COMPRESSOR BLADE RELEASE - stages behind it damaged',
  'lp-shaft-shear': 'LP SHAFT FAILURE - fan running down, LP turbine racing',
  'hp-shaft-shear': 'HP SHAFT FAILURE - compressor running down, HP turbine racing',
  'lp-bearing-seized': 'FAN BEARING SEIZED - fan stopped dead',
  'case-burn-through': 'TURBINE CASE BURN-THROUGH - flame cutting into the core compartment',
  'tower-shaft-shear': 'TOWER SHAFT SHEARED - gearbox stopped: no fuel pump, oil pump, generator or hydraulics',
  'starter-burst': 'STARTER DISINTEGRATED - back-driven through its seized clutch; gearbox holed, oil pouring out',
  'starter-failure': 'STARTER FAILED',
  'idg-overheat': 'IDG overheated with no oil - disconnected',
  'fuel-fire': 'ENGINE FIRE - fuel burning in the nacelle',
  'oil-fire': 'ENGINE FIRE - oil burning on the hot core',
  'fire-harness': 'Fire has burnt through a core harness - EEC channel lost',
  'fan-cowl-lost': 'FAN COWL DOORS TORN OFF by the airflow',
  'engine-separation': 'ENGINE SEPARATED FROM THE PYLON',
  'bird-strike': 'BIRD STRIKE',
  'fod-ingested': 'OBJECT INGESTED by the engine',
};
const EV = { ...FAIL, lightoff: 'Light-off', 'flameout-lean': 'FLAME-OUT (mixture too lean)', 'flameout-rich': 'FLAME-OUT (rich / no airflow)', 'surge-fan': 'FAN SURGE', 'surge-lpc': 'LPC SURGE', 'surge-hpc': 'HPC SURGE' };
let lastBang = -1, lastSurgeLog = -10, sparkK = 0, lostPrev = 0, failSig = '';
function handleEvents(dt) {
  for (; evIdx < eng.events.length; evIdx++) {
    const ev = eng.events[evIdx];
    if (ev.type.startsWith('surge')) {
      if (ev.t - lastBang > 0.08) { const w = ev.type.slice(6); view2d.surge(w); view3d && view3d.surge(w); audio.bang(w === 'fan' ? 1.3 : 1); lastBang = ev.t; }
      if (ev.t - lastSurgeLog > 1) { logMsg(EV[ev.type]); lastSurgeLog = ev.t; }
    } else {
      logMsg(ev.msg || EV[ev.type] || ev.type);
      if (FAIL[ev.type]) {
        const big = /burst|release|failure|burn-through|blade-off|shear|seized|separation|cowl-lost/.test(ev.type) && ev.type !== 'chip-detector';
        if (big) { audio.bang(/burst|separation/.test(ev.type) ? 2 : 1.4); view3d && view3d.surge(/lp|fan/.test(ev.type) ? 'fan' : 'hpc'); view2d.surge('hpc'); }
        if (/hpt-blade|lpt-blade|melting|burst|hpc-blade-failure|bearing-failure/.test(ev.type)) sparkK = 1;
        if (ev.type === 'bird-strike' || ev.type === 'fod-ingested') audio.bang(ev.blades ? 1.4 : 0.35 + Math.min(0.9, (ev.fan || 0) * 3));
        view3d && view3d.failEvent(ev.type, ev);
        refreshFaults();
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
  if (view3d) {
    Object.assign(view3d.fail, { sparks: sparkK, fire: o.fire, smoke: Math.max(o.fire, o.oilSmoke ? 0.45 * o.oilSmoke : 0, o.W9 > 3 ? Math.min(1, 2 * (dm.hptLost + dm.lptLost) + (o.torch > 0.01 ? 0.5 : 0)) : 0) });
    const fl = eng.fail; view3d.failState = { missing: fl.missing, dmg: fl.dmg, hpt: dm.hptLost, lpt: dm.lptLost, ngvBurn: dm.ngvBurn, hotH: dm.TbHmax, hotL: dm.TbLmax, leaks: fl.leaks, firePart: fl.firePart };
  }
  // failures can change by themselves (a crack becomes a released blade): keep the buttons honest
  const sig = Object.keys(eng.fail.on).join() + JSON.stringify(eng.fail.count);
  if (sig !== failSig) { failSig = sig; refreshFaults(); }
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
    ['Creep life used HPT / LPT', `${(100 * eng.damage.d.hptCreep).toFixed(1)} / ${(100 * eng.damage.d.lptCreep).toFixed(1)} %`], ['Blading lost HPT / LPT', `${(100 * eng.damage.d.hptLost).toFixed(0)} / ${(100 * eng.damage.d.lptLost).toFixed(0)} %`], ['N1 / N2', `${o.N1.toFixed(0)} / ${o.N2.toFixed(0)} rpm`], ['LP / HP turbine speed', `${(o.NlptPct || 0).toFixed(0)} / ${(o.NhptPct || 0).toFixed(0)} %`],
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
  if (o.fire > 0.01 && o.fire <= 0.5) add('Fire burning out', 'bad');   // above that the ECAM ENG 1 FIRE warning shows
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
  if ((o.NlptPct || 0) > o.N1pct + 8) add(`LP turbine ${o.NlptPct.toFixed(0)} % - shaft broken`, 'bad');
  if ((o.NhptPct || 0) > o.N2pct + 8) add(`HP turbine ${o.NhptPct.toFixed(0)} % - shaft broken`, 'bad');
  for (const m of fadec.ecam) add(`${m.title} · ${m.line}`, m.level === 'warning' ? 'bad' : 'warn');
  const nf = eng.fail.active; if (nf) add(`${nf} part failure${nf > 1 ? 's' : ''}`, 'bad');
  if (fadec.firePb) add('FIRE P/B pushed · LP valve shut', 'warn');
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
    if (apronOn) { apronSim.setFlow(eng.out); apronSim.step(Math.min(0.05, real * speed), eng); }
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
    if (active.drawer === 'apr' && apronOn) refreshApronList();
    if (active.drawer === 'bs' || (view3d && view3d.borescope.on)) bsRefresh();
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
    try { const r = await fetch(dir + 'model.json' + assetQuery, { cache: 'no-cache' }); if (!r.ok) continue; const man = await r.json(); man.file += assetQuery; if (man.packed) man.packed += assetQuery; taken.push(...(await view3d.loadExternalModel(dir, man))); } catch (e) { console.warn('model load failed', dir, e); }
  }
  pill.hidden = true;
  window.sim.externalParts = taken;
  bsBuild();
  if (taken.length) logMsg(`Authored model loaded: ${taken.join(', ')}`);
}
if (view3d) loadModels();
setMode(mode);
logMsg('Cold and dark. Set ENG MASTER to ON for an automatic start.');
if (view3d) { try { const gl = view3d.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); logMsg(`Graphics: ${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'}`); } catch (e) { /* ignore */ } }
requestAnimationFrame(tick);
window.__sim = { eng, fadec, view3d }; // for the console and automated checks
