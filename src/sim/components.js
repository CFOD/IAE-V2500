// Turbomachinery component models: compressor maps, turbine maps, nozzles.
//
// Real V2500 component maps are IAE proprietary. These are generic,
// physically-shaped parametric maps scaled so the design point reproduces the
// published V2500-A5 cycle. See docs/PHYSICS.md.

import { cp, gamma, h, phi, tFromH, tIsentropic, R_GAS } from './gas.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// sqrt(x) that becomes linear below ~0.2 % pressure difference, so tiny
// pressure imbalances do not produce infinitely stiff flows
function softRoot(x) {
  return x / Math.sqrt(x + 0.004);
}
/** Exact slope of softRoot. The plenum update divides by these slopes, so they must not be underestimated:
 * a floored estimate near zero made the volumes overshoot and chatter at the sub-step rate. */
function softRootSlope(x) {
  return (x + 0.008) / (2 * Math.pow(x + 0.004, 1.5));
}

// ---------------------------------------------------------------- compressor

/**
 * Parametric compressor map.
 *
 * A "backbone" line gives corrected flow and pressure rise versus corrected
 * speed fraction n. Each speed line is described by x = (PR-1)/(PRbackbone-1):
 *   x = 1  on the backbone, x = xs(n) at the surge line, x -> 0 towards choke.
 * Flow along a speed line: Wc = WcBackbone(n) * (1 + c(n) * (1 - x^3)),
 * c(n) small at high speed (steep, near-vertical lines) and larger at low speed.
 */
export function makeCompressorMap(p) {
  const m = { ...p };
  m.fW = (n) => (n <= 1 ? p.aW * n + (1 - p.aW) * Math.pow(n, p.kW) : 1 + p.sW * (n - 1));
  m.fP = (n) => (n <= 1 ? p.aP * n * n + (1 - p.aP) * Math.pow(n, p.kP) : 1 + p.sP * (n - 1));
  m.c = (n) => p.c0 + p.c1 * Math.pow(Math.max(0, 1 - n), 1.5);
  m.xs = p.xs; // surge line x as function of n
  /** Shape of a speed line: flow relative to the backbone (g), -dg/dx, efficiency relative to design (e). */
  m.line = (n, x, out) => {
    const c = m.c(n);
    out.g = 1 + c * (1 - x * x * x); out.dg = 3 * c * x * x;
    out.e = Math.max(p.effFloor, 1 - p.kEff * (1 - n) * (1 - n)) * (1 - 0.45 * (x - 1) * (x - 1));
    return out;
  };
  return m;
}

/**
 * Compressor map from a measured / reference table (NASA T-MATS R-line format: corrected flow,
 * pressure ratio and efficiency against corrected speed and R-line, R = 1 being the surge line).
 * The table is scaled so its design point (speed 1.0, R-line rDes) lands on this engine's design
 * point, which is the standard way to use a reference map for a different engine.
 * Below the table's lowest speed the backbone is continued with the parametric laws in `p`
 * (needed for starting and windmilling, which no published map covers).
 */
