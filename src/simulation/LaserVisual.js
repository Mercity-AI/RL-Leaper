import * as THREE from 'three';

// A finite red streak: its leading tip is at local Z=0, and its translucent
// tail extends backward. This is visual only; collision sweeps the leading tip.
export function createLaserVisual(config) {
  const geometry = new THREE.CylinderGeometry(config.laserRadius, config.laserRadius * 0.15,
    config.laserLength, 8, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, -config.laserLength / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(0x980c27) }, strength: { value: 0.95 } },
    vertexShader: `varying vec2 laserUv;
      void main() { laserUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 tint; uniform float strength; varying vec2 laserUv;
      void main() { gl_FragColor = vec4(tint, strength * pow(laserUv.y, 1.5)); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const glow = material.clone();
  glow.uniforms.strength.value = 0.10;
  glow.blending = THREE.AdditiveBlending;
  return {
    create() {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geometry, material));
      const halo = new THREE.Mesh(geometry, glow);
      halo.scale.set(3, 3, 1); group.add(halo);
      return group;
    },
  };
}
