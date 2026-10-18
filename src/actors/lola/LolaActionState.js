// Lola's action rules in one readable table: which actions she can start in
// which state, and what starting one ends. This is the place to answer
// designer questions like "can I shoot while reloading?" (no: reload blocks
// shoot) or "does crouching cancel a shot?" (yes: crouch ends shoot).
//
// States (several can be true at once):
//   idle / move   no movement input / some movement input
//   crouch        crouched stance (C)
//   airborne      in the physics hop (only when the jump clips are missing)
//   jump          an authored jump is playing
//   shoot         a shot or the held-aim pose is up
//   reload        the reload clip is playing
//   hit           the hit flinch is playing
//   defeated      the encounter ended; nothing new can start
//
// Animation priority, highest first: defeated (frozen) > jump (full body)
// > reload or shoot (upper body; standing still a shot also sets the legs)
// > move/idle. The hit flinch is added on top of whatever plays, so getting
// hit and shooting never cancel each other.
export const LOLA_ACTION_RULES = Object.freeze({
  // Fire a shot (or start the aim pose). A flinch keeps playing on top.
  shoot: Object.freeze({ blockedBy: ['defeated', 'airborne', 'jump', 'reload'], ends: ['shoot'] }),
  // Raise the gun without firing; does nothing if a shot is already up.
  // Allowed mid-flinch, so a hit never drops her aim.
  aim: Object.freeze({ blockedBy: ['shoot'], ends: [] }),
  // Reload the equipped gun (the jump moves both hands, so it blocks reloads).
  reload: Object.freeze({ blockedBy: ['defeated', 'jump'], ends: ['shoot', 'reload'] }),
  // Jump; standing up out of a crouch first.
  jump: Object.freeze({ blockedBy: ['defeated', 'airborne', 'jump'], ends: ['shoot', 'reload', 'crouch'] }),
  // Toggle crouch (C).
  crouch: Object.freeze({ blockedBy: ['jump'], ends: ['shoot'] }),
  // Switch guns (1 / 2): the new gun starts lowered and loaded as it was.
  weapon: Object.freeze({ blockedBy: [], ends: ['shoot', 'reload'] }),
  // Get hit by a bolt: the flinch plays over everything; a raised gun stays up.
  hit: Object.freeze({ blockedBy: ['defeated'], ends: [] }),
});

export class LolaActionState {
  constructor(player, rules = LOLA_ACTION_RULES) {
    this.player = player;
    this.rules = rules;
  }

  // Is Lola in this state right now?
  is(state) {
    const player = this.player;
    switch (state) {
      case 'defeated': return !!player.defeated;
      case 'airborne': return !player.grounded;
      case 'jump': return !!player.jumpState;
      case 'reload': return !!player.reloadState;
      case 'shoot': return !!player.shot;
      case 'crouch': return !!player.crouching;
      case 'hit': return player.hitRecoilTime > 0;
      case 'move': return Math.hypot(player.inputForward, player.inputSide) > 0;
      case 'idle': return !this.is('move');
      default: throw new Error(`Unknown Lola state: ${state}`);
    }
  }

  // Every state that is true right now (for debugging and tests).
  get states() {
    return ['idle', 'move', 'crouch', 'airborne', 'jump', 'shoot', 'reload', 'hit', 'defeated'].filter(state => this.is(state));
  }

  // May she start this action now?
  can(action) {
    const rule = this.rules[action];
    if (!rule) throw new Error(`Unknown Lola action: ${action}`);
    return !rule.blockedBy.some(state => this.is(state));
  }

  // Start an action if allowed: end what it replaces (enders maps a state name
  // to the function that ends it) and report whether it may go ahead.
  begin(action, enders) {
    if (!this.can(action)) return false;
    for (const state of this.rules[action].ends) enders[state]?.();
    return true;
  }
}
