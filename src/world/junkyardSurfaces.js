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
const FLOOR_SHADE = /* glsl */ `
  vec3 p = vGrimePosition;
  // Warp the floor's coordinates by a slow noise first, so patch edges wander
  // instead of forming rounded blobs.
  vec2 warp = vec2(grimeFbm(vec3(p.xz * 0.05, 3.1)), grimeFbm(vec3(p.xz * 0.05 + 7.7, 6.4))) - 0.5;
  vec2 q = p.xz + warp * grimePatchSize * 0.5;
  float patches = smoothstep(0.38, 0.72, grimeFbm(vec3(q / grimePatchSize, 1.7)));
  float dust = smoothstep(0.5, 0.78, grimeFbm(vec3(q / (grimePatchSize * 0.55), 9.3)));
  float oil = smoothstep(1.0 - grimeOilCoverage, 1.0 - grimeOilCoverage + 0.05,
    grimeFbm(vec3(q / grimeOilSize, 4.1)) * 0.8 + grimeNoise(vec3(q * 0.9, 2.0)) * 0.2);
  // Slow warm / cool shifts in the earth itself (not just lighter and darker).
  float tint = grimeFbm(vec3(q * 0.09, 12.5));
  vec3 surface = diffuseColor.rgb * mix(vec3(0.86, 0.93, 1.02), vec3(1.14, 1.0, 0.84), tint);
  surface = mix(surface, grimeDust, dust * grimeDustAmount);
  surface = mix(surface, grimeDirt, patches * grimePatchAmount);
  surface = mix(surface, grimeOil, oil * 0.85);
  // Grit: two fine, unaligned layers, faded out with distance so it never
  // shimmers far away.
  float near = 1.0 - smoothstep(6.0, 30.0, length(vViewPosition) / grimeScale);
  // (Unwarped: warping fine detail smears it into streaks.)
  float grit = grimeFbm(vec3(p.xz * 2.3, 3.0)) * 0.6 + grimeNoise(vec3(p.xz * 7.9, 0.5)) * 0.4;
  surface *= 1.0 + grimeGrit * near * (grit - 0.5) * 2.2;
  // Pebbles and chips: small, soft-edged dark and light specks, scattered at random.
  float pebble = smoothstep(0.76, 0.86, grimeNoise(vec3(p.xz * 9.0, 21.0)));
  float chip = smoothstep(0.8, 0.9, grimeNoise(vec3(p.xz * 11.0, 37.0)));
  surface *= 1.0 - 0.22 * pebble * near;
  surface = mix(surface, grimeDust * 1.15, 0.3 * chip * near);
  diffuseColor.rgb = surface;
  float grimeGloss = oil;
`;

// Walls: rust and dark streaks running down, mud along the bottom, grit. The
// tops of the walls get the streak colour only.
const WALL_SHADE = /* glsl */ `
  vec3 p = vGrimePosition;
  float along = abs(vGrimeNormal.x) > abs(vGrimeNormal.z) ? p.z : p.x;
  float upright = 1.0 - abs(vGrimeNormal.y);
  float drip = smoothstep(0.45, 0.85, grimeFbm(vec3(along * 0.9, p.y * 0.06, 5.0)))
    * mix(0.4, 1.0, smoothstep(0.0, 9.0, p.y));
  float rust = smoothstep(0.5, 0.8, grimeFbm(vec3(along * 0.35, p.y * 0.12, 11.0)))
    * mix(0.55, 1.0, grimeNoise(vec3(along * 3.0, p.y * 0.4, 6.0)));
  float splash = (1.0 - smoothstep(0.0, grimeHeight, p.y + (grimeNoise(vec3(along * 1.5, 0.0, 8.0)) - 0.5) * grimeHeight * 0.6));
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
// so the dirt keeps its size in map units at every Leaper size.
function dress(material, kind, scale) {
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
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float grimeScale;\nvarying vec3 vGrimePosition;\nvarying vec3 vGrimeNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrimePosition = (modelMatrix * vec4(transformed, 1.0)).xyz / grimeScale;
        vGrimeNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    const declarations = Object.entries(uniforms)
      .map(([name, { value }]) => `uniform ${value.isColor ? 'vec3' : 'float'} ${name};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${declarations}\nvarying vec3 vGrimePosition;\nvarying vec3 vGrimeNormal;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${kind === 'floor' ? FLOOR_SHADE : WALL_SHADE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, grimeGloss);');
  };
  material.customProgramCacheKey = () => `junkyard-${kind}`;
  material.needsUpdate = true;
}

// Dress the yard's own floor and wall materials (junkyard_v2's Cube: a
// "... walls" and a "... ground" material). Other maps are left alone.
export function dressJunkyardSurfaces(floorParts, scale) {
  const done = new Set();
  for (const mesh of floorParts) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (done.has(material) || !material.isMeshStandardMaterial) continue;
      const kind = /wall/i.test(material.name) ? 'walls' : /ground|floor/i.test(material.name) ? 'floor' : null;
      if (!kind) continue;
      dress(material, kind, scale);
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
