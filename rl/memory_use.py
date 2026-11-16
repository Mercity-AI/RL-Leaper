"""How much does a brain use its LSTM memory? (2026-11-16)

    python -m rl.memory_use --run F7 --model path.zip --out out.json [--rounds 60]
    python -m rl.memory_use --today --out out.json

The actor adds two paths before choosing a move: a plain "reflex" path (two
64-neuron layers reading this step's inputs) and a memory path (an LSTM reading
every step of the round so far, through a 64x64 projection); FUSE adds a merge layer
reading both. Two measures on the behaviour-probe rounds (rl/behaviour_probe.py):

1. Size: per step, |memory path's push| / |reflex path's push| on the 64-number
   layer that picks the move (mean over steps), with the merge layer counted on
   the memory side.
2. Wiped memory: the same rounds played with the LSTM reset every step (it sees
   only the present), compared with normal play, on the probe's numbers.
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import torch

import rl.moving_target_game_exam as game_exam
from rl.behaviour_probe import SEEDS_FROM, play, summarize
from rl.moving_target import MAP_TO_BRAIN
from rl.walk_field import LeaperWalk


class Forgetful:
    """Predicts with the LSTM state reset every step (no memory across steps)."""

    def __init__(self, model):
        self.model = model

    def predict(self, obs, state=None, episode_start=None, deterministic=True):
        action, _ = self.model.predict(obs, state=None, episode_start=np.array([True]), deterministic=deterministic)
        return action, None


def measure_size(policy):
    sizes = {"plain": [], "memory": []}

    def keep(name):
        def hook(module, inputs, output):
            if output.shape[0] == 1:
                sizes[name].append(output.detach().reshape(-1).clone())
        return hook

    handles = [policy.mlp_extractor.policy_net.register_forward_hook(keep("plain")),
               policy.residual_actor.register_forward_hook(keep("memory"))]
    merge = []
    if hasattr(policy, "merge_actor"):
        handles.append(policy.merge_actor.register_forward_hook(
            lambda m, i, o: merge.append(o.detach().reshape(-1).clone()) if o.shape[0] == 1 else None))
    return sizes, merge, handles


def main():
    torch.set_num_threads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="F7")
    parser.add_argument("--model")
    parser.add_argument("--today", action="store_true")
    parser.add_argument("--rounds", type=int, default=60)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    game_exam.START_APART = (10 * MAP_TO_BRAIN, 20 * MAP_TO_BRAIN)
    from rl.behaviour_probe import load_brain
    from rl.round1_train import input_switches
    inputs = {} if args.today else input_switches(args.run)
    model = load_brain(args, inputs)
    walk = LeaperWalk(game_exam.yard()[2])
    seeds = range(SEEDS_FROM, SEEDS_FROM + args.rounds)
    sizes, merge, handles = measure_size(model.policy)
    normal = summarize(*play(model, inputs, seeds, walk, keep_paths=False))
    for h in handles:
        h.remove()
    plain = torch.stack(sizes["plain"])
    memory = torch.stack(sizes["memory"])
    if merge:
        memory = memory + torch.stack(merge)
    ratio = (memory.norm(dim=1) / plain.norm(dim=1).clamp_min(1e-9)).numpy()
    wiped = summarize(*play(Forgetful(model), inputs, seeds, walk, keep_paths=False))
    out = dict(brain="today" if args.today else args.model, run="today" if args.today else args.run,
               rounds=args.rounds, memory_to_reflex_size=dict(mean=float(ratio.mean()),
                                                              median=float(np.median(ratio)),
                                                              p90=float(np.percentile(ratio, 90))),
               normal=normal, memory_wiped=wiped)
    with open(args.out, "w") as stream:
        json.dump(out, stream, indent=1, default=float)
    print("RESULT", json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
