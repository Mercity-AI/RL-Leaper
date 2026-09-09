"""Generate a compact JSON replay dataset for the standalone HTML viewer.

Runs PPO_33 s1 (the frontier model) deterministically on a few telling exam mazes
and records everything the viewer needs: pose, vision, cleared-map deltas, the
frontier destination the note selects, obstacles, and the hidden target (for display
only). Frames are rounded to keep the embedded payload small.
"""

import json
import math
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "rl_artifacts/ppo_33_frontier_250k_s1/leaper_ppo.zip"
OUT = ROOT / "rl_artifacts/phase1b_diagnostics/viewer_data.json"

# curated exam mazes: a reach, a search-miss, a behind-rock miss, a pursuit case
SEEDS = [10013, 10007, 10014, 10001]
LABELS = {
    10013: "Reaches the target",
    10007: "Never gets near it (search miss)",
    10014: "Target hides behind a rock",
    10001: "Clean success",
}


def r2(v):
    return round(float(v), 2)


def main():
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    LeaperReachEnv.FRONTIER_NOTE = True
    model = PPO.load(MODEL, device="cpu")
    episodes = []
    for seed in SEEDS:
        env = LeaperReachEnv()
        obs, info = env.reset(seed=seed)
        steps = env.coverage_steps
        frames = [{
            "x": r2(env.position[0]), "z": r2(env.position[1]), "yaw": r2(env.yaw),
            "vision": [r2(v) for v in info.get("vision", [])],
            "cov": list(info.get("coverage_new_cells", [])),
            "ft": [r2(env._frontier_target[0]), r2(env._frontier_target[1]), env._frontier_valid]
                  if env._frontier_target else None,
            "seen": bool(info.get("target_visible")),
            "ever": bool(info.get("target_ever_seen")),
        }]
        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, term, trunc, info = env.step(action)
            frames.append({
                "x": r2(info["x"]), "z": r2(info["z"]), "yaw": r2(info["yaw"]),
                "vision": [r2(v) for v in info.get("vision", [])],
                "cov": list(info.get("coverage_new_cells", [])),
                "ft": [r2(env._frontier_target[0]), r2(env._frontier_target[1]), env._frontier_valid]
                      if env._frontier_target else None,
                "seen": bool(info.get("target_visible")),
                "ever": bool(info.get("target_ever_seen")),
            })
            done = term or trunc
        # subsample every 2nd frame to shrink (keep first + last)
        sub = frames[::2]
        if sub[-1] is not frames[-1]:
            sub.append(frames[-1])
        episodes.append({
            "seed": seed,
            "label": LABELS[seed],
            "success": bool(info["is_success"]),
            "detected": bool(info.get("target_ever_seen")),
            "steps": len(frames) - 1,
            "obstacles": [[r2(o[0]), r2(o[1]), r2(o[2])] for o in env.obstacles],
            "target": [r2(env.target[0]), r2(env.target[1])],
            "world_limit": env.WORLD_LIMIT,
            "coverage_steps": steps,
            "coverage_cell": env.COVERAGE_CELL_SIZE,
            "ray_count": env.RAY_COUNT,
            "ray_max_range": env.RAY_MAX_RANGE,
            "vision_fov_deg": math.degrees(env.VISION_FOV),
            "frames": sub,
        })
        env.close()
    OUT.write_text(json.dumps(episodes, separators=(",", ":")), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT}  ({kb:.0f} KB, {len(episodes)} episodes)")


if __name__ == "__main__":
    main()
