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
// The gun she carries (not fires) for each weapon.
const CARRIED_GUNS = Object.freeze(['M416_Carry', 'Lola_Gun_Basic']);
// Each weapon stowed while the other is out: the rifle slung on her back, the
// pistol holstered at her waist.
const STOWED_GUNS = Object.freeze(['M416', 'Basic_Gun_At_Waist']);
// Guns the pistol outfit export adds to the shared body (the rifle outfit's
// own guns are already on it): the carried pistol, the rifle on her back and
// the pistol's shooting copy.
const GRAFTED_GUNS = Object.freeze(['Lola_Gun_Basic', 'M416', 'basic_ShootingWeapon']);
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

// Build Lola: ONE body, with one "outfit view" per gun (weaponIndex order).
//
// Both outfit exports contain the same seven body meshes, bone names and rest
// pose; the rifle outfit's skeleton has one extra bone (hips, carrying the
// holstered pistol), and only the arm and spine poses differ per gun. So the
// body is built once from the rifle outfit, the pistol outfit's guns are
// grafted onto the same bones, and each view keeps just that gun's clips
// (run, strafe, shots, jumps, reload) and guns. Switching guns swaps which
// view drives the body; there is no second character to keep in step.
//
// The body is added under `parent` (so foot measurements see the real scale);
// its skeleton is re-parented (see LolaRig) and every clip converted to it.
export function prepareOutfits(models, { jumps = [], reloads = [], runJumps = {} }, world, parent) {
  const model = cloneCharacter(models[0].scene);
  // Blender's character faces -Y, which exports as +Z.
  model.scale.set(world.scale, world.scale * ENCOUNTER.lolaHeight, world.scale);
  for (const gltf of models.slice(1)) graftGuns(model, gltf.scene);
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = false;
    }
  });

  // Copies of the guns animated with each authored jump, added before the
  // skeleton is fixed so they move onto her chest with the shooting guns.
  const jumpSources = models.map((_, index) => {
    const weapon = OUTFIT_WEAPONS[index], sources = {};
    if (jumps[index]) sources.jump = addJumpGun(model, jumps[index], 'Jump', weapon);
    for (const [name, files] of Object.entries(runJumps)) {
      if (files?.[index]) sources[name] = addJumpGun(model, files[index], name, weapon);
    }
    return sources;
  });
  // A proper upper-body skeleton: arms, the gun-carrying chest bone and the
  // root-level guns hang from her chest. Every clip is converted to it, so the
  // authored animation looks the same.
  const guns = models.flatMap((_, index) => [`${OUTFIT_WEAPONS[index]}_ShootingWeapon`,
    ...Object.values(jumpSources[index]).map(({ gun }) => gun.name)]);
  const rig = new LolaRig(model, guns);
  const mixer = new THREE.AnimationMixer(model);

  // The body's bones every view shares.
  // The flinch bends these spine joints (see LOLA_FLINCH_SPREAD); hitBone is
  // the lowest, kept under that name for the systems that already read it.
  const flinchBones = LOLA_FLINCH_SPREAD.map(([name, share]) => ({ bone: bone(model, name), share, base: null }))
    .filter(({ bone: item }) => item);
  // The hip twist turns every bone still hanging from the rig itself (after the
  // re-parent: hips, pelvis, thighs and the spine root) and untwists the spine.
  const warpRoots = [];
  model.traverse(item => { if (item.isBone && !item.parent.isBone) warpRoots.push(item); });
  const warpSpine = LOLA_WARP_SPINE.map(([name, share]) => ({ bone: bone(model, name), share })).filter(({ bone: item }) => item);
  const body = {
    model, rig, mixer, flinchBones, warpRoots, warpSpine,
    hitBone: flinchBones[0]?.bone ?? null,
    headBone: bone(model, 'DEF-spine.006'),
    warpLegs: ['DEF-thigh.L', 'DEF-thigh.R'].map(name => bone(model, name)).filter(Boolean),
    warpSpineTotal: warpSpine.reduce((sum, { share }) => sum + share, 0) || 1,
    // Post-pose offsets currently applied to the shared bones.
    hitBase: null, warpBases: [],
  };
  const views = models.map((gltf, index) => prepareView(body, gltf, index, jumpSources[index], reloads[index]));

  // Measure each view's feet on the real (scaled) body, the other views silent.
  parent.add(model);
  for (const view of views) {
    const others = views.filter(item => item !== view).flatMap(item => item.timed);
    const weights = others.map(action => action.getEffectiveWeight());
    others.forEach(action => action.setEffectiveWeight(0));
    view.footContacts = measureFootContacts(model, mixer, view.actions);
    for (const name of Object.keys(RUN_JUMPS)) {
      if (view.jumpClips[name]) view.jumpClips[name].landing = measureJumpLanding(model, mixer, view.actions, view.jumpClips[name].action);
    }
    others.forEach((action, i) => action.setEffectiveWeight(weights[i]));
  }
  return views;
}

