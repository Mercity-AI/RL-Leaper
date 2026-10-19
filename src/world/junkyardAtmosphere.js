import * as THREE from 'three';

// The junkyard's sky, fog and light colours in one place (designer-tunable).
// Colours are as they appear on screen. The fog fades distant props into the
// horizon colour, so the far side of the yard melts into the sky instead of
// stopping at a hard edge.
export const JUNKYARD_ATMOSPHERE = Object.freeze({
  // Sky at the horizon: also the fog colour (the old flat background grey).
  horizon: 0x555555,
  // Sky straight up: a touch darker and cooler, for a subtle overcast gradient.
  zenith: 0x40464f,
  // How high above the horizon (0 = horizon, 1 = straight up) the sky reaches
  // the zenith colour.
  blend: 0.55,
  // A faint lighter haze band just above the horizon (0 = none).
  haze: 0.06,
  // Fill lighting: all lights white, the sky light's ground bounce neutral grey,
  // so grey surfaces stay grey instead of turning blue.
  lightColour: 0xffffff,
  groundBounce: 0x777777,
});

// The sky: a big inside-out ball that follows the camera and is drawn behind
// everything, shaded from the horizon colour up to the zenith colour. Its
// colours go straight to the screen, exactly like the old background colour.
export function createSky(atmosphere = JUNKYARD_ATMOSPHERE) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(atmosphere.horizon) },
      zenith: { value: new THREE.Color(atmosphere.zenith) },
      blend: { value: atmosphere.blend },
      haze: { value: atmosphere.haze },
    },
    vertexShader: `varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform float blend; uniform float haze;
      varying vec3 vDirection;
      void main() {
        float height = normalize(vDirection).y;
        float up = smoothstep(0.0, blend, height);
        vec3 colour = mix(horizon, zenith, up);
        colour += haze * (1.0 - smoothstep(0.0, 0.14, abs(height - 0.02)));
        gl_FragColor = vec4(colour, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  material.userData.glow = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  // Scenery only: bullets, sight lines and the camera never hit the sky.
  sky.raycast = () => {};
  // Centred on whichever camera draws it, at half the camera's reach.
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.copy(camera.position);
    sky.scale.setScalar(camera.far * 0.5);
    sky.updateMatrixWorld();
  };
  return sky;
}

// Apply the atmosphere to a scene; returns a function that puts the scene's
// previous background, fog colour and light colours back.
export function applyAtmosphere(scene, { sky = true, atmosphere = JUNKYARD_ATMOSPHERE } = {}) {
  const original = { background: scene.background?.getHex?.(), fog: scene.fog?.color.getHex(), lights: [] };
  scene.background?.setHex?.(atmosphere.horizon);
  scene.fog?.color.setHex(atmosphere.horizon);
  scene.traverse((object) => {
    if (!object.isLight) return;
    original.lights.push([object, object.color.getHex(), object.groundColor?.getHex()]);
    object.color.setHex(atmosphere.lightColour);
    if (object.isHemisphereLight) object.groundColor.setHex(atmosphere.groundBounce);
  });
  const dome = sky ? createSky(atmosphere) : null;
  if (dome) scene.add(dome);
  return () => {
    if (dome) {
      scene.remove(dome);
      dome.geometry.dispose();
      dome.material.dispose();
    }
    if (original.background !== undefined) scene.background.setHex(original.background);
    if (original.fog !== undefined) scene.fog.color.setHex(original.fog);
    for (const [light, colour, ground] of original.lights) {
      light.color.setHex(colour);
      if (ground !== undefined) light.groundColor.setHex(ground);
    }
  };
}
