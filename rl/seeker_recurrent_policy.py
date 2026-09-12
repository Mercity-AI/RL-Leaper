"""Scratch-initialized residual policy sidecars for the 34-input seeker.

No donor loading, environment changes, sampler, burn-in, or trainer lives here.
The base is a separate 34->64 Tanh->64 Tanh actor/critic MLP with ordinary SB3
Gaussian action/value heads. Independent memory/capacity branches add to those
64-dimensional latents through a zero-initialized final linear projection.

ResidualLstmPolicy: separate 34->LSTM(64, one layer)->Linear(64,64) branches.
ResidualMlpPolicy: separate 34->128 Tanh->112 Tanh->64 Tanh->Linear(64,64) branches.
Counts with two Gaussian actions: 72,517 and 73,637 respectively.

Recurrent batches follow installed SB3's sequence-major flattened convention:
all timesteps of sequence 0, then sequence 1, etc. RNNStates carry independent
actor/critic (h,c); episode_starts resets each worker, never target detection.
The parent trainer owns fixed chunks, burn-in/detachment, padding masks, and
terminal-observation bootstrapping. Standard PyTorch initialization is used for
new branches except the zero projections; all base/branch weights are trainable.
"""
from gymnasium import spaces
import torch
from torch import nn
from stable_baselines3.common.policies import ActorCriticPolicy, BasePolicy
from stable_baselines3.common.torch_layers import FlattenExtractor, MlpExtractor
from sb3_contrib.common.recurrent.policies import RecurrentActorCriticPolicy
from sb3_contrib.common.recurrent.type_aliases import RNNStates


def _fixed_options(observation_space, action_space, kwargs):
    """Reject accidental architecture changes rather than silently ignoring them."""
    if not isinstance(observation_space, spaces.Box) or observation_space.shape != (34,):
        raise ValueError("Residual seeker policies require a 34-value Box observation")
    if not isinstance(action_space, spaces.Box) or action_space.shape != (2,):
        raise ValueError("Residual seeker policies require two continuous actions")
    arch = kwargs.pop("net_arch", None)
    if arch is not None and arch != [64, 64] and arch != dict(pi=[64, 64], vf=[64, 64]):
        raise ValueError("Base architecture is fixed at separate 64-Tanh-64-Tanh branches")
    for key, expected in (("activation_fn", nn.Tanh),
                          ("features_extractor_class", FlattenExtractor),
                          ("share_features_extractor", True), ("use_sde", False)):
        if key in kwargs and kwargs[key] != expected:
            raise ValueError(f"{key} must be {expected!r} for this controlled architecture")
    kwargs["net_arch"] = dict(pi=[64, 64], vf=[64, 64])
    return kwargs


def _zero_projection(layer):
    nn.init.zeros_(layer.weight)
    nn.init.zeros_(layer.bias)
    return layer


def copy_fresh_base(source, destination):
    """Pair scratch baselines by copying only base MLP, heads, and log_std.

    Call immediately after constructing both policies, before optimizer updates.
    Neither branches nor optimizer state are copied. Accepts policy objects, not
    checkpoint paths; callers must supply a NEW random baseline, never a donor.
    Same-seed construction already matches these base weights with defaults.
    """
    if source.optimizer.state or destination.optimizer.state:
        raise ValueError("copy_fresh_base is initialization-only, before optimizer updates")
    if source.observation_space.shape != (34,) or destination.observation_space.shape != (34,):
        raise ValueError("Fresh base pairing requires 34-input policies")
    names = ("mlp_extractor.policy_net.", "mlp_extractor.value_net.",
             "action_net.", "value_net.")
    source_state, destination_state = source.state_dict(), destination.state_dict()
    selected = {k for k in source_state if k == "log_std" or k.startswith(names)}
    target_names = {k for k in destination_state if k == "log_std" or k.startswith(names)}
    if selected != target_names or any(source_state[k].shape != destination_state[k].shape for k in selected):
        raise ValueError("Fresh base parameter names/shapes must match exactly")
    with torch.no_grad():
        for name in selected:
            destination_state[name].copy_(source_state[name])


