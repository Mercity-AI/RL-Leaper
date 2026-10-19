import { contact } from '../world/playerContact.js';
import { lerpAngle, wrapAngle } from '../core/angles.js';
import { FixedStep } from '../core/GameLoop.js';
import { ENCOUNTER } from '../config/encounter.js';
import { BRAIN_PROVIDERS, brainProviderOrder, createBrainProvider, describeProgress } from '../brain/BrainProvider.js';
import { HttpBrainProvider, brainServiceUrl, DEFAULT_BRAIN_URL } from '../brain/HttpBrainProvider.js';
import { OnnxBrainProvider } from '../brain/junkyard/OnnxBrainProvider.js';

// The brain service's address helpers live with the HTTP provider now; they are
// re-exported here for the code and tests that always found them in this file.
export { brainServiceUrl, DEFAULT_BRAIN_URL };

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
// While a run goes on in turret mode, the brain is tried again this often
// (seconds of play), so a short outage or a very busy computer doesn't leave the
// Leaper planted for the rest of the fight.
const OFFLINE_RETRY_SECONDS = 5;
// A brain move shorter than this (brain units) counts as "not moving", the same
// threshold training's freeze rule used.
const STILL_DISTANCE = 1e-3;
// Soft episode restarts remembered for the debug readout and playtest logs.
const EPISODE_LOG_LENGTH = 50;

// One wording everywhere for "no brain" (review fix 5.11): the badge while
// stopped, and the badge while a run goes on without it.
export const BRAIN_OFFLINE_LABEL = 'BRAIN OFFLINE — reload, or start the brain service (see README), then press START RUN';
export const BRAIN_TURRET_LABEL = 'BRAIN OFFLINE · TURRET MODE';

// The brain the game uses: the saved network in this page (ONNX in a worker)
// first, the local Python service if that cannot load, then turret mode.
// ?brain=http / onnx / turret picks another order (see brainProviderOrder).
export function createGameBrainProvider({ search = globalThis.location?.search ?? '' } = {}) {
  return createBrainProvider({
    order: brainProviderOrder(search),
    factories: {
      onnx: () => new OnnxBrainProvider(),
      http: () => new HttpBrainProvider({ url: brainServiceUrl({ search }) }),
    },
  });
}

