"""Gearbox accessories and the oil tank of the V2500, each its own component of the model.

Placement follows the gearbox layout already in build_engine.py (casting under the fan case, 152-208 deg,
front face x 0.36, rear face x 0.78) and the SR Technics component-location booklet / Airbus training
manual: air turbine starter, dedicated alternator, hydraulic pump and lube / scavenge pump on the front
face; IDG, fuel pump with the metering unit, scavenge filter and the hand-cranking pad on the rear; the
lay shaft to the angle gearbox at the fan frame. Shapes are built from what the photos show (flanges,
V-band clamps, ports, plugs, connectors, sight glasses), sized to fit the space between the fan case and
the fan cowl in this model, which is tighter than on the real engine.

Every unit is modelled in its own frame: local X along the engine axis away from its mounting face,
local Z radially out, local Y round the engine. Node names are <component>_<piece> (see model.json).
"""
import math
import bpy, bmesh
from mathutils import Matrix, Vector


# Where each unit sits: (x of its mounting face, angle deg, axis radius m, scale of its design). The front-face
# units point forward. dressing.py aims the routed lines at the ports these positions give.
GEARBOX = dict(th0=148, th1=212, x0=0.36, x1=0.78, r_in=0.875, r_out=1.072)
LAYOUT = {
    'oilpump': (0.36, 160, 0.975, 1.35), 'hydpump': (0.36, 172, 0.975, 1.3), 'pma': (0.36, 183, 0.99, 1.25), 'starter': (0.36, 196, 0.975, 1.33),
    'scav': (0.78, 154, 0.95, 1.25), 'fuelpump': (0.78, 166, 0.97, 1.3), 'crank': (0.78, 176, 0.955, 1.2), 'lay': (0.78, 183, 0.93, 1.0),
    'idg': (0.78, 198, 0.985, 1.36), 'sav': (0.42, 222, 0.975, 1.3), 'oiltank': (0.52, 133.5, 0.97, 1.33),
}
STARTER_INLET_X = 0.36 - 0.205 * 1.33     # where the starter duct meets the starter
SAV_X1 = 0.42 + 0.114 * 1.3               # aft flange of the starter air valve (the duct from the pylon ends here)
DUCT_R = 0.045                            # starter duct radius


def th_pos(x, th, r):
    t = math.radians(th); return (x, -r * math.sin(t), r * math.cos(t))


def to_cyl(p):
    """Blender point -> engine (x, angle deg, radius)."""
    return (p.x, math.degrees(math.atan2(-p.y, p.z)) % 360, math.hypot(p.y, p.z))


def frame(H, x, th, r, fwd=False):
    """Local frame at engine (x, angle, radius). fwd: local +X points forward (front-face accessories)."""
    M = Matrix.Translation(th_pos(x, th, r)) @ Matrix.Rotation(math.radians(th), 4, 'X')
    return M @ Matrix.Rotation(math.pi, 4, 'Z') if fwd else M


FWD = {'oilpump', 'hydpump', 'pma', 'starter'}


def at(key, local):
    """Engine (x, angle, radius) of a point given in a unit's design coordinates (for routing lines to it)."""
    x, th, r, s = LAYOUT[key]
    return to_cyl(frame(None, x, th, r, key in FWD) @ Matrix.Scale(s, 4) @ Vector(local))


def side(th_to, th_frame, r, fwd=False):
    """Local Y of a point at angle th_to seen from a frame at th_frame (radius r). Local +Y is decreasing angle
    (increasing for a forward-facing frame)."""
    y = -math.radians(th_to - th_frame) * r
    return -y if fwd else y


