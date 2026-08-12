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
