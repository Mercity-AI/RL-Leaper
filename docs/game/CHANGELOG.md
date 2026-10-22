# Game changelog

The game's history, kept apart from the RL training ledger (`TRAINING.md`).
Newest first.

## 2026-10-22: the crosshair decides, a clean screen, Lola's voice

### For players

- **Lola is 20% tougher.** Her health still reads 100, but every hit takes
  less of it (a laser bolt about 7 instead of 8), so she lasts 15 bolts
  instead of 13. The red low-health warning still starts at a fifth of her
  health, and a health pill still gives back a tenth.
- **A big ending.** When the fight is decided, won or lost, one big impact
  booms; a moment later the end screen comes up with the title music.
- **The M416 has a spray pattern, like CS2's.** Hold the trigger and the
  bullets climb for about 8 shots, hook left, then swing right: the same way
  every time, so it can be learned. The view climbs with it, so the crosshair
  always shows where the next bullet goes; pull down and against the drift to
  keep a spray on target. Tapping or short
  bursts stay on the crosshair. Random bloom is smaller to make room for it.
- **The guns kick and shake harder:** more climb per shot, and the view now
  tilts and jolts back a little with each shot (without moving the aim).
- **Shots go where the crosshair is.** A bullet hits whatever is under the
  crosshair, even when low cover sits in front of Lola's gun (before, a
  container in front of the barrel could swallow a shot aimed over it). The
  tracer still leaves the gun.
- **A clean screen.** The title offers PLAY, SETTINGS and CREDITS; no key hints
  appear in the fight. Every key, gamepad button and touch control is under
  SETTINGS > CONTROLS > KEYS AND BUTTONS.
- **Long leg pieces break sooner:** about 20 hits each (19-21, was 32-34);
  knees still take 11-13. Hits always add up over the whole fight.
- **No hiding places.** Lola can no longer walk into the two fallen containers
  the Leaper could not see into (the central one, rust inside, and the
  north-east one); the containers it can see into stay open as shelters.
- **Lola grunts when hit**, in the owner's own voice: four grunts, never the
  same one twice in a row.
- **The Leaper stars on the title screen**: Lola is hidden and the camera
  watches the Leaper, lit a little brighter, turn on the spot a couple of
  steps clockwise and back anticlockwise. The loading screen just says LOADING. The title
  buttons are shorter with bigger words, and PLAY has no line under it.
- **Every new game starts somewhere new**: the Leaper and Lola are dropped at
  random spots, 22-42 map units apart, where the Leaper can reach her.
- **The M416 is gun 1** (left, and what Lola starts with); the basic gun is 2.
- **The Leaper's health bar** flashes white only where it is still full when
  hit, and its eye has no box around it.
- **Ammo bullets are 10% bigger.**
- **About three times faster drawing** on laptop graphics: the yard's floor
  and wall dirt is worked out once while loading instead of every frame, and
  edges are smoothed with a much cheaper method (FXAA). Full screen on the
  owner's laptop went from about 17-20 fps to about 60.
- **FPS on screen** (top right; SETTINGS > GRAPHICS > Show FPS), and **Keep
  60 FPS**: when the graphics card falls behind, the game draws slightly
  fewer pixels (never under 60%) instead of dropping frames.
- **Title music**: a dark electronic loop ("Loading screen loop" by Brandon
  Morris, CC0) plays on the title screen and fades out when the game starts.
  It loops every 15.5 s with no audible jump.
- **Lola's grunts are louder** (gain 0.42 -> 0.65; the low-health cry 0.52 -> 0.7).

### For developers

- EXPLORE, `?explore=1`, START THE HUNT FROM HERE, the VIEW button, the H
  legend and the gun keys need the developer tools (dev server or `?dev`).
- On a page that starts play without a click (`?explore=1`) the browser
  refuses the mouse grab and the view stopped turning at the screen's edge; a
  click on the view now grabs the mouse properly.

