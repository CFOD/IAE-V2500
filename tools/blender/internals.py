"""Engine internals: fan, booster, intermediate case, HP compressor, combustor, turbines, exhaust case,
shafts and bearings (imported by build_engine.py).

Arrangement from the Airbus A320 Technical Training Manual (IAE V2500, ATA 70-72) and the SR Technics
component booklet: 22-blade fan with annulus fillers and a front blade retaining ring (36 + 22 bolts);
four-stage booster (stages 1.5, 2, 2.3, 2.5) behind the fan inner vanes; ten-stage HP compressor (stages
3-12) with variable inlet guide vanes and variable stators behind stages 3, 4 and 5; annular combustor in
the diffuser case with 20 fuel injectors and 2 igniters; two-stage HP turbine; five-stage LP turbine
(stages 3-7) bolted to the LP shaft at disc 6; turbine exhaust case with 13 struts and the No. 5 bearing;
bearings 1, 2 and 3 in the front compartment, No. 4 under the combustor. Blade and vane counts, chords
and angles are estimates (typical solidity and velocity triangles for this class of engine): IAE does
not publish them.

Blade and vane rows are exported as one template each: a single blade at angle 0 (Blender +Z is radial,
-Y the direction of rotation), with a simpler '_lo' copy for low-quality rendering. model.json 'rings'
tells the simulator how many to place, on which spool, and how the cutaway treats them. Bodies of
revolution are exported whole and as a cut copy with section faces (name + '__cut').
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

CUT_A, CUT_B, DEEP_A = -8.0, 112.0, 60.0   # degrees, must match scene3d.js (wedge for casings, deep cut for rotors)

# Simulator parts these belong to (node names start '<part>_'), and which of them can be seen from outside the
# closed engine (through the intake or the nozzle) or only once the core cowl is off; the rest is inside the
# cases and is only drawn with the cutaway on, the engine exploded or a case removed.
PARTS = ['fan', 'lpc', 'lpccase', 'hpc', 'hpccase', 'combcase', 'liner', 'fuel', 'ign', 'hpt', 'hptcase', 'lpt', 'lptcase', 'tec', 'lpshaft', 'hpshaft', 'bearings']
VIS_OUT = r'^(fan_|lpc_(igv|r1|s1)$|tec_|lpt_r7$|lptcase_(v7|hc7)$)'
VIS_CORE = r'^(lpccase_shell|hpccase_(front|rear|flange|unison|igv$|vsv\d$)|combcase_(outer|flange|pads|ignboss|bores)|hptcase_(shell|flange)|lptcase_(shell|flange)|fuel_|ign_)'

# flow path [x, r], in step with app/cutaway.js
CORE_OUTER = [[0.4, 0.47], [0.85, 0.44], [1.15, 0.3], [1.85, 0.25], [1.92, 0.33], [2.18, 0.33], [2.22, 0.3], [2.42, 0.33], [3.0, 0.48], [3.12, 0.44]]
CORE_INNER = [[0.3, 0.27], [0.45, 0.33], [0.85, 0.36], [1.15, 0.17], [1.85, 0.215], [1.92, 0.17], [2.18, 0.2], [2.22, 0.235], [2.42, 0.25], [3.0, 0.28], [3.12, 0.262], [3.5, 0.17], [3.85, 0.06], [3.95, 0]]
BYP_INNER = [[0.4, 0.47], [0.7, 0.54], [1.3, 0.56], [2.4, 0.54], [3.0, 0.52], [3.12, 0.46]]
BYP_OUTER = [[0, 0.81], [0.35, 0.81], [1.2, 0.8], [2.4, 0.74], [3.2, 0.66], [3.6, 0.63], [4.3, 0.595]]
SPINNER = [[-0.56, 0], [0.02, 0.245], [0.3, 0.27]]


def r_at(prof, x):
    if x <= prof[0][0]: return prof[0][1]
    for (x0, r0), (x1, r1) in zip(prof, prof[1:]):
        if x <= x1: return r0 + (r1 - r0) * (x - x0) / (x1 - x0)
    return prof[-1][1]

ci = lambda x: r_at(CORE_INNER, x)
co = lambda x: r_at(CORE_OUTER, x)
smoothstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (x - a) / (b - a))))


class Kit:
    """Mesh helpers shared by every internal module."""
    def __init__(self, material, link, section):
        self.material, self.link, self.section_mat = material, link, section
        self.made, self.rings = [], []

    # ------------------------------------------------------------------ objects
    def obj(self, name, bm, mats, smooth=True):
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for m in mats: me.materials.append(m)
        for p in me.polygons: p.use_smooth = smooth
        return self.link(bpy.data.objects.new(name, me))

    def join(self, name, objs):
        objs = [o for o in objs if o is not None]
        if not objs: return None
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
        return o

    # ------------------------------------------------------------------ bodies of revolution
    def lathe(self, name, loop, mat, cut='wedge', steps=144):
        """Whole body, plus (cut = 'wedge' | 'deep') a copy with the cutaway sector removed and section faces.
        Small radii need fewer steps round the axis to look round (the facet error stays under about 0.1 mm)."""
        steps = min(steps, max(72, int(max(r for _, r in loop) * 500)))
        full = self._spin(name, loop, mat, 0.0, 360.0, steps, caps=False)
        out = [full]
        if cut:
            a0 = CUT_B; a1 = 360.0 + (DEEP_A if cut == 'deep' else CUT_A)
            out.append(self._spin(name + '__cut', loop, mat, a0, a1, max(12, int(steps * (a1 - a0) / 360.0)), caps=True))
        self.made.extend(out)
        return out

    def _spin(self, name, loop, mat, a0, a1, steps, caps):
        bm = bmesh.new()
        t0 = math.radians(a0)
        first = [bm.verts.new((x, -r * math.sin(t0), r * math.cos(t0))) for x, r in loop]
        es = [bm.edges.new((first[i], first[(i + 1) % len(first)])) for i in range(len(first))]
        res = bmesh.ops.spin(bm, geom=first + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.radians(a1 - a0), steps=steps, use_duplicate=False)
        mats = [mat]
        if caps:
            last = [g for g in res['geom_last'] if isinstance(g, bmesh.types.BMVert)]
            # geom_last keeps the loop order of the first ring
            for ring, rev in ((first, True), (last, False)):
                try:
                    f = bm.faces.new(list(reversed(ring)) if rev else ring); f.material_index = 1
                except ValueError: pass
            mats.append(self.section_mat)
        else:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.obj(name, bm, mats)
        for p in o.data.polygons:
            if p.material_index == 1: p.use_smooth = False
        o.data.set_sharp_from_angle(angle=math.radians(32))   # corners of the section stay crisp, the revolve stays smooth
        return o

    # ------------------------------------------------------------------ airfoils
    @staticmethod
    def section(c, a1, a2, tmax, n=16, te=0.004, le_round=1.0):
        """Airfoil section as a closed loop of (x, s) around its centroid: chord c, camber line turning from
        heading a1 to a2 (radians from +x towards +s, the direction of rotation), NACA-style thickness tmax/c,
        trailing-edge thickness te/c. Cosine spacing bunches points at both edges."""
        m = 48; pts = [(0.0, 0.0)]; hd = []
        for k in range(m):
            phi = a1 + (a2 - a1) * (k + 0.5) / m; hd.append(phi)
            pts.append((pts[-1][0] + math.cos(phi) / m, pts[-1][1] + math.sin(phi) / m))
        ch = math.hypot(*pts[-1]); sc = c / ch
        def camber(xi):
            f = xi * m; k = min(m - 1, int(f)); w = f - k
            p0, p1 = pts[k], pts[k + 1]
            return ((p0[0] + (p1[0] - p0[0]) * w) * sc, (p0[1] + (p1[1] - p0[1]) * w) * sc, a1 + (a2 - a1) * xi)
        def thick(xi):
            t = 5 * tmax * c * (0.2969 * math.sqrt(xi) * le_round - 0.126 * xi - 0.3516 * xi ** 2 + 0.2843 * xi ** 3 - 0.1036 * xi ** 4)
            return max(t, te * c * xi * 0.5)
        xs = [(1 - math.cos(math.pi * k / n)) / 2 for k in range(n + 1)]
        up, lo = [], []
        for xi in xs:
            x, s, phi = camber(xi); t = thick(xi); nx, ns = -math.sin(phi), math.cos(phi)
            up.append((x + nx * t, s + ns * t)); lo.append((x - nx * t, s - ns * t))
        loop = list(reversed(up)) + lo[1:-1]           # TE (upper) -> LE -> TE (lower), closed
        cx = sum(p[0] for p in loop) / len(loop); cs = sum(p[1] for p in loop) / len(loop)
        return [(x - cx, s - cs) for x, s in loop]

    def blade(self, name, stations, mat, n=16, caps=(False, True), te=0.004, le_round=1.0, rad=None):
        """Loft sections stacked on cylinders. stations: (r, x_stack, s_lean, chord, a1, a2, tmax) per radius.
        Vertices sit on the cylinder of their own radius, so wide chords wrap correctly round the engine.
        rad(f, x), if given, moves each vertex onto a cone instead (f = station fraction hub to tip), so the
        hub and tip follow a sloping annulus wall."""
        bm = bmesh.new(); rings = []
        for j, (r, xs, sl, c, a1, a2, tm) in enumerate(stations):
            sec = self.section(c, a1, a2, tm, n, te, le_round); f = j / max(1, len(stations) - 1)
            ring = []
            for x, s in sec:
                rr = rad(f, xs + x) if rad else r
                ring.append(bm.verts.new((xs + x, -rr * math.sin((s + sl) / rr), rr * math.cos((s + sl) / rr))))
            rings.append(ring)
        k = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(k): bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
        if caps[0]: bm.faces.new(list(reversed(rings[0])))
        if caps[1]: bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.obj(name, bm, [mat])
        # the trailing edge stays sharp: mark the edges between the two TE points of each section
        o.data.update()
        for e in o.data.edges:
            a, b = e.vertices[0] % k, e.vertices[1] % k
            if {a, b} in ({0, k - 1}, {0}, {k - 1}): e.use_edge_sharp = True
        return o

    # ------------------------------------------------------------------ platforms, shrouds, seals
    def sector_band(self, name, x0, x1, r_in, r_out, dth, mat, skew0=0.0, skew1=0.0, nx=6, nt=6):
        """Annular sector (a platform or shroud segment) centred on angle 0, width dth radians; its edges
        can be skewed (angle offset at x0 and x1) to follow a blade's stagger."""
        bm = bmesh.new()
        def v(x, t, r):   # r may be a function of x (a band on a cone)
            f = (x - x0) / (x1 - x0); a = t + skew0 + (skew1 - skew0) * f
            r = r(x) if callable(r) else r
            return bm.verts.new((x, -r * math.sin(a), r * math.cos(a)))
        grid = {}
        for side, r in (('o', r_out), ('i', r_in)):
            for i in range(nx + 1):
                for j in range(nt + 1):
                    grid[side, i, j] = v(x0 + (x1 - x0) * i / nx, -dth / 2 + dth * j / nt, r)
        for i in range(nx):
            for j in range(nt):
                bm.faces.new((grid['o', i, j], grid['o', i + 1, j], grid['o', i + 1, j + 1], grid['o', i, j + 1]))
                bm.faces.new((grid['i', i, j + 1], grid['i', i + 1, j + 1], grid['i', i + 1, j], grid['i', i, j]))
        for i in range(nx):
            for j in (0, nt):
                q = (grid['o', i, j], grid['i', i, j], grid['i', i + 1, j], grid['o', i + 1, j]); bm.faces.new(q if j == 0 else tuple(reversed(q)))
        for j in range(nt):
            for i in (0, nx):
                q = (grid['o', i, j + 1], grid['i', i, j + 1], grid['i', i, j], grid['o', i, j]); bm.faces.new(q if i == 0 else tuple(reversed(q)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self.obj(name, bm, [mat], smooth=False)

    def cyl(self, name, a, b, r, mat, seg=12, r2=None):
        """Cylinder (or cone) between two points."""
        a, b = Vector(a), Vector(b); d = b - a; L = d.length
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=L)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
        return self.obj(name, bm, [mat])

    def box(self, name, centre, size, th_deg, mat):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=size, verts=bm.verts)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Rotation(math.radians(th_deg), 4, 'X'), verts=bm.verts)
        return self.obj(name, bm, [mat], smooth=False)

    def sphere(self, name, c, r, mat, seg=12):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg * 2 // 3), radius=r)
        bmesh.ops.translate(bm, vec=c, verts=bm.verts)
        return self.obj(name, bm, [mat])

    def hexbolt(self, name, x, r, mat, d=0.008, h=0.006, facing=-1):
        """Bolt head or nut on a flange at angle 0, axis along x (facing = -1 forward, +1 aft)."""
        return self.cyl(name, (x, 0, r), (x + facing * h, 0, r), d * 0.5 * 1.15, mat, seg=6)

    # ------------------------------------------------------------------ rings
    def ring(self, name, hi, lo, part, count, kind, spool=0, phase=0.0, cut=True, extra=None, mid=None):
        """Template for a ring of identical items (blades, vanes, bolts...) placed at count equal angles. Blade rows
        have three levels of detail: hi (the node; high and ultra quality), mid (medium) and lo (low)."""
        hi.name = hi.data.name = f'ring_{name}'
        entry = {'node': hi.name, 'part': part, 'count': count, 'kind': kind, 'spool': spool, 'phase': phase, 'cut': cut}
        if lo is not None:
            lo.name = lo.data.name = f'ring_{name}_lo'; entry['lo'] = lo.name; self.made.append(lo)
        if mid is not None:
            mid.name = mid.data.name = f'ring_{name}_mid'; entry['mid'] = mid.name; self.made.append(mid)
        if extra: entry.update(extra)
        self.made.append(hi); self.rings.append(entry)
        return entry


