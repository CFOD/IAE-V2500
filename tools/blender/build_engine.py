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
    cowl('fancase_cowl', G, 1.2 - G, paint, 16, split=True)
    cowl('cna_reverser', 1.2 + G, 2.86 - G, paint, 20, split=True)
    cowl('cna_nozzle', 2.86 + G, 3.55, bare, 12, inset=0.008)
    lip = [[-0.655, 0.781], [-0.7, 0.774], [-0.745, 0.783], [-0.778, 0.806], [-0.79, 0.84], [-0.778, 0.878], [-0.745, 0.905], [-0.7, 0.922], [-0.663, 0.932],
           [-0.663, 0.905], [-0.7, 0.895], [-0.735, 0.875], [-0.752, 0.84], [-0.742, 0.812], [-0.71, 0.798], [-0.663, 0.796]]
    o = revolve('lip_ring', lip, lipm); c = duplicate(o, 'lip_ring__cut'); boolean(c, wedge); made.extend([finish(o, 0), finish(c, 0)])

    # strake high on the cowl side (kept side of the cutaway)
    th = math.radians(338); rs = 1.02
    def at(x, dr): r = rs + dr; return (x, -r * math.sin(th), r * math.cos(th))
    bm = bmesh.new(); t = 0.007
    outline = [(0.28, -0.02), (0.92, -0.02), (0.9, 0.085), (0.5, 0.03)]
    for side in (-1, 1):
        vs = [bm.verts.new(tuple(c + side * t * n for c, n in zip(at(x, dr), (0, math.cos(th), math.sin(th))))) for x, dr in outline]
        bm.faces.new(vs if side > 0 else list(reversed(vs)))
    bm.verts.ensure_lookup_table()
    for i in range(4): bm.faces.new((bm.verts[i], bm.verts[(i + 1) % 4], bm.verts[4 + (i + 1) % 4], bm.verts[4 + i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('fancase_strake'); bm.to_mesh(me); bm.free(); me.materials.append(paint)
    made.append(finish(link(bpy.data.objects.new('fancase_strake', me)), 0.002))

    for helper in (wedge, latch): bpy.data.objects.remove(helper, do_unlink=True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'v2500.glb'), export_apply=True, export_yup=True)
    manifest = {
        'file': 'v2500.glb', 'scale': 1,
        'parts': {
            'inlet': {'match': '^inlet_', 'drop': ['skin']}, 'lip': {'match': '^lip_', 'drop': ['skin']},
            'fancase': {'match': '^fancase_', 'drop': ['skin']}, 'cna': {'match': '^cna_', 'drop': ['skin']},
        },
    }
    json.dump(manifest, open(os.path.join(OUT, 'model.json'), 'w'), indent=2)
    tris = sum(len(o.data.loop_triangles) or len(o.data.polygons) for o in made)
    print('built', [o.name for o in made], 'faces~', tris)

if __name__ == '__main__':
    build()
