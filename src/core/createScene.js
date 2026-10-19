import * as THREE from 'three';
import { pickQuality, QUALITY_PRESETS } from './Quality.js';
import { GlowRenderer } from './postprocessing.js';

// The sun's offset from the point it lights, and its shadow box, at map scale 1.
// The junkyard scales both by its world scale and centres them on Lola
// (src/core/sunShadow.js); the lab modes keep these numbers around the robot.
export const SUN_OFFSET = Object.freeze({ x: 8, y: 15, z: 6 });
export const SHADOW_BOX = Object.freeze({ halfSize: 13, near: 2, far: 48, mapSize: 2048 });

// The renderer, scene, camera and lights every mode shares, set up for one
// graphics quality preset (src/core/Quality.js): picked automatically, or with
// ?quality=low|medium|high, or passed in as options.quality. options.glow:
// whether this page wants the bloom pass at all (the game does; the preset
// still decides, see Quality.js).
// Returns { renderer, scene, camera, sun, quality, glow, frame, render(), dispose() };
// draw a frame with engine.render() (it adds the glow when there is one).
export function createScene(container, { quality = pickQuality().name, glow: allowGlow = true } = {}) {
  const name = QUALITY_PRESETS[quality] ? quality : 'high';
  const preset = QUALITY_PRESETS[name];
  // With glow, the picture is drawn off-screen first (anti-aliased there), so the
  // screen itself needs no anti-aliasing buffer of its own (it would only cost
  // graphics memory). Glow needs WebGL2, which three.js picks when the browser has it.
  const wantGlow = allowGlow && Boolean(preset.bloom) && typeof WebGL2RenderingContext !== 'undefined';

  // 1. Renderer: ACES filmic tone mapping with sRGB output (the art's look),
  //    sharpness and shadow filtering from the preset.
  const renderer = new THREE.WebGLRenderer({ antialias: preset.antialias && !wantGlow, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = preset.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // 2. Scene with the default sky colour and fog (the junkyard sets its own).
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4f0f7);
  scene.fog = new THREE.Fog(0xe4f0f7, 24, 78);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    220,
  );

  // 3. Lights: sky fill, the shadow-casting sun (shadow size from the preset), a cool rim.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9ca7b2, 0.95));
  const sun = new THREE.DirectionalLight(0xfff7ea, 1.25);
  sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  sun.shadow.camera.left = -SHADOW_BOX.halfSize;
  sun.shadow.camera.right = SHADOW_BOX.halfSize;
  sun.shadow.camera.top = SHADOW_BOX.halfSize;
  sun.shadow.camera.bottom = -SHADOW_BOX.halfSize;
  sun.shadow.camera.near = SHADOW_BOX.near;
  sun.shadow.camera.far = SHADOW_BOX.far;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = preset.shadowNormalBias ?? 0;
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(0x7f9dff, 0.16);
  rim.position.set(-7, 9, -9);
  scene.add(rim);

  // 4. Glow (bloom) on the presets that have it; otherwise draw straight to screen.
  //    frame.calls / frame.triangles add up every pass of the last frame (three.js's
  //    own renderer.info only counts the last pass).
  const glow = wantGlow && GlowRenderer.supported(renderer)
    ? new GlowRenderer(renderer, scene, camera, preset.bloom, { antialias: preset.antialias }) : null;
  const frame = { calls: 0, triangles: 0 };
  const render = () => {
    if (glow) {
      glow.render();
      Object.assign(frame, glow.frame);
    } else {
      renderer.render(scene, camera);
      frame.calls = renderer.info.render.calls;
      frame.triangles = renderer.info.render.triangles;
    }
  };

  // 5. Follow the window size.
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (glow) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      glow.setSize(size.x, size.y);
    }
  };
  window.addEventListener('resize', onResize);

  // 6. Let go of the window listener and the GPU resources.
  const dispose = () => {
    window.removeEventListener('resize', onResize);
    glow?.dispose();
    renderer.dispose();
  };
  return { renderer, scene, camera, sun, quality: { name, ...preset }, glow, frame, render, dispose };
}
