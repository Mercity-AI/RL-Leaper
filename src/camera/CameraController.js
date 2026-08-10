import * as THREE from 'three';
import { STANDING_HEIGHT } from '../config/robot.js';

const EYE_YAW_LIMIT = THREE.MathUtils.degToRad(45);
const EYE_PITCH_DOWN = THREE.MathUtils.degToRad(-70);
const EYE_PITCH_UP = THREE.MathUtils.degToRad(80);

export class CameraController {
  constructor(camera, scene, canvas, toggleButton) {
    this.camera = camera;
    this.scene = scene;
    this.mode = 'CHASE';
    this.yaw = Math.PI;
    this.pitch = 0.42;
    this.distance = 11.5;
    this.topHeight = 135;
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.target = new THREE.Vector3(0, 1, 0);
    this.pointerId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.tempA = new THREE.Vector3();
    this.tempB = new THREE.Vector3();
    this.tempC = new THREE.Vector3();
    this.toggleButton = toggleButton;

    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.toggle());
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      window.focus();
    });
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.endPointer(event));
    window.addEventListener('pointercancel', (event) => this.endPointer(event));
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.mode === 'TOP') {
        this.topHeight = THREE.MathUtils.clamp(
          this.topHeight * (1 + event.deltaY * 0.0012),
          28,
          180,
        );
      } else {
        this.distance = THREE.MathUtils.clamp(
          this.distance * (1 + event.deltaY * 0.001),
          6,
          22,
        );
      }
    }, { passive: false });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  get eyeView() {
    return this.mode === 'LENS';
  }

  toggle() {
    this.mode = this.mode === 'CHASE' ? 'LENS' : this.mode === 'LENS' ? 'TOP' : 'CHASE';
    this.toggleButton.textContent = `VIEW: ${this.mode}`;
    this.toggleButton.classList.toggle('on', this.mode !== 'CHASE');
    this.camera.fov = this.eyeView ? 60 : this.mode === 'TOP' ? 75 : 55;
    this.camera.up.set(0, 1, 0);
    this.scene.fog.far = this.mode === 'TOP' ? 220 : 64;
    this.camera.updateProjectionMatrix();
  }

  onPointerMove(event) {
    if (event.pointerId !== this.pointerId) return;
    if (this.eyeView) {
      this.eyeYaw = THREE.MathUtils.clamp(
        this.eyeYaw + (event.clientX - this.lastX) * 0.0055,
        -EYE_YAW_LIMIT,
        EYE_YAW_LIMIT,
      );
      this.eyePitch = THREE.MathUtils.clamp(
        this.eyePitch - (event.clientY - this.lastY) * 0.005,
        EYE_PITCH_DOWN,
        EYE_PITCH_UP,
      );
    } else if (this.mode === 'CHASE') {
      this.yaw -= (event.clientX - this.lastX) * 0.0055;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + (event.clientY - this.lastY) * 0.005,
        0.08,
        1.25,
      );
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }

  endPointer(event) {
    if (event.pointerId === this.pointerId) this.pointerId = null;
  }

  compensateForBodyTurn(yawDelta) {
    if (!this.eyeView) return;
    this.eyeYaw = THREE.MathUtils.clamp(
      this.eyeYaw - yawDelta,
      -EYE_YAW_LIMIT,
      EYE_YAW_LIMIT,
    );
  }

  getMovementHeading(robotYaw) {
    return this.eyeView ? robotYaw + this.eyeYaw : this.yaw + Math.PI;
  }

  update(state, eyePivot, deltaTime) {
    if (this.eyeView) {
      this.tempA.set(0, 0, 0.19);
      eyePivot.localToWorld(this.tempA);
      this.camera.position.copy(this.tempA);
      const heading = state.yaw + this.eyeYaw;
      this.tempB.set(
        Math.sin(heading) * Math.cos(this.eyePitch),
        Math.sin(this.eyePitch),
        Math.cos(heading) * Math.cos(this.eyePitch),
      );
      this.camera.lookAt(this.tempC.copy(this.camera.position).add(this.tempB));
      return;
    }

    if (this.mode === 'TOP') {
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(0, this.topHeight, 0.01);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    this.camera.up.set(0, 1, 0);
    this.tempA.set(
      state.position.x,
      STANDING_HEIGHT * 0.75 + state.jumpHeight * 0.9,
      state.position.z,
    );
    this.target.lerp(this.tempA, Math.min(1, 6 * deltaTime));
    this.tempB.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance).add(this.target);
    this.camera.position.copy(this.tempB);
    this.camera.lookAt(this.target.x, this.target.y + 0.35, this.target.z);
  }
}
