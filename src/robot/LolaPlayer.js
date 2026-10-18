import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import strideProfiles from '../../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { measureFootContacts, measureJumpLanding, crossedFootContact, footLift } from './footstepContacts.js';

// How quickly Lola's walk/run input eases toward the keys, in units of 1/second.
// Higher feels snappier, lower feels floatier; 16 reaches full speed in ~0.15 s.
const LOLA_INPUT_RESPONSE = 16;
// Authored jump timing (seconds into the 30 fps "Jump Shoot" clip). Feet touch down
// at frame 38; if Lola is running, the rest of the recovery is skipped so she runs on.
const JUMP_LANDING = 38 / 30;
// Feet leave the ground at frame 17. Jumping on the move starts the clip at its
// crouch (frame 10) so the take-off is quick, and Lola only travels while her
// feet are off the ground, so planted feet never slide.
const JUMP_LIFTOFF = 17 / 30;
const JUMP_RUN_START = 10 / 30;
// Playback speed of the plain (standing / strafing) jump; 1.5 = 50% faster than authored.
// The running "Jump to Run" clip plays at its authored speed.
const JUMP_STANDING_SPEED = 1.5;
// The reload clip only drives the upper body, so Lola can run or crouch while
// reloading. Its legs, hips and lower spine come from the normal locomotion.
const RELOAD_LOWER_BODY = /^(hips|DEF-pelvis|DEF-thigh|DEF-shin|DEF-foot|DEF-toe|DEF-spine\.)/;
// The chest bone the reload's shoulders and arms are re-attached to.
const RELOAD_TORSO = 'DEF-spine.003';
const RELOAD_FADE_IN = 0.12;
const RELOAD_FADE_OUT = 0.15;
const JUMP_FADE_IN = 0.08;
const JUMP_FADE_OUT = 0.15;
// Jumps taken mid-run (30 fps clips). Each starts on a matching frame of the
// 24-frame Run cycle (backward ones match the run played in reverse). Gameplay
// keeps the run's travel; the clips only add the lift. After touchdown the
// clips hold a still landing pose, which would skate along the ground, so the
// run takes over the moment the boot lands (see measureJumpLanding).
const RUN_JUMPS = Object.freeze({
  RunJumpRL: { file: 'runjumprl', direction: 1, takeoff: 15 },
  RunJumpLR: { file: 'runjumplr', direction: 1, takeoff: 3 },
  BackJumpLR: { file: 'backjumplr', direction: -1, takeoff: 6 },
  BackJumpRL: { file: 'backjumprl', direction: -1, takeoff: 18 },
});
const RUN_FRAMES = 24;
// How fast Lola's run, sprint and crouch-walk play (and so how fast she travels),
// as multiples of each clip's authored speed. Run and sprint raised 15% on request.
export const LOLA_PACE = Object.freeze({ run: 2.3, sprint: 3.1, crouch: 2 });
// Same playback speed as the plain jump; close to the run's own frame rate.
const RUN_JUMP_SPEED = 1.5;
// Blend from the landing into the run (clip seconds; 0.04 s at 1.5x). Both have
// the same boot planted in the same spot, so a quick blend shows no pop, while
// a slow one mixes the still landing boot with the run's and smears it along.
const RUN_JUMP_FADE_OUT = 0.06;
// Pressing jump a few run frames after the matching one skips that far into the
// clip, never past the push-off.
const RUN_JUMP_MAX_SKIP = 4;

// Pose-speed factor that makes a clip's planted boot move back exactly as fast
// as Lola travels (the stride profile's average speed). Some clips sweep the
// planted boot faster than their average speed (the run's flight phase covers
// no ground in the profile); played unscaled, the boot skates backward.
function strideMatch(profile, contacts) {
  if (!profile?.distance || !contacts?.stanceSpeed) return 1;
  return THREE.MathUtils.clamp(profile.distance / profile.duration / contacts.stanceSpeed, 0.5, 1.5);
}

export class LolaPlayer {
  static async create(scene, world, toggleButton) {
    const loader = new GLTFLoader();
    const lola = name => loader.loadAsync(new URL(`../../assets/characters/lola/lola-${name}.glb`, import.meta.url).href);
    // The outfit models, then the authored jump, reload and running-jump clips
    // (exported separately by scripts/export_lola_clips.py), each per weapon.
    const [m416, basic, jumpM416, jumpBasic, reloadM416, reloadBasic, ...runJumpFiles] = await Promise.all([
      lola('m416'), lola('basic'), lola('jump-m416'), lola('jump-basic'), lola('reload-m416'), lola('reload-basic'),
      ...Object.values(RUN_JUMPS).flatMap(({ file }) => [lola(`${file}-m416`), lola(`${file}-basic`)]),
    ]);
    const runJumps = Object.fromEntries(Object.keys(RUN_JUMPS).map((name, i) => [name, runJumpFiles.slice(2 * i, 2 * i + 2)]));
    return new LolaPlayer(scene, world, toggleButton, [m416, basic], [jumpM416, jumpBasic],
      [reloadM416, reloadBasic], runJumps);
  }

