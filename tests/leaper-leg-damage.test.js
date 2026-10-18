import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHexapod } from '../src/robot/createHexapod.js';
import { LeaperSimulation } from '../src/simulation/LeaperSimulation.js';
import { LeaperLegDamage } from '../src/simulation/LeaperLegDamage.js';
import { bulletHit } from '../src/simulation/PlayerWeapon.js';

function setup(random = () => 0) {
  const scene = new THREE.Scene(), rig = createHexapod(scene);
  const cameraController = { eyePitch: 0, eyeYaw: 0, update() {} };
  const sim = new LeaperSimulation({ rig, cameraController, sun: { position: new THREE.Vector3(), target: { position: new THREE.Vector3() } }, statusElement: {} });
  sim.updateBody(0, 0); sim.updateGait(0, 0); scene.updateMatrixWorld(true);
  const geometry = { hit: () => null };
  const damage = new LeaperLegDamage(scene, rig, geometry, random);
  // Explicit fixture values; production threshold ranges are verified separately below.
  for (const leg of rig.legs) {
    leg.damage.upper.threshold = leg.damage.lower.threshold = random() < 0.5 ? 5 : 6;
  }
  return { scene, rig, sim, damage, geometry };
}
function lowestVertex(object) {
  object.updateMatrixWorld(true);
  let lowest = Infinity;
  object.traverse(mesh => {
    const p = mesh.geometry?.attributes.position;
    if (p) for (let i=0;i<p.count;i++) lowest = Math.min(lowest, new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).y);
  });
  return lowest;
}
function shoot(damage, mesh, n) { for (let i = 0; i < n; i++) damage.hit(mesh, new THREE.Vector3(0, 0, -1)); }

test('direct lower knee rays break only at five hits; upper section remains hittable', () => {
  const { rig, damage, geometry } = setup(); const leg = rig.legs[1];
  const center = leg.calfJoint.getWorldPosition(new THREE.Vector3());
  const hit = bulletHit(geometry, [leg.calfJoint], center.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1), 4);
  assert.equal(hit.enemy, true);
  shoot(damage, hit.intersection.object, 4); assert.equal(damage.debris.length, 0);
  shoot(damage, hit.intersection.object, 1); assert.equal(damage.debris.length, 1);
  assert.equal(leg.calf.visible, false); assert.equal(leg.calfJoint.visible, false);
  assert.equal(leg.knee.visible, true); assert.equal(leg.tibia.visible, true);
  shoot(damage, leg.calfJoint, 5); assert.equal(damage.debris.length, 1);
  shoot(damage, leg.knee, 5); assert.equal(damage.debris.length, 2);
  assert.equal(damage.debris[1].mesh.children.length, 2, 'previously detached lower parts are not duplicated');
});

test('six-hit upper knees detach knee and all sections below, not the thigh', () => {
  const { rig, damage } = setup(() => 0.99); const leg = rig.legs[0];
  shoot(damage, leg.knee.children[0], 5); assert.equal(damage.debris.length, 0);
  shoot(damage, leg.knee, 1); assert.equal(damage.debris.length, 1);
  for (const key of ['knee', 'tibia', 'calfJoint', 'calf']) assert.equal(leg[key].userData.detached, true);
  assert.equal(leg.femur.visible, true); assert.equal(leg.coxa.visible, true);
});

test('body and limb-shaft hits do not count toward knee damage; knees have independent counts', () => {
  const { rig, damage } = setup(); const leg = rig.legs[0];
  shoot(damage, rig.robot.children[0], 10); shoot(damage, leg.tibia.children[0], 10);
  shoot(damage, leg.knee, 3); shoot(damage, leg.calfJoint, 3);
  assert.equal(damage.debris.length, 0);
  assert.equal(leg.damage.upper.hits, 3); assert.equal(leg.damage.lower.hits, 3);
  assert.equal(rig.legs[1].damage.upper.hits, 0);
});

test('fragments preserve the break pose, fall, persist on the floor and reset cleanly', () => {
  const { rig, damage, scene } = setup(); const leg = rig.legs[0];
  const before = new THREE.Box3().setFromObject(leg.calf);
  shoot(damage, leg.calfJoint, 5);
  const piece = damage.debris[0];
  const after = new THREE.Box3().setFromObject(piece.mesh.children[1]);
  assert.ok(before.min.distanceTo(after.min) < 1e-5);
  for (let i=0;i<600;i++) damage.update(1/60);
  assert.equal(piece.settled, true);
  assert.ok(lowestVertex(piece.mesh) >= 0);
  const position = piece.mesh.position.clone(); damage.update(10);
  assert.ok(piece.mesh.position.equals(position)); assert.equal(piece.mesh.parent, scene);
  damage.reset(); assert.equal(damage.debris.length, 0); assert.equal(piece.mesh.parent, null);
  assert.equal(leg.calf.visible, true); assert.equal(leg.disabled, false); assert.equal(rig.mobility, 1);
});

