// leaperWorld.js — a faithful JavaScript port of the Python training world.
//
// This is the careful heart of "Move 3". Every number and every step of math
// here mirrors rl_environment.py exactly, so the brain sees precisely what it
// saw during training. The browser self-test (brain_fixtures.json) proves it.
//
// Coordinate note: Python's 2D (x, y) maps to the scene's (x, z), and both use
// heading = (sin(yaw), cos(yaw)) — so no axis remapping is needed.

// --- Constants, straight from rl_environment.py / the champion config -------
export const WORLD_LIMIT = 93.75;
export const TARGET = [-40.0, -10.0];
export const RAY_COUNT = 16; // champion override (env default was 8)
export const RAY_MAX_RANGE = 28.0;
export const VISION_FOV = (270.0 * Math.PI) / 180.0;
export const MOVE_SPEED = 0.75;
export const TURN_SPEED = (18.0 * Math.PI) / 180.0;
export const AGENT_RADIUS = 0.75;
export const TARGET_RADIUS = 1.4;
export const LEG_ANGLES = [-0.62, 0.62, -1.57, 1.57, -2.42, 2.42];
export const LEG_SEGMENT_RADII = [1.2, 2.2, 3.24];
export const LEG_COLLISION_RADIUS = 0.24;
export const STUCK_LIMIT = 40;
export const MAX_DISTANCE = 2.0 * Math.SQRT2 * WORLD_LIMIT;
export const OBS_SIZE = 10 + RAY_COUNT;

