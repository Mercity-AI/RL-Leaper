"""Isolated 34-input seeker experiments, preserving the production environment."""
import math
import numpy as np
from gymnasium import spaces
from rl_environment import LeaperReachEnv


class SeekerEnv(LeaperReachEnv):
    NORMALIZED_THROTTLE = True
    FRONTIER_NOTE = True
    COVERAGE_MAP = False

    def __init__(self, variant="control", metrics=False):
        self.variant = variant
        super().__init__()
        self.observation_space = spaces.Box(-1, 1, (34,), dtype=np.float32)
        self.metrics = None
        if metrics:
            from rl.seeker_metrics import EpisodeMetrics
            self.metrics = EpisodeMetrics()
        if variant in ("visibility", "removal", "icm"):
            self.EXPLORATION_REWARD = 0.0
            self.NEW_VIEW_REWARD = 0.0
        if variant == "no_hidden_progress":
            self.BEST_PROGRESS_SCALE = 0.0

    def reset(self, **kwargs):
        obs, info = super().reset(**kwargs)
        obs = np.concatenate((obs, np.zeros(3, dtype=np.float32)))
        if self.metrics:
            self.metrics.reset(self, obs, info)
        return obs, info

    def step(self, action):
        position, yaw = self.position.copy(), self.yaw
        obs, reward, terminated, truncated, info = super().step(action)
        delta = (self.position - position) / self.MOVE_SPEED
        turn = ((self.yaw-yaw+math.pi) % (2*math.pi)-math.pi) / self.TURN_SPEED
        obs = np.concatenate((obs, np.clip([*delta, turn], -1, 1).astype(np.float32)))
        visible_bonus = 0.0
        if self.variant == "visibility" and not self.target_ever_seen:
            visible_bonus = len(self.coverage_new_cells) / self.coverage_cleared.size
            reward += visible_bonus
            info["reward_terms"]["exploration"] += visible_bonus
        info["visibility_bonus"] = visible_bonus
        info["extrinsic_reward"] = reward
        if self.metrics:
            row = self.metrics.step(self, action, reward, terminated, truncated, info)
            if row is not None:
                info["research_episode"] = row
        return obs, reward, terminated, truncated, info
