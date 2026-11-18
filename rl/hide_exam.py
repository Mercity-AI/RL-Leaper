"""Hide exam (2026-11-18, docs/HIDE_RETRAIN_PLAN_2026-11-18.md): fixed hide scenes, the same for every brain.

    python -m rl.hide_exam --make-scenes                        # once: writes the fixed scene files
    python -m rl.hide_exam --today --out today.json             # today's game brain
    python -m rl.hide_exam --run F7GLSDP4C --model m.zip --out x.json
    python -m rl.hide_exam --oracle --out oracle.json           # the scripted seeker: the ceiling

Sets (``--set``): ``stay`` (the headline: 100 yard scenes, she never moves), ``moveon`` (40 yard scenes,
20 shift + 20 back-off) and ``arena`` (50 hide-arena stay scenes, new layouts). Scenes come from seeds
96000+ (practice never draws them) and are stored in rl_artifacts/hide_retrain_20261118/exam_scenes/,
so every brain plays exactly the same scenes. Lola's sight points are the real heights.

The brain plays its average move (as the game does) for 20 s. Per scene:

  found        seconds until its eye first sees her in her cover (natural scenes: once she reached it)
  shot         seconds until a 1 s clear shot (in sight within 20.3 units, 10 steps in a row)
  approach5    walking distance to V (where it last saw her) cut in the first 5 s, units (the drills'
               measure, body radius 1.5; a straight walk cuts up to 18.75)
  reached_v    it got within 4 units of V within 10 s
  stuck        the round ended stuck or frozen
Summary: found within 5 / 10 / 20 s, shot within 20 s, approach5 (median and mean), reached_v.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from rl import hide_scenes as hs

ROOT = Path(__file__).resolve().parents[1]
SCENE_DIR = ROOT / "rl_artifacts/hide_retrain_20261118/exam_scenes"
SETS = dict(stay=dict(count=100, seed=96000, variants=("stay",)),
            moveon=dict(count=40, seed=96500, variants=("shift", "backoff")),
            arena=dict(count=50, seed=96800, variants=("stay",)))
STEPS = 200
SWITCHES = dict(real_heights=True)


def make_scenes(name):
    """Draw a set's scenes from its fixed seeds; each row keeps the round seed so the start is rebuilt exactly."""
    spec = SETS[name]
    rng = np.random.default_rng(spec["seed"])
    rows, k = [], 0
    while len(rows) < spec["count"]:
        variant = spec["variants"][len(rows) % len(spec["variants"])]
        round_seed = hs.EXAM_SEEDS[0] + (spec["seed"] - 96000) + k
        k += 1
        env = make_env(name, round_seed, {})
        scene = hs.draw_scene(env, rng, variant=variant)
        layout = layout_hash(env)
        env.close()
        if scene is not None:
            rows.append(dict(round_seed=round_seed, scene=scene, layout=layout))
    return rows


def make_env(name, round_seed, inputs):
    if name == "arena":
        from rl.hide_arena import arena_scene_env
        return arena_scene_env(round_seed, dict(SWITCHES, **inputs))
    return hs.scene_env(round_seed, dict(SWITCHES, **inputs))


def layout_hash(env):
    """A fingerprint of an arena's block list (None in the yard), so replays use the very same arenas."""
    import hashlib
    site = getattr(env, "_site", None)
    if site is None:
        return None
    return hashlib.sha256(json.dumps([[round(float(v), 9) if not isinstance(v, str) else v for v in b]
                                      for b in site["boxes"]]).encode()).hexdigest()[:16]


def scenes(name):
    path = SCENE_DIR / f"{name}.json"
    return json.loads(path.read_text())


