"""Seek-and-find behaviour probe (2026-11-16): what the Leaper does when it loses Lola.

    python -m rl.behaviour_probe --run F7 --model path.zip --out out.json.gz [--rounds 80]
    python -m rl.behaviour_probe --today --out out.json.gz

Builds on rl/lastseen_probe.py (same rounds: real yard, eye-level sight, hider-only
rounds, Lola starting 10-20 map units away so her spots are within reach, seeds
90000+, the brain's average move as the game plays it) and adds the heading, a
stricter "genuine loss" and the hidings it watched. Every step is logged, so the
rounds can be drawn on the yard map (rl/behaviour_map.py).

Moments (each followed for 10 s from when it happens):

- **Genuine loss**: she has been out of its sight for 3 s in a row (it really lost
  her, not a flicker), the spot where it last saw her is more than 6 units away
  and a perfect walk could get there in 10 s. Followed from the first unseen step.
- **Watched hiding**: it saw her during her dash to a hiding spot (she dashes when
  it spots her), the spot is more than 6 units away and reachable in 10 s.
  Followed from the step she arrives.

Per moment:

  faces    share of the first 3 s its body points within 45 degrees of the first
           step of the shortest walk to the spot (walking route, around junk)
  headed   its walking distance to the spot fell by >= 3 units in the first 3 s
  reached  it got within 4 units of the spot within 10 s
  re_seen  it saw her again within 10 s (anywhere)
  looked   the spot itself came into its eye's sight within 10 s

All followed by round-level numbers: touch, stuck/frozen, and the share of steps
she is in its sight once it has first seen her.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math

import numpy as np
import torch

import rl.moving_target_game_exam as game_exam
from rl.moving_target import MAP_TO_BRAIN
from rl.round1_env import Round1YardEnv
from rl.walk_field import LeaperWalk

SPEED, WINDOW, EARLY = 0.375, 100, 30       # Leaper units/step, 10 s, 3 s
LOST_FOR = 30                               # genuine loss: unseen 3 s in a row
MIN_AWAY = 6.0                              # the spot is more than 6 units away
FACING = math.radians(45)
SEEDS_FROM = 90000


def downhill(walk, field, point):
    """Direction (x, z) of the first step of the shortest walk from ``point`` (None if unknown)."""
    point = np.asarray(point, dtype=np.float64)
    i, j = np.clip(np.floor((point - walk.origin) / walk.cell).astype(int), 0, np.asarray(field.shape) - 1)
    here = walk.distance(field, point, point)
    best, target = here, None
    for di in (-2, -1, 0, 1, 2):
        for dj in (-2, -1, 0, 1, 2):
            a, b = i + di, j + dj
            if (di or dj) and 0 <= a < field.shape[0] and 0 <= b < field.shape[1] and math.isfinite(field[a, b]):
                if field[a, b] < best - 1e-9:
                    best, target = field[a, b], walk.origin + (np.array([a, b]) + 0.5) * walk.cell
    if target is None:
        return None
    d = target - point
    n = float(np.linalg.norm(d))
    return d / n if n > 1e-9 else None


def follow(log, t0, spot, walk, field, end):
    k3 = min(t0 + EARLY, end - 1)
    walk0 = walk.distance(field, log[t0]["pos"], spot)
    walk3 = walk.distance(field, log[k3]["pos"], spot)
    facing = []
    for k in range(t0, min(end, t0 + EARLY)):
        route = downhill(walk, field, log[k]["pos"])
        if route is None:
            continue
        bearing = math.atan2(route[0], route[1])
        facing.append(abs((bearing - log[k]["yaw"] + math.pi) % (2 * math.pi) - math.pi) <= FACING)
    m = dict(t=t0 / 10, walk0=float(walk0), straight0=float(np.linalg.norm(log[t0]["pos"] - spot)),
             reachable=bool(walk0 - 4.0 <= SPEED * WINDOW), headed=bool(walk0 - walk3 >= 3.0),
             faces=float(np.mean(facing)) if facing else None, reached=None, re_seen=None, looked=None,
             cut_short=bool(end - t0 < WINDOW and not log[-1]["timeout"]),
             leaper=log[t0]["pos"].tolist(), spot=[float(v) for v in spot])
    best = walk0
    for k in range(t0, min(end, t0 + WINDOW)):
        age = (k - t0) / 10
        if m["reached"] is None and np.linalg.norm(log[k]["pos"] - spot) <= 4.0:
            m["reached"] = age
        if m["re_seen"] is None and log[k]["seen"] and k > t0:
            m["re_seen"] = age
    m["closest_walk"] = float(min(walk.distance(field, log[k]["pos"], spot)
                                  for k in range(t0, min(end, t0 + WINDOW), 5)) if end > t0 else best)
    return m


def load_brain(args, inputs):
    if args.today:
        from rl.moving_target_brain import load_frozen_predictor
        return load_frozen_predictor(lambda: Round1YardEnv(SEEDS_FROM, kind="hider"))
    if args.run == "A":
        from rl.moving_target_job import load
        return load(args.model, "A")
    from rl.round1_job import load_model
    return load_model(args.model, args.run, lambda: Round1YardEnv(SEEDS_FROM, kind="hider", **inputs))


def play(model, inputs, seeds, walk, keep_paths=True, world=None, deterministic=True):
    genuine, hidings, rounds = [], [], []
    for seed in seeds:
        env = Round1YardEnv(seed, kind="hider", **inputs, **(world or {}))
        obs, info = env.reset(seed=seed)
        log, state = [], None
        first_seen = None
        for step in range(1000):
            action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]),
                                          deterministic=deterministic)
            obs, reward, term, trunc, info = env.step(action)
            seen = bool(env.target_visible)
            if seen and first_seen is None:
                first_seen = step
            log.append(dict(pos=env.position.copy(), yaw=float(env.yaw), seen=seen, timeout=bool(trunc),
                            her=np.asarray(env.target, dtype=np.float64).copy(),
                            last_seen=(None if not env.target_ever_seen
                                       else np.asarray(env.last_seen_target, dtype=np.float64).copy()),
                            bump=bool(info.get("collision", False))))
            if term or trunc:
                break
        end = len(log)
        # Genuine losses: unseen 3 s in a row after having seen her.
        streak, start = 0, None
        for k, row in enumerate(log):
            if row["seen"]:
                streak, start = 0, None
                continue
            if row["last_seen"] is None:
                continue
            if streak == 0:
                start = k
            streak += 1
            if streak == LOST_FOR:
                spot = log[start]["last_seen"]
                field = walk.field(spot)
                m = follow(log, start, spot, walk, field, end)
                if m["walk0"] > MIN_AWAY and m["reachable"]:
                    genuine.append(dict(m, seed=seed))
        # Watched hidings: it saw her during the dash to the spot.
        for h in info.get("target_hidings", []):
            if h.get("arrive") is None or h["arrive"] - 1 >= end:
                continue
            t_arrive = max(0, h["arrive"] - 1)
            dash = range(max(0, h["start"] - 1), t_arrive + 1)
            if not any(log[k]["seen"] for k in dash if k < end):
                continue
            spot = np.asarray(h["spot"], dtype=np.float64)
            field = walk.field(spot)
            m = follow(log, t_arrive, spot, walk, field, end)
            if m["walk0"] > MIN_AWAY and m["reachable"]:
                saw_arrive = any(log[k]["seen"] for k in range(max(0, t_arrive - 10), t_arrive + 1))
                hidings.append(dict(m, seed=seed, saw_arrive=bool(saw_arrive)))
        for moments in (genuine, hidings):
            for m in moments:
                if m["seed"] == seed and m["looked"] is None:
                    spot = np.asarray(m["spot"])
                    t0 = int(round(m["t"] * 10))
                    for k in range(t0, min(end, t0 + WINDOW), 2):
                        env.position[:] = log[k]["pos"]
                        env.yaw = log[k]["yaw"]
                        if env._spot_in_sight(spot):
                            m["looked"] = (k - t0) / 10
                            break
        after = [r["seen"] for r in log[first_seen:]] if first_seen is not None else []
        rounds.append(dict(seed=seed, steps=end, touch=bool(info.get("is_success")),
                           stuck=bool(info.get("stuck") or info.get("frozen")),
                           first_seen_s=None if first_seen is None else first_seen / 10,
                           in_sight_share=float(np.mean(after)) if after else None,
                           bumps=int(sum(r["bump"] for r in log)),
                           path=([[round(float(r["pos"][0]), 2), round(float(r["pos"][1]), 2),
                                   round(r["yaw"], 3), int(r["seen"]),
                                   round(float(r["her"][0]), 2), round(float(r["her"][1]), 2)] for r in log]
                                 if keep_paths else None),
                           hidings=info.get("target_hidings", [])))
        env.close()
    return genuine, hidings, rounds


def rate(xs, test):
    return float(np.mean([test(x) for x in xs])) if xs else None


def summarize(genuine, hidings, rounds):
    def block(xs):
        faces = [x["faces"] for x in xs if x["faces"] is not None]
        found = [x["re_seen"] for x in xs if x["re_seen"] is not None]
        return dict(moments=len(xs), faces=float(np.mean(faces)) if faces else None,
                    headed=rate(xs, lambda x: x["headed"]), reached=rate(xs, lambda x: x["reached"] is not None),
                    re_seen=rate(xs, lambda x: x["re_seen"] is not None),
                    looked=rate(xs, lambda x: x["looked"] is not None),
                    re_seen_median_s=float(np.median(found)) if found else None)
    shares = [r["in_sight_share"] for r in rounds if r["in_sight_share"] is not None]
    return dict(rounds=len(rounds), touch=rate(rounds, lambda r: r["touch"]),
                stuck=rate(rounds, lambda r: r["stuck"]),
                in_sight_share=float(np.mean(shares)) if shares else None,
                genuine_loss=block(genuine), watched_hiding=block(hidings),
                watched_hiding_saw_arrive=block([h for h in hidings if h["saw_arrive"]]))


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="F3")
    parser.add_argument("--model")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--rounds", type=int, default=150)
    parser.add_argument("--out", required=True)
    parser.add_argument("--eye-hide", action="store_true",
                        help="Lola hides only where the Leaper's eye cannot see her (rl/round1_env.py eye_hide)")
    parser.add_argument("--sampled", action="store_true", help="sample the brain's moves (torch seed fixed) instead of the average move")
    args = parser.parse_args()
    if args.sampled:
        torch.manual_seed(90000)
    game_exam.START_APART = (10 * MAP_TO_BRAIN, 20 * MAP_TO_BRAIN)
    from rl.round1_train import input_switches
    inputs = {} if args.today or args.run == "A" else input_switches(args.run)
    model = load_brain(args, inputs)
    walk = LeaperWalk(game_exam.yard()[2])
    world = dict(eye_hide=True) if args.eye_hide else None
    genuine, hidings, rounds = play(model, inputs, range(SEEDS_FROM, SEEDS_FROM + args.rounds), walk, world=world,
                                    deterministic=not args.sampled)
    summary = summarize(genuine, hidings, rounds)
    with gzip.open(args.out, "wt") as stream:
        json.dump(dict(brain=("today" if args.today else args.model), run=("today" if args.today else args.run),
                       world=world or {},
                       summary=summary, genuine=genuine, hidings=hidings, rounds=rounds), stream, default=float)
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
