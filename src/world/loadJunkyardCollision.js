import { buildJunkyardCollision, unpackJunkyardCollision } from './junkyardCollision.js';

// Fetch collision.json and build the junkyard's collision grids in a worker
// thread (src/world/collisionWorker.js), so the 5.9 MB parse and the grid
// building never freeze the page. If workers aren't available, or one fails to
// start, the same work runs here on the page instead (same code, same answer).
// report(share): optional progress, 0..1, for the loading bar. The result says
// where the grids were built (builtBy: 'worker' or 'page').
export async function loadJunkyardCollision(url, width, report = () => {}) {
  if (typeof Worker !== 'undefined') {
    try {
      return { ...unpackJunkyardCollision(await inWorker(url, width, report)), builtBy: 'worker' };
    } catch (error) {
      console.warn('Collision worker unavailable, building the map grids on the page instead:', error);
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('The junkyard collision export could not be loaded.');
  return { ...buildJunkyardCollision(await response.json(), width, report), builtBy: 'page' };
}

// One job for a fresh worker; the worker is ended as soon as it has replied.
function inWorker(url, width, report) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./collisionWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) { report(data.progress); return; }
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.packed);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'collision worker failed'));
    };
    worker.postMessage({ url, width });
  });
}
