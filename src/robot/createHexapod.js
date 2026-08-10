import * as THREE from 'three';
import {
  CALF_LENGTH,
  COXA_LENGTH,
  FEMUR_LENGTH,
  FOOT_HEIGHT,
  HOME_RADIUS,
  ROBOT_SCALE,
  SHIN_LENGTH,
} from '../config/robot.js';

function createMaterials() {
  return {
    core: new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 0.38, metalness: 0.88 }),
    leg: new THREE.MeshStandardMaterial({ color: 0x121318, roughness: 0.46, metalness: 0.85, flatShading: true }),
    plate: new THREE.MeshStandardMaterial({ color: 0x1e2027, roughness: 0.55, metalness: 0.8, flatShading: true }),
    joint: new THREE.MeshStandardMaterial({ color: 0x262a33, roughness: 0.32, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.6, metalness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.12, metalness: 0.5 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x1a0402, emissive: 0xff2e10, emissiveIntensity: 2, roughness: 0.4 }),
    glowSoft: new THREE.MeshStandardMaterial({ color: 0x1a0402, emissive: 0xff5a30, emissiveIntensity: 1, roughness: 0.4 }),
  };
}

function diamondSegment(topRadius, bottomRadius, length, material) {
  const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, length, 4, 1);
  geometry.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function createLegMeshes(scene, materials) {
  const coxa = diamondSegment(0.085, 0.11, COXA_LENGTH, materials.joint);

  const femur = new THREE.Group();
  femur.add(diamondSegment(0.072, 0.108, FEMUR_LENGTH, materials.leg));
  const femurArm = diamondSegment(0.128, 0.158, FEMUR_LENGTH * 0.6, materials.plate);
  femurArm.position.y = FEMUR_LENGTH * 0.16;
  femur.add(femurArm);
  const femurGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, FEMUR_LENGTH * 0.46, 0.03),
    materials.glow,
  );
  femurGlow.position.set(0.105, FEMUR_LENGTH * 0.42, 0);
  femur.add(femurGlow);
  const spike = diamondSegment(0.004, 0.052, 0.24, materials.plate);
  spike.position.y = FEMUR_LENGTH * 0.99;
  femur.add(spike);

  const tibia = new THREE.Group();
  tibia.add(diamondSegment(0.092, 0.055, SHIN_LENGTH, materials.leg));
  const tibiaArm = diamondSegment(0.132, 0.065, SHIN_LENGTH * 0.52, materials.plate);
  tibiaArm.position.y = SHIN_LENGTH * 0.04;
  tibia.add(tibiaArm);
  const tibiaGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, SHIN_LENGTH * 0.34, 0.026),
    materials.glow,
  );
  tibiaGlow.position.set(0.098, SHIN_LENGTH * 0.14, 0);
  tibia.add(tibiaGlow);

  const calf = new THREE.Group();
  calf.add(diamondSegment(0.075, 0.026, CALF_LENGTH, materials.leg));
  const calfPlate = diamondSegment(0.105, 0.045, CALF_LENGTH * 0.58, materials.plate);
  calfPlate.position.y = CALF_LENGTH * 0.05;
  calf.add(calfPlate);
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), materials.dark);
  foot.castShadow = true;
  foot.position.y = CALF_LENGTH;
  calf.add(foot);

  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), materials.joint);
  knee.castShadow = true;
  knee.add(new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 8), materials.glow));

  const calfJoint = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), materials.joint);
  calfJoint.scale.set(1.15, 0.82, 1.15);
  calfJoint.castShadow = true;
  const calfRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), materials.glowSoft);
  calfRing.rotation.x = Math.PI / 2;
  calfJoint.add(calfRing);

  coxa.scale.set(ROBOT_SCALE, 1, ROBOT_SCALE);
  femur.scale.set(ROBOT_SCALE, 1, ROBOT_SCALE);
  tibia.scale.set(ROBOT_SCALE, 1, ROBOT_SCALE);
  calf.scale.set(ROBOT_SCALE, 1, ROBOT_SCALE);
  knee.scale.setScalar(ROBOT_SCALE);
  calfJoint.scale.multiplyScalar(ROBOT_SCALE);
  scene.add(coxa, femur, tibia, calf, knee, calfJoint);

  return { coxa, femur, tibia, calf, knee, calfJoint };
}

