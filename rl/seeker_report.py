"""Regenerate static campaign evidence: python -m rl.seeker_report.

Requires numpy and matplotlib only; never imports or starts the trainer.
Incomplete live writes are skipped with warnings. All outputs go in report/.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import re
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
from matplotlib.ticker import MaxNLocator
import numpy as np

CAMPAIGN = Path(__file__).resolve().parents[1] / "rl_artifacts/seeker_20260909"
RATES = ("success_rate", "detection_rate", "success_given_detection")
TITLES = ("Arrival success", "Target discovery", "Success conditional on discovery")
VARIANTS = {
    "control": ("Adds three measured movement inputs to the donor's 31 inputs: actual x/z movement and actual turn from the previous step (34 inputs total). Keeps the original rewards.",
                "Knowing what movement actually happened may help recognize blocked actions and recover."),
    "removal": ("Uses the same 34 inputs. Removes new-cell and new-view rewards; keeps scan, discovery, progress, goal, time and collision rewards. Trains the curiosity module but pays no curiosity reward.",
                "Removing cell/view bonuses may reduce aimless reward-seeking; the unpaid module is a comparison for the paid curiosity variant."),
    "icm": ("Uses the removal setup and adds a training-only curiosity bonus for hard-to-predict transitions while searching: up to 0.01 per eligible step and 1.0 per episode; excludes true terminal transitions.",
            "A small capped curiosity bonus may encourage useful exploration and increase discovery without rewarding endless wandering."),
    "visibility": ("Removes new-cell and new-view rewards, keeps scan and the other rewards, and rewards the fraction of newly visible coverage cells while the target has not been seen.",
                   "Paying for newly observed space may guide search better than paying for location or heading novelty."),
    "no_hidden_progress": ("Keeps the 34 inputs and sets the hidden-target best-progress reward scale to zero. Other reward settings remain in place.",
                           "Removing progress credit toward an unseen target may encourage search based on available observations.")}


def sensor_kind(config):
    return config.get("sensors", {50: "footprint", 36: "stall_memory", 34: "body"}.get(
        config.get("observation_size", 34), "unknown"))


def run_description(config):
    change, hypothesis = VARIANTS.get(config.get("variant"),
        ("Unknown variant; consult the saved config.json.", "No hypothesis description available."))
    if sensor_kind(config) == "footprint":
        sensor = config.get("footprint_sensor", {})
        change = (f"Uses {config.get('observation_size', 50)} inputs: the 34-input body-sensor setup plus "
                  f"{sensor.get('count', 16)} footprint-clearance measurements over a "
                  f"{sensor.get('cone_degrees', 270)}-degree cone, with range {sensor.get('range', 6)} world units. "
                  f"These check a fixed-facing translation of all {sensor.get('footprint_circles', 19)} body/leg collision circles "
                  "against obstacles and walls. They provide clearance information; they do not override actions. "
                  + ("Keeps control rewards." if config.get("variant") == "control" else change))
        hypothesis = ("Seeing clearance for the whole body and legs may help avoid contacts that body-centre rays miss. "
                      "Compare with body-sensor control at the same recorded training budget; this is a sensor/input change, not a reward-only test.")
    elif sensor_kind(config) == "stall_memory":
        memory = config.get("stall_memory", {})
        channels = ", ".join(memory.get("channels", ["stuck_steps/40", "freeze_steps/60"]))
        change = (f"Uses {config.get('observation_size', 36)} inputs and "
                  f"{config.get('trainable_parameters', 13253):,} trainable parameters: the original 34 inputs plus "
                  f"two own-motion history values ({channels}). These summarize recent collisions and actual translation; "
                  "they add no hidden target information. "
                  + ("The new input columns start at zero weight. " if memory.get("zero_initialized_input_columns", True) else "")
                  + ("Control rewards and terminal rules remain unchanged." if config.get("variant") == "control" else change))
        hypothesis = ("Knowing how long it has been blocked or motionless may help the policy change its actions before a stall ends the episode. "
                      "Compare with body-sensor control at the same recorded training budget; this tests added motion history, not a new terminal reward.")
    return change, hypothesis


def comparison_references(run, runs):
    """Only body-sensor control is a common reference; other sensors are treatments."""
    references = [(r, "Body-sensor control reference") for r in runs
                  if r is not run and r["config"].get("variant") == "control"
                  and sensor_kind(r["config"]) == "body"]
    if run["config"].get("variant") == "icm":
        references += [(r, "Curiosity payout versus removal (reward-only comparison)") for r in runs
                       if r["name"] == "removal_250k" and r["config"].get("variant") == "removal"
                       and sensor_kind(r["config"]) == sensor_kind(run["config"])
                       and r["config"].get("observation_size", 34) == run["config"].get("observation_size", 34)]
    return references


def read(path, default=None):
    if not path.exists():
        return default
    try:
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError, EOFError) as exc:
        warnings.warn(f"Skipping incomplete/unreadable {path}: {exc}")
        return default


def jsonl(path):
    if not path.exists():
        return []
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            rows.append(json.loads(line))
        except ValueError:
            warnings.warn(f"Skipping incomplete JSONL row {path}:{number}")
    return rows


def evaluation(prefix, step=None, wall=None):
    summary = read(Path(str(prefix) + "_summary.json"))
    if summary is None:
        return None
    return dict(prefix=prefix, step=step, wall=wall, summary=summary,
                rows=read(Path(str(prefix) + "_episodes.json"), []))


def mean(values):
    values = [v for v in values if v is not None]
    return float(np.mean(values)) if values else None


def fmt(value, percent=False):
    if value is None or not np.isfinite(value):
        return "N/A"
    return f"{100 * value:.1f}%" if percent else f"{value:.2f}"


def save(fig, directory, name):
    fig.savefig(directory / name, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return f"![{name.removesuffix('.png').replace('_', ' ')}]({name})"


def bootstrap(current, reference, draws):
    """Resample matched maze IDs, retaining within-maze policy pairing."""
    a = {r["seed"]: r["success"] for r in current}
    b = {r["seed"]: r["success"] for r in reference}
    if not a or a.keys() != b.keys() or len(a) != len(current) or len(b) != len(reference):
        return "Unavailable: missing, duplicate, or unequal maze seed panels."
    delta = np.array([float(a[s]) - float(b[s]) for s in sorted(a)])
    rng = np.random.default_rng(20260909)
    samples = np.concatenate([delta[rng.integers(len(delta), size=(min(500, draws-i), len(delta)))].mean(axis=1)
                              for i in range(0, draws, 500)])
    lo, hi = np.quantile(samples, [.025, .975]) * 100
    return f"{delta.mean()*100:+.2f} percentage points; paired 95% CI [{lo:+.2f}, {hi:+.2f}], n={len(delta)} mazes."


def learning(run, baseline, out):
    fig, axes = plt.subplots(2, 3, figsize=(13, 7), layout="constrained", sharey=True)
    train = run["training"]
    # One rolling estimate per completed transition group, last 100 episodes.
    rolling = []
    for i, row in enumerate(train):
        if i + 1 < len(train) and train[i+1].get("transitions") == row.get("transitions"):
            continue
        window = train[max(0, i-99):i+1]
        detected = [r for r in window if r.get("detected")]
        rolling.append((row.get("transitions"), [mean([r.get("success") for r in window]),
                        mean([r.get("detected") for r in window]), mean([r.get("success") for r in detected])]))
    clocks = {r["transitions"]: r["wall_seconds"] for r in run["rollouts"]
              if r.get("transitions") is not None and r.get("wall_seconds") is not None}
    for r in run["progress"]:
        try:
            clocks.setdefault(float(r["time/total_timesteps"]), float(r["time/time_elapsed"]))
        except (KeyError, ValueError, TypeError):
            pass
    clock_x = sorted(clocks)
    def wall(step):
        if step is None or not clock_x or step < clock_x[0] or step > clock_x[-1]:
            return np.nan
        return np.interp(step, clock_x, [clocks[x] for x in clock_x]) / 60
    for row in range(2):
        for col, key in enumerate(RATES):
            ax = axes[row, col]
            if baseline and baseline["summary"].get(key) is not None:
                ax.axhline(100*baseline["summary"][key], color="0.4", ls=":", label="Baseline deterministic")
            ev = run["evals"]
            x = [e["step"] if row == 0 else (e["wall"]/60 if e["wall"] is not None else np.nan) for e in ev]
            y = [100*e["summary"][key] if e["summary"].get(key) is not None else np.nan for e in ev]
            if ev:
                ax.plot(x, y, "o-", color="#0072B2", label="Development deterministic")
            if rolling:
                ax.plot([s if row == 0 else wall(s) for s, _ in rolling],
                        [100*v[col] if v[col] is not None else np.nan for _, v in rolling],
                        color="#D55E00", lw=1.3, label="Training stochastic, last 100")
            if not ev:
                ax.text(.03, .04, "No completed development evaluation", transform=ax.transAxes, fontsize=8)
            ax.set(title=TITLES[col] if row == 0 else "", ylim=(-2, 102),
                   xlabel="Recorded cumulative transitions" if row == 0 else "Elapsed session wall time (min)")
            ax.grid(alpha=.2)
            ax.xaxis.set_major_locator(MaxNLocator(5))
            if row == 0:
                ax.ticklabel_format(axis="x", style="sci", scilimits=(3, 3))
            if col == 0:
                ax.set_ylabel("Episodes (%)")
    axes[0, 0].legend(fontsize=7, loc="best")
    fig.suptitle(run["name"] + " — training and deterministic evaluation are separate")
    return save(fig, out, run["name"] + "_learning.png")


def outcomes(ev, label, out, stem):
    rows = ev["rows"]
    if not rows:
        return "Outcome plot unavailable: episode rows absent."
    groups = {}
    for r in rows:
        key = "Success" if r["success"] else ("After discovery" if r["detected"] else "Before discovery") + "\n" + "+".join(r["failure_causes"])
        groups[key] = groups.get(key, 0) + 1
    fig, ax = plt.subplots(figsize=(9, 4), layout="constrained")
    labels, counts = list(groups), list(groups.values())
    bars = ax.bar(labels, np.array(counts)*100/len(rows), color=["#009E73" if s == "Success" else "#D55E00" for s in labels])
    ax.bar_label(bars, labels=[f"{n}/{len(rows)}" for n in counts], padding=3)
    ax.set(ylabel="All evaluated episodes (%)", title=label + " — exclusive outcomes", ylim=(0, 110))
    ax.tick_params(axis="x", labelsize=8)
    ax.grid(axis="y", alpha=.2)
    return save(fig, out, stem + "_outcomes.png")


def first_search_episodes(path):
    """First three complete, contiguous worker-0 episodes with unseen steps.

    Scan in file order, stop after three; do not rank by reward or outcome.
    Missing starts/steps are not presented as complete reward traces.
    """
    selected, current = [], []
    if not path.exists():
        return selected
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            try:
                row = json.loads(line)
            except ValueError:
                warnings.warn(f"Skipping incomplete trace row {path}:{number}")
                continue
            if current and row.get("episode") != current[-1].get("episode"):
                current = []
            current.append(row)
            if row.get("done"):
                complete = [r.get("step") for r in current] == list(range(1, len(current)+1))
                if complete and any(r.get("discovered") is False for r in current):
                    selected.append(current)
                current = []
                if len(selected) == 3:
                    break
    return selected


def curiosity_report(run, out):
    lines = ["**Training curiosity diagnostics:** time traces sample predeclared worker 0 only. "
             "Select the first three completed episodes in log order containing at least one recorded pre-discovery step, "
             "regardless of success or reward. In-progress episodes and traces missing a start or intermediate step are excluded. "
             "Aggregate totals below use completed episode rows from all workers, not this three-episode sample."]
    rows = run["training"]
    table = ["| All-worker completed-episode metric | Value | Recorded episodes |", "|---|---:|---:|"]
    for key, label in (("intrinsic", "Curiosity payout"),
                       ("intrinsic_during_contact", "Payout during contact"),
                       ("intrinsic_without_new_visibility", "Payout without new visibility")):
        values = [r[key] for r in rows if isinstance(r.get(key), (int, float)) and np.isfinite(r[key])]
        value = f"{sum(values):.4f} total; {np.mean(values):.4f} mean/episode" if values else "N/A"
        table.append(f"| {label} | {value} | {len(values)} |")
        if key != "intrinsic":
            paired = [r for r in rows if all(isinstance(r.get(k), (int, float)) and np.isfinite(r[k]) for k in (key, "intrinsic"))]
            payout = sum(r["intrinsic"] for r in paired)
            share = sum(r[key] for r in paired)/payout if payout > 0 else None
            table.append(f"| {label} / total payout (same rows) | {fmt(share, True)} | {len(paired)} |")
    flags = [r["intrinsic_budget_exhausted"] for r in rows if isinstance(r.get("intrinsic_budget_exhausted"), bool)]
    exhausted = f"{sum(flags)}/{len(flags)} ({fmt(mean(flags), True)})" if flags else "N/A"
    table.append(f"| Episodes exhausting the curiosity budget | {exhausted} | {len(flags)} |")
    steps = [r["intrinsic_exhaustion_step"] for r in rows if isinstance(r.get("intrinsic_exhaustion_step"), (int, float))]
    table.append(f"| Mean exhaustion step (recorded exhaustion only) | {fmt(mean(steps))} | {len(steps)} |")
    lines += ["\n".join(table), f"Source: `training_episodes.jsonl`, {len(rows)} completed episode rows. "
              "Unfinished episodes are excluded. Contact and no-visibility payouts may overlap; do not add them. "
              "A zero total payout makes payout shares undefined (N/A), not zero."]
    episodes = first_search_episodes(run["directory"] / "worker0_reward_trace.jsonl")
    lines += [f"Worker-0 eligible completed traces available: {len(episodes)}/3. "
              "Source: `worker0_reward_trace.jsonl`. No missing episodes or curiosity measurements are fabricated."]
    for rank, episode in enumerate(episodes, 1):
        x = [r["step"] for r in episode]
        def values(key):
            return [r[key] if r.get(key) is not None else np.nan for r in episode]
        discovery = next((r["step"] for r in episode if r.get("discovered")), None)
        exhaustion = next((r["step"] for r in episode if r.get("intrinsic_total", 0) is not None and r.get("intrinsic_total", 0) >= 1-1e-7), None)
        fig, axes = plt.subplots(3, 2, figsize=(12, 9), sharex=True, layout="constrained")
        axes[0, 0].plot(x, values("raw_error"), label="Raw prediction error")
        axes[0, 0].plot(x, values("rms"), label="Logged RMS", alpha=.8)
        axes[0, 0].set(title="Prediction error and normalizer", ylabel="Error / RMS")
        axes[0, 1].plot(x, values("normalized_error"), color="#0072B2", label="Logged normalized error")
        axes[0, 1].set(title="Normalized error (clipped to [0, 1])", ylabel="Normalized error", ylim=(-.03, 1.05))
        terms = sorted({k for r in episode for k in r.get("reward_terms", {})})
        for key in terms:
            axes[1, 0].plot(x, [r.get("reward_terms", {}).get(key, np.nan) for r in episode], label=key, lw=1)
        axes[1, 0].plot(x, values("extrinsic"), label="Total task reward", color="black", ls="--", lw=1.2)
        axes[1, 0].set(title="Task reward components per step", ylabel="Reward")
        axes[1, 1].plot(x, values("intrinsic_total"), color="#CC79A7", label="Logged cumulative payout")
        axes[1, 1].axhline(1, color="0.5", ls=":", label="Episode budget = 1")
        axes[1, 1].set(title="Cumulative curiosity payout", ylabel="Reward", ylim=(-.03, 1.08))
        axes[2, 0].step(x, values("collision"), where="post", color="#D55E00", label="Collision")
        axes[2, 0].set(title="Contact trace", ylabel="Collision (0 / 1)", yticks=[0, 1], ylim=(-.05, 1.1))
        axes[2, 1].step(x, values("new_visible_cells"), where="post", color="#009E73", label="Newly visible cells")
        axes[2, 1].set(title="New visibility per step", ylabel="Cell count")
        for i, ax in enumerate(axes.flat):
            for step, color, label in ((discovery, "#009E73", "First discovery"), (exhaustion, "#D55E00", "Budget exhausted")):
                if step is not None:
                    ax.axvline(step, color=color, ls=":" if label == "First discovery" else "--", lw=1.2, label=label if i == 0 else None)
            ax.grid(alpha=.2)
            ax.legend(fontsize=7, ncol=2)
            ax.xaxis.set_major_locator(MaxNLocator(6, integer=True))
        for ax in axes[-1]:
            ax.set_xlabel("Worker-0 episode step")
        ep_id = episode[0]["episode"]
        ending = ("target reached" if episode[-1].get("reward_terms", {}).get("goal", 0) > 0
                  else "terminal failure" if episode[-1].get("true_terminal") else "time limit")
        fig.suptitle(f"{run['name']} — worker 0, selected episode {rank}/3 (log ID {ep_id})\n"
                     f"Completed: {ending}; discovery: {discovery if discovery is not None else 'not observed'}; "
                     f"budget exhausted: {exhaustion if exhaustion is not None else 'not observed'}", fontsize=11)
        lines += [f"Selection {rank}: log episode {ep_id}, recorded global transitions "
                  f"{episode[0].get('transitions')}–{episode[-1].get('transitions')}; {len(episode)} worker-0 steps. "
                  "End type does not by itself identify success.",
                  save(fig, out, f"{run['name']}_worker0_reward_first{rank}.png")]
    return lines


def diagrams(baseline, out):
    """Static module/data-flow and reward diagrams; no trained results inferred."""
    fig, ax = plt.subplots(figsize=(12, 5), layout="constrained")
    ax.set(xlim=(0, 12), ylim=(0, 5))
    ax.axis("off")
    boxes = [(1.8, 3.8, "seeker_env / curiosity\nEnvironment and optional\ntraining reward module"),
             (6, 3.8, "seeker_runner\nPolicy training + checkpoints\nFrozen deterministic evaluation"),
             (10.2, 3.8, "seeker_metrics\nEpisode diagnostics\nFixed-maze replay frames"),
             (6, 2, "Campaign artifacts\nJSON / JSONL / replay gzip\nTensorBoard progress.csv"),
             (6, .5, "seeker_report (offline)\nStatic PNGs + Markdown; no training")]
    for x, y, label in boxes:
        ax.text(x, y, label, ha="center", va="center", fontsize=10,
                bbox=dict(boxstyle="round,pad=.6", fc="#e8f1f7", ec="#0072B2"))
    for start, end in [((3.3, 3.8), (4.35, 3.8)), ((7.65, 3.8), (8.7, 3.8)),
                       ((6, 3.2), (6, 2.65)), ((10.2, 3.2), (7.8, 2.2)), ((6, 1.4), (6, 1.05))]:
        ax.annotate("", xy=end, xytext=start, arrowprops=dict(arrowstyle="->", color="0.3", lw=1.4))
    ax.set_title("Research modules and saved-evidence flow", fontsize=14)
    links = [save(fig, out, "modules.png")]
    fig, axes = plt.subplots(1, 2, figsize=(12, 5), layout="constrained")
    ax = axes[0]
    ax.axis("off")
    ax.set(xlim=(0, 10), ylim=(0, 10))
    ax.text(5, 8.3, "Recorded environment reward_terms\nprogress · exploration · sight\ntime · collision · goal", ha="center", va="center",
            bbox=dict(boxstyle="round,pad=.7", fc="#e8f1f7", ec="#0072B2"))
    ax.annotate("", xy=(5, 5.8), xytext=(5, 7), arrowprops=dict(arrowstyle="->"))
    ax.text(5, 5, "Frame reward → episode sum\nPer-step and cumulative replay traces", ha="center", va="center",
            bbox=dict(boxstyle="round,pad=.7", fc="#e8f1f7", ec="#0072B2"))
    ax.text(5, 1.7, "Optional training curiosity payout is logged separately.\nFrozen evaluations use the control environment.\nNo intrinsic payout is inferred from evaluation frames.", ha="center", va="center", fontsize=9)
    ax = axes[1]
    rows = baseline["rows"] if baseline else []
    keys = sorted({k for r in rows for k in r.get("reward_terms", {})})
    if keys:
        values = [mean([r.get("reward_terms", {}).get(k, 0) for r in rows]) for k in keys]
        bars = ax.barh(keys, values, color=["#009E73" if v >= 0 else "#D55E00" for v in values])
        ax.bar_label(bars, fmt="%.2f", padding=4, fontsize=9)
        ax.axvline(0, color="0.4", lw=.7)
        ax.margins(x=.25)
        ax.set(xlabel="Mean episode reward contribution", title=f"Baseline: recorded terms, n={len(rows)}")
    else:
        ax.text(.5, .5, "Baseline reward terms unavailable", transform=ax.transAxes, ha="center")
    fig.suptitle("Reward accounting and observed baseline contributions", fontsize=14)
    links.append(save(fig, out, "reward_diagram.png"))
    return links


def replays(ev, selection="fixed_seed"):
    data = read(Path(str(ev["prefix"]) + "_replays.json.gz"), {})
    return {e["seed"]: e for e in data.get("episodes", []) if selection in e.get("labels", [])}


def replay_plots(panels, out, stem, selection="fixed_seed"):
    """Fixed paired panels or explicitly labelled, unpaired selected failures."""
    panels = [(label, replays(ev, selection)) for label, ev in panels]
    seeds = sorted(set().union(*(set(data) for _, data in panels)))
    if not seeds:
        return ["No saved replay for " + selection + "."]
    links = []
    # Separate figures by maze keeps panels legible as run count grows.
    for seed in seeds:
        fig, axes = plt.subplots(1, len(panels), figsize=(5*len(panels), 6.3), squeeze=False)
        fig.subplots_adjust(left=.10, right=.97, bottom=.22, top=.80, wspace=.30)
        reward_fig, reward_axes = plt.subplots(len(panels), 2, figsize=(11, 3.3*len(panels)), squeeze=False, sharex=True, sharey="col", layout="constrained")
        for col, (label, data) in enumerate(panels):
            ax = axes[0, col]
            if seed not in data:
                ax.text(.5, .5, "Replay unavailable", ha="center", transform=ax.transAxes)
                for a in reward_axes[col]:
                    a.text(.5, .5, "Replay unavailable", ha="center", transform=a.transAxes)
                continue
            ep = data[seed]
            frames = ep["frames"]
            xy = np.array([f["position"] for f in frames])
            centers = np.array(ep.get("coverage_centers", []))
            cleared = sorted({i for f in frames for i in f.get("coverage_new", [])})
            if len(centers) and cleared:
                pts = centers[cleared]
                ax.scatter(pts[:, 0], pts[:, 1], marker="s", s=13, color="#56B4E9", alpha=.25, label="Observed cells")
            for x, z, radius in ep["obstacles"]:
                ax.add_patch(Circle((x, z), radius, fc="0.65", ec="0.35", lw=.6))
            ax.plot(xy[:, 0], xy[:, 1], color="#0072B2", lw=1.3, label="Path")
            hit = np.array([bool(f.get("collision")) for f in frames])
            ax.scatter(xy[hit, 0], xy[hit, 1], c="#D55E00", marker="x", s=22, label="Collision")
            ax.scatter(*xy[0], c="black", marker="o", s=25, label="Start")
            ax.scatter(*xy[-1], c="black", marker="s", s=25, label="End")
            ax.scatter(*ep["target"], c="#CC79A7", marker="*", s=150, edgecolors="black", linewidths=.5, label="Target")
            detection = ep["metrics"].get("detection_step")
            if detection is not None:
                ax.scatter(*xy[detection], facecolors="none", edgecolors="#009E73", marker="D", s=85, linewidths=2, label=f"Discovery t={detection}")
            limit = ep["world_limit"]
            ax.set(xlim=(-limit, limit), ylim=(-limit, limit), aspect="equal", xlabel="x (world units)", ylabel="z (world units)",
                   title=label + "\n" + ("Success" if ep["metrics"]["success"] else "Failure") + f"; coverage {fmt(ep['metrics'].get('coverage_final'), True)}")
            ax.legend(fontsize=7, loc="upper center", bbox_to_anchor=(.5, -.15), ncol=3)
            terms = sorted({k for f in frames[1:] for k in f.get("info", {}).get("reward_terms", {})})
            traces = {k: [f.get("info", {}).get("reward_terms", {}).get(k, 0) for f in frames[1:]] for k in terms}
            traces["total reward"] = [f.get("reward", np.nan) for f in frames[1:]]
            for k, values in traces.items():
                for j, a in enumerate(reward_axes[col]):
                    a.plot(range(1, len(frames)), np.cumsum(values) if j else values, label=k, lw=1.1)
            for j, a in enumerate(reward_axes[col]):
                if detection is not None:
                    a.axvline(detection, ls=":", color="#009E73", label="Discovery")
                a.set(xlabel="Episode transition", ylabel="Cumulative reward" if j else "Reward per transition", title=label)
                a.grid(alpha=.2)
            reward_axes[col, 1].legend(fontsize=7, ncol=3)
        kind = "Fixed maze" if selection == "fixed_seed" else "Selected worst failure; maze"
        fig.suptitle(f"{kind} {seed} — observed coverage, path and contacts")
        reward_fig.suptitle(f"{kind} {seed} — recorded deterministic replay rewards")
        links.append(save(fig, out, f"{stem}_maze_{seed}.png"))
        links.append(save(reward_fig, out, f"{stem}_reward_{seed}.png"))
    return links


def results(ev):
    s = ev["summary"]
    lines = [f"Deterministic evaluation: {s.get('episodes', 'N/A')} mazes.", "",
             "| Metric | Value |", "|---|---:|"]
    metrics = [(title, key, True) for title, key in zip(TITLES, RATES)] + [
        ("Successful arrival time (steps; successes only)", "mean_arrival_steps", False),
        ("Failure-capped arrival time (steps; all mazes)", "mean_arrival_steps_capped", False),
        ("Failure-capped discovery time (steps; all mazes)", "mean_detection_steps_capped", False),
        ("Successful pursuit time (steps)", "mean_pursuit_steps_success", False),
        ("Failure-capped pursuit time (steps; discovered only)", "mean_pursuit_steps_capped", False),
        ("Final observed coverage", "mean_coverage_final", True),
        ("Pooled collision step rate", "pooled_collision_rate", True),
        ("Mean reward", "mean_reward", False)]
    lines.extend(f"| {title} | {fmt(s.get(key), percent)} |" for title, key, percent in metrics)
    lines += ["", "Times are simulation steps, not compute wall time. Failures receive the episode cap for arrival/discovery; pursuit uses the remaining cap after discovery. Conditional success uses discovered episodes only. N/A means unobserved/undefined.",
              "", f"Source: `{ev['prefix']}_summary.json` and companion episode/replay files."]
    failures = [r for r in ev["rows"] if not r["success"]]
    if failures:
        contact = sum(bool(r.get("stuck") or r.get("frozen")) for r in failures)
        lines += ["", f"Stuck or frozen: {contact}/{len(failures)} failures (union of flags, no double counting)."]
    return ["\n".join(lines)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", type=Path, default=CAMPAIGN)
    parser.add_argument("--bootstrap-samples", type=int, default=10000)
    args = parser.parse_args()
    if args.bootstrap_samples < 100:
        parser.error("--bootstrap-samples must be at least 100")
    campaign = args.campaign.resolve()
    if not campaign.is_dir():
        parser.error(f"Campaign does not exist: {campaign}")
    out = campaign / "report"
    out.mkdir(exist_ok=True)
    plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
    baseline = evaluation(campaign / "baseline_dev", 0)
    runs = []
    for directory in sorted(campaign.iterdir()):
        if not directory.is_dir() or directory == out or not (directory / "config.json").exists():
            continue
        run = dict(name=directory.name, directory=directory, config=read(directory/"config.json", {}),
                   status=read(directory/"status.json", {}), evals=[],
                   training=jsonl(directory/"training_episodes.jsonl"), rollouts=jsonl(directory/"rollouts.jsonl"), progress=[])
        logs = {r["transitions"]: r for r in jsonl(directory/"evaluations.jsonl")}
        for path in directory.glob("dev_*_summary.json"):
            match = re.fullmatch(r"dev_(\d+)_summary.json", path.name)
            if match:
                step = int(match[1])
                ev = evaluation(directory/f"dev_{step}", step, logs.get(step, {}).get("wall_seconds"))
                if ev:
                    run["evals"].append(ev)
        run["evals"].sort(key=lambda e: e["step"])
        progress = directory / "tensorboard/progress.csv"
        if progress.exists():
            with progress.open(encoding="utf-8", newline="") as stream:
                run["progress"] = list(csv.DictReader(stream))
        runs.append(run)
    index = ["# Seeker campaign report", "", f"Generated {datetime.now(timezone.utc).isoformat()} from `{campaign}`.", "",
             "Only completed saved evaluations are results. Training curves are stochastic rolling estimates, not deterministic deployment scores. Wall time is session elapsed time (evaluations included where recorded); training wall coordinates interpolate rollout clocks or TensorBoard progress inside the observed range only. Resumed transition counters may include earlier training; wall clocks do not.", "",
             f"Paired bootstrap: {args.bootstrap_samples:,} resamples of identical maze seed panels, percentile 95% intervals, fixed RNG seed 20260909. Differences are current minus reference. These quantify maze sampling uncertainty for fixed policies, not training-seed variability; development comparisons are exploratory and not adjusted for checkpoint selection or multiple comparisons.", ""]
    if baseline:
        content = ["# Baseline development evaluation", "", "Donor reference at 0 additional campaign transitions; its prior training is not zero.", ""] + results(baseline)
        content += ["", outcomes(baseline, "Baseline", out, "baseline")]
        content += replay_plots([("Baseline", baseline)], out, "baseline")
        content += replay_plots([("Baseline — selected worst failure", baseline)], out, "baseline_worst", "worst_failure")
        (out/"baseline.md").write_text("\n\n".join(content)+"\n", encoding="utf-8")
        index += ["[Baseline results](baseline.md)", ""]
    else:
        index += ["Baseline evaluation unavailable.", ""]
    index += diagrams(baseline, out)
    for run in runs:
        name = run["name"]
        content = [f"# {name}", f"Saved status: {run['status'].get('status', 'unknown')}; recorded transitions: {run['status'].get('transitions', 'unknown')}. Requested additional budget: {run['config'].get('requested_additional_transitions', 'unknown')}.", learning(run, baseline, out)]
        variant = run["config"].get("variant")
        change, hypothesis = run_description(run["config"])
        content += ["**What changed:** " + change,
                    "**Expected effect (hypothesis, not a result):** " + hypothesis,
                    "Evaluations use frozen control rewards and the run's configured sensors. Variant-specific training payouts are not part of these deterministic scores."]
        if variant in ("removal", "icm") or (run["directory"] / "worker0_reward_trace.jsonl").exists():
            content += curiosity_report(run, out)
        if not run["evals"]:
            content += ["No completed deterministic development evaluation is present. No final result or policy improvement is claimed."]
        else:
            latest = run["evals"][-1]
            label = f"{name} @ {latest['step']:,}"
            is_final = run["status"].get("status") == "complete" and run["status"].get("transitions") == latest["step"]
            content += [f"{'Final' if is_final else 'Latest checkpoint (not final)'} evaluation: {latest['step']:,} recorded transitions."] + results(latest)
            s = latest["summary"]
            content += [f"**What actually happened:** reached the target in {fmt(s.get('success_rate'), True)} of mazes and discovered it in {fmt(s.get('detection_rate'), True)}. After discovery, {fmt(s.get('success_given_detection'), True)} reached it. This describes the saved evaluation; it does not by itself show why behavior changed."]
            if baseline:
                content += ["Success difference versus donor baseline (0 additional transitions; reference, not matched training budget): " + bootstrap(latest["rows"], baseline["rows"], args.bootstrap_samples)]
            references = comparison_references(run, runs)
            if variant == "icm" and not any(r["name"] == "removal_250k" for r, _ in references):
                content += ["Versus removal_250k: matching sensor/input configuration is not available; no reward-only comparison claimed."]
            for control, purpose in references:
                common = sorted({e["step"] for e in run["evals"]} & {e["step"] for e in control["evals"]})
                if not common:
                    content += [f"{purpose} — versus {control['name']}: no matched recorded evaluation budget available."]
                    continue
                budget = common[-1]
                a = next(e for e in run["evals"] if e["step"] == budget)
                b = next(e for e in control["evals"] if e["step"] == budget)
                final = all(r["status"].get("status") == "complete" and r["status"].get("transitions") == budget for r in (run, control))
                content += [f"{purpose} — versus {control['name']} at {budget:,} recorded transitions each — " + ("matched final budgets" if final else "matched checkpoint budgets; not matched final results") + ": " + bootstrap(a["rows"], b["rows"], args.bootstrap_samples)]
                content += replay_plots([(f"{control['name']} @ {budget:,}", b), (f"{name} @ {budget:,}", a)], out, f"{name}_vs_{control['name']}_{budget}")
            content += [outcomes(latest, label, out, name)]
            content += replay_plots(([('Baseline (0 additional)', baseline)] if baseline else []) + [(label, latest)], out, name)
            content += ["Selected worst failure below is outcome-selected, not a representative or paired maze comparison."]
            content += replay_plots([(label, latest)], out, name + "_worst", "worst_failure")
        (out/f"{name}.md").write_text("\n\n".join(content)+"\n", encoding="utf-8")
        index += [f"[{name}]({name}.md)", ""]
    # Confirmation is reported separately and never merged into development curves.
    for path in sorted(campaign.glob("*_confirmation_summary.json")):
        prefix = path.with_name(path.name.removesuffix("_summary.json"))
        ev = evaluation(prefix)
        if ev:
            filename = prefix.name + ".md"
            (out/filename).write_text("\n\n".join(["# " + prefix.name, "Independent confirmation panel; training budget not inferred from filename."] + results(ev))+"\n", encoding="utf-8")
            index += [f"[{prefix.name}]({filename})", ""]
    index += ["Paired trajectory panels use saved fixed_seed replays, with identical maze IDs across columns; absent replays stay blank. Separate selected-worst panels use each evaluation's saved worst_failure label: undetected first, then lowest coverage, longest collision streak, longest episode, and input order for ties. They are outcome-selected and are never paired across different maze IDs. Observed cells denote visibility coverage, not visited ground. Reward traces use saved frame rewards and reward_terms; evaluation does not establish training-only intrinsic payouts. Only files linked from this report belong to this snapshot."]
    if (out / "confirmation_comparison.md").exists():
        index += ["", "[Frozen candidate versus control: reserved-maze confirmation](confirmation_comparison.md)"]
    (out/"README.md").write_text("\n".join(index)+"\n", encoding="utf-8")
    print(f"Report written to {out / 'README.md'}")


if __name__ == "__main__":
    main()
