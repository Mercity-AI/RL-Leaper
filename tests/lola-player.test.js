import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer, LOLA_PACE } from '../src/robot/LolaPlayer.js';
import { InputController } from '../src/input/InputController.js';
import { PlayerController } from '../src/game/PlayerController.js';
import profiles from '../assets/characters/lola/stride-profiles.json' with { type: 'json' };
import { ENCOUNTER } from '../src/config/encounter.js';
import { footLift } from '../src/robot/footstepContacts.js';
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

// The contact circle is Lola's body, not her full reach: a circle around her
// outstretched gun and striding feet stopped her metres short of the Leaper.
// Hands, gun tips and feet may brush its legs; most of her stays inside.
test('player collision radius holds Lola\'s body throughout her animations', async () => {
  for (const weapon of ['basic', 'm416']) {
    const gltf = await load(weapon);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    let maximum = 0, inside = 0, total = 0;
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
            const radius = Math.hypot(point.x, point.z);
            maximum = Math.max(maximum, radius);
            total += 1;
            if (radius <= contact.playerRadius) inside += 1;
          }
        });
      }
    }
    assert.ok(inside / total >= 0.75, `${weapon}: only ${(100 * inside / total).toFixed(1)}% of Lola inside the contact radius`);
    assert.ok(maximum <= 2.5 * contact.playerRadius, `${weapon} reach ${maximum} far outside the contact radius`);
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
      player.inputForward = f; player.inputSide = s; // skip the input ramp
      const frames = 120;
      for (let i = 0; i < frames; i += 1) {
        const o = player.outfits[player.weaponIndex];
        const before = o.actions[clip].time;
        player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), speed,
          profile.duration / frames / (crouching ? LOLA_PACE.crouch : speed > 5 ? LOLA_PACE.sprint : LOLA_PACE.run));
        const expected = profile.groundOffset * ENCOUNTER.lolaHeight - footLift(o.footContacts[clip], before);
        assert.ok(Math.abs(o.model.position.y - expected) < 1e-6, `floor ${o.model.position.y} vs ${expected}`);
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
  // The C / 1 / 2 keys are input actions now (src/input/actions.js), applied by
  // PlayerController each frame, so drive them through the real InputController.
  let keydown;
  const originalListener = window.addEventListener;
  window.addEventListener = (name, callback) => { if (name === 'keydown') keydown = callback; };
  const input = new InputController();
  window.addEventListener = originalListener;
  const models = await Promise.all([load('m416'), load('basic')]);
  const button = { addEventListener() {}, classList: { add() {} } };
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false }, button, models);
  const controller = new PlayerController({ player, input, cameraController: { getMovementHeading: () => 0 } });
  // One key event, then one frame (input phase, then gameplay phase) applies it.
  const press = (code, repeat = false) => {
    keydown({ code, repeat, target: { tagName: 'CANVAS' }, preventDefault() {} });
    controller.sample(1 / 60);
    controller.update(1 / 60);
  };
  const move = (f, s) => { for (let i = 0; i < 30; i++) player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, 1 / 60); };
  for (let weapon = 0; weapon < 2; weapon += 1) {
    move(0, -1);
    assert.equal(player.outfits[weapon].current, 'StrafeLeft');
    move(0, 1);
    assert.equal(player.outfits[weapon].current, 'StrafeRight');
    move(-1, 1);
    { const o = player.outfits[weapon], pr = o.profiles.StrafeRight;
      const match = THREE.MathUtils.clamp(pr.distance / pr.duration / o.footContacts.StrafeRight.stanceSpeed, 0.5, 1.5);
      assert.ok(Math.abs(o.actions.StrafeRight.timeScale - LOLA_PACE.run * match) < 1e-6, `strafe rate ${o.actions.StrafeRight.timeScale} vs ${LOLA_PACE.run * match}`); }
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
    press(weapon === 0 ? 'Digit1' : 'Digit2');
    assert.equal(player.weaponIndex, 1 - weapon, '1 / 2 select the pistol / M416');
    press(weapon === 0 ? 'Digit1' : 'Digit2');
    assert.equal(player.weaponIndex, 1 - weapon, 'pressing the equipped gun key keeps it');
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
  // One body for both guns: switching puts the pistol in her hands and slings the rifle.
  assert.equal(player.outfits[0].carriedGun.visible, false);
  assert.equal(player.outfits[1].carriedGun.visible, true);
  assert.equal(player.outfits[0].stowed.visible, true, 'the rifle is slung on her back');
  assert.ok(player.mesh.position.equals(position));
  for (let i = 0; i < 3; i++) player.move(0, 0, forward, right, 4.5, 0.1);
  assert.equal(player.outfits[1].current, 'Idle');
  for (let frame = 0; frame < 120; frame += 1) {
    player.move(1, 0, forward, right, 4.5, 1 / 60);
    for (const outfit of player.outfits) assert.ok(Number.isFinite(outfit.model.position.y));
  }
  player.crouching = true;
  for (let i = 0; i < 3; i++) player.move(0, 0, forward, right, 8, 0.1);
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

test('hit recoil bends the torso then recovers without displacing Lola', async () => {
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  assert.equal(player.height, 1.9 * 0.9);
  for (const outfit of player.outfits) assert.equal(outfit.model.scale.y, 0.9);
  const move = dt => player.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, dt);
  // The flinch bends the spine over several joints (so the shirt does not
  // stretch at the waist): measure the head's total tilt with it undone.
  const tilt = outfit => {
    player.mesh.updateMatrixWorld(true);
    const bent = outfit.headBone.getWorldQuaternion(new THREE.Quaternion());
    const flinched = outfit.flinchBones.map(({ bone }) => bone.quaternion.clone());
    outfit.flinchBones.forEach(({ bone, base }) => bone.quaternion.copy(base));
    player.mesh.updateMatrixWorld(true);
    const neutral = outfit.headBone.getWorldQuaternion(new THREE.Quaternion());
    outfit.flinchBones.forEach(({ bone }, i) => bone.quaternion.copy(flinched[i]));
    return bent.angleTo(neutral);
  };
  move(0.1);
  const start = player.mesh.position.clone();
  // Only the outfit on screen is animated, so check each one while it is equipped.
  for (const weapon of [0, 1]) {
    if (player.weaponIndex !== weapon) player.switchWeapon();
    player.reactToHit(); move(0.08);
    const outfit = player.outfits[weapon];
    assert.ok(outfit.hitBone && outfit.hitBase);
    assert.ok(outfit.hitBone.quaternion.angleTo(outfit.hitBase) > 0, 'the lowest spine joint bends');
    assert.ok(tilt(outfit) > 0.25, `the torso bends (${tilt(outfit).toFixed(3)} rad)`);
    assert.ok(player.mesh.position.equals(start));
    move(0.7);
    assert.equal(player.hitRecoilTime, 0);
    assert.ok(player.outfits.every(item => !item.hitBase));
  }
  player.reactToHit(); move(0.05); player.clearHitReaction();
  assert.equal(player.hitRecoilTime, 0);
  assert.ok(player.outfits.every(outfit => !outfit.hitBase));
});

