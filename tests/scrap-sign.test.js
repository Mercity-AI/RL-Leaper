import test from 'node:test';
import assert from 'node:assert/strict';
import { SCRAP_SIGN } from '../src/config/scrapSign.js';
import { ScrapSignPhysics } from '../src/ui/scrapSign/ScrapSignPhysics.js';
import { rustPlatePixels } from '../src/ui/scrapSign/rustPlate.js';

// The end screen's scrap sign (src/ui/ScrapSign.js): its motion and its rust.
// The drawing itself is checked in a real browser.

// Run the drop for `seconds` at 60 frames a second, recording what happens.
function run(physics, seconds) {
  const log = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    physics.advance(1 / 60);
    log.push({ t, x: physics.body.x, y: physics.body.y, a: physics.body.a, tags: physics.tags.map((tag) => tag.phi) });
  }
  return log;
}

test('the sign falls from out of sight, the chains catch it, it sways about two seconds and settles', () => {
  const physics = new ScrapSignPhysics();
  physics.drop({ top: -300 });
  assert.ok(physics.body.y + SCRAP_SIGN.size.height / 2 < -300, 'it starts above the screen');
  const log = run(physics, 6);
  const caught = log.find((entry) => entry.y > -10);
  assert.ok(caught && caught.t < 1, `caught in under a second (at ${caught?.t.toFixed(2)} s)`);
  const swing = (from, to) => Math.max(...log.filter((e) => e.t >= from && e.t < to).map((e) => Math.abs(e.x)));
  assert.ok(swing(caught.t, caught.t + 1.5) > 30, 'it swings visibly left and right after the catch');
  assert.ok(swing(caught.t + 3, 6) < 8, `and has nearly settled 3 s later (${swing(caught.t + 3, 6).toFixed(1)} units)`);
  const end = log.at(-1);
  assert.ok(Math.abs(end.y) < 6 && end.a > 0.005 && end.a < 0.03, 'it rests where it should, a little crooked');
});

test('the tags swing calmly: about ten degrees at most (owner: they moved far too much)', () => {
  const physics = new ScrapSignPhysics();
  physics.drop({ top: -300 });
  const log = run(physics, 6);
  const most = Math.max(...log.flatMap((entry) => entry.tags.map(Math.abs))) * 180 / Math.PI;
  assert.ok(most > 2 && most < 15, `tags swing up to ${most.toFixed(1)} degrees`);
  assert.ok(log.every((entry) => entry.tags.every(Number.isFinite)), 'their angles stay numbers');
});

test('a frame with no time passing changes nothing (it once made the tags\' angles NaN)', () => {
  const physics = new ScrapSignPhysics();
  physics.drop({ top: -300 });
  physics.advance(0);
  physics.advance(1 / 60);
  assert.ok(physics.tags.every((tag) => Number.isFinite(tag.phi)));
});

test('on a tall screen the chains still hang from above its top edge', () => {
  const physics = new ScrapSignPhysics();
  physics.drop({ top: -900 });
  for (const [, y] of physics.anchors) assert.ok(y < -900);
});

test('reduced motion: the sign is simply hanging at rest', () => {
  const physics = new ScrapSignPhysics();
  physics.drop({ top: -300, still: true });
  assert.ok(Math.abs(physics.body.x) < 3 && Math.abs(physics.body.y) < 6);
  assert.ok(Math.abs(physics.body.vx) < 5 && Math.abs(physics.body.vy) < 5);
});

test('any number of menu items gets a tag each', () => {
  const physics = new ScrapSignPhysics();
  physics.setTags(3);
  assert.equal(physics.tags.length, 3);
  assert.equal(physics.pivots.length, 3);
});

test('the rust is red-brown, never yellow, and the painted middle is less rusty than the edges', () => {
  const plate = rustPlatePixels({ width: 780, height: 320, scale: 0.5, holes: SCRAP_SIGN.chainHoles });
  let rusty = 0, yellowish = 0, middle = 0, middleCount = 0, edge = 0, edgeCount = 0;
  for (let p = 0; p < plate.rust.length; p++) {
    const x = (p % plate.width) / 0.5, y = Math.floor(p / plate.width) / 0.5, amount = plate.rust[p] / 255;
    if (amount > 0.8) {
      rusty++;
      const r = plate.pixels[p * 4], g = plate.pixels[p * 4 + 1];
      if (g > r * 0.62) yellowish++;
    }
    if (Math.abs(x - 390) < 200 && Math.abs(y - 175) < 60) { middle += amount; middleCount++; }
    if (x < 40 || x > 740) { edge += amount; edgeCount++; }
  }
  assert.ok(rusty > 0 && yellowish / rusty < 0.05, `rust pixels with a yellow cast: ${(100 * yellowish / rusty).toFixed(1)}%`);
  assert.ok(middle / middleCount < edge / edgeCount, 'less rust in the middle than at the edges');
});
