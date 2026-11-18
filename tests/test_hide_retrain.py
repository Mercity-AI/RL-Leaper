"""Hide retrain (2026-11-18): switches added for the F7GLSDP4CH run.

real_heights: Lola's three sight points at 1.25 / 1.03 / 0.81 map units instead of
0.9 / 0.7 / 0.53 x 1.7, per environment, off by default (old numbers stay exact).
"""
import unittest

import numpy as np

from rl.moving_target import MAP_TO_BRAIN
from rl.moving_target_game_exam import BODY_HEIGHTS, REAL_HEIGHTS, REAL_HEIGHTS_MAP
from rl.round1_env import Round1YardEnv, YardPractice, observation_size


class RealHeightsTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(REAL_HEIGHTS_MAP, (1.25, 1.03, 0.81))
        for got, want in zip(REAL_HEIGHTS, (1.25, 1.03, 0.81)):
            self.assertAlmostEqual(got, want * MAP_TO_BRAIN, places=12)
        for got, want in zip(BODY_HEIGHTS, (0.9, 0.7, 0.53)):
            self.assertAlmostEqual(got, want * 1.7 * MAP_TO_BRAIN, places=12)

    def test_off_by_default(self):
        env = Round1YardEnv(70000)
        self.assertFalse(env.real_heights)
        self.assertEqual([p[1] for p in env._points((1.0, 2.0))], BODY_HEIGHTS)

    def test_on(self):
        env = Round1YardEnv(70000, real_heights=True)
        self.assertTrue(env.real_heights)
        self.assertEqual([p[1] for p in env._points((1.0, 2.0))], REAL_HEIGHTS)
        # The same round (seed) starts the same way: only the heights differ.
        old = Round1YardEnv(70000)
        np.testing.assert_array_equal(env.position, old.position)
        np.testing.assert_array_equal(env.target, old.target)

    def test_practice_and_inputs(self):
        practice = YardPractice(5, real_heights=True, new_inputs=True, not_there=True)
        practice.reset()
        self.assertEqual([p[1] for p in practice.inner._points((0.0, 0.0))], REAL_HEIGHTS)
        # Not an input: the observation keeps its size.
        self.assertEqual(observation_size(new_inputs=True, not_there=True, real_heights=True), 38)
        self.assertEqual(practice.observation_space.shape, (38,))

    def test_lower_points_hide_her_behind_low_junk(self):
        """Some flat-hidden spots the old points were seen at are hidden with the real (lower) ones."""
        old, new = Round1YardEnv(90000), Round1YardEnv(90000, real_heights=True)
        import rl.moving_target_game_exam as ge
        _, _, world, grid = ge.yard()
        leapers = ge._CACHE["leaper_open"]
        rng = np.random.default_rng(3)
        newly_hidden = 0
        for _ in range(400):
            leaper = leapers[rng.integers(len(leapers))]
            spots = grid.open_centres[rng.integers(len(grid.open_centres), size=32)]
            spots = spots[world.hidden_from(leaper, spots, 1.4)][:2]
            for spot in spots:
                hid_old, hid_new = old._eye_hidden(leaper, spot), new._eye_hidden(leaper, spot)
                newly_hidden += int(hid_new and not hid_old)
            if newly_hidden >= 3:
                break
        self.assertGreaterEqual(newly_hidden, 3)

    def test_run_switch_reaches_exams(self):
        from rl.round1_train import RUNS, input_switches
        RUNS["_TEST_RH"] = dict(switches=dict(new_inputs=True, not_there=True, real_heights=True), fusion=False)
        try:
            self.assertEqual(input_switches("_TEST_RH"), dict(new_inputs=True, not_there=True, real_heights=True))
            self.assertNotIn("real_heights", input_switches("F7GLSDP4C"))
        finally:
            del RUNS["_TEST_RH"]


if __name__ == "__main__":
    unittest.main()


