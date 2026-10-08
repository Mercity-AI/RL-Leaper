import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import strideProfiles from '../../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { strideDistance } from './strideMotion.js';

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
    this.outfits = models.map((gltf, index) => {
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
      for (const name of ['Walk', 'Run', 'Idle', 'CrouchWalk', 'CrouchIdle', 'StrafeLeft', 'StrafeRight']) {
        const clip = gltf.animations.find((item) => item.name === name);
        if (!clip) throw new Error(`Lola is missing the ${name} animation`);
        actions[name] = mixer.clipAction(clip);
      }
      actions.Idle.play();
      this.mesh.add(gltf.scene);
      for (const [name, action] of Object.entries(actions)) {
        action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
      }
      return { model: gltf.scene, mixer, actions, profiles: strideProfiles[index === 0 ? 'm416' : 'basic'], current: 'Idle' };
    });
    scene.add(this.mesh);
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      if (!['KeyF', 'KeyC'].includes(event.code) || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      if (event.code === 'KeyC') {
        this.crouching = !this.crouching;
        this.showWeapon();
      }
      else this.switchWeapon();
    });
    this.showWeapon();
  }

  showWeapon() {
    this.outfits.forEach((outfit, index) => { outfit.model.visible = index === this.weaponIndex; });
    this.toggleButton.textContent = `F: ${this.weaponIndex === 0 ? 'M416' : 'BASIC GUN'} · C: ${this.crouching ? 'CROUCHED' : 'STANDING'}`;
    this.toggleButton.classList.add('on');
  }

  switchWeapon() {
    this.weaponIndex = 1 - this.weaponIndex;
    this.showWeapon();
  }

  toggle() { /* Lola remains controllable while the Leaper is paused. */ }
  setSelected() { this.selected = true; }

  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    const steps = Math.max(1, Math.ceil(deltaTime * 120));
    for (let i = 0; i < steps; i += 1) {
      this.moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime / steps);
    }
  }

  moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    this.mesh.position.y = 0;
    this.mesh.rotation.y = Math.atan2(forward.x, forward.z);
    this.direction.copy(forward).multiplyScalar(forwardAmount).addScaledVector(right, sideAmount);
    const inputStrength = Math.min(1, this.direction.length());
    this.direction.normalize();
    const sprint = speed > 5 && !this.crouching;
    const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);
    const next = this.crouching ? (inputStrength ? 'CrouchWalk' : 'CrouchIdle')
      : inputStrength ? (sideways ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : sprint ? 'Run' : 'Walk') : 'Idle';
    let distance = 0;
    for (const [index, outfit] of this.outfits.entries()) {
      if (outfit.current !== next) {
        const previous = outfit.actions[outfit.current];
        outfit.actions[next].time = previous.time / previous.getClip().duration * outfit.actions[next].getClip().duration;
        outfit.current = next;
      }
      let floor = 0;
      for (const [name, action] of Object.entries(outfit.actions)) {
        const oldWeight = action.getEffectiveWeight();
        const weight = THREE.MathUtils.lerp(oldWeight, name === next ? 1 : 0, 1 - Math.exp(-12 * deltaTime));
        action.setEffectiveWeight(weight);
        const rate = name.startsWith('Strafe') ? (sprint ? 1 : 0.625)
          : name.includes('Idle') ? 1 : (forwardAmount < 0 ? -1 : 1);
        action.timeScale = name.includes('Idle') ? 1 : rate * inputStrength;
        const profile = outfit.profiles[name];
        if (index === this.weaponIndex && inputStrength) {
          distance += strideDistance(profile, action.time, deltaTime * action.timeScale) * (oldWeight + weight) / 2;
        }
        floor += profile.groundOffset * weight;
      }
      // One measured floor offset per clip, blended without frame-by-frame foot snapping.
      outfit.model.position.y = floor * this.world.scale;
    }
    distance *= this.world.scale;
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
    const p = this.mesh.position;
    const blockedAhead = inputStrength && this.world.playerBlocked(
      p.x + this.direction.x * 0.01 * this.world.scale,
      p.z + this.direction.z * 0.01 * this.world.scale);
    const progress = distance > 1e-8 ? Math.min(1, moved / distance) : blockedAhead ? 0 : 1;
    for (const outfit of this.outfits) {
      for (const [name, action] of Object.entries(outfit.actions)) {
        if (!name.includes('Idle')) action.timeScale *= progress;
      }
      outfit.mixer.update(deltaTime);
    }
  }
}
