import * as THREE from 'three';
import { STANDING_HEIGHT } from '../config/robot.js';
import { CAMERA } from '../config/camera.js';
import { CameraOcclusion } from './CameraOcclusion.js';

// The camera for every mode: the chase view behind Lola (and its first-person
// aim through her eyes), the TOP map view, and the lab's LENS view. All the feel
// numbers (lenses, look limits, sensitivity, shake) live in src/config/camera.js.

// The lab's Leaper-eye (LENS) look limits.
const EYE_YAW_LIMIT = THREE.MathUtils.degToRad(45);
const EYE_PITCH_DOWN = THREE.MathUtils.degToRad(-70);
const EYE_PITCH_UP = THREE.MathUtils.degToRad(80);
// The lab chase camera (no Lola to follow) keeps its own looser limits and speed.
const LAB_PITCH = Object.freeze({ low: 0.08, high: 1.25, speed: 0.005 });
const { chasePitch: CHASE_PITCH, aimPitch: AIM_PITCH, look: LOOK, shake: SHAKE } = CAMERA;

// The lens angle for a magnification of the chase lens.
export function zoomedFov(zoom, baseFov = CAMERA.chaseFov) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / zoom));
}

// Is this the kind of pointer that can't be captured (a finger or a pen)?
// pointerType: the last pointer the page saw ('mouse' | 'touch' | 'pen'), if any.
export function isTouchPointer(pointerType) {
  if (pointerType) return pointerType !== 'mouse';
  const media = (query) => Boolean(typeof window !== 'undefined' && window.matchMedia?.(query)?.matches);
  return media('(pointer: coarse)') && !media('(any-pointer: fine)');
}

