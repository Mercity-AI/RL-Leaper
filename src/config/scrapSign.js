// The end screen's scrap sign (owner, 2026-11-17): a rusty steel sheet with the
// result spray-painted on it drops from above the screen on two chains, catches
// with a jolt, sways left and right for about two seconds and settles a little
// crooked. RESTART and TITLE are metal tags hanging under it on wires.
// Design preview: previews/scrap-sign-drop.html (through `pnpm dev`).
// Drawn by src/ui/ScrapSign.js; moved by src/ui/scrapSign/ScrapSignPhysics.js.
//
// Units: "sign units", the 1280 x 720 preview's pixels (the sheet is 780 x 320,
// about 2 m, so 390 units ≈ 1 m). The game scales them to the screen.

export const SCRAP_SIGN = Object.freeze({
  // The sheet and where things sit on it (units from its top-left corner).
  size: Object.freeze({ width: 780, height: 320 }),
  chainHoles: Object.freeze([Object.freeze([90, 18]), Object.freeze([690, 18])]),
  tagHoles: Object.freeze([Object.freeze([220, 302]), Object.freeze([560, 302])]),
  rivets: Object.freeze([[24, 296], [756, 296], [390, 300], [24, 160], [756, 160]].map((r) => Object.freeze(r))),
  // Texture detail: texture pixels per unit (2 keeps it sharp on big screens).
  textureScale: 2,

  // Gravity in units/s² (9.8 m/s² at 390 units a metre).
  gravity: 3800,
  // The chains: each a stiff spring that only pulls. `length` is the left
  // chain (a taller screen lengthens both so they still start above its top);
  // the right one is `skew` longer, so the sign rests a little crooked.
  chain: Object.freeze({ length: 340, skew: 8, stiffness: 6000, damping: 66 }),
  // Air drag on the swing (higher settles sooner: 2.2 ≈ two seconds of sway)
  // and on turning.
  drag: Object.freeze({ move: 2.2, turn: 2.6 }),
  // Where it is let go: this far left of its resting spot (units), tilted
  // (radians), and high enough to start out of sight.
  drop: Object.freeze({ offsetX: -85, tilt: -0.05, minFall: 626 }),
  // The tags. Owner, 2026-11-17: "they move around way too much" (they swung
  // about 40 degrees, fast). Now a slower, calmer swing: a longer pendulum,
  // more drag, and only `push` of the sheet's jolts reaches them (about 10
  // degrees at most).
  tag: Object.freeze({ width: 200, height: 64, wire: 40, length: 150, damping: 3.6, push: 0.6 }),
  // The physics steps this often (s); a frame runs as many steps as it needs.
  step: 1 / 3000,

  // On screen: the sheet's resting middle sits at `restHeight` of the screen's
  // height, and the whole sign (sheet, tags) fits inside `fit` units wide and
  // tall, never drawn bigger than `maxScale`.
  restHeight: 0.42,
  fit: Object.freeze({ width: 860, height: 640 }),
  maxScale: 2.2,

  // Paint (spray colours) and the rust (deep red-brown, never yellow; owner,
  // 2026-11-17: the first rust was "way too dark", this one is lighter).
  paint: Object.freeze({ lose: '#dc3322', win: '#ece5d3', words: '#ece5d3' }),
  font: '"Black Ops One", Impact, "Arial Black", sans-serif',
});
