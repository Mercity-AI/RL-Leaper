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
- **WASD / IJKL** moves Lola relative to the camera; **Shift** runs faster.
  **S** backs up without turning her around. Her smaller collision footprint
  allows narrower passages than the Leaper can use.
- **F** (or the weapon button) switches between M416 and Basic Gun outfits and
  their carrying poses. Weapons are visual only; shooting is not implemented.
- **C** toggles crouching. WASD uses the authored crouch-walk cycle; Shift does
  not override crouch speed. Standing collision clearance remains conservative.
- **Double-tap and hold the second tap, then drag** moves a screen control or
  panel. Double-click then drag also works. Placement is remembered locally and
  kept within the window when resizing. Escape releases the game mouse first.
- Click the scene to capture the mouse for looking; **Escape** releases it.
  Dragging also works when mouse capture is unavailable. **VIEW** switches
  between Lola's chase camera and top view; wheel zooms.
- In top view, **Shift + click** places Lola on clear ground. A clear spot does
  not guarantee that the Leaper can reach it.
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

Lola's browser copies live in `assets/characters/lola/`. They are exported by
`scripts/export_lola.py` from the Basic Gun and M416 run scenes in
`C:/Blender/LOWPOLY/Lola_both_animations.blend1.blend`, using the lower-body cycle
from `Lola_walk_final.blend`. The walk cycle plays more slowly than the run.
Idle is an averaged hold; backward movement reuses the cycle in reverse.
A/D use the authored Crossover Left/Right clips from scenes 13–16 in the
updated Blender file, with the matching gun transforms. Standing diagonals use
the crossover when sideways input is at least as strong as forward input.
Crouched sideways movement still uses the crouch-walk cycle. C toggles crouch
once per press, and the weapon button also displays CROUCHED or STANDING.
The crouch clips come from the two authored Crouch Walk scenes. Playback keeps
Blender's root height instead of repositioning the body to follow the lowest
foot each frame. Continuous transition weights and preserved stride phase avoid
restarting the cycle on every walk/run/crouch transition. Animation time uses
elapsed time, including frames longer than 33 milliseconds (capped at 100 ms
for tab stalls).
The exporter never saves the source Blender files. Lola's position replaces
the pink target; the saved brain and its visibility/memory rules are unchanged.

After exporting Lola, run `node scripts/measure_lola_steps.mjs`. It measures
the supporting foot's backward travel in each in-place animation and writes
`assets/characters/lola/stride-profiles.json`. Player translation follows this
phase-dependent distance instead of a separate fixed movement speed. Walking,
running, crouching, and crossovers each use their own measured stride. Shift
selects the faster cycle/cadence; it does not multiply distance independently.
Collision limits animation advancement as well as movement. A constant measured
floor offset per clip (blended on transitions) grounds the idle pose without
snapping the body to a different foot each frame. Backward and crouched sideways
motion still reuse existing clips and may need dedicated authored animations.

Character checks: `node --test tests/lola-player.test.js`. These load the real
exported skeletons and clips, check animation, backward movement, sprinting,
wall sliding, and weapon switching. Texture decoding and browser mouse capture
still require a manual visual check.

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
