import { TITLE_SIGN } from '../../config/titleSign.js';
import { fbm, lerp, noise2, smooth } from './noise.js';

// The title sign's pictures (owner, 2026-11-17; the look of previews/title-screen.html,
// design A): the steel sign with LEAPER sprayed on, the hanging tags, chain
// links and rings. Each is drawn once on a canvas, in units x textureScale.

const canvasOf = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
};
const SPECK = noise2(91), FLAKE = noise2(97);

// Clean steel, as on the tags: rust only creeping in at the edges and in a few
// spots, and soft grime settling toward the bottom. Returns the canvas and how
// rusty each pixel is (0..255, to wear the paint).
function steelSheet(w, h, S, { seed, rust: rustAmount, edgeRust, grime }) {
  const canvas = canvasOf(w * S, h * S), g = canvas.getContext('2d');
  g.scale(S, S);
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#b4b9bc'); grd.addColorStop(0.55, '#7d8387'); grd.addColorStop(1, '#a6abaf');
  g.fillStyle = grd; g.beginPath(); g.roundRect(0, 0, w, h, 10); g.fill();
  const n = noise2(seed), m = noise2(seed + 1), d = noise2(seed + 2);
  const img = g.getImageData(0, 0, canvas.width, canvas.height), px = img.data, rust = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (!px[i + 3]) continue;
    const x = (p % canvas.width) / S, y = Math.floor(p / canvas.width) / S, edge = Math.min(x, w - x, y, h - y);
    const r = smooth(0.68, 0.78, fbm(n, x / 22, y / 22, 4) + Math.max(0, 1 - edge / 12) * edgeRust) * rustAmount;
    const k = 0.8 + 0.4 * m(x / 1.5, y / 1.5);
    const dirt = 1 - grime * smooth(0.4, 0.75, fbm(d, x / 40, y / 18, 4) + 0.15 * (y / h));
    px[i] *= dirt; px[i + 1] *= dirt; px[i + 2] *= dirt;
    px[i] = lerp(px[i], 86 * k, r); px[i + 1] = lerp(px[i + 1], 36 * k, r); px[i + 2] = lerp(px[i + 2], 20 * k, r);
    rust[p] = r * 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#00000066'; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, 9); g.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0); // (the paint and hardware set their own scale)
  return { canvas, rust, ox: seed * 100, oy: 0 };
}

// Paint on a sheet: draw(g) in units, then wear it (speckle, flakes, less over rust).
// shift: where on the flake pattern (so two coats don't wear in the same spots).
function paintOn(sheet, S, draw, { wear = 1, shift = [0, 0] } = {}) {
  const p = canvasOf(sheet.canvas.width, sheet.canvas.height), g = p.getContext('2d');
  g.scale(S, S);
  draw(g);
  const img = g.getImageData(0, 0, p.width, p.height), px = img.data;
  for (let i = 0, k = 0; i < px.length; i += 4, k++) {
    if (!px[i + 3]) continue;
    const x = (k % p.width) / S + sheet.ox + shift[0], y = Math.floor(k / p.width) / S + sheet.oy + shift[1];
    let a = 0.82 + 0.18 * SPECK(x / 1.6, y / 1.6);
    a *= 1 - 0.85 * wear * smooth(0.68, 0.74, fbm(FLAKE, x / 14, y / 14, 3));
    a *= 1 - 0.22 * sheet.rust[k] / 255;
    px[i + 3] *= a;
  }
  g.putImageData(img, 0, 0);
  sheet.canvas.getContext('2d').drawImage(p, 0, 0);
}

// Spray-painted words, centred: grime under them, overspray, paint.
function spray(g, text, x, y, { size, colour, font, grime = 0, spacing = 0, maxWidth = Infinity }) {
  g.save();
  g.font = `${size}px ${font}`;
  g.textAlign = 'center';
  if (spacing) g.letterSpacing = `${spacing}px`;
  while (g.measureText(text).width > maxWidth && size > 8) g.font = `${size -= 2}px ${font}`;
  if (grime) {
    g.fillStyle = '#000'; g.shadowColor = '#000'; g.globalAlpha = grime; g.shadowBlur = size * 0.08;
    g.fillText(text, x + size * 0.015, y + size * 0.025);
  }
  g.fillStyle = colour; g.shadowColor = colour;
  g.globalAlpha = 0.22; g.shadowBlur = size * 0.13; g.fillText(text, x, y);
  g.globalAlpha = 0.95; g.shadowBlur = Math.max(1.5, size * 0.02); g.fillText(text, x, y);
  g.restore();
}

