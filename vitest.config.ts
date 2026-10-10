import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/mobile/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
    // The catalogue drawing tests take several seconds each; under parallel load from
    // other work on the same machine the 5 s default made `npm run check` flaky (review N8).
    testTimeout: 30_000,
  },
});
