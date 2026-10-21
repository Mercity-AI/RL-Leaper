# Sound slots

Every sound the game can play is listed in `src/audio/sounds.json` (the sound
manifest), each with its mix bus, loudness, takes and licence. A **slot** is a
sound the game already calls but that may have no recording yet: its
`variations` list is empty, and it stays silent without any download.

This note lives in `assets/audio/` (not `public/`) so it is not published with the game.

## Filling or replacing a slot

The quick way (no tools needed, good for trying a sound):

1. Put the file in `public/audio/`, for example `public/audio/lola-hurt-4.wav`
   (`.wav`, `.ogg` or `.m4a`).
2. Add a take to the sound in `src/audio/sounds.json`:
   `{ "name": "lola-hurt-4", "files": { "wav": "public/audio/lola-hurt-4.wav" }, "credits": ["<source key>"] }`
3. Add the source to `"sources"` in the same file: title, author, source URL,
   licence, attribution text and notes (`pnpm test` says what is missing).
4. Reload the game. In development (`pnpm dev`), a file that is missing, is not
   sound, or won't decode prints a warning in the browser console naming it.

The finished way (small compressed files, what the game ships):

1. Put the edited WAV in `assets/audio/` (the original download in `assets/audio/sources/`).
2. Give the take `"files": { "ogg": "assets/build/audio/<name>.ogg", "m4a": "assets/build/audio/<name>.m4a" }`
   and `"source": { "wav": "assets/audio/<name>.wav", "from": "<original>" }`.
3. Run `pnpm assets` (needs ffmpeg): it writes the Opus and AAC copies.

Several takes in one sound are picked at random so repeats don't sound copied.
Only files the manifest lists are ever downloaded.

## The slots

All of these are filled today (see `src/audio/sounds.json` for each take's source).
The Leaper's sounds play at the Leaper in 3D (its body, or its eye for the bolt
warnings) even though their callers give no position.

| Sound id | When it plays | Filled with (CC0 unless noted) |
|---|---|---|
| `kneeBreak` | A shot cuts off a piece of a Leaper leg | OGsoundFX metal impact (CC BY 4.0) |
| `gunEmpty` | Pulling the trigger with an empty magazine (both guns) | KlawyKogut empty gun shot |
| `lolaHurt` | Lola is hit by a laser bolt | **Empty** (old grunts removed 2026-10-19; needs a female voice) |
| `lolaHurtBig` | Lola is hit while at 20 HP or less | Archeos scream, first 0.55 s |
| `lolaHitThud` | Under every Lola hit, beneath the voice (two takes) | Kenney heavy punch impacts |
| `leaperCharge` | The Leaper's eye starts charging a bolt | Kenney force-field hum, swelling |
| `leaperLock` | The eye's aim locks, just before the bolt | Kenney tick and switch |
| `leaperStompWindup` | The Leaper crouches to stomp | Kenney thruster, slowed: hydraulic groan |
| `leaperStomp` | The stomp slams down | Kenney metal impact + low boom |
| `leaperLeapWindup` | The Leaper crouches to pounce | Kenney force-field hum, lower |
| `leaperLaunch` | Take-off of a leap (not called yet) | Kenney thruster + plate impact |
| `leaperLand` | The Leaper lands from a leap | Kenney plate crash + low boom |
| `leaperStagger` | A big hit knocks it off balance | Kenney metal impacts, slowed |
| `leaperDowned` | It loses too many legs and crashes down | Kenney plate crash + boom, slowed |
| `leaperCollapse` | It is destroyed and collapses | Kenney explosion crunch + slam + boom |
| `leaperJointBurst` | A leg joint bursts (with the knee-break sound) | Kenney glitches: electrical crackle |
| `leaperBoltImpact` | A bolt hits cover (not called yet: `playSlot('leaperBoltImpact', { at })`) | Kenney sci-fi metal impact |
| `uiClick` | A toolbar, menu or overlay button is pressed | Kenney interface select |
| `healthPickup` | Lola takes a health pill | Three rising bell notes, synthesised by `make-sounds.mjs` (project original) |
| `ammoPickup` | Lola takes an ammo bullet | Clicks, a thunk and a metal ring, synthesised by `make-sounds.mjs` (project original) |
| `yardAmbience` | The whole session, very quietly | Kenney low engine hum + wind made by `scripts/assets/make-sounds.mjs` |

The made sounds come from `node scripts/assets/make-sounds.mjs`, which cuts and
layers the originals in `assets/audio/sources/` (re-run it, then `pnpm assets`,
after changing a recipe).

Still to come: a separate sound for when a cut-off leg piece lands on the ground.
That needs its own slot, so ask for it to be connected once the file exists.
