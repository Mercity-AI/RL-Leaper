"""Record the Python junkyard brain step by step, as the oracle for the browser port.

Run from the repository root (inference only, never trains):

    python scripts/make_junkyard_fixtures.py

It drives the real BrainSession / JunkyardEnv from rl/junkyard_server.py through
scripted scenarios and saves, for every step, exactly what went in (Lola's
position and eye-sight body points), what the brain saw (the 34 inputs), its
LSTM memory, the action it chose, where the Leaper ended up and the frame the
HTTP server would have sent. The JavaScript port in src/brain/junkyard/ must
reproduce these files (tests/brain-parity.test.js, tests/brain-onnx.html).
It also records the eye-line test on its own (sight-lines-5.5.json, checked by
tests/brain-raster.test.js); `--only sight-lines` re-records just that file.

Nothing in rl/ is edited or monkey-patched: the checkpoint is wrapped in a small
recorder that BrainSession calls exactly like the real model.
"""
import argparse
import base64
import hashlib
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from rl.junkyard_env import EYE_VISION, PLAYER_CONTACT, JunkyardEnv  # noqa: E402
from rl.junkyard_geometry import JunkyardGeometry  # noqa: E402
from rl.junkyard_server import BrainSession, load_brain  # noqa: E402
from rl.junkyard_sight import JunkyardSight, load_triangles  # noqa: E402

COLLISION = ROOT / "assets/maps/junkyard/collision.json"
GLB = ROOT / "assets/maps/junkyard/junkyard.glb"
MODEL = ROOT / "model_7757824"
OUT = ROOT / "tests/fixtures/brain"
FORMAT = "leaper-junkyard-fixture-v1"
# The server sizes the map so a Leaper of this clearance width fits (7.98 / width).
BODY_DIAMETER = 7.98


# --- Small helpers -----------------------------------------------------------

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def floats(values):
    # float(np.float32) is exact, and JSON keeps every double exactly, so the
    # browser can rebuild the same float32 numbers with Math.fround.
    return [float(v) for v in np.asarray(values).ravel()]


def pack(array):
    """Float32 arrays travel as base64 (exact bits, about a third of the JSON size)."""
    array = np.ascontiguousarray(array, dtype="<f4")
    return dict(dtype="float32", shape=list(array.shape),
                b64=base64.b64encode(array.tobytes()).decode("ascii"))


def raster_digest(geometry):
    # Row-major [ix][iz] bytes (1 = solid), the same layout the JS raster uses.
    return sha256_bytes(np.ascontiguousarray(geometry.solid, dtype=np.uint8).tobytes())


# --- The world at one Leaper size (built exactly like junkyard_server.py) ----

class World:
    _triangles = None

    def __init__(self, width):
        started = time.time()
        self.width = float(width)
        self.scale = BODY_DIAMETER / self.width
        self.geometry = JunkyardGeometry(COLLISION, self.scale)
        if World._triangles is None:
            World._triangles = load_triangles(GLB)
        self.sight = JunkyardSight(World._triangles * self.scale)
        self.seconds = time.time() - started

    def describe(self):
        g = self.geometry
        return dict(width=self.width, scale=self.scale, raster_shape=[int(v) for v in g.shape],
                    raster_sha256=raster_digest(g), raster_solid=int(g.solid.sum()),
                    cell=g.cell, minimum=floats(g.minimum), maximum=floats(g.maximum))


def free_start(world, near, yaw):
    """First collision-free Leaper pose on a small spiral around `near` (deterministic)."""
    for radius in np.arange(0, 6.01, 0.25):
        count = max(1, int(round(2 * math.pi * radius / 0.25)))
        for i in range(count):
            angle = 2 * math.pi * i / count
            x = float(np.float32(near[0] + radius * math.sin(angle)))
            z = float(np.float32(near[1] + radius * math.cos(angle)))
            try:
                JunkyardEnv(world.geometry, [x, z], yaw, [x, z])
                return [x, z]
            except ValueError:
                continue
    raise RuntimeError(f"No free Leaper start near {near}")


# --- Scripted Lola (the target) ------------------------------------------------

# Approximate world heights of Lola's three sight bones (spine.006/.003/.001)
# standing, crouched and mid-jump. The real values come from her animated rig.
BONE_HEIGHTS = {"stand": (1.35, 1.05, 0.88), "crouch": (0.95, 0.72, 0.6), "jump": (2.2, 1.9, 1.72)}


