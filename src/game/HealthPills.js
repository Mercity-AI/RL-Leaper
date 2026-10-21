import { HEALTH_PILLS } from '../config/pickups.js';
import { FloatingPickups } from './FloatingPickups.js';

// Health pills: blue glowing pills floating around the yard (see
// FloatingPickups for how they are scattered, look and move). Lola walks
// through one, it vanishes and she gets back 10% of her total health; while
// she is at full health (or down) she leaves them where they are.
export class HealthPills extends FloatingPickups {
  // vitals: Lola's PlayerVitals. model: the pill's loaded glTF scene
  // (Pill_Health_Leaper). The rest as FloatingPickups.
  constructor({ vitals, config = HEALTH_PILLS, ...options }) {
    super({ ...options, config });
    this.vitals = vitals;
  }

  // The pills (each { x, z, holder, spinner, taken, ... }).
  get pills() {
    return this.items;
  }

  canTake() {
    const { vitals } = this;
    return !vitals.dead && (!this.config.needsDamage || vitals.health < vitals.max);
  }

  take() {
    this.vitals.heal(this.vitals.max * this.config.heal);
  }
}
