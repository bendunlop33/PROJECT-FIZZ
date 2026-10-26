import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TodayMain } from '@fizz/domain';

import { todayTickMs } from '../src/today/today-view';

/** App review 26 Oct, finding 8 (Ben approved): Today ticks only while a clock is on screen. */
describe('Today’s clock tick (review 26 Oct, finding 8)', () => {
  const resume = (status: Extract<TodayMain, { kind: 'resume' }>['status']): TodayMain =>
    ({ kind: 'resume', sessionId: 's', title: 'Push', startedAtUtc: '2026-10-26T09:00:00Z', now: null, done: 1, total: 10, status, rows: [], timeLeft: null }) as unknown as TodayMain;

  it('no workout open: no tick at all', () => {
    expect(todayTickMs(null)).toBeNull();
    expect(todayTickMs({ kind: 'no_plan' })).toBeNull();
    expect(todayTickMs({ kind: 'done_today', sessionId: 's', title: 'Push', activeMs: null })).toBeNull();
    expect(todayTickMs({ kind: 'stale' } as unknown as TodayMain)).toBeNull();
  });

  it('resting: each second (the countdown); otherwise each minute (the start time’s day)', () => {
    expect(todayTickMs(resume({ kind: 'resting', deadlineUtc: '2026-10-26T09:05:00Z' }))).toBe(1000);
    expect(todayTickMs(resume({ kind: 'ready' }))).toBe(60_000);
    expect(todayTickMs(resume({ kind: 'paused' }))).toBe(60_000);
  });

  const screen = readFileSync(join(import.meta.dirname, '../src/screens/TodayScreen.tsx'), 'utf8');
  it('the screen uses it, and no unconditional 1 s interval is left', () => {
    expect(screen).toContain('const tickMs = todayTickMs(');
    expect(screen).toContain('if (tickMs === null) return;');
    expect(screen).not.toMatch(/setInterval\([\s\S]{0,80}?\}, 1000\)/);
  });

  it('the strip and the day row are memoised (not rebuilt on every render)', () => {
    expect(screen).toMatch(/const strip = useMemo\(/);
    expect(screen).toMatch(/const segs = useMemo\(/);
    // Both hooks run before the early returns (rules of hooks).
    const firstReturn = screen.indexOf("if (data.state === 'loading') return");
    expect(screen.indexOf('const strip = useMemo(')).toBeLessThan(firstReturn);
    expect(screen.indexOf('const segs = useMemo(')).toBeLessThan(firstReturn);
  });
});
