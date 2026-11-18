"""Hide-and-stay scenes (2026-11-18, docs/HIDE_RETRAIN_PLAN_2026-11-18.md).

The Leaper last saw Lola at V; she is crouched at S, 1.5-5 units (her walk) from V, behind cover. She
stays hidden until it finds her (stay), or moves on once (shift, back-off). In ordinary practice she
always comes back out, so waiting for her paid; here only going to look does.

A scene (``draw_scene``), all rules checked when it is drawn and recorded in the scene dict:

- L: the Leaper's start (the yard's game start rule); it faces V (V in its eye's sight, 8-25 units).
- S: hidden from its eye at L, and at L moved 1.5 and 3 units back, left and right (facing V), each
  tested turned to face S (the strictest test). A step its body cannot make is recorded as blocked
  and cannot reveal her.
- Winnable: a pose its body fits in, reachable along a route for a body of radius 3.4 (its side legs
  reach 3.48) within 30 walking units, sees S within the shot range (18.3 units) whether it faces her or
  turns 10 or 20 degrees off (no knife-edge views).
- Start: ``natural`` scenes open with her in sight at V; she sprints to S and stays (the brain lives
  through the loss, its memory and her heading are the environment's own). Other scenes open 1-3 s
  after the loss, as the drills do (memory: last seen at V, moving V->S); a quarter of those face a
  random way.
- Variants: stay (she never moves), shift (after 4-10 s unfound she moves quietly to another hidden
  spot 2-6 units away), back-off (when its walk to her falls under 10 units unfound she slips 3-8
  units further away). Once it has seen her she stays where she is.
- ``HidePractice`` ends a scene at the first paid shot (1 s clear shot, +10) or after 30 s (time-out,
  bootstrapped, not a failure). Lola never flees, ducks or slips away inside a scene.

    python -m rl.hide_scenes --census 500 --out census.json     # the census (yard)
    python -m rl.hide_scenes --bank 2000 --seed 1 --out bank.json   # scenes for practice
"""
from __future__ import annotations

import argparse
import json
import math
import time

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from rl.moving_target import RUN_STEP, SPRINT_STEP, Grid
from rl.round1_env import EyeHidingTarget, Round1YardEnv, observation_size

LV_RANGE = (8.0, 25.0)            # straight line from the Leaper to V
VS_WALK = (1.5, 5.0)              # her route from V to S
STEPS = (1.5, 3.0)                # the side and back steps that must not reveal her
WIN_WALK = 30.0                   # walking units to a pose that sees her (8 s at full speed): she is close by
WIN_RADIUS = 3.4                  # route body radius for winnability and the scripted seeker (side legs reach 3.48)
SHOT_RANGE = 20.3
SCENE_STEPS = 300                 # 30 s
SEEN_AGO = (10, 30)               # built-in loss: last seen 1-3 s ago
NATURAL_SHARE = 0.5
RANDOM_FACING_SHARE = 0.25        # of the built-in-loss scenes
FACING_JITTER = 0.3               # radians, the others
VARIANTS = (("stay", 0.7), ("shift", 0.15), ("backoff", 0.15))
SHIFT_AFTER = (40, 100)           # steps unfound before a shift
SHIFT_RANGE = (2.0, 6.0)
BACKOFF_WALK = 10.0
BACKOFF_RANGE = (3.0, 8.0)
EXAM_SEEDS = (96000, 97000)       # never drawn in practice
S_TESTS, V_TESTS, WIN_TESTS = 300, 25, 60
BANK_DIR = "rl_artifacts/hide_retrain_20261118/scene_bank"   # practice scenes drawn ahead (--bank)

_WALKERS = {}


def fat_walker(env):
    """A walking grid for a body of radius WIN_RADIUS on this environment's world (the yard's cached once;
    another site's kept in that site)."""
    from rl.walk_field import LeaperWalk
    site = getattr(env, "_site", None)
    if site is not None:
        if site.get("fat_walker") is None:
            site["fat_walker"] = LeaperWalk(env._world, radius=WIN_RADIUS)
        return site["fat_walker"]
    world = env._world
    key = id(world)
    if key not in _WALKERS:
        _WALKERS[key] = (world, LeaperWalk(world, radius=WIN_RADIUS))
    return _WALKERS[key][1]


