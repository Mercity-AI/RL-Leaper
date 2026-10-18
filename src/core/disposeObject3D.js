// Free the GPU memory held by a finished part of the scene: every geometry,
// material and texture under `root`. Three.js never does this by itself, so
// without it a map or character that is taken out of the scene still occupies
// graphics memory (review finding core-loop-no-lifecycle-reload-to-resize).
// Returns how many geometries, materials and textures were released.
export function disposeObject3D(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  // 1. Collect first (things are often shared between meshes; free each once).
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      // Any texture slot (map, normalMap, roughnessMap, ...).
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  // 2. Release them.
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const texture of textures) texture.dispose?.();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}
