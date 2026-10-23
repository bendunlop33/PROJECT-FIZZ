import { describe, expect, it } from 'vitest';
import type { MuscleGroup, TrainingSplit } from '@fizz/schemas';

import { assembleTodayDraft, defaultTodayControls, PRESET_SPLITS, slotsOf, splitDayKey, splitDayMainOptions, todaySplitDays, todaySplitNext, todayWhy, type SplitWorkout } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * Today with no plan (workout-builder-v3 §2.0.4, D7): the day row from Profile › Split, each day drafted by the
 * builder rules like a plan day, with NEXT from the app's Up next resolver (else the split rule). Pure.
 */

const KEYS: Record<string, string> = { bench: 'barbell-bench-press', incline_bb: 'barbell-incline-bench-press', row: 'barbell-bent-over-row', squat: 'barbell-back-squat' };
const keyOf = (id: string) => KEYS[id] ?? null;
const CLSB: TrainingSplit = { kind: 'clsb', days: PRESET_SPLITS.clsb.map((d) => ({ ...d, bodyParts: [...d.bodyParts] })) };
const g = (o: Partial<Record<MuscleGroup, number>>): Map<MuscleGroup, number> => new Map(Object.entries(o) as [MuscleGroup, number][]);
const w = (sessionId: string, date: string, groups: Partial<Record<MuscleGroup, number>>): SplitWorkout => ({ sessionId, startedAtUtc: `${date}T17:00:00.000Z`, groups: g(groups), short: false });

const days = (over: { mainLifts?: Record<string, string>; exercisesOf?: (id: string) => string[] } = {}) =>
  todaySplitDays({ split: CLSB, mainLifts: over.mainLifts, exercisesOf: over.exercisesOf ?? (() => []), pool, info, catalogueKeyOf: keyOf, defaultMinutes: 60 });

describe('todaySplitDays: Profile › Split as Today days (no plan)', () => {
  it('one day per split day in split order, keyed as the builder draft key reads it (`other:<id>`), never a plan day', () => {
    const d = days();
    expect(d.map((x) => [x.name, x.key, x.kind, x.planId, x.dayIndex, x.splitDayId])).toEqual([
      ['Chest', 'other:chest', 'split', null, null, 'chest'],
      ['Legs', 'other:legs', 'split', null, null, 'legs'],
      ['Shoulders', 'other:shoulders', 'split', null, null, 'shoulders'],
      ['Back', 'other:back', 'split', null, null, 'back'],
    ]);
    expect(splitDayKey('chest')).toBe('other:chest');
    // Set up's mix for the day (abs on), Ben's usual length, supersets on; no plan template behind it.
    const chest = d[0]?.templates[0];
    expect(chest).toMatchObject({ routineId: null, version: null, minutes: 60, absPlan: true, supersetsPlan: true });
    expect(chest?.groups.map((x) => x.group)).toEqual(['Chest', 'Triceps', 'Abs']);
  });

  it('main lifts: Ben’s saved one first, then the lead group’s defaults here (two, as the prototype’s Bench / Incline)', () => {
    const plain = days()[0]?.templates.map((t) => [t.mainLiftExerciseId, t.label]);
    expect(plain).toEqual([
      ['bench', 'Barbell bench press'],
      ['incline_bb', 'Incline barbell press'],
    ]);
    const saved = days({ mainLifts: { chest: 'incline_bb' } })[0]?.templates.map((t) => t.mainLiftExerciseId);
    expect(saved).toEqual(['incline_bb', 'bench']);
    // An unknown saved lift (deleted exercise) is skipped, never a blank chip.
    expect(days({ mainLifts: { chest: 'gone' } })[0]?.templates.map((t) => t.mainLiftExerciseId)).toEqual(['bench', 'incline_bb']);
  });

  it('a group with no compound here has no main lift (honest), one template', () => {
    const out = splitDayMainOptions({ groups: ['Biceps'], saved: null, pool, info, catalogueKeyOf: keyOf });
    expect(out).toEqual([]);
    const arms: TrainingSplit = { kind: 'custom', days: [{ id: 'arms', name: 'Arms', bodyParts: ['Biceps', 'Triceps'] }] };
    const d = todaySplitDays({ split: arms, exercisesOf: () => [], pool, info, catalogueKeyOf: keyOf, defaultMinutes: 45 });
    expect(d[0]?.templates).toHaveLength(1);
    expect(d[0]?.templates[0]).toMatchObject({ mainLiftExerciseId: null, label: 'Arms', minutes: 45, absPlan: false });
  });

  it('his newest workout of the day leads the pools; the builder drafts the card like a plan day’s (main lift first, loads snapped by the builder)', () => {
    const d = days({ exercisesOf: (id) => (id === 'chest' ? ['bench', 'cable_fly', 'pushdown', 'unknown'] : []) })[0];
    if (d === undefined) throw new Error('no day');
    expect(d.templates[0]?.exerciseIds).toEqual(['bench', 'cable_fly', 'pushdown']);
    const controls = defaultTodayControls(d, { goal: 'strength' });
    expect(controls).toMatchObject({ mainLiftExerciseId: 'bench', minutes: 60, supersets: true, abs: null, accessories: 'focused' });
    const draft = assembleTodayDraft({ day: d, controls, ctx: context(), pool, mix: { candidates: pool, recentCountOnDay: new Map(), lastTwoOnDay: new Set(), lastDoneMs: new Map(), availableHere: () => true, painFlagged: () => false } });
    const slots = slotsOf(draft?.workout.blocks ?? []);
    expect(slots[0]?.exerciseId).toBe('bench');
    expect(slots[0]?.main).toBe(true);
    expect(slots.map((x) => x.exerciseId)).toContain('cable_fly');
    expect(draft?.absOn).toBe(true);
  });
});

