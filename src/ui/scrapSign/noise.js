// Small, seeded noise helpers for the scrap sign's painted textures (rust,
// worn paint). Plain math, so the rust can be made in a worker.

// Smooth value noise in 2D from a seed: (x, y) -> 0..1.
export function noise2(seed) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const value = new Float32Array(256), perm = new Uint16Array(512);
  for (let i = 0; i < 256; i++) { value[i] = random(); perm[i] = i; }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = value[perm[X + perm[Y]]], b = value[perm[X + 1 + perm[Y]]];
    const c = value[perm[X + perm[Y + 1]]], d = value[perm[X + 1 + perm[Y + 1]]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Layers of noise, each half as strong and twice as fine: 0..1.
export function fbm(noise, x, y, octaves) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a, b, t) => a + (b - a) * t;
