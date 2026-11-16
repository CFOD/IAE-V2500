# Sound

The game plays **real recordings** when it finds them in `app/sounds/`, and falls back to a built-in
synthesiser when it does not. No recordings ship with the project: there is no openly licensed set
of V2500 recordings, so you supply your own. Everything in `app/sounds/` is ignored by git and stays
on your machine. Do not publish or release a build containing audio you do not have the right to
distribute.

When recordings load, **Panel > Monitor > Log** shows a line such as
`Sound: playing recordings (Flight simulator sound pack: 6 loops, 3 events)` and lists any files it
could not find.

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

## The synthesiser

With no recordings present the game synthesises every sound from the simulation: fan blade-pass
tone (22 x N1), buzz-saw above about 70 % N1, jet roar from jet velocity, combustion rumble, HP spool
drone and whine, the start howl, starter, igniters, light-off, surge and reverser. It follows the
physics faithfully but it is a synthesiser and does not sound like a recording.
