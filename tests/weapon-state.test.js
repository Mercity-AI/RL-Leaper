import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponState } from '../src/weapons/WeaponState.js';
import {
  HIT_ZONES, LEAPER_HITBOXES, WEAPONS, WEAPON_SLOTS, slotForKey, weaponBalance, weaponForSlot,
} from '../src/config/weapons.js';
import { COMBAT } from '../src/config/combat.js';
import { OUTFIT_WEAPONS } from '../src/actors/lola/LolaAssets.js';

// Hold the trigger for `seconds` at a fixed frame time; count the bullets. The
// frame order matches PlayerWeapon.update: the clock runs, then the trigger.
function holdTrigger(weapon, dt, seconds) {
  const state = new WeaponState(weapon);
  let shots = 0;
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    state.advance(dt);
    shots += state.pull({ pressed: i === 0, held: true }, () => true).shots;
  }
  return shots;
}

// ---- Fire rate (review fix 5.34) ----

test('an automatic M416 fires 70 +/- 1 shots in 10 s at 30, 60 and 144 fps', () => {
  const rifle = { ...WEAPONS.m416, magazine: 10000 };
  for (const fps of [30, 60, 144]) {
    const shots = holdTrigger(rifle, 1 / fps, 10);
    assert.ok(Math.abs(shots - 70) <= 1, `${fps} fps: ${shots} shots`);
  }
});

test('one long hitch never empties a magazine in a single frame', () => {
  const state = new WeaponState(WEAPONS.m416);
  state.advance(1 / 60);
  state.pull({ pressed: true, held: true }, () => true);
  state.advance(1);
  const result = state.pull({ pressed: false, held: true }, () => true);
  assert.ok(result.shots <= 2, `${result.shots} shots in one 1 s frame`);
});

test('the pistol fires once per press, however long the trigger is held', () => {
  assert.equal(holdTrigger({ ...WEAPONS.pistol, magazine: 1000 }, 1 / 60, 3), 1);
  const state = new WeaponState(WEAPONS.pistol);
  let shots = 0;
  // Ten presses, one every 0.6 s (slower than its 0.5 s rate): ten shots.
  for (let press = 0; press < 10; press += 1) {
    for (let frame = 0; frame < 36; frame += 1) {
      state.advance(1 / 60);
      shots += state.pull({ pressed: frame === 0, held: frame < 6 }, () => true).shots;
    }
  }
  assert.equal(shots, 10);
  // A press before the gun has cycled does nothing.
  state.advance(0.01);
  assert.equal(state.pull({ pressed: true, held: true }, () => true).shots, 1);
  state.advance(0.1);
  assert.equal(state.pull({ pressed: true, held: true }, () => true).shots, 0);
});

test('a refused shot (Lola mid-jump) spends nothing', () => {
  const state = new WeaponState(WEAPONS.m416);
  state.advance(1 / 60);
  const result = state.pull({ pressed: true, held: true }, () => false);
  assert.equal(result.shots, 0);
  assert.equal(state.mag, WEAPONS.m416.magazine);
  assert.ok(state.cooldown <= 0, 'still ready to fire');
});

// ---- Ammunition and reloads ----

test('an empty gun clicks and asks for a reload; mid-reload it only clicks', () => {
  const state = new WeaponState(WEAPONS.pistol);
  state.mag = 0;
  const empty = state.pull({ pressed: true, held: true }, () => true);
  assert.deepEqual(empty, { shots: 0, dryFire: true, needsReload: true });
  assert.ok(state.startReload(1.4));
  state.advance(WEAPONS.pistol.interval + 0.01);
  const midReload = state.pull({ pressed: true, held: true }, () => true);
  assert.deepEqual(midReload, { shots: 0, dryFire: true, needsReload: false });
});

test('holding an automatic gun stops at an empty magazine and then reloads by itself', () => {
  const state = new WeaponState({ ...WEAPONS.m416, magazine: 3 });
  let shots = 0, needsReload = false, dryFire = false;
  for (let i = 0; i < 60; i += 1) {
    state.advance(1 / 60);
    const result = state.pull({ pressed: i === 0, held: true }, () => true);
    shots += result.shots;
    needsReload ||= result.needsReload;
    dryFire ||= result.dryFire;
  }
  assert.equal(shots, 3);
  assert.ok(needsReload, 'asks for the reload once the last shot has cycled');
  assert.ok(!dryFire, 'held fire never clicks through an empty magazine');
});

