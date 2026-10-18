import { contact } from '../world/playerContact.js';
import { lerpAngle, wrapAngle } from '../core/angles.js';
import { FixedStep } from '../core/GameLoop.js';

// Option A playback smoothing (inference only; the trained brain is untouched).
// The rendered Leaper eases toward each brain reply at these rates, in 1/seconds.
// Position stays responsive; heading is smoothed harder so the policy's rapid
// left/right steering micro-corrections average out instead of showing as a shimmy.
// Higher = snappier/twitchier, lower = smoother/laggier.
const LEAPER_FOLLOW_RESPONSE = 18;
const LEAPER_TURN_RESPONSE = 9;
// Brain moves per second while running. Each move advances the Leaper a fixed
// distance (0.375 brain units), so this sets its speed: 3.75 units and 90 degrees
// of turning per second at 10. A steady rate keeps the Leaper's speed the same on
// busy and idle computers (a move takes ~40 ms to compute). Keep it at or below
// about 24, or the legs can no longer keep up and the gait stops looking planted.
export const LEAPER_STEPS_PER_SECOND = 10;
// While stopped, the brain is asked what it can see (no movement) this often, in
// seconds, so the always-visible sight readout stays live.
const PREVIEW_INTERVAL = 0.1;
// A slow or failed move is retried; the brain only goes offline after this many in a row.
const MAX_FAILED_STEPS = 5;
// While a run goes on in turret mode, the brain service is tried again this often
// (seconds of play), so a short outage or a very busy computer doesn't leave the
// Leaper planted for the rest of the fight.
const OFFLINE_RETRY_SECONDS = 5;

// The brain service's address when nothing else is configured (the owner's PC).
export const DEFAULT_BRAIN_URL = 'http://127.0.0.1:8767';
// One wording everywhere for "no brain" (review fix 5.11): the badge while
// stopped, and the badge while a run goes on without it.
export const BRAIN_OFFLINE_LABEL = 'BRAIN OFFLINE — start the brain service (see README), then press START RUN';
export const BRAIN_TURRET_LABEL = 'BRAIN OFFLINE · TURRET MODE';

// Where the brain service lives: VITE_BRAIN_URL when the game is built (or the
// dev server started), else ?brainUrl= in the page address, else the default.
// Only http(s) addresses are accepted; anything else falls back to the default.
export function brainServiceUrl({
  envUrl = import.meta.env?.VITE_BRAIN_URL,
  search = globalThis.location?.search ?? '',
} = {}) {
  for (const candidate of [envUrl, new URLSearchParams(search).get('brainUrl')]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href.replace(/\/+$/, '');
    } catch { /* Not an address: try the next source. */ }
  }
  return DEFAULT_BRAIN_URL;
}

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

