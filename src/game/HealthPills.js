import * as THREE from 'three';
import { HEALTH_PILLS } from '../config/pickups.js';

// Health pills: blue glowing pills floating around the yard. Lola walks
// through one, it vanishes and she gets back 10% of her total health.
//   - A new game (every encounter restart) scatters startCount pills at
//     random open spots in the part of the yard Lola can reach.
//   - Once only refillWhenLeft are left, new ones appear one at a time
//     (refillDelay apart) until there are startCount again; never more than maxCount.
//   - The look is the owner's approved preview (previews/health-pill.html):
//     the pill stands up leaning 25° clockwise, spins slowly and bobs inside a
//     glowing blue sphere, with a blue glow circle on the ground under it.
//     The whole pickup is a third of Lola's height.

// The sphere: clear in the middle, glowing towards its edge (a fresnel glow).
// It is bigger than the pill, so it never cuts through it.
const SPHERE_VERTEX = `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const SPHERE_FRAGMENT = `
  uniform vec3 uColor; uniform float uStrength;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float edge = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.5);
    float a = (0.05 + edge * 0.8) * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }`;

// A soft round spot (white in the middle, clear at the edge) for the glow on the ground.
function glowSpotTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = d >= 1 ? 0 : d < 0.35 ? 1 - (d / 0.35) * 0.55 : 0.45 * (1 - (d - 0.35) / 0.65);
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class HealthPills {
  // scene: where the pills are drawn. world: the junkyard (navigation grid,
  // scale, floor height). player: Lola (position and height). vitals: her
  // PlayerVitals (heal). model: the pill's loaded glTF scene (Pill_Health_Leaper).
  // random: for tests.
  constructor({ scene, world, player, vitals, model, config = HEALTH_PILLS, random = Math.random }) {
    Object.assign(this, { scene, world, player, vitals, config, random });
    this.pills = [];
    this.refillTimer = 0;
    this.refilling = false;
    this.time = 0;
    // 1. Everything scales with Lola: the whole pickup is `size` of her height.
    const lolaHeight = player.height || 1;
    this.unit = (lolaHeight * config.size) / (2 * config.previewSphereRadius);
    this.reach = lolaHeight * config.reach;
    this.spacing = lolaHeight * config.spacing;
    this.awayFromLola = lolaHeight * config.awayFromLola;
    // 2. Shared parts: the pill model (its texture without mipmaps, so the
    //    picture's black background doesn't bleed into the colours), the
    //    sphere's shape and the ground glow.
    this.colour = new THREE.Color(config.colour);
    this.template = model;
    this.materials = new Set();
    model.traverse((object) => {
      if (!object.isMesh) return;
      const map = object.material.map ?? null;
      if (map) {
        map.generateMipmaps = false;
        map.minFilter = THREE.LinearFilter;
        map.needsUpdate = true;
      }
      object.material = new THREE.MeshStandardMaterial({
        map, roughness: 0.3, metalness: 0, emissive: this.colour, emissiveIntensity: 0.08,
      });
      object.castShadow = false;
      object.receiveShadow = false;
      this.materials.add(object.material);
    });
    this.sphereGeometry = new THREE.SphereGeometry(config.previewSphereRadius, 32, 20);
    this.spotGeometry = new THREE.PlaneGeometry(1.6, 1.6);
    this.spotTexture = glowSpotTexture();
  }

  // ---- The game's calls ----

  // A new game: clear every pill and scatter a fresh set.
  reset() {
    for (const pill of this.pills.splice(0)) this.remove(pill);
    this.refillTimer = 0;
    this.refilling = false;
    for (let i = 0; i < this.config.startCount; i += 1) this.spawn();
  }

  // Every frame, with gameplay time (0 while paused: the pills freeze too).
  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    // 1. Lola walks through a pill: it vanishes and she heals (only when she is
    //    hurt, if needsDamage, and never once she is down).
    const lola = this.player.mesh.position;
    const vitals = this.vitals;
    const canHeal = !vitals.dead && (!this.config.needsDamage || vitals.health < vitals.max);
    for (const pill of this.pills) {
      if (pill.taken !== null || !canHeal) continue;
      if (Math.hypot(lola.x - pill.x, lola.z - pill.z) > this.reach) continue;
      pill.taken = 0;
      // Gone the moment she touches it; only the glow lingers for a blink.
      pill.spinner.visible = false;
      vitals.heal(vitals.max * this.config.heal);
    }
    // 2. Motion, the vanishing ones, and the refill.
    for (const pill of this.pills) this.animate(pill, dt);
    for (const pill of this.pills.filter((p) => p.taken !== null && p.taken >= this.config.vanishSeconds)) {
      this.pills.splice(this.pills.indexOf(pill), 1);
      this.remove(pill);
    }
    this.refill(dt);
  }

  // The session is over: every pill out of the scene and its GPU memory freed.
  dispose() {
    for (const pill of this.pills.splice(0)) this.remove(pill);
    this.sphereGeometry.dispose();
    this.spotGeometry.dispose();
    this.spotTexture.dispose();
    for (const material of this.materials) {
      material.map?.dispose();
      material.dispose();
    }
  }

  // Pills still there to take (for tests and tools).
  get available() {
    return this.pills.filter((pill) => pill.taken === null).length;
  }

  // ---- Inside ----

  // New pills one at a time once only refillWhenLeft are left, until startCount again.
  refill(dt) {
    const { refillWhenLeft, startCount, maxCount, refillDelay } = this.config;
    const left = this.available;
    if (this.refilling) this.refilling = left < startCount;
    else this.refilling = left <= refillWhenLeft;
    if (!this.refilling || this.pills.length >= maxCount) {
      this.refillTimer = 0;
      return;
    }
    this.refillTimer += dt;
    if (this.refillTimer < refillDelay) return;
    this.refillTimer = 0;
    this.spawn();
  }

  // One pill at a random open spot (or none if the yard has no room).
  spawn() {
    if (this.pills.length >= this.config.maxCount) return null;
    const spot = this.pickSpot();
    if (!spot) return null;
    const pill = this.build(spot);
    this.pills.push(pill);
    this.animate(pill, 0);
    return pill;
  }

  // A random open spot in the yard, as far as possible from the other pills
  // and from Lola (the first draw far enough from both wins; otherwise the best
  // of the draws). The spots are the Leaper's open cells: roomy enough for the
  // big robot, so always open floor that the much smaller Lola can reach.
  pickSpot() {
    const nav = this.world.navigation;
    const scale = this.world.scale;
    if (!nav) return null;
    const lola = this.player.mesh.position;
    if (!this.cells) {
      this.cells = [];
      for (let i = 0; i < nav.free.length; i += 1) if (nav.free[i]) this.cells.push(i);
    }
    const cells = this.cells;
    if (!cells.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (let draw = 0; draw < 64; draw += 1) {
      const p = nav.point(cells[Math.floor(this.random() * cells.length)]);
      const x = p.x * scale, z = p.z * scale;
      if (this.world.playerBlocked?.(x, z)) continue;
      const fromLola = Math.hypot(x - lola.x, z - lola.z);
      const fromPills = Math.min(Infinity, ...this.pills.map((pill) => Math.hypot(x - pill.x, z - pill.z)));
      if (fromLola >= this.awayFromLola && fromPills >= this.spacing) return { x, z };
      const score = Math.min(fromLola / this.awayFromLola, fromPills / this.spacing);
      if (score > bestScore) { best = { x, z }; bestScore = score; }
    }
    return best;
  }

  // The pickup's pieces: holder (bobs) > spinner (turns) > tilt (leans) > pill,
  // with the glowing sphere around it and the glow spot on the ground.
  build({ x, z }) {
    const { config, unit } = this;
    const holder = new THREE.Group();
    holder.name = 'healthPill';
    holder.scale.setScalar(unit);
    const spinner = new THREE.Group();
    const tilt = new THREE.Group();
    // The pill's long side runs along x: 90° stands it up, minus the lean.
    tilt.rotation.z = THREE.MathUtils.degToRad(90 - config.leanDegrees);
    tilt.add(this.template.clone(true));
    spinner.add(tilt);
    holder.add(spinner);
    const sphereMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.colour }, uStrength: { value: config.glow } },
      vertexShader: SPHERE_VERTEX,
      fragmentShader: SPHERE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    holder.add(new THREE.Mesh(this.sphereGeometry, sphereMaterial));
    const spot = new THREE.Mesh(this.spotGeometry, new THREE.MeshBasicMaterial({
      map: this.spotTexture, color: this.colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spot.rotation.x = -Math.PI / 2;
    spot.scale.setScalar(unit);
    spot.position.set(x, (this.world.floorHeight ?? 0) + 0.01 * unit, z);
    this.scene.add(holder, spot);
    return {
      x, z, holder, spinner, spot, sphereMaterial,
      // Each pill bobs and turns on its own beat, so they don't move in step.
      phase: this.random() * Math.PI * 2,
      taken: null,
    };
  }

  // Spin, bob, the gently breathing glow, and the vanish once taken.
  animate(pill, dt) {
    const { config, unit } = this;
    const t = this.time;
    pill.spinner.rotation.y = (t / config.spinSeconds) * Math.PI * 2 + pill.phase;
    const lift = config.floatHeight + Math.sin((t / config.bobSeconds) * Math.PI * 2 + pill.phase) * config.bob;
    pill.holder.position.set(pill.x, (this.world.floorHeight ?? 0) + lift * unit, pill.z);
    let fade = 1;
    if (pill.taken !== null) {
      pill.taken += dt;
      fade = 1 - Math.min(1, pill.taken / config.vanishSeconds);
    }
    pill.sphereMaterial.uniforms.uStrength.value = config.glow * (0.9 + 0.1 * Math.sin(t * 2.1)) * fade;
    // The glow on the ground is brighter while the pill dips low.
    pill.spot.material.opacity = Math.min(1, 0.7 * (1.3 - lift * 0.6)) * fade;
  }

  remove(pill) {
    this.scene.remove(pill.holder, pill.spot);
    pill.sphereMaterial.dispose();
    pill.spot.material.dispose();
  }
}
