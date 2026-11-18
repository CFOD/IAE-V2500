"""Units on the core engine, under the core cowl: ignition exciters, the VSV actuator with its crank shaft,
the fuel distribution valve, the two clearance-control valves with their actuator, and the buffer air
cooler. Each is a component of its own (node prefix = component id in model.json).

Placement follows the earlier procedural layout and the component-location booklet: VSV actuator low on
the left of the HP compressor, exciters on the right of it clear of the handling bleed valves, fuel
distribution valve high on the right in front of the fuel manifold, clearance-control valves low on the
right of the turbine cases, buffer air cooler low on the left. Everything stays inside the core cowl
(inner fixed structure, r = bypInner) and outside the cutaway sector.
"""
import math
from mathutils import Matrix, Vector
from accessories import Kit, frame, materials, side


def build_core_units(H, made, P, r_at, bevel=0.001):
    M = materials(H)
    co = lambda x: r_at(P['coreOuter'], x)
    case = lambda x: co(x) + 0.026                  # outer skin of the core casings
    U = {}

    # ---------------------------------------------------------------- ignition exciters (2)
    ex = []
    for th in (222, 240):
        K = Kit(H, frame(H, 1.46, th, co(1.55) + 0.075))
        z_case = case(1.55) - (co(1.55) + 0.075)
        K.box('ex', (0.09, 0, z_case + 0.012), (0.2, 0.11, 0.006), M['steel'])                      # mounting plate on the case bracket
        for ax in (0.02, 0.16):
            for ay in (-0.04, 0.04):
                K.cyl('ex', (ax, ay, z_case + 0.015), (ax, ay, -0.028), 0.009, 0.009, M['dark'], seg=14)   # anti-vibration mounts
        K.loft('ex', [(0.0, 0, 0.0, 0.04, 0.026), (0.006, 0, 0.0, 0.047, 0.03), (0.174, 0, 0.0, 0.047, 0.03), (0.18, 0, 0.0, 0.04, 0.026)], M['gold'], e=0.3)
        for k in range(7):                                                                           # cooling ribs
            K.box('ex', (0.03 + 0.02 * k, 0, 0.032), (0.004, 0.084, 0.006), M['gold'])
        K.connector('ex', (0.0, 0.012, 0.0), (-1, 0, 0), M)                                          # 115 V input
        K.hexa('ex', (0.18, 0, 0.0), (0.196, 0, 0.0), 0.012, M['nut'])                              # high-tension output
        K.cyl('ex', (0.196, 0, 0.0), (0.206, 0, 0.0), 0.009, 0.009, M['steel'], seg=16)
        K.plate('ex', (0.09, -0.0475, 0.0), (0.05, 0.002, 0.03), M)
        ex += K.objs
    U['exciters'] = ex

    # ---------------------------------------------------------------- VSV actuator, crank shaft and links to the unison rings
    rings = [1.148, 1.218, 1.286, 1.354]
    rc = 0.398                                                                                         # crank shaft radius
    C = Kit(H, frame(H, rings[0], 150, rc))
    C.cyl('va', (-0.03, 0, 0), (0.262, 0, 0), 0.01, 0.01, M['steel'], seg=16)                         # crank shaft
    for a in (-0.02, 0.24):                                                                            # bearing brackets down to the case
        zc = case(rings[0] + a) - rc
        C.ring('va', a - 0.008, a + 0.008, 0.01, 0.018, M['cast'], seg=20)
        C.box('va', (a, 0, (zc - 0.012) / 2), (0.016, 0.028, -zc - 0.012), M['cast'])
    for x in rings:                                                                                    # crank arm and link rod to each ring
        a = x - rings[0]; ztop = co(x) + 0.074 - rc
        C.box('va', (a, -0.018, 0.0), (0.008, 0.036, 0.012), M['steel'])
        C.cyl('va', (a, -0.034, 0.0), (a, -0.034, ztop + 0.004), 0.004, 0.004, M['steel'], seg=10)
        for z in (0.0, ztop + 0.004): C.cyl('va', (a - 0.007, -0.034, z), (a + 0.007, -0.034, z), 0.006, 0.006, M['nut'], seg=12)   # rod-end bearings
    yA = side(138, 150, 0.43)                                                                          # where the actuator sits, seen from the crank
    C.box('va', (0.25, yA * 0.45, 0.0), (0.01, abs(yA) * 0.9, 0.014), M['steel'])                           # bellcrank arm towards the actuator
    A = Kit(H, frame(H, 1.17, 138, 0.43))
    A.rev('va', [(0.0, 0.022), (0.02, 0.03), (0.03, 0.034), (0.15, 0.034), (0.16, 0.03), (0.165, 0.016)], M['gold'], seg=32)
    A.cyl('va', (0.165, 0, 0), (0.212, 0, 0), 0.009, 0.009, M['steel'], seg=16)                        # piston rod
    A.box('va', (0.218, 0, 0), (0.016, 0.02, 0.012), M['steel'])                                       # rod-end clevis
    p_arm = Vector(frame(H, rings[0], 150, rc).inverted() @ Vector(frame(H, 1.17, 138, 0.43) @ Vector((0.222, 0, 0))))
    C.pipe('va', [tuple(p_arm), tuple(p_arm.lerp(Vector((0.25, yA * 0.9, 0.0)), 0.5)), (0.25, yA * 0.9, 0.0)], 0.005, M['steel'])   # link to the bellcrank
    for sgn in (1, -1): A.cyl('va', (0.035, sgn * 0.034, 0), (0.035, sgn * 0.05, 0), 0.008, 0.008, M['steel'], seg=12)   # trunnion pins
    zc = case(1.2) - 0.43
    for sgn in (1, -1): A.box('va', (0.035, sgn * 0.052, (zc + 0.0) / 2), (0.022, 0.008, -zc + 0.01), M['cast'])        # trunnion bracket
    A.cyl('va', (0.04, -0.03, 0.026), (0.14, -0.03, 0.026), 0.009, 0.009, M['gold'], seg=14)          # LVDT position sensor
    A.connector('va', (0.04, -0.03, 0.026), (-1, 0, 0), M, size=0.6)
    yS = side(140, 138, 0.46)                                                                          # servo fuel (dressing.py ends here)
    for a in (0.12, 0.142): A.fitting('va', (a, yS, 0.03), (0, 0, 1), 0.0035, M)
    U['vsvact'] = C.objs + A.objs

    # ---------------------------------------------------------------- fuel distribution valve
    rF = co(1.86) + 0.13
    F = Kit(H, frame(H, 1.775, 318, rF))
    F.rev('fd', [(0.0, 0.026), (0.01, 0.042), (0.02, 0.05), (0.075, 0.05), (0.085, 0.044), (0.085, 0.04)], M['gold'], seg=36)
    F.bolts('fd', (0.02, 0, 0), (-1, 0, 0), 0.046, 8, 0.003, 0.004, M['nut'])
    F.fitting('fd', (0.0, 0, 0), (-1, 0, 0), 0.009, M)                                                 # metered fuel in (from the FMU)
    for k in range(10):                                                                                # ten outlets to the pigtails
        t = k * 0.63; y = side(318 + 4 * math.sin(t), 318, rF); z = 0.03 * math.cos(t)
        F.hexa('fd', (0.085, y, z), (0.095, y, z), 0.005, M['nut'])
    F.fitting('fd', (0.045, 0, 0.05), (0, 0, 1), 0.004, M, cap=M['red'])                              # bleed / test port
    zc = case(1.82) - rF
    for a in (0.02, 0.065): F.box('fd', (a, 0, (zc - 0.04) / 2), (0.012, 0.04, -zc - 0.04), M['cast'])   # bracket legs to the case
    F.plate('fd', (0.045, -0.0505, 0), (0.03, 0.002, 0.02), M)
    U['fdv'] = F.objs

    # ---------------------------------------------------------------- clearance-control valves and actuator
    av = []
    for th, rr in ((236, 0.045), (250, 0.05)):
        V = Kit(H, frame(H, 2.08, th, 0.465))
        k = rr / 0.05
        V.rev('ac', [(0.0, rr + 0.01), (0.012, rr + 0.01), (0.012, rr), (0.06, rr + 0.004), (0.18, rr + 0.004), (0.228, rr), (0.228, rr + 0.01), (0.24, rr + 0.01)], M['cast'], seg=36)
        V.cyl('ac', (0.12, -rr - 0.004, 0), (0.12, -rr - 0.03, 0), 0.016, 0.016, M['cast'], seg=18)   # butterfly shaft boss
        V.box('ac', (0.12, -rr - 0.045, 0.0), (0.06, 0.03, 0.05), M['gold'])                            # rotary actuator
        V.connector('ac', (0.09, -rr - 0.045, 0.0), (-1, 0, 0), M, size=0.6)
        V.box('ac', (0.12, -rr - 0.004, rr * 0.8), (0.012, 0.01, 0.03), M['steel'])                      # position indicator lever
        for a in (0.006, 0.234): V.bolts('ac', (a, 0, 0), (1, 0, 0), rr + 0.006, 8, 0.0028, 0.004, M['nut'])
        zi = 0.042                                                                                       # fan-air inlet up to a scoop in the core cowl
        V.pipe('ac', [(0.0, 0, 0), (-0.05, 0, 0.0), (-0.09, 0, zi * 0.6), (-0.1, 0, zi)], rr * 0.9, M['steel'])
        V.ring('ac', -0.004, 0.004, rr * 0.9, rr * 0.9 + 0.018, M['vband'], origin=(-0.1, 0, zi - 0.004), axis=(0, 0, 1))
        av += V.objs
    Ac = Kit(H, frame(H, 2.06, 286, co(2.12) + 0.14))                                                    # ACC actuator (fuel-operated)
    Ac.loft('ac', [(0.0, 0, 0.0, 0.032, 0.024), (0.008, 0, 0.0, 0.038, 0.03), (0.112, 0, 0.0, 0.038, 0.03), (0.12, 0, 0.0, 0.032, 0.024)], M['gold'], e=0.35)
    for a in (0.02, 0.05): Ac.fitting('ac', (a, 0.0, 0.03), (0, 0, 1), 0.0035, M)                       # servo fuel in / out
    Ac.connector('ac', (0.12, 0.0, 0.0), (1, 0, 0), M, size=0.6)
    Ac.cyl('ac', (0.08, -0.038, 0.0), (0.08, -0.06, 0.0), 0.01, 0.01, M['steel'], seg=14)              # output shaft
    zc = case(2.12) - (co(2.12) + 0.14)
    for a in (0.02, 0.1): Ac.box('ac', (a, 0, (zc - 0.024) / 2), (0.014, 0.05, -zc - 0.024), M['cast'])
    U['accvalves'] = av + Ac.objs

    # ---------------------------------------------------------------- buffer air cooler (air-to-air)
    B = Kit(H, frame(H, 2.22, 152, 0.465))
    B.box('ba', (0.12, 0, 0), (0.17, 0.13, 0.06), M['steel'])                                          # core
    for k in range(34): B.box('ba', (0.04 + 0.0048 * k, 0, 0.0), (0.0016, 0.134, 0.064), M['cast'])     # fin plates
    for a, sgn in ((0.03, -1), (0.21, 1)):                                                             # headers
        B.cyl('ba', (a, -0.068, 0), (a, 0.068, 0), 0.034, 0.034, M['cast'], seg=24)
        for y in (-0.068, 0.068): B.cyl('ba', (a, y, 0), (a, y + (0.004 if y > 0 else -0.004), 0), 0.036, 0.036, M['cast'], seg=24)
    B.pipe('ba', [(0.03, 0.0, 0.0), (-0.005, 0.0, 0.0)], 0.02, M['steel'])                            # hot air in (from the HPC, dressing.py)
    B.pipe('ba', [(0.21, 0.0, -0.02), (0.25, 0.0, -0.035), (0.27, 0.0, -0.06)], 0.018, M['steel'])     # cooled air out to the No. 4 chamber
    B.rev('ba', [(0.0, 0.03), (0.04, 0.05)], M['steel'], origin=(0.12, 0, 0.03), axis=(0, 0, 1), seg=28)   # fan-air scoop duct up to the cowl
    zc = case(2.3) - 0.465
    for a in (0.05, 0.19): B.box('ba', (a, 0, (zc - 0.03) / 2), (0.012, 0.09, -zc - 0.03), M['cast'])
    U['acac'] = B.objs

    # ---------------------------------------------------------------- EGT junction box (on stand-offs above the LPT spray rings)
    E = Kit(H, frame(H, 2.58, 186, 0.487))
    E.loft('eg', [(0.0, 0, 0.0, 0.036, 0.012), (0.006, 0, 0.0, 0.042, 0.015), (0.114, 0, 0.0, 0.042, 0.015), (0.12, 0, 0.0, 0.036, 0.012)], M['gold'], e=0.3)
    E.box('eg', (0.06, 0, 0.0165), (0.1, 0.07, 0.003), M['steel'])                                   # cover
    for a in (0.02, 0.1):
        for y in (-0.03, 0.03): E.cyl('eg', (a, y, -0.012), (a, y, case(2.62) - 0.487), 0.004, 0.004, M['steel'], seg=8)   # stand-offs
    E.connector('eg', (0.0, 0.0, 0.0), (-1, 0, 0), M, size=0.7)                                       # signal out (to the EEC harness)
    for k, y in enumerate((-0.024, -0.008, 0.008, 0.024)):                                           # thermocouple leads in, from the probes
        E.hexa('eg', (0.12, y, 0.0), (0.128, y, 0.0), 0.004, M['nut'])
        E.pipe('eg', [(0.128, y, 0.0), (0.2, y * 1.4, -0.006), (0.33, y * 2.0, -0.02)], 0.0028, M['steel'])
    U['egtbox'] = E.objs

    for comp, objs in U.items():
        made.append(H.finish(H.join(comp + '_body', objs), bevel))
    return list(U)


