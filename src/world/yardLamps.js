import * as THREE from 'three';

// Warm lamps on the yard's standing utility poles (owner, 2026-11-02: "a light
// source here and there"). Every pole gets a small glowing bulb (the glow pass
// gives it its halo), but only `slots` real lights exist, without shadows: each
// costs every lit pixel (5 of them took the built-in chip below 60 fps). They
// serve the lamps nearest Lola, fading across when she moves on. The poles are
// found by name in the map (map units), so a new yard keeps its lamps.
const POLE = /Perimeter_utility_mast/;

export class YardLamps {
  constructor(map, scene, { scale, lamps }) {
    Object.assign(this, { scene, config: lamps });
    this.group = new THREE.Group();
    this.group.name = 'yard lamps';
    this.bulb = new THREE.SphereGeometry(lamps.bulbRadius * scale, 12, 8);
    this.material = new THREE.MeshBasicMaterial({ color: lamps.bulbColour, fog: false });
    this.material.userData.glow = true;
    // 1. A bulb on each pole, under the crossarm, leaning out over the yard.
    this.spots = [];
    const box = new THREE.Box3(), centre = new THREE.Vector3(), inward = new THREE.Vector3();
    map.updateMatrixWorld(true);
    map.traverse((object) => {
      if (!object.isMesh || !POLE.test(object.name)) return;
      box.setFromObject(object).getCenter(centre);
      inward.set(-centre.x, 0, -centre.z).normalize().multiplyScalar(lamps.reachOut * scale);
      const spot = new THREE.Vector3(centre.x + inward.x, lamps.height * scale, centre.z + inward.z);
      const head = new THREE.Mesh(this.bulb, this.material);
      head.position.copy(spot);
      head.raycast = () => {};
      this.group.add(head);
      this.spots.push(spot);
    });
    // 2. The real lights, starting at the first lamps.
    this.lights = Array.from({ length: Math.min(lamps.slots, this.spots.length) }, (_, index) => {
      const light = new THREE.PointLight(lamps.colour, lamps.intensity, lamps.range * scale, lamps.decay);
      light.position.copy(this.spots[index]);
      this.group.add(light);
      return light;
    });
    scene.add(this.group);
  }

  // Each frame: a light whose lamp is no longer among the nearest to `focus`
  // fades out, moves to a nearest lamp that has no light, and fades back in.
  update(focus, dt) {
    const near = [...this.spots].sort((a, b) => flat(a, focus) - flat(b, focus)).slice(0, this.lights.length);
    const step = this.config.intensity * dt / this.config.fade;
    for (const light of this.lights) {
      const wanted = near.some((spot) => spot.equals(light.position));
      light.intensity = Math.min(this.config.intensity, Math.max(0, light.intensity + (wanted ? step : -step)));
      if (wanted || light.intensity > 0) continue;
      const free = near.find((spot) => !this.lights.some((other) => spot.equals(other.position)));
      if (free) light.position.copy(free);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.bulb.dispose();
    this.material.dispose();
  }
}

const flat = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
