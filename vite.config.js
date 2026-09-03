import { defineConfig } from 'vite';

// onnxruntime-web ships WebAssembly files it loads at runtime. Excluding it from
// Vite's dependency pre-bundling keeps those .wasm paths intact, so the brain
// engine loads cleanly in dev and build.
export default defineConfig({
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
