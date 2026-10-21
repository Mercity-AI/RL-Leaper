import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AmmoBullets } from '../src/game/AmmoBullets.js';
import { HealthPills } from '../src/game/HealthPills.js';
import { AMMO_BULLETS } from '../src/config/pickups.js';
import { WEAPONS } from '../src/config/weapons.js';
import { WeaponState } from '../src/weapons/WeaponState.js';
import { PlayerVitals, passivePresenter } from '../src/game/PlayerVitals.js';

// A flat, open 60 x 60 yard on a 1-unit grid, at scale 1.
function openYard(size = 60) {
  const free = new Uint8Array(size * size).fill(1);
  return {
    navigation: { free, point: (i) => ({ x: -size / 2 + (i % size) + 0.5, z: -size / 2 + Math.floor(i / size) + 0.5 }) },
    scale: 1, floorHeight: 0, playerBlocked: () => false,
  };
}

// A stand-in bullet: a tall box standing along y, off-centre like an export may be.
function bulletModel() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.79, 0.22), new THREE.MeshStandardMaterial());
  mesh.position.y = 0.395;
  scene.add(mesh);
  return scene;
}

// The PlayerWeapon's ammo side, over the real gun rules.
function fakeWeapon() {
  const rifle = new WeaponState(WEAPONS.m416);
  return {
    rifle,
    spareRoom: (id) => (id === 'm416' ? rifle.spareRoom : 0),
    addAmmo: (id, rounds) => (id === 'm416' ? rifle.addReserve(rounds) : 0),
  };
}

function setup() {
  const scene = new THREE.Scene();
  const player = { isPlayer: true, height: 1.8, mesh: { position: new THREE.Vector3(0, 0, 0) }, reactToHit() {}, clearHitReaction() {} };
  const weapon = fakeWeapon();
  let down = false;
  const bullets = new AmmoBullets({ scene, world: openYard(), player, weapon, defeated: () => down, model: bulletModel() });
  return { scene, player, weapon, bullets, knockDown: () => { down = true; } };
}

function walkInto(pickups, player, item) {
  player.mesh.position.set(item.x, 0, item.z);
  pickups.update(1 / 60);
}

test('a new game scatters three yellow bullets, the same size as the pills', () => {
  const { bullets, scene, player } = setup();
  bullets.reset();
  assert.equal(bullets.available, AMMO_BULLETS.startCount);
  assert.equal(scene.children.filter((c) => c.name === 'ammoBullet').length, 3);
  const size = new THREE.Box3().setFromObject(bullets.bullets[0].holder).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.y - player.height * AMMO_BULLETS.size) < 0.01, `pickup is ${size.y.toFixed(3)} tall`);
});

test('the bullet sits centred in its sphere', () => {
  const { bullets, scene } = setup();
  bullets.reset();
  scene.updateMatrixWorld(true);
  const item = bullets.bullets[0];
  const tilt = item.spinner.children[0];
  const box = new THREE.Box3().setFromObject(tilt);
  const centre = box.getCenter(new THREE.Vector3());
  assert.ok(centre.distanceTo(item.holder.position) < 0.02, 'centred on the sphere');
});

test('taking a bullet gives the M416 two magazines of spares; full spares leave it be', () => {
  const { bullets, player, weapon } = setup();
  bullets.reset();
  assert.equal(weapon.rifle.reserve, 80);
  walkInto(bullets, player, bullets.bullets[0]);
  assert.equal(weapon.rifle.reserve, 120);
  assert.equal(bullets.available, 2);
  walkInto(bullets, player, bullets.bullets.find((b) => b.taken === null));
  assert.equal(weapon.rifle.reserve, 160, 'the most it can carry');
  // Full: the next bullet stays.
  const last = bullets.bullets.find((b) => b.taken === null);
  walkInto(bullets, player, last);
  assert.equal(last.taken, null);
  assert.equal(weapon.rifle.reserve, 160);
});

test('Lola down: she takes nothing', () => {
  const { bullets, player, weapon, knockDown } = setup();
  bullets.reset();
  knockDown();
  walkInto(bullets, player, bullets.bullets[0]);
  assert.equal(weapon.rifle.reserve, 80);
  assert.equal(bullets.available, 3);
});

test('pills and bullets keep clear of each other', () => {
  const scene = new THREE.Scene();
  const world = openYard();
  const player = { isPlayer: true, height: 1.8, mesh: { position: new THREE.Vector3(0, 0, 0) }, reactToHit() {}, clearHitReaction() {} };
  const vitals = new PlayerVitals({ player, hud: passivePresenter(), config: { lolaHealth: 100, lowHealthThreshold: 25, boltDamage: 10 } });
  let pills = null;
  const bullets = new AmmoBullets({ scene, world, player, weapon: fakeWeapon(), model: bulletModel(), others: () => pills.items });
  const pillModel = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.4), new THREE.MeshStandardMaterial()));
  pills = new HealthPills({ scene, world, player, vitals, model: pillModel, others: () => bullets.items });
  pills.reset();
  bullets.reset();
  const spacing = player.height * AMMO_BULLETS.spacing;
  for (const b of bullets.items) for (const p of pills.items) {
    assert.ok(Math.hypot(b.x - p.x, b.z - p.z) >= spacing, 'a bullet too close to a pill');
  }
});

test('taking a pickup plays its own sound (and a refused one stays quiet)', () => {
  const scene = new THREE.Scene();
  const player = { isPlayer: true, height: 1.8, mesh: { position: new THREE.Vector3(0, 0, 0) }, reactToHit() {}, clearHitReaction() {} };
  const played = [];
  const audio = { play: (id) => played.push(id) };
  const weapon = fakeWeapon();
  const bullets = new AmmoBullets({ scene, world: openYard(), player, weapon, model: bulletModel(), audio });
  const vitals = new PlayerVitals({ player, hud: passivePresenter(), config: { lolaHealth: 100, lowHealthThreshold: 25, boltDamage: 10 } });
  const pillModel = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.4), new THREE.MeshStandardMaterial()));
  const pills = new HealthPills({ scene, world: openYard(), player, vitals, model: pillModel, audio });
  bullets.reset();
  pills.reset();
  walkInto(pills, player, pills.pills[0]);
  assert.deepEqual(played, [], 'full health: the pill stays and makes no sound');
  vitals.damage(30);
  walkInto(pills, player, pills.pills[0]);
  walkInto(bullets, player, bullets.bullets[0]);
  assert.deepEqual(played, ['healthPickup', 'ammoPickup']);
});
