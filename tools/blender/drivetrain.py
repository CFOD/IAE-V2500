"""Accessory drive train of the V2500, modelled gear by gear.

Power path (Airbus A320 training manual, ATA 72 'Accessory gearbox'; IAE training notes): a spiral bevel gear
splined on the front of the HP stub shaft, held by the No. 3 bearing nut, drives a bevel pinion on the tower
(radial drive) shaft. The tower shaft runs down the 6 o'clock strut of the intermediate case and across the
bypass duct inside the lower strut of the fan frame to the angle gearbox on the fan case. A second bevel pair
there turns the drive forward into the horizontal (lay) shaft, which enters the main gearbox through its rear
face. The angle gearbox also carries the starter's torque back to the core for a start.

The main gearbox is a two-plane spur train in a magnesium casting split at mid-depth. The rear-face accessories
(scavenge pumps, fuel pump, hand-cranking pad, IDG) have gears just inside the rear wall, the front-face ones
(oil pressure pump, hydraulic pump, dedicated alternator, starter) just inside the front wall, and the starter /
IDG gearshaft carries a gear in each plane and links them. The idlers between the pads were placed by
solve_train() below so that every pair meshes exactly and no gear touches anything else; the result is stored
in TRAIN so the build is quick and repeatable.

Tooth counts set the speeds, as fractions of N2: tower shaft 1.6, lay shaft 1.21, IDG and starter 0.605 (4,900
to 9,000 rpm from idle to take-off, the input range an A320 IDG accepts), hydraulic pump 0.31, oil pressure pump
0.44, fuel pump 0.47, scavenge pumps 0.50, dedicated alternator 0.75, cranking pad 0.81. IAE does not publish
pad speeds, so these are estimates sized to the units.

Every rotating assembly is its own object, with its origin on its axis and local +X along it. The manifest's
'spin' list gives each one's speed as a ratio to the HP spool about that axis. The app turns them from the HP
spool's own angle, so hand-turning the core for a borescope inspection turns the whole train.
"""
import itertools
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = 2 * math.pi

# ---------------------------------------------------------------------------------------------- layout
X_T, TH_T = 0.975, 180.0                                   # tower shaft: axial station and angle (6 o'clock)
IGB = dict(z1=48, z2=30, m=0.00625, b=0.026, beta=30.0)     # HP-shaft spiral bevel gear / tower pinion
ANGB = dict(z3=31, z4=41, m=0.003, b=0.021, beta=25.0, r=0.99)   # tower gear / lay gear, apex radius
X_F, X_R, X_MID = 0.45, 0.69, 0.57                          # gear planes and the casting split web
X_W0, X_W1 = 0.368, 0.772                                   # inner faces of the front and rear walls
FACE, MAIN_M = 0.026, 0.0025                                # main-train face width and module
CAST = dict(th0=148.0, th1=212.0, r_in=0.875, r_out=1.072)  # gearbox casting (accessories.GEARBOX)
PARTS = ['igb', 'tower', 'angb', 'layshaft', 'agbtrain']      # app parts (scene3d.js); shown with the internals
VIS_OUT = r'angb_housing|layshaft_tube'                      # always drawn: they are outside, on the fan case

# Solved by solve_train(): (name, angle deg, radius, teeth, kind) per plane, and the meshing pairs.
TRAIN = {
    'R': [('scav', 154.0, 0.95, 48, 'fix'), ('fuel', 166.0, 0.97, 52, 'fix'), ('crank', 176.0, 0.955, 30, 'fix'), ('lay', 180.0, 0.99, 20, 'fix'),
          ('si', 197.0, 0.976, 40, 'fix'), ('i_scav_fuel_0', 159.805898, 0.972779, 32, 'idler'), ('i_fuel_crank_0', 171.880658, 0.975986, 28, 'idler'),
          ('i_crank_lay_0', 179.673578, 0.940303, 20, 'idler'), ('i_lay_si_0', 184.305559, 0.977164, 40, 'idler'), ('i_lay_si_1', 190.642087, 0.949541, 48, 'idler')],
    'F': [('oil', 160.0, 0.975, 44, 'fix'), ('hyd', 172.0, 0.975, 62, 'fix'), ('pma', 183.0, 0.99, 26, 'fix'), ('si', 197.0, 0.976, 32, 'fix'),
          ('i_oil_hyd_0', 165.309572, 0.950421, 30, 'idler'), ('i_hyd_pma_0', 178.920238, 0.970306, 32, 'idler'), ('i_pma_si_0', 187.300137, 0.964943, 36, 'idler'),
          ('i_pma_si_1', 192.35363, 0.960574, 32, 'idler')],
}
MESHES = {
    'R': [('scav', 'i_scav_fuel_0'), ('i_scav_fuel_0', 'fuel'), ('fuel', 'i_fuel_crank_0'), ('i_fuel_crank_0', 'crank'),
          ('crank', 'i_crank_lay_0'), ('i_crank_lay_0', 'lay'), ('lay', 'i_lay_si_0'), ('i_lay_si_0', 'i_lay_si_1'), ('i_lay_si_1', 'si')],
    'F': [('oil', 'i_oil_hyd_0'), ('i_oil_hyd_0', 'hyd'), ('hyd', 'i_hyd_pma_0'), ('i_hyd_pma_0', 'pma'), ('pma', 'i_pma_si_0'),
          ('i_pma_si_0', 'i_pma_si_1'), ('i_pma_si_1', 'si')],
}
# what drives what (names for the app's part cards)
PAD = {'scav': 'scavenge pumps', 'fuel': 'fuel pump and metering unit', 'crank': 'hand-cranking pad', 'lay': 'lay shaft input',
       'si': 'starter (front) and IDG (rear)', 'oil': 'oil pressure pump', 'hyd': 'hydraulic pump', 'pma': 'dedicated alternator'}


def P3(x, th, r):
    t = math.radians(th); return Vector((x, -r * math.sin(t), r * math.cos(t)))


def U(th):
    t = math.radians(th); return Vector((0.0, -math.sin(t), math.cos(t)))


