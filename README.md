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

Useful keys: **F11** full screen, **Space** pause, **M** master switch, **C** cutaway, **O** open cowls, **H** hide or show the HUD, up/down arrows
move the thrust lever (down at idle lifts it into reverse).

### In a web browser

The game is plain web code, so it also runs in a browser (Chrome or Edge recommended; Firefox works).
`npm run serve` and open <http://localhost:5173>, or put it on a website: `npm run build:web` writes
`dist-web/`, a static site you can upload to any web host (Cloudflare Pages, Netlify, your own server).
This repository is private and carries the owner's sound recordings, so the build includes them; the
site is the owner's test site at iae.cfod.co.uk (see docs/WEB.md) and is marked noindex.
On a phone or tablet: drag with one finger to orbit, pinch to zoom, drag with two fingers to pan, tap a
part to inspect it (tap empty space to close the card). Sideways works best. **Full screen** in the top
bar hides the browser (and turns a phone sideways where it can), and Chrome's **Add to Home screen**
gives an icon that opens full screen. Phones start on Low quality; the top bar scrolls sideways.
`npm run build:web:nosound` leaves the recordings out (players can then load their own with **Sound >
Load recordings from a folder**, read on their computer and not uploaded).

### Android app

`npm run android:debug` builds an APK (`android/app/build/outputs/apk/debug/app-debug.apk`) that installs
on a phone by opening the file. It is the same page inside the app, works offline and runs landscape and
full screen. Building needs Java 21 and the Android SDK. See docs/ANDROID.md, including what a Google Play
release needs (the store build leaves the sound pack out).

### Sound

Out of the box the engine sound is synthesised. For real recordings, drop a flight-simulator V2500
sound pack (or your own recordings) into `app/sounds/`: see [docs/SOUND.md](docs/SOUND.md).

### First five minutes

1. Set **Eng mode** to **Ign / Start**, then flip **Master** on (bottom left). Watch the engine start itself:
   30 seconds of motoring, then fuel and one igniter, light-off, starter cut-out, idle. Set the mode back to Norm.
2. Drag the **Thrust lever** to TOGA and watch the gauges, the flame and the exhaust.
3. Drag on the engine to orbit it. Click a part to read about it. Try **Remove part** on the fan cowl doors.
4. Open **Panel > Control**, switch **Fuel flow** to Manual and push it up quickly. That is a compressor surge.
5. **Reset > Running at idle** (top right) puts everything back.

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
  **Cowls** (or `O`) opens the fan cowl doors and then the thrust reverser C-ducts on their hinges, the way
  a mechanic does (the C-ducts stay shut while the reverser is deployed).
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
- **The start panel works like the A320's**, following the Airbus training manual:
  - **Eng mode Ign / Start, then Master on**: automatic start. The EEC opens the start valve, motors
    the engine for 30 s, then opens the fuel with one igniter (it alternates A and B between starts)
    and closes the start valve at 43 % N2. Below 50 % N2 it aborts the start for a start valve that
    will not open, no light-up within 15 s, EGT over 635 °C, a stall or a hung start: fuel and ignition
    off, 30 s of dry motoring, then the ECAM asks for **Master off**, which also clears the fault.
  - **Man start, then Master on** (mode Ign / Start): manual start. Both igniters, fuel at once, and no
    automatic abort. If it goes wrong the ECAM tells you, but stopping it is up to you.
  - **Eng mode Crank + Man start**: dry crank, ignition inhibited. Switch **Master** on above 20 % N2
    for a wet crank (fuel, no ignition). Afterwards, with Master off, the EEC closes the start valve and
    reopens it below 10 % N2 for a 60 s dry crank to blow the fuel out.
  - Selecting **Ign / Start** with the engine running gives continuous ignition on both igniters.
  - The starter is limited to about 4 minutes of running before it needs 30 minutes to cool; past that
    the ECAM warns, and much further it fails. **APU bleed** is its air supply.
- **Thrust lever** (drag, or up/down arrows) with CL, FLX/MCT and TOGA detents. Below idle it lifts
  into reverse: the reverser deploys (it needs the engine turning for hydraulic pressure), the sleeve
  slides back, the cascades are uncovered and the blocker doors close the bypass duct. Thrust stays at
  idle until it is fully out, then the lever commands fan speed, up to 80 % N1 at max reverse.