class Kit:
    """Builds meshes in one local frame and keeps them for joining."""

    def __init__(self, H, F, s=1.0):
        # s: the unit's design is drawn at a reference size and scaled up to the real one. Connectors, fittings
        # and pipes keep their absolute sizes (they are standard parts, and the routed lines meet them).
        self.H, self.F, self.s, self.objs = H, F @ Matrix.Scale(s, 4), s, []

    def a(self, v):
        """Absolute length (m) in this unit's design units."""
        return v / self.s

    def _obj(self, name, bm, mat, smooth=True):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.transform(bm, matrix=self.F, verts=bm.verts)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = smooth
        obj = self.H.link(bpy.data.objects.new(name, me)); me.materials.append(mat)
        self.objs.append(obj)
        return obj

    @staticmethod
    def _basis(axis):
        ax = Vector(axis).normalized()
        ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        u = ax.cross(ref).normalized()
        return ax, u, ax.cross(u)

    def rev(self, name, prof, mat, origin=(0, 0, 0), axis=(1, 0, 0), seg=32, closed=False, phase=0.0, smooth=True):
        """Solid of revolution: prof = [(distance along axis, radius), ...]. closed: the profile is a loop (rings)."""
        ax, u, v = self._basis(axis); o = Vector(origin); bm = bmesh.new(); rings = []
        for a, r in prof:
            rings.append([bm.verts.new(o + ax * a + (u * math.cos(t) + v * math.sin(t)) * r)
                          for t in (phase + 2 * math.pi * k / seg for k in range(seg))])
        pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        for A, B in pairs:
            for k in range(seg): bm.faces.new((A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]))
        if not closed:
            if prof[0][1] > 1e-6: bm.faces.new(list(reversed(rings[0])))
            if prof[-1][1] > 1e-6: bm.faces.new(rings[-1])
        return self._obj(name, bm, mat, smooth)

    def cyl(self, name, p0, p1, r0, r1, mat, seg=24, smooth=True):
        d = Vector(p1) - Vector(p0)
        return self.rev(name, [(0, r0), (d.length, r1)], mat, origin=p0, axis=d, seg=seg, smooth=smooth)

    def hexa(self, name, p0, p1, r, mat):
        return self.cyl(name, p0, p1, r, r, mat, seg=6, smooth=False)

    def ring(self, name, a0, a1, r0, r1, mat, origin=(0, 0, 0), axis=(1, 0, 0), seg=40):
        """Band of rectangular section (clamps, straps, weld beads)."""
        return self.rev(name, [(a0, r0), (a1, r0), (a1, r1), (a0, r1)], mat, origin, axis, seg, closed=True)

    def box(self, name, c, size, mat, rot=None):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=size, verts=bm.verts)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ (rot if rot is not None else Matrix.Identity(4)), verts=bm.verts)
        return self._obj(name, bm, mat, smooth=False)

    def loft(self, name, st, mat, n=40, e=0.55):
        """Rounded-box sections along local X: st = [(x, y_centre, z_centre, half_width_y, half_height_z), ...]."""
        bm = bmesh.new(); rings = []
        for a, cy, cz, hw, hh in st:
            ring = []
            for k in range(n):
                t = 2 * math.pi * k / n; c, s = math.cos(t), math.sin(t)
                ring.append(bm.verts.new((a, cy + hw * math.copysign(abs(c) ** e, c), cz + hh * math.copysign(abs(s) ** e, s))))
            rings.append(ring)
        for A, B in zip(rings, rings[1:]):
            for k in range(n): bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
        return self._obj(name, bm, mat)

    def pipe(self, name, pts, r, mat, res=3):
        cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = res; cu.use_fill_caps = True
        sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
        for p, c in zip(sp.points, pts): p.co = (*(self.F @ Vector(c)), 1)
        sp.use_endpoint_u = True; sp.order_u = min(3, len(pts))
        obj = self.H.link(bpy.data.objects.new(name, cu)); cu.materials.append(mat)
        bpy.context.view_layer.objects.active = obj; obj.select_set(True)
        bpy.ops.object.convert(target='MESH'); obj.select_set(False)
        for p in obj.data.polygons: p.use_smooth = True
        self.objs.append(obj)
        return obj

    def bolts(self, name, centre, axis, R, n, rh, h, mat, phase=0.0):
        """Ring of hex heads on a face: centre of the circle, axis the face normal."""
        ax, u, v = self._basis(axis); c = Vector(centre)
        for k in range(n):
            t = phase + 2 * math.pi * k / n; p = c + (u * math.cos(t) + v * math.sin(t)) * R
            self.hexa(name, p, p + ax * h, rh, mat)

    def connector(self, name, base, d, M, size=1.0):
        """Electrical receptacle with its plug: shell, knurled coupling nut, back-shell."""
        d = Vector(d).normalized(); b = Vector(base); s = size / self.s
        self.cyl(name, b, b + d * 0.01 * s, 0.012 * s, 0.012 * s, M['conn'], seg=20)
        self.cyl(name, b + d * 0.01 * s, b + d * 0.024 * s, 0.0135 * s, 0.0135 * s, M['conn'], seg=14, smooth=False)
        self.cyl(name, b + d * 0.024 * s, b + d * 0.04 * s, 0.01 * s, 0.0075 * s, M['dark'], seg=16)

    def fitting(self, name, p0, d, r, M, cap=None):
        """B-nut fitting standing out of a port boss, optionally with a dust cap."""
        d = Vector(d).normalized(); p = Vector(p0); k = 1 / self.s; r = r * k
        self.cyl(name, p, p + d * 0.006 * k, r * 1.25, r * 1.25, M['boss'], seg=20)
        self.hexa(name, p + d * 0.006 * k, p + d * 0.016 * k, r * 1.15, M['nut'])
        if cap is not None: self.cyl(name, p + d * 0.016 * k, p + d * 0.024 * k, r * 1.05, r * 0.95, cap, seg=16)

    def vband(self, name, a, r, M, latch_side=1):
        """V-band (quick-attach) clamp round a flange joint, with its T-bolt latch on one side."""
        self.ring(name, a - 0.006, a + 0.006, r, r + 0.006, M['vband'])
        y = latch_side * (r + 0.009)
        self.box(name, (a, y, 0.0), (0.014, 0.012, 0.03), M['vband'])
        self.cyl(name, (a, y, -0.022), (a, y, 0.022), 0.0035, 0.0035, M['steel'], seg=8)
        self.hexa(name, (a, y, 0.018), (a, y, 0.026), 0.0055, M['nut'])

    def plate(self, name, c, size, M):
        """Data plate with four rivets."""
        self.box(name, c, size, M['steel'])

    def bars(self, name, a0, a1, R, n, M):
        """Exhaust screen: bars round a dark band."""
        for k in range(n):
            t = 2 * math.pi * k / n
            rot = Matrix.Rotation(t, 4, 'X')
            self.box(name, rot @ Vector(((a0 + a1) / 2, 0, R)), (a1 - a0, 0.004, 0.005), M['steel'], rot)


