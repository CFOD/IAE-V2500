// Physical failure model. Watches the running engine and turns abuse into the damage a real
// engine would suffer: turbine creep, blade release and melting, combustor burn-through, disc
// burst, surge damage, tip rub after a hot shut-down and a bowed rotor on a hot restart.
// Damage acts on the engine through `engine.wear`, never through the player's hardware settings.
//
// The mechanisms are real; the numbers are engineering estimates, not IAE data (docs/PHYSICS.md).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

export function defaultWear() {
  return {
    effFan: 0, effLpc: 0, effHpc: 0, effHpt: 0, effLpt: 0, flowFan: 1, flowHpc: 1, flowHpt: 1, flowLpt: 1,
    drag1: 0, drag2: 0, // rubbing torque on each spool, N.m
    seized1: false, seized2: false, dead: false, // dead: no combustion possible (core destroyed)
  };
}

export class Damage {
  constructor(engine) { this.eng = engine; this.reset(); }

  reset() {
    this.d = {
      hptCreep: 0, hptLost: 0, lptCreep: 0, lptLost: 0, // creep life used (1 = first blade lets go), fraction of blading destroyed
      ngvBurn: 0, TbHmax: 288, TbLmax: 288,             // guide vanes burnt behind a streaking nozzle (0-1); hottest the turbine blades have been (K)
      liner: 0, hpc: 0, fan: 0, rub: 0, bow: 0, bowRub: 0, fire: 0, burst: '', surges: 0, lastSurge: -9,
      TbH: 288, TbL: 288, vib1: 0, vib2: 0,
    };
    this.eng.wear = defaultWear();
    this._lit = false; this._ev = 0;
    if (this.eng.oil) this.eng.oil.reset();
    Object.assign(this.eng.out, { vib1: 0.2, vib2: 0.2, fire: 0, TbH: 288, TbL: 288, torch: 0 });
  }

  _event(type) { this.eng.events.push({ t: this.eng.s.t, type }); }

