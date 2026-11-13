import { configDefaults, defineConfig } from 'vitest/config';

/** Test files whose budgets are wall-clock time: they run only in the perf lane (`npm run test:perf`, vitest.perf.config.ts). */
export const PERF_TESTS = '**/*.perf.test.ts';
export const TEST_ROOTS = ['packages/*/test/**', 'apps/mobile/test/**', 'scripts/test/**'];
/**
 * Render smoke tests (ADR 0037): screens rendered with React's real reconciler over the real services on real
 * SQLite, with native packages replaced by JS stand-ins (`apps/mobile/test/render/setup.ts`). Part of `npm test`.
 */
export const RENDER_TESTS = 'apps/mobile/test/render/**/*.test.tsx';

export default defineConfig({
  test: {
    environment: 'node',
    // The catalogue drawing tests take several seconds each; under parallel load from
    // other work on the same machine the 5 s default made `npm run check` flaky (review N8).
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: TEST_ROOTS.map((root) => `${root}/*.test.ts`),
          // Machine load must never fail `npm test` (or the iPhone build that runs it): timing budgets live in the perf lane.
          exclude: [...configDefaults.exclude, PERF_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'render',
          include: [RENDER_TESTS],
          setupFiles: ['apps/mobile/test/render/setup.ts'],
          // Each test seeds two weeks of history and a plan over SQLite before rendering: room for a loaded machine.
          testTimeout: 90_000,
        },
      },
    ],
  },
});
