# The Leaper brain in the browser (no Python)

This folder runs the frozen 7,757,824-step Leaper brain entirely in the page:
the world rules it was trained with (what it "sees" and how one step moves it)
and the saved network, in a Web Worker. It answers the same `reset` / `step` /
`sense` / `sync` / `close` requests as `rl/junkyard_server.py`, with the same
frames, and it is **proven** to behave like the Python server (see "How we
know it matches").

It is the game's default brain: `src/simulation/JunkyardBrain.js` asks a
BrainProvider (`src/brain/BrainProvider.js`) for every move, and the default
chain tries this in-browser brain first, the Python server second and turret
mode last (see "In the game").

## Files

| File | What it does |
|---|---|
| `../BrainProvider.js` | The provider interface every brain implements, the fallback chain (ONNX -> Python server -> turret), `?brain=` parsing and the loading-progress wording. |
| `../HttpBrainProvider.js` | The Python service over HTTP (the reference): health check, the five requests, `/close` beacons on `pagehide`. |
| `OnnxBrainProvider.js` | Page-side API: `load()`, `prepare(width)`, `reset` / `step` / `sense` / `sync(payload)`, `close(token)`, `request(path, payload)`, `onProgress(listener)`, `dispose()` (terminates the worker). |
| `brainWorker.js` | The Web Worker entry: sets up self-hosted onnxruntime wasm, then hands messages to `brainHost.js`. |
| `brainHost.js` | Everything the worker does (download with progress, load, build rasters, queue requests) without browser-only wiring, so Node tests run the same code. |
| `brainSession.js` | Port of `BrainSession` and the server's request checks (`/reset`, `/step`, `/sense`, `/sync`, `/close`, tokens, error messages). |
| `frozenEnv.js` | Port of the frozen recipe (`rl/frozen_7757824/`) plus `rl/junkyard_env.py`: 34 inputs, 16 rays, sight memory, coverage grid, frontier note, movement feedback, 19-disc physics with signed reverse and turn/move recovery, player-contact discs. |
| `collisionRaster.js` | Port of `rl/junkyard_geometry.py` (the 0.1-unit collision grid) plus the baked `.bin` file format. |
| `junkyardSight.js` | Port of `rl/junkyard_sight.py`: reads the GLB triangles and traces the three eye lines (with a grid so it only tests nearby triangles). |
| `onnxPolicy.js` | Runs `public/brains/leaper_7757824/actor.onnx` (LSTM memory in and out). |
| `pyMath.js` | Python/NumPy arithmetic JavaScript lacks: float32 rounding, Python `%`/`//`, exact FMA, CPython `math.hypot`. |
| `junkyardWorld.js` | Builds the raster + sight for one Leaper width (reports build progress). |
| `fixtureReplay.js` | Replays the Python recordings and lists every difference (used by the tests). |
| `round1Inputs.js` | Opt-in round-1 brains only: inputs 34-37 (I1 motion note, I2 not there), ported from the training code (see "Round-1 brains"). |

Round-1 opt-in brains: `scripts/export_round1_brain_onnx.py`, `scripts/make_round1_fixtures.py`,
`rl/round1_session.py` (see "Round-1 brains").

Python side (oracle, read-only): `scripts/export_brain_onnx.py` (ONNX + `brain.json`
+ 1,200-step parity proof), `scripts/make_junkyard_fixtures.py` (recordings in
`tests/fixtures/brain/`), `scripts/bake_junkyard_raster.py` (`raster-5.5.bin`),
`scripts/make_sync_fixture.py` (pose-sync recordings `tests/fixtures/brain/sync-*.json`).

## Using it

```js
import { OnnxBrainProvider } from '../brain/junkyard/OnnxBrainProvider.js';

const brain = new OnnxBrainProvider();          // files from /brains/leaper_7757824/
brain.onProgress((p) => console.log(p.task, p.label, p.fraction));   // optional
await brain.load();                             // optional; first request loads too
await brain.prepare(width);                     // optional; loads/builds that size's raster
const frame = await brain.reset({ width, position: [x, z], yaw, target: [lx, lz],
  player_collision: true, sight_mode: 'eye', sight_pose });   // same body as POST /reset
// Optional sight_range (world units): how far it sees Lola and searches; the 16
// wall rays stay at 28. Browser brain only; the Python server ignores it.
// Game only: new OnnxBrainProvider({ stepOver }) leaves low junk out of its walking map.
const next = await brain.step({ token: frame.token, target: [lx, lz], sight_pose });
const preview = await brain.sense({ token: frame.token, target: [lx, lz], sight_pose });
const landed = await brain.sync({ token: frame.token, position: [x2, z2], yaw: yaw2,
  target: [lx, lz], sight_pose });             // game logic moved the Leaper (a leap)
await brain.close(frame.token);
brain.dispose();                                // stops the worker
```

`brain.request(path, payload)` has exactly the shape of `JunkyardBrain.request`
(resolves to the frame, throws `Error(message)` with the server's wording, e.g.
`Session expired. Reset Leaper to reconnect`). Failures that mean "this brain
cannot answer at all" (no worker, files missing, the worker died) carry
`error.unavailable = true`; that is what makes the chain fall back.

**Frame contract** (identical keys to `BrainSession.snapshot()`): `x, z, yaw, step,
model_step, distance, collision, collisionPart, target_visible, target_ever_seen,
throttle, turn, vision[16], memory_age, caught, sight_mode, sight_visible,
sight_version, contact_version, sight` (`{origin, points, hits, clear, in_view}`
in eye mode, `null` in legacy mode); reset frames add `token` and
`policy_sha256`. After a request, `brain.stats` holds timings and
`brain.lastWorld` says whether the raster was baked or built.

## In the game

**Which brain answers.** `createGameBrainProvider()` (in `JunkyardBrain.js`)
builds the chain from `?brain=` in the page address:

| `?brain=` | Tried in order |
|---|---|
| (none) / `auto` | ONNX in this page, then the Python server (`?brainUrl=` / `VITE_BRAIN_URL`, default `http://127.0.0.1:8767`) |
| `onnx` | ONNX only |
| `http` | the Python server only (the parity reference) |
| `turret` | nothing: turret mode, to test it |

The first provider whose `load()` succeeds answers everything; when none
does, turret mode refuses every request with the reasons, and the game plays
on with the Leaper planted (it still shoots) and retries every 5 s of a run.
A *refused* request (a start inside a wreck, a bad body) never falls back:
another brain would refuse it the same way. OPTIONS has the same four
choices as a menu ("Brain", turret mode included); it shows what the address
picks (aliases such as `?brain=python` too), keeps a new choice in the
address and restarts the run.

**What the player sees.** The badge names the provider:
`BRAIN 7,757,824 · ONNX · IN BROWSER · SEARCHING`, `… · PYTHON SERVER · …`,
or `BRAIN OFFLINE · TURRET MODE`; its tooltip says more (the policy SHA256,
the server address, or why nothing loaded). While loading, the boot status
line shows the worker's progress next to the map and Lola
(`LOADING LOLA… · LOADING BRAIN · ONNX · IN BROWSER · 64% · DOWNLOADING BRAIN RUNTIME`),
then the badge shows it (`PREPARING LEAPER SIZE 6.5 · … · 52% · BUILDING COLLISION MAP`).
The Python server cannot report its progress, so its first reset at a size
this page has not used shows a wait with no percentage
(`PREPARING LEAPER SIZE 6.5 · PYTHON SERVER · WAITING FOR THE PYTHON SERVER (A NEW SIZE CAN TAKE ~30 S)`).
The badge is redrawn once per frame, so a very slow page may skip some steps.

**Loading and sizes.** The mode starts the worker before the map loads and
calls `prepare(width)` as soon as the size is known, so the first reset is
instant. The default size (5.5) uses the baked `raster-5.5.bin` (27 KB); any
other size downloads `collision.json` once and builds its raster in the
worker (~0.7 s here), with progress, while the page keeps running. The
onnxruntime `.wasm` (14 MB, the biggest download) is fetched by the worker
itself so its progress shows, then handed to onnxruntime (`env.wasm.wasmBinary`).

**Lifecycle.** RESET (and every new episode) closes the previous session;
leaving the page sends `/close` beacons for the HTTP sessions still open;
`JunkyardBrain.dispose()` (the mode's `dispose`) closes the last session and
disposes the provider, which terminates the worker. A worker that crashes
fails its waiting requests as "unavailable" and is replaced on the next request.

**Moving the Leaper between moves (pose sync, for the leap).** Game logic
must never edit how the brain observes or moves. To put the Leaper somewhere
else between two brain moves, use:

- `encounter.teleportLeaper(enemy, { x, z, yaw })`: stands the animator at the
  pose and syncs the brain; resolves with the brain's frame there; rejects (and
  puts the Leaper back) if the brain refuses the spot;
- or `brain.syncPose({ x, z, yaw })` directly: the Leaper is shown and blocks
  Lola at the new spot at once; the sync is sent before the next move (after a
  move already in flight, whose old-spot reply is not shown); without a brain
  session (turret mode) it only moves the planted Leaper. A RESET (a new
  episode) before a waiting sync is sent rejects that sync instead of moving
  the fresh episode back to the old spot.

Both providers implement it the same way (`brainSession.js` `sync()`, Python
`BrainSession.sync` behind `POST /sync`): refuse a pose whose body or leg discs
overlap the junkyard; set the float32 position and the heading wrapped to
[-pi, pi); look from there (sight memory without ageing it, then search
coverage); recompute the next input with the unchanged observation code,
keeping the last move's feedback (inputs 31-33). The step count, LSTM memory
and last action are kept: a sync is not a new episode. While a leap animates,
game logic decides whether the brain keeps stepping (`brain.stop()` /
`brain.start()`), then syncs at the landing spot.

The Leaper's behaviour layer (`src/actors/leaper/README.md`) does exactly
that: it pauses the brain outside Search and Chase, syncs the landing pose
during the leap's crouch (a refusal, or a sync that fails for any reason,
calls the leap off and the take-off pose is synced back), syncs again on
landing, and syncs the heading after a turn in place. It also animates the
rig itself (`JunkyardBrain.drivesAnimator = false`).

