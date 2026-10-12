import * as THREE from 'three';
import config from '../config/eye-vision.json' with { type: 'json' };

// The server tests these animated body points against the same static GLB
// shown in the browser. Debug lines display the server's actual sight result.
export class EyeVision {
  constructor(playtest) {
    this.playtest = playtest;
    this.mode = new URLSearchParams(location.search).get('vision') === 'legacy' ? 'legacy' : 'eye';
    this.version = config.version;
    this.bones = playtest.target.outfits.map(({ model }) => config.targetBones.map(name => {
      const bone = model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
      if (!bone) throw new Error(`Lola sight anchor missing: ${name}`);
      return bone;
    }));
    this.lines = new THREE.Group();
    this.lines.visible = false;
    this.lines.renderOrder = 20;
    for (let i = 0; i < 3; i += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: 0x35dd91, depthTest: false, depthWrite: false,
      }));
      line.frustumCulled = false;
      this.lines.add(line);
    }
    playtest.engine.scene.add(this.lines);
    this.label = playtest.panel.querySelector('[data-sight-status]');
    const mode = playtest.panel.querySelector('[data-sight-mode]');
    mode.value = this.mode;
    mode.onchange = () => {
      this.mode = mode.value;
      this.clear();
      playtest.reset();
    };
    const toggle = playtest.panel.querySelector('[data-action=sight]');
    toggle.onclick = () => {
      this.lines.visible = !this.lines.visible;
      toggle.textContent = this.lines.visible ? 'HIDE SIGHT LINES' : 'SHOW SIGHT LINES';
      toggle.setAttribute('aria-pressed', String(this.lines.visible));
    };
    this.clear();
  }

  pose() {
    const { target, simulation } = this.playtest;
    target.mesh.updateMatrixWorld(true);
    simulation.rig.robot.updateMatrixWorld(true);
    // Keep the committed detection origin independent of weapon/spectator aim.
    // Before combat the eye was neutral; reproduce that same neutral transform.
    const eye = simulation.rig.robot.localToWorld(
      simulation.rig.eyePivot.position.clone().add(new THREE.Vector3(0, 0, 0.148)),
    );
    const robot = simulation.rig.robot;
    const dx = eye.x - robot.position.x, dz = eye.z - robot.position.z;
    const c = Math.cos(robot.rotation.y), s = Math.sin(robot.rotation.y);
    return {
      eye: robot.position.y > 0 ? [dx * c - dz * s, eye.y, dx * s + dz * c] : config.eyeOffset,
      points: this.bones[target.weaponIndex].map(bone => bone.getWorldPosition(new THREE.Vector3()).toArray()),
    };
  }

  clear() {
    this.lines.children.forEach(line => { line.visible = false; });
    this.label.textContent = 'SIGHT CONNECTING…';
  }

  show(frame) {
    const sight = frame.sight;
    if (!sight || this.mode === 'legacy') {
      this.lines.children.forEach(line => { line.visible = false; });
      this.label.textContent = `OLD FLAT VISION · ${frame.sight_visible ? 'VISIBLE' : 'HIDDEN'}`;
      return;
    }
    const count = sight.clear.filter(Boolean).length;
    this.label.textContent = !sight.in_view ? 'EYE VISION · OUTSIDE VIEW / RANGE'
      : count ? `EYE VISION · VISIBLE · ${count}/3 CLEAR` : 'EYE VISION · HIDDEN BY COVER';
    this.lines.children.forEach((line, i) => {
      line.visible = sight.in_view;
      const endpoint = sight.hits[i] || sight.points[i];
      const positions = line.geometry.attributes.position;
      positions.setXYZ(0, ...sight.origin);
      positions.setXYZ(1, ...endpoint);
      positions.needsUpdate = true;
      line.material.color.setHex(sight.clear[i] ? 0x35dd91 : 0xff813f);
    });
  }
}
