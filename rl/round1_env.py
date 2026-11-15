"""Round 1 practice and exam worlds (docs/MOVING_TARGET_RUN_LIST_2026-11-06.md, cut scope).

Switches, each off by default (off = run A's rules exactly):

- ``shot_goal`` (R1): a round is also won when Lola has been in sight and within
  20.3 units (14 map units) for 10 steps in a row: +25, round ends. Touch still
  wins +25.
- ``hidden_cost`` (R2): after first seeing her, each step she is out of sight
  costs -0.02 instead of -0.01.
- ``no_hidden_distance`` (R5): "closer / further" points only for steps that
  start and end with her in sight (0 while hidden and on the step she comes
  back, so hidden movement is never paid later).
- ``new_inputs`` (I1, already in MovingTargetMixin): 3 inputs, her direction
  and speed when last seen.
- ``not_there`` (I2): 1 input, 1 when the spot where it last saw her is in its
  sight right now and she is not within 4 units of it.

Exams (rule 6) use the same classes with every scoring switch off and the
run's input switches on. Worlds: today's plain arena (``Round1ArenaEnv``) and
the real yard (``Round1YardEnv``; ``YardPractice`` draws a new yard round on
every reset). The box arena and yard flips (W1, W2 versions) are not built.

Round 2 additions (2026-11-15, owner's "check the hiding spot" problem):

- ``look_where`` (R6): "look where she was". Potential-based shaping
  (Ng, Harada & Russell 1999: it cannot change which behaviour is best, only
  how fast it is found): while she is out of sight and the spot where it last
  saw her has not been looked at, potential = -0.1 x walking distance (around
  obstacles, rl/walk_field.py) from the Leaper to that spot; 0 otherwise. Each
  step pays gamma * new potential - old potential. "Looked at" = the spot is in
  its sight and she is not within 4 units of it (the I2 test): the rest is
  paid at once, so it is paid for looking, not for standing there. Scorer
  only; nothing reaches the brain's inputs.
- ``privileged`` (B1): 4 numbers appended for the critic only: her real
  direction (2), real distance / the arena diagonal, and 1 while she is hiding.
  The actor never reads them (rl/round2_brain.py PrivilegedLstmPolicy).
- ``hider_share``: share of practice rounds with a hider (default: run A's 1/3).
- ``walk_progress`` (R4): the closer/further points (+-0.2 per unit, capped at
  one step's 0.375 units) on the walking distance around obstacles from the
  Leaper to her (rl/walk_field.py, body radius 1.5) instead of the straight
  line. Paid whenever the straight-line version would be (so with R5, only
  while she is in sight on both ends of the step). Her distance map is rebuilt
  when she moves to a new 1-unit cell, at most every 3 steps. Scorer only.
"""
from __future__ import annotations

import math

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from rl.moving_target import MAP_TO_BRAIN
from rl.moving_target_env import MovingTargetEnv
from rl.moving_target_game_exam import EYE, GameExamEnv, SIGHT_RANGE

SHOT_RANGE = 14 * MAP_TO_BRAIN     # 20.3 units: the game's engage.enterDistance
SHOT_STEPS = 10                    # 1 s in a row
HIDDEN_EXTRA_COST = 0.01           # R2: -0.02 instead of -0.01 while hidden
NOT_THERE_RADIUS = 4.0
LOOK_SCALE = 0.1                   # R6: points per unit of walking distance
GAMMA = 0.995                      # the PPO discount, for potential-based shaping
PRIVILEGED = 4
WALK_EVERY = 3                     # R4: rebuild her distance map at most every 3 steps
SCORING = ("shot_goal", "hidden_cost", "no_hidden_distance", "look_where", "walk_progress")
INPUTS = ("new_inputs", "not_there", "privileged")
TRAINING = ("hider_share",)


def observation_size(new_inputs=False, not_there=False, privileged=False):
    return 34 + 3 * bool(new_inputs) + bool(not_there) + PRIVILEGED * bool(privileged)


