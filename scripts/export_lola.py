"""Export Lola's two weapon outfits and movement clips without saving the source.

Blender -b Lola_both_animations.blend1.blend --python scripts/export_lola.py
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector

OUTPUT = Path(__file__).resolve().parents[1] / 'assets/characters/lola'
WALK_SOURCE = Path('C:/Blender/LOWPOLY/Lola_walk_final.blend')
OUTPUT.mkdir(parents=True, exist_ok=True)
with bpy.data.libraries.load(str(WALK_SOURCE), link=False) as (source, target):
    target.actions = ['Lola_Run_Gun']
walk_source = target.actions[0]


def lower_body(path):
    return any(word in path for word in ('foot', 'toe', 'shin', 'thigh', 'hips', 'torso', 'root'))


def add_track(obj, action, name):
    obj.animation_data_create()
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    if name == 'Walk':
        strip.scale = 1.6
    track.mute = False


report = []
for weapon, scene_name, rig_name in (
    ('basic', '01 Basic Gun - Original Run', 'rig.001'),
    ('m416', '02 M416 - Carry Run', 'Lola_M416_Rig'),
):
    scene = bpy.data.scenes[scene_name]
    bpy.context.window.scene = scene
    rig = bpy.data.objects[rig_name]
    objects = [rig] + [o for o in rig.children_recursive if o.type == 'MESH']
    for obj in scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    run = rig.animation_data.action.copy()
    run.name = weapon + '_Run'
    walk = run.copy()
    walk.name = weapon + '_Walk'
    # Keep each weapon's authored arm pose; use the separate walk's leg cycle.
    for curve in list(walk.fcurves):
        if lower_body(curve.data_path):
            walk.fcurves.remove(curve)
    for curve in walk_source.fcurves:
        if not lower_body(curve.data_path):
            continue
        out = walk.fcurves.new(curve.data_path, index=curve.array_index)
        for frame in range(1, 26):
            out.keyframe_points.insert(frame, curve.evaluate(frame))
    idle = walk.copy()
    idle.name = weapon + '_Idle'
    # A neutral averaged hold until a dedicated idle clip is authored.
    for curve in idle.fcurves:
        value = sum(curve.evaluate(frame) for frame in range(1, 25)) / 24
        while len(curve.keyframe_points):
            curve.keyframe_points.remove(curve.keyframe_points[-1], fast=True)
        curve.keyframe_points.insert(1, value)
        curve.keyframe_points.insert(25, value)
    rig.animation_data.action = walk
    scene.frame_set(1)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in objects:
        if obj.type == 'MESH':
            evaluated = obj.evaluated_get(depsgraph)
            points.extend(evaluated.matrix_world @ Vector(p) for p in evaluated.bound_box)
    bounds = [[min(p[i] for p in points) for i in range(3)],
              [max(p[i] for p in points) for i in range(3)]]
    for obj in objects:
        if not obj.animation_data:
            continue
        original = obj.animation_data.action
        for track in list(obj.animation_data.nla_tracks):
            obj.animation_data.nla_tracks.remove(track)
        obj.animation_data.action = None
        for name, action in [('Walk', walk), ('Run', run), ('Idle', idle)]:
            if obj == rig:
                add_track(obj, action, name)
            elif original:
                copy = original.copy()
                if name == 'Idle':
                    for curve in copy.fcurves:
                        value = curve.evaluate(1)
                        while len(curve.keyframe_points):
                            curve.keyframe_points.remove(curve.keyframe_points[-1], fast=True)
                        curve.keyframe_points.insert(1, value)
                        curve.keyframe_points.insert(25, value)
                add_track(obj, copy, name)
    scene.frame_start, scene.frame_end = 1, 25
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT / f'lola-{weapon}.glb'), export_format='GLB',
        use_selection=True, use_active_scene=True, export_cameras=False, export_lights=False,
        export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_anim_slide_to_zero=True, export_def_bones=True,
        export_animations=True, export_yup=True,
    )
    report.append({'weapon': weapon, 'scene': scene_name, 'rig': rig_name,
                   'bounds': bounds, 'clips': ['Walk', 'Run', 'Idle']})
(OUTPUT / 'export-info.json').write_text(json.dumps(report, indent=2))
print('LOLA_EXPORT', json.dumps(report))