test('hit recoil follows incoming world direction from every side despite Lola turning', async () => {
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  // Only the outfit on screen is animated, so check each one while it is equipped.
  for (const weapon of [0, 1]) for (const crouching of [false, true]) {
    if (player.weaponIndex !== weapon) player.switchWeapon();
    player.crouching = crouching;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
        player.clearHitReaction();
        player.reactToHit(direction);
        // Change facing AFTER impact; recoil must retain the incoming direction.
        player.move(0, 0, forward, right, 4.5, 0.1);
        for (const outfit of [player.outfits[weapon]]) {
          const head = outfit.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('DEF-spine.006'));
          player.mesh.updateMatrixWorld(true);
          const hit = head.getWorldPosition(new THREE.Vector3());
          // Undo the whole flinch (every bent spine joint) for the neutral pose.
          const rotations = outfit.flinchBones.map(({ bone }) => bone.quaternion.clone());
          outfit.flinchBones.forEach(({ bone, base }) => bone.quaternion.copy(base));
          player.mesh.updateMatrixWorld(true);
          const neutral = head.getWorldPosition(new THREE.Vector3());
          outfit.flinchBones.forEach(({ bone }, i) => bone.quaternion.copy(rotations[i]));
          const displacement = hit.sub(neutral); displacement.y = 0;
          assert.ok(displacement.dot(direction) > 0.03, 'torso bends away from the incoming side');
        }
        assert.deepEqual(player.mesh.position.toArray(), [0, 0, 0]);
        assert.ok(player.hitDirection.equals(direction), 'keeps a copy of the incoming direction');
      }
    }
  }
});

