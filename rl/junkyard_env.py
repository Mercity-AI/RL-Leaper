"""Evaluation-only adapter for the frozen 7,757,824-step seeker recipe."""
import numpy as np

from rl.seeker_env import SeekerEnv


class JunkyardEnv(SeekerEnv):
    def __init__(self, geometry, position, yaw, target):
        self.geometry = geometry
        # Keep distances in original robot units; map size affects normalization.
        self.WORLD_LIMIT = float(np.max(np.abs([geometry.minimum, geometry.maximum])))
        super().__init__()
        self.position = np.asarray(position, dtype=np.float32)
        self.yaw = float(yaw)
        self.target = np.asarray(target, dtype=np.float32)
        if self._collision_for_pose(self.position, self.yaw):
            raise ValueError("Leaper start intersects the junkyard; reset its position")
        self.prev_distance = self.best_distance = self._distance()
        self._reset_coverage()
        self._update_target_memory(increment_time=False)
        self._update_coverage()

    @classmethod
    def physical_throttle(cls, action_throttle):
        # This checkpoint was trained with negative throttle = reverse.
        return float(action_throttle)

    def _collision_for_pose(self, position, yaw):
        for point, radius, part in self._collision_points(position, yaw):
            if self.geometry.disk_blocked(point, radius):
                return part
        return None

    def _ray_distances(self, position, yaw):
        angles = yaw + self._ray_relative_angles()
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        return (self.geometry.ray_distances(position, directions, self.RAY_MAX_RANGE) / self.RAY_MAX_RANGE).astype(np.float32)

    def _points_visible(self, points):
        return self.geometry.points_visible(self.position, self.yaw, points,
            self.VISION_FOV, self.RAY_MAX_RANGE, self.TARGET_RADIUS)

    def _target_sensor(self):
        delta = self.target - self.position
        return bool(self._points_visible([self.target])[0]), float(np.arctan2(delta[0], delta[1]))

    def _reset_coverage(self):
        super()._reset_coverage()
        # The exported yard is rectangular; don't search outside its boundary.
        points = self._coverage_centers_flat
        self.coverage_cleared[:] = np.any((points < self.geometry.minimum) | (points >= self.geometry.maximum), axis=1)

    def initial_observation(self):
        return np.concatenate((self._observation(), np.zeros(3, dtype=np.float32)))

    def step(self, action):
        result = super().step(action)
        # Interactive inference continues until Stop Run, including after catches,
        # training timeouts, or contact. No learning, resets, or action overrides.
        # Keep only the last pose; training trajectory logging is not needed here.
        self.trajectory = self.trajectory[-1:]
        return result
