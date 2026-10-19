import * as THREE from 'three';

// Short-lived shot effects: the tracer streak, the muzzle flash and impact
// sparks (no decals, debris or world changes), plus the Leaper's render-only
// impact shudder.
//
// Everything is pooled (fix 5.40 part 1): the effects draw through three
// objects made once per session (one line set for every tracer, one instanced
// mesh per muzzle-flash style, one for every spark) with shared geometry and
// materials. Firing only fills in numbers in buffers that already exist, so no
// shot creates a GPU object or swaps a shader, and no frame allocates a new GPU
// buffer. prewarm() compiles their shaders before the first shot.

// ---- Look of each gun's effects (sizes in map units at scale 1, times in seconds) ----
// Tracer: colour and starting opacity, life, and the share of the path its
// streak covers (the pistol keeps its readable long zip, the rifle a shorter trace).
const TRACER = Object.freeze({
  rifle: Object.freeze({ color: 0xffefd0, opacity: 0.72, life: 0.11, trail: 0.55 }),
  pistol: Object.freeze({ color: 0xfffcf5, opacity: 0.9, life: 0.14, trail: 1 }),
});
// Muzzle flash: a small cone just in front of the barrel that shrinks away.
const FLASH = Object.freeze({
  rifle: Object.freeze({ radius: 0.022, length: 0.22, sides: 4, color: 0xfff2d6, life: 0.105 }),
  pistol: Object.freeze({ radius: 0.04, length: 0.15, sides: 5, color: 0xffebbe, life: 0.12 }),
  offset: 0.065,
});
// Sparks on an enemy hit: how many, how big, how fast and how long they live.
const SPARKS = Object.freeze({
  count: Object.freeze({ rifle: 9, pistol: 5 }),
  colors: Object.freeze([0xfff0cb, 0xffc26d, 0xffc26d]),
  size: Object.freeze([0.018, 0.012]),
  stretch: 2.5,
  speed: Object.freeze([1.1, 2]),
  life: Object.freeze([0.15, 0.17]),
  gravity: 5,
  lift: 0.015,
});
// The Leaper's body jolts by this much (radians) on a hit and settles quickly.
const KICK = Object.freeze({ rifle: 0.035, pistol: 0.02, settle: 22 });
// Most effects of each kind alive at once; past that the oldest is reused.
const POOL = Object.freeze({ tracers: 32, flashes: 16, sparks: 128 });

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

export class GunshotEffects {
  constructor(scene, scale, { pool = POOL, random = Math.random } = {}) {
    this.scene = scene;
    this.scale = scale;
    this.random = random;
    this.kick = 0;
    // Active effects, oldest first (each a pooled record, see makeRecord).
    this.items = [];
    this.scratch = { matrix: new THREE.Matrix4(), size: new THREE.Vector3(), color: new THREE.Color(),
      spin: new THREE.Quaternion(), start: new THREE.Vector3(), end: new THREE.Vector3(),
      counts: { tracer: 0, rifle: 0, pistol: 0, spark: 0 } };

    // 1. Every tracer is one segment of a single line set; each vertex carries
    //    its own colour and opacity, so all streaks share one material.
    const tracerPositions = new THREE.BufferAttribute(new Float32Array(pool.tracers * 6), 3);
    const tracerColors = new THREE.BufferAttribute(new Float32Array(pool.tracers * 8), 4);
    tracerPositions.setUsage(THREE.DynamicDrawUsage);
    tracerColors.setUsage(THREE.DynamicDrawUsage);
    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerGeometry.setAttribute('position', tracerPositions);
    this.tracerGeometry.setAttribute('color', tracerColors);
    this.tracerGeometry.setDrawRange(0, 0);
    this.tracerMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.tracers = new THREE.LineSegments(this.tracerGeometry, this.tracerMaterial);

    // 2. One instanced cone per muzzle-flash style, sharing one material
    //    (each flash's colour is an instance colour).
    this.flashMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.flashGeometries = {};
    this.flashes = {};
    for (const style of ['rifle', 'pistol']) {
      const shape = FLASH[style];
      this.flashGeometries[style] = new THREE.ConeGeometry(shape.radius, shape.length, shape.sides);
      this.flashes[style] = this.instanced(this.flashGeometries[style], this.flashMaterial, pool.flashes);
    }

    // 3. Every spark is an instance of one small tetrahedron.
    this.sparkGeometry = new THREE.TetrahedronGeometry(1);
    this.sparkMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.sparks = this.instanced(this.sparkGeometry, this.sparkMaterial, pool.sparks);

    // 4. Pooled records, so firing allocates nothing. Each pool matches one draw
    //    object's room: tracers, rifle flashes, pistol flashes, sparks.
    this.free = {
      tracer: Array.from({ length: pool.tracers }, () => this.makeRecord('tracer', 'tracer')),
      'flash:rifle': Array.from({ length: pool.flashes }, () => this.makeRecord('flash', 'flash:rifle', 'rifle')),
      'flash:pistol': Array.from({ length: pool.flashes }, () => this.makeRecord('flash', 'flash:pistol', 'pistol')),
      spark: Array.from({ length: pool.sparks }, () => this.makeRecord('spark', 'spark')),
    };

    // 5. The three draw objects stay in the scene for the whole session (drawing
    //    nothing while no effect is alive). They are never culled by their own
    //    small bounds, since their effects can be anywhere.
    for (const object of this.drawObjects) {
      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = false;
      scene.add(object);
    }
  }

