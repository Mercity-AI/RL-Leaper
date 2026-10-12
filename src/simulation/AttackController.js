// A priority-selector behaviour tree. State/timers survive ticks; movement is
// deliberately absent from this interface. The caller supplies visible points.
export class AttackController {
  constructor(config) { this.config = config; this.reset(); }
  reset() {
    this.time = 0; this.nextShot = 0; this.started = null;
    this.locked = false; this.state = 'target hidden'; this.shots = 0;
  }
  cancel() {
    if (this.started !== null) this.nextShot = Math.max(this.nextShot, this.time + this.config.recovery);
    this.started = null; this.locked = false;
  }
  tick(dt, context) {
    const c = context;
    if (c.dead || c.paused) {
      this.cancel(); this.state = c.dead ? 'dead' : 'paused'; return;
    }
    this.time += dt;
    // Selector: first matching guard wins. Visibility precedes aim and cooldown.
    const branches = [
      [() => !c.visible, () => { this.cancel(); this.state = 'target hidden'; }],
      [() => !c.canAim, () => { this.cancel(); this.state = 'tracking'; }],
      [() => this.time + 1e-9 < this.nextShot, () => { c.track(); this.state = 'cooling down'; }],
      [() => true, () => this.attack(c)],
    ];
    branches.find(([guard]) => guard())[1]();
  }
  attack(c) {
    if (this.started === null) {
      this.started = this.time; this.locked = false;
    }
    const age = this.time - this.started;
    if (!this.locked) {
      if (age <= this.config.warning - this.config.aimLock + 1e-9) c.track();
      if (age + 1e-9 >= this.config.warning - this.config.aimLock) this.locked = true;
    }
    // Check the actual locked ray throughout the final warning and at release.
    if (!c.pathClear(this.locked)) {
      this.cancel(); this.state = 'target hidden'; return;
    }
    this.state = 'charging';
    if (age + 1e-9 >= this.config.warning) {
      c.fire(); this.shots += 1; this.started = null; this.locked = false;
      this.nextShot = this.time + this.config.shotInterval;
      this.state = 'firing';
    }
  }
}
