"""Checks for the moving-target retrain world (plan of 2026-11-05, steps 1-4)."""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rl.moving_target import ArenaWorld, MovingTarget, SPRINT_STEP, KEEP_CLEAR  # noqa: E402
from rl.moving_target_env import MovingTargetEnv, REFIND_BONUS  # noqa: E402
from rl.seeker_env import SeekerEnv  # noqa: E402


class OldWorld(SeekerEnv):
    @classmethod
    def physical_throttle(cls, action):
        return float(action)


class SwitchOff(unittest.TestCase):
    def test_still_target_matches_old_world(self):
        rng = np.random.default_rng(1)
        for seed in (30000, 30001, 30002):
            old, new = OldWorld(), MovingTargetEnv(moving=False)
            a, _ = old.reset(seed=seed)
            b, _ = new.reset(seed=seed)
            self.assertTrue(np.array_equal(a, b))
            for _ in range(200):
                action = rng.uniform(-1, 1, 2).astype(np.float32)
                ra, rb = old.step(action), new.step(action)
                self.assertTrue(np.array_equal(ra[0], rb[0]))
                if ra[2] or ra[3]:
                    break

    def test_recipe_reverse_and_time_cost(self):
        env = MovingTargetEnv(moving=False)
        self.assertEqual(env.physical_throttle(-0.5), -0.5)       # reverse on
        env.reset(seed=30000)
        env.target_ever_seen = True
        _, _, _, _, info = env.step(np.zeros(2, np.float32))
        self.assertAlmostEqual(info["reward_terms"]["time"] + 0.0, -0.01 - (0.04 if env.idle_steps > env.IDLE_GRACE else 0), places=6)


class Hider(unittest.TestCase):
    def test_hider_runs_to_a_spot_the_leaper_cannot_see_while_it_watches(self):
        world = ArenaWorld([(0.0, 0.0, 3.0)], 31.25)
        leaper = np.array([-15.0, 0.0])
        target = MovingTarget(world, np.array([-6.0, 6.0]), np.random.default_rng(3), kind="hider")
        self.assertFalse(world.hidden_from(leaper, [target.position], 1.4)[0])
        target.advance(leaper, spotted=True)
        self.assertEqual(target.state, "dash")
        spot = np.asarray(target.hide_spot)
        self.assertTrue(world.hidden_from(leaper, [spot], 1.4)[0])
        self.assertTrue(4.0 <= np.linalg.norm(spot - [-6.0, 6.0]) <= 12.0)
        seen = 0
        for _ in range(60):
            target.advance(leaper, spotted=False)
            seen += not world.hidden_from(leaper, [target.position], 1.4)[0]
            if target.state == "hide":
                break
        self.assertEqual(target.state, "hide")
        self.assertGreater(seen, 0)                       # it watched her go
        self.assertTrue(300 <= target.wait + 1 <= 600)    # stays 30-60 s

    def test_never_steps_into_the_leaper(self):
        world = ArenaWorld([], 31.25)
        target = MovingTarget(world, np.array([0.0, 0.0]), np.random.default_rng(0), kind="wanderer")
        for _ in range(400):
            before = np.linalg.norm(target.position - [5.0, 0.0])
            target.advance(np.array([5.0, 0.0]), spotted=False)
            after = np.linalg.norm(target.position - [5.0, 0.0])
            self.assertFalse(after < KEEP_CLEAR and after < before - 1e-9)


class NewInputsAndBonus(unittest.TestCase):
    def test_inputs_freeze_while_hidden_and_never_read_her(self):
        env = MovingTargetEnv(moving=True, new_inputs=True, kind="wanderer")
        obs, _ = env.reset(seed=30003)
        self.assertEqual(obs.shape, (37,))
        rng = np.random.default_rng(0)
        prev_visible, last = env.target_visible, obs[34:].copy()
        checked_frozen = checked_live = 0
        for _ in range(1000):
            obs, _, done, trunc, _ = env.step(rng.uniform(-1, 1, 2).astype(np.float32))
            note = obs[34:]
            if not env.target_visible:
                self.assertTrue(np.array_equal(note, last))   # frozen while hidden
                checked_frozen += 1
            elif prev_visible:
                self.assertLessEqual(note[2], 1.0)
                checked_live += 1
            prev_visible, last = env.target_visible, note.copy()
            if done or trunc:
                break
        self.assertGreater(checked_frozen, 0)
        self.assertGreater(checked_live, 0)

    def test_speed_share_of_sprint(self):
        env = MovingTargetEnv(moving=False, new_inputs=True)
        env.reset(seed=30000)
        env.target_visible = True
        env.previous_seen_target = env.target.copy() - np.array([SPRINT_STEP / 2, 0], np.float32)
        # Drive the bookkeeping directly: half a sprint step east.
        env.mover = None
        obs, *_ = env.step(np.zeros(2, np.float32))
        if env.target_visible:
            self.assertAlmostEqual(float(obs[34]), 1.0, places=4)
            self.assertAlmostEqual(float(obs[36]), 0.5, places=4)

    def test_refind_bonus_rules(self):
        env = MovingTargetEnv(moving=False, refind_bonus=True)
        env.reset(seed=30000)
        bonuses = []
        # Fake sight: seen, then hidden for n steps, then seen again.
        script = [(1, True), (5, False), (1, True), (25, False), (1, True)] + [(21, False), (1, True)] * 4
        original = env._target_sensor
        state = {"visible": True}
        env._target_sensor = lambda: (state["visible"], 0.0)
        for count, visible in script:
            state["visible"] = visible
            for _ in range(count):
                _, _, done, trunc, info = env.step(np.array([-1.0, 0.0], np.float32))
                bonuses.append(info["refind_bonus"])
        env._target_sensor = original
        paid = [b for b in bonuses if b]
        self.assertEqual(len(paid), 3)                     # capped at 3 a round
        self.assertTrue(all(b == REFIND_BONUS for b in paid))
        self.assertEqual(bonuses[6], 0.0)                  # back after 0.5 s: nothing


if __name__ == "__main__":
    unittest.main()
