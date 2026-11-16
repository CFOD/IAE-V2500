# V2500 Engine Simulator

A physics-based simulator of the IAE V2500-A5 turbofan (the Airbus A320-family engine) with a live,
interactive 3D cutaway. Start it, run it, and then take the controls away from the engine computer and find out
what the fuel schedules, variable stators and bleed valves are actually protecting you from.

Desktop app (Electron) for Windows / macOS / Linux, intended for Steam.

## How to run it

You need a Windows, Mac or Linux computer with a reasonably modern graphics card. No programming
knowledge needed.

### Windows

1. **Install Node.js** (the free program that runs the game). Go to <https://nodejs.org>, download
   the version marked **LTS**, run the installer and click Next until it finishes. You only do this once.
2. **Download the game.** On this GitHub page click the green **Code** button, then **Download ZIP**.
3. **Unzip it.** Right-click the downloaded ZIP, choose **Extract All**, and pick somewhere easy to
   find, such as your Desktop.
4. **Open the extracted folder and double-click `Start V2500.bat`.**
   - The first time, a black window appears and downloads what the game needs. This takes a few
     minutes and about 500 MB of disk space. Leave it alone until the game window opens.
   - If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. It shows
     this for any file it has not seen before.
5. From then on, just double-click `Start V2500.bat` whenever you want to play.

To get a newer version later: download the ZIP again, extract it over the old folder (or to a new
one) and run `Start V2500.bat` again.

### Mac or Linux

1. Install Node.js LTS from <https://nodejs.org>.
2. Download and unzip the game as above (green **Code** button, **Download ZIP**).
3. Open a terminal in the unzipped folder and run `./start.sh`.

### If it does not start

| What you see | What to do |
|---|---|
| "Node.js is not installed" | Do step 1, then close and reopen the folder and try again. |
| Setup fails part-way | Check your internet connection and run the start file again. It picks up where it stopped. |
| The engine view is black, flickers, flashes or is very slow | Click **Quality** in the top bar until it says **Low**, which turns every visual effect off. Then please report it with the graphics card name shown under **Panel > Monitor > Log**. Updating your graphics driver may also help. |
| Anything else | Press **F12** in the game window, click the **Console** tab, and copy the red text into a GitHub issue or back to whoever is helping you. |

Useful keys: **F11** full screen, **Space** pause, **M** master switch, **C** cutaway, up/down arrows
move the thrust lever.

### Sound

Out of the box the engine sound is synthesised. For real recordings, drop a flight-simulator V2500
sound pack (or your own recordings) into `app/sounds/`: see [docs/SOUND.md](docs/SOUND.md).

### First five minutes

1. Flip **Master** on (bottom left). Watch the engine start itself: starter, ignition, light-off, idle.
2. Drag the **Thrust lever** to TOGA and watch the gauges, the flame and the exhaust.
3. Drag on the engine to orbit it. Click a part to read about it. Try **Remove part** on the fan cowl doors.
4. Open **Panel > Control**, switch **Fuel flow** to Manual and push it up quickly. That is a compressor surge.
5. **Reset at idle** (top right) puts everything back.

### For developers

```
npm install        # once
npm start          # launch the desktop app
npm test           # physics regression tests
npm run serve      # same UI in a browser at http://localhost:5173, without Electron
npm run model      # rebuild the authored 3D model (needs Python and `pip install bpy`)
npm run dist       # build an unpacked distributable in dist/ (electron-builder)
```

## Playing

**The engine (3D view)**
- Drag to orbit, scroll to zoom, right-drag (or shift-drag) to pan. Camera presets in the top bar.
- **Cutaway** (or `C`) removes a wedge of every casing, museum-style, with painted section faces;
  **Explode** pulls the modules apart along the axis. **Quality** cycles Medium (default: shadows, bloom,
  heat haze), High (adds ambient occlusion), Ultra (adds supersampling) and Low (no effects).
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
- **Reverse** deploys the thrust reverser: the sleeve slides back, the cascades are uncovered and the
  blocker doors close the bypass duct. In reverse the thrust lever commands fan speed, up to 80 % N1.
- **Panel → Control**: every FADEC output has an Auto/Manual switch: fuel flow, igniters,
  starter valve, variable stator vanes, LPC 2.5 bleed, HPC stage 7 and 10 bleeds. Plus starter air
  pressure, customer bleed and power off-take.
