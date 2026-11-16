"""The round-1 brains' two extra inputs (I1, I2) in the game's request protocol: the Python oracle.

The round-1 retrain (rl/round1_env.py Round1YardEnv) gives the actor 38 inputs: today's 34,
then I1 "motion note" (3) and I2 "not there" (1). Training computes them inside its step
(rl/moving_target_env.py MovingTargetMixin.step, rl/round1_env.py Round1Mixin). The game asks
the brain through the server protocol instead (rl/junkyard_server.py BrainSession): each /step
first refreshes the eye sight with Lola's new position, then asks the policy, then moves. So
the session here looks at Lola twice per /step (before inference and after the move, with the
same Lola position); training looks once per step.

The rule this file fixes (and src/brain/junkyard/round1Inputs.js ports bit for bit):

* I1 is updated exactly once per /step, at the live sight refresh before inference: the look
  that fills input 0 of the observation the policy is fed, with Lola's newest position. So, as
  in training, the note's newer end is the position input 0 talks about, and two sightings in
  a row are one brain step apart. The look after the move (same Lola position) never updates
  it (it would see zero displacement); neither do /sync (a leap) nor /sense (paused preview).
  Reset: note zeros, previous sighting = Lola at reset if seen (MovingTargetMixin._mt_reset).
* I2 has no state: it is computed from the same refreshed state as inputs 0-30 (and at reset).
  After a move, inputs 34-37 keep the values the policy was just fed; the next /step's refresh
  recomputes them. Eye sight only (I2 needs the eye-line test).

Functions below are the training code's own lines (cited), not re-derivations, so the oracle is
anchored to training; tests/fixtures/brain-r1/round1-inputs-*.json additionally records them
straight from Round1YardEnv play (scripts/make_round1_fixtures.py).
"""
from __future__ import annotations

import math

import numpy as np

from rl.junkyard_env import JunkyardEnv
from rl.junkyard_server import BrainSession
from rl.moving_target import SPRINT_STEP
from rl.moving_target_game_exam import BODY_HEIGHTS, EYE, SIGHT_RANGE
from rl.round1_env import NOT_THERE_RADIUS

OBS_SIZE = 38
EXTRA = 4   # inputs 34-36 (I1) and 37 (I2)


def motion_note_update(note, previous, target, visible):
    """MovingTargetMixin.step, "Her direction and speed from two sightings in a row; frozen
    otherwise" (rl/moving_target_env.py), verbatim. ``target`` is the float32 Lola position.
    Returns (note, previous)."""
    if visible:
        if previous is not None:
            velocity = target - previous
            speed = float(np.linalg.norm(velocity))
            direction = velocity / speed if speed > 1e-6 else np.zeros(2)
            note = np.array([direction[0], direction[1], min(1.0, speed / SPRINT_STEP)], dtype=np.float32)
        previous = target.copy()
    else:
        previous = None
    return note, previous


def points(spot, heights=BODY_HEIGHTS):
    """GameExamEnv._points: Lola's head, chest and hips standing on ``spot``."""
    return [[float(spot[0]), h, float(spot[1])] for h in heights]


def spot_in_sight(env, spot, sight_range=SIGHT_RANGE, eye=EYE):
    """Round1YardEnv._spot_in_sight (rl/round1_env.py), verbatim but for the range and eye being
    arguments (training: SIGHT_RANGE and EYE, which the game's defaults equal)."""
    delta = spot - env.position
    bearing = float(np.arctan2(delta[0], delta[1]))
    relative = (bearing - env.yaw + np.pi) % (2 * np.pi) - np.pi
    if abs(relative) > env.VISION_FOV / 2 or np.linalg.norm(delta) - env.TARGET_RADIUS > sight_range:
        return False
    c, s = math.cos(env.yaw), math.sin(env.yaw)
    origin = np.array([env.position[0] + eye[0] * c + eye[2] * s, eye[1],
                       env.position[1] - eye[0] * s + eye[2] * c])
    return any(env.sight.hit(origin, np.asarray(p)) is None for p in points(spot))


def not_there(env, sight_range=SIGHT_RANGE, eye=EYE):
    """Round1Mixin._not_there + _spot_check (rl/round1_env.py) without the per-step cache (in
    the session Lola moves between two looks that share a step count)."""
    if not env.target_ever_seen or env.target_visible:
        return 0.0
    spot = np.asarray(env.last_seen_target, dtype=np.float64)
    empty = (np.linalg.norm(env.target - spot) > NOT_THERE_RADIUS) and spot_in_sight(env, spot, sight_range, eye)
    return 1.0 if empty else 0.0


