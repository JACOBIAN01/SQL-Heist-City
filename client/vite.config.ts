import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  // Three.js alone is ~500 kB minified (~130 kB gz); our budget is on gzipped first load.
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 700 },
});
