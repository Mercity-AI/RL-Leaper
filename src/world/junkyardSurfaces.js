import * as THREE from 'three';

// The yard's floor and perimeter walls: their colours and the dirt drawn over
// them (designer-tunable). The dirt is worked out in the shader from each
// point's position in the yard, so it costs no texture download and never
// repeats. Colours are as they appear on screen; sizes are in map units (the
// yard is about 78 x 73).
export const JUNKYARD_SURFACES = Object.freeze({
  floor: Object.freeze({
    // Packed, dusty earth: a warm grey-brown.
    // (The yard is brightly lit: these read about twice as light on screen.)
    colour: 0x3f372d,
    // Big darker patches of mud and old dirt, about patchSize across.
    dirt: 0x211b15, patchSize: 14, patchAmount: 0.8,
    // Lighter dry dust between them.
    dust: 0x564b3c, dustAmount: 0.45,
    // Scattered oil stains: near black and a little glossy. Higher coverage = more stains.
    oil: 0x0f0d0b, oilSize: 5, oilCoverage: 0.2,
    // Fine grit over everything (0 = smooth).
    grit: 0.18,
    roughness: 0.95,
  }),
  walls: Object.freeze({
    // Weathered dark steel, darker than the floor.
    colour: 0x3c3f41,
    // Rust and rain streaks running down from the top.
    rust: 0x5b3c28, rustAmount: 0.55,
    streak: 0x232220, streakAmount: 0.6,
    // Mud splashed up the bottom of the wall, this high (map units).
    grime: 0x3a3229, grimeHeight: 1.6,
    grit: 0.08,
    roughness: 0.85,
  }),
});

// Props recoloured over the baked texture (owner, 2026-10-21). parts: the
// Blender object names, matched from the start (the loader writes spaces as
// underscores and drops dots, so "corrugation.001" still matches its part).
// tint multiplies the baked colours; panels replace a part's colour outright
// (plain colour, no texture).
export const JUNKYARD_PROP_COLOURS = Object.freeze([
  // The open, toppled yellow container by the south wall and the long side torn
  // off it: a duller, dirtier yellow, and its grey inside wall yellow to match.
  Object.freeze({
    parts: ['03 - southern fallen freight', 'Yellow container - torn off long side lying on ground'],
    tint: 0xb3a57e,
    panels: Object.freeze({ '03 - southern fallen freight | floor': 0x8a7a4c }),
  }),
]);

// Gradient noise (smooth, no blocky grid look) with a well-mixed hash, and
// layers that are each rotated so no layer lines up with the yard's axes.
const NOISE = /* glsl */ `
  vec3 grimeHash3(vec3 p) {
    p = mod(p, 289.0);
    vec3 h = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(h) * 43758.5453) * 2.0 - 1.0;
  }
  float grimeNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(grimeHash3(i), f);
    float n100 = dot(grimeHash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0));
    float n010 = dot(grimeHash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0));
    float n110 = dot(grimeHash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0));
    float n001 = dot(grimeHash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1));
    float n101 = dot(grimeHash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1));
    float n011 = dot(grimeHash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1));
    float n111 = dot(grimeHash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1));
    float n = mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                  mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
    return clamp(n * 0.9 + 0.5, 0.0, 1.0);
  }
  // Each layer: about twice as fine, turned by an odd angle, shifted.
  const mat3 grimeTurn = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
  float grimeFbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int octave = 0; octave < 5; octave++) { sum += amp * grimeNoise(p); p = grimeTurn * p * 2.07 + 5.3; amp *= 0.5; }
    return sum / 0.96875;
  }
`;

// Floor: mud patches, dry dust, oil stains, grit.
// The large, slow parts of the floor (mud patches, dust, oil, colour shifts)
// as four numbers for a point on the floor (x, z in map units).
const FLOOR_FIELDS = /* glsl */ `
  vec4 grimeFloorFields(vec2 xz) {
    // Warp the floor's coordinates by a slow noise first, so patch edges wander
    // instead of forming rounded blobs.
    vec2 warp = vec2(grimeFbm(vec3(xz * 0.05, 3.1)), grimeFbm(vec3(xz * 0.05 + 7.7, 6.4))) - 0.5;
    vec2 q = xz + warp * grimePatchSize * 0.5;
    float patches = smoothstep(0.38, 0.72, grimeFbm(vec3(q / grimePatchSize, 1.7)));
    float dust = smoothstep(0.5, 0.78, grimeFbm(vec3(q / (grimePatchSize * 0.55), 9.3)));
    float oil = smoothstep(1.0 - grimeOilCoverage, 1.0 - grimeOilCoverage + 0.05,
      grimeFbm(vec3(q / grimeOilSize, 4.1)) * 0.8 + grimeNoise(vec3(q * 0.9, 2.0)) * 0.2);
    // Slow warm / cool shifts in the earth itself (not just lighter and darker).
    float tint = grimeFbm(vec3(q * 0.09, 12.5));
    return vec4(patches, dust, oil, tint);
  }
`;

