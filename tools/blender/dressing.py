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
from pipes import Dresser, cyl_to_blender
from mathutils import Vector
import accessories as AC


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
        'ss': material('tube_ss', (0.74, 0.75, 0.76), 1.0, 0.38),          # stainless rigid tube
        'ti': material('tube_ti', (0.62, 0.62, 0.6), 1.0, 0.44),           # titanium / inconel tube (duller)
        'cad': material('tube_cad', (0.7, 0.6, 0.36), 0.9, 0.4),        # cadmium-plated / chromate fittings and lines
        'nut': material('fitting', (0.74, 0.74, 0.72), 1.0, 0.34),
        'clamp': material('clamp_block', (0.42, 0.44, 0.47), 0.6, 0.5),    # block clamps
        'red': material('clamp_red', (0.74, 0.2, 0.09), 0.0, 0.62),       # red silicone P-clamp cushions (photos)
        'brk': material('bracket', (0.5, 0.52, 0.55), 0.9, 0.48),
        'loom': material('loom', (0.78, 0.76, 0.7), 0.0, 0.9),            # white braided harness (swapped for a braid texture on load)
        'band': material('loom_band', (0.72, 0.13, 0.08), 0.0, 0.6),      # red identification sleeves
        'conn': material('connector', (0.46, 0.48, 0.5), 0.9, 0.4),
        'fire': material('firesleeve', (0.78, 0.36, 0.14), 0.0, 0.85),    # orange silicone fire sleeve on hoses
        'duct': material('duct', (0.76, 0.77, 0.78), 1.0, 0.4),
        'flange': material('vband', (0.66, 0.67, 0.68), 1.0, 0.36),
        'boss': material('cast', (0.5, 0.56, 0.62), 0.05, 0.55),
        'valve': material('steel', (0.62, 0.64, 0.66), 0.9, 0.4),         # cast valve bodies
        'act': material('gold', (0.8, 0.66, 0.3), 0.85, 0.35),            # chromated actuators
        'acc': material('tube_acc', (0.76, 0.76, 0.75), 1.0, 0.38),           # clearance-control spray tubes: fan air inside, so no heat tint
        'torque': material('torqueseal', (0.96, 0.42, 0.06), 0.0, 0.5),       # torque-seal paint stripes on tightened unions
    }
    # Fluid identification tapes (MIL-STD-1247 colour and symbol, drawn by the app from the material name) by line
    FLUID = {'hyd': 'HYDRAULIC', 'fuelsupply': 'FUEL', 'fcoc': 'FUEL', 'servofuel': 'FUEL', 'meteredfuel': 'FUEL', 'acocoil': 'LUBE',
             'oilpress': 'LUBE', 'idgcooler': 'LUBE', 'no4oil': 'LUBE', 'p3servo': 'PNEUMATIC', 'bufferair': 'PNEUMATIC'}
    tape = lambda prefix: (material('dec:tape:' + FLUID[prefix[5:]], (0.9, 0.9, 0.9), 0.0, 0.5) if prefix.startswith('line_') and prefix[5:] in FLUID else None)
    # wire-marker sleeves: each harness its own wire number, printed on the sleeve
    WIRES = {}
    def wire(prefix):
        if prefix not in WIRES: WIRES[prefix] = material(f'dec:wire:W{2040 + 7 * len(WIRES)}-P{1 + len(WIRES) % 4}', (0.92, 0.92, 0.88), 0.0, 0.45)
        return WIRES[prefix]

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
        if x > 2.22: e = max(e, r_at(P['coreOuter'], x) + 0.084)   # clearance-control rings and headers
        return e

    absr = lambda x: 0.0  # routes given in absolute radius (crossing the bypass duct)

    D = Dresser('fancase_dress', in_cut, section)
    C = Dresser('ext_dress', in_cut, section)
    # Named lines: each a component of its own (part id line_<name>) so it can be picked and failed in the app
    LINES = {}
    def L(name):
        if name not in LINES: LINES[name] = Dresser('line_' + name, in_cut, section)
        return LINES[name]

    # end points on the gearbox accessories, from their layout (accessories.py)
    def on(key, local, x_off=0.0):
        x, th, r = AC.at(key, local); return (x + x_off, th, r - fan(x + x_off))
    hyd_x, hyd_th, hyd_r, hyd_s = AC.LAYOUT['hydpump']
    hyd_port = (hyd_x - 0.1 * hyd_s, hyd_th, hyd_r + 0.042 * hyd_s + 0.012)
    op_x, op_th, op_r, op_s = AC.LAYOUT['oilpump']
    oil_port = (op_x - 0.02 * op_s, op_th + 2, op_r + 0.044 * op_s + 0.012)
    fp_s = AC.LAYOUT['fuelpump'][3]
    fcoc_port = on('fuelpump', (0.22, AC.side(162, 166, 1.04) / fp_s, 0.058 + 0.012 / fp_s))
    servo_port = on('fuelpump', (AC.FMU_REAR + 0.012 + 0.006 / fp_s, 0.0, 0.003))
    metered_port = on('fuelpump', (AC.FMU_REAR + 0.01 + 0.01 / fp_s, AC.side(160, 166, 0.97) / fp_s, 0.003))
    idg_s = AC.LAYOUT['idg'][3]
    idg_ports = [on('idg', (a, -0.114 - 0.012 / idg_s, -0.012)) for a in AC.IDG_COOLER]
    sav_plug = on('sav', (0.004, -0.09, 0.02), x_off=-0.012)
    duct_h = lambda x, r=AC.LAYOUT['sav'][2]: r - fan_base(x)   # starter duct centreline height above the case (at the valve's radius)
    st_r = AC.LAYOUT['starter'][2]

    def T(dr, R, way, n=1, d=0.022, radius=0.005, mat='ss', clamp=True, nuts=True, layers=1, rb=0.04, boss=False, every=0.2):
        # boss: True (both ends), or (start, end) - the ends that go into a casing through a cast port
        dr.tubes(R, way, n=n, d=d, radius=radius, mat=[M[m] for m in mat] if isinstance(mat, (list, tuple)) else M[mat],
                 clamp_mat=M['clamp'] if clamp else None, bracket_mat=M['brk'], nut_mat=M['nut'] if nuts else None,
                 layers=layers, rb=rb, end_boss=boss if boss else None, boss_mat=M['boss'], clamp_every=every,
                 tape_mat=tape(dr.prefix), torque_mat=M['torque'] if nuts else None)

    def H(dr, R, way, radius=0.009, bands=True, conn=(True, True), rb=0.05):
        dr.loom(R, way, radius=radius, mat=M['loom'], band_mat=wire(dr.prefix + str(len(WIRES) if not dr.prefix.startswith('line_') else '')) if bands else None, clamp_mat=M['red'], bracket_mat=M['brk'],
                conn_mat=M['conn'], connectors=conn, rb=rb)

    # ================================================================== FAN CASE, RIGHT SIDE (EEC side)
    # EEC connectors are at x 0.72-0.76, th 298-311.6, r 0.905
    for k in range(3):  # EEC -> fan electrical connector panel at the top
        a = 298 + 3.4 * k
        H(D, fan, [(0.765, a, 0.045), (0.9, a, 0.03), (0.9, 338 + 3 * k, 0.03), (1.0, 338 + 3 * k, 0.03), (1.05, 342 + 3 * k, 0.07)], radius=0.009 + 0.002 * (k == 1))
    for k, a in enumerate((308.2, 311.6)):  # EEC -> relay box
        H(D, fan, [(0.765, a, 0.045), (0.785, a, 0.035), (0.785, 286 - 2 * k, 0.035), (0.69, 286 - 2 * k, 0.03), (0.6 + 0.06 * k, 283.5, 0.06)], radius=0.007)
    for k in range(4):  # relay box -> bleed solenoids
        H(D, fan, [(0.56 + 0.04 * k, 281, 0.06), (0.56 + 0.04 * k, 276, 0.035), (0.57 + 0.085 * k, 273, 0.05)], radius=0.0045, conn=(False, True), rb=0.02)
    panel_h = lambda x: 0.903 - fan(x)   # top of the bulkhead panel, as a height above the fan case
    # P3 servo air from the solenoids down the right side, behind the IDG and angle gearbox, to the bulkhead panel
    T(L('p3servo'), fan, [(0.585, 266, 0.05), (0.62, 262, 0.03), (0.9, 262, 0.015), (0.9, 214, 0.015), (1.12, 214, 0.015), (1.205, 205, 0.03), (1.205, 182, 0.03), (1.19, 177.5, panel_h(1.19))], n=4, d=0.016, radius=0.0035, mat='ss', rb=0.045)
    # air-cooled oil cooler <-> gearbox
    T(L('acocoil'), fan, [(0.74, 236, 0.07), (0.71, 232, 0.02), (0.71, 216, 0.02), (0.71, 212.4, 0.11)], n=2, d=0.032, radius=0.011, mat='ss', rb=0.05)
    # pressure sense lines from the EEC forward over the top (P2, P12.5)
    T(D, fan, [(0.29, 300, 0.05), (0.255, 302, 0.018), (0.255, 349, 0.018), (0.145, 349, 0.018), (0.145, 358, 0.018), (0.0, 358, 0.03)], n=3, d=0.012, radius=0.003, mat='cad', rb=0.03)
    # Nacelle anti-ice: HP stage 7 air comes up through the fan frame and out of the fan case at a flanged
    # port, then runs forward through the anti-ice valve (2 o'clock) to the inlet lip
    L('antiice').duct(fan_base, [(1.04, 330, 0.0), (1.04, 330, 0.07), (0.96, 330, 0.105), (0.1, 334, 0.105), (-0.02, 334, 0.105)], 0.027, M['duct'], M['flange'],
           rb=0.07, joints=(0.38, 0.8), ports=(True, False), port_mat=M['boss'], supports=0.3, support_mat=M['brk'])
    # Air turbine starter supply: from the pylon at the top, round the back of the fan case behind the
    # air-cooled oil cooler, forward to the starter air valve, then on to the starter on the gearbox
    sx = AC.SAV_X1; st_th = AC.LAYOUT['starter'][1]; sv_th = AC.LAYOUT['sav'][1]
    L('starterduct').duct(fan_base, [(sx, sv_th, duct_h(sx)), (1.135, sv_th, duct_h(1.135)), (1.135, 330, duct_h(1.135) - 0.02), (1.19, 340, duct_h(1.19) - 0.02), (1.19, 352, duct_h(1.19) - 0.02), (1.19, 357, duct_h(1.19) + 0.06)], AC.DUCT_R, M['duct'], M['flange'],
           rb=0.11, joints=(0.3, 0.58), bellows=((0.84, 0.9),), supports=0.28, support_mat=M['brk'])
    ix = AC.STARTER_INLET_X
    L('starterduct').duct(fan_base, [(ix, st_th, duct_h(ix, st_r)), (0.052, st_th, duct_h(0.052, st_r)), (0.052, sv_th, duct_h(0.052)), (0.42, sv_th, duct_h(0.42))], AC.DUCT_R, M['duct'], M['flange'],
           rb=0.05, bellows=((0.62, 0.72),), supports=0.25, support_mat=M['brk'])
    # fire detection loop along the right side of the fan case (double element, on red clamps)
    for dd in (0.0, 0.012):
        D.loom(fan, [(0.36 + dd, 212, 0.012), (0.36 + dd, 352, 0.012)], radius=0.0028, mat=M['cad'], clamp_mat=M['red'], clamp_every=0.18, rb=0.03)
    # small looms to the ACOC temperature sensor and the starter valve
    H(D, fan, [(0.765, 300, 0.04), (0.9, 296, 0.025), (0.9, 246, 0.025), (0.9, 241, 0.09)], radius=0.006)
    H(D, fan, [(0.29, 296, 0.05), (0.255, 292, 0.025), (0.255, sav_plug[1] + 2, 0.025), (sav_plug[0] - 0.02, sav_plug[1], sav_plug[2]), sav_plug], radius=0.006)

    # ================================================================== FAN CASE, LEFT SIDE (fuel, oil, hydraulics)
    # hydraulic pump -> fluid disconnect panel on the upper left (suction, pressure, case drain)
    hx, hth, hr = hyd_port
    T(L('hyd'), fan, [(hx, hth, hr - fan(hx)), (hx - 0.01, hth - 6, 0.07), (0.175, hth - 8.5, 0.02), (0.175, 24, 0.02), (1.02, 24, 0.02), (1.065, 14, 0.1)], n=3, d=0.04,
      radius=[0.012, 0.007, 0.006], mat='ss', rb=0.07, every=0.24)
    # fuel supply and return from the pylon panel down to the LP fuel filter
    T(L('fuelsupply'), fan, [(1.065, 9, 0.1), (1.13, 20, 0.02), (1.13, 128, 0.02), (1.1, 138, 0.08)], n=2, d=0.03, radius=[0.011, 0.008], mat='ss', rb=0.07)
    # LP filter / fuel-cooled oil cooler <-> pump and metering unit on the gearbox
    T(L('fcoc'), fan, [(1.0, 140, 0.05), (0.97, 146, 0.02), (0.97, 157, 0.02), fcoc_port], n=2, d=0.03, radius=0.01, mat='ss', rb=0.05)
    # oil pressure to the transmitter and low-pressure switch at the top left
    ox, oth, orr = oil_port
    T(L('oilpress'), fan, [(ox, oth, orr - fan(ox)), (0.19, oth + 0.5, orr - fan(0.19)), (0.115, oth - 2, 0.03), (0.115, 52, 0.018), (0.55, 52, 0.018), (0.6, 49, 0.05)], n=2, d=0.014, radius=0.004, mat='cad', rb=0.04)
    # scavenge filter differential pressure lines
    T(D, fan, [(0.8, 149.5, 0.95 - fan(0.8)), (0.71, 146, 0.018), (0.71, 62, 0.018), (0.66, 56, 0.05)], n=2, d=0.014, radius=0.0035, mat='ss', rb=0.035)
    # IDG oil cooler <-> IDG, round behind the gearbox
    (ix0, ith, ih), (ix1, _, _) = idg_ports; ixm = (ix0 + ix1) / 2
    T(L('idgcooler'), fan, [(0.98, 104, 0.06), (0.9, 108, 0.018), (0.9, 214.5, 0.018), (ixm, 214.5, ih - 0.03), (ixm, ith + 0.5, ih)], n=2, d=abs(ix1 - ix0), radius=0.008, mat='ss', rb=0.05)
    # harness trunk over the top to the left-side sensors, with breakouts
    H(D, fan, [(0.765, 305, 0.045), (0.71, 318, 0.03), (0.71, 455, 0.03), (0.86, 460, 0.03), (0.95, 462, 0.07)], radius=0.011)
    H(D, fan, [(0.71, 362, 0.042), (0.42, 362, 0.03), (0.32, 362, 0.045)], radius=0.005, conn=(False, True))      # vibration pick-up
    H(D, fan, [(0.71, 406, 0.042), (0.64, 408, 0.05)], radius=0.005, conn=(False, True), rb=0.02)                 # oil pressure transmitter
    H(D, fan, [(0.71, 448, 0.042), (0.9, 448, 0.03), (1.02, 470, 0.045), (1.02, 480, 0.08)], radius=0.005, conn=(False, True))  # FCOC sensors
    for dd in (0.0, 0.012):
        D.loom(fan, [(0.36 + dd, 8, 0.012), (0.36 + dd, 148, 0.012)], radius=0.0028, mat=M['cad'], clamp_mat=M['red'], clamp_every=0.18, rb=0.03)

    # ================================================================== BOTTOM: services to the core
    # Fan-case lines end on the bulkhead panel at 6 o'clock; the core lines leave it underneath, drop down
    # inside the lower strut of the fan frame and run aft along the bottom of the core (services() below).
    T(L('servofuel'), fan, [servo_port, (1.16, 170, 0.03), (1.15, 174.5, panel_h(1.15))], n=6, d=0.011, radius=0.003, mat='cad', rb=0.03)    # servo fuel from the FMU
    T(L('meteredfuel'), fan, [metered_port, (1.165, 164, 0.04), (1.08, 176.5, panel_h(1.08))], n=1, radius=0.009, mat='ss', rb=0.04)            # metered fuel from the FMU

    # Each group: from the underside of the panel down inside the strut (its own station along the chord, widest
    # groups where the strut is thickest), aft along the bottom of the core in its own lane on one of two levels,
    # then straight down to the core and across to where its core route begins. Groups that end soonest run on
    # the lower level, so nothing they do crosses a lane that carries on aft.
    def services():
        lo_r, up_r, th_s = 0.48, 0.515, 181.0
        G = [  # (x station in the strut, x on the core, angle there, lane angle, level, n, d, radius, material or None = harness)
            (1.05, 1.3, 180.0, 170.5, lo_r, 6, 0.011, 0.003, 'cad'),     # servo fuel
            (1.075, 1.4, 180.0, 178.0, lo_r, 4, 0.016, 0.0035, 'ss'),    # P3 servo air to the handling bleed valves
            (1.2, 1.47, 180.0, 183.5, lo_r, 1, 0.02, 0.009, 'ss'),       # metered fuel
            (1.15, 1.56, 181.0, 188.0, lo_r, 2, 0.026, 0.008, 'ss'),     # No. 4 bearing oil feed and scavenge
            (1.175, 1.66, 182.0, 170.5, up_r, 1, 0.02, 0.013, None),     # core harness A
            (1.025, 1.74, 178.0, 174.5, up_r, 1, 0.02, 0.011, None),     # core harness B
            (1.125, 1.84, 180.4, 179.5, up_r, 3, 0.012, 0.004, 'ti'),
            (1.1, 1.92, 179.6, 185.5, up_r, 4, 0.01, 0.003, 'ss'),
            (1.005, 2.0, 180.0, 190.5, up_r, 1, 0.02, 0.01, None),
        ]
        names = ['servofuel', 'p3servo', 'meteredfuel', 'no4oil', 'harnessA', 'harnessB', None, None, None]
        for (xs, xd, thd, lane, lev, n, d, radius, mat), nm in zip(G, names):
            dr = L(nm) if nm else C
            low = core(xd) + 0.022
            way = [(xs, 177.5, 0.884), (xs + 0.004, th_s, 0.8), (xs + 0.02, th_s, 0.56), (xs + 0.075, lane, lev),
                   (xd - 0.075, lane, lev), (xd - 0.035, lane, low + 0.01), (xd, thd, low)]
            if mat is None: H(dr, absr, way, radius=radius, conn=(False, False), rb=0.04)
            else: T(dr, absr, way, n=n, d=d, radius=radius, mat=mat, rb=0.04, clamp=True, every=0.22)
    services()

    # ================================================================== CORE
    hc = 0.022  # standard height above the core envelope
    # metered fuel: bifurcation -> round the HPC at x 1.43 up the right side -> fuel distribution valve
    T(L('meteredfuel'), core, [(1.47, 180, hc), (1.43, 186, hc), (1.43, 300, hc), (1.66, 300, hc), (1.7, 314, 0.08), (1.75, 318, 0.108)], n=1, radius=0.009, mat='ss', rb=0.05)   # into the FDV (core_units.py)
    # servo fuel: to the VSV actuator (left), HP valve (left) and clearance-control actuator (right)
    T(L('servofuel'), core, [(1.3, 178, hc), (1.43, 170, hc), (1.43, 146, hc), (1.3, 140, 0.085)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)   # VSV actuator ports
    T(L('servofuel'), core, [(1.3, 178, hc), (1.7, 172, hc), (1.7, 146, hc), (1.8, 141, 0.06)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)
    T(L('servofuel'), core, [(1.3, 182, hc), (1.7, 186, hc), (1.7, 270, hc), (2.08, 278, hc), (2.095, 286, 0.105)], n=2, d=0.011, radius=0.003, mat='cad', rb=0.04)   # ACC actuator ports
    # P3 servo air to the four handling bleed valves
    T(L('p3servo'), core, [(1.4, 182, hc), (1.43, 190, hc + 0.02), (1.43, 252, hc + 0.02), (1.55, 254, 0.05)], n=2, d=0.016, radius=0.0035, mat='ss', rb=0.04)
    T(L('p3servo'), core, [(1.4, 182, hc), (1.43, 190, hc + 0.035), (1.43, 292, hc + 0.035), (1.55, 296, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    T(L('p3servo'), core, [(1.4, 182, hc), (1.43, 190, hc + 0.05), (1.43, 276, hc + 0.05), (1.75, 276, hc + 0.02), (1.76, 280, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    T(L('p3servo'), core, [(1.4, 178, hc), (1.43, 170, hc + 0.035), (1.43, 132, hc + 0.035), (1.55, 130, 0.05)], n=1, radius=0.0035, mat='ss', rb=0.04)
    # No. 4 bearing oil: down the bottom to the diffuser case bosses
    T(L('no4oil'), core, [(1.56, 181, hc), (1.6, 168, hc), (1.88, 162, hc), (1.932, 162, 0.0)], n=2, d=0.026, radius=0.008, mat='ss', rb=0.05, boss=True)   # into the combustor's dump gap (details.py)
    # core harness ring on the diffuser case, with breakouts
    H(L('harnessA'), core, [(1.66, 182, hc), (2.1, 186, 0.045), (2.1, 300, 0.045), (2.1, 318, 0.045)], radius=0.013, conn=(False, True))
    H(L('harnessB'), core, [(1.74, 178, hc), (2.1, 174, 0.045), (2.1, 120, 0.045)], radius=0.011, conn=(False, True))
    H(C, core, [(2.1, 214, 0.05), (1.6, 214, hc + 0.06), (1.43, 218, 0.05), (1.41, 222, 0.041)], radius=0.007, conn=(False, True))    # ignition exciter A input
    H(C, core, [(2.1, 248, 0.05), (1.6, 248, hc + 0.06), (1.43, 244, 0.05), (1.41, 240, 0.041)], radius=0.007, conn=(False, True))    # ignition exciter B input
    # high-tension leads (metal braid) from each exciter to its igniter plug on the diffuser case (igniters at 227.6 and 47.5 deg)
    L('htleadA').loom(core, [(1.67, 222, 0.057), (1.8, 224, 0.075), (1.95, 227.6, 0.11), (2.01, 227.6, 0.088)], radius=0.0075, mat=M['ti'], clamp_mat=M['red'], bracket_mat=M['brk'], conn_mat=M['nut'], connectors=(True, True), rb=0.04)
    L('htleadB').loom(core, [(1.67, 240, 0.057), (1.73, 244, 0.1), (1.73, 400, 0.1), (1.95, 405, 0.11), (2.01, 407.5, 0.088)], radius=0.0075, mat=M['ti'], clamp_mat=M['red'], bracket_mat=M['brk'], conn_mat=M['nut'], connectors=(True, True), rb=0.04)
    H(L('egtharness'), core, [(2.1, 196, 0.05), (2.42, 194, hc), (2.55, 187, hc), (2.57, 186, 0.487 - core(2.57))], radius=0.008, conn=(False, True))   # EGT junction box (core_units.py)
    H(C, core, [(2.1, 150, 0.05), (2.3, 152, 0.05)], radius=0.006, conn=(False, True), rb=0.03)                    # buffer air cooler sensor
    # turbine cooling air (stage 10) from the HPC to the HP turbine case, both sides
    for th in (215, 145):
        T(C, core, [(1.8, th, 0.0), (1.86, th, 0.06), (2.19, th, 0.03)], n=1, radius=0.013, mat='ti', rb=0.06, boss=True)

    # ================================================================== BLEED AIR to the aircraft
    # Stage 7 (IP) and stage 10 (HP) ports on the HPC case. The IP duct has a check valve, the HP duct the
    # HP valve; they join and rise through the upper bifurcation, through the pressure regulating valve,
    # to the precooler in the pylon.
    L('bleed7').duct(core, [(1.58, 30, 0.0), (1.58, 30, 0.075), (1.58, 9, 0.075), (1.5, 3, 0.14), (1.5, 3, 0.57)], 0.046, M['duct'], M['flange'],
           rb=0.07, joints=(0.18, 0.52), bellows=((0.6, 0.66),), ports=(True, False), port_mat=M['boss'],
           valves=((0.33, 0.07, 1.22, M['valve'], None), (0.8, 0.12, 1.3, M['valve'], M['act'])))
    L('bleed10').duct(core, [(1.8, 332, 0.0), (1.8, 332, 0.08), (1.8, 352, 0.08), (1.62, 358, 0.1), (1.536, 1, 0.16)], 0.04, M['duct'], M['flange'],
           rb=0.06, joints=(0.22, 0.78), ports=(True, False), port_mat=M['boss'], valves=((0.5, 0.11, 1.35, M['valve'], M['act']),))

    # ================================================================== ACTIVE CLEARANCE CONTROL
    # Fan air, metered by the two ACC valves, is sprayed onto the turbine cases from rings of perforated
    # tube to shrink them onto the blade tips: four rings on the HP turbine, thirteen on the LP turbine,
    # each fed from four axial headers and a collector ring.
    co = lambda x: r_at(P['coreOuter'], x)
    ring_r = lambda x: co(x) + 0.05
    for x in [2.25, 2.29, 2.33, 2.37] + [2.48 + 0.04 * k for k in range(13)]:
        C.ring(x, ring_r(x), 0.0065, M['acc'])
    for x, rr in ((2.405, 0.013), (2.44, 0.016)):
        C.ring(x, co(x) + 0.076, rr, M['acc'])
    for x0, x1, xs in ((2.24, 2.405, [2.25, 2.29, 2.33, 2.37]), (2.44, 2.97, [2.48 + 0.04 * k for k in range(13)])):
        for th in (45, 135, 225, 315):
            C.tubes(ring_r, [(x0, th, 0.026), (x1, th, 0.026)], n=1, radius=0.011, mat=M['acc'], rb=0.03)
            for x in xs:   # a short riser from the header into every ring, with a union nut
                a = cyl_to_blender(x, th, ring_r(x)); b = cyl_to_blender(x, th, ring_r(x) + 0.026); m = a.lerp(b, 0.45)
                C._put(th, lambda acc, a=a, b=b, m=m: (acc.cyl(a, b, 0.0045, M['acc'], 8), acc.cyl(m - (b - a).normalized() * 0.004, m + (b - a).normalized() * 0.004, 0.0075, M['nut'], 6)))
            for x in (x0 + 0.03, (x0 + x1) / 2, x1 - 0.03):   # header brackets down to the case
                q = cyl_to_blender(x, th, co(x) + 0.03); r2 = cyl_to_blender(x, th, ring_r(x) + 0.026)
                C._put(th, lambda acc, q=q, r2=r2: acc.cyl(q, r2, 0.005, M['brk'], 6))
    # supply ducts from the ACC valves (procedural units on the core at x 2.08-2.32) down to the collector rings
    L('accduct').duct(core, [(2.32, 236, 0.066), (2.36, 236, 0.066), (2.405, 236, -0.008)], 0.028, M['acc'], M['flange'], rb=0.03)
    L('accduct').duct(core, [(2.32, 250, 0.066), (2.38, 250, 0.066), (2.44, 250, -0.008)], 0.032, M['acc'], M['flange'], rb=0.03)
    # buffer air: HPC stage 12 -> air-cooled air cooler -> No. 4 compartment
    L('bufferair').duct(core, [(1.84, 158, 0.04), (2.0, 158, 0.06), (2.15, 152, 0.13), (2.215, 152, 0.135)], 0.018, M['duct'], M['flange'], rb=0.06, joints=(0.5,))   # into the buffer air cooler
    # sense lines along the HPC (P3 to the EEC via the bifurcation, No. 4 bearing pressure)
    T(C, core, [(1.42, 179, hc + 0.06), (1.9, 186, hc + 0.06), (1.9, 230, hc + 0.06), (2.0, 232, 0.05)], n=3, d=0.01, radius=0.0025, mat='cad', rb=0.03)

    # ================================================================== more real core lines (hand-routed from the references)
    # Stage 2.5 booster bleed valve actuators (NTSB ENG14IA028 photos 3-5 and 18-19; Airbus TTM 'compressor airflow
    # control'): a master on the left above the VSV actuator and a slave on the right, on the intermediate case, each
    # worked by servo fuel through an extend and a retract line from the FMU group at the bifurcation.
    for th, tag in ((128, 'master'), (232, 'slave')):
        xa, ha = 1.02, 0.03
        p0 = cyl_to_blender(xa - 0.07, th, core(xa) + ha); p1 = cyl_to_blender(xa + 0.07, th, core(xa) + ha)
        rod = cyl_to_blender(xa + 0.13, th, core(xa) + ha)
        def act(a, p0=p0, p1=p1, rod=rod, th=th, xa=xa, ha=ha):
            a.cyl(p0, p1, 0.024, M['act'], 18); a.cyl(p1, rod, 0.008, M['fitting'] if 'fitting' in M else M['nut'], 10)
            for q in (p0, rod): a.cyl(q - (p1 - p0).normalized() * 0.008, q + (p1 - p0).normalized() * 0.008, 0.012, M['brk'], 12)   # rod-end and mount lugs
            for k in (0.25, 0.75):   # extend / retract ports
                b = p0.lerp(p1, k); c = cyl_to_blender(xa - 0.07 + 0.14 * k, th, core(xa) + ha + 0.034)
                a.cyl(b, c, 0.0045, M['nut'], 6)
        C._put(th, act)
        sgn = -1 if th < 180 else 1
        for k, dth in enumerate((-1.5, 1.5)):
            xk = xa - 0.035 + 0.07 * k
            T(L('servofuel'), core, [(xk, th + dth * 0.3, ha + 0.034), (xk, th + dth, 0.075), (1.2, th + sgn * 8 + dth, 0.075), (1.32, 180 + sgn * (6 + 2 * k), 0.03), (1.36, 180 + sgn * (3 + k), 0.022)],
              n=1, radius=0.003, mat='cad', rb=0.04, every=0.16)
    # No. 5 bearing oil pressure and scavenge tubes (IAE SB V2500-ENG-72-0660; NTSB ENG14IA001 photo 9): from the
    # bifurcation aft along the bottom of the turbine cases, outside the clearance-control rings, into the exhaust case
    # struts at 166 and 194 deg
    for th_end, r, th_lane in ((166.15, 0.0065, 176.0), (193.85, 0.0095, 184.0)):
        T(C, core, [(2.0, th_lane, 0.03), (2.2, th_lane, 0.085), (2.98, th_lane, 0.085), (3.03, th_end, 0.06), (3.06, th_end, 0.0)],
          n=1, radius=r, mat='ss', rb=0.06, every=0.18, boss=(False, True))
    # HP valve and pressure regulating valve sense lines, up beside the bleed ducts to the pylon (NTSB photos 15-16, 47-49)
    for x0, th0, dth in ((1.58, 36.0, 4.0), (1.8, 326.0, -4.0), (1.66, 18.0, 3.0)):
        T(C, core, [(x0, th0, 0.0), (x0, th0, 0.05), (x0 - 0.04, th0 - dth * 3, 0.1), (1.54, 6.0 + dth, 0.22), (1.54, 6.0 + dth, 0.52)],
          n=1, radius=0.003, mat='ss', rb=0.04, every=0.15, boss=(True, False))
    # No. 4 bearing compartment air-oil spill line (NTSB photo 10): down to the bifurcation beside the oil feed
    T(C, core, [(1.94, 168.0, 0.0), (1.9, 170.0, 0.04), (1.62, 176.0, 0.035), (1.5, 179.0, 0.022)], n=1, radius=0.006, mat='ss', rb=0.05, boss=(True, False))
    # core accessory drains (MTU familiarization, combined drains): FDV, VSV actuator, ACC actuator and fuel manifold drains
    # down to a drain collector at the lower bifurcation, from which the combined drain runs forward to the drain mast
    coll = (1.42, 180.0)
    for A in ((1.775, 312.0, 0.07), (1.2, 146.0, 0.06), (2.06, 280.0, 0.09), (1.98, 196.0, 0.03), (2.02, 164.0, 0.03)):
        sgn = 1 if A[1] > 180 else -1
        T(C, core, [A, (A[0], A[1], 0.03), (min(A[0], 1.9), 180 + sgn * 9, 0.028), (coll[0] + 0.03, coll[1] + sgn * 2.5, 0.022)], n=1, radius=0.0028, mat='ss', rb=0.03, every=0.14)
    C._put(180.0, lambda a: a.box(cyl_to_blender(coll[0], coll[1], core(coll[0]) + 0.02), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)), 0.05, 0.04, 0.025, M['act']))
    # P4.9 (EPR) rake sense lines from the exhaust case struts forward to the bifurcation (Airbus TTM EPR indicating)
    for k, th0 in enumerate((166.0, 249.0, 83.0)):
        lane = 172.0 + 1.6 * k if th0 < 180 else 188.0 - 1.6 * k
        T(C, core, [(3.03, th0, 0.0), (3.0, th0, 0.1), (2.96, lane, 0.1), (2.2, lane, 0.1), (2.0, lane, 0.06), (1.9, 180 + (lane - 180) * 0.5, hc + 0.06)],
          n=1, radius=0.0025, mat='cad', rb=0.05, every=0.2, boss=(True, False))

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
    gearbox = lambda x, lo, hi: 0.06 < x < 1.2 and lo < AC.GEARBOX['th1'] + 4 and hi > AC.GEARBOX['th0'] - 4   # gearbox and its units
    oiltank = lambda x, lo, hi: 0.38 < x < 0.66 and lo < 148 and hi > 119
    route_fan = packer(FAN_BAYS, (0.012, 0.024, 0.036), 0.05, [gearbox, oiltank])
    RH = [(0.765, 298, 0.045), (0.765, 304, 0.045), (0.765, 310, 0.045), (0.27, 300, 0.05), (0.27, 308, 0.05), (0.6, 281, 0.06), (0.66, 281, 0.06),
          (0.55, 266, 0.05), (0.64, 266, 0.05), (0.72, 266, 0.05), (0.81, 266, 0.05), (0.7, 256, 0.05), (0.79, 256, 0.05), (0.74, 232, 0.07), (1.06, 244, 0.07),
          sav_plug, (0.5, 213, 0.11), (0.7, 213, 0.11), (0.62, 326, 0.1), (1.0, 346, 0.08), (0.26, 250, 0.01), (1.17, 214, 0.02), (1.17, 236, 0.02),
          (1.17, 268, 0.02), (1.17, 296, 0.02), (1.17, 320, 0.02), (1.17, 190, 0.02), (1.17, 200, 0.02), (0.05, 300, 0.03), (0.05, 340, 0.03)]
    LH = [(0.36, 146.5, 0.1), (0.72, 146.5, 0.1), (0.4, 128, 0.13), (0.64, 138, 0.13), (0.95, 120, 0.08), (1.09, 126, 0.08), (1.02, 140, 0.09), (0.88, 100, 0.06),
          (1.08, 100, 0.06), (0.6, 48, 0.05), (0.66, 54, 0.05), (0.3, 6, 0.04), (0.4, 34, 0.06), (0.4, 46, 0.06), (0.3, 70, 0.07), (0.8, 60, 0.05), (1.13, 10, 0.14),
          (1.13, 18, 0.14), (1.17, 30, 0.02), (1.17, 60, 0.02), (1.17, 90, 0.02), (1.17, 120, 0.02), (1.17, 150, 0.02), (1.17, 170, 0.02), (1.17, 160, 0.02),
          (0.05, 20, 0.03), (0.05, 90, 0.03), (0.05, 150, 0.03), (0.36, 150, 0.1), (0.785, 159.5, 0.05)]
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
            T(D, fan, way, n=n, d=d, radius=r, mat=rng.choice(mats), rb=0.025 + 0.004 * n, every=0.2 + rng.uniform(0, 0.06),
              boss=(A[2] <= 0.031, B[2] <= 0.031))   # low anchors are ports on the fan case itself
            made_n += 1
    # a few more harness branches on each side
    for A, B, r in (((0.765, 302, 0.045), (1.17, 250, 0.02), 0.008), ((0.765, 306, 0.045), sav_plug, 0.006), ((0.27, 304, 0.05), (0.05, 330, 0.03), 0.006),
                    ((0.88, 100, 0.06), (1.17, 80, 0.02), 0.007), ((0.6, 48, 0.05), (1.17, 40, 0.02), 0.006), ((0.36, 150, 0.1), (0.145, 120, 0.03), 0.006)):
        way = route_fan(A, B, 2 * r)
        if way: H(D, fan, way, radius=r, conn=(True, True))

    # core: same treatment between the core components, below the core cowl
    CORE_BAYS = [1.43, 1.7, 2.1, 2.32]
    vsv = lambda x, lo, hi: x < 1.39
    units = [lambda x, lo, hi: 1.44 < x < 1.69 and lo < 248 and hi > 214,      # ignition exciters
             lambda x, lo, hi: 1.75 < x < 1.88 and lo < 328 and hi > 308,      # fuel distribution valve
             lambda x, lo, hi: 1.98 < x < 2.34 and lo < 258 and hi > 228,      # clearance-control valves
             lambda x, lo, hi: 2.2 < x < 2.47 and lo < 162 and hi > 142]       # buffer air cooler
    route_core = packer(CORE_BAYS, (0.02, 0.034, 0.048, 0.062), 0.075, [vsv] + units)
    CA = [(1.55, 254, 0.05), (1.55, 296, 0.05), (1.75, 280, 0.05), (1.55, 132, 0.05), (1.36, 140, 0.07), (1.8, 141, 0.06), (1.76, 312, 0.06), (2.08, 284, 0.06),
          (2.2, 236, 0.07), (2.2, 250, 0.07), (2.3, 152, 0.06), (2.6, 190, 0.02), (1.45, 222, 0.04), (1.45, 240, 0.04), (2.0, 232, 0.05), (2.0, 166, 0.03),
          (1.45, 180, 0.03), (1.6, 180, 0.03), (1.75, 180, 0.03), (1.9, 182, 0.04), (2.02, 200, 0.04), (2.02, 140, 0.04), (2.25, 210, 0.05), (2.25, 120, 0.05),
          (2.5, 220, 0.03), (2.5, 140, 0.03), (1.6, 220, 0.04), (1.6, 300, 0.04), (1.95, 260, 0.05), (1.95, 300, 0.05)]
    # (the 34 packed filler runs that were here routed every tube as circumferential-then-axial steps, which read as
    # zigzags round the core: removed. The core carries its named services - fuel, oil, harnesses A and B, ignition
    # leads, EGT harness, bleed and cooling ducts - from the routes above.)

    # ================================================================== flexible hoses
    D.hose([(1.0, 3.5, 0.945), (1.09, 4.5, 0.97), (1.14, 5.0, 1.03)], 0.011, M['fire'], M['nut'])   # HCU pressure hose, up into the pylon between the hinge lines
    D.hose([(1.13, 356, 0.92), (1.12, 2, 0.98), (1.15, 8, 1.0)], 0.009, M['fire'], M['nut'])

    D.finish(link, made); C.finish(link, made)
    for dr in LINES.values(): dr.finish(link, made)
    return ['line_' + k for k in LINES]
