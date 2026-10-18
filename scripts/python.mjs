// Finds the Python that runs the Leaper brain, the same way on every computer.
// Used by `pnpm play` and `pnpm test:py`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WINDOWS = process.platform === 'win32';

// Order of preference: an explicit LEAPER_PYTHON, the project's .venv (set up
// from requirements-brain.txt), then the system Python 3.12 or any Python 3.
export function findPython() {
  const candidates = [
    process.env.LEAPER_PYTHON,
    WINDOWS ? join(ROOT, '.venv', 'Scripts', 'python.exe') : join(ROOT, '.venv', 'bin', 'python'),
    ...(WINDOWS ? ['python'] : ['python3.12', 'python3', 'python']),
  ].filter(Boolean);
  for (const candidate of candidates) {
    // A path must exist; a bare command name must start and report its version.
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  return null;
}

// Plain-language setup steps, printed when Python or its packages are missing.
export const PYTHON_SETUP = WINDOWS
  ? 'Set up the brain once:  py -3.12 -m venv .venv  then  .venv\\Scripts\\python.exe -m pip install -r requirements-brain.txt'
  : 'Set up the brain once:  python3.12 -m venv .venv  then  .venv/bin/python -m pip install -r requirements-brain.txt';
