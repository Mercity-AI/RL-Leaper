import * as THREE from 'three';
import { LeaperLegDamage } from './LeaperLegDamage.js';
import { createLaserVisual } from './LaserVisual.js';
import { COMBAT } from '../config/tuning/index.js';
import { AttackController } from './AttackController.js';
import { CombatGeometry, aimAngles, withinAim, capsuleHit } from './CombatGeometry.js';
import { LeaperHealthBar } from './LeaperHealthBar.js';
import { MOVEMENT } from '../config/robot.js';
import { GAME_EVENTS } from '../core/events.js';
import { TRAIL_HOLD, TRAIL_DRAIN } from '../game/PlayerVitals.js';

// One Leaper's side of the fight: its health and weak point, its attack behaviour
// tree, bolts, leg damage, eye glow and its own HUD panel (#leaperHealthHud).
// Lola's health and HUD live in PlayerVitals (playtest.vitals), and the shared
// sound engine is passed in (playtest.audio); this class only uses them.
export class LeaperCombat {
  constructor(playtest) {
    this.playtest = playtest;
    // The one sound engine, created by the junkyard mode (it also plays guns and steps).
    this.audio = playtest.audio;
    this.config = COMBAT;
    this.tree = new AttackController(this.config);
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
    this.enemyHud = document.createElement('div');
    this.enemyHud.id = 'leaperHealthHud';
    // Leaper health is drawn by the floating bar over the Leaper; this panel keeps
    // its name and attack status (plus a hidden progress value for screen readers).
    this.enemyHud.innerHTML = `<b>LEAPER</b><progress aria-label="Leaper health"></progress><div data-attack role="status"></div>`;
    document.body.append(this.enemyHud);
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
    this.outcome = null;
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
    this.enemyHud.remove();
    this.healthBar.element.remove();
    this.effectGeometry.dispose();
    this.effectMaterial.dispose();
  }
  // major: a joint snapped, which always brings up the floating health bar.
  damageLeaper(amount, debug = false, major = false) {
    if (this.dead) return;
    const before = this.leaperHealth;
    this.leaperHealth = Math.max(0, this.leaperHealth - amount);
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
  // A bolt reached Lola. Her health is PlayerVitals' business; this Leaper only
  // stops fighting once she is down.
  damageLola(incomingDirection = null) {
    if (this.dead) return;
    this.playtest.vitals.damage(this.config.boltDamage, incomingDirection);
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
  updateProjectiles(dt, points) {
    const scale = this.playtest.world.scale;
    for (const bolt of [...this.bolts]) {
      const distance = Math.min(this.config.projectileSpeed * scale * dt,
        this.config.weaponRange * scale - bolt.travelled);
      const cover = this.geometry.hit(bolt.mesh.position, bolt.direction, distance);
      const body = capsuleHit(bolt.mesh.position, bolt.direction, points[1], points[2], this.config.bodyRadius * scale);
      const head = capsuleHit(bolt.mesh.position, bolt.direction, points[0], points[0], this.config.headRadius * scale);
      const playerDistance = Math.min(body, head);
      const hitDistance = Math.min(cover?.distance ?? Infinity, playerDistance);
      bolt.mesh.position.addScaledVector(bolt.direction, Math.min(distance, hitDistance));
      bolt.travelled += distance;
      // Grow out of the muzzle; the tail never extends behind the firing eye.
      bolt.mesh.scale.z = scale * Math.min(1, bolt.travelled / (this.config.laserLength * scale));
      if (hitDistance <= distance || bolt.travelled >= this.config.weaponRange * scale) {
        // No impact orb: damage is communicated by the health bar until a hit animation is supplied.
        this.playtest.engine.scene.remove(bolt.mesh); this.bolts.splice(this.bolts.indexOf(bolt), 1);
        // Cover wins ties. Never damage Lola through a blocking triangle.
        if (playerDistance <= distance && playerDistance < (cover?.distance ?? Infinity)) this.damageLola(bolt.direction);
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
    const range = c.weaponRange * p.world.scale;
    const visible = points.map(point => {
      const delta = point.clone().sub(this.origin);
      const yaw = Math.atan2(delta.x, delta.z) - p.simulation.state.yaw;
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      return delta.length() <= range && Math.abs(wrapped) <= c.detectionHalfAngle && this.geometry.clear(this.origin, point);
    });
    if (this.tree.started === null) this.selectedPoint = [1, 0, 2].find(i => visible[i]
      && withinAim(aimAngles(rig.robot, points[i].clone().sub(this.origin).normalize()), c));
    const anyVisible = visible.some(Boolean);
    const point = points[this.selectedPoint];
    const selectedVisible = point && visible[this.selectedPoint];
    const canAim = selectedVisible && withinAim(aimAngles(rig.robot, point.clone().sub(this.origin).normalize()), c);
    if (this.tree.locked && withinAim(aimAngles(rig.robot, this.direction), c)) this.applyAim();
    if (!paused && !this.dead) this.updateProjectiles(dt, points);
    this.tree.tick(dt, {
      dead: this.dead, paused,
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
    if (!paused) this.fireFlash = Math.max(0, this.fireFlash - dt);
    const charge = this.tree.started === null ? 0 : Math.min(1, (this.tree.time - this.tree.started) / c.warning);
    // The floating bar's pale trail: holds briefly after a hit, then drains.
    const health = this.leaperHealth / c.leaperHealth, trail = this.trail;
    if (trail.value <= health) trail.value = health;
    else if (trail.hold > 0) trail.hold = Math.max(0, trail.hold - dt);
    else trail.value = Math.max(health, trail.value - TRAIL_DRAIN * dt);
    for (const { material, base } of this.eyeMaterials) material.emissiveIntensity = this.leaperHealth ? base + charge * 8 + this.fireFlash * 20 : 0;
    rig.eyeLight.intensity = this.leaperHealth ? 1 + charge * 5 + this.fireFlash * 10 : 0;
    this.corePulse = (this.corePulse ?? 0) + dt;
    if (this.core) this.core.material.emissiveIntensity = this.leaperHealth
      ? 2.6 + 1.4 * Math.sin(this.corePulse * 5) + charge * 6 + this.fireFlash * 15 : 0;
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
  // The Leaper panel: what the attack is doing, plus its health for screen readers.
  updateHud() {
    const status = this.dead ? (this.leaperHealth ? 'encounter ended' : 'defeated')
      : this.fireFlash > 0 && this.tree.state !== 'paused' ? 'firing' : this.tree.state;
    this.enemyHud.querySelector('[data-attack]').textContent = `${status.toUpperCase()}${this.tree.locked ? ' · AIM LOCKED' : ''}`;
    const enemyBar = this.enemyHud.querySelector('progress');
    enemyBar.max = this.config.leaperHealth; enemyBar.value = this.leaperHealth;
  }
}
