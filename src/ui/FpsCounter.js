// The frame rate in the top right corner (owner, 2026-10-22: "make so I can
// see it on screen"), switched in SETTINGS > GRAPHICS > Show FPS. It shows the
// frames drawn over the last half second, and the resolution share when the
// game is drawing fewer pixels to keep up (AdaptiveResolution). SETTINGS >
// GRAPHICS > Show performance stats (owner, 2026-10-30) adds two lines, each the
// median over the same half second, so one hitch does not swing the number:
//   FRAME  milliseconds from one frame to the next (16.7 is 60 fps)
//   CPU    milliseconds of each frame the game's own code and draw calls took
//          (the rest of a slow frame is the graphics card)

const STYLE_ID = 'fps-counter-styles';
const STYLES = `
#fpsCounter { position: fixed; top: calc(var(--hud-edge-top, 12px) + 2px); right: var(--hud-edge-right, 12px); z-index: var(--z-hud, 20); padding: 2px 7px; border-radius: 5px; background: #0b0d10b3; color: #9ef0a8; font: 700 12px/1.4 ui-monospace, Consolas, monospace; letter-spacing: .06em; pointer-events: none; font-variant-numeric: tabular-nums; white-space: pre; }
body.dev-tools #fpsCounter { top: calc(var(--hud-edge-top, 12px) + 42px); } /* Below the developers' VIEW button. */
#fpsCounter[data-level=ok] { color: #ffd166; }
#fpsCounter[data-level=slow] { color: #ff6b5a; }
`;

// The middle value of a list (0 for an empty one).
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class FpsCounter {
  constructor({ doc = document, parent = doc.body, every = 0.5 } = {}) {
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLES;
      doc.head.append(style);
    }
    this.element = doc.createElement('div');
    this.element.id = 'fpsCounter';
    this.element.setAttribute('aria-hidden', 'true');
    parent.append(this.element);
    this.every = every;
    this.last = null;
    this.frames = 0;
    this.time = 0;
    this.details = false;
    this.frameMs = [];
    this.cpuMs = [];
  }

  // fps: the frame rate line; details: the FRAME and CPU lines. The details need
  // the rate beside them, so they bring it along even with Show FPS off.
  show({ fps, details }) {
    this.details = details;
    this.element.hidden = !fps && !details;
  }

  // Once per frame, after drawing: how long this frame's work took, in milliseconds.
  work(ms) {
    this.cpuMs.push(ms);
  }

  // Once per frame: now in seconds, scale the resolution share (1 = full).
  frame(now, scale = 1) {
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (!(dt > 0)) return;
    this.frames += 1;
    this.time += dt;
    this.frameMs.push(dt * 1000);
    if (this.time < this.every) return;
    const fps = Math.round(this.frames / this.time);
    const rate = `${fps} FPS${scale < 0.995 ? ` · ${Math.round(scale * 100)}%` : ''}`;
    this.element.textContent = this.details
      ? `${rate}\nFRAME ${median(this.frameMs).toFixed(1)} ms\nCPU ${median(this.cpuMs).toFixed(1)} ms`
      : rate;
    this.frames = 0;
    this.time = 0;
    this.frameMs.length = 0;
    this.cpuMs.length = 0;
    this.element.dataset.level = fps >= 58 ? 'good' : fps >= 45 ? 'ok' : 'slow';
  }

  dispose() {
    this.element.remove();
  }
}
