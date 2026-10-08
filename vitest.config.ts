import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/mobile/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
  },
});
