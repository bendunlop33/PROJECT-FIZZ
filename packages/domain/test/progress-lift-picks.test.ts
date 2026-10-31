import { describe, expect, it } from 'vitest';

import { defaultLiftPicks, isMainCompound, LIFT_PICKS, liftChips, liftsTabSelection, type LiftPickInfo, type ProgressSession } from '../src/index';

/**
 * Progress › Lifts opens on Ben's main lifts (Ben, 26 Oct 2026): the plan's main lift per day when a plan
 * is in use, else his most-trained main compounds (bench, squat, deadlift, row, overhead press), else his
 * most recent exercises; his last pick on this phone wins while it still has history.
 */

const TODAY = '2026-10-26';
const INFO: Record<string, LiftPickInfo> = {
  bench: { movementPattern: 'horizontal_push', mechanic: 'compound' },
  dbBench: { movementPattern: 'horizontal_push', mechanic: 'compound' },
  squat: { movementPattern: 'squat', mechanic: 'compound' },
  deadlift: { movementPattern: 'hinge', mechanic: 'compound' },
  row: { movementPattern: 'horizontal_pull', mechanic: 'compound' },
  ohp: { movementPattern: 'vertical_push', mechanic: 'compound' },
  pulldown: { movementPattern: 'vertical_pull', mechanic: 'compound' },
  curl: { movementPattern: 'arms', mechanic: 'isolation' },
  lateral: { movementPattern: 'vertical_push', mechanic: 'isolation' },
  // A custom exercise with no mechanic: its pattern decides.
  myPress: { movementPattern: 'vertical_push' },
};
const info = (id: string): LiftPickInfo | null => INFO[id] ?? null;

/** One workout on `date` with `n` working sets (and a warm-up, which never counts) of each exercise. */
function workout(date: string, ids: readonly string[], n = 3): Pick<ProgressSession, 'date' | 'startedMs' | 'exercises'> {
  const set = (i: number, warm = false) => ({ setId: `s${String(i)}`, setType: warm ? ('warmup' as const) : ('working' as const), side: null, load: null, reps: 5, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: i });
  return {
    date,
    startedMs: Date.parse(`${date}T17:00:00.000Z`),
    exercises: ids.map((id) => ({ sessionExerciseId: `${date}-${id}`, exerciseId: id, exerciseName: id, equipmentId: null, equipmentKind: null, gymId: null, convention: 'total' as const, unit: 'kg' as const, measurement: 'reps' as const, laterality: 'bilateral' as const, sets: [set(0, true), ...Array.from({ length: n }, (_, i) => set(i + 1))] })),
  };
}

