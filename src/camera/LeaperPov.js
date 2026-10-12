import * as THREE from 'three';

// Spectator only: no writes to the weapon, eye, target, or movement policy.
export class LeaperPov {
  constructor(playtest) {
    this.playtest = playtest;
    this.active = false;
    this.button = document.createElement('button');
    this.button.textContent = 'LEAPER POV';
    this.button.setAttribute('aria-pressed', 'false');
    playtest.panel.querySelector('.junkyard-toolbar').append(this.button);
    this.button.onclick = () => this.toggle();
    this.reticle = document.createElement('div');
    this.reticle.id = 'leaperReticle'; this.reticle.textContent = '+'; this.reticle.hidden = true;
    document.body.append(this.reticle);
    const rig = playtest.simulation.rig;
    this.hiddenObjects = [rig.robot, playtest.combat.healthBar, playtest.sight.lines,
      ...rig.legs.flatMap(leg => ['coxa', 'femur', 'tibia', 'calf', 'knee', 'calfJoint'].map(key => leg[key]))];
    playtest.cameraController.spectator = this;
  }
  toggle() {
    const p = this.playtest, controller = p.cameraController, camera = p.engine.camera;
    if (!this.active) {
      this.heading = controller.getMovementHeading(p.simulation.state.yaw);
      this.saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), up: camera.up.clone(), fov: camera.fov };
      if (document.pointerLockElement) document.exitPointerLock();
      controller.pointerId = null;
      this.active = true;
      camera.fov = 70;
    } else {
      this.active = false;
      camera.position.copy(this.saved.position); camera.quaternion.copy(this.saved.quaternion);
      camera.up.copy(this.saved.up); camera.fov = this.saved.fov;
    }
    camera.updateProjectionMatrix();
    this.button.setAttribute('aria-pressed', String(this.active));
    this.button.classList.toggle('on', this.active);
    this.reticle.hidden = !this.active;
    this.update();
  }
  update() {
    if (!this.active) return;
    const { combat, engine } = this.playtest;
    engine.camera.position.copy(combat.origin);
    engine.camera.up.set(0, 1, 0);
    engine.camera.lookAt(combat.origin.clone().add(combat.direction));
    this.reticle.dataset.locked = String(combat.tree.locked);
  }
  beforeRender() {
    if (!this.active) return;
    this.hidden = [...this.hiddenObjects, ...this.playtest.combat.effects.filter(e => e.muzzle).map(e => e.mesh)]
      .map(object => [object, object.visible]);
    this.hidden.forEach(([object]) => { object.visible = false; });
  }
  afterRender() {
    this.hidden?.forEach(([object, visible]) => { object.visible = visible; });
    this.hidden = null;
  }
}
