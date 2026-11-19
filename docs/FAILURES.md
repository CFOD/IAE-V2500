# Part failures

Every part of the engine can be broken: a fan blade let go, a shaft sheared, a valve jammed, a pipe cut,
a harness burnt through. There are 68 part failures as well as the whole-engine faults (bird strike,
contaminated fuel and so on).

- **Panel > Faults** lists them all, one fold per system, with a search box ("oil", "starter", "blade").
  Click a failure's name to show its part on the engine.
- **Every part's card** (click the part on the engine) lists the failures of that part with a button for
  each. The 21 pipes, ducts and harnesses split out of the model (`line_*` parts) each have a card and a
  "broken" failure.
- **Inject / Clear** for lasting failures. Clearing means the part has been repaired or replaced.
  **Trigger** for momentary ones (a blade letting go); press again for another. Momentary damage stays
  until **Repair all**, **Restore new-engine condition** (Hardware tab) or **Reset**.
- A broken part pulses red. Released blades disappear from their row, debris flies, leaking fuel, oil,
  hydraulic fluid (purple) and air spray from the broken line, a fire burns where the leak is, heavy
  vibration shakes the engine, torn-off cowl doors fly away, and a separated engine drops to the floor.

## How it works (`src/sim/failures.js`)

Only the failure itself is scripted. It acts where the real one would:

- **On what the engine receives** (`Failures.filter`, every step): the fuel that actually reaches the
  nozzles (LP valve and line volume, pump, metering valve, distribution valve, a broken line spilling it
  elsewhere), stator and bleed valve positions, starter air, air leaking out of the core (taken like
  customer bleed), the gearbox load, a reverser frozen without hydraulics or unlocked without a command.
- **On the hardware**: efficiency and flow lost with released blades, rubbing drag and vibration, a free
  turbine after a shaft failure (its own speed and inertia; its disc bursts above about 123 % LP or
  121 % HP, which the damage model already handles).
- **Through the other models**: oil leaks, lost coolers, extra heat and seal leakage in `oil.js`; the HP
  bearing through the oil system's bearing model; a hot streak in `damage.js`'s creep; igniters, the EGT
  signal and the reverser in `fadec.js`; ECAM messages added to the FADEC's.

What follows comes out of the same physics as everything else: a worn pump hangs the start and the EEC
aborts it, a cracked fan blade grows only at high fan speed, an LP shaft failure bursts the free turbine
at take-off power but not at idle (where the FADEC then chases the falling EPR), stators failed open stall
the start, a lost EGT signal leaves nothing to stop a hot start, false high EGT makes the limiter pull
thrust back on a healthy engine.

### Fire

Fuel or oil reaching the core compartment lights about 1.5 s later if the casings are hot (turbine metal
above about 250 °C or compressor delivery above 230 °C), which includes a recently stopped engine. A turbine
case burn-through burns for as long as there is flame. The fire keeps burning while it is fed: MASTER OFF
shuts the HP and LP fuel valves, the **ENG 1 FIRE** pushbutton on the pedestal shuts the LP valve, and oil
stops when the engine stops. **Agent** then puts it out; fired while the source is still flowing, the fire
lights again a few seconds later. Left burning for 25 s it burns through one core harness (EEC channel lost),
at 45 s the other, and the engine has no control.

### Numbers

The mechanisms are real; rates, thresholds and leak sizes are engineering estimates, not IAE data. ECAM
wording follows the A320 style. Some behaviours belong to this model rather than to documented V2500 logic:
with both EEC channels lost the metering valve goes to a minimum stop, the stators shut and the bleeds
open; the generator takes about two thirds of the gearbox load and the hydraulic pump most of the rest.

## The catalogue

### Fan and LP spool

