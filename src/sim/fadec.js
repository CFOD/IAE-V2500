// Simplified Electronic Engine Control (FADEC) for the V2500 model.
//
// Like the real EEC it sets thrust on EPR (P4.9/P2), governs idle on N2,
// limits N1 / N2 / EGT, bounds fuel between acceleration and deceleration
// schedules expressed as Wf/P3, schedules the variable stator vanes and
// handling bleeds, and runs the automatic start sequence.
//
// Every output channel can be overridden by the player ("manual"), which is
// how you get to do everything the real control laws exist to prevent.

import { LIMITS, RATINGS, LBF } from './v2500.js';
import { isa } from './gas.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerpTable = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
};

// Sea-level-static thrust [kN] -> EPR for this model (tools/calibrate.js; checked by tests).
// Ratings are stored as certified thrust and converted to an EPR target, as the
// real EEC stores EPR rating tables.
export const EPR_VS_THRUST = [[0,1.0],[4.2,1.011],[6,1.016],[7.8,1.021],[13.9,1.037],[19.6,1.052],[25.1,1.073],[34.3,1.108],[44.3,1.147],[56.4,1.218],[67.6,1.284],[79.6,1.365],[88,1.427],[96,1.491],[103.7,1.556],[111.1,1.622],[118.3,1.688],[125.2,1.754],[133,1.832],[140.5,1.909],[146.7,1.971]];
export const eprForThrust = (kN) => lerpTable(EPR_VS_THRUST, kN);

// Steady-state fuel ratio Wf/P3 [kg/s per bar] vs corrected N2 % (from calibration)
export const RU_STEADY = [[20,0.03],[45,0.031],[55.9,0.0307],[62.2,0.0293],[71.5,0.03],[78.1,0.0298],[83.7,0.0318],[88.2,0.0344],[90.8,0.0363],[93.1,0.0381],[95,0.0398],[97,0.0417],[98.5,0.0426],[104.5,0.046]];
const ACCEL_MARGIN = [[20, 1.25], [36, 1.3], [44, 1.55], [56, 1.45], [62, 1.38], [75, 1.42], [97, 1.3]];
const DECEL_FRAC = 0.5;

export class Fadec {
  constructor(engine) {
    this.eng = engine;
    // pilot / player inputs
    this.master = false; // ENG MASTER switch (HP fuel shut-off valve)
    this.tla = 0; // thrust lever 0..1 (idle..TOGA)
    this.rating = 'V2527-A5';
    this.manStart = false; // manual start pushbutton (opens start valve)
    // manual overrides: null = FADEC authority
    this.ovr = { fuel: null, ignition: null, starter: null, vsv: null, bleed25: null, bleed7: null, bleed10: null };
    // internal
    this.phase = 'off'; // off | crank | lightup | accel | run | abort
    this.wf = 0;
    this.msg = '';
    this.timer = 0;
    this.surgeHold = 0;
    this.limiter = '';
    this._prevN2 = 0;
    this._evIdx = 0;
    this.auto = {};
  }

  /** EPR limits for the selected rating: take-off and max continuous. */
  eprLimits(out) {
    const r = RATINGS[this.rating];
    // Take-off is flat rated: constant EPR up to ISA + flatISA, then EPR falls so that
    // turbine temperature stays near its corner-point value.
    const isaT = isa(this.eng.u.alt, 0).T;
    const over = Math.max(0, out.amb.T0 - (isaT + r.flatISA));
    const lapse = 1 - 0.0075 * over;
    const to = 1 + (eprForThrust((r.toLbf * LBF) / 1000) - 1) * lapse;
    const overM = Math.max(0, out.amb.T0 - (isaT + 10));
    const mct = Math.min(to, 1 + (eprForThrust((r.mctLbf * LBF) / 1000) - 1) * (1 - 0.0075 * overM));
    return { to, mct, clb: 1 + (mct - 1) * 0.93 };
  }

