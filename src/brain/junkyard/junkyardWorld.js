// Builds what the browser brain needs to know about the junkyard at one Leaper
// size: the flat collision raster and the 3D sight triangles, both in world
// (robot) units. Used by the Web Worker and by the Node parity tests.

import { JunkyardRaster, scaleForWidth } from './collisionRaster.js';
import { JunkyardSight, scaleTriangles } from './junkyardSight.js';

// `glbTriangles`: loadGlbTriangles(junkyard.glb) (unscaled, reused for every size).
// `baked`: an optional decoded raster file for this width; otherwise `collision`
// (collision.json) is rasterised here (~0.1-0.3 s in V8).
export function createJunkyardWorld({ width, glbTriangles, collision = null, baked = null }) {
  const started = performance.now();
  let raster = null;
  let rasterSource = 'built';
  if (baked && baked.raster.width === width && baked.raster.scale === scaleForWidth(width)) {
    raster = baked.raster;
    rasterSource = 'baked';
  } else if (collision) {
    raster = JunkyardRaster.build(collision, width);
  } else {
    throw new Error(`No collision raster for Leaper width ${width}`);
  }
  const rasterMs = performance.now() - started;
  const sight = new JunkyardSight(scaleTriangles(glbTriangles, scaleForWidth(width)));
  return { width, scale: scaleForWidth(width), raster, sight, rasterSource, rasterMs,
    sightMs: performance.now() - started - rasterMs };
}
