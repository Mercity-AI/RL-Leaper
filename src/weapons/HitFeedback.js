import { HIT_FEEDBACK } from '../config/tuning/index.js';

// The player's reward for landing hits, as timers (no page code, testable in
// Node): the crosshair kick, the weak-point flash, the "big hit" hold and blue
// edge glow, and a hit marker whose look depends on what the bullet did:
//   normal  an ordinary hit on the body or a leg
//   weak    the eye's red core (the weak point)
//   joint   the hit snapped a joint off
//   kill    the hit finished the Leaper
// The weapon's views read `state` every frame.
export class HitFeedback {
  constructor(config = HIT_FEEDBACK) {
    this.config = config;
    this.clear();
  }

  // Which marker a hit outcome shows (the most important thing that happened).
  static markerKind({ killed = false, brokeJoint = false, weakPoint = false } = {}) {
    if (killed) return 'kill';
    if (brokeJoint) return 'joint';
    if (weakPoint) return 'weak';
    return 'normal';
  }

  // A bullet hit an enemy. outcome: { killed, brokeJoint, weakPoint }.
  // Returns the marker kind it showed.
  hit(outcome) {
    const kind = HitFeedback.markerKind(outcome);
    this.hitTime = this.config.hitTime;
    if (outcome.weakPoint) this.critTime = this.config.critTime;
    if (kind === 'kill' || kind === 'joint') {
      this.bigHitTime = this.config.bigHitTime;
      this.glow = 1;
    }
    this.marker = { kind, time: this.config.markers[kind], life: this.config.markers[kind] };
    return kind;
  }

  // A bullet missed every enemy: the crosshair's hit kick stops at once.
  miss() {
    this.hitTime = 0;
  }

  // Run every timer down. The glow keeps fading even while the gun can't be used
  // (the kill shot's glow plays out after the fight ends).
  update(dt) {
    if (!(dt > 0)) return;
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.critTime = Math.max(0, this.critTime - dt);
    this.bigHitTime = Math.max(0, this.bigHitTime - dt);
    this.glow = Math.max(0, this.glow - dt / this.config.edgeGlowTime);
    if (this.marker) {
      this.marker.time = Math.max(0, this.marker.time - dt);
      if (!this.marker.time) this.marker = null;
    }
  }

  // Everything off at once (a restart).
  clear() {
    this.hitTime = 0;
    this.critTime = 0;
    this.bigHitTime = 0;
    this.glow = 0;
    this.marker = null;
  }

  // What the views show now. marker.strength runs 1 -> 0 as it fades.
  get state() {
    return {
      hit: this.hitTime > 0,
      crit: this.critTime > 0,
      big: this.bigHitTime > 0,
      glow: this.glow,
      marker: this.marker ? { kind: this.marker.kind, strength: this.marker.time / this.marker.life } : null,
    };
  }
}
