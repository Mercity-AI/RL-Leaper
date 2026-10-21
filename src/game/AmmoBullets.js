import { AMMO_BULLETS } from '../config/pickups.js';
import { FloatingPickups } from './FloatingPickups.js';

// Ammo bullets: yellow glowing bullets floating around the yard (see
// FloatingPickups for how they are scattered, look and move). Lola walks
// through one, it vanishes and her M416 gets 40 spare rounds (two
// magazines), up to the most it can carry; while its spares are full (or she
// is down) she leaves them where they are.
export class AmmoBullets extends FloatingPickups {
  // weapon: the PlayerWeapon (addAmmo, spareRoom). defeated(): Lola is down.
  // model: the bullet's loaded glTF scene. The rest as FloatingPickups.
  constructor({ weapon, defeated = () => false, config = AMMO_BULLETS, ...options }) {
    super({ ...options, config });
    Object.assign(this, { weapon, defeated });
  }

  // The bullets (each { x, z, holder, spinner, taken, ... }).
  get bullets() {
    return this.items;
  }

  canTake() {
    return !this.defeated() && this.weapon.spareRoom(this.config.gun) > 0;
  }

  take() {
    this.weapon.addAmmo(this.config.gun, this.config.rounds);
  }
}
