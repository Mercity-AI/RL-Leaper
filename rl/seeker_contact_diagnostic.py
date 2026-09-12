"""Reproduce the saved development-failure contact audit, without training.

From the repository root (PowerShell):
  $env:PYTHONPATH='E:/Leaper/.venv/Lib/site-packages'
  & 'C:/Users/ankud/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m rl.seeker_contact_diagnostic

Reads the campaign's donor_34 and baseline artifacts; never invokes the runner,
changes the benchmark, or enables footprint sensors. Replays only saved failure
seeds, retains their last 100 pre-action poses, and probes nine immediate actions.
Only grid-immobile endpoints get a finer 5x41 immediate-action probe. No escape
sequences are searched. Counterfactuals are diagnostic, never policy inputs.

The original audit used a 28-unit capped forward clearance, independent of the
subsequently proposed six-unit sensor branch. Keep that distinction reproducible.
"""
import argparse
from collections import Counter, deque
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO

from rl.seeker_env import SeekerEnv
from rl.seeker_metrics import EpisodeMetrics

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / "rl_artifacts/seeker_20260909"
ACTIONS = [(t, r) for t in (-1., 0., 1.) for r in (-1., 0., 1.)]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve(env, position, yaw, action):
    """Geometry-only replica, verified against actual step for every donor move."""
    a = np.clip(np.asarray(action, dtype=np.float32), -1, 1)
    turned = (yaw + float(a[1]) * env.TURN_SPEED + math.pi) % (2 * math.pi) - math.pi
    heading = np.array([math.sin(turned), math.cos(turned)], dtype=np.float32)
    candidate = position + heading * env.physical_throttle(float(a[0])) * env.MOVE_SPEED
    part = env._collision_for_pose(candidate, turned)
    if part is None:
        return candidate, turned, part
    resolved = turned if env._collision_for_pose(position, turned) is None else yaw
    heading = np.array([math.sin(resolved), math.cos(resolved)], dtype=np.float32)
    candidate = position + heading * env.physical_throttle(float(a[0])) * env.MOVE_SPEED
    return (candidate if env._collision_for_pose(candidate, resolved) is None else position.copy()), resolved, part


def probes(env, position, yaw):
    results = []
    for action in ACTIONS:
        p, y, part = resolve(env, position, yaw, action)
        results.append(dict(action=action, translation=float(np.linalg.norm(p - position)),
                            rotation=abs((y - yaw + math.pi) % (2 * math.pi) - math.pi),
                            intended_collision=part))
    return results


def margins(env, position, yaw):
    values = []
    for p, radius, part in env._collision_points(position, yaw):
        margin = min(env.WORLD_LIMIT - radius - abs(float(p[0])),
                     env.WORLD_LIMIT - radius - abs(float(p[1])))
        for x, z, r in env.obstacles:
            margin = min(margin, math.hypot(float(p[0]) - x, float(p[1]) - z) - r - radius)
        values.append((margin, part))
    return dict(body=values[0][0], footprint=min(v[0] for v in values), nearest_part=min(values)[1])


def clearance(env, position, yaw, body_only=False):
    """Original audit's fixed-yaw forward contact distance, capped at ray range."""
    direction = np.array([math.sin(yaw), math.cos(yaw)])
    best = env.RAY_MAX_RANGE
    points = list(env._collision_points(position, yaw))
    for point, radius, _ in (points[:1] if body_only else points):
        for axis in range(2):
            if abs(direction[axis]) > 1e-12:
                wall = (env.WORLD_LIMIT - radius) * (1 if direction[axis] > 0 else -1)
                best = min(best, max(0., float((wall - point[axis]) / direction[axis])))
        for x, z, obstacle_radius in env.obstacles:
            delta = np.array([x, z]) - point
            b = float(delta @ direction)
            c = float(delta @ delta) - (obstacle_radius + radius) ** 2
            discriminant = b * b - c
            if c < 0:
                best = 0.
            elif discriminant >= 0 and b >= 0:
                hit = b - math.sqrt(discriminant)
                if hit >= 0:
                    best = min(best, hit)
    return float(best)