def lola_path(waypoints, step):
    """Linear walk through (step, x, z, posture) waypoints; holds still past the last."""
    for (s0, x0, z0, p0), (s1, x1, z1, _) in zip(waypoints, waypoints[1:]):
        if s0 <= step < s1:
            t = (step - s0) / (s1 - s0)
            return x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, p0
    _, x, z, posture = waypoints[-1]
    return x, z, posture


def lola_inputs(waypoints, step, eye):
    """Target position plus the eye-vision pose the browser would send this step."""
    x, z, posture = lola_path(waypoints, step)
    # Small body offsets keep the three bones off one vertical line, like the rig.
    offsets = ((0.02, -0.04), (0.0, -0.02), (-0.01, 0.01))
    points = [[x + dx, y, z + dz] for (dx, dz), y in zip(offsets, BONE_HEIGHTS[posture])]
    return [float(x), float(z)], dict(eye=[float(v) for v in eye], points=points)


# --- Recording stand-in for the checkpoint --------------------------------------

class Recorder:
    """BrainSession calls predict() on this; it forwards to the real policy (or to
    a scripted action list for physics-only runs) and remembers every call."""

    def __init__(self, model=None, actions=None):
        self.model = model
        self.actions = actions
        self.num_timesteps = 7757824 if model is None else model.num_timesteps
        self.calls = []

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        if self.actions is not None:
            action = np.asarray(self.actions(len(self.calls)), dtype=np.float32)
            new_state = None
        else:
            action, new_state = self.model.predict(obs, state=state, episode_start=episode_start,
                                                   deterministic=deterministic)
        self.calls.append(dict(obs=np.array(obs, dtype=np.float32), state=state,
                               episode_start=bool(np.asarray(episode_start).ravel()[0]),
                               action=np.array(action, dtype=np.float32), new_state=new_state))
        return action, new_state


def env_state(env):
    """Every env field the next observation or physics step depends on."""
    return dict(
        position=floats(env.position), yaw=float(env.yaw), steps=int(env.steps),
        target=floats(env.target), last_collision=float(env.last_collision),
        previous_action=floats(env.previous_action),
        target_visible=bool(env.target_visible), target_ever_seen=bool(env.target_ever_seen),
        last_seen_target=floats(env.last_seen_target),
        steps_since_target_seen=int(env.steps_since_target_seen),
        stuck_steps=int(env.stuck_steps), idle_steps=int(env.idle_steps),
        freeze_steps=int(env.freeze_steps))


# --- One scripted run ------------------------------------------------------------