class Round1Mixin:
    """Scoring switches and the "she's not there" input, over MovingTargetMixin."""

    def _r1_init(self, shot_goal=False, hidden_cost=False, no_hidden_distance=False,
                 not_there=False, look_where=False, privileged=False, hider_share=None,
                 walk_progress=False, **_):
        self.shot_goal, self.hidden_cost = shot_goal, hidden_cost
        self.no_hidden_distance, self.not_there = no_hidden_distance, not_there
        self.look_where, self.privileged, self.hider_share = look_where, privileged, hider_share
        self.walk_progress = walk_progress
        size = observation_size(self.new_inputs, not_there, privileged)
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.shot_streak = 0
        self.shot_steps = 0
        self.first_shot = None
        self._look_reset()

    def _r1_reset(self, obs):
        self.shot_streak = 0
        self.shot_steps = 0
        self.first_shot = None
        self._look_reset()
        return self._r1_extend(obs)

    def _r1_extend(self, obs):
        parts = [obs]
        if self.not_there:
            parts.append(np.array([self._not_there()], dtype=np.float32))
        if self.privileged:
            parts.append(self._privileged())
        return np.concatenate(parts) if len(parts) > 1 else obs

    def _spot_check(self, spot):
        """The I2 test, cached per step: the spot is in sight and she is not within 4 units."""
        key = (self.steps, float(spot[0]), float(spot[1]))
        if getattr(self, "_spot_cache", (None,))[0] != key:
            empty = (np.linalg.norm(self.target - spot) > NOT_THERE_RADIUS) and self._spot_in_sight(spot)
            self._spot_cache = (key, bool(empty))
        return self._spot_cache[1]

    def _not_there(self):
        if not self.target_ever_seen or self.target_visible:
            return 0.0
        return 1.0 if self._spot_check(np.asarray(self.last_seen_target, dtype=np.float64)) else 0.0

    def _privileged(self):
        """Critic-only truth (B1): her real direction, distance and whether she is hiding."""
        delta = np.asarray(self.target, dtype=np.float64) - self.position
        distance = float(np.linalg.norm(delta))
        direction = delta / distance if distance > 1e-6 else np.zeros(2)
        diagonal = 2.0 * math.sqrt(2.0) * self.WORLD_LIMIT
        hiding = float(self.mover is not None and self.mover.state == "hide")
        return np.clip(np.array([direction[0], direction[1], distance / diagonal, hiding], dtype=np.float32), -1, 1)

    # R6 --------------------------------------------------------------------
    def _walk_to_her(self, before):
        """Walking distance to her from ``before`` and from where the Leaper stands now."""
        cell = tuple(np.floor(np.asarray(self.target, dtype=np.float64)).astype(int))
        stale = getattr(self, "_her_field", None) is None or (
            cell != self._her_cell and self.steps - self._her_built >= WALK_EVERY)
        if stale:
            self._her_spot = np.asarray(self.target, dtype=np.float64).copy()
            self._her_field = self._walker().field(self._her_spot)
            self._her_cell, self._her_built = cell, self.steps
        walker = self._walker()
        return (walker.distance(self._her_field, before, self._her_spot),
                walker.distance(self._her_field, self.position, self._her_spot))

    def _look_reset(self):
        self._her_field = None
        self.look_spot = None
        self.look_field = None
        self.look_done = False
        self.look_potential = 0.0

    def _look_shaping(self, terminated):
        """gamma * new potential - old potential (R6)."""
        new = 0.0
        if self.target_ever_seen and not self.target_visible and not terminated:
            spot = np.asarray(self.last_seen_target, dtype=np.float64)
            if self.look_spot is None or np.linalg.norm(spot - self.look_spot) > 0.5:
                self.look_spot, self.look_done = spot, False
                self.look_field = self._walker().field(spot)
            if not self.look_done and self._spot_check(spot):
                self.look_done = True
            if not self.look_done:
                new = -LOOK_SCALE * self._walker().distance(self.look_field, self.position, spot)
        elif self.target_visible:
            self.look_spot, self.look_done = None, False
        paid = GAMMA * new - self.look_potential
        self.look_potential = new
        return paid

    def step(self, action):
        was_visible, had_seen = self.target_visible, self.target_ever_seen
        before = np.asarray(self.position, dtype=np.float64).copy()
        obs, reward, terminated, truncated, info = super().step(action)
        terms = info["reward_terms"]
        if self.walk_progress and had_seen:
            far_before, far_now = self._walk_to_her(before)
            walked = float(np.clip(far_before - far_now, -self.MOVE_SPEED, self.MOVE_SPEED))
            paid = walked * self.DISTANCE_REWARD_SCALE
            reward += paid - terms["progress"]
            terms["progress"] = paid
        if self.no_hidden_distance and (had_seen or self.target_ever_seen) \
                and not (was_visible and self.target_visible):
            reward -= terms["progress"]
            terms["progress"] = 0.0
        if self.hidden_cost and self.target_ever_seen and not self.target_visible:
            reward -= HIDDEN_EXTRA_COST
            terms["time"] -= HIDDEN_EXTRA_COST
        terms["look"] = 0.0
        if self.look_where:
            paid = self._look_shaping(terminated)
            reward += paid
            terms["look"] = paid
        # Clear-shot bookkeeping (exams report it; R1 wins on it).
        clear_shot = self.target_visible and self._distance() <= SHOT_RANGE
        self.shot_streak = self.shot_streak + 1 if clear_shot else 0
        if clear_shot:
            self.shot_steps += 1
            if self.first_shot is None:
                self.first_shot = self.steps
        info["shot_win"] = False
        if self.shot_goal and not terminated and self.shot_streak >= SHOT_STEPS:
            reward += self.GOAL_REWARD
            terms["goal"] += self.GOAL_REWARD
            info["shot_win"] = True
            info["is_success"] = True
            terminated, truncated = True, False
        info["extrinsic_reward"] = reward
        if terminated or truncated:
            shot = dict(first_shot_s=None if self.first_shot is None else self.first_shot / 10,
                        shot_share=self.shot_steps / max(1, self.steps))
            info["shot"] = shot
            if "lost_her" in info:
                info["lost_her"] = dict(info["lost_her"], **shot)
        return self._r1_extend(obs), reward, terminated, truncated, info


