import { SCRAP_SIGN } from '../config/scrapSign.js';
import { ScrapSignPhysics } from './scrapSign/ScrapSignPhysics.js';
import { rustPlatePixels } from './scrapSign/rustPlate.js';
import { fbm, noise2, smooth, lerp } from './scrapSign/noise.js';
import fontUrl from '../../assets/fonts/black-ops-one.woff2?url';

// The end screen's scrap sign (owner, 2026-11-17; numbers in
// src/config/scrapSign.js): a rusty steel sheet with YOU WIN / YOU LOSE, a line
// and the fight's numbers spray-painted on, dropped from above on two chains,
// with the menu items as metal tags hanging under it.
//
// The sheet, chains and tags are drawn on a canvas covering the screen. The
// menu's real buttons (keyboard, gamepad, touch, screen readers) stay in the
// page: each is laid over its tag every frame, invisible but for the focus
// ring. The screen's heading, line and numbers stay in the page too, for
// screen readers, but out of sight.

const FONT_FACE = 'Black Ops One';
// The sign's short names for the end screen's numbers.
const SHORT = Object.freeze({ 'DAMAGE DEALT': 'DEALT', 'DAMAGE TAKEN': 'TAKEN', 'KNEES BROKEN': 'KNEES' });

// The stencil font, once per page (the game's own copy: assets/fonts/). The
// title's sign uses it too.
let fontLoad = null;
export function loadFont() {
  if (!fontLoad) {
    fontLoad = (async () => {
      if (typeof FontFace === 'undefined' || !document.fonts) return;
      const face = new FontFace(FONT_FACE, `url(${fontUrl})`);
      document.fonts.add(await face.load());
    })().catch((error) => console.warn('[scrap sign] font did not load; using a fallback', error));
  }
  return fontLoad;
}

// The bare rusty sheet, made in a worker (main thread if workers fail).
function makePlate(config) {
  const job = { width: config.size.width, height: config.size.height, scale: config.textureScale,
    holes: config.chainHoles.map((hole) => [...hole]) };
  const draw = ({ width, height, pixels, rust }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    return { canvas, rust };
  };
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./scrapSign/plateWorker.js', import.meta.url), { type: 'module', name: 'scrap-sign' });
    } catch {
      resolve(draw(rustPlatePixels(job)));
      return;
    }
    worker.onmessage = ({ data }) => { worker.terminate(); resolve(draw(data)); };
    worker.onerror = (event) => {
      event.preventDefault?.();
      worker.terminate();
      resolve(draw(rustPlatePixels(job)));
    };
    worker.postMessage(job);
  });
}

// Rivets and the holes, over the bare sheet.
function hardware(g, config, tagHoles) {
  for (const [x, y] of config.rivets) {
    const grd = g.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
    grd.addColorStop(0, '#9a8e86'); grd.addColorStop(0.5, '#5a4034'); grd.addColorStop(1, '#1e1410');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
  }
  for (const [x, y] of [...config.chainHoles, ...tagHoles]) {
    g.fillStyle = '#4a2414'; g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#050403'; g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill();
  }
}

