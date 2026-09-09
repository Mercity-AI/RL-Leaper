"""Proof: on exam seed 10007 the global frontier note points at the large
bottom-right unchecked region (the region PPO_32's local rays could not chase).

Left: spawn pose. Right: a naive "follow the note" controller (turn toward the note
direction, drive forward) for 120 steps -- purely to visualize that the note steers
Leaper INTO the big region, not the trained policy. Arrow = note direction; yellow
star = the frontier cell the note selected; pink square = hidden target (drawn for
the human only; the note never used it).
"""

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle

from rl_environment import LeaperReachEnv

ROOT = Path(__file__).resolve().parent


def draw(ax, env, note, title):
    steps, cell, limit = env.coverage_steps, env.COVERAGE_CELL_SIZE, env.WORLD_LIMIT
    ax.set_facecolor("#12141a")
    ax.set_xlim(-limit, limit); ax.set_ylim(-limit, limit); ax.set_aspect("equal")
    for ix in range(steps):
        cx = -limit + (ix + 0.5) * cell
        for iz in range(steps):
            cz = -limit + (iz + 0.5) * cell
            on = env.coverage_cleared[ix * steps + iz]
            ax.add_patch(plt.Rectangle(
                (cx - cell / 2, cz - cell / 2), cell * 0.96, cell * 0.96,
                color="#2f7d4f" if on else "#b5651d", alpha=0.55 if on else 0.40, linewidth=0))
    for ox, oz, r in env.obstacles:
        ax.add_patch(Circle((ox, oz), r, color="#5b606b", zorder=3))
    px, pz = float(env.position[0]), float(env.position[1])
    ax.scatter([px], [pz], color="#ffffff", s=60, zorder=6)
    tx, tz = env.target
    ax.add_patch(plt.Rectangle((tx - 1.2, tz - 1.2), 2.4, 2.4, color="#ff4fa3", zorder=5))
    if env._frontier_target is not None:
        fx, fz = env._frontier_target
        ax.scatter([fx], [fz], marker="*", s=260, color="#ffd23f", edgecolor="#000", zorder=7)
    # note direction arrow (scaled for visibility)
    ax.arrow(px, pz, note[0] * 12, note[1] * 12, width=0.5, head_width=2.2,
             color="#39d0ff", zorder=8, length_includes_head=True)
    ax.set_title(title, color="#e6e8ee", fontsize=11)
    ax.tick_params(colors="#8a8f99")


def main():
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    LeaperReachEnv.FRONTIER_NOTE = True

    env = LeaperReachEnv()
    obs, _ = env.reset(seed=10007)
    fig, axes = plt.subplots(1, 2, figsize=(14, 7))
    draw(axes[0], env, obs[26:31],
         f"SPAWN (seed 10007) — note dir=({obs[26]:+.2f},{obs[27]:+.2f}) "
         f"dist={obs[28]:.2f} size={obs[29]:.2f}")

    # naive follow-the-note controller (NOT the policy): turn toward note, go forward
    for _ in range(120):
        dx, dz, _, _, valid = obs[26:31]
        if valid < 0.5:
            break
        desired = math.atan2(dx, dz)
        err = (desired - env.yaw + math.pi) % (2 * math.pi) - math.pi
        turn = max(-1.0, min(1.0, err / env.TURN_SPEED))
        obs, _, term, trunc, _ = env.step(np.array([1.0, turn], dtype=np.float32))
        if term or trunc:
            break
    draw(axes[1], env, obs[26:31],
         f"after 120 'follow-the-note' steps — reached the bottom-right region "
         f"(pos {np.round(env.position,0)})")

    fig.suptitle("Phase 1B frontier note on seed 10007 — arrow points to the largest unchecked region",
                 color="#e6e8ee", fontsize=13)
    fig.patch.set_facecolor("#0b0d12")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    out = ROOT / "rl_artifacts" / "ppo_33_frontier_seed10007_proof.png"
    fig.savefig(out, dpi=130, facecolor="#0b0d12")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
