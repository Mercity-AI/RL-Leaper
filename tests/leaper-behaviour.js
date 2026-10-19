// The Leaper's behaviour layer in the real game page (index.html, the junkyard)
// with the in-browser (ONNX) brain and no Python server:
//   1. Lola hugging the Leaper gets a telegraphed stomp, then is hit and shoved;
//   2. a scripted setup (Lola in the pounce band, in the open): it leaps, lands
//      with a shockwave, the brain's pose is synced to the landing spot and it
//      walks on from there;
//   3. four knees shot off: Downed (body on the floor, brain paused, the eye
//      still firing, more damage taken), severed legs no longer block Lola;
//   4. the kill: Dying (the collapse) then Dead, a wreck Lola can walk up to.
// The title becomes "PASS ..." or "FAIL ..." for headless runs (tests/run-browser.mjs).
import { leaperBlocksMove } from '../src/world/playerContact.js';
import { LEAPER_BEHAVIOUR as B } from '../src/config/leaper-behaviour.js';

const results = document.querySelector('#results');
const frame = document.querySelector('iframe');
let passed = 0;
const say = (text) => { results.textContent += `\n${text}`; };
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  say(`PASS ${label}`);
}

// Wait until `test()` is truthy (checked every 100 ms), or fail after `seconds`.
async function until(test, seconds, what) {
  const started = performance.now();
  for (;;) {
    const value = test();
    if (value) return value;
    if (performance.now() - started > seconds * 1000) throw new Error(`timed out after ${seconds} s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Browsers refuse port 9, so no brain server can answer: the brain runs in the page.
const DEAD_SERVER = 'http://127.0.0.1:9';

try {
  results.textContent = 'LEAPER BEHAVIOUR IN THE REAL GAME (in-browser brain)';
  // ---- Boot the game ----
  const errors = [];
  frame.src = `/?debug&width=5.5&brain=onnx&brainUrl=${encodeURIComponent(DEAD_SERVER)}`;
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const win = frame.contentWindow;
  win.addEventListener('error', (event) => errors.push(event.message));
  win.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason?.message ?? event.reason)));
  const p = await until(() => win.leaperPlaytest, 180, 'the game to start');
  await until(() => p.brain.ready || p.brain.offline, 180, 'the brain to load');
  check(p.brain.ready && p.brain.provider.kind === 'onnx', 'the in-browser brain loaded');
  const actor = p.encounter.primary.actor;
  const director = actor?.director;
  check(director && p.brain.drivesAnimator === false, 'each Leaper has its behaviour layer, which animates the rig');
  // Everything the Leaper announces on the event bus.
  const heard = [];
  for (const name of ['leaperStateChanged', 'leaperAttack', 'leaperStaggered', 'leaperDowned', 'leaperDied', 'jointBurst', 'lolaDamaged']) {
    p.events.on(name, (payload) => heard.push({ name, at: performance.now(), ...payload }));
  }
  const state = p.simulation.state, rig = p.simulation.rig, world = p.world, lola = p.target.mesh.position;
  const floor = world.floorHeight ?? 0;
  // The game's own Three.js vector class (the page has its own copy of the module).
  const Vec = state.position.constructor;
  const leaperAt = () => ({ x: state.position.x, z: state.position.z, yaw: state.yaw });
  const distanceToLola = () => Math.hypot(lola.x - state.position.x, lola.z - state.position.z);
  // A fresh fight with Lola at `spot`, then START RUN.
  const fight = (spot) => {
    p.reset();
    heard.length = 0;
    if (spot) p.encounter.placePlayer(spot);
    p.start();
  };

  // ---- 1. Stomp: Lola hugging the Leaper ----
  {
    p.reset();
    const home = leaperAt();
    fight({ x: home.x + Math.sin(home.yaw) * 4, z: home.z + Math.cos(home.yaw) * 4 });
    check(p.walking, 'START RUN starts the hunt');
    await until(() => director.state === 'stomp' && director.phase === 'windup' && director.phaseTime > B.stomp.windup * 0.6, 90, 'a stomp wind-up');
    check(actor.posture.lower > B.stomp.crouch * 0.3, `the stomp is telegraphed: the body crouches (${actor.posture.lower.toFixed(2)} lower)`);
    check(actor.feedback.rings.stomp.mesh.visible, 'and a red ring grows on the ground');
    check(p.brain.running === false && /HELD · STOMP/.test(p.brainLabel.textContent), `the brain is paused (badge "${p.brainLabel.textContent}")`);
    const before = distanceToLola();
    const impact = await until(() => heard.find((e) => e.name === 'leaperAttack' && e.kind === 'stomp' && e.phase === 'impact'), 30, 'the stomp impact');
    check(impact.hit, 'the stomp hits Lola');
    check(heard.some((e) => e.name === 'lolaDamaged' && e.amount === B.stomp.damage), `for ${B.stomp.damage} damage`);
    await until(() => distanceToLola() > before + 1, 10, 'the knockback');
    check(true, `and shoves her away (${before.toFixed(1)} -> ${distanceToLola().toFixed(1)} units)`);
  }

  // ---- 2. Leap: Lola in the pounce band, out in the open ----
  {
    p.reset();
    const home = leaperAt();
    // Find a spot in front where she can stand, the eye sees her and a landing is clear.
    let spot = null;
    search: for (const distance of [14, 13, 15, 12, 16, 11, 17]) {
      for (const turn of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
        const yaw = home.yaw + turn * Math.PI / 180;
        const x = home.x + Math.sin(yaw) * distance, z = home.z + Math.cos(yaw) * distance;
        if (world.playerBlocked(x, z)) continue;
        p.encounter.placePlayer({ x, z });
        const eye = rig.eyePivot.getWorldPosition(new Vec());
        const chest = new Vec(x, 1.2 * world.scale, z);
        if (!actor.planLeap() || !p.combat.geometry.clear(eye, chest)) continue;
        spot = { x, z, distance, turn };
        break search;
      }
    }
    check(spot, `a pounce setup: Lola ${spot?.distance} units away, ${spot?.turn} degrees off its nose, landing clear`);
    fight(spot);
    const start = await until(() => heard.find((e) => e.name === 'leaperAttack' && e.kind === 'leap' && e.phase === 'windup'), 120, 'a leap');
    const takeoff = leaperAt();
    check(actor.feedback.rings.landing.mesh.visible, 'the landing spot is marked during the crouch');
    await until(() => director.phase === 'flight', 20, 'take-off');
    await until(() => state.jumpHeight > B.leap.clearHeight + 0.2, 10, 'the arc');
    check(actor.contactPoses() === null, `airborne (${state.jumpHeight.toFixed(2)} up): Lola can run under it`);
    const land = await until(() => heard.find((e) => e.name === 'leaperAttack' && e.kind === 'leap' && e.phase === 'land'), 20, 'the landing');
    check(Math.hypot(state.position.x - land.position.x, state.position.z - land.position.z) < 0.05,
      `it lands on the marked spot (${Math.hypot(land.position.x - takeoff.x, land.position.z - takeoff.z).toFixed(1)} units from take-off)`);
    check(Math.hypot(land.position.x - start.position.x, land.position.z - start.position.z) < 1e-6, 'the spot it marked');
    // The brain is told: its own pose is the landing spot.
    await until(() => p.brain.brainFrame && Math.hypot(p.brain.brainFrame.x - land.position.x, p.brain.brainFrame.z - land.position.z) < 1e-3, 10, 'the pose sync');
    check(true, 'the brain\'s pose is synced to the landing spot');
    // ...and its next moves start from there (it never slides back to the take-off).
    // Landing next to Lola it may also hold still again at once (Engage, or a
    // stomp when she is pinned inside its reach), which can begin a frame after
    // the leap ends, so both outcomes are waited for together.
    const steps = p.brain.frame.step ?? 0;
    await until(() => director.state !== 'leap', 20, 'the recovery');
    const after = await until(() => ((p.brain.frame.step ?? 0) >= steps + 3 ? 'walks'
      : ['engage', 'stomp'].includes(director.state) ? director.state : null), 60, 'brain moves (or a hold) after the leap');
    check(true, after === 'walks' ? `the brain walks on (${(p.brain.frame.step ?? 0) - steps} moves after the landing)`
      : `after landing next to Lola it holds still again (${after})`);
    check(Math.hypot(state.position.x - land.position.x, state.position.z - land.position.z) < 2.5, 'from the landing spot, not the take-off');
  }

  // ---- 3. Four knees shot off: Downed ----
  {
    fight(null);
    await until(() => director.state !== 'dormant', 30, 'the hunt');
    const direction = new Vec(0, 0, -1);
    for (let i = 0; i < 4; i += 1) {
      const leg = rig.legs[i];
      for (let n = 0; n < leg.damage.upper.threshold; n += 1) {
        const broke = p.combat.legs.hit(leg.knee, direction);
        p.combat.damageLeaper(2, false, broke);
      }
    }
    check(rig.legs.filter((leg) => leg.disabled).length === 4, 'four knees snapped');
    check(heard.filter((e) => e.name === 'jointBurst').length === 4, 'each with a burst of sparks (and its sound slot)');
    await until(() => director.state === 'downed', 10, 'Downed');
    await until(() => director.phase === 'down', 10, 'the fall');
    check(rig.robot.position.y - floor < B.downed.restHeight + 0.4, `the body rests on the floor (${(rig.robot.position.y - floor).toFixed(2)} up)`);
    check(p.brain.running === false && p.combat.hold === null, 'mobility 0 (brain paused), but the eye keeps firing');
    const health = p.combat.leaperHealth;
    p.combat.damageLeaper(2);
    check(health - p.combat.leaperHealth === 2 * B.downed.damageTakenScale, 'a vulnerable phase: bullets do 1.5x damage');
    // Lola can now stand where a shot-off leg used to be.
    const poses = actor.contactPoses();
    const angle = state.yaw - 0.62;
    const foot = { x: state.position.x + Math.sin(angle) * 3.24, z: state.position.z + Math.cos(angle) * 3.24 };
    const outside = { x: state.position.x + Math.sin(angle) * 8, z: state.position.z + Math.cos(angle) * 8 };
    check(!leaperBlocksMove(foot.x, foot.z, outside, poses, world.scale), 'a severed leg no longer blocks Lola (contact v4)');
    check(/DOWN/.test(win.document.querySelector('#leaperHealthHud [data-leaper-state]').textContent), 'the HUD says DOWN');
    check(/downed/.test(win.document.querySelector('#leaperDebugHud')?.textContent ?? ''), 'and the debug HUD shows the raw state');
  }

  // ---- 4. The kill: Dying, then Dead, a wreck ----
  {
    fight(null);
    await until(() => director.state !== 'dormant', 30, 'the hunt');
    p.combat.damageLeaper(p.combat.leaperHealth);
    await until(() => director.state === 'dying', 5, 'Dying');
    check(heard.some((e) => e.name === 'leaperDied'), 'the death is announced');
    check(p.flow.ended && /LEAPER DEFEATED/.test(p.encounter.result.text), `the fight ends: "${p.encounter.result.text}"`);
    check(actor.feedback.debris.length > 0, 'sparks and debris fly');
    await until(() => director.state === 'dead', 10, 'Dead');
    check(rig.robot.position.y - floor < B.dying.restHeight + 0.4, `the wreck lies on the floor (${(rig.robot.position.y - floor).toFixed(2)} up)`);
    check(rig.eyeLight.intensity < 0.05, 'its eye light is out');
    // Lola can still move after her win, and walk right up to the wreck.
    const before = lola.clone();
    p.target.move(1, 0, new before.constructor(0, 0, 1), new before.constructor(1, 0, 0), 4.5, 0.3);
    check(lola.distanceTo(before) > 0.01, 'Lola can still move after the win');
    const poses = actor.contactPoses();
    const angle = state.yaw + 0.62;
    const foot = { x: state.position.x + Math.sin(angle) * 3.24, z: state.position.z + Math.cos(angle) * 3.24 };
    check(!leaperBlocksMove(foot.x, foot.z, { x: foot.x * 2, z: foot.z * 2 }, poses, world.scale), 'she can walk up to the wreck between its legs');
    check(leaperBlocksMove(state.position.x, state.position.z, foot, poses, world.scale), 'but not through its hull');
    // RESTART ENCOUNTER after the kill: a whole, standing, dormant Leaper with its
    // lights on and nothing of the wreck left behind.
    p.reset();
    const posture = state.posture;
    check(director.state === 'dormant' && rig.legs.every((leg) => !leg.disabled) && rig.mobility === 1,
      'after a restart it is dormant with every leg back');
    check(['lower', 'pitch', 'roll', 'splay'].every((key) => posture[key] === 0) && !posture.planted, 'standing, not collapsed');
    check(p.combat.damageScale === 1 && p.combat.dyingGlow === undefined && rig.materials.glowSoft.emissiveIntensity === 1,
      'normal damage, lights back on');
    check(actor.feedback.debris.length === 0 && Object.values(actor.feedback.rings).every((ring) => !ring.mesh.visible),
      'no debris or rings left from the wreck');
  }

  // ---- 5. Lola's real gun: every hit flashes the hull; a crit on the eye core staggers it ----
  {
    const home = leaperAt();
    fight({ x: home.x + Math.sin(home.yaw) * 8, z: home.z + Math.cos(home.yaw) * 8 });
    p.target.mesh.rotation.y = home.yaw + Math.PI;
    await until(() => ['chase', 'engage'].includes(director.state), 30, 'the hunt');
    await until(() => director.cooldowns.stagger === 0 && director.state !== 'stomp', 10, 'a moment to aim');
    // Aim the camera straight at the eye's red core and pull the trigger (one shot).
    const core = rig.eyePivot.children.find((o) => o.userData.weakPoint);
    const camera = p.engine.camera;
    rig.robot.updateMatrixWorld(true);
    const aim = core.getWorldPosition(new Vec());
    camera.position.copy(lola).add(new Vec(0, 1.5 * world.scale, 0));
    camera.lookAt(aim);
    camera.updateMatrixWorld(true);
    p.playerWeapon.reset();
    // The flash lasts 0.12 s of game time, shorter than this page's polling on a
    // slow machine, so the brightest hull glow of every frame is recorded.
    let peak = 0;
    const feedbackUpdate = actor.feedback.update.bind(actor.feedback);
    actor.feedback.update = (dt) => {
      feedbackUpdate(dt);
      peak = Math.max(peak, rig.materials.plate.emissive.r);
    };
    const health = p.combat.leaperHealth;
    check(p.playerWeapon.fire(), 'Lola fires at the eye core');
    check(p.combat.leaperHealth < health, `the bullet hits (${health - p.combat.leaperHealth} damage)`);
    await until(() => peak > 0, 5, 'the hit flash');
    check(true, `the hull flashes white on the hit (peak glow ${peak.toFixed(2)})`);
    actor.feedback.update = feedbackUpdate;
    await until(() => director.state === 'stagger', 5, 'the stagger');
    check(heard.some((e) => e.name === 'leaperStaggered' && e.reason === 'weak point'), 'a weak-point crit staggers the Leaper');
    check(p.brain.running === false, 'its brain is frozen while it staggers');
  }

  check(errors.length === 0, `no errors in the game (${errors.join(' | ') || 'none'})`);
  say(`\nALL ${passed} CHECKS PASSED`);
  document.title = `PASS ${passed} · Leaper behaviour`;
} catch (error) {
  say(`\nFAIL ${error.message}`);
  document.title = `FAIL · ${error.message}`;
}