export function makeTableCompressor(p, tab, rDes = 2.0) {
  const m = makeCompressorMap(p);
  const Nc = tab.NcVec, R = tab.RlineVec, nR = R.length, nMin = Nc[0], nMax = Nc[Nc.length - 1];
  let jD = 0; while (jD < nR - 2 && R[jD + 1] < rDes) jD++;
  const fD = (rDes - R[jD]) / (R[jD + 1] - R[jD]);
  const W = new Float64Array(nR), PR = new Float64Array(nR), E = new Float64Array(nR);
  let cached = -1;
  const rows = (n) => {
    n = clamp(n, nMin, nMax); if (n === cached) return; cached = n;
    let i = 0; while (i < Nc.length - 2 && Nc[i + 1] < n) i++;
    const f = (n - Nc[i]) / (Nc[i + 1] - Nc[i]);
    for (let j = 0; j < nR; j++) { W[j] = tab.WcArray[i][j] + (tab.WcArray[i + 1][j] - tab.WcArray[i][j]) * f; PR[j] = tab.PRArray[i][j] + (tab.PRArray[i + 1][j] - tab.PRArray[i][j]) * f; E[j] = tab.EffArray[i][j] + (tab.EffArray[i + 1][j] - tab.EffArray[i][j]) * f; }
  };
  const des = (a) => a[jD] + (a[jD + 1] - a[jD]) * fD;
  // Several of these maps carry the stalled side of the low-speed lines (pressure ratio falling
  // again towards R = 1). The stability limit is the pressure peak, not the edge of the table.
  const peak = () => { let j = 0; while (j < jD && PR[j + 1] > PR[j]) j++; return j; };
  rows(1); const WcD = des(W), dpD = des(PR) - 1, effDt = des(E);
  const lawW = m.fW, lawP = m.fP, lawE = (n) => Math.max(p.effFloor, 1 - p.kEff * (1 - n) * (1 - n));
  rows(nMin); const w0 = des(W) / WcD, p0 = (des(PR) - 1) / dpD, xs0 = (PR[peak()] - 1) / (des(PR) - 1);
  m.table = true; m.nMin = nMin; m.source = tab;
  m.fW = (n) => { if (n < nMin) return (w0 * lawW(n)) / lawW(nMin); rows(n); return des(W) / WcD; };
  m.fP = (n) => { if (n < nMin) return (p0 * lawP(n)) / lawP(nMin); rows(n); return (des(PR) - 1) / dpD; };
  m.xs = (n) => { if (n < nMin) return xs0; rows(n); return (PR[peak()] - 1) / Math.max(des(PR) - 1, 1e-6); };
  m.line = (n, x, out) => {
    rows(n);
    const dpRef = Math.max(des(PR) - 1, 1e-6), wRef = des(W);
    const xj = (j) => (PR[j] - 1) / dpRef; // falls as j rises (towards choke)
    let j = peak(); if (j > nR - 2) j = nR - 2; while (j < nR - 2 && xj(j + 1) > x) j++;
    const xa = xj(j), xb = xj(j + 1), span = Math.max(xa - xb, 1e-6);
    let f = (xa - x) / span, e;
    if (f > 1) { // past the last R-line: choked, flow no longer rises, efficiency collapses
      out.g = W[nR - 1] / wRef; out.dg = 0.002; e = (E[nR - 1] / effDt) * Math.max(0.25, 1 - (f - 1) * span * 1.2);
    } else {
      f = Math.max(f, -0.5);
      out.g = (W[j] + (W[j + 1] - W[j]) * f) / wRef; out.dg = Math.max((W[j + 1] - W[j]) / wRef / span, 0.002);
      e = (E[j] + (E[j + 1] - E[j]) * f) / effDt;
    }
    if (n < nMin) e *= Math.max(0.6, lawE(n) / lawE(nMin));
    if (m.effTrim) e *= m.effTrim(n);
    if (m.effPeak) e = Math.min(e, m.effPeak / m.effD);
    out.e = Math.max(e, 0.05);
    return out;
  };
  return m;
}

export function speedFraction(m, N, Tin) {
  return clamp((N / m.Nd) * Math.sqrt(m.Td / Tin), 0, 1.25);
}

/**
 * Evaluate compressor.
 * @param m     map
 * @param st    persistent state {stalled, stallTime}
 * @param N     shaft speed rpm
 * @param mod   {flow: multiplier, eff: delta, xs: delta surge margin}
 * @returns     {W, Tout, power, torque, n, x, xs, eff, dWdPout, dWdPin, stalled}
 */
