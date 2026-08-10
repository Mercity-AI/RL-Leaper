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

    WORLD_LIMIT = 25.0
    TARGET = np.array([18.0, 18.0], dtype=np.float32)
    TARGET_RADIUS = 1.4
    AGENT_RADIUS = 0.75
    MOVE_SPEED = 0.75
    TURN_SPEED = math.radians(18.0)
    MAX_STEPS = 400

    # x, z, collision radius; these are static for every episode.
    OBSTACLES = (
        (-10.0, -5.0, 3.2),
        (1.0, 4.0, 3.0),
        (10.0, 11.0, 2.8),
        (-7.0, 13.0, 2.6),
        (12.0, -8.0, 3.4),
    )

    def __init__(self, render_mode: str | None = None):
        super().__init__()
        self.render_mode = render_mode
        # action[0]: forward throttle [0, 1], action[1]: turn [-1, 1]
        self.action_space = spaces.Box(
            low=np.array([0.0, -1.0], dtype=np.float32),
            high=np.array([1.0, 1.0], dtype=np.float32),
            dtype=np.float32,
        )
        # normalized position, target direction, distance, and facing vector
        self.observation_space = spaces.Box(-1.0, 1.0, shape=(7,), dtype=np.float32)
        self.position = np.zeros(2, dtype=np.float32)
        self.yaw = 0.0
        self.steps = 0
        self.trajectory: list[np.ndarray] = []
        self._figure = None

    def _is_free(self, position: np.ndarray) -> bool:
        limit = self.WORLD_LIMIT - self.AGENT_RADIUS
        if np.any(np.abs(position) > limit):
            return False
        if np.linalg.norm(position - self.TARGET) < self.TARGET_RADIUS + 2.0:
            return False
        return all(
            math.hypot(position[0] - ox, position[1] - oz) >= radius + self.AGENT_RADIUS
            for ox, oz, radius in self.OBSTACLES
        )

    def _observation(self) -> np.ndarray:
        delta = self.TARGET - self.position
        distance = float(np.linalg.norm(delta))
        direction = delta / max(distance, 1e-6)
        max_distance = 2.0 * math.sqrt(2.0) * self.WORLD_LIMIT
        return np.array(
            [
                self.position[0] / self.WORLD_LIMIT,
                self.position[1] / self.WORLD_LIMIT,
                direction[0],
                direction[1],
                np.clip(distance / max_distance, 0.0, 1.0),
                math.sin(self.yaw),
                math.cos(self.yaw),
            ],
            dtype=np.float32,
        )

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        for _ in range(10_000):
            candidate = self.np_random.uniform(-21.0, 21.0, size=2).astype(np.float32)
            if self._is_free(candidate):
                self.position = candidate
                break
        else:
            raise RuntimeError("Could not sample a valid start position")
        self.yaw = float(self.np_random.uniform(-math.pi, math.pi))
        self.steps = 0
        self.trajectory = [self.position.copy()]
        return self._observation(), {"distance": self._distance()}

    def _distance(self) -> float:
        return float(np.linalg.norm(self.TARGET - self.position))

    def step(self, action: np.ndarray):
        action = np.clip(np.asarray(action, dtype=np.float32), self.action_space.low, self.action_space.high)
        previous_distance = self._distance()
        self.yaw = (self.yaw + float(action[1]) * self.TURN_SPEED + math.pi) % (2 * math.pi) - math.pi
        heading = np.array([math.sin(self.yaw), math.cos(self.yaw)], dtype=np.float32)
        candidate = self.position + heading * float(action[0]) * self.MOVE_SPEED

        collided = not self._is_free_for_motion(candidate)
        if not collided:
            self.position = candidate

        self.steps += 1
        distance = self._distance()
        reached = distance <= self.TARGET_RADIUS + self.AGENT_RADIUS
        truncated = self.steps >= self.MAX_STEPS

        reward = (previous_distance - distance) * 1.25 - 0.01
        if collided:
            reward -= 0.18
        if reached:
            reward += 25.0

        self.trajectory.append(self.position.copy())
        info = {
            "distance": distance,
            "is_success": reached,
            "collision": collided,
        }
        if self.render_mode == "human":
            self.render()
        return self._observation(), float(reward), reached, truncated, info

    def _is_free_for_motion(self, position: np.ndarray) -> bool:
        limit = self.WORLD_LIMIT - self.AGENT_RADIUS
        if np.any(np.abs(position) > limit):
            return False
        return all(
            math.hypot(position[0] - ox, position[1] - oz) >= radius + self.AGENT_RADIUS
            for ox, oz, radius in self.OBSTACLES
        )

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
        for ox, oz, radius in self.OBSTACLES:
            ax.add_patch(Circle((ox, oz), radius, color="#575b65"))
        ax.add_patch(Rectangle(self.TARGET - 1.2, 2.4, 2.4, color="#ff4fa3"))
        path = np.asarray(self.trajectory)
        if len(path) > 1:
            ax.plot(path[:, 0], path[:, 1], color="#ff8b3d", linewidth=1.3, alpha=0.75)
        direction = np.array([math.sin(self.yaw), math.cos(self.yaw)])
        ax.arrow(*self.position, *(direction * 1.8), color="#ff4a26", width=0.2, head_width=0.9)
        ax.add_patch(Circle(self.position, self.AGENT_RADIUS, color="#d8dbe2"))
        ax.set_title(f"Leaper PPO evaluation — step {self.steps}", color="#d8dbe2")
        self._figure.canvas.draw_idle()
        self._figure.canvas.flush_events()
        plt.pause(1.0 / self.metadata["render_fps"])

    def close(self):
        if self._figure is not None:
            import matplotlib.pyplot as plt

            plt.close(self._figure)
            self._figure = None
