import { defineConfig } from 'vite';

// The app imports the engine and search from ../src, outside this folder.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
  worker: { format: 'es' },
});
