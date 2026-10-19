import { defineConfig } from 'vite';

// Where the built game is served from. '/' for local play; the GitHub Pages
// workflow sets LEAPER_BASE=/<repository name>/ because Pages serves project
// sites from a sub-folder (every asset URL must start with it).
const base = process.env.LEAPER_BASE || '/';

export default defineConfig({
  base,
  // onnxruntime-web ships WebAssembly files it loads at runtime. Excluding it from
  // Vite's dependency pre-bundling keeps those .wasm paths intact, so the brain
  // engine loads cleanly in dev and build.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  // Fixed ports: if one is busy, Vite stops with a clear error instead of quietly
  // moving to another port, so the printed game address is always the real one.
  // (`--port <n>` on the command line still picks a different port on purpose.)
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  // Background threads (the junkyard's collision builder) are bundled as modules.
  worker: {
    format: 'es',
  },
  build: {
    // three.js r128 alone is ~566 kB minified (145 kB gzipped); warn above that.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three.js gets a file of its own: it never changes between game updates,
        // so returning players keep it cached. Each mode is already its own file.
        // The engine core (src/core) gets one too. It is shared by the page's
        // entry and the modes; left in the entry file, a mode would import the
        // entry while the entry is still waiting for that mode to start, and
        // the page would hang at boot (a cycle through main.js's top-level await).
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](\.pnpm[\\/]three@[^\\/]+[\\/]node_modules[\\/])?three[\\/]/.test(id)) return 'three';
          if (/[\\/]src[\\/]core[\\/]/.test(id)) return 'core';
          return undefined;
        },
      },
    },
  },
});
