import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { createHarness, dropPlannedWarmups, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Pain flags without the coach (active-workout §2.14, exercise-library EL9,
 * today.md region 4b) through the app's services on real SQLite: the picker's
 * `May hurt`, the clear confirmation (versioned), and the pre-flag reference in
 * the pain flag sheet. The two-weekly `Still hurts?` check is gone (Ben, 9 Nov):
 * flags clear by themselves after one more session.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;

/** Day 0: Bench press and Dumbbell bench press logged. Day 1: Bench press flagged (shoulder). */
async function flagBench(): Promise<{ s: AppServices; gymId: string; flagId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) },
    { exercise: 'Dumbbell bench press', sets: [1, 2].map(() => ({ load: 30, reps: 10, rpe: 8 })) },
  ]);
  h.clockMs += DAY;
  const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
  if (!ci.ok) throw new Error('check-in');
  const bench = (await s.workout.pickerExercises('none', 'bench')).find((p) => p.exercise.name === 'Bench press');
  const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: bench?.exercise.id ?? '', name: 'Bench press' }], area: 'shoulder', opId: 'flag-1' });
  const flagId = flagged.ok ? flagged.flagIds?.[0] : undefined;
  if (!flagId) throw new Error('flag');
  return { s, gymId, flagId };
}

async function flagVersion(s: AppServices, flagId: string): Promise<number> {
  const f = await s.pain.get(flagId);
  if (!f) throw new Error('flag gone');
  return f.version;
}

describe('picker `May hurt` (EL9, check 50)', () => {
  it('tags only the flagged exercise, with the confirm copy; a similar movement is not tagged', async () => {
    const { s, gymId } = await flagBench();
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const rows = await s.workout.pickerExercises(started.aggregate.session.id, 'bench');
    const bench = rows.find((r) => r.exercise.name === 'Bench press');
    expect(bench?.mayHurt?.confirm).toEqual({
      title: 'Bench press may hurt',
      message: 'Shoulder pain flagged 9 Oct.',
      confirm: 'Add anyway',
      cancel: 'Choose another',
    });
    expect(bench?.mayHurt?.accessibilityLabel).toBe('May hurt: you flagged shoulder pain on it.');
    // Same family, not flagged by Ben: never tagged (CM5). Rows are never hidden.
    expect(rows.find((r) => r.exercise.name === 'Dumbbell bench press')?.mayHurt).toBeNull();
    expect(rows.find((r) => r.exercise.name === 'Incline bench press')?.mayHurt).toBeNull();
  });

  it('a cleared flag tags nothing', async () => {
    const { s, flagId } = await flagBench();
    expect((await s.pain.clearConfirmed({ flagId, expectedVersion: await flagVersion(s, flagId) })).ok).toBe(true);
    const rows = await s.workout.pickerExercises('none', 'bench');
    expect(rows.every((r) => r.mayHurt === null)).toBe(true);
  });
});

describe('no `Still hurts?` check (Ben, 9 Nov)', () => {
  it('Today has no pain check row, however old the flag', async () => {
    const { s } = await flagBench();
    h.clockMs += 20 * DAY;
    const v = await s.today.view();
    expect(v).not.toBeNull();
    expect(v).not.toHaveProperty('painCheck');
    expect(s.pain).not.toHaveProperty('stillHurts');
  });

  it('a flag stays until Ben clears it (versioned) or it lapses; an old flag with stored answers still reads and clears', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    const v = await flagVersion(s, flagId);
    expect(await s.pain.active()).toHaveLength(1);
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: v - 1 })).toMatchObject({ ok: false, stale: true });
    const ok = await s.pain.clearConfirmed({ flagId, expectedVersion: v });
    expect(ok).toEqual({ ok: true, cleared: { id: flagId, version: v + 1 } });
    // A retry of the same clear is a no-op; the toast's Undo restores it.
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: v })).toEqual({ ok: true, cleared: null });
    expect(await s.pain.undoClear(ok.ok && ok.cleared ? [ok.cleared] : [])).toBe(true);
    expect((await s.pain.active()).map((f) => f.id)).toEqual([flagId]);
  });
});

describe('in the workout (checks 32, 51)', () => {
  it('the note is plain (no `check due`), the target holds, and the rest card asks nothing after the first set', async () => {
    const { s, gymId, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    const bench = (await s.workout.pickerExercises(sessionId, 'bench')).find((p) => p.exercise.name === 'Bench press');
    if (!bench) throw new Error('bench');
    const added0 = await s.workout.addExercise({ sessionId, exerciseId: bench.exercise.id, equipmentId: bench.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added0.ok) throw new Error(added0.error.message);
    const added = { aggregate: await dropPlannedWarmups(h, s, sessionId) };

    let data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    let view = s.workout.view(data, h.clockMs, null);
    expect(view.focus?.painFlag).toMatchObject({ flagId, text: 'Pain flag · clears after this workout' });
    // The flag holds the target at the last load (no increase).
    expect(view.focus?.logLabel).toContain('100');

    const sets = [...added.aggregate.sets].filter((x) => x.status !== 'deleted').sort((a, b) => a.index - b.index);
    const first = sets[0];
    if (!first) throw new Error('set');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    view = s.workout.view(data, h.clockMs, null);
    expect(view).not.toHaveProperty('painReview');
    expect(JSON.stringify(view)).not.toMatch(/still hurt/i);
  });
});

describe('pain flag sheet and the pre-flag reference (§2.14.3–2.14.4, check 54)', () => {
  it('before and since the flag as actual results; clearing resets nothing and the reference stays', async () => {
    const { s, gymId, flagId } = await flagBench();
    const open = await s.pain.sheet({ flagId });
    expect(open).toMatchObject({ heading: 'Bench press · shoulder', effect: 'No increases · clears after next session', active: true });
    h.clockMs += DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 90, reps: 8, rpe: 7 })) }]);
    h.clockMs += 13 * DAY;
    // Rule 9 (8 Nov): the next bench workout was the last one held, so the flag has cleared by itself.
    const sheet = await s.pain.sheet({ flagId });
    expect(sheet).toMatchObject({
      heading: 'Bench press · shoulder',
      since: 'Since 9 Oct (14 days) · you, in a check-in',
      effect: 'Cleared 10 Oct.',
      active: false,
    });
    expect(sheet?.before).toMatch(/^8\u00a0Oct · 100/);
    expect(sheet?.sinceFlag).toMatch(/^10\u00a0Oct · 90/);
    expect(sheet?.clearConfirm).not.toHaveProperty('message');
    // Clearing it again changes nothing; nothing deleted: both workouts are still in history.
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: await flagVersion(s, flagId) })).toEqual({ ok: true, cleared: null });
    expect((await s.repeat.candidates()).rows).toHaveLength(2);
  });

  it('an unknown flag reads null, never a made-up sheet', async () => {
    const { s } = await flagBench();
    expect(await s.pain.sheet({ flagId: 'nope' })).toBeNull();
  });
});
