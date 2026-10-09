import { afterEach, describe, expect, it } from 'vitest';

import { buildRestorePreviewView, restoreBackAllowed, type RestoreStepKind } from '../src/backup/restore-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * Welcome › Restore from a backup (onboarding OB3, check 10; PM decision on
 * review SP4): a fresh install restores before setup, and restored data with
 * a profile skips setup.
 */
const harnesses: Harness[] = [];
/**
 * This phone: a fresh install today. The "other phone" (the one the backup
 * came from) was set up weeks earlier with its own clock and ID generator,
 * as a reinstall on another day really is (review R1): its starter exercise
 * rows carry a different first-launch time.
 */
function harness(start?: string, idStart?: number): Harness {
  const h = start === undefined ? createHarness() : createHarness(start, idStart === undefined ? {} : { idStart });
  harnesses.push(h);
  return h;
}
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

async function backUp(h: Harness, s: AppServices): Promise<string> {
  const made = await s.backups.backUpOnPhone('manual');
  if (!made.ok) throw new Error(made.error);
  const text = h.backupFiles.get(made.record.fileName);
  if (text === undefined) throw new Error('no backup');
  return text;
}

/** Backups from the old phone: `older` right after setup, `latest` after a workout (or part-way through setup). */
async function backupsFromAnotherPhone(complete: boolean): Promise<{ older: string; latest: string }> {
  const old = harness('2026-09-01T08:00:00.000Z', 500_000);
  const { services: s } = await old.launch();
  if (complete) {
    const gymId = await setUpGym(old, s);
    old.clockMs += 86_400_000;
    const older = await backUp(old, s);
    old.clockMs += 86_400_000;
    await logWorkout(old, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    return { older, latest: await backUp(old, s) };
  }
  // Step 3 of setup offers `Save a copy to Files now`, so a backup can hold a profile mid-setup.
  await s.setup.saveUnits('kg');
  await s.setup.saveGym({ gymId: old.ids(), name: 'Main Gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') });
  const latest = await backUp(old, s);
  return { older: latest, latest };
}

const NONE = { workouts: 0, newestWorkoutUtc: null, otherRecords: 0 };

describe('Restore from a backup on Welcome', () => {
  it('a fresh install restores before setup and lands on Today, with no alert (nothing to replace)', async () => {
    const { older, latest } = await backupsFromAnotherPhone(true);
    const h = harness();
    let launched = await h.launch();
    expect(launched.setup.step).toBe('welcome');
    const s = launched.services;
    expect(await s.restore.blockedBy()).toBeNull();
    const checked = await s.restore.prepare(latest);
    if (!checked.ok) throw new Error(checked.error.message);
    // The fresh install's own starter list (Coaching knowledge, stamped today) is never "your data" (review R1, rule 10).
    expect(checked.preview.onlyOnPhone).toEqual(NONE);
    expect(checked.preview.changedOnPhone).toEqual(NONE);
    expect(checked.preview.keptForUndo).toBeNull();
    const view = buildRestorePreviewView(checked.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(view.warnings).toEqual([]);
    expect(view.confirm).toBeNull();
    expect(await s.restore.restore(latest, view.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect(await s.setup.skipAfterRestore()).toEqual({ hasProfile: true });
    // Done relaunches: no setup step shows.
    await h.forceClose();
    launched = await h.launch();
    expect(launched.setup.step).toBe('done');
    expect((await launched.services.yourData.counts()).finishedWorkouts).toBe(1);

    // A later restore of an older backup from the same phone: the copy kept for
    // Undo is the empty install (only its starter list), so nothing is "lost" with it.
    const later = await launched.services.restore.prepare(older);
    if (!later.ok) throw new Error(later.error.message);
    expect(later.preview.keptForUndo).toMatchObject({ workouts: 0, otherRecords: 0, unreadable: false });
    expect(later.preview.changedOnPhone.otherRecords).toBe(0);
    const laterView = buildRestorePreviewView(later.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(laterView.warnings.join(' ')).not.toContain('kept for Undo');
    // What it does say is true: the workout logged after the older backup is replaced.
    expect(later.preview.onlyOnPhone).toMatchObject({ workouts: 1, otherRecords: 0 });
  });

  it('a backup saved part-way through setup also skips setup; its gym is kept', async () => {
    const { latest: text } = await backupsFromAnotherPhone(false);
    const h = harness();
    const { services: s } = await h.launch();
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true });
    expect(await s.setup.skipAfterRestore()).toEqual({ hasProfile: true });
    await h.forceClose();
    const again = await h.launch();
    expect(again.setup.step).toBe('done');
    expect((await again.services.yourData.gyms()).map((g) => g.name)).toEqual(['Main Gym']);
  });

  it('cancelling changes nothing: Welcome shows again', async () => {
    const h = harness();
    const { services: s } = await h.launch();
    // Opening the restore screen reads only; choosing nothing writes nothing.
    await s.restore.copiesOnPhone();
    expect(await s.setup.skipAfterRestore()).toEqual({ hasProfile: false });
    await h.forceClose();
    expect((await h.launch()).setup.step).toBe('welcome');
  });
});

describe('ways out of the restore screen (onboarding §4.5, PM decision RS2; review R2)', () => {
  const before: RestoreStepKind[] = ['choose', 'checking', 'error', 'checked', 'preview'];

  it('from Welcome: Back and swipe work until Restore; after the switch the only exits are Done and Undo restore', () => {
    for (const step of before) expect(restoreBackAllowed(step, true)).toBe(true);
    expect(restoreBackAllowed('restoring', true)).toBe(false);
    expect(restoreBackAllowed('done', true)).toBe(false);
    expect(restoreBackAllowed('undoing', true)).toBe(false);
  });

  it('from Data & backup: no way out while the data switches; Back stays on Done', () => {
    for (const step of before) expect(restoreBackAllowed(step, false)).toBe(true);
    expect(restoreBackAllowed('restoring', false)).toBe(false);
    expect(restoreBackAllowed('undoing', false)).toBe(false);
    expect(restoreBackAllowed('done', false)).toBe(true);
  });

  it('Done relaunches into Today: cold-start recovery runs on the restored data', async () => {
    // The backup holds an unfinished workout; after Done (a relaunch) it is recovered, as on any cold start.
    const old = harness('2026-09-01T08:00:00.000Z', 500_000);
    const { services: o } = await old.launch();
    const gymId = await setUpGym(old, o);
    const started = await o.workout.start({ gymId, opId: 'start-old', checkIn: { kind: 'skipped', atUtc: old.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const text = await backUp(old, o);

    const h = harness();
    const { services: s } = await h.launch();
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    expect(await s.restore.restore(text, checked.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    await h.forceClose();
    const relaunched = await h.launch();
    expect(relaunched.setup.step).toBe('done');
    expect(relaunched.recovery?.state.session.id).toBe(started.aggregate.session.id);
    expect(relaunched.recoveryError).toBeNull();
  });
});
