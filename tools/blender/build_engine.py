"""Builds authored V2500 components in Blender and exports app/models/v2500.glb.

Run:  pip install bpy && python3 tools/blender/build_engine.py

Frame: metres. Engine axis = +X (flow direction), fan face at x = 0. Blender is Z-up, so
engine (x, y_up, z_side) is modelled as Blender (x, -z_side, y_up); the glTF exporter converts
to the simulator's Y-up frame.

Naming: <component>_<piece>[__cut]. The loader shows nodes ending __cut when the cutaway is on
and the others when it is off. Material names (paint, bare, section, ...) are swapped for the
simulator's own materials on load.
"""
import bpy, bmesh, math, os, json

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'app', 'models')
CUT_A, CUT_B = math.radians(-8), math.radians(112)  # must match scene3d.js

# section profiles [x, r] - keep in step with app/cutaway.js
# Nacelle from the Airbus A320 Aircraft Characteristics (AC), figure 2-12-0-991-032 (IAE V2500): 5.25 m long;
# width W, height above the engine centreline U and below it V at the inlet attach flange (x 0), thrust
# reverser torque box (1.18), combustion chamber entry and exit flanges (1.85, 2.22), turbine exhaust case
# flange (3.19) and nozzle exit (4.30). Not round: deeper underneath for the gearbox (V - U = 0.11 m).
# 'nacelle' is the side profile (W / 2); nacelleTop (U) and nacelleBot (V) shape it by angle (egg_deform).
P = {
    'inletInner': [[-0.955, 0.75], [-0.92, 0.722], [-0.86, 0.706], [-0.78, 0.705], [-0.5, 0.735], [-0.2, 0.785], [0, 0.81]],   # 1.50 m highlight (AC fig.)
    'nacelle':    [[-0.955, 0.75], [-0.93, 0.84], [-0.88, 0.9], [-0.835, 0.93], [-0.6, 0.975], [-0.3, 0.998], [0, 1.005], [1.18, 1.005], [1.85, 0.99], [2.22, 0.965], [3.19, 0.82], [4.3, 0.62]],
    'nacelleTop': [[-0.955, 0.75], [-0.93, 0.84], [-0.88, 0.9], [-0.835, 0.93], [-0.6, 0.975], [-0.3, 0.995], [0, 0.99], [1.18, 1.0], [1.85, 0.97], [2.22, 0.93], [3.19, 0.78], [4.3, 0.6]],
    'nacelleBot': [[-0.955, 0.75], [-0.93, 0.84], [-0.88, 0.9], [-0.835, 0.93], [-0.6, 0.99], [-0.3, 1.05], [0, 1.1], [1.18, 1.11], [1.85, 1.07], [2.22, 1.03], [3.19, 0.86], [4.3, 0.64]],
    'bypOuter': [[0, 0.81], [0.35, 0.81], [1.2, 0.8], [2.4, 0.74], [3.2, 0.66], [3.6, 0.63], [4.3, 0.595]],
    'bypInner': [[0.4, 0.47], [0.7, 0.54], [1.3, 0.56], [2.4, 0.54], [3.0, 0.52], [3.12, 0.46]],
    'coreOuter': [[0.4, 0.47], [0.85, 0.44], [1.15, 0.3], [1.85, 0.25], [1.92, 0.33], [2.18, 0.33], [2.22, 0.3], [2.42, 0.33], [3.0, 0.48], [3.12, 0.44]],
}

def r_at(prof, x):
    if x <= prof[0][0]: return prof[0][1]
    for i in range(1, len(prof)):
        if x <= prof[i][0]:
            (x0, r0), (x1, r1) = prof[i - 1], prof[i]
            return r0 + (r1 - r0) * (x - x0) / (x1 - x0)
    return prof[-1][1]

def smooth_nacelle(x, key='nacelle'):
    """Outer mould line (side profile unless key says top or bottom), rounded so highlights run cleanly."""
    pts = P[key]; d = 0.12 * min(1.0, max(0.3, (x + 0.95) / 0.35))   # less rounding at the lip, so the cowl meets it flush
    return (r_at(pts, x - d) + 2 * r_at(pts, x) + r_at(pts, x + d)) / 4

def oml(x, th_deg):
    """Outer mould line at angle th (0 = top): side profile, pulled in on top, pushed out underneath (egg section)."""
    c = math.cos(math.radians(th_deg)); side = smooth_nacelle(x)
    return side + (smooth_nacelle(x, 'nacelleTop') - side) * max(0.0, c) ** 2 + (smooth_nacelle(x, 'nacelleBot') - side) * max(0.0, -c) ** 2

SCARF_DEG = 6.0   # inlet face tilted 6 deg, top lip forward (AC fig. 2-12-0-991-032)

def lip_loop(xj=-0.835, xh=-0.955, rh=0.75, r_out=0.93, r_in=0.705, t=0.022, n=16):
    """Inlet lip (anti-iced D-duct skin): from the throat over the highlight to the outer cowl, as a shell."""
    ax = xj - xh; ph = [math.pi / 2 * i / n for i in range(n + 1)]
    outer = [(xj - ax * math.cos(p), rh + (r_out - rh) * math.sin(p)) for p in ph]
    inner = [(xj - ax * math.cos(p), rh - (rh - r_in) * math.sin(p)) for p in ph]
    surf = list(reversed(inner)) + outer[1:]
    c = (xj, rh)
    def shrink(q):
        dx, dr = q[0] - c[0], q[1] - c[1]; d = math.hypot(dx, dr) or 1.0; k = max(0.1, (d - t) / d)
        return (c[0] + dx * k, c[1] + dr * k)
    return [list(q) for q in surf] + [list(shrink(q)) for q in reversed(surf)]

def scarf_deform(obj):
    """Tilt the inlet face: shear the inlet forward on top and back underneath, blending from the full 6 deg at
    the lip to nothing at the inlet attach flange (x 0), and droop it 35 mm at the lip."""
    from mathutils import Vector
    mw = obj.matrix_world; inv = mw.inverted(); k = math.tan(math.radians(SCARF_DEG))
    for v in obj.data.vertices:
        p = mw @ v.co
        if p.x >= 0: continue
        u = min(1.0, -p.x / 0.955); f = u * u * (3 - 2 * u)
        v.co = inv @ Vector((p.x - p.z * k * f, p.y, p.z - 0.035 * f))

def egg_deform(obj):
    """Reshape a nacelle part built round on the side profile into the egg section. The outer skin moves fully,
    the inner flow surface stays, solids in between stretch."""
    from mathutils import Vector
    mw = obj.matrix_world; inv = mw.inverted()
    for v in obj.data.vertices:
        p = mw @ v.co; x = p.x; r = math.hypot(p.y, p.z)
        if r < 1e-6: continue
        th = math.degrees(math.atan2(-p.y, p.z)) % 360
        r_in = (r_at(P['inletInner'], x) if x < 0 else r_at(P['bypOuter'], x)) + 0.013
        side = smooth_nacelle(x); w = max(0.0, min(1.0, (r - r_in) / max(0.01, side - 0.03 - r_in)))
        k = (r + (oml(x, th) - side) * w) / r
        v.co = inv @ Vector((p.x, p.y * k, p.z * k))

def sample(fn, x0, x1, n):
    return [[x0 + (x1 - x0) * i / n, fn(x0 + (x1 - x0) * i / n)] for i in range(n + 1)]

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def material(name, color, metallic=0.0, rough=0.5, coat=0.0):
    """Colours are given as they should look on screen (sRGB) and stored linear, as glTF and Blender expect.
    (Storing the sRGB numbers directly made every authored part one gamma step too light: near-white.)"""
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*(srgb_to_linear(c) for c in color), 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value = coat
    return m

def cyl_uv(bm):
    """UVs for bodies of revolution: u = angle round the engine (0-1), v = position along its length (0-1)."""
    uv = bm.loops.layers.uv.verify()
    xs = [v.co.x for v in bm.verts]; x0, x1 = min(xs), max(xs)
    for f in bm.faces:
        us = [(math.atan2(-l.vert.co.y, l.vert.co.z) / (2 * math.pi)) % 1.0 for l in f.loops]
        if max(us) - min(us) > 0.5: us = [u + 1 if u < 0.5 else u for u in us]   # face straddles the seam
        for l, u in zip(f.loops, us): l[uv].uv = (u, (l.vert.co.x - x0) / (x1 - x0 + 1e-9))

def link(obj):
    bpy.context.scene.collection.objects.link(obj); return obj

