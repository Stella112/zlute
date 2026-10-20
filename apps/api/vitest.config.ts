import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@lute/luteguard': fileURLToPath(new URL('../../packages/luteguard/src/index.ts', import.meta.url)),
      '@lute/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
