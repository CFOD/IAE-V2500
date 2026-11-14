# V2500 Engine Simulator

A physics-based simulator of the IAE V2500-A5 turbofan (the Airbus A320-family engine) with a live,
interactive 3D cutaway. Start it, run it, and then take the controls away from the engine computer and find out
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

**The engine (3D view)**
- Drag to orbit, scroll to zoom, right-drag (or shift-drag) to pan. Camera presets in the top bar.
- **Cutaway** (or `C`) removes a wedge of every casing, museum-style, with painted section faces;
  **Explode** pulls the modules apart along the axis. **Quality** steps down shadows and ambient
  occlusion for slower graphics cards.
- The model is generated in code. An authored glTF model can replace any component: see
  [docs/MODEL.md](docs/MODEL.md).
- Click any component to inspect it: what it does and its live numbers. **Remove part** lifts it off
  so you can see what is behind it; removed parts are listed for refitting. Removal is for
  inspection only and does not change the simulation.
- What you see is driven by the model: intake and exhaust particles move with the mass flows and are
  coloured by gas temperature; fuel sprays from the 20 nozzles in proportion to fuel flow; the flame
  scales with fuel/air ratio; turbine parts glow according to gas temperature; the exhaust plume
  grows with thrust; unburnt fuel torches from the tailpipe; a surge throws flame out of the intake.
- **Intake fog and ground vortex** come from real conditions. The inlet Mach number is computed from
  the airflow, giving the static temperature and pressure drop of the air accelerating into the fan;
  fog appears when that falls below the dew point (set relative humidity under Ambient, or try the
  Humid morning preset at take-off power). The ground vortex appears when the engine is stationary
  and inlet velocity is high.
- **Section** switches to the flat 2D cutaway with station temperatures and pressures.

**The controls**
- **Master** on: the FADEC runs an automatic start (starter air valve, ignition at 16 % N2, fuel at
  22 %, starter cut-out at 43 %), reaching ground idle in roughly half a minute.
- **Thrust lever** (drag, or up/down arrows) with climb, max-continuous and TOGA detents.
- **Panel → Control**: every FADEC output has an Auto/Manual switch: fuel flow, igniters,
  starter valve, variable stator vanes, LPC 2.5 bleed, HPC stage 7 and 10 bleeds. Plus starter air
  pressure, customer bleed and power off-take.
- **Ambient**: altitude, ISA deviation, Mach number, humidity. **Hardware**: component efficiencies,
  flow capacities, nozzle areas, cooling air, fuel heating value.
- **Monitor**: compressor maps with live operating point and surge line, trends, station table,
  event log.

Things to try: a manual start (Crank + manual fuel and igniters), introducing fuel too early for a
hot start, slamming manual fuel at idle (HPC surge), opening the stators at low speed, closing the 2.5
bleed during a decel, starving the starter of air, a hot-and-high take-off, fouling the HPC.
Running above the EGT red line permanently costs HPT efficiency.

## Layout

```
src/sim/      physics, no UI dependencies (runs under plain Node)
  gas.js        air / combustion-product properties, ISA atmosphere
  components.js compressor & turbine maps, nozzles
  engine.js     engine sizing + two-spool dynamic model
  fadec.js      engine control: start sequence, EPR governor, limiters, schedules
  v2500.js      published V2500-A5 data and model assumptions
app/          renderer: scene3d.js (three.js 3D engine), cutaway.js (2D section), gauges, audio, UI
  vendor/       three.js and add-ons (MIT)    fonts/  Inter, B612 Mono (SIL OFL)
  assets/       optional authored model (docs/MODEL.md)
electron/     desktop window
tests/        physics tests        tools/calibrate.js  prints steady-state tables
docs/PHYSICS.md  how the model works, what it is validated against, known limits
```

## Accuracy

See [docs/PHYSICS.md](docs/PHYSICS.md) for the model, the source of every number and the comparison
table. In short: the V2527-A5's ICAO fuel flows at take-off, climb, approach and idle, its pressure
ratio, bypass ratio and idle speeds are reproduced within a few percent and asserted by `npm test`.
What cannot be made exact is IAE's proprietary compressor/turbine maps and FADEC tables, so surge
margins and schedule break-points are representative. Not for training or engineering use. Not
affiliated with or endorsed by International Aero Engines.
