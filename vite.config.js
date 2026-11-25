import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = (p) => resolve(import.meta.dirname, p);

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rolldownOptions: {
      // one page per app; the hub at the root links to the rest
      input: {
        hub: page('index.html'),
        whereform: page('whereform/index.html'),
        mines: page('mines/index.html'),
        whereto: page('whereto/index.html'),
      },
    },
  },
  // the API (minesweeper matches, Whereto plans) runs in the Cloudflare Worker:
  // run `npx wrangler dev` alongside `npm run dev`
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
