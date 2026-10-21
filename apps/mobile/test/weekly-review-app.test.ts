import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONNECTED, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The weekly review in the whole app (workout-builder-v3 §6.1, §6.2; Ben 21 Oct): Summary's
 * `How did it feel?` is stored with the workout and counted; `Lifts shown` takes any exercise Ben logs
 * (up to 6) and is Your data; the review survives a force-close and is in the backup.
 */

describe('weekly review in the app', () => {
  let h: Harness;
  let model: StepModel;
  beforeEach(() => {
    model = new StepModel([], { weekly: true });
    // Tue 13 Oct (London); the reviewed week is Mon 12 – Sun 18 Oct, opened Mon 19 Oct.
    h = createHarness('2026-10-13T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('How did it feel?: one tap stored with the workout (versioned), changed or cleared, and counted in the week', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5, rpe: 8 }] }]);
    const before = await s.reviews.feelOf(sessionId);
    expect(before).toMatchObject({ feel: null });
    const r = await s.workout.dispatch(sessionId, { type: 'set_feel', at: h.now(), opId: 'feel-1', feel: 'hard', expectedVersion: before?.version ?? 0 });
    expect(r.ok).toBe(true);
    expect((await s.reviews.feelOf(sessionId))?.feel).toBe('hard');
    // A stale version is refused (rule 5).
    expect((await s.workout.dispatch(sessionId, { type: 'set_feel', at: h.now(), opId: 'feel-2', feel: 'easy', expectedVersion: before?.version ?? 0 })).ok).toBe(false);

    model = new StepModel([() => toolCall('weekly_review', { verdict: 'Felt hard.', lines: ['1 session felt hard.'], tweaks: [] })], { weekly: true });
    h.clockMs = Date.parse('2026-10-19T08:00:00.000Z');
    const run = await s.reviews.runOnOpen();
    expect(run.kind).toBe('reviewed');
    if (run.kind !== 'reviewed') return;
    expect(run.review.facts).toContainEqual({ kind: 'feel', easy: 0, good: 0, hard: 1 });
    expect(run.review.coach).toMatchObject({ verdict: 'Felt hard.', lines: ['1 session felt hard.'] });
    expect((await s.reviews.reviews())?.latest?.facts).toContain('Felt: 1 hard');
  });

  it('Lifts shown: any logged exercise, up to 6, Your data; the review survives a force-close and is backed up', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 80, reps: 5 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }] },
    ]);
    const choices = await s.reviews.liftChoices();
    expect(choices.map((c) => c.name)).toEqual(expect.arrayContaining(['Bench press', 'Lat pulldown']));
    const pulldown = choices.find((c) => c.name === 'Lat pulldown');
    const version = (await s.reviews.reviews())?.trainingVersion ?? null;
    if (pulldown === undefined || version === null) throw new Error('setup');
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: [pulldown.exerciseId] }, version, 'lifts-1')).toMatchObject({ ok: true });
    const data = await s.reviews.reviews();
    expect(data?.liftsShown.map((l) => l.name)).toEqual(['Lat pulldown']);
    expect(data?.liftsChosen).toBe(true);
    const lifts = data?.goal.sections.find((x) => x.kind === 'lifts');
    expect(lifts?.kind === 'lifts' && lifts.charts.map((c) => c.title)).toEqual(['Lat pulldown']);
    // Seven is refused (max 6).
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, version + 1, 'lifts-2')).toMatchObject({ ok: false, reason: 'invalid' });

    // Offline: facts only; after a force-close the stored review is still there.
    model = new StepModel([() => [{ type: 'error', error: 'network' }]], { weekly: true });
    h.clockMs = Date.parse('2026-10-19T08:00:00.000Z');
    expect(await s.reviews.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'offline' });
    await h.forceClose();
    ({ services: s } = await h.launch());
    const again = await s.reviews.reviews();
    expect(again?.latest?.verdict).toBe('Not reviewed · Offline');
    expect(await s.backups.backUpOnPhone('manual')).toMatchObject({ ok: true });
    const files = [...h.backupFiles.values()];
    expect(files.some((t) => t.includes('"reviews"') && t.includes('weekly'))).toBe(true);
  });
});
