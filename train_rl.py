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
from sb3_contrib import RecurrentPPO
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_checker import check_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv

from rl_environment import LeaperReachEnv


LIVE_STATE = ROOT / "public" / "rl_live_state.json"
MAX_TRAINING_ROLLOUTS = 3
THROTTLE_EPSILON = 1e-8
REWARD_TERMS = ("progress", "exploration", "sight", "time", "collision", "goal")


def empty_reward_terms() -> dict[str, float]:
    return {term: 0.0 for term in REWARD_TERMS}


def widen_policy_state_dict(donor_state: dict, destination_state: dict) -> dict:
    """Copy a donor policy state dict into a (possibly wider) destination.

    PPO_32 widens the 26-input PPO_29 MlpPolicy into a 42-input MlpPolicy: the two
    first-layer weight matrices (``mlp_extractor.policy_net.0.weight`` and
    ``mlp_extractor.value_net.0.weight``) gain 16 extra input columns for the
    appended cleared-map summary. Every other parameter -- later layers, biases, the
    action head, the value head, and ``log_std`` -- is shape-identical and copied
    exactly. Donor columns land in destination columns 0..25 (the frozen legacy
    channels) and the new columns 26..41 are explicitly ZEROED, so a freshly widened
    model reproduces the donor's outputs when the appended inputs are zero.

    Fails loudly on any parameter the destination has that the donor lacks, any
    leftover donor parameter, and any shape mismatch that is not a pure input-column
    widening (same rows, more columns). Returns a new state dict ready for
    ``load_state_dict(..., strict=True)``.
    """
    import torch

    widened: dict = {}
    for name, dest_param in destination_state.items():
        if name not in donor_state:
            raise ValueError(
                f"warm-transfer: destination parameter '{name}' is missing from the "
                f"donor model; refusing to guess it."
            )
        donor_param = donor_state[name]
        if tuple(donor_param.shape) == tuple(dest_param.shape):
            widened[name] = donor_param.clone()
            continue
        # The only legitimate mismatch is a first-layer weight gaining input columns.
        is_input_widening = (
            dest_param.ndim == 2
            and donor_param.ndim == 2
            and dest_param.shape[0] == donor_param.shape[0]
            and dest_param.shape[1] > donor_param.shape[1]
        )
        if not is_input_widening:
            raise ValueError(
                f"warm-transfer: unexpected shape change for '{name}': donor "
                f"{tuple(donor_param.shape)} -> destination {tuple(dest_param.shape)}. "
                f"Only first-layer input widening (same rows, more columns) is allowed."
            )
        new_weight = torch.zeros_like(dest_param)  # columns 26..41 stay zero
        donor_columns = donor_param.shape[1]
        new_weight[:, :donor_columns] = donor_param  # legacy columns 0..25
        widened[name] = new_weight
    leftover = set(donor_state) - set(destination_state)
    if leftover:
        raise ValueError(
            f"warm-transfer: donor has parameters absent from the destination: "
            f"{sorted(leftover)}; refusing to silently drop them."
        )
    return widened


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
            "reward_terms": empty_reward_terms(),
        }

    @staticmethod
    def _frame_from_episode_start(info: dict, observation: np.ndarray) -> dict:
        return {
            "x": info["previous_x"],
            "z": info["previous_z"],
            "yaw": info["previous_yaw"],
            "distance": info["previous_distance"],
            "collision": False,
            "collision_part": None,
            "forward_action": float(observation[8]),
            "turn_action": float(observation[9]),
            "vision": [
                float(value)
                for value in observation[10 : 10 + LeaperReachEnv.RAY_COUNT]
            ],
            "target_visible": bool(observation[0]),
            "target_ever_seen": bool(info.get("target_ever_seen", False)),
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
            "target_visible": bool(info.get("target_visible", False)),
            "target_ever_seen": bool(info.get("target_ever_seen", False)),
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
            "reward_terms": empty_reward_terms(),
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
            throttle = LeaperReachEnv.physical_throttle(float(action[0]))
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
                    "target": list(info.get("target", ())),
                    "world_limit": LeaperReachEnv.WORLD_LIMIT,
                    "frames": [self._frame_from_episode_start(info, observations[worker])],
                }
                self.current_segments[worker] = segment
                self.current_rollout_workers[worker]["episodes"].append(segment)

            self.current_segments[worker]["frames"].append(
                self._frame_from_step(info, action, reward)
            )
            self.current_segments[worker]["reward"] += reward

            if accumulator["start_distance"] is None:
                accumulator["start_distance"] = info["previous_distance"]
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
                        "exploration_reward": terms["exploration"],
                        "sight_reward": terms["sight"],
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
            # PPO_32: first-detection + body-health snapshot at every checkpoint
            # (25 exam episodes). Recorded into the checkpoint payload and printed
            # with warning thresholds; never auto-changes the run.
            health = detection_diagnostics(self.model, episodes=25)
            self.visualizer_checkpoints[-1]["detection"] = health
            self._save_progress()
            self._save_live_state("training")
            if self.verbose:
                print(
                    f"\nEvaluation at {self.num_timesteps:,} steps: "
                    f"mean reward={mean_reward:.2f}, success={success_rate:.0%}"
                )
                print_body_health(health, f"checkpoint {self.num_timesteps:,}")
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
                "ray_count": LeaperReachEnv.RAY_COUNT,
                "max_range": LeaperReachEnv.RAY_MAX_RANGE,
                "type": "thin_ray_rangefinder",
                "forward_only_throttle": True,
            },
        }
        if final_result is not None:
            payload["final_mean_reward"] = final_result[0]
            payload["final_success_rate"] = final_result[1]
        write_live_state(payload)
        (self.artifact_directory / "browser_replay.json").write_text(
            json.dumps(payload), encoding="utf-8"
        )


