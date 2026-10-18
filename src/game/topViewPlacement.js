import * as THREE from 'three';

// Designer tool: in TOP view, Shift + click puts Lola on that spot of the floor
// (the brain's "destination" when testing a chase). Moved out of JunkyardPlaytest.
// allowed(): whether placing is possible right now (not in POV, fight not over).
// onMessage(text): show feedback in the panel. onMoved(): Lola was placed.
export function enableTopViewPlacement({ engine, cameraController, world, player, allowed, onMessage, onMoved }) {
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const canvas = engine.renderer.domElement;
  const onPointerDown = (event) => {
    if (!event.shiftKey || cameraController.mode !== 'TOP' || !allowed()) return;
    // This click places Lola; it must not also start a camera drag.
    cameraController.pointerId = null;
    // Ray from the clicked pixel to the floor plane.
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    ), engine.camera);
    const point = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    if (!point) return;
    // Never inside a wall, a prop or the Leaper.
    if (player.isPlayer && world.playerBlocked(point.x, point.z)) {
      onMessage('Choose clear ground for Lola.');
      return;
    }
    player.mesh.position.x = point.x;
    player.mesh.position.z = point.z;
    player.resetJump?.();
    onMoved();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  return () => canvas.removeEventListener('pointerdown', onPointerDown);
}
