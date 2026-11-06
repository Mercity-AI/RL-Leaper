"""Copies of today's brain (7,757,824 steps) for runs A and D, and their trainer.

Run A: today's brain whole (34 inputs), weights and optimizer moments.
Run D: the same copy with 3 more inputs (37): every layer that reads the inputs
(the plain part's first layers and both LSTMs' input weights, 1,920 numbers)
gets 3 new columns set to zero, so on day one it plays exactly like run A. The
optimizer moments for those columns start at zero too.

The frozen files (model_7757824/, rl/frozen_7757824/) are only read.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from gymnasium import spaces
from stable_baselines3.common.vec_env import DummyVecEnv
from sb3_contrib.common.recurrent.policies import RecurrentActorCriticPolicy

from rl.seeker_recurrent_policy import ResidualLstmPolicy, _fixed_options, _zero_projection
from rl.seeker_recurrent_train import FixedContextRecurrentPPO

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT / "model_7757824"
FROZEN_STEPS = 7_757_824
# Today's brain's run: linear 0.00015 -> 0.00003 over 10,002,432 steps, held after.
LR_START, LR_FLOOR, LR_HORIZON = 0.00015, 0.00003, 10_002_432
SEED = 145032261           # the run's own seed (reverse_urgency_config/config.json)
HYPER = dict(n_steps=512, batch_size=256, n_epochs=10, gamma=0.995, gae_lambda=0.95,
             ent_coef=0.01, vf_coef=0.5, max_grad_norm=0.5, clip_range=0.2)
N_ENVS = 16


class ContinuedRate:
    """The run's own learning-rate line, continued from step 7,757,824."""

    def __init__(self, total):
        self.total = total

    def __call__(self, progress_remaining):
        step = FROZEN_STEPS + (1.0 - progress_remaining) * self.total
        return LR_FLOOR + (LR_START - LR_FLOOR) * max(0.0, 1.0 - step / LR_HORIZON)


class ResidualLstmPolicy37(ResidualLstmPolicy):
    """Today's architecture unchanged, reading 37 inputs instead of 34."""

    def __init__(self, observation_space, action_space, lr_schedule, **kwargs):
        if observation_space.shape != (37,):
            raise ValueError("ResidualLstmPolicy37 reads exactly 37 inputs")
        kwargs = _fixed_options(spaces.Box(-1, 1, (34,), np.float32), action_space, kwargs)
        for key, expected in (("lstm_hidden_size", 64), ("n_lstm_layers", 1),
                              ("shared_lstm", False), ("enable_critic_lstm", True)):
            if kwargs.pop(key, expected) != expected:
                raise ValueError(f"{key} must be {expected!r}")
            kwargs[key] = expected
        RecurrentActorCriticPolicy.__init__(self, observation_space, action_space, lr_schedule, **kwargs)
        self.residual_actor = _zero_projection(torch.nn.Linear(64, 64))
        self.residual_critic = _zero_projection(torch.nn.Linear(64, 64))
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)


def _widen(tensor, shape):
    """Pad the last axis with zeros (the 3 new input columns)."""
    if tuple(tensor.shape) == tuple(shape):
        return tensor.clone()
    if tensor.shape[:-1] != shape[:-1] or tensor.shape[-1] > shape[-1]:
        raise ValueError(f"cannot widen {tuple(tensor.shape)} to {tuple(shape)}")
    out = torch.zeros(shape, dtype=tensor.dtype)
    out[..., :tensor.shape[-1]] = tensor
    return out


def make_copy(env_fns, new_inputs, total_steps, seed=SEED):
    """A trainable copy of today's brain on these environments."""
    env = DummyVecEnv(env_fns)
    policy = ResidualLstmPolicy37 if new_inputs else ResidualLstmPolicy
    model = FixedContextRecurrentPPO(policy, env, learning_rate=ContinuedRate(total_steps),
                                     policy_kwargs=dict(net_arch=[64, 64]), seed=seed,
                                     device="cpu", **HYPER)
    saved = torch.load(FROZEN / "policy.pth", map_location="cpu", weights_only=False)
    state = model.policy.state_dict()
    if set(saved) != set(state):
        raise RuntimeError("Saved brain and copy have different layers")
    model.policy.load_state_dict({k: _widen(saved[k], state[k].shape) for k in state})
    # Adam moments, in the same parameter order; widened like the weights.
    optim = torch.load(FROZEN / "policy.optimizer.pth", map_location="cpu", weights_only=False)
    params = list(model.policy.parameters())
    if len(optim["state"]) != len(params):
        raise RuntimeError("Optimizer state does not match the copy's parameters")
    for index, param in enumerate(params):
        entry = optim["state"][index]
        for key in ("exp_avg", "exp_avg_sq"):
            entry[key] = _widen(entry[key], param.shape)
    group = optim["param_groups"][0]
    group["lr"] = ContinuedRate(total_steps)(1.0)
    model.policy.optimizer.load_state_dict(optim)
    model.set_random_seed(seed)
    return model


def load_frozen_predictor(env_fn):
    """Today's brain itself, for exams only (never trained)."""
    return FixedContextRecurrentPPO.load(str(ROOT / "model_7757824.zip"), env=DummyVecEnv([env_fn]),
                                         device="cpu",
                                         custom_objects=dict(learning_rate=0.0, lr_schedule=lambda _: 0.0))
