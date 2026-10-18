// Probe: foot skating per input direction, strafe reversal state flicker, wall behaviour (read-only on WT).
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const root = process.argv[2];
globalThis.window = { URL, addEventListener() {} }; globalThis.self = globalThis.window;
const { LolaPlayer } = await import(`${root}/src/robot/LolaPlayer.js`);
async function load(name) {
  const file = fs.readFileSync(`${root}/assets/characters/lola/lola-${name}.glb`);
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'T', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((res, rej) => loader.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', res, rej));
}
const make = async (blocked = () => false) => new LolaPlayer(new THREE.Scene(), { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: blocked },
  { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
const F = new THREE.Vector3(0, 0, 1), Rt = new THREE.Vector3(-1, 0, 0);
// 1) Skating: planted toe (lowest toe, within 2 cm of its floor) horizontal speed, relative to Lola's travel speed.
const rows = [];
for (const [label, f, s, speed, crouch] of [['W run', 1, 0, 4.5, false], ['W sprint', 1, 0, 8, false], ['S backpedal', -1, 0, 4.5, false],
  ['D strafe', 0, 1, 4.5, false], ['W+D diagonal', 1, 1, 4.5, false], ['S+D diagonal', -1, 1, 4.5, false], ['W crouch', 1, 0, 4.5, true]]) {
  const p = await make(); p.crouching = crouch;
  const o = p.outfits[0];
  const toes = ['DEF-toe.L', 'DEF-toe.R'].map(n => o.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)));
  for (let i = 0; i < 90; i++) p.move(f, s, F, Rt, speed, 1 / 60);
  let skate = [], travel = 0, startPos = p.mesh.position.clone();
  const frames = [];
  for (let i = 0; i < 120; i++) {
    p.move(f, s, F, Rt, speed, 1 / 60);
    p.mesh.updateMatrixWorld(true);
    frames.push(toes.map(t => t.getWorldPosition(new THREE.Vector3())));
  }
  const floorY = Math.min(...frames.flat().map(v => v.y));
  for (let i = 1; i < frames.length; i++) for (const k of [0, 1]) {
    if (frames[i][k].y < floorY + 0.015 && frames[i - 1][k].y < floorY + 0.015)
      skate.push(Math.hypot(frames[i][k].x - frames[i - 1][k].x, frames[i][k].z - frames[i - 1][k].z) * 60);
  }
  if (!skate.length) skate.push(NaN);
  travel = p.mesh.position.distanceTo(startPos) / 2;
  skate.sort((a, b) => a - b);
  rows.push({ input: label, state: o.current, travel_per_s: travel.toFixed(2), planted_toe_median_speed: skate[Math.floor(skate.length / 2)].toFixed(2), planted_samples: skate.length,
    ratio: (skate[Math.floor(skate.length / 2)] / travel).toFixed(2) });
}
console.table(rows);
// 2) Strafe reversal A -> D: which clips does Lola select frame by frame?
{
  const p = await make();
  for (let i = 0; i < 40; i++) p.move(0, -1, F, Rt, 4.5, 1 / 60);
  const seq = [];
  for (let i = 0; i < 12; i++) { p.move(0, 1, F, Rt, 4.5, 1 / 60); seq.push(p.outfits[0].current + ':' + p.outfits[0].actions.Run.getEffectiveWeight().toFixed(2)); }
  console.log('A->D reversal (state:RunWeight per 60fps frame):', seq.join(' '));
  for (let i = 0; i < 40; i++) p.move(1, 0, F, Rt, 4.5, 1 / 60);
  const rel = [];
  for (let i = 0; i < 20; i++) { p.move(0, 0, F, Rt, 4.5, 1 / 60); rel.push(p.outfits[0].current); }
  console.log('release W (state per frame):', rel.join(' '));
}
// 3) Running into a wall: what pose does Lola hold?
{
  const p = await make((x, z) => z > 0.5);
  for (let i = 0; i < 120; i++) p.move(1, 0, F, Rt, 4.5, 1 / 60);
  const o = p.outfits[0];
  console.log('pressing into wall after 2 s:', { z: p.mesh.position.z.toFixed(3), state: o.current, runWeight: o.actions.Run.getEffectiveWeight().toFixed(2), runTimeScale: o.actions.Run.timeScale.toFixed(3), idleWeight: o.actions.Idle.getEffectiveWeight().toFixed(2) });
}
// 4) Diagonal (45 degree) wall: does she slide along it when pushing straight ahead?
{
  const p = await make((x, z) => z - x > 1.0);
  for (let i = 0; i < 120; i++) p.move(1, 0, F, Rt, 4.5, 1 / 60);
  const a = p.mesh.position.clone();
  for (let i = 0; i < 120; i++) p.move(1, 0, F, Rt, 4.5, 1 / 60);
  console.log('45-degree wall, 2 s more pushing W:', { start: a.toArray().map(v => v.toFixed(3)), end: p.mesh.position.toArray().map(v => v.toFixed(3)), moved: p.mesh.position.distanceTo(a).toFixed(3) });
}
