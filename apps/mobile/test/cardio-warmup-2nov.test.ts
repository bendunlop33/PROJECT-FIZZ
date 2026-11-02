import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days") Cardio first, end to
 * end on real SQLite: Profile › Training › Cardio first stores the rule (versioned, stale refused); a leg day built in
 * Your workout and started gets the bike first (8:00, a normal timed cardio set), a push day the rower (4:00); Your
 * workout's estimate counts it; it survives a force-close and logs with the cardio timer; it never counts as a working
 * set for muscles. A repeat of a workout that had it doesn't get a second one.
 */

const DAY = 86_400_000;
const BIKE = catalogueExerciseId('exercise-bike');
const ROWER = catalogueExerciseId('rowing-erg');
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-11-02T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

async function ben(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8, rpe: 8 }, { load: 80, reps: 8, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 90, reps: 5, rpe: 8 }, { load: 90, reps: 5, rpe: 8 }, { load: 90, reps: 5, rpe: 8 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 11, rpe: 8 }, { load: 25, reps: 11, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId };
}

async function setRule(s: AppServices): Promise<void> {
  const v = await s.warmupPrefs.view();
  if (v === null) throw new Error('no view');
  expect(v.generalLine).toBe('Off');
  const options = await s.warmupPrefs.cardioOptions();
  expect(options.map((o) => o.id)).toEqual(expect.arrayContaining([BIKE, ROWER]));
  const rules = [
    { days: 'legs' as const, exerciseId: BIKE, minutes: 8 },
    { days: 'other' as const, exerciseId: ROWER, minutes: 4 },
  ];
  // A stale version is refused and changes nothing (rule 5).
  expect(await s.warmupPrefs.setGeneral(rules, v.version + 3, h.ids())).toMatchObject({ ok: false, reason: 'stale' });
  // A non-cardio exercise is refused.
  expect(await s.warmupPrefs.setGeneral([{ days: 'legs', exerciseId: catalogueExerciseId('barbell-back-squat'), minutes: 8 }], v.version, h.ids())).toMatchObject({ ok: false });
  const r = await s.warmupPrefs.setGeneral(rules, v.version, h.ids());
  if (!r.ok) throw new Error(r.reason);
  expect(r.view.generalLine).toBe('Leg days · Exercise bike 8 min · Other days · Rowing machine 4 min');
}

/** Build the day in Your workout (60 min) and start it. */
async function buildAndStart(s: AppServices, gymId: string, dayId: 'legs' | 'push', op: string): Promise<{ snap: BuilderSnapshot; a: SessionAggregate }> {
  const setup = await s.builder.initialSetup({ dayId });
  const snap: BuilderSnapshot = ok(await s.builder.create({ ...setup, minutes: 60, supersets: false }, `create-${op}`)).snapshot;
  expect(slotsOf(snap.workout.blocks).length).toBeGreaterThan(0);
  const st = await s.builder.start(snap.draftId, { opId: `start-${op}`, expectedVersion: snap.version, gymId });
  if (!st.ok) throw new Error(`not started: ${JSON.stringify(st)}`);
  const a = (await s.workout.load(st.sessionId))?.aggregate;
  if (a === undefined) throw new Error('no session');
  return { snap, a };
}

const ordered = (a: SessionAggregate) => [...a.exercises].filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);
const setsOf = (a: SessionAggregate, sessionExerciseId: string) => a.sets.filter((x) => x.sessionExerciseId === sessionExerciseId && x.status !== 'deleted');

