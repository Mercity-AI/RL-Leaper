import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import strideProfiles from '../../../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { ENCOUNTER } from '../../config/encounter.js';
import { measureFootContacts, measureJumpLanding } from '../../robot/footstepContacts.js';
import { LolaRig } from './LolaRig.js';
import { STRIDE_CLIPS } from './LolaLocomotion.js';
import { LOLA_FLINCH_SPREAD, LOLA_WARP_SPINE, RUN_JUMPS } from './lolaTuning.js';

// Lola's two outfits, in weaponIndex order: 0 = M416 rifle, 1 = basic pistol.
export const OUTFIT_WEAPONS = Object.freeze(['m416', 'basic']);
// The gun she carries (not fires) in each outfit's model.
const CARRIED_GUNS = Object.freeze(['M416_Carry', 'Lola_Gun_Basic']);
// Locomotion clips every outfit export must contain.
export const LOCOMOTION_CLIPS = Object.freeze(['Walk', 'Run', 'Idle', 'CrouchWalk', 'CrouchIdle', 'StrafeLeft', 'StrafeRight']);
// Authored standing and crouched shots.
export const SHOT_CLIPS = Object.freeze(['Shoot', 'CrouchShoot']);
// Tracks an upper-body layer (shot, reload) leaves to locomotion: the lower
// spine root, the hips and both legs. Track names use three.js's sanitised
// bone names, so "DEF-spine." only matches the root spine bone itself.
export const LOWER_BODY = /^(DEF-spine\.|hips\.|DEF-pelvis|DEF-thigh|DEF-shin|DEF-foot|DEF-toe)/;

const bone = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));

// Load all 14 Lola files: both outfits, then the authored jump, reload and
// running-jump clips (exported separately by scripts/export_lola_clips.py),
// each per weapon.
export async function loadLolaAssets() {
  const loader = new GLTFLoader();
  const lola = name => loader.loadAsync(new URL(`../../../assets/characters/lola/lola-${name}.glb`, import.meta.url).href);
  const [m416, basic, jumpM416, jumpBasic, reloadM416, reloadBasic, ...runJumpFiles] = await Promise.all([
    lola('m416'), lola('basic'), lola('jump-m416'), lola('jump-basic'), lola('reload-m416'), lola('reload-basic'),
    ...Object.values(RUN_JUMPS).flatMap(({ file }) => [lola(`${file}-m416`), lola(`${file}-basic`)]),
  ]);
  const runJumps = Object.fromEntries(Object.keys(RUN_JUMPS).map((name, i) => [name, runJumpFiles.slice(2 * i, 2 * i + 2)]));
  return { models: [m416, basic], jumps: [jumpM416, jumpBasic], reloads: [reloadM416, reloadBasic], runJumps };
}

// A copy of a loaded character with its own bones, so building Lola never
// consumes the loaded files (a second Lola, a respawn or a test can reuse them).
// Skinned meshes that shared a skeleton keep sharing one copy.
export function cloneCharacter(source) {
  const copies = new Map(), originals = new Map();
  const clone = source.clone();
  const pair = (a, b) => {
    copies.set(a, b);
    originals.set(b, a);
    a.children.forEach((child, i) => pair(child, b.children[i]));
  };
  pair(source, clone);
  const skeletons = new Map();
  clone.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const original = originals.get(node);
    if (!skeletons.has(original.skeleton)) {
      const skeleton = original.skeleton.clone();
      skeleton.bones = original.skeleton.bones.map(item => copies.get(item));
      skeletons.set(original.skeleton, skeleton);
    }
    node.bind(skeletons.get(original.skeleton), original.bindMatrix);
  });
  return clone;
}

