import './styles/main.css';
import './styles/junkyard.css';
import { createScene } from './core/createScene.js';
import { GameLoop } from './core/GameLoop.js';
import { MODES, pickMode } from './modes/index.js';

// Bootstrap: one renderer for the page, the mode chosen by the address, and one
// frame loop. Everything mode-specific lives in src/modes/.

// 1. Renderer, scene, camera and lights shared by every mode.
const engine = createScene(document.getElementById('app'));

// 2. The page address picks the mode (the junkyard game is the default).
const params = new URLSearchParams(window.location.search);
const mode = await MODES[pickMode(params)].start({ engine, params });

// 3. Run the mode's phases every frame, then draw.
const loop = new GameLoop({
  mode,
  render: () => engine.render(),
});
loop.start();
