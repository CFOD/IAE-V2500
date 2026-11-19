// Part-level failures: break a blade, shear a shaft, jam a valve, cut a pipe or a harness.
//
// Each failure acts where the real one would: on what the engine actually receives (the fuel that
// reaches the nozzles, valve and stator positions, starter air, bleed leaks, accessory load), on the
// hardware's condition, and on the oil, damage and control models. Only the failure itself is
// scripted. What follows it (flame-out, surge, overspeed, a seized rotor, fire, the FADEC fighting
// it) comes out of the same physics as everything else.
// The mechanisms are real; the numbers are engineering estimates, not IAE data (docs/FAILURES.md).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TO_WF = 1.05;     // kg/s, this model's sea-level take-off fuel flow
const QT = 0.95;        // kg per US quart of oil
const VSV_SHUT = 38;    // stator angle at the closed stop, deg (engine.js vsvSchedule)

// Groups for the Faults tab, in display order.
export const FAIL_GROUPS = [
  ['lp', 'Fan and LP spool'], ['core', 'Compressors, combustor and turbines'], ['fuel', 'Fuel system'], ['oil', 'Oil system'],
  ['air', 'Air: stators, bleeds and ducts'], ['start', 'Starting and ignition'], ['acc', 'Gearbox and accessories'],
  ['ctl', 'Control and indication'], ['nac', 'Nacelle and mounts'], ['line', 'Pipes, ducts and harnesses'],
];

// The 21 lines exported from the model as parts of their own (tools/blender/dressing.py): what a break does.
export const LINES = {
  p3servo: ['P3 servo air lines', 'air', 'The handling bleed valves need P3 air to close. Without it their springs open them all: EGT rises and thrust falls.'],
  acocoil: ['Air-cooled oil cooler lines', 'oil', 'Oil pours out at about 6 quarts a minute, and the air cooler is out of the circuit.'],
  antiice: ['Nacelle anti-ice duct', 'air', 'Hot HP air blows into the fan compartment: about 2 % of the core flow lost, EGT up.'],
  starterduct: ['Starter air duct', 'air', 'The air blows into the nacelle instead of the starter: no motoring, no start.'],
  hyd: ['Hydraulic lines', 'hyd', 'Green system fluid lost from this engine\'s pump: no pressure, and the thrust reverser cannot move.'],
  fuelsupply: ['Fuel supply lines', 'fuel', 'Fuel from the pylon sprays into the fan compartment and the pump starves: flame-out in a couple of seconds. The fan compartment is cool, so it does not light. MASTER OFF shuts the LP valve.'],
  fcoc: ['Fuel-cooled oil cooler lines', 'fuel', 'All the engine\'s fuel passes through these: it sprays out, the pump starves and the engine flames out. The oil loses its fuel cooling.'],
  oilpress: ['Oil pressure sense line', 'oil', 'A small oil leak, and the transmitter reads zero: OIL LO PR on a healthy engine. Quantity, temperature and vibration tell the real story.'],
  idgcooler: ['IDG oil cooler lines', 'oil', 'The drive generator loses its oil. About 30 s later it overheats and is disconnected.'],
  servofuel: ['Servo fuel lines', 'fuel', 'High-pressure fuel sprays on the hot core: ENGINE FIRE. The stator actuator freezes and the clearance control valves shut.'],
  meteredfuel: ['Metered fuel line', 'fuel', 'All the metered fuel sprays into the core compartment instead of the nozzles: flame-out, and a big fire on a hot engine.'],
  no4oil: ['No. 4 bearing oil lines', 'oil', 'Oil sprays on the diffuser case (smoke, then fire on a hot engine) and the No. 4 bearing is starved: it starts to break up.'],
  harnessA: ['Core harness, channel A', 'elec', 'EEC channel A loses its core sensors and actuators and hands over to channel B.'],
  harnessB: ['Core harness, channel B', 'elec', 'EEC channel B loses its core sensors and actuators and hands over to channel A.'],
  htleadA: ['Ignition lead A', 'elec', 'Igniter A gets no spark. Automatic starts alternate igniters, so every other start finds no light.'],
  htleadB: ['Ignition lead B', 'elec', 'Igniter B gets no spark: every other automatic start finds no light.'],
  egtharness: ['EGT harness', 'elec', 'EGT signal lost: XX on the ECAM, and the EEC has no EGT limiting or hot-start protection.'],
  bleed7: ['IP bleed duct (stage 7)', 'air', 'Bleed air for the aircraft escapes into the core compartment: AIR ENG 1 BLEED LEAK, about 3 % of the core flow lost.'],
  bleed10: ['HP bleed duct (stage 10)', 'air', 'Hotter, higher-pressure air escapes than from the IP duct: about 4.5 % of the core flow lost.'],
  accduct: ['Clearance control ducts', 'air', 'Fan air dumps into the core compartment instead of cooling the turbine cases: cruise fuel burn rises, bypass air is lost.'],
  bufferair: ['Buffer air duct', 'air', 'The No. 4 bearing seals lose their buffer air: oil is drawn past them into the gas path (smoke) and consumed.'],
};

