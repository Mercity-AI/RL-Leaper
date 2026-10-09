import contact from '../config/player-contact.json' with { type: 'json' };

export function contactRadius(scale) {
  return contact.leaperRadius + contact.playerRadius * scale;
}

// Cover the entire interpolated Leaper path, not just its latest endpoint.
export function touchesLeaper(x, z, from, to, radius) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / length)) : 0;
  return Math.hypot(x - from.x - dx * t, z - from.z - dz * t) < radius;
}

export { contact };