const LINE = { g: 1, dg: 0, e: 1 };
export function compressor(m, st, N, Tin, Pin, Pout, mod, dt, out) {
  const n = speedFraction(m, N, Tin);
  const dpRef = Math.max((m.PRd - 1) * m.fP(n), 2e-4);
  const corr = (Pin / m.Pd) / Math.sqrt(Tin / m.Td);
  const wRef = m.Wd * m.fW(n) * mod.flow * corr; // physical kg/s on backbone
  const PR = Pout / Pin;
  const x = (PR - 1) / dpRef;
  const xs = m.xs(n) + mod.xs;

  // stall / surge hysteresis
  let surgeEvent = false;
  if (!st.stalled) {
    if (x > xs && n > 0.15) {
      st.stalled = true;
      st.stallTime = 0;
      surgeEvent = n > 0.3;
    }
  } else {
    st.stallTime += dt;
    if ((x < 0.5 * xs && st.stallTime > 0.03) || n < 0.12) st.stalled = false;
  }

  let W, eff, dWdx, leakSens = 0;
  const xc = clamp(x, -1.5, xs);
  if (!st.stalled) {
    m.line(n, xc, LINE);
    W = wRef * LINE.g;
    dWdx = wRef * LINE.dg + 1e-9;
    if (x > xs) {
      // rotor too slow to stall "properly": it simply cannot hold the back
      // pressure and air leaks backwards through the blading
      const e = PR - 1 - xs * dpRef;
      const C = (m.Awm * Pout) / Math.sqrt(R_GAS * Tin), leak = C * softRoot(2 * e);
      W -= leak;
      leakSens = (C * softRootSlope(2 * e) * 2) / Pin;
    }
    eff = clamp((m.effD + mod.eff) * LINE.e, 0.2, 0.95);
  } else {
    // stalled characteristic: can only hold ~55% of surge pressure rise at
    // zero flow; above that the flow reverses and the plenum blows down.
    W = wRef * 0.35 * (1 - x / (0.55 * xs));
    W = Math.max(W, -0.6 * wRef);
    dWdx = (wRef * 0.35) / (0.55 * xs);
    eff = 0.3;
  }

  // flow through a slow / stopped rotor driven by ram pressure (windmilling)
  if (PR < 1) {
    const e = 1 - PR;
    const C = (m.Awm * Pin) / Math.sqrt(R_GAS * Tin), wm = C * softRoot(2 * e);
    W += wm;
    leakSens += (C * softRootSlope(2 * e) * 2) / Pin;
  }

  // thermodynamics
  let Tout, dh;
  if (PR >= 1) {
    const Ts = tIsentropic(Tin, PR, 0);
    dh = (h(Ts) - h(Tin)) / eff;
  } else {
    // expanding: rotor acts as a poor turbine
    const Ts = tIsentropic(Tin, PR, 0);
    dh = (h(Ts) - h(Tin)) * 0.45;
  }
  // parasitic windage/churning so a stalled or throttled rotor still absorbs work
  const U2 = m.U2d * n * n * (Tin / m.Td);
  if (st.stalled) dh += 0.25 * U2;
  Tout = tFromH(h(Tin) + dh, 0, Tin + dh / 1005);
  const Wwork = st.stalled ? Math.max(Math.abs(W), 0.3 * wRef) : Math.max(W, 0);
  const power = Wwork * dh;
  const omega = Math.max(N, 30) * 0.104719755;

  out.W = W;
  out.Tout = W >= 0 ? Tout : Tin;
  out.power = power;
  out.torque = power / omega;
  out.n = n;
  out.x = x;
  out.xs = xs;
  out.PR = PR;
  out.eff = eff;
  out.wc = W / corr; // corrected flow, kg/s at map reference conditions
  out.dWdPout = dWdx / (dpRef * Pin) + leakSens;
  out.dWdPin = Math.abs(W) / Pin + (dWdx * PR) / (dpRef * Pin) + leakSens;
  out.stalled = st.stalled;
  out.surgeEvent = surgeEvent;
  return out;
}

/** Points along a speed line and the surge line, for plotting maps. */
export function mapSpeedLine(m, n, mod = { flow: 1, xs: 0 }) {
  const pts = [], L = {};
  const xs = m.xs(n) + mod.xs;
  const dp = (m.PRd - 1) * m.fP(n);
  for (let i = 0; i <= 14; i++) {
    const x = (xs * i) / 14; m.line(n, x, L);
    pts.push({ wc: m.Wd * m.fW(n) * mod.flow * L.g, pr: 1 + x * dp });
  }
  return pts;
}

// ------------------------------------------------------------------- turbine

/** Ellipse-law flow function: 0 at PR=1, ~1 when choked. */
export function qFlow(PR) {
  const x = Math.max(0, 1 - 1 / (PR * PR));
  return x / Math.sqrt(x + 0.004) * 1.002;
}

/**
 * Turbine inlet mass flow from flow capacity K = W*sqrt(T)/P (choked value).
 * Returns flow and sensitivities for the implicit volume integration.
 */
