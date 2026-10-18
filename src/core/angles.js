// Angle helpers (radians). Headings in this game can grow without limit when
// something keeps turning the same way, so every "how far do I turn?" question
// goes through these instead of a hand-written `%` formula. JavaScript's `%`
// keeps the sign of a negative number, which made the old formulas pick the
// long way round after about one and a half full turns (review fix 5.3).

// The same heading folded back into one turn, between -PI and PI.
export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// The smallest signed turn that takes heading `from` to heading `to`
// (between -PI and PI; positive = turning towards larger angles).
export function shortestAngle(from, to) {
  return wrapAngle(to - from);
}

// Turn `current` toward `target` by at most `maximumStep` radians, the short way.
export function turnToward(current, target, maximumStep) {
  const difference = shortestAngle(current, target);
  return current + Math.max(-maximumStep, Math.min(maximumStep, difference));
}

// Move `amount` (0-1) of the way from heading `from` to heading `to`, the short way.
export function lerpAngle(from, to, amount) {
  return from + shortestAngle(from, to) * amount;
}
