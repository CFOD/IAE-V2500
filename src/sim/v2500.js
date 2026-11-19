// Published data for the IAE V2500-A5 family used to size and limit the model.
//
// Every value below was read from the primary document in November 2026:
//   [T] EASA Type-Certificate Data Sheet IM.E.069, issue 05, 20 December 2022
//   [I] ICAO Aircraft Engine Emissions Databank v32B (hosted by EASA), "Gaseous Emissions and Smoke"
//   [O] IAE V2500-A1/A5 Engine Operating Instructions / training notes (via search result, not read in full)

export const LIMITS = {
  N1_100: 5650, // rpm = 100 % N1, also the maximum                [T]
  N2_100: 14950, // rpm = 100 % N2, also the maximum               [T]
  N1_RED: 100.0, // %                                              [T]
  N2_RED: 100.0, // %                                              [T]
  EGT_MCT: 610, // degC, max continuous (actual and indicated)     [T]
  EGT_START: 635, // degC, starting                                [T]
  STARTER_CUTOUT_N2: 43, // %                                      [O] (sources give 43-45 %)
  MIN_START_N2: 16, // % - no fuel below this                      [O]
  N1_MIN_ICING: 24.8, // % (1400 rpm) minimum in icing conditions  [T]
  STARTER_TORQUE_MAX: 637, // N.m at zero rpm, at the starter pad  [T]
  STARTER_GEAR: 0.941, // starter pad speed / N2                   [T]
  GENERATOR_MAX_W: 131e3, // continuous electrical off-take        [T]
  DRY_WEIGHT_KG: 2404, //                                          [T]
};

// Sea-level-static ratings on an ISA day (15 degC, 1013.2 hPa), no bleed or off-take.   all [T]
//   toDaN / mctDaN  take-off (5 min) and maximum continuous thrust
//   flatISA         take-off rating is available up to ISA + this (max continuous: ISA + 10 for all)
//   egtTO           indicated take-off EGT limit; egtTOactual is the true gas temperature limit
// The familiar "26,600 lbf" and "33,000 lbf" figures are marketing / bump ratings, not these.
export const RATINGS = {
  'V2522-A5': { toDaN: 10248, mctDaN: 8540, flatISA: 40, egtTO: 635, egtTOactual: 625 },
  'V2524-A5': { toDaN: 10889, mctDaN: 8540, flatISA: 40, egtTO: 635, egtTOactual: 635 },
  'V2527-A5': { toDaN: 11031, mctDaN: 9892, flatISA: 31, egtTO: 635, egtTOactual: 645 },
  'V2530-A5': { toDaN: 13300, mctDaN: 11987, flatISA: 15, egtTO: 650, egtTOactual: 650 },
  'V2533-A5': { toDaN: 14056, mctDaN: 11987, flatISA: 15, egtTO: 650, egtTOactual: 670 },
};
export const MCT_FLAT_ISA = 10;
for (const r of Object.values(RATINGS)) { r.toLbf = (r.toDaN * 10) / 4.4482216; r.mctLbf = (r.mctDaN * 10) / 4.4482216; }

// ICAO databank entries: rated output [N], bypass ratio, pressure ratio and fuel flow [kg/s]
// at take-off (100 %), climb-out (85 %), approach (30 %) and idle (7 %) of rated output.   all [I]
export const ICAO = {
  'V2522-A5': { uid: '3IA006', ratedN: 102.66e3, bpr: 4.88, opr: 25.6, takeoff: 0.971, climb: 0.817, approach: 0.311, idle: 0.118 },
  'V2524-A5': { uid: '3IA007', ratedN: 109.06e3, bpr: 4.81, opr: 26.9, takeoff: 1.042, climb: 0.868, approach: 0.328, idle: 0.123 },
  'V2527-A5': { uid: '1IA003', ratedN: 111.2e3, bpr: 4.82, opr: 27.2, takeoff: 1.053, climb: 0.880, approach: 0.319, idle: 0.128 },
  'V2530-A5': { uid: '1IA005', ratedN: 133.4e3, bpr: 4.54, opr: 32.1, takeoff: 1.331, climb: 1.077, approach: 0.377, idle: 0.138 },
  'V2533-A5': { uid: '3IA008', ratedN: 140.56e3, bpr: 4.46, opr: 33.44, takeoff: 1.426, climb: 1.1447, approach: 0.3901, idle: 0.1363 },
};
export const ICAO_V2527 = ICAO['V2527-A5'];

// Note on EGT: the data sheet says T4.9 is measured "aft of LPT stage 1", while IAE training
// material places the four thermocouples in the turbine exhaust case struts (LPT exit), the same
// station as the P4.9 probes used for EPR. The model uses LPT exit: gas after the first LPT stage
// would be far hotter than the 610-670 degC limits.
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

// Design point used to size the model: V2533-A5 take-off, sea-level static ISA:
// 14,056 daN [T], pressure ratio 33.44 and bypass ratio 4.46 [I], inlet airflow 872 lb/s [A]
// (Airbus training manual: 858-872 lb/s for the V2530/33).
// Lower ratings are the same hardware throttled back. Component efficiencies and the fan pressure
// ratio are assumed, chosen with the airflow so the ICAO fuel flows are matched (docs/PHYSICS.md).
export const DESIGN = {
  W2: 395.5, // kg/s total inlet air flow (872 lb/s)
  BPR: 4.46,
  OPR: 33.44,
  thrustN: 140560,
  FPR: 1.75, // fan outer pressure ratio (assumed)
  LPCPR: 2.45, // fan root + 4 booster stages (assumed)
  N1d: 0.95 * 5650,
  N2d: 0.97 * 14950,
  effFan: 0.91,
  effLpc: 0.89,
  effHpc: 0.87,
  effHpt: 0.885,
  effLpt: 0.915,
  effBurner: 0.9995,
  dpBurner: 0.05,
  dpBypass: 0.015,
  dpJetpipe: 0.01,
  dpMix: 0.005, // total pressure lost in mixing
  mixMach: 0.6, // bypass stream Mach number at the mixing plane (assumed)
  inletRecovery: 0.995,
  coolNgv: 0.08, // fraction of HPC flow re-entering at HPT nozzle guide vanes
  coolRotor: 0.06, // fraction re-entering downstream of the HPT rotor
  I1: 80, // kg m^2  LP spool polar inertia (estimated)
  I2: 9, // kg m^2  HP spool polar inertia (estimated)
  accessoryPowerW: 60e3,
};
