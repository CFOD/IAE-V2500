"""The A320 around the engine, for the apron scene: app/models/apron.glb (loaded only when the apron is shown).

Run:  python3 tools/blender/apron.py

Frame as build_engine.py: metres, engine axis +X (aft), fan face at x = 0; Blender (x, -z_side, y_up). The
engine is No. 1 on the left wing, so the aircraft's left (+z in the simulator) is outboard and the fuselage
centreline is 5.75 m to the right of the engine. The ground is 1.87 m below the engine axis (nacelle low point
0.76 m above it, Airbus AC 2-3-0).

Dimensions from the Airbus A320 Aircraft Characteristics (AC) and the published three-view: overall length
37.57 m, fuselage 3.95 m wide and 4.14 m high, wing span 34.10 m (wingtip fences), 25 degrees of sweep at
quarter chord, 5.1 degrees of dihedral, root chord about 6.1 m and tip chord about 1.5 m with the trailing-edge
kink outboard of the engine; main gear track 7.59 m, wheelbase 12.64 m, 46 x 17 R20 main tyres and 30 x 8.8 R15
nose tyres; tailplane span 12.45 m; height 11.76 m. Where the drawings give no figure (exact window and door
stations, flap-track positions) the values are read off the three-view and are approximate.
"""
import bpy, bmesh, math, os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from build_engine import material, link

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'models')
GY = -1.87                       # ground (engine frame y)
ZF = -5.75                       # fuselage centreline (engine frame z)
X_NOSE = -11.96                  # nose: the inlet lip is about 11 m aft of it
L = 37.57
X_MLG, X_NLG = X_NOSE + 17.71, X_NOSE + 5.07
YC = GY + 3.7                    # fuselage centreline height


def B(x, y, z):
    """Engine frame (x, y_up, z_side) -> Blender."""
    return (x, -z, y)


