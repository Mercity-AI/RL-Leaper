"""Phase 1B failure plots: PPO_29 vs PPO_33_s1 on identical mazes.

Draws cleared map (from PPO_33), obstacles, hidden target, both robots' paths, and
PPO_33's selected frontier destinations (grey dots) so we can SEE whether Leaper
follows the note. Hidden target is plotted for the human only; never a policy input.
"""

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rl_artifacts" / "phase1b_diagnostics"
PPO29 = ROOT / "rl_artifacts/ppo_29_normalized_throttle_250k/leaper_ppo.zip"
PPO33 = ROOT / "rl_artifacts/ppo_33_frontier_250k_s1/leaper_ppo.zip"


def rollout(model, seed, frontier):
    env = LeaperReachEnv()
    obs, info = env.reset(seed=seed)
    xs, zs, ftrail = [float(env.position[0])], [float(env.position[1])], []
    ever_within = bool(info.get("target_ever_seen"))
    done = False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        if frontier and env._frontier_target is not None:
            ftrail.append(tuple(env._frontier_target))
        obs, _, term, trunc, info = env.step(action)
        xs.append(info["x"]); zs.append(info["z"])
        d = float(np.linalg.norm(env.target - env.position))
        ever_within = ever_within or (d - env.TARGET_RADIUS <= env.RAY_MAX_RANGE)
        done = term or trunc
    return dict(xs=xs, zs=zs, ftrail=ftrail, grid=env.coverage_cleared.copy(),
                steps=env.coverage_steps, cell=env.COVERAGE_CELL_SIZE, limit=env.WORLD_LIMIT,
                obstacles=env.obstacles, target=env.target.tolist(),
                success=bool(info["is_success"]), detected=bool(info.get("target_ever_seen")),
                ever_within=ever_within)


def draw(ax, r33, r29, title):
    steps, cell, limit = r33["steps"], r33["cell"], r33["limit"]
    ax.set_facecolor("#12141a")
    ax.set_xlim(-limit, limit); ax.set_ylim(-limit, limit); ax.set_aspect("equal")
    for ix in range(steps):
        cx = -limit + (ix + 0.5) * cell
        for iz in range(steps):
            cz = -limit + (iz + 0.5) * cell
            on = r33["grid"][ix * steps + iz]
            ax.add_patch(plt.Rectangle((cx - cell / 2, cz - cell / 2), cell * 0.96, cell * 0.96,
                         color="#2f7d4f" if on else "#b5651d", alpha=0.5 if on else 0.35, linewidth=0))
    for ox, oz, rr in r33["obstacles"]:
        ax.add_patch(Circle((ox, oz), rr, color="#5b606b", zorder=3))
    # frontier destinations PPO_33 selected (subsampled)
    if r33["ftrail"]:
        ft = np.array(r33["ftrail"])[::15]
        ax.scatter(ft[:, 0], ft[:, 1], s=18, color="#39d0ff", alpha=0.6, zorder=4, label="frontier picks (PPO_33)")
    ax.plot(r29["xs"], r29["zs"], color="#9aa0aa", lw=1.4, alpha=0.9, zorder=5, label=f"PPO_29 {'✓' if r29['success'] else '✗'}")
    ax.plot(r33["xs"], r33["zs"], color="#ff8b3d", lw=1.7, alpha=0.95, zorder=6, label=f"PPO_33 {'✓' if r33['success'] else '✗'}")
    ax.scatter([r33["xs"][0]], [r33["zs"][0]], color="#fff", s=40, zorder=7)
    tx, tz = r33["target"]
    ax.add_patch(plt.Rectangle((tx - 1.3, tz - 1.3), 2.6, 2.6, color="#ff4fa3", zorder=8))
    ax.set_title(title, color="#e6e8ee", fontsize=10)
    ax.legend(loc="upper right", fontsize=7, facecolor="#1b1e26", labelcolor="#e6e8ee")
    ax.tick_params(colors="#8a8f99")


def main():
    import json
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    ep = json.load(open(OUT / "phase1b_episodes.json"))
    s1 = {r["seed"]: r for r in ep["PPO_33_s1"]}

    # auto-pick representative seeds
    win = 10013           # PPO_33 reached, PPO_29 did not
    loss = 10032          # PPO_29 reached, PPO_33 did not
    never = next(r["seed"] for r in ep["PPO_33_s1"]
                 if r["outcome"] == "never_detected" and not r["ever_within_range"])
    occl = next((r["seed"] for r in ep["PPO_33_s1"]
                 if r["outcome"] == "never_detected" and r["ever_occluded_shot"]), never)

    m29 = PPO.load(PPO29, device="cpu")
    LeaperReachEnv.FRONTIER_NOTE = True
    m33 = PPO.load(PPO33, device="cpu")

    panels = [
        (win, f"WIN seed {win}: PPO_33 reaches, PPO_29 misses"),
        (loss, f"LOSS seed {loss}: PPO_29 reaches, PPO_33 misses"),
        (never, f"NEVER-DETECTED seed {never}: target never within 28u (search miss)"),
        (occl, f"NEVER-DETECTED seed {occl}: target seen-range but behind a rock"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(14, 14))
    axes = axes.ravel()
    for ax, (seed, title) in zip(axes, panels):
        LeaperReachEnv.FRONTIER_NOTE = False
        r29 = rollout(m29, seed, frontier=False)
        LeaperReachEnv.FRONTIER_NOTE = True
        r33 = rollout(m33, seed, frontier=True)
        draw(ax, r33, r29, title)

    fig.suptitle("Phase 1B failures — green=checked, amber=unchecked, grey rocks, pink target, "
                 "cyan=PPO_33 frontier picks", color="#e6e8ee", fontsize=12)
    fig.patch.set_facecolor("#0b0d12")
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    out = OUT / "phase1b_failures.png"
    fig.savefig(out, dpi=120, facecolor="#0b0d12")
    print(f"wrote {out}  (seeds: win={win} loss={loss} never={never} occl={occl})")


if __name__ == "__main__":
    main()
