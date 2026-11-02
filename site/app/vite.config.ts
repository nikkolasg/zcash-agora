import { defineConfig } from 'vite';

// Built into ../vote/ (served at /vote/ by GitHub Pages). The wasm and the
// prover worker are plain assets; bb.js needs cross-origin isolation for
// threads, which coi-serviceworker.js adds on hosts that cannot set headers.
export default defineConfig({
  base: '/vote/',
  build: {
    outDir: '../vote',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { prover: ['@aztec/bb.js', '@noir-lang/noir_js'] } } }
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@isoloir/web', '@aztec/bb.js', '@noir-lang/noir_js'] },
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
    fs: { allow: ['..', '../../isoloir/js'] }
  }
});
