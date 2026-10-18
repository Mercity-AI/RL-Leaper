### Live check with the real brain (commit be3f9fb, added during the review)

Partway through the review the branch gained commit `be3f9fb` "Include approved Leaper brain checkpoint for playback", which versions `model_7757824/` (0.91 MB, plain Git with `binary` attributes, not LFS) and removes it from `.gitignore`. Everything else in that commit is unchanged code, so all code findings still apply. This section records what was run against it.

**Python brain tests — all pass with the real checkpoint** (PyTorch 2.14 + sb3-contrib 2.9 in a scratch venv; Python 3.13):

| Test file | Result |
|---|---|
| `tests/test_junkyard_brain.py` | 4/4 pass (30.6 s), incl. "120 finite steps; actions match direct model.predict" |
| `tests/test_eye_vision.py` | 5/5 pass (35.0 s), "98,632 map triangles; 120 finite saved-policy steps" |

**Live fight in headless Chromium** (`python scripts/run_junkyard_brain.py` + Vite on port 5173, `/?map=junkyard&debug`, START RUN, Lola standing still, 90 s):

- The brain server loaded and identified itself correctly (policy SHA256 `883dade3…eb594`); the browser reported "brain ready" after 29.8 s (sandbox under heavy load).
- The Leaper saw Lola immediately, moved 13.1 units, closed from 5.8 to a minimum of 3.2 units, was in contact/collision on 27% of samples, cycled its attack states (tracking → charging → firing → cooling down), fired 2 eye bolts, and took Lola from 100 to 84 HP (first damage after 10.4 s). No console errors.
- Renderer at the end: 44 draw calls, ~21k triangles, 158 geometries, 17 textures.

**Speed — what was measured and what it means**

- Server latency per `/step` (eye-level vision on, measured from the browser): **median 91 ms, p90 121 ms, max 129 ms**, request body 360 bytes. The code comment in `JunkyardBrain.js` says ~40 ms on the owner's machine.
- The game achieved only ~0.5 brain steps/s instead of the configured `LEAPER_STEPS_PER_SECOND = 10`, and briefly showed "BRAIN SLOW · RETRYING". Cause: this sandbox renders WebGL in software at **~1.3 frames/s**, and `JunkyardBrain.update()` can issue at most one request per rendered frame while `main.js` clamps each frame's time step to 0.1 s. This number is a sandbox artefact, not something players will see on a normal GPU — but it demonstrates two real design properties:
  1. **The brain's pace is tied to the render loop.** On a slow device (or a throttled background tab) the Leaper slows down and the whole game runs in slow motion, instead of the simulation keeping a steady fixed tick. A fixed-step simulation loop (or running inference off the frame loop / in a worker) would decouple them.
  2. **The single-threaded server is close to capacity for one Leaper.** At 10 steps/s × ~91 ms per step, one session already uses most of one Python thread under load; a second Leaper (or two tabs) would halve each one's speed. In-browser inference removes both limits.
- README says "each model step is 1/30 simulated second"; the browser actually paces requests at 10 per second (`LEAPER_STEPS_PER_SECOND = 10`). Docs need updating.

**What the weights commit changes in this review**

- "A fresh clone has a frozen, harmless Leaper because the brain file is gitignored" is **fixed for anyone who installs Python 3.12+, PyTorch and sb3-contrib and runs the brain service** — downgrade from critical to high.
- Still true: the game needs a second program (Python + PyTorch; the scratch environment used here is 5.4 GB because PyPI ships the CUDA build — a CPU-only PyTorch is much smaller but still several hundred MB) running beside the browser; a public web page cannot reach `127.0.0.1:8767`, so the game still cannot be published to the web; if the service is missing or crashes, the Leaper's scripted attacks are also switched off (they are gated on `brain.ready`). The next step is unchanged: export the actor to ONNX and run it in the browser, keep the HTTP server as a development tool, and let combat run independently of brain availability.
- `policy.optimizer.pth` (600 KB, two-thirds of the commit) is only needed for training, not playback; `load_brain()` insists on it because it rebuilds a zip from a fixed file list. Dropping it from the playback copy (and from that list) would halve the checkpoint size.
