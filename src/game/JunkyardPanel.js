// The junkyard's on-screen toolbar and OPTIONS panel (markup and button wiring
// only; what the buttons do is decided by the playtest). Moved verbatim out of
// JunkyardPlaytest so the fight logic no longer builds HTML.

// Shown after every reset: the controls in one line.
export const HELP_MESSAGE = 'WASD moves Lola. Shift sprints. Space jumps. C crouches. 1 / 2 switch guns. Left click shoots in CHASE view. Start Run lets the trained brain search and chase; Start Player lets you explore while the Leaper stays still.';

// Toolbar button labels for a GameFlow state. A pause offers to resume the
// mode it interrupted; everything else offers to start (or stop) a mode.
export function toolbarLabels(state) {
  const resumeMode = state.name === 'paused' ? state.resumeTo.mode : null;
  const mode = state.name === 'playing' ? state.mode : null;
  return {
    route: mode === 'hunt' ? 'STOP RUN' : resumeMode === 'hunt' ? 'RESUME RUN' : 'START RUN',
    player: mode === 'explore' ? 'STOP PLAYER' : resumeMode === 'explore' ? 'RESUME PLAYER' : 'START PLAYER',
  };
}

export class JunkyardPanel {
  constructor({ world }) {
    // 1. Page chrome for the junkyard: title line, controls help, body class.
    document.body.classList.add('junkyard-mode');
    document.querySelector('.sub').textContent = 'JUNKYARD // LOLA + LEAPER';
    document.querySelector('.keys').innerHTML = '<b>WASD</b> RUN · <b>SHIFT</b> SPRINT · <b>SPACE</b> JUMP<br /><b>C</b> CROUCH · <b>1 / 2</b> GUN · <b>LEFT CLICK</b> FIRE · <b>HOLD RIGHT CLICK</b> AIM ×1.25 · MOUSE LOOK<br /><b>ESC</b> RELEASE · <b>DOUBLE-TAP + DRAG</b> MOVE SCREEN CONTROLS';

    // 2. The toolbar and the (initially hidden) OPTIONS panel.
    this.element = document.createElement('section');
    this.element.id = 'junkyardPanel';
    this.element.innerHTML = `
      <div class="junkyard-toolbar">
        <button data-action="route">START RUN</button>
        <button data-action="player" title="Move and shoot as Lola while the Leaper stays still">START PLAYER</button>
        <button data-action="random">RESTART RANDOM</button>
        <button data-action="panel" aria-expanded="false" aria-controls="junkyardOptions">OPTIONS</button>
        <button data-action="sound" aria-pressed="true">SOUND: ON</button>
      </div>
      <div class="brain-state" aria-live="polite">BRAIN CONNECTING</div>
      <div data-sight-status aria-live="polite">SIGHT CONNECTING…</div>
      <div id="junkyardOptions" hidden>
      <strong>JUNKYARD PLAYTEST</strong>
      <label>Vision (changing mode resets the run)
        <select data-sight-mode aria-label="Vision mode">
          <option value="eye">Eye-level 3D vision</option>
          <option value="legacy">Old flat vision</option>
        </select>
      </label>
      <button data-action="sight" aria-pressed="false">SHOW SIGHT LINES</button>
      <small>Green: clear · Orange: blocked at cover. Three eye checks; 16 movement rays unchanged.</small>
      <label>Leaper clearance width
        <output>${world.width.toFixed(1)} units</output>
      </label>
      <div class="size-controls"><input type="range" aria-label="Leaper clearance width" min="1.2" max="8" step="0.1" value="${world.width}" />
      <button data-action="size">APPLY SIZE</button></div>
      <div class="junkyard-actions"><button data-action="reset">RESET</button>
        <button data-action="clearance">SHOW CLEARANCE</button></div>
      <p data-message>WASD to explore. In TOP view, Shift + click sets the destination.</p>
      <small>Live trained brain · 7,757,824 steps · vision and memory · inference only. Clearance overlay is a conservative design guide, not the brain’s route. <span data-clearance-summary></span></small>
      <p class="clearance-key" hidden>Green: reachable · Amber: disconnected · Red: blocked at this size</p>
      </div>`;
    document.body.appendChild(this.element);
    this.message = this.element.querySelector('[data-message]');
    this.brainLabel = this.element.querySelector('.brain-state');
    this.options = this.element.querySelector('#junkyardOptions');
    this.size = this.element.querySelector('input');

    // 3. Pure panel behaviour: OPTIONS opens / closes, the size slider shows its value,
    //    and clicks on the panel never reach the game canvas underneath.
    this.button('panel').onclick = (event) => {
      this.options.hidden = !this.options.hidden;
      this.element.classList.toggle('expanded', !this.options.hidden);
      event.currentTarget.setAttribute('aria-expanded', String(!this.options.hidden));
      event.currentTarget.textContent = this.options.hidden ? 'OPTIONS' : 'HIDE OPTIONS';
    };
    this.size.addEventListener('input', () => {
      this.element.querySelector('output').textContent = `${Number(this.size.value).toFixed(1)} units`;
    });
    this.element.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  button(action) {
    return this.element.querySelector(`[data-action=${action}]`);
  }

  // Hook the buttons to the playtest's actions.
  bind({ route, player, random, reset, clearance, applySize, sound }) {
    this.button('route').onclick = route;
    this.button('player').onclick = player;
    this.button('random').onclick = random;
    this.button('reset').onclick = reset;
    this.button('clearance').onclick = clearance;
    this.button('size').onclick = () => applySize(this.size.value);
    this.button('sound').onclick = sound;
  }

  // SOUND: ON / OFF follows the sound engine's switch.
  renderSound(enabled) {
    const button = this.button('sound');
    button.textContent = enabled ? 'SOUND: ON' : 'SOUND: OFF';
    button.setAttribute('aria-pressed', String(enabled));
  }

  // Button labels always follow the game state.
  renderFlow(state) {
    const labels = toolbarLabels(state);
    this.button('route').textContent = labels.route;
    this.button('player').textContent = labels.player;
  }

  openOptions() {
    if (this.options.hidden) this.button('panel').click();
  }

  showClearance(visible) {
    this.button('clearance').textContent = visible ? 'HIDE CLEARANCE' : 'SHOW CLEARANCE';
    this.element.querySelector('.clearance-key').hidden = !visible;
  }

  setClearanceSummary(text) {
    this.element.querySelector('[data-clearance-summary]').textContent = text;
  }

  dispose() {
    this.element.remove();
    document.body.classList.remove('junkyard-mode');
  }
}
