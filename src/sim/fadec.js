// Simplified Electronic Engine Control (FADEC) for the V2500 model.
//
// Like the real EEC it sets thrust on EPR (P4.9/P2), governs idle on N2,
// limits N1 / N2 / EGT, bounds fuel between acceleration and deceleration
// schedules expressed as Wf/P3, schedules the variable stator vanes and
// handling bleeds, and runs the automatic start sequence.
//
// Every output channel can be overridden by the player ("manual"), which is
// how you get to do everything the real control laws exist to prevent.

import { LIMITS, RATINGS, LBF, MCT_FLAT_ISA } from './v2500.js';
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
export const EPR_VS_THRUST = [[0,1.0],[4.3,1.011],[5.6,1.015],[7.1,1.019],[13.3,1.038],[18.9,1.055],[25.8,1.077],[34.7,1.112],[43.8,1.153],[54.5,1.224],[65.2,1.288],[76.8,1.366],[85.2,1.427],[93.5,1.49],[101.5,1.555],[109.2,1.619],[116.7,1.684],[123.9,1.748],[132.2,1.824],[140.5,1.908],[145.8,1.969]];
export const eprForThrust = (kN) => lerpTable(EPR_VS_THRUST, kN);

// Steady-state fuel ratio Wf/P3 [kg/s per bar] vs corrected N2 % (from calibration)
export const RU_STEADY = [[20,0.0314],[45,0.0317],[54.2,0.0308],[64.4,0.0303],[76.2,0.0292],[80.9,0.0294],[86.5,0.0314],[89.8,0.0345],[91.9,0.0365],[93.7,0.0383],[95.3,0.0402],[97,0.0417],[98.1,0.0426],[104.1,0.046]];
const ACCEL_MARGIN = [[20, 1.25], [36, 1.3], [44, 1.55], [56, 1.45], [62, 1.5], [75, 1.55], [88, 1.45], [97, 1.3]];
const DECEL_FRAC = 0.5;
export const DETENT_CL = 25 / 45, DETENT_MCT = 35 / 45;
export const START_CRANK_S = 30; // automatic start: the EEC motors the engine for 30 s before it opens the fuel (Airbus TTM)
export const MAX_REVERSE_N1 = 80; // % - reverse thrust is limited well below take-off fan speed (assumed value)
// A320 thrust lever angles, degrees: TOGA 45, FLX/MCT 35, CL 25, IDLE 0; reverse idle -6 and max reverse -20.
// Below -3.8 the reverser is commanded to deploy (on the ground only); reverse thrust stays at idle until it is fully out.
export const TRA = { MREV: -20, REV_IDLE: -6, REV_DEPLOY: -3.8, IDLE: 0, CL: 25, MCT: 35, TOGA: 45 };

export class Fadec {
  constructor(engine) {
    this.eng = engine;
    // pilot / player inputs
    this.master = false; // ENG MASTER switch (HP fuel shut-off valve)
    this.tla = 0; // thrust lever 0..1 (idle..TOGA), or reverse idle..max reverse while the reverser is out
    this.tra = 0; // thrust lever angle, degrees (see TRA)
    this.revCmd = null; // reverse selected on the thrust lever (null: the reverser is driven directly through eng.u.reverser)
    this.revLockout = false; // reverser deactivated (C-ducts open for maintenance): it will not deploy
    this.rating = 'V2527-A5';
    this.manStart = false; // ENG MAN START pushbutton (latched; opens the start valve with MODE at CRANK or IGN START)
    this.mode = 'norm'; // ENG MODE selector: 'crank' | 'norm' | 'ign' (IGN/START)
    this.apuBleed = true; // APU BLEED pushbutton: air for the starter (shut it to stop a starter that will not disengage)
    this.firePb = false; // ENG FIRE pushbutton pushed: LP fuel valve shut (also shut by MASTER OFF)
    // component faults the player can inject (Panel > Faults)
    this.faults = { svNoOpen: false, svNoClose: false, ignA: false, ignB: false };
    // manual overrides: null = FADEC authority
    this.ovr = { fuel: null, ignition: null, starter: null, vsv: null, bleed25: null, bleed7: null, bleed10: null, accHpt: null, accLpt: null };
    this.acc = [0, 0]; // clearance-control valve positions the EEC is commanding
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
    // Protections the player can switch off (Panel > Control). All on = normal FADEC behaviour.
    this.prot = { egt: true, n1: true, n2: true, accel: true, decel: true, surge: true, startAbort: true };
    this.n1Mode = false; // rated-N1 reversion: thrust is set on fan speed instead of EPR (used when EPR sensing is lost)
    this.clearStart();
    this.starterHeat = 0; this.starterFailed = ''; this.starterLimit = false; this._overspeedT = 0;
    this.startCount = 0; this._modePrev = this.mode;
  }
  /** Start-sequence memory: latched faults, purge, continuous relight. */
  clearStart() {
    this.startFault = ''; this.manFault = ''; this.svNotOpen = false; this.svNotClosed = false; this._valveStuck = false;
    this._wetCranked = false; this._purgeWait = false; this._purgeT = null; this.contIgn = false; this.dryAfter = false; this._hungT = 0;
    this.ecam = []; this.valveOpen = false; this.ignSel = '';
  }

