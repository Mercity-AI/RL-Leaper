# The Leaper brain in the browser (no Python)

This folder runs the frozen 7,757,824-step Leaper brain entirely in the page:
the world rules it was trained with (what it "sees" and how one step moves it)
and the saved network, in a Web Worker. It answers the same `reset` / `step` /
`sense` requests as `rl/junkyard_server.py`, with the same frames, and it is
**proven** to behave like the Python server (see "How we know it matches").

It is not wired into the game yet. `src/simulation/JunkyardBrain.js` still calls
the Python service; switching is a one-line change (see "Using it").

## Files

| File | What it does |
|---|---|
| `OnnxBrainProvider.js` | Page-side API: `load()`, `reset(payload)`, `step(payload)`, `sense(payload)`, `request(path, payload)`, `dispose()`. Starts the worker. |
| `brainWorker.js` | The Web Worker entry: sets up self-hosted onnxruntime wasm, then hands messages to `brainHost.js`. |
| `brainHost.js` | Everything the worker does (load files, queue requests) without browser-only wiring, so Node tests run the same code. |
| `brainSession.js` | Port of `BrainSession` and the server's request checks (`/reset`, `/step`, `/sense`, tokens, error messages). |
| `frozenEnv.js` | Port of the frozen recipe (`rl/frozen_7757824/`) plus `rl/junkyard_env.py`: 34 inputs, 16 rays, sight memory, coverage grid, frontier note, movement feedback, 19-disc physics with signed reverse and turn/move recovery, player-contact discs. |
| `collisionRaster.js` | Port of `rl/junkyard_geometry.py` (the 0.1-unit collision grid) plus the baked `.bin` file format. |
| `junkyardSight.js` | Port of `rl/junkyard_sight.py`: reads the GLB triangles and traces the three eye lines (with a grid so it only tests nearby triangles). |
| `onnxPolicy.js` | Runs `public/brains/leaper_7757824/actor.onnx` (LSTM memory in and out). |
| `pyMath.js` | Python/NumPy arithmetic JavaScript lacks: float32 rounding, Python `%`/`//`, exact FMA, CPython `math.hypot`. |
| `junkyardWorld.js` | Builds the raster + sight for one Leaper width. |
| `fixtureReplay.js` | Replays the Python recordings and lists every difference (used by the tests). |

Python side (oracle, read-only): `scripts/export_brain_onnx.py` (ONNX + `brain.json`
+ 1,200-step parity proof), `scripts/make_junkyard_fixtures.py` (recordings in
`tests/fixtures/brain/`), `scripts/bake_junkyard_raster.py` (`raster-5.5.bin`).

## Using it

```js
import { OnnxBrainProvider } from '../brain/junkyard/OnnxBrainProvider.js';

const brain = new OnnxBrainProvider();          // files from /brains/leaper_7757824/
await brain.load();                             // optional; first request loads too
const frame = await brain.reset({ width, position: [x, z], yaw, target: [lx, lz],
  player_collision: true, sight_mode: 'eye', sight_pose });   // same body as POST /reset
const next = await brain.step({ token: frame.token, target: [lx, lz], sight_pose });
const preview = await brain.sense({ token: frame.token, target: [lx, lz], sight_pose });
```

`brain.request(path, payload)` has exactly the shape of `JunkyardBrain.request`
(resolves to the frame, throws `Error(message)` with the server's wording, e.g.
`Session expired. Reset Leaper to reconnect`). So in `JunkyardBrain.js` the
whole switch is: `request(path, payload) { return this.provider.request(path, payload); }`
with `this.provider = new OnnxBrainProvider()`. Keep the HTTP client behind a
flag (for example `?brain=http`) as the reference.

**Frame contract** (identical keys to `BrainSession.snapshot()`): `x, z, yaw, step,
model_step, distance, collision, collisionPart, target_visible, target_ever_seen,
throttle, turn, vision[16], memory_age, caught, sight_mode, sight_visible,
sight_version, contact_version, sight` (`{origin, points, hits, clear, in_view}`
in eye mode, `null` in legacy mode); reset frames add `token` and
`policy_sha256`. After a request, `brain.stats` holds timings and
`brain.lastWorld` says whether the raster was baked or built.

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

Free running with the ONNX network, the two runs stay in lockstep for 140-300
steps and then slowly part: the network's ~1e-6 rounding differences (ONNX
Runtime vs PyTorch kernels) nudge the pose until one ray sample lands in a
different raster cell. That is rounding, not a rule difference; PyTorch on two
different CPUs would drift the same way.

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
