import * as THREE from 'three';

// A cheap, every-frame estimate of where Lola's barrel is, for the OBSTRUCTED
// reticle (a real shot still asks Lola for the exact muzzle). Her raised-gun pose
// only exists while a shot or the aim is up, so the tracker remembers where the
// muzzle sat relative to her body the last time it was measured, per gun and per
// stance (standing / crouched), and reuses that between shots.

// Before anything was measured: a rough spot in Lola's own space, as shares of
// her height (her right hand side, chest high, a little in front).
const FIRST_GUESS = Object.freeze({ right: 0.08, up: 0.86, forward: 0.28 });

export class MuzzleTracker {
  constructor() {
    // "<weaponIndex>:<crouched>" -> muzzle offset in Lola's group space.
    this.offsets = new Map();
    this.local = new THREE.Vector3();
  }

  key(player) {
    return `${player.weaponIndex}:${player.crouching ? 1 : 0}`;
  }

  // Has the muzzle been measured for Lola's current gun and stance?
  known(player) {
    return this.offsets.has(this.key(player));
  }

  // Remember a measured muzzle (world space), e.g. the one a real shot used.
  remember(player, worldPoint) {
    player.mesh.updateMatrixWorld();
    const local = player.mesh.worldToLocal(worldPoint.clone());
    this.offsets.set(this.key(player), local);
  }

  // Where the muzzle is now (world space), written into `out`.
  estimate(player, out = new THREE.Vector3()) {
    const known = this.offsets.get(this.key(player));
    if (known) out.copy(known);
    else {
      // Lola faces +Z in her own space; her right hand side is -X.
      const height = player.height ?? 1.7;
      out.set(-FIRST_GUESS.right * height, FIRST_GUESS.up * height, FIRST_GUESS.forward * height);
    }
    player.mesh.updateMatrixWorld();
    return player.mesh.localToWorld(out);
  }

  // Forget every measurement (the outfit or the map size changed).
  clear() {
    this.offsets.clear();
  }
}