class Round1ArenaEnv(Round1Mixin, MovingTargetEnv):
    """Today's plain arena (62.5 x 62.5 units, 6 round rocks), moving Lola."""

    def __init__(self, moving=True, metrics=False, new_inputs=False, **switches):
        MovingTargetEnv.__init__(self, moving=moving, new_inputs=new_inputs, metrics=metrics)
        self._r1_init(**switches)

    def reset(self, *, seed=None, options=None):
        if self.hider_share is not None and self.moving:
            draw = (np.random.default_rng((int(seed), 61115)) if seed is not None else self.np_random)
            self.forced_kind = "hider" if draw.random() < self.hider_share else "wanderer"
        obs, info = MovingTargetEnv.reset(self, seed=seed, options=options)
        self._arena_walker = None
        return self._r1_reset(obs), info

    def _spot_in_sight(self, spot):
        return bool(self._points_visible(np.asarray([spot]))[0])

    def _walker(self):
        if getattr(self, "_arena_walker", None) is None:
            from rl.moving_target import ArenaWorld
            from rl.walk_field import LeaperWalk
            self._arena_walker = LeaperWalk(ArenaWorld(self.obstacles, self.WORLD_LIMIT))
        return self._arena_walker


class Round1YardEnv(Round1Mixin, GameExamEnv):
    """The real yard as in the game exam (eye-level sight to 50 map units)."""

    def __init__(self, seed, metrics=True, new_inputs=False, kind=None, **switches):
        GameExamEnv.__init__(self, seed, new_inputs=new_inputs, kind=kind)
        if not metrics:
            self.lost = None
        self._r1_init(**switches)

    def reset(self, *, seed=None, options=None):
        obs, info = GameExamEnv.reset(self, seed=seed, options=options)
        return self._r1_reset(obs), info

    _YARD_WALKER = None

    def _walker(self):
        if Round1YardEnv._YARD_WALKER is None:
            from rl.moving_target_game_exam import yard
            from rl.walk_field import LeaperWalk
            Round1YardEnv._YARD_WALKER = LeaperWalk(yard()[2])
        return Round1YardEnv._YARD_WALKER

    def _spot_in_sight(self, spot):
        """The eye's sight test aimed at Lola's three body points standing on ``spot``."""
        delta = spot - self.position
        bearing = float(np.arctan2(delta[0], delta[1]))
        relative = (bearing - self.yaw + np.pi) % (2 * np.pi) - np.pi
        if abs(relative) > self.VISION_FOV / 2 or np.linalg.norm(delta) - self.TARGET_RADIUS > SIGHT_RANGE:
            return False
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        origin = np.array([self.position[0] + EYE[0] * c + EYE[2] * s, EYE[1],
                           self.position[1] - EYE[0] * s + EYE[2] * c])
        return any(self.sight.hit(origin, np.asarray(p)) is None for p in self._points(spot))


class YardPractice(gym.Env):
    """Practice in the real yard: a new random yard round (start, Lola) on every reset.

    Round seeds come from this environment's own generator (never 70000-70099,
    the yard exam's).
    """

    metadata = {}

    def __init__(self, seed, **switches):
        self.switches = switches
        self.rng = np.random.default_rng((int(seed), 61106))
        self.inner = None
        size = observation_size(switches.get("new_inputs"), switches.get("not_there"), switches.get("privileged"))
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.action_space = spaces.Box(-1, 1, (2,), dtype=np.float32)

    def reset(self, *, seed=None, options=None):
        if self.inner is not None:
            self.inner.close()
        while True:
            round_seed = int(self.rng.integers(1_000_000, 2**31 - 1))
            if not 70000 <= round_seed < 70100:
                break
        switches = dict(self.switches)
        share = switches.pop("hider_share", None)
        kind = None if share is None else ("hider" if self.rng.random() < share else "wanderer")
        self.inner = Round1YardEnv(round_seed, metrics=False, kind=kind, **switches)
        return self.inner.reset(seed=round_seed)

    def step(self, action):
        return self.inner.step(action)
