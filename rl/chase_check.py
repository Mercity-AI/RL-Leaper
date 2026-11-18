"""Chase, backwards and open-yard seeking checks from behaviour-probe files (rl/behaviour_probe.py).

    python -m rl.chase_check probe_a.json.gz [probe_b.json.gz ...]

The same maths as the 17 Nov analysis scripts (the bucket's report_src/analysis/approach_bs.py
and breaks.py), moved here with the paths taken out, so the numbers stay comparable:

Chase (she is in sight and more than 14 units away):
  backwards   share of moving steps (> 0.05 units) taken against the way it faces
  closing     walking-distance progress toward her over 0.5 s, units per second
              (4,000 moments sampled at one rate across rounds, same stream per file)
  net/path    1 s straight-line displacement / distance walked (1.0 = no back-and-forth)
  each with a 90% interval from 2,000 resamples of rounds

Open yard, every sight-break (she goes out of sight, not only 3 s+ losses): straight-line speed
toward the spot where it last saw her, over the first min(3 s, until it sees her again); breaks
shorter than 0.5 s and spots closer than 6 units skipped; split at 20.3 units (near / far), with
a 95% interval.
"""
from __future__ import annotations

import argparse
import gzip
import json

import numpy as np

MOMENTS = 4000
CHASE_GAP = 14.0
NEAR_FAR = 20.3


def _walker():
    from rl.round1_env import Round1YardEnv
    env = Round1YardEnv(90000)
    env.reset()
    return env._walker()


def chase(data, walker):
    rows = []
    rng = np.random.default_rng(0)      # same stream per file
    for r in data["rounds"]:
        a = np.array(r["path"])
        vis = a[:, 3] > 0
        nrev = nmov = 0
        cand = []
        for k in range(len(a) - 5):
            far = np.linalg.norm(a[k, 4:6] - a[k, :2]) > CHASE_GAP
            if vis[k] and vis[k + 5] and far:
                cand.append(k)
            if vis[k] and far:
                mv = a[k + 1, :2] - a[k, :2]
                fwd = np.array([np.sin(a[k, 2]), np.cos(a[k, 2])])
                if np.linalg.norm(mv) > 0.05:
                    nmov += 1
                    nrev += mv @ fwd < 0
        net = path = 0.0
        for k in range(len(a) - 10):
            if vis[k] and np.linalg.norm(a[k, 4:6] - a[k, :2]) > CHASE_GAP:
                seg = np.linalg.norm(np.diff(a[k:k + 11, :2], axis=0), axis=1).sum()
                if seg > 0.5:
                    net += np.linalg.norm(a[k + 10, :2] - a[k, :2])
                    path += seg
        rows.append((a, cand, nrev, nmov, net, path))
    total = sum(len(r[1]) for r in rows)
    f = min(1.0, MOMENTS / max(1, total))
    per_round = []
    for a, cand, nrev, nmov, net, path in rows:
        closing = []
        for k in (rng.choice(cand, size=rng.binomial(len(cand), f), replace=False) if cand else []):
            field = walker.field(a[k, 4:6])
            closing.append((walker.distance(field, a[k, :2], a[k, 4:6])
                            - walker.distance(field, a[k + 5, :2], a[k, 4:6])) / 0.5)
        per_round.append((nrev, nmov, sum(closing), len(closing), net, path))
    R = np.array(per_round, dtype=float)

    def stat(x):
        return (x[:, 0].sum() / max(1, x[:, 1].sum()), x[:, 2].sum() / max(1, x[:, 3].sum()),
                x[:, 4].sum() / max(1e-9, x[:, 5].sum()))

    point = stat(R)
    boot = np.array([stat(R[rng.integers(0, len(R), len(R))]) for _ in range(2000)])
    low, high = np.percentile(boot, [5, 95], axis=0)
    names = ("backwards", "closing", "net_path")
    return {n: dict(value=float(point[i]), low=float(low[i]), high=float(high[i])) for i, n in enumerate(names)}


