import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class LolaPlayer {
  static async create(scene, world, toggleButton) {
    const loader = new GLTFLoader();
    const models = await Promise.all([
      loader.loadAsync(new URL('../../assets/characters/lola/lola-m416.glb', import.meta.url).href),
      loader.loadAsync(new URL('../../assets/characters/lola/lola-basic.glb', import.meta.url).href),
    ]);
    return new LolaPlayer(scene, world, toggleButton, models);
  }

  constructor(scene, world, toggleButton, models) {
    this.world = world;
    this.selected = true;
    this.isPlayer = true;
    this.height = 1.9 * world.scale;
    this.mesh = new THREE.Group();
    this.mesh.position.set(world.initialTarget.x, 0, world.initialTarget.z);
    this.direction = new THREE.Vector3();
    this.weaponIndex = 0;
    this.crouching = false;
    this.toggleButton = toggleButton;
    this.outfits = models.map((gltf) => {
      // Blender's character faces -Y, which exports as +Z.
      gltf.scene.scale.setScalar(world.scale);
      gltf.scene.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const actions = {};
      for (const name of ['Walk', 'Run', 'Idle', 'CrouchWalk', 'CrouchIdle']) {
        const clip = gltf.animations.find((item) => item.name === name);
        if (!clip) throw new Error(`Lola is missing the ${name} animation`);
        actions[name] = mixer.clipAction(clip);
      }
      actions.Idle.play();
      this.mesh.add(gltf.scene);
      for (const [name, action] of Object.entries(actions)) {
        action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
      }
      return { model: gltf.scene, mixer, actions, current: 'Idle' };
    });
    scene.add(this.mesh);
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      if (!['KeyF', 'KeyC'].includes(event.code) || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      if (event.code === 'KeyC') this.crouching = !this.crouching;
      else this.switchWeapon();
    });
    this.showWeapon();
  }

  showWeapon() {
    this.outfits.forEach((outfit, index) => { outfit.model.visible = index === this.weaponIndex; });
    this.toggleButton.textContent = `F: ${this.weaponIndex === 0 ? 'M416' : 'BASIC GUN'}`;
    this.toggleButton.classList.add('on');
  }

  switchWeapon() {
    this.weaponIndex = 1 - this.weaponIndex;
    this.showWeapon();
  }

  toggle() { /* Lola remains controllable while the Leaper is paused. */ }
  setSelected() { this.selected = true; }

  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    this.mesh.position.y = 0;
    this.mesh.rotation.y = Math.atan2(forward.x, forward.z);
    this.direction.copy(forward).multiplyScalar(forwardAmount).addScaledVector(right, sideAmount);
    if (this.direction.lengthSq() > 1) this.direction.normalize();
    const sprint = speed > 5 && !this.crouching;
    const distance = (this.crouching ? 0.85 : sprint ? 3.4 : 1.7) * this.world.scale * deltaTime;
    const startX = this.mesh.position.x;
    const startZ = this.mesh.position.z;
    // Short steps and axis sliding keep Lola out of walls, including at corners.
    const steps = Math.max(1, Math.ceil(distance / (0.08 * this.world.scale)));
    for (let step = 0; step < steps; step += 1) {
      const dx = this.direction.x * distance / steps;
      const dz = this.direction.z * distance / steps;
      const p = this.mesh.position;
      if (!this.world.playerBlocked(p.x + dx, p.z)) p.x += dx;
      if (!this.world.playerBlocked(p.x, p.z + dz)) p.z += dz;
    }
    const moved = Math.hypot(this.mesh.position.x - startX, this.mesh.position.z - startZ);
    const moving = moved > 0.0001;
    const next = this.crouching ? (moving ? 'CrouchWalk' : 'CrouchIdle')
      : moving ? (sprint ? 'Run' : 'Walk') : 'Idle';
    for (const outfit of this.outfits) {
      if (outfit.current !== next) {
        const previous = outfit.actions[outfit.current];
        const phase = previous.time / previous.getClip().duration;
        outfit.actions[next].time = phase * outfit.actions[next].getClip().duration;
        outfit.current = next;
      }
      // Reuse the forward cycle backwards until a backward/strafe clip is authored.
      for (const [name, action] of Object.entries(outfit.actions)) {
        // Continuous weights avoid restarting crossfades when input changes quickly.
        const weight = THREE.MathUtils.lerp(action.getEffectiveWeight(), name === next ? 1 : 0,
          1 - Math.exp(-12 * deltaTime));
        action.setEffectiveWeight(weight);
        action.timeScale = name.includes('Idle') ? 1 : (forwardAmount < 0 ? -1 : 1);
      }
      outfit.mixer.update(deltaTime);
      // Preserve Blender's authored root height; never lift the whole body to
      // follow whichever animated boot happens to be lowest this frame.
    }
  }
}