export function turbineFlow(K, Tin, Pin, Pout, out) {
  if (Pin >= Pout) {
    const PR = Pin / Pout;
    const q = qFlow(PR);
    const base = (K * Pin) / Math.sqrt(Tin);
    const dq = 1 / (PR * PR * PR * Math.max(q, 0.03));
    out.W = base * q;
    out.dUp = (base * q) / Pin + (base * dq) / Pout;
    out.dDown = (base * dq * PR) / Pout;
  } else {
    const PR = Pout / Pin;
    const q = qFlow(PR);
    const base = (K * Pout) / Math.sqrt(Tin);
    const dq = 1 / (PR * PR * PR * Math.max(q, 0.03));
    out.W = -base * q;
    out.dUp = (base * dq * PR) / Pin;
    out.dDown = (base * q) / Pout + (base * dq) / Pin;
  }
  return out;
}

/**
 * Turbine expansion and shaft torque.
 * Efficiency follows the classic parabola in blade-speed ratio nu = U/C0:
 *   eta/eta_des = nu'(2 - nu'), nu' = nu/nu_des
 * which gives finite stall torque at zero speed and zero torque at runaway.
 * @param t {Nd, dhsD, effD}
 */
/**
 * Turbine efficiency table (NASA T-MATS format: efficiency against corrected speed and pressure
 * ratio). Returns a function giving efficiency relative to the table's design point.
 * ncD / prD: where this engine's design point sits in the table's own coordinates.
 */
export function makeTurbineTable(tab, ncD, prD) {
  const Nc = tab.NcVec, P = tab.PRVec, E = tab.EffArray;
  const look = (nc, pr) => {
    nc = clamp(nc, Nc[0], Nc[Nc.length - 1]); pr = clamp(pr, P[0], P[P.length - 1]);
    let i = 0; while (i < Nc.length - 2 && Nc[i + 1] < nc) i++;
    let j = 0; while (j < P.length - 2 && P[j + 1] < pr) j++;
    const f = (nc - Nc[i]) / (Nc[i + 1] - Nc[i]), g = (pr - P[j]) / (P[j + 1] - P[j]);
    return (E[i][j] * (1 - g) + E[i][j + 1] * g) * (1 - f) + (E[i + 1][j] * (1 - g) + E[i + 1][j + 1] * g) * f;
  };
  const eD = look(ncD, prD);
  return { ncD, prD, ncMin: Nc[0], ncMax: Nc[Nc.length - 1], prMin: P[0], prMax: P[P.length - 1], rel: (nc, pr) => look(nc, pr) / eD };
}
// isentropic work per unit inlet temperature, as a function of pressure ratio (gamma ~ 1.33)
const workFn = (pr) => 1 - Math.pow(Math.max(pr, 1.0001), -0.248);

export function turbineExpand(t, W, Tin, far, PR, N, effDelta, out) {
  if (PR <= 1.0005 || W <= 0) {
    out.Tout = Tin;
    out.torque = 0;
    out.power = 0;
    out.eff = 0;
    return out;
  }
  const Ts = tIsentropic(Tin, 1 / PR, far);
  const hin = h(Tin, far);
  const dhs = hin - h(Ts, far);
  const root = Math.sqrt(t.dhsD / dhs);
  const nu = (N / t.Nd) * root;
  // part-load loss: at low expansion ratio the blading runs far off its design
  // incidence and Reynolds number
  const u = Math.max(0, 1 - (PR - 1) / (t.PRd - 1));
  let effD = (t.effD + effDelta) * (1 - t.kPR * u * u);
  if (t.table) {
    // Inside the table's range the efficiency is the table's. Outside it (low pressure ratio at idle
    // and during starts) the analytic model continues from the table's edge without a step.
    const T = t.table, ncRel = (N / t.Nd) * Math.sqrt(t.Td / Tin);
    const prMap = 1 + ((PR - 1) * (T.prD - 1)) / (t.PRd - 1), ncMap = ncRel * T.ncD;
    const ncC = clamp(ncMap, T.ncMin, T.ncMax) / T.ncD, prMapC = clamp(prMap, T.prMin, T.prMax);
    const prC = 1 + ((prMapC - 1) * (t.PRd - 1)) / (T.prD - 1);
    const nuC = ncC * Math.sqrt(workFn(t.PRd) / workFn(prC)), uC = Math.max(0, 1 - (prC - 1) / (t.PRd - 1));
    const analytic = Math.max(nuC * (2 - nuC), 0.05) * (1 - t.kPR * uC * uC);
    effD *= clamp(T.rel(ncC * T.ncD, prMapC) / analytic, 0.7, 1.3);
  }
  if (t.kClr) effD *= 1 - t.kClr * clamp(1 - N / t.Nd, 0, 0.35);
  const shape = clamp(2 - nu, -1, 2);
  const omegaD = t.Nd * 0.104719755;
  out.torque = (W * dhs * effD * shape * root) / omegaD;
  const eff = clamp(effD * nu * shape, 0, 0.96);
  out.eff = eff;
  out.power = W * dhs * eff;
  out.Tout = tFromH(hin - dhs * eff, far, Tin - (dhs * eff) / 1150);
  return out;
}