def YZ(th, r):
    t = math.radians(th); return (-r * math.sin(t), r * math.cos(t))


def basis(o, xd, yd):
    """Frame at o with local +X along xd and local +Y towards yd."""
    x = Vector(xd).normalized(); y = Vector(yd); y = (y - x * x.dot(y)).normalized(); z = x.cross(y)
    return Matrix(((x.x, y.x, z.x, o[0]), (x.y, y.y, z.y, o[1]), (x.z, y.z, z.z, o[2]), (0, 0, 0, 1)))


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))) if b > a else 1.0
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------- gear train solver
def _circ(c0, r0, c1, r1):
    d = math.dist(c0, c1)
    if d > r0 + r1 or d < abs(r0 - r1) or d < 1e-9: return []
    a = (r0 * r0 - r1 * r1 + d * d) / (2 * d); h = math.sqrt(max(0.0, r0 * r0 - a * a))
    mx, my = c0[0] + a * (c1[0] - c0[0]) / d, c0[1] + a * (c1[1] - c0[1]) / d
    ox, oy = -(c1[1] - c0[1]) / d * h, (c1[0] - c0[0]) / d * h
    return [(mx + ox, my + oy), (mx - ox, my - oy)]


def _chains(A, rA, B, rB, rs, steps=90):
    if len(rs) == 1:
        yield from ([c] for c in _circ(A, rA + rs[0], B, rB + rs[0])); return
    for k in range(steps):
        t = TAU * k / steps; c1 = (A[0] + (rA + rs[0]) * math.cos(t), A[1] + (rA + rs[0]) * math.sin(t))
        for rest in _chains(c1, rs[0], B, rB, rs[1:], 36 if len(rs) > 2 else steps): yield [c1] + rest


def _inside(c, r, wall=0.008):
    th = math.degrees(math.atan2(-c[0], c[1])) % 360; rr = math.hypot(*c); dth = math.degrees(r / rr)
    return rr - r >= CAST['r_in'] + wall and rr + r <= CAST['r_out'] - wall and CAST['th0'] + 1 <= th - dth and th + dth <= CAST['th1'] - 1


def solve_train(fixed, m=MAIN_M):
    """fixed: [(name, angle, radius, teeth)] in mesh order for one plane. Places idlers (one to three, 20-62 teeth)
    between each neighbouring pair so every mesh is exact and every other pair clears by 2.5 modules + 4 mm.
    Slow (a minute or two); run by hand when the pads move, then paste the result into TRAIN."""
    clr = 2.5 * m + 0.004
    gears = [(n, YZ(th, r), z * m / 2, z, 'fix') for n, th, r, z in fixed]
    for a, b in itertools.combinations(gears, 2):   # the pads' own gears must clear each other first
        if math.dist(a[1], b[1]) < a[2] + b[2] + clr: raise RuntimeError(f'{a[0]} and {b[0]} gears overlap: change a tooth count or a pad')
    placed, meshes = list(gears), []
    def ok(c, r, mates):
        if not _inside(c, r + 1.25 * m): return False
        return all((o[0] in mates and abs(math.dist(c, o[1]) - r - o[2]) < 1e-6) or math.dist(c, o[1]) >= r + o[2] + clr for o in placed + trial)
    for a, b in zip(gears, gears[1:]):
        best = None
        for n in (1, 2, 3):
            for zs in itertools.product(range(20, 64, 2 if n == 1 else 4), repeat=n):
                if any(abs(zs[i] - zs[i + 1]) > 16 for i in range(n - 1)): continue
                for cs in _chains(a[1], a[2], b[1], b[2], [z * m / 2 for z in zs]):
                    names = [f'i_{a[0]}_{b[0]}_{k}' for k in range(n)]; seq = [a[0]] + names + [b[0]]; trial = []
                    for k, (c, z) in enumerate(zip(cs, zs)):
                        if not ok(c, z * m / 2, {seq[k], seq[k + 2]}): break
                        trial.append((names[k], c, z * m / 2, z, 'idler'))
                    else:
                        score = n * 100 + sum(zs) * 0.5 + sum(abs(math.hypot(*c) - 0.965) for c in cs) * 300
                        if best is None or score < best[0]: best = (score, trial, seq)
                trial = []
            if best: break
        if not best: raise RuntimeError(f'no idlers fit between {a[0]} and {b[0]}')
        placed += best[1]; meshes += list(zip(best[2], best[2][1:]))
    return [(g[0], math.degrees(math.atan2(-g[1][0], g[1][1])) % 360, math.hypot(*g[1]), g[3], g[4]) for g in placed], meshes


def train_speeds():
    """Speed of every main-gearbox gearshaft as a ratio to N2 (sign: about engine +X). The lay shaft turns at
    1.6 x 31/41 = 1.21 (the two bevel stages); the starter / IDG shaft links the planes."""
    lay = IGB['z1'] / IGB['z2'] * ANGB['z3'] / ANGB['z4']
    spd = {('R', 'lay'): lay}; z = {pl: {g[0]: g[3] for g in TRAIN[pl]} for pl in TRAIN}
    for _ in range(20):
        for pl in TRAIN:
            for a, b in MESHES[pl]:
                for u, v in ((a, b), (b, a)):
                    if (pl, u) in spd and (pl, v) not in spd: spd[(pl, v)] = -spd[(pl, u)] * z[pl][u] / z[pl][v]
        for pl, ot in (('R', 'F'), ('F', 'R')):
            if (pl, 'si') in spd: spd.setdefault((ot, 'si'), spd[(pl, 'si')])
    return spd


