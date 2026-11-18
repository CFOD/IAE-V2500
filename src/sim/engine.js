// Two-spool turbofan dynamic model (0-D, inter-component volume method).
//
// States: N1, N2 (rpm); total pressures in five gas-path volumes
// (bypass duct P13, inter-compressor P25, combustor P3, inter-turbine P45,
// jet pipe P5); a few fast temperature states; flame, fuel and actuator states.
//
// Each sub-step every component is evaluated from the current states, giving
// mass flows and shaft torques. Mass imbalance in each volume changes its
// pressure; torque imbalance on each spool changes its speed. Steady state,
// transients, starting, surge and flame-out all fall out of the same equations.

import { cp, gamma, h, tFromH, tIsentropic, phi, isa, R_GAS, FAR_STOICH, LHV_JET_A } from './gas.js';
import MAPS from './maps/jt9d.js';
import { makeCompressorMap, makeTableCompressor, makeTurbineTable, compressor, qFlow, turbineFlow, turbineExpand, nozzle, orifice } from './components.js';
import { DESIGN, LIMITS } from './v2500.js';
import { Damage, defaultWear } from './damage.js';
import { Oil } from './oil.js';

const RPM2RAD = 0.104719755;
const T_REF = 298.15;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function fric1(N1) { return 2 + 0.02 * N1 * RPM2RAD; }
function fric2(N2) { return 4 + 0.012 * N2 * RPM2RAD; }

/** Fuel flow to reach T4 from T3 with Wa of air. */
function fuelForT4(Wa, T3, T4, LHV, etab) {
  let wf = Wa * 0.025;
  for (let i = 0; i < 30; i++) {
    const far = wf / Wa;
    const need = (Wa + wf) * (h(T4, far) - h(T_REF, far)) - Wa * (h(T3) - h(T_REF));
    wf = need / (LHV * etab);
  }
  return wf;
}

function designCycle(d, T4) {
  const T2 = 288.15, P0 = 101325, P2 = P0 * d.inletRecovery;
  const Wc = d.W2 / (1 + d.BPR), Wb = d.W2 - Wc;
  const comp = (Tin, pr, eff) => {
    const dh = (h(tIsentropic(Tin, pr)) - h(Tin)) / eff;
    return { T: tFromH(h(Tin) + dh, 0, Tin * 1.2), dh };
  };
  const fan = comp(T2, d.FPR, d.effFan);
  const lpc = comp(T2, d.LPCPR, d.effLpc);
  const HPCPR = d.OPR / d.LPCPR;
  const hpc = comp(lpc.T, HPCPR, d.effHpc);
  const P13 = P2 * d.FPR, P25 = P2 * d.LPCPR, P3 = P25 * HPCPR, P4 = P3 * (1 - d.dpBurner);
  const Wc1 = d.coolNgv * Wc, Wc2 = d.coolRotor * Wc, Wa = Wc - Wc1 - Wc2;
  const wf = fuelForT4(Wa, hpc.T, T4, LHV_JET_A, d.effBurner);
  const far4 = wf / Wa, W4 = Wa + wf;
  // NGV cooling mix
  const W41 = W4 + Wc1, far41 = wf / (Wa + Wc1);
  const T41 = tFromH((W4 * h(T4, far4) + Wc1 * h(hpc.T)) / W41, far41, T4 - 100);
  // HP balance
  const w2 = d.N2d * RPM2RAD, w1 = d.N1d * RPM2RAD;
  const pHP = Wc * hpc.dh + fric2(d.N2d) * w2 + d.accessoryPowerW;
  const dhHpt = pHP / W41, dhsHpt = dhHpt / d.effHpt;
  const TsH = tFromH(h(T41, far41) - dhsHpt, far41, T41 - 300);
  const PRhpt = Math.exp((phi(T41, far41) - phi(TsH, far41)) / R_GAS);
  const P45 = P4 / PRhpt;
  const T45a = tFromH(h(T41, far41) - dhHpt, far41, T41 - 300);
  const W45 = W41 + Wc2, far45 = wf / (Wa + Wc1 + Wc2);
  const T45 = tFromH((W41 * h(T45a, far41) + Wc2 * h(hpc.T)) / W45, far45, T45a);
  // LP balance
  const pLP = Wb * fan.dh + Wc * lpc.dh + fric1(d.N1d) * w1;
  const dhLpt = pLP / W45, dhsLpt = dhLpt / d.effLpt;
  const TsL = tFromH(h(T45, far45) - dhsLpt, far45, T45 - 300);
  const PRlpt = Math.exp((phi(T45, far45) - phi(TsL, far45)) / R_GAS);
  const P5 = P45 / PRlpt;
  const T5 = tFromH(h(T45, far45) - dhLpt, far45, T45 - 300);
  // common nozzle assembly: core and bypass streams meet at a mixing plane with
  // a shared static pressure Pm, mix, and leave through one final nozzle
  const Pt13 = P13 * (1 - d.dpBypass), Pt5 = P5 * (1 - d.dpJetpipe);
  const Pm = Pt13 / Math.pow(1 + 0.2 * d.mixMach * d.mixMach, 3.5);
  const n18 = nozzle(1, Pt13, fan.T, 0, Pm, {});
  const A18 = Wb / n18.W;
  const n8 = nozzle(1, Pt5, T5, far45, Pm, {});
  const A8 = Pt5 > Pm ? W45 / n8.W : 1e9;
  const W7 = Wb + W45, far7 = wf / (W7 - wf);
  const T7 = tFromH((Wb * h(fan.T) + W45 * h(T5, far45)) / W7, far7, 450);
  const Pt7 = ((Wb * Pt13 + W45 * Pt5) / W7) * (1 - d.dpMix);
  const n9 = nozzle(1, Pt7, T7, far7, P0, {});
  const A9 = W7 / n9.W;
  const thrust = Pt5 > Pm ? n9.Fg * A9 : 0;
  const q = qFlow;
  return {
    T2, P2, Wc, Wb, T13: fan.T, T25: lpc.T, T3: hpc.T, P13, P25, P3, P4, HPCPR, wf, far4, W4, T4, T41, far41,
    PRhpt, dhsHpt, P45, T45, W45, far45, PRlpt, dhsLpt, P5, T5, A8, A18, A9, Pm, T7, thrust,
    Khpt: (W4 * Math.sqrt(T4)) / P4 / q(PRhpt), q4d: q(PRhpt),
    Klpt: (W45 * Math.sqrt(T45)) / P45 / q(PRlpt),
  };
}

