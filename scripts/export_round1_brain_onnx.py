"""Export a round-1 retrained Leaper brain (38 actor inputs) to ONNX for the browser, opt-in.

Run from the repository root (inference only, never trains). The repo's .venv has no onnx /
onnxruntime; they sit in tmp/onnx-pylib (`uv pip install --python .venv/bin/python --target
tmp/onnx-pylib --no-deps onnx onnxruntime flatbuffers ml_dtypes`):

    PYTHONPATH=tmp/onnx-pylib .venv/bin/python scripts/export_round1_brain_onnx.py \\
        --model rl_artifacts/moving_target_round1_20261115/run_F7GLSDP_try1/model_10002464.zip \\
        --run F7GLSDP --out public/brains/leaper_r1_10002464/

Then play it with http://localhost:5173/?brain=leaper_r1_10002464 (today's brain stays the
default; see src/brain/junkyard/README.md, "Round-1 brains").

What it does:
  1. Loads the checkpoint exactly like the round-1 exams (rl/round1_job.py load_model) and
     refuses anything but the plain residual-LSTM actor with I1 + I2 (38 actor inputs):
     fusion and window runs are refused.
  2. Keeps only the acting path: obs[:, :38] -> plain 38->64->64 Tanh net + LSTM(38->64) ->
     Linear(64, 64), summed -> action head (Gaussian mean) -> clipped to [-1, 1], exactly
     what model.predict(deterministic=True) returns. A privileged (B1) checkpoint's 4
     critic-only inputs are not in the file: the ONNX takes obs[1, 38].
  3. Proves it on >= --steps steps of real yard play (Round1YardEnv driven by the brain, a new
     round per seed, memory zeroed at each round start): model.predict on the full
     observation vs ONNX on its first 38 numbers, every step: action and LSTM h/c.
  4. Writes brain.json (identity, SHA256s, 38 inputs and what 34-37 mean, the I1/I2 constants
     the browser uses, source checkpoint) and copies the baked raster from leaper_7757824
     (read only; that folder is never written).
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import torch  # noqa: E402

TODAY = ROOT / "public/brains/leaper_7757824"
OPSET = 17
HIDDEN = 64
ACTOR_INPUTS = 38
SEED0 = 90000   # parity rounds: seeds 90000, 90001, ... (not the exams' 70000-70099)


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class DeterministicActor(torch.nn.Module):
    """ResidualLstmPolicyN / PrivilegedLstmPolicy acting path, LSTM memory passed in and out.

    Mirrors get_distribution -> _actor_latent (B1: features[:, :n_actor]) -> DiagGaussian mode
    (the mean) -> np.clip(action, low, high) in RecurrentActorCriticPolicy.predict."""

    def __init__(self, policy, low, high):
        super().__init__()
        self.lstm = policy.lstm_actor                      # LSTM(38 -> 64), one layer
        self.policy_net = policy.mlp_extractor.policy_net  # 38 -> 64 Tanh -> 64 Tanh
        self.residual = policy.residual_actor              # Linear(64, 64) on the LSTM output
        self.action_net = policy.action_net                # Linear(64, 2) = Gaussian mean
        self.register_buffer("low", torch.as_tensor(low, dtype=torch.float32).reshape(1, 2))
        self.register_buffer("high", torch.as_tensor(high, dtype=torch.float32).reshape(1, 2))

    def forward(self, obs, h, c):
        memory, (h_out, c_out) = self.lstm(obs.unsqueeze(0), (h, c))
        latent = self.policy_net(obs) + self.residual(memory.squeeze(0))
        action = torch.minimum(torch.maximum(self.action_net(latent), self.low), self.high)
        return action, h_out, c_out


def check_architecture(model, run):
    from rl.round1_train import RUNS
    spec = RUNS[run]
    if spec.get("fusion") or spec.get("window"):
        raise SystemExit(f"{run}: fusion/window brains are not supported by the browser export")
    policy = model.policy
    state = policy.state_dict()
    if any(k.startswith(("merge_actor", "merge_critic")) for k in state):
        raise SystemExit("Checkpoint has merge layers (fusion); not supported")
    n_actor = getattr(policy, "n_actor", policy.observation_space.shape[0])
    shapes = dict(lstm=tuple(state["lstm_actor.weight_ih_l0"].shape),
                  net=tuple(state["mlp_extractor.policy_net.0.weight"].shape),
                  residual=tuple(state["residual_actor.weight"].shape), head=tuple(state["action_net.weight"].shape))
    expected = dict(lstm=(4 * HIDDEN, ACTOR_INPUTS), net=(64, ACTOR_INPUTS), residual=(64, 64), head=(2, 64))
    if n_actor != ACTOR_INPUTS or shapes != expected:
        raise SystemExit(f"Expected a {ACTOR_INPUTS}-input residual LSTM actor, got n_actor={n_actor}, {shapes}")
    return n_actor


def parity_run(model, inputs, steps):
    """Real yard rounds (Round1YardEnv, the exams' world) driven by the checkpoint; every call kept,
    plus the per-step I1/I2 facts for the browser's input check."""
    from rl.round1_env import Round1YardEnv
    calls, rounds = [], []
    seed = SEED0
    while len(calls) < steps:
        env = Round1YardEnv(seed, **inputs)
        obs, _ = env.reset(seed=seed)
        state, first, done, n = None, True, False, 0
        while not done:
            action, new_state = model.predict(obs, state=state, episode_start=np.array([first]), deterministic=True)
            calls.append(dict(obs=np.array(obs, dtype=np.float32), state=None if first else state,
                              action=np.array(action, dtype=np.float32), new_state=new_state))
            obs, _, terminated, truncated, _ = env.step(action)
            state, first, n = new_state, False, n + 1
            done = terminated or truncated
        rounds.append(dict(seed=seed, steps=n))
        env.close()
        seed += 1
    return calls, rounds


def check_parity(actor, onnx_path, calls):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(str(onnx_path), options, providers=["CPUExecutionProvider"])
    zero = np.zeros((1, 1, HIDDEN), dtype=np.float32)
    worst = dict(torch_action=0.0, onnx_action=0.0, onnx_h=0.0, onnx_c=0.0)
    counts = dict(not_there=0, note_changes=0, visible=0, clipped=0)
    previous_note = None
    for call in calls:
        h = zero if call["state"] is None else np.asarray(call["state"][0], np.float32)
        c = zero if call["state"] is None else np.asarray(call["state"][1], np.float32)
        obs = call["obs"][:ACTOR_INPUTS].reshape(1, ACTOR_INPUTS)
        with torch.inference_mode():
            t_action, _, _ = actor(torch.from_numpy(obs), torch.from_numpy(h), torch.from_numpy(c))
        o_action, o_h, o_c = session.run(None, dict(obs=obs, h=h, c=c))
        expected = call["action"].reshape(1, 2)
        worst["torch_action"] = max(worst["torch_action"], float(np.abs(t_action.numpy() - expected).max()))
        worst["onnx_action"] = max(worst["onnx_action"], float(np.abs(o_action - expected).max()))
        worst["onnx_h"] = max(worst["onnx_h"], float(np.abs(o_h - call["new_state"][0]).max()))
        worst["onnx_c"] = max(worst["onnx_c"], float(np.abs(o_c - call["new_state"][1]).max()))
        note = tuple(call["obs"][34:37].tolist())
        counts["note_changes"] += int(previous_note is not None and note != previous_note)
        previous_note = note
        counts["not_there"] += int(call["obs"][37] == 1.0)
        counts["visible"] += int(call["obs"][0] == 1.0)
        counts["clipped"] += int(np.any(np.abs(expected) >= 1.0))
    return worst, counts


OBSERVATION = json.loads((TODAY / "brain.json").read_text())["observation"] + [
    "34-35 I1 motion note: world x/z direction Lola moved between the last two brain steps on "
    "which she was seen (0, 0 at reset; kept while unseen)",
    "36 I1 motion note: her speed then / sprint step (0.929 brain units), at most 1",
    "37 I2 not there: 1 when she has been seen, is not visible now, the spot where it last saw "
    "her is in sight (270 degree view, sight range, an eye line to her head/chest/hips standing "
    "there is clear) and she is more than 4 units from that spot; else 0",
]


def write_manifest(out, onnx_path, model, args, digest, parity, counts, rounds, n_calls, versions):
    from rl.moving_target import MAP_TO_BRAIN, SPRINT_STEP
    from rl.moving_target_game_exam import BODY_HEIGHTS, EYE, REAL_HEIGHTS, REAL_HEIGHTS_MAP, SIGHT_RANGE
    from rl.round1_env import NOT_THERE_RADIUS
    from rl.round1_train import RUNS
    # real_heights runs (2026-11-18) trained with her sight points at fixed map-unit heights.
    real = bool(RUNS[args.run]["switches"].get("real_heights"))
    heights = dict(body_heights_map_units=list(REAL_HEIGHTS_MAP), body_heights_at_5_5=REAL_HEIGHTS) if real else \
        dict(body_height_shares=[0.9, 0.7, 0.53], body_heights_at_5_5=BODY_HEIGHTS)
    today = json.loads((TODAY / "brain.json").read_text())
    steps = int(model.num_timesteps)
    try:
        source = str(Path(args.model).resolve().relative_to(ROOT))
    except ValueError:
        source = str(Path(args.model).resolve())
    manifest = dict(
        id=out.name, label=f"BRAIN R1 {steps:,}", num_timesteps=steps,
        policy_sha256=digest, policy_class=type(model.policy).__name__, recipe="rl/round1_env.py Round1YardEnv",
        run=args.run, source_checkpoint=source, switches=RUNS[args.run]["switches"],
        obs_size=ACTOR_INPUTS, observation=OBSERVATION,
        round1_inputs=dict(
            sight="eye only (sight_mode 'eye'); a legacy-sight reset is refused",
            i1_update="once per /step, at the live sight refresh before inference; never on the look "
                      "after the move, /sync or /sense (rl/round1_session.py)",
            i2="computed from the refreshed state; Lola's true position; eye from eye_offset; "
               + ("body points at body_heights_map_units x world scale" if real else
                  "body points at body_height_shares x 1.7 map units x world scale")
               + "; range = the session's sight_range (the game's 50 map units)",
            sprint_step_map_units_per_step=0.64, sprint_step_at_5_5=SPRINT_STEP,
            not_there_radius=NOT_THERE_RADIUS, **heights, eye_offset=EYE, map_to_brain_at_5_5=MAP_TO_BRAIN,
            sight_range_at_5_5=SIGHT_RANGE),
        # Training swept search coverage (inputs 26-30) at the trained 28 units while seeing Lola
        # out to 50 map units (GameExamEnv overrides only the target sensor); the browser keeps that.
        search_range=28.0,
        action=today["action"],
        lstm=today["lstm"],
        onnx=dict(file=onnx_path.name, sha256=sha256_file(onnx_path), bytes=onnx_path.stat().st_size,
                  opset=OPSET, inputs=dict(obs=[1, ACTOR_INPUTS], h=[1, 1, HIDDEN], c=[1, 1, HIDDEN]),
                  outputs=dict(action=[1, 2], h_out=[1, 1, HIDDEN], c_out=[1, 1, HIDDEN])),
        physics=today["physics"], contact_version=today["contact_version"], sight_version=today["sight_version"],
        parity=dict(yard_steps=n_calls, rounds=len(rounds), seeds=[rounds[0]["seed"], rounds[-1]["seed"]],
                    **{k: float(f"{v:.3g}") for k, v in parity.items()}, **counts),
        versions=versions, rasters=today.get("rasters", {}))
    (out / "brain.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Export a round-1 (38-input) brain to ONNX and prove parity.")
    parser.add_argument("--model", required=True, help="checkpoint .zip")
    parser.add_argument("--run", required=True, help="round-1 run name (rl/round1_train.py RUNS), e.g. F7GLSD")
    parser.add_argument("--out", required=True, help="public/brains/leaper_r1_<steps>/")
    parser.add_argument("--steps", type=int, default=8000, help="real yard steps to compare (at least 1200)")
    args = parser.parse_args()
    torch.set_num_threads(1)
    import onnx  # noqa: F401  (torch's ONNX writer needs it; fail early with a clear error)
    import onnxruntime
    import sb3_contrib
    import stable_baselines3
    from rl.round1_env import Round1YardEnv
    from rl.round1_job import load_model
    from rl.round1_train import input_switches

    out = Path(args.out).resolve()
    # The game only opens folders matching src/brain/BrainProvider.js OPT_IN_BRAIN (leaper_r1_<digits>).
    if out == TODAY.resolve() or not re.fullmatch(r"leaper_r1_\d+", out.name):
        raise SystemExit("--out must be a new public/brains/leaper_r1_<steps>/ folder (digits only after leaper_r1_)")
    inputs = input_switches(args.run)
    if not (inputs.get("new_inputs") and inputs.get("not_there")):
        raise SystemExit(f"{args.run}: the browser path needs both I1 (new_inputs) and I2 (not_there): {inputs}")
    model = load_model(args.model, args.run, lambda: Round1YardEnv(SEED0, **inputs))
    check_architecture(model, args.run)
    digest = sha256_file(args.model)
    actor = DeterministicActor(model.policy, model.action_space.low, model.action_space.high).eval()

    out.mkdir(parents=True, exist_ok=True)
    onnx_path = out / "actor.onnx"
    sample = (torch.zeros(1, ACTOR_INPUTS), torch.zeros(1, 1, HIDDEN), torch.zeros(1, 1, HIDDEN))
    torch.onnx.export(actor, sample, str(onnx_path), input_names=["obs", "h", "c"],
                      output_names=["action", "h_out", "c_out"], opset_version=OPSET, dynamo=False)
    print(f"Exported {onnx_path} ({onnx_path.stat().st_size:,} bytes)", flush=True)

    started = time.time()
    calls, rounds = parity_run(model, inputs, max(1200, args.steps))
    parity, counts = check_parity(actor, onnx_path, calls)
    print(f"Parity over {len(calls)} yard steps ({len(rounds)} rounds, seeds {rounds[0]['seed']}-{rounds[-1]['seed']}, "
          f"{time.time() - started:.0f} s): max |action| torch {parity['torch_action']:.2e}, ONNX {parity['onnx_action']:.2e}; "
          f"max |h| {parity['onnx_h']:.2e}, |c| {parity['onnx_c']:.2e}; steps with I2=1: {counts['not_there']}, "
          f"I1 changes: {counts['note_changes']}, visible: {counts['visible']}", flush=True)
    if parity["onnx_action"] >= 1e-5 or parity["torch_action"] >= 1e-5:
        raise SystemExit("ONNX actor does not match the checkpoint (limit 1e-5)")
    if not counts["not_there"] or not counts["note_changes"]:
        raise SystemExit("Parity run never exercised I1 or I2; use more --steps")

    for entry in json.loads((TODAY / "brain.json").read_text()).get("rasters", {}).values():
        shutil.copyfile(TODAY / entry["file"], out / entry["file"])   # read-only copy of the baked raster
    versions = dict(torch=torch.__version__, stable_baselines3=stable_baselines3.__version__,
                    sb3_contrib=sb3_contrib.__version__, numpy=np.__version__,
                    onnxruntime=onnxruntime.__version__, python=sys.version.split()[0])
    write_manifest(out, onnx_path, model, args, digest, parity, counts, rounds, len(calls), versions)
    print(f"Wrote {out / 'brain.json'}; ONNX SHA256 {sha256_file(onnx_path)}")


if __name__ == "__main__":
    main()
