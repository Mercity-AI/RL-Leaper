import * as THREE from 'three';
import { ENCOUNTER } from '../config/encounter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import strideProfiles from '../../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { evenStrideElapsed, strideDistance } from './strideMotion.js';

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
    this.height = 1.9 * world.scale * ENCOUNTER.lolaHeight;
    this.hitRecoilTime = 0;
    this.mesh = new THREE.Group();
    this.mesh.position.set(world.initialTarget.x, 0, world.initialTarget.z);
    this.direction = new THREE.Vector3();
    this.weaponIndex = 0;
    this.crouching = false;
    this.grounded = true;
    this.verticalVelocity = 0;
    this.toggleButton = toggleButton;
    this.outfits = models.map((gltf, index) => {
      // Blender's character faces -Y, which exports as +Z.
      gltf.scene.scale.set(world.scale, world.scale * ENCOUNTER.lolaHeight, world.scale);
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
      const hitBone = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-spine.003'));
      const shooting = {};
      for (const name of ['Shoot', 'CrouchShoot']) {
        const clip = gltf.animations.find(item => item.name === name);
        if (!clip) throw new Error(`Lola is missing ${name}`);
        shooting[name] = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
        shooting[name].clampWhenFinished = true;
      }
      const shotGun = gltf.scene.getObjectByName(`${index === 0 ? 'm416' : 'basic'}_ShootingWeapon`);
      const carriedGun = gltf.scene.getObjectByName(index === 0 ? 'M416_Carry' : 'Lola_Gun_Basic');
      shotGun.visible = false;
      actions.Idle.play();
      this.mesh.add(gltf.scene);
      for (const [name, action] of Object.entries(actions)) {
        action.setEffectiveWeight(name === 'Idle' ? 1 : 0).play();
      }
      return { model: gltf.scene, mixer, actions, hitBone, hitBase: null, shooting, shotGun, carriedGun, profiles: strideProfiles[index === 0 ? 'm416' : 'basic'], current: 'Idle' };
    });
    scene.add(this.mesh);
    toggleButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    toggleButton.addEventListener('click', () => this.switchWeapon());
    window.addEventListener('keydown', (event) => {
      if (!['KeyQ', 'KeyF', 'KeyC'].includes(event.code) || event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      event.preventDefault();
      if (event.code === 'KeyC') {
        this.cancelShot();
        this.crouching = !this.crouching;
        this.showWeapon();
      }
      else this.switchWeapon();
    });
    this.showWeapon();
  }

  showWeapon() {
    this.outfits.forEach((outfit, index) => { outfit.model.visible = index === this.weaponIndex; });
    this.toggleButton.textContent = `Q: ${this.weaponIndex === 0 ? 'M416' : 'BASIC GUN'} · C: ${this.crouching ? 'CROUCHED' : 'STANDING'}`;
    this.toggleButton.classList.add('on');
  }

  switchWeapon() {
    this.cancelShot();
    this.weaponIndex = 1 - this.weaponIndex;
    this.showWeapon();
  }

  reactToHit() {
    if (this.defeated) return;
    this.cancelShot();
    this.hitRecoilTime = ENCOUNTER.hitRecoilDuration;
  }

  clearHitReaction() {
    this.hitRecoilTime = 0;
    for (const outfit of this.outfits) {
      if (outfit.hitBase) outfit.hitBone.quaternion.copy(outfit.hitBase);
      outfit.hitBase = null;
    }
  }

  startShot() {
    if (this.defeated || !this.grounded) return false;
    this.cancelShot();
    this.clearHitReaction();
    const outfit = this.outfits[this.weaponIndex];
    const action = outfit.shooting[this.crouching ? 'CrouchShoot' : 'Shoot'];
    action.reset().setEffectiveWeight(1).play();
    this.shot = { outfit, action, elapsed: 0 };
    outfit.shotGun.visible = true;
    outfit.carriedGun.visible = false;
    const weights = Object.values(outfit.actions).map(action => action.getEffectiveWeight());
    for (const action of Object.values(outfit.actions)) action.setEffectiveWeight(0);
    outfit.mixer.update(0);
    Object.values(outfit.actions).forEach((action, i) => action.setEffectiveWeight(weights[i]));
    return true;
  }

  cancelShot() {
    if (!this.shot) return;
    const { outfit, action } = this.shot;
    action.stop();
    outfit.shotGun.visible = false;
    outfit.carriedGun.visible = true;
    // Locomotion weights kept advancing underneath the shooting pose.
    this.shot = null;
  }

  muzzlePosition() {
    const gun = this.outfits[this.weaponIndex].shotGun;
    this.mesh.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const points = [], vertex = new THREE.Vector3();
    let furthest = -Infinity;
    const positions = gun.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(gun.matrixWorld);
      furthest = Math.max(furthest, vertex.dot(forward));
      points.push(vertex.clone());
    }
    const tip = points.filter(point => furthest - point.dot(forward) < 0.015 * this.world.scale);
    return tip.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / tip.length);
  }

  toggle() { /* Lola remains controllable while the Leaper is paused. */ }
  setSelected() { this.selected = true; }

  jump() {
    if (this.defeated || !this.grounded) return false;
    this.cancelShot();
    this.grounded = false;
    this.crouching = false;
    this.verticalVelocity = Math.sqrt(2 * 14 * 0.85) * this.world.scale;
    this.showWeapon();
    return true;
  }

  resetJump() {
    this.grounded = true;
    this.verticalVelocity = 0;
    this.mesh.position.y = 0;
  }

  move(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (this.defeated) return;
    const steps = Math.max(1, Math.ceil(deltaTime * 120));
    for (let i = 0; i < steps; i += 1) {
      this.moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime / steps);
    }
  }

  moveStep(forwardAmount, sideAmount, forward, right, speed, deltaTime) {
    if (!this.grounded) {
      const gravity = 14 * this.world.scale;
      this.mesh.position.y += this.verticalVelocity * deltaTime - 0.5 * gravity * deltaTime ** 2;
      this.verticalVelocity -= gravity * deltaTime;
      if (this.mesh.position.y <= 0) this.resetJump();
    }
    this.mesh.rotation.y = Math.atan2(forward.x, forward.z);
    this.direction.copy(forward).multiplyScalar(forwardAmount).addScaledVector(right, sideAmount);
    const inputStrength = Math.min(1, this.direction.length());
    this.direction.normalize();
    const sprint = speed > 5 && !this.crouching;
    const sideways = Math.abs(sideAmount) > 0.1 && Math.abs(sideAmount) >= Math.abs(forwardAmount);
    const next = this.crouching ? (inputStrength ? 'CrouchWalk' : 'CrouchIdle')
      : inputStrength ? (sideways ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run') : 'Idle';
    let distance = 0;
    for (const [index, outfit] of this.outfits.entries()) {
      if (this.grounded && outfit.current !== next) {
        const previous = outfit.actions[outfit.current];
        outfit.actions[next].time = previous.time / previous.getClip().duration * outfit.actions[next].getClip().duration;
        outfit.current = next;
      }
      let floor = 0;
      for (const [name, action] of Object.entries(outfit.actions)) {
        const oldWeight = action.getEffectiveWeight();
        const weight = this.grounded
          ? THREE.MathUtils.lerp(oldWeight, name === next ? 1 : 0, 1 - Math.exp(-12 * deltaTime)) : oldWeight;
        action.setEffectiveWeight(weight);
        const pace = name.startsWith('Crouch') ? 2 : sprint ? 2.7 : 2;
        const rate = name.startsWith('Strafe') ? pace
          : name.includes('Idle') ? 1 : pace * (forwardAmount < 0 ? -1 : 1);
        action.timeScale = name.includes('Idle') ? 1 : rate * inputStrength;
        if (!this.grounded) action.timeScale = 0;
        const profile = outfit.profiles[name];
        if (name === 'Run' && deltaTime > 0) {
          action.timeScale = evenStrideElapsed(profile, action.time, deltaTime * action.timeScale) / deltaTime;
        }
        if (index === this.weaponIndex && inputStrength) {
          distance += strideDistance(profile, action.time, deltaTime * action.timeScale) * (oldWeight + weight) / 2;
        }
        floor += profile.groundOffset * weight;
      }
      // One measured floor offset per clip, blended without frame-by-frame foot snapping.
      outfit.model.position.y = floor * this.world.scale * ENCOUNTER.lolaHeight;
    }
    if (!this.grounded) {
      const profile = this.outfits[this.weaponIndex].profiles[sideways
        ? (sideAmount < 0 ? 'StrafeLeft' : 'StrafeRight') : 'Run'];
      distance = profile.distance / profile.duration * (sprint ? 2.7 : 2) * inputStrength * deltaTime;
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
    this.hitRecoilTime = Math.max(0, this.hitRecoilTime - deltaTime);
    for (const outfit of this.outfits) {
      if (outfit.hitBase) outfit.hitBone.quaternion.copy(outfit.hitBase);
      outfit.hitBase = null;
      for (const [name, action] of Object.entries(outfit.actions)) {
        if (!name.includes('Idle')) action.timeScale *= progress;
      }
      const shot = this.shot?.outfit === outfit ? this.shot : null;
      const weights = Object.values(outfit.actions).map(action => action.getEffectiveWeight());
      if (shot) {
        shot.elapsed += deltaTime;
        Object.values(outfit.actions).forEach(action => action.setEffectiveWeight(0));
      }
      outfit.mixer.update(deltaTime);
      if (this.hitRecoilTime > 0 && outfit.hitBone) {
        const t = 1 - this.hitRecoilTime / ENCOUNTER.hitRecoilDuration;
        // Quick backward flinch, then a soft recovery; no root knockback into cover.
        const strength = Math.sin(Math.PI * 0.5 * Math.min(1, t / 0.22)) * (t < 0.22 ? 1 : 0)
          + (t >= 0.22 ? Math.sin(Math.PI * 0.5 * (1 - t) / 0.78) : 0);
        outfit.hitBase = outfit.hitBone.quaternion.clone();
        outfit.hitBone.rotateX(-ENCOUNTER.hitRecoilAngle * strength);
      }
      if (shot) {
        Object.values(outfit.actions).forEach((action, i) => action.setEffectiveWeight(weights[i]));
        if (shot.elapsed >= shot.action.getClip().duration) this.cancelShot();
      }
    }
  }
}
