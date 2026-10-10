import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Pain flags without the coach (active-workout §2.14, exercise-library EL9,
 * today.md region 4b) through the app's services on real SQLite: the picker's
 * `May hurt`, the two-weekly `Still hurts?` (never clears a flag), the clear
 * confirmation (versioned), and the pre-flag reference in the pain flag sheet.
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
      message: 'You flagged shoulder pain on it on 9 Oct. Loads won’t go up while the flag is on.',
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

describe('Today region 4b (today checks 19–20)', () => {
  it('shows the row 14 days after the flag, not 13; hidden with a workout in progress', async () => {
    const { s, gymId, flagId } = await flagBench();
    h.clockMs += 13 * DAY;
    expect((await s.today.view())?.painCheck).toBeNull();
    h.clockMs += DAY;
    expect((await s.today.view())?.painCheck).toEqual({ kind: 'one', flagId, text: 'Still hurts? Bench press · flagged 14 days ago', accessibilityLabel: 'Pain flag check due: Bench press, flagged 14 days ago.' });
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    expect((await s.today.view())?.painCheck).toBeNull();
  });
});

describe('Still hurts (§2.14.2, checks 52–53)', () => {
  it('keeps the flag, moves the check 14 days on, and survives a force-close', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    const v = await flagVersion(s, flagId);
    const r = await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: v });
    expect(r).toMatchObject({ ok: true, kept: 'Pain flag kept · next check 6 Nov', nudge: null, duplicate: false });
    expect((await s.pain.active()).map((f) => [f.id, f.status])).toEqual([[flagId, 'active']]);
    expect((await s.today.view())?.painCheck).toBeNull();

    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.pain.get(flagId))?.reviews?.map((x) => x.opId)).toEqual(['review-1']);
    expect((await s2.today.view())?.painCheck).toBeNull();
    h.clockMs += 14 * DAY;
    expect((await s2.today.view())?.painCheck?.kind).toBe('one');
  });

  it('the same operation twice records one answer; a second answer elsewhere is not_due; an old version is stale', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 15 * DAY;
    const v = await flagVersion(s, flagId);
    const first = await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: v });
    expect(first.ok).toBe(true);
    const retry = await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: v });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    expect((await s.pain.get(flagId))?.reviews).toHaveLength(1);
    expect(await s.pain.stillHurts({ flagId, opId: 'review-2', expectedVersion: v + 1 })).toMatchObject({ ok: false, reason: 'not_due' });

    // Undo, then answer from a screen that read the flag before the undo: refused, not applied to newer state.
    expect(await s.pain.undoStillHurts({ flagId, reviewOpId: 'review-1', undoOpId: 'undo-1' })).toBe(true);
    expect(await s.pain.stillHurts({ flagId, opId: 'review-3', expectedVersion: v + 1 })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.today.view())?.painCheck?.kind).toBe('one');
  });

  it('Undo makes the check due again; Undo twice is a no-op', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: await flagVersion(s, flagId) });
    expect(await s.pain.undoStillHurts({ flagId, reviewOpId: 'review-1', undoOpId: 'undo-1' })).toBe(true);
    const v = await flagVersion(s, flagId);
    expect(await s.pain.undoStillHurts({ flagId, reviewOpId: 'review-1', undoOpId: 'undo-1' })).toBe(true);
    expect(await flagVersion(s, flagId)).toBe(v);
    expect((await s.today.view())?.painCheck?.kind).toBe('one');
  });

  it('the second Still hurts in a row adds the physio-or-doctor line', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: await flagVersion(s, flagId) });
    h.clockMs += 14 * DAY;
    const second = await s.pain.stillHurts({ flagId, opId: 'review-2', expectedVersion: await flagVersion(s, flagId) });
    expect(second.ok && second.nudge).toBe('It’s been 4 weeks. Pain that lasts this long is worth getting checked by a physio or doctor.');
  });

  it('answering never clears: only clearConfirmed does, and only at the version the sheet read', async () => {
    const { s, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    const v = await flagVersion(s, flagId);
    await s.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: v });
    expect(await s.pain.active()).toHaveLength(1);
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: v })).toMatchObject({ ok: false, stale: true });
    expect(await s.pain.active()).toHaveLength(1);
    const ok = await s.pain.clearConfirmed({ flagId, expectedVersion: v + 1 });
    expect(ok).toEqual({ ok: true, cleared: { id: flagId, version: v + 2 } });
    // A retry of the same clear is a no-op; the toast's Undo restores it.
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: v + 1 })).toEqual({ ok: true, cleared: null });
    expect(await s.pain.undoClear(ok.ok && ok.cleared ? [ok.cleared] : [])).toBe(true);
    expect((await s.pain.active()).map((f) => f.reviews?.length)).toEqual([1]);
  });
});

