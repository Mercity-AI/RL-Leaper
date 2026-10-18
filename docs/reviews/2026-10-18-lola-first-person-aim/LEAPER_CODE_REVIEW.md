# Leaper — Deep Code Review: fix/lola-first-person-aim

| | |
|---|---|
| **Branch** | `fix/lola-first-person-aim` |
| **Commit reviewed** | `9b384c9` "Save Lola movement, combat, audio, and junkyard assets". It sits 25 commits on top of the merge-base `8be4bc6` with main. |
| **Newer remote tip** | `be3f9fb` "Include approved Leaper brain checkpoint for playback". It only adds the brain files `model_7757824/` (0.91 MB). Every code finding still applies. |
| **Date** | 2026-10-18 |
| **Scope** | The whole game branch: about 6,000 lines of JavaScript in `src/`, the tests, the Python brain server (`rl/junkyard_*.py` and the frozen recipe it uses), the assets and their export scripts, the docs and tooling, the Git history, and how the branch compares with main. |
| **Method** | 11 area reviewers and 0 follow-up reviewers. An independent verifier then re-checked every finding and tried to disprove it, by re-reading the code, running the tests, reproducing bugs in a headless browser and running small measurement scripts. |
| **Verification stats** | 190 findings raised. 189 kept, 1 refuted, 0 unverifiable. 71 of the kept findings were only partly confirmed and were corrected in severity or detail. |
| **Severity of the 189 kept findings** | 3 critical · 23 high · 100 medium · 60 low · 3 info. All three critical findings share one root cause: the brain only runs in a separate Python program. With `be3f9fb` the checkpoint is in the repo, so anyone who installs Python and PyTorch can play; by this report's own scale that root cause is now **high**, not critical. It is still the biggest blocker for a web release. |
| **Code changes made by this review** | **None.** This report contains instructions only. One ready-made, tested patch is attached for the 4 failing tests (`attachments/lola-test-fix.patch`); it has not been applied. |

**Severity scale.** *Critical*: breaks the core game loop or goal, or makes the project unrunnable for anyone else. *High*: a real bug players will hit, or an architectural problem that blocks planned work (more enemies or levels, a web release, designer tuning, merging with main). *Medium*: a meaningful cost to maintenance, performance or game feel. *Low*: polish. *Info*: worth knowing.

**Effort scale.** XS = under 2 hours · S = up to 1 day · M = 2-5 days · L = 1-3 weeks · XL = more than 3 weeks. A **quick win** is a low-risk change that takes about a day or less.

**The frozen brain recipe.** The Leaper's trained brain only works if it keeps receiving exactly the inputs it was trained on (34 numbers), and if its moves keep the same meaning (0.375 units and 9 degrees per step, signed forward/reverse throttle, 19 collision discs). That bundle is called the *frozen recipe* in this report. Unless a fix says otherwise, no recommendation changes it.

**How to read this report.** Chapter 1 is the plain-language summary for the owner. Chapter 5 is the fix guide you can hand to a developer as it is. Chapter 10 holds every finding with its evidence (file and line numbers, quoted code and command output).

#### Words used in this report

| Term | Meaning here |
|---|---|
| **Brain, policy, checkpoint** | The trained neural network that steers the Leaper. The *checkpoint* is the saved file of its learned numbers (`model_7757824/`, trained for 7,757,824 steps). |
| **RL, PPO, LSTM** | *Reinforcement learning*: the brain learned by trial and error. *PPO* is the training method. The *LSTM* is the brain's short-term memory, which is why it is called "recurrent". |
| **Brain server / inference server** | The separate Python program (`rl/junkyard_server.py`) that runs the brain and answers the game over the network on your own PC (`127.0.0.1:8767`). |
| **HTTP request, round trip** | One question from the game to the server and its answer. *Latency* is how long that takes. |
| **Frame, frame rate, dt** | The game redraws the screen many times a second (each redraw is a *frame*). *dt* is the time since the last frame. |
| **Fixed tick** | Running game rules at a steady rate (for example 60 times a second) no matter how fast the screen redraws. Leaper has no fixed tick today. |
| **State machine (FSM)** | One clear record of what the game is doing ("Loading", "Playing", "Paused", "Ended") with explicit rules for moving between those states. |
| **God object** | One class that knows about and controls almost everything else, so nothing can be changed or reused on its own. |
| **Hitscan, raycast** | An instant bullet, worked out by tracing a straight line (a *ray*) and finding the first thing it touches. |
| **BVH** | A search structure that makes raycasts fast by skipping most triangles. Leaper doesn't use one yet. |
| **Mixer, blend, IK** | The *mixer* plays and mixes animation clips. A *blend* mixes several clips by weight. *IK* (inverse kinematics) bends legs so the feet land where they should. |
| **CI** | *Continuous integration*: a service (for example GitHub Actions) that runs all tests automatically on every change. |
| **LFS** | *Git Large File Storage*, the standard way to keep big art and audio files out of the normal Git history. |
| **ONNX, onnxruntime-web** | A portable file format for neural networks, plus the library that runs such files inside a web page. |
| **Parity fixtures** | Recorded "for these inputs the brain must give these outputs" examples, used to prove that a port behaves exactly like the original. |
| **GLB, draw call** | *GLB* is a 3D model file. A *draw call* is one batch of work sent to the graphics card; fewer is faster. |

---

## 1. The short version (plain language)

- **The foundations are stronger than most prototypes.** Lola's speed comes from her own animations, so her feet rarely slide. The Leaper's leg breaking, its eye-bolt timing and the bullet-against-cover checks are solid work. There are about 230 automated checks, including a 155-check combat test that passes.
- **The biggest problem: the Leaper's brain runs as a separate Python program on your PC.** Without it the Leaper stands still and never shoots. That means nobody else can really play, and the game can't go on a website. The newest commit on the branch (`be3f9fb`, pushed today) adds the brain file to the repo, but Python and PyTorch are still required. The long-term fix is to run the brain inside the browser. A scratch test converted it to a 148 KB web file that gave the same answers.
- **The end of the fight is broken at its most important moment.** The killing shot shows no tracer or sparks. The camera freezes, and if you were aiming it stays stuck inside Lola's head. Both characters freeze mid-step. Fixing it takes about a day.
- **Other bugs players will hit:**
  - The Leaper suddenly spins almost a full circle once it has turned about one and a half times in one direction.
  - Lola can fire backwards when her back is against a wall or the Leaper is behind her.
  - All six legs can be shot off, and the body keeps floating and fighting.
  - When she runs and shoots, her hands come off the gun.
  - Angled walls stop her dead instead of letting her slide along them.
  - On phones and tablets, the on-screen controls freeze after START.
- **The Leaper moves 10-15% slower than designed on a normal 60 Hz screen,** and slower still on a busy computer, so the difficulty changes from machine to machine. A one-line change fixes most of it.
- **The safety net isn't being used.** Four Lola tests have been failing since the last commit, one browser test page fails, and nothing runs the tests automatically. Make them pass and run them on every change first, because that protects every later fix.
- **What the current code layout holds back:** a second Leaper or another enemy type, new levels, a web release, and merging with the RL lab on main. One "playtest" object is wired to exactly one Leaper. The camera, the sun and the status text are driven from inside the Leaper's animation code, and the brain's network code also moves Lola.
- **As the designer, you can't tune the fight from one place.** The numbers are spread over about 15 code files. The docs and the on-screen help describe an older game. The clearance overlay uses a different Leaper shape from the one the brain actually moves. At your chosen size (5.5) the map is very tight for the Leaper.
- **Release blockers outside the code:**
  - The two M416 sounds carry a "NonCommercial" licence, and no sound credits are recorded anywhere.
  - The Blender source files for Lola and the map exist only on your PC.
  - The launcher only works on Windows.
- **Engine: stay on Three.js for now, and upgrade it after the merge with main.** Switching engines today would throw away the working game and its tests, and you would still have to rebuild the brain's inputs exactly in the new engine. Look again at PlayCanvas or Godot once the brain runs in the browser.
- **Suggested order:**
  1. Make the tests pass and run them automatically.
  2. Do the one-day bug fixes in the fix guide (chapter 5).
  3. Make the game playable on someone else's computer.
  4. Merge with main.
  5. Build a proper game-loop and encounter skeleton.
  6. Move the brain into the browser.

---

## 2. What Leaper is today

The branch is a browser game built with **Vite 7** (the development server and bundler) and **Three.js r128** (a 3D library from 2021). It has about 6,000 lines of JavaScript in `src/`. One `index.html` and one `src/main.js` serve three different apps, chosen by the page address:

- `/` opens the legacy sandbox.
- `?training` opens an obsolete PPO_10 replay viewer.
- `?map=junkyard` opens the actual game.

When the junkyard boots, it loads the map and its flattened collision triangles, then 14 Lola model files (two complete outfits, one per gun), then builds the Leaper from code. `JunkyardPlaytest` then wires everything together and passes itself (`this`) to every subsystem.

The Leaper's movement brain is a recurrent PPO policy with LSTM memory, trained for 7,757,824 steps on 34 inputs. It does **not** run in the browser. About 10 times a second, the game sends an HTTP request to a Python program on the same PC. That program runs a byte-identical frozen copy of the lab environment from main at `7689aca`, plus the brain, and replies with where the Leaper should be. The Leaper's *shooting* is a separate, small hand-written behaviour tree in the browser.

### 2.1 Module map and the browser ↔ Python brain data flow

```
BROWSER  (Vite 7 dev server or static build · three r128 · one index.html · one 695 KB JS chunk)
│
│  src/main.js ──reads the URL──┬──> '/'             legacy sandbox (rocks, pink TargetMarker, keyboard hexapod)
│                               ├──> ?training=1     TrainingVisualizer (obsolete PPO_10 arena, polls rl_live_state.json)
│                               └──> ?map=junkyard   THE GAME
│
│  Junkyard boot (each step waits for the previous one):
│    createJunkyardWorld   junkyard.glb (3 MB) + collision.json (5.9 MB, 84,660 flattened triangles)
│        -> 2 JunkyardNavigation grids (Leaper circle r = width/2, Lola r = 0.25)
│        -> scales the WHOLE MAP by 7.98 / width around the fixed-size robot; rewrites lights and fog
│    LolaPlayer.create     14 GLBs (2 complete outfits = 2 animation mixers)
│    createHexapod         105 meshes, leg parts at the scene root
│    InputController, CameraController, LeaperSimulation
│    JunkyardPlaytest      "god object": passes `this` to EyeVision, JunkyardBrain, LeaperCombat, LeaperPov, PlayerWeapon
│
│  Every frame (requestAnimationFrame, variable dt capped at 0.1 s, no fixed tick):
│  JunkyardPlaytest.update
│   1. JunkyardBrain.update
│        ├─ reads InputController -> LolaPlayer.jump / move
│        │    (120 Hz sub-steps x BOTH outfits; collision via world.playerBlocked,
│        │     which is MONKEY-PATCHED to add the Leaper's contact discs)
│        ├─ every >= 0.1 s, with only one request in flight:
│        │                                                     ┌────────────────────────────────────────────────┐
│        │   POST /step  (or /sense while paused) ────────────>│ PYTHON  rl/junkyard_server.py @127.0.0.1:8767  │
│        │   text/plain JSON, ~360 bytes                       │ single-threaded HTTPServer                     │
│        │                                                     │ origin allow-list: ports 4173/4175/5173/5175   │
│        │                                                     │ BrainSession =                                 │
│        │                                                     │   JunkyardEnv( SeekerEnv(                      │
│        │                                                     │     rl/checkpoint_environment.py               │
│        │                                                     │     = frozen copy of main@7689aca ) )          │
│        │                                                     │   + 0.1 m collision raster                     │
│        │                                                     │     (rebuilt ~30 s per Leaper width)           │
│        │                                                     │   + 3D eye-level sight (98k triangles)         │
│        │                                                     │   + RecurrentPPO model_7757824                 │
│        │                                                     │     (34 inputs -> throttle, turn; LSTM memory) │
│        │   <──── authoritative Leaper x / z / yaw, ──────────│                                                │
│        │         sight debug, visible / memory flags         └────────────────────────────────────────────────┘
│        └─ exponential chase toward the reply -> LeaperSimulation.updateExternal
│               (body, gait, leg IK  +  CAMERA update  +  SUN follow  +  status text)
│               <-- this whole call is SKIPPED once combat.dead (end of fight)
│   2. LeaperCombat.update   own sight rays (22 x map scale, ±135°) -> AttackController behaviour tree
│                            (paused unless walking && brain.ready); bolts vs Lola's bone capsules;
│                            Lola HP + HUD DOM; Leaper HP + floating bar; leg debris / HangingLeg;
│                            LaserAudio (= the whole game's audio); DEBUG button
│   3. PlayerWeapon.update   ammo, reload, auto-fire. fire(): ray from the CAMERA LENS to an aim point,
│                            then a ray from the muzzle; hits the Leaper's RENDER meshes
│                            -> combat.legs.hit + combat.damageLeaper -> finish() -> playtest.stop()
│   4. LeaperPov.update      spectator view
│  Render: camera.beforeRender (fades) -> weapon.beforeRender (hide Lola when aiming, body kick)
│          -> pov.beforeRender -> renderer.render -> the after-hooks in reverse order
│
│  Shared JS <-> Python contract:  src/config/player-contact.json, src/config/eye-vision.json (version-checked)
│  Copied by hand in both languages:  7.98 (= 2 x BODY_COLLISION_RADIUS), 3.82 (= STANDING_HEIGHT + 1.5),
│                                     0.12 floor threshold, 7757824 (in 8+ places)
│  Game-flow state: about 15 loose flags (walking, playerMode, brain.running/ready/busy, combat.dead,
│                   target.defeated, tree.state, camera gameplayStarted/mode/aiming/fallbackMouseLook,
│                   pov.active, document.hidden). There is no cleanup ("dispose") path.
```

### 2.2 What is already good

Credit where it's due. These are the parts later work should keep and build on.

- **Stride-matched animation.** Lola's travel speed comes from foot travel measured in her clips, and each clip's playback rate is set so the planted boot keeps pace (planted-toe slip about 9% of run speed, and much less on a pure strafe). This is close to Unreal-style "distance matching". Foot contacts are measured once when the game loads, not every frame.
- **Solid combat mechanics.** Laser bolts sweep their whole travel distance every frame against cover and against capsules around Lola's bones, so they never tunnel through walls. The leg-damage physics (debris, hanging stumps) work. `AttackController` is small and independent of the engine and page, its track → lock → fire warning is readable, and it re-checks the line of fire just before releasing.
- **A careful brain handshake.** On reset the browser checks the brain's step count, the policy's SHA256 fingerprint and the contact and sight versions. The client keeps one request in flight, uses a generation counter to throw away stale replies, retries a few times, and keeps the last confirmed pose while paused. `load_brain` refuses any checkpoint except the exact 7,757,824-step, 34-input one.
- **An exact frozen recipe.** `rl/checkpoint_environment.py` is byte-identical to the environment the brain was trained in. JavaScript and Python share versioned JSON files for player contact and eye vision.
- **Tests that use the real assets.** The Node tests load the real exported Lola skeletons and clips and the real junkyard collision data. `tests/browser-combat.js` is a 155-check regression of the whole combat loop in a real browser, and it passes headless as it is.
- **Tidy basics.** ESLint core rules find only 3 unused variables. The lockfile is committed and the package manager version is pinned. Audio is well managed: a voice cap, sounds stop when the tab is hidden, and an epoch counter stops stale shots from replaying. The JS heap stays flat while you sprint and fire. Commit messages are honest, and the last one states its own 65/69 test result.
- **A readable layout.** The folders are clear (camera, config, controls, core, robot, simulation, world, styles), most modules are small, and the comments are written in plain language a designer can follow. Sound slots let you drop a WAV into `public/audio/` with no code change.

---

## 3. Health check

| Check | Result | Notes |
|---|---|---|
| **Build** (`pnpm build`) | ✅ Succeeds, with a warning | One JS chunk of 695 KB (186 KB gzipped) triggers Vite's ">500 KB" warning. `dist/` also ships `collision.json` 5.87 MB, `junkyard.glb` 3.07 MB, `lola-basic.glb` and `lola-m416.glb` about 1.2 MB each, and `lola-walk.wav` 4.5 MB. |
| **Node unit tests** (`node --test tests/*.test.js`) | ❌ 65 / 69 pass | All 4 failures are in `tests/lola-player.test.js`. The same tests passed at the previous commit `d0dc868` (35/35 then), so the last commit broke them. See 3.2. |
| **Browser test pages** (headless Chromium) | ⚠️ 1 pass, 1 fail, 1 demo | `tests/browser-combat.html`: **PASS 155/155** in about 4-5 s. `tests/camera-player.html`: **FAIL** at its 12th check, with two more stale checks behind it. `tests/camera-preview.html` is a visual demo with no pass/fail. |
| **Python brain tests** | ⚠️ Can't run at `9b384c9`; 9/9 pass with `be3f9fb` | At the reviewed commit both files stop in `setUpClass` because `model_7757824/` is missing (`FileNotFoundError … Ran 0 tests … FAILED (errors=1)`). The model-free tests inside them can't run either. With the `be3f9fb` checkpoint and PyTorch in a separate scratch venv: `test_junkyard_brain.py` 4/4 and `test_eye_vision.py` 5/5 pass. |
| **Lint** | ✅ Clean, but not enforced | ESLint core rules (scratch config) over `src`, `tests` and `scripts` report only 3 unused variables. The repo has no ESLint config or lint script. Prettier would reformat 50 of 52 JS files, so don't run it before the merge with main. The complexity rule flags `LolaPlayer.moveStep` (176 lines, complexity 90). |
| **Type-check** | — Not set up | There is no `tsconfig`/`jsconfig` and no typecheck script, and Three.js r128 ships no type definitions (`.d.ts`), so editors and `tsc --checkJs` see three.js as untyped. |
| **Browser runtime, no brain** | ⚠️ Runs; the Leaper is inert | `/?map=junkyard` loads, but the console shows `net::ERR_CONNECTION_REFUSED http://127.0.0.1:8767/reset` and the badge reads `BRAIN OFFLINE — START RUN TO RETRY`. The Leaper never moves or fires. |
| **Browser runtime, live brain** (`be3f9fb`) | ✅ Works | In a 90 s headless fight the brain reported ready after 29.8 s. The Leaper saw Lola, closed in from 5.8 to 3.2 units, cycled tracking → charging → firing → cooldown, fired 2 bolts and took Lola from 100 to 84 HP. There were no console errors. |
| **Merge with main** | ❌ 7 conflicting files | `git merge-tree --write-tree main HEAD` conflicts in `.gitattributes`, `README-RL.md`, `TRAINING.md`, `rl/seeker_env.py`, `src/camera/CameraController.js`, `src/main.js` and `src/world/TargetMarker.js`. The branch is 25 commits ahead of main and 5 behind. |
| **CI / automation** | ❌ None | There is no `.github/`, no `test`, `lint` or `check` script, and no `vite.config.js`. |

### 3.1 Build

The build works. The single bundle includes all three apps (sandbox, training viewer and game) and all of three.js, which causes the size warning (`perf-single-bundle`, info). The large runtime files are shipped raw: no mesh compression, no compressed audio, and the collision triangles as JSON (`game-architecture-asset-pipeline`). One correction from verification: `collision.json` is about 0.77 MB over the wire when the host compresses it, as `vite preview` does.

### 3.2 Node tests: why the 4 Lola tests fail

Commit `9b384c9` added input easing (Lola speeds up and slows down smoothly) and foot lift. One failure is a real bug and three are tests that were not updated:

| Test (in `tests/lola-player.test.js`) | Line | Cause | Kind |
|---|---|---|---|
| #56 "animation clock and blending agree at 30 and 60 rendered frames per second" | 173 | `LolaPlayer.move` eases the input **once per rendered frame** (`src/robot/LolaPlayer.js:513-521`) and only then splits the frame into 1/120 s sub-steps (522-525). So 30 fps and 60 fps follow different speed curves. Holding W for 2 s gives 4.9611 / 4.9550 / 4.9477 / 4.9430 units at 20 / 30 / 60 / 144 fps. With the easing moved inside the sub-step loop it is 4.9436 at all of them. | **Real bug** (tiny: about 2 cm over 2 s) |
| #53 "each complete movement cycle travels its measured stride, with a stable floor offset" | 83 | The floor check ignores the new foot lift that `moveStep` subtracts (`LolaPlayer.js:604-609`). It also expects full-speed strides from the first frame, while the input now ramps up. | Stale test |
| #54 "C toggles crouch once per press and A/D select authored crossovers for both guns" | 113 | One 1/60 s frame after A→D leaves the eased side input at about 0.055, which is still `Run`. The test expects `StrafeRight` and still expects the old rate `2`. | Stale test |
| #57 "WASD directions, sprint, wall sliding, and weapon switch preserve player position" | 199 | One 0.1 s idle frame leaves Lola still in `Run`, because slowing down now takes about 14 frames at 60 fps. | Stale test |

A verified patch exists (fix 5.4). With it, the Lola tests pass 14/14 and the whole suite 69/69. With only the test changes, 13/14 pass, because the real bug remains.

### 3.3 Browser pages

`tests/camera-player.html` was added in `9b384c9` and has never passed in any commit. It stops at:

```
FAIL Error: mouse look without any button pressed
    at check (tests/camera-player.js:9:44) at tests/camera-player.js:27:3
```

The same commit changed the chase camera so it only turns while the mouse is captured (`src/camera/CameraController.js:193`), and updated the Node test for that rule but not this page. With that check bypassed, two more checks fail: line 81, because the authored jump plays a push-off step, and line 89, a skid check that doesn't allow for strafing. Everything after them passes. Nothing runs these pages automatically (fix 5.20).

### 3.4 Python tests

The two unittest files load the checkpoint for whole test classes, import `torch` at the top of the file, and insert a Windows `.venv/Lib/site-packages` path. On any machine without the private checkpoint and the full ML stack, they fail before running anything, including the model-free anti-cheat checks: no peeking through walls, hidden positions never leak, Lola blocks the Leaper (fix 5.28). There are no tests of the HTTP handler, and the "action parity" test only compares the server with itself.

### 3.5 Runtime measurements

These were taken in headless Chromium with software rendering (SwiftShader). Counts and CPU costs are meaningful; frame rates are not.

- **Per frame:** 174 GL draw calls (41 for the main view, about 133 for the shadow pass), 244 meshes of which 225 cast shadows, 9 shader programs, 17 GPU textures, and 12 brute-force map raycasts while idle at spawn (up to about 21 with cover close behind Lola). Game logic costs about 0.65 ms per tick when idle and 1.4-2.4 ms with sprint and fire. The JS heap is steady at about 18.7 MB.
- **Brain server** (real checkpoint): `/step` takes 67.6 ms on average (p95 93 ms) measured at the server and a median of 91 ms (p90 121 ms) measured from the browser. The code comment says about 40 ms on the owner's machine. The first `/reset` takes 29.4 s while the collision raster is built.
- **Brain step rate:** the request gate gives about 9.2 Leaper moves per second at 60 fps with a 40 ms round trip, and about 6.3-6.5 with a 150 ms round trip. The design rate is 10 (fix 5.13).
- **In-browser brain feasibility:** a scratch export of the real actor, with the LSTM state as explicit inputs and outputs, is a 148 KB ONNX file. Its actions matched the Python brain to within 1e-6 over 200 real junkyard steps (and SB3 to within 4e-9), at about 0.37 ms per step.

### 3.6 Merge status with main

After `8be4bc6`, main became an RL "seeker" lab with an **in-browser ONNX brain** (a different, 26-input model) plus fixture parity tests. This branch built the game instead. The brain recipe was **copied** from the lab branch at `7689aca` with one import line changed, not merged, which turns `rl/seeker_env.py` into an add/add conflict. The last commit alone is 187 files and +80,153 lines, including 75 binaries and no LFS. The merge plan is in top priority 9 and roadmap phase 2.

---

## 4. Top 10 priorities

| Rank | What | Why | Effort | Finding ids |
|---|---|---|---|---|
| 1 | **Turn the safety net back on:** green suite, test scripts, browser runner, CI | Every later fix touches movement, camera or combat code that only these tests protect, and a permanently red suite hides new regressions. 4 Lola tests have failed since `9b384c9`, and `camera-player.html` fails. The fix (1 real easing bug + 3 stale tests) is already written and verified. CI has to exist before the merge with main. | S (1-2 days) | `player-failing-tests-root-cause`, `engineering-no-ci-no-test-scripts`, `engineering-browser-tests-manual-rot`, `engineering-python-tests-checkpoint-coupled` |
| 2 | **Fix the end of the fight** | The kill is the game's goal, and today it erases its own feedback (no tracer, sparks or shake). It freezes the camera, inside Lola's head when aiming, and freezes both characters. START PLAYER after an ending also soft-locks the mouse. The cause is a few lines in `stop()`/`reset()`, plus the camera being updated from inside the Leaper animator. Moving that call also fixes the TOP view after death. | S (about 1 day); M for a real death collapse | `core-loop-encounter-end-erases-feedback`, `game-architecture-presentation-driven-by-leaper-sim`, `enemy-combat-end-state-freeze`, `core-loop-no-game-state-machine` |
| 3 | **Fix the Leaper's visible motion bugs:** yaw whip, step clock, surging | The 290-degree whip shows up in every longer fight and looks like the brain failing. The discarded clock remainder makes the Leaper 10-15% slower than designed, and how much slower depends on the machine. The exponential chase makes the body surge 10 times a second and lurch when crippled. All three are rendering or timing fixes that leave the frozen recipe untouched. | S | `hexapod-yaw-wrap-whip`, `core-loop-brain-cadence-frame-dependent`, `hexapod-10hz-surge` |
| 4 | **Make the game playable on someone else's computer** | Today only the owner's PC has a working enemy. The steps:<br>• adopt `be3f9fb`, which commits the checkpoint<br>• keep attacks running when the brain is offline (turret mode)<br>• make the offline instructions visible<br>• pin the port and accept any loopback origin<br>• harden the single-threaded server<br>• pin the Python versions (3.12.3, SB3 2.9.0, torch 2.13.0, from `model_7757824/system_info.txt`)<br>• add a cross-platform `pnpm play`<br>This unblocks playtests, collaborators and CI of the real fight. | M | `core-loop-brain-gates-whole-encounter`, `engineering-brain-checkpoint-not-distributed`, `game-architecture-status-messages-hidden-in-options`, `engineering-brain-origin-allowlist`, `brain-ai-server-robustness`, `engineering-run-path-windows-only`, `engineering-python-deps-unpinned` |
| 5 | **Make shooting trustworthy** | These all hit the game's core verb and the branch's own goal:<br>• shots go backwards near walls or with the Leaper behind Lola<br>• held aim can't look up past 16.6°, so the "smart target" knees are out of reach up close<br>• the run-and-shoot pose is broken<br>• blocked shots fail silently | S-M | `aim-weapons-camera-trace-starts-at-lens`, `aim-weapons-ads-pitch-clamp-hides-knees`, `player-run-and-shoot-pose`, `aim-weapons-parallax-no-obstruction-feedback` |
| 6 | **Give leg damage rules:** a cap or downed state, severed legs stop blocking, no foot snapping | Shooting the knees is the intended tactic. About 60 bullets remove every leg and leave a hovering body that still fires, and invisible walls remain where the legs were. A cap is a one-day fix. A downed phase turns the bug into a boss mechanic. | S (cap) / M (downed state + contact v4) | `enemy-combat-six-legs-hover`, `enemy-combat-severed-leg-collision`, `hexapod-leg-loss-does-not-adapt` |
| 7 | **Add a GameFlow state machine and an Encounter object** | One source of truth for the game's state (Loading / Ready / Playing{hunt, explore} / Paused / Ended{victory, defeat}) gives:<br>• a real pause<br>• practice-mode labelling<br>• clean restarts (ammo, positions)<br>• a home for death and victory presentation<br>It also removes a whole class of soft-locks, and it is the first step toward multiple enemies. | M | `core-loop-no-game-state-machine`, `enemy-combat-restart-partial`, `enemy-combat-pause-not-pause`, `core-loop-playtest-god-object` |
| 8 | **Clear the licence and provenance blockers** | Both M416 sounds are CC BY-NC, several CC BY sounds require credit, and nothing records licences. This is cheap to fix now and expensive to discover at release. | S | `ui-audio-m416-noncommercial-license`, `engineering-source-art-off-repo` |
| 9 | **Merge with main the safe way, then start the small layer refactors** | The longer the branch lives, the worse the 7-file conflict gets. In order:<br>1. Namespace the frozen recipe (`rl/frozen_7757824/`), so main's live lab can't silently change the game brain.<br>2. Add a mode registry with the junkyard as `/`.<br>3. Split `TRAINING.md` into a game changelog and an RL ledger.<br>4. Then move PlayerController out of JunkyardBrain, move the camera and sun out of LeaperSimulation, and add `enemies[]`. | L | `engineering-mega-commit-and-branch-divergence`, `brain-ai-merge-two-brains`, `game-architecture-modes-instead-of-scenes`, `core-loop-playtest-god-object`, `hexapod-simulation-god-object` |
| 10 | **Run the brain in the browser** (ONNX + a JS port of the observation + parity fixtures) | This is the single biggest unblock: a web release, no Python, any number of Leapers, a step rate that no longer depends on latency, and a portable contract for any future engine. It has been shown to work: the 34-input LSTM actor exported to a 148 KB ONNX file and matched SB3 to within 4e-9 at 0.37 ms per step. The work is an exact JS port of JunkyardEnv, the raster and the eye-sight check, proven against golden fixtures, so the recipe stays frozen. | XL | `game-architecture-python-brain-blocks-web-release`, `hexapod-parity-constants-duplicated`, `brain-ai-recipe-provenance` |


---

## 5. What's broken and how to fix it

> **Nothing has been changed in the code yet.** This chapter is a set of instructions. Each item says what you see as a player or designer, why it happens (with file and line numbers in the reviewed commit `9b384c9`), how to fix it step by step, and how to check that the fix worked. You can hand any item to a developer as it is.

**Where to start.** Do 5.4 and 5.20 first, so that the tests pass and run automatically before anything else changes. Then do the ending (5.2 and 5.6), the Leaper's motion (5.3, 5.13, 5.14) and the shooting fixes (5.5, 5.22, 5.34, 5.35). Some items build on others: 5.17 reuses step 1 of 5.2, and 5.33 needs Lola's Blender sources in the repo first.

**The brain recipe.** Unless an item says otherwise, the fix only touches rendering, timing, UI or the browser side, and the brain's observation, action and per-step movement stay exactly as trained.

| # | Problem | Severity | Effort |
|---|---|---|---|
| 5.1 | Without the owner's local brain service the Leaper never moves or attacks | Critical at `9b384c9`; High from `be3f9fb` | S; XL for the in-browser brain |
| 5.2 | The end of the fight erases the kill shot and freezes the camera, Lola and the Leaper | High | S; M for a death collapse |
| 5.3 | The Leaper whips about 290° backwards after turning 1.5 circles | High | XS |
| 5.4 | The 4 failing Lola tests (1 real frame-rate bug, 3 out-of-date tests) | Medium | S |
| 5.5 | Lola fires backwards when backed against a wall or when the Leaper is behind her | High | S |
| 5.6 | After an ending, START PLAYER captures the mouse while nothing responds | Medium | XS |
| 5.7 | All six legs can be shot off and the legless body keeps hovering and fighting | High | S; M for a downed state |
| 5.8 | Running while shooting looks broken | High | S-M |
| 5.9 | On phones and tablets every control freezes after START, and there is no way to shoot | High | S; M for touch combat |
| 5.10 | The brain goes "offline" for reasons unrelated to the model | Medium | S |
| 5.11 | The brain-offline instructions are hidden, and START RUN can leave the mouse captured | Medium | XS-S |
| 5.12 | In long fights the brain drifts beyond its training and often stops hunting | High | S |
| 5.13 | The Leaper is slower than designed, and its speed depends on the monitor and CPU | Medium | XS |
| 5.14 | The Leaper's body surges 10 times a second and lurches when it loses legs | Medium | S |
| 5.15 | Lola sticks on angled walls and freezes mid-stride when blocked | High | M |
| 5.16 | "Paused" doesn't pause, and the click that resumes also fires a shot | Medium | S-M |
| 5.17 | Shadows vanish around Lola when she is away from the Leaper | Medium | S |
| 5.18 | Both M416 sounds have a NonCommercial licence, and no sound credits exist | High | S |
| 5.19 | Severed legs still block Lola, and every leg break snaps the other feet to the floor | Medium | S |
| 5.20 | The camera-player browser test page fails | Medium | S |
| 5.21 | The floating Leaper health bar swims off the robot while the camera turns | Medium | XS |
| 5.22 | Held aim can only look 16.6° up, so the upper knees can't be aimed at up close | Medium | S |
| 5.23 | RESTART ENCOUNTER is not a clean retry | Low | S |
| 5.24 | Players never see the controls, the help text is wrong, and a boss-kill cheat sits in the options | Medium | S |
| 5.25 | The double-tap HUD-move gesture hijacks the joystick and delays every button by 350 ms | Medium | S |
| 5.26 | HUD panels overlap on common screens, and the mobile layout rules are dead | Medium | S |
| 5.27 | Teammates can't start the game (default URL, Windows-only launcher, unpinned Python) | Medium | M |
| 5.28 | The Python brain tests only run on the owner's machine | Medium | S |
| 5.29 | The map tests check old Leaper sizes, and the tire passage is not in any .blend | Medium | S; M for the Blender fix |
| 5.30 | The clearance overlay and RESTART RANDOM mislead, freeze the page and fail at larger sizes | High | S; M for an exact overlay |
| 5.31 | The Leaper can shoot from beyond the range its brain can see | Medium | S |
| 5.32 | Diagonal movement skates and is slower than running straight | Medium | M |
| 5.33 | Lola's hit flinch tears her torso away from her arms and gun | High | M |
| 5.34 | The rifle fires slower on slower machines | Low | XS |
| 5.35 | The first frame after loading runs with a negative time step | Low | XS |
| 5.36 | Pressing jump just before landing is silently ignored | Low | XS |
| 5.37 | Firing cancels the hit flinch, and being hit drops the raised gun | Low | XS |
| 5.38 | The mouse wheel nudges the aim, and aim sensitivity isn't scaled for zoom | Low | XS-S |
| 5.39 | Optional sound slots fail silently, and an internal doc ships to players | Low | S |
| 5.40 | Hitches: shader recompiles on shots, texture uploads on first use, a 30 s brain freeze on size change | Medium | M |
| 5.41 | Accessibility: zoom disabled, tiny text, screen-reader chatter, Enter re-triggers the last button | Low | S |

### 5.1 Without the owner's local brain service the Leaper never moves or attacks

*Severity: critical at `9b384c9`, high from `be3f9fb` on (the checkpoint is now committed, but Python, PyTorch and a second program are still required) · Effort: S (steps 1-4); XL (the in-browser brain) · Findings: `core-loop-brain-gates-whole-encounter`, `engineering-brain-checkpoint-not-distributed`, `game-architecture-python-brain-blocks-web-release`*

**What you see.** On any machine except the owner's, `?map=junkyard` shows "BRAIN OFFLINE — START RUN TO RETRY". The Leaper stands still and never fires, and you can shoot it down to an ordinary "LEAPER DEFEATED". Even with the checkpoint, a second terminal running Python 3.12, PyTorch and sb3-contrib is needed.

**Why it happens.**
- Only the Python HTTP server moves the Leaper. `src/simulation/JunkyardBrain.js:55` hard-codes ``fetch(`http://127.0.0.1:8767/${path}`)``, and there is deliberately no fallback controller (comment at line 17).
- Attacks pause whenever the brain isn't ready: `const paused = !p.walking || !p.brain.ready || document.hidden;` (`src/simulation/LeaperCombat.js:200`). `JunkyardBrain.fail()` also clears `playtest.walking` (`JunkyardBrain.js:103-112`).
- At `9b384c9` the checkpoint is gitignored (`.gitignore:16`, `/model_7757824/`). The newer remote tip `be3f9fb` fixes that part.
- `load_brain` still insists on `policy.optimizer.pth` (`rl/junkyard_server.py:28`), which only training needs. It is about 600 KB, two-thirds of the checkpoint commit.

**How to fix.**
1. Base new work on `be3f9fb`, so `model_7757824/` is in the repo. Optionally drop `'policy.optimizer.pth'` from the file tuple at `rl/junkyard_server.py:28`, and keep the SHA256 check.
2. Separate "the encounter is running" from "the brain is ready":
   - In `LeaperCombat.update`, use `const paused = !p.walking || document.hidden;`.
   - In `JunkyardBrain.fail()`, if the player pressed START RUN, keep `playtest.walking = true`, set `this.offline = true`, and set the label to `BRAIN OFFLINE · TURRET MODE`.
   - The Leaper stays planted (`updateExternal` keeps its last pose), and `AttackController` fires as normal.
3. Optional: add a `?brain=pathfinder` controller built on `JunkyardNavigation.route`. Label it `SCRIPTED FALLBACK — NOT THE TRAINED BRAIN` so brain evaluations stay honest.
4. Make the brain address configurable: `import.meta.env.VITE_BRAIN_URL ?? 'http://127.0.0.1:8767'`.
5. Long term (XL): run the brain in the browser with ONNX, proven by parity fixtures (top priority 10). The recipe stays unchanged.

**How to check it's fixed.**
- With no server, press START RUN. The badge reads TURRET MODE, and the Leaper's eye charges and fires within a few seconds of Lola coming into view. Update the browser-combat checks for this mode.
- With the server running, the badge reads `BRAIN 7,757,824 · SEARCHING` and the Leaper moves.
- On a fresh clone of `be3f9fb`, `python scripts/run_junkyard_brain.py` starts without any hand-copied files.

### 5.2 The end of the fight erases the kill shot and freezes the camera, Lola and the Leaper

*Severity: high · Effort: S (steps 1-4, about 1 day); M (death collapse) · Findings: `core-loop-encounter-end-erases-feedback`, `game-architecture-presentation-driven-by-leaper-sim`, `enemy-combat-end-state-freeze`*

**What you see.**
- The winning shot plays its sound but shows no tracer, no sparks and no screen shake.
- The camera stops dead. If you were holding aim, it stays inside Lola's head (zoomed in, with her head mesh across the view) until RESTART, and the TOP view is broken.
- Lola freezes mid-stride even after a win, and the Leaper freezes mid-step with its feet in the air.
- The kill-shot shake replays at the start of the next encounter.

**Why it happens.**
1. **Camera and sun.** In junkyard mode, the only per-frame camera update is inside `LeaperSimulation.updateExternal` (`src/simulation/LeaperSimulation.js:112-114`). `JunkyardBrain.update` stops calling it once the fight ends: `if (this.frame && !encounterOver)` (`JunkyardBrain.js:168`).
2. **Effects.** All of this happens in one call, before the frame is drawn:
   - `PlayerWeapon.fire` creates the tracer and sparks (`PlayerWeapon.js:205`, `213`) and then calls `combat.damageLeaper` (218).
   - That runs `LeaperCombat.finish` (`LeaperCombat.js:119-126`).
   - `finish` calls `JunkyardPlaytest.stop` (`JunkyardPlaytest.js:196`, `this.playerWeapon?.reset()`).
   - `PlayerWeapon.reset` calls `clearEffects` (`PlayerWeapon.js:257`).

   After that, `update()` calls `reset()` every frame while the gun is unavailable (line 285).
3. **Lola.** `finish()` sets `target.defeated = true` for both outcomes (`LeaperCombat.js:122`), and `LolaPlayer.move` returns before any animation update (`if (this.defeated) return;`, `LolaPlayer.js:510`).

**How to fix.**
1. **Camera and sun.**
   - In `LeaperSimulation`, add a field `this.drivesPresentation = true`, and wrap the camera, sun and status lines (87-90 and 112-118) in `if (this.drivesPresentation)`.
   - In the `JunkyardPlaytest` constructor, set `simulation.drivesPresentation = false`.
   - In `JunkyardPlaytest.update`, directly after `this.brain.update(dt)`, call `this.cameraController.update(this.simulation.state, this.simulation.rig.eyePivot, dt);` every frame, then the sun follow (see 5.17).
   - The sandbox and `?training` keep their old behaviour.
2. **Effects.**
   - Split `PlayerWeapon.reset()` into two parts: `cancelActions()` (`triggerHeld = false`, `setAiming(false)`, `cancelReload()`, `target.cancelShot()`, `remaining = 0`, reticle flags) and `clearEffects()`.
   - `JunkyardPlaytest.stop()` calls only `cancelActions()`. `JunkyardPlaytest.reset()` calls the full `this.playerWeapon.reset()` explicitly.
   - In `PlayerWeapon.update`, replace line 285 with:
     ```js
     if (!this.available) {
       if (this.wasAvailable) this.cancelActions();
       this.wasAvailable = false;
       this.visuals.update(dt);
       return;
     }
     this.wasAvailable = true;
     ```
3. **Lola.**
   - In `LeaperCombat.finish`, write `this.playtest.target.defeated = this.lolaHealth <= 0;`, so that after a win she is still free to walk up to the wreck.
   - In `LolaPlayer.move`, replace the early return with `if (this.defeated) { forwardAmount = 0; sideAmount = 0; }`, so the mixer keeps running and she settles to Idle.
   - The jump and shot guards already refuse while she is defeated.
4. **Leaper.** In `JunkyardBrain.update`, when `encounterOver`, still call:
   ```js
   sim.updateExternal({ ...this.frame, x: sim.state.position.x, z: sim.state.position.z, yaw: sim.state.yaw }, dt,
                      { checkpoint: { step: this.frame.model_step } });
   ```
   so that swinging feet finish landing.
5. **Later (M): a "Dying" collapse.** Ease the body height toward about 0.35 × `STANDING_HEIGHT` over 0.8 s, and splay the feet to about 1.25 × `HOME_RADIUS`.

**How to check it's fixed.**
- Add a Node test, harness-style like `tests/browser-combat.js`: after a lethal `fire()`, `playerWeapon.visuals.items.length > 0`, and after `update(0.3)` it is 0.
- Add to `tests/camera-input.test.js`: aim, call `combat.finish()`, run 30 frames, then expect the camera at boom distance and a field of view of 55.
- In the game, use DEBUG damage to bring the Leaper close to 0, hold right-click and land the kill. You see the tracer, sparks and shake, the view returns to the chase camera, Lola can walk after a win, and the TOP view works.

### 5.3 The Leaper suddenly whips about 290 degrees backwards after turning 1.5 circles

*Severity: high · Effort: XS · Findings: `hexapod-yaw-wrap-whip`*

**What you see.** Once the brain has turned about one and a half full circles in one direction since the last reset (while scanning, or circling Lola), the robot spins most of the way round in a few frames. It happens again after every further turn, and all the legs re-step at once.

**Why it happens.**
- The rendered heading (*yaw*) is never wrapped back into one turn. `LeaperSimulation.updateExternal` stores `state.yaw = frame.yaw;` (`src/simulation/LeaperSimulation.js:107`), and `JunkyardBrain` passes `yaw: yaw + turn * tYaw` (`JunkyardBrain.js:179`), so the number grows without limit. The server meanwhile wraps its own yaw to ±π (`rl/checkpoint_environment.py:852-854`).
- The shortest-turn formula `const turn = ((now.yaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;` (`JunkyardBrain.js:176`) breaks once `now.yaw - yaw < -3π`, because JavaScript's `%` keeps the sign of a negative number.
- Measured: a 0.838 rad turn in one frame where 0.026 was expected, 14 whips per minute.

**How to fix.**
1. At `JunkyardBrain.js:176`: `const turn = Math.atan2(Math.sin(now.yaw - yaw), Math.cos(now.yaw - yaw));`
2. At `LeaperSimulation.js:107`: `state.yaw = Math.atan2(Math.sin(frame.yaw), Math.cos(frame.yaw));`
3. Add `src/core/angles.js` exporting `shortestAngle(from, to)`, and use it in `TrainingVisualizer.interpolateAngle` and any `turnToward`.

This is a rendering-only change; the frozen recipe is untouched.

**How to check it's fixed.**
- New Node test: run the follow code at 60 fps for 60 s while the server yaw advances +9° every 0.1 s (wrapped to ±π). Assert that every per-frame change in the rendered yaw is below 0.05 rad.
- In the game, let the Leaper scan or circle for a minute. There are no sudden spins.

### 5.4 The 4 failing Lola tests (1 real frame-rate bug, 3 out-of-date tests)

*Severity: medium · Effort: S · Findings: `player-failing-tests-root-cause`*

**What you see.** `node --test tests/*.test.js` reports 65/69. The four failures in `tests/lola-player.test.js` are:
- #53, floor offset (line 83)
- #54, crossover rate (line 113)
- #56, 30 vs 60 fps clock (line 173)
- #57, Idle after a weapon switch (line 199)

The same tests passed 35/35 at `d0dc868`. A permanently red suite hides new regressions.

**Why it happens.** Commit `9b384c9` added input easing and foot lift.
- **Real bug:** `LolaPlayer.move` eases the input once per rendered frame (`src/robot/LolaPlayer.js:513-521`) and only then splits the frame into 1/120 s sub-steps (522-525). So 30 fps and 60 fps follow different speed curves (test #56).
- **Stale test #53:** the floor check ignores the new foot lift that `moveStep` subtracts (`LolaPlayer.js:604-609`).
- **Stale test #54:** it expects StrafeRight with timeScale 2 after one frame, but the input now ramps up.
- **Stale test #57:** it expects Idle after a single zero-input frame.

**How to fix.**
1. In `LolaPlayer.move`:
   ```js
   const steps = Math.max(1, Math.ceil(deltaTime * 120));
   const ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime / steps);
   for (let i = 0; i < steps; i++) {
     this.inputForward += (forwardAmount - this.inputForward) * ease;
     this.inputSide += (sideAmount - this.inputSide) * ease;
     // existing snap-to-zero (below 0.02) when keys are released
     this.moveStep(this.inputForward, this.inputSide, forward, right, speed, deltaTime / steps);
   }
   ```
2. Stride test: set `player.inputForward = f; player.inputSide = s;` before the loop. Expect `profile.groundOffset * ENCOUNTER.lolaHeight - footLift(o.footContacts[clip], timeBefore)`, importing `footLift` from `src/robot/footstepContacts.js`.
3. Crossover test: call `move` 30 times per input. Expect `LOLA_PACE.run * THREE.MathUtils.clamp(pr.distance / pr.duration / o.footContacts.StrafeRight.stanceSpeed, 0.5, 1.5)`.
4. WASD test: run 3 zero-input frames before expecting `'Idle'` or `'CrouchIdle'`.
5. Add `"test": "node --test tests/*.test.js"` to `package.json`, and treat any red test as blocking.

A patch with exactly these changes is attached as `attachments/lola-test-fix.patch` (next to this report). It was re-checked on a fresh copy of `be3f9fb`: `git apply` succeeds and `node --test tests/*.test.js` reports 69/69. It has **not** been applied to the branch.

**How to check it's fixed.** `node --test tests/*.test.js` shows 69/69 passing, and `pnpm test` runs the same thing.

### 5.5 Lola fires backwards when backed against a wall or when the Leaper is behind her

*Severity: high · Effort: S · Findings: `aim-weapons-camera-trace-starts-at-lens`*

**What you see.** With her back to a crate, or with a Leaper leg between the camera and Lola (common, because it chases her), clicking sends the tracer backwards into the wall or the Leaper behind her. Entering aim can spin the view nearly 180°.

**Why it happens.** The sight ray starts at the camera lens: `cameraRay.setFromCamera(new THREE.Vector2(), p.engine.camera)`. This is in `PlayerWeapon.fire` (`src/simulation/PlayerWeapon.js:195-200`) and in `crosshairPoint` (159-163), and `CombatGeometry.hit` forces `raycaster.near = 0`. The camera stays at least 0.8 × Lola's height behind her and only fades walls that come closer (`src/camera/CameraOcclusion.js:57`). So anything between the camera and Lola becomes the aim point, and the muzzle ray `aim.sub(origin)` (201-202) then points backwards.

**How to fix.**
1. When not aiming, work out how deep Lola sits along the camera ray:
   ```js
   const anchor = p.cameraController.chaseAnchor(new THREE.Vector3());
   const near = cameraRay.ray.origin.distanceTo(cameraRay.ray.closestPointToPoint(anchor, new THREE.Vector3()));
   ```
   Use `near = 0` when aiming.
2. Add a `near` argument to `bulletHit`, to `CombatGeometry.hit` (`raycaster.near = near`) and to the enemy `Raycaster`. Use it for the sight ray in both `fire()` and `crosshairPoint()`.
3. Guard: if `aim.clone().sub(origin).dot(cameraForward) <= 0`, fire along `cameraForward` instead.

No brain impact.

**How to check it's fixed.**
- Add a `tests/browser-combat.js` check that puts Lola's back against a real junkyard wall and fires. Assert `tracerDirection · cameraForward > 0`.
- Add a second check with a Leaper leg between the camera and Lola.

### 5.6 After an ending, START PLAYER captures the mouse while nothing responds

*Severity: medium · Effort: XS · Findings: `core-loop-no-game-state-machine`*

**What you see.** After winning or losing, pressing START PLAYER grabs the mouse, but Lola can't move, the gun doesn't work and the camera is frozen. Only Escape gets you out. Pressing START RUN after an ending silently does nothing.

**Why it happens.** `start()` has `if (this.combat?.dead) return;` (`src/simulation/JunkyardPlaytest.js:155`), but `startPlayer()` (167-174) has no such guard. It calls `captureMouse` while `LolaPlayer.move` returns early (`LolaPlayer.js:510`) and the weapon is unavailable (`!p.combat.dead`, `PlayerWeapon.js:150`).

**How to fix.**
1. At the top of `startPlayer()`, add `if (this.combat?.dead) { this.message.textContent = 'Encounter over — press RESTART ENCOUNTER.'; return; }`. Give `start()` the same message.
2. While `combat.dead`, set `disabled = true` on the START RUN and START PLAYER buttons, and re-enable them in `reset()`.
3. The proper long-term fix is the GameFlow state machine (top priority 7).

**How to check it's fixed.** End the encounter, then press START PLAYER: the mouse is not captured and the message is visible. Press RESTART ENCOUNTER, and both start buttons work again.

### 5.7 All six legs can be shot off and the legless body keeps hovering and fighting

*Severity: high · Effort: S (cap); M (downed state) · Findings: `enemy-combat-six-legs-hover`*

**What you see.** About 60 rifle bullets aimed at the knees (20% of the Leaper's health) remove every leg. The body floats 2.2 units up with curled stumps above it, still walking at quarter speed and still firing.

**Why it happens.** `LeaperLegDamage.detach` (`src/simulation/LeaperLegDamage.js:115-122`) has no limit. Mobility only bottoms out at 0.25 (`Math.max(0.25, 1 - count * 0.18)`, line 122). `updateBody` sags the body only 0.04 per lost leg, with a cap (`src/simulation/LeaperSimulation.js:223-224`). `AttackController` never reads the leg state.

**How to fix.**
1. Add `legs: { maxLost: 4, mobilityPerLeg: 0.18, minMobility: 0.25 }` to `src/config/combat.js`, and read it in `LeaperLegDamage`.
2. Quick version: in `LeaperLegDamage.hit`, keep counting damage, but don't break a joint once `this.rig.damagedLegCount >= COMBAT.legs.maxLost`.
3. Better version (M): crossing the cap starts a "downed" state:
   - ease the body to floor height in `updateBody`;
   - set mobility to 0, so the existing clock stops brain steps;
   - keep the eye firing, as a vulnerable phase.

Only rendering and the step clock are touched, so the brain recipe is unaffected.

**How to check it's fixed.**
- New test in `tests/leaper-leg-damage.test.js`: 200 hits on every joint leaves `damagedLegCount <= 4`.
- In the game, shoot every knee with the M416. The body never floats with zero legs.

### 5.8 Running while shooting looks broken (hands off the gun, legs flicker, legs snap)

*Severity: high · Effort: S-M · Findings: `player-run-and-shoot-pose`*

**What you see.** While running and firing from the hip in third person:
- The pistol floats about a forearm's length (30-39 cm) away from both hands, and the rifle's support hand floats off the foregrip.
- The legs twitch 7 times a second during automatic fire.
- The legs jump when she starts or stops after a shot.

**Why it happens.**
- `startShot` zeroes every locomotion weight and calls `outfit.mixer.update(0)` (`src/robot/LolaPlayer.js:350-353`). That produces a one-frame full-body shooting pose on every shot.
- `moveStep` swaps instantly between the full-body and upper-body shot (641-654).
- The upper-body shot plays at weight 1 against roughly 1 of locomotion. The mixer normalises per bone, so the arms only get about 50% of the shot pose (`mixer.update` at 679).
- The reload already compensates with `1000 * locomotion` (676-677); the shot does not.

**How to fix.**
1. Before `outfit.mixer.update(deltaTime)` (line 679), when `shot?.upperOnly`, set `shot.action.setEffectiveWeight(1000 * locomotionSum)`, using the same reduce as the reload. Better still, route the shot and the reload through one shared upper-layer helper.
2. Store `this.lastMoved = moved` in `moveStep`. In `startShot`, when `this.lastMoved > 1e-7`, start `outfit.shootingUpper[name]` directly and skip the zero-weights / `mixer.update(0)` block.
3. Replace the instant swap with an eased `shot.legWeight`:
   - move it toward `moving ? 0 : 1` at about 12 per second;
   - play both shot variants in sync;
   - scale locomotion by `(1 - legWeight)`.
4. If the arms poke through the torso, reuse `attachReloadArms` for the shot. The real cure is the skeleton fix (5.33).

**How to check it's fixed.** Add these Node tests to `tests/lola-player.test.js`:
- While running with aim held, both hand bones are within 10 cm of the gun grip.
- During 2 s of automatic fire (`move()` then `startShot()` every 1/7 s), no frame-to-frame foot jump exceeds 10 cm.

### 5.9 On phones and tablets every on-screen control freezes after START, and there is no way to shoot

*Severity: high · Effort: S (unlock); M (touch combat layout) · Findings: `ui-audio-touch-softlock-after-start`*

**What you see.** After you tap START RUN or START PLAYER on a touch device, the joystick and the SPRINT, JUMP, STOP, VIEW and weapon buttons stop responding. Phones have no Escape key, so the only way out is to leave the tab. Touch also has no hold-to-fire, aim, reload or weapon switch. (This was reproduced with Pixel 7 emulation in Chromium.)

**Why it happens.**
- START calls `captureMouse` (`src/simulation/JunkyardPlaytest.js:159/171`). On touch, pointer lock fails, and `enableFallbackLook` adds the class `body.mouse-look` (`src/camera/CameraController.js:125-146`).
- `src/styles/junkyard.css:3` then applies `body.mouse-look .movable-hud, body.mouse-look .movable-hud * { pointer-events: none !important; }`. The joystick and the buttons are `.movable-hud` elements (`src/controls/MovableHud.js:16-17`).
- The touch UI only has the joystick, SPRINT and JUMP (`index.html:81-84`).

**How to fix.**
1. In `CameraController.captureMouse`, return early without pointer lock or fallback when `matchMedia('(pointer: coarse)').matches`, or when the triggering event's `pointerType` isn't `'mouse'`.
2. Limit the CSS rule to the toolbar: `body.mouse-look #junkyardPanel, body.mouse-look #junkyardPanel * { pointer-events: none !important; }`.
3. Add `src/ui/TouchControls.js` with these buttons:
   - FIRE (hold; sets `PlayerWeapon.triggerHeld`)
   - AIM (`PlayerWeapon.setAiming`)
   - RELOAD
   - 1/2 (`LolaPlayer.switchWeapon`)
   - CROUCH
   - PAUSE

   Place them in a reserved bottom band, and move Lola's health to the top.
4. Also unlock audio on `touchend` and `pointerup`.

**How to check it's fixed.** Run Playwright with `hasTouch: true, isMobile: true` (Pixel 7 profile). Tap START RUN, then confirm that JUMP makes Lola jump, the joystick moves her, STOP works and FIRE shoots.

### 5.10 The brain goes "offline" for reasons that have nothing to do with the model

*Severity: medium · Effort: S · Findings: `engineering-brain-origin-allowlist`, `brain-ai-server-robustness`*

**What you see.** "BRAIN OFFLINE" or "Failed to fetch" appears when:
- Vite starts on a different port because another dev server is already open;
- the browser leaves an idle connection open;
- the game is open in two tabs ("Session expired");
- a malformed request arrives, and the server drops the connection without a reply.

**Why it happens.**
- The origin allow-list only accepts ports 4173/4175/5173/5175 (`rl/junkyard_server.py:98`, checked at 148). There is no `vite.config.js`, so Vite falls back to 5174. The 403 reply carries no CORS header, so the browser only reports "Failed to fetch".
- `HTTPServer(...).serve_forever()` (line 195) runs on one thread, so one idle socket stalls `/step` until the 3 s client timeout (`JunkyardBrain.js:57`).
- A JSON body that isn't an object raises `AttributeError` on `data.get`. The handler's `except (ValueError, TypeError, KeyError)` (line 191) doesn't catch that.
- Sessions are evicted first-in-first-out once there are 8 (172-173), so a second tab kills the first tab's session.

**How to fix.**
1. Add `vite.config.js`: `export default { server: { port: 5173, strictPort: true }, preview: { port: 4173, strictPort: true } }`. Merge it with main's `vite.config.js` later.
2. In `junkyard_server.py`, accept any origin matching `re.fullmatch(r'http://(127\.0\.0\.1|localhost):\d+', origin)`. That still allows only your own machine.
3. After `json.loads`, add `if not isinstance(data, dict): raise ValueError('Expected a JSON object')`. Add a final `except Exception as error: self.reply(500, {'error': str(error)})`.
4. Either switch to `ThreadingHTTPServer`, with a `threading.Lock()` around `model.predict` and one lock per `BrainSession`, or keep one thread and set `Handler.timeout = 2`.
5. Make the session cache least-recently-used (an `OrderedDict` with `move_to_end` on every step). Add a `/close` endpoint, and send it with `navigator.sendBeacon` on `pagehide`.

**How to check it's fixed.**
- Run `vite --port 5174`: the brain connects.
- Hold an idle `nc 127.0.0.1 8767` connection open, then press START RUN: steps keep arriving.
- `curl -d '[]' 127.0.0.1:8767/step` returns a JSON error instead of dropping the connection.
- After 9 resets from a second tab, the first tab still steps.

### 5.11 The brain-offline instructions are hidden and contradictory, and START RUN can leave the mouse captured

*Severity: medium · Effort: XS-S · Findings: `game-architecture-status-messages-hidden-in-options`, `ui-audio-start-run-offline-capture-race`*

**What you see.** With no brain, START RUN appears to do nothing. The explanation sits inside the collapsed OPTIONS panel. The visible badge says "START RUN TO RETRY", while the hidden text says "press Reset". Sometimes the mouse stays grabbed in a stopped game.

**Why it happens.**
- `<p data-message>` is rendered inside `#junkyardOptions`, which is hidden by default (`src/simulation/JunkyardPlaytest.js:29`, `46`, `58`).
- `fail()` writes the instructions there and sets a different visible label (`src/simulation/JunkyardBrain.js:109-111`).
- In `CameraController.captureMouse` (`src/camera/CameraController.js:132-134`), if the pointer-lock request succeeds after `releaseMouse()` has already run, the code only clears `capturePending`. It never undoes that late lock.

**How to fix.**
1. Move `<p data-message>` out of `#junkyardOptions`, to sit under `.brain-state` in the always-visible part of the panel. Clamp it to two lines with CSS.
2. In `JunkyardBrain.fail`, use one consistent label: `BRAIN OFFLINE — start the brain service (see README), then press START RUN`.
3. In `captureMouse`'s success callback:
   ```js
   () => {
     if (generation === this.captureGeneration) this.capturePending = false;
     else if (document.pointerLockElement === this.canvas) { this.releasingMouse = true; document.exitPointerLock(); }
   }
   ```

**How to check it's fixed.** With no server, click START RUN 10 times, reloading in between. `document.pointerLockElement` is null every time, and the instructions are readable without opening OPTIONS.

### 5.12 In long fights the Leaper's brain drifts beyond what it was trained on and often stops hunting

*Severity: high · Effort: S · Findings: `brain-ai-long-run-out-of-distribution`*

**What you see.** After the Leaper first reaches Lola, or after she hides once it has seen her, it often stops searching actively. After about 1,000 brain steps (around 100 s at 10 steps per second) it can circle, stall or twitch. It looks as if "the AI got dumb".

**Why it happens.**
- Training episodes always ended within 1,000 steps, at a catch, stuck or freeze condition (`rl/checkpoint_environment.py:45`, `934`).
- In the game the session never ends. `JunkyardEnv` never terminates (`rl/junkyard_env.py:111-117`), and the server keeps stepping the same LSTM memory (`rl/junkyard_server.py:64-66`).
- `target_ever_seen` and the last-seen memory never reset, and training never contained a target that kept moving after it was found.

**How to fix.**
1. Add a "soft episode restart" in `JunkyardBrain.update`. When a reply has `caught`, or shows no translation for 60 steps, or `step >= 900`, call `/reset` with the Leaper's current position and yaw, so it doesn't teleport. Coverage, the frontier, the memory and the LSTM state then restart as at the start of a training episode.
2. Show "steps since episode start" in the debug HUD.

The recipe is unchanged. The benefit is not proven (it could not be measured in the review), so treat this as an experiment.

**How to check it's fixed.** Log 10-minute playtests before and after the change. Compare how often the Leaper re-acquires Lola after the first catch, the share of time it stands still, and its behaviour beyond step 1,000.

### 5.13 The Leaper is slower than designed, and its speed depends on the monitor and CPU

*Severity: medium · Effort: XS · Findings: `core-loop-brain-cadence-frame-dependent`*

**What you see.** On a 60 Hz screen the Leaper takes about 8.5 steps per second instead of 10 (15% slower). The rate varies between monitors and drops to about 6 per second when the brain takes 150 ms to answer. So the difficulty differs from machine to machine. Separately, `README.md:108` says "each model step is 1/30 simulated second" but never says that the game asks for 10 steps per real second.

**Why it happens.** `this.clock = 0;` (`src/simulation/JunkyardBrain.js:142`) throws away the leftover time at every step. A new step also only starts after the previous reply has arrived (`!this.busy`, line 141).

**How to fix.**
1. In `JunkyardBrain.update`:
   - compute `const interval = preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND;`;
   - use `this.clock >= interval` in the condition;
   - replace line 142 with `this.clock = Math.min(this.clock - interval, interval);`.

   Keep `stop()` setting `clock = 0`.
2. Later, request step N+1 as soon as reply N arrives (a one-step buffer), to hide latency.
3. Move `LEAPER_STEPS_PER_SECOND` into `src/config/encounter.js`, with a comment: speed = 0.375 × rate units/s, turn = 9° × rate per second, and keep the rate at or below about 24 so the gait stays planted. Update `README.md:108` to state the real-time rate.

The per-step policy physics are unchanged.

**How to check it's fixed.** Pull the step gate into a small pure helper function. Add a Node test with instant replies at dt = 1/20, 1/30, 1/60 and 1/144 that expects 10 ± 0.1 steps per simulated second.

### 5.14 The Leaper's body surges 10 times a second and lurches stop-go when it loses legs

*Severity: medium · Effort: S · Findings: `hexapod-10hz-surge`*

**What you see.** The big robot pulses forward in small jerks instead of walking with weight. When crippled it moves like a stuttering video rather than a deliberate limp, and network hiccups add extra stalls.

**Why it happens.** `JunkyardBrain.update` chases each 10 Hz server pose exponentially: `tPos = 1 - Math.exp(-LEAPER_FOLLOW_RESPONSE * dt)` with a rate of 18 per second (`src/simulation/JunkyardBrain.js:170-179`). Measured:
- the body's speed swings between 1.10 and 6.65 units/s within each step;
- body pitch oscillates by about 2° at 10 Hz;
- at mobility 0.25, 56% of frames are nearly stopped.

**How to fix.**
1. Use snapshot interpolation with a fixed one-step delay. Keep `previousFrame`, `frame` and the time the latest reply arrived.
2. Each frame, render `lerp(previousFrame, frame, clamp(sinceReply / stepInterval, 0, 1))`, with `stepInterval = 1 / (LEAPER_STEPS_PER_SECOND * mobility)`, and use a shortest-angle lerp for yaw (see 5.3).
3. Keep a short exponential correction only for replies that arrive late.

Main's `BrainDriver` already does this kind of phase interpolation. This is a rendering-only change.

**How to check it's fixed.**
- Headless probe: the variation in rendered body speed drops sharply, and at mobility 0.25 the share of stalled frames is close to the full-health value.
- In the game, a Leaper with 4 legs down limps evenly.

### 5.15 Lola sticks on angled walls and freezes mid-stride when blocked

*Severity: high · Effort: M · Findings: `player-collision-slide`*

**What you see.** Running into an angled car or crate stops Lola dead instead of letting her slide along it, even at a 30° glancing angle. Pushing against any wall leaves her frozen in a mid-step pose.

**Why it happens.**
- Movement tests the x and z directions separately (`src/robot/LolaPlayer.js:621-627`). When both parts of the move point into an angled wall, both are refused. The measured slide is 0.00 for walls at 15° and 30°.
- Clip speed is multiplied by how far she actually moved (`action.timeScale *= progress`, line 639), which freezes the pose when she is blocked.

**How to fix.**
1. Add `JunkyardNavigation.contact(x, z, r)`, which returns the nearest blocking point and its normal (the direction pointing out of the wall), taken from the closest edge in `triangleDistanceSquared`.
2. In `moveStep`, try the full move first. If it is blocked, remove the part of the move that points into the wall along that normal, and retry 2-3 times. This standard technique is called *collide-and-slide*.
3. When `progress < 1`, blend the locomotion weights toward Idle (target weight = progress) instead of freezing the clip time.

Do **not** change `src/config/player-contact.json`; the brain server mirrors it.

**How to check it's fixed.**
- Node test with a 30° wall segment: running into it at 45° slides at least 80% of the ideal distance.
- Pushing straight into a wall gives an Idle weight above 0.5 after 0.3 s.

### 5.16 "Paused" doesn't pause, and the click that resumes also fires a shot

*Severity: medium · Effort: S-M · Findings: `core-loop-no-game-state-machine`*

**What you see.**
- Escape shows "Paused", but only the Leaper freezes. Lola can still walk and shoot the motionless Leaper, and those kills count as a normal "LEAPER DEFEATED". (Moving and shooting while the run is *stopped* is deliberate sandbox behaviour; the problem is that Escape calls it a pause.)
- Clicking back into the game after Alt-Tab fires a bullet.
- Kill-time measurements from playtests that include stopped periods are meaningless.

**Why it happens.**
- `PlayerWeapon.available` only checks death, the POV view, the camera mode and tab visibility (`src/simulation/PlayerWeapon.js:148-152`). `damageLeaper` has no pause check (`LeaperCombat.js:97`).
- The Escape handler just calls `stop()` (`JunkyardPlaytest.js:71-74`).
- `JunkyardBrain.update` always moves Lola (`JunkyardBrain.js:135`).
- The mousedown fire listener (`PlayerWeapon.js:75`) doesn't ignore the click that recaptures the mouse.

**How to fix.**
1. Add `src/game/GameState.js` with the states `'menu' | 'playing' | 'exploring' | 'paused' | 'ended'`. `start()`, `startPlayer()`, `stop()`, `stopPlayer()`, `finish()` and the Escape handler set it.
2. `PlayerWeapon.available` requires the state `'playing'` or `'exploring'`.
3. `JunkyardBrain.update` skips `target.move` while the state is `'paused'`.
4. In the mousedown handler, ignore the event that triggers `captureMouse` (the pointer is not locked yet).
5. A kill while the run is stopped finishes as `PRACTICE · LEAPER DEFEATED`.
6. Show a `PAUSED: click to resume` overlay.
7. Update the two browser-combat checks that expect free shooting.

**How to check it's fixed.**
- After Escape, Lola can't move or shoot.
- Clicking to resume doesn't change the ammo count.
- A kill during START PLAYER shows the PRACTICE label.

### 5.17 Shadows vanish around Lola when she is away from the Leaper

*Severity: medium · Effort: S · Findings: `hexapod-shadow-follows-leaper`*

**What you see.** When Lola explores or kites more than about 13 units from the Leaper, she and the cover around her lose their ground shadows. The shadows pop back as the Leaper approaches.

**Why it happens.**
- The sun and its target are re-centred on the Leaper every frame (`src/simulation/LeaperSimulation.js:88-89`, `113-114`).
- The shadow camera is a fixed ±13-unit box with `far = 48` (`src/core/createScene.js:31-36`), while the scaled junkyard is about ±35 × ±33 units.
- `JunkyardPlaytest` scales the fog and the camera's far plane, but not the shadow camera (`JunkyardPlaytest.js:115-121`).

**How to fix.**
1. With the `drivesPresentation` change from 5.2, `LeaperSimulation` stops moving the sun in junkyard mode.
2. In `JunkyardPlaytest.update`, after the camera update, with `s = world.scale`, set `sun.target.position.set(lola.x, 0, lola.z); sun.position.set(lola.x + 8 * s, 15 * s, lola.z + 6 * s)`. Snap the centre to the shadow-texel grid so shadow edges don't shimmer.
3. In the constructor:
   ```js
   sun.shadow.camera.left = sun.shadow.camera.bottom = -13 * s;
   sun.shadow.camera.right = sun.shadow.camera.top = 13 * s;
   sun.shadow.camera.far = 80 * s;
   sun.shadow.camera.updateProjectionMatrix();
   ```

**How to check it's fixed.** Take a Playwright screenshot with Lola 22 units from the Leaper. Her ground shadow and the shadows of the barrels beside her are visible.

### 5.18 Both M416 sounds have a NonCommercial licence, and no sound credits exist

*Severity: high · Effort: S · Findings: `ui-audio-m416-noncommercial-license`*

**What you see.** With the current rifle sounds, the game can't be sold, monetised, or put on an ad-supported page. CC BY sounds (for example `leaper-walk`) require a visible credit and get none. Nobody can tell which other assets carry conditions.

**Why it happens.**
- `assets/audio/sources.json:20-25` and `:32-37` take `m416-shot` and `m416-reload` from Freesound 766092, licensed "Attribution NonCommercial 4.0". Both are loaded at `src/simulation/LaserAudio.js:4` and `:9`, and both ship in `dist`.
- No licence, author or attribution field exists anywhere, and there is no LICENSE or CREDITS file.

**How to fix.**
1. Replace both M416 clips with CC0 or self-recorded sounds, or get written permission from the author.
2. Add `author`, `url`, `license` and `attribution` fields to every entry in `sources.json` and to the `public/audio` slots. The slots are currently only described in `SOUND-SLOTS.md` and `FOOTSTEPS.md`.
3. Add a Node test that fails on any NC licence or any missing licence.
4. Generate a CREDITS section in OPTIONS, and a `CREDITS.md`, from the manifest.
5. Add a LICENSE for the code, and record where Lola, her animations and `junkyard.glb` came from.
6. Decide the public-facing names ("ARC-CLASS", "Leaper") before release.

**How to check it's fixed.** The licence test passes, the credits are visible in the game, and `grep -r 766092 assets` returns nothing.

### 5.19 Severed legs still block Lola, and every leg break snaps the other feet to the floor

*Severity: medium · Effort: S · Findings: `enemy-combat-severed-leg-collision`, `hexapod-leg-loss-does-not-adapt`*

**What you see.** An invisible wall remains where a shot-off leg used to be, which undermines "walk in between its legs" once legs break. Each break also makes the other mid-step feet pop to the ground in a single frame.

**Why it happens.**
- `leaperDiscs()` always includes all six legs (`src/world/playerContact.js:10-17`), and so does the Python mirror `_player_clearance` (`rl/junkyard_env.py:60-71`). Clearance at a severed foot measures -1.45, meaning she is still blocked there.
- `LeaperLegDamage.detach` cancels every swinging foot: `if (other.stepping) other.footPosition.y = other.stepTo.y; other.stepping = false;` (`src/simulation/LeaperLegDamage.js:117-120`).

**How to fix.**
1. Send `disabled_legs: rig.legs.flatMap((l, i) => l.disabled ? [i] : [])` in the `/step` payload.
2. Skip those legs' outer discs in both `leaperDiscs`/`leaperClearance` and `_player_clearance`.
3. Bump `version` in `src/config/player-contact.json` from 3 to 4 (both sides read it; `JunkyardBrain.js:85` checks it), and restart the server.
4. **Brain note:** this changes only the Lola-contact rule added for the junkyard, not the trained map-collision discs. Re-run `tests/test_junkyard_brain.py` anyway.
5. Delete the swing-cancel loop, so swinging feet finish their step.

**How to check it's fixed.**
- `tests/player-contact.test.js`: clearance at a disabled leg's foot position is ≥ 0.
- In the game, Lola walks through the gap left by a severed leg, and the other feet don't pop when a leg breaks.

### 5.20 The camera-player browser test page fails (and two more checks are out of date)

*Severity: medium · Effort: S · Findings: `engineering-browser-tests-manual-rot`*

**What you see.** Opening `tests/camera-player.html` gives "FAIL · Camera and footsteps" at the 12th check. The 11 checks after it (footfall cadence, blocked footsteps, upper-body aiming while running) never run.

**Why it happens.**
- `tests/camera-player.js:26-27` expects mouse look without capturing the mouse. `CameraController.onPointerMove` now ignores an uncaptured mouse: `if (!locked && !this.fallbackMouseLook && event.pointerType === 'mouse' && this.mode === 'CHASE') return;` (`src/camera/CameraController.js:193`).
- `camera-player.js:81` expects no footfalls while airborne, but the authored jump deliberately emits push-off and touchdown steps (`src/robot/LolaPlayer.js:557-561`). The page captured `["walk"]`.
- `camera-player.js:89` asserts that root travel matches facing even during strafes, while Lola always faces the camera and strafes (`LolaPlayer.js:538-547`).

**How to fix.**
1. Before line 26, add `controller.gameplayStarted = true; controller.fallbackMouseLook = true;`. Calling `controller.enableFallbackLook()` instead was confirmed to make the check pass too.
2. Change line 81 to allow the authored jump steps: `kinds.length <= 2 && kinds.every(k => k === 'walk')`.
3. Rewrite the skid check at line 89 to compare travel against the input direction (forward × f + right × s), not facing. This assumes strafing without turning is intended. If you want Lola to face her travel direction instead, treat it as a movement bug.
4. Move `tests/camera-preview.html` to `demos/`, because it is a demo, not a test.
5. Add `tests/run-browser.mjs`, about 40 lines of Playwright:
   - start Vite through its JS API on port 5210 with `strictPort`;
   - launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`;
   - open `tests/browser-combat.html` and `tests/camera-player.html`, and wait up to 120 s for `document.title` to start with `PASS` or `FAIL`;
   - exit non-zero on FAIL, on a timeout or on any `pageerror`.

   Add `"test:browser": "node tests/run-browser.mjs"` to `package.json`.

**How to check it's fixed.** `pnpm test:browser` reports PASS for both `browser-combat.html` (155 checks) and `camera-player.html`.

### 5.21 The floating Leaper health bar swims off the robot while the camera turns

*Severity: medium · Effort: XS · Findings: `core-loop-implicit-update-order-stale-camera`*

**What you see.** While you fire from the hip and turn, the world-anchored health bar slides 30-170 pixels away from the Leaper, which is exactly when it is on screen.

**Why it happens.**
- The health bar is projected inside `combat.update` (the update order is in `src/simulation/JunkyardPlaytest.js:291-297`).
- The chase branch of `CameraController.update` never calls `camera.updateMatrixWorld()`, and the camera isn't part of the scene. So the projection uses last frame's camera position.
- Measured errors: -29, -77 and -172 px at 0.02, 0.05 and 0.1 rad of yaw per frame.

**How to fix.**
1. Call `this.camera.updateMatrixWorld()` at the end of `CameraController.update` and at the end of `LeaperPov.update`.
2. Move the `this.healthBar.update(...)` call out of `LeaperCombat.update` into `JunkyardPlaytest.update`, after `this.pov.update()`.

**How to check it's fixed.** A probe that compares stale and fresh projections shows an error under 1 px. In the game, the bar stays pinned above the Leaper during fast mouse look.

### 5.22 Held aim can only look 16.6 degrees up, so the upper knees can't be aimed at up close

*Severity: medium · Effort: S · Findings: `aim-weapons-ads-pitch-clamp-hides-knees`*

**What you see.** Within about 8 units of the Leaper, you can't put the aim crosshair on 4 of the 6 upper knees (the intended "smart target") or on the top of the body.

**Why it happens.** Held aim reuses the chase camera's pitch limits (the CHASE pitch constants at `src/camera/CameraController.js:8-9`, applied in `onPointerMove` at line 211).

**How to fix.**
1. Add `AIM_PITCH_UP` and `AIM_PITCH_DOWN` (about ±1.0 rad), and clamp against them in `onPointerMove` when `this.aiming`.
2. Make `aimChaseAt` ease back into the chase limits when you leave aim at a steep angle.
3. Optionally, allow a lower chase pitch, with the boom shortening as the pitch drops so the camera doesn't dig into the floor.

**How to check it's fixed.** Add a browser-combat check: at 5 units in aim, an upper knee can be put under the crosshair and hit.

### 5.23 RESTART ENCOUNTER is not a clean retry

*Severity: low · Effort: S · Findings: `enemy-combat-restart-partial`*

**What you see.** After a restart, the magazines stay half-empty and Lola stays where she died (possibly next to the spawn), while the Leaper teleports back. So consecutive playtests are not comparable.

**Why it happens.**
- Ammo is only set in the `PlayerWeapon` constructor (around `PlayerWeapon.js:51-54`) and is never refilled.
- `JunkyardPlaytest.reset` (`src/simulation/JunkyardPlaytest.js:203-222`) always moves the Leaper to its spawn, but moves Lola only when given a spawn pair or when she is too close.

**How to fix.**
1. When an encounter starts (START RUN or RESTART RANDOM), record `this.encounterStart = { lola: {x, z, yaw}, leaper: {x, z, yaw} }`, and restore both in the restart handler.
2. Add `PlayerWeapon.resetEncounter()`, which refills both magazines from `PLAYER_WEAPON.m416/pistol.magazine`, and call it from `reset()`.
3. Later, move both into the Encounter object (top priority 7).

**How to check it's fixed.** Fire half a magazine, die, and press RESTART ENCOUNTER. Both magazines are full and both characters are back at their start positions.

### 5.24 Players never see the controls, the help text is wrong, and a boss-kill cheat sits in the player options

*Severity: medium · Effort: S · Findings: `ui-audio-controls-legend-hidden`, `ui-audio-debug-tools-in-player-hud`, `engineering-docs-drift`*

**What you see.** The junkyard shows no controls legend. Where help text does exist, it says AIM ×1.25 (the code uses 1.35) and never mentions R to reload. The README says F switches guns and that shooting is not implemented. OPTIONS contains "DEBUG: DAMAGE LEAPER", which kills the boss in six clicks.

**Why it happens.**
- `.junkyard-mode .hud { display: none; }` (`src/styles/junkyard.css:68`) hides the `.keys` legend that `JunkyardPlaytest.js:75` writes, and that text is hard-coded.
- `AIM_ZOOM = 1.35` is defined at `src/camera/CameraController.js:19`.
- `README.md:87-88` is out of date.
- The debug button is added in the `LeaperCombat` constructor (`LeaperCombat.js:67-74`) with no debug check.

**How to fix.**
1. Add `src/config/controls.js` holding one list of `{keys, action}`, with the zoom text built from `AIM_ZOOM`.
2. Render that list in a new `src/ui/ControlsLegend.js`. Keep it visible until the first START, and toggle it with H.
3. Delete the `.keys` rewrite at `JunkyardPlaytest.js:75`.
4. Regenerate the README controls table from the same list (or copy it by hand once), and fix `README.md:84-102`.
5. Create the DEBUG button only when `new URLSearchParams(location.search).has('debug') || import.meta.env.DEV`.

**How to check it's fixed.** Open `?map=junkyard`: the legend is visible and lists R reload and ×1.35. Without `?debug`, the OPTIONS panel has no DEBUG button.

### 5.25 The double-tap HUD-move gesture hijacks the joystick and Jump and delays every button by 350 ms

*Severity: medium · Effort: S · Findings: `ui-audio-movablehud-hijacks-touch-and-delays-clicks`*

**What you see.** On touch, a quick tap-tap on the joystick or JUMP slides the control across the screen instead of moving Lola, and the bad position is saved. On desktop, the VIEW and weapon buttons feel sluggish. There is no way to reset the layout.

**Why it happens.**
- The movable selectors include `'#joyBase'`, `'#btnSprint'` and `'#btnJump'` (`src/controls/MovableHud.js:16-17`).
- A second press calls `stopImmediatePropagation`, so the game never sees it.
- Clicks on movable buttons are swallowed and replayed after `setTimeout(..., 350)` (`MovableHud.js:84-103`).
- `end()` leaves the gesture armed when nothing moved.
- There is no reset control.

**How to fix.**
1. Replace the always-on gesture with an "EDIT HUD LAYOUT" toggle in OPTIONS that adds the class `body.hud-editing`. Attach the drag listeners only in that mode (a single press drags), and show outlines.
2. Outside editing mode, attach nothing. Clicks then fire immediately, and the `pendingClick` replay can be deleted.
3. Add "RESET LAYOUT", which removes the `leaper.hud-layout.v2` storage key and clears the inline `left`/`top`.
4. Store separate layouts for touch and desktop (key suffixes `-touch` and `-desktop`).

**How to check it's fixed.**
- Extend `tests/movable-hud.test.js`: with editing off, a JUMP double-tap registers two jumps, and button clicks run immediately.
- With editing on, a panel can be dragged, and RESET restores the default positions.

### 5.26 HUD panels overlap on common screens, and the mobile layout rules are dead

*Severity: medium · Effort: S · Findings: `ui-audio-css-override-layers`*

**What you see.** At 1280×720 with OPTIONS open, the panel runs off the screen (y 96-723), and Lola's health panel covers buttons and steals their clicks. On phones, the intended mobile positions don't apply.

**Why it happens.**
- `#combatHud` is positioned three times (`src/styles/junkyard.css:46`, `:63-65`, `:130`).
- The mobile `#leaperHealthHud` rule at `:60` is overridden by `:63`.
- The mobile `#junkyardOptions` max-height (`:41`) is overridden by `:133`.
- 13 commits stacked new overrides instead of editing the original rules.

**How to fix.**
1. Rewrite `junkyard.css` with one rule per element, grouped by screen region. Put tokens on `:root` (`--hud-gap`, `--hud-safe-bottom`, and a z-index scale `--z-world-ui:10; --z-hud:20; --z-overlay:30; --z-dev:40`), and use `env(safe-area-inset-*)` for phone notches.
2. Give each corner a single owner: top-left Leaper, bottom-left Lola, bottom-right weapons, top-right view and dev toggle.
3. Make the options panel scroll: `max-height: calc(100vh - 140px); overflow: auto`.

**How to check it's fixed.** Add a Playwright check that fails when any HUD rectangles intersect, at 1280×720 and at 412×839, with OPTIONS both open and closed.

### 5.27 Teammates can't start the game: the default URL shows the old sandbox, the launcher is Windows-only, and the Python setup is unpinned

*Severity: medium · Effort: M · Findings: `game-architecture-modes-instead-of-scenes`, `engineering-run-path-windows-only`, `engineering-python-deps-unpinned`*

**What you see.**
- `pnpm dev` and the root URL open a pink-cuboid sandbox, not the game.
- `Start-Leaper.ps1` only works with a Windows `.venv\Scripts\python.exe`, and it hides brain crashes in `tmp/brain-error.log`.
- On a Mac or Linux machine, the README steps install whatever torch and SB3 versions are current, and those may fail to load the saved checkpoint.

**Why it happens.**
- `src/main.js:19-25` defaults to `createWorld` (the sandbox), and `README.md:17` points at `/`.
- `Start-Leaper.ps1:3-11` and `27-29` assume Windows paths and a codex runtime fallback.
- `scripts/run_junkyard_brain.py:7-9` and both Python tests inject `.venv/Lib/site-packages` into the import path.
- `requirements-rl.txt` has only version ranges and no torch line. The checkpoint was saved with Python 3.12.3, SB3 2.9.0, torch 2.13.0+cpu, numpy 2.5.3, gymnasium 1.3.0 and cloudpickle 3.1.2 (`model_7757824/system_info.txt` in `be3f9fb`).

**How to fix.**
1. Make the junkyard the default in `src/main.js`, and put the sandbox behind `?sandbox`. Later, give each mode its own Vite entry. Update `README.md:17` and `:72` and the `Start-Leaper.ps1` printout.
2. Add `requirements-brain.txt` with those exact versions, plus the owner's sb3-contrib version from `pip freeze`, and note Python 3.12 in the README. In `load_brain`, log the checkpoint's `_stable_baselines3_version` next to the installed one.
3. Delete the `sys.path` hacks, and run inside the activated virtual environment instead.
4. Add `scripts/play.mjs` as `pnpm play`. It:
   - starts `python -m rl.junkyard_server`, preferring `.venv/bin/python` or `.venv\Scripts\python.exe`;
   - waits until `GET /` reports `model_step` 7757824;
   - starts `vite --strictPort` and prints the URL;
   - forwards the server's error output, and exits loudly if the server dies.
5. Make `Start-Leaper.ps1` a thin wrapper around `pnpm play`.
6. Write one "Play the game" section at the top of `README.md`.

**How to check it's fixed.** On a clean Linux or Mac machine: clone, run `corepack enable && pnpm install`, create a virtual environment, run `pip install -r requirements-brain.txt`, then `pnpm play`. The game opens at `/` showing `BRAIN 7,757,824 · SEARCHING`.

### 5.28 The Python brain tests only run on the owner's machine

*Severity: medium · Effort: S · Findings: `engineering-python-tests-checkpoint-coupled`*

**What you see.** On any other machine both Python test files error out in `setUpClass`. Four tests that need no model at all are skipped along with them, including the anti-cheat guarantees (no peeking through walls, hidden positions never leak, Lola blocks the Leaper).

**Why it happens.**
- `setUpClass` loads the checkpoint for whole test classes (`tests/test_junkyard_brain.py:17-22`, `tests/test_eye_vision.py:46-51`).
- The `import torch` and `from rl.junkyard_server import ...` lines at the top of each file force the full ML stack to be installed.
- Both files insert a Windows `.venv/Lib/site-packages` path (`test_junkyard_brain.py:7`, `test_eye_vision.py:7`).
- The HTTP handler has no tests, and the "action parity" test only compares the server with itself.

**How to fix.**
1. Split each file into two groups:
   - env, geometry and sight test classes that need only numpy and gymnasium;
   - checkpoint classes decorated with `@unittest.skipUnless((ROOT / 'model_7757824/policy.pth').exists(), 'checkpoint not installed')`.

   Move the torch and server imports inside the checkpoint classes.
2. Delete the path inserts.
3. Refactor `junkyard_server.main()` into `make_handler(model, digest, root)`. Test it with a fake model whose `predict` returns fixed actions and whose `num_timesteps` is 7757824, covering the origin, size, width range, token and non-object-body cases.
4. Keep the SHA256 and real-policy assertions unchanged.

**How to check it's fixed.** In a virtual environment with only numpy and gymnasium, `python -m unittest discover tests` runs the env, sight and handler tests, and reports the model tests as skipped with the reason. With `be3f9fb`'s checkpoint plus torch, all tests run.

### 5.29 The map tests check old Leaper sizes, the "opened" tire passage is still blocked at the real size, and the tire move isn't in any .blend

*Severity: medium · Effort: S (tests); M (Blender source fix) · Findings: `world-assets-nav-tests-check-old-size`, `world-assets-map-source-of-truth-split`, `world-assets-arena-too-tight-for-default-leaper`*

**What you see.** The tests say the passage beside the bus is open and the map is navigable, but only for a Leaper half the size you actually play with (5.5). Re-exporting the junkyard from Blender quietly closes the passage again.

**Why it happens.**
- `tests/junkyard-navigation.test.js:11-37` uses widths 2.4 and 4 and the hard-coded numbers 3.82 and 7.98. The passage test uses 2.4 (line 35), the old default.
- `clearLine` from (4, -2.5) to (10, -2.5) is clear at widths 2.4 and 2.6, but blocked at 2.88, 4 and 5.5 (`ENCOUNTER.startWidth`, `src/config/encounter.js:6`).
- The tire move exists only as a post-export patch (`scripts/move_junkyard_tires.py`). `README.md:158-165` exports from a `C:/Blender` file that isn't in the repo.

**How to fix.**
1. In the test, import `ENCOUNTER.startWidth`, `BODY_COLLISION_RADIUS` and `STANDING_HEIGHT` instead of the literal numbers. At `startWidth`, assert that:
   - the spawn's connected region is at least X% of the free cells (choose X as a level-design target; it will fail today, which is the point);
   - `randomJunkyardStart` with a seeded random generator succeeds at least 18 times out of 20;
   - the passages listed in a new `assets/maps/junkyard/passages.json` are clear.
2. In Blender, open `junkyard_arranged.blend` and move `truck_tire_single.006/.007/.008` by +2.5 in Y. Save it as `assets/maps/junkyard/source/junkyard.blend` (through LFS), export from that relative path, and retire `move_junkyard_tires.py`.
3. As a design call, decide whether that passage should be open at width 5.5. If so, widen it in the `.blend`.

**How to check it's fixed.** The new tests run at 5.5. A clean re-export without the patch script keeps the tires moved, and an inventory diff shows no drift.

### 5.30 The clearance overlay and RESTART RANDOM mislead, freeze the page and fail at larger sizes

*Severity: high · Effort: S (regions, slider); M (server-exact overlay) · Findings: `world-assets-random-start-size-slider`, `world-assets-overlay-not-brain-collision`, `brain-ai-size-slider-ood`*

**What you see.**
- SHOW CLEARANCE often paints red where the brain's real legs fit. At 5.5 it shows about 12 times less reachable floor than there really is, and it can't show "passable only at some headings".
- RESTART RANDOM freezes the page for up to about 1 s. It fails 5 times in 20 at size 5.5, 17 in 20 at 6.5 and 20 in 20 at 8, yet the slider goes up to 8.
- Small sizes put the brain in a world 2-5 times larger than the one it trained in.

**Why it happens.**
- The overlay and the spawn picker use a single circle of radius width/2 (`src/world/createJunkyardWorld.js:28`, `src/world/randomJunkyardStart.js:12-14`), not the brain's 19 discs (`rl/checkpoint_environment.py:24-27`).
- `randomJunkyardStart` runs a full `nav.route` (a breadth-first search with `clearLine`) for up to 80 candidate pairs on the main thread (`randomJunkyardStart.js:8-24`, `JunkyardNavigation.js:96-131`).
- The slider maximum is hard-coded (`JunkyardPlaytest.js:42`).
- Lola's fallback spawn ignores reachability (`JunkyardPlaytest.js:213-219`).

**How to fix.**
1. At load, flood-fill `navigation.free` once into region labels (an `Int32Array`). `randomJunkyardStart` then picks start and target from the same region with no `route()` calls, and Lola's fallback spawn uses the same label. Reuse the labels to colour the overlay.
2. At load, compute the largest width that still has a usable region, and set the slider's maximum to it, or show a warning next to APPLY SIZE.
3. Return `WORLD_LIMIT` from `/reset`, and warn "brain outside trained arena size" when it exceeds about 1.3 × 31.25.
4. For an exact overlay, add `GET /clearance?width=` to `rl/junkyard_server.py`. It returns an "any heading" mask and an "every heading" mask, computed from `JunkyardGeometry.disk_blocked` and `_collision_points`; this only reads the recipe. Paint three colours (can turn here, passable at some heading, blocked), and use the "every heading" mask for spawns, which makes the +0.2 safety margin unnecessary.

**How to check it's fixed.** RESTART RANDOM takes under 50 ms and succeeds 20 times out of 20 at the default size. The slider's maximum equals the largest workable width. In a TOP-view playtest, the overlay matches where the brain actually drives.

### 5.31 The Leaper can shoot from beyond the range its brain can see (while the HUD says SEARCHING)

*Severity: medium · Effort: S · Findings: `core-loop-two-perception-authorities`*

**What you see.** The Leaper charges and fires while its status says SEARCHING. At the default size this only happens in a narrow band (29.4-31.9 units away). At width 3 it can fire from about twice the brain's sight range, and at width 1.2 from about five times.

**Why it happens.**
- Combat sight uses `const range = c.weaponRange * p.world.scale;` with `weaponRange` 22 (`src/simulation/LeaperCombat.js:202-207`, `src/config/combat.js:4`), measured from the rendered pose.
- The brain sees up to `RAY_MAX_RANGE` 28 + `TARGET_RADIUS` 1.4, unscaled (`rl/checkpoint_environment.py:38-39`).

**How to fix.**
1. Put the brain's sight range in the shared `src/config/eye-vision.json`, read-only for both sides.
2. In `LeaperCombat`, use `Math.min(c.weaponRange * p.world.scale, sightRange + targetRadius)`.
3. Optionally, require `p.brain.frame?.target_visible` (or `target_ever_seen`) before the first shot, so attacks follow the brain's awareness.

This only reads the server's output, so the recipe is unchanged.

**How to check it's fixed.** Add a Node test that loops over widths 1.2 to 8 and asserts that the weapon range never exceeds the brain's sight range. At width 3 in the game, the Leaper never fires while the HUD says SEARCHING.

### 5.32 Diagonal movement skates and is slower than running straight

*Severity: medium · Effort: M · Findings: `player-no-directional-blend`*

**What you see.** W+D (the natural way to circle the Leaper) plays the pure strafe clip with the feet sliding: 1.40 units/s of planted-toe slip, against 0.22 for W alone. It is also about 30% slower than W. One exported clip (Walk) is never used.

**Why it happens.** `LolaPlayer.moveStep` picks a single clip: `sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount)`, followed by a nested ternary over Idle, Run, StrafeLeft/Right and Crouch (`src/robot/LolaPlayer.js:545-547`).

**How to fix.**
1. Replace the single-clip choice with an 8-way blend:
   - `angle = atan2(side, forward)`;
   - Run weight ∝ |cos(angle)|, reversed when moving backwards;
   - StrafeLeft/Right weight ∝ |sin(angle)|;
   - normalise the weights so they add up to 1.
2. Keep the clips in step with each other, using the existing `time / duration` mapping.
3. Take the travel speed from the same weights; line 601 already blends distance by weight.
4. Optionally, add `backpedalScale` (about 0.75) in a new `src/config/lola.js`. Use Walk for slow aim-walking, or stop exporting it.

**How to check it's fixed.** Re-run the feel probe: planted-toe slip on W+D is below 0.3 units/s, and W+D speed is within 10% of W. The `lola-player` tests still pass.

### 5.33 Lola's hit flinch tears her torso away from her arms and gun

*Severity: high · Effort: M (needs the Blender sources) · Findings: `player-flat-skeleton`, `engineering-source-art-off-repo`*

**What you see.** When a bolt hits, Lola's chest and head bend away while her arms and gun stay frozen in the air. Her shoulders stretch, with shirt edges stretched up to 2.33 times their length.

**Why it happens.** The exported skeleton is *flat*: the shoulders, upper arms, thighs and chest are all root-level bones, instead of hanging off the spine (`scripts/export_lola.py:184-190`, `scripts/export_lola_clips.py:72-78`). The flinch rotates `DEF-spine.001` after the mixer has run (`src/robot/LolaPlayer.js:684-697`), so it can't carry the arms along. `attachReloadArms` (233-258) already works around the same problem for reloads.

**How to fix.**
1. In Blender, export a properly parented deform chain: spine → chest → shoulder → upper arm → forearm → hand, and pelvis → thigh → shin → foot → toe. Either use a Rigify game-rig conversion, or add a `bpy` step in `export_lola.py` that re-parents the DEF bones on a temporary copy. Keep the bone names.
2. Re-export all 14 GLBs, re-run `scripts/measure_lola_steps.mjs`, and delete `attachReloadArms`.
3. This needs the Lola `.blend` sources, which are currently only on the owner's PC. Commit them first, through LFS.
4. In the meantime, lower `ENCOUNTER.hitRecoilAngle` so the tear is less visible.

No brain impact.

**How to check it's fixed.** A probe at the peak of the flinch shows the hands and gun moving with the chest (by more than 5 cm; today 0.0), and no mesh edge stretched beyond 1.2 times its length. The `lola-player` tests still pass.

### 5.34 The rifle fires slower on slower machines

*Severity: low · Effort: XS · Findings: `aim-weapons-frame-rate-dependent-fire-rate`*

**What you see.** The automatic M416 fires 6.0, 6.67 and 6.86 shots per second at 30, 60 and 144 fps, instead of 7. So time-to-kill varies from laptop to laptop.

**Why it happens.** `this.remaining = Math.max(0, this.remaining - dt);` (`src/simulation/PlayerWeapon.js:287`) throws away the leftover time. Auto-fire only happens when `this.remaining === 0` (line 305), and `fire()` overwrites `remaining` with the full interval (line 192).

**How to fix.**
1. In `update`:
   ```js
   this.remaining -= dt;
   while (this.triggerHeld && this.weapon.automatic && this.remaining <= 0
          && this.reloadRemaining === 0 && this.ammoState.mag > 0) {
     if (!this.fire()) break;
   }
   this.remaining = Math.max(this.remaining, -this.weapon.interval);
   ```
2. In `fire()`: use `this.remaining += this.weapon.interval`, but `= interval` when `remaining > 0` (for single shots).
3. Change the remaining `=== 0` checks to `<= 0`.

Do 5.35 at the same time, because a negative first frame would upset this accumulator.

**How to check it's fixed.** A Node test with dt = 1/30 for 10 s of held trigger and a large magazine gives 70 ± 1 shots. The same holds at dt = 1/144.

### 5.35 The first frame after loading runs with a negative time step

*Severity: low · Effort: XS · Findings: `aim-weapons-first-frame-negative-dt`*

**What you see.** Mostly nothing today. The gun can be locked for about a quarter of a second right after loading, and easings briefly run backwards. Any accumulator added later, including the fire-rate fix in 5.34, would misbehave at startup.

**Why it happens.** `let previousTime = performance.now();` (`src/main.js:84`) is taken before the first `requestAnimationFrame` timestamp, which can be slightly earlier. The `Math.min(...)` at line 88 only limits the time step from above.

**How to fix.** Use `const deltaTime = Math.max(0, Math.min(junkyardMode ? 0.1 : 0.033, (currentTime - previousTime) / 1000));`, or initialise `previousTime` from the first rAF timestamp.

**How to check it's fixed.** Log the first `deltaTime` (it should be ≥ 0), and check that `playerWeapon.remaining` is 0 right after load.

### 5.36 Pressing jump just before landing is silently ignored

*Severity: low · Effort: XS · Findings: `player-jump-buffer-eaten`*

**What you see.** Chaining jumps feels like dropped input: a press up to 0.16 s before the authored jump ends does nothing.

**Why it happens.** `if (this.target.isPlayer && this.target.grounded && sim.input.consumeJump()) this.target.jump();` (`src/simulation/JunkyardBrain.js:128`). The authored jump keeps `grounded = true`, so the buffered press is consumed, and then `jump()` refuses because `this.jumpState` is still set (`src/robot/LolaPlayer.js:401`).

**How to fix.**
1. Add `get canJump() { return !this.defeated && this.grounded && !this.jumpState; }` to `LolaPlayer`.
2. In `JunkyardBrain`, use `if (target.isPlayer && target.canJump && sim.input.consumeJump()) target.jump();`, so the 0.16 s buffer survives until a jump can start.
3. Separately, as design questions: should jumps clear low props, and may firing cancel the standing jump's 1.4 s recovery?

**How to check it's fixed.** Node test: start a jump, press Space 0.1 s before it ends, and a second jump starts on the first eligible frame.

### 5.37 Firing cancels the hit flinch, and being hit drops the raised gun

*Severity: low · Effort: XS · Findings: `player-hit-flinch-cancelled`*

**What you see.** During sustained fire, each hit's flinch is wiped within 1/7 s, so it is hard to tell you are getting hurt. While aiming, every hit drops the raised gun for 0.6 s.

**Why it happens.**
- `startShot` calls `this.clearHitReaction()` (`src/robot/LolaPlayer.js:343`).
- `reactToHit` calls `this.cancelShot()` (line 319).
- `holdAim` refuses while `this.hitRecoilTime > 0` (line 358).

**How to fix.**
1. Remove `this.clearHitReaction()` from `startShot` and `this.cancelShot()` from `reactToHit`. The flinch is already applied after the mixer (684-697), so the two stack.
2. Optionally, halve `ENCOUNTER.hitRecoilAngle` while shooting.
3. Allow `holdAim` during recoil.

This looks best after the skeleton fix (5.33).

**How to check it's fixed.** Hold fire while a bolt hits Lola: the flinch is visible and the aim stays raised. The flinch-direction tests still pass.

### 5.38 The mouse wheel nudges the aim, and aim sensitivity isn't scaled for zoom

*Severity: low · Effort: XS-S · Findings: `aim-weapons-ads-view-coupled-to-chase`*

**What you see.** Scrolling while aiming shifts the crosshair by up to 2.4°. The zoomed view moves 1.35 times faster on screen than the normal view, and vertical look is 36% slower than horizontal.

**Why it happens.**
- The wheel handler changes the boom distance without checking for aim (`src/camera/CameraController.js:96-112`), and the aim ray includes a `0.35 / distance` tilt.
- The sensitivities 0.0055 and 0.0035 are shared by both views (lines 209-211).

**How to fix.**
1. Return early from the wheel handler when `this.aiming`.
2. While aiming, multiply the look deltas by `Math.tan(fov / 2) / Math.tan(55° / 2)`.
3. Replace the magic numbers with `LOOK_SENSITIVITY` and `VERTICAL_RATIO` in a camera config, ready for a settings menu.
4. Remove the `0.35 / distance` tilt once the look angles are stored separately from the boom.

**How to check it's fixed.** Add a `tests/camera-input.test.js` case: scrolling while aiming leaves the crosshair's world point unchanged, and equal mouse movements give equal on-screen motion in chase and aim.

### 5.39 Optional sound slots fail silently, and an internal doc ships to players

*Severity: low · Effort: S · Findings: `perf-optional-audio-html-fallback`*

**What you see.** Lola's hurt and thud sounds are silent, because their slots are empty. A misnamed or wrongly formatted file dropped into `public/audio` fails in exactly the same way as an empty slot, with no message. `public/audio/SOUND-SLOTS.md` is published along with the game.

**Why it happens.**
- `LaserAudio` fetches every slot by its fixed name on each load (`src/simulation/LaserAudio.js:16-23`, `49-51`).
- Vite and single-page-app hosts answer requests for missing files with `index.html` and status 200, and the decode error that follows is swallowed (lines 63-67).
- Only `gun-empty` and `knee-break-1` are filled.

**How to fix.**
1. Accept a slot only if `response.ok && response.headers.get('content-type')?.startsWith('audio/')`.
2. In dev mode, `console.warn` the expected path when a file is present but fails to decode.
3. Generate a small manifest of the files actually present at build time (a Vite plugin or a script), and fetch only those.
4. Move `SOUND-SLOTS.md` to `assets/audio/` so it isn't deployed. Fix `FOOTSTEPS.md`, which doesn't say that sprint now uses the walk sound.
5. Fill the `lolaHurt` and `lolaHitThud` slots.

**How to check it's fixed.** The network tab shows no requests for empty slots. A text file renamed to `.wav` logs a clear warning in dev. Getting hit plays a sound.

### 5.40 Performance hitches: shader recompiles on shots, texture uploads on first use, and a 30 s brain freeze on size change

*Severity: medium · Effort: M · Findings: `perf-gunshot-shader-and-buffer-churn`, `game-architecture-asset-pipeline`, `brain-ai-server-perf`*

**What you see.** Small stutters when firing after a pause (on every pistol shot and on the first M416 shot), and on the first weapon switch, jump or reload. The first START RUN, and every size change, shows "LOADING SAVED BRAIN…" for about 30 s.

**Why it happens.**
- `GunshotEffects` creates and disposes new materials and geometries on every shot (`src/simulation/GunshotEffects.js:15-29`, `34-36`), so the graphics card has to rebuild shader programs. `setFromPoints` allocates a new GPU buffer every frame (lines 55-58).
- Lola's 30 embedded textures are only 9 unique images, and they upload to the graphics card on first use, in the middle of the fight (`src/robot/LolaPlayer.js:65-77`, `178-189`, `304-308`).
- The server clears its raster cache on every width change and rebuilds it in a Python loop that takes 26-31 s (`rl/junkyard_server.py:160-164`, `rl/junkyard_geometry.py:24-44`). It also computes eye sight three times per step, by brute force over 98,632 triangles.

**How to fix.**
1. `GunshotEffects`:
   - create the line, flash and spark materials once;
   - share one unit cone and one tetrahedron geometry (or use an `InstancedMesh` for sparks);
   - give streaks a preallocated 2-vertex attribute, updated with `setXYZ` and `needsUpdate = true`;
   - pre-warm with `renderer.compile(scene, camera)` while one effect is visible.
2. Lola:
   - after load, deduplicate textures by image (a `Map` from image name to texture);
   - downscale the flat gun textures;
   - call `renderer.initTexture` for each texture;
   - compile with both outfits briefly visible.
3. Server:
   - cache rasters on disk, keyed by sha256(`collision.json`) + width (`np.save`), and keep several widths instead of clearing the cache;
   - reuse the last sight result in `snapshot()`;
   - give `JunkyardSight` a 2 m uniform grid.

None of this changes the recipe. Prove that the cached raster is identical with `np.array_equal`.

**How to check it's fixed.**
- A `gl.linkProgram` counter stays flat over 20 isolated shots.
- `renderer.info.memory.textures` doesn't change on the first weapon switch.
- A second `/reset` at a previously used width takes under 2 s.
- `/step` time drops from about 67 ms toward about 20 ms.

### 5.41 Accessibility snags: zoom disabled, tiny text, screen-reader chatter, and Enter re-triggers the last button

*Severity: low · Effort: S · Findings: `ui-audio-accessibility-basics`*

**What you see.**
- Players can't pinch-zoom, and the HUD text is 8-10 px.
- Screen readers announce something every frame.
- Pressing Enter mid-game can stop the session, because the START button kept keyboard focus.

**Why it happens.**
- `maximum-scale` and `user-scalable=no` are set in `index.html:5`.
- `src/styles/junkyard.css` uses 9 px and 10 px sizes, and 8 px on mobile.
- The `aria-live` brain label and the `role=status` attack text are rewritten every frame (`JunkyardBrain.js:186-187`, `LeaperCombat.updateHud`).
- Toolbar buttons keep focus after a click (`JunkyardPlaytest.js:27-28`, `91-94`).

**How to fix.**
1. Remove `maximum-scale` and `user-scalable`, and keep `touch-action: none` on the canvas.
2. Set a `--hud-font` minimum of about 11-12 px.
3. Write live-region text only when it changes, and keep `aria-live` off per-frame readouts.
4. Call `event.currentTarget.blur()` (or focus the canvas) after Start and Stop clicks.

**How to check it's fixed.**
- After clicking START PLAYER, pressing Enter does nothing.
- An accessibility audit (Lighthouse) shows no "user-scalable" warning.
- The number of page (DOM) changes per idle frame drops to about 0.

---

## 5b. Fix right away — quick-win checklist

These are low-risk changes of about a day or less each. Most are already written out step by step in chapter 5; only the items that aren't are described in full here.

**Day 1: the safety net**
- [ ] **Make the Lola tests pass and add test scripts.** Follow 5.4. *(S)*
- [ ] **Add a headless browser-test runner and fix the camera-player page.** Follow 5.20. *(S)*
- [ ] **Turn on CI.** This step isn't in chapter 5:
  1. In `package.json` add:
     ```json
     "test": "node --test \"tests/*.test.js\"",
     "test:browser": "node tests/run-browser.mjs",
     "lint": "eslint src tests scripts",
     "check": "pnpm build && pnpm test && pnpm test:browser"
     ```
     The quoted glob needs Node ≥ 21. On Node 20, plain `node --test` finds the same 69 tests.
  2. Add `playwright`, `eslint`, `@eslint/js` and `globals` as devDependencies. Add an `eslint.config.js` using `@eslint/js` recommended rules plus `globals.browser`/`globals.node`.
  3. Add `.github/workflows/ci.yml`, running on `ubuntu-latest`:
     - `pnpm/action-setup`;
     - `actions/setup-node` (Node 22, pnpm cache);
     - `pnpm install --frozen-lockfile`;
     - `pnpm build`;
     - `pnpm test`;
     - `npx playwright install --with-deps chromium`;
     - `pnpm test:browser`.

     Add a second job for the checkpoint-free Python tests (5.28).
  4. Replace the manual testing instructions at `AGENTS.md:128-130` and `TRAINING.md:351-353` with "run `pnpm check`".
  5. Don't run Prettier across the code before the merge with main. It would turn 7 conflicts into dozens. Format once, in a dedicated commit right after the merge.
  6. *Check:* push a branch and confirm the Actions run is green. Then break one assertion on purpose and confirm it turns red.

**Days 2-3: what players see**
- [ ] **Make the ending show the kill and keep the camera alive.** Follow 5.2 (steps 1-4), and add the START PLAYER guard from 5.6. *(S)*
- [ ] **Fix the Leaper yaw whip.** Follow 5.3. *(XS)*
- [ ] **Keep the brain clock's remainder.** Follow 5.13. *(XS)*
- [ ] **Make the fire rate frame-rate independent and stop the negative first frame.** Follow 5.34 and 5.35 together. *(XS)*
- [ ] **Pin the floating health bar to the Leaper.** Follow 5.21. *(XS)*
- [ ] **Start the sight ray at Lola's depth.** Follow 5.5. *(S)*
- [ ] **Cap leg loss.** Follow 5.7 (quick version), and also delete the swing-cancel loop at `LeaperLegDamage.js:117-120` (5.19, step 5). Test: 200 hits on every joint leaves `damagedLegCount <= 4`. *(S)*
- [ ] **Keep shadows around Lola.** Follow 5.17. *(S)*
- [ ] **Unfreeze the touch controls after START.** Follow 5.9 (steps 1-2), and remove `#joyBase`, `#btnSprint` and `#btnJump` from the selectors at `MovableHud.js:16-17` (see 5.25). *(S)*

**Days 3-5: playable by others, and honest**
- [ ] **Stop spurious "brain offline".** Follow 5.10, plus the `VITE_BRAIN_URL` setting from 5.1 step 4. *(S)*
- [ ] **Show the offline instructions, fix the controls legend and gate the debug button.** Follow 5.11 and 5.24. *(S)*
- [ ] **Open the game at `/`.** Follow 5.27 step 1. *(XS)*
- [ ] **Make the Python tests run anywhere and pin the brain dependencies.** Follow 5.28 and 5.27 steps 2-3. *(S)*
- [ ] **Add licence fields and replace the M416 sounds.** Follow 5.18. *(S)*
- [ ] **Refresh the handoff docs.** This step isn't in chapter 5:
  1. Rewrite `AGENTS.md`, the briefing every coding agent reads first. Today it says there is no test suite and never mentions Lola or the junkyard. Give it:
     - a repo map (game / lab / frozen brain);
     - the non-negotiables: never change the `JunkyardEnv` observation, action or step; policy SHA256 `883dade3…`; 34 inputs;
     - how to run the game (`pnpm play` once 5.27 is done);
     - how to test it (`pnpm check`).

     Keep the existing "Working With the Project Owner" section.
  2. Add `docs/game/CONTROLS-AND-RULES.md` with the current keys and weapon numbers.
  3. Fix `README.md:84-102`, which describes an F key and says shooting isn't implemented (see 5.24).
  4. *Check:* ask a fresh agent session "what must I not change?". It should quote the non-negotiables. *(S)*


---

## 6. What the current arrangement is holding back

These are the patterns behind many individual findings. Each one says what it blocks, so you can see which improvements the current code layout stands in the way of.

### 6.1 The enemy brain lives outside the game

Only a separate local Python/PyTorch program, reached over HTTP, can move the Leaper, and the Leaper's attacks are switched off whenever that program isn't ready. Every step is a network round trip, so the Leaper's speed depends on latency, CPU load and frame rate. The server:
- only accepts four ports;
- runs on one thread;
- rebuilds its collision raster for about 30 s whenever the size changes.

The training code for the shipped brain isn't in any branch. Main already shows the cure: in-browser ONNX inference, checked with parity fixtures.

**What it blocks:** a web release, playtests on anyone else's machine, CI of the real fight, more than one Leaper, consistent difficulty, and merging with main's in-browser brain.

**Findings:** `core-loop-brain-gates-whole-encounter`, `game-architecture-python-brain-blocks-web-release`, `engineering-brain-checkpoint-not-distributed`, `brain-ai-server-robustness`, `engineering-brain-origin-allowlist`, `brain-ai-server-perf`, `brain-ai-recipe-provenance`, `core-loop-brain-cadence-frame-dependent`, `brain-ai-hardcoded-identity`

### 6.2 Built for exactly one Leaper, one player and one level, wired by hand

Nothing in the code is a reusable actor or component:
- `JunkyardPlaytest` passes itself to every subsystem.
- `LeaperSimulation` drives the camera, the sun and the HUD.
- `LeaperCombat` owns Lola's health, all the audio and the debug UI.
- `PlayerWeapon` can only target `simulation.rig`.
- `CameraController` is a set of flags that other code writes to.
- The HUD's page elements use fixed, one-of-a-kind IDs.
- Lola pretends to be the old pink target ("duck-typing"), so code written for the target works on her.
- Hit zones are tags on the visible meshes.

**What it blocks:** a second Leaper or a new enemy type, reusing the combat in another level, art passes on the Leaper, testing systems on their own, and a clean merge with main's `BrainDriver`.

**Findings:** `core-loop-playtest-god-object`, `hexapod-simulation-god-object`, `enemy-combat-god-class-owns-player`, `aim-weapons-playerweapon-god-object`, `aim-weapons-cameracontroller-flag-soup`, `player-god-class-no-state-machine`, `aim-weapons-hitboxes-are-render-meshes`, `ui-audio-dom-scattered-in-gameplay`, `player-target-ducktyping`

### 6.3 No game-loop skeleton: no fixed tick, no state machine, no late-update phase

Each system works directly with the variable frame time and hides its own sub-steps. The game's flow is about 15 separate true/false flags. Presentation (camera, sun, health bar) runs from whichever system happens to call it, so it stops when that system stops.

Several confirmed bugs come straight from this:
- the frozen camera after an ending;
- the health bar drawn with last frame's camera position;
- the Leaper's speed and Lola's fire rate depending on frame rate;
- the negative first frame;
- a "pause" that doesn't pause;
- START PLAYER soft-locking after an ending.

**What it blocks:** pause, death, victory and menu screens; replays that play back the same way every time, and reliable bug reproduction; consistent balance across machines; resizing or switching levels without reloading the page.

**Findings:** `core-loop-no-game-state-machine`, `core-loop-implicit-update-order-stale-camera`, `game-architecture-presentation-driven-by-leaper-sim`, `core-loop-brain-cadence-frame-dependent`, `aim-weapons-frame-rate-dependent-fire-rate`, `aim-weapons-first-frame-negative-dt`, `aim-weapons-render-hooks-fragile`, `core-loop-no-lifecycle-reload-to-resize`

### 6.4 The fight has no climax or consequence

Killing the Leaper is the game's goal, yet it wipes the kill-shot effects and freezes everything. All six legs can be shot off, leaving a hovering body that keeps fighting. Reaching Lola does nothing, and there is only one attack. Nothing above the RL policy decides what the Leaper intends to do (stagger, go down, leap). Long fights also push the LSTM brain beyond anything it saw in training.

**What it blocks:** the core "shoot it and kill it" payoff, boss-style phases and stagger windows, the signature leap or pounce, and interacting with the wreck afterwards.

**Findings:** `core-loop-encounter-end-erases-feedback`, `enemy-combat-end-state-freeze`, `enemy-combat-six-legs-hover`, `brain-ai-no-behaviour-layer`, `hexapod-leg-loss-does-not-adapt`, `enemy-combat-silent-hits-weak-telegraph`, `enemy-combat-balance-vs-intent`, `brain-ai-long-run-out-of-distribution`

### 6.5 Aim and movement rough edges undercut the shooter feel

The branch's own goal is first-person aim, but:
- The camera ray starts at the lens, so shots can fire backwards.
- Held aim reuses the chase camera's pitch limit (16.6° up).
- Parallax between the camera and the gun blocks shots silently.
- Aiming hides Lola's whole body and its shadow.
- The upper-body shot is applied at only half weight, and the legs flicker during automatic fire.
- The flat skeleton tears the torso away from the arms when she is hit.
- Collision sticks on angled walls, and diagonal movement skates.
- The Leaper whips round 290° and surges ten times a second.

**What it blocks:** convincing shooting, trust in the crosshair, aim offsets and recoil, hit reactions and a death animation, and cover-heavy level design.

**Findings:** `aim-weapons-camera-trace-starts-at-lens`, `aim-weapons-ads-pitch-clamp-hides-knees`, `aim-weapons-parallax-no-obstruction-feedback`, `aim-weapons-ads-hides-whole-body`, `player-run-and-shoot-pose`, `player-collision-slide`, `player-flat-skeleton`, `player-no-directional-blend`, `hexapod-yaw-wrap-whip`, `hexapod-10hz-surge`

### 6.6 The designer can't see or tune the truth

- The tuning numbers are fixed code constants spread over about 15 files, with no live panel.
- The docs, the on-screen legend and `AGENTS.md` describe older builds.
- The clearance overlay and the spawn picker use a single circle instead of the brain's 19-disc body, and the map tests check old Leaper sizes.
- At the chosen width of 5.5, the arena is very tight.
- Debug tools and AI-state readouts share the player's HUD, while the instruction that matters most (brain offline) is hidden inside a collapsed panel.

**What it blocks:** designer-led balancing and difficulty presets, level iteration, telling whether a failure comes from the brain or from the map, and playtests by other people.

**Findings:** `game-architecture-tuning-scattered-no-live-ui`, `engineering-docs-drift`, `ui-audio-controls-legend-hidden`, `world-assets-overlay-not-brain-collision`, `world-assets-arena-too-tight-for-default-leaper`, `world-assets-nav-tests-check-old-size`, `ui-audio-debug-tools-in-player-hud`, `game-architecture-status-messages-hidden-in-options`, `engineering-agents-md-stale`

### 6.7 Two languages, two copies of the rules

Several rules are copied by hand between JavaScript and Python, with fudge margins to cover the drift:
- the map scale (7.98 / width);
- the obstacle headroom (3.82);
- the floor threshold (0.12);
- the sight ranges;
- the leg contact rule;
- the checkpoint's identity.

On top of that:
- The whole world is scaled around one enemy's rig.
- Collision is rebuilt at runtime in three different ways.
- The frozen recipe uses the same module and class names as main's live lab.

**What it blocks:** resizing or re-proportioning the Leaper, new body types, the in-browser brain port (which first needs a single source of truth), a safe merge with main, and limb loss that changes how the Leaper positions itself.

**Findings:** `hexapod-parity-constants-duplicated`, `core-loop-two-perception-authorities`, `world-assets-world-scaled-around-rig`, `world-assets-collision-soup-rebuilt-at-runtime`, `brain-ai-merge-two-brains`, `brain-ai-hardcoded-identity`, `enemy-combat-severed-leg-collision`

### 6.8 The safety net and the pipeline only work on one PC

- There is no CI and no test script. The suite went from 35/35 to 65/69 in a single 80k-line commit.
- The browser test pages are only run by hand, and one of them fails.
- The Python tests need the private checkpoint and Windows path hacks, and the Python versions are unpinned.
- The `.blend` source files live on the owner's C: drive, and the launcher is Windows-only.
- There is no LFS. One recording is NonCommercial, no licences are recorded, and assets ship uncompressed.

**What it blocks:** merging with main, refactoring safely, collaborators and parallel agents, rebuilding Lola or the map, and any public or commercial release.

**Findings:** `engineering-no-ci-no-test-scripts`, `player-failing-tests-root-cause`, `engineering-browser-tests-manual-rot`, `engineering-python-tests-checkpoint-coupled`, `engineering-mega-commit-and-branch-divergence`, `engineering-run-path-windows-only`, `engineering-source-art-off-repo`, `engineering-binary-churn-no-lfs`, `engineering-python-deps-unpinned`, `ui-audio-m416-noncommercial-license`, `game-architecture-asset-pipeline`

### 6.9 Not yet ready for the web or for mobile

- Touch play soft-locks after START, and there are no fire or aim buttons.
- The double-tap HUD-move gesture hijacks the joystick and delays every click by 350 ms.
- The CSS is layered three times over, so panels overlap.
- Rendering always runs at maximum quality.
- Raycasts check all 98k triangles one by one, and every shot allocates new GPU objects.
- Three apps ship in one bundle, and the default URL opens the old sandbox.

**What it blocks:** a shareable web build, mobile and tablet play, low-end laptops, and more enemies or effects on screen.

**Findings:** `ui-audio-touch-softlock-after-start`, `ui-audio-movablehud-hijacks-touch-and-delays-clicks`, `ui-audio-css-override-layers`, `perf-render-max-quality-no-tiers`, `game-architecture-raycasts-without-bvh`, `perf-gunshot-shader-and-buffer-churn`, `game-architecture-modes-instead-of-scenes`, `perf-single-bundle`

---

## 7. How classical game projects do it vs Leaper today

| Area | Classical practice | Leaper today | Gap | Recommendation |
|---|---|---|---|---|
| **Game loop & timestep** | Gameplay runs on a fixed-timestep accumulator at 30-60 Hz (Unity FixedUpdate, Godot `_physics_process`, "Fix Your Timestep"), and rendering interpolates between ticks. Explicit phases: input, player, AI, physics, animation, late camera, UI, render. | One rAF loop with a variable dt capped at 0.1 s. Each system hides its own sub-steps (Lola 120 Hz, debris 60 Hz). The brain runs on a wall-clock timer that drops its remainder and waits for HTTP. The order of systems is implicit. | The Leaper's speed and the fire rate depend on frame rate. The health bar uses a stale camera matrix. The first frame runs with a negative dt. Replays are not deterministic. | Add `src/core/GameLoop.js` with `fixedUpdate(1/60)` and `render(alpha)`. Schedule a brain step every 6 ticks. Name the phases explicitly. Main's `BrainDriver` already uses `STEP_DT = 1/30` and is the template. |
| **Game flow / state machine** | A game-state FSM: Boot, Loading, Menu, Playing, Paused, Victory/Defeat, Restart. Pausing sets gameplay time to 0 while the UI and camera keep running. | About 15 booleans spread across 4 classes. "Paused" only freezes the Leaper. START PLAYER after an ending soft-locks. `finish()` marks Lola defeated whichever side won. | Impossible combinations of states, no real pause, no victory or defeat state, and restarts leave stale ammo and positions behind. | Add `src/core/GameFlow.js` with a transition table, and derive `walking`, `playerMode` and the weapon's availability from it. Render the toolbar labels from the state. |
| **Entity / actor model** | Component-based actors or prefabs (Unity GameObject, Godot nodes, Unreal Actors) or an ECS. An enemy is a reusable prefab with Transform, Health, Brain, Weapon and Hitboxes that can be spawned and removed. | `JunkyardPlaytest` is a god object passed to every subsystem. There is one hard-wired rig with its leg parts at the scene root, and `PlayerWeapon.enemyMeshes()` returns that one rig. | A second Leaper would duplicate four classes, chain collision patches, create a second HUD and audio engine, and could not be targeted by the gun. | Add a small Actor/World layer (about 100 lines): an `Enemy` holding `{rig, locomotion, brain, health, hitboxes, attack}` in an `Encounter.enemies[]` list, with the player as an actor too. An ECS is optional. |
| **Communication between systems** | Explicit service interfaces for queries, plus an event bus or signals (Godot signals, Unity events, Unreal delegates). Audio, HUD and camera shake subscribe to events. | Direct reach-ins through `playtest`. A monkey-patched `world.playerBlocked`. Flags written onto other modules' objects (`rig.mobility`, `rig.weaponControlled`). Lola's movement is driven from inside the brain client. | Hidden dependencies (for example, the camera freezes when the Leaper animator stops) and construction that only works in one order. | Add `src/core/events.js` (on/off/emit), a collision service with `addDynamicBlocker()`, and a `PlayerController` that owns Lola's input. |
| **Enemy AI layering** | A decision layer (behaviour tree, FSM or utility AI) chooses the intent: search, chase, engage, attack, stagger, retreat. A locomotion layer underneath (navmesh plus steering) carries it out. Learned policies, where used at all, sit below the authored decisions. | The RL seek policy is the whole movement brain. `AttackController` is a clean behaviour tree, but only for the eye bolt. Catching Lola does nothing, there is no leap, and losing legs only slows the step clock. | No stagger, downed state, leap, engagement distance or phases. The designer's only levers are the step rate and the gun timings. | Add `LeaperDirector.js` (an FSM in `AttackController`'s style) that picks `RlLocomotion`, `PathLocomotion` (`JunkyardNavigation.route`) or `Hold`. Put its knobs in a leaper-behaviour config. The frozen policy is only paused or resumed, never fed new inputs. |
| **ML inference runtime** | The policy ships inside the game as a small runtime model (ONNX via Sentis, Barracuda or onnxruntime), versioned with its observation and action spec and checked by parity tests. Playing never needs Python. | A localhost Python/PyTorch HTTP sidecar with one thread, a 4-port allow-list, about 67 ms per step and a 30 s raster build per size. The checkpoint was only committed in `be3f9fb`. Main already runs a different brain in the browser. | Blocks a web release, other players, multiple Leapers and consistent speed. | Add a `BrainProvider` interface with `HttpBrainProvider` (dev tool and reference) and `OnnxBrainProvider` (in a Web Worker, with self-hosted wasm). Port the 34-value observation to JS, and only switch over once it matches the Python golden fixtures. |
| **Perception** | One perception system (for example Unreal's AIPerception) answers "can I see the player?" for AI, weapons and HUD from a single configuration. | Three separate checks: the brain's eye sight (28 units, unscaled), the combat raycast (22 × scale, 135° on the rendered pose), and the coverage raster. | The Leaper fires while its HUD says SEARCHING, and the gap between the checks changes with the size slider. | Feed the brain's `sight.clear` / `target_visible` into `AttackController`, keep the client ray only for line of fire, and clamp `weaponRange` to the brain's range from the shared `eye-vision.json`. |
| **Collision & character controller** | One physics world (Rapier, Jolt or engine-native) with simplified collision meshes, BVH raycasts and a kinematic character controller (collide-and-slide, auto-step, slopes, snap-to-ground). Navigation data is baked offline per agent size. | Four hand-rolled models: the JS 2D disc grid, the Python 0.1 m raster, brute-force three.js rays over 98k triangles, and Python triangle sight. Lola slides on separate axes over a flat floor, and her jump can't clear anything. | Lola sticks on angled walls, freezes mid-stride and can't hop low cover. Collision is rebuilt at runtime in two languages. | For Lola and bullets only: collide-and-slide using a contact normal, a jump-height filter, three-mesh-bvh 0.5.x, and Rapier later. Bake the Python raster at export and keep it bit-identical, because the Leaper's collision is part of the frozen recipe. |
| **Animation system** | One skeleton per character, with weapons on hand sockets. Animator state machines with layers and bone masks, 2D blend spaces for 8-way movement, additive hit and aim-offset layers, and animation events ("notifies"). | Excellent measured stride matching and foot contacts. But there are two whole duplicated characters for two guns, a 176-line `moveStep` with complexity 90, regex-based track masks, a 1000× weight hack and a flat exported skeleton. The Leaper's procedural gait is solid. | Diagonal skating, the broken run-and-shoot pose, the flinch tearing the torso from the arms, no aim offset, and frozen poses at death. | Fix the skeleton parenting in the export first. Then add `LolaAnimator` layers (base 2D blend, upper-body overlay, additive hit and aim), one body with gun sockets, and a transition table. |
| **Camera** | One control rotation shared by camera modes (spring-arm chase, ADS, death and kill cams), with a camera manager that blends between them, shake and recoil modifiers, and a late update after gameplay. | One `CameraController` for three products, built from a mode string and five flags, and updated from inside the Leaper's network-pose code. ADS (aim-down-sights) snaps 4.45 units, reuses the chase pitch clamp, and has no shoulder offset. | The camera freezes after the encounter, the aim view is limited to 16.6° up, and the mouse wheel tilts the aim. | Add a `CameraRig` holding the look angles, mode objects (Chase / Aim / Top / Lens / Spectator) and a blend, called once per frame from the loop's late phase. |
| **Weapons & hit detection** | Weapons are data assets (damage, rate, magazine, recoil, spread, ADS multipliers). The camera trace starts at the character's depth, the muzzle trace checks for obstruction and shows an "obstructed" reticle, and enemies are hit through tagged capsule or sphere hitboxes. Effects are pooled. | Two hitscan guns tuned across 4+ files. The trace starts at the camera lens. Enemy hits use render meshes with `userData` tags. Every shot allocates new GPU objects. There is no recoil or spread, and the pistol does about 2.2× the rifle's damage per second. | Backwards shots, silent obstruction, fragility when the art changes, shader recompiles, and inverted weapon roles. | Add `config/weapons.js`, a pure `WeaponState` with an accumulator, a pure `resolveShot(near)`, a `Hitboxes` component built from bones, and pooled `GunshotEffects`. |
| **Input** | Action maps (Unity Input System, Godot InputMap, Unreal Enhanced Input) with keyboard, gamepad and touch bindings, polled once per tick, with rebinding and on-screen prompts generated from the bindings. | Raw `event.code` checks in 5 modules, each with its own window listener. Shots fire inside page (DOM) event callbacks. No gamepad support, and touch only has move, sprint and jump. The legend is hidden and wrong. | No controller, mobile or rebinding support, and the click that recaptures the mouse also fires a shot. | Add `src/input/actions.js` bindings with one `InputController` exposing `pressed(action)`, `held(action)` and `axis()`, gamepad polling, and touch FIRE / AIM / RELOAD buttons. Generate the legend from the bindings. |
| **Audio** | An audio manager or middleware with buses, a limiter, positional emitters with the listener on the camera, per-category voice limits with priority, loudness-normalised compressed assets, and a credits and licence manifest. | `LaserAudio`, owned by `LeaperCombat`, is the whole game's audio. Every voice goes straight to the speakers with hand-tuned volumes, nothing is positioned in 3D, the files are raw WAV (a 4.5 MB walk loop), and no licences are recorded (the M416 is CC BY-NC). | No directional cues, no volume settings, clipping, and legal risk. | Add `src/audio/AudioService.js` (master → compressor → buses, `playAt` with a `PannerNode`), created once in `main.js`, with a `sounds.json` manifest that includes licence fields, and Opus/AAC builds. |
| **UI / HUD & debug tools** | The player HUD reads a state snapshot or events. Dev tools sit behind a console key or debug build (ImGui-style) and are left out of release builds. Element references are cached, the page is only updated when something changes, and layouts respect phone safe areas. | Nine gameplay classes create page elements with `innerHTML` and one-of-a-kind IDs. The CSS is layered three times over. The AI state, brain badge, POV view and a DEBUG DAMAGE cheat sit in the player's toolbar. Text is rewritten every frame. | No home for menus or settings, panels overlap on laptops and phones, the cheat ships to players, and the offline instructions are hidden. | Add `src/ui/Hud.js` with views, and `src/debug/DevPanel.js` loaded only with `?dev` or `import.meta.env.DEV`. Use one rule per element in `hud.css`, with z-index tokens. |
| **Data-driven tuning & designer tools** | Designers tune in data assets (ScriptableObjects, DataTables, Godot Resources) with a live tweak panel and hot reload. Level designers place spawns and cover as markers exported with the level, and level metrics are checked automatically. | Fixed JS constants in about 15 files, with duplicates (`CHASE_FOV` twice; ×1.25 vs ×1.35). No live panel, although dat.gui ships with r128. Spawns are computed in code, the overlay uses the wrong Leaper shape, and the tests use old sizes. | The designer can't balance the fight or iterate on levels without a programmer. | Designer tuning JSON in `src/config/tuning/`, kept separate from the frozen brain contract in `src/config/frozen/`. A dev-only Tweakpane or dat.gui panel with "Copy JSON", Blender empties for spawns and passages, and metric tests at `ENCOUNTER.startWidth`. |
| **Assets, build & team workflow** | Source art in LFS or Perforce, one headless export command per asset, compressed runtime assets (meshopt, Draco, KTX2, Opus), CI on every push, short-lived branches merged daily, preview builds per PR, and a one-command cross-platform setup. | Blender sources on the owner's C: drive, Windows-only scripts, no LFS (a 22 MB raw WAV in history), raw GLB and WAV files plus a 5.9 MB JSON shipped, three serial load phases, no CI, a single 80k-line commit, and a long-lived "fix/" branch that conflicts with main in 7 files. | Nobody else can rebuild the art or run the game, regressions go unnoticed, and the merge gets harder every week. | Fix the tests and add GitHub Actions now. Add LFS rules and an `art/` manifest, a `pnpm play` bootstrap, gltf-transform and ffmpeg asset scripts, and a merge plan that namespaces the frozen recipe first. |

### 7.1 Engine and tech-stack recommendation

**Recommendation: stay on Three.js for now.** Upgrade it in stages once the merge with main is done, and add the standard web libraries listed below. Decide again on the engine at the *vertical-slice* milestone: the brain runs in the browser, and a second enemy or level is planned.

**Why stay now:**
1. **The hardest constraint has nothing to do with the engine.** The frozen brain's 34-value observation, its 19-disc collision raster, its eye-level sight and its signed-reverse step have to be reproduced exactly in whatever runtime plays the game; otherwise the 7,757,824-step policy has to be retrained. A web release needs a JavaScript port with Python-generated parity fixtures anyway, and that port is also the most portable piece of work. Main already follows this pattern (onnxruntime-web plus `make_brain_fixtures.py`).
2. **A switch would throw away the branch's real value.** That value is engine-specific JavaScript work: stride-matched locomotion measured from the clips, foot-contact detection, swept bolt and cover tests, the leg-damage physics, the 69 Node tests and the 155-check browser test.
3. **Most gaps are about organisation, not the engine.** Almost every gap found in this review (no fixed tick, no state machine, god objects, scattered tuning, no BVH, no CI) is about how the code is arranged. A new engine would provide some scaffolding, but it wouldn't fix the arrangement.
4. **r128 doesn't block the near-term needs.** three-mesh-bvh 0.5.x, the meshopt, Draco and KTX2 loaders, CSM and dat.gui all work on it. The old version is upgrade debt (colour management, light units, `KHR_materials_specular`), not a wall. Upgrade after the merge, on its own branch, with screenshot baselines.

**Libraries to add:**

| Library | Purpose |
|---|---|
| three-mesh-bvh | Fast raycasts. |
| Rapier (`@dimforge/rapier3d-compat`) | Later, for Lola's character controller and debris only. The Leaper's collision stays frozen. |
| Tweakpane or dat.gui | A dev-only tuning panel. |
| onnxruntime-web | The brain, in a Web Worker with self-hosted wasm. |
| gltf-transform and ffmpeg | The asset build. |
| miniplex or bitecs (optional) | An ECS. A 100-line actor layer is enough. |

**What to check at the vertical slice:**
- **PlayCanvas** is the closest fit if you want to lay out levels visually, wire animation state graphs and tune without a programmer while staying on the web. It offers a web-based collaborative editor, an animation state graph, physics and hosting; the trade-off is depending on its service. **Babylon.js** (inspector, Havok physics, GUI) is the code-first alternative.
- **Godot 4** is the realistic candidate if desktop becomes the main platform. It offers a free editor, AnimationTree, CharacterBody3D, navmesh, audio buses and Godot RL Agents. One caveat, as far as this review knows: C# projects, which its ONNX inference path relies on, could not export to the web. Check the current Godot release notes before deciding, because this may have changed.
- **Unity** (ML-Agents plus Sentis) has the most integrated ML toolchain. It means heavy and constrained web builds, licensing, and re-implementing the environment exactly. Choose it only if you drop web delivery or accept retraining.
- **Unreal** has no supported web export and doesn't fit a browser game.

In every case, the portable contract is the ONNX actor (with its LSTM memory as explicit inputs and outputs), the observation spec and the golden fixtures. Building the in-browser brain first makes any later engine move cheaper.

---

## 8. Target architecture

This is the layout to grow toward. Each migration step at the end is a small PR that can be reverted, with the tests passing before and after.

### 8.1 Proposed layout and responsibilities

```
index.html                     the game only; junkyard at '/'
lab.html / sandbox.html        main's RL replay viewer and the keyboard sandbox
                               (separate Vite entries via build.rollupOptions.input)
src/
  core/
    GameLoop.js                fixedUpdate(1/60) accumulator (max 5 catch-up ticks) + render(dt, alpha)
    GameFlow.js                FSM Loading -> Ready -> Playing{hunt|explore} <-> Paused -> Ended{victory|defeat};
                               enter/exit own mouse capture, brain start/stop, result panel
    events.js                  on/off/emit: footstep, lolaDamaged, leaperDamaged, jointBroken, died,
                               encounterEnded, pauseRequested
    angles.js, Assets.js       shortestAngle(); LoadingManager + progress + per-scene manifest
  game/
    Encounter.js               owns update order, enemies[], start snapshot, win/lose, restart (no page reload)
    PlayerController.js        input actions -> Lola move/jump/crouch/weapon (moved out of JunkyardBrain.js:128-136)
    modes/junkyard.js, sandbox.js   {start(engine, settings) -> {update, beforeRender, afterRender, dispose}}
  actors/
    lola/    LolaPlayer.js (facade, same public API), LolaAssets.js,
             LolaLocomotion.js (2D blend + stride match),
             LolaAnimator.js (base/upper/additive layers, one mixer update per frame, visible outfit only),
             LolaActionState.js (transition table), CharacterMover.js (collide-and-slide)
    leaper/  HexapodRig.js (one root + legsRoot, shared geometry, dispose, size param),
             HexapodLocomotion.js (gait/IK only, no camera/sun/HUD),
             LeaperDirector.js (Search/Chase/Engage/Stagger/Downed/Dying/Dead),
             EnemyHealth.js (zones, events), Hitboxes.js (bone capsules/spheres + zone + multiplier),
             LegDamage.js, AttackController.js (unchanged behaviour tree)
  brain/
    BrainProvider.js           interface: reset(pose, target, sightPose), step(target, sightPose), sense();
                               returns BrainSession.snapshot()-shaped frames;
                               owns world <-> robot unit conversion (width / 7.98)
    HttpBrainProvider.js       today's JunkyardBrain request code (dev + parity oracle)
    OnnxBrainProvider.js       onnxruntime-web in a Worker, self-hosted wasm, explicit LSTM h/c
    junkyardObservation.js     exact JS port of JunkyardEnv/SeekerEnv observation + step + raster + eye sight
    PathfinderController.js    labelled scripted fallback ('NOT THE TRAINED BRAIN')
  weapons/   WeaponState.js (pure ammo/accumulator/reload), resolveShot.js (pure, near param),
             GunshotEffects.js (pooled), WeaponHud view
  camera/    CameraRig.js (look angles), modes/{Chase,Aim,Top,Lens,Spectator}.js, CameraOcclusion.js
  world/     levels.js (LEVELS registry + @typedef World),
             createJunkyardWorld.js (returns {root, atmosphere, dispose}),
             WorldCollision.js (one shared BVH raycast service + addDynamicBlocker),
             JunkyardNavigation.js (+ region labels)
  input/     actions.js (bindings), InputController.js (the only DOM listener; keyboard/mouse/gamepad/touch)
  audio/     AudioService.js (master -> limiter -> buses, playAt/PannerNode), sounds.json (file, gain, bus, licence)
  ui/        Hud.js + views (Health, Ammo, Reticle, WorldBar per enemy), ControlsLegend.js, TouchControls.js, hud.css
  debug/     DevPanel.js, TuningPanel.js, PerfOverlay.js  (dynamic import only with ?dev or import.meta.env.DEV)
  config/
    tuning/  combat.json, weapons.json, player.json, camera.json, leaper-behaviour.json, audio.json
             (designer-owned, live-tunable)
    frozen/  player-contact.json, eye-vision.json,
             leaper-geometry.json (7.98, 3.82, 0.12, leg angles/radii),
             brain.json (id, steps, sha256, obs_size 34, action 'signed-reverse')
             (the brain contract: version-checked by JS and Python, never retuned)
rl/frozen_7757824/             checkpoint_environment.py, seeker_env.py, seeker_recurrent_policy.py (+ SHA pin test)
rl/junkyard_*.py               inference server = reference oracle + fixture generator (make_junkyard_fixtures.py)
model_7757824/ + brain.json    (LFS or release asset)
tests/   unit (*.test.js), browser/ (Playwright runner), fixtures/ (brain parity rollouts, brain-frames.json),
         python (env-only + skipUnless checkpoint)
```

The key responsibilities in plain words:
- **GameLoop** keeps time steady.
- **GameFlow** knows what the game is doing (menu, playing, paused, ended).
- **Encounter** owns one fight: its enemies, the order in which they update, how it is won or lost, and how it restarts.
- **Actors** are Lola and each Leaper, built from small parts.
- **BrainProvider** hides *where* the brain runs (Python today, the browser tomorrow). It is the only place that knows the brain's "robot units".
- **config/tuning** is yours to change. **config/frozen** is the brain contract and is never retuned.

### 8.2 Data flow

**Fixed update (every 1/60 s):**
1. `InputController.sample`.
2. The `GameFlow` gate: Paused and Ended stop gameplay time.
3. `PlayerController` moves Lola (`CharacterMover` over `WorldCollision`, which includes each enemy's contact discs).
4. `Encounter`, for each enemy:
   - `LeaperDirector` picks the locomotion: RL via `BrainProvider` every N ticks, with a one-step pipeline buffer, or Path, or Hold.
   - `AttackController`.
   - Projectiles.
5. `EnemyHealth` and `PlayerVitals` update, and send events.

**Render (every frame, with the interpolation factor `alpha`):**
1. Interpolate each Leaper from `previousFrame` to `frame`, using the shortest angle for yaw.
2. `HexapodLocomotion` gait and IK.
3. `LolaAnimator`, once, for the visible outfit only.
4. `CameraRig` late update, plus the sun following Lola, plus `updateMatrixWorld`.
5. World-anchored HUD.
6. `Hud` from the snapshot and events.
7. `AudioService` listener.
8. `renderer.render`. Visibility is set through layers or `colorWrite`, not by changing objects before and after the render.

**Brain boundary.** Only `BrainProvider` knows robot units. The observation, the action and the per-step physics stay identical to the frozen recipe, and parity fixtures must prove that before any switch from HTTP to ONNX.

### 8.3 Migration steps (in order, one PR each)

1. Test scripts, browser runner and CI; get the suite green.
2. Set `LeaperSimulation.drivesPresentation = false` in the junkyard. Update the camera and sun from `JunkyardPlaytest.update`, and the health bar after the POV view.
3. `PlayerController`: move Lola's input handling out of `JunkyardBrain`, and replace the `playerBlocked` monkey-patch with a `collision.addDynamicBlocker` list.
4. `GameFlow.js`: derive `walking` and `playerMode` from it, and have `PlayerWeapon.available` read it. Add the Encounter start snapshot for restarts.
5. Namespace the frozen recipe (`rl/frozen_7757824`), add the mode registry with the junkyard as the default, split the docs, then merge main (a merge commit, not a rebase).
6. `BrainProvider` wrapping today's HTTP code; the turret/pathfinder fallback; the `brain.json` manifest.
7. Extract `PlayerVitals`, `AudioService` and `Hud` from `LeaperCombat`, and add `events.js`.
8. `Encounter.enemies[]`, a target registry for `PlayerWeapon`, `Hitboxes`, and a HUD per enemy.
9. `GameLoop` fixed tick plus interpolation.
10. `OnnxBrainProvider` plus parity fixtures; a static deploy preview for each PR.
11. Tuning JSON plus `DevPanel`; the Three.js upgrade on its own branch with screenshot baselines; the asset pipeline (meshopt, Opus, baked raster).

---

## 9. Roadmap

### Phase 0: Stabilise (week 1)

**Goal:** a baseline you can trust, plus the one-day fixes players will notice.

**Items:**
- Apply the Lola easing fix and update the 3 stale tests. Add the `test` and `test:browser` scripts and a Playwright runner, and fix `camera-player.js` (5.4, 5.20).
- Add a GitHub Actions workflow: `pnpm install --frozen-lockfile`, build, `test`, `test:browser` (Chromium with SwiftShader), plus the checkpoint-free Python tests.
- Fix the encounter ending: update the camera and sun from `JunkyardPlaytest`, keep the kill-shot effects, don't freeze Lola and the Leaper, and add the START PLAYER guard (5.2, 5.6).
- Fix the yaw wrap, keep the brain clock's remainder, add the fire-rate accumulator, clamp the first-frame dt, and update the health-bar matrix (5.3, 5.13, 5.34, 5.35, 5.21).
- Add the leg-loss cap, the camera-ray `near` fix and the aim pitch limits, and scale the shadow box and make it follow Lola (5.7, 5.5, 5.22, 5.17).
- Touch: no pointer lock on touch screens, scoped CSS, and the joystick removed from `MovableHud` (5.9, 5.25).

**Exit criteria:** `pnpm check` (build + 69/69 Node tests + browser pages PASS + Python env tests) passes in CI on every push. Each fix-guide item for the ending, yaw, clock, aim, legs and touch is verified with its "How to check it's fixed" steps.

### Phase 1: Playable by others (weeks 2-3)

**Goal:** a teammate on a Mac or Linux machine can clone the repo and fight a live Leaper with one command. Without Python, they still get a working fight.

**Items:**
- Adopt `be3f9fb` (checkpoint committed). Make `load_brain` stop requiring `policy.optimizer.pth`, and add a `brain.json` manifest.
- Turret-mode fallback, so attacks no longer depend on `brain.ready`, and a visible offline banner with instructions (5.1, 5.11).
- `vite.config.js` with `strictPort`, the loopback-origin regex, a threaded server or a timeout, the non-object-body guard, and least-recently-used sessions (5.10).
- `requirements-brain.txt` pinned to the checkpoint's versions, the `sys.path` hacks deleted, a cross-platform `pnpm play` launcher, and a "Play the game" section in the README (5.27, 5.28).
- Replace the NC M416 sounds, and add a licence manifest and credits. Refresh `AGENTS.md` and the controls docs (5.18, 5b).
- The junkyard at `/`; DEBUG damage and the other dev tools behind `?dev` (5.24, 5.27).

**Exit criteria:**
- On a clean Linux VM: clone, `pnpm install`, `pip install -r requirements-brain.txt`, then `pnpm play` shows `BRAIN 7,757,824 · SEARCHING` at `/`.
- With no Python, START RUN shows TURRET MODE and the Leaper fires.
- The licence test passes.

### Phase 2: Merge with main (weeks 3-4)

**Goal:** one main branch containing both the RL lab and the game, without either side silently changing the other.

**Items:**
- Tag `9b384c9`. Optionally, move the raw source binaries to LFS before anything reaches main (this rewrites history and needs the owner's explicit go-ahead).
- Move the frozen trio into `rl/frozen_7757824/` with distinct class names and a SHA pin test, and point `junkyard_env.py` and `junkyard_server.py` at it.
- Add a mode registry (`src/modes/*`), so the `main.js` conflicts become separate files. Take main's `TrainingVisualizer`, `createTrainingWorld`, `rl_environment.py`, `train_rl.py` and `vite.config.js`.
- Split `TRAINING.md`: game entries into `docs/game/CHANGELOG.md`, and junkyard-brain notes into `docs/brain/`. Combine both sides' `.gitattributes` lines.
- Merge (not rebase) into `integrate/game-main`, run both sides' tests, and open a PR. From then on, use short-lived feature branches.

**Exit criteria:**
- The PR is merged into main with CI green.
- Main's Python tests and the game's `pnpm check` both pass.
- A search (`grep`) shows the game imports nothing from main's live `rl/seeker_env.py`.

### Phase 3: Game skeleton (weeks 4-7)

**Goal:** the loop, flow and actor structure that let the game grow beyond one Leaper.

**Items:**
- A GameFlow state machine: a real pause, a practice label, victory and defeat states, and a clean restart snapshot.
- `PlayerController` out of `JunkyardBrain`; a collision service with dynamic blockers; `events.js`.
- `HexapodLocomotion` extracted from `LeaperSimulation` (no camera, sun or HUD); `CameraRig` and mode objects with a late update.
- `PlayerVitals`, `AudioService` and `Hud` extracted from `LeaperCombat`; `Encounter.enemies[]`; `Hitboxes`; a `PlayerWeapon` target registry.
- The `GameLoop` fixed tick plus snapshot interpolation of the Leaper; pipelined brain requests.
- An input action map with gamepad support and touch FIRE/AIM buttons.

**Exit criteria:**
- A test scene spawns two Leapers (with stub brains). The gun can hit each one independently, each has its own health bar, and they share one audio engine.
- Escape pauses everything.
- In a Node test, the Leaper's step rate is 10 ± 0.1 per second at 30, 60 and 144 fps.

### Phase 4: Brain in the browser (weeks 6-10, in parallel with Phase 3)

**Goal:** no Python needed to play, with proof that the frozen recipe is unchanged.

**Items:**
- `scripts/export_brain_onnx.py`: export the actor only, `(obs[1,34], h, c) -> (action mean, h', c')`, with a parity loop against SB3.
- `make_junkyard_fixtures.py`: scripted rollouts of 500+ steps recording the observation, action, LSTM state and pose, including memory and size variants.
- `src/brain/junkyardObservation.js`, a JS port of:
  - the raster (baked per width);
  - the 16 rays and the 270° eye sight;
  - the last-seen memory, the coverage and frontier note, and the movement deltas;
  - the 19-disc step with signed reverse.
- `OnnxBrainProvider` in a Web Worker with self-hosted onnxruntime wasm. Keep `HttpBrainProvider` as the reference, behind `?brain=http`.
- A static deploy (GitHub Pages or Netlify) with a preview for every PR.

**Exit criteria:**
- A Node parity test matches observations to 1e-5 and actions to 1e-5 over all fixtures.
- A static build plays the full fight in a browser with no local server, on a hosted preview URL.

### Phase 5: Encounter depth & designer tools (weeks 8-14)

**Goal:** a boss fight with a climax, which the designer can tune without code.

**Items:**
- `LeaperDirector` (Search / Chase / Engage / Stagger / Downed / Dying) with path and hold locomotion. A downed phase when the leg cap is reached, a death collapse, and a victory beat with Lola free to walk up to the wreck.
- A stomp attack (as a data entry), then a scripted leap through a `/sync`-style session update. Attack audio telegraphs, impact effects, and a hit-direction indicator.
- Tuning JSON plus a dev `TuningPanel` (Copy JSON, Reset). A balance-report script, the weapon roles fixed, and one perception result per tick.
- Level metrics: tests at `startWidth`, the tire passage moved into the source `.blend`, a clearance overlay built from the brain's own mask, and a spawn picker using region labels.
- Lola: a re-exported, properly parented skeleton, an aim offset, an 8-way blend, collide-and-slide, and one body with gun sockets.

**Exit criteria:**
- In a 5-person playtest, players can describe the Leaper's tells, the kill and the defeat.
- The designer changes damage, ranges and stagger time live and exports JSON without touching code.
- The level metric tests pass at width 5.5.

### Phase 6: Web release readiness & engine checkpoint

**Goal:** ship a fast, legal web build that works across devices, then decide the engine with evidence.

**Items:**
- The asset pipeline:
  - meshopt compression with gltf-transform;
  - deduplicated, right-sized Lola textures;
  - Opus/AAC audio;
  - binary collision data baked in a Web Worker;
  - a loading progress bar;
  - shaders compiled in advance.
- Quality tiers (pixel ratio, shadows, fewer shadow-casting props); BVH raycasts; pooled effects; a `?perf` overlay and a performance smoke test in CI.
- The Three.js upgrade from r128 to r152+ on its own branch, with screenshot baselines.
- The engine review: a PlayCanvas or Godot spike reusing the ONNX model and fixtures, if the need for a designer editor justifies it.

**Exit criteria:**
- The first frame appears in under 3 s at 20 Mbps, and the total download is under 8 MB.
- 60 fps on a mid-range laptop with two Leapers.
- The credits screen is complete, and the engine decision is written down.

---

## 10. Detailed findings by area

Below are the 11 area chapters exactly as the reviewers and verifiers wrote them. Each finding gives its evidence (file:line, quoted code or command output), why it matters in plain language, what it holds back, how to fix it, its effort, and whether it is a quick win.

### Bootstrapping, game loop & orchestration

**How it works today**

There is one `index.html` page shared by three modes. It still contains the old sandbox help text ("P SELECT PINK CUBOID · I J K L MOVE IT"), the RL training-replay panel and the touch controls. `src/main.js` reads the page address: `?training` opens the training replay viewer, `?map=junkyard` opens the actual game, and the plain address `/` opens the old hexapod sandbox. For the game, the boot order is: load the junkyard map and its collision data (in parallel), *then* download Lola's 14 model/animation files, then build the robot, the input, the camera, the Leaper animator (`LeaperSimulation`) and finally `JunkyardPlaytest`. `JunkyardPlaytest` builds the toolbar and options panel and creates every gameplay system (`EyeVision`, `JunkyardBrain`, `LeaperCombat`, `LeaperPov`, `PlayerWeapon`), handing each one the whole playtest object (`this`). APPLY SIZE reloads the whole page. There is no `vite.config.js`.

Every frame (`main.js` `animate`), the time step is the real time since the last frame, capped at 0.1 s. There is no fixed-rate gameplay clock. `JunkyardPlaytest.update` runs in this order: (1) `JunkyardBrain.update` reads the keyboard and moves and jumps **Lola** (player control lives inside the AI client). It asks the local Python brain server (`http://127.0.0.1:8767`) for a new Leaper move at most 10 times per second, and only when no request is already waiting. It eases the visible Leaper toward the last reply. Through `LeaperSimulation.updateExternal` it animates the legs and **also moves the camera and the sun and writes the status line**. All of step 1 is skipped once the encounter is over. (2) `LeaperCombat.update`: leg damage and debris, the Leaper's own "can I see Lola" check, the attack behaviour tree, laser bolts, the health HUDs and the floating Leaper health bar. (3) `PlayerWeapon.update`. (4) `LeaperPov.update`. After that, the before-render hooks run, then the render, then the after-render hooks in reverse order.

The Python server is the authority on where the Leaper is. It needs PyTorch and the `model_7757824/` checkpoint, which is git-ignored, so it is not in the repo. Game-flow state is spread across about 15 separate flags (`walking`, `playerMode`, `brain.running/ready/busy`, `combat.dead`, `target.defeated`, `tree.state`, camera `gameplayStarted/mode/aiming`, `pov.active`, …). There is no state machine. No event listener is ever removed, and the only cleanup is local (the clearance overlay, gun effects, leg debris). "Pausing" (Escape or STOP RUN) only freezes the Leaper. By design, Lola can still walk and shoot (`LolaPlayer.js:397` "Lola remains controllable while the Leaper is paused").

**What's good**

- Most smoothing works the same at any frame rate. The camera, Lola's input ramp, and the Leaper's position and turn following all use `1 - exp(-k·dt)`. The frame time is capped, so a tab switch or a hitch cannot fling objects across the map.
- The brain connection is defensive. A generation counter throws away late replies after a reset. A slow or failed move is retried up to `MAX_FAILED_STEPS` times. Each request has a timeout. The client also checks the checkpoint's identity (`model_step 7757824`, `policy_sha256`, `contact_version`, `sight_version`), so a wrong server cannot quietly drive the Leaper.
- The JS and Python sides share one source of truth: `src/config/player-contact.json` and `src/config/eye-vision.json` are read by both the browser and `rl/junkyard_env.py`.
- Boot gives basic feedback (LOADING MAP… → LOADING LOLA…), and a map or character load failure shows a readable message instead of a blank screen.
- The render hooks are correctly nested (camera → weapon → POV before render, reversed after), so temporary hide/fade tricks always restore.
- Pointer-lock handling is careful. It tells intentional releases from accidental ones, has a fallback for embedded browsers, and requests the lock inside the click.
- Designer-facing numbers are named and explained in plain language (`LEAPER_FOLLOW_RESPONSE`, `LEAPER_STEPS_PER_SECOND`, `ENCOUNTER`, `COMBAT`). `localStorage` access is always wrapped in try/catch.
- Several parts are testable without a browser. The attack behaviour tree has no DOM code, `randomJunkyardStart` takes an injected random function, and `JunkyardBrain` has node tests with a fake playtest (`tests/junkyard-chase.test.js`, which passes).
- The physics-sensitive parts are substepped (Lola's movement at 120 Hz, debris at 60 Hz, hanging legs at 120 Hz), so collisions stay stable at low frame rates.

**How professional game projects handle this**

A typical action game has one "Game/World" object that owns a **fixed-rate gameplay clock** (an accumulator ticking at, say, 30–60 Hz, with rendering smoothed between ticks). It runs clearly named phases in a fixed order: input → player → AI → physics → animation → camera ("late update") → HUD → render. Game flow is a **state machine** (Loading → Menu → Playing ↔ Paused → Victory/Defeat → Restart). Pausing sets gameplay time to zero while the camera and menus keep running. Levels and modes are separate scenes with a lifecycle (init/start/update/dispose, GPU memory released), so changing level or difficulty never needs a page reload. Each entity gets only the dependencies it needs, or talks through events (`onDamaged`, `onDeath`), so a second enemy is just another instance. An input layer maps keyboard, mouse, gamepad and touch to named actions. Cheats and debug panels live behind a debug build. AI brains run on their own fixed tick with buffered results and share one perception result with the combat code. Here the gaps are:
- `JunkyardPlaytest` is the level, game mode, HUD, developer panel and service locator in one class.
- The camera and sun are driven from inside the Leaper's animator.
- Player movement lives inside the AI client.
- There is no fixed timestep, no state machine and no teardown.
- The modes are picked by ternaries in `main.js`, which is exactly where the merge with main conflicts.
- The core fight only works with a local Python server.

A studio's first refactor would usually be: a GameLoop with phases, a GameFlow state machine, an Encounter made of a PlayerController plus an `enemies[]` list (each enemy = rig + animator + brain + combat), a BrainProvider interface (an in-browser ONNX build like main's, with HTTP kept for development), and a mode registry with `dispose()`.

**Findings**

#### [CRITICAL] The whole fight needs a local Python brain server and a checkpoint that is not in the repo; without it the Leaper never moves or attacks  `core-loop-brain-gates-whole-encounter`
- **Where:** `src/simulation/JunkyardBrain.js:17`, `src/simulation/JunkyardBrain.js:55`, `src/simulation/JunkyardBrain.js:103-112`, `src/simulation/LeaperCombat.js:200`, `.gitignore:16`, `rl/junkyard_server.py:12-13`, `rl/junkyard_server.py:36-40`, `rl/junkyard_server.py:98`, `README.md:72-74`
- **What's wrong:** Only the Python server can move the Leaper, and the attack AI is switched off whenever that server is not connected:
  ```js
  // Only the checkpoint server chooses movement. No navigation-route fallback.   (JunkyardBrain.js:17)
  const response = await fetch(`http://127.0.0.1:8767/${path}`, {               (JunkyardBrain.js:55)
  const paused = !p.walking || !p.brain.ready || document.hidden;               (LeaperCombat.js:200)
  ```
  The server imports `torch` and `sb3_contrib`, loads `model_7757824/` (git-ignored, `.gitignore:16`, and described as "uncommitted" in `README.md:74`), and refuses any other checkpoint (`model.num_timesteps != 7757824`). It also only accepts browser pages served from ports 4173/4175/5173/5175 on localhost. The reviewer's headless run with the server unreachable showed `BRAIN OFFLINE — START RUN TO RETRY`, and six clicks on DEBUG: DAMAGE LEAPER gave `LEAPER DEFEATED · DEBUG TEST` while the Leaper never moved or fired. By contrast, main already runs a brain in the browser (`MAIN src/brain/LeaperBrain.js:11` `import * as ort from 'onnxruntime-web/wasm';`).
- **Why it matters (plain language):** On any computer except the owner's, the Leaper is a statue. It doesn't chase and it doesn't shoot, so "kill the Leaper" becomes target practice. A public web page also cannot reach a program running on the player's own computer, so the game cannot be put online in this form.
- **What it holds back:** Sharing builds with playtesters, any web release, automated playtests or CI, other people working on combat without the RL setup, and merging with main's in-browser brain.
- **How to fix:**
  1. *Short term (about a day):* Put a small `BrainProvider` interface in front of the network code. Create `src/simulation/brain/HttpBrainProvider.js` by moving `request/reset/step/sense` out of `JunkyardBrain` unchanged, with methods `reset(pose, target, sight)`, `step(target, sight)` and `sense(target, sight)`, each returning the same "frame" object `JunkyardBrain` uses today. Read the URL from `import.meta.env.VITE_BRAIN_URL ?? 'http://127.0.0.1:8767'`. Add an `OfflineBrainProvider` that returns the current pose with `target_visible` computed by the client. Make offline an explicit, visible mode ("BRAIN OFFLINE — PRACTICE MODE: Leaper stands still but still shoots"). In `LeaperCombat.update` (line 200), use `p.brain.ready || p.brain.offline` so combat can be tested without Python. This changes nothing about the saved brain.
  2. *Long term (the main fix):* Run the brain in the browser like main does. On a machine with PyTorch, export the `ResidualLstmPolicy` to ONNX, with the LSTM hidden and cell states as extra inputs and outputs. Port `JunkyardEnv`'s 34-number observation (16 obstacle rays against `collision.json`, the eye-sight check against the GLB triangles, target memory, the last action and feedback values) and its movement step to JS. Prove they match with a Python-generated fixtures file and a self-test, the way main's `make_brain_fixtures.py` and `BrainDriver.runSelfTest` do. Because the same observation and action mapping are reproduced and checked number-for-number, the frozen brain recipe is preserved. Separately, the owner should decide how the checkpoint is distributed (a release asset or Git LFS).
  3. *Confirm:* With the server stopped, START RUN shows the practice-mode banner and the Leaper still fires. Extend `tests/junkyard-chase.test.js` with a fake provider. For the ONNX path, the fixture self-test must pass on load.
- **Effort:** XL (offline mode alone: M)  ·  **Quick win:** no

#### [HIGH] JunkyardPlaytest is a "god object": every system gets the whole playtest and reaches into it and into each other; the AI client even moves the player  `core-loop-playtest-god-object`
- **Where:** `src/simulation/JunkyardPlaytest.js:60-70`, `src/simulation/JunkyardBrain.js:31-49`, `src/simulation/JunkyardBrain.js:128-136`, `src/simulation/PlayerWeapon.js:166-169`, `src/simulation/LeaperCombat.js:55`, `src/simulation/LeaperCombat.js:66`, `src/simulation/LeaperHealthBar.js:51`, `src/camera/LeaperPov.js:17`, `tests/browser-combat.js:33-35`
- **What's wrong:** Construction passes `this` everywhere (`new EyeVision(this)`, `new JunkyardBrain(this)`, `new LeaperCombat(this)`, `new LeaperPov(this)`, `new PlayerWeapon(this)`). A grep of the references into the playtest gives:
  - `PlayerWeapon`: target 21, combat 13, cameraController 9, engine 8, simulation 5
  - `LeaperCombat`: engine 8, simulation 7, world 5, target 5, panel 3, plus calls to `stop/reset/start`
  - `JunkyardBrain`: sight 10, world 4

  The AI client moves Lola (`JunkyardBrain.js:135` `this.target.move(a.forward + b.forward, ...)`) and monkey-patches the world's collision function (`JunkyardBrain.js:33` `playtest.world.playerBlocked = (x, z) => {`). The gun assumes exactly one enemy (`enemyMeshes() { const rig = this.p.simulation.rig;`). HUD elements are created with fixed ids (`leaperHealthHud`, `leaperWorldBar`). Tests have to fake this hidden contract (`tests/browser-combat.js:33-35` builds `p = { engine, world, target, cameraController, panel, sight, walking, brain: { ready: true }, simulation, stop(), reset() }`).
- **Why it matters (plain language):** Each piece only works when built in exactly this order around exactly this shared object, so a small change in one place breaks something far away. A second Leaper would move Lola twice per frame (each brain moves her). It would stack collision patches. And the gun could only hit the first robot.
- **What it holds back:** More enemies or bosses, reusing combat in other levels, testing systems on their own, and merging main's `BrainDriver` into this branch.
- **How to fix:** Do this in small, safe steps:
  1. Create `src/simulation/PlayerController.js`, move `JunkyardBrain.js:128-136` (jump plus `target.move`) into its `update(dt)`, and call it first in `JunkyardPlaytest.update`.
  2. In `createJunkyardWorld.js`, return `addPlayerBlocker(fn)` and make `playerBlocked` check the map plus every registered blocker. `JunkyardBrain` then calls `world.addPlayerBlocker(...)` instead of overwriting `world.playerBlocked`.
  3. Create an `Enemy` object `{ rig, animator: LeaperSimulation, brain, combat, healthBar }` and keep `this.enemies = [enemy]`. `PlayerWeapon.enemyMeshes()` then loops over `enemies`.
  4. Give each system a narrow dependency object, e.g. `new LeaperCombat({ scene, rig, player, geometry, camera, events })`, and add a tiny event emitter (`events.emit('leaperDamaged', …)`, `'encounterEnded'`) for the HUD and audio.
  5. Create HUD elements per enemy instead of by fixed id.

  Confirm with `node --test tests/*.test.js` and `tests/browser-combat.html` after each step. The browser-combat fake object should shrink as dependencies narrow.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] No game-flow state machine: about 15 loose flags allow impossible states, and "Paused" only freezes the enemy  `core-loop-no-game-state-machine`
- **Where:** `src/simulation/JunkyardPlaytest.js:15`, `src/simulation/JunkyardPlaytest.js:71-74`, `src/simulation/JunkyardPlaytest.js:154-201`, `src/simulation/JunkyardBrain.js:103-112`, `src/simulation/LeaperCombat.js:77`, `src/simulation/PlayerWeapon.js:148-152`, `src/robot/LolaPlayer.js:397`, `src/camera/CameraController.js:57`, `src/camera/CameraController.js:70-72`
- **What's wrong:** Each button sets its own subset of flags by hand:
  - `start()` checks `if (this.combat?.dead) return;` (line 155). START RUN after an ending is therefore silently ignored.
  - `startPlayer()` (lines 167-174) has no such check. After the encounter ends, START PLAYER captures the mouse and says "Exploring as Lola…", but Lola cannot move (`LolaPlayer.move` returns when `defeated`), the gun is unavailable (`combat.dead`), and the camera no longer updates. Only Escape gets the player out.
  - `JunkyardBrain.fail` has to copy the playtest's state by hand (`this.playtest.walking = false; … querySelector('[data-action=route]').textContent = 'START RUN';`).
  - Escape shows "Paused with Escape…", but it only stops the Leaper. Lola still walks and her gun still fires on a canvas click (`PlayerWeapon.available` does not check any pause flag). The reviewer measured Lola moving `[0.47,0,5.6] → [0.6,0,6]` and the magazine going `20 → 19` while "paused".

  *Correction to the review:* Lola moving and shooting while the Leaper is stopped is intentional. The code says "Lola remains controllable while the Leaper is paused" (`LolaPlayer.js:397`), the brain-loaded message says "left click fires … even while the Leaper run is stopped", and START PLAYER exists to "move and shoot as Lola while the Leaper stays still". The real defect is that Escape *calls* it a pause and there is no true pause at all. Related: losing window focus (alt-tab) deliberately does not stop the run (`CameraController.js:57,70-72`), so the Leaper keeps shooting at a player who has switched windows.
- **Why it matters (plain language):** Players can get into a state where the mouse is captured and nothing responds. "Pause" lets them shoot a frozen Leaper that can't fire back. Every new button has to remember which of about 15 switches to flip, so each change risks a new stuck state.
- **What it holds back:** A real pause menu, victory and defeat screens, a start menu, retries and checkpoints, new game modes, and round or difficulty structure.
- **How to fix:**
  1. Quick fix: add `if (this.combat?.dead) return;` at the top of `startPlayer()`. Make START RUN after an ending show "Encounter over — press RESTART ENCOUNTER".
  2. Proper fix: add `src/game/GameFlow.js` with states `Loading`, `Ready`, `Playing{mode:'run'|'explore'}`, `Paused{resumeTo}` and `Ended{winner}`, and one `dispatch(action)` that uses a transition table (`start`, `explore`, `pause`, `resume`, `end`, `restart`) and notifies listeners. Derive everything else from it instead of storing it: `brain.running = Playing && mode==='run'`; combat is paused unless Playing; `PlayerWeapon.available` and `LolaPlayer.move` require Playing; toolbar labels are rendered from the state. A true pause passes `dt = 0` to gameplay systems while the camera and UI keep updating. Decide explicitly whether focus loss pauses. Then delete `walking` and `playerMode` as separate sources of truth.
  3. Confirm: add a node test with a fake playtest. After `combat.dead`, `startPlayer()` must not call `captureMouse`. In `Paused`, five frames of WASD leave Lola's position unchanged, and a click leaves `ammo[0].mag` unchanged.
- **Effort:** M  ·  **Quick win:** no (the `startPlayer` guard alone is a 1-line quick win)

#### [MEDIUM] The ending is a freeze-frame and the killing shot is invisible: finishing-blow feedback is erased before it is drawn  `core-loop-encounter-end-erases-feedback` (new)
- **Where:** `src/simulation/PlayerWeapon.js:205`, `src/simulation/PlayerWeapon.js:213`, `src/simulation/PlayerWeapon.js:218`, `src/simulation/LeaperCombat.js:102-104`, `src/simulation/LeaperCombat.js:119-123`, `src/simulation/JunkyardPlaytest.js:196-197`, `src/simulation/PlayerWeapon.js:249-257`, `src/simulation/PlayerWeapon.js:285`, `src/simulation/GunshotEffects.js:70`, `src/robot/LolaPlayer.js:510`, `src/simulation/JunkyardBrain.js:139`, `src/simulation/JunkyardBrain.js:168`
- **What's wrong:** In `PlayerWeapon.fire()` the tracer and sparks are created (lines 205 and 213), then `p.combat.damageLeaper(...)` runs (line 218). On the lethal hit that calls `finish()` → `this.playtest.stop(...)` (`LeaperCombat.js:123`) → `this.playerWeapon?.reset()` (`JunkyardPlaytest.js:196`) → `clearEffects()` → `GunshotEffects.clear()`, which removes every effect and zeroes the robot's recoil kick. All of this happens **inside the same `fire()` call, before the frame is drawn**. A harness with the real `PlayerWeapon` and `GunshotEffects` (only the playtest glue faked, mirroring `JunkyardPlaytest.stop` line 196) shows it:
  ```
  normal hit -> fired: true | effects alive after fire(): 7 | scene children: 8
  kill shot  -> fired: true | effects alive after fire(): 0 | scene children: 1 | dead: true
  ```
  The kill-shot camera shake (`LeaperCombat.js:102-103` "A big hit (… or the kill shot) shakes the camera") never plays either, because the camera stops updating once `combat.dead` is true (next finding). Lola's flinch on the fatal laser hit is cancelled at once (`finish()` → `clearHitReaction()`, line 121). After that, everything freezes in mid-pose: `LolaPlayer.move` returns early when `defeated` (line 510), which also stops her animation mixer, and the Leaper's leg animation is skipped (`JunkyardBrain.js:168` `if (this.frame && !encounterOver)`). Everything except the debris and the HUD freezes. The code clearly intended feedback on the kill shot (`PlayerWeapon.js:282` "The blue glow fades even while weapons are unavailable (e.g. on the kill shot)"). Only that blue glow survives. *(This expands the reviewer's "effects are wiped on the next frame". They are actually wiped before they are ever shown.)*
- **Why it matters (plain language):** Killing the Leaper is the goal of the game, and the winning shot shows no tracer, no sparks and no screen shake. You hear it, and the scene just stops. Dying is the same: no flinch, no fall, an instant freeze.
- **What it holds back:** Satisfying finishing blows, death and victory animations, kill-cams or slow-motion finishers, and any "juice" tied to the end of a fight.
- **How to fix:**
  1. In `JunkyardPlaytest.stop()`, stop calling `this.playerWeapon?.reset()` unconditionally. Split `PlayerWeapon.reset()` into `cancelActions()` (trigger, aim, reload, shot animation) and `clearEffects()`, and call only `cancelActions()` from `stop()`.
  2. In `PlayerWeapon.update` (line 285), when the gun is unavailable, still call `this.visuals.update(dt)` so effects fade out naturally, and run `cancelActions()` only on the frame the gun *becomes* unavailable (store `this.wasAvailable`).
  3. Keep the camera updating after the end (next finding), so the shake plays.
  4. In `LolaPlayer.move`, when `defeated`, keep advancing the animation mixer, or play a dedicated defeat clip when one exists, instead of returning before `mixer.update`. In `JunkyardBrain.update`, keep calling the animator with the last pose after the end so the Leaper's legs settle rather than freeze.
  5. Confirm: add a node test based on the harness above. After a lethal `fire()`, `weapon.visuals.items.length > 0`, and after `update(0.3)` it reaches 0. In the game, use DEBUG damage to bring the Leaper to 1 hit, shoot it, and check that the tracer, sparks and shake all show.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] After either side dies the camera stops updating (TOP view breaks, no look-around), because the camera is driven from inside the Leaper's animator  `core-loop-camera-frozen-after-encounter-end`
- **Where:** `src/simulation/LeaperSimulation.js:87`, `src/simulation/LeaperSimulation.js:112`, `src/simulation/JunkyardBrain.js:139`, `src/simulation/JunkyardBrain.js:168-181`, `src/camera/CameraController.js:168-183`, `src/camera/CameraController.js:254-256`
- **What's wrong:** In the junkyard, the only per-frame camera update is inside `LeaperSimulation.updateExternal` (`this.cameraController.update(state, this.rig.eyePivot, deltaTime);`, line 112). `JunkyardBrain` only calls that while the encounter is running (`if (this.frame && !encounterOver)`). A grep confirms there is no other per-frame caller (the only other one is `PlayerWeapon.js:109`, with `dt = 0`, on aim). After a death:
  - mouse look stops;
  - the shake fade, the aim zoom easing and the sun follow all stop;
  - VIEW → TOP changes the field of view (`toggle()` sets `fov 75`) but not the position. The reviewer measured `"mode":"TOP","fov":75,"cam":[0.47,3.58,1.2]`, the same shoulder position as before, so you get a stretched wide-angle shot from behind Lola.
- **Why it matters (plain language):** At the moment of victory or defeat, when the player most wants to look around, the camera is stuck. Switching to the top view gives a broken, stretched shot.
- **What it holds back:** Victory and defeat cameras, kill-cams, post-fight exploration or looting, and any cinematic camera.
- **How to fix:** Delete the `cameraController.update(...)` calls at `LeaperSimulation.js:87` and `:112` (the animator should not know the camera exists). In `src/main.js` `animate()`, right after the mode update (training, playtest or sandbox), call `cameraController.update(simulation.state, rig.eyePivot, deltaTime)` once per frame for **all three** modes, so the sandbox and the training replay keep working. In the junkyard, call it before `pov.update()` (or from a `lateUpdate()` in `JunkyardPlaytest`), with no `combat.dead` check. Confirm: use DEBUG: DAMAGE LEAPER six times, then check that the mouse still turns the camera and that VIEW → TOP shows the map from above. Also check that `?training` and `/` still follow their subject.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The Leaper's speed depends on frame rate and server delay (no fixed timestep for the brain)  `core-loop-brain-cadence-frame-dependent`
- **Where:** `src/simulation/JunkyardBrain.js:10-13`, `src/simulation/JunkyardBrain.js:138-142`, `src/main.js:88`, `src/robot/LolaPlayer.js:522`, `src/simulation/LeaperLegDamage.js:128-130`, `src/simulation/HangingLeg.js:65`
- **What's wrong:** The design intent is stated in the code: "A steady rate keeps the Leaper's speed the same on busy and idle computers" (`LEAPER_STEPS_PER_SECOND = 10`). Two things break it. The scheduler does `if (... this.clock >= 1 / LEAPER_STEPS_PER_SECOND ...) { this.clock = 0;`, which throws away the leftover time. And it never sends a new request while the last one is still waiting. Each server step moves the Leaper a fixed distance, so steps per second *is* its speed. Driving the real `JunkyardBrain` with a fake clock and fake server:
  ```
  30 fps, 40 ms reply: 9.95 steps/s     60 fps, 40 ms reply: 8.55 (9.15 with ±0.1 ms frame jitter)
  144 fps, 40 ms reply: 9.55            120 fps: 9.60
  60 fps, 150 ms reply: 6.25            60 fps, 250 ms reply: 3.80
  ```
  The laser timing runs on real time (`shotInterval: 1.13`), so the balance between how fast the Leaper moves and how often it shoots changes from machine to machine. Each other system substeps on its own clock (Lola `Math.ceil(deltaTime * 120)`, debris `1 / 60`, hanging legs `elapsed * 120`). Main's `BrainDriver` uses a proper accumulator (`STEP_DT = 1 / 30`).
- **Why it matters (plain language):** On a normal 60 Hz monitor the Leaper runs about 8–15% slower than designed. If the brain server is busy it can be 35–60% slower. So difficulty depends on the player's hardware, and tuning numbers don't mean what they say.
- **What it holds back:** Reliable difficulty tuning, fair comparisons between playtests, repeatable replays, and recorded or networked play.
- **How to fix:** Quick fix, in `JunkyardBrain.update` line 142: replace `this.clock = 0;` with `const interval = preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND; this.clock = Math.min(this.clock - interval, interval);`. This keeps leftover time but never more than one step of "debt". Keep `stop()` resetting the clock and keep the mobility scaling on line 138. Better: keep one reply buffered. Request the next step as soon as a reply arrives, play poses back on a fixed 10 Hz timeline (interpolating `previousFrame → frame` by `clock / interval`), and show "BRAIN SLOW" only when the buffer runs dry. Longer term: one fixed-rate gameplay clock in `main.js`. None of this changes how far the policy moves per step, so the frozen recipe is untouched. Confirm: turn the cadence script above into `tests/junkyard-cadence.test.js` (fake `fetch` plus a fake clock). It must report 9.8–10.2 steps/s at 60, 120 and 144 fps with 40 ms replies.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] No explicit frame phases: three modules write the camera, and the floating health bar is placed with last frame's camera rotation  `core-loop-implicit-update-order-stale-camera`
- **Where:** `src/simulation/JunkyardPlaytest.js:291-297`, `src/simulation/LeaperSimulation.js:112`, `src/simulation/PlayerWeapon.js:109`, `src/camera/LeaperPov.js:41-48`, `src/simulation/LeaperCombat.js:247-248`, `src/simulation/LeaperHealthBar.js:104`, `src/camera/CameraController.js:296-325`
- **What's wrong:** The camera is written in three places: `brain.update` → `updateExternal`, `PlayerWeapon.setAiming` (`cameraController.update(..., 0)`), and `LeaperPov.update` (`camera.position.copy(combat.origin); … lookAt`). The health bar is projected inside `combat.update`, before `pov.update`: `this.point.copy(ANCHOR).applyMatrix4(robot.matrixWorld).project(camera);`. The chase branch of `CameraController.update` never refreshes the camera's matrix (only the aiming branch does, line 306). In three r128, `lookAt` refreshes the matrix *before* it applies the new rotation, so `project()` uses the new position with the old rotation. Reproduced with the real `CameraController` and three r128 at 1920×1080:
  ```
  yaw step 0.02 rad (~4 px of mouse): bar drawn -29.0 px off
  yaw step 0.05 rad: -76.9 px      yaw step 0.1 rad: -171.6 px
  ```
  In LEAPER POV mode, the bar uses the previous frame's camera, because `pov.update` runs after `combat.update`.
- **Why it matters (plain language):** The floating Leaper health bar slides away from the robot whenever the player turns the camera, which is exactly when it is on screen during a fight. More generally, nothing says where in the frame new code should run, so every new feature risks being "one frame late".
- **What it holds back:** Damage numbers, nameplates, lock-on markers, any other HUD pinned to the world, and adding systems without one-frame-lag bugs.
- **How to fix:** Quick fix: add `this.camera.updateMatrixWorld();` at the end of every branch of `CameraController.update` (eye view, TOP and chase) and at the end of `LeaperPov.update`. Move the `this.healthBar.update(...)` call (`LeaperCombat.js:247-248`) into a new `LeaperCombat.lateUpdate()`, and call that from `JunkyardPlaytest.update` after `this.pov.update()`. Proper fix: give `JunkyardPlaytest.update` named phases (1 input, 2 player, 3 enemy brains and animators, 4 combat and projectiles, 5 camera with a single owner choosing chase/aim/POV, then update the matrix, 6 world-pinned HUD, 7 render hooks). Confirm: a node test that changes `cameraController.yaw`, calls `update`, projects a point, then calls `camera.updateMatrixWorld()` and projects again. The two results must be equal.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Three game modes are hard-wired into main.js and one shared index.html; the real game is only reachable via ?map=junkyard, and this is the exact merge conflict with main  `core-loop-mode-selection-in-main`
- **Where:** `src/main.js:19-44`, `src/main.js:74-101`, `index.html:12-20`, `index.html:27-79`, `src/styles/junkyard.css:68`, `Start-Leaper.ps1:35`, `src/world/createJunkyardWorld.js:18`, `src/simulation/EyeVision.js:9`, `src/simulation/JunkyardPlaytest.js:146`
- **What's wrong:** `main.js` picks the mode with nested ternaries: `world = trainingMode ? createTrainingWorld(engine.scene) : junkyardMode ? await createJunkyardWorld(engine.scene) : createWorld(engine.scene);`. The loop is also mode-specific: `Math.min(junkyardMode ? 0.1 : 0.033, …)` and `playtest?.pov.beforeRender()`. The plain address `/` opens the legacy sandbox, whose help text still says "P SELECT PINK CUBOID · I J K L MOVE IT". The launcher prints `Game: http://127.0.0.1:4175/?map=junkyard`. Page-address settings are read in four modules (`main.js`, `createJunkyardWorld.js:18`, `EyeVision.js:9`, `JunkyardPlaytest.js:146`). A trial merge conflicts in `src/main.js`: main's `const brainMode = !trainingMode && !freeRoam; // the live-brain game is the default` against this branch's `const junkyardMode = …`.
- **Why it matters (plain language):** Someone opening the game's main address sees an old prototype, not the game. Every new mode adds more branches to one crowded file, and both branches of the project are editing the same lines.
- **What it holds back:** Merging this branch with main (main's brain arena plus this branch's junkyard), adding modes (tutorial, horde, second map), and a clean web entry point.
- **How to fix:** Create `src/modes/` with `sandbox.js`, `training.js` and `junkyard.js` (and, after the merge, main's brain arena). Each exports `async start(engine, settings)` and returns `{ update(dt), beforeRender(), afterRender(), dispose() }`. `main.js` parses the address once into a frozen `settings` object (`{ mode, width, vision, run, debug }`), picks the mode (default `junkyard`, if the owner agrees), runs the loop and calls the hooks. Pass `settings` into `createJunkyardWorld`, `EyeVision` and `JunkyardPlaytest` instead of having them read `location.search`. Each mode creates its own HUD DOM instead of overwriting the shared `index.html`. The `main.js` conflict then becomes two separate new files. Confirm: `/` opens the junkyard, `/?mode=sandbox` and `/?training` still work, and `git merge-tree --write-tree main HEAD` no longer conflicts in `src/main.js` once main's mode is moved the same way.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] No lifecycle or teardown: nothing can be unloaded, so changing the Leaper size reloads the whole page  `core-loop-no-lifecycle-reload-to-resize`
- **Where:** `src/simulation/JunkyardPlaytest.js:81-89`, `src/world/createJunkyardWorld.js:18-21`, `src/robot/LolaPlayer.js:90`, `src/simulation/PlayerWeapon.js:45`, `src/simulation/JunkyardPlaytest.js:115-121`, `rl/junkyard_server.py:163-164`
- **What's wrong:** APPLY SIZE builds a new address and calls `location.assign(url);`. The size becomes the map scale once (`const scale = BODY_COLLISION_RADIUS * 2 / width;`), and that scale is baked into objects when they are built: `this.height = 1.9 * world.scale * ENCOUNTER.lolaHeight;`, `new GunshotEffects(playtest.engine.scene, playtest.world.scale)`, camera far and fog `… * world.scale`. The world scale is read in about 8 modules. `grep removeEventListener src` → 0 matches, against 61 `addEventListener` calls. The reviewer's listener census found 32 window and 3 document listeners after boot. No subsystem has a `dispose()`; only local cleanup exists (the clearance overlay in `makeOverlay`, gun effects, leg debris). The server repeats the scale formula (`7.98 / width`).
  *Corrections to the review:* "No teardown anywhere" is overstated, because the local disposal above exists. "Re-downloads about 20 MB" is overstated too, since the browser cache serves or revalidates most assets on reload; the real cost is the 2–4 s boot and re-parse. And a size change needs a fresh brain session and encounter anyway, so losing the fight in progress is expected.
- **Why it matters (plain language):** Today this mainly makes size tuning slow (a full reload per try). The bigger issue is that nothing can be unloaded, so the game cannot go back to a menu, load a second map, or restart cleanly without refreshing the page.
- **What it holds back:** Multiple levels, a main menu and level select, in-game difficulty or size options, quick encounter iteration, and embedding the game in a larger page.
- **How to fix:**
  1. Create one `AbortController` per game session (`const session = new AbortController()`), pass `session.signal` into every constructor, and register every listener with `{ signal }`. A single `session.abort()` then removes them all.
  2. Add `src/core/disposeObject3D.js` (walks a subtree and disposes geometries, materials and textures). Make `createJunkyardWorld` return `{ …world, dispose }`, and give `JunkyardPlaytest`, `LeaperCombat`, `PlayerWeapon`, `LolaPlayer` and `LeaperPov` a `dispose()` that removes their DOM nodes and scene objects.
  3. With that in place, APPLY SIZE becomes `await game.restart({ width })`, which disposes and rebuilds the world, Lola and effects. Keep the current "scale the map around a fixed-size robot" approach, because the brain's units depend on it (frozen recipe).
  4. Confirm: call restart 10 times. `renderer.info.memory.geometries` and `textures` must return to their first values, and `getEventListeners(window)` in Chrome DevTools must show a constant count.

  Short term, the size slider can move behind `?debug`, with the shipping size fixed at `ENCOUNTER.startWidth` (5.5).
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] The shadow-casting sun follows the Leaper, not the player, so most of the arena has no shadows; the map recolours every existing light  `core-loop-sun-and-lights-owned-by-wrong-modules`
- **Where:** `src/simulation/LeaperSimulation.js:88-89`, `src/simulation/LeaperSimulation.js:113-114`, `src/core/createScene.js:31-34`, `src/world/createJunkyardWorld.js:71-77`, `src/main.js:45`, `src/camera/CameraController.js:181`, `src/simulation/JunkyardPlaytest.js:120-121`
- **What's wrong:** `updateExternal` sets `this.sun.position.set(state.position.x + 8, 15, state.position.z + 6); this.sun.target.position.set(state.position.x, 0, state.position.z);`, where `state` is the *Leaper*. This made sense in the original sandbox, where the robot was the character being followed. The shadow box is ±13 units (`createScene.js:31-34`), giving a ground footprint of roughly 26 × 31 units around the Leaper. The arena is about 70.5 × 66 units at the default size (`collision.json` bounds 48.6 × 45.5 × scale 1.451). The reviewer measured only 29% of the clear floor inside the shadow box. Meanwhile the Leaper's laser reaches about 32 units, so Lola is often fighting outside the shadowed area. Separately, `createJunkyardWorld` recolours *every* light already in the scene (`scene.traverse(... object.color.setHex(0xffffff))`). The Leaper's red eye light survives only because `createHexapod` happens to run later (`main.js:45`). Fog is set in three places (`createScene`, `JunkyardPlaytest.js:120-121`, `CameraController.toggle` line 181).
- **Why it matters (plain language):** When Lola is away from the Leaper, she and the cover around her lose their shadows, and shadows pop on and off as the Leaper walks. Swapping two lines of start-up code would silently turn the Leaper's red eye white.
- **What it holds back:** Bigger or extra maps, per-level lighting and art direction, time-of-day variants, and the eventual three.js upgrade.
- **How to fix:** Remove the sun lines from `LeaperSimulation.update` and `updateExternal`. In the junkyard (from the camera or late phase in `JunkyardPlaytest.update`, or from `main.js` after the camera update), centre the sun on Lola: `sun.position.set(p.x + 8 * s, 15 * s, p.z + 6 * s); sun.target.position.set(p.x, 0, p.z);` with `p = target.mesh.position` and `s = world.scale`, scaling the shadow camera bounds to match. Keep the sandbox behaviour (following the robot) in the sandbox mode. Make `createJunkyardWorld` return an `environment` description (`{ background, fog, hemisphere, sun }`) that `main.js` or the mode applies to the lights `createScene` made, instead of traversing whatever lights exist. Move the TOP-view fog tweak into that same environment config. Confirm: walk Lola 30 units away from a stationary Leaper. Her shadow and nearby cover shadows must stay, and the Leaper's eye must still glow red.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Movement and attacks use two separate "can I see Lola?" checks with different ranges; the Leaper can shoot beyond the distance its brain can see  `core-loop-two-perception-authorities`
- **Where:** `src/simulation/LeaperCombat.js:202-207`, `src/config/combat.js:4`, `src/config/combat.js:10`, `rl/checkpoint_environment.py:23`, `rl/checkpoint_environment.py:38-39`, `rl/junkyard_env.py:88-89`, `src/simulation/JunkyardBrain.js:182-185`
- **What's wrong:** The client attack AI uses `const range = c.weaponRange * p.world.scale; … delta.length() <= range && Math.abs(wrapped) <= c.detectionHalfAngle && this.geometry.clear(this.origin, point)` (weapon range 22, scaled with the map, on the *rendered* pose). The server brain uses `RAY_MAX_RANGE = 28.0`, `VISION_FOV = radians(270)` and `TARGET_RADIUS = 1.4` (`norm(delta) - TARGET_RADIUS <= RAY_MAX_RANGE`, *not* scaled, on the server pose). Both work in the same world units. So the laser reach vs brain sight is 31.9 vs 29.4 at the default width 5.5, but 58.5 vs 29.4 at width 3 and about 146 vs 29.4 at the slider minimum of 1.2. The HUD movement label comes from `frame.target_visible`, independently of the attack tree's state. At the default size the mismatch is a narrow band of about 2.5 units, and it grows quickly as the Leaper is made smaller.
- **Why it matters (plain language):** The Leaper can be "SEARCHING" while its laser locks on and fires, which reads as unfair and confusing. Tuning how far it sees means editing a JavaScript number and a Python number that drift apart whenever the size changes.
- **What it holds back:** Designer tuning of awareness and stealth, readable enemy warnings, and consistent behaviour when the size or the map changes.
- **How to fix:** The server's sight values are part of the frozen brain recipe and must not change. Instead, make the attack side follow them:
  1. Have the server include `sight_range: RAY_MAX_RANGE + TARGET_RADIUS` (and the FOV) in its reset reply, or put them in a shared JSON like `eye-vision.json`.
  2. In `LeaperCombat.update`, clamp `range = Math.min(c.weaponRange * p.world.scale, brain.sightRange)`.
  3. Optionally require `p.brain.frame?.target_visible` (or `sight.clear`) before starting a new attack, keeping the client ray only for the precise lock and line-of-fire check.

  Confirm: at width 3, stand in clear view 40 units from the Leaper. It must not fire, and its label must agree with its attack state.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] No vite.config.js and no test script: the brain's port allow-list breaks whenever Vite picks another port, and the 4 failing tests go unnoticed  `core-loop-dev-config-ports-scripts`
- **Where:** `package.json:10-14`, `rl/junkyard_server.py:98`, `rl/junkyard_server.py:148-149`, `src/simulation/JunkyardBrain.js:55`, `tests/lola-player.test.js`
- **What's wrong:** `ls vite.config*` → `No such file or directory`. The server only answers pages from `origins = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (4173, 4175, 5173, 5175)}` and otherwise replies `403 {"error": "Local junkyard viewer required"}` (with no permission header, so the browser reports "Failed to fetch"). Without `server.strictPort`, `pnpm dev` silently moves to 5174 when 5173 is busy, and every brain call then fails. The README's dev instructions use `pnpm dev`; only the Windows launcher pins its own port (4175). `package.json` has only `dev`/`build`/`preview` scripts, and 4 of 69 node tests (all in `tests/lola-player.test.js`) currently fail. The 695 KB single-chunk warning has no chunk split configured.
- **Why it matters (plain language):** A second dev server, or another app on 5173, turns the Leaper into a statue with a confusing message. Regressions in Lola's movement have already slipped in because nothing runs the tests.
- **What it holds back:** Onboarding other developers, CI, and confident refactoring of the loop and game-flow code.
- **How to fix:** Add `vite.config.js`: `export default { server: { port: 5173, strictPort: true }, preview: { port: 4173, strictPort: true }, build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } } }`. Read the brain URL from `import.meta.env.VITE_BRAIN_URL ?? 'http://127.0.0.1:8767'`, and let the server accept an `--allow-origin` list (this is network plumbing and doesn't touch the brain). Add `"test": "node --test tests/*.test.js"` to `package.json`, then fix the 4 failing Lola tests, or mark them `todo` with a note, so `pnpm test` is green. Confirm: with something already on 5173, `pnpm dev` stops with a clear "port in use" error instead of moving, and `pnpm test` exits 0.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Input is handled by five modules with their own listeners; legacy keys still move Lola, focused form controls are hijacked, and touch has no fire or aim  `core-loop-input-scattered`
- **Where:** `src/controls/InputController.js:8-15`, `src/controls/InputController.js:33-35`, `src/controls/InputController.js:111-116`, `src/simulation/JunkyardBrain.js:133-136`, `src/robot/LolaPlayer.js:161-173`, `src/simulation/PlayerWeapon.js:75-89`, `src/camera/CameraController.js:51-56`, `index.html:81-85`
- **What's wrong:** Key and mouse handling is spread across modules:
  - `InputController`: WASD, arrows, Space and P on `window`, and it calls `preventDefault()` on Space and the arrow keys even when the size slider or a dropdown has focus, so those controls can't be used from the keyboard and Lola moves instead.
  - `LolaPlayer`: C, 1 and 2. It is the only one that ignores `INPUT|TEXTAREA|SELECT` targets.
  - `PlayerWeapon`: mouse buttons, R and Escape.
  - `CameraController`: Escape and the mouse wheel.

  `JunkyardBrain` adds the old pink-cuboid IJKL keys into Lola's movement (`this.target.move(a.forward + b.forward, a.side + b.side, …)`). The README documents this, but it is a leftover of the sandbox. Touch controls turn on for coarse pointers, but `#touch` only has a joystick, SPRINT and JUMP: there is no fire, aim or reload button. There is no gamepad support.
- **Why it matters (plain language):** Changing a key, adding a controller, or blocking input during a menu means editing five files. Phone and tablet players can walk but cannot fight.
- **What it holds back:** Gamepad support, key rebinding and accessibility, a mobile or web release, and blocking input in pause and menus.
- **How to fix:**
  1. Quick fix: in `InputController`'s keydown handler, return early for `/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)` (copy `LolaPlayer.js:164`), and stop adding `getTargetMovement()` in junkyard mode (update the README line about IJKL).
  2. Proper fix: make `InputController` action-based. Put a bindings table in `src/config/input.js` (`moveForward: ['KeyW','ArrowUp'], fire: ['Mouse0'], aim: ['Mouse2'], crouch: ['KeyC'], reload: ['KeyR'], weapon1: ['Digit1'], …`) with `isDown(action)` and `pressed(action)` (edge-triggered once per frame), poll `navigator.getGamepads()`, and add touch FIRE/AIM/RELOAD buttons. Systems read actions in their `update()` instead of adding listeners, and all input is gated by the game-flow state.
  3. Confirm: focus the size slider and press the arrow keys. The slider moves and Lola doesn't.
- **Effort:** M  ·  **Quick win:** no (the form-control and IJKL fix alone is a quick win)

#### [MEDIUM] Developer tools and player UI share one panel, and the controls help and brain-error instructions are hidden by default  `core-loop-feedback-hidden-dev-ui`
- **Where:** `src/simulation/JunkyardPlaytest.js:20-49`, `src/simulation/JunkyardPlaytest.js:75`, `src/simulation/JunkyardPlaytest.js:100-102`, `src/styles/junkyard.css:68`, `src/simulation/LeaperCombat.js:51`, `src/simulation/LeaperCombat.js:67-71`, `src/simulation/JunkyardBrain.js:109-111`, `src/camera/LeaperPov.js:11`
- **What's wrong:** The panel's HTML mixes START RUN and START PLAYER with the vision mode, the size slider and the clearance overlay. The status message `<p data-message>` sits inside `<div id="junkyardOptions" hidden>`. `LeaperCombat` appends "DEBUG: DAMAGE LEAPER" (100 damage, so 6 clicks kill the Leaper) to the same options. The controls help that `JunkyardPlaytest.js:75` writes into `.keys` is never visible, because `.junkyard-mode .hud { display: none; }` (`junkyard.css:68`). The reviewer's headless check found `message` and `keysHelp` both not visible. When the brain is offline, the visible label says `BRAIN OFFLINE — START RUN TO RETRY`, while the hidden message gives the actual instructions and contradicts it ("Start the local brain service, then press Reset"). The code itself has to click OPTIONS to show a spawn error (lines 100-102). Combat and POV insert their buttons into `.junkyard-toolbar` with `querySelector`.
- **Why it matters (plain language):** Players never see the controls or the instructions for fixing a missing brain. And a cheat button that kills the boss is sitting in the player's options.
- **What it holds back:** A shippable player HUD, a designer reskin of the UI, release builds without cheats, and onboarding new players.
- **How to fix:** Quick win:
  1. Move `<p data-message>` out of `#junkyardOptions` into the always-visible toolbar area.
  2. Show the controls in junkyard mode, either by adding `.junkyard-mode .hud { display: block }` for `.keys` only or by putting a compact "CONTROLS" line in the toolbar.
  3. Create the DEBUG: DAMAGE LEAPER button only when `new URLSearchParams(location.search).has('debug') || import.meta.env.DEV`.
  4. Make the offline label and message give the same instruction.

  Later, split a `DevPanel` (vision mode, clearance, size, debug damage) from a `GameHud` (start prompt, controls help, status and error toast, encounter result). Confirm: open `/?map=junkyard` without `?debug`. The controls and status are visible and no DEBUG button exists.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Boot loads the map and then Lola one after the other, and an error inside the frame loop has no guard or message  `core-loop-boot-sequential-no-progress`
- **Where:** `src/main.js:22-44`, `src/main.js:86-101`, `src/robot/LolaPlayer.js:65-76`, `src/simulation/LaserAudio.js:42-47`, `src/core/createScene.js:3-14`
- **What's wrong:** `world = … await createJunkyardWorld(engine.scene)` runs first, and only then `await LolaPlayer.create(...)`. Yet `LolaPlayer.create` only needs `world` for the constructor, not for downloading. The reviewer's network trace (emulated 50 Mbit/s): map GLB 0.37–1.19 s, all 14 Lola files start at 1.65 s, first brain status at 3.54 s. The total payload is about 20 MB, including a 4.5 MB `lola-walk.wav` that `LaserAudio` fetches eagerly (in the background, after Lola). `animate()` calls `requestAnimationFrame` first and has no try/catch, so a runtime error repeats every frame with nothing on screen. If the error happens in the render step, the after-render restores are also skipped. `createScene` has no `webglcontextlost` handler.
  *Correction to the review:* on a bandwidth-limited connection, parallel downloads share the same pipe. The real saving is overlapping Lola's downloads with the map's parse and navigation-grid build (the 1.19 → 1.65 s gap) plus request latency, roughly half a second. That is why this is low, not medium. A status line and a load-failure message do exist.
- **Why it matters (plain language):** Loading is a little slower than it needs to be. More importantly, if something breaks mid-game the screen just freezes with no message, which makes playtester bug reports hard to act on.
- **What it holds back:** A polished first impression, a web release on slower connections, and diagnosing playtester bug reports.
- **How to fix:** Split `LolaPlayer.create` into `LolaPlayer.load()` (returns the `Promise.all` of GLTFs) and `LolaPlayer.fromAssets(scene, world, toggle, assets)`. In `main.js`, start `const lolaAssets = junkyardMode ? LolaPlayer.load() : null;` before awaiting the map. Optionally drive a progress bar through a shared `THREE.LoadingManager`. Wrap the body of `animate()` in `try { … } catch (e) { showErrorOverlay(e); } finally { /* run afterRender hooks */ }` and stop the loop after repeated errors. Add a `webglcontextlost` listener that shows "Graphics reset — reload". Confirm: in the DevTools Network panel, the Lola GLBs start alongside `junkyard.glb`. Throwing inside `playtest.update` from the console shows the overlay.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Three.js is pinned to 0.128.0 (2021); one authored material setting is ignored, and the eventual upgrade crosses colour and lighting changes  `core-loop-three-r128-pin`
- **Where:** `package.json:16`, `src/core/createScene.js:9`, `src/world/createJunkyardWorld.js:46-47`, `src/core/createScene.js:26-42`
- **What's wrong:** `"three": "0.128.0"`, and `npm view three version` → `0.186.1`. `junkyard.glb` lists `extensionsUsed: ['KHR_materials_specular']`, which the r128 `GLTFLoader` doesn't support (`grep -c KHR_materials_specular GLTFLoader.js` → 0). The upgrade will hit `renderer.outputEncoding = THREE.sRGBEncoding` (removed in r162), `new THREE.Color(...).convertSRGBToLinear()` (double conversion under r152 colour management), and light intensities and decay (r155 physically-correct lighting).
  *Corrections to the review:* only that single extension is ignored. Base colours, roughness, metalness and textures all load. All 14 materials that use it set `specularFactor: 0` with the default roughness of 1.0, so the visible difference is only a faint extra highlight, not "materials silently dropped". r128 already ships `examples/jsm/csm/CSM.js`, `KTX2Loader` and the meshopt decoder, so the pin does not block cascaded shadows or compressed assets. Main pins the same version, so this is not a merge problem.
- **Why it matters (plain language):** The renderer is old. It works, but newer examples, fixes and Blender material features can't be used, and the longer the upgrade waits, the bigger the jump.
- **What it holds back:** Current documentation and examples, newer glTF material features, and WebGPU.
- **How to fix:** Do it after the merge with main, in stages, using `tests/browser-*.html` plus screenshots as a visual baseline:
  1. r128 → r151 (mostly drop-in; check `GLTFLoader` and `AnimationMixer` use);
  2. r152: replace `outputEncoding` with `renderer.outputColorSpace = THREE.SRGBColorSpace`, delete the `convertSRGBToLinear()` calls, and set `texture.colorSpace` where needed;
  3. r155+: retune the hemisphere, sun and point-light intensities (roughly ×π for the directional and hemisphere lights) and the PointLight distance/decay;
  4. latest.

  Confirm by comparing screenshots at each stage.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] LeaperSimulation mixes five jobs in one class (sandbox controller, pose follower, gait/IK animator, camera driver, status writer) and allocates in the IK every frame  `core-loop-leapersim-mixed-roles`
- **Where:** `src/simulation/LeaperSimulation.js:53-91`, `src/simulation/LeaperSimulation.js:93-119`, `src/simulation/LeaperSimulation.js:340-402`, `src/simulation/JunkyardBrain.js:132-134`
- **What's wrong:** `update()` reads the keyboard, moves the pink target and jumps; it is sandbox only and never called in the junkyard. `updateExternal()` follows server poses. Both drive the camera, move `this.sun` and write `this.statusElement.textContent`. `JunkyardBrain` borrows the class's heading maths and scratch vectors (`sim.cameraController.getMovementHeading(sim.state.yaw)`, `sim.v[0]`). `solveAndPlace` creates 10 `new THREE.Vector3()`, plus 1 per `placeSegment` (4 calls), per leg per frame: about 84 throwaway objects per frame for 6 legs, despite the preallocated `this.v` pool.
- **Why it matters (plain language):** The Leaper's walking animation can't be reused for a second Leaper or a cutscene without also dragging the camera and the sun along with it. The garbage it creates every frame adds small, avoidable hitches.
- **What it holds back:** Multiple Leapers, scripted or cinematic Leaper motion, and reuse in main's brain arena after the merge.
- **How to fix:** Split it into `LeaperAnimator.update(pose, velocity, dt)` (body, gait and IK only) and a `KeyboardLeaperController` used only by the sandbox mode. Move the camera, sun and status writes to the orchestrator (see the camera and sun findings). In `solveAndPlace`/`placeSegment`, reuse module-level scratch vectors (`const _anchor = new THREE.Vector3()` etc.) instead of `new`. Confirm: `tests/leaper-leg-damage.test.js` still passes, and a Chrome performance recording shows fewer minor garbage collections while the Leaper walks.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Restart leftovers: ammo survives a restart, the gun is reset every frame while unavailable, and dead non-player code paths remain  `core-loop-restart-stale-state`
- **Where:** `src/simulation/PlayerWeapon.js:51-54`, `src/simulation/PlayerWeapon.js:249-260`, `src/simulation/PlayerWeapon.js:285`, `src/simulation/LeaperCombat.js:66`, `src/simulation/JunkyardPlaytest.js:60`, `src/simulation/JunkyardPlaytest.js:122`, `src/simulation/JunkyardBrain.js:31`, `src/camera/LeaperPov.js:17`
- **What's wrong:** Ammo is set only in the constructor (`this.ammo = [{ mag: PLAYER_WEAPON.m416.magazine, … }]`). `PlayerWeapon.reset()` never refills it, and RESTART ENCOUNTER runs `playtest.reset(); playtest.start();`, so a new fight can start with a half-empty magazine. `if (!this.available) { this.reset(); return; }` runs on *every* frame the gun is unavailable (TOP view, POV, after the ending), which repeatedly cancels the shot, aim and reload and wipes effects (see the ending finding for the visible consequence). `this.sight = target.isPlayer ? new EyeVision(this) : null` and `if (!target.isPlayer) this.topView();` can't be reached, because the junkyard always uses Lola, and that path would crash at `LeaperPov.js:17` (`playtest.sight.lines`).
  *Correction to the review:* the 'sense' polling while stopped is intentional. It keeps the always-visible sight-status label live (`EyeVision.show`), and the server marks it "Preview while paused: no policy, movement, or memory update". At 10 local requests per second it is harmless.
- **Why it matters (plain language):** A fresh round can start with less ammo than expected, and the leftover "maybe it's not Lola" code confuses anyone extending the game.
- **What it holds back:** A clean "new round" flow and readable orchestration code.
- **How to fix:** Add `PlayerWeapon.resetEncounter()`, which refills every `ammo[i].mag` to its weapon's `magazine` and calls `cancelActions()`, and call it from `JunkyardPlaytest.reset()`. Change `PlayerWeapon.update` to cancel only on the available → unavailable transition (see the ending finding). Delete the `!target.isPlayer` branches in `JunkyardPlaytest` (lines 60, 122) and the `if (this.target.isPlayer)` wrapper in `JunkyardBrain` (line 31). Confirm: fire 10 rounds, press RESTART ENCOUNTER, and check that the ammo icon is full.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None of the reviewer's findings was refuted outright. These sub-claims were dropped or corrected during verification:
- "Shooting a frozen Leaper while paused is free damage (a bug)": Lola moving and firing while the Leaper is stopped is documented, intended behaviour (`LolaPlayer.js:397`, the brain-loaded message, START PLAYER). The real defect is that Escape calls it a pause (kept, at medium).
- "Preview 'sense' polling never stops": intentional, because it keeps the visible sight-status label live.
- "r128 silently drops authored map materials / blocks CSM": only `KHR_materials_specular` (all `specularFactor: 0`) is ignored, and CSM, KTX2 and meshopt already exist in r128.
- "APPLY SIZE re-downloads ~20 MB and loses the encounter": cached assets are reused or revalidated, and a size change needs a fresh encounter anyway.
- "Sequential boot costs seconds on real connections": on a bandwidth-limited link the saving is about half a second, so it was downgraded to low.
- "Gun effects are deleted on the next frame": they are deleted before they are ever drawn (moved to the new ending finding).

### Lola player controller, animation & input

**How it works today**

Almost all of Lola lives in one 704-line class, `src/robot/LolaPlayer.js`, helped by `src/robot/footstepContacts.js` (foot measurement done when the game loads) and `src/config/encounter.js` (7 artist values). That one class does a lot:
- loads 14 GLB files
- runs one animation mixer per outfit (7 locomotion clips, Shoot/CrouchShoot plus upper-body copies of them, 5 authored jumps and an upper-body reload)
- picks the clip, smooths the input and moves Lola from measured stride data
- tests map collision, handles jumps and crouch
- switches weapons by swapping two whole outfit models
- plays the hit flinch and footsteps
- works out eye and muzzle positions
- writes the HUD button text and listens for the C, 1 and 2 keys itself

`main.js` only creates Lola with `?map=junkyard`.

Each frame (capped at 0.1 s), `JunkyardBrain.update` calls `target.jump()` when a buffered Space press is waiting, then calls `target.move(...)`. `move()` eases the input once per frame. It then runs sub-steps of 1/120 s or less. Each sub-step:
- turns Lola toward the camera heading
- picks one clip (Idle, Run, StrafeLeft/Right, CrouchIdle/CrouchWalk; Walk is never picked)
- advances the jump and reload timers
- cross-fades the clips of **both** outfits
- moves Lola in steps of at most 0.08 units, testing the x and z axes separately against `world.playerBlocked`
- updates both mixers, with weights juggled before and after the update for the shot, jump and reload layers

Other systems call into Lola or change her fields directly:
- `PlayerWeapon` (fire, aim, reload, muzzle)
- `LeaperCombat` (hits, `defeated`)
- `CameraController` (eye position)
- `EyeVision` (bones)

Input is split across `InputController`, `LolaPlayer`, `PlayerWeapon` and `CameraController`.

Assets come from Blender files on the owner's PC through `scripts/export_lola.py`, `scripts/export_lola_clips.py` and `scripts/measure_lola_steps.mjs`. The tests load the real GLBs in Node.

**What's good**
- **Stride-matched movement.** Travel speed comes from foot travel measured in the clips, and `strideMatch()` sets each clip's playback rate so the planted boot keeps pace. Planted-toe slip is about 0.22 units/s at a 2.61 units/s run (about 9%) and 0.07 units/s on a pure strafe. This is close to Unreal-style distance matching.
- **Deterministic measurement pipeline.** Regenerating `stride-profiles.json` reproduces the committed distances and floor offsets exactly.
- **Measured foot contacts.** Contacts, footstep timing, the foot-lift curve and running-jump landings are measured from the real skeleton at load. Footstep audio follows real foot contacts, and reverse playback works without hand-placed events.
- **Running jumps.** Lola picks the clip whose take-off foot matches the current run phase and hands back to the run on a frame with the same boot planted (at most 1 skating frame). Jump timing holds across frame rates: standing jump 1.400 s and running jump 0.600 s at both 30 and 60 fps (verified).
- **Sub-stepping.** Movement and collision sub-steps (1/120 s or less, steps of 0.08 units or less) stop Lola tunnelling through thin walls on slow frames.
- **Pop-free locomotion switches.** Clips switch with phase preserved and continuous weight cross-fades, so run, strafe and crouch change without pops.
- **Reload layering.** The upper-body reload is done properly. It corrects for the mixer's weight normalisation (`w·L/(1−w)`) and re-attaches the arms to the moving chest, so Lola can run while reloading. (Shooting on the move does not get this treatment yet; see the first finding.)
- **Directional hit flinch.** The flinch stores the incoming direction in world space and is tested from 4 directions at 4 headings, standing and crouched.
- **Real-asset tests.** 14 Node tests run on the real exported skeletons in about 5 s. That is a rare safety net for animation code.
- **Input basics.** Input uses `event.code` (works by key position on AZERTY), clears held keys on window blur and ignores key repeat for toggles. The C/1/2 keys ignore form fields, and the touch joystick is analog.
- **Comments.** Tuning constants have plain-language comments (for example `LOLA_INPUT_RESPONSE`: "Higher feels snappier, lower feels floatier").

**How professional game projects handle this**

Unity and Unreal projects split this job into separate parts:
1. An **input layer** (Input System / Enhanced Input) with named actions, rebinding, gamepad and touch, and on-screen prompts generated from the bindings.
2. A **character movement component**: a capsule with collide-and-slide along wall normals, step offset, slope limit, ground probing, coyote time, and a jump buffer that survives until the jump can start.
3. An **animation graph**: an explicit state machine (Locomotion, Jump, Reload, HitReact, Dead), a 2D blend space for 8-way movement, upper-body layers with bone masks, additive layers for hit reactions and aim offsets, and animation events for footsteps.
4. A **weapon system**: weapon data assets, weapon meshes attached to a hand socket on one skeleton, and a clip set per weapon.
5. **Designer tuning** kept in data assets rather than code.
6. A **reproducible export pipeline**: source files in version control (often Git LFS) and command-line exports.

Leaper's measured stride and foot-contact system is ahead of most prototypes. The rest is merged into one 176-line `moveStep` with cyclomatic complexity 90:
- action rules are implicit boolean checks
- layers are faked with regex track filters and weight tricks
- weapons are duplicated characters
- the skeleton is flat (arms are not children of the spine)
- collision is axis-by-axis
- input is spread over four classes with no gamepad
- the Blender sources are not in the repository

**Findings**

#### [HIGH] Running while shooting looks broken: hands come off the gun, legs flicker on every automatic shot, and legs snap when starting or stopping  `player-run-and-shoot-pose`
- **Where:** src/robot/LolaPlayer.js:340-355 (`startShot`), src/robot/LolaPlayer.js:641-654 (full-body/upper-body swap), src/robot/LolaPlayer.js:660-664 and 679 (weights around `mixer.update`), src/simulation/PlayerWeapon.js:189 and 300-302 (automatic fire runs after `move()`), src/simulation/JunkyardPlaytest.js:292-295 (frame order)
- **What's wrong:** Commit 9b384c9 added an upper-body version of the shot so Lola can run and fire. The upper-body shot plays at weight 1 on top of locomotion that also has weight 1, and three.js averages the two. The reload code already corrects for this (`reloadWeight * locomotion / (1 - reloadWeight)`); the shot code does not. Probe (hand to nearest gun vertex, 60 fps, aim pose held for 1 s):
  ```
  M416   STANDING  right 2.8 cm  left  8.3 cm
  M416   RUNNING   right 5.3 cm  left 30.2 cm
  pistol STANDING  right 4.1 cm  left  4.7 cm
  pistol RUNNING   right 35.2 cm left 38.6 cm
  ```
  With the shot weight raised to `1000 × locomotion` (the same trick the reload uses), the running numbers become identical to the standing ones (2.8/8.3 and 4.1/4.7 cm). The commit before (d0dc868) had no upper-body shot and no gap.

  There are two more problems:
  - **Leg flicker on automatic fire.** In the game loop, `move()` runs first. `PlayerWeapon.update` then fires the M416 automatically, and `startShot()` zeroes the locomotion weights and calls `mixer.update(0)`. So every automatic shot fired while running is rendered with the full-body standing-shot legs for one frame. Probe: one-frame foot jump of 21 cm on shot frames and up to 43 cm on the frame after, against 4 cm normally. That is 7 flickers a second.
  - **Leg snap on start/stop.** The swap between the full-body and upper-body shot (`previous.stop(); action.reset()...`) is instant. Starting to move after a shot snaps the legs 24 cm in one frame, and stopping snaps them 46 cm (5-6 cm without a shot). The shot pose stays up for 1.44 s after every hip-fire shot.
- **Why it matters (plain language):** Running and shooting from the hip is the core of the fight. Right now the pistol floats about a forearm's length away from Lola's hands, her legs twitch with every rifle round, and her legs jump when she starts or stops after firing. (In right-click aim view Lola is hidden, so it only shows in the normal third-person view, which is exactly where players hip-fire.)
- **What it holds back:** Convincing combat feel, any future moves that use upper-body layers (melee, grenade, interact), and trust in the "run while firing" feature.
- **How to fix:** All in `LolaPlayer.js`:
  1. **Correct the weight like the reload does.** Just before `outfit.mixer.update(deltaTime)` (line 679), when `shot?.upperOnly`, set
     ```js
     const L = Object.values(outfit.actions).reduce((t, a) => t + a.getEffectiveWeight(), 0) || 1;
     shot.action.setEffectiveWeight(1000 * L);
     ```
     Better still, move both the shot and the reload onto one shared "upper-body layer" helper.
  2. **Stop the auto-fire flicker.** In `moveStep`, store `this.lastMoved = moved`. In `startShot`, when `this.lastMoved > 1e-7`, start the `shootingUpper` action directly and skip zeroing the locomotion weights before `mixer.update(0)`.
  3. **Cross-fade instead of swapping.** Keep `shot.legWeight`, easing it toward `moving ? 0 : 1` at about 12/s. Play both shot variants in sync, give the full-body one weight `legWeight`, and scale the locomotion weights by `1 - legWeight`.
  4. **Follow-up.** With the shot at full weight, the root-level arms come from the upright shot clip. If they poke through the shirt while running, apply the reload's `attachReloadArms` treatment to the shot as well (or fix the skeleton, see below).

  **Confirm:** add two Node tests to `tests/lola-player.test.js`:
  - "running while aiming keeps both hands within 10 cm of the gun" (port the probe in `attachments/probes/handgun.mjs`)
  - "automatic fire while running causes no one-frame foot jump over 10 cm", calling `move()` and then `startShot()` each frame like the game does (see `probes/autofire.mjs` and `probes/aimpop.mjs` in the same folder)

  Then hip-fire the M416 while circling in the junkyard. This does not touch the brain.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] Collision stops Lola dead against most angled walls, and she freezes mid-stride when blocked  `player-collision-slide`
- **Where:** src/robot/LolaPlayer.js:617-640, src/world/JunkyardNavigation.js:56-68, src/world/createJunkyardWorld.js:29, src/simulation/JunkyardBrain.js:34-49
- **What's wrong:** Movement tests one world axis at a time, and only in the direction of the input:
  ```js
  if (!this.world.playerBlocked(p.x + dx, p.z)) p.x += dx;
  if (!this.world.playerBlocked(p.x, p.z + dz)) p.z += dz;
  ```
  When both the x part and the z part of the move push into a wall, Lola stops completely, even at a shallow glancing angle. Real collide-and-slide would carry her along the wall. Probe: a straight wall rotated by `wallDeg`, Lola running at `hitDeg` to its surface, 1 s of sliding (units/s):
  ```
  wall 0°:  hit 30° → 2.26 (ideal 2.26)   hit 60° → 1.31 (ideal 1.31)
  wall 15°: hit 30° → 0.00 (ideal 2.26)   hit 60° → 0.00
  wall 30°: hit 30° → 0.00                hit 60° → 0.00
  wall 45°: hit 30° → 0.95                hit 60° → 0.00
  ```
  In the real junkyard collision data, about 70% of the blocking wall-edge length is more than 5° away from the world axes, so this happens all the time in play.

  When she is blocked, `action.timeScale *= progress` (line 639) freezes the run clip, so she stands like a mannequin mid-stride (`state: 'Run', runWeight: 1.00, runTimeScale: 0.000`). The floor height is always 0, so there are no ramps or steps. That is a limitation rather than a bug.
- **Why it matters (plain language):** Circling the Leaper means brushing past cars, tyres and crates at an angle. Instead of sliding along them, Lola sticks dead until the player turns the camera, and she freezes in a running pose while stuck.
- **What it holds back:** Smooth movement around cover, cover-based level design, and later multi-height levels.
- **How to fix:**
  1. In `LolaPlayer.moveStep`, when both axis moves fail in a collision step, try the move rotated by ±0.5 and ±1.0 rad and shortened by `cos(angle)`. Keep the first one that is free. This works with the yes/no `playerBlocked` API, including the Leaper-contact wrapper in `JunkyardBrain`:
     ```js
     if (p.x === x0 && p.z === z0) for (const a of [0.5, -0.5, 1, -1]) {
       const c = Math.cos(a), s = Math.sin(a);
       const tx = (dx * c - dz * s) * c, tz = (dx * s + dz * c) * c;
       if (!this.world.playerBlocked(p.x + tx, p.z + tz)) { p.x += tx; p.z += tz; break; }
     }
     ```
     A cleaner long-term version is a `JunkyardNavigation.contact(x, z, r)` that returns the nearest wall normal (from `triangleDistanceSquared`'s closest edge), with Lola sliding along that normal.
  2. When `progress < 1`, ease the locomotion weights toward Idle instead of freezing clip time. Update the test at tests/lola-player.test.js:88-93 (it currently asserts the frozen pose).
  3. Add a test with walls at 15° and 30° that asserts a slide speed of at least half of `cos(hit) × run speed`.

  Do not touch `src/config/player-contact.json`; the brain server checks it (`contact_version`).
- **Effort:** M  ·  **Quick win:** no

#### [HIGH] Lola's exported skeleton is flat, so the hit flinch bends her head and shirt away from arms and gun that stay still  `player-flat-skeleton`
- **Where:** scripts/export_lola.py:184-190, scripts/export_lola_clips.py:72-78, src/robot/LolaPlayer.js:201-204, src/robot/LolaPlayer.js:233-258, src/robot/LolaPlayer.js:684-697
- **What's wrong:** In `lola-m416.glb` the shoulders, upper arms, thighs, pelvis and `chest` (which carries the gun) hang straight from the rig root, not from the spine. Bones with no bone parent: `DEF-spine hips chest DEF-pelvisL DEF-pelvisR DEF-thighL DEF-thighR DEF-shoulderL DEF-upper_armL DEF-shoulderR DEF-upper_armR`. The flinch rotates `DEF-spine.001`, so at its peak only the spine chain moves:
  ```
  head 21.5 cm · chest spine 10.7 cm · shoulderR 0.0 · handR 0.0 · carried gun 0.0
  mesh: Head ≈ 39-41 cm, Top (shirt) up to 2.3× edge stretch (18-30 of 384 edges stretched over 1.5×), Arms mesh 0.0 cm
  ```
  Both exporters pass `export_def_bones=True` on a Rigify-style rig, which drops the non-deform parent bones. The code already works around this for the reload (`attachReloadArms` re-attaches the arms to the chest every frame).
- **Why it matters (plain language):** Each time Lola is hit, her head and torso lurch away while her arms and gun hang frozen in the air, stretching her shirt at the shoulders. The same problem blocks aiming up and down, recoil kick, hands that follow the gun, and ragdoll deaths, and it makes bought or retargeted animations much harder to use.
- **What it holds back:** Aim offset toward the crosshair, better hit reactions, death/ragdoll, weapon IK, animation retargeting, and deleting the `attachReloadArms` workaround.
- **How to fix:**
  - **Proper fix (Blender, needs the .blend files):** in `export_lola.py` and `export_lola_clips.py`, before exporting, work on a temporary copy of the armature and re-parent the DEF bones into a real chain:
    - spine → spine.001 … → chest → shoulder → upper_arm → forearm → hand
    - pelvis → thigh → shin → foot → toe

    Alternatively, use a Rigify "game rig" conversion. Keep the bone names so `footstepContacts.js` and `measure_lola_steps.mjs` re-measure automatically. Then re-export all 14 GLBs, delete `attachReloadArms()`, and check with `node --test tests/lola-player.test.js` and the flinch probe (`attachments/probes/probe-flinch.mjs`): the shoulder, hand and gun should move with the chest.
  - **Code-only stopgap (S):** in the flinch block (lines 684-697), apply the same world rotation to the root-level upper-body bones (the list `createReload` already builds as `attached`, plus `chest`), pivoting around the `hitBone` world position.

  None of this affects the brain.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Four Lola tests are failing: one small frame-rate bug and three out-of-date tests, all from commit 9b384c9  `player-failing-tests-root-cause`
- **Where:** src/robot/LolaPlayer.js:509-526, src/robot/LolaPlayer.js:609, tests/lola-player.test.js:78-86, :108-115, :160-174, :198-206, package.json (no `test` script)
- **What's wrong:** `node --test tests/lola-player.test.js` gives 14 tests, 10 pass, 4 fail. The commit before (d0dc868) passes 11/11. Commit 9b384c9 says so itself: "JavaScript tests pass 65/69 with four existing Lola movement assertions failing".
  - **Real bug (fps test, line 173).** `move()` eases the input once per rendered frame and reuses that value for every 1/120 s sub-step:
    ```js
    const ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime);   // once per frame
    ... for (...) this.moveStep(this.inputForward, ...)
    ```
    Distance after holding W for 2 s: 4.9611 / 4.9550 / 4.9477 / 4.9430 units at 20 / 30 / 60 / 144 fps. With the easing moved inside the sub-step loop, it is 4.9436 at 20, 30 and 60 fps.
  - **Out-of-date tests:**
    - The stride test (line 83) expects the old floor offset without the new foot lift (line 609). It also expects full-speed strides from the first frame, but the input now ramps up.
    - The crossover test (line 113): a single 1/60 s frame after A→D leaves the eased side input at about 0.055, which is still `Run`. Line 115 still expects the old rate `2`.
    - The WASD test (line 199): one 0.1 s idle frame leaves Lola still in `Run`, because slowing down now takes about 14 frames at 60 fps.

  The reviewer's patch fixes all of this (`attachments/lola-test-fix.patch`). I re-verified it: with the patch, 14/14 Lola tests and 69/69 overall pass; with only the test changes, 13/14 pass (the fps test still fails).
- **Why it matters (plain language):** The speed difference itself is far too small to notice (about 2 cm over 2 seconds). The real cost is that a permanently red test list hides new breakage: if Lola's movement breaks tomorrow, it will look like the "known" failures.
- **What it holds back:** Adding automatic checks (CI), safe refactoring of `LolaPlayer`, and a clean merge with main.
- **How to fix:** Apply the patch above:
  - In `LolaPlayer.move`, compute `steps` first, use `ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime / steps)`, and update `inputForward`/`inputSide` (and the snap-to-zero below 0.02) inside the sub-step loop.
  - Stride test: preset `player.inputForward/inputSide` and expect `groundOffset * lolaHeight - footLift(...)`.
  - Crossover test: run 30 frames per input and expect `LOLA_PACE.run * strideMatch`.
  - WASD test: run 3 idle frames before expecting Idle/CrouchIdle.
  - Add `"test": "node --test tests/*.test.js"` to `package.json` and treat any red test as blocking.

  **Confirm:** `pnpm test` shows 69/69.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] LolaPlayer is one oversized class with unwritten action rules hidden in a 176-line `moveStep`  `player-god-class-no-state-machine`
- **Where:** src/robot/LolaPlayer.js:64-704, :528-703, :545-547, :340-371, :400-428, :161-173, :660-698
- **What's wrong:** ESLint (scratch config) reports `moveStep` at 176 lines with complexity 90, the constructor at 90 lines with 7 parameters, and the outfit-setup arrow function at complexity 20. Clip choice is one nested ternary. The rules about which actions can happen together are scattered checks:
  - `startShot`: `if (this.defeated || !this.grounded || this.jumpState || this.reloadState) return false;`
  - `jump()` cancels shot and reload; C is ignored mid-jump; `reactToHit` cancels the shot, and `startShot` clears the hit
  - layers are faked by zeroing and restoring weights around `mixer.update` (lines 660-698), plus a `1000 * locomotion` weight trick for the reload

  The same class also does loading, collision, jump physics, HUD text and its own key listener. (Correction to the original review: the 4 failing tests were noticed and written down in the commit message, and 3 of them come from intended behaviour changes, so they are not proof that the complexity hid changes. The new shot-layer bug above is a better example of how easily this structure breaks.)
- **Why it matters (plain language):** Each new move (dodge, melee, interacting with the Leaper, dying, reviving) has to be threaded through one huge function and its unwritten rules. Questions like "can I shoot while reloading?" are buried in code instead of being written down where a designer can read and change them.
- **What it holds back:** New player actions and Leaper interactions, reusing locomotion for other characters, designer-readable rules, and safe changes.
- **How to fix:** After the tests are green, keep `LolaPlayer` as a front with the same public methods (so `PlayerWeapon`, `LeaperCombat` and the camera keep working) and split the inside into:
  - `LolaAssets.js` (loading)
  - `LolaLocomotion.js` (input easing, direction to clip weights, stride speed)
  - `LolaAnimator.js` (named layers: base locomotion, an upper-body layer with a bone list instead of regexes and built-in weight correction, an additive hit/aim layer; one mixer update per frame)
  - `LolaActionState.js` (explicit states Locomotion/Jump/Reload/Aim/Shoot/HitReact/Dead with a table like `{ Shoot: { blockedBy: ['Jump', 'Reload', 'Dead'] } }`)
  - `CharacterMover.js` (collision)

  Move one piece at a time and run `node --test` after each. This does not touch the brain.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Weapon switching swaps two complete duplicate characters instead of attaching guns to her hand  `player-outfit-duplication`
- **Where:** src/robot/LolaPlayer.js:65-77, :104-157 (five `index === 0 ? 'm416' : 'basic'` branches at 136, 137, 139, 146, 156), :304-315 (`this.weaponIndex = 1 - this.weaponIndex`), :635-679, src/simulation/PlayerWeapon.js:51-54, :115, :268-269, src/simulation/EyeVision.js:11, scripts/export_lola.py:50-53
- **What's wrong:**
  - Both outfit GLBs contain the same 7 skinned body meshes and the same 9 textures (609,920 bytes each, identical hashes). Each also holds its in-hand gun, the other gun holstered, and a separate shooting gun.
  - The 12 per-weapon clip files (2,062,332 bytes) each embed their own gun mesh and texture.
  - Every sub-step animates both outfits (`for (const outfit of this.outfits) { ... outfit.mixer.update(deltaTime); }`), even the hidden one.
  - Switching weapons is hard-wired for exactly two (`1 - this.weaponIndex`).
  - The better pattern already exists in `createReload`: `hand.add(gun)`.
- **Why it matters (plain language):** Adding a third gun or a cosmetic skin means re-exporting the whole character and 6 more clip files, and editing hard-wired branches in three files. Skins multiply with guns. Today the hidden copy of Lola also costs download size (about 1.2 MB), GPU texture memory once you have switched weapons, and animation time every frame.
- **What it holds back:** More weapons, outfits/skins, a smaller web download, and CPU budget for more characters.
- **How to fix:**
  - **Target design:**
    - one body-only Lola GLB
    - one small GLB per weapon (mesh plus grip offset), attached to a socket bone: `DEF-hand.R` in hand, `chest`/`hips` holstered, like `createReload`
    - per-weapon clip sets in one animation file with prefixed names (`m416/Run`, `pistol/Run`)
    - a `WEAPONS` table in config (id, key, model file, socket, clip prefix, plus the ammo stats now in `PLAYER_WEAPON`) that replaces every `index === 0` branch and the `1 - weaponIndex` toggle
  - **Interim (S):** skip `mixer.update` for the hidden outfit, and in `switchWeapon` copy action times, weights and the jump state across before showing it.

  This does not affect the brain.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] No directional blending: diagonals play the pure strafe clip and skate, and are 30% slower than running straight  `player-no-directional-blend`
- **Where:** src/robot/LolaPlayer.js:545-547, :588-591, :116, README.md:126-130
- **What's wrong:** One clip is chosen: `const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);`. Probe (60 fps, steady state):
  ```
  W (Run)            travel 2.61  planted-toe slip 0.22 (9%)
  D (StrafeRight)    travel 1.84  slip 0.07 (4%)
  W+D (StrafeRight)  travel 1.84  slip 1.40 (76%)
  S+D (StrafeRight)  travel 1.84  slip 1.40 (76%)
  S  (Run reversed)  travel 2.61
  ```
  `Walk` is loaded and measured (line 116) but never chosen. Backpedalling at full run speed is a design choice rather than a bug, but it is worth deciding on purpose.
- **Why it matters (plain language):** Running diagonally, the most common move while circling the Leaper, slides her feet like ice skating and makes her about 30% slower than running straight.
- **What it holds back:** Polished movement feel, and adding dedicated diagonal or backpedal clips later.
- **How to fix:** In the locomotion code (or a new `LolaLocomotion.js`), replace the single-clip choice with a blend:
  - `angle = atan2(side, forward)`; Run weight ∝ |cos angle| (played reversed when going backward), StrafeLeft/Right weight ∝ |sin angle|, normalised.
  - Keep all blended clips on the same normalised phase (set each `time = phase × duration` every step, as the current switch code does once).
  - Take travel speed from the same weights (line 601 already weights distance).
  - Optionally add `backpedalScale` (e.g. 0.75) in config, and either use `Walk` for slow aim-walking or stop exporting it.

  **Confirm:** with the feel probe (`attachments/probes/probe-feel.mjs`), W+D slip should drop under about 15% of travel. This does not affect the brain.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Winning or losing freezes Lola as a statue mid-stride  `player-defeat-freeze`
- **Where:** src/robot/LolaPlayer.js:509-510, src/simulation/LeaperCombat.js:97-126
- **What's wrong:** `move(...) { if (this.defeated) return;` returns before any `mixer.update`, so the pose stops on whatever frame was showing. `finish()` sets `defeated = true` for both 'LEAPER DEFEATED' and 'LOLA DEFEATED', and calls `clearHitReaction()` first, which snaps any flinch off instantly. There is no death or victory clip. (Correction: a running reload is cleared, because `PlayerWeapon.update` calls `reset()` and `cancelReload()` once `combat.dead`, but a jump in progress is not cleared. It stays frozen and carries on after RESTART.)
- **Why it matters (plain language):** The moment the player kills the Leaper, which is the goal of the game, Lola turns into a mannequin mid-step. Losing looks exactly the same. The climax has no payoff.
- **What it holds back:** Win/lose presentation, a respawn/restart flow, and finishers or kill cinematics.
- **How to fix:**
  - **Smallest fix:** in `LolaPlayer.move`, when `defeated`, call `this.endJump()` once and keep calling `moveStep(0, 0, forward, right, speed, dt)` instead of returning, so she settles to Idle. `jump()`/`startShot()` already refuse while defeated.
  - **Better:** replace the external flag with `lola.die(direction)` and `lola.encounterOver()`, called from `LeaperCombat.finish`. On death, play a death clip (or a procedural slump: flinch bone plus CrouchIdle) until art exists; on victory, settle to Idle.

  **Confirm:** use DEBUG: DAMAGE LEAPER while running and check that she settles to Idle.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Input is spread over four classes with hard-coded keys: no rebinding, no gamepad, very limited touch, and the controls text is wrong  `player-input-fragmented`
- **Where:** src/controls/InputController.js:8-21, :99-120, src/robot/LolaPlayer.js:161-173, src/simulation/PlayerWeapon.js:75-89, src/camera/CameraController.js:51-57, src/simulation/JunkyardBrain.js:130-136, src/simulation/JunkyardPlaytest.js:75, index.html:81-84, README.md:84-88
- **What's wrong:**
  - **Separate window listeners:** InputController (WASD, arrows, Shift, Space, P, IJKL), LolaPlayer (C, 1/2), PlayerWeapon (mouse 0/2, R, Escape) and CameraController (Escape, wheel).
  - **No gamepad:** there are no `getGamepads` calls anywhere.
  - **Thin touch UI:** only joystick, SPRINT and JUMP (index.html:81-84): no fire, aim, crouch, reload or weapon switch.
  - **Form fields not ignored:** `InputController` calls `preventDefault` on arrows and Space and records them without checking form fields. Arrow keys on the junkyard "Vision mode" `<select>` or the size slider therefore move Lola instead of changing the control. LolaPlayer, by contrast, does check `/INPUT|TEXTAREA|SELECT/`.
  - **Debug keys move Lola:** IJKL also moves her (`a.forward + b.forward`).
  - **Wrong text:** the HUD key strip (JunkyardPlaytest:75) never mentions R for reload, and README says "**F** ... switches ... Weapons are visual only; shooting is not implemented."
- **Why it matters (plain language):** Players can't rebind keys or use a controller. Phone and tablet players can't shoot at all, and the written controls are wrong, so playtesters get the wrong instructions.
- **What it holds back:** Controller support, accessibility and rebinding, a mobile/web release, and consistent tutorial and HUD text.
- **How to fix:**
  1. Add `src/controls/bindings.js` (`moveForward: ['KeyW','ArrowUp'], crouch: ['KeyC'], reload: ['KeyR'], weapon1: ['Digit1','Numpad1'], weapon2: ['Digit2','Numpad2'], fire: ['Mouse0'], aim: ['Mouse2'], ...`, plus gamepad buttons).
  2. Make `InputController` the only listener. It polls the gamepad in `update()`, exposes `isDown(action)` and an edge-triggered `pressed(action)`, and skips events from form fields.
  3. Have `LolaPlayer` and `PlayerWeapon` read actions instead of adding listeners.
  4. Generate the `.keys` strip from `BINDINGS`.
  5. Drop IJKL from Lola in junkyard mode.
  6. Add touch FIRE/AIM/RELOAD/CROUCH buttons.

  Keep using `event.code`.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Only the owner's PC can rebuild Lola: Blender sources missing, Windows-only paths, timings copied by hand  `player-export-pipeline`
- **Where:** scripts/export_lola.py:1-16, :98-99, scripts/export_lola_clips.py:1-10, :19-30, :79-82, scripts/measure_lola_steps.mjs:72, src/robot/LolaPlayer.js:10-17, :35-40, assets/characters/lola/stride-profiles.json
- **What's wrong:**
  - **Windows-only paths:** `WALK_SOURCE = Path('C:/Blender/LOWPOLY/Lola_walk_final.blend')`. The usage line names `Lola_both_animations.blend1.blend` (a renamed Blender backup), and the clips come from `"C:/Blender/LOWPOLY/Lola final.blend"`.
  - **Sources not in git:** `git ls-files` lists no Lola `.blend` (only the two junkyard blockmesh blends).
  - **Hard-coded names:** object names such as `'Lola_03_Tuck_Rig.002'`.
  - **Dead entry:** `CLIPS` has a `'jumprun'`/`JumpToRun` entry with no exported file and no consumer. A plain no-argument run of the script tries to export it.
  - **Hand-copied timings:** take-off and touchdown are only printed (`print('LOLA_CLIP_EXPORT', ...)`), while `LolaPlayer` hand-copies `JUMP_LANDING = 38 / 30`, `JUMP_LIFTOFF = 17 / 30` and the `RUN_JUMPS` take-off frames.
  - **Stale profiles:** `stride-profiles.json` is missing the Shoot entries, and its `travel` arrays are no longer read (strideMotion.js was deleted in 9b384c9).
- **Why it matters (plain language):** Fixing the skeleton, adding a gun or re-timing a clip depends on one machine and on remembering to update numbers copied by hand. A second artist or programmer can't rebuild Lola.
- **What it holds back:** The skeleton fix, new weapons and clips, a second contributor, and automated asset checks.
- **How to fix:**
  - Store the Lola `.blend` sources with Git LFS (add a `*.blend filter=lfs diff=lfs merge=lfs -text` line to `.gitattributes`, which today only marks PDFs as binary) or document a shared location.
  - Read source paths from arguments (`-- --source <path> --walk <path>`).
  - Have `export_lola_clips.py` write `assets/characters/lola/clips-manifest.json` (fps, frame range, lift-off and touchdown frames) and import it in `LolaPlayer` instead of the `JUMP_*`/`RUN_JUMPS` constants.
  - Delete `'jumprun'`.
  - Add an `assets:measure` script to `package.json`, regenerate the profiles, and drop `travel`.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Lola pretends to be the old pink "target", and other systems reach into her internals  `player-target-ducktyping`
- **Where:** src/robot/LolaPlayer.js:65-77, :159-160, :178-189, :304-308, :397-398, src/simulation/PlayerWeapon.js:101, :110, :238, src/simulation/LeaperCombat.js:85, :122, src/simulation/EyeVision.js:11, src/main.js:33-46, index.html:24
- **What's wrong:**
  - **Placeholder stubs:** `toggle() { /* Lola remains controllable while the Leaper is paused. */ }` and `setSelected() { this.selected = true; }` exist only to look like `TargetMarker`.
  - **Fields written from outside:** `this.p.target.aimHeld = active`, `this.playtest.target.defeated = true`, `this.p.target.mesh.visible = false`, `this.p.target.shot?.action.paused`, `playtest.target.outfits.map(...)`.
  - **HUD written from character code:** the text goes into `#cuboidToggle`, which index.html labels "PINK: SELECT".
  - **Source files consumed:** the constructor moves meshes out of the source glTFs (`model.add(gun)`), so a second `LolaPlayer` built from the same loaded files throws "Lola Jump export is missing its clip or weapon".
  - **No cleanup:** the keydown listener is never removed, and there is no `dispose()`.
  - **Contract differs on main:** `TargetMarker` gained `setPosition/setFacing/loadPlayerModel` there, used by main's `src/main.js:73` and `TrainingVisualizer.js:249`.

  (Correction: RESTART ENCOUNTER does not rebuild Lola. `LeaperCombat.reset` only clears flags, so restart works today. The single-use assets only matter for a rebuild-style respawn, a second character, or hot reload.)
- **Why it matters (plain language):** Changing one system quietly breaks another, and merging with main means reconciling two different ideas of what the "target" is. The HUD can't be redesigned without editing character code.
- **What it holds back:** Merging with main, a respawn without page reload, multiple or co-op characters, and HUD redesign.
- **How to fix:**
  - Define an explicit player API: `setAiming(bool)`, `die()`, `get canShoot`, `get stance`, and events `onWeaponChange`/`onStanceChange` that a small HUD module listens to.
  - Rename `target` to `player` in the junkyard code.
  - Share a minimal Target interface (`position`, `setPosition`, `setFacing`) so main's BrainDriver/TrainingVisualizer can accept Lola.
  - Clone assets with `SkeletonUtils.clone` (`three/examples/jsm/utils/SkeletonUtils.js`) instead of moving meshes.
  - Add `dispose()`.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] No aim offset: the gun never tilts toward the crosshair, and in aim view no gun or hands are shown  `player-no-aim-offset`
- **Where:** src/robot/LolaPlayer.js:340-361, :373-379, src/simulation/PlayerWeapon.js:189-205, :234-240
- **What's wrong:** Nothing in `LolaPlayer.js` pitches the spine or arms. `holdAim()` just pauses the Shoot clip on its first frame. `fire()` shoots from `muzzlePosition()` toward the crosshair point (`const direction = aim.sub(origin).normalize();`) wherever the barrel points. While right-click aiming, `this.p.target.mesh.visible = false` hides the whole character. That part is deliberate, because the aim camera sits at her eyes, but nothing replaces her: no gun, no hands.
- **Why it matters (plain language):** In third person, shooting up at the Leaper's eye or joints leaves the gun pointing level while the tracer leaves at an angle (worked out from the code; how noticeable it is depends on camera pitch). In aim view the player sees no weapon, and tracers start from an invisible point below the screen.
- **What it holds back:** Convincing shooting, recoil kick, and polished first-person aiming (the branch's stated goal).
- **How to fix:**
  - **Aim offset (after the skeleton fix):** add an aim layer in the same post-mixer spot as the flinch that spreads the camera pitch over `DEF-spine.003` to `.005`, clamped to about ±60°.
  - **Aim view:** hide only the head and torso meshes and keep the arms and gun visible, or add a simple gun viewmodel attached to the camera.

  This does not affect the brain.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The jump buffer is used up and thrown away during authored jumps  `player-jump-buffer-eaten`
- **Where:** src/simulation/JunkyardBrain.js:128, src/controls/InputController.js:13, :93-97, src/robot/LolaPlayer.js:400-428, :341
- **What's wrong:** `if (this.target.isPlayer && this.target.grounded && sim.input.consumeJump()) this.target.jump();`. The authored jump never sets `grounded = false`, and `jump()` refuses while `jumpState` is set. So a Space press buffered for 0.16 s near landing is consumed and dropped, which makes the buffer useless with the authored jumps. Two related design limits (not bugs):
  - the authored jump doesn't change collision, so it can't clear any prop (though it can dodge bolts, since hits follow her animated bones)
  - `startShot` refuses for the whole 1.4 s standing jump
- **Why it matters (plain language):** Pressing jump just before she lands silently does nothing, which feels like a dropped button press.
- **What it holds back:** Responsive chained jumps, and later jump-over-obstacle design.
- **How to fix:** Add `get canJump() { return !this.defeated && this.grounded && !this.jumpState; }` to `LolaPlayer`, and change `JunkyardBrain.js:128` to `if (this.target.canJump && sim.input.consumeJump()) this.target.jump();`. As design decisions: should jumps clear low props (raise the collision height filter while the clip's feet are up), and may firing cancel the standing jump's recovery?
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] A few feel values are buried in code, and the `move()` speed argument is a trap  `player-tuning-scattered`
- **Where:** src/robot/LolaPlayer.js:9-53, :424, :454, :530, :542-544, :586, src/simulation/JunkyardBrain.js:136, src/config/encounter.js:1-12, src/world/createJunkyardWorld.js:29
- **What's wrong:** Most constants (`LOLA_INPUT_RESPONSE`, `LOLA_PACE`, the `JUMP_*` values) already sit at the top of `LolaPlayer.js` with plain comments. A few still hide inside the code: turn rate `9 * deltaTime`, blend rate `Math.exp(-12 * deltaTime)`, gravity `14 * this.world.scale`, hop `Math.sqrt(2 * 14 * 0.85)`, and the map radius `0.25`. The real trap is the `speed` argument. It is only used as `const sprint = speed > 5 && !this.crouching;`, while callers pass `sim.input.sprinting ? 8 : 4.5`. There is also a stale `this.runPace ?? 2` fallback (`LOLA_PACE.run` is 2.3).
- **Why it matters (plain language):** Changing 4.5 to 6 would silently turn normal movement into a sprint, and changing 8 does nothing. The designer can't tell which numbers are safe to change.
- **What it holds back:** Designer tuning and quick feel iteration.
- **How to fix:**
  - Create `src/config/lola.js` (frozen like `ENCOUNTER`, with units and plain comments) holding pace, input response, turn rate, blend rate, jump timings, gravity, a future `backpedalScale` and `mapRadius` (wired into `createJunkyardWorld`).
  - Replace `move()`'s `speed` argument with a `sprinting` boolean, and drop the `?? 2`.

  Leave `player-contact.json` alone (the server mirrors it).
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Lola animates both outfits at the 120 Hz sub-step rate and measures clips at every page load  `player-animation-cost`
- **Where:** src/robot/LolaPlayer.js:522-525, :635-703, :239-257, :381-395, src/robot/footstepContacts.js:5-62, :113-160
- **What's wrong:** Node CPU probe (numbers vary by run): `move()` costs 0.39-0.78 ms per frame at 60 fps (2 sub-steps × 2 mixers) and about 1.2-1.5 ms at 10 fps (12 sub-steps). The constructor takes 210-540 ms, mostly foot-contact sampling. `muzzlePosition()` takes about 0.2-0.3 ms per shot, scanning and cloning 432/944 gun vertices. The reload and flinch paths allocate new matrices, quaternions and vectors every sub-step (lines 251, 690-696).
- **Why it matters (plain language):** Lola alone uses roughly 2-5% of a 60 fps frame, more when the game is already slow, and loading pauses for a fraction of a second. That is fine for one character, but it adds up.
- **What it holds back:** More characters on screen, and low-end/mobile web.
- **How to fix:**
  - Keep the collision sub-steps but update the mixer once per rendered frame, for the visible outfit only.
  - Bake foot contacts and jump landings into `stride-profiles.json` in `measure_lola_steps.mjs`.
  - Cache the muzzle tip in gun-local space.
  - Hoist temporary vectors and matrices to module scope.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Firing cancels the hit flinch, so holding the trigger hides damage reactions  `player-hit-flinch-cancelled`
- **Where:** src/robot/LolaPlayer.js:317-330, :340-344, :357-358, src/simulation/PlayerWeapon.js:17, :300-302
- **What's wrong:** `startShot()` calls `this.clearHitReaction()`, and the M416 fires automatically every 1/7 s, so a flinch is wiped within about 0.14 s, and the spine snaps back. `reactToHit()` calls `cancelShot()`, and `holdAim()` refuses while `hitRecoilTime > 0`, so a hit while aiming drops the raised gun for 0.6 s.
- **Why it matters (plain language):** During sustained fire, which is most of the fight, the player barely sees that Lola got hurt, while the same hit during aiming knocks her aim down.
- **What it holds back:** Readable damage feedback and clear hit-stagger rules.
- **How to fix:** The flinch is already applied after the mixer pose (lines 684-697), so it can sit on top of shooting. Remove `this.clearHitReaction()` from `startShot` and `this.cancelShot()` from `reactToHit`, optionally halving the flinch angle while shooting. Put the stagger rules in the explicit action table (see the oversized-class finding). This looks best after the skeleton fix, because today the flinch leaves the arms and gun behind.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] README and TRAINING describe Lola behaviour the code no longer has  `player-docs-drift`
- **Where:** README.md:84-90, :123-150, TRAINING.md:418, :530
- **What's wrong:** README says:
  - "**F** ... switches ... Weapons are visual only; shooting is not implemented."
  - "The walk cycle plays more slowly than the run." (Walk is never played.)
  - "Playback keeps Blender's root height instead of repositioning the body to follow the lowest foot" (line 609 now subtracts foot lift).
  - "phase-dependent distance" (the code now uses the clip's average speed).

  TRAINING.md is a dated journal, so its older "Q switches guns" entries are history. The real gap is that there is no entry for 9b384c9, which added reload, running jumps, the 1/2 weapon keys, automatic M416 fire, input easing and foot lift.
- **Why it matters (plain language):** The owner and any helper read wrong descriptions of how Lola plays and works.
- **What it holds back:** Onboarding, correct tests, and the owner's picture of the current feel.
- **How to fix:** Rewrite the README Lola/controls section to match the code, and add a TRAINING.md entry for 9b384c9. Later, generate the controls list from the bindings file proposed above.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. All 16 of the reviewer's findings held up under re-testing. These were re-rated:
- failing tests: high → medium
- oversized class: high → medium
- duplicate outfits: high → medium
- collision: medium → high (stronger evidence)
- jump buffer: medium → low
- tuning: medium → low

Small factual corrections are noted inside the findings.

### Camera, first-person/over-shoulder aim & player weapons

**How it works today**

One `CameraController` (src/camera/CameraController.js, 425 lines) serves three products through a `mode` string (`CHASE`, `TOP`, `LENS`) plus flags (`aiming`, `spectator`, `followSubject`, `gameplayStarted`, `fallbackMouseLook`). In the junkyard, the third-person chase camera orbits a point about 2.87 units above Lola's feet. That point is roughly one unit above her real eyes (eye 1.89, muzzle 1.65) and has no shoulder offset; the offset was deliberately removed in commit 9b384c9. The default boom is 8.5 × followScale (about 4.45 units), and the mouse wheel sets it between 6 and 22. `CameraOcclusion` uses nine probe rays against a copy of the map: it pulls the camera in instantly, eases it back out, and never brings it closer than 0.8 × Lola's height (1.98 units). Any wall inside that distance is faded instead. Holding right mouse (`aiming`) jumps the camera to Lola's head-bone "eye" in one frame, keeps the same yaw and pitch (plus a small `0.35 / distance` tilt), eases the field of view to a ×1.35 zoom (about 42°), and hides all of Lola for the render. In the junkyard the camera is only updated from inside the Leaper's network-pose code (`LeaperSimulation.updateExternal`), plus one synchronous call when aim starts.

`PlayerWeapon` (src/simulation/PlayerWeapon.js, 316 lines) has two hitscan guns: an automatic M416 (2 damage, 1/7 s, 20 rounds) and a pistol (6 damage, 0.2 s, 15 rounds). Reserve ammo is unlimited, and the timed reload is synced to Lola's animation. `fire()` casts a sight ray from the camera lens through the screen centre against the map copy and the Leaper's render meshes, then casts a second ray from the gun muzzle to that point, so the nearest of cover or Leaper wins. Damage goes through `LeaperCombat.damageLeaper`: the red eye core takes ×2, and per-joint hit counters (`LeaperLegDamage`) snap knees after 8–10 hits and long leg pieces after 24–26. Feedback comes from reticle states, a blue edge glow, camera shake on big hits, and `GunshotEffects` (tracer, muzzle cone, sparks, and a render-only Leaper shudder). Three pairs of `beforeRender`/`afterRender` hooks in `main.js` fade Lola and walls, hide Lola while aiming, hide the Leaper in the POV view, and apply the shudder.

Tests: the three camera/gun Node files pass 14/14, and the real-asset page `tests/browser-combat.html` passes 155/155 in about 4 s (re-run during verification). `tests/camera-player.html` fails at its 12th check. None of these suites cover the aiming bugs below.

**What's good**

- The two-ray model is the right one: a screen-centre sight ray finds the aim point and a separate muzzle ray checks cover (PlayerWeapon.js:33-39, 195-203). Thin cover really blocks bullets, and a browser check guards it.
- Entering and leaving held aim keeps the crosshair on the same world point (`aimEyeAt`/`aimChaseAt`, CameraController.js:351-398), with Node tests for both directions. On open ground the heading changed by only 0.9–3.4° in probes.
- Camera collision is solid: nine probe rays, an instant pull-in, a delayed ease-out, never moving through cover, and the chosen pitch is preserved. It is unit-tested and checked against the real map.
- Pointer-lock handling is careful. It has generation counters, a fallback when the browser refuses the lock, and deliberate Escape-versus-focus-loss rules, all unit-tested.
- Ammo and reload are complete per gun: automatic or R-key reload, refill timed to the end of the authored animation, reload sounds placed on specific frames, cancel on gun switch or jump, and a draining HUD.
- Damage zones are meaningful for a designer: an eye-core weak point, randomised joint thresholds, severed-leg debris, and big-hit feedback.
- The frozen brain is protected. Weapon aim, the POV view and the render-only shudder stay out of the saved brain's sensing pose, and a browser check guards this ('weapon aim does not change the saved-brain sensing pose', browser-combat.js:147).
- `GunshotEffects` disposes every geometry and material it creates.
- Constants carry plain-language comments that say what raising or lowering them does.

**How professional game projects handle this**

Third-person shooters (ARC Raiders included) build aiming from a few standard parts:

- **One look rotation feeds every camera.** A single "control rotation" (look yaw/pitch) is read by each camera: a spring-arm over-the-shoulder chase camera, a closer aim-down-sights camera, death or kill cams. A camera manager blends between them (Unreal's PlayerCameraManager with SpringArm and CameraModifiers for shake and recoil; Unity Cinemachine virtual cameras with blends).
- **The aim trace starts at the character's depth.** The camera trace starts where the character sits along the camera ray, not at the lens, so nothing between the camera and the player can become the target. A second trace from the muzzle checks for obstruction, and the reticle shows an "obstructed" marker when it is blocked.
- **Enemies have simplified hit shapes.** Capsules and spheres on bones are tagged with damage zones and multipliers, so the art can change without breaking gameplay.
- **Weapons are data assets.** Damage, rate, magazine, recoil, spread, aim multipliers, effects and sounds live in tables. Fire rate runs on an accumulator, so it does not depend on frame rate.
- **Input goes through an action map.** Actions are read once per tick and support rebinding, gamepad and touch.
- **Per-camera visibility uses render flags or layers.** Flags such as "owner no see" or "shadows only" decide what each camera draws, and first-person guns are a viewmodel drawn in a separate pass.
- **Effects are pooled.**

Leaper differs in several ways:

- Chase and aim share one yaw/pitch, with a chase-tuned pitch clamp and an ad-hoc tilt.
- The trace starts at the lens, which makes Lola shoot backwards near walls.
- There is no shoulder offset (removed on purpose) and no obstruction feedback.
- Aiming hides the whole character, including her shadow.
- Enemy hits use render meshes.
- Weapon tuning is spread across several files.
- Fire rate depends on frame rate.
- The camera is driven from inside the Leaper's network code, so it stops when the fight ends.

None of this needs a new engine, and none of it touches the frozen brain's observations, actions or movement.

**Findings**

#### [HIGH] Near walls (or with the Leaper behind her), Lola fires backwards and aiming swings the view ~180°, because the sight ray starts at the camera lens  `aim-weapons-camera-trace-starts-at-lens`
- **Where:** src/simulation/PlayerWeapon.js:155-164, :195-203, :100, :107; src/camera/CameraOcclusion.js:4, :57; src/camera/CameraController.js:320-321; src/simulation/CombatGeometry.js:19-24
- **What's wrong:** Both `fire()` and `crosshairPoint()` start the sight ray at the camera:
  ```js
  cameraRay.setFromCamera(new THREE.Vector2(), p.engine.camera);
  const sight = bulletHit(p.combat.geometry, enemies, cameraRay.ray.origin, cameraRay.ray.direction, range);
  const aim = cameraRay.ray.at(sight.distance, new THREE.Vector3());
  const origin = p.target.muzzlePosition();
  const direction = aim.sub(origin).normalize();
  ```
  The camera often sits *behind* something, for two reasons. First, the occlusion solver never moves it closer than 1.98 units (`this.distance = Math.max(Math.min(length, minimumDistance), this.distance)`, with `minimumDistance = height * 0.8`), so a wall closer than that stays between the camera and Lola and is only faded. Second, characters "never shorten the boom" (CameraOcclusion.js:4), so a Leaper leg can sit between them. The sight ray then hits that wall or leg *behind* Lola, and the muzzle ray points backwards toward it. Measured on the real map during verification:
  ```
  600 random free spots/headings (default pitch): 58 had a faded wall behind Lola, 52 shots (8.7%) flew backwards
  Leaper leg between camera and Lola: 3 of 3 shots fired backwards (dot -0.86..-0.91) and each did 2 damage
  Right-click aim with back to a wall: heading swings 177.8-178.2 deg (open ground: 0.9 deg)
  ```
  The swing happens because `setAiming(true)` takes the "crosshair point" from the same lens ray and turns the eye view to face it.
- **Why it matters (plain language):** When Lola backs into cover, which happens a lot in a cluttered junkyard, the crosshair is in front of her but the bullet goes into the wall behind her. Pressing aim can spin the view to stare at that wall. With the Leaper looming behind her, she shoots it while looking away. It feels broken at exactly the tense moments.
- **What it holds back:** Trustworthy shooting in close quarters, any cover or lean mechanic, tighter and more cover-heavy levels.
- **How to fix:**
  1. In `PlayerWeapon`, add one helper that both `fire()` and `crosshairPoint()` use. It builds the camera ray as now, then moves its start to Lola's depth whenever the chase camera (not aim) is active:
     ```js
     sightRay() {
       const p = this.p, cc = p.cameraController, cam = p.engine.camera;
       p.engine.scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
       this.cameraRay.setFromCamera(CENTER, cam);           // reuse one Raycaster
       const ray = this.cameraRay.ray, start = ray.origin.clone();
       if (!cc.aiming && cc.followSubject) {
         const anchor = cc.chaseAnchor(new THREE.Vector3());
         start.copy(ray.closestPointToPoint(anchor, new THREE.Vector3()));
       }
       return { start, direction: ray.direction.clone() };
     }
     ```
     Then cast `bulletHit(geometry, enemies, start, direction, range)` and take `aim = start + direction * sight.distance`. Because the start point moves rather than adding a `near` parameter, `CombatGeometry.hit` does not need to change.
  2. Add a safety net in `fire()`: if `aim.clone().sub(muzzle).dot(direction) <= 0`, fire from the muzzle along `direction` instead.
  3. `setAiming(true)` gets the fix automatically, because it uses `crosshairPoint()`.
  4. Confirm: add a check to `tests/browser-combat.js` that places Lola with her back to a real wall (search spots where `cameraController.occlusion.blockers.size > 0`), fires, and asserts that the tracer direction · camera forward > 0 and that `setAiming(true)` changes `getMovementHeading` by less than 20°. Brain recipe untouched.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] Killing the Leaper (or dying) while aiming leaves the camera stuck inside Lola's head; the kill shot shows no tracer, sparks or shake, and the stored shake plays at the start of the next fight  `aim-weapons-kill-shot-feedback-cleared`
- **Where:** src/simulation/PlayerWeapon.js:205-220, :249-258, :285; src/simulation/LeaperCombat.js:97-106, :119-126; src/simulation/JunkyardPlaytest.js:188-201; src/simulation/JunkyardBrain.js:139, :168; src/simulation/LeaperSimulation.js:112; src/camera/CameraController.js:254-256, :296-307
- **What's wrong:** The lethal shot runs this chain inside `fire()`, before the frame is drawn: `damageLeaper` → `finish()` → `playtest.stop()` → `playerWeapon.reset()` → `clearEffects()`. That wipes the tracer and sparks it has just created (normal shot: 11 effect pieces left; kill shot: 0). `reset()` also sets `aiming = false`, which un-hides Lola. But the camera is only moved by `LeaperSimulation.updateExternal`, which `JunkyardBrain` skips once `combat.dead` is true (`if (this.frame && !encounterOver)`). So nothing ever moves the camera back out of the aim pose. Verified with the real game loop running:
  ```
  after a kill while aiming: camToEye 0, fov 42.17 (still zoomed), Lola visible again, shakeStrength stuck at 0.7
  after RESTART ENCOUNTER, shakeStrength every 100 ms: 0.5, 0.3, 0.1, 0 ...
  ```
  The victory screenshot (work/verify-aim-weapons/after-kill-aiming.png) shows the zoomed view with Lola's own head polygons smeared across the top of the screen. Dying to the laser while aiming does the same. The kill-shot shake is never shown, because `fadeShake`/`applyShake` only run inside `update()`. It is stored instead and replayed when the next encounter starts. (The reviewer's "can't look at the collapsing Leaper" is not accurate: there is no collapse animation, and the mouse is released at the end anyway. The real damage is the stuck in-head view and the missing kill feedback.) The chapter on the core loop records the broader frozen camera (`core-loop-camera-frozen-after-encounter-end`) and the erased effects (`core-loop-encounter-end-erases-feedback`); this finding adds the aim-specific symptoms.
- **Why it matters (plain language):** The winning shot is the climax of the game. If the player lands it while aiming, which is the natural way to take a careful final shot, the victory screen is seen from inside Lola's skull: zoomed in, with bits of her head across the view, no tracer and no impact. The camera shake meant for that shot then hits at the start of the next round instead.
- **What it holds back:** Victory and defeat presentation (kill cam, slow motion, death animations, looting or exploring after the fight), and any post-encounter state.
- **How to fix:**
  1. Drive the camera every frame, whatever the encounter state. Remove `this.cameraController.update(...)` from `LeaperSimulation.updateExternal` (line 112) and call it once per frame at the end of `JunkyardPlaytest.update` (after `playerWeapon.update`, before `pov.update`). Keep `main.js` calling it for the sandbox and training modes, as described in the core-loop chapter.
  2. Separate "stop the run" from "wipe the weapon". Split `PlayerWeapon.reset()` into `cancelActions()` (trigger, aim, reload, shot pose) and `clearEffects()`. `JunkyardPlaytest.stop()` should call only `cancelActions()`. In `PlayerWeapon.update`, when the gun is unavailable, still call `this.visuals.update(dt)` so effects fade naturally. Call `clearEffects()` only from `JunkyardPlaytest.reset()`.
  3. Clear stored shake on restart: add `CameraController.resetEffects()` (sets `shakeStrength = 0`) and call it from `JunkyardPlaytest.reset()`.
  4. Confirm: add a browser-combat check. Set `combat.leaperHealth = 2`, call `setAiming(true)`, `fire()`, then run `p.update(1/60)` 20 times. Assert `camera.position.distanceTo(target.eyePosition()) > 1`, `camera.fov > 50`, `playerWeapon.visuals.items.length > 0` right after the shot, and that `shakeStrength` falls. Then call `reset()` and assert `shakeStrength === 0`. In the game, use DEBUG: DAMAGE LEAPER, hold right-click and land the kill.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Held aim can only look up 16.6°, so most of the Leaper's upper knees can't be put under the aim crosshair up close  `aim-weapons-ads-pitch-clamp-hides-knees`
- **Where:** src/camera/CameraController.js:8-10, :211, :299-302, :365, :397; src/simulation/LeaperLegDamage.js:9-12
- **What's wrong:** Every view shares one pitch clamp tuned for the chase camera (`CHASE_PITCH_HIGH = 0.5; CHASE_PITCH_LOW = -0.25`, "Kept tight so mouse-look shows the surroundings"). The aim ray is built from that same pitch (`-Math.sin(this.pitch) + 0.35 / this.distance`), so held aim tops out at 16.6° up and the chase crosshair at 14.3° up. The Leaper's upper knees sit at y = 3.6, while Lola's eye is at 1.89. Verification swept the full yaw range (±80°, wider than the reviewer's ±23°):
  ```
  distance (units)          3    4    5    6    8
  upper knees, held aim     1    2    2    2    2   (of 6)
  upper knees, hip-fire     2    4    4    6    6
  lower knees, either view  4-6  6    6    6    6
  ```
  So the reviewer's claim that knees "cannot be aimed at within about 8 units" is overstated. The lower knees use the same 8–10 hit threshold and also disable the leg, and they are reachable in every case, as are 1–2 upper knees. The real problem is that the precision view cannot tilt up to the top of a tall enemy up close, and four of the six upper knees are out of reach in it.
- **Why it matters (plain language):** When you aim at a towering robot from close by, the view stops tilting at a shallow angle, so you can't line up the high joints or look over its body. You have to step back or switch to hip-fire, which feels like the camera is fighting you.
- **What it holds back:** Close-range knee targeting, taller enemies, and vertical level design (shooting up at ledges).
- **How to fix:**
  1. In CameraController.js add `AIM_PITCH_UP = -0.9` and `AIM_PITCH_DOWN = 0.9`. Pitch is inverted here: negative means looking up.
  2. In `onPointerMove` (line 211), clamp to these limits when `this.aiming`, and to the chase limits otherwise. Use the same aim limits in `aimEyeAt` (line 397).
  3. In `aimChaseAt` (line 365), keep the chase clamp. On leaving a steep aim the crosshair will drift a little; storing separate chase and aim angles (see the CameraController finding) removes that later.
  4. Optional: allow a lower `CHASE_PITCH_LOW` (about -0.6) and shorten the boom as the camera dips, so it doesn't dig into the floor.
  5. Confirm: add a browser-combat check that with Lola 4 units in front of the Leaper and `setAiming(true)`, some pitch inside the new limits puts the centre ray on a front upper knee (`userData.leaperJoint.joint === 'upper'`). Camera only; no brain impact.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The chase crosshair line runs ~1.2 units above the gun, so about 1 in 20 "on target" shots silently hit nearby cover, with no "blocked" reticle  `aim-weapons-parallax-no-obstruction-feedback`
- **Where:** src/camera/CameraController.js:309-323, :370-375; src/simulation/PlayerWeapon.js:195-203; src/styles/junkyard.css:72-106, :185
- **What's wrong:** The chase camera looks exactly through `chaseAnchor` (`subject.height * this.followHeight + 0.5 * this.followScale` = 2.87 units up), while the muzzle is at y = 1.65. Commit 9b384c9 deliberately removed the shoulder offset that existed at 6de221e (`const shoulder = Math.min(this.followSubject.height * 0.55, ...)`) when it switched held aim to eye level. The reviewer's sampling around the Leaper was reproduced exactly:
  ```
  2,304 position/target samples: crosshair on the Leaper 2,130 times; muzzle ray stopped by cover first 101 times (4.7%),
  often within 0.2-0.7 units of the gun; 52 times the camera saw cover but the gun had a clear line
  ```
  The reticle has only `data-aim`, `data-hit`, `data-big` and `data-crit` states. There is nothing for "blocked".
- **Why it matters (plain language):** About one shot in twenty where the crosshair is clearly on the Leaper actually hits a crate or tyre right in front of Lola, and nothing on screen explains why. Players read that as "my shots don't register".
- **What it holds back:** Trustworthy hit feedback, cover-heavy levels, and tuning cover placement in the junkyard.
- **How to fix:**
  1. In `PlayerWeapon.update`, once per frame while `available`, compute the crosshair point (using the fixed `sightRay()` from the first finding) and cast the muzzle ray toward it. Use a cached muzzle point (see the effects finding) to keep this cheap. If cover stops the ray more than ~0.3 units short of the crosshair point, set `this.reticle.dataset.blocked = 'true'` and place a small `#playerBlocked` marker at the obstruction point, projected to the screen with `point.project(camera)`.
  2. Add CSS for `#playerReticle[data-blocked=true]` (for example a grey reticle) and the marker.
  3. Only if the owner wants it back: reintroduce a small shoulder offset in `chaseAnchor` and mirror it in `aimChaseAt`. This is a framing decision, because the offset was removed on purpose.
  4. Confirm: add a browser-combat check that puts a thin box between the muzzle and the Leaper but below the camera ray, and asserts `data-blocked === 'true'` after one `update()`.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] "First-person aim" hides all of Lola: no gun or hands in view, her shadow vanishes, and the camera cuts 4.45 units in one frame each way  `aim-weapons-ads-hides-whole-body`
- **Where:** src/simulation/PlayerWeapon.js:234-247; src/camera/CameraController.js:288-307; src/simulation/PlayerWeapon.js:201
- **What's wrong:** While aiming, `beforeRender` sets `this.p.target.mesh.visible = false`. Three r128's shadow pass skips invisible objects (`WebGLShadowMap.js: if ( object.visible === false ) return;`), so her shadow goes too. The aim view (screenshot work/review-aim-weapons/ads-view.png) shows no gun, hands or shadow, and tracers start from the hidden gun below the screen. The camera position is set straight to the eye (`this.followSubject.eyePosition(this.camera.position)`); only the field of view eases (line 290). Leaving aim snaps straight back to the boom. The player chapter covers the related missing aim pose (`player-no-aim-offset`).
- **Why it matters (plain language):** Aiming feels like a floating crosshair rather than raising a rifle. The jump in and out of eye level is jarring, and Lola's shadow popping in and out is a visible glitch.
- **What it holds back:** Gun and scope art, per-gun aim feel, readable muzzle flashes while aiming, and the ARC Raiders-style look.
- **How to fix:** Pick one model.
  - **(a) Over-the-shoulder aim, as in ARC Raiders.** Keep Lola visible. In `CameraController.update` add an `aimBlend` value that runs 0→1 over about 0.15 s, and interpolate camera position, look direction and FOV between the chase pose and a short shoulder boom.
  - **(b) True first-person aim.** Instead of `mesh.visible = false`, set `colorWrite = false` **and** `depthWrite = false` on Lola's materials during aim, and restore them afterwards. She still casts a shadow, because the shadow pass uses its own depth material. Without `depthWrite = false` her invisible arms would punch holes in the world. Do **not** use `THREE.Layers` for this on r128: the shadow pass tests layers against the main camera, so the shadow would vanish too. Render a gun viewmodel (a clone of `outfit.shotGun` in a small separate scene with its own camera) after `renderer.clearDepth()`, and ease the camera position as well as the FOV.

  Confirm either way with a screenshot while aiming in which Lola's shadow is still on the ground, and with a browser check that no single frame moves the camera more than ~0.5 units during aim enter or exit.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] PlayerWeapon does everything and is wired to exactly one Leaper and two guns by index  `aim-weapons-playerweapon-god-object`
- **Where:** src/simulation/PlayerWeapon.js:41-90, :115-117, :166-169, :262-277; src/robot/LolaPlayer.js:96, :136-139, :156, :161-173, :310-315
- **What's wrong:** One class mixes six global input listeners, DOM HUD creation and updates, the ammo and reload state machine, shot resolution, damage rules, audio, effects and render hooks. 33 lines reach into other systems through `this.p.*` (combat, target, cameraController, pov, engine, simulation). Targets are hard-wired: `enemyMeshes()` returns only `this.p.simulation.rig` parts. The two guns are chosen by index in many places: `get weapon() { return this.p.target.weaponIndex === 0 ? PLAYER_WEAPON.m416 : PLAYER_WEAPON.pistol; }`, the `ammo` array, `gunSlots`, `updateAmmoHud`, LolaPlayer's `{ Digit1: 1, Numpad1: 1, Digit2: 0, Numpad2: 0 }` and `this.weaponIndex = 1 - this.weaponIndex`. Correction to the reviewer: the pure `bulletHit` function *is* already Node-tested (`tests/leaper-leg-damage.test.js:36`). `fire()`, cooldown and reload are not, because the constructor needs a real DOM.
- **Why it matters (plain language):** Adding a third gun, a second enemy or a new enemy type means editing many tangled places in two big files. Bugs like the frame-rate fire rate can't be caught by quick automated tests.
- **What it holds back:** More weapons, more enemies or encounters, designer tuning, fast unit tests, and a clean target interface for merging with main's seeker work.
- **How to fix:**
  1. Create `src/config/weapons.js` with definitions keyed by id (`m416`, `pistol`).
  2. Create `src/simulation/WeaponState.js`, pure code with no DOM: ammo, an accumulator cooldown and reload, with `tick(dt, { trigger, reload })` returning events such as `fired`, `emptyClick` and `reloadDone`.
  3. Move shot resolution into a pure `resolveShot({ world, targets, sightStart, direction, muzzle, range })`.
  4. Move the DOM into `WeaponHud`.
  5. Give `LeaperCombat` a target list (`combat.targets = [{ hitObjects, applyHit(hit, weapon) }]`), so the weapon never touches `simulation.rig`.
  6. Give `LolaPlayer` an `equip(id)` method and look outfits up by weapon id.

  Confirm with new Node tests for `WeaponState` (cadence, empty click, reload) and `resolveShot` (cover beats enemy, backwards guard).
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] CameraController is one class for three games, other modules set its fields directly, and the Leaper's network code drives it  `aim-weapons-cameracontroller-flag-soup`
- **Where:** src/camera/CameraController.js:21-50, :168-183, :254-326, :400-416; src/main.js:64-65; src/simulation/JunkyardPlaytest.js:115-117, :129, :239-240; src/simulation/PlayerWeapon.js:94-109; src/camera/LeaperPov.js:19, :26-27; src/simulation/JunkyardBrain.js:107; src/simulation/LeaperSimulation.js:87, :112, :229-230
- **What's wrong:** It has three modes plus five flags. Fields are written from outside in main.js (`followSubject`, `pitch`), JunkyardPlaytest (`mapScale`, `followScale`, `topHeight`, `pointerId`, `target`), PlayerWeapon (`aiming`), LeaperPov (`spectator`, `pointerId`) and JunkyardBrain (`gameplayStarted`). `update()` is called from `LeaperSimulation.update/updateExternal` and synchronously from an input handler (`PlayerWeapon.js:109`). That ownership is the root cause of the stuck camera in the kill-shot finding. `beforeRender` reads `this.tempA`, left behind by `update`. `toggle()` (not `update`, as the reviewer wrote) edits scene fog. Main independently changed the same method to `update(state, eyePivot, deltaTime, chaseFocus = null)`, a second "follow something" mechanism and part of the merge conflict. (The reviewer's point that `LeaperPov` calling `document.exitPointerLock()` triggers a pause is only a latent hazard: the POV button can't be clicked while the pointer is locked.)
- **Why it matters (plain language):** Every new camera behaviour (death cam, intro fly-in, lock-on) means more if-branches in one fragile class. Changes in unrelated files (brain, POV, weapon) can break the camera, as the frozen-after-kill bug shows.
- **What it holds back:** New camera modes and blends, a settings menu (FOV, sensitivity, invert-Y), and merging with main's replay camera.
- **How to fix:**
  1. Introduce a `CameraRig` that owns look angles and input deltas.
  2. Add small mode objects (`ChaseCamera`, `AimCamera`, `TopCamera`, `LensCamera`, `SpectatorCamera`), each with `update(rig, dt) → pose`, and a tiny state machine that blends poses.
  3. Call it once per frame from the game loop, after gameplay.
  4. Replace field writes with methods (`setFollowTarget`, `setAiming`, `setSpectator`, `setMapScale`). Have `LeaperPov` use `SpectatorCamera` and `releaseMouse()` instead of poking `pointerId` and `exitPointerLock`.
  5. Express main's `chaseFocus` as a focus provider in the same interface to resolve the conflict.

  Confirm with the existing camera Node tests plus a test that the camera still turns after `combat.dead`.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Leaper hit detection uses its visible meshes and tags stored on them, so an art swap or new enemy breaks targeting, the weak point and joint damage  `aim-weapons-hitboxes-are-render-meshes`
- **Where:** src/simulation/PlayerWeapon.js:33-39, :166-169; src/simulation/LeaperLegDamage.js:34-38; src/robot/createHexapod.js:66-84, :125-132; src/simulation/LeaperCombat.js:172-174; src/simulation/CombatGeometry.js:54
- **What's wrong:** Shots run `ray.intersectObjects(enemies, true)` over `rig.robot` and the leg meshes. Damage zones are `userData` written onto render meshes:
  - joints: `leg[key].traverse(o => { o.userData.leaperJoint = { index: leg.index, joint }; })`
  - weak point: `weakPoint.userData.weakPoint = true`, on a 0.085-radius render sphere

  Detached parts rely on manual `userData.detached` filtering. By contrast, Lola is hit through simple capsules (`capsuleHit`).
- **Why it matters (plain language):** Replacing the procedural Leaper with an artist-made model would silently break knee shots, the eye weak point and damage. You also can't make a hit area more forgiving without changing the art.
- **What it holds back:** The Leaper art pass, new enemy types, designer-tunable hit areas and multipliers, and performance with detailed skinned models.
- **How to fix:**
  1. Add a hitbox list built in `createHexapod` (or read from enemy config): `{ object, shape: 'sphere'|'capsule', radius, zone: 'core'|'knee'|'shaft'|'body', multiplier }`, updated from bone or part world positions each frame.
  2. Test shots against it with the existing `capsuleHit`/`sphereHit` helpers (export `sphereHit`).
  3. Drive `LeaperLegDamage.hit` and the weak-point multiplier from `zone`.
  4. Optionally draw the hitboxes in a debug overlay.

  Confirm with the existing browser checks (knee break, weak point ×2) passing unchanged, plus a Node test of the hitbox ray.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Aim and weapon tuning is spread over five or more files, and the on-screen hint, README and TRAINING notes describe an older game; the pistol now out-damages the rifle undocumented  `aim-weapons-tuning-scattered-docs-stale`
- **Where:** src/simulation/PlayerWeapon.js:14-26; src/config/combat.js:2-18; src/simulation/LeaperLegDamage.js:12; src/camera/CameraController.js:8-19, :179, :289; src/simulation/LeaperHealthBar.js:11; src/simulation/JunkyardPlaytest.js:75; README.md:87-88; TRAINING.md:492-534
- **What's wrong:** The tuning knobs live in several places:
  - `PLAYER_WEAPON` and `BIG_HIT`: PlayerWeapon.js
  - `COMBAT`: config/combat.js
  - `LEG_HITS`: LeaperLegDamage.js
  - `AIM_ZOOM`, `SHAKE`, pitch limits and sensitivity: CameraController.js
  - the 55° chase FOV: hard-coded in CameraController.js:179 and 289, and copied in LeaperHealthBar.js

  The on-screen hint says `HOLD RIGHT CLICK</b> AIM ×1.25` while `AIM_ZOOM = 1.35`. README.md:87-88 says "**F** ... switches between M416 and Basic Gun ... Weapons are visual only; shooting is not implemented." The last TRAINING.md entry (2026-10-12) describes "one shot per left click, Q switches guns ... smooth 1.25× zoom" and a shoulder sight line, all replaced in 9b384c9 without a TRAINING entry. Balance moved too: commit 9b384c9 changed the pistol interval from 0.6 to 0.2 s and made the M416 automatic at 1/7 s. TRAINING.md:503 still records "pistol 6 per shot (~10 DPS), M416 2 (~16.7 theoretical DPS)". Today the pistol is up to 30 DPS (about 20 sustained with reloads) and the rifle about 13 (about 9 sustained).
- **Why it matters (plain language):** You can't find all the aiming and gun settings in one place, and the written notes describe a different game. The pistol now does roughly twice the rifle's damage over time, and nothing records whether that was intended.
- **What it holds back:** Designer tuning and balancing, onboarding collaborators, and trusting the docs during the merge with main.
- **How to fix:**
  1. Create `src/config/weapons.js` (weapon definitions, `BIG_HIT`, `LEG_HITS`, weak-point multiplier) and `src/config/camera.js` (chase/aim/top FOVs, `AIM_ZOOM`, pitch limits, sensitivity, shake, boom). Import them in `CameraController`, `LeaperHealthBar` and `PlayerWeapon`.
  2. Build the controls hint in `JunkyardPlaytest` from `AIM_ZOOM`.
  3. Rewrite README "Controls" (1/2 switch guns, left click fires, hold right click aims, R reloads).
  4. Add a dated TRAINING.md entry recording the current weapon values and the open pistol-versus-rifle balance question.

  Confirm by grepping for `1.25` and `55` in src: none should remain outside the config files.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The camera browser test page fails, no browser test is wired into a script, and none of the suites catch the aiming bugs above  `aim-weapons-browser-tests-stale-unwired`
- **Where:** tests/camera-player.js:26-27; src/camera/CameraController.js:193; tests/camera-preview.js:16-19; package.json:10-14
- **What's wrong:** Re-run during verification:
  ```
  PASS crosshair is above Lola head, not on her neck
  FAIL Error: mouse look without any button pressed  at camera-player.js:27:3
  TITLE: FAIL · Camera and footsteps
  ```
  The check predates mouse look becoming capture-only (`if (!locked && !this.fallbackMouseLook && event.pointerType === 'mouse' && this.mode === 'CHASE') return;`). `package.json` has only `dev`/`build`/`preview` scripts. `camera-preview.js` copies the boom maths with old constants (`multiplyScalar(11.5)`, `-0.55`). The browser-combat page passes 155/155 in about 4 s, but has no check for backwards shots, aim pitch reach, fire cadence at different frame rates, or kill-shot effects.
- **Why it matters (plain language):** Aiming and camera regressions go unnoticed until someone plays. A failing check has been sitting unnoticed, which weakens every "tests pass" note.
- **What it holds back:** Safe refactoring of camera and weapon code, merging with main, and continuous integration.
- **How to fix:**
  1. In `tests/camera-player.js` before line 26, call `controller.enableFallbackLook()` so "captured" mouse look is tested. Add a check that without capture the yaw does **not** change.
  2. Add `"test": "node --test tests/*.test.js"` and `"test:browser": "node scripts/run-browser-tests.mjs"`. The second is a Playwright script that starts Vite on a fixed port, opens each `tests/*.html`, and fails on `FAIL` in `#results`.
  3. Make `camera-preview.js` use `CameraController` instead of copied maths.
  4. Add the browser checks named in the other findings.

  Confirm: `pnpm test:browser` prints PASS for all pages.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Automatic fire rate depends on frame rate (6.0 / 6.67 / 6.86 shots per second at 30 / 60 / 144 fps instead of 7)  `aim-weapons-frame-rate-dependent-fire-rate`
- **Where:** src/simulation/PlayerWeapon.js:192, :287, :305-306; src/main.js:88
- **What's wrong:** `this.remaining = Math.max(0, this.remaining - dt);` throws away the overshoot. The gun fires only when `this.remaining === 0`, and `fire()` then resets `this.remaining = this.weapon.interval`. So every shot waits for a whole number of frames. Reproduced: 30 fps → 166.7 ms per shot (6.0/s), 60 fps → 150 ms (6.67/s), 144 fps → 145.8 ms (6.86/s). Severity is calibrated down from medium: at the common 60 fps the loss is under 5%, but at 30 fps the rifle does 14% less damage.
- **Why it matters (plain language):** The rifle never fires at its written rate, and slower laptops get a weaker rifle. Time-to-kill differs between machines, so balance numbers never quite match the docs.
- **What it holds back:** Reliable weapon balancing and fair play across hardware.
- **How to fix:** In `PlayerWeapon.update`, replace lines 287 and 305-306 with an accumulator, and in `fire()` add the interval instead of overwriting it:
  ```js
  this.remaining -= dt;
  while (this.triggerHeld && this.weapon.automatic && this.remaining <= 0
         && this.reloadRemaining === 0 && this.ammoState.mag > 0) {
    if (!this.fire()) break;          // fire() does: this.remaining += this.weapon.interval
  }
  this.remaining = Math.max(this.remaining, -this.weapon.interval);
  ```
  Keep the click path as `this.remaining = Math.max(this.remaining, 0) + interval`. Confirm with a browser-combat check that holds the trigger for 3 s at dt = 1/30 and counts 21 ± 1 shots (a Node test once `WeaponState` exists).
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Visibility and the hit shudder work by changing the scene around one render() call through three paired hooks (order-dependent, no error safety)  `aim-weapons-render-hooks-fragile`
- **Where:** src/main.js:95-101; src/camera/CameraController.js:400-424; src/camera/CameraOcclusion.js:61-81; src/simulation/PlayerWeapon.js:234-247; src/camera/LeaperPov.js:49-58; src/simulation/GunshotEffects.js:61-69; src/robot/createHexapod.js:84
- **What's wrong:** `main.js` must call `cameraController.beforeRender(); playerWeapon.beforeRender(); pov.beforeRender(); render; pov.afterRender(); playerWeapon.afterRender(); cameraController.afterRender();` in mirror order, with no `try/finally`. The hooks change material opacity, swap wall materials, hide Lola or the Leaper, and rotate the robot body. Severity is calibrated down from medium:
  - The leg-detach effect the reviewer described is real in principle (legs are separate scene children), but measured as a 0.035-unit gap at full rifle kick with a 0.03 s half-life, which is invisible.
  - The shadow loss belongs to the aim finding above.
  - A render exception would leave Lola hidden permanently, but render exceptions are rare.
- **Why it matters (plain language):** Today it works. But any extra view (minimap, picture-in-picture, screenshot tool) has to copy all six hooks or it shows the wrong thing.
- **What it holds back:** A minimap or second views, a first-person viewmodel, and multiple enemies (the shudder is one global value for one robot).
- **How to fix:**
  1. Wrap the render in `try { ... } finally { after hooks }` now.
  2. Later, apply the shudder in `update()` to a child `visualRoot` group of the robot (the legs stay posed by the gait code, so no restore is needed).
  3. Compute Lola's fade and wall fades in `update()` and keep them until the state changes.
  4. For per-camera hiding, use `colorWrite`/`depthWrite` or a separate viewmodel pass. `THREE.Layers` on r128 also hides shadows, because the shadow pass tests layers against the main camera.

  Confirm with the existing `render restores original character materials` and shudder-restore browser checks.
- **Effort:** M  ·  **Quick win:** no (the try/finally alone is)

#### [LOW] Shots fire inside DOM mouse callbacks, so the click that recaptures the mouse (after Alt-Tab) also fires a bullet  `aim-weapons-input-scattered`
- **Where:** src/simulation/PlayerWeapon.js:75-89, :108-109; src/camera/CameraController.js:51-57, :81-92, :113; src/robot/LolaPlayer.js:161-173; src/controls/InputController.js:8-15; index.html:81-85
- **What's wrong:** `canvas.addEventListener('mousedown', ... if (event.button === 0) { this.triggerHeld = true; this.fire(); })` has no capture check. The camera's `pointerdown` handler uses the same click to call `captureMouse()`. After Alt-Tab, focus loss releases the mouse but leaves `gameplayStarted` true, and the game keeps running. The click back into the 3D view then both recaptures and shoots. Verified that a real left click on the canvas fires while the mouse is not captured (magazine 20 → 19). Because firing happens in a DOM callback, `setAiming` needs a synchronous `cameraController.update(..., 0)` ("A left click arriving before the next frame must already use the eye view"). The broader input architecture (five listener modules, no gamepad, touch with only joystick/SPRINT/JUMP, no rebinding) is covered in the core-loop and player chapters. On touch, a tap probably still fires through the browser's emulated mouse click, but there is no hold-to-fire and no aim, so that claim is narrowed here.
- **Why it matters (plain language):** Every time the player clicks back into the game after switching windows, Lola fires an unintended shot, wasting ammo and possibly giving away her position.
- **What it holds back:** Clean input handling, settings and rebinding, and gamepad or touch play.
- **How to fix:**
  1. Quick fix: at the top of the `mousedown` handler, return early when the click is the capture click: `const cc = this.p.cameraController; if (cc.gameplayStarted && document.pointerLockElement !== canvas && !cc.fallbackMouseLook) return;`. This keeps the intended "Lola can fire while the run is stopped" behaviour, because `gameplayStarted` is false then.
  2. Proper fix: an `InputActions` module (described in the core-loop chapter) sampled once per frame, with `PlayerWeapon.update` reading `fire`/`aim`/`reload`. The synchronous camera update in `setAiming` can then go.
  3. Confirm: a browser-combat check that sets `gameplayStarted = true` without a lock, dispatches `mousedown` button 0, and asserts the magazine is unchanged.
- **Effort:** S (quick fix) / M (action map)  ·  **Quick win:** yes

#### [LOW] Aim view maths borrows the chase camera: the mouse wheel tilts the aim by up to 2.4°, zoomed sensitivity isn't scaled, and vertical look is 36% slower than horizontal  `aim-weapons-ads-view-coupled-to-chase`
- **Where:** src/camera/CameraController.js:96-112, :209-211, :301
- **What's wrong:** The wheel handler changes `this.distance` in every non-TOP mode, including while aiming. The aim ray is `-Math.sin(this.pitch) + 0.35 / this.distance`, so wheeling from 6 to 22 moves the crosshair by 0.35/6 − 0.35/22 = 0.042 rad = 2.43°. Look uses `this.yaw -= deltaX * 0.0055` and `CHASE_VERTICAL_SENSITIVITY = 0.0035` in both views, so vertical is 36% slower and on-screen motion is 1.35× faster when zoomed.
- **Why it matters (plain language):** Scrolling while aiming nudges the crosshair off target. Zooming in makes the view twitchier just when precision matters, and uneven up/down versus left/right speed feels "off".
- **What it holds back:** Precise aim feel, and a single sensitivity setting with an aim multiplier.
- **How to fix:**
  1. In the wheel handler, `if (this.aiming) return;`.
  2. In `onPointerMove`, multiply deltas by `Math.tan(fovRad / 2) / Math.tan(55° / 2)` while aiming (about 0.74).
  3. Move `0.0055`/`0.0035` into `LOOK_SENSITIVITY` and `VERTICAL_RATIO` in a camera config.
  4. Once aim has its own angles, drop the `0.35 / distance` tilt and adjust `aimEyeAt` accordingly.

  Confirm with a Node test that a wheel event while `aiming` leaves `distance` unchanged.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Guns have no recoil or spread, and aiming doesn't slow Lola (scenery hits sharing the Leaper's impact sound is a recorded owner choice)  `aim-weapons-no-recoil-spread-ambiguous-hits`
- **Where:** src/simulation/PlayerWeapon.js:14-21, :206-213; src/simulation/GunshotEffects.js:30, :61-65; src/simulation/JunkyardBrain.js:135-136; assets/audio/sources.json:2-12; tests/browser-combat.js:231
- **What's wrong:** `PLAYER_WEAPON` has only damage, interval, magazine, reserve and reload fields. Shots are perfect hitscan with no spread or camera kick; the only "kick" rotates the Leaper. Movement passes `sim.input.sprinting ? 8 : 4.5` regardless of `aimHeld`. Correction to the reviewer: the shared impact sound is not an oversight. `sources.json` marks `scenery-hit` "disabled at user request; preserved source only", and a browser check asserts 'scenery uses the same impact recording as the Leaper'. Recoil and spread are missing features, not bugs, so this is low priority while gap-filling is on hold.
- **Why it matters (plain language):** The rifle and pistol differ only in numbers, and aiming while sprinting is as accurate as standing still. That limits how distinct the guns can feel, but nothing is broken.
- **What it holds back:** Distinct weapon identities and skill expression (burst control, aim versus hip-fire).
- **How to fix (when gap-filling resumes):**
  1. Add `recoil: { pitch, yawJitter, recovery }`, `spread: { hip, aim, moving }` and `aimMoveScale` to each weapon definition.
  2. Apply recoil through a new `CameraController.addRecoil()` that recovers in `update`.
  3. Add cone spread to the muzzle direction in `fire()`.
  4. In `JunkyardBrain.update`, scale speed by `aimMoveScale` while `target.aimHeld`.
  5. Revisit the scenery sound only if the owner asks.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Gunshot effects create new GPU objects every shot and re-upload tracer buffers every frame; the muzzle lookup scans every gun vertex per shot  `aim-weapons-effects-allocation-churn`
- **Where:** src/simulation/GunshotEffects.js:15-27, :31-39, :45, :55-57; src/robot/LolaPlayer.js:381-395; src/simulation/PlayerWeapon.js:157, :193
- **What's wrong:** Each shot creates a new `Line` plus `BufferGeometry` plus `LineBasicMaterial` and a new cone mesh. Each enemy hit adds 5–9 tetrahedra, each with its own geometry and material. `update()` calls `geometry.setFromPoints(...)` per tracer per frame, and in r128 that does `this.setAttribute( 'position', new Float32BufferAttribute( position, 3 ) )`, a new buffer each call. `muzzlePosition()` loops over all 432/944 gun vertices with `points.push(vertex.clone())` (about 0.36 ms). `fire()` also runs `scene.updateMatrixWorld(true)` over 355 objects. `fire()` measured 1.8–3.4 ms in verification. Disposal is correct.
- **Why it matters (plain language):** Fine today. With faster or multiple weapons, or more enemies, it causes small stutters on weaker laptops.
- **What it holds back:** Shotgun- or minigun-style weapons, multiple enemies, and mobile performance.
- **How to fix:**
  1. Share one geometry and material per effect type and pool the meshes (or one `InstancedMesh` for sparks).
  2. Update tracer endpoints in place (`positions.setXYZ(...)`, `needsUpdate = true`), as `EyeVision.show` already does.
  3. Compute the muzzle tip once in the gun's local space when Lola loads (or add a `Muzzle` empty in `scripts/export_lola_clips.py`) and transform it per shot.
  4. Update only Lola's and the robot's matrices instead of the whole scene.

  Confirm with the existing effect-cleanup browser checks and `renderer.info.memory.geometries` staying flat during a 20-shot burst.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Every bullet and camera ray tests ~98,600 map triangles one by one, against frozen snapshots built separately for camera and combat  `aim-weapons-map-raycast-bruteforce-snapshot`
- **Where:** src/simulation/CombatGeometry.js:5-24; src/camera/CameraOcclusion.js:6-10; src/simulation/LeaperCombat.js:21
- **What's wrong:** `CombatGeometry` copies `mesh.matrixWorld` once with `matrixAutoUpdate = false`, and `hit()` runs `intersectObjects(this.meshes, false)` with no acceleration structure. The reviewer measured 106 meshes, 98,632 triangles, about 0.22 ms per ray and 0.27 ms per chase-camera update. `CameraOcclusion` and `LeaperCombat` each build their own wrapper set over the same map. The underlying geometry buffers are shared, so only the wrappers are duplicated.
- **Why it matters (plain language):** Cheap enough now (about 1 ms per frame). The cost grows with every extra enemy and projectile, and anything that moves (a falling car, a destructible barricade) will be invisible to bullets and camera collision.
- **What it holds back:** Movable or destructible cover, more enemies and bigger maps.
- **How to fix:**
  1. Build one shared `WorldCollision` service in `createJunkyardWorld` and pass it to the camera, combat and weapon.
  2. Give it a `refresh(object)` method for moved props.
  3. When three.js is upgraded, add a BVH (for example three-mesh-bvh) inside that service.

  Confirm with the existing camera-occlusion and cover browser checks.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The first frame after loading runs with a negative time step, so every system's first update runs backwards (new)  `aim-weapons-first-frame-negative-dt`
- **Where:** src/main.js:84-89; src/simulation/PlayerWeapon.js:287
- **What's wrong:** `let previousTime = performance.now();` is taken at the end of module loading, but the first `requestAnimationFrame` timestamp can be *earlier* than that, because it marks when the browser frame began. `const deltaTime = Math.min(0.1, (currentTime - previousTime) / 1000)` caps the step from above but not below. Evidence:
  - The rAF timestamp came before the request time in 3 of 3 headless loads (by 1.7–12 ms).
  - In another load, a property trap caught the weapon cooldown being raised to 0.281 s by `PlayerWeapon.update` line 287 (`this.remaining = Math.max(0, this.remaining - dt)`), called from `animate` in main.js:92. That can only happen with dt ≈ −0.28 s.

  On that frame every animation mixer, easing and clock receives a negative step.
- **Why it matters (plain language):** Today the effect is small: for example, the gun can be locked for a quarter-second right after loading. But any future system that assumes time only moves forward (timers, physics, spawn clocks) can glitch on the first frame.
- **What it holds back:** Robust timers and any frame-step-sensitive system added later.
- **How to fix:** In `src/main.js`, clamp from below: `const deltaTime = Math.max(0, Math.min(junkyardMode ? 0.1 : 0.033, (currentTime - previousTime) / 1000));`. Confirm by logging the first `deltaTime` (it should be ≥ 0) and checking that `playerWeapon.remaining` is 0 right after load.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. Every reviewer finding held up at least in part. Severities were lowered for the knee-reach, frame-rate fire-rate, render-hook, input and recoil findings. The kill-shot finding was raised to high once the stuck in-head aim camera was found.

### Leaper combat, damage, health & encounter rules

**How it works today**

`JunkyardPlaytest` builds one `LeaperCombat` (`src/simulation/JunkyardPlaytest.js:62`), and that class runs nearly the whole fight. The Leaper's shooting is a small hand-written rule list in `AttackController.js`, not the RL brain. The checks run in order: dead or paused, then "can I see Lola", then "can my eye physically turn to her" (±45° yaw, −70°/+80° pitch), then "am I cooling down", then attack. An attack is a 0.6 s glow warning: the eye tracks Lola for 0.4 s, then the aim locks for 0.2 s. Then one bolt fires and a 1.13 s cooldown follows. If cover breaks the line of fire, the attack cancels and waits 0.35 s. The eyesight for shooting is computed separately from the brain's eyesight: a 270° view, a range of 22 × map scale, and cover rays against the real map triangles, aimed at Lola's head, chest or hips. Bolts sweep their whole travel distance every frame against cover and against a capsule-plus-sphere around Lola. Each hit costs her 8 of 100 HP.

Lola damages the Leaper with an instant bullet (`PlayerWeapon.fire`). Every bullet does two things. It counts against the leg joint it hit: 8–10 bullets snap a knee, 24–26 snap a long section. It also subtracts gun damage from 600 Leaper HP, and the red eye core takes double. A snapped joint drops debris, curls the stump up (`HangingLeg`) and lowers `rig.mobility` (−0.18 per lost leg, never below 0.25). Lower mobility only makes the brain take steps less often (`JunkyardBrain.js:138`) and lowers the body a little (`LeaperSimulation.js:223`). The brain's inputs never change, so the saved brain recipe is untouched. The fight ends when either health pool reaches 0. `finish()` stops the run, marks Lola `defeated` in both cases, and shows RESTART ENCOUNTER.

Combat counts as "paused" whenever `!walking || !brain.ready || document.hidden` (`LeaperCombat.js:200`). Stopping the run, Escape, START PLAYER mode and having no brain server all freeze the Leaper's attacks. Lola can still shoot, by deliberate design (TRAINING.md:517-520). Tuning sits partly in `src/config/combat.js` and partly as constants spread over about 8 other files.

**What's good**

- `AttackController` is small, has no engine or page dependencies, and runs on real elapsed time. Its warning is readable (track, lock, fire), it rechecks the locked line just before release, and it adds a recovery delay after a cancelled shot. `tests/combat.test.js` proves the shot rhythm is the same at 10, 30, 60 and 144 Hz.
- Bolt hits are fair. Each frame sweeps the full travel against both sides of the real map triangles, cover wins ties (`LeaperCombat.js:185`), and the capsule test is exact. A browser check fires a bolt at 1000 units/s into a thin wall and it does not pass through.
- The frozen brain is protected. The weapon eye swivels, but `EyeVision.pose()` always reports the neutral eye to the brain, and leg loss reaches the brain only as a slower step clock.
- Leg damage is well built: separate thresholds per joint with an injectable random source, cheap knees and tough long sections, debris that settles on the real floor using sub-steps, a damped hanging stump, detached parts removed from bullet targets, and a reset that frees cloned materials. All 24 leg-damage tests pass.
- `tests/browser-combat.html` is thorough. It runs 155 real-asset checks (warning and lock, cover cancel, pause, death, restart, crouch and jump hit points, weak point, leg breaks, health bar, camera shake, gun input), and it uses a stub brain (`brain: { ready: true }`), so it needs no Python. The node combat tests pass 28/28.
- Designers can add sound without code: drop a named `.wav` into `public/audio/` (see `SOUND-SLOTS.md`).
- Good feedback to build on: the floating health bar (trail, flash, punch, colour ramp, zoom-aware), camera shake on big hits and when debris lands, a weak-point hit-marker, a blue edge glow on joint breaks, and Lola's flinch, which uses the bolt's real direction.
- The fight is cheap to run: about 0.46 ms per frame on the 98k-triangle map.

**How professional game projects handle this**

Professional action games build an enemy like this as an actor made of separate parts. A *health/damageable* component holds hit zones (body, weak point, each limb) and sends events such as "damaged", "limb broken" and "died". The AI has three layers: *perception* (one shared set of sight and hearing rules), *decision* (a state machine or behaviour tree with explicit states such as Idle → Alert → Chase → Attack → Stagger → Downed → Dead) and *locomotion*. Here the RL brain would be the locomotion layer. Attacks are data entries (wind-up, active window, recovery, damage, range, telegraph effects and sound, cooldown). The decision layer picks them and may interrupt movement, for example to stop and pounce. An *encounter/game-mode* object owns win, lose, checkpoint and restart. Player health lives on the player, and the HUD listens for events. Tuning lives in data tables that designers can edit live, and integration tests run on every change. "Big robot" encounters in the ARC style add a signature movement attack (the leap), wind-ups you can hear, limb breaks that cause a stagger or a behaviour change, and a readable death collapse. This branch already has solid low-level pieces: the attack timer, the hit detection and the leg-break physics. It lacks the layer above them: health components, an enemy state model, an encounter object and a single tuning file.

**Findings**

#### [HIGH] All six legs can be shot off; the legless body keeps hovering at full height, walking and firing  `enemy-combat-six-legs-hover`
- **Where:** `src/simulation/LeaperLegDamage.js:12`, `src/simulation/LeaperLegDamage.js:115-122`, `src/simulation/LeaperSimulation.js:223-224`, `src/simulation/LeaperSimulation.js:260-263`, `src/simulation/JunkyardBrain.js:138`
- **What's wrong:** Nothing limits how many legs can break. Mobility bottoms out at 0.25, and the body drops by at most 0.1:
  ```js
  this.rig.mobility = Math.max(0.25, 1 - this.rig.damagedLegCount * 0.18);   // LeaperLegDamage.js:122
  const damageCrouch = Math.min(0.1, (this.rig.damagedLegCount || 0) * 0.04); // LeaperSimulation.js:223
  ```
  I re-ran the reviewer's script, which uses the real rig, simulation and leg damage:
  ```
  bullets to disable all 6 legs (worst case): 60  => body HP cost with M416 (2/bullet): 120 of 600
  disabled legs: 6  rig.mobility: 0.25
  body height before: 2.320  after (all legs gone, moving): 2.220
  lowest point of remaining leg stumps y: 3.709
  sim still moved to x = 4.00
  ```
  The attack code never looks at leg damage, so the floating body also keeps firing at the normal rate.
- **Why it matters (plain language):** The code calls knees "the smart target". About nine seconds of rifle fire on the knees leaves a body floating more than two metres up, with every stump curled above it, still chasing and shooting. Players who follow the intended tactic will see this.
- **What it holds back:** Leg destruction as real gameplay (crippled or downed phases) and believable damage states.
- **How to fix:**
  1. Quick version (S). Add `legs: { maxLost: 4, mobilityPerLeg: 0.18, minMobility: 0.25 }` to `COMBAT` in `src/config/combat.js`. In `LeaperLegDamage.hit()`, return `false` early once `this.rig.damagedLegCount >= maxLost`. Bullets still reach `damageLeaper`, so body damage keeps counting. Use the config values on line 122 in place of the hard-coded numbers.
  2. Better version (M). When the limit is reached, set `rig.downed = true`. In `LeaperSimulation.updateBody`, ease `bodyHeight` toward `floorHeight + ~0.6` (body resting on the floor). In `JunkyardBrain.update`, skip the step request while `rig.downed`. The server session does not time out (it is only evicted after 8 newer sessions), so stopping steps is safe. Keep the eye firing as a vulnerable "downed" phase, or give the core extra bonus damage. All of this happens in rendering and in the existing step clock, so the saved brain recipe is unaffected.
  3. Confirm with a node test in `tests/leaper-leg-damage.test.js`: hit every knee to its threshold, then assert `damagedLegCount <= maxLost` and that the robot's body height is close to the floor when downed.
- **Effort:** M · **Quick win:** yes (step 1 alone is under a day)

#### [HIGH] LeaperCombat is a catch-all: it owns Lola's health and HUD, the whole game's sound, debug UI and the encounter result  `enemy-combat-god-class-owns-player`
- **Where:** `src/simulation/LeaperCombat.js:17-76`, `src/simulation/LeaperCombat.js:82-85`, `src/simulation/LeaperCombat.js:119-126`, `src/simulation/JunkyardPlaytest.js:62-68`, `src/simulation/PlayerWeapon.js:206-218`, `src/styles/junkyard.css:46-67`, `tests/browser-combat.js:33-35`
- **What's wrong:** The enemy's combat class stores the player's health (`this.lolaHealth = this.config.lolaHealth`, line 82). It builds Lola's HUD `#combatHud` (lines 60-64). It creates the only sound system, `this.audio = new LaserAudio()` (line 41), and that system also plays Lola's footsteps (`JunkyardPlaytest.js:63`), the Leaper's footsteps and both guns (`PlayerWeapon.js:206-208`). It injects buttons into `playtest.panel` (lines 42-51, 67-74), sets the flag `rig.weaponControlled` (line 27), and writes `playtest.target.defeated` (lines 85, 122). `PlayerWeapon.js` reaches into combat internals 13 times and `JunkyardPlaytest.js` 6 times (grep `combat\.(audio|legs|geometry|damageLeaper|dead|leaperHealth)`). The HUD uses fixed element IDs that the CSS styles by ID. The browser test has to build a fake playtest with about 11 fields just to construct the class.
- **Why it matters (plain language):** The player's health is stored inside the enemy. Adding a second Leaper would give Lola two health bars, two copies of every HUD element and two sound systems. Every combat change touches the same file plus the playtest object.
- **What it holds back:** More enemies or enemy types, new levels, merging with main (whose playtest and camera code differ), and fast node tests of the fight rules.
- **How to fix (in small steps that keep behaviour the same):**
  1. Move `lolaHealth`, `damageLola` and the `#combatHud` build-and-update code into a new `src/gameplay/PlayerVitals.js`, owned by `JunkyardPlaytest` (or by `LolaPlayer`). `LeaperCombat` calls `playtest.vitals.damage(amount, direction)` when a bolt hits.
  2. Rename `LaserAudio` to `GameAudio`. Create it once in `JunkyardPlaytest` (or `main.js`) as `playtest.audio`, and pass it to `LeaperCombat` and `PlayerWeapon`. Replace every `p.combat.audio` with `p.audio`.
  3. Add `src/gameplay/EnemyHealth.js` (one per Leaper) that holds HP and the weak-point multiplier and extends `EventTarget`. It emits `damaged`, `legBroken` and `died`. `PlayerWeapon.fire` calls `enemy.health.damage(...)` instead of `p.combat.damageLeaper(...)`.
  4. Move the result, restart and `target.defeated` handling into an `Encounter` object (see the end-state and restart findings) that listens for `died`.
  5. Make HUD and debug buttons take a container element instead of searching `playtest.panel`.
  - To confirm: `tests/browser-combat.html` must still pass all 155 checks after each step. Add node tests for `PlayerVitals` and `EnemyHealth`, which no longer need a page.
- **Effort:** L · **Quick win:** no

#### [MEDIUM] Winning freezes Lola as if she had lost, and the dead Leaper just goes dark while still standing  `enemy-combat-end-state-freeze`
- **Where:** `src/simulation/LeaperCombat.js:119-126`, `src/robot/LolaPlayer.js:509-510`, `src/simulation/JunkyardBrain.js:139`, `src/simulation/JunkyardBrain.js:168`, `src/simulation/LeaperCombat.js:242-246`
- **What's wrong:** `finish()` runs `this.playtest.target.defeated = true;` for both `'LEAPER DEFEATED'` and `'LOLA DEFEATED'`. `LolaPlayer.move` starts with `if (this.defeated) return;`, and her animation mixer only advances inside that path (`LolaPlayer.js:679`), so after a *win* Lola freezes mid-pose and cannot move. The Leaper stops being posed (`if (this.frame && !encounterOver)`, `JunkyardBrain.js:168`) and keeps standing on its legs. Its eye light is set to 0 (`this.leaperHealth ? … : 0`). There is no collapse, no final beat and no death animation for either side.
- **Why it matters (plain language):** A win looks like the game crashed. The robot just switches off, and the player loses control of Lola at the moment they should be enjoying the kill. The planned "kill it, then interact with it" step has nowhere to happen.
- **What it holds back:** A kill payoff, walking up to or looting the wreck, the defeat and retry flow, and future checkpoints.
- **How to fix:**
  1. (S) In `LeaperCombat.finish(message)`, set `target.defeated = true` only when Lola's health is 0, and pass the winner explicitly (`finish('leaper' | 'lola', message)`). In `JunkyardPlaytest.update` / `PlayerWeapon.available`, keep blocking *shooting* after the encounter ends but let Lola walk.
  2. (M) On a Leaper kill, add a short "dying" step. Over about 0.8 s, ease `rig.robot.position.y` down to the floor (a `dyingTime` field read in `LeaperSimulation.updateBody`). Create a `HangingLeg` for every leg that is not yet disabled so the legs fold. Fade the eye, and fire `cameraController.shake(COMBAT.cameraShake.bigHit)`.
  3. (M) On a Lola loss, play a knockdown (or a crouch-and-tip) before showing the restart panel.
  - To confirm: add a browser check that after a Leaper kill `target.defeated === false` and that Lola's position changes when `target.move(1, 0, …)` is called. Visually confirm that the body comes to rest on the floor.
- **Effort:** M · **Quick win:** yes for step 1 (a few lines); the collapse is M

#### [MEDIUM] Without the local Python brain the Leaper never attacks, yet it can still be shot to a normal "win"  `enemy-combat-brain-gated-attacks`
- **Where:** `src/simulation/LeaperCombat.js:200`, `src/simulation/LeaperCombat.js:216-226`, `src/simulation/JunkyardBrain.js:103-112`, `src/simulation/PlayerWeapon.js:148-152`
- **What's wrong:** Combat pauses on `const paused = !p.walking || !p.brain.ready || document.hidden;`. When the brain server cannot be reached, `JunkyardBrain.fail()` sets `this.playtest.walking = false`, so pressing START RUN never starts the fight. The shooting rules themselves do not need the brain. The reviewer's run of the real game with no server showed `walking:false, brainReady:false, treeState:"paused", shots:0`, and 150 player shots still ended in `"LEAPER DEFEATED"`. *Correction to the original claim:* the combat logic **can** be tested without Python, because the browser harness uses a stub brain (`brain: { ready: true }`, `tests/browser-combat.js:34`). The issue is the real game page. Also, the larger problem, that the whole encounter depends on a local server and a gitignored checkpoint (`model_7757824/`), is a project-level brain dependency. Combat only inherits it.
- **Why it matters (plain language):** Anyone who opens the game without your Python setup (a teammate, a web build, or you after the brain server crashes) gets a Leaper that never moves or shoots and can be killed for free. A playtester will not know whether they are seeing a bug or a balance problem.
- **What it holds back:** Web release, sharing playtests, balancing the fight without Python, and automated end-to-end tests of the real page.
- **How to fix:**
  1. Separate "the encounter is running" from "the brain is ready". In `LeaperCombat.update`, use `const paused = !p.walking || document.hidden;`. In `JunkyardBrain.fail()`, stop clearing `playtest.walking` when the playtest opts into a fallback (e.g. a `?turret=1` URL flag or an OPTIONS checkbox). Leave movement off.
  2. When the brain is offline but the run is on, show `BRAIN OFFLINE · TURRET MODE` in `brainLabel`. The Leaper stays planted and the existing `AttackController` fires as normal. If wanted, add a slow body turn toward Lola in rendering only, so she cannot just walk outside the ±45° eye window.
  3. This does not touch the saved brain recipe. Longer term, main's in-browser ONNX path (`src/brain/LeaperBrain.js` on main) would remove the localhost:8767 dependency, but that needs an LSTM export with a parity test.
  - To confirm: with no server running, open `?map=junkyard&debug&turret=1`, press START RUN and check that `leaperPlaytest.combat.tree.shots` grows while Lola stands in view.
- **Effort:** S · **Quick win:** yes

#### [MEDIUM] Pistol out-damages the rifle about 2.2×, inverting the documented weapon roles  `enemy-combat-balance-vs-intent`
- **Where:** `src/simulation/PlayerWeapon.js:17-20`, `src/config/combat.js:3`, `src/config/combat.js:13`, `src/simulation/LeaperLegDamage.js:9-12`, `TRAINING.md:328`, `TRAINING.md:503-504`
- **What's wrong:** The current constants are `m416: { damage: 2, interval: 1/7, magazine: 20 }` and `pistol: { damage: 6, interval: 0.2, magazine: 15 }`. Re-running the numbers script gives:
  ```
  m416   burst DPS 14.0 | sustained DPS (with reload) 9.3  | TTK 600 HP: 64.4 s
  pistol burst DPS 30.0 | sustained DPS (with reload) 20.3 | TTK 600 HP: 29.6 s
  ```
  The design note at TRAINING.md:503-504 had the rifle stronger (pistol ~10 DPS at a 0.6 s interval, M416 ~16.7). The pistol interval later dropped to 0.2 s but its damage stayed at 6, which flipped the roles. *Correction:* with the rifle, the fight already lands in the intended 60–90 s window (TRAINING.md:328, "600 HP targets 60–90 seconds at … DPS of roughly 7–10"). Only the pistol, clicked at a sustained 5 per second, halves it. Leg breaks count bullets rather than damage, so the rifle is better only at snapping knees (1.43 s against 2.0 s per knee). Spare ammo is unlimited.
- **Why it matters (plain language):** The automatic rifle is a trap pick for damage: the sidearm kills the Leaper twice as fast. Players who find this will only use the pistol, and the fight gets shorter than you intended.
- **What it holds back:** Clear weapon roles, a difficulty curve, and future weapon or upgrade design.
- **How to fix:** Write each weapon's intended role next to its numbers (for example: rifle = leg breaker and pressure, pistol = slow precision). Then retune in `PLAYER_WEAPON`. Options: a pistol `interval` of about 0.45 s (≈13 DPS burst), or pistol `damage: 3`, or a per-weapon `legHits` value so leg breaking does not depend on raw bullet count. Add `scripts/balance-report.mjs` (based on the scratch `ttk.mjs`): it imports `PLAYER_WEAPON`, `COMBAT` and `LEG_HITS` and prints burst DPS, sustained DPS, time to kill and time per knee. Run it whenever these numbers change, so balance changes show up in review.
- **Effort:** S · **Quick win:** yes

#### [MEDIUM] The fight's best tests are run by hand, the fight rules cannot be tested in node, and package.json has no test script  `enemy-combat-tests-manual`
- **Where:** `package.json:9-13`, `tests/browser-combat.html:1-3`, `tests/browser-combat.js:33-35`, `src/simulation/LeaperCombat.js:42-74`, `TRAINING.md:348-353`
- **What's wrong:** `package.json` scripts are only `dev`, `build` and `preview`, and there is no CI folder. TRAINING.md:348-353 says to build the browser test with a hand-typed Vite command and serve it yourself. Automated with Playwright, it reports `PASS 155 … ALL 155 CHECKS PASSED`, and the node combat tests pass (`# tests 28 # pass 28`). Health, death, restart and result rules are checked only in the browser, because the `LeaperCombat` constructor needs `document` and `playtest.panel`. The branch already carries 4 failing node tests (in `tests/lola-player.test.js`) that nothing flagged.
- **Why it matters (plain language):** The most valuable combat checks run only when someone remembers to run them. Any rework or merge with main could quietly break the fight, and the failing Lola tests show this is already happening.
- **What it holds back:** Every refactor recommended in this chapter, safe merging with main, and confidence before a release.
- **How to fix:**
  1. Add to `package.json`: `"test": "node --test tests/*.test.js"` and `"test:browser": "node scripts/run-browser-tests.mjs"`.
  2. Write `scripts/run-browser-tests.mjs` (about 30 lines). It starts Vite programmatically (`createServer({ server: { port: 0 } })`), opens `/tests/browser-combat.html` in Playwright Chromium, waits until `document.title` starts with `PASS` or `FAIL`, prints `#results`, and exits non-zero on failure. If needed, copy the page-title convention from the scratch `run-browser-combat.cjs`.
  3. Add a GitHub Actions workflow that runs both scripts on every push.
  4. Then move the pure rules (health clamp, death, result label, practice or real) into a node-testable module, as described in the catch-all finding.
  - To confirm: `pnpm test` and `pnpm test:browser` both exit 0 locally (after the 4 Lola tests are fixed or marked as known failures).
- **Effort:** S · **Quick win:** yes

#### [MEDIUM] Getting hit is silent and has no direction, the wind-up has no sound, and missed bolts leave no impact  `enemy-combat-silent-hits-weak-telegraph`
- **Where:** `src/simulation/LeaperCombat.js:107-118`, `src/simulation/LeaperCombat.js:157`, `src/simulation/LeaperCombat.js:182`, `src/simulation/LeaperCombat.js:242-246`, `src/simulation/LaserAudio.js:16-22`, `public/audio/SOUND-SLOTS.md:11-13`
- **What's wrong:** The charge only changes glow (`base + charge * 8`, line 242). The only attack sound plays when the bolt is released (`this.audio.fire()`, line 157). At the default size a bolt crosses 20 units in about 0.17 s, so that sound is too late to react to. Nothing marks the moment the aim locks, even though that is when dodging starts to work. Bolts that hit cover just disappear (line 182: "No impact orb …"). `damageLola` plays only `lolaHitThud` and `lolaHurt`/`lolaHurtBig`, and `public/audio/` contains only `gun-empty.wav` and `leaper-knee-break-1.wav`, so every hit on Lola is silent. The bolt's direction is used only for Lola's flinch, with no on-screen direction cue. *Correction:* hits are not invisible. Lola flinches away from the shot, a HIT label appears, and her health readout highlights with a draining trail. The missing pieces are sound, direction and impact.
- **Why it matters (plain language):** There is no sound to time a dodge to, and when Lola is hit from off-screen the player only notices the health bar dropping. Fair combat needs both a sound cue and a visual cue for every danger.
- **What it holds back:** Readable, fair combat, a dodge skill, and accessibility.
- **How to fix:**
  1. Add three optional hooks to `AttackController`, `onStart`, `onLock` and `onCancel`, called where `started` is set (line 30), where `locked = true` is set (line 35) and in `cancel()`. `LeaperCombat` passes callbacks that use three new `OPTIONAL` slots in `LaserAudio.js`: `leaperCharge` (keep the returned source and `stop()` it on cancel), `leaperLock` and `boltImpact`. List them in `SOUND-SLOTS.md`.
  2. At the bolt's end in `updateProjectiles` (line 183), call a red-tinted version of `GunshotEffects.impact()` at `cover.point` or at the hit point on Lola.
  3. Add a small HUD arc that shows where a hit came from. Compute the angle from `incomingDirection` relative to `cameraController.yaw`, and show it for about 0.6 s.
  4. Fill the `lola-hurt-*` slots with recordings.
  - To confirm: add browser checks that `leaperCharge` plays at attack start and stops on a cover cancel, and that a bolt hitting the test wall creates an impact effect.
- **Effort:** M · **Quick win:** yes (the sound hooks and slots alone take under a day)

#### [MEDIUM] Encounter tuning is spread over about 8 code files and cannot be changed live  `enemy-combat-tuning-scattered`
- **Where:** `src/config/combat.js:2-19`, `src/simulation/PlayerWeapon.js:14-26`, `src/simulation/LeaperLegDamage.js:12`, `src/simulation/LeaperLegDamage.js:109-122`, `src/simulation/LeaperCombat.js:14`, `src/simulation/LeaperCombat.js:111`, `src/simulation/LeaperCombat.js:156`, `src/simulation/LeaperCombat.js:191-192`, `src/simulation/LeaperCombat.js:242-246`, `src/simulation/LeaperHealthBar.js:6-14`, `src/simulation/LeaperSimulation.js:223`, `src/simulation/HangingLeg.js:5-12`, `src/simulation/LaserAudio.js:12-22`
- **What's wrong:** `combat.js` holds health, bolt damage, timings, aim limits, health-bar and shake values. Weapon damage, fire interval and magazine size live in `PlayerWeapon.js:17-20`. Leg thresholds are in `LeaperLegDamage.js:12`, mobility in `:122` (`1 - count * 0.18`, floor 0.25), body sag in `LeaperSimulation.js:223`, eye-glow multipliers in `LeaperCombat.js:242-246`, hit and fire flash timings at `:111`/`:156`, health-bar hit-reaction constants (`HIT`) in `LeaperHealthBar.js:14`, and sound levels in `LaserAudio.js:12`. `COMBAT` is a frozen JS object. `LeaperCombat` reads `COMBAT.cameraShake`/`COMBAT.healthBar` directly in places (lines 30, 39, 103) instead of its own `this.config`.
- **Why it matters (plain language):** To balance the fight you have to hunt through code files and rebuild. Related numbers drift apart: the weapon-balance mix-up above is one result.
- **What it holds back:** Designer-led tuning, difficulty settings, and fast balance iteration.
- **How to fix:**
  1. (S–M) Create `src/config/encounter-tuning.json`, the same JSON-import pattern as `player-contact.json`, with sections `leaper` (health, weakPointMultiplier, legs), `attacks.eyeBolt`, `lola`, `weapons.m416` / `weapons.pistol` and `feedback`. Make `combat.js` build `COMBAT` from it, and import it in `PlayerWeapon.js` and `LeaperLegDamage.js`. Add a small `validateTuning()` that throws on missing or negative values at startup.
  2. (M, later) Add a dev-only TUNING section under OPTIONS: number inputs bound to a mutable copy, saved to `localStorage`, with "export JSON" and "reset to file". For live edits to work, classes must read values when they use them, not copy them at construction (as `LeaperHealthBar` and `createLaserVisual` do now).
  - To confirm: change `leaperHealth` in the JSON, reload, and check that the debug damage button needs a different number of presses. All existing tests still pass.
- **Effort:** M · **Quick win:** yes (step 1)

#### [MEDIUM] Only one attack exists; the brain's chase has no payoff because reaching Lola does nothing  `enemy-combat-single-attack-no-chase-payoff`
- **Where:** `src/config/combat.js:3`, `src/simulation/LeaperCombat.js:185`, `src/world/playerContact.js:3-17`, `src/simulation/JunkyardBrain.js:31-48`, `src/simulation/JunkyardBrain.js:187`
- **What's wrong:** `damageLola` is only ever called from a bolt hit (`LeaperCombat.js:185`). The contact shape only blocks movement ("block moving further in, but always allow backing out", `JunkyardBrain.js:33-48`). Leaper-on-Lola contact only adds text: `${this.frame?.collision ? ' // CONTACT' : ''}` (line 187). *Calibration:* this is a missing feature, not broken code, so it is rated medium rather than high. It is still the biggest design gap in the fight.
- **Why it matters (plain language):** The RL brain was trained to hunt Lola down, but catching her costs her nothing. Standing between its legs is as safe as standing at range, so the chase builds no tension and the "Leaper" never leaps or stomps.
- **What it holds back:** The encounter's identity, any reason to keep distance or dodge, and the payoff from the RL work.
- **How to fix:**
  1. (M) Add a stomp as a data entry, `COMBAT.attacks.stomp = { windup: 0.5, radius: 1.0, damage: 20, cooldown: 3 }`. Run it from `LeaperCombat.update`: when `leaperClearance(lola.x, lola.z, leaperPose, scale)` (from `playerContact.js`) stays below `radius` for the wind-up, telegraph it with a body dip (`simulation.state.crouch`, render only) and a new `leaperStomp` sound slot. Then apply damage if Lola is still inside the radius. Route the damage through the same path as bolt damage so the HUD and death rules apply.
  2. (L, later) Add a leap: pause brain steps, animate a jump arc on screen, then put the server session at the landing point. That needs a new server message or a `reset` with the new position, so it is an interface change to plan with the brain owner. It does not change the observation layout.
  - To confirm: add a browser check that places Lola inside the stomp radius and verifies health drops by `damage` after `windup` seconds, and does not drop if she leaves in time.
- **Effort:** M · **Quick win:** no

#### [MEDIUM] No enemy state model: movement, attack, leg damage and death are separate islands  `enemy-combat-no-state-model`
- **Where:** `src/simulation/AttackController.js:1-2`, `src/simulation/AttackController.js:13-27`, `src/simulation/LeaperCombat.js:97-106`, `src/simulation/LeaperCombat.js:119-126`, `src/simulation/LeaperLegDamage.js:115-122`, `src/simulation/JunkyardBrain.js:168`, `src/simulation/GunshotEffects.js:61-65`
- **What's wrong:** `AttackController`'s "states" are HUD strings (`'target hidden'`, `'tracking'`, `'charging'`, …), and by design it has no movement (lines 1-2). A leg break only sets `leg.disabled`, `rig.mobility` and a `major` flag that pops the health bar and shakes the camera (`LeaperCombat.js:101-103`), and the attack rhythm carries on. The only body reaction to a hit is a render-only jolt that is undone after drawing (`GunshotEffects.js:62-67`). Death is a freeze (`JunkyardBrain.js:168`). *Calibration:* this is a missing layer that overlaps with the catch-all finding, not something broken, so it is rated medium rather than high.
- **Why it matters (plain language):** Standard boss tools, such as staggering when a leg snaps, getting angrier at low health or collapsing on death, have nowhere to live in the code. Each one would become another one-off flag spread across four files.
- **What it holds back:** Fights with several attacks and phases, stagger as a reward for leg shots, death presentation, and reusing the logic for other enemies.
- **How to fix:** Add `src/simulation/LeaperBehavior.js`, a small state machine (`engage → stagger → downed → dying → dead`) that coordinates the existing parts and is updated from `LeaperCombat.update`. In `engage`, the brain moves and `AttackController` shoots. `stagger` (entered on a `legBroken` event) calls `tree.cancel()` and pauses brain steps for about 0.6 s through a flag checked in `JunkyardBrain.update`. `downed` and `dying` are the states from the six-legs and end-state findings. Phases are data, e.g. `COMBAT.phases: [{ belowHealth: 0.3, shotIntervalScale: 0.7 }]`, read by `AttackController`. The brain is only paused or resumed and never fed new inputs, so the recipe stays frozen. Confirm with node tests that drive `LeaperBehavior` with fake events and check the state sequence and timers. It has no engine dependencies, like `AttackController`.
- **Effort:** L · **Quick win:** no

#### [LOW] Lola's damage keeps working while the Leaper is paused, and a practice kill is reported as a real win  `enemy-combat-pause-not-pause`
- **Where:** `src/simulation/PlayerWeapon.js:148-152`, `src/simulation/JunkyardPlaytest.js:23`, `src/simulation/JunkyardPlaytest.js:71-74`, `src/simulation/LeaperCombat.js:104`, `tests/browser-combat.js:234-235`, `tests/browser-combat.js:248-253`
- **What's wrong:** `PlayerWeapon.available` checks only `!p.combat.dead && !p.pov.active && mode === 'CHASE' && !document.hidden`, so Lola can damage a paused Leaper after Escape, STOP RUN or in START PLAYER mode. *Correction and calibration:* this is a deliberate, documented and tested choice. TRAINING.md:517-520 says "Removed the Leaper running/brain-ready gates from Lola's weapon". The START PLAYER button's tooltip says "Move and shoot as Lola while the Leaper stays still", and the browser test asserts "Lola can fire while the Leaper run is stopped". After Escape the camera also stops following the mouse, which makes exploiting it awkward. The real defect is smaller: a kill against a frozen Leaper ends the encounter with the same `'LEAPER DEFEATED'` text as a real win. Only the debug button gets its own label (line 104).
- **Why it matters (plain language):** Practice shooting is a useful designer tool, but its kills look exactly like real wins. That will confuse playtest reports and kill-time measurements, and the game has no true pause.
- **What it holds back:** Reliable kill-time measurements and a future real pause menu.
- **How to fix:** In `LeaperCombat.damageLeaper`, record whether the Leaper was paused (`!p.walking || !p.brain.ready`) when the killing shot landed, and finish with `'PRACTICE · LEAPER DEFEATED'` in that case, the same way the debug label works. When a real pause menu arrives, add `&& !p.encounter?.paused` to `PlayerWeapon.available`. Update the browser checks around lines 234-253 to expect the practice label after a stopped-run kill.
- **Effort:** S · **Quick win:** yes

#### [LOW] The gun's eyesight range does not match the brain's and changes with the size slider  `enemy-combat-two-perception-models`
- **Where:** `src/simulation/LeaperCombat.js:201-208`, `src/config/combat.js:4`, `rl/checkpoint_environment.py:23`, `rl/checkpoint_environment.py:38-39`, `rl/junkyard_env.py:21`, `rl/junkyard_env.py:82-89`, `src/world/createJunkyardWorld.js:21`
- **What's wrong:** Combat uses `const range = c.weaponRange * p.world.scale;` (22 map units × `scale`, where `scale = 7.98 / width`). The brain's sight stays in robot units: `RAY_MAX_RANGE = 28.0`, and the target counts as in view while `distance - TARGET_RADIUS(1.4) <= 28`, an effective 29.4 to Lola's centre. Re-run numbers: width 5.5 → gun 31.9, width 2.88 → 61.0, width 1.2 → 146.3, width 8 → 21.9. *Correction:* at the owner's default width of 5.5 the gap is small, about 2.5 units (29.4 against 31.9), and the two match near width 6.0, not 6.27. The mismatch only grows large when the slider moves toward small Leapers. Both systems use a 270° field. Combat looks from the swivelling eye and the brain from the neutral eye, which is a minor difference.
- **Why it matters (plain language):** At small Leaper sizes the robot can shoot Lola from twice as far as its brain "sees" her, so the HUD can say SEARCHING while bolts arrive. Hiding and cover design then become hard to reason about.
- **What it holds back:** Stealth and cover design, consistent tuning across Leaper sizes, and trustworthy awareness labels in the HUD.
- **How to fix:** Add `"sightRange": 28.0, "targetRadius": 1.4` to `src/config/eye-vision.json`, which both JS and Python already read. Have the Python constants read them too, *only if* the values stay identical, because they are part of the frozen recipe. In `LeaperCombat.update`, use `const range = Math.min(c.weaponRange * p.world.scale, eye.sightRange + eye.targetRadius);` and use the same value in `updateProjectiles`. Optionally require `p.brain.frame?.target_ever_seen` before the first shot, which reads server output only. Add a node test that loops widths 1.2–8 and asserts gun range ≤ brain range.
- **Effort:** S · **Quick win:** yes

#### [LOW] Shot-off legs still block Lola: the touch shape always includes all six legs  `enemy-combat-severed-leg-collision`
- **Where:** `src/world/playerContact.js:10-17`, `src/simulation/JunkyardBrain.js:33-48`, `rl/junkyard_env.py:60-71`
- **What's wrong:** `leaperDiscs()` loops over `shape.legAngles` from `player-contact.json` and never checks `rig.legs[i].disabled`. Re-run: `clearance at former foot of a severed leg (negative = Lola blocked): -1.450`. The Python server builds the same discs in `_player_clearance`.
- **Why it matters (plain language):** An invisible wall stays where a shot-off leg used to stand.
- **What it holds back:** Letting leg destruction open up new positions, such as finishing the Leaper from its crippled side.
- **How to fix:** Change both sides together. Add `disabled_legs: rig.legs.filter(l => l.disabled).map(l => l.index)` to the `/step` and `/sense` payloads in `JunkyardBrain.update`. Make `leaperDiscs(pose, disabled = [])` skip the outer two discs of those legs (keep the inner one, which covers the stump). Make `_player_clearance` in `rl/junkyard_env.py` skip the same discs. Bump `"version"` in `player-contact.json` from 3 to 4, which the existing check at `JunkyardBrain.js:85` enforces. This changes contact only, not observations. Re-run `python tests/test_junkyard_brain.py` and `tests/player-contact.test.js`.
- **Effort:** S · **Quick win:** no (touches the server, so it needs a server restart and a parity re-check)

#### [LOW] RESTART ENCOUNTER is not a clean retry: Lola stays where she was and keeps her half-empty magazines  `enemy-combat-restart-partial`
- **Where:** `src/simulation/LeaperCombat.js:66`, `src/simulation/JunkyardPlaytest.js:203-222`, `src/simulation/PlayerWeapon.js:249-260`
- **What's wrong:** The button runs `playtest.reset(); playtest.start();`. `reset()` always puts the Leaper back at spawn (line 226), but moves Lola only `if (spawn)` (line 208) or when she is too close to the Leaper's spawn (lines 209-222). `PlayerWeapon.reset()` never touches `this.ammo`, and nothing else does (grep shows `ammo` is only assigned in the constructor).
- **Why it matters (plain language):** Each retry starts from wherever the last attempt ended, so back-to-back playtests are not comparable.
- **What it holds back:** Repeatable playtests, a checkpoint and retry flow, and balance measurement.
- **How to fix:** In `JunkyardPlaytest.start()`, when starting a fresh encounter (not when resuming), save `this.encounterStart = { lola: target.mesh.position.clone(), lolaYaw, leaper: {...state.position}, leaperYaw: state.yaw }`. Make the restart button call `playtest.reset(this.encounterStart)`, or a new `restartEncounter()` that restores both positions. Add `PlayerWeapon.refill()`, which sets both `ammo[i].mag` back to the full magazine, and call it from that restart path.
- **Effort:** S · **Quick win:** yes

#### [LOW] In-game hint shows the wrong aim zoom, and the newest combat systems have no ledger entry  `enemy-combat-docs-drift`
- **Where:** `src/simulation/JunkyardPlaytest.js:75`, `src/camera/CameraController.js:19`, `tests/browser-combat.js:325`, `TRAINING.md:378`, `TRAINING.md:492`, `TRAINING.md:515-516`
- **What's wrong:** The on-screen controls hint says `HOLD RIGHT CLICK</b> AIM ×1.25`, while the code has `const AIM_ZOOM = 1.35;` and the browser test asserts 1.35. *Correction:* TRAINING.md is a dated ledger, so older entries such as "Pistol is click-per-shot at a 0.60-second interval" (line 492), "removed M416 hold-to-fire … Q still switches" (515-516) and "never above the enemy mesh" (378) were true when written. The defect is that no later entry records the changes. The pistol interval is now 0.2 s, the M416 is `automatic: true`, the gun keys are `1`/`2` (`LolaPlayer.js:163`), and the floating health bar exists. Leg damage, the weak point and the floating bar arrived in commit 9b384c9 (187 files) with no ledger entry (`grep -i knee TRAINING.md AGENTS.md` finds nothing).
- **Why it matters (plain language):** You read wrong controls on screen, and nobody can tell from the docs which current behaviour is intended.
- **What it holds back:** Tuning from the docs, onboarding, and merge reviews with main.
- **How to fix:** In `JunkyardPlaytest.js:75`, build the hint from the real constant: export `AIM_ZOOM` from `CameraController.js` and write `` `AIM ×${AIM_ZOOM}` ``. Add one TRAINING.md entry recording the current weapon numbers, gun keys, leg-damage thresholds, weak-point multiplier and floating health bar. Once the tuning file exists, have `scripts/balance-report.mjs` print a "current values" table to paste into `docs/combat-tuning.md`.
- **Effort:** S · **Quick win:** yes

#### [LOW] Losing legs makes the Leaper move in stop-start lurches rather than a smooth slowdown  `enemy-combat-mobility-lurch`
- **Where:** `src/simulation/JunkyardBrain.js:8-13`, `src/simulation/JunkyardBrain.js:138`, `src/simulation/JunkyardBrain.js:141`, `src/simulation/JunkyardBrain.js:168-173`, `src/simulation/LeaperLegDamage.js:122`
- **What's wrong:** Leg loss slows the Leaper by asking the brain for steps less often (`this.clock += dt * (sim.rig?.mobility ?? 1)`). Each step still moves the same fixed server distance, and the rendered body eases to each new pose at a fixed fast rate (`LEAPER_FOLLOW_RESPONSE = 18`). So the Leaper reaches each pose quickly and then waits for the next one. A small model of the same easing code (scratch `work/verify-enemy-combat/stutter.mjs`) gives:
  ```
  mobility 1:    step interval 0.100 s, share of frames below 20% of peak speed 14%
  mobility 0.46: step interval 0.217 s, share of frames below 20% of peak speed 57%
  mobility 0.25: step interval 0.400 s, share of frames below 20% of peak speed 76%
  ```
  This is a numerical model; it has not been confirmed visually in a browser.
- **Why it matters (plain language):** A badly damaged Leaper does not limp evenly. It lurches forward and stops about 2.5 times a second, which can read as lag rather than injury.
- **What it holds back:** Believable damage states and readable movement on a damaged enemy.
- **How to fix:** Rendering only, so the brain recipe is unaffected. In `JunkyardBrain.update`, scale the follow rates by mobility: `const m = sim.rig?.mobility ?? 1; const tPos = 1 - Math.exp(-LEAPER_FOLLOW_RESPONSE * m * dt);` (do the same for `tYaw`). Alternatively, interpolate linearly from `previousFrame` to `frame` over the expected step interval `0.1 / m`. Confirm by re-running the scratch model with the change (the share of stalled frames should stay near the full-health value) and by watching a 4-leg-down Leaper walk in the game.
- **Effort:** S · **Quick win:** yes

**Checked and rejected**

- *The weak point sits on the front centre line and always faces Lola, so centre-of-body aim crits every time* (`enemy-combat-weak-point-centre`). The "every shot crits" result came from placing the camera dead ahead of a neutral eye. A node check using the real rig, with the eye tracking Lola as `LeaperCombat.track` does, shows centre-of-body aim hits the core only at 0° bearing and misses at 10°, 20°, 30° and 45° (`work/verify-enemy-combat/weakpoint-node.mjs`). The reviewer's own grid scan crit only 2 of 53 hits. The core is a small glowing target that rewards precise aim, which is a normal weak-point design. Opening it only while the Leaper charges is a design idea, not a defect.

### Enemy brain: RL policy integration, inference server & AI design

**How it works today**

The Leaper's legs and body are steered entirely by a saved, trained "seeker" brain (a recurrent PPO policy with LSTM memory, 72,517 numbers, 34 inputs, 2 outputs: throttle and turn). The brain does not run in the browser. `src/simulation/JunkyardBrain.js` sends a small HTTP request about 10 times a second to a separate Python program, `rl/junkyard_server.py`, on `127.0.0.1:8767`. The server keeps one "brain session" per run. Each session holds a Python copy of the world rules (`rl/junkyard_env.py` on top of `rl/seeker_env.py` and `rl/checkpoint_environment.py`, which is a byte-identical copy of main's `rl_environment.py` at `7689aca`), the brain's LSTM memory, and Lola's position. For each step the server checks whether the Leaper can see Lola (3D eye lines from the Leaper's eye to three of Lola's bones, tested against the junkyard mesh), runs the network, moves the Leaper one step, and returns the new pose. The browser then eases the drawn Leaper toward that pose. Only one request is in flight at a time, and stale replies are discarded. After 5 failed steps in a row the brain goes OFFLINE. There is deliberately no substitute controller.

The same `JunkyardBrain` class also moves Lola from the keyboard, makes her jump, blocks her against the Leaper's body and leg discs (`src/world/playerContact.js` plus the shared `src/config/player-contact.json`), and writes the brain HUD text. Shooting is separate. `AttackController` (a small priority-selector behaviour tree inside `LeaperCombat`) aims and fires eye bolts using its own three.js line-of-sight check. It never steers the body, and it pauses whenever the brain is not ready. Leg damage only slows the brain's step clock (`rig.mobility`).

Verification note: the checkpoint folder `model_7757824/` is gitignored at the reviewed commit `9b384c9`. Since then the remote branch has gained one more commit, `be3f9fb` ("Include approved Leaper brain checkpoint for playback", 0.91 MB, SHA256 `883dade3…` matches the tests). Using those weights (read-only), all 9 Python brain tests pass, the real server answers `/step` in 67.6 ms on average (p95 93 ms) at the default width of 5.5, and the first `/reset` takes 29.4 s.

**What's good**

- Careful request handling in `JunkyardBrain`: one request at a time, a generation counter that throws away stale replies, a short retry budget, and pausing that keeps the last confirmed pose. All three `tests/junkyard-chase.test.js` tests pass.
- Honest perception: Lola's true coordinates never enter the brain's inputs. Only a "last seen" position is used, and it is updated only after a real visibility check. The paused `/sense` preview never touches memory. `test_hidden_target_does_not_leak` passes with the real checkpoint.
- The frozen world rules hold up when measured. In the original training arena (development seeds 30000-30039) the real checkpoint reaches the target in 95% of episodes with the branch's signed-reverse throttle and never gets stuck. With the "normalized" throttle meaning in the copied file it reaches 82.5% and gets stuck 6 times. So the reverse override in `rl/junkyard_env.py:35-38` matches how the brain behaves, and `reverse_urgency_config/config.json` (`"reverse": true`) backs it up.
- Shared config with a version handshake: `player-contact.json` and `eye-vision.json` are read by both JS and Python, and the browser refuses a server whose `contact_version` or `sight_version` differs (`JunkyardBrain.js:85-86`). This pattern should be extended to every shared constant.
- Safe local service: it binds only to 127.0.0.1, rejects other web origins with 403 (confirmed against the live server), limits request size to 4 KB, checks that positions and poses are finite and in range, refuses NaN in replies, and caps sessions at 8.
- Good eye-level sight design: three Lola bones, so crouching and jumping matter; double-sided hits on thin overhead geometry; and debug lines that draw the server's actual result. It has focused unit tests.
- The brain can move into the browser. The real checkpoint's actor, with the LSTM state as explicit inputs and outputs, exports to a 148 KB ONNX file whose actions match the Python server to within 1e-6 over 200 real junkyard steps.
- `TRAINING.md` honestly records each way the junkyard differs from the training conditions.

**How professional game projects handle this**

Shipped action games layer their AI. A decision layer (state machine, behaviour tree, utility AI or GOAP) picks the intent: alert, search, chase, hold firing distance, attack or pounce, stagger, retreat. Below it, a navigation layer (navmesh or grid pathfinding plus steering) turns that intent into movement. Where studios use learned policies at all, those policies sit under the authored decisions as one skill, not as the whole enemy. Perception lives in one module (in Unreal, the AIPerception component), so the AI, the weapons and the HUD all agree on whether the player is visible. AI and model inference run inside the game process on a fixed timestep: small ONNX, Barracuda or Sentis models answer in microseconds with no external process, so behaviour does not change with frame rate or CPU speed. Speeds, ranges, cooldowns and aggression live in data assets that designers tune without code. Measured against that, this branch has four gaps: the navigation policy is the entire movement brain; every step is a network round trip to Python; three different "can it see Lola?" checks exist; and size and collision constants are hand-copied between languages. The fix path is already proven: main runs an older brain in the browser with onnxruntime-web plus Python-recorded test fixtures, and `JunkyardNavigation.route` already provides the classic pathfinding layer.

**Findings**

#### [HIGH] Without the Python brain service the Leaper is frozen and harmless, and there is deliberately no fallback (at the reviewed commit the brain file was not even in the repo)  `brain-ai-no-checkpoint-no-fallback`
- **Where:** `.gitignore:16`, `rl/junkyard_server.py:89`, `src/simulation/JunkyardBrain.js:17`, `src/simulation/JunkyardBrain.js:103-112`, `src/simulation/LeaperCombat.js:200`, `README.md:56-74`
- **What's wrong:** At `9b384c9` the checkpoint is gitignored (`.gitignore:16` `/model_7757824/`), and the server's default is `ROOT / "model_7757824"`. Nothing else can move the Leaper:
  ```js
  // JunkyardBrain.js:17
  // Only the checkpoint server chooses movement. No navigation-route fallback.
  // LeaperCombat.js:200
  const paused = !p.walking || !p.brain.ready || document.hidden;
  ```
  When the service is down, `fail()` shows `Brain unavailable: … No pathfinder fallback.` The Leaper stands still and its gun is paused too. A working route-follow controller existed and was removed in `944199e`. **Update:** the remote branch tip `be3f9fb` now commits the weights and drops the ignore line, so the "file missing" half is fixed there. The other half remains: every player still needs a second terminal running Python with PyTorch and Stable-Baselines3, and if that is missing, crashes, or is still building its collision map, the fight does not exist.
- **Why it matters (plain language):** Anyone who opens the game without the Python helper running (a tester, a teammate, you on a new laptop) meets a robot that never moves and never shoots.
- **What it holds back:** Sharing playtests, onboarding collaborators, automated tests of the encounter, any public build.
- **How to fix:** (1) Keep `be3f9fb` (merge it). Optionally slim it: `load_brain` in `rl/junkyard_server.py:28` insists on `policy.optimizer.pth` (600 KB of the 900 KB), which inference never uses. Zip only `data`, `policy.pth`, `pytorch_variables.pth` and `_stable_baselines3_version`. (2) Bring back the route follower as an explicit `src/simulation/PathfinderController.js`, using `world.navigation.route()` (still present and tested). Use it only when the service is unreachable, or when `?brain=pathfinder` is set. Show a clear HUD label such as `SCRIPTED FALLBACK — NOT THE TRAINED BRAIN`, so brain evaluations stay honest (that was why it was removed). (3) In `LeaperCombat.update` gate on `p.controller.ready` (whichever controller is active) instead of `p.brain.ready`. Check: stop the Python service, load `?map=junkyard`, press START RUN. The Leaper should walk toward Lola under the fallback label and fire bolts. Add a `junkyard-chase` test that rejects `fetch` and asserts the fallback becomes active.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] Every Leaper step is an HTTP round trip to a local Python/PyTorch process, which blocks a web release and more enemies, even though the brain can run in the browser  `brain-ai-server-architecture`
- **Where:** `src/simulation/JunkyardBrain.js:52-62`, `src/simulation/JunkyardBrain.js:141-166`, `rl/junkyard_server.py:54-70`, `rl/junkyard_server.py:195`
- **What's wrong:** `fetch('http://127.0.0.1:8767/step')` runs about 10 times a second against a single-threaded `HTTPServer(...).serve_forever()`. Against the live server with the real checkpoint: `/step real checkpoint over HTTP: mean 67.6 ms, p95 93.0 ms` at width 5.5. That is most of the 100 ms budget for one Leaper, so a second Leaper would push both over budget. The network itself is tiny. The real actor exported to ONNX (scratch only) is 147,825 bytes, and its actions match the server within `1.01e-06` over 200 real junkyard steps. Almost all of the cost is the Python world rules around it (eye sight, coverage, frontier). Main's in-browser brain (`src/brain/LeaperBrain.js`, 26 inputs, no memory, throttle clamped to `[0,1]`) cannot run this 34-input LSTM brain as-is.
- **Why it matters (plain language):** To play, people must install Python and PyTorch and start a server. So the game can't go on itch.io or a website, and adding a second Leaper would slow both of them down.
- **What it holds back:** Web release, several Leapers or other learned enemies, the same difficulty on every PC, faster or more aggressive Leaper tuning.
- **How to fix:** Move inference into the browser and keep the recipe frozen. (a) `scripts/export_brain_onnx.py`: export only the actor, `(observation[1,34], h[1,1,64], c[1,1,64]) -> (action[1,2], h_out, c_out)`, built from `policy.extract_features`, `lstm_actor`, `mlp_extractor.forward_actor`, `residual_actor` and `action_net`. Clip the action to [-1,1], as SB3 does. Include a parity loop against `BrainSession.step`. (b) Port `JunkyardEnv` to `src/brain/junkyardObservation.js`: the collision raster (baked offline per width as a bitmask), the 16 rays, eye sight (reuse `CombatGeometry`'s raycaster), last-seen memory, the coverage grid and frontier note, the 3 movement-delta channels, and the 19-disc step with decoupled rotate/translate and signed reverse. (c) `scripts/make_junkyard_fixtures.py`: record observations, actions and h/c from the Python server over scripted runs, then replay them in a `node --test` file. Main's `make_brain_fixtures.py` and `BrainDriver.runSelfTest` are the template. (d) Bundle the onnxruntime-web wasm files locally rather than main's jsdelivr `wasmPaths`. Keep the Python server only as the reference for parity tests. Check: the fixture test matches observations to about 1e-5 and actions to about 1e-5, and the game runs with the Python service stopped.
- **Effort:** L  ·  **Quick win:** no

#### [HIGH] A seek-the-target navigation brain is the whole movement AI: nothing decides chase vs hold-and-fire vs retreat vs leap, and catching Lola does nothing  `brain-ai-no-behaviour-layer`
- **Where:** `src/simulation/JunkyardBrain.js:17`, `src/simulation/AttackController.js:1-2`, `src/simulation/LeaperCombat.js:197-226`, `rl/junkyard_server.py:84`, `src/simulation/LeaperLegDamage.js:122`, `src/simulation/JunkyardBrain.js:138`
- **What's wrong:** `AttackController.js:1-2`: `movement is deliberately absent from this interface`. The server sends `caught=bool(self.info.get("is_success", False))`, but nothing in `src/` reads `caught`, `throttle`, `turn`, `vision` or `memory_age` (grep finds no hits). Damage only slows the step clock: `this.rig.mobility = Math.max(0.25, 1 - this.rig.damagedLegCount * 0.18)` and `this.clock += dt * (sim.rig?.mobility ?? 1)`. At the default width of 5.5, a running Lola (about 3.8 units/s) roughly matches the Leaper's best speed (0.375 units/step × at most 10 steps/s = 3.75), and a sprinting Lola (about 5.1) outruns it.
- **Why it matters (plain language):** The Leaper knows exactly one thing: walk toward Lola. When it reaches her, nothing happens. It can't keep a good shooting distance, back off when hurt, stagger when a leg breaks, flank, leap at her (its namesake move), or give up and patrol. A designer's only levers are the step rate and the gun timings.
- **What it holds back:** A meaner or smarter Leaper, signature attacks (pounce, stomp), other enemy types, designer tuning without retraining.
- **How to fix:** Add a decision layer above locomotion. Create `src/simulation/LeaperDirector.js` as a small state machine or behaviour tree in `AttackController`'s style, with states Search → Chase → Engage (hold, turn to face, fire) → Pounce → Stagger → Retreat → Dead. Each state picks a locomotion provider. `RlLocomotion` is today's brain, recipe untouched, used for Search and Chase. `PathLocomotion` uses `JunkyardNavigation.route` toward a chosen point (flank, retreat, last-known position). `Hold` turns in place. Put the knobs in `src/config/leaper-behaviour.js` (`Object.freeze`, like `encounter.js`): steps per second per state (the brain has no sense of wall-clock time, so more steps per second means a faster Leaper without retraining; going beyond about 10-14 per second needs in-browser inference), engage range min/max, stagger seconds per broken leg, retreat health, pounce range and cooldown, and search give-up time. Turn `caught` and contact into a melee or pounce attack. A brain that itself understands combat (keep line of sight, hold a distance band) would be a new training experiment with new inputs, not a change to this frozen brain. Check: playtest that the Leaper stops at engage range and fires, and staggers when a leg breaks; add a unit test per state transition.
- **Effort:** L  ·  **Quick win:** no

#### [HIGH] Once the Leaper has caught Lola, or seen her and lost her, it largely stops hunting: its memory never resets, and training never had a target that moved after being found  `brain-ai-long-run-out-of-distribution`
- **Where:** `rl/junkyard_env.py:111-117`, `rl/junkyard_server.py:64-66`, `rl/checkpoint_environment.py:366-368`, `rl/checkpoint_environment.py:471-482`, `rl/checkpoint_environment.py:934`
- **What's wrong:** In training the target never moved during an episode (`_sample_target` runs only in `reset`), and an episode ended on reaching it (`terminated = reached or stuck or frozen`) or after 1000 steps. The junkyard never ends an "episode" (`junkyard_env.py:113`: `Interactive inference continues until Stop Run, including after catches…`), and LSTM memory resets only on the first step (`episode_start=np.array([self.env.steps == 0])`). So `target_ever_seen` stays true forever, the "last seen" spot goes stale once Lola moves, and the search-coverage map only ever fills up. I tested this with the real checkpoint in the frozen training arena (signed reverse, 15 seeds, 3000 steps each), moving the target to a new random spot every time it was reached:
  ```
  continuous (today's junkyard): catches per third of the run [48, 8, 1]   total 57
  fresh session after each catch: catches per third of the run [101, 75, 60] total 236
  ```
  Without a reset the brain finds the moved target about 5 times less often, and after about 1000 steps (100 s of play) it almost never finds it. A follow-up test shows which part of the memory causes it:
  ```
  reset only "target seen / last-seen spot":       [94, 76, 37]  total 207
  reset that plus the search-coverage map:          [101, 60, 59] total 220
  reset only the LSTM memory:                       [47, 6, 0]    total 53
  ```
  The culprit is the never-cleared "I have already found it, it is over there" memory. Wiping the network's own LSTM memory alone does not help.
- **Why it matters (plain language):** After the first catch, or after Lola breaks line of sight and moves, the Leaper walks to where it last saw her and then mostly wanders. It looks as if "the AI got dumb" a minute or two into the fight.
- **What it holds back:** Long encounters, believable hide-and-seek, trustworthy playtest conclusions about the brain.
- **How to fix:** Add a "soft episode restart" that starts a fresh brain session at the Leaper's current pose. No teleport, and no change to the weights or input layout: it is exactly how every training episode began. Server side, in `rl/junkyard_server.py`, accept `/reset` with an existing `token` and replace `sessions[token]` in place (so no other tab's session is evicted). Client side, in `JunkyardBrain`'s step `.then()`, trigger it when `frame.caught` is true, or when `!frame.target_visible && frame.memory_age >= 120` (it reached the stale last-seen spot and has looked around for 12 s), or when `frame.step >= 900`. Pass the current server pose (`frame.x`, `frame.z`, `frame.yaw`) as the start. A pose the server stepped into is always collision-free, so the reset cannot fail on "start intersects". Show "steps since restart" in the debug HUD. Check: re-run the scratch experiment above against the new trigger (it should keep re-finding the target at roughly the "fresh session" rate), then playtest by letting the Leaper see Lola, hiding, moving, and confirming it resumes searching.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The training code for the shipped brain is in no branch; the in-game world rules are a reconstruction  `brain-ai-recipe-provenance`
- **Where:** `reverse_urgency_config/config.json:1-8`, `rl/junkyard_env.py:35-38`, `rl/seeker_env.py:9`, `rl/checkpoint_environment.py:224-235`, `tests/test_junkyard_brain.py:79-83`
- **What's wrong:** The checkpoint came from a run named `06_reverse_urgency` (`"reverse": true, "time_cost": 0.01, "total_transitions": 10002432`). No `.py` file on any local or remote branch mentions `reverse_urgency`, `06_reverse` or `time_cost`, so the trainer and the exact environment variant are not in the repository. The copied environment defaults the other way (`seeker_env.py:9` `NORMALIZED_THROTTLE = True`, meaning `(a+1)/2`, no reverse), and `junkyard_env.py:35-38` overrides it by hand: `# This checkpoint was trained with negative throttle = reverse.` The override is supported by the config and by measurement (95% vs 82.5% success in the frozen arena; see "What's good"). The checkpoint's `system_info.txt` shows it was trained on Linux with Python 3.12.3, SB3 2.9.0 and PyTorch 2.13.0. The only "parity" test feeds the same observation and memory to `model.predict` twice, so it proves memory is threaded correctly, but it cannot catch drift in how observations are built.
- **Why it matters (plain language):** Nobody can retrain or improve this exact brain from the repo, and nobody can prove that the game's version of its world matches the one it learned in. Today's measurements say it is close, but nothing protects that.
- **What it holds back:** Retraining a combat-aware Leaper from this one, swapping in a better checkpoint, merging with main's RL lab.
- **How to fix:** Recover the `06_reverse_urgency` trainer and environment variant from the Linux training machine. Commit them under `rl/brains/reverse_urgency_7757824/` together with `reverse_urgency_config/config.json`. Add a `brain.json` manifest recording: the meaning of input indices 0-33; the action semantics ("signed reverse: physical = action"); `MOVE_SPEED 0.375`; `TURN 9°/step`; the episode and termination rules; the torch, SB3 and sb3-contrib versions; and the policy SHA256. Add a regression test `tests/test_frozen_arena.py` that runs the real checkpoint on seeds 30000-30039 in `SeekerEnv` with signed reverse and asserts success ≥ 0.9 (measured 0.95; about 20 s). That pins the recipe without the trainer. If the trainer cannot be recovered, say so in README and TRAINING.md.
- **Effort:** M  ·  **Quick win:** no (the regression test alone is a quick win)

#### [MEDIUM] The collision map takes about 30 s to build on first start and on every size change, and each step computes eye sight three times by brute force over 98k triangles  `brain-ai-server-perf`
- **Where:** `rl/junkyard_geometry.py:24-44`, `rl/junkyard_server.py:160-164`, `rl/junkyard_server.py:58-61`, `rl/junkyard_server.py:74`, `rl/junkyard_sight.py:79-100`, `src/simulation/JunkyardBrain.js:57`
- **What's wrong:** Against the live server: `reset width 5.5 (first, builds raster): 29392 ms`, `reset width 4.0 (rebuild): 27883 ms`, `reset back to 5.5 (cache was cleared): 31517 ms`. The cache holds only one width (`if width not in geometry_cache: geometry_cache.clear()`), and the raster is rebuilt in a Python loop over about 81k triangles on every server start. That is why the reset timeout is 90 s. Each `/step` calls `_target_sensor` three times: the pre-inference refresh (`junkyard_server.py:60`), `env.step`'s `_update_target_memory()`, and `snapshot()` (`visible, _ = env._target_sensor()`). Each call bounding-box-filters all 98,632 triangles per eye line, with no spatial index.
- **Why it matters (plain language):** The first START RUN, and every size change, freezes the brain for about half a minute, and most of each step's time goes to repeated sight maths. That caps how fast the Leaper can think and move.
- **What it holds back:** A faster Leaper and higher step rates, several Leapers, quick size iteration for the designer.
- **How to fix:** None of these change the frozen recipe. (1) Cache the raster on disk: in `JunkyardGeometry.__init__`, save and load `tmp/raster_<sha256(collision.json)>_<width>.npy`, and keep a few widths in `geometry_cache` instead of clearing it. (2) In `BrainSession.step`, reuse the result from `env.step` (`env.target_visible`, `env.sight_debug`) and have `snapshot()` call `_target_sensor()` only for `/sense`. (3) Give `JunkyardSight` a uniform 2D grid of triangle indices (2 m buckets, like `JunkyardNavigation.buckets`) and test only the cells a segment crosses. Check: time `/reset` on second launch (should be under 1 s) and `/step` (target under 30 ms); `tests/test_eye_vision.py` must still pass unchanged.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The single-threaded server can be stalled by one idle connection; a hard-coded port list, session eviction across tabs and an uncaught error path cause false "brain offline" failures  `brain-ai-server-robustness`
- **Where:** `rl/junkyard_server.py:98`, `rl/junkyard_server.py:118-121`, `rl/junkyard_server.py:147-149`, `rl/junkyard_server.py:172-173`, `rl/junkyard_server.py:177`, `rl/junkyard_server.py:191-195`, `src/simulation/JunkyardBrain.js:160`
- **What's wrong:** Each of these was reproduced against the real server:
  ```
  step while idle socket open (3 s timeout like the browser): TimeoutError('timed out') after 3003 ms
  origin :5174 -> 403 {'error': 'Local junkyard viewer required'}
  JSON array body -> RemoteDisconnected('Remote end closed connection without response')
  original session after 8 more resets: 400 {'error': 'Session expired. Reset Leaper to reconnect'}
  ```
  Causes: `HTTPServer` (not threading) with no `Handler.timeout`; origins limited to ports `(4173, 4175, 5173, 5175)`, while the repo has no `vite.config` and Vite moves to 5174 when 5173 is busy; FIFO eviction `sessions.pop(next(iter(sessions)))`; and `data.get('token')` on a list raising `AttributeError`, which is not in `except (ValueError, TypeError, KeyError)`. In the browser, a "Session expired" error fails immediately (`JunkyardBrain.js:160`), and five timeouts fail the run.
- **Why it matters (plain language):** The brain can drop "offline" for reasons unrelated to the AI: a stray open connection, a dev server on a different port, or a second browser tab.
- **What it holds back:** Reliable playtests, several sessions or Leapers on one service.
- **How to fix:** In `rl/junkyard_server.py`: set `Handler.timeout = 2` (keeps the single thread simple) or switch to `ThreadingHTTPServer` with a `threading.Lock` per session plus one around `model.predict`. Accept origins matching `re.fullmatch(r"http://(127\.0\.0\.1|localhost):\d+", origin)`. Evict the least recently used session (move it to the end of the dict on every `/step`), and add a `/close` endpoint that the browser calls with `navigator.sendBeacon` on `pagehide`. After `json.loads`, reject non-dict bodies with `ValueError`, and add a final `except Exception` that replies 500 JSON. Keep the loopback bind and the Origin check. Check: re-run the four probes above, which should give ok, ok, 400 JSON, and ok (the original session survives).
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Robot size, clearance height and floor rules are copied by hand between JS and Python  `brain-ai-duplicated-constants`
- **Where:** `rl/junkyard_server.py:163-164`, `src/world/createJunkyardWorld.js:21`, `src/world/createJunkyardWorld.js:28`, `rl/junkyard_geometry.py:25`, `src/world/JunkyardNavigation.js:34`, `src/world/randomJunkyardStart.js:12-14`
- **What's wrong:** Python hard-codes `7.98 / width` (`junkyard_server.py:163-164`), while JS computes `BODY_COLLISION_RADIUS * 2 / width` (which happens to equal 7.98). Python skips triangles with `raw[6] > 3.82 / scale or raw[7] <= 0.12` (min height above clearance, or floor-level max height). JS uses `(STANDING_HEIGHT + 1.5) / scale` (= 3.82) and `t[7] <= 0.12`. Spawn picking adds an unexplained `+ 0.2` margin "for the Python raster's conservative cell edges". The contact *shape* is properly shared through `player-contact.json`; only its formula is written twice.
- **Why it matters (plain language):** If someone changes the robot's size or standing height in `robot.js`, the Python side quietly keeps the old numbers. The Leaper would then stop at invisible walls, walk through real ones, or refuse to start, and no test would notice.
- **What it holds back:** Resizing or re-proportioning the Leaper, new maps, new enemy body types.
- **How to fix:** Create `src/config/leaper-geometry.json` (`version`, `bodyCollisionDiameter: 7.98`, `clearanceHeight: 3.82`, `floorMaxHeight: 0.12`, `rasterMargin: 0.2`). Read it in `robot.js`/`createJunkyardWorld.js` and in Python, the way `player-contact.json` is read. Send `scale` and the version explicitly in `/reset` and have the server reject a mismatch, as it already does for contact and sight. Add a Python test that asserts `json["bodyCollisionDiameter"] == 2 * (1.62 * 2 + 0.75)`, plus a node test that asserts `BODY_COLLISION_RADIUS * 2 === json.bodyCollisionDiameter`. Do not touch the brain's own robot shape in `checkpoint_environment.py` (frozen recipe).
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] `JunkyardBrain` also moves Lola, handles her jump, patches player collision and writes HUD text, so the brain cannot be swapped cleanly  `brain-ai-god-object`
- **Where:** `src/simulation/JunkyardBrain.js:31-49`, `src/simulation/JunkyardBrain.js:103-112`, `src/simulation/JunkyardBrain.js:126-136`, `src/simulation/JunkyardBrain.js:182-187`
- **What's wrong:** It overwrites `playtest.world.playerBlocked` (line 33). `update()` reads input, makes Lola jump and calls `this.target.move(..., sim.input.sprinting ? 8 : 4.5, dt)` (lines 128-136). `fail()` stops the run, releases the mouse and rewrites the toolbar button. Main's `BrainDriver.updatePlayer` (line 205) also drives the player, so after a merge two drivers would each own Lola's controls.
- **Why it matters (plain language):** Replacing or switching off the enemy brain (a browser version, a fallback, a second Leaper) would also break Lola's movement and her collision with the Leaper.
- **What it holds back:** The browser brain port, the fallback controller, several Leapers, merging main's brain driver.
- **How to fix:** Define `src/simulation/LeaperController.js` with `reset(pose)`, `start()`, `stop()`, `update(dt) -> { frame, previousFrame, pendingMovement, status }` and `ready`. Make today's class `ServerBrainController`, and add `PathfinderController` and later `OnnxBrainController` behind it. Move lines 128-136 into `JunkyardPlaytest.update` (or a `LolaController`). Move the `playerBlocked` wrapper into `src/world/leaperContact.js`, taking a list of controllers so N Leapers work. Check: the existing `junkyard-chase` and `player-contact` tests pass unchanged, and a new test swaps in a stub controller and confirms Lola still moves.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The Leaper's speed drifts with monitor refresh rate because leftover frame time is thrown away; the README's step-time claim is stale  `brain-ai-step-rate-drift`
- **Where:** `src/simulation/JunkyardBrain.js:13`, `src/simulation/JunkyardBrain.js:141-142`, `src/main.js:87`, `README.md:108`
- **What's wrong:** `if (... this.clock >= 1 / LEAPER_STEPS_PER_SECOND ...) { this.clock = 0;` discards the remainder. Summed frame times fall just short (`6 × 1/60` summed is `0.09999999999999999`), so an extra frame is often needed. Simulating the scheduler with real-world timestamp jitter gives 8.4 steps/s at 30 Hz, about 9.1 at 60 Hz, 9.8 at 59.94 Hz and 9.4-9.7 at 75-165 Hz, instead of 10. Keeping the remainder gives exactly 10.00 at every rate. The reviewer's flat "8.5 at 60 Hz" is the worst case: the real value depends on the display. `README.md:108` (`Each model step is 1/30 simulated second`) was true in `944199e` but is wrong since `LEAPER_STEPS_PER_SECOND = 10`.
- **Why it matters (plain language):** The same Leaper is quietly 2-16% slower on some screens than the number in the code says, so difficulty varies a little from player to player.
- **What it holds back:** Consistent balance and trustworthy speed tuning.
- **How to fix:** In `JunkyardBrain.update`, replace `this.clock = 0;` with `const interval = preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND; this.clock = Math.min(this.clock - interval, interval);` (the cap stops a burst after a slow reply). Move `LEAPER_STEPS_PER_SECOND` and the two smoothing rates into the designer config. Fix `README.md:108` to say "10 brain steps per second (each 0.375 robot units)". Check: a node test that calls `update(1/60)` 600 times with an instantly resolving fake `request` should count exactly 100 steps.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Three separate answers to "can the Leaper see Lola?", whose ranges agree at the default size but split apart as the size slider moves  `brain-ai-three-sight-models`
- **Where:** `rl/junkyard_env.py:83-100`, `rl/junkyard_env.py:79-81`, `src/simulation/LeaperCombat.js:202-208`, `src/config/combat.js:4`
- **What's wrong:** Brain sight uses a fixed 28 robot units (`np.linalg.norm(delta) - self.TARGET_RADIUS <= self.RAY_MAX_RANGE`) from the neutral eye. Combat uses `c.weaponRange * p.world.scale` with `weaponRange: 22` map units from the aimed eye. At the default width of 5.5 that is 31.9 units versus the brain's 28 (29.4 with target-radius slack), a small gap. At width 2.88 it is 61 and at width 2 it is 88, so the gun fires at Lola from two to three times farther than the brain "sees", and the HUD can say SEARCHING while bolts land. The coverage memory uses the flat 2D raster, so low debris hides ground from the search map even where the eyes see over it. `TRAINING.md` documents this as a deliberate choice.
- **Why it matters (plain language):** At smaller Leaper sizes the robot can shoot you while its brain still says it is searching, which makes playtests confusing.
- **What it holds back:** Range balancing, readable AI states, adding hearing or other senses.
- **How to fix:** Create `src/simulation/LeaperPerception.js` that computes visibility once per tick from one eye origin and feeds the HUD and `AttackController`. Adapt combat to the brain, not the other way round (the brain's 28-unit, 270° rule is frozen). In `LeaperCombat.update`, use `const range = Math.min(c.weaponRange * p.world.scale, 28 + 1.4)` unless a designer flag says otherwise, or express `weaponRange` in robot units. Check: at width 2, confirm bolts are only fired while the brain label says TARGET VISIBLE.
- **Effort:** M  ·  **Quick win:** no (the range clamp alone is a quick win)

#### [LOW] Brain tests needed the private checkpoint, four never did, the HTTP handler is untested, and the "action parity" test cannot detect input drift  `brain-ai-tests-gated-and-circular`
- **Where:** `tests/test_junkyard_brain.py:17-21`, `tests/test_junkyard_brain.py:79-83`, `tests/test_eye_vision.py:139-145`, `rl/junkyard_server.py:87-195`, `package.json:10-14`
- **What's wrong:** Both policy classes load `load_brain(ROOT / "model_7757824")` in `setUpClass`, which errors at `9b384c9`. With `be3f9fb`'s weights all 9 pass (63 s), so the gating is resolved at the tip. Still true: four of those tests only need the environment; the `Handler` class is a closure inside `main()`, so none of the validation, origin or eviction logic is tested (the crash and eviction bugs above went unnoticed); the parity test compares `model.predict(session.obs, state=session.memory)` with the same call inside `session.step`, which checks memory threading but not observation correctness; and `package.json` has no `test` script.
- **Why it matters (plain language):** The test that sounds like "the game feeds the brain what it learned on" cannot actually fail for that reason, and the server's error handling has no tests at all.
- **What it holds back:** CI, safe refactors, the browser port (which needs real parity fixtures).
- **How to fix:** Move the env-only tests to `tests/test_junkyard_env.py` with no checkpoint load. Decorate the policy tests with `@unittest.skipUnless((ROOT / "model_7757824").exists(), "checkpoint not installed")`. Refactor `main()` into `make_handler(model, digest, root)` and test it with a fake model whose `predict` returns fixed actions (cover 403 origin, array body, eviction). Add the frozen-arena regression test from `brain-ai-recipe-provenance`. Add `"test": "node --test tests/*.test.js"` and `"test:py": "python -m unittest discover -s tests -p 'test_*.py'"` to `package.json`.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Python setup is Windows-centric, and the versions that matter for loading the brain are not pinned  `brain-ai-python-packaging`
- **Where:** `scripts/run_junkyard_brain.py:1-11`, `tests/test_junkyard_brain.py:7`, `tests/test_eye_vision.py:7`, `requirements-rl.txt:1-4`, `rl/junkyard_server.py:23-42`, `Start-Leaper.ps1`
- **What's wrong:** `run_junkyard_brain.py` puts `.venv/Lib/site-packages` (the Windows venv layout) at the front of `sys.path`. On Linux and macOS the path doesn't exist, so the hack does nothing (the server ran fine here on Linux and Python 3.13). On Windows, launching it with a different Python than the venv's mixes compiled packages from two versions. `requirements-rl.txt` has no `torch` or `numpy` pin, while the checkpoint was saved with SB3 2.9.0 and PyTorch 2.13.0 (`model_7757824/system_info.txt`). `load_brain` hard-codes `.00015` learning-rate stubs and requires the unused `policy.optimizer.pth`. `Start-Leaper.ps1` and the README commands are PowerShell-only. The reviewer's "nobody on Mac/Linux can follow the README" is overstated.
- **Why it matters (plain language):** Set-up mistakes give confusing errors, and a future library update could stop the saved brain from loading.
- **What it holds back:** Collaborators, CI, reproducible brain loading.
- **How to fix:** Add `pyproject.toml` (or tighten `requirements-rl.txt`) with `torch>=2.13,<2.15`, `stable-baselines3==2.9.0`, `sb3-contrib==2.9.0`, `numpy>=2.5,<3`, `gymnasium>=1.3,<2`, and a script entry `leaper-brain = "rl.junkyard_server:main"`. Delete the `sys.path` hacks in the script and both tests. Document per-OS venv steps in README. Require only `data` and `policy.pth` in `load_brain`. Check: a fresh `python -m venv` plus `pip install -e .` on Linux runs `leaper-brain` and the tests.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Merging with main brings two brain drivers, and the frozen recipe imports by a name main also uses  `brain-ai-merge-two-brains`
- **Where:** `rl/checkpoint_environment.py:1-1044`, `rl/seeker_env.py:5`, `src/simulation/JunkyardBrain.js:1-189`
- **What's wrong:** `git diff 7689aca:rl_environment.py HEAD:rl/checkpoint_environment.py` is empty, and main has not changed `rl_environment.py`, `rl/seeker_env.py` or `rl/seeker_recurrent_policy.py` since `7689aca`. So today the Python merge is a one-line conflict (`from rl_environment import` vs `from rl.checkpoint_environment import`). The copy is documented in README and TRAINING.md, not hidden. The risk is in the future: if the conflict is resolved toward main's import, the game's brain silently follows every later change in main's lab, and only a shape change (34 inputs) would be caught. On the JS side, main's `src/brain/LeaperBrain.js` (26 inputs, `[0,1]` throttle) and `BrainDriver` would sit beside `JunkyardBrain`, and `src/main.js` conflicts.
- **Why it matters (plain language):** A careless merge could quietly change how the trained Leaper perceives the world, or leave two systems fighting over the robot.
- **What it holds back:** Merging the game with the RL lab, future brain upgrades.
- **How to fix:** Before merging, move the frozen recipe to `rl/brains/reverse_urgency_7757824/{env.py, seeker_env.py, policy.py, config.json}` with distinct class names (e.g. `ReverseUrgencyLeaperReachEnv`), and import it from `rl/junkyard_env.py`. Then take main's `rl/seeker_env.py`, root `rl_environment.py` and `train_rl.py`. Put both JS brains behind the `LeaperController` interface (`brain-ai-god-object`). Check: after the merge, the frozen-arena regression test still shows about 95% success.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The checkpoint identity (7,757,824) is hard-coded in many places, and the browser never checks the SHA it displays  `brain-ai-hardcoded-identity`
- **Where:** `src/simulation/JunkyardBrain.js:73`, `src/simulation/JunkyardBrain.js:84`, `src/simulation/JunkyardBrain.js:92`, `src/simulation/JunkyardBrain.js:186`, `src/simulation/JunkyardPlaytest.js:47`, `rl/junkyard_server.py:39-40`, `Start-Leaper.ps1:19`
- **What's wrong:** `if (frame.model_step !== 7757824 || !frame.policy_sha256) throw …` checks only that a SHA is present. The server refuses anything not `7757824`. The labels `BRAIN 7,757,824` are literal strings in three places.
- **Why it matters (plain language):** Trying a different brain means editing many files in two languages.
- **What it holds back:** A/B testing checkpoints, iterating on brains.
- **How to fix:** Ship `model_7757824/brain.json` (`{id, label, steps, sha256, obs_size: 34, action: "signed-reverse"}`). The server returns it from `GET /` and `/reset`. JS displays `manifest.label` and checks `sha256` against an allowlist in `src/config/brains.json`.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Small Leaper sizes put the brain in a much bigger world than it trained in, and make every step slower  `brain-ai-size-slider-ood`
- **Where:** `rl/junkyard_env.py:21-22`, `rl/checkpoint_environment.py:537-541`, `rl/checkpoint_environment.py:729-731`, `src/world/createJunkyardWorld.js:18-21`
- **What's wrong:** `self.WORLD_LIMIT = float(np.max(np.abs([geometry.minimum, geometry.maximum])))` sets the arena size, the distance normalisation (`max_distance = 2*sqrt(2)*WORLD_LIMIT`) and the coverage grid from the map extent in robot units. Training used `WORLD_LIMIT = 31.25` and a 441-cell grid. From the map bounds (±24.3 × ±22.7) times `7.98/width`: width 5.5 gives 35.2 and 576 cells (close to training); width 2.88 gives 67.3 and 2,025 cells; width 2 gives 96.9 and 4,225 cells; width 1.2 gives 161.5 and 11,664 cells. Distances then read 2-5 times smaller to the network than in training, and the per-step frontier search grows with the cell count. Measured: frontier note 1.5 ms at width 5.5 vs 13.6 ms at width 2; the reviewer measured /step at about 97 ms at width 2 vs about 67 ms at 5.5.
- **Why it matters (plain language):** The size slider looks like a cosmetic tuning knob, but below about 5 it quietly drops the brain into conditions it never practised, and slows its thinking.
- **What it holds back:** Trustworthy size tuning, interpreting playtests at other sizes.
- **How to fix:** In `JunkyardPlaytest`'s size control, show a warning when `WORLD_LIMIT` (returned by `/reset`; add it to `snapshot()`) is more than about 1.3 × 31.25. Note in README that brain results are only comparable near width 5-6. A larger-arena brain would be a new training experiment. Check: the warning appears at width 2.88 and not at 5.5.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. Every reviewer finding held up at least in part. The severities and descriptions above have been corrected: the checkpoint is now committed on the branch tip (`be3f9fb`); the reverse override is backed by both the config file and measurement; the step-rate drift is 2-16% depending on display; the sight-range mismatch is small at the default size; Linux setup works; the main merge is a one-line Python conflict today; and the long-run problem is worse than first reported.

### World, map, collision data & asset pipeline

**How it works today**

The junkyard starts as a Blender scene. Props come from deterministic Python generators in `assets/blockmesh/{cars,junkyard}/generate*.py`, which write OBJ files, preview PNGs and a `manifest.json`. A one-off Blender script (`arrange_live_scene.py`) placed 21 extra props, and the owner then edited the scene by hand. It now holds 94 meshes. `scripts/export_junkyard.py` runs headless in Blender and writes two files from one `.blend`. The first is `assets/maps/junkyard/junkyard.glb` (3.07 MB, no textures, about 98.6k triangles). The second is `collision.json` (5.87 MB): 84,660 triangles flattened onto the ground as `[ax,az,bx,bz,cx,cz,minY,maxY]`, plus hand-typed arena bounds of ±24.28 × ±22.74 map metres. After the export, `scripts/move_junkyard_tires.py` patches both files directly to move three tires 2.5 m north. That move exists in no `.blend` file. The README's export command reads `C:/Blender/Junkyard_Blockmesh.blend`, which is outside the repo.

In the browser, `src/main.js` picks one of three worlds from the page address. The plain URL gives the old rock field, `?training` gives the training arena and `?map=junkyard` gives the game. `createJunkyardWorld.js` keeps the Leaper rig at a fixed size and scales the whole map, and Lola with it, by `scale = 7.98 / width`, which is about 1.45 at the default `startWidth` of 5.5. The game builds two 0.4 m grids from `collision.json` using exact circle-versus-triangle tests. One is for the Leaper, as a single circle of diameter `width`. The other is for Lola, as a 0.25 m circle. Lola moves in short sub-steps and slides along walls, and her jump height is never part of the check. The Leaper grid is used only for the spawn point, RESTART RANDOM, moving Lola away from the Leaper on reset, and the SHOW CLEARANCE overlay. Bullets, lasers and the camera boom raycast against the rendered map meshes with no acceleration structure.

In brain mode the Leaper's movement comes from the Python server (`rl/junkyard_server.py`). The server rebuilds its own 0.1 m blocked/free raster of the same triangles for each Leaper size, which takes 26–31 s, and the cache is emptied whenever the size changes. It checks movement with the brain's real body shape: one body disc plus three discs on each of the six legs, 19 in all. Eye-level sight reads `junkyard.glb` directly (`rl/junkyard_sight.py`). Three different Leaper footprints are therefore in use: the single circle (overlay and spawns), the 19 discs (brain movement) and a third shape for contact with Lola (`player-contact.json`).

**What's good**

- `JunkyardNavigation` (`src/world/JunkyardNavigation.js`) is small, readable and correct. Its exact distance test handles walls that flatten to a line (22,220 of the 84,660 triangles, re-counted). Spatial buckets keep each check cheap: the Leaper grid builds in about 150–190 ms, and the tests run on the real exported map.
- The collision export keeps each triangle's lowest and highest point, so roofs and upper rack decks don't seal passages. JavaScript and Python read one shared file.
- The export scripts never modify the source `.blend`. `move_junkyard_tires.py` refuses to run twice (it leaves a glTF extras marker) and asserts that it moved exactly the expected tire triangles. That is careful work for a hand patch.
- The prop generators are deterministic, reject degenerate faces and record dimensions and triangle counts in `manifest.json`, which is good blockout practice.
- Designers already have a debug view: SHOW CLEARANCE plus a "Reachable from spawn: N%" readout (`JunkyardPlaytest.js:245-289`). The problem, described below, is only that it measures the wrong shape.
- Lola has her own small footprint and moves in sub-steps with sliding (`LolaPlayer.js:620-627`), so she can't tunnel through thin walls.
- The map and its collision load in parallel, and a failure shows an on-screen message instead of a blank page (`createJunkyardWorld.js:22-26`, `main.js:22-29`).
- The arena design notes contain good level-design rules: two approaches to each island, no dead-end refuges, a hierarchy of cover heights, and "verify full animated leg sweep" (`docs/arena-concepts/design-notes.md:7-9, 34-36`).

**How professional game projects handle this**

Professional teams keep one level-source scene in LFS or Perforce. A single headless command rebuilds every runtime file from it, and that command finds tools through environment settings or relative paths, never drive letters. Collision is authored as separate simplified meshes, marked by a naming convention such as Unreal's `UCX_` prefix or Godot's `-col` suffix. Navigation is baked offline for each kind of character (a Recast/Detour navmesh, or a height-field grid per agent size) into a small file that both the game and the AI tools load instantly. It is not rebuilt from a triangle list at every startup. Crucially, the designer's debug overlay is drawn from the same data the AI moves with.

On the web, the usual setup is: glTF compressed with meshopt or Draco, KTX2 textures through a `gltf-transform` build step, compression from the host, `three-mesh-bvh` for raycasts, a physics character controller such as Rapier that handles stepping, jumping onto low cover and slopes, and audio shipped as Opus, OGG or AAC. Level metrics are written down as numbers and checked automatically: corridor width per creature, cover heights, jump heights, all spawns reachable. Each creature has a size in world units, and the world is not rescaled to fit one creature.

This project's gaps are typical of a fast solo prototype:
- The map has two candidate sources, plus a post-export patch that exists in neither.
- Collision is rebuilt at runtime in two languages with different methods.
- The designer's overlay uses a different Leaper shape from the brain.
- Collision is flat, with no heights.
- The world is scaled around one enemy.
- Large binaries sit in plain Git, and the export paths only work on Windows.

**Findings**

#### [HIGH] The clearance overlay, RESTART RANDOM and the size slider all use a much more pessimistic Leaper shape than the brain actually moves with: at size 5.5 they show about 12× less reachable floor  `world-assets-overlay-not-brain-collision`
- **Where:** `src/world/createJunkyardWorld.js:28`, `src/simulation/JunkyardPlaytest.js:42`, `src/simulation/JunkyardPlaytest.js:47`, `src/simulation/JunkyardPlaytest.js:245-289`, `src/world/randomJunkyardStart.js:12-14`, `rl/checkpoint_environment.py:24-27`, `rl/checkpoint_environment.py:337-350`, `src/config/player-contact.json`
- **What's wrong:** The overlay, spawn and random-restart code treat the Leaper as one solid circle of radius `width/2` (3.99 rig units): `new JunkyardNavigation(data, width / 2, ...)`. The brain moves with a body disc of radius 0.75 plus 18 leg discs of radius 0.24 placed at 1.2, 2.2 and 3.24 along six leg angles (`checkpoint_environment.py:24-27, 337-350`). That shape reaches only 3.48 rig units and leaves gaps between the legs. Lola contact uses a third shape (`player-contact.json`, `bodyRadius: 1.3`). The circle completely contains the brain's shape, so the overlay is always too pessimistic. It is never too optimistic (the reviewer said "both directions"; that part is wrong). The size of the error is large. My measurements at the shipped size of 5.5:
  ```
  JS circle grid (overlay/spawns):   free 766 of 13908 cells (5.5%), 19 separate regions,
                                     spawn region 189 cells = 25% of free = 1.4% of the arena
  Brain 19-disc shape (Python raster, 36 headings, 0.1 m cells):
    fits at some heading:   24.6% of the arena
    fits at every heading:   8.0% (can turn on the spot)
    connected region from spawn, allowing turns: 69% of all places it fits = 16.9% of the arena
  ```
  The game's own readout says "Reachable from spawn: 25% of clear floor" and paints almost the whole yard red. The UI does carry a disclaimer: "Clearance overlay is a conservative design guide, not the brain's route" (line 47).
- **Why it matters (plain language):** SHOW CLEARANCE is the only tool you have for judging whether a gap is wide enough for the Leaper, and at your chosen size it understates the Leaper's real room by about twelve times. It tells you the yard is mostly sealed off when the brain actually has one large connected network of (often narrow) lanes. It misled this review too. RESTART RANDOM uses the same pessimistic picture, so it reports "NO ROOM" at sizes where the brain would still fit.
- **What it holds back:** Designer tuning of routes, cover and Leaper size; telling map problems apart from brain problems; adding a second Leaper size or another creature.
- **How to fix:**
  1. Share one footprint definition. Move `AGENT_RADIUS`, `LEG_COLLISION_RADIUS`, `LEG_SEGMENT_RADII` and `LEG_ANGLES` into a new `src/config/leaper-footprint.json`. Have `rl/checkpoint_environment.py` read it (same numbers, so the brain recipe is unchanged), along with the JavaScript code. Add a Python test asserting the values equal the old constants.
  2. Compute the overlay from that shape. In `JunkyardPlaytest.makeOverlay`, for each cell and each of about 24 headings, test the 19 discs against the map. Use the baked raster from `world-assets-collision-soup-rebuilt-at-runtime`, or `JunkyardNavigation.blocked(x, z, r)` with each disc's radius. Then flood-fill over (cell, heading), stepping to neighbouring cells at the same heading or turning one heading step in place.
  3. Paint three colours: "can turn here" (every heading), "passable at some headings" and "blocked". Report "Reachable from spawn" from the (cell, heading) flood fill.
  4. Pick RESTART RANDOM pairs from the same reachable set (see `world-assets-random-start-size-slider`), drop the `+0.2` margin, and set the slider's maximum to the largest size with a usable region.
  5. Alternative: add `GET /clearance?width=` to `rl/junkyard_server.py` that returns the mask computed by `JunkyardGeometry.disk_blocked` and `_collision_points`. This is exact, but it only works while the server is running.
  6. Confirm: a Python test writes the brain mask for size 5.5 to a fixture, and a node test checks that the JavaScript mask matches it, allowing about 1% of cells to differ at edges. Visually, the overlay at 5.5 should turn mostly green or amber along the main lanes.
- **Effort:** M · **Quick win:** no

#### [MEDIUM] At the default Leaper size (5.5) the yard is much tighter than the design notes, and the size slider offers sizes where random restarts mostly fail  `world-assets-arena-too-tight-for-default-leaper`
- **Where:** `src/config/encounter.js:6`, `src/world/createJunkyardWorld.js:18-21`, `src/simulation/JunkyardPlaytest.js:42`, `src/world/randomJunkyardStart.js:8-24`, `docs/arena-concepts/design-notes.md:3`, `docs/arena-concepts/design-notes.md:7`
- **What's wrong:** The reviewer's headline, "5.5% of the floor is open, split into 19 pockets", describes the pessimistic JavaScript circle grid, not the Leaper the brain actually moves. The brain's real shape has a connected region from spawn covering 69% of the places it fits (see the finding above). What remains true:
  - The built arena is 48.56 × 45.49 m (2,209 m²). The design notes ask for 120 × 80 m and "Main routes: 12–16 m clear, with 18–22 m turning pockets".
  - At size 5.5 the Leaper fits at any heading in only 24.6% of the arena, and can turn on the spot in only 8.0%. Much of its network is narrow lanes it can pass only when lined up with them.
  - The intended tire passage beside the bus, from map point (4, −2.5) to (10, −2.5), is blocked at every heading for the brain's shape at 5.5, not just for the circle.
  - The slider still offers up to 8 (`min="1.2" max="8"`). My seeded runs of `randomJunkyardStart`: 5.5 → 15/20 succeed, 6.5 → 3/20, 8 → 0/20 (14 free cells in total).
- **Why it matters (plain language):** The Leaper can roam the yard, but mostly through tight lanes where it has to line up exactly. The brain was trained in an open field with six round obstacles, so these lanes are unfamiliar ground for it. That makes chases less fluid and makes it hard to tell whether a stuck Leaper is the brain's fault or the map's. Slider sizes above about 6 are effectively unplayable.
- **What it holds back:** A flowing chase at the size you chose, judging the brain's search behaviour, size tuning, building the train-yard level to the same measurements.
- **How to fix:**
  1. Fix the overlay first (finding above), so you're measuring the right thing.
  2. Then decide on the level: either widen the main loops in the junkyard `.blend` toward the notes' ratios (main routes at least about 2× the Leaper's 5.5 m clearance, turning pockets about 3×), or scale the arena layout up. Then re-export.
  3. Use the corrected overlay's "can turn here" coverage and "Reachable from spawn" as the acceptance check.
  4. In code, set the slider's `max` in `JunkyardPlaytest.js:42` at load to the largest size where a random start succeeds.
  5. Changing the layout doesn't change the frozen brain recipe. It does change what the brain sees, because `JunkyardEnv` normalises distances by map size (`rl/junkyard_env.py:22`). The junkyard has always been a transfer test, so that is expected.
  6. Confirm with the tests proposed in `world-assets-nav-tests-check-old-size`.
- **Effort:** L (level rework in Blender); the slider clamp alone is S · **Quick win:** no

#### [MEDIUM] The shipped map can't be rebuilt from the repo: the export reads an outside file, and the committed .blend is missing the tire-passage move  `world-assets-map-source-of-truth-split`
- **Where:** `README.md:158-165`, `scripts/export_junkyard.py:1-3`, `scripts/export_junkyard.py:35-42`, `scripts/move_junkyard_tires.py:1-5`, `scripts/move_junkyard_tires.py:42-50`, `assets/blockmesh/junkyard/junkyard_arranged.blend`, `TRAINING.md:365-366`, `tests/junkyard-navigation.test.js:33-37`
- **What's wrong:** The README's export command is `blender.exe -b 'C:/Blender/Junkyard_Blockmesh.blend' --python scripts/export_junkyard.py`, and `collision.json` records `"source":"Junkyard_Blockmesh.blend"`. No file of that name is in the repo. The only committed map sources are `junkyard_arranged.blend` and `junkyarf_before_arrangement.blend`. The shipped GLB carries the post-export patch:
  ```
  extras {'north_tire_clearance_v1': {'objects': [...006, ...007, ...008], 'delta': [0, 0, -2.5]}}
  truck_tire_single.006 GLB z = -7.088   vs  junkyard_arranged.blend y = 4.588  (-> z -4.588)
  ```
  The other tires (for example `.003`: blend y −2.544, GLB z 2.544) match exactly. The README's export section doesn't mention re-running the tire script; only `TRAINING.md:365-366` does. The bounds are also hand-typed literals (`export_junkyard.py:38-39`).
- **Severity note:** This was rated high. The game runs fine from the committed exports, TRAINING.md documents the re-run, and the tire passage only matters at sizes up to about 2.6, below the current default. So the damage is limited to future map edits.
- **Why it matters (plain language):** If you edit the junkyard in Blender and re-export without remembering the extra script, the tire passage quietly closes again. Nobody else can rebuild the map, because the instructions point at a file on your C: drive, and it isn't clear which `.blend` is the real map.
- **What it holds back:** Iterating on the level, other people editing the map, using the same pipeline for more levels, reviewing map changes during the merge with main.
- **How to fix:**
  1. In Blender, open the real source (`C:/Blender/Junkyard_Blockmesh.blend`, or `junkyard_arranged.blend` if they are the same scene), move `truck_tire_single.006/.007/.008` by +2.5 in Blender Y, and save it in the repo as `assets/maps/junkyard/source/junkyard.blend`. Use LFS (see `world-assets-repo-binaries-no-lfs`).
  2. Change README.md:161 to export from that relative path. Retire `move_junkyard_tires.py`: delete it, or keep it under `scripts/history/` with a note.
  3. In `export_junkyard.py`, compute `bounds` from the floor object's world bounding box instead of the literals on lines 38-39, and record the source path relative to the repo.
  4. Confirm: re-export, then check that `git diff --stat assets/maps/junkyard/` shows only the expected metadata changes (the GLB tire translations should be identical to the patched ones). Run `node --test tests/junkyard-navigation.test.js`.
- **Effort:** S · **Quick win:** yes (needs about an hour in Blender)

#### [MEDIUM] The whole world, including Lola, is scaled around one enemy's rig, with magic numbers copied between JavaScript and Python  `world-assets-world-scaled-around-rig`
- **Where:** `src/world/createJunkyardWorld.js:20-21`, `src/world/createJunkyardWorld.js:28-29`, `src/world/createJunkyardWorld.js:84-87`, `src/robot/LolaPlayer.js:90`, `src/robot/LolaPlayer.js:106`, `src/robot/LolaPlayer.js:424`, `src/robot/LolaPlayer.js:530`, `src/simulation/JunkyardPlaytest.js:115-121`, `rl/junkyard_server.py:163-164`, `rl/junkyard_geometry.py:25`, `tests/test_junkyard_brain.py:20`, `tests/test_eye_vision.py:49`, `tests/junkyard-navigation.test.js:14`
- **What's wrong:** `const scale = BODY_COLLISION_RADIUS * 2 / width;` scales the map, and Lola is scaled with it: her height (`1.9 * world.scale * ENCOUNTER.lolaHeight`), model, jump speed (`Math.sqrt(2 * 14 * 0.85) * this.world.scale`) and gravity (`14 * this.world.scale`). Fog, camera, weapon ranges and audio falloff are scaled too. `grep -rn "world.scale\|mapScale" src` finds 39 uses. The derived constants 7.98 (= 2 × `BODY_COLLISION_RADIUS`) and 3.82 (= `STANDING_HEIGHT` + 1.5) are retyped as literals in `junkyard_server.py:163-164`, `junkyard_geometry.py:25`, two Python tests and the node test. One consumer was missed: the shadow camera (next findings).
- **Severity note:** This was rated high. It is a real ongoing cost, but it doesn't block work. A second creature can be added by multiplying its numbers by `world.scale` too. "Can't be added at all" was overstated. One concrete limit: the brain server keeps only one Leaper size in its cache (`geometry_cache.clear()`), so two Leapers of different sizes would force a 26–31 s rebuild every time they alternate.
- **Why it matters (plain language):** The "Leaper clearance width" slider actually shrinks or grows the whole yard and Lola, including her jump and gun range, around a robot of fixed size. Every new feature has to remember to multiply by `world.scale`, and the shadows already forgot. Tuning numbers aren't in real metres, which makes them harder to reason about.
- **What it holds back:** More enemy types and sizes, designer tuning in metres, more levels, the merge with main.
- **How to fix:**
  1. Quick step (S): create `src/config/leaper-geometry.json` holding `{ "bodyCollisionDiameter": 7.98, "sensorHeight": 3.82, "groundIgnoreHeight": 0.12 }`. Read it in `junkyard_server.py`, `junkyard_geometry.py`, `JunkyardNavigation.js` and the tests, the same way `player-contact.json` and `eye-vision.json` are already shared. Add a node test asserting that the JSON equals the values derived in `src/config/robot.js`.
  2. Larger refactor (L, after the main merge): make the map metre the scene unit (`scale = 1`) and do the rig-unit conversion in exactly one place, the `JunkyardBrain` request and response (`JunkyardBrain.js:77` already sends `width`). Multiply positions by `7.98/width` on the way out and divide on the way back. Python stays exactly as it is, so the frozen brain recipe is untouched.
  3. The rendered Leaper (body height, step lengths, foot positions in `LeaperSimulation`) would then need its own scale factor. That is the risky part, so do it with `tests/browser-combat.html` and the leg-damage tests running.
  4. Confirm: the browser-combat checks still pass at sizes 2.88 and 5.5.
- **Effort:** L (step 1 is S) · **Quick win:** no (step 1 alone is a quick win)

#### [MEDIUM] Collision is a 5.87 MB triangle list, rebuilt at runtime in two languages (26–31 s on the brain server for each size)  `world-assets-collision-soup-rebuilt-at-runtime`
- **Where:** `scripts/export_junkyard.py:14-42`, `src/world/JunkyardNavigation.js:27-54`, `src/world/createJunkyardWorld.js:27-29`, `rl/junkyard_geometry.py:14-44`, `rl/junkyard_server.py:160-164`, `src/simulation/JunkyardBrain.js:57`, `rl/junkyard_sight.py:8-23`
- **What's wrong:** `collision.json` holds 84,660 triangles of 8 numbers each (5.87 MB; 0.77 MB gzipped). The browser parses it (about 90–120 ms) and builds two grids (about 150–220 ms for the Leaper's, about 90 ms for Lola's) on the main thread before play. The Python server re-rasterises it at 0.1 m: 25.8 s in my run, 30.75 s in the reviewer's. `if width not in geometry_cache: geometry_cache.clear()` means each APPLY SIZE pays that again, and the browser allows for it with `AbortSignal.timeout(path === 'reset' ? 90000 : 3000)`. The floor threshold is copied in three places: `if high <= 0.12` (exporter), `t[7] <= 0.12` (JavaScript), `raw[7] <= 0.12` (Python). Sight reads a fourth copy of the geometry, from the GLB.
- **Why it matters (plain language):** Every map tweak or Leaper-size change means a half-minute wait while the brain server rebuilds its picture of the map. The browser and the brain use different methods, so they can disagree about what is blocked. Players also download several MB of collision data for what is, in the end, a small grid.
- **What it holds back:** Fast level iteration, multiple levels, web-release load times, keeping browser and brain consistent.
- **How to fix (better than the original suggestion, and exact for every size):** In map units, the Python raster depends on the Leaper's size only through the height cut-off `raw[6] > 3.82 / scale`. So bake one height raster instead of one raster per size:
  1. Add `scripts/bake_junkyard_collision.py`. It reuses the exact cell-touch test from `JunkyardGeometry.__init__` and stores, for each 0.1 cell, the lowest `minY` (`raw[6]`) of any touching triangle with `raw[7] > 0.12` (or `inf` when nothing touches it). Save the result as `assets/maps/junkyard/collision-lowest.npz` (486×455 float64, about 0.2 MB compressed).
  2. Add `JunkyardGeometry.from_baked(path, scale)`, which sets `self.solid = lowest <= 3.82 / scale` and keeps the same `minimum`, `maximum` and `cell` maths. This is bit-identical to the current constructor, so the frozen brain recipe is untouched.
  3. Add a Python test: `np.array_equal(JunkyardGeometry.from_baked(p, 7.98/w).solid, JunkyardGeometry(json, 7.98/w).solid)` for w in 1.2, 4, 5.5 and 8.
  4. Switch `junkyard_server.py` to `from_baked`. A size change then becomes instant, and the cache can keep several sizes.
  5. Ship the same raster to JavaScript (Float32 or Uint16 decimetres) for the overlay and spawns, and keep the triangle path behind a debug flag.
  6. Run the bake from `export_junkyard.py`, and move the 0.12/3.82/7.98 constants into the shared config described above.
  7. Confirm: the new test passes, and the first `/reset` after the server starts takes under a second.
- **Effort:** M · **Quick win:** no

#### [MEDIUM] Shadows only exist within about 13 units of the Leaper; most of the junkyard around Lola has no ground shadows  `world-assets-shadow-box-ignores-scale`
- **Where:** `src/core/createScene.js:27-37`, `src/simulation/LeaperSimulation.js:88-89`, `src/simulation/LeaperSimulation.js:113-114`, `src/simulation/JunkyardPlaytest.js:115-121`, `src/main.js:86-93`
- **What's wrong:** The sun's shadow box is fixed at `left=-13 … right=13, top=13, bottom=-13, near=2, far=48`, with a 2048 map. Every frame it is re-centred on the Leaper: `this.sun.position.set(state.position.x + 8, 15, state.position.z + 6); this.sun.target.position.set(state.position.x, 0, state.position.z);`. The junkyard constructor scales fog, the camera's far plane and the top-view height by `world.scale`, but never touches the shadow camera. The scaled map is about 70 × 66 units. The reviewer's headless screenshots confirm it: next to the Leaper, the scrap casts shadows; 30 units away, the barrels beside Lola cast none.
- **Why it matters (plain language):** For most of the fight Lola is away from the Leaper, and the scene around her looks flat, with objects that seem to float. A visible shadow edge also travels around the yard with the Leaper. It undercuts the tension and makes distances harder to read when aiming.
- **What it holds back:** Visual quality and depth cues for the web release, aiming and cover reading.
- **How to fix:**
  1. In the `JunkyardPlaytest` constructor, next to the fog lines, set `const sc = engine.sun.shadow.camera; sc.left = sc.bottom = -20 * world.scale; sc.right = sc.top = 20 * world.scale; sc.far = 80 * world.scale; sc.updateProjectionMatrix();`.
  2. At the end of `JunkyardPlaytest.update()`, which runs after the brain has applied its frame (`main.js:91`), re-centre the sun on Lola: `const p = this.target.mesh.position; engine.sun.position.set(p.x + 8 * s, 15 * s, p.z + 6 * s); engine.sun.target.position.set(p.x, 0, p.z);` where `s = world.scale`. This overrides `LeaperSimulation`'s placement in junkyard mode only.
  3. If edges look too soft, raise `mapSize` to 4096 on desktop.
  4. Confirm: take Playwright screenshots with Lola 30+ units from the Leaper (as in the reviewer's `pw2.js`); the barrels next to her should cast ground shadows.
- **Effort:** S · **Quick win:** yes

#### [MEDIUM] Map tests check old Leaper sizes (2.4, 4), not the shipped 5.5; the "opened" tire passage is blocked at the real size  `world-assets-nav-tests-check-old-size`
- **Where:** `tests/junkyard-navigation.test.js:11-37`, `src/config/encounter.js:6`, `tests/test_junkyard_brain.py:20`, `tests/test_eye_vision.py:49`, `tests/browser-combat.js:356-357`
- **What's wrong:** The passage test uses `new JunkyardNavigation(data, 1.2, 3.82 * 2.4 / 7.98)`, which is size 2.4. That was the default when the tires were moved (commit 0b98cb3: `get('width') || 2.4`). The default is now `startWidth: 5.5`, and the browser test asserts it. My re-run of the same `clearLine` check: 2.4 → clear, 2.6 → clear, 2.88 → blocked, 4 → blocked, 5.5 → blocked. The brain's own shape is blocked at every heading along that line at 5.5 too. The other real-map test loops over `[1.2, 2.4, 4, 8]` and only asserts `count > 0`. The Python tests use `7.98 / 4`. Everything is green while the shipped size has the problems described above.
- **Why it matters (plain language):** The tests say "the passage beside the bus is open and the map works", but only for a Leaper half the size you actually play with.
- **What it holds back:** Safe level iteration, catching map regressions before a playtest, keeping the JavaScript and Python checks in step.
- **How to fix:**
  1. In `tests/junkyard-navigation.test.js`, import `ENCOUNTER.startWidth` and the robot constants (or the shared JSON from `world-assets-world-scaled-around-rig`) instead of the literals 2.4/3.82/7.98.
  2. Add checks at `startWidth`:
     - `randomJunkyardStart` with a seeded random source succeeds in at least 18 of 20 tries;
     - each named intended passage, listed in a small `assets/maps/junkyard/passages.json` with endpoints and the sizes it must work at, is clear;
     - the spawn region covers at least an agreed share of free cells, measured with the brain-shape mask once it exists.
  3. Mark the tire passage as "valid up to 2.6" in `passages.json` rather than deleting the test.
  4. Parametrise `test_junkyard_brain.py` and `test_eye_vision.py` to also run at the `startWidth` read from `src/config/encounter.js`, or document why they use 4.
  5. Confirm: the new tests fail on today's map at 5.5 for the passage. That is expected and documents the gap until the level is reworked.
- **Effort:** S · **Quick win:** yes

#### [MEDIUM] Collision is flat (2D): Lola's 0.85 m jump can't clear anything, so "hop-over" cover blocks her like a wall  `world-assets-flat-collision-no-jump-over`
- **Where:** `src/world/JunkyardNavigation.js:34`, `src/world/createJunkyardWorld.js:29`, `src/robot/LolaPlayer.js:424`, `src/robot/LolaPlayer.js:528-533`, `src/robot/LolaPlayer.js:620-627`, `docs/arena-concepts/design-notes.md:18`, `docs/arena-concepts/design-notes.md:21`
- **What's wrong:** Lola's map check ignores height: `if (!this.world.playerBlocked(p.x + dx, p.z)) p.x += dx;`. The grid keeps every triangle whose top is above 0.12 m. Her jump peak is v²/2g = 0.85 map metres. Landing happens at `if (this.mesh.position.y <= 0) this.resetJump();`, a single flat floor. Re-measured: `Lola free cells 9266 → 10679 if geometry below 0.85 m is ignored (1,413 cells, about 226 m²)`. The design notes ask for "hop-over cover" in the southwest island and "Intended low cover height: 0.7–1.1 m … Verify jump clearance."
- **Correction:** This is a missing feature against the design intent, not a bug. "Jumping is decoration" is overstated: jumping still raises her body for the Leaper's sight and laser checks.
- **Why it matters (plain language):** Lola can't hop a loose tire, a low crushed cube or a fallen beam, even though the level notes plan for exactly that. A whole layer of movement play that players expect in this kind of fight is missing.
- **What it holds back:** Movement and cover design (hop-over cover, vantage points), level variety, a future physics-based player controller.
- **How to fix:**
  1. Short term, Lola only: give `JunkyardNavigation.blocked` an optional `ignoreBelow` argument that skips triangles with `t[7] < ignoreBelow`. Lola's grid doesn't use the precomputed `free` array for movement, so the per-call check is enough.
  2. In `LolaPlayer.moveStep`, call `playerBlocked(x, z, footHeight + 0.2)` with `footHeight = this.mesh.position.y / world.scale`.
  3. Also handle landing. If she comes down where `playerBlocked(x, z)` (ignoring nothing) is true, keep her airborne for that frame, or push her back to the last clear position. Otherwise she lands inside a tire and can never move again.
  4. Longer term, use Rapier (`@dimforge/rapier3d-compat`) with a kinematic character controller (autostep, snap-to-ground) and a trimesh built from the GLB.
  5. Leave the Leaper's Python collision alone: the brain recipe depends on the flat 0.1 grid and the 19-disc checks.
  6. Confirm: add a node test that places Lola beside a low tire, jumps and moves forward. She should end up on the far side, and never inside a blocked cell when grounded.
- **Effort:** M · **Quick win:** no

#### [MEDIUM] The game is hidden behind `?map=junkyard`: the plain URL opens the old rock field, and three worlds share an undocumented "world" contract  `world-assets-legacy-worlds-default-route`
- **Where:** `src/main.js:19-25`, `src/main.js:33-40`, `src/main.js:53`, `src/world/TargetMarker.js:20-24`, `src/simulation/LeaperSimulation.js:151-159`, `README.md:17`, `README.md:72`, `Start-Leaper.ps1:35`
- **What's wrong:** `world = trainingMode ? createTrainingWorld(...) : junkyardMode ? await createJunkyardWorld(...) : createWorld(...)`. README.md:17 tells people to open `http://localhost:5173`, which gives the old world. The game URL appears only at README.md:72 and in `Start-Leaper.ps1`. The world contract is held together by "if this field exists" checks: `world.map ? [world.map] : [world.ground, world.obstacleGroup]`, `if (this.world.positionBlocked) … return this.world.colliders.some(...)`, `this.world?.floorHeight ?? 0`. The branch's only `TargetMarker.js` change, `colliders[0] || { x: 0, z: 10, radius: 1 }`, dates from a284d8d, when the junkyard still used `TargetMarker`. The junkyard now always uses `LolaPlayer`, so the guard is dead code that only creates a merge conflict. Main has meanwhile rewritten `TargetMarker.js` and `createTrainingWorld.js` (125+/49−, `TRAINING_WORLD_LIMIT = 93.75`).
- **Why it matters (plain language):** Anyone given the plain link, or a future web build at the site root, sees the old prototype instead of the game. Every junkyard change has to keep two old worlds working, which makes adding a second level awkward and causes avoidable merge conflicts with main.
- **What it holds back:** Web release, more levels, the merge with main.
- **How to fix:**
  1. Quick (S): make the junkyard the default when no `?map` or `?training` is given (`const junkyardMode = !trainingMode && (params.get('map') ?? 'junkyard') === 'junkyard'`), keep `?map=sandbox` for the rock field, and update README.md:17 and :72.
  2. Then (M): add `src/world/levels.js` with `export const LEVELS = { junkyard: { create: createJunkyardWorld, player: 'lola' }, sandbox: {...} }` and a JSDoc `@typedef World` listing the required fields (`scale`, `floorHeight`, `map`, `playerBlocked`, `positionBlocked`, `spawn`, `initialTarget`).
  3. Move the training replay viewer to its own Vite entry (`training.html` + `src/training-main.js` through `build.rollupOptions.input`).
  4. When merging, take main's `TargetMarker.js` and `createTrainingWorld.js` unchanged.
  5. Confirm: `pnpm build && pnpm exec vite preview`; the root URL shows LOLA + LEAPER.
- **Effort:** M (step 1 is S) · **Quick win:** no (step 1 is)

#### [MEDIUM] The art pipeline only runs on the owner's Windows PC: hard-coded drive paths, Windows fonts, Lola source files not in the repo  `world-assets-machine-bound-export-scripts`
- **Where:** `assets/blockmesh/junkyard/arrange_live_scene.py:8-12`, `assets/blockmesh/junkyard/generate.py:315-316` (and every other `generate_*.py`), `assets/blockmesh/cars/generate.py:159`, `scripts/export_lola.py:12`, `scripts/export_lola_clips.py:3-4`, `scripts/move_junkyard_tires.py:12`, `scripts/export_junkyard.py:16-17`, `scripts/export_junkyard.py:43-46`, `Start-Leaper.ps1:3-9`, `README.md:125`
- **What's wrong:** The scripts hard-code Windows locations: `ROOT = Path('E:/Leaper/assets/blockmesh/junkyard')`, `ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)` in all six junkyard generators and the cars generator (this raises `OSError` on macOS or Linux), `WALK_SOURCE = Path('C:/Blender/LOWPOLY/Lola_walk_final.blend')`, `"C:/Blender/LOWPOLY/Lola final.blend"`, and `Start-Leaper.ps1` requiring `.venv\Scripts\python.exe`. Only the two junkyard `.blend` files are committed; no Lola source is. The `.venv/Lib/site-packages` path inserts are harmless elsewhere (a missing path is ignored), so they are only clutter. A latent trap: the collision export skips `obj.hide_render`, but the GLB export uses `use_visible=True` (viewport visibility). An object that is hidden in the viewport but renderable would become an invisible wall. Today both lists contain the same 94 objects.
- **Why it matters (plain language):** A second artist, a contractor or a new laptop can't regenerate props, Lola or the map without editing scripts first. One easy Blender visibility mistake would create invisible walls.
- **What it holds back:** Growing the team, reproducible builds, an automated export check, more characters and levels.
- **How to fix:**
  1. Add `scripts/art_paths.py` that reads the `LEAPER_BLENDER` and `LEAPER_ART_SOURCE` environment variables, defaulting to repo-relative `assets/**/source/`.
  2. Replace the font calls with a helper `font(size)` that tries Arial and falls back to `ImageFont.load_default()`.
  3. Commit the Lola source `.blend` files under `assets/characters/lola/source/` (LFS), or record their canonical location in AGENTS.md.
  4. In `export_junkyard.py`, build one object list, `[o for o in scene.objects if o.type == 'MESH' and o.visible_get() and not o.hide_render]`. Use it for collision, and select exactly those objects for the GLB (`use_selection=True`).
  5. Let `Start-Leaper.ps1` also accept `.venv/bin/python` and drop the codex-runtime node fallback.
  6. Confirm: run one generator on Linux or macOS and check that it completes.
- **Effort:** M · **Quick win:** no

#### [LOW] Raw studio audio is shipped to players, and large source binaries sit in plain Git with no LFS  `world-assets-repo-binaries-no-lfs`
- **Where:** `.gitattributes:1`, `assets/audio/lola-walk.wav`, `src/simulation/LaserAudio.js:7`, `assets/audio/sources/479353__astounded__laser-effect-contact-mic.wav`, `assets/blockmesh/junkyard/*.blend`
- **What's wrong:** `.gitattributes` contains only `*.pdf binary`. `lola-walk.wav` is 48 kHz/24-bit stereo, 15.7 s, 4.53 MB, and it is copied into `dist` (about 23% of the 20 MB build). The largest blob in history is the unused 21.9 MB laser source WAV (96 kHz/24-bit mono, 76 s; 18.3 MB packed). Nothing in `src` loads `assets/audio/sources/`. Correction: the 37.26 MiB pack is the whole repository shared with main, not 37 MB of binaries, though the big audio sources and `.blend` files are most of it. Main's `.gitattributes` (a merge conflict) has a stray `astraLeaper_Seeker_Experiment_Plan binary` line.
- **Severity note:** This was rated medium. The repository is still modest, and the player-facing cost is one oversized audio file.
- **Why it matters (plain language):** Players download a 4.5 MB studio-quality walk loop that would be about 150 KB as a web audio file. Each new audio or map iteration also makes every clone heavier.
- **What it holds back:** Web-release download size, comfortable collaboration as art iterations pile up.
- **How to fix:**
  1. Transcode the shipped audio, for example `ffmpeg -i lola-walk.wav -ac 1 -c:a libopus -b:a 64k lola-walk.ogg` (add an AAC copy for Safari), and update the URL in `LaserAudio.js:7`.
  2. Run `git lfs install` and add `*.blend *.wav *.flac *.m4a *.glb filter=lfs diff=lfs merge=lfs -text` going forward. Rewriting history with `git lfs migrate` should be coordinated with the main merge.
  3. Move `assets/audio/sources/*` out of the game repo (to LFS or a shared drive), keeping `sources.json` for attribution.
  4. When merging, union the `.gitattributes` lines and drop the stray entry.
  5. Confirm: `pnpm build` and check that the `dist` size drops by about 4 MB.
- **Effort:** S · **Quick win:** yes

#### [LOW] The map GLB can't simply be compressed: the brain server's sight reader only accepts uncompressed GLBs  `world-assets-glb-compression-breaks-sight`
- **Where:** `rl/junkyard_sight.py:8-24`, `rl/junkyard_server.py:97`, `scripts/export_junkyard.py:43-47`, `Start-Leaper.ps1:33`
- **What's wrong:** `if document is None or binary is None or document.get('extensionsRequired'): raise ValueError('Sight requires an uncompressed GLB with an embedded buffer')`. The server loads the same `junkyard.glb` the browser renders. The GLB is 3.07 MB with no textures (0.60 MB gzipped), and `Start-Leaper.ps1` serves `dist` with `python -m http.server`, which doesn't compress.
- **Correction:** Compression wouldn't "silently" break sight. `load_triangles` runs at server start (`junkyard_server.py:97`), so the server would refuse to start with a clear error. Today the cost is small, so this is a future constraint rather than a current problem.
- **Why it matters (plain language):** Once the map gets textures and more props, the normal size fix (mesh compression) will stop the brain server from starting until this is untangled.
- **What it holds back:** Richer map art, web-release download size.
- **How to fix:**
  1. Have `export_junkyard.py` (or the bake script) write a `junkyard.sight.bin` float32 triangle array alongside the GLB, and change `load_triangles` callers to read it. Test that it equals today's `load_triangles(glb)` output.
  2. The browser GLB can then go through `gltf-transform meshopt`. Three r128's GLTFLoader supports `setMeshoptDecoder`.
  3. Serve `dist` with something that compresses (`vite preview` already gzips).
- **Effort:** M · **Quick win:** no

#### [LOW] The arena design docs refer to concept images that aren't in the repo, and their measurements don't match the built yard  `world-assets-arena-docs-not-actionable`
- **Where:** `docs/arena-concepts/design-notes.md:3`, `docs/arena-concepts/design-notes.md:7-9`, `docs/arena-concepts/junkyard-v2-notes.md`, `docs/arena-concepts/junkyard-v2-prompt.md:3`, `docs/arena-concepts/no-blue-lines-prompt.md:3`, `docs/arena-concepts/top-views-comparison-prompt.md:3`, `docs/arena-concepts/generation-prompts.md:7`
- **What's wrong:** The docs reference `junkyard-concept.png`, `junkyard-concept-v2.png`, `junkyard-v2-no-blue-lines.png` and others, and none are committed. They specify "Both arenas: 120 x 80 metres" and 12–16 m main routes. The built yard is 48.56 × 45.49 m. Note that the notes themselves say "Illustrations show placement and atmosphere, not measured construction drawings", so the mismatch is undocumented rather than a broken rule. The asset checklist ("Junkyard concept asset checklist") confirms the blockout was built from these concepts.
- **Severity note:** This was rated medium; it is a documentation gap.
- **Why it matters (plain language):** Someone joining the project can't see the intended layouts, and nothing records that the built yard is about a quarter of the planned size.
- **What it holds back:** Briefing other artists and designers, the planned train-yard level.
- **How to fix:**
  1. Commit the concept boards via LFS next to the prompts, or remove the references.
  2. Add `docs/arena-concepts/junkyard-metrics.md` with a one-page table, in map metres, of what was actually built and the target: Leaper clearance at `startWidth`, Lola radius 0.25 and height 1.71, jump peak 0.85, minimum main-route width, turning pocket, player slot width, cover heights.
  3. Tie the numbers to the tests in `world-assets-nav-tests-check-old-size`.
- **Effort:** S · **Quick win:** yes

#### [LOW] RESTART RANDOM freezes the page for about half a second and fails at large sizes; Lola's fallback spawn ignores reachability  `world-assets-random-start-size-slider`
- **Where:** `src/world/randomJunkyardStart.js:8-24`, `src/simulation/JunkyardPlaytest.js:42`, `src/simulation/JunkyardPlaytest.js:95-104`, `src/simulation/JunkyardPlaytest.js:209-221`
- **What's wrong:** It makes up to 80 attempts, and each one can run a full `nav.route()` grid search on the main thread. Measured average per call: 556 ms at 5.5, with 15/20 successes using my seed (the reviewer got 18/20 with theirs); 6.5 → 3/20; 8 → 0/20, which shows "NO ROOM FOR A RANDOM PAIR". The reset fallback for Lola takes the first Leaper-free cell in grid order that is far enough away (`for (let i = 0; i < nav.free.length; i += 1) { … this.target.mesh.position.set(px, 0, pz); break; }`), with no check that the Leaper can reach that region. It rarely triggers: the default spawn pair is 7.25 units apart against a 5.34-unit minimum.
- **Why it matters (plain language):** There's a noticeable hitch when you press RESTART RANDOM, the slider offers sizes that can't be played, and very occasionally Lola starts somewhere the Leaper can't get to.
- **What it holds back:** Smooth playtesting and size experiments.
- **How to fix:**
  1. `makeOverlay` already flood-fills from the spawn. Store the region labels (`this.regions = Int32Array`) and pick start and target cells from the same region, which removes the per-attempt `route()` call. The result is instant and always connected.
  2. Use the same region for Lola's fallback.
  3. Once the overlay uses the brain's shape (first finding), base this on that.
  4. Clamp the slider's maximum at load.
  5. Confirm: time 20 calls in a node test (under 20 ms each) and assert that every returned pair is in one region.
- **Effort:** S · **Quick win:** yes

#### [LOW] Bullet, laser and camera rays test the whole map's triangles by brute force (no BVH)  `world-assets-raycast-no-bvh`
- **Where:** `src/simulation/CombatGeometry.js:5-30`, `src/camera/CameraOcclusion.js:24-48`, `src/simulation/LeaperCombat.js:21`
- **What's wrong:** `this.raycaster.intersectObjects(this.meshes, false)[0]` runs over 106 meshes and 98,632 triangles, with only per-mesh bounding-sphere culling. Re-measured in Node: about 0.165 ms per ray, for both 8-unit and 40-unit rays (the reviewer measured 0.262 ms). The camera alone fires 9 probes per frame (`for (let i = -1; i < 8; i++)`), which is about 1.5–2.4 ms per frame on a desktop CPU, before bullets, bolts and sight rays.
- **Why it matters (plain language):** It's fine for one Leaper today, but a few more enemies, projectiles or a denser map would turn aiming and camera checks into a frame-rate cost, especially on laptops.
- **What it holds back:** More enemies and projectiles, denser levels, mobile performance.
- **How to fix:**
  1. Add `three-mesh-bvh@0.5.23` (its peer dependency is `three >= 0.123`, so it works with the pinned 0.128).
  2. In the `CombatGeometry` constructor, call `mesh.geometry.computeBoundsTree()` once per mesh, set `mesh.raycast = acceleratedRaycast`, and set `this.raycaster.firstHitOnly = true` in `hit()`. Only `[0]` is used there; `CameraOcclusion`'s blocker scan needs all hits, so leave `firstHitOnly` off for that call.
  3. Confirm: run the reviewer's ray benchmark again (expect about 10× faster) and the browser-combat page.
- **Effort:** S · **Quick win:** yes

#### [LOW] Prop-library docs and inventory files are stale snapshots (wrong counts, Windows absolute paths, "junkyarf" typo, references to ignored zips)  `world-assets-blockmesh-docs-stale`
- **Where:** `assets/blockmesh/junkyard/README.md:54`, `assets/blockmesh/junkyard/README.md:89`, `assets/blockmesh/junkyard/README.md:114`, `assets/blockmesh/junkyard/layout_report.json:2-3`, `assets/blockmesh/junkyard/scene_inventory.json`, `assets/blockmesh/junkyard/arrange_live_scene.py:9`, `.gitignore:15`
- **What's wrong:** The README says "Assets have not been placed in the game." (line 114) and "These new props have not been placed in Blender." (line 89), and points to `junkyard_*.zip` packs that `.gitignore` excludes (`*.zip`). `layout_report.json` holds `"backup": "E:\\Leaper\\…\\junkyarf_before_arrangement.blend"` and `added_count 21`. `scene_inventory.json` is a list of 43 objects (the pre-arrangement scene), while the shipped map has 94. Nothing in the repo generates it.
- **Why it matters (plain language):** Anyone reading the prop folder gets the wrong picture of what is in the game and which file is current.
- **What it holds back:** Onboarding artists, the asset-pipeline cleanup.
- **How to fix:**
  1. Have `export_junkyard.py` write `assets/maps/junkyard/inventory.json` (name, transform, triangle count) on every export, and delete `scene_inventory.json` and `layout_report.json`.
  2. Rename or delete `junkyarf_before_arrangement.blend` (git history keeps it).
  3. Update README lines 54, 89 and 114.
- **Effort:** S · **Quick win:** yes

#### [LOW] Floor height and floor/wall colours depend on a Blender object named "Cube", and world setup changes global lights and fog  `world-assets-floor-found-by-object-name`
- **Where:** `src/world/createJunkyardWorld.js:7`, `src/world/createJunkyardWorld.js:40-67`, `src/world/createJunkyardWorld.js:70-77`, `src/world/createJunkyardWorld.js:83`, `src/robot/LolaPlayer.js:609`
- **What's wrong:** `if (object.name === 'Cube') {` is the only place `floorHeight` gets measured. Otherwise it falls back to 0 (measured value: −0.112 world units, about 8 cm in map metres). The same function also changes shared scene state: `scene.background.setHex(0x555555); scene.fog.color.setHex(0x555555)` and recolours every light. Line 7's comment contains a literal `\n`.
- **Why it matters (plain language):** Renaming the floor in Blender, a perfectly reasonable thing to do, would silently lose the grey floor and wall colouring and leave the characters floating slightly above the ground. A second level would inherit the junkyard's lighting.
- **What it holds back:** Restructuring the Blender scene, more levels, per-level atmosphere.
- **How to fix:**
  1. Have `export_junkyard.py` write `floorHeight` (and the floor object's name) into `collision.json` metadata, or tag the floor with a custom property (`leaper_floor = 1`, exported as glTF extras) and look for `object.userData.leaper_floor`.
  2. Return an `atmosphere: { background, fog, lights }` block from the world and apply it in `main.js`.
  3. Fix the `\n` comment.
  4. Confirm: rename the object in a test GLB, or stub the name check, and check that `floorHeight` is unchanged.
- **Effort:** S · **Quick win:** yes

**Checked and rejected**

None. Every finding held up in substance. Several were re-rated or corrected above:
- The "map mostly closed to the Leaper" headline was really an artefact of the overlay's pessimistic shape.
- The overlay error goes in one direction only, not both.
- GLB compression would fail loudly, not silently.
- The 37 MB pack figure covers the whole shared repository.

### Leaper hexapod rig, locomotion & legacy sandbox/training modes

**How it works today**

The Leaper is built in code from simple shapes, with no Blender model (`src/robot/createHexapod.js`). A body group (`robot`, scaled x2 by `ROBOT_SCALE`) holds the eye, the lens and the red weak-point core. Each of the six legs is made of six separate objects (coxa, femur, tibia, calf, knee, calfJoint), and these are added straight to the scene root rather than under the body: one Leaper adds 37 top-level scene objects, 105 meshes and 105 separate geometries. Each leg also keeps its own walking state: home spot, foot position, step progress and tripod group. Sizes come from `src/config/robot.js` (ROBOT_SCALE 2, HOME_RADIUS 3.24, STANDING_HEIGHT 2.32, BODY_COLLISION_RADIUS 3.99).

`src/simulation/LeaperSimulation.js` is the only code that animates the rig, and it has two ways in. `update(dt)` is the old keyboard sandbox: WASD/Space, acceleration up to walk 4.4 or sprint 9 units/s, a hop, collision against rocks, and IJKL to move the pink cuboid. `updateExternal(frame, dt)` is used by the live brain and by replays: it takes an x/z/yaw pose and works out a smoothed velocity, with no jump. Both then run the same four steps: body height, bob and tilt; an alternating-tripod gait (smoothstep swing, sine lift, velocity lead, one `onFootstep` event per landing); analytic two-stage leg IK; and the glow. The same class also updates the player camera, moves the shadow-casting sun onto the Leaper and writes the status line.

In the game (`?map=junkyard`), `JunkyardBrain` asks the local Python server (`rl/junkyard_server.py`) for one brain step about 10 times a second (fewer when legs are lost). The server applies the frozen per-step physics (0.375 units and 9 degrees per step, signed throttle, 19 collision discs against the rasterised junkyard) and returns a pose. The browser eases toward that pose (rate 18/s for position, 9/s for heading) and passes it to `updateExternal`. The nominal pace is 3.75 units/s and 90 degrees/s. Because of how the step timer resets, the real pace is about 3.2 to 3.6 units/s depending on the monitor (see the new finding below). Leaper size is changed by scaling the map around the robot (`createJunkyardWorld.js`), not by scaling the robot, so the brain's distances stay exact. Leg damage (`LeaperLegDamage` + `HangingLeg`) turns snapped parts into debris, marks the leg `disabled`, sags the body 0.04 per lost leg (capped at 0.1), and slows the brain's step clock through `rig.mobility`. Two legacy modes share the same `main.js`, `index.html`, rig and camera. The default URL opens the keyboard sandbox (84 rocks plus the pink cuboid). `?training=1` opens a replay viewer for the old PPO_10-era trainer at the repo root. The game itself has to be opened with `?map=junkyard`. There is no leap or pounce in the game. The only jump is the sandbox keyboard hop.

**What's good**

- `updateExternal()` is a clean seam. The same procedural rig is driven by the live brain and by recorded replays, and the brain never depends on rendering, so animation can be improved without touching the frozen policy.
- The tripod gait is correct. Group 0 is {-0.62, +1.57, -2.42} and group 1 is the mirror image (`createHexapod.js:154-157`), with smoothstep swings, a sine lift and a velocity lead. At the game's pace about 49% of leg-time is in the air and three or more feet are planted in 94% of frames (headless probe), so 10 brain steps per second sits inside the rig's comfortable range.
- The IK is cheap and stable. A headless probe from 3.75 to 22.5 units/s measured 0.000 error between the rendered foot tip and the planted foot target, so legs never over-stretch.
- Leg damage is solid and tested: per-joint hit thresholds, debris that settles and persists, a damped HangingLeg spring with sub-steps for low frame rates, and a reset that disposes materials. `node --test tests/leaper-leg-damage.test.js tests/leaper-footsteps.test.js`: 20/20 pass.
- Footstep audio fires at real touchdowns, merged per tripod landing, and skips missing or airborne legs.
- The physics match the trainer exactly. `rl/checkpoint_environment.py` is byte-identical to main's `rl_environment.py` (same SHA-256). The server refuses any checkpoint other than the approved 7,757,824-step, 34-input one, and the browser checks the server's contact and sight versions.
- `src/config/player-contact.json` is real shared data, read by both JS (`playerContact.js`) and Python (`junkyard_env.py`). It is a good model for removing the other duplicated numbers.
- Resizing the Leaper scales the map instead of the robot, which keeps the frozen brain's distances and speeds valid.

**How professional game projects handle this**

Games with large multi-legged machines (ARC Raiders' Leaper, Horizon's machines, spider-bots in many shooters) usually split four layers. (1) AI or navigation outputs a desired velocity and facing at a fixed tick. (2) A movement component turns that into smooth motion at render rate, with acceleration limits, or plays back network snapshots with a small fixed delay. (3) A procedural animation layer places the feet with ground raycasts, sets body height and tilt from the planted feet, and changes gait when legs are lost. (4) An action/ability layer (state machine, montages, animation graph) takes over movement for a while for leaps, pounces, hit-stagger, knockdown and death. Enemies are prefabs: one root object, shared meshes and materials, per-copy state, spawn and despawn. The camera, lights and HUD belong to the game loop, not to an enemy, and feel numbers live in data files that designers edit. This project has a solid procedural gait core but lacks most of that structure. The brain is a pure position source with no movement layer, poses are chased with a filter that makes the body surge 10 times a second, there is no action layer (so no leap, stagger or death pose), and the rig is a singleton that also drives the camera, sun and HUD. Feet assume a flat floor, feel numbers are written into the code, and Python/JS agreement depends on hand-copied numbers. The shipping game, the sandbox and an outdated RL viewer are one app behind URL flags, where studios keep separate game, debug-sandbox and tools builds.

**Findings**

#### [HIGH] The Leaper whips about 300 degrees backwards once it has turned 1.5 turns one way  `hexapod-yaw-wrap-whip`
- **Where:** `src/simulation/JunkyardBrain.js:176`, `src/simulation/JunkyardBrain.js:179`, `src/simulation/LeaperSimulation.js:107`, `rl/checkpoint_environment.py:852-854` (server wraps yaw), `src/simulation/LeaperSimulation.js:19-24` (a correct wrap already exists)
- **What's wrong:** The browser computes the "shortest turn" toward the server's heading with
  ```js
  const turn = ((now.yaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  sim.updateExternal({ ...now, ..., yaw: yaw + turn * tYaw }, ...)   // LeaperSimulation: state.yaw = frame.yaw
  ```
  The rendered yaw is never wrapped, but the server's yaw is always wrapped to [-pi, pi) (`(self.yaw + turn + pi) % (2*pi) - pi`). JavaScript's `%` keeps the sign of a negative left side, so once the rendered yaw is more than 3*pi ahead of the server's, the "shortest turn" comes out near -2*pi. I drove the real `JunkyardBrain` class headlessly with the server turning +9 degrees every 0.1 s:
  ```
  dir +: expected per-frame ~0.026 rad; max per-frame change 0.838 rad; backwards whips 14 at t=5.98, 9.98, 13.98, 17.98, 21.98...; total backwards -4323 deg
  dir -: max per-frame change 0.037 rad; backwards whips 0
  ```
  Each whip spins the body about 300 degrees the wrong way in roughly a quarter of a second, and it happens again after every further full turn. Only one turning direction is affected. Reset sets yaw back to the spawn value, so the count starts again after each reset. (`TrainingVisualizer.interpolateAngle` uses the same formula but is safe, because both of its inputs are already wrapped.) The reviewer's claim of a burst of footstep sounds during the whip did not show up in my probe: landings stayed at 6-9 per half second throughout.
- **Why it matters (plain language):** If the robot turns the same way one and a half times (searching, or circling Lola, and trained policies often prefer one turning direction), it suddenly spins almost all the way round in a blur, then again after every further full turn. Players see a glitch in the middle of the fight, and a designer could easily blame the brain for what is really a display bug.
- **What it holds back:** Believable enemy motion, any circling or turn-in-place behaviour, the Leaper-POV spectator camera, and trust in brain playtests.
- **How to fix:** In `JunkyardBrain.update`, replace line 176 with `const turn = Math.atan2(Math.sin(now.yaw - yaw), Math.cos(now.yaw - yaw));`. In `LeaperSimulation.updateExternal`, store a wrapped heading: `state.yaw = Math.atan2(Math.sin(frame.yaw), Math.cos(frame.yaw));`. Every other user of `state.yaw` (camera heading, LeaperCombat, HangingLeg, rig rotation) only uses sin/cos or wraps it again, so this is safe. Ideally add one `shortestAngle(from, to)` helper (e.g. `src/core/angles.js`) and use it in JunkyardBrain, `TrainingVisualizer.interpolateAngle` and `turnToward`. To confirm, add a node test that builds `JunkyardBrain` with a stub playtest (as in this review's probe), feeds 60 s of +9 degrees per 0.1 s at 60 fps, and asserts every per-frame yaw change is under 0.05 rad, in both directions. This changes rendering only; the brain is untouched.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] The Leaper class is a one-of-a-kind "do everything" object: it also drives the camera, sun, HUD, keyboard and pink target  `hexapod-simulation-god-object`
- **Where:** `src/simulation/LeaperSimulation.js:27-34`, `:55-90`, `:111-118`, `:228-232`, `:413-424`; `src/robot/createHexapod.js:84`; `src/simulation/LeaperLegDamage.js:36`, `:121-122`; `src/simulation/LeaperCombat.js:27`; `src/simulation/JunkyardBrain.js:127-136`
- **What's wrong:** The constructor takes `{ rig, world, target, input, cameraController, sun, statusElement }`. `update()` reads the keyboard, moves the pink target (`this.target.move(...)`), updates the player camera, aims the eye from camera angles, moves the global sun onto itself and writes HUD text. `updateExternal()` also updates the camera and sun and writes the status line. The rig is not one object: `scene.add(coxa, femur, tibia, calf, knee, calfJoint)` puts every leg part at the scene root. My probe found `scene root children: 37; meshes 105`. Other systems bolt fields onto the rig: `rig.weaponControlled`, `rig.mobility`, `rig.damagedLegCount`. Bullet tags are only `{ index: leg.index, joint }`, with no enemy id. Lola's WASD movement is run inside `JunkyardBrain.update` using the simulation's private scratch vectors (`sim.v[0]`), `sim.input` and `sim.cameraController`. All sizes are module-level constants, so a second Leaper cannot have a different size. (Correction to the original note: `LeaperSimulation.js` itself auto-merges with main. Main added `applyExternalFrame` and kept `updateExternal` as a wrapper. The merge pain is in `main.js` and `TargetMarker.js`, which this class depends on.)
- **Why it matters (plain language):** Only one Leaper can exist. A second one would fight the first over the camera, the sunlight and the status text. Its 36 loose leg parts cannot be moved, hidden or deleted together, and bullets could not tell which Leaper's knee they hit. Every new feature (death, leaps, a new enemy type) has to be squeezed into this one class.
- **What it holds back:** More enemies or enemy variants (including different sizes) in one level, spawning and despawning, testing locomotion without a camera or web page, and cleaner merges with main.
- **How to fix:** Split it in small steps, keeping the tests green:
  1. `createHexapod({ scale })` returns one root `THREE.Group` holding the body plus a non-rotating `legsRoot` group (legs stay in world space but under one parent), an `id`, and a `dispose()` method. Share geometries and materials.
  2. Move `updateBody/updateGait/updateGroundedLeg/startStep/solveAndPlace/placeSegment` unchanged into a `HexapodLocomotion` class that takes `{x, z, yaw, airborne}` and emits `onFootstep`. It should hold no camera, sun, HUD or input references.
  3. Keep `LeaperSimulation` as a thin wrapper for now: sandbox `update()` becomes a `ManualLeaperController`, and JunkyardBrain and TrainingVisualizer become pose sources.
  4. Move `cameraController.update`, the sun follow and the status text into the entry's game loop (`main.js` / `JunkyardPlaytest.update`).
  5. Move Lola's WASD block (`JunkyardBrain.js:127-136`) into a small `PlayerController` called from `JunkyardPlaytest.update`.
  6. Tag hit meshes with `{ enemyId, index, joint }`.

  To confirm: `node --test tests/leaper-footsteps.test.js tests/leaper-leg-damage.test.js` still passes, and a new test builds two rigs in one scene and checks that `scene.children.length` grows by 2 per rig and that `dispose()` removes everything.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Rig/brain size numbers are copied by hand between JS, JSON and Python, with no test that they agree  `hexapod-parity-constants-duplicated`
- **Where:** `src/config/robot.js:12-15`, `src/world/createJunkyardWorld.js:21`, `:28`, `rl/junkyard_server.py:163-164`, `rl/junkyard_geometry.py:25`, `rl/checkpoint_environment.py:24-27`, `src/robot/createHexapod.js:154-157`, `src/config/player-contact.json:7`, `tests/junkyard-navigation.test.js:14,35`, `tests/test_junkyard_brain.py:20`, `README.md:37`
- **What's wrong:** The browser derives the map scale, `const scale = BODY_COLLISION_RADIUS * 2 / width;` (3.99 x 2 = 7.98), but the server hard-codes it: `JunkyardGeometry(..., 7.98 / width)` and `JunkyardSight(sight_triangles * (7.98 / width))`. The obstacle-height cut-off is `(STANDING_HEIGHT + 1.5) / scale` in JS and `raw[6] > 3.82 / scale` in Python, and the tests repeat 3.82 and 7.98 again. Leg angles appear in `createHexapod.js`, `checkpoint_environment.py` and `player-contact.json`, and 3.24 is both `HOME_RADIUS` and `LEG_SEGMENT_RADII[2]`. No test compares them. Meanwhile README.md:37 says `src/config/` holds "numbers you may want to tune, such as speed and leg proportions". Calibrated from high to medium: nothing is broken today, and the supported way to resize the Leaper (the width slider) keeps everything in sync. This is a trap that fires only when someone edits `robot.js`.
- **Why it matters (plain language):** If someone follows the README and changes `ROBOT_SCALE`, `HOME_RADIUS` or `STANDING_HEIGHT`, the game silently splits in two. The browser draws the junkyard at one size while the brain bumps into and "sees" a junkyard of another size. For example, `ROBOT_SCALE = 2.2` makes the drawn map 8% bigger than the brain's, so walls are about 3 units off near the edges. Spawns picked by the browser can also land inside the brain's walls. Nothing shows an error: the Leaper just walks through visible junk or stops at invisible walls.
- **What it holds back:** Safe designer tuning of Leaper proportions, Leaper variants, and safe merging of main's `rl/` changes.
- **How to fix:** Follow the `player-contact.json` example:
  1. Add `src/config/leaper-body.json` with `legAngles`, `homeRadius` (3.24), `agentRadius` (0.75), `standingHeight` (2.32), `obstacleHeadroom` (1.5) and the derived `mapScaleNumerator` (7.98).
  2. Import it in `robot.js`/`createHexapod.js`, and read it in `junkyard_server.py` and `junkyard_geometry.py` instead of the 7.98 and 3.82 literals. Make the tests read it too.
  3. Add `tests/leaper-parity.test.js`, which parses `rl/checkpoint_environment.py` for `LEG_ANGLES`, `LEG_SEGMENT_RADII` and `AGENT_RADIUS` and asserts they equal the JSON and `robot.js` values. Add the same assert when the server starts.
  4. Edit README.md:37 to say these body numbers are fixed by the saved brain, and that size is changed with the width slider.

  Keep every value exactly as it is today: they are part of the frozen brain recipe. To confirm, the new test passes, and changing `ROBOT_SCALE` locally makes it fail.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The shadow-casting sun follows the Leaper, not the player, so Lola and nearby cover lose their shadows at fighting range  `hexapod-shadow-follows-leaper`
- **Where:** `src/simulation/LeaperSimulation.js:88-89`, `:113-114`; `src/core/createScene.js:27-38`; `src/main.js:63-66`; `src/simulation/JunkyardPlaytest.js:115-121`; `src/config/combat.js:4`
- **What's wrong:** Every frame, `updateExternal` runs `this.sun.position.set(state.position.x + 8, 15, state.position.z + 6); this.sun.target.position.set(state.position.x, 0, state.position.z);`, while the camera follows Lola (`cameraController.followSubject = target`). The shadow box is a fixed +/-13 units (`createScene.js:31-34`). JunkyardPlaytest scales `camera.far` and the fog with `world.scale`, but not the shadow box. At the default width of 5.5 the scale is 1.45, so the Leaper's laser range is 22 x 1.45 = 31.9 units, far outside the roughly 13-16 unit shadow footprint around the Leaper. No other code moves the sun.
- **Why it matters (plain language):** For most of a ranged fight, the area around the player has no shadows at all, while the distant robot gets them. Lola looks pasted onto the floor, and cover loses its depth exactly where the player is looking.
- **What it holds back:** Visual quality for a web release, and multiple enemies (whichever Leaper updates last would own the sun).
- **How to fix:** Delete the four sun lines from `LeaperSimulation`. In `JunkyardPlaytest.update` (and in `main.js` `animate` for the other modes), centre the sun once per frame on what the camera looks at: `sun.target.position.copy(cameraController.target); sun.position.copy(cameraController.target).add(offset)`, where `offset = (8, 15, 6) * world.scale`. Next to the fog lines (`JunkyardPlaytest.js:118-121`), set `sun.shadow.camera.left/right/top/bottom = ±13 * world.scale` and `far = 48 * world.scale`, then call `sun.shadow.camera.updateProjectionMatrix()`. To confirm, stand Lola about 25 units from the Leaper and check that she and nearby tyres and shelving cast shadows. This changes rendering only.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The body surges forward 10 times a second, and lurches stop-go when legs are lost, because server poses are chased with a filter  `hexapod-10hz-surge`
- **Where:** `src/simulation/JunkyardBrain.js:8-13`, `:138-141`, `:168-180`; `src/simulation/LeaperLegDamage.js:122`
- **What's wrong:** A new pose arrives every brain step (0.1 s or more), and the rendered pose eases toward it with `1 - Math.exp(-18 * dt)`. So the body moves fast right after each reply and almost stops before the next one. My probe drove the real `JunkyardBrain` with steps 0.1 s apart and a 40 ms reply delay at 60 fps:
  ```
  mobility 1:    rendered body speed min 1.10 mean 3.22 max 6.65 u/s
  mobility 0.25: rendered body speed min 0.00 mean 0.90 max 5.83 u/s; frames below 25% of mean: 56%
  ```
  The surge also makes the body nod. Driving the real rig, body pitch swung by 1.97 degrees at 10 Hz under brain following, against 0.00 degrees for the same speed fed smoothly. Leg damage slows the step clock (`this.clock += dt * (sim.rig?.mobility ?? 1)`, with mobility down to 0.25), so a crippled Leaper hops about 0.375 units every 0.4 s with near-standstills in between. Main's BrainDriver already blends between the previous and current step by time instead (`lerp(prevFrame, curFrame, phase)`, `main:src/brain/BrainDriver.js:185-194`).
- **Why it matters (plain language):** The big robot moves in small pulses instead of walking with weight. The legs look smooth but the body jerks and nods. When crippled, it moves like a stuttering video rather than a deliberate limp.
- **What it holds back:** A heavy, weighty enemy feel, speed tuning (the surge grows with speed), and a limp that reads as intentional.
- **How to fix:** In `JunkyardBrain`, record the time each reply arrives and draw the pose interpolated between `previousFrame` and `frame`: `t = clamp(timeSinceReply / stepInterval, 0, 1)` with `stepInterval = 1 / (LEAPER_STEPS_PER_SECOND * mobility)`. Use the shortest-angle helper for yaw. Keep a short exponential catch-up only when a reply is late. This keeps the drawn Leaper between its last two server poses, which is what the Lola-contact check at `JunkyardBrain.js:35-42` already assumes. To confirm, rerun the surge probe: rendered speed should stay within about ±10% of the mean at mobility 1, and the pitch swing should drop below 0.3 degrees. This changes rendering only.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The in-game Leaper's speed and turn rate are not where the designer is told to tune them, and the docs disagree  `hexapod-speed-not-in-config`
- **Where:** `src/simulation/JunkyardBrain.js:10-13`, `src/config/robot.js:18-24`, `rl/checkpoint_environment.py:43-44`, `README.md:37`, `README.md:108`, `src/simulation/LeaperSimulation.js:103-105`, `src/simulation/LeaperCombat.js:247-248`
- **What's wrong:** README.md:37 points to `src/config/` for "speed", but `MOVEMENT = { walkSpeed: 4.4, sprintSpeed: 9, ... }` only drives the keyboard sandbox. In the game it is only a velocity cap (`LeaperSimulation.js:103-105`) and a health-bar input. The real pace is the frozen per-step move (`MOVE_SPEED = 0.375`, `TURN_SPEED = 9°`) times a constant hidden in `JunkyardBrain.js:13`, `const LEAPER_STEPS_PER_SECOND = 10;`. That is nominally 3.75 units/s and 90 degrees/s, and in practice less (see `hexapod-step-clock-framerate`). README.md:108 instead says "Each model step is 1/30 simulated second", and main's BrainDriver uses `STEP_DT = 1 / 30`, three times faster. A rig probe shows the legs stop looking planted above about 9 units/s (24 steps/s): fewer than three feet are down in 69% of frames at 9 u/s and in 82% at 11.25 u/s.
- **Why it matters (plain language):** A designer who changes `walkSpeed` sees no change in the fight. Someone who finds the hidden step rate gets no warning that it also changes how fast the Leaper thinks and turns, or that above about 24 steps a second the legs start to skate. If the two branches' drivers are mixed during a merge, the Leaper could quietly become three times faster.
- **What it holds back:** Designer tuning of the enemy's pace, balancing Lola against the Leaper, and merging with main's BrainDriver.
- **How to fix:** Move the constant to `src/config/encounter.js` as `leaperStepsPerSecond: 10`, with a comment explaining that speed = 0.375 x this (units/s), turning = 9° x this (degrees/s), and that values above about 24 make the gait look floaty. Import it in `JunkyardBrain.js`. Rename `MOVEMENT` to `SANDBOX_MOVEMENT` (or comment it as keyboard-sandbox only), and in `updateExternal` derive the cap from `0.375 * leaperStepsPerSecond * 2.4` instead of `sprintSpeed`. Fix README.md:108 to say 10 steps per second in the junkyard. Agree on one rate with main before merging. The brain recipe stays intact because its physics is per step, but laser timings and Lola's relative speed change with this number, so playtest after any change.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The game, the keyboard sandbox and the RL replay viewer are one app behind URL flags; the default page is the old sandbox  `hexapod-three-apps-one-entry`
- **Where:** `src/main.js:19-20`, `:24-40`, `:84-94`; `index.html:12-25`, `:27-85`; `src/simulation/LeaperSimulation.js:67`, `:123`, `:151-152`; `src/simulation/JunkyardPlaytest.js:17`, `:60`, `:75`, `:122`; `src/simulation/TrainingVisualizer.js:11`; `package.json:8-12`
- **What's wrong:** `const trainingMode = ...has('training'); const junkyardMode = !trainingMode && ...get('map') === 'junkyard';`. With no query string, the page builds `createWorld` + `TargetMarker` + the keyboard `LeaperSimulation`. The flags also switch the frame-time cap (`Math.min(junkyardMode ? 0.1 : 0.033, ...)`) and the update path. `index.html` ships the sandbox HUD, the training panel and the touch joystick/JUMP buttons to every mode, and JunkyardPlaytest rewrites `.sub` and `.keys` at runtime. There are dead branches. `this.navigationMove` is read (`LeaperSimulation.js:67`) but never assigned anywhere (`git grep`). `world.positionBlocked` exists only in the junkyard world, where `update()` never runs. JunkyardPlaytest's `!target.isPlayer` branches (lines 60, 122, plus 137/208) can never run, because the junkyard always creates `LolaPlayer` (`main.js:33-34`). TrainingVisualizer stores `this.target` and never uses it. `main.js` is one of the files that conflicts with main.
- **Why it matters (plain language):** Anyone opening the published site gets the old pink-cuboid sandbox, not the Lola fight. Every mode downloads and sets up the other modes' code and screens, and a change for one mode can break another.
- **What it holds back:** A web release (the game is not the front page), merging with main, smaller downloads, and safely deleting legacy code.
- **How to fix:** Interim (an hour): in `main.js`, make the junkyard the default and put the sandbox behind `?sandbox`, then update README line 17. Proper fix: add `vite.config.js` with `build.rollupOptions.input = { game: 'index.html', sandbox: 'sandbox.html', viewer: 'viewer.html' }`, split `main.js` into `src/entries/game.js`, `sandbox.js` and `viewer.js`, give each HTML file only its own HUD, and delete `navigationMove`, the `world.positionBlocked` branch and the `isPlayer === false` branches. To confirm, `pnpm build` produces three pages, and `/` opens the junkyard.
- **Effort:** M  ·  **Quick win:** no (the interim default swap is)

#### [MEDIUM] Killing the Leaper (or losing as Lola) freezes the robot mid-stride; there is no death animation or collapse  `hexapod-death-is-a-freeze`
- **Where:** `src/simulation/JunkyardBrain.js:139`, `:168`; `src/simulation/LeaperCombat.js:77`, `:103-104`, `:119-126`, `:242-246`
- **What's wrong:** `const encounterOver = this.playtest.combat?.dead;` followed by `if (this.frame && !encounterOver) { ... sim.updateExternal(...) }`. `updateExternal` is the only thing that animates the body and legs in the game, so the rig simply stops. `dead` is true when either side dies (`lolaHealth <= 0 || leaperHealth <= 0`), so this also happens when Lola loses. The kill shot already triggers a camera shake and the big-hit crosshair, the eye/core lights drop to zero, and the result banner appears. But the body and legs do nothing. While walking, about half of leg-time is in the air, so a Leaper killed on the move is usually left with about three feet hanging in mid-air. (Correction: the reviewer's suggested camera shake already exists at `LeaperCombat.js:103`.)
- **Why it matters (plain language):** Killing the Leaper is the moment the whole game builds toward, and the robot just stops like a paused video, often with legs in the air. The same freeze when Lola dies can look like the game has hung.
- **What it holds back:** A satisfying kill moment, and later stagger or knockdown reactions, which need the same "an action takes over the walking" path.
- **How to fix:** Keep calling the rig after death with a dying state. In `JunkyardBrain.update`, when `encounterOver`, call a new `sim.updateDying(dt)` (or `updateExternal` with the last frame and zero velocity plus a `dying` flag). In it:
  - set each surviving leg's foot target to a splayed ring at about 1.25 x HOME_RADIUS;
  - let any swinging foot finish its step, reusing the replant logic (`LeaperSimulation.js:176-178`);
  - lower the body over about 0.8 s toward about 0.35 x STANDING_HEIGHT, rolling toward the side with missing legs.

  For Lola's death, just keep the normal `updateExternal` with the last frame so the Leaper settles and idles. Optionally detach one or two more legs through `LeaperLegDamage.detach` for extra debris. To confirm, use `?debug` and six debug hits: the Leaper should sink and splay over about a second, with all feet on the floor. This is visual only.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Losing legs barely changes how the Leaper stands, steps or blocks Lola  `hexapod-leg-loss-does-not-adapt`
- **Where:** `src/simulation/LeaperSimulation.js:222-224`, `:314-320`; `src/robot/createHexapod.js:154-157`; `src/simulation/LeaperLegDamage.js:115-122`; `src/simulation/JunkyardBrain.js:138`; `src/world/playerContact.js:12`; `rl/junkyard_env.py:60-72`
- **What's wrong:** The only body response is a capped sag, `Math.min(0.1, damagedLegCount * 0.04)`. Pitch and roll ignore which side lost legs. Surviving legs keep the fixed tripod groups, so losing two legs from one tripod leaves a one-legged "tripod". The speed penalty slows the brain clock, which slows turning just as much as walking. Lola's contact shape still includes every leg (`for (const angle of shape.legAngles)` in JS and the same loop in `junkyard_env.py`), so the invisible outline of a severed leg (discs out to 3.24 + 0.9 from the centre) keeps blocking her even though the leg is gone. On every break, all other legs' swings are cancelled and each swinging foot drops straight to the floor in one frame (`if (other.stepping) other.footPosition.y = other.stepTo.y; other.stepping = false;`). (Correction: it is the outline of missing legs that blocks Lola, not legs lying on the floor. Also, the code comment at `LeaperSimulation.js:315-316` records that an earlier "one foot at a time" gait made the other legs trail and stretch flat, so a ripple gait needs a longer step and a larger trigger distance, not just fewer feet moving.)
- **Why it matters (plain language):** Shooting legs off, the main tactical layer, looks cosmetic. The robot does not lean, stagger or limp, and Lola bumps into legs that are no longer there. Each break also makes the other feet pop to the ground.
- **What it holds back:** Readable damage states, tactical leg targeting, and limp or crawl behaviours.
- **How to fix:**
  1. In `updateBody`, compute the centroid of planted, non-disabled feet relative to the body and add its offset to `targetPitch`/`targetRoll` (lowering the side with missing legs), capped at about 0.15 rad.
  2. When two or more legs are disabled, raise `stepDuration` by about 1.5x and widen the forced-step threshold, and allow either tripod's remaining legs to step when they drift too far (a "free gait"), keeping the safeguard noted in the comment.
  3. In `LeaperLegDamage.detach`, delete the loop that cancels other legs' swings, so swinging feet finish their steps.
  4. Add a per-leg `disabled` mask to `leaperDiscs/leaperClearance` and send it in the `/step` payload for `JunkyardEnv._player_clearance`.

  Step 4 changes only the Lola-contact rule added for the junkyard. The trained map-collision discs (`_collision_points`) must stay six-legged to keep the frozen recipe. To confirm, add a node test that a disabled leg's outer disc no longer blocks `leaperClearance`, and playtest a two-leg loss on one side.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] No leaps or pounces: the jump is wired to the keyboard, and the brain server owns the position  `hexapod-no-leap-architecture`
- **Where:** `src/simulation/LeaperSimulation.js:81`, `:161-182`, `:265-278`, `:93-119`; `rl/junkyard_server.py:155-186`; `src/simulation/AttackController.js:1-2`; `README.md:118`
- **What's wrong:** The only jump is `if (state.grounded && this.input.consumeJump()) { state.verticalVelocity = sprinting ? 8.6 : 7.4; ...}` in the keyboard path. `updateExternal`, which the game uses, never calls `updateJump`, so `state.grounded` is always true in the game and the airborne leg pose (lines 265-278) never runs. The server exposes only `/reset`, `/step` and `/sense`, and always computes the next position itself. README.md:118 says "There is no climbing or jump control in brain mode."
- **Why it matters (plain language):** The creature called the Leaper cannot leap at Lola, and adding that is not a small tweak. The jump code has to be pulled away from the keyboard, and the brain service needs a way to accept a position the brain did not choose.
- **What it holds back:** Signature leap/pounce attacks, dodges, climbing onto junk, and knockback.
- **How to fix:** Add the leap as a scripted ability on top of the frozen brain, not as a new brain action:
  1. Refactor `updateJump` into `startAirborne({ from, to, apexHeight, duration })` and `updateAirborne(dt)` in the locomotion code, reusing the airborne leg reach and the landing replant.
  2. Add a `LeapAbility` to `AttackController`/`LeaperCombat` with guards: Lola visible, distance within a band, landing spot clear via `world.positionBlocked` and a `CombatGeometry` sweep, and a cooldown. Its phases are wind-up crouch, flight, then landing shake and area damage.
  3. Pause brain stepping while airborne, keeping the session.
  4. Add a `/sync` endpoint to `junkyard_server.py` that sets `env.position`/`env.yaw` to the landing pose, keeps the LSTM memory and target memory, and zeroes the three movement-feedback inputs (`session.obs[-3:]`).

  The policy never sees a jump action, so the recipe stays frozen. It will see a sudden position change it never met in training, though, so playtest that it recovers. A brain that chooses its own jumps would need a new training run, which is a separate research project.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Dozens of gait and body-feel numbers are written into LeaperSimulation, some in fixed world units  `hexapod-gait-feel-numbers-in-code`
- **Where:** `src/simulation/LeaperSimulation.js:164-181`, `:188-189`, `:204-221`, `:254-255`, `:268-270`, `:317`, `:330-336`; `src/config/robot.js:16-24`
- **What's wrong:** Feel values are literals inside the code: jump `8.6 : 7.4`, turn `(grounded ? 8 : 3.5) * (0.4 + ... * 0.8)`, tilt `forwardAcceleration * 0.0065`, `-0.16, 0.2`, `-sideAcceleration * 0.007`, bob `0.045`, `0.014`, `1.7`, foot lead `0.16` capped at `0.55`, airborne foot radius `1.3 : 0.95`, step trigger `drift > 1.05`, step timing `0.245 - speed * 0.012, 0.125, 0.24`, and lift `(0.28 + ... * 0.18) * ROBOT_SCALE`. `robot.js` exposes only geometry, `STEP_DISTANCE` and `MOVEMENT`. Some distances scale with `ROBOT_SCALE` (`STEP_DISTANCE = 0.5 * ROBOT_SCALE`, the lift) and others do not (the 1.05 trigger, the 0.55 lead cap, the 1.3/0.95 airborne reach). At `ROBOT_SCALE = 3`, for example, `STEP_DISTANCE` becomes 1.5 while the forced-step trigger stays at 1.05, so every leg would be forced to step before its normal step distance and the tripod alternation would collapse.
- **Why it matters (plain language):** Making the Leaper feel heavier, twitchier or more spider-like means editing physics code. Scaling the robot changes some walking distances but not others, which breaks the gait in ways that are hard to understand.
- **What it holds back:** Designer tuning of the creature's feel, and enemy variants with different gaits (a small fast Leaper, a heavy one).
- **How to fix:** Add `export const GAIT = Object.freeze({ footLead: 0.16, footLeadMax: 0.55, stepTriggerDrift: 1.05, stepDuration: { base: 0.245, perSpeed: 0.012, min: 0.125, max: 0.24 }, lift: { base: 0.28, sprintExtra: 0.18 }, bob: {...}, tilt: { pitchPerAccel: 0.0065, rollPerAccel: 0.007, maxPitch: 0.2, maxRoll: 0.16 }, airReach: {...}, jump: {...} })` to `config/robot.js`, with one plain-language comment per value. Express distances as multiples of `ROBOT_SCALE` (e.g. `stepTriggerDrift: 0.525 * ROBOT_SCALE`, which equals 1.05 today), and read them in `LeaperSimulation`. Later, let the locomotion class take a gait profile per enemy type. The values stay the same, so nothing should look different. To confirm, `tests/leaper-footsteps.test.js` still passes and the probe numbers are unchanged (about 49% of leg-time airborne at 3.75 u/s).
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] (new) The brain step rate depends on the monitor's refresh rate: about 8.6 steps/s at 60 Hz, not 10  `hexapod-step-clock-framerate`
- **Where:** `src/simulation/JunkyardBrain.js:10-13`, `:138`, `:141-142`
- **What's wrong:** The step timer is reset to zero instead of having one interval subtracted: `this.clock += dt * mobility; if (... this.clock >= 1 / LEAPER_STEPS_PER_SECOND ...) { this.clock = 0; ...`. Any leftover time is thrown away, so the real interval is rounded up to whole frames. At exactly 60 fps, six frames add up to 0.09999999 (just under 0.1), so a step takes seven frames:
  ```
  30 fps: steps/s 10.00 speed 3.75 | 60 fps: 8.57 / 3.21 | 75 fps: 9.38 / 3.52
  120 fps: 9.23 / 3.46 | 144 fps: 9.60 / 3.60 | jittered 60 fps (±1 ms): 9.23 steps/s
  ```
  The comment above the constant says the step rate "keeps the Leaper's speed the same on busy and idle computers", but the speed actually changes by up to 14% depending on the display.
- **Why it matters (plain language):** The Leaper walks and turns about 10-15% slower than designed on a normal 60 Hz screen, and at slightly different speeds on different monitors. Balance tuned on one machine will feel different on another.
- **What it holds back:** Consistent balancing and playtesting across machines, and trusting the speed numbers in docs and config.
- **How to fix:** In `JunkyardBrain.update`, replace `this.clock = 0` with `this.clock = Math.min(this.clock - interval, interval)`, where `interval` is the threshold just tested. This keeps the remainder but never banks more than one extra step after a stall. Keep `this.clock = 0` in `stop()`. To confirm, a node test that drives `JunkyardBrain` with stub requests at 60 fps and at 144 fps for 60 s should count 600 ± 10 step requests in both cases. The brain recipe is untouched; only timing changes.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] `?training=1` replays the old PPO_10-era arena and drives the rig 6x faster than the game  `hexapod-training-viewer-stale`
- **Where:** `src/world/createTrainingWorld.js:3-11`, `rl_environment.py:18-40`, `train_rl.py:20`, `src/simulation/TrainingVisualizer.js:224`, `:236-251`, `rl/checkpoint_environment.py:21`, `:43-45`
- **What's wrong:** The viewer hard-codes `TRAINING_TARGET = { x: 18, z: 18 }` and five obstacles, matching the branch's root `rl_environment.py` (`WORLD_LIMIT = 25`, `MOVE_SPEED = 0.75`, `TURN_SPEED = 18°`), which `train_rl.py` imports. The game's brain physics (`rl/checkpoint_environment.py`) uses `WORLD_LIMIT = 31.25`, `0.375` units and `9°` per step, and random obstacles and targets. Playback runs one step per 1/30 s (`this.playbackTime * 30`), i.e. 22.5 u/s. Rig probe at that speed: `legs airborne 90%; <3 planted in 90% frames; foot offset from home mean 1.32`. Calibrated from medium to low: this is legacy tooling that never touches the game, and the branch never changed these four files. Main did, so on merge main's newer viewer, training world and trainer come in automatically, with only the `main.js` conflict to resolve.
- **Why it matters (plain language):** This viewer can only show an old experiment, so it does not help understand the brain that fights in the junkyard. Its legs float because it plays the walk far faster than it was designed for.
- **What it holds back:** Visually debugging training runs, and onboarding (the docs still point newcomers to `?training=1`).
- **How to fix:** Don't invest in this copy. When merging, resolve `main.js` so main's viewer path is kept (ideally as its own `viewer.html` entry, see `hexapod-three-apps-one-entry`). Add a `playbackStepsPerSecond` control to TrainingVisualizer (default 10, matching the game) and use it in place of the literal `30` at lines 224 and 259. Add a test that pins the SHA-256 of `rl/checkpoint_environment.py`, so later edits to main's `rl_environment.py` cannot silently change the game copy. To confirm, with `playbackStepsPerSecond = 10`, the rig probe at 0.375 u/step shows about 49% of leg-time airborne.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Rendered feet can reach a little past the brain's collision discs and ignore ground height  `hexapod-feet-ahead-of-collision`
- **Where:** `src/simulation/LeaperSimulation.js:249-257`, `:328-333`; `rl/checkpoint_environment.py:25-26`, `:337-349`; `rl/junkyard_geometry.py:24-25`, `:53-65`
- **What's wrong:** Foot targets are the home spot plus a velocity lead (`multiplyScalar(0.16)`, capped at `0.55`) plus up to `0.22` more when a step starts. My probe at game speed measured `foot offset from home mean 0.26 max 0.57`, while the brain's outer leg disc has radius 0.24 at 3.24 from the centre. The junkyard rasterisation is conservative (cells of 0.1 source units ≈ 0.145 world units, padded), which absorbs part of the overshoot, so real visible penetration is probably about 0.1-0.3 units. That is an estimate; I did not see it on screen. Foot height is always `FOOT_HEIGHT + floorHeight`: one flat floor, no ground check.
- **Why it matters (plain language):** When the brain walks the Leaper up against cover, the tips of its front feet can dip slightly into crates and tyres, and feet never step up onto low junk. The robot looks a little less grounded in the clutter.
- **What it holds back:** Grounded-looking movement in dense levels, and uneven or multi-level terrain.
- **How to fix:** In `startStep`, before committing `stepTo`, test the foot point with `world.positionBlocked` (or a short downward `CombatGeometry.hit` ray) and pull it back toward the home spot in a few steps until it is clear. Optionally ray-cast down to set `stepTo.y`, so feet rest on low props. To confirm, walk the Leaper into a wall in the junkyard and check that no foot sphere overlaps the wall mesh. This is visual only.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Each Leaper costs about 105 meshes and 105 separate geometries, and the IK allocates about 80 new vectors per frame  `hexapod-rig-draw-calls`
- **Where:** `src/robot/createHexapod.js:25-31`, `:33-86`, `:185-201`; `src/simulation/LeaperSimulation.js:340-402`
- **What's wrong:** Probe: `meshes 105 (shadow 87); unique geometries 105; materials 9`. `diamondSegment` creates a new `CylinderGeometry` on every call, so six identical legs build six copies of every part. `solveAndPlace` creates about 10 `new THREE.Vector3()` per leg, and `placeSegment` adds 4 more, about 84 per frame per Leaper.
- **Why it matters (plain language):** Fine for one Leaper on a desktop. With several enemies, or on laptops and phones for a web release, roughly 190 draw calls per Leaper (normal plus shadow pass) and constant memory clean-up start to cost frame rate.
- **What it holds back:** Multiple enemies, and lower-end hardware for a web release.
- **How to fix:** Cache leg geometries at module level and share them across legs and Leapers. Merge the static body parts (mounts, fins, shell) with `BufferGeometryUtils.mergeBufferGeometries` (available in three r128 examples). Turn off `castShadow` on small glow strips and rings. Replace the `new THREE.Vector3()` calls in `solveAndPlace`/`placeSegment` with scratch vectors stored on the class (it already has `this.v`). To confirm, re-run the mesh/geometry count probe (geometries should drop to about 25) and check that `tests/leaper-leg-damage.test.js` still passes. Debris clones share geometry, so disposing it must stay material-only.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Walking has almost no automated checks; the yaw and parity bugs would each take one short test  `hexapod-locomotion-untested`
- **Where:** `tests/leaper-footsteps.test.js:6-32`, `src/simulation/LeaperSimulation.js:236-402`, `package.json:8-12`
- **What's wrong:** `tests/leaper-footsteps.test.js` (2 tests, pass) stubs out the IK (`solveAndPlace() {}`) and only counts footstep events. The 18 leg-damage tests cover breaking, not walking. Nothing tests tripod alternation, planted feet at game speed, IK reach, yaw following through JunkyardBrain, step cadence, or rig/brain number parity. The headless probes in this review (real `createHexapod` + `LeaperSimulation` + `JunkyardBrain` under Node, no WebGL) each ran in under a second, so such tests are cheap. `package.json` has no `test` script.
- **Why it matters (plain language):** Walking glitches like the backwards spin are only found by eye during playtests, and refactors to the Leaper code can break the walk without anyone noticing.
- **What it holds back:** Safely splitting LeaperSimulation, and adding gait profiles or death/leap states.
- **How to fix:** Add `tests/leaper-locomotion.test.js`. Build `createHexapod(new THREE.Scene())` plus a `LeaperSimulation` with a stub camera (`{ update() {}, eyePitch: 0, eyeYaw: 0 }`) and a `DirectionalLight` as the sun. Drive `updateExternal` at 3.75 u/s for 6 s and assert that the two tripods alternate, that at least 3 feet are planted in at least 90% of frames, and that each foot stays within `FEMUR_LENGTH + LOWER_REACH` of its hip. Add the JunkyardBrain yaw test, the step-cadence test and the parity test from the findings above. Add `"test": "node --test tests/*.test.js"` to `package.json`.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. All 15 reviewer findings held up. `hexapod-parity-constants-duplicated` and `hexapod-training-viewer-stale` were downgraded. `hexapod-death-is-a-freeze`, `hexapod-leg-loss-does-not-adapt` and `hexapod-feet-ahead-of-collision` were corrected in detail (the kill-shot camera shake already exists; Lola is blocked by the outline of missing legs; the foot overshoot is smaller once the conservative rasterisation is counted). The sub-claim that the yaw whip causes a burst of footstep sounds was not reproduced and has been dropped.

### HUD/UI, controls presentation & audio

**How it works today**

The page (`index.html`) still contains the markup for three different modes at once: the old sandbox (title and key legend `.hud`, `#status`, the VIEW button `#cameraToggle`, the pink `#cuboidToggle`), the RL training replay (`#trainingPanel`) and a touch joystick with Sprint/Jump buttons (`#touch`). In `?map=junkyard` mode, `src/main.js` builds `JunkyardPlaytest` and then calls `enableMovableHud()`. No single module owns the junkyard HUD. Each gameplay class builds and updates its own piece of the screen. `JunkyardPlaytest` builds the toolbar and OPTIONS panel. `LeaperCombat` builds the Leaper name/AI-state box, Lola's health box, the SOUND button and the DEBUG: DAMAGE LEAPER button, and it owns the only `LaserAudio`. `PlayerWeapon` builds the crosshair and the ammo circles. `LeaperHealthBar` builds the floating bar over the Leaper. `LeaperPov` adds the LEAPER POV button. `EyeVision` and `JunkyardBrain` write status text every frame. `LolaPlayer` turns the pink sandbox button into a weapon/stance button, and `CameraController` owns pointer lock and the `mouse-look` body class. Styling is `main.css` plus `junkyard.css`. Thirteen commits on this branch patched `junkyard.css`, and it redefines the same panels several times. `MovableHud.js` lets 11 elements be moved with a double-tap and drag, saves their positions in the browser, and holds clicks on two buttons back by 350 ms.

All sound goes through `LaserAudio.js`. It fetches 9 bundled WAVs and 8 optional "slot" WAVs from `public/audio`, creates the audio engine on the first pointerdown or keydown, and plays every sound straight to the speakers. Each sound has a volume number written in the code. There is no panning. Only the Leaper's footsteps get quieter with distance, and that maths lives in `JunkyardPlaytest`. Lola's footsteps are single impacts cut out of a longer recording, triggered by her animation's foot contacts. `assets/audio/sources.json` records where each sound was cut from, but it records no author, link or licence, and the game shows no credits.

**What's good**

- Desktop mouse clicks on the HUD do not leak into gameplay. Guns listen only on the canvas (`PlayerWeapon.js:75`), and the panel stops `pointerdown` from spreading (`JunkyardPlaytest.js:90`). One caveat applies on touch screens: once START makes the HUD untouchable, taps fall through to the canvas and fire shots (see the touch finding).
- Pointer lock is handled with care in most cases. Escape and the browser's own unlock both pause (`CameraController.js:51-73`), there is a "hover look" fallback when the browser refuses the lock (`:138-146`), and Start requests the lock inside the click so browsers accept it. One race remains (see the new finding at the end).
- `LaserAudio` cancels sounds well. An epoch counter and a 250 ms staleness check stop old shots from replaying after a reset, mute, tab switch or slow load (`LaserAudio.js:129-136`). Everything stops when the window loses focus or the tab is hidden. Footsteps fade in and out quickly so they don't click. Tests cover all of this (`tests/laser-audio.test.js`; 4/4 HUD and audio tests pass).
- Footsteps follow the animation's real foot contacts, and the matching impact is cut from the recording. This is a solid base for game feel.
- Sound slots suit a designer. A correctly named WAV dropped into `public/audio/` plays with random variation and needs no code change.
- Combat feedback is expressive. The floating Leaper bar has a pale "chunk lost" trail, a white flash, a shake and a scale punch, throbs below 25% health and scales with the aim zoom. The crosshair has hit, crit and big-hit states. The ammo circles drain, turn red when low and refill during a reload.
- `MovableHud` keeps panels on screen (`clampPanelPosition`) and saves positions as fractions of the screen, with unit tests.
- Some accessibility groundwork exists: `aria-pressed`/`aria-expanded` on toggles, and screen-reader-only progress values for both health bars.
- `sources.json` records exact trim points, so every sound edit can be reproduced.

**How professional game projects handle this**

Studios keep the player HUD (health, ammo, crosshair, hit feedback, prompts) separate from developer overlays. The HUD reads a small state or event layer and never reaches into AI or networking code, and debug tools sit behind a dev key or dev-build flag. Games have an explicit flow (title, playing, paused with a pause menu, results) and a settings screen with per-bus volume, sensitivity and key rebinding, plus a visible controls legend or contextual prompts. Mobile builds get their own touch layout with fire, aim, reload and swap buttons, safe-area-aware placement, and an explicit "edit HUD layout" mode instead of gestures that collide with gameplay input. Audio runs through middleware (FMOD/Wwise) or a web equivalent (Howler, three.js `PositionalAudio`, or a hand-built Web Audio graph) with mix buses (master, SFX, weapons, voice, UI, music) feeding a limiter. They add 3D panning with distance curves, voice limits with priorities, randomised containers, and loudness-normalised, compressed assets (Ogg/AAC/Opus). Every third-party asset sits in a manifest (author, URL, licence, attribution text) that is checked before release and generates the credits screen. Here, by contrast: dev and AI-debug readouts share the player toolbar, gameplay classes write the screen directly, "Paused" does not pause, there are no settings, the controls legend is hidden, touch controls are sandbox leftovers, every sound goes straight to the speakers with hand-tuned volumes, and no licences are recorded.

**Findings**

#### [HIGH] On phones, pressing START makes every on-screen control dead, and touch has no proper fire, aim, reload or swap controls  `ui-audio-touch-softlock-after-start`
- **Where:** `src/styles/junkyard.css:2-3`, `src/controls/MovableHud.js:16-17`, `src/camera/CameraController.js:120-146`, `src/simulation/JunkyardPlaytest.js:154-174`, `src/controls/InputController.js:33-35`, `src/simulation/PlayerWeapon.js:75-78`, `src/styles/main.css:184-205`, `src/styles/junkyard.css:130`
- **What's wrong:** START RUN / START PLAYER call `captureMouse()`. Whether the browser grants pointer lock or the fallback runs (`enableFallbackLook()` adds the class anyway), `body` gets the `mouse-look` class. This CSS rule then disables every "movable" element, and `MovableHud` tags the touch joystick and buttons as movable:
  ```css
  body.mouse-look .movable-hud, body.mouse-look .movable-hud * { pointer-events: none !important; }
  ```
  ```js
  const selectors = ['.hud', '#status', '#cameraToggle', '#cuboidToggle', '#topViewHint',
    '#junkyardPanel', '#leaperHealthHud', '#combatHud', '#joyBase', '#btnSprint', '#btnJump'];
  ```
  I reproduced this with Pixel 7 emulation in Chromium. After tapping START PLAYER, `#junkyardPanel`, `#joyBase`, `#btnJump`, `#btnSprint`, `#cameraToggle` and `#cuboidToggle` all had `pointer-events: none`, and `elementFromPoint` at each one's centre returned `CANVAS`. Tapping STOP PLAYER left `playerMode: true`. The only exits are the Escape key (phones don't have one) or leaving the tab or app, which fires `blur` and clears `mouse-look`. Players won't find that.
  Correction to the original report: taps on the canvas **do** fire. The browser turns a tap into compatibility mouse events, and the canvas `mousedown` listener fires one shot at the screen-centre crosshair. Measured: ammo went 20→19 for a tap before START, and 18→17 for a tap after START. A tap aimed at the dead STOP button also fell through to the canvas and fired. Touch has no hold-to-auto-fire, no aim zoom (right button only), no manual reload (R only), no crouch (C only), and no weapon swap once the HUD is dead.
  Before START, the layout is also broken on a phone. Lola's health box (z-index 30, `pointer-events: auto`) covers the bottom of the joystick (`elementFromPoint` at the joystick's lower edge returned `combat-health`). The ammo circles overlap the Jump button. The Sprint/Jump labels use `color: var(--ink)` (#202630) on `rgba(20,22,28,0.4)`, which is almost invisible.
  Not verified here: audio unlocks only on `pointerdown`/`keydown` (`LaserAudio.js:72-73`). A touch `pointerdown` does not count as a user gesture in Chrome or Safari, so sound may only start on the second tap on a real phone.
- **Why it matters (plain language):** Anyone who opens a shared link on a phone or tablet can walk around until they press START. After that the joystick, Jump and STOP buttons stop responding, and the only thing that still works is tapping the screen, which fires single shots. There's no way to aim, reload or switch guns.
- **What it holds back:** A mobile or tablet web release, sharing playtest links, and touch-screen laptops.
- **How to fix:**
  1. In `src/camera/CameraController.js`, remember the last pointer type with a capture-phase `window.addEventListener('pointerdown', e => { this.lastPointerType = e.pointerType; }, true)`. In `captureMouse()`, when `this.lastPointerType !== 'mouse'` (or `matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches`), skip `requestPointerLock()`, don't call `enableFallbackLook()`, and set `document.body.classList.add('touch-play')` instead. Touch drags already turn the camera through `onPointerMove`.
  2. In `src/styles/junkyard.css:3`, scope the rule so it never applies to touch controls: `body.mouse-look:not(.touch-play) .movable-hud, ... { pointer-events: none !important; }`. While native pointer lock is on, clicks go to the canvas anyway, so the rule only matters for the hover-look fallback.
  3. Add `src/ui/TouchControls.js`, created only when `#touch` is shown. It needs a FIRE button (`pointerdown` sets `playerWeapon.triggerHeld = true; playerWeapon.fire()`, `pointerup` clears it, which gives auto-fire for the M416), an AIM toggle (`playerWeapon.setAiming(!cameraController.aiming)`), RELOAD (`playerWeapon.reload()`), SWAP (`target.switchWeapon()`), CROUCH (first move the inline crouch code in `LolaPlayer.js:166-170` into a `toggleCrouch()` method and call it from both places), and PAUSE (calls the same code as Escape, `cameraController.onPauseRequested()`). Call `preventDefault()` in the canvas `pointerdown` when `pointerType === 'touch'` so taps no longer fire through compatibility mouse events. Firing should come only from the FIRE button.
  4. Reserve a bottom band for touch controls and move Lola's health box to the top on narrow screens (`@media (max-width:700px)` in `junkyard.css`). Change `.tbtn` text to a light colour (for example `#eef3f2`).
  5. In `LaserAudio.js`, also listen for `pointerup` and `touchend` to call `this.unlock`.
  6. Verify with a Playwright script using `devices['Pixel 7']`: tap START PLAYER, then check that `#joyBase` and the new buttons report `pointer-events: auto` and that tapping STOP sets `playerMode` to false. Check that FIRE held for 1 s drains about 7 M416 rounds. Also try it on a real phone.
- **Effort:** M  ·  **Quick win:** no (steps 1, 2 and 5 alone are a quick, low-risk first patch)

#### [HIGH] Both M416 sounds come from a NonCommercial-licensed recording, and no licence is recorded anywhere  `ui-audio-m416-noncommercial-license`
- **Where:** `assets/audio/sources.json:20-25`, `assets/audio/sources.json:32-37`, `src/simulation/LaserAudio.js:4`, `src/simulation/LaserAudio.js:9`, `assets/audio/sources/766092__luca2399__m4_rifle_fire.wav`
- **What's wrong:** `m416-shot` and `m416-reload-reserved` are both cut from `766092__luca2399__m4_rifle_fire.wav`, and both ship in the build (`m416-shot-DDK2xrvO.wav`, `m416-reload-reserved-DKyiOfH0.wav`). I re-fetched the Freesound page for sound 766092 during verification, and its licence line reads `Attribution NonCommercial 4.0`. No file records licences: `sources.json`, `FOOTSTEPS.md`, `SOUND-SLOTS.md` and the README have no licence field, and `git grep -i "licen|credit|attribut"` finds nothing relevant.
- **Why it matters (plain language):** This licence allows the two M416 sounds only in non-commercial work, and only with credit to the author. A paid game, an ad-supported page, a store release or a promotional demo for a company all count as commercial use. The repository lives under a company GitHub organisation, so this needs a decision now. Because no licences are written down, nobody can tell which other sounds carry conditions without re-checking every source page by hand.
- **What it holds back:** Any commercial, promotional or monetised release, and handing assets to collaborators safely.
- **How to fix:** Replace both M416 sounds with CC0 or self-recorded material (or get written permission from Luca2399), cut them with the same trim workflow, and update `sources.json`. Add `author`, `url`, `license` and `attribution` fields to every entry in `assets/audio/sources.json`. Add entries for the three footstep sources and the two filled `public/audio` slots too, which today appear only in Markdown. Add a small `node --test` check (e.g. `tests/audio-licenses.test.js`) that fails if an entry has no `license` or contains `NC`. Verify by running the test and by grepping `dist/assets` after `pnpm build` for the new M416 file names.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] "Paused" doesn't pause: Lola can still move and shoot while the Leaper is frozen, so Escape becomes a free-damage exploit  `ui-audio-pause-does-not-pause`
- **Where:** `src/simulation/PlayerWeapon.js:75-78`, `src/simulation/PlayerWeapon.js:148-152`, `src/simulation/JunkyardPlaytest.js:71-74`, `src/simulation/JunkyardBrain.js:93`, `src/simulation/JunkyardBrain.js:126-136`, `src/simulation/LeaperCombat.js:97-105`, `src/simulation/LeaperCombat.js:200`, `src/camera/CameraController.js:57`, `src/camera/CameraController.js:81-86`
- **What's wrong:** Correction to the original report: being able to walk and shoot while the run is stopped is a deliberate sandbox feature, and the panel says so (`JunkyardBrain.js:93`: "left click fires whichever gun is equipped, even while the Leaper run is stopped"; `JunkyardPlaytest.js:206`: "WASD moves Lola…"). The real problems are these:
  1. Escape writes `'Paused with Escape. Click Start Run to resume.'` (`JunkyardPlaytest.js:72`), but nothing about Lola pauses. `PlayerWeapon.available` has no play-state check (`return !p.combat.dead && !p.pov.active && p.cameraController.mode === 'CHASE' && !document.hidden;`), and `JunkyardBrain.update` calls `this.target.move(...)` every frame. Measured after Escape: the message read "Paused with Escape…", the crosshair was still visible, one canvas click took ammo 20→19, and holding W moved Lola from z 6.11 to 6.22. Before any START, three clicks took ammo 20→17.
  2. When stopped, the Leaper's attack logic is frozen (`LeaperCombat.update`: `const paused = !p.walking || ...`), but `damageLeaper()` only checks `this.dead`. A player can press Escape and shoot the frozen Leaper with no risk.
  3. After alt-tab, `blur` releases the mouse without pausing (`CameraController.js:57`), so `gameplayStarted` stays true. The next canvas click both re-captures the mouse (`:83-86`) and fires a shot, because `PlayerWeapon`'s `mousedown` handles the same click.
- **Why it matters (plain language):** The screen says "Paused" while the game keeps running for Lola, and the Leaper can't fight back while it is "paused". A playtester can pause and shoot it down for free, which skews any balance feedback. Clicking back into the game after switching windows also wastes a bullet.
- **What it holds back:** A real pause menu, settings screen, start screen, tutorials and fair playtest numbers.
- **How to fix:** Add `src/game/GameState.js` exporting a tiny store (`'sandbox' | 'playing' | 'paused' | 'ended'`). Set it from `JunkyardPlaytest.start()`, `startPlayer()`, `stop()`, `stopPlayer()` and `LeaperCombat.finish()`. Keep the free-roam/shoot behaviour as an explicit `'sandbox'` state (before the first START), and make Escape set `'paused'`. Then:
  - `PlayerWeapon.available` adds `&& gameState.current !== 'paused'`.
  - `JunkyardBrain.update` skips `this.target.move(...)` while paused.
  - `LeaperCombat.damageLeaper` returns early unless the state is `'playing'` or `'sandbox'`.
  - In `CameraController`'s canvas `pointerdown`, when it calls `captureMouse()`, set a flag (e.g. `this.swallowNextFire = true`) that `PlayerWeapon`'s `mousedown` checks and clears, so the click that re-grabs the mouse doesn't shoot.
  - Show a centred "PAUSED · click to resume" overlay.
  None of this touches the brain's observations or actions. Verify with a Playwright check: press Escape, click the canvas, and confirm the ammo and Leaper health are unchanged.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The double-tap-to-move gesture swallows Jump and joystick input for up to 3 seconds, delays two buttons by 350 ms, and has no layout reset  `ui-audio-movablehud-hijacks-touch-and-delays-clicks`
- **Where:** `src/controls/MovableHud.js:16-17`, `src/controls/MovableHud.js:44-64`, `src/controls/MovableHud.js:73-81`, `src/controls/MovableHud.js:84-103`, `tests/movable-hud.test.js:47-50`
- **What's wrong:** The joystick, Sprint and Jump are movable elements. A second press within 350 ms and 24 px starts a drag and calls `stopImmediatePropagation()`, so the game never sees that press. It is worse than the original report said: a drag that ends without moving leaves `armedUntil = now + 3000` in place (`end()` resets it only `if (drag.moved)`), so **every** press on that control for the next 3 seconds becomes a drag start. Measured in Pixel 7 emulation with synthetic pointer events: three Jump presses (2nd at +35 ms, 3rd about 1 s later) registered as `[1, 0, 0]` jumps. A tap followed by a press-and-push on the joystick gave `forwardMax: 0`, moved the joystick base from y 655 to 595, and saved that position to `localStorage` (`{"#joyBase":{"x":0.063,"y":0.709}}`). On desktop, clicks on the VIEW and weapon/stance buttons (the two movable elements that are themselves buttons) are always deferred: `pendingClick = setTimeout(() => { … button.click(); … }, 350);`. The unit test locks that delay in (`setTimeout(resolve, 370)`). Toolbar buttons inside the panel are not delayed. There is no UI to reset a layout; only bumping `STORAGE_KEY` in code does that.
- **Why it matters (plain language):** On a phone, tapping Jump twice quickly (normal in an action game) stops jumps from registering for about 3 seconds. A quick tap-then-push on the joystick slides the joystick across the screen instead of moving Lola, and the game remembers the bad position. On desktop, VIEW and the weapon button feel sluggish. Anyone who drags a panel somewhere awkward can't put it back.
- **What it holds back:** Touch play, snappy HUD buttons, and letting playtesters customise layouts safely.
- **How to fix:** In `src/controls/MovableHud.js`, replace the always-on gesture with an explicit mode. Export `setHudEditing(on)`, which toggles `document.body.classList` `hud-editing`, and add an "EDIT HUD LAYOUT" button in OPTIONS (`JunkyardPlaytest.js` panel markup). The `pointerdown` handler should return immediately unless `body.hud-editing` is set. While editing, a single press drags, and while not editing, no drag or click interception runs at all, which deletes the `pendingClick`/`replaying` 350 ms replay. Add a "RESET LAYOUT" button that calls `localStorage.removeItem(STORAGE_KEY)` and clears each element's inline `left/top/right/bottom/transform/margin`. Save separate layouts per form factor (`STORAGE_KEY + (matchMedia('(pointer: coarse)').matches ? '.touch' : '.desktop')`). Update `tests/movable-hud.test.js`: a click should fire immediately when not editing, and a single-press drag should move the element when editing. Re-run the Jump double-tap probe and expect `[1, 1, 1]`.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Players are never shown the controls, and the control text that exists is wrong in four places  `ui-audio-controls-legend-hidden`
- **Where:** `src/styles/junkyard.css:68`, `src/simulation/JunkyardPlaytest.js:29`, `src/simulation/JunkyardPlaytest.js:46`, `src/simulation/JunkyardPlaytest.js:75`, `src/simulation/JunkyardPlaytest.js:206`, `src/simulation/JunkyardBrain.js:93`, `src/camera/CameraController.js:19`, `src/simulation/PlayerWeapon.js:86`, `README.md:84-94`
- **What's wrong:** `JunkyardPlaytest.js:75` rewrites the `.keys` legend, but `junkyard.css:68` has `.junkyard-mode .hud { display: none; }`. Measured: `.hud` computed `display: none`, so the legend never renders. The only other instructions are in `[data-message]` inside `<div id="junkyardOptions" hidden>`, and with no brain server running that paragraph is replaced by the "Brain unavailable…" error anyway. The existing text is wrong in four places:
  1. The legend says `HOLD RIGHT CLICK AIM ×1.25`, but the code has `const AIM_ZOOM = 1.35;`.
  2. The R reload key (`PlayerWeapon.js:86`) is not mentioned in any in-game text.
  3. `README.md:87-88` says `**F** (or the weapon button) switches...` and `Weapons are visual only; shooting is not implemented.` In fact the keys are 1/2 and shooting works.
  4. `README.md:94` says `Click the scene to capture the mouse`, but capture now happens only after START (`CameraController.js:83` requires `gameplayStarted`).
- **Why it matters (plain language):** A new player or playtester has to guess how to aim, reload, crouch or switch guns. The help that exists is hidden or out of date, which wastes playtest time and produces misleading feedback.
- **What it holds back:** Outside playtests, a web release, and onboarding new team members.
- **How to fix:** Create `src/config/controls.js` exporting one list, e.g. `[{ keys: 'W A S D', action: 'Move' }, { keys: 'Shift', action: 'Sprint' }, { keys: 'Space', action: 'Jump' }, { keys: 'C', action: 'Crouch' }, { keys: '1 / 2', action: 'Pistol / M416' }, { keys: 'Left click', action: 'Fire' }, { keys: 'Hold right click', action: `Aim ×${AIM_ZOOM}` }, { keys: 'R', action: 'Reload' }, { keys: 'Esc', action: 'Pause / release mouse' }]`. Export `AIM_ZOOM` from `CameraController.js` so the number can't drift. Render it from a new `src/ui/ControlsLegend.js`: a small panel that is visible on load, fades after the first START, and toggles with H. Delete the `.keys` rewrite at `JunkyardPlaytest.js:75`. Rewrite README lines 84-94 from the same list. To verify, load `?map=junkyard` and confirm the legend is visible and shows ×1.35 and R.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Developer and AI-debug readouts are mixed into the player-facing HUD  `ui-audio-debug-tools-in-player-hud`
- **Where:** `src/simulation/JunkyardPlaytest.js:20-28`, `src/simulation/JunkyardPlaytest.js:47`, `src/simulation/LeaperCombat.js:42-58`, `src/simulation/LeaperCombat.js:67-74`, `src/simulation/LeaperCombat.js:255-257`, `src/simulation/JunkyardBrain.js:182-187`, `src/camera/LeaperPov.js:8-11`, `src/robot/LolaPlayer.js:306`, `index.html:22-24`
- **What's wrong:** The always-visible toolbar holds `START RUN, START PLAYER, RESTART RANDOM, OPTIONS, SOUND: ON, LEAPER POV` (measured). Under it sit `BRAIN OFFLINE — START RUN TO RETRY` / `BRAIN 7,757,824 · …` and `SIGHT CONNECTING…`. The bottom status line reads `LIVE TRAINED BRAIN // … // STEP 0`. The top-left "LEAPER" box shows the AI's internal attack state: `${status.toUpperCase()}${this.tree.locked ? ' · AIM LOCKED' : ''}` (the screenshot shows `PAUSED`). The brain line also shows `TARGET HIDDEN · MEMORY` / `TARGET VISIBLE`. OPTIONS mixes vision mode, Leaper clearance width, sight lines, the clearance overlay and `DEBUG: DAMAGE LEAPER`. The old pink sandbox button is reused as the weapon/stance button (`2: M416 · C: STANDING`).
- **Why it matters (plain language):** The screen looks like a lab tool rather than a game. Players can read the enemy's private state ("AIM LOCKED", "TARGET HIDDEN · MEMORY"), which gives away exactly what the encounter wants them to work out from the Leaper's eye glow and sounds. The real HUD (health, ammo, crosshair) competes for space with panels a player should never see.
- **What it holds back:** A player-facing build or web release, blind playtests, and a proper pause/settings menu.
- **How to fix:** Create `src/ui/DevOverlay.js` and move into it the brain/sight badges, the status line, LEAPER POV, the clearance and vision tools, the AI-state text and DEBUG DAMAGE. Show it only with `?dev` in the URL or the backquote key, and default it to on in `import.meta.env.DEV` builds. Keep a minimal player layer: health bars, ammo, crosshair, and a start/pause menu (Play, Restart, Sound, Controls, Credits) that replaces START RUN / START PLAYER for players. Remove `[data-attack]` from `#leaperHealthHud`, and let the Leaper's eye charge and laser sound carry the warning. Restyle or drop the `#cuboidToggle` weapon button now that 1/2/C keys and the ammo icons exist. To verify, load without `?dev` and confirm only health, ammo, crosshair and the menu are visible.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] HUD screen code is built and updated inside gameplay classes, using fixed one-per-page IDs  `ui-audio-dom-scattered-in-gameplay`
- **Where:** `src/simulation/LeaperCombat.js:41-74`, `src/simulation/LeaperCombat.js:251-273`, `src/simulation/PlayerWeapon.js:56-72`, `src/simulation/PlayerWeapon.js:262-284`, `src/simulation/LeaperHealthBar.js:20-23`, `src/simulation/LeaperHealthBar.js:50-55`, `src/camera/LeaperPov.js:8-15`, `src/simulation/EyeVision.js:29-42`, `src/simulation/JunkyardBrain.js:103-111`, `src/simulation/JunkyardBrain.js:182-187`, `src/robot/LolaPlayer.js:159-160`, `src/robot/LolaPlayer.js:306`, `src/simulation/JunkyardPlaytest.js:20-50`
- **What's wrong:** `LeaperCombat` creates `this.audio = new LaserAudio()`, appends a SOUND button to `playtest.panel.querySelector('.junkyard-toolbar')`, creates `#leaperHealthHud` and `#combatHud`, adds a debug button, and runs 6 `querySelector` calls per frame in `updateHud()`. The network client `JunkyardBrain` writes the START RUN label (`:110`) and badge/status text every frame (`:186-187`). `LeaperHealthBar` hard-codes `id = 'leaperWorldBar'` and SVG gradient ids `barEyeMetal`/`barEyeIris`. `EyeVision` reads its controls out of the panel, so tests have to fake it (`tests/eye-vision.test.js:28`: `panel: { querySelector: key => controls[key] ||= ... }`). A MutationObserver measured about 22.6 DOM mutation records per frame while idle (status text, progress `max`/`value`, gun `data-*`, the brain label and so on), because values are rewritten even when unchanged.
  Severity calibrated from high to medium. This raises the cost and risk of HUD work, but the hard blockers for a second Leaper are elsewhere: one simulation, one brain session and one combat object. The idle mutation cost is small.
- **Why it matters (plain language):** Changing how the HUD looks means editing combat, networking and character code. A second Leaper would create duplicate IDs, a second SOUND button and a second audio engine, and its health-bar eye could take its colour from the first one's gradient. Every HUD change risks breaking gameplay, and the reverse is also true.
- **What it holds back:** HUD art passes, a menu/settings system, more enemies, unit-testing gameplay without a fake page, and smaller merges with main.
- **How to fix:** Create `src/ui/Hud.js` as the single owner. It builds all HUD markup once, with small views (`HealthView`, `AmmoView`, `ReticleView`, `WorldBarView`, and `DevOverlay` from the finding above). Gameplay classes expose plain data instead of touching the page: e.g. `LeaperCombat.snapshot()` returns `{ lolaHp, leaperHp, lolaTrail, leaperTrail, hitFlash, result }` and `PlayerWeapon.snapshot()` returns `{ ammo, active, reloading, aim, hit, crit, big }`. `main.js`'s `animate()` calls `hud.update(playtest.snapshot())`, which writes an attribute only when the value changed (keep a `last` cache per field). Give per-enemy elements class names plus generated unique ids (e.g. `barEyeMetal-${n}`). Move `LaserAudio` creation into `main.js` and pass it in (see the mix-bus finding). Do it one widget per PR to limit merge conflicts. To verify, the existing node tests should pass without the panel fakes, and the MutationObserver count while idle should drop to near 0.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] `junkyard.css` redefines the same panels up to three times; mobile rules are dead and panels overlap  `ui-audio-css-override-layers`
- **Where:** `src/styles/junkyard.css:37-43`, `src/styles/junkyard.css:46`, `src/styles/junkyard.css:57-60`, `src/styles/junkyard.css:63-66`, `src/styles/junkyard.css:115`, `src/styles/junkyard.css:128-134`
- **What's wrong:** `#combatHud` is positioned three times: centred bottom (`:46`), top-right (`:63-65`) and bottom-left (`:130`). `#leaperHealthHud` is defined at `:57`, moved at `:63-64`, and its progress bar hidden at `:115`. The mobile rule `@media(max-width:700px) { #leaperHealthHud { top: 108px; width: 200px; … } }` (`:60`) is overridden by the later unconditional `:63`. Measured on Pixel 7: the box sits at top 14 px, so the mobile rule never applies. Mobile `#junkyardOptions { max-height: calc(100dvh - 300px) }` (`:41`) is overridden by `:133`. Thirteen commits on this branch touched the file. Visible results:
  - At 1280×720 with OPTIONS open, the panel runs from y 96 to 723.5, off the bottom of the screen. Lola's health box (z-index 30, `pointer-events: auto`) sits over the options text and the top edge of `DEBUG: DAMAGE LEAPER`.
  - On Pixel 7 before START, five overlaps were measured: `#junkyardPanel x #cuboidToggle` (the weapon button is hidden behind the panel), `#joyBase x #combatHud`, `#btnJump x #playerGuns`, `#combatHud x #playerGuns` and `#playerGuns x #status`.
- **Why it matters (plain language):** Each layout tweak is stacked on the previous one, so changing a value often does nothing (a later rule wins) or breaks another screen size. On a normal laptop and on phones, panels cover each other, hiding buttons and taking taps meant for the control underneath.
- **What it holds back:** Designer-driven HUD layout changes, mobile support, and a later HUD art pass.
- **How to fix:** Rewrite `src/styles/junkyard.css` so each element has exactly one base rule plus at most one `@media (max-width:700px)` override placed after it, grouped by screen corner. Define tokens on `:root`: `--hud-gap`, `--hud-font`, safe-area insets via `env(safe-area-inset-*)`, and a z-index scale (`--z-world-ui:10; --z-hud:20; --z-overlay:30; --z-dev:40`). Give each corner one owner: top-left Leaper, bottom-left Lola, bottom-right weapons, top-right view and dev toggle, and a bottom band for touch. Delete the dead `progress` styling and the superseded `#combatHud` blocks. Add `tests/hud-layout.spec.mjs` (Playwright) that fails if any two visible HUD rectangles intersect at 1280×720 and at Pixel 7 size, with OPTIONS both closed and open.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Attribution-required sounds are never credited, and no provenance is recorded for the character, map or naming  `ui-audio-no-attribution-or-provenance`
- **Where:** `assets/audio/sources.json:1-43`, `assets/audio/FOOTSTEPS.md:3-9`, `public/audio/SOUND-SLOTS.md:9-10`, `README.md:125-135`, `index.html:7`, `index.html:14`
- **What's wrong:** I corrected the licence details by re-checking the Freesound pages:
  - **812326** (`leaper-walk.wav`, Artninja) is **CC BY 4.0** (per a licence mirror; the Freesound page lists a CC BY 4.0 component and says "credit me and gpag1 when using these sfx"). Credit is legally required.
  - **766092** (both M416 sounds) is CC BY-NC 4.0. Credit is required as well (see the high finding above).
  - **479353** (laser, Astounded) and **816019** (`lola-run`, qubodup) show Freesound's CC0 text. Their "please credit me" requests are courtesy, not licence terms, although Astounded also writes "ASK FOR COMMERCIAL USE!", so a short email is wise.
  - 856942 (`lola-walk`), 870197, 873903 and 154934 are CC0.
  - I could not confirm the licences of 423117 (knee break), 718965 (pistol) and 407349 from here.
  No credit text appears anywhere in `src/`, `index.html` or README, and no file records licences. For Lola, the README cites only local Blender paths (`C:/Blender/LOWPOLY/Lola_both_animations.blend1.blend`). She is very likely the owner's own work, but that is never stated. The page title and HUD use ARC Raiders' enemy naming (`LEAPER`, `ARC-CLASS HEXAPOD`).
- **Why it matters (plain language):** At least one sound (the Leaper's footsteps) legally requires visible credit, and that requirement is broken as soon as the game is shown publicly. Nobody can answer "are we allowed to ship this?" without redoing the research. Borrowing another studio's enemy name on a public page could draw a takedown request.
- **What it holds back:** Public web release, portfolio or marketing use, and onboarding collaborators or asset buyers.
- **How to fix:** Extend `assets/audio/sources.json` (or create `assets/CREDITS.json`) with one entry per shipped asset: `file`, `runtimeKey`, `sourceUrl`, `author`, `license`, `attributionText`. Include the footstep sources, the `public/audio` slots, `junkyard.glb` and Lola's GLBs (`"original work by <owner>"` where true). Generate a CREDITS section from that file in the OPTIONS panel (or a Credits item in the pause menu proposed above), and copy the same text into README. Decide on public-facing naming before release. Verify that the credits screen lists Artninja and gpag1, Luca2399 (until replaced), Astounded and qubodup.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] No direction or distance in the sound of lasers, impacts or the Leaper; only its footsteps fade with distance, and that maths lives in gameplay code  `ui-audio-no-spatial-audio`
- **Where:** `src/simulation/JunkyardPlaytest.js:64-68`, `src/simulation/LaserAudio.js:107`, `src/simulation/LaserAudio.js:141`, `src/simulation/LeaperCombat.js:157`, `src/simulation/PlayerWeapon.js:206-208`
- **What's wrong:** The only attenuation is `this.combat.audio.step('robot', false, 1 / (1 + (distance / (12 * world.scale)) ** 2));`, and it is measured from the camera, which sits `43 * world.scale` up in TOP view (about 7% volume there). The Leaper's laser plays through `this.audio.fire()` at a fixed 0.65 at any distance. Bullet impacts use `p.combat.audio.play('leaper')` at a fixed 0.7, near or far. Every voice does `source.connect(gain); gain.connect(context.destination)`. `grep` finds no `PannerNode`, `StereoPannerNode` or `PositionalAudio` anywhere in `src/`.
- **Why it matters (plain language):** In a hide-and-seek fight against a hunter that finds you by sight, the player should be able to hear where the Leaper is and which side a laser came from. Right now a shot from behind a wall far to the left sounds exactly like one right in front of you.
- **What it holds back:** Stealth and awareness gameplay, audio-led attack telegraphing, and telling several enemies apart by ear.
- **How to fix:** Add `playAt(key, position, { refDistance, maxDistance, rolloff })` and make `step()` accept an optional position. Each voice routes `source → gain → PannerNode({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance, maxDistance, rolloffFactor })`, then to the bus. Once per frame (in `JunkyardPlaytest.update`), set `context.listener` position and orientation from Lola's head (`target.eyePosition()`) and the camera's forward/up vectors. Call it for:
  - laser fire, with `combat.origin`
  - bolt impacts
  - bullet impacts, with `end`
  - knee break
  - Leaper steps, with `simulation.rig.robot.position`
  Then delete the hand-rolled curve at `JunkyardPlaytest.js:66-67`. Put the distance numbers in `src/config/audio.js`. This is audio only, so the brain recipe is untouched. Verify by ear: stand with the Leaper to Lola's left and confirm its steps and laser come from the left speaker.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] No mix buses, limiter or saved volume settings; volumes are hand-balanced in code because the files aren't normalised  `ui-audio-no-mix-buses`
- **Where:** `src/simulation/LaserAudio.js:12`, `src/simulation/LaserAudio.js:100-101`, `src/simulation/LaserAudio.js:107`, `src/simulation/LaserAudio.js:137`, `src/simulation/LaserAudio.js:141`, `src/simulation/LeaperCombat.js:41-51`
- **What's wrong:** Volumes are written inline: `const LEVELS = { laser: 0.65, m416: 0.12, pistol: 0.45, leaper: 0.7, m416Reload: 0.35, pistolReload: 0.6 };`, and footsteps use `(kind === 'robot' ? 0.45 : kind === 'run' ? 0.35 : 1.6)`. That is a 13× (about 22 dB) spread, needed because the files differ hugely in loudness. Re-measured with numpy:
  - `m416-shot.wav` peak 1.000, RMS 0.445, 200 samples at full scale (clipping baked in)
  - `m416-reload-reserved.wav` 49 clipped samples
  - `lola-walk.wav` peak 0.355, RMS 0.007
  Every voice connects straight to `context.destination`, with no master gain and no `DynamicsCompressorNode`. The 16-voice cap stops the oldest sound regardless of importance (`if (this.voices.size >= 16) this.voices.values().next().value.stop();`). With current clip lengths, held M416 fire plus impacts, Leaper steps and footsteps reach roughly 14-15 voices, so the cap can just about cut the laser cue in a busy moment. SOUND is a single on/off button, not remembered (always `SOUND: ON` after reload), and the audio engine is created inside `LeaperCombat`.
- **Why it matters (plain language):** Balancing the mix means trial-and-error edits to JavaScript numbers. Players have no volume sliders. Loud moments can distort because nothing limits the total. An important warning sound can be cut off during heavy fire.
- **What it holds back:** Designer tuning without code, adding music or voice, a settings menu, and more enemies (each would bring its own audio engine).
- **How to fix:** Create `src/audio/AudioService.js`, instantiated once in `main.js` and passed into `JunkyardPlaytest`/`LeaperCombat`/`PlayerWeapon` instead of `new LaserAudio()`. Its graph is `master GainNode → DynamicsCompressorNode (threshold -6 dB, ratio 20, fast attack as a limiter) → destination`, with bus GainNodes `weapons`, `enemy`, `footsteps`, `impacts`, `voice`, `ui` and `music` feeding master. Move per-sound `{ file, bus, gain, priority, maxVoices }` into `src/config/audio.js` (or the asset manifest from the attribution finding). Change voice stealing to drop the lowest-priority, oldest voice, and give the laser and Lola's hurt sounds high priority. Save bus volumes and mute to `localStorage` and expose sliders in OPTIONS or the pause menu. Loudness-normalise all clips offline (e.g. `ffmpeg -af loudnorm=I=-16:TP=-1`) and re-cut the M416 shot from a non-clipped source, so runtime gains sit near 1.0. Keep the existing epoch/staleness logic. Verify with `tests/laser-audio.test.js` (extend it to assert bus routing and priority stealing).
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] A 4.5 MB raw WAV ships where about 5.6 seconds are used, the run recording is downloaded but never played, and about 29 MB of raw sources sit in git  `ui-audio-oversized-and-dead-audio-assets`
- **Where:** `src/simulation/LaserAudio.js:6-7`, `src/simulation/LaserAudio.js:27-28`, `src/simulation/LaserAudio.js:83-84`, `src/simulation/LaserAudio.js:100`, `assets/audio/lola-walk.wav`, `assets/audio/lola-run.wav`, `assets/audio/sources/`, `public/audio/leaper-knee-break-1.wav`, `.gitattributes:1`
- **What's wrong:** `lola-walk.wav` is 4,422 KB of 48 kHz stereo 24-bit audio, 15.72 s long. Only 10 impacts are used, the last at 5.31 s, each 0.3 s long, so about 5.6 s matters. The build emits `lola-walk-D5EUdLTg.wav 4,528.19 kB`. `step()` does `if (sprinting) kind = 'walk';`, so the `run` clip (`lola-run-8daYx-lg.wav 408.55 kB`) is fetched and decoded but never played, and the `kind === 'run' ? 0.35` branch is dead. All 9 bundled clips are uncompressed PCM, about 5.6 MB in `dist/assets`. `public/audio/leaper-knee-break-1.wav` adds another 592 KB of 48 kHz stereo 24-bit audio for a 2 s clip. `assets/audio/sources/` holds 30.4 MB of raw recordings committed to git (the laser source alone is 21,925,514 bytes), and `.gitattributes` contains only `*.pdf binary`, so there is no LFS.
- **Why it matters (plain language):** Players download about 6 MB of sound, much of which is never heard, which slows web loading, especially on mobile data. Every copy of the repository carries the raw recordings forever.
- **What it holds back:** Web release load time and mobile performance; fast clones for collaborators.
- **How to fix:** Add `scripts/build_audio.mjs`, which runs ffmpeg on each `sources.json` entry. Trim `lola-walk` to 0–5.7 s, or export the 10 impacts as a short sprite like `leaper-walk.wav` and update `FOOTSTEPS.walk` times, then downmix to mono 44.1 kHz and encode `.m4a` (AAC, plays everywhere including Safari) or `.ogg`. Expect well under 500 KB total. Either remove `run` from `CLIPS` and delete the dead branch, or restore its use for sprint and fix `FOOTSTEPS.md`. Move `assets/audio/sources/` to Git LFS or out of the repo, keeping URLs and trim points in the manifest. To verify, run `pnpm build` and check the total size of `dist/assets/*.{wav,m4a,ogg}`, then listen to footsteps in game.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Sound information is spread over five places that disagree, optional slots fetch missing files on every load, and an internal note ships publicly  `ui-audio-registry-drift-and-slot-fetches`
- **Where:** `assets/audio/FOOTSTEPS.md:11-14`, `src/simulation/LaserAudio.js:16-23`, `src/simulation/LaserAudio.js:49-51`, `public/audio/SOUND-SLOTS.md`, `README.md:87-88`
- **What's wrong:** `FOOTSTEPS.md` says `Shift/sprint uses the running recording`, but the code remaps sprint to the walk clip (`LaserAudio.js:83-84`). The sound set is described separately in `CLIPS`, `OPTIONAL`, `sources.json`, `FOOTSTEPS.md` and `SOUND-SLOTS.md`. Every page load requests the six empty slots (`lola-hurt-1..3`, `lola-hurt-big`, `lola-hit-thud`, `leaper-knee-break-2`). Against `vite preview`, `GET /audio/lola-hurt-1.wav` returned `200 OK, Content-Type: text/html`: the single-page-app fallback serves index.html, which then fails to decode silently. The build copies `public/audio/SOUND-SLOTS.md` into `dist/audio/` (served as `text/markdown`).
- **Why it matters (plain language):** Docs that disagree with the code lead to wrong assumptions when tuning sounds. A misnamed or broken file fails exactly like an empty slot, with no warning, so a designer can't tell why a new sound isn't playing. Internal notes get published with the game.
- **What it holds back:** A reliable designer workflow for adding sounds; clean release builds.
- **How to fix:** Make the single audio manifest (see the attribution and mix-bus findings) the only registry, and generate `CLIPS`/`OPTIONAL` from it. In `LaserAudio`'s optional fetch, reject responses whose `content-type` isn't `audio/*`. In dev (`import.meta.env.DEV`), `console.warn` the expected path when a slot is missing or fails to decode. In production, fetch only slots marked filled in the manifest. Move `SOUND-SLOTS.md` to `assets/audio/` so it isn't deployed, and fix the `FOOTSTEPS.md` and README text. To verify, run `pnpm build` and check that `dist/audio/` has no `.md` file and the network tab shows no `text/html` audio requests.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Accessibility gaps: zoom disabled, 8–10 px text, live regions rewritten every frame, and Enter re-triggers the last button clicked  `ui-audio-accessibility-basics`
- **Where:** `index.html:5`, `src/styles/junkyard.css:23-24`, `src/styles/junkyard.css:36`, `src/styles/junkyard.css:42`, `src/simulation/JunkyardPlaytest.js:27-28`, `src/simulation/JunkyardBrain.js:186`, `src/simulation/LeaperCombat.js:63`, `src/styles/main.css:184-193`
- **What's wrong:** The viewport tag `maximum-scale=1, user-scalable=no` blocks pinch zoom. Junkyard text sizes include `.brain-state { font-size: 9px }` (measured computed 9px), sight status 10px, `small` 10px and mobile `#status` 8px. The training panel goes down to 7–7.5 px, but that's a different mode. The `aria-live="polite"` brain line is rewritten every frame by `this.playtest.brainLabel.textContent = …`, and the `role="status"` attack line by `updateHud()`, even when the text hasn't changed, which risks constant screen-reader chatter. Measured: after clicking START PLAYER the button kept focus, and pressing Enter turned it off (`playerMode: false`, "Exploring stopped…"). Space is already protected by `preventDefault` in `InputController`. Touch button text is dark ink on a dark background.
- **Why it matters (plain language):** Small text and blocked zoom are hard to read for many players. Screen-reader users may hear constant chatter. Pressing Enter mid-game can unexpectedly stop the session.
- **What it holds back:** A broader audience and web-store accessibility expectations; later key remapping.
- **How to fix:** In `index.html`, drop `maximum-scale=1, user-scalable=no` (the canvas already has `touch-action: none`). Add a `--hud-font: 12px` token and use it as the minimum for junkyard HUD text. In `JunkyardBrain.update` and `LeaperCombat.updateHud`, write text only when it differs from the last value, and remove `aria-live`/`role="status"` from per-frame telemetry (keep it on real events such as "Lola defeated"). In `JunkyardPlaytest.start()` and `startPlayer()`, call `document.activeElement?.blur()` (or `engine.renderer.domElement.focus()` with `tabindex="-1"` on the canvas). To verify, click START PLAYER, press Enter, and confirm `playerMode` stays true.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] With the brain server missing, START RUN explains nothing on screen and sometimes leaves the mouse captured in a stopped game  `ui-audio-start-run-offline-capture-race` (new)
- **Where:** `src/simulation/JunkyardPlaytest.js:154-164`, `src/simulation/JunkyardBrain.js:103-112`, `src/camera/CameraController.js:120-136`, `src/camera/CameraController.js:148-162`, `src/simulation/JunkyardPlaytest.js:29`, `src/simulation/JunkyardPlaytest.js:46`
- **What's wrong:** `start()` calls `captureMouse()` and then `brain.start()`. With no server on `127.0.0.1:8767`, the fetch fails at once, and `fail()` calls `releaseMouse()` while the lock request is still pending. `releaseMouse()` only bumps `captureGeneration`. It can't exit a lock that hasn't been granted yet, and when the lock arrives, the `then` callback in `captureMouse()` doesn't release it:
  ```js
  Promise.resolve(request).then(() => {
    if (generation === this.captureGeneration) this.capturePending = false;
  }, fallback);
  ```
  In 5 repeated Chromium runs (brain offline, click START RUN), one ended with `locked: true, body: "junkyard-mode mouse-look", walking: false, gameplayStarted: false`. The mouse was captured, the toolbar was unclickable and nothing was running, until the player pressed Escape. In every run, the explanation ("Brain unavailable: … Start the local brain service, then press Reset") went into `[data-message]` inside the collapsed OPTIONS panel (`messageVisible: false`). The only visible hint is the 9 px `BRAIN OFFLINE — START RUN TO RETRY`, which tells the player to do the thing that just failed.
- **Why it matters (plain language):** The trained brain isn't in the repository, so anyone else who opens the game sees START RUN apparently do nothing (sometimes it also grabs their mouse), with no visible reason or next step.
- **What it holds back:** Sharing the project with collaborators and playtesters, and a clear first-run experience.
- **How to fix:** In `CameraController.captureMouse()`, change the success callback to `() => { if (generation === this.captureGeneration) this.capturePending = false; else if (document.pointerLockElement === this.canvas) { this.releasingMouse = true; document.exitPointerLock(); } }`. In `JunkyardBrain.fail()`, show the error in a visible toast or banner, outside `#junkyardOptions`, with the exact command to start the server, and change the badge to `BRAIN OFFLINE — SEE INSTRUCTIONS`. Optionally, disable START RUN until a `reset` succeeds. To verify, with no server running, click START RUN 10 times (reloading in between) and confirm `document.pointerLockElement` is null afterwards and the instructions are visible.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. Every reviewer finding held up on inspection. Four were corrected:
- **Touch:** taps do fire single shots.
- **Pause:** shooting and moving while stopped is a deliberate sandbox feature, but Escape still creates a free-damage exploit.
- **HUD architecture:** severity lowered from high to medium.
- **Attribution:** the laser and run sounds are legally CC0, and the Leaper's footsteps are the clear credit-required case.

### Performance, loading & runtime behaviour (measured)

**How it works today**

The game starts up (`src/main.js`) in three loading steps, and each one waits for the one before it to finish. (1) `createJunkyardWorld` downloads `junkyard.glb` (3.07 MB, 106 meshes, about 98.6k triangles, no textures) and `collision.json` (84,660 triangles; 5.87 MB on disk, about 0.77 MB when the host compresses it, which `vite preview` does). It then parses the JSON and builds two clearance grids, one for the Leaper and one for Lola, on the main thread: about 0.45 s of work (in Node: parse 82 ms, Leaper grid 234 ms, Lola grid 165 ms). (2) `LolaPlayer.create` downloads 14 GLBs: two outfits plus 12 per-weapon jump and reload clips. Between them they embed 30 PNGs, but only 9 different images. (3) The Leaper is built from about 105 procedural meshes, and `JunkyardPlaytest` wires up combat, sight, audio (17 sound requests) and the HUD. On top of that, all rendering runs at maximum quality: MSAA, pixel ratio up to 2, and one 2048² soft-shadow sun.

Each frame, `JunkyardPlaytest.update` runs the brain client, combat, the weapon and the point-of-view camera. Lola's movement runs in 120 Hz sub-steps, and each sub-step animates both outfits and checks collision against the map and the Leaper. About ten times a second (in practice 8–9.6 times, see below), the brain client POSTs to a local Python server at `127.0.0.1:8767` and smooths each reply into the Leaper's pose. Then it renders once. Measured here in Chromium with a software GPU (SwiftShader), so frame rates are not representative but counts and CPU costs are: 174 GL draws per frame (41 for the main view, about 133 for the shadow pass), 244 meshes of which 225 cast shadows, 9 shader programs, 17 GPU textures, and 12 brute-force map raycasts per frame while idle at spawn (up to about 21 when cover is close behind Lola). Game logic costs about 0.65 ms per tick when idle (1.4–2.4 ms with sprint and fire, per the reviewer's profile). The JS heap stays at about 18.7 MB.

The Leaper's speed is set by how many brain replies arrive per second. Two things lower that rate: the network round trip, and (new finding) the display frame rate.

**What's good**

- Gun effects don't leak GPU memory. `GunshotEffects.remove` disposes geometry and material, and the Leaper's bolts and muzzle orbs share one geometry and material (`LeaperCombat.js:52-53`, `LaserVisual.js`).
- The JS heap is stable across idle, sprint and fire, so nothing is leaking.
- Frustum culling and fog do real work: only 41 of 244 meshes are drawn in the main view.
- Several hot paths already reuse scratch objects: `CameraController` tempA/B/C, `LeaperSimulation.v`, one `Raycaster` per `CombatGeometry`, and `LeaperHealthBar.point`.
- Lola's map collision uses a bucketed 2D triangle grid (`JunkyardNavigation`), at about 6–7 µs per query.
- The floating Leaper health bar is a DOM element moved with a CSS transform, not a canvas texture re-uploaded every frame.
- Audio is well managed: a 16-voice cap, a 3-voice cap for robot steps, stop on blur or hidden tab, an epoch counter so stale shots never replay, and footsteps sliced from a single buffer.
- The brain client is careful. It uses `text/plain` so there is no CORS preflight, keeps one request in flight, drops stale replies with generation counters, retries failures, and pauses while the tab is hidden. The server disables Nagle's algorithm.
- Expensive animation analysis (`measureFootContacts`, `measureJumpLanding`) runs once at load, not every frame.
- The `?debug` hook (`window.leaperPlaytest`) made every measurement in this chapter possible without changing code. It's a good base for automated perf checks.

**How professional game projects handle this**

Shipped action games keep four things separate that this branch mixes together:
1. **Simulation.** A fixed-timestep simulation that allocates nothing per frame (pooled objects, preallocated vectors) and paces itself with an accumulator that keeps leftover time instead of throwing it away.
2. **Queries.** Spatial acceleration (a BVH such as three-mesh-bvh, or a physics engine such as Rapier) for every ray and shape query, so a ray costs about a microsecond and doesn't depend on map detail.
3. **Asset pipeline.** Meshopt or Draco compression and quantised GLBs, deduplicated, right-sized textures (KTX2/Basis where possible), compressed audio, and binary or precomputed collision data built off the main thread. Downloads run in parallel behind a progress bar, and shaders and textures are pre-warmed (`renderer.compile`, `renderer.initTexture`) so the first shot, jump or weapon swap never stutters.
4. **Rendering.** Quality tiers (pixel-ratio cap, MSAA, shadow size, which props cast shadows) and a shadow region centred on the camera or player, not on an enemy.

For AI, studios either run the policy on the client (ONNX/WASM, ideally in a Worker; `main` already does this for the seeker in `src/brain/LeaperBrain.js`) or host it on an authoritative server with client-side prediction. In both cases the enemy's speed never depends on network latency or on the player's frame rate. Teams also keep a frame budget, an on-screen perf overlay (fps, draw calls, brain round-trip time) and perf smoke tests in CI.

**Findings**

#### [HIGH] Leaper movement depends on a localhost-only Python HTTP server, and its speed is set by the round-trip time  `perf-brain-localhost-http-loop`
- **Where:** `src/simulation/JunkyardBrain.js:10-13`, `src/simulation/JunkyardBrain.js:55-58`, `src/simulation/JunkyardBrain.js:138-167`, `rl/junkyard_server.py:98`, `rl/junkyard_server.py:195`
- **What's wrong:** The brain address is hard-coded: `fetch(\`http://127.0.0.1:8767/${path}\`, …)` (`:55`). A new step is only requested when `!this.busy && this.clock >= … 1 / LEAPER_STEPS_PER_SECOND` (`:141`), so a step can't start until the previous reply has arrived. Each server step moves the Leaper `throttle × fixed step` (`rl/junkyard_env.py` → `SeekerEnv.step`), so replies per second directly set the Leaper's speed. The server accepts only `http://127.0.0.1|localhost` on ports 4173/4175/5173/5175 (`:98`) and runs a single-threaded `HTTPServer(("127.0.0.1", args.port), …)` (`:195`). Without the private checkpoint (`model_7757824/` is gitignored), the console shows `net::ERR_CONNECTION_REFUSED http://127.0.0.1:8767/reset`, the label reads `BRAIN OFFLINE — START RUN TO RETRY`, and the Leaper never moves. That has no fallback, by design. A simulation of the request gate gives about 9.2 moves/s at 60 fps with a 40 ms round trip, and about 6.3–6.5 moves/s with a 150 ms round trip: a 35% slower Leaper.
- **Why it matters (plain language):** The Leaper only works on a computer that runs the Python program and has the private brain file. On any real network, the slower the connection, the slower the Leaper walks, so the fight feels different on every machine. One server can't comfortably drive several Leapers at once.
- **What it holds back:** Web release (itch/Netlify), playtests on other people's machines, several Leapers at once, and consistent enemy speed for balance tuning.
- **How to fix:** Short term (S):
  1. In `JunkyardBrain.request`, build the address from `new URLSearchParams(location.search).get('brain') ?? import.meta.env.VITE_BRAIN_URL ?? 'http://127.0.0.1:8767'`. Add an `--origin` argument to `rl/junkyard_server.py` that extends `origins`.
  2. Time each request with `performance.now()`, keep a running average of round-trip time and completed steps per second, and show both in `brainLabel` (for example `BRAIN · 9.9 moves/s · 42 ms`). Colour it amber below 9.5 moves/s.

  Long term (XL): run the policy in the browser the way `main` does (`onnxruntime-web` in a Web Worker). Export `ResidualLstmPolicy` from `model_7757824` to ONNX with explicit LSTM hidden and cell inputs and outputs. Port the observation builder (`rl/junkyard_env.py`, `junkyard_geometry.py`, `junkyard_sight.py`) to JS, and prove it identical with recorded fixtures (main's `make_brain_fixtures.py` approach: same observations and same actions to about 1e-5 over a few hundred recorded steps) before switching. **Warning:** the port touches the frozen brain recipe (observation, vision rays, eye-level sight, LSTM state). It must match the fixtures exactly, and the observation must never be changed to make the port easier.

  To confirm: with the server running, the label shows round-trip time and moves/s. For the port, the fixture test passes, and the Leaper moves with the server switched off.
- **Effort:** XL (S for the short-term part)  ·  **Quick win:** no (the short-term part is)

#### [MEDIUM] The Leaper's speed also depends on the player's frame rate, because the step timer throws away leftover time  `perf-brain-rate-depends-on-framerate`
- **Where:** `src/simulation/JunkyardBrain.js:10-13`, `src/simulation/JunkyardBrain.js:138`, `src/simulation/JunkyardBrain.js:141-142`
- **What's wrong:** The comment promises "A steady rate keeps the Leaper's speed the same on busy and idle computers", but the gate resets the timer to zero instead of subtracting one interval:
  ```js
  this.clock += dt * (sim.rig?.mobility ?? 1);
  if (this.ready && (this.running || preview) && !this.busy && this.clock >= (preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND) && !document.hidden) {
    this.clock = 0;   // the overshoot past 0.1 s is lost every step
  ```
  Each step therefore waits 0.1 s plus up to one frame. A re-implementation of this gate with a 40 ms server round trip and ±5% frame jitter (`work/verify-perf/brain-rate.mjs`) gives:
  ```
  fps 144: 9.59 moves/s   fps 60: 9.23   fps 30: 8.63   fps 20: 8.00
  ```
  Lola's speed is frame-rate independent (it uses `dt`), so the chase balance shifts. At 30 fps the Leaper is about 10% slower than at 144 fps, and about 17% slower at 20 fps. It never reaches the intended 10 moves/s even on localhost.
- **Why it matters (plain language):** On a slower laptop the enemy walks noticeably slower than on a gaming PC, so the difficulty you tune on your machine isn't the difficulty other players get.
- **What it holds back:** Consistent balance tuning, and fair comparisons between playtests on different machines.
- **How to fix:** In `JunkyardBrain.update`, keep the remainder and cap it, so a slow reply never causes a burst of catch-up steps:
  ```js
  const interval = preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND;
  if (... && this.clock >= interval && ...) {
    this.clock = Math.min(this.clock - interval, interval);
  ```
  Keep `stop()` resetting `this.clock = 0`. With the same simulation this gives 9.99 moves/s at 144, 60, 30 and 20 fps. It doesn't touch the brain recipe: the policy still gets exactly one observation per step, and only the real-time pacing changes. To confirm, pull the gate into a small pure helper (for example `nextStepDue(clock, dt, interval)`) and add a `node --test` case that drives it at dt = 1/20, 1/30, 1/60 and 1/144 and asserts 10 ± 0.1 steps per simulated second.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Every gunshot creates and disposes new materials and geometries, so isolated shots relink shaders and streaks allocate a new GPU buffer every frame  `perf-gunshot-shader-and-buffer-churn`
- **Where:** `src/simulation/GunshotEffects.js:15-27`, `src/simulation/GunshotEffects.js:34-35`, `src/simulation/GunshotEffects.js:42`, `src/simulation/GunshotEffects.js:55-57`, `src/simulation/PlayerWeapon.js:205-213`
- **What's wrong:**
  - Each shot builds a `new THREE.Line(new THREE.BufferGeometry().setFromPoints(...), new THREE.LineBasicMaterial(...))` and a `new THREE.Mesh(new THREE.ConeGeometry(...), new THREE.MeshBasicMaterial(...))`. A hit adds 5–9 sparks, each with its own `TetrahedronGeometry` and `MeshBasicMaterial`.
  - `remove()` disposes all of them (`:42`). In three r128, `releaseProgram` destroys a program when `--program.usedTimes === 0`. When the last effect expires the program is deleted, and the next shot compiles it again.
  - Every frame, `item.mesh.geometry.setFromPoints([start, end])` (`:57`) runs `this.setAttribute('position', new Float32BufferAttribute(...))`, which means a new GPU buffer each frame.
  - Re-measured with a `gl.linkProgram` / `gl.deleteProgram` wrapper, 4 isolated M416 shots: every one gave `link: 2, del: 2`, and the program count went 9 → 9.
  - Isolated shots are the norm: every pistol shot, the first M416 shot, and any shot fired more than about 0.14 s after the last effect faded.
- **Why it matters (plain language):** The computer may have to rebuild the effect's shaders at the very moment the player pulls the trigger. That can show as a tiny hitch exactly when combat should feel crisp. Browsers' shader caches soften this on real graphics cards, but the waste happens on every isolated shot.
- **What it holds back:** Smooth combat feel, adding more weapons or muzzle and impact effects, and lower-end or mobile web targets.
- **How to fix:** In `GunshotEffects`, stop disposing and reuse instead:
  1. Keep a small free-list pool per effect type (streak, flash, spark). On expiry, `scene.remove(mesh)` and push `{mesh, material}` back into the pool. In `shot()` and `impact()`, pop from the pool, or create only when it's empty. Each pooled entry keeps its own material, so opacity fades stay per effect, but materials are never disposed, so programs stay alive.
  2. Give each streak a preallocated `new THREE.BufferAttribute(new Float32Array(6), 3)` and update it with `attr.setXYZ(0, …); attr.setXYZ(1, …); attr.needsUpdate = true;` (as `EyeVision.show` already does), instead of `setFromPoints`.
  3. Share one unit `ConeGeometry` per gun type and one unit `TetrahedronGeometry`, sized with `mesh.scale`.
  4. Pre-warm once after `PlayerWeapon` is constructed: add one pooled instance of each type to `engine.scene`, call `engine.renderer.compile(engine.scene, engine.camera)`, then remove them.

  To confirm, rerun the `gl.linkProgram` counting check (wrap `WebGLRenderingContext.prototype.linkProgram` in a Playwright script): after warm-up, shots 2..N must show 0 links, and `renderer.info.memory.geometries` must stay flat during held fire. No brain impact.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The only shadow box (26 × 26 units) is centred on the Leaper, so Lola and most of the junkyard lose their shadows when she is away from it  `perf-shadow-box-follows-leaper`
- **Where:** `src/simulation/LeaperSimulation.js:88-89`, `src/simulation/LeaperSimulation.js:113-114`, `src/core/createScene.js:27-38`
- **What's wrong:** In junkyard mode, `updateExternal` (called every frame by `JunkyardBrain.update`) does `this.sun.position.set(state.position.x + 8, 15, state.position.z + 6); this.sun.target.position.set(state.position.x, 0, state.position.z);`. The shadow camera is fixed at `left/right/top/bottom = ±13` (`createScene.js:31-34`). The map at the default width 5.5 spans about ±35.2 × ±33.0 world units (bounds ±24.28 × ±22.74 × scale 1.451). Re-measured: with Lola 5.8 units from the Leaper, her position in shadow-camera space was (−4.3, −3.3), inside. Moved 22 units away, it was (−14.6, −13.7), outside the ±13 box, where three.js draws no shadow. Because of the light's tilt, the shadow stops about 13–16 units from the Leaper.
- **Why it matters (plain language):** When the player explores (START PLAYER keeps the Leaper still) or runs away from the Leaper, her own shadow and nearby props' shadows switch off. They come back as the Leaper approaches. It looks like a bug, removes depth cues for jumping and aiming, and makes the lighting change whenever the enemy walks in.
- **What it holds back:** Visual consistency, bigger maps and levels, and screenshots or trailers for a web release.
- **How to fix:**
  1. Stop moving the sun in junkyard mode. Add a flag to `LeaperSimulation` (for example `sunFollowsRobot`, true by default) and set it false from `main.js` when `junkyardMode`. `TrainingVisualizer` also calls `updateExternal`, so training keeps today's behaviour.
  2. Add a small helper (for example `src/core/shadowFollow.js`) that `main.js` calls before `engine.renderer.render`. It centres the box on Lola, and snaps the centre to the shadow texel size to avoid shimmer:
     ```js
     const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
     const cx = Math.round(p.x / texel) * texel, cz = Math.round(p.z / texel) * texel;
     sun.target.position.set(cx, 0, cz); sun.position.set(cx + 8, 15, cz + 6);
     ```
  3. Alternatively, for this small map, fit one fixed box over the whole yard (about ±40 to allow for the light's tilt) with `mapSize` 4096, and call `sun.shadow.camera.updateProjectionMatrix()`.

  To confirm, in START PLAYER walk Lola 25+ units from the Leaper: her shadow and the tyre stacks' shadows must remain. Rendering only, no brain impact.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Lola's 30 embedded textures are only 9 different images but become separate GPU textures, and the first weapon switch, jump and reload upload textures mid-play  `perf-lola-texture-duplication-first-use-uploads`
- **Where:** `src/robot/LolaPlayer.js:65-77`, `src/robot/LolaPlayer.js:178-189`, `src/robot/LolaPlayer.js:194-231`, `src/robot/LolaPlayer.js:304-308`
- **What's wrong:** Re-scanned the GLB JSON chunks:
  ```
  total images 30 unique by hash 9
  lola-m416.glb / lola-basic.glb: 9 images each (both guns at 2048x2048, 7 body textures at 1024x1024)
  each of the 12 clip GLBs: 1 gun texture at 2048x2048 (68-88 KB PNG, i.e. nearly flat colour)
  ```
  three r128's `GLTFLoader` caches textures per file, so each copy becomes its own GPU texture. Unique set: about 84 MB of GPU memory (RGBA8 plus mipmaps). If both outfits and all 12 clip guns get used in a session: about 168 MB + 12 × 22.4 MB ≈ 430 MB. Clip and reload guns are added invisible (`:184-185`, `:227-228`), so they upload on first use. Re-measured: the first `switchWeapon()` added **16** GPU textures (`renderer.info.memory.textures`); switching back added 0. The reviewer also measured +1 on the first jump and +1 on the first reload.
- **Why it matters (plain language):** The first weapon swap, jump and reload each push big images to the graphics card in the middle of play, which can hitch. Total texture memory can reach hundreds of megabytes for a few flat-coloured guns, which risks crashes or a black screen on phones and low-memory laptops.
- **What it holds back:** Web and mobile release, and adding more weapons, outfits or animation clips (every clip export copies a gun and its 2048² texture).
- **How to fix:**
  1. Quick asset win: in `scripts/export_lola.py` and `scripts/export_lola_clips.py`, export the gun base-colour textures at 512² (they are nearly flat colour). That alone shrinks each copy from about 22 MB to about 1.4 MB of GPU memory.
  2. Code dedupe, after loading in `LolaPlayer.create`: traverse every loaded scene and build a `Map(texture.name → Texture)` (glTF image names such as `m416_base_color` are stable). Point each `material.map` at the shared texture and `dispose()` the duplicates.
  3. Proper fix: make `export_lola_clips.py` export animation-only clip files (no mesh or texture), and in `createJumpClip`/`createReload` clone the outfit's own gun mesh (sharing its material).
  4. Pre-warm after load: `renderer.initTexture(tex)` for every unique texture, then temporarily make both outfits and all clip guns visible, `renderer.compile(scene, camera)`, and restore visibility.

  To confirm, `renderer.info.memory.textures` must not change on the first switch, jump or reload. No brain impact (the sight bones are unchanged).
- **Effort:** M (step 1 is S)  ·  **Quick win:** no (step 1 is)

#### [MEDIUM] Loading runs in three serial phases with large raw assets; first frame at about 5 s on 20 Mbps, plus about 0.45 s of main-thread grid building  `perf-serial-uncompressed-loading`
- **Where:** `src/main.js:24-34`, `src/world/createJunkyardWorld.js:22-29`, `src/world/JunkyardNavigation.js:26-54`, `src/robot/LolaPlayer.js:65-77`, `src/simulation/LaserAudio.js:2-11`, `src/simulation/LaserAudio.js:42-51`, `src/simulation/LaserAudio.js:83-84`
- **What's wrong:**
  - **Serial phases.** `main.js:25` awaits `createJunkyardWorld`, including both clearance grids, before `main.js:34` even starts Lola's 14 downloads. Audio fetches start only when `LeaperCombat` builds `LaserAudio`. The reviewer's 20 Mbps waterfall: map 0.3–2.1 s, a 0.4 s gap for parsing and grids, Lola from 2.5 s, audio from 4.8 s, first frame 5.0 s, last WAV 7.5 s.
  - **Main-thread work.** Re-measured in Node: `JSON.parse` 82 ms, Leaper grid 234 ms, Lola grid 165 ms. Both grids re-bucket the same 84,660 triangles (`JunkyardNavigation.js:33-46`).
  - **Raw assets.** `junkyard.glb` is 3.07 MB of raw float vertices and is not compressed by `vite preview` (its compression filter is `/text|javascript|\/json|xml/`) or by Start-Leaper.ps1's `python -m http.server`.
  - **Audio.** `lola-walk.wav` is 4,528,190 bytes: stereo, 24-bit, 48 kHz, 15.72 s long, but `FOOTSTEPS.walk` uses only up to 5.31 s. `leaper-knee-break-1.wav` is also stereo 24-bit (606 KB). `lola-run.wav` (408 KB) is downloaded and decoded but never played, because `step()` remaps `'run'` to `'walk'` (`LaserAudio.js:83-84`) and `'run'` isn't in `LEVELS`.
  - **Correction to the review.** Over the wire, `collision.json` is about 0.77 MB gzipped on `vite preview` and typical web hosts, so a Float32 binary (2.7 MB, poorly compressible) would *not* reduce download size. Its real cost is the main-thread parse and grid build.
- **Why it matters (plain language):** Over the internet, players stare at "LOADING" for about 5 seconds on decent broadband and much longer on mobile. Nearly a third of the download is one footstep recording that is mostly unused. The page also freezes for almost half a second while the collision grids are built.
- **What it holds back:** Web release, a fast iteration loop for the owner, and more maps or characters (each adds serial load time).
- **How to fix:**
  1. In `main.js`, start Lola's downloads together with the map. Split `LolaPlayer.create` into a `LolaPlayer.load()` that returns the `loadAsync` promises (call it before `await createJunkyardWorld`) and a construction step that waits for `world`.
  2. Lola's grid doesn't depend on the Leaper width (radius 0.25, fixed height). Precompute it in `scripts/export_junkyard.py` as a tiny binary (a `Uint8Array` of 13,908 cells ≈ 14 KB) and load that. The Leaper grid depends on the chosen width, so precompute it for the default 5.5 with a runtime fallback, or build it in a Web Worker. Build the triangle buckets once and share them between both grids. Keep `collision.json` unchanged as the Python server's source (`junkyard_server.py:163`).
  3. Run `gltf-transform` (meshopt plus quantise) on `junkyard.glb` and the Lola GLBs, and register `loader.setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js` (present in r128).
  4. Convert `lola-walk.wav` to mono 16-bit, trimmed to about 5.7 s (or MP3/AAC for about 50–90 KB), do the same for `leaper-knee-break-1.wav`, and remove `run` from `CLIPS`.
  5. Don't postpone audio downloads until the first click: `playBuffer` drops sounds that wait more than 250 ms for decoding, so early shots would be silent. Once the audio is small, start it alongside the map.
  6. Replace the "LOADING…" text with a progress bar fed by the loaders' `onProgress`.

  To confirm, rerun a throttled Playwright load (20 Mbps / 40 ms): first frame and total bytes should drop sharply, and no long task over about 100 ms should appear at boot. No brain impact.
- **Effort:** M  ·  **Quick win:** no (the audio trim and dropping `lola-run.wav` are)

#### [MEDIUM] About 12–21 brute-force raycasts per frame against all 106 map meshes, with no acceleration structure, some of them while the fight is paused  `perf-brute-force-raycasts`
- **Where:** `src/simulation/CombatGeometry.js:19-29`, `src/camera/CameraOcclusion.js:35-47`, `src/simulation/LeaperCombat.js:201-208`, `src/simulation/LeaperCombat.js:222-225`, `src/simulation/PlayerWeapon.js:33-39`, `src/simulation/PlayerWeapon.js:195-203`, `src/simulation/LeaperLegDamage.js:153`
- **What's wrong:** `CombatGeometry.hit` runs `this.raycaster.intersectObjects(this.meshes, false)` over all 106 map meshes. three r128's `Mesh.raycast` culls only by bounding sphere and box against the *infinite* ray (`raycaster.far` is not used for culling), then tests triangles. `CameraOcclusion.resolve` casts 9 probes per frame (`for (let i = -1; i < 8; i++)`) and repeats an all-hits pass per probe when cover is close (`:42-47`). `LeaperCombat.update` casts a sight ray per in-range body point every frame, even when `paused`, although `AttackController.tick` returns immediately when paused (`AttackController.js:15-16`). Re-measured in page: 12 map raycasts per frame idle at spawn (no close cover); random-direction rays cost 0.141 ms for a 2-unit ray and 0.177 ms for an 80-unit ray, so length barely matters. Each shot costs about 0.8 ms (`fire()`: 2 map rays plus 2 recursive raycasts over 37 Leaper meshes, plus a full `scene.updateMatrixWorld(true)`).
- **Why it matters (plain language):** Today this is well under a millisecond on a fast desktop. But it is paid every frame, grows directly with map detail and with every extra enemy (each Leaper adds sight and bolt rays), and runs several times slower on laptops. It is the main thing that will make a bigger level or a second Leaper drop frames.
- **What it holds back:** Larger or more detailed levels, several Leapers, more projectiles, and low-end web targets.
- **How to fix:**
  1. Give `CombatGeometry` an acceleration structure built once from the static map. Either use three-mesh-bvh on a merged static geometry (choose a release whose peer range accepts three 0.128, or upgrade three), or a 3D uniform grid with DDA traversal (the same idea as `JunkyardNavigation`'s buckets). Keep `hit()` returning the nearest hit, and add `anyHit(origin, dir, far)` for `clear()` and occlusion.
  2. In `LeaperCombat.update`, skip the `visible` sight rays (and the `selectedPoint` search) when `paused`.
  3. In `CameraOcclusion.resolve`, collect all hits in the first pass instead of re-casting, and consider 5 probes instead of 9.

  These rays only drive the camera and the Leaper's *attack* visibility, not the policy's observation (the server computes that), so the brain is unaffected as long as hit results stay identical. To confirm, add a node test comparing old and new `hit()` on a few thousand random rays (same distance to 1e-6), and check rays per frame and time with the `?debug` hook.
- **Effort:** M  ·  **Quick win:** no (the paused early-out is)

#### [MEDIUM] Rendering always runs at maximum quality (MSAA, pixel ratio up to 2, soft 2048² shadows, 225 of 244 meshes casting shadows) with no quality settings  `perf-render-max-quality-no-tiers`
- **Where:** `src/core/createScene.js:4-8`, `src/core/createScene.js:27-38`, `src/world/createJunkyardWorld.js:36-39`, `src/robot/createHexapod.js:25-31`, `src/robot/createHexapod.js:204`, `src/robot/LolaPlayer.js:107-113`
- **What's wrong:** `new THREE.WebGLRenderer({ antialias: true })`, `setPixelRatio(Math.min(window.devicePixelRatio, 2))`, `PCFSoftShadowMap`, `mapSize.set(2048, 2048)`. Every map mesh gets `castShadow = true` (`createJunkyardWorld.js:38`), and every hexapod mesh too (`createHexapod.js:204`). Re-measured: 174 GL draws per frame, of which 41 are the main pass, so about 133 are the shadow pass. 244 meshes, 225 shadow casters. There is no graphics-settings module. The software-GPU numbers can't show real GPU fill cost, but the structure is clear. **Correction to the review's fix:** the map's `Cube` object holds both the floor *and* the perimeter walls (`createJunkyardWorld.js:40-41`), so turning off its `castShadow` would remove wall shadows.
- **Why it matters (plain language):** On a high-resolution laptop with built-in graphics, the game draws up to 4× the pixels with anti-aliasing and a full shadow pass every frame, and there is no way to turn quality down. Each extra Leaper adds about 200 more draws.
- **What it holds back:** Web release on laptops and phones, more enemies on screen, and letting the owner trade looks for frame rate.
- **How to fix:**
  1. Add `src/config/graphics.js` with low/medium/high presets: pixel-ratio cap 1 / 1.5 / 2, antialias on or off, shadow map 1024 / 2048 and `PCFShadowMap` vs `PCFSoftShadowMap`, and a minimum prop size for casting shadows. Pick the preset with `?quality=` or an OPTIONS select, and apply it in `createScene`. Note that antialias needs a renderer rebuild or page reload.
  2. In `createJunkyardWorld`, turn off `castShadow` for small or flat props (for example by bounding-box height). Split `Cube` into floor and wall parts, and let only the walls cast.
  3. In `createHexapod`, merge same-material sub-meshes *within* each part group with `BufferGeometryUtils.mergeBufferGeometries` (r128). Keep one object per part (coxa, femur, tibia, calf, knee, calfJoint) so `LeaperLegDamage`'s `userData.leaperJoint` mapping and detaching keep working, and leave the eye and weak point separate.
  4. Optionally, lower the pixel ratio when frame time stays over budget.

  To confirm, compare `renderer.info.render.calls` and frame time across presets. Rendering only, no brain impact.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] RESTART RANDOM freezes the page for up to about 1 s (synchronous spawn search plus overlay flood fill)  `perf-restart-random-main-thread-freeze`
- **Where:** `src/world/randomJunkyardStart.js:8-17`, `src/world/JunkyardNavigation.js:87-131`, `src/simulation/JunkyardPlaytest.js:95-108`, `src/simulation/JunkyardPlaytest.js:245-289`
- **What's wrong:** `randomJunkyardStart` tries up to 80 random pairs, and each calls `nav.route(start, target)`: a breadth-first search that runs `clearLine` (0.1-unit steps, each a `blocked()` query) on every edge. `makeOverlay` then repeats a similar flood fill. Re-measured in page: three clicks took 324, 779 and 880 ms. In Node, `randomJunkyardStart` alone took 75–919 ms.
- **Why it matters (plain language):** The button meant to give the owner a quick new scenario locks the whole page for up to a second, and it gets worse on bigger maps.
- **What it holds back:** Fast designer iteration, and bigger maps.
- **How to fix:** At load, label the connected regions of `navigation.free` once: one flood fill that stores a region id per cell in a `Uint16Array`, caching `clearLine` results per edge. `randomJunkyardStart` then only picks two free cells with the same id that meet the distance rules (no `route()` call), and `makeOverlay` colours cells by the stored ids instead of re-running its search. Optionally build the labels in the same Worker as the grids. To confirm, the click handler takes under about 20 ms. Spawn selection doesn't feed the brain's observations.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Game logic allocates about 80–94 KB per tick, and Lola-versus-Leaper collision has no distance early-out  `perf-hot-path-allocation-collision-wrapper`
- **Where:** `src/simulation/JunkyardBrain.js:33-47`, `src/world/playerContact.js:10-28`, `src/robot/LolaPlayer.js:576-605`, `src/robot/LolaPlayer.js:620-627`, `src/simulation/LeaperSimulation.js:340-402`, `src/simulation/CombatGeometry.js:25-28`
- **What's wrong:** Every `playerBlocked` call runs `Math.min(leaperClearance(px, pz, from, scale), leaperClearance(px, pz, to, scale))`, sometimes twice (`:45-47`). Each call builds 19 disc objects plus 2 arrays (`Math.min(...leaperDiscs(pose).map(...))`). `leaperReach()` exists but is only used for spawn spacing (`JunkyardPlaytest.js:210`), never as an early-out. `LolaPlayer.moveStep` calls `Object.entries/values/map/reduce` per outfit per 120 Hz sub-step, and `solveAndPlace` makes about 12 `new THREE.Vector3()` per leg per frame. Re-measured: `leaperClearance` 2.45 µs per call in Node, and the full wrapper about 6.2 µs per call in page. The reviewer's allocation profile: 79–94 KB per tick, with `leaperDiscs` the largest single site (21%) and GC at 4–6%.
- **Why it matters (plain language):** Making throw-away objects every frame forces the browser to stop now and then to clean up, which can show as occasional tiny hitches. It is small today but grows with every system written the same way.
- **What it holds back:** Steady frame pacing on slower machines, and headroom for more enemies or effects.
- **How to fix:**
  1. In the `JunkyardBrain` wrapper, return the map result early when `Math.hypot(x - pose.x, z - pose.z) > leaperReach(scale) + margin` for both `from` and `to`.
  2. Rewrite `leaperClearance` as a plain loop over a module-level preallocated disc array. Keep the same shape and `contact.version` 3, so `rl/junkyard_env.py` stays in sync and the brain is unaffected.
  3. Cache `Object.entries(outfit.actions)` as arrays in the `LolaPlayer` constructor.
  4. Give `solveAndPlace`/`placeSegment` module-level scratch vectors.

  To confirm, the existing `tests/*.test.js` must still pass, and add a unit test that the early-out returns the same answer as the full check on a grid of points around the Leaper.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Both Lola outfits are animated in every 120 Hz sub-step even though only one is visible  `perf-hidden-outfit-animated-substeps`
- **Where:** `src/robot/LolaPlayer.js:522-525`, `src/robot/LolaPlayer.js:576-610`, `src/robot/LolaPlayer.js:635-702`, `src/main.js:88`
- **What's wrong:** `const steps = Math.max(1, Math.ceil(deltaTime * 120));` and, inside `for (const outfit of this.outfits)`, `outfit.mixer.update(deltaTime);` (`:679`). `showWeapon` hides the unselected outfit (`:305`). Re-measured mixer updates per game tick: 4 at 60 fps, 8 at 30 fps, 24 at 10 fps. The work grows as the frame rate drops (dt is capped at 0.1 s, `main.js:88`).
- **Why it matters (plain language):** Half of Lola's animation work is for a model nobody sees, and the extra work grows exactly when the computer is already struggling.
- **What it holds back:** Adding more animated characters or NPCs, and frame rate on slow machines.
- **How to fix:** Keep the 120 Hz sub-steps for movement and collision. Inside `moveStep`, call `mixer.update` only for `this.outfits[this.weaponIndex]`. On `switchWeapon`, copy each action's `time`, `timeScale`, effective weight and `outfit.current` from the old outfit to the new one (same clip names), then run `mixer.update(0)` before showing it. This needs care: the 30/60 fps clock test in `tests/lola-player.test.js` (#56) covers this code and already fails on this branch, so fix that test first and then use it plus a manual weapon swap mid-run (no pose pop) to confirm.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The HUD rewrites text and CSS variables every frame, and the floating health bar forces an extra layout while it's showing  `perf-hud-dom-writes-every-frame`
- **Where:** `src/simulation/JunkyardBrain.js:186-187`, `src/simulation/LeaperSimulation.js:115-118`, `src/simulation/LeaperCombat.js:251-273`, `src/simulation/PlayerWeapon.js:280-284`, `src/simulation/LeaperHealthBar.js:100-115`
- **What's wrong:**
  - `JunkyardBrain.update` sets `brainLabel.textContent` and `statusElement.textContent` every frame. `LeaperSimulation.updateExternal` has already written `statusElement`, with `toLocaleString`, earlier in the same frame.
  - `LeaperCombat.updateHud` makes 6 `querySelector` calls plus text and dataset writes every frame, and sets `--damage-flash` on `<html>` (`:272`). `PlayerWeapon.update` sets `--good-flash` on `<html>` every frame (`:284`).
  - Assigning `textContent` always replaces the text node. The reviewer measured about 1 style recalculation and 1 layout per frame while idle.
  - Missed by the review: while the floating bar is visible, `LeaperHealthBar.update` writes `style.opacity` (`:101`) and then reads `canvas.clientWidth/clientHeight` (`:115`) after those text writes. That forces a synchronous layout in the middle of the frame during combat.
- **Why it matters (plain language):** The browser spends about a millisecond a frame redrawing words that haven't changed. That's small on a desktop but noticeable on low-end devices, and it grows as more HUD is added.
- **What it holds back:** HUD growth (more enemy health bars, objectives) on low-end web targets.
- **How to fix:**
  1. Cache element references in the `LeaperCombat` and `PlayerWeapon` constructors.
  2. Write only when a value changes, through a tiny helper such as `setText(el, s) { if (el.textContent !== s) el.textContent = s; }` and a last-value check before each `setProperty`.
  3. Drop the redundant `statusElement` write in `updateExternal` for junkyard mode.
  4. In `LeaperHealthBar`, cache the canvas size from a `resize` listener instead of reading `clientWidth` every frame.
  5. Put the two flash variables on a dedicated overlay element instead of `:root`.

  To confirm, the Performance panel shows no "Recalculate Style"/"Layout" in idle frames, and no forced reflow warning while the bar is visible.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Missing optional sound slots get the HTML page (200 OK) in dev and preview, and decode failures of real files are silently swallowed  `perf-optional-audio-html-fallback`
- **Where:** `src/simulation/LaserAudio.js:16-23`, `src/simulation/LaserAudio.js:49-51`, `src/simulation/LaserAudio.js:63-67`
- **What's wrong:** `fetch(\`${OPTIONAL_BASE}${name}.wav\`)` then `response.ok ? response.arrayBuffer() : null`. Re-measured on the dev server: `200 text/html` for `leaper-knee-break-2`, `lola-hurt-1/2/3`, `lola-hurt-big` and `lola-hit-thud`. Vite's `htmlFallbackMiddleware` rewrites any `Accept: */*` request for a missing path to `/index.html` (default SPA mode, no `vite.config` in this branch). Those bytes reach `decodeAudioData`, which throws, and the error is swallowed by `catch { /* An unfilled slot is expected. */ }`. Plain static hosts (Start-Leaper.ps1's Python server, GitHub Pages) return 404, so this is harmless there.
- **Why it matters (plain language):** Empty sound slots happen to work, but if the owner drops in a sound file in a format the browser can't play, nothing says so. The sound just never plays.
- **What it holds back:** Clear feedback when the owner adds new sounds, and clean deployment on hosts with an SPA fallback.
- **How to fix:** Accept a slot only when `response.ok && response.headers.get('content-type')?.startsWith('audio/')`. In the decode `catch`, `console.warn` the file name whenever the bytes did come from an audio response. Better still, generate a small manifest of files present in `public/audio` at build time (a few lines in a Vite plugin or a script), so empty slots are never requested. To confirm, the dev server shows no requests for empty slots, and a deliberately broken WAV logs a warning.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] No in-game performance overlay, frame budget or automated perf check  `perf-no-perf-overlay-or-budget`
- **Where:** `src/main.js:76-77`, `package.json:10-14`
- **What's wrong:** `?debug` exposes only `window.leaperPlaytest`. `package.json` has only `dev`/`build`/`preview` scripts (no test, lint or perf script). Draw calls, raycasts per frame, allocations and brain round-trip time could only be measured by injecting wrappers from outside.
- **Why it matters (plain language):** The owner can't see when a new asset or effect pushes the game over budget, or when the brain is running slow, until it already feels wrong.
- **What it holds back:** Designer self-service tuning, and catching performance regressions before merging with `main`.
- **How to fix:**
  1. Add a `?perf` overlay: a small DOM panel updated twice a second with fps and 95th-percentile frame time, `renderer.info.render.calls/triangles`, `renderer.info.memory.textures/geometries`, brain round-trip time and moves per second (see the brain findings), and map rays per frame (a counter in `CombatGeometry.hit`).
  2. Add `"test": "node --test tests/*.test.js"` and a `pnpm perf` Playwright smoke script (new, in `scripts/`). It loads `?map=junkyard&debug`, reads the same numbers, and fails when draw calls, rays per frame, `memory.textures` after a weapon swap, or total payload exceed agreed budgets.
- **Effort:** S  ·  **Quick win:** yes

#### [INFO] While the brain is loaded but the run is paused, the page keeps sending a 'sense' request 10 times a second  `perf-sense-polling-while-paused`
- **Where:** `src/simulation/JunkyardBrain.js:140-146`, `src/simulation/EyeVision.js:46-62`, `src/simulation/JunkyardPlaytest.js:28`, `rl/junkyard_server.py:177-187`
- **What's wrong:** `const preview = !encounterOver && !this.running && Boolean(this.playtest.sight);` sends `sense` every 0.1 s with a fresh `sight_pose` (two `updateMatrixWorld(true)` calls and new vectors), and the server recomputes the sight check each time. **Correction to the review:** this preview feeds the always-visible sight status line (`[data-sight-status]`, which sits outside the OPTIONS panel at `JunkyardPlaytest.js:28`). Limiting it to "OPTIONS open or sight lines shown" would break that status. The cost is also small: one small localhost request per 0.1 s, and no policy step.
- **Why it matters (plain language):** While paused, the game and the brain program keep doing a little unnecessary work. That's harmless today, but it adds up if several sessions or Leapers share one server.
- **What it holds back:** Sharing one brain server between several sessions or Leapers (minor).
- **How to fix:** In `JunkyardBrain.update`, send `sense` only when Lola or the Leaper has moved, turned or changed weapon since the last preview (compare `target.mesh.position`, `weaponIndex`, crouch and jump state against the last sent values), with a slow 1–2 Hz keep-alive. The status line keeps working, and the policy and its memory are untouched.
- **Effort:** S  ·  **Quick win:** yes

#### [INFO] One 695 KB JS chunk bundles three.js with every game mode  `perf-single-bundle`
- **Where:** `src/main.js:1-15`, `package.json:15-20`
- **What's wrong:** `dist/assets/index-Q00sEOrM.js` is 695,269 bytes (about 186 KB gzipped), with Vite's >500 KB warning. `main.js` statically imports the training, default and junkyard modes. Most of the size is three.js r128 itself. That's small next to the roughly 14.8 MB of assets.
- **Why it matters (plain language):** After a release, every small code change makes returning players download all of three.js again, and training-only code ships to players.
- **What it holds back:** Efficient web caching after release.
- **How to fix:** Add a `vite.config.js` with `build.rollupOptions.output.manualChunks: { three: ['three'] }`, and load `TrainingVisualizer`/`createTrainingWorld` and the junkyard modules with dynamic `import()` based on the URL mode in `main.js`. To confirm, `pnpm build` produces a separate `three-*.js` chunk and the warning disappears.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. All 15 reviewer findings held up. Three were corrected: `perf-serial-uncompressed-loading` (collision JSON is already gzipped over the wire, binary would not shrink the download, and audio downloads should not wait for a click), `perf-render-max-quality-no-tiers` (the `Cube` holds the walls too, so its shadows must stay), and `perf-sense-polling-while-paused` (it powers the visible sight status, so it was downgraded to info).

### Testing, tooling, docs, repo hygiene & branch strategy

**How it works today**

*Tooling.* `package.json` has three scripts: `dev`, `build` and `preview`. It uses Vite 7.3.6, pins three.js to 0.128.0, and sets `pnpm@11.16.0` and node `>=20.19`. There is no test, lint, format or typecheck script. The branch has no ESLint, Prettier or tsconfig/jsconfig, no `vite.config.js` and no CI (`.github/` does not exist). `pnpm-workspace.yaml` only holds the pnpm 11 `allowBuilds` setting, which is normal for a single-package pnpm project. On the Python side, `requirements-rl.txt` gives version ranges only. It has no torch line, no Python version and no lock file. The same file serves both the training lab and the game's brain server.

*Tests.* There are three kinds, and someone has to run each one by hand.
1. **Node tests.** 15 `node:test` files hold 69 tests and take about 13 s. They load the real Lola GLBs and the real junkyard collision JSON. At HEAD, 65 pass and 4 fail, all in `tests/lola-player.test.js`. The same four tests passed at the previous commit `d0dc868` (35/35 green), so the last commit broke them.
2. **Python tests.** Two unittest files. They need torch, sb3-contrib and the uncommitted `model_7757824/` checkpoint. Without the checkpoint, only 3 sight tests run.
3. **Browser pages.** Three pages, served through Vite. Run headless here, `browser-combat.html` passed all 155 checks in about 5 s. `camera-player.html` fails: three of its checks are out of date or failing. `camera-preview.html` is a visual demo, not a test.

*Docs, run path, Git.*
- **Docs.** README.md and README-RL.md cover setup. TRAINING.md is the RL experiment ledger, but it also holds the game's feature changelog. AGENTS.md, the briefing file every coding agent reads, still describes the PPO_8/PPO_10-era prototype and never mentions Lola or the junkyard.
- **How the game runs.** The game is `index.html` + `src/main.js?map=junkyard`; the same entry also boots the RL replay viewer (`?training=1`) and the old sandbox (the default). `src/simulation/JunkyardBrain.js` POSTs to `http://127.0.0.1:8767`. There, `rl/junkyard_server.py` runs a frozen copy of the lab environment, `rl/checkpoint_environment.py`. That copy is byte-identical to `rl_environment.py` at `7689aca` and on current main. The server loads the gitignored RecurrentPPO checkpoint `model_7757824` (34 inputs, policy SHA256 `883dade3…`).
- **Launcher.** `Start-Leaper.ps1` is a Windows-only launcher.
- **Git.** The branch has 25 commits since the merge-base. The last one, `9b384c9`, alone is 187 files and +80,153 lines, with 75 binary files and no LFS. Over the same period, main gained an RL "seeker" lab and an in-browser ONNX brain (a different, 26-input model). A trial merge conflicts in 7 files.

**What's good**
- **Unusually strong test intent for a designer-led project.** The node tests load the real exported Lola skeletons and clips (`tests/lola-player.test.js:14-21`) and the real collision JSON (`tests/junkyard-navigation.test.js:12`). They check animation timing, stride distance, jump landing, leg damage and audio gating, not just math helpers.
- **The combat page is close to ready for CI.** `tests/browser-combat.js` is a 155-check, real-asset regression of the whole combat loop: warning/lock, cover, damage, POV, reload, leg breaking, defeat/restart. It passes headless as-is (`PASS 155 · Leaper combat regression`).
- **The code is lint-clean.** ESLint core rules over `src`, `tests` and `scripts` found only 3 unused variables. `git diff --check` is clean, and all text files are LF.
- **The team is careful about the frozen brain.**
  - `load_brain` refuses any checkpoint that is not the 7,757,824-step, 34-input one (`rl/junkyard_server.py:39-40`).
  - The browser checks `model_step`, `policy_sha256`, `contact_version` and `sight_version` on reset (`src/simulation/JunkyardBrain.js:84-86`).
  - The Python test asserts the same actions as `model.predict`.
  - TRAINING.md entries restate that the policy SHA256 is unchanged.
- **The frozen copy is exact.** `rl/checkpoint_environment.py` is byte-identical to the recipe the checkpoint was trained on.
- **JavaScript dependencies are tidy.** There is an exact `packageManager` and a committed lockfile that resolves three to 0.128.0 and vite to 7.3.6.
- **Commit messages are honest and readable.** The last commit's message openly states the 65/69 result and what was not verified. Most earlier commits are focused, at 1-19 files each.
- **Audio sources are traced.** Clip origin is recorded: Freesound IDs, authors, start times and durations in `assets/audio/sources.json` and `assets/audio/FOOTSTEPS.md`. `public/audio/SOUND-SLOTS.md` gives the owner a no-code way to add sounds.
- **The in-game help text is up to date.** It lists the current controls (`JunkyardBrain.js:93`: "1 / 2 switch guns; left click fires…"), even where the README is out of date.

**How professional game projects handle this**

Professional teams, including small indie teams on Unity or Unreal, do a few things as standard:
- **Automated checks.** A build machine (or a GitHub Actions job) builds every push and runs unit tests plus a short automated "functional" test on a real level, such as Unreal Gauntlet/Automation or Unity play-mode tests. A red test blocks the merge.
- **Source art kept separately.** Source art (.blend/.psd files, raw audio masters) lives in Git LFS, Perforce or a dedicated art store. The game repo holds only the exported runtime assets.
- **Short branches.** Features go on short-lived branches, merged often into a trunk that always builds.
- **One way to start.** There is one "how to run" page and a one-command bootstrap that works on every developer's operating system.
- **Credits on file.** Every third-party asset is listed with its licence, which publishing and web-portal review require.

Teams that ship learned agents, for example with Unity ML-Agents, keep the Python training package separate from the game. They export the trained policy to ONNX and version it as a game asset together with its observation/action contract, so playing never needs Python or a private checkpoint.

Here, by contrast:
- The tests exist but nothing runs them.
- The brain that drives the core loop exists only on one disk.
- The game and the RL lab share one root folder, one entry page and one ledger file.
- The last week of work landed as one 187-file commit.

main has already started down the ML-Agents-style path (onnxruntime-web, fixture parity tests). This branch has not.

**Findings**

#### [CRITICAL] The trained brain that drives the Leaper is not in the repo and has no download or setup path  `engineering-brain-checkpoint-not-distributed`
- **Where:** `.gitignore:15-16`, `rl/junkyard_server.py:23-41`, `rl/junkyard_server.py:89`, `README.md:73-74`, `tests/test_junkyard_brain.py:21`, `tests/test_eye_vision.py:50`, `src/simulation/JunkyardBrain.js:55`
- **What's wrong:** The checkpoint is excluded from Git (`.gitignore:15-16`: `*.zip` / `/model_7757824/`). The server defaults to `ROOT / "model_7757824"` (`rl/junkyard_server.py:89`), and README.md:73-74 says the model "is loaded from the local, uncommitted `model_7757824/` directory". No file says where to get it, and it cannot be re-trained: the load refuses anything but the exact 7,757,824-step weights.

  Loading `/?map=junkyard` here (headless) shows:
  ```
  LIVE TRAINED BRAIN // BRAIN OFFLINE — START RUN TO RETRY // STEP 0
  ```
  Both Python test files fail before running anything:
  ```
  FileNotFoundError: [Errno 2] No such file or directory: '.../model_7757824'
  Ran 0 tests ... FAILED (errors=1)
  ```
- **Why it matters (plain language):** Anyone other than the owner can open the junkyard and shoot a frozen Leaper, but cannot fight a moving one. That includes a teammate, a contractor, an automated test machine, or the owner on a new PC. The enemy's whole movement brain exists on one hard drive. If that drive dies, the core enemy is gone for good.
- **What it holds back:** Onboarding anyone else; CI that runs the real brain tests; a web release; backup of the project's most valuable asset; merging with main, whose brain is a different, committed ONNX file.
- **How to fix:**
  1. Zip the five files `load_brain` reads (`data`, `policy.pth`, `policy.optimizer.pth`, `pytorch_variables.pth`, `_stable_baselines3_version`) into `brain-7757824.zip`.
  2. Attach it to a GitHub Release on the (private) repo, for example tag `brain-7757824`. Keep a second copy in a cloud drive. `*.zip` stays ignored, so the zip never enters Git history.
  3. Add `scripts/fetch_brain.py`. It downloads the asset (`gh release download brain-7757824 -p brain-7757824.zip`, or an HTTPS URL), unzips it into `model_7757824/`, and checks the policy hash, printing a plain-language message if it does not match:
     ```python
     digest = hashlib.sha256((dest / "policy.pth").read_bytes()).hexdigest()
     assert digest == "883dade3c7617d0fd85793c405ba8ccadd66c5e914c9032356ff7318351eb594"
     ```
  4. Make `python scripts/fetch_brain.py` step 1 of the "Play the game" instructions in README.md.
  5. *Confirm:* on a fresh clone, run the fetch script, then `python tests/test_junkyard_brain.py` (all 4 tests run and pass). Open `?map=junkyard` and check that the badge reads `BRAIN 7,757,824`.
  6. *Later, for a web release:* follow main's pattern (`export_to_onnx.py`, `public/leaper.onnx`, fixture parity tests). Export the ResidualLstmPolicy actor with explicit LSTM state inputs and outputs, and port JunkyardEnv's 34-value observation to JS. Prove the same actions as `model.predict` on recorded fixtures to 1e-5 before switching. This must reproduce the frozen recipe exactly (34 inputs, ray layout, memory timing, signed throttle). Do not change it.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] No CI and no test, lint or browser-test scripts: tests run only when someone remembers  `engineering-no-ci-no-test-scripts`
- **Where:** `package.json:10-14`, `AGENTS.md:128-130`, `TRAINING.md:351-353`
- **What's wrong:** The only scripts are `"dev": "vite", "build": "vite build", "preview": "vite preview"`. `ls .github` gives "No such file or directory". There is no lint or format config either.
  - AGENTS.md:130's testing guidance is entirely manual ("run `pnpm build`, then verify chase, lens, and top cameras…").
  - TRAINING.md:351-353 tells you to build the browser test with a hand-typed Vite JS API call.
  - The cost shows in the record. Four tests that were green at `d0dc868` are red at `9b384c9`. The camera browser page was committed already failing. Nothing stopped either.
- **Why it matters (plain language):** There are about 230 automated checks, but nothing runs them when code changes. So every new feature can quietly break an old one, like movement, camera or the brain handshake, and nobody finds out until a playtest feels wrong.
- **What it holds back:** Safe merging with main; several agents or teammates working at once; designer tuning with confidence; any release process.
- **How to fix:**
  1. In `package.json` add:
     ```json
     "test": "node --test \"tests/*.test.js\"",
     "test:browser": "node tests/run-browser.mjs",
     "lint": "eslint src tests scripts",
     "check": "pnpm build && pnpm test && pnpm test:browser"
     ```
     The quoted glob needs Node ≥ 21. On Node 20, plain `node --test` finds the same 69 tests, which was checked here.
  2. Add `playwright` and `eslint` as devDependencies.
  3. Write `tests/run-browser.mjs` (about 40 lines):
     - Start Vite with its JS API (`createServer({ server: { port: 5210, strictPort: true } })`).
     - Launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`, which WebGL needs headless.
     - For `tests/browser-combat.html` and `tests/camera-player.html`, wait up to 120 s for `document.title` to start with `PASS` or `FAIL`.
     - Exit non-zero on `FAIL`, on a timeout, or on any `pageerror`.
  4. Add `.github/workflows/ci.yml` with these steps on `ubuntu-latest`: `pnpm/action-setup`, `actions/setup-node` (node 22, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, `npx playwright install --with-deps chromium`, `pnpm test:browser`. Add a second job that runs the checkpoint-free Python tests (see `engineering-python-tests-checkpoint-coupled`).
  5. Replace the manual instructions at AGENTS.md:128-130 and TRAINING.md:351-353 with "run `pnpm check`".
  6. Expect CI to be red at first, because of the 4 node failures and the camera page. Fix or mark those first (next two findings).
  7. *Confirm:* push a branch and check that the Actions run is green. Then break one assertion on purpose and check that it turns red.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] A long-lived, diverged branch: one 187-file "save everything" commit, and lab files copied in rather than merged  `engineering-mega-commit-and-branch-divergence`
- **Where:** `git:9b384c9`, `git:d0dc868`, `rl/seeker_env.py:5`, `rl/checkpoint_environment.py:1`, `TRAINING.md:250-252`, `AGENTS.md:137-138`
- **What's wrong:**
  - **One giant commit.** `9b384c9 Save Lola movement, combat, audio, and junkyard assets` changes 187 files (+80,153/−348). It lands six days after `d0dc868`. It mixes many kinds of change in one commit:
    - 75 binaries (raw WAVs, two .blend files, GLBs)
    - about 70k lines of generated OBJ
    - major code rewrites (`LolaPlayer.js` +473, `CameraController.js` +274, `PlayerWeapon.js` +218)
    - a change to the brain adapter's player-contact rule (`rl/junkyard_env.py` +36)
    - 34 new tests, RL planning PDFs, and an unreferenced 1,446-line `reverse_urgency_config/config.json`

    This breaks the repo's own rule at AGENTS.md:138 ("Make small, coherent commits…").
  - **The branch has drifted from main.** It is 25 commits ahead of main and 5 behind.
  - **Files were copied, not merged.** The brain recipe was copied from the lab branch at `7689aca` (later merged to main via PR #1) with one import line changed, instead of being merged:
    ```
    -from rl_environment import LeaperReachEnv
    +from rl.checkpoint_environment import LeaperReachEnv
    ```
    That one-line change turns `rl/seeker_env.py` into an add/add conflict. In total, `git merge-tree --write-tree main HEAD` conflicts in `.gitattributes`, `README-RL.md`, `TRAINING.md`, `rl/seeker_env.py`, `src/camera/CameraController.js`, `src/main.js` and `src/world/TargetMarker.js`.
  - The "fix/" branch name is cosmetic, but it hides that this branch *is* the game.
- **Why it matters (plain language):** When everything changes in one save, Git can no longer answer "which change broke Lola's strafe animation?" or undo one feature without losing the rest. Four movement tests broke somewhere inside that one commit, and finding where is now detective work. Every week the game branch and the lab branch drift further apart, and the eventual merge gets harder.
- **What it holds back:** Merging the game with the RL lab on main; finding the cause of the 4 failing tests; reverting one bad feature; parallel work by several agents.
- **How to fix:** This is a merge plan. Steps marked * need the owner's explicit go-ahead; AGENTS.md:142 forbids history rewrites otherwise, and the branch is already pushed.
  1. Tag the current state: `git tag lola-game-2026-10-18 9b384c9`.
  2. *Optional, and only before anything reaches main: rewrite `9b384c9` so that source art (`assets/audio/sources/*`, `assets/blockmesh/junkyard/*.blend`) moves to LFS or an art store. Once merged into main, it stays in history forever.
  3. Get the branch green first. Fix or `todo`-mark the 4 lola-player tests, fix camera-player, and add `pnpm test` and CI (findings above and below).
  4. Create `integrate/game-main` from the branch and run `git merge origin/main`. Use a merge, not a rebase, so the 7 conflicts are resolved once instead of replayed over 25 commits. Resolve them like this:
     - `.gitattributes`: take the union of both sides.
     - `rl/seeker_env.py`:
       - Keep main's version for the lab.
       - Move the game's frozen trio (`checkpoint_environment.py`, `seeker_env.py`, `seeker_recurrent_policy.py`) into `rl/frozen_7757824/` and update the imports in `rl/junkyard_env.py` and `rl/junkyard_server.py`.
       - Main's `rl_environment.py` is byte-identical to the frozen copy *today*. Keep the separate frozen copy anyway, because the lab will keep editing its file.
       - Add a test that SHA256-hashes the frozen files. This is a file move only; the brain recipe does not change.
     - `TRAINING.md` / `README-RL.md`: take main's. Move the branch's game entries to `docs/game/CHANGELOG.md` and the junkyard-brain notes (TRAINING.md:245-271) to `docs/brain/junkyard-inference.md`.
     - `CameraController.js`: keep the branch's version and re-apply main's small change by hand.
     - `TargetMarker.js`: keep main's version and re-apply the branch's 1-line change.
     - `main.js`: keep the mode routing and add main's ONNX-brain imports.
     - `package.json`: take the union (main adds `onnxruntime-web` and `test:brain`). Take main's `vite.config.js`.
     - `LeaperSimulation.js`: auto-merges but changed on both sides, so review it by hand.
  5. *Confirm:* run `pnpm check`, main's `pnpm test:brain`, and both sides' Python tests. Then open a PR to main.
  6. From then on:
     - Use short-lived `feature/<topic>` branches, one PR per feature, merged at least weekly.
     - Commit at least daily.
     - Commit asset re-exports separately from code.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Four previously green Lola movement tests were broken by the last commit and committed red  `engineering-red-suite-baseline`
- **Where:** `tests/lola-player.test.js:59`, `:98`, `:160`, `:176` (assertions at `:83`, `:113`, `:173`, `:199`), `git:9b384c9`
- **What's wrong:** In a scratch worktree at `d0dc868`, `node --test tests/*.test.js` gives `# tests 35 # pass 35 # fail 0`. That run includes tests 20, 21, 23 and 24, whose names exactly match today's failures. At `9b384c9` the result is `# tests 69 # pass 65 # fail 4`:
  - #53 "each complete movement cycle travels its measured stride…"
  - #54 "C toggles crouch… A/D select authored crossovers" (expected `StrafeRight`, got `Run`)
  - #56 "animation clock and blending agree at 30 and 60 fps"
  - #57 "WASD directions, sprint, wall sliding, and weapon switch…" (expected `Idle`, got `Run`)

  The text of #56 and #57 is unchanged between the two commits; only the code and the Lola GLBs changed. So the commit message's "four existing … assertions failing" means "already broken in the uncommitted working copy", not "never passed". It is a regression introduced by this commit.
- **Why it matters (plain language):** These tests check things players feel: which animation plays when strafing, idle after switching guns, and smooth motion at any frame rate. They may be real movement bugs. And a test suite that is "always a bit red" teaches everyone, owner and agents alike, to ignore red, so the next real breakage hides among "the usual 4".
- **What it holds back:** Merging with main from a known-good starting point; trusting CI once added; tuning Lola's movement feel.
- **How to fix:**
  1. **Narrow down the cause.** The commit is too big to search with `git bisect`, so replay its changes in parts. In a scratch worktree at `d0dc868`, copy in one group of files at a time from `9b384c9` with `git checkout 9b384c9 -- <path>`: first `src/robot/LolaPlayer.js` (plus `src/robot/footstepContacts.js`, which it imports), then `assets/characters/lola/`. Rerun `node --test tests/lola-player.test.js` after each group to see which one flips the four tests.
  2. **Fix it, or update the test.** Either fix the code, or have the owner confirm the new behaviour is intended and update the expectation with a one-line comment explaining why.
  3. **If it can't be fixed before the merge,** mark each test as known-broken: `test('…', { todo: 'Lola strafe/idle regression from 9b384c9 — issue #N' }, async () => …)`. That way `pnpm test` exits green and the debt stays visible.
  4. Add this rule to AGENTS.md's "Commit & Pull Request Guidelines": "no commit or PR with an unexplained failing test".
  5. *Confirm:* `pnpm test` reports `fail 0`.
- **Effort:** S (triage and todo-marking); fixing the root cause depends on the movement findings  ·  **Quick win:** yes

#### [MEDIUM] The camera/footstep browser page was committed already failing, with three outdated or failing checks  `engineering-browser-tests-manual-rot`
- **Where:** `tests/camera-player.js:26-27`, `:78-81`, `:83-91`, `src/camera/CameraController.js:186-193`, `src/robot/LolaPlayer.js:557-561`, `tests/camera-preview.js:1-51`, `TRAINING.md:351-353`
- **What's wrong:**
  - **The page never passed.** `tests/camera-player.js` (118 lines) was added in `9b384c9` and was never green in any commit. Headless, it stops at its 12th check:
    ```
    FAIL Error: mouse look without any button pressed
        at check (tests/camera-player.js:9:44) at tests/camera-player.js:27:3
    ```
    The cause is a rule from the same commit: the chase camera now turns only while the mouse is captured (`CameraController.js:193`: `if (!locked && !this.fallbackMouseLook && event.pointerType === 'mouse' && this.mode === 'CHASE') return;`). The node test was updated for it (`tests/camera-input.test.js:14`), but this page was not.
  - **Two more checks fail behind it.** With that first check fixed (I served a patched copy that set `controller.fallbackMouseLook = true`), the page fails at `:81` "airborne movement emits no footfalls". The new authored jump deliberately plays one push-off step (`LolaPlayer.js:557-561`), and the captured value was `["walk"]`.
  - **And one more behind that.** Bypassing that check too, it fails at `:89` "Root skids sideways during direction change". 160 of 200 sampled frames moved in a different direction from the way Lola faced. That could be a real foot-sliding bug, or an outdated expectation now that Lola strafes and backs up without turning. With those three bypassed, every other check passes: footfall cadence, wall, sprint sound, aiming legs.
  - **The rest.** `browser-combat.html` passes (155/155). `camera-preview.html` is a before/after demo with no PASS/FAIL. Nothing runs either page automatically.
- **Why it matters (plain language):** These pages are the only automatic checks that use the real 3D map, the real Lola and real browser behaviour. Because nobody runs them, this one was saved broken. Its later checks, like footstep timing and aiming while running, were never checked at all.
- **What it holds back:** Catching camera, footstep-sound and aiming regressions; CI coverage of real assets; safe changes to `CameraController.js`, which also conflicts with main.
- **How to fix:**
  1. Add `tests/run-browser.mjs` (see the CI finding).
  2. In `tests/camera-player.js`, insert `controller.enableFallbackLook();` before line 25. That matches the new "capture first" rule, and it was confirmed to make the check pass.
  3. At line 81, replace `kinds.length === 0` with `kinds.length <= 1 && kinds.every(k => k === 'walk')`, so the authored push-off step is allowed.
  4. Ask the owner whether Lola should face her travel direction during the `[0,1]`, `[-1,0]` and `[0,-1]` inputs at lines 83-91. If not, limit that loop to forward input `[1,0]`. If yes, hand it to the movement fix as a real bug.
  5. Move `camera-preview.*` to `demos/` so it is not mistaken for a test.
  6. Delete TRAINING.md:351-353 (Vite serves `/tests/*.html` directly).
  7. *Confirm:* `pnpm test:browser` prints PASS for both pages.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Python tests that need no model can't run without the private checkpoint and a 4 GB torch install  `engineering-python-tests-checkpoint-coupled`
- **Where:** `tests/test_junkyard_brain.py:9-21`, `:23-71`, `tests/test_eye_vision.py:9-14`, `:45-77`, `rl/junkyard_server.py:11-13`
- **What's wrong:** `BrainTests.setUpClass` loads the checkpoint (`cls.model, cls.digest = load_brain(ROOT / "model_7757824")`) before every test in the class. Yet three of those tests use only `self.geometry`: `test_hidden_target_does_not_leak` (:23), `test_sensor_geometry_and_signed_reverse` (:41) and `test_player_contact_blocks_leaper_and_allows_reverse` (:50). The same is true of `EyePolicyTests.test_fov_range_and_hidden_memory` (:56). The result is `ERROR: setUpClass … FileNotFoundError … Ran 0 tests`.

  Both files also `import torch` and `from rl.junkyard_server import …` at the top, and the server imports torch and sb3_contrib. So even the 3 pure-geometry SightTests need the full ML stack. On Linux, a plain `pip install -r requirements-rl.txt` installed 1.2 GB of torch plus 3.2 GB of CUDA libraries. Yet `rl.junkyard_env`, `rl.junkyard_geometry` and `rl.junkyard_sight` import fine without torch (checked: `torch loaded: False`).

  *Correction:* the `.venv/Lib/site-packages` inserts at line 7 are harmless no-ops on Mac/Linux. They are untidy (on Windows they can mix in another Python's packages), but they are not the blocker.
- **Why it matters (plain language):** These are the enemy AI's fairness checks: the Leaper never sees Lola through walls, hidden positions never leak into its memory, Lola blocks it, and it can still back away. Right now nobody without the private brain file can run them, so a change to collision or sight code could break them unnoticed.
- **What it holds back:** CI for the brain adapter; safe changes to collision, sight or contact code; the merge with main (main adds many more Python tests alongside these).
- **How to fix:**
  1. In each file, move the geometry/sight tests into a class that imports only `rl.junkyard_env`, `rl.junkyard_geometry` and `rl.junkyard_sight`.
  2. Put the model tests in a `CheckpointTests` class with `@unittest.skipUnless((ROOT / "model_7757824/policy.pth").exists(), "brain checkpoint not installed — run scripts/fetch_brain.py")`. Do the `import torch` and `from rl.junkyard_server import BrainSession, load_brain` inside its `setUpClass`.
  3. Replace the `sys.path` hacks with `sys.path.insert(0, str(ROOT))` only.
  4. Keep the SHA256 and same-actions assertions exactly as they are; they protect the frozen recipe.
  5. *Confirm:* in a venv with only numpy and gymnasium, run `python -m unittest tests.test_junkyard_brain tests.test_eye_vision`. Expect 7 tests to run and pass, and the checkpoint tests to be reported as skipped.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The glue code (JunkyardPlaytest, main.js, input) and the browser↔brain HTTP contract have no automated tests  `engineering-untested-orchestration-and-http-contract`
- **Where:** `src/simulation/JunkyardPlaytest.js:1-298`, `src/main.js:1-104`, `src/controls/InputController.js:1-121`, `src/simulation/JunkyardBrain.js:52-62`, `:84-86`, `rl/junkyard_server.py:72-84`, `:147-193`, `tests/junkyard-chase.test.js:31`, `tests/browser-combat.js:5-17`
- **What's wrong:**
  - **Untested modules.** No node test or browser page imports these: `JunkyardPlaytest.js` (which wires brain, combat, sight, HUD and START RUN/START PLAYER), `main.js`, `InputController.js`, `randomJunkyardStart.js`, `LeaperHealthBar.js`, `HangingLeg.js`, `LaserVisual.js`, `TrainingVisualizer.js`, `createWorld.js`, `TargetMarker.js` or `config/robot.js`. `browser-combat.js` builds its own hand-made stand-in for the playtest object rather than the real `JunkyardPlaytest`.
  - **The brain connection is faked on both sides.** The JS tests replace the network call (`driver.request = async (path, data) => {...}`), and the Python tests call `BrainSession` directly.
  - **So the real HTTP handler is never exercised:** its Origin check, the `0 < size < 4096` limit, the `/reset` width range `1.2 <= width <= 8`, and token lookup. Nothing checks that its reply keys (`snapshot()` plus `token`/`policy_sha256`) match what `JunkyardBrain.js:84-86` reads.
- **Why it matters (plain language):** The parts most likely to break during the merge with main, the page start-up code and the brain connection, have no safety net. A renamed field would only show up as "BRAIN OFFLINE" in a playtest.
- **What it holds back:** Merging `main.js` and the brain integration; swapping the Python server for main's in-browser ONNX brain; adding modes or levels to `JunkyardPlaytest`.
- **How to fix:**
  1. In `rl/junkyard_server.py`, split `main()` into `make_server(model, digest, port)`, which returns the `HTTPServer`, and the argparse/`load_brain` part.
  2. Add a Python test that runs `make_server` on port 0 in a thread with a stub model. The stub needs `num_timesteps = 7757824`, `observation_space.shape = (34,)` and a `predict()` that returns `np.zeros(2), state`. Then check:
     - POST `/reset` with `Origin: http://127.0.0.1:5173` returns the expected key set.
     - `/step` with the returned token works.
     - A bad origin gets 403, an oversized body gets 400, and an unknown token gets "Session expired".
  3. Save one real `/reset` and `/step` reply as `tests/fixtures/brain-frames.json`. Make `tests/junkyard-chase.test.js` return that fixture from its fake `request` instead of the hand-built `frame` object. Then the JS and Python sides share one source of truth.
  4. Add a small node smoke test for `JunkyardPlaytest`'s start/startPlayer/stop/reset states, using the same `globalThis.document` stubs as `camera-input.test.js`.
  5. *Confirm:* renaming `contact_version` in the server makes both tests fail.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] The brain server accepts only four hard-coded page ports, and the failure message blames the wrong thing  `engineering-brain-origin-allowlist`
- **Where:** `rl/junkyard_server.py:98`, `:126-134`, `:147-148`, `src/simulation/JunkyardBrain.js:52-62`, `:103-111`
- **What's wrong:** The server only accepts requests from pages on four ports: `origins = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (4173, 4175, 5173, 5175)}`. Any other origin gets `403 Local junkyard viewer required`. The last commit already had to add 4175 and 5175 (`(4173, 5173)` → `(4173, 4175, 5173, 5175)`), so this has bitten before.

  The branch has no `vite.config.js`. So when port 5173 is busy (another project, or a second worktree), `pnpm dev` silently moves to 5174, which is exactly the port missing from the list.

  Worse, `reply()` adds `Access-Control-Allow-Origin` only for allowed origins. So the browser cannot read the 403 at all, and `fetch` just throws. The player sees `Brain unavailable: Failed to fetch. Start the local brain service, then press Reset.` (`JunkyardBrain.js:111`), even though the service *is* running.
- **Why it matters (plain language):** A playtester with any other web project open gets "BRAIN OFFLINE" and is told to start a service that is already running. Nothing points to the real cause. This is exactly the kind of raw error AGENTS.md says the owner should never have to interpret.
- **What it holds back:** Reliable local playtests; several worktrees or agents running at once; a future configurable or remote brain URL.
- **How to fix:**
  1. In `junkyard_server.py`, replace the set with a loopback check, and use it in both `do_POST` and `reply()` so that error replies also carry the header:
     ```python
     LOOPBACK = re.compile(r"http://(127\.0\.0\.1|localhost):\d{2,5}")
     def allowed(origin): return origin is None or LOOPBACK.fullmatch(origin) is not None
     ```
     It still only accepts pages on this computer.
  2. Add `server: { port: 5173, strictPort: true }` and `preview: { port: 4173, strictPort: true }` to `vite.config.js` (merge them into main's file, which already exists). Then Vite fails loudly instead of moving ports.
  3. Optionally, read the URL from `import.meta.env.VITE_BRAIN_URL ?? 'http://127.0.0.1:8767'` in `JunkyardBrain.request`.
  4. In `fail()`, change "Failed to fetch" into "Can't reach the brain at 127.0.0.1:8767. Is it running, and was the page opened on port 5173?"
  5. *Confirm:* run `pnpm exec vite --port 5174` with the brain running. The badge should reach `BRAIN 7,757,824`.

  None of this touches the policy or the observations.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] README and the ledger describe controls and weapons that no longer match the game  `engineering-docs-drift`
- **Where:** `README.md:39-40`, `:46-52`, `:84-102`, `TRAINING.md:418`, `:513-514`, `:530`, `src/robot/LolaPlayer.js:161-172`, `src/simulation/PlayerWeapon.js:17-20`, `:86`, `src/camera/CameraController.js:19`, `tests/browser-combat.js:257-258`
- **What's wrong:**
  - **Wrong key, and "no shooting".** README.md:87-88 says "**F** (or the weapon button) switches between M416 and Basic Gun… Weapons are visual only; shooting is not implemented." In fact the keys are `{ Digit1: 1, Numpad1: 1, Digit2: 0, Numpad2: 0 }` (LolaPlayer.js:163), there is no KeyF or KeyQ handler anywhere in `src`, and shooting, magazines and `KeyR` reload all exist.
  - **The ledger's last word is out of date.** TRAINING.md:418 and :513-514 say "Q switches weapons" and "removed M416 hold-to-fire". Those entries were true on 2026-10-12, but there is no later entry. `PLAYER_WEAPON.m416` is now `automatic: true, magazine: 20`, and the browser test asserts "M416 keeps firing while mouse remains down". TRAINING.md:530 says "1.25× zoom"; the code has `AIM_ZOOM = 1.35`.
  - **Features never documented.** README never mentions START PLAYER, reload, magazines, leg breaking, the eye weak point or first-person aim.
  - **Stale sections.** README.md:39-40 still calls `assets/` and `rl/` "future", and :46-52 "Recommended next steps" is obsolete.
  - **Which docs were skipped.** `9b384c9` added asset notes (FOOTSTEPS.md, SOUND-SLOTS.md, blockmesh READMEs) but changed none of README, README-RL, TRAINING or AGENTS. Only the in-game help text (`JunkyardBrain.js:93`) is current.
- **Why it matters (plain language):** A playtester following the README would press F (nothing happens) and be told the guns don't shoot. Anyone reading the ledger to discuss balance would think the M416 fires one shot per click.
- **What it holds back:** Designer tuning (which numbers are current?); playtest instructions; agent handoffs; the merge (TRAINING.md conflicts anyway).
- **How to fix:**
  1. Add `docs/game/CONTROLS-AND-RULES.md` describing the current state:
     - keys: WASD/IJKL, Shift, Space, C, 1/2, R, left/right mouse, Esc, VIEW
     - a weapon table taken from `PLAYER_WEAPON` (`src/simulation/PlayerWeapon.js:17-20`)
     - Leaper health and attack timing from `src/config/combat.js`
     - leg-break thresholds
     - START RUN vs START PLAYER

     Link it from the top of README.md.
  2. Replace README.md:84-102 with a pointer to that file, and delete :46-52.
  3. Add a TRAINING.md (later `docs/game/CHANGELOG.md`) entry for `9b384c9`'s player-visible changes.
  4. Add to AGENTS.md's commit rules: "a change to controls or tuning updates CONTROLS-AND-RULES.md".
  5. *Confirm:* every key in that file has a matching handler (`grep -n "event.code" src`).
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] AGENTS.md, the briefing every coding agent reads first, describes the PPO_8-era prototype and never mentions the game  `engineering-agents-md-stale`
- **Where:** `AGENTS.md:26`, `:64-85`, `:99-122`, `:128-130`
- **What's wrong:** AGENTS.md is out of date in several ways:
  - Line 26 says "There is currently no asset directory or automated test suite."
  - Line 76 gives the old reward formula, and line 80 says "The next recommended controlled experiment is `PPO_10`".
  - `grep -ciE 'lola|junkyard|8767|model_7757824' AGENTS.md` returns 0, and the branch never edited the file.
  - main's AGENTS.md is 595 lines of lab content and also mentions Lola and the junkyard 0 times. After the merge, the file agents read will still say nothing about the game.
- **Why it matters (plain language):** This project is built mostly by AI agents, and this file is their briefing. Today a fresh agent is told there are no tests, and nothing warns it that the saved brain depends on a frozen 34-input recipe. That is how an agent could "helpfully" change the sensing code and silently break the enemy.
- **What it holds back:** Every future agent session on the game; safe parallel agent work; the merge.
- **How to fix:** Right after the merge, add a short "Game (Lola / junkyard)" section at the top of AGENTS.md with:
  1. A repo map: game vs lab vs frozen brain.
  2. Non-negotiables: "Never edit `rl/frozen_7757824/*` or change `JunkyardEnv` observation/action/step semantics. The policy SHA256 `883dade3…` and the 34-input shape must stay. Run the checkpoint tests if the brain is installed."
  3. How to run and check: `pnpm play`, `pnpm check`.
  4. Where the game docs live (`docs/game/`).

  Keep the existing "Working With the Project Owner" section, which is good. Move the PPO history into the lab's own docs (main's `RL_SPEC.md`/`TRAINING.md`) and link to it.

  *Confirm:* a new agent session asked "what must I not change?" quotes the non-negotiables.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Four different "how to run" instructions; the one-click launcher is Windows-only and hides brain failures  `engineering-run-path-windows-only`
- **Where:** `Start-Leaper.ps1:3-11`, `:16-21`, `:26`, `:35-36`, `README.md:5-19`, `:62-72`, `:123-126`, `:160-162`, `README-RL.md:54-55`, `AGENTS.md:99-109`, `scripts/export_lola.py:12`, `scripts/export_lola_clips.py:3-4`, `assets/blockmesh/junkyard/*.py` (`C:/Windows/Fonts/arial.ttf`)
- **What's wrong:**
  - **Four overlapping run instructions:**
    1. README.md:5-19: `pnpm dev`, which opens the old sandbox, not the game.
    2. README.md:62-72: the brain plus `?map=junkyard`.
    3. README-RL.md:54-55: the same, with a different host name.
    4. AGENTS.md:99-109: the sandbox only.

    The one-click launcher, `Start-Leaper.ps1`, works only on Windows.
  - **The launcher has its own problems:**
    - It needs `.venv\Scripts\python.exe` (:3).
    - It falls back to an AI agent's private Node runtime, `.cache\codex-runtimes\…\node.exe` (:7).
    - It builds without ever running `pnpm install` (:10).
    - It carries a migration for an old `tmp/camera-check-build` preview (:26).
    - It starts the brain hidden and prints the game URL immediately, even if the brain then crashes on a missing checkpoint (the error lands only in `tmp/brain-error.log`).
  - **Asset re-export only works on the owner's PC.** It uses hard-coded `C:/Blender/...` source paths and `C:/Windows/Fonts`.
  - *Correction:* the two-terminal path in README.md:62-72 (`python scripts/run_junkyard_brain.py` + `pnpm dev`) does work on Mac/Linux once the checkpoint exists. The `.venv/Lib/site-packages` lookup in `run_junkyard_brain.py` is only used if that folder exists, so it is harmless elsewhere.
- **Why it matters (plain language):** A new teammate or cloud agent has to guess which of four instructions applies. The obvious one (`pnpm dev`) lands on an old test scene. The one-click launcher works only on the owner's kind of machine and can show a "ready" link while the enemy brain has actually failed.
- **What it holds back:** Onboarding collaborators; running in CI or cloud agents; a reproducible demo; a web-release checklist.
- **How to fix:**
  1. Put one "Play the game" section at the top of README.md:
     1. `corepack enable && pnpm install`
     2. `python -m venv .venv` and `pip install -r requirements-brain.txt`
     3. `python scripts/fetch_brain.py`
     4. `pnpm play`
  2. Write `scripts/play.mjs`, exposed as `"play"` in package.json:
     - Start `python -m rl.junkyard_server`, preferring `.venv/bin/python` or `.venv\Scripts\python.exe`.
     - Poll `GET http://127.0.0.1:8767/` until `model_step === 7757824`.
     - If the brain process exits, print its stderr and stop.
     - Otherwise start `vite --strictPort` and print `http://127.0.0.1:5173/?map=junkyard`.
  3. Shrink `Start-Leaper.ps1` to `pnpm install --frozen-lockfile; pnpm play`, and drop the codex-runtimes fallback and the camera-check-build migration.
  4. Make Blender and font paths arguments or env vars (`BLENDER`, `LOLA_SOURCE_BLEND`, `FONT`), with the `C:/` values only as documented examples.
  5. *Confirm:* on a clean Linux or Mac clone, the four README steps open the junkyard with a live brain.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] The game, the RL replay viewer and the old sandbox share one entry page, one ledger file and one root folder  `engineering-repo-layout-two-products`
- **Where:** `src/main.js:5-25`, `:63-82`, `rl_environment.py:1`, `train_rl.py:1`, `rl/checkpoint_environment.py:1`, `TRAINING.md:1-36`
- **What's wrong:**
  - **One entry page boots three apps.** `src/main.js:19-20` picks the app from the URL: `const trainingMode = …has('training'); const junkyardMode = !trainingMode && …get('map') === 'junkyard';`. It statically imports all three worlds (`createWorld`, `createTrainingWorld`, `TrainingVisualizer`, `JunkyardPlaytest`).
  - **One file is both lab ledger and game changelog.** `TRAINING.md` is titled "Leaper RL Training Ledger", yet its first entry and many later ones (HUD, siren audio, recoil, guns) are game features.
  - **Old lab files at the root.** The root `rl_environment.py` (229 lines) and `train_rl.py` (492 lines) on the branch are stale lab files. The real recipe lives in `rl/checkpoint_environment.py`, which is identical to main's current 1,044-line `rl_environment.py`.
  - **Shared files cause most of the merge conflicts.** Of the 7 conflicts, `main.js`, `TRAINING.md`, `README-RL.md`, `CameraController.js`, `TargetMarker.js` and `rl/seeker_env.py` all come from both sides editing shared files.
  - *Corrections:* `pnpm-workspace.yaml` containing only `allowBuilds` is normal for pnpm 10+ and is not evidence of a problem. The viewer and sandbox code (about 700 lines) is a small part of the 695 KB bundle, which is mostly three.js. The cost is merge friction and `pnpm dev` landing on the sandbox, not download size.
- **Why it matters (plain language):** Lab work (new training runs) and game work (new guns, new levels) keep editing the same files. So every sync between them becomes a hand-resolved conflict session. A web release would also carry the training viewer and the old test scene.
- **What it holds back:** Merging with main repeatedly instead of once; a game-only web release; letting the lab change its environment without risking the game's frozen brain.
- **How to fix:**
  1. **Step 1, right after the merge (about a day):**
     - Use a Vite multi-page build. In `vite.config.js`, set `build.rollupOptions.input = { game: 'index.html', lab: 'lab.html', sandbox: 'sandbox.html' }`.
     - Make `index.html` boot the junkyard game by default, and give the replay viewer and sandbox their own small entry files (`src/lab/main.js`, `src/sandbox/main.js`).
     - Split `src/` into `src/game` (Lola, combat, JunkyardPlaytest, HUD), `src/lab` (TrainingVisualizer, createTrainingWorld) and `src/shared` (createHexapod, LeaperSimulation, collision, config).
     - Delete the stale root `rl_environment.py` and `train_rl.py` once main's versions arrive.
     - Split the ledger: `TRAINING.md` for RL runs only, `docs/game/CHANGELOG.md` for game features.
  2. **Step 2, when a second level or enemy arrives:** move to a pnpm monorepo (`packages: ['apps/*', 'packages/*']`) with:
     - `apps/game` and `apps/lab-viewer`
     - `packages/sim-core` (rig, gait, collision) and `packages/brain-web` (main's ONNX runner and parity fixtures)
     - `python/lab` and `python/brain_server` (rl/junkyard_* plus `rl/frozen_7757824`, with exact pins)

     The frozen recipe files only move, with a hash test.
  3. *Confirm:* `pnpm build` emits three HTML pages; `/` opens the junkyard.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] Raw source audio, Blender files and repeated asset exports are committed straight to Git, with no rule for what belongs where  `engineering-binary-churn-no-lfs`
- **Where:** `.gitattributes:1`, `assets/audio/sources/`, `assets/audio/sources.json:2-44`, `assets/blockmesh/junkyard/junkyard_arranged.blend`, `assets/blockmesh/junkyard/junkyarf_before_arrangement.blend`, `assets/maps/junkyard/`, `assets/characters/lola/`, `reverse_urgency_config/config.json:1`
- **What's wrong:**
  - **Biggest files added on the branch:**
    - `assets/audio/sources/479353__astounded__laser-effect-contact-mic.wav`, 21.9 MB. The game uses 0.8 s of it (`sources.json`: `startSeconds 0.25, durationSeconds 0.8`).
    - `assets/maps/junkyard/collision.json`, 5.9 MB, two versions.
    - `assets/audio/sources/407349__forthehorde68__fx_metallic_hit.wav`, 5.0 MB, marked "disabled at user request; preserved source only".
    - Two `.blend` files, 4.6 and 3.6 MB; one is misspelled `junkyarf_…`.
    - `junkyard.glb`, 3.1 MB, two versions.
    - `lola-basic.glb` and `lola-m416.glb`, 5 versions each.
  - **Overall size.** The tracked tree is 60.8 MB across 235 files, and the pack is about 37 MiB. `.gitattributes` has only `*.pdf binary`.
  - **An unexplained file.** `reverse_urgency_config/config.json` (1,446 lines; the training config of run 6, "06_reverse_urgency") is referenced by no code or doc.
  - *Calibration:* this size is not yet painful. It matters now because once this history reaches main it can never shrink, and every re-export of Lola or the map adds several MB permanently.
- **Why it matters (plain language):** Everyone, including every automated test run and agent session, downloads every version of every file, forever. Raw sound masters and Blender work files are source art, not game files. Without a rule, they pile up next to the code.
- **What it holds back:** Fast CI and cloud agents; frequent character and map re-exports; the merge into main (after which history can't be cleaned); a clean asset pipeline.
- **How to fix:**
  1. Decide the rule: **runtime assets the game and tests load stay in normal Git** (GLBs, the WAVs in `assets/audio/` used by the game, `collision.json`). **Source art goes to Git LFS or a shared art drive:** `.blend` files and everything in `assets/audio/sources/`.
     - This keeps CI LFS-free. Tests load the GLBs and collision JSON, and GitHub meters LFS bandwidth.
     - With LFS: `git lfs install`, then add `*.blend filter=lfs diff=lfs merge=lfs -text` and `assets/audio/sources/** filter=lfs diff=lfs merge=lfs -text` to `.gitattributes`.
  2. Keep `sources.json` as the record of where each excerpt came from.
  3. Rename `junkyarf_before_arrangement.blend` (and update `arrange_live_scene.py:9`).
  4. Move `reverse_urgency_config/config.json` next to the checkpoint (inside `brain-7757824.zip` or `docs/brain/`) with a one-line README saying what it is.
  5. *With the owner's explicit OK, and only before merging into main:* `git lfs migrate import --include="*.blend,assets/audio/sources/**" 8be4bc6..HEAD` on the branch. This rewrites the branch and needs a force-push.
  6. *Confirm:* `git lfs ls-files` lists only source art, and `pnpm test` still passes on a fresh clone without `git lfs pull`.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Python requirements are loose ranges with no torch, no Python version and no lock, while the frozen checkpoint depends on exact library versions  `engineering-python-deps-unpinned`
- **Where:** `requirements-rl.txt:1-4`, `scripts/run_junkyard_brain.py:1`, `README.md:62-64`, `rl/junkyard_server.py:23-41`
- **What's wrong:**
  - **Ranges, not pins.** `requirements-rl.txt` is `gymnasium>=1.0,<2`, `stable-baselines3[extra]>=2.4,<3`, `sb3-contrib>=2.9,<3` and `matplotlib>=3.8,<4`. torch and numpy arrive unpinned. There is no lock file or pyproject.
  - **Unenforced Python version.** README.md:62 and `run_junkyard_brain.py:1` ask for "a Python 3.12 runtime", but nothing enforces it.
  - **Today's install is unknown territory.** A fresh install here today resolved to Python 3.13, stable_baselines3 2.9.0, sb3_contrib 2.9.0, torch 2.14.1 (with 3.2 GB of CUDA libraries the CPU-only brain server never uses) and numpy 2.5.4. Nothing records whether those match what the checkpoint was saved with.
  - **The checkpoint's own version note is ignored.** The checkpoint folder carries `_stable_baselines3_version`, which `load_brain` reads but never checks.
  - **One file, two jobs.** The same file serves the training lab and the one-model inference server.
- **Why it matters (plain language):** Months from now, a fresh install may pull newer libraries that load the saved brain slightly differently or not at all. The enemy then stops working without anyone changing the game, and nobody knows which versions used to work.
- **What it holds back:** Reproducible playtests; CI for brain tests; long-term preservation of the shipped brain; splitting the lab from the game.
- **How to fix:**
  1. From the owner's working `.venv`, run `.venv\Scripts\python -m pip freeze`. Create `requirements-brain.txt` with exact pins for torch, numpy, gymnasium, stable-baselines3, sb3-contrib and cloudpickle. Add `--extra-index-url https://download.pytorch.org/whl/cpu` and a `+cpu` torch pin so Linux and Mac installs skip the CUDA download.
  2. In `run_junkyard_brain.py`, warn if `sys.version_info[:2] != (3, 12)`.
  3. In `load_brain`, print the checkpoint's `_stable_baselines3_version` next to `stable_baselines3.__version__`.
  4. Keep `requirements-rl.txt` (ranges) for the lab only.
  5. *Confirm:* a brand-new venv built from `requirements-brain.txt` passes `python tests/test_junkyard_brain.py` with the checkpoint installed.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Third-party sound licences are not recorded, and the repo has no LICENSE or credits file  `engineering-asset-licenses-undocumented`
- **Where:** `assets/audio/sources.json:1-44`, `assets/audio/FOOTSTEPS.md:3-7`, `public/audio/SOUND-SLOTS.md:9-10`
- **What's wrong:** Each `sources.json` entry has only `source`, `startSeconds`, `durationSeconds` and `use`; for example, `"source": "766092__luca2399__m4_rifle_fire.wav"`. FOOTSTEPS.md credits qubodup, artemditkovsky and artninja by Freesound ID, and SOUND-SLOTS.md lists "Freesound 423117 by ogsoundfx" and "154934 by klawykogut". `git grep -iE "licen[cs]e|CC0|CC-BY|attribution"` finds nothing outside two .blend binaries, and there is no LICENSE or CREDITS file. The good news: IDs and authors are recorded, so filling in licences is a lookup job.
- **Why it matters (plain language):** Freesound clips come under different licences. Some are free for anything (CC0), some require a credit (CC-BY), and some forbid commercial use (CC-BY-NC). Without writing down which applies, a public release could break a licence or need sounds swapped at the last minute.
- **What it holds back:** A web release; any commercial use; adding more community assets safely.
- **How to fix:**
  1. Look up each Freesound ID once. Add `license`, `url` and `author` fields to every entry in `assets/audio/sources.json`, and add the same fields as a column in `SOUND-SLOTS.md` and `FOOTSTEPS.md`.
  2. Generate `CREDITS.md` (and later an in-game Credits panel) from that JSON.
  3. Add a repo `LICENSE` for the code.
  4. Flag any CC-BY-NC sound for replacement before a commercial release.
  5. Record the same for Lola and the map art.
  6. *Confirm:* a small node test asserts every `sources.json` entry has a non-empty `license`.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The source Blender files for Lola and the shipped junkyard map exist only on the owner's PC  `engineering-source-art-off-repo`
- **Where:** `scripts/export_lola.py:3`, `:12`, `scripts/export_lola_clips.py:3-4`, `README.md:123-126`, `:160-162`, `assets/maps/junkyard/collision.json:1`, `assets/blockmesh/junkyard/layout_report.json:2-3`
- **What's wrong:** Every Lola GLB in the repo is exported from files that are not in the repo:
  ```
  scripts/export_lola.py:12   WALK_SOURCE = Path('C:/Blender/LOWPOLY/Lola_walk_final.blend')
  scripts/export_lola_clips.py:3  Blender -b "C:/Blender/LOWPOLY/Lola final.blend" ...
  README.md:125               C:/Blender/LOWPOLY/Lola_both_animations.blend1.blend
  ```
  The shipped map's collision file says `"source":"Junkyard_Blockmesh.blend"`, which README.md:161 places at `C:/Blender/Junkyard_Blockmesh.blend`. `git ls-files '*.blend'` lists only `junkyard_arranged.blend` and `junkyarf_before_arrangement.blend`: blockmesh work files, not the exported map. `layout_report.json` also records `E:\Leaper\...` paths. So the repo holds some Blender files that the game doesn't use, and none of the ones it does.
- **Why it matters (plain language):** New or fixed animations (a proper back-pedal, a crouched strafe, a fix for the failing strafe/idle tests) and map edits can only be made on the owner's computer. If that disk is lost, Lola and the junkyard can only be patched, never re-exported. It is the same single-point-of-failure as the brain checkpoint.
- **What it holds back:** Other artists or agents improving Lola's animations or the map; backup of the source art; a repeatable asset pipeline.
- **How to fix:**
  1. Create one source-art home: an LFS-tracked `art/` folder, or a shared drive mirrored by a manifest. Copy in `Lola_both_animations.blend1.blend`, `Lola_walk_final.blend`, `Lola final.blend` and `Junkyard_Blockmesh.blend`.
  2. Add `art/MANIFEST.md` listing each source file, which exports it feeds (`assets/characters/lola/*.glb`, `assets/maps/junkyard/*`), and the exact export command.
  3. Change `export_lola.py`, `export_lola_clips.py` and the README commands to read source paths from env vars or arguments, defaulting to `art/...`.
  4. *Confirm:* on a second machine, re-export `lola-basic.glb`, and check that `node --test tests/lola-player.test.js` gives the same result as with the committed GLB.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] three.js is pinned at r128 (2021) without types; no upgrade plan or bundle split  `engineering-three-r128-pin`
- **Where:** `package.json:15-20`, `AGENTS.md:67`, `src/core/createScene.js:9`
- **What's wrong:**
  - **The pin itself.** `"three": "0.128.0"` was pinned "to preserve the prototype's rendering behavior during the first refactor" (AGENTS.md:67), and that refactor finished long ago.
  - **No types.** r128 ships no `.d.ts` files, so editors and `tsc --checkJs` see three.js as untyped.
  - **Old colour API.** The renderer uses the old `renderer.outputEncoding = THREE.sRGBEncoding` (createScene.js:9), which newer versions renamed.
  - **No `vite.config.js`**, so the build is one 695 KB chunk with a size warning.
  - *Corrections:* r128 already includes `KTX2Loader`, `DRACOLoader` and the meshopt decoder, so compressed assets are not blocked. main pins the same version. This is a project-wide choice, not a branch defect.
- **Why it matters (plain language):** Each month on an old three.js makes the eventual upgrade bigger. Newer versions change lighting and colour handling, so art tuned now may look different afterwards. Most online examples and fixes now assume newer versions.
- **What it holds back:** Newer rendering features and editor type hints; eventually, web-performance work.
- **How to fix:**
  1. Don't upgrade mid-merge.
  2. After the merge, add `@types/three@0.128.0` as a devDependency for editor hints.
  3. Plan a staged upgrade (r128 → r152 → current) on its own branch. Before starting, add a Playwright screenshot comparison of 3-4 fixed junkyard camera shots (reuse browser-combat's `?playerPreview`/`?legPreview` modes) so the owner can approve any change in the look.
  4. Then update `outputEncoding` → `outputColorSpace` and re-tune the light intensities in `src/core/createScene.js`.
  5. A `manualChunks: { three: ['three'] }` split only silences the warning; it does not reduce download size.

  This is rendering only and has no effect on the brain recipe.
- **Effort:** L  ·  **Quick win:** no

#### [LOW] The code is lint-clean today, but nothing keeps it that way  `engineering-lint-unenforced`
- **Where:** `src/camera/LeaperPov.js:1`, `src/simulation/TrainingVisualizer.js:190`, `tests/leaper-leg-damage.test.js:164`
- **What's wrong:** ESLint core rules (`no-unused-vars`, `no-unreachable`, `no-dupe-keys`, `no-self-assign`, `no-useless-assignment` and more) over `src`, `tests` and `scripts` report exactly three problems:
  ```
  src/camera/LeaperPov.js 1:13 'THREE' is defined but never used
  src/simulation/TrainingVisualizer.js 190:14 'error' is defined but never used
  tests/leaper-leg-damage.test.js 164:11 'box' is assigned a value but never used
  ```
  `prettier --list-different --single-quote --print-width 120` would reformat 50 of 52 JS files, and 31 lines in `src` exceed 140 characters.
- **Why it matters (plain language):** This is a strength worth protecting. With no automatic check, the next agent can add mistakes like undefined variables or dead code without anything catching them.
- **What it holds back:** Keeping quality high as more agents contribute.
- **How to fix:**
  1. Add `eslint.config.js` with `@eslint/js` recommended plus `globals.browser`/`globals.node` (devDependencies `eslint`, `@eslint/js`, `globals`), and a `lint` script run in CI.
  2. Fix the 3 unused variables (in TrainingVisualizer use `catch {`).
  3. Do NOT run Prettier across the codebase before the main merge. Rewriting 50 files would turn 7 conflicts into dozens. Format once, in a dedicated commit right after the merge, then add `prettier --check` to CI.
  4. *Confirm:* `pnpm lint` exits 0.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] `output/` holds three contradictory versions of an RL plan, and the arena-concept notes reference images that aren't in the repo  `engineering-stale-output-and-concept-docs`
- **Where:** `output/markdown/Leaper_Next_Training_Runs_Revised_LR_2026-09-12.md:15`, `output/pdf/Leaper_Next_Training_Runs_2026-09-12.pdf`, `output/pdf/Leaper_Next_Training_Runs_Constant_LR_2026-09-12.pdf`, `output/pdf/Leaper_Next_Training_Runs_Revised_LR_2026-09-12.pdf`, `.gitignore:44-46`, `docs/arena-concepts/*.md`
- **What's wrong:**
  - **Three PDFs and a markdown file disagree.**
    - The plain PDF and `_Constant_LR` PDF say "Constant 0.00015 throughout… Runs 1-8: 2,031,616 transitions each".
    - The `_Revised_LR` PDF says "Linear 0.00015 to 0.00003 over 2,031,616 transitions".
    - The same-named markdown says "Runs 1-8 will each train for 10,002,432 total transitions… This Markdown supersedes the earlier PDF budget" (line 15).
  - **They were committed on purpose.** `.gitignore:44-46` makes exceptions so `output/markdown/` and `output/pdf/` get committed.
  - **Missing images.** `docs/arena-concepts` refers to six concept PNGs (`junkyard-concept.png`, `junkyard-concept-v2.png`, `train-yard-concept.png`, `train-yard-concept-v2.png`, `junkyard-v2-no-blue-lines.png`, `train-yard-v2-no-blue-lines.png`), none of which is committed.
- **Why it matters (plain language):** Someone opening the "Revised_LR" PDF gets a different training budget from the "Revised_LR" markdown. These are lab plans sitting on the game branch. And the level-design notes describe concept boards nobody else can see.
- **What it holds back:** Clear decision records for the lab; reusing the arena concept work for new levels.
- **How to fix:**
  1. Move the latest markdown plan to main's docs (e.g. `docs/rl/plans/`), and delete the three PDFs or rename them with a `SUPERSEDED_` prefix.
  2. Remove the `!/output/...` lines from `.gitignore` so `output/` is scratch space again.
  3. Commit the six concept PNGs into `docs/arena-concepts/` (or the art store), or replace the filename mentions with links to wherever they live.
  4. *Confirm:* `git ls-files output` is empty, and every image named in `docs/arena-concepts/*.md` resolves.
- **Effort:** S  ·  **Quick win:** yes

**Checked and rejected**

None. Every finding held up, but several had sub-claims corrected above:
- The 4 failing tests *were* green at `d0dc868`, so this is a regression.
- The camera page has three failing checks, not one.
- The `.venv/Lib` path hacks are harmless on Mac/Linux.
- The README's two-terminal run path is cross-platform once the brain exists.
- `pnpm-workspace.yaml` with only `allowBuilds` is normal.
- three r128 already ships KTX2 and meshopt loaders.
- The recipe files were copied from the lab branch at `7689aca`, not from main.
- A 403 from the brain server is unreadable by the browser, so "show the 403 text" alone would not work.
- LFS should cover source art only, not test-loaded runtime assets.

### Game architecture vs classical game-development practice (cross-cutting)

**How it works today**

The game is a Vite 7 + plain JavaScript + Three.js r128 (2021) project of about 5,970 lines in 39 files under `src/`. One `index.html` carries the on-screen markup for three different apps, and `src/main.js` (104 lines) is both the place where everything is wired together and the game loop. The address decides the app: `?training=1` opens the RL replay viewer, `?map=junkyard` opens the actual game, and the plain address opens the old hexapod sandbox with the pink box. One `requestAnimationFrame` loop (main.js:86-102) uses the real time between frames (capped at 0.1 s in the junkyard). It calls `playtest.update(dt)`, then a chain of before/after-render hooks that hide Lola or the robot, swap in faded materials and add camera kick for one frame.

In the junkyard each frame runs `JunkyardBrain.update`, which (despite its name) also reads the keyboard and moves Lola (120 Hz sub-steps, both outfits animated). At most 10 times a second it posts the next step to the local Python brain at `http://127.0.0.1:8767`, and it eases the drawn Leaper toward the latest reply through `LeaperSimulation.updateExternal`. That function also moves the camera and the sun and writes the status text. Next come `LeaperCombat.update` (leg debris, the Leaper's sight rays, the attack behaviour tree, laser bolts, Lola's damage and the HUD), then `PlayerWeapon.update` (ammo, reload, hit-scan bullets) and then the Leaper POV view.

Control is split. Python (`rl/junkyard_server.py` with junkyard_env/geometry/sight) owns the Leaper's movement, its collision raster and its eye-sight, for the frozen 7,757,824-step recurrent policy. The browser owns Lola, combat, the Leaper's attack visibility, the camera and the UI. The two sides share only two versioned JSON files (`player-contact.json`, `eye-vision.json`). Inside the browser, systems reach each other through one shared `JunkyardPlaytest` object, callback slots, flags written onto other modules' objects, and one monkey-patch (`world.playerBlocked`). Tuning numbers are frozen JS constants spread over about 12 files. Assets (one map GLB, a 5.9 MB collision JSON, 14 Lola GLBs, WAV audio) are loaded ad hoc, and there is no loading manager.

**What's good**

- Clear folder layout (camera/config/controls/core/robot/simulation/world/styles). Most modules are small and focused, and their comments are written in plain language a designer can follow.
- `AttackController` (src/simulation/AttackController.js:1-48) is a textbook small priority behaviour tree: pure, timer-based, gets its context passed in, movement deliberately excluded, and unit-tested. It is the pattern to copy for other AI and game states.
- The boundary to the brain is narrow and defensive: inference-only server, checkpoint identity checked by step count and policy SHA256 (rl/junkyard_server.py:39, src/simulation/JunkyardBrain.js:84), a generation counter that throws away stale replies, a retry budget, and no silent fallback controller.
- Rules shared by browser and Python are partly data-driven and versioned (`src/config/player-contact.json`, `eye-vision.json`, version checks at JunkyardBrain.js:85-86). This is the "one explicit interface" that AGENTS.md:37 asks for.
- Lola's travel speed comes from her animations (measured stride profiles plus runtime foot-contact and landing measurement in `src/robot/footstepContacts.js`). This is effectively root-motion extraction done offline, and it stops her feet sliding.
- Third-person camera craft: a nine-probe occlusion boom that never interpolates through cover, aim in/out that keeps the crosshair on the same spot (`aimEyeAt`/`aimChaseAt`), and a fallback for browsers without pointer lock.
- Swept projectile tests (cover wins ties) and an exact capsule ray test (`CombatGeometry.capsuleHit`) avoid bullets tunnelling at low frame rates.
- Asset URLs use `new URL(..., import.meta.url)`, so built files are content-hashed for caching. Transient effects and debris dispose their materials.
- Real test investment: 69 node tests (several load the real exported GLB skeletons) plus browser harness pages (`tests/browser-combat.html`, `camera-player.html`) kept out of the production entry point.
- Hidden tabs and window blur pause the brain, combat and audio consistently (`document.hidden` checks, the LaserAudio epoch counter).

**How professional game projects handle this**

Commercial projects (Unity, Godot, Unreal and serious web games alike) settle the same handful of questions in roughly the same way:

- **Timing:** gameplay runs at a fixed tick (Unity `FixedUpdate`, Godot `_physics_process`, the "Fix Your Timestep" accumulator). Rendering blends between the last two ticks, and presentation (camera, lighting focus, HUD, audio listener) runs after simulation every frame, whatever state the game is in.
- **Entities:** enemies and the player are actors or prefabs built from components (transform, health, brain, weapon, hitboxes), or entities in an ECS, and systems loop over every actor that has the components they need.
- **State and animation:** game flow is a small state machine (Loading, Playing, Paused, Victory, Defeat). Characters animate through layered animation graphs with bone masks (Unity Animator layers, Godot AnimationTree, Unreal AnimBP slots). AI uses state machines or behaviour trees.
- **Communication:** systems ask each other questions through explicit services (collision, player handle) and announce events on signals or an event bus, so audio, HUD and camera shake subscribe without gameplay code knowing about them.
- **Data and tools:** designers tune values in data files with a live debug panel (Tweakpane, dat.gui, Dear ImGui) and place spawns and cover as markers in the level editor. Assets go through a build step (meshopt/Draco, KTX2/WebP textures, Opus/AAC audio) and a loading manager with progress.
- **Collision:** one physics or collision world with BVH-accelerated raycasts (three-mesh-bvh on the web) and a kinematic character controller.
- **Input:** an action map with keyboard, gamepad and touch bindings.
- **Audio:** an audio manager with buses and positional emitters.
- **UI:** a UI layer that observes game state and never lives inside combat code.
- **Workflow:** debug tools are compiled out of release builds, CI runs on every change, branches are short-lived, and large art sources go through Git LFS.

Main's own `src/brain/BrainDriver.js` already uses a fixed `STEP_DT = 1/30` accumulator, and main's `src/brain/LeaperBrain.js` already runs a (simpler, feed-forward) brain in the browser with onnxruntime-web and Python-generated parity fixtures. So the in-house precedent for the two biggest fixes already exists.

**Findings**

#### [CRITICAL] The Leaper's brain only runs on the owner's PC: a local Python/PyTorch server with an uncommitted checkpoint  `game-architecture-python-brain-blocks-web-release`
- **Where:** src/simulation/JunkyardBrain.js:55, src/simulation/JunkyardBrain.js:84, src/simulation/LeaperCombat.js:200, rl/junkyard_server.py:12-13, rl/junkyard_server.py:39, rl/junkyard_server.py:89, rl/junkyard_server.py:98, rl/junkyard_server.py:148-149, .gitignore (`/model_7757824/`), Start-Leaper.ps1:3, README.md:59-60
- **What's wrong:** The only movement brain is a PyTorch `RecurrentPPO` server on the visitor's own machine, and the address is compiled into the game:
  ```js
  // JunkyardBrain.js:55
  const response = await fetch(`http://127.0.0.1:8767/${path}`, { ... });
  ```
  The server needs `torch` + `sb3_contrib` (junkyard_server.py:12-13) and the folder `model_7757824/` (:89), which `.gitignore` excludes, so nobody who clones the repo can start it. The server also refuses any page that is not served from 127.0.0.1/localhost on ports 4173/4175/5173/5175 (:98, :148-149 return 403). The one-click launcher is Windows-only (`.venv\Scripts\python.exe`, Start-Leaper.ps1:3). Without the brain, the Leaper never moves, and it never attacks either, because combat counts as paused while the brain is not ready (`const paused = !p.walking || !p.brain.ready || document.hidden;`, LeaperCombat.js:200). The built bundle contains the hard-coded address (`grep -o "http://127.0.0.1:8767" dist/assets/*.js` matches). Correction to the original report: browsers treat `http://127.0.0.1` as a trusted origin, so "mixed content" is not the real obstacle for a hosted page. The real obstacles are the server's origin allow-list, Chrome's private-network rules, and the visitor simply not having the server and model.
- **Why it matters (plain language):** Only your own Windows PC with the private model folder can play the real fight. A playtester, a colleague or a website visitor gets "BRAIN OFFLINE" and a robot that stands still and never shoots. The game cannot be put on itch.io or any website.
- **What it holds back:** Web release, playtests by anyone else, mobile, automated tests of the full game loop, and merging with main's in-browser brain work.
- **How to fix:**
  1. *Interim (days, M):* make the brain reachable by other developers. Publish `model_7757824` as a GitHub release asset (or Git LFS) with its SHA256. Read the brain URL from `import.meta.env.VITE_BRAIN_URL` (default `http://127.0.0.1:8767`) in `JunkyardBrain.request`. Add a `--allow-origin` option to `rl/junkyard_server.py` instead of the fixed `origins` set. Document the cross-platform start command (`python -m rl.junkyard_server`, which already works on any OS) next to `Start-Leaper.ps1`.
  2. *Real fix (XL):* add `src/brain/BrainBackend.js` with `reset(pose, target, sightPose)`, `step(target, sightPose)` and `sense(...)`, all returning the same frame object as `BrainSession.snapshot()`. Keep today's HTTP code as `HttpBrainBackend` (the reference during development).
  3. Then build `OnnxBrainBackend` in four parts:
     - (a) Export the `ResidualLstmPolicy` actor to ONNX with explicit LSTM state inputs and outputs (`obs[34], h, c, episode_start -> action_mean, h', c'`) and the deterministic mean action, extending main's `export_to_onnx.py`.
     - (b) Port the observation and step code (SeekerEnv/checkpoint_environment, `JunkyardEnv`, `JunkyardGeometry` raster, `JunkyardSight`) to `src/brain/junkyardEnv.js`.
     - (c) Generate golden fixtures from Python the way main's `make_brain_fixtures.py` does: 500+ step sequences of pose/target/sight pose -> 34 observation floats, action, next pose.
     - (d) Add `tests/brain-parity.test.js` asserting agreement within about 1e-5.
  4. Matching the fixtures this way proves the frozen recipe is unchanged. Self-host the onnxruntime-web WASM files (main currently loads them from jsDelivr).
  5. To confirm: `node --test tests/brain-parity.test.js` passes, and the built `dist/` plays a full chase with the Python server stopped.
- **Effort:** XL (interim step M)  ·  **Quick win:** no

#### [HIGH] When the fight ends the camera freezes (inside Lola's head if you were aiming), and Lola loses her shadow away from the Leaper  `game-architecture-presentation-driven-by-leaper-sim`
- **Where:** src/simulation/LeaperSimulation.js:87-89, src/simulation/LeaperSimulation.js:112-114, src/simulation/JunkyardBrain.js:139, src/simulation/JunkyardBrain.js:168, src/camera/CameraController.js:254-255, src/core/createScene.js:31-34, src/simulation/LeaperCombat.js:119-126, src/simulation/PlayerWeapon.js:94
- **What's wrong:** The camera and sun are only updated from inside the Leaper's simulation:
  ```js
  // LeaperSimulation.updateExternal, lines 112-114
  this.cameraController.update(state, this.rig.eyePivot, deltaTime);
  this.sun.position.set(state.position.x + 8, 15, state.position.z + 6);
  this.sun.target.position.set(state.position.x, 0, state.position.z);
  ```
  In the junkyard that function is reached only through `if (this.frame && !encounterOver)` (JunkyardBrain.js:168, `encounterOver = this.playtest.combat?.dead`). When the encounter ends, `finish()` calls `playtest.stop()`, which calls `playerWeapon.reset()` → `setAiming(false)`. That skips the aim-exit camera solve because `available` is already false (PlayerWeapon.js:94), and after that nothing ever moves the camera again. Shake fading also lives in `CameraController.update` (line 255), so the kill-shot shake never plays. Reproduced in headless Chromium on port 5311 (`?map=junkyard&debug`, brain offline, START PLAYER, aim, `combat.damageLeaper(600)`):
  ```
  aiming          {"aiming":true,"dead":false,"fov":42.95,"cameraToLolaEye":0}
  +1.5s after kill {"aiming":false,"dead":true,"fov":42.37,"cameraToLolaEye":0,"lolaVisible":true,"shake":0.7}
  +4.5s after kill {"aiming":false,"dead":true,"fov":42.37,"cameraToLolaEye":0,"lolaVisible":true,"shake":0.7}
  ```
  The screenshot shows the scene through the inside of Lola's head. The sun's shadow box is a fixed ±13 units (createScene.js:31-34) centred on the Leaper, not scaled with the map (×1.45 at the default size). Measured in the browser: Lola 14 units straight ahead of the Leaper was inside the shadow box, but 17 units diagonally or 20 units to the side was outside it (`insideShadowBox:false`).
- **Why it matters (plain language):** Landing the killing shot or dying while holding right-click (which happens all the time) leaves the screen stuck in the zoomed view, after a win literally from inside Lola's head, until you press Restart. The big kill-shot camera shake never happens. As soon as Lola is a little way from the Leaper, she and the scenery around her stop casting shadows.
- **What it holds back:** Any victory or death presentation (death cam, slow-motion kill), menus or cutscenes where the Leaper is not simulated, a second enemy (its simulation would also drive the camera and sun), and good lighting on larger maps.
- **How to fix:**
  1. Delete the camera and sun lines from `LeaperSimulation.update` (87-89) and `updateExternal` (112-114).
  2. Make the camera a per-frame presentation step owned by whoever owns the frame. In `JunkyardPlaytest.update` call `this.cameraController.update(this.simulation.state, this.simulation.rig.eyePivot, dt)` right after `this.brain.update(dt)`, outside any `encounterOver` gate, so the weapon still fires along this frame's view. In `main.js animate()` call it for the sandbox and training modes.
  3. Add `followSun(sun, x, z, scale)` to `src/core/createScene.js` and call it with the camera's focus point (`cameraController.target` in chase, `topCenter` in TOP). In `JunkyardPlaytest`'s constructor, next to the fog scaling, scale the shadow box with the map: `sun.shadow.camera.left = -13 * world.scale` (and right/top/bottom/far), then `updateProjectionMatrix()`.
  4. Leave the `encounterOver` gate in JunkyardBrain for the Leaper's pose only.
  5. To confirm: in `tests/camera-player.js` (the real-asset browser harness), aim, call `combat.damageLeaper(600)`, render 60 frames, and check that the camera is more than 1 unit from `player.eyePosition()`, the FOV is back near 55 and `shakeStrength` is 0. Also place Lola 25 units from the Leaper and check that she is inside the shadow camera's box.
- **Effort:** S  ·  **Quick win:** yes

#### [HIGH] No CI or test script, a tip commit that broke 4 tests, a long-lived branch that conflicts with main in 7 files, stale handoff docs, binaries outside LFS  `game-architecture-team-workflow`
- **Where:** package.json:10-14, tests/lola-player.test.js:83, tests/lola-player.test.js:113, tests/lola-player.test.js:173, tests/lola-player.test.js:199, AGENTS.md:26, AGENTS.md:80, README.md:87-88, Start-Leaper.ps1:7, .gitattributes:1
- **What's wrong:**
  - **No automation:** `package.json` has only `dev/build/preview` scripts, and there is no `.github/` folder (no CI).
  - **Tests broken by the last commit:** `node --test tests/*.test.js` gives 65 pass / 4 fail, all in `lola-player.test.js`. These 4 tests passed at the parent commit: a temporary worktree at `d0dc868` gives `# tests 11 # pass 11 # fail 0` for that file. They broke in the tip commit `9b384c9 "Save Lola movement, combat, audio, and junkyard assets"`, a single commit touching **187 files with 80,153 insertions**. It added input easing (`LOLA_INPUT_RESPONSE`) and foot-lift floor offsets without updating the tests, and it deleted `tests/stride-motion.test.js`.
  - **Conflicts with main:** a trial merge into main conflicts in 7 files (.gitattributes, README-RL.md, TRAINING.md, rl/seeker_env.py, src/camera/CameraController.js, src/main.js, src/world/TargetMarker.js).
  - **Stale docs:** AGENTS.md:26 says "There is currently no asset directory or automated test suite", AGENTS.md:80 names PPO_10 as the next experiment, and README.md:87-88 documents an **F** key and says "shooting is not implemented". The launcher falls back to a hard-coded tool path (Start-Leaper.ps1:7).
  - **Large binaries in Git:** about 43 MB of WAV and `.blend` files are committed (the largest is a 21 MB raw source WAV in `assets/audio/sources/`), while `.gitattributes` contains only `*.pdf binary`.
- **Why it matters (plain language):** Nothing warns anyone when a change breaks Lola, and the last save did exactly that without anyone noticing. The branch that holds the actual game cannot be merged into main without manual surgery, and new helpers (human or AI) are briefed with outdated facts.
- **What it holds back:** Merging with main, a playable preview per change, onboarding a second programmer, reliable releases.
- **How to fix:**
  1. Add `"test": "node --test tests/*.test.js"` and `"lint": "eslint src"` to `package.json`.
  2. Add `.github/workflows/ci.yml` on pull requests: pnpm/action-setup, Node 22, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`.
  3. Repair the 4 Lola tests before new features:
     - Either let the tests settle the eased input (several frames, or inject a large response) or make easing per fixed sub-step (see the timestep finding).
     - Update the floor-offset assertion at line 83 to include `footLift` and `floorHeight`.
     - Restore or replace the deleted stride-motion test.
  4. Land this branch into main as a series of smaller PRs (assets → Lola/player → combat → brain client), resolving `src/main.js` through the scene split below.
  5. Refresh the AGENTS.md handoff (lines 26 and 64-85) and the README controls (lines 84-99).
  6. Track `*.wav *.blend *.glb` with Git LFS, or move the raw source WAVs and `.blend` files out of the repo.
  7. Once the brain runs in the browser, deploy a preview per PR (GitHub Pages or Netlify).
  8. To confirm: the CI badge is green and `pnpm test` reports 0 failures.
- **Effort:** M  ·  **Quick win:** no (steps 1-2 alone are a quick win)

#### [HIGH] No actor layer: one hard-wired Leaper assembled from bespoke classes that all reach into a shared "playtest" object  `game-architecture-no-actor-model-single-leaper`
- **Where:** src/main.js:45, src/simulation/JunkyardPlaytest.js:14, src/simulation/JunkyardPlaytest.js:60-70, src/simulation/LeaperCombat.js:27, src/simulation/LeaperCombat.js:39-74, src/simulation/PlayerWeapon.js:166-169, src/simulation/PlayerWeapon.js:178, src/simulation/LeaperLegDamage.js:122, src/camera/LeaperPov.js:19
- **What's wrong:** `JunkyardPlaytest` copies everything onto itself (`Object.assign(this, { engine, world, simulation, target, cameraController })`, :14) and hands `this` to every subsystem (`new EyeVision(this)`, `new JunkyardBrain(this)`, `new LeaperCombat(this)`, `new LeaperPov(this)`, `new PlayerWeapon(this)`, :60-70). Each subsystem then reaches through it (`this.p.combat.audio.playSlot('gunEmpty')`, PlayerWeapon.js:178). There is exactly one enemy by construction: `enemyMeshes() { const rig = this.p.simulation.rig; return [rig.robot, ...` (PlayerWeapon.js:166-169). The class named "LeaperCombat" also creates Lola's health HUD, the Leaper HUD, the audio engine, the SOUND button and the debug button (LeaperCombat.js:39-74). Other modules write flags onto the rig (`rig.weaponControlled = true`, LeaperCombat.js:27; `this.rig.mobility = ...`, LeaperLegDamage.js:122).
- **Why it matters (plain language):** Today a second Leaper, or any new kind of enemy, means copying four large classes and editing five more. Copying the combat class would even create a second Lola health bar, a second sound button and a second audio engine.
- **What it holds back:** More enemies, new enemy types (drones, turrets), waves, levels with different enemy line-ups, reusing main's `BrainDriver`.
- **How to fix:** Introduce a small actor layer step by step rather than a full ECS.
  1. Make `PlayerWeapon` take a list of hit targets (`world.enemies`, each with `hitMeshes()` and `damage(amount, part)`) instead of `this.p.simulation.rig`.
  2. Pass `LeaperCombat` an `enemy` object instead of the whole playtest.
  3. Move Lola's health and HUD out of `LeaperCombat` into a `PlayerHealth` component plus the UI layer (see the UI finding), and move the audio engine out (see the audio finding).
  4. Add `src/core/World.js` (about 100 lines) holding `actors` and `systems`, with `query('Health', 'Hitboxes')`. Put the win/lose rules in an `Encounter` object.
  5. To confirm: spawning a second `Leaper` actor in a test page (the brain server already supports up to 8 sessions) needs no edits to `PlayerWeapon`, the HUD or audio, and `tests/combat.test.js` still passes.
- **Effort:** L  ·  **Quick win:** no

#### [MEDIUM] No fixed simulation tick: the Leaper's speed depends on frame rate and network latency  `game-architecture-no-fixed-timestep`
- **Where:** src/main.js:88, src/simulation/JunkyardBrain.js:13, src/simulation/JunkyardBrain.js:138-142, src/robot/LolaPlayer.js:513, src/robot/LolaPlayer.js:522, src/simulation/LeaperLegDamage.js:128-130, src/simulation/HangingLeg.js:65
- **What's wrong:** The loop uses the variable frame time (`Math.min(junkyardMode ? 0.1 : 0.033, ...)`, main.js:88), and each system adds its own private sub-steps (Lola `Math.ceil(deltaTime * 120)`, debris 1/60 capped at 0.15 s, hanging legs 120 Hz). The brain timer throws away leftover time and waits for each reply:
  ```js
  // JunkyardBrain.js:138-142
  this.clock += dt * (sim.rig?.mobility ?? 1);
  if (this.ready && (this.running || preview) && !this.busy && this.clock >= (preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND) ...) {
    this.clock = 0;
  ```
  A replica of this scheduling (scratch `brainrate.mjs`) gives **8.55 / 9.18 / 9.60 steps per second at 30 / 60 / 144 fps** (with 10% frame jitter; 10.0 / 8.57 / 9.60 without jitter), and about **6.0-6.5 per second at 150 ms reply time**. Each step moves the Leaper a fixed distance, so its speed varies by roughly 10-15% between common frame rates and drops by about a third on a slow reply. The laser timers, meanwhile, run on real seconds. Lola's input easing is applied once per rendered frame before her sub-steps (`ease = 1 - Math.exp(-LOLA_INPUT_RESPONSE * deltaTime)`, LolaPlayer.js:513), which is why the test "animation clock and blending agree at 30 and 60 rendered frames per second" fails. Her drift is tiny (z = 4.9550 vs 4.9477 after 2 s). Calibrated down from high: the measured gameplay effect is modest, and with an HTTP brain an exactly repeatable replay is not achievable anyway. README.md:108 ("1/30 simulated second" per step) describes the training physics and is not contradicted by the 10 steps/s playback.
- **Why it matters (plain language):** The Leaper runs about 10% slower on a 30 fps laptop than on a fast monitor, and about a third slower when the brain answers slowly, while its laser keeps firing at the same pace. Difficulty quietly changes from machine to machine.
- **What it holds back:** Consistent difficulty tuning, frame-rate-independent tests, automated playtests, later online/co-op play.
- **How to fix:**
  1. *Quick part (S):* in `JunkyardBrain.update` keep the leftover time instead of zeroing it:
     ```js
     const interval = preview ? 0.1 : 1 / LEAPER_STEPS_PER_SECOND;
     if (this.busy) this.clock = Math.min(this.clock, interval); // don't bank time while waiting
     if (... && this.clock >= interval) { this.clock -= interval; ... }
     ```
     Add a node test with a fake `fetch` that steps 10 simulated seconds at 30/60/144 fps and expects 100 ± 2 steps.
  2. In `LolaPlayer.move`, replace `Math.ceil(deltaTime * 120)` with a fixed-step accumulator (`this.stepClock += deltaTime; while (this.stepClock >= STEP - 1e-9) { ease inputs by STEP; this.moveStep(..., STEP); this.stepClock -= STEP; }` with `STEP = 1/120`). That should make the failing 30/60 fps test pass.
  3. *Full version (M):* add `src/core/GameLoop.js` with `fixedUpdate(1/60)` for input, Lola, combat timers, projectiles, debris and the AttackController (at most about 5 catch-up ticks). Schedule a brain step every 6 ticks, and `render(alpha)` interpolates the Leaper between `previousFrame` and `frame`.
  4. Keep 10 brain steps per second: switching to 30/s "to match training" would triple the Leaper's speed, which is a design decision for the owner, not a refactor. Each policy step is unchanged, so the brain recipe is unaffected.
- **Effort:** M (quick part S)  ·  **Quick win:** no (step 1 is)

#### [MEDIUM] Brain-offline instructions and other status messages are written into the collapsed OPTIONS panel  `game-architecture-status-messages-hidden-in-options`
- **Where:** src/simulation/JunkyardPlaytest.js:29, src/simulation/JunkyardPlaytest.js:46, src/simulation/JunkyardPlaytest.js:58, src/simulation/JunkyardBrain.js:109-111, src/simulation/JunkyardPlaytest.js:72-73, src/simulation/LeaperCombat.js:123
- **What's wrong:** The only message line, `<p data-message>` (JunkyardPlaytest.js:46), sits inside `<div id="junkyardOptions" hidden>` (:29), which starts collapsed (README.md:99: "Options start hidden"). Every explanation is written there:
  - the brain failure ("`Brain unavailable: … Start the local brain service, then press Reset. No pathfinder fallback.`", JunkyardBrain.js:111)
  - the pause notices (:72-73)
  - "Encounter ended…" (via `playtest.stop`, LeaperCombat.js:123)

  The only visible text is the short label `'BRAIN OFFLINE — START RUN TO RETRY'` (JunkyardBrain.js:109). Pressing Start Run just retries and fails again. Verified in the headless-browser screenshot above: only "BRAIN OFFLINE — START RUN TO RETRY" and "SIGHT CONNECTING…" are visible.
- **Why it matters (plain language):** Since nobody but you has the brain, this is the first screen every other person sees, and it tells them to press a button that cannot help. The sentence that explains what is actually wrong is hidden behind OPTIONS.
- **What it holds back:** Playtests by other people, a clean player-facing HUD, troubleshooting without a programmer.
- **How to fix:**
  1. In the `JunkyardPlaytest` constructor, move `<p data-message>` out of `#junkyardOptions` so it sits under `.brain-state` in the always-visible part of the panel. Keep it to one or two lines with CSS `max-height` and an ellipsis.
  2. In `JunkyardBrain.fail`, change the visible label to something actionable, e.g. `BRAIN OFFLINE — start the brain service (README), then press RESET`.
  3. To confirm: load `?map=junkyard` with no brain running. Without opening OPTIONS, the explanation is readable.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] Systems talk through a monkey-patch, duck typing and ad-hoc callback slots; Lola's movement lives inside the brain client  `game-architecture-implicit-coupling-monkeypatch`
- **Where:** src/simulation/JunkyardBrain.js:31-48, src/simulation/JunkyardBrain.js:128-136, src/robot/LolaPlayer.js:397-398, src/main.js:46, src/simulation/JunkyardPlaytest.js:63-71, src/camera/LeaperPov.js:19, src/simulation/PlayerWeapon.js:109
- **What's wrong:** The brain client replaces the world's collision function (`const mapBlocked = playtest.world.playerBlocked; playtest.world.playerBlocked = (x, z) => { if (mapBlocked(x, z)) return true; ...`, JunkyardBrain.js:32-33). Lola's jump and movement are driven from inside `JunkyardBrain.update` (`this.target.jump()` :128, `this.target.move(...)` :135). `LolaPlayer` pretends to be the old pink box (`toggle() { /* … */ }` and `setSelected() { this.selected = true; }`, :397-398), wired through `new InputController(() => target.toggle())` (main.js:46). Other links are callback slots and flags: `target.onFootstep`, `simulation.onFootstep`, `cameraController.onPauseRequested` (JunkyardPlaytest.js:63-71), and `cameraController.spectator = this` (LeaperPov.js:19). PlayerWeapon forces a camera update itself (:109). The camera freeze above is a direct result of this kind of hidden dependency.
- **Why it matters (plain language):** The wiring is invisible. Someone fixing Lola's movement would never think to look in the "brain" file, and a change in one place silently breaks another.
- **What it holds back:** A second enemy (each brain client would wrap Lola's collision function again), swapping the brain backend, reusing Lola in a level without a brain, testing systems on their own.
- **How to fix:**
  1. Move the input and Lola lines (JunkyardBrain.js:128-136) into a new `src/simulation/PlayerController.js` called from `JunkyardPlaytest.update` before `brain.update`.
  2. Replace the monkey-patch with a collision service in `createJunkyardWorld`: `world.collision = { blockers: new Map(), addDynamicBlocker(id, fn), playerBlocked(x, z) }`. JunkyardBrain registers its Leaper clearance function and LolaPlayer calls `world.collision.playerBlocked`.
  3. Add a roughly 30-line `src/core/events.js` (`on/off/emit`) for `footstep`, `lolaDamaged`, `leaperDamaged`, `jointBroken`, `encounterEnded`, `pauseRequested`, and let audio, HUD and camera shake subscribe.
  4. Give the player an explicit interface (`position`, `eyePosition()`, `hitBones`, `isPlayer`) and delete the TargetMarker stubs.
  5. To confirm: `tests/junkyard-chase.test.js` and `tests/player-contact.test.js` still pass, and `grep -n "playerBlocked =" src` finds no reassignment.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Three apps share one entry point via URL flags; no scene/level abstraction; the plain address opens the obsolete sandbox  `game-architecture-modes-instead-of-scenes`
- **Where:** src/main.js:19-25, src/main.js:88, index.html:12-19, index.html:27-79, src/simulation/JunkyardPlaytest.js:17, src/simulation/JunkyardPlaytest.js:81-89, src/world/createJunkyardWorld.js:71-77, src/simulation/LeaperSimulation.js:53, src/simulation/LeaperSimulation.js:93
- **What's wrong:**
  ```js
  // main.js:19-25
  const trainingMode = new URLSearchParams(window.location.search).has('training');
  const junkyardMode = !trainingMode && new URLSearchParams(window.location.search).get('map') === 'junkyard';
  world = trainingMode ? createTrainingWorld(engine.scene)
    : junkyardMode ? await createJunkyardWorld(engine.scene) : createWorld(engine.scene);
  ```
  `index.html` ships the sandbox HUD ("P SELECT PINK CUBOID · I J K L MOVE IT") and the whole PPO replay panel to every page (`PPO TRAINING REPLAY` is in `dist/index.html`). The game rewrites sandbox DOM (`document.querySelector('.sub').textContent = …`, JunkyardPlaytest.js:17), APPLY SIZE reloads the page (`location.assign(url)`, :88), and the junkyard loader recolours every light in the shared scene (createJunkyardWorld.js:73-77). `LeaperSimulation` is both the keyboard-driven sandbox hexapod (`update`) and the brain puppet (`updateExternal`).
- **Why it matters (plain language):** Opening the game's plain address shows a pink-box playground instead of the game. Each new level would add another address flag and more "if junkyard" checks in the main loop.
- **What it holds back:** More levels, title/menu screens, restarting or resizing without a page reload, splitting the training viewer off, and merging with main (`src/main.js` is one of the 7 conflicts).
- **How to fix:**
  1. *Quick slice:* default to the game (`const map = params.get('map') ?? 'junkyard'`) and keep `?map=sandbox` for the old sandbox.
  2. Create `src/scenes/` with a `Scene` interface (`load()`, `enter()`, `update(dt)`, `exit()`), plus `JunkyardScene`, `SandboxScene`, `TrainingReplayScene` and a small `SceneManager` in `main.js` that owns the loop.
  3. Move the training viewer to its own Vite page (`training.html`, listed in `build.rollupOptions.input` in a new `vite.config.js`) with its own markup, so the game's `index.html` only holds game HUD.
  4. Put level lighting and fog in level data (e.g. `assets/maps/junkyard/level.json`). Apply size by `exit()` + `enter()` instead of reloading.
  5. To confirm: `/` opens the junkyard, `dist/index.html` no longer contains "PPO TRAINING REPLAY", and APPLY SIZE keeps the page (no reload in the network panel).
- **Effort:** M  ·  **Quick win:** no (the default-address slice is)

#### [MEDIUM] Input is raw key codes spread over five modules with their own listeners: no action map, rebinding, gamepad or touch aim/fire  `game-architecture-input-not-action-mapped`
- **Where:** src/controls/InputController.js:8-15, src/robot/LolaPlayer.js:161-173, src/camera/CameraController.js:51, src/simulation/PlayerWeapon.js:75-87, src/simulation/LaserAudio.js:73, src/simulation/JunkyardPlaytest.js:75, src/styles/junkyard.css:68, src/camera/CameraController.js:19, README.md:87
- **What's wrong:** Five separate `window.addEventListener('keydown', …)` registrations, with bindings hard-coded where they are used:
  - `{ Digit1: 1, Numpad1: 1, Digit2: 0, Numpad2: 0 }` and `'KeyC'` in LolaPlayer.js:163-166
  - `event.button === 2` aims and `=== 0` fires in PlayerWeapon.js:76-77
  - `'KeyR'` reloads, and `'KeyP'` calls the no-op `target.toggle()`

  `grep getGamepads src` finds nothing. Touch has only joystick, sprint and jump: there is no aim, and a tap can at most fire through emulated mouse events. The controls legend is written into `.keys` (JunkyardPlaytest.js:75), but `.junkyard-mode .hud { display: none; }` (junkyard.css:68) hides it, and it says "AIM ×1.25" while `AIM_ZOOM = 1.35`. README.md:87 documents an **F** key that has no handler.
- **Why it matters (plain language):** Players cannot use a controller or remap keys, touch players cannot aim, and the on-screen and README control lists are invisible or wrong.
- **What it holds back:** Gamepad support, rebinding and accessibility, mobile play, a settings menu, scripted input playback for automated tests.
- **How to fix:**
  1. Create `src/input/actions.js` mapping actions to bindings, e.g. `{ move: { keys: ['KeyW','KeyA','KeyS','KeyD'], stick: 'left' }, fire: { mouse: 0, pad: 7 }, aim: { mouse: 2, pad: 6 }, jump, crouch, reload, weapon1, weapon2, sprint, pause }`.
  2. Make `InputController` the only owner of DOM listeners. It polls `navigator.getGamepads()` once per frame and exposes `pressed(action)`, `held(action)` and `axis('move')`. Change LolaPlayer, PlayerWeapon and CameraController to read actions.
  3. Generate the legend (in a visible element) and the README table from the map. Save rebinds to `localStorage`. Add touch Aim/Fire buttons next to `#btnJump`.
  4. To confirm: a node test drives `InputController` with fake events and a fake gamepad and gets the same actions, and `grep -c "addEventListener('keydown'" src` returns 1.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Game flow and Lola's animation are driven by scattered flags and manual weight juggling; winning freezes Lola as if she lost  `game-architecture-ad-hoc-state-flags`
- **Where:** src/robot/LolaPlayer.js:510, src/robot/LolaPlayer.js:528-703, src/robot/LolaPlayer.js:660-698, src/robot/LolaPlayer.js:676, src/simulation/JunkyardPlaytest.js:154-201, src/simulation/JunkyardBrain.js:23-26, src/simulation/LeaperCombat.js:77, src/simulation/LeaperCombat.js:119-122
- **What's wrong:** `LolaPlayer.moveStep` (lines 528-703) handles `grounded`, `jumpState`, `reloadState`, `shot`, `crouching`, `hitRecoilTime` and `defeated` in one function. It saves, zeroes and restores all locomotion weights around shots and jumps (`const weights = …; … forEach((action, i) => action.setEffectiveWeight(weights[i]))`, :660-698) and forces the reload layer with `setEffectiveWeight(reloadWeight >= 0.999 ? 1000 * locomotion : …)` (:676). Game flow is booleans across classes: `walking`/`playerMode` (JunkyardPlaytest), `running`/`ready`/`busy`/`pendingMovement` (JunkyardBrain), `gameplayStarted` (CameraController) and `get dead()` (LeaperCombat.js:77). There is no victory or defeat state: `finish()` sets `this.playtest.target.defeated = true` for **both** outcomes (LeaperCombat.js:122), and `move()` returns early when `defeated` (LolaPlayer.js:510), so after a win Lola is frozen exactly as after a loss. Correction to the original report: the 4 failing Lola tests are not caused by the flag juggling itself. They come from input easing and foot-lift changes in the tip commit (see the workflow finding). Positive contrast: `AttackController.js` is a clean behaviour tree.
- **Why it matters (plain language):** Every new move (dodge, melee, death fall, stagger, interact) has to be threaded through one long function and a pile of flags. There is no proper "you won" or "you died" flow: whether you win or lose, Lola simply locks up.
- **What it holds back:** New player moves, death and victory sequences, pause/menu/game-over screens, designer-tunable blend and transition times.
- **How to fix:**
  1. Add `src/core/GameFlow.js`, a small state machine: `Loading → Ready → Playing(Hunt|Explore) → Paused → Ended(Victory|Defeat)`. Each state's `enter/exit` owns mouse capture, brain start/stop, the result panel and what Lola may do. In `Ended(Victory)` Lola keeps moving; in `Ended(Defeat)` she plays a death clip when one exists.
  2. *Quick slice:* in `LeaperCombat.finish` only set `defeated = true` when `this.lolaHealth <= 0`.
  3. Give Lola animation layers:
     - a base locomotion layer (Idle/Run/Strafe/Crouch)
     - an upper-body overlay for Shoot/Reload (the masked `shootingUpper`/`ReloadUpper` clips already exist)
     - a full-body override for Jump
     - an additive hit-recoil layer
  4. Use a small `AnimationLayerStack` that sets per-layer weights each tick, replacing the save/zero/restore code. Keep the stride-profile travel logic. Put transitions in a table `{ from, to, blendSeconds }` so blend times become tunables.
  5. To confirm: `node --test tests/lola-player.test.js` passes, and after a debug kill Lola can still walk.
- **Effort:** L  ·  **Quick win:** no (the `finish` slice is)

#### [MEDIUM] Designer tunables are spread over about a dozen files as frozen code constants, with no live tuning panel  `game-architecture-tuning-scattered-no-live-ui`
- **Where:** src/config/combat.js:2, src/config/encounter.js:2, src/config/robot.js:18, src/simulation/PlayerWeapon.js:14-26, src/simulation/LeaperLegDamage.js:12, src/robot/LolaPlayer.js:9-53, src/camera/CameraController.js:8-19, src/simulation/JunkyardBrain.js:8-15, src/simulation/LaserAudio.js:12-22, src/simulation/LeaperHealthBar.js:11-14
- **What's wrong:** Gameplay numbers are `Object.freeze` or `const` values in `config/combat.js`, `config/encounter.js`, `config/robot.js`, PlayerWeapon (`PLAYER_WEAPON`, `BIG_HIT`), LeaperLegDamage (`LEG_HITS`), LolaPlayer (`LOLA_INPUT_RESPONSE`, `LOLA_PACE`, jump timings), CameraController (`CHASE_PITCH_*`, `SHAKE`, `AIM_ZOOM`), JunkyardBrain (`LEAPER_FOLLOW_RESPONSE`, `LEAPER_STEPS_PER_SECOND`), LaserAudio (`LEVELS`, `OPTIONAL`) and LeaperHealthBar (`CHASE_FOV`, `HIT`). There are already duplicates and drift: `const CHASE_FOV = 55;` (LeaperHealthBar.js:11) repeats the camera's 55, and the help text says ×1.25 while `AIM_ZOOM = 1.35`. The only `import.meta.env` use is LaserAudio's `BASE_URL`, so there is no dev panel, although three r128 already ships `examples/jsm/libs/dat.gui.module.js` and `stats.module.js`. Vite already reloads the page when a constant is saved; what's missing is changing values live mid-fight.
- **Why it matters (plain language):** To try a different laser damage, fire rate, Lola speed, camera distance or leg toughness, you have to find the right file, edit code and restart the fight. You cannot nudge a value while playing and feel the difference.
- **What it holds back:** Self-service balancing, difficulty presets, A/B playtests, a clean designer/programmer split.
- **How to fix:**
  1. *Quick slice (S):* add `src/debug/TuningPanel.js`, loaded with dynamic `import()` only when `import.meta.env.DEV || params.has('tune')`. It uses `three/examples/jsm/libs/dat.gui.module.js` bound to the ten most-tuned values, with "Copy JSON" and "Reset" buttons. For that, export mutable copies of those objects in dev, e.g. `export const COMBAT = import.meta.env.DEV ? { ...values } : Object.freeze({ ...values })`.
  2. Then move gameplay tunables to `src/config/tuning/{combat,player,camera,audio}.json`. Keep the brain-frozen values (`player-contact.json`, `eye-vision.json`, `LEAPER_STEPS_PER_SECOND`) in a separate, clearly read-only file.
  3. To confirm: change laser damage in the panel mid-fight and see the next bolt use it.
- **Effort:** S (panel) / M (full move)  ·  **Quick win:** yes

#### [MEDIUM] No asset pipeline: uncompressed GLB/WAV, duplicated character textures, a 5.9 MB collision JSON parsed on the main thread, no loading progress  `game-architecture-asset-pipeline`
- **Where:** src/robot/LolaPlayer.js:67-73, src/world/createJunkyardWorld.js:22-29, src/main.js:30, src/simulation/LaserAudio.js:1-11, src/simulation/LaserAudio.js:49-51, assets/maps/junkyard/collision.json, assets/characters/lola/lola-m416.glb, assets/audio/lola-walk.wav
- **What's wrong:**
  - **Download size:** `du -sh dist` is 20 MB.
  - **Main-thread startup work:** `collision.json` is 5.87 MB. Re-measured in Node: `JSON.parse` 92 ms, Leaper nav grid 265 ms, Lola nav grid 100 ms, all synchronous before the first frame (createJunkyardWorld.js:27-29).
  - **Lola duplicated per gun:** `LolaPlayer.create` awaits 14 GLBs (2 outfits plus jump/reload/4 running jumps per gun), each with its own skinned mesh. The two 1.2 MB outfit GLBs carry 9 textures each, and a hash check shows **all 9 are byte-identical between the two files (596 KB duplicated)**.
  - **No compression:** the map uses `KHR_materials_specular` (not supported by the r128 loader) and no Draco/meshopt/KTX2/WebP, although r128 supports `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu` and `EXT_texture_webp`. Audio is WAV only (`lola-walk.wav` 4.5 MB).
  - **No progress feedback:** loading shows only status text (`'LOADING LOLA…'`, main.js:30), and there is no LoadingManager.
  - **Wasted requests:** unfilled optional sound slots are requested and come back 404 (LaserAudio.js:49-51).
- **Why it matters (plain language):** First load on an ordinary connection takes many seconds with no progress bar. Phones may run out of memory, and every added character, weapon or level makes it worse.
- **What it holds back:** Web release, mobile, more levels/characters/weapons, fast art iteration.
- **How to fix:**
  1. Add `src/core/Assets.js` (a `THREE.LoadingManager` driving a progress bar, a URL cache, and a per-scene manifest).
  2. Add a `pnpm assets` script using `@gltf-transform/cli` (`gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp`) and register `MeshoptDecoder` from `three/examples/jsm/libs/meshopt_decoder.module.js` on the GLTFLoader.
  3. Export Lola once (one skinned mesh, all clips) and ship guns as separate prop GLBs (see the weapon-swap finding).
  4. Ship audio as `.ogg`/`.m4a` around 96-128 kbps and keep WAV masters out of the shipped folder.
  5. Precompute the nav grids at build time into a binary `.bin` (or build them in a Web Worker).
  6. Generate the list of filled optional sound slots at build time instead of probing.
  7. To confirm: `du -sh dist` drops well below 20 MB, and the Performance panel shows no >100 ms main-thread task during load.
- **Effort:** M  ·  **Quick win:** no

#### [MEDIUM] Every bullet, sight, camera and debris ray tests the full 98,632-triangle map with no acceleration structure  `game-architecture-raycasts-without-bvh`
- **Where:** src/simulation/CombatGeometry.js:19-23, src/camera/CameraOcclusion.js:7, src/camera/CameraOcclusion.js:35, src/simulation/LeaperCombat.js:21, src/simulation/LeaperCombat.js:172, src/simulation/LeaperCombat.js:207, src/simulation/LeaperLegDamage.js:153, src/simulation/PlayerWeapon.js:199, src/simulation/PlayerWeapon.js:203
- **What's wrong:** `CombatGeometry.hit` is `this.raycaster.intersectObjects(this.meshes, false)[0]` over wrapper copies of all 106 map meshes (98,632 triangles), with no BVH. Re-measured on the real map in Node: about **0.19-0.21 ms per ray** after warm-up, whether the ray is a 13-unit camera probe or an 87-unit bullet. A chase frame casts 9 camera-occlusion probes (`for (let i = -1; i < 8; i++)`, CameraOcclusion.js:35) plus up to 3 Leaper visibility rays, one per laser bolt and one per falling leg piece per 1/60 sub-step. That is roughly 12-14 rays, **about 2.5-3 ms of a 16.7 ms frame** (the original report's 4.4 ms estimate was somewhat high). Each M416 shot (7/s) adds 2 `bulletHit` calls. The camera and combat each build their own copy (CameraOcclusion.js:7, LeaperCombat.js:21).
- **Why it matters (plain language):** A noticeable slice of every frame goes into checking what rays hit. Fights on low-end laptops will stutter sooner, and the cost grows with each extra enemy, bullet or camera feature.
- **What it holds back:** More enemies and projectiles, faster automatic weapons, mobile, larger maps.
- **How to fix:**
  1. Add `three-mesh-bvh@0.5.23`, which supports r128 (`npm view three-mesh-bvh@0.5.23 peerDependencies` → `{ three: '>= 0.123.0' }`; the latest 0.9.x needs three ≥ 0.159).
  2. In `CombatGeometry`'s constructor call `mesh.geometry.computeBoundsTree()` once per wrapper mesh, set `mesh.raycast = acceleratedRaycast` on those wrapper meshes only, and set `this.raycaster.firstHitOnly = true` in `hit()`.
  3. Build one `CombatGeometry` in `createJunkyardWorld` and pass it to both `CameraOcclusion` and `LeaperCombat`. Keep the plain `intersectObjects` call in `CameraOcclusion.resolve`'s blocker pass, since it needs all hits.
  4. Leave the Leaper's server-side collision untouched (frozen recipe).
  5. To confirm: re-run the ray benchmark (expect well under 0.02 ms per ray), and `tests/camera-occlusion.test.js` and `tests/combat.test.js` still pass.
- **Effort:** S  ·  **Quick win:** yes

#### [MEDIUM] The HUD is built and updated from gameplay classes, with per-frame DOM queries and stacked CSS overrides  `game-architecture-ui-built-inside-gameplay`
- **Where:** src/simulation/LeaperCombat.js:42-74, src/simulation/LeaperCombat.js:251-273, src/simulation/PlayerWeapon.js:56-72, src/camera/LeaperPov.js:8-15, src/simulation/JunkyardPlaytest.js:20-49, src/styles/junkyard.css:46, src/styles/junkyard.css:63-65, src/styles/junkyard.css:130
- **What's wrong:** The `LeaperCombat` constructor creates the SOUND button, `enemyHud`, the Lola `hud`, the RESTART button and the debug button (:42-74). `updateHud()` runs every frame with 6 `querySelector` calls (`[data-health-bar]`, `[data-attack]`, `progress`, `[data-hit-label]`, `.health-meter`, `[data-hp-text]`) and writes text and CSS variables even when nothing changed (:251-273). PlayerWeapon builds the reticle and ammo HUD (:56-72), LeaperPov builds a button and a reticle (:8-15), and JunkyardPlaytest builds the whole control panel as one `innerHTML` string (:20-49). `#combatHud` is positioned in three places in `junkyard.css` (:46, :63-65, :130), each overriding the last.
- **Why it matters (plain language):** Moving or restyling the HUD means editing combat code. A UI artist cannot iterate on it alone, and there is no natural home for a menu, settings or game-over screen.
- **What it holds back:** Menus, pause and settings screens, a HUD redesign, localisation, a clean player build.
- **How to fix:**
  1. Create `src/ui/Hud.js` for the player HUD (Lola health, Leaper bar, ammo, reticle, result panel). Build it once with cached element references and give it `render(snapshot)` that writes only when a value changed (`if (el.textContent !== text) el.textContent = text`).
  2. Gameplay classes expose state (`combat.lolaHealth`, `weapon.ammoState`) and emit events, and never call `document.*`.
  3. Merge HUD CSS into `src/ui/hud.css` and delete the two superseded `#combatHud` blocks.
  4. To confirm: `grep -n "document\.\|querySelector" src/simulation` returns nothing except harmless `document.hidden` checks, and the HUD looks unchanged.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The Leaper's "can I see Lola?" rule exists twice, in JS and Python, with different numbers  `game-architecture-duplicated-js-python-rules`
- **Where:** src/simulation/LeaperCombat.js:202-207, src/config/combat.js:4, rl/junkyard_env.py:83-100, rl/checkpoint_environment.py:23, rl/checkpoint_environment.py:38-39, rl/junkyard_server.py:163, src/world/createJunkyardWorld.js:21, src/world/randomJunkyardStart.js:12-14
- **What's wrong:** The browser's attack check uses `const range = c.weaponRange * p.world.scale;` with `weaponRange: 22` map units and a Three raycaster from the aim-tracked eye (LeaperCombat.js:202-207). The brain's sight uses `RAY_MAX_RANGE = 28.0` plus `TARGET_RADIUS = 1.4` robot units, measured from the Leaper's centre, and a Python triangle test from the neutral eye (junkyard_env.py:83-100). Both use a 270° field of view. With `scale = 7.98 / width`, the browser range is 31.9 units at the default width 5.5 and 21.9 at width 8. At the default size there is therefore a band from about 29.4 to 31.9 units where the Leaper can shoot Lola although its brain does not see her: the badge reads SEARCHING, or TARGET HIDDEN · MEMORY if it saw her earlier. At large sizes the weapon range is shorter than sight range, which is a normal design choice, not a bug. The scale factor is also duplicated as a literal (`7.98 / width` in junkyard_server.py:163 vs `BODY_COLLISION_RADIUS * 2 / width` in createJunkyardWorld.js:21), and spawn picking pads a 0.2 margin to cover the collision mismatch (randomJunkyardStart.js:12). Calibrated down from medium: the player-visible inconsistency is a narrow band, and the eye-origin difference is documented as deliberate (EyeVision.js:50-51).
- **Why it matters (plain language):** At the default size the Leaper can occasionally shoot Lola from just beyond the distance at which it "notices" her, and tuning one range does not change the other.
- **What it holds back:** Designer tuning of sight versus weapon range, a coherent cover/stealth mechanic, porting the brain to JS (the duplication must be reconciled).
- **How to fix:**
  1. Add `"sightRange": 28, "targetRadius": 1.4, "worldScaleNumerator": 7.98` to `src/config/eye-vision.json`. In `rl/junkyard_server.py` assert at startup that they equal the frozen `RAY_MAX_RANGE`, `TARGET_RADIUS` and `BODY_COLLISION_RADIUS * 2`, and read the 7.98 from the JSON. This keeps the brain's behaviour identical.
  2. In `LeaperCombat.update` use `const range = Math.min(c.weaponRange * p.world.scale, sight.sightRange + sight.targetRadius)`, or also require `p.brain.frame?.sight_visible`. Do not change the brain's own 28-unit range (frozen recipe).
  3. To confirm: add a case to `tests/combat.test.js` with Lola at 30.5 units, default size, in front of the Leaper, and expect no shot.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] Switching guns keeps two complete Lola characters loaded and animated  `game-architecture-weapon-swap-duplicates-character`
- **Where:** src/robot/LolaPlayer.js:104-157, src/robot/LolaPlayer.js:305, src/robot/LolaPlayer.js:522, src/robot/LolaPlayer.js:576, src/robot/LolaPlayer.js:679
- **What's wrong:** Each gun is a whole Lola (`this.outfits = models.map(... new THREE.AnimationMixer(gltf.scene) ...)`). `showWeapon()` only toggles visibility (:305), and every movement sub-step updates both mixers (`for (const [index, outfit] of this.outfits.entries())` … `outfit.mixer.update(deltaTime)`, :576/:679). Measured: 8 / 4 / 2 mixer updates per frame at 30 / 60 / 144 fps. But Lola's entire `move()` costs only **0.18 ms per frame at 60 fps (0.56 ms at 30 fps)**, and the hidden outfit's skinning is not drawn, so the frame-time cost is small. Calibrated down from medium: the real costs are asset duplication (two 1.2 MB characters with 596 KB of identical textures; see the asset finding) and that each new gun would add another full character.
- **Why it matters (plain language):** Every new weapon would mean another complete copy of Lola to download and animate, instead of just a gun model in her hand.
- **What it holds back:** More weapons and loadouts, character customisation, download size.
- **How to fix:**
  1. *Long term:* one skinned Lola, each weapon a prop parented to a hand socket (`DEF-hand.R`, as `createReload` already does for the reload gun), and weapon-specific poses as extra clips on the one mixer (same skeleton).
  2. *Short term:* in `moveStep` call `mixer.update` only for `this.outfits[this.weaponIndex]`. In `switchWeapon()`, copy `current`, each action's `time` and effective weight, and any active jump/shot clip time from the old outfit to the new one before `showWeapon()`.
  3. To confirm: the test "WASD directions, sprint, wall sliding, and weapon switch preserve player position" still passes, and switching mid-run shows no pose pop.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] Debug and lab tools ship in the production bundle and share the player's control panel  `game-architecture-dev-tools-in-shipping-build`
- **Where:** src/simulation/LeaperCombat.js:67-74, src/simulation/JunkyardPlaytest.js:29-49, src/camera/LeaperPov.js:8-11, src/main.js:77, index.html:27-79
- **What's wrong:** `debug.textContent = 'DEBUG: DAMAGE LEAPER';` is appended to the options panel (LeaperCombat.js:67-71). With `debugDamage: 100` and `leaperHealth: 600`, six clicks win the fight. The same panel holds the vision-mode switch, size slider, clearance overlay and sight lines, and LEAPER POV sits in the main toolbar. `grep -lo "DEBUG: DAMAGE LEAPER" dist/assets/*.js` matches the shipped bundle, `PPO TRAINING REPLAY` is in `dist/index.html`, and the `?debug` hook (main.js:77) exposes the whole game object in production. Nothing is gated by `import.meta.env.DEV`.
- **Why it matters (plain language):** A player can kill the boss in six clicks from the options menu, lab switches sit next to "Start", and every player downloads the tool code.
- **What it holds back:** A player-facing release, a clean HUD, a smaller bundle.
- **How to fix:**
  1. Move the debug damage button, POV, sight lines, clearance overlay, vision mode and size controls into `src/debug/DevPanel.js`, loaded with `if (import.meta.env.DEV || params.has('dev')) import('./debug/DevPanel.js')`.
  2. Keep the player toolbar to Start, Restart, Sound and Settings.
  3. Wrap the `window.leaperPlaytest` hook in `if (import.meta.env.DEV || params.has('debug'))`.
  4. To confirm: after `pnpm build`, `grep -c "DEBUG: DAMAGE" dist/assets/*.js` returns 0 for the main chunk.
- **Effort:** S  ·  **Quick win:** yes

#### [LOW] The audio "manager" is a laser class owned by combat: no buses, no 3D positioning, everything WAV  `game-architecture-audio-not-a-system`
- **Where:** src/simulation/LaserAudio.js:1-23, src/simulation/LaserAudio.js:107, src/simulation/LaserAudio.js:137-141, src/simulation/LeaperCombat.js:41, src/simulation/PlayerWeapon.js:206, src/simulation/JunkyardPlaytest.js:63-67
- **What's wrong:** `this.audio = new LaserAudio();` lives in LeaperCombat (:41), and other modules reach in (`p.combat.audio.play(...)`, PlayerWeapon.js:206; `this.combat.audio.step(...)`, JunkyardPlaytest.js:63-67). Every voice goes straight to the speakers (`source.connect(gain); gain.connect(context.destination);`, LaserAudio.js:107/:141), with no master, effects or music bus. Only robot footsteps get a hand-made distance falloff (JunkyardPlaytest.js:67), and laser shots and impacts carry no direction. There is basic voice limiting: a global cap of 16 voices (:137) and 3 robot-step voices (:102). All clips are WAV.
- **Why it matters (plain language):** You cannot hear which side the Leaper is firing from, a key cue in a shooter, and there is no clean way to add volume sliders, music or ambience.
- **What it holds back:** Volume settings, music and ambience, positional threat cues, mixing and ducking, a second enemy's sounds.
- **How to fix:**
  1. Move `LaserAudio` to `src/audio/AudioManager.js`, created in `JunkyardPlaytest` (or the scene) rather than combat.
  2. Add GainNode buses (master → sfx/music/ui) and `playAt(key, position)` using a `PannerNode` (`panningModel = 'HRTF'`) with the listener updated from the camera each frame (or `THREE.AudioListener`/`PositionalAudio`).
  3. Move the clip list into `src/config/sounds.json` (file, level, variations, bus). Compress the files (see the asset finding).
  4. To confirm: `tests/laser-audio.test.js` passes, and a laser fired from Lola's left is heard on the left.
- **Effort:** M  ·  **Quick win:** no

#### [LOW] The whole map is rescaled around the Leaper's size, so a `scale` factor threads through every system  `game-architecture-world-scaled-to-robot`
- **Where:** src/world/createJunkyardWorld.js:21, src/world/createJunkyardWorld.js:33, src/config/combat.js:1, src/robot/LolaPlayer.js:90, src/simulation/JunkyardPlaytest.js:115-121, rl/junkyard_server.py:163
- **What's wrong:** `const scale = BODY_COLLISION_RADIUS * 2 / width; … gltf.scene.scale.setScalar(scale);` scales the map (and Lola, her speed, gun ranges, fog and camera) around a fixed-size robot. `grep -rnoE 'world\.scale' src | wc -l` gives 39 uses, and combat.js:1 states "Distances/speeds are in source-map units and scale with the junkyard". Calibrated down from medium: this is a deliberate, documented trade-off ("Keep the existing rig/gait intact; scale the imported map relative to it"), and because Lola, the map and the camera all scale together, players only perceive the Leaper's size changing. The original claim that level designers "can't build in real metres" is not accurate: they build in Blender units, and everything except the Leaper keeps those proportions. The cost is a code convention: every new distance must remember `* world.scale`.
- **Why it matters (plain language):** Nothing looks wrong to the player, but every new feature has to remember to multiply its distances by the size factor, and forgetting it causes bugs that only show at some Leaper sizes.
- **What it holds back:** Easy feature work, multiple Leapers of different sizes in one map.
- **How to fix:**
  1. *Now:* add `world.units(n)` (returns `n * scale`) in `createJunkyardWorld` and use it in new code, and note the convention at the top of `src/config/combat.js`.
  2. *Later*, together with the in-browser brain: keep the game in map units and apply `7.98 / width` only inside the `BrainBackend` (world ↔ brain units), scaling the Leaper rig by `width / 7.98`. This is a pure change of coordinates, so prove it with the brain parity fixtures before switching.
  3. Remove the size slider from the player build once the final size is chosen.
- **Effort:** S (helper) / L (coordinate refactor)  ·  **Quick win:** no

#### [LOW] Three.js is pinned to r128 (2021)  `game-architecture-three-r128-pinned`
- **Where:** package.json:16, AGENTS.md:67, src/core/createScene.js:9, src/world/createJunkyardWorld.js:46
- **What's wrong:** `"three": "0.128.0"`, pinned "to preserve the prototype's rendering behavior during the first refactor" (AGENTS.md:67). The r128 GLTFLoader ignores `KHR_materials_specular`, which the junkyard GLB uses (`extensionsUsed: ['KHR_materials_specular']`; `grep -c KHR_materials_specular GLTFLoader.js` → 0). Deprecated APIs are in use (`renderer.outputEncoding = THREE.sRGBEncoding`, `convertSRGBToLinear()`), and current three-mesh-bvh (0.9.x) needs three ≥ 0.159. Calibrated down from medium: nothing planned in the near term is blocked, because the BVH quick win works with r128 through three-mesh-bvh 0.5.x, and meshopt/Draco/KTX2 are already supported. The cost is upgrade debt that grows over time.
- **Why it matters (plain language):** Some material settings from Blender are ignored in the game today, and the longer the version stays frozen, the bigger and riskier the eventual upgrade becomes.
- **What it holds back:** Newer material features, the newest helper libraries, WebGPU, closer Blender-to-game visual match.
- **How to fix:**
  1. After CI exists, upgrade on a dedicated branch: r128 → about r150 first (mostly renames), then r152+ for colour management (`renderer.outputColorSpace = THREE.SRGBColorSpace`, `ColorManagement`). Retune light intensities once when physically based light units become the default.
  2. Compare screenshots from the existing browser harness pages before and after.
  3. Independently, add `vite.config.js` with `build.rollupOptions.output.manualChunks: { three: ['three'] }` to remove the >500 KB chunk warning.
- **Effort:** M  ·  **Quick win:** no

#### [INFO] Engine choice: stay on an upgraded Three.js for now and re-evaluate an editor-based engine at the vertical-slice milestone  `game-architecture-engine-choice`
- **Where:** package.json:16, rl/junkyard_server.py:12-13, src/robot/LolaPlayer.js, src/robot/footstepContacts.js
- **What's wrong:** Nothing is wrong; this is advice. The current stack is about 6k lines on three r128 + Vite with 69 node tests that use the real GLB skeletons, plus a PyTorch brain server. Main already runs an ONNX brain in the browser with a fixed 1/30 tick (`main:src/brain/LeaperBrain.js`, `BrainDriver.js:16`).
- **Why it matters (plain language):** Switching engines now would throw away working game code and tests and still leave the hardest problem unsolved: the brain's inputs must be rebuilt exactly in whatever engine you pick. Getting the brain running in JavaScript first makes any later move cheaper.
- **What it holds back:** Long-term tooling choices (visual level editor, animation graphs, built-in character controller).
- **How to fix:**
  1. *Now:* keep Three.js, upgrade it, and add the standard libraries (three-mesh-bvh, Rapier for Lola's character controller, Tweakpane/dat.gui, onnxruntime-web, gltf-transform). Fix the loop, actor, scene and in-browser-brain architecture first.
  2. At the vertical slice (in-browser brain working, a second enemy or level planned), re-evaluate. If you want to lay out levels, build animation graphs and tune without a programmer, the realistic candidates are PlayCanvas (web-native editor) or Godot 4 (free editor; note that Godot's C# projects, which Godot RL Agents' ONNX inference uses, have had limited web export).
  3. Unity (ML-Agents plus Sentis) only makes sense if web delivery is dropped or retraining is accepted. Unreal does not fit a browser game.
  4. In every case, the ONNX model plus Python-generated parity fixtures are the portable contract.
- **Effort:** XL  ·  **Quick win:** no

**Checked and rejected**

None of the 20 original findings was rejected outright. Claims that did not hold up were corrected inside the findings:
- "Mixed content" is not what blocks a hosted page: the server's origin allow-list and the missing server/model are.
- The fixed-timestep impact was overstated, and README.md:108 is not contradicted.
- The failing Lola tests come from the tip commit's input-easing and foot-lift changes, not from the flag juggling itself.
- The ray cost is about 0.2 ms per ray, not 0.315.
- The weapon-swap cost is mostly download size, not frame time.
- Level designers do build in Blender units.
- The r128 pin does not block the BVH quick win.


---

## Appendix

### A.1 Duplicate-finding map

Several areas found the same problem from different angles. For chapters 4-9, each group was merged under one "kept" id, listed on the left. The area chapters in chapter 10 still contain the merged findings under their own ids, so you can read every angle.

| Kept id (used in chapters 4-9) | Merged into it |
|---|---|
| `core-loop-brain-gates-whole-encounter` | `enemy-combat-brain-gated-attacks`, `brain-ai-no-checkpoint-no-fallback` |
| `game-architecture-python-brain-blocks-web-release` | `brain-ai-server-architecture`, `perf-brain-localhost-http-loop` |
| `core-loop-brain-cadence-frame-dependent` | `brain-ai-step-rate-drift`, `hexapod-step-clock-framerate`, `perf-brain-rate-depends-on-framerate`, `game-architecture-no-fixed-timestep` |
| `game-architecture-presentation-driven-by-leaper-sim` | `core-loop-camera-frozen-after-encounter-end` |
| `core-loop-encounter-end-erases-feedback` | `aim-weapons-kill-shot-feedback-cleared` |
| `enemy-combat-end-state-freeze` | `player-defeat-freeze`, `hexapod-death-is-a-freeze` |
| `hexapod-shadow-follows-leaper` | `perf-shadow-box-follows-leaper`, `world-assets-shadow-box-ignores-scale`, `core-loop-sun-and-lights-owned-by-wrong-modules` |
| `core-loop-no-game-state-machine` | `ui-audio-pause-does-not-pause`, `enemy-combat-pause-not-pause`, `game-architecture-ad-hoc-state-flags` |
| `core-loop-playtest-god-object` | `game-architecture-no-actor-model-single-leaper`, `game-architecture-implicit-coupling-monkeypatch`, `brain-ai-god-object` |
| `hexapod-simulation-god-object` | `core-loop-leapersim-mixed-roles` |
| `ui-audio-dom-scattered-in-gameplay` | `game-architecture-ui-built-inside-gameplay`, `perf-hud-dom-writes-every-frame` |
| `game-architecture-input-not-action-mapped` | `core-loop-input-scattered`, `player-input-fragmented`, `aim-weapons-input-scattered` |
| `game-architecture-tuning-scattered-no-live-ui` | `enemy-combat-tuning-scattered`, `player-tuning-scattered`, `hexapod-gait-feel-numbers-in-code`, `hexapod-speed-not-in-config` |
| `core-loop-two-perception-authorities` | `enemy-combat-two-perception-models`, `brain-ai-three-sight-models`, `game-architecture-duplicated-js-python-rules` |
| `hexapod-parity-constants-duplicated` | `brain-ai-duplicated-constants` |
| `world-assets-world-scaled-around-rig` | `game-architecture-world-scaled-to-robot` |
| `game-architecture-raycasts-without-bvh` | `world-assets-raycast-no-bvh`, `perf-brute-force-raycasts`, `aim-weapons-map-raycast-bruteforce-snapshot` |
| `perf-gunshot-shader-and-buffer-churn` | `aim-weapons-effects-allocation-churn` |
| `game-architecture-modes-instead-of-scenes` | `core-loop-mode-selection-in-main`, `hexapod-three-apps-one-entry`, `world-assets-legacy-worlds-default-route`, `engineering-repo-layout-two-products` |
| `engineering-no-ci-no-test-scripts` | `enemy-combat-tests-manual`, `game-architecture-team-workflow` |
| `engineering-brain-origin-allowlist` | `core-loop-dev-config-ports-scripts` |
| `player-failing-tests-root-cause` | `engineering-red-suite-baseline` |
| `engineering-browser-tests-manual-rot` | `aim-weapons-browser-tests-stale-unwired` |
| `engineering-python-tests-checkpoint-coupled` | `brain-ai-tests-gated-and-circular` |
| `engineering-python-deps-unpinned` | `brain-ai-python-packaging` |
| `ui-audio-m416-noncommercial-license` | `ui-audio-no-attribution-or-provenance`, `engineering-asset-licenses-undocumented` |
| `engineering-binary-churn-no-lfs` | `world-assets-repo-binaries-no-lfs` |
| `game-architecture-asset-pipeline` | `perf-serial-uncompressed-loading`, `core-loop-boot-sequential-no-progress`, `ui-audio-oversized-and-dead-audio-assets`, `perf-lola-texture-duplication-first-use-uploads` |
| `engineering-source-art-off-repo` | `player-export-pipeline`, `world-assets-machine-bound-export-scripts` |
| `engineering-docs-drift` | `player-docs-drift`, `enemy-combat-docs-drift`, `aim-weapons-tuning-scattered-docs-stale` |
| `game-architecture-status-messages-hidden-in-options` | `core-loop-feedback-hidden-dev-ui` |
| `ui-audio-debug-tools-in-player-hud` | `game-architecture-dev-tools-in-shipping-build` |
| `engineering-three-r128-pin` | `core-loop-three-r128-pin`, `game-architecture-three-r128-pinned` |
| `player-outfit-duplication` | `game-architecture-weapon-swap-duplicates-character`, `perf-hidden-outfit-animated-substeps`, `player-animation-cost` |
| `hexapod-10hz-surge` | `enemy-combat-mobility-lurch` |
| `enemy-combat-restart-partial` | `core-loop-restart-stale-state` |
| `world-assets-random-start-size-slider` | `perf-restart-random-main-thread-freeze` |
| `brain-ai-no-behaviour-layer` | `enemy-combat-single-attack-no-chase-payoff`, `enemy-combat-no-state-model`, `hexapod-no-leap-architecture` |
| `game-architecture-audio-not-a-system` | `ui-audio-no-spatial-audio`, `ui-audio-no-mix-buses` |
| `perf-optional-audio-html-fallback` | `ui-audio-registry-drift-and-slot-fetches` |
| `aim-weapons-ads-hides-whole-body` | `player-no-aim-offset` |

### A.2 Findings per area (after verification)

| Area chapter | Critical | High | Medium | Low | Info | Total |
|---|---|---|---|---|---|---|
| 01 Bootstrapping, game loop & orchestration | 1 | 1 | 12 | 4 | 0 | 18 |
| 02 Lola player controller, animation & input | 0 | 3 | 9 | 5 | 0 | 17 |
| 03 Camera, aim & player weapons | 0 | 2 | 8 | 8 | 0 | 18 |
| 04 Leaper combat, damage, health & encounter rules | 0 | 2 | 8 | 6 | 0 | 16 |
| 05 Enemy brain: RL integration, inference server & AI design | 0 | 4 | 5 | 7 | 0 | 16 |
| 06 World, map, collision data & asset pipeline | 0 | 1 | 9 | 7 | 0 | 17 |
| 07 Leaper hexapod rig, locomotion & legacy modes | 0 | 2 | 9 | 5 | 0 | 16 |
| 08 HUD/UI, controls presentation & audio | 0 | 2 | 10 | 3 | 0 | 15 |
| 09 Performance, loading & runtime behaviour | 0 | 1 | 7 | 6 | 2 | 16 |
| 10 Testing, tooling, docs, repo hygiene & branch strategy | 1 | 2 | 13 | 3 | 0 | 19 |
| 11 Game architecture vs classical practice | 1 | 3 | 10 | 6 | 1 | 21 |
| **Total** | **3** | **23** | **100** | **60** | **3** | **189** |

Four findings were added by the verifiers themselves and are marked "(new)" in chapter 10: `core-loop-encounter-end-erases-feedback`, `aim-weapons-first-frame-negative-dt`, `hexapod-step-clock-framerate` and `ui-audio-start-run-offline-capture-race`.

**The refuted finding.** `enemy-combat-weak-point-centre` claimed that aiming at the centre of the body always hits the red eye core, so every shot is a critical hit. A Node check with the real rig, with the eye tracking Lola as `LeaperCombat.track` does, showed the core is hit only at a 0° bearing and missed at 10°, 20°, 30° and 45°. The reviewer's own grid scan scored a critical hit on only 2 of 53 hits. The finding was dropped; the small weak point is a normal design.

**Section files.** All 11 area chapters existed and are appended in chapter 10 in the requested order. None was skipped.

### A.3 What could not be verified here

- **Real-GPU performance.** All browser measurements used Chromium with software rendering (SwiftShader). Draw calls, mesh, texture and raycast counts, and CPU costs are meaningful; frame rates are not. In the live-brain check the sandbox rendered at about 1.3 frames per second and so reached only about 0.5 brain steps per second. That is a sandbox artefact, but it does show that the brain's pace is tied to the render loop (5.13).
- **The brain at the reviewed commit, and the owner's exact Python setup.** At `9b384c9` the checkpoint is not in the repo. At first the review environment had numpy and gymnasium only, because the PyTorch download index was blocked by the network policy; PyTorch 2.14 was later installed from PyPI. The brain evidence (9/9 Python tests, a 90-second live headless fight, `/step` timings, the 148 KB ONNX scratch export) comes from `be3f9fb`'s checkpoint in that environment (Python 3.13, PyTorch 2.14, sb3-contrib 2.9). The checkpoint was saved with Python 3.12.3, SB3 2.9.0 and torch 2.13.0+cpu. The owner's sb3-contrib version is unknown and needs `pip freeze` on the owner's PC.
- **Long fights with the real brain.** The live fight lasted 90 s with Lola standing still. The "stops hunting after a catch or after about 1,000 steps" behaviour (5.12) is backed by the code and the training setup, but the proposed soft-restart fix was not measured.
- **The full in-browser brain.** Only the actor network was exported and compared. The JavaScript port of the 34-value observation, the raster and the eye sight doesn't exist yet, so the parity of the complete in-browser pipeline is unproven until the Phase 4 fixtures pass.
- **Real phones and tablets.** The touch soft-lock was reproduced with Pixel 7 emulation in Chromium. Whether a touch `pointerdown` unlocks audio in real Chrome and Safari was not verified.
- **Windows-only paths.** `Start-Leaper.ps1` and the Windows `.venv/Lib/site-packages` path hacks were read but not run, because the sandbox is Linux.
- **Blender exports.** No Blender export was re-run. The Lola `.blend` sources are not in the repo, and the junkyard export reads `C:/Blender/Junkyard_Blockmesh.blend`. The skeleton fix (5.33) and the tire-passage fix (5.29) therefore remain instructions only.
- **Some sound licences.** The licences of Freesound 423117 (knee break), 718965 (pistol) and 407349 could not be confirmed from here.
- **Design intent.** A few checks depend on what you want, not on the code:
  - Should Lola face her travel direction while strafing? This affects `camera-player.js:89`.
  - Should the tire passage be open at width 5.5?
  - Should jumps clear low props?
  - What share of the map should the Leaper be able to reach at the default size?

### A.4 Method notes

- **Process.** 11 area reviewers each read every file in their scope and followed imports where needed. An independent verifier then re-checked each finding against the code: re-reading the cited lines, re-running tests, reproducing bugs in headless Chromium, and running small Node and Python probes. Verifiers corrected severities in both directions, merged duplicates, added four new findings, and refuted one. Of the 189 kept findings, 71 were only partly confirmed and were corrected in place.
- **Line numbers** refer to `9b384c9`. The newer tip `be3f9fb` only adds `model_7757824/` and removes it from `.gitignore`, so the code line numbers are unchanged; only the `.gitignore` lines move.
- **Severity in chapters 4-5** is the highest severity among the linked findings. **Effort** uses the scale in the header.
- **Tools.** Node 22, pnpm 11, Vite 7, Playwright 1.56 with Chromium (SwiftShader), ESLint 10 core rules with a scratch config (not committed), a Prettier `--list-different` check, `git merge-tree --write-tree` for the trial merge, and Python 3.13 scratch environments.
- **No changes were made to the project.** The reviewed checkout and the main checkout were read-only. Most scratch scripts and probes stayed in the review's temporary folders and are gone. The ones this report relies on are kept in `attachments/` (see `attachments/README.md`).
- **Skipped coverage round.** The planned "completeness critic" round, where an extra agent looks for files and questions the 11 reviewers missed and up to 3 follow-up reviewers cover them, was skipped at the owner's request to finish sooner. Coverage is therefore what the 11 areas list in their own chapters; small gaps between areas are possible.
- **New features** (recoil, a stomp attack, a leap) are recorded as what the current code blocks, not as bugs.