// The finished sheet for one fight: the bare plate, its rivets and holes, and
// the spray paint, worn off in flakes and where the rust is thick.
//   words: { win, heading, line, stats: [{ label, value }] }
function paintSign(plate, words, config, tagHoles) {
  const { width: W, height: H } = config.size, S = config.textureScale;
  const paint = document.createElement('canvas');
  paint.width = W * S; paint.height = H * S;
  const g = paint.getContext('2d');
  g.scale(S, S);
  const main = words.win ? config.paint.win : config.paint.lose, cream = config.paint.words;
  const font = (px) => `${px}px ${config.font}`;
  g.textAlign = 'center';
  let size = 124;
  g.font = font(size);
  while (g.measureText(words.heading).width > 680 && size > 40) g.font = font(size -= 2);
  const textWidth = g.measureText(words.heading).width, baseline = 152;
  // Grime under the letters (keeps them readable on rust), overspray, paint.
  g.fillStyle = '#000'; g.shadowColor = '#000'; g.globalAlpha = 0.6; g.shadowBlur = 10;
  g.fillText(words.heading, W / 2 + 2, baseline + 3);
  g.fillStyle = main; g.shadowColor = main;
  g.globalAlpha = 0.22; g.shadowBlur = 16; g.fillText(words.heading, W / 2, baseline);
  g.globalAlpha = 0.95; g.shadowBlur = 2.5; g.fillText(words.heading, W / 2, baseline);
  if (!words.win) { // the red paint ran
    g.shadowBlur = 1.5; g.strokeStyle = main; g.lineCap = 'round';
    for (const [f, len] of [[0.04, 34], [0.15, 62], [0.27, 22], [0.44, 78], [0.57, 30], [0.71, 52], [0.86, 40], [0.97, 26]]) {
      const x = W / 2 - textWidth / 2 + textWidth * f, w = 4 + (len % 3), lean = (len % 5) * 0.3;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, baseline - 8); g.lineTo(x + lean, baseline + len); g.stroke();
      g.beginPath(); g.arc(x + lean, baseline + len + 1, w * 0.75, 0, Math.PI * 2); g.fill();
    }
  }
  const shift = words.win ? 0 : 6; // a little lower under the drips
  g.globalAlpha = 0.95; g.shadowBlur = 1.5; g.shadowColor = cream; g.fillStyle = cream; g.strokeStyle = cream;
  g.font = font(22); g.fillText(words.line, W / 2, 200 + shift);
  const stats = words.stats, boxWidth = 112, gap = 26, top = 224 + shift;
  const left = W / 2 - (stats.length * boxWidth + (stats.length - 1) * gap) / 2;
  g.lineWidth = 2; g.setLineDash([6, 5]);
  stats.forEach(({ label, value }, i) => {
    const x = left + i * (boxWidth + gap);
    g.globalAlpha = 0.7; g.strokeRect(x, top, boxWidth, 56); g.globalAlpha = 0.95;
    g.font = font(13); g.fillText(SHORT[label] ?? label, x + boxWidth / 2, top + 19);
    g.font = font(26); g.fillText(value, x + boxWidth / 2, top + 47);
  });
  // Wear: speckle, flakes, and less paint where the rust is thick.
  const img = g.getImageData(0, 0, paint.width, paint.height), px = img.data, speck = noise2(91), flake = noise2(97);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (!px[i + 3]) continue;
    const x = (p % paint.width) / S, y = Math.floor(p / paint.width) / S;
    let a = 0.82 + 0.18 * speck(x / 1.6, y / 1.6);
    a *= 1 - 0.85 * smooth(0.68, 0.74, fbm(flake, x / 14, y / 14, 3));
    a *= 1 - 0.22 * (plate.rust[p] / 255);
    px[i + 3] *= a;
  }
  g.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = paint.width; out.height = paint.height;
  const o = out.getContext('2d');
  o.drawImage(plate.canvas, 0, 0);
  o.save(); o.scale(S, S); hardware(o, config, tagHoles); o.restore();
  o.drawImage(paint, 0, 0);
  return out;
}

// A hanging metal tag with a menu item's name stamped on it: the first item's
// is painted hazard yellow, the rest bare steel; rust creeps in from the edges.
function tagPicture(label, primary, config) {
  const { width: tw, height: th } = config.tag, S = config.textureScale;
  const c = document.createElement('canvas');
  c.width = tw * S; c.height = th * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  const grd = g.createLinearGradient(0, 0, tw, th);
  if (primary) { grd.addColorStop(0, '#d29a1c'); grd.addColorStop(0.55, '#a8770e'); grd.addColorStop(1, '#c48d18'); }
  else { grd.addColorStop(0, '#b4b9bc'); grd.addColorStop(0.55, '#7d8387'); grd.addColorStop(1, '#a6abaf'); }
  g.fillStyle = grd; g.beginPath(); g.roundRect(0, 0, tw, th, 9); g.fill();
  const n = noise2(primary ? 5 : 6), m = noise2(primary ? 15 : 16), img = g.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (!px[i + 3]) continue;
    const x = (p % c.width) / S, y = Math.floor(p / c.width) / S, edge = Math.min(x, tw - x, y, th - y);
    const r = smooth(0.58, 0.7, fbm(n, x / 16, y / 16, 4) + Math.max(0, 1 - edge / 12) * 0.14) * 0.85;
    const k = 0.8 + 0.4 * m(x / 1.5, y / 1.5);
    px[i] = lerp(px[i], 86 * k, r); px[i + 1] = lerp(px[i + 1], 36 * k, r); px[i + 2] = lerp(px[i + 2], 20 * k, r);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#00000066'; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, tw - 2, th - 2, 8); g.stroke();
  g.fillStyle = '#060504'; g.beginPath(); g.arc(tw / 2, 11, 5, 0, Math.PI * 2); g.fill();
  g.textAlign = 'center';
  let size = 22;
  g.font = `${size}px ${config.font}`;
  while (g.measureText(label).width > tw - 24 && size > 10) g.font = `${size -= 1}px ${config.font}`;
  g.fillStyle = '#ffffff40'; g.fillText(label, tw / 2 + 0.8, 46.8);
  g.fillStyle = primary ? '#2a1c02' : '#25292c'; g.fillText(label, tw / 2, 46);
  return c;
}

