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

## Standing on things (owner, 2026-10-21, changed 2026-10-30)

- **Never on a container (owner, 2026-10-30):** the old climb onto container 03
  is gone, code and all. Every part of containers 01-06 taller than a step is
  solid for her (`PLAYER_SOLID_PROPS` in `src/world/playerBlockers.js`), and
  what she can reach is capped at `jumpUp` above the floor, so a tire stack is
  no step up. She still walks into the open ones (see "No hiding places").
- **Low props:** she walks up onto anything up to 0.35 map units and jumps onto
  anything up to 1.25 (barrels, tire stacks and mounds, spill piles).
  `LOLA_FOOTING` in `src/actors/lola/lolaTuning.js`; the height under her comes
  from the collision triangles' tops (`JunkyardNavigation.surface`).
- **Cars and racks (owner, 2026-10-30):** her body keeps 0.42 map units from
  them and their sills and wheels are no footing (`PLAYER_SOLID_PROPS`); gaps
  wide enough and the racks' low decks stay usable. The bus and van stay open
  and were not changed. All of this is Lola's only: `collision.json` and the
  Leaper's grid are untouched.
- That container is a duller yellow with its grey inside wall yellow
  (`JUNKYARD_PROP_COLOURS` in `src/world/junkyardSurfaces.js`, applied over the
  baked texture, so it survives a re-bake as long as the part names stay).

## The Leaper's aim lock holds a spot (owner, 2026-11-04)

- Firing as it walks, the Leaper moved about 0.5 map units during the 0.2 s lock and its
  bolt flew parallel to the aimed line, 0.2-0.3 to the side, so it missed a Lola standing
  still. The lock now freezes the spot aimed at (`LeaperCombat.lockPoint`) and the eye
  keeps turning to it as the body moves: measured 0.00 miss, every shot hit. Lola moving
  after the lock still dodges.
- A freeze up close reported the same day was not reproduced (4 probes, about 4 minutes,
  Lola still in front, beside and behind it). A tab covered by another window counts as
  hidden and the game pauses the Leaper on purpose; it resumed every time in the probe.

## The eye alone starts a stand-and-shoot (owner, 2026-11-04)

- Lola deep in container 04 (red): the eye had a clear shot past the doors but the brain's
  sight (its own eye offset) missed her, so the Leaper searched, spinning, and never fired;
  or it shot once or twice, the 2.5 s hold sent it walking with a brain that could not see
  her, and it spun until the next hold. Now (`LeaperDirector.engageReady`, `engage`): the
  eye alone may start Engage from Search or Chase out to `exitDistance`, a brain-blind
  hold never ends in a reposition walk, and the reposition cooldown only applies while the
  brain sees her. "Brain sees" is `sense.brainSees` (`sight_visible` or `target_visible`):
  `target_visible` alone stays at its last move while the brain is paused, so without it
  a fight starting in Engage never walked off. Probes: 8-14 shots, all hits, in 25 s; with
  both blind (doors hide her) it still searches, and a shot from cover sends it to
  Investigate. Open-yard fights unchanged (shoot, walk off, stomp).
- Floating prop: "Scrap island - south centre" hung 0.22 up after the van was laid down
  (it leaned on it); grounded with `scripts/ground_junkyard_props.py` (0 left in both files).

## Out of container 03's door end (owner, 2026-11-04)

