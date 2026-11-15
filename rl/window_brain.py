"""Sliding-window memory (owner-requested round 1 experiment, 2026-11-15).

Today's brain carries its LSTM memory from step to step for the whole round.
Here the memory never carries over: at every step the LSTM starts blank and
reads only the last ``window`` observations (128 = 12.8 s); anything older is
dropped. So the model is an ordinary (non-recurrent) policy whose input is the
window, and training uses standard PPO with today's settings.

- ``WindowVecEnv`` keeps each environment's window: the round's own steps,
  oldest first, zeros after them, and the number of real steps as the last
  value (a round's first steps are never padded with fake history).
- ``WindowLstmPolicy``: today's architecture (plain 64-64 Tanh path on the
  current observation + LSTM 64 -> Linear 64, added), the LSTM run over the
  window with packed sequences. Optionally the merge layer of
  rl/round1_brain.py.
- ``make_window_copy``: today's weights and Adam moments mapped by name (new
  input columns zero). Measured 2026-11-15: today's brain run this way with a
  128-step window moves like itself (median action difference 4e-5).
- ``WindowModel``: wraps a trained model for step-by-step play (exams).
"""
from __future__ import annotations

import numpy as np
import torch
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.policies import ActorCriticPolicy
from stable_baselines3.common.torch_layers import MlpExtractor
from stable_baselines3.common.vec_env import VecEnvWrapper
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence

from rl.moving_target_brain import FROZEN, HYPER, SEED, ContinuedRate, _widen
from rl.round1_brain import _merge
from rl.seeker_recurrent_policy import _zero_projection

WINDOW = 128


def window_space(n_inputs, window):
    return spaces.Box(-np.inf, np.inf, (window * n_inputs + 1,), dtype=np.float32)


class WindowVecEnv(VecEnvWrapper):
    def __init__(self, venv, window=WINDOW):
        self.window = window
        self.n_inputs = venv.observation_space.shape[0]
        super().__init__(venv, observation_space=window_space(self.n_inputs, window))
        self.buffer = np.zeros((venv.num_envs, window, self.n_inputs), dtype=np.float32)
        self.length = np.zeros(venv.num_envs, dtype=np.int64)

    def _push(self, index, obs):
        if self.length[index] < self.window:
            self.buffer[index, self.length[index]] = obs
            self.length[index] += 1
        else:
            self.buffer[index, :-1] = self.buffer[index, 1:]
            self.buffer[index, -1] = obs

    def _pack(self, index):
        return np.concatenate((self.buffer[index].ravel(), [self.length[index]])).astype(np.float32)

    def reset(self):
        obs = self.venv.reset()
        self.buffer[:] = 0
        self.length[:] = 0
        for i in range(self.num_envs):
            self._push(i, obs[i])
        return np.stack([self._pack(i) for i in range(self.num_envs)])

    def step_wait(self):
        obs, rewards, dones, infos = self.venv.step_wait()
        out = []
        for i in range(self.num_envs):
            if dones[i]:
                # The finished round's window ends with its terminal observation.
                self._push(i, infos[i]["terminal_observation"])
                infos[i]["terminal_observation"] = self._pack(i)
                self.buffer[i] = 0
                self.length[i] = 0
            self._push(i, obs[i])
            out.append(self._pack(i))
        return np.stack(out), rewards, dones, infos


class WindowLstmPolicy(ActorCriticPolicy):
    def __init__(self, observation_space, action_space, lr_schedule, n_inputs=34, window=WINDOW,
                 fusion=False, **kwargs):
        self.n_inputs, self.window, self.fusion = n_inputs, window, fusion
        kwargs.update(net_arch=dict(pi=[64, 64], vf=[64, 64]), activation_fn=nn.Tanh)
        super().__init__(observation_space, action_space, lr_schedule, **kwargs)
        self.lstm_actor = nn.LSTM(n_inputs, 64, batch_first=True)
        self.lstm_critic = nn.LSTM(n_inputs, 64, batch_first=True)
        self.residual_actor = _zero_projection(nn.Linear(64, 64))
        self.residual_critic = _zero_projection(nn.Linear(64, 64))
        if fusion:
            self.merge_actor = _merge()
            self.merge_critic = _merge()
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)

    def _get_constructor_parameters(self):
        data = super()._get_constructor_parameters()
        data.update(n_inputs=self.n_inputs, window=self.window, fusion=self.fusion)
        return data

    def _build_mlp_extractor(self):
        self.mlp_extractor = MlpExtractor(self.n_inputs, self.net_arch, self.activation_fn, device=self.device)

    def _split(self, obs):
        obs = obs.float()
        length = obs[:, -1].long().clamp(1, self.window)
        frames = obs[:, :-1].reshape(-1, self.window, self.n_inputs)
        current = frames[torch.arange(len(frames)), length - 1]
        return frames, length, current

    def _memory(self, lstm, frames, length):
        packed = pack_padded_sequence(frames, length.cpu(), batch_first=True, enforce_sorted=False)
        _, (h, _) = lstm(packed)
        return h[-1]

    def _latents(self, obs, critic=True, actor=True):
        frames, length, current = self._split(obs)
        out = []
        for want, lstm, mlp, residual, merge in (
                (actor, self.lstm_actor, self.mlp_extractor.forward_actor, self.residual_actor, "merge_actor"),
                (critic, self.lstm_critic, self.mlp_extractor.forward_critic, self.residual_critic, "merge_critic")):
            if not want:
                out.append(None)
                continue
            memory = self._memory(lstm, frames, length)
            plain = mlp(current)
            latent = plain + residual(memory)
            if self.fusion:
                latent = latent + getattr(self, merge)(torch.cat((plain, memory), dim=1))
            out.append(latent)
        return out

    def forward(self, obs, deterministic=False):
        latent_pi, latent_vf = self._latents(obs)
        distribution = self._get_action_dist_from_latent(latent_pi)
        actions = distribution.get_actions(deterministic=deterministic)
        log_prob = distribution.log_prob(actions)
        return actions.reshape((-1, *self.action_space.shape)), self.value_net(latent_vf), log_prob

    def evaluate_actions(self, obs, actions):
        latent_pi, latent_vf = self._latents(obs)
        distribution = self._get_action_dist_from_latent(latent_pi)
        return self.value_net(latent_vf), distribution.log_prob(actions), distribution.entropy()

    def get_distribution(self, obs):
        latent_pi, _ = self._latents(obs, critic=False)
        return self._get_action_dist_from_latent(latent_pi)

    def predict_values(self, obs):
        _, latent_vf = self._latents(obs, actor=False)
        return self.value_net(latent_vf)


