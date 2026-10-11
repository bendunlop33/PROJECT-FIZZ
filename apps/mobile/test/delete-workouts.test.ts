import { afterEach, describe, expect, it } from 'vitest';

import { purgeAfterUtc } from '@fizz/domain';

import { deletedToastText, goneOnText, keepSelection, pastRowTitle, recentlyDeletedDataRow, recentlyDeletedFooter, selectAllLabel, selectTitle, toggleAll } from '../src/history/delete-view';
import { buildCheckResultView, buildRestorePreviewView } from '../src/backup/restore-view';
import { IntentOps } from '../src/history/intent-ops';
import { openErrorView, previewView, stateLine, undoAlert } from '../src/import/views';
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

describe('imports: Select in the import’s list, re-import, undone and purged dates (DW24, DW26; review S5, N4)', () => {
  const A1 = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
  const FILE = [A1, '2026-09-01,Lat Pulldown,Back,45.0,10,,,', '2026-09-03,Lat Pulldown,Back,47.5,8,,,'].join('\n');
  const MORE = [FILE, '2026-09-20,Lat Pulldown,Back,50.0,10,,,'].join('\n');

  async function imported() {
    h = createHarness('2026-10-06T17:00:00.000Z');
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const opened = await s.imports.open({ name: 'FitNotes.csv', text: FILE });
    if (opened.kind !== 'preview') throw new Error(opened.kind);
    expect(opened.draft.inRecentlyDeleted).toBe(0);
    const r = await s.imports.commit(opened.draft.draftId, opened.draft.mappingVersion, 'import-1');
    if (!r.ok) throw new Error(r.reason);
    return { s, jobId: r.jobId };
  }

  it('lists the import’s workouts for Select; deleting one leaves the list; a re-import counts it as in Recently deleted', async () => {
    const { s, jobId } = await imported();
    const listed = await s.history.importWorkouts(jobId);
    expect(listed.rows.map((r) => r.localDate)).toEqual(['2026-09-01', '2026-09-03']);
    expect(s.history.confirmView(listed.rows)).toMatchObject({ title: 'Delete 2 workouts?', importedLine: '2 imported' });
    const [first] = listed.rows;
    if (!first) throw new Error('no row');
    expect((await s.history.deleteWorkouts([{ sessionId: first.sessionId, expectedVersion: first.version }], 'del-imp')).ok).toBe(true);
    expect((await s.history.importWorkouts(jobId)).rows.map((r) => r.localDate)).toEqual(['2026-09-03']);

    // The same file: nothing new, and it says one is in Recently deleted.
    const same = await s.imports.open({ name: 'FitNotes.csv', text: FILE });
    expect(same).toMatchObject({ kind: 'same_file', inRecentlyDeleted: 1 });
    expect(openErrorView(same)?.text.endsWith(' 1 is in Recently deleted.')).toBe(true);
    // A newer export: only the new date comes in; the preview line says why the deleted one doesn't.
    const more = await s.imports.open({ name: 'FitNotes-2.csv', text: MORE });
    if (more.kind !== 'preview') throw new Error(more.kind);
    expect(more.draft.inRecentlyDeleted).toBe(1);
    expect(more.draft.analysis.counts.workouts).toBe(1);
    expect(previewView(more.draft).recentlyDeletedRow).toBe('1 is in Recently deleted.');
    s.imports.discard(more.draft.draftId);
  });

  it('after Undo this import, a date view is neither live nor deletable (S5); after a purge it says the workout was deleted (N4)', async () => {
    const { s, jobId } = await imported();
    const rows = (await s.history.importWorkouts(jobId)).rows;
    const [first, second] = rows;
    if (!first || !second) throw new Error('rows');
    // Purge the first.
    expect((await s.history.deleteWorkouts([{ sessionId: first.sessionId, expectedVersion: first.version }], 'del-1')).ok).toBe(true);
    expect(await s.history.deleteNow([first.sessionId], 'now-1')).toEqual({ ok: true, purged: 1 });
    expect(await s.history.importDatePurged(jobId, '2026-09-01')).toBe(true);
    expect(await s.history.importDatePurged(jobId, '2026-09-03')).toBe(false);
    // Undo the import: the second is reverted, shown without Delete or Restore.
    const job = await s.imports.job(jobId);
    if (!job) throw new Error('no job');
    expect((await s.imports.revert(jobId, job.job.version, 'undo-imp')).ok).toBe(true);
    expect(await s.history.presence(second.sessionId)).toEqual({ kind: 'hidden' });
    expect((await s.history.importWorkouts(jobId)).rows).toEqual([]);
  });
});