class ResidualLstmPolicy(RecurrentActorCriticPolicy):
    """Raw-input LSTM residuals alongside, rather than upstream of, the base MLP."""

    def __init__(self, observation_space, action_space, lr_schedule, **kwargs):
        kwargs = _fixed_options(observation_space, action_space, kwargs)
        for key, expected in (("lstm_hidden_size", 64), ("n_lstm_layers", 1),
                              ("shared_lstm", False), ("enable_critic_lstm", True)):
            value = kwargs.pop(key, expected)
            if value != expected:
                raise ValueError(f"{key} must be {expected!r}")
            kwargs[key] = expected
        if kwargs.get("lstm_kwargs"):
            raise ValueError("LSTM uses standard one-layer, unidirectional, no-dropout settings")
        super().__init__(observation_space, action_space, lr_schedule, **kwargs)
        self.residual_actor = _zero_projection(nn.Linear(64, 64))
        self.residual_critic = _zero_projection(nn.Linear(64, 64))
        # The inherited constructor builds its optimizer before these projections.
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)

    def _build_mlp_extractor(self):
        # RecurrentActorCriticPolicy normally builds an MLP over LSTM output.
        # This branch instead retains an ordinary MLP directly over observation.
        ActorCriticPolicy._build_mlp_extractor(self)

    def _actor_latent(self, features, states, episode_starts):
        memory, states = self._process_sequence(features, states, episode_starts, self.lstm_actor)
        return self.mlp_extractor.forward_actor(features) + self.residual_actor(memory), states

    def _critic_latent(self, features, states, episode_starts):
        memory, states = self._process_sequence(features, states, episode_starts, self.lstm_critic)
        return self.mlp_extractor.forward_critic(features) + self.residual_critic(memory), states

    def forward(self, obs, lstm_states: RNNStates, episode_starts, deterministic=False):
        features = self.extract_features(obs)
        actor, pi_states = self._actor_latent(features, lstm_states.pi, episode_starts)
        critic, vf_states = self._critic_latent(features, lstm_states.vf, episode_starts)
        distribution = self._get_action_dist_from_latent(actor)
        actions = distribution.get_actions(deterministic=deterministic)
        log_prob = distribution.log_prob(actions)
        return (actions.reshape((-1, *self.action_space.shape)), self.value_net(critic),
                log_prob, RNNStates(pi_states, vf_states))

    def get_distribution(self, obs, lstm_states, episode_starts):
        features = BasePolicy.extract_features(self, obs, self.pi_features_extractor)
        latent, states = self._actor_latent(features, lstm_states, episode_starts)
        return self._get_action_dist_from_latent(latent), states

    def predict_values(self, obs, lstm_states, episode_starts):
        features = BasePolicy.extract_features(self, obs, self.vf_features_extractor)
        latent, _ = self._critic_latent(features, lstm_states, episode_starts)
        return self.value_net(latent)

    def evaluate_actions(self, obs, actions, lstm_states: RNNStates, episode_starts):
        features = self.extract_features(obs)
        actor, _ = self._actor_latent(features, lstm_states.pi, episode_starts)
        critic, _ = self._critic_latent(features, lstm_states.vf, episode_starts)
        distribution = self._get_action_dist_from_latent(actor)
        return self.value_net(critic), distribution.log_prob(actions), distribution.entropy()


class _ResidualMlpExtractor(MlpExtractor):
    """Residual branches are attached after SB3 initializes base layers/heads."""

    def forward_actor(self, features):
        return super().forward_actor(features) + self.residual_actor(features)

    def forward_critic(self, features):
        return super().forward_critic(features) + self.residual_critic(features)

    def forward(self, features):
        return self.forward_actor(features), self.forward_critic(features)


class ResidualMlpPolicy(ActorCriticPolicy):
    """Matched-capacity feedforward control; no recurrent state or donor weights."""

    def __init__(self, observation_space, action_space, lr_schedule, **kwargs):
        kwargs = _fixed_options(observation_space, action_space, kwargs)
        super().__init__(observation_space, action_space, lr_schedule, **kwargs)
        for name in ("residual_actor", "residual_critic"):
            branch = nn.Sequential(nn.Linear(34, 128), nn.Tanh(),
                                   nn.Linear(128, 112), nn.Tanh(),
                                   nn.Linear(112, 64), nn.Tanh(),
                                   _zero_projection(nn.Linear(64, 64)))
            setattr(self.mlp_extractor, name, branch)
        self.optimizer = self.optimizer_class(self.parameters(), lr=lr_schedule(1), **self.optimizer_kwargs)

    def _build_mlp_extractor(self):
        self.mlp_extractor = _ResidualMlpExtractor(
            self.features_dim, self.net_arch, self.activation_fn, device=self.device)
