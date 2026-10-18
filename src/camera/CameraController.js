import * as THREE from 'three';
import { STANDING_HEIGHT } from '../config/robot.js';
import { CameraOcclusion } from './CameraOcclusion.js';

// Third-person look limits around Lola, in radians: how far the camera may rise
// above her (looking down) and dip below (looking up). Kept tight so mouse-look
// shows the surroundings instead of the floor or the sky.
const CHASE_PITCH_HIGH = 0.5;
const CHASE_PITCH_LOW = -0.25;
const CHASE_VERTICAL_SENSITIVITY = 0.0035;
const EYE_YAW_LIMIT = THREE.MathUtils.degToRad(45);
const EYE_PITCH_DOWN = THREE.MathUtils.degToRad(-70);
const EYE_PITCH_UP = THREE.MathUtils.degToRad(80);
// Camera shake for big impacts: a shake strength (0-1) that fades out over
// duration seconds; the view wobbles by up to these angles (radians) at full
// strength, and speed sets how fast it wobbles.
const SHAKE = Object.freeze({ duration: 1, speed: 30, pitch: 0.035, yaw: 0.03, roll: 0.025 });
// Right-button aim magnification (was 1.5x; reduced 10% on request).
const AIM_ZOOM = 1.35;

export class CameraController {
  constructor(camera, scene, canvas, toggleButton) {
    this.camera = camera;
    this.scene = scene;
    this.mode = 'CHASE';
    this.yaw = Math.PI;
    this.pitch = 0.42;
    // Chase-camera distance behind Lola. Lower = closer/zoomed in (mouse wheel adjusts live).
    this.distance = 8.5;
    this.topHeight = 75;
    this.mapScale = 1;
    // Lola's size relative to the default Leaper size. A bigger Leaper shrinks the map
    // and Lola, so the chase boom shrinks with her to keep the same framing.
    this.followScale = 1;
    this.topCenter = new THREE.Vector2(0, 0);
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.target = new THREE.Vector3(0, 1, 0);
    // Camera height on Lola, as a fraction of her height (eases while crouching).
    this.followHeight = 1.05;
    this.pointerId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.tempA = new THREE.Vector3();
    this.tempB = new THREE.Vector3();
    this.tempC = new THREE.Vector3();
    this.toggleButton = toggleButton;
    this.canvas = canvas;
    this.mouseReleased = false;
    this.captureGeneration = 0;
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.gameplayStarted) {
        this.releaseMouse();
        this.onPauseRequested?.();
      }
    });
    window.addEventListener('blur', () => this.releaseMouse());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      const wasLocked = this.nativeMouseLook;
      this.nativeMouseLook = locked;
      const intentionalRelease = this.releasingMouse;
      this.releasingMouse = false;
      this.fallbackMouseLook = false;
      document.body?.classList.toggle('mouse-look', locked);
      this.mouseReleased = !locked;
      this.pointerId = null;
      canvas.style.cursor = locked ? 'none' : this.mode === 'TOP' ? 'grab' : 'default';
      this.onMouseLockChange?.(locked);
      // Browsers can consume Escape before keydown reaches the game. A focus
      // loss or our own camera/menu release must not stop the simulation.
      if (!locked && wasLocked && !intentionalRelease && document.hasFocus?.()) this.onPauseRequested?.();
    });
    canvas.addEventListener('pointerenter', event => {
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });

    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.toggle());
    canvas.addEventListener('pointerdown', (event) => {
      if (this.spectator?.active) return;
      if (this.gameplayStarted && this.followSubject && this.mode === 'CHASE'
          && event.pointerType === 'mouse' && document.pointerLockElement !== canvas) {
        this.captureMouse();
      }
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      if (this.mode === 'TOP') canvas.style.cursor = 'grabbing';
      window.focus();
    });
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.endPointer(event));
    window.addEventListener('pointercancel', (event) => this.endPointer(event));
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.spectator?.active) return;
      if (this.mode === 'TOP') {
        this.topHeight = THREE.MathUtils.clamp(
          this.topHeight * (1 + event.deltaY * 0.0012),
          28,
          180 * this.mapScale,
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

  captureMouse() {
    if (this.mode !== 'CHASE' || this.spectator?.active || this.fallbackMouseLook
        || this.capturePending || document.pointerLockElement === this.canvas) return;
    const generation = ++this.captureGeneration;
    this.capturePending = true;
    const fallback = () => {
      if (generation !== this.captureGeneration) return;
      this.capturePending = false;
      this.enableFallbackLook();
    };
    try {
      const request = this.canvas.requestPointerLock();
      Promise.resolve(request).then(() => {
        if (generation === this.captureGeneration) this.capturePending = false;
      }, fallback);
    } catch { fallback(); }
  }

  enableFallbackLook() {
    // Some embedded browsers reject Pointer Lock. Keep Start functional and
    // hide the canvas cursor; Escape still returns control to the toolbar.
    this.fallbackMouseLook = true;
    this.mouseReleased = false;
    this.canvas.style.cursor = 'none';
    document.body?.classList.add('mouse-look');
    this.onMouseLockChange?.(true);
  }

  releaseMouse() {
    ++this.captureGeneration;
    this.capturePending = false;
    if (document.pointerLockElement === this.canvas) {
      this.releasingMouse = true;
      document.exitPointerLock();
    }
    if (this.fallbackMouseLook) {
      this.fallbackMouseLook = false;
      this.mouseReleased = true;
      this.canvas.style.cursor = 'default';
      document.body?.classList.remove('mouse-look');
      this.onMouseLockChange?.(false);
    }
  }

  setOccluders(roots) {
    this.occlusion = new CameraOcclusion(roots.filter(Boolean));
  }

  toggle() {
    if (this.spectator?.active) this.spectator.toggle();
    if (this.followSubject) {
      this.mode = this.mode === 'CHASE' ? 'TOP' : 'CHASE';
      this.releaseMouse();
      this.topCenter.set(this.followSubject.mesh.position.x, this.followSubject.mesh.position.z);
    } else this.mode = this.mode === 'CHASE' ? 'LENS' : this.mode === 'LENS' ? 'TOP' : 'CHASE';
    this.toggleButton.textContent = `VIEW: ${this.mode}`;
    this.toggleButton.classList.toggle('on', this.mode !== 'CHASE');
    document.body.classList.toggle('top-view', this.mode === 'TOP');
    this.canvas.style.cursor = this.mode === 'TOP' ? 'grab' : 'default';
    this.camera.fov = this.eyeView ? 60 : this.mode === 'TOP' ? 75 : 55;
    this.camera.up.set(0, 1, 0);
    this.scene.fog.far = (this.mode === 'TOP' ? 220 : 64) * this.mapScale;
    this.camera.updateProjectionMatrix();
  }

  onPointerMove(event) {
    if (this.spectator?.active) return;
    const locked = document.pointerLockElement === this.canvas;
    // The chase camera follows the mouse only while it is captured (START RUN /
    // START PLAYER), so moving to the buttons, before starting or after Escape,
    // never turns the view. Touch dragging still turns it.
    const hoverLook = this.fallbackMouseLook && this.followSubject && this.mode === 'CHASE'
      && event.pointerType === 'mouse' && event.target === this.canvas;
    if (!locked && !this.fallbackMouseLook && event.pointerType === 'mouse' && this.mode === 'CHASE') return;
    if (!locked && !hoverLook && event.pointerId !== this.pointerId) return;
    const deltaX = locked || hoverLook ? event.movementX : event.clientX - this.lastX;
    const deltaY = locked || hoverLook ? event.movementY : event.clientY - this.lastY;
    if (this.eyeView) {
      this.eyeYaw = THREE.MathUtils.clamp(
        this.eyeYaw + deltaX * 0.0055,
        -EYE_YAW_LIMIT,
        EYE_YAW_LIMIT,
      );
      this.eyePitch = THREE.MathUtils.clamp(
        this.eyePitch - deltaY * 0.005,
        EYE_PITCH_DOWN,
        EYE_PITCH_UP,
      );
    } else if (this.mode === 'CHASE') {
      this.yaw -= deltaX * 0.0055;
      this.pitch = this.followSubject
        ? THREE.MathUtils.clamp(this.pitch + deltaY * CHASE_VERTICAL_SENSITIVITY, CHASE_PITCH_LOW, CHASE_PITCH_HIGH)
        : THREE.MathUtils.clamp(this.pitch + deltaY * 0.005, 0.08, 1.25);
    } else if (this.mode === 'TOP') {
      const visibleHeight = 2 * this.topHeight
        * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const worldUnitsPerPixel = visibleHeight / Math.max(this.canvas.clientHeight, 1);
      this.topCenter.x = THREE.MathUtils.clamp(
        this.topCenter.x - deltaX * worldUnitsPerPixel,
        -75 * this.mapScale,
        75 * this.mapScale,
      );
      this.topCenter.y = THREE.MathUtils.clamp(
        this.topCenter.y - deltaY * worldUnitsPerPixel,
        -75 * this.mapScale,
        75 * this.mapScale,
      );
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }

  endPointer(event) {
    if (event.pointerId === this.pointerId) {
      this.pointerId = null;
      if (this.mode === 'TOP') this.canvas.style.cursor = 'grab';
    }
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
    if (this.spectator?.active) return this.spectator.heading;
    if (this.followSubject && this.mode === 'TOP') return Math.PI;
    return this.eyeView ? robotYaw + this.eyeYaw : this.yaw + Math.PI;
  }

  // chaseFocus: optional ground point the lab arena's chase camera follows instead of the robot.
  update(state, eyePivot, deltaTime, chaseFocus = null) {
    this.fadeShake(deltaTime);
    if (this.spectator?.active) return;
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
      this.camera.position.set(this.topCenter.x, this.topHeight, this.topCenter.y + 0.01);
      this.camera.lookAt(this.topCenter.x, 0, this.topCenter.y);
      return;
    }

    this.camera.up.set(0, 1, 0);
    if (this.followSubject) {
      // Ease the camera down/up when crouching instead of snapping to the new height.
      const goal = this.followSubject.crouching ? 0.72 : 1.05;
      this.followHeight += (goal - this.followHeight) * (1 - Math.exp(-8 * deltaTime));
      this.chaseAnchor(this.tempA);
    } else if (chaseFocus) {
      this.tempA.set(chaseFocus.x, 1.6, chaseFocus.z);
    } else {
      this.tempA.set(state.position.x, STANDING_HEIGHT * 0.75 + state.jumpHeight * 0.9, state.position.z);
    }
    if (this.followSubject) {
      // Aiming changes lens magnification (AIM_ZOOM); cover never changes the chosen FOV.
      const fov = this.aiming ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(55) / 2) / AIM_ZOOM)) : 55;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-14 * deltaTime));
      this.camera.updateProjectionMatrix();
    }
    this.target.lerp(this.tempA, 1 - Math.exp(-6 * deltaTime));
    // A delayed anchor can end up behind the wall the player just rounded.
    if (this.followSubject) this.target.copy(this.tempA);
    if (this.followSubject && this.aiming) {
      // Aim through Lola's eyes, never through the third-person shoulder camera.
      this.followSubject.eyePosition(this.camera.position);
      this.tempB.set(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        -Math.sin(this.pitch) + 0.35 / this.distance,
        -Math.cos(this.yaw) * Math.cos(this.pitch),
      ).normalize();
      this.camera.lookAt(this.tempC.copy(this.camera.position).add(this.tempB));
      this.applyShake();
      this.camera.updateMatrixWorld(true);
      return;
    }
    this.tempB.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance * this.followScale).add(this.target);
    // Keep the chosen pitch throughout collision recovery. Do not re-aim at an
    // elevated point as the boom shrinks (which tilts the close camera upward).
    this.tempC.set(-Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    // Cast from the actual character, not the lagging follow target: that target
    // can still be on the other side of a corner after the player has turned.
    this.occlusion?.resolve(this.tempA, this.tempB, this.camera, deltaTime,
      this.followSubject ? this.followSubject.height * 0.8 : 0);
    this.camera.position.copy(this.tempB);
    if (this.followSubject) this.camera.lookAt(this.tempC.add(this.camera.position));
    else this.camera.lookAt(this.target.x, this.target.y + 0.35, this.target.z);
    this.applyShake();
  }

  // Add shake strength (0-1); repeated impacts stack up to full strength.
  shake(amount) {
    this.shakeStrength = Math.min(1, (this.shakeStrength ?? 0) + amount);
  }

  // The shake fades out over SHAKE.duration in every view mode.
  fadeShake(deltaTime) {
    if (!this.shakeStrength) return;
    this.shakeStrength = Math.max(0, this.shakeStrength - deltaTime / SHAKE.duration);
    this.shakeClock = (this.shakeClock ?? 0) + deltaTime * SHAKE.speed;
  }

  // Wobble the finished chase/aim view a little.
  applyShake() {
    if (!this.shakeStrength) return;
    // Squared, so the shake eases out instead of stopping abruptly.
    const power = this.shakeStrength ** 2, t = this.shakeClock;
    const wobble = seed => Math.sin(t + seed) * 0.6 + Math.sin(t * 2.3 + seed * 1.7) * 0.4;
    this.camera.rotateX(SHAKE.pitch * power * wobble(1));
    this.camera.rotateY(SHAKE.yaw * power * wobble(5));
    this.camera.rotateZ(SHAKE.roll * power * wobble(9));
  }

  // After leaving the eye-level aim, turn the chase camera so its centre ray
  // (the crosshair) still passes through the point that was being aimed at.
  aimChaseAt(point) {
    if (!this.followSubject) return;
    const anchor = this.chaseAnchor(this.tempA);
    // The camera's orbit position depends on the angles being solved; a few
    // fixed-point passes converge because the camera moves little per pass.
    for (let i = 0; i < 40; i += 1) {
      this.tempB.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.distance * this.followScale).add(anchor);
      const direction = this.tempC.copy(point).sub(this.tempB);
      if (direction.lengthSq() < 1e-8) return;
      direction.normalize();
      this.yaw = Math.atan2(-direction.x, -direction.z);
      this.pitch = THREE.MathUtils.clamp(Math.asin(-direction.y), CHASE_PITCH_LOW, CHASE_PITCH_HIGH);
    }
  }

  // Point on Lola the chase camera orbits around.
  chaseAnchor(out) {
    const subject = this.followSubject;
    return out.set(subject.mesh.position.x,
      subject.height * this.followHeight + 0.5 * this.followScale + subject.mesh.position.y,
      subject.mesh.position.z);
  }

  // Entering the eye-level aim: turn so the aim's centre ray (the crosshair)
  // passes through the point the chase crosshair was on.
  aimEyeAt(point) {
    const subject = this.followSubject;
    if (!subject) return;
    const eye = subject.eyePosition(this.tempB);
    const direction = this.tempC.copy(point).sub(eye);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();
    this.yaw = Math.atan2(-direction.x, -direction.z);
    // The aim view tilts its ray by 0.35 / distance (see update); solve the pitch
    // whose tilted ray has the wanted elevation. That elevation falls as pitch rises.
    const lift = 0.35 / this.distance;
    const wanted = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    let low = -Math.PI / 2, high = Math.PI / 2;
    for (let i = 0; i < 40; i += 1) {
      const middle = (low + high) / 2;
      if (Math.atan2(lift - Math.sin(middle), Math.cos(middle)) > wanted) low = middle;
      else high = middle;
    }
    this.pitch = THREE.MathUtils.clamp((low + high) / 2, CHASE_PITCH_LOW, CHASE_PITCH_HIGH);
  }

  beforeRender() {
    if (!this.followSubject || this.spectator?.active || this.mode !== 'CHASE' || this.aiming) return;
    this.occlusion?.beforeRender();
    const distance = this.camera.position.distanceTo(this.tempA);
    const opacity = 0.8 + 0.2 * THREE.MathUtils.smoothstep(distance / this.followSubject.height, 0.8, 1.5);
    if (opacity >= 1) return;
    this.fadedMaterials = new Map();
    this.followSubject.mesh.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (this.fadedMaterials.has(material)) continue;
        this.fadedMaterials.set(material, [material.opacity, material.transparent, material.depthWrite]);
        material.opacity *= opacity;
        material.transparent = true;
      }
    });
  }

  afterRender() {
    this.occlusion?.afterRender();
    this.fadedMaterials?.forEach(([opacity, transparent, depthWrite], material) => {
      Object.assign(material, { opacity, transparent, depthWrite });
    });
    this.fadedMaterials = null;
  }
}
