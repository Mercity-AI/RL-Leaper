import { SHOOTING } from '../config/tuning/index.js';

// One gun's rules with no page, scene or character attached, so they can be
// tested in Node: its ammunition, when it may fire next, its reload timer and how
// far its shots currently spread. The PlayerWeapon coordinator owns one of these
// per gun and decides what a shot actually hits.
export class WeaponState {
  // weapon: an entry of WEAPONS (src/config/weapons.js).
  constructor(weapon, { maxShotsPerFrame = SHOOTING.maxShotsPerFrame } = {}) {
    this.weapon = weapon;
    this.maxShotsPerFrame = maxShotsPerFrame;
    this.refill();
  }

  // ---- Lifecycle ----

  // A fresh gun: full magazine and spares, ready to fire, no reload, no bloom.
  refill() {
    this.mag = this.weapon.magazine;
    this.reserve = this.weapon.reserve;
    this.cooldown = 0;
    this.reloadRemaining = 0;
    this.reloadTotal = 0;
    this.reloadSoundPlayed = false;
    this.bloom = 0;
    this.sinceShot = Infinity;
  }

  // Let go of everything in progress: the gun may fire at once again and its
  // spread is back to the base cone (the magazine stays as it is).
  settle() {
    this.cooldown = 0;
    this.bloom = 0;
    this.sinceShot = Infinity;
  }

  // ---- Questions the coordinator asks ----

  get reloading() { return this.reloadRemaining > 0; }

  // 0..1 progress of the reload in progress (0 when none).
  get reloadProgress() {
    return this.reloading && this.reloadTotal > 0 ? 1 - this.reloadRemaining / this.reloadTotal : 0;
  }

  // A reload would do something: not already reloading, room in the magazine and spares left.
  get canReload() {
    return !this.reloading && this.mag < this.weapon.magazine && this.reserve > 0;
  }

  // Current cone half-angle in radians. aiming: aiming down the sights; moving: Lola walks.
  spread({ aiming = false, moving = false } = {}) {
    const { spread, ads } = this.weapon;
    const cone = spread.base * (moving ? spread.moving : 1) + this.bloom;
    return cone * (aiming ? ads.spread : 1);
  }

  // ---- Time ----

  // Advance one frame. The fire-rate clock keeps up to one shot's worth of
  // overshoot (instead of throwing it away), so an automatic gun fires exactly
  // 1 / interval shots per second at any frame rate (review fix 5.34). Returns
  // what happened: { reloadSound, reloadDone }.
  advance(dt) {
    const events = { reloadSound: false, reloadDone: false };
    if (!(dt > 0)) return events;
    this.cooldown = Math.max(this.cooldown - dt, -this.weapon.interval);
    // Spread blooms with each shot and shrinks back once the gun has rested.
    this.sinceShot += dt;
    if (this.sinceShot > this.weapon.spread.bloomDelay) {
      this.bloom = Math.max(0, this.bloom - this.weapon.spread.bloomRecovery * dt);
    }
    // The reload's sound lands on the animation's hand work; the magazine refills at the end.
    if (this.reloading) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
      if (!this.reloadSoundPlayed && this.reloadTotal - this.reloadRemaining >= this.weapon.reloadSoundAt) {
        this.reloadSoundPlayed = true;
        events.reloadSound = true;
      }
      if (!this.reloading) {
        this.finishReload();
        events.reloadDone = true;
      }
    }
    return events;
  }

  // ---- Reload ----

  // Start a reload that takes `duration` seconds (Lola's animation, or the gun's
  // reloadTime). Returns false when there is nothing to reload.
  startReload(duration = this.weapon.reloadTime) {
    if (!this.canReload) return false;
    this.reloadTotal = Math.max(1e-6, duration);
    this.reloadRemaining = this.reloadTotal;
    this.reloadSoundPlayed = false;
    return true;
  }

  // Abandon the reload in progress (switching guns, jumping, stopping the run).
  cancelReload() {
    this.reloadRemaining = 0;
    this.reloadTotal = 0;
  }

  // The magazine fills from the spares.
  finishReload() {
    const take = Math.min(this.weapon.magazine - this.mag, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloadRemaining = 0;
  }

  // ---- The trigger ----

  // Pull (or keep holding) the trigger for this frame.
  //   trigger: { pressed, held }  pressed = it went down this frame
  //   shoot(): fires one real bullet; returns false when Lola can't shoot right now
  //            (mid-jump, say), which spends nothing
  // Returns { shots, dryFire, needsReload }:
  //   shots        bullets fired this frame
  //   dryFire      the empty-gun click should play
  //   needsReload  the coordinator should start a reload now
  pull(trigger, shoot) {
    const result = { shots: 0, dryFire: false, needsReload: false };
    const { interval, automatic } = this.weapon;
    // 1. A fresh press fires one shot once the gun has cycled. An empty gun clicks
    //    instead (also mid-reload) and, outside a reload, starts one.
    if (trigger.pressed && this.cooldown <= 0) {
      if (this.mag <= 0) {
        this.cooldown = interval;
        result.dryFire = true;
        result.needsReload = !this.reloading;
      } else if (!this.reloading && this.fireOne(shoot, true)) {
        result.shots += 1;
      }
    }
    // 2. Holding an automatic gun keeps firing on the carried-over clock. It stops
    //    at an empty magazine (the reload starts below) instead of clicking.
    if (automatic && trigger.held) {
      while (result.shots < this.maxShotsPerFrame && this.cooldown <= 0 && !this.reloading && this.mag > 0) {
        if (!this.fireOne(shoot, false)) break;
        result.shots += 1;
      }
    }
    // 3. Once the last round's shot has cycled, an empty gun reloads by itself.
    if (!this.reloading && this.mag <= 0 && this.cooldown <= 0 && this.reserve > 0) result.needsReload = true;
    return result;
  }

  // One bullet: spend a round, start the next shot's wait, bloom the spread.
  // A fresh press waits a whole interval; held fire keeps the overshoot.
  fireOne(shoot, fresh) {
    if (!shoot()) return false;
    this.mag -= 1;
    this.cooldown = (fresh ? Math.max(this.cooldown, 0) : this.cooldown) + this.weapon.interval;
    this.bloom = Math.min(this.weapon.spread.bloomMax, this.bloom + this.weapon.spread.bloomPerShot);
    this.sinceShot = 0;
    return true;
  }
}
