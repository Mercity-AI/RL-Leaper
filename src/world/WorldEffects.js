import * as THREE from 'three';

// World effects: small, pooled visual touches that any system can trigger.
//   effects.dust(point)              a soft dust puff (the Leaper's feet use it)
//   effects.impact(point, normal)    sparks flying off a surface, plus a scorch
//                                    mark on high quality (a hook for bolts,
//                                    bullets, debris: call it where something hits)
//   effects.watchFeet(rig)           puff dust wherever a Leaper foot lands
//   effects.update(dt)               advance everything (once per frame)
// The junkyard world owns one (world.effects). Everything is preallocated: an
// effect never creates GPU objects mid-fight. Each kind is optional by quality
// preset (dust, decals); sparks always show.

// ---- Look and feel (designer-tunable) ----
// Dust is sized for the Leaper's feet (the rig never changes size); sparks and
// scorch marks grow with the map's scale, like the gun effects.
export const EFFECTS = Object.freeze({
  dust: Object.freeze({
    pool: 192,            // particles alive at most
    perPuff: 7,           // particles per foot landing
    colour: 0xd6cdbd,     // warm pale grey, lighter than the yard floor so it reads
    opacity: 0.5,         // starting opacity of each particle
    size: [0.5, 1.6],     // particle size (world units) at birth and at the end of its life
    speed: 1.1,           // how fast the puff spreads outwards (units per second)
    rise: 0.3,            // how fast it lifts (units per second)
    lift: 0.04,           // how far above the foot the puff starts
    life: [0.8, 1.4],     // seconds (random between)
    drag: 2.2,            // how quickly it slows down
  }),
  sparks: Object.freeze({
    pool: 160,            // particles alive at most
    perImpact: 12,        // sparks per impact (times the impact's strength)
    colour: 0xffc070,     // hot orange-white (glows on medium and high quality)
    size: [0.1, 0.03],    // size at birth and at the end, times the map scale
    speed: 2.7,           // launch speed, times the map scale
    life: [0.22, 0.5],    // seconds (random between)
    gravity: 5.4,         // fall acceleration, times the map scale
    drag: 1.5,            // how quickly they slow down
  }),
  decals: Object.freeze({
    pool: 32,             // scorch marks kept at once (oldest is reused)
    size: 0.32,           // width, times the map scale
    colour: 0x1a1612,     // soot
    opacity: 0.55,        // starting opacity
    life: 9,              // seconds before a mark has faded away
  }),
});

// Directions reused by every effect (never allocated per call).
const UP = Object.freeze(new THREE.Vector3(0, 1, 0));
const FACING = Object.freeze(new THREE.Vector3(0, 0, 1));

