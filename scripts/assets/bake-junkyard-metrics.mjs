// Bake the junkyard's level metrics into assets/maps/junkyard/metrics.json.
//
// Run after every map export (pnpm assets:metrics, also part of pnpm assets).
// The OPTIONS size slider takes its maximum from this file, and
// tests/world-map-metrics.test.js fails when the file no longer matches
// collision.json, so a stale bake can't slip through.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ENCOUNTER } from '../../src/config/encounter.js';
import { largestWorkableWidth, measureJunkyard } from '../../src/world/junkyardMetrics.js';

const MAP = new URL('../../assets/maps/junkyard/', import.meta.url);

// 1. Read the collision export (and fingerprint it, to spot a stale bake later).
const bytes = fs.readFileSync(new URL('collision.json', MAP));
const data = JSON.parse(bytes.toString('utf8'));
const collisionSha256 = crypto.createHash('sha256').update(bytes).digest('hex');

// 2. The largest workable Leaper size, and the numbers at a few useful sizes.
const maxWorkableWidth = largestWorkableWidth(data);
const widths = [...new Set([2.4, 4, ENCOUNTER.startWidth, maxWorkableWidth])].sort((a, b) => a - b);
const metrics = {
  about: 'Junkyard level metrics, baked by scripts/assets/bake-junkyard-metrics.mjs from collision.json and checked by tests/world-map-metrics.test.js. Cells are 0.4 map units; the Leaper is the overlay\'s conservative single circle of the clearance width, not the brain\'s 19-disc body.',
  collisionSha256,
  startWidth: ENCOUNTER.startWidth,
  maxWorkableWidth,
  atStartWidth: measureJunkyard(data, ENCOUNTER.startWidth),
  byWidth: widths.map((width) => measureJunkyard(data, width)),
};

// 3. Write it, and say the headline numbers.
fs.writeFileSync(new URL('metrics.json', MAP), `${JSON.stringify(metrics, null, 2)}\n`);
const start = metrics.atStartWidth;
console.log(`metrics.json: largest workable width ${maxWorkableWidth}; at ${ENCOUNTER.startWidth}: `
  + `${start.freeCells} clear cells (${(start.freeShareOfArena * 100).toFixed(1)}% of the yard) in ${start.regions} regions, `
  + `spawn region ${(start.reachableShareOfFree * 100).toFixed(1)}% of clear floor (${(start.reachableShareOfArena * 100).toFixed(1)}% of the yard)`);
