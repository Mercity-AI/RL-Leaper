import * as THREE from 'three';

// The sun's offset from the point it lights, and its shadow box, at map scale 1.
// The junkyard scales both by its world scale and centres them on Lola
// (src/core/sunShadow.js); the lab modes keep these numbers around the robot.
export const SUN_OFFSET = Object.freeze({ x: 8, y: 15, z: 6 });
export const SHADOW_BOX = Object.freeze({ halfSize: 13, near: 2, far: 48, mapSize: 2048 });

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4f0f7);
  scene.fog = new THREE.Fog(0xe4f0f7, 24, 78);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    220,
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9ca7b2, 0.95));
  const sun = new THREE.DirectionalLight(0xfff7ea, 1.25);
  sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_BOX.mapSize, SHADOW_BOX.mapSize);
  sun.shadow.camera.left = -SHADOW_BOX.halfSize;
  sun.shadow.camera.right = SHADOW_BOX.halfSize;
  sun.shadow.camera.top = SHADOW_BOX.halfSize;
  sun.shadow.camera.bottom = -SHADOW_BOX.halfSize;
  sun.shadow.camera.near = SHADOW_BOX.near;
  sun.shadow.camera.far = SHADOW_BOX.far;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(0x7f9dff, 0.16);
  rim.position.set(-7, 9, -9);
  scene.add(rim);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun };
}
