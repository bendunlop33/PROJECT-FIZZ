import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Ben's report, Build B (21 Oct): a new Back day built with Set up → Next:
 * exercises put barbell row far too light, though his last rows (made in
 * the builder, so logged as a top set and back-offs) were 80 × 12 @ 6 and
 * 90 × 12. "It knew my history but wasn't using it." Real SQLite, no coach:
 * the loads are the builder's own (history → rule → est. max → gym).
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  const model = new StepModel([]);
  h = createHarness('2026-09-10T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const mainOf = (snap: BuilderSnapshot) => {
  const m = slotsOf(snap.workout.blocks).find((x) => x.main);
  if (m === undefined) throw new Error('no main lift');
  return m;
};

/** Set up → Pull with barbell row as the main lift → Next: exercises. */
async function buildPull(s: AppServices, opId: string): Promise<BuilderSnapshot> {
  const base = await s.builder.initialSetup({ dayId: 'pull' });
  const row = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
  if (row === undefined) throw new Error('no barbell row');
  const snap = ok(await s.builder.create({ ...base, mainLiftExerciseId: row.id }, opId)).snapshot;
  expect(snap.facts[mainOf(snap).exerciseId]?.name).toBe('Barbell row');
  return snap;
}

/** Start the built workout, log the row's top set and back-offs as Ben did, and finish. */
async function doRows(s: AppServices, gymId: string, snap: BuilderSnapshot, opId: string, topSet: { load: number; reps: number; rpe: number | null }, backoff: { load: number; reps: number }): Promise<void> {
  const started = await s.builder.start(snap.draftId, { opId, expectedVersion: snap.version, gymId });
  if (!started.ok) throw new Error('not started');
  const a = (await s.workout.load(started.sessionId))?.aggregate;
  const ex = a?.exercises.find((e) => e.exerciseId === mainOf(snap).exerciseId);
  if (a === undefined || ex === undefined) throw new Error('no row');
  const sets = a.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup').sort((x, y) => x.index - y.index);
  expect(sets[0]?.setType).toBe('top');
  for (const set of sets) {
    const v = set.setType === 'top' ? topSet : { ...backoff, rpe: null };
    h.clockMs += 120_000;
    const r = await s.workout.dispatch(started.sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: { value: v.load, unit: ex.unit, convention: ex.loadConvention }, reps: v.reps, durationS: null, rpe: v.rpe, rir: null }, restTimerId: h.ids() });
    expect(r.ok).toBe(true);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(started.sessionId);
  expect((await s.workout.dispatch(started.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null })).ok).toBe(true);
  await h.settle(s);
}