// -------------------------------------------------------------------- nozzle

/** Convergent nozzle. Returns mass flow, gross thrust, exit velocity & sensitivity. */
export function nozzle(A, Pt, Tt, far, P0, out) {
  if (A <= 0) { out.W = 0; out.Fg = 0; out.V = 0; out.M = 0; out.Ts = Tt; out.dWdP = 0; return out; }
  const dP0 = Pt - P0;
  if (Math.abs(dP0) < 1000) {
    // Within 1 kPa of ambient (motoring, windmilling, an engine at rest): incompressible orifice law,
    // regularised over 5 Pa so the flow and its slope stay finite through zero. The plenum update uses
    // this exact slope; the plain square root has an infinite slope at zero and made the volumes chatter.
    const rho = Math.max(Pt, P0) / (R_GAS * Tt), K = A * Math.sqrt(2 * rho), a = Math.abs(dP0), d = 5;
    out.W = (K * dP0) / Math.sqrt(a + d);
    out.dWdP = (K * (0.5 * a + d)) / Math.pow(a + d, 1.5);
    const V = Math.abs(out.W) / (rho * A);
    out.V = dP0 > 0 ? V : 0; out.Fg = dP0 > 0 ? out.W * V : 0; out.M = V / Math.sqrt(1.4 * R_GAS * Tt); out.Ts = Tt;
    return out;
  }
  if (Pt <= P0) {
    // slight reverse flow, no thrust
    const rho = P0 / (R_GAS * Tt);
    const dP = P0 - Pt;
    out.W = -A * Math.sqrt(2 * rho * dP);
    out.Fg = 0;
    out.V = 0;
    out.M = 0;
    out.Ts = Tt;
    out.dWdP = Math.abs(out.W) / (2 * Math.max(dP, 100)) + 1e-6;
    return out;
  }
  const g = gamma(Tt, far);
  const PR = Pt / P0;
  const PRcrit = Math.pow((g + 1) / 2, g / (g - 1));
  if (PR >= PRcrit) {
    const Ts = (Tt * 2) / (g + 1);
    const Ps = Pt / PRcrit;
    const V = Math.sqrt(g * R_GAS * Ts);
    out.W = (Ps / (R_GAS * Ts)) * V * A;
    out.Fg = out.W * V + (Ps - P0) * A;
    out.V = V;
    out.M = 1;
    out.Ts = Ts;
    out.dWdP = out.W / Pt;
  } else {
    const Ts = Tt * Math.pow(PR, -(g - 1) / g);
    const V = Math.sqrt(Math.max(0, 2 * cp(0.5 * (Tt + Ts), far) * (Tt - Ts)));
    out.W = (P0 / (R_GAS * Ts)) * V * A;
    out.Fg = out.W * V;
    out.V = V;
    out.M = V / Math.sqrt(g * R_GAS * Ts);
    out.Ts = Ts;
    out.dWdP = Math.max(out.W / Pt, out.W / (2 * Math.max(Pt - P0, 100)));
  }
  return out;
}

/** Simple orifice between two total pressures (bleed valves). */
export function orifice(A, Pup, Tup, Pdown) {
  if (A <= 0 || Pup <= Pdown) return 0;
  const r = Math.max(Pdown / Pup, 0.528);
  const g = 1.4;
  const flow = Math.sqrt(((2 * g) / (g - 1)) * (Math.pow(r, 2 / g) - Math.pow(r, (g + 1) / g)));
  return (0.8 * A * Pup * flow) / Math.sqrt(R_GAS * Tup);
}
