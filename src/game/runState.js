// What survives an APPLY SIZE reload. Changing the Leaper size rescales the whole
// map, Lola and every effect, and the brain service needs a fresh session at the
// new size, so the page still reloads (a fresh encounter is expected). This keeps
// the rest of the session: which mode was on, where Lola stood (in map units, so
// it carries over at any size), the camera, the equipped gun and the sound switch.

// sessionStorage key (this browser tab only); read once at boot, then cleared.
export const RUN_STATE_KEY = 'leaper.junkyard.resume.v1';

// The state to carry over. playMode: 'hunt' | 'explore' | null (a paused mode
// counts as that mode). world.scale turns world units into map units.
export function captureRunState({ playMode, player, cameraController, world, soundEnabled = true, optionsOpen = false }) {
  const lola = player.mesh;
  return {
    mode: playMode ?? null,
    lola: { x: lola.position.x / world.scale, z: lola.position.z / world.scale, yaw: lola.rotation.y },
    camera: { yaw: cameraController.yaw, pitch: cameraController.pitch, view: cameraController.mode },
    weaponIndex: player.weaponIndex ?? 0,
    sound: soundEnabled,
    options: optionsOpen,
  };
}

// Where Lola goes at the new size (world units), or null when that spot is not
// open ground at this size (then she keeps the map's default start).
export function restoredPlayerSpot(state, world) {
  const lola = state?.lola;
  if (!lola || !Number.isFinite(lola.x) || !Number.isFinite(lola.z)) return null;
  const x = lola.x * world.scale, z = lola.z * world.scale;
  if (world.playerBlocked?.(x, z)) return null;
  return { x, z, yaw: Number.isFinite(lola.yaw) ? lola.yaw : undefined };
}

// Save before the reload. Private browsing can refuse storage: then the reload
// simply starts fresh.
export function saveRunState(state, storage = globalThis.sessionStorage) {
  try { storage?.setItem(RUN_STATE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// Read once after the reload (and forget it, so a later reload starts fresh).
export function takeRunState(storage = globalThis.sessionStorage) {
  try {
    const text = storage?.getItem(RUN_STATE_KEY);
    storage?.removeItem(RUN_STATE_KEY);
    const state = text ? JSON.parse(text) : null;
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}
