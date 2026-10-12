import { configDefaults, defineConfig } from 'vitest/config';

/** Test files whose budgets are wall-clock time: they run only in the perf lane (`npm run test:perf`, vitest.perf.config.ts). */
export const PERF_TESTS = '**/*.perf.test.ts';
export const TEST_ROOTS = ['packages/*/test/**', 'apps/mobile/test/**', 'scripts/test/**'];

export default defineConfig({
  test: {
    include: TEST_ROOTS.map((root) => `${root}/*.test.ts`),
    // Machine load must never fail `npm test` (or the iPhone build that runs it): timing budgets live in the perf lane.
    exclude: [...configDefaults.exclude, PERF_TESTS],
    environment: 'node',
    // The catalogue drawing tests take several seconds each; under parallel load from
    // other work on the same machine the 5 s default made `npm run check` flaky (review N8).
    testTimeout: 30_000,
  },
});