describe('restore preview and backup check with deleted workouts (§6.5; review S1)', () => {
  it('a backup made before a delete: the preview says they come back and counts Recently deleted on its own row', async () => {
    const { s, second } = await twoWorkouts();
    const autos = () => [...h.backupFiles.keys()].filter((n) => n.endsWith('-auto.json')).sort();
    const before = autos().at(-1);
    const text = before === undefined ? null : await s.restore.readOnPhone(before);
    if (text === null) throw new Error('no backup');
    await deleteSecond(s, second);
    const preview = await s.restore.prepare(text);
    if (!preview.ok) throw new Error('preview');
    expect(preview.preview.deletedSinceBackup).toBe(1);
    // Not counted again as a workout only on this phone, or changed.
    expect(preview.preview.onlyOnPhone.workouts + preview.preview.changedOnPhone.workouts).toBe(0);
    const view = buildRestorePreviewView(preview.preview, { nowMs: h.clockMs, tz: TZ });
    expect(view.warnings).toContain('1 workout you deleted since this backup comes back.');
    expect(view.rows.find((r) => r.label === 'Recently deleted')).toEqual({ label: 'Recently deleted', backup: '0', phone: '1' });
    expect(view.rows.find((r) => r.label === 'Workouts')).toMatchObject({ backup: '2', phone: '1' });

    // The launch after the delete backs up; that backup's check counts the deleted workout on its own line.
    await h.forceClose();
    h.clockMs += 10 * 60_000;
    const again = await h.launch();
    await h.settle(again.services);
    for (let i = 0; i < 100 && autos().at(-1) === before; i += 1) await new Promise((r) => setTimeout(r, 10));
    const after = autos().at(-1);
    expect(after).not.toBe(before);
    const afterText = after === undefined ? null : await again.services.restore.readOnPhone(after);
    if (afterText === null) throw new Error('no backup');
    const checked = await again.services.restore.check(afterText);
    if (!checked.ok) throw new Error('check');
    expect(buildCheckResultView(checked, { nowMs: h.clockMs, tz: TZ }, null).lines).toContain('1 deleted workout');
  });
});

describe('op IDs per intent and the launch purge key (review S4, N1, N2)', () => {
  it('the same intent reuses its op ID; another selection or version is a new one', () => {
    let n = 0;
    const ops = new IntentOps(() => `op-${String(++n)}`);
    const a = { sessionId: 'a', expectedVersion: 3 };
    const b = { sessionId: 'b', expectedVersion: 1 };
    expect(ops.for('restore', [a, b])).toBe('op-1');
    expect(ops.for('restore', [b, a])).toBe('op-1');
    expect(ops.for('restore', [a])).toBe('op-2');
    expect(ops.for('delete', [a])).toBe('op-3');
    expect(ops.for('delete', [{ ...a, expectedVersion: 4 }])).toBe('op-4');
  });

  it('a double Restore is a duplicate, not `No longer available.`', async () => {
    const { s, second } = await twoWorkouts();
    const undo = await deleteSecond(s, second);
    const ops = new IntentOps(() => `restore-${String(Math.random())}`);
    const op = ops.for('restore', undo);
    expect(await s.history.restoreWorkouts(undo, op)).toMatchObject({ ok: true, duplicate: false });
    expect(await s.history.restoreWorkouts(undo, ops.for('restore', undo))).toMatchObject({ ok: true, duplicate: true });
  });

  it('a second launch purge the same day still purges what became due since', async () => {
    const { s, first, second } = await twoWorkouts();
    const firstRow = await s.repeat.describeById(first);
    const secondRow = await s.repeat.describeById(second);
    if (!firstRow || !secondRow) throw new Error('rows');
    expect((await s.history.deleteWorkouts([{ sessionId: first, expectedVersion: firstRow.version }], 'del-a')).ok).toBe(true);
    h.clockMs += 60_000;
    expect((await s.history.deleteWorkouts([{ sessionId: second, expectedVersion: secondRow.version }], 'del-b')).ok).toBe(true);
    // Day 31 for the first only, then for both, the same local day.
    h.clockMs += 31 * DAY - 2 * 60 * 60_000;
    const a = await s.history.purgeDue();
    h.clockMs += 60 * 60_000;
    const b = await s.history.purgeDue();
    expect(a + b).toBe(2);
    expect(await s.history.presence(first)).toEqual({ kind: 'gone' });
    expect(await s.history.presence(second)).toEqual({ kind: 'gone' });
  });
});

async function deleteSecond(s: Awaited<ReturnType<Harness['launch']>>['services'], sessionId: string) {
  const row = await s.repeat.describeById(sessionId);
  if (!row) throw new Error('no row');
  const out = await s.history.deleteWorkouts([{ sessionId, expectedVersion: row.version }], `del-${sessionId}`);
  if (!out.ok) throw new Error(out.message);
  return out.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version }));
}
