"""Export Lola's separately authored clips (jumps, reload) without touching the others.

Blender -b "C:/Blender/LOWPOLY/Lola final.blend" --python scripts/export_lola_clips.py -- reload
Blender -b "C:/Blender/LOWPOLY/Lola final.blend" --python scripts/export_lola_clips.py -- runjumprl runjumplr backjumplr backjumprl

Writes assets/characters/lola/lola-<clip>-<weapon>.glb, each holding the clip rig's
deform bones plus the separately animated held weapon, in one clip named after the
kind ("Jump", "Reload"). The game copies that clip onto the existing outfit skeleton
(same bone names). The source .blend is never saved.
"""
import json
import sys
from pathlib import Path

import bpy

OUTPUT = Path(__file__).resolve().parents[1] / 'assets/characters/lola'
# kind: (clip name in the game, rig object, held weapon object), per weapon.
CLIPS = {
    'jump': ('Jump', 'Lola_{w}_Jump_Rig', 'Lola_{w}_Jump_Weapon'),
    'reload': ('Reload', 'Lola_{w}_Reload_Rig', 'Lola_{w}_Reload_Weapon'),
    # Running jump: legs reach forward in the air to land straight into the run.
    'jumprun': ('JumpToRun', 'Lola_{w}_JumpToRun_Rig', 'Lola_{w}_JumpToRun_Weapon'),
    # Jumps taken mid-run, one per foot phase ("RL": right foot forward at take-off,
    # lands left foot forward), and the same while running backward.
    'runjumprl': ('RunJumpRL', 'Lola_{w}_RunJump_RL_Rig', 'Lola_{w}_RunJump_RL_Weapon'),
    'runjumplr': ('RunJumpLR', 'Lola_{w}_RunJump_LR_Rig', 'Lola_{w}_RunJump_LR_Weapon'),
    'backjumplr': ('BackJumpLR', 'Lola_{w}_BackwardJump_LR_Rig', 'Lola_{w}_BackwardJump_LR_Weapon'),
    'backjumprl': ('BackJumpRL', 'Lola_{w}_BackwardJump_RL_Rig', 'Lola_{w}_BackwardJump_RL_Weapon'),
}


def toe_heights(scene, rig, start, end):
    """Lowest toe-tip height per frame, to find take-off and touchdown frames."""
    toes = [rig.pose.bones[name] for name in ('DEF-toe.L', 'DEF-toe.R')]
    heights = []
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        heights.append(round(min((rig.matrix_world @ bone.tail).z for bone in toes), 4))
    return heights
requested = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(CLIPS)

report = []
for kind in requested:
    clip_name, rig_pattern, weapon_pattern = CLIPS[kind]
    for weapon in ('basic', 'm416'):
        rig = bpy.data.objects[rig_pattern.format(w=weapon)]
        # Find the scene by rig, so renamed scenes/actions still export whatever
        # clip is currently assigned.
        scene = rig.users_scene[0]
        bpy.context.window.scene = scene
        held = bpy.data.objects[weapon_pattern.format(w=weapon)]
        # The game looks the held gun up by this name, e.g. "m416_ReloadWeapon".
        held.name = f'{weapon}_{clip_name}Weapon'
        for obj in scene.objects:
            obj.select_set(False)
        for obj in (rig, held):
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.select_set(True)
            action = obj.animation_data.action
            for track in list(obj.animation_data.nla_tracks):
                obj.animation_data.nla_tracks.remove(track)
            obj.animation_data.action = None
            track = obj.animation_data.nla_tracks.new()
            track.name = clip_name
            track.strips.new(clip_name, 1, action)
        bpy.context.view_layer.objects.active = rig
        source = rig.animation_data.nla_tracks[0].strips[0].action
        start, end = (int(v) for v in source.frame_range)
        scene.frame_start, scene.frame_end = start, end
        bpy.ops.export_scene.gltf(
            filepath=str(OUTPUT / f'lola-{kind}-{weapon}.glb'), export_format='GLB',
            use_selection=True, use_active_scene=True, export_cameras=False, export_lights=False,
            export_animation_mode='NLA_TRACKS', export_force_sampling=True,
            export_anim_slide_to_zero=True, export_def_bones=True,
            export_animations=True, export_yup=True,
        )
        report.append({'kind': kind, 'weapon': weapon, 'scene': scene.name, 'fps': scene.render.fps,
                       'action': source.name, 'frames': [start, end],
                       'toe_heights': toe_heights(scene, rig, start, end)})
print('LOLA_CLIP_EXPORT', json.dumps(report))
