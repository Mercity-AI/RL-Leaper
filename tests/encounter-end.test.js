import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { JunkyardBrain } from '../src/simulation/JunkyardBrain.js';
import { createHexapod } from '../src/robot/createHexapod.js';
import { FOOT_HEIGHT } from '../src/config/robot.js';

// The real Leaper rig and animator, with the junkyard's settings.
function leaper() {
  const rig = createHexapod(new THREE.Scene());
  rig.weaponControlled = true;
  const simulation = new LeaperSimulation({ rig, world: { floorHeight: 0 },
    cameraController: { eyePitch: 0, eyeYaw: 0 }, target: {}, input: {} });
  simulation.drivesPresentation = false;
  // Feet planted around the start, as Encounter.placeLeaper does.
  for (const leg of rig.legs) {
    leg.footPosition.set(leg.homeLocal.x, FOOT_HEIGHT, leg.homeLocal.z);
    leg.stepping = false;
  }
  // Walk it for a moment so its legs are mid-stride.
  for (let i = 0; i < 40; i += 1) {
    simulation.applyExternalFrame({ x: i * 0.06, z: 0, yaw: 0, collision: false }, 1 / 60);
  }
  return { rig, simulation };
}

test('after the fight the Leaper stays put while its swinging feet finish landing (review 5.2)', () => {
  const { rig, simulation } = leaper();
  const leg = rig.legs.find((l) => l.stepping) ?? rig.legs[0];
  // Make sure at least one foot is in the air, half way through a step.
  leg.stepping = true; leg.stepProgress = 0.5; leg.stepDuration = 0.2;
  leg.stepFrom.copy(leg.footPosition); leg.stepTo.copy(leg.footPosition).add(new THREE.Vector3(0.2, 0, 0));
  leg.stepFrom.y = FOOT_HEIGHT; leg.stepTo.y = FOOT_HEIGHT;
  leg.footPosition.y = FOOT_HEIGHT + 0.25;
  const where = simulation.state.position.clone(), yaw = simulation.state.yaw;
  // Combat has switched the destroyed Leaper's lights off; settling leaves them off.
  rig.eyeLight.intensity = 0;
  const glow = rig.materials.glow.emissiveIntensity;
  for (let i = 0; i < 60; i += 1) simulation.settle(1 / 60);
  assert.ok(rig.legs.every((l) => !l.stepping), 'every foot has landed');
  assert.ok(rig.legs.every((l) => Math.abs(l.footPosition.y - FOOT_HEIGHT) < 1e-9), 'on the floor');
  assert.ok(simulation.state.position.distanceTo(where) < 1e-12 && simulation.state.yaw === yaw, 'the body stays where it died');
  assert.ok(simulation.state.velocity.length() < 0.01, 'and comes to a stop');
  assert.equal(rig.eyeLight.intensity, 0, 'no eye pulse on a dead Leaper');
  assert.equal(rig.materials.glow.emissiveIntensity, glow, 'no knee-glow pulse either');
  // No idle "breathing" sway once it is destroyed.
  const height = rig.robot.position.y;
  for (let i = 0; i < 60; i += 1) simulation.settle(1 / 60);
  assert.ok(Math.abs(rig.robot.position.y - height) < 1e-6, "the body height holds still");
});

test('once the encounter is over the brain asks for no moves and only settles the Leaper', async () => {
  globalThis.document = { hidden: false };
  const calls = [];
  const simulation = { state: { position: new THREE.Vector3(), yaw: 0 },
    settle: (dt) => calls.push(['settle', dt]), updateExternal: () => calls.push(['follow']) };
  const playtest = { world: { width: 5.5 }, walking: true, message: {}, brainLabel: {}, combat: { dead: false },
    target: { mesh: { position: new THREE.Vector3(0, 0, 10) } }, simulation };
  const brain = new JunkyardBrain(playtest);
  const requests = [];
  brain.request = async (path) => {
    requests.push(path);
    return { x: 0, z: 0, yaw: 0, step: 0, model_step: 7757824, policy_sha256: 'test', token: 'test' };
  };
  await brain.reset();
  brain.start();
  brain.update(0.1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['follow']);
  playtest.combat.dead = true;
  calls.length = 0;
  const before = requests.length;
  for (let i = 0; i < 10; i += 1) brain.update(0.1);
  assert.equal(requests.length, before, 'no brain moves after the fight');
  assert.ok(calls.length === 10 && calls.every(([name, dt]) => name === 'settle' && dt === 0.1));
  assert.equal(brain.describe().label, 'BRAIN 7,757,824 · ENCOUNTER OVER', 'the badge says the fight is over');
});

// When Lola loses, the Leaper is still alive: it settles its feet but keeps
// "breathing" (idle sway and knee-glow pulse) instead of turning into a statue.
test('a Leaper that won keeps idling while it settles; the brain tells it which case it is', () => {
  const { rig, simulation } = leaper();
  for (let i = 0; i < 60; i += 1) simulation.settle(1 / 60, { alive: true });
  const glow = rig.materials.glow.emissiveIntensity, roll = simulation.state.rollTilt;
  for (let i = 0; i < 30; i += 1) simulation.settle(1 / 60, { alive: true });
  assert.notEqual(rig.materials.glow.emissiveIntensity, glow, 'the knee glow keeps pulsing');
  assert.notEqual(simulation.state.rollTilt, roll, 'the idle sway goes on');
  assert.ok(rig.legs.every((l) => !l.stepping), 'its feet are planted all the same');
  // The brain passes alive = the Leaper still has health.
  globalThis.document = { hidden: false };
  const seen = [];
  const playtest = { world: { width: 5.5 }, walking: false, message: {}, brainLabel: {},
    combat: { dead: true, leaperHealth: 120 }, target: { mesh: { position: new THREE.Vector3() } },
    simulation: { state: { position: new THREE.Vector3(), yaw: 0 }, settle: (dt, options) => seen.push(options.alive) } };
  const brain = new JunkyardBrain(playtest);
  brain.update(0.1);
  playtest.combat.leaperHealth = 0;
  brain.update(0.1);
  assert.deepEqual(seen, [true, false], 'alive when Lola lost, not when the Leaper was destroyed');
});
