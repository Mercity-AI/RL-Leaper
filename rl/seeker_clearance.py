"""Optional sensory follow-up, tested after the reward comparisons.

This is a stronger, hypothetical multi-origin physical proximity sensor, NOT a
reconstruction of the existing thin rays. Each of the 19 footprint circles sweeps
along each of the existing 16 directions in the robot-facing 270-degree cone.
The nearest obstacle/wall contact over those sweeps is reported, capped at six
units. Circle inflation gives finite-width sensing, including sightlines from
rear-leg origins; it does not claim body-centre line-of-sight equivalence.

All obstacle circles participate, as in the current geometric range sensors;
only the nearest inflated surface along each swept path contributes. This is
explicitly stronger information than the current body-centre thin-ray readings.
Targets, coverage,
history and policy actions are not sensor inputs. No map is passed to the policy.
These are FIXED-YAW translation clearances, not safe-turn or action guarantees.
The underlying endpoint-based physics, rewards and target hiding are unchanged.
"""
import numpy as np
from gymnasium import spaces

from rl.seeker_env import SeekerEnv


class FootprintSeekerEnv(SeekerEnv):
    """Optional 50-input branch: unchanged 34 channels followed by 16 clearances."""

    CLEARANCE_RANGE = 6.0

    def __init__(self, variant="control", metrics=False):
        super().__init__(variant=variant, metrics=metrics)
        self.observation_space = spaces.Box(
            low=np.concatenate((self.observation_space.low, np.zeros(16, dtype=np.float32))),
            high=np.ones(50, dtype=np.float32),
            dtype=np.float32,
        )

    def _clearance_distances(self, directions):
        """First contact in world units for unit world-space directions (N, 2).

        Inflate each obstacle by each footprint circle radius, intersect the
        resulting rays analytically, and also intersect radius-adjusted walls.
        Any initial footprint contact/overlap conservatively returns all zeros.
        Float64 arithmetic avoids cancellation near a surface; no state is saved.
        """
        footprint = list(self._collision_points(self.position, self.yaw))
        points = np.asarray([p for p, _, _ in footprint], dtype=np.float64)
        radii = np.asarray([r for _, r, _ in footprint], dtype=np.float64)
        directions = np.asarray(directions, dtype=np.float64)
        limits = self.WORLD_LIMIT - radii
        if np.any(np.abs(points) >= limits[:, None]):
            return np.zeros(len(directions), dtype=np.float64)

        # (footprint point, direction, coordinate): distance to the wall ahead.
        numerator = (np.sign(directions)[None, :, :] * limits[:, None, None]
                     - points[:, None, :])
        wall_hits = np.full(numerator.shape, np.inf)
        np.divide(numerator, directions[None, :, :], out=wall_hits,
                  where=np.abs(directions[None, :, :]) > 1e-12)
        nearest = np.minimum(self.CLEARANCE_RANGE, wall_hits.min(axis=(0, 2)))

        if self.obstacles:
            obstacles = np.asarray(self.obstacles, dtype=np.float64)
            delta = obstacles[None, :, :2] - points[:, None, :]
            inflated = obstacles[None, :, 2] + radii[:, None]
            c = np.sum(delta * delta, axis=2) - inflated * inflated
            if np.any(c <= 0.0):
                return np.zeros(len(directions), dtype=np.float64)
            # b and discriminant: (footprint point, obstacle, direction).
            b = np.einsum("poc,dc->pod", delta, directions)
            discriminant = b * b - c[:, :, None]
            hits = b - np.sqrt(np.maximum(discriminant, 0.0))
            hits = np.where((discriminant >= 0.0) & (hits >= 0.0), hits, np.inf)
            nearest = np.minimum(nearest, hits.min(axis=(0, 1)))
        return np.clip(nearest, 0.0, self.CLEARANCE_RANGE)

    def footprint_clearance(self):
        """Six-unit normalized clearance at the existing 16 ray angles."""
        angles = self.yaw + self._ray_relative_angles()
        directions = np.stack((np.sin(angles), np.cos(angles)), axis=1)
        return (self._clearance_distances(directions) / self.CLEARANCE_RANGE).astype(np.float32)

    def reset(self, **kwargs):
        # Do not override _observation: the inherited chain must still return 34.
        obs, info = super().reset(**kwargs)
        return np.concatenate((obs, self.footprint_clearance())), info

    def step(self, action):
        obs, reward, terminated, truncated, info = super().step(action)
        return (np.concatenate((obs, self.footprint_clearance())),
                reward, terminated, truncated, info)
