Lola footstep recordings supplied by the project owner:

- `lola-run.wav`: `816019__qubodup__fps-footsteps-loop.wav`, qubodup.
- `lola-walk.wav`: `856942__artemditkovsky__footsteps.wav`, artemditkovsky.
- `leaper-walk.wav`: six mechanical impacts from the owner's
  `812326__artninja__spider_robot_designed_walk_andor_inspired_06162025.wav`, artninja.
  Peaks selected at 0.78, 1.51, 4.25, 5.03, 6.47 and 7.21 seconds; each excerpt
  begins 70 ms before the peak, lasts 500 ms, and has a 25 ms tail fade.
  Exported as mono PCM16 at 44.1 kHz in six 550 ms slots.

Lola's original WAVs are retained unchanged. Playback selects individual impacts from
each recording at measured animation contact times. Shift/sprint uses the running
recording; ordinary movement, strafing and crouching use the walking recording.
Crouching reduces volume. Sound mute applies to both combat and footsteps.

Contact intervals are measured from each outfit's animated toes at load time,
including reverse playback. No footsteps trigger while stationary, blocked,
or airborne. Moving shots keep the leg animation and footfalls active; only the
upper body uses the shooting pose. Playback is also suppressed when unfocused.

Leaper playback follows actual procedural foot touchdowns, grouping legs that
land in the same frame. Disabled legs emit no contacts. Distance reduces volume;
pause, reset, defeat, mute and loss of focus stop its audio. No free-running loop.