## 2026-10-21: broken legs look broken, Lola gets tired, pickups

### For players

- **Health pills and ammo bullets float around the yard.** Walk into one to
  take it. A blue-glowing pill (the owner's own model) gives back 10% of
  Lola's total health; at full health she leaves it be. A yellow-glowing
  bullet (the owner's model, colours brightened, with its heart) gives the
  M416 two spare magazines. Both lean, spin slowly and bob inside a sphere
  that glows at its edge, with a glow on the ground, and are a third of Lola's
  height plus 10%. Each game starts with three of each at random spots; new
  ones appear 6 s apart once only one is left (never more than four). A pickup
  vanishes the moment she touches it, with a sound (the pill's bright rising
  chime is made for the game).
- **The M416's spare ammo runs out.** It starts each fight with four spare
  magazines (80 rounds) and holds at most eight; ammo bullets refill it. A row
  of bullet icons above the gun circles shows the spares, lit yellow, and new
  ones pop in. The basic gun never runs out.
- **Lola is 15% faster** running and sprinting. Her legs blend smoothly when
  she reverses from W+D into S+D (a sidestep clip used to snap her feet).
- **Lola is less see-through** when the camera is close behind her (at least
  92% solid, was 80%).
- **No more drifting.** A gamepad, or a laptop's virtual controller, whose
  stick rests off-centre no longer walks Lola on its own.
- **`?explore=1`** opens straight into EXPLORE (http://localhost:5173/?explore=1
  with `pnpm dev`).

- **A shot-off leg is gone at once.** A leg cut below its lower knee used to
  walk on its shin, which reached the floor and looked like a whole leg. Now
  any cut leg curls up and hangs (and counts as a lost leg). The old rule is one
  switch away: `walkOnStump` in `src/config/combat.js`.
- **Hanging legs sit lower and bob.** Their broken ends hang around the eye's
  height instead of sticking up, and bob gently up and down while the Leaper
  walks, like a keychain on a bag.
- **Sprinting tires Lola.** Shift lasts 10 seconds in one go; run it empty and
  she runs at her normal pace for 4 seconds before she can sprint again
  (`LOLA_STAMINA` in `src/actors/lola/lolaTuning.js`).
- **New ammo pickup sound:** a soft tick and two quick rising notes.
- **Climb the open yellow container.** Face it from close by and press jump:
  Lola climbs onto its top, walks and shoots from up there, and drops back
  down when she walks off an edge. Up there the Leaper's stomps and leaps
  cannot hurt her (its laser still can) and pickups below are out of reach.
  More props can be made climbable in `src/world/climbableRoofs.js`.
- **That container is a duller yellow,** and its grey inside wall is yellow too.
- **Lola stands on low props.** She walks straight up onto anything low
  (fallen poles, a flat tire, the torn container side) and jumps onto anything
  up to about three quarters of her height: barrels, tire stacks and mounds,
  spill piles. Walking off drops her back down. Cars, big scrap heaps and
  skips are still too tall. Up there the Leaper can still reach her.
  (`LOLA_FOOTING` in `src/actors/lola/lolaTuning.js`.)

### For developers

- Pickups: `src/game/FloatingPickups.js` (`HealthPills`, `AmmoBullets`),
  `src/config/pickups.js`, models in `assets/props/`, wired through
  `Encounter({ pickups })`. `PlayerVitals.heal()` and the `lolaHealed` event;
  `WeaponState.addReserve()` / `spareRoom` and `PlayerWeapon.addAmmo()`;
  M416 `reserve: 80, reserveMax: 160` in `src/config/weapons.js`.
- `scripts/assets/make-sounds.mjs` can synthesise (`tones`, `clicks` layers);
  the pickup sounds are project originals (`project-pickup-sounds`).
- `LOLA_PHASE_CATCHUP` (`src/actors/lola/lolaTuning.js`): a visible follower
  clip eases onto the shared stride phase instead of snapping. The Lola
  movement pins were re-recorded at the new pace (every distance x1.15).
- `PAD_TUNING.maxRest` and `InputController.padRestAxes()`: each pad's first
  reading is its centre.

## 2026-10-20: everything on the ground, hunt from explore, soft restart

### For players

- **Nothing floats.** The yard's floor was 7.7 cm below the height the props
  were placed at, so nearly every prop hovered a little. The floor is now at
  0, 13 sunk props were raised and 9 floating ones lowered onto what is under
  them (`scripts/ground_junkyard_props.py`; collision, the brain's raster and
  its recordings were rebuilt).
- **START THE HUNT FROM HERE.** Paused while exploring, the pause menu starts
  the real hunt from that moment: same spots, same broken legs.
- **The Leaper's brain gets a fresh start** every 900 moves and after a catch
  (soft restart, now on), which ended the long freezes in testing.

## 2026-10-19 (evening): the owner's junkyard, tougher legs, plain crosshair

Branch `claude/zen-davinci-ku9f5z`, on top of the overhaul below.

### For players

- **A new, bigger junkyard.** The owner's own yard (about 78 x 73 map units,
  was about 48 x 45): toppled containers with their spilled salvage, poles,
  skips, a second crane and the textured bus. Its rust, wear and colour
  variation are baked into one texture, so the game looks like Blender. All
  props share one matte finish (no metallic shine), which also keeps drawing
  fast (about 64 draw calls).
- **Tougher legs.** Every leg piece takes about 30% more bullets: knees 11-13
  (were 8-10), long pieces 32-34 (were 24-26).
- **Stumps.** A leg cut below its lower knee keeps walking on its stump, the
  shin's tip on the floor, instead of curling up while the Leaper floats. It
  limps a little and leans toward the shorter side.
- **Tipping over.** With no standing leg left on one side (all three cut at
  the upper knee or higher), the Leaper tips over onto that side and stays
  down for good (DOWN FOR GOOD), however many legs it has left.
- **The original crosshair is back:** the plain "+" with its hit colour and
  kick. The spread ticks, hit-marker X and OBSTRUCTED look listed below are
  switched off (`src/styles/ui/reticle.css`; their states are still tracked).
- **No pain grunt for now.** Lola's hit grunt is silent until a female voice
  is chosen; the hit thud and the low-health cry stay.

### For developers

- Map pipeline: `scripts/bake_junkyard_textures.py`, then
  `scripts/export_junkyard.py` (the yard's size now comes from its floor;
  characters are left out), then `pnpm assets` (see README, "Art pipeline").
- The brain's eye-sight readers (`rl/junkyard_sight.py`,
  `src/brain/junkyard/junkyardSight.js`) accept the WebP texture extension.
