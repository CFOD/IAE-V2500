import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/sim/engine.js';
import { Fadec } from '../src/sim/fadec.js';
import { FAILURES, LINES } from '../src/sim/failures.js';

const run = (e, f, T, each) => { const dt = 1 / 60; for (let t = 0; t < T; t += dt) { f.update(dt); e.step(dt); if (each) each(e.out, t); } };
const rig = () => { const e = new Engine(), f = new Fadec(e); f.mode = 'ign'; return { e, f }; };
// one idling engine, cloned by replaying the start (cheap enough, and every test starts from the same state)
function idling() { const r = rig(); r.f.master = true; run(r.e, r.f, 100); r.f.mode = 'norm'; r.e.events.length = 0; r.e.damage._ev = 0; r.f._evIdx = 0; return r; }
const takeoff = () => { const r = idling(); r.f.setLever(45); run(r.e, r.f, 40); r.e.events.length = 0; r.e.damage._ev = 0; r.f._evIdx = 0; return r; };
const has = (e, type) => e.events.some((x) => x.type === type);

test('catalogue: every failure has a part, a group and words; every split line can break', () => {
  const ids = new Set();
  for (const fl of FAILURES) {
    assert.ok(!ids.has(fl.id), `duplicate ${fl.id}`); ids.add(fl.id);
    assert.ok(fl.parts.length && fl.name && fl.desc.length > 30 && fl.group, fl.id);
  }
  for (const k of Object.keys(LINES)) assert.ok(ids.has(`brk_${k}`), k);
  assert.ok(FAILURES.length >= 60);
});

test('every failure runs at idle and at take-off without breaking the numbers', () => {
  const finite = (o) => ['N1pct', 'N2pct', 'egt', 'wf', 'thrust', 'oilP', 'vib1', 'vib2', 'P3', 'T4'].every((k) => Number.isFinite(o[k]));
  // every failure from idle; the rotating-part and core ones from take-off power as well
  for (const fl of FAILURES) for (const start of fl.group === 'lp' || fl.group === 'core' ? [idling, takeoff] : [idling]) {
    const { e, f } = start();
    e.fail.set(fl.id, true); run(e, f, 6);
    assert.ok(finite(e.out), `${fl.id} (${start.name})`);
  }
});

test('fan blade release: severe N1 vibration, contained, recorded for the 3D view', () => {
  const { e, f } = takeoff();
  e.fail.set('fanBlade'); run(e, f, 5);
  assert.ok(e.out.vib1 > 6, `vib ${e.out.vib1}`);
  assert.ok(has(e, 'fan-blade-off') && e.fail.missing.fan.length === 1);
  assert.equal(e.damage.d.burst, '');
});

test('LP shaft failure: the free LP turbine bursts at take-off, runs away safely at idle', () => {
  let r = takeoff(); r.e.fail.set('lpShear'); run(r.e, r.f, 2);
  assert.ok(has(r.e, 'disc-burst-lp'), 'burst at take-off power');
  r = idling(); r.e.fail.set('lpShear'); run(r.e, r.f, 20);
  assert.ok(!has(r.e, 'disc-burst-lp'));
  assert.ok(r.e.out.NlptPct > 2 * r.e.out.N1pct, `turbine ${r.e.out.NlptPct} fan ${r.e.out.N1pct}`);
});

test('HP shaft failure at idle: the compressor runs down and the flame goes out for lack of air', () => {
  const { e, f } = idling(); e.fail.set('hpShear'); let litAt = null;
  run(e, f, 40, (o, t) => { if (o.lit) litAt = o.N2pct; });
  assert.ok(!e.out.lit && litAt > 9, `flame held down to N2 ${litAt}`);
  assert.ok(e.out.NhptPct > 2 * e.out.N2pct, 'the free HP turbine keeps turning faster than the compressor');
});

test('fuel system: a sheared pump drive flames the engine out; a jammed metering valve ignores the lever', () => {
  let r = idling(); r.e.fail.set('fuelPump'); run(r.e, r.f, 5);
  assert.ok(!r.e.out.lit);
  r = idling(); r.e.fail.set('fmuFrozen'); const ff = r.e.out.wf; r.f.setLever(45); run(r.e, r.f, 15);
  assert.ok(Math.abs(r.e.out.wf - ff) / ff < 0.05 && r.e.out.N2pct < 62);
  r.f.master = false; run(r.e, r.f, 10); assert.ok(!r.e.out.lit, 'MASTER OFF still shuts the fuel');
});

test('a worn fuel pump hangs the start and the EEC aborts it', () => {
  const { e, f } = rig(); e.fail.set('pumpWorn'); f.master = true; run(e, f, 75);
  assert.match(f.startFault, /HUNG/);
});

