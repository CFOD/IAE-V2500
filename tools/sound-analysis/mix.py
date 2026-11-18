"""Offline mix of app/sounds/sounds.json against a sim trace, following app/samples.js."""
import json, sys, os, numpy as np
from scipy.io import wavfile
SND, TRACE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]; FRONT = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
SR = 44100; M = json.load(open(os.path.join(SND, 'sounds.json'))); tr = json.load(open(TRACE))
def load(f):
    sr, x = wavfile.read(os.path.join(SND, f)); x = x.astype(np.float32) / 32768
    if x.ndim == 1: x = np.stack([x, x], 1)
    if sr != SR: raise SystemExit('rate ' + f)
    return x
def curve(p, v):
    if not p: return 1.0
    xs = [a for a, _ in p]; ys = [b for _, b in p]; return float(np.interp(v, xs, ys))
fps = 50; B = SR // fps; N = len(tr) * B; out = np.zeros((N, 2), np.float32)
layers = [dict(L, buf=load(L['file'])) for L in M['layers']]
for L in layers:
    L['pos'] = np.random.rand() * len(L['buf']) if 'track' not in L else 0.0
    L['g'] = 0.0; L['r'] = 1.0; L['active'] = False; L['voices'] = []
    if 'track' in L: L['track'] = sorted(L['track'])
def k(tau): return 1 - np.exp(-(1 / fps) / tau)
prev = dict(lit=0, n2=0)
for i, (t, n1, n2, lit, st, fuel) in enumerate(tr):
    x = dict(n1=n1, n2=n2, fuel=fuel); seg = slice(i * B, (i + 1) * B); duck = 0.0
    for L in [l for l in layers if 'track' in l]:
        v = x[L.get('driver', 'n2')]; target = curve(L['track'], v)
        if L['when'] == 'start':
            if not L['active'] and st and n2 < 35: L['active'] = True; L['voices'] = [[target, 0.0, 1.0]]; L['pos'] = target
            if L['active'] and ((not st and not lit) or n2 >= L.get('until', 60)): L['active'] = False
        else:
            if not L['active'] and prev['lit'] and not lit and prev['n2'] > 40: L['active'] = True; L['voices'] = [[target, 0.0, 1.0]]; L['pos'] = target
            if L['active'] and (lit or n2 < L.get('until', 0.8)): L['active'] = False
        if L['active']:
            err = target - L['pos']
            if err > 2.2 or err < -3:
                for vo in L['voices']: vo[2] = 0.0
                L['voices'].append([max(0, target - 0.4), 0.0, 1.0]); L['pos'] = max(0, target - 0.4); rate = 1.0
            else: rate = min(1.25, max(0.6, 1 + 0.5 * err))
            L['pos'] += rate / fps
            vol = curve(L['volume'], v); duck = max(duck, min(1, vol)); gt = vol * L.get('gain', 1)
        else: rate = 1.0; gt = 0.0
        L['g'] += (gt - L['g']) * k(0.4 if not L['active'] else 0.12)
        buf = L['buf']; keep = []
        for vo in L['voices']:
            p0 = vo[0] * SR; idx = p0 + rate * np.arange(B); idx = idx[idx < len(buf) - 1]
            if len(idx):
                a = np.linspace(vo[1], vo[1] + (vo[2] - vo[1]) * k(0.23), len(idx))[:, None]
                j = idx.astype(int); fr = (idx - j)[:, None]; s = buf[j] * (1 - fr) + buf[j + 1] * fr
                out[seg][:len(idx)] += s * a * L['g']
            vo[1] = vo[1] + (vo[2] - vo[1]) * k(0.23); vo[0] += rate * B / SR
            if vo[2] > 0 or vo[1] > 0.002: keep.append(vo)
        L['voices'] = keep
    for L in [l for l in layers if 'track' not in l]:
        v = x[L.get('driver', 'n1')]; w = L.get('when')
        gate = (1 if lit else 0) if w == 'lit' else (0 if lit else 1) if w == 'unlit' else (1 if st else 0) if w == 'starter' else (1 if not lit and not st else 0) if w == 'coast' else 1
        d = 0.4 + 0.9 * FRONT if L.get('pos') == 'front' else 0.4 + 0.9 * (1 - FRONT) if L.get('pos') == 'rear' else 1
        gt = min(4, curve(L['volume'], v) * L.get('gain', 1) * gate * d * (1 - duck))
        L['g'] += (gt - L['g']) * k(0.25 if w else 0.08); L['r'] += (min(4, max(0.05, curve(L['pitch'], v))) - L['r']) * k(0.05)
        if L['g'] < 1e-4: L['pos'] = (L['pos'] + L['r'] * B) % len(L['buf']); continue
        buf = L['buf']; idx = (L['pos'] + L['r'] * np.arange(B)) % len(buf); j = idx.astype(int); fr = (idx - j)[:, None]
        s = buf[j] * (1 - fr) + buf[(j + 1) % len(buf)] * fr
        out[seg] += s * L['g']; L['pos'] = (L['pos'] + L['r'] * B) % len(buf)
    prev = dict(lit=lit, n2=n2)
pk = np.abs(out).max(); out *= 0.95 / pk
# gentle limiter so the take-off peak does not set the level for everything else
out = np.tanh(out * 1.6) / np.tanh(1.6)
wavfile.write(OUT, SR, (out * 32767).astype(np.int16)); print('peak', round(float(pk), 3), 'seconds', N / SR)
