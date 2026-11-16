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

## Thrust reverser

When deployed (about two seconds of travel) the bypass stream is shut off from the mixer and leaves
through the cascades instead, modelled as a nozzle to ambient whose gross thrust acts 55 % forwards.
The core still exhausts through the common nozzle. Because the core no longer exhausts against the
bypass stream, EPR stops tracking thrust, so the FADEC governs reverse on fan speed between idle and
80 % N1. The cascade area, turning efficiency and the 80 % limit are assumptions; the real limits
were not found in a public source. With the doors shut the core jet dumps into a tailpipe sized for
the whole engine flow and loses its dynamic head, so it contributes little forward thrust. Net thrust
at maximum reverse is about -32 kN at sea level static (roughly 30 % of V2527 take-off thrust).

## Failures (`src/sim/damage.js`)

Abuse turns into the damage a real engine would suffer. The mechanisms are real; the thresholds and
rates are engineering estimates, not IAE data.

| What you do | What happens, and why |
|---|---|
| Run the turbine too hot | Blade metal temperature is worked out from gas temperature and cooling air. Creep life halves for roughly every 12 K and falls with the fourth power of speed: no measurable use in normal running, minutes at 100 K over, seconds beyond that. When it runs out a blade lets go and takes others with it: efficiency collapses, vibration, sparks from the tailpipe. Above about 1330 °C metal the nickel alloy starts to melt and the blading burns away. |
| Flame far hotter than design (fuelling a stalled compressor, hot start) | The combustor liner's cooling film fails and it burns through: flame escapes the core and the nacelle is on fire. Fuel beyond what the air can burn carries on burning through the turbine and out of the tailpipe (torching). |
| Overspeed with the protections off | Discs hold to about 120 % of red line, then burst. This is uncontained: the engine is destroyed, seizes and burns. |
| Surge it repeatedly | After the first few surges each one damages the HP compressor blading; eventually blades fail and go through the core. |
| Cut the fuel at high power | The flame is out at once, N2 runs down in under a minute and EGT falls to the temperature of the hot metal. The thin casings cool and shrink in seconds while the discs stay hot, so the blade tips cut into their seals: a small permanent efficiency loss. Three minutes at idle first avoids it. |
| Restart a hot engine | Left standing, a hot core cools unevenly and the HP rotor bows, worst about ten minutes to an hour after shut-down. Started in a hurry by hand, it rubs as it passes about 35 % N2. The automatic start motors the engine for 30 s before it opens the fuel, which is enough to straighten it. |
| Keep feeding fuel to a wrecked core | It burns outside the engine. The fire bottle only works once the fuel is off. |

Vibration is shown in cockpit units (advisory at 5). Reset, or "Restore new-engine condition", repairs everything.

## Oil system (`src/sim/oil.js`)

One 25-quart tank feeds a gear pump on the gearbox; the oil is cooled by fan air (air-cooled oil
cooler, modulated) and then by fuel (fuel-cooled oil cooler), and scavenged back to the tank.

- **Pressure** follows N2 and oil viscosity: high on a cold start, about 150 psi at idle, 240-270 at take-off. The low-pressure warning is at 60 psi.
- **Quantity** drops by about 4.5 quarts as the engine runs up (oil in circulation) and comes back after shut-down. Normal consumption is about 0.3 qt/h.
- **Temperature** is a balance of bearing, gearbox and hot-core heat against the two coolers. At idle little fuel flows, so the air cooler does most of the work; with its valve stuck shut the oil overheats at idle but not at take-off.
- **Bearings**: with pressure lost they last about a minute at take-off power and a few minutes at idle. Metal appears on the chip detector, vibration and drag rise, then the HP rotor seizes. Overheated oil (above 165 °C) and oil coked by a hot shut-down do the same more slowly.
- Faults: external leak, pump drive failure, No. 4 bearing seal failure (oil lost into the gas path, smoke from the exhaust), cooler valve stuck shut, clogged filter.

Tank size, pressure, temperature, quantity and filter limits are from the Airbus training manual
(table under "Data and where it comes from"). Oil flows, heat loads and bearing failure times are estimates.

## Component maps

The compressor and turbine characteristics are the reference maps published with NASA's T-MATS
toolbox (the JT9D example, Apache License 2.0), imported by `tools/import-tmats-maps.py` into
`src/sim/maps/jt9d.js` and scaled so that each map's design point lands on this engine's design
flow, pressure ratio, speed and efficiency. They are real turbofan maps in R-line form: corrected
flow, pressure ratio and efficiency against corrected speed for the fan, LP and HP compressors, and
efficiency against speed and pressure ratio for both turbines. They are not IAE's maps, which are
not public.

