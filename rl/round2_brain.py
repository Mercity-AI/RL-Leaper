"""Round 2 branches: continue a round-1 checkpoint with new scoring or a privileged critic.

``PrivilegedLstmPolicy`` (B1, plan section 5): the environment appends 4
critic-only numbers (rl/round1_env.py ``privileged``). The actor path (plain
network, LSTM, residual, optional merge layer, action head) reads only the first
``n_actor`` inputs; the critic path reads all of them. The exported actor is
unchanged in size, so the game would never see the extra numbers.

``make_branch``: build any round-1/round-2 policy on new environments and copy
a checkpoint's weights and Adam moments into it by name (new input columns at
zero, new layers fresh), keeping its step count, so training continues on the
same learning-rate line.
"""
from __future__ import annotations

import torch
from stable_baselines3.common.save_util import load_from_zip_file
from torch import nn

from rl.moving_target_brain import HYPER, ContinuedRate, _widen
from rl.round1_brain import FusionLstmPolicy, ResidualLstmPolicyN
from rl.round1_env import PRIVILEGED
from rl.seeker_recurrent_train import FixedContextRecurrentPPO


class _PrivilegedParts:
    """Mixed in front of ResidualLstmPolicyN / FusionLstmPolicy."""

    def _add_parts(self):
        super()._add_parts()
        self.n_actor = self.observation_space.shape[0] - PRIVILEGED
        # Actor-side layers read only the first n_actor inputs.
        self.lstm_actor = nn.LSTM(self.n_actor, 64)
        self.mlp_extractor.policy_net = nn.Sequential(nn.Linear(self.n_actor, 64), nn.Tanh(),
                                                      nn.Linear(64, 64), nn.Tanh())

    def _actor_latent(self, features, states, episode_starts):
        return super()._actor_latent(features[:, :self.n_actor], states, episode_starts)


class PrivilegedLstmPolicy(_PrivilegedParts, ResidualLstmPolicyN):
    pass


class PrivilegedFusionPolicy(_PrivilegedParts, FusionLstmPolicy):
    pass


def policy_class(fusion, privileged):
    if privileged:
        return PrivilegedFusionPolicy if fusion else PrivilegedLstmPolicy
    return FusionLstmPolicy if fusion else ResidualLstmPolicyN


def load_source(path):
    """A checkpoint's policy weights (in parameter order), Adam state and step count."""
    data, params, _ = load_from_zip_file(str(path), device="cpu")
    return params["policy"], params["policy.optimizer"], int(data["num_timesteps"])


def make_branch(env, source, fusion, privileged, total, seed):
    saved, optim, steps = load_source(source)
    rate = ContinuedRate(total)
    model = FixedContextRecurrentPPO(policy_class(fusion, privileged), env, learning_rate=rate,
                                     policy_kwargs=dict(net_arch=[64, 64]), seed=seed, device="cpu", **HYPER)
    state = model.policy.state_dict()
    missing = [k for k in saved if k not in state]
    if missing:
        raise RuntimeError(f"Branch lacks the checkpoint's layers: {missing}")
    model.policy.load_state_dict({k: (_widen(saved[k], state[k].shape) if k in saved else state[k]) for k in state})
    # Adam moments by name: the checkpoint's state-dict order is its parameter order.
    by_name = dict(zip(saved.keys(), (optim["state"][i] for i in range(len(optim["state"])))))
    fresh = model.policy.optimizer.state_dict()
    fresh["state"] = {}
    for index, (name, param) in enumerate(model.policy.named_parameters()):
        if name in by_name:
            entry = dict(by_name[name])
            for key in ("exp_avg", "exp_avg_sq"):
                entry[key] = _widen(entry[key], param.shape)
            fresh["state"][index] = entry
    fresh["param_groups"][0].update({k: v for k, v in optim["param_groups"][0].items() if k != "params"})
    model.policy.optimizer.load_state_dict(fresh)
    model.num_timesteps = steps
    for group in model.policy.optimizer.param_groups:
        group["lr"] = rate(1 - steps / total)
    model.set_random_seed(seed + 2000)
    return model, steps
