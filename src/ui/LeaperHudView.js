// The Leaper's HUD panel (#leaperHealthHud): its name with what it is doing in
// the player's words (SEARCHING, HUNTING, ENGAGING, STOMP!, POUNCE!,
// STAGGERED, DOWN · VULNERABLE, DESTROYED), a slim health meter and what its
// eye is doing. With ?debug a separate one-line readout (#leaperDebugHud,
// top centre) shows the behaviour state machine: raw state and phase,
// locomotion source (RL / HOLD / SCRIPTED), legs left and cooldowns.
// Self-contained: it builds its own elements and brings its own styles (the
// panel's place on screen comes from the game's layout and stays compact, so
// it never covers the controls panel below it).

const STYLE_ID = 'leaper-hud-view-styles';
const STYLES = `
#leaperHealthHud .leaper-hud-meter { position: relative; height: 4px; margin: 3px 0 2px; border-radius: 2px; overflow: hidden; background: #2a2d33; }
#leaperHealthHud .leaper-hud-meter i { position: absolute; inset: 0 auto 0 0; width: calc(var(--hp, 1) * 100%); background: #ff5a30; transition: width .08s; }
#leaperHealthHud .leaper-hud-state { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px; font: bold 9px/1.45 monospace; letter-spacing: .03em; vertical-align: 1px; color: #e9e3e1; background: #3a3d44; }
#leaperHealthHud[data-state=chase] .leaper-hud-state, #leaperHealthHud[data-state=engage] .leaper-hud-state { background: #8d1d10; color: #ffe0d8; }
#leaperHealthHud[data-state=stomp] .leaper-hud-state, #leaperHealthHud[data-state=leap] .leaper-hud-state { background: #ff3b1a; color: #fff; animation: leaper-hud-warn .25s ease-in-out infinite alternate; }
#leaperHealthHud[data-state=stagger] .leaper-hud-state { background: #c9a227; color: #1a1406; }
#leaperHealthHud[data-state=downed] .leaper-hud-state { background: #2f7d4f; color: #eafff1; }
#leaperHealthHud[data-state=dying] .leaper-hud-state, #leaperHealthHud[data-state=dead] .leaper-hud-state { background: #111; color: #888; }
#leaperDebugHud { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 21; padding: 2px 8px; border-radius: 4px; background: #101418cc; color: #9fd0ff; font: 10px/1.4 monospace; white-space: nowrap; pointer-events: none; }
@keyframes leaper-hud-warn { from { filter: brightness(.8); } to { filter: brightness(1.3); } }
`;

// The styles go into the page once, however many panels exist.
function installStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

export class LeaperHudView {
  // debug: also show the behaviour state machine (the page has ?debug).
  constructor({ doc = document, debug = false, parent = doc.body } = {}) {
    installStyles(doc);
    // 1. The panel: name and state badge, a slim meter, the eye's status, and
    //    a hidden progress bar that screen readers announce.
    this.element = doc.createElement('div');
    this.element.id = 'leaperHealthHud';
    this.element.innerHTML = '<b>LEAPER<span class="leaper-hud-state" data-leaper-state role="status"></span></b>'
      + '<progress aria-label="Leaper health"></progress>'
      + '<div class="leaper-hud-meter" aria-hidden="true"><i></i></div>'
      + '<div data-attack role="status"></div>';
    parent.append(this.element);
    this.progress = this.element.querySelector('progress');
    this.meter = this.element.querySelector('.leaper-hud-meter');
    this.stateBadge = this.element.querySelector('[data-leaper-state]');
    this.attack = this.element.querySelector('[data-attack]');
    // 2. The debug readout, its own small line so the panel stays compact.
    this.debugLine = null;
    if (debug) {
      this.debugLine = doc.createElement('div');
      this.debugLine.id = 'leaperDebugHud';
      this.debugLine.setAttribute('aria-hidden', 'true');
      parent.append(this.debugLine);
    }
    this.shown = {};
  }

  // view: { health, max, attack, behaviour: { state, label, debug } | null }.
  // Only what changed is written to the page.
  render({ health, max, attack, behaviour = null }) {
    this.set('max', max, () => { this.progress.max = max; });
    this.set('health', health, () => {
      this.progress.value = health;
      this.meter.style.setProperty('--hp', String(max ? health / max : 0));
    });
    this.set('attack', attack, () => { this.attack.textContent = attack; });
    const state = behaviour?.state ?? '';
    this.set('state', state, () => { this.element.dataset.state = state; });
    this.set('label', behaviour?.label ?? '', () => {
      this.stateBadge.textContent = behaviour?.label ?? '';
      this.stateBadge.hidden = !behaviour;
    });
    if (this.debugLine) this.set('debug', behaviour?.debug ?? '', () => { this.debugLine.textContent = `LEAPER ${behaviour?.debug ?? ''}`; });
  }

  set(key, value, write) {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    write();
  }

  dispose() {
    this.element.remove();
    this.debugLine?.remove();
  }
}
