import { configDefaults, defineConfig } from 'vitest/config';

import { PERF_TESTS, TEST_ROOTS } from './vitest.config.ts';

/**
 * The perf lane: every test with a wall-clock budget (`*.perf.test.ts`). Run with
 * `npm run test:perf`; excluded from `npm test`. Files run one at a time so they
 * don't compete with each other for the CPU; budgets are unchanged.
 */
export default defineConfig({
  test: {
    include: TEST_ROOTS.map((root) => `${root}/${PERF_TESTS.replace('**/', '')}`),
    exclude: [...configDefaults.exclude],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 1_200_000,
  },
});