for (const indices of [[1], [0, 1]]) test(`movement survives broken legs ${indices.join(',')}`, () => {
  const { rig, sim, damage } = setup();
  for (const i of indices) shoot(damage, rig.legs[i].knee, 5);
  let stepped = false;
  for (let frame=1;frame<=240;frame++) {
    sim.updateExternal({ x: frame / 120, z: 0, yaw: Math.PI/2, collision: false, distance: 2 }, 1/60, { checkpoint: { step: 1 } });
    for (const leg of rig.legs) {
      if (leg.disabled) assert.equal(leg.stepping, false);
      else if (leg.stepping) stepped = true;
      for (const key of ['coxa','femur','tibia','calf','knee','calfJoint']) assert.ok(leg[key].position.toArray().every(Number.isFinite));
    }
    // Surviving feet keep up with the body instead of trailing until the leg lies flat
    // (after half a second: the fixture snaps the body 90° on the first frame).
    const c = Math.cos(sim.state.yaw), s = Math.sin(sim.state.yaw);
    for (const leg of frame > 30 ? rig.legs.filter(l => !l.disabled) : []) {
      const home = new THREE.Vector3(sim.state.position.x + leg.homeLocal.x * c + leg.homeLocal.z * s, 0,
        sim.state.position.z - leg.homeLocal.x * s + leg.homeLocal.z * c);
      const trail = Math.hypot(leg.footPosition.x - home.x, leg.footPosition.z - home.z);
      assert.ok(trail < 1.7, `surviving feet never trail far behind (leg ${leg.index}, frame ${frame}: ${trail.toFixed(2)})`);
    }
  }
  assert.equal(stepped, true); assert.equal(sim.state.position.x, 2);
  for (const i of indices) assert.equal(rig.legs[i].knee.visible, false);
});
for (const joint of ['upper', 'lower']) test(`${joint} break curls up, swings with its anchor, and settles`, () => {
  const { rig, sim, damage } = setup(); const leg = rig.legs[0];
  shoot(damage, joint === 'upper' ? leg.knee : leg.calfJoint, 5);
  const hanging = leg.hanging;
  for (let i = 0; i < 180; i++) damage.update(1/60);
  // Curled like an injured spider leg: the thigh lifts (35° minus the 15° sag) and
  // any remaining shin folds back down toward the body, never sticking straight out.
  const thigh = hanging.points[1].clone().sub(hanging.points[0]).normalize();
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.asin(thigh.y)) - 20) < 1, `thigh rests raised about 20° (${THREE.MathUtils.radToDeg(Math.asin(thigh.y)).toFixed(1)})`);
  if (hanging.points[2]) {
    const shin = hanging.points[2].clone().sub(hanging.points[1]).normalize();
    const out = new THREE.Vector3(thigh.x, 0, thigh.z).normalize();
    assert.ok(shin.y < -0.7 && shin.dot(out) < 0, 'shin folds down and back toward the body');
  }
  const resting = hanging.points.at(-1).clone().sub(hanging.points[0]);
  let swing = 0;
  let angleSwing = 0;
  for (let i = 1; i <= 90; i++) {
    rig.robot.position.x += 0.025;
    rig.robot.position.y = 2.32 + Math.sin(i * 0.3) * 0.06;
    rig.robot.rotation.y = i * 0.004;
    rig.robot.updateMatrixWorld(true);
    damage.update(1/60);
    const hip = rig.robot.localToWorld(hanging.hipLocal.clone());
    assert.ok(leg.femur.position.distanceTo(hip) < 1e-7, 'hip attachment remains pinned');
    angleSwing = Math.max(angleSwing, Math.abs(hanging.angle - Math.PI / 12));
    assert.ok(hanging.angle <= THREE.MathUtils.degToRad(22), 'swing remains restrained');
    swing = Math.max(swing, hanging.points.at(-1).clone().sub(hip).distanceTo(resting));
    for (let j = 1; j < hanging.points.length; j++) {
      assert.ok(Math.abs(hanging.points[j].distanceTo(hanging.points[j-1]) - hanging.lengths[j-1]) < 0.025, 'links preserve their lengths');
      assert.ok(hanging.points[j].y >= 0.159, 'cut ends stay above the floor');
    }
  }
  assert.ok(swing > 0.15 && angleSwing > 0.001 && angleSwing < 0.035, 'walking drives subtle swinging without excessive jitter');
  for (let i = 0; i < 600; i++) damage.update(1/60);
  assert.ok(Math.abs(hanging.angularVelocity) < 0.01 && Math.abs(hanging.angle - Math.PI / 12) < 0.01, 'motion damps when stopped');
  damage.reset(); assert.equal(leg.hanging, null);
  sim.updateBody(0,0); sim.updateGait(0,0);
  assert.equal(leg.disabled, false);
});

