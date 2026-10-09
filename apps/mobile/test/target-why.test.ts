import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, type TargetExplanation } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * `Why?` on a set target (active-workout §2.12) through the services, on
 * real SQLite: the provenance is written with the target, survives a
 * force-close, is read without running the rule or writing anything, and
 * says when its basis was edited since (checks 38, 39, 42, 43).
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string) => s.replaceAll(NBSP, ' ');
const rowsOf = (e: TargetExplanation | null) => (e?.rows ?? []).map((r) => [r.label, ...r.lines.map(plain)]);
type Services = Awaited<ReturnType<Harness['launch']>>['services'];

async function addBench(s: Services, gymId: string, opId = h.ids()) {
  const started = await s.workout.start({ gymId, opId: `start-${String(h.clockMs)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const bench = (await s.workout.pickerExercises(sessionId, 'bench')).find((p) => p.exercise.name === 'Bench press');
  const r = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId });
  if (!r.ok) throw new Error(r.error.message);
  return { sessionId, aggregate: r.aggregate, bench };
}

describe('Why? through the services', () => {
  it('explains a built-in target with what it was made from, and the same after a force-close', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 2 * 86_400_000;
    const { sessionId, aggregate } = await addBench(s, gymId);
    const setId = aggregate.sets[0]?.id ?? '';
    expect(aggregate.sets[0]?.planned.provenance?.source).toBe('rule');

    const e = await s.workout.explainTarget(sessionId, setId);
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Built-in rule · after your 8 Oct workout', 'Double progression, 3–6 reps up to RPE 8.5 (built-in default for a main barbell lift, provisional)'],
      ['Last time', '100 kg × 6, 6, 6', 'RPE 8, 8, 8', '8 Oct · Main Gym · Barbell and plates'],
      ['Reason', 'Increase to 102.5 kg for 3–6 reps.', 'Last session: every counted set reached 6+ reps at 100 kg.'],
      ['Equipment', '+2.5 kg (+2.5%), the smallest step on this bar.'],
    ]);
    // A read: nothing about the workout changes.
    expect((await s.workout.load(sessionId))?.aggregate.revision).toBe(aggregate.revision);

    // Force-close and relaunch: the stored provenance reads the same (restart recovery).
    await h.forceClose();
    const { services: again } = await h.launch();
    expect(await again.workout.explainTarget(sessionId, setId)).toEqual(e);
  });

  it('a retried add (same operation ID) keeps the first provenance; it is never rewritten', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const opId = h.ids();
    const first = await addBench(s, gymId, opId);
    h.clockMs += 60_000;
    const retry = await s.workout.addExercise({ sessionId: first.sessionId, exerciseId: first.bench?.exercise.id ?? '', equipmentId: first.bench?.equipment[0]?.id ?? null, opId });
    expect(retry.ok && retry.duplicate).toBe(true);
    if (!retry.ok) return;
    expect(retry.aggregate.sets.length).toBe(first.aggregate.sets.length);
    expect(retry.aggregate.sets.map((x) => x.planned.provenance)).toEqual(first.aggregate.sets.map((x) => x.planned.provenance));
  });

  it('after the basis is corrected: says so, keeps the values the target used, and the target doesn’t change by itself (check 42)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const basisId = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 2 * 86_400_000;
    const { sessionId, aggregate } = await addBench(s, gymId);
    const setId = aggregate.sets[0]?.id ?? '';

    h.clockMs += 86_400_000;
    const basis = (await s.workout.load(basisId))?.aggregate;
    const second = basis?.sets.filter((x) => x.status === 'completed')[1];
    const fixed = await s.workout.dispatch(basisId, { type: 'correct_set', at: h.now(), opId: h.ids(), setId: second?.id ?? '', expectedSetVersion: second?.version ?? 0, patch: { reps: 4 } });
    expect(fixed.ok).toBe(true);

    const e = await s.workout.explainTarget(sessionId, setId);
    expect(plain(e?.basisEdited ?? '')).toBe('Based on 8 Oct before you edited it on 11 Oct.');
    expect(rowsOf(e)[1]).toEqual(['Last time', '100 kg × 6, 6, 6', 'RPE 8, 8, 8', '8 Oct · Main Gym · Barbell and plates']);
    expect((await s.workout.load(sessionId))?.aggregate.sets.map((x) => x.planned.load?.value)).toEqual([102.5, 102.5, 102.5]);
  });

  it('pain: the flag and the sets before it show; a cleared flag keeps Before flag only', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 105, reps: 5, rpe: 9 })) }]);
    h.clockMs += 86_400_000;
    // Pain flagged from a check-in on the next day.
    const ci = await s.checkIns.record({ checkInId: h.ids(), opId: h.ids(), score: 2 });
    if (!ci.ok) throw new Error('check-in');
    const benchId = (await s.workout.recentExerciseIds())[0] ?? '';
    const flagged = await s.pain.flagFromCheckIn({ checkIn: ci.checkIn, exercises: [{ id: benchId, name: 'Bench press' }], area: 'shoulder', opId: h.ids() });
    expect(flagged.ok).toBe(true);
    h.clockMs += 86_400_000;
    const { sessionId, aggregate } = await addBench(s, gymId);
    const setId = aggregate.sets[0]?.id ?? '';
    const on = await s.workout.explainTarget(sessionId, setId);
    expect(rowsOf(on).filter((r) => r[0] === 'Pain' || r[0] === 'Before flag')).toEqual([
      ['Pain', 'Flag on since 9 Oct (shoulder). Loads, reps and sets can’t go up.'],
      ['Before flag', '105 kg × 5, 5, 5 · 8 Oct'],
    ]);
    expect(rowsOf(on)[2]?.[1]).toMatch(/^Progression for Bench press is paused because pain was reported/);

    await s.pain.clear(flagged.ok ? (flagged.flagIds ?? []) : []);
    const off = await s.workout.explainTarget(sessionId, setId);
    expect(rowsOf(off).map((r) => r[0])).toEqual(['Set by', 'Last time', 'Reason', 'Before flag']);
  });

  it('a set with no target, or an unknown set: nothing to explain', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, aggregate } = await addBench(s, gymId);
    expect(aggregate.sets[0]?.planned.load).toBeNull();
    expect(await s.workout.explainTarget(sessionId, aggregate.sets[0]?.id ?? '')).toBeNull();
    expect(await s.workout.explainTarget(sessionId, h.ids())).toBeNull();
    expect(await s.workout.explainTarget(h.ids(), aggregate.sets[0]?.id ?? '')).toBeNull();
  });
});