def build_mounts(H, made, P, r_at, in_cut, bevel=0.0015):
    """Engine mounts. Front: a fitting on top of the fan frame, two links with spherical bearings up to the
    pylon's front mount beam, and a shear pin. Rear: a beam on the turbine case top with two links up through
    the upper bifurcation to the pylon's aft fitting. Both sit in the cutaway sector, so they are shown with
    the cutaway closed (node suffix __full)."""
    M = materials(H)
    co = lambda x: r_at(P['coreOuter'], x)
    F = Kit(H, frame(H, 1.12, 0, 0.88))
    F.box('mf', (0, 0, 0), (0.15, 0.3, 0.03), M['cast'])                                  # base fitting on the fan frame
    for bx in (-0.055, 0.055):                                                             # two rows of bolts through the base
        for by in (-0.125, -0.07, 0.07, 0.125): F.hexa('mf', (bx, by, 0.015), (bx, by, 0.023), 0.006, M['nut'])
    for sy in (-1, 1):
        F.box('mf', (0, sy * 0.105, 0.04), (0.07, 0.022, 0.05), M['cast'])                # clevis lugs
        a, b = Vector((0, sy * 0.105, 0.05)), Vector((0, sy * 0.045, 0.105))
        F.cyl('mf', a, b, 0.014, 0.014, M['steel'], seg=14)                                # link
        for q in (a, b): F.ring('mf', -0.012, 0.012, 0.012, 0.022, M['steel'], origin=q, axis=(1, 0, 0), seg=16)   # spherical bearings
    F.cyl('mf', (0, 0, 0.015), (0, 0, 0.1), 0.024, 0.02, M['steel'], seg=18)              # shear pin
    F.box('mf', (0, 0, 0.115), (0.14, 0.15, 0.03), M['steel'])                             # pylon front mount beam
    R = Kit(H, frame(H, 2.85, 0, co(2.85) + 0.07))
    R.box('mr', (0, 0, 0), (0.1, 0.24, 0.014), M['cast'])                                  # rear mount beam on the turbine case
    for sy in (-1, 1):
        R.box('mr', (0, sy * 0.04, 0.02), (0.06, 0.016, 0.03), M['cast'])
        a, b = Vector((0, sy * 0.04, 0.03)), Vector((0, sy * 0.022, 0.17))
        R.cyl('mr', a, b, 0.011, 0.011, M['steel'], seg=12)
        for q in (a, b): R.ring('mr', -0.01, 0.01, 0.009, 0.017, M['steel'], origin=q, axis=(1, 0, 0), seg=14)
    R.box('mr', (0, 0, 0.185), (0.12, 0.1, 0.03), M['steel'])                              # pylon aft fitting
    made.append(H.finish(H.join('mounts_front__full', F.objs), bevel))
    made.append(H.finish(H.join('mounts_rear__full', R.objs), bevel))
    return ['mounts']
