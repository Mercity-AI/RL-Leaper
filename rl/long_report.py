"""Long-run reader (2026-11-16): the round-1/2 runs continued to 10M steps.

    python -m rl.long_report [campaign]            # tables (markdown) to stdout
    python -m rl.long_report [campaign] --plot     # also <campaign>/long_curves.png

A single yard exam (100 rounds, the same seeds every time) moves by about +-5 points
from noise alone, so this reader smooths: each run's numbers are averaged over every
yard exam inside a window of steps (``WINDOWS``), and the curves are 3-exam rolling
means. Runs are compared on the same exam seeds, so window means are paired.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ORDER = ("F3", "F1", "F7", "FUSE", "F7B1", "F7R4", "F7R6", "F7HIDE", "F7R6B1", "F7GL", "F7GLE", "F7GLS", "F7GLS0", "F7GLSL", "F7GLSD", "F7GLSDL", "F7GLSDX", "F7GLSDW", "F7GLSDP")
KEYS = ("H1_clear_shot", "H2_first_shot_median_s", "H3_stuck_or_frozen", "H4b_sees_her_hiding_10s", "H5_touch")
LABEL = dict(zip(KEYS, ("clear shot", "1st shot (s)", "stuck", "sees hider 10 s", "touch")))
PERCENT = {"H1_clear_shot", "H3_stuck_or_frozen", "H4b_sees_her_hiding_10s", "H5_touch"}
WINDOWS = ((1_000_000, 2_100_000), (2_100_000, 3_600_000), (3_600_000, 5_600_000),
           (5_600_000, 7_600_000), (7_600_000, 10_100_000))
TODAY_EXAM = "baseline/yard_today_summary.json"


def rows(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def load(campaign):
    runs = {}
    for directory in sorted((ROOT / "rl_artifacts" / campaign).glob("run_*_try*")):
        name, attempt = directory.name[4:].rsplit("_try", 1)
        status = {}
        if (directory / "status.json").exists():
            status = json.loads((directory / "status.json").read_text())
        yard = {r["steps"]: r for r in rows(directory / "yard_exams.jsonl")}
        practice = {r["steps"]: r for r in rows(directory / "practice_exams.jsonl")}
        runs[(name, int(attempt))] = dict(yard=[yard[s] for s in sorted(yard)],
                                          practice=[practice[s] for s in sorted(practice)],
                                          status=status.get("status"), steps=status.get("steps"))
    return runs


def fmt(key, value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "-"
    return f"{100 * value:.0f}%" if key in PERCENT else f"{value:.1f}"


def window_mean(exams, low, high, key):
    values = [e.get(key) for e in exams if low <= e["steps"] < high and e.get(key) is not None]
    return (float(np.mean(values)), len(values)) if values else (None, 0)


def tables(campaign):
    runs = load(campaign)
    order = sorted(runs, key=lambda k: (ORDER.index(k[0]) if k[0] in ORDER else 99, k[1]))
    out = [f"# Long runs: {campaign}", ""]
    out.append("## Where each run is")
    out.append("")
    out.append("| Run | Try | Steps | Status | Yard exams | Last forgetting check |")
    out.append("|---|---|---|---|---|---|")
    for key in order:
        r = runs[key]
        still = r["practice"][-1]["still_catch"] if r["practice"] else None
        steps = max([r["steps"] or 0] + [e["steps"] for e in r["yard"]])
        out.append(f"| {key[0]} | {key[1]} | {steps:,} | {r['status']} | {len(r['yard'])} | "
                   f"{fmt('H1_clear_shot', still)} |")
    for k in KEYS:
        out += ["", f"## {LABEL[k]}: mean over the yard exams in each window (exams in brackets)", ""]
        head = "| Run | Try | " + " | ".join(f"{lo / 1e6:.1f}-{hi / 1e6:.1f}M" for lo, hi in WINDOWS) + " |"
        out += [head, "|---|---|" + "---|" * len(WINDOWS)]
        for key in order:
            cells = []
            for lo, hi in WINDOWS:
                value, n = window_mean(runs[key]["yard"], lo, hi, k)
                cells.append(f"{fmt(k, value)} ({n})" if n else "-")
            out.append(f"| {key[0]} | {key[1]} | " + " | ".join(cells) + " |")
    return "\n".join(out), runs


def plot(campaign, runs):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    folder = ROOT / "rl_artifacts" / campaign
    today = None
    if (folder / TODAY_EXAM).exists():
        s = json.loads((folder / TODAY_EXAM).read_text())
        today = dict(H3_stuck_or_frozen=s.get("stuck_or_frozen_rate"), H5_touch=s.get("catch_rate"))
    palette = ["#2a6fdb", "#e0663a", "#1f9e74", "#9b59b6", "#c9a227", "#d6457e", "#4aa3c9", "#7a8b2e",
               "#8d6e63", "#222222"]
    fig, axes = plt.subplots(len(KEYS), 1, figsize=(11, 3.1 * len(KEYS)), sharex=True)
    names = [n for n in ORDER if any(k[0] == n for k in runs)]
    for ax, key in zip(axes, KEYS):
        for (name, attempt), r in sorted(runs.items()):
            exams = [e for e in r["yard"] if e.get(key) is not None]
            if len(exams) < 2 or name not in names:
                continue
            x = np.array([e["steps"] for e in exams]) / 1e6
            y = np.array([e[key] for e in exams], dtype=float) * (100 if key in PERCENT else 1)
            smooth = np.convolve(y, np.ones(3) / 3, mode="valid") if len(y) >= 3 else y
            xs = x[1:-1] if len(y) >= 3 else x
            colour = palette[names.index(name) % len(palette)]
            ax.plot(xs, smooth, color=colour, lw=1.8 if attempt == 1 else 1.2,
                    ls="-" if attempt == 1 else "--", label=f"{name} try {attempt}")
        if today and today.get(key) is not None:
            ax.axhline(today[key] * 100, color="#888888", lw=1, ls=":", label="today's game brain")
        ax.set_ylabel(LABEL[key] + (" %" if key in PERCENT else ""))
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    axes[-1].set_xlabel("training steps (millions), yard exam, 3-exam rolling mean")
    axes[0].legend(ncol=4, fontsize=8, frameon=False, loc="lower right")
    fig.tight_layout()
    path = folder / "long_curves.png"
    fig.savefig(path, dpi=110)
    return path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    campaign = args[0] if args else "moving_target_round1_20261115"
    text, runs = tables(campaign)
    print(text)
    if "--plot" in sys.argv:
        print(f"\nplot: {plot(campaign, runs)}")


if __name__ == "__main__":
    main()
