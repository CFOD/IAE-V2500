# Physics model

## What is simulated

A zero-dimensional, two-spool, mixed-exhaust turbofan performance model integrated in real time at
2 kHz (the inter-component-volume method used in engine transient decks).

**States**: N1, N2; total pressure in six volumes (bypass duct, LPC exit, combustor, between the
turbines, jet pipe, mixer); fast temperature states; turbine metal temperature; flame on/off; fuel puddle;
actuator positions.

Each step:

1. Inlet: ISA atmosphere + ram compression from Mach number.
2. Fan (bypass section) and LPC (fan root + 4 booster stages), both on N1: each reads a compressor
   map with its pressure ratio and corrected speed -> mass flow, efficiency, exit temperature, torque.
3. 2.5 bleed ring dumps LPC air into the bypass duct.
4. HPC (10 stages, N2) with variable-stator effects on flow, efficiency and surge line; stage 7 / 10
   handling bleeds, customer bleed and turbine cooling air are taken off.
5. Combustor: energy balance with fuel lower heating value, combustion efficiency falling at low
   pressure, stoichiometric limit, lean and rich blow-out limits, ignition delay, pooled unburnt fuel.
6. HPT and LPT: choking flow capacity (ellipse law), efficiency versus blade-speed ratio (finite stall
   torque, zero torque at runaway), cooling air re-mixing, heat exchange with turbine metal.
7. Common nozzle assembly, as on the real engine: core and bypass streams meet at a mixing plane
   with a shared static pressure, mix (enthalpy and momentum-weighted total pressure), and leave
   through one convergent nozzle. Thrust = gross thrust - ram drag.
8. Mass imbalance in each volume -> dP/dt. Torque imbalance on each spool -> dN/dt.

Gas properties use the Walsh & Fletcher temperature-dependent cp polynomials for air and kerosene
products; compression and expansion are solved with the entropy function rather than constant gamma.

Idle, acceleration, starting, hung and hot starts, surge (with flow reversal and recovery cycles),
flame-out, windmilling and altitude effects are not scripted. They come out of those equations.

## Intake condensation and ground vortex (visual only)

Computed in `app/main.js` from simulation outputs; they do not feed back into the cycle.
Inlet throat Mach number is solved from mass flow, total pressure and temperature over a 1.84 m²
throat. That gives static temperature Ts = Tt/(1+0.2M²) and the matching static pressure drop. The
ambient dew point follows from temperature and relative humidity (Magnus formula), lowered for the
reduced vapour pressure at the throat. Fog density rises as Ts falls below that dew point. At
take-off power the throat runs near Mach 0.5, a drop of about 14 K, so fog forms above roughly 60 %
humidity on a 15 °C day. The ground vortex is shown when the engine is static and throat velocity
exceeds about 70 m/s; this is a simple threshold, not a vortex-formation correlation, and wind is
not modelled.

## Sizing

`sizeEngine()` runs a design-point cycle for the V2533-A5 certified take-off rating (31,600 lbf,
sea-level static, ISA) and solves the turbine entry temperature that gives that thrust, then derives
turbine flow capacities and nozzle areas. Lower ratings are the same hardware at a lower EPR limit,
as on the real engine.

## Data and where it comes from

Checked in November 2026 by searching the sources below. The primary PDFs could not be downloaded
from the build environment, so "verified" means the figure was quoted from the named source in a
search result, not that the document was read end to end. `src/sim/v2500.js` marks each value
[V] verified or [M] from memory / secondary source.

