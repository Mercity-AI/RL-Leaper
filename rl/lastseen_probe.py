"""Last-seen and hiding-spot behaviour, measured where it is physically possible (2026-11-15).

    python -m rl.lastseen_probe --run F7 --model path.zip --rounds 60 --out out.json
    python -m rl.lastseen_probe --today --rounds 60 --out out.json

Real yard, eye-level sight, hider-only rounds, but Lola starts 10-20 map units
from the Leaper (the game's rule is 22-42) so most of her hiding and vanishing
spots are within reach. Seeds 90000+. The brain plays deterministically.

Two kinds of moment, each from the step it happens, over 10 s:

- **Lost sight**: she has been out of its sight for 1 s (the exams' rule); the
  spot is where it last saw her.
- **Hiding**: she arrives at a hiding spot (she dashed there after being spotted).

For each: walking distance from the Leaper to the spot at that moment
(rl.walk_field, body radius 1.5); reachable = a perfect walk gets within 4 units
in 10 s (distance - 4 <= 37.5 units). Then:

  headed   its walking distance to the spot fell by >= 3 units in the first 3 s
  reached  it got within 4 units of the spot
  looked   the spot came into its eye's sight (it can see the place itself)
  re_seen  it saw her again (anywhere)
"""
import argparse
import json

import numpy as np
import torch

import rl.moving_target_game_exam as game_exam
from rl.moving_target import MAP_TO_BRAIN
from rl.round1_env import Round1YardEnv
from rl.walk_field import LeaperWalk

SPEED, WINDOW, LOST_AFTER = 0.375, 100, 10


def follow(log, t0, spot, walk, field, end):
    walk0 = walk.distance(field, log[t0]["pos"], spot)
    walk3 = walk.distance(field, log[min(t0 + 30, end - 1)]["pos"], spot)
    m = dict(t=t0 / 10, walk0=float(walk0), reachable=bool(walk0 - 4.0 <= SPEED * WINDOW),
             headed=bool(walk0 - walk3 >= 3.0), reached=None, looked=None, re_seen=None,
             cut_short=bool(end - t0 < WINDOW and not log[-1]["timeout"]))
    for k in range(t0, min(end, t0 + WINDOW)):
        age = (k - t0) / 10
        if m["reached"] is None and np.linalg.norm(log[k]["pos"] - spot) <= 4.0:
            m["reached"] = age
        if m["re_seen"] is None and log[k]["seen"] and k > t0:
            m["re_seen"] = age
    return m


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="F3")
    parser.add_argument("--model")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--rounds", type=int, default=60)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    game_exam.START_APART = (10 * MAP_TO_BRAIN, 20 * MAP_TO_BRAIN)
    from rl.round1_train import input_switches
    inputs = {} if args.today else input_switches(args.run)
    if args.today:
        from rl.moving_target_brain import load_frozen_predictor
        model = load_frozen_predictor(lambda: Round1YardEnv(90000, kind="hider"))
    else:
        from rl.round1_job import load_model
        model = load_model(args.model, args.run, lambda: Round1YardEnv(90000, kind="hider", **inputs))
    walk = LeaperWalk(game_exam.yard()[2])
    lost, hides, rounds = [], [], []
    for seed in range(90000, 90000 + args.rounds):
        env = Round1YardEnv(seed, kind="hider", **inputs)
        obs, info = env.reset(seed=seed)
        log, state, moments, unseen = [], None, [], 0
        known_hidings = set()
        for step in range(1000):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]), deterministic=True)
            obs, _, term, trunc, info = env.step(action)
            seen = bool(env.target_visible)
            log.append(dict(pos=env.position.copy(), seen=seen, timeout=bool(trunc)))
            now = len(log) - 1
            # Lost sight: 1 s out of sight after being seen; the spot is where it last saw her.
            if seen:
                unseen = 0
            elif env.target_ever_seen:
                unseen += 1
                if unseen == LOST_AFTER:
                    moments.append(dict(kind="lost", t0=now - LOST_AFTER + 1,
                                        spot=np.asarray(env.last_seen_target, dtype=np.float64).copy(), looked=None))
            # Hiding: she arrives at her hiding spot.
            for i, h in enumerate(info.get("target_hidings", [])):
                if h.get("arrive") is not None and i not in known_hidings:
                    known_hidings.add(i)
                    moments.append(dict(kind="hide", t0=min(h["arrive"] - 1, now),
                                        spot=np.asarray(h["spot"], dtype=np.float64), looked=None))
            # Does its eye see the spot itself? (while the moment's 10 s are open)
            for m in moments:
                age = now - m["t0"]
                if m["looked"] is None and 0 <= age < WINDOW and env._spot_in_sight(m["spot"]):
                    m["looked"] = age / 10
            if term or trunc:
                break
        end = len(log)
        rounds.append(dict(seed=seed, touch=bool(info.get("is_success")), stuck=bool(info.get("stuck") or info.get("frozen")),
                           seconds=end / 10))
        for m in moments:
            row = follow(log, m["t0"], m["spot"], walk, walk.field(m["spot"]), end)
            row["looked"] = m["looked"]
            (lost if m["kind"] == "lost" else hides).append(dict(row, seed=seed))
        if (seed - 89999) % 15 == 0:
            print(f"{args.out}: {seed - 89999}/{args.rounds} rounds, {len(lost)} lost-sight, {len(hides)} hidings", flush=True)

    def rate(xs, key):
        return float(np.mean([x[key] is not None for x in xs])) if xs else None

    def block(xs):
        ok = [x for x in xs if x["reachable"]]
        return dict(moments=len(xs), reachable=len(ok),
                    headed=float(np.mean([x["headed"] for x in ok])) if ok else None,
                    reached_10s=rate(ok, "reached"), looked_10s=rate(ok, "looked"), re_seen_10s=rate(ok, "re_seen"),
                    reached_seconds_median=(float(np.median([x["reached"] for x in ok if x["reached"] is not None]))
                                            if any(x["reached"] is not None for x in ok) else None))
    summary = dict(rounds=len(rounds), touch=float(np.mean([r["touch"] for r in rounds])),
                   stuck=float(np.mean([r["stuck"] for r in rounds])),
                   lost_sight=block(lost), hiding=block(hides))
    with open(args.out, "w") as stream:
        json.dump(dict(summary=summary, lost=lost, hides=hides, rounds=rounds), stream, indent=1, default=float)
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