def materials(H):
    m = H.material
    return {
        'cast': m('cast', (0.5, 0.56, 0.62), 0.05, 0.55),
        'steel': m('steel', (0.7, 0.71, 0.72), 1.0, 0.36),
        'dark': m('dark', (0.05, 0.055, 0.06), 0.2, 0.55),
        'gold': m('gold', (0.7, 0.58, 0.33), 0.85, 0.42),
        'conn': m('connector', (0.46, 0.48, 0.5), 0.9, 0.4),
        'nut': m('fitting', (0.74, 0.74, 0.72), 1.0, 0.34),
        'boss': m('cast', (0.5, 0.56, 0.62), 0.05, 0.55),
        'vband': m('vband', (0.66, 0.67, 0.68), 1.0, 0.36),
        'red': m('clamp_red', (0.74, 0.2, 0.09), 0.0, 0.62),
        'glass': m('oilglass', (0.42, 0.24, 0.05), 0.0, 0.06),      # amber oil behind a sight glass
    }


def unit(H, key):
    x, th, r, s = LAYOUT[key]
    return Kit(H, frame(H, x, th, r, key in FWD), s), th, r


# ---------------------------------------------------------------------------- front face (x 0.36, facing forward)

def starter(H, M):
    """Air turbine starter: QAD adapter and V-band clamp, reduction-gear housing with fill / drain plugs and
    sight glass, turbine section behind its exhaust screen, inlet housing to the duct flange."""
    K, th, r = unit(H, 'starter')
    K.rev('st', [(0, 0.071), (0.012, 0.071), (0.012, 0.058), (0.022, 0.06), (0.07, 0.058), (0.078, 0.054), (0.088, 0.054), (0.088, 0.064), (0.094, 0.064)], M['cast'], seg=44)
    K.bolts('st', (0.012, 0, 0), (1, 0, 0), 0.065, 12, 0.0032, 0.005, M['nut'], phase=0.3)
    K.vband('st', 0.03, 0.06, M, latch_side=1)
    K.rev('st', [(0.094, 0.0605), (0.142, 0.0605)], M['dark'], seg=44)          # exhaust screen backing
    K.bars('st', 0.094, 0.142, 0.0615, 34, M)
    K.rev('st', [(0.142, 0.064), (0.148, 0.064), (0.183, 0.046), (0.188, 0.046), (0.188, 0.049), (0.205, 0.049)], M['cast'], seg=44)
    K.bolts('st', (0.188, 0, 0), (-1, 0, 0), 0.044, 8, 0.0028, 0.004, M['nut'])
    for k in range(4):                                                              # cast stiffening ribs on the gear housing
        t = math.pi / 4 + k * math.pi / 2; rot = Matrix.Rotation(t, 4, 'X')
        K.box('st', rot @ Vector((0.046, 0, 0.061)), (0.044, 0.005, 0.006), M['cast'], rot)
    K.hexa('st', (0.05, 0, 0.056), (0.05, 0, 0.066), 0.0075, M['nut'])            # oil fill plug
    K.hexa('st', (0.05, 0, -0.056), (0.05, 0, -0.066), 0.0075, M['gold'])         # magnetic drain plug
    K.cyl('st', (0.05, 0.055, 0.0), (0.05, 0.061, 0.0), 0.011, 0.011, M['glass'])  # oil level sight glass
    K.ring('st', 0.0, 0.004, 0.011, 0.014, M['steel'], origin=(0.05, 0.058, 0.0), axis=(0, 1, 0), seg=24)
    K.plate('st', (0.05, -0.0605, 0.012), (0.028, 0.002, 0.016), M)
    return K.objs


