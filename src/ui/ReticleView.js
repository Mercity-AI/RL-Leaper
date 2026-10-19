import '../styles/ui/reticle.css';

// The crosshair in the middle of the screen, as a self-contained view: it builds
// its own markup, takes plain data each frame and never touches game objects.
// It shows
//   - the hip-fire "+" or the thin aiming crosshair (aiming),
//   - four ticks around it that open up with the gun's current spread,
//   - hit reactions: the crimson kick (hit), the weak-point glow (crit), the big
//     hit hold (big), and a hit marker X whose look says what the bullet did
//     (normal / weak / joint / kill),
//   - OBSTRUCTED: the gun's barrel is blocked before the crosshair's point (the
//     crosshair greys out and a small marker shows where the cover is).

const TEMPLATE = `
  <div id="playerReticle" class="reticle" role="img" aria-label="Gun aiming reticle">
    <span class="reticle-plus">+</span>
    <span class="reticle-spread" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="reticle-marker" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
  </div>
  <div class="reticle-block" aria-hidden="true"><span>⊘</span></div>
  <div class="reticle-status" role="status" aria-live="polite"></div>`;

export class ReticleView {
  constructor(parent = document.body) {
    // 1. Build the markup once from the template.
    this.root = document.createElement('div');
    this.root.className = 'reticle-layer';
    this.root.innerHTML = TEMPLATE;
    parent.append(this.root);
    this.element = this.root.querySelector('#playerReticle');
    this.block = this.root.querySelector('.reticle-block');
    this.status = this.root.querySelector('.reticle-status');
    // 2. What was last drawn, so the page is only touched when something changes.
    this.last = {};
  }

  // state: {
  //   visible, aiming, hit, crit, big, blocked,
  //   blockOffset: { x, y } pixels from the screen centre to the cover (or null),
  //   spread: pixels from the centre to the spread ticks,
  //   marker: { kind: 'normal' | 'weak' | 'joint' | 'kill', strength: 1 -> 0 } or null
  // }
  update(state) {
    const element = this.element;
    // 1. Shown only while the gun can be used.
    this.set('visible', state.visible, (visible) => {
      this.root.hidden = !visible;
      element.hidden = !visible;
    });
    if (!state.visible) return;
    // 2. The crosshair's states (the existing look keys off these attributes).
    this.set('aim', Boolean(state.aiming), (value) => { element.dataset.aim = String(value); });
    this.set('hit', Boolean(state.hit), (value) => { element.dataset.hit = String(value); });
    this.set('crit', Boolean(state.crit), (value) => { element.dataset.crit = String(value); });
    this.set('big', Boolean(state.big), (value) => { element.dataset.big = String(value); });
    // 3. OBSTRUCTED: grey crosshair, a marker on the cover, and a word for screen readers.
    this.set('blocked', Boolean(state.blocked), (value) => {
      element.dataset.blocked = String(value);
      this.block.hidden = !value;
      this.status.textContent = value ? 'Obstructed' : '';
    });
    if (state.blocked && state.blockOffset) {
      const x = Math.round(state.blockOffset.x), y = Math.round(state.blockOffset.y);
      this.set('blockAt', `${x},${y}`, () => { this.block.style.transform = `translate(${x}px, ${y}px)`; });
    }
    // 4. Spread ticks (whole pixels, so tiny changes don't restyle every frame).
    this.set('spread', Math.round(state.spread ?? 0), (value) => element.style.setProperty('--spread', `${value}px`));
    // 5. The hit marker fades with its strength.
    const marker = state.marker;
    this.set('marker', marker?.kind ?? 'none', (kind) => { element.dataset.marker = kind; });
    this.set('markerStrength', marker ? Math.round(marker.strength * 100) / 100 : 0,
      (value) => element.style.setProperty('--marker', String(value)));
  }

  // Run `apply(value)` only when a value differs from the one last drawn.
  set(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  // The session is over: the reticle leaves the page.
  dispose() {
    this.root.remove();
  }
}
