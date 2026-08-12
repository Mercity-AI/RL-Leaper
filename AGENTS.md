# Repository Guidelines

## Project Structure & Module Organization

This repository is a compact Leaper simulation and reinforcement-learning proof of concept. The long-term goal is to turn it into a maintainable game/simulation project without losing the speed and clarity of the current prototype.

- `index.html`: small browser entry point containing the HUD and control markup.
- `src/main.js`: creates and connects the scene, world, target, robot, controls, camera, and simulation.
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
- `rl_artifacts/`: generated models, CSV logs, plots, and TensorBoard data; do not commit large or transient outputs.
- `public/rl_live_state.json`: generated replay bridge consumed by the browser visualizer; it is ignored by Git and exists only after training publishes it.

There is currently no asset directory. Add `assets/` when external models,
textures, audio, or other media are introduced. Focused Python checks now live
under `tests/`, beginning with PPO_10 signed-throttle movement and diagnostic
classification coverage.

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
src/
  main.js
  camera/
  config/
  controls/
  core/
  robot/
  simulation/
  world/
  styles/
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
- Generated body-only and diagnostic replay archives exist locally under ignored `rl_artifacts/` folders. PPO_8 is preserved under `ppo_8_collision_unaware_run/`, PPO_9 under `ppo_9_collision_awareness_100k/`, the validation-only PPO_10 smoke run under `ppo_10_signed_throttle_smoke/`, and the main PPO_10 run under `ppo_10_signed_throttle_100k/`. `PPO_10_SMOKE` is only a short technical verification and must not be used as the experimental result. Do not commit these generated artifacts. The visualizer accepts replay JSON containing checkpoint episodes, actual training rollouts, or both.
- TensorBoard should normally be launched against the complete `rl_artifacts/` root so PPO_1 through PPO_10 can be compared. PPO_8 and PPO_9 event files exist in both the legacy shared TensorBoard folder and their archives, so use explicit named paths when a duplicate-free run list matters.
- Manual browser verification has covered the light training scene, chase and top views, natural top-view panning, wheel zoom, media controls, rollout selection, checkpoint selection, live/imported feed switching, and import of the archived `PPO_2` replay. A complete manual play-through of the normal player-controlled simulator is still required: verify all three camera modes, keyboard/touch movement, jumping, obstacle blocking, pink-target selection/movement, and resizing.
- No local development or TensorBoard server should be assumed to be running. Start them explicitly when needed.

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
python train_rl.py --timesteps 20000 --run-name PPO_10_SMOKE --artifact-dir rl_artifacts/ppo_10_signed_throttle_smoke
python train_rl.py --timesteps 100000 --run-name PPO_10 --artifact-dir rl_artifacts/ppo_10_signed_throttle_100k
tensorboard --logdir rl_artifacts
```

Validate Python syntax with `python -m py_compile rl_environment.py train_rl.py tests/test_ppo10_signed_throttle.py`. Run the focused checks with `python -m unittest discover -s tests -p "test_*.py"`. `train_rl.py` also runs Gymnasium's environment checker before training.

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
