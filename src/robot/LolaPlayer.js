import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { crossedFootContact } from './footstepContacts.js';
import { loadLolaAssets, prepareOutfit } from '../actors/lola/LolaAssets.js';
import { LolaLocomotion } from '../actors/lola/LolaLocomotion.js';
import { LolaAnimator } from '../actors/lola/LolaAnimator.js';
import { LolaActionState } from '../actors/lola/LolaActionState.js';
import { CharacterMover } from '../actors/lola/CharacterMover.js';
import {
  JUMP_FADE_IN, JUMP_FADE_OUT, JUMP_LANDING, JUMP_LIFTOFF, JUMP_RUN_START, JUMP_STANDING_SPEED,
  LOLA_GRAVITY, LOLA_HOP_HEIGHT, LOLA_INPUT_RESPONSE, LOLA_PACE, LOLA_SPRINT_SPEED, LOLA_SUBSTEP_RATE, LOLA_TURN_RATE,
  RELOAD_FADE_IN, RELOAD_FADE_OUT, RUN_FRAMES, RUN_JUMPS, RUN_JUMP_FADE_OUT, RUN_JUMP_MAX_SKIP, RUN_JUMP_SPEED,
} from '../actors/lola/lolaTuning.js';

export { LOLA_PACE };

// Lola, the player character. This class is the public face other systems use
// (weapon, combat, camera, brain, eye vision); the work happens in parts:
//   LolaAssets       loads and copies the 14 exported files into two outfits
//   LolaLocomotion   eased input, which clip plays, stride speed, floor height
//   LolaAnimator     clip clocks and the layered pose (base, jump, shot, reload, flinch)
//   LolaActionState  the rules for which actions can start when
//   CharacterMover   collision with the map and the Leaper
export class LolaPlayer {
  static async create(scene, world, toggleButton) {
    const { models, jumps, reloads, runJumps } = await loadLolaAssets();
    return new LolaPlayer(scene, world, toggleButton, models, jumps, reloads, runJumps);
  }