describe('defaultLiftPicks', () => {
  const history = [
    workout('2026-10-01', ['bench', 'ohp', 'curl']),
    workout('2026-10-03', ['squat', 'deadlift']),
    workout('2026-10-05', ['row', 'pulldown', 'curl']),
    workout('2026-10-08', ['bench', 'dbBench', 'lateral']),
    workout('2026-10-10', ['squat']),
    workout('2026-10-12', ['row', 'curl']),
    workout('2026-10-15', ['bench', 'ohp']),
    workout('2026-10-17', ['squat', 'deadlift']),
  ];

  it('with a plan: the plan’s main lift per day, in day order, duplicates once; lifts never logged are left out', () => {
    const p = defaultLiftPicks({ planMains: ['squat', 'bench', 'row', 'bench', 'ohp', 'frontSquat'], sessions: history, info, today: TODAY });
    expect(p).toEqual({ ids: ['squat', 'bench', 'row', 'ohp'], source: 'plan' });
  });

  it('a plan whose main lifts have no history yet falls back to his compounds', () => {
    expect(defaultLiftPicks({ planMains: ['frontSquat'], sessions: history, info, today: TODAY }).source).toBe('history');
  });

  it('without a plan: one main compound per pattern, most-trained first, ties in bench, squat, deadlift, row, press order', () => {
    const p = defaultLiftPicks({ planMains: null, sessions: history, info, today: TODAY });
    // Bench and squat 3 sessions each, deadlift, row and OHP 2 each, same sets: pattern order breaks the ties.
    expect(p).toEqual({ ids: ['bench', 'squat', 'deadlift', 'row', 'ohp'], source: 'history' });
    // Isolations, the pulldown (not a main pattern) and the second horizontal press never show.
    expect(p.ids).not.toContain('curl');
    expect(p.ids).not.toContain('lateral');
    expect(p.ids).not.toContain('pulldown');
    expect(p.ids).not.toContain('dbBench');
  });

  it('ranks by recent sessions, then working sets (warm-ups excluded)', () => {
    const p = defaultLiftPicks({ planMains: null, sessions: [workout('2026-10-20', ['ohp'], 5), workout('2026-10-21', ['bench'], 2), workout('2026-10-22', ['row', 'ohp'])], info, today: TODAY });
    expect(p.ids).toEqual(['ohp', 'row', 'bench']);
  });

  it('within a pattern the more-trained exercise is the pick (dumbbell bench over barbell bench when it is done more)', () => {
    const p = defaultLiftPicks({ planMains: null, sessions: [workout('2026-10-20', ['dbBench']), workout('2026-10-22', ['dbBench', 'bench'])], info, today: TODAY });
    expect(p.ids).toEqual(['dbBench']);
  });

  it('only the last 12 weeks count while any compound is that recent; old history decides when nothing is', () => {
    const old = Array.from({ length: 10 }, (_, i) => workout(`2026-0${String(1 + (i % 5))}-1${String(i % 9)}`, ['squat']));
    const p = defaultLiftPicks({ planMains: null, sessions: [...old, workout('2026-10-20', ['bench'])], info, today: TODAY });
    expect(p.ids).toEqual(['bench']);
    expect(defaultLiftPicks({ planMains: null, sessions: old, info, today: TODAY }).ids).toEqual(['squat']);
  });

  it('a custom exercise with no mechanic counts by its pattern', () => {
    expect(isMainCompound({ movementPattern: 'vertical_push' })).toBe(true);
    expect(isMainCompound({ movementPattern: 'vertical_push', mechanic: 'isolation' })).toBe(false);
    expect(isMainCompound(null)).toBe(false);
    expect(defaultLiftPicks({ planMains: null, sessions: [workout('2026-10-20', ['myPress'])], info, today: TODAY }).ids).toEqual(['myPress']);
  });

  it('no compound logged: the most recent exercises; nothing logged: none', () => {
    const p = defaultLiftPicks({ planMains: null, sessions: [workout('2026-10-20', ['curl']), workout('2026-10-22', ['lateral'])], info, today: TODAY });
    expect(p).toEqual({ ids: ['lateral', 'curl'], source: 'recent' });
    expect(defaultLiftPicks({ planMains: ['bench'], sessions: [], info, today: TODAY })).toEqual({ ids: [], source: 'none' });
  });

  it('at most six chips', () => {
    const many = ['bench', 'squat', 'deadlift', 'row', 'ohp', 'pulldown', 'curl'];
    expect(defaultLiftPicks({ planMains: many, sessions: [workout('2026-10-20', many)], info, today: TODAY }).ids).toHaveLength(LIFT_PICKS.max);
  });
});

describe('liftsTabSelection and liftChips', () => {
  const logged = (id: string) => ['bench', 'squat', 'row'].includes(id);

  it('opens on the lift asked for, else the remembered pick while it has history, else the first chip', () => {
    expect(liftsTabSelection({ requested: 'row', remembered: 'squat', picks: ['bench'], logged })).toBe('row');
    expect(liftsTabSelection({ requested: null, remembered: 'squat', picks: ['bench'], logged })).toBe('squat');
    expect(liftsTabSelection({ requested: null, remembered: 'deleted', picks: ['bench'], logged })).toBe('bench');
    expect(liftsTabSelection({ requested: null, remembered: null, picks: [], logged })).toBeNull();
  });

  it('chips keep the picks’ order; a lift opened from elsewhere leads, selected', () => {
    const name = (id: string) => id.toUpperCase();
    expect(liftChips(['bench', 'squat'], 'squat', name)).toEqual([
      { exerciseId: 'bench', label: 'BENCH', selected: false },
      { exerciseId: 'squat', label: 'SQUAT', selected: true },
    ]);
    expect(liftChips(['bench', 'squat'], 'curl', name).map((c) => [c.exerciseId, c.selected])).toEqual([
      ['curl', true],
      ['bench', false],
      ['squat', false],
    ]);
  });
});
