import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LolaPlayer } from '../src/robot/LolaPlayer.js';
import { advanceAction, overlayWeight } from '../src/actors/lola/LolaAnimator.js';
import { LolaActionState, LOLA_ACTION_RULES } from '../src/actors/lola/LolaActionState.js';
import { cloneCharacter } from '../src/actors/lola/LolaAssets.js';

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
const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(-1, 0, 0);
const button = () => ({ addEventListener() {}, classList: { add() {} } });
const openWorld = () => ({ scale: 1, initialTarget: { x: 0, z: 0 }, playerBlocked: () => false });

test('hand-advanced clip clocks match AnimationMixer.update for looping and one-shot clips', async () => {
  const gltf = await load('m416');
  const clip = gltf.animations.find(item => item.name === 'Run');
  const shot = gltf.animations.find(item => item.name === 'Shoot');
  // Two identical setups: one driven by the mixer, one by advanceAction.
  const setups = [0, 1].map(() => {
    const model = cloneCharacter(gltf.scene);
    const mixer = new THREE.AnimationMixer(model);
    const loop = mixer.clipAction(clip).play();
    const once = mixer.clipAction(shot).setLoop(THREE.LoopOnce, 1);
    once.clampWhenFinished = true;
    once.play();
    return { mixer, loop, once };
  });
  const rates = [2.3, -1.7, 0.4, 3.9, -0.2];
  for (let i = 0; i < 400; i += 1) {
    const dt = 1 / 120 + (i % 7) / 997;
    for (const setup of setups) setup.loop.timeScale = rates[i % rates.length];
    setups[0].mixer.update(dt);
    advanceAction(setups[1].loop, dt);
    advanceAction(setups[1].once, dt);
    assert.ok(Math.abs(setups[0].loop.time - setups[1].loop.time) < 1e-9, `loop clock at step ${i}`);
    assert.ok(Math.abs(setups[0].once.time - setups[1].once.time) < 1e-9, `one-shot clock at step ${i}`);
    assert.equal(setups[0].once.paused, setups[1].once.paused, 'one-shot clip holds its last frame');
  }
  // A full overlay is 1000x the base; a partial one shows at its share.
  assert.equal(overlayWeight(1, 2), 2000);
  assert.ok(Math.abs(overlayWeight(0.25, 1) / (overlayWeight(0.25, 1) + 1) - 0.25) < 1e-12);
  assert.equal(overlayWeight(0, 1), 0);
});

test('the action rules table answers the designer questions it documents', () => {
  const player = { grounded: true, inputForward: 0, inputSide: 0, hitRecoilTime: 0 };
  const rules = new LolaActionState(player);
  assert.equal(rules.can('shoot'), true);
  player.reloadState = {};
  assert.equal(rules.can('shoot'), false, 'no shooting mid-reload');
  assert.ok(LOLA_ACTION_RULES.reload.ends.includes('shoot'), 'reloading lowers a raised gun');
  player.reloadState = null;
  player.jumpState = {};
  assert.deepEqual(['shoot', 'reload', 'jump'].map(action => rules.can(action)), [false, false, false], 'a jump blocks shot, reload and a second jump');
  assert.equal(rules.can('crouch'), false, 'no crouch toggle mid-jump');
  player.jumpState = null;
  assert.ok(LOLA_ACTION_RULES.jump.ends.includes('crouch'), 'jumping stands her up');
  // Getting hit and shooting stack instead of cancelling each other.
  assert.deepEqual(LOLA_ACTION_RULES.hit.ends, [], 'a hit does not lower a raised gun');
  assert.ok(!LOLA_ACTION_RULES.shoot.ends.includes('hit'), 'firing does not cancel the flinch');
  player.hitRecoilTime = 0.3;
  assert.equal(rules.can('aim'), true, 'aiming is allowed mid-flinch');
  player.hitRecoilTime = 0;
  player.defeated = true;
  assert.deepEqual(['shoot', 'reload', 'jump', 'hit'].map(action => rules.can(action)), [false, false, false, false]);
  player.defeated = false;
  player.inputForward = 0.5;
  assert.deepEqual(rules.states, ['move']);
  // Starting an action ends what it replaces, in the table's order.
  const ended = [];
  player.shot = {};
  assert.equal(rules.begin('reload', { shoot: () => ended.push('shoot'), reload: () => ended.push('reload') }), true);
  assert.deepEqual(ended, ['shoot', 'reload']);
  assert.throws(() => rules.can('dance'), /Unknown Lola action/);
});

test('building Lola copies the loaded files, so two Lolas can share one load', async () => {
  const models = await Promise.all([load('m416'), load('basic')]);
  const jumps = await Promise.all([load('jump-m416'), load('jump-basic')]);
  const reloads = await Promise.all([load('reload-m416'), load('reload-basic')]);
  const children = models.map(gltf => gltf.scene.children.length);
  const players = [0, 1].map(() => new LolaPlayer(new THREE.Scene(), openWorld(), button(), models, jumps, reloads));
  assert.deepEqual(models.map(gltf => gltf.scene.children.length), children, 'loaded scenes keep their contents');
  assert.notEqual(players[0].outfits[0].model, players[1].outfits[0].model);
  for (const player of players) {
    for (let i = 0; i < 30; i += 1) player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
    assert.ok(player.mesh.position.z > 0.5, 'each copy runs');
    assert.equal(player.jump(), true, 'each copy has its own jump clip and gun');
    assert.equal(player.outfits[0].jump.gun.visible, true);
  }
  assert.equal(players[1].startReload(), false, 'no reload mid-jump');
});

test('only the equipped outfit is posed, once per rendered frame', async () => {
  const player = new LolaPlayer(new THREE.Scene(), openWorld(), button(), await Promise.all([load('m416'), load('basic')]));
  const counts = player.outfits.map(outfit => {
    const count = { updates: 0 };
    const update = outfit.mixer.update.bind(outfit.mixer);
    outfit.mixer.update = dt => { count.updates += 1; return update(dt); };
    return count;
  });
  // A slow 10 fps frame runs 12 movement sub-steps but only one pose.
  player.move(1, 0, FORWARD, RIGHT, 4.5, 0.1);
  assert.deepEqual(counts.map(count => count.updates), [1, 0]);
  // The hidden outfit's clips still keep time, so switching guns is seamless.
  const hiddenRun = player.outfits[1].actions.Run;
  assert.ok(Math.abs(hiddenRun.time - player.outfits[0].actions.Run.time) < 1e-9);
  player.switchWeapon();
  assert.deepEqual(counts.map(count => count.updates), [1, 1], 'the newly shown outfit is posed at once');
  player.move(1, 0, FORWARD, RIGHT, 4.5, 1 / 60);
  assert.deepEqual(counts.map(count => count.updates), [1, 2]);
});
