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
    this.checkpointIndex = -1;
    this.episodeIndex = 0;
    this.playbackTime = 0;
    this.lastFetch = -Infinity;
    this.followLatest = true;
    this.loading = false;
    this.playing = true;
    this.liveMode = true;
    this.timeline = panel.querySelector('[data-field="timeline"]');
    this.playButton = panel.querySelector('[data-action="play"]');
    this.logInput = panel.querySelector('[data-field="log-input"]');
    this.liveButton = panel.querySelector('[data-action="live-log"]');

    panel.querySelector('[data-action="previous"]').addEventListener('click', () => {
      this.followLatest = false;
      this.selectCheckpoint(this.checkpointIndex - 1);
    });
    panel.querySelector('[data-action="next"]').addEventListener('click', () => {
      const isAtLatest = this.checkpointIndex >= (this.data?.checkpoints.length ?? 0) - 2;
      this.followLatest = isAtLatest;
      this.selectCheckpoint(this.checkpointIndex + 1);
    });
    this.playButton.addEventListener('click', () => this.setPlaying(!this.playing));
    panel.querySelector('[data-action="previous-replay"]').addEventListener('click', () => {
      this.selectEpisode(this.episodeIndex - 1);
    });
    panel.querySelector('[data-action="next-replay"]').addEventListener('click', () => {
      this.selectEpisode(this.episodeIndex + 1);
    });
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
  }

  async importLog() {
    const [file] = this.logInput.files;
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported.checkpoints) || imported.checkpoints.length === 0) {
        throw new Error('This file has no replay checkpoints');
      }
      const hasFrames = imported.checkpoints.some((checkpoint) => (
        checkpoint.episodes?.some((episode) => Array.isArray(episode.frames))
      ));
      if (!hasFrames) throw new Error('This file has no replay frames');
      this.data = imported;
      this.liveMode = false;
      this.followLatest = false;
      this.liveButton.disabled = false;
      this.panel.querySelector('[data-field="source"]').textContent = `SOURCE: ${file.name}`;
      this.selectCheckpoint(imported.checkpoints.length - 1);
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

  currentEpisode() {
    return this.data?.checkpoints[this.checkpointIndex]?.episodes[this.episodeIndex];
  }

  selectEpisode(index) {
    const episodes = this.data?.checkpoints[this.checkpointIndex]?.episodes ?? [];
    if (!episodes.length) return;
    this.episodeIndex = (index + episodes.length) % episodes.length;
    this.playbackTime = 0;
    this.setPlaying(true);
    this.updatePanel();
  }

  async refresh() {
    if (this.loading || !this.liveMode) return;
    this.loading = true;
    try {
      const response = await fetch(`/rl_live_state.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextData = await response.json();
      const previousCount = this.data?.checkpoints.length ?? 0;
      this.data = nextData;
      if (this.followLatest && nextData.checkpoints.length !== previousCount) {
        this.selectCheckpoint(nextData.checkpoints.length - 1);
      }
      this.updatePanel();
    } catch (error) {
      this.panel.querySelector('[data-field="state"]').textContent = 'WAITING FOR TRAINER';
    } finally {
      this.loading = false;
    }
  }

  selectCheckpoint(index) {
    const count = this.data?.checkpoints.length ?? 0;
    if (!count) return;
    this.checkpointIndex = THREE.MathUtils.clamp(index, 0, count - 1);
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

    const checkpoint = this.data?.checkpoints[this.checkpointIndex];
    const episode = this.currentEpisode();
    if (!episode?.frames.length) return;

    if (this.playing) this.playbackTime += deltaTime;
    const framePosition = this.playbackTime * 30;
    const frameIndex = Math.min(Math.floor(framePosition), episode.frames.length - 1);
    if (frameIndex >= episode.frames.length - 1) {
      if (this.playing) {
        this.episodeIndex = (this.episodeIndex + 1) % checkpoint.episodes.length;
        this.playbackTime = 0;
        this.updatePanel();
        return;
      }
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
        checkpoint,
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
    const checkpoint = this.data?.checkpoints[this.checkpointIndex];
    const episode = checkpoint?.episodes[this.episodeIndex];
    this.panel.querySelector('[data-field="state"]').textContent = this.liveMode
      ? (this.data?.status ?? 'waiting').toUpperCase()
      : 'IMPORTED';
    this.panel.querySelector('[data-field="checkpoint"]').textContent = checkpoint
      ? `${checkpoint.step.toLocaleString()} STEPS`
      : 'NO CHECKPOINT YET';
    this.panel.querySelector('[data-field="metrics"]').textContent = checkpoint
      ? `MEAN REWARD ${checkpoint.mean_reward.toFixed(2)}  ·  SUCCESS ${(checkpoint.success_rate * 100).toFixed(0)}%`
      : 'THE FIRST REPLAY APPEARS AT 10,000 STEPS';
    this.panel.querySelector('[data-field="episode"]').textContent = episode
      ? `${episode.exploratory ? 'EXPLORATORY ' : ''}REPLAY ${this.episodeIndex + 1}/${checkpoint.episodes.length}  ·  ${episode.success ? 'TARGET REACHED' : 'MISSED'}  ·  REWARD ${episode.reward.toFixed(2)}`
      : 'WAITING FOR TRAINING DATA';
    this.panel.querySelector('[data-field="replay"]').textContent = checkpoint
      ? `ROLLOUT ${this.episodeIndex + 1} / ${checkpoint.episodes.length}`
      : 'NO ROLLOUTS';
    this.updateTimelineLabel();
  }
}
