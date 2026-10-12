import * as THREE from 'three';
import { GunshotEffects } from './GunshotEffects.js';

export const PLAYER_WEAPON = Object.freeze({
  range: 60,
  m416: Object.freeze({ damage: 2, interval: 0.12, rifle: true }),
  pistol: Object.freeze({ damage: 6, interval: 0.6, rifle: false }),
});

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
    this.visuals = new GunshotEffects(playtest.engine.scene, playtest.world.scale);
    this.effects = this.visuals.items;
    this.hitTime = 0;
    this.reticle = document.createElement('div');
    this.reticle.id = 'playerReticle';
    this.reticle.textContent = '+';
    this.reticle.setAttribute('aria-label', 'Gun aiming reticle');
    document.body.append(this.reticle);
    const canvas = playtest.engine.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (event.button === 0) this.fire();
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  get weapon() { return this.p.target.weaponIndex === 0 ? PLAYER_WEAPON.m416 : PLAYER_WEAPON.pistol; }

  get available() {
    const p = this.p;
    return !p.combat.dead && !p.pov.active
      && p.cameraController.mode === 'CHASE' && !document.hidden;
  }

  enemyMeshes() {
    const rig = this.p.simulation.rig;
    return [rig.robot, ...rig.legs.flatMap(leg => Object.values(leg).filter(value => value?.isObject3D))];
  }

  fire() {
    if (!this.available || this.remaining > 0 || !this.p.target.startShot(this.weapon.interval)) return false;
    const p = this.p, scale = p.world.scale;
    this.remaining = this.weapon.interval;
    p.engine.scene.updateMatrixWorld(true);
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
    this.reticle.dataset.hit = String(hit.enemy);
    if (hit.enemy) {
      const normal = hit.intersection.face.normal.clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.intersection.object.matrixWorld)).normalize();
      this.visuals.impact(end, normal, this.weapon.rifle);
      this.hitTime = 0.15;
      p.combat.damageLeaper(this.weapon.damage);
    }
    return true;
  }

  clearEffects() { this.visuals.clear(); }

  beforeRender() {
    if (!this.p.pov.active) this.visuals.beforeRender(this.p.simulation.rig.robot);
  }
  afterRender() { this.visuals.afterRender(this.p.simulation.rig.robot); }

  reset() {
    this.remaining = 0;
    this.hitTime = 0;
    this.p.target.cancelShot();
    this.clearEffects();
    this.reticle.dataset.hit = 'false';
  }

  update(dt) {
    this.reticle.hidden = !this.available;
    if (!this.available) { this.reset(); return; }
    this.remaining = Math.max(0, this.remaining - dt);
    this.visuals.update(dt);
    this.hitTime = Math.max(0, this.hitTime - dt);
    if (!this.hitTime) this.reticle.dataset.hit = 'false';
  }
}
