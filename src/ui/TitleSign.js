import { TITLE_SIGN } from '../config/titleSign.js';
import { TitleSignMotion } from './scrapSign/TitleSignMotion.js';
import { drawChain, drawRing, hintLines, signPicture, tagHeight, tagPicture } from './scrapSign/titlePictures.js';
import { loadFont } from './ScrapSign.js';

// The title screen's hanging sign (owner, 2026-11-17; numbers in
// src/config/titleSign.js): LEAPER sprayed on a steel sign swinging gently on
// two long chains, the menu items as metal tags hanging one below another from it.
//
// Like the end screen's sign, it is drawn on a canvas covering the screen and the
// menu's real buttons (keyboard, gamepad, touch, screen readers) stay in the
// page, each laid over its tag every frame, invisible but for the focus ring.
export class TitleSign {
  // screen: the title screen's element (the canvas goes in first, under the buttons).
  constructor(screen, config = TITLE_SIGN) {
    this.config = config;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'title-sign';
    this.canvas.setAttribute('aria-hidden', 'true');
    screen.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.motion = new TitleSignMotion(config);
    this.buttons = [];
    this.tags = [];
    this.signature = null;
    this.sheet = null;
    this.running = false;
    this.disposed = false;
    this.fontReady = false;
    // Painted once the stencil font is in (it loads with the game).
    this.ready = loadFont().then(() => {
      this.fontReady = true;
      if (!this.disposed) this.sheet = signPicture(config);
      if (this.signature !== null) this.paintTags();
    });
  }

  // The title opened. buttons: its menu's buttons (top to bottom), a tag each.
  show(buttons) {
    this.visible = true;
    this.bind(buttons);
    this.start();
  }

  // The menu's buttons. The same items again keep the sign swinging where it is;
  // other items (a new count, the developer's EXPLORE) hang new tags.
  bind(buttons) {
    this.buttons = [...buttons];
    const items = this.buttons.map((button) => ({
      label: (button.querySelector('span') ?? button).textContent.trim(),
      hint: button.querySelector('small')?.textContent.trim() ?? '',
    }));
    const signature = JSON.stringify(items);
    if (signature !== this.signature) {
      this.signature = signature;
      this.items = items;
      const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this.lines = items.map((item) => hintLines(item.hint, this.config, this.measure()));
      this.motion.setTags(this.lines.map((lines) => tagHeight(lines, this.config)), { still });
      this.tags = [];
      if (this.fontReady) this.paintTags();
    }
    // The tag you move to gets a small knock (only when it is another one).
    this.buttons.forEach((button, i) => {
      const chosen = () => {
        if (this.chosen !== undefined && this.chosen !== i) this.motion.knock(i);
        this.chosen = i;
      };
      button.onfocus = chosen;
      button.onpointerenter = chosen;
    });
  }

  // Measures hint text in the tag's small print.
  measure() {
    const ctx = this.ctx;
    return (text) => {
      ctx.save();
      ctx.font = `12px ${this.config.font}`;
      const width = ctx.measureText(text).width;
      ctx.restore();
      return width;
    };
  }

  paintTags() {
    this.lines = this.items.map((item) => hintLines(item.hint, this.config, this.measure()));
    this.tags = this.items.map((item, i) => tagPicture(item.label, this.lines[i], i === 0, i < this.items.length - 1, this.config));
  }

  hide() {
    this.visible = false;
    this.running = false;
  }

  dispose() {
    this.disposed = true;
    this.hide();
    this.canvas.remove();
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
      last = now;
      this.motion.advance(dt);
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Where the layout sits on this screen: k screen pixels per unit, offset (ox, oy).
  layout() {
    const { view, maxScale } = this.config;
    const width = this.canvas.clientWidth || innerWidth, height = this.canvas.clientHeight || innerHeight;
    const k = Math.min(height / view.height, width / view.minWidth, maxScale);
    // A tall phone screen: a little lower than the top, not lost in the middle.
    const oy = Math.max(0, height - view.height * k) * 0.25;
    return { width, height, k, ox: 0, oy };
  }

  draw() {
    const { width, height, k, ox, oy } = this.layout();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx, { sign, motion, tag } = this.config;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.sheet || this.tags.length !== this.buttons.length) {
      for (const button of this.buttons) button.style.transform = 'translate(-10000px, 0)'; // until it is painted
      return;
    }
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
    const at = this.motion.sign();
    // The chains, up off the screen.
    for (const [hx, hy] of sign.chainHoles) drawChain(ctx, at.left + hx, at.top + hy, sign.x + hx, sign.y + hy - motion.chain);
    // The tags on their rings, and their buttons laid over them.
    const n = (value) => value.toFixed(3); // (CSS rejects numbers written like 1e-7)
    this.motion.chain().forEach(({ x, y, phi, wire, height: th }, i) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-phi);
      // two rings: one through the hole above, one through this tag's hole
      drawRing(ctx, 0, wire * 0.3, 0, wire * 0.32);
      drawRing(ctx, 0, wire * 0.72 + 4, Math.PI / 2, wire * 0.32);
      ctx.drawImage(this.tags[i], -tag.width / 2, wire, tag.width, th);
      ctx.restore();
      const button = this.buttons[i];
      // At least 88 x 44 px to press on a small screen, centred on the tag.
      const bw = Math.max(tag.width * k, 88), bh = Math.max(th * k, 44);
      button.style.width = `${n(bw)}px`;
      button.style.height = `${n(bh)}px`;
      button.style.borderRadius = `${n(9 * k)}px`;
      button.style.transform = `translate(${n(ox + x * k)}px, ${n(oy + y * k)}px) rotate(${n(-phi)}rad) `
        + `translate(${n(-bw / 2)}px, ${n(wire * k - (bh - th * k) / 2)}px)`;
    });
    // The sign over the first tag's rings, and the chains' rings through its holes.
    ctx.drawImage(this.sheet, at.left, at.top, sign.width, sign.height);
    for (const [hx, hy] of sign.chainHoles) drawRing(ctx, at.left + hx, at.top + hy - 6, 0, 8);
  }
}
