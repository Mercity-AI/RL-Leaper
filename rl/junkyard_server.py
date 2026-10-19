"""Loopback inference service for the junkyard Leaper.

Loads the approved 7,757,824-step checkpoint and answers the game over HTTP on
this computer only. It never trains or changes the brain: every request runs
the frozen observation and movement recipe through `JunkyardEnv`.

Endpoints (all JSON):
- GET  /        health: model_step, policy SHA256, versions, open sessions.
- POST /reset   start a new Leaper session; returns its token and first frame.
- POST /step    one brain move for a session.
- POST /sense   paused preview: refresh sight without moving or remembering.
- POST /sync    pose sync: game logic moved the Leaper between brain moves
                (e.g. a leap). Body {token, position: [x, z], yaw, target: [x, z],
                sight_pose (eye mode)}. Only the pose changes; the next input is
                then computed by the unchanged observation code from there.
                Refused (400) when the body or a leg disc overlaps the junkyard.
- POST /close   forget a session (the page sends this when it closes).
"""
import argparse
import hashlib
import io
import json
import math
import re
import sys
import threading
import traceback
import uuid
import zipfile
from collections import OrderedDict
from contextlib import nullcontext
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

from rl.junkyard_env import JunkyardEnv, PLAYER_CONTACT, EYE_VISION
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_sight import JunkyardSight, load_triangles

ROOT = Path(__file__).resolve().parents[1]

# --- Service settings ---------------------------------------------------------
# Identity of the only brain this service will run.
MODEL_STEP = 7757824
OBSERVATION_SIZE = 34
DEFAULT_PORT = 8767
# Map scale is BODY_COLLISION_DIAMETER / width, the same formula as the browser
# (BODY_COLLISION_RADIUS * 2 / width in src/world/createJunkyardWorld.js).
BODY_COLLISION_DIAMETER = 7.98
# Brain sessions kept at once; the least recently used one is dropped first.
# Every RESET, size change or reload opens a new one, and a hidden browser tab
# sends nothing, so the table must outlast many resets in another tab. A session
# is only ~0.15 MB, so 32 of them cost about 5 MB.
MAX_SESSIONS = 32
# Leaper sizes whose map data stays in memory (rasters are also cached on disk).
MAX_WORLDS = 4
# Requests are small JSON objects; anything larger is refused.
MAX_BODY_BYTES = 4096
# Seconds an idle browser connection may hold its thread before it is closed.
IDLE_TIMEOUT = 10
SESSION_EXPIRED = "Session expired. Reset Leaper to reconnect"
# Pages served from this computer on any port (Vite dev, preview, a second worktree).
LOOPBACK_ORIGIN = re.compile(r"https?://(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d{1,5})?")

# --- Loading the saved brain --------------------------------------------------
# The checkpoint files inference needs, and ones read when present. The optimizer
# (policy.optimizer.pth) only matters for training, so it is never required.
CHECKPOINT_FILES = ("data", "policy.pth")
OPTIONAL_CHECKPOINT_FILES = ("pytorch_variables.pth", "_stable_baselines3_version")


def load_brain(path):
    """Load the approved checkpoint for inference only; never trains.

    `path` is the unpacked model folder (model_7757824/) or an SB3 .zip. Returns
    (model, SHA256 of policy.pth for a folder, or of the whole .zip file).
    """
    # PyTorch and SB3 are imported here, so tools and tests that never load the
    # real brain only need numpy and gymnasium.
    import stable_baselines3
    from sb3_contrib import RecurrentPPO
    from rl.frozen_7757824.seeker_recurrent_policy import ResidualLstmPolicy

    # Collect only the files inference needs, from a folder or a zip.
    path = Path(path)
    members = {}
    if path.is_dir():
        for name in CHECKPOINT_FILES + OPTIONAL_CHECKPOINT_FILES:
            if (path / name).is_file():
                members[name] = (path / name).read_bytes()
        digest_source = members.get("policy.pth", b"")
    else:
        digest_source = path.read_bytes()
        with zipfile.ZipFile(io.BytesIO(digest_source)) as source:
            for name in set(source.namelist()) & set(CHECKPOINT_FILES + OPTIONAL_CHECKPOINT_FILES):
                members[name] = source.read(name)
    missing = [name for name in CHECKPOINT_FILES if name not in members]
    if missing:
        raise FileNotFoundError(f"Brain checkpoint {path} is missing {', '.join(missing)}")
    digest = hashlib.sha256(digest_source).hexdigest()

    # Warn (but still load) when the installed SB3 differs from the one that saved it.
    saved_version = members.get("_stable_baselines3_version", b"").decode().strip()
    if saved_version and saved_version != stable_baselines3.__version__:
        print(f"Warning: the brain was saved with Stable-Baselines3 {saved_version}, but "
              f"{stable_baselines3.__version__} is installed. Use requirements-brain.txt.",
              file=sys.stderr, flush=True)

    # Repack into an in-memory archive and load the policy weights only.
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as output:
        for name, data in members.items():
            output.writestr(name, data)
    archive.seek(0)

    class InferenceRecurrentPPO(RecurrentPPO):
        """RecurrentPPO that restores only the policy weights, never an optimizer."""

        def _get_torch_save_params(self):
            return ["policy"], []

    model = InferenceRecurrentPPO.load(archive, device="cpu", custom_objects={
        "policy_class": ResidualLstmPolicy, "learning_rate": .00015,
        "lr_schedule": lambda _: .00015, "clip_range": lambda _: .2})

    # Refuse anything but the approved brain, then switch to evaluation mode.
    if model.num_timesteps != MODEL_STEP or model.observation_space.shape != (OBSERVATION_SIZE,):
        raise ValueError("Expected the approved 7,757,824-step, 34-input checkpoint")
    model.policy.set_training_mode(False)
    return model, digest


