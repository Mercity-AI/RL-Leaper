import { VitalsView } from './VitalsView.js';
import { ReticleView } from './ReticleView.js';
import { WeaponHudView } from './WeaponHudView.js';
import { TouchControls } from './TouchControls.js';
import { CaptionsView } from './captions.js';
import { ControlsLegend } from './ControlsLegend.js';
import { passivePresenter } from '../game/PlayerVitals.js';

// The game's HUD shell (finding ui-audio-dom-scattered-in-gameplay): the one
// owner of the player's on-screen display. It builds one root with a region per
// screen corner, mounts every HUD view there, and redraws them all from one
// plain-data snapshot per frame (update(snapshot)). Gameplay classes never touch
// the page for the HUD; they only expose numbers (PlayerVitals.view(),
// PlayerWeapon.hudState). Views write to the page only when a value changed, so
// an idle frame changes nothing (finding perf-hud-dom-writes-every-frame).
//
// Regions (styled in src/styles/junkyard.css):
//   top-left      the Leaper: its name plate, and the Leaper HUD view (mount point
//                 for src/ui/LeaperHudView.js: hud.addView('leaper', view,
//                 { region: 'top-left', select: (s) => s.leapers }))
//   top-centre    hints (the TOP view hint) and captions for sound cues
//   top-right     VIEW and the developer toggle
//   bottom-left   Lola's health (and the touch joystick on phones)
//   bottom-right  her guns (and SPRINT on phones)
//   centre        the crosshair (and the LEAPER POV crosshair), and the controls
//                 legend the H key shows over the fight
//   band          the touch controls (a layer of its own: the look area under the
//                 corners, the button band over them)
export const HUD_REGIONS = Object.freeze(['top-left', 'top-centre', 'top-right', 'bottom-left', 'bottom-right', 'centre']);

// The snapshot update() reads, all optional (missing parts are left as they are):
//   flow     the GameFlow state name ('loading' | 'ready' | 'playing' | 'paused' | 'ended')
//   menu     true while a menu screen covers the game (the corners hide)
//   vitals   Lola's numbers (PlayerVitals.view())
//   weapon   the guns' HUD data (PlayerWeapon.hudState: { reticle, weapons, touch, glow })
//   leapers  [{ health, max }] per Leaper, for views added with addView()
//   dt       game time since the last frame (0 while paused), for the captions

export class Hud {
  // parent: where the HUD goes (the page body).
  // weaponSlots: the gun icons, [{ id, key, label, icon }] in any order.
  // touch: null on a desktop, or { buttons, onDown(action), onUp(action), onLook(dx, dy) }
  //   for the touch band (src/input/touch.js touchButtons(), wired to the input actions).
  constructor({ parent = document.body, weaponSlots = [], touch = null } = {}) {
    // 1. The root, one element per region, the touch layer and the screen-edge flashes.
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.className = 'hud-root';
    this.root.dataset.flow = 'loading';
    this.edges = { danger: this.edge('danger'), reward: this.edge('reward') };
    this.regions = new Map(HUD_REGIONS.map((name) => {
      const region = document.createElement('div');
      region.className = 'hud-region';
      region.dataset.region = name;
      this.root.append(region);
      return [name, region];
    }));
    this.band = document.createElement('div');
    this.band.className = 'hud-band';
    this.root.append(this.band);
    // 2. One polite announcement line for screen readers, used only for real
    //    events (paused, the fight is over), never for per-frame readouts.
    this.announcer = document.createElement('div');
    this.announcer.className = 'visually-hidden';
    this.announcer.setAttribute('role', 'status');
    this.announcer.setAttribute('aria-live', 'polite');
    this.root.append(this.announcer);
    parent.append(this.root);

    // 3. The views the HUD itself owns: Lola's health, the crosshair, the gun
    //    icons and (touch screens only) the touch band.
    this.views = {
      vitals: new VitalsView(this.regions.get('bottom-left')),
      reticle: new ReticleView(this.regions.get('centre')),
      weapons: new WeaponHudView(this.regions.get('bottom-right'), { slots: weaponSlots }),
      touch: touch ? new TouchControls(this.band, touch) : null,
      captions: new CaptionsView(this.regions.get('top-centre')),
    };
    // 4. The controls legend over the fight (H), and a short hint line.
    this.legend = this.panel('hud-legend', 'centre', 'Controls');
    this.legend.insertAdjacentHTML('beforeend', '<h2>CONTROLS</h2>');
    new ControlsLegend(this.legend, { devices: touch ? ['touch', 'gamepad'] : ['keyboard', 'gamepad'] });
    this.hintLine = this.panel('hud-hint', 'top-centre');
    this.hintLeft = 0;
    // Captions only show when the player asked for them (Settings).
    this.captionsOn = false;
    // Views other code adds (addView), each with the part of the snapshot it reads.
    this.extra = [];
    // Page elements moved in from elsewhere (adopt), to put back on dispose().
    this.adopted = [];
    // 5. What was last drawn by the shell itself (and a reused touch state).
    this.last = {};
    this.touchState = {};
  }

  // ---- Building ----

  // One screen-edge flash layer ('danger' red, 'reward' blue).
  edge(kind) {
    const element = document.createElement('div');
    element.className = 'hud-edge';
    element.dataset.edge = kind;
    element.setAttribute('aria-hidden', 'true');
    this.root.append(element);
    return element;
  }

