// BrainDriver — runs the trained champion live in the browser.
//
// Every tick: build the 26 numbers (leaperWorld) -> ask the brain (LeaperBrain)
// -> apply the same step math training used -> drive the visual rig. This is
// the moment the Leaper stops replaying a recording and starts thinking.

import * as THREE from 'three';
import { LeaperBrain } from './LeaperBrain.js';
import * as world from './leaperWorld.js';
import {
  PLAYER_SPEED,
  initialPlayerPosition,
  movePlayerTarget,
} from './playerTarget.js';

const STEP_DT = 1 / 30; // training ran its physics at 30 steps/second
const RESULT_HOLD = 1.2; // seconds to pause on a win/stuck before the next arena
const PLAYER_HEAD_START = 3.0;

function lerpAngle(from, to, amount) {
  const diff = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + diff * amount;
}

export class BrainDriver {
  constructor({ simulation, target, world: gameWorld, scene, statusElement }) {
    this.simulation = simulation;
    this.target = target;
    this.gameWorld = gameWorld;
    this.scene = scene;
    this.statusElement = statusElement;
    this.ready = false;
    this.accum = 0;
    this.stepping = false;
    this.holdTimer = 0;
    this.headStartRemaining = PLAYER_HEAD_START;
    this.arenaIndex = 0;
    this.reachedCount = 0;
  }

  async init() {
    this.fixtures = await fetch('/brain_fixtures.json').then((r) => r.json());
    this.brain = await new LeaperBrain().load();
    await this.runSelfTest();
    this.buildVisionDisplay();
    this.loadArena(0);
    this.ready = true;
  }

  // Prove the JavaScript observation recipe reproduces Python's numbers exactly.
  // The brain engine runs one inference at a time, so we ask sequentially.
  async runSelfTest() {
    let worstObs = 0;
    let worstAct = 0;
    for (const testCase of this.fixtures.selftest) {
      const obs = world.buildObservation({
        x: testCase.position[0],
        z: testCase.position[1],
        yaw: testCase.yaw,
        prevThrottle: testCase.previous_action[0],
        prevTurn: testCase.previous_action[1],
        lastCollision: testCase.last_collision,
        obstacles: testCase.obstacles,
      });
      for (let i = 0; i < obs.length; i += 1) {
        worstObs = Math.max(worstObs, Math.abs(obs[i] - testCase.expected_observation[i]));
      }
      // eslint-disable-next-line no-await-in-loop
      const [throttle, turn] = await this.brain.think(Array.from(obs));
      worstAct = Math.max(
        worstAct,
        Math.abs(throttle - testCase.expected_action[0]),
        Math.abs(turn - testCase.expected_action[1]),
      );
    }
    const ok = worstObs < 1e-4 && worstAct < 1e-4;
    const style = ok ? 'color:#2e7d32;font-weight:bold' : 'color:#c62828;font-weight:bold';
    console.log(
      `%c${ok ? '✅ Faithfulness self-test PASSED' : '❌ Faithfulness self-test FAILED'} — ` +
        `worst observation diff ${worstObs.toExponential(2)}, worst action diff ${worstAct.toExponential(2)}`,
      style,
    );
  }

  loadArena(index) {
    const arenas = this.fixtures.arenas;
    this.arenaIndex = ((index % arenas.length) + arenas.length) % arenas.length;
    const arena = arenas[this.arenaIndex];
    this.obstacles = arena.obstacles;
    this.gameWorld.setObstacles(this.obstacles);

    const targetPosition = initialPlayerPosition();
    this.target.setPosition(targetPosition[0], targetPosition[1]);

    this.state = {
      x: arena.start.x,
      z: arena.start.z,
      yaw: arena.start.yaw,
      prevThrottle: 0,
      prevTurn: 0,
      lastCollision: 0,
      target: targetPosition,
      prevDistance: Math.hypot(targetPosition[0] - arena.start.x, targetPosition[1] - arena.start.z),
      stuckSteps: 0,
      obstacles: this.obstacles,
    };
    this.lastVision = new Float32Array(world.RAY_COUNT).fill(1);
    this.prevFrame = this.frameFromState('MOVING');
    this.curFrame = this.prevFrame;
    this.accum = 0;
    this.holdTimer = 0;
    this.outcome = null;
    this.stepsThisRun = 0;
  }

  frameFromState(label) {
    return {
      x: this.state.x,
      z: this.state.z,
      yaw: this.state.yaw,
      distance: this.state.prevDistance,
      collision: this.state.lastCollision > 0.5,
      label,
    };
  }

