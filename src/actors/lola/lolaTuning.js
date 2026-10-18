// Every feel value for Lola's movement and animation, in one place, with units.
// Gameplay code reads these; nothing here changes what the Leaper's brain sees.

// How quickly Lola's walk/run input eases toward the keys, in units of 1/second.
// Higher feels snappier, lower feels floatier; 16 reaches full speed in ~0.15 s.
export const LOLA_INPUT_RESPONSE = 16;
// Input below this length (after letting go of every key) snaps to a full stop.
export const LOLA_INPUT_STOP = 0.02;
// Movement, collision and animation logic run in sub-steps of at most 1/120 s,
// so a slow frame never lets Lola tunnel through thin walls or skip footsteps.
export const LOLA_SUBSTEP_RATE = 120;

// How fast Lola's run, sprint and crouch-walk play (and so how fast she travels),
// as multiples of each clip's authored speed. Run and sprint raised 15% on request.
export const LOLA_PACE = Object.freeze({ run: 2.3, sprint: 3.1, crouch: 2 });
// The move() speed argument above this means "sprint" (callers pass 4.5 or 8).
export const LOLA_SPRINT_SPEED = 5;
// How fast Lola turns to face the camera's heading, in radians per second.
export const LOLA_TURN_RATE = 9;
// How fast locomotion clips cross-fade, in units of 1/second (12 = ~0.25 s).
export const LOLA_BLEND_RATE = 12;

// The physics hop used only when the authored jump clips are missing.
export const LOLA_GRAVITY = 14;
export const LOLA_HOP_HEIGHT = 0.85;

// Authored jump timing (seconds into the 30 fps "Jump Shoot" clip). Feet touch down
// at frame 38; if Lola is running, the rest of the recovery is skipped so she runs on.
export const JUMP_LANDING = 38 / 30;
// Feet leave the ground at frame 17. Jumping on the move starts the clip at its
// crouch (frame 10) so the take-off is quick, and Lola only travels while her
// feet are off the ground, so planted feet never slide.
export const JUMP_LIFTOFF = 17 / 30;
export const JUMP_RUN_START = 10 / 30;
// Playback speed of the plain (standing / strafing) jump; 1.5 = 50% faster than authored.
// The running "Jump to Run" clip plays at its authored speed.
export const JUMP_STANDING_SPEED = 1.5;
export const JUMP_FADE_IN = 0.08;
export const JUMP_FADE_OUT = 0.15;
// Jumps taken mid-run (30 fps clips). Each starts on a matching frame of the
// 24-frame Run cycle (backward ones match the run played in reverse). Gameplay
// keeps the run's travel; the clips only add the lift. After touchdown the
// clips hold a still landing pose, which would skate along the ground, so the
// run takes over the moment the boot lands (see measureJumpLanding).
export const RUN_JUMPS = Object.freeze({
  RunJumpRL: { file: 'runjumprl', direction: 1, takeoff: 15 },
  RunJumpLR: { file: 'runjumplr', direction: 1, takeoff: 3 },
  BackJumpLR: { file: 'backjumplr', direction: -1, takeoff: 6 },
  BackJumpRL: { file: 'backjumprl', direction: -1, takeoff: 18 },
});
export const RUN_FRAMES = 24;
// Same playback speed as the plain jump; close to the run's own frame rate.
export const RUN_JUMP_SPEED = 1.5;
// Blend from the landing into the run (clip seconds; 0.04 s at 1.5x). Both have
// the same boot planted in the same spot, so a quick blend shows no pop, while
// a slow one mixes the still landing boot with the run's and smears it along.
export const RUN_JUMP_FADE_OUT = 0.06;
// Pressing jump a few run frames after the matching one skips that far into the
// clip, never past the push-off.
export const RUN_JUMP_MAX_SKIP = 4;

// How the hit flinch's bend (ENCOUNTER.hitRecoilAngle) is shared along her
// spine, lowest joint first. One joint bending 26 degrees stretched her shirt
// at the waist up to 1.5x; spread over four joints it stays under 1.2x. The
// shares add up to 1.2, so the head still moves about as far as before.
export const LOLA_FLINCH_SPREAD = Object.freeze([
  ['DEF-spine.001', 0.264],
  ['DEF-spine.002', 0.336],
  ['DEF-spine.003', 0.336],
  ['DEF-spine.004', 0.264],
]);

// The reload's fade in and out at its start and end, in seconds.
export const RELOAD_FADE_IN = 0.12;
export const RELOAD_FADE_OUT = 0.15;

// Collision moves Lola in steps of at most this many units (times the map
// scale), so she cannot pass through thin walls on a slow frame.
export const LOLA_COLLISION_STEP = 0.08;
// Pushing into a wall: when less than STALL_END of the move gets through (she
// slides slowly or not at all), her legs ease toward standing still instead of
// freezing mid-stride; below STALL_START she is fully at rest. A glancing
// slide (more than STALL_END gets through) keeps the full run.
export const LOLA_STALL_START = 0.2;
export const LOLA_STALL_END = 0.6;