export class CameraController {
  // signal (optional): the game session's AbortSignal. Aborting it removes every
  // listener below, so a finished mode leaves nothing behind (lab modes omit it).
  constructor(camera, scene, canvas, toggleButton, { signal = null } = {}) {
    const session = signal ? { signal } : {};
    // 1. The look angles and the views' state.
    this.camera = camera;
    this.scene = scene;
    this.mode = 'CHASE';
    this.yaw = Math.PI;
    this.pitch = 0.42;
    // Chase-camera distance behind Lola. Lower = closer/zoomed in (mouse wheel adjusts live).
    this.distance = CAMERA.boom.start;
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
    this.aiming = false;
    // The player's settings (Settings menu, src/ui/settings.js): look speed,
    // up/down inverted, and the chase view's field of view in degrees.
    this.lookSensitivity = LOOK.sensitivity;
    this.invertY = LOOK.invertY;
    this.chaseFov = CAMERA.chaseFov;
    // Aiming magnification; the gun sets its own (WEAPONS[id].ads.zoom).
    this.aimZoom = CAMERA.aimZoom;
    // After leaving a steep aim the chase view still looks this much further
    // up or down than its own limits allow, easing to 0 (review fix 5.22).
    this.viewPitchOffset = 0;
    // Gun recoil: view kick (radians up / sideways) that settles back over time.
    this.recoil = { pitch: 0, yaw: 0, recovery: 10 };
    this.pointerId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.lastPointerType = null;
    this.tempA = new THREE.Vector3();
    this.tempB = new THREE.Vector3();
    this.tempC = new THREE.Vector3();
    this.toggleButton = toggleButton;
    this.canvas = canvas;
    this.mouseReleased = false;
    this.captureGeneration = 0;

    // 2. Pause and mouse capture. Escape lets go of the mouse and asks to pause;
    //    browsers use Escape to end pointer lock, so it is handled right here.
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape') this.requestPause();
    }, session);
    window.addEventListener('blur', () => this.releaseMouse(), session);
    // Which kind of pointer the player uses (capture phase, before any button
    // handler): a finger or pen never captures the mouse (review fix 5.9).
    window.addEventListener('pointerdown', event => {
      if (event.pointerType) this.lastPointerType = event.pointerType;
    }, { capture: true, ...session });
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
    }, session);
    canvas.addEventListener('pointerenter', event => {
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    }, session);

    // 3. The VIEW button, and pressing / dragging on the 3D view.
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation(), session);
    toggleButton.addEventListener('click', () => this.toggle(), session);
    canvas.addEventListener('pointerdown', (event) => {
      // Whether this click only grabs the mouse again (after Alt-Tab, say). The
      // input reads it so the same click doesn't also fire (review fix 5.16).
      this.captureClick = false;
      if (this.spectator?.active) return;
      if (this.gameplayStarted && this.followSubject && this.mode === 'CHASE'
          && event.pointerType === 'mouse' && document.pointerLockElement !== canvas && !this.fallbackMouseLook) {
        this.captureClick = true;
        this.captureMouse();
      }
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      if (this.mode === 'TOP') canvas.style.cursor = 'grabbing';
      window.focus();
    }, session);
    window.addEventListener('pointermove', (event) => this.onPointerMove(event), session);
    window.addEventListener('pointerup', (event) => this.endPointer(event), session);
    window.addEventListener('pointercancel', (event) => this.endPointer(event), session);

    // 4. The wheel zooms the TOP view or the chase boom. While aiming it does
    //    nothing, so scrolling never nudges the crosshair (review fix 5.38).
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.spectator?.active) return;
      if (this.mode === 'TOP') {
        this.topHeight = THREE.MathUtils.clamp(
          this.topHeight * (1 + event.deltaY * 0.0012),
          28,
          180 * this.mapScale,
        );
      } else if (!this.aiming) {
        this.distance = THREE.MathUtils.clamp(
          this.distance * (1 + event.deltaY * CAMERA.boom.wheelRate),
          CAMERA.boom.min,
          CAMERA.boom.max,
        );
      }
    }, { passive: false, ...session });
    window.addEventListener('contextmenu', (event) => event.preventDefault(), session);
  }

  get eyeView() {
    return this.mode === 'LENS';
  }

  // ---- Pause requests (the junkyard sets onPauseRequested / onResumeRequested) ----

  // Escape, the gamepad's Start or the touch PAUSE button during play: let go of
  // the mouse and ask the game to pause.
  requestPause() {
    if (!this.gameplayStarted) return false;
    this.releaseMouse();
    this.onPauseRequested?.();
    return true;
  }

  // Start / the touch PAUSE button while paused: ask the game to carry on.
  requestResume() {
    this.onResumeRequested?.();
  }

  // ---- Mouse capture ----

  captureMouse() {
    if (this.mode !== 'CHASE' || this.spectator?.active || this.fallbackMouseLook
        || this.capturePending || document.pointerLockElement === this.canvas) return;
    // Touch screens and pens have no mouse to capture: no pointer lock and no
    // hover-look fallback, so every on-screen control keeps working (review fix 5.9).
    if (isTouchPointer(this.lastPointerType)) {
      this.touchPlay = true;
      document.body?.classList.add('touch-play');
      return;
    }
    this.touchPlay = false;
    document.body?.classList.remove('touch-play');
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
        if (generation === this.captureGeneration) {
          this.capturePending = false;
        } else if (document.pointerLockElement === this.canvas) {
          // The lock arrived after the game had already let go of the mouse (for
          // example a run that stopped at once): undo it instead of leaving the
          // mouse trapped in a stopped game (review fix 5.11).
          this.releasingMouse = true;
          document.exitPointerLock();
        }
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

  // The LEAPER POV spectator view takes over the camera while it is active.
  setSpectator(spectator) {
    this.spectator = spectator;
  }

  // Forget any drag in progress (a view change took the pointer away).
  endDrag() {
    this.pointerId = null;
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
    this.camera.fov = this.eyeView ? CAMERA.eyeFov : this.mode === 'TOP' ? CAMERA.topFov : this.chaseFov;
    this.camera.up.set(0, 1, 0);
    this.scene.fog.far = (this.mode === 'TOP' ? 220 : 64) * this.mapScale;
    this.camera.updateProjectionMatrix();
  }

  // ---- Looking around ----

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
    } else if (this.mode === 'CHASE' && this.followSubject) {
      // Lola's chase / aim view: one sensitivity setting for mouse and drags.
      this.lookBy(deltaX * LOOK.mouse, deltaY * LOOK.mouse * LOOK.verticalRatio);
    } else if (this.mode === 'CHASE') {
      this.yaw -= deltaX * 0.0055;
      this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * LAB_PITCH.speed, LAB_PITCH.low, LAB_PITCH.high);
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

  // How much slower the look turns while zoomed: the same hand movement then
  // moves the view the same distance on screen as it does unzoomed (review 5.38).
  zoomLookScale() {
    const half = (fov) => Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    return half(this.camera.fov) / half(this.chaseFov);
  }

  // Turn Lola's chase / aim view by a raw amount (radians at sensitivity 1):
  // right / down positive. Mouse, touch drags and the gamepad's right stick all
  // come through here, so the sensitivity setting, the aim-zoom scaling,
  // invert-Y and the pitch limits apply to every device alike.
  lookBy(yawDelta, pitchDelta) {
    if (this.spectator?.active || this.mode !== 'CHASE' || !this.followSubject) return;
    const scale = this.lookSensitivity * (this.aiming ? this.zoomLookScale() : 1);
    this.yaw -= yawDelta * scale;
    this.pitch = this.limitPitch(this.pitch + pitchDelta * scale * (this.invertY ? -1 : 1));
  }

  // Keep a pitch inside the current view's limits. Aiming down the sights may
  // tilt much further than the chase view (review fix 5.22).
  limitPitch(pitch) {
    return this.aiming
      ? THREE.MathUtils.clamp(pitch, AIM_PITCH.up, AIM_PITCH.down)
      : THREE.MathUtils.clamp(pitch, CHASE_PITCH.low, CHASE_PITCH.high);
  }

  endPointer(event) {
    // The capture click is over once its button comes back up.
    this.captureClick = false;
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

  // ---- Aiming down the sights ----

  // Enter or leave the first-person aim. (The weapon also calls aimEyeAt /
  // aimChaseAt so the crosshair stays on the same point across the switch.)
  setAiming(active) {
    active = Boolean(active);
    if (active === this.aiming) return;
    this.aiming = active;
    if (active) {
      this.viewPitchOffset = 0;
      return;
    }
    // Leaving the aim: the aim may have looked much further up or down than the
    // chase boom may go. Bring the boom back inside its limits and let the view
    // ease the rest of the way, so the camera never ends up under the floor when
    // the aim ends without aimChaseAt (a pause, the fight ending, LEAPER POV).
    const limited = this.limitPitch(this.pitch);
    this.viewPitchOffset = this.pitch - limited;
    this.pitch = limited;
  }

  // ---- The per-frame view ----

  // chaseFocus: optional ground point the lab arena's chase camera follows instead of the robot.
  update(state, eyePivot, deltaTime, chaseFocus = null) {
    this.fadeShake(deltaTime);
    this.fadeRecoil(deltaTime);
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
      // Every branch ends with fresh matrices, so world-pinned HUD placed after
      // this update projects with this frame's view, not the last one.
      this.camera.updateMatrixWorld();
      return;
    }

    if (this.mode === 'TOP') {
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(this.topCenter.x, this.topHeight, this.topCenter.y + 0.01);
      this.camera.lookAt(this.topCenter.x, 0, this.topCenter.y);
      this.camera.updateMatrixWorld();
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
      // Aiming changes lens magnification (the gun's zoom); cover never changes the chosen FOV.
      const fov = this.aiming ? zoomedFov(this.aimZoom, this.chaseFov) : this.chaseFov;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-CAMERA.fovEase * deltaTime));
      this.camera.updateProjectionMatrix();
    }
    this.target.lerp(this.tempA, 1 - Math.exp(-6 * deltaTime));
    // A delayed anchor can end up behind the wall the player just rounded.
    if (this.followSubject) this.target.copy(this.tempA);
    if (this.followSubject && this.aiming) {
      // Aim through Lola's eyes, never through the third-person shoulder camera,
      // along the look angles themselves (no boom-dependent tilt any more).
      this.followSubject.eyePosition(this.camera.position);
      this.lookDirection(this.tempB, this.pitch);
      this.camera.lookAt(this.tempC.copy(this.camera.position).add(this.tempB));
      this.applyRecoil();
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
    // Just after a steep aim, the view still looks along the aim's pitch and eases back.
    this.viewPitchOffset *= Math.exp(-CAMERA.aimExitEase * deltaTime);
    if (Math.abs(this.viewPitchOffset) < 1e-4) this.viewPitchOffset = 0;
    this.lookDirection(this.tempC, this.pitch + this.viewPitchOffset);
    // Cast from the actual character, not the lagging follow target: that target
    // can still be on the other side of a corner after the player has turned.
    this.occlusion?.resolve(this.tempA, this.tempB, this.camera, deltaTime,
      this.followSubject ? this.followSubject.height * 0.8 : 0);
    this.camera.position.copy(this.tempB);
    if (this.followSubject) this.camera.lookAt(this.tempC.add(this.camera.position));
    else this.camera.lookAt(this.target.x, this.target.y + 0.35, this.target.z);
    this.applyRecoil();
    this.applyShake();
    this.camera.updateMatrixWorld();
  }

  // The direction the chase / aim view looks for the current yaw and a pitch.
  lookDirection(out, pitch) {
    return out.set(-Math.sin(this.yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
  }

  // ---- Shake and recoil ----

  // Add shake strength (0-1); repeated impacts stack up to full strength.
  shake(amount) {
    this.shakeStrength = Math.min(1, (this.shakeStrength ?? 0) + amount);
  }

  // A gun kicked: raise the view by `pitch` and turn it by `yaw` (radians); the
  // kick settles back at `recovery` per second. Sustained fire stacks up to
  // CAMERA.recoilMax.
  addRecoil(pitch, yaw = 0, recovery = this.recoil.recovery) {
    this.recoil.pitch = Math.min(CAMERA.recoilMax, this.recoil.pitch + pitch);
    this.recoil.yaw = THREE.MathUtils.clamp(this.recoil.yaw + yaw, -CAMERA.recoilMax, CAMERA.recoilMax);
    this.recoil.recovery = recovery;
  }

  // A new encounter starts calm: any shake left over from the last fight's
  // final blow is dropped instead of replaying at the start (review fix 5.2).
  resetEffects() {
    this.shakeStrength = 0;
    this.shakeClock = 0;
    this.recoil.pitch = 0;
    this.recoil.yaw = 0;
    this.viewPitchOffset = 0;
  }

  // The shake fades out over SHAKE.duration in every view mode.
  fadeShake(deltaTime) {
    if (!this.shakeStrength) return;
    this.shakeStrength = Math.max(0, this.shakeStrength - deltaTime / SHAKE.duration);
    this.shakeClock = (this.shakeClock ?? 0) + deltaTime * SHAKE.speed;
  }

  // The recoil settles back smoothly.
  fadeRecoil(deltaTime) {
    if (!this.recoil.pitch && !this.recoil.yaw) return;
    const keep = Math.exp(-this.recoil.recovery * Math.max(0, deltaTime));
    this.recoil.pitch = Math.abs(this.recoil.pitch * keep) < 1e-5 ? 0 : this.recoil.pitch * keep;
    this.recoil.yaw = Math.abs(this.recoil.yaw * keep) < 1e-5 ? 0 : this.recoil.yaw * keep;
  }

  // Tilt the finished chase/aim view by the current recoil (the crosshair, and
  // so the next bullet, follows the kick).
  applyRecoil() {
    if (this.recoil.yaw) this.camera.rotateY(this.recoil.yaw);
    if (this.recoil.pitch) this.camera.rotateX(this.recoil.pitch);
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

  // ---- Keeping the crosshair on a point across the aim switch ----

  // After leaving the eye-level aim, turn the chase camera so its centre ray
  // (the crosshair) still passes through the point that was being aimed at. The
  // boom stays inside the chase limits; when the aim looked steeper than they
  // allow, the view keeps looking at the point and eases into the limits.
  aimChaseAt(point) {
    if (!this.followSubject) return;
    const anchor = this.chaseAnchor(this.tempA);
    // The camera's orbit position depends on the angles being solved; a few
    // fixed-point passes converge because the camera moves little per pass.
    let wanted = this.pitch;
    for (let i = 0; i < 40; i += 1) {
      this.tempB.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.distance * this.followScale).add(anchor);
      const direction = this.tempC.copy(point).sub(this.tempB);
      if (direction.lengthSq() < 1e-8) return;
      direction.normalize();
      this.yaw = Math.atan2(-direction.x, -direction.z);
      wanted = Math.asin(THREE.MathUtils.clamp(-direction.y, -1, 1));
      this.pitch = THREE.MathUtils.clamp(wanted, CHASE_PITCH.low, CHASE_PITCH.high);
    }
    this.viewPitchOffset = wanted - this.pitch;
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
    this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(-direction.y, -1, 1)), AIM_PITCH.up, AIM_PITCH.down);
  }

  // ---- Render-time fades (Lola close to the lens, walls in the way) ----

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
