"""Train and evaluate a PPO agent in the Leaper target-reaching environment."""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARTIFACTS_ROOT = ROOT / "rl_artifacts"
os.environ.setdefault("MPLCONFIGDIR", str(ARTIFACTS_ROOT / ".matplotlib"))

import matplotlib
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_checker import check_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from rl_environment import LeaperReachEnv


LIVE_STATE = ROOT / "public" / "rl_live_state.json"
MAX_TRAINING_ROLLOUTS = 3
THROTTLE_EPSILON = 1e-8


def classify_throttle(throttle: float) -> str:
    """Classify a signed throttle without counting reverse as stopped."""
    if abs(throttle) <= THROTTLE_EPSILON:
        return "stopped"
    return "forward" if throttle > 0.0 else "reverse"


def write_live_state(payload: dict) -> None:
    """Publish a snapshot without allowing a viewer lock to stop training."""
    LIVE_STATE.parent.mkdir(exist_ok=True)
    temporary = LIVE_STATE.with_name(
        f"{LIVE_STATE.stem}.{os.getpid()}.tmp"
    )
    temporary.write_text(json.dumps(payload), encoding="utf-8")
    for attempt in range(20):
        try:
            temporary.replace(LIVE_STATE)
            return
        except PermissionError:
            if attempt < 19:
                time.sleep(0.1)

    # Replay publishing is monitoring only. A browser or virus scanner can
    # briefly hold the destination open on Windows; losing one visualizer
    # refresh must never destroy a training run.
    temporary.unlink(missing_ok=True)
    print(
        "Warning: skipped one live-state update because the viewer kept "
        "the replay file locked.",
    )