**Severed legs (contact rules v4, review fix 5.19).** `/reset`, `/step`,
`/sense` and `/sync` may carry `disabled_legs`: the indices (0-5, the order of
`legAngles` in `src/config/player-contact.json`) of the Leaper's shot-off legs.
Such a leg keeps only its first `severedLegPoints` disc (the stump by the hip)
in **Lola's contact**, so the brain is no longer blocked by her where the leg
used to be, and the page lets her walk into that gap (`playerContact.js`). It
is the junkyard's Lola-contact rule only: the frozen recipe's 19 map-collision
discs and every input the brain sees are unchanged, and a request without the
field behaves exactly as v3. `JunkyardBrain` sends the rig's severed legs with
every request; `scripted-severed-legs-5.5.json` proves both sides agree bit for bit.

**Soft episode restart (review fix 5.12, an experiment, OFF).** See "Soft
restart experiment" below for what it does and how it measured;
`ENCOUNTER.brainSoftRestart` in `src/config/encounter.js`, `?softRestart=1 / 0`
to compare.

## Round-1 brains (opt-in, 38 inputs)

A retrained brain from the round-1/2 lab runs (`rl/round1_train.py`, e.g. F7GLSD) can be
tried in the game **without touching today's brain**, which stays the default:

    http://localhost:5173/?brain=leaper_r1_10002464      (pnpm dev; the folder's name)
    http://localhost:5173/?brain=leaper_r1_4005904       (same run at 4M: smoother chase, see below)
    http://localhost:5173/?brain=leaper_r1_7004176       (4M + 3M with a backing-up charge, see below)

