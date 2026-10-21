import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING_KEY, TuningRegistry, deepCopy, rangeFor, readPath } from '../src/config/tuning/registry.js';
import { CAMERA, COMBAT, HIT_FEEDBACK, LEAPER_ANGLES, LEAPER_BEHAVIOUR, SHOOTING, WEAPONS, registerGameConfigs, tuning, weaponForSlot } from '../src/config/tuning/index.js';
import { CAMERA as CAMERA_CONFIG } from '../src/config/camera.js';
import { COMBAT as COMBAT_CONFIG } from '../src/config/combat.js';
import { HIT_FEEDBACK as HIT_FEEDBACK_CONFIG, SHOOTING as SHOOTING_CONFIG, WEAPONS as WEAPONS_CONFIG, weaponForSlot as configWeaponForSlot } from '../src/config/weapons.js';
import eyeVision from '../src/config/eye-vision.json' with { type: 'json' };
import playerContact from '../src/config/player-contact.json' with { type: 'json' };
import { LEAPER_ANGLES as ANGLES_CONFIG, LEAPER_BEHAVIOUR as LEAPER_BEHAVIOUR_CONFIG } from '../src/config/leaper-behaviour.js';
import { WeaponState } from '../src/weapons/WeaponState.js';
import { HitFeedback } from '../src/weapons/HitFeedback.js';
import { planLeap } from '../src/actors/leaper/leapPlanner.js';
import { LeaperDirector } from '../src/actors/leaper/LeaperDirector.js';

// The designer tuning registry (src/config/tuning/): players get the config
// files untouched; the developer tools get live copies that change in place,
// reset, and are remembered in this browser; the frozen brain contract is
// read-only. The panel itself is checked in a real browser
// (tests/game-flow.browser.mjs).

// A localStorage stand-in. broken: every call throws (a private window).
const memoryStorage = (initial = {}, { broken = false } = {}) => {
  const data = new Map(Object.entries(initial));
  const guard = (fn) => (...args) => {
    if (broken) throw new Error('storage refused');
    return fn(...args);
  };
  return {
    data,
    getItem: guard((key) => data.get(key) ?? null),
    setItem: guard((key, value) => data.set(key, String(value))),
    removeItem: guard((key) => data.delete(key)),
  };
};

// The game's own registrations on a registry of the test's own.
const gameRegistry = (options = {}) => {
  const registry = new TuningRegistry({ live: true, storage: memoryStorage(), ...options });
  return { registry, configs: registerGameConfigs(registry) };
};

const SOURCES = { camera: CAMERA_CONFIG, guns: WEAPONS_CONFIG, shooting: SHOOTING_CONFIG, hitFeedback: HIT_FEEDBACK_CONFIG,
  combat: COMBAT_CONFIG, leaperBehaviour: LEAPER_BEHAVIOUR_CONFIG };

// ---- Defaults ----

test('players (no developer tools) read the config files themselves, exactly as written', () => {
  assert.equal(tuning.live, false, 'no ?dev and no dev server in Node');
  assert.equal(CAMERA, CAMERA_CONFIG);
  assert.equal(WEAPONS, WEAPONS_CONFIG);
  assert.equal(SHOOTING, SHOOTING_CONFIG);
  assert.equal(HIT_FEEDBACK, HIT_FEEDBACK_CONFIG);
  assert.equal(COMBAT, COMBAT_CONFIG);
  assert.equal(LEAPER_BEHAVIOUR, LEAPER_BEHAVIOUR_CONFIG);
  assert.equal(LEAPER_ANGLES, ANGLES_CONFIG);
  assert.equal(weaponForSlot(0), configWeaponForSlot(0));
  assert.equal(weaponForSlot(1), configWeaponForSlot(1));
  assert.deepEqual(tuning.overrides(), {}, 'nothing differs');
  assert.throws(() => tuning.set('camera', 'look.mouse', 0.01), /Tuning is off/);
  assert.equal(tuning.load(), 0);
});

test('with tuning on, every config is a deep, unfrozen copy with the same values', () => {
  const { registry, configs } = gameRegistry();
  for (const [id, source] of Object.entries(SOURCES)) {
    const values = registry.values(id);
    assert.notEqual(values, source, `${id}: a copy, not the file's object`);
    assert.deepEqual(values, deepCopy(source), `${id}: the same values`);
    assert.equal(Object.isFrozen(values), false);
    assert.ok(Object.isFrozen(source), `${id}: the config file stays frozen`);
    for (const field of registry.fields(id)) {
      assert.equal(field.value, readPath(source, field.path), `${id}.${field.path}`);
      assert.equal(field.default, readPath(source, field.path), `${id}.${field.path} default`);
    }
  }
  assert.equal(configs.CAMERA, registry.values('camera'));
  assert.equal(configs.WEAPONS.pistol.reserve, Infinity, 'Infinity survives the copy');
  assert.deepEqual(registry.overrides(), {});
  assert.equal(registry.changesJson(), '{}');
});

