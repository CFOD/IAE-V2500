// Public-domain data for the IAE V2500-A5 family used to size and limit the model.
// Sources: EASA TCDS IM.E.069 / FAA TCDS E40NE (ratings, speeds, EGT limits),
// ICAO Aircraft Engine Emissions Databank (fuel flows), IAE / manufacturer
// brochures and standard references (bypass ratio, pressure ratio, airflow).
// Values recalled from those sources - verify against the originals before
// relying on them for anything other than a game.

export const LIMITS = {
  N1_100: 5650, // rpm = 100 % N1
  N2_100: 14950, // rpm = 100 % N2
  N1_RED: 100.0, // %
  N2_RED: 100.0, // %
  EGT_TAKEOFF: 650, // degC (A5: 5 min)
  EGT_MCT: 610, // degC
  EGT_START: 635, // degC
  STARTER_CUTOUT_N2: 43, // %
};

// Take-off ratings, sea-level static, flat rated to ISA+15 (ISA+30.. varies by model)
export const RATINGS = {
  'V2522-A5': { thrustLbf: 23040, bpr: 4.9 },
  'V2524-A5': { thrustLbf: 24480, bpr: 4.9 },
  'V2527-A5': { thrustLbf: 26600, bpr: 4.8 },
  'V2530-A5': { thrustLbf: 31400, bpr: 4.6 },
  'V2533-A5': { thrustLbf: 33000, bpr: 4.5 },
};
export const LBF = 4.4482216;

// Geometry / architecture (for the cutaway and for documentation)
export const ARCH = {
  fanDiameterM: 1.613, // 63.5 in
  lengthM: 3.2,
  fanBlades: 22,
  boosterStages: 4,
  hpcStages: 10,
  hptStages: 2,
  lptStages: 5,
  fuelNozzles: 20,
};

// Design point used to size the model: V2533-A5 class, sea-level static ISA,
// maximum take-off. Lower ratings are the same hardware throttled back.
export const DESIGN = {
  W2: 385, // kg/s total inlet air flow (848 lb/s)
  BPR: 4.5,
  OPR: 33.4,
  thrustN: 33000 * LBF,
  FPR: 1.9, // fan outer pressure ratio (assumed)
  LPCPR: 2.6, // fan root + 4 booster stages (assumed)
  N1d: 0.95 * 5650,
  N2d: 0.97 * 14950,
  effFan: 0.91,
  effLpc: 0.89,
  effHpc: 0.88,
  effHpt: 0.905,
  effLpt: 0.925,
  effBurner: 0.9995,
  dpBurner: 0.05,
  dpBypass: 0.015,
  dpJetpipe: 0.01,
  inletRecovery: 0.995,
  coolNgv: 0.08, // fraction of HPC flow re-entering at HPT nozzle guide vanes
  coolRotor: 0.06, // fraction re-entering downstream of the HPT rotor
  I1: 80, // kg m^2  LP spool polar inertia (estimated)
  I2: 9, // kg m^2  HP spool polar inertia (estimated)
  accessoryPowerW: 60e3,
};
