"""Independent ICM for seeker experiments 16/17 (no policy dependencies).

Collect with frozen networks and a fixed ``rms``. Pass executed clipped policy
actions, and terminal observations instead of VecEnv auto-reset observations.
The caller filters training to within-episode pre-discovery transitions (including
zero-paid capped/failure transitions). After collection, call
``update_rms(collected_preupdate_errors)`` once, then ``update`` once.
Calibration uses only ``errors`` and ``update_rms`` for 24,576 transitions.
Evaluation calls neither updates nor bonus payment. No rollout data is retained.
"""

from copy import deepcopy
import math

import numpy as np
import torch
from torch import nn


FEATURE_INDICES = (5, 6, *range(10, 26))
BATCH_SIZE = 256
LEARNING_RATE = 3e-4
GRAD_NORM_CAP = 0.5


def _errors_array(values):
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 1 or not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("errors must be a finite nonnegative 1D array")
    return values


class Curiosity(nn.Module):
    """18-input encoder plus inverse and forward dynamics, with private Adam.

    ``state_dict`` is the usual torch parameter-only API. Use ``checkpoint_state``
    or ``save`` for optimizer, shuffle RNG, settings and error statistics too.
    Input tensors are detached, so even accidentally graph-bearing caller inputs
    cannot receive curiosity gradients. Device must be chosen at construction.
    """

    def __init__(self, device="cpu", seed=0):
        super().__init__()
        self.seed = int(seed)
        self.rng = np.random.default_rng(self.seed)
        # Initialize on CPU, restoring the caller's CPU RNG. Do not manual_seed
        # all devices: that could perturb a CUDA policy's random stream.
        with torch.random.fork_rng(devices=[]):
            torch.random.default_generator.manual_seed(self.seed)
            self.encoder = nn.Sequential(
                nn.Linear(18, 64, device="cpu"), nn.Tanh(),
                nn.Linear(64, 32, device="cpu"), nn.Tanh(),
            )
            self.inverse = nn.Sequential(
                nn.Linear(64, 64, device="cpu"), nn.Tanh(),
                nn.Linear(64, 2, device="cpu"),
            )
            self.forward_model = nn.Sequential(
                nn.Linear(34, 64, device="cpu"), nn.Tanh(),
                nn.Linear(64, 32, device="cpu"),
            )
        self.to(device)
        self.optimizer = torch.optim.Adam(self.parameters(), lr=LEARNING_RATE)
        self.error_sum_squares = 0.0
        self.error_count = 0

    @property
    def device(self):
        return next(self.parameters()).device

    @property
    def parameter_count(self):
        return sum(p.numel() for p in self.parameters())

    @property
    def rms(self):
        """Raw-error RMS without centering; normalization floors it at 1e-6."""
        return math.sqrt(self.error_sum_squares / self.error_count) if self.error_count else 0.0

    def update_rms(self, raw_errors):
        """Accumulate calibration/rollout errors; never recompute after training."""
        values = _errors_array(raw_errors)
        with np.errstate(over="ignore"):
            total = self.error_sum_squares + float(np.dot(values, values))
        if not math.isfinite(total):
            raise ValueError("squared error statistics overflowed")
        self.error_sum_squares = total
        self.error_count += values.size

    update_statistics = update_rms

    def features(self, obs):
        obs = torch.as_tensor(obs, dtype=torch.float32, device=self.device).detach()
        if obs.ndim != 2 or obs.shape[1] < 26:
            raise ValueError("obs must have shape (N, >=26)")
        selected = obs[:, FEATURE_INDICES]
        if not torch.isfinite(selected).all():
            raise ValueError("curiosity features must be finite")
        return selected

    def _inputs(self, obs, actions, next_obs):
        current, following = self.features(obs), self.features(next_obs)
        actions = torch.as_tensor(actions, dtype=torch.float32, device=self.device).detach()
        if current.shape != following.shape or actions.shape != (len(current), 2):
            raise ValueError("transitions must have matching N and actions shape (N, 2)")
        if not torch.isfinite(actions).all() or (actions.abs() > 1).any():
            raise ValueError("actions must be executed clipped policy actions in [-1, 1]")
        return current, actions, following

    def _losses(self, current, actions, following):
        phi, next_phi = self.encoder(current), self.encoder(following)
        predicted_action = self.inverse(torch.cat((phi, next_phi), dim=1))
        predicted_next = self.forward_model(torch.cat((phi, actions), dim=1))
        inverse = (predicted_action - actions).square().mean()
        forward = (predicted_next - next_phi.detach()).square().mean()
        return inverse, forward

    @torch.no_grad()
    def errors(self, obs, actions, next_obs):
        """Detached, pre-update per-transition forward feature MSE; no mutation."""
        current, actions, following = self._inputs(obs, actions, next_obs)
        predicted = self.forward_model(torch.cat((self.encoder(current), actions), dim=1))
        return (predicted - self.encoder(following)).square().mean(dim=1).cpu().numpy().copy()

    def update(self, obs, actions, next_obs):
        """One private-RNG shuffled pass; does not change RMS or saved bonuses.

        Loss metrics are sample-weighted across batches; grad_norm is the largest
        pre-clip norm. Feature variance is a post-update collapse diagnostic.
        """
        current, actions, following = self._inputs(obs, actions, next_obs)
        n = len(current)
        metrics = dict(inverse_loss=0.0, forward_loss=0.0, loss=0.0,
                       grad_norm=0.0, feature_variance=0.0, samples=n, batches=0)
        order = self.rng.permutation(n)
        for start in range(0, n, BATCH_SIZE):
            indices = torch.as_tensor(order[start:start + BATCH_SIZE], device=self.device)
            self.optimizer.zero_grad(set_to_none=True)
            inverse, forward = self._losses(current[indices], actions[indices], following[indices])
            loss = 0.8 * inverse + 0.2 * forward
            if not torch.isfinite(loss):
                raise FloatingPointError("nonfinite ICM loss")
            loss.backward()
            norm = nn.utils.clip_grad_norm_(self.parameters(), GRAD_NORM_CAP, error_if_nonfinite=True)
            self.optimizer.step()
            weight = len(indices) / n
            for name, value in (("inverse_loss", inverse), ("forward_loss", forward), ("loss", loss)):
                metrics[name] += float(value.detach()) * weight
            metrics["grad_norm"] = max(metrics["grad_norm"], float(norm))
            metrics["batches"] += 1
        if n:
            with torch.no_grad():
                metrics["feature_variance"] = float(self.encoder(current).var(dim=0, unbiased=False).mean())
        return metrics

    def checkpoint_state(self):
        """Independent snapshot, suitable for torch.save or a runner checkpoint."""
        return deepcopy(dict(
            version=1, parameters=self.state_dict(), optimizer=self.optimizer.state_dict(),
            rng=self.rng.bit_generator.state, seed=self.seed,
            error_sum_squares=self.error_sum_squares, error_count=self.error_count,
            settings=dict(features=FEATURE_INDICES, batch_size=BATCH_SIZE,
                          learning_rate=LEARNING_RATE, grad_norm_cap=GRAD_NORM_CAP,
                          inverse_weight=0.8, forward_weight=0.2),
        ))

    def load_checkpoint_state(self, state):
        if state["version"] != 1 or state["settings"] != self.checkpoint_state()["settings"]:
            raise ValueError("incompatible curiosity checkpoint")
        self.load_state_dict(state["parameters"])
        self.optimizer.load_state_dict(deepcopy(state["optimizer"]))
        self.rng.bit_generator.state = deepcopy(state["rng"])
        self.seed = state["seed"]
        self.error_sum_squares = float(state["error_sum_squares"])
        self.error_count = int(state["error_count"])

    def save(self, path):
        torch.save(self.checkpoint_state(), path)

    @classmethod
    def load(cls, path, device="cpu"):
        state = torch.load(path, map_location=device, weights_only=True)
        result = cls(device=device, seed=state["seed"])
        result.load_checkpoint_state(state)
        return result


