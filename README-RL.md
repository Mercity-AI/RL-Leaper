# Leaper PPO Target-Reaching Environment

This standalone Gymnasium environment trains a continuous-control PPO policy to
steer the planar Leaper around five static obstacles toward a fixed target.
Starts and headings are randomized every episode.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-rl.txt
```

## Train and inspect progress

```powershell
python train_rl.py --timesteps 300000
```

Use a distinct run name for the live feed and training ledger:

```powershell
python train_rl.py --timesteps 100000 --run-name PPO_10 `
  --artifact-dir rl_artifacts/ppo_10_signed_throttle_100k
```

Generated outputs are written to the selected artifact directory. Use a unique
`--artifact-dir` for every experiment so smoke tests and archived runs cannot
overwrite one another:

- `training_progress.png` — episode reward, smoothed reward, evaluation reward,
  and success rate
- `training_progress.csv` — raw reward per completed training episode
- `training_diagnostics.csv` — collision, ending, progress, reward-component,
  forward/reverse/stopped step percentages, and signed/absolute throttle metrics
- `training_stdout.log` and `training_stderr.log` — console output when the
  launch command redirects those streams
- `checkpoints/` — recoverable policy snapshot every 10,000 steps
- `leaper_ppo.zip` — final trained PPO policy
- `tensorboard/` — detailed PPO metrics under the selected run name
- `final_evaluation.json` — fixed-seed 100-episode deterministic diagnostics
- `browser_replay.json` — archived copy of the browser replay feed
- `public/rl_live_state.json` — generated browser bridge containing checkpoint
  replays and the latest three real PPO training rollouts

Run TensorBoard with:

```powershell
tensorboard --logdir rl_artifacts
```

Open TensorBoard at `http://127.0.0.1:6006/`. Pointing it at the artifact root
recursively includes the archived PPO_1 through PPO_10 event histories as well
as isolated smoke-test runs.

## Browser visualizer

Start the browser simulator separately:

```powershell
pnpm dev
```

Open `http://127.0.0.1:5173/?training=1`. The playback dock has two modes:

- **Actual PPO Rollout** — the latest real 8,192-transition training buffers,
  separated into eight workers and their episode segments
- **Checkpoint Replays** — deterministic checkpoint metrics and five
  exploratory demonstration episodes recorded every 10,000 steps

The actual-rollout summary shows collision rate, stopped/forward/reverse action
rates, goals, and episode outcomes. Worker, episode, rollout, play/pause, and
timeline controls allow individual training paths to be inspected.

PPO_10 uses signed forward throttle: `-1` is full reverse, `0` is stopped, and
`+1` is full forward. Turning remains `[-1, 1]`. This action-space change makes
all older trained policies incompatible with PPO_10.

PPO_11 keeps that signed throttle and adds eight obstacle-clearance rays to the
observation, growing it from 10 to 18 values. Indices 0-9 are the exact PPO_10
observation; indices 10-17 are rangefinders spaced every 45 degrees around the
current facing (ray 0 straight ahead), each reporting the clear distance to the
nearest obstacle or wall divided by `RAY_MAX_RANGE = 12.0` and clipped to
`[0, 1]`, where `1.0` means nothing within range. The policy is never told to
avoid obstacles; it only receives the ray readings and the unchanged `-0.18`
collision penalty, and learns avoidance from them. Because the observation size
changes, every 10-value policy (PPO_9, PPO_10) is incompatible with PPO_11.

PPO_12 keeps PPO_11's rays and observation and changes only the collision
response. When a step's combined turn-and-move is blocked, rotation and
translation are now resolved independently: the robot rotates in place if the
turned pose alone is clear, then translates along the resolved facing if that
alone is clear. This lets a touching robot turn or reverse out of contact instead
of freezing. The collision flag and its `-0.18` penalty still reflect the full
intended move, so reward semantics are unchanged. From PPO_12 onward, training
uses a fresh natural random seed (recorded in each run's `training_config.json`)
rather than a fixed seed; the 100-episode deterministic evaluation still uses
fixed seeds from 10,000 so runs stay comparable.

Standalone replay viewers live at `rl_artifacts/leaper_arena_replay.html`
(top-down, shows the eight rays) and `rl_artifacts/leaper_training_theatre.html`
(full 3D hexapod with chase, Leaper first-person, top, and cinematic cameras, rays
drawn as beams). Both are self-contained HTML files; double-click to open, no
server required. They are regenerated to show the most recent completed run.

To train and then watch five deterministic Matplotlib evaluation episodes:

```powershell
python train_rl.py --timesteps 300000 --watch
```

For an isolated quick smoke test, use:

```powershell
python train_rl.py --timesteps 20000 --run-name PPO_10_SMOKE `
  --artifact-dir rl_artifacts/ppo_10_signed_throttle_smoke
```

Do not assume a longer run will fix a policy whose deterministic success and
target progress have already collapsed. Compare controlled experiments at the
same checkpoint and record every observation, action, physics, reward, or PPO
change in `TRAINING.md`.
