const STORAGE_KEY = 'leaper.hud-layout.v1';

export function clampPanelPosition(x, y, width, height, viewportWidth, viewportHeight) {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, viewportWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, viewportHeight - height))),
  };
}

// Double-tap and hold the second tap, or double-click then drag within 3 seconds.
export function enableMovableHud() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* Private storage. */ }
  if (!saved || typeof saved !== 'object') saved = {};
  const selectors = ['.hud', '#status', '#cameraToggle', '#cuboidToggle', '#topViewHint',
    '#junkyardPanel', '#joyBase', '#btnSprint', '#btnJump'];
  const entries = selectors.map((selector) => [selector, document.querySelector(selector)])
    .filter(([, element]) => element);
  for (const [key, element] of entries) {
    element.classList.add('movable-hud');
    element.title = `${element.title ? `${element.title} · ` : ''}Double-tap and drag to move`;
    let lastTap = null;
    let drag = null;
    let armedUntil = 0;
    let suppressClick = false;
    let pendingClick;
    let replaying = false;
    const position = (x, y) => {
      const rect = element.getBoundingClientRect();
      const p = clampPanelPosition(x, y, rect.width, rect.height, innerWidth, innerHeight);
      Object.assign(element.style, { position: 'fixed', left: `${p.x}px`, top: `${p.y}px`,
        right: 'auto', bottom: 'auto', transform: 'none', margin: '0' });
      return p;
    };
    const restore = () => {
      if (!saved[key] || !Number.isFinite(saved[key].x) || !Number.isFinite(saved[key].y)
        || !element.getClientRects().length) return;
      position(saved[key].x * innerWidth, saved[key].y * innerHeight);
    };
    restore();
    window.addEventListener('resize', restore);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(restore).observe(element);
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('input, select')) return;
      const now = performance.now();
      const twice = lastTap && now - lastTap.time < 350
        && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 24;
      lastTap = { time: now, x: event.clientX, y: event.clientY };
      if (!twice && now > armedUntil) return;
      clearTimeout(pendingClick);
      const rect = element.getBoundingClientRect();
      drag = { pointer: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top,
        startX: event.clientX, startY: event.clientY, moved: false };
      armedUntil = now + 3000;
      suppressClick = true;
      element.classList.add('hud-dragging');
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    element.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      const p = position(event.clientX - drag.x, event.clientY - drag.y);
      saved[key] = { x: p.x / innerWidth, y: p.y / innerHeight };
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    const end = (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      if (drag.moved) { armedUntil = 0; lastTap = null; }
      drag = null;
      element.classList.remove('hud-dragging');
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Optional preference. */ }
      event.stopImmediatePropagation();
    };
    element.addEventListener('pointerup', end, true);
    element.addEventListener('pointercancel', end, true);
    element.addEventListener('click', (event) => {
      if (replaying || event.detail === 0) return;
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const button = event.target.closest('button');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearTimeout(pendingClick);
      pendingClick = setTimeout(() => {
        replaying = true;
        button.click();
        replaying = false;
      }, 350);
    }, true);
  }
}
