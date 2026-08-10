"""Train and evaluate a PPO agent in the Leaper target-reaching environment."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from datetime import datetime, timezone

import matplotlib
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_checker import check_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from rl_environment import LeaperReachEnv


ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "rl_artifacts"
LIVE_STATE = ROOT / "public" / "rl_live_state.json"


def write_live_state(payload: dict) -> None:
    """Publish one complete snapshot for the browser training visualizer."""
    LIVE_STATE.parent.mkdir(exist_ok=True)
    temporary = LIVE_STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    temporary.replace(LIVE_STATE)


class ProgressCallback(BaseCallback):
    def __init__(self, eval_every: int = 10_000, verbose: int = 1):
        super().__init__(verbose)
        self.eval_every = eval_every
        self.episode_rewards: list[float] = []
        self.eval_rows: list[tuple[int, float, float]] = []
        self.visualizer_checkpoints: list[dict] = []

    def _on_step(self) -> bool:
        for info in self.locals.get("infos", []):
            if "episode" in info:
                self.episode_rewards.append(float(info["episode"]["r"]))
        if self.num_timesteps % self.eval_every == 0:
            mean_reward, success_rate, recordings = evaluate_with_recordings(
                self.model,
                episodes=25,
                record_episodes=5,
            )
            self.eval_rows.append((self.num_timesteps, mean_reward, success_rate))
            self.visualizer_checkpoints.append(
                {
                    "step": self.num_timesteps,
                    "mean_reward": mean_reward,
                    "success_rate": success_rate,
                    "episodes": recordings,
                }
            )
            self._save_progress()
            self._save_live_state("training")
            if self.verbose:
                print(
                    f"\nEvaluation at {self.num_timesteps:,} steps: "
                    f"mean reward={mean_reward:.2f}, success={success_rate:.0%}"
                )
        return True

    def _save_progress(self) -> None:
        ARTIFACTS.mkdir(exist_ok=True)
        with (ARTIFACTS / "training_progress.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["episode", "reward"])
            writer.writerows(enumerate(self.episode_rewards, start=1))

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(2, 1, figsize=(9, 7), constrained_layout=True)
        rewards = np.asarray(self.episode_rewards)
        axes[0].plot(rewards, alpha=0.25, color="#ff4a26", label="episode")
        if len(rewards) >= 20:
            smooth = np.convolve(rewards, np.ones(20) / 20, mode="valid")
            axes[0].plot(np.arange(19, len(rewards)), smooth, color="#8b1cff", label="20-episode mean")
        axes[0].set(title="PPO training reward", xlabel="Episode", ylabel="Reward")
        axes[0].legend()
        if self.eval_rows:
            steps, means, successes = zip(*self.eval_rows)
            axes[1].plot(steps, means, marker="o", label="Evaluation reward")
            success_axis = axes[1].twinx()
            success_axis.plot(steps, successes, marker="s", color="#ff4fa3", label="Success rate")
            success_axis.set_ylim(0, 1.05)
            success_axis.set_ylabel("Success rate")
        axes[1].set(title="Deterministic evaluation", xlabel="Training steps", ylabel="Mean reward")
        fig.savefig(ARTIFACTS / "training_progress.png", dpi=150)
        plt.close(fig)

    def _save_live_state(self, status: str, final_result: tuple[float, float] | None = None) -> None:
        payload = {
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "checkpoints": self.visualizer_checkpoints,
        }
        if final_result is not None:
            payload["final_mean_reward"] = final_result[0]
            payload["final_success_rate"] = final_result[1]
        write_live_state(payload)


def evaluate(model: PPO, episodes: int = 25) -> tuple[float, float]:
    env = LeaperReachEnv()
    rewards, successes = [], 0
    for episode in range(episodes):
        observation, _ = env.reset(seed=10_000 + episode)
        total = 0.0
        done = False
        while not done:
            action, _ = model.predict(observation, deterministic=True)
            observation, reward, terminated, truncated, info = env.step(action)
            total += reward
            done = terminated or truncated
        rewards.append(total)
        successes += int(info["is_success"])
    env.close()
    return float(np.mean(rewards)), successes / episodes


def evaluate_with_recordings(
    model: PPO,
    episodes: int = 25,
    record_episodes: int = 5,
) -> tuple[float, float, list[dict]]:
    """Score deterministically and record exploratory 3D replay attempts."""
    mean_reward, success_rate = evaluate(model, episodes=episodes)
    env = LeaperReachEnv()
    recordings = []
    for episode in range(record_episodes):
        observation, info = env.reset(seed=20_000 + episode)
        total = 0.0
        done = False
        path_length = 0.0
        previous_position = env.position.copy()
        frames = [
            {
                "x": float(env.position[0]),
                "z": float(env.position[1]),
                "yaw": env.yaw,
                "distance": info["distance"],
                "collision": False,
                "collision_part": None,
            }
        ]
        while not done:
            action, _ = model.predict(observation, deterministic=False)
            observation, reward, terminated, truncated, info = env.step(action)
            total += reward
            done = terminated or truncated
            path_length += float(np.linalg.norm(env.position - previous_position))
            previous_position = env.position.copy()
            frames.append(
                {
                    "x": float(env.position[0]),
                    "z": float(env.position[1]),
                    "yaw": env.yaw,
                    "distance": info["distance"],
                    "collision": info["collision"],
                    "collision_part": info["collision_part"],
                }
            )
        recordings.append(
            {
                "episode": episode + 1,
                "reward": total,
                "success": bool(info["is_success"]),
                "path_length": path_length,
                "exploratory": True,
                "frames": frames,
            }
        )
    env.close()
    recordings.sort(key=lambda recording: recording["path_length"], reverse=True)
    return mean_reward, success_rate, recordings


def watch(model: PPO, episodes: int = 5) -> None:
    env = LeaperReachEnv(render_mode="human")
    for episode in range(episodes):
        observation, _ = env.reset()
        done = False
        while not done:
            action, _ = model.predict(observation, deterministic=True)
            observation, _, terminated, truncated, _ = env.step(action)
            done = terminated or truncated
    env.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps", type=int, default=300_000)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--watch", action="store_true", help="animate trained evaluation episodes")
    args = parser.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    write_live_state(
        {
            "status": "starting",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "checkpoints": [],
        }
    )
    check_env(LeaperReachEnv(), warn=True)
    env = DummyVecEnv([lambda: Monitor(LeaperReachEnv()) for _ in range(8)])
    model = PPO(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
        n_steps=1024,
        batch_size=256,
        n_epochs=10,
        gamma=0.995,
        gae_lambda=0.95,
        ent_coef=0.01,
        verbose=1,
        seed=args.seed,
        tensorboard_log=str(ARTIFACTS / "tensorboard"),
        device="auto",
    )
    callback = ProgressCallback(eval_every=10_000)
    model.learn(total_timesteps=args.timesteps, callback=callback, progress_bar=True)
    model.save(ARTIFACTS / "leaper_ppo")
    callback._save_progress()
    mean_reward, success_rate = evaluate(model, episodes=100)
    callback._save_live_state("complete", (mean_reward, success_rate))
    print(f"Final evaluation: mean reward={mean_reward:.2f}, success={success_rate:.0%}")
    if args.watch:
        watch(model)


if __name__ == "__main__":
    main()
