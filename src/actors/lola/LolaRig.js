import * as THREE from 'three';

// Lola's exported skeleton is "flat": shoulders, upper arms, the gun-carrying
// chest bone, hips and legs all hang straight from the rig's root instead of
// from the spine (Blender's DEF-bones-only export drops their real parents).
// So anything that bends the spine after the animation (the hit flinch, a
// hip twist) tears her torso away from arms and gun that stay frozen.
//
// The Blender sources are not in the repository, so this fixes it when Lola
// loads: re-parent the arm chain and the gun-carrying chest bone under her
// chest, carry the root-level guns (shooting and jump guns) on the chest too,
// and rewrite every animation track of a moved node from its old parent's
// space into its new parent's, by sampling the authored world transform at
// every keyframe. The authored animation looks the same; only the hierarchy
// changes. The legs stay as exported: the flinch bends the spine above the
// hips, so they never needed to follow it.
//
// The guns hang from the chest rather than the hand on purpose: the arm bones
// stretch unevenly (up to 12% along one axis), and a rigid gun parented to
// them would be skewed. The chest scales evenly, and in every authored clip
// the hands and gun keep their authored places relative to it.

const sanitize = THREE.PropertyBinding.sanitizeNodeName;

// New parents, parents first (a moved bone may hang from another moved bone).
export const LOLA_RIG_PARENTS = Object.freeze([
  ['chest', 'DEF-spine.003'],
  ['DEF-shoulder.L', 'DEF-spine.003'],
  ['DEF-shoulder.R', 'DEF-spine.003'],
  ['DEF-upper_arm.L', 'DEF-shoulder.L'],
  ['DEF-upper_arm.R', 'DEF-shoulder.R'],
]);
// Root-level guns (the shooting gun and the jump guns) move onto this bone.
export const LOLA_GUN_PARENT = 'DEF-spine.003';
// A stepped (discrete) key is sampled this long before it too, so the step
// stays a step after conversion (seconds).
const STEP_EDGE = 1e-4;
// Extra samples between authored keys. Between keys the new track blends
// linearly while the true pose is a blend of blends; one midpoint keeps the
// fastest (jump) clips within a millimetre.
const SUBDIVIDE = 2;

const matrix = (p, q, s) => new THREE.Matrix4().compose(p, q, s);
// Converted clips, per loaded clip and rig layout, so a second Lola built from
// the same loaded files reuses them.
const converted = new WeakMap();

export class LolaRig {
  // model: a fresh copy of an outfit; guns: names of root-level gun objects
  // already added to it. Re-parents the model at its rest pose immediately.
  constructor(model, guns = []) {
    this.model = model;
    // Every node's rest transform and original parent, before anything moves.
    this.rest = new Map();
    this.oldParent = new Map();
    model.traverse(node => {
      if (node === model) return;
      this.rest.set(node.name, { p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() });
      this.oldParent.set(node.name, node.parent === model ? null : node.parent.name);
    });
    // What moves where.
    this.moves = [];
    for (const [child, parent] of LOLA_RIG_PARENTS) {
      const node = model.getObjectByName(sanitize(child));
      const target = model.getObjectByName(sanitize(parent));
      if (node && target && node.parent !== target) this.moves.push({ node, target });
    }
    const chest = model.getObjectByName(sanitize(LOLA_GUN_PARENT));
    for (const name of guns) {
      const node = model.getObjectByName(name);
      if (node && chest && node.parent !== chest) this.moves.push({ node, target: chest });
    }
    this.newParent = new Map(this.oldParent);
    for (const { node, target } of this.moves) this.newParent.set(node.name, target.name);
    this.key = this.moves.map(({ node, target }) => `${node.name}>${target.name}`).join('|');
    this.reparentRest();
  }

  // Model-space matrix of a node under a hierarchy, from per-node local
  // transforms (memoised in `cache` for one pose).
  world(name, local, parents, cache) {
    if (name === null) return null;
    if (cache.has(name)) return cache.get(name);
    const { p, q, s } = local(name);
    const result = matrix(p, q, s);
    const parent = this.world(parents.get(name), local, parents, cache);
    if (parent) result.premultiply(parent);
    cache.set(name, result);
    return result;
  }