def train_phases():
    """Tooth phase of every gear so that each meshing pair interleaves: a tooth of one on the line of centres
    meets a gap of the other. Angles in the engine y-z plane, measured from +y towards +z."""
    ph = {}
    for pl, root in (('R', 'lay'), ('F', 'si')):
        g = {n: (YZ(th, r), z) for n, th, r, z, _ in TRAIN[pl]}; ph[(pl, root)] = 0.0
        for _ in range(20):
            for a, b in MESHES[pl]:
                for u, v in ((a, b), (b, a)):
                    if (pl, u) in ph and (pl, v) not in ph:
                        (cu, zu), (cv, zv) = g[u], g[v]
                        psi_uv = math.atan2(cv[1] - cu[1], cv[0] - cu[0]); psi_vu = psi_uv + math.pi
                        ph[(pl, v)] = psi_vu + math.pi / zv + (zu / zv) * (psi_uv - ph[(pl, u)])
    return ph


def check_train(m=MAIN_M):
    """Every listed pair meshes (centre distance = sum of pitch radii) and no other pair comes close."""
    bad = []
    for pl in TRAIN:
        g = {n: (YZ(th, r), z * m / 2) for n, th, r, z, _ in TRAIN[pl]}; mesh = {frozenset(p) for p in MESHES[pl]}
        for (a, (ca, ra)), (b, (cb, rb)) in itertools.combinations(g.items(), 2):
            d = math.dist(ca, cb)
            if frozenset((a, b)) in mesh:
                if abs(d - ra - rb) > 2e-4: bad.append(f'{pl} {a}-{b} centre distance {d:.5f}, pitch radii {ra + rb:.5f}')
            elif d < ra + rb + 2.5 * m + 0.004 - 1e-4: bad.append(f'{pl} {a} and {b} too close ({d:.4f})')
    return bad


# ---------------------------------------------------------------------------------------------- mesh building
class Mesh:
    """One bmesh with material slots; becomes one object with its own frame."""

    def __init__(self, link):
        self.bm = bmesh.new(); self.mats = []; self.link = link

    def mi(self, mat):
        if mat not in self.mats: self.mats.append(mat)
        return self.mats.index(mat)

    def v(self, T, p):
        return self.bm.verts.new(T @ Vector(p))

    def f(self, vs, mi):
        try: fc = self.bm.faces.new(vs)
        except ValueError: return None
        fc.material_index = mi; return fc

    def strip(self, A, B, mi, close=True):
        n = len(A)
        for i in range(n if close else n - 1):
            j = (i + 1) % n; self.f((A[i], A[j], B[j], B[i]), mi)

    def obj(self, name, M=None, smooth=True, sharp=34):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for m in self.mats: me.materials.append(m)
        for p in me.polygons: p.use_smooth = smooth
        if sharp: me.set_sharp_from_angle(angle=math.radians(sharp))
        o = self.link(bpy.data.objects.new(name, me))
        if M is not None: o.matrix_world = M
        return o


def fill_ring(ms, outer, inner, T, mi):
    """Fill the flat (or conical) face between a toothed outline and a plain inner circle with triangles, so the
    circle needs far fewer vertices than the outline."""
    bm = ms.bm; edges = []
    for lp in (outer, inner):
        for i in range(len(lp)):
            a, b = lp[i], lp[(i + 1) % len(lp)]
            edges.append(bm.edges.get((a, b)) or bm.edges.new((a, b)))
    ax = (T.to_3x3() @ Vector((1, 0, 0))).normalized()
    for g in bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=ax)['geom']:
        if isinstance(g, bmesh.types.BMFace): g.material_index = mi


def rev(ms, T, loop, mat, seg=48, phase=0.0):
    """Closed (x, r) loop revolved about local X."""
    mi = ms.mi(mat)
    rings = [[ms.v(T, (x, r * math.cos(phase + TAU * k / seg), r * math.sin(phase + TAU * k / seg))) for k in range(seg)] for x, r in loop]
    for a in range(len(rings)): ms.strip(rings[a], rings[(a + 1) % len(rings)], mi)


def tube(ms, T, x0, x1, r0, r1, mat, seg=32):
    rev(ms, T, [(x0, r0), (x1, r0), (x1, r1), (x0, r1)], mat, seg)


def outline(m, z, count=None, phase=0.0, alpha=20.0, ded=1.25, n=7, backlash=0.03):
    """Polar points (r, angle) round an involute gear, angles strictly increasing: root, fillet, flank, tip,
    flank, fillet for each tooth. z may be fractional (a bevel gear's virtual spur gear); count is then how many
    teeth to make."""
    a = math.radians(alpha); rp = m * z / 2; rb = rp * math.cos(a); ra = rp + m; rf = rp - ded * m
    inv = lambda q: math.tan(q) - q
    psi = math.pi / (2 * z) - backlash * m / (2 * rp)
    land = 0.12 * m
    def half(r): return max(psi + inv(a) - inv(math.acos(min(1.0, rb / r))), land / r)
    r0 = max(rb, rf + 0.3 * m)
    rs = [r0 + (ra - r0) * (k / (n - 1)) ** 0.85 for k in range(n)]
    hr0, pitch = half(r0), TAU / z
    fil = max(0.0, min(0.5 * (pitch / 2 - hr0), 0.6 * m / rf))
    pts = []
    for k in range(int(round(count if count is not None else z))):
        c = phase + pitch * k
        pts += [(rf, c - pitch / 2), (rf, c - hr0 - fil), (rf + 0.5 * (r0 - rf), c - hr0 - 0.3 * fil)]
        pts += [(r, c - half(r)) for r in rs] + [(ra, c)] + [(r, c + half(r)) for r in reversed(rs)]
        pts += [(rf + 0.5 * (r0 - rf), c + hr0 + 0.3 * fil), (rf, c + hr0 + fil)]
    return pts, dict(rp=rp, ra=ra, rf=rf, rb=rb)