def mesh(name, bm, mats, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for p in me.polygons: p.use_smooth = smooth
    o = link(bpy.data.objects.new(name, me))
    return o


def grid(name, rows, mat, closed_u=False, cap=True, smooth=True, sharp_deg=None):
    """Surface through rows of points (each row a list of Blender xyz); rows are joined in order."""
    bm = bmesh.new(); vs = [[bm.verts.new(p) for p in r] for r in rows]; n = len(rows[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n if closed_u else n - 1):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap and closed_u:
        for r in (vs[0], vs[-1]):
            if len(set(v.co.to_tuple(5) for v in r)) > 2: bm.faces.new(r)
    o = mesh(name, bm, [mat], smooth)
    if sharp_deg: o.data.set_sharp_from_angle(angle=math.radians(sharp_deg))
    return o


def join(name, objs):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = o.data.name = name
    return o


def cyl(name, a, b, r, mat, seg=24, r2=None):
    from mathutils import Vector, Matrix
    a, b = Vector(a), Vector(b); d = b - a
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4(), verts=bm.verts)
    return mesh(name, bm, [mat])


def box(name, c, size, mat, rot=None):
    from mathutils import Matrix
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    m = Matrix.Translation(c) @ (rot or Matrix.Identity(4))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return mesh(name, bm, [mat], smooth=False)


def revolve_y(name, loop, centre, mat, seg=48):
    """Body of revolution about a Blender-Y axis through centre (wheels, hubs): loop of (r, dy)."""
    bm = bmesh.new()
    cx, cy, cz = centre
    first = [bm.verts.new((cx + r, cy + dy, cz)) for r, dy in loop]
    es = [bm.edges.new((first[i], first[(i + 1) % len(first)])) for i in range(len(first))]
    bmesh.ops.spin(bm, geom=first + es, cent=centre, axis=(0, 1, 0), angle=2 * math.pi, steps=seg, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    o = mesh(name, bm, [mat]); o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


# ====================================================================== fuselage
def fus_shape(x):
    """Half-width, half-height and centre height of the fuselage section at x."""
    t = x - X_NOSE
    W, H, dy = 1.975, 2.07, 0.0
    if t < 6.2:     # nose: blunt ogive, tip below the centreline
        f = t / 6.2; k = (1 - (1 - f) ** 2.2) ** 0.55
        W *= k; H *= k; dy = -0.62 * (1 - f) ** 1.6
    elif t > 25.5:  # tail cone: shrinks and sweeps up to the APU exhaust
        f = (t - 25.5) / (L - 25.5); k = 1 - 0.88 * f ** 1.15
        W *= k; H *= 1 - 0.86 * f ** 1.0; dy = 1.55 * f ** 1.3
    return W, H, dy


def fus_point(x, phi):
    """phi: angle round the section from the top, positive towards the aircraft's left (+z)."""
    W, H, dy = fus_shape(x)
    s, c = math.sin(phi), math.cos(phi)
    e = 2.15   # slightly squarer than a circle
    sx = math.copysign(abs(s) ** (2 / e), s); cy = math.copysign(abs(c) ** (2 / e), c)
    return B(x, YC + dy + H * cy, ZF + W * sx)


def fus_off(x, phi, d):
    """fus_point pushed out (d > 0) along the section's outward normal."""
    W, H, dy = fus_shape(x); px, py, pz = fus_point(x, phi)
    ny, nz = py - (-ZF), pz - (YC + dy); l = math.hypot(ny, nz) + 1e-9
    return (px, py + ny / l * d, pz + nz / l * d)


def phi_at(x, h, side):
    """Angle round the section (from the top) of the point at height h above the centreline, on one side."""
    W, H, dy = fus_shape(x); c = max(-1.0, min(1.0, (h - dy) / H))
    # invert the superellipse's vertical term (exponent 2.15): cos(phi) = sign * |c| ** (2.15 / 2)
    return side * math.acos(math.copysign(abs(c) ** (2.15 / 2), c))


def build_fuselage(M):
    xs = [X_NOSE + L * (i / 120) ** 1.0 for i in range(121)]
    xs = sorted(set([X_NOSE + 0.0005] + [X_NOSE + L * ((i / 30) ** 2) * 0.17 for i in range(31)] + xs[1:]))
    n = 64
    rows = [[fus_point(x, 2 * math.pi * j / n) for j in range(n)] for x in xs]
    body = grid('ac_fuselage', rows, M['paint'], closed_u=True)
    # grey belly fairing under the wing root: the lower fuselage bulges out round the wing box
    brow = []
    for i in range(41):
        x = X_NOSE + 8.9 + 13.8 * i / 40
        f = min(1, max(0, (x - (X_NOSE + 9.2)) / 2.0)) * min(1, max(0, ((X_NOSE + 22.4) - x) / 2.6))
        brow.append([fus_off(x, math.pi * (0.6 + 0.8 * j / 16), 0.012 + 0.3 * f * math.sin(math.pi * j / 16) ** 0.7) for j in range(17)])
    fair = grid('ac_bellyfairing', brow, M['belly'])
    # windows: a row each side (A320 window pitch 0.533 m), with the overwing exits and doors left out
    wins = []
    xw = [X_NOSE + 6.9 + 0.533 * k for k in range(42)]
    skip = lambda x: abs(x - (X_NOSE + 16.4)) < 0.75 or abs(x - (X_NOSE + 17.3)) < 0.3 or x > X_NOSE + 29.6
    for side in (1, -1):
        for x in xw:
            if skip(x): continue
            wins.append(window(x, side * 1.335, 0.115, 0.165, M['window']))
    # cockpit windows
    for side in (1, -1):
        for k, (a, b) in enumerate(((0.25, 0.62), (0.68, 1.02), (1.08, 1.32))):
            wins.append(cockpit_pane(side, a, b, M['window']))
    winobj = join('ac_windows', wins)
    # door outlines and the overwing exits
    lines = []
    for side in (1, -1):
        for x0, x1, top, bot in ((X_NOSE + 2.35, X_NOSE + 3.2, 0.95, -0.95), (X_NOSE + 15.95, X_NOSE + 16.5, 0.55, -0.35), (X_NOSE + 16.95, X_NOSE + 17.5, 0.55, -0.35),
                                 (X_NOSE + 30.1, X_NOSE + 30.95, 0.95, -0.95)):
            lines.append(outline_fus(x0, x1, top, bot, side, M['line']))
        lines.append(outline_fus(X_NOSE + 6.4, X_NOSE + 8.2, -1.0, -1.75, side, M['line']))      # forward cargo door
        lines.append(outline_fus(X_NOSE + 24.0, X_NOSE + 25.8, -1.0, -1.75, side, M['line']))    # aft cargo door
    lineobj = join('ac_doorlines', lines)
    return [body, fair, winobj, lineobj]


def window(x, sy, hw, hh, mat, n=12):
    """Rounded window on the fuselage side, centred 0.36 m above the centreline; sy's sign picks the side."""
    side = 1 if sy > 0 else -1
    bm = bmesh.new(); vs = []
    for k in range(n):
        a = 2 * math.pi * k / n; dx = hw * math.cos(a); dz = math.copysign(min(abs(hh * math.sin(a)), hh * 0.92), math.sin(a))
        vs.append(bm.verts.new(fus_off(x + dx, phi_at(x + dx, 0.36 + dz, side), 0.006)))
    bm.faces.new(vs if side > 0 else list(reversed(vs)))
    return mesh('w', bm, [mat], smooth=False)


def cockpit_pane(side, a, b, mat):
    """A cockpit window between stations a and b (m from the nose start of the panes), on the upper nose."""
    pts = [fus_off(X_NOSE + 2.0 + t, side * (0.55 + 0.42 * (1 - up / 0.4)), 0.006) for t, up in ((a, 0.0), (b, 0.0), (b, 0.38), (a, 0.33))]
    bm = bmesh.new(); bm.faces.new([bm.verts.new(p) for p in pts])
    return mesh('cp', bm, [mat], smooth=False)


def outline_fus(x0, x1, top, bot, side, mat, w=0.012):
    """Thin dark outline of a door on the fuselage side; top/bot: heights above the centreline."""
    objs = []
    def at(x, yv, lift=0.005): return fus_off(x, phi_at(x, yv, side), lift)
    edges = [((x0, top), (x1, top)), ((x1, top), (x1, bot)), ((x1, bot), (x0, bot)), ((x0, bot), (x0, top))]
    bm = bmesh.new()
    for (xa, ya), (xb, yb) in edges:
        n = 8; prev = None
        for i in range(n + 1):
            x = xa + (xb - xa) * i / n; yv = ya + (yb - ya) * i / n
            horiz = abs(yb - ya) < 1e-6
            p = at(x, yv); q = at(x, yv + w) if horiz else at(x + w, yv)
            v = (bm.verts.new(p), bm.verts.new(q))
            if prev: bm.faces.new((prev[0], v[0], v[1], prev[1]))
            prev = v
    return mesh('dl', bm, [mat], smooth=False)


# ====================================================================== wing
TAN_LE = math.tan(math.radians(27.5)); TAN_DI = math.tan(math.radians(5.1))
ETA_K, ETA_T = 6.3, 17.05


def x_le(eta): return 1.55 + (eta - 5.75) * TAN_LE
def x_te(eta): return 5.69 if eta <= ETA_K else 5.69 + (eta - ETA_K) * (3.24 / (ETA_T - ETA_K))
def chord(eta): return x_te(eta) - x_le(eta)
def tc(eta): return 0.155 + (0.115 - 0.155) * min(1, max(0, (eta - 1.98) / (ETA_K - 1.98))) + (0.105 - 0.115) * min(1, max(0, (eta - ETA_K) / (ETA_T - ETA_K)))
def y_ref(eta): return 1.62 + (eta - 5.75) * TAN_DI


def airfoil(xc, t):
    """Upper and lower surface heights (fractions of chord) at xc: NACA thickness with aft camber, a flat top."""
    th = 5 * t * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
    m, p = 0.018, 0.62
    yc = m / p ** 2 * (2 * p * xc - xc ** 2) if xc < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * xc - xc ** 2)
    return yc + th * 0.95, yc - th * 1.05


def wing_point(eta, xc, upper, side=1, lift=0.0):
    c = chord(eta); u, l = airfoil(xc, tc(eta)); h = u if upper else l
    x = x_le(eta) + c * xc; y = y_ref(eta) + c * h + (lift if upper else -lift)
    return B(x, y, ZF + side * eta)


def build_wing(M, side=1, tag='L'):
    etas = [1.2 + (ETA_T - 1.2) * (i / 60) for i in range(61)]
    xcs = [0.5 * (1 - math.cos(math.pi * j / 40)) for j in range(41)]
    up = [[wing_point(e, xc, True, side) for xc in xcs] for e in etas]
    lo = [[wing_point(e, xc, False, side) for xc in reversed(xcs)] for e in etas]
    rows = [u + l[1:-1] for u, l in zip(up, lo)]
    wing = grid(f'ac_wing_{tag}', rows, M['wing'], closed_u=True, sharp_deg=50)
    parts = [wing]
    # wingtip fence: small swept fins above and below the tip
    e = ETA_T; c = chord(e); x0 = x_le(e); y0 = y_ref(e)
    for sgn, hgt in ((1, 0.86), (-1, 0.55)):
        pts = [B(x0 - 0.1, y0, ZF + side * e), B(x0 + c + 0.25, y0, ZF + side * e), B(x0 + c + 0.45, y0 + sgn * hgt, ZF + side * e), B(x0 + c - 0.35, y0 + sgn * hgt, ZF + side * e)]
        bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]; vs2 = [bm.verts.new((p[0], p[1] - side * 0.035, p[2])) for p in pts]
        bm.faces.new(vs); bm.faces.new(list(reversed(vs2)))
        for i in range(4): bm.faces.new((vs[i], vs[(i + 1) % 4], vs2[(i + 1) % 4], vs2[i]))
        parts.append(mesh('fence', bm, [M['wing']], smooth=False))
    nav = cyl('nav', wing_point(ETA_T, 0.02, True, side), wing_point(ETA_T, 0.06, True, side), 0.05, M['navL' if side > 0 else 'navR'], seg=12)
    parts.append(nav)
    fence = join(f'ac_wingtip_{tag}', parts[1:])
    # flap track fairings ("canoes") under the trailing edge
    canoes = []
    for eta in (3.95, 8.1, 10.7, 13.2):
        canoes.append(canoe(eta, side, M['fairing']))
    can = join(f'ac_canoes_{tag}', canoes)
    # panel lines: slat rear edge, spoiler and flap edges, slat / flap / aileron breaks
    pl = []
    for surf in (True, False):
        pl.append(wline([(1.4, 0.135), (ETA_T - 0.4, 0.135)], side, surf, M['line']))
    pl.append(wline([(2.0, 0.74), (ETA_K, 0.74), (13.0, 0.76)], side, True, M['line']))
    pl.append(wline([(2.0, 0.6), (ETA_K, 0.6), (13.0, 0.62)], side, True, M['line']))
    pl.append(wline([(13.0, 0.74), (16.3, 0.74)], side, True, M['line']))
    for eta in (6.6, 9.4, 12.0, 14.6):
        pl.append(wline([(eta, 0.0), (eta, 0.135)], side, True, M['line']))
    for eta in (2.0, ETA_K, 13.0, 16.3):
        pl.append(wline([(eta, 0.74), (eta, 0.995)], side, True, M['line']))
    for k in range(6):
        eta = 3.0 + k * 2.0
        pl.append(wline([(eta, 0.6), (eta, 0.74)], side, True, M['line']))
    lines = join(f'ac_winglines_{tag}', pl)
    return [wing, fence, can, lines]


