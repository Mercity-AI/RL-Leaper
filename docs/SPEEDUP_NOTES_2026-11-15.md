# Speedup notes: training simulation, and what could carry over to the game (2026-11-15)

Kept up to date during the round 1 retrain. Training speedups are in
`rl/fast_sim.py` and `rl/fast_kernels.py`; every one gives bit-identical
observations, rewards and round endings (`tests/test_fast_sim.py`, lockstep
against the original code). Nothing in `src/` has been changed.

## Training simulation (Python), measured on one core

| Step | Plain arena | Real yard |
|---|---|---|
| Original code | 787 steps/s | 84 steps/s |
| + numpy rewrites (frontier note labelling, rays in chunks with early stop, summed-area collision reject) | 1,085 | 194 |
| + compiled kernels (numba): ray marching, disc collision, region labelling | 730 measured with the machine fully loaded by training (idle not yet measured) | 415 loaded (275 for the numpy version under the same load) |

Also: the yard's collision raster is cached on disk (first build 27 s, then 1 s).

What was tried and dropped: letting rays skip across open ground using a
"distance to the nearest solid cell" map. Exact, but slower in the cluttered
yard (the safe jump was usually one sample).

Still open in the yard: the eye-level sight test against the yard's
triangles (`JunkyardSight.hit`, about 1 ms a step). Left in numpy because a
compiled version could round differently in the last digit and, very rarely,
flip a seen/not-seen answer.

## Carries over to the game?

Where the game spends its time (CLAUDE.md, 2026-10-22): game logic is about
2 ms a frame and a slow frame rate is the drawing (graphics card). The Leaper's
brain runs in a Web Worker at 10 decisions a second
(`src/brain/junkyard/brainWorker.js`). So brain-side speedups do not raise the
frame rate; they matter only for more Leapers, faster brain rates or slow
phones. Measure before porting anything.

| Idea | Game file | Already done there? | Worth it? |
|---|---|---|---|
| Rays stop at the first solid sample; sight checks stop once the point is reached | `collisionRaster.js` `rayDistance`, `frozenEnv.js` coverage sight | Yes, both already stop early | - |
| Triangle sight through a ground grid of triangle lists | `junkyardSight.js` | Yes (buckets) | - |
| Summed-area table: skip the disc collision test when no solid cell lies under the disc's square | `collisionRaster.js` `diskBlocked` (about 32 calls a brain step) | No | Small, safe win; must keep the float32 rounding the JS port copies from numpy |
| Region labelling for the frontier note without a per-cell stack | `frozenEnv.js` `frontierNote` | No (flood fill) | Tiny in JS (a few hundred to ~1,500 cells); only if profiling shows it |
| Python brain server (`pnpm play`, `rl/junkyard_server.py`) | `rl/` | No | Could reuse `rl/fast_sim.py` as is (exact); the code review also found it computes eye sight 3 times a step |
| Sliding-window memory (round 1 experiment) | `onnxPolicy.js` | - | A cost, not a saving: 128 LSTM steps per decision, about 1 ms in the worker. Fine at 10 Hz |

## Other game systems (not measured)

`LeaperActor.seesFrom`, `JunkyardNavigation.walkRoute` and the eye sight in
`LeaperCombat`/`LeaperDirector` do sight lines and route searches on the
same yard. If any of them shows up in a profile, the same tricks apply: a
summed-area table or clearance map over the walking grid for fast "is this
area clear" questions, and early-stopping sight lines.
