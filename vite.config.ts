import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const serverPort = Number(process.env.SERVER_PORT || 3000);

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  publicDir: fileURLToPath(new URL('./client/public', import.meta.url)),
  plugins: [preact()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    // Phones in WeChat / older Android WebViews: stay conservative
    target: ['es2019', 'safari13', 'chrome80'],
    cssTarget: ['safari13', 'chrome80'],
    assetsInlineLimit: 0,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});
