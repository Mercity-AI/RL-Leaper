# Seeker geometry and recovery audit — 9 September 2026

**Finding:** the sampled LSTM contact failures had available local recovery moves.
All 18 sampled stalled poses allowed approximately 0.375 units of immediate
translation and a separate safe pivot-then-forward sequence before termination.
Their recorded actions instead produced zero translation and outer-leg contact.
This supports missed local recovery choices, not demonstrated physical entrapment.
It does **not** prove that these alternatives reach the goal or fully escape contact.

## Scope and provenance

Audit only. No model inference, full-model evaluation, training launch/stop,
controller implementation, shared environment edit, or confirmation-set access.
Counterfactual poses were assigned only to isolated diagnostic objects. The two
training workers were left alone. Queue status read at intake reported running,
PIDs 24056/10820, no failures; LSTM status then reported 1,204,224 collected steps.
That live step is not the checkpoint audited here. The parent dispatched this
audit with model `gpt-6-astra` and reasoning effort `low`; the audit agent itself
did not change its model settings.

The fixed input set is `residual_lstm_extension_2m/dev_{step}_replays.json.gz`
at steps **1,056,768; 1,105,920; 1,155,072** under the active campaign. The final
probe completed at 2026-09-09 17:52:55 UTC, taking about 3 seconds, one process,
with BLAS/OpenMP threads limited to one. An initial run took another 3 seconds;
the final run added pose margins and launch-source hash checks.

Each file retains seeds 30000–30003 plus selected worst failure 30130. All retained
failures were included: 30000 (post-discovery stuck), 30002 (pre-discovery timeout),
30130 (pre-discovery stuck). Thus nine episode/checkpoint pairs represent only
**three distinct mazes**, not nine independent seeds. Successful retained replays
were excluded. The worst-failure selection favors undetected, low-coverage failures
and is not a random failure sample; see `rl/seeker_metrics.py:252`.

For each stuck episode, sample the onset, midpoint and final pre-action pose of its
terminal no-translation streak. Frame indices are 13/32/52 for seed 30000 and
1/20/40 for seed 30130, at each checkpoint. For moving timeout seed 30002, sample
only frame 999. A frame index is the number of completed transitions; action on
frame i+1 is tested from pose i. Total: **21 poses**, including 18 stalled poses.

The JSON stores exact checkpoint/seed/frame, position, yaw, target, obstacles,
discovery state, reconstructed counters, original action, alternatives, and
SHA-256 hashes of all three replay files and corresponding checkpoint archives.
Checkpoint archives were hashed as bytes, never loaded. Current environment,
seeker wrapper, contact diagnostic and experiment wrapper hashes match the run's
launch manifest. No claim is made about untested source or model equivalence.

## What the code permits and forbids

| Mechanism | Consequence | Reference |
|---|---|---|
| Body circle plus three radius-0.24 samples along each of six legs, at offsets 1.2/2.2/3.24 | 19 collision circles; rotating changes the footprint. A clear body does not imply a clear leg pivot. `leg-3` means the outer sample on any leg. | `rl_environment.py:337` |
| Collision tests at candidate poses | Discrete endpoint geometry, not swept-volume or articulated-mesh physics. Claims here concern the simulator. | `rl_environment.py:351` |
| Normalized throttle `(a+1)/2` | -1 stops, 0 moves half speed, +1 moves full speed; no reverse. Maximum translation 0.375 and turn 9 degrees per step. Historical comments about reversing are stale for this seeker. | `rl/seeker_env.py:9`, `rl_environment.py:225` |
| Combined turn-and-move attempted first; if blocked, safe in-place rotation, then safe translation along resolved facing | An attempted turn can fail while forward movement succeeds, or vice versa. No automatic alternate turn, reduced throttle, backtracking or recovery sequence is chosen. The original intended-collision flag remains set after successful fallback. | `rl_environment.py:842` |
| Stuck counter: intended collision AND translation <=0.001 | Forty consecutive qualifying steps terminate. Safe zero-throttle pivot resets stuck because its intended pose is clear; fallback rotation during a still-colliding intent does not. Any translation >0.001 resets stuck, regardless of target progress. | `rl_environment.py:894` |
| Freeze counter: any translation <=0.001 | Sixty consecutive steps terminate even if rotating into new views. Rotation does not reset freeze. The rule is evaluated after movement, so translation on the threshold step can reset it. | `rl_environment.py:911` |
| Episode cap 1000 | Moving freely can still time out. Stuck/frozen are terminal failures; cap alone is truncation. | `rl_environment.py:934` |