class CuriosityBonus:
    """Per-worker episode budgets, independent of network/normalizer updates.

    ``pay`` consumes one vector step. Masks describe the outgoing episode, using
    terminal info for done workers. ``valid_transition=False`` excludes reset
    pseudo-transitions. Time-limit terminal observations remain eligible; true
    terminals and discovery do not. ``dones`` resets budgets AFTER payment.
    """

    def __init__(self, n_workers, coefficient=0.01, cap=1.0):
        if not isinstance(n_workers, (int, np.integer)) or n_workers < 1:
            raise ValueError("n_workers must be a positive integer")
        if not math.isfinite(coefficient) or not math.isfinite(cap) or coefficient < 0 or cap < 0:
            raise ValueError("coefficient and cap must be finite and nonnegative")
        self.coefficient, self.cap = float(coefficient), float(cap)
        self.remaining = np.full(n_workers, self.cap, dtype=np.float64)

    def _mask(self, mask):
        mask = np.asarray(mask, dtype=bool)
        if mask.shape != self.remaining.shape:
            raise ValueError("masks must have one entry per worker")
        return mask

    def reset(self, workers=None):
        """Reset all workers or a boolean worker mask for explicit env resets."""
        if workers is None:
            self.remaining[:] = self.cap
        else:
            self.remaining[self._mask(workers)] = self.cap

    def pay(self, errors, rms, *, next_discovered, true_terminal, valid_transition, dones):
        values = _errors_array(errors)
        if values.shape != self.remaining.shape or not math.isfinite(rms) or rms < 0:
            raise ValueError("errors must match workers and RMS must be finite/nonnegative")
        discovered, terminal, valid, done = (
            self._mask(mask) for mask in (next_discovered, true_terminal, valid_transition, dones)
        )
        # Clip before dividing to avoid overflow for huge yet finite errors.
        scale = max(float(rms), 1e-6)
        q = np.minimum(values, scale) / scale
        bonus = np.where(valid & ~discovered & ~terminal,
                         np.minimum(self.coefficient * q, self.remaining), 0.0)
        self.remaining -= bonus
        self.reset(done)
        return bonus

    def checkpoint_state(self):
        return dict(version=1, coefficient=self.coefficient, cap=self.cap,
                    remaining=self.remaining.tolist())

    def load_checkpoint_state(self, state):
        remaining = np.asarray(state["remaining"], dtype=np.float64)
        if (state["version"] != 1 or state["coefficient"] != self.coefficient
                or state["cap"] != self.cap or remaining.shape != self.remaining.shape
                or not np.isfinite(remaining).all() or (remaining < 0).any()
                or (remaining > self.cap).any()):
            raise ValueError("incompatible bonus checkpoint")
        self.remaining[:] = remaining