def predict_with_memory(model, observation, memory, episode_start, deterministic):
    """Predict one action while carrying the recurrent LSTM "notepad" forward.

    ``memory`` is the LSTM hidden state (``None`` at the very first step of an
    episode). ``episode_start`` must be True on the first step of each maze so the
    memory is wiped clean before a fresh episode, then False for every step after.
    Returns the chosen action and the updated memory to pass into the next step.
    """
    action, memory = model.predict(
        observation,
        state=memory,
        episode_start=np.array([bool(episode_start)]),
        deterministic=deterministic,
    )
    return action, memory


def evaluate(model: RecurrentPPO, episodes: int = 25) -> tuple[float, float]:
    env = LeaperReachEnv()
    rewards, successes = [], 0
    for episode in range(episodes):
        observation, _ = env.reset(seed=10_000 + episode)
        total = 0.0
        done = False
        memory = None
        episode_start = True
        while not done:
            action, memory = predict_with_memory(
                model, observation, memory, episode_start, deterministic=True
            )
            episode_start = False
            observation, reward, terminated, truncated, info = env.step(action)
            total += reward
            done = terminated or truncated
        rewards.append(total)
        successes += int(info["is_success"])
    env.close()
    return float(np.mean(rewards)), successes / episodes


def evaluate_diagnostics(model: RecurrentPPO, episodes: int = 100) -> dict:
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
        reward_terms = empty_reward_terms()
        collision_streak = 0
        longest_collision_streak = 0
        done = False
        memory = None
        episode_start = True

        while not done:
            action, memory = predict_with_memory(
                model, observation, memory, episode_start, deterministic=True
            )
            episode_start = False
            throttle = LeaperReachEnv.physical_throttle(float(action[0]))
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
        for term in REWARD_TERMS
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


# PPO_32 body-health warning thresholds. Breaching these does not change the
# experiment automatically; it flags that the walker may have degraded and the run
# should be stopped for diagnosis (see the task spec / TRAINING.md).
HEALTH_COLLISION_MAX = 0.06        # collision steps should stay below 6%
HEALTH_STOPPED_MAX = 0.10          # stopped steps should stay below 10%
HEALTH_SUCCESS_AFTER_SIGHT_MIN = 0.90  # success after first sight should stay above 90%


