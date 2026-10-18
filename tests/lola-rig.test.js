import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { cloneCharacter, OUTFIT_WEAPONS } from '../src/actors/lola/LolaAssets.js';

// Lola's flat exported skeleton is re-parented when she loads (review fix
// 5.33, see LolaRig): arms and guns hang from her chest, every clip is
// converted, the authored animation is unchanged, and the hit flinch now
// carries arms, hands and guns instead of tearing the shirt.

// Exercise the real exported skeleton/animations without a browser image decoder.
globalThis.window = { URL, addEventListener() {} };
globalThis.self = globalThis.window;
async function load(name) {
  const file = fs.readFileSync(new URL(`../assets/characters/lola/lola-${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}
const JUMP_FILES = [['RunJumpRL', 'runjumprl'], ['RunJumpLR', 'runjumplr'], ['BackJumpLR', 'backjumplr'], ['BackJumpRL', 'backjumprl']];
async function loadAll() {
  const models = await Promise.all([load('m416'), load('basic')]);
  const jumps = await Promise.all([load('jump-m416'), load('jump-basic')]);
  const reloads = await Promise.all([load('reload-m416'), load('reload-basic')]);
  const runJumps = {};
  for (const [name, file] of JUMP_FILES) runJumps[name] = await Promise.all([load(`${file}-m416`), load(`${file}-basic`)]);
  return { models, jumps, reloads, runJumps };
}
const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(-1, 0, 0);
const named = (root, name) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
const makePlayer = ({ models, jumps, reloads, runJumps }) => new LolaPlayer(new THREE.Scene(),
  { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
  { addEventListener() {}, classList: { add() {} } }, models, jumps, reloads, runJumps);

test('the skeleton is re-parented into a proper upper-body chain', async () => {
  const player = makePlayer(await loadAll());
  for (const [index, outfit] of player.outfits.entries()) {
    const parent = name => named(outfit.model, name).parent.name;
    assert.equal(parent('DEF-shoulder.R'), 'DEF-spine003');
    assert.equal(parent('DEF-shoulder.L'), 'DEF-spine003');
    assert.equal(parent('DEF-upper_arm.R'), 'DEF-shoulderR');
    assert.equal(parent('DEF-upper_arm.L'), 'DEF-shoulderL');
    assert.equal(parent('chest'), 'DEF-spine003', 'the bone carrying the rifle hangs from her chest');
    assert.equal(outfit.shotGun.parent.name, 'DEF-spine003', 'the shooting gun rides on her chest');
    for (const { gun } of Object.values(outfit.jumpClips)) assert.equal(gun.parent.name, 'DEF-spine003');
    // The legs stay as exported (the flinch bends the spine above the hips).
    assert.ok(!named(outfit.model, 'DEF-thigh.L').parent.isBone);
    assert.ok(OUTFIT_WEAPONS[index]);
  }
});

test('every authored clip keeps its world-space pose within 1 mm after re-parenting', async () => {
  const files = await loadAll();
  const player = makePlayer(files);
  for (const [index, outfit] of player.outfits.entries()) {
    const weapon = OUTFIT_WEAPONS[index];
    // A pristine copy of the exported outfit, with the same jump gun copies.
    const original = cloneCharacter(files.models[index].scene);
    const sources = [['Jump', files.jumps[index]], ...JUMP_FILES.map(([name]) => [name, files.runJumps[name][index]])];
    for (const [name, source] of sources) original.add(source.scene.getObjectByName(`${weapon}_${name}Weapon`).clone());
    // Tracks for objects the outfit does not have (the reload's own gun) would
    // bind to the model's root in three.js and move the whole character, so
    // drop them; the game's reload layer filters them out the same way.
    const own = clip => new THREE.AnimationClip(clip.name, clip.duration,
      clip.tracks.filter(track => original.getObjectByName(track.name.split('.')[0])));
    const clips = [...files.models[index].animations, ...sources.map(([name, source]) => source.animations.find(clip => clip.name === name)),
      files.reloads[index].animations.find(clip => clip.name === 'Reload')].map(own);
    const reference = new THREE.AnimationMixer(original);
    const converted = new THREE.AnimationMixer(outfit.model);
    const bones = [];
    original.traverse(node => { if (node.isBone) bones.push(node.name); });
    for (const clip of clips) {
      // Guns that show during this clip: the carried one, plus the shooting
      // gun for shots or the clip's own gun for jumps.
      const guns = [outfit.carriedGun.name];
      if (clip.name.includes('Shoot')) guns.push(outfit.shotGun.name);
      if (clip.name.includes('Jump')) guns.push(`${weapon}_${clip.name}Weapon`);
      reference.stopAllAction();
      converted.stopAllAction();
      const a = reference.clipAction(clip).play();
      const b = converted.clipAction(outfit.rig.convert(clip)).play();
      let worst = 0, where = '';
      for (let time = 0; time <= clip.duration; time += 1 / 120) {
        a.time = time; b.time = time;
        reference.update(0); converted.update(0);
        original.updateMatrixWorld(true); player.mesh.updateMatrixWorld(true);
        const compare = (name, point = new THREE.Vector3()) => {
          const before = point.clone().applyMatrix4(original.getObjectByName(name).matrixWorld);
          const after = outfit.model.worldToLocal(point.clone().applyMatrix4(outfit.model.getObjectByName(name).matrixWorld));
          const error = before.distanceTo(after);
          if (error > worst) { worst = error; where = `${name} at ${time.toFixed(3)} s`; }
        };
        for (const name of bones) compare(name);
        // Guns: their whole shape, through the corners of their bounding box.
        for (const name of guns) {
          const box = original.getObjectByName(name).geometry.boundingBox ?? (original.getObjectByName(name).geometry.computeBoundingBox(), original.getObjectByName(name).geometry.boundingBox);
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) compare(name, new THREE.Vector3(x, y, z));
        }
      }
      assert.ok(worst < 0.001, `${weapon} ${clip.name}: off by ${(worst * 1000).toFixed(2)} mm (${where})`);
    }
  }
});

test('the hit flinch carries shoulders, hands and guns with the chest and keeps the shirt within 1.2x', async () => {
  const files = await loadAll();
  for (const weapon of [0, 1]) for (const aiming of [false, true]) for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    const player = makePlayer(files);
    if (weapon) player.switchWeapon();
    player.move(0, 0, FORWARD, RIGHT, 4.5, 0.2);
    const outfit = player.equipped;
    if (aiming) { player.aimHeld = true; player.holdAim(); player.move(0, 0, FORWARD, RIGHT, 4.5, 0.05); }
    player.reactToHit(direction);
    player.move(0, 0, FORWARD, RIGHT, 4.5, 0.1); // near the peak of the flinch
    assert.ok(outfit.hitBase, 'the flinch is playing');
    const label = `${weapon ? 'pistol' : 'M416'} ${aiming ? 'aiming' : 'idle'} hit from ${direction.x ? 'the side' : 'the front'}`;
    const gun = aiming && player.shot ? outfit.shotGun : outfit.carriedGun;
    const chest = named(outfit.model, 'DEF-spine.003');
    const skinned = [];
    outfit.model.traverse(mesh => { if (mesh.isSkinnedMesh) skinned.push(mesh); });
    const snapshot = () => {
      player.mesh.updateMatrixWorld(true);
      const points = {};
      for (const name of ['DEF-shoulder.R', 'DEF-shoulder.L', 'DEF-hand.R', 'DEF-hand.L']) points[name] = named(outfit.model, name).getWorldPosition(new THREE.Vector3());
      const tips = [], vertex = new THREE.Vector3(), positions = gun.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 8) tips.push(vertex.fromBufferAttribute(positions, i).applyMatrix4(gun.matrixWorld).clone());
      const onChest = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(gun.matrixWorld);
      const handOnChest = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(named(outfit.model, 'DEF-hand.R').matrixWorld);
      const skin = skinned.map(mesh => {
        const source = mesh.geometry.attributes.position, out = [], point = new THREE.Vector3();
        for (let i = 0; i < source.count; i += 1) out.push(mesh.boneTransform(i, point.fromBufferAttribute(source, i)).applyMatrix4(mesh.matrixWorld).clone());
        return out;
      });
      return { points, tips, onChest, handOnChest, skin };
    };
    const bent = snapshot();
    const flinched = outfit.flinchBones.map(({ bone }) => bone.quaternion.clone());
    outfit.flinchBones.forEach(({ bone, base }) => bone.quaternion.copy(base));
    const neutral = snapshot();
    outfit.flinchBones.forEach(({ bone }, i) => bone.quaternion.copy(flinched[i]));

    // They move WITH the chest: their place relative to it is untouched...
    assert.ok(bent.onChest.elements.every((value, i) => Math.abs(value - neutral.onChest.elements[i]) < 1e-6), `${label}: gun rides the chest`);
    assert.ok(bent.handOnChest.elements.every((value, i) => Math.abs(value - neutral.handOnChest.elements[i]) < 1e-6), `${label}: hand rides the chest`);
    // ...and visibly (before the fix every one of these stayed at 0 cm).
    const moved = name => bent.points[name].distanceTo(neutral.points[name]);
    assert.ok(Math.max(moved('DEF-shoulder.R'), moved('DEF-shoulder.L')) > 0.05, `${label}: shoulders move`);
    assert.ok(Math.max(moved('DEF-hand.R'), moved('DEF-hand.L')) > 0.05, `${label}: hands move`);
    const gunMoved = Math.max(...bent.tips.map((tip, i) => tip.distanceTo(neutral.tips[i])));
    assert.ok(gunMoved > 0.05, `${label}: gun moves (${(gunMoved * 100).toFixed(1)} cm)`);
    // No skin edge is stretched beyond 1.2x its length (it was 2.3x at the shoulders).
    let worst = 1;
    skinned.forEach((mesh, k) => {
      const index = mesh.geometry.index.array;
      for (let i = 0; i < index.length; i += 3) {
        for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
          const length = neutral.skin[k][a].distanceTo(neutral.skin[k][b]);
          if (length > 1e-5) worst = Math.max(worst, bent.skin[k][a].distanceTo(bent.skin[k][b]) / length);
        }
      }
    });
    assert.ok(worst <= 1.2, `${label}: skin stretched ${worst.toFixed(2)}x`);
  }
});

test('a jump\'s gun stays in her right hand while the jump fades in and out', async () => {
  // The jump gun is animated by the jump clip alone, so the mixer used to mix
  // it with its resting place during the fades: it drifted up to 40 cm out of
  // her hand and popped back when the carried gun took over.
  const files = await loadAll();
  const STOWED = new Set(['Basic_Gun_At_Waist', 'M416']);
  for (const weapon of [0, 1]) for (const [label, input] of [['standing', 0], ['running', 1], ['backward', -1]]) {
    const player = makePlayer(files);
    if (weapon) player.switchWeapon();
    for (let i = 0; i < 60; i += 1) player.move(input, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    // Distance from her right hand to the middle of the gun in her hands.
    const reach = () => {
      player.mesh.updateMatrixWorld(true);
      const outfit = player.equipped;
      let gun = null;
      outfit.model.traverse(node => { if (node.isMesh && !node.isSkinnedMesh && node.visible && !STOWED.has(node.name)) gun = node; });
      gun.geometry.computeBoundingBox();
      const middle = gun.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(gun.matrixWorld);
      return middle.distanceTo(named(outfit.model, 'DEF-hand.R').getWorldPosition(new THREE.Vector3()));
    };
    assert.equal(player.jump(), true);
    const reaches = [];
    while (player.jumpState && reaches.length < 200) { player.move(input, 0, FORWARD, RIGHT, 4.5, 1 / 60); reaches.push(reach()); }
    // Mid-jump (full weight) is the authored hold; the fades must stay close to it.
    const authored = reaches[Math.floor(reaches.length / 2)];
    const worst = Math.max(...reaches);
    assert.ok(worst <= authored + 0.04, `${weapon ? 'pistol' : 'M416'} ${label} jump: gun ${(worst * 100).toFixed(1)} cm from her hand (holds it at ${(authored * 100).toFixed(1)})`);
  }
});
