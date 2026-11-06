"""A target that moves and hides, for the moving-target retrain (plan of 2026-11-05).

The target stands in for Lola. Two kinds, picked per round:

* Wanderer (2 in 3 rounds): runs to a random open spot, often one the Leaper
  cannot see into, sometimes pauses 1-3 s, then picks the next spot.
* Hider (1 in 3 rounds): wanders until the Leaper spots her, then sprints to the
  nearest spot 4-12 units away that the Leaper cannot see into from where it
  stands, choosing a route it can watch her take. She stays there 30-60 s
  (owner, 2026-11-05: players camp one spot), then slips away to another spot
  hidden from the Leaper and stays again. Spotted while wandering or slipping
  away, she dashes for cover again.

Speeds are Lola's real ones, measured in the game on 2026-11-05 (headless
Chromium at 60 fps, open ground, `tmp/measure-lola-speed.mjs`): run 4.4 map
units a second, sprint 6.4. One brain unit is 5.5 / 7.98 map units at the
default Leaper width, so run 0.64 and sprint 0.93 brain units per 0.1 s step
(the Leaper walks 0.375). She outruns it; her pauses and hiding stops are what
make a catch possible.

Works in any world that answers two questions (see ``ArenaWorld`` and
``JunkyardWorld``): is a disc here blocked, and is a point hidden from a viewer
by something solid. Routes are A* paths on a 1-unit grid, shortened where a
straight line is clear. Everything random comes from the generator passed in,
so a maze number gives the same route and the same hiding rules every time.
"""
from __future__ import annotations

import heapq
import math

import numpy as np

MAP_TO_BRAIN = 7.98 / 5.5
STEP_SECONDS = 0.1
RUN_STEP = 4.4 * MAP_TO_BRAIN * STEP_SECONDS      # 0.638 brain units a step
SPRINT_STEP = 6.4 * MAP_TO_BRAIN * STEP_SECONDS   # 0.929 brain units a step

TARGET_BODY_RADIUS = 0.8      # her clearance from obstacles while moving
GRID_CELL = 1.0
HIDER_SHARE = 1 / 3
PAUSE_CHANCE = 0.5
PAUSE_STEPS = (10, 30)        # 1-3 s
WANDER_RANGE = (6.0, 25.0)    # how far the next wander spot is
HIDDEN_GOAL_CHANCE = 0.6      # wander spots picked behind cover this often
HIDE_RANGE = (4.0, 12.0)
HIDE_STAY_STEPS = (300, 600)  # 30-60 s (owner, 2026-11-05)
KEEP_CLEAR = 4.0              # she routes around the Leaper, never into it


# --- Worlds ------------------------------------------------------------------
class ArenaWorld:
    """The practice arena: a square of round obstacles (rl_environment.py)."""

    def __init__(self, obstacles, limit):
        self.obstacles = np.asarray(obstacles, dtype=np.float64).reshape(-1, 3)
        self.minimum = np.array([-limit, -limit], dtype=np.float64)
        self.maximum = np.array([limit, limit], dtype=np.float64)

    def blocked_many(self, points, radius):
        points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
        out = np.any((points < self.minimum + radius) | (points > self.maximum - radius), axis=1)
        for ox, oz, r in self.obstacles:
            out |= np.hypot(points[:, 0] - ox, points[:, 1] - oz) < r + radius
        return out

    def hidden_from(self, viewer, points, slack):
        """True where an obstacle blocks the flat line from viewer to the point.

        Same rule as LeaperReachEnv._target_sensor (a hit before distance - slack),
        without the field of view: the Leaper could simply turn to look.
        """
        points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
        origin = np.asarray(viewer, dtype=np.float64)
        delta = points - origin
        distance = np.linalg.norm(delta, axis=1)
        direction = delta / np.maximum(distance, 1e-9)[:, None]
        hidden = np.zeros(len(points), dtype=bool)
        for ox, oz, radius in self.obstacles:
            offset = origin - np.array([ox, oz])
            b = 2.0 * direction @ offset
            c = float(offset @ offset - radius * radius)
            disc = b * b - 4.0 * c
            root = np.sqrt(np.maximum(disc, 0.0))
            entry, exit_ = (-b - root) / 2.0, (-b + root) / 2.0
            hit = np.where(entry >= 0.0, entry, exit_)
            hidden |= (disc >= 0.0) & (hit >= 0.0) & (hit < distance - slack)
        return hidden


