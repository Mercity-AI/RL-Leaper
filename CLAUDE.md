# Claude handoff — Leaper

Read `AGENTS.md` first: Part 1 is the game, Part 2 the RL lab. The owner is a
game designer, not a programmer: explain results in plain language, ask about
creative intent, and never push, force-push or merge without their say-so.

## Where things stand (2026-10-19)

- **Working branch:** `claude/zen-davinci-ku9f5z` (pushed to
  `Mercity-AI/RL-Leaper`). It holds the code-review overhaul and the owner's
  evening requests; `main` does not have them yet. What changed for players:
  `docs/game/CHANGELOG.md`.
- **The game** runs with `pnpm dev` at http://localhost:5173/ (title screen:
  PLAY, EXPLORE, SETTINGS, CONTROLS, CREDITS). The Leaper's frozen brain
  (7,757,824 steps) runs in the browser (ONNX); it must never be retrained or
  edited in place (`AGENTS.md`, "Non-negotiables").
- **The map** is the owner's own yard, `junkyard_v2` (about 78 x 73 map units).
  Its look is procedural in Blender and is baked into one texture before export:
  the four steps are in `README.md`, "Art pipeline". Re-run them whenever the
  owner sends a new version of the yard. The owner's working files live in
  `C:\Blender\`; never modify them.
- **Owner choices to keep** (from the owner, 2026-10-19): the plain "+"
  crosshair (spread ticks, hit-marker X and OBSTRUCTED look stay off in
  `src/styles/ui/reticle.css`); leg pieces take 11-13 (knees) and 32-34 (long
  pieces) bullets; a leg cut below its lower knee walks on its stump; no
  standing leg on one side means the Leaper tips over for good. Save every
  setting the owner picks as a real default, never only in a URL.

## Open items

- **Sounds the owner still needs:** a female pain voice for Lola's `lolaHurt`
  slot (silent now; male and unclear-voiced takes were rejected) and a sound
  for a cut-off leg piece landing (no slot yet). See `src/audio/sounds.json`.
- **Animation:** the owner is making a new 3-second reload clip; swap it in
  when it arrives rather than stretching the old one.
- **Leg damage vs health:** the owner floated making lost legs cost more of the
  Leaper's health. Not done; ask before changing balance.
- **Tests:** `pnpm test` (466) is green. Three in-browser pages still stage
  scenes on the old map layout and fail: the weak-point shot in
  `tests/browser-combat.js`, a shot in `tests/leaper-behaviour.js`, and the
  loading-progress check in `tests/brain-game.html`.
- **History:** `docs/How-the-Leaper-Works.pdf` was pushed by mistake and then
  removed; it is still in the branch history. The owner keeps it locally and
  does not want it in the repository.

## RL lab

The PPO_29 normalized-throttle task this file used to describe is done; runs
continued to PPO_35. Start from `AGENTS.md` Part 2 and
`docs/SEEKER_HANDOFF.md`. Generated artifacts in `rl_artifacts/` stay
git-ignored and are never overwritten.
