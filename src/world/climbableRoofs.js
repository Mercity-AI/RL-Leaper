import * as THREE from 'three';

// Props Lola can climb onto (owner, 2026-10-21: "jump on the container and
// shoot from there"). Each is found in the loaded map by its Blender names:
// `prop` names every part (matched from the start, like JUNKYARD_PROP_COLOURS),
// `roof` the flat sheet she walks on. Its outline is that sheet's; its height
// is the top of the sheet or of the parts lying on it (its ribs stick up a little).
export const CLIMBABLE_PROPS = Object.freeze([
  // The open, toppled yellow container by the south wall (lying on its side,
  // so its upper side sheet is the roof).
  Object.freeze({ prop: '03 - southern fallen freight', roof: '03 - southern fallen freight | side sheet.001' }),
]);

// The loader writes spaces as underscores and drops dots.
const plain = (name) => name.replace(/_/g, ' ').replace(/\./g, '');

// A flat rectangle Lola can stand on, in world units: its centre, its two
// unit axes on the ground, the half size along each, and the world height of
// its top surface.
export class Roof {
  constructor({ name = '', center, u, v, halfU, halfV, top }) {
    Object.assign(this, { name, center, u, v, halfU, halfV, top });
  }

  // (x, z) in the roof's own axes.
  local(x, z) {
    const dx = x - this.center.x, dz = z - this.center.z;
    return { a: dx * this.u.x + dz * this.u.z, b: dx * this.v.x + dz * this.v.z };
  }

  world(a, b) {
    return { x: this.center.x + this.u.x * a + this.v.x * b, z: this.center.z + this.u.z * a + this.v.z * b };
  }

  // Is (x, z) over the roof (grown by `margin`, shrunk when it is negative)?
  contains(x, z, margin = 0) {
    const { a, b } = this.local(x, z);
    return Math.abs(a) <= this.halfU + margin && Math.abs(b) <= this.halfV + margin;
  }

  // The point of the roof nearest (x, z), kept `inset` in from its edges.
  nearest(x, z, inset = 0) {
    const { a, b } = this.local(x, z);
    const keepU = Math.max(0, this.halfU - inset), keepV = Math.max(0, this.halfV - inset);
    return this.world(THREE.MathUtils.clamp(a, -keepU, keepU), THREE.MathUtils.clamp(b, -keepV, keepV));
  }

  // The outward direction of the edge (x, z) is past (or nearest to).
  outward(x, z) {
    const { a, b } = this.local(x, z);
    const pastU = Math.abs(a) - this.halfU, pastV = Math.abs(b) - this.halfV;
    const axis = pastU >= pastV ? this.u : this.v;
    const sign = Math.sign(pastU >= pastV ? a : b) || 1;
    return { x: axis.x * sign, z: axis.z * sign };
  }
}

// The roofs of CLIMBABLE_PROPS in a loaded, scaled map (missing props are
// skipped, so a new yard without them simply has none).
export function findClimbableRoofs(map, props = CLIMBABLE_PROPS) {
  map.updateMatrixWorld(true);
  const roofs = [];
  for (const { prop, roof: roofName } of props) {
    const parts = [];
    let sheet = null;
    map.traverse((object) => {
      if (!object.isMesh) return;
      const name = plain(object.name);
      if (name.startsWith(plain(prop))) parts.push(object);
      if (name === plain(roofName)) sheet = object;
    });
    if (!sheet) continue;
    // The sheet's outline: its two longer local axes (the third is its
    // thickness), measured in the world from the sheet's centre.
    sheet.geometry.computeBoundingBox();
    const box = sheet.geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const middle = box.getCenter(new THREE.Vector3());
    const center = middle.clone().applyMatrix4(sheet.matrixWorld);
    const thin = [size.x, size.y, size.z].indexOf(Math.min(size.x, size.y, size.z));
    const [first, second] = [0, 1, 2].filter((axis) => axis !== thin).map((axis) => {
      const edge = middle.clone().setComponent(axis, middle.getComponent(axis) + size.getComponent(axis) / 2);
      const reach = edge.applyMatrix4(sheet.matrixWorld).sub(center);
      return new THREE.Vector2(reach.x, reach.z);
    });
    const roof = new Roof({
      name: prop,
      center: { x: center.x, z: center.z },
      u: { x: first.x / first.length(), z: first.y / first.length() },
      v: { x: second.x / second.length(), z: second.y / second.length() },
      halfU: first.length(), halfV: second.length(),
      top: 0,
    });
    const sheetBounds = new THREE.Box3().setFromObject(sheet);
    roof.top = sheetBounds.max.y;
    // Parts lying on the sheet (its ribs) raise the top; ones off its outline
    // (a door hanging open) do not.
    for (const part of parts) {
      const bounds = new THREE.Box3().setFromObject(part), middle = bounds.getCenter(new THREE.Vector3());
      if (roof.contains(middle.x, middle.z) && bounds.min.y >= sheetBounds.min.y) roof.top = Math.max(roof.top, bounds.max.y);
    }
    roofs.push(roof);
  }
  return roofs;
}