class ProgressCallback(BaseCallback):
    def __init__(
        self,
        run_name: str,
        artifact_directory: Path,
        eval_every: int = 10_000,
        verbose: int = 1,
    ):
        super().__init__(verbose)
        self.run_name = run_name
        self.artifact_directory = artifact_directory
        self.eval_every = eval_every
        self.episode_rewards: list[float] = []
        self.eval_rows: list[tuple[int, float, float]] = []
        self.visualizer_checkpoints: list[dict] = []
        self.training_rollouts: list[dict] = []
        self.episode_diagnostics: list[dict] = []
        self.rollout_number = 0
        self.worker_episode_numbers: list[int] = []
        self.episode_accumulators: list[dict] = []
        self.current_rollout_workers: list[dict] = []
        self.current_segments: list[dict | None] = []
        self.current_rollout_stats: dict = {}

    @staticmethod
    def _new_episode_accumulator() -> dict:
        return {
            "steps": 0,
            "collisions": 0,
            "collision_streak": 0,
            "longest_collision_streak": 0,
            "forward_throttle_steps": 0,
            "reverse_throttle_steps": 0,
            "stopped_throttle_steps": 0,
            "throttle_total": 0.0,
            "absolute_throttle_total": 0.0,
            "start_distance": None,
            "reward_terms": {
                "progress": 0.0,
                "time": 0.0,
                "collision": 0.0,
                "goal": 0.0,
            },
        }

    @staticmethod
    def _frame_from_observation(observation: np.ndarray) -> dict:
        max_distance = 2.0 * np.sqrt(2.0) * LeaperReachEnv.WORLD_LIMIT
        return {
            "x": float(observation[0] * LeaperReachEnv.WORLD_LIMIT),
            "z": float(observation[1] * LeaperReachEnv.WORLD_LIMIT),
            "yaw": float(np.arctan2(observation[5], observation[6])),
            "distance": float(observation[4] * max_distance),
            "collision": bool(observation[7]),
            "collision_part": None,
            "forward_action": float(observation[8]),
            "turn_action": float(observation[9]),
            "vision": [float(value) for value in observation[10:]],
            "reward": 0.0,
        }

    @staticmethod
    def _frame_from_step(info: dict, action: np.ndarray, reward: float) -> dict:
        return {
            "x": info["x"],
            "z": info["z"],
            "yaw": info["yaw"],
            "distance": info["distance"],
            "collision": info["collision"],
            "collision_part": info["collision_part"],
            "forward_action": float(action[0]),
            "turn_action": float(action[1]),
            "vision": list(info.get("vision", ())),
            "reward": float(reward),
            "reward_terms": info["reward_terms"],
        }

    def _on_training_start(self) -> None:
        worker_count = self.training_env.num_envs
        self.worker_episode_numbers = [1] * worker_count
        self.episode_accumulators = [
            self._new_episode_accumulator() for _ in range(worker_count)
        ]

    def _on_rollout_start(self) -> None:
        worker_count = self.training_env.num_envs
        self.rollout_number += 1
        self.current_rollout_workers = [
            {"worker": worker + 1, "episodes": []}
            for worker in range(worker_count)
        ]
        self.current_segments = [None] * worker_count
        self.current_rollout_stats = {
            "transitions": 0,
            "collision_steps": 0,
            "forward_throttle_steps": 0,
            "reverse_throttle_steps": 0,
            "stopped_throttle_steps": 0,
            "throttle_total": 0.0,
            "absolute_throttle_total": 0.0,
            "completed_episodes": 0,
            "successes": 0,
            "timeouts": 0,
            "reward_terms": {
                "progress": 0.0,
                "time": 0.0,
                "collision": 0.0,
                "goal": 0.0,
            },
        }

    def _on_step(self) -> bool:
        infos = self.locals.get("infos", [])
        actions = np.asarray(
            self.locals.get("clipped_actions", self.locals.get("actions"))
        )
        rewards = np.asarray(self.locals.get("rewards"))
        dones = np.asarray(self.locals.get("dones"))
        observations = self.locals.get("obs_tensor")
        if hasattr(observations, "detach"):
            observations = observations.detach().cpu().numpy()
        observations = np.asarray(observations)

        for worker, info in enumerate(infos):
            if "episode" in info:
                self.episode_rewards.append(float(info["episode"]["r"]))

            action = actions[worker]
            reward = float(rewards[worker])
            collided = bool(info["collision"])
            throttle = float(action[0])
            throttle_class = classify_throttle(throttle)
            accumulator = self.episode_accumulators[worker]

            if self.current_segments[worker] is None:
                segment = {
                    "episode": self.worker_episode_numbers[worker],
                    "starts_before_rollout": accumulator["steps"] > 0,
                    "continues_after_rollout": False,
                    "success": False,
                    "timeout": False,
                    "reward": 0.0,
                    "obstacles": [list(obstacle) for obstacle in info.get("obstacles", ())],
                    "frames": [self._frame_from_observation(observations[worker])],
                }
                self.current_segments[worker] = segment
                self.current_rollout_workers[worker]["episodes"].append(segment)

            self.current_segments[worker]["frames"].append(
                self._frame_from_step(info, action, reward)
            )
            self.current_segments[worker]["reward"] += reward

            if accumulator["start_distance"] is None:
                accumulator["start_distance"] = (
                    info["distance"]
                    + info["reward_terms"]["progress"]
                    / LeaperReachEnv.DISTANCE_REWARD_SCALE
                )
            accumulator["steps"] += 1
            accumulator["collisions"] += int(collided)
            accumulator[f"{throttle_class}_throttle_steps"] += 1
            accumulator["throttle_total"] += throttle
            accumulator["absolute_throttle_total"] += abs(throttle)
            if collided:
                accumulator["collision_streak"] += 1
                accumulator["longest_collision_streak"] = max(
                    accumulator["longest_collision_streak"],
                    accumulator["collision_streak"],
                )
            else:
                accumulator["collision_streak"] = 0
            for term, value in info["reward_terms"].items():
                accumulator["reward_terms"][term] += float(value)
                self.current_rollout_stats["reward_terms"][term] += float(value)

            self.current_rollout_stats["transitions"] += 1
            self.current_rollout_stats["collision_steps"] += int(collided)
            self.current_rollout_stats[f"{throttle_class}_throttle_steps"] += 1
            self.current_rollout_stats["throttle_total"] += throttle
            self.current_rollout_stats["absolute_throttle_total"] += abs(throttle)

            if dones[worker]:
                success = bool(info["is_success"])
                timeout = not success
                steps = accumulator["steps"]
                terms = accumulator["reward_terms"]
                self.current_segments[worker]["success"] = success
                self.current_segments[worker]["timeout"] = timeout
                self.episode_diagnostics.append(
                    {
                        "episode": len(self.episode_diagnostics) + 1,
                        "worker": worker + 1,
                        "steps": steps,
                        "success": int(success),
                        "timeout": int(timeout),
                        "collision_steps": accumulator["collisions"],
                        "collision_step_percentage": accumulator["collisions"] / steps,
                        "longest_collision_streak": accumulator["longest_collision_streak"],
                        "forward_step_percentage": accumulator["forward_throttle_steps"] / steps,
                        "reverse_step_percentage": accumulator["reverse_throttle_steps"] / steps,
                        "stopped_step_percentage": accumulator["stopped_throttle_steps"] / steps,
                        "mean_signed_throttle": accumulator["throttle_total"] / steps,
                        "mean_absolute_throttle": accumulator["absolute_throttle_total"] / steps,
                        "start_distance": accumulator["start_distance"],
                        "final_distance": info["distance"],
                        "net_target_progress": accumulator["start_distance"] - info["distance"],
                        "distance_reward": terms["progress"],
                        "time_reward": terms["time"],
                        "collision_reward": terms["collision"],
                        "goal_reward": terms["goal"],
                        "total_reward": sum(terms.values()),
                    }
                )
                self.current_rollout_stats["completed_episodes"] += 1
                self.current_rollout_stats["successes"] += int(success)
                self.current_rollout_stats["timeouts"] += int(timeout)
                self.worker_episode_numbers[worker] += 1
                self.episode_accumulators[worker] = self._new_episode_accumulator()
                self.current_segments[worker] = None

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
            checkpoint_directory = self.artifact_directory / "checkpoints"
            checkpoint_directory.mkdir(exist_ok=True)
            self.model.save(
                checkpoint_directory / f"leaper_ppo_{self.num_timesteps}"
            )
            self._save_progress()
            self._save_live_state("training")
            if self.verbose:
                print(
                    f"\nEvaluation at {self.num_timesteps:,} steps: "
                    f"mean reward={mean_reward:.2f}, success={success_rate:.0%}"
                )
        return True

    def _on_rollout_end(self) -> None:
        for segment in self.current_segments:
            if segment is not None:
                segment["continues_after_rollout"] = True

        stats = self.current_rollout_stats
        transitions = max(stats["transitions"], 1)
        rollout = {
            "rollout": self.rollout_number,
            "start_step": self.num_timesteps - stats["transitions"],
            "end_step": self.num_timesteps,
            "transition_count": stats["transitions"],
            "workers": self.current_rollout_workers,
            "metrics": {
                "completed_episodes": stats["completed_episodes"],
                "successes": stats["successes"],
                "timeouts": stats["timeouts"],
                "collision_steps": stats["collision_steps"],
                "collision_step_percentage": stats["collision_steps"] / transitions,
                "forward_step_percentage": stats["forward_throttle_steps"] / transitions,
                "reverse_step_percentage": stats["reverse_throttle_steps"] / transitions,
                "stopped_step_percentage": stats["stopped_throttle_steps"] / transitions,
                "mean_signed_throttle": stats["throttle_total"] / transitions,
                "mean_absolute_throttle": stats["absolute_throttle_total"] / transitions,
                "reward_terms": stats["reward_terms"],
            },
        }
        self.training_rollouts.append(rollout)
        self.training_rollouts = self.training_rollouts[-MAX_TRAINING_ROLLOUTS:]
        self._save_diagnostics()
        self._save_live_state("training")

    def _save_progress(self) -> None:
        self.artifact_directory.mkdir(parents=True, exist_ok=True)
        with (self.artifact_directory / "training_progress.csv").open(
            "w", newline="", encoding="utf-8"
        ) as handle:
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
        fig.savefig(self.artifact_directory / "training_progress.png", dpi=150)
        plt.close(fig)
        self._save_diagnostics()

    def _save_diagnostics(self) -> None:
        if not self.episode_diagnostics:
            return
        fields = list(self.episode_diagnostics[0])
        with (self.artifact_directory / "training_diagnostics.csv").open(
            "w", newline="", encoding="utf-8"
        ) as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(self.episode_diagnostics)

    def _save_live_state(self, status: str, final_result: tuple[float, float] | None = None) -> None:
        payload = {
            "run": self.run_name,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "checkpoints": self.visualizer_checkpoints,
            "training_rollouts": self.training_rollouts,
            "vision": {
                "field_of_view_degrees": math.degrees(LeaperReachEnv.VISION_FOV),
                "sector_count": LeaperReachEnv.RAY_COUNT,
                "samples_per_sector": LeaperReachEnv.VISION_SAMPLES_PER_SECTOR,
                "max_range": LeaperReachEnv.RAY_MAX_RANGE,
                "collision_aware": True,
            },
        }
        if final_result is not None:
            payload["final_mean_reward"] = final_result[0]
            payload["final_success_rate"] = final_result[1]
        write_live_state(payload)
        (self.artifact_directory / "browser_replay.json").write_text(
            json.dumps(payload), encoding="utf-8"
        )


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


