import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The export is hosted as plain files (IPFS gateway subpath or an ENS name), so every asset URL
// is relative and there is no server-side routing. Output goes to the repository-root dist/.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 20000,
  },
});
