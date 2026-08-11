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
python train_rl.py --timesteps 100000 --run-name PPO_10
```

Generated outputs are written to `rl_artifacts/`:

- `training_progress.png` — episode reward, smoothed reward, evaluation reward,
  and success rate
- `training_progress.csv` — raw reward per completed training episode
- `training_diagnostics.csv` — collision, throttle, ending, progress, and
  reward-component metrics per episode
- `training_stdout.log` and `training_stderr.log` — console output when the
  launch command redirects those streams
- `checkpoints/` — recoverable policy snapshot every 10,000 steps
- `leaper_ppo.zip` — final trained PPO policy
- `tensorboard/` — detailed PPO metrics separated into `PPO_1`, `PPO_2`, and
  later run directories
- `public/rl_live_state.json` — generated browser bridge containing checkpoint
  replays and the latest three real PPO training rollouts

Run TensorBoard with:

```powershell
tensorboard --logdir rl_artifacts/tensorboard
```

Open TensorBoard at `http://127.0.0.1:6006/`.

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

The actual-rollout summary shows collision rate, zero-throttle rate, goals, and
episode outcomes. Worker, episode, rollout, play/pause, and timeline controls
allow individual training paths to be inspected.

To train and then watch five deterministic Matplotlib evaluation episodes:

```powershell
python train_rl.py --timesteps 300000 --watch
```

For a quick smoke test, use `--timesteps 20000`. Do not assume a longer run will
fix a policy whose deterministic success and target progress have already
collapsed. Compare controlled experiments at the same checkpoint and record
every observation, action, physics, reward, or PPO change in `TRAINING.md`.
