// Lola's health panel (bottom left of the HUD): her name, the HIT flash, the
// number, the health meter with its pale "chunk just lost" trail, and a progress
// bar for screen readers. Like every HUD view it builds its own markup, is handed
// plain numbers (PlayerVitals.view()) and only touches the page when one changed.

const TEMPLATE = `<div class="combat-health"><b>LOLA <span data-hit-label hidden>HIT</span> <span class="hp-text" data-hp-text></span></b>`
  + '<progress aria-label="Lola health" data-health-bar max="100" value="100"></progress>'
  + '<div class="health-meter" aria-hidden="true"><i class="hp-trail"></i><i class="hp-fill"></i></div></div>';

export class VitalsView {
  // parent: where the panel goes (the HUD's bottom-left region), or nowhere yet.
  constructor(parent = null) {
    // 1. Build the markup once and keep references to the parts that change.
    this.element = document.createElement('div');
    this.element.id = 'combatHud';
    this.element.innerHTML = TEMPLATE;
    this.bar = this.element.querySelector('[data-health-bar]');
    this.number = this.element.querySelector('[data-hp-text]');
    this.hitLabel = this.element.querySelector('[data-hit-label]');
    this.meter = this.element.querySelector('.health-meter');
    parent?.append(this.element);
    // 2. What was last drawn, so update() only writes changes.
    this.last = {};
  }

  // view: { health, max, hit, level, share, trail } (PlayerVitals.view()).
  update({ health, max, hit, level, share, trail }) {
    // 1. The number and the screen-reader bar move in whole points.
    const points = Math.ceil(health);
    this.change('max', max, (value) => { this.bar.max = value; });
    this.change('points', points, (value) => {
      this.bar.value = health;
      this.number.textContent = String(value);
    });
    // 2. The HIT flash and the colour level (full / mid / low).
    this.change('hit', Boolean(hit), (value) => {
      this.hitLabel.hidden = !value;
      this.element.dataset.hit = String(value);
    });
    this.change('level', level, (value) => { this.element.dataset.level = value; });
    // 3. The meter (rounded to a thousandth, so a draining trail writes a few times a second).
    this.change('share', round(share), (value) => this.meter.style.setProperty('--hp', String(value)));
    this.change('trail', round(trail), (value) => this.meter.style.setProperty('--trail', String(value)));
  }

  // Run `apply(value)` only when a value differs from the one last drawn.
  change(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  // The session is over: the panel leaves the page.
  dispose() {
    this.element.remove();
  }
}

const round = (value) => Math.round(value * 1000) / 1000;
