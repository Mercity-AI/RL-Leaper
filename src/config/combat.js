// Distances/speeds are in source-map units and scale with the junkyard.
export const COMBAT = Object.freeze({
  lolaHealth: 100, leaperHealth: 600, boltDamage: 8,
  projectileSpeed: 12, weaponRange: 22,
  laserLength: 1.4, laserRadius: 0.012, lowHealthThreshold: 20,
  warning: 0.6, aimLock: 0.2, shotInterval: 2, recovery: 0.35,
  yawLimit: Math.PI / 4, pitchDown: -70 * Math.PI / 180,
  pitchUp: 80 * Math.PI / 180, detectionHalfAngle: 135 * Math.PI / 180,
  bodyRadius: 0.23, headRadius: 0.17, debugDamage: 100,
});
