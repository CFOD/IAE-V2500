import sys, os, numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from scipy.io import wavfile
from scipy.signal import spectrogram
D, out = sys.argv[1], sys.argv[2]; files = sys.argv[3:]
fig, axs = plt.subplots(len(files), 1, figsize=(15, 5.2 * len(files)))
for ax, f in zip(np.atleast_1d(axs), files):
    sr, x = wavfile.read(os.path.join(D, f)); x = x.astype(np.float32) / 32768
    if x.ndim > 1: x = x.mean(1)
    fq, t, S = spectrogram(x, sr, nperseg=8192, noverlap=6144); S = 10 * np.log10(S + 1e-14); m = fq < 6000
    ax.pcolormesh(t, fq[m], S[m], vmin=S[m].max() - 70, vmax=S[m].max(), shading='auto', cmap='magma')
    ax.set_ylim(0, 6000); ax.set_title(f); ax.set_xticks(np.arange(0, t[-1], 2 if t[-1] < 40 else 4)); ax.grid(alpha=0.25)
    env = np.array([20 * np.log10(np.sqrt(np.mean(c ** 2)) + 1e-9) for c in np.array_split(x, 300)])
    a2 = ax.twinx(); a2.plot(np.linspace(0, len(x) / sr, 300), env, color='cyan', lw=1); a2.set_ylim(-80, 0)
fig.tight_layout(); fig.savefig(out, dpi=60)
