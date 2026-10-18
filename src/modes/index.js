import * as junkyard from './junkyard.js';
import * as arena from './arena.js';
import * as training from './training.js';
import * as sandbox from './sandbox.js';

export { pickMode } from './pickMode.js';

// Every page mode. Each module exports start({ engine, params }), which loads
// what it needs and returns its frame phases:
//   { update(dt), lateUpdate(dt), beforeRender(), afterRender(), dispose() }
// plus optional input(dt) and maxDelta (frame-time cap in seconds).
export const MODES = Object.freeze({ junkyard, arena, training, sandbox });
