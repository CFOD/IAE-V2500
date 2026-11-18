import sys, os, json, numpy as np
from scipy.io import wavfile
from scipy.signal import find_peaks
D = sys.argv[1]; out = []
for f in sorted(os.listdir(D)):
    if not f.lower().endswith('.wav'): continue
    sr, x = wavfile.read(os.path.join(D, f))
    x = x.astype(np.float32) / 32768.0
    if x.ndim > 1: x = x.mean(axis=1)
    n = len(x); dur = n / sr
    rms = float(np.sqrt(np.mean(x ** 2)) + 1e-9)
    # loudness envelope in 12 windows
    W = 12; seg = np.array_split(x, W)
    env = [20 * np.log10(np.sqrt(np.mean(s ** 2)) + 1e-9) for s in seg]
    # spectrum per third
    def spec(y):
        if len(y) < 4096: y = np.pad(y, (0, 4096 - len(y)))
        L = 8192; hop = max(L, len(y) // 40)
        frames = [y[i:i + L] * np.hanning(L) for i in range(0, len(y) - L + 1, hop)] or [np.pad(y, (0, max(0, L - len(y))))[:L] * np.hanning(L)]
        P = np.mean([np.abs(np.fft.rfft(fr)) ** 2 for fr in frames], axis=0)
        fq = np.fft.rfftfreq(L, 1 / sr)
        return fq, P
    def centroid(fq, P): return float(np.sum(fq * P) / (np.sum(P) + 1e-20))
    thirds = np.array_split(x, 3)
    cents = []
    for t in thirds:
        fq, P = spec(t); cents.append(centroid(fq, P))
    fq, P = spec(x)
    low = float(np.sum(P[fq < 200]) / np.sum(P)); hi = float(np.sum(P[fq > 4000]) / np.sum(P))
    # tonal peaks: prominence over smoothed spectrum, 150 Hz - 12 kHz
    dB = 10 * np.log10(P + 1e-20); k = 31
    sm = np.convolve(dB, np.ones(k) / k, mode='same')
    band = (fq > 150) & (fq < 12000)
    idx, pr = find_peaks(np.where(band, dB - sm, -99), prominence=6)
    order = np.argsort(-(dB - sm)[idx])[:4]
    tones = [(round(float(fq[idx[i]])), round(float((dB - sm)[idx[i]]), 1)) for i in order]
    # loop seam: compare RMS & spectrum of the first and last 0.25 s
    a, b = x[: int(0.25 * sr)], x[-int(0.25 * sr):]
    seam = float(abs(20 * np.log10((np.sqrt(np.mean(a ** 2)) + 1e-9) / (np.sqrt(np.mean(b ** 2)) + 1e-9))))
    jump = float(abs(x[0] - x[-1]))
    out.append(dict(f=f, dur=round(dur, 2), sr=sr, rms=round(20 * np.log10(rms), 1), env=[round(e, 1) for e in env],
                    cent=[round(c) for c in cents], low=round(low, 3), hi=round(hi, 3), tones=tones, seam=round(seam, 1), jump=round(jump, 3),
                    peak=round(float(np.max(np.abs(x))), 3)))
json.dump(out, open(sys.argv[2], 'w'), indent=0, default=float)
for r in sorted(out, key=lambda r: r['dur']):
    e = r['env']; shape = 'rise' if e[-1] - e[0] > 6 else 'fall' if e[0] - e[-1] > 6 else 'flat' if max(e) - min(e) < 4 else 'var'
    print(f"{r['f']:14} {r['dur']:7.2f}s {r['rms']:6.1f}dB {shape:4} env {e[0]:6.1f}..{max(e):6.1f}..{e[-1]:6.1f} cent {r['cent']} low {r['low']:.2f} hi {r['hi']:.2f} seam {r['seam']:4.1f} tones {r['tones'][:3]}")
