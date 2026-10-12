import * as THREE from 'three';

export const PLAYER_WEAPON = Object.freeze({ damage: 10, interval: 1, range: 60, flashTime: 0.07 });

// Instant bullet, with a separate camera sight ray and muzzle ray so nearby cover wins.
export function bulletHit(geometry, enemies, origin, direction, range) {
  const cover = geometry.hit(origin, direction, range);
  const ray = new THREE.Raycaster(origin, direction, 0, range);
  const enemy = ray.intersectObjects(enemies, true)[0];
  const hitEnemy = !!enemy && enemy.distance < (cover?.distance ?? Infinity);
  return { enemy: hitEnemy, distance: (hitEnemy ? enemy.distance : cover?.distance) ?? range };
}

export class PlayerWeapon {
  constructor(playtest) {
    this.p = playtest;
    this.remaining = 0;
    this.effects = [];
    this.reticle = document.createElement('div');
    this.reticle.id = 'playerReticle';
    this.reticle.textContent = '+';
    this.reticle.setAttribute('aria-label', 'Gun aiming reticle');
    document.body.append(this.reticle);
    const canvas = playtest.engine.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (event.button === 0 && !event.shiftKey) this.fire();
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  get available() {
    const p = this.p;
    return p.walking && p.brain.ready && !p.combat.dead && !p.pov.active
      && p.cameraController.mode === 'CHASE' && !document.hidden;
  }

  enemyMeshes() {
    const rig = this.p.simulation.rig;
    return [rig.robot, ...rig.legs.flatMap(leg => Object.values(leg).filter(value => value?.isObject3D))];
  }

  fire() {
    if (!this.available || this.remaining > 0 || !this.p.target.startShot()) return false;
    const p = this.p, scale = p.world.scale;
    this.remaining = PLAYER_WEAPON.interval;
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
    this.tracer(origin, end);
    this.reticle.dataset.hit = String(hit.enemy);
    if (hit.enemy) p.combat.damageLeaper(PLAYER_WEAPON.damage);
    return true;
  }

  tracer(origin, end) {
    const p = this.p;
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe2a2, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(geometry, material);
    p.engine.scene.add(line);
    this.effects.push({ mesh: line, age: 0 });
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe8af, transparent: true, opacity: 0.9 }));
    const direction = end.clone().sub(origin).normalize();
    flash.position.copy(origin).addScaledVector(direction, 0.05 * p.world.scale);
    flash.scale.setScalar(p.world.scale);
    flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    p.engine.scene.add(flash);
    this.effects.push({ mesh: flash, age: 0 });
  }

  clearEffects() {
    for (const { mesh } of this.effects) {
      this.p.engine.scene.remove(mesh);
      mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.effects.length = 0;
  }

  reset() {
    this.remaining = 0;
    this.p.target.cancelShot();
    this.clearEffects();
    this.reticle.dataset.hit = 'false';
  }

  update(dt) {
    this.reticle.hidden = !this.available;
    if (!this.available) { this.reset(); return; }
    this.remaining = Math.max(0, this.remaining - dt);
    for (const effect of this.effects) {
      effect.age += dt;
      effect.mesh.material.opacity = Math.max(0, 1 - effect.age / PLAYER_WEAPON.flashTime);
    }
    if (this.effects.length && this.effects[0].age >= PLAYER_WEAPON.flashTime) this.clearEffects();
    if (this.remaining < PLAYER_WEAPON.interval - 0.15) this.reticle.dataset.hit = 'false';
  }
}
