import { defineConfig } from 'vite';
import cfg from '../agora.config.json' with { type: 'json' };

// Built into ../vote/ (served at /vote/ by GitHub Pages). The wasm and the
// prover worker are plain assets; bb.js needs cross-origin isolation for
// threads, which coi-serviceworker.js adds on hosts that cannot set headers.
export default defineConfig(({ mode }) => ({
  // Served at <site base>/vote/ (GitHub Pages: a repository sub-path); the trial dev server at /vote/.
  base: mode === 'trial' ? '/vote/' : `${cfg.site.base}vote/`,
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
    fs: { allow: ['..', '../../isoloir/js'] },
    // The site's stylesheet and pages live outside this app: python3 -m http.server 8788 in ../ serves them in dev.
    proxy: {
      // The site's stylesheet: index.html links /assets/style.css and the dev server prefixes its base.
      '^/vote/assets/(style|anim)\\.css$': { target: 'http://127.0.0.1:8788', rewrite: (p: string) => p.replace(/^\/vote/, '') },
      '^/(?!vote/|src/|@|node_modules/).*': 'http://127.0.0.1:8788'
    }
  }
}));
