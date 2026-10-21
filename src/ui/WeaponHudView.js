import '../styles/ui/weapon-hud.css';

// The weapon icons in the bottom-right corner, as a self-contained view. The
// equipped gun's circle is larger and filled with colour that drains with its
// magazine: red when nearly empty, cyan refilling while it reloads. Above them, a
// gun whose spare ammo runs out (the M416) shows one bullet icon per spare
// magazine it can carry: full ones lit yellow, a part-used one part lit, missing
// ones dark; new ones pop in when an ammo pickup is taken. It builds its own
// markup from the slot list it is given and only ever reads plain data.

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
    this.element.innerHTML = `<div class="spare-rows"></div><div class="gun-row">${ordered.map(slot => `
      <div class="gun" data-gun="${slot.id}" title="${slot.label}"><i class="gun-fill"></i>${ICONS[slot.icon] ?? ''}<span class="gun-tag">${slot.key}</span></div>`).join('')}
    </div>`;
    parent.append(this.element);
    // 2. Each gun's circle, by weapon id.
    this.slots = new Map(ordered.map(slot => [slot.id, this.element.querySelector(`[data-gun="${slot.id}"]`)]));
    // 3. Spare-magazine icons, built the first time a gun reports a limit.
    this.spareRows = new Map();
    // 4. What was last drawn, so the page is only touched when something changes
    //    (the game hands over its data several times a frame).
    this.last = {};
  }

  // state: {
  //   visible, reloading (the equipped gun), empty (the equipped gun, not reloading),
  //   guns: [{ id, active, fraction (0..1: magazine share, or reload progress), reloading, empty,
  //            spare (spare magazines, may be fractional; null = unlimited), spareMax (icons to show) }]
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
      if (gun.spare !== null && gun.spare !== undefined && gun.spareMax) this.updateSpares(gun);
    }
  }

  // One gun's spare-magazine icons: lit as far as its spares go.
  updateSpares(gun) {
    let row = this.spareRows.get(gun.id);
    if (!row || row.icons.length !== gun.spareMax) {
      row?.element.remove();
      const element = document.createElement('div');
      element.className = 'spare-row';
      element.dataset.gun = gun.id;
      element.setAttribute('aria-label', 'Spare magazines');
      element.innerHTML = '<i class="spare"></i>'.repeat(gun.spareMax);
      this.element.querySelector('.spare-rows').append(element);
      row = { element, icons: [...element.children], spare: gun.spare };
      this.spareRows.set(gun.id, row);
      // A fresh row: draw everything again.
      delete this.last[`${gun.id}.spare`];
      delete this.last[`${gun.id}.spareActive`];
    }
    this.set(`${gun.id}.spareActive`, Boolean(gun.active), (value) => { row.element.dataset.active = String(value); });
    this.set(`${gun.id}.spare`, gun.spare.toFixed(3), () => {
      row.icons.forEach((icon, i) => {
        const fill = Math.max(0, Math.min(1, gun.spare - i));
        icon.style.setProperty('--fill', fill.toFixed(3));
        // Icons that just got filled by a pickup pop in.
        const before = Math.max(0, Math.min(1, row.spare - i));
        if (fill > before + 1e-6) {
          icon.classList.remove('gained');
          void icon.offsetWidth; // restart the pop animation
          icon.classList.add('gained');
        }
      });
      row.spare = gun.spare;
      row.element.dataset.out = String(gun.spare <= 0);
    });
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
