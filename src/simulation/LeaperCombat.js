import * as THREE from 'three';
import { LeaperLegDamage } from './LeaperLegDamage.js';
import { createLaserVisual } from './LaserVisual.js';
import { attackRange } from '../config/combat.js';
import { COMBAT } from '../config/tuning/index.js';
import { RAY_MAX_RANGE, TARGET_RADIUS } from '../brain/junkyard/frozenEnv.js';
import { AttackController } from './AttackController.js';
import { CombatGeometry, aimAngles, withinAim, capsuleHit } from './CombatGeometry.js';
import { LeaperHealthBar } from './LeaperHealthBar.js';
import { MOVEMENT } from '../config/robot.js';
import { GAME_EVENTS } from '../core/events.js';
import { TRAIL_HOLD, TRAIL_DRAIN } from '../game/PlayerVitals.js';
import { LeaperHudView } from '../ui/LeaperHudView.js';
import { LEAPER_BEHAVIOUR } from '../config/leaper-behaviour.js';

// What the frozen brain can see (read from its JS port, which the parity tests
// prove identical to the Python recipe): Lola's centre within 28 + 1.4 units.
export const BRAIN_SIGHT = Object.freeze({ sightRange: RAY_MAX_RANGE, targetRadius: TARGET_RADIUS });

