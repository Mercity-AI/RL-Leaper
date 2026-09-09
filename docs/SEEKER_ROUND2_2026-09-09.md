# Seeker round two: failure-directed static-target experiments

User scope: five to ten additional configurations, one training run each, static
target, changes guided by evidence, seek >90% deterministic arrival. LSTM is optional.
The first round's held-out result is 80.7% arrival versus 75.8% matched control.
Discovery was 91.2% versus 91.3%; the gain was primarily arrival after discovery.
Of 193 remaining failures, 103 were post-discovery stuck endings. This motivates
recovery and pursuit experiments more directly than increasing discovery bonuses.

## Frozen initial screen

Common donor: `rl_artifacts/seeker_20260909/removal_250k/model_253952.zip`.
All arms transfer the same policy/value weights and log standard deviations,
start fresh Adam optimizers and fresh episodes, and use one common newly drawn
training seed recorded in `rl_artifacts/seeker_round2_20260909/protocol.json`.
The donor already inherited substantial training: these are additional transitions.
The unused curiosity module from the first round's removal comparator is omitted.
It cannot affect policy gradients, but its runtime/RNG overhead is not reproduced.

PPO: 8 workers × 1,024 steps, batch 256, 10 epochs, learning rate 0.00015,
gamma 0.995, GAE 0.95, entropy 0.01 except the named entropy arm. Each initial
arm receives 253,952 additional transitions; checkpoints at 106,496 and 253,952.
CPU fallback remains authorized and active. Torch is 2.13.0+cpu; no installation
or GPU package change was made. TensorBoard: http://127.0.0.1:6006/.

| Arm | Change and hypothesis |
|---|---|
| continuation | More optimization alone may consolidate reward removal. |
| low_entropy | Entropy coefficient 0.01 → 0.001; less training action noise may help deterministic refinement. |
| footprint | Add the previously tested 16 whole-footprint clearances to reward removal; 50 inputs. |
| history | Append full observations from 1, 4, 16 decisions earlier; missing history is zero and episode-local; 136 inputs. |
| resolved_contact | Refund the ordinary 0.18 collision cost when fallback produces actual translation >0.001 or rotation >0.001 radians. Terminal stuck/freeze fines remain intact. |
| phase_experts | Separate two-layer 64-unit actor and critic branches for search versus pursuit, gated by the existing remembered target direction; shared final action/value projections. Both branches start as exact copies of the donor. |

No action replacement, easier collision geometry, moving target, changed episode
cap, target-coordinate oracle, or hidden evaluation-time recovery controller is
introduced. The phase gate uses information already present in the observation.
The history and phase architectures also change parameter count; gains would not
by themselves isolate memory/task separation from model capacity. If promising,
a matched-capacity control is an appropriate adaptive follow-up.

Four initial checks pass: exact donor mean/value transfer across all six branches,
history lag/reset behavior, identical physics/endings under the recovery reward,
and canonical evaluation reward equivalence. Source snapshots, model hashes,
training episode JSONL, rollout logs, TensorBoard, deterministic episode outcomes,
failure splits and fixed/worst replays are saved per run. Report all final results
as well as the development-selected checkpoint. Training success is separate.

## Evaluation and adaptation

Development remains seeds 30000–30199, explicitly reused for model development.
The earlier 80000–80999 exam is now an observed benchmark and can inform diagnosis;
it is not an untouched test for this round. Reserve 120000–120999 for confirmation.
A search of prior config/evaluation/summary/protocol artifacts found only decimal
reward substrings containing 120000, not evidence of that seed panel being used.
Freeze the selected checkpoint and model hashes before the new exam. Select highest
development arrival, tie fewer stuck/frozen endings, then lower failure-capped
arrival time. Compare with an equally trained control, preserving maze pairing.

After six initial arms, analyze failures and use at most four further configurations
or explicitly documented continuations. Do not automatically combine every change.
An LSTM is one option if failure history is a credible bottleneck. The earlier
proposed residual 64-unit recurrent branch is not implemented by this runner;
it requires sequence/burn-in/reset/timeout handling and a roughly 500k healthy
learning floor. Do not relabel the history or phase-expert branches as recurrent.

## Research basis and boundaries

SB3's official documentation recommends trying observation history as a simpler
alternative to recurrent PPO, and its recurrent implementation requires carrying
hidden states and resetting them at episode starts. Our history arm is a sparse
finite-history variant, not an exact reproduction of its benchmark:
[SB3 documentation](https://stable-baselines3.readthedocs.io/en/master/modules/ppo.html),
[Recurrent PPO](https://sb3-contrib.readthedocs.io/en/master/modules/ppo_recurrent.html).

Reward shaping does not automatically preserve the original optimum. The recovery
refund is a deliberate objective change, not a potential-based invariant shaping
claim; the unchanged deterministic arrival exam is its practical decision criterion.
The classic theory is [Ng, Harada and Russell, 1999](https://ai.stanford.edu/~ang/papers/shaping-icml99.pdf).

## Results and running notes

The six-arm queue has started with continuation. No round-two improvement is claimed
before deterministic checkpoints complete. A separate audit replays all 44 failures
of the improved donor on development mazes to check geometry and immediate recovery
alternatives. Such alternatives show local mobility, not a proven path to the goal.

## Superseded by explicit from-scratch instruction

The owner clarified that every new comparison must start from random initialization,
and explicitly requested the parallel MLP + LSTM branch. The warm-start queue was
stopped: only continuation ran, last reported 188,416 collected transitions; latest
recoverable model is 106,496. Its 106,496 result was 74% arrival / 86.5% discovery.
No remaining arm launched. These partial results are archived and excluded from
all upcoming scratch comparisons. A separate scratch campaign will have a new
protocol, no donor load, and explicit initial-weight evidence. Earlier warm-start
success remains evidence about fine-tuning only, not scratch trainability.
