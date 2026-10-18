import { defineConfig } from 'vite';

export default defineConfig({
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
});
