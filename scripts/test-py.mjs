// `pnpm test:py`: the game's Python tests that need no brain checkpoint or
// PyTorch (numpy + gymnasium are enough): the frozen-recipe pin, collision and
// eye-sight fairness rules, the brain service's HTTP contract and the proofs
// that its speed-ups change nothing.
//   pnpm test:py --checkpoint   also runs the real-brain tests (requirements-brain.txt)
import { spawnSync } from 'node:child_process';
import { findPython, PYTHON_SETUP, ROOT } from './python.mjs';

const TESTS = [
  'tests/test_frozen_recipe.py',
  'tests/test_junkyard_brain.py',
  'tests/test_eye_vision.py',
  'tests/test_junkyard_server.py',
  'tests/test_junkyard_speedups.py',
];

// Pick the project's Python, or explain how to set it up.
const python = findPython();
const ready = python && spawnSync(python, ['-c', 'import numpy, gymnasium'], { windowsHide: true }).status === 0;
if (!ready) {
  console.error(python ? `${python} is missing numpy or gymnasium. ${PYTHON_SETUP}` : `No Python found. ${PYTHON_SETUP}`);
  process.exit(1);
}

// Without --checkpoint, the real-brain test classes report themselves as skipped.
const withCheckpoint = process.argv.includes('--checkpoint');
const env = { ...process.env };
if (withCheckpoint) delete env.LEAPER_SKIP_CHECKPOINT_TESTS;
else env.LEAPER_SKIP_CHECKPOINT_TESTS = '1';
console.log(`${python} -m unittest ${TESTS.join(' ')}${withCheckpoint ? '  (with the real brain)' : ''}`);
const result = spawnSync(python, ['-m', 'unittest', ...TESTS], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