| Failure | Where | What happens |
|---|---|---|
| Fan blade release (momentary) | `fan`, `fancase` | A blade breaks off at the root. The fan case contains it, but the rotor is badly out of balance and pieces go down the core: vibration off the scale, thrust down, and the fan and compressors may surge. Each press releases another blade. |
| Cracked fan blade root | `fan` | A fatigue crack in a blade root grows with every minute at high fan speed. Vibration creeps up; at take-off power the blade lets go within about a minute. At idle it hardly grows. Clear it to fit a new blade. |
| Spinner fairing lost (momentary) | `spinner` | The nose fairing breaks up and goes through the fan: a little fan damage and some vibration. |
| LP shaft failure (momentary) | `lpshaft`, `lpt` | The shaft between the LP turbine and the fan breaks. The fan, no longer driven, runs down; the LP turbine, with nothing to drive, races. At high power it reaches burst speed in a fraction of a second. At idle it settles at a runaway speed below that, until the FADEC adds fuel to chase the falling EPR. |
| Fan bearing breaking up (No. 1) | `bearings`, `lpshaft` | Rolling elements spalling: N1 vibration and drag rise and metal shows on the chip detector. After about a minute at high power, several at idle, the bearing seizes and the fan stops dead. |

### Compressors, combustor and turbines

| Failure | Where | What happens |
|---|---|---|
| Booster blade release (momentary) | `lpc` | A blade fails in the LP compressor. The debris dents the stages behind it: booster efficiency and flow fall, N1 vibrates, and the core may surge. |
| HP compressor blade release (momentary) | `hpc` | A blade fails in the front stages and dents the stages behind it: flow and efficiency fall, the compressor surges and fragments reach the turbine. EGT climbs as the FADEC pushes for thrust. A second one wrecks the compressor. |
| HP shaft failure (momentary) | `hpshaft`, `hpt` | The shaft between the HP turbine and compressor breaks. The compressor runs down and surges, the flame goes out for lack of air, and the HP turbine races. At high power it reaches burst speed before the gas pressure falls away. |
| HP turbine blade release (momentary) | `hpt` | One HP turbine blade fails (as creep would eventually do). Its pieces go through the LP turbine: efficiency drops, EGT jumps and the core vibrates. |
| LP turbine blade release (momentary) | `lpt` | An LP turbine blade fails: LP efficiency drops, N1 vibration rises, EGT climbs. |
| HP thrust bearing breaking up (No. 3) | `bearings`, `hpshaft` | The HP thrust bearing starts to fail: N2 vibration and drag rise, metal on the chip detector, then it seizes and wrecks the core. |
| Combustor burn-through (momentary) | `liner`, `combcase` | A hole burns through the liner and the case, and flame plays on the core compartment: ENGINE FIRE until the fuel is off and the agent is fired. |
| Diffuser case crack | `combcase` | Compressor delivery air (over 500 °C at take-off) escapes into the core compartment: about 4 % of the core flow lost, so EGT and fuel flow rise for the same thrust. |
| Turbine case burn-through (momentary) | `hptcase`, `lptcase` | Hot gas cuts through the turbine case like a torch: turbine efficiency falls and the core compartment is on fire for as long as the engine runs. |
| Streaking fuel nozzle | `fuel`, `hptcase` | A coked nozzle sprays a narrow jet instead of a cone. The hot streak burns the guide vanes and blades behind it: at take-off power HP turbine creep life goes in minutes instead of thousands of hours, then blades let go. |
| Fuel manifold leak | `fuel` | A cracked pigtail sprays fuel on the combustor case. On a hot engine it lights: ENGINE FIRE. MASTER OFF stops the fuel; then fire the agent. |

### Fuel system

| Failure | Where | What happens |
|---|---|---|
| Fuel pump drive shaft sheared | `fuelpump` | The pump stops: no fuel pressure, flame-out within a second, and no relight. |
| HP fuel pump worn | `fuelpump` | Worn gears deliver too little at low speed: the start hangs below idle. Once the engine is running fast there is enough. |
| Metering valve jammed | `fmu` | Fuel flow freezes where it is: the thrust lever does nothing. MASTER OFF still stops the fuel through a separate shut-off valve. |
| Metering valve hunting | `fmu` | The torque motor oscillates: fuel flow swings about 18 % either way every two seconds and both spools hunt. |
| HP shut-off valve stuck open | `fmu` | MASTER OFF cannot shut the valve at the engine. The engine still stops, because MASTER OFF also shuts the LP valve in the pylon, but only once the fuel in the pipes between them has burnt: it runs on for several seconds. |
| Distribution valve stuck shut | `fdv` | No fuel reaches the nozzles: flame-out, or no light-off on a start. |
| Half the distribution outlets blocked | `fdv` | Only ten of the twenty nozzles flow: the engine cannot take more than about 2,000 kg/h, so thrust is capped, and the uneven flame makes hot streaks. |

