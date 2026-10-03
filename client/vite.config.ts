import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Three.js alone is ~500 kB minified (~130 kB gz); our budget is on gzipped first load.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: page('index.html'), sqlDemo: page('sql-demo.html') } },
  },
});
