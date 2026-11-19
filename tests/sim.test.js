import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, tIsentropic, isa } from '../src/sim/gas.js';
import { Engine } from '../src/sim/engine.js';
import { Fadec, ratedThrustN } from '../src/sim/fadec.js';
import { DESIGN, ICAO_V2527, ICAO } from '../src/sim/v2500.js';

function rig() { const e = new Engine(); const f = new Fadec(e); f.mode = 'ign'; return { e, f }; }
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
  assert.ok(Math.abs(o.bpr - 4.46) < 0.05 && Math.abs(o.opr - 33.44) < 0.3);
  // mass is conserved through the core
  assert.ok(Math.abs(o.W8 - (o.Wlpc + o.wf - o.Wb25 - o.Wb7 - o.Wb10 - o.Wcust)) < 0.05);
  assert.ok(Math.abs(o.W9 - (o.W2 + o.wf)) < 0.1, 'everything leaves through the common nozzle');
});

test('automatic start reaches the published ground idle without exceedances', () => {
  const { e, f } = rig(); f.master = true;
  let peakEgt = 0, tIdle = null;
  run(e, f, 120, (o, t) => { peakEgt = Math.max(peakEgt, o.egt - 273.15); if (tIdle == null && f.phase === 'run') tIdle = t; });
  const o = e.out;
  assert.equal(f.phase, 'run');
  assert.ok(tIdle > 25 && tIdle < 75, `time to idle ${tIdle}`);
  assert.ok(peakEgt < 635, `start EGT ${peakEgt}`);
  // IAE operating instructions: about N1 21.7 %, N2 60 %, EGT 400 C, 300-378 kg/h, with
  // tolerances N1 -2/+3.8, N2 -2/+2.2, EGT -25/+90, FF -50/+125
  assert.ok(o.N1pct > 19.7 && o.N1pct < 25.5, `N1 ${o.N1pct}`);
  assert.ok(o.N2pct > 58 && o.N2pct < 62.2, `N2 ${o.N2pct}`);
  assert.ok(o.egt - 273.15 > 350 && o.egt - 273.15 < 490, `EGT ${o.egt - 273.15}`);
  assert.ok(o.wf * 3600 > 300 && o.wf * 3600 < 460, `FF ${o.wf * 3600}`);
  assert.equal(surges(e), 0);
});

test('V2527-A5 matches the ICAO databank fuel flows and cycle', () => {
  const { e, f } = idling();
  const at = (frac) => { // hold a thrust fraction of the ICAO rated output with manual fuel trim
    const target = frac * ICAO_V2527.ratedN; let wf = e.out.wf;
    f.ovr.bleed25 = null;
    for (let k = 0; k < 60; k++) { wf *= 1 + 0.5 * (target - e.out.thrust) / Math.max(target, e.out.thrust); f.ovr.fuel = wf; run(e, f, 3); }
    assert.ok(Math.abs(e.out.thrust - target) / target < 0.01, `converged ${e.out.thrust}`);
    return e.out;
  };
  const within = (name, got, ref, tol) => assert.ok(Math.abs(got - ref) / ref < tol, `${name}: model ${got.toFixed(3)} vs published ${ref}`);
  within('approach fuel flow', at(0.30).wf, ICAO_V2527.approach, 0.03);
  within('climb-out fuel flow', at(0.85).wf, ICAO_V2527.climb, 0.05);
  const to = at(1.0);
  within('take-off fuel flow', to.wf, ICAO_V2527.takeoff, 0.04);
  within('overall pressure ratio', to.opr, ICAO_V2527.opr, 0.03);
  within('bypass ratio', to.bpr, ICAO_V2527.bpr, 0.03);
  within('idle (7 %) fuel flow', at(0.07).wf, ICAO_V2527.idle, 0.08);
  assert.equal(surges(e), 0);
});

