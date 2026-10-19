// A priority-selector behaviour tree. State/timers survive ticks; movement is
// deliberately absent from this interface. The caller supplies visible points.
// The Leaper's behaviour layer (src/actors/leaper/) may hold it (no bolts in
// this state, e.g. while it stomps or leaps) or interrupt it (a stagger).
// Optional hooks for telegraphs and sound: onStart (a wind-up begins), onLock
// (the aim locks), onCancel (a wind-up is called off).
export class AttackController {
  constructor(config, hooks = {}) { this.config = config; this.hooks = hooks; this.reset(); }
  reset() {
    this.time = 0; this.nextShot = 0; this.started = null;
    this.locked = false; this.state = 'target hidden'; this.shots = 0;
  }
  cancel() {
    if (this.started !== null) {
      this.nextShot = Math.max(this.nextShot, this.time + this.config.recovery);
      this.hooks.onCancel?.();
    }
    this.started = null; this.locked = false;
  }
  // A big hit: any wind-up is cancelled and the next shot waits at least `recovery` seconds.
  interrupt(recovery = this.config.recovery) {
    this.cancel();
    this.nextShot = Math.max(this.nextShot, this.time + recovery);
  }
  tick(dt, context) {
    const c = context;
    if (c.dead || c.paused) {
      this.cancel(); this.state = c.dead ? 'dead' : 'paused'; return;
    }
    this.time += dt;
    // Held by the behaviour layer: cooldowns keep running, nothing winds up.
    if (c.held) {
      this.cancel(); this.state = 'holding'; return;
    }
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
      this.hooks.onStart?.();
    }
    const age = this.time - this.started;
    if (!this.locked) {
      if (age <= this.config.warning - this.config.aimLock + 1e-9) c.track();
      if (age + 1e-9 >= this.config.warning - this.config.aimLock) {
        this.locked = true;
        this.hooks.onLock?.();
      }
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
