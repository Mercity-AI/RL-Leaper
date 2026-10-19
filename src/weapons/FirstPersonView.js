import { CAMERA } from '../config/camera.js';

// Aiming down the sights puts the camera inside Lola's head. Instead of hiding
// all of her for each render (which also removed her shadow and her gun), only
// the parts that would block the view stop drawing: their materials stop writing
// colour and depth while the aim is up. The shadow pass uses its own depth
// material, so her full shadow stays on the ground, and her arms and gun stay in
// view (finding aim-weapons-ads-hides-whole-body). It is a state that changes when
// the aim starts or ends, not a trick around every render() call
// (finding aim-weapons-render-hooks-fragile).
//
// (Three.js layers would hide her shadow too in r128: its shadow pass tests
// layers against the main camera.)
export class FirstPersonView {
  // player: Lola (her `mesh` group). hide: material names to stop drawing.
  constructor(player, { hide = CAMERA.firstPersonHide } = {}) {
    this.active = false;
    this.materials = [];
    const names = new Set(hide);
    player.mesh.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material && names.has(material.name) && !this.materials.includes(material)) this.materials.push(material);
      }
    });
    // Each material's own settings, restored when the aim ends.
    this.saved = this.materials.map(material => ({ colorWrite: material.colorWrite, depthWrite: material.depthWrite }));
  }

  // true while aiming down the sights; switching only does work on a change.
  set(active) {
    active = Boolean(active);
    if (active === this.active) return;
    this.active = active;
    this.materials.forEach((material, index) => {
      const saved = this.saved[index];
      material.colorWrite = active ? false : saved.colorWrite;
      material.depthWrite = active ? false : saved.depthWrite;
    });
  }

  // The session is over: every material back to how it was.
  dispose() {
    this.set(false);
  }
}