/** Size the engine so the design cycle delivers the target thrust. */
export function sizeEngine(d = DESIGN) {
  let a = 1500, b = 1700;
  let fa = designCycle(d, a).thrust - d.thrustN, fb = designCycle(d, b).thrust - d.thrustN;
  for (let i = 0; i < 30 && Math.abs(fb) > 1; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b; fa = fb; b = c; fb = designCycle(d, b).thrust - d.thrustN;
  }
  const dp = designCycle(d, b);
  const cfg = { d, dp };
  // Compressor and turbine characteristics: NASA T-MATS JT9D reference maps, scaled to this design point.
  cfg.fan = makeTableCompressor({
    Nd: d.N1d, Td: dp.T2, Pd: dp.P2, Wd: dp.Wb, PRd: d.FPR, effD: d.effFan,
    aW: 0.5, kW: 1.6, sW: 0.7, aP: 0.6, kP: 3, sP: 2.2, c0: 0.05, c1: 0.3,
    xs: (n) => 1.27 - 0.05 * n, U2d: 2.0e5, Awm: 1.1, kEff: 0.7, effFloor: 0.6,
  }, MAPS.Fan, 2.3);
  cfg.lpc = makeTableCompressor({
    Nd: d.N1d, Td: dp.T2, Pd: dp.P2, Wd: dp.Wc, PRd: d.LPCPR, effD: d.effLpc,
    aW: 0.3, kW: 2.6, sW: 0.9, aP: 0.4, kP: 3.5, sP: 2.8, c0: 0.05, c1: 0.3,
    xs: () => 1.22, U2d: 0.7e5, Awm: 0.15, kEff: 0.5, effFloor: 0.6,
  }, MAPS.LPC);
  cfg.hpc = makeTableCompressor({
    Nd: d.N2d, Td: dp.T25, Pd: dp.P25, Wd: dp.Wc, PRd: dp.HPCPR, effD: d.effHpc,
    aW: 0.12, kW: 3.6, sW: 1.5, aP: 0.08, kP: 4.5, sP: 3.0, c0: 0.04, c1: 0.3,
    xs: (n) => 1.24 - 0.12 * Math.exp(-(((n - 0.74) / 0.12) ** 2)), U2d: 1.8e5, Awm: 0.05, kEff: 1.3, effFloor: 0.78,
  }, MAPS.HPC);
  cfg.hpt = { Nd: d.N2d, Td: dp.T41, dhsD: dp.dhsHpt, effD: d.effHpt, K: dp.Khpt, PRd: dp.PRhpt, kPR: 0.04, kClr: 0.15, table: makeTurbineTable(MAPS.HPT, 100, 4.5) };
  cfg.lpt = { Nd: d.N1d, Td: dp.T45, dhsD: dp.dhsLpt, effD: d.effLpt, K: dp.Klpt, PRd: dp.PRlpt, kPR: 0.15, kClr: 0.08, table: makeTurbineTable(MAPS.LPT, 100, 5.9) };
  // Adaptation of the scaled reference maps to this engine (see docs/PHYSICS.md, "Map adaptation").
  // The JT9D tables peak well above their design-line efficiency; scaled as they are that would give
  // a fan better than any built. The peaks are held to values typical of this generation.
  cfg.fan.effPeak = 0.915; cfg.hpc.effPeak = 0.875;
  cfg.lpc.effTrim = (n) => 1 - 0.2 * Math.max(0, 1 - n);
  // The V2500 core idles at 58.5 % N2 with far more flow than the JT9D HPC passes at that speed
  // (ten stages with five variable rows against eleven with four): low-speed flow and pressure
  // rise are raised together so the working line keeps its place on the map.
  { const fw = cfg.hpc.fW, fp = cfg.hpc.fP, r = (n) => 1 + 0.45 * clamp((0.85 - n) / 0.25, 0, 1.2);
    cfg.hpc.fW = (n) => fw(n) * r(n); cfg.hpc.fP = (n) => fp(n) * r(n); }
  cfg.q4d = dp.q4d;
  cfg.A8 = dp.A8;
  cfg.A18 = dp.A18;
  cfg.A9 = dp.A9;
  cfg.Acas = 0.8 * dp.A18; // effective flow area of the reverser cascades
  cfg.revTurn = 0.55; // fraction of cascade gross thrust that acts forwards (efflux angled ~45 deg, with losses)
  cfg.A25 = 0.07; // LPC (2.5) bleed ring max effective area, m^2
  cfg.Aacc = 0.003; // clearance-control air, both valves open: about 0.3 % of the bypass flow
  // handling bleed flow capacities W*sqrt(T)/P for one 7th-stage valve and the 10th-stage valve
  cfg.K7 = (0.035 * dp.Wc * Math.sqrt(dp.T3)) / dp.P3;
  cfg.K10 = (0.06 * dp.Wc * Math.sqrt(dp.T3)) / dp.P3;
  cfg.metalHeatCap = 75e3; // J/K, lumped turbine metal
  cfg.vol = { v13: 3.0, v25: 0.35, v3: 0.25, v45: 0.15, v5: 0.6, v7: 1.2 };
  return cfg;
}

