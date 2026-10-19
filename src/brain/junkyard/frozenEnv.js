// The frozen brain's world rules in JavaScript: a line-by-line port of
// rl/frozen_7757824/rl_environment.py (LeaperReachEnv), seeker_env.py
// (SeekerEnv) and rl/junkyard_env.py (JunkyardEnv), only the parts that decide
// what the brain sees (its 34 inputs) and how one step moves it.
//
// Do not "improve" anything here. The saved brain only behaves as trained when
// it gets exactly these inputs and this physics, so every rule, constant and
// even the float32 rounding follows the Python code. Rewards, episode endings
// and training-only bookkeeping are left out: the junkyard never uses them.

import { clip, f32, norm32, norm64, pyFloorDiv, pyHypot, pyMod, pyMod32 } from './pyMath.js';

// --- Constants (LeaperReachEnv class attributes) ----------------------------
const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
export const TARGET_RADIUS = 1.4;
export const AGENT_RADIUS = 0.75;
const LEG_COLLISION_RADIUS = 0.24;
const LEG_SEGMENT_RADII = [1.2, 2.2, 3.24];
const LEG_ANGLES = [-0.62, 0.62, -1.57, 1.57, -2.42, 2.42];
export const RAY_COUNT = 16;
export const RAY_MAX_RANGE = 28.0;
export const VISION_FOV = 270.0 * (PI / 180); // math.radians(270.0)
export const MOVE_SPEED = 0.375;
export const TURN_SPEED = 9.0 * (PI / 180); // math.radians(9.0)
export const TARGET_MEMORY_STEPS = 120;
const COVERAGE_CELL_SIZE = 3.0;
const FRONTIER_MIN_REGION_CELLS = 6;
export const OBS_SIZE = 34; // 10 base + 16 rays + 5 frontier note + 3 movement feedback
const BASE_SIZE = 31;
const ACTION_LOW = -1;
const ACTION_HIGH = 1;
// The 16 ray headings relative to facing, fanned evenly over the 270° cone.
const RAY_ANGLES = Array.from({ length: RAY_COUNT },
  (_, index) => -VISION_FOV / 2.0 + (index + 0.5) * (VISION_FOV / RAY_COUNT));
// Python's `np.array_split(..., ceil(n / 128))` batches visibility checks.
const VISIBILITY_BATCH = 128;
// NumPy rounds Python floats to float32 when they meet float32 arrays (NEP 50).
const TARGET_RADIUS_32 = f32(TARGET_RADIUS);
const PI_32 = f32(PI);
const TWO_PI_32 = f32(TWO_PI);
const HALF_FOV_32 = f32(VISION_FOV / 2);
const TINY_32 = f32(1e-9);

export class FrozenJunkyardEnv {
  // raster: JunkyardRaster; sight: JunkyardSight or null (legacy flat sight);
  // contact: player-contact.json; position/target [x, z]; sightPose {eye, points}.
  constructor({ raster, sight = null, contact, position, yaw, target, playerCollision = false, sightPose = null }) {
    this.raster = raster;
    this.sight = sight;
    this.contact = contact;
    this.sightPose = sightPose;
    this.sightDebug = null;
    this.playerCollision = false;
    // JunkyardEnv: keep robot units; the map size sets the "world limit".
    this.worldLimit = Math.max(Math.abs(raster.minX), Math.abs(raster.minZ), Math.abs(raster.maxX), Math.abs(raster.maxZ));
    this.maxDistance = 2.0 * Math.sqrt(2.0) * this.worldLimit;

    // LeaperReachEnv.__init__ defaults.
    this.lastCollision = 0;
    this.previousAction = [0, 0];
    this.lastVision = new Float32Array(RAY_COUNT).fill(1);
    this.steps = 0;
    this.targetVisible = false;
    this.targetEverSeen = false;
    this.lastSeenTarget = [0, 0];
    this.stepsSinceTargetSeen = TARGET_MEMORY_STEPS;
    this.initCoverage();

    // JunkyardEnv.__init__: float32 pose and target, then the start check.
    this.position = [f32(position[0]), f32(position[1])];
    this.yaw = Number(yaw);
    this.target = [f32(target[0]), f32(target[1])];
    // The server's /sense stores Lola as float64 until the next /step (see session).
    this.targetIs64 = false;
    this.playerCollision = Boolean(playerCollision);
    if (this.collisionForPose(this.position[0], this.position[1], this.yaw)) {
      throw new Error('Leaper start intersects the junkyard; reset its position');
    }
    this.resetCoverage();
    this.updateTargetMemory(false);
    this.updateCoverage();
  }

