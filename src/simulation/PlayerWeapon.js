import * as THREE from 'three';
import { GunshotEffects } from './GunshotEffects.js';
import { COMBAT } from '../config/combat.js';

// magazine: rounds per full load (M416 20, so one held burst empties it; sidearm 15).
// automatic: holding the left button keeps firing every `interval` seconds.
// reserve: spare rounds carried; Infinity = unlimited spares, but every magazine
// still has to be reloaded (automatically when empty, or early with R).
// reloadTime: seconds to swap a magazine when Lola has no reload animation; with
// one, the magazine refills exactly when her animation ends (44 frames, ~1.43 s).
// reloadSound / reloadSoundAt: recording and seconds into the reload it starts,
// lined up so its clicks land on the animation's hand work (M416: magazine click
// on frame 20; pistol: two clicks on frames 19 and 24).
export const PLAYER_WEAPON = Object.freeze({
  range: 60,
  aimHold: 1.2,
  m416: Object.freeze({ damage: 2, interval: 1 / 7, rifle: true, automatic: true, magazine: 20, reserve: Infinity,
    reloadTime: 43 / 30, reloadSound: 'm416Reload', reloadSoundAt: 0.14 }),
  pistol: Object.freeze({ damage: 6, interval: 0.2, rifle: false, magazine: 15, reserve: Infinity,
    reloadTime: 43 / 30, reloadSound: 'pistolReload', reloadSoundAt: 0.52 }),
});

// A "big hit" is a shot that snaps one of the Leaper's joints (or finishes it).
// crosshairTime: seconds the crosshair stays enlarged and red.
// edgeGlowTime: seconds the blue screen-edge glow takes to fade.
export const BIG_HIT = Object.freeze({ crosshairTime: 2, edgeGlowTime: 0.9 });

// Simple side-on silhouettes for the weapon icons (64 x 64 drawing space).
const PISTOL_ICON = `<svg class="gun-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 22h38v4h3v6H32l-2 4h-6l-3 14h-9l3-16h-3z"/></svg>`;
const RIFLE_ICON = `<svg class="gun-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M3 27h10l3-2h22v-3h6v3h8v2h9v3h-9v3H40l-1 2h-4l2 11h-6l-2-11h-3l-2 6h-6l2-6h-4l-6 4H5l2-6H3z"/></svg>`;

// Instant bullet, with a separate camera sight ray and muzzle ray so nearby cover wins.
export function bulletHit(geometry, enemies, origin, direction, range) {
  const cover = geometry.hit(origin, direction, range);
  const ray = new THREE.Raycaster(origin, direction, 0, range);
  const enemy = ray.intersectObjects(enemies, true)[0];
  const hitEnemy = !!enemy && enemy.distance < (cover?.distance ?? Infinity);
  return { intersection: hitEnemy ? enemy : cover, enemy: hitEnemy, distance: (hitEnemy ? enemy.distance : cover?.distance) ?? range };
}

