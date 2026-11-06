// Builds a self-contained browser preview: the API and SQLite database run inside the page.
// Usage: npm run build:preview  → preview/voltline-preview.html
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const shim = (f) => path.resolve('web/demo/shims', f);
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^better-sqlite3$/, replacement: shim('better-sqlite3.js') },
      { find: /^express$/, replacement: shim('express.js') },
      { find: /^multer$/, replacement: shim('multer.js') },
      { find: /^(node:)?crypto$/, replacement: shim('node-crypto.js') },
      { find: /^(node:)?(fs|path|url)$/, replacement: shim('node-misc.js') },
      { find: /^nodemailer$/, replacement: shim('node-misc.js') },
    ],
  },
  build: {
    outDir: '../dist-preview',
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { input: path.resolve('web/demo.html'), output: { inlineDynamicImports: true } },
  },
});
