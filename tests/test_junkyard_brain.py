"""Junkyard brain adapter tests; inference only, no optimizer or training.

Two groups:
- JunkyardEnvTests need only numpy and gymnasium. They run on any machine and
  guard the fairness rules: hidden positions never leak, Lola blocks the Leaper,
  and it can always back away.
- CheckpointTests load the real saved brain. They run when model_7757824/ and
  PyTorch + sb3-contrib are installed (requirements-brain.txt), and are skipped
  with a clear reason otherwise.
"""
import importlib.util
import os
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Lets `python tests/test_junkyard_brain.py` import the project's rl package.
sys.path.insert(0, str(ROOT))
import numpy as np
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_env import JunkyardEnv, PLAYER_CONTACT

# The checkpoint tests need the committed brain files plus the ML stack. Setting
# LEAPER_SKIP_CHECKPOINT_TESTS=1 (pnpm test:py does) keeps a run checkpoint-free.
CHECKPOINT = ROOT / "model_7757824"
BRAIN_READY = ((CHECKPOINT / "policy.pth").exists()
               and importlib.util.find_spec("torch") is not None
               and importlib.util.find_spec("sb3_contrib") is not None
               and not os.environ.get("LEAPER_SKIP_CHECKPOINT_TESTS"))
SKIP_REASON = ("brain checkpoint tests skipped: needs model_7757824/ plus PyTorch and "
               "sb3-contrib (pip install -r requirements-brain.txt)")


def junkyard_geometry(width=4):
    return JunkyardGeometry(ROOT / "assets/maps/junkyard/collision.json", 7.98 / width)


class JunkyardEnvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geometry = junkyard_geometry()

    def test_hidden_target_does_not_leak(self):
        a = JunkyardEnv(self.geometry, [0, 0], 0, [0, -15])
        b = JunkyardEnv(self.geometry, [0, 0], 0, [1, -17])
        self.assertFalse(a.target_visible)
        self.assertFalse(b.target_visible)
        np.testing.assert_array_equal(a.initial_observation(), b.initial_observation())
        # Observe pink once, then move it behind the robot. Memory must retain
        # the old seen position, not the new hidden position.
        a.target = np.array([0, 6], dtype=np.float32)
        a._update_target_memory()
        self.assertTrue(a.target_visible)
        remembered = a.last_seen_target.copy()
        a.target = np.array([0, -15], dtype=np.float32)
        a._update_target_memory()
        self.assertFalse(a.target_visible)
        np.testing.assert_array_equal(a.last_seen_target, remembered)
        self.assertEqual(a.steps_since_target_seen, 1)

    def test_sensor_geometry_and_signed_reverse(self):
        env = JunkyardEnv(self.geometry, [0, 0], 0, [0, 10])
        obs, _, _, _, _ = env.step(np.array([-1, 0], dtype=np.float32))
        self.assertLess(env.position[1], 0)
        self.assertEqual(obs.shape, (34,))
        self.assertTrue(np.isfinite(obs).all())
        self.assertIsNotNone(env._collision_for_pose(self.geometry.maximum, 0))
        self.assertEqual(env._ray_distances(env.position, env.yaw).shape, (16,))

    def test_player_contact_blocks_leaper_and_allows_reverse(self):
        # Lola just clear of the two front feet; a step forward would touch her.
        env = JunkyardEnv(self.geometry, [0, 0], 0, [0, 3.4], player_collision=True)
        self.assertGreater(env._player_clearance(env.position, env.yaw), 0)
        start = env.position.copy()
        _, _, _, _, info = env.step(np.array([1, 0], dtype=np.float32))
        np.testing.assert_array_equal(env.position, start)
        self.assertEqual(info['collision_part'], 'player')
        env.step(np.array([-1, 0], dtype=np.float32))
        self.assertLess(env.position[1], start[1])
        env.target = np.array([0, 0], dtype=np.float32)
        env.position = np.array([0, -10], dtype=np.float32)
        self.assertEqual(env._collision_for_pose(np.array([0, 10]), 0), 'player',
            'swept contact prevents crossing through the player')
        # Same shape as the browser: Lola fits between the front legs.
        env.position = np.array([0, 0], dtype=np.float32)
        env.yaw = 0.0
        env.target = np.array([0, 3.5], dtype=np.float32)
        player = PLAYER_CONTACT["playerRadius"] * self.geometry.scale
        self.assertAlmostEqual(env._player_clearance(env.position, 0.0) + player,
            min(np.hypot(np.sin(0.62) * 3.24, 3.5 - np.cos(0.62) * 3.24) - 0.9, np.hypot(np.sin(0.62) * 2.2, 3.5 - np.cos(0.62) * 2.2) - 0.35, 3.5 - 1.3), places=5)


@unittest.skipUnless(BRAIN_READY, SKIP_REASON)
class CheckpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # PyTorch is imported here so the model-free tests above never need it.
        import torch
        from rl.junkyard_server import BrainSession, load_brain
        torch.set_num_threads(1)
        cls.BrainSession = BrainSession
        cls.load_brain = staticmethod(load_brain)
        cls.geometry = junkyard_geometry()
        cls.model, cls.digest = load_brain(CHECKPOINT)

    def test_real_checkpoint_actions_and_persistent_memory(self):
        session = self.BrainSession(self.model, self.geometry, [0, 0], 0, [0, -15])
        self.assertEqual(self.model.num_timesteps, 7757824)
        self.assertEqual(self.digest, '883dade3c7617d0fd85793c405ba8ccadd66c5e914c9032356ff7318351eb594')
        self.assertFalse(session.env.target_visible)
        positions = []
        for i in range(120):
            expected, _ = self.model.predict(session.obs, state=session.memory,
                episode_start=np.array([i == 0]), deterministic=True)
            frame = session.step([0, -15] if i < 60 else [10, 8])
            np.testing.assert_allclose(session.action, expected, atol=1e-6)
            self.assertEqual(session.obs.shape, (34,))
            self.assertTrue(np.isfinite(session.obs).all())
            self.assertIsNotNone(session.memory)
            positions.append([frame['x'], frame['z']])
        self.assertGreater(np.linalg.norm(np.ptp(positions, axis=0)), .5)
        self.assertEqual(session.env.steps, 120)
        print('Checkpoint searched from a hidden-target start; 120 finite steps; actions match direct model.predict.')


if __name__ == '__main__':
    unittest.main()