test('every A5 rating matches its ICAO databank entry at take-off', () => {
  const { e, f } = idling(); f.rating = 'V2533-A5'; f.tla = 0.5; run(e, f, 20);
  let wf = e.out.wf;
  for (const [name, ref] of Object.entries(ICAO)) {
    for (let k = 0; k < 50; k++) { wf *= 1 + 0.5 * (ref.ratedN - e.out.thrust) / Math.max(ref.ratedN, e.out.thrust); f.ovr.fuel = wf; run(e, f, 3); }
    const o = e.out, chk = (what, got, want, tol) => assert.ok(Math.abs(got - want) / want < tol, `${name} ${what}: model ${got.toFixed(3)} vs ICAO ${want}`);
    chk('fuel flow', o.wf, ref.takeoff, 0.04); chk('pressure ratio', o.opr, ref.opr, 0.03); chk('bypass ratio', o.bpr, ref.bpr, 0.03);
  }
  assert.equal(surges(e), 0);
});

test('V2527-A5 take-off: certified thrust, EPR, acceleration', () => {
  const { e, f } = idling();
  f.tla = 1;
  let t95 = null, epr50 = null;
  const rated = ratedThrustN('V2527-A5');
  run(e, f, 40, (o, t) => { if (t95 == null && o.thrust > 0.95 * rated) t95 = t; });
  const o = e.out;
  assert.ok(Math.abs(o.thrust - rated) / rated < 0.02, `thrust ${o.thrust} vs ${rated}`);
  assert.ok(o.epr > 1.5 && o.epr < 1.7, `take-off EPR ${o.epr}`); // crew reports ~1.6 max
  assert.ok(o.egt - 273.15 < 635 - 60, 'healthy EGT margin on a new engine at ISA');
  assert.ok(t95 < 8, `accel time ${t95}`);
  assert.equal(surges(e), 0);
  // A320 crews set "50 % N1 (CFM) or 1.05 EPR (IAE)" before releasing the brakes,
  // so 1.05 EPR should sit between a third and a half of fan speed
  f.tla = 0.12; run(e, f, 30);
  let wf = e.out.wf;
  for (let k = 0; k < 40; k++) { wf *= 1 + 8 * (1.05 - e.out.epr); f.ovr.fuel = wf; run(e, f, 3); }
  assert.ok(Math.abs(e.out.epr - 1.05) < 0.003 && e.out.N1pct > 33 && e.out.N1pct < 55, `N1 at 1.05 EPR: ${e.out.N1pct}`);
  f.ovr.fuel = null; f.tla = 0; run(e, f, 30);
  assert.ok(e.out.lit && surges(e) === 0 && e.out.N2pct < 62);
});

test('take-off airflow matches the Airbus training manual: 872 lb/s (V2533), 811 lb/s (V2527)', () => {
  const lbs = (r) => { const { e, f } = idling(); f.rating = r; f.tla = 1; run(e, f, 40); return e.out.W2 / 0.45359237; };
  const a = lbs('V2533-A5'), b = lbs('V2527-A5');
  assert.ok(Math.abs(a - 872) / 872 < 0.01, `V2533 airflow ${a.toFixed(0)} lb/s`);
  assert.ok(Math.abs(b - 811) / 811 < 0.04, `V2527 airflow ${b.toFixed(0)} lb/s`);
});