// Soft round points with their own size, opacity and colour, fogged like the
// world. One draw call per particle system.
function particleMaterial({ additive, glow }) {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { pixelsPerUnit: { value: 600 } }]),
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 tint;
      varying float vAlpha; varying vec3 vTint;
      uniform float pixelsPerUnit;
      #include <fog_pars_vertex>
      void main() {
        vAlpha = alpha; vTint = tint;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelsPerUnit / max(0.1, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying float vAlpha; varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float soft = 1.0 - smoothstep(0.35, 1.0, d);
        if (soft <= 0.0) discard;
        gl_FragColor = vec4(vTint, vAlpha * soft);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.userData.glow = glow;
  return material;
}

// A fixed-size particle system: a ring buffer of particles, each with position,
// velocity, age and life; drawn as one THREE.Points.
class Particles {
  constructor(pool, material) {
    this.pool = pool;
    this.next = 0;
    this.position = new Float32Array(pool * 3);
    this.velocity = new Float32Array(pool * 3);
    this.age = new Float32Array(pool).fill(1);
    this.life = new Float32Array(pool).fill(1);
    this.size = new Float32Array(pool);
    this.alpha = new Float32Array(pool);
    this.tint = new Float32Array(pool * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    // Scenery only: a bullet or sight line aimed through a dust cloud or a
    // shower of sparks must never stop on a particle.
    this.points.raycast = () => {};
    this.live = 0;
    // Point sizes in screen pixels per world unit at distance 1, for this view.
    const buffer = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, scene, camera) => {
      const height = renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(buffer).y;
      material.uniforms.pixelsPerUnit.value = height / (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 55) / 2)));
    };
  }

  // Start one particle (reusing the oldest slot).
  spawn(x, y, z, vx, vy, vz, life, colour) {
    const i = this.next, v = i * 3;
    this.next = (this.next + 1) % this.pool;
    this.position[v] = x; this.position[v + 1] = y; this.position[v + 2] = z;
    this.velocity[v] = vx; this.velocity[v + 1] = vy; this.velocity[v + 2] = vz;
    this.tint[v] = colour.r; this.tint[v + 1] = colour.g; this.tint[v + 2] = colour.b;
    this.age[i] = 0;
    this.life[i] = life;
  }

  // Move every live particle and write its size and opacity for this frame.
  step(dt, { drag = 0, gravity = 0, size, opacity = 1 }) {
    let live = 0;
    const damping = Math.exp(-drag * dt);
    for (let i = 0; i < this.pool; i += 1) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      live += 1;
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const v = i * 3;
      this.velocity[v] *= damping; this.velocity[v + 2] *= damping;
      this.velocity[v + 1] = this.velocity[v + 1] * damping - gravity * dt;
      this.position[v] += this.velocity[v] * dt;
      this.position[v + 1] += this.velocity[v + 1] * dt;
      this.position[v + 2] += this.velocity[v + 2] * dt;
      this.size[i] = size[0] + (size[1] - size[0]) * t;
      this.alpha[i] = opacity * (1 - t) * Math.min(1, t * 8);
    }
    // Upload only while something is (or was just) alive.
    if (live || this.live) {
      const attributes = this.points.geometry.attributes;
      for (const name of ['position', 'size', 'alpha', 'tint']) attributes[name].needsUpdate = true;
    }
    this.live = live;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// A soft-edged round scorch texture, drawn once on a small canvas.
function scorchTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export class WorldEffects {
  // scale: the map scale (sparks and scorch marks grow with it); quality: the
  // preset (dust and decals are optional); random: for repeatable tests.
  constructor(scene, { scale = 1, quality = {}, random = Math.random } = {}) {
    Object.assign(this, { scene, scale, random });
    this.enabled = { dust: quality.dust !== false, decals: Boolean(quality.decals) };
    this.root = new THREE.Group();
    this.root.name = 'world-effects';
    // 1. Dust (soft, normal blending, never glows) and sparks (additive, glow).
    this.dustParticles = new Particles(EFFECTS.dust.pool, particleMaterial({ additive: false, glow: false }));
    this.sparkParticles = new Particles(EFFECTS.sparks.pool, particleMaterial({ additive: true, glow: true }));
    this.root.add(this.dustParticles.points, this.sparkParticles.points);
    this.dustColour = new THREE.Color(EFFECTS.dust.colour);
    this.sparkColour = new THREE.Color(EFFECTS.sparks.colour);
    this.dustSize = 1;
    // 2. Scorch marks: a fixed pool of small quads, hidden until used.
    this.decals = [];
    if (this.enabled.decals) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const texture = scorchTexture();
      for (let i = 0; i < EFFECTS.decals.pool; i += 1) {
        const material = new THREE.MeshBasicMaterial({ color: EFFECTS.decals.colour, map: texture, transparent: true,
          opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
        material.userData.glow = false;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.raycast = () => {};
        this.root.add(mesh);
        this.decals.push({ mesh, age: 0 });
      }
      this.decalTexture = texture;
      this.decalGeometry = geometry;
      this.nextDecal = 0;
    }
    // 3. Feet to watch for landings.
    this.feet = [];
    scene.add(this.root);
  }

  // A dust puff on the ground at `point` (world units). amount scales how many
  // particles; size scales how big and how far they spread (1 = a Leaper foot).
  dust(point, { amount = 1, size = 1 } = {}) {
    if (!this.enabled.dust) return;
    const d = EFFECTS.dust;
    const count = Math.max(1, Math.round(d.perPuff * amount));
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count + this.random() * 0.4) * Math.PI * 2;
      const speed = d.speed * size * (0.55 + this.random() * 0.6);
      this.dustParticles.spawn(point.x, point.y + d.lift * size, point.z,
        Math.cos(angle) * speed, d.rise * size * (0.5 + this.random()), Math.sin(angle) * speed,
        d.life[0] + (d.life[1] - d.life[0]) * this.random(), this.dustColour);
    }
    this.dustSize = size;
  }

  // Something hit a surface at `point`, facing `normal` (both world space):
  // sparks fly out along the normal; on high quality a scorch mark stays.
  // strength scales the number of sparks; decal: false skips the mark (for
  // hits on moving things, like the Leaper itself).
  impact(point, normal = UP, { strength = 1, decal = true } = {}) {
    const p = EFFECTS.sparks, s = this.scale;
    const n = normal ?? UP;
    const count = Math.max(1, Math.round(p.perImpact * strength));
    for (let i = 0; i < count; i += 1) {
      const vx = n.x + (this.random() - 0.5) * 1.4, vy = n.y + this.random() * 0.8, vz = n.z + (this.random() - 0.5) * 1.4;
      const speed = p.speed * s * (0.4 + this.random() * 0.8) / Math.max(1e-6, Math.hypot(vx, vy, vz));
      this.sparkParticles.spawn(point.x + n.x * 0.02, point.y + n.y * 0.02, point.z + n.z * 0.02,
        vx * speed, vy * speed, vz * speed, p.life[0] + (p.life[1] - p.life[0]) * this.random(), this.sparkColour);
    }
    if (decal && this.enabled.decals) this.placeDecal(point, n);
  }

  // Put the oldest scorch mark flat on the surface at `point`.
  placeDecal(point, normal) {
    const decal = this.decals[this.nextDecal];
    this.nextDecal = (this.nextDecal + 1) % this.decals.length;
    const mesh = decal.mesh;
    const size = EFFECTS.decals.size * this.scale * (0.75 + this.random() * 0.5);
    mesh.position.copy(point).addScaledVector(normal, 0.004 * this.scale);
    mesh.quaternion.setFromUnitVectors(FACING, normal);
    mesh.rotateZ(this.random() * Math.PI * 2);
    mesh.scale.set(size, size, size);
    mesh.updateMatrix();
    mesh.visible = true;
    mesh.material.opacity = EFFECTS.decals.opacity;
    decal.age = 0;
  }

  // Puff dust wherever one of this rig's feet lands: a leg that was stepping,
  // isn't any more, and put its foot down where the step aimed (a leg tucked up
  // for a jump also stops stepping, mid-air). Shot-off legs are ignored.
  watchFeet(rig) {
    for (const leg of rig?.legs ?? []) this.feet.push({ leg, stepping: leg.stepping });
  }

  // Advance every effect by dt seconds (0 while the game is paused: nothing
  // moves and no new puffs start).
  update(dt) {
    if (!(dt > 0)) return;
    // 1. New puffs where feet just landed.
    for (const foot of this.feet) {
      const { leg } = foot;
      const planted = !leg.stepTo || leg.footPosition.distanceToSquared(leg.stepTo) < 1e-6;
      if (foot.stepping && !leg.stepping && planted && !leg.disabled && !leg.detached) this.dust(leg.footPosition);
      foot.stepping = leg.stepping;
    }
    // 2. Particles drift, fall and fade.
    const d = EFFECTS.dust, p = EFFECTS.sparks, s = this.scale, k = this.dustSize;
    this.dustParticles.step(dt, { drag: d.drag, size: [d.size[0] * k, d.size[1] * k], opacity: d.opacity });
    this.sparkParticles.step(dt, { drag: p.drag, gravity: p.gravity * s, size: [p.size[0] * s, p.size[1] * s], opacity: 1 });
    // 3. Scorch marks fade out over their life.
    for (const decal of this.decals) {
      if (!decal.mesh.visible) continue;
      decal.age += dt;
      const left = 1 - decal.age / EFFECTS.decals.life;
      if (left <= 0) decal.mesh.visible = false;
      else decal.mesh.material.opacity = EFFECTS.decals.opacity * Math.min(1, left * 3);
    }
  }

  // How many dust particles, sparks and scorch marks are showing (for tests and
  // a future performance overlay).
  get counts() {
    return { dust: this.dustParticles.live, sparks: this.sparkParticles.live,
      decals: this.decals.filter((decal) => decal.mesh.visible).length };
  }

  // Remove all effects from the scene and free their GPU memory.
  dispose() {
    this.scene.remove(this.root);
    this.dustParticles.dispose();
    this.sparkParticles.dispose();
    for (const decal of this.decals) decal.mesh.material.dispose();
    this.decalGeometry?.dispose();
    this.decalTexture?.dispose();
    this.feet.length = 0;
  }
}