test('broken metered fuel line: flame-out and a fire that the agent only puts out once the fuel is off', () => {
  const { e, f } = idling(); e.fail.set('brk_meteredfuel'); run(e, f, 4);
  assert.ok(e.out.fire >= 1 && f.ecam.some((m) => m.title === 'ENG 1 FIRE'));
  f.master = false; run(e, f, 3);
  assert.ok(e.damage.extinguish());
  run(e, f, 1); assert.ok(e.fail.st.fire === 0 && e.out.fire === 0);
});

test('false indications: oil pressure line and EGT harness', () => {
  let r = idling(); r.e.fail.set('brk_oilpress'); run(r.e, r.f, 2);
  assert.ok(r.e.out.oilP === 0 && r.e.out.oilLowP && r.e.oil.s.press > 100, 'reads zero, pressure is really there');
  r = idling(); r.e.fail.set('brk_egtharness'); run(r.e, r.f, 2);
  assert.ok(Number.isNaN(r.e.out.egtInd) && Number.isFinite(r.e.out.egt));
});

test('both EEC channels lost: the engine runs down', () => {
  const { e, f } = idling(); e.fail.set('eecA'); run(e, f, 3);
  assert.ok(e.out.lit && f.ecam.some((m) => /FADEC A/.test(m.title)));
  e.fail.set('brk_harnessB'); run(e, f, 20);
  assert.ok(e.out.N2pct < 40, `N2 ${e.out.N2pct}`);
});

test('reverser: uncommanded deployment gets auto-idle; no hydraulics, no deployment', () => {
  let r = takeoff(); r.e.fail.set('revDeploy'); run(r.e, r.f, 12);
  assert.ok(r.e.out.rev > 0.99 && r.e.out.N1pct < 35, `N1 ${r.e.out.N1pct}`);
  r = idling(); r.e.fail.set('hydFail'); r.f.setLever(45); run(r.e, r.f, 25); r.f.setLever(0); run(r.e, r.f, 10); r.f.setLever(-20); run(r.e, r.f, 8);
  assert.ok(r.e.out.rev < 0.01 && r.f.revInhibit);
});

test('clearing a failure repairs the part', () => {
  const { e, f } = idling(); e.fail.set('brk_fuelsupply'); run(e, f, 1); e.fail.set('brk_fuelsupply', false);
  assert.ok(!e.fail.isOn('brk_fuelsupply')); run(e, f, 2); assert.ok(e.out.lit, 'repaired before the lines ran dry');
  e.fail.reset(); assert.equal(e.fail.active, 0);
});

test('ingestion leaves records of the blades it hit: a goose bends fan tips, a bolt nicks one blade', () => {
  const r = takeoff(); let sd = 3; const rand = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const w1 = (r.e.out.N1pct / 100) * 5650 * Math.PI / 30;
  r.e.fail.ingest('goose', { name: 'Canada goose', m: 3.6, size: 0.75, hit: 'soft', fly: 15 }, 0.62, { U: w1 * 0.62, Vax: 170, w2: 1400, rand });
  const fan = r.e.fail.dmg.fan;
  assert.ok(fan.length >= 2 && fan.length <= 6, `${fan.length} blades`);
  assert.ok(fan.some((d) => d.type === 'bend'), fan.map((d) => d.type).join());
  for (const d of fan) assert.ok(d.f >= 0 && d.f < 1 && d.span > 0.5 && d.span < 0.9 && d.sev > 0 && d.sev <= 1, JSON.stringify(d));
  assert.ok(new Set(fan.map((d) => Math.floor(d.f * 22))).size === fan.length, 'neighbouring blades, one record each');
  const b = takeoff();
  b.e.fail.ingest('bolt', { name: 'Bolt', m: 0.035, size: 0.06, hit: 'hard' }, 0.7, { U: w1 * 0.7, Vax: 170, w2: 1400, rand: () => 0.5 });
  assert.equal(b.e.fail.dmg.fan.length, 1); assert.equal(b.e.fail.dmg.fan[0].type, 'nick');
  b.e.fail.reset(); assert.equal(b.e.fail.dmg.fan.length, 0);
});

test('a streaking nozzle burns the HP turbine guide vanes behind it, faster at high power', () => {
  const r = takeoff(); r.e.fail.set('nozzleStreak', true); run(r.e, r.f, 60);
  const burn = r.e.damage.d.ngvBurn;
  assert.ok(burn > 0.15 && burn < 0.8, `burn ${burn}`);
  const i = idling(); i.e.fail.set('nozzleStreak', true); run(i.e, i.f, 60);
  assert.ok(i.e.damage.d.ngvBurn < burn / 4, `idle ${i.e.damage.d.ngvBurn}`);
  const c = takeoff(); run(c.e, c.f, 60); assert.equal(c.e.damage.d.ngvBurn, 0);
  assert.ok(c.e.damage.d.TbHmax >= c.e.damage.d.TbH && c.e.damage.d.TbHmax > 900, `hottest ${c.e.damage.d.TbHmax}`);
});
