"""Put every junkyard prop on the ground: not floating, not sunk.

Run on the map source before baking (it saves the file it opens):
    blender -b assets/blockmesh/junkyard/junkyard_v2.blend --python scripts/ground_junkyard_props.py -- report.json --save
Without --save it only writes the report. Run it again until it reports 0
props moved (a prop resting on another one moves once its support has).
To repeat the same moves on another copy of the yard (same object names):
    blender -b <other.blend> --python scripts/ground_junkyard_props.py -- unused.json report.json

What it does:
0. Moves the floor ("Cube") so its up-facing ground faces are exactly at Z=0
   (the owner's yard had them at -0.077, so every prop placed at 0 hovered).
1. Treats pieces that intersect or nearly touch as one prop (a container's
   ribs and posts, a pole's insulators), so assemblies move together.
2. Raises a prop whose lowest point is under the floor; lowers a prop with
   nothing under it onto whatever is below (the floor or another prop).
Gaps up to 3 cm are left alone.
"""
import bpy, json, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
TOL, TOUCH = 0.03, 0.02
args = sys.argv[sys.argv.index('--') + 1:]
dg = bpy.context.evaluated_depsgraph_get()
scene = bpy.context.scene

def is_char(o):
    while o:
        if o.type == 'ARMATURE' or o.name.startswith('Lola'): return True
        o = o.parent
    return False

if len(args) > 1 and args[1].endswith('.json'):
    # Apply moves computed on the other copy of the yard (same object names).
    plan = json.load(open(args[1]))
    bpy.data.objects['Cube'].location.z += plan['floorDz']
    moves = plan['moves']
    for name, dz in moves.items():
        bpy.data.objects[name].location.z += dz
    bpy.ops.wm.save_mainfile()
    print('APPLIED', len(moves))
    sys.exit(0)

# 0. The floor (the up-facing ground faces of "Cube") goes to exactly Z=0.
cube = bpy.data.objects['Cube']
mw = cube.matrix_world
floor_z = max((mw @ p.center).z for p in cube.data.polygons
              if (mw.to_3x3() @ p.normal).normalized().z > 0.9
              and cube.material_slots[p.material_index].material.name.endswith('ground'))
floor_dz = -floor_z
cube.location.z += floor_dz
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
print('FLOOR was', round(floor_z, 4))

props, verts, trees, boxes = [], {}, {}, {}
for o in scene.objects:
    if o.type != 'MESH' or o.name == 'Cube' or is_char(o) or o.hide_render or not o.visible_get(): continue
    ev = o.evaluated_get(dg); me = ev.to_mesh()
    vs = [ev.matrix_world @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    if not vs: continue
    props.append(o.name); verts[o.name] = vs
    trees[o.name] = BVHTree.FromPolygons(vs, polys)
    boxes[o.name] = ([min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)])

# 1. Pieces that intersect (or nearly touch) are one prop.
parent = {n: n for n in props}
def find(n):
    while parent[n] != n:
        parent[n] = parent[parent[n]]; n = parent[n]
    return n
def near(a, b):
    (la, ha), (lb, hb) = boxes[a], boxes[b]
    return all(la[i] <= hb[i] + TOUCH and lb[i] <= ha[i] + TOUCH for i in range(3))
for i, a in enumerate(props):
    for b in props[i + 1:]:
        if find(a) == find(b) or not near(a, b): continue
        if trees[a].overlap(trees[b]):
            parent[find(a)] = find(b); continue
        # Nearly touching: any vertex of the smaller within TOUCH of the other's surface.
        small, big = (a, b) if len(verts[a]) < len(verts[b]) else (b, a)
        for v in verts[small][::max(1, len(verts[small]) // 60)]:
            hit = trees[big].find_nearest(v, TOUCH)
            if hit[0] is not None:
                parent[find(a)] = find(b); break
groups = {}
for n in props: groups.setdefault(find(n), []).append(n)

# 2. Each prop: how far its lowest point is from what is under it.
moves, report = {}, []
for members in groups.values():
    allv = [v for n in members for v in verts[n]]
    lo = min(v.z for v in allv)
    dz = 0.0
    if lo < -TOL:
        dz = -lo
    elif lo > TOL:
        names = set(members)
        gaps = []
        for v in sorted(allv, key=lambda v: v.z)[:400:8]:
            origin = Vector((v.x, v.y, v.z - 0.002)); gap = v.z
            for _ in range(10):
                hit, loc, nrm, idx, obj, mat = scene.ray_cast(dg, origin, Vector((0, 0, -1)))
                if not hit: break
                if obj.name in names or (obj.original and obj.original.name in names):
                    origin = loc - Vector((0, 0, 0.002)); continue
                gap = v.z - loc.z; break
            gaps.append(gap)
        gap = min(gaps)
        if gap > TOL: dz = -gap
    if abs(dz) > 1e-4:
        for n in members: moves[n] = round(dz, 4)
        report.append({'dz': round(dz, 3), 'lowest': round(lo, 3), 'pieces': len(members), 'name': sorted(members)[0]})
if '--save' in args:
    for n, dz in moves.items(): bpy.data.objects[n].location.z += dz
    bpy.ops.wm.save_mainfile()
json.dump({'floorDz': round(floor_dz, 5), 'groups': len(groups), 'moves': moves, 'report': sorted(report, key=lambda r: -abs(r['dz']))}, open(args[0], 'w'), indent=0)
print('DONE groups', len(groups), 'props moved', len(report), 'pieces moved', len(moves))
