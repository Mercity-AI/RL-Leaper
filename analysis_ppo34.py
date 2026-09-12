"""PPO_34 ablation + alignment: did 0.5-seeding make the frontier note actually used?

Compares each PPO_34 model normal vs note-zeroed (5 inputs -> 0, 26 unchanged) on the
100-maze exam, plus same-state action divergence and movement-to-note alignment.
Contrast against PPO_33 (note was inert: alignment ~0.01, zeroing did not hurt).
"""
import json
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv
from analysis_phase1b import rollout, SEEDS

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rl_artifacts" / "phase1b_diagnostics" / "ppo34_ablation.json"
MODELS = {
    "PPO_34_s1": "rl_artifacts/ppo_34_frontier_seed_250k_s1/leaper_ppo.zip",
    "PPO_34_s2": "rl_artifacts/ppo_34_frontier_seed_250k_s2/leaper_ppo.zip",
    "PPO_34_s3": "rl_artifacts/ppo_34_frontier_seed_250k_s3/leaper_ppo.zip",
}


def main():
    LeaperReachEnv.NORMALIZED_THROTTLE = True
    LeaperReachEnv.FRONTIER_NOTE = True
    report = {}
    for name, path in MODELS.items():
        model = PPO.load(ROOT / path, device="cpu")
        normal = [rollout(model, s, frontier=True, probe_divergence=True) for s in SEEDS]
        zeroed = [rollout(model, s, frontier=True, zero_note=True) for s in SEEDS]
        succ_n = np.mean([r["success"] for r in normal])
        succ_z = np.mean([r["success"] for r in zeroed])
        fd_n = np.mean([r["detected"] for r in normal])
        fd_z = np.mean([r["detected"] for r in zeroed])
        al = [r["align_mean"] for r in normal if r["align_mean"] is not None]
        divs = [r["action_divergence_mean"] for r in normal if r["action_divergence_mean"]]
        report[name] = {
            "success_normal": float(succ_n), "success_note_zeroed": float(succ_z),
            "success_drop_from_zeroing": float(succ_n - succ_z),
            "first_det_normal": float(fd_n), "first_det_note_zeroed": float(fd_z),
            "first_det_drop_from_zeroing": float(fd_n - fd_z),
            "frontier_alignment_mean": float(np.mean(al)) if al else None,
            "same_state_action_divergence": np.mean(divs, axis=0).tolist() if divs else None,
        }
        print(f"{name}: success {succ_n:.0%}->{succ_z:.0%} (zeroing drop {succ_n-succ_z:+.0%}) | "
              f"first-det {fd_n:.0%}->{fd_z:.0%} (drop {fd_n-fd_z:+.0%}) | "
              f"align {np.mean(al):+.3f} | action-div {np.round(np.mean(divs,axis=0),3)}")
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nPPO_33 reference: alignment ~+0.01, zeroing did NOT hurt (helped 2/3).")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
