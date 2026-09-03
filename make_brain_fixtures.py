"""
Generate ground-truth fixtures for the browser brain, straight from the real
Python environment + the exported ONNX brain. The JavaScript side self-tests
against these on startup, so we KNOW its 26-number recipe matches training.

Writes public/brain_fixtures.json with:
  selftest: hand-set states -> the exact 26 observation numbers Python produces,
            and the exact [throttle, turn] the ONNX brain answers.
  arenas:   a few reachable obstacle layouts + valid start poses to play in.

Run:  .venv\\Scripts\\python.exe make_brain_fixtures.py
"""

import json
import math

import numpy as np
import onnxruntime as ort

from rl_environment import LeaperReachEnv

RAY_COUNT = 16  # the champion override (env default is 8)
ONNX_PATH = "public/leaper.onnx"

session = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])
ACTION_LOW = np.array([0.0, -1.0], dtype=np.float32)
ACTION_HIGH = np.array([1.0, 1.0], dtype=np.float32)


def brain_action(obs):
    raw = session.run(None, {"observation": obs.reshape(1, -1).astype(np.float32)})[0][0]
    return np.clip(raw, ACTION_LOW, ACTION_HIGH)


def make_env():
    env = LeaperReachEnv()
    env.RAY_COUNT = RAY_COUNT  # match the champion's 16-ray vision
    env.last_vision = np.ones(RAY_COUNT, dtype=np.float32)
    return env


# --- Self-test cases: fully specified states, no randomness ------------------
selftest = []

cases = [
    {
        "name": "open-field-facing-target",
        "obstacles": [],
        "position": [0.0, 0.0],
        "yaw": -2.0,
        "previous_action": [0.0, 0.0],
        "last_collision": 0.0,
    },
    {
        "name": "obstacles-ahead",
        "obstacles": [[10.0, 10.0, 3.0], [-15.0, 5.0, 2.5], [4.0, -20.0, 3.2]],
        "position": [5.0, 5.0],
        "yaw": 1.1,
        "previous_action": [0.8, -0.3],
        "last_collision": 1.0,
    },
    {
        "name": "near-wall",
        "obstacles": [[60.0, 60.0, 3.5]],
        "position": [80.0, -70.0],
        "yaw": 0.4,
        "previous_action": [0.5, 0.9],
        "last_collision": 0.0,
    },
]

for case in cases:
    env = make_env()
    env.obstacles = tuple(tuple(o) for o in case["obstacles"])
    env.position = np.array(case["position"], dtype=np.float32)
    env.yaw = float(case["yaw"])
    env.previous_action = np.array(case["previous_action"], dtype=np.float32)
    env.last_collision = float(case["last_collision"])
    obs = env._observation()
    action = brain_action(obs)
    selftest.append(
        {
            "name": case["name"],
            "obstacles": case["obstacles"],
            "position": case["position"],
            "yaw": case["yaw"],
            "previous_action": case["previous_action"],
            "last_collision": case["last_collision"],
            "expected_observation": [float(x) for x in obs],
            "expected_action": [float(x) for x in action],
        }
    )

# --- Playable arenas: reachable layouts + a valid start pose -----------------
arenas = []
for seed in (1, 2, 3, 4, 5):
    env = make_env()
    env.reset(seed=seed)
    arenas.append(
        {
            "seed": seed,
            "obstacles": [[float(x), float(z), float(r)] for (x, z, r) in env.obstacles],
            "start": {
                "x": float(env.position[0]),
                "z": float(env.position[1]),
                "yaw": float(env.yaw),
            },
        }
    )

out = {
    "meta": {
        "ray_count": RAY_COUNT,
        "ray_max_range": LeaperReachEnv.RAY_MAX_RANGE,
        "vision_fov_deg": math.degrees(LeaperReachEnv.VISION_FOV),
        "world_limit": LeaperReachEnv.WORLD_LIMIT,
        "target": [float(LeaperReachEnv.TARGET[0]), float(LeaperReachEnv.TARGET[1])],
        "move_speed": LeaperReachEnv.MOVE_SPEED,
        "turn_speed_rad": LeaperReachEnv.TURN_SPEED,
        "agent_radius": LeaperReachEnv.AGENT_RADIUS,
        "target_radius": LeaperReachEnv.TARGET_RADIUS,
        "leg_angles": list(LeaperReachEnv.LEG_ANGLES),
        "leg_segment_radii": list(LeaperReachEnv.LEG_SEGMENT_RADII),
        "leg_collision_radius": LeaperReachEnv.LEG_COLLISION_RADIUS,
    },
    "selftest": selftest,
    "arenas": arenas,
}

with open("public/brain_fixtures.json", "w") as f:
    json.dump(out, f, indent=2)

print(f"Wrote public/brain_fixtures.json")
print(f"  {len(selftest)} self-test cases, {len(arenas)} arenas")
print(f"  meta: {RAY_COUNT} rays, world +/-{LeaperReachEnv.WORLD_LIMIT}, target {out['meta']['target']}")
