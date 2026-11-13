import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';

import { clockText, localDateOf, moveCommand, planWorkoutMove, reduceSession, toMs, workoutFixApplyOpId, workoutWhenText } from '../src/index';
import { at, kg, TZ, values } from './fixtures';
import { apply, BENCH, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 2 Nov) "That Tuesday pull was actually Monday": a past workout's date or times moved by the coach's proposal,
 * checked by the reducer's own rules and in the workout's own zone (Pacific/Auckland here, so DST is exercised).
 */

const MIN = 60;

/** Thu 8 Oct, 19:00–19:40 local (T0 is 06:00 UTC, NZDT +13): bench 100 × 8 at +14 min. */
function finished(): SessionAggregate {
  let s = startFixture().state;
  const [, b1] = setsFor(s, BENCH);
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 14 * MIN));
  return apply(s, { type: 'finish', at: at(40 * MIN), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

const NOW = at(3 * 24 * 3600);

describe('planWorkoutMove', () => {
  it('a new day keeps the clock time and the length; the move is the workout’s own shift (sets move with it)', () => {
    const s = finished();
    expect(workoutWhenText(s.session)).toBe('Thu 8 Oct · 19:00–19:40');
    const plan = planWorkoutMove(s, { date: '2026-10-07', start: null, end: null }, NOW);
    if (!plan.ok) throw new Error(plan.line);
    expect([plan.before, plan.after]).toEqual(['Thu 8 Oct · 19:00–19:40', 'Wed 7 Oct · 19:00–19:40']);
    const moved = reduceSession(s, moveCommand({ sessionVersion: s.session.version, startedAt: plan.startedAt, endedAt: plan.endedAt }, workoutFixApplyOpId('p1'), NOW));
    if (!moved.ok) throw new Error(moved.error.message);
    const done = (a: SessionAggregate) => a.sets.filter((x) => x.status === 'completed').map((x) => toMs(x.completedAt?.utc ?? ''));
    expect(done(moved.state)).toEqual(done(s).map((t) => t - 24 * 3600 * 1000));
    expect(moved.state.sets.map((x) => x.actual)).toEqual(s.sets.map((x) => x.actual));
    // Stored as UTC with the zone (rule: UTC + timezone).
    expect(moved.state.session.startedAt.tz).toBe(TZ);
    expect(localDateOf(toMs(moved.state.session.startedAt.utc), TZ)).toBe('2026-10-07');
  });

  it('a start and end Ben names, on the workout’s own day', () => {
    const plan = planWorkoutMove(finished(), { date: null, start: '07:15', end: '08:05' }, NOW);
    if (!plan.ok) throw new Error(plan.line);
    expect(plan.after).toBe('Thu 8 Oct · 07:15–08:05');
  });

  it('across a DST change the clock time stays (NZ DST began 27 Sep 2026)', () => {
    const plan = planWorkoutMove(finished(), { date: '2026-09-26', start: null, end: null }, NOW);
    if (!plan.ok) throw new Error(plan.line);
    expect(clockText(toMs(plan.startedAt.utc), TZ)).toBe('19:00');
    expect(plan.after).toBe('Sat 26 Sep · 19:00–19:40');
  });

  it('refusals are one honest line: the future, no change, an end before its sets, a live workout, an import', () => {
    const s = finished();
    expect(planWorkoutMove(s, { date: '2026-10-20', start: null, end: null }, NOW)).toEqual({ ok: false, line: 'The start time is in the future' });
    expect(planWorkoutMove(s, { date: '2026-10-08', start: null, end: null }, NOW)).toEqual({ ok: false, line: 'Already Thu 8 Oct · 19:00–19:40' });
    expect(planWorkoutMove(s, { date: null, start: '19:00', end: '19:05' }, NOW)).toEqual({ ok: false, line: 'The end time is before the last logged set' });
    expect(planWorkoutMove(s, { date: null, start: 'soon', end: null }, NOW)).toEqual({ ok: false, line: 'soon isn’t a time' });
    expect(planWorkoutMove(startFixture().state, { date: '2026-10-07', start: null, end: null }, NOW)).toEqual({ ok: false, line: 'Only a finished workout can move' });
    const imported: SessionAggregate = { ...s, session: { ...s.session, localDate: '2026-10-08' } };
    expect(planWorkoutMove(imported, { date: '2026-10-07', start: null, end: null }, NOW)).toEqual({ ok: false, line: 'An imported workout keeps its date' });
    expect(workoutWhenText(imported.session)).toBe('Thu 8 Oct');
  });
});