Where the table carries the stalled side of a speed line (pressure ratio falling again towards the
edge), the stability limit is taken at the pressure peak. Below each table's lowest speed (starting
and sub-idle) the characteristic is continued with smooth analytic laws.

### Map adaptation

A scaled map from another engine does not reproduce this one everywhere, so it is adapted against
the ICAO fuel flows and the published ground idle, the usual practice when only overall engine data
is available. Everything adapted is listed here:

| Adaptation | Why |
|---|---|
| Fan design point on R-line 2.3 rather than 2.0 | working line clear of stall at part speed with a mixed exhaust |
| Fan and HPC efficiency held to peaks of 0.915 and 0.875 | the JT9D tables peak 4 % above their design line; scaled as they are the fan would reach 0.95 |
| LPC efficiency falls 2 % per 10 % of speed below design | ICAO approach and idle fuel flows |
| HPC low-speed flow and pressure rise raised up to 45 % at 60 % speed | ground idle: the V2500 core passes far more air at 58.5 % N2 than the JT9D HPC does |
| Turbine efficiency falls 1.5 % (HP) and 0.8 % (LP) per 10 % of speed | tip clearance opening at low power; ICAO part-power fuel flows |

After any change to the maps, `python3 tools/retune.py` re-derives the FADEC's thrust-to-EPR and
steady fuel schedule tables from the model and `node tools/icao.js` prints the comparison below.

## Sizing

`sizeEngine()` runs a design-point cycle for the V2533-A5 certified take-off rating (31,600 lbf,
sea-level static, ISA) and solves the turbine entry temperature that gives that thrust, then derives
turbine flow capacities and nozzle areas. Lower ratings are the same hardware at a lower EPR limit,
as on the real engine.

## Data and where it comes from

Read from the primary documents in November 2026 (`src/sim/v2500.js` tags each value):

- **[T]** EASA Type-Certificate Data Sheet IM.E.069, issue 05, 20 December 2022
- **[I]** ICAO Aircraft Engine Emissions Databank v32B, hosted by EASA
- **[O]** IAE operating instructions and training notes, seen only as search-result excerpts
- **[A]** Airbus Single Aisle Technical Training Manual, T1+T2 (IAE V2500) Lvl 2&3, ATA 70-80, April 2013 (supplied by the project owner; not in the repository)

| Data | Value | Source |
|---|---|---|
| 100 % and maximum N1 / N2 | 5650 / 14950 rpm | T |
| Take-off thrust V2522 / 24 / 27 / 30 / 33 | 10248 / 10889 / 11031 / 13300 / 14056 daN | T |
| Maximum continuous thrust | 8540 / 8540 / 9892 / 11987 / 11987 daN | T |
| Take-off flat rating | ISA+40 (V2522/24), ISA+31 (V2527), ISA+15 (V2530/33); max continuous ISA+10 | T |
| EGT limits, actual / indicated | take-off 625/635, 635/635, 645/635, 650/650, 670/650 °C; max continuous 610; start 635 | T |
| Starter | 637 N·m maximum at zero speed, pad turns at 0.941 × N2 | T |
| Generator off-take | 131 kW continuous | T |
| Dry weight | 2404 kg | T |
| Fuel flow at 100 / 85 / 30 / 7 % thrust, pressure ratio, bypass ratio, all five ratings | see `ICAO` table in `v2500.js` | I |
| Starter cut-out, minimum N2 for fuel | 43 %, 16 % | O |
| Ground idle | about N1 21.7 %, N2 60 %, EGT 400 °C, 300-378 kg/h | O |
| Handling bleeds | three stage-7 and one stage-10 valves, open for starting | O |
| Inlet airflow at take-off | 770-781 lb/s (V2522/24), 811 (V2527), 858-872 (V2530/33) | A. The model's design point uses 385 kg/s for the V2533 against the manual's 396 |
| Bypass ratio / climb pressure ratio / cruise sfc | 4.9, 4.8, 4.6-4.5 / 32.8 (35.2 for the A321 ratings) / 0.543 lb/lbf/h | A |
| Thrust lever | 0-45 deg forward: climb detent 25, FLX/MCT 35, TOGA 45; reverse idle -6, maximum reverse -20 | A |
| Automatic start | start valve opens with the master switch; fuel and ignition after 30 s of motoring; abort possible up to 50 % N2; starter cut-out 43 % N2 | A |
| Manual start | 30 s dry crank, then master ON gives fuel and both igniters; no automatic shut-down | A |
| Oil | no pressure regulator (pressure follows N2); cold-start relief 450 psi; low-pressure warning < 60 psi, amber < 80, advisory > 390; temperature advisory > 157 °C, warning 165 °C; quantity advisory < 5 qt; filter switch 12 psi, by-pass 20 psi; 25 qt tank; six scavenge pumps | A, SR Technics booklet |
| Handling bleeds | 2.5 bleed fully modulating: open for start, deceleration and reverse, closed at take-off and cruise; stage 7 and 10 valves two-position, spring-loaded open | A |
| Vibration | displayed 0-10 units, 1 unit = 0.3 in/s | A |
| Reverser | two translating sleeves, four actuators (lower pair locking), ten blocker doors, ten rods, cascades round the nacelle | A |

