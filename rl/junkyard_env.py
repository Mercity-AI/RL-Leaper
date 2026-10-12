"""Evaluation-only adapter for the frozen 7,757,824-step seeker recipe."""
import json
from pathlib import Path

import numpy as np

from rl.seeker_env import SeekerEnv

PLAYER_CONTACT = json.loads((Path(__file__).resolve().parents[1] / "src/config/player-contact.json").read_text())
EYE_VISION = json.loads((Path(__file__).resolve().parents[1] / "src/config/eye-vision.json").read_text())


class JunkyardEnv(SeekerEnv):
    def __init__(self, geometry, position, yaw, target, player_collision=False, sight=None, sight_pose=None):
        self.geometry = geometry
        self.sight = sight
        self.sight_pose = sight_pose
        self.sight_debug = None
        self.player_collision = False
        # Keep distances in original robot units; map size affects normalization.
        self.WORLD_LIMIT = float(np.max(np.abs([geometry.minimum, geometry.maximum])))
        super().__init__()
        self.position = np.asarray(position, dtype=np.float32)
        self.yaw = float(yaw)
        self.target = np.asarray(target, dtype=np.float32)
        self.player_collision = player_collision
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
        if self.player_collision:
            # Conservative full leg envelope; jumping does not bypass contact.
            radius = PLAYER_CONTACT["leaperRadius"] + PLAYER_CONTACT["playerRadius"] * self.geometry.scale
            start = self.position
            delta = np.asarray(position) - start
            length = float(delta @ delta)
            t = np.clip(float((self.target - start) @ delta) / length, 0, 1) if length else 0
            if np.linalg.norm(self.target - start - delta * t) < radius:
                return "player"
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
        if self.sight is not None and self.sight_pose is not None:
            bearing = float(np.arctan2(delta[0], delta[1]))
            relative = (bearing - self.yaw + np.pi) % (2 * np.pi) - np.pi
            in_view = (abs(relative) <= self.VISION_FOV / 2
                       and np.linalg.norm(delta) - self.TARGET_RADIUS <= self.RAY_MAX_RANGE)
            offset = self.sight_pose['eye']
            c, s = np.cos(self.yaw), np.sin(self.yaw)
            origin = np.array([self.position[0] + offset[0]*c + offset[2]*s,
                               offset[1], self.position[1] - offset[0]*s + offset[2]*c])
            points = np.asarray(self.sight_pose['points'])
            hits = [self.sight.hit(origin, point) for point in points]
            clear = [bool(in_view and hit is None) for hit in hits]
            self.sight_debug = dict(origin=origin.tolist(), points=points.tolist(), hits=hits,
                                   clear=clear, in_view=bool(in_view))
            return any(clear), bearing
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