def revolve(name, loop, mat, steps=144):
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, max(r, 0.0))) for x, r in loop]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cyl_uv(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def prism(name, yz, x0, x1, mat):
    """Extrude a polygon given in engine (y_up, z_side) along x."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, -z, y)) for y, z in yz]; b = [bm.verts.new((x1, -z, y)) for y, z in yz]
    n = len(yz); bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for i in range(n): bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def boolean(obj, cutter, op='DIFFERENCE'):
    if 'section' not in [m.name for m in obj.data.materials] and cutter.data.materials and cutter.data.materials[0].name == 'section':
        obj.data.materials.append(cutter.data.materials[0])
    m = obj.modifiers.new('bool', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    if hasattr(m, 'material_mode'): m.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)

def finish(obj, bevel=0.0025):
    if bevel:
        m = obj.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(38)
    m = obj.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.keep_sharp = True
    return obj

def th_pos(x, th_deg, r):
    """Engine cylindrical (x, angle, radius) -> Blender xyz. Angle as in scene3d.js: y_up = r cos, z_side = r sin."""
    t = math.radians(th_deg); return (x, -r * math.sin(t), r * math.cos(t))

def arc_solid(name, loop, th0, th1, mat, steps=48):
    """Revolve a closed [x, r] loop through part of a turn, with capped ends."""
    bm = bmesh.new()
    t0 = math.radians(th0)
    vs = [bm.verts.new((x, -r * math.sin(t0), r * math.cos(t0))) for x, r in loop]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    # instance angle increases with rotation about +X in Blender's frame
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.radians(th1 - th0), steps=steps, use_duplicate=False)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=len(loop) + 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cyl_uv(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def cylinder(name, a, b, r0, r1, mat, seg=24, dome=0.0):
    """Cylinder (or cone) between two Blender points, optionally with a domed far end."""
    from mathutils import Vector, Matrix
    a, b = Vector(a), Vector(b); d = b - a; L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=L)
    if dome:
        top = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=10, radius=r1)
        bmesh.ops.scale(bm, vec=(1, 1, dome / r1), verts=top['verts']); bmesh.ops.translate(bm, vec=(0, 0, L / 2), verts=top['verts'])
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def box(name, centre, size, th_deg, mat):
    """Box with its local up along the radial direction at angle th."""
    from mathutils import Matrix
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)  # (axial, tangential, radial)
    # th_pos puts angle th at (x, -r sin th, r cos th); a rotation of +th about X turns local up (+Z) onto that
    # radial direction (a rotation of -th mirrored every box away from the top and bottom centreline)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Rotation(math.radians(th_deg), 4, 'X'), verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def tube(name, pts_cyl, radius, mat):
    """Pipe through engine cylindrical points [(x, th_deg, r), ...]."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = 3; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts_cyl) - 1)
    for p, c in zip(sp.points, pts_cyl): p.co = (*th_pos(*c), 1)
    sp.use_endpoint_u = True; sp.order_u = 3
    obj = link(bpy.data.objects.new(name, cu)); cu.materials.append(mat)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.convert(target='MESH'); obj.select_set(False)
    for p in obj.data.polygons: p.use_smooth = True
    return obj

def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); objs[0].name = name; objs[0].data.name = name; objs[0].select_set(False)
    return objs[0]

def stack(name, x0, th, r, segs, mat, direction=1, seg=28):
    """Stepped body of revolution along the engine axis: segs = [(length, radius0, radius1), ...]."""
    parts = []; x = x0
    for L, ra, rb in segs:
        x1 = x + direction * L
        parts.append(cylinder(name, th_pos(x, th, r), th_pos(x1, th, r), ra, rb, mat, seg=seg)); x = x1
    return join(name, parts) if len(parts) > 1 else parts[0]

def patch(name, x0, x1, th0, th1, mat, surf, lift=0.0018, nx=8, nt=10):
    """Thin decal lying on a surface of revolution r = surf(x)."""
    bm = bmesh.new(); grid = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        grid.append([bm.verts.new(th_pos(x, th0 + (th1 - th0) * j / nt, surf(x) + lift)) for j in range(nt + 1)])
    uv = bm.loops.layers.uv.verify(); where = {}
    for i in range(nx + 1):
        for j in range(nt + 1): where[grid[i][j]] = (i / nx, 1 - j / nt)
    for i in range(nx):
        for j in range(nt): bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        for l in f.loops: l[uv].uv = where[l.vert]
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def outline(name, x0, x1, th0, th1, mat, surf, w=0.004):
    """Panel line round a rectangular door."""
    dth = math.degrees(w / surf((x0 + x1) / 2))
    return [patch(name, x0, x1, th0, th0 + dth, mat, surf, nt=1), patch(name, x0, x1, th1 - dth, th1, mat, surf, nt=1),
            patch(name, x0, x0 + w, th0, th1, mat, surf, nx=1), patch(name, x1 - w, x1, th0, th1, mat, surf, nx=1)]

