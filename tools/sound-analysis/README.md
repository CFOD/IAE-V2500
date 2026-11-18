# Sound pack analysis

Tools used to work out what each file in an extracted Wwise sound pack is (the files are named by hex
id and the pack's sound.xml names events, not files), and to hear the result without the app.
Needs Python with numpy, scipy and matplotlib. Run them with the pack folder as an argument.

| Script | What it does |
|---|---|
| `analyse.py <wav dir> <out.json>` | length, loudness envelope, spectral centroid, tones and loop seam of every file |
| `sheets.py <wav dir> <out dir> <analysis.json>` | spectrogram contact sheets, 15 files per image |
| `big.py <wav dir> <out.png> <file>...` | large spectrograms (tonal lines show engine speed against time) |
| `bpf.py <wav dir> <analysis.json>` | each loop's N1 from its fan blade-passing tone (22 blades: 22 x N1 rpm / 60) |
| `comb.py <wav dir> <file>...` | tests N1 hypotheses against the whole comb of shaft orders (buzz-saw) |
| `node trace.mjs [trace.json]` | runs the sim through start, take-off, idle and fuel off, logging N1, N2, flame, starter, fuel |
| `mix.py <sounds dir> <trace.json> <out.wav> [front 0..1]` | mixes `sounds.json` against that run the way `app/samples.js` does, in seconds |

`tools/sound-packs/ftsim-a320-iae.py` builds the `sounds.json` for the FTSiM+ A320 IAE pack from the
analysis; the reasoning is in `docs/SOUND.md`.
