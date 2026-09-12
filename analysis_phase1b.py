"""Phase 1B failure inspection: PPO_29 baseline vs the three PPO_33 frontier models.

Follows the PDF's Phase-1 instruction: before designing PPO_34, look at WHY episodes
fail. Runs every model on the SAME 100 fixed exam mazes (seeds 10000-10099) under
identical env settings, splits outcomes (never-detected / detected-but-failed /
reached), and for the never-detected cases answers the PDF's question directly: was
the target ever within 28 units, and if so was it behind a rock or just never faced?

Also (a) the frontier-note ablation (zero the 5 note inputs, keep the 26 unchanged)
and a same-state action-divergence probe, and (b) frontier-usage metrics (does she
move toward the note, does the note keep switching, does she revisit cleared ground).

Hidden target info is used ONLY for evaluation/plots, never as policy input. No
training, no reward changes. Writes JSON to rl_artifacts/phase1b_diagnostics/.
"""

import json
import math
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rl_artifacts" / "phase1b_diagnostics"
OUT.mkdir(parents=True, exist_ok=True)

MODELS = {
    "PPO_29": ("rl_artifacts/ppo_29_normalized_throttle_250k/leaper_ppo.zip", False),
    "PPO_33_s1": ("rl_artifacts/ppo_33_frontier_250k_s1/leaper_ppo.zip", True),
    "PPO_33_s2": ("rl_artifacts/ppo_33_frontier_250k_s2/leaper_ppo.zip", True),
    "PPO_33_s3": ("rl_artifacts/ppo_33_frontier_250k_s3/leaper_ppo.zip", True),
}
SEEDS = list(range(10000, 10100))
POS_CELL = LeaperReachEnv.EXPLORATION_CELL_SIZE


def target_geometry(env):
    """Eval-only: is the target within range / in FOV / occluded, this step?"""
    delta = env.target.astype(np.float64) - env.position.astype(np.float64)
    dist = float(np.linalg.norm(delta))
    within_range = (dist - env.TARGET_RADIUS) <= env.RAY_MAX_RANGE
    world_bearing = math.atan2(float(delta[0]), float(delta[1]))
    rel = (world_bearing - env.yaw + math.pi) % (2 * math.pi) - math.pi
    in_fov = abs(rel) <= env.VISION_FOV / 2.0
    visible, _ = env._target_sensor()
    occluded_shot = within_range and in_fov and not visible
    return dist, within_range, in_fov, occluded_shot


def rollout(model, seed, frontier, zero_note=False, probe_divergence=False):
    env = LeaperReachEnv()
    obs, info = env.reset(seed=seed)
    detected = bool(info.get("target_ever_seen", False))
    first_det = 0 if detected else None
    steps = 0
    ever_within_range = detected
    ever_in_range_and_fov = False
    ever_occluded_shot = False
    min_dist = info["distance"]
    # frontier usage
    align_sum = 0.0
    align_n = 0
    switches = 0
    prev_frontier = None
    visited = set()
    revisits = 0
    moved_steps = 0
    # same-state action divergence
    div_sum = np.zeros(2)
    div_n = 0

    prev_pos = env.position.copy()
    done = False
    while not done:
        query = obs.copy()
        if zero_note:
            query[26:31] = 0.0
        action, _ = model.predict(query, deterministic=True)
        if probe_divergence and frontier:
            alt = obs.copy()
            alt[26:31] = 0.0
            alt_action, _ = model.predict(alt, deterministic=True)
            div_sum += np.abs(np.asarray(action, float) - np.asarray(alt_action, float))
            div_n += 1
        # frontier the policy is currently pointed at (before stepping)
        ft = env._frontier_target if frontier else None
        obs, _, term, trunc, info = env.step(action)
        steps += 1
        moved = float(np.linalg.norm(env.position - prev_pos))
        dist, within_range, in_fov, occluded_shot = target_geometry(env)
        min_dist = min(min_dist, dist)
        ever_within_range = ever_within_range or within_range
        ever_in_range_and_fov = ever_in_range_and_fov or (within_range and in_fov)
        ever_occluded_shot = ever_occluded_shot or occluded_shot
        if first_det is None and info.get("target_ever_seen"):
            first_det = steps
        # frontier-usage metrics (search phase only, before detection)
        if frontier and first_det is None and ft is not None and moved > 1e-3:
            to_f = np.array(ft) - prev_pos
            nf = np.linalg.norm(to_f)
            mv = env.position - prev_pos
            nm = np.linalg.norm(mv)
            if nf > 1e-6 and nm > 1e-6:
                align_sum += float(np.dot(to_f, mv) / (nf * nm))
                align_n += 1
            if prev_frontier is not None and np.linalg.norm(np.array(ft) - np.array(prev_frontier)) > 6.0:
                switches += 1
            prev_frontier = ft
        if moved > 1e-3:
            moved_steps += 1
            pcell = (int(math.floor(env.position[0] / POS_CELL)), int(math.floor(env.position[1] / POS_CELL)))
            if pcell in visited:
                revisits += 1
            visited.add(pcell)
        prev_pos = env.position.copy()
        done = term or trunc

    success = bool(info["is_success"])
    if success:
        outcome = "reached"
    elif first_det is not None:
        outcome = "detected_but_failed"
    else:
        outcome = "never_detected"
    return {
        "seed": seed,
        "outcome": outcome,
        "success": success,
        "detected": first_det is not None,
        "first_detection_step": first_det,
        "steps": steps,
        "min_target_distance": min_dist,
        "ever_within_range": bool(ever_within_range),
        "ever_in_range_and_fov": bool(ever_in_range_and_fov),
        "ever_occluded_shot": bool(ever_occluded_shot),
        "cleared_final": env.coverage_fraction(),
        "align_mean": (align_sum / align_n) if align_n else None,
        "frontier_switches": switches,
        "revisit_fraction": (revisits / moved_steps) if moved_steps else 0.0,
        "action_divergence_mean": (div_sum / div_n).tolist() if div_n else None,
    }


