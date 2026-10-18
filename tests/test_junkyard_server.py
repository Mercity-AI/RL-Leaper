"""HTTP contract tests for the local brain service, using a fake model.

These need only numpy and gymnasium: a stand-in model returns fixed actions,
and a tiny synthetic yard replaces the real map, so they run in seconds on any
machine. They cover what used to make the game report "BRAIN OFFLINE" for
reasons unrelated to the brain: page origin, request size, Leaper width range,
session tokens, malformed bodies, idle connections and a second browser tab.
"""
import contextlib
import http.client
import io
import json
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
# Lets `python tests/test_junkyard_server.py` import the project's rl package.
sys.path.insert(0, str(ROOT))
import numpy as np
from rl.junkyard_server import (MODEL_STEP, SESSION_EXPIRED, JunkyardWorlds,
                                loopback_origin, make_handler, make_server)

# Brain-server tests use these ports; 8767 belongs to the real service.
TEST_PORTS = range(8771, 8780)
GAME_PAGE = "http://127.0.0.1:5173"
DIGEST = "f" * 64


class FakeModel:
    """Stands in for the checkpoint: same identity, fixed gentle forward action."""
    num_timesteps = MODEL_STEP
    observation_space = SimpleNamespace(shape=(34,))

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        if self.fail:
            raise RuntimeError("fake model exploded")
        assert obs.shape == (34,) and deterministic
        self.calls += 1
        return np.array([0.5, 0.2], dtype=np.float32), (self.calls,)


def tiny_yard(folder):
    """A 40 x 40 yard with one waist-high crate, in the collision.json format."""
    crate = [[5, 5, 7, 5, 7, 7, 0, 2], [5, 5, 7, 7, 5, 7, 0, 2]]
    path = Path(folder) / "collision.json"
    path.write_text(json.dumps(dict(bounds=dict(minX=-20, maxX=20, minZ=-20, maxZ=20), triangles=crate)))
    wall = np.array([[[-5, 0, 9], [5, 0, 9], [5, 4, 9]], [[-5, 0, 9], [5, 4, 9], [-5, 4, 9]]], dtype=float)
    return JunkyardWorlds(path, wall)


def reset_body(**overrides):
    body = dict(width=4, position=[0, 0], yaw=0, target=[0, 6], player_collision=True,
                sight_mode="eye", sight_pose=dict(eye=[0, 2.38, 1.156], points=[[0, 1.6, 6], [0, 1, 6], [0, .4, 6]]))
    return body | overrides