  // The scene objects this pool draws through.
  get drawObjects() {
    return [this.tracers, this.flashes.rifle, this.flashes.pistol, this.sparks];
  }

  // An instanced mesh with room for `count` effects and an instance colour
  // (created up front: the shader needs to know about it before the first frame).
  instanced(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i += 1) mesh.setColorAt(i, this.scratch.color.set(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    return mesh;
  }

  // One reusable effect record (its vectors are reused too). pool: which free
  // list it returns to; style: 'rifle' | 'pistol' (a flash's style never changes).
  makeRecord(kind, pool, style = 'rifle') {
    return {
      kind, pool, style, life: 1, age: 0,
      // tracer: start of the path, its direction and length, streak share and opacity
      origin: new THREE.Vector3(), direction: new THREE.Vector3(), distance: 0, trailFraction: 1, initialOpacity: 1,
      // flash / spark: where, which way, how big, what colour
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), size: new THREE.Vector3(1, 1, 1), color: 0xffffff,
      // spark: its flight (null for the other kinds, so "has velocity" means a spark)
      velocity: kind === 'spark' ? new THREE.Vector3() : null,
    };
  }

  // A free record from a pool, or that pool's oldest live one when all are in use.
  acquire(pool) {
    let record = this.free[pool].pop();
    if (!record) {
      const index = this.items.findIndex(item => item.pool === pool);
      record = this.items[index];
      // Close the gap in place (no new array), keeping the rest oldest first.
      this.items.copyWithin(index, index + 1);
      this.items.length -= 1;
    }
    record.age = 0;
    this.items.push(record);
    return record;
  }

  // ---- New effects ----

  // A shot from `origin` that ended at `end`. rifle: the M416 style, else the pistol's.
  shot(origin, end, rifle) {
    const style = rifle ? 'rifle' : 'pistol';
    const tracer = this.acquire('tracer');
    tracer.style = style;
    const look = TRACER[style];
    tracer.origin.copy(origin);
    tracer.direction.subVectors(end, origin);
    tracer.distance = tracer.direction.length();
    if (tracer.distance > 1e-9) tracer.direction.divideScalar(tracer.distance);
    else tracer.direction.set(0, 0, 1);
    tracer.trailFraction = look.trail;
    tracer.initialOpacity = look.opacity;
    tracer.color = look.color;
    tracer.life = look.life;
    // The flash sits just past the barrel, pointing the way the bullet went, at a random twist.
    const shape = FLASH[style];
    const flash = this.acquire(style === 'rifle' ? 'flash:rifle' : 'flash:pistol');
    flash.position.copy(origin).addScaledVector(tracer.direction, FLASH.offset * this.scale);
    flash.quaternion.setFromUnitVectors(UP, tracer.direction)
      .multiply(this.scratch.spin.setFromAxisAngle(UP, this.random() * Math.PI));
    flash.size.setScalar(this.scale * (0.8 + this.random() * 0.4));
    flash.color = shape.color;
    flash.life = shape.life;
    this.sync();
  }

  // Sparks thrown off an enemy hit at `point` along the surface `normal`.
  impact(point, normal, rifle) {
    const style = rifle ? 'rifle' : 'pistol';
    this.kick = Math.max(this.kick, KICK[style]);
    for (let i = 0; i < SPARKS.count[style]; i += 1) {
      const spark = this.acquire('spark');
      spark.velocity.set(this.random() - 0.5, this.random() * 0.7, this.random() - 0.5)
        .addScaledVector(normal, 1.2).normalize()
        .multiplyScalar((SPARKS.speed[0] + this.random() * SPARKS.speed[1]) * this.scale);
      const size = (SPARKS.size[0] + this.random() * SPARKS.size[1]) * this.scale;
      spark.size.set(size, size, size * SPARKS.stretch);
      spark.position.copy(point).addScaledVector(normal, SPARKS.lift * this.scale);
      spark.quaternion.setFromUnitVectors(FORWARD, this.scratch.start.copy(spark.velocity).normalize());
      spark.color = SPARKS.colors[i % SPARKS.colors.length];
      spark.life = SPARKS.life[0] + this.random() * SPARKS.life[1];
    }
    this.sync();
  }

