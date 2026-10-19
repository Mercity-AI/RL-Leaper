import * as THREE from 'three';
import { LEAPER_BEHAVIOUR } from '../../config/leaper-behaviour.js';

// What the player sees the Leaper's behaviour do, on top of the rig itself:
//   - a white flash over the hull on every hit, sparks from the struck spot;
//   - a burst of sparks and a flash where a joint snaps;
//   - ground rings: the stomp's growing red warning, the leap's landing
//     marker, and the expanding shockwave when either lands;
//   - the death: a shower of sparks and hull debris that settles on the floor.
// Everything is pooled and owned here: reset() clears it, dispose() frees it.

const SPARK_POOL = 160;
const DEBRIS_POOL = 14;
const UP = new THREE.Vector3(0, 1, 0);
const SPARK_GRAVITY = 14;
const DEBRIS_GRAVITY = 20;

export class LeaperFeedback {
  // scene: where effects go; rig: the hexapod (its hull materials flash);
  // world: floorHeight and scale; random: injectable for tests.
  constructor({ scene, rig, world, config = LEAPER_BEHAVIOUR.feedback, random = Math.random }) {
    Object.assign(this, { scene, rig, world, config, random });
    this.scale = world?.scale ?? 1;
    this.floor = world?.floorHeight ?? 0;
    // 1. The hull materials that flash on a hit (their resting glow is kept so
    //    debris cut off mid-flash can be put back to it).
    this.hull = ['core', 'leg', 'plate', 'joint'].map((key) => rig.materials?.[key]).filter(Boolean);
    for (const material of this.hull) material.userData.hitFlashBase = material.emissive.clone();
    this.flash = 0;
    this.flashStrength = 0;
    // 2. Sparks: one pooled point cloud (additive, so a black point is invisible).
    this.sparkGeometry = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(SPARK_POOL * 3);
    this.sparkColours = new Float32Array(SPARK_POOL * 3);
    this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeometry.setAttribute('color', new THREE.BufferAttribute(this.sparkColours, 3));
    this.sparkMaterial = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkPoints = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    this.sparkPoints.frustumCulled = false;
    this.sparks = Array.from({ length: SPARK_POOL }, () => ({ life: 0, max: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3() }));
    this.nextSpark = 0;
    scene.add(this.sparkPoints);
    // 3. Ground rings: a flat ring mesh, scaled to each use.
    this.ringGeometry = new THREE.RingGeometry(0.9, 1, 72);
    this.ringGeometry.rotateX(-Math.PI / 2);
    // Warnings are drawn plainly so they read red on the pale yard floor; the
    // shockwave is added light.
    this.rings = { stomp: this.makeRing(0xe0160a), landing: this.makeRing(0xff3a14), wave: this.makeRing(0xffb070, true) };
    this.waves = [];
    this.flashes = [];
    // 4. Debris and the joint flash share a few simple pieces.
    this.debrisGeometry = new THREE.BoxGeometry(0.34, 0.12, 0.26);
    this.debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2027, roughness: 0.55, metalness: 0.8, flatShading: true });
    this.debris = [];
    this.flashGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.flashMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false });
  }

  makeRing(colour, additive = false) {
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.visible = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    return { mesh, material, time: 0, duration: 0, radius: 1, active: false };
  }

  // ---- Hits ----

  // A bullet landed: the hull flashes, and sparks fly from `point` if known.
  hit({ point = null, normal = null, strength = 1 } = {}) {
    this.flash = this.config.hitFlash;
    this.flashStrength = Math.min(1, Math.max(this.flashStrength, this.config.hitFlashStrength * strength));
    if (point) this.burst(point, this.config.hitSparks, { speed: 4, normal, life: 0.35 });
  }

  // A joint snapped at `position`: a big burst and a short bright flash.
  jointBurst(position) {
    this.burst(position, this.config.jointBurstSparks, { speed: 7, life: 0.7, colour: [1, 0.75, 0.35] });
    this.flashAt(position, 0.6, 0.25);
    this.hit({ strength: 1.4 });
  }

  // Sparks from `origin`: count points flung out (along `normal` if given).
  burst(origin, count, { speed = 5, normal = null, life = 0.5, colour = [1, 0.55, 0.15] } = {}) {
    for (let i = 0; i < count; i += 1) {
      const spark = this.sparks[this.nextSpark];
      this.nextSpark = (this.nextSpark + 1) % SPARK_POOL;
      spark.position.copy(origin);
      spark.velocity.set(this.random() * 2 - 1, this.random() * 1.6 - 0.2, this.random() * 2 - 1).normalize();
      if (normal) spark.velocity.addScaledVector(normal, 1.2).normalize();
      spark.velocity.multiplyScalar(speed * (0.4 + this.random() * 0.8) * this.scale ** 0.5);
      spark.life = spark.max = life * (0.6 + this.random() * 0.6);
      spark.colour = colour;
    }
  }

  // A brief expanding glow at `position`.
  flashAt(position, radius, duration) {
    const mesh = new THREE.Mesh(this.flashGeometry, this.flashMaterial.clone());
    mesh.position.copy(position);
    mesh.scale.setScalar(radius * 0.3);
    this.scene.add(mesh);
    this.flashes.push({ mesh, radius, time: 0, duration });
  }

  // ---- Ground rings ----

  // The stomp's warning: a red ring growing out to `radius` over `duration`.
  stompWarning({ x, z }, radius, duration) {
    this.showRing(this.rings.stomp, { x, z }, radius, duration);
  }

  // The leap's landing marker at `to`, until cleared (pulses while shown).
  landingMarker({ x, z }, radius) {
    this.showRing(this.rings.landing, { x, z }, radius, Infinity);
  }

  clearWarnings() {
    for (const ring of [this.rings.stomp, this.rings.landing]) {
      ring.active = false;
      ring.mesh.visible = false;
    }
  }

  // A shockwave: a bright ring racing out to `radius`, plus dust sparks.
  shockwave({ x, z }, radius) {
    this.clearWarnings();
    this.showRing(this.rings.wave, { x, z }, radius, 0.45);
    const origin = new THREE.Vector3(x, this.floor + 0.2, z);
    this.burst(origin, 24, { speed: 6, normal: UP, life: 0.6, colour: [0.9, 0.7, 0.45] });
  }

  showRing(ring, { x, z }, radius, duration) {
    ring.mesh.position.set(x, this.floor + 0.04, z);
    ring.radius = radius;
    ring.time = 0;
    ring.duration = duration;
    ring.active = true;
    ring.mesh.visible = true;
  }

  // ---- Death ----

  // The collapse: sparks from the body and hull pieces flung out to settle.
  deathBurst(center, { sparks = 36, debris = 10 } = {}) {
    this.burst(center, sparks, { speed: 8, life: 1.1, colour: [1, 0.6, 0.2] });
    this.flashAt(center, 1.6, 0.4);
    for (let i = 0; i < Math.min(debris, DEBRIS_POOL); i += 1) {
      const mesh = new THREE.Mesh(this.debrisGeometry, this.debrisMaterial);
      mesh.castShadow = true;
      mesh.position.copy(center);
      mesh.scale.setScalar(0.8 + this.random() * 1.2);
      const angle = this.random() * Math.PI * 2;
      const velocity = new THREE.Vector3(Math.sin(angle), 1.2 + this.random(), Math.cos(angle)).multiplyScalar(3 + this.random() * 3);
      this.scene.add(mesh);
      this.debris.push({ mesh, velocity, spin: new THREE.Vector3(this.random() * 8 - 4, this.random() * 8 - 4, this.random() * 8 - 4), settled: false });
    }
  }

  // ---- Frame update ----

  update(dt) {
    if (!(dt > 0)) return;
    // 1. The hull flash fades out.
    this.flash = Math.max(0, this.flash - dt);
    const glow = this.flash > 0 ? this.flashStrength * (this.flash / this.config.hitFlash) : 0;
    if (glow === 0) this.flashStrength = 0;
    for (const material of this.hull) material.emissive.copy(material.userData.hitFlashBase).addScalar(glow);
    // 2. Sparks fly, fall and fade (nothing to upload once they are all out).
    const live = this.sparks.some((spark) => spark.life > 0);
    if (live || this.sparksShown) this.updateSparks(dt);
    this.sparksShown = live;
    // 3. Rings: warnings grow and pulse, the shockwave races out and fades.
    for (const ring of Object.values(this.rings)) this.updateRing(ring, dt);
    // 4. Flashes expand and fade.
    for (const flash of [...this.flashes]) {
      flash.time += dt;
      const t = flash.time / flash.duration;
      flash.mesh.scale.setScalar(flash.radius * (0.3 + 0.7 * t));
      flash.mesh.material.opacity = 0.8 * (1 - t);
      if (t >= 1) {
        this.scene.remove(flash.mesh);
        flash.mesh.material.dispose();
        this.flashes.splice(this.flashes.indexOf(flash), 1);
      }
    }
    // 5. Debris falls, bounces and comes to rest on the floor (kept until a restart).
    for (const piece of this.debris) if (!piece.settled) this.updateDebris(piece, dt);
  }

  updateSparks(dt) {
    for (let i = 0; i < SPARK_POOL; i += 1) {
      const spark = this.sparks[i];
      if (spark.life > 0) {
        spark.life = Math.max(0, spark.life - dt);
        spark.velocity.y -= SPARK_GRAVITY * dt;
        spark.position.addScaledVector(spark.velocity, dt);
        if (spark.position.y < this.floor) { spark.position.y = this.floor; spark.velocity.y *= -0.3; }
      }
      const fade = spark.life > 0 ? spark.life / spark.max : 0;
      const [r, g, b] = spark.colour ?? [0, 0, 0];
      spark.position.toArray(this.sparkPositions, i * 3);
      this.sparkColours.set([r * fade, g * fade, b * fade], i * 3);
    }
    this.sparkGeometry.attributes.position.needsUpdate = true;
    this.sparkGeometry.attributes.color.needsUpdate = true;
  }

  // One hull piece: it falls, bounces and comes to rest on the floor.
  updateDebris(piece, dt) {
    const step = Math.min(dt, 0.1);
    piece.velocity.y -= DEBRIS_GRAVITY * step;
    piece.mesh.position.addScaledVector(piece.velocity, step);
    piece.mesh.rotation.x += piece.spin.x * dt;
    piece.mesh.rotation.y += piece.spin.y * dt;
    piece.mesh.rotation.z += piece.spin.z * dt;
    const rest = this.floor + 0.08 * piece.mesh.scale.x;
    if (piece.mesh.position.y > rest) return;
    piece.mesh.position.y = rest;
    piece.velocity.y *= -0.25;
    piece.velocity.x *= 0.55;
    piece.velocity.z *= 0.55;
    piece.spin.multiplyScalar(0.5);
    if (piece.velocity.length() < 0.4) {
      piece.settled = true;
      piece.mesh.rotation.x = 0;
      piece.mesh.rotation.z = 0;
    }
  }

  updateRing(ring, dt) {
    if (!ring.active) return;
    ring.time += dt;
    if (ring === this.rings.wave) {
      const t = Math.min(1, ring.time / ring.duration);
      ring.mesh.scale.setScalar(Math.max(0.05, ring.radius * t));
      ring.material.opacity = 0.9 * (1 - t);
      if (t >= 1) { ring.active = false; ring.mesh.visible = false; }
      return;
    }
    // Warnings: grow to full size over their duration, then hold, pulsing.
    const grow = Number.isFinite(ring.duration) ? Math.min(1, ring.time / ring.duration) : 1;
    ring.mesh.scale.setScalar(ring.radius * (0.35 + 0.65 * grow));
    ring.material.opacity = 0.35 + 0.35 * grow + 0.25 * Math.sin(ring.time * 18);
  }

  // ---- Lifecycle ----

  // A restart: no flash, sparks, rings or debris left.
  reset() {
    this.flash = 0;
    this.flashStrength = 0;
    for (const material of this.hull) material.emissive.copy(material.userData.hitFlashBase);
    for (const spark of this.sparks) spark.life = 0;
    this.clearWarnings();
    this.rings.wave.active = false;
    this.rings.wave.mesh.visible = false;
    for (const flash of this.flashes) {
      this.scene.remove(flash.mesh);
      flash.mesh.material.dispose();
    }
    this.flashes.length = 0;
    for (const piece of this.debris) this.scene.remove(piece.mesh);
    this.debris.length = 0;
    // One last upload of the (now dark) sparks.
    this.sparksShown = true;
    this.update(1e-6);
  }

  // The session is over: everything leaves the scene and its GPU memory is freed.
  dispose() {
    this.reset();
    this.scene.remove(this.sparkPoints);
    for (const ring of Object.values(this.rings)) {
      this.scene.remove(ring.mesh);
      ring.material.dispose();
    }
    for (const item of [this.sparkGeometry, this.sparkMaterial, this.ringGeometry, this.debrisGeometry,
      this.debrisMaterial, this.flashGeometry, this.flashMaterial]) item.dispose();
  }
}
