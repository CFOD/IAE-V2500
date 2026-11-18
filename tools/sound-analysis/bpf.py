import sys, os, json, numpy as np
from scipy.io import wavfile
D = sys.argv[1]; A = {r['f']: r for r in json.load(open(sys.argv[2]))}
BPF100 = 22 * 5650 / 60
rows = []
for f in sorted(A, key=lambda f: A[f]['dur']):
    if A[f]['dur'] < 3: continue
    sr, x = wavfile.read(os.path.join(D, f)); x = x.astype(np.float32) / 32768
    if x.ndim > 1: x = x.mean(1)
    L = 32768; hop = L // 2
    fr = [x[i:i + L] * np.hanning(L) for i in range(0, len(x) - L, hop)] or [np.pad(x, (0, L - len(x))) * np.hanning(L)]
    P = np.mean([np.abs(np.fft.rfft(a)) ** 2 for a in fr], axis=0); fq = np.fft.rfftfreq(L, 1 / sr)
    dB = 10 * np.log10(P + 1e-20); sm = np.convolve(dB, np.ones(61) / 61, mode='same'); pr = dB - sm
    best = None
    for i in np.where((fq > 380) & (fq < 2250))[0]:
        if pr[i] < 8 or pr[i] < pr[i - 1] or pr[i] < pr[i + 1]: continue
        j = np.argmin(abs(fq - 2 * fq[i])); h2 = pr[max(0, j - 3):j + 4].max()
        score = pr[i] + 0.5 * max(h2, 0)
        if best is None or score > best[0]: best = (score, fq[i], pr[i], h2)
    tot = P.sum(); hf = 10 * np.log10(P[fq > 2000].sum() / tot + 1e-12); vhf = 10 * np.log10(P[fq > 6000].sum() / tot + 1e-12)
    n1 = 100 * best[1] / BPF100 if best else None
    rows.append((f, A[f]['dur'], A[f]['rms'], round(best[1], 1) if best else None, round(n1, 1) if n1 else None, round(best[2], 1) if best else None, round(best[3], 1) if best else None, round(hf, 1), round(vhf, 1)))
for r in sorted(rows, key=lambda r: (r[4] or 0)):
    print(f"{r[0]:14} {r[1]:6.1f}s {r[2]:6.1f}dB  tone {r[3]}Hz -> N1 {r[4]}%  prom {r[5]} h2 {r[6]}   >2k {r[7]}dB  >6k {r[8]}dB")
