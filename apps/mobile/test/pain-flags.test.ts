import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { painClearConfirm, painClearedToast } from '../src/workout/pain-clear';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Review workout-loop S7: pain flags can be chosen from the Summary and cleared later (rule 9). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('pain flags after the toast', () => {
  it('Summary → Choose movements flags them; only those hold; Clear lets them progress again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }, { exercise: 'Lat pulldown', sets: [1, 2].map(() => ({ load: 40, reps: 10, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const withPain = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'] }, ci.checkIn.version, h.ids());
    if (!withPain.ok) throw new Error('reasons');
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'answered', checkInId: ci.checkIn.id } });
    if (!started.ok) throw new Error('start');
    // Log the second workout through the normal path, then finish it.
    await s.workout.dispatch(started.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'd', expectedVersion: started.aggregate.session.version });
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }, { exercise: 'Lat pulldown', sets: [1, 2].map(() => ({ load: 40, reps: 10, rpe: 8 })) }]);
    let sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.map((r) => [r.exerciseName, r.decision])).toEqual([
      ['Bench press', 'increase_load'],
      ['Lat pulldown', 'increase_load'],
    ]);

    // Flag Bench press from a check-in that mentioned pain (the Summary's sheet does this).
    const latest = await s.checkIns.get(ci.checkIn.id);
    if (!latest || !sum) throw new Error('fixture');
    const bench = sum.exercises.find((e) => e.name === 'Bench press');
    const flagged = await s.pain.flagFromCheckIn({ checkIn: latest, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: null, opId: 'flag-1' });
    expect(flagged.ok).toBe(true);
    sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision).toBe('halted_pain');
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Lat pulldown')?.decision).toBe('increase_load');
    expect((await s.pain.active()).map((f) => f.exerciseName)).toEqual(['Bench press']);

    // Profile → Pain flags → Clear.
    for (const f of await s.pain.active()) expect(await s.pain.clearConfirmed({ flagId: f.id, expectedVersion: f.version })).toMatchObject({ ok: true });
    expect(await s.pain.active()).toEqual([]);
    sum = await s.workout.summary(second);
    expect(sum?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision).toBe('increase_load');
  });
});

describe('Summary Clear on a pain flag (review S4, rule 9)', () => {
  async function flagBench(): Promise<{ s: Awaited<ReturnType<Harness['launch']>>['services']; sessionId: string; flagId: string }> {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const sum = await s.workout.summary(sessionId);
    const bench = sum?.exercises.find((e) => e.name === 'Bench press');
    const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exerciseId ?? '', name: 'Bench press' }], area: null, opId: 'flag-s4' });
    const flagId = flagged.ok ? flagged.flagIds?.[0] : undefined;
    if (!flagId) throw new Error('flag');
    return { s, sessionId, flagId };
  }

  it('uses the same confirm wording as the pain flag sheet and Profile (AW10)', () => {
    const flag = { exerciseName: 'Bench press', reportedAt: { utc: '2026-10-06T09:00:00.000Z', tz: 'Europe/London' } };
    expect(painClearConfirm(flag)).toEqual({
      title: 'Clear the pain flag on Bench press?',
      message: 'Loads, reps and sets can go up again, starting from your recent sets. Your sets from before 6\u00a0Oct stay in your history as the reference.',
      confirm: 'Clear flag',
      cancel: 'Keep it',
    });
    expect(painClearedToast('Bench press')).toEqual({ text: 'Pain flag cleared for Bench press', action: 'Undo' });
  });

  it('Clear then Undo puts the flag back as a new version, and Next time holds again', async () => {
    const { s, sessionId, flagId } = await flagBench();
    const decision = async () => (await s.workout.summary(sessionId))?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press')?.decision;
    expect(await decision()).toBe('halted_pain');
    const cleared = await s.pain.clearConfirmed({ flagId, expectedVersion: 1 });
    expect(cleared).toEqual({ ok: true, cleared: { id: flagId, version: 2 } });
    if (!cleared.ok || !cleared.cleared) throw new Error('clear');
    expect(await decision()).toBe('increase_load');
    expect(await s.pain.undoClear([cleared.cleared])).toBe(true);
    const back = await s.pain.active();
    expect(back.map((f) => [f.id, f.status, f.version, f.clearedAtUtc])).toEqual([[flagId, 'active', 3, null]]);
    expect(await decision()).toBe('halted_pain');
    // A second Undo (double tap) changes nothing.
    expect(await s.pain.undoClear([cleared.cleared])).toBe(false);
    expect((await s.pain.active()).map((f) => f.version)).toEqual([3]);
  });

  it('Undo never overwrites a flag that changed after the clear (stale)', async () => {
    const { s, flagId } = await flagBench();
    const cleared = await s.pain.clearConfirmed({ flagId, expectedVersion: 1 });
    if (!cleared.ok || !cleared.cleared) throw new Error('clear');
    // The flag moves on after the clear: Undo, then cleared again from Profile (version 4).
    expect(await s.pain.undoClear([cleared.cleared])).toBe(true);
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: 3 })).toMatchObject({ ok: true });
    // The first toast's Undo is now stale: the flag stays cleared.
    expect(await s.pain.undoClear([cleared.cleared])).toBe(false);
    expect(await s.pain.active()).toEqual([]);
  });
});

