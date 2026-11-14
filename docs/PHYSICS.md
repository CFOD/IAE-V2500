# Physics model

## What is simulated

A zero-dimensional, two-spool, separate-flow turbofan performance model integrated in real time at
2 kHz (the inter-component-volume method used in engine transient decks).

**States**: N1, N2; total pressure in five volumes (bypass duct, LPC exit, combustor, between the
turbines, jet pipe); fast temperature states; turbine metal temperature; flame on/off; fuel puddle;
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
7. Convergent core and bypass nozzles, choked or unchoked; thrust = gross thrust - ram drag.
8. Mass imbalance in each volume -> dP/dt. Torque imbalance on each spool -> dN/dt.

Gas properties use the Walsh & Fletcher temperature-dependent cp polynomials for air and kerosene
products; compression and expansion are solved with the entropy function rather than constant gamma.

Idle, acceleration, starting, hung and hot starts, surge (with flow reversal and recovery cycles),
flame-out, windmilling and altitude effects are not scripted. They come out of those equations.

## Sizing

`sizeEngine()` runs a design-point cycle for the V2533-A5 class at sea-level static ISA and solves the
turbine entry temperature that gives 33,000 lbf, then derives turbine flow capacities and nozzle areas.
Lower ratings are the same hardware at a lower EPR limit, as on the real engine.

Published inputs: thrust ratings, 100 % speeds (N1 5650 rpm, N2 14950 rpm), EGT limits (650 / 610 /
635 °C), airflow 385 kg/s, bypass ratio 4.5, overall pressure ratio 33.4, stage counts, starter cut-out.
These were entered from memory of EASA/FAA type-certificate data sheets, the ICAO emissions databank
and manufacturer brochures - check them against the originals.

Assumed (not published): fan and LPC pressure ratio split, component efficiencies, cooling flows,
spool inertias, volumes, starter torque, all schedule break-points.

## How it compares (run `node tools/calibrate.js`)

| Quantity | Model | Published |
|---|---|---|
| V2527-A5 take-off thrust | 118.5 kN | 118.3 kN |
| V2527-A5 bypass ratio at take-off | 4.83 | 4.8 |
| V2527-A5 overall pressure ratio | 27.4 | 27.2 |
| V2527-A5 inlet airflow | 350 kg/s | ~355-368 kg/s |
| V2527-A5 take-off fuel flow | 1.16 kg/s | ~1.05 kg/s (ICAO) |
| Cruise TSFC, FL350 M0.78 | 0.573 lb/lbf/h | ~0.54-0.58 |
| Ground idle | N1 26 %, N2 58 %, 353 kg/h, EGT 373 °C | roughly N1 22 %, N2 58 %, 350-400 kg/h, EGT ~400 °C |
| Automatic start | ~60 s, peak EGT ~515 °C | ~45-60 s, limit 635 °C |
| Idle to 95 % take-off thrust | ~6 s | 5-8 s |

The bypass ratio, pressure ratio and airflow at the V2527 rating, and the cruise TSFC, were not tuned -
they follow from sizing at the V2533 point.

## Known limitations

- **Compressor and turbine maps are generic.** Real maps are proprietary. Surge margins, the exact
  speeds at which bleeds are needed and off-design efficiencies are plausible, not measured.
- Take-off fuel flow is about 10 % higher than ICAO data, so component efficiencies are a little pessimistic.
- Idle N1 is a few percent high.
- The real V2500 mixes core and bypass in a common nozzle; the model uses two separate nozzles. This is
  why model EPR (1.65 at V2527 take-off) is higher than the real engine's (around 1.5).
- FADEC logic is a simplified imitation: EPR limits do not follow the real altitude/Mach/temperature
  rating tables, and schedule break-points are tuned to this model.
- No Reynolds-number effects, no tip-clearance or active clearance control, no oil/fuel system,
  no thrust reverser, single lumped heat-soak mass, no humidity or icing.
- Ambient changes are a test-cell step, not a flight model.