- The collision raster and brain parity recordings were re-made for the new
  walls; recorded contact scenes moved to open ground (`CONTACT_SHIFT` in
  `scripts/make_junkyard_fixtures.py`).
- Open: two in-browser test scenes (`tests/browser-combat.js` weak-point
  shot, `tests/leaper-behaviour.js` shot) and the brain-game loading check
  still assume the old layout; `pnpm test` is fully green.

## 2026-10-19: the code-review overhaul

Branch `claude/zen-davinci-ku9f5z`. What the review
asked for and what is still open: `docs/reviews/2026-10-19-implementation-report.md`.

### For players

- **No setup beyond the web page.** The Leaper's brain now runs in the
  browser, so the full fight works with just `pnpm dev` or a static copy. If
  no brain can load, the fight still runs in turret mode and says so.
- **Menus.** Title screen (PLAY, EXPLORE, SETTINGS, CONTROLS, CREDITS), a real
  pause menu (Escape, gamepad Start, touch PAUSE) and an end screen with time,
  damage and knees broken. Mouse, keyboard, gamepad and touch all work in the
  menus.
- **Settings.** Graphics quality, look sensitivity, invert look, field of
  view, sound volumes (master, effects, music and ambience, interface), large
  text, captions, and an EDIT HUD LAYOUT mode. Remembered in this browser.
  Captions name the Leaper's moves (eye charging, stomp, leap, landing,
  stagger, fall, collapse), and pausing silences the fight's sounds.
