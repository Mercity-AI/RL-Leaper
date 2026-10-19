import * as THREE from 'three';
import { GunshotEffects } from './GunshotEffects.js';
import { SHOOTING, WEAPONS, WEAPON_SLOTS, weaponForSlot } from '../config/weapons.js';
import { CAMERA } from '../config/camera.js';
import { WeaponState } from '../weapons/WeaponState.js';
import { resolveShot, sightDepth, traceSight } from '../weapons/resolveShot.js';
import { TargetRegistry } from '../weapons/TargetRegistry.js';
import { createLeaperTarget } from '../weapons/LeaperTarget.js';
import { HitFeedback } from '../weapons/HitFeedback.js';
import { MuzzleTracker } from '../weapons/MuzzleTracker.js';
import { FirstPersonView } from '../weapons/FirstPersonView.js';
import { InputController } from '../input/InputController.js';
import { ReticleView } from '../ui/ReticleView.js';
import { WeaponHudView } from '../ui/WeaponHudView.js';

// Lola's guns, as a thin coordinator. The pieces it connects:
//   src/config/weapons.js      every gun's numbers (damage, rate, spread, recoil...)
//   weapons/WeaponState        one per gun: ammo, fire-rate clock, reload, spread bloom
//   weapons/resolveShot        where a bullet goes (sight ray from Lola's depth + muzzle ray)
//   weapons/TargetRegistry     what bullets can hit (each enemy's hit volumes)
//   weapons/HitFeedback        hit markers, the crosshair kick, the big-hit glow
//   GunshotEffects             pooled tracers, flashes and sparks
//   ui/ReticleView, WeaponHudView   the HUD pieces
// It reads the input actions once per frame (fire, aim, reload), so nothing is
// ever fired from inside a page event, a pause freezes the guns, and the click
// that only grabs the mouse again never shoots.
export class PlayerWeapon {
  constructor(playtest) {
    const p = this.p = playtest;
    const { engine, world } = p;
    // 1. The controls: the game's shared input actions (a test page without a
    //    game gets its own). A click that only re-captures the mouse never counts.
    // (The junkyard's InputController lives on its simulation; playtest.input is
    // the playtest's input-phase method, not the controller.)
    const shared = p.simulation?.input;
    this.input = shared ?? new InputController();
    this.ownsInput = !shared;
    this.input.setPointerGuard?.(() => Boolean(p.cameraController.captureClick));
    this.inputFrame = null;
    this.triggerHeld = false;
    this.aimFromInput = false;
    // Whether the gun could be used last frame (the controls are let go once when it can't).
    this.wasAvailable = false;

    // 2. One state per gun, in Lola's weaponIndex order (0 = M416, 1 = pistol).
    this.states = WEAPON_SLOTS.map(id => new WeaponState(WEAPONS[id]));

    // 3. What bullets can hit besides the map: every registered target. The
    //    playtest's Leaper is registered here; more enemies add their own
    //    (this.targets.add(createLeaperTarget(...))).
    this.targets = new TargetRegistry();
    this.removeLeaperTarget = this.targets.add(createLeaperTarget({ rig: p.simulation.rig, combat: p.combat }));

    // 4. Effects and feedback. The effects' shaders compile now, not on the first shot.
    this.random = Math.random;
    this.visuals = new GunshotEffects(engine.scene, world.scale);
    this.visuals.prewarm(engine.renderer, engine.camera);
    this.feedback = new HitFeedback();
    this.firstPerson = new FirstPersonView(p.target);
    this.muzzle = new MuzzleTracker();
    this.obstruction = { blocked: false, offset: { x: 0, y: 0 } };
    this.scratch = { origin: new THREE.Vector3(), direction: new THREE.Vector3(), muzzle: new THREE.Vector3(),
      anchor: new THREE.Vector3(), screen: new THREE.Vector3() };

    // 5. The HUD: crosshair and gun icons.
    this.reticleView = new ReticleView(document.body);
    this.weaponHud = new WeaponHudView(document.body, {
      slots: WEAPON_SLOTS.map(id => ({ id, key: WEAPONS[id].key, label: WEAPONS[id].label, icon: WEAPONS[id].icon })),
    });
    this.hudGuns = WEAPON_SLOTS.map(id => ({ id, active: false, reloading: false, empty: false, fraction: 1 }));

    // 6. The gamepad's Start resumes the game the same way the pause overlay
    //    does (the junkyard already sets onPauseRequested).
    p.cameraController.onResumeRequested ??= () => p.resume?.();

    // 7. Leaving the window or hiding the tab drops the trigger, aim and reload;
    //    shots already in the air keep fading. (The session's AbortSignal, if
    //    any, removes these listeners.)
    const session = p.signal ? { signal: p.signal } : {};
    window.addEventListener('blur', () => this.cancelActions(), session);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelActions(); }, session);
    this.renderHud();
  }

  // The session is over: no effects left in the scene, no HUD left on the page,
  // Lola's head drawn again. (Its page listeners go with the session's AbortSignal.)
  dispose() {
    this.firstPerson.dispose();
    this.visuals.dispose();
    this.reticleView.dispose();
    this.weaponHud.dispose();
    this.removeLeaperTarget();
    this.targets.clear();
    if (this.ownsInput) this.input.dispose();
    document.documentElement.style.setProperty('--good-flash', '0');
  }

  // ---- What the rest of the game (and the tests) read ----

  // The equipped gun's data and state.
  get weapon() { return weaponForSlot(this.p.target.weaponIndex); }
  get state() { return this.states[this.p.target.weaponIndex]; }
  get ammoState() { return this.state; }
  // Every gun's state ({ mag, reserve, ... }), by weaponIndex.
  get ammo() { return this.states; }
  // Seconds until the equipped gun may fire again (0 = ready).
  get remaining() { return Math.max(0, this.state.cooldown); }
  set remaining(seconds) { this.state.cooldown = seconds; }
  get reloadRemaining() { return this.state.reloadRemaining; }
  get reloadTotal() { return this.state.reloadTotal; }
  get effects() { return this.visuals.items; }
  get reticle() { return this.reticleView.element; }
  get ammoReadout() { return this.weaponHud.element; }
  get range() { return this.weapon.range * this.p.world.scale; }
  // Lola is walking or running (her shots spread wider).
  get moving() { return Math.hypot(this.p.target.inputForward ?? 0, this.p.target.inputSide ?? 0) > 0.1; }

  // The gun can be used: nobody is down, not in LEAPER POV, not paused, in the
  // chase view, and the tab is visible.
  get available() {
    const p = this.p;
    return !p.combat.dead && !p.pov.active && !p.paused
      && p.cameraController.mode === 'CHASE' && !document.hidden;
  }

  // ---- Aiming down the sights ----

  // fromInput: the aim follows a held input (right mouse, LT) and ends
  // when it is let go; otherwise it stays until setAiming(false).
  setAiming(active, { fromInput = false } = {}) {
    const p = this.p, cc = p.cameraController;
    active = Boolean(active);
    this.aimFromInput = active && fromInput;
    // 1. Leaving the aim keeps the crosshair on whatever was aimed at (a knee, a tyre…).
    if (!active && cc.aiming && this.available) {
      const point = this.crosshairPoint();
      cc.setAiming(false);
      cc.aimChaseAt(point);
    }
    // 2. Entering the aim likewise keeps the crosshair on the same spot.
    const enterPoint = active && !cc.aiming && this.available ? this.crosshairPoint() : null;
    p.target.aimHeld = active;
    cc.setAiming(active);
    if (active) {
      cc.aimZoom = this.weapon.ads.zoom;
      p.target.holdAim();
      // Solve after the raised-gun pose is applied, since it moves the eyes.
      if (enterPoint) cc.aimEyeAt(enterPoint);
      // A shot later this frame must already use the eye view.
      cc.update(p.simulation.state, p.simulation.rig.eyePivot, 0);
    } else if (p.target.shot?.action.paused) {
      p.target.cancelShot();
    }
    // 3. Only Lola's head stops drawing while the camera is inside it.
    this.firstPerson.set(active && this.available);
    this.renderHud();
  }

  // ---- Rays ----

  // The screen-centre ray of the camera as it is right now.
  cameraRay() {
    const camera = this.p.engine.camera;
    camera.updateMatrixWorld();
    const origin = this.scratch.origin.setFromMatrixPosition(camera.matrixWorld);
    const direction = camera.getWorldDirection(this.scratch.direction);
    return { origin, direction };
  }

  // How far along the camera ray the sight trace starts: Lola's depth in the
  // chase view (so nothing behind her can be the aim point, review fix 5.5), the
  // lens itself when aiming through her eyes.
  sightNear(ray) {
    const cc = this.p.cameraController;
    if (cc.aiming || !cc.followSubject) return 0;
    return sightDepth(ray, cc.chaseAnchor(this.scratch.anchor));
  }

  // World point under the screen-centre crosshair (or the end of gun range).
  crosshairPoint() {
    const ray = this.cameraRay();
    this.targets.update();
    return traceSight({ cameraRay: ray, near: this.sightNear(ray), world: this.p.combat.geometry,
      targets: this.targets, range: this.range }).point;
  }

  // ---- Shooting ----

  // Pull the trigger once, now (the frame's input does this in update()).
  // Returns whether a bullet was fired.
  fire() {
    return this.pullTrigger({ pressed: true, held: false }).shots > 0;
  }

  // The equipped gun's trigger for this frame: shots, the empty click, reloads.
  pullTrigger(trigger) {
    if (!this.available) return { shots: 0, dryFire: false, needsReload: false };
    const result = this.state.pull(trigger, () => this.shoot());
    if (result.dryFire) this.p.audio.playSlot('gunEmpty');
    if (result.needsReload) this.reload();
    if (result.shots || result.dryFire) this.renderHud();
    return result;
  }

  // One real bullet. Returns false (nothing spent) when Lola can't shoot right now.
  shoot() {
    const p = this.p, weapon = this.weapon, state = this.state;
    if (!this.available) return false;
    // 1. Lola raises the gun (her action rules may refuse: mid-jump, mid-reload).
    if (!p.target.startShot(Math.max(SHOOTING.minShotPose, weapon.interval), SHOOTING.aimHold)) return false;
    // 2. Where it goes: the sight ray from Lola's depth, then the muzzle ray.
    const ray = this.cameraRay();
    this.targets.update();
    const muzzle = p.target.muzzlePosition();
    this.muzzle.remember(p.target, muzzle);
    const aiming = p.cameraController.aiming;
    const shot = resolveShot({
      cameraRay: ray, muzzle, near: this.sightNear(ray), world: p.combat.geometry, targets: this.targets,
      range: this.range, spread: state.spread({ aiming, moving: this.moving }), random: this.random,
    });
    this.lastShot = shot;
    // 3. What everyone sees and hears. One shared impact recording plays for the
    //    Leaper and all current scenery (an owner choice).
    const rifle = weapon.tracer === 'rifle';
    this.visuals.shot(shot.origin, shot.end, rifle);
    p.audio.play(weapon.shotSound);
    if (shot.hit) p.audio.play('leaper');
    // 4. The kick (less while aiming).
    const kick = aiming ? weapon.ads.recoil : 1;
    p.cameraController.addRecoil?.(weapon.recoil.pitch * kick,
      (this.random() * 2 - 1) * weapon.recoil.yawJitter * kick, weapon.recoil.recovery);
    // 5. An enemy hit: sparks, the damage through its hit zone, and the feedback.
    if (shot.hit?.kind === 'target') {
      const hit = shot.hit.hit;
      this.visuals.impact(shot.end, hit.normal, rifle);
      const outcome = hit.target.applyHit(hit, { damage: weapon.damage, direction: shot.direction });
      this.feedback.hit(outcome);
      if (outcome.brokeJoint) p.audio.playSlot('kneeBreak');
    } else {
      this.feedback.miss();
    }
    return true;
  }

  // ---- Reloading ----

  reload() {
    const state = this.state;
    // Nothing to do mid-reload, with a full magazine, or with no spare rounds.
    if (!state.canReload) return;
    // Lola plays her reload animation (it also lowers any raised gun). Mid-jump
    // she can't, so the reload waits; the automatic one retries after landing.
    if (!this.p.target.startReload()) return;
    state.startReload(this.p.target.reloadDuration ?? this.weapon.reloadTime);
    this.reloadWeapon = this.p.target.weaponIndex;
  }

  cancelReload() {
    for (const state of this.states) state.cancelReload();
    this.p.target.cancelReload();
    // Cut the reload clicks short too.
    this.reloadVoice?.then(source => source?.stop());
    this.reloadVoice = null;
  }

  // ---- Each frame (gameplay phase) ----

  update(dt) {
    const p = this.p, cc = p.cameraController;
    const available = this.available;
    // 1. Hit feedback and the blue edge glow fade even while the gun can't be used
    //    (the kill shot's reward plays out after the fight ends).
    this.feedback.update(dt);
    document.documentElement.style.setProperty('--good-flash', this.feedback.glow.toFixed(3));
    // 2. This frame's input. Presses count once, however often update() runs.
    const fresh = this.input.frame !== this.inputFrame;
    this.inputFrame = this.input.frame;
    const pressed = action => fresh && Boolean(this.input.pressed?.(action));
    const released = action => fresh && Boolean(this.input.released?.(action));
    const held = action => Boolean(this.input.held?.(action));
    // 3. The gun just became unavailable (paused, POV, TOP view, the fight is over):
    //    let go of it once. A pause only releases the controls, so a reload resumes.
    //    Tracers and sparks keep fading, so the kill shot is seen (frozen while paused).
    if (!available) {
      if (this.wasAvailable) {
        if (p.paused) this.releaseControls();
        else this.cancelActions();
      }
      this.wasAvailable = false;
      this.triggerHeld = false;
      this.firstPerson.set(false);
      this.visuals.update(dt);
      this.renderHud();
      return;
    }
    this.wasAvailable = true;
    // 4. Aim: a press raises the sights; letting go lowers them. Only a press made
    //    while the gun is usable counts (a button held through a pause or a menu
    //    does nothing until pressed again). Escape lowers them too.
    if (pressed('aim')) this.setAiming(true, { fromInput: true });
    if (cc.aiming && (released('aim') || (this.aimFromInput && !held('aim')) || pressed('pause'))) this.setAiming(false);
    if (p.target.aimHeld) p.target.holdAim();
    // 5. Trigger: held from a press made while the gun is usable until let go.
    this.triggerHeld = pressed('fire') || (this.triggerHeld && held('fire'));
    // 6. A reload belongs to the gun it started on; switching guns or jumping abandons it.
    const weaponIndex = p.target.weaponIndex;
    if (this.states.some(state => state.reloading)
      && (this.reloadWeapon !== weaponIndex || p.target.jumpState)) this.cancelReload();
    // 7. Every gun's clock runs; the equipped gun's reload sound lands on the animation.
    this.states.forEach((state, index) => {
      const events = state.advance(dt);
      if (index === weaponIndex && events.reloadSound) this.reloadVoice = p.audio.play(state.weapon.reloadSound);
    });
    // 8. R / X / RELOAD reloads early; the trigger fires (and empties reload by themselves).
    if (pressed('reload')) this.reload();
    this.pullTrigger({ pressed: pressed('fire'), held: this.triggerHeld });
    // 9. Would a shot now hit cover before the crosshair's point? (OBSTRUCTED reticle)
    this.checkObstruction();
    // 10. Effects and the HUD.
    this.visuals.update(dt);
    this.renderHud();
  }

  // The OBSTRUCTED check: trace the muzzle ray toward the crosshair's point once
  // per frame (finding aim-weapons-parallax-no-obstruction-feedback).
  checkObstruction() {
    const p = this.p, player = p.target;
    // The barrel's real place is measured once per gun and stance while the gun is up.
    if (player.shot && !this.muzzle.known(player)) this.muzzle.remember(player, player.muzzlePosition());
    const ray = this.cameraRay();
    this.targets.update();
    const shot = resolveShot({
      cameraRay: ray, muzzle: this.muzzle.estimate(player, this.scratch.muzzle), near: this.sightNear(ray),
      world: p.combat.geometry, targets: this.targets, range: this.range,
      tolerance: SHOOTING.obstruction * p.world.scale,
    });
    this.obstruction.blocked = shot.obstructed;
    if (shot.obstructed) {
      // Where the cover is on screen, in pixels from the centre.
      const canvas = p.engine.renderer?.domElement;
      const width = canvas?.clientWidth || globalThis.innerWidth || 1;
      const height = canvas?.clientHeight || globalThis.innerHeight || 1;
      const screen = this.scratch.screen.copy(shot.blockPoint).project(p.engine.camera);
      this.obstruction.offset.x = screen.x * width / 2;
      this.obstruction.offset.y = -screen.y * height / 2;
    }
    return shot;
  }

  // ---- The HUD ----

  // Hand the views this frame's data (they only touch the page on changes).
  renderHud() {
    const p = this.p, cc = p.cameraController, available = this.available;
    const feedback = this.feedback.state, state = this.state;
    // The spread cone as pixels on screen from the crosshair.
    const canvas = p.engine.renderer?.domElement;
    const height = canvas?.clientHeight || globalThis.innerHeight || 1;
    const halfFov = THREE.MathUtils.degToRad(p.engine.camera.fov ?? CAMERA.chaseFov) / 2;
    const spread = Math.tan(state.spread({ aiming: cc.aiming, moving: this.moving })) / Math.tan(halfFov) * height / 2;
    // The kill shot's marker stays on screen while it fades, though the gun is
    // already put away (the fight just ended on that shot).
    this.reticleView.update({
      visible: available || feedback.marker?.kind === 'kill', aiming: cc.aiming, hit: feedback.hit, crit: feedback.crit, big: feedback.big,
      blocked: available && this.obstruction.blocked, blockOffset: this.obstruction.offset,
      spread, marker: feedback.marker,
    });
    // The gun icons: the equipped gun's fill drains with its magazine or refills while it reloads.
    const weaponIndex = p.target.weaponIndex;
    this.states.forEach((gunState, index) => {
      const gun = this.hudGuns[index];
      gun.active = index === weaponIndex;
      gun.reloading = gun.active && gunState.reloading;
      gun.empty = !gun.reloading && gunState.mag <= 0;
      gun.fraction = gun.reloading ? gunState.reloadProgress : gunState.mag / gunState.weapon.magazine;
    });
    this.weaponHud.update({ visible: available, reloading: state.reloading, empty: !state.reloading && state.mag <= 0,
      guns: this.hudGuns });
  }

  // Kept for older callers: the HUD now redraws itself every frame.
  updateAmmoHud() {
    this.renderHud();
  }

  // ---- Render hooks: only the Leaper's render-only impact shudder is left ----

  beforeRender() {
    if (!this.p.pov.active) this.visuals.beforeRender(this.p.simulation.rig.robot);
  }

  afterRender() {
    this.visuals.afterRender(this.p.simulation.rig.robot);
  }

  // ---- Stopping and resetting (review fix 5.2) ----

  // Let go of the controls: trigger and aim. Used when the game pauses, so a
  // reload or a shot already under way freezes with gameplay time and carries on.
  releaseControls() {
    this.triggerHeld = false;
    this.setAiming(false);
  }

  // Stop everything Lola is doing with her guns: trigger, aim, reload, shot pose
  // and the shot cooldown. Shots already fired keep their tracer and sparks, so
  // ending the fight never erases the kill shot.
  cancelActions() {
    this.releaseControls();
    for (const state of this.states) state.settle();
    this.cancelReload();
    this.p.target.cancelShot();
  }

  // Remove every tracer, spark and hit marker at once (a restart, not an ending).
  clearEffects() {
    this.visuals.clear();
    this.feedback.clear();
    this.obstruction.blocked = false;
    this.renderHud();
  }

  // Both of the above.
  reset() {
    this.cancelActions();
    this.clearEffects();
  }

  // A new encounter (RESTART ENCOUNTER, RESET, RESTART RANDOM): as reset(), and
  // every magazine is full again (review fix 5.23).
  resetEncounter() {
    this.reset();
    for (const state of this.states) state.refill();
    this.renderHud();
  }
}
