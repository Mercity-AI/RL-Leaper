import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { crossedFootContact } from './footstepContacts.js';
import { loadLolaAssets, prepareOutfits } from '../actors/lola/LolaAssets.js';
import { LolaLocomotion } from '../actors/lola/LolaLocomotion.js';
import { LolaAnimator, undoFlinch } from '../actors/lola/LolaAnimator.js';
import { LolaActionState } from '../actors/lola/LolaActionState.js';
import { CharacterMover } from '../actors/lola/CharacterMover.js';
import {
  JUMP_FADE_IN, JUMP_FADE_OUT, JUMP_LANDING, JUMP_LIFTOFF, JUMP_RUN_START, JUMP_STANDING_SPEED, LOLA_BLEND_RATE,
  LOLA_GRAVITY, LOLA_HOP_HEIGHT, LOLA_INPUT_RESPONSE, LOLA_PACE, LOLA_SHOT_LEG_RATE, LOLA_SPRINT_SPEED, LOLA_STALL_END,
  LOLA_STALL_START, LOLA_SUBSTEP_RATE, LOLA_TURN_RATE, LOLA_WARP_FADE, LOLA_WARP_HIPS, LOLA_WARP_MAX, LOLA_WARP_RATE,
  LOLA_WARP_SPEED,
  RELOAD_FADE_IN, RELOAD_FADE_OUT, RUN_FRAMES, RUN_JUMPS, RUN_JUMP_FADE_OUT, RUN_JUMP_MAX_SKIP, RUN_JUMP_SPEED,
} from '../actors/lola/lolaTuning.js';

export { LOLA_PACE };