// Build one outfit: its model (added under `parent`, so foot measurements see
// the real scale), its re-parented skeleton (see LolaRig), mixer, locomotion
// and shot actions, optional authored jump, running-jump and reload clips, and
// the measured foot contacts.
export function prepareOutfit(gltf, index, { jumps = [], reloads = [], runJumps = {} }, world, parent) {
  const weapon = OUTFIT_WEAPONS[index];
  const model = cloneCharacter(gltf.scene);
  // Blender's character faces -Y, which exports as +Z.
  model.scale.set(world.scale, world.scale * ENCOUNTER.lolaHeight, world.scale);
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
  });

  // Copies of the guns animated with each authored jump, added before the
  // skeleton is fixed so they move onto her chest with the shooting gun.
  const jumpSources = {};
  if (jumps[index]) jumpSources.jump = addJumpGun(model, jumps[index], 'Jump', weapon);
  for (const [name, files] of Object.entries(runJumps)) {
    if (files?.[index]) jumpSources[name] = addJumpGun(model, files[index], name, weapon);
  }
  // A proper upper-body skeleton: arms, the gun-carrying chest bone and the
  // root-level guns hang from her chest. Every clip below is converted to it,
  // so the authored animation looks the same.
  const rig = new LolaRig(model, [`${weapon}_ShootingWeapon`, ...Object.values(jumpSources).map(({ gun }) => gun.name)]);
  const mixer = new THREE.AnimationMixer(model);
  const authored = (name) => {
    const clip = gltf.animations.find((item) => item.name === name);
    if (!clip) throw new Error(`Lola is missing the ${name} animation`);
    return rig.convert(clip);
  };

  // Locomotion clips, all playing; their weights pick what shows.
  const actions = {};
  for (const name of LOCOMOTION_CLIPS) actions[name] = mixer.clipAction(authored(name));
  // The flinch bends these spine joints (see LOLA_FLINCH_SPREAD); hitBone is
  // the lowest, kept under that name for the systems that already read it.
  const flinchBones = LOLA_FLINCH_SPREAD.map(([name, share]) => ({ bone: bone(model, name), share, base: null }))
    .filter(({ bone: item }) => item);
  const hitBone = flinchBones[0]?.bone ?? null;
  const headBone = bone(model, 'DEF-spine.006');
  // The hip twist turns every bone still hanging from the rig itself (after the
  // re-parent: hips, pelvis, thighs and the spine root) and untwists the spine.
  const warpRoots = [];
  model.traverse(item => { if (item.isBone && !item.parent.isBone) warpRoots.push(item); });
  const warpLegs = ['DEF-thigh.L', 'DEF-thigh.R'].map(name => bone(model, name)).filter(Boolean);
  const warpSpine = LOLA_WARP_SPINE.map(([name, share]) => ({ bone: bone(model, name), share })).filter(({ bone: item }) => item);
  const warpSpineTotal = warpSpine.reduce((sum, { share }) => sum + share, 0) || 1;

  // Full-body shots, plus upper-body copies for shooting on the move.
  const shooting = {};
  const shootingUpper = {};
  for (const name of SHOT_CLIPS) {
    const clip = authored(name);
    shooting[name] = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    shooting[name].clampWhenFinished = true;
    const upper = clip.clone();
    upper.name = `${name}Upper`;
    upper.tracks = upper.tracks.filter(track => !LOWER_BODY.test(track.name));
    shootingUpper[name] = mixer.clipAction(upper).setLoop(THREE.LoopOnce, 1);
    shootingUpper[name].clampWhenFinished = true;
  }
  const shotGun = model.getObjectByName(`${weapon}_ShootingWeapon`);
  const carriedGun = model.getObjectByName(CARRIED_GUNS[index]);
  shotGun.visible = false;

  // Every authored jump by kind: 'jump' plus whichever running jumps loaded.
  const jumpClips = {};
  for (const [kind, { clip, gun }] of Object.entries(jumpSources)) {
    const action = mixer.clipAction(rig.convert(clip)).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    jumpClips[kind] = { action, gun };
  }
  const reload = reloads[index] ? createReload(model, mixer, reloads[index], weapon, rig) : null;

  // Start in Idle, then measure the feet on the real (scaled) model.
  actions.Idle.play();
  parent.add(model);
  for (const [name, action] of Object.entries(actions)) {
    action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
  }
  const footContacts = measureFootContacts(model, mixer, actions);
  for (const name of Object.keys(RUN_JUMPS)) {
    if (jumpClips[name]) jumpClips[name].landing = measureJumpLanding(model, mixer, actions, jumpClips[name].action);
  }
  // Every action the animator advances by hand (see LolaAnimator.advance).
  const timed = [...Object.values(actions), ...Object.values(shooting), ...Object.values(shootingUpper),
    ...Object.values(jumpClips).map(({ action }) => action), ...(reload ? [reload.action] : [])];
  // The moving clips LolaLocomotion keeps on one stride phase.
  const strideActions = new Set(STRIDE_CLIPS.map(name => actions[name]));
  return { model, rig, mixer, actions, footContacts, headBone, hitBone, hitBase: null, flinchBones, shooting, shootingUpper, shotGun, carriedGun,
    jump: jumpClips.jump ?? null, jumpClips, reload, profiles: strideProfiles[weapon], current: 'Idle', timed, posed: -1,
    strideActions, warpRoots, warpLegs, warpSpine, warpSpineTotal, warpBases: [] };
}

// An authored jump clip and a copy of the gun animated with it
// ("<weapon>_<clip>Weapon"), authored in the same root space as the skeleton.
function addJumpGun(model, source, name, weapon) {
  const clip = source.animations.find(item => item.name === name);
  const sourceGun = source.scene.getObjectByName(`${weapon}_${name}Weapon`);
  if (!clip || !sourceGun) throw new Error(`Lola ${name} export is missing its clip or weapon`);
  const gun = sourceGun.clone();
  gun.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
  model.add(gun);
  gun.visible = false;
  return { clip, gun };
}

// The authored reload gun is a separate object animated next to the body. Glue
// it to the right hand instead: sample the clip on its own export rig and keep
// the gun's offset from that hand, so it stays in her grip while she runs.
// The arms come from the converted clip; on the fixed skeleton they hang from
// her chest, so they follow a running lean without any extra re-attaching.
function createReload(model, mixer, source, weapon, rig) {
  const clip = source.animations.find(item => item.name === 'Reload');
  const sourceGun = source.scene.getObjectByName(`${weapon}_ReloadWeapon`);
  const handName = THREE.PropertyBinding.sanitizeNodeName('DEF-hand.R');
  const sourceHand = source.scene.getObjectByName(handName);
  const hand = model.getObjectByName(handName);
  if (!clip || !sourceGun || !sourceHand || !hand) throw new Error('Lola reload export is missing its clip, weapon or hand');
  const upper = rig.convert(clip).clone();
  upper.name = 'ReloadUpper';
  upper.tracks = upper.tracks.filter(track => !LOWER_BODY.test(track.name) && !track.name.startsWith(sourceGun.name));
  const action = mixer.clipAction(upper).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  // The reload's own export rig, posed separately to read the gun-in-hand offset.
  const sourceScene = cloneCharacter(source.scene);
  const sourceMixer = new THREE.AnimationMixer(sourceScene);
  const sourceAction = sourceMixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  sourceAction.clampWhenFinished = true;
  sourceAction.play();
  const gun = sourceGun.clone();
  gun.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
  gun.matrixAutoUpdate = false;
  gun.visible = false;
  hand.add(gun);
  return { action, gun, sourceMixer, sourceScene, sourceGun: sourceScene.getObjectByName(sourceGun.name),
    sourceHand: sourceScene.getObjectByName(handName), duration: clip.duration };
}