describe("Ben's rows: a new workout's loads come from his recent sets (Build B, 21 Oct)", () => {
  it('Fri 80 × 12 @ 6 and Sat 90 × 12 (builder format) over older 3 × 60 × 10: the new Pull day plans the row around 97.5 × 6 / 92.5 × 8, warm-ups below the top set', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // Older, lighter rows (plain working sets), five weeks back.
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 60, reps: 10 }, { load: 60, reps: 10 }, { load: 60, reps: 10 }] }]);
    h.clockMs += 35 * DAY;

    // Friday and Saturday: built in the builder, so the row is a top set and back-offs.
    await doRows(s, gymId, await buildPull(s, 'build-fri'), 'start-fri', { load: 80, reps: 12, rpe: 6 }, { load: 70, reps: 12 });
    h.clockMs += DAY;
    await doRows(s, gymId, await buildPull(s, 'build-sat'), 'start-sat', { load: 90, reps: 12, rpe: null }, { load: 80, reps: 12 });
    h.clockMs += 3 * DAY;

    const snap = await buildPull(s, 'build-new');
    const main = mainOf(snap);
    const top = main.rows.find((r) => r.type === 'top');
    const backoffs = main.rows.filter((r) => r.type === 'backoff');
    const warmups = main.rows.filter((r) => r.type === 'warmup');
    // Before the fix: top 60 × 6, back-offs 52.5 × 8 (the rule planned from the 60 kg rows).
    expect(top?.load ?? 0).toBeGreaterThanOrEqual(92.5);
    expect(backoffs.length).toBeGreaterThan(0);
    for (const b of backoffs) expect(b.load ?? 0).toBeGreaterThanOrEqual(87.5);
    expect(warmups.length).toBeGreaterThan(0);
    for (const w of warmups) expect(w.load ?? 0).toBeLessThan(top?.load ?? 0);
    expect(main.source).toBe('calc');
    // Why this weight? names the estimate from his own sets.
    const why = await s.builder.whyWeight(snap.draftId, main.key);
    // Review S5: an estimate, labelled as one (rule 6), from the est. max of his own sets at the top set's reps.
    expect(why[0]).toMatch(/^Est\. max \d+ kg \(estimate\) · 6 reps · RIR 2$/);
  });

  it('review B1: the builder’s own format, top 100 × 6 @ 8 + back-offs 95 × 8 → next Pull day top 102.5 × 6, back-offs never below 95; Why? names last time', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // Earlier plain rows, so the first built workout has a load (and an item) to log against.
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 90, reps: 6, rpe: 8 }, { load: 90, reps: 6, rpe: 8 }, { load: 90, reps: 6, rpe: 8 }] }]);
    h.clockMs += 4 * DAY;
    await doRows(s, gymId, await buildPull(s, 'build-1'), 'start-1', { load: 100, reps: 6, rpe: 8 }, { load: 95, reps: 8 });
    h.clockMs += 3 * DAY;
    const snap = await buildPull(s, 'build-2');
    const main = mainOf(snap);
    expect(main.source).toBe('rule');
    expect(main.rows.find((r) => r.type === 'top')?.load).toBe(102.5);
    const backoffs = main.rows.filter((r) => r.type === 'backoff');
    expect(backoffs.length).toBeGreaterThan(0);
    // Before the fix: 87.5 × 8 (derived at the rule's 3-rep floor).
    for (const b of backoffs) expect(b.load ?? 0).toBeGreaterThanOrEqual(95);
    expect((await s.builder.whyWeight(snap.draftId, main.key))[0]).toBe('Last time + 2.5');
  });
});

describe('Ben’s shrugs (21 Oct 19:15): a new workout’s reps come from his last session of the exercise', () => {
  it('an isolation done at 15 reps last time (lateral raise, 3 × 10 kg each × 15, standing in for the shrugs) → the builder plans 12–15 reps (not 8) at 10 kg or more, and Why? says last time 15', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const done = await logWorkout(h, s, gymId, [{ exercise: 'Lateral raise', sets: [{ load: 10, reps: 15 }, { load: 10, reps: 15 }, { load: 10, reps: 15 }] }]);
    const raiseId = (await s.workout.load(done))?.aggregate.exercises[0]?.exerciseId;
    if (raiseId === undefined) throw new Error('no lateral raise');
    h.clockMs += 3 * DAY;
    let snap = await buildPull(s, 'build-shrug');
    let slot = slotsOf(snap.workout.blocks).find((x) => x.exerciseId === raiseId);
    if (slot === undefined) {
      snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: raiseId }, { opId: 'add-raise', basis: { version: snap.version } })).snapshot;
      slot = slotsOf(snap.workout.blocks).find((x) => x.exerciseId === raiseId);
    }
    if (slot === undefined) throw new Error('no lateral raise slot');
    const work = slot.rows.filter((r) => r.type !== 'warmup');
    expect(work.length).toBeGreaterThan(0);
    // Before the fix: 8 reps (the builder's 8–12 floor).
    for (const r of work) {
      expect(r.reps).toBeGreaterThanOrEqual(12);
      expect(r.reps).toBeLessThanOrEqual(15);
      expect(r.load ?? 0).toBeGreaterThanOrEqual(10);
    }
    expect(await s.builder.whyWeight(snap.draftId, slot.key)).toContain('Reps: last time 15');
  });
});
