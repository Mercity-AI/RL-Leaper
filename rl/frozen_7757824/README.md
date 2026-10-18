# Frozen brain recipe for checkpoint 7,757,824

The junkyard game's Leaper is driven by the saved recurrent PPO policy in
`model_7757824/`. That policy only behaves as trained if it keeps receiving the
exact observation (34 inputs), action meaning (signed forward/reverse throttle,
9° turn) and per-step physics (0.375 units, 19 collision discs) it was trained
with. This folder is that recipe, copied byte-for-byte from the lab at commit
`7689aca`:

| File | Source |
|---|---|
| `rl_environment.py` | `rl_environment.py` at `7689aca` (unchanged) |
| `seeker_env.py` | `rl/seeker_env.py` at `7689aca`, with only its import pointed at this folder |
| `seeker_recurrent_policy.py` | `rl/seeker_recurrent_policy.py` at `7689aca` (unchanged) |

The RL lab at the repository root (`rl_environment.py`, `rl/seeker_*.py`) keeps
evolving for new experiments. The game imports **only** from this folder, so lab
changes can never silently change the shipped Leaper.

**Do not edit these files.** `tests/test_frozen_recipe.py` pins their SHA256
fingerprints and fails if any byte changes. A different recipe means a different
brain: train it, save it under a new checkpoint id, and give it its own frozen
folder.