def pma(H, M):
    """Dedicated alternator (permanent magnet) for the EEC: small finned body, two connectors (channels A and B)."""
    K, th, r = unit(H, 'pma')
    K.rev('pm', [(0, 0.042), (0.01, 0.042), (0.01, 0.034), (0.062, 0.034), (0.068, 0.03), (0.08, 0.027), (0.084, 0.02)], M['cast'], seg=32)
    K.bolts('pm', (0.01, 0, 0), (1, 0, 0), 0.038, 6, 0.003, 0.004, M['nut'])
    for k in range(10):
        t = 2 * math.pi * k / 10; rot = Matrix.Rotation(t, 4, 'X')
        K.box('pm', rot @ Vector((0.038, 0, 0.0365)), (0.044, 0.003, 0.006), M['cast'], rot)
    for sgn in (1, -1):
        K.connector('pm', (0.045, sgn * 0.024, 0.024), (0, sgn * 0.707, 0.707), M)
    return K.objs


HYD_PORTS = [(-2.2, 0.0105), (0.0, 0.0085), (2.2, 0.0085)]   # angle offsets of suction, pressure and case-drain ports


def hydpump(H, M):
    """Engine-driven hydraulic pump: QAD flange, piston-pump body, suction / pressure / case-drain ports on top
    (the lines in dressing.py leave from them), depressurisation solenoid, compensator adjuster."""
    K, th, r = unit(H, 'hydpump')
    K.rev('hp', [(0, 0.058), (0.012, 0.058), (0.012, 0.05), (0.02, 0.05), (0.075, 0.048), (0.08, 0.044), (0.125, 0.044), (0.13, 0.038)], M['cast'], seg=36)
    K.rev('hp', [(0.13, 0.038), (0.15, 0.036), (0.155, 0.03), (0.16, 0.03)], M['gold'], seg=32)
    K.bolts('hp', (0.012, 0, 0), (1, 0, 0), 0.053, 8, 0.0032, 0.005, M['nut'], phase=0.2)
    K.vband('hp', 0.03, 0.049, M, latch_side=1)
    K.hexa('hp', (0.16, 0, 0), (0.175, 0, 0), 0.011, M['gold'])                       # compensator adjuster cap
    for dth, rr in HYD_PORTS:
        y = K.a(side(th + dth, th, r + 0.055, True))
        K.box('hp', (0.1, y, 0.032), (0.03, 0.026, 0.02), M['cast'])
        K.fitting('hp', (0.1, y, 0.042), (0, 0, 1), rr, M)
    K.cyl('hp', (0.05, -0.044, 0.0), (0.05, -0.09, 0.0), 0.016, 0.016, M['gold'], seg=24)   # depressurisation solenoid
    K.connector('hp', (0.05, -0.09, 0.0), (0, -1, 0), M)
    K.hexa('hp', (0.105, 0, -0.04), (0.105, 0, -0.052), 0.007, M['nut'])               # case drain plug
    K.plate('hp', (0.1, 0.0445, -0.012), (0.03, 0.002, 0.018), M)
    return K.objs


def oilpump(H, M):
    """Lube and scavenge pump (pressure element plus scavenge elements stacked on one shaft, tie bolts at
    each joint, chip detector underneath), and the scavenge filter on the rear face of the gearbox."""
    K, th, r = unit(H, 'oilpump')
    K.rev('op', [(0, 0.05), (0.01, 0.05), (0.01, 0.044), (0.038, 0.044), (0.038, 0.048), (0.044, 0.048), (0.044, 0.042),
                 (0.072, 0.042), (0.072, 0.046), (0.078, 0.046), (0.078, 0.038), (0.098, 0.038), (0.098, 0.032), (0.108, 0.03)], M['gold'], seg=36)
    K.bolts('op', (0.01, 0, 0), (1, 0, 0), 0.046, 6, 0.003, 0.004, M['nut'])
    for a, R in ((0.044, 0.045), (0.078, 0.042)): K.bolts('op', (a, 0, 0), (1, 0, 0), R, 6, 0.0028, 0.004, M['nut'], phase=0.5)
    y = K.a(side(th + 2, th, r + 0.06, True))                                           # pressure line to the transmitter (dressing.py)
    K.box('op', (0.02, y, 0.036), (0.022, 0.02, 0.016), M['gold'])
    K.fitting('op', (0.02, y, 0.044), (0, 0, 1), 0.006, M)
    K.cyl('op', (0.06, 0, -0.04), (0.06, 0, -0.052), 0.009, 0.009, M['gold'], seg=16)    # master chip detector
    K.connector('op', (0.06, 0, -0.052), (0, 0, -1), M, size=0.75)
    objs = K.objs
    F, th, r = unit(H, 'scav')                                                           # scavenge filter, rear face
    F.rev('of', [(0, 0.052), (0.03, 0.052)], M['cast'], seg=32)
    F.rev('of', [(0.03, 0.045), (0.035, 0.047), (0.14, 0.047), (0.15, 0.04), (0.155, 0.02)], M['gold'], seg=32)
    for k in range(8):
        t = 2 * math.pi * k / 8; rot = Matrix.Rotation(t, 4, 'X')
        F.box('of', rot @ Vector((0.09, 0, 0.0475)), (0.09, 0.004, 0.003), M['gold'], rot)
    F.hexa('of', (0.155, 0, 0), (0.172, 0, 0), 0.018, M['nut'])                          # bowl nut
    F.cyl('of', (0.015, 0, 0.05), (0.015, 0, 0.058), 0.007, 0.007, M['red'], seg=16)     # pop-up clogging indicator
    F.box('of', (0.015, 0.05, 0.0), (0.024, 0.016, 0.03), M['gold'])                      # differential pressure switch
    F.connector('of', (0.015, 0.058, 0.0), (0, 1, 0), M, size=0.75)
    return objs + F.objs