def closed(env, points):
    """True where a spot lies in (or 0.5 from) one of the game's closed containers; never in other sites."""
    if getattr(env, "_site", None) is not None:
        return np.zeros(len(points), dtype=bool)
    from rl.player_blocked import inside
    return inside(points, margin=0.5)


def _unit(v):
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else np.array([0.0, 1.0])


def _yaw(direction):
    return float(math.atan2(direction[0], direction[1]))


def _free(env, position, yaw):
    return env._collision_for_pose(np.asarray(position, dtype=np.float32), float(yaw)) is None


def _route_length(grid, a, b):
    route = grid.route(a, b)
    return None if not route else Grid.length(a, route), route


ALL_ROUND = 16                    # eye positions tested per spot: the eye sits 1.156 ahead of the body, so
                                  # turning on the spot moves it; hidden must hold whichever way it faces


def hidden_all_round(env, position, spot):
    """True if Lola standing on ``spot`` is hidden from the Leaper's eye at ``position`` whichever way it
    faces (ALL_ROUND facings; the field of view is ignored, so a turn cannot reveal her either)."""
    from rl.moving_target_game_exam import EYE, SIGHT_RANGE
    position = np.asarray(position, dtype=np.float64)
    points = [np.asarray(p, dtype=np.float64) for p in env._points(spot)]
    if np.linalg.norm(np.asarray(spot, dtype=np.float64) - position) - env.TARGET_RADIUS > SIGHT_RANGE + 2.0:
        return True
    for yaw in np.linspace(-math.pi, math.pi, ALL_ROUND, endpoint=False):
        c, s = math.cos(yaw), math.sin(yaw)
        origin = np.array([position[0] + EYE[0] * c + EYE[2] * s, EYE[1], position[1] - EYE[0] * s + EYE[2] * c])
        if any(env.sight.hit(origin, p) is None for p in points):
            return False
    return True


def steps_hide(env, leaper, facing, spot):
    """The step test: returns (all hidden, blocked steps). She must stay hidden, whichever way it then faces,
    after it steps 1.5 or 3 units back, left or right of ``leaper`` (``facing``: toward V)."""
    left = np.array([facing[1], -facing[0]])
    blocked = []
    yaw = _yaw(facing)
    for name, direction in (("back", -facing), ("left", left), ("right", -left)):
        for distance in STEPS:
            pose = leaper + direction * distance
            if not _free(env, pose, yaw):
                blocked.append(f"{name}{distance:g}")
                continue
            if not hidden_all_round(env, pose, spot):
                return False, blocked
    return True, blocked


def sees_from(env, position, yaw, spot):
    """Its eye at ``position`` facing ``yaw`` has a clear line to one of Lola's points on ``spot``."""
    from rl.moving_target_game_exam import EYE
    c, s = math.cos(yaw), math.sin(yaw)
    origin = np.array([position[0] + EYE[0] * c + EYE[2] * s, EYE[1], position[1] - EYE[0] * s + EYE[2] * c])
    return any(env.sight.hit(origin, np.asarray(p, dtype=np.float64)) is None for p in env._points(spot))


WIN_TURNS = (0.0, -0.17, 0.17, -0.35, 0.35)    # a winning pose sees her facing her and 10 / 20 degrees off


def winning_pose(env, leaper, spot, walker=None):
    """The nearest (by walk) pose within WIN_WALK that sees ``spot`` within shot range from every facing in
    WIN_TURNS (not a knife-edge view a small turn loses), its body free there; or None."""
    walker = walker or fat_walker(env)
    field = walker.field(leaper)
    cells = walker.grid.centres[walker.open.reshape(-1)]
    near = cells[np.linalg.norm(cells - spot, axis=1) <= SHOT_RANGE - 2.0]
    if not len(near):
        return None
    index = np.floor((near - walker.origin) / walker.cell).astype(int)
    walk = field[index[:, 0], index[:, 1]]
    keep = np.isfinite(walk) & (walk <= WIN_WALK)
    near, walk = near[keep], walk[keep]
    for k in np.argsort(walk)[:WIN_TESTS]:
        pose = near[k]
        yaw = _yaw(spot - pose)
        if _free(env, pose, yaw) and all(sees_from(env, pose, yaw + t, spot) for t in WIN_TURNS):
            return dict(pose=pose.tolist(), walk=float(walk[k]))
    return None


