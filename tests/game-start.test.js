import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_START, randomGameStart } from '../src/world/randomJunkyardStart.js';
import { turnAt, TITLE_SHOWCASE } from '../src/game/TitleShowcase.js';

// A plain 80 x 80 map-unit yard of 1-unit cells, all one region, all safe.
function openYard(size = 80) {
  const count = size * size;
  return {
    point: (i) => ({ x: (i % size) - size / 2 + 0.5, z: Math.floor(i / size) - size / 2 + 0.5 }),
    regions: { count: 1, labels: new Uint8Array(count), sizes: [count] },
    spawnable: new Uint8Array(count).fill(1),
  };
}

test('a new game drops the Leaper and Lola at random spots, a fair distance apart', () => {
  const world = { navigation: openYard(), scale: 0.5 };
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const start = randomGameStart(world);
    assert.ok(start, 'a pair exists');
    const apart = Math.hypot(start.position.x - start.target.x, start.position.z - start.target.z) / world.scale;
    assert.ok(apart >= GAME_START.minimumDistance - 1e-9 && apart <= GAME_START.maximumDistance + 1e-9, `apart ${apart}`);
    seen.add(`${start.position.x},${start.position.z}`);
  }
  assert.ok(seen.size > 30, 'the Leaper starts somewhere new each time');
});

test('Lola never starts where she cannot stand', () => {
  const world = { navigation: openYard(), scale: 1, playerBlocked: (x) => x < 0 };
  for (let i = 0; i < 20; i += 1) assert.ok(randomGameStart(world).target.x >= 0);
});

test('no random start on a yard too small for the distance', () => {
  assert.equal(randomGameStart({ navigation: openYard(10), scale: 1 }), null);
});

test('the title turn: clockwise, back, anticlockwise, back, resting in between', () => {
  const leg = TITLE_SHOWCASE.move + TITLE_SHOWCASE.rest;
  assert.equal(turnAt(0), 0);
  assert.equal(turnAt(TITLE_SHOWCASE.move + 0.01), -1);
  assert.equal(turnAt(leg + TITLE_SHOWCASE.move + 0.01), 0);
  assert.equal(turnAt(2 * leg + TITLE_SHOWCASE.move + 0.01), 1);
  assert.ok(Math.abs(turnAt(4 * leg)) < 1e-9, 'and round again');
});