def blade_count(r_mean, chord, solidity):
    n = 2 * math.pi * r_mean * solidity / chord
    return max(8, int(round(n / 2.0)) * 2)


# ====================================================================== rows of blades and vanes
D2R = math.pi / 180
M_BOLT = [None]   # set by build_front (the bolt material, for small hardware on blade templates)
OMEGA_LP = 0.95 * 5650 * 2 * math.pi / 60      # design speeds, rad/s (sizes the velocity triangles)
OMEGA_HP = 0.97 * 14950 * 2 * math.pi / 60


def row(K, name, part, x0, x1, hub, tip, angles, tmax, mat, kind, spool=0, solidity=1.3, count=None, n_st=9, n_pts=14,
        gap=0.0015, hub_plat=False, tip_plat=False, shroud=None, vsv=None, te=0.004, le_round=1.0, lean=0.0, sweep=0.0, cut=True, extra_hi=None):
    """One blade or vane row as a ring template (hi and lo detail). angles(f, r) -> (a1, a2) in degrees,
    signed towards the direction of rotation; tmax(f) -> thickness/chord. Rotor blades leave a tip gap,
    vanes a hub gap unless they have an inner shroud."""
    xm = (x0 + x1) / 2
    rh, rt = hub(xm), tip(xm)
    if kind == 'rotor': rt -= gap
    elif not hub_plat: rh += gap
    a1m, a2m = angles(0.5, (rh + rt) / 2)
    stag = abs((a1m + a2m) / 2) * D2R
    w = x1 - x0
    if count is None: count = blade_count((rh + rt) / 2, w / max(0.25, math.cos(stag)), solidity)
    pitch = 2 * math.pi / count
    def stations(n):
        out = []
        for j in range(n):
            f = j / (n - 1); r = rh + (rt - rh) * f
            a1, a2 = angles(f, r); st = abs((a1 + a2) / 2) * D2R
            c = w / max(0.25, math.cos(st))
            out.append((r, xm + sweep * f, lean * f, c, a1 * D2R, a2 * D2R, tmax(f)))
        return out
    # hub and tip follow the annulus walls along the chord (they slope steeply in the booster and LP turbine)
    dh, dt = rh - hub(xm), rt - tip(xm)
    rad = lambda f, x: (hub(x) + dh) + ((tip(x) + dt) - (hub(x) + dh)) * f
    hub_r = lambda x: hub(x) + dh; tip_r = lambda x: tip(x) + dt
    def skew(st0, r_s):   # angle offsets of a platform edge that follows the blade's camber at radius r_s
        sec = K.section(*[st0[0][3], st0[0][4], st0[0][5], st0[0][6]], n=8)
        le = min(sec, key=lambda p: p[0]); te_ = max(sec, key=lambda p: p[0])
        return le[1] / r_s, te_[1] / r_s
    def build(suffix, ns, npts, pnx, pnt, hd):
        st0 = stations(ns)
        parts = [K.blade(name + suffix + '_af', st0, mat, n=npts, caps=(not hub_plat, not (tip_plat or shroud)), te=te, le_round=le_round, rad=rad)]
        if hub_plat:
            s0, s1 = skew(st0, rh)
            parts.append(K.sector_band(name + suffix + '_hp', x0 - 0.003, x1 + 0.003, lambda x: hub_r(x) - 0.005, lambda x: hub_r(x) + 0.0005, pitch * 0.985, mat, s0, s1, nx=pnx, nt=pnt))
        if tip_plat:
            s0, s1 = skew(st0, rt)
            parts.append(K.sector_band(name + suffix + '_tp', x0 - 0.003, x1 + 0.003, lambda x: tip_r(x) - 0.0005, lambda x: tip_r(x) + 0.006, pitch * 0.985, mat, s0, s1, nx=pnx, nt=pnt))
        if shroud:   # tip shroud with two knife edges (LP turbine); the shroud sits on the cone, the knife edges are rings
            s0, s1 = skew(st0, rt)
            parts.append(K.sector_band(name + suffix + '_sh', x0 + 0.002, x1 - 0.002, lambda x: tip_r(x) - 0.0005, lambda x: tip_r(x) + 0.005, pitch * 0.995, mat, s0, s1, nx=pnx, nt=max(3, pnt)))
            for f in (0.3, 0.7):
                x = x0 + 0.002 + (x1 - x0 - 0.004) * f; rk = tip_r(x)
                parts.append(K.sector_band(name + suffix + '_ke', x - 0.0012, x + 0.0012, rk + 0.004, rk + 0.0105, pitch * 0.995, mat, s0 * (1 - f) + s1 * f, s0 * (1 - f) + s1 * f, nx=1, nt=max(3, pnt)))
        if vsv:   # variable vane: trunnion button, spindle out through the case, lever towards the unison ring
            xs, r_top, xu = vsv; sg = 20 if hd else 14
            parts.append(K.cyl(name + suffix + '_bt', (xs, 0, rt - 0.001), (xs, 0, rt + 0.005), 0.0075, mat, seg=sg))
            parts.append(K.cyl(name + suffix + '_sp', (xs, 0, rt + 0.005), (xs, 0, r_top + 0.004), 0.0032, mat, seg=sg - 4))
            parts.append(K.box(name + suffix + '_lv', ((xs + xu) / 2, 0, r_top + 0.002), (abs(xs - xu) + 0.012, 0.009, 0.004), 0, mat))
            parts.append(K.cyl(name + suffix + '_pn', (xu, 0, r_top + 0.004), (xu, 0, r_top + 0.012), 0.0026, mat, seg=sg - 6))
            if hd: parts.append(K.cyl(name + suffix + '_nt', (xs, 0, r_top + 0.004), (xs, 0, r_top + 0.008), 0.0045, M_BOLT[0] or mat, seg=6))   # spindle nut on the lever
        if extra_hi: parts += extra_hi(pitch, st0, rad, hd)
        return K.join(name + suffix, parts)
    # three levels: hd (high and ultra quality), mid (medium), lo (low)
    hi = build('', n_st + 4, (round(n_pts * 1.5) // 2) * 2, 6, (2 if pitch < 0.14 else 4) + 2, True)
    mid = build('_mid', n_st, n_pts, 4, 2 if pitch < 0.14 else 4, False)
    lo = K.blade(name + '_lo', stations(4), mat, n=6, caps=(True, True), rad=rad)
    extra = {'xs': vsv[0]} if vsv else {}
    extra['x'] = round(xm, 4); extra['blade'] = True
    return K.ring(name, hi, lo, part, count, 'vsv' if vsv else kind, spool=spool, cut=cut, extra=extra, mid=mid), count


def comp_rotor_angles(omega, vx, swirl_in_deg, turn_hub, turn_tip):
    """Compressor rotor metal angles from velocity triangles: inlet relative angle from blade speed, axial
    velocity and the swirl left by the vane ahead; the turning falls from hub to tip."""
    def f(fr, r):
        U = omega * r; b1 = math.degrees(math.atan2(U - vx * math.tan(swirl_in_deg * D2R), vx))
        b2 = b1 - (turn_hub + (turn_tip - turn_hub) * fr)
        return (-b1, -b2)
    return f


def vane_angles(a_in_hub, a_in_tip, a_out):
    return lambda fr, r: (a_in_hub + (a_in_tip - a_in_hub) * fr, a_out)


def prof_band(prof, x0, x1, d0, d1):
    """Loop for a casing that follows a flow-path profile at offsets d0 (inside) to d1 (outside)."""
    xs = [x0] + [p[0] for p in prof if x0 < p[0] < x1] + [x1]
    return [(x, r_at(prof, x) + d0) for x in xs] + [(x, r_at(prof, x) + d1) for x in reversed(xs)]


def flange(K, name, part, x, r0, r1, n, mat, bolt_mat, w=0.012, cut='wedge'):
    """Bolted casing flange: the ring, and a ring template of bolt heads (front) and nuts (rear)."""
    K.lathe(name, [(x - w / 2, r0), (x - w / 2, r1), (x + w / 2, r1), (x + w / 2, r0)], mat, cut=cut)
    rb = r1 - 0.008
    b = K.join(name + '_b', [K.hexbolt('h', x - w / 2, rb, bolt_mat, d=0.009, h=0.006, facing=-1), K.hexbolt('n', x + w / 2, rb, bolt_mat, d=0.009, h=0.007, facing=1),
                             K.cyl('s', (x + w / 2 + 0.007, 0, rb), (x + w / 2 + 0.01, 0, rb), 0.0028, bolt_mat, seg=8)])
    K.ring(name + '_bolts', b, None, part, n, 'static', phase=180.0 / n, cut=bool(cut))


def drill(K, objs, cutters):
    """Boolean the cutters (as one object) out of each object; the hole walls take the object's own material."""
    cut = K.join('cutter', cutters)
    for o in objs:
        m = o.modifiers.new('h', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cut; m.solver = 'EXACT'
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cut, do_unlink=True)


def radial_holes(K, specs, mat):
    """Cutters for rows of radial holes: (x, r_in, r_out, diameter, count, phase_deg)."""
    out = []
    for x, r0, r1, d, n, ph in specs:
        for k in range(n):
            c = K.cyl('hc', (x, 0, r0), (x, 0, r1), d / 2, mat, seg=14)
            c.matrix_world = Matrix.Rotation(math.radians(ph + 360.0 * k / n), 4, 'X') @ c.matrix_world
            out.append(c)
    return out


# ====================================================================== fan, booster, intermediate case, HP compressor
def build_front(K, M):
    """M: materials by name. Returns nothing; adds to K.made and K.rings."""
    M_BOLT[0] = M['bolt']
    # ---------------------------------------------------------------- fan
    # 22 hollow titanium wide-chord blades: about 0.26 m chord at the root, 0.42 m at the tip, twisted
    # some 30 degrees; thick at the root for the dovetail, thin at the tip.
    R0, R1 = 0.243, 0.806 - 0.0035
    def fan_st(n):
        out = []
        for j in range(n):
            f = j / (n - 1); r = R0 + (R1 - R0) * f
            b1 = 36 + 30 * f ** 0.85; b2 = 1.5 + 57 * f ** 1.25
            c = 0.258 + 0.165 * f ** 0.9
            t = 0.11 * (1 - f) ** 1.6 + 0.026
            out.append((r, 0.168 + 0.018 * f ** 1.5, -0.012 * f ** 2, c, -b1 * D2R, -b2 * D2R, t))
        return out
    fan_hi = K.blade('fanblade', fan_st(32), M['ti_fan'], n=40, caps=(True, True), te=0.003)
    fan_mid = K.blade('fanblade_mid', fan_st(22), M['ti_fan'], n=26, caps=(True, True), te=0.003)
    fan_lo = K.blade('fanblade_lo', fan_st(6), M['ti_fan'], n=8, caps=(True, True))
    K.ring('fan_blade', fan_hi, fan_lo, 'fan', 22, 'rotor', spool=1, extra={'x': 0.168, 'blade': True}, mid=fan_mid)
    # annulus fillers: the hub between each pair of blades is a separate panel following the blade roots,
    # with a rubber seal strip along both edges
    pitch = 2 * math.pi / 22
    rf = lambda x: 0.247 + 0.023 * (x - 0.02) / 0.28
    root = K.section(0.258, -36.5 * D2R, -1.6 * D2R, 0.136, n=24)
    def blade_s(x, rr):   # tangential extent of the blade root at axial position x (relative to the stack point)
        xl = x - 0.168; best = None
        pts = root + [root[0]]
        ss = []
        for (xa, sa), (xb, sb) in zip(pts, pts[1:]):
            if (xa - xl) * (xb - xl) <= 0 and xa != xb: ss.append(sa + (sb - sa) * (xl - xa) / (xb - xa))
        return (min(ss), max(ss)) if len(ss) >= 2 else None
    bm = bmesh.new(); NX, NT = 22, 10; top, bot = {}, {}
    xs_ = [0.02 + 0.28 * i / NX for i in range(NX + 1)]
    for i, x in enumerate(xs_):
        r = rf(x); a = blade_s(x, r); b = a
        lo_s = (a[1] + 0.003) if a else -r * pitch / 2       # this blade's upper surface
        hi_s = (b[0] - 0.003 + r * pitch) if b else r * pitch / 2 + 0.0   # the next blade's lower surface
        if not a: lo_s, hi_s = 0.0 - 0.0, r * pitch      # ahead of / behind the blades the panels meet edge to edge
        for j in range(NT + 1):
            s = lo_s + (hi_s - lo_s) * j / NT; t = s / r
            top[i, j] = bm.verts.new((x, -r * math.sin(t), r * math.cos(t)))
            r2 = r - 0.007; bot[i, j] = bm.verts.new((x, -r2 * math.sin(t), r2 * math.cos(t)))
    for i in range(NX):
        for j in range(NT):
            bm.faces.new((top[i, j], top[i + 1, j], top[i + 1, j + 1], top[i, j + 1]))
            bm.faces.new((bot[i, j + 1], bot[i + 1, j + 1], bot[i + 1, j], bot[i, j]))
        for j in (0, NT):
            q = (top[i, j], bot[i, j], bot[i + 1, j], top[i + 1, j]); bm.faces.new(q if j == 0 else tuple(reversed(q)))
    for i in (0, NX):
        for j in range(NT):
            q = (top[i, j + 1], bot[i, j + 1], bot[i, j], top[i, j]); bm.faces.new(q if i == 0 else tuple(reversed(q)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    filler = K.obj('filler', bm, [M['filler']])
    seal_objs = []   # rubber seal strips along the two edges that meet the blades
    for jside in (0, NT):
        loop = []
        for i in range(NX + 1):
            idx = (i * (NT + 1) + jside) * 2   # top vertex index (verts were created top, bot alternately per (i, j))
            loop.append(filler.data.vertices[idx].co.copy())
        bm = bmesh.new(); prev = None
        for p in loop:
            rr = math.hypot(p.y, p.z); n = Vector((0, p.y / rr, p.z / rr))
            a = bm.verts.new(p + n * 0.0025); b = bm.verts.new(p - n * 0.003)
            if prev: bm.faces.new((prev[0], prev[1], b, a))
            prev = (a, b)
        seal_objs.append(K.obj('fseal', bm, [M['rubber']], smooth=False))
    K.ring('fan_filler', K.join('filler', [filler] + seal_objs), None, 'fan', 22, 'rotor', spool=1, extra={'x': 0.16})
    # fan disc with its dovetail rim, web and bore, the stub shaft running back to bearings 1 and 2, and the
    # front blade retaining ring that locks the blades and fillers (36 bolts into the disc, 22 into the fillers)
    disc = [(0.045, 0.236), (0.29, 0.236), (0.29, 0.2), (0.25, 0.19), (0.215, 0.175), (0.2, 0.12), (0.215, 0.1), (0.215, 0.075), (0.13, 0.075),
            (0.13, 0.1), (0.145, 0.12), (0.13, 0.175), (0.09, 0.19), (0.045, 0.2)]
    K.lathe('fan_disc', disc, M['disc'], cut='deep')
    K.lathe('fan_stubshaft', [(0.2, 0.075), (0.2, 0.088), (0.32, 0.075), (0.62, 0.068), (1.03, 0.066), (1.03, 0.054), (0.62, 0.056), (0.32, 0.062), (0.21, 0.062)], M['disc'], cut='deep')
    K.lathe('fan_retainring', [(0.012, 0.13), (0.012, 0.245), (0.03, 0.245), (0.03, 0.236), (0.045, 0.236), (0.045, 0.2), (0.03, 0.2), (0.03, 0.13)], M['disc'], cut='deep')
    b36 = K.hexbolt('b36', 0.012, 0.165, M['bolt'], d=0.012, h=0.008)
    K.ring('fan_bolts36', b36, None, 'fan', 36, 'rotor', spool=1, extra={'x': 0.012})
    b22 = K.hexbolt('b22', 0.012, 0.226, M['bolt'], d=0.011, h=0.007)
    K.ring('fan_bolts22', b22, None, 'fan', 22, 'rotor', spool=1, phase=180 / 22, extra={'x': 0.012})
    # booster drum bolted to the back of the fan disc
    K.lathe('lpc_drum', [(0.285, 0.2), (0.285, 0.214), (0.36, 0.27), (0.45, 0.305), (0.88, 0.335), (0.88, 0.322), (0.45, 0.292), (0.36, 0.258), (0.3, 0.205)], M['disc'], cut='deep')

    # ---------------------------------------------------------------- fan outlet guide vanes (bypass), 60 at the fan frame
    row(K, 'fan_ogv', 'fancase', 1.0, 1.13, lambda x: r_at(BYP_INNER, x), lambda x: r_at(BYP_OUTER, x), vane_angles(30, 38, 0),
        lambda f: 0.075, M['ti'], 'stator', count=60, n_st=7, n_pts=12, hub_plat=True, tip_plat=True)

    # ---------------------------------------------------------------- booster (LPC): inner fan vanes, 4 stages
    row(K, 'lpc_igv', 'lpccase', 0.405, 0.44, ci, co, vane_angles(22, 30, 2), lambda f: 0.08, M['ti'], 'stator', solidity=1.2, hub_plat=True, tip_plat=True)
    turn = [(22, 12), (20, 11), (18, 10), (17, 9)]
    for i in range(4):
        x = 0.47 + i * 0.095
        row(K, f'lpc_r{i + 1}', 'lpc', x, x + 0.04, lambda q: ci(q) + 0.002, co, comp_rotor_angles(OMEGA_LP, 150, 2, *turn[i]),
            lambda f: 0.07 - 0.03 * f, M['ti'], 'rotor', spool=1, solidity=1.25, hub_plat=True)
        row(K, f'lpc_s{i + 1}', 'lpccase', x + 0.05, x + 0.085, ci, co, vane_angles(44, 38, 2), lambda f: 0.075, M['ti'], 'stator',
            solidity=1.3, hub_plat=True, tip_plat=True)
        K.lathe(f'lpc_disc{i + 1}', [(x + 0.008, ci(x + 0.02) - 0.004), (x + 0.032, ci(x + 0.02) - 0.004), (x + 0.03, ci(x) - 0.02), (x + 0.026, ci(x) - 0.045),
                                     (x + 0.032, ci(x) - 0.06), (x + 0.032, ci(x) - 0.075), (x + 0.008, ci(x) - 0.075), (x + 0.008, ci(x) - 0.06), (x + 0.014, ci(x) - 0.045), (x + 0.01, ci(x) - 0.02)], M['disc'], cut='deep', steps=96)
    # booster case with the 2.5 bleed ring
    K.lathe('lpccase_shell', [(0.4, co(0.4)), (0.4, co(0.4) + 0.014), (0.9, co(0.9) + 0.016), (0.9, co(0.9))] , M['case'])

    # ---------------------------------------------------------------- intermediate case: struts across the swan-neck duct
    # (the bottom one carries the tower shaft down to the angle gearbox)
    strut_ang = lambda fr, r: (0.0, 0.0)
    row(K, 'lpccase_strut', 'lpccase', 0.95, 1.09, ci, co, strut_ang, lambda f: 0.2, M['case'], 'stator', count=10, n_st=6, n_pts=12, hub_plat=False, tip_plat=False, te=0.03, le_round=1.3)
    # internal gearbox: bevel gears on the HP stub shaft and the tower shaft down the bottom strut
    K.lathe('bearings_igb', [(1.04, 0.12), (1.04, 0.15), (1.085, 0.135), (1.085, 0.118)], M['disc'], cut='deep', steps=96)
    tw = K.cyl('tower', (1.062, 0, 0.14), (1.062, 0, 0.46), 0.016, M['disc'], seg=16)
    tw.matrix_world = Matrix.Rotation(math.pi, 4, 'X') @ tw.matrix_world
    tw.name = tw.data.name = 'bearings_towershaft__full'; K.made.append(tw)

    # ---------------------------------------------------------------- HP compressor: IGV and VSVs, 10 stages, exit guide vanes
    # variable rows: IGV ahead of stage 3 and VSVs behind stages 3, 4 and 5; their levers reach forward to the unison rings
    xr0 = 1.17
    vsv_x = [1.1475] + [xr0 + 0.068 * i + 0.048 for i in range(3)]
    for k, xsp in enumerate(vsv_x):
        x0 = xsp - 0.012 if k == 0 else xsp - 0.012; x1 = x0 + 0.024
        rtop = co(xsp) + 0.04; xu = xsp - 0.024
        ang = vane_angles(0, 0, 22) if k == 0 else vane_angles(44, 40, 4)
        row(K, 'hpccase_igv' if k == 0 else f'hpccase_vsv{k}', 'hpccase', x0, x1, ci, co, ang, lambda f: 0.07, M['vsv'], 'stator',
            solidity=1.2, vsv=(xsp, rtop, xu), hub_plat=False, n_st=7, n_pts=12)
        uo = co(xu) + 0.034
        K.lathe(f'hpccase_unison{k}', [(xu - 0.006, uo + 0.008), (xu - 0.006, uo + 0.02), (xu + 0.006, uo + 0.02), (xu + 0.006, uo + 0.008)], M['steel'], cut='wedge', steps=144)
    for i in range(10):
        x = xr0 + 0.068 * i; w = 0.034 - 0.0015 * i
        mat = M['ti'] if i < 6 else M['nickel']
        row(K, f'hpc_r{i + 3}', 'hpc', x, x + w, lambda q: ci(q) + 0.001, co, comp_rotor_angles(OMEGA_HP, 175 - 3 * i, 20 if i == 0 else 8, 20 - 0.4 * i, 13 - 0.3 * i),
            lambda f: 0.065 - 0.025 * f, mat, 'rotor', spool=2, solidity=1.3 + 0.02 * i, hub_plat=True)
        if i >= 3:
            xs0 = x + 0.036; last = i == 9
            row(K, f'hpccase_s{i + 3}', 'hpccase', xs0, xs0 + (0.03 if last else 0.024), ci, co, vane_angles(46, 42, 0 if last else 6), lambda f: 0.075, mat, 'stator',
                solidity=1.4 if last else 1.35, hub_plat=True, tip_plat=True, n_st=6, n_pts=12)
        # disc: rim under the blades, thin web, thick bore; knife-edge seal teeth under the next stator
        rr = ci(x + w / 2) - 0.006; bore = 0.09 + 0.012 * i / 9
        K.lathe(f'hpc_disc{i + 3}', [(x + 0.002, rr), (x + w - 0.002, rr), (x + w - 0.004, rr - 0.012), (x + w / 2 + 0.004, rr - 0.03), (x + w / 2 + 0.004, bore + 0.03), (x + w / 2 + 0.014, bore + 0.012),
                                     (x + w / 2 + 0.014, bore), (x + w / 2 - 0.014, bore), (x + w / 2 - 0.014, bore + 0.012), (x + w / 2 - 0.004, bore + 0.03), (x + w / 2 - 0.004, rr - 0.03), (x + 0.004, rr - 0.012)],
               M['disc'], cut='deep', steps=96)
        xn = x + w; xn1 = xr0 + 0.068 * (i + 1)
        if i < 9:   # drum spacer between discs, carrying the seal teeth
            rs = min(ci(xn), ci(xn1)) - 0.008
            K.lathe(f'hpc_spacer{i + 3}', [(xn - 0.003, rr - 0.004), (xn1 + 0.003, ci(xn1 + 0.01) - 0.01), (xn1 + 0.003, ci(xn1 + 0.01) - 0.014), (xn - 0.003, rr - 0.008)], M['disc'], cut='deep', steps=96)
            for kk in range(3):
                xk = xn + 0.008 + kk * 0.008
                rk = rr - 0.004 + (ci(xn1 + 0.01) - 0.01 - rr + 0.004) * (xk - xn) / (xn1 - xn)
                K.lathe(f'hpc_ke{i}_{kk}', [(xk - 0.0012, rk - 0.001), (xk, rk + 0.005), (xk + 0.0012, rk - 0.001)], M['disc'], cut='deep', steps=96)
    # HPC cases: front case (variable vanes) and rear case with the stage 7 and 10 bleed manifolds
    K.lathe('hpccase_front', [(1.15, co(1.15)), (1.15, co(1.15) + 0.026), (1.42, co(1.42) + 0.024), (1.42, co(1.42))], M['case'])
    K.lathe('hpccase_rear', [(1.42, co(1.42)), (1.42, co(1.42) + 0.024), (1.52, co(1.52) + 0.05), (1.62, co(1.62) + 0.05), (1.66, co(1.66) + 0.024),
                             (1.74, co(1.74) + 0.024), (1.76, co(1.76) + 0.046), (1.84, co(1.84) + 0.046), (1.88, co(1.88) + 0.026), (1.88, co(1.88))], M['case'])
    for x, n in ((1.15, 40), (1.42, 44), (1.88, 48)):
        flange(K, f'hpccase_flange{int(round(x * 100))}', 'hpccase', x, co(x) + 0.02, co(x) + 0.045, n, M['case'], M['bolt'])


# ====================================================================== combustor, turbines, exhaust case, shafts, bearings
def build_rear(K, M):
    # ---------------------------------------------------------------- diffuser case
    # HPC exit -> pre-diffuser -> dump round the combustor; the outer wall bulges round the liner (TTM figure)
    K.lathe('combcase_outer', [(1.88, co(1.88) + 0.004), (1.88, co(1.88) + 0.03), (1.95, 0.372), (2.0, 0.388), (2.1, 0.388), (2.16, 0.372), (2.2, co(2.2) + 0.032),
                               (2.2, co(2.2) + 0.014), (2.16, 0.36), (2.1, 0.376), (2.0, 0.376), (1.95, 0.36), (1.885, co(1.885) + 0.02)], M['case'])
    flange(K, 'combcase_flange205', 'combcase', 2.05, 0.384, 0.406, 48, M['case'], M['bolt'], w=0.012)
    # pre-diffuser: the annulus leaving the HP compressor widens before the air dumps round the dome
    K.lathe('combcase_prediff', [(1.88, 0.252), (1.92, 0.27), (1.92, 0.265), (1.885, 0.248), (1.885, 0.217), (1.92, 0.206), (1.92, 0.201), (1.88, 0.213)], M['case'])
    # pre-diffuser struts tie the two walls together
    row(K, 'combcase_pdstrut', 'combcase', 1.886, 1.916, lambda x: 0.217 - 0.011 * (x - 1.885) / 0.035, lambda x: 0.248 + 0.022 * (x - 1.885) / 0.035,
        lambda f, r: (0, 0), lambda f: 0.16, M['case'], 'stator', count=20, n_st=4, n_pts=10, gap=0.0, te=0.02, le_round=1.3)
    # inner case: from the pre-diffuser inner wall round the No. 4 bearing chamber to the HP turbine
    K.lathe('combcase_inner', [(1.92, 0.201), (1.97, 0.178), (2.15, 0.178), (2.2, 0.2), (2.2, 0.206), (2.15, 0.184), (1.97, 0.184), (1.926, 0.206)], M['case'])
    # HPC discharge seal: honeycomb land on the inner case, knife edges on the HP shaft cone below it
    K.lathe('combcase_seal', [(1.884, 0.168), (1.918, 0.15), (1.918, 0.156), (1.946, 0.183), (1.94, 0.186), (1.913, 0.161), (1.884, 0.175)], M['case'], cut='deep', steps=96)
    K.lathe('combcase_tobi', [(2.2, 0.2), (2.258, 0.198), (2.262, 0.204), (2.262, 0.222), (2.252, 0.222), (2.252, 0.206), (2.2, 0.206)], M['case'], cut='deep', steps=96)
    # twenty fuel-injector pads, two igniter bosses and six borescope bosses round the case
    pad = K.join('pad', [K.cyl('p', (1.94, 0, 0.352), (1.94, 0, 0.384), 0.018, M['case'], seg=16), K.box('pf', (1.94, 0, 0.384), (0.048, 0.034, 0.008), 0, M['case'])])
    K.ring('combcase_pads', pad, None, 'combcase', 20, 'static', phase=9.0)
    ib = K.cyl('ib', (2.01, 0, 0.37), (2.01, 0, 0.392), 0.016, M['case'], seg=16)
    K.ring('combcase_ignboss', ib, None, 'combcase', 2, 'static', phase=47.5)
    bs = K.join('bore', [K.cyl('bs', (2.12, 0, 0.368), (2.12, 0, 0.392), 0.012, M['case'], seg=12), K.cyl('bp', (2.12, 0, 0.392), (2.12, 0, 0.398), 0.009, M['bolt'], seg=6)])
    K.ring('combcase_bores', bs, None, 'combcase', 6, 'static', phase=30.0)

    # ---------------------------------------------------------------- annular combustor
    # Outer and inner liners of overlapping cooled panels: each panel flares away from the flame towards its
    # rear, and the next starts beneath its lip, leaving a slot that lays a film of cooling air along the
    # hot wall. A ring joins each pair. Primary and dilution holes go right through.
    r_out = lambda x: r_at([(1.968, 0.3), (2.12, 0.306), (2.22, 0.3035)], x)    # hot side of the outer liner
    r_in = lambda x: r_at([(1.968, 0.208), (2.08, 0.2), (2.15, 0.206), (2.22, 0.2355)], x)
    XS = [1.968, 2.02, 2.075, 2.13, 2.22]
    def liner(name, rfun, sign):
        objs = []
        for k, (a, b) in enumerate(zip(XS, XS[1:])):
            last = k == len(XS) - 2; bb = b if last else b + 0.008
            hot, cold = [], []
            for j in range(9):
                x = a + (bb - a) * j / 8; s = 0.0 if last else min(1.0, (x - a) / (b - a))
                r = rfun(x) + sign * 0.003 * s
                hot.append((x, r)); cold.append((x, r + sign * 0.0018))
            objs += K.lathe(f'{name}{k}', hot + list(reversed(cold)), M['liner'], steps=144)
            if k:   # joining ring under the previous panel's lip
                r0 = rfun(a + 0.0025)
                objs += K.lathe(f'{name}{k}r', [(a + 0.001, r0 + sign * 0.0018), (a + 0.004, r0 + sign * 0.0018), (a + 0.004, r0 + sign * 0.0031), (a + 0.001, r0 + sign * 0.0031)], M['liner'], steps=144)
        return objs
    outer = liner('liner_outer', r_out, +1)
    inner = liner('liner_inner', r_in, -1)
    drill(K, [o for o in outer if o.name in ('liner_outer1', 'liner_outer1__cut', 'liner_outer2', 'liner_outer2__cut', 'liner_outer0', 'liner_outer0__cut')],
          radial_holes(K, [(2.042, 0.29, 0.32, 0.02, 20, 9.0), (2.106, 0.29, 0.32, 0.023, 20, 0.0), (2.106, 0.29, 0.32, 0.013, 20, 9.0), (2.008, 0.29, 0.32, 0.016, 2, 47.5)], M['liner']))
    drill(K, [o for o in inner if o.name in ('liner_inner1', 'liner_inner1__cut', 'liner_inner2', 'liner_inner2__cut')],
          radial_holes(K, [(2.042, 0.18, 0.215, 0.017, 20, 9.0), (2.106, 0.18, 0.215, 0.02, 20, 0.0), (2.106, 0.18, 0.215, 0.011, 20, 9.0)], M['liner']))
    # dome bulkhead with a hole for each swirler, and the hood (cowl) ahead of it that guides air in
    dome = K.lathe('liner_dome', [(1.955, 0.206), (1.955, 0.302), (1.968, 0.302), (1.968, 0.206)], M['liner'])
    cut = []
    for k in range(20):
        t = math.radians(9 + 18 * k); r = 0.254
        cut.append(K.cyl('sw', (1.94, -r * math.sin(t), r * math.cos(t)), (1.98, -r * math.sin(t), r * math.cos(t)), 0.0195, M['liner'], seg=18))
    drill(K, dome, cut)
    K.lathe('liner_hood', [(1.945, 0.287), (1.951, 0.296), (1.957, 0.302), (1.96, 0.3), (1.954, 0.294), (1.948, 0.286)], M['liner'])
    K.lathe('liner_hoodi', [(1.945, 0.221), (1.951, 0.212), (1.957, 0.206), (1.96, 0.208), (1.954, 0.214), (1.948, 0.222)], M['liner'])
    # swirler for each injector: a cup with radial vanes round a ferrule that takes the injector tip
    cup = [K.cyl('cu', (1.95, 0, 0.254), (1.972, 0, 0.254), 0.0205, M['liner'], seg=20, r2=0.0185),
           K.cyl('fe', (1.948, 0, 0.254), (1.958, 0, 0.254), 0.0105, M['liner'], seg=16)]
    for k in range(10):
        a = 2 * math.pi * k / 10
        cup.append(K.box('cv', (1.956, -0.0145 * math.sin(a), 0.254 + 0.0145 * math.cos(a)), (0.012, 0.0085, 0.0014), math.degrees(a) + 115, M['liner']))
    K.ring('liner_swirler', K.join('swirler', cup), None, 'liner', 20, 'static', phase=9.0)

    # ---------------------------------------------------------------- fuel injectors and manifold
    # each injector bolts to its pad; the stem passes through the case, and the airblast tip turns aft
    # through the hood into its swirler. Fuel comes from the manifold ring through a short inlet arm.
    st = (1.94, 0.388); el = (1.932, 0.272); tip = (1.947, 0.256)
    inj = [K.box('fl', (1.94, 0, 0.392), (0.048, 0.034, 0.008), 0, M['steel']),
           K.cyl('bd', (1.94, 0, 0.396), (1.94, 0, 0.428), 0.0095, M['steel'], seg=14),
           K.cyl('cp', (1.94, 0, 0.428), (1.94, 0, 0.433), 0.007, M['steel'], seg=6),
           K.cyl('in', (1.94, 0, 0.424), (1.926, 0, 0.424), 0.005, M['steel'], seg=10),
           K.cyl('nu', (1.932, 0, 0.424), (1.929, 0, 0.424), 0.0068, M['bolt'], seg=6),
           K.cyl('st', (st[0], 0, st[1]), (el[0], 0, el[1]), 0.0082, M['steel'], seg=14),
           K.sphere('j1', (el[0], 0, el[1]), 0.0082, M['steel']),
           K.cyl('sb', (el[0], 0, el[1]), (tip[0], 0, tip[1]), 0.0082, M['steel'], seg=14),
           K.sphere('j2', (tip[0], 0, tip[1]), 0.0082, M['steel']),
           K.cyl('tp', (1.944, 0, 0.254), (1.958, 0, 0.254), 0.0095, M['steel'], seg=16, r2=0.0065)]
    for dx in (-0.017, 0.017): inj.append(K.cyl('ib', (1.94 + dx, 0, 0.396), (1.94 + dx, 0, 0.402), 0.0048, M['bolt'], seg=6))
    K.ring('fuel_injector', K.join('injector', inj), None, 'fuel', 20, 'static', phase=9.0, cut=False)
    man = [(1.917 + 0.0115 * math.cos(2 * math.pi * k / 14), 0.424 + 0.0115 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
    K.lathe('fuel_manifold', man, M['steel'], steps=180)
    clip = K.join('clip', [K.box('cb', (1.917, 0, 0.437), (0.018, 0.012, 0.003), 0, M['steel']), K.box('cl', (1.917, 0, 0.41), (0.006, 0.01, 0.05), 0, M['steel'])])
    K.ring('fuel_clip', clip, None, 'fuel', 10, 'static', phase=0.0)

    # ---------------------------------------------------------------- igniter plugs (47.5 and 227.5 deg, where dressing.py routes the leads)
    ign = K.join('igniter', [K.cyl('ih', (2.01, 0, 0.392), (2.01, 0, 0.406), 0.0125, M['steel'], seg=6), K.cyl('ib', (2.01, 0, 0.406), (2.01, 0, 0.426), 0.0085, M['ceramic'], seg=14),
                             K.cyl('ic', (2.01, 0, 0.426), (2.01, 0, 0.436), 0.0095, M['steel'], seg=14),
                             K.cyl('is', (2.01, 0, 0.392), (2.01, 0, 0.3045), 0.0072, M['steel'], seg=14), K.cyl('it', (2.01, 0, 0.3045), (2.01, 0, 0.303), 0.0055, M['ceramic'], seg=12)])
    K.ring('ign_plug', ign, None, 'ign', 2, 'static', phase=47.5, cut=False)

    # ---------------------------------------------------------------- HP turbine: 2 stages
    def squealer(st0, rad, hd):   # HPT blade tip: a thin rim round a recessed cap, so a rub only wears the rim
        r, xs, sl, c, a1, a2, tm = st0[-1]
        bm = bmesh.new(); n = 24 if hd else 16
        outer_ = K.section(c, a1, a2, tm, n, 0.03, 1.4); inner_ = K.section(c * 0.84, a1, a2, tm * 0.42, n, 0.03, 1.4)
        def ring_(sec, dz):
            out = []
            for x, s in sec:
                rr = rad(1.0, xs + x) + dz
                out.append(bm.verts.new((xs + x, -rr * math.sin((s + sl) / rr), rr * math.cos((s + sl) / rr))))
            return out
        o0, o1, i1, i0 = ring_(outer_, -0.0004), ring_(outer_, 0.0035), ring_(inner_, 0.0035), ring_(inner_, -0.0004)
        k = len(o0)
        for A, B in ((o0, o1), (o1, i1), (i1, i0), (i0, o0)):
            for i in range(k): bm.faces.new((A[i], A[(i + 1) % k], B[(i + 1) % k], B[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return [K.obj('sq', bm, [M['hptb']])]
    def cool_holes(st0, rad, offs, te, le_round, per=9, span=(0.12, 0.88), d=0.0011):
        """Rows of film-cooling holes near the leading edge (and gill holes on the pressure side): small dark
        bores through the airfoil skin, at loop offsets offs from the leading edge."""
        parts, n = [], 16
        for j in range(per):
            f = span[0] + (span[1] - span[0]) * j / (per - 1)
            q = f * (len(st0) - 1); i0 = min(int(q), len(st0) - 2); w = q - i0
            r, xs, sl, c, a1, a2, tm = [p0 + (p1 - p0) * w for p0, p1 in zip(st0[i0], st0[i0 + 1])]
            sec = K.section(c, a1, a2, tm, n, te, le_round)
            for off in offs:
                i = n + off + (j % 2 if off else 0)   # stagger alternate rows
                px, ps = sec[i]; tx = sec[i + 1][0] - sec[i - 1][0]; ts = sec[i + 1][1] - sec[i - 1][1]
                nx, ns = ts, -tx; l = math.hypot(nx, ns) + 1e-12; nx /= l; ns /= l
                if nx * px + ns * ps < 0: nx, ns = -nx, -ns
                rr = rad(f, xs + px); a = (ps + sl) / rr
                P = Vector((xs + px, -rr * math.sin(a), rr * math.cos(a))); N3 = Vector((nx, -ns * math.cos(a), -ns * math.sin(a)))
                parts.append(K.cyl('ch', P - N3 * 0.0005, P + N3 * 0.00025, d, M['hole'], seg=6))
        return parts
    blade_x = lambda te, le: lambda pitch, st0, rad, hd: squealer(st0, rad, hd) + (cool_holes(st0, rad, (0, -2, 2, 6), te, le) if hd else [])
    vane_x = lambda te, le: lambda pitch, st0, rad, hd: cool_holes(st0, rad, (-3, 0, 3, 7), te, le, per=8) if hd else []
    hpt_tip = lambda q: co(q) - 0.0035
    row(K, 'hptcase_ngv1', 'hptcase', 2.225, 2.265, ci, co, vane_angles(0, 0, 72), lambda f: 0.26, M['tbc'], 'stator', solidity=1.25, hub_plat=True, tip_plat=True,
        te=0.03, le_round=1.45, n_st=6, n_pts=16, extra_hi=vane_x(0.03, 1.45))
    row(K, 'hpt_r1', 'hpt', 2.275, 2.315, lambda q: ci(q) + 0.001, hpt_tip, lambda f, r: (42 - 6 * f, -62 - 3 * f), lambda f: 0.27 - 0.08 * f, M['hptb'], 'rotor', spool=2,
        solidity=1.3, hub_plat=True, te=0.03, le_round=1.45, n_st=8, n_pts=16, extra_hi=blade_x(0.03, 1.45))
    row(K, 'hptcase_ngv2', 'hptcase', 2.325, 2.365, ci, co, vane_angles(-26, -20, 66), lambda f: 0.22, M['tbc'], 'stator', solidity=1.25, hub_plat=True, tip_plat=True,
        te=0.025, le_round=1.35, n_st=6, n_pts=16, extra_hi=vane_x(0.025, 1.35))
    row(K, 'hpt_r2', 'hpt', 2.375, 2.415, lambda q: ci(q) + 0.001, hpt_tip, lambda f, r: (38 - 8 * f, -58 - 4 * f), lambda f: 0.23 - 0.08 * f, M['hptb'], 'rotor', spool=2,
        solidity=1.25, hub_plat=True, te=0.025, le_round=1.4, n_st=8, n_pts=16, extra_hi=blade_x(0.025, 1.4))
    # blade outer air seals over each rotor, and the vane supports between
    for k, (a, b) in enumerate(((2.268, 2.322), (2.368, 2.422))):
        K.lathe(f'hptcase_oas{k + 1}', prof_band(CORE_OUTER, a, b, 0.0005, 0.013), M['honey'], steps=144)
    for k, (a, b) in enumerate(((2.222, 2.268), (2.322, 2.368))):
        K.lathe(f'hptcase_vsup{k + 1}', prof_band(CORE_OUTER, a + 0.004, b - 0.004, 0.006, 0.014), M['hot'], steps=144)
    # discs: fir-tree rim under the blades, web, deep bore; a cover plate on the front of disc 1 and an
    # interstage spacer carrying knife edges under the second vanes
    for k, (x0, x1) in enumerate(((2.275, 2.315), (2.375, 2.415))):
        xm = (x0 + x1) / 2; rim = ci(xm) - 0.004
        K.lathe(f'hpt_disc{k + 1}', [(x0 + 0.002, rim), (x1 - 0.002, rim), (x1, rim - 0.025), (xm + 0.009, rim - 0.05), (xm + 0.007, 0.16), (xm + 0.024, 0.15), (xm + 0.024, 0.118),
                                     (xm - 0.024, 0.118), (xm - 0.024, 0.15), (xm - 0.007, 0.16), (xm - 0.009, rim - 0.05), (x0, rim - 0.025)], M['disc'], cut='deep', steps=144)
        K.lathe(f'hpt_rimseal{k + 1}', [(x0 - 0.004, rim - 0.002), (x0, rim - 0.002), (x0, rim - 0.006), (x0 - 0.004, rim - 0.006)], M['disc'], cut='deep', steps=144)
    K.lathe('hpt_cover1', [(2.267, 0.232), (2.271, 0.232), (2.282, 0.172), (2.278, 0.172)], M['disc'], cut='deep', steps=144)
    K.lathe('hpt_spacer', [(2.315, 0.21), (2.375, 0.21), (2.375, 0.2), (2.315, 0.2)], M['disc'], cut='deep', steps=144)
    for kk in range(3):
        xk = 2.332 + 0.013 * kk
        K.lathe(f'hpt_ke{kk}', [(xk - 0.0014, 0.2095), (xk, 0.2165), (xk + 0.0014, 0.2095)], M['disc'], cut='deep', steps=144)
    K.lathe('hptcase_ngv2seal', [(2.324, 0.218), (2.366, 0.218), (2.366, ci(2.366) - 0.005), (2.324, ci(2.324) - 0.005)], M['honey'], cut='deep', steps=144)
    # HP shaft: cone from the back of HPC disc 12 down past the No. 4 bearing and up to the front of HPT disc 1
    K.lathe('hpshaft_cone', [(1.8, 0.2), (1.81, 0.2), (1.95, 0.104), (2.22, 0.104), (2.258, 0.172), (2.286, 0.172), (2.286, 0.162), (2.262, 0.162), (2.226, 0.094),
                             (1.946, 0.094), (1.8, 0.19)], M['shaft'], cut='deep', steps=144)
    for kk in range(3):   # discharge seal teeth on the cone
        xk = 1.888 + 0.012 * kk; rk = 0.2 - 0.096 * (xk - 1.81) / 0.14
        K.lathe(f'hpshaft_ke{kk}', [(xk - 0.0014, rk - 0.002), (xk, rk + 0.011 - 0.006 * kk / 2), (xk + 0.0014, rk - 0.002)], M['shaft'], cut='deep', steps=96)
    K.lathe('hptcase_shell', prof_band(CORE_OUTER, 2.2, 2.45, 0.014, 0.032), M['hot'])
    for x, n in ((2.21, 48), (2.44, 52)):
        flange(K, f'hptcase_flange{int(round(x * 100))}', 'hptcase', x, co(x) + 0.028, co(x) + 0.05, n, M['hot'], M['bolt'])

    # ---------------------------------------------------------------- LP turbine: 5 stages (3-7), shrouded blades, bolted discs
    lpt_rims = []
    for i in range(5):
        xs0 = 2.455 + i * 0.108; xr = xs0 + 0.054; xm = xr + 0.019
        row(K, f'lptcase_v{i + 3}', 'lptcase', xs0, xs0 + 0.042, ci, co, vane_angles(-34, -28, 50), lambda f: 0.11, M['lptb'], 'stator', solidity=1.1,
            hub_plat=True, tip_plat=True, te=0.012, le_round=1.15, n_st=8, n_pts=14)
        row(K, f'lpt_r{i + 3}', 'lpt', xr, xr + 0.038, lambda q: ci(q) + 0.001, lambda q: co(q) - 0.006, lambda f, r: (34 - 6 * f, -54 - 3 * f), lambda f: 0.1 - 0.04 * f,
            M['lptb'], 'rotor', spool=1, solidity=1.0, hub_plat=True, shroud=True, te=0.01, le_round=1.15, n_st=9, n_pts=14)
        rim = ci(xm) - 0.004; lpt_rims.append((xr, xm, rim))
        K.lathe(f'lpt_disc{i + 3}', [(xr + 0.002, rim), (xr + 0.036, rim), (xr + 0.036, rim - 0.018), (xm + 0.005, rim - 0.03), (xm + 0.005, 0.2), (xm + 0.013, 0.188), (xm + 0.013, 0.168),
                                     (xm - 0.013, 0.168), (xm - 0.013, 0.188), (xm - 0.005, 0.2), (xm - 0.005, rim - 0.03), (xr + 0.002, rim - 0.018)], M['disc'], cut='deep', steps=144)
        # honeycomb in the case over each shroud, and under each vane's inner shroud
        K.lathe(f'lptcase_hc{i + 3}', prof_band(CORE_OUTER, xr - 0.002, xr + 0.04, 0.0035, 0.009), M['honey'], steps=144)
        K.lathe(f'lptcase_ihc{i + 3}', [(xs0, ci(xs0) - 0.0105), (xs0 + 0.042, ci(xs0 + 0.042) - 0.0105), (xs0 + 0.042, ci(xs0 + 0.042) - 0.005), (xs0, ci(xs0) - 0.005)], M['honey'], cut='deep', steps=144)
    for i in range(4):   # seal arms between discs: knife edges under the next vane row, bolted flange at the next disc
        (xa, _, ra), (xb, _, rb) = lpt_rims[i], lpt_rims[i + 1]
        x0, x1 = xa + 0.036, xb + 0.002; ar = lambda x: ra - 0.01 + (rb - ra) * (x - x0) / (x1 - x0)
        K.lathe(f'lpt_arm{i + 3}', [(x0, ar(x0)), (x1, ar(x1)), (x1, ar(x1) - 0.004), (x0, ar(x0) - 0.004)], M['disc'], cut='deep', steps=144)
        for kk in range(3):
            xk = xa + 0.064 + 0.012 * kk
            K.lathe(f'lpt_ke{i + 3}_{kk}', [(xk - 0.0013, ar(xk) - 0.001), (xk, ci(xk) - 0.0112), (xk + 0.0013, ar(xk) - 0.001)], M['disc'], cut='deep', steps=144)
        xf = x1 - 0.006; rf = ar(xf) - 0.004
        K.lathe(f'lpt_flange{i + 3}', [(xf - 0.003, rf), (xf + 0.003, rf), (xf + 0.003, rf - 0.014), (xf - 0.003, rf - 0.014)], M['disc'], cut='deep', steps=144)
        b = K.join('lb', [K.hexbolt('h', xf - 0.003, rf - 0.008, M['bolt'], d=0.007, h=0.005, facing=-1), K.hexbolt('n', xf + 0.003, rf - 0.008, M['bolt'], d=0.007, h=0.005, facing=1)])
        K.ring(f'lpt_bolts{i + 3}', b, None, 'lpt', 40, 'rotor', spool=1, cut='deep', extra={'x': round(xf, 4)})
    # drive cone from the web of disc 6 down to the LP shaft coupling, with its bolt circle
    xm6 = lpt_rims[3][1]
    K.lathe('lpt_cone', [(xm6 + 0.005, 0.214), (xm6 + 0.005, 0.206), (2.937, 0.062), (2.937, 0.05), (2.947, 0.05), (2.947, 0.076), (xm6 + 0.011, 0.214)], M['disc'], cut='deep', steps=144)
    cb = K.hexbolt('cb', 2.947, 0.066, M['bolt'], d=0.007, h=0.005, facing=1)
    K.ring('lpt_conebolts', cb, None, 'lpt', 24, 'rotor', spool=1, cut='deep', extra={'x': 2.947})
    K.lathe('lptcase_shell', prof_band(CORE_OUTER, 2.45, 3.02, 0.009, 0.026), M['hot'])
    for x, n in ((2.62, 56), (2.82, 60), (3.01, 64)):
        flange(K, f'lptcase_flange{int(round(x * 100))}', 'lptcase', x, co(x) + 0.022, co(x) + 0.044, n, M['hot'], M['bolt'], w=0.01)

    # ---------------------------------------------------------------- turbine exhaust case: 13 struts, No. 5 bearing housing, exhaust plug
    row(K, 'tec_strut', 'tec', 3.03, 3.115, ci, co, lambda f, r: (18, 0), lambda f: 0.2, M['tec'], 'stator', count=13, n_st=5, n_pts=14, gap=0.0, te=0.02, le_round=1.3)
    K.lathe('tec_hub', [(3.0, ci(3.0)), (3.12, ci(3.12)), (3.12, ci(3.12) - 0.009), (3.0, ci(3.0) - 0.009)], M['tec'])
    K.lathe('tec_bulkhead', [(3.11, ci(3.11) - 0.009), (3.12, ci(3.12) - 0.009), (3.12, 0.1), (3.11, 0.1)], M['tec'], cut='deep')
    K.lathe('tec_outer', prof_band(CORE_OUTER, 3.02, 3.12, 0.002, 0.022), M['tec'])
    K.lathe('tec_plug', [(3.12, ci(3.12)), (3.16, 0.258), (3.5, 0.17), (3.85, 0.065), (3.935, 0.035), (3.935, 0.029), (3.845, 0.059), (3.49, 0.164), (3.16, 0.25), (3.12, ci(3.12) - 0.008)], M['tec'])
    K.lathe('tec_plugflange', [(3.12, 0.234), (3.13, 0.234), (3.13, ci(3.12) - 0.009), (3.12, ci(3.12) - 0.009)], M['tec'], cut='deep')
    pb = K.hexbolt('pb', 3.13, 0.243, M['bolt'], d=0.009, h=0.006, facing=1)
    K.ring('tec_bolts', pb, None, 'tec', 13, 'static', cut='deep', extra={'x': 3.13})
    probe = K.join('probe', [K.cyl('pb', (3.06, 0, co(3.06) + 0.018), (3.06, 0, co(3.06) + 0.034), 0.011, M['tec'], seg=12),
                             K.cyl('pp', (3.06, 0, co(3.06) + 0.034), (3.06, 0, co(3.06) + 0.044), 0.007, M['steel'], seg=6)])
    K.ring('tec_probes', probe, None, 'tec', 13, 'static', phase=0.0)

    # ---------------------------------------------------------------- shafts
    K.lathe('lpshaft_main', [(0.3, 0.03), (0.3, 0.05), (0.36, 0.05), (0.36, 0.046), (2.93, 0.046), (2.93, 0.05), (3.1, 0.05), (3.1, 0.03)], M['shaft'], cut='deep', steps=72)
    K.lathe('lpshaft_coupling', [(0.3, 0.05), (0.36, 0.05), (0.36, 0.0615), (0.3, 0.0615)], M['shaft'], cut='deep', steps=72)
    K.lathe('lpshaft_nut', [(0.284, 0.03), (0.3, 0.03), (0.3, 0.06), (0.284, 0.06)], M['shaft'], cut='deep', steps=6)
    K.lathe('hpshaft_stub', [(1.08, 0.094), (1.08, 0.104), (1.15, 0.104), (1.178, 0.14), (1.183, 0.14), (1.183, 0.132), (1.156, 0.094)], M['shaft'], cut='deep', steps=96)

    # ---------------------------------------------------------------- main bearings and their chambers
    def bearing(name, x, r_in, r_out, w, kind, n):
        rm = (r_in + r_out) / 2; h = r_out - r_in; t = h * 0.28
        K.lathe(name + '_inner', [(x - w / 2, r_in), (x + w / 2, r_in), (x + w / 2, r_in + t), (x + w * 0.38, r_in + t), (x + w * 0.38, r_in + t + 0.002),
                                  (x - w * 0.38, r_in + t + 0.002), (x - w * 0.38, r_in + t), (x - w / 2, r_in + t)], M['race'], cut='deep', steps=96)
        K.lathe(name + '_outer', [(x - w / 2, r_out - t), (x - w * 0.38, r_out - t), (x - w * 0.38, r_out - t - 0.002), (x + w * 0.38, r_out - t - 0.002),
                                  (x + w * 0.38, r_out - t), (x + w / 2, r_out - t), (x + w / 2, r_out), (x - w / 2, r_out)], M['race'], cut='deep', steps=96)
        if kind == 'ball':
            el = K.sphere(name + '_el', (x, 0, rm), (h - 2 * t) * 0.5, M['race'], seg=14); half = (h - 2 * t) * 0.5
        else:
            half = w * 0.3; el = K.cyl(name + '_el', (x - half, 0, rm), (x + half, 0, rm), (h - 2 * t) * 0.5 - 0.002, M['race'], seg=14)
        K.ring(name.replace('bearings_', 'bearings_el'), el, None, 'bearings', n, 'static', cut='deep', extra={'x': x})
        for sgn in (-1, 1):   # cage side rails, bars between the rolling elements
            xc = x + sgn * (half + 0.0025)
            K.lathe(f'{name}_cage{"af" if sgn > 0 else "fw"}', [(xc - 0.0015, rm - 0.004), (xc + 0.0015, rm - 0.004), (xc + 0.0015, rm + 0.004), (xc - 0.0015, rm + 0.004)], M['bronze'], cut='deep', steps=96)
        bar = K.box(name + '_bar', (x, 0, rm), (2 * half + 0.004, 0.0018, 0.006), 0, M['bronze'])
        K.ring(name.replace('bearings_', 'bearings_cage'), bar, None, 'bearings', n, 'static', phase=180.0 / n, cut='deep', extra={'x': x})
    bearing('bearings_no1', 0.52, 0.071, 0.108, 0.045, 'ball', 16)
    bearing('bearings_no2', 1.0, 0.0665, 0.1, 0.034, 'roller', 24)
    bearing('bearings_no3', 1.12, 0.104, 0.146, 0.04, 'ball', 22)
    bearing('bearings_no4', 2.07, 0.104, 0.13, 0.036, 'roller', 30)
    bearing('bearings_no5', 3.06, 0.05, 0.096, 0.04, 'roller', 20)
    # supports: No. 1 cone back to the intermediate case hub (Nos 2 and 3 hang off it), No. 4 under the
    # combustor off the diffuser inner case, No. 5 in the exhaust case
    K.lathe('bearings_sup1', [(0.5, 0.108), (0.5, 0.116), (0.7, 0.2), (0.95, 0.215), (1.13, 0.168), (1.13, 0.16), (0.95, 0.205), (0.71, 0.19), (0.515, 0.108)], M['case'], cut='deep', steps=144)
    K.lathe('bearings_sup2', [(0.99, 0.1), (1.01, 0.1), (1.046, 0.19), (1.038, 0.193), (0.996, 0.106)], M['case'], cut='deep', steps=96)
    K.lathe('bearings_sup3', [(1.102, 0.146), (1.138, 0.146), (1.138, 0.165), (1.102, 0.153)], M['case'], cut='deep', steps=96)
    K.lathe('lpccase_hub', [(0.94, ci(0.94)), (1.0, ci(1.0)), (1.1, ci(1.1)), (1.15, ci(1.15)), (1.15, ci(1.15) - 0.008), (1.1, ci(1.1) - 0.008), (1.0, ci(1.0) - 0.008), (0.94, ci(0.94) - 0.008)], M['case'], cut='deep', steps=144)
    K.lathe('lpccase_diaphragm', [(0.95, 0.209), (0.958, 0.209), (0.958, ci(0.958) - 0.008), (0.95, ci(0.95) - 0.008)], M['case'], cut='deep', steps=144)
    K.lathe('bearings_sup4', [(2.064, 0.13), (2.076, 0.13), (2.076, 0.158), (2.064, 0.158)], M['case'], cut='deep', steps=96)
    K.lathe('bearings_sup4c', [(2.106, 0.158), (2.112, 0.158), (2.146, 0.178), (2.138, 0.178)], M['case'], cut='deep', steps=96)
    K.lathe('bearings_comp4', [(2.03, 0.1125), (2.03, 0.162), (2.112, 0.162), (2.112, 0.1125), (2.106, 0.1125), (2.106, 0.158), (2.036, 0.158), (2.036, 0.1125)], M['case'], cut='deep', steps=144)
    K.lathe('bearings_sup5', [(3.042, 0.096), (3.078, 0.096), (3.11, 0.2), (3.11, 0.21), (3.104, 0.21), (3.072, 0.102), (3.048, 0.102)], M['case'], cut='deep', steps=96)
    K.lathe('bearings_comp5', [(3.026, 0.0515), (3.026, 0.11), (3.032, 0.11), (3.032, 0.0515)], M['case'], cut='deep', steps=96)
    # carbon seals where each shaft leaves its chamber
    for x, r0, r1 in ((0.49, 0.0712, 0.084), (1.155, 0.1045, 0.116), (2.033, 0.1047, 0.1125), (2.109, 0.1047, 0.1125), (3.029, 0.0504, 0.06)):
        K.lathe(f'bearings_seal{int(round(x * 1000))}', [(x - 0.004, r0), (x + 0.004, r0), (x + 0.004, r1), (x - 0.004, r1)], M['carbon'], cut='deep', steps=96)
