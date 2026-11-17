"""External dressing of the V2500: rigid tubes, harnesses, ducts and hoses, routed between the
components placed in build_engine.py and the procedural core in app/scene3d.js.

Layout follows the SR Technics component-location booklet and the Airbus training manual photos:
fuel, oil and hydraulic systems on the left of the fan case, the EEC, its relay box and the bleed
solenoids on the right, the gearbox underneath, and everything that reaches the core passing
through the lower bifurcation. Exact tube-by-tube routing is not published; the routes here are
built the way real dressing is (parallel groups, concentric bends, clamps every 150-250 mm),
between the right end points.
"""
import math
from pipes import Dresser


def smooth_bump(u):
    """1 on |u| < 0.25, smooth fall to 0 at |u| = 1."""
    a = abs(u)
    if a <= 0.25: return 1.0
    if a >= 1.0: return 0.0
    t = (1.0 - a) / 0.75
    return t * t * (3 - 2 * t)


def plateau(x, a, b, ramp):
    """1 between a and b, smooth fall to 0 over `ramp` either side."""
    if a <= x <= b: return 1.0
    d = (a - x) if x < a else (x - b)
    if d >= ramp: return 0.0
    t = 1 - d / ramp
    return t * t * (3 - 2 * t)


def build_dressing(P, r_at, in_cut, material, link, made, section):
    # ------------------------------------------------------------------ materials
    M = {
        'ss': material('tube_ss', (0.78, 0.79, 0.8), 1.0, 0.26),          # stainless rigid tube
        'ti': material('tube_ti', (0.6, 0.61, 0.6), 1.0, 0.38),           # titanium / inconel tube (duller)
        'cad': material('tube_cad', (0.68, 0.56, 0.3), 0.9, 0.36),        # cadmium-plated / chromate fittings and lines
        'nut': material('fitting', (0.74, 0.74, 0.72), 1.0, 0.3),
        'clamp': material('clamp_block', (0.42, 0.44, 0.47), 0.6, 0.5),    # block clamps
        'red': material('clamp_red', (0.74, 0.2, 0.09), 0.0, 0.62),       # red silicone P-clamp cushions (photos)
        'brk': material('bracket', (0.5, 0.52, 0.55), 0.9, 0.48),
        'loom': material('loom', (0.86, 0.85, 0.8), 0.0, 0.9),            # white braided harness (swapped for a braid texture on load)
        'band': material('loom_band', (0.72, 0.13, 0.08), 0.0, 0.6),      # red identification sleeves
        'conn': material('connector', (0.46, 0.48, 0.5), 0.9, 0.4),
        'fire': material('firesleeve', (0.78, 0.36, 0.14), 0.0, 0.85),    # orange silicone fire sleeve on hoses
        'duct': material('duct', (0.82, 0.83, 0.84), 1.0, 0.3),
        'flange': material('vband', (0.66, 0.67, 0.68), 1.0, 0.32),
        'boss': material('cast', (0.56, 0.63, 0.7), 0.35, 0.5),
    }

    # ------------------------------------------------------------------ surfaces the routes follow
    RIBS = [(-0.012, 0.045), (0.09, 0.03), (0.2, 0.03), (0.31, 0.03), (0.42, 0.045), (0.62, 0.03), (0.8, 0.045), (1.0, 0.03), (1.18, 0.05)]
    fan_base = lambda x: r_at(P['bypOuter'], x) + 0.0335

    def fan(x):  # fan case outer surface including its stiffening ribs: rigid tubes joggle over them
        return fan_base(x) + max([0.0] + [h * smooth_bump((x - xr) / 0.05) for xr, h in RIBS])

    core_base = lambda x: r_at(P['coreOuter'], x) + 0.026

    def core(x):  # envelope of the core casings, flanges, stator levers and the turbine cooling cage
        e = core_base(x)
        for xf in (1.17, 1.5, 1.88, 2.21, 2.44): e = max(e, core_base(x) + 0.03 * smooth_bump((x - xf) / 0.03))
        e = max(e, r_at(P['coreOuter'], x) + 0.098 * plateau(x, 1.14, 1.37, 0.04))   # stator levers and unison rings
        e = max(e, (0.392 + 0.033 * smooth_bump((x - 2.05) / 0.03)) * plateau(x, 1.95, 2.16, 0.04))   # diffuser case and its flange
        if x > 2.22: e = max(e, r_at(P['coreOuter'], x) + 0.068)
        return e

    absr = lambda x: 0.0  # routes given in absolute radius (crossing the bypass duct)

    D = Dresser('fancase_dress', in_cut, section)
    C = Dresser('ext_dress', in_cut, section)

    def T(dr, R, way, n=1, d=0.022, radius=0.005, mat='ss', clamp=True, nuts=True, layers=1, rb=0.04, boss=False, every=0.2):
        dr.tubes(R, way, n=n, d=d, radius=radius, mat=[M[m] for m in mat] if isinstance(mat, (list, tuple)) else M[mat],
                 clamp_mat=M['clamp'] if clamp else None, bracket_mat=M['brk'], nut_mat=M['nut'] if nuts else None,
                 layers=layers, rb=rb, end_boss=True if boss else None, boss_mat=M['boss'], clamp_every=every)

    def H(dr, R, way, radius=0.009, bands=True, conn=(True, True), rb=0.05):
        dr.loom(R, way, radius=radius, mat=M['loom'], band_mat=M['band'] if bands else None, clamp_mat=M['red'], bracket_mat=M['brk'],
                conn_mat=M['conn'], connectors=conn, rb=rb)

    # ================================================================== FAN CASE, RIGHT SIDE (EEC side)
    # EEC connectors are at x 0.72-0.76, th 298-311.6, r 0.905
    for k in range(3):  # EEC -> fan electrical connector panel at the top
        a = 298 + 3.4 * k
        H(D, fan, [(0.765, a, 0.045), (0.9, a, 0.03), (0.9, 338 + 3 * k, 0.03), (1.09, 338 + 3 * k, 0.03), (1.13, 342 + 3 * k, 0.14)], radius=0.009 + 0.002 * (k == 1))
    for k, a in enumerate((308.2, 311.6)):  # EEC -> relay box
        H(D, fan, [(0.765, a, 0.045), (0.785, a, 0.035), (0.785, 286 - 2 * k, 0.035), (0.69, 286 - 2 * k, 0.03), (0.6 + 0.06 * k, 283.5, 0.06)], radius=0.007)
    for k in range(4):  # relay box -> bleed solenoids
        H(D, fan, [(0.56 + 0.04 * k, 281, 0.06), (0.56 + 0.04 * k, 276, 0.035), (0.57 + 0.085 * k, 273, 0.05)], radius=0.0045, conn=(False, True), rb=0.02)
    # P3 servo air from the solenoids down the right side to the lower bifurcation (they feed the HPC bleed valves)
    T(D, fan, [(0.585, 266, 0.05), (0.62, 262, 0.03), (0.9, 262, 0.015), (0.9, 214, 0.015), (1.12, 214, 0.015), (1.12, 190, 0.015), (1.16, 186, 0.015)], n=4, d=0.016, radius=0.0035, mat='ss', rb=0.045)
    # air-cooled oil cooler <-> gearbox
    T(D, fan, [(0.74, 236, 0.07), (0.71, 232, 0.02), (0.71, 214, 0.02), (0.71, 210, 0.06)], n=2, d=0.032, radius=0.011, mat='ss', rb=0.05)
    # pressure sense lines from the EEC forward over the top (P2, P12.5)
    T(D, fan, [(0.29, 300, 0.05), (0.255, 302, 0.018), (0.255, 349, 0.018), (0.145, 349, 0.018), (0.145, 358, 0.018), (0.0, 358, 0.03)], n=3, d=0.012, radius=0.003, mat='cad', rb=0.03)
    # anti-ice duct with its joints
    D.duct(fan_base, [(1.19, 328, 0.105), (0.95, 330, 0.105), (0.1, 334, 0.105), (-0.02, 334, 0.105)], 0.032, M['duct'], M['flange'], joints=(0.3, 0.7))
    # fire detection loop along the right side of the fan case (double element, on red clamps)
    for dd in (0.0, 0.012):
        D.loom(fan, [(0.36 + dd, 212, 0.012), (0.36 + dd, 352, 0.012)], radius=0.0028, mat=M['cad'], clamp_mat=M['red'], clamp_every=0.18, rb=0.03)
    # small looms to the ACOC temperature sensor and the starter valve
    H(D, fan, [(0.765, 300, 0.04), (0.9, 296, 0.025), (0.9, 246, 0.025), (0.9, 241, 0.09)], radius=0.006)
    H(D, fan, [(0.29, 296, 0.05), (0.255, 292, 0.025), (0.255, 226, 0.025), (0.4, 224, 0.06)], radius=0.006)

    # ================================================================== FAN CASE, LEFT SIDE (fuel, oil, hydraulics)
    # hydraulic pump -> fluid disconnect panel on the upper left (suction, pressure, case drain)
    T(D, fan, [(0.26, 182, 0.13), (0.255, 176, 0.02), (0.255, 24, 0.02), (1.09, 24, 0.02), (1.13, 14, 0.14)], n=3, d=0.034,
      radius=[0.012, 0.007, 0.006], mat='ss', rb=0.07, every=0.24)
    # fuel supply and return from the pylon panel down to the LP fuel filter
    T(D, fan, [(1.13, 8, 0.14), (1.13, 20, 0.02), (1.13, 128, 0.02), (1.1, 138, 0.08)], n=2, d=0.03, radius=[0.011, 0.008], mat='ss', rb=0.07)
    # LP filter / fuel-cooled oil cooler <-> pump and metering unit on the gearbox
    T(D, fan, [(1.0, 140, 0.05), (0.97, 146, 0.02), (0.97, 158, 0.02), (1.0, 162, 0.09)], n=2, d=0.03, radius=0.01, mat='ss', rb=0.05)
    # oil pressure to the transmitter and low-pressure switch at the top left
    T(D, fan, [(0.34, 168, 0.12), (0.145, 166, 0.018), (0.145, 52, 0.018), (0.55, 52, 0.018), (0.6, 49, 0.05)], n=2, d=0.014, radius=0.004, mat='cad', rb=0.04)
    # scavenge filter differential pressure lines
    T(D, fan, [(0.76, 150, 0.1), (0.71, 146, 0.018), (0.71, 62, 0.018), (0.66, 56, 0.05)], n=2, d=0.014, radius=0.0035, mat='ss', rb=0.035)
    # IDG oil cooler <-> IDG, round behind the gearbox
    T(D, fan, [(0.98, 104, 0.06), (0.9, 108, 0.018), (0.9, 196, 0.018), (0.82, 200, 0.08)], n=2, d=0.026, radius=0.008, mat='ss', rb=0.05)
    # harness trunk over the top to the left-side sensors, with breakouts
    H(D, fan, [(0.765, 305, 0.045), (0.71, 318, 0.03), (0.71, 455, 0.03), (0.86, 460, 0.03), (0.95, 462, 0.07)], radius=0.011)
    H(D, fan, [(0.71, 362, 0.042), (0.42, 362, 0.03), (0.32, 362, 0.045)], radius=0.005, conn=(False, True))      # vibration pick-up
    H(D, fan, [(0.71, 406, 0.042), (0.64, 408, 0.05)], radius=0.005, conn=(False, True), rb=0.02)                 # oil pressure transmitter
    H(D, fan, [(0.71, 448, 0.042), (0.9, 448, 0.03), (1.02, 470, 0.045), (1.02, 480, 0.08)], radius=0.005, conn=(False, True))  # FCOC sensors
    for dd in (0.0, 0.012):
        D.loom(fan, [(0.36 + dd, 8, 0.012), (0.36 + dd, 148, 0.012)], radius=0.0028, mat=M['cad'], clamp_mat=M['red'], clamp_every=0.18, rb=0.03)

    # ================================================================== BOTTOM: everything for the core gathers at the lower bifurcation
    # servo fuel from the metering unit (VSV, booster bleed, clearance control actuators)
    T(D, fan, [(1.08, 166, 0.1), (1.12, 170, 0.015), (1.12, 178, 0.015), (1.16, 180, 0.015)], n=6, d=0.011, radius=0.003, mat='cad', rb=0.03)
    # metered fuel to the core
    T(D, fan, [(1.08, 160, 0.1), (1.14, 164, 0.02), (1.14, 176, 0.02), (1.17, 178, 0.02)], n=1, radius=0.009, mat='ss', rb=0.04)

    # crossing the bypass duct inside the lower bifurcation (absolute radius); each group stacks along x
    def cross(th, x, r0, r1, n, d, radius, mat, loom=False):
        # from a bulkhead fitting on the fan case rear flange, diagonally down inside the bifurcation to the core.
        # Groups are stacked radially (layers) so they stay within the thin bifurcation wall.
        x0 = 1.165 + (th - 180) * 0.004
        way = [(x0 - 0.05, th - 9, 0.85), (x0, th, 0.85), (x - 0.04, th, r1 + 0.05), (x, th, r1)]
        if loom: H(C, absr, way, radius=radius, conn=(False, False), rb=0.05)
        else: T(C, absr, way, n=1, d=d, radius=radius, mat=mat, rb=0.06, clamp=False, layers=n)
    cross(180.0, 1.3, 0.85, 0.42, 6, 0.011, 0.003, 'cad')       # servo fuel
    cross(179.3, 1.4, 0.85, 0.43, 4, 0.016, 0.0035, 'ss')       # P3 servo air
    cross(180.6, 1.47, 0.85, 0.44, 1, 0.02, 0.009, 'ss')        # metered fuel
    cross(179.6, 1.56, 0.85, 0.44, 2, 0.026, 0.008, 'ss')       # No. 4 bearing oil feed and scavenge
    cross(180.2, 1.66, 0.86, 0.45, 1, 0.02, 0.013, 'ss', loom=True)   # core harness A
    cross(179.8, 1.74, 0.86, 0.45, 1, 0.02, 0.011, 'ss', loom=True)   # core harness B

    # ================================================================== CORE
    hc = 0.022  # standard height above the core envelope
    # metered fuel: bifurcation -> round the HPC at x 1.43 up the right side -> fuel distribution valve
    T(C, core, [(1.47, 180, hc), (1.43, 186, hc), (1.43, 300, hc), (1.72, 300, hc), (1.76, 312, 0.06)], n=1, radius=0.009, mat='ss', rb=0.06)
    # servo fuel: to the VSV actuator (left), HP valve (left) and clearance-control actuator (right)
    T(C, core, [(1.3, 178, hc), (1.43, 170, hc), (1.43, 146, hc), (1.36, 140, 0.07)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)
    T(C, core, [(1.3, 178, hc), (1.7, 172, hc), (1.7, 146, hc), (1.8, 141, 0.06)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)
    T(C, core, [(1.3, 182, hc), (1.7, 186, hc), (1.7, 270, hc), (2.08, 278, hc), (2.08, 284, 0.06)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)
    # P3 servo air to the four handling bleed valves
    T(C, core, [(1.4, 182, hc), (1.43, 190, hc + 0.02), (1.43, 252, hc + 0.02), (1.55, 254, 0.05)], n=2, d=0.016, radius=0.0035, mat='ss', rb=0.04)
    T(C, core, [(1.4, 182, hc), (1.43, 190, hc + 0.035), (1.43, 292, hc + 0.035), (1.55, 296, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    T(C, core, [(1.4, 182, hc), (1.43, 190, hc + 0.05), (1.43, 276, hc + 0.05), (1.75, 276, hc + 0.02), (1.76, 280, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    T(C, core, [(1.4, 178, hc), (1.43, 170, hc + 0.035), (1.43, 132, hc + 0.035), (1.55, 130, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    # No. 4 bearing oil: down the bottom to the diffuser case bosses
    T(C, core, [(1.56, 181, hc), (1.6, 168, hc), (1.98, 166, hc), (2.02, 166, 0.0)], n=2, d=0.026, radius=0.008, mat='ss', rb=0.05, boss=True)
    # core harness ring on the diffuser case, with breakouts
    H(C, core, [(1.66, 182, hc), (2.1, 186, 0.045), (2.1, 300, 0.045), (2.1, 318, 0.045)], radius=0.013, conn=(False, True))
    H(C, core, [(1.74, 178, hc), (2.1, 174, 0.045), (2.1, 120, 0.045)], radius=0.011, conn=(False, True))
    H(C, core, [(2.1, 246, 0.05), (1.6, 246, hc + 0.06), (1.25, 246, 0.06)], radius=0.007, conn=(False, True))    # ignition exciter A
    H(C, core, [(2.1, 258, 0.05), (1.6, 258, hc + 0.06), (1.25, 258, 0.06)], radius=0.007, conn=(False, True))    # ignition exciter B
    H(C, core, [(2.1, 196, 0.05), (2.6, 196, hc), (2.84, 190, 0.05)], radius=0.008, conn=(False, True))            # EGT junction box
    H(C, core, [(2.1, 150, 0.05), (2.3, 152, 0.05)], radius=0.006, conn=(False, True), rb=0.03)                    # buffer air cooler sensor
    # turbine cooling air (stage 10) from the HPC to the HP turbine case, both sides
    for th in (215, 145):
        T(C, core, [(1.8, th, 0.03), (1.86, th, 0.06), (2.28, th, 0.03)], n=1, radius=0.013, mat='ti', rb=0.06, boss=True)
    # buffer air: HPC stage 12 -> air-cooled air cooler -> No. 4 compartment
    C.duct(core, [(1.84, 158, 0.04), (2.0, 158, 0.06), (2.3, 154, 0.06)], 0.018, M['duct'], M['flange'], rb=0.08, joints=(0.5,))
    # sense lines along the HPC (P3 to the EEC via the bifurcation, No. 4 bearing pressure)
    T(C, core, [(1.42, 179, hc + 0.06), (1.9, 186, hc + 0.06), (1.9, 230, hc + 0.06), (2.0, 232, 0.05)], n=3, d=0.01, radius=0.0025, mat='cad', rb=0.03)

    # ================================================================== dense service lines
    # Many small-bore lines (sense, drain, servo, oil and fuel feeds) run between the components. Each
    # is routed: out of its component, into the nearest bay between ribs, round the case low down,
    # then along the case one level higher (so axial lines cross over circumferential ones) and in
    # to the other end. A simple occupancy map keeps lines in the same bay from overlapping.
    import random
    rng = random.Random(1886)

    def packer(bays, h_circ, h_ax, forbid):
        occ = {}

        def place(bx, t0, t1, w):
            lo, hi = min(t0, t1), max(t0, t1)
            for hh in h_circ:
                for k in range(0, 9):
                    off = (k + 1) // 2 * 0.016 * (1 if k % 2 else -1)
                    x = bx + off
                    if any(f(x, lo, hi) for f in forbid): continue
                    ok = all(not (abs(x - ox) < (w + ow) / 2 + 0.004 and lo < ohi and hi > olo and abs(hh - oh) < 0.009)
                             for ox, olo, ohi, ow, oh in occ.get(bx, []))
                    if ok:
                        occ.setdefault(bx, []).append((x, lo, hi, w, hh)); return x, hh
            return None

        def route(A, B, w):
            (xa, ta, ha), (xb, tb, hb) = A, B
            ba = min(bays, key=lambda b: abs(b - xa)); bb = min(bays, key=lambda b: abs(b - xb))
            got = place(ba, ta, tb, w)
            if got is None: return None
            x1, h1 = got
            way = [(xa, ta, ha), (x1, ta, h1), (x1, tb, h1)]
            if abs(bb - ba) > 0.05:
                way += [(x1 + 0.0001, tb, h_ax), (xb, tb, h_ax)]
            way.append((xb, tb, hb))
            # drop near-duplicate corners
            out = [way[0]]
            for q in way[1:]:
                if abs(q[0] - out[-1][0]) + abs(q[1] - out[-1][1]) * 0.015 + abs(q[2] - out[-1][2]) > 0.004: out.append(q)
            return out
        return route

    FAN_BAYS = [0.145, 0.255, 0.365, 0.52, 0.71, 0.9, 1.09]
    gearbox = lambda x, lo, hi: 0.33 < x < 0.81 and lo < 210 and hi > 150
    oiltank = lambda x, lo, hi: 0.43 < x < 0.62 and lo < 151 and hi > 126
    route_fan = packer(FAN_BAYS, (0.012, 0.024, 0.036), 0.05, [gearbox, oiltank])
    RH = [(0.765, 298, 0.045), (0.765, 304, 0.045), (0.765, 310, 0.045), (0.27, 300, 0.05), (0.27, 308, 0.05), (0.6, 281, 0.06), (0.66, 281, 0.06),
          (0.55, 266, 0.05), (0.64, 266, 0.05), (0.72, 266, 0.05), (0.81, 266, 0.05), (0.7, 256, 0.05), (0.79, 256, 0.05), (0.74, 232, 0.07), (1.06, 244, 0.07),
          (0.42, 220, 0.08), (0.5, 210, 0.07), (0.7, 210, 0.07), (0.62, 326, 0.1), (1.0, 346, 0.08), (0.26, 250, 0.01), (1.17, 214, 0.02), (1.17, 236, 0.02),
          (1.17, 268, 0.02), (1.17, 296, 0.02), (1.17, 320, 0.02), (1.17, 190, 0.02), (1.17, 200, 0.02), (0.05, 300, 0.03), (0.05, 340, 0.03)]
    LH = [(0.5, 150, 0.07), (0.7, 150, 0.07), (0.44, 140, 0.09), (0.6, 136, 0.09), (0.95, 120, 0.08), (1.09, 126, 0.08), (1.02, 140, 0.09), (0.88, 100, 0.06),
          (1.08, 100, 0.06), (0.6, 48, 0.05), (0.66, 54, 0.05), (0.3, 6, 0.04), (0.4, 34, 0.06), (0.4, 46, 0.06), (0.3, 70, 0.07), (0.8, 60, 0.05), (1.13, 10, 0.14),
          (1.13, 18, 0.14), (1.17, 30, 0.02), (1.17, 60, 0.02), (1.17, 90, 0.02), (1.17, 120, 0.02), (1.17, 150, 0.02), (1.17, 170, 0.02), (1.17, 160, 0.02),
          (0.05, 20, 0.03), (0.05, 90, 0.03), (0.05, 150, 0.03), (0.36, 160, 0.06), (0.78, 160, 0.06)]
    mats = ['ss', 'ss', 'ss', 'ti', 'cad', 'ss', 'ti']
    for side, anchors, nrun in (('R', RH, 46), ('L', LH, 46)):
        made_n = 0; tries = 0
        while made_n < nrun and tries < 600:
            tries += 1
            A, B = rng.sample(anchors, 2)
            if abs(A[0] - B[0]) < 0.08 and abs(A[1] - B[1]) < 6: continue
            n = rng.choice([1, 1, 1, 2, 2, 3, 4]); r = rng.choice([0.0025, 0.003, 0.0035, 0.004, 0.005, 0.0065]); d = 2.2 * r + 0.006
            jitter = lambda P: (P[0] + rng.uniform(-0.012, 0.012), P[1] + rng.uniform(-2.5, 2.5), P[2])
            way = route_fan(jitter(A), jitter(B), (n - 1) * d + 2 * r)
            if way is None: continue
            T(D, fan, way, n=n, d=d, radius=r, mat=rng.choice(mats), rb=0.025 + 0.004 * n, every=0.2 + rng.uniform(0, 0.06))
            made_n += 1
    # a few more harness branches on each side
    for A, B, r in (((0.765, 302, 0.045), (1.17, 250, 0.02), 0.008), ((0.765, 306, 0.045), (0.42, 220, 0.08), 0.006), ((0.27, 304, 0.05), (0.05, 330, 0.03), 0.006),
                    ((0.88, 100, 0.06), (1.17, 80, 0.02), 0.007), ((0.6, 48, 0.05), (1.17, 40, 0.02), 0.006), ((0.36, 160, 0.06), (0.145, 120, 0.03), 0.006)):
        way = route_fan(A, B, 2 * r)
        if way: H(D, fan, way, radius=r, conn=(True, True))

    # core: same treatment between the core components, below the core cowl
    CORE_BAYS = [1.43, 1.7, 2.1, 2.32]
    vsv = lambda x, lo, hi: x < 1.39
    route_core = packer(CORE_BAYS, (0.02, 0.034, 0.048, 0.062), 0.075, [vsv])
    CA = [(1.55, 254, 0.05), (1.55, 296, 0.05), (1.75, 280, 0.05), (1.55, 132, 0.05), (1.36, 140, 0.07), (1.8, 141, 0.06), (1.76, 312, 0.06), (2.08, 284, 0.06),
          (2.2, 236, 0.07), (2.2, 250, 0.07), (2.3, 152, 0.06), (2.84, 190, 0.05), (1.25, 246, 0.06), (1.25, 258, 0.06), (2.0, 232, 0.05), (2.0, 166, 0.03),
          (1.45, 180, 0.03), (1.6, 180, 0.03), (1.75, 180, 0.03), (1.9, 182, 0.04), (2.02, 200, 0.04), (2.02, 140, 0.04), (2.25, 210, 0.05), (2.25, 120, 0.05),
          (2.5, 220, 0.03), (2.5, 140, 0.03), (1.6, 220, 0.04), (1.6, 300, 0.04), (1.95, 260, 0.05), (1.95, 300, 0.05)]
    made_n = 0; tries = 0
    while made_n < 34 and tries < 500:
        tries += 1
        A, B = rng.sample(CA, 2)
        if abs(A[0] - B[0]) < 0.06 and abs(A[1] - B[1]) < 6: continue
        n = rng.choice([1, 1, 2, 2, 3]); r = rng.choice([0.0025, 0.003, 0.004, 0.005]); d = 2.2 * r + 0.006
        way = route_core((A[0], A[1] + rng.uniform(-2, 2), A[2]), (B[0], B[1] + rng.uniform(-2, 2), B[2]), (n - 1) * d + 2 * r)
        if way is None: continue
        T(C, core, way, n=n, d=d, radius=r, mat=rng.choice(['ss', 'ti', 'ti', 'cad']), rb=0.025 + 0.004 * n, every=0.18)
        made_n += 1
    for A, B, r in (((2.1, 220, 0.05), (1.6, 300, 0.04), 0.007), ((2.1, 160, 0.05), (1.36, 140, 0.07), 0.006), ((2.1, 280, 0.05), (2.08, 284, 0.06), 0.005),
                    ((2.1, 200, 0.05), (2.5, 220, 0.03), 0.006)):
        way = route_core(A, B, 2 * r)
        if way: H(C, core, way, radius=r, conn=(False, True))

    # more groups through the lower bifurcation, matching the extra lines gathering at the bottom
    cross(180.4, 1.84, 0.85, 0.44, 3, 0.012, 0.004, 'ti')
    cross(179.6, 1.92, 0.85, 0.44, 4, 0.01, 0.003, 'ss')
    cross(180.0, 2.0, 0.85, 0.45, 1, 0.02, 0.01, 'ss', loom=True)

    # ================================================================== flexible hoses
    D.hose([(1.13, 352, 0.92), (1.1, 346, 0.98), (1.14, 340, 1.0)], 0.011, M['fire'], M['nut'])   # HCU pressure hose to the pylon
    D.hose([(1.13, 356, 0.92), (1.12, 2, 0.98), (1.15, 8, 1.0)], 0.009, M['fire'], M['nut'])

    D.finish(link, made); C.finish(link, made)