  /** Thrust lever -> EPR command through the detents: idle 0, CLB 0.70, FLX/MCT 0.85, TOGA 1. */
  eprCommand(out) {
    const L = this.eprLimits(out), t = this.tla;
    if (t >= 0.85) return L.mct + ((L.to - L.mct) * (t - 0.85)) / 0.15;
    if (t >= 0.7) return L.clb + ((L.mct - L.clb) * (t - 0.7)) / 0.15;
    return 1 + ((L.clb - 1) * t) / 0.7;
  }

  idleN2(out) {
    return clamp(58.5 * Math.sqrt(out.T2 / 288.15), 54, 68);
  }

  update(dt) {
    const eng = this.eng, o = eng.out, u = eng.u;
    const theta = Math.sqrt(o.T2 / 288.15);
    const n2 = o.N2pct, n2c = n2 / theta, n1c = o.N1pct / theta;
    const egtC = o.egt - 273.15;
    const p3bar = o.P3 / 1e5;
    const n2dot = dt > 0 ? (n2 - this._prevN2) / dt : 0;
    this._prevN2 = n2;

    // surge detection (real EEC watches P3 decay rate)
    for (; this._evIdx < eng.events.length; this._evIdx++) {
      if (eng.events[this._evIdx].type.startsWith('surge')) this.surgeHold = 3;
    }
    if (this.surgeHold > 0) this.surgeHold -= dt;

    // ---------------- start / run state machine
    let ign = false, starter = false, fuelOn = false;
    const idle = this.idleN2(o);
    if (!this.master) {
      this.phase = this.manStart ? 'crank' : 'off';
      starter = this.manStart && n2 < LIMITS.STARTER_CUTOUT_N2;
      this.msg = this.manStart ? 'DRY CRANK' : '';
      this.timer = 0;
    } else {
      switch (this.phase) {
        case 'off':
        case 'crank':
          if (o.lit && n2 > idle - 4) { this.phase = 'run'; break; }
          starter = true; this.cutout = false;
          ign = n2 >= LIMITS.MIN_START_N2;
          this.msg = 'START VALVE OPEN';
          this.timer += dt;
          if (n2 >= 22 || (this.timer > 35 && n2 > 15)) { this.phase = 'lightup'; this.timer = 0; }
          break;
        case 'lightup':
          starter = true; ign = true; fuelOn = true;
          this.msg = 'IGNITION - FUEL ON';
          this.timer += dt;
          if (o.lit) { this.phase = 'accel'; this.timer = 0; }
          else if (this.timer > 15) { this.phase = 'abort'; this.msg = 'NO LIGHT-UP - START ABORTED'; this.timer = 0; }
          break;
        case 'accel':
          if (n2 >= LIMITS.STARTER_CUTOUT_N2) this.cutout = true; // latched: the starter is not re-engaged
          starter = !this.cutout; ign = starter; fuelOn = true;
          this.msg = 'STARTING';
          this.timer += dt;
          if (!o.lit) { this.phase = 'lightup'; this.timer = 0; }
          if (egtC > LIMITS.EGT_START) { this.phase = 'abort'; this.msg = 'HOT START - ABORTED'; this.timer = 0; }
          else if (n2 >= idle - 1) { this.phase = 'run'; this.msg = ''; }
          else if (this.timer > 90) this.msg = 'HUNG START';
          break;
        case 'abort':
          // fuel off, dry crank to cool, then wait for master to be cycled
          this.timer += dt;
          starter = this.timer < 30 && n2 < LIMITS.STARTER_CUTOUT_N2;
          break;
        case 'run':
          fuelOn = true;
          this.msg = '';
          if (!o.lit) { ign = true; this.msg = 'FLAME OUT - AUTO RELIGHT'; if (n2 < 30) this.phase = 'crank'; }
          if (this.surgeHold > 0) { ign = true; this.msg = 'ENGINE STALL'; }
          break;
      }
    }

    // ---------------- fuel metering
    const ruSS = lerpTable(RU_STEADY, n2c);
    let ruAcc = ruSS * lerpTable(ACCEL_MARGIN, n2c);
    const ruDec = ruSS * DECEL_FRAC;
    if (this.surgeHold > 0) ruAcc *= 0.8;
    let wf = 0;
    this.limiter = '';
    if (fuelOn) {
      if (this.phase === 'lightup') {
        wf = Math.max(0.033, 0.03 * p3bar);
      } else if (this.phase === 'accel') {
        // open-loop start schedule trimmed by EGT
        const trim = clamp((LIMITS.EGT_START - 15 - egtC) / 40, 0.55, 1);
        wf = Math.max(0.03, ruAcc * p3bar * trim);
        this.limiter = trim < 1 ? 'EGT (start)' : 'accel sched';
      } else {
        const eprCmd = this.eprCommand(o);
        const egtLim = this.tla > 0.86 ? RATINGS[this.rating].egtTO : LIMITS.EGT_MCT;
        // loop errors normalised to "fraction of fuel flow per second"
        const cand = [
          [(eprCmd - o.epr) * 3.0, 'EPR'],
          [(LIMITS.N1_RED - 0.5 - o.N1pct) * 0.15, 'N1 limit'],
          [(LIMITS.N2_RED - 0.5 - n2) * 0.25, 'N2 limit'],
          [(egtLim - 5 - egtC) * 0.012, 'EGT limit'],
        ];
        let e = cand[0];
        for (const cnd of cand) if (cnd[0] < e[0]) e = cnd;
        const eIdle = (idle - n2) * 0.25 - n2dot * 0.08;
        if (eIdle > e[0] && e[1] === 'EPR') e = [eIdle, 'idle'];
        this.limiter = e[1];
        const scale = Math.max(this.wf, 0.05);
        wf = this.wf + clamp(e[0], -1.5, 1.5) * scale * dt;
        const hi = ruAcc * p3bar, lo = Math.max(ruDec * p3bar, 0.022);
        if (wf > hi) { wf = hi; this.limiter = 'accel sched'; }
        if (wf < lo) { wf = lo; this.limiter = 'decel sched'; }
      }
    }
    this.wf = wf;
    this.eprCmd = this.eprCommand(o);

    // ---------------- handling bleeds & stators
    const decel = n2dot < -1.0;
    let b25 = clamp((80 - n1c) / 28, 0, 1);
    if (decel || this.surgeHold > 0) b25 = Math.max(b25, 0.6);
    let b7 = n2c < 63 ? 3 : n2c < 70 ? 2 : n2c < 77 ? 1 : 0;
    if (this.surgeHold > 0) b7 = 3;
    const b10 = n2c < 50 && this.phase !== 'run' ? 1 : 0;

    this.auto = { fuel: wf, ignition: ign, starter, vsv: o.vsvSched, bleed25: b25, bleed7: b7, bleed10: b10 };

    // ---------------- apply, honouring manual overrides
    const ov = this.ovr;
    // The master switch is the HP fuel shut-off valve: no fuel passes with it off, manual or not.
    u.wfCmd = this.master ? (ov.fuel != null ? ov.fuel : wf) : 0;
    if (ov.fuel != null && this.master) this.wf = ov.fuel; // bumpless transfer back to auto
    u.ignition = ov.ignition != null ? ov.ignition : ign;
    u.starterValve = ov.starter != null ? ov.starter : starter;
    u.vsv = ov.vsv; // null -> schedule
    u.bleed25 = ov.bleed25 != null ? ov.bleed25 : b25;
    u.bleed7 = ov.bleed7 != null ? ov.bleed7 : b7;
    u.bleed10 = ov.bleed10 != null ? ov.bleed10 : b10;
  }
}

export function ratedThrustN(rating) {
  return RATINGS[rating].toLbf * LBF;
}
