import { contact } from '../world/playerContact.js';
import { lerpAngle, wrapAngle } from '../core/angles.js';

// Option A playback smoothing (inference only; the trained brain is untouched).
// The rendered Leaper eases toward each brain reply at these rates, in 1/seconds.
// Position stays responsive; heading is smoothed harder so the policy's rapid
// left/right steering micro-corrections average out instead of showing as a shimmy.
// Higher = snappier/twitchier, lower = smoother/laggier.
const LEAPER_FOLLOW_RESPONSE = 18;
const LEAPER_TURN_RESPONSE = 9;
// Brain moves per second while running. Each move advances the Leaper a fixed
// distance, so this sets its speed. A steady rate keeps the Leaper's speed the
// same on busy and idle computers (a move takes ~40 ms to compute).
const LEAPER_STEPS_PER_SECOND = 10;
// A slow or failed move is retried; the run only stops after this many in a row.
const MAX_FAILED_STEPS = 5;

// One frame of the playback smoothing: ease the rendered pose ({x, z, yaw}) toward
// the latest brain reply. The heading always turns the short way and stays within
// one turn, so a Leaper that keeps circling never "whips" round (review fix 5.3).
export function followPose(current, target, dt) {
  const tPos = 1 - Math.exp(-LEAPER_FOLLOW_RESPONSE * dt);
  const tYaw = 1 - Math.exp(-LEAPER_TURN_RESPONSE * dt);
  return {
    x: current.x + (target.x - current.x) * tPos,
    z: current.z + (target.z - current.z) * tPos,
    yaw: wrapAngle(lerpAngle(current.yaw, target.yaw, tYaw)),
  };
}

// Only the checkpoint server chooses movement. No navigation-route fallback.
export class JunkyardBrain {
  constructor(playtest) {
    this.playtest = playtest;
    this.simulation = playtest.simulation;
    this.target = playtest.target;
    this.running = false;
    this.ready = false;
    this.busy = false;
    this.pendingMovement = false;
    this.clock = 0;
    this.generation = 0;
    this.frame = null;
    this.label = 'BRAIN CONNECTING';
  }

  // Where Lola must not walk: the rendered Leaper is somewhere between its last
  // two server poses, and while a move is in flight one maximum server step is
  // reserved. Registered with WorldCollision through createLeaperBlocker.
  contactPoses() {
    const state = this.simulation.state;
    const from = this.previousFrame || { x: state.position.x, z: state.position.z, yaw: state.yaw };
    return { from, to: this.frame || from, margin: this.pendingMovement ? contact.pendingStepMargin : 0 };
  }

