// "PAUSED: click to resume" over the game view while GameFlow is paused (review
// fix 5.16). It covers the 3D view only (the toolbar and HUD stay on top), so the
// click that resumes lands on the overlay and can never fire Lola's gun.
export class PauseOverlay {
  // onResume(): called by a click on the overlay (the game resumes and grabs the mouse).
  constructor({ onResume, signal = null }) {
    this.element = document.createElement('div');
    this.element.id = 'pauseOverlay';
    this.element.hidden = true;
    this.element.setAttribute('role', 'button');
    this.element.setAttribute('aria-label', 'Paused. Click to resume');
    this.element.innerHTML = '<strong>PAUSED: click to resume</strong><small>or use RESUME in the toolbar</small>';
    document.body.append(this.element);
    // (An AbortSignal removes both listeners when the game session is torn down.)
    const options = signal ? { signal } : {};
    // The resume click must not reach the canvas underneath (no shot, no camera drag).
    this.element.addEventListener('pointerdown', (event) => event.stopPropagation(), options);
    this.element.addEventListener('click', (event) => {
      event.stopPropagation();
      onResume();
    }, options);
  }

  // Show it exactly while the game state is Paused.
  render(state) {
    this.element.hidden = state.name !== 'paused';
  }

  // The session is over: the overlay leaves the page (its listeners go with the signal).
  dispose() {
    this.element.remove();
  }
}
