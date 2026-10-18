// Pick the mode from the page address. Precedence is unchanged from the old
// main.js: ?training, then ?arena, then ?free / ?sandbox; anything else
// (including ?map=junkyard) opens the junkyard game. Kept in its own file so
// tests can check it without loading every mode.
export function pickMode(params) {
  if (params.has('training')) return 'training';
  if (params.has('arena')) return 'arena';
  if (params.has('free') || params.has('sandbox')) return 'sandbox';
  return 'junkyard';
}
