"""Draw behaviour-probe rounds on the yard map (2026-11-16).

    python -m rl.behaviour_map moments OUT.png  NAME=probe.json.gz [NAME=probe.json.gz ...]
    python -m rl.behaviour_map rounds  OUT.png  --seeds 90003,90011 NAME=probe.json.gz [...]

moments: one panel per brain with every genuine loss (or, --kind hiding, every
  watched hiding): a dot where the Leaper stood when it lost her, a ring at the spot
  where it last saw her, and its next 10 s of walking, coloured by what it did:
  reached the spot (good), headed there but did not reach it (warning), did not head
  there (critical).
rounds: one round per row, one brain per column, on the same seed: the Leaper's
  path (blue), Lola's (orange, dashed), and events: first sighting (star), genuine
  loss (ring at the last-seen spot), hiding spot (diamond), touch (filled circle),
  stuck (square).

Top-down view of the yard in practice units, x across, z up; grey = what the
Leaper's body cannot stand on.
"""
from __future__ import annotations

import gzip
import json
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#d9d8d3"
LEAPER, LOLA = "#2a78d6", "#eb6834"
GOOD, WARN, BAD = "#0ca30c", "#fab219", "#d03b3b"
SOLID = "#bdbcb6"


def load(path):
    with gzip.open(path, "rt") as stream:
        return json.load(stream)


_YARD = None


def yard():
    global _YARD
    if _YARD is None:
        from rl.moving_target_game_exam import yard as load_yard
        g = load_yard()[0]
        _YARD = (np.asarray(g.solid, dtype=bool), [g.minimum[0], g.maximum[0], g.minimum[1], g.maximum[1]])
    return _YARD


def background(ax):
    solid, extent = yard()
    picture = np.where(solid.T, 1.0, 0.0)
    ax.imshow(picture, origin="lower", extent=extent, cmap=matplotlib.colors.ListedColormap([SURFACE, SOLID]),
              interpolation="nearest", zorder=0)
    ax.set_xlim(extent[0], extent[1])
    ax.set_ylim(extent[2], extent[3])
    ax.set_xticks([])
    ax.set_yticks([])
    for side in ax.spines.values():
        side.set_color(GRID)


def outcome(m):
    if m["reached"] is not None:
        return GOOD
    return WARN if m["headed"] else BAD


def moments_panel(ax, probe, kind, title):
    background(ax)
    rounds = {r["seed"]: r for r in probe["rounds"]}
    moments = probe["genuine"] if kind == "loss" else probe["hidings"]
    for m in moments:
        colour = outcome(m)
        path = rounds[m["seed"]]["path"]
        t0 = int(round(m["t"] * 10))
        walk = np.array([[p[0], p[1]] for p in path[t0:t0 + 100]])
        if len(walk):
            ax.plot(walk[:, 0], walk[:, 1], color=colour, lw=1.2, alpha=0.85, zorder=2)
        ax.plot(*m["leaper"], "o", color=colour, ms=4, zorder=3)
        ax.plot(*m["spot"], "o", mfc="none", mec=colour, mew=1.6, ms=9, zorder=3)
    n = len(moments)
    shares = [sum(outcome(m) == c for m in moments) / n if n else 0 for c in (GOOD, WARN, BAD)]
    ax.set_title(f"{title}\n{n} moments: reached {shares[0]:.0%}, headed {shares[1]:.0%}, "
                 f"neither {shares[2]:.0%}", fontsize=9, color=INK, loc="left")


def round_panel(ax, probe, seed, title):
    background(ax)
    r = next(x for x in probe["rounds"] if x["seed"] == seed)
    path = np.array(r["path"])
    ax.plot(path[:, 4], path[:, 5], color=LOLA, lw=1.1, ls=(0, (3, 2)), zorder=2)
    ax.plot(path[:, 0], path[:, 1], color=LEAPER, lw=1.6, zorder=3)
    ax.plot(path[0, 0], path[0, 1], "o", color=LEAPER, ms=6, zorder=4)
    seen = np.flatnonzero(path[:, 3] > 0)
    if len(seen):
        ax.plot(path[seen[0], 0], path[seen[0], 1], "*", color=INK, ms=11, zorder=5)
    for m in probe["genuine"]:
        if m["seed"] == seed:
            ax.plot(*m["spot"], "o", mfc="none", mec=outcome(m), mew=1.8, ms=11, zorder=5)
    for h in r.get("hidings", []):
        ax.plot(h["spot"][0], h["spot"][1], "D", color=LOLA, ms=6, mec=SURFACE, zorder=5)
    end = path[-1]
    if r["touch"]:
        ax.plot(end[0], end[1], "o", color=GOOD, ms=10, mec=SURFACE, zorder=6)
    if r["stuck"]:
        ax.plot(end[0], end[1], "s", color=BAD, ms=9, mec=SURFACE, zorder=6)
    verdict = "touched her" if r["touch"] else ("stuck" if r["stuck"] else "time out")
    ax.set_title(f"{title}: {verdict} at {r['steps'] / 10:.0f} s", fontsize=9, color=INK, loc="left")


