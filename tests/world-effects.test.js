import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldEffects, EFFECTS } from '../src/world/WorldEffects.js';
import { applyAtmosphere, JUNKYARD_ATMOSPHERE } from '../src/world/junkyardAtmosphere.js';
import { glows } from '../src/core/postprocessing.js';
import { QUALITY_PRESETS } from '../src/core/Quality.js';
import { seededRandom } from './world-helpers.js';

// World polish: dust under the Leaper's feet, the impact hook (sparks and scorch
// marks), and the junkyard sky and fog.

// One Leaper leg as the gait leaves it (only the fields the effects read).
function fakeLeg() {
  return { stepping: false, disabled: false, footPosition: new THREE.Vector3(1, 0.04, 2), stepTo: new THREE.Vector3(1, 0.04, 2) };
}

function effects(quality = QUALITY_PRESETS.high, scale = 1.45) {
  const scene = new THREE.Scene();
  return { scene, fx: new WorldEffects(scene, { scale, quality, random: seededRandom(3) }) };
}

test('a foot that finishes its step puffs dust; mid-air, shot-off or paused feet do not', () => {
  const { fx } = effects();
  const legs = [fakeLeg(), fakeLeg(), fakeLeg()];
  fx.watchFeet({ legs });
  legs.forEach((leg) => { leg.stepping = true; });
  fx.update(1 / 60);
  assert.equal(fx.counts.dust, 0, 'nothing while the feet are in the air');
  // Leg 0 lands where it aimed; leg 1 is tucked up mid-air (a jump); leg 2 was shot off.
  legs[0].stepping = false;
  legs[1].stepping = false;
  legs[1].footPosition.y = 1.2;
  legs[2].stepping = false;
  legs[2].disabled = true;
  fx.update(1 / 60);
  assert.equal(fx.counts.dust, EFFECTS.dust.perPuff, 'one puff, for the landed foot only');
  // Paused (dt 0): no new puffs and nothing moves.
  legs[0].stepping = true;
  fx.update(1 / 60);
  legs[0].stepping = false;
  const before = Array.from(fx.dustParticles.position);
  fx.update(0);
  assert.deepEqual(Array.from(fx.dustParticles.position), before, 'paused dust holds still');
  fx.update(1 / 60);
  assert.equal(fx.counts.dust, 2 * EFFECTS.dust.perPuff, 'the landing shows once the game runs again');
});

test('dust rises, spreads, fades and is gone after its life', () => {
  const { fx } = effects();
  const point = new THREE.Vector3(0, 0, 0);
  fx.dust(point);
  fx.update(0.05);
  const first = fx.dustParticles.position.slice(0, 3);
  assert.ok(first[1] > point.y, 'starts just above the ground and lifts');
  fx.update(0.3);
  assert.ok(Math.hypot(fx.dustParticles.position[0], fx.dustParticles.position[2]) > Math.hypot(first[0], first[2]), 'spreads');
  assert.ok(fx.dustParticles.alpha[0] > 0 && fx.dustParticles.alpha[0] < EFFECTS.dust.opacity);
  for (let i = 0; i < 40; i += 1) fx.update(0.05);
  assert.equal(fx.counts.dust, 0, 'gone after its life');
});

test('the impact hook throws sparks along the surface normal; scorch marks only on high quality', () => {
  const { fx } = effects(QUALITY_PRESETS.high);
  fx.impact(new THREE.Vector3(2, 1, 0), new THREE.Vector3(1, 0, 0));
  fx.update(1 / 60);
  assert.equal(fx.counts.sparks, EFFECTS.sparks.perImpact);
  for (let i = 0; i < EFFECTS.sparks.perImpact; i += 1) {
    assert.ok(fx.sparkParticles.velocity[i * 3] > 0, 'sparks leave the wall, not go into it');
  }
  assert.equal(fx.counts.decals, 1, 'a scorch mark stays');
  const mark = fx.decals[0].mesh;
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(mark.quaternion).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6,
    'the mark lies flat on the wall');
  fx.impact(new THREE.Vector3(), undefined, { strength: 0.5, decal: false });
  fx.update(1 / 60);
  assert.equal(fx.counts.decals, 1, 'decal: false leaves no mark (hits on the moving Leaper)');
  for (let i = 0; i < 200; i += 1) fx.update(0.05);
  assert.equal(fx.counts.decals, 0, 'marks fade away after their life');

  const medium = effects(QUALITY_PRESETS.medium).fx;
  medium.impact(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  medium.update(1 / 60);
  assert.ok(medium.counts.sparks > 0 && medium.counts.decals === 0 && medium.decals.length === 0, 'medium: sparks, no marks');
  const low = effects(QUALITY_PRESETS.low).fx;
  low.dust(new THREE.Vector3());
  low.update(1 / 60);
  assert.equal(low.counts.dust, 0, 'low quality: no dust');
});

test('everything is pooled: hundreds of effects never add objects or buffers', () => {
  const { fx } = effects();
  const objects = () => { let n = 0; fx.root.traverse(() => { n += 1; }); return n; };
  const count = objects();
  const buffers = [fx.dustParticles.position, fx.sparkParticles.position];
  for (let i = 0; i < 300; i += 1) {
    fx.dust(new THREE.Vector3(i, 0, 0));
    fx.impact(new THREE.Vector3(0, i, 0), new THREE.Vector3(0, 1, 0));
    fx.update(1 / 60);
  }
  assert.equal(objects(), count, 'no new scene objects');
  assert.equal(fx.dustParticles.position, buffers[0]);
  assert.equal(fx.sparkParticles.position, buffers[1]);
  assert.ok(fx.counts.dust <= EFFECTS.dust.pool && fx.counts.sparks <= EFFECTS.sparks.pool);
  assert.ok(fx.counts.decals <= EFFECTS.decals.pool);
});

test('effects leave the scene on dispose()', () => {
  const { scene, fx } = effects();
  assert.ok(scene.children.includes(fx.root));
  fx.dispose();
  assert.ok(!scene.children.includes(fx.root));
});

test('the junkyard sky and fog go in, and dispose puts the scene back exactly', () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4f0f7);
  scene.fog = new THREE.Fog(0xe4f0f7, 24, 78);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x9ca7b2, 0.95);
  const sun = new THREE.DirectionalLight(0xfff7ea, 1.25);
  scene.add(hemisphere, sun);
  const restore = applyAtmosphere(scene);
  assert.equal(scene.background.getHex(), JUNKYARD_ATMOSPHERE.horizon);
  assert.equal(scene.fog.color.getHex(), JUNKYARD_ATMOSPHERE.horizon, 'the fog melts into the horizon colour');
  assert.equal(sun.color.getHex(), JUNKYARD_ATMOSPHERE.lightColour);
  assert.equal(hemisphere.groundColor.getHex(), JUNKYARD_ATMOSPHERE.groundBounce);
  const sky = scene.getObjectByName('sky');
  assert.ok(sky && sky.material.depthWrite === false && sky.material.fog === false, 'a sky dome drawn behind everything');
  assert.equal(glows(sky.material), false, 'the sky never glows');
  restore();
  assert.equal(scene.getObjectByName('sky'), undefined);
  assert.equal(scene.background.getHex(), 0xe4f0f7);
  assert.equal(scene.fog.color.getHex(), 0xe4f0f7);
  assert.equal(sun.color.getHex(), 0xfff7ea);
  assert.equal(hemisphere.groundColor.getHex(), 0x9ca7b2);
  applyAtmosphere(scene, { sky: false })();
  assert.equal(scene.getObjectByName('sky'), undefined, 'low quality: the flat horizon colour only');
});
