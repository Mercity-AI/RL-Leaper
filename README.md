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
