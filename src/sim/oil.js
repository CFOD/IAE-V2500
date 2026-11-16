// Lubrication system: tank, pressure pump, coolers, bearings.
//
// One tank (25 US quarts usable) feeds a gear pump on the gearbox. The oil is cooled first by fan
// air (air-cooled oil cooler, modulated) and then by fuel (fuel-cooled oil cooler), lubricates the
// five main bearings and the gearboxes, and is scavenged back to the tank.
// Layout and the 60 psi low-pressure switch, 25 qt tank and 12 psi filter switch are from the
// SR Technics component-location booklet; flows, heat loads and failure rates are estimates.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const OIL = {
  TANK_QT: 25, LOW_PRESS_PSI: 60, TEMP_AMBER_C: 155, TEMP_RED_C: 165, QTY_LOW_QT: 5, FILTER_CLOG_PSI: 12,
};

export class Oil {
  constructor(engine) { this.eng = engine; this.faults = { leak: 0, seal4: false, acocStuck: false, filterClog: false, pumpFail: false }; this.reset(); }

  reset() {
    for (const k of Object.keys(this.faults)) this.faults[k] = k === 'leak' ? 0 : false;
    const T0 = (this.eng.ambient ? this.eng.ambient().T0 : 288.15) - 273.15;
    this.s = { total: OIL.TANK_QT, temp: T0, press: 0, filterDp: 0, starve: 0, brg: 0, chips: 0, coke: 0, failed: false, smoke: 0 };
    this._publish();
  }

  update(dt) {
    const e = this.eng, o = e.out, s = this.s, f = this.faults, n2 = clamp((o.N2pct || 0) / 100, 0, 1.3);
    const Tamb = (o.T0 || 288.15) - 273.15;

    // ---- quantity: normal consumption, leaks, a failed No. 4 bearing seal (oil lost into the gas path)
    let loss = 0.3 / 3600 * n2;                       // about 0.3 qt/h
    loss += f.leak / 60;                               // external leak, qt/min
    if (f.seal4) loss += (0.6 / 60) * clamp(n2 * 1.5, 0, 1.2);
    s.total = Math.max(0, s.total - loss * dt);
    s.smoke = f.seal4 && n2 > 0.2 && s.total > 0.2 ? 1 : 0;
    // oil in circulation ("gulping"): the tank level drops as the engine runs up and recovers after shut-down
    const gulp = 4.5 * clamp(n2 / 0.6, 0, 1), inTank = Math.max(0, s.total - gulp);

    // ---- pressure: a gear pump delivers flow in proportion to N2; cold oil is thick and reads high
    const visc = clamp(1 + (60 - s.temp) / 90, 0.8, 2.6);
    let supply = clamp(inTank / 2.5, 0, 1);            // the pump starts to draw air below about 2.5 qt in the tank
    if (supply < 1 && supply > 0) supply *= 0.75 + 0.25 * Math.sin(e.s.t * 9) * Math.sin(e.s.t * 2.3); // cavitation: the needle flickers
    if (f.pumpFail) supply = 0;
    const target = (60 * clamp(n2 / 0.3, 0, 1) + 230 * Math.pow(n2, 1.5)) * Math.sqrt(visc) * supply * (1 - 0.5 * s.brg);
    s.press += (target - s.press) * Math.min(1, dt / 0.6);
    s.filterDp += ((f.filterClog ? 14 : 2 + 3 * s.chips) * clamp(n2 * 1.3, 0, 1) * visc - s.filterDp) * Math.min(1, dt / 2);

    // ---- temperature: heat from the bearings, gearbox and the hot core; rejected to fan air and to fuel
    const flow = 0.6 * n2 * supply;                    // kg/s of oil round the circuit
    const heat = 4e3 * Math.min(1, n2 * 5) + 42e3 * n2 * n2 + 40 * n2 * Math.max(0, (o.T3 || 288) - 300) + 60e3 * s.brg * n2;
    const Coil = flow * 2000, Cfuel = Math.max(0, o.wf || 0) * 2000;
    const acocValve = f.acocStuck ? 0.02 : clamp((s.temp - 75) / 45, 0.1, 1);   // opens as the oil gets hot
    const UAair = 950 * Math.pow(clamp((o.Wbypass || 0) / 300, 0, 1.3), 0.7) * acocValve;
    const cool = Math.min(Coil, UAair) * (s.temp - Tamb) + 0.62 * Math.min(Coil, Cfuel) * (s.temp - (Tamb + 10));
    const still = 20 * (s.temp - Tamb);                // a standing engine loses heat slowly to the nacelle
    s.temp += (dt * ((n2 > 0.03 ? heat - Math.max(0, cool) : 0) - still)) / 120e3;
    // soak-back: with no flow the oil left round the No. 4 bearing is cooked by the hot core
    if (n2 < 0.05 && (o.Tm || 0) > 900) s.coke = Math.min(1, s.coke + dt / 1800);

    // ---- bearings: starved of oil or fed with overheated oil, the rolling elements skid, pit and finally seize
    const running = n2 > 0.2;
    const starving = running && s.press < OIL.LOW_PRESS_PSI * 0.75;
    s.starve = starving ? s.starve + dt : Math.max(0, s.starve - dt * 0.5);
    if (!s.failed) {
      let rate = 0;
      if (starving && s.starve > 8) rate += (n2 * n2) / 55 * (1 - s.press / (OIL.LOW_PRESS_PSI * 0.75));   // about a minute at take-off power, several at idle
      if (running && s.temp > OIL.TEMP_RED_C) rate += ((s.temp - OIL.TEMP_RED_C) / 60) * n2 / 240;          // oil breaking down
      if (running && s.coke > 0.5) rate += n2 / 4000;
      s.brg = Math.min(1, s.brg + rate * dt);
      if (s.brg > 0.15 && s.chips === 0) { s.chips = 1; e.events.push({ t: e.s.t, type: 'chip-detector' }); }
      if (s.brg >= 1) { s.failed = true; e.events.push({ t: e.s.t, type: 'bearing-failure' }); }
    }
    this._publish();
  }

  _publish() {
    const o = this.eng.out, s = this.s, n2 = clamp((o.N2pct || 0) / 100, 0, 1.3);
    o.oilP = s.press; o.oilT = s.temp; o.oilQ = Math.max(0, s.total - 4.5 * clamp(n2 / 0.6, 0, 1)); o.oilFilterDp = s.filterDp;
    o.oilLowP = n2 > 0.2 && s.press < OIL.LOW_PRESS_PSI; o.oilBrg = s.brg; o.oilChips = s.chips; o.oilSmoke = s.smoke;
  }
}