def run_scenario(spec, world, model):
    """Drive BrainSession like the HTTP server would and record every step.

    Returns (fixture, seconds per step); timings stay out of the files so a
    re-run on the same machine reproduces them byte for byte."""
    eye = spec.get("eye", EYE_VISION["eyeOffset"])
    sight_mode = spec["sight_mode"]
    waypoints = spec["lola"]
    start = free_start(world, spec["start"], spec["yaw"])
    target, pose = lola_inputs(waypoints, 0, eye)
    recorder = Recorder(model if spec.get("actions") is None else None, spec.get("actions"))
    session = BrainSession(recorder, world.geometry, np.asarray(start, dtype=float), float(spec["yaw"]),
                           np.asarray(target, dtype=float), player_collision=spec["player_collision"],
                           sight=world.sight if sight_mode == "eye" else None,
                           sight_pose=pose if sight_mode == "eye" else None)
    env = session.env
    reset = dict(width=world.width, position=start, yaw=float(spec["yaw"]), target=target,
                 player_collision=spec["player_collision"], sight_mode=sight_mode)
    # Contact v4: scenarios may sever legs as they go (spec["disabled_legs"](step)
    # -> leg indices). The server sets them on the env before each request.
    severed = spec.get("disabled_legs")
    if sight_mode == "eye":
        reset["sight_pose"] = pose
    initial = dict(obs=pack(session.obs), frame=session.snapshot(), state=env_state(env),
                   coverage=np.flatnonzero(env.coverage_cleared).tolist(),
                   world_limit=float(env.WORLD_LIMIT), coverage_steps=int(env.coverage_steps))

    # Step loop: same call order as the server's /step handler.
    steps, obs_out, senses = [], [], []
    started = time.time()
    for i in range(spec["steps"]):
        target, pose = lola_inputs(waypoints, i + 1, eye)
        request = dict(target=target, sight_pose=pose if sight_mode == "eye" else None)
        if severed is not None:
            request["disabled_legs"] = sorted(severed(i))
            env.disabled_legs = frozenset(request["disabled_legs"])
        frame = session.step(target, pose if sight_mode == "eye" else None)
        call = recorder.calls[-1]
        steps.append(dict(input=request,
                          episode_start=call["episode_start"], frame=frame, state=env_state(env),
                          coverage_new=[int(c) for c in env.coverage_new_cells]))
        obs_out.append(np.array(session.obs, dtype=np.float32))
        if spec.get("sense_every") and (i + 1) % spec["sense_every"] == 0:
            # The server's paused /sense preview, verbatim: it stores Lola's position
            # as float64 (vector()) and the pose, then snapshots. No policy or memory.
            probe_target, probe_pose = lola_inputs(spec["probe"], i + 1, eye)
            env.target = np.asarray(probe_target, dtype=float)
            env.sight_pose = probe_pose if sight_mode == "eye" else None
            senses.append(dict(after=i, input=dict(target=probe_target, sight_pose=env.sight_pose),
                               frame=session.snapshot(fresh_sight=True)))
    seconds = time.time() - started

    # Packed float32 arrays: the inputs the policy saw, its action and its memory.
    calls = recorder.calls
    arrays = dict(obs_in=pack([c["obs"] for c in calls]), obs_out=pack(obs_out),
                  action=pack([c["action"] for c in calls]))
    if spec.get("actions") is None:
        zero = np.zeros((1, 1, 64), dtype=np.float32)
        h_in = [zero if c["state"] is None else c["state"][0] for c in calls]
        c_in = [zero if c["state"] is None else c["state"][1] for c in calls]
        arrays.update(h_in=pack(np.reshape(h_in, (len(calls), 64))),
                      c_in=pack(np.reshape(c_in, (len(calls), 64))),
                      h_out=pack(np.reshape(calls[-1]["new_state"][0], (64,))),
                      c_out=pack(np.reshape(calls[-1]["new_state"][1], (64,))))
    return dict(format=FORMAT, name=spec["name"], description=spec["description"],
                model_step=recorder.num_timesteps, scripted_actions=spec.get("actions") is not None,
                contact_version=PLAYER_CONTACT["version"], sight_version=EYE_VISION["version"],
                world=world.describe(), reset=reset, initial=initial, steps=steps, senses=senses,
                arrays=arrays), seconds / max(1, spec["steps"])


# --- Eye lines on their own: the exact arithmetic of the sight test ----------------

SIGHT_LINE_WIDTH = 5.5
SIGHT_LINE_FILE = "sight-lines-5.5.json"


def pack64(array):
    """Float64 arrays as base64 (exact bits), like pack() for float32."""
    array = np.ascontiguousarray(array, dtype="<f8")
    return dict(dtype="float64", shape=list(array.shape),
                b64=base64.b64encode(array.tobytes()).decode("ascii"))


def record_sight_lines(count=600):
    """JunkyardSight.hit on random eye-to-Lola lines and on lines aimed exactly
    at triangle edges and corners, so the JS port's hit points (the debug sight
    lines) and its edge decisions can be checked bit for bit, independently of
    the Leaper's heading maths."""
    scale = BODY_DIAMETER / SIGHT_LINE_WIDTH
    if World._triangles is None:
        World._triangles = load_triangles(GLB)
    sight = JunkyardSight(World._triangles * scale)
    rng = np.random.default_rng(21)
    low, high = sight.low.min(axis=0), sight.high.max(axis=0)
    origins, ends = [], []
    # Lines like the eye check: eye height to Lola's bones, up to 30 units away.
    for _ in range(count):
        origin = [rng.uniform(low[0], high[0]), rng.uniform(1.5, 3.5), rng.uniform(low[2], high[2])]
        angle, reach = rng.uniform(-math.pi, math.pi), rng.uniform(0.5, 30.0)
        origins.append(origin)
        ends.append([origin[0] + math.sin(angle) * reach, rng.uniform(0.4, 2.4), origin[2] + math.cos(angle) * reach])
    # Knife-edge lines through a point on a triangle's edge or exactly a corner.
    for _ in range(count):
        tri = sight.triangles[rng.integers(len(sight.triangles))]
        i = int(rng.integers(3))
        w = rng.uniform(0, 1) if rng.random() < 0.8 else float(rng.integers(2))
        point = tri[i] + (tri[(i + 1) % 3] - tri[i]) * w
        direction = rng.normal(0, 1, 3)
        direction /= np.linalg.norm(direction)
        origins.append((point - direction * rng.uniform(0.2, 8.0)).tolist())
        ends.append((point + direction * rng.uniform(-0.5, 8.0)).tolist())
    hits = [sight.hit(np.asarray(o, float), np.asarray(e, float)) for o, e in zip(origins, ends)]
    found = [h is not None for h in hits]
    points = [h if h is not None else [0.0, 0.0, 0.0] for h in hits]
    return dict(format=FORMAT, name="sight-lines-5.5", width=SIGHT_LINE_WIDTH, scale=scale,
                description="Python JunkyardSight.hit for random eye lines and lines through "
                            "triangle edges/corners (map scaled for Leaper width 5.5).",
                count=len(hits), hits=int(sum(found)), found=found,
                arrays=dict(origins=pack64(origins), ends=pack64(ends), points=pack64(points)))


