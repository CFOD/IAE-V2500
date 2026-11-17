# Sound

The game plays **real recordings** when it finds them in `app/sounds/`, and falls back to a built-in
synthesiser when it does not. There is no openly licensed set of V2500 recordings. This private
repository carries the owner's own copy of the FTSiM+ A320 IAE pack (only the files `sounds.json`
uses, listed in `.gitignore`; anything else in `app/sounds/` stays local). Do not make the repository
public, or release a build containing these recordings, without the right to distribute them.

When recordings load, **Panel > Monitor > Log** shows a line such as
`Sound: playing recordings (Flight simulator sound pack: 6 loops, 3 events)` and lists any files it
could not find.

## In the browser version

`npm run build:web` copies the recordings `sounds.json` uses into the site (the owner's test site at
iae.cfod.co.uk). A build made with `npm run build:web:nosound` has none: choose **Sound >
Load recordings from a folder** and pick a `sounds` folder (with `sounds.json` or `sound.cfg` and the
audio files). The browser reads them from your disk; nothing is uploaded. The desktop app reads
`app/sounds/` automatically.

## Easiest route: drop in a flight-simulator sound pack

Sound packs for Flight Simulator X / Prepar3D are folders of `.wav` files with a `sound.cfg` that
says how each recording follows engine speed. The game reads that file directly.

1. Get a V2500 sound pack for FSX or P3D. There are freeware ones (search the AVSIM library for
   "A320 IAE V2500") and commercial ones (for example Turbine Sound Studios). Check the pack's
   licence: these are for your own use.
2. Find the pack's `sound` folder: the one containing `sound.cfg` and the `.wav` files.
3. Copy **the contents** of that folder into `app/sounds/` inside the game folder, so that
   `app/sounds/sound.cfg` exists.
4. Start the game. Sound is on by default; click once in the window if you hear nothing.

What is used from the pack: the outside-view engine loops (combustion, jet whine, non-combustion)
and the starter, light-off and shutdown clips for engine 1. Cockpit-view recordings are skipped.
Surge bangs, igniter ticks and reverser sounds are not part of these packs and stay synthesised.

The importer was written from the documented layout of these files and tested with a made-up pack,
not with a real commercial one. If a pack sounds wrong (silent layers, wrong pitch), the Log line
and the pack's `sound.cfg` are what is needed to fix it.

## Microsoft Flight Simulator (2020 / 2024) packs

These are different: the audio is inside one compiled Wwise package (`.pck`) and the folder has a
`sound.xml` instead of a `sound.cfg`. They cannot be dropped in directly yet.

The first step is the inspector. Drag the `.pck` file onto **`Inspect sound pack.bat`** in the game
folder. It reads the package on your PC, changes nothing, uploads nothing, and writes
`sound-report.txt` next to the package: what is inside, the audio format, and how the clips link to
the engine sound events. That report is what is needed to write the converter for the pack.

## Your own recordings: `sounds.json`

If you have individual recordings, describe them in `app/sounds/sounds.json`. It takes priority over
`sound.cfg`.

```json
{
  "name": "My V2500 recordings",
  "synth": "events",
  "layers": [
    { "file": "idle_loop.wav",   "driver": "n2", "when": "lit", "pos": "rear",
      "pitch":  [[50, 0.85], [60, 1.0], [100, 1.45]],
      "volume": [[40, 0.0], [58, 0.8], [75, 0.5], [90, 0.0]] },
    { "file": "high_power.wav",  "driver": "n1", "when": "lit", "pos": "rear",
      "pitch":  [[60, 0.8], [88, 1.0], [100, 1.1]],
      "volume": [[55, 0.0], [80, 0.8], [100, 1.0]] },
    { "file": "buzzsaw.wav",     "driver": "n1", "pos": "front",
      "pitch":  [[70, 0.85], [90, 1.0], [100, 1.08]],
      "volume": [[72, 0.0], [85, 0.7], [100, 1.0]] }
  ],
  "shots": {
    "starter":  { "file": "start_sequence.wav", "gain": 1.0 },
    "lightoff": { "file": "lightoff.wav" },
    "shutdown": { "file": "spool_down.wav" },
    "surge":    { "file": "bang.wav" },
    "igniter":  { "file": "tick.wav" },
    "reverser": { "file": "reverser_clunk.wav" }
  }
}
```

