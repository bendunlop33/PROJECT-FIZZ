import { afterEach, describe, expect, it } from 'vitest';

import { purgeAfterUtc } from '@fizz/domain';

import { deletedToastText, goneOnText, keepSelection, pastRowTitle, recentlyDeletedDataRow, recentlyDeletedFooter, selectAllLabel, selectTitle, toggleAll } from '../src/history/delete-view';
import { stateLine, undoAlert } from '../src/import/views';
import type { PastImport } from '../src/import/import-service';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * Deleting past workouts through the app services on real SQLite files
 * (delete-workouts.md): Past workouts and Up next, Undo, Recently
 * deleted, the coach's context, exports, counts, and the launch purge
 * across a force-close.
 */

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;

async function twoWorkouts() {
  h = createHarness('2026-10-06T17:00:00.000Z');
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] }]);
  return { s, gymId, first, second };
}

describe('delete one workout from Past workouts / Summary (DW1, DW2, DW9, DW11, DW18)', () => {
  it('leaves Past workouts, Up next, the week, counts, the lift highlight and the export; Undo puts every one back', async () => {
    const { s, gymId, first, second } = await twoWorkouts();
    const before = {
      rows: (await s.repeat.candidates()).rows.map((r) => r.sessionId),
      next: (await s.next.preview(gymId))?.sourceSessionId ?? null,
      week: (await s.today.view())?.week.count,
      counts: (await s.yourData.counts()).finishedWorkouts,
      lift: (await s.today.liftHighlight())?.text ?? null,
    };
    expect(before).toMatchObject({ rows: [second, first], next: second, counts: 2 });
    const row = (await s.repeat.candidates()).rows[0];
    if (!row) throw new Error('no row');

    const out = await s.history.deleteWorkouts([{ sessionId: row.sessionId, expectedVersion: row.version }], 'del-1', { from: 'opened' });
    if (!out.ok) throw new Error(out.message);
    // A retry with the same op ID is the same result and writes nothing (DW7).
    expect(await s.history.deleteWorkouts([{ sessionId: row.sessionId, expectedVersion: row.version }], 'del-1')).toMatchObject({ ok: true, duplicate: true, refs: out.refs });

    expect((await s.repeat.candidates()).rows.map((r) => r.sessionId)).toEqual([first]);
    // Up next comes from the previous workout; "Last" values with it (DW11).
    expect((await s.next.preview(gymId))?.sourceSessionId).toBe(first);
    expect((await s.today.view())?.week.count).toBe((before.week ?? 0) - 1);
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect((await s.today.liftHighlight())?.text).not.toBe(before.lift);
    // Export `My data` leaves it out (DW18); Data & backup shows it on its own row.
    expect((await s.data.buildExport('your_data')).text).not.toContain(second);
    expect(recentlyDeletedDataRow(await s.history.recentlyDeletedCount())).toEqual({ title: 'Recently deleted', value: '1', opens: true });
    // Recently deleted lists it with its Gone on date (DW20).
    const listed = await s.history.recentlyDeleted();
    expect(listed.rows.map((r) => r.sessionId)).toEqual([second]);
    expect(goneOnText(listed.rows[0]?.goneOn ?? '')).toBe('Gone on 7 Nov');
    expect(await s.history.presence(second)).toMatchObject({ kind: 'deleted', goneOn: '2026-11-07' });

    // The toast's Undo restores exactly that op's workouts (DW9).
    const undo = await s.history.restoreWorkouts(out.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })), 'undo-1');
    expect(undo.ok).toBe(true);
    expect({
      rows: (await s.repeat.candidates()).rows.map((r) => r.sessionId),
      next: (await s.next.preview(gymId))?.sourceSessionId ?? null,
      week: (await s.today.view())?.week.count,
      counts: (await s.yourData.counts()).finishedWorkouts,
      lift: (await s.today.liftHighlight())?.text ?? null,
    }).toEqual(before);
    expect(await s.history.presence(second)).toEqual({ kind: 'live' });
    expect(await s.history.recentlyDeletedCount()).toBe(0);
  });

  it('several at once: one confirm view, all-or-nothing; a workout changed since it was selected refuses the lot (DW4, DW8)', async () => {
    const { s, first, second } = await twoWorkouts();
    const rows = (await s.repeat.candidates()).rows;
    expect(s.history.confirmView(rows)).toMatchObject({ title: 'Delete 2 workouts?', range: 'Tue 6 Oct – Thu 8 Oct', importedLine: null, confirmLabel: 'Delete 2 workouts' });
    // `first` is renamed from another screen after the list loaded.
    const firstRow = rows.find((r) => r.sessionId === first);
    if (!firstRow) throw new Error('no row');
    const renamed = await s.workout.dispatch(first, { type: 'rename_session', at: h.now(), opId: 'rn-1', expectedVersion: firstRow.version, name: 'Test' });
    expect(renamed.ok).toBe(true);
    const stale = await s.history.deleteWorkouts(
      rows.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })),
      'del-both',
    );
    expect(stale).toEqual({ ok: false, kind: 'stale', message: 'Changed since you selected. Check and try again.', sessionIds: [first] });
    expect((await s.repeat.candidates()).rows).toHaveLength(2);
    // The selection keeps what is still listed; the fresh rows delete fine.
    const fresh = (await s.repeat.candidates()).rows;
    expect([...keepSelection(new Set([first, second, 'gone']), fresh)].sort()).toEqual([first, second].sort());
    const ok = await s.history.deleteWorkouts(
      fresh.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })),
      'del-both-2',
    );
    expect(ok.ok).toBe(true);
    expect(deletedToastText(fresh, TZ)).toBe('2 workouts deleted');
    expect((await s.repeat.candidates()).rows).toEqual([]);
  });

  it('a deleted workout is out of the coach’s context; reopening it is read-only (DW16, §3.2)', async () => {
    const { s, second } = await twoWorkouts();
    const seen = await s.coach.describe({ kind: 'summary', sessionId: second }, null);
    expect(seen.yourData.map((d) => d.label)).toContain('This workout');
    const row = (await s.repeat.candidates()).rows[0];
    if (!row) throw new Error('no row');
    expect((await s.history.deleteWorkouts([{ sessionId: row.sessionId, expectedVersion: row.version }], 'del-c')).ok).toBe(true);
    const after = await s.coach.describe({ kind: 'summary', sessionId: second }, null);
    expect(after.yourData.map((d) => d.label)).not.toContain('This workout');
    // A deleted workout takes no correction.
    const r = await s.workout.dispatch(second, { type: 'rename_session', at: h.now(), opId: 'rn-x', expectedVersion: row.version + 1, name: 'X' });
    expect(r).toMatchObject({ ok: false });
  });
});

