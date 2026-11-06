"""Practice world for the moving-target retrain (runs A and D, 2026-11-05).

Built on the lab's SeekerEnv (34 inputs, identical to the frozen recipe), with
today's brain's own recipe, run "06_reverse_urgency" (reverse_urgency_config):

* signed throttle: negative reverses (as rl/junkyard_env.py plays it);
* time cost 0.01 a step once the target has been seen, 0.002 before. The run's
  spec (output/markdown/Leaper_Next_Training_Runs_Revised_LR_2026-09-12.md)
  says "time-cost changes apply only after target discovery".

Switches (all off = today's brain's practice world exactly):

* ``moving``: the target moves and hides (rl/moving_target.py). The "closing in"
  reward is measured against where she is after her step, so only the Leaper's
  own move is paid or charged.
* ``new_inputs``: 3 more inputs (37 in all): which way she was moving (2) and
  how fast, as a share of her sprint (1), worked out from two sightings in a
  row; frozen while she is out of sight, 0 before the first.
* ``refind_bonus``: +0.5 each time it sees her again after 2 s or more out of
  sight, at most 3 a round.

``metrics=True`` adds the plan's "lost her" numbers to each round's row
(``LostHerMetrics``); nothing in the brain's inputs ever reads them.
"""
from __future__ import annotations

import math

import numpy as np
from gymnasium import spaces

from rl.seeker_env import SeekerEnv
from rl.moving_target import ArenaWorld, MovingTarget, SPRINT_STEP

URGENCY_COST = 0.01
REFIND_BONUS = 0.5
REFIND_MIN_UNSEEN = 20      # 2 s
REFIND_CAP = 3
LOST_AFTER = 10             # "lost her": out of sight a full second
REFIND_WINDOW = 120         # 12 s
FOLLOW_WINDOW = 30          # 3 s
HOVER_RADIUS = 4.0
HOVER_AWAY = 8.0
HIDE_CHECK_WINDOW = 100     # 10 s
HIDE_CHECK_RADIUS = 4.0


class MovingTargetMixin:
    """The moving-target rules, shared by the practice arena and the junkyard exam."""

    def _mt_init(self, moving, new_inputs, refind_bonus, metrics, kind):
        self.moving = moving
        self.new_inputs = new_inputs
        self.refind_bonus = refind_bonus
        self.forced_kind = kind
        size = 37 if new_inputs else 34
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.lost = LostHerMetrics() if metrics else None
        self.mover = None
        self.motion_note = np.zeros(3, dtype=np.float32)

    @classmethod
    def physical_throttle(cls, action_throttle):
        return float(action_throttle)   # today's brain: negative = reverse

    def _extend(self, obs):
        return np.concatenate((obs, self.motion_note)) if self.new_inputs else obs

    def _mt_reset(self, world, rng, grid=None):
        self.motion_note = np.zeros(3, dtype=np.float32)
        self.previous_seen_target = self.target.copy() if self.target_visible else None
        self.unseen_steps = 0
        self.refinds = 0
        self.mover = (MovingTarget(world, self.target, rng, kind=self.forced_kind,
                                   slack=self.TARGET_RADIUS, grid=grid) if self.moving else None)
        if self.lost:
            self.lost.reset(self)


    def _target_info(self):
        mover = self.mover
        return dict(target_kind=mover.kind if mover else "still",
                    target_state=mover.state if mover else "still",
                    target_hidings=list(mover.hidings) if mover else [])

    def step(self, action):
        if self.mover is not None:
            self.mover.advance(self.position, self.target_visible)
            self.target = self.mover.position.astype(np.float32)
            # Pay or charge only the Leaper's own move: distance from where it
            # stands to where she is now.
            self.prev_distance = self._distance()
        was_visible, had_seen = self.target_visible, self.target_ever_seen
        obs, reward, terminated, truncated, info = super().step(action)
        if self.target_ever_seen:
            extra = URGENCY_COST - self.STEP_PENALTY
            reward -= extra
            info["reward_terms"]["time"] -= extra
        # Re-find bonus.
        bonus = 0.0
        if self.target_visible:
            if (self.refind_bonus and had_seen and not was_visible
                    and self.unseen_steps >= REFIND_MIN_UNSEEN and self.refinds < REFIND_CAP):
                bonus = REFIND_BONUS
                self.refinds += 1
            self.unseen_steps = 0
        elif self.target_ever_seen:
            self.unseen_steps += 1
        reward += bonus
        info["reward_terms"]["sight"] += bonus
        info["refind_bonus"] = bonus
        # Her direction and speed from two sightings in a row; frozen otherwise.
        if self.target_visible:
            if self.previous_seen_target is not None:
                velocity = self.target - self.previous_seen_target
                speed = float(np.linalg.norm(velocity))
                direction = velocity / speed if speed > 1e-6 else np.zeros(2)
                self.motion_note = np.array([direction[0], direction[1],
                                             min(1.0, speed / SPRINT_STEP)], dtype=np.float32)
            self.previous_seen_target = self.target.copy()
        else:
            self.previous_seen_target = None
        info.update(self._target_info())
        info["extrinsic_reward"] = reward
        if self.lost:
            self.lost.step(self, info, terminated or truncated)
            if terminated or truncated:
                info["lost_her"] = self.lost.row()
        return self._extend(obs), reward, terminated, truncated, info


