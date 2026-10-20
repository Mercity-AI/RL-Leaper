import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HealthPills } from '../src/game/HealthPills.js';
import { HEALTH_PILLS } from '../src/config/pickups.js';
import { PlayerVitals, passivePresenter } from '../src/game/PlayerVitals.js';
import { EventBus, GAME_EVENTS } from '../src/core/events.js';

// A flat, open 40 x 40 yard on a 1-unit grid (one connected region), at scale 1.
function openYard(size = 40) {
  const columns = size, rows = size;
  const free = new Uint8Array(columns * rows).fill(1);
  const navigation = {
    free,
    point: (i) => ({ x: -size / 2 + (i % columns) + 0.5, z: -size / 2 + Math.floor(i / columns) + 0.5 }),
  };
  return { navigation, scale: 1, floorHeight: 0, playerBlocked: () => false };
}

// A stand-in pill model: one textured box.
function pillModel() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.4), new THREE.MeshStandardMaterial()));
  return scene;
}

function setup({ random = Math.random } = {}) {
  const scene = new THREE.Scene();
  const events = new EventBus();
  const player = { isPlayer: true, height: 1.8, mesh: { position: new THREE.Vector3(0, 0, 0) },
    reactToHit() {}, clearHitReaction() {} };
  const vitals = new PlayerVitals({ player, events, hud: passivePresenter(), config: { lolaHealth: 100, lowHealthThreshold: 25, boltDamage: 10 } });
  const pills = new HealthPills({ scene, world: openYard(), player, vitals, model: pillModel(), random });
  return { scene, events, player, vitals, pills };
}

// Walk Lola onto a pill and let a frame pass.
function walkInto(pills, player, pill) {
  player.mesh.position.set(pill.x, 0, pill.z);
  pills.update(1 / 60);
}

test('a new game scatters three pills, apart from each other and from Lola', () => {
  const { pills, player, scene } = setup();
  pills.reset();
  assert.equal(pills.available, HEALTH_PILLS.startCount);
  assert.equal(scene.children.filter((c) => c.name === 'healthPill').length, 3);
  for (const pill of pills.pills) {
    assert.ok(Math.hypot(pill.x - player.mesh.position.x, pill.z) >= player.height * HEALTH_PILLS.awayFromLola);
  }
  const [a, b, c] = pills.pills;
  for (const [p, q] of [[a, b], [a, c], [b, c]]) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= player.height * HEALTH_PILLS.spacing);
});

test('the pickup is a third of Lola\'s height', () => {
  const { pills, player } = setup();
  pills.reset();
  const box = new THREE.Box3().setFromObject(pills.pills[0].holder);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.y - player.height / 3) < 0.01, `pickup is ${size.y.toFixed(3)} tall`);
});

test('walking through a pill gives back 10% of total health and the pill vanishes', () => {
  const { pills, player, vitals, events } = setup();
  const healed = [];
  events.on(GAME_EVENTS.lolaHealed, (payload) => healed.push(payload));
  pills.reset();
  vitals.damage(50);
  walkInto(pills, player, pills.pills[0]);
  assert.equal(vitals.health, 60);
  assert.deepEqual(healed, [{ amount: 10, health: 60 }]);
  assert.equal(pills.available, 2);
  for (let i = 0; i < 30; i += 1) pills.update(1 / 60);
  assert.equal(pills.pills.length, 2, 'the taken pill is gone after its short vanish');
});

test('a pill is taken the moment Lola touches its sphere, and the pill is gone that same frame', () => {
  const { pills, player, vitals } = setup();
  pills.reset();
  vitals.damage(50);
  const pill = pills.pills[0];
  // Lola's body edge (about 0.15 of her height) just touching the sphere's edge (1/6).
  const touching = player.height * (1 / 6 + 0.15);
  player.mesh.position.set(pill.x + touching, 0, pill.z);
  pills.update(1 / 60);
  assert.equal(vitals.health, 60);
  assert.equal(pill.spinner.visible, false, 'the pill itself disappears at once');
  // Clearly apart: nothing happens.
  const other = pills.pills[1];
  player.mesh.position.set(other.x + player.height * 0.6, 0, other.z);
  pills.update(1 / 60);
  assert.equal(vitals.health, 60);
});

test('healing never goes above full health, and a full-health Lola leaves the pill', () => {
  const { pills, player, vitals } = setup();
  pills.reset();
  walkInto(pills, player, pills.pills[0]);
  assert.equal(vitals.health, 100);
  assert.equal(pills.available, 3, 'nothing to heal: the pill stays');
  vitals.damage(5);
  walkInto(pills, player, pills.pills[0]);
  assert.equal(vitals.health, 100);
  assert.equal(pills.available, 2);
});

test('once two are taken, new ones appear one at a time back up to three (never more than four)', () => {
  const { pills, player, vitals } = setup();
  pills.reset();
  vitals.damage(90);
  walkInto(pills, player, pills.pills[0]);
  walkInto(pills, player, pills.pills.find((p) => p.taken === null));
  const seen = [];
  for (let t = 0; t < 30; t += 0.1) {
    pills.update(0.1);
    seen.push(pills.pills.length);
  }
  assert.equal(pills.available, 3);
  assert.ok(Math.max(...seen) <= HEALTH_PILLS.maxCount);
});

test('paused (no gameplay time): pills neither move nor get taken', () => {
  const { pills, player, vitals } = setup();
  pills.reset();
  vitals.damage(50);
  const pill = pills.pills[0];
  const y = pill.holder.position.y;
  player.mesh.position.set(pill.x, 0, pill.z);
  pills.update(0);
  assert.equal(vitals.health, 50);
  assert.equal(pill.holder.position.y, y);
});

test('a restart clears the old pills out of the scene', () => {
  const { pills, scene } = setup();
  pills.reset();
  pills.reset();
  assert.equal(scene.children.filter((c) => c.name === 'healthPill').length, 3);
  pills.dispose();
  assert.equal(scene.children.length, 0);
});
