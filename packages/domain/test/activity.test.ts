import { describe, expect, it } from 'vitest';

import { ActivitySchema, type Activity, type ActivityFields, type SplitBodyPart } from '@fizz/schemas';

import {
  activityDetail,
  activityRow,
  addActivity,
  avoidLegDays,
  consistency,
  deleteActivity,
  editActivity,
  isHardActivity,
  isLegDay,
  isLongActivity,
  legRunNear,
  localMidnightUtcMs,
  toIso,
  undoActivity,
  weekActivityLine,
} from '../src/index';
import { id } from './fixtures';

/**
 * Activities outside the gym (Ben, 20 Oct): long and hard runs, the run
 * rule for Up next (no legs the day before a planned long or hard run, or
 * the day after a done one, with a fallback), and versioned writes with Undo.
 * Today is Fri 23 Oct 2026 in London.
 */

const TZ = 'Europe/London';
const AT = { utc: '2026-10-23T08:00:00.000Z', tz: TZ };
const TODAY = '2026-10-23';
const OWNER = id(1);

const sp = (t: string): string => t.replaceAll('\u00a0', ' ');
const run = (over: Partial<ActivityFields> = {}): ActivityFields => ({ kind: 'run', status: 'done', date: TODAY, durationS: null, distanceM: null, effort: null, ...over });

function activity(n: number, fields: ActivityFields): Activity {
  const c = addActivity({ id: id(n), ownerId: OWNER, fields, source: 'ben', opId: `add-${String(n)}`, at: AT });
  if (c.kind !== 'write') throw new Error(c.kind);
  return ActivitySchema.parse(c.next);
}

describe('long and hard (Ben, 20 Oct)', () => {
  it('a long effort, or a run of ≥ 90 min or ≥ 15 km, is long; hard is hard', () => {
    expect(isLongActivity(run({ effort: 'long' }))).toBe(true);
    expect(isLongActivity(run({ distanceM: 15_000 }))).toBe(true);
    expect(isLongActivity(run({ distanceM: 14_999 }))).toBe(false);
    expect(isLongActivity(run({ durationS: 90 * 60 }))).toBe(true);
    expect(isLongActivity(run({ durationS: 89 * 60 }))).toBe(false);
    // The thresholds are for runs: a 2-hour ride is long only when Ben says so.
    expect(isLongActivity(run({ kind: 'ride', durationS: 2 * 3600 }))).toBe(false);
    expect(isLongActivity(run({ kind: 'ride', effort: 'long' }))).toBe(true);
    expect(isHardActivity(run({ effort: 'hard' }))).toBe(true);
    expect(isHardActivity(run({ effort: 'moderate', distanceM: 20_000 }))).toBe(false);
  });

  it('text: only what was logged', () => {
    expect(sp(activityDetail(run({ distanceM: 18_000, durationS: 95 * 60, effort: 'long' })))).toBe('18 km · 1 h 35 min · long');
    expect(sp(activityDetail(run({ durationS: 45 * 60 })))).toBe('45 min');
    expect(weekActivityLine(activity(2, run({ date: '2026-10-24', status: 'planned', effort: 'long' })))).toBe('Run · Sat · long');
    const row = activityRow(activity(3, run({ date: '2026-10-22', distanceM: 18_000 })), TODAY);
    expect({ ...row, detail: sp(row.detail) }).toMatchObject({ title: 'Run', when: 'Yesterday', detail: '18 km', planned: false });
    expect(activityRow(activity(4, run({ date: '2026-10-24', status: 'planned', effort: 'long' })), TODAY)).toMatchObject({ when: 'Tomorrow', detail: 'Planned · long', planned: true });
  });
});

describe('the run rule for Up next', () => {
  const LEGS = { name: 'Legs', parts: ['Quads', 'Hamstrings', 'Glutes'] as SplitBodyPart[] };
  const PUSH = { name: 'Push', parts: ['Chest', 'Shoulders', 'Triceps'] as SplitBodyPart[] };
  const PULL = { name: 'Pull', parts: ['Back', 'Biceps'] as SplitBodyPart[] };
  const parts = (d: { parts: SplitBodyPart[] }) => d.parts;

  it('the day before a planned long or hard run, and the day after a done one', () => {
    const plannedSat = activity(5, run({ date: '2026-10-24', status: 'planned', effort: 'long' }));
    expect(legRunNear([plannedSat], TODAY)).toMatchObject({ when: 'before', why: 'Long run tomorrow' });
    // Thursday (two days before): no.
    expect(legRunNear([plannedSat], '2026-10-22')).toBeNull();
    // Saturday itself and Sunday while it is still only planned: no (nothing assumed).
    expect(legRunNear([plannedSat], '2026-10-25')).toBeNull();
    const doneThu = activity(6, run({ date: '2026-10-22', distanceM: 18_000 }));
    expect(legRunNear([doneThu], TODAY)).toMatchObject({ when: 'after', why: 'Long run yesterday' });
    const hardThu = activity(7, run({ date: '2026-10-22', effort: 'hard', durationS: 40 * 60 }));
    expect(legRunNear([hardThu], TODAY)).toMatchObject({ why: 'Hard run yesterday' });
    // An easy run, a long ride, a deleted run, or a planned run yesterday that wasn't marked done: no.
    expect(legRunNear([activity(8, run({ date: '2026-10-22', effort: 'easy', distanceM: 5_000 }))], TODAY)).toBeNull();
    expect(legRunNear([activity(9, run({ kind: 'ride', date: '2026-10-22', effort: 'hard' }))], TODAY)).toBeNull();
    const deleted = deleteActivity(doneThu, { expectedVersion: 1, opId: 'del', at: AT });
    expect(deleted.kind === 'write' && legRunNear([deleted.next], TODAY)).toBeNull();
    expect(legRunNear([activity(10, run({ date: '2026-10-22', status: 'planned', effort: 'long' }))], TODAY)).toBeNull();
  });

  it('leg days go after the others; with only leg days left, legs anyway (the Why? names the run)', () => {
    const near = legRunNear([activity(11, run({ date: '2026-10-24', status: 'planned', effort: 'long' }))], TODAY);
    expect(avoidLegDays([LEGS, PUSH, PULL], parts, near)).toEqual({ order: [PUSH, PULL, LEGS], legsAnyway: false });
    expect(avoidLegDays([LEGS, PUSH, PULL], parts, null)).toEqual({ order: [LEGS, PUSH, PULL], legsAnyway: false });
    expect(avoidLegDays([LEGS], parts, near)).toEqual({ order: [LEGS], legsAnyway: true });
    // A full-body day (any leg part) counts as legs.
    expect(isLegDay(['Chest', 'Back', 'Quads'])).toBe(true);
    expect(isLegDay(['Core'])).toBe(false);
  });
});

