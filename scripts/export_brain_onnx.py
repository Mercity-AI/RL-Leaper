"""Export the frozen Leaper brain (checkpoint 7,757,824) to ONNX for the browser.

Run from the repository root (inference only, never trains):

    python scripts/export_brain_onnx.py

Needs torch + stable-baselines3/sb3-contrib (as for the brain server) plus the
`onnx` and `onnxruntime` packages (pip install onnx onnxruntime).

What it does, in plain terms:
  1. Loads the approved checkpoint exactly the way rl/junkyard_server.py does.
  2. Keeps ONLY the part that chooses moves (the "actor"): the observation MLP,
     the actor LSTM memory, the residual memory projection and the action head.
     The critic, the optimizer and all training machinery are left behind.
  3. Saves public/brains/leaper_7757824/actor.onnx with the LSTM memory as
     explicit inputs/outputs:  (obs[1,34], h[1,1,64], c[1,1,64]) ->
     (action[1,2], h_out[1,1,64], c_out[1,1,64]). The action is already clipped
     to [-1, 1], exactly what model.predict(deterministic=True) returns.
  4. Proves it: drives the real BrainSession for 1,200+ junkyard steps and checks
     the ONNX answer (and memory) against the checkpoint at every single step.
  5. Writes brain.json next to it: identity, SHA256s, input/action meaning.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from make_junkyard_fixtures import (MODEL, Recorder, World, free_start,  # noqa: E402
                                    lola_inputs)
from rl.junkyard_env import EYE_VISION, PLAYER_CONTACT  # noqa: E402
from rl.junkyard_server import BrainSession, load_brain  # noqa: E402

OUT = ROOT / "public/brains/leaper_7757824"
OPSET = 17
HIDDEN = 64


# --- The deterministic actor, as one small torch module --------------------------

class DeterministicActor(torch.nn.Module):
    """ResidualLstmPolicy's acting path with the LSTM memory passed in and out.

    Mirrors ResidualLstmPolicy.get_distribution -> DiagGaussian mode (the mean)
    -> np.clip(action, low, high) in RecurrentActorCriticPolicy.predict.
    """

    def __init__(self, policy, low, high):
        super().__init__()
        self.features = policy.pi_features_extractor      # Flatten (identity for [1, 34])
        self.lstm = policy.lstm_actor                      # LSTM(34 -> 64), one layer
        self.policy_net = policy.mlp_extractor.policy_net  # 34 -> 64 Tanh -> 64 Tanh
        self.residual = policy.residual_actor              # Linear(64, 64) on the LSTM output
        self.action_net = policy.action_net                # Linear(64, 2) = Gaussian mean
        self.register_buffer("low", torch.as_tensor(low, dtype=torch.float32).reshape(1, 2))
        self.register_buffer("high", torch.as_tensor(high, dtype=torch.float32).reshape(1, 2))

    def forward(self, obs, h, c):
        features = self.features(obs)
        # One LSTM step for one Leaper: sequence length 1, batch 1 (SB3's fast path).
        memory, (h_out, c_out) = self.lstm(features.unsqueeze(0), (h, c))
        latent = self.policy_net(features) + self.residual(memory.squeeze(0))
        # Deterministic action = the Gaussian mean, clipped like predict() does.
        action = torch.minimum(torch.maximum(self.action_net(latent), self.low), self.high)
        return action, h_out, c_out


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# --- A long real junkyard run to compare against ----------------------------------

def parity_run(model, world, steps):
    """Drive BrainSession (eye sight, player contact) and keep every policy call."""
    eye = EYE_VISION["eyeOffset"]
    # Lola: hides behind, waits, then laps the open middle of the yard and back.
    waypoints = [(0, 2.0, -11.0, "stand"), (60, 2.0, -11.0, "stand"), (140, 12.0, -10.0, "stand"),
                 (240, 16.0, 8.0, "crouch"), (340, 6.0, 20.0, "stand"), (460, -12.0, 18.0, "stand"),
                 (600, -4.0, 4.0, "jump"), (700, 2.0, -6.0, "stand"), (820, 12.0, -10.0, "stand"),
                 (960, 20.0, 18.0, "stand"), (1100, 0.0, 24.0, "crouch"), (steps, -14.0, 14.0, "stand")]
    start = free_start(world, (2.0, -2.0), 0.0)
    target, pose = lola_inputs(waypoints, 0, eye)
    recorder = Recorder(model)
    session = BrainSession(recorder, world.geometry, np.asarray(start, dtype=float), 0.0,
                           np.asarray(target, dtype=float), player_collision=True,
                           sight=world.sight, sight_pose=pose)
    for i in range(steps):
        target, pose = lola_inputs(waypoints, i + 1, eye)
        session.step(target, pose)
    return recorder.calls


def check_parity(actor, onnx_path, calls):
    """Max |difference| of action and memory: torch actor and ONNX vs the checkpoint."""
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    onnx_session = ort.InferenceSession(str(onnx_path), options, providers=["CPUExecutionProvider"])
    worst = dict(torch_action=0.0, onnx_action=0.0, onnx_state=0.0)
    zero = np.zeros((1, 1, HIDDEN), dtype=np.float32)
    for call in calls:
        # Step 0 has episode_start=True: SB3 multiplies the incoming memory by 0,
        # which is the same as feeding zeros. Afterwards memory flows on unchanged.
        h = zero if call["state"] is None or call["episode_start"] else np.asarray(call["state"][0], np.float32)
        c = zero if call["state"] is None or call["episode_start"] else np.asarray(call["state"][1], np.float32)
        obs = call["obs"].reshape(1, 34)
        with torch.inference_mode():
            t_action, _, _ = actor(torch.from_numpy(obs), torch.from_numpy(h), torch.from_numpy(c))
        o_action, o_h, o_c = onnx_session.run(None, dict(obs=obs, h=h, c=c))
        expected = call["action"].reshape(1, 2)
        worst["torch_action"] = max(worst["torch_action"], float(np.abs(t_action.numpy() - expected).max()))
        worst["onnx_action"] = max(worst["onnx_action"], float(np.abs(o_action - expected).max()))
        worst["onnx_state"] = max(worst["onnx_state"], float(np.abs(o_h - call["new_state"][0]).max()),
                                  float(np.abs(o_c - call["new_state"][1]).max()))
    return worst


# --- brain.json: everything a browser needs to trust and drive this file ---------

OBSERVATION = [
    "0 target visible now (0/1)",
    "1 memory age: steps since Lola was last seen / 120, clipped to 1",
    "2-3 world x/z direction to the last-seen spot (0, 0 before the first sighting)",
    "4 distance to the last-seen spot / arena diagonal (1 before the first sighting)",
    "5-6 sin(yaw), cos(yaw)",
    "7 collided last step (0/1)",
    "8-9 previous action (throttle, turn) after clipping",
    "10-25 sixteen 2D rays over 270 degrees: clear distance / 28",
    "26-27 world x/z direction to the nearest frontier cell of the largest unchecked region",
    "28 frontier distance / arena diagonal",
    "29 largest unchecked region size / grid cells",
    "30 frontier note valid (0/1)",
    "31-32 last move dx, dz / 0.375 (clipped to [-1, 1])",
    "33 last turn / 9 degrees (clipped to [-1, 1])",
]


def write_manifest(path, onnx_path, model, digest, parity, steps, versions):
    manifest = json.loads(path.read_text()) if path.exists() else {}
    rasters = manifest.get("rasters", {})  # written by scripts/bake_junkyard_raster.py
    manifest = dict(
        id="leaper_7757824", label="BRAIN 7,757,824", num_timesteps=int(model.num_timesteps),
        policy_sha256=digest, policy_class="ResidualLstmPolicy", recipe="rl/frozen_7757824",
        obs_size=34, observation=OBSERVATION,
        action=dict(size=2, low=model.action_space.low.tolist(), high=model.action_space.high.tolist(),
                    throttle="signed reverse: physical throttle = action[0]; negative backs up; "
                             "|1| moves 0.375 units per step",
                    turn="yaw += action[1] * 9 degrees per step",
                    clipped_in_graph=True),
        lstm=dict(layers=1, hidden_size=HIDDEN, state_shape=[1, 1, HIDDEN],
                  episode_start="feed zeros on the very first step of a session (SB3 multiplies the "
                                "incoming memory by 1 - episode_start); carry h_out/c_out afterwards"),
        onnx=dict(file=onnx_path.name, sha256=sha256_file(onnx_path), bytes=onnx_path.stat().st_size,
                  opset=OPSET, inputs=dict(obs=[1, 34], h=[1, 1, HIDDEN], c=[1, 1, HIDDEN]),
                  outputs=dict(action=[1, 2], h_out=[1, 1, HIDDEN], c_out=[1, 1, HIDDEN])),
        physics=dict(move_speed=0.375, turn_speed_degrees=9.0, ray_count=16, ray_range=28.0,
                     vision_fov_degrees=270.0, target_radius=1.4, memory_steps=120,
                     coverage_cell=3.0, body_diameter_for_scale=7.98),
        contact_version=PLAYER_CONTACT["version"], sight_version=EYE_VISION["version"],
        parity=dict(junkyard_steps=steps, **{k: float(f"{v:.3g}") for k, v in parity.items()}),
        versions=versions, rasters=rasters)
    path.write_text(json.dumps(manifest, indent=1) + "\n")


def main():
    parser = argparse.ArgumentParser(description="Export the Leaper actor to ONNX and prove parity.")
    parser.add_argument("--steps", type=int, default=1200, help="real junkyard steps to compare")
    parser.add_argument("--width", type=float, default=5.5)
    args = parser.parse_args()
    torch.set_num_threads(1)
    import onnx  # noqa: F401  (torch's ONNX writer needs it; fail early with a clear error)
    import sb3_contrib
    import stable_baselines3

    # 1) Load exactly like the server, then wrap the acting path.
    model, digest = load_brain(MODEL)
    actor = DeterministicActor(model.policy, model.action_space.low, model.action_space.high).eval()

    # 2) Export with the LSTM memory as plain inputs/outputs (fixed batch of one).
    OUT.mkdir(parents=True, exist_ok=True)
    onnx_path = OUT / "actor.onnx"
    sample = (torch.zeros(1, 34), torch.zeros(1, 1, HIDDEN), torch.zeros(1, 1, HIDDEN))
    torch.onnx.export(actor, sample, str(onnx_path), input_names=["obs", "h", "c"],
                      output_names=["action", "h_out", "c_out"], opset_version=OPSET, dynamo=False)
    print(f"Exported {onnx_path.relative_to(ROOT)} ({onnx_path.stat().st_size:,} bytes)")

    # 3) Compare against the real BrainSession over a long junkyard run.
    started = time.time()
    world = World(args.width)
    calls = parity_run(model, world, args.steps)
    parity = check_parity(actor, onnx_path, calls)
    print(f"Parity over {len(calls)} real junkyard steps (width {args.width}, eye sight, "
          f"{time.time() - started:.0f} s): max |action| torch {parity['torch_action']:.2e}, "
          f"ONNX {parity['onnx_action']:.2e}; max |LSTM memory| ONNX {parity['onnx_state']:.2e}")
    if parity["onnx_action"] >= 1e-5 or parity["torch_action"] >= 1e-5:
        raise SystemExit("ONNX actor does not match the checkpoint (limit 1e-5)")

    # 4) Manifest next to the model file.
    import onnxruntime
    versions = dict(torch=torch.__version__, stable_baselines3=stable_baselines3.__version__,
                    sb3_contrib=sb3_contrib.__version__, numpy=np.__version__,
                    onnxruntime=onnxruntime.__version__, python=sys.version.split()[0])
    write_manifest(OUT / "brain.json", onnx_path, model, digest, parity, len(calls), versions)
    print(f"Wrote {(OUT / 'brain.json').relative_to(ROOT)}; ONNX SHA256 {sha256_file(onnx_path)}")


if __name__ == "__main__":
    main()