test('three spaced shots keep the raised gun, held aim persists, release restores locomotion', async () => {
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, await Promise.all([load('m416'), load('basic')]));
  const move = dt => player.move(0, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 4.5, dt);
  for (const crouching of [false, true]) for (const weaponIndex of [0, 1]) {
    player.crouching = crouching; player.weaponIndex = weaponIndex;
    for (let i = 0; i < 3; i++) {
      player.startShot(0.24, 1.2); move(0.7);
      assert.ok(player.shot && player.shot.outfit.shotGun.visible);
      assert.ok(!player.shot.outfit.carriedGun.visible);
    }
    move(1.5); assert.equal(player.shot, null);
    player.aimHeld = true; player.holdAim(); move(3);
    assert.ok(player.shot && player.shot.action.paused);
    player.aimHeld = false; move(0.1); assert.equal(player.shot, null);
  }
});

test('authored jump plays the exported clip, lifts the feet, keeps run momentum and hands the gun back', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const jumps = await Promise.all([load('jump-m416'), load('jump-basic')]);
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, models, jumps);
  const outfit = player.outfits[0];
  const foot = outfit.model.getObjectByName('DEF-footL') || outfit.model.getObjectByName('DEF-foot.L');
  const footY = () => { player.mesh.updateMatrixWorld(true); return foot.getWorldPosition(new THREE.Vector3()).y; };
  const move = (f, dt) => player.move(f, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, dt);
  move(0, 0.1);
  const standing = footY();
  assert.equal(player.jump(), true);
  assert.equal(player.jump(), false, 'no double jump');
  assert.equal(outfit.jump.gun.visible, true);
  assert.equal(outfit.carriedGun.visible, false);
  assert.equal(player.startShot(), false, 'no shooting mid-jump');
  let peak = -Infinity;
  for (let t = 0; t < 0.9; t += 1 / 60) { move(0, 1 / 60); peak = Math.max(peak, footY()); }
  assert.ok(peak > standing + 0.3, `feet lift during the authored jump (${peak} vs ${standing})`);
  assert.equal(player.mesh.position.y, 0, 'height comes from the animation, not physics');
  for (let t = 0; t < 0.55; t += 1 / 60) move(0, 1 / 60);
  // The 2.1 s clip plays 50% faster: 1.4 s.
  assert.equal(player.jumpState, null, 'standing jump finishes 50% faster than authored');
  assert.equal(outfit.jump.gun.visible, false);
  assert.equal(outfit.carriedGun.visible, true);
  // Running: the jump keeps forward travel and blends out soon after touchdown.
  player.jump();
  let time = 0;
  while (player.jumpState && time < 2) { move(1, 1 / 60); time += 1 / 60; }
  assert.ok(player.mesh.position.z > 0.5, 'run momentum continues through the jump');
  assert.ok(time < 1.6, `running landing blends straight back to the run (${time.toFixed(2)} s)`);
});

