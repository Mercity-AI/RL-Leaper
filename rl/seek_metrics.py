"""Six seeking metrics for a brain (2026-11-18): how it looks for Lola once she has hidden.

    python -m rl.seek_metrics --probe p.json.gz --stay s.json --arena a.json [--name X]

From the open yard (behaviour-probe files, real yard rounds, Lola a hider who dashes for cover when
spotted and crouches there 30-60 s), counting only moments where **she stayed put** (moved under 1 unit
while out of its sight), so a re-sighting is earned by the Leaper's own movement, never by her walking
back into view:

  1 ducked_found3   she ducked behind junk in its view, 6-20 units away, and stayed put: it sees her again
                    within 3 s
  2 ducked_found10  the same, within 10 s
  3 ducked_speed    the same moments: its speed toward where she vanished over the first 3 s (units/s;
                    negative = it moves away)
  4 loss_reached    genuine losses (out of sight 3 s+, she stayed put, the spot 6+ walking units away and
                    reachable in 10 s): it got within 4 units of where she vanished within 10 s

From the staged hide exam (rl/hide_exam.py, 100 fixed yard scenes, she never moves; 50 arena scenes):

  5 hide_found10    it finds her within 10 s (yard)
  6 arena_found10   the same in new random arenas (it cannot know these by heart)

Each open-yard metric carries a 90% interval from resampling whole rounds; the exam ones from resampling
scenes.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math

import numpy as np

STAYED = 1.0          # she moved less than this (units) while unseen
NEAR = (6.0, 20.3)    # the spot this far away when she vanished


def _ducked(rounds):
    """Per round: list of (re-seen within 3 s, within 10 s, speed toward the spot) for ducked, stayed-put breaks."""
    per = []
    for r in rounds:
        p = np.array(r["path"])
        vis = p[:, 3] > 0
        T, out = len(p), []
        for k in range(1, T):
            if not (vis[k - 1] and not vis[k]):
                continue
            spot = p[k - 1, 4:6]
            d0 = float(np.linalg.norm(p[k - 1, :2] - spot))
            if not NEAR[0] <= d0 < NEAR[1]:
                continue
            me, yaw, her = p[k, :2], p[k, 2], p[k, 4:6]
            rel = abs((math.atan2(her[0] - me[0], her[1] - me[1]) - yaw + math.pi) % (2 * math.pi) - math.pi)
            if rel > math.radians(135):
                continue                                  # she left its view (behind it): not "ducked"
            j = k
            while j < T and not vis[j] and j - k < 100:
                j += 1
            seen_at = (j - k) / 10 if j < T and vis[j] else None
            last = j if seen_at is not None else min(T - 1, k + 99)
            if np.max(np.linalg.norm(p[k:last + 1, 4:6] - spot, axis=1)) >= STAYED:
                continue                                  # she moved: a re-sighting might be her doing
            if seen_at is not None and seen_at < 0.5:
                continue                                  # a flicker, not a loss
            m = min(last, k + 30)
            speed = (d0 - float(np.linalg.norm(p[m, :2] - spot))) / max(0.1, (m - k) / 10)
            out.append((seen_at is not None and seen_at <= 3.0, seen_at is not None and seen_at <= 10.0, speed))
        per.append(out)
    return per


def _losses(data):
    """Per round: genuine losses where she stayed put; 1 if it reached the spot within 10 s."""
    paths = {r["seed"]: np.array(r["path"]) for r in data["rounds"]}
    per = {r["seed"]: [] for r in data["rounds"]}
    for m in data["genuine"]:
        p = paths[m["seed"]]
        k = int(round(m["t"] * 10))
        end = min(len(p) - 1, k + 100)
        if np.max(np.linalg.norm(p[k:end + 1, 4:6] - p[k, 4:6], axis=1)) >= STAYED:
            continue
        per[m["seed"]].append(m["reached"] is not None)
    return list(per.values())


def _boot(per_round, value, draws=2000, seed=0):
    """Mean of ``value`` over all events, with a 90% interval from resampling rounds."""
    rounds = [r for r in per_round if r]
    if not rounds:
        return None
    flat = lambda rs: [value(e) for r in rs for e in r]   # noqa: E731
    rng = np.random.default_rng(seed)
    point = float(np.mean(flat(rounds)))
    boots = [np.mean(flat([rounds[i] for i in rng.integers(0, len(rounds), len(rounds))])) for _ in range(draws)]
    return dict(value=point, low=float(np.percentile(boots, 5)), high=float(np.percentile(boots, 95)),
                events=sum(len(r) for r in rounds))


def _exam(path, seconds=10.0, draws=2000, seed=0):
    if not path:
        return None
    rows = json.load(open(path))["scenes"]
    x = np.array([r["found"] is not None and r["found"] <= seconds for r in rows], dtype=float)
    rng = np.random.default_rng(seed)
    boots = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(draws)]
    return dict(value=float(x.mean()), low=float(np.percentile(boots, 5)), high=float(np.percentile(boots, 95)),
                events=len(x))


def metrics(probe=None, stay=None, arena=None):
    out = {}
    if probe:
        data = json.load(gzip.open(probe, "rt"))
        ducked = _ducked(data["rounds"])
        out["ducked_found3"] = _boot(ducked, lambda e: e[0])
        out["ducked_found10"] = _boot(ducked, lambda e: e[1])
        out["ducked_speed"] = _boot(ducked, lambda e: e[2])
        out["loss_reached"] = _boot(_losses(data), lambda e: e)
        out["rounds"] = len(data["rounds"])
    out["hide_found10"] = _exam(stay)
    out["arena_found10"] = _exam(arena)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe")
    parser.add_argument("--stay")
    parser.add_argument("--arena")
    parser.add_argument("--name", default="")
    args = parser.parse_args()
    print(json.dumps(dict(name=args.name, **metrics(args.probe, args.stay, args.arena)), default=float))


if __name__ == "__main__":
    main()
