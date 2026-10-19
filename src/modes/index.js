export { pickMode } from './pickMode.js';

// Every page mode. Each module exports start({ engine, params }), which loads
// what it needs and returns its frame phases:
//   { update(dt), lateUpdate(dt), beforeRender(), afterRender(), dispose() }
// plus optional input(dt) and maxDelta (frame-time cap in seconds).
//
// Modes are downloaded only when picked: the game page never fetches the RL
// lab's replay viewer, live-brain arena or sandbox code (and the arena's
// in-browser brain engine), and the lab pages never fetch the game.
const lazy = (load) => Object.freeze({
  load,
  start: async (context) => (await load()).start(context),
});

export const MODES = Object.freeze({
  junkyard: lazy(() => import('./junkyard.js')),
  arena: lazy(() => import('./arena.js')),
  training: lazy(() => import('./training.js')),
  sandbox: lazy(() => import('./sandbox.js')),
});