const F = (id, group, parts, name, desc, once = false) => ({ id, group, parts, name, desc, once });
export const FAILURES = [
  // ---- fan and LP spool
  F('fanBlade', 'lp', ['fan', 'fancase'], 'Fan blade release', 'A blade breaks off at the root. The fan case contains it, but the rotor is badly out of balance and pieces go down the core: vibration off the scale, thrust down, and the fan and compressors may surge. Each press releases another blade.', true),
  F('fanCrack', 'lp', ['fan'], 'Cracked fan blade root', 'A fatigue crack in a blade root grows with every minute at high fan speed. Vibration creeps up; at take-off power the blade lets go within about a minute. At idle it hardly grows. Clear it to fit a new blade.'),
  F('spinner', 'lp', ['spinner'], 'Spinner fairing lost', 'The nose fairing breaks up and goes through the fan: a little fan damage and some vibration.', true),
  F('lpShear', 'lp', ['lpshaft', 'lpt'], 'LP shaft failure', 'The shaft between the LP turbine and the fan breaks. The fan, no longer driven, runs down; the LP turbine, with nothing to drive, races. At high power it reaches burst speed in a fraction of a second. At idle it settles at a runaway speed below that, until the FADEC adds fuel to chase the falling EPR.', true),
  F('brgLP', 'lp', ['bearings', 'lpshaft'], 'Fan bearing breaking up (No. 1)', 'Rolling elements spalling: N1 vibration and drag rise and metal shows on the chip detector. After about a minute at high power, several at idle, the bearing seizes and the fan stops dead.'),
  // ---- core
  F('lpcBlade', 'core', ['lpc'], 'Booster blade release', 'A blade fails in the LP compressor. The debris dents the stages behind it: booster efficiency and flow fall, N1 vibrates, and the core may surge.', true),
  F('hpcBlade', 'core', ['hpc'], 'HP compressor blade release', 'A blade fails in the front stages and dents the stages behind it: flow and efficiency fall, the compressor surges and fragments reach the turbine. EGT climbs as the FADEC pushes for thrust. A second one wrecks the compressor.', true),
  F('hpShear', 'core', ['hpshaft', 'hpt'], 'HP shaft failure', 'The shaft between the HP turbine and compressor breaks. The compressor runs down and surges, the flame goes out for lack of air, and the HP turbine races. At high power it reaches burst speed before the gas pressure falls away.', true),
  F('hptBlade', 'core', ['hpt'], 'HP turbine blade release', 'One HP turbine blade fails (as creep would eventually do). Its pieces go through the LP turbine: efficiency drops, EGT jumps and the core vibrates.', true),
  F('lptBlade', 'core', ['lpt'], 'LP turbine blade release', 'An LP turbine blade fails: LP efficiency drops, N1 vibration rises, EGT climbs.', true),
  F('brgHP', 'core', ['bearings', 'hpshaft'], 'HP thrust bearing breaking up (No. 3)', 'The HP thrust bearing starts to fail: N2 vibration and drag rise, metal on the chip detector, then it seizes and wrecks the core.'),
  F('burnThrough', 'core', ['liner', 'combcase'], 'Combustor burn-through', 'A hole burns through the liner and the case, and flame plays on the core compartment: ENGINE FIRE until the fuel is off and the agent is fired.', true),
  F('diffCrack', 'core', ['combcase'], 'Diffuser case crack', 'Compressor delivery air (over 500 °C at take-off) escapes into the core compartment: about 4 % of the core flow lost, so EGT and fuel flow rise for the same thrust.'),
  F('caseBurn', 'core', ['hptcase', 'lptcase'], 'Turbine case burn-through', 'Hot gas cuts through the turbine case like a torch: turbine efficiency falls and the core compartment is on fire for as long as the engine runs.', true),
  F('nozzleStreak', 'core', ['fuel', 'hptcase'], 'Streaking fuel nozzle', 'A coked nozzle sprays a narrow jet instead of a cone. The hot streak burns the guide vanes and blades behind it: at take-off power HP turbine creep life goes in minutes instead of thousands of hours, then blades let go.'),
  F('manifoldLeak', 'core', ['fuel'], 'Fuel manifold leak', 'A cracked pigtail sprays fuel on the combustor case. On a hot engine it lights: ENGINE FIRE. MASTER OFF stops the fuel; then fire the agent.'),
  // ---- fuel system
  F('fuelPump', 'fuel', ['fuelpump'], 'Fuel pump drive shaft sheared', 'The pump stops: no fuel pressure, flame-out within a second, and no relight.'),
  F('pumpWorn', 'fuel', ['fuelpump'], 'HP fuel pump worn', 'Worn gears deliver too little at low speed: the start hangs below idle. Once the engine is running fast there is enough.'),
  F('fmuFrozen', 'fuel', ['fmu'], 'Metering valve jammed', 'Fuel flow freezes where it is: the thrust lever does nothing. MASTER OFF still stops the fuel through a separate shut-off valve.'),
  F('fmuHunt', 'fuel', ['fmu'], 'Metering valve hunting', 'The torque motor oscillates: fuel flow swings about 18 % either way every two seconds and both spools hunt.'),
  F('sovStuck', 'fuel', ['fmu'], 'HP shut-off valve stuck open', 'MASTER OFF cannot shut the valve at the engine. The engine still stops, because MASTER OFF also shuts the LP valve in the pylon, but only once the fuel in the pipes between them has burnt: it runs on for several seconds.'),
  F('fdvStuck', 'fuel', ['fdv'], 'Distribution valve stuck shut', 'No fuel reaches the nozzles: flame-out, or no light-off on a start.'),
  F('fdvHalf', 'fuel', ['fdv'], 'Half the distribution outlets blocked', 'Only ten of the twenty nozzles flow: the engine cannot take more than about 2,000 kg/h, so thrust is capped, and the uneven flame makes hot streaks.'),
  // ---- oil
  F('tankPuncture', 'oil', ['oiltank'], 'Oil tank punctured', 'About 10 quarts a minute overboard: the tank empties in a few minutes, the pump draws air, pressure collapses and the bearings start to go.'),
  F('acacFail', 'oil', ['acac'], 'Buffer air cooler blocked', 'Hot compressor air reaches the No. 4 bearing seals: oil temperature climbs, oil cokes in the chamber and is drawn past the seals into the gas path (smoke in the exhaust).'),
  // ---- air
  F('vsvOpen', 'air', ['vsvact', 'hpccase'], 'VSV actuator failed open', 'The stators go fully open at all speeds. The front stages stall at low speed: the start hangs or surges.'),
  F('vsvShut', 'air', ['vsvact', 'hpccase'], 'VSV actuator failed shut', 'The stators go fully shut. The compressor cannot swallow the air at high speed: thrust is capped and EGT rises.'),
  F('b25Open', 'air', ['lpccase'], '2.5 bleed stuck open', 'Booster air keeps dumping into the bypass duct: less thrust for the fuel burnt, hotter at take-off.'),
  F('b7Open', 'air', ['hpccase'], 'Stage 7 bleed valves stuck open', 'All three handling bleeds stay open at high power: compressor air thrown away, EGT up, thrust down.'),
  F('b7Shut', 'air', ['hpccase'], 'Stage 7 bleed valves stuck shut', 'The handling bleeds cannot open at low speed, where the front stages need them: the compressor surges on starts and decelerations.'),
  F('b10Open', 'air', ['hpccase'], 'Stage 10 bleed valve stuck open', 'The start bleed stays open: a steady loss of HP air, EGT up.'),
  F('aiStuck', 'air', ['lip', 'line_antiice'], 'Nacelle anti-ice valve stuck open', 'Hot HP air heats the inlet lip all the time: about 1 % of the core flow lost.'),
  // ---- starting and ignition
  F('starterShear', 'start', ['starter'], 'Starter output shaft sheared', 'The starter spins on its air but nothing turns the engine: N2 stays at zero while the EEC waits for motoring speed.'),
  F('starterClutch', 'start', ['starter'], 'Starter clutch seized', 'The clutch cannot overrun, so once running the engine drives the starter at many times its design speed. Within about 20 s at idle it disintegrates; fragments hole the gearbox and oil pours out.'),
  // ---- gearbox and accessories
  F('towerShaft', 'acc', ['agb'], 'Tower shaft sheared', 'The drive from the HP spool to the gearbox breaks. Everything on it stops at once: fuel pump (flame-out), oil pump, generator, hydraulic pump and the EEC\'s alternator. The starter cannot turn the engine either.'),
  F('idgFail', 'acc', ['idg'], 'IDG failure', 'The drive generator overheats and is disconnected: its load comes off the HP spool, and it stays off until reset on the ground.'),
  F('hydFail', 'acc', ['hydpump'], 'Hydraulic pump failure', 'No green system pressure from this engine: its load comes off the HP spool and the thrust reverser can no longer move.'),
  F('pmaFail', 'acc', ['pma'], 'Dedicated alternator failure', 'The EEC switches to aircraft 28 V power and carries on: nothing changes for the engine. It would matter only if aircraft power went too.'),
  // ---- control and indication
  F('eecA', 'ctl', ['eec'], 'EEC channel A failure', 'Channel B takes control without a bump. Fail B as well and the engine has no control at all.'),
  F('eecB', 'ctl', ['eec'], 'EEC channel B failure', 'Channel A takes control. With both channels lost the metering valve goes to its minimum stop, the stators shut and the bleeds open: the engine runs down.'),
  F('egtLost', 'ctl', ['egtbox', 'tec'], 'EGT signal lost', 'The junction box fails open: EGT shows XX, and the EEC loses its EGT limiting and hot-start protection.'),
  F('egtHigh', 'ctl', ['tec', 'egtbox'], 'Thermocouples reading 150 °C high', 'A false high reading that the EEC believes: it trims start fuel to keep the reading under the start limit, so starts drag or hang, and its take-off limiter pulls thrust back on a healthy engine.'),
  // ---- nacelle and mounts
  F('revDeploy', 'nac', ['cna'], 'Reverser deploys uncommanded', 'The C-duct sleeves unlock and slide aft with the lever forward. The EEC detects it and drops the engine to idle.'),
  F('cowlUnlatched', 'nac', ['fancowl'], 'Fan cowl doors left unlatched', 'Harmless at rest. At high fan speed, or above about Mach 0.15, the airflow lifts the doors and tears them off.'),
  F('linerPanel', 'nac', ['inlet'], 'Inlet liner panel ingested', 'An acoustic panel comes off the inlet barrel and goes through the fan: bent blades, vibration, a surge.', true),
  F('mountLink', 'nac', ['mounts'], 'Aft mount link broken', 'The fail-safe link takes the load and the engine stays on, but the mount passes on more vibration.'),
  F('separation', 'nac', ['mounts', 'pylon'], 'Engine separation', 'Both mounts let go and the engine falls off the pylon. Every pipe and harness to the aircraft is torn out, and fuel pours from the pylon until the LP valve is shut.', true),
  // ---- every split line: broken
  ...Object.entries(LINES).map(([k, [name, , desc]]) => F(`brk_${k}`, 'line', [`line_${k}`], `${name} broken`, desc)),
];
export const FAIL_BY_ID = Object.fromEntries(FAILURES.map((f) => [f.id, f]));