export class ScrapSign {
  // screen: the end screen's element (the canvas goes in first, under the buttons).
  constructor(screen, config = SCRAP_SIGN) {
    this.config = config;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scrap-sign';
    this.canvas.setAttribute('aria-hidden', 'true');
    screen.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.physics = new ScrapSignPhysics(config);
    this.buttons = [];
    this.tagPictures = [];
    this.sheet = null;
    this.key = null;
    this.running = false;
    this.disposed = false;
    // Made ahead, while the game loads, so the end screen never waits.
    this.ready = Promise.all([makePlate(config), loadFont()]).then(([plate]) => { this.plate = plate; });  }

  // The end screen opened. words: { win, heading, line, stats }. buttons: the
  // menu's buttons, one tag each. key: the fight's result: the same key again
  // (the screen redrawn) keeps the sign where it hangs instead of dropping it again.
  async show(words, buttons, key) {
    this.visible = true;
    this.bind(buttons); // (forgets the key if the number of tags changed)
    if (key === this.key && (this.sheet || this.painting)) { this.start(); return; }
    this.key = key;
    this.sheet = null; // nothing is drawn until the paint is dry
    this.painting = true;
    await this.ready;
    this.painting = false;
    if (this.disposed || this.key !== key || !this.visible) return;
    const holes = this.physics.tagHoles;
    this.sheet = paintSign(this.plate, words, this.config, holes);
    const { k, restY } = this.layout();
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.physics.drop({ top: -restY / k, still });
    this.start();
  }

