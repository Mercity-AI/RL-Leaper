# Repository Guidelines

## Current seeker work: read this before acting

Start with [docs/SEEKER_HANDOFF.md](docs/SEEKER_HANDOFF.md) for cross-chat context,
then [docs/SEEKER_RUN_INDEX.md](docs/SEEKER_RUN_INDEX.md) for the generated run
ledger and [docs/SEEKER_SCRATCH_RUN_LOG_2026-09-09.md](docs/SEEKER_SCRATCH_RUN_LOG_2026-09-09.md)
for decisions. Read [docs/SEEKER_FINDINGS_AND_NEXT_EXPERIMENTS_2026-09-10.md](docs/SEEKER_FINDINGS_AND_NEXT_EXPERIMENTS_2026-09-10.md)
for the consolidated scientific findings, uncertainty, and next-session CPU and
experiment plan. All six screens and both2M extensions are COMPLETE; TensorBoard
is stopped and monitoring paused. Nothing is queued. Refresh live statuses under
`rl_artifacts/seeker_scratch_lr_20260909/` before reporting progress; do not restart
old supervisors or infer a launch from a planned experiment. Benchmark the new
multicore hardware before promising faster training. Preserve the one-run rule,
scratch origins, reserved confirmation, and explicit schedules.

The long "Current Handoff Status" below contains historical walker experiments,
not the current seeker state. In particular, historical seed-replication advice,
reward recipes and warm-start recommendations do not override the current owner
contract or later recorded experiment configurations. Current models use34 inputs
(136 for history), with explicit persistent last-seen target memory. The deployed
26-input browser ONNX remains separate and has not been replaced by these models.

## Explicit RL hyperparameter and schedule contract (owner instruction, 2026-09-09)

- Parameter matching is an experimental control, not a model-size restriction.
  The current LSTM is already additive: retain the original MLP branch and add
  memory capacity. Future experiments may enlarge either branch independently;
  record sizes and comparisons without sacrificing useful capacity just to match
  counts. Larger architectures must still originate from random weights.
- Announce each experiment at launch, not only when asked: exact run name, plain-
  language hypothesis, input/branch/output architecture and parameter count,
  initialization, changed versus shared settings, compute/budget, validation and
  known limitations, comparison control and next evaluation. Give five-minute
  status updates and report results/failures promptly. Distinguish implementation
  correctness checks from evidence that a model improves behavior.
- Evaluate new seeker runs approximately every50,000 environment transitions,
  aligned to completed PPO rollouts, and at the final checkpoint. Record exact
  evaluation steps and fixed development seeds in each run config. Preserve the
  reserved confirmation set; do not use it for frequent monitoring. Running Python
  processes do not pick up source edits: disclose any existing cadence that remains
  in effect rather than claiming a live change or restarting training silently.
- New seeker experiments must originate from random weights; do not silently load
  an old trained walker. Preserve initial-weight hashes, zero-step checkpoints and
  empty-optimizer evidence. Same-run extensions may continue their own scratch model.
- Specify every PPO setting and the learning-rate schedule in each run config. The
  current scheduled scratch screen uses linear decay from 0.00015 to 0.000015 over
  507,904 environment transitions, identically for MLP and recurrent controls.
- Test actual optimizer learning rates at intermediate and final progress for both
  trainers, and expose `train/learning_rate` in TensorBoard. A constant rate must
  never be an unnoticed inherited default; a future deliberate change needs a logged
  hypothesis and controlled comparison. Do not silently reset a decayed rate upward
  when extending a run; record the extension's schedule explicitly.
- PPO losses need not decrease monotonically. Judge deterministic arrival, discovery,
  pre/post-discovery failure rates and failure-capped times alongside KL, clipping,
  entropy and value diagnostics. Never present noisy training success as deployment
  success, or fine-tuning results as performance learned from scratch.
- Run each training configuration once unless the owner requests repetitions. Log
  interrupted runs and preserve them separately when owner instructions change.

## Project Structure & Module Organization

This repository is a compact Leaper simulation and reinforcement-learning proof of concept. The long-term goal is to turn it into a maintainable game/simulation project without losing the speed and clarity of the current prototype.

- `index.html`: small browser entry point containing the HUD and control markup.
- `src/main.js`: creates and connects the scene, world, target, robot, controls, camera, and simulation. Reads the URL mode: no query = the live-brain game (default), `?free` = keyboard free-roam demo, `?training` = recorded RL replay viewer.
- `src/brain/`: runs the trained champion live in the browser. `LeaperBrain.js` loads `public/leaper.onnx` and runs it via `onnxruntime-web` (26 numbers in, 2 out). `leaperWorld.js` is a faithful JavaScript port of the Python observation recipe and step math (constants, 16-ray vision cast, body/leg collision, `stepWorld`). `BrainDriver.js` ties them together each frame (build observation -> think -> step -> drive the rig), draws the 16 vision rays, cycles the arenas, and runs a startup faithfulness self-test against `public/brain_fixtures.json`.
- `export_to_onnx.py`: one-time export of the champion PPO `.zip` to `public/leaper.onnx` (bare deterministic-action network, with a 1000-sample ONNX-vs-SB3 equivalence check).
- `make_brain_fixtures.py`: generates `public/brain_fixtures.json` from the real Python env + ONNX brain — ground-truth self-test cases (state -> exact 26 observation numbers + action) and playable reachable arenas — so the JavaScript port can prove itself in the browser.
- `src/core/`: renderer, scene, lighting, and resize setup.
- `src/robot/`: procedural hexapod construction; keep visual model-building here.
- `src/world/`: terrain, obstacle generation, collision data, and target objects.
- `src/controls/` and `src/camera/`: keyboard, touch, pointer, and camera behavior.
- `src/simulation/`: movement, jumping, collision response, gait, inverse kinematics, and telemetry.
- `src/simulation/TrainingVisualizer.js`: replays recorded RL rollouts in the Three.js hexapod view and owns playback, rollout, checkpoint, live-feed, and log-import controls.
- `src/config/`: shared tuning values such as robot proportions and movement speeds.
- `src/styles/`: HUD and touch-control presentation.
- `src/world/createTrainingWorld.js`: browser representation of the Python RL arena, including its fixed obstacles, boundary, and target position.
- `rl_environment.py`: Gymnasium environment defining observations, continuous movement actions, rewards, collisions, and episode termination.
- `train_rl.py`: Stable-Baselines3 PPO training, evaluation, reward logging, plots, model export, and atomic browser-replay JSON publishing.
- `requirements-rl.txt`: Python RL and visualization dependencies.
- `README-RL.md`: setup, training, TensorBoard, and playback instructions.
- `TRAINING.md`: human-readable experiment ledger, configuration snapshot, run-by-run changes, results, diagnoses, and artifact locations.
- `RL_SPEC.md`: consolidated RL reference — sensors/observation channels, action space, model architecture and parameter count, and environment/experiment design. Keep in sync when observation, action, physics, reward, or PPO settings change.
- `rl_artifacts/`: generated models, CSV logs, plots, and TensorBoard data; do not commit large or transient outputs.
- `public/rl_live_state.json`: generated replay bridge consumed by the browser visualizer; it is ignored by Git and exists only after training publishes it.

There is currently no asset directory. Add `assets/` when external models,
textures, audio, or other media are introduced. Focused Python checks now live
under `tests/`, covering the forward-only throttle movement contract and
diagnostic classification (`test_ppo10_signed_throttle.py`), the ray observation
contract — shape, normalization, base channels (`test_ppo11_ray_vision.py`),
PPO_12 decoupled collision recovery — rotate-out and forward-blocked-holds
(`test_ppo12_collision_recovery.py`), PPO_13 randomized larger arena — obstacle
count, in-bounds, target clearance, per-episode variation, seed reproducibility,
and collision-free start (`test_ppo13_random_arena.py`), and PPO_18 human forward
vision — 270-degree cone, longer range, forward-only movement, symmetric rays,
and rear blind wedge (`test_ppo18_human_vision.py`).

## Project Direction

The original single-file prototype has been split into native JavaScript modules. Continue evolving it gradually while keeping a runnable version after every meaningful change. The intended direction is:

- Keep `index.html` small and styling under `src/styles/`.
- Keep scene setup, rendering, lighting, and cameras in focused JavaScript modules under `src/`.
- Separate the hexapod model, joints, locomotion, controls, collisions, terrain, obstacles, targets, and UI into modules with clear responsibilities.
- Store reusable models, textures, audio, and other media under `assets/` rather than embedding them in application logic.
- Keep Python RL code under an `rl/` package, separating the environment, reward design, training, evaluation, configuration, and model playback.
- Define one explicit interface between the browser simulation and RL code so simulation rules are not duplicated silently in JavaScript and Python.
- Add automated tests as modules are extracted, especially for movement math, collisions, observations, actions, rewards, and episode termination.
- Prefer small, reversible refactors over a full rewrite. Preserve behavior first, then improve it.

Current layout and intended expansion points:

```text
index.html
package.json
vite.config.js   # excludes onnxruntime-web from pre-bundling so its wasm loads cleanly
src/
  main.js
  brain/         # live trained brain in the browser (ONNX runtime + JS world port)
  camera/
  config/
  controls/
  core/
  robot/
  simulation/
  world/
  styles/
public/
  leaper.onnx          # exported champion brain (25 KB)
  brain_fixtures.json  # ground-truth self-test cases + playable arenas
assets/        # add when external media is introduced
rl/
tests/
docs/
```

The exact folders may evolve. Clear ownership and boundaries matter more than matching this tree perfectly.

## Current Handoff Status

