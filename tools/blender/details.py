"""The rest of the engine at the same level of detail as the internals (imported by build_engine.py):

  spinner          nose cone with its rubber tip and spiral marking, rear fairing with 18 recessed bolts
  core cowl        the inner fixed structure: forward and aft fixed bands, and the two halves that hinge open
                   with the thrust reverser C-ducts (acoustic skin on the duct side, thermal blankets, frames,
                   edge beams, latches and hinge fittings, fire seals, bleed exit grilles, cooling-air scoops)
  bifurcations     the upper and lower walls where the two C-ducts meet across the bypass duct
  common nozzle    the inner core nozzle and its four struts
  bleed valves     the stage 7 handling bleed valves (three) and the stage 10 start bleed valve, with their
                   outlet ducts to the core cowl
  turbine cases    borescope ports with plugs, instrumentation bosses, stiffening ribs
  exhaust case     the four EGT thermocouples with their harness, the three P4.9 pressure rakes with their manifold
  tubes            bearing oil feed and scavenge tubes through the struts, the ten fuel pigtails from the
                   distribution valve to the manifold, the fire detection loops
  liners           the inlet's acoustic barrel with its splice straps, the fan case's abradable rub strip,
                   ice-impact panel and acoustic panels

Naming as elsewhere: <part>_<piece>, __cut for the copy with the cutaway sector removed; pieces of a hinged
half end _L or _R (a left-half piece inside the cutaway sector becomes ...B_L__full, shown only with the
cutaway closed). Engine-fixed pieces inside the sector end __full.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
import internals as I

CUT_A, CUT_B = I.CUT_A, I.CUT_B
GAP_TOP = 7.0                       # hinge-side gap each side of the pylon (as build_engine.py)


def P3(x, th, r):
    """Engine cylindrical (x, angle from the top towards the aircraft's left, radius) -> Blender."""
    t = math.radians(th); return Vector((x, -r * math.sin(t), r * math.cos(t)))


def in_cut(th):
    t = th % 360; return t > 360 + CUT_A or t < CUT_B


class D:
    """Helpers on top of internals.Kit: partial lathes with chosen end caps, swept tubes, placement."""
    def __init__(self, K, M, P, r_at, smooth_nacelle):
        self.K, self.M, self.P, self.r_at, self.nac = K, M, P, r_at, smooth_nacelle
        self.made = K.made

    def keep(self, o):
        self.made.append(o); return o

    def arc(self, name, loop, a0, a1, mat, cap0=None, cap1=None, steps=None):
        """Body of revolution between angles a0 and a1 (deg), end caps in their own materials (None: open)."""
        steps = steps or max(8, int(abs(a1 - a0) / 2.5))
        bm = bmesh.new(); t0 = math.radians(a0)
        first = [bm.verts.new((x, -r * math.sin(t0), r * math.cos(t0))) for x, r in loop]
        es = [bm.edges.new((first[i], first[(i + 1) % len(first)])) for i in range(len(first))]
        res = bmesh.ops.spin(bm, geom=first + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.radians(a1 - a0), steps=steps, use_duplicate=False)
        mats = [mat]; idx = {mat.name: 0}
        last = [g for g in res['geom_last'] if isinstance(g, bmesh.types.BMVert)]
        for ring, cm, rev in ((first, cap0, True), (last, cap1, False)):
            if cm is None: continue
            if cm.name not in idx: idx[cm.name] = len(mats); mats.append(cm)
            try: f = bm.faces.new(list(reversed(ring)) if rev else ring); f.material_index = idx[cm.name]
            except ValueError: pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.K.obj(name, bm, mats)
        for p in o.data.polygons:
            if p.material_index > 0: p.use_smooth = False
        o.data.set_sharp_from_angle(angle=math.radians(32))
        return o

    def halves(self, name, loop, mat, edge=None, steps=None, a_top=GAP_TOP):
        """Left and right halves of a hinged ring (hinge at the top, latch at the bottom) and the left half's
        cutaway copy. edge: material of the hinge and latch faces."""
        e = edge or mat; sec = self.K.section_mat
        L = self.keep(self.arc(name + '_L', loop, a_top, 179.75, mat, e, e, steps))
        Lc = self.keep(self.arc(name + '_L__cut', loop, CUT_B, 179.75, mat, sec, e, steps))
        R = self.keep(self.arc(name + '_R', loop, 180.25, 360 - a_top, mat, e, e, steps))
        return L, Lc, R

    def side_join(self, name, objs):
        """Join loose pieces by the half they sit on (see the module docstring for the names)."""
        groups = {}
        for o, th in objs:
            side = 'L' if 0 < th % 360 < 180 else 'R'
            groups.setdefault((side, side == 'L' and in_cut(th)), []).append(o)
        out = []
        for (side, cut), lst in sorted(groups.items()):
            out.append(self.keep(self.K.join(name + ('B' if cut else '') + '_' + side + ('__full' if cut else ''), lst)))
        return out

    def fixed_join(self, name, objs):
        """Join engine-fixed pieces: those inside the cutaway sector go to name__full."""
        a = [o for o, th in objs if not in_cut(th)]; b = [o for o, th in objs if in_cut(th)]
        out = []
        if a: out.append(self.keep(self.K.join(name, a)))
        if b: out.append(self.keep(self.K.join(name + '__full', b)))
        return out

    def tube(self, name, pts, radius, mat, rb=0.03, sides=10, caps=True):
        """Tube along a polyline of Blender points, corners bent to radius rb."""
        Pp = [Vector(p) for p in pts]
        path = [Pp[0]]
        for i in range(1, len(Pp) - 1):
            a, b, c = Pp[i - 1], Pp[i], Pp[i + 1]
            d1, d2 = b - a, c - b; l1, l2 = d1.length, d2.length
            if l1 < 1e-6 or l2 < 1e-6: continue
            d1n, d2n = d1 / l1, d2 / l2; ang = d1n.angle(d2n)
            if ang < 1e-3: path.append(b); continue
            t = min(rb * math.tan(ang / 2), l1 * 0.45, l2 * 0.45)
            p0, p1 = b - d1n * t, b + d2n * t; n = max(3, int(math.degrees(ang) / 10))
            for k in range(n + 1):
                s = k / n; path.append((1 - s) ** 2 * p0 + 2 * (1 - s) * s * b + s ** 2 * p1)
        path.append(Pp[-1])
        clean = [path[0]]
        for p in path[1:]:
            if (p - clean[-1]).length > 1e-5: clean.append(p)
        path = clean
        bm = bmesh.new(); rings = []
        t0 = (path[1] - path[0]).normalized()
        up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((0, 1, 0))
        nrm = t0.cross(up).normalized()
        for i, p in enumerate(path):
            tin = (p - path[i - 1]).normalized() if i > 0 else None
            tout = (path[i + 1] - p).normalized() if i < len(path) - 1 else None
            t = (tin + tout).normalized() if tin is not None and tout is not None else (tout if tout is not None else tin)
            nrm = (nrm - t * nrm.dot(t)).normalized(); bi = t.cross(nrm)
            rings.append([bm.verts.new(p + (nrm * math.cos(a) + bi * math.sin(a)) * radius) for a in [2 * math.pi * k / sides for k in range(sides)]])
        for a, b in zip(rings, rings[1:]):
            for k in range(sides): bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
        if caps: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
        return self.K.obj(name, bm, [mat])

    def nut(self, name, p, axis, r, h, mat):
        """Hex nut / B-nut centred on p, along axis (Blender vectors)."""
        a = Vector(axis).normalized()
        return self.K.cyl(name, tuple(Vector(p) - a * h / 2), tuple(Vector(p) + a * h / 2), r, mat, seg=6)

    def rot(self, o, th):
        """Rotate an object built at angle 0 to engine angle th."""
        o.matrix_world = Matrix.Rotation(math.radians(th), 4, 'X') @ o.matrix_world
        return o


# ====================================================================== spinner
def build_spinner(d):
    K, M = d.K, d.M
    r = lambda x: 0.245 * (x + 0.56) / 0.58
    xs = [-0.5 + 0.31 * i / 30 for i in range(31)]
    # glass-fibre nose cone: a 6 mm shell
    loop = [(x, r(x)) for x in xs] + [(x, r(x) - 0.006) for x in reversed(xs)]
    d.keep(d.arc('spinner_cone', loop, 0, 360, M['sp_dark'], steps=96))
    # soft rubber tip that sheds ice
    tip = [(-0.5, 0.0005), (-0.5, r(-0.5) - 0.003), (-0.505, r(-0.5)), (-0.53, 0.019), (-0.548, 0.013), (-0.558, 0.007), (-0.5615, 0.0005)]
    d.keep(d.arc('spinner_tip', tip, 0, 360, M['sp_white'], steps=48))
    # white spiral marking (1.2 turns), laid on the cone
    bm = bmesh.new(); prev = None; N = 160
    for k in range(N + 1):
        t = k / N; phi = t * 2 * math.pi * 1.2; xc = -0.47 + 0.25 * t
        hw = (0.012 + 0.03 * t) * min(1.0, math.sin(math.pi * t) * 6)
        pair = []
        for x in (xc - hw, xc + hw):
            rr = r(x) + 0.0015
            pair.append(bm.verts.new((x, -rr * math.sin(phi), rr * math.cos(phi))))
        if prev: bm.faces.new((prev[0], pair[0], pair[1], prev[1]))
        prev = pair
    d.keep(K.obj('spinner_spiral', bm, [M['sp_white']]))
    # rear fairing: titanium, a step over the cone joint, 18 recessed bolts that hold it to the retaining ring
    fx = [-0.19 + 0.21 * i / 24 for i in range(25)]
    floop = [(-0.196, r(-0.196) + 0.001), (-0.19, r(-0.19) + 0.0045)] + [(x, r(x) + 0.004) for x in fx[1:]] + [(0.02, 0.05), (0.014, 0.05)] + [(x, r(x) - 0.002) for x in reversed(fx[1:-1])] + [(-0.186, r(-0.186) - 0.003)]
    fair = d.arc('spinner_fairing', floop, 0, 360, M['sp_fair'], steps=144)
    cutters, bolts = [], []
    ang = math.atan(0.245 / 0.58)   # half-angle of the cone
    for k in range(18):
        th = k * 20 + 10; x = -0.08; rr = r(x) + 0.004
        nrm = Vector((-math.sin(ang), 0, math.cos(ang)))   # surface normal at angle 0
        c0 = Vector((x, 0, rr)) - nrm * 0.008; c1 = Vector((x, 0, rr)) + nrm * 0.01
        cutters.append(d.rot(K.cyl('pk', tuple(c0), tuple(c1), 0.011, M['sp_fair'], seg=20), th))
        head = K.join('b', [K.cyl('bh', tuple(c0 + nrm * 0.0005), tuple(c0 + nrm * 0.0045), 0.0075, M['bolt'], seg=16),
                            K.cyl('bs', tuple(c0 + nrm * 0.0045), tuple(c0 + nrm * 0.0050), 0.0035, M['sp_dark'], seg=6)])   # socket
        bolts.append(d.rot(head, th))
    I.drill(K, [fair], cutters)
    d.keep(fair)
    # balance screws round the fairing's rear edge
    for k in range(24):
        th = k * 15; x = 0.006
        bolts.append(d.rot(K.cyl('bal', (x, 0, r(x) + 0.0038), (x, 0, r(x) + 0.0058), 0.004, M['bolt'], seg=8), th))
    d.keep(K.join('spinner_bolts', bolts))


# ====================================================================== core cowl (inner fixed structure) and bifurcations
def build_core_cowl(d):
    K, M, P, r_at = d.K, d.M, d.P, d.r_at
    bi = lambda x: r_at(P['bypInner'], x)
    T = 0.022                                   # sandwich thickness
    samp = lambda x0, x1, n: [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    def skin(x0, x1, n): xs = samp(x0, x1, n); return [(x, bi(x)) for x in xs] + [(x, bi(x) - T) for x in reversed(xs)]
    # fixed bands: forward round the intermediate case, aft round the exhaust case
    K.lathe('corecowl_fwd', skin(0.42, 1.218, 16), M['acoustic'])
    K.lathe('corecowl_aft', skin(2.862, 3.12, 6), M['acoustic'])
    # the two hinged halves: acoustic skin to the duct, primer on the edges
    d.halves('corecowl_ifs', skin(1.222, 2.858, 28), M['acoustic'], edge=M['primer'], steps=72)
    # thermal blankets on the inside of the hot zone: quilted stainless pillows
    def blanket(side, a0, a1, cut):
        bm = bmesh.new(); nx, nt = 72, int(abs(a1 - a0) / 1.2)
        g = {}
        for i in range(nx + 1):
            x = 1.86 + (2.84 - 1.86) * i / nx
            for j in range(nt + 1):
                a = math.radians(a0 + (a1 - a0) * j / nt)
                q = abs(math.sin(math.pi * (x - 1.86) / 0.122)) * abs(math.sin(math.pi * (a0 + (a1 - a0) * j / nt) / 7.0))
                rr = bi(x) - T - 0.003 - 0.004 * q ** 0.5
                g[i, j] = bm.verts.new((x, -rr * math.sin(a), rr * math.cos(a)))
        for i in range(nx):
            for j in range(nt): bm.faces.new((g[i, j], g[i, j + 1], g[i + 1, j + 1], g[i + 1, j]))
        o = K.obj('corecowl_blanket_' + side + ('__cut' if cut else ''), bm, [M['blanket']])
        return d.keep(o)
    blanket('L', GAP_TOP + 3, 177, False); blanket('L', CUT_B, 177, True); blanket('R', 183, 360 - GAP_TOP - 3, False)
    # frames and edge beams on the inside, fire seal along the forward edge
    for x in (1.45, 1.8, 2.45, 2.75):
        d.halves(f'corecowl_frame{int(round(x * 100))}', [(x - 0.01, bi(x) - T - 0.016), (x + 0.01, bi(x) - T - 0.016), (x + 0.01, bi(x) - T), (x - 0.01, bi(x) - T)], M['cast'], steps=60)
    d.halves('corecowl_fseal', [(1.222 + 0.008 * math.cos(2 * math.pi * k / 10), bi(1.226) - T + 0.002 + 0.008 * math.sin(2 * math.pi * k / 10)) for k in range(10)], M['seal'], steps=60)
    beams, fits = [], []
    for side, a in (('L', GAP_TOP + 1.2), ('L', 178.6), ('R', 181.4), ('R', 360 - GAP_TOP - 1.2)):
        for xa, xb in ((1.222, 2.858),):
            pts = [P3(x, a, bi(x) - T - 0.012) for x in samp(xa, xb, 12)]
            beams.append((d.tube('beam', pts, 0.012, M['cast'], sides=4), a))
    # latches along the bottom (handles on the left half, keepers on the right), hinge fittings at the top
    for x in (1.38, 1.9, 2.4, 2.78):
        rb = bi(x) - T - 0.01
        fits.append((K.box('lt', tuple(P3(x, 179.0, rb)), (0.09, 0.03, 0.018), 0, M['steel']), 179.0))
        fits.append((d.rot(K.cyl('lh', (x - 0.035, 0, rb - 0.012), (x + 0.035, 0, rb - 0.012), 0.006, M['steel'], seg=8), 179.0), 179.0))
        fits.append((K.box('kp', tuple(P3(x, 181.0, rb)), (0.05, 0.026, 0.02), 0, M['steel']), 181.0))
    for x in (1.32, 2.0, 2.7):
        for a in (GAP_TOP + 0.8, 360 - GAP_TOP - 0.8):
            rb = bi(x) - 0.01
            fits.append((d.rot(K.join('hf', [K.box('hb', (x, 0, rb + 0.02), (0.07, 0.022, 0.05), 0, M['cast']), K.cyl('hp', (x - 0.04, 0, rb + 0.04), (x + 0.04, 0, rb + 0.04), 0.008, M['steel'], seg=10)]), a), a))
    # bleed exit grilles where the handling bleeds dump into the bypass duct, and cooling-air scoops
    for x, a in ((1.6, 262), (1.6, 302), (1.8, 282), (1.6, 128)):
        rr = bi(x)
        fr = K.cyl('gf', (x, 0, rr - T - 0.004), (x, 0, rr + 0.002), 0.078, M['steel'], seg=36)
        pl = K.cyl('gp', (x, 0, rr - 0.002), (x, 0, rr + 0.0025), 0.066, M['grille'], seg=36)
        uv_planar(pl, x, 0.066)
        fits.append((d.rot(K.join('grille', [fr, pl]), a), a))
    for x, a, w in ((1.98, 236, 0.07), (1.98, 250, 0.08), (2.25, 152, 0.09)):
        fits.append((d.rot(scoop(K, x, bi, w, M['acoustic'], M['dark']), a), a))
    d.side_join('corecowl_struct', beams + fits)
    # panel lines on the duct side: splices at the frames and along the half at 60 / 120 degrees from the top
    lines = []
    for x in (1.45, 1.8, 2.15, 2.45, 2.75):
        for a0, a1 in ((GAP_TOP + 1, 179), (181, 359 - GAP_TOP)):
            for k in range(int((a1 - a0) / 10)):
                aa, ab = a0 + k * 10, a0 + (k + 1) * 10
                lines.append((d.arc('pl', [(x - 0.004, bi(x) + 0.0012), (x + 0.004, bi(x) + 0.0012), (x + 0.004, bi(x) + 0.0002), (x - 0.004, bi(x) + 0.0002)], aa, ab, M['panelline'], steps=4), (aa + ab) / 2))
    for a in (60, 120, 240, 300):
        pts = [P3(x, a, bi(x) + 0.0008) for x in samp(1.24, 2.84, 20)]
        lines.append((d.tube('pl', pts, 0.003, M['panelline'], sides=4), a))
    d.side_join('corecowl_lines', lines)

    # bifurcations: each C-duct half carries half of each wall; the halves meet on the centreline
    bo = lambda x: r_at(P['bypOuter'], x)
    def bifur(name_side, th0, sgn, x0, x1):
        bm = bmesh.new(); xs = samp(x0, x1, 40); nr = 8; rows = []
        for x in xs:
            f = (x - x0) / (x1 - x0)
            t = 0.045 * min(1, math.sqrt(max(0, (x - x0) / 0.12))) * min(1, max(0.12, (x1 - x) / 0.25))   # rounded nose, tapered tail
            ring = []
            r0, r1 = bi(x) + 0.001, bo(x) - 0.001
            for k in range(nr + 1):        # outer face, from the core cowl to the fan duct wall
                rr = r0 + (r1 - r0) * k / nr; ring.append(bm.verts.new(tuple(P3(x, th0 + sgn * math.degrees(t / rr), rr))))
            for k in range(nr, -1, -1):    # centreline face
                rr = r0 + (r1 - r0) * k / nr; ring.append(bm.verts.new(tuple(P3(x, th0 + sgn * math.degrees(0.0005 / rr), rr))))
            rows.append(ring)
        m = len(rows[0])
        for a, b in zip(rows, rows[1:]):
            for k in range(m): bm.faces.new((a[k], a[(k + 1) % m], b[(k + 1) % m], b[k]))
        bm.faces.new(list(reversed(rows[0]))); bm.faces.new(rows[-1])
        o = K.obj(name_side, bm, [M['composite']]); o.data.set_sharp_from_angle(angle=math.radians(40))
        return o
    for side, sgn in (('L', 1), ('R', -1)):
        d.keep(bifur(f'cna_bifurlow_{side}', 180.0, -sgn, 1.222, 2.86))
    d.keep(bifur('cna_bifurupB_L__full', 0.0, 1, 1.222, 3.12)); d.keep(bifur('cna_bifurupB_R__full', 360.0, -1, 1.222, 3.12))   # inside the cutaway sector


def uv_planar(o, x, rad):
    """Planar UVs on a disc whose axis is radial at angle 0 (for the perforated grille texture)."""
    me = o.data; uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((v.x - x) / (2 * rad) + 0.5, v.y / (2 * rad) + 0.5)


def scoop(K, x, bi, w, mat, dark):
    """Ram scoop on the duct side of the core cowl, mouth facing forward, at angle 0."""
    bm = bmesh.new(); L = 0.16; rows = []
    for i in range(9):
        f = i / 8; xx = x - L * (1 - f); hgt = 0.032 * (1 - f) ** 0.7; r0 = bi(xx)
        ring = []
        for k in range(9):
            a = math.pi * k / 8; y = -w / 2 * math.cos(a); z = r0 + hgt * math.sin(a) + 0.0005
            ring.append(bm.verts.new((xx, y, z)))
        rows.append(ring)
    for a, b in zip(rows, rows[1:]):
        for k in range(8): bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
    o = K.obj('scoop', bm, [mat])
    mouth = K.box('mouth', (x - L + 0.002, 0, bi(x - L) + 0.016), (0.003, w * 0.9, 0.03), 0, dark)
    return K.join('scoopj', [o, mouth])


# ====================================================================== common nozzle: core nozzle and struts
def build_common_nozzle(d):
    K, M = d.K, d.M
    K.lathe('cna_corenozzle', [(3.1, 0.462), (3.25, 0.448), (3.38, 0.433), (3.405, 0.425), (3.38, 0.421), (3.25, 0.436), (3.1, 0.45)], M['bare'])
    I.row(K, 'cna_nozstrut', 'cna', 3.13, 3.37, lambda x: 0.462 - 0.029 * (x - 3.1) / 0.28, lambda x: d.r_at(d.P['bypOuter'], x), lambda f, rr: (0, 0), lambda f: 0.12,
          M['i_bare'], 'stator', count=4, n_st=4, n_pts=14, gap=0.0, te=0.01, le_round=1.3)


# ====================================================================== handling bleed valves
def build_bleed_valves(d):
    """Stage 7 handling bleeds (7A and 7B on the right, 7C on the left) on the stage 7 manifold and the stage 10
    start bleed on the stage 10 manifold: valve body with its pneumatic actuator, solenoid and position switch,
    outlet duct with a bellows and a V-band, and the silicone seal it makes against the core cowl."""
    K, M = d.K, d.M; co = I.co; bi = lambda x: d.r_at(d.P['bypInner'], x)
    for name, x, th, rc in (('hpccase_hbv7a', 1.6, 262, co(1.6) + 0.05), ('hpccase_hbv7b', 1.6, 302, co(1.6) + 0.05),
                            ('hpccase_hbv7c', 1.6, 128, co(1.6) + 0.05), ('hpccase_hbv10', 1.8, 282, co(1.8) + 0.046)):
        rt = bi(x) - 0.022 - 0.003
        pc = [K.cyl('bs', (x, 0, rc - 0.006), (x, 0, rc + 0.012), 0.056, M['cast'], seg=28),
              K.cyl('f1', (x, 0, rc + 0.012), (x, 0, rc + 0.02), 0.061, M['cast'], seg=28),
              K.cyl('vb', (x, 0, rc + 0.02), (x, 0, rc + 0.076), 0.047, M['cast'], seg=28),
              K.cyl('f2', (x, 0, rc + 0.076), (x, 0, rc + 0.084), 0.057, M['cast'], seg=28),
              K.cyl('sh', (x, -0.044, rc + 0.048), (x, -0.062, rc + 0.048), 0.011, M['cast'], seg=12),          # butterfly shaft boss
              K.cyl('ac', (x, -0.062, rc + 0.048), (x, -0.15, rc + 0.048), 0.022, M['gold'], seg=20),            # pneumatic actuator
              K.cyl('ae', (x, -0.15, rc + 0.048), (x, -0.158, rc + 0.048), 0.017, M['gold'], seg=20),
              K.box('so', (x + 0.06, 0, rc + 0.05), (0.04, 0.03, 0.035), 0, M['gold']),                          # solenoid
              K.cyl('sc', (x + 0.08, 0, rc + 0.05), (x + 0.095, 0, rc + 0.05), 0.008, M['connector'], seg=12),
              K.box('ps', (x - 0.055, 0.02, rc + 0.06), (0.025, 0.02, 0.02), 0, M['steel'])]                      # position switch
        for z in (rc + 0.02, rc + 0.084):
            for k in range(8):
                a = 2 * math.pi * k / 8 + 0.2
                pc.append(K.cyl('nt', (x + 0.053 * math.cos(a), 0.053 * math.sin(a), z), (x + 0.053 * math.cos(a), 0.053 * math.sin(a), z + 0.006), 0.0045, M['bolt'], seg=6))
        pc.append(K.cyl('pf', (x, -0.158, rc + 0.048), (x, -0.168, rc + 0.048), 0.006, M['fitting'], seg=6))     # muscle-air port
        z0, z1 = rc + 0.084, rt - 0.016
        pc.append(K.cyl('d1', (x, 0, z0), (x, 0, z0 + (z1 - z0) * 0.35), 0.043, M['steel'], seg=24))
        for k in range(5):                                                                                       # bellows
            z = z0 + (z1 - z0) * (0.37 + 0.05 * k)
            pc.append(K.cyl('bw', (x, 0, z), (x, 0, z + (z1 - z0) * 0.035), 0.046, M['steel'], seg=24))
        pc.append(K.cyl('d2', (x, 0, z0 + (z1 - z0) * 0.6), (x, 0, z1), 0.041, M['steel'], seg=24))
        zv = z0 + (z1 - z0) * 0.8
        pc += [K.cyl('vbd', (x, 0, zv - 0.006), (x, 0, zv + 0.006), 0.046, M['vband'], seg=24), K.box('tb', (x, 0.048, zv), (0.02, 0.012, 0.012), 0, M['vband'])]
        # outlet: the duct flares to a round mouth closed by a domed perforated plate, ringed by the orange silicone fire seal
        # that bears on the core cowl (Airbus TTM 'compressor bleed valves' photos: a red ring with the metal dish inside)
        pc.append(K.cyl('fl', (x, 0, z1 - 0.004), (x, 0, z1 + 0.004), 0.041, M['steel'], seg=28, r2=0.072))
        pc.append(K.cyl('mo', (x, 0, z1 + 0.004), (x, 0, rt - 0.016), 0.086, M['steel'], seg=36))       # the mouth's collar
        pc.append(K.cyl('slh', (x, 0, rt - 0.0165), (x, 0, rt - 0.0155), 0.082, M['hole'], seg=32))      # dark throat
        for k in range(5):                                                                              # the domed plate
            rr = 0.074 * (1 - k / 5) + 0.006; zz = rt - 0.0155 + 0.009 * math.sin(math.pi / 2 * (k + 1) / 5)
            pc.append(K.cyl('dm', (x, 0, zz - 0.0022), (x, 0, zz), rr, M['steel'], seg=32))
        for k in range(12):                                                                             # its retaining screws
            a = 2 * math.pi * k / 12
            pc.append(K.cyl('ds', (x + 0.076 * math.cos(a), 0.076 * math.sin(a), rt - 0.016), (x + 0.076 * math.cos(a), 0.076 * math.sin(a), rt - 0.012), 0.0032, M['bolt'], seg=6))
        NS = 28                                                                                         # the seal: a bulb ring round the mouth
        for k in range(NS):
            a0, a1 = 2 * math.pi * k / NS, 2 * math.pi * (k + 1.08) / NS
            pc.append(K.cyl('sl', (x + 0.096 * math.cos(a0), 0.096 * math.sin(a0), rt - 0.013), (x + 0.096 * math.cos(a1), 0.096 * math.sin(a1), rt - 0.013), 0.013, M['seal'], seg=10))
        pc.append(K.cyl('slb', (x, 0, rt - 0.026), (x, 0, rt - 0.016), 0.108, M['seal'], seg=36))       # its base flange
        d.keep(d.rot(K.join(name, pc), th))


# ====================================================================== turbine and compressor case details, borescope ports
PORTS = []   # borescope ports: filled by build_case_details, written to the manifest for the borescope view


def build_case_details(d):
    K, M = d.K, d.M; co = I.co
    for x in (2.28, 2.36):   # stiffening ribs, clear of the flanges
        K.lathe(f'hptcase_rib{int(round(x * 100))}', [(x - 0.004, co(x) + 0.03), (x + 0.004, co(x) + 0.03), (x + 0.004, co(x) + 0.045), (x - 0.004, co(x) + 0.045)], M['i_hot'])
    for x in (2.52, 2.71, 2.9):
        K.lathe(f'lptcase_rib{int(round(x * 100))}', [(x - 0.004, co(x) + 0.024), (x + 0.004, co(x) + 0.024), (x + 0.004, co(x) + 0.036), (x - 0.004, co(x) + 0.036)], M['i_hot'])
    def hpc_r(x):   # outer surface of the HP compressor cases, with the bleed manifold bulges
        return co(x) + (0.05 if 1.52 <= x <= 1.62 else 0.046 if 1.76 <= x <= 1.84 else 0.025)
    spec = [   # id, part, x, angle, case outer radius, what it looks at
        ('hpc3', 'hpccase', 1.208, 300, hpc_r(1.208), 'HP compressor stage 3 blades'),
        ('hpc5', 'hpccase', 1.344, 300, hpc_r(1.344), 'HP compressor stage 5 blades'),
        ('hpc7', 'hpccase', 1.48, 300, hpc_r(1.48), 'HP compressor stage 7 blades'),
        ('hpc9', 'hpccase', 1.646, 300, hpc_r(1.646), 'HP compressor stage 9 blades'),
        ('hpc11', 'hpccase', 1.782, 300, hpc_r(1.782), 'HP compressor stage 11 blades'),
        ('hpt1', 'hptcase', 2.27, 210, co(2.27) + 0.032, 'HP turbine stage 1 vanes (trailing edges) and blades (leading edges)'),
        ('hpt1b', 'hptcase', 2.27, 300, co(2.27) + 0.032, 'HP turbine stage 1 vanes and blades'),
        ('hpt2', 'hptcase', 2.37, 255, co(2.37) + 0.032, 'HP turbine stage 1 blades (trailing edges) and stage 2 vanes'),
        ('lpt3', 'lptcase', 2.505, 240, co(2.505) + 0.026, 'LP turbine stage 3 blades'),
        ('lpt5', 'lptcase', 2.721, 240, co(2.721) + 0.026, 'LP turbine stage 5 blades'),
        ('lpt7', 'lptcase', 2.937, 240, co(2.937) + 0.026, 'LP turbine stage 7 blades'),
    ]
    for pid, part, x, th, rc, what in spec:
        pc = [K.cyl('bb', (x, 0, rc - 0.004), (x, 0, rc + 0.016), 0.016, M['i_hot' if part != 'hpccase' else 'cast'], seg=20),
              K.cyl('bp', (x, 0, rc + 0.016), (x, 0, rc + 0.027), 0.011, M['bolt'], seg=6),                 # plug
              K.box('lw', (x + 0.014, 0, rc + 0.022), (0.01, 0.003, 0.006), 0, M['bolt'])]                   # lock-wire tab
        d.keep(d.rot(K.join(f'{part}_bore{pid}', pc), th))
        PORTS.append({'id': pid, 'part': part, 'x': round(x, 4), 'th': th, 'r': round(rc, 4), 'rIn': round(co(x), 4), 'sees': what})
    for k, th in enumerate((30, 90, 150, 210, 270, 330)):   # the combustor's six (bosses modelled in internals.py)
        PORTS.append({'id': f'comb{k + 1}', 'part': 'combcase', 'x': 2.12, 'th': th, 'r': 0.392, 'rIn': 0.31, 'sees': 'combustor liner, dome and fuel nozzles'})


# ====================================================================== exhaust case instruments
def build_tec_instruments(d):
    K, M = d.K, d.M; co, ci = I.co, I.ci
    strut = lambda k: k * 360.0 / 13
    x = 3.07; r0 = co(x) + 0.022; rm = (ci(x) + co(x)) / 2
    pieces = []
    for th in (strut(2), strut(5), strut(8), strut(11)):          # EGT thermocouples (two elements each)
        pc = [K.box('fp', (x, 0, r0 + 0.003), (0.052, 0.03, 0.006), 0, M['steel']), K.cyl('hx', (x, 0, r0 + 0.006), (x, 0, r0 + 0.017), 0.011, M['steel'], seg=6),
              K.cyl('th', (x, 0, r0 + 0.017), (x, 0, r0 + 0.026), 0.0085, M['connector'], seg=14), K.cyl('st', (x, 0, r0), (x, 0, rm), 0.004, M['steel'], seg=10)]
        for dy in (-0.004, 0.004): pc.append(K.cyl('tp', (x, dy, r0 + 0.026), (x, dy, r0 + 0.031), 0.0018, M['fitting'], seg=6))
        for dx in (-0.019, 0.019): pc.append(K.cyl('fb', (x + dx, 0, r0 + 0.006), (x + dx, 0, r0 + 0.011), 0.004, M['bolt'], seg=6))
        pieces.append((d.rot(K.join('tc', pc), th), th))
    for th in (strut(3), strut(6), strut(9)):                     # P4.9 pressure rakes, three heads each
        pc = [K.cyl('rb', (x - 0.03, 0, r0 + 0.002), (x - 0.03, 0, r0 + 0.016), 0.009, M['steel'], seg=6), K.cyl('rs', (x - 0.03, 0, r0), (x - 0.03, 0, ci(x) + 0.03), 0.005, M['steel'], seg=10)]
        for f in (0.25, 0.5, 0.75):
            rr = ci(x) + 0.03 + (r0 - ci(x) - 0.03) * f
            pc.append(K.cyl('rh', (x - 0.03, 0, rr), (x - 0.048, 0, rr), 0.0028, M['steel'], seg=8))
        pieces.append((d.rot(K.join('rk', pc), th), th))
    d.fixed_join('tec_instruments', pieces)
    # harness ring collecting the thermocouples under the core, and the lead forward to the junction box
    rr = lambda xx: co(xx) + 0.03
    def arc_tube(name, a0, a1, xx, rad, mat, step=4):
        n = max(2, int(abs(a1 - a0) / step)); return d.tube(name, [P3(xx, a0 + (a1 - a0) * k / n, rr(xx)) for k in range(n + 1)], rad, mat, sides=8)
    ring = [(arc_tube('hr', strut(2), 112, 3.045, 0.0035, M['tube_ss']), 80), (arc_tube('hr', 112, strut(11), 3.045, 0.0035, M['tube_ss']), 200)]
    for th in (strut(2), strut(5), strut(8), strut(11)):
        ring.append((d.tube('ld', [P3(x, th, r0 + 0.026), P3(x - 0.012, th, r0 + 0.026), P3(3.045, th, rr(3.045))], 0.0025, M['tube_ss'], rb=0.01, sides=6), th))
    ring.append((d.tube('lead', [P3(3.045, 186, rr(3.045)), P3(2.95, 186, rr(2.95)), P3(2.66, 186, rr(2.66)), P3(2.6, 186, 0.47)], 0.0045, M['tube_ss'], rb=0.05, sides=8), 186))
    pm = [P3(3.0, a, co(3.0) + 0.034) for a in range(int(strut(3)), int(strut(9)) + 1, 4)]
    ring.append((d.tube('pm', pm[:8], 0.0025, M['tube_ss'], sides=6), 90)); ring.append((d.tube('pm', pm[7:], 0.0025, M['tube_ss'], sides=6), 200))
    d.fixed_join('tec_harness', ring)


# ====================================================================== tubes: bearing oil, fuel pigtails, fire detection
def build_tubes(d):
    K, M = d.K, d.M; co = I.co
    # front bearing compartment: feed and scavenge down the bottom strut of the intermediate case
    oil = []
    for x, rad in ((0.98, 0.008), (1.028, 0.01)):
        pts = [P3(x, 180, 0.205), P3(x, 180, co(x) + 0.03)]
        oil.append(d.tube('of', pts, rad, M['tube_ss'], sides=10)); oil.append(d.nut('n', P3(x, 180, co(x) + 0.03), (0, 0, -1), rad * 1.6, 0.012, M['fitting']))
    # No. 4: in through the combustor's dump gap ahead of the dome (between two fuel injectors), along under the
    # inner case, into the chamber; a streamlined fairing round the pair where they cross the airflow
    for th, rad in ((160, 0.007), (164, 0.009)):
        pts = [P3(1.932, th, 0.365), P3(1.932, th, 0.172), P3(1.95, th, 0.17), P3(2.06, th, 0.17), P3(2.07, th, 0.158)]
        oil.append(d.tube('o4', pts, rad, M['tube_ss'], rb=0.02, sides=10))
        oil.append(d.nut('n', P3(1.932, th, 0.365), (0, 0, 1), rad * 1.6, 0.012, M['fitting']))
    fair = []
    for k in range(9):
        rr = 0.207 + (0.345 - 0.207) * k / 8; fair.append(rr)
    bm = bmesh.new(); rows = []
    for rr in fair:
        ring = []
        for j in range(16):
            a = 2 * math.pi * j / 16; xx = 1.932 + 0.016 * math.cos(a); tt = 162 + math.degrees(0.016 * math.sin(a) * (0.5 + 0.5 * math.cos(a) ** 2) / rr)
            ring.append(bm.verts.new(tuple(P3(xx, tt, rr))))
        rows.append(ring)
    for a, b in zip(rows, rows[1:]):
        for j in range(16): bm.faces.new((a[j], a[(j + 1) % 16], b[(j + 1) % 16], b[j]))
    oil.append(K.obj('fairing', bm, [M['i_case']]))
    # No. 5: up two exhaust-case struts, then forward under the core to where the services leave
    s7, s8 = 6 * 360 / 13, 7 * 360 / 13
    for th, rad, xb in ((s7, 0.007, 3.072), (s8, 0.009, 3.078)):
        pts = [P3(xb, th, 0.104), P3(xb, th, co(xb) + 0.035), P3(2.98, th + (182 - th) * 0.3, co(2.98) + 0.035), P3(2.72, 182 + (th - 180) * 0.15, co(2.72) + 0.035), P3(2.52, 182 + (th - 180) * 0.15, co(2.52) + 0.035)]
        oil.append(d.tube('o5', pts, rad, M['tube_ss'], rb=0.05, sides=10))
        oil.append(d.nut('n', pts[-1], tuple(pts[-1] - pts[-2]), rad * 1.6, 0.012, M['fitting']))
    d.keep(K.join('bearings_oiltubes', oil))
    # ten pigtails from the fuel distribution valve to the manifold
    rF = co(1.86) + 0.13; fu = []
    for k in range(10):
        t = k * 0.63; th0 = 318 + 4 * math.sin(t); r0 = rF + 0.03 * math.cos(t); the = 318 + (k - 4.5) * 6
        pts = [P3(1.868, th0, r0), P3(1.884, th0, r0), P3(1.896, the, 0.448), P3(1.907, the, 0.434)]
        fu.append(d.tube('pg', pts, 0.0032, M['tube_ss'], rb=0.012, sides=8))
        fu.append(d.nut('n', pts[0], (1, 0, 0), 0.0055, 0.008, M['fitting'])); fu.append(d.nut('n', pts[-1], tuple(pts[-1] - pts[-2]), 0.0055, 0.008, M['fitting']))
        fu.append(K.cyl('tee', tuple(P3(1.909, the, 0.434)), tuple(P3(1.913, the, 0.428)), 0.006, M['steel'], seg=10))
    d.keep(K.join('fuel_pigtails', fu))
    # fire detection: two sensing elements side by side round the core, clipped to brackets
    fl = []
    for dx in (0.0, 0.012):
        pts = []
        for i in range(60):
            f = i / 59; xx = 1.45 + dx + 1.3 * f; th = 122 + 226 * (0.5 - 0.5 * math.cos(f * math.pi * 3))
            pts.append(P3(xx, th, co(1.45 + 1.3 * f) + 0.125))
        fl.append(d.tube('fd', pts, 0.0028, M['tube_cad'], rb=0.04, sides=8))
    for i in range(14):
        f = (i + 0.5) / 14; xx = 1.45 + 1.3 * f + 0.006; th = 122 + 226 * (0.5 - 0.5 * math.cos(f * math.pi * 3)); rr = co(1.45 + 1.3 * f) + 0.125
        cl = K.join('cl', [K.box('cb', (xx, 0, rr), (0.02, 0.012, 0.01), 0, M['clamp_block']), K.box('br', (xx, 0, (rr + co(xx) + 0.03) / 2), (0.012, 0.004, rr - co(xx) - 0.03), 0, M['bracket'])])
        fl.append(d.rot(cl, th))
    d.keep(K.join('ext_fireloops', fl))


# ====================================================================== liners: inlet barrel, fan case
def lathe_uv(o, x0, x1):
    """u round the engine, v along it (for the perforated acoustic texture)."""
    me = o.data; uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co; us.append(((math.atan2(-v.y, v.z) / (2 * math.pi)) % 1.0, (v.x - x0) / (x1 - x0)))
        if max(u for u, _ in us) - min(u for u, _ in us) > 0.5: us = [(u + 1 if u < 0.5 else u, w) for u, w in us]
        for li, uvv in zip(poly.loop_indices, us): uv.data[li].uv = uvv


def build_liners(d):
    K, M, P, r_at = d.K, d.M, d.P, d.r_at
    ii = lambda x: r_at(P['inletInner'], x); bo = lambda x: r_at(P['bypOuter'], x)
    samp = lambda x0, x1, n: [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    xs = samp(-0.8, -0.004, 20)
    for o in K.lathe('inlet_barrel', [(x, ii(x)) for x in xs] + [(x, ii(x) + 0.012) for x in reversed(xs)], M['liner_perf']): lathe_uv(o, -0.8, -0.004)
    straps = []
    for th in (60, 180, 300):   # longitudinal splice straps with their fastener rows
        straps.append((d.tube('ss', [P3(x, th, ii(x) - 0.0008) for x in samp(-0.79, -0.01, 16)], 0.0045, M['steel'], sides=4), th))
        for x in samp(-0.78, -0.02, 26):
            for dth in (-1.1, 1.1): straps.append((K.cyl('fs', tuple(P3(x, th + dth, ii(x) + 0.0002)), tuple(P3(x, th + dth, ii(x) - 0.0016)), 0.0028, M['steel'], seg=8), th + dth))
    for x in (-0.55, -0.3):
        for o in K.lathe(f'inlet_splice{int(-x * 100)}', [(x - 0.012, ii(x) - 0.0012), (x + 0.012, ii(x + 0.012) - 0.0012), (x + 0.012, ii(x + 0.012) + 0.001), (x - 0.012, ii(x) + 0.001)], M['steel']): pass
    d.fixed_join('inlet_straps', straps)
    # fan case: abradable rub strip over the blade tips (with the shallow track they have worn in), ice-impact
    # panel behind it, acoustic panels to the outlet guide vanes
    xs = samp(0.0, 0.36, 18)
    K.lathe('fancase_rubstrip', [(x, bo(x) - (0.0012 if 0.09 < x < 0.28 else 0.0)) for x in xs] + [(x, bo(x) + 0.014) for x in reversed(xs)], M['abradable'])
    xs = samp(0.36, 0.52, 4)
    K.lathe('fancase_icepanel', [(x, bo(x)) for x in xs] + [(x, bo(x) + 0.012) for x in reversed(xs)], M['icepanel'])
    xs = samp(0.52, 0.995, 12)
    for o in K.lathe('fancase_liner', [(x, bo(x)) for x in xs] + [(x, bo(x) + 0.014) for x in reversed(xs)], M['liner_perf']): lathe_uv(o, 0.52, 0.995)
    fs = []
    for x in samp(0.375, 0.505, 3):
        for k in range(48):
            th = k * 7.5 + 3.75
            fs.append((K.cyl('if', tuple(P3(x, th, bo(x) + 0.0003)), tuple(P3(x, th, bo(x) - 0.0015)), 0.003, M['steel'], seg=8), th))
    for th in (0, 90, 180, 270):
        fs.append((d.tube('fl', [P3(x, th, bo(x) - 0.0008) for x in samp(0.53, 0.99, 8)], 0.004, M['steel'], sides=4), th))
    d.fixed_join('fancase_fasteners', fs)