describe('in the workout (checks 32, 51)', () => {
  it('the note reads `check due`; Still hurts? shows once after the first set of the movement, and goes after the answer', async () => {
    const { s, gymId, flagId } = await flagBench();
    h.clockMs += 14 * DAY;
    const started = await s.workout.start({ gymId, opId: 'w2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    const bench = (await s.workout.pickerExercises(sessionId, 'bench')).find((p) => p.exercise.name === 'Bench press');
    if (!bench) throw new Error('bench');
    const added = await s.workout.addExercise({ sessionId, exerciseId: bench.exercise.id, equipmentId: bench.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);

    let data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    let view = s.workout.view(data, h.clockMs, null);
    expect(view.focus?.painFlag).toMatchObject({ flagId, checkDue: true, text: 'Pain flag: no increases · check due' });
    expect(view.painReview).toBeNull();
    // The flag holds the target at the last load (no increase).
    expect(view.focus?.logLabel).toContain('100');

    const sets = [...added.aggregate.sets].sort((a, b) => a.index - b.index);
    const first = sets[0];
    if (!first) throw new Error('set');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    view = s.workout.view(data, h.clockMs, null);
    expect(view.painReview).toMatchObject({ flagId, question: 'Bench press: still hurting?', fact: 'Pain flag since 9 Oct · 14 days', afterSetId: first.id });

    // Force-close in the rest: the prompt is derived from stored state, so it's still there.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    data = await s2.workout.load(sessionId);
    if (!data) throw new Error('load');
    expect(s2.workout.view(data, h.clockMs, null).painReview?.flagId).toBe(flagId);

    const r = await s2.pain.stillHurts({ flagId, opId: 'review-1', expectedVersion: view.painReview?.flagVersion ?? -1 });
    expect(r.ok).toBe(true);
    data = await s2.workout.load(sessionId);
    if (!data) throw new Error('load');
    view = s2.workout.view(data, h.clockMs, null);
    expect(view.painReview).toBeNull();
    expect(view.focus?.painFlag).toMatchObject({ checkDue: false, text: 'Pain flag: no increases' });
  });
});

describe('pain flag sheet and the pre-flag reference (§2.14.3–2.14.4, check 54)', () => {
  it('before and since the flag as actual results; clearing resets nothing and the reference stays', async () => {
    const { s, gymId, flagId } = await flagBench();
    h.clockMs += DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 90, reps: 8, rpe: 7 })) }]);
    h.clockMs += 13 * DAY;
    const sheet = await s.pain.sheet({ flagId });
    expect(sheet).toMatchObject({
      heading: 'Bench press · shoulder',
      since: 'Since 9 Oct (14 days) · you, in a check-in',
      effect: 'No increases in load, reps or sets.',
      checkDue: true,
      active: true,
    });
    expect(sheet?.before).toMatch(/^8\u00a0Oct · 100/);
    expect(sheet?.sinceFlag).toMatch(/^10\u00a0Oct · 90/);
    expect(sheet?.clearConfirm.message).toBe('Loads, reps and sets can go up again, starting from your recent sets. Your sets from before 9 Oct stay in your history as the reference.');

    const v = await flagVersion(s, flagId);
    expect((await s.pain.clearConfirmed({ flagId, expectedVersion: v })).ok).toBe(true);
    const after = await s.pain.sheet({ flagId });
    expect(after).toMatchObject({ active: false, checkDue: false, before: sheet?.before, sinceFlag: sheet?.sinceFlag });
    expect(after?.effect).toMatch(/^Cleared /);
    // Nothing deleted: both workouts are still in history.
    expect((await s.repeat.candidates()).rows).toHaveLength(2);
  });

  it('an unknown flag reads null, never a made-up sheet', async () => {
    const { s } = await flagBench();
    expect(await s.pain.sheet({ flagId: 'nope' })).toBeNull();
  });
});
