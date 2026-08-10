export class InputController {
  constructor(onToggleTarget) {
    this.keys = {};
    this.jumpBuffer = 0;
    this.sprintHeld = false;
    this.joystick = { active: false, pointerId: null, forward: 0, side: 0 };

    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
      this.keys[event.code] = true;
      if (event.code === 'Space' && !event.repeat) this.jumpBuffer = 0.16;
      if (event.code === 'KeyP' && !event.repeat) onToggleTarget();
    });
    window.addEventListener('keyup', (event) => {
      this.keys[event.code] = false;
    });
    window.addEventListener('blur', () => {
      Object.keys(this.keys).forEach((code) => { this.keys[code] = false; });
    });

    this.setupTouchControls();
  }

  setupTouchControls() {
    const touchUi = document.getElementById('touch');
    const joystickBase = document.getElementById('joyBase');
    const joystickKnob = document.getElementById('joyKnob');
    const jumpButton = document.getElementById('btnJump');
    const sprintButton = document.getElementById('btnSprint');

    if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
      touchUi.classList.add('show');
    }

    const moveJoystick = (event) => {
      if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) return;
      const bounds = joystickBase.getBoundingClientRect();
      let x = event.clientX - (bounds.left + bounds.width / 2);
      let y = event.clientY - (bounds.top + bounds.height / 2);
      const length = Math.hypot(x, y);
      const maximum = bounds.width / 2 - 8;
      if (length > maximum) {
        x = x / length * maximum;
        y = y / length * maximum;
      }
      joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
      this.joystick.forward = -y / maximum;
      this.joystick.side = x / maximum;
    };

    const endJoystick = (event) => {
      if (event.pointerId !== this.joystick.pointerId) return;
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.forward = 0;
      this.joystick.side = 0;
      joystickKnob.style.transform = 'translate(0, 0)';
    };

    joystickBase.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.joystick.active = true;
      this.joystick.pointerId = event.pointerId;
      moveJoystick(event);
    });
    window.addEventListener('pointermove', moveJoystick);
    window.addEventListener('pointerup', endJoystick);
    window.addEventListener('pointercancel', endJoystick);

    jumpButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.jumpBuffer = 0.16;
    });
    sprintButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.sprintHeld = true;
      sprintButton.classList.add('on');
    });
    const stopSprint = () => {
      this.sprintHeld = false;
      sprintButton.classList.remove('on');
    };
    sprintButton.addEventListener('pointerup', stopSprint);
    sprintButton.addEventListener('pointercancel', stopSprint);
  }

  update(deltaTime) {
    if (this.jumpBuffer > 0) this.jumpBuffer -= deltaTime;
  }

  consumeJump() {
    if (this.jumpBuffer <= 0) return false;
    this.jumpBuffer = 0;
    return true;
  }

  getMovement() {
    if (this.joystick.active) {
      return { forward: this.joystick.forward, side: this.joystick.side };
    }
    return {
      forward: (this.keys.KeyW || this.keys.ArrowUp ? 1 : 0)
        - (this.keys.KeyS || this.keys.ArrowDown ? 1 : 0),
      side: (this.keys.KeyD || this.keys.ArrowRight ? 1 : 0)
        - (this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0),
    };
  }

  getTargetMovement() {
    return {
      forward: (this.keys.KeyI ? 1 : 0) - (this.keys.KeyK ? 1 : 0),
      side: (this.keys.KeyL ? 1 : 0) - (this.keys.KeyJ ? 1 : 0),
    };
  }

  get sprinting() {
    return Boolean(this.keys.ShiftLeft || this.keys.ShiftRight || this.sprintHeld);
  }
}