def breaks(data):
    """Sight-breaks, plus (2026-11-18) the close-by ones split by why she went out of sight: ``ducked``
    = she is in its 270-degree view but something solid hides her (she ducked behind junk), ``behind`` =
    she left its view (the 90-degree wedge at its back). For each: closure toward the spot, the share of
    its moving steps taken backwards, and the share re-seen within 3 s."""
    import math
    rates, heads, split = [], [], {"ducked": [], "behind": []}
    for r in data["rounds"]:
        p = np.array(r["path"])
        vis = p[:, 3] > 0
        T = len(p)
        for k in range(1, T):
            if vis[k - 1] and not vis[k]:
                spot = p[k - 1, 4:6]
                d0 = np.linalg.norm(p[k - 1, :2] - spot)
                j = k
                while j < T and not vis[j] and j - k < 30:
                    j += 1
                if j - k < 5 or d0 < 6:
                    continue
                d1 = np.linalg.norm(p[j - 1, :2] - spot)
                rate = (d0 - d1) / ((j - k) / 10)
                rates.append((rate, d0))
                heads.append(d0 - d1 > 0.5 * 0.375 * (j - k))
                if d0 < NEAR_FAR:
                    me, yaw, her = p[k, :2], p[k, 2], p[k, 4:6]
                    rel = abs((math.atan2(her[0] - me[0], her[1] - me[1]) - yaw + math.pi) % (2 * math.pi) - math.pi)
                    back = moving = 0
                    for t in range(k, j - 1):
                        mv = p[t + 1, :2] - p[t, :2]
                        if np.linalg.norm(mv) > 0.05:
                            moving += 1
                            back += mv @ np.array([math.sin(p[t, 2]), math.cos(p[t, 2])]) < 0
                    split["behind" if rel > math.radians(135) else "ducked"].append(
                        (rate, back / max(1, moving), bool(j < T and vis[j])))
    a = np.array(rates)
    out = {}
    for name, lo, hi in (("near", 6, NEAR_FAR), ("far", NEAR_FAR, 999)):
        r = a[(a[:, 1] >= lo) & (a[:, 1] < hi), 0] if len(a) else np.zeros(0)
        out[name] = dict(n=int(len(r)), value=float(r.mean()) if len(r) else None,
                         ci95=float(1.96 * r.std() / np.sqrt(len(r))) if len(r) > 1 else None)
    out["heads_share"] = float(np.mean(heads)) if heads else None
    for name, rows in split.items():
        x = np.array(rows) if rows else np.zeros((0, 3))
        out[name] = dict(n=int(len(x)), closure=float(x[:, 0].mean()) if len(x) else None,
                         closure_ci95=float(1.96 * x[:, 0].std() / np.sqrt(len(x))) if len(x) > 1 else None,
                         backwards=float(x[:, 1].mean()) if len(x) else None,
                         reseen3=float(x[:, 2].mean()) if len(x) else None)
    return out


def ducked_by_round(data, draws=2000, seed=0):
    """'She ducked behind junk' (close-by breaks, she in its view but hidden): re-seen within 3 s and speed
    toward the spot, with 90% intervals from resampling whole rounds."""
    per_round = []
    for r in data["rounds"]:
        b = breaks(dict(rounds=[r]))["ducked"]
        if b["n"]:
            per_round.append((b["n"], b["reseen3"] * b["n"], b["closure"] * b["n"]))
    x = np.array(per_round, dtype=float)
    if not len(x):
        return None
    rng = np.random.default_rng(seed)
    def stat(y):
        return y[:, 1].sum() / y[:, 0].sum(), y[:, 2].sum() / y[:, 0].sum()
    point = stat(x)
    boots = np.array([stat(x[rng.integers(0, len(x), len(x))]) for _ in range(draws)])
    low, high = np.percentile(boots, [5, 95], axis=0)
    return dict(breaks=int(x[:, 0].sum()), rounds=len(x),
                reseen3=dict(value=float(point[0]), low=float(low[0]), high=float(high[0])),
                closure=dict(value=float(point[1]), low=float(low[1]), high=float(high[1])))


def check(path, walker=None):
    data = json.load(gzip.open(path, "rt"))
    walker = walker or _walker()
    return dict(file=str(path), chase=chase(data, walker), breaks=breaks(data))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    parser.add_argument("--out")
    args = parser.parse_args()
    walker = _walker()
    results = []
    for path in args.files:
        row = check(path, walker)
        results.append(row)
        c, b = row["chase"], row["breaks"]
        print(f"{path.split('/')[-1]:34s} backwards {100 * c['backwards']['value']:.0f}% "
              f"[{100 * c['backwards']['low']:.0f}-{100 * c['backwards']['high']:.0f}]  "
              f"closing {c['closing']['value']:+.2f} u/s  net/path {c['net_path']['value']:.2f} "
              f"[{c['net_path']['low']:.2f}-{c['net_path']['high']:.2f}]  | breaks near "
              f"{b['near']['value']:+.2f} (n={b['near']['n']}) far {b['far']['value']:+.2f} (n={b['far']['n']})"
              f" | ducked: closure {b['ducked']['closure']:+.2f} re-seen 3 s {b['ducked']['reseen3']:.0%}"
              f" | behind: closure {b['behind']['closure']:+.2f} re-seen 3 s {b['behind']['reseen3']:.0%}",
              flush=True)
    if args.out:
        with open(args.out, "w") as stream:
            json.dump(results, stream, indent=1)


if __name__ == "__main__":
    main()
