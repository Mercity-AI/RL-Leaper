# Claude handoff — Leaper

Read `AGENTS.md` first: Part 1 is the game, Part 2 the RL lab. The owner is a
game designer, not a programmer: explain results in plain language, ask about
creative intent, and never push, force-push or merge without their say-so.

## Pickups: health pills and ammo bullets (built 2026-10-20/21)

Glowing pickups float around the yard; Lola takes one by walking into it. One
system serves both kinds: `src/game/FloatingPickups.js` (scatter, refill, look,
motion), with `HealthPills.js` and `AmmoBullets.js` saying what a pickup does;
every number is in `src/config/pickups.js`. The design preview with sliders is
`previews/health-pill.html` (through `pnpm dev`: /previews/health-pill.html);
it shows the pill and the bullet in yellow and in blue.

- **Models:** the owner's `C:\Blender\LOWPOLY\Pill_Health_Leaper.blend` +
  `Pill.png` and `Bullet.blend` + `Bullet.png` (read and export only, never
  modify), exported with Blender's glTF exporter (Y-up) to
  `assets/props/health-pill.glb` and `assets/props/ammo-bullet.glb` (loaded as
  they are, no compressed copy). Texture mipmaps are off (LinearFilter) so the
  textures' black backgrounds do not bleed into the colours.
- **Look (owner's choices):** the object leans 25° clockwise inside a sphere
  that glows only at its edge (no haze over the object): **blue** (0x3aa8ff)
  for the pill, **yellow** (0xffc23a) for the bullet, glow strength 2.2 x 0.6,
  with a matching glow circle on the ground (no real light, to keep the map
  fast). The pill is 80% as thick as modelled; both have a little shine
  (roughness 0.515) and no tint. Rejected: red, and a glow hugging the pill.
- **Motion:** spins once every 8 s; bobs 0.0467 up and down every 3 s; floats at
  1.155 (sphere centre, preview units: 0.95, then 1.05, then +10%). Float
  height and bob distance are separate settings.
- **Size:** the whole pickup is a third of Lola's height plus 10%.
- **Taking one:** the moment she touches the sphere the object vanishes and its
  glow fades in 0.12 s, with a sound (`healthPickup`, `ammoPickup` in
  `src/audio/sounds.json`, synthesised by `scripts/assets/make-sounds.mjs`).
  A pill gives back 10% of her *total* health; at full health (or down) she
  leaves it alone.
- **Spawning (each kind):** a new game scatters 3 at random open spots, away
  from Lola and from every other pickup; when only one is left, new ones appear
  6 s apart until there are 3 again; never more than 4.

## Ammo bullets (owner's choices, 2026-10-21)

- **Model:** `C:\Blender\LOWPOLY\Bullet.blend` + `Bullet.png` (with a heart),
  exported to `assets/props/ammo-bullet.glb` with the texture brightened x1.875
  (preview "lightness" 0.35). Same look and motion as the pill, **yellow** glow
  (0xffc23a), scaled to the pill's length.
- **Pickup sound (2026-10-21):** the first ammo sound (clicks and a metal
  ring) was rejected; now a soft tick and two rising notes (E5, B5), recipe in
  `scripts/assets/make-sounds.mjs`. The pill's sound is approved.
- **Ammo rules:** only the M416's spares run out: it starts each fight with 80
  spare rounds (4 magazines) and carries at most 160 (8). The basic gun stays
  unlimited. One bullet gives +40 (2 magazines); full spares leave it be.
- **Spawning:** same rules as the pills (3 at start, refill when one is left,
  never more than 4); pills and bullets keep clear of each other.
- **HUD:** a row of bullet icons above the gun circles, one per magazine the
  M416 can carry: lit yellow as far as its spares go, new ones pop in.

## Climbing (owner's choice, 2026-10-21)

- Lola climbs onto the open, toppled yellow container ("03 - southern fallen
  freight") by pressing jump beside it while facing it (option A; no climb
  animation yet, she rises during the jump clip: an authored climb clip from
  the owner would replace that). Walking off an edge drops her. Up there she is
  safe from stomps and leaps, not from the laser. Roofs: `src/world/climbableRoofs.js`;
  reach and landing inset: `LOLA_CLIMB` in `src/actors/lola/lolaTuning.js`.
- Low props (owner, 2026-10-21: "at least above the tires", heights my call):
  she walks up onto anything up to 0.35 map units and jumps onto anything up
  to 1.25 (barrels, tire stacks and mounds, spill piles); cars (1.4+), big
  heaps and skips stay walls. `LOLA_FOOTING` in `src/actors/lola/lolaTuning.js`;
  the height under her comes from the collision triangles' tops
  (`JunkyardNavigation.surface`). Standing on them does not protect her from
  the Leaper; only the container roof does.
- That container is a duller yellow with its grey inside wall yellow
  (`JUNKYARD_PROP_COLOURS` in `src/world/junkyardSurfaces.js`, applied over the
  baked texture, so it survives a re-bake as long as the part names stay).

## Where things stand (2026-10-21)

- **Working branch:** `claude/zen-davinci-ku9f5z`, pushed to
  `Mercity-AI/RL-Leaper` with everything above (ammo bullets and their HUD,
  the pickup sounds and tuning, faster Lola, stamina, climbing, hanging legs,
  the yard's floor and walls; commit `ae36dbd`, 2026-10-21). Commit and push
  only when the owner says, and never photos, videos or `previews/`. `main`
  has none of the overhaul. What changed for players:
  `docs/game/CHANGELOG.md`.
- **The game** runs with `pnpm dev` at http://localhost:5173/ (title screen:
  PLAY, EXPLORE, SETTINGS, CONTROLS, CREDITS). The owner's test link is
  http://localhost:5173/?explore=1: straight into EXPLORE (Lola moves, the
  Leaper stands still); Esc, then START THE HUNT FROM HERE starts the real
  fight with every broken leg kept. The Leaper's frozen brain
  (7,757,824 steps) runs in the browser (ONNX); it must never be retrained or
  edited in place (`AGENTS.md`, "Non-negotiables").