class SightRangeJunkyardEnv(JunkyardEnv):
    """JunkyardEnv whose eye sight reaches ``sight_range`` (the game's COMBAT.sightRange, sent as
    /reset sight_range; GameExamEnv's SIGHT_RANGE in training). Coverage (the search sweep, hence
    inputs 26-30) stays at the trained 28, as in GameExamEnv; the 16 wall rays stay at 28."""

    def __init__(self, *args, sight_range=None, **kwargs):
        self.sight_range = float(sight_range) if sight_range else self.RAY_MAX_RANGE
        super().__init__(*args, **kwargs)

    def _target_sensor(self):
        # JunkyardEnv._target_sensor's eye branch, with self.sight_range for the reach.
        delta = self.target - self.position
        if self.sight is None or self.sight_pose is None:
            raise ValueError("Round-1 brains need eye-level sight")
        bearing = float(np.arctan2(delta[0], delta[1]))
        relative = (bearing - self.yaw + np.pi) % (2 * np.pi) - np.pi
        in_view = (abs(relative) <= self.VISION_FOV / 2
                   and np.linalg.norm(delta) - self.TARGET_RADIUS <= self.sight_range)
        offset = self.sight_pose['eye']
        c, s = np.cos(self.yaw), np.sin(self.yaw)
        origin = np.array([self.position[0] + offset[0]*c + offset[2]*s,
                           offset[1], self.position[1] - offset[0]*s + offset[2]*c])
        pts = np.asarray(self.sight_pose['points'])
        hits = [self.sight.hit(origin, point) for point in pts]
        clear = [bool(in_view and hit is None) for hit in hits]
        self.sight_debug = dict(origin=origin.tolist(), points=pts.tolist(), hits=hits,
                                clear=clear, in_view=bool(in_view))
        return any(clear), bearing


class ActorPredictor:
    """model.predict for a round-1 checkpoint fed the 38 actor inputs. A privileged (B1) policy
    expects 42 numbers; the 4 critic-only ones are appended as zeros, which its actor never
    reads (rl/round2_brain.py slices features[:, :n_actor])."""

    def __init__(self, model):
        self.model = model
        self.num_timesteps = model.num_timesteps
        self.pad = model.observation_space.shape[0] - OBS_SIZE

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        full = np.concatenate((np.asarray(obs, dtype=np.float32), np.zeros(self.pad, dtype=np.float32)))
        return self.model.predict(full, state=state, episode_start=episode_start, deterministic=deterministic)


class Round1BrainSession(BrainSession):
    """BrainSession for a 38-input round-1 brain (eye sight only). Same requests, same frames."""

    def __init__(self, model, geometry, position, yaw, target, player_collision=False, sight=None,
                 sight_pose=None, disabled_legs=(), sight_range=None):
        import threading
        if sight is None or sight_pose is None:
            raise ValueError("Round-1 brains need eye-level sight (sight_mode 'eye')")
        self.model = model
        self.env = SightRangeJunkyardEnv(geometry, position, yaw, target, player_collision, sight, sight_pose,
                                         disabled_legs, sight_range=sight_range)
        # MovingTargetMixin._mt_reset: zeros, and Lola at reset is the first sighting if seen.
        self.motion_note = np.zeros(3, dtype=np.float32)
        self.previous_seen_target = self.env.target.copy() if self.env.target_visible else None
        self.obs = np.concatenate((self.env.initial_observation(), self._extra()))
        self.memory = None
        self.action = np.zeros(2, dtype=np.float32)
        self.info = {}
        self.lock = threading.Lock()

    def _extra(self):
        """Inputs 34-37 from the env's current state (I1 note as stored, I2 computed now)."""
        return np.concatenate((self.motion_note,
                               np.array([not_there(self.env, self.env.sight_range)], dtype=np.float32)))

    def step(self, target, sight_pose=None):
        env = self.env
        env.target = np.asarray(target, dtype=np.float32)
        env.sight_pose = sight_pose
        # The live refresh before inference (BrainSession.step) is the one look that updates I1.
        env._update_target_memory(increment_time=False)
        self.motion_note, self.previous_seen_target = motion_note_update(
            self.motion_note, self.previous_seen_target, env.target, env.target_visible)
        self.obs = np.concatenate((env._observation(), self.obs[31:34], self._extra()))
        self.action, self.memory = self.model.predict(self.obs, state=self.memory,
                                                      episode_start=np.array([env.steps == 0]), deterministic=True)
        moved, _, _, _, self.info = env.step(self.action)
        # After the move inputs 34-37 keep what the policy was just fed (the next refresh redoes them).
        self.obs = np.concatenate((moved, self.obs[34:38]))
        if self.obs.shape != (OBS_SIZE,) or not np.isfinite(self.obs).all():
            raise ValueError("Invalid checkpoint observation")
        return self.snapshot()

    def sync(self, position, yaw, target, sight_pose=None):
        """BrainSession.sync; inputs 31-37 are kept (a sync is no new sighting for I1, and the
        next /step's refresh recomputes I1/I2 before the policy sees them)."""
        env = self.env
        position = np.asarray(position, dtype=np.float32)
        yaw = (float(yaw) + math.pi) % (2 * math.pi) - math.pi
        for point, radius, _ in env._collision_points(position, yaw):
            if env.geometry.disk_blocked(point, radius):
                raise ValueError("Leaper pose intersects the junkyard; choose a clear spot")
        env.position, env.yaw = position, yaw
        env.target = np.asarray(target, dtype=np.float32)
        env.sight_pose = sight_pose
        env._update_target_memory(increment_time=False)
        env._update_coverage()
        self.obs = np.concatenate((env._observation(), self.obs[31:38]))
        return self.snapshot()
