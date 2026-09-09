"""Note-gate ablation: does the exploration note interfere with PURSUIT?

Evaluation only. No training, no reward changes, no change to any saved brain.

Hypothesis (from the frontier-note sweep, PPO_33-35): the always-on exploration
("frontier") note helps SEARCH but competes with the remembered-target direction
during the CHASE, so net success plateaus ~70-72%. This experiment isolates that by
running each saved frontier model on the fixed 100-maze exam (seeds 10000-10099) in
two modes that are IDENTICAL up to the moment the target is first seen:

  A "note_on"    : the real frontier note stays available the whole attempt.
  B "note_gated" : until first sight, identical to A; from the step AFTER first sight
                   onward, the note is replaced with the env's own "nothing left to
                   explore" value [0,0,1,0,0] for the rest of the attempt. Target
                   information (the remembered-target inputs) stays fully available.

Why [0,0,1,0,0] and not all-zeros: that is the exact invalid/"no suggestion" note the
env emits when the arena is fully cleared (rl_environment._frontier_note), so the brain
saw it during training. All-zeros ([0,0,0,0,0]) is out-of-distribution (distance 0 =
"frontier is on top of me") and would confound an "unfamiliar input" effect with the
effect we actually want to measure. Both modes share the same maze and the same
pre-detection trajectory per seed, so the comparison is apples-to-apples.

Metrics per mode: success rate, first-detection rate (a sanity check: must be equal,
since nothing changes before detection), steps-after-detection for reached episodes
(time to finish the chase), and the ending breakdown (reached / stuck / frozen /
timeout).

Usage:
  python eval_note_gate.py            # smoke: PPO_34 s1 + PPO_35 s1 (400 attempts)
  python eval_note_gate.py --full     # all 6 models (1200 attempts)
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent
OUTDIR = ROOT / "rl_artifacts" / "note_gate"
OUTDIR.mkdir(parents=True, exist_ok=True)
SEEDS = list(range(10000, 10100))  # the fixed 100-maze exam

# The env's own invalid/"nothing left to explore" note (see _frontier_note docstring).
NEUTRAL_NOTE = np.array([0.0, 0.0, 1.0, 0.0, 0.0], dtype=np.float32)
NOTE_SLICE = slice(26, 31)  # the 5 frontier-note inputs in a 31-value observation

MODELS = {
    "PPO_34_s1": "rl_artifacts/ppo_34_frontier_seed_250k_s1/leaper_ppo.zip",
    "PPO_34_s2": "rl_artifacts/ppo_34_frontier_seed_250k_s2/leaper_ppo.zip",
    "PPO_34_s3": "rl_artifacts/ppo_34_frontier_seed_250k_s3/leaper_ppo.zip",
    "PPO_35_s1": "rl_artifacts/ppo_35_frontier_seed025_500k_s1/leaper_ppo.zip",
    "PPO_35_s2": "rl_artifacts/ppo_35_frontier_seed025_500k_s2/leaper_ppo.zip",
    "PPO_35_s3": "rl_artifacts/ppo_35_frontier_seed025_500k_s3/leaper_ppo.zip",
}
SMOKE = ["PPO_34_s1", "PPO_35_s1"]


def rollout(model, seed, gate_after_detection):
    """One deterministic episode. If gate_after_detection, replace the note with the
    neutral value on every step AFTER the target has first been seen."""
    env = LeaperReachEnv()
    obs, info = env.reset(seed=seed)
    detected = bool(info.get("target_ever_seen", False))
    first_det = 0 if detected else None
    steps = 0
    ending = "timeout"
    while True:
        query = obs.copy()
        if gate_after_detection and detected:
            query[NOTE_SLICE] = NEUTRAL_NOTE
        action, _ = model.predict(query, deterministic=True)
        obs, _, terminated, truncated, info = env.step(action)
        steps += 1
        if not detected and info.get("target_ever_seen"):
            detected = True
            first_det = steps
        if terminated or truncated:
            if info["is_success"]:
                ending = "reached"
            elif info.get("stuck"):
                ending = "stuck"
            elif info.get("frozen"):
                ending = "frozen"
            else:
                ending = "timeout"
            break
    env.close()
    success = bool(info["is_success"])
    return {
        "seed": seed,
        "success": success,
        "detected": first_det is not None,
        "first_detection_step": first_det,
        "steps": steps,
        # chase length: steps from first sight to the end (only meaningful if detected)
        "steps_after_detection": (steps - first_det) if first_det is not None else None,
        "ending": ending,
    }


def summarize(rows):
    n = len(rows)
    endings = {"reached": 0, "stuck": 0, "frozen": 0, "timeout": 0}
    for r in rows:
        endings[r["ending"]] += 1
    reached = [r for r in rows if r["success"] and r["steps_after_detection"] is not None]
    chase = [r["steps_after_detection"] for r in reached]
    return {
        "episodes": n,
        "success_rate": sum(r["success"] for r in rows) / n,
        "first_detection_rate": sum(r["detected"] for r in rows) / n,
        "endings": endings,
        "chase_steps_after_detection": {
            "n_reached": len(chase),
            "mean": float(np.mean(chase)) if chase else None,
            "median": float(np.median(chase)) if chase else None,
        },
    }


def run(model_keys):
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    LeaperReachEnv.FRONTIER_NOTE = True
    report = {}
    grand_start = time.perf_counter()
    for key in model_keys:
        model = PPO.load(ROOT / MODELS[key], device="cpu")
        t0 = time.perf_counter()
        on = [rollout(model, s, gate_after_detection=False) for s in SEEDS]
        gated = [rollout(model, s, gate_after_detection=True) for s in SEEDS]
        dt = time.perf_counter() - t0
        son, sg = summarize(on), summarize(gated)
        report[key] = {
            "seconds": round(dt, 1),
            "note_on": son,
            "note_gated": sg,
            "success_delta_gated_minus_on": sg["success_rate"] - son["success_rate"],
            "episodes_on": on,
            "episodes_gated": gated,
        }
        con = son["chase_steps_after_detection"]["median"]
        cg = sg["chase_steps_after_detection"]["median"]
        print(
            f"{key}: success  on {son['success_rate']:.0%} -> gated {sg['success_rate']:.0%} "
            f"({sg['success_rate']-son['success_rate']:+.0%})  |  "
            f"first-det on {son['first_detection_rate']:.0%} / gated {sg['first_detection_rate']:.0%} "
            f"(must match)  |  median chase steps {con}->{cg}  |  "
            f"endings on {son['endings']} gated {sg['endings']}  |  {dt:.1f}s",
            flush=True,
        )
    total = time.perf_counter() - grand_start

    # pooled across all models run (each attempt weighted equally)
    def pool(field):
        rows = [r for k in model_keys for r in report[k][field]]
        return summarize(rows)

    pooled_on, pooled_gated = pool("episodes_on"), pool("episodes_gated")
    report["_pooled"] = {
        "models": model_keys,
        "note_on": pooled_on,
        "note_gated": pooled_gated,
        "success_delta_gated_minus_on": pooled_gated["success_rate"] - pooled_on["success_rate"],
        "total_seconds": round(total, 1),
        "attempts": len(model_keys) * len(SEEDS) * 2,
    }
    print(
        f"\nPOOLED ({len(model_keys)} models, {len(model_keys)*len(SEEDS)*2} attempts): "
        f"success on {pooled_on['success_rate']:.1%} -> gated {pooled_gated['success_rate']:.1%} "
        f"({pooled_gated['success_rate']-pooled_on['success_rate']:+.1%})  |  total {total:.1f}s "
        f"({total/(len(model_keys)*len(SEEDS)*2)*1000:.0f} ms/attempt)",
        flush=True,
    )
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="run all 6 models (default: 2-model smoke)")
    args = ap.parse_args()
    keys = list(MODELS) if args.full else SMOKE
    tag = "full" if args.full else "smoke"
    report = run(keys)
    out = OUTDIR / f"note_gate_{tag}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
