import { COMBAT } from '../config/combat.js';
import { GAME_EVENTS } from '../core/events.js';

// Lola's health and her on-screen health panel (#combatHud), plus the result
// banner with RESTART ENCOUNTER. These used to live inside the Leaper's combat
// class, so the enemy owned the player's health; with a second Leaper Lola would
// have had two health bars (review finding enemy-combat-god-class-owns-player).
// PlayerVitals holds the numbers and rules (testable without a page);
// PlayerVitalsHud only draws them.

// Health meter: the solid fill is current health; the pale "trail" shows the chunk
// just lost, holds briefly, then drains so each hit's size is readable.
const METER = '<div class="health-meter" aria-hidden="true"><i class="hp-trail"></i><i class="hp-fill"></i></div>';
export const TRAIL_HOLD = 0.45; // seconds the lost chunk stays before draining
export const TRAIL_DRAIN = 0.6; // share of a full bar drained per second
// Seconds the "HIT" label and the highlighted health readout show after a hit.
const HIT_FLASH = 0.4;

// The page side: Lola's panel and the result banner.
export class PlayerVitalsHud {
  constructor({ onRestart }) {
    // 1. Name, HIT label, number, screen-reader progress bar, meter, and the
    //    (hidden) end-of-fight result with its restart button.
    this.element = document.createElement('div');
    this.element.id = 'combatHud';
    this.element.innerHTML = `<div class="combat-health"><b>LOLA <span data-hit-label hidden>HIT</span> <span class="hp-text" data-hp-text></span></b><progress aria-label="Lola health" data-health-bar max="100" value="100"></progress>${METER}</div>
      <div data-result hidden><strong></strong><button data-restart>RESTART ENCOUNTER</button></div>`;
    document.body.appendChild(this.element);
    this.result = this.element.querySelector('[data-result]');
    // 2. RESTART ENCOUNTER: what it does is the game's decision.
    this.result.querySelector('[data-restart]').onclick = () => onRestart();
  }

  // view: the numbers from PlayerVitals.view().
  render({ health, max, hit, level, share, trail, edgeTint }) {
    const hud = this.element;
    const bar = hud.querySelector('[data-health-bar]');
    bar.max = max; bar.value = health;
    hud.querySelector('[data-hp-text]').textContent = `${Math.ceil(health)}`;
    hud.querySelector('[data-hit-label]').hidden = !hit;
    hud.dataset.hit = String(hit);
    hud.dataset.level = level;
    const meter = hud.querySelector('.health-meter');
    meter.style.setProperty('--hp', String(share));
    meter.style.setProperty('--trail', String(trail));
    document.documentElement.style.setProperty('--damage-flash', String(edgeTint));
  }

  showResult(text) {
    this.result.hidden = false;
    this.result.querySelector('strong').textContent = text;
  }

  hideResult() {
    this.result.hidden = true;
  }

  dispose() {
    this.element.remove();
    document.documentElement.style.setProperty('--damage-flash', '0');
  }
}

export class PlayerVitals {
  // player: Lola (her hit flinch and `defeated` flag). audio: the shared sound
  // engine (hurt sounds). events: the game's event bus (lolaDamaged).
  // hud: what draws the numbers (the page panel by default).
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

  updateHud({ over = false } = {}) {
    this.hud.render(this.view({ over }));
  }

  // The end-of-fight banner ("LEAPER DEFEATED", "PRACTICE · …", "LOLA DEFEATED").
  showResult(text) {
    this.hud.showResult(text);
  }

  dispose() {
    this.hud.dispose();
  }
}
