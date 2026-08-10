import * as THREE from 'three';

export class TargetMarker {
  constructor(scene, colliders, toggleButton, initialPosition = null) {
    this.selected = false;
    this.toggleButton = toggleButton;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xff4fa3,
      emissive: 0xff167d,
      emissiveIntensity: 0.75,
      roughness: 0.42,
      metalness: 0.18,
    });
    this.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 7, 1),
      this.material,
    );

    const nearest = colliders.reduce(
      (best, item) => (
        Math.hypot(item.x, item.z) < Math.hypot(best.x, best.z) ? item : best
      ),
      colliders[0],
    );
    const direction = new THREE.Vector2(nearest.x, nearest.z).normalize();
    const side = new THREE.Vector2(-direction.y, direction.x);
    if (initialPosition) {
      this.mesh.position.set(initialPosition.x, 3.5, initialPosition.z);
    } else {
      this.mesh.position.set(
        nearest.x + direction.x * (nearest.radius + 1.5) + side.x * 2.5,
        3.5,
        nearest.z + direction.y * (nearest.radius + 1.5) + side.y * 2.5,
      );
    }
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const light = new THREE.PointLight(0xff3f9d, 1.8, 12, 2);
    light.position.y = 1;
    this.mesh.add(light);
    scene.add(this.mesh);

    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.setSelected(!this.selected);
  }

  setSelected(selected) {
    this.selected = selected;
    this.material.emissive.setHex(selected ? 0xff0077 : 0xff167d);
    this.material.emissiveIntensity = selected ? 1.35 : 0.75;
    this.toggleButton.textContent = selected ? 'PINK: SELECTED' : 'PINK: SELECT';
    this.toggleButton.classList.toggle('on', selected);
  }

  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (!this.selected) return;
    const direction = new THREE.Vector3()
      .addScaledVector(forward, forwardAmount)
      .addScaledVector(right, sideAmount);
    if (direction.lengthSq() > 1) direction.normalize();
    this.mesh.position.addScaledVector(direction, speed * deltaTime);
  }
}