- **layers** are loops. `driver` is what the curves are plotted against: `n1` or `n2` (percent),
  `thrust` (kN), `epr`, or `fuel` (kg/h). `pitch` is playback speed; `volume` is 0 to 1.
  Record or pick a loop at a known engine speed and give it pitch 1.0 at that speed.
- **when**: `lit` (only with flame), `unlit`, `starter` (start valve open), `reverse`, or omitted.
- **pos**: `front` (louder from in front of the intake), `rear` (louder from behind), or omitted.
- **shots** are played once when the event happens.
- **synth**: `events` keeps only the synthesised one-shots that have no recording (default),
  `mix` keeps the synthesiser running quietly underneath, `off` silences it.
- Formats: `.wav`, `.ogg`, `.mp3`. Loops should start and end cleanly or they will click.

A good minimum set: a start sequence, an idle loop, a mid-power loop, a take-off loop and a
spool-down. That is what flight-simulator packs contain.

### Track layers: a whole start or spool-down

A layer with `"track"` plays one long recording (a complete start, a complete spool-down) and keeps
it in step with the engine instead of looping it:

```json
{ "file": "start.wav", "driver": "n2", "when": "start", "until": 60,
  "track": [[0, 0.5], [15, 14], [30, 27], [46, 52], [60, 64]],
  "volume": [[0, 1], [53, 1], [60, 0]] }
```

`track` pairs an engine speed with a time in the file. The play head follows the engine: it runs up to
25 % faster or 40 % slower to keep up and, when it drifts more than two or three seconds (the engine
holding speed while motoring, or spooling down faster than the recording), crossfades to the right
place. `when` is `start` (from the starter engaging until `until` % N2) or `shutdown` (from the
flame going out at speed until the engine stops). While a track plays, the other loops step back
under it, so a start hands over to the running loops at idle without doubling up. `"duck": false`
on a loop keeps it at full level. `"mute": ["lightoff"]` silences synthesised events the recordings
already contain.

### Microsoft Flight Simulator packs extracted to .wav (FTSiM+ A320 IAE)

`tools/sound-packs/ftsim-a320-iae.sounds.json` maps the FTSiM+ A320 IAE pack once its Wwise media are
extracted as .wav files (they are named by hex id, such as `0229841B.wav`). Copy all the .wav files
into `app/sounds/`, then copy that file there as `sounds.json`, with `2435D10F_loop.wav` (the idle roar
re-cut so it loops without a click; `tools/sound-packs/ftsim-a320-iae.py` makes it and the json).
How the files were identified, since the pack's sound.xml names events but not files:

- **Fan loops**: the V2500 fan has 22 blades, so each loop's blade-passing tone gives the N1 it was
  recorded at (22 x N1 rpm / 60, 2072 Hz at 100 %); buzz-saw loops show the whole comb of shaft orders.
  Loops at 19.2, 27.9, 38.7, 48.6, 61.5, 83, 91.3 and 100.4 % N1 crossfade, each pitched by N1 / its own N1.
- **Jet roar**: bright broadband loops without tones, ordered by spectral centroid (jet noise moves up
  in frequency as jet velocity rises), behind the engine.
- **Start and spool-down**: the tonal lines in the 76 s start and 35 s spool-down recordings give N2
  against time for the track maps.
- Cockpit versions (heavily low-passed), cockpit chimes and switch clicks are not used.

## The synthesiser

With no recordings present the game synthesises every sound from the simulation: fan blade-pass
tone (22 x N1), buzz-saw above about 70 % N1, jet roar from jet velocity, combustion rumble, HP spool
drone and whine, the start howl, starter, igniters, light-off, surge and reverser. It follows the
physics faithfully but it is a synthesiser and does not sound like a recording.