def wline(path, side, upper, mat, w=0.014, n=24):
    """Thin dark panel line on the wing surface along a path of (eta, x/c) points."""
    bm = bmesh.new(); prev = None
    seg = [(path[i], path[i + 1]) for i in range(len(path) - 1)]
    pts = []
    for (e0, c0), (e1, c1) in seg:
        for i in range(n + (1 if (e1, c1) == path[-1] else 0)):
            f = i / n; pts.append((e0 + (e1 - e0) * f, c0 + (c1 - c0) * f))
    for k, (e, c) in enumerate(pts):
        e2, c2 = pts[min(k + 1, len(pts) - 1)] if k < len(pts) - 1 else pts[k]
        e1_, c1_ = pts[max(k - 1, 0)]
        de, dc = e2 - e1_, (c2 - c1_) * chord(e)
        l = math.hypot(de, dc) + 1e-9
        # offset across the line, in the (eta, chord-distance) plane
        oe, oc = -dc / l * w / 2, de / l * w / 2 / max(0.3, chord(e))
        a = wing_point(e + oe, min(1, max(0, c + oc)), upper, side, 0.004)
        b = wing_point(e - oe, min(1, max(0, c - oc)), upper, side, 0.004)
        v = (bm.verts.new(a), bm.verts.new(b))
        if prev: bm.faces.new((prev[0], v[0], v[1], prev[1]))
        prev = v
    return mesh('pl', bm, [mat], smooth=False)


