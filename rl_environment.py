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

    # Randomized generalization arena: obstacles are scattered into a fresh
    # layout every episode (see _generate_obstacles / reset). The robot itself is
    # unchanged, so robot-relative values (radii, speeds, rays) are NOT scaled
    # with the world. History: WORLD_LIMIT was 25.0 through PPO_12, 62.5 for
    # PPO_13; PPO_14 grows it by half again to 93.75 (a 187.5-wide field).
    WORLD_LIMIT = 93.75
    # PPO_14: target in the south-west, off-center and farther out so the robot
    # must weave through obstacles to reach it. A small plaza keeps the goal tile
    # itself clear, and a flood-fill check (see _target_reachable) guarantees a
    # path always exists even though obstacles may sit close and force detours.
    TARGET = np.array([-40.0, -10.0], dtype=np.float32)
    TARGET_RADIUS = 1.4
    AGENT_RADIUS = 0.75
    LEG_COLLISION_RADIUS = 0.24
    LEG_SEGMENT_RADII = (1.2, 2.2, 3.24)
    LEG_ANGLES = (-0.62, 0.62, -1.57, 1.57, -2.42, 2.42)
    # PPO_17 forward collision-aware vision. Eight observation channels tile a
    # 200-degree forward field. Each 25-degree sector samples three directions
    # and reports the most conservative safe translation clearance for the full
    # 19-circle body/leg footprint, normalized by RAY_MAX_RANGE (1 = clear).
    RAY_COUNT = 8
    RAY_MAX_RANGE = 12.0
    VISION_FOV = math.radians(200.0)
    VISION_SAMPLES_PER_SECTOR = 3
    MOVE_SPEED = 0.75
    TURN_SPEED = math.radians(18.0)
    # Raised from 400: the larger field means the target is much farther, so a
    # short cap would time out before arrival regardless of skill.
    MAX_STEPS = 1000
    DISTANCE_REWARD_SCALE = 0.2
    STEP_PENALTY = 0.01
    COLLISION_PENALTY = 0.18
    GOAL_REWARD = 25.0
    # PPO_16 stuck rule: if the robot is in contact and makes no forward progress
    # for STUCK_LIMIT steps in a row, the episode ends as a terminal failure with a
    # one-time STUCK_PENALTY. This targets the deterministic freeze directly, and
    # the explicit penalty stops "quit early to dodge accumulated costs" from ever
    # looking attractive (ending an episode is not a punishment on its own).
    STUCK_LIMIT = 40
    STUCK_PENALTY = 10.0

    # PPO_13 randomized obstacles: a fresh layout is sampled every episode in
    # reset(). Obstacle radii stay robot-relative (near the PPO_12 values) rather
    # than scaling with the world, so each obstacle remains meaningful next to the
    # unchanged robot. The start position sampler and the fixed target both keep a
    # clearance margin so a solvable path always exists.
    NUM_OBSTACLES = 51
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
        # action[0]: signed throttle [-1, 1], action[1]: turn [-1, 1]
        # Negative throttle reverses along the candidate facing direction.
        self.action_space = spaces.Box(
            low=np.array([-1.0, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0], dtype=np.float32),
            dtype=np.float32,
        )
        # Position, target direction, distance, facing, previous collision/action
        # (indices 0-9, unchanged from PPO_10) plus eight forward safe-clearance
        # sectors (indices 10-17). PPO_17 changes those sensor semantics and must
        # therefore start from a fresh policy even though the shape stays 18.
        self.observation_space = spaces.Box(
            -1.0, 1.0, shape=(10 + self.RAY_COUNT,), dtype=np.float32
        )
        self.obstacles: tuple[tuple[float, float, float], ...] = ()
        self.position = np.zeros(2, dtype=np.float32)
        self.yaw = 0.0
        self.prev_distance = 0.0
        self.last_collision = 0.0
        self.previous_action = np.zeros(2, dtype=np.float32)
        self.last_vision = np.ones(self.RAY_COUNT, dtype=np.float32)
        self.steps = 0
        self.stuck_steps = 0
        self.trajectory: list[np.ndarray] = []
        self._figure = None

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
                math.hypot(ox - float(self.TARGET[0]), oz - float(self.TARGET[1]))
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

        tx = min(steps - 1, max(0, round((float(self.TARGET[0]) + limit) / cell)))
        tz = min(steps - 1, max(0, round((float(self.TARGET[1]) + limit) / cell)))
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
        if np.linalg.norm(position - self.TARGET) < self.TARGET_RADIUS + 2.0:
            return False
        return self._collision_for_pose(position, yaw) is None

    def _vision_sector_bounds(self) -> tuple[tuple[float, float], ...]:
        """Return the eight contiguous relative-angle sectors spanning 200 degrees."""
        width = self.VISION_FOV / self.RAY_COUNT
        left_edge = -self.VISION_FOV / 2.0
        return tuple(
            (left_edge + index * width, left_edge + (index + 1) * width)
            for index in range(self.RAY_COUNT)
        )

    def _vision_sample_angles(self, yaw: float) -> np.ndarray:
        """Sample each sector evenly without exposing extra observation values."""
        angles = []
        for start, end in self._vision_sector_bounds():
            width = end - start
            for sample in range(self.VISION_SAMPLES_PER_SECTOR):
                relative = start + (sample + 0.5) * width / self.VISION_SAMPLES_PER_SECTOR
                angles.append(yaw + relative)
        return np.asarray(angles, dtype=np.float64)

    def _ray_distances(self, position: np.ndarray, yaw: float) -> np.ndarray:
        """PPO_17 safe clearance in eight forward-facing vision sectors.

        Each sector samples several translation directions. For every direction
        we sweep all 19 collision circles against expanded obstacle circles and
        the radius-adjusted arena walls. The sector returns the nearest sampled
        collision distance. This is exact for translation at the current yaw on
        the sampled directions; it does not predict the leg swing of a future
        simultaneous rotation.
        """
        collision_points = list(self._collision_points(position, yaw))
        point_positions = np.asarray([point for point, _, _ in collision_points], dtype=np.float64)
        point_radii = np.asarray([radius for _, radius, _ in collision_points], dtype=np.float64)

        angles = self._vision_sample_angles(yaw)
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        sample_count = len(directions)
        nearest = np.full(sample_count, self.RAY_MAX_RANGE, dtype=np.float64)

        if self.obstacles:
            obstacle_array = np.asarray(self.obstacles, dtype=np.float64)
            obstacle_positions = obstacle_array[:, :2]
            obstacle_radii = obstacle_array[:, 2]
            offsets = point_positions[:, None, :] - obstacle_positions[None, :, :]
            expanded_radii = point_radii[:, None] + obstacle_radii[None, :]
            c = np.sum(offsets * offsets, axis=2) - expanded_radii * expanded_radii

            # If a pose is already touching, every attempted translation begins
            # unsafe. Valid environment states are normally collision-free, but
            # this makes the sensor contract explicit and robust in diagnostics.
            if np.any(c <= 0.0):
                return np.zeros(self.RAY_COUNT, dtype=np.float32)

            b = 2.0 * np.einsum("poc,dc->dpo", offsets, directions)
            discriminant = b * b - 4.0 * c[None, :, :]
            valid = discriminant >= 0.0
            root = np.sqrt(np.maximum(discriminant, 0.0))
            entry = (-b - root) / 2.0
            exit_distance = (-b + root) / 2.0
            hits = np.where(entry >= 0.0, entry, exit_distance)
            hits = np.where(valid & (hits >= 0.0), hits, np.inf)
            nearest = np.minimum(nearest, np.min(hits, axis=(1, 2)))

        # Sweep each collision circle against the safe inner wall rectangle.
        for axis in range(2):
            components = directions[:, axis][:, None]
            coordinates = point_positions[:, axis][None, :]
            limits = (self.WORLD_LIMIT - point_radii)[None, :]
            positive = np.where(
                components > 1e-9,
                (limits - coordinates) / np.maximum(components, 1e-9),
                np.inf,
            )
            negative = np.where(
                components < -1e-9,
                (-limits - coordinates) / np.minimum(components, -1e-9),
                np.inf,
            )
            nearest = np.minimum(nearest, np.min(np.minimum(positive, negative), axis=1))

        normalized_samples = np.clip(nearest, 0.0, self.RAY_MAX_RANGE) / self.RAY_MAX_RANGE
        return np.min(
            normalized_samples.reshape(self.RAY_COUNT, self.VISION_SAMPLES_PER_SECTOR),
            axis=1,
        ).astype(np.float32)

    def _observation(self) -> np.ndarray:
        delta = self.TARGET - self.position
        distance = float(np.linalg.norm(delta))
        direction = delta / max(distance, 1e-6)
        max_distance = 2.0 * math.sqrt(2.0) * self.WORLD_LIMIT
        base = np.array(
            [
                self.position[0] / self.WORLD_LIMIT,
                self.position[1] / self.WORLD_LIMIT,
                direction[0],
                direction[1],
                np.clip(distance / max_distance, 0.0, 1.0),
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
        return np.concatenate([base, vision])

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
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
        self.prev_distance = self._distance()
        self.last_collision = 0.0
        self.previous_action.fill(0.0)
        self.trajectory = [self.position.copy()]
        observation = self._observation()
        return observation, {"distance": self.prev_distance, "vision": self.last_vision.tolist()}

    def _distance(self) -> float:
        return float(np.linalg.norm(self.TARGET - self.position))

    def _progress_reward(self, previous_distance: float, distance: float) -> float:
        return (previous_distance - distance) * self.DISTANCE_REWARD_SCALE

    def step(self, action: np.ndarray):
        action = np.clip(np.asarray(action, dtype=np.float32), self.action_space.low, self.action_space.high)
        candidate_yaw = (
            self.yaw + float(action[1]) * self.TURN_SPEED + math.pi
        ) % (2 * math.pi) - math.pi
        heading = np.array([math.sin(candidate_yaw), math.cos(candidate_yaw)], dtype=np.float32)
        candidate = self.position + heading * float(action[0]) * self.MOVE_SPEED

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
            stepped = self.position + resolved_heading * float(action[0]) * self.MOVE_SPEED
            if self._collision_for_pose(stepped, self.yaw) is None:
                self.position = stepped

        self.steps += 1
        distance = self._distance()
        reached = distance <= self.TARGET_RADIUS + self.AGENT_RADIUS

        # Stuck rule: count consecutive steps that both collide and make no
        # forward progress toward the target; reset the moment either is false.
        made_progress = (self.prev_distance - distance) > 1e-3
        if collided and not made_progress:
            self.stuck_steps += 1
        else:
            self.stuck_steps = 0
        stuck = self.stuck_steps >= self.STUCK_LIMIT

        # A stuck end is a terminal failure (not a truncation): the future value
        # from here is just the penalty, so the agent learns the dead-end is bad.
        terminated = reached or stuck
        truncated = self.steps >= self.MAX_STEPS and not terminated

        progress_reward = self._progress_reward(self.prev_distance, distance)
        time_penalty = -self.STEP_PENALTY
        collision_penalty = -self.COLLISION_PENALTY if collided else 0.0
        stuck_penalty = -self.STUCK_PENALTY if stuck else 0.0
        goal_reward = self.GOAL_REWARD if reached else 0.0
        reward = (
            progress_reward
            + time_penalty
            + collision_penalty
            + stuck_penalty
            + goal_reward
        )
        self.prev_distance = distance
        self.last_collision = float(collided)
        self.previous_action = action.copy()

        self.trajectory.append(self.position.copy())
        info = {
            "distance": distance,
            "is_success": reached,
            "is_fallen": False,
            "collision": collided,
            "collision_part": collision_part,
            "stuck": stuck,
            "x": float(self.position[0]),
            "z": float(self.position[1]),
            "yaw": self.yaw,
            "episode_step": self.steps,
            "obstacles": self.obstacles,
            # The one-time stuck penalty is reported inside the collision term so
            # the diagnostics keys stay unchanged; the total reward is exact.
            "reward_terms": {
                "progress": progress_reward,
                "time": time_penalty,
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
        ax.add_patch(Rectangle(self.TARGET - 1.2, 2.4, 2.4, color="#ff4fa3"))
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