const FLOOR_SHADE = /* glsl */ `
  vec3 p = vGrimePosition;
  // Baked once at load (bakeJunkyardSurfaces) and looked up, or worked out here.
  #ifdef GRIME_BAKED
    vec4 fields = texture2D(grimeField, (p.xz - grimeFieldMin) / grimeFieldSize);
  #else
    vec4 fields = grimeFloorFields(p.xz);
  #endif
  float patches = fields.r, dust = fields.g, oil = fields.b, tint = fields.a;
  vec3 surface = diffuseColor.rgb * mix(vec3(0.86, 0.93, 1.02), vec3(1.14, 1.0, 0.84), tint);
  surface = mix(surface, grimeDust, dust * grimeDustAmount);
  surface = mix(surface, grimeDirt, patches * grimePatchAmount);
  surface = mix(surface, grimeOil, oil * 0.85);
  // Grit: two fine, unaligned layers, faded out with distance so it never
  // shimmers far away.
  float near = 1.0 - smoothstep(6.0, 30.0, length(vViewPosition) / grimeScale);
  // Past the fade there is nothing to draw, so the noise isn't worked out there.
  if (near > 0.0) {
    // (Unwarped: warping fine detail smears it into streaks.)
    float grit = grimeFbm(vec3(p.xz * 2.3, 3.0)) * 0.6 + grimeNoise(vec3(p.xz * 7.9, 0.5)) * 0.4;
    surface *= 1.0 + grimeGrit * near * (grit - 0.5) * 2.2;
    // Pebbles and chips: small, soft-edged dark and light specks, scattered at random.
    float pebble = smoothstep(0.76, 0.86, grimeNoise(vec3(p.xz * 9.0, 21.0)));
    float chip = smoothstep(0.8, 0.9, grimeNoise(vec3(p.xz * 11.0, 37.0)));
    surface *= 1.0 - 0.22 * pebble * near;
    surface = mix(surface, grimeDust * 1.15, 0.3 * chip * near);
  }
  diffuseColor.rgb = surface;
  float grimeGloss = oil;
`;

// Walls: rust and dark streaks running down, mud along the bottom, grit. The
// tops of the walls get the streak colour only. Their streaks, rust and the
// wobble of the mud line, for a point `along` the wall at height y (map units):
const WALL_FIELDS = /* glsl */ `
  vec3 grimeWallFields(float along, float y) {
    float drip = smoothstep(0.45, 0.85, grimeFbm(vec3(along * 0.9, y * 0.06, 5.0)))
      * mix(0.4, 1.0, smoothstep(0.0, 9.0, y));
    float rust = smoothstep(0.5, 0.8, grimeFbm(vec3(along * 0.35, y * 0.12, 11.0)))
      * mix(0.55, 1.0, grimeNoise(vec3(along * 3.0, y * 0.4, 6.0)));
    float wobble = grimeNoise(vec3(along * 1.5, 0.0, 8.0));
    return vec3(drip, rust, wobble);
  }
`;

const WALL_SHADE = /* glsl */ `
  vec3 p = vGrimePosition;
  float along = abs(vGrimeNormal.x) > abs(vGrimeNormal.z) ? p.z : p.x;
  float upright = 1.0 - abs(vGrimeNormal.y);
  #ifdef GRIME_BAKED
    vec3 fields = texture2D(grimeField, (vec2(along, p.y) - grimeFieldMin) / grimeFieldSize).rgb;
  #else
    vec3 fields = grimeWallFields(along, p.y);
  #endif
  float drip = fields.r, rust = fields.g;
  float splash = (1.0 - smoothstep(0.0, grimeHeight, p.y + (fields.b - 0.5) * grimeHeight * 0.6));
  vec3 surface = mix(diffuseColor.rgb, grimeRust, rust * grimeRustAmount * upright);
  surface = mix(surface, grimeStreak, drip * grimeStreakAmount);
  surface = mix(surface, grimeMud, splash * upright * 0.9);
  surface *= 1.0 + grimeGrit * (grimeNoise(vec3(along * 5.0, p.y * 5.0, 3.0)) - 0.5) * 2.0;
  diffuseColor.rgb = surface;
  float grimeGloss = 0.0;
`;