- **The map** is the owner's own yard, `junkyard_v2` (about 78 x 73 map units).
  Its look is procedural in Blender and is baked into one texture before export:
  the four steps are in `README.md`, "Art pipeline". Re-run them whenever the
  owner sends a new version of the yard. The owner's working files live in
  `C:\Blender\`; never modify them.
- **Owner choices to keep** (from the owner, 2026-10-19): the plain "+"
  crosshair (spread ticks, hit-marker X and OBSTRUCTED look stay off in
  `src/styles/ui/reticle.css`); leg pieces take 11-13 (knees) and 19-21 (long, "20ish" 2026-10-22
  pieces) bullets; any cut leg curls up and hangs (2026-10-21: the walking
  stump looked like a whole leg, so `walkOnStump` is off in
  `src/config/combat.js`), its broken end near eye height, bobbing gently while
  the Leaper walks (`src/simulation/HangingLeg.js`); no standing leg on one
  side means the Leaper tips over for good. Lola can sprint 10 s in one go,
  then is winded (normal run) for 4 s (`LOLA_STAMINA`, 2026-10-21). Lola runs and
  sprints 15% faster again (2026-10-21: `LOLA_PACE` run 2.3 -> 2.645, sprint
  3.1 -> 3.565, in `src/actors/lola/lolaTuning.js`). The yard is closed on
  all four sides (2026-10-21): the south wall was added to the repo's
  `junkyard_v2.blend` and `junkyard_v2_baked.blend` only, so add it again if
  the owner sends a new yard without one. The floor (dirty brown earth, mud
  patches, oil stains, pebbles) and darker rusty walls are approved
  (2026-10-21); their colours and dirt live in `src/world/junkyardSurfaces.js`.
  With the camera close behind her Lola fades to no less than 92% (was 80%:
  too see-through; `CameraController.beforeRender`). Save every setting the
  owner picks as a real default, never only in a URL.
- **The owner's laptop** (HP OMEN): two GPUs (AMD Radeon built in, NVIDIA RTX
  3050). If the game lags, first check `chrome://gpu` (GL_RENDERER) and set
  Chrome to "High performance" in Windows Settings > Display > Graphics (a
  system setting the owner changes, not us). It also has HP's ViGEmBus virtual
  controller driver: a pad whose stick rests off-centre walked Lola right, so
  each pad's first reading is now its centre (`PAD_TUNING.maxRest`,
  `InputController.padRestAxes`).

