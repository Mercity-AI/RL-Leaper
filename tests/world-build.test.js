import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// The production build: modes load on demand, and no on-demand file may import
// the page's entry file. main.js waits (top-level await) for the chosen mode to
// start, so a mode that imported the entry would wait for the entry in turn and
// the page would hang at boot with no error (it happened once; this guards it).

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('production build: separate mode files that never import the entry file', { timeout: 120000 }, async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaper-build-'));
  try {
    const output = await build({ root: ROOT, logLevel: 'silent', build: { outDir, emptyOutDir: true, reportCompressedSize: false } });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).filter(item => item.type === 'chunk');
    const entry = chunks.find(chunk => chunk.isEntry && chunk.facadeModuleId?.endsWith('index.html'));
    assert.ok(entry, 'the page entry was built');
    for (const mode of ['junkyard', 'arena', 'training', 'sandbox']) {
      assert.ok(chunks.some(chunk => chunk.isDynamicEntry && chunk.name === mode), `${mode} is its own on-demand file`);
    }
    for (const chunk of chunks.filter(item => item !== entry)) {
      assert.ok(!chunk.imports.includes(entry.fileName), `${chunk.fileName} imports the entry file ${entry.fileName}`);
    }
    // The game page doesn't pull the lab's in-browser brain engine up front.
    const upFront = new Set([entry.fileName, ...entry.imports]);
    for (const chunk of chunks.filter(item => upFront.has(item.fileName))) {
      assert.ok(!Object.keys(chunk.modules).some(id => id.includes('onnxruntime-web')), `${chunk.fileName} carries onnxruntime-web`);
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