async function finish(s: AppServices, sessionId: string): Promise<void> {
  let data = await s.workout.load(sessionId);
  for (const ex of data?.aggregate.exercises ?? []) {
    if (!(data?.aggregate.sets ?? []).some((x) => x.sessionExerciseId === ex.id && x.status === 'pending')) continue;
    const skip = await s.workout.dispatch(sessionId, { type: 'skip_exercise', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id });
    if (!skip.ok) throw new Error(skip.error.message);
  }
  data = await s.workout.load(sessionId);
  h.clockMs += 60_000;
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

describe('Cardio first (Ben, 2 Nov)', () => {
  it('leg day: the bike first for 8:00; push day: the rower for 4:00; both counted in Your workout’s minutes', async () => {
    const { s, gymId } = await ben();
    // Before the rule: Your workout's leg day, for the estimate's comparison.
    const before = ok(await s.builder.create({ ...(await s.builder.initialSetup({ dayId: 'legs' })), minutes: 180, supersets: false }, 'create-before')).snapshot;
    await setRule(s);
    // Your workout's minutes at a long length (nothing cut): about 9 more (8 min + a changeover) than before the rule.
    // The same draft read again: its rows unchanged, its minutes with the bike.
    const after = await s.builder.read(before.draftId);
    if (after === null) throw new Error('no draft');
    expect(slotsOf(after.workout.blocks).map((x) => x.exerciseId)).toEqual(slotsOf(before.workout.blocks).map((x) => x.exerciseId));
    expect(after.minutes - before.minutes).toBeGreaterThanOrEqual(8);
    expect(after.minutes - before.minutes).toBeLessThanOrEqual(10);

    const legs = await buildAndStart(s, gymId, 'legs', 'legs');
    const first = ordered(legs.a)[0];
    expect(first?.exerciseId).toBe(BIKE);
    expect(first?.measurement).toBe('cardio');
    const bikeSets = setsOf(legs.a, first?.id ?? '');
    expect(bikeSets.map((x) => [x.setType, x.status, x.planned.durationS, x.planned.reps, x.planned.load])).toEqual([['working', 'pending', 480, null, null]]);
    expect(legs.a.session.activeSetId).toBe(bikeSets[0]?.id);
    // The leg lifts follow, as built; no second cardio row.
    expect(ordered(legs.a).slice(1).every((e) => e.measurement !== 'cardio')).toBe(true);
    expect(ordered(legs.a).length).toBe(slotsOf(legs.snap.workout.blocks).length + 1);

    // Log the bike with the cardio timer's values, then force-close: it's still first and logged.
    h.clockMs += 8 * 60_000;
    const logged = await s.workout.dispatch(legs.a.session.id, { type: 'log_set', at: h.now(), opId: h.ids(), setId: bikeSets[0]?.id ?? '', values: { load: null, reps: null, durationS: 480, distanceM: 3200, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = (await s2.workout.load(legs.a.session.id))?.aggregate;
    if (again === undefined) throw new Error('lost');
    expect(ordered(again)[0]?.exerciseId).toBe(BIKE);
    expect(setsOf(again, ordered(again)[0]?.id ?? '')[0]?.actual).toMatchObject({ durationS: 480, distanceM: 3200 });
    await finish(s2, legs.a.session.id);

    // Push day: the rower, 4 minutes.
    h.clockMs += DAY;
    const push = await buildAndStart(s2, gymId, 'push', 'push');
    const head = ordered(push.a)[0];
    expect(head?.exerciseId).toBe(ROWER);
    expect(setsOf(push.a, head?.id ?? '').map((x) => x.planned.durationS)).toEqual([240]);
    expect(ordered(push.a).filter((e) => e.exerciseId === BIKE)).toEqual([]);
  });

  it('a repeat of a workout that started with it gets no second one; a removed rule adds nothing; empty workouts get none', async () => {
    const { s, gymId } = await ben();
    await setRule(s);
    const legs = await buildAndStart(s, gymId, 'legs', 'legs-r');
    // The bike and the first lift's first working set logged (a repeat copies logged sets).
    const [bike, lift] = ordered(legs.a);
    for (const ex of [bike, lift]) {
      const set = setsOf(legs.a, ex?.id ?? '').find((x) => x.setType !== 'warmup');
      if (set === undefined || ex === undefined) throw new Error('no set');
      h.clockMs += 60_000;
      const values = ex.measurement === 'cardio' ? { load: null, reps: null, durationS: 480, distanceM: null, rpe: null, rir: null } : { load: set.planned.load, reps: set.planned.reps?.min ?? 5, durationS: null, rpe: 8, rir: null };
      const r = await s.workout.dispatch(legs.a.session.id, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    await finish(s, legs.a.session.id);
    h.clockMs += DAY;
    // Repeat: the source starts with the bike, so the copy has exactly one bike, first.
    const rep = await s.workout.start({ gymId, opId: 'repeat-legs', checkIn: null, repeatOf: legs.a.session.id });
    if (!rep.ok) throw new Error(rep.error.message);
    // (A skipped bike has no logged sets to repeat; whichever rows the repeat copies, there is never a second cardio row first.)
    const rows = ordered(rep.aggregate);
    expect(rows.filter((e) => e.exerciseId === BIKE).length).toBeLessThanOrEqual(1);
    expect(rows[0]?.exerciseId).toBe(BIKE);
    await finish(s, rep.aggregate.session.id);

    // An empty workout (no strength work to read): nothing added.
    h.clockMs += DAY;
    const empty = await s.workout.start({ gymId, opId: 'empty', checkIn: null });
    if (!empty.ok) throw new Error(empty.error.message);
    expect(empty.aggregate.exercises).toEqual([]);
    await finish(s, empty.aggregate.session.id);

    // Rule off: the next leg day starts with the squat side again.
    const v = await s.warmupPrefs.view();
    const off = await s.warmupPrefs.setGeneral(null, v?.version ?? 0, h.ids());
    if (!off.ok) throw new Error(off.reason);
    expect(off.view.generalLine).toBe('Off');
    h.clockMs += DAY;
    const plain = await buildAndStart(s, gymId, 'legs', 'legs-off');
    expect(ordered(plain.a).some((e) => e.measurement === 'cardio')).toBe(false);
  });
});