- The original `Leaper-Hexapod.html` prototype was replaced by the Vite entry point and the modules under `src/`.
- Three.js is intentionally pinned to `0.128.0` to preserve the prototype's rendering behavior during the first refactor.
- `pnpm install` and `pnpm build` have completed successfully. The current production build has a non-blocking bundle-size warning because Three.js is included in the main bundle.
- Python syntax validation has passed for `rl_environment.py` and `train_rl.py` using the available bundled Python runtime.
- The browser now has a dedicated training view at `/?training=1`. It uses the real procedural hexapod, the fixed Python RL arena, animated gait, a light visual theme, draggable/zoomable top view, and a full-width media-style playback dock.
- The playback dock supports play/pause, frame scrubbing, two clearly labeled data modes, worker/episode selection for actual PPO training experience, selection among five exploratory checkpoint replays, earlier/later navigation, JSON replay import, and return to the live feed.
- `train_rl.py` publishes `public/rl_live_state.json` atomically after each 8,192-transition PPO rollout and at 10,000-step evaluations. It retains the latest three real training rollouts, split across eight workers with episode boundaries, plus checkpoint metrics and five exploratory recordings. This file bridge is for replay/monitoring, not browser-controlled training.
- Live-state replacement retries brief Windows file locks from simultaneous viewer reads, and the trainer saves a recoverable model checkpoint inside the selected ignored per-run artifact directory every 10,000 steps.
- `train_rl.py` accepts `--artifact-dir`; always give smoke tests and main experiments separate directories so models, checkpoints, CSVs, browser replays, console logs, and TensorBoard events cannot overwrite archived runs.
- Each run's `training_diagnostics.csv` records success/timeout, episode length, collision count/rate/streak, forward/reverse/stopped step percentages, mean signed and absolute throttle, net target progress, and each reward component for every completed training episode. A stopped action means `abs(throttle) <= 1e-8`; reverse is never classified as stopped.
- Each completed run writes `final_evaluation.json`, containing the fixed-seed 100-episode deterministic evaluation and a separate summary of the latest 100 stochastic training episodes. Do not mix stochastic training success with deterministic deployment success.
- The RL collision model checks the body plus three sample points along each of six legs (19 points total). Translation and rotation are rejected when any checked point intersects an obstacle or the world boundary. This is a planar approximation of the visual articulated legs, not mesh-level physics.
- Reward shaping is exactly `0.2 * (previous_distance - current_distance)`, plus a fixed `-0.01` time cost, `-0.18` on collision, and `+25` on terminal success. There are no alive, upright, energy, smoothness, fall, balance, or jump terms. Reward, observation, action, or collision changes invalidate prior trained policies and must be recorded in `TRAINING.md`.
- Local TensorBoard history identifies `PPO_2` as the strong 300,000-step body-only run: 60% deterministic evaluation success, 9.89 mean evaluation reward, about 41.2 best rolling training reward, and about 135 steps per episode near the end. It used the same PPO hyperparameters as `PPO_1`, but trained longer and did not include leg collisions. The later 19-point collision runs are substantially harder; the completed shaped-reward run reached 4% deterministic success at 300,000 steps.
- `PPO_8` completed 303,104 collected steps with the current net-distance reward design but finished at 0% deterministic success and -8.27 mean reward over its final 100-episode evaluation. Its deterministic policy issued zero forward throttle on 98.85% of steps and usually waited for the 400-step timeout, so extending this configuration unchanged is not recommended.
- `PPO_9` completed 106,496 collected steps after expanding the observation from 7 to 10 values with previous collision, previous forward action, and previous turn action. Its last 100 stochastic training episodes reached 10% success, 6.65 units of mean net target progress, and 59.5% collision steps, but the same-seed deterministic comparison still produced 0% success, 100% zero-throttle steps, and zero net progress. Collision memory improved exploratory behavior but did not fix the deployable policy's freeze strategy.
- `PPO_10` completed 106,496 collected steps after making the only learning-related change from PPO_9: forward throttle is now signed `[-1, 1]`, where negative means reverse, zero means stop, and positive means forward. Turning remains `[-1, 1]`. The arena, 10-value observation, reward, 19-point collisions, combined movement-and-rotation rejection, speeds, episode length, PPO settings, rollout size, evaluation interval, and seed 7 remained unchanged. This action-space change invalidates every older trained policy; never load PPO_8 or PPO_9 as a PPO_10 starting point.
- PPO_10 fixed the literal deterministic freeze. Its final fixed-seed 100-episode evaluation achieved 5% success, 95% timeout, -28.04 mean reward, 6.29 units mean net target progress, 0% stopped steps, 54.64% forward steps, and 45.36% reverse steps. Mean signed throttle was 0.1164 and mean absolute throttle 0.3697. The remaining failure is severe collision behavior: 38.87% collision steps, 49.44 mean longest collision streak, and a worst streak of 399 steps.
- PPO_10's latest 100 stochastic training episodes reached 34% success and 16.14 units of mean target progress, but this must be reported separately from its 5% deterministic success. Active stochastic exploration alone is not evidence that the policy deserves longer training.
- PPO_10 passes the minimum decision gate because deterministic success is above zero, but one seed and 5% success are not enough to justify an immediate 300,000-step extension. The next recommended work is two additional fresh 100,000-step runs with the exact PPO_10 configuration and different seeds, giving three seeds total. Change only the seed, use distinct run names/artifact directories, and compare the same fixed-seed 100-episode evaluation.
- Do not increase `n_steps` or extend `PPO_8`/`PPO_9` unchanged. Keep `1,024 x 8 = 8,192` transitions per rollout. Consider a longer PPO_10 run only if the additional seeds repeat the deterministic movement, target progress, and above-zero success.
- If signed throttle does not repeat reliably across seeds, the next single controlled experiment is to resolve rotation and translation collisions independently so the robot can turn or reverse out of contact. Keep reward, observations, PPO settings, and rollout size unchanged for that test. Later experiments may add obstacle-clearance sensors, rebalance collision/progress reward, add a windowed no-progress consequence, or introduce leg collisions through a curriculum—but test only one learning-related change at a time and record it in `TRAINING.md`.
- `PPO_11` completed 106,496 collected steps after making the only learning-related change from PPO_10: the observation grows from 10 to 18 values by adding eight obstacle-clearance rangefinder rays (indices 10-17; indices 0-9 are the unchanged PPO_10 observation). Each ray fans out every 45 degrees from the current facing, ray 0 straight ahead, and reports the clear distance to the nearest obstacle or wall divided by `RAY_MAX_RANGE = 12.0`, clipped to `[0, 1]` where 1.0 means clear. Signed throttle, arena, reward, 19-point collisions, combined movement-and-rotation rejection, speeds, episode length, PPO settings, rollout size, evaluation interval, and seed 7 were unchanged. Adding sensors invalidates every 10-value policy; never load PPO_8, PPO_9, or PPO_10 as a PPO_11 starting point. The policy is never told to avoid obstacles—it only receives the ray values and the unchanged `-0.18` collision penalty and learns avoidance itself.
- Sight of obstacles was the decisive change and PPO_11 is the strongest run in the project. Its fixed-seed 100-episode deterministic evaluation reached 69% success, 31% timeout, +12.96 mean reward, 22.79 units mean net target progress, and 24.50% collision steps, versus PPO_10's 5% success, -28.04 reward, and 38.87% collision steps. Mean longest collision streak fell from 49.44 to 31.54 and average episode length from 381.92 to 163.64, so the robot now reaches the target and ends the episode instead of timing out. This beats the body-only PPO_2 (60%) in the harder 19-point-collision arena.
- Two caveats. PPO_11 settled on a mostly-reverse gait (mean signed throttle -0.17, 80.24% reverse steps) because backing toward the target scores as well as facing it; this is a cosmetic quirk since net progress is strongly positive. And 31% of episodes still time out with one 400-step collision streak, so obstacle recovery is improved but not solved. PPO_11's latest 100 stochastic training episodes reached 83% success with 26.21 units mean progress; report this separately from the 69% deterministic result.
- PPO_11 clearly passes the decision gate. The recommended next work is two additional fresh 100,000-step runs at different seeds (three seeds total), changing only the seed and using distinct run names and artifact directories, compared on the same fixed-seed 100-episode evaluation. Do not change reward, sensors, collision response, PPO settings, or rollout size for that replication. Do not attempt randomized obstacles, randomized obstacle sizes, or a larger arena before the sensors are confirmed across seeds: the earlier blind observation could only avoid obstacles by memorizing this one fixed arena, so randomization was unlearnable without the rays and is only justified once ray-based avoidance is proven.
- The PPO_11 seed replication is complete. `PPO_11_S11` (seed 11, `ppo_11_ray_vision_seed11_100k/`) and `PPO_11_S23` (seed 23, `ppo_11_ray_vision_seed23_100k/`) join seed 7 for three seeds total, all 106,496 steps, NaN-free. Deterministic success was 69% / 54% / 39% (seeds 7 / 11 / 23; mean about 54%), with collision rates 24.50% / 42.92% / 42.08% and mean longest collision streaks 31.54 / 92.66 / 111.99. Stochastic training success was tight and high at 83% / 88% / 93%.
- Interpretation: the ray sensor is confirmed—every seed towers over blind PPO_10 (5% deterministic), so the improvement is the sensor, not seed-7 luck. But the stuck-in-contact failure is not solved and is seed-sensitive: seed 7 was the luckiest on collisions and flattered the first result, while seeds 11 and 23 spend ~43% of steps colliding with 90-112 step mean streaks, and every seed still has episodes reaching a ~400-step collision streak. The high stochastic vs lower deterministic gap is the known mechanism—a collision rejects translation and rotation together, so a deterministic policy re-issues the same rejected action and loops until timeout while stochastic noise escapes.
- Decision after replication: keep the rays permanently; they are a proven win. Do not extend this exact PPO_11 configuration to 300k and do not move to a randomized or larger arena yet, because the unsolved stuck-in-contact behavior would dominate there. The next single controlled experiment is to resolve rotation and translation collisions independently so a touching robot can still turn or reverse out of contact. Keep the rays, reward, PPO settings, and rollout size unchanged and change only the collision response; then re-run the same three seeds and compare collision rate, mean and worst collision streak, and deterministic success.
- `PPO_12` (planned/running) is that decoupled-collision experiment. The only learning-related change from PPO_11: when the combined turn-and-move is blocked, `step()` resolves the two independently—first rotate in place if the turned pose alone is collision-free, then translate along the resolved facing if that alone is collision-free—so a wedged robot can turn or reverse out of contact instead of freezing. The collision flag and its -0.18 penalty still reflect the full intended move, so reward semantics match PPO_11. Rays, observation size (18), reward, 19 collision points, speeds, episode length, PPO settings, and rollout size are unchanged. Coverage is in `tests/test_ppo12_collision_recovery.py` (rotate-out, reverse-out, open-space-unchanged, observation-size). Artifacts: `ppo_12_collision_recovery_smoke/` and `ppo_12_collision_recovery_100k/`.
- Seeding policy changed by owner decision: training no longer fixes seed 7. Each run uses a fresh natural random seed, recorded in `training_config.json`. The 100-episode deterministic evaluation still uses fixed seeds from 10,000, which keeps cross-run comparison fair. Every training launch should also default to surfacing the TensorBoard link (`http://127.0.0.1:6006/` via `tensorboard --logdir rl_artifacts`) and the replay visualizer links without being asked.
- PPO_12 is complete (natural seed 53054, `ppo_12_collision_recovery_100k/`, NaN-free, empty stderr). Deterministic result: 65% success, 35% timeout, +6.09 mean reward, 21.45 net progress, 40.47% collision rate, 62.78 mean longest collision streak, one 400-step worst streak, 174.46 average episode length; stochastic training success 93%. Verdict is a modest, real improvement, not a knockout. The escape mechanic works (proven in `tests/test_ppo12_collision_recovery.py`) and typical jams are far shorter than PPO_11's worse seeds (62.78 vs 92.66 and 111.99), and 65% sits above PPO_11's ~54% seed average. But deterministic collision rate did not fall and one episode still fully wedged. Part of the high collision rate is a measurement artifact: the collision flag marks any blocked intended move even when the robot then successfully rotates or reverses, so sliding along an obstacle edge counts as a collision every step. Caveat: single natural seed vs PPO_11's three seeds, and PPO_11 seed 7 alone also hit 69%, so the success delta cannot be cleanly attributed to the fix; the trustworthy evidence is the shorter mean jam length and the unit-tested escape behavior.
- Keep the decoupled collision response permanently; it strictly gives the robot more ways out and never freezes a pose a sub-move could clear. Because it did not by itself lower collisions, the next single controlled experiment should target contact avoidance directly. The originally planned PPO_13 (raise the collision penalty above -0.18) was superseded by an owner decision described below; it remains a valid future single-variable experiment.
- `PPO_13` (complete) became a larger randomized-arena generalization run by owner decision, not the planned collision-penalty change. Because the rays were confirmed across three seeds, the precondition for randomized/larger arenas was met. Environment changes (multiple at once, by explicit owner choice): the field is ~2.5x wider each side (`WORLD_LIMIT` 25.0 -> 62.5, play area ~6x; target scaled (18,18) -> (45,45)); obstacles are now randomized into a fresh layout every episode via `_generate_obstacles`/`reset` with `NUM_OBSTACLES = 10` (was 5 fixed), radii `[2.5, 3.6]` kept robot-relative, inside a wall margin, spaced, and cleared of the target so every episode is solvable; and `MAX_STEPS` was raised 400 -> 1000 so the bigger field is not an automatic timeout. The learned brain is unchanged from PPO_12 (18-value observation, eight rays, signed throttle, reward, 19 collision points, decoupled collisions, PPO settings, 8,192 rollout). Obstacle generation uses `self.np_random`, so a reset seed reproduces its layout and the fixed-seed evaluation stays fair across runs. The step `info` and recorded replay episodes now carry the per-episode obstacle layout so viewers can draw the actual maze. Tests: `tests/test_ppo13_random_arena.py`. Archives: `ppo_13_random_arena_smoke/` (natural seed 435196) and `ppo_13_random_arena_300k/` (natural seed 364970).
- PPO_13 is the strongest run in the project and the first measured on fields the policy never saw (genuine generalization, not memorization). Its fixed-seed 100-episode deterministic evaluation on unseen random mazes reached 85% success, 15% timeout, +31.66 mean reward, 64.12 mean net target progress, and a collision rate of 0.11% with a mean longest collision streak of 0.02 and worst streak of 2 steps. The reverse-gait quirk is gone (78.0% forward steps). Stochastic training success was 99%. The months-long stuck-in-contact failure is effectively absent here. Do not over-attribute this: the run changed three environment variables at once and trained 3x longer (300k vs 100k), and a larger field is inherently more open (same-size robot/obstacles across ~6x area) so low collision rates are partly geometry, not only skill. It is also a single natural seed. Because the exam changed (random mazes, larger field), PPO_13 numbers are not directly comparable to PPO_1-PPO_12's fixed-arena scores.
- Keep the larger randomized arena as the new baseline world. Recommended follow-ups, one controlled change at a time: (1) replicate on two more natural seeds; (2) to separate open-field geometry from skill, run a denser-obstacle variant. Record each in `TRAINING.md`. The browser training world now rebuilds the actual per-episode randomized obstacle layout carried in replay data and uses the current 187.5-wide boundary and target `(-40,-10)`.
- `PPO_14` (complete) ran that denser-obstacle follow-up and hardened the arena further, by owner decision (multiple env changes at once): field grown to `WORLD_LIMIT = 93.75` (187.5 wide), obstacle count 10 -> 51 randomized per episode, target moved off-center to the south-west `(-40, -10)`, target-plaza clearance tightened 12 -> 6, and a flood-fill reachability guarantee added (`_generate_obstacles` re-rolls any layout whose target is walled into a pocket; `_target_reachable`, `REACHABILITY_MIN_FRACTION = 0.5`; tests in `tests/test_ppo13_random_arena.py`). Episode cap 1000, 300k steps, natural seed 876919. The learned brain is unchanged from PPO_13. Archive: `ppo_14_sw51_300k/`.
- PPO_14 deterministic result on unseen dense mazes: 54% success (down from PPO_13's 85%), +3.38 mean reward, 47.89 net progress, and a collision rate back up to 15.87% with a mean longest collision streak of 67.18 and a 994-step worst wedge; stochastic training success was 100%. Interpretation: the density largely answers PPO_13's open question - the near-zero collision rate was substantially open-field geometry, not pure skill. Under a dense field the stuck-in-contact deterministic freeze (re-issuing a blocked move to timeout) returns, the same mechanism as PPO_10-PPO_12. Contact avoidance/escape is again the clear priority; the cleanest next single change is raising the -0.18 collision penalty or a sparse->dense curriculum, plus seed replication.
- `PPO_15` (complete) tested the recommended contact fix: raise only `COLLISION_PENALTY` from 0.18 to 0.5, everything else identical to PPO_14 (dense arena, target (-40,-10), 300k, natural seed 889404). Archive: `ppo_15_collision_penalty_300k/`. Deterministic result: 51% success (vs PPO_14's 54%), collision rate 12.84% (down from 15.87%), mean longest streak 52.41 (down from 67.18), but worst wedge still 990 steps and forward-step share fell 74%->46%. Verdict: a small, mixed win - the heavier fine cut contact and shortened jams but did not raise success or fix the deep freeze; it mainly bought timidity. Do not keep scaling the flat penalty. Next single change should target the freeze directly - truncate/penalize after K consecutive collision steps with no net progress (a stuck-timeout), or an escalating (not flat) collision penalty, or a sparse->dense curriculum. `COLLISION_PENALTY` is currently 0.5 in the code; revert to 0.18 or choose deliberately when starting the next experiment, and record the reward value used.
- `PPO_16` (complete) is the decisive fix and the best result on the hard arena. The only change from PPO_14: revert `COLLISION_PENALTY` to 0.18 and add a terminal stuck-failure - if the robot collides with no forward progress for `STUCK_LIMIT = 40` consecutive steps, `step()` returns `terminated=True` (a true terminal failure, not truncation) with a one-time `STUCK_PENALTY = 10` (reported inside the collision reward term so diagnostics keys are unchanged). Design point (from the owner): ending an episode early is not itself a punishment, so the explicit penalty and terminal (non-bootstrapping) treatment are what make getting wedged the clearly-worst outcome. Tests in `tests/test_ppo13_random_arena.py`. Archive: `ppo_16_stuck_rule_300k/` (natural seed 489429). Deterministic result vs PPO_14: success 54% -> 64%, collision rate 15.87% -> 1.35%, mean longest streak 67.18 -> 3.66, worst wedge 994 -> 43 (capped by the rule), forward-step share a healthy 70% (vs PPO_15's timid 46%). The freeze is gone and the policy learned to avoid dead-ends rather than endure them, without the timidity a flat penalty caused. Keep the stuck rule permanently. Remaining headroom is the 36% timeout rate (runs that neither arrive nor wedge); next single changes to consider: seed replication to confirm 64%, tuning STUCK_LIMIT/STUCK_PENALTY, richer rays, or a longer training budget.
- `PPO_17_SMOKE` is a completed validation-only forward-vision run (natural seed 308443, 24,576 collected transitions). It keeps the observation at 18 values but replaces PPO_11-PPO_16's eight thin 360° centre rays with eight contiguous 25° sectors covering `yaw ±100°` (200° total, rear 160° unseen). Each sector samples three directions and returns the minimum safe translation clearance for the same 19 body/leg collision circles against obstacles and radius-adjusted walls, normalized by the unchanged 12-unit range. The static target remains an exact known direction/distance, not a visually recognized pink object. Signed reverse, reward, dense randomized arena, collision recovery, stuck rule, PPO settings, and rollout size are unchanged. The changed sensor meaning invalidates all older policies. Focused coverage is in `tests/test_ppo17_forward_clearance.py`; smoke artifacts are in `rl_artifacts/ppo_17_forward_clearance_smoke/`. The run was NaN-free with empty stderr and produced 1% deterministic success, 18.75 target progress, and 3.88% collision steps, but these 20k smoke figures are pipeline evidence only and must not be compared with PPO_16's 300k result.
- `PPO_17` completed its 100k decision gate (106,496 collected steps, natural seed 846909, `ppo_17_forward_clearance_100k_rerun/`). Final fixed-seed 100-episode result: 8% success, 92% timeout, -6.45 reward, 28.67 progress, 2.91% collision steps, 1.51 mean longest collision streak, and 42 worst streak. It rarely wedges, but deterministic movement is weak and indecisive: 46.92% forward / 53.05% reverse, mean signed throttle -0.00094, and mean absolute throttle only 0.1184. Stochastic training reached 38% success with 0.629 absolute throttle, so exploration acts decisively while the deterministic mean policy collapses toward cancelling low-strength actions. Checkpoint success peaked at 8% at 70k and returned to 4% at 100k; do not extend this exact setup automatically to 300k. An initial partial attempt was stopped by a Windows live-replay file lock; `write_live_state()` now treats replay publishing as non-critical and skips a refresh after brief retries instead of crashing training.
- `PPO_18` (complete, natural seed 677925, `ppo_18_human_vision_300k/`, 303,104 collected steps, NaN-free) discards PPO_17 by owner decision and returns to the PPO_16 baseline (dense 51-obstacle arena, target (-40,-10), decoupled collisions, stuck rule, COLLISION_PENALTY 0.18) with one coherent "make her human" change to vision and movement. Vision: PPO_17's 200-degree collision-aware sectors are replaced by the simple PPO_11-16 thin-ray rangefinder (distance from the body centre to the nearest obstacle surface or wall), re-aimed into a 270-degree forward cone (`VISION_FOV`), so the robot is blind only to a 90-degree wedge directly behind; the eight rays sit at the centres of eight equal sectors (symmetric about straight-ahead) and the range grows from 12.0 to `RAY_MAX_RANGE = 28.0` so dead-ends are visible while forming on the big field. Movement: reverse is removed — throttle is now `[0, 1]` forward-only (`action_space.low = [0, -1]`), so the robot always travels inside its visible cone like a human that turns to face where it walks; it still escapes contact by rotating in place plus the stuck rule (reverse-out is gone). Observation stays 18 values and the base channels 0-9 are unchanged, but the new sensor geometry and action space invalidate every older policy (never warm-start from PPO_10-PPO_17). This was NOT a scientific one-variable change: vision span, vision semantics, range, and the action space all moved together as one intended human-vision bundle. The lost PPO_16 360-degree eyes were never rebuilt (see the git note below); PPO_18 replaces PPO_17's eyes directly. Rationale for the design: PPO_17's forward vision failed (8% vs PPO_16's 64%) largely because a half-blind robot was still allowed to reverse into its blind spot; pairing narrow vision with forward-only movement removes that mismatch. Browser `TrainingVisualizer.js` vision constants updated to 270/28 to draw the new cone. Tests: `tests/test_ppo18_human_vision.py` (and the reverse cases in `test_ppo10_signed_throttle.py` / `test_ppo12_collision_recovery.py` were converted to forward-only). All 36 focused tests pass and the env passes Gymnasium's checker NaN-free. Result (fixed-seed 100-episode deterministic exam, comparable to PPO_16's 64%): 75% success, 25% timeout, +20.39 mean reward, 59.07 mean net target progress, 17.69% collision steps, 5.76 mean longest collision streak, 43 worst streak (no freezes), 209.68 average episode length; movement is decisive and forward (69.64% forward, 0% reverse, mean throttle 0.52) — the exact opposite of PPO_17's timid 0.12-throttle collapse. Stochastic training success 81%. Interpretation: the human-vision + forward-only bundle is a genuine +11-point win over PPO_16 and is confirmed healthy (not broken like PPO_17); pairing narrow vision with forward-only movement removed the reverse-into-the-blind-spot mismatch that sank PPO_17. Caveat: this is a single natural seed and it bundled several changes, so the +11 cannot be cleanly attributed to any one of vision span/semantics/range/forward-only. Remaining gap to the owner's 85% target is the 25% timeout rate (runs that neither arrive nor wedge — a navigation-planning shortfall, not collisions). The proven-healthy design now justifies the training-side power-ups held back from this run: larger network via `policy_kwargs` (net_arch ~256x256) and a longer budget; then recurrent memory (dead-end recall) if still short of 85%, and seed replication to confirm 75%. Record each as a separate change in TRAINING.md.
- `PPO_19` (complete, natural seed 736031, `ppo_19_memory_500k/`, 507,904 collected steps) is the recurrent-memory experiment: the only change from PPO_18 is the brain. The plain `MlpPolicy` (SB3 default 64x64) is replaced by an LSTM recurrent policy so the robot carries hidden state between steps and can, in principle, remember explored dead-ends. This required a new dependency `sb3-contrib==2.9.0` (added to `requirements-rl.txt` as `sb3-contrib>=2.9,<3`); the trainer now builds `RecurrentPPO("MlpLstmPolicy", ..., policy_kwargs=dict(lstm_hidden_size=256, n_lstm_layers=1))`. Everything else is identical to PPO_18: 270-degree/28-unit forward cone, forward-only throttle, dense 51-obstacle arena, target (-40,-10), stuck rule, reward, PPO settings, 8,192 rollout. Because the policy is now recurrent, all four inference loops (`evaluate`, `evaluate_diagnostics`, `evaluate_with_recordings`, `watch`) were updated to carry the LSTM state forward and reset it at each episode start via a new `predict_with_memory()` helper (pass `state` and `episode_start`); missing any one would score the run on a blank/scrambled memory. A smoke run validated the full pipeline (train+exam+replay) before the real run. Result (fixed-seed 100-episode deterministic exam): 71% success, 29% timeout, +23.14 mean reward, 57.57 net progress, 11.85% collision steps (better than PPO_18's 17.69%), 102.92 average episode length (much shorter/more decisive than PPO_18's 209.68), 0% reverse, mean throttle 0.97. Verdict: BELOW the PPO_18 champion (75%); PPO_18 remains champion. Critical reading note: the per-10k `Evaluation at N steps` checkpoints only sample 25 mazes (`evaluate_with_recordings(episodes=25)`) and PPO_19 spiked as high as 84-92% on those, but the rigorous 100-maze exam settled at 71% — the 25-maze checkpoint is a small, optimistic sample and must never be reported as the run's score. Training also jittered hard (72%->48%->92%->76% across checkpoints), the classic signature of a learning rate slightly too high for the recurrent policy. A `--learning-rate` CLI arg (default 3e-4) was added so the rate can be tuned without editing code.
- `PPO_20` (aborted, natural seed logged in its `training_config.json`, `ppo_20_memory_gentle_500k/`) tested the recommended fix for PPO_19's jitter: identical memory brain, only `--learning-rate 0.0001` (3x gentler). It over-corrected — flat 0% success through 160k and only ~16-32% (still wobbly) by 240k, versus PPO_19's 84% at the same point. Stopped by owner decision at ~246k steps as clearly on track to miss 75%. Conclusion: 1e-4 is too gentle for this setup (learns too slowly to finish climbing inside 500k). No final exam was written (process killed before completion).
- `PPO_21` (the current recommended run) is the middle-ground retry: identical memory brain, `--learning-rate 0.0002` (half of PPO_19's jittery-fast, double PPO_20's too-slow), 500k steps, run name `PPO_21_memory_mid_500k`, artifact dir `rl_artifacts/ppo_21_memory_mid_500k/`. Early behaviour was the healthiest of the three memory runs (smooth climb: 12% at 100k, 24% at 120k, 44% at 130k — no PPO_20 crawl, none of PPO_19's early wild bouncing). The in-session instance was stopped by an owner computer restart before completion; the owner relaunched it fresh after reboot with the exact command below. PPO_21 is now COMPLETE (natural seed 61224, 507,904 collected steps, NaN-free, exit code 0). Final fixed-seed 100-episode deterministic exam: 69% success, 31% timeout, +22.08 mean reward, 55.75 mean net target progress, 10.10% collision steps, 11.9 mean longest collision streak, 40 worst streak (no freezes), 121.41 average episode length, 82.63% forward / 0% reverse, mean throttle 0.80. It has the healthiest training curve of the three memory runs (smooth, no PPO_19 jitter, no PPO_20 crawl) and collides less and moves more decisively than PPO_18, but times out more (31% vs 25%) and lands at 69% — below champion PPO_18 (75%) and even a hair below PPO_19 (71%). DECISION: the recurrent-memory line is exhausted — LSTM memory does not beat the memoryless PPO_18 at any of the three learning rates tried (3e-4 = 71%, 2e-4 = 69%, 1e-4 = too slow). Abandon the memory brain; PPO_18 (75%) stays champion. The remaining gap to the owner's 85% target is the timeout rate (a navigation-planning shortfall, not collisions or freezes), so the next single change should target planning/exploration on the memoryless PPO_18 baseline (e.g. larger net_arch ~256x256, longer budget, or seed replication to confirm 75%), not more recurrent-memory tuning.
- Exact command to (re)launch PPO_21 after a restart, run from `E:\Leaper`: `.venv\Scripts\python.exe train_rl.py --timesteps 500000 --learning-rate 0.0002 --run-name PPO_21_memory_mid_500k --artifact-dir rl_artifacts\ppo_21_memory_mid_500k`. Cold runtime is ~2h10m (measured from PPO_19: ~15.6s per 1k steps for the LSTM brain). Optional live TensorBoard: `.venv\Scripts\python.exe -m tensorboard.main --logdir rl_artifacts\ppo_21_memory_mid_500k\tensorboard --port 6006` then open http://localhost:6006/. The 100-maze deterministic exam and `final_evaluation.json` are written automatically when training finishes.
- `PPO_22` (complete, natural seed 570077, `ppo_22_wider_brain_300k/`, 303,104 steps, NaN-free) abandons the recurrent-memory line and returns to the memoryless PPO_18 champion, changing ONLY the network width: the trainer reverts from `RecurrentPPO("MlpLstmPolicy")` to plain `PPO("MlpPolicy")` with `policy_kwargs=dict(net_arch=[256,256])` (was the SB3 default 64x64). The `predict_with_memory()` helper is kept unchanged because plain PPO's `.predict()` accepts the same `state`/`episode_start` args and returns a `None` state. Result: 74% success, 26% timeout, 6.59% collision steps — a statistical tie with PPO_18 (75%), and the timeout/planning gap did not move; the 25-maze checkpoints plateaued at 80-88% from ~240k onward, so it had converged and a longer budget would not help. Verdict: a wider brain is a wash — route-planning CAPACITY is not the bottleneck. Together with the failed memory line (PPO_19-21), this ruled out "more thinking power" and pointed the search at PERCEPTION instead.
- `PPO_23` (complete) is the BREAKTHROUGH and the new champion. The only change from PPO_18: sharpen vision by doubling `RAY_COUNT` 8 -> 16 (the 270-degree cone is now sampled every ~17 degrees instead of ~34), selected via a new `--ray-count` CLI flag; the observation grows 18 -> 26 (10 base channels + 16 rays), which invalidates every older policy. The 64x64 network, forward-only throttle, 28-unit range, dense 51-obstacle arena, decoupled collisions, stuck rule, reward, and PPO settings are all unchanged. Four seeds: 86% (seed 671597, `ppo_23_more_rays_300k/`), 73% (seed 621697, `ppo_23_more_rays_confirm_300k/`), 87% (seed 965726, `ppo_23_more_rays_seedC_300k/`), 80% (seed 960925, `ppo_23_more_rays_seedD_300k/`) -> mean 81.5%, vs the confirmed 8-ray baseline of PPO_18 75% plus reruns `ppo_18_rerun_seedA_300k/` (seed 270166) 78% and `ppo_18_rerun_seedB_300k/` (seed 869854) 77% (mean 76.7%, low variance). So +~5 points on average, with collision steps down to ~2-4% and the best run's timeout rate cut to 14% (from 25%) — the diagnosis that PERCEPTION resolution, not compute, was the bottleneck is confirmed. The high variance is a deterministic decisiveness effect: decisive seeds hit ~86-87% and clear the 85% target, timid seeds (mean throttle ~0.4, ~50% stopped) drop to 73-80% (the same deterministic-collapse seen in PPO_17/PPO_19). DEPLOYABLE CHAMPION = seed 965726 (87%), which meets the owner's 85% target; ship the single best trained model, not the average. Keep 16 rays as the new baseline world going forward. Replays: `rl_artifacts/leaper_ppo23_champion_87.html` (the 87% champion) and `leaper_ppo23_replay.html` (the 86% seed); `tmp/build_viewer.py` gained matching `--ray-count`/`--ray-max-range` flags so the viewer's env matches the model's eyes. A plain-language story log of PPO_19->PPO_23 lives in `RUN_LOG_PPO19-23.md`.
- Trainer CLI now exposes `--ray-count` (default 8), `--ray-max-range` (default 28.0), and `--net-arch` (default "64,64", comma-separated). They override `LeaperReachEnv.RAY_COUNT`/`RAY_MAX_RANGE` at the top of `main()` before any env is built (so all envs in one process stay consistent) and set `policy_kwargs=net_arch`; `training_config.json` now records `policy=MlpPolicy`, `memory=none`, `net_arch`, `ray_count`, and `ray_max_range`. The recurrent LSTM path is removed — the trainer is plain `PPO("MlpPolicy")`. Next optional lever to push past 87%: `PPO_24 = --ray-max-range 45` (longer sight), and/or a variance fix to steady her decisiveness so every seed reliably clears 85%, plus a PPO_23 seed replication to further pin the mean. Record each single change in `TRAINING.md`.
- `PPO_24` (complete, dismissed, 2026-08-27, seed 245103) tested longer sight: PPO_23 eyes with ONLY `--ray-max-range 28 -> 45`. Result: 80% deterministic, 20% timeout, and the seed came out timid (55% forward). This lands squarely inside PPO_23's own 73-87% seed swing, so range alone showed no signal — the blocker is decisiveness/nerve, not sight distance. Longer range was fully ruled out later in PPO_26. Do not pursue range-45.
- `PPO_25` (complete, NEW CHAMPION, 2026-08-27) is the variance fix and meets the 85% target reliably. The only change from PPO_23: add an **idle penalty** that taxes sustained standing-still (the root cause of the timid-seed variance). New env constants `IDLE_PENALTY = 0.04`, `IDLE_GRACE = 3`, `IDLE_THROTTLE = 0.1`: a per-step reward tax applied when throttle < 0.1 for more than 3 consecutive steps (a brief pivot-in-place stays free), reported inside the `time` reward bucket. Sized between `STEP_PENALTY` (0.01, so idling beats a normal step no longer) and `COLLISION_PENALTY` (0.18, so she never rams walls to avoid standing). New CLI flags `--idle-penalty` / `--idle-grace` (defaults 0.04 / 3; `--idle-penalty 0` disables) override the constants at the top of `main()` and are recorded in `training_config.json`. Range held at champion 28 to isolate one variable. Four seeds (102911 / 456047 / 703466 / 911743) scored **89 / 92 / 93 / 92 -> mean 91.5%**, range 89-93, every seed bold (forward-step 86-99%), collision 2-5.6% — vs PPO_23's high-variance 81.5% (73-87). Two effects at once: the seed lottery is dead (14pt -> 4pt spread; 4/4 clear 85%, no timid runs) AND the mean rose +10 points. Generalization confirmed: the champion model on **1,000 fresh held-out mazes (seeds 50000-50999) = 91.3% (95% CI 89.6-93.0%)** vs 93% on the standard 100 — genuine learning, not exam-overfit. **DEPLOYABLE CHAMPION = seed 911743 (93%, `rl_artifacts/ppo_25_idle_s3/leaper_ppo.zip`).** Champion recipe going forward = 16 rays + range 28 + forward-only + idle-penalty 0.04 / grace 3.
- `PPO_26` (complete, dismissed, 2026-08-27) tested the one untried combination: PPO_25 idle penalty + `--ray-max-range 45`. Three seeds (782292 / 368918 / 934761) scored **80 / 84 / 82 -> mean 82%**, all ~9 points BELOW the range-28 champion and *more* timid (forward-step 54-80%, timeout 16-20%). Longer range hurts even with the nerve fix: in the dense 51-obstacle field nearly every ray at range 45 hits distant clutter, so open doorways stop reading as open and near-field detail is compressed (a ray returns `distance / RAY_MAX_RANGE`, so the same obstacle reads fainter at a longer range — precision is spent on far-away obstacles she would turn away from anyway). Confirms PPO_24's hint. **28 is the right range; range-45 line is closed.** PPO_25 stays champion, undisputed. Full session write-up in `RUN_LOG_PPO23-26.md`; teaching case-study PDF in `Leaper_RL_Case_Study.pdf`.
- Seeding is natural entropy per the owner's standing rule (training uses a fresh random seed each run; the 100-episode deterministic exam stays fixed-seed from 10,000 for fair comparison). The replay/visualizer builders also generate episodes with natural entropy (no fixed seed) so starts vary. Visualizer builders live in `tmp/`: `tmp/build_viewer.py` writes a self-contained top-down replay (obstacles, rays, legs, trail) and `tmp/build_theatre.py` rebuilds the full 3D theatre (ported hexapod, four cameras, per-episode randomized obstacle pillars, checkpoint/deterministic/stochastic rollout groups, and a data-driven summary panel) by reusing `rl_artifacts/leaper_training_theatre.html` as the engine template and scaling the world to `WORLD_LIMIT`. Both run with `PYTHONPATH` set to the repo root. Latest outputs: `rl_artifacts/leaper_theatre_ppo14.html` and `rl_artifacts/leaper_ppo14_replay.html`. The theatre template's earlier Leaper (LENS) first-person camera sat inside the eye mesh (black screen) and the Cinematic (ORBIT) camera used an odd framing; both are fixed in `build_theatre.py` and confirmed working.
- Generated body-only and diagnostic replay archives exist locally under ignored `rl_artifacts/` folders. PPO_8 is preserved under `ppo_8_collision_unaware_run/`, PPO_9 under `ppo_9_collision_awareness_100k/`, the validation-only PPO_10 smoke run under `ppo_10_signed_throttle_smoke/`, the main PPO_10 run under `ppo_10_signed_throttle_100k/`, the validation-only PPO_11 smoke run under `ppo_11_ray_vision_smoke/`, the main PPO_11 run (seed 7) under `ppo_11_ray_vision_100k/`, and the two seed replications under `ppo_11_ray_vision_seed11_100k/` and `ppo_11_ray_vision_seed23_100k/`, the validation-only PPO_12 smoke run under `ppo_12_collision_recovery_smoke/`, and the main PPO_12 run under `ppo_12_collision_recovery_100k/`. `PPO_10_SMOKE` and `PPO_11_SMOKE` are only short technical verifications and must not be used as experimental results. Do not commit these generated artifacts. The visualizer accepts replay JSON containing checkpoint episodes, actual training rollouts, or both. Two standalone self-contained replay viewers for PPO_11 are also kept under `rl_artifacts/`: `leaper_arena_replay.html` (top-down, renders the eight rays and the 19 collision points) and `leaper_training_theatre.html` (full 3D hexapod with chase, Leaper first-person, top, and cinematic cameras, rays drawn as beams). Both inline their data and Three.js, open by double-click, and are regenerated from the scratchpad build scripts whenever a new run should be shown.
- TensorBoard should normally be launched against the complete `rl_artifacts/` root so PPO_1 through PPO_11 can be compared. PPO_8 and PPO_9 event files exist in both the legacy shared TensorBoard folder and their archives, so use explicit named paths when a duplicate-free run list matters.
- Manual browser verification has covered the light training scene, chase and top views, natural top-view panning, wheel zoom, media controls, rollout selection, checkpoint selection, live/imported feed switching, and import of the archived `PPO_2` replay. A complete manual play-through of the normal player-controlled simulator is still required: verify all three camera modes, keyboard/touch movement, jumping, obstacle blocking, pink-target selection/movement, and resizing.
- No local development or TensorBoard server should be assumed to be running. Start them explicitly when needed.

## Web Game — Live Brain in the Browser (2026-09-01)

The project crossed from "browser replays a recording" to "the trained brain thinks live in the browser," and is deployed as a playable web game. This is the deployment path, not more RL training.

- **The brain runs live, not replayed.** `?brain` behaviour is now the DEFAULT mode (bare URL). Every frame `BrainDriver` builds the 26-number observation in JavaScript, runs `public/leaper.onnx` via `onnxruntime-web`, and applies the same step math training used. The 41 MB `browser_replay.json`/`rl_live_state.json` recordings are NOT part of the game deploy.
- **The champion is `rl_artifacts/ppo_25_idle_s3/leaper_ppo.zip`** (seed 911743, 93%, 16 rays / 26 obs / forward-only / idle-penalty). `export_to_onnx.py` exports the bare deterministic-action network (bypassing SB3's distribution machinery, `dynamo=False` legacy tracer); a 1000-sample check confirmed ONNX matches SB3 to ~6e-7 after clipping throttle→[0,1], turn→[-1,1].
- **Faithfulness is proven in-browser, not assumed.** `make_brain_fixtures.py` bakes exact Python `_observation()` outputs + ONNX actions into `public/brain_fixtures.json`; on startup `BrainDriver.runSelfTest()` reproduces them in JavaScript and logs `✅ Faithfulness self-test PASSED` (worst obs/action diff < 1e-4, typically ~1e-7). Keep the fixtures and the self-test in sync with any observation/step change — regenerate fixtures if the recipe or champion changes.
- **The JS port must stay byte-faithful.** `leaperWorld.js` mirrors `rl_environment.py`: Python `(x, y)` maps to scene `(x, z)`, both use `heading = (sin(yaw), cos(yaw))` (no axis remap); `previous_action` is the CLIPPED action; `last_collision` is 1 if last step collided; yaw wrap uses a Python-style positive modulo. Constants copied from the champion config (`WORLD_LIMIT 93.75`, `TARGET (-40,-10)`, `RAY_COUNT 16`, `RAY_MAX_RANGE 28`, `VISION_FOV 270°`, `MOVE_SPEED 0.75`, `TURN_SPEED 18°`, leg geometry). No VecNormalize — observations are fed raw.
- **Concurrency rule:** `onnxruntime-web` runs ONE inference at a time per session ("Session already started" if overlapped). The self-test asks sequentially and finishes before the live loop starts; `BrainDriver` guards live steps with a `stepping` flag. Never fire concurrent `brain.think()` calls.
- **Engine loads from a version-matched CDN.** `LeaperBrain.js` imports `onnxruntime-web/wasm`, sets `numThreads = 1` (no cross-origin-isolation headers needed on static hosts) and `wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/'`. The `/public/ort/` self-hosted approach was abandoned because Vite refuses to import `/public` files as modules in dev. If `onnxruntime-web` is upgraded, bump the pinned CDN version to match.
- **Deployed on Netlify Drop as a static site.** `pnpm build` (or `node node_modules/vite/bin/vite.js build`) → `dist/` (~0.7 MB after trimming the training `rl_live_state.*` files that ride along from `public/`, and Rollup's redundant bundled `assets/ort-*.wasm`). The site is claimed/permanent; visitors need only a browser + internet (one-time CDN engine fetch, ~14 MB), no download, no server — the brain thinks on the visitor's machine.
- **Environment note:** the owner's `node`/`pnpm` are not on this agent shell's PATH. A usable Node (v24) lives at `C:\Users\ankud\AppData\Local\OpenAI\Codex\runtimes\cua_node\...\bin\node.exe`; run Vite directly with it (`& node node_modules/vite/bin/vite.js [dev|build|preview]`) since `pnpm dev` trips a pnpm pre-flight over the cosmetic `protobufjs` ignored-build warning. Browser tools are unavailable to the agent — runtime verification (self-test PASS, wasm load) must be confirmed by the owner.

## Working With the Project Owner

The project owner comes from an art and game-design background and is not a programmer or otherwise highly technical. Communicate accordingly:

- Begin with what changed and what it means for the game or creative workflow.
- Explain technical terms in plain language when they first appear; do not assume familiarity with Git, terminals, packages, APIs, or architecture terminology.
- Give short, numbered instructions with exact commands when the owner needs to do something.
- Explain important tradeoffs visually or with concrete game examples where helpful.
- Never make the owner interpret raw errors without also explaining the likely cause and next action.
- Ask about creative intent when a technical choice could change movement, appearance, feel, difficulty, or training behavior.
- Keep routine implementation details concise, but clearly flag decisions that affect saved models, assets, controls, or player-visible behavior.

## Build, Test, and Development Commands

Install Node.js 20 or newer, then install the JavaScript dependencies and start the simulator:

```powershell
corepack enable
pnpm install
pnpm dev
```

Open the local address printed by Vite, normally `http://localhost:5173`. Create a production build with `pnpm build` and preview it with `pnpm preview`.

If the owner already uses npm, `npm install`, `npm run dev`, and `npm run build` are equivalent. Do not introduce React unless a future editor or complex application UI demonstrates a real need for it.

Install and run the RL tooling separately with:

```powershell
python -m pip install -r requirements-rl.txt
python train_rl.py --timesteps 20000 --run-name PPO_11_SMOKE --artifact-dir rl_artifacts/ppo_11_ray_vision_smoke
python train_rl.py --timesteps 100000 --run-name PPO_11 --artifact-dir rl_artifacts/ppo_11_ray_vision_100k
tensorboard --logdir rl_artifacts
```

Always give each run its own `--artifact-dir` so smoke tests and archived runs cannot overwrite one another. Validate Python syntax with `python -m py_compile rl_environment.py train_rl.py tests/test_ppo10_signed_throttle.py tests/test_ppo11_ray_vision.py tests/test_ppo12_collision_recovery.py tests/test_ppo13_random_arena.py tests/test_ppo18_human_vision.py`. Run the focused checks with `python -m unittest discover -s tests -p "test_*.py"`. `train_rl.py` also runs Gymnasium's environment checker before training.

## Coding Style & Naming Conventions

Use four spaces in Python and two spaces in HTML, CSS, and JavaScript. Follow PEP 8: `snake_case` for Python functions and variables, `PascalCase` for classes, and uppercase constants. In JavaScript, use `camelCase` for mutable values and uppercase names for simulation constants. Keep modules focused and name them after the game concept they own. Do not add a framework unless it solves a demonstrated project need; native JavaScript modules are sufficient for the first refactor.

## Testing Guidelines

For simulator changes, run `pnpm build`, then verify chase, lens, and top cameras; keyboard/touch controls; obstacle collision; target selection; jumping; and window resizing in `pnpm dev`. For RL changes, run the 20,000-step smoke test and confirm episode rewards appear, `training_progress.csv` is populated, and evaluation completes without NaN values.

## Commit & Pull Request Guidelines

Treat Git history as part of the project documentation. Agents working in this repository must manage changes deliberately:

- Check `git status` and inspect relevant diffs before editing so existing owner changes are not overwritten.
- Work on a named branch for substantial features or risky refactors; keep the default branch stable and runnable.
- Make small, coherent commits that contain one understandable change. Do not mix unrelated cleanup with feature work.
- Use concise imperative commit messages such as `Extract camera controls` or `Fix calf collision response`.
- Run the relevant validation before committing and report what was tested. Do not claim tests passed if they were not run.
- Review `git diff --check` and the staged diff before every commit. Never commit generated models, large transient artifacts, secrets, local environment files, or dependency caches.
- Do not discard, rewrite, squash, amend, rebase, force-push, or otherwise alter the owner's Git work unless explicitly asked.
- Do not create a commit merely because files changed. Commit at a meaningful checkpoint, and tell the owner what the commit represents in plain language.
- Keep `.gitignore` current as new tools and artifact folders are introduced.

Pull requests should explain player-visible and behavioral changes, list validation commands, link relevant issues, and include screenshots or short recordings for visible simulator changes. Call out reward, observation, action-space, or simulation-timing changes explicitly because they can invalidate trained models or change learned behavior.

## Current Handoff — PPO_35 faint note (0.25) + 500k; ❌ NO-GO but best of line; frontier-note sweep DONE (2026-09-08)

- **HEADLINE:** After PPO_34 showed a loud (0.5) note helps search but hurts pursuit, PPO_35 took the
  "trust the reward" path — faint note (**0.25**) + **500k** so the pursuit reward can override it on
  its own (two changes vs PPO_34, owner-directed). 3×500k: **71/72/74 → mean 72.3% success, 85.7%
  first-detection.** Gate 78/90 = **NO-GO**, but the **best and tightest success of the whole seeker
  line**, and **pursuit fully healed** (success|det ~85, detected-but-failed ~13). Ablation: note
  lightly used at 0.25 (alignment +0.05–0.10; zeroing drops first-det 0–3 pts; helps net success on s3).
- **FRONTIER-NOTE SWEEP CONCLUSION:** across strength 0.0 / 0.25 / 0.5 the note-as-observation-input
  plateaus at **~70–72% success / 85–88% first-detection** (0.0 ignored=70.7, 0.5 loud-hurts-pursuit=70.0,
  0.25 balanced-best=72.3). It's a **~+3 pt lever, not a path to the gate.** The wall is
  **traversal/coverage**: ~14% of mazes she never gets near the target (never within 28 u); a directional
  hint alone can't force a reactive walker to cross the arena. **Note tuning is exhausted.**
- **DECISION FORK (owner's call; nothing launched):** (a) accept PPO_29 (69%) or PPO_35 (72.3%) as the
  seeker and move on; (b) a STRUCTURAL change, one at a time — after-detection note gate (mirrors the
  exploration-reward switch-off already in the env), region-**centroid** note instead of nearest-rim
  (plots showed the note often points at a nearby rock-shadow rim), or a waypoint/planner layer that
  actually commits her across the arena.
- PPO_29 (69%) remains champion; PPO_35 (72.3%, `rl_artifacts/ppo_35_frontier_seed025_500k_s{1,2,3}/`)
  is the best seeker but not promoted. `--seed-frontier-from-target` in `train_rl.py`. Diagnostics +
  interactive viewer in `rl_artifacts/phase1b_diagnostics/`.

Earlier context (PPO_34 line) is preserved below.

## Prior Handoff — PPO_34 seeded frontier note; ❌ NO-GO, note now USED, pursuit is the new blocker (2026-09-08)

- **HEADLINE:** Phase-1B failure inspection showed PPO_33's frontier note was being **ignored**
  (note-zeroed ablation didn't hurt; movement alignment ≈0). PPO_34 fixed that with ONE change —
  at warm-transfer, seed frontier-direction cols 26-27 = **0.5 × the donor's target-direction cols
  2-3** (actor+critic) instead of zeroing (`--seed-frontier-from-target 0.5`; default 0 = PPO_33;
  a zero note still reproduces PPO_29 exactly). 3×250k: **65/73/72 → mean 70.0% success, 88.0%
  first-detection.** Gate 78%/90% = **NO-GO**.
- **The seeding WORKED (diagnostic win): the note is now used.** Ablation: zeroing it now drops
  first-detection **5-7 pts** (PPO_33 lost 0), alignment **+0.07–0.17** (was +0.01), turn action-div
  ~0.32 (was 0.06). So PPO_33's problem was **adoption** (cold zeroed columns un-learnable in 250k),
  not the idea.
- **New bottleneck identified: the always-on note fights PURSUIT.** It improved search
  (first-detection 82.7→88, never-detected 17→12) but once the target is found the note still points
  at unchecked ground, so success-given-detection fell (85.7→79) and detected-but-failed rose
  (12→18); the two cancel → success flat ~70%.
- **RECOMMENDED NEXT — PPO_35 (one change, get green-light first): gate the frontier note OFF after
  detection** (zero the note / set valid=0 once `target_ever_seen`), matching the PDF's "exploration
  only in not-found mode". Keep the +5pt detection gain, restore pursuit → cleanest shot at the gate.
  Alternative if that stalls: point the note at the reachable region centroid (not nearest rim).
- PPO_29 (69%) remains champion; nothing promoted to browser. Diagnostics + interactive viewer:
  `rl_artifacts/phase1b_diagnostics/` (`PHASE1B_FAILURE_REPORT.md`, `ppo34_ablation.json`,
  `leaper_search_viewer.html`). Runs: `rl_artifacts/ppo_34_frontier_seed_250k_s{1,2,3}/`. New flag
  in `train_rl.py`: `--seed-frontier-from-target`.

Earlier context (PPO_33 line) is preserved below.

## Prior Handoff — PPO_33 global frontier note (Phase 1B); ❌ NO-GO but first improvement (2026-09-08)

- **HEADLINE (2026-09-08):** Phase 1B replaced PPO_32's 16 LOCAL "distance to unchecked
  ground" rays with a compact **5-value GLOBAL frontier note** (obs 26-30: rel x/z dir +
  distance + size + valid flag toward the nearest frontier cell of the largest unchecked
  region; honest — cleared-grid only, never target/obstacle positions). One controlled
  change vs PPO_32; all PPO_29 env/rewards/PPO settings, indices 0-25, plain 64×64 MLP,
  LR 1.5e-4, and warm-transfer-from-PPO_29 held. Obs 26→31, warm-transfer copies 26
  donor cols + zeros 5 new (equivalence ≤1e-5). **Result on the 100-maze exam, 3 natural
  seeds 250k: 73/68/71 → mean 70.7% success, 82.7% first-detection.** Gate (Go = ≥78%
  success AND ≥90% first-detection) → **NO-GO** (also at/below the 73% no-go line). Per
  the instruction: stopped, reported, **Phase 2 NOT started**, no 1,000-maze confirm.
- **BUT this is the FIRST improvement in the memory-augmentation line.** PPO_33 beats BOTH
  the PPO_29 baseline (69%/82%) and the failed PPO_32 (67.3%/80.3%) on success AND
  first-detection across the seed spread → the GLOBAL frontier signal is genuinely more
  useful than PPO_32's local rays (direction global>local validated). Just not enough
  alone: first-detection moved only +0.7pt over baseline, ~17% of mazes still never get
  unobstructed line-of-sight in time. Walker healthy (collisions 7.7% < baseline 9.8%,
  success-after-sight 85.7%; breaches match baseline = arena property, not regression).
- **PPO_29 (69%) remains the seeker champion**; PPO_33 not promoted to browser (failed
  gate), live-brain export untouched. Code (behind `--frontier-note`, default off):
  `LeaperReachEnv.FRONTIER_NOTE` + `_frontier_note()` (4-conn flood-fill over the cleared
  grid, largest region, nearest frontier cell, ignore fragments < `FRONTIER_MIN_REGION_CELLS=6`);
  `observation_size()` handles 26/31/42; `train_rl.py` `--frontier-note` + config +
  frontier point in replay frames; tests `tests/test_ppo33_frontier_note.py` (11) +
  `tests/test_ppo33_warm_transfer.py` (3), full suite 89/89 green. Detail: `TRAINING.md`
  "PPO_33_FRONTIER_1B", `RL_SPEC.md` §1b + §9. Artifacts
  `rl_artifacts/ppo_33_frontier_250k_s{1,2,3}/`; seed-10007 proof
  `rl_artifacts/ppo_33_frontier_seed10007_proof.png`.
- **Next-hypothesis note (NOT started, needs green-light):** the global note helps but the
  blocker is now clearly the ~17% never-detected — the agent is steered at the biggest
  unknown but still misses line-of-sight. Candidate follow-ups: point the note at the
  region CENTROID (not just nearest edge) so it commits deeper; or combine the frontier
  note with a small densify/longer-episode change; or accept PPO_29 and move to the
  moving-target track. One change at a time; propose before building.

Earlier context (PPO_32 line) is preserved below.

## Prior Handoff — PPO_32 cleared-map seeker ran; ❌ NO-GO, PPO_29 still champion (2026-09-04)

- **HEADLINE (2026-09-04):** the state-augmentation plan below was BUILT and RUN as
  **PPO_32** (the explicit cleared-map / "been-there radar", Phase 1). Result on the
  fixed 100-maze exam over three natural-seed 250k runs: **67/65/70 → mean 67.3%
  success, 80.3% first-detection**, BOTH slightly BELOW the memoryless PPO_29 baseline
  (69% / 82%). Per the written gate (Go = mean success ≥78% AND first-detection ≥90%;
  no-go ≤73%) this is a **clear NO-GO** — no 1,000-maze confirm, no 500k extension, no
  post-hoc tuning. The cleared-map inputs did NOT raise first-detection (the exact
  metric the hypothesis predicted), so "the seeker fails because it forgets where it
  already looked" is **not supported** by this evidence. The walker did not degrade
  (body-health baseline-level, success-after-sight ~84% like PPO_29; the collision/
  stopped/sight threshold breaches also exist in the PPO_29 baseline = arena property,
  not a regression). **PPO_29 (69%) remains the seeker champion**; PPO_32 was NOT
  promoted to a browser champion (it did not pass its gate) and live-brain export is
  untouched. Full detail + tables: `TRAINING.md` "PPO_32_CLEARED_MAP"; index row in
  `RL_SPEC.md` §9; per-run artifacts `rl_artifacts/ppo_32_cleared_map_250k_s{1,2,3}/`;
  baseline `rl_artifacts/ppo_29_normalized_throttle_250k/baseline_detection.json`.
  Coverage visuals: `rl_artifacts/ppo_32_coverage_success_vs_lost.png` (a lost episode
  shows it re-sweeping one region while the target's far corner stayed an unchecked
  blindspot) and `ppo_32_coverage_s3.png`. Likely reason it failed (a NEXT hypothesis,
  NOT acted on): the egocentric 28-unit "distance to unchecked ground" gives a weak
  gradient in the 62.5-wide arena, so it does not pull Leaper across to far unchecked
  corners; a GLOBAL coarse unchecked-region signal (bearing to nearest large unchecked
  area, or a low-res whole-arena occupancy vector) is the more promising follow-up —
  propose and green-light before building (one-change rule).

- **What shipped in code (PPO_32, all behind `--coverage-map`, default off so PPO_29
  reproduces exactly):** `LeaperReachEnv.COVERAGE_MAP` + `observation_size()` (obs
  26→42), an episode-local cleared grid (`EXPLORATION_CELL_SIZE=3.0`, 21×21) updated
  each pose via the vectorized `_points_visible` geometry SHARED with the real target
  sensor (pinned equal by a test, never reads the true target), a 16-value egocentric
  "distance to unchecked ground" summary at obs 26-41 aligned with the vision rays;
  warm-transfer widening in `train_rl.py` (`widen_policy_state_dict`: copies donor
  cols 0-25, zeros 26-41, copies later params exactly, fresh optimizer, fails loud);
  detection diagnostics + body-health thresholds in checkpoints/`final_evaluation.json`;
  a cleared-vs-unchecked overlay in `src/simulation/TrainingVisualizer.js`; tests
  `tests/test_ppo32_coverage_map.py` (14) + `tests/test_ppo32_warm_transfer.py` (3),
  full suite 75/75 green. Learning rate 1.5e-4 (only hyperparam change). Timing: plain
  64x64 MLP + 16 inputs ran ~885 train FPS, ~9.4 min/seed (NOT hours).

Earlier context (PPO_31 pivot / PPO_29 line) is preserved below.

## Prior Handoff — PPO_31 2-layer LSTM aborted; pivot to state-augmentation memory (2026-09-03)

- **HEADLINE (2026-09-03):** the from-scratch LSTM line is now closed TWICE (PPO_30
  1-layer = 39%, PPO_31 2-layer = ~20% mid-run). Owner reaffirmed the long-term
  goal is a MEMORY-driven seeker that reaches **≥85%** on the hidden target, then a
  slowly MOVING target. Agreed the memory must NOT be an internal LSTM (it forces
  relearning the whole walk/dodge skill and destabilizes). The decided architecture
  is **state augmentation**: hand the champion walker an explicit, external memory
  as extra OBSERVATION inputs — a **coverage / visitation map** ("been-there radar")
  of only the cells Leaper has actually visited/seen — and **warm-start on the
  memoryless champion** so the walking/dodging skill is preserved and only "steer
  toward unexplored ground" is learned. Design it moving-target-ready: the same
  memory-as-input idea later upgrades the existing `last_seen_target` note to carry
  the target's HEADING ("last seen here, moving right"), so the mover is a small
  add-on, not a rebuild. CRITICAL honesty constraint: only what Leaper has actually
  seen goes in — unexplored cells stay blank, and the target note stays empty until
  genuine line-of-sight. Do NOT feed the full map or the hidden target position;
  that would be cheating and would erase the search problem. Searchable terms for
  the owner: "state/observation augmentation RL", "visitation/coverage map",
  "occupancy grid as observation", "external vs recurrent memory". NEXT ACTION when
  work resumes: build the coverage-map observation channel + warm-start path, then
  run ~250k. (Owner has NOT yet green-lit the build — confirm before launching.)

Earlier context (PPO_29 line) is preserved below.

- The genuine seeker work supersedes the older PPO_25 deployment baseline for
  current experiments. The environment now uses a 62.5-wide arena
  (`WORLD_LIMIT=31.25`), six randomized obstacles, a randomized semantically tagged
  target, 16 obstacle rays across 270° at range 28, and a 26-value observation.
  Target direction/distance is hidden until unobstructed sight; after sight the
  stationary target is remembered. Pink is presentation only—the target tag is
  identity, so changing its mesh does not require pixel-recognition retraining.
- PPO_27 (`rl_artifacts/ppo_27_seeker_500k/`) proved search works: 64%
  deterministic success. Its repeated `+0.5` reacquisition reward caused an orbit
  exploit. PPO_28 fixed that by rewarding only first-ever sight, stopping
  exploration bonuses after discovery, and using symmetric pursuit progress.
- PPO_28 also halves movement `0.75 -> 0.375`, halves turning `18° -> 9°` to
  preserve turning radius, and doubles the cap `500 -> 1000`. Full archive:
  `rl_artifacts/ppo_28_slow_seeker_500k/`, seed 742698, 507,904 transitions.
  Final fixed-seed 100-episode deterministic result: **71% success**, 29% timeout,
  +14.31 reward, 20.99 net progress, 1.90% collision steps. Browser checkpoint
  replays are deterministic-only and display target visibility/memory state.
- PPO_28's remaining failure is deterministic freeze: 56.73% stopped steps;
  89.8% occurred before first target sight. Every probed stopped action had a
  negative raw Gaussian throttle (mean -0.435) clipped to zero by the asymmetric
  `[0,1]` action space. Timeout episodes' median longest stop was 388 steps, worst
  980. Do not spend 800k more steps on this unchanged configuration.
- PPO_29 normalized throttle is now **implemented and smoke-validated**. Env
  changes (`rl_environment.py`): a `NORMALIZED_THROTTLE` flag makes the policy
  throttle output `[-1,1]` and maps it to a forward-only physical throttle via the
  new `physical_throttle()` classmethod `(action+1)/2`, so `-1=stop`, `0=half`,
  `1=full`; negative never means reverse. A terminal general-freeze failure
  (`FREEZE_LIMIT=60`, `FREEZE_PENALTY=10`, reported in the `time` reward bucket,
  `info["frozen"]`) ends any episode with no physical translation for 60
  consecutive steps; real movement resets `freeze_steps`. The separate 40-step
  collision `STUCK_LIMIT` is unchanged (stuck fires first for wedged contact;
  freeze catches open-field standstill/spin). Owner-requested scan nudge
  (`SCAN_REWARD=0.01`, in the `exploration` bucket): a small reward for facing each
  new heading bin before first sight, capped at one revolution per episode via
  `scanned_headings`, disabled after discovery — "just one spin" of encouragement.
  Trainer (`train_rl.py`): new CLI `--normalized-throttle`, `--freeze-limit`,
  `--freeze-penalty`, `--scan-reward`, and `--warm-transfer` (loads a donor with no
  env to skip SB3's action-space check, builds a fresh model with the new bounds,
  copies `policy.state_dict()`, keeps the fresh optimizer). Diagnostics now
  classify **physical** throttle so stopped/forward stats stay honest under
  normalization. Config records all new fields. Tests:
  `tests/test_ppo29_normalized_throttle.py` (10 cases); full suite 58/58 pass, env
  passes Gymnasium's checker.
- **PPO_29 20k smoke = GO** (`rl_artifacts/ppo_29_normalized_throttle_smoke/`, seed
  406432, warm-transferred from PPO_28). Deterministic 100-episode exam: **73%
  success**, 27% timeout, **stopped steps 56.73% -> 5.02%** (the freeze is gone),
  forward steps 95%, mean physical throttle 0.83, collision 6.2%, worst streak 40
  (no un-capped wedges). Success already matched/beat PPO_28's 500k result at 20k.
  20k figures are pipeline+health evidence only, not a final score.
- **PPO_29 250k run complete** (`rl_artifacts/ppo_29_normalized_throttle_250k/`,
  seed 208230, 253,952 transitions, warm-transferred from PPO_28; plain PPO runs at
  ~2.1s/1k steps, so 250k took ~9 min — the "~2h" figure elsewhere is the LSTM
  memory brain only, NOT plain PPO). Deterministic 100-episode exam: **69%
  success**, 31% timeout, **stopped steps 6.29%** (freeze cured and durable at
  scale), forward 93.7%, mean physical throttle 0.81, collision 4.8%, worst streak
  40. VERDICT: the freeze fix is a complete, permanent success (57% -> 6% stopped,
  behavior now constantly moving/searching) BUT it did NOT raise success — 69% is a
  statistical tie with PPO_28's 71%. The 25-maze checkpoints flattened by ~140k and
  jitter 68-84% with no upward trend, so the full 500k would not crack it; more
  budget is not the lever. The freeze was a symptom, not the ceiling: the true
  remaining blocker is SEARCH/DISCOVERY — ~30% of episodes never find the hidden
  target before timeout. Keep normalized throttle + freeze rule + scan nudge
  permanently as the new healthy seeker baseline.
- **Next direction (owner intent): the target will MOVE.** A constantly-moving
  searcher (which PPO_29 now is) is the prerequisite for pursuit; a frozen one
  could never chase. The moving target makes finding/keeping the target harder, so
  the ~30% search-timeout gap and the moving-target work are the same problem.
  Design order agreed one-variable-at-a-time: (1) PPO_29 done = healthy baseline;
  (2) make the target move in the CURRENT arena, first WITHOUT the LSTM — but the
  hand-coded target memory (`last_seen_target` fed for TARGET_MEMORY_STEPS) becomes
  STALE for a mover and must be reworked (feed current-if-visible, and consider a
  velocity/lead channel so Leaper can lead a briefly-lost mover); test whether
  reflexive chasing suffices when the target stays mostly in the 270° cone; (3)
  only if it fails when the target hides, add velocity-lead channels, then the LSTM
  memory brain — which for a MOVING target finally has a real temporal signal to
  exploit (unlike the still-target PPO_19-21 line that lost to memoryless); (4)
  THEN, separately, bigger arena + larger obstacles. Open creative questions before
  step 2: target speed relative to Leaper (must be catchable — slower or equal) and
  whether it flees/evades vs merely wanders (fleeing is a large difficulty jump).
- **PPO_30 memory-search 200k complete** (`rl_artifacts/ppo_30_lstm_search_200k/`,
  seed 27495, 204,800 transitions). Revives the recurrent LSTM brain
  (`--memory lstm`, `MlpLstmPolicy`, `lstm_hidden_size=256`, `n_lstm_layers=1`, lr
  2e-4) to test whether memory-of-where-searched helps the hidden-target SEARCH
  problem — the first task where memory has a real job (unlike the still-target
  PPO_19-21 line). ONLY the brain changed; it inherits all PPO_29 env changes
  (normalized throttle, freeze rule, scan nudge) and the same 6-obstacle arena.
  Trains fresh (LSTM weights can't warm-transfer from an MLP). Trainer changes:
  restored the `RecurrentPPO` build branch behind `--memory {none,lstm}` +
  `--lstm-hidden-size`; `predict_with_memory` and all four inference loops already
  carried LSTM state, so no eval change was needed. Runs at ~15s/1k (7x slower than
  plain PPO's ~2s/1k). Deterministic 100-episode exam: **53% success**, 47%
  timeout, stopped 0.25% (freeze fix carried over perfectly), forward 99.7%,
  collision 3.6%, avg episode length 372.8, mean physical throttle 0.37 (timid).
  VERDICT: below memoryless PPO_29 (69%) at 200k, BUT the shape differs decisively
  — memoryless plateaued flat by 140k while the memory brain was STILL climbing
  steeply at the budget cut (25-maze checkpoints 36->48->60% in the final stretch).
  So 53% is budget-limited mid-climb, not a memory ceiling. The timid 0.37 throttle
  + 373-step episodes = "searches constantly but slowly/undecisively," a classic
  still-learning signature. Open question unresolved: whether more steps push memory
  PAST ~70% (a real win, keep it for the moving target) or it merely ties ~70% like
  PPO_19-21 did on the easier task. DECISION (owner): run the memory brain to 500k
  for the definitive answer — fresh run, ONLY the budget changed (lr held at the
  healthy 2e-4; do NOT hike lr, that broke PPO_19; idle penalty held at 0.04).
  `rl_artifacts/ppo_30_lstm_search_500k/`, launched 2026-09-02, ~80-85 min.
  RESERVED next lever if 500k still lands timid (throttle ~0.37): raise the idle
  penalty (the proven PPO_25 anti-timidity tool) — a targeted decisiveness fix that
  does NOT touch the learning rate. Owner's own expectation: memory likely only
  TIES ~70%, not beats it; if so, memory is not the lever and we proceed with the
  memoryless brain.
- **PPO_30 memory 500k COMPLETE — memory line CLOSED for the seeker task**
  (`rl_artifacts/ppo_30_lstm_search_500k/`, seed 709447, 507,904 transitions).
  Final 100-maze deterministic exam: **39% success**, 61% timeout, 10.85 net
  progress (vs memoryless PPO_29's 69% / 31% / 20.26) — worse than its own 200k
  version (53%). The 25-maze checkpoints oscillated 44-68% throughout and never
  settled (the LSTM instability seen in PPO_19-21), so the final saved model landed
  on a weak point and the rigorous exam exposed it. Verdict: on the hidden-target
  SEARCH task the recurrent memory brain is worse AND less stable than memoryless;
  the "memory of where I searched" hypothesis did not pay off, matching (exceeding)
  the owner's tie-or-lose prediction. DECISION: drop the LSTM, keep memoryless
  PPO_29 as the seeker champion. Do not retry memory for the static-target line.
  `--memory lstm` remains in the trainer for a possible future MOVING-target test
  (the one case with a genuine temporal signal), but that is stage 3, deferred.
- **PPO_31 2-layer LSTM + boosted exploration — ABORTED at 164k, from-scratch LSTM
  closed a second time** (`rl_artifacts/ppo_31_lstm_explore_250k/`, natural seed,
  `--memory lstm --lstm-layers 2 --lstm-hidden-size 256 --normalized-throttle
  --exploration-reward 0.05 --new-view-reward 0.01 --learning-rate 0.0002`, n_epochs
  auto-lowered to 5 for the recurrent branch as a stability lever). Owner's chosen
  experiment: give the memory brain more capacity (2 layers) + a 5x stronger
  new-area reward (`EXPLORATION_REWARD 0.01->0.05`, `NEW_VIEW_REWARD 0.002->0.01`) to
  see if it can crack search. Result before it died: deterministic exam climbed
  0->24% by 100k then FLATTENED, oscillating 16-24% through 160k — below memoryless
  PPO_29 (69%) AND below PPO_30's 39%. Two failure signatures: (a) 2 layers = harder
  to train, not smarter (the flagged instability); (b) episode length ballooned
  180->640+ steps = the boosted exploration reward backfired into "professional
  wanderer" farming new-cell bonuses instead of committing to find the target.
  The run **stopped on its own at ~164k/250k** (owner confirmed they did not stop
  it); log ends cleanly after the 160k checkpoint with NO traceback => external kill,
  almost certainly OUT OF MEMORY (2-layer LSTM is the heaviest brain we run, ~20MB
  per save, alongside TensorBoard + browser). Checkpoints saved through 160k; no
  final model/eval. Lesson recorded: prefer the light MLP + watch RAM; a from-scratch
  recurrent brain wastes capacity relearning the body — hence the state-augmentation
  pivot in the headline above.
- **Trainer changes landed for PPO_31 (kept):** new CLI `--lstm-layers` (default 1),
  `--exploration-reward`, `--new-view-reward`; the recurrent branch now uses
  `n_epochs=5` (plain MLP stays 10); config records `lstm_layers`,
  `exploration_reward`, `new_view_reward`. Compile-checked; 2k smoke ran clean.
- **SUPERSEDED plan (2026-09-02): stage-2 densify-the-arena is PAUSED.** The owner's
  priority pivoted (2026-09-03) to getting a MEMORY seeker to ≥85% via the coverage-
  map state augmentation (see headline), then the moving target. Densify + bigger
  arena/obstacles remain valid later stages but are no longer the immediate next
  step. The memoryless PPO_29 (69%) is still the fallback seeker champion if the
  coverage-map approach does not beat it.
- Mandatory launch workflow: surface `http://127.0.0.1:5173/?training=1` and
  `http://127.0.0.1:6006/`, keep displayed replays deterministic, and attach a
  completion watcher/heartbeat so the owner receives final deterministic results
  automatically rather than needing to ask for status.
- Deployment note: the browser JS port (`src/brain/leaperWorld.js`) still mirrors
  the plain `[0,1]` throttle. If a PPO_29 model is ever exported to the web game,
  the JS `stepWorld` must apply the same `(action+1)/2` mapping and the fixtures be
  regenerated; the current live game still runs the PPO_25 champion, so no JS
  change is needed yet.
- `CLAUDE.md` contains the concise paste-ready implementation prompt. Read
  `TRAINING.md` for the complete evidence and `RL_SPEC.md` for current constants.
