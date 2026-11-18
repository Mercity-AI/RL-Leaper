"""The hide retrain's results table (2026-11-18, docs/HIDE_RETRAIN_WORKLOG_2026-11-18.md).

    python -m rl.hide_report [--steps 11010080] [--out results.json] [--markdown table.md]

One row per brain: today's game brain, the 7M brain and the 9M start (baselines), then every experiment at
``--steps``, its tries pooled. Columns: the six seeking metrics of rl/seek_metrics.py (open yard: she ducked
behind junk and stayed put, found within 3 s / 10 s, speed toward the spot, real loss walked to the spot;
staged hide exam yard / arena, found within 10 s), what it does in the 3 s after she ducks (walks toward /
holds / moves away), and the safety checks (chase net/path, steps backwards, drills, still-target, yard
stuck and clear shot on the 300-round exam). Open-yard numbers come from the 450-round probes when every
try has one, else the 150-round ones; 90% intervals resample whole rounds (open yard) or scenes (exams).
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
C = ROOT / "rl_artifacts/moving_target_round1_20261115"
B = C / "hide_retrain_baselines"
H = ROOT / "rl_artifacts/hide_retrain_20261118/exams"
ARMS = [("CR", "Control: +2M of the 4C recipe"), ("CS", "She stays until found"), ("CHY", "Yard hide scenes"),
        ("CHS", "Hide scenes + stays until found"), ("CH", "Designer's run: yard + arena scenes"),
        ("CG", "Big gated pay x3.3 + stays until found"), ("CG15", "Big gated pay x5 + stays until found"),
        ("CGD", "Big pay + more drills"), ("CGH", "Big pay + hide scenes")]


def _load(path):
    path = Path(path)
    if not path.exists():
        return None
    return json.load(gzip.open(path, "rt")) if path.suffix == ".gz" else json.loads(path.read_text())


def _exam(paths, seconds=10.0):
    rows = [r for p in paths for r in ((_load(p) or {}).get("scenes") or [])]
    if not rows:
        return None
    x = np.array([r["found"] is not None and r["found"] <= seconds for r in rows], dtype=float)
    rng = np.random.default_rng(0)
    boots = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(2000)]
    return dict(value=float(x.mean()), low=float(np.percentile(boots, 5)), high=float(np.percentile(boots, 95)),
                events=len(x))


def _what_it_does(rounds):
    """After she ducks behind junk close by and stays put: share walking toward (>= 1 unit closer in 3 s),
    holding, moving away (>= 1 unit further)."""
    from rl.seek_metrics import NEAR, STAYED
    moves = []
    for r in rounds:
        p = np.array(r["path"])
        vis = p[:, 3] > 0
        T = len(p)
        for k in range(1, T):
            if not (vis[k - 1] and not vis[k]):
                continue
            spot = p[k - 1, 4:6]
            d0 = float(np.linalg.norm(p[k - 1, :2] - spot))
            if not NEAR[0] <= d0 < NEAR[1]:
                continue
            me, yaw, her = p[k, :2], p[k, 2], p[k, 4:6]
            if abs((math.atan2(her[0] - me[0], her[1] - me[1]) - yaw + math.pi) % (2 * math.pi) - math.pi) > math.radians(135):
                continue
            j = k
            while j < T and not vis[j] and j - k < 100:
                j += 1
            last = j if j < T and vis[j] else min(T - 1, k + 99)
            if np.max(np.linalg.norm(p[k:last + 1, 4:6] - spot, axis=1)) >= STAYED or (j < T and vis[j] and j - k < 5):
                continue
            moves.append(d0 - float(np.linalg.norm(p[min(T - 1, k + 30), :2] - spot)))
    m = np.array(moves)
    if not len(m):
        return None
    return dict(toward=float(np.mean(m >= 1.0)), hold=float(np.mean(np.abs(m) < 1.0)), away=float(np.mean(m <= -1.0)))


def brain(name, probes, stays, arenas, drills, stills, yards):
    from rl.chase_check import chase
    from rl.seek_metrics import _boot, _ducked, _losses
    rounds, genuine, chases = [], [], []
    for i, path in enumerate(probes):
        data = _load(path)
        if data is None:
            continue
        rounds += [dict(r, seed=(i, r["seed"])) for r in data["rounds"]]
        genuine += [dict(m, seed=(i, m["seed"])) for m in data["genuine"]]
        chases.append(chase(data, brain.walker))
    out = dict(brain=name, rounds=len(rounds))
    if rounds:
        ducked = _ducked(rounds)
        out.update(ducked_found3=_boot(ducked, lambda e: e[0]), ducked_found10=_boot(ducked, lambda e: e[1]),
                   ducked_speed=_boot(ducked, lambda e: e[2]),
                   loss_reached=_boot(_losses(dict(rounds=rounds, genuine=genuine)), lambda e: e),
                   what_it_does=_what_it_does(rounds),
                   net_path=float(np.mean([c["net_path"]["value"] for c in chases])),
                   backwards=float(np.mean([c["backwards"]["value"] for c in chases])))
    out.update(hide_found10=_exam(stays), arena_found10=_exam(arenas))
    found = [d["summary"]["found30"] for d in map(_load, drills) if d]
    out["drill_found30"] = float(np.mean(found)) if found else None
    still = [s["catch_rate"] for s in map(_load, stills) if s]
    out["still_min"] = float(min(still)) if still else None
    if yards:
        out["yard_stuck"] = float(np.mean([y["H3_stuck_or_frozen"] for y in yards]))
        out["yard_clear_shot"] = float(np.mean([y["H1_clear_shot"] for y in yards]))
    return out


brain.walker = None


def _yard300(directory, steps):
    path = directory / "final300" / "results.jsonl"
    if not path.exists():
        return []
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    return [r for r in rows if r["kind"] == "yard" and r["brain"].endswith(f"_{steps}")][-1:]


def collect(steps):
    from rl.chase_check import _walker
    brain.walker = _walker()
    baseline_yard = {json.loads(l)["brain"]: json.loads(l) for l in (B / "results.jsonl").read_text().splitlines()}
    rows = [
        brain("Today's game brain", [B / "probe450_today.json.gz"], [H / "stay_today.json"], [H / "arena_today.json"],
              [B / "drill_today.json"], [], [baseline_yard["today"]]),
        brain("7M brain", [B / "probe450_7M.json.gz"], [H / "stay_4C_7M.json"], [H / "arena_4C_7M.json"],
              [B / "drill_7M.json"], [C / "run_F7GLSDP4C_try2/still_7004176_summary.json"], [baseline_yard["4C_t2_7M"]]),
        brain("9M start", [B / "probe450_9M.json.gz"], [H / "stay_4C_9M.json"], [H / "arena_4C_9M.json"],
              [B / "drill_9M.json"], [C / "run_F7GLSDP4C_try2/still_9003040_summary.json"], [baseline_yard["4C_t2_9M"]]),
    ]
    for arm, label in ARMS:
        dirs = [C / f"run_F7GLSDP4{arm}_try{t}" for t in (1, 2)]
        if not all((d / f"hide_stay_{steps}.json").exists() for d in dirs):
            continue
        probe = "behaviour_rh450" if all((d / f"behaviour_rh450_{steps}.json.gz").exists() for d in dirs) else "behaviour_rh"
        rows.append(brain(label, [d / f"{probe}_{steps}.json.gz" for d in dirs], [d / f"hide_stay_{steps}.json" for d in dirs],
                          [d / f"hide_arena_{steps}.json" for d in dirs], [d / f"drill_rh_{steps}.json" for d in dirs],
                          [d / f"still_{steps}_summary.json" for d in dirs], [y for d in dirs for y in _yard300(d, steps)]))
        rows[-1]["run"] = f"F7GLSDP4{arm}"
    return rows


def markdown(rows):
    def pct(v):
        return "–" if v is None else f"{v['value']:.0%} [{v['low']:.0%}–{v['high']:.0%}]" if isinstance(v, dict) else f"{v:.0%}"

    def speed(v):
        return "–" if v is None else f"{v['value']:+.2f} [{v['low']:+.2f}, {v['high']:+.2f}]"
    lines = ["| Brain | Ducked: found in 3 s | … in 10 s | Speed toward spot (u/s) | Real loss: walks to spot | "
             "Staged hide: found in 10 s | Arenas: found in 10 s | Toward / hold / away |",
             "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        w = r.get("what_it_does")
        lines.append(f"| {r['brain']} | {pct(r.get('ducked_found3'))} | {pct(r.get('ducked_found10'))} | "
                     f"{speed(r.get('ducked_speed'))} | {pct(r.get('loss_reached'))} | {pct(r.get('hide_found10'))} | "
                     f"{pct(r.get('arena_found10'))} | "
                     + (f"{w['toward']:.0%} / {w['hold']:.0%} / {w['away']:.0%} |" if w else "– |"))
    lines += ["", "| Brain | Chase net/path (≥ 0.58) | Steps backwards (≤ 31%) | Drills: found in 30 s | "
              "Still-target, lowest (≥ 93%) | Yard stuck (300 rounds) | Yard clear shot |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        def f(key, fmt):
            return "–" if r.get(key) is None else fmt.format(r[key])
        lines.append(f"| {r['brain']} | {f('net_path', '{:.2f}')} | {f('backwards', '{:.0%}')} | {f('drill_found30', '{:.0%}')} | "
                     f"{f('still_min', '{:.1%}')} | {f('yard_stuck', '{:.0%}')} | {f('yard_clear_shot', '{:.0%}')} |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=11010080)
    parser.add_argument("--out")
    parser.add_argument("--markdown")
    args = parser.parse_args()
    rows = collect(args.steps)
    text = markdown(rows)
    print(text)
    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=1, default=float))
    if args.markdown:
        Path(args.markdown).write_text(text + "\n")


if __name__ == "__main__":
    main()
