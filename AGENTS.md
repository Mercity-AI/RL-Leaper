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
- `src/config/`: shared tuning values such as robot proportions and movement speeds.
- `src/styles/`: HUD and touch-control presentation.
- `rl_environment.py`: Gymnasium environment defining observations, continuous movement actions, rewards, collisions, and episode termination.
- `train_rl.py`: Stable-Baselines3 PPO training, evaluation, reward logging, plots, and model export.
- `requirements-rl.txt`: Python RL and visualization dependencies.
- `README-RL.md`: setup, training, TensorBoard, and playback instructions.
- `rl_artifacts/`: generated models, CSV logs, plots, and TensorBoard data; do not commit large or transient outputs.

There is currently no asset directory or automated test suite. Add `assets/` when external models, textures, audio, or other media are introduced.

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
python train_rl.py --timesteps 20000       # smoke test
python train_rl.py --timesteps 300000      # full training
python train_rl.py --timesteps 300000 --watch
```

Validate Python syntax with `python -m py_compile rl_environment.py train_rl.py`. `train_rl.py` also runs Gymnasium's environment checker before training.

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
