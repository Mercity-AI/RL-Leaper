// Spawn selection only. The resulting route is never passed to the brain.
export function randomJunkyardStart(world, previous, random = Math.random) {
  const nav = world.navigation;
  const clear = [];
  for (let i = 0; i < nav.free.length; i += 1) {
    if (nav.free[i]) clear.push(i);
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!clear.length) break;
    const start = nav.point(clear[Math.floor(random() * clear.length)]);
    const target = nav.point(clear[Math.floor(random() * clear.length)]);
    // Extra room covers the Python collision raster's conservative cell edges.
    if (nav.blocked(start.x, start.z, nav.radius + 0.2)
      || nav.blocked(target.x, target.z, nav.radius + 0.2)) continue;
    if (Math.hypot(start.x - target.x, start.z - target.z) * world.scale < 10) continue;
    if (Math.hypot(start.x * world.scale - previous.x, start.z * world.scale - previous.z) < 3) continue;
    if (!nav.route(start, target).length) continue;
    return {
      position: { x: start.x * world.scale, z: start.z * world.scale },
      target: { x: target.x * world.scale, z: target.z * world.scale },
      yaw: random() * Math.PI * 2 - Math.PI,
    };
  }
  return null;
}
