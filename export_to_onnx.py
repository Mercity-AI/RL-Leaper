"""
Export the champion Leaper brain to ONNX so it can run live in the browser.

What this does, in plain terms:
  1. Opens the trained champion (PPO_25, seed 911743).
  2. Pulls out ONLY the decision-making part (the Multi-Layer Perceptron).
     All the training scaffolding is left behind -- the game doesn't need it.
  3. Saves it as public/leaper.onnx: 26 numbers in -> 2 numbers out.
  4. Sanity-checks that the ONNX file gives the same answer as the original.

Run once:  .venv\Scripts\python.exe export_to_onnx.py
"""

import numpy as np
import torch
from stable_baselines3 import PPO

CHAMPION = "rl_artifacts/ppo_25_idle_s3/leaper_ppo.zip"
OUT_PATH = "public/leaper.onnx"
OBS_SIZE = 26  # 16 vision rays + 10 self-facts

print(f"Loading champion: {CHAMPION}")
model = PPO.load(CHAMPION, device="cpu")


class BrainOnly(torch.nn.Module):
    """The bare brain: observation in, deterministic action out."""

    def __init__(self, policy):
        super().__init__()
        self.policy = policy

    def forward(self, obs):
        # The confident, no-dice-rolling action = the raw mean the network
        # produces. We run the layers directly and skip the training-only
        # "probability distribution" machinery the game never needs.
        features = self.policy.extract_features(obs)
        latent_pi = self.policy.mlp_extractor.forward_actor(features)
        return self.policy.action_net(latent_pi)


brain = BrainOnly(model.policy).eval()

dummy = torch.zeros(1, OBS_SIZE, dtype=torch.float32)

print(f"Exporting to: {OUT_PATH}")
torch.onnx.export(
    brain,
    dummy,
    OUT_PATH,
    input_names=["observation"],   # the 26 numbers
    output_names=["action"],       # throttle, turn
    dynamic_axes={"observation": {0: "batch"}, "action": {0: "batch"}},
    opset_version=17,
    dynamo=False,  # legacy tracer -- rock-solid for a plain feed-forward net
)

# --- Sanity check: does the ONNX file agree with the real brain? ---
import onnxruntime as ort

session = ort.InferenceSession(OUT_PATH, providers=["CPUExecutionProvider"])

# The brain's raw answer gets clipped into the allowed range before it's used:
#   throttle -> [0, 1],  turn -> [-1, 1].
# The game will do this same clip in JavaScript, so we clip here to compare fairly.
low = model.action_space.low
high = model.action_space.high
print(f"Action range: throttle/turn low={low}, high={high}")

rng = np.random.default_rng(0)
worst = 0.0
for _ in range(1000):
    obs = rng.standard_normal((1, OBS_SIZE)).astype(np.float32)
    onnx_raw = session.run(None, {"observation": obs})[0]
    onnx_out = np.clip(onnx_raw, low, high)
    sb3_out, _ = model.predict(obs, deterministic=True)
    worst = max(worst, float(np.max(np.abs(onnx_out - sb3_out))))

print(f"\nBiggest disagreement over 1000 random inputs: {worst:.2e}")
if worst < 1e-4:
    print("PASS -- the ONNX brain matches the trained brain.")
else:
    print("WARNING -- outputs differ more than expected; investigate before trusting it.")

print(f"\nDone. Ship this file to the browser: {OUT_PATH}")