`?brain=` takes the folder name under `public/brains/` (strict pattern `leaper_r1_<digits>`).
Two round-1 brains ship (2026-11-17), both from run F7GLSDP and both opt-in: `leaper_r1_10002464` (try 1 @10M,
the pick: stuck 4-5% vs today's 18-20%, best at finding her again) and `leaper_r1_4005904` (try 2 @4M: stuck 8-9%,
chases like today's brain; the 10M brain learned a forward/back shuffle between 4M and 10M that halves how far its
walking actually closes on her). Third (2026-11-17 04:10 IST): `leaper_r1_7004176` = F7GLSDP4C try 2 @7M, the 4M brain trained 3M more steps on
the same practice plus a charge for backing up when nothing is in the way (rl/round1_env.py reverse_cost): chases like
today's brain, walks to where it lost her nearly as well as the 10M brain, clear shot 77-79%, stuck ~11% (600 rounds).
Details: rl_artifacts/moving_target_round1_20261115/TODO.md (in the Hugging Face bucket).
It runs in the page only: the Python server only has today's brain, so it is never a
fallback (if the folder cannot load, the game goes to turret mode and says why). The badge
reads `BRAIN R1 10,002,464 · ONNX · IN BROWSER · …` (brain.json `label`). The OPTIONS brain
menu shows "ONNX" meanwhile; picking another entry there switches back to today's brain.
Legacy flat sight (`?vision=legacy`) is refused: I2 needs the eye-line test.

