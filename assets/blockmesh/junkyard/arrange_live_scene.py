"""Run inside the owner's live Blender session. Preserve original in a backup."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path('E:/Leaper/assets/blockmesh/junkyard')
BACKUP = ROOT/'junkyarf_before_arrangement.blend'
OUTPUT = ROOT/'junkyard_arranged.blend'
if BACKUP.exists() or OUTPUT.exists():
    raise RuntimeError('Layout files already exist; inspect before running again.')
bpy.ops.wm.save_as_mainfile(filepath=str(BACKUP), copy=True)
anchors = ['blue_sedan','burgundy_hatchback','sorting_crane','scrap_hydraulic_press']
before = {name: [list(row) for row in bpy.data.objects[name].matrix_world] for name in anchors}
original_names = set(bpy.data.objects.keys())
added = bpy.data.collections.new('Layout additions - heaps and props')
bpy.context.scene.collection.children.link(added)
changes = []


def bounds(obj):
    bpy.context.view_layer.update()
    p = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    return [min(v[i] for v in p) for i in range(3)], [max(v[i] for v in p) for i in range(3)]


def place(obj, x, y, yaw=None, ground=True):
    obj.location.x = x
    obj.location.y = y
    if yaw is not None:
        obj.rotation_euler = (math.pi/2, 0, math.radians(yaw))
    if ground:
        low, _ = bounds(obj)
        obj.location.z -= low[2]
    changes.append({'name': obj.name, 'location': list(obj.location)})
    return obj


def move(name, x, y, yaw=None):
    return place(bpy.data.objects[name], x, y, yaw)


def duplicate(source, label, x, y, yaw=0, scale=None):
    obj = bpy.data.objects[source].copy()
    obj.name = label
    added.objects.link(obj)
    if scale is not None:
        obj.scale = scale
    return place(obj, x, y, yaw)


# Preserve the owner's large landmarks and hand-stacked scrap bins.
# Clear the staging objects out of the middle of the arena.
move('barrel_cluster_5', 14.1, -15.8, 20)
move('barrel_single', 16.1, -14.9, -15)
move('tire_single', -15.0, -5.6, 15)
move('tire_heap_20', -15.7, -7.2, 8)
move('tire_heap_25_mound', -11.8, -8.5, -12)
move('tire_heap_25_long', -15.4, -11.0, 80)

# A rear storage line: existing empty rack and loaded rack plus one six-car rack.
duplicate('car_rack_loaded_6','Rack - middle six cars',7.0,14.2,90)
# Move the grouped loose truck tires together so they do not intersect the new rack.
for name in ['truck_tire_single','truck_tire_single.001','truck_tire_single.002']:
    obj=bpy.data.objects[name]
    place(obj,obj.location.x-3.0,obj.location.y+2.5,ground=False)

# Left-side tire sorting bay. Duplicate complete single-object heaps.
duplicate('tire_heap_25_long','Tires - west wall row',-20.1,-9.6,5)
duplicate('tire_heap_25_mound','Tires - west mound',-11.9,-12.6,18)
duplicate('tire_heap_20','Tires - front west stack',-15.2,-14.3,-12)
for index,(x,y,yaw) in enumerate([(-17.9,-6.5,10),(-10.0,-11.1,35),(-14.3,-5.9,-25),(-18.1,-12.4,15)]):
    duplicate('tire_single',f'Loose tire west {index+1}',x,y,yaw)

# Scrap islands guide a winding central route rather than filling every gap.
duplicate('scrap_heap_extra_large','Scrap island - north centre',-6.5,4.1,-18)
duplicate('scrap_heap_large','Scrap island - south centre',5.1,-6.9,22)
duplicate('scrap_heap_beams_pipes','Metal sorting - front right',9.8,-16.2,75,scale=(1,1,1))
duplicate('scrap_heap_large','Scrap bank - front left',-7.0,-17.5,-15,scale=(1,1.25,1))
duplicate('scrap_heap_beams_pipes','Metal sorting - rear wall',-.8,20.0,90,scale=(1,1,1))

# Service clutter around the crane and workshop; keep the workshop doorway clear.
duplicate('barrel_cluster_5','Barrels - crane supplies',-21.0,12.2,30)
duplicate('barrel_cluster_5','Barrels - rear service',-6.0,20.2,-10)
duplicate('barrel_cluster_5','Barrels - workshop corner',22.0,-17.3,0)
duplicate('barrel_single','Barrel - workshop inside',21.8,-12.7,0)
duplicate('barrel_single','Barrel - sorting station',-12.7,10.7,0)
duplicate('edge_utility_cabinet','Cabinet - workshop tools',22.4,-11.0,270)
duplicate('tire_heap_12','Tires - workshop stock',21.7,-19.2,15)

# Add the accepted panel van; leave the rejected motorcycle out of the scene.
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.obj_import(filepath=str(ROOT/'van_panel.obj'),forward_axis='NEGATIVE_Z',up_axis='Y')
van=bpy.context.selected_objects[0]
van.name='Van - workshop service'
for collection in list(van.users_collection):
    collection.objects.unlink(van)
added.objects.link(van)
place(van,13.3,-10.6,10)

bpy.context.view_layer.update()
for name in anchors:
    assert before[name] == [list(row) for row in bpy.data.objects[name].matrix_world], name
for obj in added.objects:
    low,high=bounds(obj)
    assert low[0]>-24.0 and high[0]<24.0 and low[1]>-22.5 and high[1]<22.5, (obj.name,low,high)
    assert low[2]>=-.001, (obj.name,low[2])

bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=None
# Return the active editor to a clear elevated view over the whole arrangement.
area=bpy.context.area
area.type='VIEW_3D'
space=area.spaces.active
space.region_3d.view_distance=68
space.region_3d.view_location=(0,0,0)
space.region_3d.view_rotation=Quaternion((0.8924,0.3696,0.0990,0.2391))
space.region_3d.view_perspective='ORTHO'
space.clip_end=1000
space.overlay.show_extras=False
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
(ROOT/'layout_report.json').write_text(json.dumps({'backup':str(BACKUP),'saved_scene':str(OUTPUT),'preserved_anchors':anchors,'added_count':len(added.objects),'changes':changes},indent=2))
print('LAYOUT COMPLETE',len(added.objects),'added props; anchors unchanged;',OUTPUT)