function defaultFailWear() {
  return { effFan: 0, effLpc: 0, effHpc: 0, effHpt: 0, effLpt: 0, flowFan: 1, flowLpc: 1, flowHpc: 1, flowHpt: 1, flowLpt: 1 };
}

export class Failures {
  constructor(engine) { this.eng = engine; this.uEff = {}; this.reset(); }

  reset() {
    this.on = {};          // active failures (toggles), id -> true
    this.count = {};       // momentary failures: how many times each has happened
    this.w = defaultFailWear();
    this.st = {
      crack: 0, brgLP: 0, lpSeized: false, clutchT: 0, starterBurst: false, idgT: 0, acacT: 0, lpFuel: 1, wfHold: null, wfLast: 0,
      vsvHold: null, spill: 0, fire: 0, fireT: 0, ignT: 0, cowlGone: false, separated: false, caseBurnt: false, harnessFire: 0,
    };
    this.fx = {};          // derived flags read by the engine, FADEC, oil and damage models
    this.missing = { fan: [], lpc: [], hpc: [] };   // released blades, as fractions round the row (for the 3D view)
    this.leaks = [];       // {part, kind: fuel | oil | air | hyd, k} for the 3D view
    this.vib1 = 0; this.vib2 = 0; this.drag1 = 0; this.drag2 = 0;
    this.ecam = [];
    this.firePart = null; this.feeding = false;
    this._seed = 7;
    this._derive();
  }

