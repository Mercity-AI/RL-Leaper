import * as THREE from 'three';
import { LaserAudio } from './LaserAudio.js';
import { createLaserVisual } from './LaserVisual.js';
import { COMBAT } from '../config/combat.js';
import { AttackController } from './AttackController.js';
import { CombatGeometry, aimAngles, withinAim, capsuleHit } from './CombatGeometry.js';

export class LeaperCombat {
  constructor(playtest) {
    this.playtest = playtest;
    this.config = COMBAT;
    this.tree = new AttackController(this.config);
    this.geometry = new CombatGeometry(playtest.world.map);
    this.direction = new THREE.Vector3(0, 0, 1);
    this.origin = new THREE.Vector3();
    this.bolts = []; this.effects = [];
    this.selectedPoint = null;
    const rig = playtest.simulation.rig;
    rig.weaponControlled = true;
    // Eye materials are independent: the warning must not brighten all six legs.
    this.eyeMaterials = rig.eyePivot.children.filter(o => o.material?.emissive).map(o => {
      o.material = o.material.clone();
      return { material: o.material, base: o.material.emissiveIntensity };
    });
    this.laser = createLaserVisual(COMBAT);
    this.audio = new LaserAudio();
    const sound = document.createElement('button');
    sound.textContent = 'SOUND: ON';
    sound.setAttribute('aria-pressed', 'true');
    sound.onclick = () => {
      this.audio.enabled = !this.audio.enabled;
      if (this.audio.enabled) this.audio.unlock();
      sound.textContent = this.audio.enabled ? 'SOUND: ON' : 'SOUND: OFF';
      sound.setAttribute('aria-pressed', String(this.audio.enabled));
    };
    playtest.panel.querySelector('.junkyard-toolbar').append(sound);
    this.effectGeometry = new THREE.SphereGeometry(1, 10, 8);
    this.effectMaterial = new THREE.MeshBasicMaterial({ color: 0xb50913, transparent: true, opacity: 0.45 });
    this.enemyHud = document.createElement('div');
    this.enemyHud.id = 'leaperHealthHud';
    this.enemyHud.innerHTML = '<b>LEAPER</b><progress aria-label="Leaper health"></progress>';
    document.body.append(this.enemyHud);
    this.hud = document.createElement('div');
    this.hud.id = 'combatHud';
    this.hud.innerHTML = `<div class="combat-health"><b>LOLA <span data-hit-label hidden>HIT</span></b><progress aria-label="Lola health" data-health-bar max="100" value="100"></progress></div>
      <div data-attack role="status"></div><div data-result hidden><strong></strong><button data-restart>RESTART ENCOUNTER</button></div>`;
    document.body.appendChild(this.hud);
    this.enemyHud.append(this.hud.querySelector('[data-attack]'));
    this.hud.querySelector('[data-restart]').onclick = () => { playtest.reset(); playtest.start(); };
    const debug = document.createElement('button');
    debug.textContent = 'DEBUG: DAMAGE LEAPER';
    debug.dataset.action = 'debug-damage';
    debug.onclick = () => this.damageLeaper(COMBAT.debugDamage, true);
    playtest.panel.querySelector('#junkyardOptions').append(debug);
    const note = document.createElement('small');
    note.textContent = 'Debug health test. Q switches guns; left click fires in CHASE view.';
    playtest.panel.querySelector('#junkyardOptions').append(note);
    this.reset();
  }
  get dead() { return this.lolaHealth <= 0 || this.leaperHealth <= 0; }
  reset() {
    this.clearProjectiles(); this.tree.reset(); this.selectedPoint = null;
    this.lolaHealth = this.config.lolaHealth; this.leaperHealth = this.config.leaperHealth;
    this.damageFlash = 0; this.fireFlash = 0;
    this.playtest.target.defeated = false;
    this.playtest.target.clearHitReaction?.();
    this.playtest.simulation.rig.eyePivot.rotation.set(0, 0, 0);
    this.hud.querySelector('[data-result]').hidden = true;
    this.updateHud();
  }
  clearProjectiles() {
    for (const item of [...this.bolts, ...this.effects]) this.playtest.engine.scene.remove(item.mesh);
    this.bolts.length = 0; this.effects.length = 0;
  }
  damageLeaper(amount, debug = false) {
    if (this.dead) return;
    this.leaperHealth = Math.max(0, this.leaperHealth - amount);
    if (!this.leaperHealth) this.finish(debug ? 'LEAPER DEFEATED · DEBUG TEST' : 'LEAPER DEFEATED');
    this.updateHud();
  }
  damageLola(incomingDirection = null) {
    if (this.dead) return;
    this.lolaHealth = Math.max(0, this.lolaHealth - this.config.boltDamage);
    this.damageFlash = 0.4;
    this.playtest.target.reactToHit?.(incomingDirection);
    if (!this.lolaHealth) this.finish('LOLA DEFEATED');
    this.updateHud();
  }
  finish(message) {
    this.tree.cancel(); this.tree.state = 'dead'; this.clearProjectiles();
    this.playtest.target.clearHitReaction?.();
    this.playtest.target.defeated = true;
    this.playtest.stop('Encounter ended. Restart to play again.');
    const result = this.hud.querySelector('[data-result]');
    result.hidden = false; result.querySelector('strong').textContent = message;
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
    const paused = !p.walking || !p.brain.ready || document.hidden;
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
    if (!paused) { this.damageFlash = Math.max(0, this.damageFlash - dt); this.fireFlash = Math.max(0, this.fireFlash - dt); }
    const charge = this.tree.started === null ? 0 : Math.min(1, (this.tree.time - this.tree.started) / c.warning);
    for (const { material, base } of this.eyeMaterials) material.emissiveIntensity = this.leaperHealth ? base + charge * 8 + this.fireFlash * 20 : 0;
    rig.eyeLight.intensity = this.leaperHealth ? 1 + charge * 5 + this.fireFlash * 10 : 0;
    this.updateHud();
  }
  updateHud() {

    const bar = this.hud.querySelector('[data-health-bar]');
    bar.max = this.config.lolaHealth; bar.value = this.lolaHealth;
    const status = this.dead ? (this.leaperHealth ? 'encounter ended' : 'defeated')
      : this.fireFlash > 0 && this.tree.state !== 'paused' ? 'firing' : this.tree.state;
    this.enemyHud.querySelector('[data-attack]').textContent = `${status.toUpperCase()}${this.tree.locked ? ' · AIM LOCKED' : ''}`;
    const enemyBar = this.enemyHud.querySelector('progress');
    enemyBar.max = this.config.leaperHealth; enemyBar.value = this.leaperHealth;
    this.hud.querySelector('[data-hit-label]').hidden = this.damageFlash <= 0 || this.dead;
    // Ordinary hits briefly highlight the health readout; screen edges are
    // reserved for critical health, including while paused.
    this.hud.dataset.hit = String(this.damageFlash > 0 && !this.dead);
    const low = this.lolaHealth <= this.config.lowHealthThreshold;
    const opacity = low ? 0.15 + 0.2 * (1 - this.lolaHealth / this.config.lowHealthThreshold) : 0;
    document.documentElement.style.setProperty('--damage-flash', String(opacity));
  }
}
