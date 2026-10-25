import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localDateOf, timingUndoCommand, toIso, toMs } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { clampPastStart, pastLogWhen, withPickedDate, withPickedTime } from '../src/workout/past-log-view';
import { workoutMenu } from '../src/workout/table';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * (Ben, 25 Oct) "I should be able to freely edit times, e.g. if I want to import a workout
 * historically from the day before or beyond." Through the whole app on real SQLite files:
 * Log a past workout, its order by date, moving an old workout, Undo, retries, a relaunch.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Log a past workout (app services)', () => {
  it('yesterday’s workout entered after today’s: no clock, its own date, and never “last time” over today’s', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const todayStart = h.clockMs;
    const today = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);

    h.clockMs += 2 * 3_600_000;
    const choices = await s.workout.pastLogChoices();
    if (!choices) throw new Error('choices');
    // Yesterday, at today's workout's time of day (5-minute steps).
    expect(localDateOf(choices.defaultStartMs, TZ)).toBe(localDateOf(h.clockMs - DAY, TZ));
    expect(Math.abs(choices.defaultStartMs + DAY - todayStart)).toBeLessThan(5 * 60_000 + 3_600_000);
    const started = await s.workout.start({ gymId, opId: 'past-1', checkIn: null, pastStart: { utc: toIso(choices.defaultStartMs), tz: TZ } });
    if (!started.ok) throw new Error(started.error.message);
    const sid = started.aggregate.session.id;
    expect(started.aggregate.session.pastLog).toBeDefined();
    expect(started.aggregate.session.checkIn).toBeNull();
    // A retried Start (double tap, relaunch) is the same workout.
    const again = await s.workout.start({ gymId, opId: 'past-1', checkIn: null, pastStart: { utc: toIso(choices.defaultStartMs), tz: TZ } });
    expect(again.ok && again.duplicate && again.aggregate.session.id).toBe(sid);

    const picks = await s.workout.pickerExercises(sid, 'Bench press');
    const bench = picks.find((p) => p.exercise.name === 'Bench press');
    if (!bench) throw new Error('bench');
    const added = await s.workout.addExercise({ sessionId: sid, exerciseId: bench.exercise.id, equipmentId: bench.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const ex = added.aggregate.exercises.at(-1);
    const set = added.aggregate.sets.find((x) => x.sessionExerciseId === ex?.id && x.status === 'pending');
    if (!ex || !set) throw new Error('set');
    const logged = await s.workout.dispatch(sid, { type: 'log_set', at: h.now(), opId: 'past-log-1', setId: set.id, values: { load: { value: 110, unit: ex.unit, convention: ex.loadConvention }, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    // No clock: no rest timer, so no rest alert is planned.
    expect(logged.aggregate.restTimer).toBeNull();
    await h.settle(s);
    expect([...h.pending.values()].filter((a) => a.identifier.includes(sid))).toEqual([]);
    expect(toMs(logged.aggregate.sets.find((x) => x.id === set.id)?.completedAt?.utc ?? '')).toBe(choices.defaultStartMs + 1000);

    // A relaunch mid-entry restores it as it was.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const back = await s2.workout.load(sid);
    expect(back?.aggregate.session.pastLog).toBeDefined();
    const end = choices.defaultStartMs + 50 * 60_000;
    const fin = await s2.workout.dispatch(sid, { type: 'finish', at: s2.now(), opId: 'past-fin', expectedVersion: back?.aggregate.session.version ?? 0, endedAt: { utc: toIso(end), tz: TZ } });
    if (!fin.ok) throw new Error(fin.error.message);
    expect(fin.aggregate.session.endedAt?.utc).toBe(toIso(end));

    // Its Summary reads as of its date: no Next time for Bench (done again today).
    const sum = await s2.workout.summary(sid);
    expect(sum?.pastLog).toBe(true);
    expect(sum?.nextTime).toBeNull();

    // Tomorrow's Bench reads today's 100 kg as last time, not the 110 kg entered later.
    h.clockMs += DAY;
    const next = await s2.workout.start({ gymId, opId: 'tomorrow', checkIn: null });
    if (!next.ok) throw new Error(next.error.message);
    const added2 = await s2.workout.addExercise({ sessionId: next.aggregate.session.id, exerciseId: bench.exercise.id, equipmentId: bench.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added2.ok) throw new Error(added2.error.message);
    const row = added2.aggregate.exercises.at(-1);
    const last = await s2.workout.lastComparableSets(added2.aggregate, row?.id ?? '');
    expect(last.map((x) => x.values.load?.value)).toEqual([100, 100, 100]);
    expect(today).not.toBe(sid);
  });
});

describe('moving a finished workout in time (app services)', () => {
  it('a week back with its sets; Undo puts it back; a retry is a duplicate; a stale sheet is refused', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2].map(() => ({ load: 80, reps: 8 })) }]);
    const before = (await s.workout.load(id))?.aggregate;
    if (!before) throw new Error('load');
    const start = toMs(before.session.startedAt.utc);
    const cmd = { type: 'update_session_timing' as const, at: h.now(), opId: 'move-1', expectedVersion: before.session.version, startedAt: { utc: toIso(start - 7 * DAY), tz: TZ }, endedAt: null, shift: true as const };
    const moved = await s.workout.dispatch(id, cmd);
    if (!moved.ok) throw new Error(moved.error.message);
    const times = (a: SessionAggregate) => a.sets.filter((x) => x.status === 'completed').map((x) => toMs(x.completedAt?.utc ?? ''));
    expect(times(moved.aggregate)).toEqual(times(before).map((t) => t - 7 * DAY));
    expect(moved.aggregate.sets.map((x) => x.actual)).toEqual(before.sets.map((x) => x.actual));
    expect(await s.workout.dispatch(id, { ...cmd, at: h.now() })).toMatchObject({ ok: true, duplicate: true });
    const stale = await s.workout.dispatch(id, { ...cmd, opId: 'move-2' });
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');

    const undo = timingUndoCommand(moved.aggregate, 'move-1', 'undo-1', h.now());
    if (!undo) throw new Error('undo');
    const undone = await s.workout.dispatch(id, undo);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.aggregate.session.startedAt.utc).toBe(before.session.startedAt.utc);
    expect(undone.aggregate.session.endedAt?.utc).toBe(before.session.endedAt?.utc);
    expect(times(undone.aggregate)).toEqual(times(before));
  });
});