The layout guard is a coarse body-only flood fill, requiring a large target-connected
region. It does not check orientation/leg reachability from every sampled start or
forward-only maneuver feasibility. After bounded layout retries, generation returns
the last layout even if the guard fails (`rl_environment.py:265`, `:323`). Therefore
the comments saying “guaranteed reachable” are stronger than the implementation.
This is a static limitation, not evidence that it caused these sampled failures.

## Probe results and checks

The script reuses only `resolve` and `margins` from the reviewed contact diagnostic
via AST extraction, avoiding its historical PPO/model-evaluation entry point.
Immediate probes use nine coarse actions and a 5-throttle × 41-turn grid.
Rotation probes try zero throttle with turn rates ±1, ±0.5, ±0.1, up to 60 pivots,
testing nine actions after each feasible pivot. They stop at the first translation
witness per direction/rate; they do not search arbitrary action sequences.

| Result | Count / interpretation |
|---|---|
| Saved geometry transitions checked | 3,282; zero position/yaw/intended-collision mismatches |
| Independent calls to unmodified `SeekerEnv.step` | 189; all nine-action pose/counter/termination checks passed |
| Immediate translation available | 21/21 poses, including full-speed alternatives at all 18 stalled poses; coarse grid already found movement in all 21 |
| Legal pivot-then-translation | 18/18 stalled poses; one safe pivot followed by translation sufficed for a witness |
| Saved collision classification at stalled poses | 18/18 `leg-3`; all sampled starting poses collision-free |
| Timeout poses | 3/3 moving and geometrically mobile, but already at frame 999 |

The JSON contains 21 candidate witness records cut by episode rules, all from
those three timeout poses (one immediate candidate and six pivot candidates each).
They are **not** 21 physically trapped states. An immediate move executes on step
1000 but the episode then truncates; a pivot cannot be followed by another action.
No sampled frozen ending or rotation-only state was present, so the audit has no
empirical estimate for those categories. Sequence counter accounting follows the
reviewed rules; the 189 real-step checks validate immediate alternatives, not every
counterfactual sequence, reward or observation.

Concrete witness: checkpoint **1,155,072**, seed **30130**, pre-action frame **40**,
position **[20.454988479614258, -22.33033561706543]**, yaw
**1.6473541512207177 radians**, stuck/freeze **39/39**. Body clearance is about
2.4575, but minimum leg clearance only 0.000258 units. The saved action
`[1, 0.01697271317243576]` moves zero and ends stuck. Alternative `[1,-1]`
turns -9 degrees and moves 0.375 without collision. Separately:

1. `[-1,-1]`: safe pivot, no translation, counters become stuck 0/freeze 40.
2. `[1,0]`: forward 0.375, counters both reset to zero; episode remains active.

This demonstrates that being one count from stuck does not necessarily prevent
recovery. It does not demonstrate a complete route through the surrounding maze.

## Findings versus remaining hypotheses

**Supported:** these sampled contact failures were not forced to remain stationary
by the 19-point geometry, forward-only action space or imminent stuck termination.
The policy missed available local moves both before and after discovery. No fallback
implementation mismatch was found in the checked transitions.

**Still hypotheses:** some other poses may require longer coordinated turns and
translations, or may be trapped under the forward-only footprint constraints.
Independent fallback is a local resolver, not a completeness guarantee. A safe
180-degree turn takes 20 maximum-rate steps only if every tested orientation is
clear; a full turn takes 40. With freeze already at 39, 20 stationary pivots leave
it at 59 and translation on the next step can survive. A slower turn, blocked
orientations, or a nearly exhausted episode budget may prevent the sequence.
The geometry itself is not changed by the counters; the counters limit available
time to act. Extending their limits might help some cases but these samples do
not establish that benefit, nor justify a rule change.

Sparse-grid or bounded-sequence failure could never prove exhaustive impossibility.
Here all sampled poses had an immediate witness, but local movement is weaker than
escaping a contact neighborhood and much weaker than eventual arrival. The small,
correlated, failure-selected sample cannot rank overall policy quality, identify
why learning missed these moves, or establish how often genuine traps occur.

## Deliverables

- `docs/SEEKER_ESCAPE_AUDIT_2026-09-09.md` — this report.
- `rl/seeker_escape_audit.py` — standalone bounded replay diagnostic; run with
  the bundled interpreter and repository site-packages using `-m rl.seeker_escape_audit`.
- `rl_artifacts/seeker_scratch_lr_20260909/escape_audit/escape_audit_2026-09-09.json`
  — detailed diagnostic/provenance, under ignored campaign artifacts.

These are the only audit deliverables. Existing unrelated working-tree changes
were left in place. No assistance controller was implemented.