### Oil system

| Failure | Where | What happens |
|---|---|---|
| Oil tank punctured | `oiltank` | About 10 quarts a minute overboard: the tank empties in a few minutes, the pump draws air, pressure collapses and the bearings start to go. |
| Buffer air cooler blocked | `acac` | Hot compressor air reaches the No. 4 bearing seals: oil temperature climbs, oil cokes in the chamber and is drawn past the seals into the gas path (smoke in the exhaust). |

### Air: stators, bleeds and ducts

| Failure | Where | What happens |
|---|---|---|
| VSV actuator failed open | `vsvact`, `hpccase` | The stators go fully open at all speeds. The front stages stall at low speed: the start hangs or surges. |
| VSV actuator failed shut | `vsvact`, `hpccase` | The stators go fully shut. The compressor cannot swallow the air at high speed: thrust is capped and EGT rises. |
| 2.5 bleed stuck open | `lpccase` | Booster air keeps dumping into the bypass duct: less thrust for the fuel burnt, hotter at take-off. |
| Stage 7 bleed valves stuck open | `hpccase` | All three handling bleeds stay open at high power: compressor air thrown away, EGT up, thrust down. |
| Stage 7 bleed valves stuck shut | `hpccase` | The handling bleeds cannot open at low speed, where the front stages need them: the compressor surges on starts and decelerations. |
| Stage 10 bleed valve stuck open | `hpccase` | The start bleed stays open: a steady loss of HP air, EGT up. |
| Nacelle anti-ice valve stuck open | `lip`, `line_antiice` | Hot HP air heats the inlet lip all the time: about 1 % of the core flow lost. |

### Starting and ignition

| Failure | Where | What happens |
|---|---|---|
| Starter output shaft sheared | `starter` | The starter spins on its air but nothing turns the engine: N2 stays at zero while the EEC waits for motoring speed. |
| Starter clutch seized | `starter` | The clutch cannot overrun, so once running the engine drives the starter at many times its design speed. Within about 20 s at idle it disintegrates; fragments hole the gearbox and oil pours out. |

### Gearbox and accessories

| Failure | Where | What happens |
|---|---|---|
| Tower shaft sheared | `agb` | The drive from the HP spool to the gearbox breaks. Everything on it stops at once: fuel pump (flame-out), oil pump, generator, hydraulic pump and the EEC's alternator. The starter cannot turn the engine either. |
| IDG failure | `idg` | The drive generator overheats and is disconnected: its load comes off the HP spool, and it stays off until reset on the ground. |
| Hydraulic pump failure | `hydpump` | No green system pressure from this engine: its load comes off the HP spool and the thrust reverser can no longer move. |
| Dedicated alternator failure | `pma` | The EEC switches to aircraft 28 V power and carries on: nothing changes for the engine. It would matter only if aircraft power went too. |

### Control and indication

| Failure | Where | What happens |
|---|---|---|
| EEC channel A failure | `eec` | Channel B takes control without a bump. Fail B as well and the engine has no control at all. |
| EEC channel B failure | `eec` | Channel A takes control. With both channels lost the metering valve goes to its minimum stop, the stators shut and the bleeds open: the engine runs down. |
| EGT signal lost | `egtbox`, `tec` | The junction box fails open: EGT shows XX, and the EEC loses its EGT limiting and hot-start protection. |
| Thermocouples reading 150 °C high | `tec`, `egtbox` | A false high reading that the EEC believes: it trims start fuel to keep the reading under the start limit, so starts drag or hang, and its take-off limiter pulls thrust back on a healthy engine. |

### Nacelle and mounts

