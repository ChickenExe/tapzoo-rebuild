import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5199 },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