  update(dt) {
    const e = this.eng, o = e.out, s = e.s, d = this.d, w = e.wear, T0 = (o.T0 = e.ambient().T0);
    if (this._ev > e.events.length) this._ev = 0;
    const n1 = o.N1pct / 100, n2 = o.N2pct / 100, fl = e.fail;
    // a streaking fuel nozzle (failures.js) puts a hot streak on part of the HP turbine
    const streak = fl && fl.on.nozzleStreak ? 340 * clamp((o.wf || 0) / 1.05, 0, 1.3) : fl && fl.on.fdvHalf ? 150 * clamp((o.wf || 0) / 0.55, 0, 1) : 0;

    // ---- blade metal temperatures
    // HP turbine blades are film cooled with compressor delivery air; LP turbine blades are not cooled.
    const coolK = clamp(e.mods.cooling, 0, 1.5), eta = 0.58 * Math.pow(coolK, 0.6);
    const Trel = 0.92 * (o.T41 || T0), TbH = o.lit ? Trel - eta * (Trel - (o.T3 || T0)) : Math.min(d.TbH, o.Tm || T0);
    d.TbH += (TbH - d.TbH) * Math.min(1, dt / 1.5);
    const TbL = o.lit ? 0.95 * (o.T45 || T0) : Math.min(d.TbL, o.Tm || T0);
    d.TbL += (TbL - d.TbL) * Math.min(1, dt / 3);
    d.TbHmax = Math.max(d.TbHmax, d.TbH); d.TbLmax = Math.max(d.TbLmax, d.TbL);
    // the guide vanes in a streaking nozzle's path burn: coating first, then the trailing edges
    if (o.lit && streak > 0) d.ngvBurn = Math.min(1, d.ngvBurn + (dt * (streak / 340) * Math.max(0.15, n2 * n2)) / 150);

    // ---- creep: life falls by half for every ~12 K of metal temperature and with the fourth power of speed
    if (d.hptLost < 1) {
      d.hptCreep += (dt * Math.pow(Math.max(n2, 0.05), 4)) / (30 * Math.exp(-(d.TbH + (o.lit ? streak : 0) - 1400) / 18));
      if (d.hptCreep >= 1) { d.hptCreep = 0.7; d.hptLost = Math.min(1, d.hptLost + 0.08); d.lptLost = Math.min(1, d.lptLost + 0.03); this._event('hpt-blade-release'); }
      // incipient melting of the nickel alloy: blades and guide vanes burn away
      if (d.TbH > 1600) { const b = d.hptLost; d.hptLost = Math.min(1, b + dt * 0.2 * (1 + (d.TbH - 1600) / 80)); if (b < 0.02 && d.hptLost >= 0.02) this._event('hpt-melting'); }
    }
    if (d.lptLost < 1) {
      d.lptCreep += (dt * Math.pow(Math.max(n1, 0.05), 4)) / (30 * Math.exp(-(d.TbL - 1330) / 20));
      if (d.lptCreep >= 1) { d.lptCreep = 0.7; d.lptLost = Math.min(1, d.lptLost + 0.07); this._event('lpt-blade-release'); }
      if (d.TbL > 1560) { const b = d.lptLost; d.lptLost = Math.min(1, b + dt * 0.15 * (1 + (d.TbL - 1560) / 80)); if (b < 0.02 && d.lptLost >= 0.02) this._event('lpt-melting'); }
    }
    // ---- combustor liner: film cooling fails when the flame gets far beyond its design temperature
    if (o.lit && o.T4 > 2150 && d.liner < 1) { d.liner += (dt * (1 + (o.T4 - 2150) / 150)) / 10; if (d.liner >= 1) { d.liner = 1; d.fire = 1; this._event('combustor-burn-through'); } }

    // ---- overspeed: discs are designed to hold together to roughly 120 % of red-line speed
    if (!d.burst) {
      // after a shaft failure the free turbine is the one that overspeeds
      if (Math.max(o.N2pct, o.NhptPct || 0) > 121) { d.burst = 'hp'; this._event('disc-burst-hp'); }
      else if (Math.max(o.N1pct, o.NlptPct || 0) > 123) { d.burst = 'lp'; this._event('disc-burst-lp'); }
      if (d.burst) { d.fire = 1; d.hptLost = 1; d.lptLost = Math.max(d.lptLost, d.burst === 'lp' ? 1 : 0.6); d.hpc = 1; if (d.burst === 'lp') d.fan = 1; }
    }

    // ---- events from the engine: surges, and the fuel being cut at high power
    for (; this._ev < e.events.length; this._ev++) {
      const ev = e.events[this._ev];
      if (ev.type === 'surge-hpc' && ev.t - d.lastSurge > 0.25) {
        d.lastSurge = ev.t; d.surges++;
        // each surge slams the blading with reversed flow; after the first few, tips and leading edges start to go
        if (d.surges > 4 && d.hpc < 1) { const b = d.hpc; d.hpc = Math.min(1, b + 0.025); if (b < 0.5 && d.hpc >= 0.5) this._event('hpc-blade-damage'); if (b < 1 && d.hpc >= 1) { d.hptLost = Math.min(1, d.hptLost + 0.06); this._event('hpc-blade-failure'); } }
      }
    }
    if (this._lit && !o.lit && !d.burst && o.N2pct > 85 && (o.Tm || 0) > 950) {
      // casings cool and shrink in seconds, discs take minutes: the blade tips cut into their seals
      const k = clamp((o.Tm - 950) / 300, 0.2, 1); d.rub = Math.min(1, d.rub + 0.35 * k); this._event('tip-rub-shutdown');
    }
    this._lit = o.lit;
    // ---- clearance control left on through a hard acceleration: the rotor grows onto a cooled, shrunken case
    if ((o.accPinch || 0) > 0.2 && !d.burst) {
      const was = d.rub; d.rub = Math.min(1, d.rub + dt * 0.25 * o.accPinch);
      if (was < 0.05 && d.rub >= 0.05) this._event('acc-tip-rub');
    }

    // ---- bowed rotor: a hot core left standing cools unevenly (hot air rises inside it) and the HP rotor bends
    const hot = clamp(((o.Tm || T0) - T0 - 150) / 350, 0, 1);
    if (o.N2pct < 2) d.bow += (hot - d.bow) * dt / (hot > d.bow ? 600 : 5400);
    // turning it evens the temperature out. Time constant chosen so the automatic start's 30 s of motoring (IAE's
    // reason for it) straightens the worst bow this model builds up (about 0.66) below the rub threshold
    else if (o.N2pct > 6) d.bow -= d.bow * dt / 25;
    if (d.bow > 0.25 && o.N2pct > 34 && o.N2pct < 70 && d.bowRub < d.bow) { d.bowRub = d.bow; this._event('bowed-rotor-rub'); }

    // ---- what the damage does to the engine
    const H = d.hptLost, L = d.lptLost;
    w.effHpt = -(0.03 * Math.min(d.hptCreep, 1) ** 2 + 0.85 * H + 0.03 * d.rub);
    w.flowHpt = 1 + 0.6 * H;
    w.effLpt = -(0.02 * Math.min(d.lptCreep, 1) ** 2 + 0.85 * L);
    w.flowLpt = 1 + 0.5 * L;
    w.effHpc = -(0.07 * Math.min(d.hpc, 1) + (d.hpc >= 1 ? 0.12 : 0) + 0.02 * d.rub + 0.05 * d.bowRub);
    w.flowHpc = 1 - 0.06 * Math.min(d.hpc, 1) - (d.hpc >= 1 ? 0.1 : 0);
    w.effFan = -0.3 * d.fan; w.flowFan = 1 - 0.3 * d.fan;
    w.drag2 = 60 * d.rub + 500 * H + 300 * (d.hpc >= 1 ? 1 : 0) + 250 * d.bowRub * bell(o.N2pct, 45, 25) + (d.burst === 'hp' ? 6000 : 0);
    w.drag1 = 900 * L + (d.burst === 'lp' ? 20000 : 0);
    // main bearing distress from the oil system: rising drag and vibration, then seizure
    const B = e.oil ? e.oil.s.brg : 0, seizedBrg = e.oil && e.oil.s.failed;
    w.drag2 += 500 * B * B + (seizedBrg ? 9000 : 0);
    if (seizedBrg && o.N2pct < 3) w.seized2 = true;
    w.dead = !!d.burst || H >= 0.98 || !!seizedBrg;
    if ((H > 0.9 || d.burst === 'hp') && o.N2pct < 3) w.seized2 = true;
    if ((L > 0.9 || d.burst === 'lp') && o.N1pct < 3) w.seized1 = true;
    // fuel still arriving in a wrecked or burnt-through core burns outside it
    if ((w.dead || d.liner >= 1) && s.wf > 0.01) d.fire = 1;

    // ---- vibration, in the cockpit's units (advisory at 5)
    const v2 = 0.2 + 0.5 * n2 + (fl ? fl.vib2 : 0) + 9 * B * n2 + 28 * H * n2 + 6 * (d.hpc >= 1 ? 1 : d.hpc * 0.3) * n2 + 9 * d.bow * bell(o.N2pct, 45, 25) + 3 * d.rub * n2 + (o.hpc && o.hpc.stalled ? 3 : 0);
    const v1 = 0.2 + 0.4 * n1 + (fl ? fl.vib1 : 0) + 24 * L * n1 + 30 * d.fan * n1 + (o.fan && o.fan.stalled ? 3 : 0);
    d.vib2 += (clamp(v2, 0, 10) - d.vib2) * Math.min(1, dt / 0.4); d.vib1 += (clamp(v1, 0, 10) - d.vib1) * Math.min(1, dt / 0.4);
    o.vib1 = d.vib1; o.vib2 = d.vib2; o.fire = d.fire; o.TbH = d.TbH; o.TbL = d.TbL;
  }

  /** Extinguisher: puts the fire out if the fuel has been shut off (and any leak fire whose source has stopped). */
  extinguish() {
    if (this.eng.s.wf < 0.01) this.d.fire = 0;
    const leak = this.eng.fail ? this.eng.fail.extinguish() : true;
    return this.d.fire === 0 && leak;
  }
}
