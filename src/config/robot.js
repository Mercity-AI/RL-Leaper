export const ROBOT_SCALE = 2;
export const LEG_LENGTH_SCALE = 1.2;
export const FEMUR_LENGTH = 1.05 * ROBOT_SCALE * LEG_LENGTH_SCALE;
export const CALF_LENGTH = (1.58 / 2.2) * ROBOT_SCALE * LEG_LENGTH_SCALE;
export const SHIN_LENGTH = CALF_LENGTH * 1.2;
export const CALF_ANGLE = 150 * Math.PI / 180;
export const LOWER_REACH = Math.sqrt(
  SHIN_LENGTH ** 2 + CALF_LENGTH ** 2
  - 2 * SHIN_LENGTH * CALF_LENGTH * Math.cos(CALF_ANGLE),
);
export const COXA_LENGTH = 0.26 * ROBOT_SCALE * LEG_LENGTH_SCALE;
export const STANDING_HEIGHT = 1.16 * ROBOT_SCALE;
export const FOOT_HEIGHT = 0.05 * ROBOT_SCALE;
export const HOME_RADIUS = 1.62 * ROBOT_SCALE;
export const BODY_COLLISION_RADIUS = HOME_RADIUS + 0.75;
export const STEP_DISTANCE = 0.5 * ROBOT_SCALE;

export const MOVEMENT = Object.freeze({
  walkSpeed: 4.4,
  sprintSpeed: 9,
  acceleration: 26,
  airAcceleration: 7,
  gravity: 20,
});
