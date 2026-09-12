"""Gymnasium target-reaching environment used by the Leaper PPO trainer."""

from __future__ import annotations

import math
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


class LeaperReachEnv(gym.Env):
    """Continuous planar navigation inside a bounded 3D field."""

    metadata = {"render_modes": ["human", "rgb_array"], "render_fps": 30}

    # PPO_27 seeker arena: one third of PPO_25's 187.5-wide field. Obstacle count
    # falls with area (51 -> 6) so the smaller arena keeps comparable density
    # instead of becoming an impassable pile. The target is randomized per reset.
    WORLD_LIMIT = 31.25
    TARGET = np.array([0.0, 0.0], dtype=np.float32)  # reset-time fallback only
    TARGET_RADIUS = 1.4
    AGENT_RADIUS = 0.75
    LEG_COLLISION_RADIUS = 0.24
    LEG_SEGMENT_RADII = (1.2, 2.2, 3.24)
    LEG_ANGLES = (-0.62, 0.62, -1.57, 1.57, -2.42, 2.42)
    # PPO_18 human forward vision. Eight thin rangefinder rays fan evenly across a
    # 270-degree forward field, so the robot is blind only to a 90-degree wedge
    # directly behind it. Each ray reports the clear distance from the body centre
    # to the nearest obstacle surface or arena wall along that heading, normalized
    # by RAY_MAX_RANGE (1 = clear to the range limit). The range is longer than the
    # PPO_11-16 value of 12.0 so dead-ends are visible while forming on the larger
    # field. This is paired with forward-only movement (see action_space) so the
    # robot always travels inside its visible cone, like a human that turns to face
    # where it walks.
    RAY_COUNT = 16
    RAY_MAX_RANGE = 28.0
    VISION_FOV = math.radians(270.0)
    # PPO_28 slow-seeker bundle: halve linear and angular speed together so the
    # turning radius stays unchanged, then double the episode cap to preserve the
    # same approximate physical search horizon as PPO_27.
    MOVE_SPEED = 0.375
    TURN_SPEED = math.radians(9.0)
    MAX_STEPS = 1000
    # PPO_29 normalized throttle. When True, the policy's forward-throttle output
    # lives in [-1, 1] and is mapped to a forward-only PHYSICAL throttle by
    # physical = (action + 1) / 2, so -1 = fully stopped, 0 = half speed, +1 =
    # full speed. Negative never means reverse. This fixes the PPO_28 freeze: an
    # unconstrained Gaussian output whose natural neutral is 0 now drifts forward
    # at half speed instead of clipping to a dead stop, so intentional stopping
    # must be a deliberate reach to the -1 boundary. When False (all runs up to
    # PPO_28) the throttle stays the plain forward-only [0, 1].
    NORMALIZED_THROTTLE = False
    DISTANCE_REWARD_SCALE = 0.2
    BEST_PROGRESS_SCALE = 0.1
    STEP_PENALTY = 0.002
    COLLISION_PENALTY = 0.18
    GOAL_REWARD = 25.0
    SIGHT_REWARD = 0.5
    EXPLORATION_REWARD = 0.01
    NEW_VIEW_REWARD = 0.002
    EXPLORATION_CELL_SIZE = 3.0
    EXPLORATION_HEADING_BINS = 12
    TARGET_MEMORY_STEPS = 120
    VISIBLE_AWAY_DISTANCE_CAP = 0.25
    # PPO_16 stuck rule: if the robot is in contact and makes no forward progress
    # for STUCK_LIMIT steps in a row, the episode ends as a terminal failure with a
    # one-time STUCK_PENALTY. This targets the deterministic freeze directly, and
    # the explicit penalty stops "quit early to dodge accumulated costs" from ever
    # looking attractive (ending an episode is not a punishment on its own).
    STUCK_LIMIT = 40
    STUCK_PENALTY = 10.0
    # PPO_29 general freeze rule. Independent of collisions: if the robot makes no
    # physical translation for FREEZE_LIMIT consecutive steps, the episode ends as
    # a terminal failure with a one-time FREEZE_PENALTY. Actual movement resets the
    # counter. The 40-step collision STUCK_LIMIT catches wedged-in-contact freezing;
    # this catches the open-field "stand still / spin forever and never go anywhere"
    # freeze that the PPO_28 diagnosis found dominated (89.8% of stops happened
    # before the target was ever seen). FREEZE_LIMIT = 60 still permits three full
    # 180-degree scanning turns at the 9-degree turn rate, so looking around is fine
    # but going nowhere is not.
    FREEZE_LIMIT = 60
    FREEZE_PENALTY = 10.0
    # PPO_29 scan-to-search nudge (owner request): before the target has ever been
    # seen, reward facing each genuinely new heading a little so a lost Leaper is
    # encouraged to turn and look around instead of freezing. Capped at one full
    # revolution per episode (the set of heading bins can hold at most
    # EXPLORATION_HEADING_BINS distinct directions), it stops entirely once the
    # target is discovered, and the FREEZE_LIMIT bound keeps it from becoming a
    # spin-in-place exploit. "Just one spin" of encouragement, nothing more.
    SCAN_REWARD = 0.01
    # PPO_24 anti-dither nudge: standing still is nearly free (only STEP_PENALTY),
    # so a timid policy learns to loiter near obstacles and time out. A small
    # per-step penalty taxes sustained idling once throttle stays below
    # IDLE_THROTTLE for more than IDLE_GRACE consecutive steps -- long enough to
    # allow a brief pivot-in-place ("thinking"), short enough that real loitering
    # cannot be gamed by twitching. Sized between STEP_PENALTY (idling stays worse
    # than a normal step) and COLLISION_PENALTY (so she never rams walls just to
    # avoid standing). All three are overridable from the CLI for tuning.
    IDLE_PENALTY = 0.04
    IDLE_GRACE = 15
    IDLE_THROTTLE = 0.1

    # PPO_32 cleared/search-coverage map (state-augmentation experiment). When
    # COVERAGE_MAP is True the observation is widened from 26 to 42 by appending 16
    # egocentric "distance to unchecked ground" readings (indices 26-41) aligned
    # with the 16 vision-ray angles. The legacy channels 0-25 are untouched. The
    # internal grid is episode-local, reset each reset(), and updated for the reset
    # pose and after every step pose. A cell is marked cleared only if a
    # hypothetical target at the cell centre would be DETECTABLE from Leaper's
    # current pose under the exact target-visibility rules (270 deg FOV,
    # RAY_MAX_RANGE, unobstructed) -- it never reads the real target position, so it
    # records only "this location has been checked", never "the target is there".
    # The grid is maintained regardless of COVERAGE_MAP so detection diagnostics
    # (arena fraction cleared before first sight) work for the PPO_29 baseline too;
    # only the 16-value summary is gated behind COVERAGE_MAP.
    COVERAGE_MAP = False
    COVERAGE_CELL_SIZE = EXPLORATION_CELL_SIZE  # 3.0, the existing exploration cell
    COVERAGE_SAMPLE_STEP = 1.5  # ray-march increment for the summary (cell / 2)

    # PPO_33 / Phase 1B global frontier note. PPO_32's 16 LOCAL 28-unit "distance to
    # unchecked ground" rays did not pull Leaper toward large DISTANT unchecked
    # regions (they saturated). This replaces them with a compact 5-value GLOBAL
    # note appended at observation indices 26-30: the relative x/z direction to the
    # nearest frontier cell of the LARGEST substantial contiguous unchecked region,
    # that cell's distance (÷ arena diagonal), the region's size, and a valid flag.
    # It is computed only from the same internal cleared grid used by PPO_32 -- it
    # NEVER reads the real target position or obstacle positions, so it is honest
    # search memory, not a cheat. Tiny isolated rock-shadow fragments (below
    # FRONTIER_MIN_REGION_CELLS) are ignored. Legacy indices 0-25 stay untouched.
    FRONTIER_NOTE = False
    FRONTIER_MIN_REGION_CELLS = 6  # ignore unchecked blobs smaller than this
    FRONTIER_NOTE_SIZE = 5

    # PPO_13 randomized obstacles: a fresh layout is sampled every episode in
    # reset(). Obstacle radii stay robot-relative (near the PPO_12 values) rather
    # than scaling with the world, so each obstacle remains meaningful next to the
    # unchanged robot. The start position sampler and the fixed target both keep a
    # clearance margin so a solvable path always exists.
    NUM_OBSTACLES = 6
    OBSTACLE_RADIUS_RANGE = (2.5, 3.6)
    OBSTACLE_WALL_MARGIN = 4.0
    # Small plaza: keep only the goal tile itself clear so obstacles may sit close
    # and force detours; reachability is guaranteed separately by a flood-fill.
    OBSTACLE_TARGET_CLEARANCE = 6.0
    OBSTACLE_SPACING = 1.5
    # Reachability guard: re-roll any layout whose target is walled into a pocket.
    REACHABILITY_CELL = 3.0
    REACHABILITY_MIN_FRACTION = 0.5
    OBSTACLE_LAYOUT_ATTEMPTS = 25

    def __init__(self, render_mode: str | None = None):
        super().__init__()
        self.render_mode = render_mode
        # action[1]: turn [-1, 1]. action[0] is forward throttle: plain [0, 1]
        # (PPO_18-28), or normalized [-1, 1] mapped to a forward-only physical
        # throttle when NORMALIZED_THROTTLE is set (PPO_29). Either way the robot
        # only ever moves along its facing, always travelling into its 270-degree
        # visible cone; it still escapes contact by turning in place (the decoupled
        # collision response) plus the stuck rule.
        throttle_low = -1.0 if self.NORMALIZED_THROTTLE else 0.0
        self.action_space = spaces.Box(
            low=np.array([throttle_low, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0], dtype=np.float32),
            dtype=np.float32,
        )
        # Position, target direction, distance, facing, previous collision/action
        # (indices 0-9, unchanged from PPO_10) plus RAY_COUNT forward rangefinder
        # rays (indices 10..9+RAY_COUNT). PPO_18 changes the sensor geometry
        # (270-degree cone, longer range) and the action space (forward-only), so it
        # must start from a fresh policy. PPO_32 optionally appends RAY_COUNT
        # cleared-map summary values (see COVERAGE_MAP) after the rays.
        self.observation_space = spaces.Box(
            -1.0, 1.0, shape=(self.observation_size(),), dtype=np.float32
        )
        self.obstacles: tuple[tuple[float, float, float], ...] = ()
        self.target = self.TARGET.copy()
        self.position = np.zeros(2, dtype=np.float32)
        self.yaw = 0.0
        self.prev_distance = 0.0
        self.last_collision = 0.0
        self.previous_action = np.zeros(2, dtype=np.float32)
        self.last_vision = np.ones(self.RAY_COUNT, dtype=np.float32)
        self.steps = 0
        self.stuck_steps = 0
        self.idle_steps = 0
        self.freeze_steps = 0
        self.best_distance = 0.0
        self.target_visible = False
        self.target_ever_seen = False
        self.last_seen_target = np.zeros(2, dtype=np.float32)
        self.steps_since_target_seen = self.TARGET_MEMORY_STEPS
        self.visited_cells: set[tuple[int, int]] = set()
        self.visited_views: set[tuple[int, int, int]] = set()
        self.scanned_headings: set[int] = set()
        self.trajectory: list[np.ndarray] = []
        self._figure = None
        # PPO_32 cleared/coverage map internal state. Allocated here so tests that
        # construct the env and drive step() without calling reset() still have a
        # valid grid to clear into.
        self.coverage_new_cells: list[int] = []
        # PPO_33 frontier note diagnostics: the world point the note currently
        # selects (or None), and whether it is valid. Populated by _frontier_note.
        self._frontier_target: tuple[float, float] | None = None
        self._frontier_valid: float = 0.0
        self._init_coverage()

    @classmethod
    def observation_size(cls) -> int:
        """Dynamic observation length: base (10) + rays, plus the coverage summary.

        PPO_32 appends one cleared-map summary value per vision ray when
        COVERAGE_MAP is enabled, so the size is 26 by default and 42 with coverage.
        Everything that previously hard-coded ``10 + RAY_COUNT`` should call this.
        """
        return (
            10
            + cls.RAY_COUNT
            + (cls.RAY_COUNT if cls.COVERAGE_MAP else 0)
            + (cls.FRONTIER_NOTE_SIZE if cls.FRONTIER_NOTE else 0)
        )

    @classmethod
    def physical_throttle(cls, action_throttle: float) -> float:
        """Map the raw policy throttle output to a forward-only physical throttle.

        PPO_29 (NORMALIZED_THROTTLE): the policy output lives in [-1, 1] and is
        remapped so -1 = stopped, 0 = half speed, +1 = full speed. Earlier runs
        keep the plain forward-only value unchanged. Used by both the physics step
        and the diagnostics so reported throttle statistics reflect real motion.
        """
        if cls.NORMALIZED_THROTTLE:
            return (float(action_throttle) + 1.0) / 2.0
        return float(action_throttle)

    def _sample_obstacles(self) -> tuple[tuple[float, float, float], ...]:
        """Sample one candidate random obstacle layout (no reachability check).

        Obstacles are kept inside the wall margin, off the target tile, and spaced
        apart so they do not fuse into one blob. Uses ``self.np_random`` so a given
        reset seed reproduces the same draw.
        """
        obstacles: list[tuple[float, float, float]] = []
        for _ in range(10_000):
            if len(obstacles) >= self.NUM_OBSTACLES:
                break
            radius = float(self.np_random.uniform(*self.OBSTACLE_RADIUS_RANGE))
            limit = self.WORLD_LIMIT - self.OBSTACLE_WALL_MARGIN - radius
            ox = float(self.np_random.uniform(-limit, limit))
            oz = float(self.np_random.uniform(-limit, limit))
            if (
                math.hypot(ox - float(self.target[0]), oz - float(self.target[1]))
                < radius + self.OBSTACLE_TARGET_CLEARANCE
            ):
                continue
            if any(
                math.hypot(ox - px, oz - pz) < radius + pr + self.OBSTACLE_SPACING
                for px, pz, pr in obstacles
            ):
                continue
            obstacles.append((ox, oz, radius))
        return tuple(obstacles)

    def _target_reachable(self, obstacles: tuple[tuple[float, float, float], ...]) -> bool:
        """True if the target sits in a large open region rather than a sealed pocket.

        Coarse-grid flood-fill from the target over cells the robot body can
        occupy. Detours are fine; this only rejects a goal that a ring of
        obstacles has fully walled off. Passes when the region connected to the
        target covers at least ``REACHABILITY_MIN_FRACTION`` of all open cells.
        """
        cell = self.REACHABILITY_CELL
        limit = self.WORLD_LIMIT
        steps = int((2.0 * limit) // cell) + 1

        grid_open = [[True] * steps for _ in range(steps)]
        open_cells = 0
        for ix in range(steps):
            x = -limit + ix * cell
            row = grid_open[ix]
            for iz in range(steps):
                z = -limit + iz * cell
                blocked = False
                for ox, oz, r in obstacles:
                    if math.hypot(x - ox, z - oz) < r + self.AGENT_RADIUS:
                        blocked = True
                        break
                if blocked:
                    row[iz] = False
                else:
                    open_cells += 1
        if open_cells == 0:
            return False

        tx = min(steps - 1, max(0, round((float(self.target[0]) + limit) / cell)))
        tz = min(steps - 1, max(0, round((float(self.target[1]) + limit) / cell)))
        if not grid_open[tx][tz]:
            nudged = None
            for dx in range(-2, 3):
                for dz in range(-2, 3):
                    nx, nz = tx + dx, tz + dz
                    if 0 <= nx < steps and 0 <= nz < steps and grid_open[nx][nz]:
                        nudged = (nx, nz)
                        break
                if nudged:
                    break
            if nudged is None:
                return False
            tx, tz = nudged

        stack = [(tx, tz)]
        seen = {(tx, tz)}
        while stack:
            ix, iz = stack.pop()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, nz = ix + dx, iz + dz
                if 0 <= nx < steps and 0 <= nz < steps and grid_open[nx][nz] and (nx, nz) not in seen:
                    seen.add((nx, nz))
                    stack.append((nx, nz))
        return len(seen) >= self.REACHABILITY_MIN_FRACTION * open_cells

    def _generate_obstacles(self) -> tuple[tuple[float, float, float], ...]:
        """Sample a random obstacle layout whose target is guaranteed reachable.

        Re-rolls the whole layout until the target connects to a large open region
        (detours allowed, sealed pockets rejected). Uses ``self.np_random`` so a
        reset seed still reproduces its layout, keeping the fixed-seed exam fair.
        """
        layout = self._sample_obstacles()
        for _ in range(self.OBSTACLE_LAYOUT_ATTEMPTS):
            if self._target_reachable(layout):
                return layout
            layout = self._sample_obstacles()
        return layout

    def _collision_points(self, position: np.ndarray, yaw: float):
        yield position, self.AGENT_RADIUS, "body"
        for angle in self.LEG_ANGLES:
            direction = np.array(
                [math.sin(yaw + angle), math.cos(yaw + angle)],
                dtype=np.float32,
            )
            for segment_index, radius in enumerate(self.LEG_SEGMENT_RADII, start=1):
                yield (
                    position + direction * radius,
                    self.LEG_COLLISION_RADIUS,
                    f"leg-{segment_index}",
                )

    def _collision_for_pose(self, position: np.ndarray, yaw: float) -> str | None:
        for point, point_radius, part in self._collision_points(position, yaw):
            limit = self.WORLD_LIMIT - point_radius
            if np.any(np.abs(point) > limit):
                return part
            for ox, oz, obstacle_radius in self.obstacles:
                if math.hypot(point[0] - ox, point[1] - oz) < obstacle_radius + point_radius:
                    return part
        return None

    def _is_free(self, position: np.ndarray, yaw: float) -> bool:
        if np.linalg.norm(position - self.target) < 10.0:
            return False
        return self._collision_for_pose(position, yaw) is None

    def _sample_target(self) -> np.ndarray:
        limit = self.WORLD_LIMIT - 4.0
        return self.np_random.uniform(-limit, limit, size=2).astype(np.float32)

    def _ray_relative_angles(self) -> np.ndarray:
        """Eight ray angles relative to facing, fanned evenly across the 270 cone.

        Rays sit at the centre of eight equal sectors, so they are symmetric about
        straight-ahead (the two central rays straddle the forward direction) and
        the outermost rays stop short of the 90-degree rear blind wedge.
        """
        width = self.VISION_FOV / self.RAY_COUNT
        left_edge = -self.VISION_FOV / 2.0
        return np.array(
            [left_edge + (index + 0.5) * width for index in range(self.RAY_COUNT)],
            dtype=np.float64,
        )

    def _ray_distances(self, position: np.ndarray, yaw: float) -> np.ndarray:
        """PPO_18 thin-ray clearance for eight forward rays across a 270 cone.

        Each ray is a rangefinder cast from the body centre: it returns the
        distance to the nearest obstacle surface or arena wall along that heading,
        normalized by RAY_MAX_RANGE and clipped to [0, 1] (1 = clear to the range
        limit). This is the simple PPO_11-16 sensor, re-aimed into a forward human
        cone with a longer range; it does not model the swept leg footprint.
        """
        angles = yaw + self._ray_relative_angles()
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        nearest = np.full(self.RAY_COUNT, self.RAY_MAX_RANGE, dtype=np.float64)
        origin = position.astype(np.float64)

        if self.obstacles:
            obstacle_array = np.asarray(self.obstacles, dtype=np.float64)
            centers = obstacle_array[:, :2]
            radii = obstacle_array[:, 2]
            offsets = origin[None, :] - centers  # (O, 2): ray origin relative to each centre
            # Ray-circle intersection for every ray/obstacle pair (unit directions,
            # so a = 1): t^2 + b t + c = 0 with b = 2 d.offset, c = |offset|^2 - r^2.
            b = 2.0 * (directions @ offsets.T)  # (R, O)
            c = (np.sum(offsets * offsets, axis=1) - radii * radii)[None, :]  # (1, O)
            discriminant = b * b - 4.0 * c
            valid = discriminant >= 0.0
            root = np.sqrt(np.maximum(discriminant, 0.0))
            entry = (-b - root) / 2.0
            exit_distance = (-b + root) / 2.0
            hits = np.where(entry >= 0.0, entry, exit_distance)
            hits = np.where(valid & (hits >= 0.0), hits, np.inf)
            nearest = np.minimum(nearest, np.min(hits, axis=1))

        # Distance along each ray to the square arena wall at +/- WORLD_LIMIT.
        for axis in range(2):
            component = directions[:, axis]
            coordinate = origin[axis]
            positive = np.where(
                component > 1e-9,
                (self.WORLD_LIMIT - coordinate) / np.maximum(component, 1e-9),
                np.inf,
            )
            negative = np.where(
                component < -1e-9,
                (-self.WORLD_LIMIT - coordinate) / np.minimum(component, -1e-9),
                np.inf,
            )
            nearest = np.minimum(nearest, np.minimum(positive, negative))

        return (np.clip(nearest, 0.0, self.RAY_MAX_RANGE) / self.RAY_MAX_RANGE).astype(np.float32)

    def _target_sensor(self) -> tuple[bool, float]:
        """Return line-of-sight visibility and world bearing to the tagged target.

        The target is detectable only inside the same 270-degree forward cone
        and range as the obstacle rays. An obstacle intersecting the sight line
        before the target hides it. Identity comes from the game target tag, not
        colour, pixels, or mesh shape.
        """
        delta = self.target.astype(np.float64) - self.position.astype(np.float64)
        distance = float(np.linalg.norm(delta))
        if distance <= 1e-9:
            return True, self.yaw

        world_bearing = math.atan2(float(delta[0]), float(delta[1]))
        relative_bearing = (world_bearing - self.yaw + math.pi) % (2 * math.pi) - math.pi
        if abs(relative_bearing) > self.VISION_FOV / 2.0:
            return False, world_bearing
        if distance - self.TARGET_RADIUS > self.RAY_MAX_RANGE:
            return False, world_bearing

        direction = delta / distance
        origin = self.position.astype(np.float64)
        for ox, oz, radius in self.obstacles:
            offset = origin - np.array([ox, oz], dtype=np.float64)
            b = 2.0 * float(np.dot(direction, offset))
            c = float(np.dot(offset, offset) - radius * radius)
            discriminant = b * b - 4.0 * c
            if discriminant < 0.0:
                continue
            root = math.sqrt(discriminant)
            entry = (-b - root) / 2.0
            exit_distance = (-b + root) / 2.0
            hit = entry if entry >= 0.0 else exit_distance
            if 0.0 <= hit < distance - self.TARGET_RADIUS:
                return False, world_bearing
        return True, world_bearing

    def _update_target_memory(self, increment_time: bool = True) -> None:
        visible, _ = self._target_sensor()
        self.target_visible = visible
        if visible:
            self.target_ever_seen = True
            self.last_seen_target = self.target.copy()
            self.steps_since_target_seen = 0
        elif increment_time:
            self.steps_since_target_seen = min(
                self.TARGET_MEMORY_STEPS,
                self.steps_since_target_seen + 1,
            )

    def _points_visible(self, points: np.ndarray) -> np.ndarray:
        """Vectorized target-visibility test for many candidate points at once.

        This is the exact geometric generalization of ``_target_sensor``'s
        visibility rule (270-degree FOV, ``RAY_MAX_RANGE``, obstacle occlusion,
        ``TARGET_RADIUS`` slack) applied to an ``(N, 2)`` array of world points, so
        the cleared map and the real target sensor share one geometry and cannot
        silently diverge (pinned by a test). It NEVER reads ``self.target``; the
        caller supplies the points. Returns a boolean array: True where a
        hypothetical target at that point would be detectable from the current pose.
        """
        pts = np.atleast_2d(np.asarray(points, dtype=np.float64))
        origin = self.position.astype(np.float64)
        delta = pts - origin[None, :]
        distance = np.hypot(delta[:, 0], delta[:, 1])
        visible = np.ones(pts.shape[0], dtype=bool)
        # A point coincident with the body is always "visible" (matches the scalar
        # sensor's distance <= 1e-9 early return); FOV/range only gate real offsets.
        far = distance > 1e-9
        world_bearing = np.arctan2(delta[:, 0], delta[:, 1])
        relative = (world_bearing - self.yaw + math.pi) % (2 * math.pi) - math.pi
        in_fov = np.abs(relative) <= self.VISION_FOV / 2.0
        in_range = (distance - self.TARGET_RADIUS) <= self.RAY_MAX_RANGE
        visible &= (~far) | (in_fov & in_range)

        if self.obstacles and np.any(visible & far):
            safe_distance = np.where(far, distance, 1.0)
            directions = delta / safe_distance[:, None]
            obstacle_array = np.asarray(self.obstacles, dtype=np.float64)
            centers = obstacle_array[:, :2]
            radii = obstacle_array[:, 2]
            offsets = origin[None, :] - centers  # (O, 2)
            b = 2.0 * (directions @ offsets.T)  # (N, O)
            c = (np.sum(offsets * offsets, axis=1) - radii * radii)[None, :]  # (1, O)
            discriminant = b * b - 4.0 * c
            root = np.sqrt(np.maximum(discriminant, 0.0))
            entry = (-b - root) / 2.0
            exit_distance = (-b + root) / 2.0
            hit = np.where(entry >= 0.0, entry, exit_distance)
            limit = (distance - self.TARGET_RADIUS)[:, None]
            occluded = (discriminant >= 0.0) & (hit >= 0.0) & (hit < limit)
            visible &= ~(far & np.any(occluded, axis=1))
        return visible

    def _init_coverage(self) -> None:
        """Allocate the episode-local cleared grid and cache its cell centres.

        The grid tiles the whole arena with ``COVERAGE_CELL_SIZE`` (the existing
        3-unit exploration cell). Cell ``(ix, iz)`` has centre
        ``-WORLD_LIMIT + (idx + 0.5) * cell`` on each axis, so a position maps to a
        cell by ``floor((coord + WORLD_LIMIT) / cell)``. Centres are cached because
        they never move within a run.
        """
        cell = self.COVERAGE_CELL_SIZE
        limit = self.WORLD_LIMIT
        steps = int((2.0 * limit) // cell) + 1
        self.coverage_steps = steps
        axis = -limit + (np.arange(steps, dtype=np.float64) + 0.5) * cell
        grid_x, grid_z = np.meshgrid(axis, axis, indexing="ij")
        self._coverage_centers_flat = np.stack(
            (grid_x.reshape(-1), grid_z.reshape(-1)), axis=1
        )  # (steps*steps, 2)
        self.coverage_cleared = np.zeros(steps * steps, dtype=bool)
        self.coverage_new_cells = []

    def _reset_coverage(self) -> None:
        """Clear the grid at the start of an episode (called from reset())."""
        self.coverage_cleared[:] = False
        self.coverage_new_cells = []

    def _update_coverage(self) -> None:
        """Mark every currently-detectable, not-yet-cleared cell as cleared.

        Records the flat indices newly cleared this call in ``coverage_new_cells``
        so the replay recorder can store compact per-frame deltas. Deterministic and
        monotonic within an episode (cells only ever go unchecked -> cleared).
        """
        uncleared = np.flatnonzero(~self.coverage_cleared)
        if uncleared.size == 0:
            self.coverage_new_cells = []
            return
        visible = self._points_visible(self._coverage_centers_flat[uncleared])
        newly = uncleared[visible]
        self.coverage_cleared[newly] = True
        self.coverage_new_cells = newly.tolist()

    def _coverage_summary(self) -> np.ndarray:
        """Sixteen egocentric "distance to nearest unchecked ground" readings.

        One reading per vision-ray angle (same headings as ``_ray_distances``). Each
        ray is marched outward from the body centre in ``COVERAGE_SAMPLE_STEP``
        increments from 0 to ``RAY_MAX_RANGE``; the first sample that lands on an
        in-bounds, not-yet-cleared cell gives the distance. The value is that
        distance / ``RAY_MAX_RANGE`` clipped to [0, 1]: 0 = unchecked ground right
        along that heading, larger = farther, 1 = no unchecked ground within 28
        units that way (ray leaves the arena or every cell it crosses is cleared).
        Cells hidden behind rocks are never cleared, so their rock-shadows read as
        distant unchecked ground here. Fully deterministic.
        """
        angles = self.yaw + self._ray_relative_angles()  # (R,)
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)  # (R, 2)
        samples = np.arange(
            0.0, self.RAY_MAX_RANGE + self.COVERAGE_SAMPLE_STEP, self.COVERAGE_SAMPLE_STEP
        )
        samples = np.minimum(samples, self.RAY_MAX_RANGE)  # (S,)
        origin = self.position.astype(np.float64)
        # points[r, s] = origin + samples[s] * directions[r]
        points = origin[None, None, :] + samples[None, :, None] * directions[:, None, :]
        cell = self.COVERAGE_CELL_SIZE
        limit = self.WORLD_LIMIT
        steps = self.coverage_steps
        ix = np.floor((points[..., 0] + limit) / cell).astype(np.int64)
        iz = np.floor((points[..., 1] + limit) / cell).astype(np.int64)
        in_bounds = (ix >= 0) & (ix < steps) & (iz >= 0) & (iz < steps)
        flat = np.clip(ix, 0, steps - 1) * steps + np.clip(iz, 0, steps - 1)
        cleared_here = self.coverage_cleared[flat]
        unchecked = in_bounds & ~cleared_here  # (R, S)
        has_unchecked = unchecked.any(axis=1)
        first = unchecked.argmax(axis=1)
        distance = samples[first]
        value = np.where(has_unchecked, distance / self.RAY_MAX_RANGE, 1.0)
        return np.clip(value, 0.0, 1.0).astype(np.float32)

    def coverage_fraction(self) -> float:
        """Fraction of arena cells currently marked cleared (diagnostics)."""
        return float(self.coverage_cleared.mean())

    def _frontier_note(self) -> np.ndarray:
        """PPO_33 global frontier note (5 values) from the internal cleared grid.

        Deterministic, and a pure function of ``(coverage_cleared, position)`` only:
        it never reads the real target position or obstacle positions (honest search
        memory). Steps:

        1. Take the unchecked cells (``~coverage_cleared``) and label their
           4-connected components.
        2. Choose the LARGEST component. If it is smaller than
           ``FRONTIER_MIN_REGION_CELLS`` (only tiny isolated rock-shadow fragments
           remain), return the invalid note.
        3. Its frontier cells are the region cells adjacent to a cleared cell; pick
           the one NEAREST the body. (If the region touches no cleared cell yet, fall
           back to its nearest cell.)
        4. Emit ``[rel_dir_x, rel_dir_z, distance / arena_diagonal, region_size /
           total_cells, 1.0]`` toward that cell. Directions are world-space unit
           components, matching the remembered-target-direction convention (indices
           2-3). The invalid note is ``[0, 0, 1, 0, 0]`` (0 direction, "far/unknown"
           distance, no size, flag off) so a cleared arena reads as "nothing left".
        """
        invalid = np.array([0.0, 0.0, 1.0, 0.0, 0.0], dtype=np.float32)
        steps = self.coverage_steps
        total = self.coverage_cleared.size
        cleared_grid = self.coverage_cleared.reshape(steps, steps)
        unchecked = ~cleared_grid
        if not unchecked.any():
            self._frontier_target = None
            self._frontier_valid = 0.0
            return invalid

        # Label 4-connected unchecked components with an iterative flood fill and
        # keep the largest. 441 cells, so a plain Python BFS is cheap and exact.
        labels = np.full((steps, steps), -1, dtype=np.int32)
        best_cells: list[tuple[int, int]] = []
        for start_i in range(steps):
            for start_j in range(steps):
                if not unchecked[start_i, start_j] or labels[start_i, start_j] != -1:
                    continue
                stack = [(start_i, start_j)]
                labels[start_i, start_j] = 1
                cells: list[tuple[int, int]] = []
                while stack:
                    i, j = stack.pop()
                    cells.append((i, j))
                    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ni, nj = i + di, j + dj
                        if (
                            0 <= ni < steps
                            and 0 <= nj < steps
                            and unchecked[ni, nj]
                            and labels[ni, nj] == -1
                        ):
                            labels[ni, nj] = 1
                            stack.append((ni, nj))
                if len(cells) > len(best_cells):
                    best_cells = cells

        region_size = len(best_cells)
        if region_size < self.FRONTIER_MIN_REGION_CELLS:
            self._frontier_target = None
            self._frontier_valid = 0.0
            return invalid

        # Frontier cells = region cells touching a cleared cell (the known/unknown
        # boundary). Fall back to all region cells if none touch cleared yet.
        frontier = [
            (i, j)
            for (i, j) in best_cells
            if any(
                0 <= i + di < steps and 0 <= j + dj < steps and cleared_grid[i + di, j + dj]
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
        ]
        candidates = frontier if frontier else best_cells

        cell = self.COVERAGE_CELL_SIZE
        limit = self.WORLD_LIMIT
        px, pz = float(self.position[0]), float(self.position[1])
        best_distance = math.inf
        best_x = best_z = 0.0
        for (i, j) in candidates:
            cx = -limit + (i + 0.5) * cell
            cz = -limit + (j + 0.5) * cell
            distance = math.hypot(cx - px, cz - pz)
            if distance < best_distance:
                best_distance = distance
                best_x, best_z = cx, cz

        diagonal = 2.0 * math.sqrt(2.0) * limit
        if best_distance > 1e-6:
            dir_x = (best_x - px) / best_distance
            dir_z = (best_z - pz) / best_distance
        else:
            dir_x = dir_z = 0.0
        self._frontier_target = (best_x, best_z)
        self._frontier_valid = 1.0
        return np.array(
            [
                dir_x,
                dir_z,
                min(best_distance / diagonal, 1.0),
                min(region_size / total, 1.0),
                1.0,
            ],
            dtype=np.float32,
        )

    def _search_state(self) -> tuple[tuple[int, int], tuple[int, int, int]]:
        cell_x = math.floor(float(self.position[0]) / self.EXPLORATION_CELL_SIZE)
        cell_z = math.floor(float(self.position[1]) / self.EXPLORATION_CELL_SIZE)
        normalized_yaw = (self.yaw + math.pi) % (2 * math.pi)
        heading = min(
            self.EXPLORATION_HEADING_BINS - 1,
            int(normalized_yaw / (2 * math.pi) * self.EXPLORATION_HEADING_BINS),
        )
        return (cell_x, cell_z), (cell_x, cell_z, heading)

    def _observation(self) -> np.ndarray:
        max_distance = 2.0 * math.sqrt(2.0) * self.WORLD_LIMIT
        if self.target_ever_seen:
            remembered_delta = self.last_seen_target - self.position
            remembered_distance = float(np.linalg.norm(remembered_delta))
            remembered_direction = remembered_delta / max(remembered_distance, 1e-6)
        else:
            remembered_distance = max_distance
            remembered_direction = np.zeros(2, dtype=np.float32)
        base = np.array(
            [
                float(self.target_visible),
                np.clip(self.steps_since_target_seen / self.TARGET_MEMORY_STEPS, 0.0, 1.0),
                remembered_direction[0],
                remembered_direction[1],
                np.clip(remembered_distance / max_distance, 0.0, 1.0),
                math.sin(self.yaw),
                math.cos(self.yaw),
                self.last_collision,
                self.previous_action[0],
                self.previous_action[1],
            ],
            dtype=np.float32,
        )
        vision = self._ray_distances(self.position, self.yaw)
        self.last_vision = vision
        parts = [base, vision]
        if self.COVERAGE_MAP:
            # PPO_32: only the 16-value summary is exposed to the policy; the full
            # grid stays internal for diagnostics and the viewer.
            parts.append(self._coverage_summary())
        if self.FRONTIER_NOTE:
            # PPO_33 / Phase 1B: the compact 5-value global frontier note.
            parts.append(self._frontier_note())
        if len(parts) == 2:
            return np.concatenate([base, vision])
        return np.concatenate(parts)

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        self.target = self._sample_target()
        self.obstacles = self._generate_obstacles()
        start_limit = self.WORLD_LIMIT - 4.0
        for _ in range(10_000):
            candidate = self.np_random.uniform(-start_limit, start_limit, size=2).astype(np.float32)
            candidate_yaw = float(self.np_random.uniform(-math.pi, math.pi))
            if self._is_free(candidate, candidate_yaw):
                self.position = candidate
                self.yaw = candidate_yaw
                break
        else:
            raise RuntimeError("Could not sample a valid start position")
        self.steps = 0
        self.stuck_steps = 0
        self.idle_steps = 0
        self.freeze_steps = 0
        self.prev_distance = self._distance()
        self.best_distance = self.prev_distance
        self.last_collision = 0.0
        self.previous_action.fill(0.0)
        self.target_visible = False
        self.target_ever_seen = False
        self.last_seen_target.fill(0.0)
        self.steps_since_target_seen = self.TARGET_MEMORY_STEPS
        self.visited_cells.clear()
        self.visited_views.clear()
        self.scanned_headings.clear()
        cell, view = self._search_state()
        self.visited_cells.add(cell)
        self.visited_views.add(view)
        # Seed the starting facing so only turning to a genuinely NEW heading earns
        # the scan nudge (standing still at spawn is not a "look around").
        self.scanned_headings.add(view[2])
        self._update_target_memory(increment_time=False)
        # PPO_32: episode-local cleared map. Reset, then clear for the spawn pose so
        # the very first observation already reflects what the spawn can see.
        self._reset_coverage()
        self._update_coverage()
        self.trajectory = [self.position.copy()]
        observation = self._observation()
        return observation, {
            "distance": self.prev_distance,
            "vision": self.last_vision.tolist(),
            "target": self.target.tolist(),
            "target_visible": self.target_visible,
            "target_ever_seen": self.target_ever_seen,
            "coverage_fraction": self.coverage_fraction(),
            "coverage_new_cells": list(self.coverage_new_cells),
            "coverage_steps": self.coverage_steps,
        }

    def _distance(self) -> float:
        return float(np.linalg.norm(self.target - self.position))

    def _progress_reward(self, previous_distance: float, distance: float) -> float:
        if self.target_ever_seen:
            # Once discovered, search is over. Reward genuine pursuit and charge
            # the same magnitude for retreat so orbiting cannot farm asymmetric
            # clipped progress while repeatedly crossing the sight boundary.
            pursuit_delta = float(np.clip(
                previous_distance - distance,
                -self.MOVE_SPEED,
                self.MOVE_SPEED,
            ))
            return pursuit_delta * self.DISTANCE_REWARD_SCALE
        # Before first sight, do not stream negatives for searching the wrong
        # direction. A positive-only best-distance nudge preserves PPO_27's useful
        # sparse search shaping without exposing target coordinates in observation.
        new_best = max(0.0, self.best_distance - distance)
        return new_best * self.BEST_PROGRESS_SCALE

    def step(self, action: np.ndarray):
        action = np.clip(np.asarray(action, dtype=np.float32), self.action_space.low, self.action_space.high)
        previous_position = self.position.copy()
        previous_yaw = self.yaw
        previous_distance = self.prev_distance
        had_seen_target = self.target_ever_seen
        # Forward-only physical throttle. For PPO_29 the raw [-1, 1] output is
        # remapped so neutral (0) drifts forward at half speed; earlier runs pass
        # the plain [0, 1] value straight through (see physical_throttle).
        throttle = self.physical_throttle(float(action[0]))
        candidate_yaw = (
            self.yaw + float(action[1]) * self.TURN_SPEED + math.pi
        ) % (2 * math.pi) - math.pi
        heading = np.array([math.sin(candidate_yaw), math.cos(candidate_yaw)], dtype=np.float32)
        candidate = self.position + heading * throttle * self.MOVE_SPEED

        # The collision flag and its -0.18 penalty still reflect the full intended
        # turn-and-move, so reward semantics are identical to PPO_11. The single
        # PPO_12 change is the state update: when the combined move is blocked,
        # rotation and translation are resolved independently so a touching robot
        # can still turn or reverse out of contact instead of freezing in place.
        collision_part = self._collision_for_pose(candidate, candidate_yaw)
        collided = collision_part is not None
        if not collided:
            self.position = candidate
            self.yaw = candidate_yaw
        else:
            # 1) Rotate in place if the turned pose alone is collision-free.
            if self._collision_for_pose(self.position, candidate_yaw) is None:
                self.yaw = candidate_yaw
            # 2) Translate along the resolved facing if that alone is collision-free.
            resolved_heading = np.array(
                [math.sin(self.yaw), math.cos(self.yaw)], dtype=np.float32
            )
            stepped = self.position + resolved_heading * throttle * self.MOVE_SPEED
            if self._collision_for_pose(stepped, self.yaw) is None:
                self.position = stepped

        self.steps += 1
        distance = self._distance()
        reached = distance <= self.TARGET_RADIUS + self.AGENT_RADIUS
        moved_distance = float(np.linalg.norm(self.position - previous_position))
        self._update_target_memory()
        # PPO_32: update the cleared map for the resulting pose before observing.
        self._update_coverage()

        cell, view = self._search_state()
        entered_new_cell = cell not in self.visited_cells
        found_new_view = view not in self.visited_views
        self.visited_cells.add(cell)
        self.visited_views.add(view)

        # Stuck remains a physical rule: a collision with no actual translation.
        # It no longer relies on privileged knowledge of hidden target distance.
        if collided and moved_distance <= 1e-3:
            self.stuck_steps += 1
        else:
            self.stuck_steps = 0
        stuck = self.stuck_steps >= self.STUCK_LIMIT

        # Searching may require turning in place, so a genuinely new viewing
        # direction resets the idle counter. Repeating an already-seen view while
        # not translating eventually receives the proven PPO_25 idle tax.
        if moved_distance <= 1e-3 and not found_new_view:
            self.idle_steps += 1
        else:
            self.idle_steps = 0
        idling = self.idle_steps > self.IDLE_GRACE

        # PPO_29 general freeze: a purely physical rule that counts ANY step with no
        # translation (collision or not, scanning or not). Real movement resets it.
        # Scanning a full revolution costs ~40 steps < FREEZE_LIMIT, so looking
        # around survives, but standing/spinning in place forever does not.
        if moved_distance <= 1e-3:
            self.freeze_steps += 1
        else:
            self.freeze_steps = 0
        frozen = self.freeze_steps >= self.FREEZE_LIMIT and not reached

        # Reward turning to a genuinely new heading a little, but only while still
        # searching and only up to one full revolution (the heading-bin set is
        # naturally capped). Discovery ends the nudge; pursuit reward takes over.
        heading_bin = view[2]
        if not self.target_ever_seen and heading_bin not in self.scanned_headings:
            self.scanned_headings.add(heading_bin)
            scan_reward = self.SCAN_REWARD
        else:
            scan_reward = 0.0

        # A stuck or frozen end is a terminal failure (not a truncation): the future
        # value from here is just the penalty, so the agent learns the dead-end and
        # the freeze are bad outcomes rather than neutral ways to end an episode.
        terminated = reached or stuck or frozen
        truncated = self.steps >= self.MAX_STEPS and not terminated

        progress_reward = self._progress_reward(previous_distance, distance)
        # Exploration is useful only until the target has been identified. After
        # that point, the remembered target position and symmetric pursuit reward
        # make reaching it the only profitable behavior.
        exploration_reward = 0.0 if self.target_ever_seen else (
            (self.EXPLORATION_REWARD if entered_new_cell else 0.0)
            + (self.NEW_VIEW_REWARD if found_new_view else 0.0)
            + scan_reward
        )
        sight_reward = self.SIGHT_REWARD if self.target_visible and not had_seen_target else 0.0
        time_penalty = -self.STEP_PENALTY
        idle_penalty = -self.IDLE_PENALTY if idling else 0.0
        freeze_penalty = -self.FREEZE_PENALTY if frozen else 0.0
        collision_penalty = -self.COLLISION_PENALTY if collided else 0.0
        stuck_penalty = -self.STUCK_PENALTY if stuck else 0.0
        goal_reward = self.GOAL_REWARD if reached else 0.0
        reward = (
            progress_reward
            + exploration_reward
            + sight_reward
            + time_penalty
            + idle_penalty
            + freeze_penalty
            + collision_penalty
            + stuck_penalty
            + goal_reward
        )
        self.best_distance = min(self.best_distance, distance)
        self.prev_distance = distance
        self.last_collision = float(collided)
        self.previous_action = action.copy()

        self.trajectory.append(self.position.copy())
        info = {
            "distance": distance,
            "previous_distance": previous_distance,
            "is_success": reached,
            "is_fallen": False,
            "collision": collided,
            "collision_part": collision_part,
            "stuck": stuck,
            "frozen": frozen,
            "x": float(self.position[0]),
            "z": float(self.position[1]),
            "yaw": self.yaw,
            "previous_x": float(previous_position[0]),
            "previous_z": float(previous_position[1]),
            "previous_yaw": previous_yaw,
            "episode_step": self.steps,
            "obstacles": self.obstacles,
            "target": self.target.tolist(),
            "target_visible": self.target_visible,
            "target_ever_seen": self.target_ever_seen,
            "coverage_fraction": self.coverage_fraction(),
            "coverage_new_cells": list(self.coverage_new_cells),
            "coverage_steps": self.coverage_steps,
            "reward_terms": {
                "progress": progress_reward,
                "exploration": exploration_reward,
                "sight": sight_reward,
                "time": time_penalty + idle_penalty + freeze_penalty,
                "collision": collision_penalty + stuck_penalty,
                "goal": goal_reward,
            },
        }
        observation = self._observation()
        info["vision"] = self.last_vision.tolist()
        if self.render_mode == "human":
            self.render()
        return observation, float(reward), terminated, truncated, info

    def render(self):
        import matplotlib.pyplot as plt
        from matplotlib.patches import Circle, Rectangle

        if self._figure is None:
            plt.ion()
            self._figure, self._axis = plt.subplots(figsize=(7, 7))
        ax = self._axis
        ax.clear()
        ax.set_facecolor("#111217")
        ax.set_xlim(-self.WORLD_LIMIT, self.WORLD_LIMIT)
        ax.set_ylim(-self.WORLD_LIMIT, self.WORLD_LIMIT)
        ax.set_aspect("equal")
        ax.grid(color="#292c35", alpha=0.5)
        for ox, oz, radius in self.obstacles:
            ax.add_patch(Circle((ox, oz), radius, color="#575b65"))
        ax.add_patch(Rectangle(self.target - 1.2, 2.4, 2.4, color="#ff4fa3"))
        path = np.asarray(self.trajectory)
        if len(path) > 1:
            ax.plot(path[:, 0], path[:, 1], color="#ff8b3d", linewidth=1.3, alpha=0.75)
        direction = np.array([math.sin(self.yaw), math.cos(self.yaw)])
        ax.arrow(*self.position, *(direction * 1.8), color="#ff4a26", width=0.2, head_width=0.9)
        ax.add_patch(Circle(self.position, self.AGENT_RADIUS, color="#d8dbe2"))
        for point, radius, part in self._collision_points(self.position, self.yaw):
            if part != "body":
                ax.add_patch(Circle(point, radius, color="#ff8b3d", alpha=0.8))
        ax.set_title(f"Leaper PPO evaluation — step {self.steps}", color="#d8dbe2")
        self._figure.canvas.draw_idle()
        self._figure.canvas.flush_events()
        plt.pause(1.0 / self.metadata["render_fps"])

    def close(self):
        if self._figure is not None:
            import matplotlib.pyplot as plt

            plt.close(self._figure)
            self._figure = None
