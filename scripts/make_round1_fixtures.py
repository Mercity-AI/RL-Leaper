"""Record a round-1 (38-input) brain in Python, as the oracle for the browser's opt-in path.

Run from the repository root (inference only, never trains):

    .venv/bin/python scripts/make_round1_fixtures.py \\
        --model rl_artifacts/moving_target_round1_20261115/run_F7GLSDP_try1/model_10002464.zip \\
        --run F7GLSDP --brain public/brains/leaper_r1_10002464

Writes tests/fixtures/brain-r1/ (checked by tests/brain-round1.test.js):

* round1-inputs-5.5.json: I1 and I2 straight from the TRAINING code: yard rounds of
  rl/round1_env.py Round1YardEnv (the exams' world) driven by the brain, recording after
  reset and after every step the pose, Lola, the sight memory, MovingTargetMixin's motion note
  and previous sighting, and Round1Mixin's "not there" input. The browser's I1/I2 functions
  (src/brain/junkyard/round1Inputs.js) must give the same numbers bit for bit.
* r1-*.json: the session protocol the game uses (reset / step / sense, same format as
  tests/fixtures/brain/), recorded through rl/round1_session.py Round1BrainSession with the
  game's sight range (50 map units) and Lola moving, hiding and reappearing, so both new
  inputs change. One run is driven by the brain (actions + LSTM memory recorded), one by a
  scripted action list (physics only).
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from make_junkyard_fixtures import (COLLISION, FORMAT, GLB, Recorder, env_state, floats, free_start,  # noqa: E402
                                    lola_inputs, pack, sha256_bytes, summarize)
from rl.junkyard_env import EYE_VISION, PLAYER_CONTACT  # noqa: E402
from rl.junkyard_server import JunkyardWorlds  # noqa: E402
from rl.moving_target_game_exam import SIGHT_RANGE  # noqa: E402
from rl.round1_session import ActorPredictor, Round1BrainSession  # noqa: E402

OUT = ROOT / "tests/fixtures/brain-r1"
WIDTH = 5.5
SEED0 = 91000


class World:
    def __init__(self, width):
        self.width = float(width)
        self.scale = 7.98 / self.width
        self.geometry, self.sight = JunkyardWorlds.shipped().get(self.width)

    def describe(self):
        g = self.geometry
        return dict(width=self.width, scale=self.scale, raster_shape=[int(v) for v in g.shape],
                    cell=g.cell, minimum=floats(g.minimum), maximum=floats(g.maximum))


# --- 1. The training code's own I1 / I2 ------------------------------------------------

def yard_record(env, obs, first=False):
    prev = env.previous_seen_target
    # The search sweep too: cells it cleared (all cleared cells after reset), to check the
    # browser's search_range (28, as GameExamEnv) against training.
    coverage = (np.flatnonzero(env.coverage_cleared) if first else env.coverage_new_cells)
    return dict(position=floats(env.position), yaw=float(env.yaw), target=floats(env.target),
                coverage=[int(c) for c in coverage],
                target_visible=bool(env.target_visible), target_ever_seen=bool(env.target_ever_seen),
                last_seen_target=floats(env.last_seen_target),
                previous_seen_target=None if prev is None else floats(prev),
                motion_note=floats(env.motion_note), obs_note=floats(obs[34:37]), not_there=float(obs[37]))


def record_training_inputs(model, inputs, min_steps, min_not_there):
    from rl.round1_env import Round1YardEnv
    rounds, total, empty = [], 0, 0
    seed = SEED0
    while total < min_steps or empty < min_not_there:
        env = Round1YardEnv(seed, **inputs)
        obs, _ = env.reset(seed=seed)
        records = [yard_record(env, obs, first=True)]
        state, first, done = None, True, False
        while not done:
            action, state = model.predict(obs, state=state, episode_start=np.array([first]), deterministic=True)
            obs, _, terminated, truncated, _ = env.step(action)
            first, done = False, terminated or truncated
            records.append(yard_record(env, obs))
        env.close()
        n_empty = sum(r["not_there"] == 1.0 for r in records)
        rounds.append(dict(seed=seed, records=records))
        total += len(records) - 1
        empty += n_empty
        print(f"training inputs: round {seed}: {len(records) - 1} steps, I2=1 on {n_empty}", flush=True)
        seed += 1
    return rounds


# --- 2. The session protocol (Round1BrainSession) ------------------------------------

def r1_state(session):
    state = env_state(session.env)
    prev = session.previous_seen_target
    state["round1"] = dict(motion_note=floats(session.motion_note),
                           previous_seen_target=None if prev is None else floats(prev))
    return state


def run_session(spec, world, model, brain):
    eye = EYE_VISION["eyeOffset"]
    waypoints = spec["lola"]
    start = free_start(world, spec["start"], spec["yaw"])
    target, pose = lola_inputs(waypoints, 0, eye)
    recorder = Recorder(ActorPredictor(model) if spec.get("actions") is None else None, spec.get("actions"))
    recorder.num_timesteps = model.num_timesteps
    session = Round1BrainSession(recorder, world.geometry, np.asarray(start, dtype=float), float(spec["yaw"]),
                                 np.asarray(target, dtype=float), player_collision=spec["player_collision"],
                                 sight=world.sight, sight_pose=pose, sight_range=SIGHT_RANGE)
    env = session.env
    reset = dict(width=world.width, position=start, yaw=float(spec["yaw"]), target=target,
                 player_collision=spec["player_collision"], sight_mode="eye", sight_pose=pose,
                 sight_range=SIGHT_RANGE)
    initial = dict(obs=pack(session.obs), frame=session.snapshot(), state=r1_state(session),
                   coverage=np.flatnonzero(env.coverage_cleared).tolist(),
                   world_limit=float(env.WORLD_LIMIT), coverage_steps=int(env.coverage_steps))
    steps, obs_out, senses = [], [], []
    started = time.time()
    for i in range(spec["steps"]):
        target, pose = lola_inputs(waypoints, i + 1, eye)
        frame = session.step(target, pose)
        call = recorder.calls[-1]
        steps.append(dict(input=dict(target=target, sight_pose=pose), episode_start=call["episode_start"],
                          frame=frame, state=r1_state(session),
                          coverage_new=[int(c) for c in env.coverage_new_cells]))
        obs_out.append(np.array(session.obs, dtype=np.float32))
        if spec.get("sense_every") and (i + 1) % spec["sense_every"] == 0:
            probe_target, probe_pose = lola_inputs(spec["probe"], i + 1, eye)
            env.target = np.asarray(probe_target, dtype=float)
            env.sight_pose = probe_pose
            senses.append(dict(after=i, input=dict(target=probe_target, sight_pose=env.sight_pose),
                               frame=session.snapshot(fresh_sight=True)))
    seconds = time.time() - started
    calls = recorder.calls
    arrays = dict(obs_in=pack([c["obs"] for c in calls]), obs_out=pack(obs_out),
                  action=pack([c["action"] for c in calls]))
    if spec.get("actions") is None:
        zero = np.zeros((1, 1, 64), dtype=np.float32)
        h_in = [zero if c["state"] is None else c["state"][0] for c in calls]
        c_in = [zero if c["state"] is None else c["state"][1] for c in calls]
        arrays.update(h_in=pack(np.reshape(h_in, (len(calls), 64))),
                      c_in=pack(np.reshape(c_in, (len(calls), 64))),
                      h_out=pack(np.reshape([c["new_state"][0] for c in calls], (len(calls), 64))),
                      c_out=pack(np.reshape([c["new_state"][1] for c in calls], (len(calls), 64))))
    return dict(format=FORMAT, name=spec["name"], description=spec["description"], obs_size=38,
                brain=brain, model_step=int(model.num_timesteps), scripted_actions=spec.get("actions") is not None,
                contact_version=PLAYER_CONTACT["version"], sight_version=EYE_VISION["version"],
                world=world.describe(), reset=reset, initial=initial, steps=steps, senses=senses,
                arrays=arrays), seconds / max(1, spec["steps"])


def r1_summary(fixture):
    summary = summarize(fixture)
    obs = np.frombuffer(__import__("base64").b64decode(fixture["arrays"]["obs_in"]["b64"]), dtype="<f4").reshape(-1, 38)
    notes = [tuple(row[34:37]) for row in obs]
    summary.update(not_there=int((obs[:, 37] == 1.0).sum()),
                   note_changes=sum(a != b for a, b in zip(notes, notes[1:])),
                   note_nonzero=int(np.any(obs[:, 34:37] != 0, axis=1).sum()))
    return summary


def spin(i):
    """Physics only: stand still facing her, then turn on the spot (both ways), a few short walks."""
    if i < 60:
        return [0.0, 0.0]
    if i % 120 < 60:
        return [0.0, 0.6]
    if i % 120 < 70:
        return [0.5, 0.0]
    if i % 120 < 110:
        return [0.0, -0.8]
    return [-0.4, 0.2]


def scenarios():
    return [
        dict(name="r1-eye-5.5-brain", player_collision=True, start=(2.0, -2.0), yaw=0.0, steps=500,
             description="Round-1 brain (38 inputs), game sight range. Lola starts behind it, is found, "
                         "sprints off behind cover, jumps away while unseen, comes back into the open.",
             lola=[(0, 2.0, -11.0, "stand"), (40, 2.0, -11.0, "stand"), (60, 9.0, -9.0, "stand"),
                   (80, 14.0, -10.0, "crouch"), (100, 16.0, 6.0, "stand"), (101, 22.0, 10.0, "stand"),
                   (180, 22.0, 10.0, "stand"), (210, 6.0, 20.0, "stand"), (240, -12.0, 18.0, "stand"),
                   (241, -12.0, 4.0, "crouch"), (330, -12.0, 4.0, "crouch"), (380, 0.0, -14.0, "stand"),
                   (420, 10.0, -14.0, "stand"), (421, 18.0, -2.0, "stand"), (500, 18.0, -2.0, "stand")],
             sense_every=40, probe=[(0, 4.0, 6.0, "stand"), (250, 12.0, -4.0, "crouch"), (500, -6.0, 10.0, "stand")]),
        dict(name="r1-scripted-spin-5.5", player_collision=False, start=(2.0, -2.0), yaw=0.0, steps=360,
             actions=spin,
             description="Physics only (scripted turns), round-1 inputs: it stands facing Lola as she walks "
                         "across in front, she jumps behind it (the spot where it saw her stays in view: I2), "
                         "then it turns on the spot while she walks and sprints around it.",
             lola=[(0, 2.0, 8.0, "stand"), (30, 8.0, 8.0, "stand"), (31, 2.0, -12.0, "stand"),
                   (120, 2.0, -12.0, "stand"), (140, -8.0, -8.0, "stand"),
                   (141, 12.0, 6.0, "crouch"), (220, 12.0, 6.0, "stand"), (240, 4.0, 10.0, "stand"),
                   (241, -4.0, -12.0, "stand"), (300, -4.0, -12.0, "stand"), (360, 8.0, -4.0, "stand")]),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--brain", required=True, help="the exported folder (its brain.json gives the browser spec)")
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    torch.set_num_threads(1)
    from rl.round1_env import Round1YardEnv
    from rl.round1_job import load_model
    from rl.round1_train import input_switches
    inputs = input_switches(args.run)
    model = load_model(args.model, args.run, lambda: Round1YardEnv(SEED0, **inputs))
    manifest = json.loads((Path(args.brain) / "brain.json").read_text())
    if manifest["num_timesteps"] != model.num_timesteps:
        raise SystemExit("brain.json is not this checkpoint")
    brain = dict(obsSize=38, modelStep=int(model.num_timesteps), searchRange=manifest["search_range"],
                 eye=manifest["round1_inputs"]["eye_offset"])
    args.out.mkdir(parents=True, exist_ok=True)
    index_path = args.out / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() and args.only else dict(scenarios={})
    index.update(format=FORMAT, brain_id=manifest["id"], model_step=int(model.num_timesteps),
                 policy_sha256=manifest["policy_sha256"], onnx_sha256=manifest["onnx"]["sha256"],
                 collision_sha256=sha256_bytes(COLLISION.read_bytes()), glb_sha256=sha256_bytes(GLB.read_bytes()),
                 sight_range=SIGHT_RANGE)

    if not args.only or "round1-inputs" in args.only:
        rounds = record_training_inputs(model, inputs, min_steps=1500, min_not_there=60)
        data = dict(format="leaper-round1-inputs-v1", width=WIDTH, sight_range=SIGHT_RANGE, run=args.run,
                    description="I1/I2 from rl/round1_env.py Round1YardEnv yard rounds driven by the brain: "
                                "after reset and every step", rounds=rounds)
        path = args.out / "round1-inputs-5.5.json"
        path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False))
        records = [r for rd in rounds for r in rd["records"]]
        index["round1_inputs"] = dict(file=path.name, rounds=len(rounds), records=len(records),
                                      not_there=sum(r["not_there"] == 1.0 for r in records),
                                      visible=sum(r["target_visible"] for r in records), bytes=path.stat().st_size)
        print("round1 inputs:", index["round1_inputs"], flush=True)

    world = World(WIDTH)
    for spec in scenarios():
        if args.only and spec["name"] not in args.only:
            continue
        fixture, seconds = run_session(spec, world, model, brain)
        fixture["policy_sha256"] = manifest["policy_sha256"]
        path = args.out / f"{spec['name']}.json"
        path.write_text(json.dumps(fixture, separators=(",", ":"), allow_nan=False))
        summary = r1_summary(fixture)
        index["scenarios"][spec["name"]] = dict(file=path.name, width=WIDTH, sight_mode="eye", summary=summary,
                                                bytes=path.stat().st_size)
        print(f"{spec['name']}: {summary} ({path.stat().st_size / 1e6:.2f} MB, {seconds * 1000:.0f} ms/step)", flush=True)
    index_path.write_text(json.dumps(index, indent=1, allow_nan=False) + "\n")
    print("wrote", index_path)


if __name__ == "__main__":
    main()
