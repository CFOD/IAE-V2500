# V2500 Engine Simulator

A physics-based simulator of the IAE V2500-A5 turbofan (the Airbus A320-family engine) with a live
2D cutaway. Start it, run it, and then take the controls away from the engine computer and find out
what the fuel schedules, variable stators and bleed valves are actually protecting you from.

Desktop app (Electron) for Windows / macOS / Linux, intended for Steam.

## Run

```
npm install
npm start          # launches the desktop app
npm test           # physics regression tests
npm run dist       # build an unpacked distributable in dist/ (electron-builder)
```

`npm run serve` serves the same UI on http://localhost:5173 for quick development without Electron.

## Playing

- **ENG MASTER ON** – the FADEC runs an automatic start: starter air valve, ignition at 16 % N2,
  fuel at 22 %, starter cut-out at 43 %, stabilised ground idle about a minute later.
- **Thrust lever** (slider or ↑/↓) commands EPR between idle and the selected rating's take-off limit.
- **ENGINEERING tab** – every FADEC output has an AUTO/MAN switch: fuel flow, igniters, starter valve,
  variable stator vanes, LPC 2.5 bleed, HPC stage 7 and 10 bleeds. Plus starter air pressure,
  customer bleed and power off-take.
- **AMBIENT** – altitude, ISA deviation, Mach number.
- **HARDWARE** – component efficiencies, flow capacities, nozzle areas, cooling air, fuel heating value.
- **MAPS** – live fan / LPC / HPC compressor maps with operating point and surge line.
- **TRENDS / DATA / LOG** – strip charts, full station table (T, P, W), event log.

Things to try: a manual start (MAN START + manual fuel and igniters), introducing fuel too early for a
hot start, slamming manual fuel at idle (HPC surge), opening the stators at low speed, closing the 2.5
bleed during a decel, starving the starter of air (hung start), a hot-and-high take-off, fouling the HPC.
Running above the EGT red line permanently costs HPT efficiency.

## Layout

```
src/sim/      physics, no UI dependencies (runs under plain Node)
  gas.js        air / combustion-product properties, ISA atmosphere
  components.js compressor & turbine maps, nozzles
  engine.js     engine sizing + two-spool dynamic model
  fadec.js      engine control: start sequence, EPR governor, limiters, schedules
  v2500.js      published V2500-A5 data and model assumptions
app/          renderer: cutaway, gauges, panels, audio (swap cutaway.js for a 3D view later)
electron/     desktop window
tests/        physics tests        tools/calibrate.js  prints steady-state tables
docs/PHYSICS.md  how the model works, what it is validated against, known limits
```

## Accuracy, honestly

See [docs/PHYSICS.md](docs/PHYSICS.md). The thermodynamics are real; the component maps are generic
shapes scaled to the published V2500 cycle because IAE's actual maps are proprietary. Not for
training or engineering use. Not affiliated with or endorsed by International Aero Engines.
