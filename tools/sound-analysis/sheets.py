import sys, os, json, numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.io import wavfile
from scipy.signal import spectrogram
D, OUT = sys.argv[1], sys.argv[2]
A = {r['f']: r for r in json.load(open(sys.argv[3]))}
files = sorted(A, key=lambda f: (A[f]['dur']))
per = 15
for s in range(0, len(files), per):
    fig, axs = plt.subplots(5, 3, figsize=(15, 13)); axs = axs.ravel()
    for ax, f in zip(axs, files[s:s + per]):
        sr, x = wavfile.read(os.path.join(D, f)); x = x.astype(np.float32) / 32768
        if x.ndim > 1: x = x.mean(1)
        fq, t, S = spectrogram(x, sr, nperseg=4096, noverlap=3072)
        S = 10 * np.log10(S + 1e-14)
        m = fq < 10000
        ax.pcolormesh(t, fq[m], S[m], vmin=S[m].max() - 75, vmax=S[m].max(), shading='auto', cmap='magma')
        ax.set_yscale('symlog', linthresh=500); ax.set_ylim(50, 10000)
        env = np.array([20 * np.log10(np.sqrt(np.mean(c ** 2)) + 1e-9) for c in np.array_split(x, 200)])
        ax2 = ax.twinx(); ax2.plot(np.linspace(0, len(x) / sr, 200), env, color='cyan', lw=0.8); ax2.set_ylim(-80, 0); ax2.set_yticks([])
        ax.set_title(f"{f[:8]}  {A[f]['dur']:.1f}s  {A[f]['rms']:.0f}dB", fontsize=9)
        ax.tick_params(labelsize=7)
    for ax in axs[len(files[s:s + per]):]: ax.axis('off')
    fig.tight_layout(); fig.savefig(f"{OUT}/sheet{s // per + 1}.png", dpi=62); plt.close(fig)
    print('sheet', s // per + 1)