def draw_scene(env, rng, variant=None, natural=None, real_heights=None):
    """A scene for a freshly reset yard environment (the Leaper at its start spot), or None."""
    leaper = np.asarray(env.position, dtype=np.float64).copy()
    cells = env._grid.open_centres
    gap = np.linalg.norm(cells - leaper, axis=1)
    pool = cells[(gap >= LV_RANGE[0] - 1.0) & (gap <= LV_RANGE[1] + VS_WALK[1])]
    if not len(pool):
        return None
    pool = pool[~closed(env, pool)]
    if variant is None:
        names, shares = zip(*VARIANTS)
        variant = names[int(rng.choice(len(names), p=np.asarray(shares) / sum(shares)))]
    if natural is None:
        natural = bool(rng.random() < NATURAL_SHARE)
    tested = 0
    for i in rng.permutation(len(pool))[:S_TESTS]:
        spot = pool[i]
        tested += 1
        if not env._eye_hidden(leaper, spot) or not hidden_all_round(env, leaper, spot):
            continue
        near = cells[np.linalg.norm(cells - spot, axis=1) <= VS_WALK[1]]
        near = near[np.linalg.norm(near - spot, axis=1) >= 1.0]
        for j in rng.permutation(len(near))[:V_TESTS]:
            corner = near[j]
            lv = float(np.linalg.norm(corner - leaper))
            if not LV_RANGE[0] <= lv <= LV_RANGE[1] or env._eye_hidden(leaper, corner):
                continue
            length, route = _route_length(env._grid, corner, spot)
            if length is None or not VS_WALK[0] <= length <= VS_WALK[1] + 0.5:
                continue
            facing = _unit(corner - leaper)
            hidden, blocked = steps_hide(env, leaper, facing, spot)
            if not hidden:
                continue
            win = winning_pose(env, leaper, spot)
            if win is None:
                continue
            yaw = _yaw(facing)
            random_facing = False
            if not natural:
                if rng.random() < RANDOM_FACING_SHARE:
                    yaw, random_facing = float(rng.uniform(-math.pi, math.pi)), True
                else:
                    yaw = yaw + float(rng.uniform(-FACING_JITTER, FACING_JITTER))
            else:
                yaw = yaw + float(rng.uniform(-FACING_JITTER, FACING_JITTER))
            return dict(leaper=leaper.tolist(), yaw=yaw, corner=corner.tolist(), spot=spot.tolist(),
                        route=[list(map(float, p)) for p in route], route_length=float(length),
                        variant=variant, natural=natural, random_facing=random_facing,
                        seen_ago=int(rng.integers(SEEN_AGO[0], SEEN_AGO[1] + 1)),
                        shift_at=int(rng.integers(SHIFT_AFTER[0], SHIFT_AFTER[1] + 1)),
                        lv=lv, ls=float(np.linalg.norm(spot - leaper)), blocked_steps=blocked,
                        win_walk=win["walk"], win_pose=win["pose"], spots_tested=tested)
    return None