# ---------------------------------------------------------------------------- rear face (x 0.78, facing aft)

IDG_COOLER = (0.05, 0.07)   # design x of the two cooler ports on the outboard side of the IDG


def idg(H, M):
    """Integrated drive generator: QAD adapter, oil-filled case in two halves bolted at a flange, feeder
    terminal block with its cables, sight glass, charge filter, disconnect solenoid with reset ring,
    cooler supply and return on the outboard side (lines from the IDG oil cooler in dressing.py)."""
    K, th, r = unit(H, 'idg')
    K.rev('ig', [(0, 0.074), (0.012, 0.074), (0.012, 0.066), (0.028, 0.066)], M['cast'], seg=44)
    K.bolts('ig', (0.012, 0, 0), (1, 0, 0), 0.07, 12, 0.003, 0.005, M['nut'], phase=0.2)
    K.vband('ig', 0.02, 0.066, M, latch_side=1)
    K.loft('ig', [(0.026, 0, 0, 0.066, 0.056), (0.04, 0, 0, 0.098, 0.06), (0.056, 0, 0, 0.11, 0.062), (0.13, 0, 0, 0.11, 0.062),
                  (0.133, 0, 0, 0.114, 0.0655), (0.141, 0, 0, 0.114, 0.0655), (0.144, 0, 0, 0.107, 0.06), (0.24, 0, -0.002, 0.1, 0.057),
                  (0.268, 0, -0.004, 0.086, 0.048), (0.284, 0, -0.005, 0.062, 0.035)], M['cast'], n=48)
    for k in range(20):                                                                    # bolts round the case joint
        t = 2 * math.pi * (k + 0.5) / 20; c, s_ = math.cos(t), math.sin(t)
        y = 0.117 * math.copysign(abs(c) ** 0.55, c); z = 0.0685 * math.copysign(abs(s_) ** 0.55, s_)
        K.hexa('ig', (0.141, y * 0.97, z * 0.97), (0.146, y * 0.97, z * 0.97), 0.003, M['nut'])
    # feeder terminal block on the outboard side, three cables aft to the fan frame
    K.box('ig', (0.2, -0.108, 0.0), (0.075, 0.02, 0.06), M['dark'])
    K.box('ig', (0.2, -0.12, 0.0), (0.07, 0.006, 0.054), M['dark'])
    for k, z in enumerate((-0.018, 0.0, 0.018)):
        K.hexa('ig', (0.188, -0.123, z), (0.188, -0.133, z), 0.006, M['nut'])
        K.pipe('igc', [(0.188, -0.133, z), (0.2, -0.142, z), (0.24, -0.142, z * 0.6 + 0.01), (0.27, -0.13, 0.025), (0.288, -0.11, 0.035)], 0.0085, M['dark'])
    K.box('ig', (0.288, -0.11, 0.035), (0.016, 0.05, 0.026), M['steel'])                  # cable clamp on the fan frame bracket
    K.cyl('ig', (0.11, -0.1095, 0.026), (0.11, -0.115, 0.026), 0.012, 0.012, M['glass'])  # sight glass
    K.ring('ig', 0, 0.005, 0.012, 0.016, M['steel'], origin=(0.11, -0.111, 0.026), axis=(0, -1, 0), seg=24)
    K.cyl('ig', (0.09, 0.104, -0.012), (0.09, 0.13, -0.012), 0.02, 0.02, M['gold'], seg=24)   # charge filter
    K.hexa('ig', (0.09, 0.13, -0.012), (0.09, 0.14, -0.012), 0.012, M['nut'])
    K.cyl('ig', (0.04, -0.085, 0.045), (0.1, -0.085, 0.045), 0.012, 0.012, M['gold'], seg=20)   # disconnect solenoid
    K.ring('ig', 0.1, 0.106, 0.012, 0.017, M['red'], origin=(0, -0.085, 0.045), seg=20)      # reset ring
    K.connector('ig', (0.04, -0.085, 0.045), (-1, 0, 0), M, size=0.75)
    for a in IDG_COOLER:                                                                      # cooler supply and return
        K.box('ig', (a, -0.108, -0.012), (0.016, 0.012, 0.02), M['cast'])
        K.fitting('ig', (a, -0.114, -0.012), (0, -1, 0), 0.008, M)
    for k, a in enumerate((0.17, 0.205)):                                                    # pressure fill and overflow drain
        K.fitting('ig', (a, 0.105, -0.02), (0, 1, 0), 0.007, M, cap=M['red'] if k == 0 else M['dark'])
    K.hexa('ig', (0.11, 0.0, -0.06), (0.11, 0.0, -0.07), 0.007, M['nut'])                  # case drain plug
    K.plate('ig', (0.15, -0.1105, -0.03), (0.04, 0.002, 0.022), M)
    return K.objs


