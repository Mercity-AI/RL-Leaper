# Implementation report: the code review, one day later

For the owner. The deep code review of 2026-10-18
([LEAPER_CODE_REVIEW.md](2026-10-18-lola-first-person-aim/LEAPER_CODE_REVIEW.md))
listed 10 priorities and 41 fixes (5.1 to 5.41). This page says what happened
to each, where it lives in the code, and how to see it in the game. It is
built from the merge commits on branch `claude/zen-davinci-ku9f5z`
(`git log --merges f6e9fb9..cbf0ff7`) and a check of the code at `cbf0ff7`.

**Overall:** 9 of the 10 priorities are done and 1 is partly done. Of the 41
fixes, 38 are done and 3 are partly done. Nothing on the list is untouched.
What is left mostly needs a decision from you (see
[Owner decisions](#owner-decisions)).

**Checks at `cbf0ff7`:** `pnpm lint` 0 errors; `pnpm build`; `pnpm test`
459 pass, 0 fail (1 opt-in test skipped, 3 level-design TODOs); `pnpm
test:browser` 13/13 pages; Python brain tests 40/40 with the real checkpoint
(last run at the Leaper merge); CI on GitHub is green.

Words used below: **brain** = the frozen trained network that moves the
Leaper. **ONNX** = the file format that lets it run inside the web page.
**?dev** = add `?dev` to the game's address to get the developer drawer
(always on with `pnpm dev`).

## Top 10 priorities

| # | Priority | Status | Where | How to see it in the game |
|---|---|---|---|---|
| 1 | Safety net: tests, browser runner, CI | done | `package.json` scripts, `tests/run-browser.mjs`, `.github/workflows/ci.yml`, `eslint.config.js` | Green check marks on GitHub; `pnpm check` |
| 2 | Fix the end of the fight | done | `src/game/Encounter.js`, `src/game/JunkyardPresentation.js`, `src/actors/leaper/LeaperDirector.js` (Dying, Dead) | Win: the kill shot's tracer and sparks show, the Leaper collapses, Lola can still walk and look around |
| 3 | Leaper motion bugs (yaw whip, step clock, surging) | done | `src/core/angles.js`, `src/core/GameLoop.js` (`FixedStep`), `src/actors/leaper/SnapshotPlayout.js` | The Leaper turns without whipping round and glides instead of surging |
| 4 | Playable on someone else's computer | done | `src/brain/junkyard/` (in-browser brain), turret mode, `pnpm play`, `requirements-brain.txt` | `pnpm dev` alone gives a hunting Leaper; the DEV brain badge says ONNX · IN BROWSER |
| 5 | Trustworthy shooting | done | `src/weapons/resolveShot.js`, `src/config/camera.js`, `src/actors/lola/`, `src/ui/ReticleView.js` | Shots go forward with your back to a wall; aiming reaches the knees up close; the reticle says OBSTRUCTED |
| 6 | Leg damage rules | done | `src/config/combat.js` (`legs`), `src/actors/leaper/` (Downed), `src/config/player-contact.json` (contact v4) | Break four legs: it falls and takes 1.5x damage; Lola can walk through a severed leg's gap |
| 7 | GameFlow state machine and Encounter | done | `src/core/GameFlow.js`, `src/game/Encounter.js` | Escape freezes everything; Restart is a clean retry; the end screen says PRACTICE, TURRET MODE or DEBUG TEST |
| 8 | Licence and provenance | partly | `src/audio/sounds.json`, `CREDITS.md`, `tests/audio-licences.test.js` | CREDITS screen. Open: no code licence yet, the M416 sounds stay CC BY-NC (your call), Lola's Blender files are not in the repository |
| 9 | Merge with main, then layer refactors | done | `rl/frozen_7757824/`, `src/modes/`, `src/game/PlayerController.js`, `src/core/sunShadow.js`, `Encounter.enemies[]`; game changelog in `docs/game/CHANGELOG.md` (this pass) | The game is the default page; the lab pages are `?arena`, `?training`, `?free` |
| 10 | Brain in the browser | done | `src/brain/junkyard/`, `public/brains/leaper_7757824/` | No Python needed; parity tests show zero differences from the Python original on 1,970 recorded steps |

## Fix guide 5.1 to 5.41

| # | Problem | Status | Where | How to see it |
|---|---|---|---|---|
| 5.1 | Leaper never moves without the owner's brain service | done | `src/brain/junkyard/`, `src/brain/BrainProvider.js` | Play with no Python: the Leaper hunts |
| 5.2 | Ending erases the kill shot and freezes everything | done | `Encounter.js`, `JunkyardPresentation.js`, `CameraController.js`, Leaper Dying/Dead | Win a fight and look around |
| 5.3 | 290-degree yaw whip | done | `src/core/angles.js`, `SnapshotPlayout.js` | Long fights: no backwards spin |
| 5.4 | 4 failing Lola tests | done | `src/actors/lola/`, `tests/lola-*.test.js` | `pnpm test` |
| 5.5 | Lola fires backwards near walls | done | `src/weapons/resolveShot.js` | Back to a wall, the Leaper behind: shots go where you aim |
| 5.6 | START PLAYER after an ending traps the mouse | done | `src/game/JunkyardPanel.js` | DEV: START PLAYER after a win |
| 5.7 | Six legs shot off, the body keeps hovering | done | `src/config/combat.js` (`maxLost: 4`), Downed state | Four lost legs: it falls; one more while down keeps it down |
| 5.8 | Running while shooting looks broken | done | `src/actors/lola/` | Run and shoot: hands stay on the gun, legs steady |
| 5.9 | Touch controls freeze, no way to shoot | done | `src/ui/TouchControls.js`, `src/input/touch.js` | On a phone: FIRE, AIM, RELOAD, SWITCH, CROUCH, JUMP, PAUSE |
| 5.10 | Brain goes "offline" for unrelated reasons | done | `rl/junkyard_server.py`, in-browser brain by default | The Python server answers the game on any local port and no longer drops sessions |
| 5.11 | Offline instructions hidden; START RUN can trap the mouse | done | `src/simulation/JunkyardBrain.js`, `CameraController.js` | `?brain=turret`: the message says why and the fight still runs |
| 5.12 | Long fights drift beyond training | partly | `src/config/encounter.js` (`brainSoftRestart`, off) | `?softRestart=1`; measured, left off (see decisions) |
| 5.13 | Leaper slower than designed, machine-dependent | done | `src/simulation/JunkyardBrain.js`, `GameLoop.js` | 10 brain steps per second on any machine |
| 5.14 | Body surges 10 times a second, lurches when crippled | done | `src/actors/leaper/SnapshotPlayout.js` | Smooth walk; the limp has no stop-go |
| 5.15 | Lola sticks on angled walls | done | `src/actors/lola/CharacterMover.js` | Run along a slanted wall: she slides |
| 5.16 | Pause doesn't pause; the resume click fires | done | `src/game/PauseOverlay.js`, `CameraController.js` | Escape, then click to resume: no shot |
| 5.17 | Shadows vanish around Lola | done | `src/core/sunShadow.js` | Shadows follow Lola anywhere in the yard |
| 5.18 | M416 sounds NonCommercial, no sound credits | partly | `src/audio/sounds.json`, `CREDITS.md` | CREDITS screen. The CC BY-NC sounds stay, as you asked |
| 5.19 | Severed legs still block Lola; feet snap | done | `player-contact.json` v4, `src/simulation/LeaperLegDamage.js` | Walk through a broken leg's gap; other feet stay put |
| 5.20 | camera-player test page fails | done | `tests/camera-player.html` | `pnpm test:browser` |
| 5.21 | Floating health bar swims off the robot | done | `JunkyardPresentation.js` (late phase) | Turn the camera fast: the bar stays on the Leaper |
| 5.22 | Aiming can only look 16.6 degrees up | done | `src/config/camera.js` (aim look limits) | Aim at the upper knees up close |
| 5.23 | RESTART is not a clean retry | done | `Encounter.js` (start snapshot), `PlayerWeapon.js` | Pause, Restart: full ammo, start positions |
| 5.24 | Controls hidden, help wrong, kill cheat in player options | done | `src/ui/ControlsLegend.js`, `src/debug/DevPanel.js` | Press H; CONTROLS screen; debug tools only with `?dev` |
| 5.25 | Double-tap HUD move hijacks touch, 350 ms delay | done | `src/controls/MovableHud.js` | SETTINGS, HUD, EDIT HUD LAYOUT |
| 5.26 | HUD panels overlap | done | `src/ui/Hud.js` (one region per corner), `tests/hud-layout.browser.mjs` | Desktop and phone sizes show no overlap |
| 5.27 | Teammates can't start the game | done | default page is the game, `scripts/play.mjs`, `requirements-brain.txt` | `pnpm dev` on any computer |
| 5.28 | Python brain tests only run on the owner's PC | done | `tests/test_*.py` split, CI brain job | GitHub CI runs them with the real checkpoint |
| 5.29 | Map tests use old sizes; tire passage blocked; tire move not in a .blend | partly | `tests/junkyard-navigation.test.js`, `assets/maps/junkyard/passages.json`, `junkyard_arranged.blend` | Tires moved in the Blender file; the passage is still blocked at width 5.5 (decision) |
| 5.30 | Clearance overlay and RESTART RANDOM mislead and freeze | done | `src/world/JunkyardNavigation.js`, `src/game/ClearanceOverlay.js`, `src/world/collisionWorker.js` | DEV, OPTIONS, SHOW CLEARANCE; size slider stops at 6.5. The overlay is still a simple one-circle estimate |
| 5.31 | Leaper shoots from beyond what its brain can see | done | `src/config/combat.js`, `src/simulation/LeaperCombat.js` | It only fires within its sight range |
| 5.32 | Diagonals skate and are slow | done | `src/actors/lola/LolaLocomotion.js` | Diagonal runs blend with a hip twist |
| 5.33 | Hit flinch tears the torso from the arms | done | `src/actors/lola/LolaRig.js` (skeleton fixed at load) | Get hit: arms and gun move with her |
| 5.34 | Rifle fires slower on slow machines | done | `src/weapons/WeaponState.js`, `src/config/weapons.js` | 7 shots per second at any frame rate |
| 5.35 | Negative first time step | done | `src/core/GameLoop.js` (`clampDelta`) | `tests/game-loop.test.js` |
| 5.36 | Jump just before landing ignored | done | `src/input/InputController.js`, `src/game/PlayerController.js` | Press jump just before landing: she jumps |
| 5.37 | Firing cancels the flinch; a hit drops the gun | done | `src/actors/lola/`, `tests/lola-shooting.test.js` | Keep firing while hit: the flinch shows, the gun stays up |
| 5.38 | Wheel nudges aim; sensitivity not zoom-scaled | done | `src/config/camera.js`, `CameraController.js` | Aim: same feel at every zoom |
| 5.39 | Sound slots fail silently; internal doc ships | done | `src/audio/sounds.json`, `tests/audio-slots.test.js` | A broken sound file says so in development instead of staying silent |
| 5.40 | Hitches: shader compiles, texture uploads, 30 s size change | done | `src/simulation/GunshotEffects.js`, `src/core/Quality.js` (warm-up), brain worker | First shot has no hitch; APPLY SIZE shows progress |
| 5.41 | Accessibility snags | done | `index.html` (zoom allowed), `src/ui/SettingsScreen.js`, `src/ui/GameScreens.js`, `src/ui/Hud.js` | SETTINGS, Large text; menus don't re-trigger on Enter |

## Owner decisions

These need your call. Nothing is blocked today; each has a working default.

1. **Code licence.** There is no `LICENSE` file, so legally nobody may reuse
   the code yet. Choices: **MIT** (shortest; anyone may reuse it, even
   commercially, with credit), **Apache-2.0** (the same, plus a patent clause),
   **GPL-3.0** (anyone may reuse it, but their version must stay open source).
   The CC BY-NC M416 sounds keep their own terms whatever you pick, so the
   game as shipped stays non-commercial while they are in it.
2. **GitHub Pages.** One click in the repository: **Settings -> Pages ->
   Source: GitHub Actions**. After that every push to `main` publishes the
   game, with the walking, hunting Leaper (the brain runs in the browser; the
   Pages build was checked headless at `/RL-Leaper/`, see `docs/WEB_DEPLOY.md`).
3. **Weapon balance.** M416: 2 damage, 7 shots per second, 20-round magazine.
   Pistol: 5 damage every 0.5 s, 15 rounds. Against the Leaper's 600 health a
   kill takes about **64 s** with the M416 and **71 s** with the pistol
   (reloads included). The code calls this an owner decision of 2026-10-19;
   confirm it, or change it live in DEV -> TUNING -> Guns.
4. **Arena tightness.** At the Leaper's width of 5.5, only **1.4%** of the yard
   is reachable from its start (a cautious one-circle estimate), and the tire
   passage beside the bus is blocked (it is open only up to width 2.6). The
   widest workable size is **6.5**, so the size slider stops there. Choices:
   keep it, make the Leaper's clearance narrower, or widen passages in the
   Blender map. Three level-design TODO tests track this.
5. **Soft restart stays off.** It refreshes the brain's memory during long
   fights. Over 30 three-minute fights it helped on average but was worse in a
   third of the paired fights. Try it with `?softRestart=1`; keep it off?
6. **Lola's boots sink about 8.7 cm** into the floor in standing shots. Fixing
   it means a floor offset in the animation data or a Blender re-export (her
   Blender files are only on your PC). Fix now or later?
7. **Touch AIM is a toggle** (tap to raise the sights, tap again to lower).
   Mouse and gamepad hold to aim. Keep the toggle, or make touch hold too?
8. **The turret option in OPTIONS.** DEV -> OPTIONS -> Brain has "No brain
   (turret mode, to test it)". Keep it as a test tool?
9. **Glow and sky colours.** On medium and high quality the Leaper's eye, its
   bolts and the muzzle flashes glow, and the sky is a soft overcast gradient
   (`src/world/junkyardAtmosphere.js`). Approve the look or pick colours.
10. **Automatic quality tier.** Software rendering gets low; phones, tablets
    and machines with 4 cores or 4 GB or less get medium; everything else
    high. Players can override it in SETTINGS (and `?quality=`). Is that the
    right split?
11. **Leaper tuning** (all in DEV -> TUNING -> Leaper behaviour):
    - Engage: it stops to shoot when Lola is visible within **14 units**
      (walks again beyond 18), holds for at most **6 s**, then repositions
      for 2.5 s.
    - Downed: bullets do **1.5x** damage; it gets up after 6 s.
    - Leap: onto Lola from **9 to 20 units** away, at most every **8 s**; the
      landing shockwave hits within 7 units for 15 damage.
    - Stomp: when Lola stays within its reach plus 0.6 units for 0.8 s; a
      0.75 s red-ring warning, then 20 damage within 6 units, every 3.5 s at
      most.
12. **Tuning panel.** (a) The open drawer covers the HUD's left column: fine
    for a developer tool, or move it? (b) COPY JSON copies only the values you
    changed: enough, or do you want whole config files? (c) The Leaper's
    memory length (`awareness.memorySteps`, 120 steps) is read-only because it
    must match the brain's training: keep it locked?
13. **Lola's Blender files.** `scripts/export_lola.py` reads them from
    `C:/Blender/...` on your PC, so nobody else can re-export her. Add them to
    the repository, or keep them private?

## Known limitations

- **Landing sync, unconfirmed.** When a leap lands, `onLeapLand` in
  `src/actors/leaper/LeaperActor.js` syncs the brain before the body has
  settled, so the sync may carry a mid-air eye height. Not yet checked in a
  live fight.
- **The crippled Leaper barely leans and still leaps.** With three legs gone
  on one side it leans only about 6-7 degrees (`crippled.maxLean` 0.12
  radians), and the leap ignores lost legs, so it pounces like a healthy one.
  You want a crawl for this later.
- **The brain is in a new map.** It was trained in another arena; in the
  junkyard it may still get stuck or search poorly, and long fights can drift
  (soft restart is off).
- **Two tracks had shortened reviews.** The Leaper behaviour review stopped at
  a usage limit after six fixes, and the audio review was skipped at your
  request; both were checked at merge (tests and live fights) instead.
- **The hosted game is untried.** The in-browser brain loads from the site's
  sub-folder, but no Pages deploy has run yet. The `?arena` lab page will not
  load there.
- The Python brain server spends about 30 seconds mapping a new Leaper size
  the first time; three.js stays pinned to r128.

## Suggested next steps

1. Make decisions 1 and 2 (licence, Pages), then play the hosted copy once on
   a phone and a laptop.
2. Do a live fight with the DEV drawer open to confirm or rule out the
   landing-sync eye height.
3. Design the crippled crawl: more lean, no leaps below a leg count, a slower
   gait (behaviour layer only; the brain stays frozen).
4. Open the tire passage or adjust the yard so the Leaper can roam more than
   1.4% of it.
5. Fix Lola's boot sink once her Blender files are in the repository.
6. Decide whether pausing should hold the Leaper's eye wind-up: today a pause
   cancels it, so after RESUME the shot waits for a fresh charge (a player
   could pause repeatedly to put a shot off).