class SceneTarget(EyeHidingTarget):
    """Lola in a hide scene: she moves only along a route she was given (the opening dash, or one move-on)."""

    @classmethod
    def adopt_scene(cls, mover, env, scene):
        mover.__class__ = cls
        mover.eye_hidden = env._eye_hidden
        mover.flee_pending = False
        mover.pick_cases = dict(eye=0, eye_wide=0, flat=0, none=0, blocked=0)
        mover.kind = "hider"
        mover.scene = scene
        mover.found = False
        mover.moved_on = False
        mover.walk_field = None
        mover.env = env
        mover.wait = 0
        return mover

    def advance(self, leaper, spotted):
        self.steps += 1
        leaper = np.asarray(leaper, dtype=np.float64)
        self._leaper = leaper
        if spotted:
            self.found = True
        if self.route:
            before = self.position.copy()
            self._walk(self.speed)
            if (np.linalg.norm(self.position - leaper) < 4.0
                    and np.linalg.norm(self.position - leaper) < np.linalg.norm(before - leaper)):
                self.position, self.route = before, []     # the Leaper is in her way: she stays put
            if not self.route:
                self.state = "hide"
                if self.hidings and self.hidings[-1].get("arrive") is None:
                    self.hidings[-1]["arrive"] = self.steps
            return self.position
        if self.found or self.moved_on or self.scene["variant"] == "stay":
            return self.position
        if self.scene["variant"] == "shift" and self.steps >= self.scene["shift_at"]:
            self._move_on(leaper, SHIFT_RANGE, further=False)
        elif self.scene["variant"] == "backoff":
            walker = fat_walker(self.env)
            if self.walk_field is None:
                self.walk_field = walker.field(self.position)
            if walker.distance(self.walk_field, leaper, self.position) < BACKOFF_WALK:
                self._move_on(leaper, BACKOFF_RANGE, further=True)
        return self.position

    def _move_on(self, leaper, ring, further):
        """One quiet move to an eye-hidden spot ``ring`` units away (further from it for a back-off)."""
        self.moved_on = True
        spots = self._candidates(*ring)
        if not len(spots):
            return
        spots = spots[~closed(self.env, spots)]
        if further:
            spots = spots[np.linalg.norm(spots - leaper, axis=1) > np.linalg.norm(self.position - leaper) + 2.0]
        for index in self.rng.permutation(len(spots))[:60]:
            spot = spots[index]
            if not self.eye_hidden(leaper, spot):
                continue
            route = self.grid.route(self.position, spot, avoid=leaper)
            if not route:
                continue
            samples = np.asarray([p for p in route])
            if not all(self.eye_hidden(leaper, p) for p in samples):
                continue
            self.state = "slip"
            self.hidings.append(dict(start=self.steps, arrive=None, spot=spot.tolist(), watched=False, move_on=True))
            self._go(spot, RUN_STEP, route)
            return


def apply_scene(env, scene):
    """Put a freshly reset Round1YardEnv into ``scene``; returns the first observation."""
    corner = np.asarray(scene["corner"], dtype=np.float64)
    spot = np.asarray(scene["spot"], dtype=np.float64)
    # A banked or exam scene is rebuilt from its round seed: the Leaper must stand where it was drawn.
    if not np.allclose(env.position, scene["leaper"], atol=1e-4):
        raise RuntimeError(f"scene start {scene['leaper']} but the rebuilt round put the Leaper at {env.position}")
    env.yaw = float(scene["yaw"])
    mover = SceneTarget.adopt_scene(env.mover, env, scene)
    mover.rng = np.random.default_rng(int(abs(hash((scene["spot"][0], scene["spot"][1], scene["yaw"]))) % 2**32))
    if scene["natural"]:
        # She is in sight at V and sprints to S along her route; the environment sees the loss itself.
        mover.position = corner.copy()
        env.target = np.asarray(corner, dtype=env.target.dtype).copy()
        mover.state, mover.hide_spot = "dash", spot.copy()
        mover.hidings.append(dict(start=0, arrive=None, spot=spot.tolist(), watched=True, scene=True))
        mover._go(spot, SPRINT_STEP, [np.asarray(p, dtype=np.float64) for p in scene["route"]])
        env.target_ever_seen = False
        env.last_seen_target[:] = 0.0
        env.steps_since_target_seen = env.TARGET_MEMORY_STEPS
        env._update_target_memory(increment_time=False)
        env.motion_note = np.zeros(3, dtype=np.float32)
        env.previous_seen_target = env.target.copy() if env.target_visible else None
        env.unseen_steps = 0
    else:
        mover.position = spot.copy()
        env.target = np.asarray(spot, dtype=env.target.dtype).copy()
        mover.state, mover.hide_spot, mover.route = "hide", spot.copy(), []
        mover.hidings.append(dict(start=0, arrive=0, spot=spot.tolist(), watched=True, scene=True))
        env._update_target_memory(increment_time=False)
        heading = _unit(spot - corner)
        env.target_ever_seen = True
        env.last_seen_target = np.asarray(corner, dtype=env.last_seen_target.dtype).copy()
        env.steps_since_target_seen = scene["seen_ago"]
        env.unseen_steps = scene["seen_ago"]
        env.previous_seen_target = None
        env.motion_note = np.array([heading[0], heading[1], 1.0], dtype=np.float32)
    env.scene = scene
    env.drill = None
    obs = env._r1_reset(env._extend(env.initial_observation()))
    return obs