test('every rating delivers its rated thrust at sea level static', () => {
  for (const r of ['V2522-A5', 'V2524-A5', 'V2530-A5', 'V2533-A5']) {
    const { e, f } = idling(); f.rating = r; f.tla = 1; run(e, f, 40);
    const rated = ratedThrustN(r);
    assert.ok(Math.abs(e.out.thrust - rated) / rated < 0.02, `${r}: ${e.out.thrust} vs ${rated}`);
    assert.ok(e.out.N1pct < 100 && e.out.N2pct < 100 && e.out.egt - 273.15 < 635, r);
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

test('flat rating: thrust held to ISA+31 (V2527) at rising EGT, then lapses', () => {
  const pt = (dT) => { const r = rig(); r.e.u.dTisa = dT; r.f.master = true; run(r.e, r.f, 100); r.f.tla = 1; run(r.e, r.f, 40); return r.e.out; };
  const a = pt(0), b = pt(30), c = pt(40);
  assert.ok(Math.abs(b.thrust - a.thrust) / a.thrust < 0.03, `flat: ${a.thrust} vs ${b.thrust}`);
  assert.ok(b.egt > a.egt + 40, 'EGT margin is consumed as the day gets hotter');
  assert.ok(b.egt - 273.15 < 635, `EGT inside limit at the corner point: ${b.egt - 273.15}`);
  assert.ok(c.thrust < 0.97 * b.thrust, 'thrust lapses beyond the flat-rating temperature');
});

test('thrust reverser: net thrust goes negative, fan stays out of surge, stows cleanly', () => {
  const { e, f } = idling();
  e.u.reverser = true; run(e, f, 5);
  assert.ok(e.out.rev > 0.99, 'deployed');
  f.tla = 1; run(e, f, 25);
  const o = e.out;
  assert.ok(o.thrust < -14e3, `reverse thrust ${o.thrust}`);
  assert.ok(o.N1pct < 82, `fan speed limited in reverse: ${o.N1pct}`);
  assert.ok(o.Wcas > 0.8 * o.Wbypass, 'bypass air leaves through the cascades');
  f.tla = 0; run(e, f, 20); e.u.reverser = false; run(e, f, 10);
  assert.ok(e.out.rev === 0 && e.out.thrust > 0 && e.out.lit);
  assert.equal(surges(e), 0);
});

test('manual start with the master off, hand-over to the FADEC, shut-down and reset', () => {
  const { e, f } = rig();
  f.manStart = true; run(e, f, 25);
  assert.ok(e.out.N2pct > 20 && !e.out.lit, `dry crank N2 ${e.out.N2pct}`);
  f.ovr.ignition = true;
  for (const w of [200, 240, 280, 320, 360, 390]) { f.ovr.fuel = w / 3600; run(e, f, 6); }
  f.manStart = false; f.ovr.ignition = null; run(e, f, 20);
  assert.ok(e.out.lit && e.out.N2pct > 55 && e.out.N2pct < 62, `idling on manual fuel: N2 ${e.out.N2pct}`);
  f.master = true; run(e, f, 2); f.ovr.fuel = null; run(e, f, 20);
  assert.equal(f.phase, 'run');
  assert.equal(surges(e), 0);
  f.master = false; run(e, f, 30);
  assert.ok(!e.out.lit && e.out.N2pct < 15, 'master off shuts the engine down');
  f.master = true; run(e, f, 60); f.manStart = true; f.ovr.fuel = 0.1;
  f.reset(); e.initCold(); run(e, f, 20);
  assert.ok(!e.out.lit && e.out.N2pct < 0.1 && f.phase === 'off' && !e.u.starterValve, 'reset leaves the engine cold and stopped');
});

// ---------------------------------------------------------------- failures
const has = (e, type) => e.events.some((x) => x.type === type);

test('normal operation uses no measurable turbine life and causes no damage', () => {
  const { e, f } = idling(); f.rating = 'V2533-A5'; e.u.dTisa = 15; f.tla = 1; run(e, f, 300);
  const d = e.damage.d;
  assert.ok(d.hptCreep < 0.01 && d.lptCreep < 0.01 && d.hptLost === 0 && d.lptLost === 0 && !d.fire, `creep ${d.hptCreep} ${d.lptCreep}`);
  assert.ok(e.out.vib1 < 2 && e.out.vib2 < 2);
});

test('fuelling a stalled compressor overheats and wrecks the hot section', () => {
  const { e, f } = idling(); f.tla = 0.6; run(e, f, 30);
  f.prot.surge = false; f.ovr.vsv = -8; f.ovr.bleed7 = 0; run(e, f, 3); f.ovr.fuel = e.out.wf * 1.5; run(e, f, 30);
  const d = e.damage.d;
  assert.ok(has(e, 'combustor-burn-through') || has(e, 'hpt-blade-release') || has(e, 'lpt-blade-release') || has(e, 'hpt-melting'), 'hot section failure');
  assert.ok(d.liner > 0.5 || d.hptLost > 0 || d.lptLost > 0);
});

test('overspeed with the protections off bursts a rotor; the engine is finished', () => {
  const { e, f } = idling(); f.tla = 1; run(e, f, 30);
  Object.assign(f.prot, { egt: false, n1: false, n2: false, accel: false }); f.ovr.fuel = 9000 / 3600; run(e, f, 20);
  assert.ok(has(e, 'disc-burst-hp') || has(e, 'disc-burst-lp'), 'rotor burst');
  assert.ok(!e.out.lit && e.wear.dead && e.out.fire === 1 && e.out.N2pct < 1);
  f.ovr.fuel = null; f.master = false; run(e, f, 5); f.master = true; run(e, f, 60);
  assert.ok(!e.out.lit && e.out.N2pct < 1, 'cannot be restarted');
});

test('fuel cut at take-off power rubs the tips; a cool-down at idle first does not', () => {
  const a = idling(); a.f.tla = 1; run(a.e, a.f, 60); a.f.master = false; run(a.e, a.f, 60);
  assert.ok(has(a.e, 'tip-rub-shutdown') && a.e.wear.effHpt < 0);
  assert.ok(a.e.out.N2pct < 2 && a.e.out.egt < 700, 'runs down in under a minute');
  const b = idling(); b.f.tla = 1; run(b.e, b.f, 60); b.f.tla = 0; run(b.e, b.f, 180); b.f.master = false; run(b.e, b.f, 60);
  assert.ok(!has(b.e, 'tip-rub-shutdown') && b.e.wear.effHpt > -1e-6);
});

test('bowed rotor: a hasty manual start of a hot engine rubs; the automatic start motors for 30 s first and does not', () => {
  const hot = () => { const r = idling(); r.f.tla = 1; run(r.e, r.f, 60); r.f.master = false; run(r.e, r.f, 600); return r; };
  const a = hot(); assert.ok(a.e.damage.d.bow > 0.25, `bow ${a.e.damage.d.bow}`);
  a.f.manStart = true; run(a.e, a.f, 6); a.f.ovr.ignition = true;
  for (const w of [220, 280, 340, 400]) { a.f.ovr.fuel = w / 3600; run(a.e, a.f, 4); }
  assert.ok(has(a.e, 'bowed-rotor-rub'), `fuel after only 6 s of cranking: N2 ${a.e.out.N2pct}, bow ${a.e.damage.d.bow}`);
  const b = hot(); b.f.master = true; run(b.e, b.f, 90);
  assert.ok(!has(b.e, 'bowed-rotor-rub') && b.e.out.lit && b.f.phase === 'run');
});

test('oil system: normal pressures and temperatures; an oil leak ends in a seized bearing', () => {
  const { e, f } = rig(); f.master = true;
  run(e, f, 20); assert.ok(e.out.oilP > 100, `cold oil reads high on start: ${e.out.oilP}`);
  run(e, f, 580);
  assert.ok(e.out.oilP > 110 && e.out.oilP < 220 && e.out.oilT > 55 && e.out.oilT < 105 && !e.out.oilLowP, `idle ${e.out.oilP} psi ${e.out.oilT} C`);
  assert.ok(e.out.oilQ > 18 && e.out.oilQ < 22, `tank level with oil in circulation: ${e.out.oilQ}`);
  f.tla = 1; run(e, f, 240);
  assert.ok(e.out.oilP > 200 && e.out.oilP < 320 && e.out.oilT < 140 && e.oil.s.brg === 0, `take-off ${e.out.oilP} psi ${e.out.oilT} C`);
  e.oil.faults.leak = 6; run(e, f, 300);
  assert.ok(has(e, 'chip-detector') && has(e, 'bearing-failure'), 'bearing failed after the oil ran out');
  assert.ok(e.out.N2pct < 1 && !e.out.lit && e.wear.dead);
});

test('oil system: cooler air valve stuck shut overheats the oil at idle, not at take-off', () => {
  const { e, f } = idling(); e.oil.faults.acocStuck = true; f.tla = 1; run(e, f, 400);
  const hot = e.out.oilT; assert.ok(hot < 150, `take-off: fuel cooling is enough (${hot})`);
  f.tla = 0; run(e, f, 2400); // the oil and its metalwork take many minutes to heat up
  assert.ok(e.out.oilT > 150, `idle: oil overheats (${e.out.oilT})`);
});

// ---------------------------------------------------------------- start panel (A320: ENG MODE, MAN START, MASTER)
const auto = (setup) => { const r = rig(); if (setup) setup(r.f, r.e); r.f.master = true; return r; };

test('automatic start alternates igniters; an igniter fault aborts with a dry crank, then MASTER OFF', () => {
  const { e, f } = auto((f) => { f.faults.ignA = true; });
  let fuelOff = null;
  run(e, f, 50, (o, t) => { if (fuelOff == null && f.phase === 'abort') fuelOff = t; });
  assert.equal(f.startFault, 'IGNITION FAULT'); assert.ok(!e.out.lit);
  assert.ok(fuelOff > 44 && fuelOff < 47, `no light 15 s after fuel on: ${fuelOff}`);
  assert.ok(e.u.wfCmd === 0 && !e.u.ignition && e.u.starterValve, 'fuel and ignition off, motoring to clear the fuel');
  run(e, f, 35);
  assert.ok(f.phase === 'aborted' && !e.u.starterValve && f.ecam[0].line.includes('MASTER OFF'));
  f.master = false; run(e, f, 30); assert.ok(!f.startFault && !f.ecam.length, 'MASTER OFF resets the fault');
  f.master = true; run(e, f, 70);
  assert.ok(e.out.lit && f.phase === 'run', 'second start uses igniter B and lights');
});

test('start valve faults: not open aborts at once; stuck open warns and wrecks the starter unless the bleed is shut', () => {
  const a = auto((f) => { f.faults.svNoOpen = true; }); run(a.e, a.f, 10);
  assert.ok(a.f.phase === 'aborted' && a.f.startFault === 'START VALVE NOT OPEN' && a.e.out.N2pct < 0.5);
  const b = auto((f) => { f.faults.svNoClose = true; }); run(b.e, b.f, 70);
  assert.ok(b.f.phase === 'run' && b.f.svNotClosed && b.e.u.starterValve && b.f.ecam.some((m) => m.title === 'ENG 1 START VALVE FAULT'));
  run(b.e, b.f, 70); assert.equal(b.f.starterFailed, 'OVERSPEED');
  const c = auto((f) => { f.faults.svNoClose = true; }); run(c.e, c.f, 70); c.f.apuBleed = false; run(c.e, c.f, 70);
  assert.ok(!c.f.starterFailed && !c.e.u.starterValve, 'APU BLEED off removes the air');
});

test('manual start: both igniters, no automatic abort; crank mode: dry and wet crank, then the 60 s purge', () => {
  const { e, f } = rig(); f.manStart = true; run(e, f, 25); assert.ok(e.out.N2pct > 20 && !e.out.lit && !e.u.ignition);
  f.master = true; run(e, f, 40);
  assert.ok(e.out.lit && f.phase === 'run' && !e.u.starterValve, `manual start: ${f.phase} N2 ${e.out.N2pct}`);
  const m = rig(); m.f.faults.ignA = m.f.faults.ignB = true; m.f.manStart = true; run(m.e, m.f, 25); m.f.master = true; run(m.e, m.f, 30);
  assert.ok(m.f.manFault === 'IGNITION FAULT' && m.e.u.wfCmd > 0 && m.f.phase === 'manual', 'manual mode does not abort: the crew must');
  const w = rig(); w.f.mode = 'crank'; w.f.manStart = true; run(w.e, w.f, 25); w.f.master = true; run(w.e, w.f, 15);
  assert.ok(!w.e.out.lit && w.e.u.wfCmd > 0 && !w.e.u.ignition, 'wet crank: fuel, ignition inhibited');
  w.f.master = false; w.f.manStart = false; run(w.e, w.f, 3);
  assert.ok(!w.e.u.starterValve, 'valve closed while N2 runs down');
  let reopened = null, closed = null;
  run(w.e, w.f, 90, (o, t) => { if (reopened == null && w.e.u.starterValve) reopened = { t, n2: o.N2pct }; if (reopened && closed == null && !w.e.u.starterValve) closed = t; });
  assert.ok(reopened && reopened.n2 < 10.2, `the EEC reopens the start valve below 10 % N2: ${JSON.stringify(reopened)}`);
  assert.ok(closed - reopened.t > 59 && closed - reopened.t < 62, `purge lasts 60 s: ${closed - reopened.t}`);
});

test('continuous ignition on IGN/START reselection; the starter duty limit warns without aborting', () => {
  const { e, f } = idling(); f.mode = 'norm'; run(e, f, 1); assert.ok(!e.u.ignition);
  f.mode = 'ign'; run(e, f, 1); assert.ok(f.contIgn && e.u.ignition && f.ignSel === 'A+B');
  f.mode = 'norm'; run(e, f, 1); assert.ok(!e.u.ignition);
  const c = rig(); c.f.mode = 'crank'; c.f.manStart = true; c.f.starterHeat = 235; run(c.e, c.f, 10);
  assert.ok(c.f.starterLimit && c.e.u.starterValve && c.f.ecam.some((m) => m.title === 'ENG 1 STARTER'));
});

test('thrust lever into reverse: needs the engine running, holds idle until the reverser is fully out', () => {
  const c = rig(); c.f.setLever(-20); run(c.e, c.f, 2); assert.ok(!c.e.u.reverser && c.e.out.rev === 0, 'no hydraulic pressure with the engine stopped');
  const { e, f } = idling(); f.setLever(-20); run(e, f, 1);
  assert.ok(e.u.reverser && e.out.rev < 0.9 && e.out.N1pct < 30, 'idle while in transit');
  run(e, f, 20); assert.ok(e.out.rev > 0.99 && e.out.thrust < -14e3 && e.out.N1pct > 70, `max reverse: N1 ${e.out.N1pct}`);
  f.setLever(-6); run(e, f, 15); f.setLever(0); run(e, f, 6);
  assert.ok(!e.u.reverser && e.out.rev === 0 && e.out.thrust > 0 && e.out.lit);
});

test('active clearance control: about 1 % off cruise fuel burn; held open through a sea-level slam it rubs the tips', () => {
  const { e, f } = idling(); e.u.alt = 10668; e.u.mach = 0.78; f.tla = 0.62; run(e, f, 120);
  assert.ok(f.acc[0] > 0.99 && e.out.accH > 0.95, 'scheduled on in cruise');
  const on = { sfc: e.out.wf / e.out.thrust, egt: e.out.egt };
  f.ovr.accHpt = f.ovr.accLpt = 0; run(e, f, 120);
  const dS = on.sfc / (e.out.wf / e.out.thrust) - 1;
  assert.ok(dS < -0.006 && dS > -0.015, `cruise TSFC change ${(dS * 100).toFixed(2)} %`);
  assert.ok(e.out.egt - on.egt > 8, `EGT lower with ACC by ${(e.out.egt - on.egt).toFixed(1)} K`);
  const g = idling(); assert.ok(g.f.acc[0] === 0 && g.f.acc[1] === 0, 'off on the ground');
  g.f.tla = 1; run(g.e, g.f, 15); assert.ok(!has(g.e, 'acc-tip-rub'), 'normal take-off: no rub');
  g.f.tla = 0.6; run(g.e, g.f, 20); g.f.ovr.accHpt = g.f.ovr.accLpt = 1; run(g.e, g.f, 60); g.f.tla = 0; run(g.e, g.f, 15); g.f.tla = 1; run(g.e, g.f, 10);
  assert.ok(has(g.e, 'acc-tip-rub') && g.e.damage.d.rub > 0.05, 'forced open through a slam: tips rub');
});