test('every default sits inside its slider, and only whole numbers of 2 or more get a step', () => {
  const { registry } = gameRegistry();
  for (const id of registry.ids()) {
    for (const field of registry.fields(id).filter((item) => item.type === 'number')) {
      assert.ok(field.min <= field.default && field.default <= field.max, `${id}.${field.path}: ${field.default} in [${field.min}, ${field.max}]`);
      if (field.step) assert.equal(Math.abs(field.default % field.step), 0, `${id}.${field.path} is on its step`);
    }
  }
  assert.deepEqual(rangeFor(20), { min: 0, max: 80, step: 1 });
  assert.deepEqual(rangeFor(1 / 7), { min: 0, max: 1 + 1 / 7 });
  assert.deepEqual(rangeFor(-0.25), { min: -1.25, max: 0 });
  assert.deepEqual(rangeFor(0), { min: 0, max: 1 });
});

test('every fixed path names a real value, shown read-only', () => {
  const { registry } = gameRegistry();
  for (const id of registry.ids()) {
    for (const path of registry.entry(id).fixed) {
      const field = registry.field(id, path);
      assert.ok(field, `${id}.${path} exists`);
      assert.equal(field.readOnly, true, `${id}.${path}`);
    }
  }
});

// ---- Changing ----

test('set changes the live copy in place (old references see it), never the file; reset undoes it', () => {
  const { registry, configs } = gameRegistry();
  const look = configs.CAMERA.look;
  const heard = [];
  registry.onChange((id, path, value) => heard.push([id, path, value]));
  assert.equal(registry.set('camera', 'look.mouse', 0.01), true);
  assert.equal(registry.set('camera', 'look.mouse', 0.01), false, 'the same value again changes nothing');
  assert.equal(look.mouse, 0.01, 'a module that kept the nested object sees the change');
  assert.equal(CAMERA_CONFIG.look.mouse, 0.0055, 'the config file is untouched');
  assert.equal(registry.set('guns', 'm416.damage', '3'), true, 'text from a field becomes a number');
  assert.equal(configs.WEAPONS.m416.damage, 3);
  assert.deepEqual(heard, [['camera', 'look.mouse', 0.01], ['guns', 'm416.damage', 3]]);
  assert.deepEqual(registry.overrides(), { camera: { 'look.mouse': 0.01 }, guns: { 'm416.damage': 3 } });
  assert.deepEqual(JSON.parse(registry.changesJson()), registry.overrides());

  registry.reset('camera');
  assert.equal(look.mouse, 0.0055, 'one config back to the file');
  assert.equal(configs.WEAPONS.m416.damage, 3, 'the others keep their changes');
  registry.reset();
  assert.equal(configs.WEAPONS.m416.damage, 2);
  assert.deepEqual(registry.overrides(), {});
  assert.deepEqual(heard.slice(2), [['camera', 'look.mouse', 0.0055], ['guns', 'm416.damage', 2]]);
});

test('set refuses unknown paths, wrong kinds, fixed values and anything not shown', () => {
  const { registry, configs } = gameRegistry();
  assert.throws(() => registry.set('camera', 'look.nothing', 1), /Unknown tunable/);
  assert.throws(() => registry.set('nothing', 'a', 1), /Unknown tuning config/);
  assert.throws(() => registry.set('camera', 'look', 1), /Unknown tunable/, 'a whole group');
  assert.throws(() => registry.set('camera', 'look.constructor', 1), /Unknown tunable/);
  assert.throws(() => registry.set('guns', 'm416.label', 'X'), /Unknown tunable/, 'text is not tunable');
  assert.throws(() => registry.set('guns', 'pistol.reserve', 30), /Unknown tunable/, 'Infinity is not tunable');
  assert.throws(() => registry.set('guns', 'm416.damage', 'lots'), /needs a number/);
  assert.throws(() => registry.set('guns', 'm416.damage', Infinity), /needs a number/);
  assert.throws(() => registry.set('camera', 'look.invertY', true), /not tunable live/, 'a player setting');
  assert.throws(() => registry.set('combat', 'weakPointMultiplier', 3), /not tunable live/);
  assert.equal(configs.COMBAT.weakPointMultiplier, 2);
  assert.deepEqual(registry.overrides(), {});
});

test('live apply: a gun and the hit feedback reading the live copies follow a change at once', () => {
  const { registry, configs } = gameRegistry();
  const gun = new WeaponState(configs.WEAPONS.m416);
  const fire = () => gun.pull({ pressed: true, held: false }, () => true);
  fire();
  assert.equal(gun.cooldown, 1 / 7, 'the M416 as written');
  registry.set('guns', 'm416.interval', 0.5);
  gun.advance(1);
  fire();
  assert.equal(gun.cooldown, 0.5, 'the next shot waits the tuned interval');
  const feedback = new HitFeedback(configs.HIT_FEEDBACK);
  registry.set('hitFeedback', 'markers.weak', 0.9);
  feedback.hit({ weakPoint: true });
  assert.equal(feedback.marker.time, 0.9);
});