/** FADEC variable stator vane schedule: degrees closed vs HPC corrected speed fraction. */
export function vsvSchedule(n) {
  return 38 * clamp((0.92 - n) / (0.92 - 0.55), 0, 1);
}

export function defaultInputs() {
  return {
    wfCmd: 0, // metered fuel flow, kg/s
    ignition: false,
    starterValve: false,
    starterPsi: 40, // starter duct pressure, psig (APU bleed ~ 35-45)
    vsv: null, // deg closed; null = follow schedule
    bleed25: 0, // 0..1 LPC bleed ring
    bleed7: 0, // number of 7th-stage handling bleed valves open (0-3)
    bleed10: 0, // 0/1 10th-stage handling bleed
    custBleed: 0, // customer bleed, fraction of core flow
    offtakeW: DESIGN.accessoryPowerW,
    alt: 0, // m
    dTisa: 0, // K
    mach: 0,
    reverser: false, // thrust reverser deployed
    accHpt: 0, // active clearance control valves, 0..1 (fan air on the HP / LP turbine cases)
    accLpt: 0,
  };
}

export function defaultMods() {
  return {
    effFan: 0, effLpc: 0, effHpc: 0, effHpt: 0, effLpt: 0, // efficiency deltas
    flowFan: 1, flowLpc: 1, flowHpc: 1, flowHpt: 1, flowLpt: 1, // capacity multipliers
    a8: 1, a18: 1, a9: 1, // core mixer, bypass mixer and final nozzle area multipliers
    lhv: LHV_JET_A,
    cooling: 1, // turbine cooling flow multiplier
  };
}

export class Engine {
  constructor(cfg = sizeEngine()) {
    this.cfg = cfg;
    this.u = defaultInputs();
    this.mods = defaultMods(); this.wear = defaultWear(); this.mEff = defaultMods();
    this.o = { fan: {}, lpc: {}, hpc: {}, hptF: {}, lptF: {}, hpt: {}, lpt: {}, n8: {}, n18: {}, n9: {}, ncas: {} };
    this.out = { W2: 0 };
    this.events = []; // {t, type}
    this.subDt = 0.0005;
    this.initCold();
    this.oil = new Oil(this);
    this.damage = new Damage(this);
  }

