// Published data for the IAE V2500-A5 family used to size and limit the model.
//
// Verification status (web search of the sources, Nov 2026 - the primary PDFs
// could not be downloaded from the build environment, so "verified" means the
// figure was quoted from the named source by a search result):
//   [V] verified   [M] from memory / secondary only - treat as approximate
//
// Sources: EASA TCDS IM.E.069 issue 05 (20 Dec 2022); IAE V2500-A1/A5 Engine
// Operating Instructions; IAE model specification (flat ratings, max continuous);
// ICAO Aircraft Engine Emissions Databank; V2500 training / component-location notes.

export const LIMITS = {
  N1_100: 5650, // rpm = 100 % N1                         [V] operating instructions
  N2_100: 14950, // rpm = 100 % N2                        [V] operating instructions
  N1_RED: 100.0, // %                                     [V]
  N2_RED: 100.0, // %                                     [V]
  EGT_MCT: 610, // degC indicated, max continuous         [V]
  EGT_START: 635, // degC, ground and air starts          [V]
  STARTER_CUTOUT_N2: 43, // %                             [V] (sources give 43-45 %)
  MIN_START_N2: 16, // % - no fuel below this             [V]
};

// Certified sea-level-static take-off ratings (5 min). The familiar "26,600 lbf"
// and "33,000 lbf" figures are bump / marketing ratings, not the TCDS ratings.
//   toLbf   take-off thrust                    mctLbf  maximum continuous thrust
//   flatISA take-off is flat rated to ISA + this many degC
//   egtTO   indicated take-off EGT limit (the higher ratings display 650 for an actual 670)
export const RATINGS = {
  'V2522-A5': { toLbf: 23040, mctLbf: 19200, flatISA: 40, egtTO: 635 }, // TO [V]; MCT, flat [M]
  'V2524-A5': { toLbf: 24480, mctLbf: 19200, flatISA: 40, egtTO: 635 }, // TO, MCT, flat [V] (sources not fully consistent on TO)
  'V2527-A5': { toLbf: 24800, mctLbf: 22240, flatISA: 31, egtTO: 635 }, // all [V]  (TCDS 11031 daN)
  'V2530-A5': { toLbf: 29900, mctLbf: 26950, flatISA: 15, egtTO: 650 }, // egt [V]; TO, MCT, flat [M]
  'V2533-A5': { toLbf: 31600, mctLbf: 26950, flatISA: 15, egtTO: 650 }, // all [V]  (140.56 kN)
};

// ICAO emissions databank, V2527-A5 (rated 111.2 kN): fuel flow kg/s at 100 / 85 / 30 / 7 % thrust.
// Climb-out 0.880 [V]; the other three [M] (same databank entry). OPR 27.2, BPR 4.82 [M].
export const ICAO_V2527 = { ratedN: 111.2e3, takeoff: 1.053, climb: 0.880, approach: 0.319, idle: 0.128, opr: 27.2, bpr: 4.82 };
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

// Design point used to size the model: V2533-A5 certified take-off, sea-level
// static ISA (31,600 lbf, OPR 33.44, BPR 4.46 per ICAO [M]; airflow 848 lb/s [M]).
// Lower ratings are the same hardware throttled back.
export const DESIGN = {
  W2: 385, // kg/s total inlet air flow (848 lb/s)
  BPR: 4.46,
  OPR: 33.44,
  thrustN: 31600 * LBF,
  FPR: 1.78, // fan outer pressure ratio (assumed)
  LPCPR: 2.45, // fan root + 4 booster stages (assumed)
  N1d: 0.95 * 5650,
  N2d: 0.97 * 14950,
  effFan: 0.91,
  effLpc: 0.89,
  effHpc: 0.87,
  effHpt: 0.905,
  effLpt: 0.925,
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