def detection_diagnostics(
    model: RecurrentPPO,
    episodes: int = 100,
    seed_start: int = 10_000,
) -> dict:
    """Deterministic first-detection / search diagnostics on the fixed-seed exam.

    Answers the PPO_32 question directly: does the agent FIND the hidden target, and
    when it does, does it finish? Reported for both the coverage model and the
    PPO_29 baseline (the cleared grid is maintained internally regardless of whether
    the summary is fed to the policy, so "fraction cleared before detection" is
    always available).

    Never-detected handling: time-to-first-detection statistics are computed over
    DETECTED episodes only (a never-detected episode has no detection time); the
    never-detected count and rate are reported separately so the mean is not
    silently polluted by a sentinel.
    """
    env = LeaperReachEnv()
    rows: list[dict] = []
    for episode in range(episodes):
        observation, reset_info = env.reset(seed=seed_start + episode)
        detected = bool(reset_info.get("target_ever_seen", False))
        first_detection_step = 0 if detected else None
        cleared_at_detection = (
            float(reset_info.get("coverage_fraction", 0.0)) if detected else None
        )
        done = False
        memory = None
        episode_start = True
        step_index = 0
        collision_steps = 0
        stopped_steps = 0
        while not done:
            action, memory = predict_with_memory(
                model, observation, memory, episode_start, deterministic=True
            )
            episode_start = False
            throttle = LeaperReachEnv.physical_throttle(float(action[0]))
            if classify_throttle(throttle) == "stopped":
                stopped_steps += 1
            observation, _, terminated, truncated, info = env.step(action)
            step_index += 1
            if bool(info["collision"]):
                collision_steps += 1
            if first_detection_step is None and bool(info.get("target_ever_seen")):
                first_detection_step = step_index
                cleared_at_detection = float(info.get("coverage_fraction", 0.0))
            done = terminated or truncated
        rows.append(
            {
                "success": bool(info["is_success"]),
                "detected": first_detection_step is not None,
                "first_detection_step": first_detection_step,
                "cleared_at_detection": cleared_at_detection,
                "cleared_final": float(info.get("coverage_fraction", 0.0)),
                "steps": step_index,
                "collision_fraction": collision_steps / max(step_index, 1),
                "stopped_fraction": stopped_steps / max(step_index, 1),
            }
        )
    env.close()

    detected_rows = [row for row in rows if row["detected"]]
    detection_steps = [row["first_detection_step"] for row in detected_rows]
    never = len(rows) - len(detected_rows)
    detected_and_succeeded = sum(1 for row in detected_rows if row["success"])
    detected_but_failed = len(detected_rows) - detected_and_succeeded
    n = max(len(rows), 1)
    return {
        "episodes": len(rows),
        "seed_start": seed_start,
        "success_rate": float(np.mean([row["success"] for row in rows])),
        "first_detection_rate": len(detected_rows) / n,
        "mean_time_to_first_detection": (
            float(np.mean(detection_steps)) if detection_steps else None
        ),
        "median_time_to_first_detection": (
            float(np.median(detection_steps)) if detection_steps else None
        ),
        "time_to_first_detection_note": (
            "mean/median over detected episodes only; never-detected episodes "
            "excluded (they have no detection time)"
        ),
        "success_given_detection": (
            detected_and_succeeded / len(detected_rows) if detected_rows else None
        ),
        "mean_cleared_fraction_before_detection": (
            float(np.mean([row["cleared_at_detection"] for row in detected_rows]))
            if detected_rows
            else None
        ),
        "mean_cleared_fraction_final": float(
            np.mean([row["cleared_final"] for row in rows])
        ),
        "outcome_split": {
            "never_detected": never,
            "detected_but_failed": detected_but_failed,
            "detected_and_succeeded": detected_and_succeeded,
        },
        "outcome_split_rate": {
            "never_detected": never / n,
            "detected_but_failed": detected_but_failed / n,
            "detected_and_succeeded": detected_and_succeeded / n,
        },
        "collision_step_percentage": float(
            np.mean([row["collision_fraction"] for row in rows])
        ),
        "stopped_step_percentage": float(
            np.mean([row["stopped_fraction"] for row in rows])
        ),
    }


def print_body_health(diagnostics: dict, label: str) -> None:
    """Print the walker body-health line and flag any breached warning threshold.

    Does NOT change the run -- breaches are recorded for a human to decide whether
    the walker has degraded enough to stop and diagnose (per the task spec).
    """
    collision = diagnostics["collision_step_percentage"]
    stopped = diagnostics["stopped_step_percentage"]
    success_after_sight = diagnostics.get("success_given_detection")
    print(
        f"  Body-health ({label}): collision steps {collision:.1%} "
        f"(<{HEALTH_COLLISION_MAX:.0%}), stopped steps {stopped:.1%} "
        f"(<{HEALTH_STOPPED_MAX:.0%}), success-after-first-sight "
        f"{('n/a' if success_after_sight is None else f'{success_after_sight:.1%}')} "
        f"(>{HEALTH_SUCCESS_AFTER_SIGHT_MIN:.0%}), first-detection "
        f"{diagnostics['first_detection_rate']:.1%}"
    )
    warnings = []
    if collision >= HEALTH_COLLISION_MAX:
        warnings.append(f"collision steps {collision:.1%} >= {HEALTH_COLLISION_MAX:.0%}")
    if stopped >= HEALTH_STOPPED_MAX:
        warnings.append(f"stopped steps {stopped:.1%} >= {HEALTH_STOPPED_MAX:.0%}")
    if success_after_sight is not None and success_after_sight <= HEALTH_SUCCESS_AFTER_SIGHT_MIN:
        warnings.append(
            f"success-after-sight {success_after_sight:.1%} <= {HEALTH_SUCCESS_AFTER_SIGHT_MIN:.0%}"
        )
    if warnings:
        print(
            "  ⚠ BODY-HEALTH WARNING (recorded, run not auto-changed): "
            + "; ".join(warnings)
        )


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
        "exploration": float(np.mean([row["exploration_reward"] for row in selected])),
        "sight": float(np.mean([row["sight_reward"] for row in selected])),
        "time": float(np.mean([row["time_reward"] for row in selected])),
        "collision": float(np.mean([row["collision_reward"] for row in selected])),
        "goal": float(np.mean([row["goal_reward"] for row in selected])),
    }
    return summary