## Open items

- **Sounds the owner still needs:** a sound for a cut-off leg piece landing
  (no slot yet). See `src/audio/sounds.json`. Lola's `lolaHurt` grunts are the
  owner's own voice (2026-10-22): four takes cut from
  `assets/audio/sources/owner/lola-grunts-2026-10-22.ogg` with the breaths left
  out (owner: "remove any inhaling sounds"), never the same take twice in a row.
  Re-encode new takes alone: `pnpm assets` re-encodes every sound with this
  machine's ffmpeg and changes them all, so keep only the new files.
- **No hiding places (owner, 2026-10-22):** Lola may not walk into a container
  the Leaper cannot see into; ones it can see into stay open as shelters.
  Blocked for her only (`PLAYER_BLOCKED_PROPS` in `src/world/playerBlockers.js`;
  collision.json and the Leaper's grid untouched): 01 central side-fallen and
  06 north-east fallen (deep ends seen from under 5% of the Leaper's places).
  03, 04, the bus and the van are seen from 15% or more and stay open. Re-measure
  if the owner sends a new yard.
- **Title screen and starts (owner, 2026-10-22):** short title buttons with
  big words, no hint under PLAY; behind the title Lola is hidden and the
  Leaper turns on the spot, a little clockwise then anticlockwise (not
  sidestepping: owner), lit brighter by the sky fill and the rim light
  (`src/game/TitleShowcase.js`). The loading screen says just LOADING.
  Title music (owner's pick D, 2026-10-22): Brandon Morris's CC0 "Loading
  screen loop" (b423b42.wav, original in `assets/audio/sources/opengameart/`),
  slot `titleMusic` (ambience bus, gain 1: raised from 0.6, owner 2026-10-22). Cut to a seamless 6-bar loop, 3.105 to
  18.588 s with a 0.5 s blended seam (owner: "doesn't feel abrupt"); the cut
  is described in its sounds.json entry. Built by hand with ffmpeg (not
  `pnpm assets`). The other candidates stay in `previews/title-music.html`.
  Sound is started as the loading screen ends (owner: music without a
  click; `audio.unlock()` in `src/modes/junkyard.js`); a browser that blocks
  sound without a gesture still holds it until the first key or click. Every new
  game (restart, title) drops the Leaper and Lola at random spots 22-42 map
  units apart (`GAME_START` in `src/world/randomJunkyardStart.js`). Lola's
  grunts were raised to gain 0.65 (cry 0.7) in `src/audio/sounds.json`.
- **HUD and frame rate (owner, 2026-10-22):** the M416 is gun 1 (left, the
  default), the pistol gun 2. The Leaper's floating bar flashes white only in
  its filled part on a hit, and its eye badge has no diamond box. The ammo
  bullet pickup is 10% bigger than the pill (`AMMO_BULLETS.size`). An FPS
  counter shows top right (SETTINGS > GRAPHICS > Show FPS, on by default) and
  "Keep 60 FPS" (on) lowers the drawing resolution in steps, down to 60%, when
  the rate drops below 57 (`src/core/AdaptiveResolution.js`); the counter
  shows the share (e.g. "60 FPS · 85%") while it is lowered, and the settled
  share is remembered (`leaper.resolutionScale`). Game logic costs about 2 ms
  a frame, so a slow rate is the drawing (the graphics card).
- **Frame-rate fix (2026-10-22), measured on the owner's laptop graphics (AMD
  Radeon built in; full screen = 2400 x 1350 drawn pixels) with GPU timers:**
  the frame took 50-58 ms (~17-20 fps). Two causes: (1) the floor and walls
  worked out their dirt live, 39 noise layers per floor pixel and 18 per wall
  pixel every frame: their slow parts are now baked once at load into two
  pictures (`bakeJunkyardSurfaces` in `src/world/junkyardSurfaces.js`, called
  from `src/modes/junkyard.js`; same look, compared side by side), only the
  near grit and pebbles stay live; (2) 4x MSAA on the glow pass's off-screen
  picture doubled the cost: replaced by FXAA in the final blend
  (`src/core/postprocessing.js`). After: 16-18 ms at full screen in every
  direction (and Keep 60 FPS trims the rest). If the floor or wall dirt
  numbers in `JUNKYARD_SURFACES` change, the bake follows automatically.
- **Player vs developer screen (2026-10-22):** players get PLAY / SETTINGS /
  CREDITS and no key hints; the key list is SETTINGS > CONTROLS > KEYS AND
  BUTTONS. EXPLORE, `?explore=1`, START THE HUNT FROM HERE, the VIEW button,
  the H legend and the gun keys show only with the developer tools (the dev
  server, or `?dev`); `?dev=0` shows the player version locally. The developer drawer has no
  on-screen DEV button (owner, 2026-10-22: it covered the FPS counter); the ` key opens it.
- **Spray and kick (owner, 2026-10-22: "spray pattern cs 2", "more shaking",
  "more recoil"):** the M416 has a fixed 20-shot CS2-style pattern (`spray` in
  `src/config/weapons.js`, degrees; the view climbs with all of it so bullets
  land on the crosshair (owner, 2026-10-22: `viewFollow` 0.45 -> 1); winds
  back 0.2 s after the trigger rests). Per-shot kick raised (M416 pitch 0.006 ->
  0.011, pistol 0.02 -> 0.03) plus a screen tilt (`roll`) and a jolt back
  (`push`) that shake without moving the aim (raised 1.5x on request: M416
  0.012 / 0.075, pistol 0.021 / 0.12); M416 bloom cut (max 0.02 ->
  0.012). The pistol has no pattern.
- **Lola's health (owner, 2026-10-22: "+20%"):** really 120 (was 100;
  `COMBAT.lolaHealth` in `src/config/combat.js`), but the player always sees
  it out of 100 (`lolaHealthShown`; owner: "120 looks weird, we are upping the
  value of 100, not the number"): a bolt shows as about 7, DAMAGE TAKEN too.
  The low-health warning moved with it to 24 real (still 20%).
- **End of a fight (owner, 2026-10-22):** the moment it is decided (won or
  lost) one big impact plays (`gameEnd` in `src/audio/sounds.json`, recipe
  `game-end-impact` in `scripts/assets/make-sounds.mjs`, encoded by hand, not
  `pnpm assets`); the end screen waits 1.6 s (`END_SCREEN` in
  `src/ui/GameUi.js`) and opens with the title music, which stops on RESTART.
- **Animation:** the owner is making a new 3-second reload clip; swap it in
  when it arrives rather than stretching the old one.
- **Leg damage vs health:** the owner floated making lost legs cost more of the
  Leaper's health. Not done; ask before changing balance.
- **Tests:** `pnpm test` (497 on 2026-10-21) has one failure, not from the
  pickups: the brain free-run lockstep check in `tests/brain-parity.test.js`
  (eye-7.98-chase stays in lockstep 74 steps, below its floor; it came with the
  rebuilt map and fixtures). If the README controls check fails on line
  endings, `node scripts/print-controls.mjs --write` fixes it. Three in-browser pages still stage scenes on the old map layout and
  fail: the weak-point shot in `tests/browser-combat.js`, a shot in
  `tests/leaper-behaviour.js`, and the loading-progress check in
  `tests/brain-game.html`.
- **History:** `docs/How-the-Leaper-Works.pdf` was pushed by mistake and then
  removed; it is still in the branch history. The owner keeps it locally and
  does not want it in the repository.

## RL lab

The PPO_29 normalized-throttle task this file used to describe is done; runs
continued to PPO_35. Start from `AGENTS.md` Part 2 and
`docs/SEEKER_HANDOFF.md`. Generated artifacts in `rl_artifacts/` stay
git-ignored and are never overwritten.