def scene_env(seed, switches, site=None):
    """A fresh yard (or ``site``) environment for a scene: hider, no ducking into cover (Lola obeys only
    the scene)."""
    switches = dict(switches)
    for key in ("hider_share", "close_start_share", "drill_share", "hide_share"):
        switches.pop(key, None)
    switches["lose_cover"] = 0.0
    switches["stay_found"] = False
    env = Round1YardEnv(seed, metrics=False, kind="hider", site=site, **switches)
    env.reset(seed=seed)
    return env


class HidePractice(gym.Env):
    """Practice world that plays only hide scenes in the real yard (a new scene every reset)."""

    metadata = {}

    def __init__(self, seed, bank=f"{BANK_DIR}/yard_*.json", **switches):
        self.bank = bank            # None: draw every scene live (slow: ~0.17 s a scene)
        self.switches = switches
        self.rng = np.random.default_rng((int(seed), 61118))
        self.inner = None
        size = observation_size(switches.get("new_inputs"), switches.get("not_there"), switches.get("privileged"))
        self.observation_space = spaces.Box(-1, 1, (size,), dtype=np.float32)
        self.action_space = spaces.Box(-1, 1, (2,), dtype=np.float32)
        self.scene_steps = 0
        self.scenes = 0
        self.misses = 0
        self.setup_seconds = 0.0

    def _seed(self):
        while True:
            seed = int(self.rng.integers(1_000_000, 2**31 - 1))
            if not (70000 <= seed < 70100 or EXAM_SEEDS[0] <= seed < EXAM_SEEDS[1]):
                return seed

    def reset(self, *, seed=None, options=None):
        started = time.perf_counter()
        if self.inner is not None:
            self.inner.close()
        if self.bank:
            rows = load_bank(self.bank)
            row = rows[int(self.rng.integers(len(rows)))]
            env = scene_env(row["round_seed"], self.switches)
            self.inner = env
            obs = apply_scene(env, row["scene"])
            self.scene_steps = 0
            self.scenes += 1
            self.setup_seconds += time.perf_counter() - started
            return obs, dict(target_visible=bool(env.target_visible))
        for _ in range(40):
            round_seed = self._seed()
            env = scene_env(round_seed, self.switches)
            scene = draw_scene(env, self.rng)
            if scene is not None:
                self.inner = env
                obs = apply_scene(env, scene)
                self.scene_steps = 0
                self.scenes += 1
                self.setup_seconds += time.perf_counter() - started
                return obs, dict(target_visible=bool(env.target_visible), scene=scene)
            env.close()
            self.misses += 1
        raise RuntimeError("no hide scene in 40 yard starts")

    def step(self, action):
        obs, reward, terminated, truncated, info = self.inner.step(action)
        self.scene_steps += 1
        if info.get("shot_win") and not terminated:
            terminated, truncated = True, False          # found her: the scene is won
            info["is_success"] = True
        elif not terminated and self.scene_steps >= SCENE_STEPS:
            truncated = True                             # time-out (bootstrapped, not a failure)
        if terminated or truncated:
            info["round_look"] = getattr(self.inner, "round_look", None)
            info["round_losses"] = getattr(self.inner, "round_losses", None)
        return obs, reward, terminated, truncated, info


# --- Scene banks (draw ahead, practise from the bank) ---------------------------------------------
_BANKS = {}


def build_bank(count, seed, switches=None):
    """``count`` scenes from round seeds drawn by ``seed`` (never the exam's), each with its round seed."""
    switches = dict(switches or dict(real_heights=True))
    rng = np.random.default_rng((seed, 61119))
    rows = []
    while len(rows) < count:
        while True:
            round_seed = int(rng.integers(1_000_000, 2**31 - 1))
            if not (70000 <= round_seed < 70100 or EXAM_SEEDS[0] <= round_seed < EXAM_SEEDS[1]):
                break
        env = scene_env(round_seed, switches)
        scene = draw_scene(env, rng)
        env.close()
        if scene is not None:
            rows.append(dict(round_seed=round_seed, scene=scene))
    return rows


