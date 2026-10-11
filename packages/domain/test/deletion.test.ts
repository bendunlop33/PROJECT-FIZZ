import { describe, expect, it } from 'vitest';
import type { SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import {
  buildDeleteConfirmView,
  buildLiftHighlight,
  calculateNextTargets,
  goneOnDate,
  isInHistory,
  isPurgeDue,
  isRestorable,
  pastExercisesOf,
  planDeleteWorkouts,
  planRestoreWorkouts,
  purgeAfterUtc,
  recentPaceSamples,
  reduceSession,
  toHistorySessions,
  toMs,
  type DeletionPlan,
} from '../src/index';
import { barbell, doubleProgression, OWNER } from './fixtures';
import { HISTORY_EXERCISES, largeHistory } from './large-history';

/** delete-workouts.md: the pure transitions, the confirm sheet and the history predicate. */

const LONDON = 'Europe/London';
const z = (utc: string, tz = LONDON): ZonedTimestamp => ({ utc, tz });
const DELETED_AT = z('2026-10-09T07:12:00.000Z');

const history = (): SessionAggregate[] => largeHistory({ weeks: 2, perWeek: 3 });
const byId = (list: readonly SessionAggregate[]) => new Map(list.map((a) => [a.session.id, a]));
const ok = (p: DeletionPlan) => {
  if (!p.ok) throw new Error(JSON.stringify(p.error));
  return p;
};

function deleteOne(a: SessionAggregate, opId = 'del-1', at = DELETED_AT): SessionAggregate {
  const p = ok(planDeleteWorkouts(byId([a]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version }], opId, at }));
  const w = p.writes[0];
  if (!w) throw new Error('nothing written');
  return w.aggregate;
}

describe('the 30-day clock (§6.4)', () => {
  it('is restorable until the end of the local day 30 days after deleting, across a clock change', () => {
    // 9 Oct (BST) + 30 days = 8 Nov (GMT): restorable through 23:59:59 on 8 Nov in London.
    expect(purgeAfterUtc(DELETED_AT)).toBe('2026-11-09T00:00:00.000Z');
    expect(goneOnDate(purgeAfterUtc(DELETED_AT), LONDON)).toBe('2026-11-08');
    // Late in the evening in Auckland is already the next day there.
    const auckland = z('2026-10-09T11:30:00.000Z', 'Pacific/Auckland');
    expect(goneOnDate(purgeAfterUtc(auckland), 'Pacific/Auckland')).toBe('2026-11-09');
  });

  it('a deleted workout is listed and restorable before the end, purge-due after it (DW21)', () => {
    const deleted = deleteOne(history()[0] as SessionAggregate);
    const end = toMs(purgeAfterUtc(DELETED_AT));
    expect(isRestorable(deleted.session, end - 1)).toBe(true);
    expect(isPurgeDue(deleted.session, end - 1)).toBe(false);
    expect(isRestorable(deleted.session, end)).toBe(false);
    expect(isPurgeDue(deleted.session, end)).toBe(true);
  });
});

