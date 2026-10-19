// Exact Python / NumPy arithmetic for the frozen brain port.
//
// The browser brain must see the same numbers the Python server computes, down
// to the last bit where a yes/no decision depends on them (is this raster cell
// solid? did the leg touch?). Python and NumPy round a few things differently
// from plain JavaScript, so each helper here copies one of those rules exactly.

// --- float32 ---------------------------------------------------------------
// NumPy float32 maths rounds every result to float32. Math.fround of a double
// result is the same, because doubles are exact enough for one +, -, * or /.
export const f32 = Math.fround;

// --- Python's % and // for floats -------------------------------------------
// JavaScript's % keeps the sign of the left number; Python's follows the right.
// This is CPython's float_rem / float_divmod, so angles wrap identically.
export function pyMod(a, b) {
  let mod = a % b;
  if (mod !== 0) {
    if ((b < 0) !== (mod < 0)) mod += b;
  } else {
    mod = b < 0 ? -0 : 0;
  }
  return mod;
}

export function pyFloorDiv(a, b) {
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod !== 0 && (b < 0) !== (mod < 0)) div -= 1;
  // A zero quotient takes the sign of a / b (CPython's copysign(0.0, vx / wx)).
  if (div === 0) return a / b < 0 || Object.is(a / b, -0) ? -0 : 0;
  let floorDiv = Math.floor(div);
  if (div - floorDiv > 0.5) floorDiv += 1;
  return floorDiv;
}

// NumPy float32 remainder (np.remainder on float32 arrays): Python's rule with
// every step rounded to float32.
export function pyMod32(a, b) {
  let mod = f32(a % b);
  if (mod !== 0) {
    if ((b < 0) !== (mod < 0)) mod = f32(mod + b);
  } else {
    mod = b < 0 ? -0 : 0;
  }
  return mod;
}

// --- Exact products and sums (double-double building blocks) -----------------
// Split a double into two halves that multiply without rounding (Veltkamp).
const SPLITTER = 134217729; // 2^27 + 1

function twoProduct(a, b) {
  const p = a * b;
  let t = SPLITTER * a;
  const ah = t - (t - a), al = a - ah;
  t = SPLITTER * b;
  const bh = t - (t - b), bl = b - bh;
  const err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return [p, err];
}

function twoSum(a, b) {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

// Bit access for stepping one unit in the last place.
const bits = new DataView(new ArrayBuffer(8));

function nextToward(x, positive) {
  if (x === 0) return positive ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bits.setFloat64(0, x);
  let raw = bits.getBigUint64(0);
  raw += (x > 0) === positive ? 1n : -1n;
  bits.setBigUint64(0, raw);
  return bits.getFloat64(0);
}

function lowestBitIsZero(x) {
  bits.setFloat64(0, x);
  return (bits.getUint32(4) & 1) === 0;
}

// fma(a, b, c) = a * b + c rounded once (Boldo & Melquiond: exact product, exact
// sum, then "round to odd" on the small parts before the final rounding).
// OpenBLAS's dot product uses hardware FMA, so NumPy's 2-vector norms need it.
export function fma(a, b, c) {
  const [uh, ul] = twoProduct(a, b);
  const [th, tl] = twoSum(c, uh);
  let [v, e] = twoSum(tl, ul);
  if (e !== 0 && lowestBitIsZero(v)) v = nextToward(v, e > 0);
  return th + v;
}

// np.linalg.norm of a float64 2-vector: sqrt(dot) where dot = fma(z, z, x*x).
export function norm64(x, z) {
  return Math.sqrt(fma(z, z, x * x));
}

// np.linalg.norm of a float32 2-vector: float32 squares and sum, float32 sqrt.
export function norm32(x, z) {
  return f32(Math.sqrt(f32(f32(x * x) + f32(z * z))));
}

// --- CPython math.hypot (vector_norm in Modules/mathmodule.c) ------------------
// Lossless scaling and squaring, compensated sums, then one correction step.
const DBL_MIN = 2 ** -1022; // smallest normal double

function frexpExponent(x) {
  bits.setFloat64(0, x);
  const exponent = (bits.getUint32(0) >>> 20) & 0x7ff;
  if (exponent === 0) return frexpExponent(x * 2 ** 64) - 64; // subnormal
  return exponent - 1022;
}

export function pyHypot(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (Number.isNaN(ax) || Number.isNaN(ay)) {
    return ax === Infinity || ay === Infinity ? Infinity : NaN;
  }
  const max = Math.max(ax, ay);
  if (max === Infinity) return Infinity;
  if (max === 0) return 0;
  const exponent = frexpExponent(max);
  // Subnormal inputs: 2 ** -exponent would overflow, so CPython first scales
  // both values up by DBL_MIN (exact) and scales the answer back down.
  if (exponent < -1023) return DBL_MIN * pyHypot(ax / DBL_MIN, ay / DBL_MIN);
  const scale = 2 ** -exponent;
  let csum = 1, frac1 = 0, frac2 = 0;
  for (const value of [ax, ay]) {
    const v = value * scale;
    const [hi, lo] = twoProduct(v, v);
    const [sum, err] = [csum + hi, (csum - (csum + hi)) + hi];
    csum = sum;
    frac1 += lo;
    frac2 += err;
  }
  let h = Math.sqrt(csum - 1 + (frac1 + frac2));
  const [hi, lo] = twoProduct(-h, h);
  const sum = csum + hi;
  frac2 += (csum - sum) + hi;
  csum = sum;
  frac1 += lo;
  const correction = csum - 1 + (frac1 + frac2);
  h += correction / (2 * h);
  return h / scale;
}

// np.clip for one number (NaN passes through, like NumPy).
export function clip(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
