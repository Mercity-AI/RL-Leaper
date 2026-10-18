// While running and shooting (upper-body shot), does the right hand stay on the shooting gun?
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const root = process.argv[2];
globalThis.window = { URL, addEventListener() {} }; globalThis.self = globalThis.window;
const { LolaPlayer } = await import(`${root}/src/robot/LolaPlayer.js`);
const load = name => { const file = fs.readFileSync(`${root}/assets/characters/lola/lola-${name}.glb`); const l = new GLTFLoader();
  l.register(() => ({ name: 'T', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((res, rej) => l.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', res, rej)); };
const g = await load('m416');
const nodes = c => [...new Set(c.tracks.map(t => t.name.split('.')[0]))];
console.log('Run animates:', nodes(g.animations.find(c => c.name === 'Run')).filter(n => !n.startsWith('DEF-')).join(' '));
const F = new THREE.Vector3(0, 0, 1), R = new THREE.Vector3(-1, 0, 0);
for (const weaponIndex of [0, 1]) for (const f of [0, 1]) {
  const p = new LolaPlayer(new THREE.Scene(), { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  p.weaponIndex = weaponIndex; p.showWeapon();
  const o = p.outfits[weaponIndex];
  const hand = o.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-hand.R'));
  const handL = o.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-hand.L'));
  for (let i = 0; i < 60; i++) p.move(f, 0, F, R, 4.5, 1 / 60);
  p.aimHeld = true; p.holdAim();
  let worst = 0, worstL = 0, n = 0, sum = 0;
  for (let i = 0; i < 60; i++) {
    p.holdAim(); p.move(f, 0, F, R, 4.5, 1 / 60);
    p.mesh.updateMatrixWorld(true);
    // distance from each hand to the nearest gun vertex
    const pos = o.shotGun.geometry.attributes.position, v = new THREE.Vector3();
    const hp = hand.getWorldPosition(new THREE.Vector3()), hl = handL.getWorldPosition(new THREE.Vector3());
    let best = Infinity, bestL = Infinity;
    for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(o.shotGun.matrixWorld); best = Math.min(best, v.distanceTo(hp)); bestL = Math.min(bestL, v.distanceTo(hl)); }
    worst = Math.max(worst, best); worstL = Math.max(worstL, bestL); sum += best; n++;
  }
  console.log(weaponIndex === 0 ? 'M416  ' : 'pistol', f ? 'RUNNING' : 'STANDING', 'upperOnly', p.shot?.upperOnly, 'right hand -> gun worst (cm)', (worst * 100).toFixed(1), 'left hand -> gun worst (cm)', (worstL * 100).toFixed(1));
}
