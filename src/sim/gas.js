// Gas properties for dry air and kerosene combustion products.
// Specific heat polynomials from Walsh & Fletcher, "Gas Turbine Performance"
// (2nd ed., formulae F3.23 / F3.24). Valid 200-2000 K; extrapolated with
// constant cp outside that range.
//
// All functions take temperature in K and fuel-air ratio (FAR, kg fuel / kg air).
// Enthalpy is in J/kg, entropy function phi = integral(cp/T dT) in J/kg/K.

export const R_GAS = 287.05; // J/kg/K (products differ by <0.1%)
export const FAR_STOICH = 0.0676; // kerosene
export const LHV_JET_A = 43.1e6; // J/kg

const A = [0.992313, 0.236688, -1.852148, 6.083152, -8.893933, 7.097112, -3.234725, 0.794571, -0.081873];
const B = [-0.718874, 8.747481, -15.863157, 17.254096, -10.233795, 3.081778, -0.361112, -0.003919];

const T_MIN = 200;
const T_MAX = 2000;

function poly(c, z) {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * z + c[i];
  return s;
}
// integral of poly dz from 0
function polyInt(c, z) {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * z + c[i] / (i + 1);
  return s * z;
}
// integral of poly/z dz (without the c0*ln z term)
function polyIntOverZ(c, z) {
  let s = 0;
  for (let i = c.length - 1; i >= 1; i--) s = s * z + c[i] / i;
  return s * z;
}

function fmix(far) {
  return far / (1 + far);
}

/** Specific heat at constant pressure, J/kg/K */
export function cp(T, far = 0) {
  const z = Math.min(Math.max(T, T_MIN), T_MAX) / 1000;
  return 1000 * (poly(A, z) + fmix(far) * poly(B, z));
}

export function gamma(T, far = 0) {
  const c = cp(T, far);
  return c / (c - R_GAS);
}

/** Sensible enthalpy (arbitrary zero), J/kg */
export function h(T, far = 0) {
  const f = fmix(far);
  if (T > T_MAX) return h(T_MAX, far) + cp(T_MAX, far) * (T - T_MAX);
  if (T < T_MIN) return h(T_MIN, far) + cp(T_MIN, far) * (T - T_MIN);
  const z = T / 1000;
  return 1e6 * (polyInt(A, z) + f * polyInt(B, z));
}

/** Entropy function phi(T) = integral cp/T dT, J/kg/K */
export function phi(T, far = 0) {
  const f = fmix(far);
  if (T > T_MAX) return phi(T_MAX, far) + cp(T_MAX, far) * Math.log(T / T_MAX);
  if (T < T_MIN) return phi(T_MIN, far) + cp(T_MIN, far) * Math.log(T / T_MIN);
  const z = T / 1000;
  return 1000 * ((A[0] + f * B[0]) * Math.log(z) + polyIntOverZ(A, z) + f * polyIntOverZ(B, z));
}

/** Invert h(T) by Newton iteration */
export function tFromH(hTarget, far = 0, guess = 800) {
  let T = guess;
  for (let i = 0; i < 12; i++) {
    const dT = (hTarget - h(T, far)) / cp(T, far);
    T += dT;
    if (T < 50) T = 50;
    if (Math.abs(dT) < 1e-3) break;
  }
  return T;
}

/**
 * Temperature after an isentropic pressure change from (T1) by pressure
 * ratio pr = P2/P1 (pr > 1 compression, < 1 expansion).
 */
export function tIsentropic(T1, pr, far = 0) {
  const target = phi(T1, far) + R_GAS * Math.log(pr);
  let T = T1 * Math.pow(pr, 0.27);
  for (let i = 0; i < 12; i++) {
    const dT = ((target - phi(T, far)) * T) / cp(T, far);
    T += dT;
    if (T < 50) T = 50;
    if (Math.abs(dT) < 1e-3) break;
  }
  return T;
}

/** International Standard Atmosphere up to 20 km. dT = ISA deviation, K */
export function isa(altM, dT = 0) {
  const T0 = 288.15, P0 = 101325, L = 0.0065;
  let T, P;
  if (altM <= 11000) {
    T = T0 - L * altM;
    P = P0 * Math.pow(T / T0, 5.25588);
  } else {
    T = 216.65;
    P = 22632.1 * Math.exp(-(altM - 11000) / 6341.62);
  }
  return { T: T + dT, P };
}
