import * as THREE from 'three';

// SHOW CLEARANCE: a flat map over the floor colouring where a Leaper of this
// size fits. Green = reachable from its spawn, amber = clear but disconnected,
// red = blocked. A conservative design guide, never the brain's route.
// "Reachable" comes from the region labels the Leaper's grid computed once at
// load (the same ones RESTART RANDOM uses), so a rebuild no longer floods the
// grid again and the overlay and RESTART RANDOM can never disagree.
export class ClearanceOverlay {
  // The mesh is only built by rebuild() (on every reset), so it starts empty.
  constructor({ scene, world }) {
    this.scene = scene;
    this.world = world;
    this.mesh = null;
  }

  // SHOW / HIDE CLEARANCE; remembered across rebuilds.
  get visible() {
    return this.mesh?.visible ?? false;
  }

  set visible(value) {
    if (this.mesh) this.mesh.visible = value;
  }

  // Rebuild for a spawn point (world units). Returns the "reachable" summary text.
  rebuild(spawn = this.world.spawn) {
    const visible = this.visible;
    this.dispose();
    // 1. The spawn's region: every clear cell with the same label is reachable.
    const nav = this.world.navigation;
    const regions = nav.regions ?? nav.labelRegions();
    const region = nav.regionAt({ x: spawn.x / this.world.scale, z: spawn.z / this.world.scale });
    // 2. Paint one pixel per grid cell.
    const canvas = document.createElement('canvas');
    canvas.width = nav.columns;
    canvas.height = nav.rows;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < nav.free.length; i += 1) {
      ctx.fillStyle = !nav.free[i] ? '#e45555' : regions.labels[i] === region ? '#31c98c' : '#ffbb47';
      ctx.fillRect(i % nav.columns, Math.floor(i / nav.columns), 1, 1);
    }
    // 3. Lay it on the floor, drawn over everything so it reads in TOP view.
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    const s = this.world.scale;
    const b = nav.bounds;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(nav.columns * nav.cell * s, nav.rows * nav.cell * s),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((b.minX + nav.columns * nav.cell / 2) * s, 0.2, (b.minZ + nav.rows * nav.cell / 2) * s);
    this.mesh.renderOrder = 5;
    this.mesh.visible = visible;
    this.scene.add(this.mesh);
    const freeCount = nav.free.reduce((sum, v) => sum + v, 0);
    const reachable = region < 0 ? 0 : regions.sizes[region];
    return `Reachable from spawn: ${Math.round(reachable / Math.max(1, freeCount) * 100)}% of clear floor.`;
  }

  // Take the overlay out of the scene and free its GPU memory.
  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.map.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
