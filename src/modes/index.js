export { pickMode } from './pickMode.js';

// Every page mode. Each module exports start({ engine, params }), which loads
// what it needs and returns its frame phases:
//   { update(dt), lateUpdate(dt), beforeRender(), afterRender(), dispose() }
// plus optional input(dt) and maxDelta (frame-time cap in seconds).
//
// Modes are downloaded only when picked: the game page never fetches the RL
// lab's replay viewer, live-brain arena or sandbox code (and the arena's
// in-browser brain engine), and the lab pages never fetch the game.
//
// Each entry also says what it wants from the shared renderer (createScene
// options), decided before the renderer exists: `glow` = the bloom pass on
// medium and high quality. Only the game wants it; the lab views stay plain
// (a glowing coverage map or debug overlay would only get in the way).
const lazy = (load, engine = {}) => Object.freeze({
  load,
  start: async (context) => (await load()).start(context),
  engine: Object.freeze({ glow: false, ...engine }),
});

export const MODES = Object.freeze({
  junkyard: lazy(() => import('./junkyard.js'), { glow: true }),
  arena: lazy(() => import('./arena.js')),
  training: lazy(() => import('./training.js')),
  sandbox: lazy(() => import('./sandbox.js')),
});