  ambient() {
    const u = this.u;
    const a = isa(u.alt, u.dTisa);
    const g = 1.4;
    const ram = 1 + 0.2 * u.mach * u.mach;
    return {
      P0: a.P, T0: a.T, V0: u.mach * Math.sqrt(g * R_GAS * a.T),
      T2: a.T * ram, Pt0: a.P * Math.pow(ram, 3.5),
    };
  }

  initCold() {
    const a = this.ambient();
    this.s = {
      t: 0, N1: 0, N2: 0,
      P13: a.Pt0, P25: a.Pt0, P3: a.Pt0, P45: a.Pt0, P5: a.Pt0, Pm: a.P0, T7: a.T2,
      T13: a.T2, T25: a.T2, T3: a.T2, T4: a.T2, T45: a.T2, T5: a.T2,
      lit: false, ignTimer: 0, pool: 0, wf: 0, vsv: vsvSchedule(0), b25: 1,
      egt: a.T2, Tm: a.T2, q4: 0, rev: 0, fanSt: { stalled: false, stallTime: 0 }, lpcSt: { stalled: false, stallTime: 0 },
      hpcSt: { stalled: false, stallTime: 0 }, fuelUsed: 0,
    };
    this._eval(0);
  }

  /** Jump to the sized design point (max take-off, running). */
  initDesign() {
    const { d, dp } = this.cfg;
    Object.assign(this.s, {
      N1: d.N1d, N2: d.N2d, P13: dp.P13, P25: dp.P25, P3: dp.P3, P45: dp.P45, P5: dp.P5,
      T13: dp.T13, T25: dp.T25, T3: dp.T3, T4: dp.T4, T45: dp.T45, T5: dp.T5,
      lit: true, wf: dp.wf, vsv: 0, b25: 0, egt: dp.T5, pool: 0, Tm: dp.T45, q4: 1, Pm: dp.Pm, T7: dp.T7,
    });
    this.u.wfCmd = dp.wf;
    this.u.bleed25 = 0;
    this._eval(0);
  }

  step(dt) {
    const n = Math.max(1, Math.round(dt / this.subDt));
    const h = dt / n;
    // hardware condition = the player's settings combined with accumulated damage
    const me = this.mEff, mo = this.mods, w = this.wear;
    for (const k in mo) me[k] = k.startsWith('eff') ? Math.max(mo[k] + (w[k] || 0), -0.9) : mo[k] * (w[k] ?? 1);
    if (w.dead) { this.s.wf = 0; this.s.lit = false; this.s.pool = 0; }
    for (let i = 0; i < n; i++) this._eval(h);
    // slow sensor: EGT thermocouples (lag grows when there is little flow over them)
    const tau = 1.5 + 40 / (1 + Math.max(0, this.out.W45) * 3);
    this.s.egt += (this.s.T5 - this.s.egt) * Math.min(1, dt / tau);
    this.out.egt = this.s.egt;
    if (w.seized2) this.s.N2 = 0;
    if (w.seized1) this.s.N1 = 0;
    if (this.out.W45 < 0.5) this.s.Tm -= (this.s.Tm - (this.out.T0 = this.ambient().T0)) * Math.min(1, dt / 2400); // standing engine cools to ambient over an hour or so
    if (this.oil) this.oil.update(dt);
    if (this.damage) this.damage.update(dt);
  }

