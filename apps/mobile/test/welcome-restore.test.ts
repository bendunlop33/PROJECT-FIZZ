import { afterEach, describe, expect, it } from 'vitest';

import { buildRestorePreviewView } from '../src/backup/restore-view';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * Welcome › Restore from a backup (onboarding OB3, check 10; PM decision on
 * review SP4): a fresh install restores before setup, and restored data with
 * a profile skips setup.
 */
const harnesses: Harness[] = [];
function harness(): Harness {
  const h = createHarness();
  harnesses.push(h);
  return h;
}
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

async function backupFromAnotherPhone(complete: boolean): Promise<string> {
  const old = harness();
  const { services: s } = await old.launch();
  if (complete) {
    const gymId = await setUpGym(old, s);
    await logWorkout(old, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
  } else {
    // Step 3 of setup offers `Save a copy to Files now`, so a backup can hold a profile mid-setup.
    await s.setup.saveUnits('kg');
    await s.setup.saveGym({ gymId: old.ids(), name: 'Main Gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') });
  }
  const made = await s.backups.backUpOnPhone('manual');
  if (!made.ok) throw new Error(made.error);
  const text = old.backupFiles.get(made.record.fileName);
  if (text === undefined) throw new Error('no backup');
  return text;
}

describe('Restore from a backup on Welcome', () => {
  it('a fresh install restores before setup and lands on Today, with no alert (nothing to replace)', async () => {
    const text = await backupFromAnotherPhone(true);
    const h = harness();
    let launched = await h.launch();
    expect(launched.setup.step).toBe('welcome');
    const s = launched.services;
    expect(await s.restore.blockedBy()).toBeNull();
    const checked = await s.restore.prepare(text);
    if (!checked.ok) throw new Error(checked.error.message);
    const view = buildRestorePreviewView(checked.preview, { nowMs: h.clockMs, tz: TZ, locale: 'en-GB' });
    expect(view.warnings).toEqual([]);
    expect(view.confirm).toBeNull();
    expect(await s.restore.restore(text, view.stamp)).toMatchObject({ ok: true, status: 'restored' });
    expect(await s.setup.skipAfterRestore()).toEqual({ hasProfile: true });
    // Done relaunches: no setup step shows.
    await h.forceClose();
    launched = await h.launch();
    expect(launched.setup.step).toBe('done');
    expect((await launched.services.yourData.counts()).finishedWorkouts).toBe(1);
  });

  it('a backup saved part-way through setup also skips setup; its gym is kept', async () => {
    const text = await backupFromAnotherPhone(false);
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
