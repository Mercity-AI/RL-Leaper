// The title screen's hanging sign (owner, 2026-11-17; drawn by src/ui/TitleSign.js,
// moved by src/ui/scrapSign/TitleSignMotion.js). Picked from the previews in
// previews/title-screen.html (design A): a steel sign with LEAPER sprayed on,
// hanging level from two long chains, the menu items as metal tags hanging one
// below another from it. Units: the title is laid out on a 1280 x 720 picture
// and scaled to the window (390 units are about a metre, as on the end sign).
export const TITLE_SIGN = Object.freeze({
  // The layout: scaled so `view.height` fills the window's height, but never
  // wider than `view.minWidth` across (phones), nor more than `maxScale` px a unit.
  view: Object.freeze({ height: 720, minWidth: 500 }),
  maxScale: 2.4,
  textureScale: 2, // texture pixels per unit
  font: '"Black Ops One", Impact, "Arial Black", sans-serif',
  sign: Object.freeze({
    x: 40, y: 74, width: 420, height: 196, // its top-left corner at rest
    seed: 31, // which bit of the rust and grime
    chainHoles: Object.freeze([Object.freeze([60, 16]), Object.freeze([360, 16])]),
    tagHole: Object.freeze([150, 184]),
    rivets: Object.freeze([Object.freeze([18, 178]), Object.freeze([402, 178]), Object.freeze([18, 40]), Object.freeze([402, 40])]),
    // (owner: the heavily rusted sign "looked tacky"; it is the tags' clean steel,
    // then "a little more dirt", 15%: rust 0.6 -> 0.69, edge rust 0.12 -> 0.138,
    // and grime up to 15% darker, settling toward the bottom.)
    rust: 0.69, edgeRust: 0.138, grime: 0.15,
  }),
  words: Object.freeze({
    name: 'LEAPER', nameSize: 96, nameY: 118, nameColour: '#ff6a3d', nameWear: 0.5, nameGrime: 0.35,
    tagline: 'BRING DOWN THE SIX-LEGGED MACHINE', taglineSize: 15, taglineY: 158, taglineColour: '#15181a', taglineWear: 0.2,
    maxWidth: 370,
  }),
  tag: Object.freeze({
    width: 250, height: 58, // a tag with a hint grows 14 a line (two lines: 92)
    wire: Object.freeze([20, 22]), // from the sign to the first tag, then between tags
    bottomHole: 6, // the next tag hangs from a hole this far above the bottom
  }),
  motion: Object.freeze({
    gravity: 3800, // units/s²
    chain: 600, // the chains' length: the sign swings like a pendulum this long
    drag: 0.6, // air drag on the swing, per second
    sway: 12, // units each way: a gentle push in time with the swing keeps it there
    tagShare: 0.6, // how much of the hanging point's jolts a tag feels (calm tags)
    tagDamping: 4.5, // per second
    knock: 0.3, // rad/s: the tag you move to (never the one already chosen)
    rate: 1200, // steps a second
    warmup: 12, // seconds run before the title shows, so it opens already swaying evenly
  }),
});