def summarize(fixture):
    """Plain counts so a person can see each scenario covers what it claims."""
    frames = [s["frame"] for s in fixture["steps"]]
    actions = np.frombuffer(base64.b64decode(fixture["arrays"]["action"]["b64"]), dtype="<f4").reshape(-1, 2)
    parts = {}
    for f in frames:
        if f["collision"]:
            parts[f["collisionPart"]] = parts.get(f["collisionPart"], 0) + 1
    # Contact v4 runs also count the steps taken with severed legs.
    severed = sum(1 for s in fixture["steps"] if s["input"].get("disabled_legs"))
    return dict(
        **({"severed_leg_steps": severed} if severed else {}),
        steps=len(frames),
        hidden_before_seen=sum(not f["target_ever_seen"] for f in frames),
        visible=sum(f["target_visible"] for f in frames),
        hidden_with_memory=sum(f["target_ever_seen"] and not f["target_visible"] for f in frames),
        collisions=parts, reverse=int((actions[:, 0] < 0).sum()),
        caught=sum(f["caught"] for f in frames),
        partial_eye=sum(1 for f in frames if f["sight"] and 0 < sum(f["sight"]["clear"]) < 3),
        moved=round(float(np.hypot(frames[-1]["x"] - fixture["reset"]["position"][0],
                                   frames[-1]["z"] - fixture["reset"]["position"][1])), 2))


# --- Scenarios ------------------------------------------------------------------