- **Component cards carry their own controls.** Click the fuel nozzles to set fuel flow, the HPC case
  for the stator vanes and bleed valves, the gearbox for the starter, a turbine for its efficiency,
  and so on.
- **FADEC protections** (bottom of Panel > Control) can each be switched off: EGT, N1 and N2 limiters,
  acceleration and deceleration schedules, surge recovery, hot-start abort. There is also an EPR /
  rated-N1 thrust mode switch.
- **Faults** tab: bird strike, debris through the core, turbine burn-through, contaminated fuel,
  jammed stators, stuck bleed and start valves, loss of EPR sensing, flame-out.
- **Ambient**: altitude, ISA deviation, Mach number, humidity. **Hardware**: component efficiencies,
  flow capacities, nozzle areas, cooling air, fuel heating value.
- **Monitor**: compressor maps with live operating point and surge line, trends, station table,
  event log.

### Starting by hand (Master stays off)

1. Switch **Crank** on. The starter spins the core; wait for N2 to pass about 20 %.
2. **Panel → Control**: set **Igniters** to Manual and ON, set **Fuel flow** to Manual at about 200 kg/h.
   The engine lights within a few seconds.
3. Ease the fuel up towards 390 kg/h over about 30 seconds, watching EGT. Too fast and it runs hot.
   The starter drops out by itself at 43 % N2.
4. At about 58 % N2 it is idling on your fuel. Switch Crank off and Igniters back to Auto.
5. To hand over to the computer, switch **Master** on, then set Fuel flow back to Auto.

Switching Master off always shuts the fuel, manual or not. **Reset cold** switches everything off.

Things to try: introducing fuel too early for a
hot start, slamming manual fuel at idle (HPC surge), opening the stators at low speed, closing the 2.5
bleed during a decel, starving the starter of air, a hot-and-high take-off, fouling the HPC.
### Breaking it

The engine fails the way a real one would (details in [docs/PHYSICS.md](docs/PHYSICS.md)):

- **Overheat the turbine** and the blades creep, let go and finally melt: sparks and smoke from the tailpipe, vibration, no thrust.
- **Overspeed it** with the protections off (Panel → Control) and a rotor bursts. That engine is finished.
- **Fuel a stalled compressor** and the combustor burns through: engine fire. Shut the fuel off, then press **Agent**.
- **Cut the fuel at take-off power** and the casings shrink onto the hot rotors (tip rub). Let it idle three minutes first.
- **Restart it ten minutes after a hot shut-down** and the bowed rotor rubs. Crank it dry for a minute first.

Reset repairs everything.

## Layout

```
src/sim/      physics, no UI dependencies (runs under plain Node)
  gas.js        air / combustion-product properties, ISA atmosphere
  components.js compressor & turbine maps, nozzles
  maps/jt9d.js  NASA T-MATS reference maps (Apache 2.0), scaled to the V2500 in engine.js
  engine.js     engine sizing + two-spool dynamic model
  fadec.js      engine control: start sequence, EPR governor, limiters, schedules
  v2500.js      published V2500-A5 data and model assumptions
app/          renderer: scene3d.js (three.js 3D engine), cutaway.js (2D section), gauges, UI,
              audio.js (synthesiser) and samples.js (recording player)
  sounds/       optional recordings (docs/SOUND.md)
  vendor/       three.js and add-ons (MIT)    fonts/  Inter, B612 Mono (SIL OFL)
  assets/       optional authored model (docs/MODEL.md)
electron/     desktop window
tests/        physics tests        tools/icao.js  compares the model with the ICAO databank
              tools/retune.py  re-derives the FADEC tables after a map change
docs/PHYSICS.md  how the model works, what it is validated against, known limits
```

## Accuracy

See [docs/PHYSICS.md](docs/PHYSICS.md) for the model, the source of every number and the comparison
table. In short: the V2527-A5's ICAO fuel flows at take-off, climb, approach and idle, its pressure
ratio, bypass ratio and idle speeds are reproduced within a few percent and asserted by `npm test`.
The compressor and turbine maps are NASA's public JT9D reference maps (T-MATS, Apache 2.0) scaled
to this engine. What cannot be made exact is IAE's proprietary maps and FADEC tables, so surge
margins and schedule break-points are representative. Not for training or engineering use. Not
affiliated with or endorsed by International Aero Engines.
