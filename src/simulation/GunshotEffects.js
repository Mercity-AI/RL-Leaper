import * as THREE from 'three';

// Short-lived geometry only: no decals, persistent debris or world changes.
export class GunshotEffects {
  constructor(scene, scale) { this.scene = scene; this.scale = scale; this.items = []; this.kick = 0; }
  add(mesh, life, velocity = null) {
    this.scene.add(mesh); this.items.push({ mesh, life, age: 0, velocity }); return mesh;
  }
  shot(origin, end, rifle) {
    const direction = end.clone().sub(origin).normalize();
    const distance = origin.distanceTo(end);
    // Keep the pistol's readable white zip; the rifle leaves a shorter, quieter trace.
    const trailFraction = rifle ? 0.55 : 1;
    const start = origin.clone().addScaledVector(direction, distance * (1 - trailFraction));
    const streak = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({ color: rifle ? 0xffefd0 : 0xfffcf5, transparent: true,
        opacity: rifle ? 0.72 : 0.9, depthWrite: false }));
    this.add(streak, rifle ? 0.11 : 0.14);
    Object.assign(this.items[this.items.length - 1], { origin: origin.clone(), direction, distance,
      trailFraction, initialOpacity: streak.material.opacity });
    const flash = new THREE.Mesh(new THREE.ConeGeometry(rifle ? 0.022 : 0.04, rifle ? 0.22 : 0.15, rifle ? 4 : 5),
      new THREE.MeshBasicMaterial({ color: rifle ? 0xfff2d6 : 0xffebbe, transparent: true, depthWrite: false }));
    flash.position.copy(origin).addScaledVector(direction, 0.065 * this.scale);
    flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    flash.rotateY(Math.random() * Math.PI);
    flash.scale.setScalar(this.scale * (0.8 + Math.random() * 0.4));
    this.add(flash, rifle ? 0.105 : 0.12);
  }
  impact(point, normal, rifle) {
    this.kick = Math.max(this.kick, rifle ? 0.035 : 0.02);
    for (let i = 0; i < (rifle ? 9 : 5); i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5)
        .addScaledVector(normal, 1.2).normalize().multiplyScalar((1.1 + Math.random() * 2) * this.scale);
      const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry((0.018 + Math.random() * 0.012) * this.scale),
        new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffc26d : 0xfff0cb, transparent: true, depthWrite: false }));
      mesh.position.copy(point).addScaledVector(normal, 0.015 * this.scale);
      mesh.scale.z = 2.5;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), velocity.clone().normalize());
      this.add(mesh, 0.15 + Math.random() * 0.17, velocity);
    }
  }
  remove(item) { this.scene.remove(item.mesh); item.mesh.geometry.dispose(); item.mesh.material.dispose(); }
  update(dt) {
    this.kick *= Math.exp(-22 * dt);
    for (const item of [...this.items]) {
      item.age += dt;
      if (item.age >= item.life) { this.remove(item); this.items.splice(this.items.indexOf(item), 1); continue; }
      item.mesh.material.opacity = (item.initialOpacity ?? 1) * (1 - item.age / item.life);
      if (item.velocity) {
        item.mesh.position.addScaledVector(item.velocity, dt);
        item.velocity.y -= 5 * this.scale * dt;
      }
      if (item.origin) {
        const head = item.distance;
        const start = item.origin.clone().addScaledVector(item.direction, head * (1 - item.trailFraction + item.trailFraction * item.age / item.life));
        const end = item.origin.clone().addScaledVector(item.direction, head);
        item.mesh.geometry.setFromPoints([start, end]);
      }
    }
  }
  beforeRender(robot) {
    this.savedRotation = robot.rotation.clone();
    robot.rotation.x += this.kick;
    robot.rotation.z += this.kick * 0.45;
  }
  afterRender(robot) {
    if (this.savedRotation) robot.rotation.copy(this.savedRotation);
    this.savedRotation = null;
  }
  clear() { this.items.forEach(item => this.remove(item)); this.items.length = 0; this.kick = 0; }
}