def scripted_drive(i):
    """Physics-only action script: ram, scrape, turn, reverse, clip and creep."""
    if i < 50:
        return [1.0, 0.0]            # straight ahead until something blocks
    if i < 70:
        return [1.0, 0.6]            # keep pushing while turning (rotation recovery)
    if i < 95:
        return [-1.0, 0.0]           # signed reverse straight back out
    if i < 115:
        return [0.0, -1.0]           # turn on the spot
    if i < 125:
        return [1.7, -1.6]           # out-of-range numbers are clipped to [-1, 1]
    if i < 150:
        return [0.35, 0.25 * math.sin(i)]
    if i < 175:
        return [-0.6, 0.9]           # reverse while turning
    return [1.0, -0.3 if (i // 20) % 2 else 0.4]


def scripted_contact(i):
    """Physics-only: walk into Lola, get blocked, back away, turn into her, retry."""
    if i < 25:
        return [1.0, 0.0]
    if i < 40:
        return [-1.0, 0.0]
    if i < 60:
        return [0.0, 1.0 if i % 2 else 0.8]
    if i < 80:
        return [0.0, -1.0]
    if i < 110:
        return [1.0, 0.15]
    return [-0.5 if i % 7 == 0 else 0.8, -0.2]


def scripted_sweep(i):
    """Physics only: turn on the spot, 20 steps one way, 20 back (legs sweep past Lola)."""
    return [0.0, 1.0] if i % 40 < 20 else [0.0, -1.0]


def severed_left_legs(i):
    """Contact v4: all legs intact for 80 steps, then the three left legs shot off."""
    return [] if i < 80 else [0, 2, 4]


# The close-contact scenes are staged in one open patch of the yard. They were
# written for the first junkyard around (2, 18); junkyard_v2 has scenery there,
# so the whole scene (Leaper and Lola alike) is moved by this offset.
CONTACT_SHIFT = (14.0, -14.0)


def shifted(spec, offset=CONTACT_SHIFT):
    """The same scene, moved: its start, Lola's path and any probes."""
    dx, dz = offset
    move = lambda keys: [(t, x + dx, z + dz, pose) for t, x, z, pose in keys]
    spec = dict(spec, start=(spec["start"][0] + dx, spec["start"][1] + dz), lola=move(spec["lola"]))
    if "probe" in spec:
        spec["probe"] = move(spec["probe"])
    return spec


def scenarios():
    """Each run states the width, sight mode and what it is there to exercise."""
    return [
        dict(name="eye-5.5-hide-seek", width=5.5, sight_mode="eye", player_collision=True,
             start=(2.0, -2.0), yaw=0.0, steps=420,
             description="Default size, eye sight. Lola starts behind the Leaper (hidden), "
                         "waits to be found, then runs off behind cover so it must use memory.",
             lola=[(0, 2.0, -11.0, "stand"), (70, 2.0, -11.0, "stand"), (120, 9.0, -9.0, "crouch"),
                   (170, 14.0, -10.0, "stand"), (230, 16.0, 6.0, "stand"), (300, 6.0, 20.0, "jump"),
                   (330, 6.0, 20.0, "stand"), (420, -12.0, 18.0, "stand")],
             sense_every=30, probe=[(0, 4.0, 6.0, "stand"), (210, 12.0, -4.0, "crouch"),
                                    (420, -6.0, 10.0, "stand")]),
        dict(name="legacy-5.5-hide-seek", width=5.5, sight_mode="legacy", player_collision=False,
             start=(2.0, -2.0), yaw=0.0, steps=360,
             description="Default size, old flat 2D sight (no eye pose). Same hide, seen, "
                         "run-away script as the eye run.",
             lola=[(0, 2.0, -11.0, "stand"), (70, 2.0, -11.0, "stand"), (120, 9.0, -9.0, "stand"),
                   (170, 14.0, -10.0, "stand"), (230, 16.0, 6.0, "stand"), (300, 6.0, 20.0, "stand"),
                   (360, -12.0, 18.0, "stand")],
             sense_every=30, probe=[(0, 4.0, 6.0, "stand"), (360, -6.0, 10.0, "stand")]),
        dict(name="eye-7.98-chase", width=7.98, sight_mode="eye", player_collision=True,
             start=(1.5, -3.0), yaw=math.pi / 2, steps=300,
             description="Largest clearance (map scale exactly 1): a tight yard, Lola in front then fleeing.",
             lola=[(0, 1.5, 6.0, "stand"), (60, 1.5, 6.0, "stand"), (140, 8.0, 14.0, "stand"),
                   (220, -6.0, 14.0, "crouch"), (300, -12.0, 3.0, "stand")]),
        dict(name="eye-2.9-search", width=2.9, sight_mode="eye", player_collision=True,
             start=(4.0, -4.0), yaw=-2.0, steps=300,
             description="Small Leaper (big map, 45x45 search grid): long search, then a sighting.",
             lola=[(0, 30.0, 30.0, "stand"), (150, 30.0, 30.0, "stand"), (220, 12.0, 8.0, "stand"),
                   (300, -20.0, 6.0, "stand")]),
        shifted(dict(name="eye-5.5-contact", width=5.5, sight_mode="eye", player_collision=True,
             start=(2.0, 18.0), yaw=math.pi / 2, steps=220,
             description="Lola stands in the open close by; the brain walks into her and the "
                         "player-contact discs block it, then she sidesteps.",
             lola=[(0, 9.5, 19.0, "stand"), (120, 9.5, 19.0, "stand"), (160, 10.5, 23.0, "crouch"),
                   (220, 10.5, 23.0, "stand")])),
        # (16, 18) facing +z in junkyard_v2: a wall run that also catches a pole
        # between the legs, so the inner leg samples (leg-1) collide too.
        dict(name="scripted-collide-reverse-5.5", width=5.5, sight_mode="eye", player_collision=False,
             start=(16.0, 18.0), yaw=0.0, steps=220, actions=scripted_drive,
             description="Physics only (scripted actions, no policy): ram a wall, keep pushing "
                         "while turning, signed reverse, turn on the spot, clipped inputs.",
             lola=[(0, -10.0, -25.0, "stand")]),
        shifted(dict(name="scripted-player-contact-5.5", width=5.5, sight_mode="legacy", player_collision=True,
             start=(2.0, 18.0), yaw=math.pi / 2, steps=150, actions=scripted_contact,
             description="Physics only: Lola just ahead of the front feet. Forward is blocked "
                         "by 'player' contact, reversing away is allowed, Lola then walks in.",
             lola=[(0, 6.6, 18.0, "stand"), (100, 6.6, 18.0, "stand"), (130, 5.0, 18.6, "stand"),
                   (150, 5.0, 18.6, "stand")])),
        shifted(dict(name="scripted-severed-legs-5.5", width=5.5, sight_mode="legacy", player_collision=True,
             start=(2.0, 18.0), yaw=math.pi / 2, steps=240, actions=scripted_sweep,
             disabled_legs=severed_left_legs,
             description="Contact rules v4, physics only: the Leaper sweeps its legs past Lola on its "
                         "left. Intact legs are blocked by her ('player'); once the three left legs are "
                         "severed (step 80) only their stumps remain and the sweep passes. Then Lola "
                         "stands on the right, where the intact legs still bump into her.",
             lola=[(0, 2.0, 22.4, "stand"), (160, 2.0, 22.4, "stand"), (161, 2.0, 13.6, "stand"),
                   (240, 2.0, 13.6, "stand")])),
    ]


# --- Main --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", nargs="*", help="scenario names to (re)record")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    torch.set_num_threads(1)
    model, digest = load_brain(MODEL)
    args.out.mkdir(parents=True, exist_ok=True)

    # Build each world once (the raster takes ~30 s per size, like the server).
    worlds, index = {}, dict(format=FORMAT, model_step=model.num_timesteps, policy_sha256=digest,
                             contact_version=PLAYER_CONTACT["version"], sight_version=EYE_VISION["version"],
                             collision_sha256=sha256_bytes(COLLISION.read_bytes()),
                             glb_sha256=sha256_bytes(GLB.read_bytes()), worlds={}, scenarios={})
    previous = args.out / "index.json"
    if args.only and previous.exists():
        index["scenarios"] = json.loads(previous.read_text())["scenarios"]
    for spec in scenarios():
        if args.only and spec["name"] not in args.only:
            continue
        if spec["width"] not in worlds:
            worlds[spec["width"]] = World(spec["width"])
            print(f"world width {spec['width']}: raster {worlds[spec['width']].geometry.shape.tolist()} "
                  f"built in {worlds[spec['width']].seconds:.1f} s", flush=True)
        world = worlds[spec["width"]]
        fixture, seconds = run_scenario(spec, world, model)
        fixture["policy_sha256"] = digest
        path = args.out / f"{spec['name']}.json"
        path.write_text(json.dumps(fixture, separators=(",", ":"), allow_nan=False))
        summary = summarize(fixture)
        index["scenarios"][spec["name"]] = dict(file=path.name, width=spec["width"],
                                                sight_mode=spec["sight_mode"], summary=summary,
                                                bytes=path.stat().st_size)
        print(f"{spec['name']}: {summary} ({path.stat().st_size / 1e6:.2f} MB, "
              f"{seconds * 1000:.0f} ms/step in Python)", flush=True)

    # The eye-line test on its own (`--only sight-lines` re-records just this file).
    if not args.only or "sight-lines" in args.only:
        lines = record_sight_lines()
        path = args.out / SIGHT_LINE_FILE
        path.write_text(json.dumps(lines, separators=(",", ":"), allow_nan=False))
        index["sight_lines"] = dict(file=path.name, width=lines["width"], count=lines["count"],
                                    hits=lines["hits"], bytes=path.stat().st_size)
        print(f"sight lines: {lines['count']} lines, {lines['hits']} hits", flush=True)
    elif previous.exists() and "sight_lines" in json.loads(previous.read_text()):
        index["sight_lines"] = json.loads(previous.read_text())["sight_lines"]

    # World facts the JS port must reproduce bit for bit (rasters, GLB triangles).
    triangles = World._triangles if World._triangles is not None else load_triangles(GLB)
    index["glb_triangles"] = dict(count=int(len(triangles)),
                                  sha256=sha256_bytes(np.ascontiguousarray(triangles, dtype="<f8").tobytes()))
    for width, world in sorted(worlds.items()):
        index["worlds"][str(width)] = world.describe()
    if args.only and previous.exists():
        for key, value in json.loads(previous.read_text())["worlds"].items():
            index["worlds"].setdefault(key, value)
    (args.out / "index.json").write_text(json.dumps(index, indent=1, allow_nan=False) + "\n")
    print("wrote", args.out / "index.json")


if __name__ == "__main__":
    main()