class MovingTargetEnv(MovingTargetMixin, SeekerEnv):
    def __init__(self, moving=True, new_inputs=False, refind_bonus=False, metrics=False,
                 kind=None):
        SeekerEnv.__init__(self, "control", metrics=False)
        self._mt_init(moving, new_inputs, refind_bonus, metrics, kind)

    def reset(self, *, seed=None, options=None):
        obs, info = SeekerEnv.reset(self, seed=seed, options=options)
        rng = None
        if self.moving:
            # Route randomness from the maze number, so a maze always plays the same.
            rng = (np.random.default_rng((int(seed), 20261105)) if seed is not None
                   else np.random.default_rng(int(self.np_random.integers(2**63))))
        self._mt_reset(ArenaWorld(self.obstacles, self.WORLD_LIMIT), rng)
        info.update(self._target_info())
        return self._extend(obs), info


class LostHerMetrics:
    """Numbers 2-6 and 11 of the plan, scored from where she really is."""

    def reset(self, env):
        self.step_index = 0
        self.visible_run = bool(env.target_visible)
        self.last_visible_target = env.target.copy() if env.target_visible else None
        self.unseen = 0
        self.open = []          # moments not yet finished
        self.moments = []
        self.hidings = {}
        self.positions = [env.position.copy()]
        self.targets = [env.target.copy()]

    def step(self, env, info, done):
        self.step_index += 1
        t = self.step_index
        position, target = env.position.copy(), env.target.copy()
        self.positions.append(position)
        self.targets.append(target)
        visible = bool(env.target_visible)
        if visible:
            for m in self.open:
                if m["refound_step"] is None:
                    m["refound_step"] = t
            self.open = []
            self.last_visible_target = target.copy()
            self.unseen = 0
        elif self.last_visible_target is not None:
            self.unseen += 1
            if self.unseen == LOST_AFTER:
                vanish = t - LOST_AFTER + 1   # first step out of sight
                m = dict(vanish_step=vanish, vanish_spot=self.last_visible_target.tolist(),
                         leaper_start=self.positions[vanish - 1].tolist(),
                         target_start=self.targets[vanish - 1].tolist(),
                         refound_step=None, hover_steps=0)
                # Hovering counted from the vanish step on.
                for k in range(vanish, t + 1):
                    m["hover_steps"] += self._hovering(m, self.positions[k], self.targets[k])
                self.open.append(m)
                self.moments.append(m)
            elif self.unseen > LOST_AFTER:
                for m in self.open:
                    m["hover_steps"] += self._hovering(m, position, target)
        for m in self.moments:
            if m.get("follow") is None and t - m["vanish_step"] + 1 == FOLLOW_WINDOW + 1:
                self._follow(m, t)
        # Hiding moments (hider rounds): did it reach the spot within 10 s of her arrival?
        for i, h in enumerate(info.get("target_hidings", [])):
            if h.get("arrive") is None or not h.get("watched"):
                continue
            record = self.hidings.setdefault(i, dict(spot=h["spot"], arrive=h["arrive"], checked=False))
            if not record["checked"] and t - record["arrive"] <= HIDE_CHECK_WINDOW:
                if np.linalg.norm(position - np.asarray(record["spot"])) <= HIDE_CHECK_RADIUS:
                    record["checked"] = True
        self.done = done
        self.caught = bool(info.get("is_success", False))

    @staticmethod
    def _hovering(m, position, target):
        spot = np.asarray(m["vanish_spot"])
        return int(np.linalg.norm(position - spot) <= HOVER_RADIUS
                   and np.linalg.norm(target - spot) > HOVER_AWAY)

    def _follow(self, m, t):
        """Number 3 (goes her way) and number 5 (gap change) over the 3 s after."""
        start = np.asarray(m["leaper_start"])
        end = self.positions[t]
        her_now = self.targets[t]
        spot = np.asarray(m["vanish_spot"])
        moved = end - start
        if np.linalg.norm(moved) < 0.5:
            goes = False
        else:
            def angle(v):
                return abs(math.atan2(moved[0] * v[1] - moved[1] * v[0], float(moved @ v)))
            goes = bool(angle(her_now - start) < angle(spot - start))
        m["follow"] = goes
        m["gap_change"] = float(np.linalg.norm(her_now - end)
                                - np.linalg.norm(np.asarray(m["target_start"]) - start))

    def row(self):
        moments = []
        for m in self.moments:
            refound = m["refound_step"]
            moments.append(dict(
                vanish_step=m["vanish_step"],
                refound=bool(refound is not None and refound - m["vanish_step"] <= REFIND_WINDOW),
                refind_seconds=(refound - m["vanish_step"]) / 10 if refound is not None else None,
                goes_her_way=m.get("follow"), gap_change=m.get("gap_change"),
                hover_seconds=m["hover_steps"] / 10))
        hidings = [dict(spot=h["spot"], arrive=h["arrive"], checked=h["checked"],
                        complete=self.step_index - h["arrive"] >= HIDE_CHECK_WINDOW or h["checked"]
                        or self.caught)
                   for h in self.hidings.values()]
        return dict(moments=moments, hidings=hidings)


def summarize_lost_her(rows):
    """Pool the per-round lost-her data into numbers 2-6 and 11."""
    moments = [m for r in rows for m in r.get("lost_her", {}).get("moments", [])]
    def median(values):
        values = [v for v in values if v is not None]
        return float(np.median(values)) if values else None
    def rate(values):
        values = [v for v in values if v is not None]
        return float(np.mean(values)) if values else None
    hidings = [h for r in rows for h in r.get("lost_her", {}).get("hidings", [])]
    caught = [r["steps"] / 10 for r in rows if r["success"]]
    return {
        "lost_her_moments": len(moments),
        "refind_rate": rate([m["refound"] for m in moments]),
        "goes_her_way_rate": rate([m["goes_her_way"] for m in moments]),
        "goes_her_way_moments": sum(m["goes_her_way"] is not None for m in moments),
        "hover_seconds_median": median([m["hover_seconds"] for m in moments]),
        "gap_change_median": median([m["gap_change"] for m in moments]),
        "refind_seconds_median": median([m["refind_seconds"] for m in moments if m["refound"]]),
        "catch_seconds_median": median(caught),
        "hiding_moments": len(hidings),
        "hiding_checked_rate": rate([h["checked"] for h in hidings]),
    }
