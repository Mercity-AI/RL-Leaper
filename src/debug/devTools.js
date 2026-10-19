// The developer tools' front door, the only part in the game's own file: it
// decides whether this page gets them and loads them on demand, so players
// never download the tools (finding game-architecture-dev-tools-in-shipping-build).
//
// The tools come with ?dev in the address, or always on the dev server
// (`pnpm dev`, import.meta.env.DEV); ?dev=0 hides them there too, to see the
// game exactly as a player does.

const OFF = ['0', 'false', 'off', 'no'];

// search: the page address's query. dev: running on the dev server.
export function wantsDevTools({ search = globalThis.location?.search ?? '', dev = Boolean(import.meta.env?.DEV) } = {}) {
  const value = new URLSearchParams(search).get('dev');
  if (value !== null) return !OFF.includes(value.toLowerCase());
  return Boolean(dev);
}

// Download and open the tools (src/debug/DevPanel.js). context: what they work
// on ({ ui, playtest, engine, signal }). Resolves with the panel.
export async function loadDevTools(context) {
  const { createDevPanel } = await import('./DevPanel.js');
  return createDevPanel(context);
}
