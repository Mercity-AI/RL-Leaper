import * as THREE from 'three';
import { CAMERA } from '../config/camera.js';
import { WEAPONS, slotForKey } from '../config/weapons.js';

// Lola's running and sprinting speeds as handed to LolaPlayer.move (she turns
// any speed above 5 into her sprint pace).
export const PLAYER_SPEED = Object.freeze({ run: 4.5, sprint: 8 });

// Turns the input actions (keyboard, gamepad, touch) into what Lola does: move,
// sprint, jump, crouch, switch guns, and pause / resume. This used to live
// inside the Leaper's brain client (JunkyardBrain) and Lola's own key listener.
// It runs in two steps each frame: sample() in the input phase reads what the
// player is asking for, and update() in the gameplay phase applies it. While the
// game is paused nothing is applied, so a pause freezes every one of these.
// (Firing, aiming and reloading are the weapon's actions; it reads the same input.)
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
    // weaponIndex slot each gun key equips (1 = the pistol, 2 = the M416).
    this.keySlots = { weapon1: slotForKey('1'), weapon2: slotForKey('2') };
  }

  // Input phase: read every device once for this frame, then what the player asks
  // for. frozen = true while the game is paused: nothing is applied, presses made
  // during the pause are dropped (not replayed afterwards), and the jump buffer
  // only runs down. The gamepad's Start or the touch RESUME button carries on.
  sample(dt, { frozen = false } = {}) {
    this.input.poll?.();
    if (frozen) {
      if (this.input.pressed?.('pause') && this.input.pressedBy?.('pause') !== 'keyboard') this.cameraController.requestResume?.();
      this.input.update(dt);
      this.intent = null;
      return null;
    }
    // 1. Pause (Escape is also handled by the camera, which owns the mouse).
    if (this.input.pressed?.('pause')) this.cameraController.requestPause?.();
    // 2. A buffered jump is only used up once Lola can actually start one, so a
    //    press just before landing still jumps (review fix 5.36).
    const canJump = this.player.isPlayer && (this.player.canJump ?? this.player.grounded);
    const jump = Boolean(canJump) && this.input.consumeJump();
    this.input.update(dt);
    // 3. The gamepad's right stick turns the camera (mouse and touch drags turn it directly).
    const look = this.input.axis?.('look');
    if (look && (look.x || look.y)) {
      this.cameraController.lookBy?.(look.x * CAMERA.look.gamepad * dt, -look.y * CAMERA.look.gamepad * dt * CAMERA.look.verticalRatio);
    }
    // 4. WASD / joystick / left stick, plus the old IJKL target keys, which still nudge Lola.
    const move = this.input.getMovement();
    const nudge = this.input.getTargetMovement();
    this.intent = {
      jump,
      forward: move.forward + nudge.forward,
      side: move.side + nudge.side,
      sprint: this.input.sprinting,
      heading: this.cameraController.getMovementHeading(this.headingYaw()),
      crouch: Boolean(this.input.pressed?.('crouch')),
      weapon: this.wantedWeapon(),
    };
    return this.intent;
  }

  // The weaponIndex slot the player asks for this frame, or null: 1 / 2 pick a
  // gun (pressing the equipped gun's key keeps it), SWITCH / Y swaps to the other.
  wantedWeapon() {
    const input = this.input;
    if (!input.pressed) return null;
    if (input.pressed('weapon1')) return this.keySlots.weapon1;
    if (input.pressed('weapon2')) return this.keySlots.weapon2;
    if (input.pressed('switchWeapon')) {
      const count = Object.keys(WEAPONS).length;
      return ((this.player.weaponIndex ?? 0) + 1) % count;
    }
    return null;
  }

  // Gameplay phase: crouch and gun changes, then the jump, then movement
  // relative to the camera's heading.
  update(dt) {
    const intent = this.intent;
    if (!intent) return;
    if (intent.crouch) this.player.toggleCrouch?.();
    if (intent.weapon !== null && intent.weapon >= 0 && intent.weapon !== this.player.weaponIndex) this.player.switchWeapon?.();
    if (intent.jump) this.player.jump();
    this.forward.set(Math.sin(intent.heading), 0, Math.cos(intent.heading));
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.player.move(intent.forward, intent.side, this.forward, this.right,
      intent.sprint ? PLAYER_SPEED.sprint : PLAYER_SPEED.run, dt);
  }
}
