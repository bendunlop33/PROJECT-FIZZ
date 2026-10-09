import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseManager } from '@fizz/persistence';

import { createRestoreService } from '../src/backup/restore-service';
import { buildCheckResultView, buildRestorePreviewView, describeBackupError, rollbackRowView } from '../src/backup/restore-view';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * Restore, Undo restore and Check a backup through the app services on real
 * SQLite files (data-import-export.md §7 checks 7–15).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

/** The stamp of a fresh preview: what Restore passes back after Ben confirms it. */
async function stampFor(s: { restore: { prepare: (t: string) => Promise<{ ok: boolean; preview?: { stamp: string } }> } }, text: string): Promise<string> {
  const p = await s.restore.prepare(text);
  if (!p.ok || !p.preview) throw new Error('preview failed');
  return p.preview.stamp;
}

const autoFiles = () => [...h.backupFiles.keys()].filter((n) => n.endsWith('-auto.json')).sort();

describe('restore from a backup on this phone', () => {
  it('previews what it replaces, restores, undoes, and survives a relaunch', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const [first] = autoFiles();
    if (!first) throw new Error('no automatic backup');
    h.clockMs += 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);
    expect((await s.yourData.counts()).finishedWorkouts).toBe(2);

    // Choose: Fizz's own backups on this phone, newest first.
    const copies = await s.restore.copiesOnPhone();
    expect(copies.map((c) => c.fileName)).toEqual([...autoFiles()].reverse());
    const text = await s.restore.readOnPhone(first);
    if (text === null) throw new Error('unreadable');

    // Check + preview: one workout on this phone isn't in the backup.
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(checked.restorable).toBe(true);
    const view = buildRestorePreviewView(checked.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(view.rows[0]).toEqual({ label: 'Workouts', backup: '1', phone: '2' });
    expect(view.warnings[0]).toBe('1 workout on this phone isn’t in this backup (newest: Fri 9 Oct). It’ll be replaced.');
    expect(view.confirm?.title).toBe('Replace your data on this phone?');
    expect(s.restore.rollbackTarget()).toEqual({ available: false, last: null });

    const restored = await s.restore.restore(text, checked.preview.stamp);
    expect(restored).toMatchObject({ ok: true, status: 'restored' });
    // Services read the new database straight away; the app also relaunches.
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    const row = rollbackRowView(s.restore.rollbackTarget(), { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(row?.title).toBe('Undo last restore');

    await h.forceClose();
    s = (await h.launch()).services;
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
    expect(s.restore.interruptedRestore).toBe(false);

    // Undo restore: the second workout is back; the restored data can be switched to again.
    expect(await s.restore.undo()).toEqual({ ok: true });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(2);
    expect(rollbackRowView(s.restore.rollbackTarget(), { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' })?.title).toBe('Switch back to the restored backup');

    // Restoring the same file again when it matches: unchanged.
    const now2 = await s.restore.readOnPhone(autoFiles().at(-1) ?? '');
    if (now2 === null) throw new Error('no newest');
    const same = await s.restore.prepare(now2);
    expect(same.ok && same.preview.identical).toBe(true);
  });

  it('is refused while a workout is unfinished; Check still works and changes nothing', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    const started = await s.workout.start({ gymId, opId: 'unfinished', checkIn: null });
    expect(started.ok).toBe(true);

    expect(await s.restore.blockedBy()).toMatchObject({ title: 'Workout' });
    expect(await s.restore.restore(text, await stampFor(s, text))).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    expect(await s.restore.undo()).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    const names = s.developer.databaseNames();
    const checked = await s.restore.check(text);
    expect(checked).toMatchObject({ ok: true, restorable: true });
    if (checked.ok) {
      const v = buildCheckResultView(checked, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' }, null);
      expect(v).toMatchObject({ ok: true, title: 'This backup restores' });
      expect(v.lines).toContain('Nothing on this phone was changed.');
    }
    expect(s.developer.databaseNames()).toEqual(names);
    expect(await s.sessions.active()).not.toBeNull();
  });

  it('says plainly when a file is not a backup or is damaged, and leaves no rest alert behind', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    expect(await s.restore.restore(text, await stampFor(s, text))).toMatchObject({ ok: true, status: 'restored' });
    expect(h.pending.size).toBe(0);

    const bad = await s.restore.check('{"hello":"world"}');
    expect(bad.ok ? null : describeBackupError(bad.error)).toBe('This isn’t a GymSmarter backup file. Nothing was changed.');
    const tampered = await s.restore.check(text.replace('"reps"', '"rEps"'));
    expect(tampered.ok ? null : describeBackupError(tampered.error)).toBe('This backup file is damaged (its checksum doesn’t match). Nothing was changed.');
  });

  it('restore, train, Undo, restore again: the preview and the alert say the kept workouts will be deleted (review S2)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    h.clockMs += 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);

    // 1–2. Restore A, then train a workout on the restored data.
    expect(await s.restore.restore(text, await stampFor(s, text))).toMatchObject({ ok: true, status: 'restored' });
    h.clockMs += 86_400_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 65, reps: 5 }] }]);
    // 3. Undo by mistake.
    expect(await s.restore.undo()).toEqual({ ok: true });
    // 4. Restore A again: the workout from step 2 is only in the copy kept for Undo.
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(checked.preview.keptForUndo).toMatchObject({ workouts: 1, unreadable: false });
    const view = buildRestorePreviewView(checked.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    const kept = view.warnings.find((w) => w.startsWith('The data kept for Undo'));
    expect(kept).toMatch(/holds 1 workout \(newest: Sat 10 Oct\)(?: and \d+ other records?)? that (?:isn’t|aren’t) on this phone or in this backup\. This restore deletes that copy/);
    expect(view.confirm?.message).toContain('The data kept for Undo (what you switched away from on Sat 10 Oct');
  });

  it('with nothing replaced and nothing kept, there is no alert', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    const view = buildRestorePreviewView(checked.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(view).toMatchObject({ identical: true, warnings: [], confirm: null });
  });
});