  // jumps (optional): per-outfit glTFs holding a "Jump" clip and its held gun.
  // Without them, jumping falls back to the plain physics hop.
  // reloads (optional): per-outfit glTFs holding a "Reload" clip and its held gun.
  // Without them, reloading still takes time but shows no animation.
  // runJumps (optional): { RunJumpRL: [m416 glTF, basic glTF], ... } for the
  // RUN_JUMPS clips, used when jumping while running forward or backward.
  // Without them, the plain jump plays.
  constructor(scene, world, toggleButton, models, jumps = [], reloads = [], runJumps = {}) {
    this.world = world;
    this.selected = true;
    this.isPlayer = true;
    this.height = 1.9 * world.scale * ENCOUNTER.lolaHeight;
    this.hitRecoilTime = 0;
    this.hitDirection = new THREE.Vector3(0, 0, -1);
    this.mesh = new THREE.Group();
    this.mesh.position.set(world.initialTarget.x, 0, world.initialTarget.z);
    this.direction = new THREE.Vector3();
    this.weaponIndex = 0;
    this.crouching = false;
    this.grounded = true;
    this.verticalVelocity = 0;
    // Smoothed movement input so speed and facing ramp instead of snapping.
    this.inputForward = 0;
    this.inputSide = 0;
    this.toggleButton = toggleButton;
    this.outfits = models.map((gltf, index) => {
      // Blender's character faces -Y, which exports as +Z.
      gltf.scene.scale.set(world.scale, world.scale * ENCOUNTER.lolaHeight, world.scale);
      gltf.scene.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const actions = {};
      for (const name of ['Walk', 'Run', 'Idle', 'CrouchWalk', 'CrouchIdle', 'StrafeLeft', 'StrafeRight']) {
        const clip = gltf.animations.find((item) => item.name === name);
        if (!clip) throw new Error(`Lola is missing the ${name} animation`);
        actions[name] = mixer.clipAction(clip);
      }
      const hitBone = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-spine.001'));
      const headBone = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-spine.006'));
      const shooting = {};
      const shootingUpper = {};
      for (const name of ['Shoot', 'CrouchShoot']) {
        const clip = gltf.animations.find(item => item.name === name);
        if (!clip) throw new Error(`Lola is missing ${name}`);
        shooting[name] = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
        shooting[name].clampWhenFinished = true;
        const upper = clip.clone();
        upper.name = `${name}Upper`;
        upper.tracks = upper.tracks.filter(track => !/^(DEF-spine\.|hips\.|DEF-pelvis|DEF-thigh|DEF-shin|DEF-foot|DEF-toe)/.test(track.name));
        shootingUpper[name] = mixer.clipAction(upper).setLoop(THREE.LoopOnce, 1);
        shootingUpper[name].clampWhenFinished = true;
      }
      const shotGun = gltf.scene.getObjectByName(`${index === 0 ? 'm416' : 'basic'}_ShootingWeapon`);
      const carriedGun = gltf.scene.getObjectByName(index === 0 ? 'M416_Carry' : 'Lola_Gun_Basic');
      shotGun.visible = false;
      const weapon = index === 0 ? 'm416' : 'basic';
      // Every authored jump by kind: 'jump' plus whichever running jumps loaded.
      const jumpClips = {};
      if (jumps[index]) jumpClips.jump = this.createJumpClip(gltf.scene, mixer, jumps[index], 'Jump', weapon);
      for (const [name, files] of Object.entries(runJumps)) {
        if (files?.[index]) jumpClips[name] = this.createJumpClip(gltf.scene, mixer, files[index], name, weapon);
      }
      const reload = reloads[index] ? this.createReload(gltf.scene, mixer, reloads[index], index === 0 ? 'm416' : 'basic') : null;
      actions.Idle.play();
      this.mesh.add(gltf.scene);
      for (const [name, action] of Object.entries(actions)) {
        action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
      }
      const footContacts = measureFootContacts(gltf.scene, mixer, actions);
      for (const name of Object.keys(RUN_JUMPS)) {
        if (jumpClips[name]) jumpClips[name].landing = measureJumpLanding(gltf.scene, mixer, actions, jumpClips[name].action);
      }
      return { model: gltf.scene, mixer, actions, footContacts, headBone, hitBone, hitBase: null, shooting, shootingUpper, shotGun, carriedGun, jump: jumpClips.jump ?? null, jumpClips, reload, profiles: strideProfiles[index === 0 ? 'm416' : 'basic'], current: 'Idle' };
    });
    scene.add(this.mesh);
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      // 1 = basic pistol, 2 = M416 (weaponIndex 1 / 0).
      const pick = { Digit1: 1, Numpad1: 1, Digit2: 0, Numpad2: 0 }[event.code];
      if ((pick === undefined && event.code !== 'KeyC') || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      if (event.code === 'KeyC') {
        if (this.jumpState) return;
        this.cancelShot();
        this.crouching = !this.crouching;
        this.showWeapon();
      }
      else if (pick !== this.weaponIndex) this.switchWeapon();
    });
    this.showWeapon();
  }

  // An authored jump clip and the gun animated with it ("<weapon>_<clip>Weapon").
  createJumpClip(model, mixer, source, name, weapon) {
    const clip = source.animations.find(item => item.name === name);
    const gun = source.scene.getObjectByName(`${weapon}_${name}Weapon`);
    if (!clip || !gun) throw new Error(`Lola ${name} export is missing its clip or weapon`);
    gun.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
    // Authored in the same root space as the outfit's skeleton.
    model.add(gun);
    gun.visible = false;
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    return { action, gun };
  }

  // The authored reload gun is a separate object animated next to the body. Glue
  // it to the right hand instead: sample the clip on its own export rig and keep
  // the gun's offset from that hand, so it stays in her grip while she runs.
  createReload(model, mixer, source, weapon) {
    const clip = source.animations.find(item => item.name === 'Reload');
    const sourceGun = source.scene.getObjectByName(`${weapon}_ReloadWeapon`);
    const handName = THREE.PropertyBinding.sanitizeNodeName('DEF-hand.R');
    const sourceHand = source.scene.getObjectByName(handName);
    const hand = model.getObjectByName(handName);
    if (!clip || !sourceGun || !sourceHand || !hand) throw new Error('Lola reload export is missing its clip, weapon or hand');
    // Shoulders and upper arms hang from the skeleton's root, not the spine, so
    // their reload transforms are fixed to the reload's own upright torso. Over a
    // run's forward lean they would poke out of her clothes; instead they are
    // re-attached to her actual chest each frame (see attachReloadArms).
    const tracked = new Set(clip.tracks.map(track => track.name.split('.')[0]));
    const attached = [];
    model.traverse(bone => {
      if (bone.isBone && !bone.parent.isBone && tracked.has(bone.name) && !RELOAD_LOWER_BODY.test(`${bone.name}.`)) {
        attached.push({ bone, source: source.scene.getObjectByName(bone.name) });
      }
    });
    const torsoName = THREE.PropertyBinding.sanitizeNodeName(RELOAD_TORSO);
    const torso = model.getObjectByName(torsoName), sourceTorso = source.scene.getObjectByName(torsoName);
    const upper = clip.clone();
    upper.name = 'ReloadUpper';
    upper.tracks = upper.tracks.filter(track => !RELOAD_LOWER_BODY.test(track.name) && !track.name.startsWith(sourceGun.name)
      && !attached.some(({ bone }) => track.name.startsWith(`${bone.name}.`)));
    const action = mixer.clipAction(upper).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    const sourceMixer = new THREE.AnimationMixer(source.scene);
    const sourceAction = sourceMixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    sourceAction.clampWhenFinished = true;
    sourceAction.play();
    const gun = sourceGun.clone();
    gun.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
    gun.matrixAutoUpdate = false;
    gun.visible = false;
    hand.add(gun);
    return { action, gun, sourceMixer, sourceScene: source.scene, sourceGun, sourceHand, duration: clip.duration,
      attached, torso, sourceTorso };
  }

  // Pose the root-level shoulder/arm bones as the reload has them relative to its
  // chest, but relative to her current (running) chest, blended in by weight.
  // Call after placeReloadGun has posed the reload's own rig.
  attachReloadArms(outfit, weight) {
    const reload = outfit.reload;
    if (!reload.torso || !reload.sourceTorso || weight <= 0) return;
    const m = this.reloadMatrices ??= Array.from({ length: 4 }, () => new THREE.Matrix4());
    const [toModel, chest, relative, local] = m;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    outfit.model.updateMatrixWorld(true);
    toModel.copy(outfit.model.matrixWorld).invert();
    chest.multiplyMatrices(toModel, reload.torso.matrixWorld);
    // Source rig: torso-relative transform of each bone.
    const sourceChestInverse = relative.copy(reload.sourceTorso.matrixWorld).invert();
    for (const { bone, source } of reload.attached) {
      if (!source) continue;
      local.multiplyMatrices(sourceChestInverse, source.matrixWorld); // bone relative to the reload's chest
      local.premultiply(chest); // ...placed on her chest, in model space
      const parent = new THREE.Matrix4().multiplyMatrices(toModel, bone.parent.matrixWorld).invert();
      local.premultiply(parent); // ...as the bone's own local transform
      local.decompose(p, q, s);
      bone.position.lerp(p, weight);
      bone.quaternion.slerp(q, weight);
      bone.scale.lerp(s, weight);
    }
  }

  // Seconds the authored reload takes, or null without reload clips.
  get reloadDuration() { return this.outfits[this.weaponIndex].reload?.duration ?? null; }

  get reloading() { return !!this.reloadState; }

  startReload() {
    if (this.defeated || this.jumpState) return false;
    this.cancelShot();
    this.cancelReload();
    const outfit = this.outfits[this.weaponIndex];
    if (!outfit.reload) return true;
    this.reloadState = { outfit, elapsed: 0 };
    outfit.reload.action.reset().setEffectiveWeight(0).play();
    outfit.reload.gun.visible = true;
    outfit.carriedGun.visible = false;
    this.placeReloadGun(outfit, 0);
    return true;
  }

  cancelReload() {
    if (!this.reloadState) return;
    const { outfit } = this.reloadState;
    this.reloadState = null;
    outfit.reload.action.stop();
    outfit.reload.gun.visible = false;
    outfit.carriedGun.visible = true;
  }

  // Blend weight of the reload: quick fade in, short fade out at the end.
  reloadWeight() {
    const state = this.reloadState;
    if (!state) return 0;
    const end = state.outfit.reload.duration;
    return Math.max(0, Math.min(1, state.elapsed / RELOAD_FADE_IN, (end - state.elapsed) / RELOAD_FADE_OUT));
  }

  placeReloadGun(outfit, time) {
    const reload = outfit.reload;
    reload.sourceMixer.setTime(time);
    reload.sourceScene.updateMatrixWorld(true);
    reload.gun.matrix.copy(reload.sourceHand.matrixWorld).invert().multiply(reload.sourceGun.matrixWorld);
    reload.gun.matrixWorldNeedsUpdate = true;
  }

  showWeapon() {
    this.outfits.forEach((outfit, index) => { outfit.model.visible = index === this.weaponIndex; });
    this.toggleButton.textContent = `${this.weaponIndex === 0 ? '2: M416' : '1: BASIC GUN'} · C: ${this.crouching ? 'CROUCHED' : 'STANDING'}`;
    this.toggleButton.classList.add('on');
  }

  switchWeapon() {
    this.cancelShot();
    this.cancelReload();
    this.weaponIndex = 1 - this.weaponIndex;
    this.showWeapon();
  }

  reactToHit(incomingDirection = null) {
    if (this.defeated) return;
    this.cancelShot();
    // A bolt's travel direction points away from the side that was struck.
    // Store world space so turning during recovery does not reverse the flinch.
    if (incomingDirection) this.hitDirection.copy(incomingDirection);
    else this.hitDirection.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
    this.hitDirection.y = 0;
    if (this.hitDirection.lengthSq() < 1e-8) {
      this.hitDirection.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
    }
    this.hitDirection.normalize();
    this.hitRecoilTime = ENCOUNTER.hitRecoilDuration;
  }

  clearHitReaction() {
    this.hitRecoilTime = 0;
    for (const outfit of this.outfits) {
      if (outfit.hitBase) outfit.hitBone.quaternion.copy(outfit.hitBase);
      outfit.hitBase = null;
    }
  }

  startShot(duration = 1, hold = 0) {
    if (this.defeated || !this.grounded || this.jumpState || this.reloadState) return false;
    this.cancelShot();
    this.clearHitReaction();
    const outfit = this.outfits[this.weaponIndex];
    const action = outfit.shooting[this.crouching ? 'CrouchShoot' : 'Shoot'];
    action.reset().setEffectiveTimeScale(action.getClip().duration / duration).setEffectiveWeight(1).play();
    this.shot = { outfit, action, name: this.crouching ? 'CrouchShoot' : 'Shoot', elapsed: 0, duration, hold };
    outfit.shotGun.visible = true;
    outfit.carriedGun.visible = false;
    const weights = Object.values(outfit.actions).map(action => action.getEffectiveWeight());
    for (const action of Object.values(outfit.actions)) action.setEffectiveWeight(0);
    outfit.mixer.update(0);
    Object.values(outfit.actions).forEach((action, i) => action.setEffectiveWeight(weights[i]));
    return true;
  }

  holdAim() {
    if (this.shot || this.hitRecoilTime > 0 || !this.startShot()) return;
    // The authored first frame is the raised-gun pose; aiming alone has no recoil.
    this.shot.action.paused = true;
  }

  cancelShot() {
    if (!this.shot) return;
    const { outfit, action } = this.shot;
    action.stop();
    outfit.shotGun.visible = false;
    outfit.carriedGun.visible = true;
    // Locomotion weights kept advancing underneath the shooting pose.
    this.shot = null;
  }

  eyePosition(out = new THREE.Vector3()) {
    this.mesh.updateMatrixWorld(true);
    this.outfits[this.weaponIndex].headBone.getWorldPosition(out);
    // The head bone starts below the eyes; follow its animated crouch/jump height.
    out.y += this.height * 0.06;
    return out;
  }

  muzzlePosition() {
    const gun = this.outfits[this.weaponIndex].shotGun;
    this.mesh.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const points = [], vertex = new THREE.Vector3();
    let furthest = -Infinity;
    const positions = gun.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(gun.matrixWorld);
      furthest = Math.max(furthest, vertex.dot(forward));
      points.push(vertex.clone());
    }
    const tip = points.filter(point => furthest - point.dot(forward) < 0.015 * this.world.scale);
    return tip.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / tip.length);
  }

  toggle() { /* Lola remains controllable while the Leaper is paused. */ }
  setSelected() { this.selected = true; }

  jump() {
    if (this.defeated || !this.grounded || this.jumpState) return false;
    this.cancelShot();
    // The jump clip moves both hands too, so it interrupts a reload (the weapon
    // restarts the reload after landing).
    this.cancelReload();
    this.crouching = false;
    if (this.outfits.every(outfit => outfit.jump)) {
      // The authored clip carries the crouch, lift and landing itself, so Lola
      // stays on the ground physically and keeps her run momentum underneath.
      const moving = Math.hypot(this.inputForward, this.inputSide) > 0.1;
      const start = moving ? JUMP_RUN_START : 0;
      this.jumpState = this.runningJump() ?? { kind: 'jump', rate: JUMP_STANDING_SPEED, start, elapsed: start,
        liftoff: JUMP_LIFTOFF, landing: JUMP_LANDING, end: this.outfits[0].jump.action.getClip().duration };
      const { kind } = this.jumpState;
      for (const outfit of this.outfits) {
        const clip = outfit.jumpClips[kind];
        clip.action.reset().setEffectiveTimeScale(this.jumpState.rate).setEffectiveWeight(0).play();
        clip.action.time = this.jumpState.start;
        clip.gun.visible = true;
        outfit.carriedGun.visible = false;
      }
    } else {
      this.grounded = false;
      this.verticalVelocity = Math.sqrt(2 * 14 * 0.85) * this.world.scale;
    }
    this.showWeapon();
    return true;
  }

  // Running forward or backward: the running jump whose take-off matches the
  // foot that is forward right now, or null (strafing, standing, not loaded).
  runningJump() {
    const forward = this.inputForward, side = Math.abs(this.inputSide);
    const direction = forward > 0.3 && forward >= side ? 1 : forward < -0.3 && -forward >= side ? -1 : 0;
    if (!direction) return null;
    const run = this.outfits[this.weaponIndex].actions.Run;
    const duration = run.getClip().duration;
    const frame = 1 + ((run.time / duration) % 1 + 1) % 1 * RUN_FRAMES;
    // Run frames since each take-off frame, in the run's playback direction
    // (negative = not reached yet), wrapped to half a cycle either way.
    const wrap = value => ((value % RUN_FRAMES) + RUN_FRAMES * 1.5) % RUN_FRAMES - RUN_FRAMES / 2;
    let best = null;
    for (const [kind, jump] of Object.entries(RUN_JUMPS)) {
      if (jump.direction !== direction || !this.outfits.every(outfit => outfit.jumpClips[kind]?.landing)) continue;
      const past = wrap((frame - jump.takeoff) * direction);
      if (!best || Math.abs(past) < Math.abs(best.past)) best = { kind, past };
    }
    if (!best) return null;
    const start = THREE.MathUtils.clamp(best.past, 0, RUN_JUMP_MAX_SKIP) / 30;
    const outfit = this.outfits[this.weaponIndex];
    const { liftoff, touchdown, takeoffSpeed } = outfit.jumpClips[best.kind].landing;
    // Her travel speed in model units per second, as the run moves her.
    const profile = outfit.profiles.Run;
    const travel = profile.distance / profile.duration * (this.runPace ?? 2) * Math.min(1, Math.abs(forward));
    const takeoffRate = takeoffSpeed ? THREE.MathUtils.clamp(travel / takeoffSpeed, 0.5, RUN_JUMP_SPEED) : RUN_JUMP_SPEED;
    // Ends with a short blend into the run starting the moment the boot lands.
    return { kind: best.kind, running: true, direction, rate: RUN_JUMP_SPEED, takeoffRate, start, elapsed: start,
      liftoff, landing: touchdown, end: touchdown + RUN_JUMP_FADE_OUT, fadeOut: RUN_JUMP_FADE_OUT, handedBack: false };
  }

  // At touchdown, put the run underneath on the moment its stride has the same
  // boot planted in the same spot, so the blend back never slides that boot.
  handRunBack(state) {
    for (const outfit of this.outfits) {
      const run = outfit.actions.Run;
      run.time = outfit.jumpClips[state.kind].landing.runTime;
      outfit.current = 'Run';
    }
    state.handedBack = true;
  }

  // Blend weight of the authored jump: quick fade in, short fade out at the end.
  jumpWeight() {
    const state = this.jumpState;
    if (!state) return 0;
    return Math.max(0, Math.min(1, (state.elapsed - state.start) / JUMP_FADE_IN, (state.end - state.elapsed) / (state.fadeOut ?? JUMP_FADE_OUT)));
  }

  // Share of normal travel speed during the jump: none while the authored feet
  // are planted (crouch and landing), full while airborne.
  jumpTravel() {
    const state = this.jumpState;
    // A running jump never plants both feet to push off; she keeps running speed.
    if (!state || state.running) return 1;
    const t = state.elapsed;
    const air = THREE.MathUtils.smoothstep(t, JUMP_LIFTOFF - 3 / 30, JUMP_LIFTOFF + 1 / 30)
      * (1 - THREE.MathUtils.smoothstep(t, JUMP_LANDING - 1 / 30, JUMP_LANDING + 2 / 30));
    return 1 - this.jumpWeight() * (1 - air);
  }

  endJump() {
    if (!this.jumpState) return;
    const { kind } = this.jumpState;
    this.jumpState = null;
    for (const outfit of this.outfits) {
      outfit.jumpClips[kind].action.stop();
      outfit.jumpClips[kind].gun.visible = false;
      outfit.carriedGun.visible = true;
    }
  }

  resetJump() {
    this.endJump();
    this.grounded = true;
    this.verticalVelocity = 0;
    this.mesh.position.y = 0;
  }

  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (this.defeated) return;
    // Ease the requested input so starts, stops, and direction changes
    // accelerate smoothly instead of snapping between full speed and zero.
    const steps = Math.max(1, Math.ceil(deltaTime * 120));
    const ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime / steps);
    for (let i = 0; i < steps; i += 1) {
      this.inputForward += (forwardAmount - this.inputForward) * ease;
      this.inputSide += (sideAmount - this.inputSide) * ease;
      if (forwardAmount === 0 && sideAmount === 0
          && Math.hypot(this.inputForward, this.inputSide) < 0.02) {
        this.inputForward = 0;
        this.inputSide = 0;
      }
      this.moveStep(this.inputForward, this.inputSide, forward, right, speed, deltaTime / steps);
    }
  }

  moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (!this.grounded) {
      const gravity = 14 * this.world.scale;
      this.mesh.position.y += this.verticalVelocity * deltaTime - 0.5 * gravity * deltaTime ** 2;
      this.verticalVelocity -= gravity * deltaTime;
      if (this.mesh.position.y <= 0) this.resetJump();
    }
    this.direction.copy(forward).multiplyScalar(forwardAmount).addScaledVector(right, sideAmount);
    const inputStrength = Math.min(1, this.direction.length());
    this.direction.normalize();
    // Shooter controls: Lola always faces the camera's forward direction, so the
    // camera stays at her back. S backpedals and A/D strafe instead of turning her.
    const heading = Math.atan2(forward.x, forward.z);
    const turn = Math.atan2(Math.sin(heading - this.mesh.rotation.y), Math.cos(heading - this.mesh.rotation.y));
    this.mesh.rotation.y += THREE.MathUtils.clamp(turn, -9 * deltaTime, 9 * deltaTime);
    const sprint = speed > 5 && !this.crouching;
    this.runPace = sprint ? LOLA_PACE.sprint : LOLA_PACE.run;
    const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);
    const next = this.crouching ? (inputStrength ? 'CrouchWalk' : 'CrouchIdle')
      : inputStrength ? (sideways ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run') : 'Idle';
    if (this.jumpState) {
      const state = this.jumpState;
      // elapsed is clip time, so every authored frame timing below still applies.
      const before = state.elapsed;
      // A running jump's push-off plays at the speed that keeps the planted boot
      // still under her run speed; the air and landing at the normal jump speed.
      const rate = state.running && state.elapsed < state.liftoff ? state.takeoffRate : state.rate;
      state.elapsed += deltaTime * rate;
      for (const outfit of this.outfits) outfit.jumpClips[state.kind].action.timeScale = rate;
      // The run's own footsteps are muted mid-jump; the push-off and touchdown
      // frames get a step each instead, so the sound follows the authored feet.
      for (const moment of [state.liftoff, state.landing]) {
        if (before < moment && state.elapsed >= moment) this.onFootstep?.('walk', false);
      }
      if (state.running && !state.handedBack && state.elapsed >= state.landing) this.handRunBack(state);
      // Running after a plain jump's touchdown: skip the standing recovery and blend straight back.
      if (!state.running && inputStrength && state.elapsed >= JUMP_LANDING && state.end > state.elapsed + JUMP_FADE_OUT) {
        state.end = state.elapsed + JUMP_FADE_OUT;
      }
      if (state.elapsed >= state.end) this.endJump();
    }
    if (this.reloadState) {
      this.reloadState.elapsed += deltaTime;
      if (this.reloadState.elapsed >= this.reloadState.outfit.reload.duration) this.cancelReload();
    }
    const jumpWeight = this.jumpWeight();
    const reloadWeight = this.reloadWeight();
    let distance = 0;
    for (const [index, outfit] of this.outfits.entries()) {
      if (this.grounded && outfit.current !== next) {
        const previous = outfit.actions[outfit.current];
        outfit.actions[next].time = previous.time / previous.getClip().duration * outfit.actions[next].getClip().duration;
        outfit.current = next;
      }
      let floor = 0, lift = 0;
      for (const [name, action] of Object.entries(outfit.actions)) {
        const oldWeight = action.getEffectiveWeight();
        const weight = this.grounded
          ? THREE.MathUtils.lerp(oldWeight, name === next ? 1 : 0, 1 - Math.exp(-12 * deltaTime)) : oldWeight;
        action.setEffectiveWeight(weight);
        const pace = name.startsWith('Crouch') ? LOLA_PACE.crouch : this.runPace;
        const rate = name.startsWith('Strafe') ? pace
          : name.includes('Idle') ? 1 : pace * (forwardAmount < 0 ? -1 : 1);
        action.timeScale = name.includes('Idle') ? 1 : rate * inputStrength;
        if (!this.grounded) action.timeScale = 0;
        const profile = outfit.profiles[name];
        // Travel at the clip's average speed. Following the feet exactly stalls
        // Lola (and the camera locked to her) at every foot handoff.
        const advance = Math.abs(deltaTime * action.timeScale);
        // Play the pose at the rate where the planted boot sweeps back exactly as
        // fast as she travels, so it stays put on the ground.
        if (!name.includes('Idle')) action.timeScale *= strideMatch(profile, outfit.footContacts[name]);
        if (index === this.weaponIndex && inputStrength && profile.duration && !name.includes('Idle')) {
          distance += profile.distance / profile.duration * advance * (oldWeight + weight) / 2;
        }
        floor += profile.groundOffset * weight;
        lift += footLift(outfit.footContacts[name], action.time) * weight;
      }
      // Each clip's measured floor offset, minus how far its lower boot is lifted at
      // this moment (already in world units), so the run never hovers between steps.
      // The junkyard floor sits slightly below y = 0; stand on it, not above it.
      outfit.model.position.y = floor * this.world.scale * ENCOUNTER.lolaHeight - lift + (this.world.floorHeight ?? 0);
    }
    if (!this.grounded) {
      const profile = this.outfits[this.weaponIndex].profiles[sideways
        ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run'];
      distance = profile.distance / profile.duration * this.runPace * inputStrength * deltaTime;
    }
    distance *= this.world.scale * this.jumpTravel();
    const startX = this.mesh.position.x;
    const startZ = this.mesh.position.z;
    // Short steps and axis sliding keep Lola out of walls, including at corners.
    const steps = Math.max(1, Math.ceil(distance / (0.08 * this.world.scale)));
    for (let step = 0; step < steps; step += 1) {
      const dx = this.direction.x * distance / steps;
      const dz = this.direction.z * distance / steps;
      const p = this.mesh.position;
      if (!this.world.playerBlocked(p.x + dx, p.z)) p.x += dx;
      if (!this.world.playerBlocked(p.x, p.z + dz)) p.z += dz;
    }
    const moved = Math.hypot(this.mesh.position.x - startX, this.mesh.position.z - startZ);
    const p = this.mesh.position;
    const blockedAhead = inputStrength && this.world.playerBlocked(
      p.x + this.direction.x * 0.01 * this.world.scale,
      p.z + this.direction.z * 0.01 * this.world.scale);
    const progress = distance > 1e-8 ? Math.min(1, moved / distance) : blockedAhead ? 0 : 1;
    this.hitRecoilTime = Math.max(0, this.hitRecoilTime - deltaTime);
    for (const outfit of this.outfits) {
      if (outfit.hitBase) outfit.hitBone.quaternion.copy(outfit.hitBase);
      outfit.hitBase = null;
      for (const [name, action] of Object.entries(outfit.actions)) {
        if (!name.includes('Idle')) action.timeScale *= progress;
      }
      const shot = this.shot?.outfit === outfit ? this.shot : null;
      if (shot) {
        const upperOnly = moved > 1e-7;
        const action = (upperOnly ? outfit.shootingUpper : outfit.shooting)[shot.name];
        if (shot.action !== action) {
          const previous = shot.action;
          const time = previous.time, paused = previous.paused;
          previous.stop();
          action.reset().setEffectiveTimeScale(action.getClip().duration / shot.duration).setEffectiveWeight(1).play();
          action.time = time; action.paused = paused;
          shot.action = action;
        }
        shot.upperOnly = upperOnly;
      }
      const stepAction = outfit.actions[outfit.current];
      if (outfit === this.outfits[this.weaponIndex] && this.grounded && jumpWeight < 0.5 && moved > 1e-7 && (!shot || shot.upperOnly)
          && crossedFootContact(outfit.footContacts[outfit.current], stepAction.time, deltaTime * stepAction.timeScale)) {
        this.onFootstep?.(sprint ? 'run' : 'walk', this.crouching);
      }
      const weights = Object.values(outfit.actions).map(action => action.getEffectiveWeight());
      if (shot) {
        shot.elapsed += deltaTime;
        if (!shot.upperOnly) Object.values(outfit.actions).forEach(action => action.setEffectiveWeight(0));
      }
      if (jumpWeight > 0) {
        // The jump replaces the locomotion pose; locomotion keeps advancing underneath.
        Object.values(outfit.actions).forEach((action, i) => action.setEffectiveWeight(weights[i] * (1 - jumpWeight)));
        outfit.jumpClips[this.jumpState.kind].action.setEffectiveWeight(jumpWeight);
      }
      const reloading = this.reloadState?.outfit === outfit;
      if (reloading) {
        // The mixer normalises weights per bone, so to show the reload at share w
        // on the arms over the running pose (total weight L) it needs w·L / (1 − w).
        // Legs have no reload track and keep running at full weight.
        const locomotion = Object.values(outfit.actions).reduce((sum, action) => sum + action.getEffectiveWeight(), 0) || 1;
        outfit.reload.action.setEffectiveWeight(reloadWeight >= 0.999 ? 1000 * locomotion
          : reloadWeight * locomotion / (1 - reloadWeight));
      }
      outfit.mixer.update(deltaTime);
      if (reloading) {
        this.placeReloadGun(outfit, outfit.reload.action.time);
        this.attachReloadArms(outfit, reloadWeight);
      }
      if (this.hitRecoilTime > 0 && outfit.hitBone) {
        const t = 1 - this.hitRecoilTime / ENCOUNTER.hitRecoilDuration;
        // Flinch away from impact, then recover; no root knockback into cover.
        const peak = ENCOUNTER.hitRecoilPeak;
        const strength = t < peak ? Math.sin(Math.PI * 0.5 * t / peak)
          : Math.sin(Math.PI * 0.5 * (1 - t) / (1 - peak));
        outfit.hitBase = outfit.hitBone.quaternion.clone();
        this.mesh.updateMatrixWorld(true);
        const parentRotation = outfit.hitBone.parent.getWorldQuaternion(new THREE.Quaternion());
        const axis = new THREE.Vector3(0, 1, 0).cross(this.hitDirection)
          .applyQuaternion(parentRotation.invert()).normalize();
        outfit.hitBone.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(axis, ENCOUNTER.hitRecoilAngle * strength));
      }
      if (shot || jumpWeight > 0) Object.values(outfit.actions).forEach((action, i) => action.setEffectiveWeight(weights[i]));
      if (shot) {
        if (shot.elapsed >= shot.duration + shot.hold && !this.aimHeld) this.cancelShot();
      }
    }
  }
}
