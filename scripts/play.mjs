// `pnpm play`: start the whole game with one command, on Windows, macOS or Linux.
//
// 1. Starts the local brain service (python -m rl.junkyard_server) unless one is
//    already running, and waits until it reports the approved 7,757,824-step brain.
// 2. Starts the game's dev server (Vite) and prints the address to open.
// The brain's messages are shown with a [brain] prefix. If the brain stops, this
// says so loudly and exits; Ctrl+C stops both.
//   pnpm play --port 5180         serve the game on another port
//   pnpm play --brain-port 8771   start the brain elsewhere (only for testing this
//                                 script: the game page always calls port 8767)
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { findPython, PYTHON_SETUP, ROOT } from './python.mjs';

// --- Settings -------------------------------------------------------------------
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
}
// The game page talks to the brain on 8767 (src/simulation/JunkyardBrain.js).
const BRAIN_PORT = option('--brain-port', 8767);
const BRAIN_URL = `http://127.0.0.1:${BRAIN_PORT}/`;
const MODEL_STEP = 7757824;
// Loading PyTorch and the checkpoint usually takes a few seconds; allow slow disks.
const BRAIN_START_SECONDS = 180;
const GAME_PORT = option('--port', 5173);

let brain = null;
let vite = null;
let stopping = false;

// Stop everything we started, then exit with the given code.
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  if (brain && brain.exitCode === null) brain.kill();
  await vite?.close().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Ask the brain service for its health report; null while it is not answering.
async function brainHealth() {
  try {
    const response = await fetch(BRAIN_URL, { signal: AbortSignal.timeout(2000) });
    return await response.json();
  } catch {
    return null;
  }
}

// Show the brain's own output, line by line, so its errors are never hidden.
function forward(stream, write) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) write(`[brain] ${line}\n`);
  });
}

// --- 1. The brain service ---------------------------------------------------------
async function startBrain() {
  const running = await brainHealth();
  if (running) {
    if (running.model_step !== MODEL_STEP) {
      console.error(`Port ${BRAIN_PORT} is used by something that is not the Leaper brain. Close it and try again.`);
      await shutdown(1);
    }
    console.log(`Using the brain service that is already running at ${BRAIN_URL}`);
    return;
  }
  const python = findPython();
  if (!python) {
    console.error(`No Python found for the Leaper brain. ${PYTHON_SETUP}`);
    await shutdown(1);
  }
  console.log(`Starting the Leaper brain with ${python} …`);
  brain = spawn(python, ['-m', 'rl.junkyard_server', '--port', String(BRAIN_PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  forward(brain.stdout, (text) => process.stdout.write(text));
  forward(brain.stderr, (text) => process.stderr.write(text));
  brain.on('error', async (error) => {
    console.error(`Could not start Python (${error.message}). ${PYTHON_SETUP}`);
    await shutdown(1);
  });
  brain.on('exit', async (code, signal) => {
    if (stopping) return;
    const reason = code === null ? `stopped by ${signal}` : `exit code ${code}`;
    console.error(`\nThe Leaper brain service stopped (${reason}). The Leaper can't move without it.`);
    console.error(`If it reported a missing module: ${PYTHON_SETUP}`);
    await shutdown(1);
  });
  // Wait until it answers with the approved brain's identity.
  const deadline = Date.now() + BRAIN_START_SECONDS * 1000;
  while (Date.now() < deadline) {
    const health = await brainHealth();
    if (health?.model_step === MODEL_STEP) {
      console.log(`Brain ready: ${MODEL_STEP.toLocaleString('en-US')} steps, policy SHA256 ${health.policy_sha256.slice(0, 12)}…`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`The brain did not answer within ${BRAIN_START_SECONDS} s.`);
  await shutdown(1);
}

// --- 2. The game page -------------------------------------------------------------
async function startGame() {
  try {
    vite = await createServer({ root: ROOT, server: { host: '127.0.0.1', port: GAME_PORT, strictPort: true } });
    await vite.listen();
  } catch (error) {
    console.error(`Could not start the game on port ${GAME_PORT}: ${error.message}`);
    console.error('Close the other server using that port, or run: pnpm play --port 5180');
    await shutdown(1);
  }
  const url = `http://127.0.0.1:${GAME_PORT}/`;
  console.log(`\n  Leaper is ready. Open ${url}\n`);
  console.log('  START RUN wakes the Leaper; the first run at a new size maps the junkyard (about 30 s, once).');
  console.log('  Press Ctrl+C here to stop the game and the brain.\n');
}

await startBrain();
await startGame();
