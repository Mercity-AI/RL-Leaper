// The sound mix, as plain designer settings: the mix buses and their limits,
// the limiter on the whole mix, how positioned sounds fade with distance, and
// where the listener sits. Each sound's own loudness, priority and takes live
// in src/audio/sounds.json; change numbers here or there, never in the engine.

export const AUDIO_CONFIG = Object.freeze({
  // ---- Mix buses ----
  // Every sound plays on one bus. level: the bus's share of the mix (0-1).
  // group: which player volume slider moves it (see AUDIO_GROUPS below).
  // maxVoices: how many sounds of this bus may play at once; when full, a new
  // sound replaces the lowest-priority (then oldest) one, or is skipped if every
  // playing one matters more.
  buses: Object.freeze({
    weapons: Object.freeze({ level: 1, group: 'sfx', maxVoices: 8 }),
    creature: Object.freeze({ level: 1, group: 'sfx', maxVoices: 8 }),
    footsteps: Object.freeze({ level: 1, group: 'sfx', maxVoices: 6 }),
    sfx: Object.freeze({ level: 1, group: 'sfx', maxVoices: 8 }),
    ui: Object.freeze({ level: 0.6, group: 'ui', maxVoices: 3 }),
    // Very low by default: a bed under the fight, not a soundtrack.
    ambience: Object.freeze({ level: 0.5, group: 'ambience', maxVoices: 2 }),
  }),

  // The most sounds playing at once across all buses (same replacement rule).
  maxVoices: 24,

  // ---- Limiter on the whole mix ----
  // A fast, hard compressor just under full scale, so a burst of rifle fire,
  // impacts and a laser at once can't distort. Threshold and knee in dB.
  limiter: Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 }),

  // ---- Sounds placed in the world (the Leaper, impacts) ----
  // Distances are map units (multiplied by the map's scale in the game).
  //   ref       full volume up to this distance
  //   max       no further fading beyond this distance
  //   rolloff   how fast it fades past ref (1 = half volume at twice ref)
  // HRTF (headphone-style 3D) on these quality presets, simple left/right panning otherwise.
  positional: Object.freeze({ ref: 6, max: 120, rolloff: 1, model: 'inverse', hrtfOn: Object.freeze(['high']) }),

  // ---- The listener (the player's ears) ----
  // It follows the camera every frame, but never further than this from Lola
  // (map units), so the high TOP view doesn't make the fight nearly silent.
  listener: Object.freeze({ maxDistanceFromPlayer: 10 }),

  // ---- Timing ----
  // A sound still waiting for its file after this long is dropped, not played late (seconds).
  staleAfter: 0.25,
  // A replaced or stopped sound fades out over this long instead of clicking (seconds).
  stopFade: 0.015,
  // Volume slider changes glide over this long (seconds), so dragging doesn't crackle.
  volumeGlide: 0.05,
});

// The player's volume sliders (settings) and the buses each one moves. The
// master slider and mute act on the whole mix.
export const AUDIO_GROUPS = Object.freeze({
  sfx: Object.freeze({ label: 'Effects', buses: Object.freeze(['weapons', 'creature', 'footsteps', 'sfx']) }),
  ambience: Object.freeze({ label: 'Music & ambience', buses: Object.freeze(['ambience']) }),
  ui: Object.freeze({ label: 'Interface', buses: Object.freeze(['ui']) }),
});
