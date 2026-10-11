import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review workout-loop S3 (PM: prefill, labelled): the Summary's Next time is
 * what the next workout plans when that exercise is added.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

async function addBench(s: Awaited<ReturnType<Harness['launch']>>['services'], gymId: string, checkIn: Parameters<typeof s.workout.start>[0]['checkIn']) {
  const started = await s.workout.start({ gymId, opId: `start-${String(h.clockMs)}`, checkIn });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const bench = (await s.workout.pickerExercises(sessionId, 'bench')).find((p) => p.exercise.name === 'Bench press');
  const r = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: h.ids() });
  if (!r.ok) throw new Error(r.error.message);
  return { sessionId, aggregate: r.aggregate };
}

describe('Next time prefills the next workout', () => {
  it('plans the sets and load the Summary showed, labelled as the built-in rule', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    const sum = await s.workout.summary(first);
    expect(sum?.nextTime?.rows.map((r) => [r.decision, plain(r.target), r.ruleName])).toEqual([
      ['increase_load', 'Target 102.5 kg × 3–6', 'Double progression, 3–6 reps up to RPE 8.5 (built-in default for a main barbell lift, provisional)'],
    ]);

    h.clockMs += 2 * 86_400_000;
    const { sessionId, aggregate } = await addBench(s, gymId, null);
    expect(aggregate.sets.map((x) => [x.planned.load?.value, x.planned.reps, x.planned.source])).toEqual([1, 2, 3].map(() => [102.5, { min: 3, max: 6 }, 'built_in_rule']));
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('no data');
    const v = s.workout.view(data, h.clockMs, null);
    expect(plain(v.focus?.target)).toBe('Target 102.5 kg · 3–6 reps');
    expect(plain(v.primary.label)).toBe('Log 102.5 kg × 6');
  });

  it('pain mentioned with no movement holds every increase for that workout and the next one it planned', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    // Today's check-in says pain, no movement chosen: the bench added today isn't increased.
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error('check-in');
    const upd = await s.checkIns.update(ci.checkIn.id, { reasons: ['pain'] }, ci.checkIn.version, h.ids());
    expect(upd.ok).toBe(true);
    const { aggregate } = await addBench(s, gymId, { kind: 'answered', checkInId: ci.checkIn.id });
    expect(aggregate.sets.map((x) => x.planned.load?.value)).toEqual([100, 100, 100]);
  });
});