describe('todaySplitNext: NEXT on the no-plan day row', () => {
  const none = g({});
  it('the app’s Up next resolver wins when it names a split day (one resolver, Today and Start agree)', () => {
    expect(todaySplitNext({ split: CLSB, upNext: { title: 'Back', groups: null }, workouts: [], near: null, lastGroups: null })).toEqual({ dayId: 'back', why: 'resolver' });
    // `Back · 45 min` (a coach build's name) still names Back.
    expect(todaySplitNext({ split: CLSB, upNext: { title: 'back · 45 min', groups: null }, workouts: [], near: null, lastGroups: null })?.dayId).toBe('back');
    // The resolver planned Chest from a workout Ben named `Push`: the day its muscles were.
    expect(todaySplitNext({ split: CLSB, upNext: { title: 'Push', groups: g({ Chest: 9, Triceps: 3 }) }, workouts: [], near: null, lastGroups: null })).toEqual({ dayId: 'chest', why: 'resolver' });
  });

  it('else the split day trained least recently (never the one just done)', () => {
    const ws = [w('c', '2026-10-12', { Chest: 9, Triceps: 3 }), w('l', '2026-10-14', { Quads: 9 }), w('s', '2026-10-16', { Shoulders: 9 }), w('b', '2026-10-17', { Back: 9 })];
    expect(todaySplitNext({ split: CLSB, upNext: { title: 'Push A', groups: null }, workouts: ws, near: null, lastGroups: none })).toEqual({ dayId: 'chest', why: 'due' });
  });

  it('a long run near today moves legs after the other days', () => {
    const ws = [w('l', '2026-10-10', { Quads: 9 }), w('c', '2026-10-12', { Chest: 9 }), w('s', '2026-10-16', { Shoulders: 9 }), w('b', '2026-10-17', { Back: 9 })];
    expect(todaySplitNext({ split: CLSB, upNext: null, workouts: ws, near: null, lastGroups: none })?.dayId).toBe('legs');
    const near = { when: 'before', why: 'Long run tomorrow' } as unknown as Parameters<typeof todaySplitNext>[0]['near'];
    expect(todaySplitNext({ split: CLSB, upNext: null, workouts: ws, near, lastGroups: none })?.dayId).toBe('chest');
  });

  it('no history: the first day', () => {
    expect(todaySplitNext({ split: CLSB, upNext: null, workouts: [], near: null, lastGroups: null })).toEqual({ dayId: 'chest', why: 'after_last' });
  });
});

describe('Why? on a split day', () => {
  const base = { other: false, last: null, mainTarget: null, goal: null, liftTarget: null, accessories: 'focused' as const, minutes: 60, coachReason: null, review: 'offline' as const };
  it('NEXT: `Chest: up next`; another day: picked by you, NEXT stays next; never a plan line', () => {
    expect(todayWhy({ ...base, dayName: 'Chest', nextDayName: 'Chest', split: { due: true } })[0]).toBe('Chest: up next · longest since trained');
    expect(todayWhy({ ...base, dayName: 'Chest', nextDayName: 'Chest', split: { due: false } })[0]).toBe('Chest: up next');
    const picked = todayWhy({ ...base, dayName: 'Legs', nextDayName: 'Chest', split: { due: true } });
    expect(picked[0]).toBe('Legs: picked by you; Chest stays next');
    expect(picked.join(' ')).not.toMatch(/Plan/);
  });
});
