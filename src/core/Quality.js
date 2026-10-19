// Graphics quality: three presets that trade looks for speed, picked
// automatically for the device and overridable with ?quality=low|medium|high
// (or a remembered choice, see setQualityPreference). Designer-tunable: every
// number below is a plain setting; change it here, not in the rendering code.

// ---- The presets ----
//   pixelRatio      most screen pixels drawn per CSS pixel (2 = sharp on retina)
//   antialias       smooth jagged edges (MSAA)
//   shadowMapSize   sun shadow texture size in pixels (bigger = crisper shadows)
//   softShadows     soft-edged shadow filtering
//   shadowNormalBias  pushes shadow tests off surfaces (world units) so the
//                   coarser low-quality shadow map doesn't speckle flat floors
//   shadowMinSize   map props smaller than this (bounding radius, world units)
//                   don't cast shadows; 0 = everything casts. The floor and
//                   perimeter walls always cast.
//   leaperShadowMinSize  the same for the Leaper's parts (joints, plates and
//                   lights inside the outline of its legs and body); its body
//                   shell and long leg segments are far bigger and always cast
//   bloom           glow around the Leaper's eye, laser bolts and muzzle flashes
//                   (null = off); strength, blur radius, and the glow buffer's
//                   size as a share of the screen
//   sky             the junkyard's soft sky gradient (off = the flat horizon colour)
//   dust            dust puffs under the Leaper's feet
//   decals          scorch marks left by impacts (sparks always show)
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    pixelRatio: 1, antialias: false, shadowMapSize: 1024, softShadows: false, shadowNormalBias: 0.04,
    shadowMinSize: 0.8, leaperShadowMinSize: 0.45,
    bloom: null, sky: false, dust: false, decals: false,
  }),
  medium: Object.freeze({
    pixelRatio: 1.5, antialias: true, shadowMapSize: 2048, softShadows: true, shadowNormalBias: 0,
    shadowMinSize: 0.3, leaperShadowMinSize: 0.3,
    bloom: Object.freeze({ strength: 0.9, radius: 0.45, resolution: 0.5 }), sky: true, dust: true, decals: false,
  }),
  high: Object.freeze({
    pixelRatio: 2, antialias: true, shadowMapSize: 2048, softShadows: true, shadowNormalBias: 0,
    shadowMinSize: 0.15, leaperShadowMinSize: 0.15,
    bloom: Object.freeze({ strength: 1.0, radius: 0.5, resolution: 0.5 }), sky: true, dust: true, decals: true,
  }),
});
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY_PRESETS));

// The remembered choice in this browser (for a future settings menu).
export const QUALITY_KEY = 'leaper.quality';

// ---- Choosing a preset ----

// Remember (or forget, with null) a quality choice in this browser.
export function setQualityPreference(name) {
  try {
    if (name && QUALITY_NAMES.includes(name)) localStorage.setItem(QUALITY_KEY, name);
    else localStorage.removeItem(QUALITY_KEY);
  } catch { /* Private storage: the choice lasts for this page only. */ }
}

// What the device looks like, read once (each part can be overridden in tests).
export function describeDevice({ navigator: nav = globalThis.navigator, matchMedia = globalThis.matchMedia,
  devicePixelRatio = globalThis.devicePixelRatio, renderer = graphicsCardName() } = {}) {
  return {
    renderer: renderer ?? '',
    cores: nav?.hardwareConcurrency ?? 4,
    memory: nav?.deviceMemory ?? 8,
    touch: Boolean(matchMedia?.('(pointer: coarse)')?.matches),
    pixelRatio: devicePixelRatio ?? 1,
  };
}

// The automatic choice: software rendering (no graphics card) gets low; phones,
// tablets and small machines get medium; everything else high.
export function autoQuality(device) {
  if (/swiftshader|llvmpipe|software|basic render/i.test(device.renderer)) return 'low';
  if (device.touch || device.memory <= 4 || device.cores <= 4) return 'medium';
  return 'high';
}

// The preset to use: ?quality= in the address, else the remembered choice, else automatic.
export function pickQuality({ search = globalThis.location?.search ?? '', device = null } = {}) {
  const asked = new URLSearchParams(search).get('quality');
  if (QUALITY_NAMES.includes(asked)) return { name: asked, source: 'address' };
  let saved = null;
  try { saved = localStorage.getItem(QUALITY_KEY); } catch { /* Private storage. */ }
  if (QUALITY_NAMES.includes(saved)) return { name: saved, source: 'saved' };
  return { name: autoQuality(device ?? describeDevice()), source: 'auto' };
}

// The graphics card's name from a throwaway WebGL context (empty if unknown).
function graphicsCardName() {
  if (typeof document === 'undefined') return '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name ?? '');
  } catch {
    return '';
  }
}

// ---- Applying a preset to the scene ----

// Turn off shadows for meshes whose bounding ball (world units) is smaller than
// `minSize`; skip any subtree in `keep`. Returns how many stopped casting.
export function limitShadowCasters(root, minSize, { keep = [] } = {}) {
  if (!(minSize > 0)) return 0;
  let turnedOff = 0;
  const skip = new Set(keep.filter(Boolean));
  const visit = (object) => {
    if (skip.has(object)) return;
    if (object.isMesh && object.castShadow) {
      const geometry = object.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      object.updateWorldMatrix(true, false);
      const radius = geometry.boundingSphere.radius * object.matrixWorld.getMaxScaleOnAxis();
      if (radius < minSize) {
        object.castShadow = false;
        turnedOff += 1;
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return turnedOff;
}

// Get the graphics card ready before the first frame, so nothing stalls mid-
// fight: upload every texture (including those of hidden guns and clips, which
// would otherwise upload on first use) and compile every material's shader
// (three.js r128's compile() covers hidden objects too). render: optionally
// draw one frame as well, which also prepares the shadow and glow passes.
// Returns how many textures were uploaded and shader programs exist.
export function warmUp(renderer, scene, camera, { render = null } = {}) {
  // 1. Every texture once.
  const textures = new Set();
  scene.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) renderer.initTexture?.(texture);
  // 2. Every material's shader, then (optionally) one full frame.
  renderer.compile(scene, camera);
  render?.();
  return { textures: textures.size, programs: renderer.info?.programs?.length ?? 0 };
}
