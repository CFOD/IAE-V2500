# Where the project stands (18 November 2026)

Work since the switch is on branch `ccr-b314d629-a56f7k-opus` (the original branch is untouched).
The test website at iae.cfod.co.uk deploys from this branch automatically (see docs/WEB.md).

## Done recently
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
  a live readout and its controls and faults (docs/MODEL.md).
- Phones: touch controls and phone layout on the website; an Android app (Capacitor) that packs the
  same page for offline use, sideloaded as a debug APK for now (docs/ANDROID.md).

## Open
- Physics: design airflow 385 kg/s against the manual's 396 for the V2533; approach fuel flow 4.8 %
  low. Re-tuning needs every map rescaled and all ICAO points re-matched.
- Some core units (ignition exciters, valves on the core) are still simple boxes in the model.
- Sound mapping was judged from spectrograms and an offline mix, not by ear: adjust layers in
  app/sounds/sounds.json (via tools/sound-packs/ftsim-a320-iae.py) if any sound wrong.
- Google Play release: needs a developer account, an upload key, a closed test (12 testers, 14
  days for a new personal account), a privacy policy and listing, and sound we may redistribute.
- Ideas raised: ECAM-style display pages, a flight profile (altitude and Mach changing over time).

## Not in the repository
- The other 84 files of the sound pack (unused by the mapping) are only on the owner's PC.
- The Airbus training manual PDFs and the SR Technics booklet (training material, not committed).