def evaluate_with_recordings(
    model: RecurrentPPO,
    episodes: int = 25,
    record_episodes: int = 5,
) -> tuple[float, float, list[dict]]:
    """Score and record deterministic checkpoint replays for the visualizer."""
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
                "target_visible": bool(info.get("target_visible", False)),
                "target_ever_seen": bool(info.get("target_ever_seen", False)),
                # PPO_32: cells cleared this frame (flat grid indices). The viewer
                # accumulates these to draw cleared-vs-unchecked ground. The reset
                # pose's clearing lands on the first frame.
                "coverage_new": list(info.get("coverage_new_cells", ())),
                # PPO_33 / Phase 1B: the world point the global frontier note selects
                # (x, z, valid) so the viewer/analysis can show where it points.
                "frontier": (
                    [env._frontier_target[0], env._frontier_target[1], env._frontier_valid]
                    if env._frontier_target is not None
                    else None
                ),
            }
        ]
        memory = None
        episode_start = True
        while not done:
            action, memory = predict_with_memory(
                model, observation, memory, episode_start, deterministic=True
            )
            episode_start = False
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
                    "target_visible": bool(info.get("target_visible", False)),
                    "target_ever_seen": bool(info.get("target_ever_seen", False)),
                    "coverage_new": list(info.get("coverage_new_cells", ())),
                    "frontier": (
                        [env._frontier_target[0], env._frontier_target[1], env._frontier_valid]
                        if env._frontier_target is not None
                        else None
                    ),
                }
            )
        recordings.append(
            {
                "episode": episode + 1,
                "reward": total,
                "success": bool(info["is_success"]),
                "path_length": path_length,
                "exploratory": False,
                "deterministic": True,
                "obstacles": [list(obstacle) for obstacle in env.obstacles],
                "target": env.target.tolist(),
                "world_limit": LeaperReachEnv.WORLD_LIMIT,
                # PPO_32 cleared-map geometry for the viewer overlay: a square grid
                # of COVERAGE_CELL_SIZE cells spanning [-world_limit, world_limit].
                "coverage_steps": int(env.coverage_steps),
                "coverage_cell": float(LeaperReachEnv.COVERAGE_CELL_SIZE),
                "coverage_map": bool(LeaperReachEnv.COVERAGE_MAP),
                "frontier_note": bool(LeaperReachEnv.FRONTIER_NOTE),
                "frames": frames,
            }
        )
    env.close()
    recordings.sort(key=lambda recording: recording["path_length"], reverse=True)
    return mean_reward, success_rate, recordings


