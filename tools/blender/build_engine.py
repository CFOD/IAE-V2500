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
P = {
    'inletInner': [[-0.78, 0.8], [-0.62, 0.765], [-0.3, 0.79], [0, 0.81]],
    'nacelle': [[-0.78, 0.8], [-0.74, 0.9], [-0.45, 1.0], [0.5, 1.04], [2.0, 0.98], [3.55, 0.635]],
    'bypOuter': [[0, 0.81], [0.35, 0.81], [1.2, 0.8], [2.4, 0.74], [3.2, 0.66], [3.55, 0.61]],
}

def r_at(prof, x):
    if x <= prof[0][0]: return prof[0][1]
    for i in range(1, len(prof)):
        if x <= prof[i][0]:
            (x0, r0), (x1, r1) = prof[i - 1], prof[i]
            return r0 + (r1 - r0) * (x - x0) / (x1 - x0)
    return prof[-1][1]

def smooth_nacelle(x):
    """Outer mould line: the piecewise profile, rounded so highlights run cleanly."""
    pts = P['nacelle']; d = 0.12
    return (r_at(pts, x - d) + 2 * r_at(pts, x) + r_at(pts, x + d)) / 4

def sample(fn, x0, x1, n):
    return [[x0 + (x1 - x0) * i / n, fn(x0 + (x1 - x0) * i / n)] for i in range(n + 1)]

def material(name, color, metallic=0.0, rough=0.5, coat=0.0):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value = coat
    return m

def link(obj):
    bpy.context.scene.collection.objects.link(obj); return obj