  async doStep() {
    const obs = world.buildObservation(this.state);
    this.lastVision = obs.slice(10); // the 16 ray readings, for the display
    const [throttle, turn] = await this.brain.think(Array.from(obs));
    const result = world.stepWorld(this.state, throttle, turn);

    this.state.x = result.x;
    this.state.z = result.z;
    this.state.yaw = result.yaw;
    this.state.prevThrottle = result.throttle;
    this.state.prevTurn = result.turn;
    this.state.lastCollision = result.collided ? 1 : 0;
    this.state.prevDistance = result.distance;
    this.state.stuckSteps = result.stuckSteps;
    this.stepsThisRun += 1;

    const label = result.collided ? 'CONTACT' : 'THINKING';
    this.prevFrame = this.curFrame;
    this.curFrame = this.frameFromState(label);

    if (result.reached) {
      this.reachedCount += 1;
      this.outcome = 'REACHED';
    } else if (result.stuck) {
      this.outcome = 'STUCK';
    }
  }

  update(deltaTime) {
    if (!this.ready) return;

    // Between arenas: hold briefly on the result, then advance.
    if (this.outcome) {
      this.holdTimer += deltaTime;
      this.renderInterpolated(1, deltaTime);
      this.writeStatus();
      if (this.holdTimer >= RESULT_HOLD) this.loadArena(this.arenaIndex + 1);
      return;
    }

    this.updatePlayer(deltaTime);

    if (this.headStartRemaining > 0) {
      this.headStartRemaining = Math.max(0, this.headStartRemaining - deltaTime);
      this.renderInterpolated(1, deltaTime);
      this.writeStatus();
      return;
    }

    this.accum += deltaTime;
    if (!this.stepping && this.accum >= STEP_DT) {
      this.stepping = true;
      this.doStep().finally(() => {
        this.stepping = false;
        this.accum = 0;
      });
    }

    const phase = Math.min(this.accum / STEP_DT, 1);
    this.renderInterpolated(phase, deltaTime);
    this.writeStatus();
  }

  renderInterpolated(phase, deltaTime) {
    const frame = {
      x: THREE.MathUtils.lerp(this.prevFrame.x, this.curFrame.x, phase),
      z: THREE.MathUtils.lerp(this.prevFrame.z, this.curFrame.z, phase),
      yaw: lerpAngle(this.prevFrame.yaw, this.curFrame.yaw, phase),
      distance: THREE.MathUtils.lerp(this.prevFrame.distance, this.curFrame.distance, phase),
      collision: this.curFrame.collision,
    };
    this.simulation.applyExternalFrame(frame, deltaTime, {
      x: this.state.target[0],
      z: this.state.target[1],
    });
    this.updateVisionDisplay(frame);
  }

  updatePlayer(deltaTime) {
    this.simulation.input.update(deltaTime);
    const movement = this.simulation.input.getMovement();
    const heading = this.simulation.cameraController.getMovementHeading(this.state.yaw);
    const next = movePlayerTarget(
      this.state.target,
      movement,
      heading,
      deltaTime,
      this.obstacles,
    );
    this.state.target = [next.x, next.z];
    this.target.setPosition(next.x, next.z);
    if (next.yaw !== null) this.target.setFacing(next.yaw);
  }

  writeStatus() {
    const d = Math.hypot(
      this.state.target[0] - this.state.x,
      this.state.target[1] - this.state.z,
    ).toFixed(1);
    const tag = this.headStartRemaining > 0
      ? `HEAD START ${this.headStartRemaining.toFixed(1)} S`
      : this.outcome
      ? this.outcome === 'REACHED'
        ? 'TARGET REACHED'
        : 'STUCK — RESET'
      : this.curFrame.label;
    this.statusElement.textContent =
      `LIVE BRAIN // ARENA ${this.arenaIndex + 1}/${this.fixtures.arenas.length} // ` +
      `PLAYER ${PLAYER_SPEED.toFixed(1)} M/S // DIST ${d} M // ` +
      `${tag} // CAUGHT ${this.reachedCount}`;
  }

  // --- Vision display: draw the 16 rays the brain is actually reading. -------
  buildVisionDisplay() {
    this.visionGroup = new THREE.Group();
    this.visionGroup.position.y = 0.18;
    this.scene.add(this.visionGroup);
    const angles = world.rayRelativeAngles();
    this.rayLines = angles.map((angle) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x55dd88 }));
      line.userData.angle = angle;
      this.visionGroup.add(line);
      return line;
    });
  }

  updateVisionDisplay(frame) {
    if (!this.visionGroup) return;
    this.visionGroup.position.x = frame.x;
    this.visionGroup.position.z = frame.z;
    this.visionGroup.rotation.y = frame.yaw;
    for (let i = 0; i < this.rayLines.length; i += 1) {
      const line = this.rayLines[i];
      const reading = this.lastVision[i] ?? 1;
      const dist = reading * world.RAY_MAX_RANGE;
      const positions = line.geometry.attributes.position;
      positions.setXYZ(1, Math.sin(line.userData.angle) * dist, 0, Math.cos(line.userData.angle) * dist);
      positions.needsUpdate = true;
      line.material.color.setHSL(THREE.MathUtils.lerp(0, 0.34, reading), 0.8, 0.5);
    }
  }
}