test('a reload plays its sound on cue and refills the magazine when it ends', () => {
  const state = new WeaponState(WEAPONS.m416);
  state.mag = 4;
  assert.ok(state.startReload(43 / 30));
  let sound = null, done = null, t = 0;
  while (state.reloading) {
    const events = state.advance(1 / 60);
    t += 1 / 60;
    if (events.reloadSound) sound = t;
    if (events.reloadDone) done = t;
  }
  assert.ok(sound >= WEAPONS.m416.reloadSoundAt && sound < WEAPONS.m416.reloadSoundAt + 0.02, `sound at ${sound}`);
  assert.ok(Math.abs(done - 43 / 30) < 0.02, `refilled at ${done}`);
  assert.equal(state.mag, WEAPONS.m416.magazine);
  assert.equal(state.reserve, WEAPONS.m416.reserve - (WEAPONS.m416.magazine - 4), 'the missing rounds came out of the spares');
  assert.ok(!state.startReload(), 'a full magazine has nothing to reload');
});

test('a cancelled reload refills nothing', () => {
  const state = new WeaponState(WEAPONS.pistol);
  state.mag = 2;
  state.startReload(1);
  state.advance(0.5);
  state.cancelReload();
  state.advance(1);
  assert.equal(state.mag, 2);
});

// ---- Spread ----

test('spread blooms with sustained fire, shrinks back at rest, and tightens while aiming', () => {
  const state = new WeaponState(WEAPONS.m416);
  const base = state.spread();
  assert.ok(Math.abs(base - WEAPONS.m416.spread.base) < 1e-12);
  assert.ok(state.spread({ moving: true }) > base, 'moving spreads wider');
  assert.ok(Math.abs(state.spread({ aiming: true }) - base * WEAPONS.m416.ads.spread) < 1e-12, 'aiming tightens');
  for (let i = 0; i < 60; i += 1) {
    state.advance(1 / 60);
    state.pull({ pressed: i === 0, held: true }, () => true);
  }
  const bloomed = state.spread();
  assert.ok(bloomed > base * 2, `bloomed ${bloomed} vs ${base}`);
  assert.ok(bloomed <= base + WEAPONS.m416.spread.bloomMax + 1e-12, 'capped');
  for (let i = 0; i < 120; i += 1) state.advance(1 / 60);
  assert.ok(Math.abs(state.spread() - base) < 1e-12, 'back to the base cone after a rest');
});

// ---- The spray pattern ----

test('a held M416 spray walks its pattern; a rest or a tap starts over at shot 1', () => {
  const state = new WeaponState({ ...WEAPONS.m416, magazine: 1000 });
  const { pattern } = WEAPONS.m416.spray;
  const offsets = [];
  for (let i = 0; i < 240 && offsets.length < pattern.length; i += 1) {
    state.advance(1 / 60);
    state.pull({ pressed: i === 0, held: true }, () => { offsets.push(state.sprayOffset()); return true; });
  }
  assert.equal(offsets.length, pattern.length);
  offsets.forEach((offset, i) => {
    assert.ok(Math.abs(offset.right - pattern[i][0] * Math.PI / 180) < 1e-9, `shot ${i + 1} right`);
    assert.ok(Math.abs(offset.up - pattern[i][1] * Math.PI / 180) < 1e-9, `shot ${i + 1} up`);
  });
  assert.ok(offsets.at(-1).up > offsets[0].up + 0.05, 'the spray climbs');
  for (let i = 0; i < 90; i += 1) state.advance(1 / 60);
  assert.deepEqual(state.sprayOffset(), { right: 0, up: 0 }, 'wound back after a rest');
  // Taps every 0.4 s always fire the first shot of the pattern.
  for (let tap = 0; tap < 5; tap += 1) {
    let up = null;
    state.pull({ pressed: true, held: false }, () => { up = state.sprayOffset().up; return true; });
    assert.equal(up, 0, `tap ${tap + 1}`);
    for (let i = 0; i < 24; i += 1) state.advance(1 / 60);
  }
  assert.deepEqual(new WeaponState(WEAPONS.pistol).sprayOffset(), { right: 0, up: 0 }, 'the pistol has none');
});

// ---- The weapon data ----

