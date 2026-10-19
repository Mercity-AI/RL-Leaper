import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Glow (bloom) for the things that should shine: the Leaper's red eye and leg
// lights, its laser bolts, muzzle flashes, tracers and sparks. Only those glow
// (a "selective" bloom); a white shirt or a sunlit wall never does.
//
// Each frame:
//   1. the scene is drawn into an off-screen picture, exactly as it would be on
//      screen (same tone mapping and colours);
//   2. a "glow buffer" gets a copy of the picture's depth, then only the glowing
//      things are drawn into it, under the same lights (so walls and bodies
//      still hide glows behind them, for the cost of a handful of extra draws);
//   3. UnrealBloomPass (three.js r128 examples) blurs the glow buffer;
//   4. picture + blur go to the screen.
// Medium and high quality on WebGL2 (see Quality.js); otherwise the scene is
// drawn straight to the screen as before.

// The camera layer glowing objects are put on (as well as their usual one, so
// rays and everything else still see them).
export const GLOW_LAYER = 30;

// ---- What glows ----

// A material glows when it says so (material.userData.glow = true / false), or,
// by default, when it is an unlit see-through effect that doesn't hide what's
// behind it (MeshBasic / LineBasic / Points / Shader materials that are
// transparent with depthWrite off): laser bolts, muzzle flashes, tracers, sparks.
// On-top overlays (depthTest off: the clearance map, sight lines) never glow.
export function glows(material) {
  if (!material) return false;
  if (material.userData?.glow !== undefined) return Boolean(material.userData.glow);
  const unlit = material.isMeshBasicMaterial || material.isLineBasicMaterial || material.isPointsMaterial
    || (material.isShaderMaterial && !material.isRawShaderMaterial);
  return Boolean(unlit && material.transparent && material.depthWrite === false && material.depthTest !== false);
}

// Mark a material (or every material under an object) as glowing or not. Other
// systems call this for anything new that should (or shouldn't) shine.
export function markGlow(target, on = true) {
  const apply = (material) => { if (material) material.userData.glow = on; };
  if (target?.isMaterial) apply(target);
  else target?.traverse?.((object) => [object.material].flat().forEach(apply));
  return target;
}

// ---- The bloom renderer ----

