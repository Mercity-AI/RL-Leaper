import * as THREE from 'three';
import { LOLA_FALL } from './lolaTuning.js';

// The gun leaving her hands as she falls (owner, 2026-11-02: it must not vanish):
// a copy of whichever gun she is holding drops from there and lands flat on the
// ground beside her, where it stays until the next fight.

const UP = new THREE.Vector3(0, 1, 0);
const AXES = Object.freeze([new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]);

// The gun's own size and centre, turned and scaled as nothing (axes: longest first).
function measure(gun) {
  const { position, quaternion, scale } = gun;
  const saved = [position.clone(), quaternion.clone(), scale.clone()];
  position.set(0, 0, 0); quaternion.identity(); scale.set(1, 1, 1);
  gun.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  position.copy(saved[0]); quaternion.copy(saved[1]); scale.copy(saved[2]);
  const size = box.getSize(new THREE.Vector3());
  return { size, centre: box.getCenter(new THREE.Vector3()), axes: [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a)) };
}

// The turn that lays its longest side along `along` with its thinnest side up.
function lying(axes, along) {
  const [long, wide, thin] = axes.map((axis) => AXES[axis]);
  const across = new THREE.Vector3().crossVectors(along, UP);
  const flip = new THREE.Vector3().crossVectors(long, thin).dot(wide);
  const from = new THREE.Matrix4().makeBasis(long, thin, wide);
  const to = new THREE.Matrix4().makeBasis(along, UP, across.multiplyScalar(flip));
  return new THREE.Quaternion().setFromRotationMatrix(to.multiply(from.invert()));
}

// player: Lola, just knocked down (player.fall is set; the gun is still in hand).
export function dropGun(player) {
  const held = player.equipped.guns.find((gun) => gun.visible);
  if (!held) return null;
  const { mesh, fall, height, world } = player;
  const scene = mesh.parent;
  // 1. A copy where the gun is now.
  held.updateWorldMatrix(true, true);
  const gun = held.clone();
  gun.matrixAutoUpdate = true;
  held.matrixWorld.decompose(gun.position, gun.quaternion, gun.scale);
  const start = { position: gun.position.clone(), quaternion: gun.quaternion.clone() };
  const { size, centre, axes } = measure(gun);
  gun.visible = true;
  gun.traverse((part) => { part.visible = true; part.raycast = () => {}; });
  scene?.add(gun);
  // 2. Where it lands: by her hand, slightly askew; the other side if that is a wall.
  const reach = height * LOLA_FALL.gunAlong, away = height * LOLA_FALL.gunBeside;
  const side = fall.z === 0 ? { x: fall.along.z * -1, z: fall.along.x } : { x: Math.sin(mesh.rotation.y), z: Math.cos(mesh.rotation.y) };
  const spot = (sign) => new THREE.Vector3(mesh.position.x + fall.along.x * reach + side.x * away * sign, 0,
    mesh.position.z + fall.along.z * reach + side.z * away * sign);
  let end = spot(1);
  if (world.playerBlocked?.(end.x, end.z)) end = spot(-1);
  const along = new THREE.Vector3(fall.along.x, 0, fall.along.z).applyAxisAngle(UP, LOLA_FALL.gunTurn).normalize();
  const flat = lying(axes, along);
  const scale = gun.scale.x;
  end.y = player.standHeight + size.getComponent(axes[2]) * scale / 2;
  end.sub(centre.clone().multiplyScalar(scale).applyQuaternion(flat));
  // 3. Falling to it, gathering speed like she does.
  let time = 0;
  return {
    gun,
    update(dt) {
      if (time >= LOLA_FALL.gunTime) return;
      time = Math.min(LOLA_FALL.gunTime, time + dt);
      const t = time / LOLA_FALL.gunTime;
      gun.position.lerpVectors(start.position, end, t);
      gun.position.y = THREE.MathUtils.lerp(start.position.y, end.y, t * t);
      gun.quaternion.copy(start.quaternion).slerp(flat, t);
    },
    remove() {
      gun.parent?.remove(gun);
    },
  };
}
