import * as THREE from 'three';

// Health-bar colour by remaining share, from the Leaper's own palette: the hot
// orange of its eye glow and copper accents at full health, sliding to deep red
// when nearly dead. Stops are [share, r, g, b], highest share first.
const COLOUR_STOPS = [[1, 255, 122, 48], [0.5, 240, 72, 30], [0.25, 196, 28, 24], [0, 140, 10, 16]];
// Height above the Leaper's body centre, in the body's own units.
const ANCHOR = new THREE.Vector3(0, 0.95, 0);
const FADE_SPEED = 2.5; // opacity per second when fading out
// The chase camera's normal field of view in degrees (CameraController).
const CHASE_FOV = 55;
// Hit reaction: a white flash for ~2 frames, a small sideways shake, and a scale
// punch that eases back. Pixels / seconds / scale.
const HIT = Object.freeze({ flashTime: 0.03, shakeTime: 0.15, shakePixels: 3, punchScale: 1.15, punchTime: 0.25 });

// The Leaper's eye as a badge at the bar's left end (the owner's sketch): a
// slanted square, i.e. a diamond, of dark metal with a copper rim whose right
// corner the bar grows out of, a dark socket, an iris glowing in the bar's
// colour and the red weak-point core in the middle.
const EYE_BADGE = `<svg class="bar-eye" viewBox="0 0 40 40" aria-hidden="true">
  <defs>
    <linearGradient id="barEyeMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f57"/><stop offset=".55" stop-color="#1c1f24"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient>
    <radialGradient id="barEyeIris"><stop offset="0" style="stop-color: var(--hp-colour, #ff7a30)"/><stop offset=".7" style="stop-color: var(--hp-colour, #ff7a30); stop-opacity: .55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <path class="bar-eye-shield" d="M20 1.5 L38.5 20 L20 38.5 L1.5 20 Z" fill="url(#barEyeMetal)"/>
  <circle class="bar-eye-socket" cx="20" cy="20" r="9.5" fill="#08090b"/>
  <circle class="bar-eye-iris" cx="20" cy="20" r="8" fill="url(#barEyeIris)"/>
  <circle class="bar-eye-core" cx="20" cy="20" r="3.2"/>
  <circle cx="17.8" cy="17.6" r="1.3" fill="#fff" opacity=".8"/>
</svg>`;

export function healthColour(share) {
  const s = THREE.MathUtils.clamp(share, 0, 1);
  for (let i = 1; i < COLOUR_STOPS.length; i++) {
    const [high, ...a] = COLOUR_STOPS[i - 1], [low, ...b] = COLOUR_STOPS[i];
    if (s >= low) {
      const t = (s - low) / (high - low);
      return `rgb(${b.map((value, k) => Math.round(value + (a[k] - value) * t)).join(', ')})`;
    }
  }
  return `rgb(${COLOUR_STOPS.at(-1).slice(1).join(', ')})`;
}

// A bar that floats over the Leaper, appears after a burst of real damage, drains
// with a pale "trail" chunk, reacts to each hit, throbs below 25% and wobbles
// while the Leaper walks.
export class LeaperHealthBar {
  constructor(config) {
    this.config = config;
    this.element = document.createElement('div');
    this.element.id = 'leaperWorldBar';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `${EYE_BADGE}<div class="bar-frame"><i class="bar-trail"></i><i class="bar-fill"></i><i class="bar-shine"></i></div>`;
    this.frame = this.element.querySelector('.bar-frame');
    document.body.append(this.element);
    this.point = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.burst = 0;
    this.visibleTime = 0;
    this.opacity = 0;
    this.time = 0;
    this.sway = 0;
    this.swayVelocity = 0;
    this.lastSpeed = 0;
    this.flash = 0;
    this.shake = 0;
    this.punch = 0;
    this.element.style.opacity = '0';
    this.element.dataset.flash = 'false';
  }

  // amount and max are health points; major = a joint snapped or the kill shot.
  damage(amount, max, major = false) {
    this.burst += amount;
    if (major || this.burst >= this.config.burstShare * max || this.visibleTime > 0) {
      this.visibleTime = this.config.showTime;
      // React to every hit while the bar is up.
      this.flash = HIT.flashTime;
      this.shake = HIT.shakeTime;
      this.punch = HIT.punchTime;
    }
  }

  // share / trail: 0–1 health and recently-lost chunk. speed01: Leaper speed, 0–1.
  update(dt, camera, robot, share, trail, speed01, canvas) {
    this.time += dt;
    // Recent damage fades out of the burst over its window.
    this.burst = Math.max(0, this.burst - this.burst * Math.min(1, dt / this.config.burstWindow));
    this.visibleTime = Math.max(0, this.visibleTime - dt);
    // The white flash lasts whole frames: shown this frame, cleared once its time is up.
    this.element.dataset.flash = String(this.flash > 0);
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.punch = Math.max(0, this.punch - dt);
    // Pops in at full strength with the hit (so the flash and punch read), fades out gently.
    this.opacity = this.visibleTime > 0 ? 1 : Math.max(0, this.opacity - FADE_SPEED * dt);
    const style = this.element.style;
    style.opacity = this.opacity.toFixed(3);
    if (this.opacity <= 0) return;
    robot.updateMatrixWorld(true);
    this.point.copy(ANCHOR).applyMatrix4(robot.matrixWorld).project(camera);
    const behind = this.point.z > 1;
    style.visibility = behind ? 'hidden' : 'visible';
    if (behind) return;
    // Walking wobble, plus a springy lean when the Leaper speeds up or stops.
    const speed = THREE.MathUtils.clamp(speed01, 0, 1);
    this.swayVelocity += ((speed - this.lastSpeed) * 40 - this.sway * 90 - this.swayVelocity * 9) * dt;
    this.sway += this.swayVelocity * dt;
    this.lastSpeed = speed;
    const wobble = Math.sin(this.time * 9) * 4 * speed + this.sway * 6;
    const bob = Math.abs(Math.sin(this.time * 9)) * 3 * speed;
    const width = canvas?.clientWidth ?? window.innerWidth, height = canvas?.clientHeight ?? window.innerHeight;
    // Shake: a fast side-to-side buzz that dies out; punch: ease-out back to 1x.
    const shakeLeft = this.shake / HIT.shakeTime;
    const shake = Math.sin(this.shake * 140) * HIT.shakePixels * shakeLeft;
    const punchLeft = this.punch / HIT.punchTime;
    // Aiming zooms the view in; grow the bar by the same magnification so it
    // stays in proportion to the (now bigger-looking) Leaper.
    const zoom = Math.tan(THREE.MathUtils.degToRad(CHASE_FOV) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const scale = (1 + (HIT.punchScale - 1) * punchLeft * punchLeft) * Math.max(1, zoom);
    const x = (this.point.x + 1) / 2 * width + shake, y = (1 - this.point.y) / 2 * height;
    style.transform = `translate(${x.toFixed(1)}px, ${(y - bob).toFixed(1)}px) translate(-50%, -100%) rotate(${wobble.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    style.setProperty('--hp', share.toFixed(4));
    style.setProperty('--trail', Math.max(share, trail).toFixed(4));
    style.setProperty('--hp-colour', healthColour(share));
    this.element.dataset.level = share <= 0.25 ? 'low' : 'ok';
  }
}
