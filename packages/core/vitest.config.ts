import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@lute/luteguard': fileURLToPath(new URL('../luteguard/src/index.ts', import.meta.url)),
    },
  },
});
