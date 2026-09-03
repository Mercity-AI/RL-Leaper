import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { HOME_RADIUS } from '../config/robot.js';

// Leaper's leg-to-leg footprint is HOME_RADIUS * 2. The owner's model is
// scaled so its largest dimension is two-thirds of that overall size.
const PLAYER_MODEL_SIZE = HOME_RADIUS * 2 * (2 / 3);

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
    this.mesh = new THREE.Group();
    this.fallbackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, PLAYER_MODEL_SIZE, 1.2),
      this.material,
    );
    this.fallbackMesh.position.y = PLAYER_MODEL_SIZE / 2;
    this.mesh.add(this.fallbackMesh);

    if (initialPosition) {
      this.mesh.position.set(initialPosition.x, 0, initialPosition.z);
    } else {
      const nearest = colliders.reduce(
        (best, item) => (
          Math.hypot(item.x, item.z) < Math.hypot(best.x, best.z) ? item : best
        ),
        colliders[0],
      );
      const direction = new THREE.Vector2(nearest.x, nearest.z).normalize();
      const side = new THREE.Vector2(-direction.y, direction.x);
      this.mesh.position.set(
        nearest.x + direction.x * (nearest.radius + 1.5) + side.x * 2.5,
        0,
        nearest.z + direction.y * (nearest.radius + 1.5) + side.y * 2.5,
      );
    }
    this.fallbackMesh.castShadow = true;
    this.fallbackMesh.receiveShadow = true;

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

  setPosition(x, z) {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  setFacing(yaw) {
    this.mesh.rotation.y = yaw;
  }

  async loadPlayerModel(url, materialUrl = null) {
    const available = await fetch(url, { method: 'HEAD' });
    const contentType = available.headers.get('content-type') || '';
    if (!available.ok || contentType.includes('text/html')) return false;

    const loader = new OBJLoader();
    if (materialUrl) {
      const materialResponse = await fetch(materialUrl, { method: 'HEAD' });
      const materialType = materialResponse.headers.get('content-type') || '';
      if (materialResponse.ok && !materialType.includes('text/html')) {
        const materials = await new MTLLoader().loadAsync(materialUrl);
        materials.preload();
        loader.setMaterials(materials);
      }
    }

    const model = await loader.loadAsync(url);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });

    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = PLAYER_MODEL_SIZE / Math.max(size.x, size.y, size.z, 1e-6);
    model.scale.setScalar(scale);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;

    this.mesh.remove(this.fallbackMesh);
    this.fallbackMesh.geometry.dispose();
    this.model = model;
    this.mesh.add(model);
    return true;
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
