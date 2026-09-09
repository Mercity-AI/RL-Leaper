"""Independent proprioceptive-memory experiment, enabled explicitly by the runner.

Append elapsed stall fractions to the unchanged 34-input SeekerEnv. These are
maintained self-motion memories computable from collision feedback and realized
translation alone, not target information: stuck counts consecutive colliding
steps with translation <= 1e-3; freeze counts every step with translation <= 1e-3,
including rotation in place. Actual movement resets both inherited counters.

This exposes existing terminal-risk state without changing the counters, their
thresholds, rewards, physics, vision, target memory or actions. It is independent
of the optional footprint-sensor branch.
"""
import numpy as np
from gymnasium import spaces

from rl.seeker_env import SeekerEnv


class StallMemorySeekerEnv(SeekerEnv):
    """36 inputs: old channels 0..33, stuck fraction 34, freeze fraction 35."""

    def __init__(self, variant="control", metrics=False):
        super().__init__(variant=variant, metrics=metrics)
        self.observation_space = spaces.Box(
            low=np.concatenate((self.observation_space.low, np.zeros(2, dtype=np.float32))),
            high=np.ones(36, dtype=np.float32), dtype=np.float32,
        )

    def stall_memory(self):
        """Current inherited counters normalized by their terminal thresholds."""
        return np.clip([self.stuck_steps / self.STUCK_LIMIT,
                        self.freeze_steps / self.FREEZE_LIMIT], 0., 1.).astype(np.float32)

    def reset(self, **kwargs):
        obs, info = super().reset(**kwargs)
        return np.concatenate((obs, self.stall_memory())), info

    def step(self, action):
        obs, reward, terminated, truncated, info = super().step(action)
        return (np.concatenate((obs, self.stall_memory())),
                reward, terminated, truncated, info)
