# Game changelog

The game's history, kept apart from the RL training ledger (`TRAINING.md`).
Newest first.

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