Two things worth knowing:

- The well-known 26,600 lbf (V2527) and 33,000 lbf (V2533) figures are marketing / bump ratings, not
  the certified ratings, and are not used. The manufacturer's product card also quotes pressure
  ratios of 32.8 and 35.2, which are higher than ICAO's sea-level take-off values (27.2 and 33.44)
  and presumably refer to a different flight condition; the model is matched to ICAO.
- The data sheet states that EGT (T4.9) is measured "aft of LPT stage 1". IAE training material
  places the thermocouples in the turbine exhaust case, at LPT exit, with the P4.9 probes. The model
  uses LPT exit, because gas after the first LPT stage would be far hotter than the 610-670 °C limits.

Assumed (not published): fan and LPC pressure-ratio split, component efficiencies, cooling flows,
mixing-plane Mach number, spool inertias, volumes, all schedule break-points.

## How it compares (`npm test` asserts these; `node tools/icao.js` prints them)

| Quantity | Model | Published |
|---|---|---|
| V2527-A5 take-off fuel flow at 111.2 kN | 1.063 kg/s | 1.053 |
| V2527-A5 climb-out (85 %) fuel flow | 0.883 kg/s | 0.880 |
| V2527-A5 approach (30 %) fuel flow | 0.304 kg/s | 0.319 |
| V2527-A5 idle (7 %) fuel flow | 0.128 kg/s | 0.128 |
| V2527-A5 overall pressure ratio | 27.3 | 27.2 |
| V2527-A5 bypass ratio | 4.79 | 4.82 |
| All five ratings at take-off: fuel flow / pressure ratio / bypass ratio | within 1.3 % / 1.0 % / 0.8 % | ICAO databank |
| V2527-A5 take-off EPR | 1.63 | about 1.6 (crew report) |
| Ground idle | N1 20.9 %, N2 58.5 %, 387 kg/h, EGT 423 °C | N1 21.7 (+3.8/-2), N2 60 (±2), 300-378 kg/h, EGT 400 (+90/-25) |
| V2527-A5 take-off EGT, ISA / ISA+30 | 515 / 591 °C | limit 635 °C |
| Cruise TSFC, FL350 M0.78 | 0.572 lb/lbf/h | about 0.54-0.58 (unverified) |
| Idle to 95 % take-off thrust | about 6.4 s | certification requires <= 5 s from flight idle |
| Start to idle / peak start EGT | 43 s / 515 °C | limit 635 °C; time not checked against a published figure |

The approach point is the weakest (4.8 % low). Ground-idle fuel flow is slightly above the quoted
range. Fan speed at 1.05 EPR is about 36 %; crews stabilise at 1.05 EPR where CFM crews use 50 % N1,
which suggests the real figure may be somewhat higher.

## Remaining limitations

- **Compressor and turbine maps are not IAE's.** They are proprietary and were not found in any
  public source. The maps are NASA's public JT9D reference maps, scaled and adapted as listed under
  "Component maps". Between and beyond the published points (exact surge margins, the speeds at
  which each bleed valve must be open, sub-idle behaviour) the model is plausible, not measured.
- **FADEC rating tables are not IAE's.** Take-off is flat rated to the published corner temperature and
  max-continuous / climb use the published thrusts, but the real altitude-Mach-temperature EPR tables
  and the bleed / stator schedule break-points are proprietary; the ones here are tuned to this model.
- Start time (about 43 s to idle, 30 s of it motoring before fuel) and peak start EGT are not checked against a published figure.
- No Reynolds-number effects, active clearance control, fuel system components, humidity or icing; one lumped heat-soak mass.
- Ambient changes are a test-cell step, not a flight model.
