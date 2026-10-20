import { COMBAT } from '../config/tuning/index.js';
import { GAME_EVENTS } from '../core/events.js';
import { VitalsView } from '../ui/VitalsView.js';

// Lola's health and the rules around it: damage, the hit flash, the draining
// "chunk lost" trail and being defeated. These used to live inside the Leaper's
// combat class, so the enemy owned the player's health; with a second Leaper
// Lola would have had two health bars (finding enemy-combat-god-class-owns-player).
// PlayerVitals holds the numbers and rules (testable without a page) and hands
// plain numbers (view()) to whatever draws them:
//   - in the game, the HUD shell (src/ui/Hud.js) reads view() once per frame and
//     the end screen shows the result, so PlayerVitals gets passivePresenter();
//   - pages without the HUD (test pages, tools) get PlayerVitalsHud below.

export const TRAIL_HOLD = 0.45; // seconds the lost chunk stays before draining
export const TRAIL_DRAIN = 0.6; // share of a full bar drained per second
// Seconds the "HIT" label and the highlighted health readout show after a hit.
const HIT_FLASH = 0.4;

// The page side for pages without the game's HUD: Lola's panel, a result banner
// with RESTART ENCOUNTER, and the red screen-edge tint (a page-wide variable).
export class PlayerVitalsHud {
  constructor({ onRestart }) {
    // 1. Lola's panel (src/ui/VitalsView.js) on the page, plus the (hidden)
    //    end-of-fight result with its restart button.
    this.view = new VitalsView(document.body);
    this.element = this.view.element;
    this.result = document.createElement('div');
    this.result.dataset.result = '';
    this.result.hidden = true;
    this.result.innerHTML = '<strong></strong><button type="button" data-restart>RESTART ENCOUNTER</button>';
    this.element.append(this.result);
    // 2. RESTART ENCOUNTER: what it does is the game's decision.
    this.result.querySelector('[data-restart]').onclick = () => onRestart();
    this.edgeTint = null;
  }

  // view: the numbers from PlayerVitals.view(). Every write happens only on a change.
  render(view) {
    this.view.update(view);
    const tint = String(view.edgeTint);
    if (tint === this.edgeTint) return;
    this.edgeTint = tint;
    document.documentElement.style.setProperty('--damage-flash', tint);
  }

  // The end-of-fight banner, and hiding it again on a restart.
  showResult(text) {
    this.result.hidden = false;
    this.result.querySelector('strong').textContent = text;
  }

  hideResult() {
    this.result.hidden = true;
  }

  // The session is over: the panel leaves the page and the red screen edges are cleared.
  dispose() {
    this.view.dispose();
    document.documentElement.style.setProperty('--damage-flash', '0');
  }
}

// A presenter that draws nothing, for the game: its HUD reads view() itself each
// frame and the end screen shows the result. element: the HUD's panel (for tools).
export function passivePresenter(element = null) {
  return { passive: true, element, render() {}, showResult() {}, hideResult() {}, dispose() {} };
}

export class PlayerVitals {
  // player: Lola (her hit flinch and `defeated` flag). audio: the shared sound
  // engine (hurt sounds). events: the game's event bus (lolaDamaged).
  // hud: what draws the numbers (PlayerVitalsHud by default, passivePresenter()
  // when the game's HUD shell draws them).
  constructor({ player, audio = null, events = null, config = COMBAT, hud = null }) {
    Object.assign(this, { player, audio, events, config });
    this.max = config.lolaHealth;
    this.hud = hud ?? new PlayerVitalsHud({ onRestart: () => this.onRestart?.() });
    this.reset();
  }

  // The panel element (#combatHud), for tests and layout tools.
  get element() {
    return this.hud.element;
  }

  // Lola is down (this decides a lost fight).
  get dead() {
    return this.health <= 0;
  }

  // Full health, no flash, no result banner, Lola free to move.
  reset() {
    this.health = this.max;
    this.hitFlash = 0;
    this.trail = { value: 1, hold: 0 };
    this.player.defeated = false;
    this.player.clearHitReaction?.();
    this.hud.hideResult();
    this.updateHud();
  }

  // A hit (a Leaper bolt). direction: the bolt's travel direction, for her flinch.
  // Returns the damage actually taken (never more than the health left).
  damage(amount = this.config.boltDamage, direction = null) {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    const taken = before - this.health;
    // 1. Tell the game (results, and anyone else listening).
    this.events?.emit(GAME_EVENTS.lolaDamaged, { amount: taken, health: this.health, direction });
    // 2. Readable feedback: the lost chunk holds, the readout flashes, she flinches.
    this.trail.hold = TRAIL_HOLD;
    this.hitFlash = HIT_FLASH;
    this.player.reactToHit?.(direction);
    // 3. Layered hurt sound: a body thud under a voice, heavier when nearly down.
    this.audio?.playSlot('lolaHitThud');
    this.audio?.playSlot(this.health <= this.config.lowHealthThreshold ? 'lolaHurtBig' : 'lolaHurt');
    // 4. Down: Lola can no longer move, jump or shoot (her flinch still plays out).
    if (this.dead) this.player.defeated = true;
    this.updateHud();
    return taken;
  }

  // Health back (a health pill), never above the maximum and never once she is
  // down. Returns the health actually gained.
  heal(amount) {
    if (this.dead || amount <= 0) return 0;
    const before = this.health;
    this.health = Math.min(this.max, this.health + amount);
    const gained = this.health - before;
    if (gained > 0) this.events?.emit(GAME_EVENTS.lolaHealed, { amount: gained, health: this.health });
    this.updateHud();
    return gained;
  }

  // Every frame, with gameplay time (0 while paused, so the flash and trail hold).
  // over: the fight has ended, which hides the HIT highlight.
  update(dt, { over = false } = {}) {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const share = this.health / this.max;
    const trail = this.trail;
    if (trail.value <= share) trail.value = share;
    else if (trail.hold > 0) trail.hold = Math.max(0, trail.hold - dt);
    else trail.value = Math.max(share, trail.value - TRAIL_DRAIN * dt);
    this.updateHud({ over });
  }

  // What the panel should show right now, as plain numbers.
  view({ over = false } = {}) {
    const share = this.health / this.max;
    const low = this.health <= this.config.lowHealthThreshold;
    return {
      health: this.health,
      max: this.max,
      // Ordinary hits briefly highlight the readout (not once the fight is over).
      hit: this.hitFlash > 0 && !this.dead && !over,
      level: low ? 'low' : share <= 0.5 ? 'mid' : 'full',
      share,
      trail: Math.max(share, this.trail.value),
      // Screen edges are reserved for critical health, including while paused.
      edgeTint: low ? 0.15 + 0.2 * (1 - this.health / this.config.lowHealthThreshold) : 0,
    };
  }

  // Hand the current numbers to whatever draws them (nothing to do when the
  // game's HUD reads them itself).
  updateHud({ over = false } = {}) {
    if (this.hud.passive) return;
    this.hud.render(this.view({ over }));
  }

  // The end-of-fight banner ("LEAPER DEFEATED", "PRACTICE · …", "LOLA DEFEATED").
  showResult(text) {
    this.hud.showResult(text);
  }

  // The session is over: remove the HUD from the page.
  dispose() {
    this.hud.dispose();
  }
}