# One model serves every session, so PyTorch inference runs one move at a time.
_PREDICT_LOCK = threading.Lock()


def _inference_mode():
    """PyTorch's no-gradient mode when PyTorch is loaded (the real brain); a no-op otherwise."""
    torch = sys.modules.get("torch")
    return torch.inference_mode() if torch is not None else nullcontext()


# --- One Leaper's brain session ---------------------------------------------
class BrainSession:
    def __init__(self, model, geometry, position, yaw, target, player_collision=False, sight=None, sight_pose=None):
        self.model = model
        self.env = JunkyardEnv(geometry, position, yaw, target, player_collision, sight, sight_pose)
        self.obs = self.env.initial_observation()
        self.memory = None
        self.action = np.zeros(2, dtype=np.float32)
        self.info = {}
        # Requests for the same session (e.g. a slow step and a retry) run in order.
        self.lock = threading.Lock()

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
        with _PREDICT_LOCK, _inference_mode():
            self.action, self.memory = self.model.predict(self.obs, state=self.memory,
                episode_start=np.array([self.env.steps == 0]), deterministic=True)
        self.obs, _, _, _, self.info = self.env.step(self.action)
        if self.obs.shape != (OBSERVATION_SIZE,) or not np.isfinite(self.obs).all():
            raise ValueError("Invalid checkpoint observation")
        return self.snapshot()

    def sync(self, position, yaw, target, sight_pose=None):
        """Game logic moved the Leaper between brain moves (a leap): teleport the pose.

        The frozen recipe is untouched: only the pose changes, and the next
        policy input is recomputed by the same observation code /step uses
        before inference in eye mode. In order:
        1. refuse a pose whose body or leg discs overlap the junkyard (the frozen
           physics could never move out of it); Lola's contact is not checked;
        2. put the Leaper there (float32 position, heading wrapped to [-pi, pi));
        3. look from there: sight memory without ageing it, then search coverage;
        4. the next input = the observation at the new pose plus the last move's
           feedback (inputs 31-33), which a pose sync does not change.
        The step count, LSTM memory and last action are kept: no new episode.
        """
        env = self.env
        position = np.asarray(position, dtype=np.float32)
        yaw = (float(yaw) + math.pi) % (2 * math.pi) - math.pi
        for point, radius, _ in env._collision_points(position, yaw):
            if env.geometry.disk_blocked(point, radius):
                raise ValueError("Leaper pose intersects the junkyard; choose a clear spot")
        env.position, env.yaw = position, yaw
        env.target = np.asarray(target, dtype=np.float32)
        if env.sight is not None:
            env.sight_pose = sight_pose
        env._update_target_memory(increment_time=False)
        env._update_coverage()
        self.obs = np.concatenate((env._observation(), self.obs[-3:]))
        return self.snapshot()

    def snapshot(self, fresh_sight=False):
        env = self.env
        # /reset and /step have just run the sight check for this exact pose
        # (target_visible and sight_debug), so reuse it instead of repeating the
        # most expensive part of a move. A paused /sense preview moved Lola without
        # updating memory, so it asks for a fresh check.
        visible = env._target_sensor()[0] if fresh_sight else env.target_visible
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


