import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate, SetValues } from '@fizz/schemas';

import { buildAddExerciseCommand, buildWorkoutSummary, NBSP, startWorkout, toHistorySessions, type HistorySession } from '../src/index';
import { at, barbell, bodyweightStation, exercise, GYM, id, idGen, kg, ms, profile, TZ, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/**
 * (Ben, 21 Nov, build 576) Pull B · Pull-up: after 3 × 8 rows at 97.5 kg (his rows before: 95 × 10 at RIR 2) the
 * Summary's `Next time` read `97.5×8 → 100×3–6 kg`. Pull-ups are the plan day's main lift and aren't a barbell lift,
 * so the row was the first main barbell lift and took the main lift's 3–6. With a main lift named, the row is a
 * secondary lift: its reps follow his history.
 */
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const PULLUP = exercise(410, 'Pull-up', { movementPattern: 'vertical_pull', mechanic: 'compound', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const ROW = exercise(411, 'Barbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', family: 'row' });
const PLATES = [
  { mass: 25, count: 4 },
  { mass: 20, count: 2 },
  { mass: 10, count: 2 },
  { mass: 5, count: 2 },
  { mass: 2.5, count: 2 },
  { mass: 1.25, count: 2 },
];
const bar = barbell({ plates: PLATES, maxLoad: 200 });
const station = bodyweightStation();

function pullB(mainLift: string | null, rowReps = 8): SessionAggregate {
  const owner = profile();
  const ids = idGen(91_000);
  let s = startWorkout({ opId: 'pb-start', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [station, bar], at: at(0), newId: ids }).aggregate;
  const add = (ex: Exercise, eq: EquipmentInstance, n: number, k: number) => {
    s = apply(s, buildAddExerciseCommand({ opId: `pb-add-${String(k)}`, owner, exercise: ex, equipmentId: eq.id, at: at(k), newId: ids }));
    const sx = s.exercises.find((e) => e.exerciseId === ex.id)?.id ?? '';
    for (let i = 1; i < n; i += 1) s = apply(s, { type: 'add_set', at: at(k), opId: `pb-set-${String(k)}-${String(i)}`, sessionExerciseId: sx, newSetId: ids(), setType: null });
  };
  add(PULLUP, station, 3, 1);
  add(ROW, bar, 3, 2);
  if (mainLift !== null) {
    s = { ...s, session: { ...s.session, routineName: 'Pull B · Pull-up', planDay: { planId: id(9400), dayIndex: 1, splitDayId: 'pull_b', mainLiftExerciseId: mainLift, templateRoutineId: null, templateVersion: null, variationId: null } } };
  }
  const vals: SetValues[] = [values(kg(0, 'bodyweight'), 8, { rpe: 8 }), values(kg(0, 'bodyweight'), 8, { rpe: 8 }), values(kg(0, 'bodyweight'), 8, { rpe: 8.5 }), ...[0, 1, 2].map(() => values(kg(97.5), rowReps, { rpe: 8 }))];
  vals.forEach((v, i) => {
    const setId = s.session.activeSetId;
    if (setId === null) throw new Error('no active set');
    s = apply(s, logCmd(setId, v, 10 + i * 120, `pb-log-${String(i)}`));
  });
  return apply(s, { type: 'finish', at: at(900), opId: 'pb-fin', expectedVersion: s.session.version, endedAt: null });
}

/** His rows before: 95 × 10 at RIR 2 (RPE 8). */
const ROWS_95x10: HistorySession = {
  sessionId: id(9300),
  performedAtUtc: at(-5 * 86_400).utc,
  equipmentId: bar.id,
  gymId: GYM,
  imported: false,
  sets: [0, 1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(95), reps: 10, rpe: null, rir: 2 })),
  tz: TZ,
};

function rowNext(s: SessionAggregate) {
  const sum = buildWorkoutSummary({
    aggregate: s,
    nowMs: ms(1_000),
    gymName: 'Main Gym',
    history: { [ROW.id]: [ROWS_95x10, ...toHistorySessions(s, ROW.id)], [PULLUP.id]: toHistorySessions(s, PULLUP.id) },
    rules: {},
    painFlags: [],
    checkIn: null,
    coach: 'not_connected',
    exerciseInfo: { [ROW.id]: ROW, [PULLUP.id]: PULLUP },
  });
  return { row: sum.nextTime?.rows.find((r) => r.exerciseId === ROW.id) ?? null, emptyText: sum.nextTime?.emptyText ?? null };
}

describe('Pull B · Pull-up: next time for the barbell row after the main lift (Ben, 21 Nov)', () => {
  it('the plan day names pull-ups the main lift: 3 × 8 at 97.5 kg holds at 97.5 kg in his 6–10 (no 100 × 3–6 row)', () => {
    const { row, emptyText } = rowNext(pullB(PULLUP.id));
    expect(row).toBeNull();
    expect(emptyText).toBe('Same targets next time');
  });

  it('with the top of his range done (3 × 10), the load rises and the reps stay his (6–10), not 3–6', () => {
    const { row } = rowNext(pullB(PULLUP.id, 10));
    expect(row?.kind).toBe('change');
    expect(row?.to?.target.load?.value).toBe(100);
    expect(row?.to?.target.reps?.min).toBeGreaterThanOrEqual(6);
    expect(row?.to?.target.reps?.max).toBe(10);
    expect(row?.ruleName).not.toContain('3–6');
  });

  it('the row named as the main lift keeps the main barbell 3–6 scheme', () => {
    const { row } = rowNext(pullB(ROW.id));
    expect(plain(row?.target)).toContain('100 kg');
    expect(row?.to?.target.reps).toMatchObject({ min: 3, max: 6 });
  });

  it('no main lift named (an open workout): the first main barbell lift is still the main lift, as before', () => {
    const { row } = rowNext(pullB(null));
    expect(row?.to?.target.reps).toMatchObject({ min: 3, max: 6 });
  });
});