- **A boss fight.** The Leaper stops to shoot, stomps when you hug it (red
  ring warning), leaps at you with a landing shockwave, staggers from eye-core
  hits, loses legs (and slows down), falls after four lost legs (taking 1.5x
  damage while down) and collapses when it dies.
- **Shooting you can trust.** No more backwards shots near walls, aiming can
  reach the knees up close, an OBSTRUCTED reticle, hit markers, recoil and
  spread, and the same fire rate on every machine. Guns rebalanced: the M416
  is the sustained gun, the pistol the slow precise one.
- **Lola moves better.** She slides along slanted walls, blends running and
  strafing on diagonals, keeps her hands on the gun while running and
  shooting, and her hit flinch now carries her arms and gun.
- **Controls everywhere.** Gamepad support, touch controls for phones and
  tablets, a controls overlay on **H**, and the controls table in the README.
- **Looks and sound.** Low, medium and high quality picked automatically;
  glow on the Leaper's eye, bolts and muzzle flashes; a sky gradient and foot
  dust; shadows that follow Lola; a mixed sound system with 3D placement, new
  CC0 sounds, a yard ambience and a CREDITS screen.
- **Fixes.** The kill shot stays visible and the camera keeps working after a
  fight; a clean RESTART (ammo and positions); no 290-degree whip; the Leaper
  walks at its designed speed and glides instead of surging; severed legs no
  longer block Lola; a jump pressed just before landing counts; page zoom and
  screen readers work better.

### For developers

- **Structure.** `src/main.js` boots a mode registry (`src/modes/`) run by
  `GameLoop` phases; `GameFlow` state machine; `Encounter` with `enemies[]`;
  Lola split into `src/actors/lola/`; the Leaper's behaviour layer in
  `src/actors/leaper/`; weapons as data (`src/config/weapons.js`) with a
  target registry; an input action map (`src/input/`); a HUD shell and screens
  (`src/ui/`); an audio service with one sound manifest (`src/audio/`).
- **Brain.** `BrainProvider` chain (ONNX worker, Python HTTP, turret), a
  bit-identical JS port of the junkyard env with parity fixtures, a pose-sync
  API, and player contact v4 in Python and JS. The frozen recipe sits in
  `rl/frozen_7757824/` and is unchanged.
- **Developer tools.** A `?dev` drawer loaded on demand (toolbar, OPTIONS,
  brain badge, perf overlay) and a live TUNING panel over the tuning registry
  (`src/config/tuning/`) with COPY JSON and RESET.
- **Loading and speed.** Modes and three.js load on demand, compressed models
  and sounds (`pnpm assets`), collision grids built in a worker, BVH raycasts,
  batched static meshes, gunshot shaders compiled up front, a warm-up pass.
- **Safety net.** `pnpm lint`, `test`, `test:browser`, `test:py`, `check`,
  `play`; GitHub Actions CI on every push; a GitHub Pages workflow for `main`.
  At `cbf0ff7`: 459 Node tests pass, 13/13 browser pages, Python brain tests
  40/40 with the real checkpoint.
- **Map.** The tire move is now in the junkyard's Blender source, and map
  metrics are baked and tested at the real Leaper width.

## Before 2026-10-18

Lola's movement, guns, crouch and jump, the Leaper's eye bolts, eye-level
vision and the junkyard playtest were built on `fix/lola-first-person-aim`
(up to `be3f9fb`), then merged into main's RL lab (`404c92b`). See
`TRAINING.md` (2026-10-12 entry) and the git history.
