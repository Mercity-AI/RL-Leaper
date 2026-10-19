"""Bake the junkyard's Blender-only shading into one texture the game can show.

Run with:
    blender -b assets/blockmesh/junkyard/junkyard_v2.blend --python scripts/bake_junkyard_textures.py

Why: the yard's look (rust, wear, per-object colour variation) is made of
procedural shader nodes: Noise on Object coordinates and Object Info "Random",
through colour ramps. glTF, the format the browser loads, cannot carry those,
so a plain export keeps only each material's base colour. This script paints
("bakes") the colour every prop really shows in Blender into one shared texture
atlas, gives every prop one plain material using it, and saves the result next
to the source as junkyard_v2_baked.blend. Export that file with
scripts/export_junkyard.py. The source .blend is never changed.

How (fast): Cycles bakes selected objects one at a time over the whole image,
which takes most of an hour for ~640 props. So the props are baked as one
merged copy instead. Two things the shaders read per object would change on a
merged copy, so they are stored on it first: each prop's own Object
coordinates (attribute "orig_co") and its Object Info random value (attribute
"obj_random", read back from a tiny bake). The props themselves stay separate.

The floor and perimeter walls ("Cube") keep their own plain materials.
"""
import math
from pathlib import Path

import bpy

ATLAS_SIZE = 4096
UV_NAME = "BakeUV"
SOURCE = Path(bpy.data.filepath)
OUTPUT = SOURCE.with_name(SOURCE.stem + "_baked.blend")
KEEP = {"Cube"}

scene = bpy.context.scene
layer = bpy.context.view_layer


def select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    layer.objects.active = active or objects[0]


def use_gpu():
    """Bake on the graphics card when there is one (CUDA / OptiX), else the CPU."""
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for device in prefs.devices:
                device.use = device.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


targets = [obj for obj in scene.objects
           if obj.type == "MESH" and not obj.hide_render and obj.visible_get() and obj.name not in KEEP]
device = use_gpu()
scene.cycles.samples = 1
bake = scene.render.bake
bake.use_clear = True

# 1. Own meshes with modifiers applied (the export applies them too), so a prop
#    and its merged copy have the same surface.
select(targets)
bpy.ops.object.make_single_user(object=True, obdata=True, material=False)
depsgraph = bpy.context.evaluated_depsgraph_get()
for obj in targets:
    if obj.modifiers:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        obj.modifiers.clear()
        obj.data = mesh

# 2. A fresh UV map on every prop, all packed into one atlas by real size.
for obj in targets:
    uv = obj.data.uv_layers.get(UV_NAME) or obj.data.uv_layers.new(name=UV_NAME)
    obj.data.uv_layers.active = uv
select(targets)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.0015)
bpy.ops.object.mode_set(mode="OBJECT")

