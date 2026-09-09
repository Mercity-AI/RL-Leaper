"""Instrumented 20k smoke benchmark for PPO_32 (cleared-map seeker).

Separates the costs the timing question asks about: pure env+map stepping, training-
only FPS (no periodic eval), one final evaluation pass, detection diagnostics, and
replay serialization + file size. Prints a measured 250k projection. Viewer is never
rendered (render_mode=None throughout).
"""

import json
import time
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from rl_environment import LeaperReachEnv
from train_rl import (
    detection_diagnostics,
    evaluate_with_recordings,
    widen_policy_state_dict,
)

ROOT = Path(__file__).resolve().parent
DONOR = ROOT / "rl_artifacts" / "ppo_29_normalized_throttle_250k" / "leaper_ppo.zip"

LeaperReachEnv.NORMALIZED_THROTTLE = True
LeaperReachEnv.COVERAGE_MAP = True


def bench_env_stepping(steps: int = 20_000) -> None:
    env = LeaperReachEnv()
    env.reset(seed=0)
    actions = [env.action_space.sample() for _ in range(1000)]
    t0 = time.perf_counter()
    done_count = 0
    for i in range(steps):
        _, _, term, trunc, _ = env.step(actions[i % 1000])
        if term or trunc:
            env.reset()
            done_count += 1
    dt = time.perf_counter() - t0
    env.close()
    print(f"[env+map] {steps} single-env steps in {dt:.2f}s = "
          f"{steps/dt:,.0f} steps/s ({dt/steps*1e6:.1f} us/step), {done_count} resets")


class _Silent(BaseCallback):
    def _on_step(self) -> bool:
        return True


def bench_training(timesteps: int = 20_000):
    env = DummyVecEnv([lambda: Monitor(LeaperReachEnv()) for _ in range(8)])
    donor = PPO.load(DONOR, device="cpu")
    model = PPO(
        "MlpPolicy", env, learning_rate=1.5e-4, n_steps=1024, batch_size=256,
        n_epochs=10, gamma=0.995, gae_lambda=0.95, ent_coef=0.01,
        policy_kwargs=dict(net_arch=[64, 64]), verbose=0, seed=123, device="cpu",
    )
    widened = widen_policy_state_dict(donor.policy.state_dict(), model.policy.state_dict())
    model.policy.load_state_dict(widened, strict=True)
    del donor
    t0 = time.perf_counter()
    model.learn(total_timesteps=timesteps, callback=_Silent(), progress_bar=False)
    dt = time.perf_counter() - t0
    collected = model.num_timesteps
    print(f"[train-only] collected {collected:,} transitions in {dt:.2f}s = "
          f"{collected/dt:,.0f} FPS (no periodic eval)")
    env.close()
    return model, collected / dt


def bench_eval(model) -> None:
    t0 = time.perf_counter()
    detection_diagnostics(model, episodes=100)
    dt_det = time.perf_counter() - t0

    t0 = time.perf_counter()
    _, _, recordings = evaluate_with_recordings(model, episodes=25, record_episodes=5)
    dt_rec = time.perf_counter() - t0

    payload = {"checkpoints": [{"episodes": recordings}]}
    t0 = time.perf_counter()
    blob = json.dumps(payload)
    dt_ser = time.perf_counter() - t0
    size_kb = len(blob.encode("utf-8")) / 1024

    total_new = sum(len(f.get("coverage_new", [])) for ep in recordings for f in ep["frames"])
    print(f"[eval] detection_diagnostics(100) = {dt_det:.2f}s")
    print(f"[eval] evaluate_with_recordings(25,5) = {dt_rec:.2f}s")
    print(f"[replay] 5-episode payload serialize = {dt_ser*1000:.1f}ms, "
          f"{size_kb:.1f} KB, {total_new} coverage-delta ints total")
    return dt_det, dt_rec


def main() -> None:
    total0 = time.perf_counter()
    bench_env_stepping(20_000)
    model, train_fps = bench_training(20_000)
    dt_det, dt_rec = bench_eval(model)
    total = time.perf_counter() - total0

    # 250k projection: training + a checkpoint eval every 10k (detection(25)+recordings)
    train_250k = 256_000 / train_fps  # PPO rounds up to whole 8192 rollouts
    checkpoints = 25
    # checkpoint eval ~ detection(25) + evaluate_with_recordings(25,5); scale det(100)->det(25)
    per_ckpt = (dt_det * 25 / 100) + dt_rec
    ckpt_total = checkpoints * per_ckpt
    final_eval = dt_det + (dt_det) + dt_rec  # evaluate_diagnostics(100)+detection(100)+recordings
    projected = train_250k + ckpt_total + final_eval
    print("\n=== 250k PROJECTION (measured) ===")
    print(f"training-only 256k @ {train_fps:,.0f} FPS = {train_250k/60:.1f} min")
    print(f"checkpoint evals ({checkpoints} x {per_ckpt:.1f}s) = {ckpt_total/60:.1f} min")
    print(f"final eval bundle ~ {final_eval/60:.1f} min")
    print(f"PROJECTED TOTAL per seed ~ {projected/60:.1f} min")
    print(f"(20k smoke harness itself took {total/60:.1f} min)")


if __name__ == "__main__":
    main()