describe('deleteWorkouts / restoreWorkouts (DW6–DW9)', () => {
  it('changes only the status and the deletion record, bumps version and revision, and records the operation (DW6)', () => {
    const a = history()[2] as SessionAggregate;
    const d = deleteOne(a);
    expect(d.session.status).toBe('deleted');
    expect(d.session.deletion).toEqual({ at: DELETED_AT, opId: 'del-1', purgeAfterUtc: '2026-11-09T00:00:00.000Z' });
    expect(d.session.version).toBe(a.session.version + 1);
    expect(d.revision).toBe(a.revision + 1);
    expect(d.sets).toEqual(a.sets);
    expect(d.exercises).toEqual(a.exercises);
    expect(d.audit).toEqual(a.audit);
    expect(d.processedOps['del-1']).toMatchObject({ commandType: 'delete_workout', atUtc: DELETED_AT.utc });
    expect({ ...d.session, status: a.session.status, version: a.session.version, deletion: undefined }).toEqual({ ...a.session, deletion: undefined });
  });

  it('the same operation again is a duplicate and writes nothing (DW7); a different selection under that ID is refused', () => {
    const [a, b] = history();
    if (!a || !b) throw new Error('fixture');
    const items = [{ sessionId: a.session.id, expectedVersion: a.session.version }, { sessionId: b.session.id, expectedVersion: b.session.version }];
    const first = ok(planDeleteWorkouts(byId([a, b]), { ownerId: OWNER, items, opId: 'del-2', at: DELETED_AT }));
    const after = byId(first.writes.map((w) => w.aggregate));
    const again = ok(planDeleteWorkouts(after, { ownerId: OWNER, items, opId: 'del-2', at: DELETED_AT }));
    expect(again).toMatchObject({ duplicate: true, writes: [] });
    expect(again.refs).toEqual(first.refs);
    expect(planDeleteWorkouts(after, { ownerId: OWNER, items: items.slice(0, 1), opId: 'del-2', at: DELETED_AT })).toEqual({ ok: false, error: { code: 'operation_id_reused' } });
  });

  it('is all-or-nothing: one changed workout refuses the lot (DW8); deleted, active, discarded and other owners are stale', () => {
    const [a, b] = history();
    if (!a || !b) throw new Error('fixture');
    const items = [{ sessionId: a.session.id, expectedVersion: a.session.version }, { sessionId: b.session.id, expectedVersion: b.session.version - 1 }];
    expect(planDeleteWorkouts(byId([a, b]), { ownerId: OWNER, items, opId: 'del-3', at: DELETED_AT })).toEqual({ ok: false, error: { code: 'stale', sessionIds: [b.session.id] } });

    const deleted = deleteOne(a);
    expect(planDeleteWorkouts(byId([deleted]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: deleted.session.version }], opId: 'del-4', at: DELETED_AT })).toMatchObject({
      ok: false,
      error: { code: 'stale' },
    });
    for (const status of ['active', 'discarded', 'reverted'] as const) {
      const other = { ...b, session: { ...b.session, status } };
      expect(planDeleteWorkouts(byId([other]), { ownerId: OWNER, items: [{ sessionId: b.session.id, expectedVersion: b.session.version }], opId: `del-${status}`, at: DELETED_AT })).toMatchObject({
        ok: false,
        error: { code: 'stale' },
      });
    }
    expect(planDeleteWorkouts(byId([b]), { ownerId: 'someone-else', items: [{ sessionId: b.session.id, expectedVersion: b.session.version }], opId: 'del-5', at: DELETED_AT })).toMatchObject({
      ok: false,
      error: { code: 'stale' },
    });
    expect(planDeleteWorkouts(new Map(), { ownerId: OWNER, items: [], opId: 'del-6', at: DELETED_AT })).toEqual({ ok: false, error: { code: 'empty' } });
  });

  it('Restore (and the toast Undo) puts it back with the same values and version + 1; past 30 days it is stale (DW9, DW21)', () => {
    const a = history()[1] as SessionAggregate;
    const d = deleteOne(a);
    const later = z('2026-10-20T08:00:00.000Z');
    const r = ok(planRestoreWorkouts(byId([d]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: d.session.version }], opId: 'res-1', at: later }));
    const back = r.writes[0]?.aggregate as SessionAggregate;
    expect(back.session.status).toBe('finished');
    expect(back.session.deletion).toBeUndefined();
    expect(back.session.version).toBe(a.session.version + 2);
    expect(back.sets).toEqual(a.sets);
    expect(Object.keys(back.processedOps)).toEqual(expect.arrayContaining(['del-1', 'res-1']));
    expect(isInHistory(back.session)).toBe(true);
    // A stale version, or a workout that isn't deleted, is refused.
    expect(planRestoreWorkouts(byId([d]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version }], opId: 'res-2', at: later })).toMatchObject({ ok: false, error: { code: 'stale' } });
    expect(planRestoreWorkouts(byId([a]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version }], opId: 'res-3', at: later })).toMatchObject({ ok: false, error: { code: 'stale' } });
    // Day 31: no longer restorable, even though the purge hasn't run.
    const day31 = z('2026-11-09T00:00:00.000Z');
    expect(planRestoreWorkouts(byId([d]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: d.session.version }], opId: 'res-4', at: day31 })).toMatchObject({ ok: false, error: { code: 'stale' } });
    // Undo of a restore deletes it again with the clock reset to then.
    const again = deleteOne(back, 'del-again', later);
    expect(again.session.deletion?.purgeAfterUtc).toBe(purgeAfterUtc(later));
  });

  it('a late retry after a later operation changed the workout is stale, never `ok` with the newer state (review r2 N5)', () => {
    const a = history()[1] as SessionAggregate;
    const d = deleteOne(a, 'del-x');
    const req = { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: a.session.version }], opId: 'del-x', at: DELETED_AT };
    // An immediate retry is still a duplicate.
    expect(planDeleteWorkouts(byId([d]), req)).toMatchObject({ ok: true, duplicate: true });
    // Restored since: the retry of the delete says it changed.
    const later = z('2026-10-10T08:00:00.000Z');
    const back = ok(planRestoreWorkouts(byId([d]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: d.session.version }], opId: 'res-x', at: later })).writes[0]?.aggregate as SessionAggregate;
    expect(planDeleteWorkouts(byId([back]), req)).toEqual({ ok: false, error: { code: 'stale', sessionIds: [a.session.id] } });
    // Deleted again by another operation: still not this one's outcome.
    const again = deleteOne(back, 'del-y', z('2026-10-11T08:00:00.000Z'));
    expect(planDeleteWorkouts(byId([again]), req)).toMatchObject({ ok: false, error: { code: 'stale' } });
    // A restore retried after a later delete is stale too.
    expect(planRestoreWorkouts(byId([again]), { ownerId: OWNER, items: [{ sessionId: a.session.id, expectedVersion: d.session.version }], opId: 'res-x', at: later })).toMatchObject({ ok: false, error: { code: 'stale' } });
  });

  it('a deleted workout accepts no command (corrections, timing, rename)', () => {
    const d = deleteOne(history()[0] as SessionAggregate);
    const set = d.sets.find((s) => s.status === 'completed');
    const res = reduceSession(d, { type: 'rename_session', at: DELETED_AT, opId: 'rn-1', expectedVersion: d.session.version, name: 'X' } as never);
    expect(res).toMatchObject({ ok: false, error: { code: 'session_finished', message: 'This workout was deleted.' } });
    const fix = reduceSession(d, { type: 'correct_set', at: DELETED_AT, opId: 'fx-1', setId: set?.id ?? '', expectedSetVersion: set?.version ?? 1, patch: { reps: 1 } });
    expect(fix.ok).toBe(false);
  });
});

