"""The pylon and the slice of A320 wing above the engine, as smooth aerodynamic surfaces.

Wing: the same definition as the apron's A320 (apron.py: leading edge 27.5 deg swept, 5.1 deg dihedral, a
supercritical section thinning from 15.5 % at the root to 11.5 % at the trailing-edge kink), here over 5 m of span
centred on the engine, so the engine-only view and the apron scene agree. It is closed at the cut ends and
carries the slat, flap and spoiler panel lines, the slat cut either side of the pylon and the flap-track fairing
just outboard of it.

Pylon: a smooth fairing in seventy-two-sided sections through about a hundred stations. A sharp-nosed forward
fairing rises off the fan cowl and widens into the box under the wing; its foot flares out to the cowl hinge lines,
so the cowl doors close against it with no gap; aft of the reverser the lower surface becomes the titanium heat
shield over the common nozzle, and the aft fairing tapers to a point. Access panels and fastener rows on both
sides. Both the wing and the pylon are hidden in the cutaway (their names end in __full), where sectioning them
would only leave a floating slab above the engine.
"""
import math

import bmesh
import bpy
from mathutils import Vector

# ------------------------------------------------------------------------- A320 wing (as apron.py)
TAN_LE = math.tan(math.radians(27.5)); TAN_DI = math.tan(math.radians(5.1))
ETA_K, ETA_T, ETA_E = 6.3, 17.05, 5.75      # trailing-edge kink, tip, the engine's station (m from the centreline)


def x_le(eta): return 1.55 + (eta - ETA_E) * TAN_LE
def x_te(eta): return 5.69 if eta <= ETA_K else 5.69 + (eta - ETA_K) * (3.24 / (ETA_T - ETA_K))
def chord(eta): return x_te(eta) - x_le(eta)
def tc(eta): return 0.155 + (0.115 - 0.155) * min(1, max(0, (eta - 1.98) / (ETA_K - 1.98))) + (0.105 - 0.115) * min(1, max(0, (eta - ETA_K) / (ETA_T - ETA_K)))
def y_ref(eta): return 1.62 + (eta - ETA_E) * TAN_DI


def airfoil(xc, t):
    th = 5 * t * (0.2969 * math.sqrt(max(xc, 0)) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
    m, p = 0.018, 0.62
    yc = m / p ** 2 * (2 * p * xc - xc ** 2) if xc < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * xc - xc ** 2)
    return yc + th * 0.95, yc - th * 1.05


def B(x, y, z): return Vector((x, -z, y))      # engine frame (x aft, y up, z to the left) -> Blender


def wing_xyz(eta, xc, upper, lift=0.0):
    """Engine-frame point on the wing at span station eta (engine at ETA_E, outboard is +z) and chord fraction xc."""
    c = chord(eta); u, l = airfoil(xc, tc(eta))
    return (x_le(eta) + c * xc, y_ref(eta) + c * (u if upper else l) + (lift if upper else -lift), eta - ETA_E)


def wing_lower(x, eta=ETA_E):
    """Height of the wing's lower surface above the engine axis at x (at the engine's station)."""
    c = chord(eta); xc = min(1.0, max(0.0, (x - x_le(eta)) / c))
    return y_ref(eta) + c * airfoil(xc, tc(eta))[1]