def diagnose_episode(model, saved, retained):
    env = SeekerEnv("control")
    try:
        obs, info = env.reset(seed=saved["seed"])
        metrics = EpisodeMetrics().reset(env, obs, info)
        tail, mismatches = deque(maxlen=100), []
        replay_exact = True
        if retained:
            replay_exact = np.array_equal(obs, np.array(retained["frames"][0]["observation"], dtype=np.float32))
        row = None
        for step in range(env.MAX_STEPS):
            position, yaw = env.position.copy(), env.yaw
            action, _ = model.predict(obs, deterministic=True)
            predicted = resolve(env, position, yaw, action)
            previous_obs = obs.copy()
            obs, reward, terminated, truncated, info = env.step(action)
            if (not np.array_equal(predicted[0], env.position) or predicted[1] != env.yaw
                    or predicted[2] != info["collision_part"]):
                mismatches.append(step)
            tail.append(dict(step=step + 1, position=position.tolist(), yaw=yaw,
                             action=action.tolist(), collision_part=info["collision_part"],
                             actual_translation=float(np.linalg.norm(env.position - position)),
                             physical_throttle=env.physical_throttle(float(action[0])),
                             rays_min=float(np.min(previous_obs[10:26])) * env.RAY_MAX_RANGE))
            if retained:
                frame = retained["frames"][step + 1]
                replay_exact = (replay_exact
                    and np.array_equal(obs, np.array(frame["observation"], dtype=np.float32))
                    and np.array_equal(action, np.array(frame["action"], dtype=np.float32))
                    and np.array_equal(env.position, np.array(frame["position"], dtype=np.float32))
                    and env.yaw == frame["yaw"])
            row = metrics.step(env, action, reward, terminated, truncated, info)
            if row is not None:
                break
        if row is None:
            raise RuntimeError(f'Seed {saved["seed"]} failed to terminate at its cap')
        row["seed"] = saved["seed"]
        for frame in tail:
            position = np.array(frame["position"], dtype=np.float32)
            yaw = frame["yaw"]
            options = probes(env, position, yaw)
            frame.update(nine_actions=options,
                         any_translation=any(p["translation"] > 1e-3 for p in options),
                         any_rotation=any(p["rotation"] > 1e-8 for p in options),
                         margins=margins(env, position, yaw),
                         forward_clearance=clearance(env, position, yaw),
                         body_forward_clearance=clearance(env, position, yaw, True))
        final = probes(env, env.position, env.yaw)
        # Independent simulator copies validate pose feasibility. Already-terminal
        # counters/rewards are intentionally irrelevant to these geometry probes.
        for action, option in zip(ACTIONS, final):
            clone = copy.deepcopy(env)
            try:
                position, yaw = clone.position.copy(), clone.yaw
                clone.step(np.array(action, dtype=np.float32))
                translation = float(np.linalg.norm(clone.position - position))
                rotation = abs((clone.yaw - yaw + math.pi) % (2 * math.pi) - math.pi)
                if abs(translation - option["translation"]) >= 1e-8 or abs(rotation - option["rotation"]) >= 1e-8:
                    raise RuntimeError("Geometry probe differs from simulator step")
            finally:
                clone.close()
        translation = any(p["translation"] > 1e-3 for p in final)
        rotation = any(p["rotation"] > 1e-8 for p in final)
        label = "immediate_translation" if translation else "rotation_only" if rotation else "grid_immobile"
        dense = None
        if label == "grid_immobile":
            dense = []
            for throttle in np.linspace(-1, 1, 5):
                for turn in np.linspace(-1, 1, 41):
                    position, yaw, _ = resolve(env, env.position, env.yaw, (throttle, turn))
                    if np.linalg.norm(position - env.position) > 1e-3 or abs(yaw - env.yaw) > 1e-8:
                        dense.append([float(throttle), float(turn)])
        return dict(seed=saved["seed"], saved_outcome=saved, row_exact_match=row == saved,
                    retained_replay_exact_match=bool(replay_exact) if retained else None,
                    geometry_transition_mismatch_steps=mismatches,
                    obstacles=env.obstacles, target=env.target.tolist(),
                    final_pose=dict(position=env.position.tolist(), yaw=env.yaw,
                                    margins=margins(env, env.position, env.yaw)),
                    final_classification=label, final_nine_actions=final,
                    dense_grid_mobile_actions=dense,
                    last100_collision_parts=dict(Counter(f["collision_part"] for f in tail if f["collision_part"])),
                    last100=list(tail))
    finally:
        env.close()


