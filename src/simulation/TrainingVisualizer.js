import * as THREE from 'three';

function interpolateAngle(from, to, amount) {
  const difference = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + difference * amount;
}

const VISION_FOV = THREE.MathUtils.degToRad(270);
const VISION_SECTORS = 16;
const VISION_RANGE = 28;

export class TrainingVisualizer {
  constructor({ simulation, target, world, panel }) {
    this.simulation = simulation;
    this.target = target;
    this.world = world;
    this.panel = panel;
    this.data = null;
    this.replayMode = 'evaluation';
    this.dataIndex = -1;
    this.workerIndex = 0;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.lastFetch = 0;
    this.followLatest = true;
    this.loading = false;
    this.playing = true;
    this.liveMode = true;
    this.syncedEpisode = null;
    this.createVisionDisplay();
    this.createCoverageDisplay();
    this.timeline = panel.querySelector('[data-field="timeline"]');
    this.playButton = panel.querySelector('[data-action="play"]');
    this.logInput = panel.querySelector('[data-field="log-input"]');
    this.liveButton = panel.querySelector('[data-action="live-log"]');
    this.trainingModeButton = panel.querySelector('[data-action="training-mode"]');
    this.evaluationModeButton = panel.querySelector('[data-action="evaluation-mode"]');

    panel.querySelector('[data-action="previous"]').addEventListener('click', () => {
      this.followLatest = false;
      this.selectCollection(this.dataIndex - 1);
    });
    panel.querySelector('[data-action="next"]').addEventListener('click', () => {
      const isAtLatest = this.dataIndex >= this.collections().length - 2;
      this.followLatest = isAtLatest;
      this.selectCollection(this.dataIndex + 1);
    });
    this.playButton.addEventListener('click', () => this.setPlaying(!this.playing));
    panel.querySelector('[data-action="previous-replay"]').addEventListener('click', () => {
      this.selectEpisode(this.episodeIndex - 1);
    });
    panel.querySelector('[data-action="next-replay"]').addEventListener('click', () => {
      this.selectEpisode(this.episodeIndex + 1);
    });
    panel.querySelector('[data-action="previous-worker"]').addEventListener('click', () => {
      this.selectWorker(this.workerIndex - 1);
    });
    panel.querySelector('[data-action="next-worker"]').addEventListener('click', () => {
      this.selectWorker(this.workerIndex + 1);
    });
    this.trainingModeButton.addEventListener('click', () => this.selectMode('training'));
    this.evaluationModeButton.addEventListener('click', () => this.selectMode('evaluation'));
    this.timeline.addEventListener('input', () => {
      this.setPlaying(false);
      this.playbackTime = Number(this.timeline.value) / 30;
      this.updateTimelineLabel();
    });
    panel.querySelector('[data-action="import-log"]').addEventListener('click', () => {
      this.logInput.click();
    });
    this.logInput.addEventListener('change', () => this.importLog());
    this.liveButton.addEventListener('click', () => this.useLiveFeed());
    this.selectMode('evaluation');
  }

  createVisionDisplay() {
    const scene = this.simulation.rig.robot.parent;
    this.visionGroup = new THREE.Group();
    this.visionGroup.position.y = 0.16;
    scene.add(this.visionGroup);

    const guidePositions = [];
    for (let edge = 0; edge <= VISION_SECTORS; edge += 1) {
      const angle = -VISION_FOV / 2 + edge * VISION_FOV / VISION_SECTORS;
      guidePositions.push(
        0, 0, 0,
        Math.sin(angle) * VISION_RANGE, 0, Math.cos(angle) * VISION_RANGE,
      );
    }
    const guideGeometry = new THREE.BufferGeometry();
    guideGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(guidePositions, 3),
    );
    this.visionGroup.add(new THREE.LineSegments(
      guideGeometry,
      new THREE.LineBasicMaterial({
        color: 0x4e8fa8,
        transparent: true,
        opacity: 0.28,
      }),
    ));

