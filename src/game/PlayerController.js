import * as THREE from 'three';

// Lola's running and sprinting speeds as handed to LolaPlayer.move (she turns
// any speed above 5 into her sprint pace).
export const PLAYER_SPEED = Object.freeze({ run: 4.5, sprint: 8 });

// Turns keyboard / touch input into Lola's movement and jumps. This used to live
// inside the Leaper's brain client (JunkyardBrain), which meant the AI moved the
// player. It runs in two steps each frame: sample() in the input phase reads
// what the player is asking for, and update() in the gameplay phase applies it.
export class PlayerController {
  // headingYaw(): the Leaper's yaw, which getMovementHeading needs for its
  // eye-view mode (unused by the junkyard's chase / top views, kept for parity).
  constructor({ player, input, cameraController, headingYaw = () => 0 }) {
    this.player = player;
    this.input = input;
    this.cameraController = cameraController;
    this.headingYaw = headingYaw;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.intent = null;
  }

  // Input phase. frozen = true while the game is paused: nothing is applied, and
  // the jump buffer only runs down, so a press during the pause is not replayed.
  sample(dt, { frozen = false } = {}) {
    if (frozen) {
      this.input.update(dt);
      this.intent = null;
      return null;
    }
    // A buffered jump is only used up once Lola can actually start one, so a
    // press just before landing still jumps (review fix 5.36).
    const canJump = this.player.isPlayer && (this.player.canJump ?? this.player.grounded);
    const jump = Boolean(canJump) && this.input.consumeJump();
    this.input.update(dt);
    // WASD / joystick, plus the old IJKL target keys, which still nudge Lola.
    const move = this.input.getMovement();
    const nudge = this.input.getTargetMovement();
    this.intent = {
      jump,
      forward: move.forward + nudge.forward,
      side: move.side + nudge.side,
      sprint: this.input.sprinting,
      heading: this.cameraController.getMovementHeading(this.headingYaw()),
    };
    return this.intent;
  }

  // Gameplay phase: jump first, then move relative to the camera's heading.
  update(dt) {
    const intent = this.intent;
    if (!intent) return;
    if (intent.jump) this.player.jump();
    this.forward.set(Math.sin(intent.heading), 0, Math.cos(intent.heading));
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.player.move(intent.forward, intent.side, this.forward, this.right,
      intent.sprint ? PLAYER_SPEED.sprint : PLAYER_SPEED.run, dt);
  }
}