// Lola, the player character. This class is the public face other systems use
// (weapon, combat, camera, brain, eye vision); the work happens in parts:
//   LolaAssets       loads the 14 exported files into one body with a view per gun
//                    (outfits[0] = M416, outfits[1] = pistol; both share .model)
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
    // Share of the pose eased toward standing because a wall stops her (0..1).
    this.stall = 0;
    // Share of a shot's standing stance in her legs: 1 while she stands still,
    // easing to 0 (legs keep running) while she moves (eased in two stages).
    this.shotLegs = 1;
    this.shotLegsEase = 1;
    // Hip twist toward her real travel direction (radians, + = to her right).
    this.warp = 0;

    // One body with a view per gun, built from copies of the loaded files.
    this.outfits = prepareOutfits(models, { jumps, reloads, runJumps }, world, this.mesh);
    scene.add(this.mesh);

    // The on-screen weapon button. (The C / 1 / 2 keys, the gamepad and the touch
    // buttons are input actions now, applied by PlayerController, so a pause
    // freezes them like every other control.)
    this.toggleButton = toggleButton;
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    this.showWeapon();
  }

  // ---- State other systems read ------------------------------------------

  // The view for the gun in her hands; only its clips drive the body.
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
    this.updateGuns();
    this.toggleButton.textContent = `${this.weaponIndex === 0 ? '2: M416' : '1: BASIC GUN'} · C: ${this.crouching ? 'CROUCHED' : 'STANDING'}`;
    this.toggleButton.classList.add('on');
    // A newly equipped gun's clips may not have posed the body yet.
    this.ensurePosed();
  }

  // Show exactly the guns that belong on screen: the equipped gun in her
  // hands (or its jump, reload or shooting copy while one plays) and the
  // other gun stowed on her back or hip; every other copy hidden.
  updateGuns() {
    this.outfits.forEach((outfit, index) => {
      const equipped = index === this.weaponIndex;
      const inHand = !equipped ? null
        : (this.jumpState && outfit.jumpClips[this.jumpState.kind]?.gun)
          || (this.reloadState?.outfit === outfit && outfit.reload.gun)
          || (this.shot?.outfit === outfit && outfit.shotGun)
          || outfit.carriedGun;
      for (const gun of outfit.guns) gun.visible = gun === inHand;
      if (outfit.stowed) outfit.stowed.visible = !equipped;
    });
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
    this.updateGuns();
    this.animator.placeReloadGun(outfit, 0);
    return true;
  }

  cancelReload() {
    if (!this.reloadState) return;
    const { outfit } = this.reloadState;
    this.reloadState = null;
    outfit.reload.action.stop();
    this.updateGuns();
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
    for (const outfit of this.outfits) undoFlinch(outfit);
  }

  // How far into the flinch she is, 0..1 (sharp bend, slower recovery).
  flinchStrength() {
    const t = 1 - this.hitRecoilTime / ENCOUNTER.hitRecoilDuration;
    const peak = ENCOUNTER.hitRecoilPeak;
    return t < peak ? Math.sin(Math.PI * 0.5 * t / peak) : Math.sin(Math.PI * 0.5 * (1 - t) / (1 - peak));
  }

  // ---- Shooting and aiming --------------------------------------------------

  // A shot plays two copies of the authored clip in step: the whole-body one
  // gives her legs the standing stance (at the shotLegs share), and the
  // upper-body one always drives her arms, torso and gun, so running and
  // firing never pops the legs or loosens her grip.
  startShot(duration = 1, hold = 0) {
    if (!this.actionState.begin('shoot', this.enders)) return false;
    const outfit = this.equipped;
    const name = this.crouching ? 'CrouchShoot' : 'Shoot';
    const action = outfit.shooting[name], upper = outfit.shootingUpper[name];
    for (const item of [action, upper]) {
      item.reset().setEffectiveTimeScale(item.getClip().duration / duration).setEffectiveWeight(1).play();
    }
    this.shot = { outfit, action, upper, name, elapsed: 0, duration, hold, upperOnly: this.shotLegs < 0.5 };
    this.updateGuns();
    // Show the raised gun at once, so a shot fired this frame leaves the muzzle.
    this.poseOutfit(outfit);
    return true;
  }

  holdAim() {
    if (!this.actionState.can('aim') || !this.startShot()) return;
    // The authored first frame is the raised-gun pose; aiming alone has no recoil.
    this.shot.action.paused = true;
    this.shot.upper.paused = true;
  }

  cancelShot() {
    if (!this.shot) return;
    const { action, upper } = this.shot;
    action.stop();
    upper.stop();
    // Locomotion weights kept advancing underneath the shooting pose.
    this.shot = null;
    this.updateGuns();
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
      // Both guns' views keep the jump's clock, so switching guns mid-air
      // carries on; showWeapon shows the equipped one's jump gun.
      const { kind } = this.jumpState;
      for (const outfit of this.outfits) {
        const clip = outfit.jumpClips[kind];
        clip.action.reset().setEffectiveTimeScale(this.jumpState.rate).setEffectiveWeight(0).play();
        clip.action.time = this.jumpState.start;
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
    for (const outfit of this.outfits) outfit.jumpClips[kind].action.stop();
    this.updateGuns();
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
    // Down: no more steering or travel, but her animation keeps running, so she
    // settles into Idle (and any hit flinch plays out) instead of freezing mid-stride.
    if (this.defeated) {
      forwardAmount = 0; sideAmount = 0;
      this.inputForward = 0; this.inputSide = 0;
      forward = (this.defeatFacing ??= new THREE.Vector3()).set(Math.sin(this.mesh.rotation.y), 0, Math.cos(this.mesh.rotation.y));
    }
    // Ease the requested input so starts, stops, and direction changes
    // accelerate smoothly instead of snapping between full speed and zero.
    // Easing runs per sub-step, so every frame rate gives the same motion.
    const steps = Math.max(1, Math.ceil(deltaTime * LOLA_SUBSTEP_RATE));
    const ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime / steps);
    for (let i = 0; i < steps; i += 1) {
      this.locomotion.easeInput(forwardAmount, sideAmount, ease);
      this.moveStep(this.inputForward, this.inputSide, forward, right, speed, deltaTime / steps);
    }
    // One pose per rendered frame, by the equipped gun's view.
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
    const targets = this.locomotion.targets(forwardAmount, sideAmount, inputStrength, this.crouching);

    // Authored jump and reload clocks.
    this.advanceJump(inputStrength, deltaTime);
    if (this.reloadState) {
      this.reloadState.elapsed += deltaTime;
      if (this.reloadState.elapsed >= this.reloadState.outfit.reload.duration) this.cancelReload();
    }
    const jumpWeight = this.jumpWeight();

    // Base locomotion blend for both guns' views (so switching guns keeps the
    // stride); travel and the body's height from the equipped one.
    // The stall share is last sub-step's (it is eased, so the lag is invisible).
    let distance = 0;
    const stallLayer = this.stallLayer();
    for (const [index, outfit] of this.outfits.entries()) {
      distance += this.locomotion.update(outfit, { targets, forwardAmount, inputStrength, grounded: this.grounded,
        countTravel: index === this.weaponIndex, world: this.world, stall: stallLayer }, deltaTime);
    }
    if (!this.grounded) distance = this.locomotion.airborneDistance(this.equipped, sideAmount, forwardAmount, inputStrength, deltaTime);
    distance *= this.world.scale * this.jumpTravel();

    // Collision slides her along walls; whatever part of the move a wall still
    // stops slows the clips to match, so the feet do not skate.
    const startX = this.mesh.position.x, startZ = this.mesh.position.z;
    const { moved } = this.mover.move(this.world, this.mesh.position, this.direction, distance);
    this.updateWarp(this.mesh.position.x - startX, this.mesh.position.z - startZ, moved, forwardAmount, jumpWeight, deltaTime);
    const progress = distance > 1e-8 ? Math.min(1, moved / distance)
      : inputStrength && this.mover.blockedAhead(this.world, this.mesh.position, this.direction) ? 0 : 1;
    // Pushing into a wall eases her legs toward standing instead of freezing them.
    const stall = 1 - THREE.MathUtils.smoothstep(progress, LOLA_STALL_START, LOLA_STALL_END);
    this.stall += (stall - this.stall) * (1 - Math.exp(-LOLA_BLEND_RATE * deltaTime));
    // A shot's legs ease between the standing stance and the run, never snap.
    const legEase = 1 - Math.exp(-LOLA_SHOT_LEG_RATE * deltaTime);
    this.shotLegsEase += ((moved > 1e-7 ? 0 : 1) - this.shotLegsEase) * legEase;
    this.shotLegs += (this.shotLegsEase - this.shotLegs) * legEase;
    this.hitRecoilTime = Math.max(0, this.hitRecoilTime - deltaTime);

    // Advance every clip's clock (moving clips on one shared stride phase),
    // with a footstep each time the leading clip plants a boot.
    for (const outfit of this.outfits) {
      this.locomotion.scaleRates(outfit, progress);
      const shot = this.shot?.outfit === outfit ? this.shot : null;
      if (shot) shot.upperOnly = this.shotLegs < 0.5;
      const stepAction = outfit.actions[outfit.current];
      const stepTime = stepAction.time;
      const deltas = this.locomotion.advance(outfit, forwardAmount, deltaTime);
      this.animator.advance(outfit, deltaTime, deltas ? outfit.strideActions : null);
      const stepDelta = deltas?.[outfit.current] ?? deltaTime * stepAction.timeScale;
      if (outfit === this.equipped && this.grounded && jumpWeight < 0.5 && moved > 1e-7 && (!shot || shot.upperOnly)
          && crossedFootContact(outfit.footContacts[outfit.current], stepTime, stepDelta)) {
        this.onFootstep?.(sprint ? 'run' : 'walk', this.crouching);
      }
      if (shot) {
        // The upper-body copy follows the whole-body clip's clock exactly.
        shot.elapsed += deltaTime;
        shot.upper.time = shot.action.time;
        shot.upper.paused = shot.action.paused;
        if (shot.elapsed >= shot.duration + shot.hold && !this.aimHeld) this.cancelShot();
      }
    }
  }

  // Twist her hips toward where she is really going (diagonals, sliding along
  // a wall, lagging a camera turn) from where her legs' clips carry her, so the
  // planted boot stays put; eased, and faded out during an authored jump.
  // (dx, dz) is this sub-step's world displacement.
  updateWarp(dx, dz, moved, forwardAmount, jumpWeight, deltaTime) {
    let target = 0;
    if (moved > 1e-7 && this.grounded) {
      // Travel in her own frame: forward is +Z, her right is -X.
      const c = Math.cos(this.mesh.rotation.y), s = Math.sin(this.mesh.rotation.y);
      const travelForward = s * dx + c * dz, travelRight = -(c * dx - s * dz);
      const legs = this.locomotion.legsDirection(this.equipped, forwardAmount);
      if (Math.hypot(legs.x, legs.y) > 1e-6) {
        const turn = Math.atan2(travelRight, travelForward) - Math.atan2(legs.x, legs.y);
        target = Math.atan2(Math.sin(turn), Math.cos(turn));
        // Mid-reversal her legs still run the old way: fade the twist out
        // instead of flicking her hips round for a few frames.
        const fade = 1 - THREE.MathUtils.smoothstep(Math.abs(target) * 180 / Math.PI, LOLA_WARP_FADE.start, LOLA_WARP_FADE.end);
        target = THREE.MathUtils.clamp(target, -LOLA_WARP_MAX, LOLA_WARP_MAX) * fade * (1 - jumpWeight);
      }
    }
    // Ease toward the target, never turning faster than LOLA_WARP_SPEED.
    const limit = LOLA_WARP_SPEED * deltaTime;
    this.warp += THREE.MathUtils.clamp((target - this.warp) * (1 - Math.exp(-LOLA_WARP_RATE * deltaTime)), -limit, limit);
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

  // How much of her pose eases toward standing because a wall stops her, and
  // which standing clip (null when she is not stalled). Pose and height share it.
  stallLayer() {
    return this.stall > 1e-4 ? { share: this.stall, idle: this.crouching ? 'CrouchIdle' : 'Idle' } : null;
  }

  // Evaluate one outfit's pose from the current layers (see LolaAnimator).
  poseOutfit(outfit) {
    const layers = { mesh: this.mesh };
    const stall = this.stallLayer();
    if (stall) layers.stall = stall;
    if (Math.abs(this.warp) > 1e-5) layers.warp = { angle: this.warp, hips: LOLA_WARP_HIPS };
    const shot = this.shot?.outfit === outfit ? this.shot : null;
    if (shot) layers.shot = { action: shot.action, upper: shot.upper, legs: this.shotLegs };
    if (this.jumpState) {
      // The jump gun hands over to and from the carried gun (see blendJumpGun).
      const clip = outfit.jumpClips[this.jumpState.kind];
      layers.jump = { action: clip.action, weight: this.jumpWeight(), clip, carried: outfit.carriedGun };
    }
    if (this.reloadState?.outfit === outfit) layers.reload = { action: outfit.reload.action, weight: this.reloadWeight() };
    if (this.hitRecoilTime > 0) {
      layers.flinch = { strength: this.flinchStrength(), angle: ENCOUNTER.hitRecoilAngle, direction: this.hitDirection };
    }
    // The other gun's clips share the body: keep them out of this pose.
    const others = this.outfits.filter(item => item !== outfit && item.mixer === outfit.mixer);
    layers.silence = others.flatMap(item => item.timed);
    this.animator.pose(outfit, layers);
    outfit.posed = this.poseClock;
    // The body now shows this gun's pose; another view must pose afresh.
    for (const item of others) item.posed = -1;
  }

  // Pose the equipped outfit if it has not been posed since the last move().
  ensurePosed() {
    if (this.equipped.posed !== this.poseClock) this.poseOutfit(this.equipped);
  }
}