describe('past-log view', () => {
  it('the Date wheel keeps the time; the Start wheel keeps the date; DST-safe; never in the future or before 2000', () => {
    // 18:30 on 24 Oct London (BST), picked date 27 Oct (GMT): still 18:30 local.
    const start = Date.UTC(2026, 9, 24, 17, 30);
    const picked = withPickedDate(start, Date.UTC(2026, 9, 27, 9, 0), TZ);
    expect(picked).toBe(Date.UTC(2026, 9, 27, 18, 30));
    expect(withPickedTime(start, Date.UTC(2026, 0, 1, 7, 15), TZ)).toBe(Date.UTC(2026, 9, 24, 6, 15));
    expect(clampPastStart(Date.UTC(2026, 9, 26), Date.UTC(2026, 9, 25, 10, 0, 30))).toEqual({ startMs: Date.UTC(2026, 9, 25, 10, 0), note: 'Start can’t be in the future' });
    expect(clampPastStart(Date.UTC(1999, 0, 1), Date.UTC(2026, 9, 25)).note).toBe('Start can’t be before 2000');
    expect(pastLogWhen(Date.UTC(2026, 9, 24, 17, 0), TZ, 'en-GB')).toBe('Sat 24 Oct, 18:00');
  });

  it('a past log’s menu has no Pause and no spoken cues', () => {
    const base = { view: 'table' as const, paused: false, openEnded: false, ax: false, gymName: null, cuesOn: true };
    const labels = workoutMenu({ ...base, pastLog: true }).map((m) => m.label);
    expect(labels).not.toContain('Pause workout');
    expect(labels.some((l) => l.includes('spoken cues'))).toBe(false);
    expect(labels).toContain('Edit workout times');
    expect(workoutMenu(base).map((m) => m.label)).toContain('Pause workout');
  });
});
