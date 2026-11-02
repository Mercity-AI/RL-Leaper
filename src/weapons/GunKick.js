// The gun jumping in Lola's hands while aiming down the sights (owner,
// 2026-10-30: the camera kicks with the gun, so on screen the gun itself never
// moved). Each shot snaps the gun up and back toward the eye, then it settles
// down again. Only what is drawn moves: for one render her whole body (in this
// view just her arms and gun) tips about her eyes and comes straight back, so
// aim, bullets, collision and the animation never see it.
export class GunKick {
  // player: Lola. kick: { pitch, back, snap, settle }, see weapons.js gunKick.
  constructor(player, { scale = 1 } = {}) {
    this.player = player;
    this.scale = scale;
    this.reset();
  }

  reset() {
    this.goal = 0;
    this.shown = 0;
    this.kick = null;
    this.saved = null;
  }

  // A shot from a gun with this gunKick; rapid fire stacks up to 1.5 kicks.
  fired(kick) {
    this.kick = kick;
    this.goal = Math.min(1.5, this.goal + 1);
  }

  update(dt) {
    if (!this.kick) return;
    this.goal *= Math.exp(-this.kick.settle * dt);
    this.shown += (this.goal - this.shown) * (1 - Math.exp(-this.kick.snap * dt));
  }

  // active: aiming down the sights (the third-person view has her shot clip).
  beforeRender(active) {
    if (!active || this.shown < 1e-3) return;
    const { mesh, height } = this.player;
    const yaw = mesh.rotation.y, tip = this.shown * this.kick.pitch;
    const back = this.shown * this.kick.back * this.scale;
    this.saved = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    // Tip about her eyes, not her feet, then slide back along her facing.
    const eyes = height * 0.9, slide = eyes * Math.sin(tip) - back;
    mesh.position.x += Math.sin(yaw) * slide;
    mesh.position.y += eyes * (1 - Math.cos(tip));
    mesh.position.z += Math.cos(yaw) * slide;
    mesh.rotation.x = -tip;
  }

  afterRender() {
    if (!this.saved) return;
    this.player.mesh.position.set(this.saved.x, this.saved.y, this.saved.z);
    this.player.mesh.rotation.x = 0;
    this.saved = null;
  }
}
