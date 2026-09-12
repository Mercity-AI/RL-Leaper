"""Baseline: evaluate the unchanged PPO_29 donor with PPO_32's new diagnostics.

Runs the memoryless SEEKER champion on the fixed 100-maze exam (seeds 10000-10099)
so PPO_32 has an apples-to-apples comparison for first-detection, time-to-detection,
success-given-detection, fraction-cleared-before-detection, and body-health. The
cleared grid is maintained internally even though PPO_29 does not see it, so the
detection metrics are available. Coverage summary is NOT fed to the policy here.
"""

import json
from pathlib import Path

from stable_baselines3 import PPO

from rl_environment import LeaperReachEnv
from train_rl import detection_diagnostics, evaluate_diagnostics, print_body_health

ROOT = Path(__file__).resolve().parent
DONOR = ROOT / "rl_artifacts" / "ppo_29_normalized_throttle_250k" / "leaper_ppo.zip"
OUT = ROOT / "rl_artifacts" / "ppo_29_normalized_throttle_250k" / "baseline_detection.json"


def main() -> None:
    LeaperReachEnv.NORMALIZED_THROTTLE = True  # donor is a normalized-throttle model
    LeaperReachEnv.COVERAGE_MAP = False        # 26-input baseline; grid still tracked
    model = PPO.load(DONOR, device="cpu")
    deterministic = evaluate_diagnostics(model, episodes=100)
    detection = detection_diagnostics(model, episodes=100)
    report = {
        "model": "PPO_29 donor (baseline)",
        "coverage_map": False,
        "deterministic_evaluation": deterministic,
        "detection_diagnostics": detection,
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(detection, indent=2))
    print_body_health(detection, "PPO_29 baseline 100-maze exam")
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
