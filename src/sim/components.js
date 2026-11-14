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
export function compressor(m, st, N, Tin, Pin, Pout, mod, dt, out) {
  const n = speedFraction(m, N, Tin);
  const dpRef = Math.max((m.PRd - 1) * m.fP(n), 2e-4);
  const corr = (Pin / m.Pd) / Math.sqrt(Tin / m.Td);
  const wRef = m.Wd * m.fW(n) * mod.flow * corr; // physical kg/s on backbone
  const PR = Pout / Pin;
  const x = (PR - 1) / dpRef;
  const xs = m.xs(n) + mod.xs;
  const c = m.c(n);

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
    W = wRef * (1 + c * (1 - xc * xc * xc));
    dWdx = wRef * 3 * c * xc * xc + 1e-9;
    if (x > xs) {
      // rotor too slow to stall "properly": it simply cannot hold the back
      // pressure and air leaks backwards through the blading
      const e = PR - 1 - xs * dpRef;
      const leak = (m.Awm * Pout) / Math.sqrt(R_GAS * Tin) * softRoot(2 * e);
      W -= leak;
      leakSens = leak / (Pin * Math.max(e, 2e-3));
    }
    const fn = Math.max(m.effFloor, 1 - m.kEff * (1 - n) * (1 - n));
    eff = clamp((m.effD + mod.eff) * fn * (1 - 0.45 * (xc - 1) * (xc - 1)), 0.25, 0.95);
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
    const wm = ((m.Awm * Pin) / Math.sqrt(R_GAS * Tin)) * softRoot(2 * e);
    W += wm;
    leakSens += wm / (Pin * Math.max(e, 2e-3));
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
  const pts = [];
  const xs = m.xs(n) + mod.xs;
  const dp = (m.PRd - 1) * m.fP(n);
  for (let i = 0; i <= 12; i++) {
    const x = (xs * i) / 12;
    pts.push({ wc: m.Wd * m.fW(n) * mod.flow * (1 + m.c(n) * (1 - x * x * x)), pr: 1 + x * dp });
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
  const effD = t.effD + effDelta;
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
