import * as THREE from 'three';
import { JunkyardBrain } from './JunkyardBrain.js';
import { randomJunkyardStart } from '../world/randomJunkyardStart.js';

export class JunkyardPlaytest {
  constructor({ engine, world, simulation, target, cameraController }) {
    Object.assign(this, { engine, world, simulation, target, cameraController });
    this.walking = false;
    document.body.classList.add('junkyard-mode');
    document.querySelector('.sub').textContent = 'JUNKYARD // LOLA + LEAPER';
    this.panel = document.createElement('section');
    this.panel.id = 'junkyardPanel';
    this.panel.innerHTML = `
      <div class="junkyard-toolbar">
        <button data-action="route">START RUN</button>
        <button data-action="random">RESTART RANDOM</button>
        <button data-action="panel" aria-expanded="false" aria-controls="junkyardOptions">OPTIONS</button>
      </div>
      <div class="brain-state" aria-live="polite">BRAIN CONNECTING</div>
      <div id="junkyardOptions" hidden>
      <strong>JUNKYARD PLAYTEST</strong>
      <label>Leaper clearance width
        <output>${world.width.toFixed(1)} units</output>
      </label>
      <div class="size-controls"><input type="range" aria-label="Leaper clearance width" min="1.2" max="8" step="0.1" value="${world.width}" />
      <button data-action="size">APPLY SIZE</button></div>
      <div class="junkyard-actions"><button data-action="reset">RESET</button>
        <button data-action="clearance">SHOW CLEARANCE</button></div>
      <p data-message>WASD to explore. In TOP view, Shift + click sets the destination.</p>
      <small>Live trained brain · 7,757,824 steps · vision and memory · inference only. Clearance overlay is a conservative design guide, not the brain’s route. <span data-clearance-summary></span></small>
      <p class="clearance-key" hidden>Green: reachable · Amber: disconnected · Red: blocked at this size</p>
      </div>`;
    document.body.appendChild(this.panel);
    this.panel.querySelector('[data-action=panel]').onclick = (event) => {
      const options = this.panel.querySelector('#junkyardOptions');
      options.hidden = !options.hidden;
      this.panel.classList.toggle('expanded', !options.hidden);
      event.currentTarget.setAttribute('aria-expanded', String(!options.hidden));
      event.currentTarget.textContent = options.hidden ? 'OPTIONS' : 'HIDE OPTIONS';
    };
    this.message = this.panel.querySelector('[data-message]');
    this.brainLabel = this.panel.querySelector('.brain-state');
    this.brain = new JunkyardBrain(this);
    document.querySelector('.keys').innerHTML = '<b>WASD</b> MOVE LOLA · <b>SHIFT</b> RUN · <b>F</b> SWITCH GUN<br /><b>CLICK + MOUSE</b> LOOK · <b>ESC</b> RELEASE MOUSE · <b>VIEW</b> TOP / CHASE';
    target.setSelected(true);
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
    this.panel.querySelector('[data-action=route]').onclick = () => this.walking ? this.stop('Run stopped. Press START RUN to chase Lola again.') : this.start();
    this.panel.querySelector('[data-action=reset]').onclick = () => this.reset();
    this.panel.querySelector('[data-action=random]').onclick = () => {
      const spawn = randomJunkyardStart(this.world, this.simulation.state.position);
      if (!spawn) {
        this.brainLabel.textContent = 'NO ROOM FOR A RANDOM PAIR — TRY A SMALLER SIZE';
        this.message.textContent = 'No separated, connected spawn pair found at this size. Try a smaller Leaper.';
        if (this.panel.querySelector('#junkyardOptions').hidden) {
          this.panel.querySelector('[data-action=panel]').click();
        }
        return;
      }
      this.reset(spawn);
      this.makeOverlay(spawn.position);
      this.start();
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
    engine.scene.fog.far = 64 * world.scale;
    if (!target.isPlayer) this.topView();
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
      if (target.isPlayer && world.playerBlocked(point.x, point.z)) {
        this.message.textContent = 'Choose clear ground for Lola.';
        return;
      }
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
    this.brain.start();
  }

  stop(message) {
    this.walking = false;
    this.brain.stop();
    this.message.textContent = message;
    this.panel.querySelector('[data-action=route]').textContent = 'START RUN';

  }

  reset(spawn = null) {
    this.stop('WASD moves Lola. Shift runs. F switches guns. Start Run lets the trained brain search and chase.');
    const { x, z } = spawn?.position || this.world.spawn;
    if (spawn) this.target.mesh.position.set(spawn.target.x, this.target.isPlayer ? 0 : 3.5, spawn.target.z);
    const state = this.simulation.state;
    state.position.set(x, 0, z);
    state.previousVelocity.set(0, 0, 0);
    state.jumpHeight = 0;
    state.verticalVelocity = 0;
    state.grounded = true;
    state.yaw = spawn?.yaw || 0;
    state.velocity.set(0, 0, 0);
    this.simulation.rig.legs.forEach((leg) => {
      const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
      leg.footPosition.set(x + leg.homeLocal.x * c + leg.homeLocal.z * s, 0.1,
        z - leg.homeLocal.x * s + leg.homeLocal.z * c);
      leg.stepping = false;
    });
    this.cameraController.target.copy(this.target.mesh.position);
    this.cameraController.target.y = this.target.height ? this.target.height * 0.65 : 1;
    this.brain.reset();
    if (!spawn && this.overlay) this.makeOverlay();
  }

  makeOverlay(spawn = this.world.spawn) {
    const visible = this.overlay?.visible || false;
    if (this.overlay) {
      this.engine.scene.remove(this.overlay);
      this.overlay.geometry.dispose();
      this.overlay.material.map.dispose();
      this.overlay.material.dispose();
    }
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
    this.overlay.visible = visible;
    this.engine.scene.add(this.overlay);
    const freeCount = nav.free.reduce((sum, v) => sum + v, 0);
    this.panel.querySelector('[data-clearance-summary]').textContent = `Reachable from spawn: ${Math.round(queue.length / Math.max(1, freeCount) * 100)}% of clear floor.`;
  }

  update(dt) {
    this.brain.update(dt);
  }
}
