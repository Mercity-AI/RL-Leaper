import * as THREE from 'three';

export const TRAINING_TARGET = { x: -40, z: -10 };
export const TRAINING_WORLD_LIMIT = 93.75;

export function createTrainingWorld(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(TRAINING_WORLD_LIMIT * 2, TRAINING_WORLD_LIMIT * 2),
    new THREE.MeshStandardMaterial({
      color: 0xbecdd3,
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(
    TRAINING_WORLD_LIMIT * 2,
    75,
    0x6f8791,
    0xa7bac1,
  );
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  const obstacleGroup = new THREE.Group();
  const obstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0xde8952,
    roughness: 0.88,
    metalness: 0.12,
    flatShading: true,
  });
  scene.add(obstacleGroup);

  const colliders = [];
  const setObstacles = (obstacles = []) => {
    while (obstacleGroup.children.length) {
      const mesh = obstacleGroup.children.pop();
      mesh.geometry.dispose();
    }
    colliders.length = 0;
    obstacles.forEach((entry, index) => {
      const [x, z, radius] = Array.isArray(entry)
        ? entry
        : [entry.x, entry.z, entry.radius];
      const height = 2.6 + (index % 7) * 0.24;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.9, radius, height, 9),
        obstacleMaterial,
      );
      mesh.position.set(x, height / 2, z);
      mesh.rotation.y = index * 0.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      obstacleGroup.add(mesh);
      colliders.push({ x, z, radius });
    });
  };

  const boundaryMaterial = new THREE.LineBasicMaterial({ color: 0xff4a26 });
  const boundaryPoints = [
    new THREE.Vector3(-TRAINING_WORLD_LIMIT, 0.05, -TRAINING_WORLD_LIMIT),
    new THREE.Vector3(TRAINING_WORLD_LIMIT, 0.05, -TRAINING_WORLD_LIMIT),
    new THREE.Vector3(TRAINING_WORLD_LIMIT, 0.05, TRAINING_WORLD_LIMIT),
    new THREE.Vector3(-TRAINING_WORLD_LIMIT, 0.05, TRAINING_WORLD_LIMIT),
    new THREE.Vector3(-TRAINING_WORLD_LIMIT, 0.05, -TRAINING_WORLD_LIMIT),
  ];
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints),
    boundaryMaterial,
  ));

  return {
    ground,
    grid,
    obstacleGroup,
    colliders,
    setObstacles,
  };
}