def evaluate_diagnostics(model: PPO, episodes: int = 100) -> dict:
    """Run the fixed-seed deterministic comparison and aggregate diagnostics."""
    env = LeaperReachEnv()
    episode_rows = []
    action_counts = {"forward": 0, "reverse": 0, "stopped": 0}
    throttle_total = 0.0
    absolute_throttle_total = 0.0
    collision_steps = 0
    total_steps = 0

    for episode in range(episodes):
        observation, reset_info = env.reset(seed=10_000 + episode)
        start_distance = float(reset_info["distance"])
        total_reward = 0.0
        reward_terms = {"progress": 0.0, "time": 0.0, "collision": 0.0, "goal": 0.0}
        collision_streak = 0
        longest_collision_streak = 0
        done = False

        while not done:
            action, _ = model.predict(observation, deterministic=True)
            throttle = float(action[0])
            action_counts[classify_throttle(throttle)] += 1
            throttle_total += throttle
            absolute_throttle_total += abs(throttle)
            observation, reward, terminated, truncated, info = env.step(action)
            total_reward += float(reward)
            total_steps += 1
            collided = bool(info["collision"])
            collision_steps += int(collided)
            collision_streak = collision_streak + 1 if collided else 0
            longest_collision_streak = max(longest_collision_streak, collision_streak)
            for term, value in info["reward_terms"].items():
                reward_terms[term] += float(value)
            done = terminated or truncated

        episode_rows.append(
            {
                "success": int(info["is_success"]),
                "timeout": int(not info["is_success"]),
                "steps": int(info["episode_step"]),
                "reward": total_reward,
                "net_target_progress": start_distance - float(info["distance"]),
                "longest_collision_streak": longest_collision_streak,
                "reward_terms": reward_terms,
            }
        )

    env.close()
    denominator = max(total_steps, 1)
    reward_breakdown = {
        term: float(np.mean([row["reward_terms"][term] for row in episode_rows]))
        for term in ("progress", "time", "collision", "goal")
    }
    return {
        "episodes": episodes,
        "seed_start": 10_000,
        "deterministic": True,
        "success_rate": float(np.mean([row["success"] for row in episode_rows])),
        "timeout_rate": float(np.mean([row["timeout"] for row in episode_rows])),
        "mean_reward": float(np.mean([row["reward"] for row in episode_rows])),
        "mean_net_target_progress": float(
            np.mean([row["net_target_progress"] for row in episode_rows])
        ),
        "forward_step_percentage": action_counts["forward"] / denominator,
        "reverse_step_percentage": action_counts["reverse"] / denominator,
        "stopped_step_percentage": action_counts["stopped"] / denominator,
        "mean_signed_throttle": throttle_total / denominator,
        "mean_absolute_throttle": absolute_throttle_total / denominator,
        "collision_step_percentage": collision_steps / denominator,
        "mean_longest_collision_streak": float(
            np.mean([row["longest_collision_streak"] for row in episode_rows])
        ),
        "worst_collision_streak": int(
            max(row["longest_collision_streak"] for row in episode_rows)
        ),
        "average_episode_length": float(np.mean([row["steps"] for row in episode_rows])),
        "reward_breakdown": reward_breakdown,
    }


