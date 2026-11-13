import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { START_MOVE_LABEL, startMoveShown, startMoveWrite, summaryTimeBounds, switchStartMove, timelineOf, timingUndoCommand, toIso, toMs, workoutTimeBounds } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * (Ben, 26 Oct; log-past-workout Q-PL1, option b) When Started moves on the Finish sheet, the Summary or a past
 * workout's `Edit times`: `Move whole workout` (default, ADR 0033) or `Only the start` (the 19 Oct behaviour: the
 * sets stay where they are and the start stays at or before the first set). Versioned, idempotent, one-tap Undo.
 * The pure choice, then the writes through the app's services on real SQLite.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const setTimes = (a: SessionAggregate) => a.sets.filter((x) => x.status === 'completed').map((x) => x.completedAt?.utc);

describe('Only the start: the choice (pure)', () => {
  const timeline = { startMs: Date.parse('2026-10-20T18:00:00Z'), lastSetMs: Date.parse('2026-10-20T18:50:00Z'), latestMs: Date.parse('2026-10-20T18:50:00Z') };
  const nowMs = Date.parse('2026-10-21T09:00:00Z');
  const fixed = { startMinMs: timeline.startMs - 24 * HOUR, startMaxMs: Date.parse('2026-10-20T18:05:00Z'), endMinMs: timeline.lastSetMs, endMaxMs: nowMs };

  it('shows once Started moved, never on a past log; labels are the two words', () => {
    expect(START_MOVE_LABEL).toEqual({ whole: 'Move whole workout', start_only: 'Only the start' });
    expect(startMoveShown(timeline.startMs, timeline.startMs, false)).toBe(false);
    expect(startMoveShown(timeline.startMs - 20 * MIN, timeline.startMs, false)).toBe(true);
    expect(startMoveShown(timeline.startMs - 20 * MIN, timeline.startMs, true)).toBe(false);
  });

  it('switching to `Only the start` puts the end back and keeps the 19 Oct bounds; back to whole moves the end along again', () => {
    // Whole: start 20 min earlier, the end moved along (19:00 → 18:40).
    const moved = { startMs: timeline.startMs - 20 * MIN, endMs: Date.parse('2026-10-20T18:40:00Z') };
    const only = switchStartMove('start_only', moved, { timeline, fixed, nowMs });
    expect(only).toEqual({ startMs: moved.startMs, endMs: Date.parse('2026-10-20T19:00:00Z'), note: null });
    expect(switchStartMove('whole', only, { timeline, fixed, nowMs })).toMatchObject({ startMs: moved.startMs, endMs: moved.endMs });
    // Two days back is too far for only the start (a day at most): clamped, with its note.
    const far = switchStartMove('start_only', { startMs: timeline.startMs - 48 * HOUR, endMs: Date.parse('2026-10-18T19:00:00Z') }, { timeline, fixed, nowMs });
    expect(far).toMatchObject({ startMs: fixed.startMinMs, note: 'start_too_early' });
  });

  it('only the whole workout writes `shift`', () => {
    expect(startMoveWrite('whole', true)).toEqual({ shift: true });
    expect(startMoveWrite('start_only', true)).toEqual({});
    expect(startMoveWrite('whole', false)).toEqual({});
  });
});