    this.clearanceLines = Array.from({ length: VISION_SECTORS }, (_, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x55dd88 }),
      );
      line.userData.relativeAngle = -VISION_FOV / 2
        + (index + 0.5) * VISION_FOV / VISION_SECTORS;
      this.visionGroup.add(line);
      return line;
    });
  }

  createCoverageDisplay() {
    // PPO_32 cleared-map overlay. A flat grid of tiles laid just above the ground
    // and below the obstacles/target, so you can see which ground the agent has
    // already checked (cool green) versus what is still unchecked (warm amber) --
    // including the rock-shadow cells that never get cleared. Built lazily once the
    // grid dimensions arrive with an episode; unobtrusive (low opacity).
    const scene = this.simulation.rig.robot.parent;
    this.coverageGroup = new THREE.Group();
    this.coverageGroup.position.y = 0.045;
    this.coverageGroup.visible = false;
    scene.add(this.coverageGroup);
    this.coverageMesh = null;
    this.coverageSteps = 0;
    this.coverageColorCleared = new THREE.Color(0x2f7d4f);
    this.coverageColorUnchecked = new THREE.Color(0xb5651d);
    this.coverageDummy = new THREE.Object3D();
    // Cumulative cleared state and the frame it was built up to, for cheap scrubbing.
    this.coverageCleared = null;
    this.coverageBuiltEpisode = null;
    this.coverageBuiltFrame = -1;
  }

  ensureCoverageMesh(steps, cell, limit) {
    if (this.coverageMesh && this.coverageSteps === steps) return;
    if (this.coverageMesh) {
      this.coverageGroup.remove(this.coverageMesh);
      this.coverageMesh.geometry.dispose();
      this.coverageMesh.material.dispose();
    }
    const count = steps * steps;
    const geometry = new THREE.PlaneGeometry(cell * 0.94, cell * 0.94);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      vertexColors: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3),
      3,
    );
    // Flat index matches the trainer: ix * steps + iz.
    for (let ix = 0; ix < steps; ix += 1) {
      for (let iz = 0; iz < steps; iz += 1) {
        this.coverageDummy.position.set(
          -limit + (ix + 0.5) * cell,
          0,
          -limit + (iz + 0.5) * cell,
        );
        this.coverageDummy.updateMatrix();
        mesh.setMatrixAt(ix * steps + iz, this.coverageDummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.coverageGroup.add(mesh);
    this.coverageMesh = mesh;
    this.coverageSteps = steps;
  }

  updateCoverageDisplay(episode, frameIndex) {
    const steps = episode?.coverage_steps;
    const frames = episode?.frames ?? [];
    if (!steps || !frames.length || !frames[0]?.coverage_new) {
      if (this.coverageGroup) this.coverageGroup.visible = false;
      return;
    }
    const cell = episode.coverage_cell ?? 3.0;
    const limit = episode.world_limit ?? steps * cell * 0.5;
    this.ensureCoverageMesh(steps, cell, limit);
    this.coverageGroup.visible = true;

    const count = steps * steps;
    // Rebuild the cumulative cleared set when the episode changed or the timeline
    // scrubbed backward; otherwise extend it forward frame by frame.
    if (this.coverageBuiltEpisode !== episode || frameIndex < this.coverageBuiltFrame) {
      this.coverageCleared = new Uint8Array(count);
      this.coverageBuiltEpisode = episode;
      this.coverageBuiltFrame = -1;
    }
    for (let f = this.coverageBuiltFrame + 1; f <= frameIndex && f < frames.length; f += 1) {
      const newCells = frames[f].coverage_new ?? [];
      for (let i = 0; i < newCells.length; i += 1) this.coverageCleared[newCells[i]] = 1;
    }
    this.coverageBuiltFrame = frameIndex;

    const colors = this.coverageMesh.instanceColor;
    for (let i = 0; i < count; i += 1) {
      const color = this.coverageCleared[i] ? this.coverageColorCleared : this.coverageColorUnchecked;
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }

  updateVisionDisplay(frame) {
    const readings = frame.vision ?? [];
    this.visionGroup.visible = readings.length === VISION_SECTORS;
    if (!this.visionGroup.visible) return;
    this.visionGroup.position.x = frame.x;
    this.visionGroup.position.z = frame.z;
    this.visionGroup.rotation.y = frame.yaw;
    readings.forEach((reading, index) => {
      const line = this.clearanceLines[index];
      const distance = THREE.MathUtils.clamp(reading, 0, 1) * VISION_RANGE;
      const positions = line.geometry.attributes.position;
      positions.setXYZ(
        1,
        Math.sin(line.userData.relativeAngle) * distance,
        0,
        Math.cos(line.userData.relativeAngle) * distance,
      );
      positions.needsUpdate = true;
      line.material.color.setHSL(
        THREE.MathUtils.lerp(0, 0.34, reading),
        0.78,
        0.5,
      );
    });
  }

  syncEpisodeWorld(episode) {
    if (!episode || episode === this.syncedEpisode) return;
    this.syncedEpisode = episode;
    this.world.setObstacles?.(episode.obstacles ?? []);
    this.world.setArenaLimit?.(episode.world_limit);
    if (episode.target?.length >= 2) {
      this.target.setPosition(episode.target[0], episode.target[1]);
    }
  }

  collections() {
    return this.replayMode === 'training'
      ? (this.data?.training_rollouts ?? [])
      : (this.data?.checkpoints ?? []);
  }

  currentContext() {
    const record = this.collections()[this.dataIndex];
    if (!record) return null;
    if (this.replayMode === 'training') {
      const workers = record.workers ?? [];
      const worker = workers[this.workerIndex];
      return {
        record,
        worker,
        episodes: worker?.episodes ?? [],
        checkpoint: { step: record.end_step },
      };
    }
    return {
      record,
      worker: null,
      episodes: record.episodes ?? [],
      checkpoint: record,
    };
  }

  currentEpisode() {
    return this.currentContext()?.episodes[this.episodeIndex];
  }

  selectMode(mode) {
    this.replayMode = mode;
    this.panel.classList.toggle('training-rollout-mode', mode === 'training');
    this.trainingModeButton.classList.toggle('on', mode === 'training');
    this.evaluationModeButton.classList.toggle('on', mode === 'evaluation');
    this.workerIndex = 0;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.followLatest = true;
    this.selectCollection(this.collections().length - 1);
  }

  async importLog() {
    const [file] = this.logInput.files;
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const hasCheckpoints = imported.checkpoints?.some((checkpoint) => (
        checkpoint.episodes?.some((episode) => Array.isArray(episode.frames))
      ));
      const hasTrainingRollouts = imported.training_rollouts?.some((rollout) => (
        rollout.workers?.some((worker) => (
          worker.episodes?.some((episode) => Array.isArray(episode.frames))
        ))
      ));
      if (!hasCheckpoints && !hasTrainingRollouts) {
        throw new Error('This file has no replay frames');
      }
      this.data = imported;
      this.liveMode = false;
      this.followLatest = false;
      this.liveButton.disabled = false;
      this.panel.querySelector('[data-field="source"]').textContent = `SOURCE: ${file.name}`;
      this.selectMode(hasCheckpoints ? 'evaluation' : 'training');
    } catch (error) {
      this.panel.querySelector('[data-field="source"]').textContent = `IMPORT FAILED: ${error.message}`;
    } finally {
      this.logInput.value = '';
    }
  }

  useLiveFeed() {
    this.liveMode = true;
    this.followLatest = true;
    this.liveButton.disabled = true;
    this.panel.querySelector('[data-field="source"]').textContent = 'SOURCE: LIVE FEED';
    this.lastFetch = Infinity;
    this.selectMode('evaluation');
    this.refresh();
  }

  setPlaying(playing) {
    this.playing = playing;
    this.playButton.textContent = playing ? 'PAUSE' : 'PLAY';
    this.playButton.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
  }

  selectEpisode(index) {
    const episodes = this.currentContext()?.episodes ?? [];
    if (!episodes.length) return;
    this.episodeIndex = (index + episodes.length) % episodes.length;
    this.playbackTime = 0;
    this.setPlaying(true);
    this.updatePanel();
  }

  selectWorker(index) {
    if (this.replayMode !== 'training') return;
    const workers = this.collections()[this.dataIndex]?.workers ?? [];
    if (!workers.length) return;
    this.workerIndex = (index + workers.length) % workers.length;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.setPlaying(true);
    this.updatePanel();
  }

  async refresh() {
    if (this.loading || !this.liveMode) return;
    this.loading = true;
    try {
      const previousLatest = this.collections().at(-1);
      const previousStep = previousLatest?.end_step ?? previousLatest?.step;
      const response = await fetch(`/rl_live_state.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.data = await response.json();
      const latest = this.collections().at(-1);
      const latestStep = latest?.end_step ?? latest?.step;
      if (this.followLatest && (this.dataIndex < 0 || latestStep !== previousStep)) {
        this.selectCollection(this.collections().length - 1);
      }
      this.updatePanel();
    } catch (error) {
      this.panel.querySelector('[data-field="state"]').textContent = 'WAITING FOR TRAINER';
    } finally {
      this.loading = false;
    }
  }

  selectCollection(index) {
    const count = this.collections().length;
    if (!count) {
      this.dataIndex = -1;
      this.updatePanel();
      return;
    }
    this.dataIndex = THREE.MathUtils.clamp(index, 0, count - 1);
    this.workerIndex = 0;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.setPlaying(true);
    this.updatePanel();
  }

  update(deltaTime) {
    this.lastFetch += deltaTime;
    if (this.liveMode && this.lastFetch >= 1.5) {
      this.lastFetch = 0;
      this.refresh();
    }

    const context = this.currentContext();
    const episode = this.currentEpisode();
    if (!episode?.frames.length) return;
    this.syncEpisodeWorld(episode);

    if (this.playing) this.playbackTime += deltaTime;
    const framePosition = this.playbackTime * 30;
    const frameIndex = Math.min(Math.floor(framePosition), episode.frames.length - 1);
    if (frameIndex >= episode.frames.length - 1 && this.playing) {
      this.episodeIndex = (this.episodeIndex + 1) % context.episodes.length;
      this.playbackTime = 0;
      this.updatePanel();
      return;
    }

    const amount = framePosition - frameIndex;
    const from = episode.frames[frameIndex];
    const to = episode.frames[Math.min(frameIndex + 1, episode.frames.length - 1)];
    const targetState = from.target_visible
      ? 'TARGET: VISIBLE'
      : from.target_ever_seen
        ? 'TARGET: REMEMBERED · CURRENTLY HIDDEN'
        : 'TARGET: NOT DISCOVERED';
    this.panel.querySelector('[data-field="target-state"]').textContent = targetState;
    this.updateVisionDisplay(from);
    this.updateCoverageDisplay(episode, frameIndex);
    this.simulation.updateExternal(
      {
        x: THREE.MathUtils.lerp(from.x, to.x, amount),
        z: THREE.MathUtils.lerp(from.z, to.z, amount),
        yaw: interpolateAngle(from.yaw, to.yaw, amount),
        distance: THREE.MathUtils.lerp(from.distance, to.distance, amount),
        collision: from.collision || to.collision,
        collisionPart: from.collision_part || to.collision_part,
      },
      deltaTime,
      {
        checkpoint: context.checkpoint,
        episode,
        frame: frameIndex,
      },
    );
    this.timeline.value = String(frameIndex);
    this.updateTimelineLabel();
  }

  updateTimelineLabel() {
    const episode = this.currentEpisode();
    const maximum = Math.max(0, (episode?.frames.length ?? 1) - 1);
    const current = THREE.MathUtils.clamp(Math.round(this.playbackTime * 30), 0, maximum);
    this.timeline.max = String(maximum);
    this.timeline.value = String(current);
    this.panel.querySelector('[data-field="frame"]').textContent = `${current} / ${maximum}`;
  }

  updatePanel() {
    const context = this.currentContext();
    const episode = this.currentEpisode();
    const label = this.panel.querySelector('.training-label');
    if (label && this.data?.run) {
      label.textContent = `REPLAY: ${this.data.run.replaceAll('_', ' ').toUpperCase()}`;
    }
    this.syncEpisodeWorld(episode);
    const record = context?.record;
    const episodes = context?.episodes ?? [];
    this.panel.querySelector('[data-field="state"]').textContent = this.liveMode
      ? (this.data?.status ?? 'waiting').toUpperCase()
      : 'IMPORTED';

    if (this.replayMode === 'training') {
      const metrics = record?.metrics;
      this.panel.querySelector('[data-field="checkpoint"]').textContent = record
        ? `ROLLOUT ${record.rollout} · ${record.transition_count.toLocaleString()} TRANSITIONS`
        : 'NO TRAINING ROLLOUT YET';
      this.panel.querySelector('[data-field="metrics"]').textContent = metrics
        ? `COLLISIONS ${(metrics.collision_step_percentage * 100).toFixed(1)}% · STOPPED ${((metrics.stopped_step_percentage ?? metrics.zero_throttle_percentage ?? 0) * 100).toFixed(1)}% · FORWARD ${((metrics.forward_step_percentage ?? 0) * 100).toFixed(1)}% · REVERSE ${((metrics.reverse_step_percentage ?? 0) * 100).toFixed(1)}% · GOALS ${metrics.successes}`
        : 'THE FIRST ACTUAL ROLLOUT APPEARS AFTER 8,192 STEPS';
      const partial = episode?.starts_before_rollout || episode?.continues_after_rollout;
      this.panel.querySelector('[data-field="episode"]').textContent = episode
        ? `WORKER ${context.worker.worker} · EPISODE ${episode.episode}${partial ? ' SEGMENT' : ''} · ${episode.success ? 'TARGET REACHED' : episode.timeout ? 'TIMEOUT' : 'CONTINUES'} · REWARD ${episode.reward.toFixed(2)}`
        : 'WAITING FOR ACTUAL TRAINING EXPERIENCE';
      this.panel.querySelector('[data-field="worker"]').textContent = record
        ? `WORKER ${this.workerIndex + 1} / ${record.workers.length}`
        : 'NO WORKERS';
    } else {
      this.panel.querySelector('[data-field="checkpoint"]').textContent = record
        ? `${record.step.toLocaleString()} STEPS`
        : 'NO CHECKPOINT YET';
      this.panel.querySelector('[data-field="metrics"]').textContent = record
        ? `MEAN REWARD ${record.mean_reward.toFixed(2)} · SUCCESS ${(record.success_rate * 100).toFixed(0)}%`
        : 'THE FIRST REPLAY APPEARS AT 10,000 STEPS';
      this.panel.querySelector('[data-field="episode"]').textContent = episode
        ? `DETERMINISTIC REPLAY ${this.episodeIndex + 1}/${episodes.length} · ${episode.success ? 'TARGET REACHED' : 'MISSED'} · REWARD ${episode.reward.toFixed(2)}`
        : 'WAITING FOR CHECKPOINT DATA';
      this.panel.querySelector('[data-field="worker"]').textContent = 'EVALUATION MODE';
    }

    this.panel.querySelector('[data-field="replay"]').textContent = episodes.length
      ? `${this.replayMode === 'training' ? 'EPISODE' : 'REPLAY'} ${this.episodeIndex + 1} / ${episodes.length}`
      : 'NO EPISODES';
    this.updateTimelineLabel();
  }
}
