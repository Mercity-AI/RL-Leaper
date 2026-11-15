"""Read round 1 results with the plan's section 7 rules.

    python -m rl.round1_report [campaign]

Prints, per run and try, the yard exam's H1-H5 at every exam, the practice
exam and forgetting check, and the run's box (better / promising / no help /
harmful) against its reference: F3 vs run A; F1, F7 vs F3; FUSE, W7 vs F7.
Run A's numbers are the 2026-11-05 ones (the user chose not to re-measure).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RUN_A = dict(H1_clear_shot=0.75, H2_first_shot_median_s=15.1, H3_stuck_or_frozen=0.11,
             H4_checks_hiding_spot=0.04, H5_touch=0.19)
TODAY = dict(H1_clear_shot=0.77, H2_first_shot_median_s=15.5, H3_stuck_or_frozen=0.28,
             H4_checks_hiding_spot=0.04, H5_touch=0.15)
REFERENCE = {"F3": "A", "F1": "F3", "F7": "F3", "FUSE": "F7", "W7": "F7",
             "F7R6": "F7", "F7B1": "F7", "F7R6B1": "F7", "F7HIDE": "F7", "F7R4": "F7", "F7GL": "F7"}
ORDER = ("F3", "F1", "F7", "FUSE", "W7", "F7R6", "F7B1", "F7R6B1", "F7HIDE", "F7R4", "F7GL")
KEYS = ("H1_clear_shot", "H2_first_shot_median_s", "H3_stuck_or_frozen", "H4_checks_hiding_spot", "H5_touch")
SHORT = dict(zip(KEYS, ("H1 shot", "H2 secs", "H3 stuck", "H4 hide", "H5 touch")))


def rows(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def better_by(key, value, ref):
    """Positive = better than the reference by the plan's margin unit (points, or % for H2)."""
    if value is None or ref is None:
        return None
    if key == "H2_first_shot_median_s":
        return (ref - value) / ref * 100          # % faster
    if key == "H3_stuck_or_frozen":
        return (ref - value) * 100               # points fewer
    return (value - ref) * 100                   # points more


def load(campaign):
    runs = {}
    for directory in sorted((ROOT / "rl_artifacts" / campaign).glob("run_*_try*")):
        name, attempt = directory.name[4:].rsplit("_try", 1)
        status = json.loads((directory / "status.json").read_text()) if (directory / "status.json").exists() else {}
        runs.setdefault(name, {})[int(attempt)] = dict(
            yard=rows(directory / "yard_exams.jsonl"), practice=rows(directory / "practice_exams.jsonl"),
            status=status.get("status"), steps=status.get("steps"), total=status.get("total"))
    return runs


def final_yard(tries):
    """Last yard exam of each try (only tries that reached the end count for boxes)."""
    return {t: v["yard"][-1] for t, v in tries.items() if v["yard"]}


def reference_numbers(name, runs):
    ref = REFERENCE[name]
    if ref == "A":
        return RUN_A
    finals = final_yard(runs.get(ref, {}))
    if not finals:
        return None
    return {k: float(np.mean([f[k] for f in finals.values() if f.get(k) is not None]))
            for k in KEYS if any(f.get(k) is not None for f in finals.values())}


def box(name, runs):
    """One try per run (user, 2026-11-15): compare try 1 with the reference's try 1 at
    the latest yard exam both have (run A: its 1M numbers). Margins as in the plan."""
    tries = runs[name]
    if any(str(v["status"]).startswith("stopped: forgetting") for v in tries.values()):
        return "harmful", "forgetting guard broken"
    mine = {r["steps"]: r for r in tries.get(1, {}).get("yard", [])}
    ref_name = REFERENCE[name]
    if ref_name == "A":
        if not mine:
            return "pending", "no yard exam yet"
        step = max(s for s in mine if s <= 1_007_616) if any(s <= 1_007_616 for s in mine) else max(mine)
        ref, label = RUN_A, "run A at 1M"
    else:
        theirs = {r["steps"]: r for r in runs.get(ref_name, {}).get(1, {}).get("yard", [])}
        common = sorted(set(mine) & set(theirs))
        if not common:
            return "pending", "no yard exam at a step both runs have"
        step, ref, label = common[-1], theirs[common[-1]], f"{ref_name} at the same step"
    gains = {k: better_by(k, mine[step].get(k), ref.get(k)) for k in KEYS}
    worse = [f"{SHORT[k]} ({g:+.0f})" for k, g in gains.items() if g is not None and g < -5]
    wins = [f"{SHORT[k]} ({g:+.0f})" for k, g in gains.items() if g is not None and g >= 5]
    where = f"at {step:,} vs {label}, one try"
    if worse and not wins:
        return "harmful", f"{where}: worse on " + ", ".join(worse)
    if wins and not worse:
        return "better", f"{where}: better on " + ", ".join(wins)
    if wins and worse:
        return "mixed", f"{where}: better on " + ", ".join(wins) + "; worse on " + ", ".join(worse)
    return "no clear change", f"{where}: every headline within the margins"


