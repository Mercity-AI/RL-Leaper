import { TARGET, TARGET_RADIUS, WORLD_LIMIT } from './leaperWorld.js';

export const PLAYER_SPEED = 6.0;
export const PLAYER_COLLISION_RADIUS = TARGET_RADIUS;

function obstacleValues(obstacle) {
  return Array.isArray(obstacle)
    ? obstacle
    : [obstacle.x, obstacle.z, obstacle.radius];
}

function positionBlocked(x, z, obstacles) {
  const limit = WORLD_LIMIT - PLAYER_COLLISION_RADIUS;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return true;
  return obstacles.some((obstacle) => {
    const [ox, oz, radius] = obstacleValues(obstacle);
    const dx = x - ox;
    const dz = z - oz;
    const clearance = radius + PLAYER_COLLISION_RADIUS;
    return dx * dx + dz * dz < clearance * clearance;
  });
}

export function initialPlayerPosition() {
  return [...TARGET];
}

export function movePlayerTarget(position, movement, cameraHeading, deltaTime, obstacles) {
  const forwardX = Math.sin(cameraHeading);
  const forwardZ = Math.cos(cameraHeading);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  let moveX = forwardX * movement.forward + rightX * movement.side;
  let moveZ = forwardZ * movement.forward + rightZ * movement.side;
  const magnitude = Math.hypot(moveX, moveZ);

  if (magnitude < 1e-6) {
    return { x: position[0], z: position[1], yaw: null, moving: false };
  }
  if (magnitude > 1.0) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }

  const distance = PLAYER_SPEED * deltaTime;
  const candidateX = position[0] + moveX * distance;
  const candidateZ = position[1] + moveZ * distance;
  let x = position[0];
  let z = position[1];

  if (!positionBlocked(candidateX, candidateZ, obstacles)) {
    x = candidateX;
    z = candidateZ;
  } else {
    // Slide along a rock or wall instead of stopping dead on diagonal input.
    if (!positionBlocked(candidateX, z, obstacles)) x = candidateX;
    if (!positionBlocked(x, candidateZ, obstacles)) z = candidateZ;
  }

  return {
    x,
    z,
    yaw: Math.atan2(moveX, moveZ),
    moving: x !== position[0] || z !== position[1],
  };
}