export class PlayerWeapon {
  constructor(playtest) {
    this.p = playtest;
    this.remaining = 0;
    // Whether the gun could be used last frame (the controls are let go once when it can't).
    this.wasAvailable = false;
    this.visuals = new GunshotEffects(playtest.engine.scene, playtest.world.scale);
    this.effects = this.visuals.items;
    this.hitTime = 0;
    this.bigHitTime = 0;
    this.goodFlash = 0;
    // One independent ammo pool per gun, matching target.weaponIndex (0 = M416, 1 = pistol).
    this.ammo = [
      { mag: PLAYER_WEAPON.m416.magazine, reserve: PLAYER_WEAPON.m416.reserve },
      { mag: PLAYER_WEAPON.pistol.magazine, reserve: PLAYER_WEAPON.pistol.reserve },
    ];
    this.reloadRemaining = 0;
    this.reticle = document.createElement('div');
    this.reticle.id = 'playerReticle';
    this.reticle.textContent = '+';
    this.reticle.setAttribute('aria-label', 'Gun aiming reticle');
    document.body.append(this.reticle);
    // Bottom-right gun icons. The equipped gun's circle is bigger and filled with
    // colour that drains with its magazine, turning red when nearly empty.
    // Left to right in key order: 1 = pistol, 2 = M416.
    this.ammoReadout = document.createElement('div');
    this.ammoReadout.id = 'playerGuns';
    this.ammoReadout.setAttribute('aria-label', 'Weapons and ammunition');
    this.ammoReadout.innerHTML = `<div class="gun-row">
      <div class="gun" data-gun="pistol"><i class="gun-fill"></i>${PISTOL_ICON}<span class="gun-tag">1</span></div>
      <div class="gun" data-gun="m416"><i class="gun-fill"></i>${RIFLE_ICON}<span class="gun-tag">2</span></div>
    </div>`;
    this.gunSlots = [this.ammoReadout.querySelector('[data-gun=m416]'), this.ammoReadout.querySelector('[data-gun=pistol]')];
    document.body.append(this.ammoReadout);
    const canvas = playtest.engine.renderer.domElement;
    // Mouse events fire for each button, including left clicks while right aim is held.
    canvas.addEventListener('mousedown', event => {
      // The click that grabs the mouse again only does that: no shot, no aim.
      if (this.p.cameraController.captureClick) return;
      if (event.button === 2 && this.available) this.setAiming(true);
      // A press while the gun can't be used (paused, TOP view…) is ignored entirely.
      if (event.button === 0 && this.available) { this.triggerHeld = true; this.fire(); }
    });
    window.addEventListener('mouseup', event => {
      if (event.button === 0) this.triggerHeld = false;
      if (event.button === 2) this.setAiming(false);
    });
    window.addEventListener('pointercancel', () => this.setAiming(false));
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') this.setAiming(false);
      if (event.code === 'KeyR' && !event.repeat && this.available) this.reload();
    });
    // Leaving the window drops the trigger, aim and reload; shots already in the
    // air keep fading normally.
    window.addEventListener('blur', () => this.cancelActions());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancelActions(); });
  }

  setAiming(active) {
    // Leaving the aim keeps the crosshair on whatever was aimed at (a knee, a tyre…).
    if (!active && this.p.cameraController.aiming && this.available) {
      const point = this.crosshairPoint();
      this.p.cameraController.aiming = false;
      this.p.cameraController.aimChaseAt(point);
    }
    // Entering the aim likewise keeps the crosshair on the same spot.
    const enterPoint = active && !this.p.cameraController.aiming && this.available ? this.crosshairPoint() : null;
    this.p.target.aimHeld = active;
    this.p.cameraController.aiming = active;
    this.reticle.dataset.aim = String(active);
    if (active) {
      this.p.target.holdAim();
      // Solve after the raised-gun pose is applied, since it moves the eyes.
      if (enterPoint) this.p.cameraController.aimEyeAt(enterPoint);
      // A left click arriving before the next frame must already use the eye view.
      this.p.cameraController.update(this.p.simulation.state, this.p.simulation.rig.eyePivot, 0);
    } else if (this.p.target.shot?.action.paused) {
      this.p.target.cancelShot();
    }
  }

  get weapon() { return this.p.target.weaponIndex === 0 ? PLAYER_WEAPON.m416 : PLAYER_WEAPON.pistol; }

  get ammoState() { return this.ammo[this.p.target.weaponIndex]; }

  reload() {
    if (this.reloadRemaining > 0) return;
    const ammo = this.ammoState;
    // Nothing to do when the magazine is already full or no spare rounds remain.
    if (ammo.mag >= this.weapon.magazine || ammo.reserve <= 0) return;
    // Lola plays her reload animation (it also lowers any raised gun). Mid-jump
    // she can't, so the reload waits; the automatic one retries after landing.
    if (!this.p.target.startReload()) return;
    this.reloadTotal = this.p.target.reloadDuration ?? this.weapon.reloadTime;
    this.reloadRemaining = this.reloadTotal;
    this.reloadWeapon = this.p.target.weaponIndex;
    this.reloadSoundPlayed = false;
  }

  cancelReload() {
    this.reloadRemaining = 0;
    this.p.target.cancelReload();
    // Cut the reload clicks short too.
    this.reloadVoice?.then(source => source?.stop());
    this.reloadVoice = null;
  }

  finishReload() {
    const ammo = this.ammoState;
    const take = Math.min(this.weapon.magazine - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }

  get available() {
    const p = this.p;
    return !p.combat.dead && !p.pov.active && !p.paused
      && p.cameraController.mode === 'CHASE' && !document.hidden;
  }

  // World point under the screen-centre crosshair (or the end of gun range).
  crosshairPoint() {
    const p = this.p;
    p.engine.scene.updateMatrixWorld(true);
    p.engine.camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(), p.engine.camera);
    const sight = bulletHit(p.combat.geometry, this.enemyMeshes(), ray.ray.origin, ray.ray.direction,
      PLAYER_WEAPON.range * p.world.scale);
    return ray.ray.at(sight.distance, new THREE.Vector3());
  }

  enemyMeshes() {
    const rig = this.p.simulation.rig;
    return [rig.robot, ...rig.legs.flatMap(leg => Object.values(leg).filter(value => value?.isObject3D && !value.userData.detached))];
  }

  fire() {
    if (!this.available || this.remaining > 0) return false;
    const ammo = this.ammoState;
    if (this.reloadRemaining > 0) {
      // Pulling the trigger mid-reload on an empty gun still clicks.
      if (ammo.mag <= 0) {
        this.remaining = this.weapon.interval;
        this.p.audio.playSlot('gunEmpty');
      }
      return false;
    }
    // An empty magazine clicks and starts the (timed) reload.
    if (ammo.mag <= 0) {
      this.remaining = this.weapon.interval;
      this.p.audio.playSlot('gunEmpty');
      this.reload();
      return false;
    }
    if (!this.p.target.startShot(Math.max(0.24, this.weapon.interval), PLAYER_WEAPON.aimHold)) return false;
    ammo.mag -= 1;
    const p = this.p, scale = p.world.scale;
    this.remaining = this.weapon.interval;
    p.engine.scene.updateMatrixWorld(true);
    p.engine.camera.updateMatrixWorld(true);
    const cameraRay = new THREE.Raycaster();
    cameraRay.setFromCamera(new THREE.Vector2(), p.engine.camera);
    const enemies = this.enemyMeshes();
    const range = PLAYER_WEAPON.range * scale;
    const sight = bulletHit(p.combat.geometry, enemies, cameraRay.ray.origin, cameraRay.ray.direction, range);
    const aim = cameraRay.ray.at(sight.distance, new THREE.Vector3());
    const origin = p.target.muzzlePosition();
    const direction = aim.sub(origin).normalize();
    const hit = bulletHit(p.combat.geometry, enemies, origin, direction, range);
    const end = origin.clone().addScaledVector(direction, hit.distance);
    this.visuals.shot(origin, end, this.weapon.rifle);
    p.audio.play(this.weapon.rifle ? 'm416' : 'pistol');
    // One shared impact recording for the Leaper and all current scenery.
    if (hit.intersection) p.audio.play('leaper');
    this.reticle.dataset.hit = String(hit.enemy);
    if (hit.enemy) {
      const normal = hit.intersection.face.normal.clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.intersection.object.matrixWorld)).normalize();
      this.visuals.impact(end, normal, this.weapon.rifle);
      this.hitTime = 0.15;
      const brokeJoint = p.combat.legs.hit(hit.intersection.object, direction);
      // The red core in the Leaper's eye is a weak point.
      const weakPoint = !!hit.intersection.object.userData.weakPoint;
      p.combat.damageLeaper(this.weapon.damage * (weakPoint ? COMBAT.weakPointMultiplier : 1), false, brokeJoint);
      if (weakPoint) { this.critTime = 0.2; this.reticle.dataset.crit = 'true'; }
      if (brokeJoint || p.combat.leaperHealth <= 0) this.bigHit(brokeJoint);
    }
    return true;
  }

  bigHit(brokeJoint) {
    this.bigHitTime = BIG_HIT.crosshairTime;
    this.goodFlash = 1;
    this.reticle.dataset.big = 'true';
    if (brokeJoint) this.p.audio.playSlot('kneeBreak');
  }

  beforeRender() {
    if (!this.p.pov.active) this.visuals.beforeRender(this.p.simulation.rig.robot);
    if (this.available && this.p.cameraController.aiming) {
      this.playerVisibleBeforeRender = this.p.target.mesh.visible;
      this.p.target.mesh.visible = false;
    }
  }
  afterRender() {
    this.visuals.afterRender(this.p.simulation.rig.robot);
    if (this.playerVisibleBeforeRender !== undefined) {
      this.p.target.mesh.visible = this.playerVisibleBeforeRender;
      this.playerVisibleBeforeRender = undefined;
    }
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
    this.remaining = 0;
    this.cancelReload();
    this.p.target.cancelShot();
  }

  // Remove every tracer, spark and hit marker at once (a restart, not an ending).
  clearEffects() {
    this.visuals.clear();
    this.hitTime = 0;
    this.bigHitTime = 0;
    this.critTime = 0;
    this.reticle.dataset.hit = 'false';
    this.reticle.dataset.big = 'false';
    this.reticle.dataset.crit = 'false';
  }

  // Both of the above.
  reset() {
    this.cancelActions();
    this.clearEffects();
  }

  // A new encounter (RESTART ENCOUNTER, RESET, RESTART RANDOM): as reset(), and
  // both magazines are full again (review fix 5.23).
  resetEncounter() {
    this.reset();
    this.goodFlash = 0;
    [PLAYER_WEAPON.m416, PLAYER_WEAPON.pistol].forEach((weapon, index) => {
      this.ammo[index].mag = weapon.magazine;
      this.ammo[index].reserve = weapon.reserve;
    });
    this.updateAmmoHud();
  }

  updateAmmoHud() {
    const ammo = this.ammoState;
    const reloading = this.reloadRemaining > 0;
    this.ammoReadout.dataset.reloading = String(reloading);
    this.ammoReadout.dataset.empty = String(!reloading && ammo.mag <= 0);
    this.gunSlots.forEach((slot, index) => {
      const active = index === this.p.target.weaponIndex;
      const weapon = index === 0 ? PLAYER_WEAPON.m416 : PLAYER_WEAPON.pistol;
      const state = this.ammo[index];
      // While reloading, the equipped gun's colour refills over the reload time.
      const fraction = active && reloading ? 1 - this.reloadRemaining / this.reloadTotal : state.mag / weapon.magazine;
      slot.dataset.active = String(active);
      slot.dataset.level = active && reloading ? 'reloading' : state.mag <= 0 ? 'empty' : fraction <= 0.25 ? 'low' : 'ok';
      slot.style.setProperty('--ammo', fraction.toFixed(3));
    });
  }

  update(dt) {
    this.reticle.hidden = !this.available;
    this.ammoReadout.hidden = !this.available;
    // The blue glow fades even while weapons are unavailable (e.g. on the kill shot).
    this.goodFlash = Math.max(0, this.goodFlash - dt / BIG_HIT.edgeGlowTime);
    document.documentElement.style.setProperty('--good-flash', this.goodFlash.toFixed(3));
    if (!this.available) {
      // The gun just became unavailable (paused, POV, TOP view, the fight is over):
      // let go of it once. A pause only releases the controls, so a reload resumes.
      if (this.wasAvailable) {
        if (this.p.paused) this.releaseControls();
        else this.cancelActions();
      }
      this.wasAvailable = false;
      // Tracers and sparks keep fading, so the kill shot is seen (frozen while paused).
      this.visuals.update(dt);
      return;
    }
    this.wasAvailable = true;
    if (this.p.target.aimHeld) this.p.target.holdAim();
    this.remaining = Math.max(0, this.remaining - dt);
    // A reload belongs to the gun it started on; switching guns or jumping abandons it.
    if (this.reloadRemaining > 0 && (this.reloadWeapon !== this.p.target.weaponIndex || this.p.target.jumpState)) {
      this.cancelReload();
    }
    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
      if (!this.reloadSoundPlayed && this.reloadTotal - this.reloadRemaining >= this.weapon.reloadSoundAt) {
        this.reloadSoundPlayed = true;
        this.reloadVoice = this.p.audio.play(this.weapon.reloadSound);
      }
      if (this.reloadRemaining === 0) this.finishReload();
    } else if (this.ammoState.mag <= 0 && this.remaining === 0) {
      // Automatic reload once the last round's shot has finished.
      this.reload();
    }
    // Automatic fire while the trigger is held. It stops at an empty magazine
    // (the reload starts above) rather than clicking through the reload.
    if (this.triggerHeld && this.weapon.automatic && this.remaining === 0
      && this.reloadRemaining === 0 && this.ammoState.mag > 0) this.fire();
    this.visuals.update(dt);
    this.hitTime = Math.max(0, this.hitTime - dt);
    if (!this.hitTime) this.reticle.dataset.hit = 'false';
    this.critTime = Math.max(0, (this.critTime ?? 0) - dt);
    this.reticle.dataset.crit = String(this.critTime > 0);
    this.bigHitTime = Math.max(0, this.bigHitTime - dt);
    this.reticle.dataset.big = String(this.bigHitTime > 0);
    this.updateAmmoHud();
  }
}
