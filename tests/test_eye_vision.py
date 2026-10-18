"""Height-aware sight, field-of-view, and saved-policy compatibility checks."""
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.venv/Lib/site-packages'))
sys.path.insert(0, str(ROOT))
import numpy as np
import torch
from rl.junkyard_sight import JunkyardSight, load_triangles
from rl.junkyard_env import JunkyardEnv
from rl.junkyard_geometry import JunkyardGeometry
from rl.junkyard_server import BrainSession, load_brain


def wall(height):
    return np.array([[[-5, 0, 5], [5, 0, 5], [5, height, 5]],
                     [[-5, 0, 5], [5, height, 5], [-5, height, 5]]])


class SightTests(unittest.TestCase):
    def test_low_cover_tall_cover_and_backfaces(self):
        for triangles in (wall(.5), wall(.5)[:, ::-1]):
            sight = JunkyardSight(triangles)
            self.assertIsNone(sight.hit([0, 2.38, 0], [0, 1.5, 10]))
            self.assertIsNotNone(sight.hit([0, .2, 0], [0, .2, 10]))
        self.assertIsNotNone(JunkyardSight(wall(4)).hit([0, 2.38, 0], [0, 1.5, 10]))

    def test_partial_cover_and_jump(self):
        sight = JunkyardSight(wall(1.8))
        standing = [sight.hit([0, 2.38, 0], [0, y, 10]) is None for y in (1.8, 1.3, .8)]
        self.assertEqual(standing, [True, True, False])
        crouching = [sight.hit([0, 2.38, 0], [0, y, 10]) is None for y in (1, .7, .4)]
        self.assertEqual(crouching, [False, False, False])
        self.assertIsNone(sight.hit([0, 2.38, 0], [0, 2.6, 10]))

    def test_overhead_geometry_and_segment_limits(self):
        roof = JunkyardSight(np.array([[[-5, 3, 0], [5, 3, 0], [0, 3, 10]]]))
        self.assertIsNone(roof.hit([0, 2, 0], [0, 2, 8]))
        self.assertIsNotNone(roof.hit([0, 2, 0], [0, 4, 8]))
        self.assertIsNone(JunkyardSight(wall(4)).hit([0, 2, 0], [0, 2, 4]))


class EyePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        cls.geometry = JunkyardGeometry(ROOT / 'assets/maps/junkyard/collision.json', 7.98 / 4)
        cls.model, cls.digest = load_brain(ROOT / 'model_7757824')
        cls.triangles = load_triangles(ROOT / 'assets/maps/junkyard/junkyard.glb')

    def pose(self, x=0, z=10):
        return dict(eye=[0, 2.38, 1.156], points=[[x, y, z] for y in (3.5, 2.8, 2)])

    def test_fov_range_and_hidden_memory(self):
        env = JunkyardEnv(self.geometry, [0, 0], 0, [0, 10],
                         sight=JunkyardSight(wall(.5)), sight_pose=self.pose())
        self.assertTrue(env.target_visible)
        remembered = env.last_seen_target.copy()
        for target in ([0, -10], [0, 40]):
            env.target = np.array(target, dtype=np.float32)
            env.sight_pose = self.pose(*target)
            env._update_target_memory()
            self.assertFalse(env.target_visible)
            np.testing.assert_array_equal(env.last_seen_target, remembered)
        env.target = np.array([10, 0], dtype=np.float32)
        env.sight_pose = self.pose(10, 0)
        env._update_target_memory()
        self.assertTrue(env.target_visible, 'Side vision must remain available')
        env.sight = JunkyardSight(wall(8))
        env.target = np.array([0, 10], dtype=np.float32)
        env.sight_pose = self.pose()
        remembered = env.last_seen_target.copy()
        env._update_target_memory()
        self.assertFalse(env.target_visible)
        np.testing.assert_array_equal(env.last_seen_target, remembered)

    def test_existing_rays_unchanged_and_real_policy_runs(self):
        sight = JunkyardSight(self.triangles * self.geometry.scale)
        session = BrainSession(self.model, self.geometry, [0, 0], 0, [0, 10],
                               sight=sight, sight_pose=self.pose())
        legacy = JunkyardEnv(self.geometry, [0, 0], 0, [0, 10])
        np.testing.assert_array_equal(session.env.last_vision, legacy._ray_distances(legacy.position, legacy.yaw))
        self.assertEqual(self.digest, '883dade3c7617d0fd85793c405ba8ccadd66c5e914c9032356ff7318351eb594')
        old_memory = session.env.last_seen_target.copy()
        session.snapshot()
        np.testing.assert_array_equal(session.env.last_seen_target, old_memory)
        for i in range(120):
            z = 10 if i < 60 else -10
            frame = session.step([0, z], self.pose(0, z))
            self.assertEqual(session.obs.shape, (34,))
            self.assertTrue(np.isfinite(session.obs).all())
            self.assertEqual(len(frame['vision']), 16)
            self.assertEqual(len(frame['sight']['clear']), 3)
        self.assertEqual(session.env.steps, 120)
        print(f'Eye vision: {len(self.triangles)} map triangles; 120 finite saved-policy steps.')


if __name__ == '__main__':
    unittest.main()