def fuelpump(H, M):
    """Two-stage fuel pump: QAD flange, LP (centrifugal) and HP (gear) stage housings bolted together,
    relief valve cap and drain. The metering unit bolts on behind it (fmu())."""
    K, th, r = unit(H, 'fuelpump')
    K.rev('fp', [(0, 0.064), (0.012, 0.064), (0.012, 0.056), (0.02, 0.058), (0.06, 0.058), (0.064, 0.062), (0.072, 0.062),
                 (0.076, 0.052), (0.13, 0.05), (0.134, 0.054), (0.142, 0.054), (0.142, 0.046), (0.15, 0.046)], M['gold'], seg=40)
    K.bolts('fp', (0.012, 0, 0), (1, 0, 0), 0.06, 10, 0.0032, 0.005, M['nut'], phase=0.2)
    K.vband('fp', 0.03, 0.058, M, latch_side=1)
    K.bolts('fp', (0.072, 0, 0), (1, 0, 0), 0.057, 10, 0.0028, 0.004, M['nut'])
    K.bolts('fp', (0.142, 0, 0), (1, 0, 0), 0.05, 8, 0.0028, 0.004, M['nut'])
    K.cyl('fp', (0.1, -0.048, 0.0), (0.1, -0.066, 0.0), 0.014, 0.014, M['gold'], seg=20)   # pressure relief valve
    K.hexa('fp', (0.1, -0.066, 0.0), (0.1, -0.075, 0.0), 0.01, M['nut'])
    K.hexa('fp', (0.04, 0.0, -0.056), (0.04, 0.0, -0.066), 0.007, M['nut'])                # drain
    K.plate('fp', (0.105, 0.0505, 0.0), (0.03, 0.002, 0.018), M)
    return K.objs


FMU_REAR = 0.29     # design x of the metering unit's back face


def fmu(H, M):
    """Fuel metering unit behind the fuel pump: block with the metering-valve position sensor (LVDT), the
    torque motor with its two connectors (EEC channels A and B), the shut-off solenoid, cover plates, the
    ports for the lines to the fuel-cooled oil cooler and LP filter, the servo-fuel manifold on the back
    face and the metered-fuel outlet (all meeting the routes in dressing.py)."""
    K, th, r = unit(H, 'fuelpump')
    R = FMU_REAR
    K.loft('fm', [(0.15, 0, 0.005, 0.058, 0.046), (0.158, 0, 0.005, 0.07, 0.054), (R - 0.008, 0, 0.005, 0.07, 0.054), (R, 0, 0.005, 0.062, 0.047)], M['gold'], e=0.3)
    K.cyl('fm', (0.165, -0.074, 0.012), (R - 0.02, -0.074, 0.012), 0.014, 0.014, M['gold'], seg=24)   # LVDT housing
    K.connector('fm', (R - 0.02, -0.074, 0.012), (1, 0, 0), M, size=0.8)
    K.box('fm', (0.21, -0.078, -0.026), (0.05, 0.02, 0.036), M['gold'])                       # torque motor
    for z in (-0.034, -0.018): K.connector('fm', (0.202 + (z + 0.034) * 0.6, -0.088, z), (0, -1, 0), M, size=0.7)
    K.cyl('fm', (0.255, 0.068, 0.018), (0.255, 0.098, 0.018), 0.015, 0.015, M['gold'], seg=24)    # shut-off solenoid
    K.connector('fm', (0.255, 0.098, 0.018), (0, 1, 0), M, size=0.75)
    for a in (0.18, 0.222):                                                                   # cover plates with lockwired screws
        K.box('fm', (a, 0.0705, -0.02), (0.034, 0.003, 0.026), M['steel'])
        for dy in (-0.011, 0.011):
            for dz in (-0.009, 0.009): K.hexa('fm', (a + dy, 0.072, -0.02 + dz), (a + dy, 0.075, -0.02 + dz), 0.0025, M['nut'])
    yp = K.a(side(162, th, 1.04))                                                             # to / from the FCOC and LP filter
    for y in (yp - K.a(0.015), yp + K.a(0.015)): K.fitting('fm', (0.22, y, 0.058), (0, 0, 1), 0.0095, M)
    K.box('fm', (R + 0.006, 0, 0.003), (0.012, K.a(0.074), 0.022), M['gold'])                 # servo fuel manifold
    for k in range(6): K.hexa('fm', (R + 0.012, K.a((k - 2.5) * 0.011), 0.003), (R + 0.012 + K.a(0.008), K.a((k - 2.5) * 0.011), 0.003), K.a(0.0042), M['nut'])
    ym = K.a(side(160, th, 0.97))                                                             # metered fuel outlet elbow
    K.box('fm', (R - 0.004, ym - 0.004, 0.003), (0.03, 0.03, 0.028), M['gold'])
    K.hexa('fm', (R + 0.01, ym, 0.003), (R + 0.01 + K.a(0.012), ym, 0.003), K.a(0.012), M['nut'])
    K.plate('fm', (0.24, 0.0, 0.0605), (0.04, 0.026, 0.002), M)
    return K.objs