# --- Map data per Leaper size -------------------------------------------------
class JunkyardWorlds:
    """Collision raster and eye-sight mesh for each Leaper width, built on first use.

    Several widths stay in memory (least recently used dropped first), and the
    slow collision rasters are also saved in `cache_dir`, so going back to a size
    used before, even after a restart, takes about a second instead of 30.
    """

    def __init__(self, collision_path, sight_triangles, cache_dir=None, keep=MAX_WORLDS):
        self.collision_path = Path(collision_path)
        self.sight_triangles = sight_triangles
        self.cache_dir = cache_dir
        self.keep = keep
        self.worlds = OrderedDict()
        # One build at a time; other sessions keep stepping meanwhile.
        self.lock = threading.Lock()

    @classmethod
    def shipped(cls, root=ROOT):
        """The junkyard map that ships with the game; rasters cached in tmp/ (gitignored)."""
        root = Path(root)
        return cls(root / "assets/maps/junkyard/collision.json",
                   load_triangles(root / "assets/maps/junkyard/junkyard.glb"),
                   cache_dir=root / "tmp" / "raster-cache")

    def get(self, width):
        with self.lock:
            if width not in self.worlds:
                scale = BODY_COLLISION_DIAMETER / width
                self.worlds[width] = (JunkyardGeometry(self.collision_path, scale, cache_dir=self.cache_dir),
                                      JunkyardSight(self.sight_triangles * scale))
                while len(self.worlds) > self.keep:
                    self.worlds.popitem(last=False)
            self.worlds.move_to_end(width)
            return self.worlds[width]


# --- Request validation -------------------------------------------------------
def parse_vector(value):
    value = np.asarray(value, dtype=float)
    if value.shape != (2,) or not np.isfinite(value).all() or np.any(np.abs(value) > 500):
        raise ValueError("Expected a finite map position")
    return value


def parse_sight_pose(data):
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


def loopback_origin(origin):
    """True for pages served from this computer (any port), or no Origin at all (scripts)."""
    return origin is None or LOOPBACK_ORIGIN.fullmatch(origin) is not None


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# --- Shared service state ----------------------------------------------------
class BrainService:
    """Everything one brain process shares between requests: the model, the open
    Leaper sessions (least recently used first) and the map data per size."""

    def __init__(self, model, digest, worlds, max_sessions=MAX_SESSIONS):
        self.model = model
        self.digest = digest
        self.worlds = worlds
        self.max_sessions = max_sessions
        self.sessions = OrderedDict()
        self.sessions_lock = threading.Lock()

    def health(self):
        return dict(status="ok", model_step=self.model.num_timesteps, policy_sha256=self.digest,
            sight_version=EYE_VISION['version'], contact_version=PLAYER_CONTACT["version"],
            controller="ResidualLstmPolicy", mode="inference-only", sessions=len(self.sessions))

    def handle(self, path, data):
        if path == "/reset":
            return self.reset(data)
        if path in ("/step", "/sense"):
            return self.step(data, preview=path == "/sense")
        if path == "/sync":
            return self.sync(data)
        if path == "/close":
            return self.close(data)
        raise HttpError(404, f"Unknown brain endpoint {path}")

    def reset(self, data):
        # Check the whole request before any slow map building.
        width = float(data["width"])
        yaw = float(data["yaw"])
        if not np.isfinite(width + yaw) or not 1.2 <= width <= 8:
            raise ValueError("Invalid robot size or heading")
        mode = data.get('sight_mode', 'legacy')
        if mode not in ('eye', 'legacy'):
            raise ValueError('Unknown sight mode')
        position, target = parse_vector(data["position"]), parse_vector(data["target"])
        pose = parse_sight_pose(data) if mode == 'eye' else None
        geometry, sight = self.worlds.get(width)
        session = BrainSession(self.model, geometry, position, yaw, target,
            player_collision=data.get("player_collision") is True,
            sight=sight if mode == 'eye' else None, sight_pose=pose)
        result = session.snapshot()
        # Register the session; a full table drops the least recently used tab.
        token = uuid.uuid4().hex
        with self.sessions_lock:
            self.sessions[token] = session
            while len(self.sessions) > self.max_sessions:
                self.sessions.popitem(last=False)
        return result | dict(token=token, policy_sha256=self.digest)

    def session(self, token):
        """The session for a token, marked as just used; expired tokens raise."""
        with self.sessions_lock:
            session = self.sessions.get(token) if isinstance(token, str) else None
            if session is None:
                raise ValueError(SESSION_EXPIRED)
            self.sessions.move_to_end(token)
            return session

    def step(self, data, preview=False):
        session = self.session(data.get('token'))
        target = parse_vector(data['target'])
        with session.lock:
            pose = parse_sight_pose(data) if session.env.sight else None
            if not preview:
                return session.step(target, pose)
            # Preview while paused: no policy, movement, or memory update.
            session.env.target = target
            session.env.sight_pose = pose
            return session.snapshot(fresh_sight=True)

    def sync(self, data):
        """POST /sync: move a session's Leaper to a pose the game chose (see BrainSession.sync)."""
        session = self.session(data.get('token'))
        position, target = parse_vector(data['position']), parse_vector(data['target'])
        yaw = data.get('yaw')
        if isinstance(yaw, bool) or not isinstance(yaw, (int, float)) or not math.isfinite(yaw):
            raise ValueError("Invalid robot heading")
        with session.lock:
            pose = parse_sight_pose(data) if session.env.sight else None
            return session.sync(position, yaw, target, pose)

    def close(self, data):
        token = data.get('token')
        with self.sessions_lock:
            closed = isinstance(token, str) and self.sessions.pop(token, None) is not None
        return dict(closed=closed)