test('running jumps match the forward foot, keep running speed and land back into the same stride', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const jumps = await Promise.all([load('jump-m416'), load('jump-basic')]);
  const runJumps = {};
  for (const [name, file] of [['RunJumpRL', 'runjumprl'], ['RunJumpLR', 'runjumplr'], ['BackJumpLR', 'backjumplr'], ['BackJumpRL', 'backjumprl']]) {
    runJumps[name] = await Promise.all([load(`${file}-m416`), load(`${file}-basic`)]);
  }
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, models, jumps, [], runJumps);
  const outfit = player.outfits[0];
  const run = outfit.actions.Run;
  const bone = name => outfit.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
  const footL = bone('DEF-foot.L');
  const y = object => { player.mesh.updateMatrixWorld(true); return object.getWorldPosition(new THREE.Vector3()).y; };
  const move = (f, s, dt) => player.move(f, s, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, dt);
  move(0, 0, 0.1);
  const standing = y(footL);
  for (const [forward, frame, kind] of [[1, 15, 'RunJumpRL'], [1, 3, 'RunJumpLR'], [-1, 6, 'BackJumpLR'], [-1, 18, 'BackJumpRL']]) {
    for (let i = 0; i < 40; i += 1) move(forward, 0, 1 / 60);
    // Press jump exactly on the run frame each clip was authored to start from.
    for (const o of player.outfits) o.actions.Run.time = (frame - 1) / 24 * run.getClip().duration;
    const z = player.mesh.position.z;
    assert.equal(player.jump(), true);
    assert.equal(player.jumpState.kind, kind, `run frame ${frame} picks ${kind}`);
    assert.equal(player.jumpState.start, 0);
    assert.equal(outfit.jumpClips[kind].gun.visible, true);
    const toes = ['DEF-toe.L', 'DEF-toe.R'].map(bone);
    const toePositions = () => { player.mesh.updateMatrixWorld(true); return toes.map(toe => toe.getWorldPosition(new THREE.Vector3())); };
    let time = 0, peak = -Infinity, slowest = Infinity, last = z, previous = toePositions(), landed = null, skatingFrames = 0;
    while ((player.jumpState || time < (landed ?? 9) + 0.4) && time < 2) {
      move(forward, 0, 1 / 60); time += 1 / 60;
      peak = Math.max(peak, y(footL));
      slowest = Math.min(slowest, Math.abs(player.mesh.position.z - last) * 60);
      last = player.mesh.position.z;
      if (landed === null && !player.jumpState) landed = time;
      // After touchdown, a boot on the floor stays put (no skating on one leg).
      const now = toePositions();
      if (player.jumpState?.handedBack || landed !== null) {
        now.forEach((toe, i) => {
          // Faster than half her run speed (2.27) counts as skating.
          if (toe.y < 0.025 && previous[i].y < 0.025 && Math.hypot(toe.x - previous[i].x, toe.z - previous[i].z) * 60 > 1.1) skatingFrames++;
        });
      }
      previous = now;
    }
    assert.ok(peak > standing + 0.3, `${kind}: feet lift (${peak.toFixed(2)} vs ${standing.toFixed(2)})`);
    assert.ok(slowest > 0.5, `${kind}: keeps running speed through the jump (${slowest.toFixed(2)})`);
    assert.ok(landed > 0.6 && landed < 0.8, `${kind}: lands straight into the run (${landed.toFixed(2)} s)`);
    // Before the fix the landing boot skated at full run speed for ~8 frames.
    assert.ok(skatingFrames <= 1, `${kind}: planted boot does not skate after landing (${skatingFrames} frames)`);
    assert.equal(Math.sign(player.mesh.position.z - z), forward);
    assert.equal(outfit.carriedGun.visible, true);
  }
  // Strafing or standing still uses the plain (faster) jump.
  for (let i = 0; i < 30; i += 1) move(0, 1, 1 / 60);
  player.jump();
  assert.equal(player.jumpState.kind, 'jump');
  assert.equal(player.jumpState.rate, 1.5);
});

test('authored reload moves the arms over the run, keeps the gun in the right hand, and ends on time', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const reloads = await Promise.all([load('reload-m416'), load('reload-basic')]);
  const player = new LolaPlayer(new THREE.Scene(),
    { scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false },
    { addEventListener() {}, classList: { add() {} } }, models, [], reloads);
  for (const weapon of [0, 1]) {
    if (player.weaponIndex !== weapon) player.switchWeapon();
    const outfit = player.outfits[weapon];
    const bone = name => outfit.model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    const hand = bone('DEF-hand.L'), handR = bone('DEF-hand.R'), shin = bone('DEF-shin.L');
    const move = (f, dt) => player.move(f, 0, new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), 4.5, dt);
    const local = object => { player.mesh.updateMatrixWorld(true); return player.mesh.worldToLocal(object.getWorldPosition(new THREE.Vector3())); };
    for (let i = 0; i < 30; i += 1) move(1, 1 / 60);
    const runningHand = local(hand);
    assert.ok(Math.abs(player.reloadDuration - 43 / 30) < 1e-3, 'reload lasts the authored 44 frames');
    assert.equal(player.startReload(), true);
    assert.equal(outfit.reload.gun.visible, true);
    assert.equal(outfit.carriedGun.visible, false);
    assert.equal(player.startShot(), false, 'no shooting mid-reload');
    let shinMoved = false, handMoved = 0;
    const shinStart = local(shin);
    for (let t = 0; t < 0.7; t += 1 / 60) {
      move(1, 1 / 60);
      shinMoved ||= local(shin).distanceTo(shinStart) > 0.02;
      handMoved = Math.max(handMoved, local(hand).distanceTo(runningHand));
      const gunGap = local(outfit.reload.gun).distanceTo(local(handR));
      assert.ok(gunGap < 0.6, `gun stays in the right hand (${gunGap.toFixed(3)})`);
    }
    assert.ok(shinMoved, 'legs keep running during the reload');
    assert.ok(handMoved > 0.05, `the reload moves the hands (${handMoved.toFixed(3)})`);
    assert.ok(player.reloading);
    for (let t = 0; t < 0.8; t += 1 / 60) move(1, 1 / 60);
    assert.equal(player.reloading, false, 'reload ends with its clip');
    assert.equal(outfit.reload.gun.visible, false);
    assert.equal(outfit.carriedGun.visible, true);
    player.startReload();
    player.switchWeapon();
    assert.equal(player.reloading, false, 'switching guns abandons the reload');
    player.switchWeapon();
  }
});