# ---------------------------------------------------------------------------- off the gearbox

def sav(H, M):
    """Starter air valve in the starter duct: butterfly body between flanges, V-band clamps to the duct,
    pneumatic actuator, solenoid with its harness receptacle, manual override."""
    K, th, r = unit(H, 'sav')
    K.rev('sv', [(0, 0.042), (0.012, 0.042), (0.012, 0.036), (0.022, 0.036), (0.03, 0.05), (0.084, 0.05), (0.092, 0.036), (0.102, 0.036), (0.102, 0.042), (0.114, 0.042)], M['cast'], seg=40)
    for a in (0.006, 0.108): K.ring('sv', a - 0.007, a + 0.007, 0.043, 0.048, M['vband'])
    K.cyl('sv', (0.057, -0.045, 0.0), (0.057, -0.112, 0.0), 0.028, 0.028, M['gold'], seg=28)   # actuator
    K.cyl('sv', (0.057, -0.112, 0.0), (0.057, -0.12, 0.0), 0.024, 0.02, M['gold'], seg=28)
    K.cyl('sv', (0.04, -0.09, 0.02), (0.012, -0.09, 0.02), 0.013, 0.013, M['gold'], seg=20)    # solenoid
    K.cyl('sv', (0.012, -0.09, 0.02), (0.004, -0.09, 0.02), K.a(0.012), K.a(0.012), M['conn'], seg=20)
    K.hexa('sv', (0.057, 0.0, 0.05), (0.057, 0.0, 0.058), 0.01, M['nut'])                     # manual override square drive
    K.box('sv', (0.057, 0.0, 0.0605), (0.02, 0.004, 0.003), M['red'])                         # position pointer
    K.plate('sv', (0.057, -0.075, 0.029), (0.03, 0.02, 0.002), M)
    return K.objs


TANK_PORTS = [(-0.02, -0.169, 0.02), (0.02, -0.169, 0.02)]   # design coordinates of the supply / return fitting tips