- Lola walks in through 03's open long side but could not get out of its door end
  (west): the lower door hung half open across it, its free edge 0.44 up (over her 0.35
  step). It now rests on the ground (turned 12.2 degrees about its hinge with its locking
  bar, top 0.19), and the salvage pile it used to cut through ("Container spill -
  recognizable salvage 2") moved 1.6 west and 1.6 north beside the doorway, clear of
  everything. Both repo yard files, then the same rebuild as the van. Container 06 stays
  closed to her (owner: she does not go in there). Before/after:
  `previews/container-03-door.png`.

## The van on its side (owner, 2026-11-04)

- "Van - workshop service" (south of containers 03/04; the owner called it the bus) leaned
  43° and now lies flat on its right side, moved 1.5 map units east so it clears the
  scrap island west of it. Changed in the repo's `junkyard_v2.blend` and
  `junkyard_v2_baked.blend` alike (no re-bake needed: the bake is colour only), then
  exported, map-only compress (`assets/build/maps/junkyard.glb`, not `pnpm assets`),
  metrics, the brain raster and fixtures re-made. The collide-reverse fixture starts at
  (16, 19) (was 18) so all three legs still bump. Add it again if the owner sends a new yard.
  Before/after: `previews/van-on-side.png`.

## The Leaper's sight and search (owner, 2026-10-30)

- **Sight 50 map units** (was 19.3; yard about 78 x 73): `COMBAT.sightRange` in
  `src/config/combat.js`, for the eye-level sight and the ground search sweep,
  sent to the brain session as `sight_range`. The laser matches it. The owner
  approved this one exception to the frozen rules: weights and the 16 wall rays
  are unchanged (the rays still report at the trained 28 world units), and the
  fixtures still run at 28. Only the browser brain reads it: `pnpm play`'s Python
  server ignores `sight_range` and stays at 19.3.
- **Investigate:** a bullet from out of sight (brain and eye both blind to her)
  sends it from Search or Chase to Investigate: the brain pauses, it turns and
  walks a route to where the shot came from (`walkToShot` in `LeaperActor`,
  `JunkyardNavigation.walkRoute`, numbers in `LEAPER_BEHAVIOUR.investigate`), then
  the brain carries on from there. Scripted, so no retraining and no new inputs.
  The route ends at the nearest spot its eye can see the shot's spot from
  (`LeaperActor.seesFrom`, owner 2026-11-02): the plain nearest spot was often
  the far side of a container wall, 58% seeing her against 96% measured.

## Lola down, gun kick (owner, 2026-10-30)

- **Defeat (changed 2026-11-02):** she falls on her face, or a side if the ground
  there is blocked, never on her back: her face has no eyes drawn, so it must
  stay unseen (`LolaPlayer.pickFall`, `LOLA_FALL`). A big shake as it happens
  (`COMBAT.cameraShake.lolaDown`, `lolaDownJolt`), and the camera tips down and
  swings round so she lies across the screen under the box (`CAMERA.defeat`). No
  authored clip: one from the owner would replace it. Her pose goes slack as she
  falls (spine straight, arms at her sides, hand gun hidden: `LolaAnimator.limp`);
  without that her head and arms sat 0.4 map units under the floor. `LOLA_FALL`
  tip 86° and lift 0.26 were measured so every part clears the ground.
- **Running jump legs (owner, 2026-11-03):** in the forward clips (29 and 30, 27
  and 28 in `Lola All Animations.blend`) the legs snap together and apart in the
  air, frames 10-20. The game glides them between frames 9 and 21
  (`steadyLegs` in `RUN_JUMPS`, `LolaAssets.js`); the Blender file is unchanged.
- **Standing jump gun (owner, 2026-11-02):** the plain jump clip is "Jump Shoot"
  and raises the gun, so her arms and the carried gun stay Idle's over the jump's
  legs (`steadyArms` in `LolaAssets.js`, used in `LolaAnimator.pose`). Strafing
  jumps use the same clip; running jumps keep their own guns.
- **Shake (owner, 2026-11-02):** shooting shakes a little less (M416 roll 0.026,
  push 0.24; pistol 0.04, 0.4; pitch and spray unchanged); each bullet landing on
  the Leaper adds `COMBAT.hitJolt` (tilt and jolt back only, so the aim never
  moves); a leg coming off stays the bigger `cameraShake.bigHit`.
- **First-person kick:** `gunKick` per gun in `src/config/weapons.js`; only the
  drawn picture moves (`src/weapons/GunKick.js`), aim and bullets never do.

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
  `C:\Blender`; never modify them.
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

## One gun, her dropped gun, laser and hit feedback (owner, 2026-11-02)

- **M416 only, "for now":** `WEAPON_SLOTS` in `src/config/weapons.js` is `['m416']`.
  Gun keys 1 / 2, SWITCH, gamepad Y, the second HUD circle, the number tags and the
  holstered pistol are gone. The pistol's data, model and clips are still loaded
  (`OUTFIT_WEAPONS`, `LolaPlayer.switchWeapon`): bringing it back means restoring
  that list and the controls, not rebuilding it. Removing it for good would also
  shorten the download.
- **Dropped gun:** when she falls, a copy of the gun in her hands drops and lies flat
  beside her until the next fight (`src/actors/lola/DroppedGun.js`, gun numbers in
  `LOLA_FALL`).
- **Laser:** was 3.5 cm thick, dark and fading, and a close bolt landed before it
  was drawn. Now `laserRadius` 0.03, bright red. A shot is one line growing from
  the eye to its tip (a short bolt followed by a line read as two shots: owner),
  which thins away over `beamTime` 0.18 s where it ended (`LeaperCombat.beams`).
- **Charge sound:** `leaperCharge` is the owner's pick B, the Leaper's laser backwards
  (`previews/charge-sounds.html`; C, a deep power-up, was tried in play and dropped;
  the old hum "sounded like something vibrating"). Made by hand, not `pnpm assets`.
  Gain 0.63 equals the hum at 0.33, 1.5x its first 0.22 (0.9 was far too much).
- **Bolt hit on Lola:** sparks off her body and a view jolt (`COMBAT.lolaHit`), a
  burst of the red screen edges (`HIT_EDGE` in `PlayerVitals`) and a red arc on a
  ring round the screen pointing at where it came from (`Hud.showHitMark`), so a
  shot from out of view still says where.

## The Leaper walks over low junk (owner, 2026-11-02)

- 36 low props (split tires, broken poles, small scrap, the torn container side, the
  fallen signboard), each approved from marked pictures, are listed as boxes in
  `src/world/stepOverProps.js` and left out of its walking map only: the brain's raster
  (`stepOver`, built in the worker instead of the baked file) and the route grid. So no
  retraining: the brain simply reads open floor there. Lola's grid, bullets and every
  sight line keep them (owner: "it is still a solid object, it should not see through
  it"), though its eye, 2.4 world units up, can look down over one from close by.
- The scrap and pole wedged between the green and brown skips (-31, -11) stay in: the
  owner does not want it near the skips, which stay solid like every container.
- Feet: `LeaperSimulation.startStep` lands on top (`world.leaperFootHeight`, Lola's grid)
  and lifts high enough to clear what lies under the step. Re-measure the boxes if the
  owner sends a new yard. `metrics.json` was re-baked (`bake-junkyard-metrics.mjs`).

## The Leaper keeps moving (owner, 2026-11-02)

- A close Leaper (within `engage.enterDistance`) stands and shoots, then walks. It stood
  frozen 60-70% of a fight at `maxHoldTime` 6 / `repositionTime` 2.5, and every stagger
  restarted the clock, so shooting its legs pinned it. Now 2.5 and 3 (it fires as it
  walks), and `heldTime` adds up across staggers. A knocked-down Leaper still cannot move.

## Sprint and Lola badly hurt (owner, 2026-11-02)

- **Health panel:** her name LOLA and the bar only (`VitalsView`); the HIT word and
  then the number were taken out (owner, 2026-11-04).

- **Sprint 10% faster:** `LOLA_PACE.sprint` 3.565 -> 3.92 (the owner said "swift":
  taken to mean the sprint. 20% was tried first and halved; her run is unchanged).
- **All on the health the player sees** (`COMBAT.lolaHurt`, `PlayerVitals.updateHurt`):
  under 20 she pants (first 25) and the screen edges stay slightly red (`hurtEdge`); under 10
  her sight blurs and she hunches as she runs (15 was tried); health back eases it off,
  gone at 20. Falling from above stays clear until under 10. Fades 1.5 s
  in, 2.5 s out. One number, `weakness` (0..1), drives both.
- **Panting in runs (owner, 2026-11-04: nonstop was distracting):** 1-3 breaths 0.85-1.1 s
  apart, then a 2.5-4.5 s rest, all random (`breathRun`, `breathEvery`, `breathRest` in
  `COMBAT.lolaHurt`).
- **Panting:** `lolaPant`, seven breaths (each a breath in and out, the breath in raised
  9 dB) cut from `assets/audio/sources/owner/lola-panting-2026-11-02.ogg` by hand with
  ffmpeg, not `pnpm assets`. Then roughened (owner: "way too soft"): more upper
  range, soft clipping, a 47 Hz flutter. Gain 0.24 running, x `standingVolume` 0.45
  otherwise (the owner lowered both).
- **Blur:** in the final picture (`blurred` in `src/core/postprocessing.js`, 12 taps, only
  while hurt), `engine.setBlur`; without the glow pass (low quality) a CSS blur.
- **Hunch:** `LOLA_HUNCH`, added to the spine like a flinch.

## Darker yard and pole lamps (owner, 2026-11-02)

- **Darker, not dark:** sky, fog and lights in `JUNKYARD_ATMOSPHERE`
  (`src/world/junkyardAtmosphere.js`): fill 0.42, sun 0.6, rim 0.08 (were 0.95,
  1.25, 0.16).
- **Lamps:** all five standing poles have a glowing bulb; only the 2 nearest Lola
  are real lights, without shadows, fading across as she moves
  (`src/world/yardLamps.js`, `lamps.slots`). Measured at 1920 x 1080 high quality
  with no frame limit, readings noisy: AMD chip about 62-82 fps with no lamp light,
  55-64 with 2, 55-60 with all 5 (and 5 fell below 60 everywhere); RTX 3050 no
  measurable change with 5 (about 240 fps).
- **Title music only plays in the focused window** (`GameUi.lateUpdate`): a game
  tab left on its title (the app's hidden preview pane counts as visible) played
  it under the real game. Close preview tabs after use.

## Open items

- **Sounds the owner still needs:** a sound for a cut-off leg piece landing
  (no slot yet). See `src/audio/sounds.json`. Lola's `lolaHurt` grunts are the
  owner's own voice (2026-10-22): four takes cut from
  `assets/audio/sources/owner/lola-grunts-2026-10-22.ogg` with the breaths left
  out (owner: "remove any inhaling sounds"), never the same take twice in a row.
  The low-health scream was removed (owner, 2026-11-03: it sounded like an
  animal); she uses the same grunts at any health.
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
  grunts were raised to gain 0.65 in `src/audio/sounds.json`.
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
- **Performance stats (owner, 2026-10-30):** under the FPS, FRAME and CPU (both
  median ms over 0.5 s; `src/ui/FpsCounter.js`), on by default, for players
  too; SETTINGS > GRAPHICS > Show performance stats turns them off (`showPerf`).
  CPU covers the main thread's frame (game code plus draw calls), not the
  Leaper's brain, which runs in its own worker. With developer tools the box
  sits below the VIEW button.
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
  Grit and pebbles baked too (owner, 2026-10-30): one seamless tile
  (`BAKE.fine` in `src/world/junkyardSurfaces.js`, 2048 px per 16 map units)
  repeats across floor and walls. On the AMD chip the ground went from 4.2 to
  1.5 ms and the worst 5% of frames from 32 to 17 ms. "CPU" from the owner
  means the processor with its built-in graphics: judge speed on that chip.
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
  Raised again (owner, 2026-10-30: "more recoil", "more camera shake"):
  M416 pitch 0.024, yawJitter 0.01, roll 0.032, push 0.3; pistol pitch 0.06,
  yawJitter 0.012, roll 0.05, push 0.5; `CAMERA.recoilPushMax` 0.25 -> 0.7.
- **Lola's health (owner, 2026-10-22: "+20%"):** really 120 (was 100;
  `COMBAT.lolaHealth` in `src/config/combat.js`), but the player always sees
  it out of 100 (`lolaHealthShown`; owner: "120 looks weird, we are upping the
  value of 100, not the number"): a bolt shows as about 7, DAMAGE TAKEN too.
  The low-health warning moved with it to 24 real (still 20%).
- **End words (owner, 2026-11-04):** YOU WIN / YOU LOSE on the end screen
  (`endSummary` in `src/ui/screens.js`) and the fight-screen banner (`resultText` in
  `src/game/Encounter.js`); were VICTORY / DEFEAT and LEAPER / LOLA DEFEATED.
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
  fail: the weak-point shot in `tests/browser-combat.js`, the stomp set-up in
  `tests/leaper-behaviour.js` (it places Lola from the Leaper's spot before a
  reset, and each reset now picks a new random start), and the loading-progress check in
  `tests/brain-game.html`.
- **History:** `docs/How-the-Leaper-Works.pdf` was pushed by mistake and then
  removed; it is still in the branch history. The owner keeps it locally and
  does not want it in the repository.

## RL lab

**Moving-target retrain (2026-11-05/06):** runs A and D (copies of today's
brain on a moving, hiding Lola; `rl/moving_target*.py`) helped little. The
owner rejected a route arrow as input ("she needs a brain of her own"); the
next step is round 1 of `docs/MOVING_TARGET_RUN_LIST_2026-11-06.md`
(scorecard changes, a big random obstacle arena, real-yard rounds, a critic
that sees the truth), handed to another machine via
`docs/MOVING_TARGET_HANDOFF_2026-11-06.md`. Run A is the baseline.

The PPO_29 normalized-throttle task this file used to describe is done; runs
continued to PPO_35. Start from `AGENTS.md` Part 2 and
`docs/SEEKER_HANDOFF.md`. Generated artifacts in `rl_artifacts/` stay
git-ignored and are never overwritten.
