import { createLeaperHitboxes } from './Hitboxes.js';

// One Leaper as something Lola can shoot: its hit volumes (body, eye core, leg
// pieces) and what a bullet does to it. The fight rules stay with its combat:
// leg pieces count bullets through combat.legs.hit (8-10 snap a knee) and the
// health loss goes through combat.damageLeaper, exactly as before.
//   rig     the hexapod rig (createHexapod)
//   combat  its LeaperCombat (legs, damageLeaper, leaperHealth)
export function createLeaperTarget({ rig, combat, layout }) {
  const hitboxes = createLeaperHitboxes(rig, layout);
  const legParts = rig.legs.flatMap(leg => ['coxa', 'femur', 'tibia', 'calf', 'knee', 'calfJoint'].map(key => leg[key]));
  return {
    name: 'leaper',
    rig,
    combat,
    hitboxes,

    // Fresh matrices for the body and the leg pieces only (not the whole scene),
    // then the volumes follow them.
    update() {
      rig.robot.updateMatrixWorld(true);
      for (const part of legParts) part.updateMatrixWorld(true);
      hitboxes.update();
    },

    raycast(origin, direction, far) {
      return hitboxes.raycast(origin, direction, far);
    },

    // A bullet landed: joints count the hit, then the zone's multiplier scales the damage.
    applyHit(hit, { damage, direction }) {
      const { volume } = hit;
      const brokeJoint = volume.joint ? combat.legs.hit(volume.object, direction) : false;
      const weakPoint = volume.zone === 'core';
      const before = combat.leaperHealth;
      combat.damageLeaper(damage * volume.multiplier, false, brokeJoint);
      return { zone: volume.zone, weakPoint, brokeJoint, killed: before > 0 && combat.leaperHealth <= 0 };
    },
  };
}