def _today_parameter_names():
    """Today's brain's parameter names, in its optimizer's order."""
    from rl.moving_target_brain import load_frozen_predictor
    from rl.moving_target_env import MovingTargetEnv
    return [n for n, _ in load_frozen_predictor(lambda: MovingTargetEnv()).policy.named_parameters()]


def make_window_copy(env, n_inputs, total_steps, fusion=False, window=WINDOW, seed=SEED):
    model = PPO(WindowLstmPolicy, env, learning_rate=ContinuedRate(total_steps), seed=seed, device="cpu",
                policy_kwargs=dict(n_inputs=n_inputs, window=window, fusion=fusion), **HYPER)
    saved = torch.load(FROZEN / "policy.pth", map_location="cpu", weights_only=False)
    state = model.policy.state_dict()
    missing = [k for k in saved if k not in state]
    if missing:
        raise RuntimeError(f"Window policy lacks today's layers: {missing}")
    new = sorted(set(state) - set(saved))
    if any(not k.startswith(("merge_actor.", "merge_critic.")) for k in new):
        raise RuntimeError(f"Unexpected new layers: {new}")
    model.policy.load_state_dict({k: (_widen(saved[k], state[k].shape) if k in saved else state[k])
                                  for k in state})
    optim = torch.load(FROZEN / "policy.optimizer.pth", map_location="cpu", weights_only=False)
    by_name = dict(zip(_today_parameter_names(), (optim["state"][i] for i in range(len(optim["state"])))))
    fresh = model.policy.optimizer.state_dict()
    fresh["state"] = {}
    for index, (name, param) in enumerate(model.policy.named_parameters()):
        if name in by_name:
            entry = dict(by_name[name])
            for key in ("exp_avg", "exp_avg_sq"):
                entry[key] = _widen(entry[key], param.shape)
            fresh["state"][index] = entry
    fresh["param_groups"][0].update({k: v for k, v in optim["param_groups"][0].items() if k != "params"})
    fresh["param_groups"][0]["lr"] = ContinuedRate(total_steps)(1.0)
    model.policy.optimizer.load_state_dict(fresh)
    model.set_random_seed(seed)
    return model


class WindowModel:
    """Step-by-step play for exams: keeps the window, like WindowVecEnv."""

    def __init__(self, model):
        self.model = model
        self.policy = model.policy
        self.window = model.policy.window
        self.n_inputs = model.policy.n_inputs

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        obs = np.asarray(obs, dtype=np.float32).reshape(-1)
        if state is None or (episode_start is not None and bool(np.asarray(episode_start).ravel()[0])):
            state = (np.zeros((self.window, self.n_inputs), dtype=np.float32), 0)
        frames, length = state
        frames = frames.copy()
        if length < self.window:
            frames[length] = obs
            length += 1
        else:
            frames[:-1] = frames[1:]
            frames[-1] = obs
        packed = np.concatenate((frames.ravel(), [length])).astype(np.float32)
        action, _ = self.model.predict(packed, deterministic=deterministic)
        return action, (frames, length)


def load_window(path):
    return WindowModel(PPO.load(str(path), device="cpu",
                                custom_objects=dict(learning_rate=0.0, lr_schedule=lambda _: 0.0)))


class WindowedRecurrent:
    """Play a trained carried-memory brain (rl/round1_brain.py) in sliding-window mode.

    Every step its LSTM starts blank and reads only the last ``window``
    observations; the plain path reads the current one. For the exam
    "does a 128-step window cost anything?" without window training.
    """

    def __init__(self, model, window=WINDOW):
        self.model = model
        self.policy = model.policy
        self.window = window

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        obs = np.asarray(obs, dtype=np.float32).reshape(-1)
        if state is None or (episode_start is not None and bool(np.asarray(episode_start).ravel()[0])):
            state = np.zeros((0, len(obs)), dtype=np.float32)
        frames = np.concatenate((state, obs[None]))[-self.window:]
        p = self.policy
        with torch.no_grad():
            x = torch.as_tensor(frames)[:, None, :]                  # (steps, 1, inputs)
            memory = p.lstm_actor(x)[0][-1]                         # blank start, last output
            current = x[-1]
            plain = p.mlp_extractor.forward_actor(current)
            latent = plain + p.residual_actor(memory)
            if hasattr(p, "merge_actor"):
                latent = latent + p.merge_actor(torch.cat((plain, memory), dim=1))
            action = p.action_net(latent).numpy()[0]
        return np.clip(action, -1, 1), frames
