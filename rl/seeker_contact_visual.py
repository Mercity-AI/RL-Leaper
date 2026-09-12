"""Plot the saved seed-30000 contact pose; no rollout or training.

Run from the repository root: python -m rl.seeker_contact_visual
Uses the original contact diagnostic and the dormant sensor for read-only math.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle
import numpy as np

from rl.seeker_clearance import FootprintSeekerEnv

ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = ROOT / "rl_artifacts/seeker_20260909"


def plot_sensor_example(diagnostic=CAMPAIGN / "clearance_diagnostic.json",
                        output=CAMPAIGN / "footprint_sensor_example.png"):
    """Render both sensor meanings at exactly the same saved failure endpoint."""
    data = json.loads(Path(diagnostic).read_text(encoding="utf-8"))
    episode = next(e for e in data["episodes"] if e["seed"] == 30000)
    env = FootprintSeekerEnv()
    try:
        env.position = np.array(episode["final_pose"]["position"], dtype=np.float32)
        env.yaw = episode["final_pose"]["yaw"]
        env.obstacles = tuple(tuple(o) for o in episode["obstacles"])
        position = env.position.astype(float)
        footprint = list(env._collision_points(env.position, env.yaw))
        angles = env.yaw + env._ray_relative_angles()
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        old = env._ray_distances(env.position, env.yaw) * env.RAY_MAX_RANGE
        new = env.footprint_clearance() * env.CLEARANCE_RANGE
        # Closest footprint circle and actual surface gap, not a commanded pose.
        gap, point, radius = min(
            (np.linalg.norm(p - np.array([x, z])) - r - obstacle_r, tuple(p), r)
            for p, r, _ in footprint for x, z, obstacle_r in env.obstacles)
        point = np.array(point)
        plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
        fig, axes = plt.subplots(1, 2, figsize=(12, 7.2))
        fig.subplots_adjust(left=.06, right=.97, top=.83, bottom=.25, wspace=.15)
        fig.suptitle("A clear body ray can still leave an outer leg near contact", x=.06,
                     ha="left", y=.97, fontsize=17, fontweight="bold")
        fig.text(.06, .914, "Seed 30000 · saved failure endpoint · same pose and crop in both panels", color="#48515e")
        colors = ("#2674ba", "#cf671b")
        limits = (position[0] - 8, position[0] + 8, position[1] - 6.8, position[1] + 8.2)
        for ax, distances, color in zip(axes, (old, new), colors):
            ax.set_facecolor("#fafafa")
            for x, z, r in env.obstacles:
                ax.add_patch(Circle((x, z), r, facecolor="#dedbd5", edgecolor="#8e8880", lw=1.2, zorder=1))
            for direction, distance in zip(directions, distances):
                end = position + direction * float(distance)
                ax.plot([position[0], end[0]], [position[1], end[1]], color=color, alpha=.8, lw=1.15, zorder=2)
                if ax is axes[1]:
                    ax.plot(*end, marker="o", ms=3, color=color, zorder=3)
            for angle in env.LEG_ANGLES:
                endpoint = position + np.array([np.sin(env.yaw + angle), np.cos(env.yaw + angle)]) * env.LEG_SEGMENT_RADII[-1]
                ax.plot([position[0], endpoint[0]], [position[1], endpoint[1]], color="#525b65", lw=1, zorder=4)
            for p, r, part in footprint:
                ax.add_patch(Circle(p, r, facecolor="#ffffff" if part != "body" else "#cbd5df",
                                    edgecolor="#25364a", lw=1.1, alpha=.92, zorder=5))
            ax.add_patch(Circle(point, radius + .07, fill=False, edgecolor="#b62939", lw=2, zorder=6))
            forward = np.array([np.sin(env.yaw), np.cos(env.yaw)])
            ax.annotate("", xy=position + forward * 1.35, xytext=position,
                        arrowprops=dict(arrowstyle="->", color="#152638", lw=2), zorder=7)
            ax.set(xlim=limits[:2], ylim=limits[2:], xlabel="x (world units)", aspect="equal")
            ax.grid(alpha=.14)
            for spine in ax.spines.values():
                spine.set_color("#d2d6da")
        axes[0].set_ylabel("z (world units)")
        axes[0].set_title("OLD · body-centre thin rays", color=colors[0], loc="left", pad=13, fontweight="bold")
        axes[1].set_title("NEW · whole-footprint translation allowance", color=colors[1], loc="left", pad=13, fontweight="bold", fontsize=10)
        axes[0].text(.03, .03, f"Actual nearest obstacle / wall distance\n28-unit cap; long rays extend beyond this crop", transform=axes[0].transAxes,
                     fontsize=9, bbox=dict(facecolor="white", edgecolor="none", alpha=.94))
        axes[1].text(.03, .03, "16 directions · 6-unit cap\nLine length = distance the whole footprint can slide", transform=axes[1].transAxes,
                     fontsize=9, bbox=dict(facecolor="white", edgecolor="none", alpha=.94))
        axes[0].annotate(f"Outer sample gap: {gap:.3f} units", xy=point, xytext=(position[0]-7.5, position[1]+6.4),
                         fontsize=9, color="#a52434", arrowprops=dict(arrowstyle="->", color="#a52434"),
                         bbox=dict(facecolor="white", edgecolor="none", alpha=.95), zorder=8)
        # Arena inset includes the true wall, which is outside the contact crop.
        inset = fig.add_axes([.805, .035, .15, .17])
        inset.add_patch(Rectangle((-env.WORLD_LIMIT, -env.WORLD_LIMIT), 2*env.WORLD_LIMIT,
                                  2*env.WORLD_LIMIT, fill=False, edgecolor="#25364a", lw=1.5))
        for x, z, r in env.obstacles:
            inset.add_patch(Circle((x, z), r, facecolor="#dedbd5", edgecolor="#8e8880", lw=.5))
        inset.add_patch(Rectangle((limits[0], limits[2]), limits[1]-limits[0], limits[3]-limits[2],
                                  fill=False, edgecolor="#cf671b", lw=1.2))
        inset.plot(*position, "o", color="#25364a", ms=3)
        inset.set(xlim=(-34, 34), ylim=(-34, 34), aspect="equal")
        inset.axis("off")
        inset.set_title("Arena wall + crop", fontsize=8, pad=1)
        fig.text(.06, .174, "19 circles = body + 3 samples on each of 6 legs. Red ring marks the nearest outer sample.", fontsize=10)
        fig.text(.06, .12, "Orange lines are translation allowances, not actual beams. Facing stays fixed; they do not promise safe turning.", fontsize=9.5)
        fig.text(.06, .066, "Stronger hypothetical proximity sensor; nearest inflated surfaces only. No target shown. Diagnostic only — no training.", fontsize=9, color="#48515e")
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(output, dpi=180, facecolor="white")
        plt.close(fig)
        return output
    finally:
        env.close()


if __name__ == "__main__":
    print(plot_sensor_example())
