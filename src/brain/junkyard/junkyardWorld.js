// Builds what the browser brain needs to know about the junkyard at one Leaper
// size: the flat collision raster and the 3D sight triangles, both in world
// (robot) units. Used by the Web Worker and by the Node parity tests.

import { JunkyardRaster, scaleForWidth } from './collisionRaster.js';
import { JunkyardSight, scaleTriangles } from './junkyardSight.js';

// Hands the triangles to the raster builder one by one and reports how far it
// got (every 2%). The builder only iterates them, so the result is unchanged.
function* countedTriangles(triangles, onProgress) {
  const every = Math.max(1, Math.floor(triangles.length / 50));
  for (let i = 0; i < triangles.length; i += 1) {
    if (i % every === 0) onProgress('raster', i / triangles.length);
    yield triangles[i];
  }
}

// `glbTriangles`: loadGlbTriangles(junkyard.glb) (unscaled, reused for every size).
// `baked`: an optional decoded raster file for this width; otherwise `collision`
// (collision.json) is rasterised here (~0.1-0.3 s in V8).
// `onProgress(stage, fraction)`: optional; stages 'raster' and 'sight'.
export function createJunkyardWorld({ width, glbTriangles, collision = null, baked = null, onProgress = null }) {
  const started = performance.now();
  let raster;
  let rasterSource = 'built';
  if (baked && baked.raster.width === width && baked.raster.scale === scaleForWidth(width)) {
    raster = baked.raster;
    rasterSource = 'baked';
  } else if (collision) {
    const source = onProgress
      ? { bounds: collision.bounds, triangles: countedTriangles(collision.triangles, onProgress) } : collision;
    raster = JunkyardRaster.build(source, width);
  } else {
    throw new Error(`No collision raster for Leaper width ${width}`);
  }
  const rasterMs = performance.now() - started;
  onProgress?.('raster', 1);
  onProgress?.('sight', 0);
  const sight = new JunkyardSight(scaleTriangles(glbTriangles, scaleForWidth(width)));
  onProgress?.('sight', 1);
  return { width, scale: scaleForWidth(width), raster, sight, rasterSource, rasterMs,
    sightMs: performance.now() - started - rasterMs };
}
