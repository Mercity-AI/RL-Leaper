import { LEAPER_ANGLES, LEAPER_BEHAVIOUR } from '../../config/leaper-behaviour.js';

// Where a pounce lands, and the jump between (pure maths, no Three.js).

// A landing spot for a leap from `from` ({ x, z, yaw }) at Lola (`lola`, { x, z }),
// or null. It lands landingGap short of her, on the straight line or a few
// degrees off it (landingTurns), on the first spot that is clear:
//   clear(x, z): the world's conservative test for the Leaper's whole leg span
//                (world.positionBlocked is false there), so any heading fits;
//   apart(x, z, yaw): optional; false when the Leaper would land on Lola.
// The brain still has the last word: LeaperActor asks it to accept the pose
// (its own collision check) before take-off.
export function planLeap({ from, lola, clear, apart = () => true, config = LEAPER_BEHAVIOUR.leap,
  turns = LEAPER_ANGLES.landingTurns }) {
  const dx = lola.x - from.x, dz = lola.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < config.minDistance || distance > config.maxDistance) return null;
  const travel = distance - config.landingGap;
  if (travel < config.minTravel) return null;
  const bearing = Math.atan2(dx, dz);
  for (const turn of turns) {
    // 1. A spot `travel` away, `turn` off the line to Lola.
    const heading = bearing + turn;
    const x = from.x + Math.sin(heading) * travel, z = from.z + Math.cos(heading) * travel;
    // 2. It lands facing her.
    const yaw = Math.atan2(lola.x - x, lola.z - z);
    if (!clear(x, z) || !apart(x, z, yaw)) continue;
    return { from: { x: from.x, z: from.z, yaw: from.yaw }, to: { x, z, yaw }, heading, travel, turn,
      lola: { x: lola.x, z: lola.z } };
  }
  return null;
}

// The flight at time t (0..flight seconds): a ballistic hop. Ground speed is
// constant, the height a parabola peaking at apexHeight half way, and the body
// turns from its take-off heading to face Lola as it flies. Starts and ends
// exactly at plan.from / plan.to.
// Returns { x, z, yaw, height, verticalVelocity, progress }.
export function leapArc(plan, t, config = LEAPER_BEHAVIOUR.leap) {
  const u = Math.min(1, Math.max(0, t / config.flight));
  const x = plan.from.x + (plan.to.x - plan.from.x) * u;
  const z = plan.from.z + (plan.to.z - plan.from.z) * u;
  const height = 4 * config.apexHeight * u * (1 - u);
  const verticalVelocity = 4 * config.apexHeight * (1 - 2 * u) / config.flight;
  // Short way round from the heading at take-off (launchYaw, else the jump's
  // direction) to the landing heading.
  const start = plan.launchYaw ?? plan.heading;
  const turn = Math.atan2(Math.sin(plan.to.yaw - start), Math.cos(plan.to.yaw - start));
  const yaw = start + turn * smoothstep(u);
  return { x, z, yaw, height, verticalVelocity, progress: u };
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}
