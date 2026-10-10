import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Sets that don't count (active-workout §2.13) through the app's services on
 * real SQLite: the correction sheet's chips save as one versioned
 * `correct_set`, `Pain` also flags the movement (AW7), Undo is another
 * versioned correction, and the next workout's built-in targets, `Last`
 * line and the summary treat a flagged set as the spec says.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const NBSP = ' ';
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

/** Bench press 3 × 100 kg × 12 at RPE 7: the built-in rule would add load next time. */
async function benchWorkout(s: AppServices, gymId: string): Promise<{ sessionId: string; aggregate: SessionAggregate }> {
  const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 12, rpe: 7 })) }]);
  const data = await s.workout.load(sessionId);
  if (!data) throw new Error('load');
  return { sessionId, aggregate: data.aggregate };
}

const done = (a: SessionAggregate) => a.sets.filter((x) => x.status === 'completed').sort((x, y) => x.index - y.index);

/** Start a new workout with Bench press added, as the app plans it (built-in rule targets). */
async function nextBench(s: AppServices, gymId: string): Promise<{ sessionId: string; aggregate: SessionAggregate }> {
  h.clockMs += 2 * DAY;
  const started = await s.workout.start({ gymId, opId: `next-${String(h.clockMs)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  return { sessionId, aggregate: added.aggregate };
}

describe('correctSet with exclusion chips (§2.13, AW6)', () => {
  it('marks a set with a toast and Undo; the next workout holds instead of adding load', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const third = done(aggregate)[2];
    if (!third) throw new Error('fixture');

    const r = await s.workout.correctSet({ sessionId, setId: third.id, expectedSetVersion: third.version, patch: { exclusions: ['spotted'] }, opId: 'mark-1' });
    expect(r).toMatchObject({ ok: true, duplicate: false, toast: 'Set 3: spotted · not counted for records' });
    if (!r.ok) throw new Error('mark');
    expect(r.undo).toEqual({ setId: third.id, setVersion: third.version + 1, previous: [], painFlags: [] });
    // A retry of the same tap is a duplicate with no second toast.
    expect(await s.workout.correctSet({ sessionId, setId: third.id, expectedSetVersion: third.version, patch: { exclusions: ['spotted'] }, opId: 'mark-1' })).toMatchObject({ ok: true, duplicate: true, toast: null, undo: null });

    const sum = await s.workout.summary(sessionId);
    expect(plain(sum?.exercises[0]?.results)).toMatch(/· spotted$/);
    expect(sum?.facts.workingSets).toBe(3);

    const next = await nextBench(s, gymId);
    const planned = next.aggregate.sets.find((x) => x.setType === 'working')?.planned;
    expect(planned?.load?.value).toBe(100);
    expect(planned?.provenance?.rule?.facts.some((f) => f.includes('(1 left out); holding.'))).toBe(true);
    const view = s.workout.view((await s.workout.load(next.sessionId)) ?? (() => { throw new Error('load'); })(), h.clockMs, null);
    // Set 1's `Last` is last time's set 1, which counted: no words.
    expect(plain(view.focus?.previous?.text)).toBe('100 kg × 12');
  });

  it('without the mark, the same workout adds load (control)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await benchWorkout(s, gymId);
    const next = await nextBench(s, gymId);
    expect(next.aggregate.sets.find((x) => x.setType === 'working')?.planned.load?.value).toBeGreaterThan(100);
  });

  it('Undo puts the flags back as one more versioned correction; a stale Undo is refused', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const first = done(aggregate)[0];
    if (!first) throw new Error('fixture');
    const r = await s.workout.correctSet({ sessionId, setId: first.id, expectedSetVersion: first.version, patch: { exclusions: ['technique'] }, opId: 'mark-1' });
    if (!r.ok || !r.undo) throw new Error('mark');
    expect(await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-1' })).toEqual({ ok: true, message: null });
    const after = (await s.workout.load(sessionId))?.aggregate;
    const set = after?.sets.find((x) => x.id === first.id);
    expect(set).not.toHaveProperty('exclusions');
    expect(after?.audit.filter((e) => e.setId === first.id).map((e) => e.kind)).toEqual(['logged', 'corrected', 'corrected']);
    // The toast's Undo again, after the set moved on: refused, never applied to newer state.
    expect(await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-2' })).toEqual({ ok: false, message: 'Can’t undo: this set changed. Tap it to edit.' });
  });

  it('a stale sheet writes nothing (no pain flag either)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const first = done(aggregate)[0];
    if (!first) throw new Error('fixture');
    await s.workout.correctSet({ sessionId, setId: first.id, expectedSetVersion: first.version, patch: { reps: 11 }, opId: 'fix-1' });
    const stale = await s.workout.correctSet({ sessionId, setId: first.id, expectedSetVersion: first.version, patch: { exclusions: ['pain'] }, opId: 'mark-stale' });
    expect(stale).toEqual({ ok: false, stale: true, message: 'This set changed since it was shown. Showing the latest.' });
    expect(await s.pain.active()).toEqual([]);
  });
});

describe('`Pain` also flags the movement (AW7)', () => {
  it('sets one workout-sourced flag (idempotent); Undo retracts it with the mark; unticking never clears a flag', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const [a, b] = done(aggregate);
    if (!a || !b) throw new Error('fixture');

    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'pain-1' });
    if (!r.ok || !r.undo) throw new Error('mark');
    expect(r.toast).toBe('Set 1: pain · not counted for records · pain flag on Bench press');
    const flags = await s.pain.active();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ exerciseName: 'Bench press', source: 'workout', area: null, checkInId: null, status: 'active' });
    expect(r.undo.painFlags).toEqual([{ id: flags[0]?.id, version: 1 }]);
    // Retry: still one flag.
    await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'pain-1' });
    expect(await s.pain.active()).toHaveLength(1);

    // A second set marked Pain while the flag is on: no new flag.
    const r2 = await s.workout.correctSet({ sessionId, setId: b.id, expectedSetVersion: b.version, patch: { exclusions: ['pain'] }, opId: 'pain-2' });
    expect(r2).toMatchObject({ ok: true, toast: 'Set 2: pain · not counted for records', undo: { painFlags: [] } });
    expect(await s.pain.active()).toHaveLength(1);

    // Unticking Pain on set 2 leaves the movement's flag alone (only `Clear flag` clears it).
    const b2 = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === b.id);
    await s.workout.correctSet({ sessionId, setId: b.id, expectedSetVersion: b2?.version ?? 0, patch: { exclusions: [] }, opId: 'unpain-2' });
    expect(await s.pain.active()).toHaveLength(1);

    // Undo on the first toast: the mark and the flag it set both go.
    expect((await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-pain-1' })).ok).toBe(true);
    expect(await s.pain.active()).toEqual([]);
  });
});

describe('Undo of a Pain mark retracts the flag it set (review B2)', () => {
  it('as if it was never set: no Pain or Before flag in Why?, not listed, no reference in the sheet', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const a = done(aggregate)[0];
    if (!a) throw new Error('fixture');
    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'oops-pain' });
    if (!r.ok || !r.undo) throw new Error('mark');
    const flagId = r.undo.painFlags[0]?.id ?? '';
    h.clockMs += 2_000;
    expect(await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-oops' })).toEqual({ ok: true, message: null });

    const flag = await s.pain.get(flagId);
    expect(flag).toMatchObject({ status: 'retracted', clearedAtUtc: null, version: 2, retracted: { opId: 'undo-oops:pain' } });
    expect(await s.pain.active()).toEqual([]);
    // The withdrawn flag's sheet (a stale link) shows no reference period.
    expect(await s.pain.sheet({ flagId })).toMatchObject({ active: false, effect: 'Undone.', before: null, sinceFlag: null });

    // Next workout: the target goes up as normal, and Why? never mentions the withdrawn flag.
    const next = await nextBench(s, gymId);
    const set = next.aggregate.sets[0];
    const rows = (await s.workout.explainTarget(next.sessionId, set?.id ?? ''))?.rows.map((x) => x.label) ?? [];
    expect(rows).not.toContain('Pain');
    expect(rows).not.toContain('Before flag');
    expect(set?.planned.load?.value).toBeGreaterThan(100);
  });

  it('versioned against the flag the mark produced: a flag changed since is kept, and Ben is told', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const a = done(aggregate)[0];
    if (!a) throw new Error('fixture');
    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'pain-kept' });
    if (!r.ok || !r.undo) throw new Error('mark');
    const flagId = r.undo.painFlags[0]?.id ?? '';
    // Ben clears it through the confirmation before tapping Undo on the old toast.
    expect(await s.pain.clearConfirmed({ flagId, expectedVersion: 1 })).toMatchObject({ ok: true });
    expect(await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-late' })).toEqual({ ok: true, message: 'Set undone. Pain flag kept: it changed since.' });
    expect(await s.pain.get(flagId)).toMatchObject({ status: 'cleared', version: 2 });
    // A retracted flag can't be cleared or restored afterwards.
    const r2 = await s.workout.correctSet({ sessionId, setId: done(aggregate)[1]?.id ?? '', expectedSetVersion: done(aggregate)[1]?.version ?? 0, patch: { exclusions: ['pain'] }, opId: 'pain-again' });
    if (!r2.ok || !r2.undo) throw new Error('mark 2');
    const second = r2.undo.painFlags[0];
    expect(second).toEqual({ id: expect.any(String) as string, version: 1 });
    expect(await s.workout.undoMark({ sessionId, ...r2.undo, opId: 'undo-2' })).toEqual({ ok: true, message: null });
    expect(await s.pain.clearConfirmed({ flagId: second?.id ?? '', expectedVersion: 2 })).toMatchObject({ ok: false, stale: true });
    expect(await s.pain.undoClear([{ id: second?.id ?? '', version: 2 }])).toBe(false);
    expect(await s.pain.get(second?.id ?? '')).toMatchObject({ status: 'retracted' });
  });
});

describe('A failed Pain mark, then a retry in the same sheet (review r2 B1)', () => {
  /** A save that `correct_set` refuses for a non-stale reason (an invalid value), as the sheet sends it. */
  const badPatch = { exclusions: ['pain' as const], reps: -1 };

  it('the failed save leaves no active flag and no `Before flag` reference', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const a = done(aggregate)[0];
    if (!a) throw new Error('fixture');
    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: badPatch, opId: 'sheet-op' });
    expect(r).toMatchObject({ ok: false, stale: false });
    expect(await s.pain.active()).toEqual([]);
    const set = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === a.id);
    expect(set?.exclusions ?? []).toEqual([]);
    // The next workout adds load as normal, with no pain rows in Why?.
    const next = await nextBench(s, gymId);
    const first = next.aggregate.sets[0];
    const rows = (await s.workout.explainTarget(next.sessionId, first?.id ?? ''))?.rows.map((x) => x.label) ?? [];
    expect(rows).not.toContain('Pain');
    expect(rows).not.toContain('Before flag');
  });

  it('a retry with the same opId sets one active flag, the toast is true, and Undo takes it back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const a = done(aggregate)[0];
    if (!a) throw new Error('fixture');
    expect((await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: badPatch, opId: 'sheet-op' })).ok).toBe(false);
    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'sheet-op' });
    expect(r).toMatchObject({ ok: true, toast: 'Set 1: pain · not counted for records · pain flag on Bench press' });
    if (!r.ok || !r.undo) throw new Error('retry');
    const active = await s.pain.active();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ exerciseName: 'Bench press', status: 'active' });
    expect(r.undo.painFlags).toEqual([{ id: active[0]?.id, version: active[0]?.version }]);
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === a.id)?.exclusions).toEqual(['pain']);
    // A duplicate of the successful retry flags nothing more.
    await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['pain'] }, opId: 'sheet-op' });
    expect(await s.pain.active()).toHaveLength(1);

    expect((await s.workout.undoMark({ sessionId, ...r.undo, opId: 'undo-retry' })).ok).toBe(true);
    expect(await s.pain.active()).toEqual([]);
  });

  it('a retry that drops Pain leaves no flag', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await benchWorkout(s, gymId);
    const a = done(aggregate)[0];
    if (!a) throw new Error('fixture');
    expect((await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: badPatch, opId: 'sheet-op' })).ok).toBe(false);
    const r = await s.workout.correctSet({ sessionId, setId: a.id, expectedSetVersion: a.version, patch: { exclusions: ['spotted'] }, opId: 'sheet-op' });
    expect(r).toMatchObject({ ok: true, toast: 'Set 1: spotted · not counted for records', undo: { painFlags: [] } });
    expect(await s.pain.active()).toEqual([]);
  });
});

describe('Pain step: a retry never reports a withdrawn flag (review r2 N2)', () => {
  it('a retry after the step went through flags nothing new, even when Undo retracted the flag', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId } = await benchWorkout(s, gymId);
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 3 });
    if (!ci.ok) throw new Error('check-in');
    const exerciseId = (await s.workout.summary(sessionId))?.exercises.find((e) => e.name === 'Bench press')?.exerciseId ?? '';
    const req = { checkIn: ci.checkIn, exercises: [{ id: exerciseId, name: 'Bench press' }], area: null, opId: 'ci-pain' };
    const first = await s.pain.flagFromCheckIn(req);
    if (!first.ok || !first.flags) throw new Error('flag');
    expect(await s.pain.active()).toHaveLength(1);
    expect((await s.pain.retract(first.flags, 'undo-ci')).ok).toBe(true);
    expect(await s.pain.active()).toEqual([]);

    const retry = await s.pain.flagFromCheckIn(req);
    expect(retry).toMatchObject({ ok: true, duplicate: true, flags: [] });
    expect(await s.pain.active()).toEqual([]);
  });
});