  // --- Collision ----------------------------------------------------------------

  // The 19 discs (body + 3 per leg) at a float32 pose, in Python's order.
  collisionPoints(px, pz, yaw) {
    const points = [[px, pz, AGENT_RADIUS, 'body']];
    for (const angle of LEG_ANGLES) {
      const dx = f32(Math.sin(yaw + angle)), dz = f32(Math.cos(yaw + angle));
      LEG_SEGMENT_RADII.forEach((radius, index) => {
        const r32 = f32(radius);
        points.push([f32(px + f32(dx * r32)), f32(pz + f32(dz * r32)), LEG_COLLISION_RADIUS, `leg-${index + 1}`]);
      });
    }
    return points;
  }

  // JunkyardEnv._collision_for_pose: Lola first (swept along the move), then the map.
  collisionForPose(px, pz, yaw) {
    if (this.playerCollision) {
      const sx = this.position[0], sz = this.position[1];
      const turn = pyMod(yaw - this.yaw + PI, TWO_PI) - PI;
      const current = this.playerClearance(sx, sz, this.yaw);
      const samples = Math.max(1, Math.ceil(norm64(px - sx, pz - sz) / 0.25));
      for (let i = 1; i <= samples; i += 1) {
        const t = i / samples;
        const clearance = this.playerClearance(sx + (px - sx) * t, sz + (pz - sz) * t, this.yaw + turn * t);
        if (clearance < 0 && clearance < current) return 'player';
      }
    }
    for (const [x, z, radius, part] of this.collisionPoints(px, pz, yaw)) {
      if (this.raster.diskBlocked(x, z, radius)) return part;
    }
    return null;
  }

  // Gap between Lola and the nearest Leaper disc (player-contact.json shape).
  playerClearance(cx, cz, yaw) {
    const shape = this.contact.leaperShape;
    const playerRadius = this.contact.playerRadius * this.raster.scale;
    const [tx, tz] = this.target;
    let best = norm64(tx - cx, tz - cz) - shape.bodyRadius - playerRadius;
    for (const angle of shape.legAngles) {
      const dx = Math.sin(yaw + angle), dz = Math.cos(yaw + angle);
      for (const [distance, radius] of shape.legPoints) {
        const gap = norm64(tx - (cx + dx * distance), tz - (cz + dz * distance)) - radius - playerRadius;
        if (gap < best) best = gap;
      }
    }
    return best;
  }

  // --- Seeing the junkyard and Lola ------------------------------------------------

  // Sixteen flat rays from the body centre: clear distance / 28 as float32.
  rayDistances() {
    const out = new Float32Array(RAY_COUNT);
    const [px, pz] = this.position;
    for (let i = 0; i < RAY_COUNT; i += 1) {
      const angle = this.yaw + RAY_ANGLES[i];
      out[i] = f32(this.raster.rayDistance(px, pz, Math.sin(angle), Math.cos(angle), RAY_MAX_RANGE) / RAY_MAX_RANGE);
    }
    return out;
  }

  // JunkyardGeometry.points_visible for float64 points (coverage cell centres).
  // `indices` picks which centres to test; returns a Uint8Array of 0/1.
  coverageVisible(indices) {
    const [px, pz] = this.position;
    const n = indices.length;
    const visible = new Uint8Array(n);
    const distance = new Float64Array(n);
    const dirX = new Float64Array(n), dirZ = new Float64Array(n);
    const candidates = [];
    for (let k = 0; k < n; k += 1) {
      const c = indices[k];
      const dx = this.coverageCentres[c * 2] - px, dz = this.coverageCentres[c * 2 + 1] - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      const relative = pyMod(Math.atan2(dx, dz) - this.yaw + PI, TWO_PI) - PI;
      let ok = Math.abs(relative) <= VISION_FOV / 2 && d - TARGET_RADIUS <= RAY_MAX_RANGE;
      if (d <= 1e-9) ok = true;
      visible[k] = ok ? 1 : 0;
      distance[k] = d;
      if (ok && d > 1e-9) {
        candidates.push(k);
        dirX[k] = dx / d;
        dirZ[k] = dz / d;
      }
    }
    this.marchBatches(candidates, distance, (k) => [dirX[k], dirZ[k]], (k) => distance[k] - TARGET_RADIUS, visible);
    return visible;
  }

