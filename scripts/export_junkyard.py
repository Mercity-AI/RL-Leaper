"""Run with Blender -b <map.blend> --python scripts/export_junkyard.py.

Exports a browser copy; never saves or changes the source .blend file.
The map's source today is assets/blockmesh/junkyard/junkyard_v2.blend.
The yard's size comes from its floor object ("Cube"), and anything belonging
to a character (an armature and what hangs off it, e.g. a preview Lola) is
left out: the game brings its own Lola.
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector


OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "maps" / "junkyard"
OUTPUT.mkdir(parents=True, exist_ok=True)
depsgraph = bpy.context.evaluated_depsgraph_get()
triangles = []
names = []


def is_character(obj):
    while obj:
        if obj.type == "ARMATURE" or obj.name.startswith("Lola"):
            return True
        obj = obj.parent
    return False


characters = [obj for obj in bpy.context.scene.objects if is_character(obj)]
for obj in characters:
    obj.hide_set(True)  # Kept out of the glTF below (use_visible).
for obj in bpy.context.scene.objects:
    if obj.type != "MESH" or obj.hide_render or not obj.visible_get():
        continue
    names.append(obj.name)
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    vertices = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    for tri in mesh.loop_triangles:
        points = [vertices[i] for i in tri.vertices]
        low = min(p.z for p in points)
        high = max(p.z for p in points)
        # Ground at Blender Z=0 is walkable. Keep low debris and tall walls.
        if high <= 0.12:
            continue
        triangles.append([round(v, 5) for p in points for v in (p.x, -p.y)]
                         + [round(low, 5), round(high, 5)])
    evaluated.to_mesh_clear()

floor = bpy.data.objects["Cube"]
corners = [floor.matrix_world @ Vector(corner) for corner in floor.bound_box]
(OUTPUT / "collision.json").write_text(json.dumps({
    "source": Path(bpy.data.filepath).name,
    "coordinates": "Blender (x,y,z) -> browser (x,z,-y); 1 unit unchanged",
    # Blender y becomes browser -z; the floor is symmetric, so min/max swap safely.
    "bounds": {"minX": round(min(c.x for c in corners), 5), "maxX": round(max(c.x for c in corners), 5),
               "minZ": round(-max(c.y for c in corners), 5), "maxZ": round(-min(c.y for c in corners), 5)},
    "objects": names,
    "triangles": triangles,
}, separators=(",", ":")), encoding="utf-8")
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT / "junkyard.glb"), export_format="GLB",
    use_visible=True, export_cameras=False, export_lights=False,
    export_yup=True, export_apply=True,
)
print(f"Exported {len(names)} objects and {len(triangles)} collision triangles to {OUTPUT}")
