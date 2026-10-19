// The Python arithmetic helpers behind the browser brain (src/brain/junkyard/
// pyMath.js) against values printed by CPython 3.13 itself. The parity tests
// only reach these through the junkyard; this pins the edge cases directly
// (signed zeros, negative numbers, tiny and huge values).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fma, pyFloorDiv, pyHypot, pyMod } from '../src/brain/junkyard/pyMath.js';

const TWO_PI = 6.283185307179586;
// Failure messages must show -0 (String(-0) prints "0").
const show = (value) => (Object.is(value, -0) ? '-0' : String(value));

// --- a % b and a // b ([a, b, a % b, a // b] from CPython) ---------------------------
const DIVISIONS = [
  [-0, 0.5, 0, -0], [-0, -0.5, -0, 0], [0.5, -3, -2.5, -1], [-0.5, 3, 2.5, -1],
  [-7.25, 3, 1.75, -3], [7.25, -3, -1.75, -3], [-0.3, TWO_PI, 5.983185307179586, -1],
  [6.5, TWO_PI, 0.21681469282041377, 1], [-TWO_PI, TWO_PI, 0, -1], [1e-300, -1, -1, -1],
];

test('pyMod and pyFloorDiv follow CPython, signed zeros included', () => {
  for (const [a, b, mod, div] of DIVISIONS) {
    assert.ok(Object.is(pyMod(a, b), mod), `${show(a)} % ${b}: ${show(pyMod(a, b))} vs ${show(mod)}`);
    assert.ok(Object.is(pyFloorDiv(a, b), div), `${show(a)} // ${b}: ${show(pyFloorDiv(a, b))} vs ${show(div)}`);
  }
});

// --- math.hypot ([x, y, math.hypot(x, y)] from CPython) --------------------------------
const HYPOTS = [
  [3, 4, 5], [0, -0, 0], [1e-310, 3e-310, 3.1622776601684e-310], [1e300, 1e300, 1.4142135623730952e300],
  [-31.67422923150786, -47.620075892314105, 57.19203113546381],
  [-12.473010886718278, -41.40332750371077, 43.241317382333825],
  [-52.01818851844921, -11.809078261791022, 53.341787241655354],
  [50.15460517052627, 36.05428217949702, 61.7688892832806],
  [31.81951230065262, -33.36861891716188, 46.10798294753477],
  [4.401600980977619, -26.798082787025976, 27.15715987094455],
  [-39.28025648575573, -47.258004908216385, 61.45126180552975],
  [-34.27194809053002, 51.29707577136725, 61.69243396570909],
];

test('pyHypot is CPython math.hypot to the last bit', () => {
  for (const [x, y, expected] of HYPOTS) assert.ok(Object.is(pyHypot(x, y), expected), `hypot(${x}, ${y}): ${pyHypot(x, y)} vs ${expected}`);
});

// --- math.fma ([x, y, z, math.fma(x, y, z)] from CPython) ------------------------------
const FMAS = [
  [0.1, 10, -1, 5.551115123125783e-17], [1.0000000009313226, 0.9999999990686774, -1, -8.673617379884035e-19],
  [5.92056087801155, 5.519742240641822, 48.071654166874595, 80.75162413352638],
  [-5.518158875653679, -3.42270076860836, 20.31609638610081, 39.2031030111037],
  [4.174104759816924, 6.383670443844249, 60.808120217791895, 87.45422940254478],
  [-7.439071452571407, 1.9053339069578374, 27.47223304263572, 13.298317967769327],
  [0.10716796278747509, -5.79977686366588, -4.225937986376778, -4.847488257477782],
  [-7.391768269222974, 7.8225905501983455, 58.477467229613325, 0.6546906175337118],
];

test('fma rounds a * b + c once, like math.fma', () => {
  for (const [x, y, z, expected] of FMAS) assert.ok(Object.is(fma(x, y, z), expected), `fma(${x}, ${y}, ${z}): ${fma(x, y, z)} vs ${expected}`);
});