def canoe(eta, side, mat):
    """Flap-track fairing: a streamlined pod hung under the wing, running past the trailing edge."""
    c = chord(eta); xs0 = x_le(eta) + 0.58 * c; xs1 = x_te(eta) + 1.55
    rows = []
    for i in range(25):
        f = i / 24; x = xs0 + (xs1 - xs0) * f
        xc = min(0.999, (x - x_le(eta)) / c)
        ytop = (wing_point(eta, xc, False, side)[2] if xc < 0.999 else wing_point(eta, 0.999, False, side)[2] + (x - x_te(eta)) * 0.06) + 0.02
        depth = 0.42 * math.sin(math.pi * min(1, f * 1.15) ** 0.8) ** 0.9 + 0.02
        hw = 0.17 * math.sin(math.pi * min(1, f * 1.08)) ** 0.6 + 0.01
        r = []
        for j in range(16):
            a = 2 * math.pi * j / 16
            r.append((x, -(ZF + side * eta) + hw * math.sin(a), ytop - depth * 0.5 * (1 - math.cos(a))))
        rows.append(r)
    return grid('canoe', rows, mat, closed_u=True)


# ====================================================================== tail
def build_tail(M):
    objs = []
    # fin: symmetric sections, root on the fuselage top, swept 35 degrees
    def fin_pt(f, xc, sgn):
        x0 = X_NOSE + 29.0 + f * 5.9 * math.tan(math.radians(35)); c = 5.8 * (1 - f) + 1.8 * f
        top = YC + fus_shape(X_NOSE + 31.5)[2] + fus_shape(X_NOSE + 31.5)[1] - 0.25
        th = 5 * 0.11 * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
        return B(x0 + c * xc, top + f * 6.2, ZF + sgn * th * c)
    xcs = [0.5 * (1 - math.cos(math.pi * j / 24)) for j in range(25)]
    rows = [[fin_pt(i / 16, xc, 1) for xc in xcs] + [fin_pt(i / 16, xc, -1) for xc in reversed(xcs[1:-1])] for i in range(17)]
    objs.append(grid('ac_fin', rows, M['paint'], closed_u=True, sharp_deg=50))
    # tailplanes
    for side in (1, -1):
        def tp(f, xc, up):
            eta = 0.9 + f * 5.3; x0 = X_NOSE + 31.6 + (eta - 0.9) * math.tan(math.radians(31)); c = 3.6 * (1 - f) + 1.25 * f
            th = 5 * 0.1 * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
            y = YC + fus_shape(X_NOSE + 33)[2] - 0.2 + (eta - 0.9) * math.tan(math.radians(6))
            return B(x0 + c * xc, y + (th if up else -th) * c, ZF + side * eta)
        rows = [[tp(i / 14, xc, True) for xc in xcs] + [tp(i / 14, xc, False) for xc in reversed(xcs[1:-1])] for i in range(15)]
        objs.append(grid(f'ac_tailplane_{"L" if side > 0 else "R"}', rows, M['wing'], closed_u=True, sharp_deg=50))
    return objs


