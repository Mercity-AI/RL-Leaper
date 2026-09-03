"""Focused checks for the PPO_12 decoupled collision response.

PPO_12 keeps every PPO_11 rule (signed throttle, eight rays, reward, 19 collision
points) and changes only the state update on collision: when the combined
turn-and-move is blocked, rotation and translation are resolved independently so a
touching robot can turn or reverse out of contact instead of freezing. The
collision flag and its penalty still reflect the full intended move.
"""

import math
import unittest

import numpy as np

from rl_environment import LeaperReachEnv


class CollisionRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.env = LeaperReachEnv()
        # Obstacles are randomized per episode now (PPO_13), and a freshly
        # constructed env has none until reset(). Pin one obstacle so the
        # collision-recovery geometry these tests search around exists and is
        # deterministic; this exercises the unchanged decoupled-collision logic.
        self.env.obstacles = ((10.0, 11.0, 2.8),)

    def tearDown(self):
        self.env.close()

    # --- helpers -----------------------------------------------------------

    def free(self, pos, yaw):
        return self.env._collision_for_pose(np.asarray(pos, dtype=np.float32), yaw) is None

    def combined(self, pos, yaw, throttle, turn):
        cy = (yaw + turn * self.env.TURN_SPEED + math.pi) % (2 * math.pi) - math.pi
        h = np.array([math.sin(cy), math.cos(cy)], dtype=np.float32)
        cand = np.asarray(pos, dtype=np.float32) + h * throttle * self.env.MOVE_SPEED
        return cy, cand

    def place(self, pos, yaw):
        self.env.position = np.array(pos, dtype=np.float32)
        self.env.yaw = float(yaw)
        self.env.steps = 0
        self.env.prev_distance = self.env._distance()
        self.env.last_collision = 0.0
        self.env.previous_action.fill(0.0)
        self.env.trajectory = [self.env.position.copy()]

    def find(self, predicate, ox=10.0, oz=11.0, reach=6.0):
        """Search a grid around one obstacle for a pose satisfying predicate."""
        for x in np.arange(ox - reach, ox + reach, 0.4):
            for z in np.arange(oz - reach, oz + reach, 0.4):
                for yaw in np.linspace(-math.pi, math.pi, 24, endpoint=False):
                    if predicate(float(x), float(z), float(yaw)):
                        return float(x), float(z), float(yaw)
        return None

    # --- tests -------------------------------------------------------------

    def test_open_space_move_is_unchanged(self):
        """With no obstacle in the way, the full turn-and-move still applies."""
        self.place((-18.0, -18.0), 0.3)
        start = self.env.position.copy()
        cy, cand = self.combined((-18.0, -18.0), 0.3, 1.0, 1.0)
        self.assertTrue(self.free(cand, cy))  # precondition: genuinely open
        _, _, _, _, info = self.env.step(np.array([1.0, 1.0], dtype=np.float32))
        np.testing.assert_allclose(self.env.position, cand, atol=1e-5)
        self.assertAlmostEqual(self.env.yaw, cy, places=5)
        self.assertFalse(info["collision"])

    def test_rotates_out_when_forward_is_blocked(self):
        """Combined move blocked but rotation-in-place clear -> it still turns."""

        def predicate(x, z, yaw):
            if not self.free((x, z), yaw):
                return False
            cy, cand = self.combined((x, z), yaw, 1.0, 1.0)
            if self.free(cand, cy):
                return False  # combined must be blocked
            return self.free((x, z), cy)  # pure rotation must be clear

        found = self.find(predicate)
        self.assertIsNotNone(found, "no rotate-out pose found near the obstacle")
        x, z, yaw = found
        self.place((x, z), yaw)
        cy, _ = self.combined((x, z), yaw, 1.0, 1.0)
        _, _, _, _, info = self.env.step(np.array([1.0, 1.0], dtype=np.float32))
        # PPO_11 would have frozen both; PPO_12 rotates to the new facing.
        self.assertAlmostEqual(self.env.yaw, cy, places=5)
        # The forward part is still blocked, so position is unchanged.
        np.testing.assert_allclose(self.env.position, np.array([x, z]), atol=1e-5)
        # The collision penalty still applies even though it escaped the freeze.
        self.assertTrue(info["collision"])
        self.assertLess(info["reward_terms"]["collision"], 0.0)

    def test_forward_blocked_pose_holds_without_reverse(self):
        """PPO_18 removes reverse: facing into contact with no turn, it can't back out.

        Escape now comes only from rotating to a clear facing (see the rotate-out
        test) or, failing that, the stuck rule; a blocked forward move simply holds.
        """

        def predicate(x, z, yaw):
            if not self.free((x, z), yaw):
                return False
            _, forward = self.combined((x, z), yaw, 1.0, 0.0)
            return not self.free(forward, yaw)  # forward must be blocked

        found = self.find(predicate)
        self.assertIsNotNone(found, "no forward-blocked pose found near the obstacle")
        x, z, yaw = found
        self.place((x, z), yaw)
        self.env.step(np.array([1.0, 0.0], dtype=np.float32))
        # No forward room and no reverse, so position and facing are unchanged.
        np.testing.assert_allclose(self.env.position, np.array([x, z]), atol=1e-5)
        self.assertAlmostEqual(self.env.yaw, yaw, places=5)

    def test_observation_size_matches_sixteen_ray_champion(self):
        observation, _ = self.env.reset(seed=1)
        self.assertEqual(observation.shape, (26,))
        self.assertTrue(self.env.observation_space.contains(observation))


if __name__ == "__main__":
    unittest.main()