def summarize_training_episodes(rows: list[dict], limit: int = 100) -> dict:
    """Summarize the latest stochastic on-policy training episodes."""
    selected = rows[-limit:]
    if not selected:
        return {"episodes": 0}
    total_steps = sum(row["steps"] for row in selected)
    weighted_fields = (
        "forward_step_percentage",
        "reverse_step_percentage",
        "stopped_step_percentage",
        "mean_signed_throttle",
        "mean_absolute_throttle",
        "collision_step_percentage",
    )
    summary = {
        "episodes": len(selected),
        "success_rate": float(np.mean([row["success"] for row in selected])),
        "timeout_rate": float(np.mean([row["timeout"] for row in selected])),
        "mean_reward": float(np.mean([row["total_reward"] for row in selected])),
        "mean_net_target_progress": float(
            np.mean([row["net_target_progress"] for row in selected])
        ),
        "average_episode_length": float(np.mean([row["steps"] for row in selected])),
        "mean_longest_collision_streak": float(
            np.mean([row["longest_collision_streak"] for row in selected])
        ),
        "worst_collision_streak": int(max(row["longest_collision_streak"] for row in selected)),
    }
    for field in weighted_fields:
        summary[field] = sum(row[field] * row["steps"] for row in selected) / total_steps
    summary["reward_breakdown"] = {
        "progress": float(np.mean([row["distance_reward"] for row in selected])),
        "time": float(np.mean([row["time_reward"] for row in selected])),
        "collision": float(np.mean([row["collision_reward"] for row in selected])),
        "goal": float(np.mean([row["goal_reward"] for row in selected])),
    }
    return summary


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
                "fallen": False,
                "vision": list(info.get("vision", ())),
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
                    "fallen": info["is_fallen"],
                    "vision": list(info.get("vision", ())),
                }
            )
        recordings.append(
            {
                "episode": episode + 1,
                "reward": total,
                "success": bool(info["is_success"]),
                "path_length": path_length,
                "exploratory": True,
                "obstacles": [list(obstacle) for obstacle in env.obstacles],
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
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--run-name", default="PPO_17_SMOKE")
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=ARTIFACTS_ROOT,
        help="isolated output directory for this run",
    )
    parser.add_argument("--watch", action="store_true", help="animate trained evaluation episodes")
    args = parser.parse_args()
    if args.seed is None:
        args.seed = secrets.randbelow(1_000_000)

    artifact_directory = args.artifact_dir
    if not artifact_directory.is_absolute():
        artifact_directory = ROOT / artifact_directory
    artifact_directory.mkdir(parents=True, exist_ok=True)
    configuration = {
        "run_name": args.run_name,
        "requested_timesteps": args.timesteps,
        "seed": args.seed,
        "parallel_environments": 8,
        "learning_rate": 3e-4,
        "n_steps": 1024,
        "rollout_transitions": 8192,
        "batch_size": 256,
        "n_epochs": 10,
        "gamma": 0.995,
        "gae_lambda": 0.95,
        "entropy_coefficient": 0.01,
        "evaluation_interval": 10_000,
        "action_low": [-1.0, -1.0],
        "action_high": [1.0, 1.0],
        "observation_size": 10 + LeaperReachEnv.RAY_COUNT,
        "ray_count": LeaperReachEnv.RAY_COUNT,
        "ray_max_range": LeaperReachEnv.RAY_MAX_RANGE,
        "vision_field_of_view_degrees": math.degrees(LeaperReachEnv.VISION_FOV),
        "vision_samples_per_sector": LeaperReachEnv.VISION_SAMPLES_PER_SECTOR,
        "vision_collision_aware": True,
    }
    (artifact_directory / "training_config.json").write_text(
        json.dumps(configuration, indent=2), encoding="utf-8"
    )
    write_live_state(
        {
            "run": args.run_name,
            "status": "starting",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "checkpoints": [],
            "training_rollouts": [],
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
        tensorboard_log=str(artifact_directory / "tensorboard"),
        device="auto",
    )
    callback = ProgressCallback(
        run_name=args.run_name,
        artifact_directory=artifact_directory,
        eval_every=10_000,
    )
    model.learn(
        total_timesteps=args.timesteps,
        callback=callback,
        progress_bar=True,
        tb_log_name=args.run_name,
    )
    model.save(artifact_directory / "leaper_ppo")
    callback._save_progress()
    deterministic_evaluation = evaluate_diagnostics(model, episodes=100)
    final_report = {
        "run_name": args.run_name,
        "requested_timesteps": args.timesteps,
        "collected_timesteps": callback.num_timesteps,
        "seed": args.seed,
        "deterministic_evaluation": deterministic_evaluation,
        "latest_stochastic_training_episodes": summarize_training_episodes(
            callback.episode_diagnostics
        ),
    }
    (artifact_directory / "final_evaluation.json").write_text(
        json.dumps(final_report, indent=2), encoding="utf-8"
    )
    callback._save_live_state(
        "complete",
        (
            deterministic_evaluation["mean_reward"],
            deterministic_evaluation["success_rate"],
        ),
    )
    print("Final evaluation:")
    print(json.dumps(final_report, indent=2))
    env.close()
    if args.watch:
        watch(model)


if __name__ == "__main__":
    main()
