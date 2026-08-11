import * as THREE from 'three';

function interpolateAngle(from, to, amount) {
  const difference = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + difference * amount;
}

export class TrainingVisualizer {
  constructor({ simulation, target, panel }) {
    this.simulation = simulation;
    this.target = target;
    this.panel = panel;
    this.data = null;
    this.replayMode = 'training';
    this.dataIndex = -1;
    this.workerIndex = 0;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.lastFetch = 0;
    this.followLatest = true;
    this.loading = false;
    this.playing = true;
    this.liveMode = true;
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
    this.selectMode('training');
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
      this.selectMode(hasTrainingRollouts ? 'training' : 'evaluation');
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
        ? `COLLISIONS ${(metrics.collision_step_percentage * 100).toFixed(1)}% · ZERO THROTTLE ${(metrics.zero_throttle_percentage * 100).toFixed(1)}% · GOALS ${metrics.successes}`
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
        ? `${episode.exploratory ? 'EXPLORATORY ' : ''}REPLAY ${this.episodeIndex + 1}/${episodes.length} · ${episode.success ? 'TARGET REACHED' : 'MISSED'} · REWARD ${episode.reward.toFixed(2)}`
        : 'WAITING FOR CHECKPOINT DATA';
      this.panel.querySelector('[data-field="worker"]').textContent = 'EVALUATION MODE';
    }

    this.panel.querySelector('[data-field="replay"]').textContent = episodes.length
      ? `${this.replayMode === 'training' ? 'EPISODE' : 'REPLAY'} ${this.episodeIndex + 1} / ${episodes.length}`
      : 'NO EPISODES';
    this.updateTimelineLabel();
  }
}
