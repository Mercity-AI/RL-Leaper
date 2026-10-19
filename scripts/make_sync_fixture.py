"""Record pose syncs (POST /sync) on the Python brain, as the oracle for the browser port.

Run from the repository root (inference only, never trains):

    python scripts/make_sync_fixture.py

A pose sync is game logic moving the Leaper between two brain moves (a leap).
This drives the real BrainSession from rl/junkyard_server.py through moves and
syncs, including a refused one (inside a wreck) and one with an unwrapped
heading, and saves for every event what went in, the 34 inputs the policy will
see next, the env state and the frame the HTTP server sends.
tests/brain-provider-sync.test.js replays the file through the JavaScript port
(src/brain/junkyard/brainSession.js) with the recorded actions and requires
bit-identical results. The files are not listed in tests/fixtures/brain/index.json
(brain-parity reads that list), so the existing recordings are untouched.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402
import torch  # noqa: E402

import make_junkyard_fixtures as base  # noqa: E402
from rl.junkyard_server import BrainSession, load_brain  # noqa: E402

FORMAT = "leaper-junkyard-sync-fixture-v1"


# --- The scripted runs ---------------------------------------------------------------
# Each run: a reset, then events. ("step", n) makes n brain moves; ("sync", near,
# yaw) leaps to the first free spot near `near`; ("refuse", near, yaw) tries the
# first spot near `near` inside the junkyard's scenery, which must be refused
# without changing anything.
def scenarios():
    lola = [(0, 2.0, -11.0, "stand"), (40, 2.0, -11.0, "stand"), (80, 9.0, -9.0, "crouch"),
            (120, 14.0, -10.0, "stand"), (160, 16.0, 6.0, "stand")]
    events = [("step", 15), ("sync", (2.0, -5.0), math.pi), ("step", 15),
              ("refuse", (24.0, 3.0), 0.0), ("step", 10),
              ("sync", (-8.0, 10.0), 7.5), ("step", 20), ("sync", (10.0, -4.0), -2.0), ("step", 15)]
    return [
        dict(name="sync-eye-5.5", width=5.5, sight_mode="eye", player_collision=True,
             start=(2.0, -2.0), yaw=0.0, lola=lola, events=events,
             description="Default size, eye sight: moves, a leap to face hidden Lola, a refused "
                         "leap into a wreck, a leap with an unwrapped heading, and more moves."),
        dict(name="sync-legacy-5.5", width=5.5, sight_mode="legacy", player_collision=False,
             start=(2.0, -2.0), yaw=0.0, lola=lola, events=events[:5],
             description="Default size, old flat sight: moves, a leap, a refused leap, moves."),
    ]


def blocked_spot(world, near, yaw):
    """First Leaper pose on a small spiral around `near` that hits the scenery (deterministic)."""
    for radius in np.arange(0, 12.01, 0.25):
        count = max(1, int(round(2 * math.pi * radius / 0.25)))
        for i in range(count):
            angle = 2 * math.pi * i / count
            x = float(np.float32(near[0] + radius * math.sin(angle)))
            z = float(np.float32(near[1] + radius * math.cos(angle)))
            try:
                base.JunkyardEnv(world.geometry, [x, z], yaw, [x, z])
            except ValueError:
                return (x, z)
    raise RuntimeError(f"No scenery near {near} to refuse a leap into")


def run(spec, world, model):
    eye = base.EYE_VISION["eyeOffset"]
    eye_mode = spec["sight_mode"] == "eye"
    start = base.free_start(world, spec["start"], spec["yaw"])
    target, pose = base.lola_inputs(spec["lola"], 0, eye)
    recorder = base.Recorder(model)
    session = BrainSession(recorder, world.geometry, np.asarray(start, dtype=float), float(spec["yaw"]),
                           np.asarray(target, dtype=float), player_collision=spec["player_collision"],
                           sight=world.sight if eye_mode else None, sight_pose=pose if eye_mode else None)
    env = session.env
    reset = dict(width=world.width, position=start, yaw=float(spec["yaw"]), target=target,
                 player_collision=spec["player_collision"], sight_mode=spec["sight_mode"])
    if eye_mode:
        reset["sight_pose"] = pose
    initial = dict(obs=base.pack(session.obs), frame=session.snapshot())
    events, obs_after, step = [], [], 0
    for kind, *args in spec["events"]:
        if kind == "step":
            for _ in range(args[0]):
                step += 1
                target, pose = base.lola_inputs(spec["lola"], step, eye)
                frame = session.step(target, pose if eye_mode else None)
                events.append(dict(type="step", input=dict(target=target, sight_pose=pose if eye_mode else None),
                                   frame=frame, state=base.env_state(env),
                                   coverage_new=[int(c) for c in env.coverage_new_cells]))
                obs_after.append(np.array(session.obs, dtype=np.float32))
            continue
        target, pose = base.lola_inputs(spec["lola"], step, eye)
        if kind == "sync":
            near, yaw = args
            position = base.free_start(world, near, yaw)
            frame = session.sync(np.asarray(position, dtype=float), yaw, np.asarray(target, dtype=float),
                                 pose if eye_mode else None)
            events.append(dict(type="sync", input=dict(position=position, yaw=yaw, target=target,
                                                       sight_pose=pose if eye_mode else None),
                               frame=frame, state=base.env_state(env),
                               coverage_new=[int(c) for c in env.coverage_new_cells]))
            obs_after.append(np.array(session.obs, dtype=np.float32))
        else:
            near, yaw = args
            position = blocked_spot(world, near, yaw)
            before = (base.floats(env.position), env.yaw, np.array(session.obs))
            try:
                session.sync(np.asarray(position, dtype=float), yaw, np.asarray(target, dtype=float),
                             pose if eye_mode else None)
                raise RuntimeError(f"{position} was expected to intersect the junkyard")
            except ValueError as error:
                message = str(error)
            assert (base.floats(env.position), env.yaw) == before[:2] and np.array_equal(session.obs, before[2])
            events.append(dict(type="refused", input=dict(position=list(position), yaw=yaw, target=target,
                                                          sight_pose=pose if eye_mode else None),
                               error=message))
    calls = recorder.calls
    arrays = dict(obs_in=base.pack([c["obs"] for c in calls]), action=base.pack([c["action"] for c in calls]),
                  obs_after=base.pack(obs_after))
    return dict(format=FORMAT, name=spec["name"], description=spec["description"],
                model_step=recorder.num_timesteps, contact_version=base.PLAYER_CONTACT["version"],
                sight_version=base.EYE_VISION["version"], world=world.describe(), reset=reset,
                initial=initial, events=events, arrays=arrays)


def main():
    torch.set_num_threads(1)
    model, digest = load_brain(base.MODEL)
    worlds = {}
    for spec in scenarios():
        if spec["width"] not in worlds:
            worlds[spec["width"]] = base.World(spec["width"])
        fixture = run(spec, worlds[spec["width"]], model)
        fixture["policy_sha256"] = digest
        path = base.OUT / f"{spec['name']}.json"
        path.write_text(json.dumps(fixture, separators=(",", ":"), allow_nan=False))
        kinds = [e["type"] for e in fixture["events"]]
        print(f"{spec['name']}: {kinds.count('step')} steps, {kinds.count('sync')} syncs, "
              f"{kinds.count('refused')} refused ({path.stat().st_size / 1e6:.2f} MB)", flush=True)


if __name__ == "__main__":
    main()
