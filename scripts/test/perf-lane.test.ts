import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import defaultConfig, { PERF_TESTS } from '../../vitest.config.ts';
import perfConfig from '../../vitest.perf.config.ts';

/** The perf lane: wall-clock budgets never run in `npm test`, so machine load can't fail it (or the .ipa build). */
const ROOT = join(import.meta.dirname, '..', '..');

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...testFiles(p));
    else if (e.name.endsWith('.test.ts')) out.push(relative(ROOT, p));
  }
  return out;
}

const ALL = ['packages', 'apps/mobile/test', 'scripts/test'].flatMap((d) => testFiles(join(ROOT, d)));
// A wall-clock read in a test: `performance.now()` or the load-scaled `timingBudget`.
const TIMED = /performance\.now\(\)|timingBudget\(|process\.hrtime/;

describe('perf lane', () => {
  it('the default run excludes *.perf.test.ts; the perf config runs only them, one file at a time', () => {
    expect(defaultConfig.test?.exclude).toContain(PERF_TESTS);
    expect(perfConfig.test?.include?.every((g) => g.endsWith('*.perf.test.ts'))).toBe(true);
    expect(perfConfig.test?.fileParallelism).toBe(false);
  });

  it('every test file that times itself is a perf test', () => {
    const timed = ALL.filter((f) => !f.endsWith('.perf.test.ts') && f !== 'scripts/test/perf-lane.test.ts' && TIMED.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(timed).toEqual([]);
    expect(ALL.filter((f) => f.endsWith('.perf.test.ts')).length).toBeGreaterThanOrEqual(8);
  });

  it('npm test runs the default config; test:perf the perf one', () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['test']).toBe('vitest run');
    expect(scripts['test:perf']).toContain('--config vitest.perf.config.ts');
  });
});
