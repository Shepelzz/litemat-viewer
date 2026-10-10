import { defineConfig } from 'vite';

// base: './' makes the build work from any path (domain root, GitHub Pages subfolder, file share)
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