def fmt(value, key):
    if value is None:
        return "-"
    return f"{value:.1f}" if key == "H2_first_shot_median_s" else f"{100 * value:.0f}%"


def main():
    campaign = sys.argv[1] if len(sys.argv) > 1 else "moving_target_round1_20261115"
    runs = load(campaign)
    print(f"# Round 1 results ({campaign})\n")
    print("Reference rows: run A at 1M and today's game brain (2026-11-05 exams).\n")
    header = "| Run | Try | Steps | Yard exam at | " + " | ".join(SHORT[k] for k in KEYS) + " | Practice catch | Still catch |"
    print(header)
    print("|" + "---|" * (header.count("|") - 1))
    for label, numbers in (("run A", RUN_A), ("today", TODAY)):
        print(f"| {label} | - | - | 1M | " + " | ".join(fmt(numbers[k], k) for k in KEYS) + " | - | - |")
    for name in ORDER:
        for attempt, v in sorted(runs.get(name, {}).items()):
            practice = v["practice"][-1] if v["practice"] else {}
            for i, y in enumerate(v["yard"] or [{}]):
                last = i == len(v["yard"] or [{}]) - 1
                print(f"| {name if i == 0 else ''} | {attempt if i == 0 else ''} | "
                      f"{(v['steps'] or 0) if i == 0 else ''} | {y.get('steps', '-')} | "
                      + " | ".join(fmt(y.get(k), k) for k in KEYS)
                      + (f" | {fmt(practice.get('moving_catch'), '')} | {fmt(practice.get('still_catch'), '')} |"
                         if last else " | | |"))
    print("\n## Honest hiding measures (yard exams from 2026-11-15 21:30 on)\n")
    print("| Run | Try | Steps | Sees her while she hides <= 10 s | Within 4 units <= 10 s, reachable hidings only | Hidings (reachable) |")
    print("|---|---|---|---|---|---|")
    for name in ORDER:
        for attempt, v in sorted(runs.get(name, {}).items()):
            for y in v["yard"]:
                if "H4b_sees_her_hiding_10s" in y:
                    print(f"| {name} | {attempt} | {y['steps']} | {fmt(y['H4b_sees_her_hiding_10s'], '')} | "
                          f"{fmt(y.get('H4r_reached_if_reachable'), '')} | {y['hidings']} ({y['hidings_reachable']}) |")
    print("\n## Free window test: same brain, 128-step window vs normal memory (yard exam)\n")
    print("| Run | Try | Steps | Memory | " + " | ".join(SHORT[k] for k in KEYS) + " |")
    print("|---|---|---|---|" + "---|" * len(KEYS))
    campaign_dir = ROOT / "rl_artifacts" / campaign
    for name in ("F7", "FUSE"):
        for attempt in (1, 2):
            directory = campaign_dir / f"run_{name}_try{attempt}"
            normal = {r["steps"]: r for r in rows(directory / "yard_exams.jsonl")}
            for w in rows(directory / "yard_window_exams.jsonl"):
                for label, r in (("normal", normal.get(w["steps"])), (f"window {w['window']}", w)):
                    cells = " | ".join(fmt(r.get(k), k) for k in KEYS) if r else " | ".join("-" for _ in KEYS)
                    print(f"| {name} | {attempt} | {w['steps']} | {label} | {cells} |")
    print("\n## Verdicts (plan section 7 margins: +5 points; H2 5% faster; one try per run, so within ~5 points is noise)\n")
    for name in ORDER:
        if name in runs:
            verdict, why = box(name, runs)
            print(f"- **{name}** vs {REFERENCE[name]}: **{verdict}** ({why})")


if __name__ == "__main__":
    main()
