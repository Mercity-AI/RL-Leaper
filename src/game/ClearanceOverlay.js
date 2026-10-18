import * as THREE from 'three';

// SHOW CLEARANCE: a flat map over the floor colouring where a Leaper of this
// size fits. Green = reachable from its spawn, amber = clear but disconnected,
// red = blocked. A conservative design guide, never the brain's route.
// (Moved unchanged out of JunkyardPlaytest.makeOverlay.)
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
    // 1. Flood-fill the navigation grid from the spawn cell.
    const nav = this.world.navigation;
    const reachable = new Uint8Array(nav.free.length);
    const first = nav.nearest({ x: spawn.x / this.world.scale, z: spawn.z / this.world.scale });
    const queue = [first];
    reachable[first] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head];
      const col = i % nav.columns;
      for (const j of [col ? i - 1 : -1, col < nav.columns - 1 ? i + 1 : -1, i - nav.columns, i + nav.columns]) {
        if (j < 0 || j >= nav.free.length || !nav.free[j] || reachable[j]) continue;
        if (!nav.clearLine(nav.point(i), nav.point(j))) continue;
        reachable[j] = 1;
        queue.push(j);
      }
    }
    // 2. Paint one pixel per grid cell.
    const canvas = document.createElement('canvas');
    canvas.width = nav.columns;
    canvas.height = nav.rows;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < nav.free.length; i += 1) {
      ctx.fillStyle = !nav.free[i] ? '#e45555' : reachable[i] ? '#31c98c' : '#ffbb47';
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
    return `Reachable from spawn: ${Math.round(queue.length / Math.max(1, freeCount) * 100)}% of clear floor.`;
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
