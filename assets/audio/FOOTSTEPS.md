Footstep recordings supplied by the project owner (licences and credits for
each are in `src/audio/sounds.json`; the in-game credits are made from it):

- `lola-run.wav`: `816019__qubodup__fps-footsteps-loop.wav`, qubodup (CC0).
- `lola-walk.wav`: `856942__artemditkovsky__footsteps.wav`, artemditkovsky (CC0).
- `leaper-walk.wav`: six mechanical impacts from the owner's
  `812326__artninja__spider_robot_designed_walk_andor_inspired_06162025.wav`, Artninja
  (CC BY 4.0: credit Artninja and gpag1).
  Peaks selected at 0.78, 1.51, 4.25, 5.03, 6.47 and 7.21 seconds; each excerpt
  begins 70 ms before the peak, lasts 500 ms, and has a 25 ms tail fade.
  Exported as mono PCM16 at 44.1 kHz in six 550 ms slots.

Lola's original WAVs are retained unchanged here; they are build sources only.
The game loads small Opus / AAC copies (`pnpm assets`), and the walking copy
keeps only its first 5.8 seconds, because the ten impacts it plays end at 5.61 s.

Playback selects individual impacts from each recording at measured animation
contact times. All of Lola's movement uses the walking recording: ordinary
movement, strafing and crouching play 0.3 s of each impact, and Shift/sprint
plays a shorter 0.2 s cut (its faster foot contacts already speed it up). The
running recording is still loaded but not played. Crouching reduces volume.
Lola's steps are heard close and centred. Sound mute applies to everything.

Contact intervals are measured from each outfit's animated toes at load time,
including reverse playback. No footsteps trigger while stationary, blocked,
or airborne. Moving shots keep the leg animation and footfalls active; only the
upper body uses the shooting pose. Playback is also suppressed when unfocused.

Leaper playback follows actual procedural foot touchdowns, grouping legs that
land in the same frame. Disabled legs emit no contacts. Each step is placed in
3D where the Leaper stands, so it is heard from its direction and fades with
distance (the audio engine's distance curve, `src/audio/audioConfig.js`).
Pause, reset, defeat, mute and loss of focus stop its audio. No free-running loop.
