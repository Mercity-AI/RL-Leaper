# Sound

Everything the game plays goes through one small sound engine. This page is
for tuning and adding sounds without reading the code.

## Where things are

| What | File |
|---|---|
| Every sound: its bus, loudness, priority, takes, files and licence | `src/audio/sounds.json` (the manifest) |
| The mix: bus levels, voice limits, limiter, 3D distances, listener | `src/audio/audioConfig.js` |
| The engine (AudioContext, buses, voices, 3D sound) | `src/audio/AudioService.js` |
| The game's calls (`fire`, `play`, `playSlot`, `step`, ...) | `src/audio/GameAudio.js` (old name: `src/simulation/LaserAudio.js`) |
| Player volume settings | `src/audio/audioSettingsSection.js` (the SETTINGS screen's AUDIO section); `src/ui/AudioSettingsView.js` is the stand-alone version for a page without that screen |
| Credits | `CREDITS.md` and the CREDITS screen (`src/ui/credits.js`, `src/ui/CreditsScreen.js`), both made from the manifest |
| Edited WAVs (build sources, never shipped) | `assets/audio/` |
| Original downloads | `assets/audio/sources/` |
| What the game downloads (Opus `.ogg` and AAC `.m4a`) | `assets/build/audio/`, written by `pnpm assets` |
| How slots work, and what fills each | `assets/audio/SOUND-SLOTS.md` |

## How a sound travels

```
recording -> its volume (gain, a little random spread) -> [3D placement]
          -> its bus (weapons, creature, footsteps, sfx, ui, ambience)
          -> master volume -> limiter -> speakers
```

- **Buses** group sounds so one slider moves them together. The player's
  sliders: *Effects* moves weapons, creature, footsteps and sfx; *Music &
  ambience* moves ambience; *Interface* moves ui; *Master* moves everything.
- **Voice limits**: each sound, each bus and the whole mix have a maximum
  number of sounds at once. When one is full, the new sound replaces the
  least important playing one (lowest `priority`, then the oldest), or is
  skipped if everything playing matters more. Warnings (the Leaper's charge,
  Lola's hurt) have high priority so gunfire never cuts them.
- **3D sound**: the Leaper's sounds, bullet impacts and joint breaks are placed
  where they happen. The ears follow the camera, but never further than 10 map
  units from Lola. High graphics quality uses HRTF (best on headphones); the
  others use simple left/right panning. Lola's own gun and footsteps stay centred.
- **Unlocking**: browsers only allow sound after a key, click, touch or (where
  the browser allows it) gamepad press, so the first one starts the engine.
  A hidden tab pauses it.

## Tuning

- A sound too loud or quiet: change its `gain` in `sounds.json` (0-1, a few
  are higher because their recording is quiet).
- A whole family too loud: the bus `level` in `audioConfig.js`.
- A 3D sound fading too fast or slow: give it `"distance": { "ref": 10 }` in
  `sounds.json` (full volume up to `ref` map units, half at twice that), or
  change the defaults in `audioConfig.js`.
- Repeats sounding copied: raise its `variation` (`pitch` and `volume`, as
  shares: 0.05 = up to 5% either way), or add another take.

## Adding or replacing a sound

See `assets/audio/SOUND-SLOTS.md`. In short: add the take (and its source,
with licence) to `sounds.json`; either drop the file in `public/audio/` to try
it, or put the WAV in `assets/audio/` and run `pnpm assets`. Then run
`node scripts/assets/build-credits.mjs` to update `CREDITS.md`. `pnpm test`
fails if a shipped file has no licence record, if credit text is missing where
a licence requires it, or if `CREDITS.md` is out of date. NonCommercial
licences are reported as notes, not failures.

The CC0 effects made for the game (Lola's hurt sounds, the Leaper's moves, the
click, the ambience) come from `node scripts/assets/make-sounds.mjs`, which cuts
and layers the originals in `assets/audio/sources/`.

## For programmers

```js
audio.play('m416');                              // centred
audio.play('leaper', { at: hitPoint });          // placed in 3D
audio.playSlot('leaperStomp');                   // placed at its manifest emitter (the Leaper)
audio.playAt('leaperBoltImpact', boltPosition);  // same as play(id, { at })
audio.step('robot', false, 1, footPosition);     // one footstep
audio.updateListener(camera, lolaPosition);      // every frame, late phase (the junkyard mode does it)
registerAudioSettings(settings, audio);          // the SETTINGS screen's audio section
```

Emitters are set once by the junkyard mode: `'leaper'` (the Leaper's body)
and `'leaperEye'` (its eye). A sound whose manifest entry names an emitter
plays there whenever the caller gives no position.