def oiltank(H, M):
    """Oil tank on the lower left of the fan case: welded cylinder with domed ends on two strapped saddles,
    gravity filler with cap and scupper, sight glass, quantity transmitter, supply and return ports at the
    lower end, remote pressure-fill and overflow connections."""
    K, th, r = unit(H, 'oiltank')
    Ls, D, Rt = 0.12, 0.045, 0.074
    prof = [(-(Ls + D * math.cos(t)), Rt * math.sin(t)) for t in [0.18 + (math.pi / 2 - 0.18) * i / 7 for i in range(8)]]
    prof += [(Ls + D * math.cos(t), Rt * math.sin(t)) for t in [math.pi / 2 - (math.pi / 2 - 0.18) * i / 7 for i in range(8)]]
    K.rev('ot', prof, M['cast'], axis=(0, 1, 0), seg=44)
    for a in (-Ls, Ls): K.ring('ot', a - 0.003, a + 0.003, Rt, Rt + 0.0025, M['cast'], axis=(0, 1, 0))   # weld beads
    for a in (-0.07, 0.07):                                                                       # saddles and straps
        K.ring('ot', a - 0.01, a + 0.01, Rt + 0.0005, Rt + 0.004, M['steel'], axis=(0, 1, 0))
        K.box('ot', (0.0, a, -0.083), (0.07, 0.024, 0.024), M['cast'])
        K.box('ot', (0.0, a, -0.0955), (0.1, 0.03, 0.006), M['cast'])
        K.hexa('ot', (0.0, a, Rt + 0.004), (0.0, a, Rt + 0.011), 0.005, M['nut'])               # strap tensioner
    d = Vector((0, 0.87, 0.5)); b = Vector((0, 0.148, 0.03))                                     # gravity filler, angled up the side
    K.cyl('ot', b, b + d * 0.03, 0.019, 0.019, M['cast'], seg=24)
    K.ring('ot', 0.012, 0.02, 0.019, 0.03, M['steel'], origin=b, axis=d, seg=28)                # scupper
    K.cyl('ot', b + d * 0.03, b + d * 0.042, 0.025, 0.022, M['gold'], seg=24)                   # cap
    K.box('ot', b + d * 0.046, (0.04, 0.01, 0.008), M['gold'], Matrix.Rotation(math.atan2(d.z, d.y) - math.pi / 2, 4, 'X'))  # cap handle
    K.box('ot', (Rt - 0.002, 0.02, 0.0), (0.006, 0.064, 0.03), M['steel'])                      # sight glass bezel
    K.box('ot', (Rt + 0.0015, 0.02, 0.0), (0.003, 0.052, 0.02), M['glass'])
    for y, w in ((0.042, 0.012), (-0.002, 0.012)): K.box('ot', (Rt + 0.004, y, 0.0), (0.002, w, 0.024), M['red'] if y < 0 else M['dark'])  # ADD / FULL marks
    K.cyl('ot', (Rt - 0.004, -0.06, 0.03), (Rt + 0.016, -0.06, 0.03), 0.015, 0.015, M['gold'], seg=24)   # quantity transmitter
    K.connector('ot', (Rt + 0.016, -0.06, 0.03), (1, 0, 0), M, size=0.8)
    for x, y, z in TANK_PORTS: K.fitting('ot', (x, -0.157, z), (0, -1, 0), 0.008, M)          # supply and return (gearbox lines)
    for k, y in enumerate((0.04, 0.075)):                                                       # remote pressure fill and overflow
        K.fitting('ot', (-Rt + 0.004, y, -0.03), (-1, 0, 0), 0.0075, M, cap=M['red'] if k == 0 else M['dark'])
    return K.objs


# ---------------------------------------------------------------------------- gearbox casting additions

def gearbox_extras(H, M):
    """Lay shaft housing to the angle gearbox at the fan frame (with the tower-shaft housing going in to the
    core), the hand-cranking pad. Joined into the gearbox component."""
    x, th, r, _ = LAYOUT['lay']
    K = Kit(H, frame(H, x, th, r))
    K.rev('gx', [(0, 0.04), (0.01, 0.04), (0.01, 0.026), (0.27, 0.026), (0.27, 0.034), (0.28, 0.034)], M['cast'], seg=32)
    K.bolts('gx', (0.01, 0, 0), (1, 0, 0), 0.035, 6, 0.003, 0.004, M['nut'])
    K.ring('gx', 0.13, 0.15, 0.026, 0.031, M['steel'], seg=28)                                 # support clamp
    K.box('gx', (0.14, 0.0, -0.045), (0.02, 0.022, 0.03), M['steel'])
    A = Kit(H, frame(H, x + 0.28, th, r - 0.01))                                               # angle gearbox
    A.loft('gx', [(0.0, 0, 0.0, 0.05, 0.045), (0.015, 0, 0.0, 0.06, 0.05), (0.06, 0, -0.008, 0.06, 0.05), (0.075, 0, -0.016, 0.045, 0.04)], M['cast'])
    A.cyl('gx', (0.04, 0, -0.04), (0.04, 0, -0.08), 0.026, 0.026, M['cast'], seg=24)          # tower shaft housing, into the fan frame
    A.bolts('gx', (0.0, 0, 0), (-1, 0, 0), 0.03, 6, 0.003, 0.004, M['nut'])
    A.hexa('gx', (0.035, 0.0, 0.05), (0.035, 0.0, 0.058), 0.007, M['gold'])                   # chip detector
    x, th, r, s = LAYOUT['crank']
    C = Kit(H, frame(H, x, th, r), s)                                                          # hand-cranking pad
    C.rev('gx', [(0, 0.032), (0.008, 0.032), (0.008, 0.024), (0.016, 0.022)], M['cast'], seg=28)
    C.bolts('gx', (0.008, 0, 0), (1, 0, 0), 0.028, 4, 0.0032, 0.005, M['nut'], phase=math.pi / 4)
    C.hexa('gx', (0.016, 0, 0), (0.028, 0, 0), 0.012, M['gold'])
    return K.objs + A.objs + C.objs


UNITS = [('starter', starter), ('pma', pma), ('hydpump', hydpump), ('oilpump', oilpump), ('idg', idg),
         ('fuelpump', fuelpump), ('fmu', fmu), ('sav', sav), ('oiltank', oiltank)]


def build_accessories(H, made, bevel=0.0012):
    M = materials(H)
    for comp, fn in UNITS:
        made.append(H.finish(H.join(comp + '_body', fn(H, M)), bevel))
