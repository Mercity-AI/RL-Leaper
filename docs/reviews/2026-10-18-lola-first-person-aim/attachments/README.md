# Attachments for the 2026-10-18 code review

These files support `../LEAPER_CODE_REVIEW.md`. None of them has been applied to the game branch (`fix/lola-first-person-aim`); they are evidence and ready-made helpers.

| File | What it is | How to use it |
|---|---|---|
| `lola-test-fix.patch` | The fix for the 4 failing Lola tests (fix guide 5.4): moves Lola's input easing inside the 120 Hz sub-step loop (the one real frame-rate bug) and updates the 3 out-of-date tests. | In a checkout of `fix/lola-first-person-aim`: `git apply docs/reviews/2026-10-18-lola-first-person-aim/attachments/lola-test-fix.patch`, then `node --test tests/*.test.js`. Checked on `be3f9fb`: 69/69 pass. |
| `probes/probe-feel.mjs` | Measures Lola's planted-toe slip and speed per movement direction (fix guide 5.32). | Copy into the game checkout (for example `tests/probes/`) so `three` resolves, then `node tests/probes/probe-feel.mjs "$PWD"` from the game folder (the argument must be the full path of the game checkout) |
| `probes/probe-flinch.mjs` | Shows that the hit flinch moves the chest but not the hands and gun (fix guide 5.33). | Same as above. |
| `probes/handgun.mjs` | Measures how far each hand is from the gun grip while running and aiming (fix guide 5.8). | Same as above. |
| `live-brain/fight.mjs` | Plays a real brain-driven fight in headless Chromium for N seconds and prints what the Leaper did (sight, distance, bolts, damage, step rate). | Copy into the game checkout and install Playwright there (`pnpm add -D playwright`). Start `python scripts/run_junkyard_brain.py` and `pnpm dev` (port 5173), then `node fight.mjs "http://127.0.0.1:5173/?map=junkyard&debug" 90 .` |
| `live-brain/timing.mjs` | Times every brain request the game makes and the frame rate. | Same setup; `node timing.mjs eye` (or `legacy`). |
| `live-brain/RESULTS.md` | What those two scripts measured during the review on `be3f9fb`. | Read only. |

The probes were written during the review against `9b384c9`; line numbers they mention refer to that commit.
