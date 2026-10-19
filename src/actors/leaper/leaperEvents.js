// Events a Leaper announces on the game's event bus (src/core/events.js), next
// to GAME_EVENTS. Payloads:
//   leaperStateChanged { leaper, from, to, reason, locomotion, label }
//                       the behaviour state machine changed state (LeaperDirector)
//   leaperAttack       { leaper, kind: 'stomp' | 'leap', phase: 'windup' | 'impact' | 'launch' | 'land' | 'cancel',
//                        hit, position: { x, z }, reason }
//   leaperStaggered    { leaper, reason }
//   leaperDowned       { leaper, permanent, rising }   it fell (rising: true when it starts getting up)
//   leaperDied         { leaper, position: { x, z } }
//   jointBurst         { leaper, position: { x, y, z }, lost }   a leg snapped (sparks, sound)
//   lolaKnockback      { direction: { x, z }, distance, time, source }
//                       shove Lola away (PlayerKnockback moves her, sliding along walls)
export const LEAPER_EVENTS = Object.freeze({
  stateChanged: 'leaperStateChanged',
  attack: 'leaperAttack',
  staggered: 'leaperStaggered',
  downed: 'leaperDowned',
  died: 'leaperDied',
  jointBurst: 'jointBurst',
  lolaKnockback: 'lolaKnockback',
});