test('hanging motion remains finite at low frame rate and on a long frame', () => {
  const { rig, damage } = setup(); shoot(damage, rig.legs[0].calfJoint, 5);
  for (let i=0;i<100;i++) damage.update(1/15);
  damage.update(2);
  assert.ok(rig.legs[0].hanging.points.every(p => p.toArray().every(Number.isFinite)));
});
for (const joint of ['upper', 'lower']) test(`all six ${joint}-knee fragments settle flat, not on an end`, () => {
  for (let index = 0; index < 6; index++) {
    const { rig, damage } = setup();
    const leg = rig.legs[index];
    shoot(damage, joint === 'upper' ? leg.knee : leg.calfJoint, 5);
    const piece = damage.debris[0];
    for (let i=0;i<300;i++) damage.update(1/60);
    assert.equal(piece.settled, true);
    piece.mesh.updateMatrixWorld(true);
    for (const shaft of piece.mesh.children.filter(o => o.isGroup)) {
      const direction = new THREE.Vector3(0,1,0).applyQuaternion(shaft.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(Math.abs(direction.y) < 0.02, `leg ${index} shaft lies parallel to floor`);
    }
    const box = new THREE.Box3().setFromObject(piece.mesh);
    assert.ok(lowestVertex(piece.mesh) >= 0 && lowestVertex(piece.mesh) < 0.003, 'rests on the ground');
    const q = piece.mesh.quaternion.clone(); damage.update(5);
    assert.ok(q.angleTo(piece.mesh.quaternion) < 1e-7, 'settled piece stays still');
  }
});

test('fragments rest on a map floor below zero', () => {
  const {rig,damage,geometry} = setup();
  geometry.hit = (origin, direction, distance) => {
    const t = origin.y + 0.22;
    return t >= 0 && t <= distance ? {point:new THREE.Vector3(origin.x,-0.22,origin.z)} : null;
  };
  shoot(damage, rig.legs[0].knee, 5);
  for(let i=0;i<300;i++)damage.update(1/60);
  assert.ok(Math.abs(lowestVertex(damage.debris[0].mesh) - (-0.218)) < 0.0001);
});
test('production knees choose 8, 9 or 10 hits and shafts choose 24, 25 or 26', () => {
  for (const [rng, kneeHits, shaftHits] of [[0,8,24],[0.5,9,25],[0.99,10,26]]) {
    const { rig, damage } = setup(() => rng); damage.reset();
    for(const leg of rig.legs) {
      assert.equal(leg.damage.upper.threshold,kneeHits); assert.equal(leg.damage.lower.threshold,kneeHits);
      for(const key of ['coxa','femur','tibia','calf'])assert.equal(leg.damage[key].threshold,shaftHits);
    }
    shoot(damage,rig.legs[0].knee,kneeHits-1); assert.equal(damage.debris.length,0);
    shoot(damage,rig.legs[0].knee,1); assert.equal(damage.debris.length,1);
  }
});
for (const key of ['coxa','femur','tibia','calf']) test(`${key} breaks at its own shaft threshold and removes downstream pieces`, () => {
  for (const rng of [0,0.99]) {
    const {rig,damage}=setup(()=>rng); damage.reset(); const leg=rig.legs[0];
    const mesh=key==='coxa'?leg[key]:leg[key].children[0], threshold=leg.damage[key].threshold;
    shoot(damage,mesh,threshold-1); assert.equal(damage.debris.length,0); assert.equal(leg.damage.upper.hits,0);
    shoot(damage,mesh,1); assert.equal(damage.debris.length,1); assert.equal(leg[key].visible,false);
    assert.equal(leg.calf.visible,false);
    if(key==='calf')assert.equal(leg.calfJoint.visible,true);
    if(key==='tibia')assert.equal(leg.knee.visible,true);
    for(let i=0;i<300;i++)damage.update(1/60);
    assert.equal(damage.debris[0].settled,true);
    shoot(damage,mesh,20); assert.equal(damage.debris.length,1,'detached sections cannot be broken again');
    damage.reset(); assert.equal(leg[key].visible,true);
  }
});
test('a remaining thigh can break after the upper knee has already detached', () => {
  const {rig,damage}=setup(); damage.reset(); const leg=rig.legs[0];
  shoot(damage,leg.knee,8); shoot(damage,leg.femur.children[0],24);
  assert.equal(damage.debris.length,2); assert.equal(damage.debris[1].mesh.children.length,1);
  assert.equal(leg.coxa.visible,true); damage.update(1/60);
});