test('every gun has the full set of data fields', () => {
  for (const [id, weapon] of Object.entries(WEAPONS)) {
    assert.equal(weapon.id, id);
    for (const field of ['damage', 'interval', 'magazine', 'reloadTime', 'reloadSoundAt', 'range']) {
      assert.ok(Number.isFinite(weapon[field]) && weapon[field] > 0, `${id}.${field}`);
    }
    assert.equal(typeof weapon.automatic, 'boolean');
    assert.ok(weapon.reserve > 0);
    for (const field of ['base', 'moving', 'bloomPerShot', 'bloomMax', 'bloomDelay', 'bloomRecovery']) {
      assert.ok(weapon.spread[field] >= 0, `${id}.spread.${field}`);
    }
    for (const field of ['pitch', 'yawJitter', 'roll', 'push', 'recovery']) assert.ok(weapon.recoil[field] >= 0, `${id}.recoil.${field}`);
    for (const field of ['zoom', 'spread', 'recoil']) assert.ok(weapon.ads[field] > 0, `${id}.ads.${field}`);
  }
});

test('gun slots follow Lola outfit order, and 1 / 2 pick the M416 / pistol', () => {
  assert.deepEqual(WEAPON_SLOTS, ['m416', 'pistol']);
  assert.deepEqual(OUTFIT_WEAPONS, ['m416', 'basic'], 'outfit 0 carries the rifle, outfit 1 the pistol');
  assert.equal(weaponForSlot(0), WEAPONS.m416);
  assert.equal(slotForKey('1'), 0);
  assert.equal(slotForKey('2'), 1);
});

test('weapon roles: the M416 has the higher sustained DPS, the pistol the bigger, more precise shot', () => {
  const rifle = weaponBalance(WEAPONS.m416), pistol = weaponBalance(WEAPONS.pistol);
  assert.ok(rifle.sustainedDps > pistol.sustainedDps, `${rifle.sustainedDps} vs ${pistol.sustainedDps}`);
  assert.ok(rifle.burstDps > pistol.burstDps);
  assert.ok(WEAPONS.pistol.damage > WEAPONS.m416.damage);
  assert.ok(WEAPONS.pistol.spread.base < WEAPONS.m416.spread.base);
  // The numbers recorded in the balance note.
  assert.ok(Math.abs(rifle.burstDps - 14) < 0.05 && Math.abs(rifle.sustainedDps - 9.32) < 0.05);
  assert.ok(Math.abs(pistol.burstDps - 10) < 0.05 && Math.abs(pistol.sustainedDps - 8.39) < 0.05);
  // Both keep the fight in the intended 60-90 s window.
  for (const balance of [rifle, pistol]) assert.ok(balance.secondsToKill > 60 && balance.secondsToKill < 90);
});

test('Leaper hit volumes use known zones; the eye core is the weak point', () => {
  for (const entry of LEAPER_HITBOXES) {
    assert.ok(HIT_ZONES[entry.zone], entry.zone);
    assert.ok(entry.radius > 0);
    assert.ok(entry.shape === 'sphere' ? entry.at : entry.from && entry.to);
  }
  assert.equal(HIT_ZONES.core.multiplier, COMBAT.weakPointMultiplier);
});

test('M416 spares run out; ammo pickups add to them up to the most it can carry', () => {
  const rifle = new WeaponState(WEAPONS.m416);
  assert.equal(rifle.reserve, 80, 'starts with four spare magazines');
  assert.equal(rifle.spareRoom, 80);
  assert.equal(rifle.addReserve(40), 40);
  assert.equal(rifle.addReserve(60), 40, 'never above reserveMax');
  assert.equal(rifle.reserve, WEAPONS.m416.reserveMax);
  assert.equal(rifle.spareRoom, 0);
  // Empty spares: nothing to reload.
  rifle.reserve = 0;
  rifle.mag = 0;
  assert.equal(rifle.canReload, false);
  rifle.addReserve(40);
  assert.equal(rifle.canReload, true, 'a pickup makes a reload possible again');
  // The basic gun never runs out and never needs a pickup.
  const pistol = new WeaponState(WEAPONS.pistol);
  assert.equal(pistol.reserve, Infinity);
  assert.equal(pistol.spareRoom, 0);
  assert.equal(pistol.addReserve(40), 0);
});
