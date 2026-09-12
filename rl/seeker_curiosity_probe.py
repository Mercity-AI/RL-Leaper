"""Offline reward-risk probe for exp16/17; never loads or updates a policy.

Usage: python -m rl.seeker_curiosity_probe --campaign rl_artifacts/seeker_20260909

Uses the campaign's exact calibration.npz and seed+101 initialization. Controlled
layouts exercise actual SeekerEnv.step physics/rewards/termination; these are
diagnostic fixtures, not samples of the training maze distribution. A separate
natural-arena set is held out from all module updates. Repeated epochs deliberately
overfit the same recordings to expose persistent surprise and feature collapse;
they are not PPO rollouts or evidence of learned policy exploitation.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
import torch

from rl.seeker_curiosity import Curiosity, CuriosityBonus
from rl.seeker_env import SeekerEnv


SCENARIOS = {
    "open_space": ((1., 0.), 64),
    "scan": ((-1., 1.), 120),
    "short_loop": ((1., 1.), 240),
    "blocked_contact": ((1., 0.), 120),
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FixtureEnv(SeekerEnv):
    """Only geometry/start placement is controlled; step rules are inherited."""

    def __init__(self, scenario):
        self.scenario = scenario
        super().__init__(variant="icm")

    def _sample_target(self):
        return np.array([24., 24.], dtype=np.float32)

    def _generate_obstacles(self):
        return ((-18., -12., 3.),) if self.scenario == "blocked_contact" else ()

    def reset(self, **kwargs):
        super().reset(**kwargs)
        self.position = np.array([-18., -18.], dtype=np.float32)
        self.yaw = 0.
        if self._collision_for_pose(self.position, self.yaw) is not None:
            raise RuntimeError("probe start intersects collision geometry")
        self.prev_distance = self.best_distance = self._distance()
        self.target_visible = self.target_ever_seen = False
        self.last_seen_target.fill(0)
        self.steps_since_target_seen = self.TARGET_MEMORY_STEPS
        self.visited_cells.clear()
        self.visited_views.clear()
        self.scanned_headings.clear()
        cell, view = self._search_state()
        self.visited_cells.add(cell)
        self.visited_views.add(view)
        self.scanned_headings.add(view[2])
        self._update_target_memory(increment_time=False)
        self._reset_coverage()
        self._update_coverage()
        self.trajectory = [self.position.copy()]
        obs = np.concatenate((self._observation(), np.zeros(3, dtype=np.float32)))
        return obs, {"target_ever_seen": self.target_ever_seen}


def collect_fixture(name, seed):
    env = FixtureEnv(name)
    rows, observations, actions, following = [], [], [], []
    try:
        obs, info = env.reset(seed=seed)
        if info["target_ever_seen"]:
            raise RuntimeError("probe must start before discovery")
        geometry = dict(start=env.position.tolist(), target=env.target.tolist(),
                        obstacles=list(env.obstacles), world_limit=env.WORLD_LIMIT,
                        initial_coverage=env.coverage_fraction())
        action, limit = SCENARIOS[name]
        action = np.asarray(action, dtype=np.float32)
        for step in range(limit):
            nxt, reward, terminal, truncated, info = env.step(action)
            observations.append(obs.copy())
            actions.append(action.copy())
            following.append(nxt.copy())
            rows.append(dict(step=step + 1, x=info["x"], z=info["z"], yaw=info["yaw"],
                             collision=bool(info["collision"]),
                             moved=float(math.hypot(info["x"] - info["previous_x"],
                                                    info["z"] - info["previous_z"])),
                             new_cells=len(info["coverage_new_cells"]),
                             coverage=info["coverage_fraction"],
                             next_discovered=bool(info["target_ever_seen"]),
                             terminal=bool(terminal), truncated=bool(truncated),
                             stuck=bool(info["stuck"]), frozen=bool(info["frozen"]),
                             extrinsic=float(reward), reward_terms=info["reward_terms"]))
            obs = nxt
            if terminal or truncated or info["target_ever_seen"]:
                break
        if any(row["next_discovered"] for row in rows):
            raise RuntimeError(f"{name} unexpectedly discovered target; fixture contract changed")
        if name == "blocked_contact" and not rows[-1]["stuck"]:
            raise RuntimeError("blocked-contact fixture failed to exercise stuck terminal")
        if name == "scan" and not rows[-1]["frozen"]:
            raise RuntimeError("scan fixture failed to exercise freeze terminal")
        if name in ("open_space", "short_loop") and any(row["collision"] for row in rows):
            raise RuntimeError(f"{name} unexpectedly collided")
        return dict(geometry=geometry, steps=rows,
                    data=tuple(np.stack(v) for v in (observations, actions, following)))
    finally:
        env.close()


def collect_heldout(seed, count):
    """Independent natural random arenas/actions; no diagnostic layouts or fitting."""
    env = SeekerEnv(variant="icm")
    rng = np.random.default_rng(seed)
    data, attempted, episodes = [], 0, 1
    try:
        obs, _ = env.reset(seed=seed)
        while len(data) < count and attempted < count * 100:
            action = rng.uniform(-1, 1, 2).astype(np.float32)
            nxt, _, terminal, truncated, info = env.step(action)
            attempted += 1
            if not info["target_ever_seen"]:
                data.append((obs.copy(), action.copy(), nxt.copy()))
            obs = nxt
            if terminal or truncated or info["target_ever_seen"]:
                obs, _ = env.reset()
                episodes += 1
        if len(data) != count:
            raise RuntimeError("could not collect enough held-out pre-discovery transitions")
        return tuple(np.stack([row[i] for row in data]) for i in range(3)), dict(
            seed=seed, eligible=count, attempted=attempted, episodes=episodes,
            actions="independent uniform clipped policy coordinates", module_updates=0)
    finally:
        env.close()


def summarize(model, fixture, calibration_rms):
    errors = model.errors(*fixture["data"])
    budget = CuriosityBonus(1)
    payments, uncapped = [], []
    for error, row in zip(errors, fixture["steps"]):
        eligible = not row["next_discovered"] and not row["terminal"]
        uncapped.append(.01 * min(float(error) / max(model.rms, 1e-6), 1.) if eligible else 0.)
        payments.append(float(budget.pay(
            [error], model.rms, next_discovered=[row["next_discovered"]],
            true_terminal=[row["terminal"]], valid_transition=[True],
            dones=[row["terminal"] or row["truncated"]])[0]))
    payments = np.asarray(payments)
    contact = np.asarray([r["collision"] for r in fixture["steps"]])
    no_coverage = np.asarray([r["new_cells"] == 0 for r in fixture["steps"]])
    terminal = np.asarray([r["terminal"] for r in fixture["steps"]])
    exhausted = np.flatnonzero(np.cumsum(payments) >= 1. - 1e-12)
    if payments.sum() > 1. + 1e-12 or payments[terminal].sum() != 0:
        raise AssertionError("bonus cap or terminal gating failed")
    return dict(raw_error_mean=float(errors.mean()), raw_error_p95=float(np.quantile(errors, .95)),
                raw_errors=errors.tolist(), payments=payments.tolist(),
                payment_total=float(payments.sum()), uncapped_total=float(sum(uncapped)),
                cap_suppressed=float(sum(uncapped) - payments.sum()),
                cap_exhausted_step=int(exhausted[0] + 1) if len(exhausted) else None,
                contact_steps=int(contact.sum()), no_coverage_steps=int(no_coverage.sum()),
                contact_payout=float(payments[contact].sum()),
                no_coverage_payout=float(payments[no_coverage].sum()),
                contact_and_no_coverage_payout=float(payments[contact & no_coverage].sum()),
                terminal_payout=float(payments[terminal].sum()),
                fixed_calibration_q_mean=float(np.clip(errors / max(calibration_rms, 1e-6), 0, 1).mean()))


def render(report, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    epochs = [row["epoch"] for row in report["epochs"]]
    fig, axes = plt.subplots(3, 2, figsize=(14, 14), layout="constrained")
    for name, fixture in report["fixtures"].items():
        records = [row["scenarios"][name] for row in report["epochs"]]
        label = name.replace("_", " ")
        axes[0, 0].plot(epochs, [r["raw_error_mean"] for r in records], label=label)
        axes[1, 0].plot(epochs, [r["no_coverage_payout"] for r in records], label=label)
        axes[1, 1].plot(np.cumsum(records[0]["payments"]), label=label)
        axes[2, 0].plot([r["step"] for r in fixture["steps"]],
                        [r["coverage"] - fixture["geometry"]["initial_coverage"]
                         for r in fixture["steps"]], label=label)
    axes[0, 0].plot(epochs, [r["heldout_error"] for r in report["epochs"]], "k--", label="held-out")
    axes[0, 0].set(title="Raw forward MSE on fixed recordings", xlabel="ICM passes", ylabel="Mean MSE", yscale="log")
    axes[0, 1].plot(epochs, [r["heldout_feature_variance"] for r in report["epochs"]])
    axes[0, 1].set(title="Held-out encoder variance (never fitted)", xlabel="ICM passes", ylabel="Mean per-feature variance")
    axes[1, 0].set(title="Paid despite no new visible cells", xlabel="ICM passes", ylabel="Episode intrinsic payout")
    axes[1, 1].axhline(1., color="black", linestyle="--", linewidth=1)
    axes[1, 1].set(title="Before fitting: cumulative payment", xlabel="Recorded transition", ylabel="Intrinsic payout (cap 1)")
    axes[2, 0].set(title="Actual visible coverage gain", xlabel="Recorded transition", ylabel="Fraction of grid newly cleared")
    names = list(report["fixtures"])
    x = np.arange(len(names))
    for offset, record, label in [(-.18, report["epochs"][0], "Before fitting"),
                                  (.18, report["epochs"][-1], "Final pass")]:
        axes[2, 1].bar(x + offset, [record["scenarios"][n]["contact_payout"] for n in names], .36, label=label)
    axes[2, 1].set(title="Payment on collision steps (terminals excluded)", ylabel="Intrinsic payout")
    axes[2, 1].set_xticks(x, [n.replace("_", "\n") for n in names])
    for axis in axes.flat:
        axis.grid(alpha=.2)
        if axis.get_legend_handles_labels()[0]:
            axis.legend(fontsize=8)
    fig.suptitle("Seeker ICM reward-risk probe • scripted real-environment transitions\n"
                 "Repeated offline fitting is a stress test, not policy training", fontsize=15)
    fig.savefig(output, dpi=150)
    plt.close(fig)


def run(campaign, epochs=20, heldout_count=512):
    start = time.perf_counter()
    campaign = Path(campaign).resolve()
    protocol_path, calibration_path = campaign / "protocol.json", campaign / "calibration.npz"
    protocol = json.loads(protocol_path.read_text(encoding="utf-8"))
    seed = int(protocol["seed"])
    output = campaign / "curiosity_probe"
    if output.exists():
        raise FileExistsError(f"refusing to overwrite existing probe: {output}")
    # Same full-array error computation and accumulation as seeker_runner.train.
    model = Curiosity(device="cpu", seed=seed + 101)
    with np.load(calibration_path, allow_pickle=False) as calibration:
        calibration_data = tuple(calibration[k] for k in ("obs", "actions", "next_obs"))
        if not len(calibration_data[0]):
            raise ValueError("calibration has no eligible transitions")
        model.update_rms(model.errors(*calibration_data))
    calibration_rms = model.rms
    print(f"Calibration: {model.error_count} eligible transitions, RMS={model.rms:.9g}", flush=True)
    fixtures = {name: collect_fixture(name, seed + 301 + i) for i, name in enumerate(SCENARIOS)}
    heldout, heldout_meta = collect_heldout(seed + 401, heldout_count)
    training = tuple(np.concatenate([f["data"][i] for f in fixtures.values()]) for i in range(3))
    report = dict(created_utc=datetime.now(timezone.utc).isoformat(), seed=seed,
                  icm_seed=seed + 101, device="cpu", threads=torch.get_num_threads(),
                  torch_version=str(torch.__version__), parameter_count=model.parameter_count,
                  protocol_sha256=digest(protocol_path), calibration_sha256=digest(calibration_path),
                  source_sha256={p.name: digest(p) for p in (
                      Path(__file__), Path(__file__).with_name("seeker_curiosity.py"),
                      Path(__file__).with_name("seeker_env.py"),
                      Path(__file__).resolve().parents[1] / "rl_environment.py")},
                  calibration=dict(eligible=model.error_count, rms=calibration_rms,
                                   sum_squares=model.error_sum_squares,
                                   initialization="exact full calibration.npz, no updates"),
                  heldout=heldout_meta, training_transitions=len(training[0]),
                  settings=dict(coefficient=.01, episode_cap=1., passes=epochs,
                                normalization="preceding pass RMS; accumulate pre-update errors afterward",
                                terminal_rules="unchanged actual environment stuck/freeze/time limit",
                                layouts="controlled empty field or one contact obstacle; not training distribution"),
                  fixtures={name: {k: v for k, v in fixture.items() if k != "data"}
                            for name, fixture in fixtures.items()}, epochs=[])
    meta_path = campaign / "calibration.json"
    if meta_path.exists():
        report["calibration"]["collection_metadata"] = json.loads(meta_path.read_text())
    for epoch in range(epochs + 1):
        with torch.no_grad():
            latent = model.encoder(model.features(heldout[0]))
            variance = float(latent.var(dim=0, unbiased=False).mean())
        record = dict(epoch=epoch, rms=model.rms, rms_count=model.error_count,
                      heldout_feature_variance=variance,
                      heldout_error=float(model.errors(*heldout).mean()),
                      scenarios={name: summarize(model, fixture, calibration_rms)
                                 for name, fixture in fixtures.items()})
        report["epochs"].append(record)
        if epoch < epochs:
            preupdate = model.errors(*training)
            model.update_rms(preupdate)
            record["following_update"] = model.update(*training)
        if epoch % 5 == 0 or epoch == epochs:
            print(f"Pass {epoch}/{epochs}: held-out feature variance={variance:.6g}", flush=True)
    first, last = report["epochs"][0], report["epochs"][-1]
    report["risk_evidence"] = dict(
        initial_contact_payout=first["scenarios"]["blocked_contact"]["contact_payout"],
        final_contact_payout=last["scenarios"]["blocked_contact"]["contact_payout"],
        initial_loop_no_coverage_payout=first["scenarios"]["short_loop"]["no_coverage_payout"],
        final_loop_no_coverage_payout=last["scenarios"]["short_loop"]["no_coverage_payout"],
        heldout_variance_ratio=last["heldout_feature_variance"] / max(first["heldout_feature_variance"], 1e-12),
        interpretation=["A payout without new visible cells is evidence that surprise is not coverage.",
                        "Positive contact payout is possible despite unchanged collision and terminal costs.",
                        "The budget bounds incentive; it does not prove useful exploration or prevent loops.",
                        "Falling training error alone is not success; inspect held-out error and variance.",
                        "Scripted fixture results cannot establish policy exploitation or training performance."])
    report["wall_seconds"] = time.perf_counter() - start
    # Validate serialization before creating the immutable output directory.
    payload = json.dumps(report, indent=2, allow_nan=False)
    output.mkdir(parents=True, exist_ok=False)
    (output / "probe.json").write_text(payload, encoding="utf-8")
    render(report, output / "probe.png")
    print(json.dumps(report["risk_evidence"], indent=2), flush=True)
    print(f"Saved {output}", flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path,
                        default=Path(__file__).resolve().parents[1] / "rl_artifacts/seeker_20260909")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--heldout-count", type=int, default=512)
    args = parser.parse_args()
    if args.epochs < 1 or args.heldout_count < 2:
        parser.error("epochs must be positive and heldout-count at least 2")
    torch.set_num_threads(1)
    run(args.campaign, args.epochs, args.heldout_count)


if __name__ == "__main__":
    main()
