import * as THREE from 'three';

function createSeededRandom(initialSeed) {
  let seed = initialSeed;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

export function createWorld(scene) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(95, 72),
    new THREE.MeshStandardMaterial({
      color: 0xbecdd3,
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(180, 90, 0x6f8791, 0xa7bac1);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  scene.add(grid);

  const random = createSeededRandom(11);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0xde8952,
    roughness: 0.96,
    metalness: 0.04,
    flatShading: true,
  });
  const pyramidMaterial = new THREE.MeshStandardMaterial({
    color: 0x829fac,
    roughness: 0.9,
    metalness: 0.12,
    flatShading: true,
  });
  const obstacleGroup = new THREE.Group();
  const colliders = [];
  scene.add(obstacleGroup);

  const clusters = Array.from({ length: 17 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = 13 + random() * 43;
    return { x: Math.sin(angle) * distance, z: Math.cos(angle) * distance };
  });

  for (let index = 0; index < 84; index += 1) {
    const cluster = clusters[Math.floor(index / 5) % clusters.length];
    const scatterAngle = random() * Math.PI * 2;
    const scatter = 0.35 + random() ** 1.5 * 4.2;
    let x = cluster.x + Math.sin(scatterAngle) * scatter;
    let z = cluster.z + Math.cos(scatterAngle) * scatter;
    const centerDistance = Math.hypot(x, z);
    if (centerDistance < 15) {
      const push = 15 / Math.max(centerDistance, 0.01);
      x *= push;
      z *= push;
    }

    const sizeRoll = random();
    const size = sizeRoll < 0.42
      ? 0.3 + random() * 1.15
      : sizeRoll < 0.84
        ? 1.45 + random() * 2.35
        : 3.8 + random() * 2.5;
    const isRock = random() < 0.62;
    const geometry = isRock
      ? new THREE.IcosahedronGeometry(size, 1)
      : new THREE.ConeGeometry(size * 0.9, size * 1.65, 4, 1);
    const obstacle = new THREE.Mesh(
      geometry,
      isRock ? rockMaterial : pyramidMaterial,
    );
    obstacle.scale.set(
      0.85 + random() * 0.45,
      0.7 + random() * 0.65,
      0.85 + random() * 0.45,
    );
    obstacle.position.set(
      x,
      size * obstacle.scale.y * (isRock ? 0.72 : 0.8) - 0.05,
      z,
    );
    obstacle.rotation.set(
      isRock ? (random() - 0.5) * 0.35 : 0,
      random() * Math.PI * 2,
      isRock ? (random() - 0.5) * 0.35 : 0,
    );
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    obstacleGroup.add(obstacle);
    colliders.push({
      x: obstacle.position.x,
      z: obstacle.position.z,
      radius: size
        * (isRock ? 0.92 : 1)
        * Math.max(obstacle.scale.x, obstacle.scale.z),
    });
  }

  return { ground, grid, obstacleGroup, colliders };
}
