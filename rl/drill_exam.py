"""Search-drill exam (2026-11-16): how well a brain finds Lola after she dives behind deep cover.

    python -m rl.drill_exam --run F7GLSD --model path.zip --out out.json [--rounds 100]
    python -m rl.drill_exam --today --out out.json

Fixed rounds (YardPractice seed 95000, drill mode, rl/round1_env.py setup_drill): every round
starts 1 s after it lost her, last seen at a corner V, now crouched at S 15-35 units away in
cover its eye cannot see from where it stands or from 5 units around. The brain plays its
average move (as the game does); a round ends at its first 1 s clear shot or after 30 s.

  found15 / found30  it sees her again within 15 s / 30 s
  shot30             it held a clear shot (14 map units, 1 s) within 30 s
  headed             its walking distance to S fell by >= 3 units in the first 3 s
  corner             it got within 4 units of V (where she vanished) within 10 s
  reached15          it got within 4 units of S within 15 s
  find_s             median seconds to see her again (rounds where it did)
  near_v             of the rounds where it found her, the share where it first saw her from
                     within 8 walking units of V (it went to where it lost her, then saw her)
  approach5          walking distance to V (where she vanished) cut in the first 5 s, or by the
                     round's end if sooner, units (median over every round; a straight walk cuts
                     ~18): does it go to where it lost her?
"""
import argparse
import json

import numpy as np
import torch

from rl.round1_env import YardPractice

SEED, STEPS = 95000, 300


def run(model, inputs, rounds, vary=False, deep=False):
    env = YardPractice(SEED, drill=True, eye_hide=True, shot_flee=True, drill_vary=vary, drill_deep_path=deep, **inputs)
    rows = []
    for _ in range(rounds):
        obs, info = env.reset()
        inner = env.inner
        if getattr(inner, "drill", None) is None:
            continue
        spot, corner = np.asarray(inner.drill["spot"]), np.asarray(inner.drill["corner"])
        walker = inner._walker()
        field = walker.field(spot)
        field_v = walker.field(corner)
        v0, v5 = walker.distance(field_v, inner.position, corner), None
        walk0 = walker.distance(field, inner.position, spot)
        state, found, shot, corner_t, reached, walk3, v_found = None, None, None, None, None, None, None
        streak = 0
        for step in range(STEPS):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]), deterministic=True)
            obs, reward, term, trunc, info = env.step(action)
            pos = np.asarray(inner.position, dtype=np.float64)
            if found is None and inner.target_visible:
                found = (step + 1) / 10
                v_found = float(walker.distance(field_v, pos, corner))
            streak = streak + 1 if (inner.target_visible and inner._distance() <= 20.3) else 0
            if shot is None and streak >= 10:
                shot = (step + 1) / 10
            if corner_t is None and step < 100 and np.linalg.norm(pos - corner) <= 4.0:
                corner_t = (step + 1) / 10
            if reached is None and step < 150 and np.linalg.norm(pos - spot) <= 4.0:
                reached = (step + 1) / 10
            if step == 29:
                walk3 = walker.distance(field, pos, spot)
            if step == 49:
                v5 = walker.distance(field_v, pos, corner)
            if term or trunc:
                break
        if v5 is None:     # the round ended before 5 s (e.g. a shot from the side): approach so far
            v5 = walker.distance(field_v, np.asarray(inner.position, dtype=np.float64), corner)
        rows.append(dict(walk0=float(walk0), headed=bool(walk3 is not None and walk0 - walk3 >= 3.0),
                         approach5=(float(v0 - v5) if v5 is not None else None),
                         found=found, v_found=v_found, shot=shot, corner=corner_t, reached=reached,
                         stuck=bool(info.get("stuck") or info.get("frozen"))))
    def rate(test):
        return float(np.mean([test(r) for r in rows])) if rows else None
    times = [r["found"] for r in rows if r["found"] is not None]
    return dict(rounds=len(rows), found15=rate(lambda r: r["found"] is not None and r["found"] <= 15),
                found30=rate(lambda r: r["found"] is not None), shot30=rate(lambda r: r["shot"] is not None),
                headed=rate(lambda r: r["headed"]), corner=rate(lambda r: r["corner"] is not None),
                reached15=rate(lambda r: r["reached"] is not None), stuck=rate(lambda r: r["stuck"]),
                near_v=(float(np.mean([r["v_found"] <= 8.0 for r in rows if r["v_found"] is not None]))
                        if any(r["v_found"] is not None for r in rows) else None),
                find_s=float(np.median(times)) if times else None,
                approach5=float(np.median([r["approach5"] for r in rows if r["approach5"] is not None]))
                if any(r["approach5"] is not None for r in rows) else None), rows


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="F7GLS")
    parser.add_argument("--model")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--rounds", type=int, default=100)
    parser.add_argument("--out", required=True)
    parser.add_argument("--deep", action="store_true", help="drill_deep_path: S hidden from the route to V until 6 units from V")
    parser.add_argument("--vary", action="store_true", help="drill_vary starts: half face a random way, last seen 1-3 s ago")
    args = parser.parse_args()
    from rl.round1_train import input_switches
    inputs = {} if args.today else input_switches(args.run)
    if args.today:
        from rl.moving_target_brain import load_frozen_predictor
        model = load_frozen_predictor(lambda: YardPractice(1))
    else:
        from rl.round1_job import load_model
        model = load_model(args.model, args.run, lambda: YardPractice(1, **inputs))
    summary, rows = run(model, inputs, args.rounds, vary=args.vary, deep=args.deep)
    with open(args.out, "w") as stream:
        json.dump(dict(brain="today" if args.today else args.model, run="today" if args.today else args.run,
                       summary=summary, rounds=rows), stream, indent=1, default=float)
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