# --- HTTP layer ----------------------------------------------------------------
def make_handler(model, digest, root=ROOT, worlds=None, max_sessions=MAX_SESSIONS):
    """Request handler class bound to one model; `worlds` defaults to the shipped map."""
    service = BrainService(model, digest, worlds or JunkyardWorlds.shipped(root), max_sessions)

    class Handler(BaseHTTPRequestHandler):
        # Send each small reply immediately. With Nagle's algorithm on, Windows
        # held the body back behind the headers, adding ~40 ms to every move.
        disable_nagle_algorithm = True
        # An idle connection may not hold its thread forever.
        timeout = IDLE_TIMEOUT

        def log_message(self, *args):
            pass

        def send_json(self, status, body):
            # Loopback pages may read every reply, including errors.
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            origin = self.headers.get("Origin")
            if origin is not None and loopback_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_json(200, b"{}")

        def do_GET(self):
            self.send_json(200, encode(service.health()))

        def do_POST(self):
            # Every outcome is a JSON reply, so the page always learns what went wrong.
            try:
                status, body = 200, encode(self.answer())
            except HttpError as error:
                status, body = error.status, encode({"error": str(error)})
            except (ValueError, TypeError, KeyError) as error:
                status, body = 400, encode({"error": str(error)})
            except Exception as error:
                traceback.print_exc()
                status, body = 500, encode({"error": f"Brain service error: {type(error).__name__}: {error}"})
            self.send_json(status, body)

        def answer(self):
            # Only pages on this computer may drive the brain.
            if not loopback_origin(self.headers.get("Origin")):
                raise HttpError(403, "Local junkyard viewer required: open the game from 127.0.0.1 or localhost")
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size < MAX_BODY_BYTES:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            return service.handle(self.path, data)

    Handler.service = service
    return Handler


def encode(data):
    return json.dumps(data, allow_nan=False).encode()


class BrainHTTPServer(ThreadingHTTPServer):
    """Threaded server, so one idle or slow connection never stalls other moves."""

    daemon_threads = True
    # On Windows, SO_REUSEADDR lets a second server bind a port that is already
    # listening, so two brain services would silently split the game's requests
    # ("Session expired"). Without it, the second one fails with a clear message.
    allow_reuse_address = sys.platform != "win32"


def make_server(handler, port=DEFAULT_PORT, host="127.0.0.1"):
    """Listen on this computer only; raises OSError when the port is taken."""
    return BrainHTTPServer((host, port), handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local Leaper brain service (inference only).")
    parser.add_argument("--model", type=Path, default=ROOT / "model_7757824")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    # Load the brain on one CPU thread (small network; avoids thread contention).
    import torch
    torch.set_num_threads(1)
    model, digest = load_brain(args.model)

    # Bind before announcing readiness, so launchers can trust the message.
    try:
        server = make_server(make_handler(model, digest), args.port)
    except OSError as error:
        raise SystemExit(f"Can't listen on 127.0.0.1:{args.port} ({error}). "
                         "Is another brain service already running?") from error
    print(f"Junkyard brain ready: {model.num_timesteps:,} steps; policy SHA256 {digest}; "
          f"http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
