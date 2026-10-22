import '../styles/ui/dev-panel.css';
import { NO_TIMER, PhaseTimer, perfText, rendererCounts } from './PhaseTimer.js';

// The developer panel (review fix 5.24 step 5, finding
// ui-audio-debug-tools-in-player-hud): every lab and debug tool, out of the
// player's HUD. Loaded by src/debug/devTools.js only with ?dev or on the dev
// server. The ` key opens a drawer with (no on-screen DEV button since
// 2026-10-22: it covered the FPS counter, owner: "remove that dev icon")
//   GAME      the old toolbar and OPTIONS (src/game/JunkyardPanel.js): START RUN,
//             START PLAYER, RESTART RANDOM, sound, LEAPER POV, vision mode, sight
//             lines, brain provider, Leaper size, reset, clearance overlay and
//             DEBUG: DAMAGE LEAPER
//   BRAIN     the brain badge with its details (where it runs, the policy's
//             SHA256) and the status line
//   PERF      a small overlay: frames per second, frame time, milliseconds per
//             frame phase and the renderer's counters (draw calls, triangles,
//             geometries, textures, shader programs)
//   TUNING    the live tuning panel (src/debug/TuningPanel.js), downloaded with
//             Tweakpane the first time the drawer opens
// What is open is remembered in this browser.

const STORAGE_KEY = 'leaper.dev-tools.v1';
// How often the readouts refresh (ms): twice a second, never every frame.
const REFRESH_MS = 500;

function loadState() {
  try {
    return { open: false, perf: false, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { open: false, perf: false };
  }
}

export function createDevPanel(context) {
  return new DevPanel(context);
}

export class DevPanel {
  // ui: the game's front end (src/ui/GameUi.js). playtest: the junkyard session.
  // engine: renderer, scene and camera. signal: the session's AbortSignal.
  constructor({ ui, playtest, engine, signal = null }) {
    Object.assign(this, { ui, playtest, engine });
    const options = signal ? { signal } : {};
    this.state = loadState();
    document.body.classList.add('dev-tools');

    // 1. The DEV button (kept off the screen: the ` key opens the drawer).
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'dev-toggle';
    this.toggle.textContent = 'DEV';
    this.toggle.title = 'Developer tools (`)';
    this.toggle.setAttribute('aria-controls', 'devPanel');
    this.toggle.addEventListener('click', () => this.setOpen(!this.state.open));
    // (Clicks on the tools never reach the game view underneath.)
    this.toggle.addEventListener('pointerdown', (event) => event.stopPropagation());

    // 2. The drawer and its sections.
    this.drawer = document.createElement('aside');
    this.drawer.id = 'devPanel';
    this.drawer.className = 'dev-drawer';
    this.drawer.setAttribute('aria-label', 'Developer tools');
    this.drawer.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.drawer.innerHTML = `<header class="dev-header"><strong>DEVELOPER TOOLS</strong>
      <button type="button" data-dev="close" aria-label="Close developer tools">×</button></header>
      <section class="dev-section" data-dev-section="game"><h3>GAME</h3></section>
      <section class="dev-section" data-dev-section="brain"><h3>BRAIN</h3>
        <dl class="dev-facts"><dt>Badge</dt><dd data-dev="badge"></dd><dt>Details</dt><dd data-dev="details"></dd>
        <dt>Status</dt><dd data-dev="status"></dd></dl></section>
      <section class="dev-section" data-dev-section="perf"><h3>PERFORMANCE</h3>
        <label class="dev-check"><input type="checkbox" data-dev="perf" /> Perf overlay</label></section>
      <section class="dev-section" data-dev-section="tuning"><h3>TUNING</h3></section>`;
    this.drawer.querySelector('[data-dev="close"]').addEventListener('click', () => this.setOpen(false));
    this.facts = {
      badge: this.drawer.querySelector('[data-dev="badge"]'),
      details: this.drawer.querySelector('[data-dev="details"]'),
      status: this.drawer.querySelector('[data-dev="status"]'),
    };
    // The old toolbar and OPTIONS, with every tool the older systems hang on it.
    this.drawer.querySelector('[data-dev-section="game"]').append(playtest.panel);
    const perfBox = this.drawer.querySelector('[data-dev="perf"]');
    perfBox.checked = Boolean(this.state.perf);
    perfBox.addEventListener('change', () => this.setPerf(perfBox.checked));

    // 3. The perf overlay (bottom centre, between Lola's health and her guns).
    this.perf = document.createElement('pre');
    this.perf.className = 'dev-perf';
    this.perf.setAttribute('aria-label', 'Performance');
    this.perf.hidden = true;
    document.body.append(this.drawer, this.perf);

    // 4. Time the game's frame phases (the game uses a no-op timer otherwise).
    this.timer = new PhaseTimer();
    ui.profiler = this.timer;

    // 5. The ` key opens and closes the drawer; readouts refresh twice a second.
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote' && !/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName ?? '')) this.setOpen(!this.state.open);
    }, options);
    this.interval = setInterval(() => this.refresh(), REFRESH_MS);
    signal?.addEventListener('abort', () => this.dispose(), { once: true });
    this.setOpen(this.state.open);
    this.setPerf(this.state.perf);
  }

  // ---- Showing ----

  setOpen(open) {
    this.state.open = Boolean(open);
    this.drawer.hidden = !this.state.open;
    this.toggle.setAttribute('aria-expanded', String(this.state.open));
    this.toggle.classList.toggle('on', this.state.open);
    if (this.state.open) this.mountTuning();
    this.save();
    this.refresh();
  }

  // The tuning panel and Tweakpane are downloaded the first time the drawer
  // opens (dynamic import), so the rest of the tools stay small.
  mountTuning() {
    if (this.tuning) return;
    this.tuning = import('./TuningPanel.js')
      .then(({ createTuningPanel }) => {
        if (this.disposed) return null;
        this.tuningPanel = createTuningPanel({ container: this.tuningSection });
        return this.tuningPanel;
      })
      .catch((error) => {
        this.tuningSection.append(Object.assign(document.createElement('small'), { textContent: `Tuning panel failed to load: ${error.message}` }));
        return null;
      });
  }

  setPerf(on) {
    this.state.perf = Boolean(on);
    this.perf.hidden = !this.state.perf;
    this.save();
    this.refresh();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* Private storage: remembered for this page only. */ }
  }

  // Where the live tuning panel goes: the TUNING section.
  get tuningSection() {
    return this.drawer.querySelector('[data-dev-section="tuning"]');
  }

  // ---- Readouts (twice a second, only what is on screen) ----

  refresh() {
    if (this.state.open) {
      const label = this.playtest.brainLabel;
      const { status } = this.playtest.brain.describe();
      setText(this.facts.badge, label?.textContent ?? '');
      setText(this.facts.details, label?.title || 'no details yet');
      setText(this.facts.status, status);
    }
    if (this.state.perf) setText(this.perf, perfText(this.timer.stats(), rendererCounts(this.engine.renderer?.info)));
  }

  // ---- Clean-up ----

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.interval);
    this.tuningPanel?.dispose();
    if (this.ui.profiler === this.timer) this.ui.profiler = NO_TIMER;
    document.body.classList.remove('dev-tools');
    this.toggle.remove();
    this.drawer.remove();
    this.perf.remove();
  }
}

// Only touch the page when a readout actually changes.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}
