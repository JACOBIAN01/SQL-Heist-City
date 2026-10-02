import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = `http://localhost:${process.env.ADMIN_API_PORT ?? 8081}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': apiTarget, '/health': apiTarget },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