function createBody(materials) {
  const robot = new THREE.Group();
  robot.rotation.order = 'YXZ';
  robot.scale.setScalar(ROBOT_SCALE);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), materials.core);
  core.scale.set(0.74, 0.7, 0.77);
  robot.add(core);

  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.525, 28, 14, 0, Math.PI * 2, 0, 0.82),
    materials.plate,
  );
  topCap.scale.set(0.74, 0.7, 0.77);
  robot.add(topCap);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.382, 0.018, 8, 48), materials.dark);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.02;
  band.scale.set(1, 1.04, 1);
  robot.add(band);

  const eyePivot = new THREE.Group();
  eyePivot.position.set(0, 0.03, 0.43);
  eyePivot.rotation.order = 'YXZ';
  robot.add(eyePivot);

  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.24, 0.14, 24), materials.joint);
  socket.geometry.rotateX(Math.PI / 2);
  socket.position.set(0, 0, 0.03);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.034, 10, 40), materials.dark);
  bezel.position.set(0, 0, 0.095);
  const eyeRing = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.02, 10, 40), materials.glow);
  eyeRing.position.set(0, 0, 0.117);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.15, 0.05, 24), materials.lens);
  lens.geometry.rotateX(Math.PI / 2);
  lens.position.set(0, 0, 0.12);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), materials.glowSoft);
  pupil.position.set(0, 0, 0.148);
  eyePivot.add(socket, bezel, eyeRing, lens, pupil);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.13), materials.plate);
  brow.position.set(0, 0.27, 0.42);
  brow.rotation.x = 0.55;
  robot.add(brow);

  const eyeLight = new THREE.PointLight(0xff3b1a, 1.1, 7, 2);
  eyeLight.position.set(0, 0.06, 0.95);
  robot.add(eyeLight);

  return { robot, eyePivot, eyeLight };
}

export function createHexapod(scene) {
  const materials = createMaterials();
  const { robot, eyePivot, eyeLight } = createBody(materials);
  scene.add(robot);

  const legDefinitions = [
    { angle: -0.62, gait: 0 }, { angle: 0.62, gait: 1 },
    { angle: -1.57, gait: 1 }, { angle: 1.57, gait: 0 },
    { angle: -2.42, gait: 0 }, { angle: 2.42, gait: 1 },
  ];

  const legs = legDefinitions.map((definition, index) => {
    const out = new THREE.Vector3(
      Math.sin(definition.angle),
      0,
      Math.cos(definition.angle),
    );
    return {
      index,
      gait: definition.gait,
      out,
      anchorLocal: new THREE.Vector3(out.x * 0.4, 0.245, out.z * 0.4),
      homeLocal: new THREE.Vector3(out.x * HOME_RADIUS, 0, out.z * HOME_RADIUS),
      footPosition: new THREE.Vector3(out.x * HOME_RADIUS, FOOT_HEIGHT, out.z * HOME_RADIUS),
      stepping: false,
      stepProgress: 0,
      stepDuration: 0.22,
      lift: 0.32,
      cooldown: 0,
      replantDelay: -1,
      stepFrom: new THREE.Vector3(),
      stepTo: new THREE.Vector3(),
      ...createLegMeshes(scene, materials),
    };
  });

  legDefinitions.forEach((definition) => {
    const out = new THREE.Vector3(
      Math.sin(definition.angle),
      0,
      Math.cos(definition.angle),
    );
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.2), materials.joint);
    mount.position.set(out.x * 0.42, 0.25, out.z * 0.42);
    mount.rotation.y = definition.angle;
    robot.add(mount);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.25), materials.plate);
    fin.position.set(out.x * 0.46, 0.41, out.z * 0.46);
    fin.rotation.order = 'YXZ';
    fin.rotation.y = definition.angle;
    fin.rotation.x = -0.22;
    robot.add(fin);
  });

  robot.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });

  return { robot, eyePivot, eyeLight, legs, materials };
}