def summarize(rows):
    n = len(rows)
    cats = {"never_detected": 0, "detected_but_failed": 0, "reached": 0}
    for r in rows:
        cats[r["outcome"]] += 1
    nd = [r for r in rows if r["outcome"] == "never_detected"]
    return {
        "episodes": n,
        "success_rate": sum(r["success"] for r in rows) / n,
        "first_detection_rate": sum(r["detected"] for r in rows) / n,
        "outcome_counts": cats,
        "never_detected_breakdown": {
            "never_within_28u": sum(1 for r in nd if not r["ever_within_range"]),
            "within_28u_never_faced": sum(1 for r in nd if r["ever_within_range"] and not r["ever_in_range_and_fov"]),
            "within_28u_and_faced_but_occluded_or_missed": sum(1 for r in nd if r["ever_in_range_and_fov"]),
            "of_those_had_occluded_shot": sum(1 for r in nd if r["ever_occluded_shot"]),
        },
    }


def main():
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    all_rows = {}
    ablation = {}

    # config-difference check: mazes must be identical per seed regardless of flag
    LeaperReachEnv.FRONTIER_NOTE = False
    e0 = LeaperReachEnv(); e0.reset(seed=10007)
    LeaperReachEnv.FRONTIER_NOTE = True
    e1 = LeaperReachEnv(); e1.reset(seed=10007)
    maze_identical = bool(np.allclose(e0.target, e1.target) and e0.obstacles == e1.obstacles)
    e0.close(); e1.close()

    for name, (path, frontier) in MODELS.items():
        LeaperReachEnv.FRONTIER_NOTE = frontier
        model = PPO.load(ROOT / path, device="cpu")
        rows = [rollout(model, s, frontier, probe_divergence=frontier) for s in SEEDS]
        all_rows[name] = rows
        summ = summarize(rows)
        print(f"\n=== {name} (obs={'31' if frontier else '26'}) ===")
        print(json.dumps(summ, indent=2))

        if frontier:
            # ablation: zero the 5 note inputs, keep 26 unchanged
            zrows = [rollout(model, s, frontier, zero_note=True) for s in SEEDS]
            zsumm = summarize(zrows)
            divs = [r["action_divergence_mean"] for r in rows if r["action_divergence_mean"]]
            mean_div = np.mean(divs, axis=0).tolist() if divs else None
            ablation[name] = {
                "normal": {"success": summ["success_rate"], "first_detection": summ["first_detection_rate"]},
                "note_zeroed": {"success": zsumm["success_rate"], "first_detection": zsumm["first_detection_rate"]},
                "same_state_action_divergence_[throttle,turn]": mean_div,
            }
            print(f"  ABLATION note-zeroed: success {zsumm['success_rate']:.0%} "
                  f"(normal {summ['success_rate']:.0%}), first-det {zsumm['first_detection_rate']:.0%} "
                  f"(normal {summ['first_detection_rate']:.0%}); same-state action div {np.round(mean_div,4)}")

    # PPO_33_s1 vs PPO_29 win/loss by seed
    base = {r["seed"]: r for r in all_rows["PPO_29"]}
    s1 = {r["seed"]: r for r in all_rows["PPO_33_s1"]}
    wins = [s for s in SEEDS if s1[s]["success"] and not base[s]["success"]]
    losses = [s for s in SEEDS if base[s]["success"] and not s1[s]["success"]]

    report = {
        "seeds": [SEEDS[0], SEEDS[-1]],
        "maze_identical_across_flag": maze_identical,
        "config_note": "Only difference: PPO_33 obs=31 (adds 5 frontier-note inputs 26-30); "
                       "PPO_29 obs=26. Env physics/target/obstacles/normalized-throttle identical per seed.",
        "summaries": {name: summarize(rows) for name, rows in all_rows.items()},
        "ablation": ablation,
        "ppo33_s1_vs_ppo29": {
            "s1_wins_base_loses": wins,
            "base_wins_s1_loses": losses,
        },
    }
    (OUT / "phase1b_summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # per-episode rows for the plotting step
    (OUT / "phase1b_episodes.json").write_text(json.dumps(all_rows, indent=2), encoding="utf-8")
    print(f"\nmaze identical across flag: {maze_identical}")
    print(f"PPO_33_s1 wins where PPO_29 loses: {wins}")
    print(f"PPO_29 wins where PPO_33_s1 loses: {losses}")
    print(f"\nwrote {OUT/'phase1b_summary.json'}")


if __name__ == "__main__":
    main()