| Failure | Where | What happens |
|---|---|---|
| Reverser deploys uncommanded | `cna` | The C-duct sleeves unlock and slide aft with the lever forward. The EEC detects it and drops the engine to idle. |
| Fan cowl doors left unlatched | `fancowl` | Harmless at rest. At high fan speed, or above about Mach 0.15, the airflow lifts the doors and tears them off. |
| Inlet liner panel ingested (momentary) | `inlet` | An acoustic panel comes off the inlet barrel and goes through the fan: bent blades, vibration, a surge. |
| Aft mount link broken | `mounts` | The fail-safe link takes the load and the engine stays on, but the mount passes on more vibration. |
| Engine separation (momentary) | `mounts`, `pylon` | Both mounts let go and the engine falls off the pylon. Every pipe and harness to the aircraft is torn out, and fuel pours from the pylon until the LP valve is shut. |

### Pipes, ducts and harnesses

| Failure | Where | What happens |
|---|---|---|
| P3 servo air lines broken | `line_p3servo` | The handling bleed valves need P3 air to close. Without it their springs open them all: EGT rises and thrust falls. |
| Air-cooled oil cooler lines broken | `line_acocoil` | Oil pours out at about 6 quarts a minute, and the air cooler is out of the circuit. |
| Nacelle anti-ice duct broken | `line_antiice` | Hot HP air blows into the fan compartment: about 2 % of the core flow lost, EGT up. |
| Starter air duct broken | `line_starterduct` | The air blows into the nacelle instead of the starter: no motoring, no start. |
| Hydraulic lines broken | `line_hyd` | Green system fluid lost from this engine's pump: no pressure, and the thrust reverser cannot move. |
| Fuel supply lines broken | `line_fuelsupply` | Fuel from the pylon sprays into the fan compartment and the pump starves: flame-out in a couple of seconds. The fan compartment is cool, so it does not light. MASTER OFF shuts the LP valve. |
| Fuel-cooled oil cooler lines broken | `line_fcoc` | All the engine's fuel passes through these: it sprays out, the pump starves and the engine flames out. The oil loses its fuel cooling. |
| Oil pressure sense line broken | `line_oilpress` | A small oil leak, and the transmitter reads zero: OIL LO PR on a healthy engine. Quantity, temperature and vibration tell the real story. |
| IDG oil cooler lines broken | `line_idgcooler` | The drive generator loses its oil. About 30 s later it overheats and is disconnected. |
| Servo fuel lines broken | `line_servofuel` | High-pressure fuel sprays on the hot core: ENGINE FIRE. The stator actuator freezes and the clearance control valves shut. |
| Metered fuel line broken | `line_meteredfuel` | All the metered fuel sprays into the core compartment instead of the nozzles: flame-out, and a big fire on a hot engine. |
| No. 4 bearing oil lines broken | `line_no4oil` | Oil sprays on the diffuser case (smoke, then fire on a hot engine) and the No. 4 bearing is starved: it starts to break up. |
| Core harness, channel A broken | `line_harnessA` | EEC channel A loses its core sensors and actuators and hands over to channel B. |
| Core harness, channel B broken | `line_harnessB` | EEC channel B loses its core sensors and actuators and hands over to channel A. |
| Ignition lead A broken | `line_htleadA` | Igniter A gets no spark. Automatic starts alternate igniters, so every other start finds no light. |
| Ignition lead B broken | `line_htleadB` | Igniter B gets no spark: every other automatic start finds no light. |
| EGT harness broken | `line_egtharness` | EGT signal lost: XX on the ECAM, and the EEC has no EGT limiting or hot-start protection. |
| IP bleed duct (stage 7) broken | `line_bleed7` | Bleed air for the aircraft escapes into the core compartment: AIR ENG 1 BLEED LEAK, about 3 % of the core flow lost. |
| HP bleed duct (stage 10) broken | `line_bleed10` | Hotter, higher-pressure air escapes than from the IP duct: about 4.5 % of the core flow lost. |
| Clearance control ducts broken | `line_accduct` | Fan air dumps into the core compartment instead of cooling the turbine cases: cruise fuel burn rises, bypass air is lost. |
| Buffer air duct broken | `line_bufferair` | The No. 4 bearing seals lose their buffer air: oil is drawn past them into the gas path (smoke) and consumed. |
