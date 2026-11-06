"""Game exam (plan step 7): the real junkyard, eye-level sight, a moving and hiding Lola.

    python -m rl.moving_target_game_exam --brain today --rounds 100
    python -m rl.moving_target_game_exam --brain path/to/model.zip --run D --rounds 100

Each round: the Leaper and Lola start at random open spots 22-42 map units
apart (the game's GAME_START rule, randomJunkyardStart.js), Lola a wanderer
or (1 in 3) a hider, moving at her game speeds around the yard's real
containers, cars and piles. The Leaper sees her as in the game: three lines
from its eye (2.38 up, 1.156 ahead) to her head, chest and hips against the
yard's triangles, out to the game's 50 map units of sight (72.6 brain units),
in its 270 degree view. Its 16 wall rays keep the trained 28 units. Lola keeps
clear of the Leaper the same way as in practice. Rounds end at a catch (2.15
units), stuck, frozen, or 100 s. Same scorer and files as the practice exam.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from rl.junkyard_env import JunkyardEnv
from rl.junkyard_server import JunkyardWorlds, ROOT
from rl.moving_target import Grid, JunkyardWorld, MAP_TO_BRAIN
from rl.moving_target_env import MovingTargetMixin

LEAPER_WIDTH = 5.5
SIGHT_RANGE = 50 * MAP_TO_BRAIN                       # COMBAT.sightRange, map -> brain units
START_APART = (22 * MAP_TO_BRAIN, 42 * MAP_TO_BRAIN)  # GAME_START
EYE = [0.0, 2.38, 1.156]
# Lola's head, chest and hips heights: shares of her 1.7 map-unit height, in brain units.
BODY_HEIGHTS = [h * 1.7 * MAP_TO_BRAIN for h in (0.9, 0.7, 0.53)]
LEAPER_CLEARANCE = 3.5   # open-floor margin when picking its start (legs reach 3.24 + 0.24)

_CACHE = {}


def yard():
    if "yard" not in _CACHE:
        geometry, sight = JunkyardWorlds.shipped().get(LEAPER_WIDTH)
        world = JunkyardWorld(geometry)
        _CACHE["yard"] = (geometry, sight, world, Grid(world))
    return _CACHE["yard"]


class GameExamEnv(MovingTargetMixin, JunkyardEnv):
    def __init__(self, seed, new_inputs=False, kind=None):
        geometry, sight, world, grid = yard()
        rng = np.random.default_rng((int(seed), 4112026))
        leaper_grid = _CACHE.setdefault("leaper_open", self._leaper_spots(geometry, grid))
        for _ in range(1000):
            position = leaper_grid[rng.integers(len(leaper_grid))]
            spots = grid.open_centres
            gap = np.linalg.norm(spots - position, axis=1)
            spots = spots[(gap >= START_APART[0]) & (gap <= START_APART[1])]
            if not len(spots):
                continue
            target = spots[rng.integers(len(spots))]
            yaw = float(rng.uniform(-math.pi, math.pi))
            try:
                JunkyardEnv.__init__(self, geometry, position, yaw, target, sight=sight,
                                     sight_pose=dict(eye=EYE, points=self._points(target)))
                break
            except ValueError:
                continue
        else:
            raise RuntimeError("No free start found")
        self._mt_init(True, new_inputs, False, True, kind)
        self._world, self._grid, self._rng = world, grid, rng

    @staticmethod
    def _leaper_spots(geometry, grid):
        spots = grid.open_centres
        return spots[[not geometry.disk_blocked(p, LEAPER_CLEARANCE) for p in spots]]

    @staticmethod
    def _points(target):
        return [[float(target[0]), h, float(target[1])] for h in BODY_HEIGHTS]

    def _target_sensor(self):
        """JunkyardEnv's eye sight, with the game's 50 map-unit range."""
        delta = self.target - self.position
        bearing = float(np.arctan2(delta[0], delta[1]))
        relative = (bearing - self.yaw + np.pi) % (2 * np.pi) - np.pi
        in_view = (abs(relative) <= self.VISION_FOV / 2
                   and np.linalg.norm(delta) - self.TARGET_RADIUS <= SIGHT_RANGE)
        if not in_view:
            return False, bearing
        c, s = np.cos(self.yaw), np.sin(self.yaw)
        origin = np.array([self.position[0] + EYE[0] * c + EYE[2] * s, EYE[1],
                           self.position[1] - EYE[0] * s + EYE[2] * c])
        return any(self.sight.hit(origin, np.asarray(p)) is None for p in self._points(self.target)), bearing

    def reset(self, *, seed=None, options=None):
        self._update_target_memory(increment_time=False)
        self._mt_reset(self._world, self._rng, grid=self._grid)
        info = dict(target_visible=self.target_visible, target_ever_seen=self.target_ever_seen,
                    target=self.target.tolist(), **self._target_info())
        return self._extend(self.initial_observation()), info


def main():
    import torch
    torch.set_num_threads(1)
    from rl.moving_target_exam import run_exam
    from rl.moving_target_brain import load_frozen_predictor
    from rl.moving_target_job import load
    parser = argparse.ArgumentParser()
    parser.add_argument("--brain", required=True, help="'today' or a run's model zip")
    parser.add_argument("--run", choices=["A", "D"], default="A")
    parser.add_argument("--rounds", type=int, default=100)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    new_inputs = args.brain != "today" and args.run == "D"
    seeds = list(range(70000, 70000 + args.rounds))
    model = (load_frozen_predictor(lambda: GameExamEnv(seeds[0])) if args.brain == "today"
             else load(args.brain, args.run))
    name = "today" if args.brain == "today" else f"run_{args.run}_{Path(args.brain).stem}"
    out = Path(args.out or ROOT / "rl_artifacts/moving_target_20261105/game_exam" / name)
    summary, _ = run_exam(model, lambda s=iter(seeds): GameExamEnv(next(s), new_inputs), seeds, out,
                          record_seeds=seeds[:6],
                          progress=lambda n, t: print(f"game exam {name}: {n}/{t}", flush=True))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