// Only the checkpoint server chooses movement. No navigation-route fallback:
// without the service the Leaper stands still (the game calls that turret mode,
// because its attacks keep working).
export class JunkyardBrain {
  constructor(playtest) {
    this.playtest = playtest;
    this.simulation = playtest.simulation;
    this.target = playtest.target;
    this.url = brainServiceUrl();
    this.running = false;
    this.ready = false;
    // True after the service could not be reached (or refused); START RUN retries.
    this.offline = false;
    this.busy = false;
    this.pendingMovement = false;
    // The brain's own clock. Leftover time is carried from frame to frame, so the
    // Leaper takes LEAPER_STEPS_PER_SECOND moves per second at any frame rate
    // (review fix 5.13). Up to one move of "debt" is kept while a reply is late.
    this.cadence = new FixedStep(1 / LEAPER_STEPS_PER_SECOND, { maxSteps: 2 });
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
    const response = await fetch(`${this.url}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(path === 'reset' ? 90000 : 3000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Brain service failed');
    return result;
  }

  // A fresh brain session at the Leaper's current pose. While the service is
  // offline, `offline` stays set until this succeeds, so the badge doesn't flicker.
  async reset() {
    const generation = ++this.generation;
    const wasOffline = this.offline;
    this.ready = false;
    this.offlineTime = 0;
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
      this.offline = false;
      this.label = 'BRAIN 7,757,824';
      this.playtest.message.textContent = wasOffline && this.playtest.walking
        ? 'The brain service is back: the trained brain hunts again (a fresh brain session).'
        : 'Saved brain loaded. Start Run to search and chase; WASD moves Lola; Shift sprints; Space jumps; C crouches; 1 / 2 switch guns; left click fires whichever gun is equipped, even while the Leaper run is stopped.';
      this.playtest.brainLabel.title = `Residual LSTM · inference only · policy SHA256 ${frame.policy_sha256}`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  // The service is unreachable or refused: stop asking, explain, and let the game
  // decide what that means for the fight (onFailed; the junkyard keeps a run
  // going in turret mode). The Leaper keeps its last pose.
  fail(error) {
    this.ready = false;
    this.running = false;
    this.offline = true;
    this.offlineTime = 0;
    this.label = BRAIN_OFFLINE_LABEL;
    this.playtest.message.textContent = `Brain offline (${error.message}). Start the brain service (see README), then press START RUN. `
      + 'Until then START RUN plays in turret mode: the Leaper stays put but still shoots.';
    // The sight readout comes from the service too; say so instead of "connecting".
    if (this.playtest.sight?.label) this.playtest.sight.label.textContent = 'SIGHT OFFLINE · NEEDS THE BRAIN SERVICE';
    this.onFailed?.(error);
  }

  start() {
    this.running = true;
    if (!this.ready && !this.busy) this.reset();
  }

  stop() {
    this.running = false;
    this.cadence.reset();
    // Finish displaying a pending server step so collision and the visible
    // robot keep the same position while paused. No new step is requested.
  }

  // Ask the server for moves at a steady rate and ease the visible Leaper toward
  // each reply. Lola's own movement is PlayerController's job, not the brain's.
  update(dt) {
    const sim = this.simulation;
    const encounterOver = this.playtest.combat?.dead;
    // 0. Turret mode: during the run, try the service again every few seconds.
    if (this.offline && this.playtest.walking && !this.busy && !encounterOver) {
      this.offlineTime = (this.offlineTime ?? 0) + dt;
      if (this.offlineTime >= OFFLINE_RETRY_SECONDS) {
        this.running = true;
        this.reset();
      }
    }
    const preview = !encounterOver && !this.running && Boolean(this.playtest.sight);
    // 1. The brain clock only runs while moves (or stopped sight previews) may be
    //    asked for. Damage slows it, so the server and the rendered legs stay in sync.
    const stepping = this.ready && !encounterOver && (this.running || preview) && !document.hidden;
    this.cadence.step = preview ? PREVIEW_INTERVAL : 1 / LEAPER_STEPS_PER_SECOND;
    if (stepping) this.cadence.add(dt * (sim.rig?.mobility ?? 1));
    // 2. One request at a time: a due move waits (keeping its time) until the
    //    previous reply has arrived.
    if (stepping && !this.busy && this.cadence.take()) {
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
    if (encounterOver) {
      // 3a. The fight is over: no more moves, but the Leaper's feet finish landing.
      sim.settle?.(dt);
    } else if (this.frame) {
      // 3b. Follow each network pose from the current rendered pose. Restarting at
      //     the previous server frame caused snaps whenever replies arrived early or late.
      const now = this.frame;
      const { position, yaw } = sim.state;
      sim.updateExternal({ ...now, ...followPose({ x: position.x, z: position.z, yaw }, now, dt) },
        dt, { checkpoint: { step: now.model_step } });
    }
  }

  // What the brain is doing, for the panel badge and the top-right status line
  // (written by the junkyard's presentation phase).
  describe() {
    // Offline: a run carries on in turret mode; otherwise say how to fix it.
    if (this.offline) {
      const turret = Boolean(this.playtest.walking);
      return {
        label: turret ? BRAIN_TURRET_LABEL : BRAIN_OFFLINE_LABEL,
        status: turret ? 'NO BRAIN SERVICE // TURRET MODE: THE LEAPER STAYS PUT BUT STILL SHOOTS'
          : 'NO BRAIN SERVICE // START IT, THEN PRESS START RUN',
      };
    }
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