class SceneSwitchesStayOutOfExamsTest(unittest.TestCase):
    def test_input_switches(self):
        from rl.round1_train import RUNS, input_switches
        for run in ("F7GLSDP4CR", "F7GLSDP4CH", "F7GLSDP4CHY", "F7GLSDP4CHS", "F7GLSDP4CS", "F7GLSDP4CHL"):
            inputs = input_switches(run)
            self.assertEqual(set(inputs), {"new_inputs", "not_there", "privileged", "real_heights"}, run)
            self.assertTrue(RUNS[run]["switches"]["real_heights"])


class HideSceneTest(unittest.TestCase):
    def test_scenes(self):
        from rl import hide_scenes as hs
        rng = np.random.default_rng(5)
        made = 0
        for k in range(12):
            env = hs.scene_env(5_000_000 + k, dict(real_heights=True))
            scene = hs.draw_scene(env, rng, variant="stay", natural=(k % 2 == 0))
            if scene is None:
                continue
            made += 1
            spot = np.asarray(scene["spot"])
            self.assertTrue(hs.hidden_all_round(env, scene["leaper"], spot))
            hs.apply_scene(env, scene)
            if scene["natural"]:
                self.assertTrue(np.allclose(env.target, scene["corner"]))       # she starts at V
            else:
                self.assertFalse(env.target_visible)
                self.assertTrue(np.allclose(env.last_seen_target, scene["corner"]))
            arrived = None
            for step in range(60):
                env.step(np.array([0.0, 0.0], dtype=np.float32))               # the Leaper stands still
                if env.mover.state == "hide":
                    arrived = arrived if arrived is not None else env.target.copy()
                    np.testing.assert_allclose(env.target, arrived)              # stay: she never moves
            np.testing.assert_allclose(arrived, spot, atol=1e-5)
            self.assertFalse(env.target_visible)
        self.assertGreaterEqual(made, 6)


class StayFoundTest(unittest.TestCase):
    def test_cover_lasts_until_seen(self):
        from rl.round1_env import STAY_FOUND_STEPS, EyeHidingTarget, Round1YardEnv
        env = Round1YardEnv(70001, kind="wanderer", real_heights=True, eye_hide=True, stay_found=True)
        env.reset(seed=70001)
        self.assertEqual(env.lose_cover, 1.0)
        m = env.mover
        self.assertIsInstance(m, EyeHidingTarget)
        self.assertTrue(m.stay_found)
        # Arriving at a flee spot: she stays (longer than any round) until seen.
        m.flee_pending, m.route = True, []
        m.advance(env.position, False)
        self.assertTrue(m.covering)
        self.assertGreater(m.wait, STAY_FOUND_STEPS - 5)
        here = m.position.copy()
        for _ in range(50):
            m.advance(env.position, False)
        np.testing.assert_allclose(m.position, here)
        m.advance(env.position, True)            # seen: she carries on
        self.assertFalse(m.covering)


class HideArenaTest(unittest.TestCase):
    def test_raster_and_sight_agree(self):
        from rl import hide_arena as ha
        boxes = [(0.0, 0.0, 8.85, 3.54, 0.4, 3.8, "container20")]
        site = ha.build_site(boxes)
        g = site["geometry"]
        self.assertTrue(g.disk_blocked(np.array([0.0, 0.0]), 0.5))
        self.assertFalse(g.disk_blocked(np.array([20.0, 20.0]), 3.0))
        sight = site["sight"]
        # A line straight through the box is blocked; one passing far away is clear.
        self.assertIsNotNone(sight.hit(np.array([-10.0, 2.38, 0.0]), np.array([10.0, 1.0, 0.0])))
        self.assertIsNone(sight.hit(np.array([-10.0, 2.38, 30.0]), np.array([10.0, 1.0, 30.0])))
        # Over a low block the eye (2.38 up) sees her head.
        low = ha.build_site([(0.0, 0.0, 4.0, 2.0, 0.0, 1.4, "low")])
        self.assertIsNone(low["sight"].hit(np.array([0.0, 2.38, -6.0]), np.array([0.0, 1.81, 4.0])))