  _eval(dt) {
    const s = this.s, u = this.u, c = this.cfg, d = c.d, m = this.mEff, o = this.o;
    const amb = this.ambient();
    const { P0, T2, V0 } = amb;
    // duct losses scale with dynamic head (zero loss at zero flow)
    const wRel = clamp(((this.out.W2 || 0) / d.W2) * (101325 / amb.Pt0) * Math.sqrt(T2 / 288.15), 0, 1.2);
    const P2 = amb.Pt0 * (1 - (1 - d.inletRecovery) * wRel * wRel);
    amb.P2 = P2;
    const lossByp = d.dpBypass * clamp((s.P13 / s.Pm - 1) / (c.dp.P13 / c.dp.Pm - 1), 0, 1.3);
    const lossJet = d.dpJetpipe * clamp((s.P5 / s.Pm - 1) / (c.dp.P5 / c.dp.Pm - 1), 0, 1.3);

    // ---- actuators & fuel system
    if (dt > 0) {
      s.t += dt;
      s.wf += (Math.max(0, u.wfCmd) - s.wf) * Math.min(1, dt / 0.08);
      s.b25 += clamp(u.bleed25 - s.b25, -dt / 0.4, dt / 0.4);
      s.rev = clamp((s.rev || 0) + (u.reverser ? dt : -dt) / 2.0, 0, 1); // about two seconds to travel
      // Active clearance control: fan air sprayed on the turbine cases shrinks them onto the blade tips.
      // The cases respond in tens of seconds (thin HPT case faster than the LPT's); with no fan pressure
      // there is no cooling air.
      const fanAir = clamp((s.P13 / P0 - 1) / 0.12, 0, 1);
      s.accH = (s.accH || 0) + ((u.accHpt || 0) * fanAir - (s.accH || 0)) * Math.min(1, dt / 15);
      s.accL = (s.accL || 0) + ((u.accLpt || 0) * fanAir - (s.accL || 0)) * Math.min(1, dt / 25);
      this._n2dot = (100 * (s.N2 - (this._n2prev ?? s.N2))) / LIMITS.N2_100 / dt; this._n2prev = s.N2; // % N2 per second
    }

    // ---- low pressure compression system
    compressor(c.fan, s.fanSt, s.N1, T2, P2, s.P13, { flow: m.flowFan, eff: m.effFan, xs: 0 }, dt, o.fan);
    compressor(c.lpc, s.lpcSt, s.N1, T2, P2, s.P25, { flow: m.flowLpc, eff: m.effLpc, xs: 0 }, dt, o.lpc);
    const kT = dt > 0 ? Math.min(1, dt / 0.01) : 1;
    if (o.fan.W > 0) s.T13 += (o.fan.Tout - s.T13) * kT;
    if (o.lpc.W > 0) s.T25 += (o.lpc.Tout - s.T25) * kT;
    const Wb25 = orifice(c.A25 * s.b25, s.P25, s.T25, s.P13);
    // clearance-control air leaves the bypass duct and is dumped in the core compartment
    const Wacc = orifice(c.Aacc * (0.4 * (u.accHpt || 0) + 0.6 * (u.accLpt || 0)), s.P13, s.T13, P0);
    // closer tips: up to about 1.2 points on the HP turbine and 0.8 on the LP turbine, once the cases are hot
    // enough to have grown away from the blades in the first place (worth about 1 % of cruise fuel burn)
    const hotCase = clamp(((s.Tm || T2) - 600) / 250, 0, 1);
    const accEffH = 0.012 * (s.accH || 0) * hotCase, accEffL = 0.008 * (s.accL || 0) * hotCase;

    // ---- HP compressor with variable stators
    const n2c = clamp((s.N2 / c.hpc.Nd) * Math.sqrt(c.hpc.Td / s.T25), 0, 1.25);
    const vsvSched = vsvSchedule(n2c);
    const vsvCmd = u.vsv == null ? vsvSched : u.vsv;
    if (dt > 0) s.vsv += clamp(vsvCmd - s.vsv, -30 * dt, 30 * dt);
    const dv = s.vsv - vsvSched; // + = more closed than schedule
    const hpcMod = {
      flow: m.flowHpc * clamp(1 - 0.012 * dv, 0.4, 1.3),
      eff: m.effHpc - 0.00025 * dv * dv,
      xs: clamp(0.005 * dv, -0.3, 0.1),
    };
    compressor(c.hpc, s.hpcSt, s.N2, s.T25, s.P25, s.P3, hpcMod, dt, o.hpc);
    if (o.hpc.W > 0) s.T3 += (o.hpc.Tout - s.T3) * kT;
    const sq3 = Math.sqrt(s.T3);
    const Wb7 = (u.bleed7 * c.K7 * s.P3) / sq3 * (s.P3 > s.P13 ? 1 : 0);
    const Wb10 = (u.bleed10 * c.K10 * s.P3) / sq3 * (s.P3 > s.P13 ? 1 : 0);
    const Whp = Math.max(o.hpc.W, 0);
    const Wcust = u.custBleed * Whp;
    const Wc1 = d.coolNgv * m.cooling * Whp;
    const Wc2 = d.coolRotor * m.cooling * Whp;
    // interstage bleeds leave before the last stages: refund the work not done on them
    const dhHpc = Whp > 1e-6 ? o.hpc.power / Math.max(Whp, 1e-6) : 0;
    const hpcTorque = o.hpc.torque * (Whp > 1e-3 ? 1 - (0.35 * (Wb7 + Wcust)) / Math.max(Whp, 1e-3) : 1);

    // ---- combustor
    const P4 = s.P3 * (1 - d.dpBurner * s.q4 * s.q4);
    turbineFlow(c.hpt.K * m.flowHpt, s.T4, P4, s.P45, o.hptF);
    const W4 = o.hptF.W;
    s.q4 = clamp((W4 * Math.sqrt(s.T4)) / (P4 * c.hpt.K * m.flowHpt * c.q4d), 0, 1.2);
    let poolBurn = 0;
    if (dt > 0) {
      if (s.lit) { poolBurn = s.pool / 1.5; s.pool -= poolBurn * dt; }
      else { s.pool += s.wf * dt; s.pool -= s.pool * 0.25 * dt; }
    }
    const wfIn = s.wf + poolBurn;
    const Wa = W4 - wfIn;
    const far = Wa > 0.02 ? wfIn / Wa : wfIn > 0 ? 1 : 0;
    const leanLimit = 0.0035 * Math.pow((3 * 101325) / Math.max(s.P3, 2e4), 0.25);
    if (dt > 0) {
      if (s.lit) {
        if (far < leanLimit || far > 0.5 || Wa <= 0.02) { // far beyond stoichiometric the flame still holds; the excess burns downstream
          s.lit = false; s.ignTimer = 0;
          this.events.push({ t: s.t, type: far < leanLimit ? 'flameout-lean' : 'flameout-rich' });
        }
      } else if (u.ignition && far > Math.max(leanLimit * 1.5, 0.006) && far < 0.25 && Wa > 0.2) {
        s.ignTimer += dt;
        if (s.ignTimer > 0.7) { s.lit = true; this.events.push({ t: s.t, type: 'lightoff' }); }
      } else s.ignTimer = 0;
    }
    let wfBurn = 0, farB = 0, etab = 0, T4eq = s.T3;
    if (s.lit && Wa > 0.02) {
      wfBurn = Math.min(wfIn, FAR_STOICH * Wa);
      farB = wfBurn / Wa;
      etab = clamp(d.effBurner - 0.25 * Math.pow(1e5 / Math.max(s.P3, 2e4), 1.8), 0.6, 1);
      const hm = (Wa * (h(s.T3) - h(T_REF)) + wfBurn * m.lhv * etab) / (Wa + wfBurn);
      T4eq = tFromH(hm + h(T_REF, farB), farB, s.T4);
    }
    if (dt > 0) s.T4 += (T4eq - s.T4) * Math.min(1, dt / 0.015);

    // ---- HP turbine
    const W41 = W4 + Wc1;
    let far41 = 0, T41 = s.T4;
    if (W41 > 1e-3 && W4 > 0) {
      far41 = wfBurn / Math.max(Wa + Wc1, 1e-3);
      T41 = tFromH((W4 * h(s.T4, farB) + Wc1 * h(s.T3)) / W41, far41, s.T4);
    }
    turbineExpand(c.hpt, W41, T41, far41, P4 / s.P45, s.N2, m.effHpt + accEffH, o.hpt);
    const W45in = W41 + Wc2;
    let far45 = 0, T45 = o.hpt.Tout;
    if (W45in > 1e-3 && W41 > 0) {
      far45 = wfBurn / Math.max(Wa + Wc1 + Wc2, 1e-3);
      T45 = tFromH((W41 * h(o.hpt.Tout, far41) + Wc2 * h(s.T3)) / W45in, far45, o.hpt.Tout);
    }
    // heat soak: gas exchanges heat with the turbine metal (discs, blades, cases)
    if (W45in > 1e-3) {
      const eps = 1 - Math.exp(-0.6 / Math.pow(Math.max(W45in, 0.05), 0.3));
      const dT = eps * (T45 - s.Tm);
      if (dt > 0) s.Tm += (dt * W45in * 1150 * dT) / c.metalHeatCap;
      T45 -= dT;
    }
    if (W45in > 0) s.T45 += (T45 - s.T45) * kT;

    // ---- LP turbine
    turbineFlow(c.lpt.K * m.flowLpt, s.T45, s.P45, s.P5, o.lptF);
    const W45 = o.lptF.W;
    turbineExpand(c.lpt, W45, s.T45, far45, s.P45 / s.P5, s.N1, m.effLpt + accEffL, o.lpt);
    if (W45 > 0) s.T5 += (o.lpt.Tout - s.T5) * kT;

    // ---- nozzles
    const Pt5 = s.P5 * (1 - lossJet), Pt13 = s.P13 * (1 - lossByp);
    nozzle(c.A8 * m.a8, Pt5, s.T5, far45, s.Pm, o.n8);
    // reverser: blocker doors close the bypass duct ahead of the mixer and the cascades open to ambient
    const rev = s.rev || 0;
    nozzle(c.A18 * m.a18 * (1 - 0.97 * rev), Pt13, s.T13, 0, s.Pm, o.n18);
    nozzle(c.Acas * rev, Pt13, s.T13, 0, P0, o.ncas);
    const Wc7 = Math.max(o.n8.W, 0), Wb7m = Math.max(o.n18.W, 0), W7 = Wc7 + Wb7m;
    let Pt7 = s.Pm, far7 = 0;
    if (W7 > 0.01) {
      far7 = (far45 / (1 + far45)) * Wc7 / Math.max(W7 - (far45 / (1 + far45)) * Wc7, 1e-3);
      const T7 = tFromH((Wb7m * h(s.T13) + Wc7 * h(s.T5, far45)) / W7, far7, s.T7);
      s.T7 += (T7 - s.T7) * kT;
      Pt7 = Math.max(s.Pm, ((Wb7m * Pt13 + Wc7 * Pt5) / W7) * (1 - d.dpMix * clamp((s.Pm / P0 - 1) / (c.dp.Pm / 101325 - 1), 0, 1.3)));
    }
    if (rev > 0 && W7 > 0.01) {
      // Blocker doors shut: the core jet dumps into a tailpipe sized for five times its flow and
      // loses its dynamic head. Total pressure there is what continuity over the whole duct allows.
      const g7 = gamma(s.T7, far7), At = c.A8 + c.A18;
      let M = 0.3;
      for (let i = 0; i < 3; i++) M = Math.min(1, (W7 * Math.sqrt((R_GAS * s.T7) / (g7 * (1 + 0.5 * (g7 - 1) * M * M)))) / (Math.max(s.Pm, 2e4) * At));
      const cap = s.Pm * (1 + 0.5 * (g7 - 1) * M * M) ** (g7 / (g7 - 1));
      Pt7 += (Math.min(Pt7, cap) - Pt7) * rev;
    }
    nozzle(c.A9 * m.a9, Pt7, s.T7, far7, P0, o.n9);

    // ---- shaft torques
    const w2 = Math.max(s.N2, 30) * RPM2RAD;
    const accPower = u.offtakeW * Math.min(1, s.N2 / (0.5 * LIMITS.N2_100));
    let tStart = 0;
    if (u.starterValve) // stall torque from the data sheet: 637 N.m at the starter pad (0.941 x N2), reached at full duct pressure (~50 psi)
      tStart = LIMITS.STARTER_TORQUE_MAX * LIMITS.STARTER_GEAR * (u.starterPsi / 50) * Math.max(0, 1 - s.N2 / (0.72 * LIMITS.N2_100));
    const tq2 = o.hpt.torque - hpcTorque - (s.N2 > 1 ? fric2(s.N2) : 0) - accPower / w2 + tStart - (s.N2 > 1 ? this.wear.drag2 : 0);
    const tq1 = o.lpt.torque - o.fan.torque - o.lpc.torque - (s.N1 > 1 ? fric1(s.N1) + this.wear.drag1 : 0);

    // ---- integrate
    if (dt > 0) {
      const gR = 1.35 * R_GAS;
      const upd = (P, T, V, net, S) => {
        const k = (gR * T) / V;
        return Math.max(P + (dt * k * net) / (1 + dt * k * S), 0.2 * P0);
      };
      const P13 = upd(s.P13, s.T13, c.vol.v13, o.fan.W + Wb25 + Wb7 + Wb10 - o.n18.W - o.ncas.W - Wacc, o.fan.dWdPout + o.n18.dWdP + (o.ncas.dWdP || 0));
      const P25 = upd(s.P25, s.T25, c.vol.v25, o.lpc.W - Wb25 - o.hpc.W, o.lpc.dWdPout + o.hpc.dWdPin);
      const P3 = upd(s.P3, s.T3, c.vol.v3, o.hpc.W - Wb7 - Wb10 - Wcust - Wc1 - Wc2 - Wa,
        o.hpc.dWdPout + o.hptF.dUp + (Wb7 + Wb10) / s.P3);
      const P45 = upd(s.P45, s.T45, c.vol.v45, W45in - W45, o.hptF.dDown + o.lptF.dUp);
      const P5 = upd(s.P5, s.T5, c.vol.v5, W45 - o.n8.W, o.lptF.dDown + o.n8.dWdP);
      const Pm = upd(s.Pm, s.T7, c.vol.v7, o.n8.W + o.n18.W - o.n9.W, o.n8.dWdP + o.n18.dWdP + o.n9.dWdP);
      s.P13 = P13; s.P25 = P25; s.P3 = P3; s.P45 = P45; s.P5 = P5; s.Pm = Pm;
      s.N2 = Math.max(0, s.N2 + (dt * tq2) / d.I2 / RPM2RAD);
      s.N1 = Math.max(0, s.N1 + (dt * tq1) / d.I1 / RPM2RAD);
      s.fuelUsed += s.wf * dt;
      if (o.fan.surgeEvent) this.events.push({ t: s.t, type: 'surge-fan' });
      if (o.lpc.surgeEvent) this.events.push({ t: s.t, type: 'surge-lpc' });
      if (o.hpc.surgeEvent) this.events.push({ t: s.t, type: 'surge-hpc' });
    }

    // ---- outputs
    const out = this.out;
    const W2 = o.fan.W + o.lpc.W;
    out.t = s.t;
    out.amb = amb;
    out.N1 = s.N1; out.N2 = s.N2;
    out.N1pct = (100 * s.N1) / LIMITS.N1_100; out.N2pct = (100 * s.N2) / LIMITS.N2_100;
    out.thrust = o.n9.Fg - c.revTurn * o.ncas.Fg - W2 * V0;
    out.rev = rev; out.Wcas = o.ncas.W;
    out.Fg = o.n9.Fg;
    out.epr = s.P5 / P2;
    out.W2 = W2; out.Wbypass = o.fan.W; out.Wcore = o.hpc.W; out.Wlpc = o.lpc.W;
    out.bpr = o.lpc.W > 0.01 ? o.fan.W / o.lpc.W : 0;
    out.opr = s.P3 / P2;
    out.wf = s.wf; out.wfBurn = wfBurn; out.wfUnburnt = Math.max(0, wfIn - wfBurn) * (s.lit ? 1 : 0);
    out.torch = s.lit ? Math.max(0, wfIn - wfBurn) : 0; // unburnt fuel leaving the combustor alight: flames through the turbine and out of the tailpipe
    out.far = far; out.farBurn = farB; out.phi = far / FAR_STOICH; out.etab = etab; out.lit = s.lit;
    out.pool = s.pool; out.leanLimit = leanLimit;
    out.P0 = P0; out.P2 = P2; out.T2 = T2; out.P13 = s.P13; out.T13 = s.T13; out.P25 = s.P25; out.T25 = s.T25;
    out.P3 = s.P3; out.T3 = s.T3; out.P4 = P4; out.T4 = s.T4; out.T41 = T41; out.P45 = s.P45; out.T45 = s.T45;
    out.P5 = s.P5; out.T5 = s.T5; out.W4 = W4; out.W45 = W45; out.W8 = o.n8.W; out.W18 = o.n18.W;
    out.V8 = o.n8.V; out.V18 = o.n18.V; out.M8 = o.n8.M; out.M18 = o.n18.M;
    out.Pm = s.Pm; out.Pt7 = Pt7; out.T7 = s.T7; out.W9 = o.n9.W; out.V9 = o.n9.V; out.M9 = o.n9.M;
    out.Wb25 = Wb25; out.Wb7 = Wb7; out.Wb10 = Wb10; out.Wcust = Wcust; out.Wcool = Wc1 + Wc2;
    out.accH = s.accH || 0; out.accL = s.accL || 0; out.Wacc = Wacc; out.accEff = [accEffH, accEffL];
    // Tip pinch: a case shrunk by clearance control while the rotor grows fast (hard acceleration to high
    // speed). The schedule leaves margin for flight; the rotor grows most at sea-level take-off power on a
    // warm day, so that is where a case held shrunk by hand gets rubbed.
    out.accPinch = Math.max(s.accH || 0, 0.7 * (s.accL || 0)) * clamp((100 * s.N2 / LIMITS.N2_100 - 90) / 5, 0, 1)
      * clamp((this._n2dot || 0) / 3, 0, 1) * clamp((T2 - 262) / 26, 0, 1);
    out.Tm = s.Tm; out.vsv = s.vsv; out.vsvSched = vsvSched; out.b25 = s.b25; out.n2c = n2c;
    out.fan = o.fan; out.lpc = o.lpc; out.hpc = o.hpc; out.hpt = o.hpt; out.lpt = o.lpt;
    out.hptPR = P4 / s.P45; out.lptPR = s.P45 / s.P5;
    out.ignOn = u.ignition; out.fuelUsed = s.fuelUsed;
    out.tq1 = tq1; out.tq2 = tq2; out.tStart = tStart;
    out.accPower = accPower; out.starterAir = !!u.starterValve; out.starterPsi = u.starterPsi;   // for the accessory cards
    out.pwrFan = o.fan.power; out.pwrLpc = o.lpc.power; out.pwrHpc = o.hpc.power;
    out.pwrHpt = o.hpt.power; out.pwrLpt = o.lpt.power;
    out.sfc = out.thrust > 100 ? (s.wf / out.thrust) * 3600 * 9.80665 : 0; // lb/lbf/h == kg/kgf/h
    if (out.egt === undefined) out.egt = s.egt;
    return out;
  }
}