# ====================================================================== landing gear
def wheel(name, c, r_out, r_rim, width, M, tread=True):
    """Tyre and hub on an axle along Blender Y through c."""
    hw = width / 2
    tyre = [(r_rim, -hw * 0.82), (r_out * 0.86, -hw), (r_out * 0.97, -hw * 0.9), (r_out, -hw * 0.55), (r_out, hw * 0.55), (r_out * 0.97, hw * 0.9), (r_out * 0.86, hw), (r_rim, hw * 0.82)]
    t = revolve_y(name + '_tyre', tyre, c, M['tyre'], seg=56)
    hub = [(0.001, -hw * 0.75), (r_rim * 0.5, -hw * 0.78), (r_rim, -hw * 0.8), (r_rim, hw * 0.8), (r_rim * 0.5, hw * 0.7), (0.001, hw * 0.66)]
    h = revolve_y(name + '_hub', hub, c, M['hub'], seg=36)
    parts = [t, h]
    for k in range(8):   # wheel bolts on the outer face
        a = 2 * math.pi * k / 8; rr = r_rim * 0.55
        parts.append(cyl('wb', (c[0] + rr * math.cos(a), c[1] - hw * 0.79, c[2] + rr * math.sin(a)), (c[0] + rr * math.cos(a), c[1] - hw * 0.84, c[2] + rr * math.sin(a)), 0.012, M['hub'], seg=6))
    return parts


