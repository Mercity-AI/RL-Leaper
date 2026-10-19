import './styles/main.css';
import './styles/junkyard.css';
import { createScene } from './core/createScene.js';
import { GameLoop } from './core/GameLoop.js';
import { MODES, pickMode } from './modes/index.js';

// Bootstrap: one renderer for the page, the mode chosen by the address, and one
// frame loop. Everything mode-specific lives in src/modes/.

// 1. The page address picks the mode (the junkyard game is the default).
const params = new URLSearchParams(window.location.search);
const entry = MODES[pickMode(params)];

// 2. Renderer, scene, camera and lights shared by every mode, set up the way
//    the picked mode asks (e.g. glow for the game), then the mode starts.
const engine = createScene(document.getElementById('app'), entry.engine);
const mode = await entry.start({ engine, params });

// 3. Run the mode's phases every frame, then draw (engine.render adds the glow
//    pass when there is one).
const loop = new GameLoop({
  mode,
  render: () => engine.render(),
});
loop.start();