def legend(fig, kind, moment="loss"):
    if kind == "rounds":
        items = [Line2D([], [], color=LEAPER, lw=1.6, label="Leaper"),
                 Line2D([], [], color=LOLA, lw=1.1, ls=(0, (3, 2)), label="Lola"),
                 Line2D([], [], marker="*", color=INK, ls="", ms=10, label="first sees her"),
                 Line2D([], [], marker="o", mfc="none", mec=MUTED, ls="", ms=10, label="last-seen spot (genuine loss)"),
                 Line2D([], [], marker="D", color=LOLA, ls="", ms=6, label="her hiding spot"),
                 Line2D([], [], marker="o", color=GOOD, ls="", ms=9, label="touched her"),
                 Line2D([], [], marker="s", color=BAD, ls="", ms=8, label="stuck")]
    else:
        items = [Line2D([], [], color=GOOD, lw=1.5, label="reached the spot within 10 s"),
                 Line2D([], [], color=WARN, lw=1.5, label="headed there, did not reach"),
                 Line2D([], [], color=BAD, lw=1.5, label="did not head there"),
                 Line2D([], [], marker="o", color=MUTED, ls="", ms=5,
                        label="Leaper when it lost her" if moment == "loss" else "Leaper when she reached cover"),
                 Line2D([], [], marker="o", mfc="none", mec=MUTED, ls="", ms=9, label="the spot")]
    fig.legend(handles=items, loc="lower center", ncol=len(items), frameon=False, fontsize=8)


def main():
    mode, out = sys.argv[1], sys.argv[2]
    args = sys.argv[3:]
    kind = "loss"
    seeds = []
    if "--kind" in args:
        kind = args[args.index("--kind") + 1]
        args = [a for i, a in enumerate(args) if a != "--kind" and (i == 0 or args[i - 1] != "--kind")]
    cols_arg = None
    if "--cols" in args:
        cols_arg = int(args[args.index("--cols") + 1])
        args = [a for i, a in enumerate(args) if a != "--cols" and (i == 0 or args[i - 1] != "--cols")]
    if "--seeds" in args:
        seeds = [int(s) for s in args[args.index("--seeds") + 1].split(",")]
        args = [a for i, a in enumerate(args) if a != "--seeds" and (i == 0 or args[i - 1] != "--seeds")]
    brains = [(a.split("=", 1)[0], load(a.split("=", 1)[1])) for a in args]
    if mode == "moments":
        cols = cols_arg or min(3, len(brains))
        rows = (len(brains) + cols - 1) // cols
        fig, axes = plt.subplots(rows, cols, figsize=(5.2 * cols, 5.0 * rows + 0.6), squeeze=False)
        for ax, (name, probe) in zip(axes.flat, brains):
            moments_panel(ax, probe, kind, name)
        for ax in list(axes.flat)[len(brains):]:
            ax.axis("off")
        what = "genuine losses (unseen 3 s+)" if kind == "loss" else "hidings it watched"
        fig.suptitle(f"After {what}: does it go to the spot? Next 10 s of walking", color=INK, fontsize=11, x=0.01,
                     ha="left")
        legend(fig, "moments", kind)
    else:
        fig, axes = plt.subplots(len(seeds), len(brains), figsize=(4.6 * len(brains), 4.4 * len(seeds) + 0.6),
                                 squeeze=False)
        for i, seed in enumerate(seeds):
            for j, (name, probe) in enumerate(brains):
                round_panel(axes[i, j], probe, seed, f"{name}, round {seed}")
        legend(fig, "rounds")
    fig.patch.set_facecolor(SURFACE)
    fig.tight_layout(rect=(0, 0.04, 1, 0.97))
    fig.savefig(out, dpi=105, facecolor=SURFACE)
    print(out)


if __name__ == "__main__":
    main()