  async request(path, payload) {
    // Plain-text content type makes this a "simple" request: no extra permission
    // (CORS preflight) round trip before every move. The body is still JSON.
    const response = await fetch(`http://127.0.0.1:8767/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(path === 'reset' ? 90000 : 3000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Brain service failed');
    return result;
  }

  async reset() {
    const generation = ++this.generation;
    this.ready = false;
    this.busy = true;
    this.pendingMovement = false;
    this.failedSteps = 0;
    this.token = null;
    this.label = 'LOADING SAVED BRAIN…';
    const state = this.simulation.state;
    this.frame = { x: state.position.x, z: state.position.z, yaw: state.yaw, distance: 0, collision: false, model_step: 7757824 };
    this.previousFrame = { ...this.frame };
    try {
      const frame = await this.request('reset', {
        width: this.playtest.world.width, position: [state.position.x, state.position.z],
        yaw: state.yaw, target: [this.target.mesh.position.x, this.target.mesh.position.z],
        player_collision: Boolean(this.target.isPlayer),
        ...(this.playtest.sight ? { sight_mode: this.playtest.sight.mode,
          sight_pose: this.playtest.sight.pose() } : {}),
      });
      if (generation !== this.generation) return;
      if (frame.model_step !== 7757824 || !frame.policy_sha256) throw new Error('Unexpected checkpoint identity');
      if (this.target.isPlayer && frame.contact_version !== contact.version) throw new Error('Restart the brain service to enable player collision');
      if (this.playtest.sight && frame.sight_version !== this.playtest.sight.version) throw new Error('Restart the brain service to enable eye-level vision');
      this.token = frame.token;
      this.frame = frame;
      this.previousFrame = frame;
      this.playtest.sight?.show(frame);
      this.ready = true;
      this.label = 'BRAIN 7,757,824';
      this.playtest.message.textContent = 'Saved brain loaded. Start Run to search and chase; WASD moves Lola; Shift sprints; Space jumps; C crouches; 1 / 2 switch guns; left click fires whichever gun is equipped, even while the Leaper run is stopped.';
      this.playtest.brainLabel.title = `Residual LSTM · inference only · policy SHA256 ${frame.policy_sha256}`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  // The service is unreachable or refused: stop asking, explain, and let the game
  // decide what that means for the fight (onFailed; the junkyard returns to Ready).
  fail(error) {
    this.ready = false;
    this.running = false;
    this.label = 'BRAIN OFFLINE — START RUN TO RETRY';
    this.playtest.message.textContent = `Brain unavailable: ${error.message}. Start the local brain service, then press Reset. No pathfinder fallback.`;
    this.onFailed?.(error);
  }

  start() {
    this.running = true;
    if (!this.ready && !this.busy) this.reset();
  }

  stop() {
    this.running = false;
    this.clock = 0;
    // Finish displaying a pending server step so collision and the visible
    // robot keep the same position while paused. No new step is requested.
  }

  // Ask the server for moves at a steady rate and ease the visible Leaper toward
  // each reply. Lola's own movement is PlayerController's job, not the brain's.
  update(dt) {
    const sim = this.simulation;
    // Slow inference steps with damage so the server and rendered position remain in sync.
    this.clock += dt * (sim.rig?.mobility ?? 1);
    const encounterOver = this.playtest.combat?.dead;
    const preview = !encounterOver && !this.running && Boolean(this.playtest.sight);
    if (this.ready && (this.running || preview) && !this.busy && this.clock >= (preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND) && !document.hidden) {
      this.clock = 0;
      this.busy = true;
      this.pendingMovement = !preview;
      const generation = this.generation;
      this.request(preview ? 'sense' : 'step', { token: this.token,
        target: [this.target.mesh.position.x, this.target.mesh.position.z],
        ...(this.playtest.sight ? { sight_pose: this.playtest.sight.pose() } : {}),
      }).then((frame) => {
        if (generation !== this.generation) return;
        this.previousFrame = this.frame;
        this.frame = frame;
        this.renderAge = 0;
        this.failedSteps = 0;
        this.playtest.sight?.show(frame);
      }).catch((error) => {
        if (generation !== this.generation) return;
        // A busy computer can delay one move; keep the run going and try again.
        this.failedSteps = (this.failedSteps ?? 0) + 1;
        if (this.failedSteps >= MAX_FAILED_STEPS || /Session expired/.test(error.message)) this.fail(error);
      }).finally(() => {
        if (generation === this.generation) {
          this.busy = false;
          this.pendingMovement = false;
        }
      });
    }
    if (this.frame && !encounterOver) {
      // Follow each network pose from the current rendered pose. Restarting at the
      // previous server frame caused snaps whenever replies arrived early or late.
      const now = this.frame;
      const { position, yaw } = sim.state;
      sim.updateExternal({ ...now, ...followPose({ x: position.x, z: position.z, yaw }, now, dt) },
        dt, { checkpoint: { step: now.model_step } });
    }
  }

  // What the brain is doing, for the panel badge and the top-right status line
  // (written by the junkyard's presentation phase).
  describe() {
    const mode = !this.ready ? this.label : !this.running ? 'PAUSED'
      : this.failedSteps ? 'BRAIN SLOW · RETRYING'
      : this.frame.target_visible ? 'TARGET VISIBLE'
        : this.frame.target_ever_seen ? 'TARGET HIDDEN · MEMORY' : 'SEARCHING';
    return {
      label: this.ready ? `BRAIN 7,757,824 · ${mode}` : this.label,
      status: `LIVE TRAINED BRAIN // ${mode}${this.frame?.collision ? ' // CONTACT' : ''} // STEP ${this.frame?.step || 0}`,
    };
  }
}