  // The menu's buttons and a tag picture for each.
  bind(buttons) {
    this.buttons = [...buttons];
    if (this.buttons.length !== this.physics.tags.length) {
      this.physics.setTags(this.buttons.length);
      this.sheet = null;
      this.key = null; // repaint (the tag holes moved) and drop again
    }
    this.tagPictures = this.buttons.map((button, i) => tagPicture(button.textContent.trim(), i === 0, this.config));
    this.buttons.forEach((button, i) => {
      button.onfocus = () => this.physics.nudgeTag(i, 0.5); // a small jangle when chosen
    });
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
      if (this.sheet) this.physics.advance(dt);
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Where the sign sits on this screen: k screen pixels per unit, the sheet's
  // resting middle at (restX, restY).
  layout() {
    const { fit, maxScale, restHeight, size } = this.config;
    const width = this.canvas.clientWidth || innerWidth, height = this.canvas.clientHeight || innerHeight;
    const k = Math.min(width / fit.width, height / fit.height, maxScale);
    const restY = Math.max(height * restHeight, (size.height / 2 + 24) * k);
    return { width, height, k, restX: width / 2, restY };
  }

  draw() {
    const { width, height, k, restX, restY } = this.layout();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx, p = this.physics, { size, tag } = this.config;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.sheet) {
      for (const button of this.buttons) button.style.transform = 'translate(-10000px, 0)'; // until it hangs
      return;
    }
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * restX, dpr * restY);
    // Chains (behind the sheet), drawn up past the screen's top.
    p.attach.forEach((at, i) => this.drawChain(this.chainPoints(i, at, -restY / k)));
    // Tags on their wires.
    p.tags.forEach((t, i) => {
      const [px, py] = p.point(p.pivots[i]);
      ctx.save(); ctx.translate(px, py); ctx.rotate(-t.phi);
      ctx.strokeStyle = '#2a2b2d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, tag.wire); ctx.stroke();
      ctx.strokeStyle = '#8b9095'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, tag.wire); ctx.stroke();
      if (this.tagPictures[i]) ctx.drawImage(this.tagPictures[i], -tag.width / 2, tag.wire - 11, tag.width, tag.height);
      ctx.restore();
      // Its button, laid over it.
      const button = this.buttons[i];
      if (button) {
        // At least 88 x 44 px to press on a small screen, centred on the tag.
        const bw = Math.max(tag.width * k, 88), bh = Math.max(tag.height * k, 44);
        button.style.width = `${bw}px`;
        button.style.height = `${bh}px`;
        button.style.borderRadius = `${9 * k}px`;
        // (Fixed decimals: CSS rejects numbers written like 1e-7.)
        const n = (value) => value.toFixed(3);
        button.style.transform = `translate(${n(restX + px * k)}px, ${n(restY + py * k)}px) rotate(${n(-t.phi)}rad) `
          + `translate(${n(-bw / 2)}px, ${n((tag.wire - 11) * k - (bh - tag.height * k) / 2)}px)`;
      }
    });
    // The sheet.
    ctx.save(); ctx.translate(p.body.x, p.body.y); ctx.rotate(p.body.a);
    ctx.drawImage(this.sheet, -size.width / 2, -size.height / 2, size.width, size.height);
    ctx.restore();
    // Each chain's last link passes through its hole, in front of the sheet.
    p.attach.forEach((at, i) => {
      const [px, py] = p.point(at), [ax, ay] = p.anchors[i];
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(ay - py, ax - px));
      for (const [lineWidth, colour] of [[4.6, '#1b1c1e'], [2.8, '#80858a']]) {
        ctx.lineWidth = lineWidth; ctx.strokeStyle = colour;
        ctx.beginPath(); ctx.ellipse(9, 0, 15, 7, 0, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
      }
      ctx.restore();
    });
  }

  // A chain from its hole up to where it hangs from (and on past the screen's
  // top); while slack it wobbles sideways.
  chainPoints(i, at, top) {
    const p = this.physics, [px, py] = p.point(at), [ax, ay] = p.anchors[i];
    const slack = Math.max(0, p.lengths[i] - Math.hypot(px - ax, py - ay));
    const side = i ? 1 : -1, wobble = Math.min(46, slack * 0.25) * (side + Math.sin(p.time * 11 + i * 2) * 0.6);
    const mx = (px + ax) / 2 + wobble, my = (py + ay) / 2, points = [];
    for (let s = 0; s <= 40; s++) {
      const t = s / 40, u = 1 - t;
      points.push([u * u * px + 2 * u * t * mx + t * t * ax, u * u * py + 2 * u * t * my + t * t * ay]);
    }
    if (ay > top - 20) points.push([ax, top - 40]); // the anchor is on screen: carry on up
    return points;
  }

  drawChain(points) {
    const ctx = this.ctx, PITCH = 19;
    let carry = 0, n = 0;
    for (let k = 1; k < points.length; k++) {
      const [x0, y0] = points[k - 1], [x1, y1] = points[k], seg = Math.hypot(x1 - x0, y1 - y0), angle = Math.atan2(y1 - y0, x1 - x0);
      let s = carry;
      while (s < seg) {
        const t = s / seg;
        ctx.save(); ctx.translate(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); ctx.rotate(angle);
        if (n % 2 === 0) { // a link seen face on
          for (const [lineWidth, colour] of [[4.2, '#1b1c1e'], [2.6, '#7e8287']]) {
            ctx.lineWidth = lineWidth; ctx.strokeStyle = colour;
            ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.lineWidth = 1; ctx.strokeStyle = '#c3c7ca';
          ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.5, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
        } else { // edge on
          ctx.fillStyle = '#1b1c1e'; ctx.beginPath(); ctx.roundRect(-14, -3.4, 28, 6.8, 3.4); ctx.fill();
          ctx.fillStyle = '#6e7276'; ctx.beginPath(); ctx.roundRect(-13, -2.2, 26, 4.4, 2.2); ctx.fill();
          ctx.fillStyle = '#b0b4b8'; ctx.fillRect(-10, -1.6, 20, 1);
        }
        ctx.restore();
        s += PITCH; n++;
      }
      carry = s - seg;
    }
  }
}