function linear(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

// Dress one of the yard's materials as floor or wall. scale: the map's scale,
// so the dirt keeps its size in map units at every Leaper size. bounds: the
// yard's extent in map units ({ min, max }), what a baked picture covers.
function dress(material, kind, scale, bounds) {
  const look = JUNKYARD_SURFACES[kind];
  material.color.copy(linear(look.colour));
  material.roughness = look.roughness;
  material.metalness = 0;
  const uniforms = kind === 'floor' ? {
    grimeDirt: { value: linear(look.dirt) }, grimePatchSize: { value: look.patchSize }, grimePatchAmount: { value: look.patchAmount },
    grimeDust: { value: linear(look.dust) }, grimeDustAmount: { value: look.dustAmount },
    grimeOil: { value: linear(look.oil) }, grimeOilSize: { value: look.oilSize }, grimeOilCoverage: { value: look.oilCoverage },
  } : {
    grimeRust: { value: linear(look.rust) }, grimeRustAmount: { value: look.rustAmount },
    grimeStreak: { value: linear(look.streak) }, grimeStreakAmount: { value: look.streakAmount },
    grimeMud: { value: linear(look.grime) }, grimeHeight: { value: look.grimeHeight },
  };
  uniforms.grimeGrit = { value: look.grit };
  uniforms.grimeScale = { value: scale };
  // The baked fields (bakeJunkyardSurfaces): the picture, and the map-unit
  // rectangle it covers (floor: x and z; walls: along the wall, and height).
  const field = { grimeField: { value: null }, grimeFieldMin: { value: new THREE.Vector2() },
    grimeFieldSize: { value: new THREE.Vector2(1, 1) } };
  BAKES.set(material, { kind, uniforms, field, bounds });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, field);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float grimeScale;\nvarying vec3 vGrimePosition;\nvarying vec3 vGrimeNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrimePosition = (modelMatrix * vec4(transformed, 1.0)).xyz / grimeScale;
        vGrimeNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    const declarations = Object.entries(uniforms)
      .map(([name, { value }]) => `uniform ${value.isColor ? 'vec3' : 'float'} ${name};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${declarations}\n${FIELD_DECLARATIONS}\nvarying vec3 vGrimePosition;\nvarying vec3 vGrimeNormal;\n${NOISE}\n`
        + (kind === 'floor' ? FLOOR_FIELDS : WALL_FIELDS))
      .replace('#include <color_fragment>', `#include <color_fragment>\n${kind === 'floor' ? FLOOR_SHADE : WALL_SHADE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, grimeGloss);');
  };
  material.customProgramCacheKey = () => `junkyard-${kind}-${material.defines?.GRIME_BAKED === undefined ? 'live' : 'baked'}`;
  material.needsUpdate = true;
}

// Each dressed material's bake job (what it needs to be baked, and its picture
// once it is). Kept off the material so a clone (a camera fade) never shares it.
const BAKES = new WeakMap();

const FIELD_DECLARATIONS ='uniform sampler2D grimeField;\nuniform vec2 grimeFieldMin;\nuniform vec2 grimeFieldSize;';

// Dress the yard's own floor and wall materials (junkyard_v2's Cube: a
// "... walls" and a "... ground" material). Other maps are left alone.
export function dressJunkyardSurfaces(floorParts, scale) {
  const done = new Set();
  // The yard's extent in map units (what the baked pictures cover).
  const box = new THREE.Box3();
  for (const mesh of floorParts) box.expandByObject(mesh);
  const bounds = { min: box.min.clone().divideScalar(scale), max: box.max.clone().divideScalar(scale) };
  for (const mesh of floorParts) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (done.has(material) || !material.isMeshStandardMaterial) continue;
      const kind = /wall/i.test(material.name) ? 'walls' : /ground|floor/i.test(material.name) ? 'floor' : null;
      if (!kind) continue;
      dress(material, kind, scale, bounds);
      done.add(material);
    }
  }
  return done.size;
}

// Recolour the props in JUNKYARD_PROP_COLOURS (see there). Returns how many
// meshes changed. Run before the map is batched: each new look is one material.
export function colourJunkyardProps(map, looks = JUNKYARD_PROP_COLOURS) {
  const plain = (name) => name.replace(/_/g, ' ');
  const made = new Map();
  const material = (source, key, build) => {
    const id = `${source.uuid}:${key}`;
    if (!made.has(id)) made.set(id, build(source.clone()));
    return made.get(id);
  };
  let count = 0;
  map.traverse((object) => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    const name = plain(object.name);
    const look = looks.find(({ parts }) => parts.some((part) => name.startsWith(plain(part))));
    if (!look) return;
    const panel = Object.entries(look.panels ?? {}).find(([part]) => name === plain(part));
    object.material = panel
      ? material(object.material, `panel:${panel[1]}`, (copy) => { copy.map = null; copy.color.copy(linear(panel[1])); return copy; })
      : material(object.material, `tint:${look.tint}`, (copy) => { copy.color.copy(linear(look.tint)); return copy; });
    count += 1;
  });
  return count;
}

// ---- Baking the slow parts once (owner, 2026-10-22: "fix the fps") ----
// Worked out live, the floor's dirt took 39 layers of noise per pixel every
// frame and the walls' 18. On the owner's laptop graphics that alone held the
// game near 20 fps whenever the camera looked across the yard. The large,
// slow parts (mud patches, dust, oil, colour shifts; wall streaks and rust)
// never change, so they are drawn once into a picture at load and only looked
// up after that. The fine grit and pebbles stay live (small, and they fade
// with distance). Picture sizes in pixels: the floor's covers the whole yard
// (about 26 pixels per map unit), the walls' runs the yard's length.
export const BAKE = Object.freeze({
  floor: Object.freeze({ width: 2048, height: 2048 }),
  walls: Object.freeze({ width: 4096, height: 256 }),
});

const BAKE_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Draw each dressed floor / wall material's fields into its picture and
// switch it to looking them up. roots: what holds the yard's materials (the
// map, its batched copy). Returns how many materials were baked.
export function bakeJunkyardSurfaces(renderer, roots) {
  const materials = new Set();
  for (const root of [roots].flat()) {
    root?.traverse((object) => [object.material].flat().forEach((material) => {
      if (BAKES.has(material) && !BAKES.get(material).target) materials.add(material);
    }));
  }
  if (!materials.size) return 0;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const previous = renderer.getRenderTarget();
  for (const material of materials) {
    const bake = BAKES.get(material);
    const { min, max } = bake.bounds;
    const floor = bake.kind === 'floor';
    // The rectangle in map units: floor x / z, or walls along / height.
    const lo = floor ? new THREE.Vector2(min.x, min.z) : new THREE.Vector2(Math.min(min.x, min.z), min.y);
    const hi = floor ? new THREE.Vector2(max.x, max.z) : new THREE.Vector2(Math.max(max.x, max.z), max.y);
    const span = hi.clone().sub(lo);
    const { width, height } = floor ? BAKE.floor : BAKE.walls;
    const target = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    target.texture.generateMipmaps = true;
    const declarations = Object.entries(bake.uniforms)
      .map(([name, { value }]) => `uniform ${value.isColor ? 'vec3' : 'float'} ${name};`).join('\n');
    quad.material = new THREE.ShaderMaterial({
      uniforms: { ...bake.uniforms, lo: { value: lo }, span: { value: span } },
      vertexShader: BAKE_VERTEX,
      fragmentShader: `${declarations}\nuniform vec2 lo;\nuniform vec2 span;\nvarying vec2 vUv;\n${NOISE}\n${floor ? FLOOR_FIELDS : WALL_FIELDS}
        void main() {
          vec2 at = lo + vUv * span;
          gl_FragColor = ${floor ? 'grimeFloorFields(at)' : 'vec4(grimeWallFields(at.x, at.y), 1.0)'};
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    quad.material.dispose();
    bake.target = target;
    material.addEventListener('dispose', () => target.dispose());
    bake.field.grimeField.value = target.texture;
    bake.field.grimeFieldMin.value.copy(lo);
    bake.field.grimeFieldSize.value.copy(span);
    material.defines = { ...material.defines, GRIME_BAKED: '' };
    material.needsUpdate = true;
  }
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  return materials.size;
}