  /** Fan speed that gives the selected rating's take-off thrust at sea level (fitted to this model). */
  ratedN1() { return 95 - (140.56 - (RATINGS[this.rating].toDaN / 100)) * 0.235; }

  /** EPR limits for the selected rating: take-off and max continuous. */
  eprLimits(out) {
    const r = RATINGS[this.rating];
    // Take-off is flat rated: constant EPR up to ISA + flatISA, then EPR falls so that
    // turbine temperature stays near its corner-point value.
    const isaT = isa(this.eng.u.alt, 0).T;
    const over = Math.max(0, out.amb.T0 - (isaT + r.flatISA));
    const lapse = 1 - 0.0075 * over;
    const to = 1 + (eprForThrust((r.toLbf * LBF) / 1000) - 1) * lapse;
    const overM = Math.max(0, out.amb.T0 - (isaT + MCT_FLAT_ISA));
    const mct = Math.min(to, 1 + (eprForThrust((r.mctLbf * LBF) / 1000) - 1) * (1 - 0.0075 * overM));
    return { to, mct, clb: 1 + (mct - 1) * 0.93 };
  }

  /** Thrust lever -> EPR command through the detents. The lever travels 0-45 deg: climb at 25, FLX/MCT at 35, TOGA at 45 (Airbus TTM). */
  eprCommand(out) {
    const L = this.eprLimits(out), t = this.tla;
    if (t >= DETENT_MCT) return L.mct + ((L.to - L.mct) * (t - DETENT_MCT)) / (1 - DETENT_MCT);
    if (t >= DETENT_CL) return L.clb + ((L.mct - L.clb) * (t - DETENT_CL)) / (DETENT_MCT - DETENT_CL);
    return 1 + ((L.clb - 1) * t) / DETENT_CL;
  }

  /** Thrust lever angle in degrees (TRA). Sets the forward lever, or the reverse lever and the reverser command. */
  setLever(deg) {
    const onGround = (this.eng.u.alt || 0) < 10;
    this.tra = Math.min(TRA.TOGA, Math.max(onGround ? TRA.MREV : TRA.IDLE, deg));
    const rev = this.tra < TRA.REV_DEPLOY;
    this.revCmd = rev; // applied in update(): the reverser needs hydraulic pressure from the engine-driven pump
    this.tla = rev ? clamp((TRA.REV_IDLE - this.tra) / (TRA.REV_IDLE - TRA.MREV), 0, 1) : Math.max(0, this.tra) / TRA.TOGA;
    return this.tra;
  }

  idleN2(out) {
    return clamp(58.5 * Math.sqrt(out.T2 / 288.15), 54, 68);
  }