// The finished sign: steel, LEAPER and the tagline, rivets and holes.
export function signPicture(config = TITLE_SIGN) {
  const { sign, words, textureScale: S, font } = config, W = sign.width, H = sign.height;
  const sheet = steelSheet(W, H, S, sign);
  paintOn(sheet, S, (g) => spray(g, words.name, W / 2, words.nameY,
    { size: words.nameSize, colour: words.nameColour, font, grime: words.nameGrime, spacing: 6, maxWidth: words.maxWidth }), { wear: words.nameWear });
  paintOn(sheet, S, (g) => spray(g, words.tagline, W / 2, words.taglineY,
    { size: words.taglineSize, colour: words.taglineColour, font, spacing: 1, maxWidth: words.maxWidth }),
  { wear: words.taglineWear, shift: [53, 29] }); // small words: barely worn, so they read
  const g = sheet.canvas.getContext('2d');
  g.save(); g.scale(S, S);
  for (const [x, y] of sign.rivets) {
    const grd = g.createRadialGradient(x - 1.8, y - 1.8, 1, x, y, 7);
    grd.addColorStop(0, '#9a8e86'); grd.addColorStop(0.5, '#5a4034'); grd.addColorStop(1, '#1e1410');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  }
  for (const [x, y] of [...sign.chainHoles, sign.tagHole]) {
    g.fillStyle = '#4a2414'; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#050403'; g.beginPath(); g.arc(x, y, 4.8, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  return sheet.canvas;
}

// A menu item's hint in lines that fit on its tag (upper case, no full stop).
export function hintLines(hint, config = TITLE_SIGN, measure = null) {
  if (!hint) return [];
  const words = hint.toUpperCase().replace(/\.$/, '').split(/\s+/), lines = [];
  const width = measure ?? ((text) => text.length * 7.2);
  for (const word of words) {
    const line = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (lines.length && width(line) <= config.tag.width - 20) lines[lines.length - 1] = line;
    else lines.push(word);
  }
  return lines;
}

// A tag's height: taller by 14 a line for a hint.
export const tagHeight = (lines, config = TITLE_SIGN) => (lines.length ? 64 + 14 * lines.length : config.tag.height);

// A hanging metal tag: hazard yellow for the first item, bare steel for the
// rest, a little rust at the edges and in spots, the name stamped on and any
// hint under it. holeBottom: the next tag hangs from it.
export function tagPicture(label, lines, primary, holeBottom, config = TITLE_SIGN) {
  const { textureScale: S, font } = config, tw = config.tag.width, th = tagHeight(lines, config);
  const c = canvasOf(tw * S, th * S), g = c.getContext('2d');
  g.scale(S, S);
  const grd = g.createLinearGradient(0, 0, tw, th);
  if (primary) { grd.addColorStop(0, '#d29a1c'); grd.addColorStop(0.55, '#a8770e'); grd.addColorStop(1, '#c48d18'); }
  else { grd.addColorStop(0, '#b4b9bc'); grd.addColorStop(0.55, '#7d8387'); grd.addColorStop(1, '#a6abaf'); }
  g.fillStyle = grd; g.beginPath(); g.roundRect(0, 0, tw, th, 9); g.fill();
  const n = noise2(primary ? 5 : 6 + label.length), m = noise2(15), img = g.getImageData(0, 0, c.width, c.height), px = img.data;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (!px[i + 3]) continue;
    const x = (p % c.width) / S, y = Math.floor(p / c.width) / S, edge = Math.min(x, tw - x, y, th - y);
    // (owner, 2026-11-17: less rust than the end screen's tags, so the words read)
    const r = smooth(0.68, 0.78, fbm(n, x / 16, y / 16, 4) + Math.max(0, 1 - edge / 9) * 0.12) * 0.6, k = 0.8 + 0.4 * m(x / 1.5, y / 1.5);
    px[i] = lerp(px[i], 86 * k, r); px[i + 1] = lerp(px[i + 1], 36 * k, r); px[i + 2] = lerp(px[i + 2], 20 * k, r);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#00000066'; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, tw - 2, th - 2, 8); g.stroke();
  g.fillStyle = '#060504';
  g.beginPath(); g.arc(tw / 2, 10, 4.5, 0, Math.PI * 2); g.fill();
  if (holeBottom) { g.beginPath(); g.arc(tw / 2, th - config.tag.bottomHole, 3.8, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center';
  const ink = primary ? '#1f1500' : '#15181a', y0 = lines.length ? 38 : th / 2 + 8;
  let size = 27;
  g.font = `${size}px ${font}`; g.letterSpacing = '1.5px';
  while (g.measureText(label).width > tw - 24 && size > 12) g.font = `${size -= 1}px ${font}`;
  g.fillStyle = '#ffffff55'; g.fillText(label, tw / 2 + 0.8, y0 + 0.8);
  g.fillStyle = ink; g.fillText(label, tw / 2, y0);
  g.font = `12px ${font}`; g.letterSpacing = '0px';
  lines.forEach((line, i) => {
    g.fillStyle = '#ffffff45'; g.fillText(line, tw / 2 + 0.6, 57.6 + i * 14);
    g.fillStyle = ink; g.fillText(line, tw / 2, 57 + i * 14);
  });
  return c;
}

// A straight chain from (x0, y0) to (x1, y1), links alternating face on and edge on.
export function drawChain(ctx, x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0), angle = Math.atan2(y1 - y0, x1 - x0);
  for (let s = 0, n = 0; s < len; s += 15, n++) {
    ctx.save();
    ctx.translate(x0 + (x1 - x0) * s / len, y0 + (y1 - y0) * s / len);
    ctx.rotate(angle);
    if (n % 2 === 0) {
      for (const [w, c] of [[3.6, '#1b1c1e'], [2.2, '#7e8287']]) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); ctx.stroke(); }
    } else {
      ctx.fillStyle = '#1b1c1e'; ctx.beginPath(); ctx.roundRect(-11, -2.8, 22, 5.6, 2.8); ctx.fill();
      ctx.fillStyle = '#6e7276'; ctx.beginPath(); ctx.roundRect(-10, -1.8, 20, 3.6, 1.8); ctx.fill();
    }
    ctx.restore();
  }
}

// A steel ring through a hole, r tall, turned by angle.
export function drawRing(ctx, x, y, angle, r = 7) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  for (const [w, c] of [[3.6, '#1b1c1e'], [2.2, '#80858a']]) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
