import sys, os, json, numpy as np
from scipy.io import wavfile
D = sys.argv[1]; files = sys.argv[2:]
F1 = 5650 / 60  # LP shaft Hz at 100 % N1
for f in files:
    sr, x = wavfile.read(os.path.join(D, f)); x = x.astype(np.float32) / 32768
    if x.ndim > 1: x = x.mean(1)
    L = 65536; hop = L // 2
    fr = [x[i:i + L] * np.hanning(L) for i in range(0, max(1, len(x) - L), hop)] if len(x) > L else [np.pad(x, (0, L - len(x))) * np.hanning(L)]
    P = np.mean([np.abs(np.fft.rfft(a)) ** 2 for a in fr], axis=0); fq = np.fft.rfftfreq(L, 1 / sr)
    dB = 10 * np.log10(P + 1e-20); sm = np.convolve(dB, np.ones(121) / 121, mode='same'); pr = np.clip(dB - sm, 0, 40)
    def at(fz):
        if fz > 11000: return 0.0
        i = int(round(fz / (sr / L))); return float(pr[max(0, i - 2):i + 3].max())
    res = []
    for n1 in np.arange(15, 106, 0.1):
        fs = F1 * n1 / 100
        bpf = at(22 * fs) + 0.6 * at(44 * fs)
        saw = np.mean([at(k * fs) for k in range(3, 22)])
        res.append((bpf + 1.5 * saw, n1, at(22 * fs), at(44 * fs), saw))
    res.sort(reverse=True)
    top = []; 
    for r in res:
        if all(abs(r[1] - t[1]) > 2 for t in top): top.append(r)
        if len(top) == 3: break
    print(f"{f[:14]:14} " + "  |  ".join(f"N1 {t[1]:5.1f}: score {t[0]:5.1f} bpf {t[2]:4.1f} 2bpf {t[3]:4.1f} saw {t[4]:4.1f}" for t in top))
