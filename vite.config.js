import { defineConfig } from 'vite';

// Vanilla JS + Vite. Static output in dist/, ready for Cloudflare Pages.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: true,
  },
});
