import { describe, expect, it } from 'vitest';
import type { SessionAggregate, TargetEarlierWork, TargetProvenance } from '@fizz/schemas';

import { workoutView } from '../src/context';
import { COACH_INSTRUCTIONS, WHY_RULE_LINE } from '../src/turn';

/**
 * SF7(b) (Ben, 15 Nov, build 568: "was the shoulder press factored into the bench reps?"): each exercise whose next
 * target is the built-in rule's carries one short SF fact (`earlierToday`) from the target's stored provenance, so
 * the coach can answer from facts. It's an answer when asked: the instructions still say not to explain rules he
 * didn't ask about.
 */

const SF: TargetEarlierWork = {
  p: 1.5,
  muscle: 'Chest',
  before: [{ name: 'Dumbbell shoulder press', sets: 3, direct: ['Shoulders'], secondary: ['Chest', 'Triceps'] }],
  reference: { sessionId: '00000000-0000-4000-8000-000000000001', performedAt: { utc: '2026-11-08T10:00:00.000Z', tz: 'Europe/London' }, p: 1.5, sameMuscleSuperset: false },
  basis: 'comparable',
};

async function fixture(): Promise<{ s: SessionAggregate; benchRowId: string }> {
  const { startFixture, BENCH } = await import('@fizz/domain/testing');
  const s = startFixture().state;
  const row = s.exercises.find((e) => e.exerciseId === BENCH);
  if (row === undefined) throw new Error('bench');
  const rule: TargetProvenance = { source: 'rule', setAt: s.session.startedAt, routineName: null, requestedLoad: null, basis: null, guardNotes: [], earlierWork: SF };
  return {
    benchRowId: row.id,
    s: { ...s, sets: s.sets.map((x) => (x.sessionExerciseId === row.id && x.setType !== 'warmup' ? { ...x, planned: { ...x.planned, source: 'built_in_rule' as const, provenance: rule } } : x)) },
  };
}

describe('coach context: the SF fact on the exercise’s target (SF7b)', () => {
  it('the bench row says what came before it, P, the reference and whether SF3 applied', async () => {
    const { s, benchRowId } = await fixture();
    const bench = workoutView(s, 'Main').exercises.find((e) => e.sessionExerciseId === benchRowId);
    expect(bench?.earlierToday).toBe('before: dumbbell shoulder press 3 (shoulders direct; chest, triceps secondary) · P 1.5 chest · ref 2026-11-08 P 1.5, like for like · no cushion');
    // Tiny: one line per exercise.
    expect(bench?.earlierToday?.length).toBeLessThan(160);
  });

  it('no fact on rows whose targets SF didn’t read, nor once its sets are done', async () => {
    const { s, benchRowId } = await fixture();
    const others = workoutView(s, 'Main').exercises.filter((e) => e.sessionExerciseId !== benchRowId);
    expect(others.every((e) => e.earlierToday === undefined)).toBe(true);
    const done = { ...s, sets: s.sets.map((x) => (x.sessionExerciseId === benchRowId ? { ...x, status: 'completed' as const } : x)) };
    expect(workoutView(done, 'Main').exercises.find((e) => e.sessionExerciseId === benchRowId)?.earlierToday).toBeUndefined();
  });

  it('a coach target never carries the rule’s SF fact', async () => {
    const { s, benchRowId } = await fixture();
    const coach = { ...s, sets: s.sets.map((x) => (x.sessionExerciseId === benchRowId && x.planned.provenance ? { ...x, planned: { ...x.planned, provenance: { ...x.planned.provenance, source: 'coach' as const } } } : x)) };
    expect(workoutView(coach, 'Main').exercises.find((e) => e.sessionExerciseId === benchRowId)?.earlierToday).toBeUndefined();
  });

  it('the coach answers rules when asked and doesn’t explain ones he didn’t ask about (Ben, 15 Nov)', () => {
    expect(WHY_RULE_LINE).toContain('When Ben asks why');
    expect(WHY_RULE_LINE).toContain('Don’t explain rules he didn’t ask about.');
    expect(COACH_INSTRUCTIONS).toContain(WHY_RULE_LINE);
  });
});