  // models: [m416 glTF, basic glTF] outfits.
  // jumps (optional): per-outfit glTFs holding a "Jump" clip and its held gun.
  // Without them, jumping falls back to the plain physics hop.
  // reloads (optional): per-outfit glTFs holding a "Reload" clip and its held gun.
  // Without them, reloading still takes time but shows no animation.
  // runJumps (optional): { RunJumpRL: [m416 glTF, basic glTF], ... } for the
  // RUN_JUMPS clips, used when jumping while running forward or backward.
  // Without them, the plain jump plays.
  constructor(scene, world, toggleButton, models, jumps = [], reloads = [], runJumps = {}) {
    // What the rest of the game reads.
    this.world = world;
    this.selected = true;
    this.isPlayer = true;
    this.defeated = false;
    this.aimHeld = false;
    this.height = 1.9 * world.scale * ENCOUNTER.lolaHeight;
    this.mesh = new THREE.Group();
    this.mesh.position.set(world.initialTarget.x, 0, world.initialTarget.z);
    this.weaponIndex = 0;
    this.crouching = false;
    this.grounded = true;
    this.verticalVelocity = 0;
    this.hitRecoilTime = 0;
    this.hitDirection = new THREE.Vector3(0, 0, -1);
    this.shot = null;
    this.jumpState = null;
    this.reloadState = null;
    // World-space travel direction of the current sub-step.
    this.direction = new THREE.Vector3();

    // The parts that do the work.
    this.locomotion = new LolaLocomotion();
    this.animator = new LolaAnimator();
    this.actionState = new LolaActionState(this);
    this.mover = new CharacterMover();
    // What each action ends when it starts (see LOLA_ACTION_RULES).
    this.enders = {
      shoot: () => this.cancelShot(),
      reload: () => this.cancelReload(),
      hit: () => this.clearHitReaction(),
      crouch: () => { this.crouching = false; },
    };
    // Counts move() calls, so a stale outfit pose can be refreshed on demand.
    this.poseClock = 0;

    // Both outfits, built from copies of the loaded files.
    this.outfits = models.map((gltf, index) => prepareOutfit(gltf, index, { jumps, reloads, runJumps }, world, this.mesh));
    scene.add(this.mesh);

    // The on-screen weapon button and the C / 1 / 2 keys.
    this.toggleButton = toggleButton;
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      // 1 = basic pistol, 2 = M416 (weaponIndex 1 / 0).
      const pick = { Digit1: 1, Numpad1: 1, Digit2: 0, Numpad2: 0 }[event.code];
      if ((pick === undefined && event.code !== 'KeyC') || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      if (event.code === 'KeyC') this.toggleCrouch();
      else if (pick !== this.weaponIndex) this.switchWeapon();
    });
    this.showWeapon();
  }

  // ---- State other systems read ------------------------------------------

  // The outfit for the gun in her hands; only this one is animated and shown.
  get equipped() { return this.outfits[this.weaponIndex]; }

  // Smoothed movement input (tests and the running-jump picker read and preset it).
  get inputForward() { return this.locomotion.inputForward; }
  set inputForward(value) { this.locomotion.inputForward = value; }
  get inputSide() { return this.locomotion.inputSide; }
  set inputSide(value) { this.locomotion.inputSide = value; }
  get runPace() { return this.locomotion.runPace; }

  // Can a jump start right now? The jump key's buffer should wait for this.
  get canJump() { return this.actionState.can('jump'); }

  // Seconds the authored reload takes, or null without reload clips.
  get reloadDuration() { return this.equipped.reload?.duration ?? null; }

  get reloading() { return !!this.reloadState; }

  // Lola remains controllable while the Leaper is paused; these keep the old
  // pink-target interface the sandbox modes call.
  toggle() {}
  setSelected() { this.selected = true; }

  // ---- Weapons, crouch and the HUD button ---------------------------------

  showWeapon() {
    this.outfits.forEach((outfit, index) => {
      outfit.model.visible = index === this.weaponIndex;
      // A put-away outfit is no longer animated; drop its flinch offset and
      // pose it afresh when it is shown again.
      if (outfit.model.visible || !outfit.hitBase) return;
      outfit.hitBone.quaternion.copy(outfit.hitBase);
      outfit.hitBase = null;
      outfit.posed = -1;
    });
    this.toggleButton.textContent = `${this.weaponIndex === 0 ? '2: M416' : '1: BASIC GUN'} · C: ${this.crouching ? 'CROUCHED' : 'STANDING'}`;
    this.toggleButton.classList.add('on');
    // The newly shown outfit may not have been posed since it was put away.
    this.ensurePosed();
  }

  switchWeapon() {
    if (!this.actionState.begin('weapon', this.enders)) return;
    this.weaponIndex = 1 - this.weaponIndex;
    this.showWeapon();
  }

  toggleCrouch() {
    if (!this.actionState.begin('crouch', this.enders)) return;
    this.crouching = !this.crouching;
    this.showWeapon();
  }

  // ---- Reload --------------------------------------------------------------

  startReload() {
    if (!this.actionState.begin('reload', this.enders)) return false;
    const outfit = this.equipped;
    if (!outfit.reload) return true;
    this.reloadState = { outfit, elapsed: 0 };
    outfit.reload.action.reset().setEffectiveWeight(0).play();
    outfit.reload.gun.visible = true;
    outfit.carriedGun.visible = false;
    this.animator.placeReloadGun(outfit, 0);
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

  // ---- Getting hit ----------------------------------------------------------

  reactToHit(incomingDirection = null) {
    if (!this.actionState.begin('hit', this.enders)) return;
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

  // How far into the flinch she is, 0..1 (sharp bend, slower recovery).
  flinchStrength() {
    const t = 1 - this.hitRecoilTime / ENCOUNTER.hitRecoilDuration;
    const peak = ENCOUNTER.hitRecoilPeak;
    return t < peak ? Math.sin(Math.PI * 0.5 * t / peak) : Math.sin(Math.PI * 0.5 * (1 - t) / (1 - peak));
  }

  // ---- Shooting and aiming --------------------------------------------------

  startShot(duration = 1, hold = 0) {
    if (!this.actionState.begin('shoot', this.enders)) return false;
    const outfit = this.equipped;
    const name = this.crouching ? 'CrouchShoot' : 'Shoot';
    const action = outfit.shooting[name];
    action.reset().setEffectiveTimeScale(action.getClip().duration / duration).setEffectiveWeight(1).play();
    this.shot = { outfit, action, name, elapsed: 0, duration, hold };
    outfit.shotGun.visible = true;
    outfit.carriedGun.visible = false;
    // Show the raised gun at once, so a shot fired this frame leaves the muzzle.
    this.poseOutfit(outfit);
    return true;
  }

  holdAim() {
    if (!this.actionState.can('aim') || !this.startShot()) return;
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

  // While moving, the shot plays on the upper body only (legs keep running);
  // standing still it replaces the whole pose. Swap variants on the same frame.
  updateShotVariant(shot, moved) {
    const upperOnly = moved > 1e-7;
    const action = (upperOnly ? shot.outfit.shootingUpper : shot.outfit.shooting)[shot.name];
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

  eyePosition(out = new THREE.Vector3()) {
    this.ensurePosed();
    this.mesh.updateMatrixWorld(true);
    this.equipped.headBone.getWorldPosition(out);
    // The head bone starts below the eyes; follow its animated crouch/jump height.
    out.y += this.height * 0.06;
    return out;
  }

  muzzlePosition() {
    this.ensurePosed();
    const gun = this.equipped.shotGun;
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

  // ---- Jumping ----------------------------------------------------------------

  jump() {
    if (!this.actionState.begin('jump', this.enders)) return false;
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
      this.verticalVelocity = Math.sqrt(2 * LOLA_GRAVITY * LOLA_HOP_HEIGHT) * this.world.scale;
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
    const run = this.equipped.actions.Run;
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
    const outfit = this.equipped;
    const { liftoff, touchdown, takeoffSpeed } = outfit.jumpClips[best.kind].landing;
    // Her travel speed in model units per second, as the run moves her.
    const profile = outfit.profiles.Run;
    const travel = profile.distance / profile.duration * this.runPace * Math.min(1, Math.abs(forward));
    const takeoffRate = takeoffSpeed ? THREE.MathUtils.clamp(travel / takeoffSpeed, 0.5, RUN_JUMP_SPEED) : RUN_JUMP_SPEED;
    // Ends with a short blend into the run starting the moment the boot lands.
    return { kind: best.kind, running: true, direction, rate: RUN_JUMP_SPEED, takeoffRate, start, elapsed: start,
      liftoff, landing: touchdown, end: touchdown + RUN_JUMP_FADE_OUT, fadeOut: RUN_JUMP_FADE_OUT, handedBack: false };
  }

  // At touchdown, put the run underneath on the moment its stride has the same
  // boot planted in the same spot, so the blend back never slides that boot.
  handRunBack(state) {
    for (const outfit of this.outfits) {
      outfit.actions.Run.time = outfit.jumpClips[state.kind].landing.runTime;
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

  // ---- Per-frame update -------------------------------------------------------

  // forwardAmount / sideAmount: stick or WASD input (-1..1) relative to the
  // camera's `forward` and `right`; speed above 5 sprints; deltaTime in seconds.
  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (this.defeated) return;
    // Ease the requested input so starts, stops, and direction changes
    // accelerate smoothly instead of snapping between full speed and zero.
    // Easing runs per sub-step, so every frame rate gives the same motion.
    const steps = Math.max(1, Math.ceil(deltaTime * LOLA_SUBSTEP_RATE));
    const ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime / steps);
    for (let i = 0; i < steps; i += 1) {
      this.locomotion.easeInput(forwardAmount, sideAmount, ease);
      this.moveStep(this.inputForward, this.inputSide, forward, right, speed, deltaTime / steps);
    }
    // One pose per rendered frame, for the outfit on screen.
    this.poseClock += 1;
    this.poseOutfit(this.equipped);
  }

  // One movement sub-step: facing, clocks, the base blend, travel and collision.
  moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    // The physics hop (only without authored jump clips).
    if (!this.grounded) {
      const gravity = LOLA_GRAVITY * this.world.scale;
      this.mesh.position.y += this.verticalVelocity * deltaTime - 0.5 * gravity * deltaTime ** 2;
      this.verticalVelocity -= gravity * deltaTime;
      if (this.mesh.position.y <= 0) this.resetJump();
    }

    // Where the input points in the world, and how hard.
    this.direction.copy(forward).multiplyScalar(forwardAmount).addScaledVector(right, sideAmount);
    const inputStrength = Math.min(1, this.direction.length());
    this.direction.normalize();
    // Shooter controls: Lola always faces the camera's forward direction, so the
    // camera stays at her back. S backpedals and A/D strafe instead of turning her.
    const heading = Math.atan2(forward.x, forward.z);
    const turn = Math.atan2(Math.sin(heading - this.mesh.rotation.y), Math.cos(heading - this.mesh.rotation.y));
    this.mesh.rotation.y += THREE.MathUtils.clamp(turn, -LOLA_TURN_RATE * deltaTime, LOLA_TURN_RATE * deltaTime);
    const sprint = speed > LOLA_SPRINT_SPEED && !this.crouching;
    this.locomotion.runPace = sprint ? LOLA_PACE.sprint : LOLA_PACE.run;
    const next = this.locomotion.chooseClip(forwardAmount, sideAmount, inputStrength, this.crouching);

    // Authored jump and reload clocks.
    this.advanceJump(inputStrength, deltaTime);
    if (this.reloadState) {
      this.reloadState.elapsed += deltaTime;
      if (this.reloadState.elapsed >= this.reloadState.outfit.reload.duration) this.cancelReload();
    }
    const jumpWeight = this.jumpWeight();

    // Base locomotion blend for both outfits; travel from the one on screen.
    let distance = 0;
    for (const [index, outfit] of this.outfits.entries()) {
      distance += this.locomotion.update(outfit, { next, forwardAmount, inputStrength, grounded: this.grounded,
        countTravel: index === this.weaponIndex, world: this.world }, deltaTime);
    }
    if (!this.grounded) distance = this.locomotion.airborneDistance(this.equipped, sideAmount, forwardAmount, inputStrength, deltaTime);
    distance *= this.world.scale * this.jumpTravel();

    // Collision; a blocked move slows the clips so the feet do not skate.
    const moved = this.mover.move(this.world, this.mesh.position, this.direction, distance);
    const progress = distance > 1e-8 ? Math.min(1, moved / distance)
      : inputStrength && this.mover.blockedAhead(this.world, this.mesh.position, this.direction) ? 0 : 1;
    this.hitRecoilTime = Math.max(0, this.hitRecoilTime - deltaTime);

    // Shot variant, footsteps, then advance every clip's clock.
    for (const outfit of this.outfits) {
      this.locomotion.scaleRates(outfit, progress);
      const shot = this.shot?.outfit === outfit ? this.shot : null;
      if (shot) this.updateShotVariant(shot, moved);
      const stepAction = outfit.actions[outfit.current];
      if (outfit === this.equipped && this.grounded && jumpWeight < 0.5 && moved > 1e-7 && (!shot || shot.upperOnly)
          && crossedFootContact(outfit.footContacts[outfit.current], stepAction.time, deltaTime * stepAction.timeScale)) {
        this.onFootstep?.(sprint ? 'run' : 'walk', this.crouching);
      }
      if (shot) shot.elapsed += deltaTime;
      this.animator.advance(outfit, deltaTime);
      if (shot && shot.elapsed >= shot.duration + shot.hold && !this.aimHeld) this.cancelShot();
    }
  }

  // Advance an authored jump: its rate, the push-off and touchdown footsteps,
  // the hand-back to the run on landing, and its end.
  advanceJump(inputStrength, deltaTime) {
    const state = this.jumpState;
    if (!state) return;
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

  // ---- Posing -----------------------------------------------------------------

  // Evaluate one outfit's pose from the current layers (see LolaAnimator).
  poseOutfit(outfit) {
    const layers = { mesh: this.mesh };
    const shot = this.shot?.outfit === outfit ? this.shot : null;
    if (shot) layers.shot = { upperOnly: !!shot.upperOnly };
    if (this.jumpState) layers.jump = { action: outfit.jumpClips[this.jumpState.kind].action, weight: this.jumpWeight() };
    if (this.reloadState?.outfit === outfit) layers.reload = { action: outfit.reload.action, weight: this.reloadWeight() };
    if (this.hitRecoilTime > 0) {
      layers.flinch = { strength: this.flinchStrength(), angle: ENCOUNTER.hitRecoilAngle, direction: this.hitDirection };
    }
    this.animator.pose(outfit, layers);
    outfit.posed = this.poseClock;
  }

  // Pose the equipped outfit if it has not been posed since the last move().
  ensurePosed() {
    if (this.equipped.posed !== this.poseClock) this.poseOutfit(this.equipped);
  }
}
