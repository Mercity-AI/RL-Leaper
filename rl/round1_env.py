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
- ``shot_flee`` (genuine-loss practice, 2026-11-15): a 1 s clear shot pays
  +10 (at most 5 a round) and does NOT end the round; Lola then sprints to a
  hiding spot hidden from where the Leaper stands, as after being shot in the
  game, so every engagement becomes a re-find.
- ``look_after``: R6 switches on only after she has been out of sight this many
  steps (10 = the exams' 1 s "lost her" rule), so it pays for real losses.
- ``eye_hide`` (2026-11-16, yard only): Lola hides only where the Leaper's EYE cannot
  see her (the 3D sight test the exams use, from where it stands, turned to face the
  spot), not just behind anything on the flat map; its eye, 2.4 units up, sees over
  low junk, so about half the flat-hidden spots never hid her. Picks the same way
  (nearest 12, same route score) among eye-hidden spots 4-12 units from her, then
  4-20, then falls back to the flat rule; ``mover.pick_cases`` counts each case.
- ``look_scale``: R6's points per unit of walking distance (default 0.1).
- ``look_progress`` (2026-11-16): R6 paid as plain walking progress toward the spot where it
  lost her (look_scale per unit, capped at one step's move), not potential-based: no jump when a
  loss starts, no refund when it ends. Measured first: the yard has no "pocket" spots (none of 400
  sampled is hidden from more than 80% of the places 8-30 units away; the typical one is seen
  from 88%), so the world cannot force a walk to the spot; and with drills ending at the shot the
  reach bonus fired 0 times in 40 drills (shot from a median 15 units away).
- ``reach_bonus`` (with ``look_reach``): a real reward (not potential-based, at most 3 a round)
  each time it gets within 4 units of the spot where it lost her. R6 alone is potential-based, so
  it can only speed up learning whatever behaviour is already best; spotting her from the side
  was best, so walking to the spot needs a reward of its own to become the preferred behaviour.
- ``look_reach`` (2026-11-16, user: "it has to walk over to where it lost her"): R6 is done
  only when the Leaper stands within 4 units of the spot where it last saw her, not when it
  merely sees that spot; so R6 pays for walking there (drills showed brains spotting her from
  ~25 units away round the side and never going to the spot).
- ``flee_stay`` (2026-11-16, with ``shot_flee``, yard only): after a paid shot she
  takes cover at an (eye-)hidden spot and stays 10-25 s whatever her kind, then slips
  away (hider) or wanders on (wanderer): a hit player taking cover. Without it a
  wanderer runs on through her flee spot (measured: 3/4 of practice losses, she moves
  ~15 units while unseen), so the spot where it lost her was rarely worth checking.
- ``drill_vary`` (2026-11-16 ~21:15 IST, drills only): the search drill starts less staged:
  half the drills face a random way instead of toward V, and she was last seen 1-3 s ago
  instead of 1 s. Drill brains walked toward V twice as far as today's in drills but not in
  the free yard; a drill that always starts aimed at V with a fresh memory may be too narrow.
- ``lose_cover`` (2026-11-16 ~21:15 IST, yard practice only): this share of the moments she
  goes out of its sight (and is not already dashing to or sitting in cover, or fleeing),
  she ducks into the nearest cover 1-6 units from where she vanished (hidden from the
  Leaper's eye) and stays 10-25 s, like a player hiding the moment she breaks line of sight.
  So in ordinary yard rounds, walking to where it lost her finds her.
- ``drill_deep_path`` (2026-11-16 ~21:25 IST, drills only): S must also be hidden from every
  point of the walking route from the Leaper to V until 6 units from V; in 72-80% of v2 drills
  it saw her on the way, before it could have reached V.
- ``drill_share`` (2026-11-16, yard practice only): the search drill. This share of yard
  rounds start with a hider 10-20 map units away, the Leaper turned to face her and its
  eye seeing her at step 0 (re-drawn until it does); a hider dashes for cover the moment
  she is spotted, so the round opens with "it watched her run behind something".
- ``close_start_share`` (yard practice only): this share of yard rounds start 10-20
  map units apart (the probe's rule) instead of the game's 22-42, so it often watches
  her dive behind cover early. Set per environment, never as a module global.
- ``stay_found`` (2026-11-18, yard practice only; docs/HIDE_RETRAIN_PLAN_2026-11-18.md): she never comes back
  out by herself. Every time she goes out of its sight she ducks into eye-hidden cover 1-6 units away
  (``lose_cover`` at share 1.0), and every cover she takes (ducking, fleeing a shot, a hider's hiding
  spot) lasts until the Leaper sees her again; then she carries on (a hider slips away, a wanderer
  wanders). In ordinary practice she always reappeared, so waiting for her paid and looking did not.
- ``ducked_scale`` / ``ducked_after`` / ``ducked_reach`` / ``ducked_cap`` (2026-11-18, the reward redesign,
  docs/HIDE_RETRAIN_PLAN_2026-11-18.md): the walk-to-the-spot pay (``look_progress``) with its own, bigger
  settings, but only for **ducked** losses: at the moment she went out of its sight her real position was
  inside its 270-degree view (something solid hid her), not in the wedge behind it. Drill and hide-scene
  starts count as ducked. Scorer only (her real position never reaches the brain), so turning away cannot
  earn it and a spot behind it is not pushed toward backing up. None = the ordinary settings.
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

from rl.moving_target import HIDE_RANGE, HIDE_STAY_STEPS, MAP_TO_BRAIN, SPRINT_STEP, Grid, MovingTarget, _samples
from rl.moving_target_env import MovingTargetEnv
from rl.moving_target_game_exam import EYE, GameExamEnv, SIGHT_RANGE

SHOT_RANGE = 14 * MAP_TO_BRAIN     # 20.3 units: the game's engage.enterDistance
SHOT_STEPS = 10                    # 1 s in a row
HIDDEN_EXTRA_COST = 0.01           # R2: -0.02 instead of -0.01 while hidden
NOT_THERE_RADIUS = 4.0
REACH_CAP = 3                      # reach_bonus: at most this many a round
PROGRESS_CAP = 10.0                # look_progress: positive progress points at most this many a round
LOOK_SCALE = 0.1                   # R6: points per unit of walking distance
GAMMA = 0.995                      # the PPO discount, for potential-based shaping
PRIVILEGED = 4
SHOT_FLEE_REWARD, SHOT_FLEE_CAP = 10.0, 5
WALK_EVERY = 3                     # R4: rebuild her distance map at most every 3 steps
SCORING = ("shot_goal", "hidden_cost", "no_hidden_distance", "look_where", "walk_progress", "shot_flee")
INPUTS = ("new_inputs", "not_there", "privileged")
# How the yard's eye sees her (2026-11-18): real_heights puts her three sight points at the
# designer's 1.25/1.03/0.81 map units (rl/moving_target_game_exam.py REAL_HEIGHTS). It changes
# what input 0 and I2 report, so a run's exams use it too (rl/round1_train.py input_switches).
SIGHT = ("real_heights",)
TRAINING = ("hider_share",)


def observation_size(new_inputs=False, not_there=False, privileged=False, **_):
    return 34 + 3 * bool(new_inputs) + bool(not_there) + PRIVILEGED * bool(privileged)


class Round1Mixin:
    """Scoring switches and the "she's not there" input, over MovingTargetMixin."""

    def _r1_init(self, shot_goal=False, hidden_cost=False, no_hidden_distance=False,
                 not_there=False, look_where=False, privileged=False, hider_share=None,
                 walk_progress=False, shot_flee=False, look_after=0, eye_hide=False, look_scale=None,
                 flee_stay=False, look_reach=False, reach_bonus=0.0, look_progress=False,
                 drill_vary=False, lose_cover=0.0, drill_deep_path=False, progress_cap=None, shot_range=None, walk_scale=None, reverse_cost=0.0,
                 reverse_window=None, reverse_front=None, flip_cost=0.0, stay_found=False,
                 ducked_scale=None, ducked_after=None, ducked_reach=None, ducked_cap=None, **_):
        self.shot_goal, self.hidden_cost = shot_goal, hidden_cost
        self.no_hidden_distance, self.not_there = no_hidden_distance, not_there
        self.look_where, self.privileged, self.hider_share = look_where, privileged, hider_share
        self.walk_progress = walk_progress
        self.shot_flee, self.look_after = shot_flee, int(look_after)
        self.eye_hide = bool(eye_hide)
        self.flee_stay = bool(flee_stay)
        self.look_reach = bool(look_reach)
        self.reach_bonus = float(reach_bonus)
        self.look_progress = bool(look_progress)
        self.drill_vary = bool(drill_vary)
        self.drill_deep_path = bool(drill_deep_path)
        self.progress_cap = PROGRESS_CAP if progress_cap is None else float(progress_cap)
        # shot_range (2026-11-16 23:48 IST): the game's engage.enterDistance 14 is in world (brain) units
        # (src/config/leaper-behaviour.js), not map units; SHOT_RANGE (20.3) read it as map units.
        self.shot_range = SHOT_RANGE if shot_range is None else float(shot_range)
        # walk_scale (2026-11-16 23:58 IST): points per unit of walking progress toward her (walk_progress, R4).
        self.walk_scale = self.DISTANCE_REWARD_SCALE if walk_scale is None else float(walk_scale)
        # reverse_cost (2026-11-17 00:20 IST, user: penalise reversing when it is plainly not needed): this many
        # points x |throttle| per step of backing up while nothing is in the way: no bump in the last
        # REVERSE_CLEAR_STEPS steps and the 4 middle rays (straight ahead) open beyond REVERSE_FRONT_OPEN units.
        # Body context only (never 'is she in sight'), so it cannot pay it to look away.
        self.reverse_cost = float(reverse_cost)
        # reverse_window / reverse_front / flip_cost (02:25 IST 17 Nov): audit of F7GLSDPB5 at 14M showed ~60% of its
        # remaining reverse steps fall inside the 10-step after-bump exemption (bumps ~10% of steps, so the window
        # covers ~37% of the time) and flips after bumps run ~0.9/s. A tighter gate (window/front overrides) and
        # flip_cost: this many points per forward<->back switch of throttle with the same gate (no recent bump,
        # way ahead open), aimed at the twitch itself rather than at backing up.
        self.reverse_window = REVERSE_CLEAR_STEPS if reverse_window is None else int(reverse_window)
        self.reverse_front = REVERSE_FRONT_OPEN if reverse_front is None else float(reverse_front)
        self.flip_cost = float(flip_cost)
        self._last_dir = 0
        self._since_bump = 99
        self._last_obs = None
        self.stay_found = bool(stay_found)
        self.ducked_scale = None if ducked_scale is None else float(ducked_scale)
        self.ducked_after = self.look_after if ducked_after is None else int(ducked_after)
        self.ducked_reach = None if ducked_reach is None else float(ducked_reach)
        self.ducked_cap = None if ducked_cap is None else float(ducked_cap)
        self.loss_kind = None
        self.lose_cover = 1.0 if self.stay_found else float(lose_cover)
        self.lose_covers = 0
        self.look_prev = None
        self.reaches_paid = 0
        self.look_scale = LOOK_SCALE if look_scale is None else float(look_scale)
        self.shots_paid = 0
        size = observation_size(self.new_inputs, not_there, privileged)
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.shot_streak = 0
        self.shot_steps = 0
        self.first_shot = None
        self._look_reset()

    def _r1_reset(self, obs):
        self._since_bump = 99
        self._last_dir = 0
        self._last_obs = obs
        self.reaches_paid = 0
        self._hide_book = {}
        self.shots_paid = 0
        self.shot_streak = 0
        self.shot_steps = 0
        self.first_shot = None
        self._look_reset()
        # A drill or hide-scene start is a loss already under way, with her hidden in front of it.
        self.loss_kind = "ducked" if (self.target_ever_seen and not self.target_visible) else None
        self.ducked_breaks = self.behind_breaks = 0
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
        self.look_prev, self.look_prev_spot = None, None
        self.progress_paid = 0.0
        self.round_look, self.round_losses, self.round_unseen = 0.0, 0, 0
        self._her_field = None
        self.look_spot = None
        self.look_field = None
        self.look_done = False
        self.look_potential = 0.0

    def _break_kind(self):
        """She just went out of its sight: 'ducked' if her real position is inside its 270-degree view
        (something solid hides her), 'behind' if she is in the wedge at its back. Scorer only."""
        delta = np.asarray(self.target, dtype=np.float64) - np.asarray(self.position, dtype=np.float64)
        bearing = math.atan2(float(delta[0]), float(delta[1]))
        relative = abs((bearing - self.yaw + math.pi) % (2 * math.pi) - math.pi)
        return "ducked" if relative <= self.VISION_FOV / 2 else "behind"

    def _look_shaping(self, terminated):
        """gamma * new potential - old potential (R6), plus the reach bonus (not potential-based)."""
        new = 0.0
        bonus = 0.0
        ducked = self.ducked_scale is not None and self.loss_kind == "ducked"
        scale = self.ducked_scale if ducked else self.look_scale
        after = self.ducked_after if ducked else self.look_after
        reach = self.ducked_reach if (ducked and self.ducked_reach is not None) else self.reach_bonus
        cap = self.ducked_cap if (ducked and self.ducked_cap is not None) else self.progress_cap
        if (self.target_ever_seen and not self.target_visible and not terminated
                and getattr(self, "unseen_steps", 0) >= after):
            spot = np.asarray(self.last_seen_target, dtype=np.float64)
            if self.look_spot is None or np.linalg.norm(spot - self.look_spot) > 0.5:
                self.look_spot, self.look_done = spot, False
                self.look_field = self._walker().field(spot)
            if not self.look_done and (
                    np.linalg.norm(np.asarray(self.position, dtype=np.float64) - spot) <= NOT_THERE_RADIUS
                    if self.look_reach else self._spot_check(spot)):
                self.look_done = True
                if self.look_reach and reach and self.reaches_paid < REACH_CAP:
                    bonus = reach
                    self.reaches_paid += 1
            if not self.look_done:
                new = -scale * self._walker().distance(self.look_field, self.position, spot)
        elif self.target_visible:
            self.look_spot, self.look_done = None, False
        if self.look_progress:
            # Not potential-based (2026-11-16): pay the walking progress toward the spot where it lost
            # her, step by step (capped at one step's move), with no jump when the loss starts and no
            # refund when it ends. Walking there earns, wandering earns nothing, walking away costs, so
            # going to where it lost her becomes the preferred behaviour, not just a faster-found one.
            far = None if new == 0.0 else -new / scale
            paid = 0.0
            if far is not None and self.look_prev is not None and self.look_prev_spot is self.look_spot:
                paid = scale * float(np.clip(self.look_prev - far, -self.MOVE_SPEED, self.MOVE_SPEED))
                if paid > 0:   # positive progress capped per round, so losses cannot be farmed
                    paid = min(paid, max(0.0, cap - self.progress_paid))
                    self.progress_paid += paid
            self.look_prev, self.look_prev_spot = far, self.look_spot
            self.look_potential = 0.0
            return paid + bonus
        paid = GAMMA * new - self.look_potential
        self.look_potential = new
        return paid + bonus

    def step(self, action):
        was_visible, had_seen = self.target_visible, self.target_ever_seen
        before = np.asarray(self.position, dtype=np.float64).copy()
        obs, reward, terminated, truncated, info = super().step(action)
        if was_visible and not self.target_visible:
            self.loss_kind = self._break_kind()
            if self.loss_kind == "ducked":
                self.ducked_breaks += 1
            else:
                self.behind_breaks += 1
        if self.lose_cover and was_visible and not self.target_visible and not terminated:
            self._take_cover_near()
        terms = info["reward_terms"]
        if self.walk_progress and had_seen:
            far_before, far_now = self._walk_to_her(before)
            walked = float(np.clip(far_before - far_now, -self.MOVE_SPEED, self.MOVE_SPEED))
            paid = walked * self.walk_scale
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
            self.round_look += paid
        # Round bookkeeping for the trainer's log: genuine losses (3 s+ unseen) and R6 per round.
        if self.target_ever_seen and not self.target_visible:
            self.round_unseen += 1
            if self.round_unseen == 30:
                self.round_losses += 1
        else:
            self.round_unseen = 0
        # Clear-shot bookkeeping (exams report it; R1 wins on it).
        clear_shot = self.target_visible and self._distance() <= self.shot_range
        self.shot_streak = self.shot_streak + 1 if clear_shot else 0
        if clear_shot:
            self.shot_steps += 1
            if self.first_shot is None:
                self.first_shot = self.steps
        info["shot_win"] = False
        if (self.shot_flee and not terminated and self.shot_streak >= SHOT_STEPS
                and self.shots_paid < SHOT_FLEE_CAP):
            reward += SHOT_FLEE_REWARD
            terms["goal"] += SHOT_FLEE_REWARD
            info["shot_win"] = True
            self.shots_paid += 1
            self.shot_streak = 0
            self._make_her_flee()
        if self.shot_goal and not terminated and self.shot_streak >= SHOT_STEPS:
            reward += self.GOAL_REWARD
            terms["goal"] += self.GOAL_REWARD
            info["shot_win"] = True
            info["is_success"] = True
            terminated, truncated = True, False
        info["extrinsic_reward"] = reward
        if terminated or truncated:
            info["round_look"], info["round_losses"] = self.round_look, self.round_losses
            shot = dict(first_shot_s=None if self.first_shot is None else self.first_shot / 10,
                        shot_share=self.shot_steps / max(1, self.steps))
            info["shot"] = shot
            if "lost_her" in info:
                info["lost_her"] = dict(info["lost_her"], **shot)
        self._hide_watch(terminated, truncated, info)
        if self.reverse_cost or self.flip_cost:
            throttle = float(np.asarray(action, dtype=np.float64).reshape(-1)[0])
            front = float(np.min(self._last_obs[16:20])) * RAY_RANGE if self._last_obs is not None else 0.0
            gate = self._since_bump >= self.reverse_window and front > self.reverse_front
            charge = flip = 0.0
            if throttle < 0.0 and gate:
                charge = self.reverse_cost * min(1.0, -throttle)
            direction = 1 if throttle > 0.05 else -1 if throttle < -0.05 else 0
            if direction and self._last_dir and direction != self._last_dir and gate:
                flip = self.flip_cost
            if direction:
                self._last_dir = direction
            reward -= charge + flip
            terms["reverse"] = -charge
            terms["flip"] = -flip
            self._since_bump = 0 if obs[7] > 0.5 else self._since_bump + 1
            self._last_obs = obs
            info["extrinsic_reward"] = reward
        return self._r1_extend(obs), reward, terminated, truncated, info

    def _take_cover_near(self):
        """lose_cover: she just went out of its sight; this share of the time she ducks into the
        nearest eye-hidden cover 1-6 units away and stays there 10-25 s (flee_stay's stay)."""
        m = self.mover
        if not isinstance(m, EyeHidingTarget) or m.eye_hidden is None:
            return
        if m.flee_pending or m.state in ("dash", "hide") or m.rng.random() >= self.lose_cover:
            return
        spot, route = m._pick_near(np.asarray(self.position, dtype=np.float64), LOSE_COVER_RANGE)
        if spot is None:
            return
        if m.kind == "hider":
            m.state, m.hide_spot = "dash", spot
        m.hidings.append(dict(start=m.steps, arrive=None, spot=spot.tolist(), watched=False, lose_cover=True))
        m.wait = 0
        m.covering = False      # stay_found: a new dash leaves the old cover
        m._go(spot, SPRINT_STEP, route)
        m.flee_pending = True
        self.lose_covers += 1

    def _make_her_flee(self):
        """After a shot: she sprints to a spot hidden from where the Leaper stands."""
        m = self.mover
        if m is None:
            return
        spot, route = m._pick_hide(np.asarray(self.position, dtype=np.float64), watched=False)
        if spot is None:
            return
        if m.kind == "hider":
            m.state, m.hide_spot = "dash", spot
            m.hidings.append(dict(start=m.steps, arrive=None, spot=spot.tolist(), watched=True))
        elif self.flee_stay:
            m.hidings.append(dict(start=m.steps, arrive=None, spot=spot.tolist(), watched=True, flee=True))
        m.wait = 0
        m.covering = False      # stay_found: a new dash leaves the old cover
        m._go(spot, SPRINT_STEP, route)
        if self.flee_stay and isinstance(m, EyeHidingTarget):
            m.flee_pending = True

    def _hide_watch(self, terminated, truncated, info):
        """Exams only (metrics on): for each hiding, did it see her there / reach the spot
        within 10 s, and could a perfect walk have got within 4 units in 10 s? Never raises."""
        try:
            if self.lost is None or self.mover is None:
                return
            book = self.__dict__.setdefault("_hide_book", {})
            for i, h in enumerate(self.mover.hidings):
                if h.get("arrive") is None:
                    continue
                if i not in book:
                    spot = np.asarray(h["spot"], dtype=np.float64)
                    walker = self._walker()
                    walk0 = float(walker.distance(walker.field(spot), self.position, spot))
                    book[i] = dict(arrive=h["arrive"], spot=spot, walk0=walk0, seen=None, reached=None)
                b = book[i]
                age = self.steps - b["arrive"]
                if 0 <= age <= 100:
                    if (b["seen"] is None and self.target_visible and self.mover.state == "hide"
                            and np.linalg.norm(np.asarray(self.target) - b["spot"]) < 1.0):
                        b["seen"] = age / 10
                    if b["reached"] is None and np.linalg.norm(self.position - b["spot"]) <= NOT_THERE_RADIUS:
                        b["reached"] = age / 10
            if (terminated or truncated) and isinstance(info.get("lost_her"), dict):
                info["lost_her"]["hidings_seen"] = [
                    dict(walk0=b["walk0"], reachable=bool(b["walk0"] - NOT_THERE_RADIUS <= self.MOVE_SPEED * 100),
                         seen10=b["seen"], reached10=b["reached"]) for b in book.values()]
        except Exception as error:      # a measurement must never break an exam
            if isinstance(info.get("lost_her"), dict):
                info["lost_her"]["hidings_seen_error"] = repr(error)


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

    def __init__(self, seed, metrics=True, new_inputs=False, kind=None, real_heights=False, site=None, **switches):
        GameExamEnv.__init__(self, seed, new_inputs=new_inputs, kind=kind, real_heights=real_heights, site=site)
        if not metrics:
            self.lost = None
        self._r1_init(**switches)

    def reset(self, *, seed=None, options=None):
        obs, info = GameExamEnv.reset(self, seed=seed, options=options)
        if (self.eye_hide or self.flee_stay or self.stay_found) and self.mover is not None:
            EyeHidingTarget.adopt(self.mover, self._eye_hidden if (self.eye_hide or self.stay_found) else None)
            self.mover.stay_found = self.stay_found
        return self._r1_reset(obs), info

    def _eye_hidden(self, leaper, spot):
        """True if the eye, standing at ``leaper`` and turned to face ``spot``, sees none of
        Lola's three body points there (the exams' sight test without the field of view)."""
        delta = np.asarray(spot, dtype=np.float64) - np.asarray(leaper, dtype=np.float64)
        if np.linalg.norm(delta) - self.TARGET_RADIUS > SIGHT_RANGE:
            return True
        yaw = math.atan2(delta[0], delta[1])
        c, s = math.cos(yaw), math.sin(yaw)
        origin = np.array([leaper[0] + EYE[0] * c + EYE[2] * s, EYE[1], leaper[1] - EYE[0] * s + EYE[2] * c])
        return all(self.sight.hit(origin, np.asarray(p)) is not None for p in self._points(spot))

    _YARD_WALKER = None

    def _walker(self):
        site = getattr(self, "_site", None)
        if site is not None:          # another world (rl/hide_arena.py): its own walker, built once per site
            if site.get("walker") is None:
                from rl.walk_field import LeaperWalk
                site["walker"] = LeaperWalk(self._world)
            return site["walker"]
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

    def __init__(self, seed, drill=False, **switches):
        self.drill_mode = bool(drill)      # search drill v2: every round of this environment is a drill
        self.drill_steps = 0
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
        close = switches.pop("close_start_share", 0.0)
        drill = switches.pop("drill_share", 0.0)
        kind = None if share is None else ("hider" if self.rng.random() < share else "wanderer")
        if self.drill_mode:
            self.drill_steps = 0
            for attempt in range(30):
                seed = round_seed if attempt == 0 else int(self.rng.integers(1_000_000, 2**31 - 1))
                if 70000 <= seed < 70100:
                    continue
                self.inner = Round1YardEnv(seed, metrics=False, kind="hider", **switches)
                obs, info = self.inner.reset(seed=seed)
                drilled = setup_drill(self.inner, self.rng)
                if drilled is not None:
                    self.drills = getattr(self, "drills", 0) + 1
                    return drilled, dict(info, target_visible=False, drill=self.inner.drill)
                self.inner.close()
            self.drill_misses = getattr(self, "drill_misses", 0) + 1
            return obs, info
        import rl.moving_target_game_exam as game_exam
        normal, facing = game_exam.START_APART, game_exam.START_FACING
        if drill and self.rng.random() < drill:
            self.drills = getattr(self, "drills", 0) + 1
            try:
                game_exam.START_APART = (10 * MAP_TO_BRAIN, 20 * MAP_TO_BRAIN)
                game_exam.START_FACING = True
                for attempt in range(20):
                    seed = round_seed if attempt == 0 else int(self.rng.integers(1_000_000, 2**31 - 1))
                    if 70000 <= seed < 70100:
                        continue
                    self.inner = Round1YardEnv(seed, metrics=False, kind="hider", **switches)
                    obs, info = self.inner.reset(seed=seed)
                    if self.inner.target_visible:
                        return obs, info
                    self.inner.close()
                self.drill_misses = getattr(self, "drill_misses", 0) + 1
                return obs, info
            finally:
                game_exam.START_APART, game_exam.START_FACING = normal, facing
        if close and self.rng.random() < close:
            game_exam.START_APART = (10 * MAP_TO_BRAIN, 20 * MAP_TO_BRAIN)
        try:
            self.inner = Round1YardEnv(round_seed, metrics=False, kind=kind, **switches)
        finally:
            game_exam.START_APART = normal
        return self.inner.reset(seed=round_seed)

    def step(self, action):
        obs, reward, terminated, truncated, info = self.inner.step(action)
        if self.drill_mode and getattr(self.inner, "drill", None) is not None:
            self.drill_steps += 1
            if info.get("shot_win") and not terminated:
                terminated, truncated = True, False      # found her: the drill is won
                info["is_success"] = True
            elif not terminated and self.drill_steps >= DRILL_STEPS:
                truncated = True                         # time out (bootstrapped, not a loss)
            if terminated or truncated:
                info["round_look"] = getattr(self.inner, "round_look", None)
                info["round_losses"] = getattr(self.inner, "round_losses", None)
        return obs, reward, terminated, truncated, info


class EyeHidingTarget(MovingTarget):
    """Lola for ``eye_hide``: her hiding spots are hidden from the Leaper's eye (see the module
    docstring). Eye-hidden spots are a subset of flat-hidden ones (measured 2026-11-16: 0 of
    12,000 pairs the other way), so the flat test filters first and the eye test runs nearest-
    first, at most ``MAX_TESTS`` per ring."""

    WIDE = 20.0
    MAX_TESTS = 150

    FLEE_STAY_STEPS = (100, 250)      # flee_stay: 10-25 s in cover after a shot

    @classmethod
    def adopt(cls, mover, eye_hidden):
        """``eye_hidden`` None: flat hiding as before (flee_stay alone)."""
        mover.__class__ = cls
        mover.eye_hidden = eye_hidden
        mover.flee_pending = False
        mover.pick_cases = dict(eye=0, eye_wide=0, flat=0, none=0, blocked=0)
        mover.stay_found = False
        mover.covering = False
        return mover

    def advance(self, leaper, spotted):
        stay_found = getattr(self, "stay_found", False)
        if stay_found and self.covering and spotted:
            # stay_found: seen in her cover, she carries on (a hider slips away, a wanderer wanders on).
            self.covering, self.wait = False, 0
        if self.flee_pending and not self.route:
            # Arrived at her flee spot: stay in cover, whatever her kind.
            self.flee_pending = False
            stay = int(self.rng.integers(self.FLEE_STAY_STEPS[0], self.FLEE_STAY_STEPS[1] + 1))
            if stay_found:
                stay, self.covering = STAY_FOUND_STEPS, True
            if self.kind == "hider":
                self.state = "hide"
            if self.hidings and self.hidings[-1].get("arrive") is None:
                self.hidings[-1]["arrive"] = self.steps + 1
            self.wait = stay
        result = MovingTarget.advance(self, leaper, spotted)
        if (stay_found and self.kind == "hider" and self.state == "hide" and not self.covering
                and self.wait > 0):
            # stay_found: her own hiding spot, too, lasts until she is seen.
            self.wait, self.covering = STAY_FOUND_STEPS, True
        return result

    def _best(self, leaper, spots, watched):
        """The original _pick_hide's choice among ``spots`` (nearest 12, route score)."""
        order = np.argsort(np.linalg.norm(spots - self.position, axis=1))
        best = None
        for index in order[:12]:
            route = self.grid.route(self.position, spots[index], avoid=self._leaper)
            if not route:
                continue
            length = Grid.length(self.position, route)
            if watched:
                samples = _samples(self.position, route, 0.5)
                lead = samples[:-4] if len(samples) > 4 else samples[:1]
                unseen = float(np.mean(self.world.hidden_from(leaper, lead, self.slack)))
                score = length * (1.0 + 2.0 * unseen)
            else:
                score = length
            if best is None or score < best[0]:
                best = (score, spots[index], route)
        return (None, None) if best is None else (best[1], best[2])

    def _pick_near(self, leaper, ring):
        """lose_cover: the best eye-hidden spot ``ring`` (low, high) units from her, or (None, None)."""
        from rl.player_blocked import inside
        spots = self._candidates(*ring)
        if not len(spots):
            return None, None
        spots = spots[self.world.hidden_from(leaper, spots, self.slack)]
        spots = spots[~inside(spots, margin=0.5)]
        keep = []
        for index in np.argsort(np.linalg.norm(spots - self.position, axis=1))[:self.MAX_TESTS]:
            if self.eye_hidden(leaper, spots[index]):
                keep.append(index)
                if len(keep) >= 12:
                    break
        if not keep:
            return None, None
        return self._best(leaper, spots[keep], False)

    def _pick_hide(self, leaper, watched):
        if self.eye_hidden is None:
            return MovingTarget._pick_hide(self, leaper, watched)
        from rl.player_blocked import inside
        leaper = np.asarray(leaper, dtype=np.float64)
        for case, (low, high) in (("eye", HIDE_RANGE), ("eye_wide", (HIDE_RANGE[0], self.WIDE))):
            spots = self._candidates(low, high)
            if not len(spots):
                continue
            spots = spots[self.world.hidden_from(leaper, spots, self.slack)]
            # Never inside the containers the game closes to her (none of her cells are, 2026-11-16).
            blocked = inside(spots, margin=0.5)
            self.pick_cases["blocked"] += int(blocked.sum())
            spots = spots[~blocked]
            order = np.argsort(np.linalg.norm(spots - self.position, axis=1))
            keep = []
            for index in order[:self.MAX_TESTS]:
                if self.eye_hidden(leaper, spots[index]):
                    keep.append(index)
                    if len(keep) >= 12:
                        break
            if keep:
                spot, route = self._best(leaper, spots[keep], watched)
                if spot is not None:
                    self.pick_cases[case] += 1
                    return spot, route
        spot, route = MovingTarget._pick_hide(self, leaper, watched)
        self.pick_cases["flat" if spot is not None else "none"] += 1
        return spot, route


# --- Search drill v2 (2026-11-16) ---------------------------------------------------------
DRILL_RANGE = (15.0, 35.0)       # her hiding spot S: straight-line units from the Leaper (beyond ~10, where nothing hides her)
DRILL_WALK_MAX = 45.0            # and a walk the Leaper can make in about 12 s
DRILL_CORNER = (3.0, 6.0)        # V, where it last sees her: this far from S, visible to its eye
DRILL_STEPS = 300                # a drill round ends at the first paid shot (found her) or after 30 s
DRILL_SEEN_AGO = 10              # it last saw her 1 s before the round starts
DRILL_DEEP = 5.0                 # S also hidden from points this far ahead of and beside the Leaper
DRILL_VARY_TURN = 0.5            # drill_vary: this share of drills face a random way, the rest V +-0.6 rad
LOSE_COVER_RANGE = (1.0, 6.0)    # lose_cover: her cover this far from where she vanished
STAY_FOUND_STEPS = 10**6           # stay_found: her cover lasts until she is seen (longer than any round)
REVERSE_CLEAR_STEPS = 10           # reverse_cost: no bump in this many steps
REVERSE_FRONT_OPEN = 6.0           # and straight ahead open beyond this many units
RAY_RANGE = 28.0                   # the 16 rays report distance / 28
DRILL_PATH_OPEN = 6.0            # drill_deep_path: the route to V may see S only this close to V


def _hidden_on_approach(env, mover, leaper, corner, spot):
    """drill_deep_path: S is hidden from her eye-level at every point (2 units apart) of the
    walking route from the Leaper to V, until DRILL_PATH_OPEN units from V. So walking straight
    to where it lost her reveals her only near V; a side view can still show her earlier."""
    approach = mover.grid.route(leaper, corner)
    if not approach:
        return False
    points = _samples(leaper, approach, 2.0)
    points = points[np.linalg.norm(points - corner, axis=1) > DRILL_PATH_OPEN]
    return all(env._eye_hidden(p, spot) for p in points)


def setup_drill(env, rng):
    """Turn a freshly reset Round1YardEnv into a search drill; returns the new observation or None.

    Picks S (eye-hidden from the Leaper, 15-35 units away, walkable within ~45 units, outside the
    game's closed containers) and V (3-6 units from S, visible to its eye, with a route to S). The
    round starts 1 s after it lost her: it faces V, its memory says "last seen at V 1 s ago,
    sprinting toward S" (the inputs a watched dash leaves), and she is crouched at S (a hider,
    staying 30-60 s). A first version that started with her visible at V gave a genuine loss in
    only 45% of drills (it kept her in view and shot her), so the loss is now built in.
    """
    from rl.player_blocked import inside
    from rl.moving_target import SPRINT_STEP
    leaper = np.asarray(env.position, dtype=np.float64).copy()
    cells = env._grid.open_centres
    gap = np.linalg.norm(cells - leaper, axis=1)
    pool = cells[(gap >= DRILL_RANGE[0]) & (gap <= DRILL_RANGE[1])]
    pool = pool[~inside(pool, margin=0.5)]
    if not len(pool):
        return None
    walker = env._walker()
    field = walker.field(leaper)
    mover = env.mover
    for index in rng.permutation(len(pool))[:80]:
        spot = pool[index]
        if walker.distance(field, spot, leaper) > DRILL_WALK_MAX or not env._eye_hidden(leaper, spot):
            continue
        # Deep cover: also hidden from 5 units toward her and to either side, so a step or two
        # does not reveal her (shallow spots gave a genuine loss in only 60% of drills).
        ahead = (spot - leaper) / max(float(np.linalg.norm(spot - leaper)), 1e-9)
        side = np.array([ahead[1], -ahead[0]])
        if not all(env._eye_hidden(leaper + DRILL_DEEP * d, spot) for d in (ahead, side, -side)):
            continue
        near = np.linalg.norm(cells - spot, axis=1)
        corners = cells[(near >= DRILL_CORNER[0]) & (near <= DRILL_CORNER[1])]
        for j in rng.permutation(len(corners))[:12]:
            corner = corners[j]
            if env._eye_hidden(leaper, corner):
                continue
            route = mover.grid.route(corner, spot, avoid=leaper)
            if not route:
                continue
            if getattr(env, "drill_deep_path", False) and not _hidden_on_approach(env, mover, leaper, corner, spot):
                continue
            delta = corner - leaper
            env.yaw = float(math.atan2(delta[0], delta[1]))
            vary = getattr(env, "drill_vary", False)
            if vary:
                turn = math.pi if rng.random() < DRILL_VARY_TURN else 0.6
                env.yaw = float((env.yaw + rng.uniform(-turn, turn) + math.pi) % (2 * math.pi) - math.pi)
            # She vanished 1 s ago: last seen at V sprinting toward S, now crouched at S (hidden from
            # its eye by construction) and staying 30-60 s. Every drill starts with a genuine loss.
            env.target = np.asarray(spot, dtype=env.target.dtype).copy()
            mover.position = np.asarray(spot, dtype=np.float64).copy()
            mover.kind, mover.state, mover.hide_spot, mover.route = "hider", "hide", spot.copy(), []
            mover.wait = int(rng.integers(HIDE_STAY_STEPS[0], HIDE_STAY_STEPS[1] + 1))
            mover.hidings.append(dict(start=mover.steps, arrive=mover.steps, spot=spot.tolist(), watched=True, drill=True))
            env._update_target_memory(increment_time=False)
            if env.target_visible:
                continue
            heading = (spot - corner) / max(float(np.linalg.norm(spot - corner)), 1e-9)
            env.target_ever_seen = True
            env.last_seen_target = np.asarray(corner, dtype=env.last_seen_target.dtype).copy()
            ago = int(rng.integers(DRILL_SEEN_AGO, 3 * DRILL_SEEN_AGO + 1)) if vary else DRILL_SEEN_AGO
            env.steps_since_target_seen = ago
            env.unseen_steps = ago
            env.previous_seen_target = None
            env.motion_note = np.array([heading[0], heading[1], 1.0], dtype=np.float32)
            env.drill = dict(spot=spot.tolist(), corner=corner.tolist(), leaper=leaper.tolist())
            return env._r1_reset(env._extend(env.initial_observation()))
    return None