def run(campaign, output):
    torch.set_num_threads(1)
    paths = [campaign / name for name in (
        "baseline_dev_summary.json", "baseline_dev_episodes.json",
        "baseline_dev_replays.json.gz", "donor_34.zip", "protocol.json")]
    paths += [ROOT / name for name in ("rl_environment.py", "rl/seeker_env.py", "rl/seeker_runner.py")]
    original = campaign / "clearance_diagnostic.json"
    if original.exists():
        paths.append(original)
    if output.resolve() in {p.resolve() for p in paths}:
        raise ValueError("Output must not overwrite benchmark inputs or the original diagnostic")
    hashes = {str(p): digest(p) for p in paths}
    rows = json.loads((campaign / "baseline_dev_episodes.json").read_text())
    with gzip.open(campaign / "baseline_dev_replays.json.gz", "rt") as stream:
        retained = json.load(stream)["episodes"]
    failures = [row for row in rows if not row["success"]]
    model = PPO.load(campaign / "donor_34.zip", device="cpu")
    episodes = []
    for index, saved in enumerate(failures):
        replay = next((r for r in retained if r["seed"] == saved["seed"]), None)
        episodes.append(diagnose_episode(model, saved, replay))
        if (index + 1) % 5 == 0:
            print(f"Diagnosed {index + 1}/{len(failures)} saved failures", flush=True)
    frames = [f for e in episodes for f in e["last100"]]
    collisions = [f for f in frames if f["collision_part"]]
    report = dict(diagnostic_only=True, training=False, donor=str(campaign / "donor_34.zip"),
                  script_sha256=digest(Path(__file__)), input_sha256=hashes,
                  torch_threads=torch.get_num_threads(), action_grid=ACTIONS,
                  definitions={
                      "leg-3": "outermost sample at radius 3.24 on ANY of six legs; not leg number three",
                      "physical_failure": "saved stuck or frozen; not proof of entrapment",
                      "grid_immobile": "nine immediate actions cannot move pose; not proof for continuous actions",
                      "finer_grid": "5 throttle x 41 turn values; pose mobility, not eventual escape",
                      "clearance": "original audit uses RAY_MAX_RANGE=28; not the new six-unit sensor",
                      "last100": "up to 100 pre-action poses; full geometry is diagnostic only"},
                  retained_replay_seeds=[r["seed"] for r in retained], episodes=episodes)
    report["counts"] = dict(episodes=len(rows), successes=sum(r["success"] for r in rows),
        discovered=sum(r["detected"] for r in rows), failures=len(failures),
        stuck=sum(r["stuck"] for r in failures), frozen=sum(r["frozen"] for r in failures),
        truncated=sum(r["truncated"] for r in failures),
        final_classifications=dict(Counter(e["final_classification"] for e in episodes)),
        failure_episodes_with_leg_collision_in_last100=sum(
            any(k.startswith("leg") for k in e["last100_collision_parts"]) for e in episodes))
    report["diagnostic_summary"] = dict(last100_steps=len(frames), collision_steps=len(collisions),
        collision_parts=dict(Counter(f["collision_part"] for f in collisions)),
        blocked_steps_with_alternative_translation=sum(f["actual_translation"] <= .001 and f["any_translation"] for f in collisions),
        blocked_collision_steps=sum(f["actual_translation"] <= .001 for f in collisions),
        leg_forward_clearance_under_one_step_but_body_clear=sum(f["forward_clearance"] < .375 and f["body_forward_clearance"] >= .375 for f in collisions),
        grid_immobile_dense_mobile_seeds=[e["seed"] for e in episodes if e["dense_grid_mobile_actions"]])
    report["all_saved_rows_exact"] = all(e["row_exact_match"] for e in episodes)
    report["all_geometry_predictions_exact"] = all(not e["geometry_transition_mismatch_steps"] for e in episodes)
    report["all_retained_failure_replays_exact"] = all(e["retained_replay_exact_match"] is not False for e in episodes)
    report["inputs_unchanged"] = all(digest(Path(p)) == h for p, h in hashes.items())
    if original.exists():
        previous = json.loads(original.read_text())
        # Normalize tuples to JSON arrays before comparing every per-step record.
        report["original_episode_diagnostics_exact"] = json.loads(json.dumps(episodes)) == previous["episodes"]
    passed = all(report[k] for k in ("all_saved_rows_exact", "all_geometry_predictions_exact",
                                    "all_retained_failure_replays_exact", "inputs_unchanged"))
    report["passed"] = passed and report.get("original_episode_diagnostics_exact", True)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(report["counts"], indent=2))
    print(f'Passed: {report["passed"]}; wrote {output}')
    return report["passed"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path, default=CAMPAIGN)
    parser.add_argument("--output", type=Path, help="Separate JSON output; baseline inputs are protected")
    args = parser.parse_args()
    output = args.output or args.campaign / "contact_diagnostic_reproduced.json"
    return 0 if run(args.campaign, output) else 1


if __name__ == "__main__":
    raise SystemExit(main())