  _rand() { this._seed = (this._seed * 16807) % 2147483647; return (this._seed - 1) / 2147483646; }
  _event(type) { this.eng.events.push({ t: this.eng.s.t, type }); }
  /** Number of active or triggered failures. */
  get active() { return Object.keys(this.on).length + Object.values(this.count).reduce((a, b) => a + b, 0); }
  isOn(id) { return !!this.on[id]; }

  /** Inject (on = true) or clear a failure. Momentary failures happen once per call and cannot be cleared. */
  set(id, on = true) {
    const f = FAIL_BY_ID[id]; if (!f) return false;
    const e = this.eng, d = e.damage ? e.damage.d : null;
    if (f.once) {
      if (!on) return false;
      this.count[id] = (this.count[id] || 0) + 1;
      switch (id) {
        case 'fanBlade': this._releaseFan('fan-blade-off'); break;
        case 'spinner': this._event('spinner-lost'); this._event('surge-fan'); break;
        case 'linerPanel': this._event('liner-ingested'); this._event('surge-fan'); break;
        case 'lpcBlade': this.missing.lpc.push(this._rand()); this._event('lpc-blade-release'); this._event('surge-lpc'); break;
        case 'hpcBlade':   // the first one damages the stages behind it; a second wrecks the compressor
          this.missing.hpc.push(this._rand());
          if (d) { const was = d.hpc; d.hpc = was >= 0.5 ? 1 : 0.6; d.hptLost = Math.min(1, d.hptLost + (d.hpc >= 1 && was < 1 ? 0.06 : 0.02)); }
          this._event(d && d.hpc >= 1 ? 'hpc-blade-failure' : 'hpc-blade-release'); this._event('surge-hpc'); break;
        case 'hptBlade': if (d) { d.hptLost = Math.min(1, d.hptLost + 0.08); d.lptLost = Math.min(1, d.lptLost + 0.03); } this._event('hpt-blade-release'); break;
        case 'lptBlade': if (d) d.lptLost = Math.min(1, d.lptLost + 0.07); this._event('lpt-blade-release'); break;
        case 'lpShear': if (!this.fx.lpShear) { e.s.Nlpt = e.s.N1; this._event('lp-shaft-shear'); } break;
        case 'hpShear': if (!this.fx.hpShear) { e.s.Nhpt = e.s.N2; this._event('hp-shaft-shear'); this._event('surge-hpc'); } break;
        case 'burnThrough': if (d) { d.liner = 1; d.fire = 1; } this._event('combustor-burn-through'); break;
        case 'caseBurn': this.st.caseBurnt = true; this._event('case-burn-through'); break;
        case 'separation': if (!this.st.separated) { this.st.separated = true; this._event('engine-separation'); } break;
      }
    } else if (on) {
      if (this.on[id]) return false;
      this.on[id] = true;
      if (id === 'brk_servofuel') this.st.vsvHold = e.s.vsv;
      if (id === 'fmuFrozen') this.st.wfHold = null;
      if (id === 'towerShaft') this._event('tower-shaft-shear');
      if (id === 'eecA' || id === 'eecB' || id === 'brk_harnessA' || id === 'brk_harnessB') { /* picked up below */ }
    } else {
      if (!this.on[id]) return false;
      delete this.on[id];
      // clearing means the part has been repaired or replaced
      if (id === 'fanCrack') this.st.crack = 0;
      if (id === 'brgLP') { this.st.brgLP = 0; this.st.lpSeized = false; }
      if (id === 'brgHP' && e.oil && !e.oil.s.failed) { e.oil.s.brg = 0; e.oil.s.chips = 0; }
      if (id === 'starterClutch') this.st.clutchT = 0;
      if (id === 'acacFail') this.st.acacT = 0;
      if (id === 'brk_idgcooler') this.st.idgT = 0;
    }
    this._derive();
    return true;
  }

