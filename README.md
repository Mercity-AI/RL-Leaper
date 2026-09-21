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

## Junkyard pathway playtest

Open `http://127.0.0.1:5173/?map=junkyard` after starting the dev server.
The imported map is a browser copy of `C:/Blender/Junkyard_Blockmesh.blend`;
the original Blender file is never saved or modified by the exporter.

- **START RUN / STOP RUN** controls continuous chasing of the pink target.
  Moving pink replans the route automatically. Reaching it or losing a clear
  route keeps the run active; move pink onto reachable floor to continue.
- **WASD** temporarily takes manual control; releasing it resumes an active
  chase. **Shift** sprints; **Space** jumps.
- **VIEW** cycles chase, lens, and top cameras. Drag to look/pan; wheel to zoom.
- In top view, **Shift + click** places pink. An active run follows it automatically.
- Alternatively select pink with **P**, then move it with **IJKL**.
- Adjust the **size slider**, then **APPLY SIZE** to reload at that size.
  An active run automatically resumes after the reload.
- **SHOW CLEARANCE** shows green reachable floor, amber disconnected floor,
  and red blocked floor. Connectivity is measured from the starting position.

Width is the conservative circular clearance around the legs, measured in the
original Blender map units. The initial width is 2.4; the original simulator's
clearance is 7.98. Internally the map scales relative to the unchanged robot rig.
Displayed simulator speed is therefore not speed in original Blender units.

This is a flat-ground design preview using mesh triangle projections and a
0.4-unit navigation grid, not the trained PPO policy or articulated physics.
Narrow passages can be rejected conservatively. Low debris blocks movement;
there is no climbing, walking up ramps, or jumping over collision barriers.
Objects above the estimated robot height are excluded from clearance checks.
Changing size also changes overhead clearance. Saved RL models and training
rules are unchanged.

After editing and saving the map in Blender, refresh the browser export:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.3/blender.exe' -b 'C:/Blender/Junkyard_Blockmesh.blend' --python scripts/export_junkyard.py
```

Then reload the dev page (or rebuild if using `pnpm preview`). Validation:
`node --test tests/junkyard-navigation.test.js` and `pnpm build`.