describe('I/O errors during Restore and Undo (review S3)', () => {
  it('never reject: each becomes a "didn’t finish" result the screen can show instead of the cover', async () => {
    const boom = () => Promise.reject(new Error('ENOSPC: no space left on device'));
    const manager = { check: boom, restore: boom, rollback: boom, rollbackTarget: { available: true, last: null } } as unknown as DatabaseManager;
    const svc = createRestoreService({
      manager,
      backupFiles: { read: boom, write: boom, remove: boom },
      now: () => ({ utc: '2026-10-09T08:00:00.000Z', tz: TZ }),
      activeWorkout: () => Promise.resolve(null),
      copiesOnPhone: () => Promise.resolve([]),
      backupsIdle: () => Promise.resolve(),
    });
    for (const r of [await svc.restore('{}', 'stamp'), await svc.undo()]) {
      expect(r).toMatchObject({ ok: false, reason: 'failed', error: { code: 'restore_failed' } });
      if (!r.ok && r.reason === 'failed') expect(describeBackupError(r.error)).toBe('Restore didn’t finish: ENOSPC: no space left on device. Your data is as it was.');
    }
    expect(await svc.prepare('{}')).toMatchObject({ ok: false, error: { code: 'restore_failed' } });
    expect(await svc.check('{}')).toMatchObject({ ok: false, error: { code: 'restore_failed' } });
    expect(await svc.readOnPhone('x.json')).toBeNull();

    // Waiting for a backup that fails is caught too.
    const svc2 = createRestoreService({
      manager,
      backupFiles: { read: boom, write: boom, remove: boom },
      now: () => ({ utc: '2026-10-09T08:00:00.000Z', tz: TZ }),
      activeWorkout: () => Promise.resolve(null),
      copiesOnPhone: () => Promise.resolve([]),
      backupsIdle: boom,
    });
    expect(await svc2.undo()).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('a stale restore preview (review S5)', () => {
  it('is refused if a workout was logged after the preview; the rebuilt preview asks again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    // The preview: nothing would be replaced, so there's no alert.
    const first = await s.restore.prepare(text);
    if (!first.ok) throw new Error(first.error.message);
    const firstView = buildRestorePreviewView(first.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(firstView.confirm).toBeNull();

    // Called away: a quick workout from Today, then back to Restore.
    h.clockMs += 3_600_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 5 }] }]);
    const names = s.developer.databaseNames();
    const r = await s.restore.restore(text, firstView.stamp);
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    // Nothing was switched; the workout is still here.
    expect(s.developer.databaseNames()).toEqual(names);
    expect((await s.yourData.counts()).finishedWorkouts).toBe(2);
    if (r.ok || r.reason !== 'stale' || !r.fresh.ok) throw new Error('expected a fresh preview');
    const fresh = buildRestorePreviewView(r.fresh.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(fresh.confirm?.title).toBe('Replace your data on this phone?');
    expect(fresh.stamp).not.toBe(firstView.stamp);
    expect(describeBackupError({ code: 'preview_stale', message: '' })).toBe('Your data changed since this preview, so nothing was restored. Check the updated preview and confirm again.');
    // Confirming the rebuilt preview restores.
    expect(await s.restore.restore(text, fresh.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect((await s.yourData.counts()).finishedWorkouts).toBe(1);
  });
});

describe('Undo restore with an unfinished workout from the backup (review S6, PM decision on SP2)', () => {
  it('is allowed while that workout is untouched; blocked once Ben continues it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    // A manual backup made during a workout (allowed).
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'during', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const bench = (await s.coachingKnowledge.exercises()).find((e) => e.name === 'Bench press');
    await s.workout.addExercise({ sessionId: started.aggregate.session.id, exerciseId: bench?.id ?? '', equipmentId: null, opId: 'add-during' });
    const made = await s.backups.backUpOnPhone('manual');
    if (!made.ok) throw new Error(made.error);
    const text = await s.restore.readOnPhone(made.record.fileName);
    if (text === null) throw new Error('no backup');
    // Finish it, so Restore isn't blocked.
    h.clockMs += 600_000;
    const active = await s.sessions.active();
    if (!active) throw new Error('no workout');
    expect(await s.sessions.finish(active, 'finish-during')).toMatchObject({ ok: true });

    h.clockMs += 600_000;
    expect(await s.restore.restore(text, await stampFor(s, text))).toMatchObject({ ok: true, status: 'restored' });
    // The restored data has the unfinished workout from the backup.
    expect((await s.sessions.active())?.session.id).toBe(started.aggregate.session.id);
    expect(await s.restore.blockedBy()).not.toBeNull();
    expect(await s.restore.undoBlockedBy()).toBeNull();
    h.clockMs += 60_000;
    expect(await s.restore.undo()).toEqual({ ok: true });
    expect(await s.sessions.active()).toBeNull();

    // Switch back to the restored data: the workout is still untouched, so Undo is still allowed.
    h.clockMs += 60_000;
    expect(await s.restore.undo()).toEqual({ ok: true });
    const restoredActive = await s.sessions.active();
    if (!restoredActive) throw new Error('no restored workout');
    expect(await s.restore.undoBlockedBy()).toBeNull();

    // Ben continues it: now it's a live workout, and Undo is blocked as before (DX4).
    h.clockMs += 60_000;
    const set = restoredActive.sets[0];
    if (!set) throw new Error('no set');
    const logged = await s.workout.dispatch(restoredActive.session.id, { type: 'log_set', at: h.now(), opId: 'continue', setId: set.id, values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    expect(await s.restore.undoBlockedBy()).toMatchObject({ title: 'Workout' });
    expect(await s.restore.undo()).toMatchObject({ ok: false, reason: 'workout_unfinished' });
  });

  it('a workout started after the restore blocks Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const text = await s.restore.readOnPhone(autoFiles()[0] ?? '');
    if (text === null) throw new Error('no backup');
    h.clockMs += 60_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    expect(await s.restore.restore(text, await stampFor(s, text))).toMatchObject({ ok: true });
    h.clockMs += 60_000;
    expect((await s.workout.start({ gymId, opId: 'after', checkIn: null })).ok).toBe(true);
    expect(await s.restore.undo()).toMatchObject({ ok: false, reason: 'workout_unfinished' });
  });
});