def watch(model: RecurrentPPO, episodes: int = 5) -> None:
    env = LeaperReachEnv(render_mode="human")
    for episode in range(episodes):
        observation, _ = env.reset()
        done = False
        memory = None
        episode_start = True
        while not done:
            action, memory = predict_with_memory(
                model, observation, memory, episode_start, deterministic=True
            )
            episode_start = False
            observation, _, terminated, truncated, _ = env.step(action)
            done = terminated or truncated
    env.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timesteps", type=int, default=500_000)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument(
        "--ray-count",
        type=int,
        default=LeaperReachEnv.RAY_COUNT,
        help="number of vision rays in the forward cone (PPO_18 baseline = 8, PPO_23 = 16)",
    )
    parser.add_argument(
        "--ray-max-range",
        type=float,
        default=LeaperReachEnv.RAY_MAX_RANGE,
        help="how far each vision ray can see, in world units (PPO_18 baseline = 28.0)",
    )
    parser.add_argument(
        "--idle-penalty",
        type=float,
        default=LeaperReachEnv.IDLE_PENALTY,
        help="per-step reward tax for sustained standing still, once idle longer "
        "than --idle-grace steps (PPO_24 anti-dither default = 0.04; 0 disables)",
    )
    parser.add_argument(
        "--idle-grace",
        type=int,
        default=LeaperReachEnv.IDLE_GRACE,
        help="consecutive near-stationary steps allowed free before the idle tax "
        "begins, so a brief pivot-in-place is not punished (default = 3)",
    )
    parser.add_argument(
        "--net-arch",
        default="64,64",
        help="hidden-layer sizes for the policy/value network, comma-separated "
        "(PPO_18 champion = 64,64; PPO_22 wider = 256,256). Ignored for --memory "
        "lstm, which uses the recurrent policy's own default heads.",
    )
    parser.add_argument(
        "--memory",
        choices=["none", "lstm"],
        default="none",
        help="brain type: 'none' = plain MLP (PPO_18-29 champion line), 'lstm' = "
        "recurrent memory brain (a running scratchpad carried between steps, so "
        "the policy can remember where it has already searched). The LSTM line "
        "(PPO_19-21) lost to memoryless on the still-target-with-known-direction "
        "task; revived here for the hidden-target SEARCH problem where memory of "
        "covered ground finally has a real job. Trains fresh (no warm-start).",
    )
    parser.add_argument(
        "--lstm-hidden-size",
        type=int,
        default=256,
        help="size of the LSTM scratchpad when --memory lstm (PPO_19-21 used 256)",
    )
    parser.add_argument(
        "--lstm-layers",
        type=int,
        default=1,
        help="number of stacked LSTM layers when --memory lstm (default 1). "
        "PPO_31 tries 2 for more memory capacity; more layers = more capacity but "
        "harder to keep stable, so drop back to 1 if training wobbles.",
    )
    parser.add_argument(
        "--normalized-throttle",
        action="store_true",
        help="PPO_29: policy throttle output is [-1,1] mapped to forward-only "
        "physical throttle (action+1)/2, so -1=stop, 0=half, +1=full. Fixes the "
        "PPO_28 clip-to-zero freeze. Off by default (plain forward-only [0,1]).",
    )
    parser.add_argument(
        "--coverage-map",
        action="store_true",
        help="PPO_32: append 16 egocentric cleared-map summary values to the "
        "observation (indices 26-41), widening it 26->42. The legacy channels 0-25 "
        "are untouched. Use with --warm-transfer to widen a PPO_29 26-input donor "
        "into the 42-input model (donor columns copied, new columns zeroed).",
    )
    parser.add_argument(
        "--seed-frontier-from-target",
        type=float,
        default=0.0,
        help="PPO_34: instead of ZEROING the two frontier-direction weight columns "
        "(obs 26-27) at warm-transfer, seed them with this scale times the donor's "
        "learned target-direction columns (obs 2-3), in BOTH actor and critic first "
        "layers. 0.0 (default) = PPO_33 behaviour (zeroed). 0.5 = the frontier "
        "direction starts wired like a half-strength 'target to walk toward', so the "
        "note is behaviorally active from step 0 instead of an ignored dead input. "
        "Requires --frontier-note + --warm-transfer. When the note inputs are zero "
        "the model still reproduces the donor (weights only touch new columns).",
    )
    parser.add_argument(
        "--frontier-note",
        action="store_true",
        help="PPO_33 / Phase 1B: append a 5-value GLOBAL frontier note to the "
        "observation (indices 26-30), widening it 26->31: relative x/z direction to "
        "the nearest frontier cell of the largest substantial unchecked region, its "
        "distance (/diagonal), region size, and a valid flag. Replaces PPO_32's 16 "
        "local coverage rays. Legacy channels 0-25 are untouched. Use with "
        "--warm-transfer to widen a PPO_29 26-input donor (donor columns copied, new "
        "columns zeroed). Honest: uses only the internal cleared grid, never the "
        "target or obstacle positions.",
    )
    parser.add_argument(
        "--freeze-limit",
        type=int,
        default=LeaperReachEnv.FREEZE_LIMIT,
        help="PPO_29: consecutive no-translation steps before a terminal freeze "
        "failure (default = 60; still allows three 180-degree scanning turns)",
    )
    parser.add_argument(
        "--freeze-penalty",
        type=float,
        default=LeaperReachEnv.FREEZE_PENALTY,
        help="PPO_29: one-time penalty applied when the freeze rule ends an "
        "episode (default = 10.0; 0 disables the consequence)",
    )
    parser.add_argument(
        "--scan-reward",
        type=float,
        default=LeaperReachEnv.SCAN_REWARD,
        help="PPO_29: small reward for facing each new heading before first sight, "
        "capped at one revolution per episode (default = 0.01; 0 disables)",
    )
    parser.add_argument(
        "--exploration-reward",
        type=float,
        default=LeaperReachEnv.EXPLORATION_REWARD,
        help="reward for entering a never-visited grid cell while the target is "
        "still unseen (default = 0.01; PPO_31 raises to 0.05 so covering fresh "
        "ground is clearly worthwhile; switches off once the target is seen)",
    )
    parser.add_argument(
        "--new-view-reward",
        type=float,
        default=LeaperReachEnv.NEW_VIEW_REWARD,
        help="reward for opening up a genuinely new view while still searching "
        "(default = 0.002; PPO_31 raises to 0.01; off once the target is seen)",
    )
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--run-name", default="PPO_28_SLOW_SEEKER")
    parser.add_argument(
        "--warm-start",
        type=Path,
        default=None,
        help="optional compatible PPO model used to seed the next run",
    )
    parser.add_argument(
        "--warm-transfer",
        type=Path,
        default=None,
        help="PPO_29: copy policy/value weights from this model into a freshly "
        "built model (fresh optimizer). Use instead of --warm-start when the "
        "action bounds changed (e.g. transferring PPO_28's [0,1] brain into a "
        "normalized [-1,1] model), which SB3's loader would reject.",
    )
    parser.add_argument(
        "--reset-warm-start-target-inputs",
        action="store_true",
        help="zero first-layer columns 0-1 when transferring a pre-seeker model "
        "whose channels were absolute x/z; omit for PPO_27 and newer seekers",
    )
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

    # Vision geometry is a class constant read by every env constructed in this
    # process (training envs plus the evaluation/replay envs), so overriding it
    # here keeps the whole run internally consistent while letting each launch
    # pick its own eyes. PPO_23 raises ray count 8 -> 16; PPO_18 reruns keep 8.
    LeaperReachEnv.RAY_COUNT = args.ray_count
    LeaperReachEnv.RAY_MAX_RANGE = args.ray_max_range
    LeaperReachEnv.IDLE_PENALTY = args.idle_penalty
    LeaperReachEnv.IDLE_GRACE = args.idle_grace
    # PPO_29 throttle normalization + freeze/scan tuning. Set before any env is
    # built so training, evaluation, and replay envs in this process all agree.
    LeaperReachEnv.NORMALIZED_THROTTLE = args.normalized_throttle
    LeaperReachEnv.COVERAGE_MAP = args.coverage_map
    LeaperReachEnv.FRONTIER_NOTE = args.frontier_note
    LeaperReachEnv.FREEZE_LIMIT = args.freeze_limit
    LeaperReachEnv.FREEZE_PENALTY = args.freeze_penalty
    LeaperReachEnv.SCAN_REWARD = args.scan_reward
    LeaperReachEnv.EXPLORATION_REWARD = args.exploration_reward
    LeaperReachEnv.NEW_VIEW_REWARD = args.new_view_reward
    net_arch = [int(size) for size in args.net_arch.split(",") if size.strip()]
    # PPO_31: recurrent brains overfit each rollout faster and thrash, so take
    # fewer gradient passes per batch than the plain-MLP line (steadier updates,
    # learning rate left untouched). More LSTM layers make this matter more.
    n_epochs = 5 if args.memory == "lstm" else 10

    artifact_directory = args.artifact_dir
    if not artifact_directory.is_absolute():
        artifact_directory = ROOT / artifact_directory
    artifact_directory.mkdir(parents=True, exist_ok=True)
    configuration = {
        "run_name": args.run_name,
        "requested_timesteps": args.timesteps,
        "seed": args.seed,
        "parallel_environments": 8,
        "learning_rate": args.learning_rate,
        "n_steps": 1024,
        "rollout_transitions": 8192,
        "batch_size": 256,
        "n_epochs": n_epochs,
        "gamma": 0.995,
        "gae_lambda": 0.95,
        "entropy_coefficient": 0.01,
        "evaluation_interval": 10_000,
        "action_low": [-1.0 if args.normalized_throttle else 0.0, -1.0],
        "action_high": [1.0, 1.0],
        "normalized_throttle": args.normalized_throttle,
        "freeze_limit": LeaperReachEnv.FREEZE_LIMIT,
        "freeze_penalty": LeaperReachEnv.FREEZE_PENALTY,
        "scan_reward": LeaperReachEnv.SCAN_REWARD,
        "exploration_reward": LeaperReachEnv.EXPLORATION_REWARD,
        "new_view_reward": LeaperReachEnv.NEW_VIEW_REWARD,
        "observation_size": LeaperReachEnv.observation_size(),
        "coverage_map": LeaperReachEnv.COVERAGE_MAP,
        "coverage_summary_count": LeaperReachEnv.RAY_COUNT if LeaperReachEnv.COVERAGE_MAP else 0,
        "coverage_cell_size": LeaperReachEnv.COVERAGE_CELL_SIZE,
        "frontier_note": LeaperReachEnv.FRONTIER_NOTE,
        "frontier_note_size": LeaperReachEnv.FRONTIER_NOTE_SIZE if LeaperReachEnv.FRONTIER_NOTE else 0,
        "frontier_min_region_cells": LeaperReachEnv.FRONTIER_MIN_REGION_CELLS,
        "seed_frontier_from_target": args.seed_frontier_from_target,
        "ray_count": LeaperReachEnv.RAY_COUNT,
        "ray_max_range": LeaperReachEnv.RAY_MAX_RANGE,
        "idle_penalty": LeaperReachEnv.IDLE_PENALTY,
        "idle_grace": LeaperReachEnv.IDLE_GRACE,
        "idle_definition": "no translation and no newly observed position/heading",
        "vision_field_of_view_degrees": math.degrees(LeaperReachEnv.VISION_FOV),
        "vision_type": "thin_ray_rangefinder_plus_occluded_tagged_target",
        "target_randomized_each_episode": True,
        "target_memory_steps": LeaperReachEnv.TARGET_MEMORY_STEPS,
        "move_speed": LeaperReachEnv.MOVE_SPEED,
        "turn_speed_degrees": math.degrees(LeaperReachEnv.TURN_SPEED),
        "max_episode_steps": LeaperReachEnv.MAX_STEPS,
        "world_limit": LeaperReachEnv.WORLD_LIMIT,
        "obstacle_count": LeaperReachEnv.NUM_OBSTACLES,
        "reward_terms": list(REWARD_TERMS),
        "forward_only_throttle": True,
        "policy": "MlpLstmPolicy" if args.memory == "lstm" else "MlpPolicy",
        "memory": args.memory,
        "lstm_hidden_size": args.lstm_hidden_size if args.memory == "lstm" else None,
        "lstm_layers": args.lstm_layers if args.memory == "lstm" else None,
        "net_arch": net_arch,
        "warm_start": str(args.warm_start) if args.warm_start else None,
        "warm_transfer": str(args.warm_transfer) if args.warm_transfer else None,
        "reset_warm_start_target_inputs": args.reset_warm_start_target_inputs,
        "visualizer_replays": "deterministic_only",
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
    # Memoryless PPO_18-family champion brain: plain MlpPolicy (no LSTM). The
    # network width (--net-arch) and vision (--ray-count / --ray-max-range) are
    # CLI-selectable so each run picks its own: PPO_18 rerun = 64,64 + 8 rays;
    # PPO_22 = 256,256 + 8 rays (a wash); PPO_23 = 64,64 + 16 rays. The
    # recurrent-memory line (PPO_19-21) was abandoned; see TRAINING.md.
    if args.memory == "lstm":
        # Recurrent memory brain (revived PPO_19-21 line). Trains fresh: the LSTM's
        # weights have no correspondence to a plain-MLP donor, so warm-start/transfer
        # is rejected. It still inherits every PPO_29 ENV change (normalized throttle,
        # freeze rule, scan nudge) because those live in the environment, not the brain.
        if args.warm_start or args.warm_transfer:
            raise SystemExit(
                "--memory lstm cannot warm-start/transfer from an MLP model "
                "(incompatible architecture); train the recurrent brain fresh."
            )
        model = RecurrentPPO(
            "MlpLstmPolicy",
            env,
            learning_rate=args.learning_rate,
            n_steps=1024,
            batch_size=256,
            n_epochs=n_epochs,
            gamma=0.995,
            gae_lambda=0.95,
            ent_coef=0.01,
            policy_kwargs=dict(
                lstm_hidden_size=args.lstm_hidden_size,
                n_lstm_layers=args.lstm_layers,
            ),
            verbose=1,
            seed=args.seed,
            tensorboard_log=str(artifact_directory / "tensorboard"),
            device="auto",
        )
        print(
            "Built fresh recurrent memory brain (MlpLstmPolicy, "
            f"lstm_hidden_size={args.lstm_hidden_size}, "
            f"n_lstm_layers={args.lstm_layers}, n_epochs={n_epochs})."
        )
    elif args.warm_transfer:
        # PPO_29: the action bounds changed ([0,1] -> [-1,1]), so SB3's loader
        # would reject re-attaching the donor to this env. Instead build a fresh
        # model with the new action space and copy the donor's weights (policy +
        # value nets and log_std, all shape-identical since the observation size
        # and action dimension are unchanged). The fresh model already has a clean
        # optimizer, satisfying the "reset optimizer state" requirement.
        transfer_path = args.warm_transfer
        if not transfer_path.is_absolute():
            transfer_path = ROOT / transfer_path
        donor = PPO.load(transfer_path, device="auto")  # no env -> skips space check
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=args.learning_rate,
            n_steps=1024,
            batch_size=256,
            n_epochs=n_epochs,
            gamma=0.995,
            gae_lambda=0.95,
            ent_coef=0.01,
            policy_kwargs=dict(net_arch=net_arch),
            verbose=1,
            seed=args.seed,
            tensorboard_log=str(artifact_directory / "tensorboard"),
            device="auto",
        )
        widened_state = widen_policy_state_dict(
            donor.policy.state_dict(), model.policy.state_dict()
        )
        donor_input = donor.policy.state_dict()["mlp_extractor.policy_net.0.weight"].shape[1]
        model.policy.load_state_dict(widened_state, strict=True)
        del donor
        dest_input = LeaperReachEnv.observation_size()
        widened_note = (
            f"widened {donor_input}->{dest_input} inputs "
            f"(new columns {donor_input}-{dest_input - 1} zeroed), "
            if dest_input != donor_input
            else ""
        )
        seed_note = ""
        if args.seed_frontier_from_target > 0.0:
            # PPO_34: give the frontier-direction inputs (obs 26-27) the donor's
            # learned "walk toward the target" wiring at reduced strength, so the
            # note is active from step 0 instead of a dead zeroed input. The target
            # direction lives at obs columns 2-3; the frontier direction at 26-27.
            # Only the new columns are touched, so a zero note still reproduces the
            # donor exactly. Applied to actor and critic first layers alike.
            if not (LeaperReachEnv.FRONTIER_NOTE and dest_input != donor_input):
                raise SystemExit(
                    "--seed-frontier-from-target requires --frontier-note and a "
                    "widening warm-transfer (26->31)."
                )
            import torch

            scale = args.seed_frontier_from_target
            with torch.no_grad():
                for network in (
                    model.policy.mlp_extractor.policy_net,
                    model.policy.mlp_extractor.value_net,
                ):
                    first_linear = next(
                        layer for layer in network if hasattr(layer, "weight")
                    )
                    first_linear.weight[:, 26] = scale * first_linear.weight[:, 2]
                    first_linear.weight[:, 27] = scale * first_linear.weight[:, 3]
            seed_note = (
                f" Seeded frontier-direction columns 26-27 = {scale} x "
                "target-direction columns 2-3 (actor+critic)."
            )
        print(
            f"Warm-transferred weights from {transfer_path} into a fresh "
            f"model ({widened_note}fresh optimizer).{seed_note}"
        )
    elif args.warm_start:
        warm_start = args.warm_start
        if not warm_start.is_absolute():
            warm_start = ROOT / warm_start
        model = PPO.load(
            warm_start,
            env=env,
            device="auto",
            custom_objects={
                "learning_rate": args.learning_rate,
                "lr_schedule": lambda _: args.learning_rate,
            },
        )
        model.tensorboard_log = str(artifact_directory / "tensorboard")
        model.verbose = 1
        model.set_random_seed(args.seed)
        if args.reset_warm_start_target_inputs:
            # PPO_25 channels 0-1 were absolute x/z; seeker channels 0-1 are
            # target-visible and memory age. PPO_27+ already shares the new
            # meanings, so its inputs must be preserved.
            for network in (
                model.policy.mlp_extractor.policy_net,
                model.policy.mlp_extractor.value_net,
            ):
                first_linear = next(layer for layer in network if hasattr(layer, "weight"))
                first_linear.weight.data[:, :2].zero_()
        # Adam's saved moments belong to the old fully-informed objective. Keep
        # the useful navigation weights, but let this task build fresh optimizer
        # statistics instead of receiving stale momentum from PPO_25.
        model.policy.optimizer.state.clear()
        input_note = "reset input columns 0-1 and " if args.reset_warm_start_target_inputs else "preserved all input columns and "
        print(f"Warm-started seeker from {warm_start}; {input_note}reset optimizer state.")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=args.learning_rate,
            n_steps=1024,
            batch_size=256,
            n_epochs=n_epochs,
            gamma=0.995,
            gae_lambda=0.95,
            ent_coef=0.01,
            policy_kwargs=dict(net_arch=net_arch),
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
    detection_evaluation = detection_diagnostics(model, episodes=100)
    final_report = {
        "run_name": args.run_name,
        "requested_timesteps": args.timesteps,
        "collected_timesteps": callback.num_timesteps,
        "seed": args.seed,
        "coverage_map": LeaperReachEnv.COVERAGE_MAP,
        "frontier_note": LeaperReachEnv.FRONTIER_NOTE,
        "observation_size": LeaperReachEnv.observation_size(),
        "deterministic_evaluation": deterministic_evaluation,
        "detection_diagnostics": detection_evaluation,
        "latest_stochastic_training_episodes": summarize_training_episodes(
            callback.episode_diagnostics
        ),
    }
    (artifact_directory / "final_evaluation.json").write_text(
        json.dumps(final_report, indent=2), encoding="utf-8"
    )
    print_body_health(detection_evaluation, "final 100-maze exam")
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
