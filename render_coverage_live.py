"""Replay the PPO_32 model on exam mazes and render checked ground vs blindspots.

Unlike render_coverage.py (which reads the 5 fixed replay episodes, all successes),
this replays the trained model on the deterministic exam seeds (10000+) so we can
show a NEVER-DETECTED timeout (big amber blindspots = why it lost) next to a clean
success. Colors: green = checked, amber = unchecked/blindspot, grey = obstacle
(its rear amber wedge is the rock-shadow), orange = path, pink = hidden target.
"""

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, RegularPolygon
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent
RUN = ROOT / "rl_artifacts" / "ppo_32_cleared_map_250k_s3"


def rollout(model, seed):
    env = LeaperReachEnv()
    obs, info = env.reset(seed=seed)
    xs, zs = [float(env.position[0])], [float(env.position[1])]
    ever_seen = False
    done = False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, _, term, trunc, info = env.step(action)
        xs.append(info["x"]); zs.append(info["z"])
        ever_seen = ever_seen or info["target_ever_seen"]
        done = term or trunc
    grid = env.coverage_cleared.copy()
    result = dict(
        steps=env.coverage_steps, cell=env.COVERAGE_CELL_SIZE, limit=env.WORLD_LIMIT,
        grid=grid, obstacles=env.obstacles, target=env.target.tolist(),
        xs=xs, zs=zs, yaw=float(env.yaw),
        success=bool(info["is_success"]), ever_seen=ever_seen, checked=float(grid.mean()),
    )
    env.close()
    return result


def draw(ax, r, title):
    steps, cell, limit = r["steps"], r["cell"], r["limit"]
    ax.set_facecolor("#12141a")
    ax.set_xlim(-limit, limit); ax.set_ylim(-limit, limit); ax.set_aspect("equal")
    for ix in range(steps):
        cx = -limit + (ix + 0.5) * cell
        for iz in range(steps):
            cz = -limit + (iz + 0.5) * cell
            on = r["grid"][ix * steps + iz]
            ax.add_patch(plt.Rectangle(
                (cx - cell / 2, cz - cell / 2), cell * 0.96, cell * 0.96,
                color="#2f7d4f" if on else "#b5651d", alpha=0.55 if on else 0.40, linewidth=0))
    for ox, oz, rad in r["obstacles"]:
        ax.add_patch(Circle((ox, oz), rad, color="#5b606b", zorder=3))
    ax.plot(r["xs"], r["zs"], color="#ff8b3d", linewidth=1.6, alpha=0.9, zorder=4)
    ax.scatter([r["xs"][0]], [r["zs"][0]], color="#ffffff", s=45, zorder=5)
    ax.add_patch(RegularPolygon((r["xs"][-1], r["zs"][-1]), numVertices=3, radius=1.4,
                                orientation=-r["yaw"], color="#ff4a26", zorder=6))
    tx, tz = r["target"]
    ax.add_patch(plt.Rectangle((tx - 1.2, tz - 1.2), 2.4, 2.4, color="#ff4fa3", zorder=5))
    ax.set_title(title, color="#e6e8ee", fontsize=11)
    ax.tick_params(colors="#8a8f99")


def main():
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    LeaperReachEnv.COVERAGE_MAP = True
    model = PPO.load(RUN / "leaper_ppo.zip", device="cpu")

    lost = success = None
    for seed in range(10000, 10100):
        r = rollout(model, seed)
        if lost is None and not r["ever_seen"]:
            lost = (seed, r)
        if success is None and r["success"]:
            success = (seed, r)
        if lost and success:
            break

    fig, axes = plt.subplots(1, 2, figsize=(14, 7))
    s_seed, s_r = success
    l_seed, l_r = lost
    draw(axes[0], s_r,
         f"SUCCESS (exam seed {s_seed}) — reached target · {100*s_r['checked']:.0f}% checked")
    draw(axes[1], l_r,
         f"LOST / NEVER DETECTED (seed {l_seed}) — timed out · {100*l_r['checked']:.0f}% checked\n"
         f"amber = blindspots it never searched (incl. rock-shadows), so it never saw the pink target")
    fig.suptitle("PPO_32 (s3) cleared map — green = checked ground · amber = blindspots / unchecked",
                 color="#e6e8ee", fontsize=13)
    fig.patch.set_facecolor("#0b0d12")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    out = ROOT / "rl_artifacts" / "ppo_32_coverage_success_vs_lost.png"
    fig.savefig(out, dpi=130, facecolor="#0b0d12")
    print(f"wrote {out}  (success seed {s_seed}, lost seed {l_seed})")


if __name__ == "__main__":
    main()
