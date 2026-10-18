import { describe, expect, it } from 'vitest';
import type { MuscleGroup, SessionAggregate, TrainingSplit } from '@fizz/schemas';

import {
  baseWorkoutName,
  buildDayFor,
  nextSplitDay,
  builtMinutes,
  cutShort,
  DEFAULT_SPLIT,
  isSplitDayName,
  preferFullSource,
  PRESET_SPLITS,
  splitDaySource,
  splitDaysByDue,
  splitDaysTrained,
  splitWorkoutOf,
  upNextSplitDay,
  type SplitWorkout,
} from '../src/index';
import { richFinishedSession, SPLIT_SQUAT } from './testing';

const g = (o: Partial<Record<MuscleGroup, number>>): Map<MuscleGroup, number> => new Map(Object.entries(o) as [MuscleGroup, number][]);
const w = (sessionId: string, date: string, groups: Partial<Record<MuscleGroup, number>>, short = false): SplitWorkout => ({ sessionId, startedAtUtc: `${date}T17:00:00.000Z`, groups: g(groups), short });

// Ben's week to 18 Oct 2026: Push 10 days ago (named), then coach-built and empty workouts.
const PUSH = { Chest: 6, Shoulders: 3, Triceps: 3 };
const BACK = { Back: 9, Biceps: 3 };
const LEGS = { Quads: 6, Hamstrings: 3, Glutes: 3 };

describe('Up next by split day (PM decision 18 Oct)', () => {
  it('Ben’s case: back trained yesterday in a coach workout named `Workout` → Up next is not Pull', () => {
    const history = [
      w('upper', '2026-10-06', { ...PUSH, ...BACK }),
      w('legs', '2026-10-07', LEGS),
      w('push', '2026-10-08', PUSH),
      w('pull-20', '2026-10-05', BACK, true),
      w('tue', '2026-10-13', PUSH),
      w('wed', '2026-10-14', LEGS),
      w('fri', '2026-10-16', PUSH),
      w('coach-back', '2026-10-17', BACK),
    ];
    const pick = upNextSplitDay(DEFAULT_SPLIT, history);
    expect(pick?.day.id).not.toBe('pull');
    // Legs (Wed) is the least recently trained of Push (Fri) and Legs.
    expect(pick?.day.id).toBe('legs');
    expect(pick?.lastTrainedUtc).toBe('2026-10-14T17:00:00.000Z');
    // Then Push: the order the service tries them in when a day has no plan.
    expect(splitDaysByDue(DEFAULT_SPLIT, history).map((d) => d.day.id)).toEqual(['legs', 'push']);
  });

  it('a day never trained in the window comes first; ties go to split order', () => {
    expect(upNextSplitDay(DEFAULT_SPLIT, [w('a', '2026-10-17', BACK)])?.day.id).toBe('push');
    expect(upNextSplitDay(DEFAULT_SPLIT, [w('a', '2026-10-17', PUSH)])?.day.id).toBe('pull');
    expect(upNextSplitDay(DEFAULT_SPLIT, [w('a', '2026-10-17', PUSH)])?.lastTrainedUtc).toBeNull();
  });

  it('never the last workout’s day unless it is the only one', () => {
    const one: TrainingSplit = { kind: 'custom', days: [{ id: 'full', name: 'Full body', bodyParts: ['Chest', 'Back', 'Quads'] }] };
    expect(upNextSplitDay(one, [w('a', '2026-10-17', PUSH)])?.day.id).toBe('full');
    // A full-body workout trains every day: the least recent of all is still chosen.
    const all = upNextSplitDay(DEFAULT_SPLIT, [w('old-legs', '2026-10-01', LEGS), w('full', '2026-10-17', { Chest: 4, Back: 4, Quads: 4 })]);
    expect(all?.day.id).toBe('push');
  });

  it('a workout that fits no day (core only) is skipped; with none that fits, null (the caller keeps its rules)', () => {
    expect(upNextSplitDay(DEFAULT_SPLIT, [w('core', '2026-10-17', { Core: 6 })])).toBeNull();
    expect(upNextSplitDay(DEFAULT_SPLIT, [])).toBeNull();
    expect(upNextSplitDay(DEFAULT_SPLIT, [w('push', '2026-10-16', PUSH), w('core', '2026-10-17', { Core: 6 })])?.day.id).toBe('pull');
  });

  it('a day counts as trained by its share of the workout: an upper-body day trains Push and Pull; a few face pulls don’t make Push', () => {
    expect(splitDaysTrained(DEFAULT_SPLIT, g({ ...PUSH, ...BACK }))).toEqual(['push', 'pull']);
    expect(splitDaysTrained(DEFAULT_SPLIT, g({ Back: 12, Biceps: 4, Shoulders: 3 }))).toEqual(['pull']);
    expect(splitDaysTrained(DEFAULT_SPLIT, g({ Core: 3 }))).toEqual([]);
    // Chest/Legs/Shoulders/Back: triceps sit in two days.
    expect(splitDaysTrained({ kind: 'clsb', days: [...PRESET_SPLITS.clsb] }, g({ Back: 9, Biceps: 3 }))).toEqual(['back']);
  });

  it('the source: newest workout mainly that day, a full one before a cut-short or short-built one', () => {
    const ws = [w('pull-20', '2026-10-10', BACK, true), w('pull-full', '2026-10-03', BACK), w('upper', '2026-10-12', { ...PUSH, ...BACK })];
    expect(splitDaySource(DEFAULT_SPLIT, { id: 'pull' }, ws)).toEqual({ sessionId: 'pull-full', primary: true });
    // Only short ones: the newest is still used (better than nothing).
    expect(splitDaySource(DEFAULT_SPLIT, { id: 'pull' }, [w('pull-20', '2026-10-10', BACK, true)])).toEqual({ sessionId: 'pull-20', primary: true });
    // Only a mixed day trained it: that one, not called by the day's name.
    expect(splitDaySource(DEFAULT_SPLIT, { id: 'pull' }, [w('upper', '2026-10-12', { Chest: 7, Back: 5 })])).toEqual({ sessionId: 'upper', primary: false });
    expect(splitDaySource(DEFAULT_SPLIT, { id: 'legs' }, ws)).toBeNull();
    expect(preferFullSource([w('a', '2026-10-10', BACK, true), w('b', '2026-10-01', BACK)])).toBe('b');
    expect(preferFullSource([w('a', '2026-10-10', BACK, true)])).toBe('a');
    expect(preferFullSource([])).toBeNull();
  });

  it('coach build names: the length comes off for naming and matching a day', () => {
    expect(builtMinutes('Pull · 20 min')).toBe(20);
    expect(builtMinutes('Pull')).toBeNull();
    expect(baseWorkoutName('Pull · 20 min')).toBe('Pull');
    expect(baseWorkoutName('Upper body')).toBe('Upper body');
    expect(isSplitDayName('pull · 45 min', 'Pull')).toBe(true);
    expect(isSplitDayName(' Pull ', 'Pull')).toBe(true);
    expect(isSplitDayName('Pull A', 'Pull')).toBe(false);
  });
});