def spur(ms, T, m, z, b, x0, mat, phase=0.0, helix=0.0, rim=None, alpha=20.0, ded=1.25, n=7, chamfer=True):
    """Spur (or helical) gear rim with involute teeth, centred at x0, face width b. Returns the gear data and the
    rim's inner radius (for the web)."""
    pts, g = outline(m, z, phase=phase, alpha=alpha, ded=ded, n=n)
    rr = rim if rim is not None else g['rf'] - 2.2 * m
    mi = ms.mi(mat); cm = min(0.45 * m, 0.15 * b) if chamfer else 0.0
    xs = [x0 - b / 2, x0 - b / 2 + cm, x0 + b / 2 - cm, x0 + b / 2] if cm else [x0 - b / 2, x0 + b / 2]
    tb = math.tan(math.radians(helix))
    O = []
    for k, x in enumerate(xs):
        tw = (x - x0) * tb / g['rp']; end = cm and k in (0, len(xs) - 1)
        O.append([ms.v(T, (x, rad * math.cos(ph + tw), rad * math.sin(ph + tw)))
                  for r, ph in pts for rad in [r - cm * smooth(g['rp'], g['ra'], r) if end else r]])
    ni = max(24, int(z) * 2); I = []
    for x in (xs[0], xs[-1]):
        tw = (x - x0) * tb / g['rp']
        I.append([ms.v(T, (x, rr * math.cos(TAU * k / ni + tw), rr * math.sin(TAU * k / ni + tw))) for k in range(ni)])
    for a in range(len(O) - 1): ms.strip(O[a], O[a + 1], mi)
    ms.strip(I[1], I[0], mi); fill_ring(ms, O[0], I[0], T, mi); fill_ring(ms, O[-1], I[1], T, mi)
    return g, rr


def bevel(ms, T, m, z, zm, b, mat, phase=0.0, beta=0.0, hand=1, nl=7, rim_m=2.0):
    """Spiral bevel gear, apex at the local origin, axis +X, the teeth on the cone towards +X. Tooth shape from
    the virtual spur gear on the back cone (Tredgold), scaled towards the apex along the face; the spiral is a
    twist along the face (hand +1 or -1, beta at mid-face). Returns cone data for the blank."""
    d = math.atan2(z, zm); rp = m * z / 2; A = rp / math.sin(d); cd, sd = math.cos(d), math.sin(d)
    zv, rv = z / cd, rp / cd
    pts, g = outline(m, zv, count=z, phase=phase * cd)
    mi = ms.mi(mat); Am = A - b / 2; tb = math.tan(math.radians(beta))
    def place(rho, phv, t):
        s = rho - rv; X = A * cd - s * sd; R = A * sd + s * cd; k = 1 - t * b / A
        ph = phv / cd + hand * (t - 0.5) * b * tb / Am
        return (k * X, k * R * math.cos(ph), k * R * math.sin(ph))
    L = [[ms.v(T, place(r, ph, i / (nl - 1))) for r, ph in pts] for i in range(nl)]
    rin = g['rf'] - rim_m * m; ni = z * 2
    Ih = [ms.v(T, place(rin, TAU * cd * k / ni, 0.0)) for k in range(ni)]
    It = [ms.v(T, place(rin, TAU * cd * k / ni, 1.0)) for k in range(ni)]
    for a in range(nl - 1): ms.strip(L[a], L[a + 1], mi)
    fill_ring(ms, L[0], Ih, T, mi); fill_ring(ms, L[-1], It, T, mi); ms.strip(It, Ih, mi)
    s = rin - rv; heel = (A * cd - s * sd, A * sd + s * cd)
    return dict(A=A, d=d, rp=rp, heel=heel, toe=(heel[0] * (1 - b / A), heel[1] * (1 - b / A)))