def play(name, rows, model=None, inputs=None):
    """Every scene of a set with ``model`` (None: the scripted seeker)."""
    inputs = inputs or {}
    out = []
    for row in rows:
        env = make_env(name, row["round_seed"], inputs)
        if row.get("layout") != layout_hash(env):
            raise RuntimeError(f"arena for round {row['round_seed']} differs from the one the exam was drawn in")
        scene = row["scene"]
        obs = hs.apply_scene(env, scene)
        corner = np.asarray(scene["corner"], dtype=np.float64)
        walker = env._walker()
        field_v = walker.field(corner)
        v0 = walker.distance(field_v, env.position, corner)
        seeker = hs.Seeker(env, scene) if model is None else None
        state, found, shot, reached, v5, streak, stuck = None, None, None, None, None, 0, False
        for step in range(STEPS):
            if seeker is not None:
                action = seeker.act()
            else:
                action, state = model.predict(obs, state=state, episode_start=np.array([step == 0]),
                                              deterministic=True)
            obs, reward, term, trunc, info = env.step(action)
            pos = np.asarray(env.position, dtype=np.float64)
            in_cover = getattr(env.mover, "state", "") == "hide"
            if found is None and env.target_visible and in_cover:
                found = (step + 1) / 10
            streak = streak + 1 if env.target_visible and env._distance() <= hs.SHOT_RANGE else 0
            if shot is None and streak >= 10:
                shot = (step + 1) / 10
            if reached is None and step < 100 and np.linalg.norm(pos - corner) <= 4.0:
                reached = (step + 1) / 10
            if step == 49:
                v5 = walker.distance(field_v, pos, corner)
            if term or trunc:
                stuck = bool(info.get("stuck") or info.get("frozen"))
                break
        if v5 is None:
            v5 = walker.distance(field_v, np.asarray(env.position, dtype=np.float64), corner)
        out.append(dict(round_seed=row["round_seed"], variant=scene["variant"], natural=scene["natural"],
                        random_facing=scene["random_facing"], found=found, shot=shot,
                        approach5=float(v0 - v5), reached_v=reached, stuck=stuck, win_walk=scene["win_walk"]))
        env.close()
    return out


def summarize(rows):
    def rate(test, xs=rows):
        return float(np.mean([test(r) for r in xs])) if xs else None
    approach = [r["approach5"] for r in rows]
    summary = dict(scenes=len(rows),
                   found5=rate(lambda r: r["found"] is not None and r["found"] <= 5),
                   found10=rate(lambda r: r["found"] is not None and r["found"] <= 10),
                   found20=rate(lambda r: r["found"] is not None),
                   shot20=rate(lambda r: r["shot"] is not None),
                   approach5_median=float(np.median(approach)), approach5_mean=float(np.mean(approach)),
                   reached_v10=rate(lambda r: r["reached_v"] is not None),
                   stuck=rate(lambda r: r["stuck"]))
    for key, test in (("natural", lambda r: r["natural"]), ("built_in", lambda r: not r["natural"])):
        part = [r for r in rows if test(r)]
        summary[f"{key}_found10"] = rate(lambda r: r["found"] is not None and r["found"] <= 10, part)
    return summary


def load(args, name):
    from rl.round1_train import input_switches
    if args.oracle:
        return None, {}
    if args.today:
        from rl.moving_target_brain import load_frozen_predictor
        return load_frozen_predictor(lambda: hs.scene_env(90000, dict(SWITCHES))), {}
    from rl.round1_job import load_model
    inputs = {k: v for k, v in input_switches(args.run).items() if k != "real_heights"}
    return load_model(args.model, args.run, lambda: hs.scene_env(90000, dict(SWITCHES, **inputs))), inputs


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--make-scenes", action="store_true")
    parser.add_argument("--set", choices=sorted(SETS), default="stay")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("--run")
    parser.add_argument("--model")
    parser.add_argument("--out")
    args = parser.parse_args()
    if args.make_scenes:
        SCENE_DIR.mkdir(parents=True, exist_ok=True)
        path = SCENE_DIR / f"{args.set}.json"
        if path.exists():
            raise FileExistsError(f"{path} exists; exam scenes are fixed and never redrawn")
        rows = make_scenes(args.set)
        path.write_text(json.dumps(rows))
        print(f"{len(rows)} {args.set} scenes -> {path}")
        return
    model, inputs = load(args, args.set)
    rows = play(args.set, scenes(args.set), model, inputs)
    summary = summarize(rows)
    if args.out:
        Path(args.out).write_text(json.dumps(dict(brain="oracle" if args.oracle else "today" if args.today else args.model,
                                                 run=args.run, set=args.set, summary=summary, scenes=rows), indent=1))
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
