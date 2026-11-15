"""Why does the Leaper rarely check Lola's hiding spot? (diagnostic, 2026-11-15)

    python -m rl.hide_diagnostic --run F7 --model path/to/model.zip --rounds 50 --out out.json
    python -m rl.hide_diagnostic --today --rounds 50 --out out.json

Plays hider-only rounds in the real yard (seeds 80000+, not the exam's), the
brain deciding deterministically, and follows every hiding run: Lola is
spotted, sprints to cover the Leaper cannot see, and stays 30-60 s. From the
moment she arrives, over 10 s (the plan's H4 window) and 30 s:

  seen_in_spot   it sees her while she is hiding there (in the game: a shot)
  reached        it gets within 4 units of the spot (the plan's H4)
  unreachable    not even a perfect walk could get within 4 units in 10 s
                 (walking distance at her arrival - 4 > 37.5 units)
  headed_there   its walking distance to the spot fell by >= 3 units in the first 3 s
  bumps          share of the 10 s it spent pushing into something
  ended          the round ended inside the window (stuck, frozen, timeout)

Walking distance: rl.walk_field (body radius 1.5, 1-unit grid).
"""
import argparse
import json

import numpy as np
import torch

from rl.moving_target_game_exam import yard
from rl.round1_env import Round1YardEnv
from rl.walk_field import LeaperWalk

SPEED = 0.375


def classify(m):
    if m["seen10"] is not None:
        return "seen_in_spot"
    if m["reached10"] is not None:
        return "reached_not_seen"
    if m["ended10"]:
        return "round_ended"
    if m["walk0"] - 4.0 > SPEED * 100:
        return "unreachable_in_10s"
    if m["headed"]:
        return "headed_there_not_in_time"
    return "went_elsewhere"


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="F3")
    parser.add_argument("--model")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--rounds", type=int, default=50)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    from rl.round1_train import input_switches
    inputs = {} if args.today else input_switches(args.run)
    if args.today:
        from rl.moving_target_brain import load_frozen_predictor
        model = load_frozen_predictor(lambda: Round1YardEnv(80000, kind="hider"))
    else:
        from rl.round1_job import load_model
        model = load_model(args.model, args.run, lambda: Round1YardEnv(80000, kind="hider", **inputs))
    walk = LeaperWalk(yard()[2])
    moments = []
    for seed in range(80000, 80000 + args.rounds):
        env = Round1YardEnv(seed, kind="hider", **inputs)
        obs, info = env.reset(seed=seed)
        log = []
        state = None
        for step in range(1000):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]), deterministic=True)
            obs, _, term, trunc, info = env.step(action)
            log.append(dict(pos=env.position.copy(), seen=bool(env.target_visible), her=info.get("target_state"),
                            bump=bool(info.get("collision")), end=bool(term or trunc)))
            if term or trunc:
                break
        end_step = len(log)
        for h in info.get("target_hidings", []):
            arrive = h.get("arrive")
            if arrive is None or arrive > end_step:
                continue
            spot = np.asarray(h["spot"])
            field = walk.field(spot)
            t0 = arrive - 1                       # log index of her arrival step
            walk0 = walk.distance(field, log[t0]["pos"], spot)
            walk3 = walk.distance(field, log[min(t0 + 30, end_step - 1)]["pos"], spot)
            m = dict(seed=seed, arrive_s=arrive / 10, walk0=walk0, straight0=float(np.linalg.norm(log[t0]["pos"] - spot)),
                     headed=bool(walk0 - walk3 >= 3.0), ended10=bool(end_step - t0 <= 100 and log[-1]["end"]))
            for window in (10, 30):
                seen = reached = None
                for k in range(t0, min(end_step, t0 + window * 10)):
                    if seen is None and log[k]["seen"] and log[k]["her"] == "hide":
                        seen = (k - t0) / 10
                    if reached is None and np.linalg.norm(log[k]["pos"] - spot) <= 4.0:
                        reached = (k - t0) / 10
                m[f"seen{window}"], m[f"reached{window}"] = seen, reached
            span = log[t0:min(end_step, t0 + 100)]
            m["bumps"] = float(np.mean([s["bump"] for s in span])) if span else 0.0
            m["case"] = classify(m)
            moments.append(m)
        if (seed - 79999) % 10 == 0:
            print(f"{args.out}: {seed - 79999}/{args.rounds} rounds, {len(moments)} hidings", flush=True)
    n = len(moments)
    cases = {}
    for m in moments:
        cases[m["case"]] = cases.get(m["case"], 0) + 1
    summary = dict(
        hidings=n,
        cases={k: round(v / n, 3) for k, v in sorted(cases.items(), key=lambda kv: -kv[1])},
        H4_reached_in_10s=float(np.mean([m["reached10"] is not None for m in moments])),
        seen_in_spot_10s=float(np.mean([m["seen10"] is not None for m in moments])),
        seen_in_spot_30s=float(np.mean([m["seen30"] is not None for m in moments])),
        reached_in_30s=float(np.mean([m["reached30"] is not None for m in moments])),
        reachable_in_10s=float(np.mean([m["walk0"] - 4.0 <= SPEED * 100 for m in moments])),
        walk_distance_at_arrival_median=float(np.median([m["walk0"] for m in moments])),
        detour_ratio_median=float(np.median([m["walk0"] / max(m["straight0"], 1e-6) for m in moments])),
        headed_there=float(np.mean([m["headed"] for m in moments])),
        bump_share_median=float(np.median([m["bumps"] for m in moments])))
    with open(args.out, "w") as stream:
        json.dump(dict(summary=summary, moments=moments), stream, indent=1, default=float)
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
