"""Shared seeker diagnostics, independent of policy observation width/rewards.

``EpisodeMetrics`` is a passive collector, not a Gym wrapper. Call reset after
the real reset and step before any autoreset; terminal info/pose must belong to
the ending episode. Rates are fractions, not percentages. Detection at spawn is
step zero. Missing conditional means/rates are None, never fabricated zeros.

``evaluate`` accepts an SB3 model (including RecurrentPPO) and a zero-argument
factory for a single Gymnasium environment. It temporarily moves the policy to
CPU, restores its device/mode, and does not train it. Factories must disable
curiosity bonuses/statistics updates and supply any normalization wrappers.
Outputs: <prefix>_summary.json, <prefix>_episodes.json, and
<prefix>_replays.json.gz. Replays include reset plus every transition, observations,
actions, poses, coverage deltas, reward terms and independent ending flags.
"""

from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
import gzip
import inspect
import json
import math
from pathlib import Path

import numpy as np

__all__ = ["EpisodeMetrics", "evaluate"]


def _json(value):
    """Convert numpy values and nonfinite diagnostic values to strict JSON."""
    if isinstance(value, dict):
        return {str(k): _json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_json(v) for v in value]
    if isinstance(value, np.generic):
        return _json(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _attr(env, name, default=None):
    # Walk wrappers explicitly: Gymnasium no longer forwards arbitrary attrs.
    current = env
    while current is not None:
        if name in vars(current):
            return vars(current)[name]
        if hasattr(type(current), name):
            return getattr(current, name)
        current = vars(current).get("env")
    return default


def _position(env, info):
    if "x" in info and "z" in info:
        return np.array([info["x"], info["z"]], dtype=float)
    return np.asarray(_attr(env, "position"), dtype=float).copy()


def _coverage(env, info):
    if "coverage_fraction" in info:
        return float(info["coverage_fraction"])
    method = _attr(env, "coverage_fraction")
    return float(method()) if method else None


class EpisodeMetrics:
    """Constant-memory per-episode collector for evaluation or training.

    Saturation means an action delivered to env at/outside a Box bound (1e-6
    tolerance). SB3 predict already clips actions, so this does NOT measure the
    unobservable pre-clipping Gaussian means. Revisits count cell re-entries,
    using EXPLORATION_CELL_SIZE and floor(world_position / cell_size).
    """

    def reset(self, env, obs, info):
        self.steps = 0
        self.done = False
        self.cap = int(_attr(env, "MAX_STEPS", 1000))
        # Respect outer TimeLimit when it is shorter than the physical env cap.
        outer_cap = _attr(env, "_max_episode_steps")
        if outer_cap is not None:
            self.cap = min(self.cap, int(outer_cap))
        if self.cap <= 0:
            raise ValueError("Episode cap must be positive")
        self.initially_visible = bool(info.get("target_visible", _attr(env, "target_visible", False)))
        detected = bool(info.get("target_ever_seen", _attr(env, "target_ever_seen", self.initially_visible)))
        self.detection_step = 0 if detected or self.initially_visible else None
        self.coverage_initial = _coverage(env, info)
        self.coverage_at_detection = self.coverage_initial if self.detection_step == 0 else None
        self.previous_position = _position(env, info)
        self.cell_size = float(_attr(env, "EXPLORATION_CELL_SIZE", 3.0))
        self.cell = self._cell(self.previous_position)
        self.cells = {self.cell}
        self.revisits = self.cell_transitions = 0
        self.path_length = self.reward = 0.0
        self.collisions = self.streak = self.longest_streak = 0
        self.reward_terms = defaultdict(float)
        self.low = np.asarray(env.action_space.low, dtype=float)
        self.high = np.asarray(env.action_space.high, dtype=float)
        self.saturated_low = np.zeros_like(self.low, dtype=int)
        self.saturated_high = np.zeros_like(self.high, dtype=int)
        self.action_sum = np.zeros_like(self.low)
        self.action_abs_sum = np.zeros_like(self.low)
        self.saturated_steps = 0
        return self

    def _cell(self, position):
        return tuple(np.floor(position / self.cell_size).astype(int))

    def step(self, env, action, reward, terminated, truncated, info):
        """Consume a transition; return a strict JSON-safe row only at its end."""
        if self.done:
            raise RuntimeError("Call reset before collecting another episode")
        self.steps += 1
        self.reward += float(reward)
        position = _position(env, info)
        self.path_length += float(np.linalg.norm(position - self.previous_position))
        self.previous_position = position
        cell = self._cell(position)
        if cell != self.cell:
            self.cell_transitions += 1
            self.revisits += int(cell in self.cells)
            self.cells.add(cell)
            self.cell = cell
        coverage = _coverage(env, info)
        if self.detection_step is None and bool(info.get("target_ever_seen", _attr(env, "target_ever_seen", False)) or info.get("target_visible", False)):
            self.detection_step = self.steps
            self.coverage_at_detection = coverage
        collided = bool(info.get("collision", _attr(env, "last_collision", False)))
        self.collisions += int(collided)
        self.streak = self.streak + 1 if collided else 0
        self.longest_streak = max(self.longest_streak, self.streak)
        action = np.asarray(action, dtype=float).reshape(self.low.shape)
        at_low = action <= self.low + 1e-6
        at_high = action >= self.high - 1e-6
        self.saturated_low += at_low
        self.saturated_high += at_high
        self.saturated_steps += int(np.any(at_low | at_high))
        self.action_sum += action
        self.action_abs_sum += np.abs(action)
        for key, value in info.get("reward_terms", {}).items():
            if isinstance(value, (int, float, np.number)):
                self.reward_terms[key] += float(value)
        if not (terminated or truncated):
            return None
        self.done = True
        success = bool(info.get("is_success", False))
        detected = self.detection_step is not None
        stuck, frozen = bool(info.get("stuck", False)), bool(info.get("frozen", False))
        # Do not collapse simultaneous success/stuck or terminated/truncated flags.
        causes = [name for name, flag in (("stuck", stuck), ("frozen", frozen), ("truncated", truncated)) if flag]
        if not success and not causes:
            causes = ["other_terminal"]
        return _json({
            "steps": self.steps, "episode_cap": self.cap, "reward": self.reward,
            "success": success, "detected": detected,
            "initially_visible": self.initially_visible,
            "terminated": bool(terminated), "truncated": bool(truncated),
            "stuck": stuck, "frozen": frozen,
            "failure_phase": None if success else ("post_detection" if detected else "pre_detection"),
            "failure_causes": [] if success else causes,
            "detection_step": self.detection_step,
            "detection_steps_capped": min(self.detection_step, self.cap) if detected else self.cap,
            "arrival_steps": self.steps if success else None,
            "arrival_steps_capped": min(self.steps, self.cap) if success else self.cap,
            "pursuit_steps_success": self.steps - self.detection_step if success and detected else None,
            "pursuit_steps_capped": (self.steps - self.detection_step if success else self.cap - self.detection_step) if detected else None,
            "coverage_initial": self.coverage_initial,
            "coverage_at_detection": self.coverage_at_detection, "coverage_final": coverage,
            "unique_visited_cells": len(self.cells), "cell_transitions": self.cell_transitions,
            "revisits": self.revisits,
            "revisit_rate": self.revisits / self.cell_transitions if self.cell_transitions else 0.0,
            "collision_steps": self.collisions, "collision_rate": self.collisions / self.steps,
            "longest_collision_streak": self.longest_streak, "path_length": self.path_length,
            "action_saturation_rate": self.saturated_steps / self.steps,
            "action_low_saturation_rate": self.saturated_low / self.steps,
            "action_high_saturation_rate": self.saturated_high / self.steps,
            "mean_action": self.action_sum / self.steps,
            "mean_absolute_action": self.action_abs_sum / self.steps,
            "reward_terms": dict(self.reward_terms),
        })


def _aggregate(rows):
    n = len(rows)
    def mean(key, selected=rows):
        values = [r[key] for r in selected if r[key] is not None]
        return float(np.mean(values)) if values else None
    detected = [r for r in rows if r["detected"]]
    result = {
        "episodes": n, "success_rate": mean("success"), "detection_rate": mean("detected"),
        "detected_episodes": len(detected),
        "success_given_detection": mean("success", detected),
        "failure_counts": {}, "failure_rates": {},
    }
    for phase in ("pre_detection", "post_detection"):
        for cause in ("stuck", "frozen", "truncated", "other_terminal"):
            key = f"{phase}_{cause}"
            count = sum(r["failure_phase"] == phase and cause in r["failure_causes"] for r in rows)
            result["failure_counts"][key] = count
            result["failure_rates"][key] = count / n if n else None
    for key in ("reward", "steps", "detection_step", "detection_steps_capped", "arrival_steps", "arrival_steps_capped", "pursuit_steps_success", "pursuit_steps_capped", "coverage_initial", "coverage_at_detection", "coverage_final", "unique_visited_cells", "cell_transitions", "revisits", "revisit_rate", "collision_rate", "longest_collision_streak", "path_length", "action_saturation_rate"):
        result[f"mean_{key}"] = mean(key)
    result["worst_collision_streak"] = max((r["longest_collision_streak"] for r in rows), default=None)
    total_steps = sum(r["steps"] for r in rows)
    result["pooled_collision_rate"] = sum(r["collision_steps"] for r in rows) / total_steps if total_steps else None
    return result


@contextmanager
def _cpu_policy(model):
    policy = getattr(model, "policy", None)
    if policy is None:
        # Small protocol-compatible test predictors may have no torch policy.
        if str(getattr(model, "device", "cpu")) != "cpu":
            raise ValueError("Non-CPU predictor must expose a movable .policy")
        yield
        return
    device = next(policy.parameters()).device
    training = policy.training
    try:
        policy.to("cpu")
        policy.set_training_mode(False) if hasattr(policy, "set_training_mode") else policy.eval()
        yield
    finally:
        policy.to(device)
        policy.train(training)


def _frame(env, obs, info, **transition):
    position = _position(env, info)
    return _json({
        "observation": obs, "position": position,
        "x": float(position[0]), "z": float(position[1]),
        "yaw": info.get("yaw", _attr(env, "yaw")),
        "vision": info.get("vision", _attr(env, "last_vision")),
        "coverage_new": info.get("coverage_new_cells", []),
        "coverage_fraction": _coverage(env, info),
        "target_visible": bool(info.get("target_visible", False)),
        "target_ever_seen": bool(info.get("target_ever_seen", False)),
        "collision": bool(info.get("collision", False)),
        "is_success": bool(info.get("is_success", False)),
        "stuck": bool(info.get("stuck", False)), "frozen": bool(info.get("frozen", False)),
        "info": info, **transition,
    })


def evaluate(model, env_factory, seeds, output_prefix, record_seeds=()):
    """Evaluate fixed seeds deterministically and return a JSON-safe summary.

    Record seeds must be in seeds. Worst failure is selected independently of
    reward variant: undetected first, then lowest final coverage, then longest
    collision streak, then longest episode; ties use input seed order. All
    episodes have rows; only the seed panel and worst failure retain trajectories.
    Failure rates use all episodes in each stratum as denominator; cause flags
    may overlap. No failures means no worst-failure replay.
    """
    seeds = [int(seed) for seed in seeds]
    record_seeds = {int(seed) for seed in record_seeds}
    if not seeds or len(set(seeds)) != len(seeds):
        raise ValueError("seeds must be nonempty and unique")
    if not record_seeds.issubset(seeds):
        raise ValueError("record_seeds must be a subset of seeds")
    rows, replays = [], {}
    worst_key = worst_replay = None
    parameters = inspect.signature(model.predict).parameters
    recurrent = "state" in parameters and "episode_start" in parameters
    with _cpu_policy(model):
        for seed in seeds:
            env = env_factory()
            try:
                obs, info = env.reset(seed=seed)
                metrics = EpisodeMetrics().reset(env, obs, info)
                replay = {"seed": seed, "labels": [],
                          "target": _json(_attr(env, "target")),
                          "obstacles": _json(_attr(env, "obstacles")),
                          "world_limit": _json(_attr(env, "WORLD_LIMIT")),
                          "coverage_steps": _json(_attr(env, "coverage_steps")),
                          "coverage_centers": _json(_attr(env, "_coverage_centers_flat")),
                          "frames": [_frame(env, obs, info)]}
                state = None
                for step in range(metrics.cap):
                    kwargs = {"deterministic": True}
                    if recurrent:
                        kwargs.update(state=state, episode_start=np.array([step == 0]))
                    action, state = model.predict(obs, **kwargs)
                    obs, reward, terminated, truncated, info = env.step(action)
                    if step + 1 == metrics.cap and not (terminated or truncated):
                        raise RuntimeError("Environment failed to end at its declared episode cap")
                    row = metrics.step(env, action, reward, terminated, truncated, info)
                    replay["frames"].append(_frame(env, obs, info, action=action, reward=reward,
                                                        terminated=bool(terminated), truncated=bool(truncated)))
                    if row is not None:
                        break
                row["seed"] = seed
                rows.append(row)
                if len(rows) % 100 == 0:
                    print(f'Evaluation {output_prefix}: {len(rows)}/{len(seeds)} episodes completed',
                          flush=True)
                replay["metrics"] = row
                if seed in record_seeds:
                    replay["labels"].append("fixed_seed")
                    replays[seed] = replay
                if not row["success"]:
                    coverage = row["coverage_final"]
                    key = (not row["detected"], -(coverage if coverage is not None else 0),
                           row["longest_collision_streak"], row["steps"])
                    if worst_key is None or key > worst_key:
                        worst_key, worst_replay = key, replay
            finally:
                env.close()
    if worst_replay is not None:
        worst_replay["labels"].append("worst_failure")
        replays[worst_replay["seed"]] = worst_replay
    summary = _aggregate(rows)
    summary.update({
        "schema_version": 1, "deterministic": True, "device": "cpu", "seeds": seeds,
        "initially_visible": _aggregate([r for r in rows if r["initially_visible"]]),
        "initially_hidden": _aggregate([r for r in rows if not r["initially_visible"]]),
        "worst_failure_seed": worst_replay["seed"] if worst_replay else None,
        "rate_units": "fraction", "failure_rate_denominator": "all episodes within stratum",
        "saturation_definition": "delivered action at/outside Box bound within 1e-6",
        "worst_failure_order": "undetected, lowest coverage, longest collision streak, longest episode; input order ties",
    })
    prefix = Path(output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    paths = {name: str(prefix.parent / (prefix.name + suffix)) for name, suffix in (
        ("summary", "_summary.json"), ("episodes", "_episodes.json"), ("replays", "_replays.json.gz"))}
    summary["artifacts"] = paths
    summary = _json(summary)
    Path(paths["episodes"]).write_text(json.dumps(rows, indent=2, allow_nan=False), encoding="utf-8")
    with gzip.open(paths["replays"], "wt", encoding="utf-8") as stream:
        json.dump({"schema_version": 1, "episodes": list(replays.values())}, stream, allow_nan=False)
    Path(paths["summary"]).write_text(json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8")
    return summary