  // A hidden panel of the HUD's own in a region.
  panel(className, region, label = '') {
    const element = document.createElement('div');
    element.className = className;
    element.hidden = true;
    if (label) element.setAttribute('aria-label', label);
    this.region(region).append(element);
    return element;
  }

  // A region's element by name (see HUD_REGIONS).
  region(name) {
    const region = this.regions.get(name);
    if (!region) throw new Error(`Unknown HUD region: ${name}`);
    return region;
  }

  // Put an element that lives elsewhere on the page (the VIEW button, the
  // Leaper's name plate, the joystick) into a region. Its listeners stay; on
  // dispose() it goes back where it came from.
  adopt(name, element) {
    if (!element) return null;
    this.adopted.push({ element, parent: element.parentNode, next: element.nextSibling });
    this.region(name).append(element);
    return element;
  }

  // Add a view other code built: view.element (or view.root) goes into `region`,
  // and every update() calls view.update(select(snapshot)) (skipped while select
  // returns undefined).
  addView(name, view, { region = 'top-left', select = (snapshot) => snapshot[name] } = {}) {
    const element = view.element ?? view.root;
    if (element) this.region(region).append(element);
    const entry = { name, view, select };
    this.extra.push(entry);
    return () => {
      this.extra = this.extra.filter((item) => item !== entry);
      element?.remove();
    };
  }

  // What gameplay code is given instead of drawing anything itself.
  // vitalsPresenter: for PlayerVitals (it then only keeps the numbers).
  get vitalsPresenter() {
    return passivePresenter(this.views.vitals.element);
  }

  // weaponViews: for PlayerWeapon (it fills hudState and the HUD draws it).
  get weaponViews() {
    const { reticle, weapons, touch } = this.views;
    return { reticle, weapons, touch };
  }

  // ---- Each frame ----

  // Redraw everything from this frame's snapshot (see the shape above).
  update(snapshot) {
    // 1. Which state the game is in (the CSS shows or hides the corners from it).
    const flow = snapshot.flow ?? this.last.flow ?? 'loading';
    const live = flow === 'playing' || flow === 'paused';
    this.change('flow', flow, (value) => { this.root.dataset.flow = value; });
    this.change('menu', Boolean(snapshot.menu), (value) => { this.root.dataset.menu = String(value); });
    // 2. Lola's health and the red edges at critical health.
    if (snapshot.vitals) {
      this.views.vitals.update(snapshot.vitals);
      this.strength('danger', live ? snapshot.vitals.edgeTint : 0);
    }
    // 3. The guns: crosshair, icons, the touch band (shown only during play and
    //    pauses), and the blue reward glow after a big hit.
    const weapon = snapshot.weapon;
    if (weapon) {
      this.views.reticle.update(weapon.reticle);
      this.views.weapons.update(weapon.weapons);
      if (this.views.touch) this.views.touch.update(Object.assign(this.touchState, weapon.touch, { visible: live }));
      this.strength('reward', live ? weapon.glow ?? 0 : 0);
    }
    // 4. Captions and the hint line run on game time (they hold while paused).
    this.views.captions.update(snapshot.dt ?? 0);
    if (this.hintLeft > 0) {
      this.hintLeft -= snapshot.dt ?? 0;
      if (this.hintLeft <= 0) this.hintLine.hidden = true;
    }
    // 5. Views added by other code.
    for (const { view, select } of this.extra) {
      const part = select(snapshot);
      if (part !== undefined) view.update?.(part);
    }
  }

  // A screen-edge flash's strength (0-1), written in hundredths and only on a change.
  strength(kind, value) {
    const rounded = Math.round((value || 0) * 100) / 100;
    this.change(`edge.${kind}`, rounded, (amount) => this.edges[kind].style.setProperty('--strength', String(amount)));
  }

  // The controls legend over the fight: toggle, or set on / off.
  toggleLegend() {
    this.setLegend(this.legend.hidden);
  }

  setLegend(on) {
    this.legend.hidden = !on;
  }

  // A short line under the top of the screen for `seconds` of play.
  hint(text, seconds = 5) {
    this.hintLine.textContent = text;
    this.hintLine.hidden = false;
    this.hintLeft = seconds;
  }

  // A caption for a sound cue (src/ui/captions.js), when captions are on.
  caption(text) {
    if (this.captionsOn) this.views.captions.add(text);
  }

  // Captions on or off (Settings > Accessibility).
  setCaptions(on) {
    this.captionsOn = Boolean(on);
    if (!this.captionsOn) this.views.captions.clear();
  }

  // HUD layout editing (Settings > EDIT HUD LAYOUT): every corner shows, over the menus.
  setEditing(on) {
    this.root.dataset.editing = String(Boolean(on));
  }

  // Say something to screen readers (only when it differs from the last line).
  announce(text) {
    this.change('announce', text, (value) => { this.announcer.textContent = value; });
  }

  // Run `apply(value)` only when a value differs from the one last drawn.
  change(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  // ---- Clean-up ----

  // The session is over: the HUD leaves the page and borrowed elements go back.
  dispose() {
    for (const { element, parent, next } of this.adopted.splice(0).reverse()) {
      if (parent) parent.insertBefore(element, next?.parentNode === parent ? next : null);
    }
    this.views.touch?.dispose();
    for (const view of [this.views.vitals, this.views.reticle, this.views.weapons, this.views.captions]) view.dispose();
    this.root.remove();
  }
}
