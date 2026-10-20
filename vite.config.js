import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  // multiplayer rooms run in the Cloudflare Worker: run `npx wrangler dev` alongside `npm run dev`
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