| Data | Value | Source | Status |
|---|---|---|---|
| 100 % N1 / N2 | 5650 / 14950 rpm | IAE V2500-A1/A5 Engine Operating Instructions | verified |
| Take-off thrust V2527-A5 | 11,031 daN = 24,800 lbf | EASA TCDS IM.E.069 | verified |
| Take-off thrust V2533-A5 | 140.56 kN = 31,600 lbf | EASA TCDS / IAE | verified |
| Take-off thrust V2522 / V2524 | 23,040 / 24,480 lbf | JCAB data sheet, IAE specification | verified, sources not fully consistent |
| Take-off thrust V2530-A5 | 29,900 lbf | | from memory |
| Max continuous V2524 / V2527 / V2533 | 19,200 / 22,240 / 26,950 lbf | IAE model specification | verified |
| Flat rating V2524 / V2527 / V2533 | ISA+40 / +31 / +15 °C | IAE model specification | verified |
| EGT limits (indicated) | take-off 635 °C (650 °C on V2530/33), max continuous 610 °C, start 635 °C | IAE operating instructions | verified |
| EGT / EPR sensing | 4 thermocouples and P4.9 rakes in the turbine exhaust case; EPR = P4.9/P2 | V2500 training notes | verified |
| Handling bleeds | three stage-7 and one stage-10 valves, open for starting | V2500 training notes | verified |
| Starter cut-out, minimum N2 for fuel | 43 %, 16 % | operating instructions | verified |
| Ground idle | about N1 21.7 %, N2 60 %, EGT 400 °C, 300-378 kg/h | operating instructions, test-rig paper | verified |
| ICAO fuel flow, V2527-A5 climb-out | 0.880 kg/s | ICAO emissions databank | verified |
| ICAO take-off / approach / idle fuel flow, OPR 27.2, BPR 4.82 | 1.053 / 0.319 / 0.128 kg/s | ICAO emissions databank | from memory |
| V2533-A5 OPR 33.44, BPR 4.46, airflow 848 lb/s | | ICAO / manufacturer | from memory |

The well-known 26,600 lbf (V2527) and 33,000 lbf (V2533) figures are bump / marketing ratings, not the
certified take-off ratings, and are not used.

Assumed (not published): fan and LPC pressure-ratio split, component efficiencies, cooling flows,
mixing-plane Mach number, spool inertias, volumes, starter torque, all schedule break-points.

## How it compares (`npm test` asserts these; `node tools/calibrate.js` prints them)

| Quantity | Model | Published |
|---|---|---|
| V2527-A5 take-off fuel flow at 111.2 kN | 1.04 kg/s | 1.053 |
| V2527-A5 climb-out (85 %) fuel flow | 0.855 kg/s | 0.880 |
| V2527-A5 approach (30 %) fuel flow | 0.308 kg/s | 0.319 |
| V2527-A5 idle (7 %) fuel flow | 0.127 kg/s | 0.128 |
| V2527-A5 overall pressure ratio | 27.0 | 27.2 |
| V2527-A5 bypass ratio | 4.84 | 4.82 |
| V2527-A5 take-off EPR | 1.615 | about 1.6 (crew report) |
| Ground idle | N1 24 %, N2 58.5 %, 365 kg/h, EGT 381 °C | N1 21.7 (+3.8/-2), N2 60 (±2), 300-378 kg/h, EGT 400 (+90/-25) |
| V2527-A5 take-off EGT, ISA / ISA+30 | 499 / 582 °C | limit 635 °C |
| Cruise TSFC, FL350 M0.78 | 0.555 lb/lbf/h | about 0.54-0.58 (unverified) |
| Idle to 95 % take-off thrust | about 6 s | certification requires <= 5 s from flight idle |

Only the V2533 design point and the low-power component losses were tuned. The V2527 pressure ratio,
bypass ratio, EPR and the four ICAO fuel flows then follow.

## Remaining limitations

- **Compressor and turbine maps are not IAE's.** They are proprietary and were not found in any
  public source. The maps here are generic shapes constrained to reproduce the published points
  above. Between and beyond those points (exact surge margins, the speeds at which each bleed valve
  must be open, sub-idle behaviour) the model is plausible, not measured.
- **FADEC rating tables are not IAE's.** Take-off is flat rated to the published corner temperature and
  max-continuous / climb use the published thrusts, but the real altitude-Mach-temperature EPR tables
  and the bleed / stator schedule break-points are proprietary; the ones here are tuned to this model.
- Start time (about 35 s to idle) and peak start EGT are not checked against a published figure.
- No Reynolds-number effects, tip clearance or active clearance control, oil or fuel system,
  thrust reverser, humidity or icing; one lumped heat-soak mass.
- Ambient changes are a test-cell step, not a flight model.