def load_bank(path):
    """All scenes of the bank files matching ``path`` (a glob), cached per process."""
    import glob
    from pathlib import Path
    if path not in _BANKS:
        root = Path(__file__).resolve().parents[1]
        rows = []
        for name in sorted(glob.glob(str(root / path))):
            rows += json.loads(Path(name).read_text())
        if not rows:
            raise FileNotFoundError(f"no scene bank at {path}")
        _BANKS[path] = rows
    return _BANKS[path]


# --- The scripted perfect seeker (census and exam ceiling) ------------------------------------------
class Seeker:
    """The census's perfect seeker: walks the shortest route (body radius 3.4) to the scene's winning pose,
    turns to face S and holds. Wedged (no movement for 4 steps while pushing), it backs off 5 steps and
    goes on. It knows the winning pose, so it is an upper bound for a brain that does not."""

    def __init__(self, env, scene):
        from rl.behaviour_probe import downhill
        self.env, self.scene = env, scene
        self.walker = fat_walker(env)
        self.goal = np.asarray(scene["win_pose"], dtype=np.float64)
        self.spot = np.asarray(scene["spot"], dtype=np.float64)
        self.field = self.walker.field(self.goal)
        self.downhill = downhill
        self.last = None
        self.wedged = 0
        self.backing = 0

    def act(self):
        position = np.asarray(self.env.position, dtype=np.float64)
        if self.backing > 0:
            self.backing -= 1
            return np.array([-1.0, 0.0], dtype=np.float32)
        if np.linalg.norm(position - self.goal) <= 0.4:
            heading, throttle_max = _unit(self.spot - position), 0.0
        else:
            route = self.downhill(self.walker, self.field, position)
            heading = route if route is not None else _unit(self.goal - position)
            throttle_max = 1.0
        turn = (_yaw(heading) - self.env.yaw + math.pi) % (2 * math.pi) - math.pi
        steer = float(np.clip(turn / self.env.TURN_SPEED, -1.0, 1.0))
        throttle = throttle_max if abs(turn) < math.radians(25) else 0.0
        if throttle_max > 0 and np.linalg.norm(position - self.goal) < 1.5:
            throttle = min(throttle, float(np.linalg.norm(position - self.goal)) / self.env.MOVE_SPEED)
        moved = self.last is not None and np.linalg.norm(position - self.last) > 1e-3
        self.wedged = 0 if (moved or throttle <= 0.05) else self.wedged + 1
        self.last = position.copy()
        if self.wedged >= 4:
            self.wedged, self.backing = 0, 5
        return np.array([throttle, steer], dtype=np.float32)


def play_scene(env, scene, policy=None, steps=200):
    """Play one applied scene; ``policy`` None = the scripted seeker. Returns per-step facts."""
    seeker = Seeker(env, scene) if policy is None else None
    her = []
    seen_at = None
    shot_at = None
    streak = 0
    pos0 = np.asarray(env.position, dtype=np.float64).copy()
    for step in range(steps):
        action = seeker.act() if seeker else policy(step)
        _, _, term, trunc, info = env.step(action)
        if getattr(env.mover, "state", "") == "hide":
            her.append(np.asarray(env.target, dtype=np.float64).copy())
        if env.target_visible and seen_at is None and (not scene["natural"] or env.mover.state == "hide"):
            seen_at = (step + 1) / 10
        streak = streak + 1 if env.target_visible and env._distance() <= SHOT_RANGE else 0
        if streak >= 10 and shot_at is None:
            shot_at = (step + 1) / 10
        if term or trunc or shot_at is not None:
            break
    her = np.asarray(her) if her else np.zeros((1, 2))
    return dict(seen_at=seen_at, shot_at=shot_at, her_moved=float(np.max(np.linalg.norm(her - her[0], axis=1))),
                end_pos=np.asarray(env.position, dtype=np.float64).tolist(), start_pos=pos0.tolist())


def _make(round_seed, switches, arena):
    if arena:
        from rl.hide_arena import arena_scene_env
        return arena_scene_env(round_seed, switches)
    return scene_env(round_seed, switches)