def web(ms, T, x0, w, r_out, r_in, mat, holes=6, seg=96, hseg=18, hole_k=0.3):
    """Gear web between rim and hub, x0 to x0 + w, with round lightening holes."""
    mi, bm = ms.mi(mat), ms.bm
    def circ(c, r, n): return [ms.v(T, (x0, c[0] + r * math.cos(TAU * k / n), c[1] + r * math.sin(TAU * k / n))) for k in range(n)]
    loops = [circ((0, 0), r_out, seg), circ((0, 0), r_in, max(24, seg // 2))]
    hr, rc = hole_k * (r_out - r_in), (r_out + r_in) / 2
    if holes and hr > 0.0035:
        loops += [circ((rc * math.cos(TAU * (k + 0.5) / holes), rc * math.sin(TAU * (k + 0.5) / holes)), hr, hseg) for k in range(holes)]
    edges = [bm.edges.new((lp[i], lp[(i + 1) % len(lp)])) for lp in loops for i in range(len(lp))]
    ax = (T.to_3x3() @ Vector((1, 0, 0))).normalized()
    faces = [g for g in bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=ax)['geom'] if isinstance(g, bmesh.types.BMFace)]
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    bmesh.ops.translate(bm, vec=ax * w, verts=[g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)])
    for g in faces + [g for g in ext['geom'] if isinstance(g, bmesh.types.BMFace)]: g.material_index = mi


def ball(ms, T, c, r, mat, nu=10, nv=6):
    mi = ms.mi(mat); c = Vector(c)
    top, bot = ms.v(T, c + Vector((0, 0, r))), ms.v(T, c - Vector((0, 0, r)))
    rings = [[ms.v(T, c + Vector((r * math.sin(math.pi * j / nv) * math.cos(TAU * i / nu), r * math.sin(math.pi * j / nv) * math.sin(TAU * i / nu), r * math.cos(math.pi * j / nv)))) for i in range(nu)] for j in range(1, nv)]
    for i in range(nu): ms.f((top, rings[0][i], rings[0][(i + 1) % nu]), mi); ms.f((bot, rings[-1][(i + 1) % nu], rings[-1][i]), mi)
    for a in range(len(rings) - 1): ms.strip(rings[a], rings[a + 1], mi)


def roller(ms, T, x, rm, phi, rr, L, mat, nu=10):
    """Cylindrical roller along local X at radius rm, angle phi."""
    mi = ms.mi(mat); cy, cz = rm * math.cos(phi), rm * math.sin(phi)
    ends = [[ms.v(T, (xx, cy + rr * math.cos(TAU * i / nu), cz + rr * math.sin(TAU * i / nu))) for i in range(nu)] for xx in (x - L / 2, x + L / 2)]
    ms.strip(ends[0], ends[1], mi); ms.f(list(reversed(ends[0])), mi); ms.f(ends[1], mi)


def bearing(ms_turn, ms_fix, T, x, ri, ro, w, M, kind='ball', seg=40, Tfix=None):
    """Rolling bearing on local X: the inner race turns with its shaft; outer race, rolling elements and cage are
    drawn still (they would orbit at cage speed). Tfix: frame of the still parts, if their mesh has another."""
    Tt, T = T, (Tfix if Tfix is not None else T)
    h = ro - ri; t = 0.24 * h; rm = (ri + ro) / 2; e = 0.5 * (h - 2 * t)
    groove = 0.35 * e if kind == 'ball' else 0.0
    rev(ms_turn, Tt, [(x - w / 2, ri), (x + w / 2, ri), (x + w / 2, ri + t), (x + w / 4, ri + t), (x, ri + t - groove), (x - w / 4, ri + t), (x - w / 2, ri + t)], M['race'], seg)
    rev(ms_fix, T, [(x - w / 2, ro - t), (x - w / 4, ro - t), (x, ro - t + groove), (x + w / 4, ro - t), (x + w / 2, ro - t), (x + w / 2, ro), (x - w / 2, ro)], M['race'], seg)
    n = max(8, int(TAU * rm / (2.25 * e)))
    for k in range(n):
        a = TAU * (k + 0.5) / n
        if kind == 'ball': ball(ms_fix, T, (x, rm * math.cos(a), rm * math.sin(a)), e * 0.97, M['race'])
        else: roller(ms_fix, T, x, rm, a, e * 0.95, w * 0.62, M['race'])
    for sgn in (-1, 1):   # cage rails either side of the elements
        xc = x + sgn * (e if kind == 'ball' else w * 0.36)
        tube(ms_fix, T, xc - 0.0006, xc + 0.0006, rm - 0.35 * e, rm + 0.35 * e, M['cage'], seg)


def hexnut(ms, T, x0, w, r_in, af, mat, chamfer=True):
    """Hex nut on local X from x0 to x0 + w."""
    mi = ms.mi(mat); R = af / math.sqrt(3); c = 0.12 * w if chamfer else 0.0
    ang = [math.radians(30 + 60 * k) for k in range(6)]
    lay = [(x0, R * 0.9), (x0 + c, R), (x0 + w - c, R), (x0 + w, R * 0.9)] if c else [(x0, R), (x0 + w, R)]
    O = [[ms.v(T, (x, r * math.cos(a), r * math.sin(a))) for a in ang] for x, r in lay]
    I = [[ms.v(T, (x, r_in * math.cos(a), r_in * math.sin(a))) for a in ang] for x in (x0, x0 + w)]
    for a in range(len(O) - 1): ms.strip(O[a], O[a + 1], mi)
    ms.strip(I[1], I[0], mi); ms.strip(I[0], O[0], mi); ms.strip(O[-1], I[1], mi)


def bolt_ring(ms, T, x, rc, n, d, mat, facing=1, phase=0.0):
    """Hex bolt heads on a circle in the plane x, facing +X (or -X)."""
    for k in range(n):
        a = phase + TAU * k / n; Tk = T @ Matrix.Translation((0, rc * math.cos(a), rc * math.sin(a)))
        hexnut(ms, Tk, x if facing > 0 else x - 0.6 * d, 0.6 * d, 0.0001, d * 1.5, mat)


def spline(ms, T, x0, x1, r, mat, z=None):
    """External involute spline (30 deg) on a shaft end."""
    z = z or max(12, int(r / 0.0006) // 2 * 2)
    m = 2 * r / (z + 1.0)
    spur(ms, T, m, z, x1 - x0, (x0 + x1) / 2, mat, alpha=30.0, ded=0.9, n=3, chamfer=False, rim=max(0.0015, r - 3 * m))


def boolean(obj, cutter, op='DIFFERENCE'):
    """Boolean; faces made by a 'section' cutter take the section material (red, hatched in the app)."""
    if cutter.data.materials and cutter.data.materials[0].name == 'section' and 'section' not in [m.name for m in obj.data.materials]:
        obj.data.materials.append(cutter.data.materials[0])
    mod = obj.modifiers.new('b', 'BOOLEAN'); mod.operation = op; mod.object = cutter; mod.solver = 'EXACT'
    mod.use_self = True; mod.use_hole_tolerant = True   # the housings are several overlapping solids (bores, bearings, bolts)
    bpy.context.view_layer.objects.active = obj; bpy.ops.object.modifier_apply(modifier=mod.name)


def apply_frame(o):
    """Bake an object's frame into its vertices (static parts)."""
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)


def half_cut(o, link, section, plane_y=0.0, keep_positive=True):
    """Section a static housing by the vertical plane through the tower and lay axes (engine y = plane_y),
    removing the camera side (y < 0), for the cutaway."""
    apply_frame(o)
    me = bpy.data.meshes.new('cutter'); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(me); bm.free()
    c = link(bpy.data.objects.new('cutter', me)); me.materials.append(section)
    c.scale = (3.0, 1.0, 3.0); c.location = (1.0, plane_y - 0.5 if keep_positive else plane_y + 0.5, 0.0)
    bpy.context.view_layer.update()
    boolean(o, c); bpy.data.objects.remove(c, do_unlink=True)
    return o


# ---------------------------------------------------------------------------------------------- the assemblies
def build(link, M, section):
    """Build the drive train. M: materials (gear, shaft, race, cage, case, cast, nut, gold, steel, dark).
    Returns (objects, spin entries for the manifest)."""
    made, spin = [], []
    def turning(name, ms, F, ratio, part, what):
        o = ms.obj(name, F); made.append(o)
        spin.append({'node': name, 'ratio': round(ratio, 6), 'part': part, 'what': what}); return o

    # ---------------------------------------------------------------- internal gearbox
    z1, z2, m1, b1 = IGB['z1'], IGB['z2'], IGB['m'], IGB['b']
    O = Vector((X_T, 0.0, 0.0)); u = U(TH_T); xh = Vector((1, 0, 0))
    I = Matrix.Identity(4)
    ms = Mesh(link)
    hp = bevel(ms, I, m1, z1, z2, b1, M['gear'], phase=0.0, beta=IGB['beta'], hand=1)
    (Xh, Rh), (Xt, Rt) = hp['heel'], hp['toe']
    rev(ms, I, [(Xt, Rt), (Xh, Rh), (Xh + 0.0025, Rh - 0.003), (Xh + 0.0025, 0.119), (0.118, 0.119), (0.118, 0.1046), (Xt - 0.003, 0.1046), (Xt - 0.003, Rt - 0.004)], M['gear'], seg=96)
    # No. 3 bearing nut: round, slotted for the locking tab washer
    rev(ms, I, [(0.1185, 0.1046), (0.1255, 0.1046), (0.1255, 0.1135), (0.1185, 0.1135)], M['nut'], seg=72)
    for k in range(12):
        a = TAU * k / 12; Tk = Matrix.Translation((0, 0.1135 * math.cos(a), 0.1135 * math.sin(a))) @ Matrix.Rotation(a, 4, 'X')
        hexnut(ms, Tk, 0.1185, 0.007, 0.0001, 0.004, M['nut'], chamfer=False)
    # drive splines on the stub shaft, ahead of the gear hub
    spline(ms, I, Xt - 0.012, Xt - 0.003, 0.1046, M['shaft'], z=72)
    turning('igb_gear', ms, basis(O, xh, u), 1.0, 'igb', 'HP-shaft bevel gear')

    ms, fix = Mesh(link), Mesh(link)
    pn = bevel(ms, I, m1, z2, z1, b1, M['gear'], phase=math.pi / z2, beta=IGB['beta'], hand=-1)
    (Xh, Rh), (Xt, Rt) = pn['heel'], pn['toe']
    rev(ms, I, [(Xt, Rt), (Xh, Rh), (Xh + 0.0025, Rh - 0.003), (Xh + 0.0025, 0.034), (Xh + 0.008, 0.026), (Xh + 0.008, 0.02), (0.238, 0.02), (0.238, 0.012), (Xt - 0.002, 0.012), (Xt - 0.002, Rt - 0.004)], M['gear'], seg=64)
    bearing(ms, fix, I, 0.179, 0.02, 0.035, 0.014, M, 'ball'); bearing(ms, fix, I, 0.193, 0.02, 0.035, 0.014, M, 'ball')   # duplex pair
    bearing(ms, fix, I, 0.218, 0.02, 0.032, 0.011, M, 'roller')
    hexnut(ms, I, 0.2245, 0.0075, 0.02, 0.046, M['nut'])
    turning('igb_pinion', ms, basis(O, u, xh), -z1 / z2, 'igb', 'tower-shaft bevel pinion')
    # housing: bearing cartridge round the pinion shaft, flanged to the No. 1 bearing support cone, with an oil jet
    rev(fix, I, [(0.168, 0.035), (0.229, 0.035), (0.229, 0.041), (0.212, 0.041), (0.212, 0.058), (0.205, 0.058), (0.205, 0.043), (0.172, 0.043), (0.168, 0.039)], M['case'], seg=48)
    bolt_ring(fix, I, 0.212, 0.051, 8, 0.0055, M['nut'])
    jet = Mesh(link)
    tube(jet, basis(P3(X_T + 0.03, TH_T - 18, 0.165), U(TH_T - 18), xh), -0.02, 0.03, 0.0, 0.0028, M['steel'], 12)
    made.append(fix.obj('igb_housing', basis(O, u, xh)))
    made.append(jet.obj('igb_oiljet'))

    # ---------------------------------------------------------------- tower (radial drive) shaft
    ms = Mesh(link)
    spline(ms, I, 0.236, 0.248, 0.0155, M['shaft'], z=20)
    rev(ms, I, [(0.248, 0.0102), (0.248, 0.0125), (0.262, 0.012), (0.452, 0.012), (0.458, 0.016), (0.458, 0.009), (0.262, 0.009)], M['shaft'], seg=32)
    # two-piece shaft: bolted flange coupling in the intermediate case, with a balance band either side
    rev(ms, I, [(0.458, 0.012), (0.458, 0.03), (0.464, 0.03), (0.464, 0.012)], M['shaft'], seg=40)
    rev(ms, I, [(0.4645, 0.012), (0.4645, 0.03), (0.4705, 0.03), (0.4705, 0.012)], M['shaft'], seg=40)
    bolt_ring(ms, I, 0.4705, 0.024, 6, 0.004, M['nut'])
    for x in (0.36, 0.6): rev(ms, I, [(x, 0.012), (x, 0.0145), (x + 0.012, 0.0145), (x + 0.012, 0.012)], M['shaft'], seg=32)
    rev(ms, I, [(0.4705, 0.016), (0.476, 0.012), (0.88, 0.012), (0.886, 0.0102), (0.476, 0.009)], M['shaft'], seg=32)
    spline(ms, I, 0.886, 0.9, 0.0145, M['shaft'], z=20)
    turning('tower_shaft', ms, basis(O, u, xh), -z1 / z2, 'tower', 'tower shaft')
    # steady bearing at the coupling, on a bracket from the intermediate case
    st = Mesh(link); st2 = Mesh(link)
    bearing(st2, st, I, 0.49, 0.012, 0.026, 0.012, M, 'ball')
    rev(st, I, [(0.482, 0.026), (0.498, 0.026), (0.498, 0.032), (0.482, 0.032)], M['case'], seg=40)
    made.append(st.obj('tower_steady', basis(O, u, xh)))
    st2.bm.free()

    # ---------------------------------------------------------------- angle gearbox
    z3, z4, m3, b3 = ANGB['z3'], ANGB['z4'], ANGB['m'], ANGB['b']
    Q = P3(X_T, TH_T, ANGB['r'])
    ms, fix = Mesh(link), Mesh(link)
    tg = bevel(ms, I, m3, z3, z4, b3, M['gear'], phase=0.0, beta=ANGB['beta'], hand=1)
    (Xh, Rh), (Xt, Rt) = tg['heel'], tg['toe']
    rev(ms, I, [(Xt, Rt), (Xh, Rh), (Xh + 0.002, Rh - 0.0025), (Xh + 0.002, 0.026), (Xh + 0.006, 0.02), (0.1, 0.02), (0.1, 0.0155), (Xt - 0.002, 0.0155), (Xt - 0.002, Rt - 0.003)], M['gear'], seg=64)
    bearing(ms, fix, I, 0.072, 0.02, 0.032, 0.011, M, 'ball'); bearing(ms, fix, I, 0.093, 0.02, 0.03, 0.01, M, 'roller')
    turning('angb_gear1', ms, basis(Q, -u, -xh), z1 / z2, 'angb', 'tower-shaft bevel gear')
    F1 = basis(Q, -u, -xh)
    ms = Mesh(link); fix2 = Mesh(link)
    lg = bevel(ms, I, m3, z4, z3, b3, M['gear'], phase=math.pi / z4, beta=ANGB['beta'], hand=-1)
    (Xh, Rh), (Xt, Rt) = lg['heel'], lg['toe']
    rev(ms, I, [(Xt, Rt), (Xh, Rh), (Xh + 0.002, Rh - 0.0025), (Xh + 0.002, 0.03), (Xh + 0.007, 0.022), (0.098, 0.022), (0.098, 0.014), (Xt - 0.002, 0.014), (Xt - 0.002, Rt - 0.003)], M['gear'], seg=72)
    bearing(ms, fix2, I, 0.06, 0.022, 0.036, 0.012, M, 'ball'); bearing(ms, fix2, I, 0.09, 0.022, 0.034, 0.011, M, 'roller')
    F2 = basis(Q, -xh, -u)
    turning('angb_gear2', ms, F2, -(z1 / z2) * (z3 / z4), 'angb', 'lay-shaft bevel gear')
    # housing: bore round the tower gear down to the fan case, body round the lay gear, aft cover, chip detector
    rev(fix, I, [(-0.012, 0.03), (0.0, 0.058), (0.062, 0.058), (0.078, 0.04), (0.105, 0.036), (0.112, 0.05), (0.12, 0.05), (0.12, 0.026), (0.105, 0.03), (0.08, 0.034), (0.066, 0.052), (0.004, 0.052), (-0.006, 0.026)], M['cast'], seg=56)
    bolt_ring(fix, I, 0.12, 0.043, 8, 0.005, M['nut'])
    rev(fix2, I, [(-0.052, 0.06), (-0.052, 0.07), (0.05, 0.07), (0.075, 0.042), (0.104, 0.04), (0.104, 0.05), (0.111, 0.05), (0.111, 0.034), (0.1, 0.034), (0.07, 0.037), (0.045, 0.064), (-0.046, 0.064), (-0.046, 0.06)], M['cast'], seg=64)
    rev(fix2, I, [(-0.06, 0.004), (-0.06, 0.074), (-0.052, 0.074), (-0.052, 0.004)], M['cast'], seg=64)   # aft cover
    bolt_ring(fix2, I, -0.06, 0.067, 10, 0.005, M['nut'], facing=-1)
    bolt_ring(fix2, I, 0.111, 0.045, 8, 0.005, M['nut'])
    hexnut(fix2, Matrix.Translation((0.0, -0.075, 0.0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'), -0.004, 0.012, 0.0001, 0.016, M['gold'])   # chip detector, at the low point
    hous = fix.obj('angb_housing1', F1); hous2 = fix2.obj('angb_housing2', F2)
    apply_frame(hous); apply_frame(hous2)
    bpy.ops.object.select_all(action='DESELECT'); hous.select_set(True); hous2.select_set(True); bpy.context.view_layer.objects.active = hous; bpy.ops.object.join()
    hous.name = hous.data.name = 'angb_housing__full'
    cut = hous.copy(); cut.data = hous.data.copy(); link(cut); cut.name = cut.data.name = 'angb_housing__cut'
    half_cut(cut, link, section); made += [hous, cut]

    # ---------------------------------------------------------------- lay (horizontal drive) shaft
    LO = P3(0.0, TH_T, ANGB['r']); FL = Matrix.Translation(LO)
    ms = Mesh(link)
    spline(ms, I, 0.79, 0.802, 0.0135, M['shaft'], z=20)
    rev(ms, I, [(0.802, 0.0095), (0.802, 0.0122), (0.815, 0.0115), (0.83, 0.0115), (0.833, 0.026), (0.836, 0.026), (0.838, 0.0115), (0.842, 0.026), (0.845, 0.026), (0.848, 0.0115), (0.862, 0.0115), (0.866, 0.0122), (0.866, 0.0095)], M['shaft'], seg=40)   # flexible diaphragm coupling
    rev(ms, I, [(0.866, 0.0122), (0.866, 0.0115), (0.88, 0.0115), (0.886, 0.0125), (0.886, 0.0095), (0.866, 0.0095)], M['shaft'], seg=32)
    spline(ms, I, 0.886, 0.9, 0.0135, M['shaft'], z=20)
    turning('layshaft_shaft', ms, FL, (z1 / z2) * (z3 / z4), 'layshaft', 'lay shaft')
    fix = Mesh(link)
    rev(fix, I, [(0.78, 0.026), (0.78, 0.04), (0.788, 0.04), (0.788, 0.03), (0.884, 0.03), (0.884, 0.04), (0.892, 0.04), (0.892, 0.026)], M['cast'], seg=48)
    bolt_ring(fix, I, 0.788, 0.035, 6, 0.0045, M['nut']); bolt_ring(fix, I, 0.884, 0.035, 6, 0.0045, M['nut'], facing=-1)
    rev(fix, I, [(0.83, 0.03), (0.83, 0.034), (0.848, 0.034), (0.848, 0.03)], M['steel'], seg=40)   # support clamp
    lt = fix.obj('layshaft_tube', FL); apply_frame(lt); lt.name = lt.data.name = 'layshaft_tube__full'
    lc = lt.copy(); lc.data = lt.data.copy(); link(lc); lc.name = lc.data.name = 'layshaft_tube__cut'
    half_cut(lc, link, section); made += [lt, lc]

    # ---------------------------------------------------------------- main gearbox gear train
    bad = check_train()
    if bad: raise RuntimeError('gear train: ' + '; '.join(bad))
    spd, phs = train_speeds(), train_phases()
    shafts = {}
    for pl in ('F', 'R'):
        for n, th, r, z, kind in TRAIN[pl]: shafts.setdefault(n, {'th': th, 'r': r, 'kind': kind, 'gears': []})['gears'].append((pl, z))
    fixb = Mesh(link)
    for n, s in shafts.items():
        planes = {pl for pl, _ in s['gears']}
        if planes == {'F', 'R'}: x0, x1 = X_W0 - 0.004, X_W1 + 0.004
        elif planes == {'F'}: x0, x1 = X_W0 - 0.004, X_MID + 0.01
        else: x0, x1 = X_MID - 0.01, X_W1 + 0.004
        if s['kind'] == 'idler':   # idlers ride on short stub shafts between the near wall and the split web
            x0, x1 = (X_W0 + 0.004, X_MID - 0.004) if planes == {'F'} else (X_MID + 0.004, X_W1 - 0.004)
        rmin = min(z * MAIN_M / 2 for _, z in s['gears'])
        rs = min(0.0125, 0.42 * rmin); rh = rs + 0.0065
        ms = Mesh(link); T0 = Matrix.Identity(4)
        for pl, z in s['gears']:
            xg = X_F if pl == 'F' else X_R
            g, rim = spur(ms, T0, MAIN_M, z, FACE, xg, M['gear'], phase=phs[(pl, n)])
            if rim - rh > 0.006:
                ww = 0.36 * FACE
                web(ms, T0, xg - ww / 2, ww, rim + 0.0005, rh - 0.0005, M['gear'], holes=6 if rim - rh > 0.022 else 0, seg=max(48, int(z * 2)))
            rev(ms, T0, [(xg - 0.55 * FACE, rs), (xg + 0.55 * FACE, rs), (xg + 0.55 * FACE, rh), (xg - 0.55 * FACE, rh)], M['gear'], seg=40)
        # gearshaft with shoulders, a bearing at each end (ball at the drive end, roller at the other), lock nuts
        rev(ms, T0, [(x0, rs * 0.55), (x1, rs * 0.55), (x1, rs), (x0, rs)], M['shaft'], seg=32)
        ends = [(x0 + 0.008, 'ball' if s['kind'] == 'fix' else 'roller'), (x1 - 0.008, 'roller' if s['kind'] == 'fix' else 'ball')]
        Tpos = Matrix.Translation(P3(0.0, s['th'], s['r']))
        for xb, kind in ends: bearing(ms, fixb, T0, xb, rs, rs + 0.011, 0.01, M, kind, seg=36, Tfix=Tpos)
        for xb, sgn in ((x0 + 0.0135, 1), (x1 - 0.0135 - 0.005, -1)): hexnut(ms, T0, xb, 0.005, rs, 2 * rs + 0.006, M['nut'])
        if s['kind'] == 'fix' and n not in ('lay', 'si'):   # drive coupling at the accessory pad: internal spline socket
            xe = x0 if 'F' in planes else x1
            rev(ms, T0, [(xe - 0.003, rs * 0.55), (xe - 0.003, rs + 0.004), (xe + 0.003, rs + 0.004), (xe + 0.003, rs * 0.55)], M['shaft'], seg=32)
        if n == 'si':   # starter and IDG drive splines either end
            spline(ms, T0, x0 - 0.01, x0, rs, M['shaft']); spline(ms, T0, x1, x1 + 0.01, rs, M['shaft'])
        if n == 'lay':  # the lay shaft's splined coupling goes out through the rear wall
            spline(ms, T0, x1, x1 + 0.014, rs * 0.9, M['shaft'])
        ratio = spd[('F' if 'F' in planes else 'R', n)]
        what = PAD.get(n, 'idler gear')
        turning(f'agbtrain_{n}', ms, Tpos, ratio, 'agbtrain', what)
    made.append(fixb.obj('agbtrain_bearings'))
    return made, spin


def casing_cut(arc_solid, cast, section, rt, x0=0.36, x1=0.78):
    """The gearbox casting as the cutaway shows it: hollow, with its split web, and the outer skin opened between
    the walls so the gear train can be seen. Returns the object (called from build_engine with its arc_solid)."""
    g0, g1 = CAST['th0'], CAST['th1']
    outer = arc_solid('gbc', [[x0, 0.875], [x0, rt - 0.022], [0.42, rt], [0.7, rt], [x1, rt - 0.027], [x1, 0.875]], g0, g1, cast)
    inner = arc_solid('gbi', [[X_W0, 0.883], [X_W0, rt - 0.03], [0.426, rt - 0.008], [0.696, rt - 0.008], [X_W1, rt - 0.035], [X_W1, 0.883]], g0 + 1.2, g1 - 1.2, cast)
    boolean(outer, inner); bpy.data.objects.remove(inner, do_unlink=True)
    webp = arc_solid('gbw', [[X_MID - 0.005, 0.88], [X_MID - 0.005, rt - 0.004], [X_MID + 0.005, rt - 0.004], [X_MID + 0.005, 0.88]], g0 + 0.5, g1 - 0.5, cast)
    for o in (outer, webp):
        win = arc_solid('win', [[0.388, 1.0], [0.388, 1.2], [0.752, 1.2], [0.752, 1.0]], g0 + 3.5, g1 - 3.5, section)
        boolean(o, win); bpy.data.objects.remove(win, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT'); outer.select_set(True); webp.select_set(True); bpy.context.view_layer.objects.active = outer; bpy.ops.object.join()
    return outer
