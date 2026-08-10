# Leaper PPO Target-Reaching Environment

This standalone Gymnasium environment trains a continuous-control PPO policy to steer an agent around static obstacles toward a fixed pink target. Starts and headings are randomized every episode.

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

Training prints periodic evaluation reward and success rate. Outputs are written to `rl_artifacts/`:

- `training_progress.png` — episode reward, smoothed reward, evaluation reward, and success rate
- `training_progress.csv` — raw reward per episode
- `leaper_ppo.zip` — trained PPO policy
- `tensorboard/` — detailed training metrics

Run TensorBoard with:

```powershell
tensorboard --logdir rl_artifacts/tensorboard
```

To train and then watch five animated evaluation episodes:

```powershell
python train_rl.py --timesteps 300000 --watch
```

For a quick smoke test, use `--timesteps 20000`. Reliable behavior normally requires the full default run; exact convergence depends on hardware and seed.