describe('the purge at launch (§6.4, DW21, DW22)', () => {
  it('past 30 days it is no longer listed; the next launch purges it silently, but never while a workout is unfinished', async () => {
    const { s, gymId, second } = await twoWorkouts();
    const row = (await s.repeat.candidates()).rows[0];
    if (!row) throw new Error('no row');
    const deletedAt = h.now();
    expect((await s.history.deleteWorkouts([{ sessionId: row.sessionId, expectedVersion: row.version }], 'del-p')).ok).toBe(true);
    // A workout in progress when day 31 comes.
    const started = await s.workout.start({ gymId, opId: 'start-open', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(started.ok).toBe(true);
    await h.forceClose();

    h.clockMs = Date.parse(purgeAfterUtc(deletedAt)) + 60_000;
    const relaunched = await h.launch();
    await h.settle(relaunched.services);
    // Not listed or restorable, but not purged while the workout is unfinished.
    expect(await relaunched.services.history.recentlyDeletedCount()).toBe(0);
    expect(await relaunched.services.history.presence(second)).toEqual({ kind: 'gone' });
    expect(await relaunched.services.history.purgeDue()).toBe(0);
    expect(await relaunched.services.repeat.describeById(second)).not.toBeNull();
    expect(await relaunched.services.history.restoreWorkouts([{ sessionId: second, expectedVersion: row.version + 1 }], 'too-late')).toMatchObject({ ok: false, kind: 'stale', message: 'No longer available.' });

    // Discard the open workout; the next launch purges.
    const active = await relaunched.services.sessions.active();
    if (!active) throw new Error('no active');
    await relaunched.services.sessions.discard(active.session.id, { required: false, loggedSets: 0, expectedVersion: active.session.version }, 'discard-1');
    await h.forceClose();
    const third = await h.launch();
    await h.settle(third.services);
    // The purge runs after the launch's backup check, in the background.
    for (let i = 0; i < 100 && (await third.services.repeat.describeById(second)) !== null; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(await third.services.repeat.describeById(second)).toBeNull();
    expect(await third.services.history.presence(second)).toEqual({ kind: 'gone' });
  });
});

describe('copy and select-mode rules (§2.3, §7)', () => {
  it('titles, footers and toggles', () => {
    const rows = [{ sessionId: 'a' }, { sessionId: 'b' }];
    expect(selectTitle(0)).toBe('Select workouts');
    expect(selectTitle(3)).toBe('3 selected');
    expect(selectAllLabel(new Set(), rows)).toBe('Select all');
    expect(selectAllLabel(new Set(['a', 'b']), rows)).toBe('Deselect all');
    expect([...toggleAll(new Set(['a']), rows)]).toEqual(['a', 'b']);
    expect([...toggleAll(new Set(['a', 'b']), rows)]).toEqual([]);
    expect(recentlyDeletedFooter(0)).toBeNull();
    expect(recentlyDeletedFooter(3)).toBe('Recently deleted (3)');
    expect(recentlyDeletedDataRow(0)).toEqual({ title: 'Recently deleted', value: 'None', opens: false });
    const row = { sessionId: 'x', version: 3, title: 'Push A', startedAtUtc: '2026-10-08T17:00:00.000Z', tz: TZ, localDate: null, source: 'manual' as const, gymName: 'Main Gym', sets: 16 };
    expect(pastRowTitle(row, TZ)).toBe('Thu 8 Oct · Push A');
    expect(deletedToastText([row], TZ)).toBe('Push A · Thu 8 Oct deleted');
    expect(pastRowTitle({ ...row, localDate: '2024-05-02', source: 'import', title: 'FitNotes' }, TZ)).toBe('Thu 2 May 2024 · FitNotes');
  });
});

describe('imports (§6.2, DW25)', () => {
  it('an import with workouts in Recently deleted reads `· 3 deleted`, and its Undo alert says so', () => {
    const p = { job: { fileName: 'FitNotes.csv' }, written: 412, total: 412, state: 'finished', deleted: 3 } as unknown as PastImport;
    expect(stateLine(p).text).toBe('Finished · 412 workouts · 3 deleted');
    expect(undoAlert(p).message.endsWith('\nIncludes 3 in Recently deleted.')).toBe(true);
    expect(undoAlert({ ...p, deleted: 0 }).message).not.toContain('Recently deleted');
  });
});
