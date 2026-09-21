import * as THREE from 'three';

export class JunkyardPlaytest {
  constructor({ engine, world, simulation, target, cameraController }) {
    Object.assign(this, { engine, world, simulation, target, cameraController });
    this.path = [];
    this.walking = false;
    this.replanDelay = 0;
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
      <div class="junkyard-actions"><button data-action="route">START RUN</button>
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
      url.searchParams.set('run', this.walking ? '1' : '0');
      location.assign(url);
    };
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panel.querySelector('[data-action=route]').onclick = () => this.walking ? this.stop('Run stopped. Press START RUN to chase pink again.') : this.start();
    this.panel.querySelector('[data-action=reset]').onclick = () => this.reset();
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
      target.mesh.position.x = point.x;
      target.mesh.position.z = point.z;
      if (!this.walking) this.message.textContent = 'Target moved. Press START RUN to chase it.';
    });
    if (new URLSearchParams(location.search).get('run') === '1') this.start();
  }

  topView() {
    while (this.cameraController.mode !== 'TOP') this.cameraController.toggle();
  }

  start() {
    this.walking = true;
    this.target.setSelected(true);
    this.panel.querySelector('[data-action=route]').textContent = 'STOP RUN';
    this.plan();
  }

  hold(message) {
    this.path = [];
    this.simulation.navigationMove = null;
    this.simulation.state.velocity.set(0, 0, 0);
    this.message.textContent = message;
  }

  stop(message) {
    this.walking = false;
    this.hold(message);
    this.panel.querySelector('[data-action=route]').textContent = 'START RUN';
    if (this.routeLine) this.routeLine.visible = false;
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
    this.goal = goal.clone();
    this.replanDelay = 0.3;
    const route = this.world.navigation.route({ x: start.x / s, z: start.z / s }, { x: goal.x / s, z: goal.z / s });
    if (this.routeLine) {
      this.engine.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
      this.routeLine = null;
    }
    if (!route.length) {
      this.hold('Run active — no clear route. Move pink onto reachable floor; Leaper will keep chasing.');
      return;
    }
    this.path = route.slice(1).map((p) => new THREE.Vector3(p.x * s, 0, p.z * s));
    this.goal = goal.clone();
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.map((p) => new THREE.Vector3(p.x * s, 0.4, p.z * s))),
      new THREE.LineBasicMaterial({ color: 0x00a6b0, depthTest: false }));
    this.routeLine.renderOrder = 6;
    this.engine.scene.add(this.routeLine);
    this.stallTime = 0;
    this.previous.copy(start);
    this.message.textContent = 'Chasing pink. Move it with IJKL or Shift + click in TOP view. STOP RUN ends the chase.';
  }

  update(dt) {
    if (!this.walking) return;
    const movement = this.simulation.input.getMovement();
    this.replanDelay = Math.max(0, this.replanDelay - dt);
    if (movement.forward || movement.side) {
      this.path = [];
      this.simulation.navigationMove = null;
      this.message.textContent = 'Run active — manual steering. Release WASD to resume chasing.';
      this.goal = null;
      return;
    }
    if (!this.goal || (this.target.mesh.position.distanceTo(this.goal) > 0.05 && this.replanDelay === 0)) this.plan();
    if (!this.path.length) return;
    const position = this.simulation.state.position;
    const delta = this.path[0].clone().sub(position);
    if (delta.length() < 0.18) {
      this.path.shift();
      this.simulation.state.velocity.set(0, 0, 0);
      if (!this.path.length) {
        return this.hold('Target reached — run still active. Move pink and Leaper will follow.');
      }
      delta.copy(this.path[0]).sub(position);
    }
    if (position.distanceTo(this.previous) < 0.002) this.stallTime += dt;
    else this.stallTime = 0;
    this.previous.copy(position);
    if (this.stallTime > 2) {
      this.hold('Run active — replanning around an obstacle.');
      this.goal = null;
      return;
    }
    const distance = delta.length();
    this.simulation.navigationMove = delta.normalize().multiplyScalar(Math.min(0.8, distance / 2));
  }
}