  /** Back to cold and dark: switches off, manual overrides released, start sequence forgotten. */
  reset() {
    this.master = false; this.manStart = false; this.tla = 0; this.tra = 0; this.revCmd = null; this.mode = 'norm'; this.apuBleed = true; this._modePrev = 'norm'; this.firePb = false;
    for (const k of Object.keys(this.ovr)) this.ovr[k] = null;
    for (const k of Object.keys(this.faults)) this.faults[k] = false;
    this.clearStart(); this.starterHeat = 0; this.starterFailed = ''; this.starterLimit = false; this._overspeedT = 0; this.startCount = 0;
    this.phase = 'off'; this.wf = 0; this.msg = ''; this.timer = 0; this.surgeHold = 0; this.limiter = ''; this.cutout = false;
    this._prevN2 = 0; this._evIdx = 0; this.acc = [0, 0];
  }

  update(dt) {
    const eng = this.eng, o = eng.out, u = eng.u;
    const theta = Math.sqrt(o.T2 / 288.15);
    const n2 = o.N2pct, n2c = n2 / theta, n1c = o.N1pct / theta;
    // the EEC sees the indicated EGT: a lost signal (failures.js) disables EGT limiting and hot-start aborts
    const fl = eng.fail ? eng.fail.fx : {}, egtSeen = o.egtInd ?? o.egt, egtOk = Number.isFinite(egtSeen);
    const egtC = egtOk ? egtSeen - 273.15 : -100;
    const p3bar = o.P3 / 1e5;
    const n2dot = dt > 0 ? (n2 - this._prevN2) / dt : 0;
    this._prevN2 = n2;

    // surge detection (real EEC watches P3 decay rate)
    for (; this._evIdx < eng.events.length; this._evIdx++) {
      if (eng.events[this._evIdx].type.startsWith('surge')) this.surgeHold = 3;
    }
    if (this.surgeHold > 0) this.surgeHold -= dt;

    // ---------------- start / run state machine
    // Follows the Airbus A320 training manual (IAE V2500, ATA 80): automatic start with MODE at IGN/START
    // and MASTER ON (30 s of motoring, then fuel and one igniter, start valve closed at 43 % N2); manual
    // start with MAN START then MASTER ON (both igniters, no automatic abort); dry and wet crank with
    // MODE at CRANK. Below 50 % N2 an automatic start is aborted for a start valve fault, ignition
    // fault, EGT overlimit, stall or hung start: fuel and ignition off, dry motoring, then MASTER OFF.
    let ign = false, starter = false, fuelOn = false, sched = null, ignSel = '';
    const idle = this.idleN2(o), F = this.faults;
    const abort = (what, dry) => { this.startFault = what; this.phase = 'abort'; this.timer = 0; this.dryAfter = dry; };
    const running = this.phase === 'run' || (o.lit && n2 > idle - 4 && this.phase !== 'abort' && this.phase !== 'aborted');
    if (!this.master) {
      // MASTER OFF shuts the LP and HP fuel valves and resets a start fault. MAN START motors the engine (dry crank).
      if (this.startFault || this.manFault) { this.startFault = ''; this.manFault = ''; }
      if (this._wetCranked && !this._purgeWait && this._purgeT === null) this._purgeWait = true;  // after a wet crank the EEC closes the valve...
      if (this._purgeWait && n2 < 10) { this._purgeWait = false; this._purgeT = 0; }               // ...and reopens it below 10 % N2 for a 60 s dry crank
      const purging = this._purgeT !== null && this.mode !== 'norm';
      starter = purging || (this.manStart && this.mode !== 'norm' && !this._purgeWait && (n2 < LIMITS.STARTER_CUTOUT_N2 || this.mode === 'crank'));
      if (purging) { this._purgeT += dt; if (this._purgeT >= 60) { this._purgeT = null; this._wetCranked = false; } }
      if (this.mode === 'norm' && !this._purgeWait) { this._purgeT = null; }
      this.phase = starter ? 'crank' : 'off';
      this.msg = this._purgeWait ? 'START VALVE CLOSED - PURGE AFTER WET CRANK' : starter ? (this._purgeT !== null ? 'DRY CRANK - PURGING FUEL' : 'DRY CRANK') : '';
      this.timer = 0; this.cutout = false; this.contIgn = false;
    } else if (running && this.phase !== 'manual' || this.phase === 'run') {
      this.phase = 'run'; fuelOn = true; this.msg = '';
      // continuous relight: IGN/START reselected with the engine running gives both igniters
      if (this.mode === 'ign' && this._modePrev !== 'ign') this.contIgn = true;
      if (this.mode !== 'ign') this.contIgn = false;
      if (this.contIgn) { ign = true; ignSel = 'A+B'; this.msg = 'CONTINUOUS RELIGHT'; }
      if (!o.lit) { ign = true; ignSel = 'A+B'; this.msg = 'FLAME OUT - AUTO RELIGHT'; if (n2 < 30) { this.phase = 'crank'; this.timer = START_CRANK_S; } }
      if (this.surgeHold > 0) { ign = true; ignSel = 'A+B'; this.msg = 'ENGINE STALL'; }
    } else if (this.mode === 'crank') {
      // wet crank: fuel with ignition inhibited (MAN START in, MASTER ON above 20 % N2)
      starter = this.manStart; fuelOn = this.manStart && n2 > 10; sched = 'lightup';
      this.phase = 'wetcrank'; this.msg = fuelOn ? 'WET CRANK' : 'DRY CRANK';
      if (fuelOn) this._wetCranked = true;
    } else if (this.mode === 'ign' && this.manStart && this.phase !== 'abort' && this.phase !== 'aborted') {
      // manual start: both igniters and fuel as soon as MASTER is ON; the EEC still closes the start valve at 43 % N2
      if (this.phase !== 'manual') { this.phase = 'manual'; this.timer = 0; this.cutout = false; this.manFault = ''; }
      if (n2 >= LIMITS.STARTER_CUTOUT_N2) this.cutout = true;
      starter = !this.cutout; ign = !this.cutout; ignSel = ign ? 'A+B' : ''; fuelOn = true; sched = o.lit ? 'accel' : 'lightup'; this.timer += dt;
      if (egtC > LIMITS.EGT_START) this.manFault = 'EGT OVERLIMIT';
      if (!o.lit && this.timer > 20) this.manFault = 'IGNITION FAULT';
      this.msg = 'MANUAL START';
      if (o.lit && n2 >= idle - 1) this.phase = 'run';
    } else if (this.mode === 'ign') {
      if (this.phase === 'manual') this.phase = o.lit ? 'accel' : 'off'; // MAN START released part way: the EEC carries on automatically
      switch (this.phase) {
        case 'off': case 'wetcrank':
          this.phase = 'crank'; this.timer = 0; this.startCount++;
        // falls through
        case 'crank':
          starter = true; this.cutout = false; this.timer += dt; this.msg = 'START VALVE OPEN';
          if (F.svNoOpen && this.timer > 6 && n2 < 5) { this.svNotOpen = true; abort('START VALVE NOT OPEN', false); break; }
          if (this.timer >= START_CRANK_S && n2 > 15) { this.phase = 'lightup'; this.timer = 0; }
          else if (this.timer > 60) this.msg = 'N2 BELOW 16 % - CHECK STARTER AIR PRESSURE'; // fuel waits for the motoring speed
          break;
        case 'lightup':
          starter = true; ign = true; fuelOn = true; sched = 'lightup'; this.timer += dt; this.msg = 'IGNITION - FUEL ON';
          if (o.lit) { this.phase = 'accel'; this.timer = 0; this._hungT = 0; }
          else if (this.timer > 15 && this.prot.startAbort) abort('IGNITION FAULT', true);
          break;
        case 'accel': {
          if (n2 >= LIMITS.STARTER_CUTOUT_N2) this.cutout = true; // latched: the starter is not re-engaged
          starter = !this.cutout; ign = starter; fuelOn = true; sched = 'accel'; this.timer += dt; this.msg = 'STARTING';
          this._hungT = n2dot < 0.12 && n2 < idle - 2 ? this._hungT + dt : 0;
          const canAbort = n2 < 50 && this.prot.startAbort;
          if (!o.lit) { this.phase = 'lightup'; this.timer = 0; }
          else if (canAbort && this.surgeHold > 0) abort('STALL', true);
          else if (canAbort && egtC > LIMITS.EGT_START) abort('EGT OVERLIMIT', true);
          else if (canAbort && this._hungT > 10 && this.timer > 15) abort('HUNG START', true);
          else if (n2 >= idle - 1) { this.phase = 'run'; this.msg = ''; }
          else if (this._hungT > 10) this.msg = 'HUNG START';
          break;
        }
        case 'abort':
          // fuel and ignition off, about 30 s of dry motoring to clear fuel and cool the engine, then the start is aborted
          this.timer += dt;
          starter = this.dryAfter && this.timer < 30 && n2 < LIMITS.STARTER_CUTOUT_N2;
          if (this.timer >= (this.dryAfter ? 30 : 1)) this.phase = 'aborted';
          break;
        case 'aborted':
          break; // the crew sets MASTER OFF
      }
      if (ign && !ignSel) ignSel = this.startCount % 2 ? 'A' : 'B'; // automatic starts alternate between igniters
    } else {
      this.phase = 'off'; this.msg = 'SET MODE TO IGN/START'; // MASTER ON in NORM with the engine stopped: nothing to schedule
    }
    this._modePrev = this.mode;

    // ---------------- start valve, igniters and the starter itself
    if (F.svNoClose && starter) this._valveStuck = true;            // once open it cannot be closed
    let valve = (starter || this._valveStuck) && !F.svNoOpen;
    if (!F.svNoClose) this._valveStuck = false;
    if (this._valveStuck && (this.cutout || this.phase === 'run')) this.svNotClosed = true;
    if (!this._valveStuck) this.svNotClosed = false;
    const deadA = F.ignA || fl.ignA, deadB = F.ignB || fl.ignB;   // igniter or its lead
    const sparkOk = ign && ((ignSel.includes('A') && !deadA) || (ignSel.includes('B') && !deadB) || ignSel === '');
    this.ignSel = ign ? ignSel || 'A+B' : '';
    // Air starter limits (training manual): 4 min continuous then 30 min off to cool, so heat builds at 1/s
    // while it turns and falls at 1/7.5 s. Past the limit the ECAM warns but nothing aborts; far past it the
    // starter is wrecked. With the valve held open above about 50 % N2 the engine has outrun the starter: the
    // clutch overruns and the turbine spins unloaded on bleed air, so it overspeeds and fails in about 90 s.
    const turning = (this.ovr.starter != null ? this.ovr.starter : valve) && !this.starterFailed && this.apuBleed;
    this.starterHeat = Math.max(0, this.starterHeat + (turning ? dt : -dt / 7.5));
    if (this.starterHeat > 240) this.starterLimit = true; else if (this.starterHeat < 120) this.starterLimit = false;
    this._overspeedT = turning && n2 > 50 ? this._overspeedT + dt : Math.max(0, this._overspeedT - dt);
    if (!this.starterFailed && eng.fail && eng.fail.st.starterBurst) this.starterFailed = 'OVERSPEED';   // back-driven through a seized clutch
    if (!this.starterFailed && (this.starterHeat > 480 || this._overspeedT > 90)) {
      this.starterFailed = this._overspeedT > 90 ? 'OVERSPEED' : 'OVERHEAT';
      eng.events.push({ t: eng.s.t, type: 'starter-failure' });
    }

    // ---------------- fuel metering
    const ruSS = lerpTable(RU_STEADY, n2c);
    let ruAcc = ruSS * lerpTable(ACCEL_MARGIN, n2c);
    const ruDec = ruSS * DECEL_FRAC;
    if (!this.prot.surge) this.surgeHold = 0;
    if (this.surgeHold > 0) ruAcc *= 0.8;
    let wf = 0;
    this.limiter = '';
    if (fuelOn) {
      if (sched === 'lightup') {
        wf = Math.max(0.033, 0.03 * p3bar);
      } else if (sched === 'accel') {
        // open-loop start schedule trimmed by EGT
        const trim = clamp((LIMITS.EGT_START - 15 - egtC) / 40, 0.55, 1);
        wf = Math.max(0.03, ruAcc * p3bar * trim);
        this.limiter = trim < 1 ? 'EGT (start)' : 'accel sched';
      } else {
        const eprCmd = this.eprCommand(o);
        const egtLim = this.tla > 0.86 ? RATINGS[this.rating].egtTO : LIMITS.EGT_MCT;
        // loop errors normalised to "fraction of fuel flow per second"
        // With the reverser out the core no longer exhausts against the bypass stream, so EPR stops
        // tracking thrust. Reverse is governed on fan speed instead, between idle and MAX_REVERSE_N1.
        const reverse = o.rev > 0.05;
        // idle until the reverser is fully deployed; a reverser that deploys without being commanded gets idle (auto-idle)
        const n1Cmd = 22 + (MAX_REVERSE_N1 - 22) * (o.rev > 0.95 && (this.revCmd ?? !!u.reverser) ? this.tla : 0);
        const n1Rated = this.ratedN1(), lever = this.tla >= DETENT_MCT ? 0.93 + 0.07 * (this.tla - DETENT_MCT) / (1 - DETENT_MCT) : this.tla * (0.93 / DETENT_MCT);
        const primary = reverse ? [(n1Cmd - o.N1pct) * 0.06, 'EPR']
          : this.n1Mode ? [(22 + (n1Rated - 22) * lever - o.N1pct) * 0.06, 'N1 mode']
          : [(eprCmd - o.epr) * 3.0, 'EPR'];
        const cand = [primary];
        if (this.prot.n1) cand.push([(LIMITS.N1_RED - 0.5 - o.N1pct) * 0.15, 'N1 limit']);
        if (this.prot.n2) cand.push([(LIMITS.N2_RED - 0.5 - n2) * 0.25, 'N2 limit']);
        if (this.prot.egt) cand.push([(egtLim - 5 - egtC) * 0.012, 'EGT limit']);
        let e = cand[0];
        for (const cnd of cand) if (cnd[0] < e[0]) e = cnd;
        const eIdle = (idle - n2) * 0.25 - n2dot * 0.08;
        if (eIdle > e[0] && (e[1] === 'EPR' || e[1] === 'N1 mode')) e = [eIdle, 'idle'];
        this.limiter = e[1] === 'EPR' && reverse ? 'N1 (reverse)' : e[1];
        const scale = Math.max(this.wf, 0.05);
        wf = this.wf + clamp(e[0], -1.5, 1.5) * scale * dt;
        const hi = ruAcc * p3bar, lo = Math.max(ruDec * p3bar, 0.022);
        if (wf > hi && this.prot.accel) { wf = hi; this.limiter = 'accel sched'; }
        if (wf < lo && this.prot.decel) { wf = lo; this.limiter = 'decel sched'; }
        wf = Math.max(wf, 0);
      }
    }
    this.wf = wf;
    this.eprCmd = this.eprCommand(o);

    // ---------------- handling bleeds & stators
    const decel = n2dot < -1.0;
    let b25 = clamp((82 - n1c) / 30, 0, 1);
    if (decel || this.surgeHold > 0) b25 = Math.max(b25, 0.6);
    let b7 = n2c < 63 ? 3 : n2c < 70 ? 2 : n2c < 77 ? 1 : 0;
    if (this.surgeHold > 0) b7 = 3;
    const b10 = n2c < 50 && this.phase !== 'run' ? 1 : 0;

    // ---------------- active clearance control
    // Fan air on the turbine cases closes the tip clearances in climb and cruise. It stays off on the
    // ground and at take-off, and is shut while the engine accelerates or decelerates hard, because a
    // cooled case cannot follow a rotor that grows (or shrinks) quickly: the tips would rub.
    const flying = (u.alt || 0) > 1500 || (u.mach || 0) > 0.3;
    const steadyN2 = Math.abs(n2dot) < 1.5;
    const accWanted = this.phase === 'run' && flying && n2c > 75 && n2c < 99 && steadyN2;
    const lptSched = clamp(((u.alt || 0) - 1500) / 4500, 0.35, 1); // LPT valve modulates with altitude
    const accT = [accWanted ? 1 : 0, accWanted ? lptSched : 0];
    for (let k = 0; k < 2; k++) this.acc[k] += clamp(accT[k] - this.acc[k], -dt / (steadyN2 ? 4 : 0.5), dt / 4);

    this.auto = { fuel: wf, ignition: ign, starter: valve, vsv: o.vsvSched, bleed25: b25, bleed7: b7, bleed10: b10, accHpt: this.acc[0], accLpt: this.acc[1] };

    // ---------------- ECAM messages (wording as in the training manual)
    const ecam = [];
    if (this.startFault) ecam.push({ title: 'ENG 1 START FAULT', line: this.startFault + (this.phase === 'aborted' ? ' · MASTER OFF' : ' · START ABORTED'), level: 'caution' });
    if (this.manFault && this.phase === 'manual') ecam.push({ title: 'ENG 1 START FAULT', line: this.manFault + ' · MASTER OFF', level: 'caution' });
    if (this.svNotClosed) ecam.push({ title: 'ENG 1 START VALVE FAULT', line: 'START VALVE NOT CLOSED · MASTER OFF · NO RESTART', level: 'caution' });
    if (this.starterFailed) ecam.push({ title: 'ENG 1 STARTER FAULT', line: this.starterFailed === 'OVERSPEED' ? 'STARTER OVERSPEED - FAILED' : 'STARTER OVERHEAT - FAILED', level: 'caution' });
    else if (this.starterLimit) ecam.push({ title: 'ENG 1 STARTER', line: 'DUTY CYCLE EXCEEDED · ALLOW 30 MIN TO COOL', level: 'caution' });
    if (eng.fail) ecam.push(...eng.fail.ecam);
    this.ecam = ecam;
    if (ecam.length) this.msg = `${ecam[0].title} - ${ecam[0].line}`;
    this.valveOpen = this.ovr.starter != null ? this.ovr.starter : valve;

    // reverser: deploys only with hydraulic pressure (engine turning, N2 above about 45 %); it can always stow
    if (this.revCmd != null) u.reverser = this.revCmd && (n2 > 45 || (o.rev || 0) > 0.01) && !this.revLockout && !fl.hydLost;
    else if (this.revLockout) u.reverser = false;
    this.revInhibit = !!this.revCmd && !u.reverser;

    // ---------------- apply, honouring manual overrides
    const ov = this.ovr;
    // The master switch shuts off the FADEC's own fuel. Fuel set by hand still flows, which is what
    // makes a fully manual start possible; the UI drops manual fuel when the master is switched off.
    u.wfCmd = ov.fuel != null ? ov.fuel : this.master ? wf : 0;
    u.lpValve = !this.firePb && (this.master || ov.fuel != null);   // LP fuel valve in the pylon
    if (ov.fuel != null) this.wf = ov.fuel; // bumpless transfer back to auto
    u.ignition = ov.ignition != null ? ov.ignition : sparkOk;
    u.starterValve = (ov.starter != null ? ov.starter : valve) && !this.starterFailed && this.apuBleed;
    u.vsv = ov.vsv; // null -> schedule
    u.bleed25 = ov.bleed25 != null ? ov.bleed25 : b25;
    u.bleed7 = ov.bleed7 != null ? ov.bleed7 : b7;
    u.bleed10 = ov.bleed10 != null ? ov.bleed10 : b10;
    u.accHpt = ov.accHpt != null ? ov.accHpt : this.acc[0];
    u.accLpt = ov.accLpt != null ? ov.accLpt : this.acc[1];
  }
}

export function ratedThrustN(rating) {
  return RATINGS[rating].toLbf * LBF;
}