  _releaseFan(ev) {
    const e = this.eng, d = e.damage ? e.damage.d : null;
    let a = this._rand(); for (let k = 0; k < 6 && this.missing.fan.some((b) => Math.abs(b - a) < 0.05); k++) a = this._rand();
    this.missing.fan.push(a);
    if (d) d.hpc = Math.min(1, d.hpc + 0.3);   // pieces of the blade go down the core
    this._event(ev); this._event('surge-fan');
    if ((e.out.N1pct || 0) > 40) this._event('surge-hpc');
  }

  /** Flags derived from the active failures (cheap; run after every change and every step). */
  _derive() {
    const on = this.on, st = this.st, fx = this.fx;
    fx.eecA = !!(on.eecA || on.brk_harnessA || st.harnessFire >= 1 || st.separated);
    fx.eecB = !!(on.eecB || on.brk_harnessB || st.harnessFire >= 2 || st.separated);
    fx.eecDead = fx.eecA && fx.eecB;
    fx.ignA = !!(on.brk_htleadA || st.separated); fx.ignB = !!(on.brk_htleadB || st.separated);
    fx.egtLost = !!(on.egtLost || on.brk_egtharness || st.separated);
    fx.egtBias = on.egtHigh ? 150 : 0;
    fx.gearbox = !on.towerShaft;   // gearbox turning
    fx.hydLost = !!(on.hydFail || on.brk_hyd || on.towerShaft || st.separated);
    fx.idgLost = !!(on.idgFail || on.towerShaft || st.idgT > 30 || st.separated);
    fx.lpShear = !!this.count.lpShear; fx.hpShear = !!this.count.hpShear;
    fx.oilPressLost = !!(on.brk_oilpress || st.separated);
    fx.pumpFail = !!on.towerShaft;
    fx.acocLost = !!on.brk_acocoil; fx.fcocLost = !!on.brk_fcoc;
    fx.bleedLeak = !!(on.brk_bleed7 || on.brk_bleed10);
  }

