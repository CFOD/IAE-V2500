"""Builds app/sounds/sounds.json for the FTSiM+ A320 IAE pack (Wwise media named by hex id).
Reference N1 of each fan loop comes from its blade-passing tone (22 blades) and buzz-saw comb;
start and spool-down loops cut from the long recordings at N2 read from their tonal lines. See docs/SOUND.md."""
import json, sys, os, math, numpy as np
from scipy.io import wavfile
from scipy.signal import stft, istft
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

def ramp(a, b, up):
    """Equal-power crossfade from a to b (sine shape): two different recordings crossfaded linearly drop
    3 dB at the crossover; with sine / cosine gains their powers always add up to the same total."""
    fs = [0, 0.25, 0.5, 0.75, 1]
    return [[a + (b - a) * f, math.sin(math.pi / 2 * (f if up else 1 - f))] for f in fs]

def tri(prev, ref, nxt, law):
    pts = ramp(max(ref * 0.45, 6) if prev is None else prev, ref, True)
    pts += [[112, 1]] if nxt is None else ramp(ref, nxt, False)[1:]
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
# ---- start and spool-down: short loops cut from the two long recordings at known N2, crossfaded by N2.
# (Following one long recording by N2 jumped and dipped whenever the sim spooled faster than the recording.)
START_MAP = [[0, 0.5], [5, 6], [15, 14], [25, 22], [28.5, 26], [29.8, 29.5], [33, 32], [46, 52], [56, 61], [60, 64]]   # N2 %, seconds
SHUT_MAP = [[0, 34], [5, 32], [12, 29], [24, 24], [38, 16], [50, 8], [58, 0.6], [70, 0]]
def band_db(y, sr, hop=0.1, edges=(20, 150, 600, 2500, 9000)):
    """Level (dB) of each band in hop-second frames: the swells and ramps the ear hears as a 'wave' when looped."""
    f, _, Z = stft(y.mean(1), sr, nperseg=4096, noverlap=4096 - int(hop * sr))
    P = np.abs(Z) ** 2
    return np.array([10 * np.log10(P[(f >= a) & (f < b)].sum(0) + 1e-12) for a, b in zip(edges[:-1], edges[1:])])

def flatten(y, sr, smooth=0.4, lim=12.0, n=8192):
    """Hold every third-octave band at its average level through the cut. Levelling the whole signal at once
    is steered by the loud hiss above 2.5 kHz and left the body of the sound swelling by up to 11 dB inside a
    loop, heard as a wave once per repeat. Changes slower than `smooth` seconds are removed; faster texture stays.
    (n = 8192: shorter frames are too coarse below 150 Hz and leave a third of a bass ramp in.)"""
    hop = n // 8
    f, _, Z = stft(y.T, sr, nperseg=n, noverlap=n - hop)          # Z: channels x bins x frames
    P = (np.abs(Z) ** 2).mean(0)
    edges = np.concatenate([[0], 40 * 2 ** (np.arange(0, 30) / 3)]); edges = edges[edges < sr / 2]
    k = max(1, int(smooth * sr / hop)); G = np.ones_like(P)
    for a, b in zip(edges, np.append(edges[1:], sr)):
        m = (f >= a) & (f < b)
        if not m.any(): continue
        e = P[m].sum(0); ep = np.pad(e, k, mode='reflect')
        s = np.convolve(ep, np.ones(k) / k, mode='same')[k:-k] + 1e-12
        G[m] = np.clip(np.sqrt(e.mean() / s), 10 ** (-lim / 20), 10 ** (lim / 20))
    _, out = istft(Z * G[None], sr, nperseg=n, noverlap=n - hop)
    return out.T[:len(y)]

