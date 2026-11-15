"""Copies of today's brain for round 1, with any number of inputs and an optional merge layer.

``ResidualLstmPolicyN``: today's architecture reading N inputs (34 + new ones).
New input columns start at zero (like run D's ``_widen``), so on step 1 a copy
plays exactly like today's brain.

``FusionLstmPolicy`` (the owner-requested "merge" experiment): today's two paths
(plain 34->64->64 Tanh network, LSTM 64 -> Linear 64) and their sum are kept, and
a merge layer reads both side by side and adds its output on top:

    latent = plain + Linear(lstm) + Merge([plain, lstm])
    Merge  = Linear(128 -> 64), Tanh, Linear(64 -> 64) (last layer starts at zero)

So the copy starts as today's brain and the merge layer can learn nonlinear
mixes of "now" and "memory". Separate merge layers for the actor and critic.
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn
from gymnasium import spaces
from stable_baselines3.common.vec_env import DummyVecEnv
from sb3_contrib.common.recurrent.policies import RecurrentActorCriticPolicy

from rl.moving_target_brain import FROZEN, HYPER, SEED, ContinuedRate, _widen
from rl.seeker_recurrent_policy import ResidualLstmPolicy, _fixed_options, _zero_projection
from rl.seeker_recurrent_train import FixedContextRecurrentPPO


class ResidualLstmPolicyN(ResidualLstmPolicy):
    """Today's architecture unchanged, reading any number of inputs."""

    def __init__(self, observation_space, action_space, lr_schedule, **kwargs):
        kwargs = _fixed_options(spaces.Box(-1, 1, (34,), np.float32), action_space, kwargs)
        for key, expected in (("lstm_hidden_size", 64), ("n_lstm_layers", 1),
                              ("shared_lstm", False), ("enable_critic_lstm", True)):
            if kwargs.pop(key, expected) != expected:
                raise ValueError(f"{key} must be {expected!r}")
            kwargs[key] = expected
        RecurrentActorCriticPolicy.__init__(self, observation_space, action_space, lr_schedule, **kwargs)
        self.residual_actor = _zero_projection(nn.Linear(64, 64))
        self.residual_critic = _zero_projection(nn.Linear(64, 64))
        self._add_parts()
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)

    def _add_parts(self):
        pass


def _merge():
    return nn.Sequential(nn.Linear(128, 64), nn.Tanh(), _zero_projection(nn.Linear(64, 64)))


class FusionLstmPolicy(ResidualLstmPolicyN):
    def _add_parts(self):
        self.merge_actor = _merge()
        self.merge_critic = _merge()

    def _actor_latent(self, features, states, episode_starts):
        memory, states = self._process_sequence(features, states, episode_starts, self.lstm_actor)
        plain = self.mlp_extractor.forward_actor(features)
        return plain + self.residual_actor(memory) + self.merge_actor(torch.cat((plain, memory), dim=1)), states

    def _critic_latent(self, features, states, episode_starts):
        memory, states = self._process_sequence(features, states, episode_starts, self.lstm_critic)
        plain = self.mlp_extractor.forward_critic(features)
        return plain + self.residual_critic(memory) + self.merge_critic(torch.cat((plain, memory), dim=1)), states


def make_round1_copy(env, fusion, total_steps, seed=SEED):
    """A trainable copy of today's brain on a VecEnv: weights, and optimizer moments
    for every weight today's brain has (new weights start with fresh moments)."""
    policy = FusionLstmPolicy if fusion else ResidualLstmPolicyN
    model = FixedContextRecurrentPPO(policy, env, learning_rate=ContinuedRate(total_steps),
                                     policy_kwargs=dict(net_arch=[64, 64]), seed=seed,
                                     device="cpu", **HYPER)
    saved = torch.load(FROZEN / "policy.pth", map_location="cpu", weights_only=False)
    state = model.policy.state_dict()
    if not set(saved) <= set(state):
        raise RuntimeError("Saved brain has layers the copy lacks")
    new = sorted(set(state) - set(saved))
    if fusion and not all(k.startswith(("merge_actor.", "merge_critic.")) for k in new):
        raise RuntimeError(f"Unexpected new layers: {new}")
    if not fusion and new:
        raise RuntimeError(f"Unexpected new layers: {new}")
    merged = {k: (_widen(saved[k], state[k].shape) if k in saved else state[k]) for k in state}
    model.policy.load_state_dict(merged)
    # Adam moments: today's parameters come first, in the same order.
    optim = torch.load(FROZEN / "policy.optimizer.pth", map_location="cpu", weights_only=False)
    params = list(model.policy.parameters())
    names = [n for n, _ in model.policy.named_parameters()]
    old = len(optim["state"])
    if any(n.startswith("merge_") for n in names[:old]) or (not fusion and old != len(params)):
        raise RuntimeError("Optimizer state does not line up with the copy's parameters")
    for index in range(old):
        entry = optim["state"][index]
        for key in ("exp_avg", "exp_avg_sq"):
            entry[key] = _widen(entry[key], params[index].shape)
    fresh = model.policy.optimizer.state_dict()
    fresh["state"] = {i: optim["state"][i] for i in range(old)}
    fresh["param_groups"][0].update({k: v for k, v in optim["param_groups"][0].items() if k != "params"})
    fresh["param_groups"][0]["lr"] = ContinuedRate(total_steps)(1.0)
    model.policy.optimizer.load_state_dict(fresh)
    model.set_random_seed(seed)
    return model


def load_round1(path, env_fn):
    """A saved round-1 model, for exams (never trained further here)."""
    return FixedContextRecurrentPPO.load(str(path), env=DummyVecEnv([env_fn]), device="cpu",
                                         custom_objects=dict(learning_rate=0.0, lr_schedule=lambda _: 0.0))
