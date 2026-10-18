import * as THREE from 'three';
import { CombatGeometry } from '../simulation/CombatGeometry.js';

// Static scenery only: characters, effects and HUD never shorten the boom.
export class CameraOcclusion {
  constructor(roots) {
    this.geometry = new CombatGeometry({
      updateMatrixWorld: () => roots.forEach(root => root.updateMatrixWorld(true)),
      traverse: visitor => roots.forEach(root => root.traverse(visitor)),
    });
    this.distance = null;
    this.recoveryDelay = 0;
    this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.sources = [];
    roots.forEach(root => root.traverse(object => { if (object.isMesh) this.sources.push(object); }));
    this.geometry.meshes.forEach((mesh, i) => { mesh.userData.cameraSource = this.sources[i]; });
    this.blockers = new Set();
    this.fadeCache = new Map();
  }

  resolve(anchor, desired, camera, dt, minimumDistance = 0) {
    this.blockers.clear();
    const length = this.direction.subVectors(desired, anchor).length();
    if (length < 1e-6) return;
    this.direction.divideScalar(length);
    this.right.crossVectors(this.direction, camera.up).normalize();
    this.up.crossVectors(this.right, this.direction).normalize();
    const halfHeight = camera.near * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const radius = Math.max(0.25, Math.hypot(halfHeight, halfHeight * camera.aspect) + 0.12);
    let safe = length;
    // Centre plus eight perimeter probes protect the near plane at corners.
    for (let i = -1; i < 8; i++) {
      this.origin.copy(anchor);
      if (i >= 0) this.origin
        .addScaledVector(this.right, Math.cos(i * Math.PI / 4) * radius)
        .addScaledVector(this.up, Math.sin(i * Math.PI / 4) * radius);
      const hit = this.geometry.hit(this.origin, this.direction, length + radius);
      if (hit) safe = Math.min(safe, Math.max(0, hit.distance - radius));
      if (minimumDistance && hit?.distance < minimumDistance + radius) {
        this.geometry.raycaster.far = minimumDistance + radius;
        for (const obstruction of this.geometry.raycaster.intersectObjects(this.geometry.meshes, false)) {
          this.blockers.add(obstruction.object.userData.cameraSource);
        }
      }
    }
    // Never interpolate through cover; only the return to the chosen zoom is eased.
    if (this.distance === null || safe < this.distance) {
      this.distance = safe;
      this.recoveryDelay = 0.12;
    } else {
      this.recoveryDelay = Math.max(0, this.recoveryDelay - dt);
      if (!this.recoveryDelay) this.distance = THREE.MathUtils.lerp(this.distance, safe, 1 - Math.exp(-4 * dt));
    }
    this.distance = Math.max(Math.min(length, minimumDistance), this.distance);
    desired.copy(anchor).addScaledVector(this.direction, this.distance);
  }

  beforeRender() {
    this.restored = [];
    for (const object of this.blockers) {
      const original = object.material;
      if (!this.fadeCache.has(object)) {
        const fade = material => {
          const copy = material.clone();
          copy.transparent = true; copy.opacity = 0.15; copy.depthWrite = false;
          return copy;
        };
        this.fadeCache.set(object, Array.isArray(original) ? original.map(fade) : fade(original));
      }
      this.restored.push([object, original]);
      object.material = this.fadeCache.get(object);
    }
  }

  afterRender() {
    this.restored?.forEach(([object, material]) => { object.material = material; });
    this.restored = null;
  }
}