describe('Only the start through the app (real SQLite)', () => {
  it('Finish: the start moves 20 min earlier, every set stays where it was; Move whole workout moves them', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // A finished workout to compare with, then one still open (forgot Start).
    const st = await s.workout.start({ gymId, opId: 'start-live', checkIn: null });
    if (!st.ok) throw new Error(st.error.message);
    const sid = st.aggregate.session.id;
    const picks = await s.workout.pickerExercises(sid, 'Bench press');
    const bench = picks.find((p) => p.exercise.name === 'Bench press');
    const added = await s.workout.addExercise({ sessionId: sid, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add' });
    if (!added.ok) throw new Error(added.error.message);
    const set = added.aggregate.sets.find((x) => x.status === 'pending');
    h.clockMs += 5 * MIN;
    const logged = await s.workout.dispatch(sid, { type: 'log_set', at: h.now(), opId: 'log-1', setId: set?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    h.clockMs += 10 * MIN;
    const a = logged.aggregate;
    const recorded = toMs(a.session.startedAt.utc);
    // The sheet's pure bounds: the start can't pass the first set.
    expect(workoutTimeBounds(a, h.clockMs).startMaxMs).toBe(toMs(a.sets.find((x) => x.status === 'completed')?.completedAt?.utc ?? ''));
    const earlier = { utc: toIso(recorded - 20 * MIN), tz: TZ };
    const cmd = { type: 'finish' as const, at: h.now(), opId: 'finish-1', expectedVersion: a.session.version, endedAt: null, startedAt: earlier, ...startMoveWrite('start_only', true) };
    const fin = await s.workout.dispatch(sid, cmd);
    if (!fin.ok) throw new Error(fin.error.message);
    expect(fin.aggregate.session.startedAt.utc).toBe(earlier.utc);
    expect(setTimes(fin.aggregate)).toEqual(setTimes(a));
    expect(fin.aggregate.sets.map((x) => x.actual)).toEqual(a.sets.map((x) => x.actual));
    // Audited without an offset (only the start moved).
    const entry = fin.aggregate.timingAudit.find((e) => e.opId === 'finish-1' && e.field === 'startedAt');
    expect(entry?.shiftMs).toBeUndefined();
    // A retried Finish is a duplicate; nothing moves twice.
    expect(await s.workout.dispatch(sid, { ...cmd, at: h.now() })).toMatchObject({ ok: true, duplicate: true });
    // Only the start can't pass the first set (the 19 Oct rule, checked again by the write).
    const late = await s.workout.dispatch(sid, { type: 'update_session_timing', at: h.now(), opId: 'late', expectedVersion: fin.aggregate.session.version, startedAt: { utc: toIso(recorded + 10 * MIN), tz: TZ }, endedAt: null });
    expect(late.ok ? null : late.error.code).toBe('invalid_time');
  });

  it('Summary Edit times: Only the start keeps the sets; Undo puts the start back; a stale sheet is refused; the default still moves the whole workout', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const id = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2].map(() => ({ load: 80, reps: 8 })) }]);
    const before = (await s.workout.load(id))?.aggregate;
    const summary = await s.workout.summary(id);
    if (!before || !summary) throw new Error('load');
    const start = toMs(before.session.startedAt.utc);
    // The sheet's `Only the start` bounds from the Summary: not after the first set.
    const fixed = summaryTimeBounds(summary.timingBounds, summary.startedAtUtc, h.clockMs);
    expect(fixed.startMaxMs).toBe(Math.min(...before.sets.filter((x) => x.status === 'completed').map((x) => toMs(x.completedAt?.utc ?? ''))));
    const only = switchStartMove('start_only', { startMs: start - 30 * MIN, endMs: toMs(before.session.endedAt?.utc ?? '') - 30 * MIN }, { timeline: timelineOf(before), fixed, nowMs: h.clockMs });
    expect(only.endMs).toBe(toMs(before.session.endedAt?.utc ?? ''));
    const cmd = { type: 'update_session_timing' as const, at: h.now(), opId: 'only-1', expectedVersion: summary.sessionVersion, startedAt: { utc: toIso(only.startMs), tz: TZ }, endedAt: { utc: toIso(only.endMs), tz: TZ }, ...startMoveWrite('start_only', true) };
    const moved = await s.workout.dispatch(id, cmd);
    if (!moved.ok) throw new Error(moved.error.message);
    expect(moved.aggregate.session.startedAt.utc).toBe(toIso(start - 30 * MIN));
    expect(moved.aggregate.session.endedAt?.utc).toBe(before.session.endedAt?.utc);
    expect(setTimes(moved.aggregate)).toEqual(setTimes(before));
    expect(moved.aggregate.session.version).toBe(before.session.version + 1);
    // A stale sheet (opened before this edit) is refused (rule 5).
    const stale = await s.workout.dispatch(id, { ...cmd, opId: 'only-2' });
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');
    // One-tap Undo: the start alone goes back.
    const undo = timingUndoCommand(moved.aggregate, 'only-1', 'undo-only', h.now());
    expect(undo?.shift).toBeUndefined();
    if (!undo) throw new Error('undo');
    const undone = await s.workout.dispatch(id, undo);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.aggregate.session.startedAt.utc).toBe(before.session.startedAt.utc);
    expect(setTimes(undone.aggregate)).toEqual(setTimes(before));
    // The default (Move whole workout) still moves every set with it.
    const whole = await s.workout.dispatch(id, { type: 'update_session_timing', at: h.now(), opId: 'whole-1', expectedVersion: undone.aggregate.session.version, startedAt: { utc: toIso(start - 2 * HOUR), tz: TZ }, endedAt: null, ...startMoveWrite('whole', true) });
    if (!whole.ok) throw new Error(whole.error.message);
    expect(setTimes(whole.aggregate)).toEqual(setTimes(before).map((t) => toIso(toMs(t ?? '') - 2 * HOUR)));
    // After a relaunch the start is where it was saved.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.workout.load(id))?.aggregate.session.startedAt.utc).toBe(toIso(start - 2 * HOUR));
  });
});

describe('the sheets offer the choice (source check)', () => {
  const src = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'screens', 'workout', f), 'utf8');
  it('Finish and the Summary\u2019s Edit times pass `startMove` and write `shift` only for the whole workout; a past log always moves whole', () => {
    for (const f of ['FinishSheet.tsx', 'SummaryScreen.tsx']) {
      const text = src(f);
      expect(text, f).toMatch(/startMove=\{\{ mode: startMove, onMode: setStartMove, fixed: /);
      expect(text, f).toMatch(/startMoveWrite\(pastLog \? 'whole' : startMove, /);
      expect(text, f).not.toMatch(/shift: true as const/);
    }
    expect(src('WorkoutTimesRows.tsx')).toContain('START_MOVE_LABEL[m]');
  });
});