// Python's % always returns a non-negative result for a positive modulus; JS's
// does not. This matches Python so yaw-wrapping is identical.
function pythonMod(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function wrapToPi(angle) {
  return pythonMod(angle + Math.PI, 2 * Math.PI) - Math.PI;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// The 16 ray angles relative to facing, fanned evenly across the 270° cone,
// centred on straight-ahead. Matches env._ray_relative_angles.
export function rayRelativeAngles() {
  const width = VISION_FOV / RAY_COUNT;
  const leftEdge = -VISION_FOV / 2.0;
  const angles = new Array(RAY_COUNT);
  for (let i = 0; i < RAY_COUNT; i += 1) {
    angles[i] = leftEdge + (i + 0.5) * width;
  }
  return angles;
}

const RELATIVE_ANGLES = rayRelativeAngles();

// Each ray = clear distance to the nearest obstacle surface or arena wall along
// its heading, normalized to [0, 1] by RAY_MAX_RANGE. Port of env._ray_distances.
export function rayDistances(x, z, yaw, obstacles) {
  const out = new Float32Array(RAY_COUNT);
  for (let r = 0; r < RAY_COUNT; r += 1) {
    const angle = yaw + RELATIVE_ANGLES[r];
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    let nearest = RAY_MAX_RANGE;

    // Ray vs each circular obstacle (unit direction => quadratic with a = 1).
    for (let o = 0; o < obstacles.length; o += 1) {
      const ox = obstacles[o][0];
      const oz = obstacles[o][1];
      const orad = obstacles[o][2];
      const offx = x - ox;
      const offz = z - oz;
      const b = 2.0 * (dx * offx + dz * offz);
      const c = offx * offx + offz * offz - orad * orad;
      const disc = b * b - 4.0 * c;
      if (disc >= 0.0) {
        const root = Math.sqrt(disc);
        const entry = (-b - root) / 2.0;
        const exit = (-b + root) / 2.0;
        const hit = entry >= 0.0 ? entry : exit;
        if (hit >= 0.0 && hit < nearest) nearest = hit;
      }
    }

    // Ray vs the square arena walls at ±WORLD_LIMIT, per axis.
    const axes = [
      [dx, x],
      [dz, z],
    ];
    for (let a = 0; a < 2; a += 1) {
      const component = axes[a][0];
      const coord = axes[a][1];
      if (component > 1e-9) {
        const t = (WORLD_LIMIT - coord) / component;
        if (t < nearest) nearest = t;
      } else if (component < -1e-9) {
        const t = (-WORLD_LIMIT - coord) / component;
        if (t < nearest) nearest = t;
      }
    }

    out[r] = clamp(nearest, 0.0, RAY_MAX_RANGE) / RAY_MAX_RANGE;
  }
  return out;
}

// The robot's body + six legs (three segments each) as collision circles.
// Port of env._collision_points.
function collisionPoints(x, z, yaw) {
  const points = [[x, z, AGENT_RADIUS]];
  for (let l = 0; l < LEG_ANGLES.length; l += 1) {
    const dx = Math.sin(yaw + LEG_ANGLES[l]);
    const dz = Math.cos(yaw + LEG_ANGLES[l]);
    for (let s = 0; s < LEG_SEGMENT_RADII.length; s += 1) {
      const radius = LEG_SEGMENT_RADII[s];
      points.push([x + dx * radius, z + dz * radius, LEG_COLLISION_RADIUS]);
    }
  }
  return points;
}

// True if any body/leg point pokes past a wall or into an obstacle.
// Port of env._collision_for_pose.
export function collides(x, z, yaw, obstacles) {
  const points = collisionPoints(x, z, yaw);
  for (let p = 0; p < points.length; p += 1) {
    const px = points[p][0];
    const pz = points[p][1];
    const pr = points[p][2];
    const limit = WORLD_LIMIT - pr;
    if (Math.abs(px) > limit || Math.abs(pz) > limit) return true;
    for (let o = 0; o < obstacles.length; o += 1) {
      const dxo = px - obstacles[o][0];
      const dzo = pz - obstacles[o][1];
      const minDist = obstacles[o][2] + pr;
      if (dxo * dxo + dzo * dzo < minDist * minDist) return true;
    }
  }
  return false;
}

// Build the exact 26 numbers the brain expects. Port of env._observation.
// A live game may move the target; omitting state.target preserves the static
// training target used by fixtures and recorded evaluations.
// state: { x, z, yaw, prevThrottle, prevTurn, lastCollision, obstacles, target? }
export function buildObservation(state) {
  const {
    x,
    z,
    yaw,
    prevThrottle,
    prevTurn,
    lastCollision,
    obstacles,
    target = TARGET,
  } = state;
  const deltaX = target[0] - x;
  const deltaZ = target[1] - z;
  const distance = Math.hypot(deltaX, deltaZ);
  const inv = 1.0 / Math.max(distance, 1e-6);

  const obs = new Float32Array(OBS_SIZE);
  obs[0] = x / WORLD_LIMIT;
  obs[1] = z / WORLD_LIMIT;
  obs[2] = deltaX * inv;
  obs[3] = deltaZ * inv;
  obs[4] = clamp(distance / MAX_DISTANCE, 0.0, 1.0);
  obs[5] = Math.sin(yaw);
  obs[6] = Math.cos(yaw);
  obs[7] = lastCollision;
  obs[8] = prevThrottle;
  obs[9] = prevTurn;

  const rays = rayDistances(x, z, yaw, obstacles);
  for (let i = 0; i < RAY_COUNT; i += 1) obs[10 + i] = rays[i];
  return obs;
}

// Advance one world step given the brain's action. Port of env.step motion,
// including the "resolve rotation and translation independently when blocked"
// rule that lets a touching robot turn/slide free instead of freezing.
// state carries { x, z, yaw, prevDistance, stuckSteps, obstacles, target? }.
export function stepWorld(state, throttleRaw, turnRaw) {
  const throttle = clamp(throttleRaw, 0.0, 1.0);
  const turn = clamp(turnRaw, -1.0, 1.0);
  const { x, z, yaw, obstacles, target = TARGET } = state;

  const candidateYaw = wrapToPi(yaw + turn * TURN_SPEED);
  const hx = Math.sin(candidateYaw);
  const hz = Math.cos(candidateYaw);
  const candX = x + hx * throttle * MOVE_SPEED;
  const candZ = z + hz * throttle * MOVE_SPEED;

  let nx = x;
  let nz = z;
  let nyaw = yaw;
  const collided = collides(candX, candZ, candidateYaw, obstacles);
  if (!collided) {
    nx = candX;
    nz = candZ;
    nyaw = candidateYaw;
  } else {
    // 1) Rotate in place if the turned pose alone is clear.
    if (!collides(x, z, candidateYaw, obstacles)) nyaw = candidateYaw;
    // 2) Translate along the resolved facing if that alone is clear.
    const rhx = Math.sin(nyaw);
    const rhz = Math.cos(nyaw);
    const sx = x + rhx * throttle * MOVE_SPEED;
    const sz = z + rhz * throttle * MOVE_SPEED;
    if (!collides(sx, sz, nyaw, obstacles)) {
      nx = sx;
      nz = sz;
    }
  }

  const distanceBeforeMove = Math.hypot(target[0] - x, target[1] - z);
  const distance = Math.hypot(target[0] - nx, target[1] - nz);
  const reached = distance <= TARGET_RADIUS + AGENT_RADIUS;
  // Compare against this step's target position. For a moving target, its own
  // motion must not count as the Leaper making progress (or getting stuck).
  const madeProgress = distanceBeforeMove - distance > 1e-3;
  const stuckSteps = collided && !madeProgress ? state.stuckSteps + 1 : 0;
  const stuck = stuckSteps >= STUCK_LIMIT;

  return {
    x: nx,
    z: nz,
    yaw: nyaw,
    collided,
    distance,
    reached,
    stuck,
    stuckSteps,
    throttle, // the clipped action becomes next step's previous_action
    turn,
  };
}
