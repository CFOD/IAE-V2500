"""Decals: data plates, safety placards, stencils, tags and blade numbers, each laid on the surface it belongs to.

A decal is a small grid that is ray-cast onto its target objects point by point, so it follows a cylinder, a
casting or a cowl without floating at the edges. Its material is named 'dec:<kind>:<text>'; the app draws the
texture from that name when the model loads (app/decals.js), so the model file carries no images. Each decal
is named after the part it belongs to, so it moves, explodes and hides with that part.

What is printed: the engine data plate on the fan case, a plate on every accessory and core unit with its
nomenclature and (made-up) part and serial numbers, the servicing and safety placards of the Airbus training
manual's figures (oil tank, IDG, starter, ignition, reverser, cowls), latch and access stencils on the cowls,
tags on the chip detectors and the bulkhead panel, and the fan blade numbers on the spinner fairing, which match
the borescope's blade count. Fluid-line tapes, wire markers and torque-seal stripes are added along the lines
themselves (pipes.py).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import accessories as AC


def P3(x, th, r):
    t = math.radians(th); return Vector((x, -r * math.sin(t), r * math.cos(t)))


def U(th):
    t = math.radians(th); return Vector((0.0, -math.sin(t), math.cos(t)))


class Decals:
    def __init__(self, material, link):
        self.material, self.link, self.made, self._bvh = material, link, [], {}

    def mat(self, spec):
        return self.material('dec:' + spec, (0.9, 0.9, 0.88), 0.0, 0.55)

    def bvh(self, names):
        key = tuple(names)
        if key not in self._bvh:
            dg = bpy.context.evaluated_depsgraph_get(); trees = []
            for n in names:
                o = bpy.data.objects.get(n)
                if o is None or o.type != 'MESH': continue
                trees.append((BVHTree.FromObject(o, dg), o.matrix_world.copy()))
            self._bvh[key] = trees
        return self._bvh[key]

    def cast(self, trees, origin, d, far=0.6):
        best = None
        for tree, Mw in trees:
            inv = Mw.inverted(); o = inv @ origin; dd = (inv.to_3x3() @ d).normalized()
            loc, nrm, _, dist = tree.ray_cast(o, dd, far)
            if loc is not None and (best is None or dist < best[2]):
                best = (Mw @ loc, (Mw.to_3x3() @ nrm).normalized(), dist)
        return best

    def project(self, name, targets, origin, direction, right, w, h, spec, nx=6, ny=4, lift=0.0007, back=0.05):
        """A w x h decal: the ray from origin along direction finds the spot; the grid is cast onto the targets
        along the surface normal there. Text reads along `right`."""
        trees = self.bvh(targets); d = Vector(direction).normalized(); hit = self.cast(trees, Vector(origin), d)
        if hit is None: print('decal missed:', name); return None
        c, n, _ = hit
        if n.dot(d) > 0: n = -n
        r = Vector(right); r = (r - n * r.dot(n)).normalized(); up = n.cross(r)
        bm = bmesh.new(); uv = bm.loops.layers.uv.verify(); grid = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                p = c + r * ((i / nx - 0.5) * w) + up * ((0.5 - j / ny) * h)
                q = self.cast(trees, p + n * back, -n, back * 2.5)
                row.append(bm.verts.new((q[0] + q[1] * lift) if q else (p + n * lift)))
            grid.append(row)
        for j in range(ny):
            for i in range(nx):
                f = bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
                for l, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))): l[uv].uv = (ii / nx, 1 - jj / ny)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        # the decal faces the way it was cast from
        if me.polygons and Vector(me.polygons[0].normal).dot(n) < 0: me.flip_normals()
        for p in me.polygons: p.use_smooth = True
        me.materials.append(self.mat(spec))
        o = self.link(bpy.data.objects.new(name, me)); self.made.append(o); return o

    def unit(self, key, spec, x_frac=0.5, ang=0.0, w=0.06, h=0.034, name=None, right='axis', reach=0.3):
        """A decal on an accessory (accessories.LAYOUT key): at x_frac of its length, on the side at angle `ang`
        from radially outward (local +Z) towards local +Y."""
        obj = bpy.data.objects.get(key + '_body')
        if obj is None: print('no unit', key); return None
        x, th, r, s = AC.LAYOUT[key]; F = AC.frame(None, x, th, r, key in AC.FWD) @ Matrix.Scale(s, 4)
        inv = F.inverted(); xs = [(inv @ v.co).x for v in obj.data.vertices]
        xl = min(xs) + (max(xs) - min(xs)) * x_frac
        a = math.radians(ang); out = Vector((0, math.sin(a), math.cos(a)))
        o = F @ (Vector((xl, 0, 0)) + out * (reach / s)); d = (F.to_3x3() @ -out).normalized()
        rt = (F.to_3x3() @ Vector((1, 0, 0))).normalized() if right == 'axis' else Vector(right)
        return self.project(name or f'{key}_plate', [obj.name], o, d, rt, w, h, spec)


# ------------------------------------------------------------------------------------- what is printed where
PLATES = {   # (key, x_frac, angle, w, h, text)
    'idg': (0.55, -55, 0.085, 0.05, 'plate:INTEGRATED DRIVE GENERATOR|P/N=761090C|S/N=IDG40873|RATING=90 KVA 115/200 V 400 HZ|INPUT=4500-9100 RPM|OIL=MIL-PRF-23699'),
    'starter': (0.45, -50, 0.07, 0.042, 'plate:AIR TURBINE STARTER|P/N=3505810-3|S/N=ATS11962|INLET=55 PSIG MAX|OIL=MIL-PRF-23699'),
    'hydpump': (0.5, -50, 0.065, 0.04, 'plate:PUMP HYDRAULIC ENGINE DRIVEN|P/N=3069-9|S/N=EDP27315|RATED=3000 PSI 37 GPM|FLUID=PHOSPHATE ESTER'),
    'fuelpump': (0.35, -40, 0.07, 0.042, 'plate:PUMP FUEL ENGINE DRIVEN|P/N=720550-7|S/N=FP06228|STAGES=CENTRIFUGAL + GEAR|FILTER=40 MICRON'),
    'oilpump': (0.86, -45, 0.06, 0.036, 'plate:PUMP OIL PRESSURE AND FILTER|P/N=2A3874|S/N=LP15540|FILTER=15 MICRON'),
    'pma': (0.5, -45, 0.06, 0.036, 'plate:ALTERNATOR DEDICATED|P/N=1152682-2|S/N=PMA20951|OUTPUT=EEC POWER + N2'),
    'sav': (0.5, -40, 0.06, 0.036, 'plate:VALVE STARTER AIR|P/N=3290286-4|S/N=SAV08377|OVERRIDE=3/8 IN SQ DRIVE'),
    'oiltank': (0.55, 40, 0.085, 0.05, 'plate:TANK ENGINE OIL|P/N=2A5096|S/N=OT33190|OIL=MIL-PRF-23699 ONLY|SERVICE=SEE AMM 12-13-79'),
}
PLACARDS = {   # (key, x_frac, angle, w, h, text)
    'oiltank': (0.25, 40, 0.085, 0.05, 'warn:CAUTION|CHECK OIL LEVEL WITHIN|30 MIN OF SHUTDOWN|DO NOT OVERFILL'),
    'idg': (0.22, -55, 0.085, 0.045, 'warn:CAUTION|IDG DISCONNECT: RESET ON|GROUND, ENGINE STOPPED'),
    'starter': (0.8, -50, 0.065, 0.035, 'warn:CAUTION|SERVICE OIL AT|FILL PORT ONLY'),
    'hydpump': (0.15, -50, 0.065, 0.034, 'warn:WARNING|DEPRESSURIZE SYSTEM|BEFORE REMOVAL'),
}
CORE_PLATES = [   # (object, w, h, text): units on the cases, cast radially inward onto their outer face
    ('eec_box', 'plate:ELECTRONIC ENGINE CONTROL|P/N=EEC104-60|S/N=EC71206|CHANNELS=A AND B|SOFTWARE=SCN 22', 0.12, 0.07),
]


def build(material, link, made, fan_case, spinner_r, nacelle_oml):
    """Lay every decal. fan_case(x): fan case outer radius; spinner_r(x): spinner fairing radius;
    nacelle_oml(x, th): outer mould line."""
    D = Decals(material, link)
    for key, (xf, ang, w, h, text) in PLATES.items(): D.unit(key, text, xf, ang, w, h)
    for key, (xf, ang, w, h, text) in PLACARDS.items(): D.unit(key, text, xf, ang, w, h, name=f'{key}_placard')
    # core units: a plate on each, cast inward from outside it; high-voltage warning on the ignition exciters
    def on_core(name, spec, w, h, obj_name, dth=0.0, xf=0.5):
        o = bpy.data.objects.get(obj_name)
        if o is None: print('no object', obj_name); return
        vs = [o.matrix_world @ v.co for v in o.data.vertices]; c = sum(vs, Vector()) / len(vs)
        x0, x1 = min(v.x for v in vs), max(v.x for v in vs); th = math.degrees(math.atan2(-c.y, c.z)) % 360 + dth
        D.project(name, [o.name], P3(x0 + (x1 - x0) * xf, th, math.hypot(c.y, c.z) + 0.4), -U(th), (1, 0, 0), w, h, spec)
    for nm, spec, w, h in CORE_PLATES: on_core(nm.split('_')[0] + '_plate', spec, w, h, nm)
    on_core('exciters_hv', 'warn:DANGER|HIGH VOLTAGE|STORED ENERGY', 0.05, 0.03, 'exciters_body', xf=0.3)
    on_core('exciters_plate', 'plate:EXCITER IGNITION|P/N=10-617285|S/N=IX40118|OUTPUT=20 KV 4 J', 0.05, 0.03, 'exciters_body', xf=0.75)
    on_core('fdv_plate', 'plate:VALVE FUEL DIVERTER|P/N=2A6630|S/N=FD27711', 0.045, 0.026, 'fdv_body')

    # engine data plate, on the fan case low on the left, ahead of the gearbox
    fc = [o.name for o in bpy.data.objects if o.name.startswith('fancase_casing') and not o.name.endswith('__cut')]
    th = 146.0; x = 0.2
    D.project('fancase_dataplate', fc, P3(x, th, 1.2), -U(th), (1, 0, 0), 0.15, 0.085,
              'plate:INTERNATIONAL AERO ENGINES|MODEL=V2527-A5|SERIAL=V12841|TYPE CERT=FAA E40NE  EASA IM.E.069|T/O THRUST=26,500 LBF (117.9 KN)|DATE OF MFR=03 2011', nx=8, ny=5)
    # stencils on the fan case: forward arrow, lift points, grounding stud, the gearbox's oil service
    D.project('fancase_fwd__full', fc, P3(0.55, 100, 1.2), -U(100), (-1, 0, 0), 0.16, 0.05, 'sten:W:<< FWD')
    for th0 in (60, 300):
        D.project(f'fancase_lift{th0}' + ('__full' if th0 < 112 else ''), fc, P3(0.3, th0, 1.2), -U(th0), (1, 0, 0), 0.12, 0.035, 'sten:Y:LIFT POINT')
    D.project('fancase_ground', fc, P3(0.66, 128, 1.2), -U(128), (1, 0, 0), 0.08, 0.025, 'sten:K:GROUND HERE')
    D.project('fancase_hold__full', fc, P3(0.95, 30, 1.2), -U(30), (1, 0, 0), 0.22, 0.06, 'warn:WARNING|INSTALL HOLD-OPEN RODS|BEFORE WORKING UNDER COWLS')
    D.project('fancase_chipdet', fc, P3(0.3, 157, 1.2), -U(157), (1, 0, 0), 0.07, 0.022, 'tag:MASTER CHIP DET')

    # bulkhead (disconnect) panel tags at 6 o'clock
    panel = [o.name for o in bpy.data.objects if o.name.startswith('fancase_dressing')]
    for k, (xx, txt) in enumerate([(1.06, 'FUEL'), (1.11, 'SERVO'), (1.16, 'OIL'), (1.21, 'P3 AIR')]):
        D.project(f'fancase_ptag{k}', panel, P3(xx, 175.5, 1.0), -U(175.5), (1, 0, 0), 0.04, 0.016, 'tag:' + txt, nx=2, ny=1)

    # cowl stencils: latches, access doors, hoist points (outside)
    cowl = [o.name for o in bpy.data.objects if o.name.startswith('fancowl_doors') and not o.name.endswith('__cut')]
    for k, xx in enumerate((0.2, 0.6, 1.0)):
        D.project(f'fancowl_latch{k}_L', cowl, P3(xx + 0.07, 176, 1.6), -U(176), (1, 0, 0), 0.07, 0.02, 'sten:K:LATCH')
    D.project('fancowl_push_R', cowl, P3(0.5, 222, 1.6), -U(222), (1, 0, 0), 0.08, 0.022, 'sten:K:PUSH TO OPEN')
    cna = [n for n in ('cna_sleeve_L', 'cna_torquebox_L') if bpy.data.objects.get(n)]
    for xx in (1.75, 1.95, 2.15):   # first spot on the sleeve that a ray finds
        if D.project('cna_lockout_L', cna, P3(xx, 140, 1.6), -U(140), (1, 0, 0), 0.2, 0.07, 'warn:DANGER|DEACTIVATE REVERSER|BEFORE MAINTENANCE'): break

    # fan blade numbers on the spinner fairing, one at each blade root (blade 1 at the top, as the borescope counts)
    sp = [o.name for o in bpy.data.objects if o.name.startswith('spinner_fairing')]
    for i in range(22):
        th = i * 360.0 / 22; x = -0.03
        D.project(f'spinner_n{i + 1}', sp, P3(x, th, spinner_r(x) + 0.08), -U(th), U(th + 90), 0.03, 0.022, f'sten:K:{i + 1}', nx=2, ny=2, lift=0.0005)

    made.extend(D.made)
    return D.made
