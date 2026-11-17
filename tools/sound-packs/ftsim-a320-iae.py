"""Builds app/sounds/sounds.json for the FTSiM+ A320 IAE pack (Wwise media named by hex id).
Reference N1 of each fan loop comes from its blade-passing tone (22 blades) and buzz-saw comb;
track maps from the tonal lines in the start and spool-down recordings. See docs/SOUND.md."""
import json, sys, os, numpy as np
from scipy.io import wavfile
SND, AN = sys.argv[1], sys.argv[2]
A = {r['f'][:8]: r for r in json.load(open(AN))}
db = lambda f: A[f]['rms']
norm = lambda f, target=-18.0, cap=6.0: round(min(cap, 10 ** ((target - db(f)) / 20)), 3)

def seamless(f, fade=0.35):
    """Equal-power crossfade of the loop's tail into its head, so it wraps without a click."""
    sr, x = wavfile.read(os.path.join(SND, f + '.wav')); x = x.astype(np.float64)
    F = int(fade * sr); t = np.linspace(0, np.pi / 2, F)
    fi, fo = np.sin(t), np.cos(t)
    if x.ndim > 1: fi, fo = fi[:, None], fo[:, None]
    y = x[F:].copy(); y[-F:] = x[-F:] * fo + x[:F] * fi
    out = f + '_loop.wav'; wavfile.write(os.path.join(SND, out), sr, np.clip(y, -32768, 32767).astype(np.int16)); return out

def tri(prev, ref, nxt, law):
    pts = []
    if prev is None: pts += [[max(ref * 0.45, 6), 0], [ref, 1]]
    else: pts += [[prev, 0], [ref, 1]]
    if nxt is None: pts += [[112, 1]]
    else: pts += [[nxt, 0]]
    return [[round(x, 2), round(v * law(x), 3)] for x, v in pts]

fan_law = lambda n1: 0.22 + 0.78 * max(0, min(1.15, (n1 - 20) / 80)) ** 1.25
jet_law = lambda n1: 0.12 + 0.88 * max(0, min(1.15, (n1 - 20) / 80)) ** 1.9

layers = []
FAN = [(19.2, '06DBCE06'), (27.9, '05F145FA'), (38.7, '2D4C8702'), (48.6, '35F197A5'), (61.5, '075484A4'), (83.0, '2DBE8ED8'), (91.3, '3728855A'), (100.4, '134809F0')]
for i, (ref, f) in enumerate(FAN):
    prev = FAN[i - 1][0] if i else None; nxt = FAN[i + 1][0] if i + 1 < len(FAN) else None
    layers.append({'file': f + '.wav', 'driver': 'n1', 'pos': 'front', 'note': f'fan / intake, blade-passing tone at {ref} % N1',
                   'gain': norm(f, cap=8.0), 'pitch': [[round(ref * 0.3, 2), 0.3], [round(ref * 1.9, 2), 1.9]], 'volume': tri(prev, ref, nxt, fan_law)})
layers.append({'file': '0C8D3E12.wav', 'driver': 'n1', 'pos': 'front', 'note': 'buzz-saw: shaft-order comb at 83.5 % N1 (supersonic fan tips)',
               'gain': round(norm('0C8D3E12') * 0.7, 3), 'pitch': [[25, 0.3], [160, 1.92]], 'volume': [[72, 0], [86, 0.85], [100, 1.0], [112, 1.0]]})
JET = [(22, '2435D10F'), (50, '1A517884'), (70, '3C0D3384'), (85, '33BCAAAF'), (100, '1B943656')]
for i, (ref, f) in enumerate(JET):
    prev = JET[i - 1][0] if i else None; nxt = JET[i + 1][0] if i + 1 < len(JET) else None
    fn = seamless(f) if f == '2435D10F' else f + '.wav'
    layers.append({'file': fn, 'driver': 'n1', 'pos': 'rear', 'when': 'lit', 'note': f'jet / exhaust roar, broadband, set at {ref} % N1',
                   'gain': norm(f), 'pitch': [[ref * 0.5, 0.75], [ref * 1.5, 1.25]], 'volume': tri(prev, ref, nxt, jet_law)})
layers.append({'file': '390F2A05.wav', 'driver': 'fuel', 'when': 'lit', 'note': 'combustion rumble, follows fuel flow',
               'gain': round(norm('390F2A05') * 0.55, 3), 'pitch': [[300, 0.92], [5000, 1.12]], 'volume': [[0, 0], [250, 0.45], [1500, 0.75], [5000, 1.0]]})
# whole start and spool-down recordings, kept in step with N2 (track layers)
layers.append({'file': '0229841B.wav', 'driver': 'n2', 'when': 'start', 'until': 60, 'note': 'complete outside start: motoring, light-off, spool-up',
               'gain': 0.75, 'track': [[0, 0.5], [5, 6], [15, 14], [25, 22], [28.5, 26], [29.8, 29.5], [33, 32], [46, 52], [56, 61], [60, 64]],
               'volume': [[0, 1], [53, 1], [60, 0]]})
layers.append({'file': '11998CFB.wav', 'driver': 'n2', 'when': 'shutdown', 'note': 'outside spool-down after the fuel is shut off',
               'gain': 0.6, 'track': [[0, 34], [5, 32], [12, 29], [24, 24], [38, 16], [50, 8], [58, 0.6], [70, 0]], 'volume': [[0, 1], [70, 1]]})
manifest = {
    'name': 'FTSiM+ A320 IAE sound pack', 'synth': 'events', 'mute': ['lightoff'],
    'comment': 'Outside-view recordings only. Mapping built by analysing the files: see docs/SOUND.md.',
    'layers': layers,
    'shots': {'surge': {'file': '2D43C434.wav', 'gain': 1.1}},
}
json.dump(manifest, open(os.path.join(SND, 'sounds.json'), 'w'), indent=1)
print(len(layers), 'layers;', ', '.join(l['file'] for l in layers))
