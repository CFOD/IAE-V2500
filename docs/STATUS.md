# Where the project stands (19 November 2026)

Work since the switch is on branch `ccr-b314d629-a56f7k-opus` (the original branch is untouched).
The test website at iae.cfod.co.uk deploys from this branch automatically (see docs/WEB.md).

## Done recently
- Damage you can see, and a borescope (docs/BORESCOPE.md): ingested objects leave dented, nicked, bent or
  torn blades on the fan, booster and HP compressor; a streaking fuel nozzle burns the HP turbine guide
  vanes behind it; overheated turbine blades take on straw, bronze and blue heat tints. The Inspect tab puts
  a probe through the real inspection ports, with its own light, automatic gain and a fisheye lens. Turn the
  spool a blade at a time, read what is in view, or press Look on a damage record to go straight to it.
- The rest of the engine modelled in Blender: spinner, hinged core cowl, common nozzle, bleed valves,
  case ribs and borescope ports, exhaust case instruments, tubes, combustor liners and cascades.
- The engine on the apron (docs/APRON.md): an A320 modelled in Blender around it on a painted stand, with
  daylight. Intake suction with a ground vortex, a jet calibrated to the Airbus exhaust velocity contours,
  and birds, a traffic cone, rag, bag, bolt, stone and suitcase to drop near it. What goes in damages the
  engine by the energy of the fan's blow. Danger areas are drawn from the model next to the Airbus ones.
- Detail tiers: High and Ultra draw the full blade templates (cooling holes, squealer tips) with shadows;
  Medium and Low draw lighter ones.
- Engine internals modelled in Blender (docs/MODEL.md, Engine internals): 22-blade fan with fillers and
  retaining ring, booster, intermediate case, HP compressor with variable vanes, levers and unison rings,
  discs with rims, webs, bores and knife-edge seals, panelled combustor liners with drilled holes, swirlers,
  20 injectors and the igniters, cooled HP turbine with squealer tips and seals, shrouded LP turbine with
  honeycomb lands and bolted discs, exhaust case, shafts and all five bearings with rollers, balls and cages.
  Rows are instanced from templates; hidden internals are not drawn; the web model downloads gzipped.
- A320 start panel and start faults from the Airbus training manual (ENG MODE, MAN START, aborts,
  dry / wet crank, starter limits); thrust lever into reverse with the hydraulic and C-duct lockouts.
- Active clearance control: physics, FADEC schedule, controls, a fault; spray rings on the model.
- Model: starter, anti-ice and bleed ducts with V-band joints, bellows and valves; casing bosses;
  blocker doors and box accessories turned the right way round the engine.
- Surface detail follows the quality setting; top bar and pedestal fit narrow windows.
- Sound: the owner's FTSiM+ A320 IAE pack mapped to the engine (fan loops placed by blade-passing
  tone, jet roar, rumble, a start and a spool-down that follow N2); tools in tools/sound-analysis.
- Browser version (`npm run build:web`) with the recordings, versioned so new deploys always load.
- Gearbox accessories modelled and made separate parts: starter, starter air valve, IDG, hydraulic
  pump, fuel pump, fuel metering unit, oil pump and filter, dedicated alternator, oil tank; each card has
  a live readout and its controls and faults (docs/MODEL.md), sized to fit inside the real cowl.
- Nacelle matched to the Airbus A320 planning document: 5.25 m long, egg-shaped section (2.01 m wide,
  deeper underneath), longer inlet and common nozzle, longer exhaust plug; drooped inlet (face tilted 6 deg, 1.50 m highlight).
- Core units modelled as parts: ignition exciters and their leads, VSV actuator and crank shaft, fuel
  distribution valve, clearance-control valves, buffer air cooler, EGT junction box; engine mounts.
- Core services run down a lower fan-frame strut from a bulkhead panel, instead of fanning across the
  bypass duct from one point.
- Colours fixed: authored materials were one gamma step too light (near-white cases and tubes).
- Part failures (docs/FAILURES.md): 68 of them, from a released fan blade or a sheared shaft to a jammed
  metering valve, a broken pipe or a burnt harness, each acting through the physics; listed on every part's
  card and in a searchable Faults tab, with red-pulsing broken parts, missing blades, debris, leak sprays,
  fires where the leak is, engine shake, cowl doors torn off and engine separation. 21 pipes, ducts and
  harnesses are parts of their own. An ENG 1 FIRE pushbutton shuts the LP fuel valve.
- Smoke and fire redone (app/fx.js): lit, noise-textured smoke sorted back to front and glowing from below
  over a fire; flames as tongues stretched along their motion and coloured by temperature, with embers; a
  fireball on a surge; spray as streaks, real tumbling metal fragments; leaks behind closed cowls drip from
  the nacelle drains.
- Physics re-tuned to the manual's airflow (872 lb/s for the V2533): every ICAO fuel-flow point now
  within 1.8 % (approach was 4.8 % low); tests hold the airflow and the tighter approach match.
- Smoke and fire meet the engine without hard edges (soft particles); an HP shaft failure no longer
  keeps a flame alight at 8 % N2.
- Layout for every screen size: desktop, compact (tablets, foldables, small laptops: under 1100 x 700) and
  phone. On compact screens the panel slides over the view and stops above the dock, the dock spans the
  width, camera presets sit top right, and the part card shows only for a picked part or removed parts. The
  dock controls wrap instead of overflowing; the section view fits between the top bar and the dock and
  stacks its station labels on narrow screens.
- Phones: touch controls and phone layout on the website; an Android app (Capacitor) that packs the
  same page for offline use, sideloaded as a debug APK for now (docs/ANDROID.md).

## Open
- Sound mapping was judged from spectrograms and an offline mix, not by ear: adjust layers in
  app/sounds/sounds.json (via tools/sound-packs/ftsim-a320-iae.py) if any sound wrong.
- Google Play release: needs a developer account, an upload key, a closed test (12 testers, 14
  days for a new personal account), a privacy policy and listing, and sound we may redistribute.
- Ideas raised: ECAM-style display pages, a flight profile (altitude and Mach changing over time).

## Not in the repository
- The other 84 files of the sound pack (unused by the mapping) are only on the owner's PC.
- The Airbus training manual PDFs and the SR Technics booklet (training material, not committed).
