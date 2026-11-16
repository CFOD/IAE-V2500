"""Re-derives the FADEC lookup tables from an open-loop steady-state sweep (tools/dp.js)
and writes them into src/sim/fadec.js. Run after changing component maps or the design point."""
import subprocess, json, re, os
root = os.path.join(os.path.dirname(__file__), '..')
out = subprocess.run(['node', os.path.join(root, 'tools', 'dp.js')], capture_output=True, text=True).stdout
T = json.loads([l for l in out.splitlines() if l.startswith('EPR_VS_THRUST')][0].split(' ', 1)[1])
RU = json.loads([l for l in out.splitlines() if l.startswith('RU')][0].split(' ', 1)[1])
T = [[0, 1.0]] + [t for t in T if t[0] > 0]
T = [t for i, t in enumerate(T) if i == 0 or (t[0] > T[i - 1][0] and t[1] > T[i - 1][1])]
ru = sorted({r[0]: r for r in RU}.values())
lo = ru[0][1]
ru = [[20, round(lo * 1.02, 4)], [45, round(lo * 1.03, 4)]] + ru[::2] + [ru[-1]]
ru = sorted({r[0]: r for r in ru}.values())
ru.append([round(ru[-1][0] + 6, 1), round(ru[-1][1] * 1.08, 4)])
p = os.path.join(root, 'src', 'sim', 'fadec.js'); s = open(p).read()
s = re.sub(r'export const EPR_VS_THRUST = .*;', 'export const EPR_VS_THRUST = ' + json.dumps(T).replace(' ', '') + ';', s)
s = re.sub(r'export const RU_STEADY = .*;', 'export const RU_STEADY = ' + json.dumps(ru).replace(' ', '') + ';', s)
open(p, 'w').write(s)
print('thrust->EPR points', len(T), '| Wf/P3 table', ru)