**Making one** (inference only; `.venv` has no onnx, so it comes from `tmp/onnx-pylib`):

    PYTHONPATH=tmp/onnx-pylib .venv/bin/python scripts/export_round1_brain_onnx.py \
        --model rl_artifacts/moving_target_round1_20261115/run_F7GLSDP_try1/model_10002464.zip \
        --run F7GLSDP --out public/brains/leaper_r1_10002464/
    .venv/bin/python scripts/make_round1_fixtures.py --model <same zip> --run F7GLSD \
        --brain public/brains/leaper_r1_10002464      # then: node --test tests/brain-round1.test.js

The export refuses fusion/window runs and anything but 38 actor inputs (I1 and I2 on), keeps
the actor only (a B1 checkpoint's 4 critic-only inputs are not in the file: `obs[1, 38]`),
proves ONNX against `model.predict` on real yard rounds (`Round1YardEnv`, 8,000+ steps), writes
`brain.json` (`obs_size: 38`, `round1_inputs`, `search_range`) and copies today's
`raster-5.5.bin` (read only).

**The two extra inputs** (`round1Inputs.js`, Python oracle `rl/round1_session.py`):

| Input | Meaning | Training code |
|---|---|---|
| 34-35 | I1: x/z direction Lola moved between the last two brain steps on which she was seen | `MovingTargetMixin.step` |
| 36 | I1: that speed / her sprint step (0.929 units at 5.5), at most 1 | same |
| 37 | I2: 1 if she was seen, is not visible now, the spot where it last saw her is in its 270° view, in sight range and an eye line to her head/chest/hips standing there is clear, and she is more than 4 units from it | `Round1Mixin._not_there`, `Round1YardEnv._spot_in_sight` |

When: training looks at Lola once per step; the session looks twice per `/step` (the live
refresh before inference, then after the move, with the same Lola position). **I1 updates once
per `/step`, at the refresh before inference** (the look that fills input 0 of what the policy
is fed), so the note's newer end is Lola's newest position and two sightings are one step
apart, as in training. The look after the move, `/sync` and `/sense` never update it. At reset
the note is zero and Lola at reset counts as the first sighting if seen. I2 is recomputed from
the same refreshed state. After a move inputs 34-37 keep what the policy was just fed (the
next refresh redoes them); a sync keeps 31-37. I2 uses Lola's true position (the request's
`target`), the fixed eye offset (`eye-vision.json`, = Python's `EYE`) and fixed body heights
(0.9/0.7/0.53 x 1.7 map units x world scale), not her animated bones; its reach is the
session's `sight_range` (the game's 50 map units = training's `SIGHT_RANGE`). SPRINT_STEP and
the body heights scale with the Leaper size (bit-identical to Python at 5.5, the only size
these brains were trained at). The search sweep (inputs 26-30) uses `search_range` 28 for these
brains, as in training (`GameExamEnv` only lengthens Lola's sight; measured: 0 of 2,000 training
steps differ at 28, 334 would at the game's 50 map units); today's brain keeps sweeping at
`sight_range`. Delete `search_range` from a brain.json to sweep at the game's range instead
(then re-record its fixtures).

**How we know it matches** (`tests/brain-round1.test.js`, recordings in `tests/fixtures/brain-r1/`):
2,002 I1/I2 values recorded straight from `Round1YardEnv` yard rounds (534 with I2 = 1) are
reproduced bit for bit by the JS functions; two session recordings (500 brain steps, 360
scripted steps; I2 = 1 on 26 and 64 steps, I1 changing 140 and 66 times) replay with all 38
inputs, the pose, the I1 memory and every yes/no fact bit-identical, teacher-forced and free
running with the recorded actions; the r1 `actor.onnx` gives the checkpoint's action within
1.1e-6 and memory within 2.9e-6 on all 500 recorded steps; the worker code loads the folder and
answers 60 moves like the recording; `JunkyardBrain` (the game's brain driver) loads the folder,
passes its identity check, shows `BRAIN R1 …` and moves, and still shows `BRAIN 7,757,824` with
today's folder. Free running with the ONNX network it stays in lockstep for 286 of 500 steps
(the same ~1e-6 rounding drift as today's brain, see below). Not yet run in a real browser.

## How we know it matches

- `tests/brain-raster.test.js`: the JavaScript raster is bit-identical to the
  Python one at widths 2.9, 5.5 and 7.98, and to the baked file; the GLB
  triangles are bit-identical to `load_triangles`; and 1,200 eye lines recorded
  from Python's `JunkyardSight.hit` (`sight-lines-5.5.json`, half of them aimed
  exactly at triangle edges and corners) give the same hit / no-hit and the
  same hit point to the last bit.
- `tests/brain-parity.test.js`: 1,970 recorded steps (7 runs: three widths, eye
  and legacy sight, hidden/seen/memory, every collision part, reverse, player
  contact, 26 paused previews). Teacher-forced, the 34 inputs and the next pose
  are bit-identical and there are zero yes/no flips. Driven with the recorded
  actions, the JS environment stays bit-identical for every step of every run.
- `tests/brain-onnx.test.js`: the ONNX file gives the checkpoint's action within
  1e-6 and LSTM memory within 2e-6 on all 1,600 recorded policy steps.
- `tests/brain-provider.test.js`: the provider and worker code end to end in Node.
- `tests/brain-pymath.test.js`: the Python-arithmetic helpers against values
  printed by CPython (signed zeros, negatives, tiny and huge numbers).
- `tests/brain-onnx.html`: the real worker in a browser (headless Chromium):
  300 steps against the recording, plus the exact teacher-forced replay.
- `tests/brain-provider-contract.test.js`: the same contract for both providers
  (the worker code, and the HTTP client against a stand-in server): reset, 60
  moves and previews against the recording, sync, close, refusals, progress,
  crashed workers, the wire format and `pagehide` beacons; and the worker's
  progress-reporting raster build (the in-game path for every unbaked size)
  bit-identical to the Python raster at 2.9, 5.5 and 7.98. Last, the real
  providers in the game's chain: missing ONNX files fall back to the (stand-in)
  Python server, and when it stops the game goes to turret mode.
- `tests/brain-provider-sync.test.js`: the pose-sync recordings (115 moves, 4
  syncs, 2 refused syncs, eye and legacy sight) replay bit-identically: inputs,
  frames and coverage after every move and every sync.
- `tests/brain-provider-fallback.test.js`: the fallback order, retries, badge,
  tooltip, loading progress and session closing.
- `tests/brain-game.html`: the real game page with no Python server: the ONNX
  brain loads, START RUN makes the Leaper step, move and fire; the OPTIONS
  menu switches to the (absent) server, to turret mode and back. Then the game at size 6.5
  (no baked raster): the worker builds it, the loading UI shows its progress,
  and a fresh size prepared through the page's provider streams the build's
  progress while the page's own timers keep running. Last, the mode's
  `dispose()` terminates the brain worker without errors.
- `tests/brain-provider-live.test.js` (opt-in, needs the Python service):
  `LEAPER_BRAIN_URL=http://127.0.0.1:8767 node --test tests/brain-provider-live.test.js`
  sends the same recorded requests (moves, a pose sync, more moves) to the
  server and to the ONNX provider: poses within 1e-3, every yes/no fact equal,
  the sync frame identical.

**Live comparison (measured 2026-10-19, twice).** The same start (Lola 7
units ahead of the spawn) played in the real game page, once with
`?brain=http` and once with the ONNX brain, then a leap (`teleportLeaper`
back to the start, a quarter turn) and 20 more moves:

- First 60 brain moves, matched by step number: poses within 4.1e-6 (all 60
  compared), zero yes/no differences (visible, ever seen, collision, caught),
  although Lola's animated sight bones differed by up to 0.2 units between the
  two runs (only yes/no sight results reach the network). The leap's sync
  frame was identical in both.
- After the leap the two runs part (~5e-2 from the first move): the leap is
  timed by the clock, so it came after 61 moves in one run and 62 in the
  other, and the two brains' memories differ by that one move. Like for like,
  replaying the ONNX run's exact 83 requests (reset, 80 moves, the sync)
  against the Python server gave poses within 4.1e-6 for every move, before
  and after the leap, the sync frame identical and zero yes/no flips; replayed
  through the provider in Node, the frames were bit-identical to the browser's.
- On a heavily loaded machine (three headless browsers on 4 cores) one HTTP
  move timed out after 3 s; the server had still made that move, so the page
  skipped from step 18 to step 20 on its retry and stayed in step with the
  server. Matched by step number the poses agreed as above. The in-browser
  brain has no network wait, and no move timed out with it.

Free running with the ONNX network, the two runs stay in lockstep for 140-300
steps and then slowly part: the network's ~1e-6 rounding differences (ONNX
Runtime vs PyTorch kernels) nudge the pose until one ray sample lands in a
different raster cell. That is rounding, not a rule difference; PyTorch on two
different CPUs would drift the same way.

## Soft restart experiment (review fix 5.12)

**The idea.** The brain was trained on episodes that always end (at a catch,
after 60 moves without moving, or at 1,000 moves). In the game its episode
never ends, so after a while its memory is in a state training never
produced. `ENCOUNTER.brainSoftRestart` in `src/config/encounter.js` starts a fresh brain episode exactly where the Leaper stands, after
900 moves, after a catch, or after 60 moves in a row without moving.
`?softRestart=1` or `?softRestart=0` in the page address overrides the switch
for a playtest. The brain itself is unchanged.

**How it was measured (2026-10-19).** The real game page with the in-browser
brain, once with the switch off and once on, for 3 minutes of game time each
(about 1,780 brain moves). Only the drawing was switched off, so the game
runs in real time on this software-rendered machine. Lola cannot die, and
every 15 s (set A, seeds 11-15) or 20 s (set B, seeds 16-25) she moves to
the next spot of a seeded list: an open spot at least 12 units from the
Leaper and behind it (outside its 270° view), like a player running off to
hide. Both runs of a seed use the same list. A move counts as *hidden* when
the brain's first move afterwards does not see her, and as *re-acquired*
when the brain sees her again before her next move.

| 15 pairs of fights (30 fights) | Switch OFF | Switch ON |
|---|---|---|
| Hidden moves re-acquired | 70 / 131 (53%) | 87 / 136 (64%) |
| - set A (every 15 s, 5 seeds) | 23 / 55 (42%) | 32 / 56 (57%) |
| - set B (every 20 s, 10 seeds) | 47 / 76 (62%) | 55 / 80 (69%) |
| - after 100 s of play (past training's 1,000-move episodes) | 23 / 53 (43%) | 31 / 59 (53%) |
| Median time to re-acquire | 1.85 s | 1.4 s |
| Moves that see Lola (mean per fight) | 36% | 41% |
| Moves standing still (median per fight) | 10.6% | 10.4% |
| Fights with a freeze of 300+ moves (30 s or more) | 5 | 0 |
| Bolts fired | 348 | 383 |
| Fresh episodes started | - | 15 at 900 moves, 16 after 60 still moves, 0 after a catch |

Seed by seed, the switch helped in 10 fights and hurt in 5 (seeds 13, 19,
21, 24 and 25; for example seed 21 went from 7 of 9 to 3 of 9). With the
switch off, 5 fights froze for 37 to 158 s in a row: the "stops hunting" of
review 5.12. With it on no fight froze for that long, but in 4 fights the
fresh episode stopped and started much more (standing still 32-56% of the
time against 9-11% with it off); in one of them (seed 11) the "60 still
moves" trigger fired 11 times.

**Update (2026-10-20): ON, without the "still" trigger.** The owner chose
to switch it on with only the 900-move and catch triggers
(`afterStillSteps: null`), the variant suggested below. The measurement on
`junkyard_v2` follows at the end of this section.

**Decision at the time (2026-10-19): it stays OFF.** The rule was fixed before the second set
finished: switch it on by default only if, over all pairs, it re-acquires
at least 10 points more often (it did, +10.6), wins clearly seed by seed
(paired sign test p < 0.05; it was p = 0.30) and does not stand still more
(it did not). It helps on average and ends the long freezes, but a third of
the fights got worse, so it is not clearly better. Not tested: catches (Lola
moved too often to be caught), so the after-catch trigger is unmeasured.
Worth trying next: longer fights (10 minutes, as the review suggests) with
more seeds, and the same rule without the "still" trigger
(`afterStillSteps: null`).

**Measured on `junkyard_v2` (2026-10-20), soft restart ON (900 moves and
catch, no "still" trigger) vs OFF.** Headless Chromium with drawing off
(about 9 brain moves per second), Lola kept alive and moved every 20 s to an
open spot at least 12 units away behind the Leaper; seeds 11-13 for 5 minutes
and 14-15 for 4 minutes, each played both ways (10 fights, 46 minutes).

| | OFF | ON |
|---|---|---|
| Brain freezes of 10 s or more | 0 | 0 |
| Longest run of still brain moves | 0.1-2.6 s | 0.2-0.8 s |
| Brain moves standing still (per fight) | 0.8-21.5% | 0.3-4.4% |
| Hidden moves re-acquired | 22 / 61 | 19 / 62 |
| Fresh episodes started | - | 10 at 900 moves, 0 after a catch |

On this map the brain did not freeze in either mode. ON kept it from
hesitating in one fight (seed 14: 21.5% still moves OFF, 4.4% ON) and
re-acquired Lola about as often. Much of the time the visible Leaper stands
still is the Engage hold (stop, turn and shoot, up to 6 s; measured in the
4-minute fights): about half of all
standing-still time and 4-16% of each fight, by design
(`LEAPER_BEHAVIOUR.engage`).

## Performance (measured here)

| | Node 22 | Browser worker (headless Chromium) |
|---|---|---|
| One step, world rules only | 0.6-3 ms (eye sight ~1.5 ms) | ~1-2 ms |
| One ONNX inference (wasm, 1 thread) | 0.3-0.6 ms | included below |
| Step round trip (page -> worker -> page) | — | median 1.4-2.1 ms |
| Load (brain.json + 148 KB ONNX + 3 MB GLB + wasm compile) | ~0.75 s | 0.7-1.4 s |
| First reset at 5.5 (baked raster + sight grid) | — | 70-170 ms |
| Raster build in JS (any width) | 110-250 ms | 140-370 ms |
| Reset at an unbaked width (collision.json download + build) | — | 0.4-0.7 s |

The Python server needs ~30 s to build each raster and ~65 ms per step.

## Exactness notes for whoever touches this

- NumPy keeps the Leaper's position, Lola's position and the actions in
  float32 and rounds Python floats to float32 when they meet (NEP 50). Every
  `f32(...)` in `frozenEnv.js` mirrors one of those; removing any of them breaks
  bit-parity.
- The server's `/sense` stores Lola as float64 (it skips the float32 cast that
  `/step` does), so previews compute sight and distance in float64.
- OpenBLAS uses FMA for 2-element dot products (`np.linalg.norm` of a float64
  2-vector, `edge @ edge` in the raster build) and for the GLB node transform.
  `pyMath.fma` reproduces that; the raster and GLB tests would catch a machine
  whose NumPy does otherwise.
- The eye-line test sums in NumPy's order too: `np.einsum('ij,ij->i')` adds
  lanes 0 and 2 before lane 1, and `q @ direction` is an OpenBLAS gemv
  (`fma(q2, d2, fma(q0, d0, q1 * d1))`). Plain left-to-right sums moved 14% of
  hit points in the last bits.
- Sine, cosine and arctangent are the one thing JavaScript cannot copy
  exactly. Measured here (200,000 angles): V8's `Math.sin` / `Math.cos` differ
  from CPython / NumPy's by one last bit for about 3% of angles, `Math.atan2`
  for about 16%, and NumPy's float32 `arctan2` (AVX-512 SVML on Linux) is up to
  3 float32 steps (2.4e-7 rad) from the browser's value. These only reach the
  network through a yes/no test sitting exactly on an edge: a ray sample on a
  raster cell border, an eye line through a triangle edge, or Lola within
  ~2e-7 rad of the 270° view edge. Elsewhere the float32 rounding of headings
  and inputs removes them. You can see them as last-bit differences in the
  debug `sight.origin` and hit points of under 1% of eye frames.
- The Python server is not bit-reproducible across machines either: another
  CPU, Windows' maths library, NumPy without SVML or a different OpenBLAS kernel
  shifts the same last bits. "Matches the server" therefore means the same rules
  and the same float32 / float64 rounding, with these functions equal to the
  last bit or one step off.