describe('derived views leave a deleted workout out (§5)', () => {
  const BENCH = HISTORY_EXERCISES[0]?.id ?? '';

  it('isInHistory admits only finished workouts', () => {
    expect(['active', 'finished', 'discarded', 'reverted', 'deleted'].map((status) => isInHistory({ status: status as never }))).toEqual([false, true, false, false, false]);
  });

  it('built-in next-time targets after deleting equal targets from a history that never had it, for each workout (DW12)', () => {
    const all = history();
    const targets = (list: readonly SessionAggregate[]) =>
      calculateNextTargets({
        exerciseName: 'Bench press',
        measurement: 'reps',
        history: list.flatMap((a) => toHistorySessions(a, BENCH)).sort((x, y) => toMs(y.performedAtUtc) - toMs(x.performedAtUtc)),
        rule: doubleProgression(),
        equipment: barbell(),
        unit: 'kg',
        convention: 'total',
        pain: { active: false, reportedAtUtc: null },
      });
    for (const [i, gone] of all.entries()) {
      const withDeleted = all.map((a, j) => (j === i ? deleteOne(a, `del-${String(i)}`) : a));
      const never = all.filter((_, j) => j !== i);
      expect(targets(withDeleted)).toEqual(targets(never));
      expect(withDeleted.flatMap((a) => toHistorySessions(a, BENCH)).map((h) => h.sessionId)).not.toContain(gone.session.id);
    }
  });

  it('"Last" values, the lift highlight and the pace samples skip it (DW10, DW11)', () => {
    const all = history();
    const latest = all.at(-1) as SessionAggregate;
    const withDeleted = [...all.slice(0, -1), deleteOne(latest)];
    const never = all.slice(0, -1);
    expect(pastExercisesOf(withDeleted, BENCH)).toEqual(pastExercisesOf(never, BENCH));
    expect(buildLiftHighlight(withDeleted)).toEqual(buildLiftHighlight(never));
    expect(recentPaceSamples(withDeleted)).toEqual(recentPaceSamples(never));
  });
});

describe('buildDeleteConfirmView (§2.4, DW4)', () => {
  it('names the count, the first and last dates and how many are imported', () => {
    const v = buildDeleteConfirmView([
      { startedAt: z('2026-10-08T17:00:00.000Z'), source: 'manual' },
      { startedAt: z('2026-10-05T23:30:00.000Z'), source: 'manual' },
      { startedAt: z('2026-10-01T12:00:00.000Z'), localDate: '2026-09-28', source: 'import' },
    ]);
    // 23:30 UTC on 5 Oct is 00:30 on 6 Oct in London.
    expect(v).toMatchObject({ count: 3, firstDate: '2026-09-28', lastDate: '2026-10-08', importedCount: 1, title: 'Delete 3 workouts?', range: 'Mon 28 Sep – Thu 8 Oct', importedLine: '1 imported', confirmLabel: 'Delete 3 workouts' });
  });

  it('one day shows the date alone; a range across years shows the years; nothing selected is null', () => {
    expect(buildDeleteConfirmView([{ startedAt: z('2026-10-05T08:00:00.000Z'), source: 'manual' }, { startedAt: z('2026-10-05T18:00:00.000Z'), source: 'manual' }])).toMatchObject({
      range: 'Mon 5 Oct',
      importedLine: null,
    });
    expect(buildDeleteConfirmView([{ startedAt: z('2025-12-28T10:00:00.000Z'), source: 'manual' }, { startedAt: z('2026-01-03T10:00:00.000Z'), source: 'manual' }])?.range).toBe('28 Dec 2025 – 3 Jan 2026');
    expect(buildDeleteConfirmView([{ startedAt: z('2026-10-05T08:00:00.000Z'), source: 'manual' }])?.title).toBe('Delete 1 workout?');
    expect(buildDeleteConfirmView([])).toBeNull();
  });
});