describe('short sources (why a 20 min workout was up next)', () => {
  const base = richFinishedSession();
  const sx = base.exercises[0];
  if (sx === undefined) throw new Error('fixture');
  const template = base.sets.find((s) => s.status === 'completed' && s.pairedWithSetId === null);
  if (template === undefined) throw new Error('fixture');
  const withSets = (statuses: readonly ('completed' | 'skipped' | 'pending' | 'deleted')[], over: Partial<SessionAggregate['session']> = {}): SessionAggregate => ({
    ...base,
    session: { ...base.session, ...over },
    sets: statuses.map((status, i) => ({ ...template, id: `set-${String(i)}`, status, setType: 'working', pairedWithSetId: null })),
  });
  const quads = (id: string) => (id === SPLIT_SQUAT.id ? { primaryMuscles: ['quads'] } : null);

  it('a workout with a quarter or more of its working sets not done was cut short', () => {
    expect(cutShort(withSets(['completed', 'completed', 'completed', 'skipped']))).toBe(true);
    expect(cutShort(withSets(['completed', 'completed', 'completed', 'pending']))).toBe(true);
    expect(cutShort(withSets(['completed', 'completed', 'completed', 'completed', 'completed', 'skipped']))).toBe(false);
    // A deleted set was never part of the plan.
    expect(cutShort(withSets(['completed', 'deleted', 'deleted']))).toBe(false);
    expect(cutShort(withSets([]))).toBe(false);
  });

  it('a coach build shorter than Ben’s session length is short; with no length saved only cut-short counts', () => {
    const built = withSets(['completed', 'completed'], { coachDraft: { draftId: '00000000-0000-4000-8000-0000000000aa', version: 1, name: 'Pull · 20 min' } });
    expect(splitWorkoutOf(built, quads, 60).short).toBe(true);
    expect(splitWorkoutOf(built, quads, 20).short).toBe(false);
    expect(splitWorkoutOf(built, quads, null).short).toBe(false);
    // A routine Ben named with minutes isn't a coach build.
    expect(splitWorkoutOf(withSets(['completed'], { routineName: 'Quick · 20 min' }), quads, 60).short).toBe(false);
    const r = splitWorkoutOf(withSets(['completed', 'completed']), quads, 60);
    expect(r.groups.get('Quads')).toBe(2);
    expect(r.sessionId).toBe(base.session.id);
  });
});

describe('buildDayFor (review today-18oct S3)', () => {
  it('with no workout in the window, the day after the last one (as before)', () => {
    expect(buildDayFor(DEFAULT_SPLIT, [], () => null, '2026-10-18T08:00:00.000Z').id).toBe(nextSplitDay(DEFAULT_SPLIT, null).id);
  });
});
