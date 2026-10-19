// One Leaper brain session in the browser: a port of BrainSession and the
// /reset, /step and /sense handlers of rl/junkyard_server.py.
//
// It keeps the frozen environment (frozenEnv.js), the LSTM memory and the last
// action, and answers with the same "frame" objects the HTTP server sends, so
// the game can swap the Python service for this without changing anything else.

import { FrozenJunkyardEnv, OBS_SIZE } from './frozenEnv.js';
import { pyMod } from './pyMath.js';

export const MODEL_STEP = 7757824;

// --- Request checks (the server's vector() and sight_pose() helpers) ----------

function finiteArray(value, shape) {
  const flat = [];
  const walk = (item, depth) => {
    if (depth === shape.length) {
      if (typeof item !== 'number' && typeof item !== 'boolean') throw new Error('Expected numbers');
      flat.push(Number(item));
      return;
    }
    if (!Array.isArray(item) || item.length !== shape[depth]) throw new Error('Wrong shape');
    item.forEach((child) => walk(child, depth + 1));
  };
  walk(value, 0);
  return flat;
}

export function checkVector(value) {
  let flat;
  try { flat = finiteArray(value, [2]); } catch { throw new Error('Expected a finite map position'); }
  if (!flat.every(Number.isFinite) || flat.some((v) => Math.abs(v) > 500)) throw new Error('Expected a finite map position');
  return flat;
}

export function checkSightPose(data) {
  const pose = data.sight_pose;
  if (!pose || typeof pose !== 'object' || Array.isArray(pose)) throw new Error('Eye vision requires eye and target body points');
  let eye, points;
  try {
    eye = finiteArray(pose.eye, [3]);
    points = finiteArray(pose.points, [3, 3]);
  } catch {
    throw new Error('Invalid eye vision pose');
  }
  if (!eye.every(Number.isFinite) || !points.every(Number.isFinite)
    || eye.some((v) => Math.abs(v) > 20) || points.some((v) => Math.abs(v) > 500)) {
    throw new Error('Invalid eye vision pose');
  }
  return { eye, points: [points.slice(0, 3), points.slice(3, 6), points.slice(6, 9)] };
}

// --- Session ------------------------------------------------------------------

export class JunkyardBrainSession {
  // policy.act(obs Float32Array(34), memory|null, episodeStart) -> { action, memory }
  constructor({ policy, world, contact, sightVersion, contactVersion, position, yaw, target, playerCollision, sightPose }) {
    this.policy = policy;
    this.sightVersion = sightVersion;
    this.contactVersion = contactVersion;
    this.env = new FrozenJunkyardEnv({ raster: world.raster, sight: sightPose ? world.sight : null, contact,
      position, yaw, target, playerCollision, sightPose });
    this.obs = this.env.initialObservation();
    this.memory = null;
    this.action = new Float32Array(2);
    this.info = {};
  }

  // /step: refresh sight (eye mode), ask the policy, move one step.
  async step(target, sightPose = null) {
    const env = this.env;
    // /step stores Lola as float32 (np.asarray(target, dtype=np.float32)).
    env.target = [Math.fround(target[0]), Math.fround(target[1])];
    env.targetIs64 = false;
    if (env.sight) {
      env.sightPose = sightPose;
      // Live sight before inference; memory never sees a hidden Lola.
      env.updateTargetMemory(false);
      const refreshed = new Float32Array(OBS_SIZE);
      refreshed.set(env.observation(), 0);
      refreshed.set(this.obs.subarray(31), 31);
      this.obs = refreshed;
    }
    const { action, memory } = await this.policy.act(this.obs, this.memory, env.steps === 0);
    this.action = Float32Array.from(action);
    this.memory = memory;
    const { obs, info } = env.step(this.action);
    if (obs.length !== OBS_SIZE || !obs.every(Number.isFinite)) throw new Error('Invalid checkpoint observation');
    this.obs = obs;
    this.info = info;
    return this.snapshot();
  }

  // /sync: game logic moved the Leaper between brain steps (a leap). Port of
  // BrainSession.sync in rl/junkyard_server.py. Only the pose changes; the
  // observation is then recomputed by the unchanged observation code, exactly as
  // /step refreshes it before inference in eye mode:
  //   1. refuse a pose whose body or leg discs overlap the junkyard (the frozen
  //      physics could never move out of it); Lola's contact is not checked;
  //   2. put the Leaper there (float32 position, heading wrapped to [-pi, pi));
  //   3. look from there: sight memory without ageing it, then search coverage;
  //   4. the next policy input = the observation at the new pose plus the last
  //      move's feedback (inputs 31-33), which a pose sync does not change.
  // The step count, LSTM memory and last action are kept: no new episode.
  sync(position, yaw, target, sightPose = null) {
    const env = this.env;
    const px = Math.fround(position[0]), pz = Math.fround(position[1]);
    const heading = pyMod(Number(yaw) + Math.PI, 2 * Math.PI) - Math.PI;
    for (const [x, z, radius] of env.collisionPoints(px, pz, heading)) {
      if (env.raster.diskBlocked(x, z, radius)) throw new Error('Leaper pose intersects the junkyard; choose a clear spot');
    }
    env.position = [px, pz];
    env.yaw = heading;
    env.target = [Math.fround(target[0]), Math.fround(target[1])];
    env.targetIs64 = false;
    if (env.sight) env.sightPose = sightPose;
    env.updateTargetMemory(false);
    env.updateCoverage();
    const refreshed = new Float32Array(OBS_SIZE);
    refreshed.set(env.observation(), 0);
    refreshed.set(this.obs.subarray(31), 31);
    this.obs = refreshed;
    return this.snapshot();
  }

