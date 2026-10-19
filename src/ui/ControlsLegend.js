import { CONTROLS } from '../input/actions.js';
import { WEAPONS } from '../config/weapons.js';
import { CAMERA } from '../config/camera.js';

// The controls legend (review fix 5.24), generated from the input action
// bindings (src/input/actions.js), so it can never disagree with what the game
// listens to. The same rows feed the CONTROLS screen, the H overlay in play and
// the README's controls table (scripts/print-controls.mjs).

// The lab-only keys that still nudge Lola are left out of the player's legend.
const HIDDEN = new Set(['nudge']);

// How much the sights magnify (every gun's own zoom; the camera's if they agree).
function aimZoomText(weapons = WEAPONS) {
  const zooms = [...new Set(Object.values(weapons).map((weapon) => weapon.ads?.zoom ?? CAMERA.aimZoom))];
  return zooms.map((zoom) => `×${zoom}`).join(' / ');
}

// One row per action: { action, label, keyboard, gamepad, touch, hold }. The aim
// row names the zoom (from the guns' data); keys held for the action say "(hold)".
export function legendRows(controls = CONTROLS, { weapons = WEAPONS } = {}) {
  return controls.filter((row) => !HIDDEN.has(row.action)).map((row) => ({
    ...row,
    label: row.action === 'aim' ? `${row.label} (${aimZoomText(weapons)} zoom)` : row.label,
    keyboard: row.keyboard && row.hold ? `${row.keyboard} (hold)` : row.keyboard,
  }));
}

// The legend as a Markdown table (for the README).
export function controlsMarkdown(rows = legendRows()) {
  const cell = (text) => (text ? String(text).replace(/\|/g, '\\|') : '—');
  return [
    '| Action | Keyboard and mouse | Gamepad | Touch |',
    '|---|---|---|---|',
    ...rows.map((row) => `| ${cell(row.label)} | ${cell(row.keyboard)} | ${cell(row.gamepad)} | ${cell(row.touch)} |`),
  ].join('\n');
}

// The page side: a table with one column per device. `devices` picks the
// columns ('keyboard' | 'gamepad' | 'touch'), e.g. only touch on a phone.
export class ControlsLegend {
  constructor(parent = null, { rows = legendRows(), devices = ['keyboard', 'gamepad', 'touch'], caption = 'Controls' } = {}) {
    const heads = { keyboard: 'Keyboard and mouse', gamepad: 'Gamepad', touch: 'Touch' };
    // 1. Build the table once (escaped text only; the rows never change in play).
    this.element = document.createElement('table');
    this.element.className = 'controls-legend';
    const head = this.element.createTHead().insertRow();
    for (const text of ['Action', ...devices.map((device) => heads[device])]) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      head.append(th);
    }
    const body = this.element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.label;
      tr.append(th);
      for (const device of devices) tr.insertCell().textContent = row[device] || '—';
    }
    this.element.createCaption().textContent = caption;
    parent?.append(this.element);
  }

  dispose() {
    this.element.remove();
  }
}