// One Leaper's side of the fight: its health and weak point, its attack behaviour
// tree, bolts, leg damage, eye glow and its own HUD panel (#leaperHealthHud).
// Lola's health and HUD live in PlayerVitals (playtest.vitals), and the shared
// sound engine is passed in (playtest.audio); this class only uses them.
// Its behaviour layer (src/actors/leaper/LeaperActor.js, `this.behaviour`) may
// hold the eye's bolts (`hold`), scale the damage it takes (`damageScale`,
// while downed), dim its lights as it dies (`dyingGlow`) and hears every hit
// (`onDamaged`).
export class LeaperCombat {
  constructor(playtest) {
    this.playtest = playtest;
    // The one sound engine, created by the junkyard mode (it also plays guns and steps).
    this.audio = playtest.audio;
    this.config = COMBAT;
    // The eye's bolts. Its wind-up is a telegraph: a growing glow, a sound when it
    // starts charging and when the aim locks (optional sound slots).
    this.tree = new AttackController(this.config, {
      onStart: () => this.audio.playSlot?.('leaperCharge'),
      onLock: () => {
        this.lockFlash = 0.12;
        this.audio.playSlot?.('leaperLock');
      },
    });
    this.geometry = new CombatGeometry(playtest.world.map);
    this.direction = new THREE.Vector3(0, 0, 1);
    this.origin = new THREE.Vector3();
    this.bolts = []; this.effects = [];
    this.selectedPoint = null;
    const rig = playtest.simulation.rig;
    rig.weaponControlled = true;
    this.legs = new LeaperLegDamage(playtest.engine.scene, rig, this.geometry);
    // A severed leg piece hitting the ground gives the camera a thud.
    this.legs.onLanded = () => playtest.cameraController?.shake(COMBAT.cameraShake.legLanding);
    // Eye materials are independent: the warning must not brighten all six legs.
    this.eyeMaterials = rig.eyePivot.children.filter(o => o.material?.emissive && !o.userData.weakPoint).map(o => {
      o.material = o.material.clone();
      return { material: o.material, base: o.material.emissiveIntensity };
    });
    // The red weak-point core pulses on its own rhythm.
    this.core = rig.eyePivot.children.find(o => o.userData.weakPoint);
    if (this.core) this.core.material = this.core.material.clone();
    this.healthBar = new LeaperHealthBar(COMBAT.healthBar);
    this.laser = createLaserVisual(COMBAT);
    this.effectGeometry = new THREE.SphereGeometry(1, 10, 8);
    this.effectMaterial = new THREE.MeshBasicMaterial({ color: 0xb50913, transparent: true, opacity: 0.45 });
    // The charge glow: a halo in front of the lens that swells during the
    // wind-up and flashes when the aim locks (the telegraph before each bolt).
    this.haloMaterial = new THREE.MeshBasicMaterial({ color: 0xff3010, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.halo = new THREE.Mesh(this.effectGeometry, this.haloMaterial);
    this.halo.position.set(0, 0, 0.17);
    this.halo.visible = false;
    // Light, not armour: bullets aimed at the eye's core pass straight through it.
    this.halo.raycast = () => {};
    rig.eyePivot.add(this.halo);
    // The Leaper's panel: health, what it is doing, the eye's status (and with
    // ?debug its behaviour state machine). The old id and fields stay for tools.
    this.hud = new LeaperHudView({ debug: new URLSearchParams(globalThis.location?.search ?? '').has('debug') });
    this.enemyHud = this.hud.element;
    const debug = document.createElement('button');
    debug.textContent = 'DEBUG: DAMAGE LEAPER';
    debug.dataset.action = 'debug-damage';
    debug.onclick = () => this.damageLeaper(COMBAT.debugDamage, true);
    playtest.panel.querySelector('#junkyardOptions').append(debug);
    const note = document.createElement('small');
    note.textContent = 'Debug health test. 1 / 2 switch guns; left click fires in CHASE view.';
    playtest.panel.querySelector('#junkyardOptions').append(note);
    this.reset();
  }
  // Lola's health, read from PlayerVitals (kept here for older tools and tests).
  get lolaHealth() { return this.playtest.vitals.health; }
  // This Leaper's fight is over once it is down or Lola is.
  get dead() { return this.leaperHealth <= 0 || this.playtest.vitals.dead; }
  // A fresh Leaper: full health, legs back on, no bolts, attack timers cleared.
  // (Lola's own health is reset by PlayerVitals; the encounter resets both.)
  reset() {
    this.legs.reset();
    this.audio.stop();
    this.clearProjectiles(); this.tree.reset(); this.selectedPoint = null;
    this.leaperHealth = this.config.leaperHealth;
    this.fireFlash = 0;
    this.lockFlash = 0;
    this.outcome = null;
    // The behaviour layer's switches back to normal.
    this.hold = null;
    this.damageScale = 1;
    this.dyingGlow = undefined;
    this.trail = { value: 1, hold: 0 };
    this.playtest.simulation.rig.eyePivot.rotation.set(0, 0, 0);
    this.healthBar.reset();
    this.updateHud();
  }
  clearProjectiles() {
    for (const item of [...this.bolts, ...this.effects]) this.playtest.engine.scene.remove(item.mesh);
    this.bolts.length = 0; this.effects.length = 0;
  }
  // The session is over: bolts and severed-leg debris leave the scene, this
  // Leaper's HUD panel and floating bar leave the page. (The rig itself is freed
  // by the mode, together with the eye materials cloned above.)
  dispose() {
    this.clearProjectiles();
    this.legs.reset();
    this.hud.dispose();
    this.healthBar.element.remove();
    this.halo.parent?.remove(this.halo);
    this.effectGeometry.dispose();
    this.effectMaterial.dispose();
    this.haloMaterial.dispose();
  }
  // major: a joint snapped, which always brings up the floating health bar.
  // hit (optional, from the gun): { weakPoint, point, normal } of the bullet, so
  // the hull can spark where it was struck and a weak-point crit can stagger it.
  // While downed (its behaviour's damageScale) bullets do more; the debug button does not.
  damageLeaper(amount, debug = false, major = false, hit = {}) {
    // (A gun that does not say so may still have hit the core: it reported the
    // bullet to legs.hit first, which remembers that.)
    const weakPoint = this.legs.takeWeakPointHit() || Boolean(hit.weakPoint);
    if (this.dead) return;
    amount *= debug ? 1 : this.damageScale ?? 1;
    const before = this.leaperHealth;
    this.leaperHealth = Math.max(0, this.leaperHealth - amount);
    this.onDamaged?.({ amount: before - this.leaperHealth, major, debug, weakPoint,
      point: hit.point ?? null, normal: hit.normal ?? null });
    // Tell the game what happened (results, and later the HUD and sound).
    this.playtest.events?.emit(GAME_EVENTS.leaperDamaged, { amount: before - this.leaperHealth, health: this.leaperHealth, major, debug });
    if (major) this.playtest.events?.emit(GAME_EVENTS.jointBroken, { health: this.leaperHealth });
    this.trail.hold = TRAIL_HOLD;
    this.healthBar.damage(amount, this.config.leaperHealth, major || !this.leaperHealth);
    // A big hit (a leg snapping off, or the kill shot) shakes the camera.
    if (major || !this.leaperHealth) this.playtest.cameraController?.shake(COMBAT.cameraShake.bigHit);
    if (!this.leaperHealth) this.finish('lola', { debug });
    this.updateHud();
  }
  // A bolt (or a stomp, a landing shockwave: `amount`) reached Lola. Her health
  // is PlayerVitals' business; this Leaper only stops fighting once she is down.
  damageLola(incomingDirection = null, amount = this.config.boltDamage) {
    if (this.dead) return;
    this.playtest.vitals.damage(amount, incomingDirection);
    if (this.playtest.vitals.dead) this.finish('leaper');
    this.updateHud();
  }
  // Someone is down. winner: 'lola' | 'leaper'; debug: the debug button landed the
  // kill. This Leaper's attack stops here; whether the whole fight is over (every
  // Leaper down, or Lola) is the game's call, as are the result banner and
  // Lola's `defeated` flag.
  finish(winner, { debug = false } = {}) {
    this.tree.cancel(); this.tree.state = 'dead'; this.clearProjectiles();
    this.outcome = { winner, debug };
    this.playtest.combatFinished(this);
  }
  pose() {
    const { simulation, sight, target } = this.playtest;
    simulation.rig.robot.updateMatrixWorld(true);
    target.mesh.updateMatrixWorld(true);
    this.origin.copy(simulation.rig.eyePivot.localToWorld(new THREE.Vector3(0, 0, 0.148)));
    return sight.bones[target.weaponIndex].map(bone => bone.getWorldPosition(new THREE.Vector3()));
  }
  track(point) {
    const rig = this.playtest.simulation.rig;
    const center = rig.eyePivot.getWorldPosition(new THREE.Vector3());
    this.direction.copy(point).sub(center).normalize();
    this.applyAim();
    this.lockDistance = this.origin.distanceTo(point);
  }
  applyAim() {
    const rig = this.playtest.simulation.rig;
    const angles = aimAngles(rig.robot, this.direction);
    rig.eyePivot.rotation.set(-angles.pitch, angles.yaw, 0, 'YXZ');
    rig.robot.updateMatrixWorld(true);
    this.origin.copy(rig.eyePivot.localToWorld(new THREE.Vector3(0, 0, 0.148)));
  }
  fire() {
    const mesh = this.laser.create();
    mesh.scale.setScalar(this.playtest.world.scale);
    mesh.scale.z = 0.001;
    mesh.position.copy(this.origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
    this.playtest.engine.scene.add(mesh);
    this.bolts.push({ mesh, direction: this.direction.clone(), travelled: 0 });
    this.fireFlash = 0.12;
    this.audio.fire();
    this.effect(this.origin, true);
  }
  effect(position, muzzle = false) {
    const mesh = new THREE.Mesh(this.effectGeometry, this.effectMaterial);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.09 * this.playtest.world.scale);
    this.playtest.engine.scene.add(mesh);
    this.effects.push({ mesh, age: 0, muzzle });
  }
  // How far the eye can shoot: the bolt range, but never beyond the brain's own
  // sight (review fix 5.31), so it never fires while its brain is SEARCHING.
  range() {
    return attackRange(this.playtest.world.scale, BRAIN_SIGHT, this.config);
  }
  updateProjectiles(dt, points) {
    const scale = this.playtest.world.scale, range = this.range();
    for (const bolt of [...this.bolts]) {
      const distance = Math.min(this.config.projectileSpeed * scale * dt, range - bolt.travelled);
      const cover = this.geometry.hit(bolt.mesh.position, bolt.direction, distance);
      const body = capsuleHit(bolt.mesh.position, bolt.direction, points[1], points[2], this.config.bodyRadius * scale);
      const head = capsuleHit(bolt.mesh.position, bolt.direction, points[0], points[0], this.config.headRadius * scale);
      const playerDistance = Math.min(body, head);
      const hitDistance = Math.min(cover?.distance ?? Infinity, playerDistance);
      bolt.mesh.position.addScaledVector(bolt.direction, Math.min(distance, hitDistance));
      bolt.travelled += distance;
      // Grow out of the muzzle; the tail never extends behind the firing eye.
      bolt.mesh.scale.z = scale * Math.min(1, bolt.travelled / (this.config.laserLength * scale));
      if (hitDistance <= distance || bolt.travelled >= range) {
        // No impact orb: damage is communicated by the health bar until a hit animation is supplied.
        this.playtest.engine.scene.remove(bolt.mesh); this.bolts.splice(this.bolts.indexOf(bolt), 1);
        // Cover wins ties. Never damage Lola through a blocking triangle.
        if (playerDistance <= distance && playerDistance < (cover?.distance ?? Infinity)) this.damageLola(bolt.direction);
        else if (cover && cover.distance <= distance) this.audio.playSlot?.('leaperBoltImpact', { at: bolt.mesh.position });
        if (this.dead) break;
      }
    }
    for (const effect of [...this.effects]) {
      effect.age += dt;
      effect.mesh.scale.setScalar((0.09 + effect.age * 0.5) * scale);
      if (effect.age >= 0.18) {
        this.playtest.engine.scene.remove(effect.mesh); this.effects.splice(this.effects.indexOf(effect), 1);
      }
    }
  }
  update(dt) {
    const p = this.playtest, rig = p.simulation.rig, c = this.config;
    if (!document.hidden) this.legs.update(dt);
    // The attacks run whenever a run is on, brain or no brain: without the brain
    // service the Leaper stands still but still tracks and fires (turret mode).
    const paused = !p.walking || document.hidden;
    const points = this.pose();
    const range = this.range();
    const visible = points.map(point => {
      const delta = point.clone().sub(this.origin);
      const yaw = Math.atan2(delta.x, delta.z) - p.simulation.state.yaw;
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      return delta.length() <= range && Math.abs(wrapped) <= c.detectionHalfAngle && this.geometry.clear(this.origin, point);
    });
    if (this.tree.started === null) this.selectedPoint = [1, 0, 2].find(i => visible[i]
      && withinAim(aimAngles(rig.robot, points[i].clone().sub(this.origin).normalize()), c));
    const anyVisible = visible.some(Boolean);
    // The eye's line of fire to Lola, for the behaviour layer (Engage holds while it lasts).
    this.lolaVisible = anyVisible;
    const point = points[this.selectedPoint];
    const selectedVisible = point && visible[this.selectedPoint];
    const canAim = selectedVisible && withinAim(aimAngles(rig.robot, point.clone().sub(this.origin).normalize()), c);
    if (this.tree.locked && withinAim(aimAngles(rig.robot, this.direction), c)) this.applyAim();
    if (!paused && !this.dead) this.updateProjectiles(dt, points);
    this.tree.tick(dt, {
      dead: this.dead, paused, held: Boolean(this.hold),
      visible: this.tree.started !== null ? selectedVisible : anyVisible,
      canAim: canAim && (!this.tree.locked || withinAim(aimAngles(rig.robot, this.direction), c)),
      track: () => this.track(point),
      pathClear: locked => locked
        ? !this.geometry.hit(this.origin, this.direction, this.lockDistance)
        : this.geometry.clear(this.origin, point),
      fire: () => this.fire(),
    });
    // After a cancelled lock, clamp the physical eye rather than allowing a
    // body turn to leave the spectator direction detached from the lens.
    rig.eyePivot.rotation.y = THREE.MathUtils.clamp(rig.eyePivot.rotation.y, -c.yawLimit, c.yawLimit);
    rig.eyePivot.rotation.x = THREE.MathUtils.clamp(rig.eyePivot.rotation.x, -c.pitchUp, -c.pitchDown);
    rig.robot.updateMatrixWorld(true);
    rig.eyePivot.getWorldDirection(this.direction);
    this.origin.copy(rig.eyePivot.localToWorld(new THREE.Vector3(0, 0, 0.148)));
    if (!paused) {
      this.fireFlash = Math.max(0, this.fireFlash - dt);
      this.lockFlash = Math.max(0, this.lockFlash - dt);
    }
    const charge = this.tree.started === null ? 0 : Math.min(1, (this.tree.time - this.tree.started) / c.warning);
    // The floating bar's pale trail: holds briefly after a hit, then drains.
    const health = this.leaperHealth / c.leaperHealth, trail = this.trail;
    if (trail.value <= health) trail.value = health;
    else if (trail.hold > 0) trail.hold = Math.max(0, trail.hold - dt);
    else trail.value = Math.max(health, trail.value - TRAIL_DRAIN * dt);
    // Eye lights: charge glow and muzzle flash while alive; once destroyed they
    // fade with the collapse (dyingGlow, 1 -> 0; off at once without a behaviour layer).
    const fade = this.dyingGlow ?? 0;
    for (const { material, base } of this.eyeMaterials) material.emissiveIntensity = this.leaperHealth ? base + charge * 8 + this.fireFlash * 20 : base * fade;
    rig.eyeLight.intensity = this.leaperHealth ? 1 + charge * 5 + this.fireFlash * 10 : fade;
    this.corePulse = (this.corePulse ?? 0) + dt;
    if (this.core) this.core.material.emissiveIntensity = this.leaperHealth
      ? 2.6 + 1.4 * Math.sin(this.corePulse * 5) + charge * 6 + this.fireFlash * 15 : 2.6 * fade;
    // The telegraph halo swells with the charge and flashes at the lock.
    const halo = this.leaperHealth ? charge : 0;
    this.halo.visible = halo > 0 || this.lockFlash > 0;
    this.halo.scale.setScalar(Math.max(1e-3, LEAPER_BEHAVIOUR.feedback.eyeHalo * (0.25 + 0.75 * halo) / (rig.robot.scale.x || 1)));
    this.haloMaterial.opacity = Math.min(1, 0.25 + 0.5 * halo + this.lockFlash * 4);
    this.haloMaterial.color.setRGB(1, 0.2 + this.lockFlash * 5, 0.06 + this.lockFlash * 5);
    // The floating bar must be placed with this frame's camera; the junkyard sets
    // healthBarLate and calls updateHealthBar from its late (presentation) phase.
    if (!this.healthBarLate) this.updateHealthBar(dt);
    this.updateHud();
  }
  // Place the floating health bar over the Leaper with the current camera.
  updateHealthBar(dt) {
    const p = this.playtest, c = this.config;
    this.healthBar.update(dt, p.engine.camera, p.simulation.rig.robot, this.leaperHealth / c.leaperHealth, this.trail.value,
      (p.simulation.state.velocity?.length() ?? 0) / MOVEMENT.sprintSpeed, p.engine.renderer?.domElement);
  }
  // The Leaper panel: health, what the Leaper is doing (its behaviour state) and
  // what the eye is doing.
  updateHud() {
    const status = this.dead ? (this.leaperHealth ? 'encounter ended' : 'defeated')
      : this.fireFlash > 0 && this.tree.state !== 'paused' ? 'firing' : this.tree.state;
    this.hud.render({ health: this.leaperHealth, max: this.config.leaperHealth,
      attack: `${status.toUpperCase()}${this.tree.locked ? ' · AIM LOCKED' : ''}`,
      behaviour: this.behaviour?.hudState() ?? null });
  }
}