# 3. Each prop's Object Info random value: every prop gets one pixel of a tiny
#    image (its UVs drawn as a small polygon around that pixel) and an emission
#    shader showing the value; one quick bake reads them all.
side = math.ceil(math.sqrt(len(targets)))
probe_image = bpy.data.images.new("random_probe", side, side, float_buffer=True, alpha=False)
probe_image.colorspace_settings.name = "Non-Color"
probe = bpy.data.materials.new("random_probe")
probe.use_nodes = True
nodes, links = probe.node_tree.nodes, probe.node_tree.links
nodes.clear()
info, emit, out = nodes.new("ShaderNodeObjectInfo"), nodes.new("ShaderNodeEmission"), nodes.new("ShaderNodeOutputMaterial")
image_node = nodes.new("ShaderNodeTexImage")
image_node.image = probe_image
links.new(info.outputs["Random"], emit.inputs["Color"])
links.new(emit.outputs["Emission"], out.inputs["Surface"])
nodes.active = image_node
saved_materials = {}
for index, obj in enumerate(targets):
    saved_materials[obj.name] = [slot.material for slot in obj.material_slots]
    uv = obj.data.uv_layers.new(name="probe")
    obj.data.uv_layers.active = uv
    cx, cy = ((index % side) + 0.5) / side, ((index // side) + 0.5) / side
    for polygon in obj.data.polygons:
        count = polygon.loop_total
        for k, loop in enumerate(polygon.loop_indices):
            angle = 2 * math.pi * k / count
            uv.data[loop].uv = (cx + 0.45 / side * math.cos(angle), cy + 0.45 / side * math.sin(angle))
    obj.data.materials.clear()
    obj.data.materials.append(probe)
select(targets)
bpy.ops.object.bake(type="EMIT", margin=0, use_selected_to_active=False)
pixels = list(probe_image.pixels)
randoms = {obj.name: pixels[4 * ((index // side) * side + index % side)] for index, obj in enumerate(targets)}
for obj in targets:
    obj.data.materials.clear()
    for material in saved_materials[obj.name]:
        obj.data.materials.append(material)
    obj.data.uv_layers.remove(obj.data.uv_layers["probe"])
    obj.data.uv_layers.active = obj.data.uv_layers[UV_NAME]

# 4. The shaders read the stored values instead of the per-object ones.
materials = {slot.material for obj in targets for slot in obj.material_slots if slot.material}
atlas = bpy.data.images.new("junkyard_atlas", ATLAS_SIZE, ATLAS_SIZE, alpha=False)
for material in materials:
    material.use_nodes = True
    tree = material.node_tree
    for link in list(tree.links):
        source = link.from_node
        if source.type == "TEX_COORD" and link.from_socket.name == "Object":
            attribute = tree.nodes.new("ShaderNodeAttribute")
            attribute.attribute_name = "orig_co"
            tree.links.new(attribute.outputs["Vector"], link.to_socket)
        elif source.type == "OBJECT_INFO" and link.from_socket.name == "Random":
            attribute = tree.nodes.new("ShaderNodeAttribute")
            attribute.attribute_name = "obj_random"
            tree.links.new(attribute.outputs["Fac"], link.to_socket)
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = UV_NAME
    image = tree.nodes.new("ShaderNodeTexImage")
    image.image = atlas
    tree.links.new(uv.outputs["UV"], image.inputs["Vector"])
    tree.nodes.active = image

# 5. One merged copy carrying each prop's coordinates and random value; bake it once.
copies = []
for obj in targets:
    mesh = obj.data.copy()
    co = mesh.attributes.new("orig_co", "FLOAT_VECTOR", "POINT")
    co.data.foreach_set("vector", [c for v in mesh.vertices for c in v.co])
    rnd = mesh.attributes.new("obj_random", "FLOAT", "POINT")
    rnd.data.foreach_set("value", [randoms[obj.name]] * len(mesh.vertices))
    copy = bpy.data.objects.new(obj.name + " (bake)", mesh)
    copy.matrix_world = obj.matrix_world
    scene.collection.objects.link(copy)
    copies.append(copy)
select(copies)
bpy.ops.object.join()
merged = layer.objects.active
bake.margin = 6
select([merged])
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=False, margin=6)
bpy.data.objects.remove(merged, do_unlink=True)
atlas.pack()

# 6. One plain material with the atlas for every prop; the old UV maps go.
baked = bpy.data.materials.new("Junkyard baked")
baked.use_nodes = True
tree = baked.node_tree
bsdf = tree.nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
uv = tree.nodes.new("ShaderNodeUVMap")
uv.uv_map = UV_NAME
image = tree.nodes.new("ShaderNodeTexImage")
image.image = atlas
tree.links.new(uv.outputs["UV"], image.inputs["Vector"])
tree.links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
for obj in targets:
    obj.data.materials.clear()
    obj.data.materials.append(baked)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    for old in [uv for uv in obj.data.uv_layers if uv.name != UV_NAME]:
        obj.data.uv_layers.remove(old)
bpy.data.images.remove(probe_image)
bpy.data.materials.remove(probe)

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), copy=True, compress=True)
print(f"Baked {len(targets)} props ({len(materials)} materials) into a {ATLAS_SIZE}px atlas on {device} -> {OUTPUT}")
