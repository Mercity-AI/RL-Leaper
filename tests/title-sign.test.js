import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_SIGN } from '../src/config/titleSign.js';
import { TitleSignMotion } from '../src/ui/scrapSign/TitleSignMotion.js';
import { hintLines, tagHeight } from '../src/ui/scrapSign/titlePictures.js';

// The title screen's hanging sign (src/ui/TitleSign.js): its motion and its tags'
// sizes. The drawing itself is checked in a real browser.

const HEIGHTS = [58, 92, 58, 58]; // PLAY, EXPLORE (with its hint), SETTINGS, CREDITS
const deg = (rad) => rad * 180 / Math.PI;

// Run for `seconds` at 60 frames a second, recording the sign and the tags.
function run(motion, seconds, fps = 60) {
  const log = [];
  for (let t = 0; t < seconds; t += 1 / fps) {
    motion.advance(1 / fps);
    log.push({ t, x: motion.sign().left - TITLE_SIGN.sign.x, y: motion.sign().top - TITLE_SIGN.sign.y, tags: motion.chain().map((link) => link.phi) });
  }
  return log;
}

test('the sign swings gently left and right the whole time, evenly from the first frame', () => {
  const motion = new TitleSignMotion();
  motion.setTags(HEIGHTS);
  const log = run(motion, 20);
  const swing = (from, to) => Math.max(...log.filter((e) => e.t >= from && e.t < to).map((e) => Math.abs(e.x)));
  for (const [from, to] of [[0, 5], [5, 10], [15, 20]]) {
    const most = swing(from, to);
    assert.ok(most > 10 && most < 14, `about ${TITLE_SIGN.motion.sway} units each way (${most.toFixed(1)} from ${from} s)`);
  }
  assert.ok(log.some((e) => e.x > 8) && log.some((e) => e.x < -8), 'both ways');
  assert.ok(log.every((e) => e.y >= 0 && e.y < 0.5), 'a pendulum: it hardly rises');
});

test('the tags trail it calmly and stay finite', () => {
  const motion = new TitleSignMotion();
  motion.setTags(HEIGHTS);
  const log = run(motion, 10);
  const most = Math.max(...log.flatMap((e) => e.tags.map((phi) => Math.abs(deg(phi)))));
  assert.ok(most > 0.2 && most < 8, `tags swing up to ${most.toFixed(2)} degrees`);
  assert.ok(log.every((e) => e.tags.every(Number.isFinite)));
});

test('it moves the same at 30, 60 and 144 frames a second', () => {
  const at = (fps) => { const motion = new TitleSignMotion(); motion.setTags(HEIGHTS); run(motion, 3, fps); return motion; };
  const a = at(30), b = at(60), c = at(144);
  for (const other of [b, c]) {
    assert.ok(Math.abs(a.sign().left - other.sign().left) < 0.5);
    other.tags.forEach((tag, i) => assert.ok(Math.abs(deg(tag.phi - a.tags[i].phi)) < 0.5));
  }
});

test('choosing another tag knocks it: a small swing that dies away', () => {
  const quiet = new TitleSignMotion(), knocked = new TitleSignMotion();
  quiet.setTags(HEIGHTS);
  knocked.setTags(HEIGHTS);
  knocked.knock(2);
  const a = run(quiet, 4), b = run(knocked, 4);
  const gap = (from, to) => Math.max(...b.filter((e) => e.t >= from && e.t < to).map((e, j) => Math.abs(deg(e.tags[2] - a[b.indexOf(e)].tags[2]))));
  assert.ok(gap(0, 0.6) > 0.5 && gap(0, 0.6) < 6, `a visible knock (${gap(0, 0.6).toFixed(2)} degrees)`);
  assert.ok(gap(3, 4) < 0.1, 'gone a few seconds later');
});

test('a frame with no time passing changes nothing, and a long stall is no jump', () => {
  const motion = new TitleSignMotion();
  motion.setTags(HEIGHTS);
  const before = motion.sign().left;
  motion.advance(0);
  motion.advance(Number.NaN);
  assert.equal(motion.sign().left, before);
  motion.advance(5);
  assert.ok(Math.abs(motion.sign().left - TITLE_SIGN.sign.x) < 14);
});

test('reduced motion: the sign and tags hang still and knocks do nothing', () => {
  const motion = new TitleSignMotion();
  motion.setTags(HEIGHTS, { still: true });
  motion.knock(1);
  const log = run(motion, 3);
  assert.ok(log.every((e) => Math.abs(e.x) < 1e-9 && e.tags.every((phi) => Math.abs(phi) < 1e-9)));
});

test('the tags hang one below another from the sign', () => {
  const motion = new TitleSignMotion();
  motion.setTags(HEIGHTS, { still: true });
  const links = motion.chain();
  assert.equal(links.length, 4);
  assert.equal(links[0].y, TITLE_SIGN.sign.y + TITLE_SIGN.sign.tagHole[1]);
  for (let i = 1; i < links.length; i++) {
    const above = links[i - 1];
    assert.equal(links[i].y, above.y + above.wire + above.height - TITLE_SIGN.tag.bottomHole);
  }
  const bottom = links.at(-1).y + links.at(-1).wire + links.at(-1).height;
  assert.ok(bottom < TITLE_SIGN.view.height - 60, `the last tag ends at ${bottom}, clear of the bottom's small print`);
});

test('a hint is wrapped to fit its tag, and makes the tag taller', () => {
  const lines = hintLines('Practice: roam and shoot while the Leaper stands still.');
  assert.deepEqual(lines.join(' '), 'PRACTICE: ROAM AND SHOOT WHILE THE LEAPER STANDS STILL');
  assert.ok(lines.length >= 2 && lines.every((line) => line.length * 7.2 <= TITLE_SIGN.tag.width - 20));
  assert.equal(tagHeight([]), 58);
  assert.equal(tagHeight(['A', 'B']), 92);
});