  // New local transforms of the moved nodes (all, or those listed in `only`)
  // for one pose given by `local` (old-hierarchy locals), so each keeps its
  // exact model-space transform.
  solve(local, only = null) {
    const oldCache = new Map(), newCache = new Map(), solved = new Map();
    const newLocal = name => solved.get(name) ?? local(name);
    for (const { node } of this.moves) {
      if (only && !only.has(node.name)) continue;
      const world = this.world(node.name, local, this.oldParent, oldCache);
      const parent = this.world(this.newParent.get(node.name), newLocal, this.newParent, newCache);
      const relative = parent ? parent.clone().invert().multiply(world) : world;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      relative.decompose(p, q, s);
      solved.set(node.name, { p, q, s });
    }
    return solved;
  }

  // Move the bones and guns at the rest pose, keeping their rest world transforms.
  reparentRest() {
    const solved = this.solve(name => this.rest.get(name));
    for (const { node, target } of this.moves) {
      const { p, q, s } = solved.get(node.name);
      target.add(node);
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
    }
  }

  // A copy of `clip` whose moved nodes are animated in their new parents'
  // space. Sampled at every key of every track (plus just before each
  // stepped key), where it matches the authored pose exactly, and between
  // keys. A gun the clip never animates is left alone: it is hidden then and
  // simply rides on the chest.
  convert(clip) {
    if (!converted.has(clip)) converted.set(clip, new Map());
    const cache = converted.get(clip);
    if (cache.has(this.key)) return cache.get(this.key);
    // Per node and property, a sampler for this clip's track.
    const samplers = new Map();
    const times = new Set();
    for (const track of clip.tracks) {
      const [name, property] = track.name.split('.');
      if (!this.rest.has(name)) continue;
      if (!samplers.has(name)) samplers.set(name, {});
      samplers.get(name)[property] = track.createInterpolant();
      track.times.forEach((time, i) => {
        times.add(time);
        if (i > 0 && track.getInterpolation() === THREE.InterpolateDiscrete) times.add(Math.max(0, time - STEP_EDGE));
      });
    }
    const keys = [...times].sort((a, b) => a - b);
    const sorted = keys.flatMap((time, i) => (i === 0 ? [time]
      : Array.from({ length: SUBDIVIDE }, (_, k) => keys[i - 1] + (time - keys[i - 1]) * (k + 1) / SUBDIVIDE)));
    // Bones always move; guns only when this clip animates them.
    const only = new Set(this.moves.filter(({ node }) => node.isBone || samplers.has(node.name)).map(({ node }) => node.name));
    // Old-hierarchy local of any node at time t: its track, else its rest.
    const localAt = time => name => {
      const rest = this.rest.get(name);
      const sampler = samplers.get(name);
      if (!sampler) return rest;
      const read = (property, Type, fallback) => (sampler[property]
        ? new Type().fromArray(sampler[property].evaluate(time)) : fallback);
      return { p: read('position', THREE.Vector3, rest.p), q: read('quaternion', THREE.Quaternion, rest.q), s: read('scale', THREE.Vector3, rest.s) };
    };
    const values = new Map([...only].map(name => [name, { p: [], q: [], s: [] }]));
    for (const time of sorted) {
      const solved = this.solve(localAt(time), only);
      for (const [name, out] of values) {
        const { p, q, s } = solved.get(name);
        // Keep successive rotations on the same side so they blend the short way.
        const previous = out.q.length ? new THREE.Quaternion().fromArray(out.q, out.q.length - 4) : null;
        if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        out.p.push(...p.toArray());
        out.q.push(...q.toArray());
        out.s.push(...s.toArray());
      }
    }
    const moved = new Set(values.keys());
    const tracks = clip.tracks.filter(track => !moved.has(track.name.split('.')[0]));
    for (const [name, out] of values) {
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, sorted, out.p));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, sorted, out.q));
      tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, sorted, out.s));
    }
    const result = new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
    cache.set(this.key, result);
    return result;
  }
}
