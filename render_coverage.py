"""Render the PPO_32 cleared-map for recorded episodes: checked ground vs blindspots.

Reads a run's browser_replay.json, reconstructs the cumulative cleared grid at the
final frame of each recorded deterministic episode, and draws:
  - green  = ground Leaper actually CHECKED (a target there would have been seen)
  - amber  = UNCHECKED ground / blindspots (never in view, out of range, or rock-shadow)
  - grey circles = obstacles (their rear amber wedges are the rock-shadows)
  - orange line  = Leaper's path;  dot = start;  triangle = final pose
  - pink square  = the hidden target (drawn for the human only; the map never used it)
"""

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, RegularPolygon

ROOT = Path(__file__).resolve().parent


def render(run_dir: str, out_path: str, n: int = 4) -> None:
    data = json.loads((ROOT / run_dir / "browser_replay.json").read_text())
    checkpoint = data["checkpoints"][-1]  # latest / final model
    episodes = checkpoint["episodes"][:n]

    cols = 2
    rows = math.ceil(len(episodes) / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(13, 6.5 * rows))
    axes = np.atleast_1d(axes).ravel()

    for ax, ep in zip(axes, episodes):
        steps = ep["coverage_steps"]
        cell = ep["coverage_cell"]
        limit = ep["world_limit"]
        frames = ep["frames"]

        cleared = np.zeros(steps * steps, dtype=bool)
        for frame in frames:
            for idx in frame.get("coverage_new", []):
                cleared[idx] = True

        ax.set_facecolor("#12141a")
        ax.set_xlim(-limit, limit)
        ax.set_ylim(-limit, limit)
        ax.set_aspect("equal")

        # cleared vs unchecked tiles
        for ix in range(steps):
            cx = -limit + (ix + 0.5) * cell
            for iz in range(steps):
                cz = -limit + (iz + 0.5) * cell
                is_cleared = cleared[ix * steps + iz]
                ax.add_patch(
                    plt.Rectangle(
                        (cx - cell / 2, cz - cell / 2), cell * 0.96, cell * 0.96,
                        color="#2f7d4f" if is_cleared else "#b5651d",
                        alpha=0.55 if is_cleared else 0.40,
                        linewidth=0,
                    )
                )

        for ox, oz, r in ep.get("obstacles", []):
            ax.add_patch(Circle((ox, oz), r, color="#5b606b", zorder=3))

        xs = [f["x"] for f in frames]
        zs = [f["z"] for f in frames]
        ax.plot(xs, zs, color="#ff8b3d", linewidth=1.6, alpha=0.9, zorder=4)
        ax.scatter([xs[0]], [zs[0]], color="#ffffff", s=45, zorder=5, label="start")
        yaw = frames[-1]["yaw"]
        ax.add_patch(
            RegularPolygon(
                (xs[-1], zs[-1]), numVertices=3, radius=1.4, orientation=-yaw,
                color="#ff4a26", zorder=6,
            )
        )
        if ep.get("target"):
            tx, tz = ep["target"][0], ep["target"][1]
            ax.add_patch(
                plt.Rectangle((tx - 1.2, tz - 1.2), 2.4, 2.4, color="#ff4fa3", zorder=5)
            )

        checked_pct = 100.0 * cleared.mean()
        outcome = "REACHED" if ep.get("success") else "TIMEOUT / lost"
        ax.set_title(
            f"Episode {ep['episode']} — {outcome} · {checked_pct:.0f}% of arena checked",
            color="#e6e8ee", fontsize=11,
        )
        ax.tick_params(colors="#8a8f99")

    for extra in axes[len(episodes):]:
        extra.axis("off")

    fig.suptitle(
        f"PPO_32 cleared map — {run_dir}  (green = checked ground · amber = blindspots/unchecked)",
        color="#e6e8ee", fontsize=13,
    )
    fig.patch.set_facecolor("#0b0d12")
    fig.tight_layout(rect=[0, 0, 1, 0.97])
    fig.savefig(out_path, dpi=130, facecolor="#0b0d12")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    run = sys.argv[1] if len(sys.argv) > 1 else "rl_artifacts/ppo_32_cleared_map_250k_s3"
    out = sys.argv[2] if len(sys.argv) > 2 else "rl_artifacts/ppo_32_coverage_s3.png"
    render(run, out)