  // /sense: paused preview; no policy, no movement, no memory update.
  // The server keeps the validated float64 position here (vector() output), so
  // the preview's sight and distance are computed in float64, not float32.
  sense(target, sightPose = null) {
    this.env.target = [Number(target[0]), Number(target[1])];
    this.env.targetIs64 = true;
    this.env.sightPose = sightPose;
    return this.snapshot();
  }

  // BrainSession.snapshot: the frame the HTTP server returns.
  snapshot() {
    const env = this.env;
    const { visible } = env.targetSensor();
    return {
      x: env.position[0], z: env.position[1], yaw: env.yaw,
      sight_version: this.sightVersion, sight: env.sightDebug,
      sight_visible: Boolean(visible), sight_mode: env.sight ? 'eye' : 'legacy',
      contact_version: this.contactVersion,
      step: env.steps, model_step: MODEL_STEP, distance: env.distance(),
      collision: Boolean(this.info.collision), collisionPart: this.info.collisionPart ?? null,
      target_visible: Boolean(env.targetVisible), target_ever_seen: Boolean(env.targetEverSeen),
      throttle: this.action[0], turn: this.action[1],
      vision: Array.from(env.lastVision), memory_age: env.stepsSinceTargetSeen,
      caught: Boolean(this.info.isSuccess),
    };
  }
}

// --- The server's request handling, minus HTTP ------------------------------------

// loadWorld(width) -> Promise<{ raster, sight }>; tokens identify sessions like
// the server's uuid tokens, and at most 8 sessions are kept (oldest dropped).
export class JunkyardBrainCore {
  constructor({ policy, loadWorld, contact, eyeVision, policySha256, maxSessions = 8 }) {
    this.policy = policy;
    this.loadWorld = loadWorld;
    this.contact = contact;
    this.eyeVision = eyeVision;
    this.policySha256 = policySha256;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
    this.counter = 0;
  }

  async reset(data) {
    const width = Number(data.width), yaw = Number(data.yaw);
    if (!Number.isFinite(width + yaw) || !(width >= 1.2 && width <= 8)) throw new Error('Invalid robot size or heading');
    const mode = data.sight_mode ?? 'legacy';
    if (mode !== 'eye' && mode !== 'legacy') throw new Error('Unknown sight mode');
    const world = await this.loadWorld(width);
    const session = new JunkyardBrainSession({
      policy: this.policy, world, contact: this.contact,
      sightVersion: this.eyeVision.version, contactVersion: this.contact.version,
      position: checkVector(data.position), yaw, target: checkVector(data.target),
      playerCollision: data.player_collision === true,
      sightPose: mode === 'eye' ? checkSightPose(data) : null,
    });
    if (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    this.counter += 1;
    const token = `onnx-${Date.now().toString(16)}-${this.counter}`;
    this.sessions.set(token, session);
    return { ...session.snapshot(), token, policy_sha256: this.policySha256 };
  }

  session(data) {
    const session = this.sessions.get(data?.token);
    if (!session) throw new Error('Session expired. Reset Leaper to reconnect');
    return session;
  }

  async step(data) {
    const session = this.session(data);
    const target = checkVector(data.target);
    const pose = session.env.sight ? checkSightPose(data) : null;
    return session.step(target, pose);
  }

  async sense(data) {
    const session = this.session(data);
    const target = checkVector(data.target);
    const pose = session.env.sight ? checkSightPose(data) : null;
    return session.sense(target, pose);
  }

  // /sync: { token, position, yaw, target, sight_pose } (see JunkyardBrainSession.sync).
  async sync(data) {
    const session = this.session(data);
    const position = checkVector(data.position);
    const target = checkVector(data.target);
    const yaw = data.yaw;
    if (typeof yaw !== 'number' || !Number.isFinite(yaw)) throw new Error('Invalid robot heading');
    const pose = session.env.sight ? checkSightPose(data) : null;
    return session.sync(position, yaw, target, pose);
  }

  // /close: forget a session; unknown tokens are not an error.
  close(data) {
    const token = data?.token;
    return { closed: typeof token === 'string' && this.sessions.delete(token) };
  }
}
