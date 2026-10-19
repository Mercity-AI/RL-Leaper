import '../styles/ui/weapon-hud.css';

// The weapon icons in the bottom-right corner, as a self-contained view. The
// equipped gun's circle is larger and filled with colour that drains with its
// magazine: red when nearly empty, cyan refilling while it reloads. It builds its
// own markup from the slot list it is given and only ever reads plain data.

// Simple side-on silhouettes (64 x 64 drawing space), by WEAPONS[id].icon.
const ICONS = Object.freeze({
  pistol: '<svg class="gun-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 22h38v4h3v6H32l-2 4h-6l-3 14h-9l3-16h-3z"/></svg>',
  rifle: '<svg class="gun-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M3 27h10l3-2h22v-3h6v3h8v2h9v3h-9v3H40l-1 2h-4l2 11h-6l-2-11h-3l-2 6h-6l2-6h-4l-6 4H5l2-6H3z"/></svg>',
});

// A magazine at or below this share shows as "low" (red).
const LOW_AMMO = 0.25;

export class WeaponHudView {
  // slots: [{ id, key, label, icon }], shown left to right in key order (1, 2...).
  constructor(parent = document.body, { slots }) {
    // 1. Build the markup once.
    const ordered = [...slots].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    this.element = document.createElement('div');
    this.element.id = 'playerGuns';
    this.element.className = 'weapon-hud';
    this.element.setAttribute('aria-label', 'Weapons and ammunition');
    this.element.innerHTML = `<div class="gun-row">${ordered.map(slot => `
      <div class="gun" data-gun="${slot.id}" title="${slot.label}"><i class="gun-fill"></i>${ICONS[slot.icon] ?? ''}<span class="gun-tag">${slot.key}</span></div>`).join('')}
    </div>`;
    parent.append(this.element);
    // 2. Each gun's circle, by weapon id.
    this.slots = new Map(ordered.map(slot => [slot.id, this.element.querySelector(`[data-gun="${slot.id}"]`)]));
    // 3. What was last drawn, so the page is only touched when something changes
    //    (the game hands over its data several times a frame).
    this.last = {};
  }

  // state: {
  //   visible, reloading (the equipped gun), empty (the equipped gun, not reloading),
  //   guns: [{ id, active, fraction (0..1: magazine share, or reload progress), reloading, empty }]
  // }
  update(state) {
    // 1. The whole HUD: shown while the gun can be used; reload / empty states.
    this.set('visible', Boolean(state.visible), (visible) => { this.element.hidden = !visible; });
    this.set('reloading', Boolean(state.reloading), (value) => { this.element.dataset.reloading = String(value); });
    this.set('empty', Boolean(state.empty), (value) => { this.element.dataset.empty = String(value); });
    // 2. Each gun's circle: equipped or not, its ammo level and how full it is.
    for (const gun of state.guns) {
      const slot = this.slots.get(gun.id);
      if (!slot) continue;
      const level = gun.reloading ? 'reloading' : gun.empty ? 'empty' : gun.fraction <= LOW_AMMO ? 'low' : 'ok';
      this.set(`${gun.id}.active`, Boolean(gun.active), (value) => { slot.dataset.active = String(value); });
      this.set(`${gun.id}.level`, level, (value) => { slot.dataset.level = value; });
      this.set(`${gun.id}.ammo`, gun.fraction.toFixed(3), (value) => slot.style.setProperty('--ammo', value));
    }
  }

  // Run `apply(value)` only when a value differs from the one last drawn.
  set(key, value, apply) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  // The session is over: the icons leave the page.
  dispose() {
    this.element.remove();
  }
}
