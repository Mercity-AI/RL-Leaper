import * as THREE from 'three';

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
  scene.background = new THREE.Color(0x0a0b0f);
  scene.fog = new THREE.Fog(0x0a0b0f, 18, 64);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    220,
  );

  scene.add(new THREE.HemisphereLight(0x8a93a8, 0x101216, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(8, 15, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 48;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(0x4a63ff, 0.22);
  rim.position.set(-7, 9, -9);
  scene.add(rim);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun };
}
