// The frame rate in the top right corner (owner, 2026-10-22: "make so I can
// see it on screen"), switched in SETTINGS > GRAPHICS > Show FPS. It shows the
// frames drawn over the last half second, and the resolution share when the
// game is drawing fewer pixels to keep up (AdaptiveResolution).

const STYLE_ID = 'fps-counter-styles';
const STYLES = `
#fpsCounter { position: fixed; top: calc(var(--hud-edge-top, 12px) + 2px); right: var(--hud-edge-right, 12px); z-index: var(--z-hud, 20); padding: 2px 7px; border-radius: 5px; background: #0b0d10b3; color: #9ef0a8; font: 700 12px/1.4 ui-monospace, Consolas, monospace; letter-spacing: .06em; pointer-events: none; font-variant-numeric: tabular-nums; }
#fpsCounter[data-level=ok] { color: #ffd166; }
#fpsCounter[data-level=slow] { color: #ff6b5a; }
`;

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
  }

  set visible(on) {
    this.element.hidden = !on;
  }

  // Once per frame: now in seconds, scale the resolution share (1 = full).
  frame(now, scale = 1) {
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (!(dt > 0)) return;
    this.frames += 1;
    this.time += dt;
    if (this.time < this.every) return;
    const fps = Math.round(this.frames / this.time);
    this.frames = 0;
    this.time = 0;
    this.element.textContent = `${fps} FPS${scale < 0.995 ? ` · ${Math.round(scale * 100)}%` : ''}`;
    this.element.dataset.level = fps >= 58 ? 'good' : fps >= 45 ? 'ok' : 'slow';
  }

  dispose() {
    this.element.remove();
  }
}
