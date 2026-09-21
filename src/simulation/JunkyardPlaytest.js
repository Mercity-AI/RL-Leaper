import * as THREE from 'three';

export class JunkyardPlaytest {
  constructor({ engine, world, simulation, target, cameraController }) {
    Object.assign(this, { engine, world, simulation, target, cameraController });
    this.path = [];
    this.walking = false;
    this.stallTime = 0;
    this.previous = new THREE.Vector3();
    document.body.classList.add('junkyard-mode');
    document.querySelector('.sub').textContent = 'JUNKYARD // PATHWAY PLAYTEST';
    this.panel = document.createElement('section');
    this.panel.id = 'junkyardPanel';
    this.panel.innerHTML = `
      <strong>JUNKYARD PLAYTEST</strong>
      <label>Leaper clearance width
        <output>${world.width.toFixed(1)} units</output>
      </label>
      <div class="size-controls"><input type="range" aria-label="Leaper clearance width" min="1.2" max="8" step="0.1" value="${world.width}" />
      <button data-action="size">APPLY SIZE</button></div>
      <div class="junkyard-actions"><button data-action="route">WALK TO PINK</button>
        <button data-action="demo">LOOP DEMO</button>
        <button data-action="reset">RESET</button>
        <button data-action="clearance">SHOW CLEARANCE</button></div>
      <p data-message>WASD to explore. In TOP view, Shift + click sets the destination.</p>
      <small>Flat-ground pathfinding preview · circular leg clearance · no climbing or learned AI.</small>
      <p class="clearance-key" hidden>Green: reachable · Amber: disconnected · Red: blocked at this size</p>`;
    document.body.appendChild(this.panel);
    this.message = this.panel.querySelector('[data-message]');
    const size = this.panel.querySelector('input');
    size.addEventListener('input', () => {
      this.panel.querySelector('output').textContent = `${Number(size.value).toFixed(1)} units`;
    });
    this.panel.querySelector('[data-action=size]').onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set('width', size.value);
      location.assign(url);
    };
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panel.querySelector('[data-action=route]').onclick = () => this.walking ? this.stop('Route paused. WASD to explore.') : this.plan();
    this.panel.querySelector('[data-action=reset]').onclick = () => this.reset();
    this.panel.querySelector('[data-action=demo]').onclick = () => {
      if (this.looping) return this.stop('Demo stopped. WASD to explore.');
      this.reset();
      const nav = world.navigation;
      const start = { x: world.spawn.x / world.scale, z: world.spawn.z / world.scale };
      let best = null;
      // A reproducible tour destination across the yard, reachable at this size.
      for (const point of [{ x: 12, z: 12 }, { x: -12, z: -10 }, { x: 12, z: -12 }, { x: 0, z: 8 }]) {
        const goal = nav.point(nav.nearest(point));
        const route = nav.route(start, goal);
        if (route.length && (!best || Math.hypot(goal.x - start.x, goal.z - start.z) > best.distance)) {
          best = { goal, distance: Math.hypot(goal.x - start.x, goal.z - start.z) };
        }
      }
      if (!best) return this.stop('No demo route at this size. Try a smaller Leaper.');
      this.demoEnds = [new THREE.Vector3(world.spawn.x, 3.5, world.spawn.z),
        new THREE.Vector3(best.goal.x * world.scale, 3.5, best.goal.z * world.scale)];
      this.demoEnd = 1;
      target.mesh.position.copy(this.demoEnds[1]);
      this.plan();
      this.looping = this.walking;
      this.panel.querySelector('[data-action=demo]').textContent = this.looping ? 'STOP DEMO' : 'LOOP DEMO';
      cameraController.mode = 'TOP';
      cameraController.toggle();
    };
    this.panel.querySelector('[data-action=clearance]').onclick = (e) => {
      this.overlay.visible = !this.overlay.visible;
      e.target.textContent = this.overlay.visible ? 'HIDE CLEARANCE' : 'SHOW CLEARANCE';
      this.panel.querySelector('.clearance-key').hidden = !this.overlay.visible;
      if (this.overlay.visible) this.topView();
    };
    cameraController.mapScale = world.scale;
    cameraController.topHeight = 43 * world.scale;
    engine.camera.far = 500 * world.scale;
    engine.camera.updateProjectionMatrix();
    engine.scene.fog.near = 35 * world.scale;
    this.topView();
    this.reset();
    this.makeOverlay();
    const raycaster = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    engine.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey || cameraController.mode !== 'TOP') return;
      cameraController.pointerId = null;
      const rect = engine.renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        (e.clientX - rect.left) / rect.width * 2 - 1,
        -(e.clientY - rect.top) / rect.height * 2 + 1,
      ), engine.camera);
      const point = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
      if (!point) return;
      this.stop('Destination moved. Press WALK TO PINK to test the route.');
      target.mesh.position.x = point.x;
      target.mesh.position.z = point.z;
    });
  }

  topView() {
    while (this.cameraController.mode !== 'TOP') this.cameraController.toggle();
  }

  stop(message) {
    this.looping = false;
    this.panel.querySelector('[data-action=demo]').textContent = 'LOOP DEMO';
    this.walking = false;
    this.simulation.navigationMove = null;
    this.simulation.state.velocity.set(0, 0, 0);
    this.panel.querySelector('[data-action=route]').textContent = 'WALK TO PINK';
    this.message.textContent = message;
  }

  reset() {
    this.stop('WASD to explore. In TOP view, Shift + click sets the destination.');
    const { x, z } = this.world.spawn;
    const state = this.simulation.state;
    state.position.set(x, 0, z);
    state.previousVelocity.set(0, 0, 0);
    state.jumpHeight = 0;
    state.verticalVelocity = 0;
    state.grounded = true;
    state.yaw = 0;
    this.simulation.rig.legs.forEach((leg) => {
      leg.footPosition.set(x + leg.homeLocal.x, 0.1, z + leg.homeLocal.z);
      leg.stepping = false;
    });
    this.cameraController.target.set(x, 1, z);
    if (this.routeLine) this.routeLine.visible = false;
  }

  makeOverlay() {
    const nav = this.world.navigation;
    const reachable = new Uint8Array(nav.free.length);
    const first = nav.nearest({ x: this.world.spawn.x / this.world.scale, z: this.world.spawn.z / this.world.scale });
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
    const canvas = document.createElement('canvas');
    canvas.width = nav.columns;
    canvas.height = nav.rows;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < nav.free.length; i += 1) {
      ctx.fillStyle = !nav.free[i] ? '#e45555' : reachable[i] ? '#31c98c' : '#ffbb47';
      ctx.fillRect(i % nav.columns, Math.floor(i / nav.columns), 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    const s = this.world.scale;
    const b = nav.bounds;
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(nav.columns * nav.cell * s, nav.rows * nav.cell * s),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }));
    this.overlay.rotation.x = -Math.PI / 2;
    this.overlay.position.set((b.minX + nav.columns * nav.cell / 2) * s, 0.2, (b.minZ + nav.rows * nav.cell / 2) * s);
    this.overlay.renderOrder = 5;
    this.overlay.visible = false;
    this.engine.scene.add(this.overlay);
    const freeCount = nav.free.reduce((sum, v) => sum + v, 0);
    this.panel.querySelector('small').textContent += ` Reachable from spawn: ${Math.round(queue.length / Math.max(1, freeCount) * 100)}% of clear floor.`;
  }

  plan() {
    const s = this.world.scale;
    const start = this.simulation.state.position;
    const goal = this.target.mesh.position;
    const route = this.world.navigation.route({ x: start.x / s, z: start.z / s }, { x: goal.x / s, z: goal.z / s });
    if (this.routeLine) {
      this.engine.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
      this.routeLine = null;
    }
    if (!route.length) {
      this.stop('No clear ground route at this size. Move pink to open floor, or try a smaller Leaper.');
      return;
    }
    this.path = route.slice(1).map((p) => new THREE.Vector3(p.x * s, 0, p.z * s));
    this.goal = goal.clone();
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.map((p) => new THREE.Vector3(p.x * s, 0.4, p.z * s))),
      new THREE.LineBasicMaterial({ color: 0x00a6b0, depthTest: false }));
    this.routeLine.renderOrder = 6;
    this.engine.scene.add(this.routeLine);
    this.walking = true;
    this.stallTime = 0;
    this.previous.copy(start);
    this.panel.querySelector('[data-action=route]').textContent = 'STOP WALKING';
    this.message.textContent = 'Following the blue route. WASD takes over; moving pink stops the route.';
  }

  update(dt) {
    if (!this.walking) return;
    const movement = this.simulation.input.getMovement();
    if (movement.forward || movement.side) return this.stop('Manual control. Press WALK TO PINK to plan again.');
    if (this.target.mesh.position.distanceTo(this.goal) > 0.05) return this.stop('Destination moved. Press WALK TO PINK to plan again.');
    const position = this.simulation.state.position;
    const delta = this.path[0].clone().sub(position);
    if (delta.length() < 0.18) {
      this.path.shift();
      this.simulation.state.velocity.set(0, 0, 0);
      if (!this.path.length) {
        if (this.looping) {
          this.demoEnd = 1 - this.demoEnd;
          this.target.mesh.position.copy(this.demoEnds[this.demoEnd]);
          this.plan();
          return;
        }
        return this.stop('Destination reached! Move pink to test another pathway.');
      }
      delta.copy(this.path[0]).sub(position);
    }
    if (position.distanceTo(this.previous) < 0.002) this.stallTime += dt;
    else this.stallTime = 0;
    this.previous.copy(position);
    if (this.stallTime > 2) return this.stop('Movement blocked. Try a wider route or a smaller Leaper.');
    const distance = delta.length();
    this.simulation.navigationMove = delta.normalize().multiplyScalar(Math.min(0.8, distance / 2));
  }
}
