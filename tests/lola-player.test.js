import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import profiles from '../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import contact from '../src/config/player-contact.json' with { type: 'json' };

// Exercise the real exported skeleton/animations without a browser image decoder.
globalThis.window = { URL, addEventListener() {} };
globalThis.self = globalThis.window;
async function load(weapon) {
  const file = fs.readFileSync(new URL(`../assets/characters/lola/lola-${weapon}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_TEXTURES', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  return new Promise((resolve, reject) => loader.parse(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', resolve, reject,
  ));
}

test('player collision radius contains both outfits and guns throughout their animations', async () => {
  for (const weapon of ['basic', 'm416']) {
    const gltf = await load(weapon);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    let maximum = 0;
    const point = new THREE.Vector3();
    for (const clip of gltf.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      for (let sample = 0; sample < 48; sample += 1) {
        mixer.setTime(clip.duration * sample / 48);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(mesh => {
          if (!mesh.isMesh) return;
          if (mesh.isSkinnedMesh) mesh.skeleton.update();
          const vertices = mesh.geometry.attributes.position;
          for (let i = 0; i < vertices.count; i += 1) {
            point.fromBufferAttribute(vertices, i);
            if (mesh.isSkinnedMesh) mesh.boneTransform(i, point);
            point.applyMatrix4(mesh.matrixWorld);
            maximum = Math.max(maximum, Math.hypot(point.x, point.z));
          }
        });
      }
    }
    assert.ok(maximum <= contact.playerRadius, `${weapon} radius ${maximum} exceeds contact envelope`);
  }
});

test('each complete movement cycle travels its measured stride, with a stable floor offset', async () => {
  for (const weapon of ['m416', 'basic']) {
    for (const [clip, f, s, speed, crouching] of [
      ['Run', 1, 0, 4.5, false], ['Run', 1, 0, 8, false],
      ['CrouchWalk', 1, 0, 4.5, true], ['StrafeLeft', 0, -1, 8, false],
      ['StrafeRight', 0, 1, 8, false],
    ]) {
      const player = new LolaPlayer(new THREE.Scene(),
        { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
        { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
      player.weaponIndex = weapon === 'm416' ? 0 : 1;
      player.crouching = crouching;
      for (const outfit of player.outfits) {
        outfit.current = clip;
        for (const [name, action] of Object.entries(outfit.actions)) {
          action.time = 0;
          action.setEffectiveWeight(name === clip ? 1 : 0);
        }
      }
      const profile = profiles[weapon][clip];
      const frames = 120;
      for (let i = 0; i < frames; i += 1) {
        player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), speed,
          profile.duration / frames / (crouching ? 2 : speed > 5 ? 2.7 : 2));
        assert.ok(Math.abs(player.outfits[player.weaponIndex].model.position.y - profile.groundOffset) < 1e-6);
      }
      assert.ok(Math.abs(player.mesh.position.length() - profile.distance) < 0.0001,
        `${weapon} ${clip}: travel must match its foot-derived cycle distance`);
      const time = player.outfits[player.weaponIndex].actions[clip].time;
      player.world.playerBlocked = () => true;
      const position = player.mesh.position.clone();
      player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), speed, 0.1);
      assert.ok(player.mesh.position.equals(position), 'wall blocks root motion');
      assert.ok(Math.abs(player.outfits[player.weaponIndex].actions[clip].time - time) < 1e-6,
        'feet do not continue skating through a wall');
    }
  }
});

test('C toggles crouch once per press and A/D select authored crossovers for both guns', async () => {
  let keydown;
  const originalListener = window.addEventListener;
  window.addEventListener = (name, callback) => { if (name === 'keydown') keydown = callback; };
  const models = await Promise.all([load('m416'), load('basic')]);
  const button = { addEventListener() {}, classList: { add() {} } };
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false }, button, models);
  window.addEventListener = originalListener;
  const press = (code, repeat = false) => keydown({ code, repeat, target: { tagName: 'CANVAS' }, preventDefault() {} });
  const move = (f, s) => player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, 1 / 60);
  for (let weapon = 0; weapon < 2; weapon += 1) {
    move(0, -1);
    assert.equal(player.outfits[weapon].current, 'StrafeLeft');
    move(0, 1);
    assert.equal(player.outfits[weapon].current, 'StrafeRight');
    move(-1, 1);
    assert.ok(Math.abs(player.outfits[weapon].actions.StrafeRight.timeScale - 2) < 1e-6);
    press('KeyC');
    press('KeyC', true);
    move(0, 0);
    assert.equal(player.crouching, true);
    assert.equal(player.outfits[weapon].current, 'CrouchIdle');
    assert.match(button.textContent, /CROUCHED/);
    move(0, -1);
    assert.equal(player.outfits[weapon].current, 'CrouchWalk');
    press('KeyC');
    assert.equal(player.crouching, false);
    press('KeyQ');
  }
  for (const gltf of models) {
    const left = gltf.animations.find(clip => clip.name === 'StrafeLeft');
    const right = gltf.animations.find(clip => clip.name === 'StrafeRight');
    assert.ok(left.tracks.some((track, index) => JSON.stringify([...track.values]) !== JSON.stringify([...right.tracks[index].values])),
      'left and right contain different authored poses');
  }
});

test('both exported outfits have distinct walk/run clips and animate their skeletons', async () => {
  for (const weapon of ['basic', 'm416']) {
    const gltf = await load(weapon);
    assert.deepEqual(gltf.animations.map((clip) => clip.name).sort(), ['CrouchIdle', 'CrouchShoot', 'CrouchWalk', 'Idle', 'Run', 'Shoot', 'StrafeLeft', 'StrafeRight', 'Walk']);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const walk = gltf.animations.find((clip) => clip.name === 'Walk');
    const run = gltf.animations.find((clip) => clip.name === 'Run');
    assert.ok(walk.duration > run.duration * 1.4, 'walk cycle is slower than the sprint cycle');
    mixer.clipAction(walk).play();
    mixer.update(0.1);
    const bones = [];
    gltf.scene.traverse((o) => { if (o.isBone) bones.push(o); });
    assert.ok(bones.length > 15);
    const before = bones.map((b) => b.quaternion.toArray());
    mixer.update(0.3);
    assert.notDeepEqual(bones.map((b) => b.quaternion.toArray()), before);
    gltf.scene.updateMatrixWorld(true);
    for (const bone of bones) assert.ok(bone.matrixWorld.elements.every(Number.isFinite));
  }
});

test('animation clock and blending agree at 30 and 60 rendered frames per second', async () => {
  const samples = [];
  for (const fps of [30, 60]) {
    const models = await Promise.all([load('m416'), load('basic')]);
    const player = new LolaPlayer(new THREE.Scene(),
      { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
      { addEventListener() {}, classList: { add() {} } }, models);
    for (let frame = 0; frame < fps * 2; frame += 1) {
      player.move(1, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, 1 / fps);
    }
    samples.push({ time: player.outfits[0].actions.Run.time,
      z: player.mesh.position.z, weight: player.outfits[0].actions.Run.getEffectiveWeight() });
  }
  for (const key of ['time', 'z', 'weight']) assert.ok(Math.abs(samples[0][key] - samples[1][key]) < 1e-6);
});

test('WASD directions, sprint, wall sliding, and weapon switch preserve player position', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const button = { addEventListener() {}, classList: { add() {} } };
  const world = { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: (x) => x > 0.5 };
  const player = new LolaPlayer(new THREE.Scene(), world, button, models);
  const forward = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3(-1, 0, 0);
  player.move(1, 0, forward, right, 4.5, 0.1);
  const walked = player.mesh.position.z;
  player.move(-1, 0, forward, right, 4.5, 0.1);
  assert.ok(player.mesh.position.z < walked, 'backward steps move backward');
  assert.equal(player.mesh.rotation.y, 0, 'backing up does not turn Lola around');
  player.move(1, 0, forward, right, 8, 0.1);
  assert.ok(player.mesh.position.z > 0, 'forward run steps advance');
  player.move(1, -1, forward, right, 8, 1);
  assert.ok(player.mesh.position.x <= 0.5, 'cannot cross the wall');
  assert.ok(player.mesh.position.z > 0.3, 'slides alongside it');
  const position = player.mesh.position.clone();
  player.switchWeapon();
  assert.equal(player.outfits[0].model.visible, false);
  assert.equal(player.outfits[1].model.visible, true);
  assert.ok(player.mesh.position.equals(position));
  player.move(0, 0, forward, right, 4.5, 0.1);
  assert.equal(player.outfits[1].current, 'Idle');
  for (let frame = 0; frame < 120; frame += 1) {
    player.move(1, 0, forward, right, 4.5, 1 / 60);
    for (const outfit of player.outfits) assert.ok(Number.isFinite(outfit.model.position.y));
  }
  player.crouching = true;
  player.move(0, 0, forward, right, 8, 0.1);
  assert.equal(player.outfits[0].current, 'CrouchIdle');
  const crouchStart = player.mesh.position.z;
  player.move(1, 0, forward, right, 8, 0.1);
  assert.equal(player.outfits[0].current, 'CrouchWalk');
  assert.ok(player.mesh.position.z - crouchStart < 0.2, 'crouch uses its shorter measured steps');
  for (const outfit of player.outfits) {
    const sum = Object.values(outfit.actions).reduce((total, action) => total + action.getEffectiveWeight(), 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, 'transition weights remain normalized');
  }
});

test('jump takes off once, remains blocked by walls in air, and lands at every frame rate', async () => {
  for (const fps of [30, 60, 120]) {
    const player = new LolaPlayer(new THREE.Scene(),
      { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: (x, z) => z > 0.25 },
      { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
    player.crouching = true;
    assert.equal(player.jump(), true);
    assert.equal(player.crouching, false);
    assert.equal(player.jump(), false, 'no double jump');
    let peak = 0;
    for (let i = 0; i < fps; i += 1) {
      player.move(1, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 8, 1 / fps);
      peak = Math.max(peak, player.mesh.position.y);
      assert.ok(player.mesh.position.z <= 0.25, 'jump cannot bypass wall collision');
      assert.ok(player.mesh.position.y >= 0, 'never falls through floor');
    }
    assert.ok(Math.abs(peak - 0.85) < 0.01);
    assert.equal(player.grounded, true);
    assert.equal(player.mesh.position.y, 0);
    assert.equal(player.verticalVelocity, 0);
    assert.equal(player.jump(), true, 'can jump again after landing');
    player.resetJump();
    assert.equal(player.grounded, true);
  }
});

test('both guns play authored standing/crouched shots and restore locomotion', async () => {
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  for (let weapon = 0; weapon < 2; weapon++) {
    for (const crouch of [false, true]) {
      player.crouching = crouch;
      assert.equal(player.startShot(), true);
      const outfit = player.outfits[weapon];
      assert.equal(player.shot.action.getClip().name, crouch ? 'CrouchShoot' : 'Shoot');
      assert.ok(Math.abs(player.shot.action.getClip().duration - 1) < 0.001);
      assert.ok(outfit.shotGun.visible && !outfit.carriedGun.visible);
      const start = player.muzzlePosition();
      assert.ok(start.toArray().every(Number.isFinite));
      player.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, 0.15);
      assert.ok(start.distanceTo(player.muzzlePosition()) > 0.0001, 'authored gun recoil animates');
      player.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, 1);
      assert.equal(player.shot, null);
      assert.ok(!outfit.shotGun.visible && outfit.carriedGun.visible);
    }
    player.startShot(); player.switchWeapon();
    assert.equal(player.shot, null, 'switch cancels old firing pose');
  }
  player.grounded = false;
  assert.equal(player.startShot(), false, 'no invented airborne shooting animation');
});
