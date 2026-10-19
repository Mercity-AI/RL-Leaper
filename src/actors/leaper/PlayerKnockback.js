import { LEAPER_EVENTS } from './leaperEvents.js';

// Shoves Lola when a Leaper attack knocks her back (a stomp, a landing
// shockwave). The Leaper only announces it (LEAPER_EVENTS.lolaKnockback); this
// moves her over a short time through her own collide-and-slide mover, so she
// slides along walls and never ends up inside the map or a Leaper.
export class PlayerKnockback {
  // player: Lola (mesh, mover, world); events: the game's event bus.
  constructor({ player, events }) {
    this.player = player;
    this.pushes = [];
    this.off = events?.on(LEAPER_EVENTS.lolaKnockback, (push) => this.push(push)) ?? (() => {});
  }

  // Start a shove: `distance` units along `direction` ({ x, z }) over `time` seconds.
  push({ direction, distance, time }) {
    const length = Math.hypot(direction.x, direction.z);
    if (!(length > 0) || !(distance > 0)) return;
    this.pushes.push({ x: direction.x / length, z: direction.z / length, left: distance, speed: distance / Math.max(time, 1e-3) });
  }

  // Gameplay phase, after her own movement: each shove moves her at a steady speed.
  update(dt) {
    if (!(dt > 0) || !this.pushes.length) return;
    const { mesh, mover, world } = this.player;
    for (const push of [...this.pushes]) {
      const step = Math.min(push.left, push.speed * dt);
      push.left -= step;
      const direction = { x: push.x, y: 0, z: push.z };
      if (mover && world) mover.move(world, mesh.position, direction, step);
      else if (!world?.playerBlocked?.(mesh.position.x + push.x * step, mesh.position.z + push.z * step)) {
        mesh.position.x += push.x * step;
        mesh.position.z += push.z * step;
      }
      if (push.left <= 1e-6) this.pushes.splice(this.pushes.indexOf(push), 1);
    }
  }

  // A restart: nothing still pushing.
  clear() {
    this.pushes.length = 0;
  }

  dispose() {
    this.clear();
    this.off();
  }
}