// Final step: the picture plus the blurred glow, straight to the screen. Both
// already hold display colours, so nothing is converted on the way.
const COMPOSITE_SHADER = {
  defines: { BLOOM: 1 },
  uniforms: { tScene: { value: null }, tBloom: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBloom; varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tScene, vUv);
      #if BLOOM
        base.rgb += texture2D(tBloom, vUv).rgb;
      #endif
      gl_FragColor = base;
    }`,
};

export class GlowRenderer {
  // Only on WebGL2 (the glow buffer copies the picture's depth with a blit).
  static supported(renderer) {
    return Boolean(renderer.capabilities?.isWebGL2);
  }

  // settings: { strength, radius, resolution } from the quality preset.
  constructor(renderer, scene, camera, settings, { antialias = true } = {}) {
    Object.assign(this, { renderer, scene, camera, settings });
    // 1. Off-screen picture (multisampled when antialiasing is on), holding
    //    display (sRGB) colours exactly like the screen would. With a stencil
    //    buffer, three.js r128 gives a target the same 24-bit depth as the
    //    screen (its default 16 bits made car windows flicker through the body).
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const options = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      encoding: THREE.sRGBEncoding, stencilBuffer: true };
    this.sceneTarget = antialias
      ? new THREE.WebGLMultisampleRenderTarget(size.x, size.y, options)
      : new THREE.WebGLRenderTarget(size.x, size.y, options);
    // 2. The glow buffer (same size, so the depth copies across) and the bloom
    //    that blurs it (threshold 0: the buffer is black except for what glows).
    this.glowTarget = new THREE.WebGLRenderTarget(size.x, size.y, options);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), settings.strength, settings.radius, 0);
    // 3. The final blend to the screen.
    this.composite = new THREE.ShaderMaterial({ ...COMPOSITE_SHADER, defines: { ...COMPOSITE_SHADER.defines },
      uniforms: THREE.UniformsUtils.clone(COMPOSITE_SHADER.uniforms),
      depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.composite);
    this.glowLayers = new THREE.Layers();
    this.glowLayers.set(GLOW_LAYER);
    this.frame = { calls: 0, triangles: 0 };
    this.clearColour = new THREE.Color();
    this.setSize(size.x, size.y);
  }

  // Match the drawing buffer (call after the renderer is resized). The blur
  // works at `resolution` of the screen (UnrealBloomPass halves what it's given).
  setSize(width, height) {
    this.sceneTarget.setSize(width, height);
    this.glowTarget.setSize(width, height);
    const share = this.settings.resolution ?? 0.5;
    this.bloom.setSize(Math.max(2, Math.round(width * share * 2)), Math.max(2, Math.round(height * share * 2)));
  }

  // Put every object whose material glows on the glow layer (and take it off
  // things that stopped glowing). Returns how many glowing objects are shown.
  tagGlowing() {
    let glowing = 0;
    this.scene.traverse((object) => {
      // Lights shine in the glow pass too. Left out, that pass would be lit by
      // no lights at all, so three.js would switch every lit material's shader
      // to an unlit variant and back twice a frame (and compile extra ones).
      // With the same lights, glowing parts draw exactly as in the picture.
      if (object.isLight) {
        object.layers.enable(GLOW_LAYER);
        return;
      }
      if (!object.material || Array.isArray(object.material)) return;
      if (glows(object.material)) {
        object.layers.enable(GLOW_LAYER);
        if (object.visible) glowing += 1;
      } else {
        object.layers.disable(GLOW_LAYER);
      }
    });
    return glowing;
  }

  // Copy the picture's depth into the glow buffer (WebGL2 blit; from the
  // multisampled buffers when the picture is antialiased).
  copyDepth() {
    const { renderer } = this;
    const gl = renderer.getContext();
    const source = renderer.properties.get(this.sceneTarget);
    const target = renderer.properties.get(this.glowTarget);
    const read = source.__webglMultisampledFramebuffer ?? source.__webglFramebuffer;
    renderer.setRenderTarget(this.glowTarget);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    const { width, height } = this.glowTarget;
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.__webglFramebuffer);
  }

  // Draw one frame: picture, glow buffer, blur, blend to screen. this.frame
  // keeps the frame's total draw calls and triangles (every pass added up).
  render() {
    const { renderer, scene, camera, frame } = this;
    const count = () => { frame.calls += renderer.info.render.calls; frame.triangles += renderer.info.render.triangles; };
    frame.calls = 0;
    frame.triangles = 0;
    // 1. The picture.
    const glowing = this.tagGlowing();
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    count();
    // 2. The glow buffer: black, the picture's depth, then only the glowing things
    //    (no background, no shadow redraw). Everything is put back right after.
    if (glowing) {
      const background = scene.background, autoClear = renderer.autoClear, autoUpdate = renderer.shadowMap.autoUpdate;
      const layers = camera.layers.mask;
      const clearColour = renderer.getClearColor(this.clearColour), clearAlpha = renderer.getClearAlpha();
      try {
        this.copyDepth();
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, false, false);
        scene.background = null;
        renderer.autoClear = false;
        renderer.shadowMap.autoUpdate = false;
        camera.layers.mask = this.glowLayers.mask;
        renderer.render(scene, camera);
        count();
      } finally {
        camera.layers.mask = layers;
        scene.background = background;
        renderer.autoClear = autoClear;
        renderer.shadowMap.autoUpdate = autoUpdate;
        renderer.setClearColor(clearColour, clearAlpha);
      }
      // 3. Blur it.
      this.bloom.render(renderer, null, this.glowTarget, 0, false);
    }
    // 4. Picture + blur to the screen (just the picture when nothing glows).
    this.composite.uniforms.tScene.value = this.sceneTarget.texture;
    this.composite.uniforms.tBloom.value = glowing ? this.bloom.renderTargetsHorizontal[0].texture : null;
    this.composite.defines.BLOOM = glowing ? 1 : 0;
    this.composite.needsUpdate = this.lastGlowing !== Boolean(glowing);
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
    // Full-screen passes: bright filter, 2 blurs per mip, mix, copy, and the final blend.
    frame.calls += glowing ? 2 * this.bloom.nMips + 4 : 1;
    this.lastGlowing = Boolean(glowing);
  }

  dispose() {
    this.sceneTarget.dispose();
    this.glowTarget.dispose();
    this.bloom.dispose?.();
    this.composite.dispose();
    this.quad.dispose();
  }
}