def census(rounds, seed=95500, switches=None, out=None, arena=False):
    switches = dict(switches or dict(new_inputs=True, not_there=True, real_heights=True, eye_hide=True))
    rng = np.random.default_rng(seed)
    rows, misses, times = [], 0, []
    while len(rows) < rounds:
        round_seed = int(rng.integers(1_000_000, 2**31 - 1))
        started = time.perf_counter()
        env = _make(round_seed, switches, arena)
        scene = draw_scene(env, rng)
        times.append(time.perf_counter() - started)
        if scene is None:
            misses += 1
            env.close()
            continue
        obs = apply_scene(env, scene)
        seen_at_start = bool(env.target_visible)
        start_hidden = not env.target_visible if not scene["natural"] else None
        result = play_scene(env, scene)
        # Natural scenes: hidden once she has reached S (seen at V by construction).
        if scene["natural"]:
            fresh = _make(round_seed, switches, arena)
            fresh.target = np.asarray(scene["spot"], dtype=fresh.target.dtype)
            fresh.yaw = scene["yaw"]
            fresh._update_target_memory(increment_time=False)
            start_hidden = not fresh.target_visible
            fresh.close()
        rows.append(dict(scene=scene, start_hidden=bool(start_hidden), seen_at_start=seen_at_start, **result))
        env.close()
    def rate(test, xs=None):
        xs = rows if xs is None else xs
        return float(np.mean([test(r) for r in xs])) if xs else None
    stay = [r for r in rows if r["scene"]["variant"] == "stay"]
    summary = dict(
        scenes=len(rows), draws_failed=misses, setup_seconds_median=float(np.median(times)),
        setup_seconds_p95=float(np.percentile(times, 95)),
        hidden_at_start=rate(lambda r: r["start_hidden"]),
        hidden_after_steps=1.0,     # by construction; blocked steps reported below
        blocked_step_share=rate(lambda r: len(r["scene"]["blocked_steps"]) > 0),
        oracle_found20=rate(lambda r: r["seen_at"] is not None and r["seen_at"] <= 20),
        oracle_found10=rate(lambda r: r["seen_at"] is not None and r["seen_at"] <= 10),
        oracle_found5=rate(lambda r: r["seen_at"] is not None and r["seen_at"] <= 5),
        oracle_shot20=rate(lambda r: r["shot_at"] is not None),
        stay_scenes=len(stay), stay_her_moved_max=float(max((r["her_moved"] for r in stay), default=0.0)),
        natural_share=rate(lambda r: r["scene"]["natural"]),
        natural_seen_at_start=rate(lambda r: r["seen_at_start"], [r for r in rows if r["scene"]["natural"]]),
        variants={v: rate(lambda r, v=v: r["scene"]["variant"] == v) for v, _ in VARIANTS},
        lv_median=float(np.median([r["scene"]["lv"] for r in rows])),
        ls_median=float(np.median([r["scene"]["ls"] for r in rows])),
        vs_route_median=float(np.median([r["scene"]["route_length"] for r in rows])),
        win_walk_median=float(np.median([r["scene"]["win_walk"] for r in rows])),
        distinct_spots_2u=len({(round(r["scene"]["spot"][0] / 2), round(r["scene"]["spot"][1] / 2)) for r in rows}))
    if out:
        with open(out, "w") as stream:
            json.dump(dict(summary=summary, rows=rows), stream, default=float)
    return summary, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--census", type=int, default=200)
    parser.add_argument("--seed", type=int, default=95500)
    parser.add_argument("--out")
    parser.add_argument("--bank", type=int, default=0, help="write this many scenes (no play) to --out")
    parser.add_argument("--arena", action="store_true", help="census in new hide arenas (rl/hide_arena.py)")
    args = parser.parse_args()
    if args.bank:
        rows = build_bank(args.bank, args.seed)
        with open(args.out, "w") as stream:
            json.dump(rows, stream)
        print(f"RESULT {len(rows)} scenes -> {args.out}", flush=True)
        return
    summary, _ = census(args.census, args.seed, out=args.out, arena=args.arena)
    print("RESULT", json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