def revolve(name, loop, mat, steps=144):
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, max(r, 0.0))) for x, r in loop]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Rotation(-math.radians(th_deg), 4, 'X'), verts=bm.verts)
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
    for i in range(nx):
        for j in range(nt): bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    obj = link(bpy.data.objects.new(name, me)); me.materials.append(mat)
    return obj

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
    R = 3.0
    wedge = prism('wedge', [(0, 0)] + [(R * math.cos(a), R * math.sin(a)) for a in [CUT_A + (CUT_B - CUT_A) * i / 12 for i in range(13)]], -2, 6, section)
    # longitudinal split along the bottom centreline (cowl door latch line)
    latch = prism('latch', [(-0.5, -0.003), (-0.5, 0.003), (-1.3, 0.003), (-1.3, -0.003)], 0.01, 2.85, paint)

    skin_in = lambda x: (r_at(P['inletInner'], x) if x < 0 else r_at(P['bypOuter'], x)) + 0.013
    made = []
    def cowl(name, x0, x1, mat, n, inset=0.0, split=False):
        loop = sample(lambda x: smooth_nacelle(x) - inset, x0, x1, n) + list(reversed(sample(skin_in, x0, x1, n)))
        o = revolve(name, loop, mat)
        if split: boolean(o, latch)
        c = duplicate(o, name + '__cut'); boolean(c, wedge)
        made.extend([finish(o), finish(c)])

    G = 0.004  # half panel gap
    cowl('inlet_cowl', -0.655, -G, paint, 14)
    # Fan cowl doors: a thin skin. The bare fan case and its accessories sit in the gap underneath.
    def skin(name, x0, x1, thick, n):
        loop = sample(smooth_nacelle, x0, x1, n) + list(reversed(sample(lambda x: smooth_nacelle(x) - thick, x0, x1, n)))
        o = revolve(name, loop, paint); boolean(o, latch)
        c = duplicate(o, name + '__cut'); boolean(c, wedge); made.extend([finish(o), finish(c)])
    skin('fancowl_doors', G, 1.2 - G, 0.022, 16)

    # ---- bare fan case (reference: MTU and manufacturer photos, museum model)
    cast = material('cast', (0.58, 0.6, 0.62), 1.0, 0.42)
    steel = material('steel', (0.72, 0.74, 0.76), 1.0, 0.25)
    dark = material('dark', (0.05, 0.055, 0.06), 0.2, 0.55)
    gold = material('gold', (0.75, 0.58, 0.22), 1.0, 0.3)
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
    # oil tank: tall domed cylinder on the side of the case
    tank = cylinder('tank', th_pos(0.52, 141, 0.955), th_pos(0.52, 119, 0.955), 0.085, 0.085, cast, dome=0.05)
    cap = cylinder('cap', th_pos(0.52, 118, 0.99), th_pos(0.52, 116.5, 1.0), 0.03, 0.03, gold)
    strap = [cylinder('strap', th_pos(0.52, a, 0.955), th_pos(0.52, a - 1.2, 0.955), 0.089, 0.089, steel) for a in (136, 125)]
    made.append(finish(join('fancase_oiltank', [tank, cap] + strap), 0))
    # large duct wrapped round the case, top to bottom
    made.append(tube('fancase_duct', [(0.86, a, 0.945 + 0.012 * math.sin(a / 9)) for a in range(114, 181, 6)] + [(0.8, 184, 0.95), (0.7, 186, 0.965)], 0.05, steel))
    # harness bundles and small pipes along the case
    lines = [tube('l', [(0.05 + 0.1 * math.sin(a / 23 + k), a, R_CASE + 0.025 + 0.004 * k) for a in range(116, 250, 8)], 0.009 + 0.002 * (k % 2), dark if k % 2 else steel) for k in range(4)]
    lines += [tube('l', [(x, 150 + 14 * k + 3 * math.sin(x * 9), R_CASE + 0.02) for x in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.15)], 0.008, dark if k % 2 == 0 else steel) for k in range(5)]
    made.append(join('fancase_harness', lines))

    # ---- accessory gearbox: a flat casting wrapped under the fan case, accessories fore and aft
    gb = arc_solid('gb', [[0.36, 0.875], [0.36, 0.985], [0.5, 1.0], [0.72, 0.995], [0.78, 0.97], [0.78, 0.875]], 152, 208, cast)
    R = 0.935
    def bolts(x, th, r, rad, n=8):
        from mathutils import Vector
        c = Vector(th_pos(x, th, r)); t = math.radians(th)
        radial = Vector((0, -math.sin(t), math.cos(t))); tang = Vector((0, -math.cos(t), -math.sin(t)))
        return [cylinder('b', c + rad * (math.cos(a) * radial + math.sin(a) * tang) - Vector((0.006, 0, 0)), c + rad * (math.cos(a) * radial + math.sin(a) * tang) + Vector((0.006, 0, 0)), 0.005, 0.005, steel, seg=6) for a in [2 * math.pi * k / n for k in range(n)]]
    acc = [
        # air turbine starter: flanged body, V-band clamp, inlet scroll and air duct stub
        stack('starter', 0.36, 164, R, [(0.012, 0.07, 0.07), (0.02, 0.058, 0.058), (0.008, 0.066, 0.066), (0.1, 0.06, 0.055), (0.012, 0.064, 0.064), (0.07, 0.05, 0.04)], steel, -1),
        tube('starterduct', [(0.2, 164, R), (0.2, 160, R + 0.02), (0.22, 150, R + 0.015), (0.3, 138, R + 0.01), (0.5, 128, R + 0.01)], 0.03, steel),
        # integrated drive generator: finned barrel with a terminal block
        stack('idg', 0.78, 170, R - 0.005, [(0.012, 0.075, 0.075), (0.03, 0.062, 0.062)] + [(0.008, 0.07 if k % 2 == 0 else 0.062, 0.07 if k % 2 == 0 else 0.062) for k in range(18)] + [(0.05, 0.062, 0.04)], cast),
        box('idgterm', th_pos(0.9, 170, R + 0.062), (0.09, 0.07, 0.03), 170, dark),
        # hydraulic pump: stepped body with two ports
        stack('hyd', 0.36, 193, R, [(0.012, 0.058, 0.058), (0.06, 0.048, 0.048), (0.05, 0.04, 0.036), (0.04, 0.03, 0.03)], cast, -1),
        tube('hydline', [(0.26, 193, R + 0.04), (0.2, 196, R + 0.05), (0.1, 205, R + 0.03), (0.0, 215, R - 0.02)], 0.011, steel),
        tube('hydline', [(0.3, 190, R + 0.04), (0.24, 186, R + 0.055), (0.12, 182, R + 0.05)], 0.009, steel),
        # fuel pump and fuel metering unit
        stack('fuelpump', 0.78, 196, R - 0.005, [(0.012, 0.064, 0.064), (0.09, 0.055, 0.055), (0.008, 0.06, 0.06), (0.07, 0.048, 0.044)], gold),
        box('fmu', th_pos(1.02, 196, R - 0.005), (0.12, 0.11, 0.1), 196, cast),
        tube('fuelline', [(1.08, 196, R), (1.14, 192, R - 0.02), (1.2, 186, R - 0.06), (1.3, 184, R - 0.14)], 0.013, gold),
        # oil pump and filter housings
        stack('oilpump', 0.36, 179, R + 0.005, [(0.012, 0.046, 0.046), (0.07, 0.038, 0.038), (0.02, 0.03, 0.03)], cast, -1),
        stack('filter', 0.78, 183, R, [(0.01, 0.05, 0.05), (0.11, 0.042, 0.042), (0.012, 0.046, 0.046), (0.02, 0.02, 0.02)], steel),
    ]
    for x, th, rr, rad in [(0.354, 164, R, 0.064), (0.786, 170, R - 0.005, 0.069), (0.354, 193, R, 0.053), (0.786, 196, R - 0.005, 0.059)]: acc += bolts(x, th, rr, rad)
    # stiffening ribs and mounting pads on the gearbox casting
    for th0 in (158, 168, 178, 188, 198):
        acc.append(arc_solid('rib', [[0.38, 0.985], [0.38, 0.997], [0.74, 1.004], [0.74, 0.992]], th0, th0 + 1.2, cast, steps=2))
    made.append(finish(join('agb_gearbox', [gb] + acc), 0.003))
    # ---- EEC: flat box on the upper side of the fan case
    made.append(finish(box('eec_box', th_pos(0.5, 305, 0.92), (0.42, 0.3, 0.085), 305, dark), 0.006))
    # ---- thrust reverser: fixed torque box, translating sleeve, cascades, blocker doors
    OML = smooth_nacelle; duct = lambda x: r_at(P['bypOuter'], x)
    def shell(name, loop, mat, split=True):
        o = revolve(name, loop, mat)
        if split: boolean(o, latch)
        c = duplicate(o, name + '__cut'); boolean(c, wedge); made.extend([finish(o), finish(c)])
    shell('cna_torquebox', sample(OML, 1.2 + G, 1.74, 8) + list(reversed(sample(duct, 1.2 + G, 1.74, 8))), paint)
    X0, XC, X1 = 1.74 + G, 2.24, 2.86 - G   # sleeve start, end of the cascade bay, sleeve end
    sleeve = (sample(OML, X0, X1, 16) + list(reversed(sample(duct, X0, X1, 16)))
              + sample(lambda x: duct(x) + 0.014, X0, XC, 6) + list(reversed(sample(lambda x: OML(x) - 0.02, X0, XC, 6))))
    shell('cna_sleeve', sleeve, paint)
    # cascades: turning-vane hoops and axial strongbacks in the bay the sleeve uncovers
    cas_full, cas_cut = [], []
    for k in range(10):
        x = 1.775 + k * 0.047; lo, hi = duct(x) + 0.03, OML(x) - 0.035
        hoop = [[x, lo], [x - 0.016, hi], [x - 0.008, hi], [x + 0.008, lo]]   # leaned forward to turn the flow
        cas_full.append(revolve('h', hoop, cast, steps=96)); cas_cut.append(arc_solid('h', hoop, 112, 352, cast, steps=72))
    for k in range(24):
        th = k * 15 + 7.5; rm = (duct(2.0) + OML(2.0)) / 2 - 0.002
        for lst in ([cas_full] if in_cut(th) else [cas_full, cas_cut]):
            lst.append(box('s', th_pos(1.99, th, rm), (0.46, 0.012, OML(2.0) - duct(2.0) - 0.07), th, cast))
    made.extend([join('cna_cascades', cas_full), join('cna_cascades__cut', cas_cut)])
    # blocker doors: stowed flush in the sleeve's inner wall, hinged at their aft edge
    from mathutils import Matrix
    for k in range(10):
        th = k * 36 + 18; L = 0.4; xh = 2.2; rh = duct(xh) - 0.006
        hw0 = math.pi * rh / 10 * 0.94; hw1 = math.pi * (duct(xh - L) - 0.006) / 10 * 0.94
        bm = bmesh.new()
        slope = (duct(xh - L) - duct(xh))  # door follows the duct wall when stowed
        vs = [bm.verts.new(v) for v in [(0, -hw0, 0), (0, hw0, 0), (-L, hw1, slope), (-L, -hw1, slope), (0, -hw0, -0.012), (0, hw0, -0.012), (-L, hw1, slope - 0.012), (-L, -hw1, slope - 0.012)]]
        for f in [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]: bm.faces.new([vs[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        nm = f'cna_blocker_{k:02d}' + ('__full' if in_cut(th) else '')
        me = bpy.data.meshes.new(nm); bm.to_mesh(me); bm.free(); me.materials.append(cast)
        door = link(bpy.data.objects.new(nm, me))
        door.matrix_world = Matrix.Translation(th_pos(xh, th, rh)) @ Matrix.Rotation(-math.radians(th), 4, 'X')
        made.append(door)
    cowl('cna_nozzle', 2.86 + G, 3.55, bare, 12, inset=0.008)
    lip = [[-0.655, 0.781], [-0.7, 0.774], [-0.745, 0.783], [-0.778, 0.806], [-0.79, 0.84], [-0.778, 0.878], [-0.745, 0.905], [-0.7, 0.922], [-0.663, 0.932],
           [-0.663, 0.905], [-0.7, 0.895], [-0.735, 0.875], [-0.752, 0.84], [-0.742, 0.812], [-0.71, 0.798], [-0.663, 0.796]]
    o = revolve('lip_ring', lip, lipm); c = duplicate(o, 'lip_ring__cut'); boolean(c, wedge); made.extend([finish(o, 0), finish(c, 0)])

    # strake high on the cowl side (kept side of the cutaway)
    th = math.radians(338); rs = 1.02
    def at(x, dr): r = rs + dr; return (x, -r * math.sin(th), r * math.cos(th))
    bm = bmesh.new(); t = 0.007
    strake_pts = [(0.28, -0.02), (0.92, -0.02), (0.9, 0.085), (0.5, 0.03)]
    for side in (-1, 1):
        vs = [bm.verts.new(tuple(c + side * t * n for c, n in zip(at(x, dr), (0, math.cos(th), math.sin(th))))) for x, dr in strake_pts]
        bm.faces.new(vs if side > 0 else list(reversed(vs)))
    bm.verts.ensure_lookup_table()
    for i in range(4): bm.faces.new((bm.verts[i], bm.verts[(i + 1) % 4], bm.verts[4 + (i + 1) % 4], bm.verts[4 + i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('fancowl_strake'); bm.to_mesh(me); bm.free(); me.materials.append(paint)
    made.append(finish(link(bpy.data.objects.new('fancowl_strake', me)), 0.002))

    # ---- pylon fairing
    made.append(finish(loft('pylon_fairing', [(0.12, 0.03, 0.985, 1.03), (0.3, 0.11, 0.975, 1.12), (0.7, 0.16, 0.97, 1.3), (1.6, 0.175, 0.94, 1.42), (2.6, 0.16, 0.86, 1.42), (3.2, 0.11, 0.84, 1.36), (3.7, 0.045, 0.95, 1.28), (3.95, 0.012, 1.08, 1.22)], paint, n=20), 0))

    # ---- markings, panel lines and hardware (from the on-wing photos)
    line = material('panelline', (0.12, 0.13, 0.14), 0.0, 0.6)
    red = material('hazard', (0.72, 0.05, 0.05), 0.0, 0.5)
    placard = material('placard', (0.93, 0.93, 0.9), 0.0, 0.55)
    black = material('marking', (0.03, 0.03, 0.03), 0.0, 0.6)
    surf = OML
    marks = []
    marks += outline('m', 0.5, 0.82, 152, 168, line, surf)            # pressure-relief door
    marks += outline('m', 0.92, 1.08, 150, 158, line, surf)           # oil service door
    marks += outline('m', 0.2, 0.42, 197, 208, line, surf)            # starter valve access
    marks.append(patch('m', 0.13, 0.15, 128, 166, red, surf))         # hazard stripe: stay clear of the intake
    marks.append(patch('m', 0.2, 0.3, 131, 137, placard, surf)); marks.append(patch('m', 0.215, 0.285, 132, 136, red, surf, lift=0.0026))
    marks.append(patch('m', 0.2, 0.36, 140, 145, placard, surf)); marks += [patch('m', 0.215 + 0.03 * k, 0.235 + 0.03 * k, 141, 144, black, surf, lift=0.0026, nx=1, nt=2) for k in range(5)]
    marks.append(patch('m', 0.56, 0.76, 156, 158.5, placard, surf, lift=0.0026)); marks.append(patch('m', 0.95, 1.05, 152.5, 154, placard, surf, lift=0.0026))
    made.append(join('fancowl_markings', marks))
    rmarks = outline('m', 1.3, 1.6, 150, 162, line, surf) + [patch('m', 1.34, 1.5, 153, 155, placard, surf, lift=0.0026)]
    made.append(join('cna_markings', rmarks))
    # latches along the bottom centreline, and the drain mast
    lat = [box('latch', th_pos(x, 180, OML(x) + 0.001), (0.09, 0.032, 0.007), 180, bare) for x in (0.2, 0.6, 1.0)]
    made.append(join('fancowl_latches', lat))
    made.append(join('cna_latches', [box('latch', th_pos(x, 180, OML(x) + 0.001), (0.09, 0.032, 0.007), 180, bare) for x in (1.45, 2.0, 2.5)]))
    made.append(finish(loft('fancowl_drainmast', [(0.84, 0.004, -1.06, -1.03), (0.9, 0.012, -1.16, -1.0), (0.98, 0.012, -1.17, -1.0), (1.06, 0.004, -1.12, -1.0)], bare, n=12), 0))

    for helper in (wedge, latch): bpy.data.objects.remove(helper, do_unlink=True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'v2500.glb'), export_apply=True, export_yup=True)
    manifest = {
        'file': 'v2500.glb', 'scale': 1,
        'parts': {
            'inlet': {'match': '^inlet_', 'drop': ['skin']}, 'lip': {'match': '^lip_', 'drop': ['skin']},
            'fancowl': {'match': '^fancowl_', 'drop': ['skin']}, 'fancase': {'match': '^fancase_', 'drop': []},
            'cna': {'match': '^cna_', 'drop': ['skin', 'liner']}, 'agb': {'match': '^agb_'}, 'eec': {'match': '^eec_'},
            'pylon': {'match': '^pylon_'},
        },
    }
    json.dump(manifest, open(os.path.join(OUT, 'model.json'), 'w'), indent=2)
    tris = sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in made)
    print('built', [o.name for o in made], 'faces~', tris)

if __name__ == '__main__':
    build()