def build_gear(M):
    objs = []
    for side, tag in ((1, 'L'), (-1, 'R')):
        zg = ZF + side * 3.795; yax = GY + 0.585
        top = y_ref(3.795) - 0.25
        leg = [cyl('mf', B(X_MLG, top, zg), B(X_MLG, yax + 0.9, zg), 0.115, M['gear'], seg=20),     # main fitting
               cyl('sl', B(X_MLG, yax + 0.95, zg), B(X_MLG, yax + 0.12, zg), 0.085, M['chrome'], seg=20),   # sliding tube
               box('ax', B(X_MLG, yax, zg), (0.18, 1.02, 0.16), M['gear']),                                  # axle beam
               cyl('ds', B(X_MLG, yax + 1.25, zg), B(X_MLG + 0.95, top - 0.05, zg - side * 0.15), 0.05, M['gear'], seg=12),   # drag strut
               cyl('ss', B(X_MLG, yax + 1.1, zg), B(X_MLG + 0.1, top - 0.1, zg - side * 1.25), 0.045, M['gear'], seg=12),    # side stay
               cyl('tl1', B(X_MLG - 0.12, yax + 0.95, zg), B(X_MLG - 0.2, yax + 0.55, zg), 0.025, M['gear'], seg=8),       # torque links
               cyl('tl2', B(X_MLG - 0.2, yax + 0.55, zg), B(X_MLG - 0.1, yax + 0.18, zg), 0.025, M['gear'], seg=8)]
        # gear leg door, on the outboard side of the leg
        bm = bmesh.new(); zo = zg + side * 0.16
        pts = [B(X_MLG - 0.45, top - 0.05, zo), B(X_MLG + 0.45, top - 0.05, zo), B(X_MLG + 0.38, yax + 0.75, zo), B(X_MLG - 0.4, yax + 0.75, zo)]
        vs = [bm.verts.new(p) for p in pts]; vs2 = [bm.verts.new((p[0], p[1] - side * 0.02, p[2])) for p in pts]
        bm.faces.new(vs); bm.faces.new(list(reversed(vs2)))
        for i in range(4): bm.faces.new((vs[i], vs[(i + 1) % 4], vs2[(i + 1) % 4], vs2[i]))
        leg.append(mesh('door', bm, [M['paint']], smooth=False))
        for dz in (-0.465, 0.465):
            leg += wheel('mw', B(X_MLG, yax, zg + dz * side), 0.585, 0.26, 0.43, M)
        objs.append(join(f'ac_mlg_{tag}', leg))
        # wheel chocks fore and aft of each tyre
        ch = []
        for dz in (-0.465, 0.465):
            for dx in (-0.66, 0.66):
                ch.append(box('ck', B(X_MLG + dx, GY + 0.09, zg + dz * side), (0.22, 0.4, 0.18), M['chock']))
        objs.append(join(f'ac_chocks_{tag}', ch))
    # nose gear
    yax = GY + 0.38
    ng = [cyl('nf', B(X_NLG, YC - 1.6, ZF), B(X_NLG, yax + 0.6, ZF), 0.08, M['gear'], seg=16),
          cyl('ns', B(X_NLG, yax + 0.65, ZF), B(X_NLG + 0.06, yax + 0.05, ZF), 0.06, M['chrome'], seg=16),
          box('na', B(X_NLG + 0.06, yax, ZF), (0.12, 0.62, 0.12), M['gear']),
          cyl('nd', B(X_NLG, yax + 1.2, ZF), B(X_NLG - 0.9, YC - 1.7, ZF), 0.04, M['gear'], seg=10)]
    for dz in (-0.27, 0.27): ng += wheel('nw', B(X_NLG + 0.06, yax, ZF + dz), 0.38, 0.17, 0.22, M)
    objs.append(join('ac_nlg', ng))
    return objs