def seg(src, out, n2map, n2ref, half=2.4, fade=0.6, tmin=0.05, reach=1.6, span=1.35, hmin=0.8):
    """Loop of the recording around N2 = n2ref.
    - The steadiest stretch within `reach` s of where the recording passes n2ref is used (no light-off thump
      or valve step inside a loop), up to 2 x `half` s long.
    - The stretch covers at most a `span` ratio of N2 (fastest / slowest), so the warp below never moves the
      sound's spectrum by more than about 15 %: a wider cut carried its bass out of band and dipped 9 dB.
    - Time-warped so its pitch holds at n2ref (the sim then pitches it by N2 / n2ref).
    - Each band levelled through the cut (flatten), ends crossfaded over `fade` s (less on short cuts).
    Returns (file, rms dBFS of the cut before levelling)."""
    sr, x = wavfile.read(os.path.join(SND, src)); x = x.astype(np.float64) / 32768
    if x.ndim == 1: x = x[:, None]
    ns, ts = [p[0] for p in n2map], [p[1] for p in n2map]
    order = np.argsort(ts); t_of = lambda n: float(np.interp(n, ns, ts)); n_of = lambda t: float(np.interp(t, np.array(ts)[order], np.array(ns)[order]))
    dur = len(x) / sr; tc = t_of(n2ref); B = band_db(x, sr); hop = 0.1
    best = None
    ratio = lambda a, b: max(n_of(a), n_of(b)) / max(min(n_of(a), n_of(b)), 0.3)
    for c in np.arange(tc - reach, tc + reach + 1e-9, 0.1):
        h = half
        while h > hmin and ratio(c - h, c + h) > span: h -= 0.05
        a, b = c - h, c + h
        if a < tmin or b > dur - 0.05: continue
        seg_db = B[:, int(a / hop):int(b / hop)]; tt = np.arange(seg_db.shape[1])
        rough = np.mean([np.std(r - np.polyval(np.polyfit(tt, r, 1), tt)) for r in seg_db])   # bumps, not slopes
        score = rough + 0.4 * abs(n_of(c) - n2ref) + 0.6 * (half - h)                          # prefer long cuts
        if best is None or score < best[0]: best = (score, a, b)
    if best is None: a, b = max(tmin, tc - half), min(dur - 0.05, tc + half)
    else: _, a, b = best
    print(f'{out}: {src} {a:.1f}-{b:.1f} s (N2 {n_of(a):.1f}-{n_of(b):.1f}), roughness {best[0] if best else -1:.2f}')
    pos = []; t = a
    while t < b:                                       # play faster where N2 was lower, slower where higher
        pos.append(t); t += max(0.3, min(3.0, n2ref / max(n_of(t), 0.5))) / sr
    pos = np.array(pos) * sr; j = pos.astype(int); fr = (pos - j)[:, None]
    y = x[j] * (1 - fr) + x[np.minimum(j + 1, len(x) - 1)] * fr
    rms0 = float(np.sqrt(np.mean(y ** 2)) + 1e-9)
    y = flatten(y, sr)
    F = int(min(fade, 0.25 * len(y) / sr) * sr); w = np.linspace(0, np.pi / 2, F)[:, None]
    z = y[F:].copy(); z[-F:] = y[-F:] * np.cos(w) + y[:F] * np.sin(w)
    z = z / max(1.0, np.abs(z).max() / 0.98)
    wavfile.write(os.path.join(SND, out), sr, (z * 32767).astype(np.int16))
    return out, 20 * np.log10(rms0)
def n2set(group, src, n2map, refs, when, lo, hi, gain, note, tmin=0.05):
    # Lengths differ a little from loop to loop so the two loops sounding together never repeat in step.
    made = [seg(src, f'{group}_{int(round(r)):02d}.wav', n2map, r, half=(1.5 if r < 12 else 2.2) + 0.17 * (i % 3), tmin=tmin)
            for i, r in enumerate(refs)]
    top = max(d for _, d in made)
    for i, (r, (f, d)) in enumerate(zip(refs, made)):
        prev = refs[i - 1] if i else lo; nxt = refs[i + 1] if i + 1 < len(refs) else None
        vol = ramp(prev, r, True) + (ramp(r, nxt, False)[1:] if nxt is not None else [[hi[0], 1]] + ramp(hi[0], hi[1], False)[1:])
        vol = [[round(x, 2), round(v, 3)] for x, v in vol]
        layers.append({'file': f, 'driver': 'n2', 'when': when, 'note': f'{note} at {r} % N2',
                       'gain': round(gain * 10 ** ((d - top) / 20), 3), 'pitch': [[r * 0.3, 0.3], [r * 2.0, 2.0]], 'volume': vol})
n2set('start', '0229841B.wav', START_MAP, [4, 9, 15, 21, 26, 29.5], 'starter', 0.5, (34, 40), 0.75, 'starter motoring the core (start recording)', tmin=3.7)   # starter valve opens at 3.5 s
n2set('light', '0229841B.wav', START_MAP, [34, 40, 46, 52, 56], 'lit', 28, (56.5, 57.5), 0.75, 'light-off and spool-up to idle (start recording)')
n2set('coast', '11998CFB.wav', SHUT_MAP, [6, 12, 20, 30, 40, 48, 56], 'coast', 0.8, (120, 121), 0.6, 'spool-down with the fuel off (spool-down recording)', tmin=0.6)   # click at 0 s
manifest = {
    'name': 'FTSiM+ A320 IAE sound pack', 'synth': 'events',
    'comment': 'Outside-view recordings only. Mapping built by analysing the files: see docs/SOUND.md.',
    'layers': layers,
    'shots': {'surge': {'file': '2D43C434.wav', 'gain': 1.1}},
}
json.dump(manifest, open(os.path.join(SND, 'sounds.json'), 'w'), indent=1)
print(len(layers), 'layers;', ', '.join(l['file'] for l in layers))
