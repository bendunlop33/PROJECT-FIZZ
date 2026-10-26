import { describe, expect, it } from 'vitest';

import { NBSP, type ComparableSet } from '@fizz/domain';
import { apply, BENCH, kg, logCmd, ms, setsFor, startFixture, values } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';

import { nextSetLine, planRestAlert } from '../src/alerts/rest-alerts';
import { createLastTimeCache } from '../src/live-activity/last-time-cache';

/**
 * The rest-done text with last time (Ben, 26 Oct 2026; lock-screen-and-alerts
 * §2.2), and the history cache behind `last …` on the notification and the
 * Live Activity.
 */

const plain = (s: string) => s.replaceAll(NBSP, ' ');
const history = (...sets: [number, number][]): ComparableSet[] => sets.map(([load, reps], index) => ({ index, values: values(kg(load), reps) }));

function afterWarmup(): SessionAggregate {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0]?.id ?? '';
  return apply(state, logCmd(warm, values(kg(60), 10), 5));
}

describe('rest-done text', () => {
  const s = afterWarmup();
  const benchRow = setsFor(s, BENCH)[1]?.sessionExerciseId ?? '';
  const lookup = (exId: string) => (exId === benchRow ? history([100, 8], [100, 7]) : undefined);

  it('`Bench press · set 2 · target 100 kg × 6–8 · last 100 kg × 8`; without history, no `last`', () => {
    expect(plain(nextSetLine(s, lookup))).toBe('Bench press · set 2 · target 100 kg × 6–8 · last 100 kg × 8');
    expect(plain(nextSetLine(s))).toBe('Bench press · set 2 · target 100 kg × 6–8');
    expect(plain(nextSetLine(s, () => []))).toBe('Bench press · set 2 · target 100 kg × 6–8');
  });

  it('`last` arriving reschedules the alert (new key); the key without it is as before', () => {
    const without = planRestAlert(s, ms(10));
    const withLast = planRestAlert(s, ms(10), lookup);
    expect(without?.key).toBe(`${s.restTimer?.id ?? ''}:${String(s.restTimer?.version)}:${s.session.activeSetId ?? ''}:${String(s.session.version)}`);
    expect(withLast?.key).toBe(`${without?.key ?? ''}:last 100${NBSP}kg${NBSP}×${NBSP}8`);
    expect(withLast?.fireAtMs).toBe(without?.fireAtMs);
  });
});

describe('last-time cache', () => {
  it('reads once per workout row; lookups see it after; a new reader (restore, relaunch) starts empty', async () => {
    const s = afterWarmup();
    const row = setsFor(s, BENCH)[1]?.sessionExerciseId ?? '';
    const cache = createLastTimeCache(() => 0);
    let reads = 0;
    cache.setReader(() => {
      reads += 1;
      return Promise.resolve(history([100, 8]));
    });
    expect(cache.lookup(s)(row)).toBeUndefined();
    const [first, second] = await Promise.all([cache.ensure(s), cache.ensure(s)]);
    expect([first, second]).toEqual([true, false]);
    expect(await cache.ensure(s)).toBe(false);
    expect(reads).toBe(1);
    expect(cache.lookup(s)(row)).toEqual(history([100, 8]));
    cache.setReader(null);
    expect(cache.lookup(s)(row)).toBeUndefined();
    expect(await cache.ensure(s)).toBe(false);
  });

  it('a failed read is no `last` (never throws); a swap to another exercise on the row reads again', async () => {
    const s = afterWarmup();
    const row = setsFor(s, BENCH)[1]?.sessionExerciseId ?? '';
    const cache = createLastTimeCache(() => 0);
    cache.setReader(() => Promise.reject(new Error('SQLite busy')));
    expect(await cache.ensure(s)).toBe(false);
    expect(cache.lookup(s)(row)).toEqual([]);
    cache.setReader(() => Promise.resolve(history([40, 12])));
    const swapped: SessionAggregate = { ...s, exercises: s.exercises.map((e) => (e.id === row ? { ...e, exerciseId: 'another-exercise' } : e)) };
    expect(await cache.ensure(swapped)).toBe(true);
    expect(cache.lookup(swapped)(row)).toEqual(history([40, 12]));
  });
});
