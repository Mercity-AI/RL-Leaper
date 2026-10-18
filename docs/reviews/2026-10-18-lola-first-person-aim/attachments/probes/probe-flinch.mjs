// Probe: during the procedural hit flinch, do the shoulders/hands/gun follow the bent spine?
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const root = process.argv[2];
globalThis.window = { URL, addEventListener() {} }; globalThis.self = globalThis.window;
const { LolaPlayer } = await import(`${root}/src/robot/LolaPlayer.js`);
const load = name => { const file = fs.readFileSync(`${root}/assets/characters/lola/lola-${name}.glb`); const l = new GLTFLoader();
  l.register(() => ({ name: 'T', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((res, rej) => l.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', res, rej)); };
const p = new LolaPlayer(new THREE.Scene(), { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
  { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
const F = new THREE.Vector3(0, 0, 1), Rt = new THREE.Vector3(-1, 0, 0);
p.move(0, 0, F, Rt, 4.5, 0.2);
const o = p.outfits[0];
const get = n => o.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)) || o.model.getObjectByName(n);
const parts = { head: get('DEF-spine.006'), chestSpine: get('DEF-spine.003'), shoulderR: get('DEF-shoulder.R'), handR: get('DEF-hand.R'), carriedGun: o.carriedGun };
const pos = () => { p.mesh.updateMatrixWorld(true); return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.getWorldPosition(new THREE.Vector3())])); };
p.reactToHit(new THREE.Vector3(1, 0, 0));
p.move(0, 0, F, Rt, 4.5, 0.1); // near the flinch peak (0.18 * 0.6 s)
const bent = pos();
o.hitBone.quaternion.copy(o.hitBase); // undo just the procedural flinch on the same frame
const neutral = pos();
console.table(Object.fromEntries(Object.keys(parts).map(k => [k, { displacement_cm: (bent[k].distanceTo(neutral[k]) * 100).toFixed(1) }])));
console.log('parent of DEF-shoulder.R:', parts.shoulderR.parent.name, '| parent of carried gun:', o.carriedGun.parent.name, '| hitBone:', o.hitBone.name);