  // ---- Each frame ----

  update(dt) {
    this.kick *= Math.exp(-KICK.settle * dt);
    // Age everything; drop what has expired (keeping the rest oldest first).
    let kept = 0;
    for (const item of this.items) {
      item.age += dt;
      if (item.age >= item.life) {
        this.free[item.pool].push(item);
        continue;
      }
      if (item.velocity) {
        item.position.addScaledVector(item.velocity, dt);
        item.velocity.y -= SPARKS.gravity * this.scale * dt;
      }
      this.items[kept] = item;
      kept += 1;
    }
    this.items.length = kept;
    this.sync();
  }

  // Write every live effect into the shared buffers (in place, no new buffers).
  sync() {
    const { matrix, size, color, start, end, counts } = this.scratch;
    const positions = this.tracerGeometry.attributes.position;
    const colors = this.tracerGeometry.attributes.color;
    counts.tracer = 0; counts.rifle = 0; counts.pistol = 0; counts.spark = 0;
    for (const item of this.items) {
      const fade = 1 - item.age / item.life;
      if (item.kind === 'tracer') {
        // The streak's tail runs toward the head as it fades; the head stays at the hit.
        const tail = item.distance * (1 - item.trailFraction + item.trailFraction * item.age / item.life);
        start.copy(item.origin).addScaledVector(item.direction, tail);
        end.copy(item.origin).addScaledVector(item.direction, item.distance);
        const index = counts.tracer * 2;
        positions.setXYZ(index, start.x, start.y, start.z);
        positions.setXYZ(index + 1, end.x, end.y, end.z);
        color.set(item.color);
        const alpha = item.initialOpacity * fade;
        colors.setXYZW(index, color.r, color.g, color.b, alpha);
        colors.setXYZW(index + 1, color.r, color.g, color.b, alpha);
        counts.tracer += 1;
      } else {
        // Flashes and sparks shrink away as they fade.
        const mesh = item.kind === 'spark' ? this.sparks : this.flashes[item.style];
        const slot = item.kind === 'spark' ? counts.spark++ : counts[item.style]++;
        matrix.compose(item.position, item.quaternion, size.copy(item.size).multiplyScalar(Math.sqrt(Math.max(fade, 0))));
        mesh.setMatrixAt(slot, matrix);
        mesh.setColorAt(slot, color.set(item.color));
      }
    }
    this.tracerGeometry.setDrawRange(0, counts.tracer * 2);
    positions.needsUpdate = counts.tracer > 0;
    colors.needsUpdate = counts.tracer > 0;
    this.showInstances(this.flashes.rifle, counts.rifle);
    this.showInstances(this.flashes.pistol, counts.pistol);
    this.showInstances(this.sparks, counts.spark);
  }

  // Draw the first `count` instances of a pooled mesh (their data was just written).
  showInstances(mesh, count) {
    mesh.count = count;
    if (!count) return;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // Compile the effects' shaders now (the draw objects are already in the scene),
  // so the first shot of a session never stalls on a shader build.
  prewarm(renderer, camera) {
    renderer?.compile?.(this.scene, camera);
  }

  // ---- The Leaper's render-only shudder ----

  beforeRender(robot) {
    this.savedRotation = robot.rotation.clone();
    robot.rotation.x += this.kick;
    robot.rotation.z += this.kick * 0.45;
  }

  afterRender(robot) {
    if (this.savedRotation) robot.rotation.copy(this.savedRotation);
    this.savedRotation = null;
  }

  // ---- Clean-up ----

  // Every effect gone at once (a restart). The pool stays ready for the next shot.
  clear() {
    for (const item of this.items) this.free[item.pool].push(item);
    this.items.length = 0;
    this.kick = 0;
    this.sync();
  }

  // The session is over: the draw objects leave the scene and free their GPU memory.
  dispose() {
    this.clear();
    for (const object of this.drawObjects) this.scene.remove(object);
    this.tracerGeometry.dispose();
    this.tracerMaterial.dispose();
    for (const geometry of Object.values(this.flashGeometries)) geometry.dispose();
    this.flashMaterial.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    for (const mesh of [this.flashes.rifle, this.flashes.pistol, this.sparks]) mesh.dispose?.();
  }
}
