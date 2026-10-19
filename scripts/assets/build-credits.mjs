// Write CREDITS.md from the sound manifest (node scripts/assets/build-credits.mjs).
//
// The CREDITS screen (src/ui/credits.js) is made from the same records
// (src/audio/credits.js), so the two always agree; tests/audio-licences.test.js
// fails if CREDITS.md is out of date. Run this after changing src/audio/sounds.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creditsMarkdown } from '../../src/audio/credits.js';

const target = fileURLToPath(new URL('../../CREDITS.md', import.meta.url));
fs.writeFileSync(target, creditsMarkdown());
console.log(`CREDITS.md: ${fs.statSync(target).size} bytes`);