class ServerHarness:
    """Runs a brain service on the first free test port in a background thread."""

    def __init__(self, model=None, max_sessions=8):
        self.folder = tempfile.TemporaryDirectory()
        self.model = model or FakeModel()
        handler = make_handler(self.model, DIGEST, worlds=tiny_yard(self.folder.name), max_sessions=max_sessions)
        self.service = handler.service
        for port in TEST_PORTS:
            try:
                self.server = make_server(handler, port)
                break
            except OSError:
                continue
        else:
            raise unittest.SkipTest("brain-server test ports 8771-8779 are all busy")
        self.port = self.server.server_address[1]
        # A short poll interval makes shutdown between tests quick.
        self.thread = threading.Thread(target=self.server.serve_forever, args=(0.02,), daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def request(self, method, path, body=None, origin=GAME_PAGE, headers=None, timeout=5):
        """One request on a fresh connection, like the browser; returns (status, json, headers)."""
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        try:
            all_headers = {"Content-Type": "text/plain"} | ({"Origin": origin} if origin else {}) | (headers or {})
            if isinstance(body, (dict, list)):
                body = json.dumps(body)
            connection.request(method, path, body=body, headers=all_headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def post(self, path, body, **kwargs):
        return self.request("POST", path, body, **kwargs)


class BrainServerTests(unittest.TestCase):
    def setUp(self):
        self.harness = ServerHarness()
        self.addCleanup(self.harness.close)

    def start_session(self):
        status, frame, _ = self.harness.post("/reset", reset_body())
        self.assertEqual(status, 200, frame)
        return frame["token"]

    def test_health_reports_checkpoint_identity(self):
        status, health, _ = self.harness.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual((health["model_step"], health["policy_sha256"]), (MODEL_STEP, DIGEST))
        self.assertEqual(health["mode"], "inference-only")
        self.assertEqual(health["sessions"], 0)

    def test_reset_reply_has_every_field_the_game_reads(self):
        status, frame, _ = self.harness.post("/reset", reset_body())
        self.assertEqual(status, 200, frame)
        # Fields src/simulation/JunkyardBrain.js and the eye-vision overlay use.
        for key in ("token", "policy_sha256", "model_step", "contact_version", "sight_version",
                    "x", "z", "yaw", "sight", "sight_visible", "target_visible", "vision", "step"):
            self.assertIn(key, frame)
        self.assertEqual(frame["model_step"], MODEL_STEP)
        self.assertEqual(frame["step"], 0)
        self.assertTrue(frame["sight_visible"], "Lola straight ahead in the open is visible")

    def test_any_loopback_origin_is_accepted(self):
        for origin in ("http://127.0.0.1:5174", "http://localhost:4321", "http://[::1]:5173",
                       "http://127.0.0.1", "https://localhost:5173"):
            with self.subTest(origin=origin):
                status, frame, headers = self.harness.post("/reset", reset_body(), origin=origin)
                self.assertEqual(status, 200, frame)
                self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin)
        # Scripts and curl send no Origin at all.
        status, _, headers = self.harness.post("/reset", reset_body(), origin=None)
        self.assertEqual(status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_other_origins_are_refused(self):
        for origin in ("http://evil.example", "http://127.0.0.1.evil.example:5173",
                       "http://localhost.evil.example", "null", "file://"):
            with self.subTest(origin=origin):
                status, reply, headers = self.harness.post("/reset", reset_body(), origin=origin)
                self.assertEqual(status, 403)
                self.assertIn("Local junkyard viewer required", reply["error"])
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(len(self.harness.service.sessions), 0)
        self.assertTrue(loopback_origin(None))
        self.assertFalse(loopback_origin("http://192.168.1.2:5173"))

    def test_request_size_limits(self):
        # No body, an announced body too large to accept, and a negative length.
        for length in ("0", "4096", "100000", "-5"):
            with self.subTest(length=length):
                status, reply, _ = self.harness.post("/reset", None, headers={"Content-Length": length})
                self.assertEqual((status, reply["error"]), (400, "Invalid request size"))
        status, reply, _ = self.harness.post("/reset", None, headers={"Content-Length": "lots"})
        self.assertEqual(status, 400)
        self.assertIn("error", reply)
        status, _, _ = self.harness.post("/reset", reset_body())
        self.assertEqual(status, 200)

    def test_width_range_and_heading(self):
        for width in (1.19, 8.01, 0, -4, "wide", None):
            with self.subTest(width=width):
                status, reply, _ = self.harness.post("/reset", reset_body(width=width))
                self.assertEqual(status, 400, reply)
                self.assertIn("error", reply)
        status, reply, _ = self.harness.post("/reset", '{"width": NaN, "yaw": 0}')
        self.assertEqual((status, reply["error"]), (400, "Invalid robot size or heading"))
        status, reply, _ = self.harness.post("/reset", reset_body(yaw="Infinity"))
        self.assertEqual((status, reply["error"]), (400, "Invalid robot size or heading"))
        for width in (1.2, 8):
            with self.subTest(width=width):
                status, reply, _ = self.harness.post("/reset", reset_body(width=width))
                self.assertEqual(status, 200, reply)

    def test_tokens(self):
        token = self.start_session()
        for path in ("/step", "/sense"):
            for bad in ("not-a-token", None, ["list"], {"a": 1}, 7):
                with self.subTest(path=path, token=bad):
                    status, reply, _ = self.harness.post(path, dict(token=bad, target=[0, 6]))
                    self.assertEqual((status, reply["error"]), (400, SESSION_EXPIRED))
        pose = reset_body()["sight_pose"]
        status, frame, _ = self.harness.post("/step", dict(token=token, target=[0, 6], sight_pose=pose))
        self.assertEqual((status, frame["step"]), (200, 1))
        self.assertEqual(self.harness.model.calls, 1)
        # A paused preview never runs the policy or moves the Leaper.
        status, frame, _ = self.harness.post("/sense", dict(token=token, target=[3, 6], sight_pose=pose))
        self.assertEqual((status, frame["step"]), (200, 1))
        self.assertEqual(self.harness.model.calls, 1)

    def test_non_object_bodies_get_json_errors(self):
        for body in ("[]", '"text"', "3", "null", "true", "[1, 2]"):
            with self.subTest(body=body):
                status, reply, _ = self.harness.post("/step", body)
                self.assertEqual((status, reply["error"]), (400, "Expected a JSON object"))
        status, reply, _ = self.harness.post("/step", "not json {")
        self.assertEqual(status, 400)
        self.assertIn("error", reply)

    def test_missing_fields_and_bad_poses_get_json_errors(self):
        token = self.start_session()
        for path, body in (("/reset", {"width": 4}), ("/step", {"token": token}),
                           ("/step", {"token": token, "target": [0, 6], "sight_pose": {"eye": [0, 1]}}),
                           ("/reset", reset_body(sight_mode="x-ray")), ("/reset", reset_body(position=[1e6, 0]))):
            with self.subTest(path=path, body=body):
                status, reply, _ = self.harness.post(path, body)
                self.assertEqual(status, 400, reply)
                self.assertIsInstance(reply["error"], str)

    def test_unknown_endpoint_is_404(self):
        status, reply, _ = self.harness.post("/teleport", {"token": "x"})
        self.assertEqual(status, 404)
        self.assertIn("Unknown brain endpoint", reply["error"])

    def test_close_forgets_the_session(self):
        token = self.start_session()
        status, reply, _ = self.harness.post("/close", dict(token=token))
        self.assertEqual((status, reply), (200, {"closed": True}))
        status, reply, _ = self.harness.post("/step", dict(token=token, target=[0, 6]))
        self.assertEqual((status, reply["error"]), (400, SESSION_EXPIRED))
        status, reply, _ = self.harness.post("/close", dict(token=token))
        self.assertEqual(reply, {"closed": False})

    def test_idle_connection_does_not_stall_moves(self):
        # A browser may open a connection and send nothing; moves must still flow.
        idle = socket.create_connection(("127.0.0.1", self.harness.port))
        self.addCleanup(idle.close)
        token = self.start_session()
        status, frame, _ = self.harness.post("/step", dict(token=token, target=[0, 6],
                                             sight_pose=reset_body()["sight_pose"]), timeout=3)
        self.assertEqual((status, frame["step"]), (200, 1))


class SessionTableTests(unittest.TestCase):
    def test_active_tab_survives_new_sessions(self):
        # With room for 3 sessions, the tab that keeps stepping is never dropped;
        # the least recently used one is.
        harness = ServerHarness(max_sessions=3)
        self.addCleanup(harness.close)
        pose = reset_body()["sight_pose"]
        tokens = [harness.post("/reset", reset_body())[1]["token"] for _ in range(2)]
        active, idle = tokens
        for _ in range(9):
            self.assertEqual(harness.post("/step", dict(token=active, target=[0, 6], sight_pose=pose))[0], 200)
            harness.post("/reset", reset_body())
        self.assertEqual(harness.post("/step", dict(token=active, target=[0, 6], sight_pose=pose))[0], 200)
        status, reply, _ = harness.post("/step", dict(token=idle, target=[0, 6], sight_pose=pose))
        self.assertEqual((status, reply["error"]), (400, SESSION_EXPIRED))
        self.assertEqual(len(harness.service.sessions), 3)

    def test_two_tabs_step_at_the_same_time(self):
        harness = ServerHarness()
        self.addCleanup(harness.close)
        pose = reset_body()["sight_pose"]
        tokens = [harness.post("/reset", reset_body())[1]["token"] for _ in range(2)]
        failures = []

        def play(token):
            for _ in range(15):
                status, frame, _ = harness.post("/step", dict(token=token, target=[0, 6], sight_pose=pose))
                if status != 200:
                    failures.append(frame)

        threads = [threading.Thread(target=play, args=(token,)) for token in tokens]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        self.assertEqual(failures, [])
        self.assertEqual(harness.model.calls, 30)

    def test_unexpected_errors_reply_json_500(self):
        harness = ServerHarness(model=FakeModel(fail=True))
        self.addCleanup(harness.close)
        token = harness.post("/reset", reset_body())[1]["token"]
        # The service logs the traceback for the developer; keep it out of the test output.
        with contextlib.redirect_stderr(io.StringIO()) as log:
            status, reply, _ = harness.post("/step", dict(token=token, target=[0, 6],
                                            sight_pose=reset_body()["sight_pose"]))
        self.assertEqual(status, 500)
        self.assertIn("fake model exploded", reply["error"])
        self.assertIn("RuntimeError", log.getvalue())


if __name__ == "__main__":
    unittest.main()