// The soft episode restart rule (review fix 5.12) from src/config/encounter.js.
// ?softRestart=1 / 0 in the page address overrides `enabled`, for playtests
// that compare both without editing the config.
export function softRestartRule({ search = globalThis.location?.search ?? '' } = {}) {
  const rule = { ...ENCOUNTER.brainSoftRestart };
  const flag = new URLSearchParams(search).get('softRestart');
  if (flag === '1' || flag === 'on') rule.enabled = true;
  if (flag === '0' || flag === 'off') rule.enabled = false;
  return rule;
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

// Only the trained brain chooses movement. No navigation-route fallback: without
// a brain the Leaper stands still (the game calls that turret mode, because its
// attacks keep working). Where the brain runs is the provider's business
// (src/brain/BrainProvider.js); this class decides WHEN to ask it for a move and
// eases the visible Leaper toward each answer.
export class JunkyardBrain {
  // provider: a BrainProvider (default: createGameBrainProvider()). The brain
  // owns it from here on: dispose() closes the session and frees the provider.
  constructor(playtest, { provider = null, softRestart = softRestartRule() } = {}) {
    this.playtest = playtest;
    this.simulation = playtest.simulation;
    this.target = playtest.target;
    // 1. Where the brain runs, and its loading progress for the badge.
    this.provider = provider ?? createGameBrainProvider();
    this.progress = null;
    this.offProgress = this.provider.onProgress?.((progress) => { this.progress = progress; }) ?? null;
    this.providerKind = null;
    // 2. Run state.
    this.running = false;
    this.ready = false;
    // True after no brain could answer (or it refused); START RUN retries.
    this.offline = false;
    this.busy = false;
    this.pendingMovement = false;
    // The brain's own clock. Leftover time is carried from frame to frame, so the
    // Leaper takes LEAPER_STEPS_PER_SECOND moves per second at any frame rate
    // (review fix 5.13). Up to one move of "debt" is kept while a reply is late.
    this.cadence = new FixedStep(1 / LEAPER_STEPS_PER_SECOND, { maxSteps: 2 });
    this.generation = 0;
    this.frame = null;
    // The last pose the brain itself reported (a pose sync shows the new spot early).
    this.brainFrame = null;
    this.label = 'BRAIN CONNECTING';
    // 3. Game logic moving the Leaper between moves, and the soft episode restart.
    this.pendingSync = null;
    this.softRestart = softRestart;
    this.pendingRestart = null;
    this.stillSteps = 0;
    this.catchArmed = true;
    this.episodes = 0;
    this.episodeLog = [];
    this.restarts = { catch: 0, steps: 0, still: 0, failed: 0 };
  }

  // Where Lola must not walk: the rendered Leaper is somewhere between its last
  // two server poses, and while a move is in flight one maximum server step is
  // reserved. Registered with WorldCollision through createLeaperBlocker.
  contactPoses() {
    const state = this.simulation.state;
    const from = this.previousFrame || { x: state.position.x, z: state.position.z, yaw: state.yaw };
    return { from, to: this.frame || from, margin: this.pendingMovement ? contact.pendingStepMargin : 0 };
  }

  // Every brain request goes through here (tests replace it with a stand-in).
  request(path, payload) {
    return this.provider.request(path, payload);
  }

  // Forget a brain session we no longer use. Fire and forget: never throws. The
  // request leaves at once, so it is still sent when dispose() follows straight after.
  closeSession(token) {
    if (!token) return;
    try {
      this.provider.close?.(token)?.catch?.(() => {});
    } catch { /* Best effort: the session is evicted on its own eventually. */ }
  }

  // The /reset body for a new episode with the Leaper at `pose` ({x, z, yaw}).
  resetPayload(pose) {
    return {
      width: this.playtest.world.width, position: [pose.x, pose.z],
      yaw: pose.yaw, target: [this.target.mesh.position.x, this.target.mesh.position.z],
      player_collision: Boolean(this.target.isPlayer),
      ...(this.playtest.sight ? { sight_mode: this.playtest.sight.mode, sight_pose: this.playtest.sight.pose() } : {}),
    };
  }

  // Refuse a brain that is not the approved one, or a service that predates
  // the contact / eye-vision rules this game sends.
  checkIdentity(frame) {
    if (frame.model_step !== 7757824 || !frame.policy_sha256) throw new Error('Unexpected checkpoint identity');
    if (this.target.isPlayer && frame.contact_version !== contact.version) throw new Error('Restart the brain service to enable player collision');
    if (this.playtest.sight && frame.sight_version !== this.playtest.sight.version) throw new Error('Restart the brain service to enable eye-level vision');
  }

  // The badge tooltip: which provider runs the brain, and the policy's identity.
  tooltip(frame) {
    const kind = BRAIN_PROVIDERS[this.providerKind];
    const detail = this.provider.active?.tooltipDetail ?? this.provider.tooltipDetail;
    return [kind ? `${kind.tooltip}${detail ? ` (${detail})` : ''}` : null,
      `Residual LSTM · inference only · policy SHA256 ${frame.policy_sha256}`].filter(Boolean).join('. ');
  }

  // A fresh brain session at the Leaper's current pose. While the brain is
  // offline, `offline` stays set until this succeeds, so the badge doesn't flicker.
  async reset() {
    const generation = ++this.generation;
    const wasOffline = this.offline;
    this.ready = false;
    this.offlineTime = 0;
    this.busy = true;
    this.pendingMovement = false;
    this.failedSteps = 0;
    this.progress = null;
    // 1. The previous session is finished with (RESET, vision change, retry).
    this.closeSession(this.token);
    this.token = null;
    this.pendingRestart = null;
    this.stillSteps = 0;
    this.catchArmed = true;
    this.label = 'LOADING SAVED BRAIN…';
    const state = this.simulation.state;
    this.frame = { x: state.position.x, z: state.position.z, yaw: state.yaw, distance: 0, collision: false, model_step: 7757824 };
    this.previousFrame = { ...this.frame };
    try {
      // 2. Ask whichever provider answers (ONNX, the Python server, or none).
      const frame = await this.request('reset', this.resetPayload(this.frame));
      if (generation !== this.generation) {
        this.closeSession(frame?.token);
        return;
      }
      this.checkIdentity(frame);
      this.token = frame.token;
      this.brainFrame = frame;
      // A pose sync asked for while this loaded is sent next; show its spot meanwhile.
      this.frame = this.pendingSync ? { ...frame, ...this.pendingSync.pose } : frame;
      this.previousFrame = this.frame;
      this.providerKind = this.provider.kind ?? null;
      this.episodes = 1;
      this.playtest.sight?.show(frame);
      this.ready = true;
      this.offline = false;
      this.label = 'BRAIN 7,757,824';
      // 3. Say what fits the moment: a run already going is not told to "Start Run",
      //    and a pause keeps its own "click to resume" instructions.
      if (!this.playtest.paused) {
        this.playtest.message.textContent = !this.playtest.walking
          ? 'Saved brain loaded. Start Run to search and chase; WASD moves Lola; Shift sprints; Space jumps; C crouches; 1 / 2 switch guns; left click fires whichever gun is equipped, even while the Leaper run is stopped.'
          : wasOffline ? 'The brain is back: the trained brain hunts again (a fresh brain session).'
            : 'Saved brain loaded: the Leaper is hunting. WASD moves Lola; Shift sprints; Space jumps; left click fires; Esc pauses.';
      }
      this.playtest.brainLabel.title = this.tooltip(frame);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.flushPending();
      }
    }
  }

  // No brain could answer, or it refused: stop asking, explain, and let the game
  // decide what that means for the fight (onFailed; the junkyard keeps a run
  // going in turret mode). The Leaper keeps its last pose.
  fail(error) {
    this.ready = false;
    this.running = false;
    this.offline = true;
    this.offlineTime = 0;
    this.providerKind = 'turret';
    this.label = BRAIN_OFFLINE_LABEL;
    this.playtest.message.textContent = `Brain offline (${error.message}). Reload the page, or start the Python brain service (see README), then press START RUN. `
      + 'Until then START RUN plays in turret mode: the Leaper stays put but still shoots.';
    this.playtest.brainLabel.title = `${BRAIN_PROVIDERS.turret.tooltip}. ${error.message}`;
    // The sight readout comes from the brain too; say so instead of "connecting".
    if (this.playtest.sight?.label) this.playtest.sight.label.textContent = 'SIGHT OFFLINE · NEEDS THE BRAIN';
    // A pose sync waiting for this session will not be answered.
    this.settleSync(null, error);
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

  // The game session is over: stop, ignore any reply still on its way (it
  // would otherwise redraw sight lines and messages that no longer exist), let
  // the brain forget the session, and free the provider (its worker stops).
  dispose() {
    this.stop();
    this.generation += 1;
    this.settleSync(null, new Error('The brain was shut down'));
    this.closeSession(this.token);
    this.token = null;
    this.offProgress?.();
    this.provider.dispose?.();
  }

  // ---- Game logic moving the Leaper between brain moves (a leap) ----

  // The game moved the Leaper itself (for example a leap): put the brain's own
  // pose there too. The Leaper shows and touches Lola at the new spot at once;
  // the brain is told before its next move. Resolves with the brain's frame at
  // the new pose. If the brain refuses (the spot overlaps a wreck), it rejects
  // and the Leaper goes back to the brain's pose. Without a brain session (turret
  // mode, or before the first reset) it just moves the planted Leaper.
  syncPose({ x, z, yaw }) {
    const pose = { x, z, yaw };
    this.frame = { ...(this.frame || {}), ...pose };
    this.previousFrame = { ...this.frame };
    if (this.offline || (!this.ready && !this.busy)) return Promise.resolve(this.frame);
    return new Promise((resolve, reject) => {
      // A newer sync replaces an older one still waiting; both learn the result.
      const waiters = [...(this.pendingSync?.waiters ?? []), { resolve, reject }];
      this.pendingSync = { pose, waiters };
      this.flushPending();
    });
  }

  // Answer everyone waiting on a pose sync (frame, or error when it failed).
  settleSync(frame, error = null) {
    const pending = this.pendingSync;
    this.pendingSync = null;
    for (const waiter of pending?.waiters ?? []) {
      if (error) waiter.reject(error);
      else waiter.resolve(frame);
    }
  }

  // One request at a time: a waiting pose sync goes first, then a soft restart.
  flushPending() {
    if (this.busy || !this.ready) return;
    if (this.pendingSync) this.sendSync();
    else if (this.pendingRestart) this.restartEpisode(this.pendingRestart);
  }

  async sendSync() {
    const { pose, waiters } = this.pendingSync;
    this.pendingSync = null;
    this.busy = true;
    const generation = this.generation;
    let frame = null;
    let failure = null;
    try {
      frame = await this.request('sync', {
        token: this.token, position: [pose.x, pose.z], yaw: pose.yaw,
        target: [this.target.mesh.position.x, this.target.mesh.position.z],
        ...(this.playtest.sight ? { sight_pose: this.playtest.sight.pose() } : {}),
      });
    } catch (error) {
      failure = error;
    }
    if (generation !== this.generation) {
      failure ??= new Error('The brain session restarted before the pose sync');
    } else {
      if (failure) {
        // Refused (e.g. inside a wreck): the brain stays where it was, and so does its Leaper.
        if (!this.pendingSync && this.brainFrame) {
          this.frame = this.brainFrame;
          this.previousFrame = this.brainFrame;
        }
      } else {
        // A newer sync asked for meanwhile keeps showing its own spot.
        this.brainFrame = frame;
        if (!this.pendingSync) {
          this.frame = frame;
          this.previousFrame = frame;
        }
        // A leap is movement: the still-step count starts over.
        this.stillSteps = 0;
        this.playtest.sight?.show(frame);
      }
      this.busy = false;
    }
    // Callers learn the result once the brain is free for its next request.
    for (const waiter of waiters) {
      if (failure) waiter.reject(failure);
      else waiter.resolve(frame);
    }
    if (generation === this.generation) this.flushPending();
  }

  // ---- Soft episode restart (review fix 5.12, ENCOUNTER.brainSoftRestart) ----

  // After a move: does this frame end a training-style episode?
  softRestartReason(frame) {
    const rule = this.softRestart;
    if (!rule?.enabled) return null;
    // A catch counts once; Lola must get away again before the next one does.
    if (!frame.caught) this.catchArmed = true;
    if (rule.afterCatch && frame.caught && this.catchArmed) return 'catch';
    if (rule.afterStillSteps && this.stillSteps >= rule.afterStillSteps) return 'still';
    if (rule.afterSteps && frame.step >= rule.afterSteps) return 'steps';
    return null;
  }

  // Start a fresh brain episode exactly where the Leaper stands: a new session
  // at the brain's own pose (so nothing visibly moves), then the old one is closed.
  async restartEpisode(reason) {
    this.pendingRestart = null;
    const generation = this.generation;
    const oldToken = this.token;
    const pose = this.brainFrame ?? this.frame;
    this.busy = true;
    try {
      const frame = await this.request('reset', this.resetPayload(pose));
      if (generation !== this.generation) {
        this.closeSession(frame?.token);
        return;
      }
      this.checkIdentity(frame);
      this.token = frame.token;
      this.brainFrame = frame;
      if (!this.pendingSync) {
        this.previousFrame = this.frame;
        this.frame = frame;
      }
      this.stillSteps = 0;
      if (reason === 'catch') this.catchArmed = false;
      this.episodes += 1;
      this.restarts[reason] += 1;
      this.episodeLog.push({ episode: this.episodes, reason, afterStep: pose.step ?? null });
      if (this.episodeLog.length > EPISODE_LOG_LENGTH) this.episodeLog.shift();
      this.closeSession(oldToken);
      this.playtest.sight?.show(frame);
    } catch {
      // Only an experiment: keep hunting with the episode we have.
      if (generation === this.generation) this.restarts.failed += 1;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.flushPending();
      }
    }
  }

  // ---- The frame update ----

  // Ask the brain for moves at a steady rate and ease the visible Leaper toward
  // each reply. Lola's own movement is PlayerController's job, not the brain's.
  update(dt) {
    const sim = this.simulation;
    const encounterOver = this.playtest.combat?.dead;
    // 0. Turret mode: during the run, try the brain again every few seconds.
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
    // 2. One request at a time: a pose sync or soft restart goes first; a due
    //    move waits (keeping its time) until the previous reply has arrived.
    if (!encounterOver) this.flushPending();
    if (stepping && !this.busy && this.cadence.take()) {
      this.busy = true;
      this.pendingMovement = !preview;
      const generation = this.generation;
      this.request(preview ? 'sense' : 'step', { token: this.token,
        target: [this.target.mesh.position.x, this.target.mesh.position.z],
        ...(this.playtest.sight ? { sight_pose: this.playtest.sight.pose() } : {}),
      }).then((frame) => {
        if (generation !== this.generation) return;
        // A move that arrives after the fight ended is never shown (the Leaper
        // stays where it fell), so it must not move Lola's contact with it either.
        if (this.playtest.combat?.dead) return;
        // Moving counts against the soft restart's "still" rule (as in training).
        if (!preview) {
          const last = this.brainFrame ?? this.frame;
          const moved = !last || Math.hypot(frame.x - last.x, frame.z - last.z) > STILL_DISTANCE;
          this.stillSteps = moved ? 0 : this.stillSteps + 1;
        }
        this.brainFrame = frame;
        // A pose sync asked for while this move was computing wins (this reply is
        // from the old spot); the sync is sent next.
        if (!this.pendingSync) {
          this.previousFrame = this.frame;
          this.frame = frame;
        }
        this.renderAge = 0;
        this.failedSteps = 0;
        this.playtest.sight?.show(frame);
        if (!preview) this.pendingRestart = this.softRestartReason(frame) ?? this.pendingRestart;
      }).catch((error) => {
        if (generation !== this.generation) return;
        // A busy computer can delay one move; keep the run going and try again.
        this.failedSteps = (this.failedSteps ?? 0) + 1;
        if (this.failedSteps >= MAX_FAILED_STEPS || /Session expired/.test(error.message)) this.fail(error);
      }).finally(() => {
        if (generation === this.generation) {
          this.busy = false;
          this.pendingMovement = false;
          this.flushPending();
        }
      });
    }
    if (encounterOver) {
      // 3a. The fight is over: no more moves, but the Leaper's feet finish landing.
      //     A Leaper that won (still has health) keeps idling; a destroyed one goes still.
      sim.settle?.(dt, { alive: (this.playtest.combat?.leaperHealth ?? 0) > 0 });
    } else if (this.frame) {
      // 3b. Follow each network pose from the current rendered pose. Restarting at
      //     the previous server frame caused snaps whenever replies arrived early or late.
      const now = this.frame;
      const { position, yaw } = sim.state;
      sim.updateExternal({ ...now, ...followPose({ x: position.x, z: position.z, yaw }, now, dt) },
        dt, { checkpoint: { step: now.model_step } });
    }
  }

  // ---- Readouts ----

  // What the brain is doing, for the panel badge and the top-right status line
  // (written by the junkyard's presentation phase). The badge names where the
  // brain runs: ONNX · IN BROWSER, PYTHON SERVER, or OFFLINE · TURRET.
  describe() {
    const over = Boolean(this.playtest.combat?.dead);
    // Offline: a run carries on in turret mode; otherwise say how to fix it
    // (after the fight START RUN is disabled, so don't tell the player to press it).
    if (this.offline) {
      const turret = Boolean(this.playtest.walking);
      if (over) return { label: 'BRAIN OFFLINE · ENCOUNTER OVER', status: 'NO BRAIN // ENCOUNTER OVER' };
      return {
        label: turret ? BRAIN_TURRET_LABEL : BRAIN_OFFLINE_LABEL,
        status: turret ? 'NO BRAIN // TURRET MODE: THE LEAPER STAYS PUT BUT STILL SHOOTS'
          : 'NO BRAIN // RELOAD OR START THE BRAIN SERVICE, THEN PRESS START RUN',
      };
    }
    // Still loading: the provider's progress (downloads, raster build) if it reports any.
    const loading = !this.ready && this.progress ? describeProgress(this.progress) : this.label;
    // While the brain isn't asked for moves, say why: the fight is over, the game
    // is paused (Escape), or the run is simply stopped (Ready or START PLAYER).
    const idle = this.playtest.paused ? 'PAUSED' : 'STOPPED';
    const mode = !this.ready ? loading : over ? 'ENCOUNTER OVER' : !this.running ? idle
      : this.failedSteps ? 'BRAIN SLOW · RETRYING'
      : this.frame.target_visible ? 'TARGET VISIBLE'
        : this.frame.target_ever_seen ? 'TARGET HIDDEN · MEMORY' : 'SEARCHING';
    const where = BRAIN_PROVIDERS[this.providerKind]?.badge;
    // With soft restarts on, the status line also counts the brain's episodes.
    const episode = this.softRestart?.enabled && this.episodes > 1 ? ` // EPISODE ${this.episodes}` : '';
    return {
      label: this.ready ? ['BRAIN 7,757,824', where, mode].filter(Boolean).join(' · ') : loading,
      status: `LIVE TRAINED BRAIN // ${mode}${this.frame?.collision ? ' // CONTACT' : ''}${episode} // STEP ${this.frame?.step || 0}`,
    };
  }
}