class JunkyardWorld:
    """The real yard, from rl.junkyard_geometry (flat raster of everything solid)."""

    def __init__(self, geometry):
        self.geometry = geometry
        self.minimum = np.asarray(geometry.minimum, dtype=np.float64)
        self.maximum = np.asarray(geometry.maximum, dtype=np.float64)

    def blocked_many(self, points, radius):
        points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
        return np.array([self.geometry.disk_blocked(p, radius) for p in points], dtype=bool)

    def hidden_from(self, viewer, points, slack):
        visible = self.geometry.points_visible(np.asarray(viewer, dtype=np.float64), 0.0,
                                               np.asarray(points, dtype=np.float64).reshape(-1, 2),
                                               2 * math.pi, 1e6, slack)
        return ~np.asarray(visible, dtype=bool)


# --- Routes -------------------------------------------------------------------
class Grid:
    """Open cells on a GRID_CELL grid, and A* routes between them."""

    def __init__(self, world, radius=TARGET_BODY_RADIUS, cell=GRID_CELL):
        self.world, self.radius, self.cell = world, radius, cell
        self.origin = world.minimum
        self.shape = np.maximum(1, np.floor((world.maximum - world.minimum) / cell).astype(int))
        ix, iz = np.meshgrid(np.arange(self.shape[0]), np.arange(self.shape[1]), indexing="ij")
        self.centres = np.stack((ix, iz), axis=-1).reshape(-1, 2) * cell + self.origin + cell / 2
        self.open = ~world.blocked_many(self.centres, radius).reshape(tuple(self.shape))
        self.open_centres = self.centres[self.open.reshape(-1)]

    def index(self, point):
        i = np.floor((np.asarray(point) - self.origin) / self.cell).astype(int)
        return tuple(np.clip(i, 0, self.shape - 1))

    def centre(self, index):
        return self.origin + (np.asarray(index) + 0.5) * self.cell

    def nearest_open(self, point):
        start = self.index(point)
        if self.open[start]:
            return start
        d = np.linalg.norm(self.open_centres - np.asarray(point), axis=1)
        return self.index(self.open_centres[int(np.argmin(d))])

    def clear_line(self, a, b, avoid=None):
        length = float(np.linalg.norm(b - a))
        count = max(2, int(math.ceil(length / (self.cell * 0.5))) + 1)
        samples = a[None, :] + (b - a)[None, :] * np.linspace(0.0, 1.0, count)[:, None]
        if avoid is not None and np.any(np.linalg.norm(samples[1:] - np.asarray(avoid), axis=1) < KEEP_CLEAR):
            return False
        return not np.any(self.world.blocked_many(samples, self.radius))

    def route(self, start, goal, avoid=None):
        """Waypoints from start to goal (both world points), or None if no route.

        ``avoid``: the Leaper's position; cells within KEEP_CLEAR of it are closed.
        """
        s, g = self.nearest_open(start), self.nearest_open(goal)
        if s == g:
            return [np.asarray(goal, dtype=np.float64)]
        sx, sz = self.shape
        open_ = self.open
        if avoid is not None:
            near = (np.linalg.norm(self.centres - np.asarray(avoid), axis=1) < KEEP_CLEAR).reshape(open_.shape)
            open_ = open_ & ~near
            open_[s] = self.open[s]
            if not open_[g]:
                return None
        best = {s: 0.0}
        came = {}
        queue = [(0.0, s)]
        steps = ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
                 (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142))
        while queue:
            _, node = heapq.heappop(queue)
            if node == g:
                break
            x, z = node
            base = best[node]
            for dx, dz, cost in steps:
                nx, nz = x + dx, z + dz
                if not (0 <= nx < sx and 0 <= nz < sz) or not open_[nx, nz]:
                    continue
                if dx and dz and not (open_[x + dx, z] and open_[x, z + dz]):
                    continue
                score = base + cost
                if score < best.get((nx, nz), math.inf):
                    best[(nx, nz)] = score
                    came[(nx, nz)] = node
                    heapq.heappush(queue, (score + math.hypot(g[0] - nx, g[1] - nz), (nx, nz)))
        if g not in best:
            return None
        cells = [g]
        while cells[-1] != s:
            cells.append(came[cells[-1]])
        points = [np.asarray(start, dtype=np.float64)] + [self.centre(c) for c in reversed(cells[:-1])]
        points[-1] = np.asarray(goal, dtype=np.float64) if not self.world.blocked_many([goal], self.radius)[0] else points[-1]
        # Shorten: from each kept point, jump to the farthest one in a clear line.
        short, i = [], 0
        while i < len(points) - 1:
            j = len(points) - 1
            while j > i + 1 and not self.clear_line(points[i], points[j], avoid):
                j -= 1
            short.append(points[j])
            i = j
        return short

    @staticmethod
    def length(start, waypoints):
        total, here = 0.0, np.asarray(start, dtype=np.float64)
        for p in waypoints:
            total += float(np.linalg.norm(p - here))
            here = p
        return total


