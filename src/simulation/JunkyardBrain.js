import { contact, contactRadius, touchesLeaper } from '../world/playerContact.js';

// Only the checkpoint server chooses movement. No navigation-route fallback.
export class JunkyardBrain {
  constructor(playtest) {
    this.playtest = playtest;
    this.simulation = playtest.simulation;
    this.target = playtest.target;
    this.running = false;
    this.ready = false;
    this.busy = false;
    this.clock = 0;
    this.generation = 0;
    this.frame = null;
    this.label = 'BRAIN CONNECTING';
    if (this.target.isPlayer) {
      const mapBlocked = playtest.world.playerBlocked;
      playtest.world.playerBlocked = (x, z) => {
        if (mapBlocked(x, z)) return true;
        const from = this.previousFrame || this.simulation.state.position;
        const to = this.frame || from;
        const radius = contactRadius(playtest.world.scale);
        if (touchesLeaper(x, z, from, to, radius)) return true;
        // While an inference is in flight, reserve one maximum server step.
        // Allow retreat if that extra reservation has just expanded around Lola.
        if (!this.running && !this.busy) return false;
        if (!touchesLeaper(x, z, from, to, radius + contact.pendingStepMargin)) return false;
        const p = this.target.mesh.position;
        return Math.hypot(x - to.x, z - to.z) <= Math.hypot(p.x - to.x, p.z - to.z);
      };
    }
  }

  async request(path, payload) {
    const response = await fetch(`http://127.0.0.1:8767/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(path === 'reset' ? 90000 : 10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Brain service failed');
    return result;
  }

  async reset() {
    const generation = ++this.generation;
    this.ready = false;
    this.busy = true;
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
      });
      if (generation !== this.generation) return;
      if (frame.model_step !== 7757824 || !frame.policy_sha256) throw new Error('Unexpected checkpoint identity');
      if (this.target.isPlayer && frame.contact_version !== contact.version) throw new Error('Restart the brain service to enable player collision');
      this.token = frame.token;
      this.frame = frame;
      this.previousFrame = frame;
      this.ready = true;
      this.label = 'BRAIN 7,757,824';
      this.playtest.message.textContent = 'Saved brain loaded. Start Run to search and chase; WASD moves Lola; Shift sprints; Space jumps; C crouches; F switches guns.';
      this.playtest.brainLabel.title = `Residual LSTM · inference only · policy SHA256 ${frame.policy_sha256}`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  fail(error) {
    this.ready = false;
    this.running = false;
    this.playtest.walking = false;
    this.label = 'BRAIN OFFLINE — RESET TO RETRY';
    this.playtest.panel.querySelector('[data-action=route]').textContent = 'START RUN';
    this.playtest.message.textContent = `Brain unavailable: ${error.message}. Start the local brain service, then press Reset. No pathfinder fallback.`;
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

  update(dt) {
    const sim = this.simulation;
    if (this.target.isPlayer && this.target.grounded && sim.input.consumeJump()) this.target.jump();
    sim.input.update(dt);
    const a = sim.input.getMovement();
    const b = sim.input.getTargetMovement();
    const heading = sim.cameraController.getMovementHeading(sim.state.yaw);
    const forward = sim.v[0].set(Math.sin(heading), 0, Math.cos(heading));
    const right = sim.v[1].set(-forward.z, 0, forward.x);
    this.target.move(a.forward + b.forward, a.side + b.side, forward, right,
      sim.input.sprinting ? 8 : 4.5, dt);
    this.clock += dt;
    if (this.ready && this.running && !this.busy && this.clock >= 1 / 30 && !document.hidden) {
      this.clock = 0;
      this.busy = true;
      const generation = this.generation;
      this.request('step', { token: this.token,
        target: [this.target.mesh.position.x, this.target.mesh.position.z] }).then((frame) => {
        if (generation !== this.generation) return;
        this.previousFrame = this.frame;
        this.frame = frame;
        this.renderAge = 0;
      }).catch((error) => {
        if (generation === this.generation) this.fail(error);
      }).finally(() => {
        if (generation === this.generation) this.busy = false;
      });
    }
    if (this.frame) {
      this.renderAge = (this.renderAge || 0) + dt;
      const t = Math.min(1, this.renderAge * 30);
      const prev = this.previousFrame;
      const now = this.frame;
      const turn = ((now.yaw - prev.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      sim.updateExternal({ ...now,
        x: prev.x + (now.x - prev.x) * t, z: prev.z + (now.z - prev.z) * t,
        yaw: prev.yaw + turn * t,
      }, dt, { checkpoint: { step: now.model_step } });
    }
    const mode = !this.ready ? this.label : !this.running ? 'PAUSED'
      : this.frame.target_visible ? 'TARGET VISIBLE'
        : this.frame.target_ever_seen ? 'TARGET HIDDEN · MEMORY' : 'SEARCHING';
    this.playtest.brainLabel.textContent = this.ready ? `BRAIN 7,757,824 · ${mode}` : this.label;
    sim.statusElement.textContent = `LIVE TRAINED BRAIN // ${mode}${this.frame?.collision ? ' // CONTACT' : ''} // STEP ${this.frame?.step || 0}`;
  }
}
