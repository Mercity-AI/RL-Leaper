// Unwrapped cumulative distance supports loop boundaries and reverse playback.
export function stridePosition(profile, time) {
  const loops = Math.floor(time / profile.duration);
  const phase = (time / profile.duration - loops) * (profile.travel.length - 1);
  const index = Math.min(profile.travel.length - 2, Math.floor(phase));
  const fraction = phase - index;
  return loops * profile.distance + profile.travel[index]
    + (profile.travel[index + 1] - profile.travel[index]) * fraction;
}

export function strideDistance(profile, time, elapsed) {
  return Math.abs(stridePosition(profile, time + elapsed) - stridePosition(profile, time));
}

// Blend animation time with distance along the stride. Advance this clock
// uniformly, then recover the pose time: feet and root still use the same pose,
// but brief support-foot handoffs take less time and fast sections take more.
// A full cycle keeps its original duration and measured travel distance.
export function evenStrideElapsed(profile, time, elapsed) {
  if (!profile.distance || !elapsed) return elapsed;
  const clock = (phase, travel) => 0.5 * (phase + travel / profile.distance);
  const start = time / profile.duration;
  const startLoop = Math.floor(start);
  const startPhase = start - startLoop;
  const startTravel = stridePosition(profile, time) - startLoop * profile.distance;
  const endClock = startLoop + clock(startPhase, startTravel) + elapsed / profile.duration;
  const endLoop = Math.floor(endClock);
  const phaseClock = endClock - endLoop;
  const last = profile.travel.length - 1;
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (clock(middle / last, profile.travel[middle]) <= phaseClock) low = middle;
    else high = middle;
  }
  const before = clock(low / last, profile.travel[low]);
  const after = clock(high / last, profile.travel[high]);
  const phase = (low + (phaseClock - before) / (after - before)) / last;
  return (endLoop + phase) * profile.duration - time;
}
