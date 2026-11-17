import { fbm, lerp, noise2, smooth } from './noise.js';

// The scrap sign's bare sheet: grey steel showing through, red-brown rust
// patches growing from the edges and the chain holes, a little rust running
// down from the top, pitting, light from above and a folded rim. The painted
// middle rusted less, which keeps the words readable.
//
// Plain math (no page), so it runs in a worker (plateWorker.js); about half a
// second at full size. Returns RGBA pixels and how rusty each pixel is (0..255,
// used to wear the paint).
//   width, height: the sheet in units; scale: texture pixels per unit;
//   holes: [[x, y], ...] the chain holes (rust bleeds down from them);
//   offset: [x, y] where on the endless rust pattern this sheet is cut from
//   (so several sheets don't match); middle: the less-rusty painted area
//   { x, y, rx, ry } (default: the end screen sign's words).
export function rustPlatePixels({ width, height, scale, holes, offset = [0, 0], middle: area = { x: width / 2, y: 175, rx: 290, ry: 105 } }) {
  const [ox, oy] = offset;
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const pixels = new Uint8ClampedArray(w * h * 4), rust = new Uint8Array(w * h);
  const nA = noise2(11), nB = noise2(23), nC = noise2(37), nD = noise2(41), nE = noise2(53), nF = noise2(67), nG = noise2(79);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = px / scale, y = py / scale, edgeDistance = Math.min(x, width - x, y, height - y);
      const patch = fbm(nA, (x + ox) / 150, (y + oy) / 150, 5);
      const edge = Math.max(0, 1 - edgeDistance / 70) * 0.2;
      let bleed = 0;
      for (const [hx, hy] of holes) {
        const dy = y - hy;
        if (dy > -8) {
          const dx = x - hx + (nG((x + ox) / 20, (y + oy) / 40) - 0.5) * 18;
          bleed += Math.exp(-dx * dx / 140) * Math.exp(-Math.max(0, dy) / 160) * 0.5;
        }
      }
      const streak = smooth(0.6, 0.78, fbm(nB, (x + ox) / 8, (y + oy) / 140, 3)) * Math.max(0, 1 - y / 200) * 0.18;
      const middle = Math.exp(-(((x - area.x) / area.rx) ** 2) - (((y - area.y) / area.ry) ** 2)) * 0.13;
      const amount = smooth(0.47, 0.6, patch + edge + bleed + streak - middle);
      rust[py * w + px] = amount * 255;
      const grain = fbm(nC, (x + ox) / 60, (y + oy) / 1.7, 2), d = nD((x + ox) / 2.2, (y + oy) / 2.2);
      // Steel: grey, slightly cool, brushed sideways; stained just outside the rust.
      let sr = 80 + (grain - 0.5) * 34 + (d - 0.5) * 16, sg = sr + 3, sb = sr + 6;
      const halo = Math.max(0, 1 - Math.abs(amount - 0.25) / 0.25) * 0.4;
      sr *= 1 - halo * 0.7; sg *= 1 - halo * 0.85; sb *= 1 - halo;
      // Rust: red-brown from dark to light (owner, 2026-11-17: lighter than the
      // first, still not yellow).
      const t = smooth(0.3, 0.72, fbm(nE, (x + ox) / 22, (y + oy) / 22, 4));
      let rr, rg, rb;
      if (t < 0.5) { const k = t * 2; rr = lerp(66, 112, k); rg = lerp(38, 60, k); rb = lerp(28, 40, k); }
      else { const k = (t - 0.5) * 2; rr = lerp(112, 140, k); rg = lerp(60, 76, k); rb = lerp(40, 48, k); }
      const lit = 0.84 + d * 0.32;
      rr *= lit; rg *= lit; rb *= lit;
      if (d > 0.78) { rr *= 0.78; rg *= 0.76; rb *= 0.76; } // crust
      let r = lerp(sr, rr, amount), g = lerp(sg, rg, amount), b = lerp(sb, rb, amount);
      if (nF((x + ox) / 1.3, (y + oy) / 1.3) > 0.83 && amount > 0.2) { r *= 0.5; g *= 0.5; b *= 0.5; } // pits
      let light = 1.08 - 0.26 * (y / height);
      if (edgeDistance < 2) light *= 0.4;
      else if (edgeDistance < 5) light *= y < 5 ? 1.45 : 1.22;
      else if (edgeDistance < 10) light *= 0.72;
      const i = (py * w + px) * 4;
      pixels[i] = r * light; pixels[i + 1] = g * light; pixels[i + 2] = b * light; pixels[i + 3] = 255;
    }
  }
  return { width: w, height: h, pixels, rust };
}
