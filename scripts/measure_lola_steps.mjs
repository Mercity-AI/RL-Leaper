// Measure travel from the supporting foot in the exported, in-place animation.
// Run after export_lola.py. Images are irrelevant to skeleton measurements.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.window = { URL };
globalThis.self = globalThis.window;
const result = {};
for (const weapon of ['basic', 'm416']) {
  const bytes = fs.readFileSync(new URL(`../assets/characters/lola/lola-${weapon}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'MEASUREMENT_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await new Promise((resolve, reject) => loader.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const bones = [];
  gltf.scene.traverse(o => { if (o.isBone) bones.push(o); });
  const feet = ['L', 'R'].map(side => bones.find(b => b.name.replace(/[._]/g, '') === `DEF-foot${side}`));
  if (feet.some(foot => !foot)) throw new Error('Missing Lola foot bones');
  const boots = [];
  gltf.scene.traverse(o => { if (o.isSkinnedMesh && /BOOTS/i.test(o.name)) boots.push(o); });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  result[weapon] = {};
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const count = Math.ceil(clip.duration * 96);
    const travel = [0];
    const floorSamples = [];
    const point = new THREE.Vector3();
    let previous;
    const axis = clip.name.startsWith('Strafe') ? 'x' : 'z';
    const sign = clip.name === 'StrafeRight' ? -1 : 1;
    for (let i = 0; i <= count; i += 1) {
      mixer.setTime(clip.duration * i / count);
      gltf.scene.updateMatrixWorld(true);
      const poses = feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
      if (previous) {
        const support = previous[0].y + poses[0].y <= previous[1].y + poses[1].y ? 0 : 1;
        const distance = clip.name.includes('Idle') ? 0
          : Math.max(0, -(poses[support][axis] - previous[support][axis]) * sign);
        travel.push(travel.at(-1) + distance);
      }
      previous = poses;
      if (i % 4 === 0) {
        let floor = Infinity;
        for (const boot of boots) {
          boot.skeleton.update();
          const positions = boot.geometry.attributes.position;
          for (let vertex = 0; vertex < positions.count; vertex += 1) {
            point.fromBufferAttribute(positions, vertex);
            boot.boneTransform(vertex, point).applyMatrix4(boot.matrixWorld);
            floor = Math.min(floor, point.y);
          }
        }
        floorSamples.push(floor);
      }
    }
    floorSamples.sort((a, b) => a - b);
    const groundOffset = -floorSamples[Math.floor(floorSamples.length * 0.15)];
    if (!Number.isFinite(groundOffset)) throw new Error('Missing boot geometry');
    result[weapon][clip.name] = {
      duration: clip.duration,
      distance: Number(travel.at(-1).toFixed(6)),
      groundOffset: Number(groundOffset.toFixed(6)),
      travel: travel.map(value => Number(value.toFixed(6))),
    };
    console.log(weapon, clip.name, result[weapon][clip.name].distance, 'units/cycle', 'floor', groundOffset.toFixed(3));
  }
}
fs.writeFileSync(new URL('../assets/characters/lola/stride-profiles.json', import.meta.url), JSON.stringify(result));
