import * as THREE from 'three';

export const TRAINING_TARGET = { x: 18, z: 18 };

const TRAINING_OBSTACLES = [
  { x: -10, z: -5, radius: 3.2 },
  { x: 1, z: 4, radius: 3 },
  { x: 10, z: 11, radius: 2.8 },
  { x: -7, z: 13, radius: 2.6 },
  { x: 12, z: -8, radius: 3.4 },
];

export function createTrainingWorld(scene) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(35, 72),
    new THREE.MeshStandardMaterial({
      color: 0xbecdd3,
      roughness: 0.95,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(50, 50, 0x6f8791, 0xa7bac1);
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
  TRAINING_OBSTACLES.forEach((obstacle, index) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        obstacle.radius * 0.9,
        obstacle.radius,
        2.6 + index * 0.24,
        9,
      ),
      obstacleMaterial,
    );
    mesh.position.set(obstacle.x, mesh.geometry.parameters.height / 2, obstacle.z);
    mesh.rotation.y = index * 0.7;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    obstacleGroup.add(mesh);
  });
  scene.add(obstacleGroup);

  const boundaryMaterial = new THREE.LineBasicMaterial({ color: 0xff4a26 });
  const boundaryPoints = [
    new THREE.Vector3(-25, 0.05, -25),
    new THREE.Vector3(25, 0.05, -25),
    new THREE.Vector3(25, 0.05, 25),
    new THREE.Vector3(-25, 0.05, 25),
    new THREE.Vector3(-25, 0.05, -25),
  ];
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints),
    boundaryMaterial,
  ));

  return {
    ground,
    grid,
    obstacleGroup,
    colliders: TRAINING_OBSTACLES.map((obstacle) => ({ ...obstacle })),
  };
}
