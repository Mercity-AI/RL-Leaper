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
