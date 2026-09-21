# Leaper

Leaper is a browser-based Three.js hexapod simulation with a separate Python reinforcement-learning experiment. The browser project uses small JavaScript modules so the robot, environment, target, controls, cameras, and simulation rules can evolve independently.

## Run the browser simulation

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/).
2. Open PowerShell in this project folder.
3. Run:

```powershell
corepack enable
pnpm install
pnpm dev
```

4. Open the address shown in the terminal, normally `http://localhost:5173`.

If you prefer npm, use `npm install` followed by `npm run dev` instead.

## Build a release version

```powershell
pnpm build
pnpm preview
```

The optimized files are generated in `dist/`. That folder is temporary and is not committed to Git.

## Where things belong

- `src/robot/`: the hexapod's visible construction and parts.
- `src/world/`: ground, rocks, obstacles, and target objects.
- `src/simulation/`: movement, gait, jumping, collisions, and live game rules.
- `src/controls/`: keyboard and touch input.
- `src/camera/`: chase, lens, and top-down views.
- `src/config/`: numbers you may want to tune, such as speed and leg proportions.
- `src/styles/`: the HUD and control appearance.
- `assets/`: future Blender models, textures, sounds, and other art files.
- `rl/`: future home of the modular Python training code.

## Why this does not use React

Three.js already controls the continuously changing 3D scene. React would be useful later for a large editor, inventory, menus, or data-heavy tools, but it would add another layer without helping the current simulation. Vite and native JavaScript modules give the project a professional development setup while keeping it approachable.

## Recommended next steps

1. Confirm the modular version matches the original prototype visually and behaviorally.
2. Move the Python RL files into an `rl/` package without changing their behavior.
3. Decide how the browser simulation and Python trainer will exchange observations and actions.
4. Add an `assets/` pipeline when the procedural robot is replaced or supplemented with Blender models.
5. Add focused tests for collision rules, movement math, and RL observations/rewards.

## Junkyard trained-brain playtest

The junkyard now runs the saved **7,757,824-step reverse-urgency recurrent
policy**, not the navigation pathfinder. The small on-screen badge identifies
its checkpoint and whether pink is visible, hidden in memory, or not yet found.
Hover over the badge for the policy-weight SHA256. If the brain service fails,
the run stops with an offline message; there is no substitute controller.

Start the local inference service with a Python 3.12 runtime that has the RL
requirements installed (the launcher can reuse this repository's existing
Windows .venv packages):

```powershell
python scripts/run_junkyard_brain.py
pnpm dev
```

Run these in separate terminals. Open
`http://127.0.0.1:5173/?map=junkyard`. A production preview can use port 4173.
The service listens only on 127.0.0.1:8767. The model is loaded from the local,
uncommitted `model_7757824/` directory, or supply `--model <checkpoint.zip>`.
It never trains, modifies weights, or writes to the source Blender file.

- **START RUN / STOP RUN** runs or pauses the brain. Memory survives a pause
  and target movement. **RESET**, a page reload, or applying size starts a new
  memory session. Applying size resumes the run if it was active.
- **RESTART RANDOM** places both Leaper and pink at new, separated clear
  positions with a connected ground route, randomizes Leaper's facing, resets
  its memory, and starts a fresh run. The route is used only to select a fair
  starting pair; it is never provided to the brain.
- **WASD / IJKL** moves pink, **Shift** moves it faster. Pink is selected on
  startup; **P** or the pink button toggles target selection.
- In top view, **Shift + click** places pink directly. It may be placed in a
  blocked area for testing; the brain does not get a guaranteed route to it.
- **VIEW** cycles chase, lens, and top. Drag to look/pan; wheel to zoom.
- **OPTIONS** reveals size, reset, and the clearance overlay. Options start hidden.
- The overlay is only a conservative circular-footprint design aid. Green means
  connected to spawn under that approximation; it is not information given to
  the brain or a prediction of the learned policy's success.

The frozen observation/memory and movement recipe comes from the saved viewer
at commit 7689aca. It uses 34 inputs, a 270-degree view with 16 range rays,
remembered last-seen target, a search-coverage frontier note, recurrent policy
memory, signed forward/reverse throttle, and separate rotation/translation
collision recovery. Each model step is 1/30 simulated second. A slow machine or
connection reduces wall-clock playback speed instead of skipping policy steps.

Junkyard adaptation: the shared Blender collision JSON is conservatively
rasterized into 0.1 Blender-unit cells for sensing and the 19 body/leg sample
collisions. Robot dimensions, per-step movement, ray range and memory timing
remain in original robot units. The size control scales the map relative to the
rig; map extent determines distance normalization and the coverage grid.
Sensor readings therefore differ from the original circular-obstacle arena.
This is a new-map transfer test, not identical training physics or evidence of
training success. There is no climbing or jump control in brain mode.
Interactive runs continue after training catch/stuck/timeout flags, without
resetting memory or replacing actions, until Stop Run. A policy may still get
stuck or fail to search effectively; the viewer reports its actual behavior.

After editing and saving the Blender map, regenerate the shared export:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe' -b 'C:/Blender/Junkyard_Blockmesh.blend' --python scripts/export_junkyard.py
```

Restart the inference service to reload collision geometry, and reload the
browser (rebuild first if using production preview).

Validation: `node --test tests/junkyard-*.test.js`,
`python tests/test_junkyard_brain.py`, and `pnpm build`.
The Python tests need the local checkpoint. They verify its identity, matching
actions, hidden-target isolation, remembered target, reverse motion, and a
120-step actual-model search in the imported map.
