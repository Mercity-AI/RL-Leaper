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

| Sound id | When it plays |
|---|---|
| `kneeBreak` | A shot cuts off a piece of a Leaper leg |
| `gunEmpty` | Pulling the trigger with an empty magazine (both guns) |
| `lolaHurt` | Lola is hit by a laser bolt (random take) |
| `lolaHurtBig` | Lola is hit while at 20 HP or less |
| `lolaHitThud` | Under every Lola hit, beneath the voice |

Still to come: a separate sound for when a cut-off leg piece lands on the ground.
That needs its own slot, so ask for it to be connected once the file exists.
