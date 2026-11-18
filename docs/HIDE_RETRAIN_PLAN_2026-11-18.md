# Hide retrain (F7GLSDP4CH): plan, written before training (2026-11-18)

**Status (19 Nov, 03:15 IST): done. Results and what changed from this plan (the reward-redesign runs
CG / CG15 / CGD / CGH, the stopped CHL) are in `docs/HIDE_RETRAIN_WORKLOG_2026-11-18.md`.**

The designer's task (relayed 2026-11-18) names `docs/HIDE_RETRAIN_HANDOFF_2026-11-17.md`, which was never
pushed and is not in the bucket. The user said to take it from here, so this file fills in what that
handoff would have fixed (scene rules, world mix, expectations) and is the record to judge the runs by.
Anything here that the designer's handoff says differently should follow the handoff.

## The problem in one paragraph

When Lola vanishes close by, the 7M and 9M brains back away from where she vanished (about -1 unit/s;
today's brain -0.3). In practice she never stays hidden for good: a hider leaves cover after 30-60 s,
a wanderer keeps running, a hit Lola stays in cover 10-25 s. So holding back with a wide view and
shooting her when she reappears pays, and walking over to look does not. The fix is practice where
she stays hidden until she is found, so going to look is the only thing that pays.

## Switches (rl/round1_env.py and rl/hide_scenes.py), all off by default

1. `real_heights` (built): her three sight points at 1.25 / 1.03 / 0.81 map units.
2. `hide_scene` (yard worlds that play only hide scenes, like drill worlds):
   - The Leaper L stands at a game start spot and faces V, the spot where it last saw her (V is in
     its eye's sight from L, 8-25 units away).
   - She is crouched at S, 1.5-5 units (her walk) from V, hidden from its eye at L **and** from L
     moved 3 units back, left or right (turned to face S each time, the strictest test; a step the
     Leaper's body cannot make does not reveal her and is logged).
   - Winnable: some pose its body fits in, within 45 walking units of L (12 s at full speed), has an
     eye line to S within 20.3 units (a clear shot is possible). Scenes that fail are redrawn.
   - Memory at the start, as in the drills: last seen at V 1-3 s ago, moving V->S at her run speed.
   - Variants: **stay** (70%): she does not move until the scene ends. **shift** (15%): after 4-10 s
     unfound she moves quietly to another hidden spot 2-6 units away and stays. **back-off** (15%):
     when its walk to S falls under 10 units unfound, she slips to a hidden spot 3-8 units further
     from it and stays.
   - The scene ends at the first paid shot (1 s clear shot, +10, as drills) or after 30 s
     (time-out, not a failure). No `lose_cover`, no flee, no hider slip-away inside a scene.
3. `hide_arena` worlds: the same scenes in a new random arena each round, the yard's size
   (113 x 106 units), made of container-sized blocks (8.85 x 3.54 units footprint, 3.8 tall, like the
   yard's 6.1 x 2.44 map-unit containers; some 17.7 long, some bus-sized 13.7 x 5.6) and a few low
   blocks its eye sees over (1.2-1.6 tall). Same raster, rays and 3D eye sight as the yard.
4. `stay_found` (ordinary yard rounds, an extra arm only): once she is in cover after vanishing, she
   stays until the Leaper sees her again (the "she always pops back up" fix applied to normal play).

## Census before training (rl/hide_scenes.py --census)

500 scenes per world kind (yard, arena), real heights:
- hidden at the start, and after a 3-unit step back / left / right: must be 100%;
- winnable: a scripted perfect seeker (walks the shortest route to the nearest winning pose and
  looks) finds her within 20 s in at least 95%;
- she does not move: her position logged every step of every stay scene, zero displacement;
- also reported: L-V and V-S distances, walk needed to find her, set-up time per scene.

## Hide exam (rl/hide_exam.py)

100 fixed yard stay scenes (seed 96000, never used in practice), the brain's average move as the
game plays it, real heights: **found within 5 / 10 / 20 s** (its eye sees her), clear shot within
20 s, **units walked toward V in the first 5 s** (walking distance, as the drill's approach5), and
within 4 units of V in 10 s. Also 40 move-on scenes and 50 arena scenes, reported apart.

## Runs (all from F7GLSDP4C try 2 at 9,003,040, +2M steps, real heights everywhere, 2 tries each)

| Run | World mix (16) | Question |
|---|---|---|
| F7GLSDP4CH | 4 plain arena, 4 yard, 2 drills, 4 yard hide scenes, 2 arena hide scenes | The designer's run |
| F7GLSDP4CR | 4C's mix (4 plain arena, 6 yard, 6 drills) | Control: same +2M, no scenes |
| F7GLSDP4CHS | CHY + `stay_found` in its ordinary yard worlds and drills | Scenes and "stays until found" together |
| F7GLSDP4CHY | 4 plain arena, 4 yard, 2 drills, 6 yard hide scenes, no arena | Does the arena add anything? |
| F7GLSDP4CHL | CHY at learning rate 6e-5 (not the 3e-5 floor) | Is +2M at the floor too little? |
| F7GLSDP4CS | the control's mix + `stay_found`, no hide scenes | The "she always pops back up" fix alone |

Checks every 1M and at the end (rl/hide_watch.py): hide exam, chase check and steps backwards
(150-round behaviour probe, rl/chase_check.py), open-yard closure near/far, drills (100), still-target
(must stay at or above 93%; below stops the run), yard exam (stuck, clear shot).

## What we expect (pre-registered, judged on both tries)

**Revised 2026-11-18 ~18:55 UTC, before any trained checkpoint was examined** (the control F7GLSDP4CR was
training; none of its checks had been read). Two things measured after the first version changed the plan:

- The 9M start already finds her in staged hide scenes: found within 10 s 87% (yard) and 86% (arena),
  against a scripted-seeker ceiling of 98% / 94%. "+15 points within 10 s" is impossible; the staged exam
  has room only within 5 s (74%, ceiling 97%).
- The open-yard "backs away" number mixes two cases. Close-by sight-breaks where **she left its view**
  (60%: she is behind it; it walks on and turns round, re-seeing her 93% within 3 s) and where **she
  ducked behind junk in its view** (24%: the designer's case). In the second, the 9M brain re-sees her
  within 3 s 73% of the time against today's 84%, and drifts away (-0.26 u/s; today -0.16).
  (rl/chase_check.py, "ducked" and "behind".)

Against the 9M start, on the same exams with real heights:
1. **She ducked behind junk (open yard): re-seen within 3 s at least today's 84%, and speed toward the
   spot above 0** (9M: 73%, -0.26). The headline.
2. Hide exam (stay, yard): found within 5 s up by 10 points or more (9M 74%); the arena exam (new
   layouts) not below the yard result by more than 10 points.
3. Chase not worse: progress per unit walked at least 0.58, steps backwards at most 31%.
4. Drills: found within 30 s no more than 5 points below 9M.
5. Still-target at least 93% at every check; yard stuck no more than 5 points above 9M.

An arm "helps" when both tries meet 1 and 2 without breaking 3-5, **and both tries beat the control
F7GLSDP4CR at the same step on 1 and 2 by more than their intervals** (added ~19:05 UTC, before any arm
result was read: the control itself moves with +2M of training at the floor learning rate, and only the
control separates that from the scenes or `stay_found`). Final checkpoints and the three baselines get
450-round behaviour probes (seeds 90000-90449); the "ducked" numbers carry 90% intervals from resampling
whole rounds (breaks within one round are not independent). The hide exam is compared scene by scene.

Baselines (real heights, 2026-11-18, `rl_artifacts/moving_target_round1_20261115/hide_retrain_baselines/`):

| | Today | 7M | 9M |
|---|---|---|---|
| Open yard close-by / far (u/s toward the spot) | -0.29 / +0.17 | -0.99 / -0.05 | -0.87 / -0.23 |
| Chase net/path, backwards | 0.66, 28% | 0.64, 27% | 0.61, 29% |
| Drills: approach5, found30 | 3.9, 72% | 7.8, 86% | 9.7, 86% |
| Yard (300): clear shot, stuck | 72%, 16% | 77%, 9% | 78%, 9% |

## Not done without asking

The game's I2 code (`src/brain/junkyard/round1Inputs.js`) still has the old heights; a real-heights
brain needs it to read `brain.json` before it is played. Nothing is pushed or merged.