  /**
   * The inputs the engine actually gets: what the FADEC and the player command, changed by the
   * failed parts between them and the engine. Called once per step, before the sub-steps.
   */
  filter(u, dt) {
    const v = Object.assign(this.uEff, u), on = this.on, st = this.st, fx = this.fx, e = this.eng, s = e.s;
    const n2 = clamp((e.out.N2pct || 0) / 100, 0, 1.3);
    // ---- fuel. The LP valve in the pylon is shut by MASTER OFF or the FIRE pushbutton; the pipes
    // downstream hold a couple of seconds of fuel. The pump is driven by the gearbox.
    const lpOpen = u.lpValve !== false;
    const supply = lpOpen && fx.gearbox && !on.fuelPump && !on.brk_fuelsupply && !on.brk_fcoc && !st.separated;
    st.lpFuel += ((supply ? 1 : 0) - st.lpFuel) * Math.min(1, dt / (supply ? 0.3 : on.sovStuck ? 3 : 1.2));   // with the HP valve stuck open the lines drain through the engine
    let wf = Math.max(0, v.wfCmd);
    if (on.fmuFrozen) { if (st.wfHold == null) st.wfHold = wf; wf = wf > 0 ? st.wfHold : 0; }
    if (on.sovStuck) { if (wf > 0) st.wfLast = wf; else wf = st.wfLast; }   // metering valve's last setting keeps flowing
    else st.wfLast = wf;
    if (on.fmuHunt && wf > 0) wf *= 1 + 0.18 * Math.sin(2 * Math.PI * 0.5 * s.t);
    if (on.pumpWorn) wf = Math.min(wf, 0.045 + 0.03 * clamp((n2 - 0.3) / 0.15, 0, 1) + 1.2 * clamp(n2 - 0.47, 0, 1));   // delivery collapses at low pump speed
    if (fx.eecDead) wf = Math.min(wf, 0.03);   // metering valve on its minimum stop
    wf *= st.lpFuel;
    st.spill = 0;
    if (on.brk_meteredfuel) { st.spill = wf; wf = 0; }   // all of it sprays into the core compartment
    if (on.fdvStuck) wf = 0;
    if (on.fdvHalf) wf = Math.min(wf, 0.55);
    v.wfCmd = wf;
    // ---- starter: no air, no drive, or no gearbox to drive
    if (on.starterShear || on.brk_starterduct || on.towerShaft || st.starterBurst || st.separated) v.starterPsi = 0;
    // ---- stators, bleeds, clearance control
    if (on.vsvOpen) v.vsv = -8;
    if (on.vsvShut || fx.eecDead) v.vsv = VSV_SHUT;
    if (on.brk_servofuel) { v.vsv = st.vsvHold ?? s.vsv; v.accHpt = 0; v.accLpt = 0; }
    if (on.b25Open || fx.eecDead) v.bleed25 = 1;
    if (on.b7Shut) v.bleed7 = 0;
    if (on.b7Open || on.brk_p3servo || fx.eecDead) v.bleed7 = 3;
    if (on.b10Open || on.brk_p3servo || fx.eecDead) v.bleed10 = 1;
    if (on.brk_accduct || fx.eecDead) { v.accHpt = 0; v.accLpt = 0; }
    v.accLeak = on.brk_accduct ? 1 : 0;
    // air escaping from the core: taken like customer bleed
    v.custBleed = u.custBleed + (on.aiStuck ? 0.012 : 0) + (on.brk_antiice ? 0.018 : 0) + (on.brk_bleed7 ? 0.03 : 0) + (on.brk_bleed10 ? 0.045 : 0)
      + (on.diffCrack ? 0.04 : 0) + (on.brk_bufferair ? 0.006 : 0) + (on.brk_p3servo ? 0.002 : 0);
    // ---- gearbox load: generator about two thirds of it, hydraulic pump most of the rest
    v.offtakeW = fx.gearbox ? u.offtakeW * Math.max(0, 1 - (fx.idgLost ? 0.65 : 0) - (fx.hydLost ? 0.3 : 0)) : 0;
    // ---- reverser: frozen without hydraulics; unlocked sleeves blow aft whatever is commanded
    v.revHold = fx.hydLost && !on.revDeploy;
    if (on.revDeploy) v.reverser = true;
    if (fx.eecDead) { v.starterValve = false; v.ignition = false; }
    return v;
  }