  // The ray-march half of points_visible, batched like np.array_split so each
  // batch marches to the same range Python uses.
  marchBatches(candidates, distance, direction, threshold, visible) {
    if (!candidates.length) return;
    const batches = Math.max(1, Math.ceil(candidates.length / VISIBILITY_BATCH));
    const base = Math.floor(candidates.length / batches), extra = candidates.length % batches;
    const [px, pz] = this.position;
    const step = this.raster.cell / 2;
    let at = 0;
    for (let b = 0; b < batches; b += 1) {
      const size = base + (b < extra ? 1 : 0);
      const batch = candidates.slice(at, at + size);
      at += size;
      let longest = -Infinity;
      for (const k of batch) longest = Math.max(longest, distance[k]);
      const maxRange = Math.min(RAY_MAX_RANGE, longest);
      const count = this.raster.sampleCount(maxRange);
      for (const k of batch) {
        const [dx, dz] = direction(k);
        const limit = threshold(k);
        let hit = maxRange;
        for (let i = 0; i < count; i += 1) {
          const sample = i * step;
          // Past the threshold nothing can hide this point any more.
          if (sample >= limit && sample <= maxRange) break;
          if (this.raster.occupied(px + dx * sample, pz + dz * sample)) {
            hit = Math.min(sample, maxRange);
            break;
          }
        }
        if (!(hit >= limit)) visible[k] = 0;
      }
    }
  }

  // The old flat sight (JunkyardEnv without eye vision): points_visible for the
  // float32 target, where NumPy keeps the maths in float32.
  legacyTargetVisible() {
    const [px, pz] = this.position;
    if (this.targetIs64) {
      // After /sense the target is a float64 array: NumPy stays in float64.
      const dx = this.target[0] - px, dz = this.target[1] - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      const relative = pyMod(Math.atan2(dx, dz) - this.yaw + PI, TWO_PI) - PI;
      if (d <= 1e-9) return true;
      if (!(Math.abs(relative) <= VISION_FOV / 2 && d - TARGET_RADIUS <= RAY_MAX_RANGE)) return false;
      const visible = new Uint8Array([1]);
      this.marchBatches([0], new Float64Array([d]), () => [dx / d, dz / d], () => d - TARGET_RADIUS, visible);
      return visible[0] === 1;
    }
    const dx = f32(this.target[0] - px), dz = f32(this.target[1] - pz);
    const d = norm32(dx, dz);
    const atan = f32(Math.atan2(dx, dz));
    const relative = f32(pyMod32(f32(f32(atan - f32(this.yaw)) + PI_32), TWO_PI_32) - PI_32);
    const slack = f32(d - TARGET_RADIUS_32);
    const ok = Math.abs(relative) <= HALF_FOV_32 && slack <= RAY_MAX_RANGE;
    if (d <= TINY_32) return true;
    if (!ok) return false;
    const visible = new Uint8Array([1]);
    const distance = new Float64Array([d]);
    this.marchBatches([0], distance, () => [f32(dx / d), f32(dz / d)], () => slack, visible);
    return visible[0] === 1;
  }

  // Lola minus the Leaper: float32 normally, float64 after /sense (see session).
  targetDelta() {
    const [px, pz] = this.position;
    if (this.targetIs64) return [this.target[0] - px, this.target[1] - pz];
    return [f32(this.target[0] - px), f32(this.target[1] - pz)];
  }