# --- The target ---------------------------------------------------------------
class MovingTarget:
    """Moves ``position`` one 0.1 s step at a time; see the module docstring."""

    def __init__(self, world, position, rng, kind=None, slack=1.4, grid=None):
        self.world = world
        self.rng = rng
        self.grid = grid or Grid(world)
        self.slack = slack
        self.kind = kind or ("hider" if rng.random() < HIDER_SHARE else "wanderer")
        self.position = np.asarray(position, dtype=np.float64).copy()
        self.state = "wander"
        self.route = []
        self.speed = RUN_STEP
        self.wait = 0
        self.hide_spot = None
        self.hidings = []   # one dict per hiding run: start step, arrival step, spot, watched
        self.steps = 0
        self._leaper = None

    # Spots ------------------------------------------------------------------
    def _candidates(self, low, high):
        d = np.linalg.norm(self.grid.open_centres - self.position, axis=1)
        return self.grid.open_centres[(d >= low) & (d <= high)]

    def _pick_wander_goal(self, leaper):
        spots = self._candidates(*WANDER_RANGE)
        if not len(spots):
            spots = self.grid.open_centres
        far = spots[np.linalg.norm(spots - leaper, axis=1) > KEEP_CLEAR + 2.0]
        if len(far):
            spots = far
        if self.rng.random() < HIDDEN_GOAL_CHANCE:
            hidden = spots[self.world.hidden_from(leaper, spots, self.slack)]
            if len(hidden):
                spots = hidden
        return spots[self.rng.integers(len(spots))]

    def _pick_hide(self, leaper, watched):
        """Nearest hidden spot 4-12 away; when watched, prefer a route it can see."""
        spots = self._candidates(*HIDE_RANGE)
        if not len(spots):
            return None, None
        spots = spots[self.world.hidden_from(leaper, spots, self.slack)]
        if not len(spots):
            return None, None
        order = np.argsort(np.linalg.norm(spots - self.position, axis=1))
        best = None
        for index in order[:12]:
            route = self.grid.route(self.position, spots[index], avoid=self._leaper)
            if not route:
                continue
            length = Grid.length(self.position, route)
            if watched:
                # Share of the way (bar the last 2 units) the Leaper cannot see.
                samples = _samples(self.position, route, 0.5)
                lead = samples[:-4] if len(samples) > 4 else samples[:1]
                unseen = float(np.mean(self.world.hidden_from(leaper, lead, self.slack)))
                score = length * (1.0 + 2.0 * unseen)
            else:
                score = length
            if best is None or score < best[0]:
                best = (score, spots[index], route)
        if best is None:
            return None, None
        return best[1], best[2]

    def _go(self, goal, speed, route=None):
        self.route = route if route is not None else (
            self.grid.route(self.position, goal, avoid=self._leaper) or [])
        self.speed = speed

    # One step ----------------------------------------------------------------
    def advance(self, leaper, spotted):
        """Move one step. ``leaper``: its position; ``spotted``: it sees her now."""
        self.steps += 1
        leaper = np.asarray(leaper, dtype=np.float64)
        self._leaper = leaper
        if self.kind == "hider":
            self._hider_rules(leaper, spotted)
        elif not self.route and self.wait <= 0:
            if self.rng.random() < PAUSE_CHANCE and self.steps > 1:
                self.wait = int(self.rng.integers(PAUSE_STEPS[0], PAUSE_STEPS[1] + 1))
            self._go(self._pick_wander_goal(leaper), RUN_STEP)
        if self.wait > 0:
            self.wait -= 1
            return self.position
        before = self.position.copy()
        self._walk(self.speed)
        if (np.linalg.norm(self.position - leaper) < KEEP_CLEAR
                and np.linalg.norm(self.position - leaper) < np.linalg.norm(before - leaper)):
            # The Leaper came into her way: back off the step and head elsewhere.
            self.position = before
            goal = self.route[-1] if self.route else None
            self.route = []
            if self.state != "hide":
                self._go(goal if goal is not None and self.state == "dash" else self._pick_wander_goal(leaper),
                         self.speed)
        return self.position

    def _hider_rules(self, leaper, spotted):
        if self.state in ("wander", "slip") and spotted:
            spot, route = self._pick_hide(leaper, watched=True)
            if spot is not None:
                self.state, self.hide_spot, self.wait = "dash", spot, 0
                self._go(spot, SPRINT_STEP, route)
                self.hidings.append(dict(start=self.steps, arrive=None, spot=spot.tolist(), watched=True))
                return
        if self.state == "dash" and not self.route:
            self.state = "hide"
            self.wait = int(self.rng.integers(HIDE_STAY_STEPS[0], HIDE_STAY_STEPS[1] + 1))
            self.hidings[-1]["arrive"] = self.steps
            return
        if self.state == "hide" and self.wait <= 0:
            spot, route = self._pick_hide(leaper, watched=False)
            self.state = "slip"
            if spot is None:
                self._go(self._pick_wander_goal(leaper), RUN_STEP)
            else:
                self._go(spot, RUN_STEP, route)
            return
        if self.state == "slip" and not self.route:
            self.state = "hide"
            self.wait = int(self.rng.integers(HIDE_STAY_STEPS[0], HIDE_STAY_STEPS[1] + 1))
            return
        if self.state == "wander" and not self.route and self.wait <= 0:
            if self.rng.random() < PAUSE_CHANCE and self.steps > 1:
                self.wait = int(self.rng.integers(PAUSE_STEPS[0], PAUSE_STEPS[1] + 1))
            self._go(self._pick_wander_goal(leaper), RUN_STEP)

    def _walk(self, distance):
        while distance > 1e-9 and self.route:
            goal = self.route[0]
            delta = goal - self.position
            gap = float(np.linalg.norm(delta))
            if gap <= distance:
                self.position = np.asarray(goal, dtype=np.float64).copy()
                self.route.pop(0)
                distance -= gap
            else:
                self.position = self.position + delta / gap * distance
                distance = 0.0


def _samples(start, route, spacing):
    points, here = [], np.asarray(start, dtype=np.float64)
    for p in route:
        n = max(1, int(math.ceil(np.linalg.norm(p - here) / spacing)))
        points.extend(here + (p - here) * t for t in np.linspace(1.0 / n, 1.0, n))
        here = p
    return np.asarray(points) if points else here[None, :]