describe('runs never count as gym days', () => {
  it('the weekly aim counts finished workouts only', () => {
    const nowMs = localMidnightUtcMs(TODAY, TZ) + 10 * 3_600_000;
    // Two workouts this week; Ben also ran three times (activities are never workouts).
    const workouts = [
      { sessionId: id(20), routineId: null, startedAtUtc: toIso(localMidnightUtcMs('2026-10-19', TZ) + 18 * 3_600_000) },
      { sessionId: id(21), routineId: null, startedAtUtc: toIso(localMidnightUtcMs('2026-10-21', TZ) + 18 * 3_600_000) },
    ];
    const v = consistency({ workouts, aim: 4, plan: null, nowMs, tz: TZ });
    expect(v.thisWeek.text).toBe('2/4');
  });
});

describe('writes: versioned, idempotent, Undo', () => {
  it('add, edit, delete and each Undo; stale and duplicate change nothing', () => {
    const a = activity(30, run({ date: '2026-10-24', status: 'planned', effort: 'long' }));
    expect(a.version).toBe(1);
    const e = editActivity(a, { expectedVersion: 1, opId: 'edit-1', at: AT, fields: run({ date: '2026-10-25', status: 'planned', effort: 'long' }) });
    if (e.kind !== 'write') throw new Error(e.kind);
    expect(e.next.fields.date).toBe('2026-10-25');
    // The same op again: a duplicate; an old version: stale.
    expect(editActivity(e.next, { expectedVersion: 1, opId: 'edit-1', at: AT, fields: run() }).kind).toBe('duplicate');
    expect(editActivity(e.next, { expectedVersion: 1, opId: 'edit-2', at: AT, fields: run() }).kind).toBe('stale');
    // Undo of the edit puts the old date back; a second Undo is stale.
    const u = undoActivity(e.next, { opId: 'undo-1', at: AT, targetOpId: 'edit-1' });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.fields.date).toBe('2026-10-24');
    expect(undoActivity(u.next, { opId: 'undo-2', at: AT, targetOpId: 'edit-1' }).kind).toBe('stale');
    // Delete and its Undo.
    const d = deleteActivity(u.next, { expectedVersion: u.next.version, opId: 'del-1', at: AT });
    if (d.kind !== 'write') throw new Error(d.kind);
    expect(d.next.deletedAtUtc).not.toBeNull();
    expect(editActivity(d.next, { expectedVersion: d.next.version, opId: 'edit-3', at: AT, fields: run() }).kind).toBe('stale');
    const back = undoActivity(d.next, { opId: 'undo-3', at: AT, targetOpId: 'del-1' });
    expect(back.kind === 'write' && back.next.deletedAtUtc).toBeNull();
    // Undo of the add deletes it.
    const fresh = activity(31, run({ distanceM: 5_000 }));
    const undoAdd = undoActivity(fresh, { opId: 'undo-add', at: AT, targetOpId: 'add-31' });
    expect(undoAdd.kind === 'write' && undoAdd.next.deletedAtUtc).toBe(AT.utc);
  });

  it('an activity needs a time, a distance or an effort', () => {
    const c = addActivity({ id: id(40), ownerId: OWNER, fields: run(), source: 'ben', opId: 'x', at: AT });
    expect(c.kind).toBe('invalid');
  });
});

describe('Today’s Recent with activities', () => {
  it('activities are their own rows, newest first; a planned one ahead on top; the limit holds', async () => {
    const { recentRows } = await import('../src/index');
    const now = { utc: '2026-10-23T08:00:00.000Z', tz: TZ };
    const w = (n: number, utc: string) => ({ sessionId: id(n), title: `W${String(n)}`, startedAtUtc: utc, tz: TZ, localDate: null, sets: 10 });
    const a = (n: number, date: string) => ({ ...activityRow(activity(n, run({ date, distanceM: 10_000, status: date > TODAY ? 'planned' : 'done' })), TODAY), sortMs: localMidnightUtcMs(date, TZ) + 12 * 3_600_000 });
    const rows = recentRows([w(50, '2026-10-22T17:00:00.000Z'), w(51, '2026-10-20T17:00:00.000Z')], [a(52, '2026-10-24'), a(53, '2026-10-21')], now, 3);
    expect(rows.map((r) => (r.kind === 'workout' ? r.row.title : `${r.row.title} ${r.row.when}`))).toEqual(['Run Tomorrow', 'W50', 'Run Wed']);
  });
});
