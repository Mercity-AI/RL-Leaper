"""PPO_35 (0.25 seed) ablation + alignment: is the faint note still used?"""
import json
from pathlib import Path
import numpy as np
from stable_baselines3 import PPO
from rl_environment import LeaperReachEnv
from analysis_phase1b import rollout, SEEDS

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "rl_artifacts" / "phase1b_diagnostics" / "ppo35_ablation.json"
LeaperReachEnv.NORMALIZED_THROTTLE = True
LeaperReachEnv.FRONTIER_NOTE = True

report = {}
for name in ("s1", "s2", "s3"):
    m = PPO.load(ROOT / f"rl_artifacts/ppo_35_frontier_seed025_500k_{name}/leaper_ppo.zip", device="cpu")
    normal = [rollout(m, s, True, probe_divergence=True) for s in SEEDS]
    zero = [rollout(m, s, True, zero_note=True) for s in SEEDS]
    fn = float(np.mean([r["detected"] for r in normal])); fz = float(np.mean([r["detected"] for r in zero]))
    sn = float(np.mean([r["success"] for r in normal])); sz = float(np.mean([r["success"] for r in zero]))
    al = [r["align_mean"] for r in normal if r["align_mean"] is not None]
    dv = [r["action_divergence_mean"] for r in normal if r["action_divergence_mean"]]
    report[name] = {
        "first_det_normal": fn, "first_det_zeroed": fz, "first_det_drop": fn - fz,
        "success_normal": sn, "success_zeroed": sz,
        "alignment": float(np.mean(al)) if al else None,
        "action_div": np.mean(dv, axis=0).tolist() if dv else None,
    }
    print(f"{name}: first-det {fn:.0%}->{fz:.0%} (drop {fn-fz:+.0%}) | success {sn:.0%}->{sz:.0%} | "
          f"align {np.mean(al):+.3f} | turn-div {np.mean(dv,axis=0)[1]:.3f}", flush=True)
OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(f"wrote {OUT}")
