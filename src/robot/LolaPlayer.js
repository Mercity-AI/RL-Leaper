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
      for (const name of ['Walk', 'Run', 'Idle']) {
        const clip = gltf.animations.find((item) => item.name === name);
        if (!clip) throw new Error(`Lola is missing the ${name} animation`);
        actions[name] = mixer.clipAction(clip);
      }
      actions.Idle.play();
      this.mesh.add(gltf.scene);
      const boots = [];
      gltf.scene.traverse((object) => {
        if (object.isSkinnedMesh && /BOOTS/i.test(object.name)) boots.push(object);
      });
      return { model: gltf.scene, mixer, actions, boots, current: 'Idle' };
    });
    scene.add(this.mesh);
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyF' || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      this.switchWeapon();
    });
    this.showWeapon();
    this.groundPoint = new THREE.Vector3();
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
    const sprint = speed > 5;
    const distance = (sprint ? 3.4 : 1.7) * this.world.scale * deltaTime;
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
    const next = moved > 0.0001 ? (sprint ? 'Run' : 'Walk') : 'Idle';
    for (const outfit of this.outfits) {
      if (outfit.current !== next) {
        outfit.actions[outfit.current].fadeOut(0.16);
        outfit.actions[next].reset().fadeIn(0.16).play();
        outfit.current = next;
      }
      // Reuse the forward cycle backwards until a backward/strafe clip is authored.
      outfit.actions[next].timeScale = next === 'Idle' ? 1 : (forwardAmount < 0 ? -1 : 1);
      outfit.mixer.update(deltaTime);
      // Keep the lowest boot on the ground, including the temporary idle hold.
      outfit.model.position.y = 0;
      this.mesh.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const boot of outfit.boots) {
        boot.skeleton.update();
        const positions = boot.geometry.attributes.position;
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
          this.groundPoint.fromBufferAttribute(positions, vertex);
          boot.boneTransform(vertex, this.groundPoint);
          this.groundPoint.applyMatrix4(boot.matrixWorld);
          lowest = Math.min(lowest, this.groundPoint.y);
        }
      }
      if (Number.isFinite(lowest)) outfit.model.position.y = -lowest;
    }
  }
}
