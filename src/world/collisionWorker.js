import { buildJunkyardCollision, packJunkyardCollision } from './junkyardCollision.js';

// Worker thread: download collision.json, parse it and build the junkyard's
// collision grids away from the page, then hand them back as typed arrays (moved,
// not copied). The page keeps drawing its loading bar the whole time.
self.onmessage = async ({ data: { url, width } }) => {
  try {
    // 1. Download (reporting progress when the server says the size) and parse
    //    the map's flattened triangles.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The junkyard collision export could not be loaded (${response.status}).`);
    const size = Number(response.headers.get('content-length')) || 0;
    const chunks = [];
    let received = 0;
    for (const reader = response.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (size) self.postMessage({ progress: 0.35 * Math.min(1, received / size) });
    }
    const decoder = new TextDecoder();
    const data = JSON.parse(chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode());
    self.postMessage({ progress: 0.4 });
    // 2. Build both grids, regions and spawn cells, and send them back.
    const report = (progress) => self.postMessage({ progress });
    const { packed, transfer } = packJunkyardCollision(data, buildJunkyardCollision(data, width, report));
    self.postMessage({ packed }, transfer);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