  /** After the engine, oil and damage models: progressive failures, leaks, fire, indications. */
  update(dt) {
    const e = this.eng, o = e.out, s = e.s, on = this.on, st = this.st, fx = this.fx, cnt = this.count;
    const d = e.damage ? e.damage.d : null, oil = e.oil;
    const n1 = clamp((o.N1pct || 0) / 100, 0, 1.3), n2 = clamp((o.N2pct || 0) / 100, 0, 1.3);
    const W = this.w; Object.assign(W, defaultFailWear());
    let v1 = 0, v2 = 0, g1 = 0, g2 = 0;

    // ---- blades lost
    const nFan = this.missing.fan.length;
    if (nFan) { W.effFan -= Math.min(0.045 * nFan, 0.3); W.flowFan *= Math.max(0.6, 1 - 0.04 * nFan); v1 += Math.min(10, 3 + 7 * nFan) * Math.max(n1, 0.15); g1 += 900 * nFan; }
    if (cnt.spinner) { W.effFan -= 0.01; v1 += 1.2 * n1; }
    if (cnt.linerPanel) { W.effFan -= 0.025 * cnt.linerPanel; W.flowFan *= 0.98; v1 += 2 * n1; }
    const nLpc = this.missing.lpc.length;
    if (nLpc) { W.effLpc -= Math.min(0.035 * nLpc, 0.25); W.flowLpc *= Math.max(0.7, 1 - 0.03 * nLpc); v1 += 3 * nLpc * n1; }
    if (this.missing.hpc.length) { v2 += 2.5 * this.missing.hpc.length * n2; if (this.missing.hpc.length > 2) W.effHpc -= 0.03 * (this.missing.hpc.length - 2); }
    if (st.caseBurnt) W.effHpt -= 0.04;
    // ---- cracked fan blade: fatigue growth with the fourth power of fan speed above about half speed
    if (on.fanCrack) {
      st.crack += (dt * clamp((n1 - 0.45) / 0.4, 0, 1.5) ** 4) / 50;
      v1 += (0.4 + 3 * st.crack) * n1;
      if (st.crack >= 1) { st.crack = 0; delete this.on.fanCrack; cnt.fanBlade = (cnt.fanBlade || 0) + 1; this._releaseFan('fan-crack-release'); }
    }
    // ---- shaft failures: the free turbine's speed (engine.js) decides whether its disc bursts
    if (fx.lpShear) v1 += 2 + 4 * clamp((o.NlptPct || 0) / 100, 0, 1.3);
    if (fx.hpShear) v2 += 3;
    // ---- bearings
    if (on.brgLP && !st.lpSeized) {
      st.brgLP = Math.min(1, st.brgLP + dt * (0.003 + 0.022 * n1 * n1));
      if (st.brgLP > 0.15 && oil && !oil.s.chips) { oil.s.chips = 1; this._event('chip-detector'); }
      if (st.brgLP >= 1) { st.lpSeized = true; this._event('lp-bearing-seized'); }
    }
    if (on.brgLP || st.lpSeized) { v1 += 0.5 + 7 * st.brgLP * Math.max(n1, 0.2); g1 += 5000 * st.brgLP * st.brgLP + (st.lpSeized ? 60000 : 0); }
    if (st.lpSeized && o.N1pct < 3) s.N1 = 0;
    if (oil && !oil.s.failed) {   // HP bearing distress runs through the oil system's bearing model (drag, vibration, chips, seizure)
      let r = 0;
      if (on.brgHP) r += 0.003 + 0.016 * n2 * n2;
      if (on.brk_no4oil && n2 > 0.2) r += (n2 * n2) / 90;   // No. 4 bearing starved of oil
      oil.s.brg = Math.min(1, oil.s.brg + r * dt);
    }
    // ---- starter clutch seized: back-driven above cut-out until it flies apart
    if (on.starterClutch && !st.starterBurst && n2 > 0.4 && fx.gearbox) {
      st.clutchT += dt * (n2 / 0.58) ** 2; g2 += 25; v2 += 1.5;
      if (st.clutchT > 20) { st.starterBurst = true; this._event('starter-burst'); }
    }
    // ---- IDG losing its oil, buffer air cooler blocked: slow consequences
    if (on.brk_idgcooler && fx.gearbox && n2 > 0.1) { const was = st.idgT; st.idgT += dt; if (was <= 30 && st.idgT > 30) this._event('idg-overheat'); }
    if (on.acacFail && n2 > 0.3) st.acacT += dt;
    if (on.mountLink) { v1 += 0.8; v2 += 0.8; }
    // ---- fan cowl doors: lifted open and torn off by the airflow
    if (on.cowlUnlatched && !st.cowlGone && (n1 > 0.6 || (e.u.mach || 0) > 0.15)) { st.cowlGone = true; this._event('fan-cowl-lost'); }
    if (st.separated && e.wear) e.wear.dead = true;
    this.vib1 = v1; this.vib2 = v2; this.drag1 = g1; this.drag2 = g2;

    // ---- oil leaks and seal leakage (read by the oil model on its next update)
    const press = clamp(n2 / 0.5, 0, 1);
    fx.oilLeak = (on.tankPuncture ? 10 : 0) + (on.brk_acocoil ? 0.3 + 6 * press : 0) + (on.brk_oilpress ? 0.4 * press : 0)
      + (on.brk_no4oil ? 4 * press : 0) + (st.starterBurst ? 3 : 0) + (st.separated ? 8 : 0);
    fx.oilSeal = Math.max(on.brk_bufferair ? 0.8 : 0, on.acacFail ? clamp(st.acacT / 90, 0, 0.6) : 0);
    fx.oilHeat = (on.acacFail ? 25e3 : 0) * n2 + (on.brk_bufferair ? 10e3 : 0) * n2;
    // ---- fire: fuel or oil on hot casings in the core compartment, or flame through a case
    const hot = (o.Tm || 288) > 520 || (o.T3 || 288) > 500;
    const servo = on.brk_servofuel && fx.gearbox && st.lpFuel > 0.1 && n2 > 0.08 ? 0.05 * st.lpFuel : 0;
    const manifold = on.manifoldLeak && s.wf > 0.002 ? 0.01 + 0.08 * s.wf : 0;
    const coreFuel = st.spill + servo + manifold, coreOil = on.brk_no4oil ? 4 * press * QT / 60 : 0;
    const pylonFuel = st.separated && e.u.lpValve !== false;
    const torch = st.caseBurnt && o.lit;
    this.feeding = ((coreFuel > 0.004 || coreOil > 0.01 || pylonFuel) && hot) || torch;
    if (this.feeding) {
      st.ignT += dt;
      if (st.ignT > 1.5 && st.fire < 1) {
        st.fire = 1; st.fireT = Math.max(st.fireT, 0); this._event(coreFuel > 0.004 || pylonFuel || torch ? 'fuel-fire' : 'oil-fire');
        // where it burns, for the 3D view
        this.firePart = pylonFuel ? 'pylon' : torch ? 'hptcase' : st.spill > 0.004 ? 'line_meteredfuel' : servo ? 'line_servofuel' : manifold ? 'fuel' : 'line_no4oil';
      }
    } else { st.ignT = Math.min(st.ignT, 0); if (st.fire > 0) st.fire = Math.max(0, st.fire - dt / 40); }   // the residue burns out
    if (st.fire <= 0) this.firePart = null;
    if (st.fire > 0.5) {   // left burning, it cooks the core harnesses: first one EEC channel, then the other
      st.fireT += dt;
      if (st.fireT > 25 && st.harnessFire < 1) { st.harnessFire = 1; this._event('fire-harness'); }
      if (st.fireT > 45 && st.harnessFire < 2) { st.harnessFire = 2; this._event('fire-harness'); }
    }
    this._derive();
    o.fire = Math.max(o.fire || 0, st.fire);

    // ---- what the 3D view shows leaking
    const L = this.leaks; L.length = 0;
    const leak = (part, kind, k) => { if (k > 0.01) L.push({ part, kind, k: clamp(k, 0, 1) }); };
    const fuelGo = st.lpFuel;
    if (on.brk_fuelsupply) leak('line_fuelsupply', 'fuel', e.u.lpValve !== false ? 1 : fuelGo);
    if (on.brk_fcoc) leak('line_fcoc', 'fuel', e.u.lpValve !== false ? 0.9 : fuelGo);
    if (on.brk_meteredfuel) leak('line_meteredfuel', 'fuel', st.spill / 0.3 + 0.1 * (st.spill > 0));
    if (on.brk_servofuel) leak('line_servofuel', 'fuel', servo / 0.05);
    if (on.manifoldLeak) leak('fuel', 'fuel', manifold / 0.05);
    if (on.brk_acocoil) leak('line_acocoil', 'oil', press);
    if (on.brk_oilpress) leak('line_oilpress', 'oil', 0.3 * press);
    if (on.brk_no4oil) leak('line_no4oil', 'oil', press);
    if (on.brk_idgcooler) leak('line_idgcooler', 'oil', st.idgT < 40 ? 0.6 * clamp(n2 / 0.3, 0, 1) : 0);
    if (on.tankPuncture) leak('oiltank', 'oil', oil && oil.s.total > 0.5 ? 0.8 : 0);
    if (st.starterBurst) leak('agb', 'oil', oil && oil.s.total > 0.5 ? 0.6 : 0);
    if (on.brk_hyd) leak('line_hyd', 'hyd', fx.gearbox ? clamp(n2 / 0.2, 0, 1) : 0);
    const airK = clamp(n2 / 0.6, 0, 1.2);
    for (const k of ['antiice', 'bleed7', 'bleed10', 'p3servo', 'accduct', 'bufferair']) if (on[`brk_${k}`]) leak(`line_${k}`, 'air', k === 'accduct' ? clamp(n1 / 0.5, 0, 1) : airK);
    if (on.brk_starterduct && e.u.starterValve) leak('line_starterduct', 'air', 1);
    if (on.diffCrack) leak('combcase', 'air', airK);
    if (pylonFuel) leak('pylon', 'fuel', 1);

    // ---- indications
    if (fx.egtLost) o.egtInd = NaN; else o.egtInd = o.egt + fx.egtBias;
    if (fx.oilPressLost) { o.oilP = 0; o.oilLowP = n2 > 0.2; }
    if (st.lpSeized || fx.lpShear) o.NlptPct = o.NlptPct ?? o.N1pct;
    // ---- ECAM (A320-style wording)
    const E = this.ecam; E.length = 0;
    if (o.fire > 0.5) E.push({ title: 'ENG 1 FIRE', line: 'THR LEVER 1 IDLE · ENG MASTER 1 OFF · ENG 1 FIRE P/B PUSH · AGENT 1 DISCH', level: 'warning' });
    if (fx.eecDead) E.push({ title: 'ENG 1 FADEC FAULT', line: 'BOTH CHANNELS LOST · ENGINE CONTROL LOST', level: 'warning' });
    else if (fx.eecA || fx.eecB) E.push({ title: `ENG 1 FADEC ${fx.eecA ? 'A' : 'B'} FAULT`, line: `CHANNEL ${fx.eecA ? 'B' : 'A'} IN CONTROL`, level: 'caution' });
    if (on.revDeploy) E.push({ title: 'ENG 1 REVERSE UNLOCKED', line: 'THR LEVER 1 IDLE', level: 'caution' });
    if (fx.bleedLeak) E.push({ title: 'AIR ENG 1 BLEED LEAK', line: 'ENG 1 BLEED OFF', level: 'caution' });
    if (fx.hydLost && n2 > 0.1) E.push({ title: 'HYD G ENG 1 PUMP LO PR', line: 'REVERSER INOP', level: 'caution' });
    if (fx.idgLost && n2 > 0.1) E.push({ title: 'ELEC IDG 1 FAULT', line: 'IDG 1 DISCONNECTED · GEN 1 OFF', level: 'caution' });
    if (fx.egtLost) E.push({ title: 'ENG 1 EGT', line: 'INDICATION LOST · NO EGT LIMITING', level: 'caution' });
    if (on.pmaFail || on.towerShaft) E.push({ title: 'ENG 1 ALTERNATOR', line: 'EEC ON AIRCRAFT POWER', level: 'caution' });
    if ((on.brk_fuelsupply || on.brk_fcoc || on.fuelPump || on.towerShaft) && n2 > 0.1) E.push({ title: 'ENG 1 FUEL', line: 'FUEL PRESSURE LOST', level: 'caution' });
  }

  /** Fire bottle: puts out a fire whose source has stopped; one still being fed lights again a few seconds later. */
  extinguish() {
    const st = this.st;
    if (st.fire <= 0) return true;
    st.fire = 0; st.fireT = 0;
    if (this.feeding) { st.ignT = -3; return false; }
    return true;
  }
}