// One gun's view of the shared body: its clips (converted to the fixed
// skeleton), its guns, and the stride data its clips were measured with.
function prepareView(body, gltf, index, jumpSources, reloadSource) {
  const { model, rig, mixer } = body;
  const weapon = OUTFIT_WEAPONS[index];
  const authored = (name) => {
    const clip = gltf.animations.find((item) => item.name === name);
    if (!clip) throw new Error(`Lola is missing the ${name} animation`);
    return rig.convert(clip);
  };

  // Locomotion clips, all playing; their weights pick what shows.
  const actions = {};
  for (const name of LOCOMOTION_CLIPS) actions[name] = mixer.clipAction(authored(name));

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

  // Every authored jump by kind: 'jump' plus whichever running jumps loaded.
  // `grip` reads how the clip holds its gun in her right hand, so the gun can
  // hand over smoothly while the jump fades (see LolaAnimator.blendJumpGun).
  const jumpClips = {};
  const rightHand = bone(model, 'DEF-hand.R');
  for (const [kind, { clip, gun }] of Object.entries(jumpSources)) {
    const converted = rig.convert(clip);
    const action = mixer.clipAction(converted).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    jumpClips[kind] = { action, gun, grip: gripSamplers(converted, gun, rightHand) };
  }
  const reload = reloadSource ? createReload(model, mixer, reloadSource, weapon, rig) : null;

  // This gun's objects on the body: in her hands, firing, stowed while the
  // other gun is out, and the copies shown during a jump or reload.
  const shotGun = model.getObjectByName(`${weapon}_ShootingWeapon`);
  const carriedGun = model.getObjectByName(CARRIED_GUNS[index]);
  const stowed = model.getObjectByName(STOWED_GUNS[index]) ?? null;
  const guns = [carriedGun, shotGun, ...Object.values(jumpClips).map(({ gun }) => gun), ...(reload ? [reload.gun] : [])];
  shotGun.visible = false;

  // Start in Idle.
  actions.Idle.play();
  for (const [name, action] of Object.entries(actions)) action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
  // Every action the animator advances by hand (see LolaAnimator.advance).
  const timed = [...Object.values(actions), ...Object.values(shooting), ...Object.values(shootingUpper),
    ...Object.values(jumpClips).map(({ action }) => action), ...(reload ? [reload.action] : [])];
  const view = {
    model, rig, mixer, actions, footContacts: null, shooting, shootingUpper, shotGun, carriedGun, stowed, guns,
    jump: jumpClips.jump ?? null, jumpClips, reload, profiles: strideProfiles[weapon], current: 'Idle', timed, posed: -1,
    // The moving clips LolaLocomotion keeps on one stride phase.
    strideActions: new Set(STRIDE_CLIPS.map(name => actions[name])),
    hitBone: body.hitBone, headBone: body.headBone, flinchBones: body.flinchBones,
    warpRoots: body.warpRoots, warpLegs: body.warpLegs, warpSpine: body.warpSpine, warpSpineTotal: body.warpSpineTotal,
  };
  // Offsets added to the shared bones after the pose belong to the body.
  for (const key of ['hitBase', 'warpBases']) {
    Object.defineProperty(view, key, { get: () => body[key], set: (value) => { body[key] = value; }, enumerable: true });
  }
  return view;
}

// One node's pose in a clip at full weight: samplers for whichever of its
// position, rotation and scale tracks the clip has, and its current (rest)
// values for the rest. Call while the body is still at its rest pose.
function nodeSamplers(clip, node) {
  const samplers = { position: null, quaternion: null, scale: null,
    rest: { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() } };
  for (const track of clip.tracks) {
    const [name, property] = track.name.split('.');
    if (name === node.name && samplers[property] === null) samplers[property] = track.createInterpolant();
  }
  return samplers;
}

// What a jump clip needs to rebuild, at any moment, how it holds its gun in
// her right hand at full weight: the gun's own track and every joint from the
// gun's parent (her chest) down to the hand. Null if the clip does not animate
// the gun or the hand does not hang from the gun's parent.
function gripSamplers(clip, gun, hand) {
  const gunSamplers = nodeSamplers(clip, gun);
  if (!hand || !gunSamplers.position || !gunSamplers.quaternion) return null;
  const chain = [];
  for (let node = hand; node && node !== gun.parent; node = node.parent) chain.unshift(node);
  if (chain[0]?.parent !== gun.parent) return null;
  return { hand, gun: gunSamplers, chain: chain.map(node => nodeSamplers(clip, node)) };
}

// Copy the guns of another outfit export onto the shared body, under the
// same-named bone (or the root) they hang from in that export.
function graftGuns(model, scene) {
  for (const name of GRAFTED_GUNS) {
    const gun = scene.getObjectByName(name);
    if (!gun || model.getObjectByName(name)) continue;
    const parent = gun.parent === scene ? model : model.getObjectByName(gun.parent.name);
    if (!parent) throw new Error(`Lola's body has no ${gun.parent.name} for the ${name}`);
    parent.add(gun.clone());
  }
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
