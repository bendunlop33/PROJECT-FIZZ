import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import defaultConfig, { PERF_TESTS, RENDER_TESTS } from '../../vitest.config.ts';
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
// A wall-clock read in a test: `performance.now()`, `Date.now() -`, `process.hrtime`, the load-scaled `timingBudget` or `measureBlocking`.
const TIMED = /performance\.now\(\)|timingBudget\(|measureBlocking\(|process\.hrtime|Date\.now\(\)\s*-/;

describe('perf lane', () => {
  it('the default run excludes *.perf.test.ts; the perf config runs only them, one file at a time', () => {
    // `npm test` runs two projects (ADR 0037): the unit tests (perf excluded) and the screen render smoke tests.
    const projects = (defaultConfig.test?.projects ?? []) as { test?: { name?: string; include?: string[]; exclude?: string[] } }[];
    const unit = projects.find((p) => p.test?.name === 'unit');
    expect(unit?.test?.exclude).toContain(PERF_TESTS);
    expect(projects.find((p) => p.test?.name === 'render')?.test?.include).toEqual([RENDER_TESTS]);
    expect(RENDER_TESTS.endsWith('.perf.test.ts')).toBe(false);
    expect(perfConfig.test?.include?.every((g) => g.endsWith('*.perf.test.ts'))).toBe(true);
    expect(perfConfig.test?.fileParallelism).toBe(false);
  });

  it('every test file that times itself is a perf test', () => {
    const timed = ALL.filter((f) => !f.endsWith('.perf.test.ts') && f !== 'scripts/test/perf-lane.test.ts' && TIMED.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(timed).toEqual([]);
    expect(ALL.filter((f) => f.endsWith('.perf.test.ts')).length).toBeGreaterThanOrEqual(7);
  });

  it('every perf test times itself: correctness checks stay in the blocking default suite', () => {
    const untimed = ALL.filter((f) => f.endsWith('.perf.test.ts') && !TIMED.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(untimed).toEqual([]);
  });

  it('the guide D6 raster check runs in the default suite', () => {
    expect(ALL).toContain('packages/catalogue/test/definition-raster.test.ts');
    expect(ALL.some((f) => f.includes('definition') && f.endsWith('.perf.test.ts'))).toBe(false);
  });

  it('npm test runs the default config; test:perf the perf one', () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['test']).toBe('vitest run');
    expect(scripts['test:perf']).toContain('--config vitest.perf.config.ts');
  });
});
