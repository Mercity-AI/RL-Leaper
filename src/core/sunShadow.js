import * as THREE from 'three';
import { SUN_OFFSET, SHADOW_BOX } from './createScene.js';

// Keeps the shadow-casting sun over the player. The sun keeps its direction and
// only slides along with its subject; its shadow box is scaled to the map, and
// its centre is snapped to whole shadow-map pixels so shadow edges stay still
// instead of shimmering as the subject walks (review fix 5.17).

// The shadow camera's right and up directions (it looks from the sun towards
// its target with the world's up, exactly as three.js aims it).
export function shadowBasis(offset) {
  const back = new THREE.Vector3().copy(offset).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  return { right, up };
}

// Move `point` by less than one shadow pixel so that, seen from the sun, it sits
// exactly on the shadow map's pixel grid. Sliding along the light ray is free.
export function snapToShadowTexels(point, { right, up }, texel, out = new THREE.Vector3()) {
  const u = point.dot(right), v = point.dot(up);
  out.copy(point)
    .addScaledVector(right, Math.round(u / texel) * texel - u)
    .addScaledVector(up, Math.round(v / texel) * texel - v);
  return out;
}

export class SunFollow {
  constructor(sun, { scale = 1 } = {}) {
    this.sun = sun;
    this.focus = new THREE.Vector3();
    this.snapped = new THREE.Vector3();
    this.setScale(scale);
  }

  // Scale the sun's offset and shadow box with the map (bigger Leaper = smaller map).
  setScale(scale) {
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -SHADOW_BOX.halfSize * scale;
    camera.right = camera.top = SHADOW_BOX.halfSize * scale;
    camera.near = SHADOW_BOX.near * scale;
    camera.far = SHADOW_BOX.far * scale;
    camera.updateProjectionMatrix();
    this.offset = new THREE.Vector3(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z).multiplyScalar(scale);
    this.basis = shadowBasis(this.offset);
    // World size of one shadow-map pixel.
    this.texel = (camera.right - camera.left) / this.sun.shadow.mapSize.x;
  }

  // Centre the sun's light and shadow box on a ground point (x, z).
  update({ x, z }) {
    snapToShadowTexels(this.focus.set(x, 0, z), this.basis, this.texel, this.snapped);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).add(this.offset);
  }
}
