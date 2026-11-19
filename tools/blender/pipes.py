"""Pipe, harness and duct routing for the V2500 build.

Real engine dressing is not random squiggles: rigid tubes run in parallel groups at a fixed height
above the casing, turn through tight concentric bends, and are held every 150-250 mm by block clamps
on brackets. Harnesses are braided looms with identification sleeves, held by cushioned P-clamps,
and end in connectors. This module routes all of that and writes it straight into a few bmeshes
(one per output object), so thousands of pieces stay cheap.

Coordinates: a route is given in engine cylindrical terms (x along the axis, th in degrees as in
scene3d.js, h = height above a surface function R(x)). It is filleted in an "unrolled" space
(x, s = arc length, h) so bends stay round, then wrapped back onto the cylinder.
"""
import math, bmesh, bpy
from mathutils import Vector

TAU = 2 * math.pi


def cyl_to_blender(x, th_deg, r):
    t = math.radians(th_deg)
    return Vector((x, -r * math.sin(t), r * math.cos(t)))


class Acc:
    """One output object: many primitives in one bmesh, with per-face materials and UVs."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []
        self.empty = True

    def mi(self, mat):
        if mat not in self.mats: self.mats.append(mat)
        return self.mats.index(mat)

    def _face(self, verts, uvs, m):
        try: f = self.bm.faces.new(verts)
        except ValueError: return None
        f.material_index = m; f.smooth = True
        for loop, uv in zip(f.loops, uvs): loop[self.uv].uv = uv
        self.empty = False
        return f

    def sweep(self, pts, radius, mat, sides=8, cap0=None, cap1=None, vlen=None, flat=False):
        """Tube along a list of Blender-space points. cap0/cap1: material for an end cap, or None."""
        # repeated points (a sample lying exactly on a cutaway edge is used to end one piece and start the
        # next) would give a zero tangent and collapse every ring of the tube to its centreline
        pts = [q for i, q in enumerate(pts) if i == 0 or (q - pts[i - 1]).length > 1e-7]
        if len(pts) < 2: return
        m = self.mi(mat); n = sides; rings = []
        # parallel-transport frames
        t0 = (pts[1] - pts[0]).normalized()
        ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((0, 1, 0))
        nrm = t0.cross(ref).normalized()
        dist = 0.0; vs = []
        for i, p in enumerate(pts):
            if i == 0: t = t0
            elif i == len(pts) - 1: t = (pts[i] - pts[i - 1]).normalized()
            else: t = ((pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()).normalized()
            if t.length < 1e-6: t = (pts[i] - pts[i - 1]).normalized()
            nrm = (nrm - t * nrm.dot(t)).normalized()
            bi = t.cross(nrm)
            if i: dist += (pts[i] - pts[i - 1]).length
            ring = []
            for k in range(n):
                a = TAU * (k + 0.5) / n
                ring.append(self.bm.verts.new(p + radius * (math.cos(a) * nrm + math.sin(a) * bi)))
            rings.append(ring); vs.append(dist)
        L = vlen or (TAU * radius)
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(n):
                k2 = (k + 1) % n
                self._face([a[k], a[k2], b[k2], b[k]], [(k / n, vs[i] / L), ((k + 1) / n, vs[i] / L), ((k + 1) / n, vs[i + 1] / L), (k / n, vs[i + 1] / L)], m)
        for ring, cm, rev in ((rings[0], cap0, True), (rings[-1], cap1, False)):
            if cm is None: continue
            vv = list(reversed(ring)) if rev else ring
            self._face(vv, [(0.5 + 0.5 * math.cos(TAU * k / n), 0.5 + 0.5 * math.sin(TAU * k / n)) for k in range(n)], self.mi(cm))

    def cyl(self, a, b, r, mat, sides=6):
        """Closed cylinder between two points (hex nut with sides=6)."""
        self.sweep([Vector(a), Vector(b)], r, mat, sides=sides, cap0=mat, cap1=mat)

    def box(self, c, ax, ay, az, sx, sy, sz, mat):
        """Box centred at c with orthonormal axes ax, ay, az and full sizes sx, sy, sz."""
        m = self.mi(mat); c = Vector(c)
        corners = [c + ax * (sx / 2 * i) + ay * (sy / 2 * j) + az * (sz / 2 * k) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)]
        v = [self.bm.verts.new(p) for p in corners]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for q in quads: self._face([v[i] for i in q], [(0, 0), (1, 0), (1, 1), (0, 1)], m)

    def to_object(self, link):
        if self.empty: return None
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        obj = link(bpy.data.objects.new(self.name, me))
        for mt in self.mats: me.materials.append(mt)
        return obj


class Dresser:
    """Routes runs and sorts the geometry into output objects by cowl sector.

    Geometry inside the cutaway sector goes to '<prefix>B__full' (shown only with the cutaway off);
    tubes are split exactly at the sector boundary and capped there with the section material."""

    def __init__(self, prefix, in_cut, section_mat):
        self.prefix = prefix; self.in_cut = in_cut; self.section = section_mat
        self.accs = {}
        self.dx = 0.02

    def acc(self, cut, kind=''):
        key = (cut, kind)
        if key not in self.accs:
            self.accs[key] = Acc(self.prefix + kind + ('B__full' if cut else ''))
        return self.accs[key]

    # ---------------------------------------------------------------- path construction
    @staticmethod
    def _fillet(corners, radii, step_deg=12.0):
        """Round each interior corner of a 3D polyline (unrolled space). Returns [(point, in_bend)]."""
        out = [(corners[0], False)]
        for i in range(1, len(corners) - 1):
            p0, p1, p2 = corners[i - 1], corners[i], corners[i + 1]
            d1, d2 = (p0 - p1), (p2 - p1)
            l1, l2 = d1.length, d2.length
            if l1 < 1e-6 or l2 < 1e-6: continue
            d1.normalize(); d2.normalize()
            cosang = max(-1.0, min(1.0, d1.dot(d2)))
            ang = math.acos(cosang)  # angle between the two legs
            if ang > math.pi - 1e-3: out.append((p1, False)); continue
            half = ang / 2; rb = radii[i]
            t = rb / math.tan(half)
            tmax = 0.48 * min(l1, l2)
            if t > tmax: t = tmax; rb = t * math.tan(half)
            a = p1 + d1 * t; b = p1 + d2 * t
            bis = (d1 + d2).normalized()
            c = p1 + bis * (rb / math.sin(half))
            va, vb = (a - c), (b - c)
            turn = math.pi - ang
            n = max(2, int(math.degrees(turn) / step_deg) + 1)
            axis = va.cross(vb)
            if axis.length < 1e-9: out.append((p1, False)); continue
            axis.normalize()
            from mathutils import Quaternion
            for k in range(n + 1):
                q = Quaternion(axis, turn * k / n)
                out.append((c + q @ va, 0 < k < n))
        out.append((corners[-1], False))
        return out

    @staticmethod
    def _offset2d(pts, off):
        """Offset a polyline (unrolled x, s; h untouched) sideways by off (left positive), mitred."""
        n = len(pts); norms = []
        for i in range(n - 1):
            dx, ds = pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y
            L = math.hypot(dx, ds)
            norms.append(None if L < 1e-6 else (-ds / L, dx / L))
        # fill gaps (radial legs) from neighbours
        last = None
        for i in range(len(norms)):
            if norms[i] is None: norms[i] = last
            else: last = norms[i]
        last = None
        for i in reversed(range(len(norms))):
            if norms[i] is None: norms[i] = last
            else: last = norms[i]
        out = []
        for i in range(n):
            na = norms[max(0, i - 1)] or (0.0, 1.0); nb = norms[min(i, n - 2)] or na
            mx, my = na[0] + nb[0], na[1] + nb[1]; ml = math.hypot(mx, my)
            if ml < 1e-6: mx, my, scale = nb[0], nb[1], 1.0
            else:
                mx, my = mx / ml, my / ml
                scale = 1.0 / max(0.35, mx * nb[0] + my * nb[1])
            out.append(Vector((pts[i].x + mx * off * scale, pts[i].y + my * off * scale, pts[i].z)))
        return out

    @staticmethod
    def _turn_signs(pts):
        signs = [0] * len(pts)
        for i in range(1, len(pts) - 1):
            a = (pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); b = (pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
            if math.hypot(*a) < 1e-6 or math.hypot(*b) < 1e-6: continue
            cr = a[0] * b[1] - a[1] * b[0]
            signs[i] = 1 if cr > 1e-9 else -1 if cr < -1e-9 else 0
        return signs

    def _wrap(self, samples, R, th0, rref):
        """Unrolled samples -> [(blender point, th_deg, in_bend)], densified so long runs follow the cylinder."""
        dense = []
        for i, (p, bend) in enumerate(samples):
            if i:
                q = samples[i - 1][0]
                steps = max(1, int(max(abs(p.y - q.y) / 0.03, abs(p.x - q.x) / self.dx, abs(p.z - q.z) / 0.05)))
                for k in range(1, steps):
                    f = k / steps; dense.append((q.lerp(p, f), bend and samples[i - 1][1]))
            dense.append((p, bend))
        out = []
        for p, bend in dense:
            th = th0 + math.degrees(p.y / rref)
            out.append((cyl_to_blender(p.x, th, R(p.x) + p.z), th, bend))
        return self._simplify(out)

    @staticmethod
    def _simplify(pts, tol=0.0012):
        """Drop samples that lie within tol of the straight line between their neighbours (greedy)."""
        if len(pts) < 3: return pts
        keep = [pts[0]]; anchor = 0
        for i in range(2, len(pts)):
            a, b = pts[anchor][0], pts[i][0]; ab = b - a; L2 = ab.length_squared
            ok = True
            for j in range(anchor + 1, i):
                p = pts[j][0]
                t = 0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
                if (a + ab * t - p).length > tol: ok = False; break
            if not ok:
                keep.append(pts[i - 1]); anchor = i - 1
        keep.append(pts[-1])
        return keep

    def path(self, R, way, off=0.0, layer=0.0, rb=0.035, rb_dive=0.018):
        """way: [(x, th_deg, h)] corner points. Returns wrapped samples for one pipe offset sideways by
        `off` and raised by `layer`, with concentric bends."""
        th0 = way[0][1]; rref = R(way[0][0]) + way[0][2]
        corners = [Vector((x, math.radians(th - th0) * rref, h + layer)) for x, th, h in way]
        signs = self._turn_signs(corners)
        if off: corners = self._offset2d(corners, off)
        radii = [max(0.006, (rb - off * signs[i]) if signs[i] else rb_dive) for i in range(len(corners))]
        return self._wrap(self._fillet(corners, radii), R, th0, rref)

    # ---------------------------------------------------------------- output with sector splitting
    def _emit_sweep(self, samples, radius, mat, sides, kind, ends=None, vlen=None):
        """Split a wrapped path at the cutaway boundary and sweep each piece."""
        if len(samples) < 2: return
        ends = ends or (mat, mat)
        runs = []; cur = [samples[0]]; cut = self.in_cut(samples[0][1])
        for s in samples[1:]:
            c = self.in_cut(s[1])
            if c != cut:
                # boundary point: interpolate on the angle where the sector edge lies
                a, b = cur[-1], s
                edge = self._edge_between(a[1], b[1])
                f = 0.5 if edge is None or abs(b[1] - a[1]) < 1e-9 else max(0.0, min(1.0, (edge - a[1]) / (b[1] - a[1])))
                mid = (a[0].lerp(b[0], f), a[1] + (b[1] - a[1]) * f, False)
                cur.append(mid); runs.append((cut, cur)); cur = [mid, s]; cut = c
            else: cur.append(s)
        runs.append((cut, cur))
        for i, (cut, run) in enumerate(runs):
            c0 = ends[0] if i == 0 else (None if cut else self.section)
            c1 = ends[1] if i == len(runs) - 1 else (None if cut else self.section)
            self.acc(cut, kind).sweep([p for p, _, _ in run], radius, mat, sides=sides, cap0=c0, cap1=c1, vlen=vlen)

    def _edge_between(self, a, b):
        for e in (-8.0, 352.0, 112.0, 472.0, -248.0):
            if min(a, b) <= e <= max(a, b): return e
        return None

    def _put(self, th, fn, kind=''):
        fn(self.acc(self.in_cut(th), kind))

    # ---------------------------------------------------------------- frames for fittings
    @staticmethod
    def _up(p, t):
        """Radial direction square to t; along the engine axis where the run itself is radial."""
        rad = Vector((0, p.y, p.z)).normalized(); up = rad - t * rad.dot(t)
        if up.length < 0.2:
            ax = Vector((1, 0, 0)); up = ax - t * ax.dot(t)
        return up.normalized()

    @staticmethod
    def _frame(samples, i):
        p = samples[i][0]
        j0, j1 = max(0, i - 1), min(len(samples) - 1, i + 1)
        t = (samples[j1][0] - samples[j0][0]).normalized()
        up = Dresser._up(p, t)
        return p, t, up, t.cross(up).normalized()

    @staticmethod
    def _arclen(s):
        L = [0.0]
        for i in range(1, len(s)): L.append(L[-1] + (s[i][0] - s[i - 1][0]).length)
        return L

    @staticmethod
    def _at(s, L, d):
        """Frame at arc length d along wrapped samples: (p, t, up, lat, th)."""
        d = max(0.0, min(L[-1], d)); i = 1
        while i < len(s) - 1 and L[i] < d: i += 1
        f = (d - L[i - 1]) / max(L[i] - L[i - 1], 1e-9)
        p = s[i - 1][0].lerp(s[i][0], f); th = s[i - 1][1] + (s[i][1] - s[i - 1][1]) * f
        t = (s[i][0] - s[i - 1][0]).normalized(); up = Dresser._up(p, t)
        return p, t, up, t.cross(up).normalized(), th

    def boss(self, p, th, radius, boss_mat, nut_mat=None, depth=0.03, kind=''):
        """Port where a tube enters a casing: a cast pad standing off the case and a hex union."""
        rad = Vector((0, p.y, p.z)).normalized()
        def f(a):
            a.cyl(p - rad * depth, p + rad * 0.004, max(radius * 2.8, 0.011), boss_mat, 12)
            a.cyl(p + rad * 0.004, p + rad * 0.015, max(radius * 1.8, 0.007), nut_mat or boss_mat, 6)
        self._put(th, f, kind)

    # ---------------------------------------------------------------- public runs
    def tubes(self, R, way, n=1, d=0.024, radius=0.005, mat=None, clamp_mat=None, bracket_mat=None, nut_mat=None,
              clamp_every=0.2, layers=1, rb=0.04, end_boss=None, boss_mat=None, union_every=0.55, kind='',
              tape_mat=None, torque_mat=None, tape_every=0.7):
        """A group of n rigid tubes side by side (and `layers` deep) along route `way`. tape_mat: fluid
        identification tape wrapped near each end and every tape_every metres; torque_mat: a torque-seal paint
        stripe across every union nut onto the tube, as mechanics mark a tightened joint."""
        radii = list(radius) if isinstance(radius, (list, tuple)) else [radius] * n
        mats = list(mat) if isinstance(mat, (list, tuple)) else [mat] * n
        offs = [(k - (n - 1) / 2) * d for k in range(n)]
        centre = self.path(R, way, 0.0, 0.0, rb)
        for li in range(layers):
            for o, radius, mat in zip(offs, radii, mats):
                s = self.path(R, way, o, li * d * 0.95, rb)
                self._emit_sweep(s, radius, mat, 8 if radius > 0.004 else 6, kind)
                if nut_mat:
                    L = 0.0; last = 0.0
                    for i in range(1, len(s)):
                        L += (s[i][0] - s[i - 1][0]).length
                        if (i == 1 or i == len(s) - 1 or (L - last > union_every and not s[i][2])):
                            last = L; p, t, up, lat = self._frame(s, i)
                            self._put(s[i][1], lambda a, p=p, t=t: a.cyl(p - t * 0.008, p + t * 0.008, radius * 1.9, nut_mat, 6), kind)
                            if torque_mat:   # across the nut's flat and on along the tube
                                self._put(s[i][1], lambda a, p=p, t=t, up=up, lat=lat: (a.box(p + up * (radius * 1.68), t, lat, up, 0.017, 0.0016, 0.0011, torque_mat),
                                                                                        a.box(p + t * 0.0125 + up * (radius * 1.04), t, lat, up, 0.009, 0.0016, 0.0011, torque_mat)), kind)
                if tape_mat:   # identification tape near each end, then at intervals
                    total = sum((s[i][0] - s[i - 1][0]).length for i in range(1, len(s)))
                    marks = [0.07, total - 0.07] + [tape_every * k for k in range(1, int(total / tape_every))]
                    L = 0.0; mi = 0; marks = sorted(m for m in marks if 0.03 < m < total - 0.03)
                    for i in range(1, len(s)):
                        L += (s[i][0] - s[i - 1][0]).length
                        while mi < len(marks) and L >= marks[mi]:
                            mi += 1
                            if s[i][2]: continue
                            p, t, up, lat = self._frame(s, i)
                            self._put(s[i][1], lambda a, p=p, t=t: a.sweep([p - t * 0.0125, p + t * 0.0125], radius * 1.12, tape_mat, 12, None, None, vlen=0.025), kind)
                if end_boss is not None:
                    eb = end_boss if isinstance(end_boss, (list, tuple)) else (end_boss, end_boss)
                    for i, on in ((0, eb[0]), (len(s) - 1, eb[1])):
                        if on: self.boss(s[i][0], s[i][1], radius, boss_mat or nut_mat or mat, nut_mat, kind=kind)
        if clamp_mat is None: return
        radius = max(radii); width = (n - 1) * d + 2 * radius + 0.012; depth = layers * d * 0.95 + 0.004
        L = 0.0; last = -clamp_every * 0.5
        for i in range(1, len(centre)):
            L += (centre[i][0] - centre[i - 1][0]).length
            if L - last < clamp_every or centre[i][2] or i > len(centre) - 3: continue
            last = L; p, t, up, lat = self._frame(centre, i)
            hgt = self._height_above(R, p)
            mid = p + up * ((layers - 1) * d * 0.95 / 2)

            def clamp(a, p=p, t=t, up=up, lat=lat, mid=mid, hgt=hgt):
                a.box(mid, t, lat, up, 0.016, width, depth + 2 * radius, clamp_mat)
                if bracket_mat and hgt > radius * 1.5:
                    a.box(p - up * (hgt / 2 + radius), t, lat, up, 0.012, 0.022, hgt, bracket_mat)
                    a.box(p - up * (hgt + radius - 0.002), t, lat, up, 0.03, 0.03, 0.004, bracket_mat)
            self._put(centre[i][1], clamp, kind)

    @staticmethod
    def _height_above(R, p):
        r = math.hypot(p.y, p.z)
        return max(0.0, r - R(p.x))

    def loom(self, R, way, radius=0.009, mat=None, band_mat=None, clamp_mat=None, bracket_mat=None, conn_mat=None,
             band_every=0.14, clamp_every=0.22, rb=0.05, connectors=(True, True), kind=''):
        """A braided harness with identification sleeves, cushioned P-clamps and end connectors."""
        s = self.path(R, way, 0.0, 0.0, rb)
        self._emit_sweep(s, radius, mat, 8, kind, vlen=0.06)
        L = 0.0; lastb = 0.0; lastc = -clamp_every / 2
        for i in range(1, len(s) - 1):
            L += (s[i][0] - s[i - 1][0]).length
            p, t, up, lat = self._frame(s, i)
            if band_mat and L - lastb > band_every:
                lastb = L; self._put(s[i][1], lambda a, p=p, t=t: a.sweep([p - t * 0.007, p + t * 0.007], radius * 1.22, band_mat, 10, band_mat, band_mat, vlen=0.014), kind)
            if clamp_mat and L - lastc > clamp_every and not s[i][2]:
                lastc = L; hgt = self._height_above(R, p)

                def pclamp(a, p=p, t=t, up=up, lat=lat, hgt=hgt):
                    a.sweep([p - t * 0.008, p + t * 0.008], radius * 1.45, clamp_mat, 10, clamp_mat, clamp_mat)
                    if bracket_mat and hgt > radius * 1.6:
                        a.box(p - up * (hgt / 2 + radius * 0.8), t, lat, up, 0.014, 0.01, hgt, bracket_mat)
                self._put(s[i][1], pclamp, kind)
        if conn_mat:
            for i, on in ((0, connectors[0]), (len(s) - 1, connectors[1])):
                if not on: continue
                p, t, up, lat = self._frame(s, i); sgn = -1 if i == 0 else 1
                self._put(s[i][1], lambda a, p=p, t=t, sgn=sgn: (a.cyl(p, p + t * sgn * 0.03, radius * 1.7, conn_mat, 12), a.cyl(p + t * sgn * 0.03, p + t * sgn * 0.042, radius * 2.0, conn_mat, 12)), kind)

    def duct(self, R, way, radius, mat, flange_mat=None, rb=0.12, joints=(), bellows=(), kind='', ends=(True, True),
             ports=(False, False), port_mat=None, valves=(), supports=0.0, support_mat=None):
        """Large bleed / cooling / starter duct: smooth bends, V-band joints with T-bolt latches, bellows
        convolutions, inline valve bodies with actuators, stand-off supports, flanged ports on the casing.
        joints / bellows / valves are given as fractions of the duct length.
        valves: [(f, length, body_scale, body_mat, actuator_mat or None)]"""
        s = self.path(R, way, 0.0, 0.0, rb, rb_dive=rb * 0.8)
        self._emit_sweep(s, radius, mat, 18, kind)
        if not flange_mat: return
        L = self._arclen(s); tot = L[-1]
        put = lambda th, fn: self._put(th, fn, kind)

        def vband(d):
            p, t, up, lat, th = self._at(s, L, d)
            def f(a):
                for sg in (-1, 1): a.cyl(p + t * sg * 0.0022, p + t * sg * 0.0085, radius * 1.16, flange_mat, 20)
                a.sweep([p - t * 0.0065, p + t * 0.0065], radius * 1.22, flange_mat, 20, flange_mat, flange_mat)
                c = p + up * radius * 1.28
                a.box(c, t, lat, up, 0.015, 0.03, 0.012, flange_mat)                                  # T-bolt latch
                a.cyl(c - lat * 0.024, c + lat * 0.024, 0.0032, flange_mat, 6)
            put(th, f)
        for fj in joints: vband(fj * tot)
        for k, on in enumerate(ends):
            if on and not ports[k]: vband(tot - 0.008 if k else 0.008)
        for k, on in enumerate(ports):
            if not on: continue
            p, t, up, lat, th = self._at(s, L, 0.0 if k == 0 else tot)
            rad = Vector((0, p.y, p.z)).normalized()
            def pf(a, p=p, rad=rad):
                a.cyl(p - rad * 0.03, p + rad * 0.006, radius * 1.75, port_mat or flange_mat, 20)        # cast port pad
                a.cyl(p + rad * 0.006, p + rad * 0.016, radius * 1.32, flange_mat, 20)                    # bolted flange
                ax = rad.orthogonal().normalized(); bx = rad.cross(ax)
                for b in range(8):
                    q = p + rad * 0.016 + (ax * math.cos(b * TAU / 8) + bx * math.sin(b * TAU / 8)) * radius * 1.18
                    a.cyl(q, q + rad * 0.006, 0.0042, flange_mat, 6)
            put(th, pf)
        for f0, f1 in bellows:
            d0, d1 = f0 * tot, f1 * tot; n = max(4, int((d1 - d0) / 0.0105))
            for e in (d0, d1):
                p, t, up, lat, th = self._at(s, L, e)
                put(th, lambda a, p=p, t=t: a.cyl(p - t * 0.006, p + t * 0.006, radius * 1.08, flange_mat, 20))
            for k in range(1, n):
                p, t, up, lat, th = self._at(s, L, d0 + (d1 - d0) * k / n)
                put(th, lambda a, p=p, t=t: (a.cyl(p - t * 0.0032, p + t * 0.0032, radius * 1.15, flange_mat, 20),
                                             a.cyl(p - t * 0.0016, p + t * 0.0016, radius * 1.19, flange_mat, 20)))
        for fv, length, sc, body_mat, act_mat in valves:
            p, t, up, lat, th = self._at(s, L, fv * tot)
            def vf(a, p=p, t=t, up=up, lat=lat, length=length, sc=sc, body_mat=body_mat, act_mat=act_mat):
                a.sweep([p - t * length / 2, p - t * length * 0.3, p + t * length * 0.3, p + t * length / 2], radius * sc, body_mat, 20, body_mat, body_mat)
                for sg in (-1, 1): a.cyl(p + t * sg * (length / 2 - 0.004), p + t * sg * (length / 2 + 0.006), radius * sc * 1.1, flange_mat, 20)
                if act_mat:
                    c = p + up * (radius * sc + 0.034)
                    a.cyl(p + up * radius * sc * 0.9, c - up * 0.02, 0.012, body_mat, 10)                    # bonnet
                    a.box(c, t, lat, up, 0.075, 0.06, 0.05, act_mat)                                           # actuator
                    a.cyl(c + lat * 0.03, c + lat * 0.045, 0.012, flange_mat, 10)                              # electrical connector
                    a.box(c + up * 0.03, t, lat, up, 0.012, 0.03, 0.01, flange_mat)                            # position indicator
            put(th, vf)
        if supports and support_mat:
            d = supports * 0.6
            while d < tot - 0.1:
                p, t, up, lat, th = self._at(s, L, d)
                rad = Vector((0, p.y, p.z)).normalized()
                hgt = self._height_above(R, p) - radius
                if abs(t.dot(rad)) < 0.4 and 0.012 < hgt < 0.3:
                    def sf(a, p=p, t=t, rad=rad, lat=t.cross(rad).normalized(), hgt=hgt):
                        a.sweep([p - t * 0.008, p + t * 0.008], radius * 1.07, support_mat, 18, support_mat, support_mat)   # band clamp
                        a.box(p - rad * (radius + hgt / 2), t, lat, rad, 0.012, 0.034, hgt, support_mat)              # stand-off
                        a.box(p - rad * (radius + hgt - 0.002), t, lat, rad, 0.04, 0.05, 0.005, support_mat)          # foot
                    put(th, sf)
                d += supports

    def ring(self, x, r, radius, mat, kind='', th0=-8.0):
        """A full ring round the engine at station x (split at the cutaway sector edges)."""
        smp = [(cyl_to_blender(x, th0 + 360.0 * k / 96, r), th0 + 360.0 * k / 96, False) for k in range(97)]
        self._emit_sweep(smp, radius, mat, 8, kind)

    def hose(self, pts_cyl, radius, mat, end_mat=None, kind=''):
        """Flexible hose through cylindrical points [(x, th, r)], smooth (Catmull-Rom)."""
        P = [cyl_to_blender(*p) for p in pts_cyl]; ths = [p[1] for p in pts_cyl]
        out = []
        for i in range(len(P) - 1):
            p0, p1, p2, p3 = P[max(0, i - 1)], P[i], P[i + 1], P[min(len(P) - 1, i + 2)]
            for k in range(8):
                u = k / 8; u2, u3 = u * u, u * u * u
                q = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
                out.append((q, ths[i] + (ths[i + 1] - ths[i]) * u, False))
        out.append((P[-1], ths[-1], False))
        self._emit_sweep(out, radius, mat, 10, kind, vlen=0.05)
        if end_mat:
            for i in (0, len(out) - 1):
                p, t, up, lat = self._frame(out, i)
                self._put(out[i][1], lambda a, p=p, t=t: a.cyl(p - t * 0.014, p + t * 0.014, radius * 1.35, end_mat, 6), kind)

    def finish(self, link, made, finish_fn=None):
        for acc in self.accs.values():
            o = acc.to_object(link)
            if o is not None: made.append(o)