def loft(name, stations, mat, n=16):
    """Skin through rounded-rectangle sections: stations = [(x, half_width, y_bottom, y_top), ...] in engine y-up."""
    bm = bmesh.new(); rings = []
    for x, hw, y0, y1 in stations:
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n; c, s_ = math.cos(a), math.sin(a)
            e = 0.45  # superellipse exponent: rounded box
            zz = hw * (abs(c) ** e) * (1 if c >= 0 else -1); yy = (y0 + y1) / 2 + (y1 - y0) / 2 * (abs(s_) ** e) * (1 if s_ >= 0 else -1)
            ring.append(bm.verts.new((x, -zz, yy)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(n): bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cyl_uv(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

def mean_th(obj):
    """Instance angle (deg) of an object's mean vertex position. Engine left (+z) is Blender -Y."""
    mw = obj.matrix_world; vs = obj.data.vertices; n = max(len(vs), 1)
    y = sum((mw @ v.co).y for v in vs) / n; z = sum((mw @ v.co).z for v in vs) / n
    return math.degrees(math.atan2(-y, z)) % 360

def join_sides(name, objs, made, bevel=None):
    """Join objects into <name>_L / <name>_R by which cowl half they sit on. Pieces of the left half
    inside the cutaway sector become <name>B_L__full, shown only with the cutaway closed."""
    groups = {}
    for o in objs:
        th = mean_th(o); side = 'L' if 0 < th < 180 else 'R'
        groups.setdefault((side, in_cut(th)), []).append(o)
    for (side, cut), lst in sorted(groups.items()):
        nm = name + ('B' if cut else '') + '_' + side + ('__full' if cut else '')
        o = join(nm, lst); made.append(finish(o, bevel) if bevel is not None else o)

def zone_mats(obj, outer_fn, inner_fn, primer_m, acoustic_m=None):
    """Faces on the outer skin keep the paint; faces on the duct side get the acoustic panel material;
    everything in between (inner faces of a cowl, bulkheads, door edges) gets green zinc-chromate primer."""
    me = obj.data
    def idx(m):
        names = [mm.name for mm in me.materials]
        if m.name not in names: me.materials.append(m); names.append(m.name)
        return names.index(m.name)
    ip = idx(primer_m); ia = idx(acoustic_m) if acoustic_m else None
    for p in me.polygons:
        c = obj.matrix_world @ p.center; r = math.hypot(c.y, c.z); x = c.x
        if r > outer_fn(x) - 0.004: continue
        if inner_fn and r < inner_fn(x) + 0.004:
            if ia is not None: p.material_index = ia
            continue
        p.material_index = ip

def in_cut(th_deg):
    t = math.radians(th_deg % 360); return t > 2 * math.pi + CUT_A or t < CUT_B

def duplicate(obj, name):
    d = obj.copy(); d.data = obj.data.copy(); d.name = name; d.data.name = name; return link(d)

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paint = material('paint', (0.86, 0.87, 0.88), 0.0, 0.4, 1.0)
    bare = material('bare', (0.62, 0.64, 0.66), 1.0, 0.32)
    lipm = material('lip', (0.74, 0.76, 0.78), 1.0, 0.28)
    section = material('section', (0.5, 0.11, 0.07), 0.1, 0.7)
    primer = material('primer', (0.2, 0.33, 0.06), 0.0, 0.6)       # zinc-chromate green inside the cowls (photos in the Airbus TTM)
    acoustic = material('acoustic', (0.34, 0.35, 0.36), 0.1, 0.72) # acoustic sandwich panels lining the bypass duct: grey composite, perforated
    R = 3.0
    wedge = prism('wedge', [(0, 0)] + [(R * math.cos(a), R * math.sin(a)) for a in [CUT_A + (CUT_B - CUT_A) * i / 12 for i in range(13)]], -2, 6, section)
    # longitudinal split along the bottom centreline (cowl door latch line)
    latch = prism('latch', [(-0.5, -0.003), (-0.5, 0.003), (-1.3, 0.003), (-1.3, -0.003)], 0.01, 2.85, paint)

    skin_in = lambda x: (r_at(P['inletInner'], x) if x < 0 else r_at(P['bypOuter'], x)) + 0.013
    made = []
    def cowl(name, x0, x1, mat, n, inset=0.0, split=False, zones=None):
        loop = sample(lambda x: smooth_nacelle(x) - inset, x0, x1, n) + list(reversed(sample(skin_in, x0, x1, n)))
        o = revolve(name, loop, mat)
        if zones: zones(o)
        if split: boolean(o, latch)
        c = duplicate(o, name + '__cut'); boolean(c, wedge)
        made.extend([finish(o), finish(c)])

    G = 0.004  # half panel gap
    cowl('inlet_cowl', -0.836, -G, paint, 16, zones=lambda o: zone_mats(o, smooth_nacelle, skin_in, primer))
    # Fan cowl doors: a thin skin. The bare fan case and its accessories sit in the gap underneath.
    # Cowls that open (fan cowl doors, thrust reverser C-ducts) are built as left and right halves, each
    # running from a hinge beside the pylon to the latch line at the bottom. Only the left half meets the
    # cutaway sector, so only it has a __cut variant.
    GAP_TOP = 7.0
    def halves(name, loop, mat, zones=None, steps=72):
        for side, a0, a1 in (('L', GAP_TOP, 179.75), ('R', 180.25, 360 - GAP_TOP)):
            o = arc_solid(name + '_' + side, loop, a0, a1, mat, steps=steps)
            if zones: zones(o)
            if side == 'L':
                c = duplicate(o, name + '_L__cut'); boolean(c, wedge); made.extend([finish(o), finish(c)])
            else: made.append(finish(o))
    def skin(name, x0, x1, thick, n):
        loop = sample(smooth_nacelle, x0, x1, n) + list(reversed(sample(lambda x: smooth_nacelle(x) - thick, x0, x1, n)))
        halves(name, loop, paint, zones=lambda o: zone_mats(o, smooth_nacelle, None, primer))
    skin('fancowl_doors', G, 1.2 - G, 0.022, 16)

    # ---- bare fan case (reference: MTU and manufacturer photos, museum model)
    cast = material('cast', (0.5, 0.56, 0.62), 0.05, 0.55)     # fan case painted blue-grey (bare castings get their own grey in the app)
    loom = material('loom', (0.78, 0.76, 0.7), 0.0, 0.9)       # harnesses are sleeved in white braid, dulled by service
    comp = material('composite', (0.07, 0.12, 0.08), 0.1, 0.6) # graphite composite cascades
    steel = material('steel', (0.7, 0.71, 0.72), 1.0, 0.36)
    dark = material('dark', (0.05, 0.055, 0.06), 0.2, 0.55)
    gold = material('gold', (0.7, 0.58, 0.33), 0.85, 0.42)     # chromate-conversion-coated accessory units (olive gold)
    fc_in = lambda x: r_at(P['bypOuter'], x) + 0.0135
    case_loop = sample(lambda x: fc_in(x) + 0.02, -0.02, 1.19, 16) + list(reversed(sample(fc_in, -0.02, 1.19, 16)))
    case = revolve('fancase_casing', case_loop, cast)
    ribs = []
    for xr, hgt in [(-0.012, 0.045), (0.09, 0.03), (0.2, 0.03), (0.31, 0.03), (0.42, 0.045), (0.62, 0.03), (0.8, 0.045), (1.0, 0.03), (1.18, 0.05)]:
        r0 = fc_in(xr) + 0.018
        ribs.append(revolve('rib', [[xr - 0.006, r0], [xr - 0.006, r0 + hgt], [xr + 0.006, r0 + hgt], [xr + 0.006, r0]], cast, steps=96))
    # cut each piece on its own (a boolean on overlapping joined shells is unreliable), then join
    cuts = []
    for i, piece in enumerate([case] + ribs):
        c = duplicate(piece, f'cutpiece{i}'); boolean(c, wedge); cuts.append(c)
    case = join('fancase_casing', [case] + ribs); ccut = join('fancase_casing__cut', cuts)
    made.extend([finish(case, 0.0015), finish(ccut, 0.0015)])

    R_CASE = 0.87  # outer surface of the fan case
    # (the oil tank is its own component: accessories.py)
    # harness bundles and small pipes along the case

    # ---- accessory gearbox: a flat casting wrapped under the fan case, accessories fore and aft
    # The accessories on its faces are components of their own (accessories.py); the lay shaft, angle gearbox
    # and hand-cranking pad are part of the gearbox.
    import sys; sys.path.insert(0, os.path.dirname(__file__))
    from types import SimpleNamespace
    import accessories
    H = SimpleNamespace(link=link, join=join, finish=finish, th_pos=th_pos, material=material, arc_solid=arc_solid)
    acc = accessories.gearbox_extras(H, accessories.materials(H))
    GBX = accessories.GEARBOX; gt0, gt1 = GBX['th0'], GBX['th1']; rt = GBX['r_out']
    gb = arc_solid('gb', [[0.36, 0.875], [0.36, rt - 0.022], [0.42, rt], [0.7, rt], [0.78, rt - 0.027], [0.78, 0.875]], gt0, gt1, cast)
    # stiffening ribs, the split-line flange (front and rear halves bolt together at mid-depth) and mounting pads
    skin = []
    for th0 in (156, 166, 176, 186, 196, 206):
        skin.append(arc_solid('rib', [[0.42, rt - 0.001], [0.42, rt + 0.011], [0.7, rt + 0.011], [0.7, rt - 0.001]], th0, th0 + 1.2, cast, steps=2))
    skin.append(arc_solid('split', [[0.565, rt - 0.002], [0.565, rt + 0.008], [0.575, rt + 0.008], [0.575, rt - 0.002]], gt0 + 0.5, gt1 - 0.5, cast))
    for k in range(22):
        thb = gt0 + 2.5 + (gt1 - gt0 - 5) * k / 21
        skin.append(cylinder('sb', th_pos(0.575, thb, rt + 0.003), th_pos(0.583, thb, rt + 0.003), 0.0045, 0.0045, steel, seg=6))
    # the casting as the cutaway shows it: hollow, split web inside, outer skin opened over the gear train
    import drivetrain as DT
    gbc = DT.casing_cut(arc_solid, cast, section, rt)
    acc += [
        # de-oiler and its breather out through the cowl, drain to the mast
        cylinder('deoiler', th_pos(0.57, gt1 + 1, 0.975), th_pos(0.57, gt1 + 7, 0.975), 0.055, 0.05, cast, seg=20),
        tube('breather', [(0.6, gt1 + 7, 0.975), (0.8, gt1 + 5, 1.0), (0.98, gt1 + 2.5, oml(0.98, gt1 + 2.5) - 0.045), (1.03, gt1, oml(1.03, gt1) - 0.016)], 0.011, steel),   # ends at the cowl outlet
        tube('drain', [(0.6, 186, rt), (0.7, 186, rt + 0.007), (0.9, 186, rt + 0.007), (0.95, 186, oml(0.95, 186) - 0.012)], 0.006, steel),   # (between the casting and the cowl skin)   # beside the angle gearbox, out through the cowl
    ]
    # oil supply and return between the gearbox and the tank's lower-end ports
    tp = [accessories.at('oiltank', q) for q in accessories.TANK_PORTS]
    for (x, th, r), x0, m in zip(tp, (0.45, 0.62), (steel, gold)):
        acc.append(tube('oil', [(x0, gt0 + 10, rt + 0.004), (x0 + (x - x0) * 0.5, gt0 + 4, rt), (x, th + 1.4, r + 0.012), (x, th + 0.3, r)], 0.009, m))
    for th in (gt0 + 2, gt1 - 2):   # mount links from the gearbox sides to the fan case
        acc.append(cylinder('gblink', th_pos(0.57, th, 0.88), th_pos(0.57, th + (-4 if th < 180 else 4), 0.97), 0.014, 0.014, steel, seg=10))
        acc.append(box('gblug', th_pos(0.57, th, 0.885), (0.06, 0.05, 0.03), th, cast))
    for x, th in [(0.48, 160), (0.48, 172), (0.48, 190), (0.48, 200), (0.66, 162), (0.66, 176), (0.66, 190), (0.66, 202)]:
        skin.append(cylinder('pad', th_pos(x, th, rt - 0.002), th_pos(x, th, rt + 0.012), 0.022, 0.022, cast, seg=12))
    made.append(finish(join('agb_gearbox__full', [gb] + skin), 0.003))
    gbc.name = gbc.data.name = 'agb_gearbox__cut'; made.append(finish(gbc, 0.0))
    made.append(finish(join('agb_gearboxx', acc), 0.003))
    accessories.build_accessories(H, made)
    import core_units
    CORE_UNITS = core_units.build_core_units(H, made, P, r_at) + core_units.build_mounts(H, made, P, r_at, in_cut)
    # ---- EEC: flat finned box on the upper side of the fan case, on four feet, with its connectors and looms
    eec = [box('eec', th_pos(0.5, 305, 0.895), (0.42, 0.3, 0.05), 305, gold), box('eeccover', th_pos(0.5, 305, 0.93), (0.4, 0.28, 0.025), 305, dark)]
    eec += [box('fin', th_pos(0.31 + 0.038 * k, 305, 0.947), (0.012, 0.28, 0.012), 305, dark) for k in range(11)]
    eec += [box('foot', th_pos(x, 305 + dth, 0.87), (0.05, 0.04, 0.03), 305 + dth, steel) for x in (0.33, 0.67) for dth in (-7.5, 7.5)]
    eec += [cylinder('conn', th_pos(0.72, 298 + 3.4 * k, 0.905), th_pos(0.76, 298 + 3.4 * k, 0.905), 0.016, 0.016, steel, seg=12) for k in range(5)]
    made.append(finish(join('eec_box', eec), 0.003))

    # ---- fan case dressing all the way round. Items inside the cutaway sector are only shown with the cutaway closed.
    full, kept = [], []
    def put(th, obj):
        (full if in_cut(th) else kept).append(obj); return obj
    # flange bolts front and rear
    for xr, n in ((-0.012, 72), (0.42, 60), (0.8, 60), (1.18, 72)):
        rb = fc_in(xr) + 0.018 + 0.028
        for k in range(n):
            th = 360.0 * k / n + 1.3
            put(th, cylinder('b', th_pos(xr - 0.011, th, rb), th_pos(xr + 0.011, th, rb), 0.0055, 0.0055, steel, seg=6))
    # anti-ice duct: bleed air forward to the inlet lip, with its valve
    put(332, stack('aiv', 0.62, 332.5, 0.94, [(0.012, 0.036, 0.036), (0.09, 0.032, 0.032), (0.012, 0.036, 0.036)], cast))   # anti-ice valve, in line with its duct
    put(328, box('aiact', th_pos(0.665, 327.6, 0.932), (0.07, 0.06, 0.05), 327.6, dark))   # its actuator beside it, under the cowl skin
    # ignition exciters, relay box, air-cooled oil cooler and the engine data plate
    # right side, below the EEC: relay box, then the bank of bleed-valve solenoids (four in a row and two below)
    for k in range(4): put(268, stack('sol', 0.55 + 0.085 * k, 270, 0.9, [(0.02, 0.022, 0.022), (0.035, 0.03, 0.03), (0.012, 0.018, 0.018)], gold))
    for k in range(2): put(258, stack('sol', 0.7 + 0.085 * k, 259, 0.9, [(0.02, 0.022, 0.022), (0.035, 0.03, 0.03), (0.012, 0.018, 0.018)], gold))
    # left side: fuel-cooled oil cooler (tall gold cylinder) with the low-pressure fuel filter at its foot and the diverter valve on its flank; IDG oil cooler beside it
    put(122, cylinder('fcoc', th_pos(1.02, 114, 0.965), th_pos(1.02, 132, 0.965), 0.06, 0.06, gold, seg=24, dome=0.03))
    put(135, cylinder('lpfilter', th_pos(0.95, 136, 0.97), th_pos(1.09, 136, 0.97), 0.07, 0.07, gold, seg=24))
    put(124, box('fdrv', th_pos(1.115, 124, 0.965), (0.07, 0.1, 0.08), 124, gold))
    for k in range(3): put(120, tube('fcl', [(1.1, 118 + 5 * k, 0.975), (1.15, 122 + 6 * k, 0.96), (1.19, 130 + 8 * k, 0.94)], 0.014, steel))
    put(100, box('idgfcoc', th_pos(0.98, 100, 0.925), (0.2, 0.09, 0.07), 100, gold))
    put(48, stack('oilpx', 0.6, 48, 0.905, [(0.07, 0.018, 0.018), (0.03, 0.024, 0.024)], steel)); put(54, box('lop', th_pos(0.66, 54, 0.905), (0.05, 0.05, 0.05), 54, gold))
    put(2, cylinder('vib', th_pos(0.3, 2, 0.89), th_pos(0.3, 2, 0.92), 0.025, 0.02, steel, seg=12))
    put(238, box('acoc', th_pos(0.9, 238, 0.93), (0.3, 0.24, 0.09), 238, cast)); put(238, box('acocmesh', th_pos(0.9, 238, 0.977), (0.2, 0.16, 0.004), 238, dark))
    for k in range(9): put(238, box('acocfin', th_pos(0.815 + 0.021 * k, 238, 0.982), (0.004, 0.15, 0.008), 238, gold))
    put(287, box('relay', th_pos(0.62, 287, 0.905), (0.18, 0.12, 0.05), 287, dark))
    for k in range(3): put(287, cylinder('rc', th_pos(0.56 + 0.06 * k, 283.5, 0.905), th_pos(0.56 + 0.06 * k, 281, 0.905), 0.014, 0.014, steel, seg=10))
    put(250, box('plate', th_pos(0.26, 250, 0.892), (0.12, 0.08, 0.004), 250, steel))
    # inside the cutaway sector: hydraulic and fuel lines up to the pylon, T2/P2 probe wiring, a second relay box
    put(40, box('box', th_pos(0.4, 40, 0.905), (0.16, 0.12, 0.05), 40, dark))
    put(74, box('box', th_pos(0.3, 74, 0.905), (0.14, 0.12, 0.06), 74, cast))
    put(60, stack('valve', 0.8, 60, 0.92, [(0.012, 0.04, 0.04), (0.1, 0.034, 0.034), (0.012, 0.04, 0.04)], steel))
    # Lower (6 o'clock) strut of the fan frame: a streamlined fairing across the bypass duct, behind the outlet
    # guide vanes, leading into the lower bifurcation (x 1.22). The tower shaft and the services to the core
    # (fuel, servo air, oil, harnesses) pass down inside it from the bulkhead panel on the fan case.
    def strut(name, x0, x1, th_c, r0, r1, t_max, mat, n=28):
        c = x1 - x0; bm = bmesh.new(); rings = []
        pts = []
        for i in range(n + 1):                                  # NACA 00xx thickness, round nose, sharp tail
            xc = 0.5 * (1 - math.cos(math.pi * i / n))
            yt = 5 * (t_max / c) * c * (0.2969 * math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
            pts.append((x0 + xc * c, yt))
        loop = pts + [(x, -y) for x, y in reversed(pts[1:-1])]
        for r in (r0, r1):
            rings.append([bm.verts.new(th_pos(x, th_c + math.degrees(sv / r), r)) for x, sv in loop])
        m = len(loop)
        for k in range(m): bm.faces.new((rings[0][k], rings[0][(k + 1) % m], rings[1][(k + 1) % m], rings[1][k]))
        bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        for f in me.polygons: f.use_smooth = True
        o = link(bpy.data.objects.new(name, me)); me.materials.append(mat); return o
    put(181, strut('strut6', 0.935, 1.235, 181.0, r_at(P['bypInner'], 1.1) - 0.01, r_at(P['bypOuter'], 1.1) + 0.012, 0.1, cast))
    # bulkhead (disconnect) panel beside the angle gearbox: fan-case lines end on top, core lines leave underneath
    put(175, box('panel', th_pos(1.1, 175.5, 0.892), (0.22, 0.09, 0.01), 175.5, cast))
    for xx in (1.0, 1.2):
        for dth in (-2.2, 2.2): put(175, box('pstand', th_pos(xx, 175.5 + dth, 0.872), (0.02, 0.012, 0.03), 175.5 + dth, steel))
    # (engine mounts: core_units.build_mounts)
    made.append(box('inlet_p2t2__full', th_pos(-0.2, 4, r_at(P['inletInner'], -0.2) - 0.035), (0.06, 0.012, 0.07), 4, steel))   # belongs to the intake cowl, inside the cutaway sector
    # fire detection loops round the gearbox (two elements side by side), per the booklet diagram
    for d in (0.0, 0.012):
        # (on top of the casting, just inside its faces, so it clears the accessory flanges and clamps)
        g0, g1, gr = accessories.GEARBOX['th0'], accessories.GEARBOX['th1'], accessories.GEARBOX['r_out']
        put(180, tube('fire', [(0.372 + d, g0 + 1, gr - 0.01), (0.372 + d, 180, gr - 0.008), (0.372 + d, g1 - 1, gr - 0.01), (0.57, g1 + 0.6, gr - 0.03), (0.768 - d, g1 - 1, gr - 0.02), (0.768 - d, 180, gr - 0.016), (0.768 - d, g0 + 1, gr - 0.02), (0.57, g0 - 0.6, gr - 0.03), (0.372 + d, g0 + 1, gr - 0.01)], 0.0035, gold))
    # hydraulic control unit for the reverser and the pylon disconnect panels at the top of the fan frame
    # (all of it stays under the cowl skin: only the lines that rise into the pylon leave it, between the hinge lines)
    put(358, box('hcu', th_pos(0.96, 358, 0.915), (0.16, 0.14, 0.07), 358, gold))
    for k in range(3): put(355, stack('hcus', 0.92 + 0.05 * k, 355, 0.955, [(0.012, 0.016, 0.016), (0.035, 0.02, 0.02)], steel))
    put(359, cylinder('hcuf', th_pos(1.06, 359, 0.93), th_pos(1.06, 359, 1.0), 0.026, 0.026, steel, seg=14))   # up into the pylon
    for th0 in (346, 12):
        put(th0, box('disc', th_pos(1.1, th0, 0.948), (0.012, 0.19, 0.07), th0, steel))
        for k in range(5): put(th0, cylinder('dc', th_pos(1.06, th0 - 6 + 3 * k, 0.95), th_pos(1.14, th0 - 6 + 3 * k, 0.95), 0.011, 0.011, gold, seg=10))
        for k in range(5): put(th0, tube('dh', [(1.06, th0 - 6 + 3 * k, 0.95), (0.98, th0 - 8 + 4 * k, 0.93), (0.9, th0 - 14 + 6 * k, 0.9), (0.7, th0 - 16 + 7 * k, 0.895)], 0.007, loom if k % 2 else steel))
    made.append(finish(join('fancase_dressing', kept), 0))
    made.append(finish(join('fancase_dressing2__full', full), 0))
    # ---- thrust reverser: fixed torque box, translating sleeve, cascades, blocker doors
    OML = smooth_nacelle; duct = lambda x: r_at(P['bypOuter'], x)
    def shell(name, loop, mat, split=True):
        o = revolve(name, loop, mat)
        if split: boolean(o, latch)
        c = duplicate(o, name + '__cut'); boolean(c, wedge); made.extend([finish(o), finish(c)])
    cduct_zones = lambda o: zone_mats(o, OML, duct, primer, acoustic)
    halves('cna_torquebox', sample(OML, 1.2 + G, 1.74, 8) + list(reversed(sample(duct, 1.2 + G, 1.74, 8))), paint, zones=cduct_zones)
    X0, XC, X1 = 1.74 + G, 2.24, 2.86 - G   # sleeve start, end of the cascade bay, sleeve end
    sleeve = (sample(OML, X0, X1, 16) + list(reversed(sample(duct, X0, X1, 16)))
              + sample(lambda x: duct(x) + 0.014, X0, XC, 6) + list(reversed(sample(lambda x: OML(x) - 0.02, X0, XC, 6))))
    halves('cna_sleeve', sleeve, paint, zones=cduct_zones)
    # cascades: turning-vane hoops and axial strongbacks in the bay the sleeve uncovers
    casL, casLc, casR = [], [], []
    for k in range(14):
        x = 1.772 + k * 0.0335; lo, hi = duct(x) + 0.03, OML(x) - 0.035
        # cambered turning vane: picks the air up off the duct wall and turns it out and forward
        sp = [i / 8 for i in range(9)]
        mid = [(x + 0.012 - 0.03 * s - 0.011 * math.sin(math.pi * s), lo + (hi - lo) * s) for s in sp]
        th_ = [0.0012 + 0.0022 * math.sin(math.pi * min(1, s * 1.15)) for s in sp]
        hoop = [[mx - t, mr] for (mx, mr), t in zip(mid, th_)] + [[mx + t, mr] for (mx, mr), t in reversed(list(zip(mid, th_)))]
        casL.append(arc_solid('h', hoop, GAP_TOP, 179.75, comp, steps=48)); casLc.append(arc_solid('h', hoop, 112, 179.75, comp, steps=32))
        casR.append(arc_solid('h', hoop, 180.25, 360 - GAP_TOP, comp, steps=48))
    for k in range(24):
        th = k * 15 + 7.5; rm = (duct(2.0) + OML(2.0)) / 2 - 0.002
        for lst in (([casL] if in_cut(th) else [casL, casLc]) if th < 180 else [casR]):
            lst.append(box('s', th_pos(1.99, th, rm), (0.46, 0.012, OML(2.0) - duct(2.0) - 0.07), th, comp))
    made.extend([join('cna_cascades_L', casL), join('cna_cascades_L__cut', casLc), join('cna_cascades_R', casR)])
    # ten blocker doors and their drag links (Airbus TTM 'Reverser design': 10 blocker doors, 10 rods; the linkage as
    # in the conventional reverser of patent US 6,764,045 figs. 1-2). Each door is hinged at its forward edge to the
    # translating sleeve and lies flush in the duct's outer wall when stowed. A rigid drag link runs across the fan duct
    # from a clevis on the inner fixed structure to a clevis near the door's free edge: as the sleeve slides aft the
    # link pulls the door down until it stands radial across the duct. The app solves the door angle from the link
    # (manifest 'reverser'), so the rod never stretches.
    from mathutils import Matrix, Vector
    ifs = lambda x: r_at(P['bypInner'], x)
    XH, LD, TD, FD, FZ, XA, ZA, TRAVEL = 1.80, 0.22, 0.029, 0.95, 0.02, 2.04, 0.03, 0.46
    r_in = lambda x: duct(x) - 0.0015                       # the door's duct face, flush with the sleeve's inner skin
    rh = r_in(XH) + TD / 2                                   # hinge axis, mid-thickness at the forward edge
    ph0 = math.pi / 10 * 0.95                                # half-angle at the hinge: 95 % of the 36 deg pitch
    ph1 = (math.pi * (ifs(XH + 0.46 + 0.03) + 0.021) / 10 * 0.95) / r_in(XH + LD)   # narrower at the free edge, so the doors close the annulus when radial
    fit_x = XH + FD * LD; fit_r = r_in(fit_x) - FZ           # drag-link eye on the door (stowed)
    A_r = ifs(XA) + ZA; LINK = math.hypot(fit_x - XA, fit_r - A_r)
    ac_m = acoustic; pr_m = primer; st_m = material('draglink', (0.56, 0.58, 0.6), 0.65, 0.46)   # titanium linkage, satin
    def loc(x, ph, r): return (x - XH, -r * math.sin(ph), r * math.cos(ph) - rh)      # door-local (origin on the hinge axis at the door's centre angle)
    def door_mesh(name):
        bm = bmesh.new(); NU, NV = 10, 14; grid = {}
        for side, rf in (('i', r_in), ('o', lambda x: r_in(x) + TD)):
            for a in range(NU + 1):
                for b in range(NV + 1):
                    u = LD * a / NU; x = XH + u; hp = ph0 + (ph1 - ph0) * u / LD; ph = -hp + 2 * hp * b / NV
                    grid[side, a, b] = bm.verts.new(loc(x, ph, rf(x)))
        fi = []
        for a in range(NU):
            for b in range(NV):
                fi.append(bm.faces.new((grid['i', a, b], grid['i', a, b + 1], grid['i', a + 1, b + 1], grid['i', a + 1, b])))
                bm.faces.new((grid['o', a, b], grid['o', a + 1, b], grid['o', a + 1, b + 1], grid['o', a, b + 1]))
        for a in range(NU):
            for b in (0, NV): bm.faces.new((grid['i', a, b], grid['i', a + 1, b], grid['o', a + 1, b], grid['o', a, b]))
        for b in range(NV):
            for a in (0, NU): bm.faces.new((grid['i', a, b], grid['o', a, b], grid['o', a, b + 1], grid['i', a, b + 1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces: f.material_index = 0 if f in fi else 1     # perforated acoustic face to the duct, primer elsewhere
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(ac_m); me.materials.append(pr_m)
        for q in me.polygons: q.use_smooth = True
        return link(bpy.data.objects.new(name, me))
    def lbox(name, c, size, mat):   # box in door-local coordinates (axial, tangential, radial)
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=size, verts=bm.verts); bmesh.ops.translate(bm, vec=c, verts=bm.verts)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat); return link(bpy.data.objects.new(name, me))
    def lcyl(name, a, b, r, mat, seg=14):
        a, b = Vector(a), Vector(b); d = b - a; bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4(), verts=bm.verts)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(mat)
        for q in me.polygons: q.use_smooth = True
        return link(bpy.data.objects.new(name, me))
    fl = Vector(loc(fit_x, 0.0, fit_r))                      # the door's link eye, door-local
    for k in range(10):
        th = k * 36 + 18; sd = 'L' if th < 180 else 'R'; tag = '__full' if in_cut(th) else ''
        nm = f'cna_blocker_{sd}_{k:02d}' + tag
        parts = [door_mesh('bd')]
        # back face: two longitudinal stiffeners and a cross rib (they face the cascades when stowed, the oncoming air when deployed)
        for v in (-0.5, 0.5):
            for a in range(6):
                u0, u1 = 0.02 + (LD - 0.04) * a / 6, 0.02 + (LD - 0.04) * (a + 1) / 6; um = (u0 + u1) / 2; x = XH + um
                hp = ph0 + (ph1 - ph0) * um / LD; rr = r_in(x) + TD
                c = loc(x, v * hp, rr + 0.008); parts.append(lbox('rb', (c[0], c[1], c[2]), (u1 - u0 + 0.002, 0.005, 0.016), pr_m))
        xc = XH + 0.62 * LD; hp = ph0 + (ph1 - ph0) * 0.62
        parts.append(lbox('cr', loc(xc, 0.0, r_in(xc) + TD + 0.006), (0.006, 2 * hp * r_in(xc) * 0.86, 0.012), pr_m))
        # hinge: two lugs at the forward edge on the sleeve's hinge pin
        for v in (-0.62, 0.62):
            c = loc(XH, v * ph0, rh); parts.append(lbox('hl', (c[0] + 0.004, c[1], c[2]), (0.03, 0.012, 0.03), st_m))
        parts.append(lcyl('hp', loc(XH, -0.7 * ph0, rh), loc(XH, 0.7 * ph0, rh), 0.0045, st_m))
        # drag-link clevis on the duct face near the free edge: base plate, two lugs either side of the eye, pin
        parts.append(lbox('cb', loc(fit_x, 0.0, r_in(fit_x) - 0.002), (0.05, 0.045, 0.004), st_m))
        for dv in (-0.0125, 0.0125):
            parts.append(lbox('cl', (fl.x, fl.y + dv, (fl.z + loc(fit_x, 0.0, r_in(fit_x))[2]) / 2), (0.032, 0.005, FZ + 0.012), st_m))
        parts.append(lcyl('cp', (fl.x, fl.y - 0.018, fl.z), (fl.x, fl.y + 0.018, fl.z), 0.0048, st_m, seg=10))
        door = join(nm, parts)
        door.matrix_world = Matrix.Translation(th_pos(XH, th, rh)) @ Matrix.Rotation(math.radians(th), 4, 'X')   # local +Z = radial at th, +Y tangential
        made.append(finish(door, 0.0012))
    # the drag links: faired rods with spherical rod-end eyes, along local +X from the IFS pivot to the door's eye
    def rod(name):
        bm = bmesh.new(); N = 16; rings = []; e = 0.019
        xs_ = [e + (LINK - 2 * e) * i / 10 for i in range(11)]
        for x in xs_:
            t = (x - e) / (LINK - 2 * e); taper = 0.82 + 0.18 * math.sin(math.pi * t)
            ch, th_ = 0.034 * taper, 0.013 * taper      # streamlined: chord along the air (local Z), thin across it (local Y)
            ring = []
            for j in range(N):
                a = 2 * math.pi * j / N; c_, s_ = math.cos(a), math.sin(a)
                zz = ch / 2 * c_ * (1 - 0.18 * max(0.0, -c_)) ; yy = th_ / 2 * s_ * (1.0 - 0.35 * max(0.0, -c_))   # fuller nose, finer tail
                ring.append(bm.verts.new((x, yy, zz)))
            rings.append(ring)
        for a_, b_ in zip(rings, rings[1:]):
            for j in range(N): bm.faces.new((a_[j], a_[(j + 1) % N], b_[(j + 1) % N], b_[j]))
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(st_m)
        for q in me.polygons: q.use_smooth = True
        o = link(bpy.data.objects.new(name, me)); out = [o]
        for xe in (0.0, LINK):                       # rod-end eyes: boss, spherical bearing, pin across the clevis, nut
            out.append(lcyl('eb', (xe, -0.0075, 0.0), (xe, 0.0075, 0.0), 0.0165, st_m, seg=18))
            out.append(lcyl('es', (xe, -0.0095, 0.0), (xe, 0.0095, 0.0), 0.0092, dark, seg=14))
            out.append(lcyl('ep', (xe, -0.019, 0.0), (xe, 0.019, 0.0), 0.0048, st_m, seg=10))
            out.append(lcyl('en', (xe, 0.016, 0.0), (xe, 0.021, 0.0), 0.0072, st_m, seg=6))
            out.append(lbox('ek', (xe + (0.012 if xe == 0.0 else -0.012), 0.0, 0.0), (0.014, 0.011, 0.02), st_m))   # neck into the fairing
        return join(name, out)
    fitK, fitF, fitR = [], [], []
    for k in range(10):
        th = k * 36 + 18; sd = 'L' if th < 180 else 'R'; tag = '__full' if in_cut(th) else ''
        lk = rod(f'cna_draglink_{sd}_{k:02d}' + tag)
        A = Vector(th_pos(XA, th, A_r)); Pt = Vector(th_pos(fit_x, th, fit_r)); d = (Pt - A).normalized()
        n = Vector((0.0, -math.cos(math.radians(th)), -math.sin(math.radians(th))))   # tangential (direction of increasing th), Blender frame
        n = (n - d * n.dot(d)).normalized(); y_ch = n.cross(d)                       # chord (local Z) in the link's plane, across the rod
        R3 = Matrix((d, -n, y_ch)).transposed()                                      # columns: local X = rod, local Y = -tangential, local Z = chord
        lk.matrix_world = Matrix.Translation(A) @ R3.to_4x4()
        made.append(lk)
        # the IFS clevis: base plate on the core cowl's skin and two lugs either side of the eye
        fx = [box('fb', th_pos(XA, th, ifs(XA) + 0.003), (0.06, 0.05, 0.006), th, st_m)]
        for dv in (-0.0125, 0.0125):
            a_ = th + math.degrees(dv / A_r); fx.append(box('fl', th_pos(XA, a_, (ifs(XA) + A_r) / 2 + 0.006), (0.034, 0.005, ZA + 0.014), a_, st_m))
        (fitR if sd == 'R' else fitF if tag else fitK).extend(fx)
    made.extend([finish(join('cna_dragfit_L', fitK), 0.001), finish(join('cna_dragfitB_L__full', fitF), 0.001), finish(join('cna_dragfit_R', fitR), 0.001)])
    REVERSER = {'travel': TRAVEL, 'hinge': [XH, round(rh, 5)], 'fit': [round(fit_x - XH, 5), round(fit_r - rh, 5)], 'pivot': [XA, round(A_r, 5)],
                'link': round(LINK, 5), 'doors': [k * 36 + 18 for k in range(10)]}
    cowl('cna_nozzle', 2.86 + G, 4.3, bare, 20, inset=0.008)
    lip = lip_loop()
    o = revolve('lip_ring', lip, lipm); c = duplicate(o, 'lip_ring__cut'); boolean(c, wedge); made.extend([finish(o, 0), finish(c, 0)])

    # strake high on the cowl side (kept side of the cutaway)
    th = math.radians(62)   # the strake is on the left-hand door (TTM figure); that is inside the cutaway sector
    def at(x, dr): r = smooth_nacelle(x) - 0.012 + dr; return (x, -r * math.sin(th), r * math.cos(th))
    bm = bmesh.new(); t = 0.009
    strake_pts = [(0.3, -0.02), (0.92, -0.02), (0.9, 0.115), (0.55, 0.045)]
    for side in (-1, 1):
        vs = [bm.verts.new(tuple(c + side * t * n for c, n in zip(at(x, dr), (0, math.cos(th), math.sin(th))))) for x, dr in strake_pts]
        bm.faces.new(vs if side > 0 else list(reversed(vs)))
    bm.verts.ensure_lookup_table()
    for i in range(4): bm.faces.new((bm.verts[i], bm.verts[(i + 1) % 4], bm.verts[4 + (i + 1) % 4], bm.verts[4 + i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('fancowl_strakeB_L__full'); bm.to_mesh(me); bm.free(); me.materials.append(paint)
    made.append(finish(link(bpy.data.objects.new('fancowl_strakeB_L__full', me)), 0.002))

    # ---- pylon and the slice of wing above the engine, as smooth aerodynamic surfaces (tools/blender/airframe.py)
    import airframe
    # (photos: the fairings are bare aluminium, the pylon box sides a mid grey, the heat shield dull titanium)
    AM = {'paint': paint, 'fair': material('pylonfair', (0.72, 0.73, 0.75), 0.75, 0.46), 'side': material('pylonside', (0.4, 0.41, 0.43), 0.3, 0.5),
          'bare': material('heatshield', (0.5, 0.49, 0.47), 0.85, 0.42), 'louvre': material('louvre', (0.03, 0.03, 0.035), 0.2, 0.7),
          'line': material('panelline2', (0.12, 0.13, 0.14), 0.0, 0.6), 'fastener': material('fastener', (0.62, 0.63, 0.64), 0.9, 0.35)}
    for o in airframe.build_pylon(link, AM, oml) + airframe.build_wing(link, AM): made.append(finish(o, 0))
    # ---- cowl door hinges along the top, each side of the pylon; reverser actuators in the cascade bay
    hk, hf = [], []
    for x in (0.15, 0.45, 0.75, 1.05):
        for th in (351, 9): (hf if in_cut(th) else hk).append(finish(loft('h', [(x - 0.07, 0.004, OML(x) - 0.004, OML(x) + 0.004), (x - 0.03, 0.02, OML(x) - 0.004, OML(x) + 0.016), (x + 0.03, 0.02, OML(x) - 0.004, OML(x) + 0.016), (x + 0.07, 0.004, OML(x) - 0.004, OML(x) + 0.004)], paint, n=12), 0))
    from mathutils import Matrix as _M
    for lst, th in ((hk, 351), (hf, 9)):
        for o in lst: o.matrix_world = _M.Rotation(-math.radians(th), 4, 'X') @ o.matrix_world
    made.append(join('fancowl_hinges_R', hk)); made.append(join('fancowl_hingesB_L__full', hf))
    acts = []
    for th in (40, 140, 220, 320):
        rm = (duct(1.9) + OML(1.9)) / 2
        a = [cylinder('act', th_pos(1.6, th, rm), th_pos(2.02, th, rm), 0.024, 0.024, steel, seg=14), cylinder('actrod', th_pos(2.02, th, rm), th_pos(2.2, th, rm), 0.011, 0.011, steel, seg=10),
             box('actlug', th_pos(1.6, th, rm), (0.05, 0.06, 0.05), th, cast), tube('acthose', [(1.62, th + 2, rm + 0.02), (1.5, th + 5, rm + 0.02), (1.3, th + 8, rm + 0.01)], 0.007, dark)]
        acts.append(join('act', a))
    join_sides('cna_actuators', acts, made)

    # ---- markings, panel lines and hardware (from the on-wing photos)
    line = material('panelline', (0.12, 0.13, 0.14), 0.0, 0.6)
    red = material('hazard', (0.72, 0.05, 0.05), 0.0, 0.5)
    placard = material('placard', (0.93, 0.93, 0.9), 0.0, 0.55)
    # A material named "txt:..." is replaced on load by a label with that text ("txt:R:" = white on red).
    label = lambda text: material('txt:' + text, (0.93, 0.93, 0.9), 0.0, 0.55)
    black = material('marking', (0.03, 0.03, 0.03), 0.0, 0.6)
    surf = OML
    marks = []
    marks += outline('m', 0.5, 0.82, 152, 168, line, surf)            # pressure-relief door
    marks += outline('m', 0.44, 0.6, 115, 126, line, surf)            # oil service door, over the tank filler
    marks += outline('m', 0.4, 0.6, 216, 229, line, surf)             # starter valve access (right-hand cowl)
    marks.append(patch('m', 0.13, 0.15, 128, 166, red, surf))         # hazard stripe: stay clear of the intake
    marks.append(patch('m', 0.19, 0.31, 130.5, 137.5, label('R:DANGER'), surf))
    marks.append(patch('m', 0.19, 0.45, 139, 146.5, label('STAND CLEAR OF HAZARD|AREAS WHILE ENGINE|IS RUNNING'), surf))
    marks.append(patch('m', 0.54, 0.78, 155.5, 158.5, label('PRESSURE RELIEF DOOR'), surf, lift=0.0026)); marks.append(patch('m', 0.455, 0.585, 119.4, 121.6, label('OIL SERVICE'), surf, lift=0.0026))
    marks.append(patch('m', 0.42, 0.58, 221.2, 223.8, label('STARTER VALVE ACCESS'), surf, lift=0.0026)); marks.append(patch('m', 0.3, 0.52, 100, 103.5, label('NO STEP'), surf))
    marks.append(patch('m', 0.66, 0.96, 228, 241, black, surf))        # air-cooled oil cooler outlet
    for k in range(7): marks.append(patch('m', 0.68 + 0.04 * k, 0.695 + 0.04 * k, 229, 240, line, surf, lift=0.003))   # louvre slats
    marks += outline('m', 0.6, 0.78, 250, 262, line, surf)             # EEC / relay access
    marks.append(patch('m', 0.64, 0.82, 116, 139, black, surf)); marks += outline('m', 0.63, 0.83, 115, 140, line, surf)   # ventilation outlet, low on the left door (photos)
    for k in range(5): marks.append(patch('m', 0.655 + 0.034 * k, 0.665 + 0.034 * k, 117, 138, line, surf, lift=0.003))     # its grille bars
    for x0 in (0.35, 0.75): marks.append(patch('m', x0, x0 + 0.16, 186, 192, black, surf))                      # two ventilation grilles at the bottom of the right-hand door
    marks.append(patch('m', 1.0, 1.06, 210, 214, black, surf))                                                  # gearbox breather outlet
    marks += outline('m', 0.21, 0.35, 155, 165, line, surf); marks.append(patch('m', 0.22, 0.34, 158.9, 160.9, label('MASTER CHIP DETECTOR'), surf, lift=0.0026))
    join_sides('fancowl_markings', marks, made)
    # nose cowl: anti-ice exhaust slot low on the right, interphone jack panel, hoist points near the top (booklet photo)
    im = [patch('m', -0.36, -0.2, 114, 124, black, surf)] + outline('m', -0.37, -0.19, 113, 125, line, surf) + [patch('m', -0.35 + 0.026 * k, -0.343 + 0.026 * k, 115, 123, line, surf, lift=0.003) for k in range(6)] + [ patch('m', -0.3, -0.24, 270, 273, placard, surf)] + outline('m', -0.33, -0.21, 268, 275, line, surf)
    for th in (332, 28): im += [patch('m', -0.42, -0.4, th - 0.6, th + 0.6, black, surf), patch('m', -0.39, -0.3, th - 1.2, th + 1.2, label('HOIST POINT'), surf)]
    im += outline('m', -0.5, -0.34, 150, 166, line, surf)                # anti-ice duct access
    im += outline('m', -0.34, -0.2, 352, 364, line, surf) + [patch('m', -0.3, -0.24, 340, 346, black, surf)]   # P2/T2 probe access door, ventilation intake scoop
    made.append(join('inlet_markings', [m for m in im]))
    rmarks = outline('m', 1.3, 1.6, 150, 162, line, surf) + [patch('m', 1.32, 1.58, 152.5, 155.5, label('THRUST REVERSER|ACTUATOR ACCESS'), surf, lift=0.0026), patch('m', 2.0, 2.3, 128, 133, label('R:REVERSER HAZARD AREA'), surf)]
    # thrust reverser pressure-relief doors on the bottom of each C-duct, either side of the latch line (Airbus TTM cowl-opening procedure)
    for a0, a1 in ((166, 176), (184, 194)):
        rmarks += outline('m', 2.25, 2.55, a0, a1, line, surf) + [patch('m', 2.28, 2.52, (a0 + a1) / 2 - 1.2, (a0 + a1) / 2 + 1.2, label('PRESSURE RELIEF DOOR'), surf, lift=0.0026)]
    join_sides('cna_markings', rmarks, made)
    # latches along the bottom centreline, and the drain mast
    lat = [box('latch', th_pos(x, 180, OML(x) + 0.001), (0.09, 0.032, 0.007), 180, bare) for x in (0.2, 0.6, 1.0)]
    join_sides('fancowl_latches', lat, made)
    join_sides('cna_latches', [box('latch', th_pos(x, 180, OML(x) + 0.001), (0.09, 0.032, 0.007), 180, bare) for x in (1.28, 1.6, 1.85, 2.1, 2.5, 2.62)], made)
    dm = smooth_nacelle(0.95) - 1.02   # the mast hangs from the cowl bottom
    made.append(finish(loft('fancowl_drainmast', [(0.84, 0.004, -1.06 - dm, -1.03 - dm), (0.9, 0.012, -1.16 - dm, -1.0 - dm), (0.98, 0.012, -1.17 - dm, -1.0 - dm), (1.06, 0.004, -1.12 - dm, -1.0 - dm)], bare, n=12), 0))

    for o in made:
        if o.type == 'MESH' and o.name.startswith(('inlet_cowl', 'inlet_markings', 'fancowl_', 'cna_', 'lip_')) and not o.name.startswith(('cna_blocker', 'cna_draglink', 'cna_dragfit')): egg_deform(o)   # (the reverser linkage sits on the round duct walls)
        if o.type == 'MESH' and o.name.startswith(('inlet_', 'lip_')): scarf_deform(o)

    # ---- routed dressing: tubes, harnesses, ducts and hoses (tools/blender/dressing.py)
    import sys; sys.path.insert(0, os.path.dirname(__file__))
    from dressing import build_dressing
    LINE_PARTS = build_dressing(P, r_at, in_cut, material, link, made, section)

    # ---- inside the fan cowl doors (seen with the cowls open): frames, edge beams, edge seals, latch keepers and two
    # stowed hold-open rods per door. Every piece is tested against the units under the cowl, in the egg-shaped space
    # they end up in, and pieces that would hit one are left out: the frames come out notched round the units.
    from mathutils import Vector as _V
    from mathutils.bvhtree import BVHTree
    UNIT = ('fancase_', 'line_', 'agb_', 'starter_', 'pma_', 'hydpump_', 'oilpump_', 'idg_', 'fuelpump_', 'fmu_', 'sav_', 'oiltank_', 'exciters_',
            'eec_', 'mounts_', 'accvalves_', 'acac_', 'egtbox_', 'vsvact_', 'fdv_', 'angb_', 'layshaft_')
    trees = []
    for o in made:
        if o.type != 'MESH' or not o.name.startswith(UNIT) or not o.data.polygons: continue
        mw = o.matrix_world; trees.append(BVHTree.FromPolygons([mw @ v.co for v in o.data.vertices], [tuple(q.vertices) for q in o.data.polygons]))
    d_in = lambda x: smooth_nacelle(x) - 0.022                     # inner face of the door skin (round, before the egg)
    def egg_r(x, th, r):                                            # where egg_deform moves a point at radius r
        side = smooth_nacelle(x); r_in = r_at(P['bypOuter'], x) + 0.013; w = max(0.0, min(1.0, (r - r_in) / max(0.01, side - 0.03 - r_in)))
        return r + (oml(x, th) - side) * w
    def clear(pts, d=0.006):
        for x, th, r in pts:
            q = _V(th_pos(x, th, egg_r(x, th, r)))
            if any(t.find_nearest(q, d)[0] is not None for t in trees): return False
        return True
    def runs(keys, ok):                                             # consecutive kept keys, as (first, last) pairs
        out, cur = [], None
        for k, good in zip(keys, ok):
            if good: cur = [k, k] if cur is None else [cur[0], k]
            elif cur: out.append(cur); cur = None
        if cur: out.append(cur)
        return out
    seal_m = material('seal', (0.85, 0.36, 0.13), 0.0, 0.6); red_m = material('hazard', (0.72, 0.05, 0.05), 0.0, 0.5)
    for side, a0, a1 in (('L', GAP_TOP + 1.0, 179.0), ('R', 181.0, 360 - GAP_TOP - 1.0)):
        parts = []
        steps = [a0 + (a1 - a0) * i / 86 for i in range(87)]
        # frames: hat stiffeners round the door, a little proud of its edges' seals
        for xf, dp in ((0.12, 0.016), (0.42, 0.018), (0.68, 0.018), (0.98, 0.016)):
            ri = d_in(xf)
            ok = [clear([(xf - 0.016, t + 1, ri - dp), (xf + 0.016, t + 1, ri - dp), (xf, t + 1, ri - dp * 0.5)]) for t in steps[:-1]]
            for t0, t1 in runs(steps[:-1], ok):
                t1 += (a1 - a0) / 86
                if t1 - t0 < 3: continue
                loop = [(xf - 0.017, ri + 0.002), (xf + 0.017, ri + 0.002), (xf + 0.006, ri - dp), (xf - 0.006, ri - dp)]
                parts.append(arc_solid('fr', loop, t0, t1, primer, steps=max(2, int(t1 - t0))))
        # edge seals fore and aft, a bulb strip on the inner face
        for xs in (0.012, 1.188):
            ri = d_in(xs); ok = [clear([(xs, t + 1, ri - 0.006)], 0.004) for t in steps[:-1]]
            for t0, t1 in runs(steps[:-1], ok):
                t1 += (a1 - a0) / 86
                if t1 - t0 >= 3: parts.append(arc_solid('sl', [(xs - 0.005, ri + 0.001), (xs + 0.005, ri + 0.001), (xs + 0.003, ri - 0.007), (xs - 0.003, ri - 0.007)], t0, t1, seal_m, steps=max(2, int(t1 - t0))))
        # edge beams along the hinge and latch edges (box sections), in clear lengths
        xs_ = [0.03 + 0.04 * i for i in range(29)]
        for th_e in ((a0 + 1.2, a1 - 1.2) if side == 'L' else (a0 + 1.2, a1 - 1.2)):
            ok = [clear([(x + 0.02, th_e, d_in(x) - 0.012), (x + 0.02, th_e, d_in(x) - 0.022)]) for x in xs_[:-1]]
            for x0, x1 in runs(xs_[:-1], ok):
                x1 += 0.04
                if x1 - x0 < 0.1: continue
                b = loft('bm', [(x, 0.013, d_in(x) - 0.024, d_in(x) + 0.002) for x in [x0 + (x1 - x0) * k / 6 for k in range(7)]], primer, n=12)
                b.matrix_world = Matrix.Rotation(-math.radians(th_e), 4, 'X') @ b.matrix_world; parts.append(b)
        # latch keepers (left door) and hooks (right door) behind the external latches
        th_k = a1 - 0.6 if side == 'L' else a0 + 0.6
        for xk in (0.2, 0.6, 1.0):
            if clear([(xk, th_k, d_in(xk) - 0.02)]): parts.append(box('lk', th_pos(xk, th_k, d_in(xk) - 0.014), (0.07, 0.026, 0.028), th_k, steel))
        # hold-open rods, stowed in clips along the door between the frames: telescopic, with a red lock collar
        placed = 0
        for xr in (0.27, 0.55, 0.83):
            for ta, tb in ((60, 96), (100, 136), (128, 164), (30, 66)):
                if placed == 2: break
                if side == 'R': ta, tb = 360 - tb, 360 - ta
                ri = d_in(xr); mid = (ta + tb) / 2; sag = ri * (1 - math.cos(math.radians((tb - ta) / 2)))
                pa, pb = (xr, ta, ri - 0.03), (xr, tb, ri - 0.03)
                path = [(xr, ta + (tb - ta) * k / 8, ri - 0.03 - sag * math.sin(math.pi * k / 8)) for k in range(9)]
                if not clear(path + [(xr, mid, ri - 0.03 - sag - 0.012)], 0.016): continue
                A_, B_ = _V(th_pos(*pa)), _V(th_pos(*pb)); M_ = A_ + (B_ - A_) * 0.55
                parts += [cylinder('ho', A_, M_, 0.014, 0.014, steel, seg=14), cylinder('hi', M_ - (B_ - A_) * 0.06, B_, 0.009, 0.009, steel, seg=12),
                          cylinder('hl', M_ - (B_ - A_) * 0.01, M_ + (B_ - A_) * 0.045, 0.0165, 0.0165, red_m, seg=14)]
                for q in (A_, B_): parts.append(cylinder('he', q - (B_ - A_).normalized() * 0.012, q + (B_ - A_).normalized() * 0.012, 0.016, 0.016, steel, seg=12))
                for k in (2, 6): parts.append(box('hc', th_pos(*path[k][:2], ri - 0.012), (0.03, 0.02, 0.024), path[k][1], primer))   # stowage clips
                placed += 1; break
        if parts:
            o = join('fancowl_doorinner' + ('B_L__full' if side == 'L' else '_R'), parts); egg_deform(o); made.append(finish(o, 0.0015))

    # ---- engine internals: fan, booster, HP compressor, combustor, turbines, shafts and bearings (tools/blender/internals.py)
    import internals
    IM = {k: material('i_' + k, c, mt, ro) for k, c, mt, ro in [
        ('tifan', (0.5, 0.515, 0.535), 1.0, 0.3), ('ti', (0.62, 0.64, 0.66), 1.0, 0.3), ('nickel', (0.58, 0.58, 0.57), 1.0, 0.34), ('disc', (0.55, 0.57, 0.59), 1.0, 0.36),
        ('case', (0.46, 0.48, 0.5), 0.8, 0.45), ('filler', (0.52, 0.55, 0.58), 0.3, 0.45), ('rubber', (0.06, 0.06, 0.065), 0.0, 0.7), ('bolt', (0.6, 0.61, 0.62), 1.0, 0.3),
        ('vsv', (0.42, 0.47, 0.53), 0.9, 0.32), ('steel', (0.62, 0.64, 0.66), 1.0, 0.3), ('liner', (0.62, 0.6, 0.56), 1.0, 0.45), ('ceramic', (0.92, 0.92, 0.9), 0.0, 0.3),
        ('hptb', (0.46, 0.43, 0.41), 1.0, 0.42), ('tbc', (0.86, 0.83, 0.74), 0.0, 0.6), ('honey', (0.7, 0.7, 0.68), 0.9, 0.55), ('hot', (0.5, 0.46, 0.42), 0.9, 0.45),
        ('lptb', (0.6, 0.56, 0.5), 1.0, 0.38), ('tec', (0.58, 0.52, 0.44), 0.9, 0.45), ('shaft', (0.55, 0.57, 0.6), 1.0, 0.25), ('race', (0.8, 0.82, 0.84), 1.0, 0.15),
        ('bronze', (0.72, 0.5, 0.25), 1.0, 0.35), ('carbon', (0.08, 0.08, 0.09), 0.0, 0.5), ('hole', (0.05, 0.04, 0.035), 0.0, 0.9)]}
    IM['ti_fan'] = IM['tifan']
    IK = internals.Kit(material, link, section)
    internals.build_front(IK, IM); internals.build_rear(IK, IM)
    made.extend(IK.made)

    # ---- the rest of the engine at the same detail (tools/blender/details.py)
    import details
    DM = {**IM, 'i_hot': IM['hot'], 'i_case': IM['case'], 'acoustic': acoustic, 'primer': primer, 'bare': bare, 'section': section,
          **{k: material(k, c, mt, ro) for k, c, mt, ro in [
              ('sp_dark', (0.045, 0.048, 0.055), 0.1, 0.22), ('sp_white', (0.94, 0.94, 0.92), 0.0, 0.5), ('sp_fair', (0.66, 0.68, 0.7), 0.35, 0.45),
              ('blanket', (0.72, 0.73, 0.72), 0.7, 0.45), ('seal', (0.85, 0.36, 0.13), 0.0, 0.6), ('grille', (0.42, 0.43, 0.44), 0.8, 0.5),
              ('liner_perf', (0.55, 0.56, 0.58), 0.5, 0.75), ('abradable', (0.83, 0.79, 0.63), 0.0, 0.78), ('icepanel', (0.44, 0.46, 0.49), 0.0, 0.85),
              ('cast', (0.55, 0.56, 0.55), 0.45, 0.58), ('steel', (0.62, 0.64, 0.66), 1.0, 0.3), ('gold', (0.8, 0.68, 0.3), 0.6, 0.4), ('dark', (0.08, 0.085, 0.09), 0.2, 0.6),
              ('composite', (0.32, 0.33, 0.33), 0.0, 0.6), ('connector', (0.5, 0.55, 0.45), 0.6, 0.4), ('fitting', (0.7, 0.71, 0.72), 1.0, 0.3), ('vband', (0.66, 0.67, 0.68), 1.0, 0.35),
              ('tube_ss', (0.7, 0.71, 0.7), 1.0, 0.32), ('tube_cad', (0.78, 0.7, 0.42), 0.8, 0.35), ('clamp_block', (0.5, 0.5, 0.5), 0.3, 0.6), ('bracket', (0.6, 0.62, 0.64), 1.0, 0.35),
              ('panelline', (0.12, 0.13, 0.14), 0.0, 0.6), ('i_bare', (0.64, 0.66, 0.67), 1.0, 0.34)]}}
    DD = details.D(IK, DM, P, r_at, smooth_nacelle)
    for f in (details.build_spinner, details.build_core_cowl, details.build_common_nozzle, details.build_bleed_valves, details.build_case_details,
              details.build_tec_instruments, details.build_tubes, details.build_liners):
        f(DD)

    # ---- the accessory drive train, gear by gear (tools/blender/drivetrain.py)
    import drivetrain as DT
    IM['gear'] = material('i_gear', (0.42, 0.43, 0.45), 1.0, 0.3)
    dt_objs, SPIN = DT.build(link, {'gear': IM['gear'], 'shaft': IM['shaft'], 'race': IM['race'], 'cage': IM['bronze'], 'case': IM['case'],
                                    'cast': DM['cast'], 'nut': IM['bolt'], 'gold': DM['gold'], 'steel': IM['steel'], 'dark': DM['dark']}, section)
    made.extend(dt_objs)

    # ---- decals: data plates, placards, stencils, tags, blade numbers (tools/blender/decals.py)
    import decals
    fan_r = lambda x: r_at(P['bypOuter'], x) + 0.0335
    sp = bpy.data.objects.get('spinner_fairing')
    def spinner_r(x):   # outer radius of the spinner fairing at x, from its mesh
        vs = [v.co for v in sp.data.vertices if abs(v.co.x - x) < 0.006] if sp else []
        return max((math.hypot(v.y, v.z) for v in vs), default=0.3)
    decals.build(material, link, made, fan_r, spinner_r, oml)

    for helper in (wedge, latch): bpy.data.objects.remove(helper, do_unlink=True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'v2500.glb'), export_apply=True, export_yup=True)
    manifest = {
        'file': 'v2500.glb', 'scale': 1,
        'parts': {
            'inlet': {'match': '^inlet_', 'drop': ['skin', 'internal']}, 'lip': {'match': '^lip_', 'drop': ['skin']},
            'fancowl': {'match': '^fancowl_', 'drop': ['skin']}, 'fancase': {'match': '^fancase_', 'drop': []},
            'cna': {'match': '^cna_', 'drop': ['skin', 'liner', 'internal']}, 'agb': {'match': '^agb_'}, 'eec': {'match': '^eec_'},
            **{c: {'match': f'^{c}_'} for c, _ in accessories.UNITS}, **{c: {'match': f'^{c}_'} for c in CORE_UNITS}, **{c: {'match': f'^{c}(B__full)?$'} for c in LINE_PARTS},
            'pylon': {'match': '^pylon_'}, 'ext': {'match': '^ext_', 'drop': ['dress']},
            'spinner': {'match': '^spinner_', 'spool': 1}, 'corecowl': {'match': '^corecowl_'},
            # internals replace the generated stand-ins tagged 'internal' (app/scene3d.js); the fan case keeps its own
            **{c: {'match': f'^{c}_', 'drop': ['internal']} for c in internals.PARTS}, 'fancase': {'match': '^fancase_', 'drop': ['internal']},
            **{c: {'match': f'^{c}_'} for c in DT.PARTS},
        },
        'rings': IK.rings,
        'ports': details.PORTS,
        'spin': SPIN,
        'reverser': REVERSER,
        'vis': {'parts': internals.PARTS + DT.PARTS, 'out': internals.VIS_OUT[:-1] + '|' + DT.VIS_OUT + ')', 'core': internals.VIS_CORE},
    }
    json.dump(manifest, open(os.path.join(OUT, 'model.json'), 'w'), indent=2)
    tris = sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in made)
    print('built', [o.name for o in made], 'faces~', tris)

if __name__ == '__main__':
    build()
