import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * SF7(b) (Ben, 15 Nov, build 568, live Push B): dumbbell shoulder press before bench. Real SQLite and the shipped
 * catalogue: bench's built-in target records the shoulder press before it (chest worked as a secondary: P 1.5), the
 * like-for-like reference and no SF3; `Why?` shows it in one line; the coach's context carries the same fact so "was
 * the shoulder press factored in?" gets a factual answer.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-15T10:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const PRESS = 'Dumbbell shoulder press';
const BENCH = 'Bench press';

async function add(s: AppServices, sessionId: string, name: string): Promise<SessionAggregate> {
  const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
  if (!pick) throw new Error(name);
  const r = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
}

const benchSets = (a: SessionAggregate) => {
  const row = a.exercises.find((e) => e.exerciseName === BENCH);
  return a.sets.filter((x) => x.sessionExerciseId === row?.id && x.setType !== 'warmup' && x.status !== 'deleted').sort((x, y) => x.index - y.index);
};

async function pushBToday(): Promise<{ s: AppServices; sessionId: string; a: SessionAggregate }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  // Last Push B: the press first, then bench 100 × 6, 6, 6.
  await logWorkout(h, s, gymId, [
    { exercise: PRESS, sets: [1, 2, 3].map(() => ({ load: 22, reps: 10, rpe: 8 })) },
    { exercise: BENCH, sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) },
  ]);
  h.clockMs += 7 * DAY;
  const started = await s.workout.start({ gymId, opId: 'push-b-2', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error('start');
  const sessionId = started.aggregate.session.id;
  await add(s, sessionId, PRESS);
  const a = await add(s, sessionId, BENCH);
  return { s, sessionId, a };
}

describe('Ben’s Push B: was the shoulder press factored into bench?', () => {
  it('bench’s target records the press before it (P 1.5 chest), the like-for-like Push B and no SF3', async () => {
    const { a } = await pushBToday();
    const sets = benchSets(a);
    expect(sets.length).toBeGreaterThan(0);
    const ew = sets[0]?.planned.provenance?.earlierWork;
    expect(ew).toMatchObject({ p: 1.5, muscle: 'Chest', basis: 'comparable', reference: { p: 1.5 } });
    expect(ew?.before).toEqual([{ name: PRESS, sets: 3, direct: ['Shoulders'], secondary: ['Chest', 'Triceps'] }]);
    expect(ew?.cushion).toBeUndefined();
    expect(sets.every((x) => x.planned.provenance?.estimate !== true)).toBe(true);
  });

  it('Why? shows it in one line', async () => {
    const { s, sessionId, a } = await pushBToday();
    const why = await s.workout.explainTarget(sessionId, benchSets(a)[0]?.id ?? '');
    const row = why?.rows.find((r) => r.key === 'earlier_today');
    expect(row?.label).toBe('Earlier today');
    expect(row?.lines.map((l) => l.replaceAll(' ', ' '))).toEqual(['After dumbbell shoulder press ×3 · compared with 15 Nov (after 1.5 chest sets)']);
  });

  it('the coach’s context carries the fact on the bench row', async () => {
    const { s, sessionId } = await pushBToday();
    model = new StepModel([() => replyWith('Yes: bench is compared with last Push B, also after the press.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'Was the shoulder press factored into the bench reps?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const req = model.requests[0];
    if (req === undefined) throw new Error('no request');
    const bench = contextWorkout(req).exercises.find((e) => e.name === BENCH);
    expect(bench?.earlierToday).toMatch(/^before: dumbbell shoulder press 3 \(shoulders direct; chest, triceps secondary\) · P 1\.5 chest · ref 2026-11-15 P 1\.5, like for like · no cushion$/);
  });
});

describe('SF1 amended (Ben, 21 Nov): work on bench’s secondary movers counts at ½', () => {
  it('triceps pushdowns ×3 before bench: P 1.5 set by triceps as a secondary mover; Why? names it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // Last time bench came first.
    await logWorkout(h, s, gymId, [{ exercise: BENCH, sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 7 * DAY;
    const started = await s.workout.start({ gymId, opId: 'push-tri', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error('start');
    const sessionId = started.aggregate.session.id;
    await add(s, sessionId, 'Triceps pushdown');
    const a = await add(s, sessionId, BENCH);
    const first = benchSets(a)[0];
    expect(first?.planned.provenance?.earlierWork).toMatchObject({ p: 1.5, muscle: 'Triceps', muscleRole: 'secondary', basis: 'comparable', reference: { p: 0 } });
    const why = await s.workout.explainTarget(sessionId, first?.id ?? '');
    const row = why?.rows.find((r) => r.key === 'earlier_today');
    expect(row?.lines.map((l) => l.replaceAll('\u00a0', ' '))).toEqual(['After triceps pushdown ×3 · triceps · compared with 15 Nov (done first)']);
  });
});