test('live apply: the Leaper\'s leap planner and leg rules follow a change at once', () => {
  const { registry, configs } = gameRegistry();
  const leap = configs.LEAPER_BEHAVIOUR.leap;
  const ask = () => planLeap({ from: { x: 0, z: 0, yaw: 0 }, lola: { x: 0, z: 22 }, clear: () => true, config: leap });
  assert.equal(ask(), null, 'Lola 22 units away is beyond the written 20');
  registry.set('leaperBehaviour', 'leap.maxDistance', 25);
  assert.ok(ask(), 'a tuned 25 lets it pounce');
  const director = new LeaperDirector({ config: configs.LEAPER_BEHAVIOUR, legs: configs.COMBAT.legs });
  registry.set('combat', 'legs.maxLost', 2);
  director.legBroken({ lost: 2 });
  assert.equal(director.pendingDowned, true, 'two lost legs knock it down once maxLost is 2');
  assert.throws(() => registry.set('leaperBehaviour', 'engage.turnRate', 45), /not tunable live/, 'worked out in radians at load');
  assert.throws(() => registry.set('leaperBehaviour', 'awareness.memorySteps', 200), /not tunable live/, 'the brain\'s trained memory');
});

// ---- Saving ----

test('changes are saved in this browser and read back on the next visit; no changes, nothing saved', () => {
  const storage = memoryStorage();
  const first = gameRegistry({ storage }).registry;
  first.set('combat', 'boltDamage', 12);
  first.set('shooting', 'aimHold', 0.8);
  assert.deepEqual(JSON.parse(storage.data.get(TUNING_KEY)), { shooting: { aimHold: 0.8 }, combat: { boltDamage: 12 } });

  const { registry: second, configs } = gameRegistry({ storage });
  assert.equal(second.load(), 2);
  assert.equal(configs.COMBAT.boltDamage, 12);
  assert.equal(configs.SHOOTING.aimHold, 0.8);
  second.reset();
  assert.equal(storage.data.has(TUNING_KEY), false, 'back to the files: the saved override is gone');
});

test('a broken, stale or hostile saved override is skipped, and refused storage never throws', () => {
  const stale = JSON.stringify({ camera: { 'look.mouse': 0.008, 'look.gone': 3, 'look.invertY': true }, brainEyeVision: { 'eyeOffset.1': 9 }, nothing: { a: 1 }, guns: 5 });
  const storage = memoryStorage({ [TUNING_KEY]: stale });
  const { registry, configs } = gameRegistry({ storage });
  assert.equal(registry.load(), 1, 'only the one valid value');
  assert.equal(configs.CAMERA.look.mouse, 0.008);
  assert.equal(configs.CAMERA.look.invertY, false);
  for (const text of ['{not json', 'null', '"text"', '[1, 2]']) {
    assert.equal(gameRegistry({ storage: memoryStorage({ [TUNING_KEY]: text }) }).registry.load(), 0, text);
  }
  const refused = gameRegistry({ storage: memoryStorage({}, { broken: true }) });
  assert.equal(refused.registry.load(), 0);
  assert.doesNotThrow(() => refused.registry.set('camera', 'look.touch', 0.01));
  assert.equal(refused.configs.CAMERA.look.touch, 0.01, 'the change still applies for this page');
  assert.doesNotThrow(() => refused.registry.reset());
  // Tuning off (players): nothing is read or written, even with a saved override.
  const playerStorage = memoryStorage({ [TUNING_KEY]: JSON.stringify({ camera: { 'look.mouse': 0.009 } }) });
  const player = new TuningRegistry({ live: false, storage: playerStorage });
  const playerConfigs = registerGameConfigs(player);
  assert.equal(player.load(), 0);
  assert.equal(playerConfigs.CAMERA, CAMERA_CONFIG);
  assert.equal(playerConfigs.CAMERA.look.mouse, 0.0055);
});

// ---- The frozen brain contract ----

test('the frozen brain contract is read-only: the files themselves, never changed or saved', () => {
  const { registry } = gameRegistry();
  for (const [id, source] of [['brainEyeVision', eyeVision], ['brainPlayerContact', playerContact]]) {
    const entry = registry.entry(id);
    assert.equal(entry.readOnly, true, id);
    assert.match(entry.label, /^BRAIN CONTRACT/, `${id} is labelled`);
    assert.equal(registry.values(id), source, `${id}: the file's own data, not a copy`);
    const fields = registry.fields(id);
    assert.ok(fields.length > 0, `${id} shows its numbers`);
    assert.ok(fields.every((field) => field.readOnly), `${id}: every row read-only`);
    for (const field of fields) assert.throws(() => registry.set(id, field.path, field.value + 1), /read-only/);
    assert.equal(registry.applyOverrides({ [id]: Object.fromEntries(fields.map((field) => [field.path, 1])) }), 0);
  }
  assert.throws(() => registry.set('encounter', 'leaperSize', 2), /read-only/);
  const before = JSON.stringify([eyeVision, playerContact]);
  registry.reset();
  assert.equal(JSON.stringify([eyeVision, playerContact]), before);
  assert.deepEqual(registry.overrides(), {});
});
