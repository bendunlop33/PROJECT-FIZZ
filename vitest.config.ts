import { defineConfig } from 'vitest/config';

const ALL = ['packages/*/test/**/*.test.ts', 'apps/mobile/test/**/*.test.ts', 'scripts/test/**/*.test.ts'];
const PERF = ['packages/*/test/**/*-perf.test.ts', 'apps/mobile/test/**/*-perf.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    // The catalogue drawing tests take several seconds each; under parallel load from
    // other work on the same machine the 5 s default made `npm run check` flaky (review N8).
    testTimeout: 30_000,
    // Timing-budget tests run on their own, after everything else and one file at a time,
    // so the rest of the suite's load can't push them over budget and mask real failures
    // (review workout-library-merge S3).
    projects: [
      { extends: true, test: { name: 'unit', include: ALL, exclude: PERF, sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'perf', include: PERF, sequence: { groupOrder: 1 }, pool: 'forks', fileParallelism: false, maxWorkers: 1 } },
    ],
  },
});