# ====================================================================== engine 2 (right wing), without its insides
def build_engine2(M):
    from build_engine import P, r_at, smooth_nacelle
    ze = ZF - 5.75
    def at(x, r, th):   # engine-2 cylindrical -> Blender
        t = math.radians(th); return B(x, r * math.cos(t), ze + r * math.sin(t))
    prof = [(x, smooth_nacelle(x)) for x in [-0.955 + 5.255 * (i / 60) ** 1.0 for i in range(61)]]
    inner = [(x, r_at(P['inletInner'], x) if x < 0 else r_at(P['bypOuter'], x)) for x in [-0.955 + 1.0 * i / 20 for i in range(21)]]
    n = 64
    outer = grid('ac_eng2_cowl', [[at(x, r, 360 * j / n) for j in range(n)] for x, r in prof], M['paint'], closed_u=True, cap=False)
    inl = grid('ac_eng2_inlet', [[at(x, r, 360 * j / n) for j in range(n)] for x, r in inner], M['lip'], closed_u=True, cap=False)
    fan = grid('ac_eng2_fan', [[at(0.05, r, 360 * j / n) for j in range(n)] for r in (0.25, 0.8)], M['fanface'], closed_u=True, cap=False)
    spin = grid('ac_eng2_spinner', [[at(x, r, 360 * j / 32) for j in range(32)] for x, r in [(-0.56, 0.001), (-0.4, 0.09), (-0.2, 0.18), (0.0, 0.24), (0.05, 0.25)]], M['spinner'], closed_u=True, cap=False)
    plug = grid('ac_eng2_plug', [[at(x, r, 360 * j / 48) for j in range(48)] for x, r in [(3.4, 0.2), (3.7, 0.15), (3.95, 0.04), (3.96, 0.001)]], M['hot'], closed_u=True, cap=False)
    pyl = []
    rows = []
    for x, w, y0, y1 in ((0.0, 0.02, 0.97, 0.99), (0.4, 0.11, 0.97, 1.2), (1.2, 0.15, 0.95, 1.45), (2.4, 0.16, 0.9, 1.5), (3.4, 0.115, 0.86, 1.45), (4.4, 0.01, 1.15, 1.28)):
        rows.append([B(x, y0, ze - w), B(x, y1, ze - w * 0.6), B(x, y1, ze + w * 0.6), B(x, y0, ze + w)])
    pyl.append(grid('ac_eng2_pylon', rows, M['paint'], closed_u=True))
    return [outer, inl, fan, spin, plug] + pyl


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = {
        'paint': material('ac_paint', (0.93, 0.94, 0.95), 0.0, 0.35, 1.0), 'belly': material('ac_belly', (0.76, 0.78, 0.8), 0.0, 0.45),
        'wing': material('ac_wing', (0.73, 0.75, 0.77), 0.1, 0.42), 'window': material('ac_window', (0.04, 0.05, 0.07), 0.2, 0.08),
        'line': material('ac_line', (0.32, 0.34, 0.36), 0.0, 0.6), 'fairing': material('ac_fairing', (0.72, 0.74, 0.76), 0.1, 0.42),
        'gear': material('ac_gear', (0.86, 0.87, 0.88), 0.1, 0.4), 'chrome': material('ac_chrome', (0.85, 0.86, 0.88), 1.0, 0.12),
        'tyre': material('ac_tyre', (0.05, 0.05, 0.055), 0.0, 0.85), 'hub': material('ac_hub', (0.6, 0.62, 0.64), 0.9, 0.35),
        'chock': material('ac_chock', (0.95, 0.75, 0.05), 0.0, 0.6), 'lip': material('ac_lip', (0.74, 0.76, 0.78), 1.0, 0.28),
        'fanface': material('ac_fanface', (0.12, 0.13, 0.14), 0.6, 0.4), 'spinner': material('ac_spinner', (0.16, 0.17, 0.19), 0.1, 0.45),
        'hot': material('ac_hot', (0.55, 0.45, 0.35), 0.9, 0.45), 'navL': material('ac_navred', (0.9, 0.08, 0.06), 0.0, 0.3), 'navR': material('ac_navgreen', (0.08, 0.8, 0.2), 0.0, 0.3),
    }
    made = []
    made += build_fuselage(M)
    made += build_wing(M, 1, 'L'); made += build_wing(M, -1, 'R')
    made += build_tail(M)
    made += build_gear(M)
    made += build_engine2(M)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'apron.glb'), export_apply=True, export_yup=True)
    json.dump({'file': 'apron.glb', 'ground': GY, 'fuselageZ': ZF, 'noseX': X_NOSE, 'mlgX': X_MLG}, open(os.path.join(OUT, 'apron.json'), 'w'), indent=2)
    tris = 0
    for o in made: o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    print('apron built:', len(made), 'objects,', tris, 'triangles')


if __name__ == '__main__':
    build()
