import * as THREE from 'three';

// Floating pickups: glowing objects scattered around the yard that Lola
// collects by walking through them (health pills, ammo bullets; see
// src/config/pickups.js). One kind per instance; each kind decides what a
// pickup does through canTake() and take().
//   - A new game (every encounter restart) scatters startCount of them at
//     random open spots in the yard, away from Lola and from other pickups.
//   - Once only refillWhenLeft are left, new ones appear one at a time
//     (refillDelay apart) until there are startCount again; never more than maxCount.
//   - The look is the owner's approved preview (previews/health-pill.html):
//     the object leans 25° clockwise, spins slowly and bobs inside a glowing
//     sphere, with a glow circle of the same colour on the ground under it.
//     The whole pickup is a third of Lola's height.

// The sphere: clear in the middle, glowing towards its edge (a fresnel glow).
// It is bigger than the object, so it never cuts through it.
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
    float a = edge * 0.8 * uStrength; // edge only: no haze over the object
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

export class FloatingPickups {
  // scene: where they are drawn. world: the junkyard (navigation grid, scale,
  // floor height). player: Lola (position and height). model: the object's
  // loaded glTF scene. config: one kind from src/config/pickups.js.
  // others(): the other kinds' pickups, kept at a distance too. audio: the
  // game's sound engine (plays config.sound on a pickup). random: for tests.
  constructor({ scene, world, player, model, config, others = () => [], audio = null, random = Math.random }) {
    Object.assign(this, { scene, world, player, config, others, audio, random });
    this.items = [];
    this.refillTimer = 0;
    this.refilling = false;
    this.time = 0;
    // 1. Everything scales with Lola: the whole pickup is `size` of her height.
    const lolaHeight = player.height || 1;
    this.unit = (lolaHeight * config.size) / (2 * config.previewSphereRadius);
    this.reach = lolaHeight * config.reach;
    this.spacing = lolaHeight * config.spacing;
    this.awayFromLola = lolaHeight * config.awayFromLola;
    // 2. Shared parts: the object (its texture without mipmaps, so the
    //    picture's black background doesn't bleed into the colours), the
    //    sphere's shape and the ground glow.
    this.colour = new THREE.Color(config.colour);
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
        map, roughness: config.roughness, metalness: 0, emissive: this.colour, emissiveIntensity: config.tint,
      });
      object.castShadow = false;
      object.receiveShadow = false;
      this.materials.add(object.material);
    });
    this.template = this.fitModel(model);
    this.sphereGeometry = new THREE.SphereGeometry(config.previewSphereRadius, 32, 20);
    this.spotGeometry = new THREE.PlaneGeometry(1.6, 1.6);
    this.spotTexture = glowSpotTexture();
  }

  // What taking one does (each kind fills these in).
  canTake() { return true; }
  take() {}

  // ---- The game's calls ----

  // A new game: clear every pickup and scatter a fresh set.
  reset() {
    for (const item of this.items.splice(0)) this.remove(item);
    this.refillTimer = 0;
    this.refilling = false;
    for (let i = 0; i < this.config.startCount; i += 1) this.spawn();
  }

  // Every frame, with gameplay time (0 while paused: they freeze too).
  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    // 1. Lola walks through one: it vanishes at once and does its job (only
    //    when it would do something, e.g. not at full health).
    const lola = this.player.mesh.position;
    for (const item of this.items) {
      if (item.taken !== null) continue;
      if (Math.hypot(lola.x - item.x, lola.z - item.z) > this.reach || this.player.offGround) continue;
      if (!this.canTake()) break;
      item.taken = 0;
      // Gone the moment she touches it; only the glow lingers for a blink.
      item.spinner.visible = false;
      this.take();
      if (this.config.sound) this.audio?.play(this.config.sound);
    }
    // 2. Motion, the vanishing ones, and the refill.
    for (const item of this.items) this.animate(item, dt);
    for (const item of this.items.filter((p) => p.taken !== null && p.taken >= this.config.vanishSeconds)) {
      this.items.splice(this.items.indexOf(item), 1);
      this.remove(item);
    }
    this.refill(dt);
  }

  // The session is over: every pickup out of the scene and its GPU memory freed.
  dispose() {
    for (const item of this.items.splice(0)) this.remove(item);
    this.sphereGeometry.dispose();
    this.spotGeometry.dispose();
    this.spotTexture.dispose();
    for (const material of this.materials) {
      material.map?.dispose();
      material.dispose();
    }
  }

  // Pickups still there to take (for tests and tools).
  get available() {
    return this.items.filter((item) => item.taken === null).length;
  }

  // ---- Inside ----

  // The object as it sits in its sphere, upright before the lean: the pill
  // lies along x (drawn thinner if asked); a model standing along y (the
  // bullet) is centred and scaled to modelLength.
  fitModel(model) {
    const { config } = this;
    if (config.modelAxis !== 'y') {
      const thickness = config.thickness ?? 1;
      model.scale.set(1, thickness, thickness);
      return model;
    }
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(box.getCenter(new THREE.Vector3()));
    const fit = new THREE.Group();
    fit.add(model);
    fit.scale.setScalar((config.modelLength ?? 1) / (size.y || 1));
    return fit;
  }

  // New ones one at a time once only refillWhenLeft are left, until startCount again.
  refill(dt) {
    const { refillWhenLeft, startCount, maxCount, refillDelay } = this.config;
    const left = this.available;
    if (this.refilling) this.refilling = left < startCount;
    else this.refilling = left <= refillWhenLeft;
    if (!this.refilling || this.items.length >= maxCount) {
      this.refillTimer = 0;
      return;
    }
    this.refillTimer += dt;
    if (this.refillTimer < refillDelay) return;
    this.refillTimer = 0;
    this.spawn();
  }

  // One pickup at a random open spot (or none if the yard has no room).
  spawn() {
    if (this.items.length >= this.config.maxCount) return null;
    const spot = this.pickSpot();
    if (!spot) return null;
    const item = this.build(spot);
    this.items.push(item);
    this.animate(item, 0);
    return item;
  }

  // A random open spot in the yard, as far as possible from every pickup and
  // from Lola (the first draw far enough from both wins; otherwise the best of
  // the draws). The spots are the Leaper's open cells: roomy enough for the
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
    const placed = [...this.items, ...this.others()];
    let best = null;
    let bestScore = -Infinity;
    for (let draw = 0; draw < 64; draw += 1) {
      const p = nav.point(cells[Math.floor(this.random() * cells.length)]);
      const x = p.x * scale, z = p.z * scale;
      if (this.world.playerBlocked?.(x, z)) continue;
      const fromLola = Math.hypot(x - lola.x, z - lola.z);
      const fromOthers = Math.min(Infinity, ...placed.map((item) => Math.hypot(x - item.x, z - item.z)));
      if (fromLola >= this.awayFromLola && fromOthers >= this.spacing) return { x, z };
      const score = Math.min(fromLola / this.awayFromLola, fromOthers / this.spacing);
      if (score > bestScore) { best = { x, z }; bestScore = score; }
    }
    return best;
  }

  // The pickup's pieces: holder (bobs) > spinner (turns) > tilt (leans) > object,
  // with the glowing sphere around it and the glow spot on the ground.
  build({ x, z }) {
    const { config, unit } = this;
    const holder = new THREE.Group();
    holder.name = config.name;
    holder.scale.setScalar(unit);
    const spinner = new THREE.Group();
    const tilt = new THREE.Group();
    // Lean clockwise: a model lying along x is first stood up (90°).
    const upright = config.modelAxis === 'y' ? 0 : 90;
    tilt.rotation.z = THREE.MathUtils.degToRad(upright - config.leanDegrees);
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
      // Each one bobs and turns on its own beat, so they don't move in step.
      phase: this.random() * Math.PI * 2,
      taken: null,
    };
  }

  // Spin, bob, the gently breathing glow, and the vanish once taken.
  animate(item, dt) {
    const { config, unit } = this;
    const t = this.time;
    item.spinner.rotation.y = (t / config.spinSeconds) * Math.PI * 2 + item.phase;
    const lift = config.floatHeight + Math.sin((t / config.bobSeconds) * Math.PI * 2 + item.phase) * config.bob;
    item.holder.position.set(item.x, (this.world.floorHeight ?? 0) + lift * unit, item.z);
    let fade = 1;
    if (item.taken !== null) {
      item.taken += dt;
      fade = 1 - Math.min(1, item.taken / config.vanishSeconds);
    }
    item.sphereMaterial.uniforms.uStrength.value = config.glow * (0.9 + 0.1 * Math.sin(t * 2.1)) * fade;
    // The glow on the ground is brighter while the object hangs low.
    const ground = Math.max(0.15, 0.5 * config.glowStrength * (1.3 - lift * 0.6));
    item.spot.material.opacity = Math.min(1, ground) * fade;
  }

  remove(item) {
    this.scene.remove(item.holder, item.spot);
    item.sphereMaterial.dispose();
    item.spot.material.dispose();
  }
}