- **Panel → Control**: every FADEC output has an Auto/Manual switch: fuel flow, igniters,
  starter valve, variable stator vanes, LPC 2.5 bleed, HPC stage 7 and 10 bleeds, HP and LP turbine
  clearance control. Plus starter air pressure, customer bleed and power off-take.
- **Clearance control** sprays fan air on the turbine cases in climb and cruise (set an altitude under
  Ambient to see it come on): about 1 % less fuel and 15 °C less EGT. Hold it open by hand through a
  slam to take-off power on the ground and the turbine blade tips rub.
- **Component cards carry their own controls.** Click the fuel nozzles to set fuel flow, the HPC case
  for the stator vanes and bleed valves, the gearbox for the starter, a turbine for its efficiency,
  and so on.
- **FADEC protections** (bottom of Panel > Control) can each be switched off: EGT, N1 and N2 limiters,
  acceleration and deceleration schedules, surge recovery, hot-start abort. There is also an EPR /
  rated-N1 thrust mode switch.
- **Faults** tab: whole-engine faults (bird strike, contaminated fuel, jammed stators, start valve
  faults, failed igniters, oil system failures, flame-out and more) and 68 part failures, one fold per
  system with a search box: fan, booster, compressor and turbine blades letting go, LP and HP shaft
  failures, bearings breaking up, combustor and case burn-through, fuel pump, metering valve and
  distribution valve failures, tower shaft, starter, IDG, hydraulic pump, EEC channels, EGT signal,
  uncommanded reverser, cowl doors left unlatched, engine separation, and every pipe, duct and harness
  broken on its own. Each part's card lists its own failures. See docs/FAILURES.md.
- **Ambient**: altitude, ISA deviation, Mach number, humidity. **Hardware**: component efficiencies,
  flow capacities, nozzle areas, cooling air, fuel heating value.
- **Monitor**: compressor maps with live operating point and surge line, trends, station table,
  event log.

### Starting by hand (Master stays off)

This goes further than the aircraft allows: you play the engine computer yourself.

1. Set **Eng mode** to Crank (or Ign / Start), switch **Man start** on and let the starter spin the core for 30 seconds (the real procedure: it clears fuel vapour and straightens a hot rotor).
2. **Panel → Control**: set **Igniters** to Manual and ON, set **Fuel flow** to Manual at about 200 kg/h.
   The engine lights within a few seconds.
3. Ease the fuel up towards 390 kg/h over about 30 seconds, watching EGT. Too fast and it runs hot.
   The starter drops out by itself at 43 % N2.
4. At about 58 % N2 it is idling on your fuel. Switch Man start off and Igniters back to Auto.
5. To hand over to the computer, switch **Master** on, then set Fuel flow back to Auto.

Switching Master off always shuts the fuel, manual or not. **Reset > Cold and dark** switches everything off.

Things to try: introducing fuel too early for a
hot start, slamming manual fuel at idle (HPC surge), opening the stators at low speed, closing the 2.5
bleed during a decel, starving the starter of air, a hot-and-high take-off, fouling the HPC.
### Breaking it

The engine fails the way a real one would (details in [docs/PHYSICS.md](docs/PHYSICS.md)):

- **Overheat the turbine** and the blades creep, let go and finally melt: sparks and smoke from the tailpipe, vibration, no thrust.
- **Overspeed it** with the protections off (Panel → Control) and a rotor bursts. That engine is finished.
- **Fuel a stalled compressor** and the combustor burns through: engine fire. Shut the fuel off, then press **Agent**.
- **Cut the fuel at take-off power** and the casings shrink onto the hot rotors (tip rub). Let it idle three minutes first.
- **Restart it by hand ten minutes after a hot shut-down without the 30-second crank** and the bowed rotor rubs. The automatic start cranks for 30 seconds first, like the real one.

- **Lose the oil** (Panel → Faults: leak, pump failure, seal failure) and the pressure goes, metal shows on the chip detector, and a main bearing seizes. Shut down when OIL LO PR comes on and it survives.
- **Break a part**: release a fan blade, shear the LP shaft at take-off power, cut the metered fuel line on a hot engine (fire: MASTER OFF, then Agent), break the oil pressure sense line (a false OIL LO PR on a healthy engine), seize the starter clutch. Broken parts pulse red; leaks spray from the broken line.

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
app/          renderer: scene3d.js (three.js 3D engine), fx.js (smoke, fire, sprays, debris),
              cutaway.js (2D section), gauges, UI, audio.js (synthesiser) and samples.js (recording player)
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
