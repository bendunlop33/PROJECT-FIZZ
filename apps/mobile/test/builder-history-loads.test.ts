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
  const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId, expectedVersion: snap.version, gymId });
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
    expect(why.length).toBeGreaterThan(0);
  });
});
