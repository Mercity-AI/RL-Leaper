"""Loopback inference service. Loads the owner's checkpoint; never trains."""
import argparse
import hashlib
import io
import json
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import RecurrentPPO

from rl.junkyard_env import JunkyardEnv, PLAYER_CONTACT, EYE_VISION
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_sight import JunkyardSight, load_triangles
from rl.seeker_recurrent_policy import ResidualLstmPolicy

ROOT = Path(__file__).resolve().parents[1]


def load_brain(path):
    path = Path(path)
    if path.is_dir():
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            for name in ("data", "policy.pth", "policy.optimizer.pth", "pytorch_variables.pth", "_stable_baselines3_version"):
                output.writestr(name, (path / name).read_bytes())
        archive.seek(0)
        source = archive
        digest = hashlib.sha256((path / "policy.pth").read_bytes()).hexdigest()
    else:
        source = path
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
    model = RecurrentPPO.load(source, device="cpu", custom_objects={
        "policy_class": ResidualLstmPolicy, "learning_rate": .00015,
        "lr_schedule": lambda _: .00015, "clip_range": lambda _: .2})
    if model.num_timesteps != 7757824 or model.observation_space.shape != (34,):
        raise ValueError("Expected the approved 7,757,824-step, 34-input checkpoint")
    model.policy.set_training_mode(False)
    return model, digest


class BrainSession:
    def __init__(self, model, geometry, position, yaw, target, player_collision=False, sight=None, sight_pose=None):
        self.model = model
        self.env = JunkyardEnv(geometry, position, yaw, target, player_collision, sight, sight_pose)
        self.obs = self.env.initial_observation()
        self.memory = None
        self.action = np.zeros(2, dtype=np.float32)
        self.info = {}

    def step(self, target, sight_pose=None):
        self.env.target = np.asarray(target, dtype=np.float32)
        if self.env.sight is not None:
            self.env.sight_pose = sight_pose
            # Refresh live sight before inference, preserving the last movement
            # feedback and recurrent state. Hidden positions never enter memory.
            self.env._update_target_memory(increment_time=False)
            self.obs = np.concatenate((self.env._observation(), self.obs[-3:]))
        # The network only receives the observation, never the target coordinates.
        # Hidden target changes enter memory only after the visibility check.
        with torch.inference_mode():
            self.action, self.memory = self.model.predict(self.obs, state=self.memory,
                episode_start=np.array([self.env.steps == 0]), deterministic=True)
        self.obs, _, _, _, self.info = self.env.step(self.action)
        if self.obs.shape != (34,) or not np.isfinite(self.obs).all():
            raise ValueError("Invalid checkpoint observation")
        return self.snapshot()

    def snapshot(self):
        env = self.env
        visible, _ = env._target_sensor()
        return dict(x=float(env.position[0]), z=float(env.position[1]), yaw=env.yaw,
            sight_version=EYE_VISION['version'], sight=env.sight_debug,
            sight_visible=bool(visible), sight_mode='eye' if env.sight else 'legacy',
            contact_version=PLAYER_CONTACT["version"],
            step=env.steps, model_step=self.model.num_timesteps, distance=env._distance(),
            collision=bool(self.info.get("collision", False)), collisionPart=self.info.get("collision_part"),
            target_visible=bool(env.target_visible), target_ever_seen=bool(env.target_ever_seen),
            throttle=float(self.action[0]), turn=float(self.action[1]),
            vision=env.last_vision.tolist(), memory_age=env.steps_since_target_seen,
            caught=bool(self.info.get("is_success", False)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=ROOT / "model_7757824")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    torch.set_num_threads(1)
    model, digest = load_brain(args.model)
    sessions = {}
    geometry_cache = {}
    sight_cache = {}
    sight_triangles = load_triangles(ROOT / 'assets/maps/junkyard/junkyard.glb')
    origins = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (4173, 5173)}

    def vector(value):
        value = np.asarray(value, dtype=float)
        if value.shape != (2,) or not np.isfinite(value).all() or np.any(np.abs(value) > 500):
            raise ValueError("Expected a finite map position")
        return value

    def sight_pose(data):
        pose = data.get('sight_pose')
        if not isinstance(pose, dict):
            raise ValueError('Eye vision requires eye and target body points')
        eye = np.asarray(pose.get('eye'), dtype=float)
        points = np.asarray(pose.get('points'), dtype=float)
        if (eye.shape != (3,) or points.shape != (3, 3)
                or not np.isfinite(eye).all() or not np.isfinite(points).all()
                or np.any(np.abs(eye) > 20) or np.any(np.abs(points) > 500)):
            raise ValueError('Invalid eye vision pose')
        return dict(eye=eye.tolist(), points=points.tolist())

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, data):
            body = json.dumps(data, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.reply(200, {})

        def do_GET(self):
            self.reply(200, dict(model_step=model.num_timesteps, policy_sha256=digest,
                sight_version=EYE_VISION['version'],
                controller="ResidualLstmPolicy", mode="inference-only"))

        def do_POST(self):
            if self.headers.get("Origin") not in origins | {None}:
                return self.reply(403, {"error": "Local junkyard viewer required"})
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size < 4096:
                    raise ValueError("Invalid request size")
                data = json.loads(self.rfile.read(size))
                if self.path == "/reset":
                    width = float(data["width"])
                    yaw = float(data["yaw"])
                    if not np.isfinite(width + yaw) or not 1.2 <= width <= 8:
                        raise ValueError("Invalid robot size or heading")
                    if width not in geometry_cache:
                        geometry_cache.clear()
                        sight_cache.clear()
                        geometry_cache[width] = JunkyardGeometry(ROOT / "assets/maps/junkyard/collision.json", 7.98 / width)
                        sight_cache[width] = JunkyardSight(sight_triangles * (7.98 / width))
                    mode = data.get('sight_mode', 'legacy')
                    if mode not in ('eye', 'legacy'):
                        raise ValueError('Unknown sight mode')
                    session = BrainSession(model, geometry_cache[width], vector(data["position"]), yaw,
                        vector(data["target"]), player_collision=data.get("player_collision") is True,
                        sight=sight_cache[width] if mode == 'eye' else None,
                        sight_pose=sight_pose(data) if mode == 'eye' else None)
                    if len(sessions) >= 8:
                        sessions.pop(next(iter(sessions)))
                    token = uuid.uuid4().hex
                    sessions[token] = session
                    result = session.snapshot() | dict(token=token, policy_sha256=digest)
                elif self.path in ('/step', '/sense') and data.get('token') in sessions:
                    session = sessions[data['token']]
                    target = vector(data['target'])
                    pose = sight_pose(data) if session.env.sight else None
                    if self.path == '/step':
                        result = session.step(target, pose)
                    else:
                        # Preview while paused: no policy, movement, or memory update.
                        session.env.target = target
                        session.env.sight_pose = pose
                        result = session.snapshot()
                else:
                    raise ValueError("Session expired. Reset Leaper to reconnect")
                self.reply(200, result)
            except (ValueError, TypeError, KeyError) as error:
                self.reply(400, {"error": str(error)})

    print(f"Junkyard brain ready: {model.num_timesteps:,} steps; policy SHA256 {digest}; http://127.0.0.1:{args.port}", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
