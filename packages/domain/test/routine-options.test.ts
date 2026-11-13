import { describe, expect, it } from 'vitest';

import type { RoutineExercise } from '@fizz/schemas';

import { pairAddedWith, routineAbsOff, routineAbsOnPick, routineOptionsState, routineSupersetsOff, routineSupersetsOn } from '../src/index';
import { info } from './builder-v3-fixture';

/**
 * Redesign 27 Oct, D6: the editor's Options card (Abs, Supersets) on a plan day or saved workout uses Today's rules:
 * abs off splits their pairs (an arm partner fills an arm left alone, Supersets on); supersets on pairs as the
 * builder does, never the main lift, a heavy lift or a slot Ben unlinked.
 */

const slot = (id: string, exerciseId: string, group: string | null = null, sets = 3): RoutineExercise =>
  ({
    id,
    exerciseId,
    order: 0,
    supersetGroup: group,
    setTemplates: Array.from({ length: sets }, (_, i) => ({ id: `${id}-${String(i)}`, setType: 'working', targetReps: { min: 8, max: 10 }, targetLoad: null, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
  }) as unknown as RoutineExercise;

const shape = (l: readonly RoutineExercise[]) => l.map((e) => `${e.id}${e.supersetGroup === null ? '' : `:${e.supersetGroup}`}`);

describe('routine Options: Abs and Supersets', () => {
  it('state: abs when there is a Core exercise; supersets when any pair', () => {
    expect(routineOptionsState([slot('a', 'bench'), slot('b', 'crunch')], info)).toEqual({ abs: true, supersets: false });
    expect(routineOptionsState([slot('a', 'bench'), slot('b', 'curl', 'A'), slot('c', 'pushdown', 'A')], info)).toEqual({ abs: false, supersets: true });
  });

  it('supersets off splits every pair; on pairs singles, never the main lift or a heavy lift', () => {
    const list = [slot('m', 'bench'), slot('s', 'squat'), slot('f', 'cable_fly'), slot('c', 'curl'), slot('p', 'pushdown')];
    const on = routineSupersetsOn(list, info, { mains: new Set(['m']), unlinked: new Set() });
    const grouped = on.filter((e) => e.supersetGroup !== null).map((e) => e.id);
    expect(grouped).not.toContain('m');
    expect(grouped).not.toContain('s');
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    expect(routineSupersetsOff(on).every((e) => e.supersetGroup === null)).toBe(true);
  });

  it('a slot Ben unlinked is never re-paired', () => {
    const list = [slot('m', 'bench'), slot('c', 'curl'), slot('p', 'pushdown')];
    const on = routineSupersetsOn(list, info, { mains: new Set(['m']), unlinked: new Set(['c']) });
    expect(on.find((e) => e.id === 'c')?.supersetGroup).toBeNull();
  });

  it('Ben’s own pairs stay as they are', () => {
    const list = [slot('m', 'bench'), slot('f', 'cable_fly', 'A'), slot('o', 'oh_ext', 'A'), slot('c', 'curl')];
    const on = routineSupersetsOn(list, info, { mains: new Set(['m']), unlinked: new Set() });
    const f = on.find((e) => e.id === 'f');
    expect(f?.supersetGroup).not.toBeNull();
    expect(on.find((e) => e.id === 'o')?.supersetGroup).toBe(f?.supersetGroup);
  });

  it('abs off removes the abs and splits their pair; supersets on: an arm partner for the arm left alone', () => {
    const list = [slot('m', 'bench'), slot('p', 'pushdown', 'A', 4), slot('k', 'crunch', 'A')];
    const off = routineAbsOff(list, info, { supersets: true, armCandidates: ['oh_ext', 'curl'] });
    expect(off.removed).toEqual(['k']);
    expect(shape(off.list)).toEqual(['m', 'p']);
    // Same part (triceps) clashes with the pushdown: the curl is the partner, with the pushdown's 4 sets.
    expect(off.add).toEqual({ exerciseId: 'curl', withSlotId: 'p', workingSets: 4 });
    const added = [...off.list, slot('n', 'curl', null, 4)];
    expect(shape(pairAddedWith(added, 'n', 'p'))).toEqual(['m', 'p:A', 'n:A']);
    // Supersets off: no partner.
    expect(routineAbsOff(list, info, { supersets: false, armCandidates: ['curl'] }).add).toBeNull();
  });

  it('abs on: the first ab pick not already there (none: null)', () => {
    expect(routineAbsOnPick([slot('m', 'bench')], ['crunch', 'knee_raise'])).toBe('crunch');
    expect(routineAbsOnPick([slot('m', 'bench'), slot('k', 'crunch')], ['crunch'])).toBeNull();
  });
});