def _mesh(link, name, bm, mats, smooth=True, sharp=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for p in me.polygons: p.use_smooth = smooth
    if sharp: me.set_sharp_from_angle(angle=math.radians(sharp))
    return link(bpy.data.objects.new(name, me))


def _cyl_uv(bm):
    """u round the section, v along x: for the cowl paint texture's rivet rows and the surface finish."""
    uv = bm.loops.layers.uv.verify(); xs = [v.co.x for v in bm.verts]; x0, x1 = min(xs), max(xs)
    for f in bm.faces:
        for l in f.loops: l[uv].uv = ((math.atan2(l.vert.co.y, l.vert.co.z) / (2 * math.pi)) % 1.0, (l.vert.co.x - x0) / (x1 - x0 + 1e-9))


def build_wing(link, M):
    """The wing slice, its panel lines and the flap-track fairing. M: paint, line, bare."""
    made = []
    etas = [3.4 + (8.4 - 3.4) * i / 40 for i in range(41)]
    xcs = [0.5 * (1 - math.cos(math.pi * j / 56)) for j in range(57)]
    bm = bmesh.new()
    rows = [[bm.verts.new(B(*wing_xyz(e, xc, True))) for xc in xcs] + [bm.verts.new(B(*wing_xyz(e, xc, False))) for xc in reversed(xcs[1:-1])] for e in etas]
    n = len(rows[0])
    for a, b in zip(rows, rows[1:]):
        for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    for r in (rows[0], list(reversed(rows[-1]))): bm.faces.new(r)   # the cut ends
    _cyl_uv(bm)
    made.append(_mesh(link, 'pylon_wing__full', bm, [M['paint']], sharp=40))

    # panel lines: slat and flap gaps along the span, spoiler panels on top, slat cut either side of the pylon
    lines = bmesh.new()
    def strip(pts, w=0.006):
        """A thin dark strip through engine-frame surface points (offset outwards by the caller)."""
        prev = None
        for i, p in enumerate(pts):
            q = pts[min(i + 1, len(pts) - 1)]; r = pts[max(i - 1, 0)]
            t = Vector(q) - Vector(r); t.normalize()
            up = Vector((0, 1, 0)); side = t.cross(up); side.normalize()
            a = lines.verts.new(B(*(Vector(p) + side * (w / 2)))); b = lines.verts.new(B(*(Vector(p) - side * (w / 2))))
            if prev: lines.faces.new((prev[0], prev[1], b, a))
            prev = (a, b)
    span = [3.45 + (8.35 - 3.45) * i / 30 for i in range(31)]
    for xc in (0.135, 0.73):          # slat and flap gaps, upper and lower
        for up in (True, False):
            strip([wing_xyz(e, xc, up, 0.002) for e in span])
    for e0, e1 in ((3.45, 5.55), (5.95, 8.35)):    # spoiler panels: four on the upper surface (two each side of the engine)
        for k in range(3):
            e = e0 + (e1 - e0) * k / 2
            strip([wing_xyz(e, xc, True, 0.002) for xc in (0.6, 0.64, 0.68, 0.72)], 0.005)
        strip([wing_xyz(e, 0.6, True, 0.002) for e in [e0 + (e1 - e0) * i / 10 for i in range(11)]], 0.005)
    for e in (ETA_E - 0.22, ETA_E + 0.22):         # the slat is cut where the pylon meets the leading edge
        strip([wing_xyz(e, xc, True, 0.002) for xc in (0.0, 0.03, 0.07, 0.135)]); strip([wing_xyz(e, xc, False, 0.002) for xc in (0.0, 0.03, 0.07, 0.135)])
    made.append(_mesh(link, 'pylon_winglines__full', lines, [M['line']], smooth=False))

    # flap-track fairing: a canoe under the wing just outboard of the pylon, running past the trailing edge
    e = ETA_E + 1.55; c = chord(e); x0 = x_le(e) + 0.55 * c; L = 0.75 * c
    bm = bmesh.new(); ring_n = 24; rings = []
    for i in range(33):
        s = i / 32; x = x0 + L * s
        yl = wing_lower(min(x, x_te(e) - 0.01), e) + 0.01
        depth = 0.42 * math.sin(math.pi * min(1.0, s * 1.15) * 0.92) ** 0.8 + 0.01; hw = 0.12 * math.sin(math.pi * min(1.0, s * 1.1)) ** 0.6 + 0.004
        ring = []
        for k in range(ring_n):
            a = 2 * math.pi * k / ring_n; ca, sa = math.cos(a), math.sin(a)
            yy = yl - depth * 0.5 * (1 - ca); zz = (e - ETA_E) + hw * sa * (0.6 + 0.4 * (1 - ca) / 2)
            ring.append(bm.verts.new(B(x, yy, zz)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(ring_n): bm.faces.new((a[k], a[(k + 1) % ring_n], b[(k + 1) % ring_n], b[k]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    _cyl_uv(bm)
    made.append(_mesh(link, 'pylon_wingflaptrack__full', bm, [M['paint']]))   # (pylon_wing*: hidden on the apron, whose A320 has its own)
    return made


# ------------------------------------------------------------------------- pylon
def _spline(pts, x):
    """Monotone cubic (Fritsch-Carlson) through [(x, y)], clamped at the ends."""
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if x <= xs[0]: return ys[0]
    if x >= xs[-1]: return ys[-1]
    n = len(pts); d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if abs(d[i]) < 1e-12: m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]; s = a * a + b * b
            if s > 9: t = 3 / math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]
    i = max(j for j in range(n - 1) if xs[j] <= x); h = xs[i + 1] - xs[i]; t = (x - xs[i]) / h
    h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]


TOP = [(0.0, 0.99), (0.1, 1.045), (0.25, 1.125), (0.5, 1.235), (0.9, 1.35), (1.3, 1.43), (1.7, 1.5), (2.2, 1.6), (6.0, 1.75)]   # (aft of the wing's leading edge the top is the wing's lower surface)
HW = [(0.0, 0.004), (0.06, 0.03), (0.2, 0.08), (0.5, 0.122), (0.9, 0.148), (1.5, 0.16), (2.2, 0.16), (2.9, 0.15), (3.4, 0.135), (4.0, 0.11), (4.6, 0.078), (5.1, 0.04), (5.42, 0.004)]
X_TAIL = HW[-1][0]  # the tail closes under the flap
X_CD_END = 2.86     # aft end of the reverser C-ducts: the heat shield starts here
X_RAMP = 3.55       # the heat shield starts to ramp up towards the tail
X_BOX0, X_BOX1 = 1.2, 3.72   # the grey pylon box sides between the forward and aft fairings


def _smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)


def _softmin(a, b, k=0.035):
    m = min(a, b); return m - k * math.log(math.exp(-(a - m) / k) + math.exp(-(b - m) / k))


def build_pylon(link, M, oml):
    """The pylon fairing with its flared foot, heat shield, panels and fasteners. M: paint, bare, line, fastener."""
    made = []
    def top(x):
        """Fairs into the wing's lower surface (3 cm into it, so no seam shows) aft of the leading edge."""
        t = _spline(TOP, x)
        return _softmin(t, wing_lower(x) + 0.03) if x > 1.4 else t
    def foot(x):
        """Half-width of the foot along the cowl: out to the fan cowl hinge lines (9.6 deg), then the C-ducts' (7.6 deg),
        faded out over the start of the heat shield."""
        rn = oml(x, 0.0); a = 9.6 if x < 1.0 else 9.6 + (7.6 - 9.6) * (x - 1.0) / 0.3 if x < 1.3 else 7.6
        return rn * math.sin(math.radians(a)) * min(1.0, x / 0.12)   # it starts at the fan cowl's front edge
    U = lambda x: _smoothstep(X_CD_END - 0.04, X_CD_END + 0.32, x)   # 0 on the cowl, 1 clear of the nozzle
    def stand(x):
        """Heat shield height: 6 cm over the hot common nozzle (its exit is at x 4.30)."""
        return oml(min(x, 4.3), 0.0) + 0.06
    def bottom(x):
        rn = oml(x, 0.0); b = (rn - 0.012) * (1 - U(x)) + stand(x) * U(x)
        if x > X_RAMP:   # the shield sweeps up behind the nozzle to close under the flap
            e = ((x - X_RAMP) / (X_TAIL - X_RAMP)) ** 1.7; b = b * (1 - e) + (top(X_TAIL) - 0.012) * e
        return b
    NS = 72; stations = sorted(set([0.004 * i for i in range(10)] + [0.04 + 0.04 * i for i in range(134)] + [X_TAIL]))
    bm = bmesh.new(); rings = []; meta = []; seam = []; prof = []
    for x in stations:
        hw = max(0.002, _spline(HW, x)); yt = top(x); yb = bottom(x); u = U(x); hb = max(hw, hw + (foot(x) - hw) * (1 - u))
        rt = min(hw * 0.92, 0.45 * max(0.02, yt - yb)); yside = yt - rt; yflare = yb + min(0.11 * (1 - u) + 0.05 * u, 0.4 * (yt - yb))
        rn = oml(x, 0.0)
        # section outline, counter-clockwise from the bottom centre: along the cowl to the foot, the concave flare
        # up to the side wall, the side, the rounded top, and back down the other side
        half = []
        nb = 8
        for k in range(nb + 1):                                   # bottom, following the cowl's curve
            z = hb * k / nb; yc = math.sqrt(max(rn * rn - z * z, 0.0)) - 0.012       # on the cowl: its curve
            half.append((z, yc * (1 - u) + (yb + 0.015 * (z / hb) ** 2) * u))         # off it: a shallow, rounded shield
        nf = 8
        for k in range(1, nf + 1):                                # the flare: a quarter-round fillet from the foot to the wall
            a = (math.pi / 2) * k / nf; half.append((hw + (hb - hw) * (1 - math.sin(a)), half[nb][1] + (yflare - half[nb][1]) * (1 - math.cos(a))))
        nw = 6
        for k in range(1, nw + 1): half.append((hw, yflare + (yside - yflare) * k / nw))
        nt = NS // 2 - len(half)
        for k in range(1, nt + 1):                                # top arc
            a = (math.pi / 2) * k / nt; half.append((hw * math.cos(a) * (1 if k < nt else 0), yside + rt * math.sin(a)))
        outline = half + [(-z, y) for z, y in reversed(half[1:-1])]
        rings.append([bm.verts.new(B(x, y, z)) for z, y in outline]); meta.append((x, yb, yt)); seam.append((x, outline[19][1], outline[19][0])); prof.append((x, hw, yflare, yside))
    n = len(rings[0]); nh = n // 2 + 1; K_SHIELD = 19     # outline points up to K_SHIELD (bottom, flare, lower wall) are shield
    # finishes (photos): the forward and aft fairings bare aluminium, the box sides between them mid grey, the heat
    # shield dull titanium. The boundaries run along stations and section lines, so they stay crisp.
    mats = [M['fair'], M['bare'], M['side']]
    for (a, b), (xa, yba, yta) in zip(zip(rings, rings[1:]), meta):
        for i in range(n):
            f = bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            k = i if i < nh - 1 else n - 1 - i                  # index up the near half, mirrored
            if xa > X_CD_END - 0.02 and k < K_SHIELD: f.material_index = 1   # titanium heat shield
            elif k < 23 and X_BOX0 <= xa < X_BOX1: f.material_index = 2
    tip = bm.verts.new(B(-0.01, (bottom(0.0) + top(0.0)) / 2, 0.0))
    for i in range(n): bm.faces.new((tip, rings[0][(i + 1) % n], rings[0][i]))
    bm.faces.new(list(reversed(rings[-1])))
    _cyl_uv(bm)
    py = _mesh(link, 'pylon_fairing__full', bm, mats, sharp=55)
    made.append(py)

    # access panels and fastener rows on the side walls, both sides
    pan = bmesh.new(); fas = bmesh.new(); d = 0.0024
    def wall(x): return max(0.002, _spline(HW, x)) + 0.0012
    def edge(xa, ya, xb, yb_, side):
        horiz = abs(yb_ - ya) < 1e-9; nseg = max(2, int(math.hypot(xb - xa, yb_ - ya) / 0.04)); prev = None
        for k in range(nseg + 1):
            s_ = k / nseg; x = xa + (xb - xa) * s_; y = ya + (yb_ - ya) * s_; z = side * wall(x)
            p0, p1 = (B(x, y - d / 2, z), B(x, y + d / 2, z)) if horiz else (B(x - d / 2, y, z), B(x + d / 2, y, z))
            v0, v1 = pan.verts.new(p0), pan.verts.new(p1)
            if prev: pan.faces.new((prev[0], prev[1], v1, v0))
            prev = (v0, v1)
    def fastener(x, y, side):
        c = B(x, y, side * (wall(x) + 0.0004)); out = Vector((0, -side, 0))
        ring = [fas.verts.new(c + Vector((0.0027 * math.cos(2 * math.pi * j / 6), 0.0, 0.0027 * math.sin(2 * math.pi * j / 6)))) for j in range(6)]
        cap = fas.verts.new(c + out * 0.0012)
        for j in range(6): fas.faces.new((ring[j], ring[(j + 1) % 6], cap))
    def panel(x0, x1, y0, y1, side):
        for xa, ya, xb, yb_ in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)): edge(xa, ya, xb, yb_, side)
        for k in range(int((x1 - x0) / 0.035) + 1):
            x = x0 + 0.012 + (x1 - x0 - 0.024) * k / max(1, int((x1 - x0) / 0.035))
            fastener(x, y0 + 0.01, side); fastener(x, y1 - 0.01, side)
        for k in range(1, int((y1 - y0) / 0.035)):
            y = y0 + (y1 - y0) * k / int((y1 - y0) / 0.035); fastener(x0 + 0.01, y, side); fastener(x1 - 0.01, y, side)
    def line(pts, side, w=0.0026):
        """A panel line through (x, y, half-width) points on one side wall, as a strip across the line."""
        prev = None
        for i, (x, y, z) in enumerate(pts):
            xa, ya, _ = pts[max(i - 1, 0)]; xb, yb_, _ = pts[min(i + 1, len(pts) - 1)]
            tx, ty = xb - xa, yb_ - ya; L = math.hypot(tx, ty) or 1.0; nx, ny = -ty / L * w / 2, tx / L * w / 2
            zz = side * (abs(z) + 0.0012)
            v0, v1 = pan.verts.new(B(x - nx, y - ny, zz)), pan.verts.new(B(x + nx, y + ny, zz))
            if prev: pan.faces.new((prev[0], prev[1], v1, v0))
            prev = (v0, v1)
    shield = [p for p in seam if X_CD_END + 0.01 <= p[0] <= X_TAIL - 0.08]
    for side in (-1, 1):
        line(shield, side)                                         # the heat shield's upper edge
        for xb_ in (X_BOX0, X_BOX1):                                # seams at the grey box's forward and aft edges
            hw_, yf, ys = min(prof, key=lambda q: abs(q[0] - xb_))[1:]
            edge(xb_, yf - (0.06 if xb_ < 2 else -0.02), xb_, ys, side)
        for p in shield[::5]: fastener(p[0], p[1] - 0.012, side)   # and its fastener row
    for side in (-1, 1):
        for x0, x1, f0, f1 in ((0.35, 0.8, 0.35, 0.8), (0.95, 1.45, 0.3, 0.85), (1.6, 2.15, 0.25, 0.6), (2.3, 2.8, 0.3, 0.72), (3.05, 3.55, 0.5, 0.82), (3.7, 4.2, 0.55, 0.84)):
            ym0 = bottom((x0 + x1) / 2); ym1 = top((x0 + x1) / 2); y0 = ym0 + (ym1 - ym0) * f0; y1 = ym0 + (ym1 - ym0) * f1
            panel(x0, x1, y0, y1, side)
    def at(x):   # (half-width, flare top, wall top) at x, from the nearest section
        return min(prof, key=lambda q: abs(q[0] - x))[1:]
    def disc(x, y, r, side, fasteners=14):
        """A round access panel: its seam, a ring of fasteners and the panel itself standing proud by a hair."""
        zw = lambda xx, lift=0.0012: side * (wall(xx) - 0.0012 + lift); prev = None; N = 40   # on the wall, which narrows aft
        for j in range(N + 1):
            a = 2 * math.pi * j / N; c, s_ = math.cos(a), math.sin(a); xa_, xb_ = x + (r - d / 2) * c, x + (r + d / 2) * c
            v0 = pan.verts.new(B(xa_, y + (r - d / 2) * s_, zw(xa_))); v1 = pan.verts.new(B(xb_, y + (r + d / 2) * s_, zw(xb_)))
            if prev: pan.faces.new((prev[0], prev[1], v1, v0))
            prev = (v0, v1)
        cen = pnl.verts.new(B(x, y, zw(x, 0.0008)))
        rim = [pnl.verts.new(B(x + (r - d) * math.cos(2 * math.pi * j / N), y + (r - d) * math.sin(2 * math.pi * j / N), zw(x + (r - d) * math.cos(2 * math.pi * j / N), 0.0008))) for j in range(N)]
        for j in range(N): pnl.faces.new((cen, rim[j], rim[(j + 1) % N]))
        for j in range(fasteners): a = 2 * math.pi * (j + 0.5) / fasteners; fastener(x + (r - 0.012) * math.cos(a), y + (r - 0.012) * math.sin(a), side)
    pnl = bmesh.new(); lv = bmesh.new()
    for side in (-1, 1):
        disc(2.42, (at(2.42)[1] + at(2.42)[2]) / 2 + 0.04, 0.085, side, 10)   # round access panels on the box side (photos)
        disc(3.27, at(3.27)[2] - 0.14, 0.12, side, 16)
        for xf in (1.52, 2.22, 2.92):                                          # frame lines: vertical fastener rows between the panels
            hw_, yf, ys = at(xf)
            for k in range(int((ys - yf - 0.04) / 0.035) + 1): fastener(xf, yf + 0.02 + 0.035 * k, side)
        # pre-cooler exhaust louvres high on the fairing side under the wing: two groups of slots, each with its slat
        for j in range(22):
            if j == 11: continue
            x = 1.68 + 0.026 * j; hw_, yf, ys = at(x); z = side * (hw_ + 0.0014); y0, y1 = ys - 0.075, ys - 0.02
            q = [lv.verts.new(B(x - 0.0065, y0, z)), lv.verts.new(B(x + 0.0065, y0, z)), lv.verts.new(B(x + 0.0065, y1, z)), lv.verts.new(B(x - 0.0065, y1, z))]
            lv.faces.new(q)
            sl = [pnl.verts.new(B(x + 0.0035, y0 + 0.002, z + side * 0.004)), pnl.verts.new(B(x + 0.0075, y0 + 0.002, z)), pnl.verts.new(B(x + 0.0075, y1 - 0.002, z)), pnl.verts.new(B(x + 0.0035, y1 - 0.002, z + side * 0.004))]
            pnl.faces.new(sl)
        for dy in (0.081, 0.014): line([(x, at(x)[2] - dy, at(x)[0]) for x in [1.665 + 0.59 * q / 12 for q in range(13)]], side)   # the grille's frame
    made.append(_mesh(link, 'pylon_louvres__full', lv, [M['louvre']], smooth=False))
    made.append(_mesh(link, 'pylon_doors__full', pnl, [M['side']], smooth=False))
    made.append(_mesh(link, 'pylon_panels__full', pan, [M['line']], smooth=False))
    made.append(_mesh(link, 'pylon_fasteners__full', fas, [M['fastener']], smooth=False))
    return made