  // JunkyardEnv._target_sensor: eye-level 3D sight when a pose is known,
  // otherwise the old flat sight. Returns { visible, bearing }.
  targetSensor() {
    const [px, pz] = this.position;
    const [dx, dz] = this.targetDelta();
    if (this.sight && this.sightPose) {
      // The server asks the same question up to three times per step with the
      // same inputs; reuse the answer when pose, Lola and her bones are unchanged.
      const key = [px, pz, this.yaw, this.target[0], this.target[1], this.targetIs64,
        ...this.sightPose.eye, ...this.sightPose.points.flat()];
      if (this.sensorCache && this.sensorCache.sight === this.sight
        && this.sensorCache.key.every((value, i) => Object.is(value, key[i]))) {
        this.sightDebug = this.sensorCache.debug;
        return this.sensorCache.result;
      }
      const result = this.eyeSensor(px, pz, dx, dz);
      this.sensorCache = { sight: this.sight, key, debug: this.sightDebug, result };
      return result;
    }
    const bearing = this.targetIs64 ? Math.atan2(dx, dz) : f32(Math.atan2(dx, dz));
    return { visible: this.legacyTargetVisible(), bearing };
  }

  // Eye-level 3D sight: three lines from the eye to Lola's spine bones.
  eyeSensor(px, pz, dx, dz) {
    // In view: inside the 270° cone and within ray range (Python mixes float32 here).
    const bearing = this.targetIs64 ? Math.atan2(dx, dz) : f32(Math.atan2(dx, dz));
    const relative = pyMod(bearing - this.yaw + PI, TWO_PI) - PI;
    const inRange = this.targetIs64 ? norm64(dx, dz) - TARGET_RADIUS <= RAY_MAX_RANGE
      : f32(norm32(dx, dz) - TARGET_RADIUS_32) <= RAY_MAX_RANGE;
    const inView = Math.abs(relative) <= VISION_FOV / 2 && inRange;
    // Eye position: the body-relative eye offset turned by the heading.
    const offset = this.sightPose.eye;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const origin = [px + offset[0] * c + offset[2] * s, offset[1], pz - offset[0] * s + offset[2] * c];
    // Every line is traced even out of view: the debug lines show the hits.
    const points = this.sightPose.points.map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]);
    const hits = points.map((point) => this.sight.hit(origin, point));
    const clear = hits.map((hit) => Boolean(inView && hit === null));
    this.sightDebug = { origin, points, hits, clear, in_view: Boolean(inView) };
    return { visible: clear.some(Boolean), bearing };
  }

  // LeaperReachEnv._update_target_memory: only a real sighting refreshes memory.
  updateTargetMemory(incrementTime = true) {
    const { visible } = this.targetSensor();
    this.targetVisible = visible;
    if (visible) {
      this.targetEverSeen = true;
      this.lastSeenTarget = [this.target[0], this.target[1]];
      this.stepsSinceTargetSeen = 0;
    } else if (incrementTime) {
      this.stepsSinceTargetSeen = Math.min(TARGET_MEMORY_STEPS, this.stepsSinceTargetSeen + 1);
    }
  }

  // --- Search coverage and the frontier note -----------------------------------------

  initCoverage() {
    const limit = this.worldLimit;
    const steps = pyFloorDiv(2.0 * limit, COVERAGE_CELL_SIZE) + 1;
    this.coverageSteps = steps;
    this.coverageCentres = new Float64Array(steps * steps * 2);
    for (let i = 0; i < steps; i += 1) {
      for (let j = 0; j < steps; j += 1) {
        this.coverageCentres[(i * steps + j) * 2] = -limit + (i + 0.5) * COVERAGE_CELL_SIZE;
        this.coverageCentres[(i * steps + j) * 2 + 1] = -limit + (j + 0.5) * COVERAGE_CELL_SIZE;
      }
    }
    this.coverageCleared = new Uint8Array(steps * steps);
    this.coverageNewCells = [];
  }

  // JunkyardEnv._reset_coverage: cells outside the rectangular yard start cleared.
  resetCoverage() {
    const r = this.raster;
    for (let c = 0; c < this.coverageCleared.length; c += 1) {
      const x = this.coverageCentres[c * 2], z = this.coverageCentres[c * 2 + 1];
      this.coverageCleared[c] = x < r.minX || z < r.minZ || x >= r.maxX || z >= r.maxZ ? 1 : 0;
    }
    this.coverageNewCells = [];
  }

  // Mark every currently checkable, not-yet-cleared cell as cleared.
  updateCoverage() {
    const uncleared = [];
    for (let c = 0; c < this.coverageCleared.length; c += 1) if (!this.coverageCleared[c]) uncleared.push(c);
    if (!uncleared.length) {
      this.coverageNewCells = [];
      return;
    }
    const visible = this.coverageVisible(uncleared);
    const fresh = [];
    uncleared.forEach((c, k) => { if (visible[k]) fresh.push(c); });
    for (const c of fresh) this.coverageCleared[c] = 1;
    this.coverageNewCells = fresh;
  }

  // PPO_33 frontier note: direction, distance and size of the largest unchecked
  // region's nearest edge cell. Same flood-fill order as Python (ties matter).
  frontierNote() {
    const invalid = [0, 0, 1, 0, 0];
    const steps = this.coverageSteps;
    const total = this.coverageCleared.length;
    const cleared = this.coverageCleared;
    if (cleared.every((v) => v === 1)) return invalid;
    const labels = new Uint8Array(total);
    let best = [];
    for (let si = 0; si < steps; si += 1) {
      for (let sj = 0; sj < steps; sj += 1) {
        const start = si * steps + sj;
        if (cleared[start] || labels[start]) continue;
        const stack = [start];
        labels[start] = 1;
        const cells = [];
        while (stack.length) {
          const cell = stack.pop();
          cells.push(cell);
          const i = Math.floor(cell / steps), j = cell % steps;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && ni < steps && nj >= 0 && nj < steps) {
              const next = ni * steps + nj;
              if (!cleared[next] && !labels[next]) {
                labels[next] = 1;
                stack.push(next);
              }
            }
          }
        }
        if (cells.length > best.length) best = cells;
      }
    }
    if (best.length < FRONTIER_MIN_REGION_CELLS) return invalid;

    // Frontier = region cells touching a cleared cell; else the whole region.
    const touches = (cell) => {
      const i = Math.floor(cell / steps), j = cell % steps;
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const ni = i + di, nj = j + dj;
        return ni >= 0 && ni < steps && nj >= 0 && nj < steps && cleared[ni * steps + nj] === 1;
      });
    };
    const frontier = best.filter(touches);
    const candidates = frontier.length ? frontier : best;
    const limit = this.worldLimit;
    const px = this.position[0], pz = this.position[1];
    let bestDistance = Infinity, bestX = 0, bestZ = 0;
    for (const cell of candidates) {
      const i = Math.floor(cell / steps), j = cell % steps;
      const cx = -limit + (i + 0.5) * COVERAGE_CELL_SIZE;
      const cz = -limit + (j + 0.5) * COVERAGE_CELL_SIZE;
      const distance = pyHypot(cx - px, cz - pz);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestX = cx;
        bestZ = cz;
      }
    }
    const diagonal = 2.0 * Math.sqrt(2.0) * limit;
    const far = bestDistance > 1e-6;
    return [far ? (bestX - px) / bestDistance : 0, far ? (bestZ - pz) / bestDistance : 0,
      Math.min(bestDistance / diagonal, 1.0), Math.min(best.length / total, 1.0), 1.0];
  }

  // --- The observation (indices 0-30; the session adds 31-33) ----------------------

  observation() {
    const out = new Float32Array(BASE_SIZE);
    let rememberedDistance = this.maxDistance, dirX = 0, dirZ = 0;
    if (this.targetEverSeen) {
      const dx = f32(this.lastSeenTarget[0] - this.position[0]);
      const dz = f32(this.lastSeenTarget[1] - this.position[1]);
      rememberedDistance = norm32(dx, dz);
      const divisor = f32(Math.max(rememberedDistance, 1e-6));
      dirX = f32(dx / divisor);
      dirZ = f32(dz / divisor);
    }
    out[0] = this.targetVisible ? 1 : 0;
    out[1] = clip(this.stepsSinceTargetSeen / TARGET_MEMORY_STEPS, 0, 1);
    out[2] = dirX;
    out[3] = dirZ;
    out[4] = clip(rememberedDistance / this.maxDistance, 0, 1);
    out[5] = Math.sin(this.yaw);
    out[6] = Math.cos(this.yaw);
    out[7] = this.lastCollision;
    out[8] = this.previousAction[0];
    out[9] = this.previousAction[1];
    this.lastVision = this.rayDistances();
    out.set(this.lastVision, 10);
    out.set(this.frontierNote(), 26);
    return out;
  }

  initialObservation() {
    const out = new Float32Array(OBS_SIZE);
    out.set(this.observation(), 0);
    return out;
  }

  // LeaperReachEnv._distance (norm of the float32, or after /sense float64, gap).
  distance() {
    const [dx, dz] = this.targetDelta();
    return this.targetIs64 ? norm64(dx, dz) : norm32(dx, dz);
  }

  // --- One step (LeaperReachEnv.step + SeekerEnv.step, physics part) --------------

  step(action) {
    // Clip to the action box in float32, like np.clip on the float32 action.
    const throttle = clip(f32(action[0]), ACTION_LOW, ACTION_HIGH);
    const turnInput = clip(f32(action[1]), ACTION_LOW, ACTION_HIGH);
    const [startX, startZ] = this.position;
    const startYaw = this.yaw;

    // Intended pose: turn, then move along the new heading (signed throttle:
    // this checkpoint backs up when throttle is negative).
    const candidateYaw = pyMod(this.yaw + turnInput * TURN_SPEED + PI, TWO_PI) - PI;
    const move = (yaw) => {
      const hx = f32(Math.sin(yaw)), hz = f32(Math.cos(yaw));
      const t32 = f32(throttle);
      return [f32(startX + f32(f32(hx * t32) * MOVE_SPEED)), f32(startZ + f32(f32(hz * t32) * MOVE_SPEED))];
    };
    const [candidateX, candidateZ] = move(candidateYaw);

    // Collision: if the full move is blocked, try turning alone, then moving alone.
    const collisionPart = this.collisionForPose(candidateX, candidateZ, candidateYaw);
    const collided = collisionPart !== null;
    if (!collided) {
      this.position = [candidateX, candidateZ];
      this.yaw = candidateYaw;
    } else {
      if (this.collisionForPose(this.position[0], this.position[1], candidateYaw) === null) this.yaw = candidateYaw;
      const [steppedX, steppedZ] = move(this.yaw);
      if (this.collisionForPose(steppedX, steppedZ, this.yaw) === null) this.position = [steppedX, steppedZ];
    }

    // Senses and memory after the move.
    this.steps += 1;
    const distance = this.distance();
    const reached = distance <= TARGET_RADIUS + AGENT_RADIUS;
    this.updateTargetMemory(true);
    this.updateCoverage();
    this.lastCollision = collided ? 1 : 0;
    this.previousAction = [throttle, turnInput];

    // Observation plus SeekerEnv's movement feedback (indices 31-33).
    const obs = new Float32Array(OBS_SIZE);
    obs.set(this.observation(), 0);
    const moveScale = f32(MOVE_SPEED);
    obs[31] = clip(f32(f32(this.position[0] - startX) / moveScale), -1, 1);
    obs[32] = clip(f32(f32(this.position[1] - startZ) / moveScale), -1, 1);
    obs[33] = clip((pyMod(this.yaw - startYaw + PI, TWO_PI) - PI) / TURN_SPEED, -1, 1);
    return { obs, info: { collision: collided, collisionPart, isSuccess: reached } };
  }

  // --- Teacher forcing: copy a recorded Python state in ------------------------------

  setState(state, cleared) {
    this.position = [f32(state.position[0]), f32(state.position[1])];
    this.yaw = state.yaw;
    this.steps = state.steps;
    this.target = [f32(state.target[0]), f32(state.target[1])];
    this.targetIs64 = false;
    this.lastCollision = state.last_collision;
    this.previousAction = [f32(state.previous_action[0]), f32(state.previous_action[1])];
    this.targetVisible = state.target_visible;
    this.targetEverSeen = state.target_ever_seen;
    this.lastSeenTarget = [f32(state.last_seen_target[0]), f32(state.last_seen_target[1])];
    this.stepsSinceTargetSeen = state.steps_since_target_seen;
    if (cleared) this.coverageCleared.set(cleared);
  }
}
