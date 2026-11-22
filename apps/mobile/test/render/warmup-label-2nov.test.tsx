import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';

import { BuilderWorkoutScreen } from '../../src/screens/builder/BuilderWorkoutScreen';
import { PlanDayScreen } from '../../src/screens/library/PlanDayScreen';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, harness, withPlan, type Ben } from './seed';

/**
 * (Ben, 2 Nov) A cardio row Ben asked for as a warm-up reads `Warm-up` in its meta line, rendered over real SQLite: on
 * Your workout (`Exercise bike` · `8:00` · `Warm-up`) and on Library › Plan › the day. No icon, no explanation; the
 * day's other rows are unmarked.
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

/** The plan's first day with the bike first, 8 min, marked as a warm-up (the write Apply makes). */
async function bikeFirst(ben: Ben): Promise<{ routineId: string; name: string }> {
  await withPlan(h, ben);
  const day = (await ben.s.plans.active())?.days[0];
  if (day === undefined) throw new Error('no plan day');
  const t = (await ben.s.routines.editor({ routineId: day.routineId, gymId: null }))?.routine;
  if (t == null) throw new Error('no template');
  const r = await ben.s.plans.editDayEveryWeek({ routineId: day.routineId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: catalogueExerciseId('exercise-bike'), afterRowId: null, first: true, sets: 1, durationS: 480, warmup: true } });
  if (!r.ok) throw new Error(r.message);
  return { routineId: day.routineId, name: day.name };
}

const count = (text: string, word: string) => text.split(word).length - 1;

describe('Warm-up label', () => {
  it('Your workout: the bike’s meta line reads Warm-up; nothing else does', async () => {
    const ben = await benWithHistory(h);
    const day = await bikeFirst(ben);
    const opened = await ben.s.builder.openTarget({ kind: 'routine', routineId: day.routineId }, h.ids());
    const draftId = opened.snapshot?.draftId;
    if (draftId === undefined) throw new Error('Your workout did not open');
    const r = await renderScreen(h, ben.launched, BuilderWorkoutScreen, { name: 'BuilderWorkout', params: { draftId, back: 'Today' } }, (t) => t.includes('Exercise bike') && t.includes('＋ Add exercise'));
    const text = r.text();
    expect(text).toContain('8:00');
    expect(count(text, 'Warm-up')).toBe(1);
    expect(text.indexOf('Exercise bike')).toBeLessThan(text.indexOf('Warm-up'));
    expectHealthy(r);
    await r.unmount();
  });

  it('Library › Plan › the day: Warm-up under the bike', async () => {
    const ben = await benWithHistory(h);
    const day = await bikeFirst(ben);
    const r = await renderScreen(h, ben.launched, PlanDayScreen, { name: 'LibraryPlanDay', params: { routineId: day.routineId, name: day.name } }, (t) => t.includes('Exercise bike'));
    const text = r.text();
    expect(count(text, 'Warm-up')).toBe(1);
    expect(text.indexOf('Exercise bike')).toBeLessThan(text.indexOf('Warm-up'));
    expectHealthy(r);
    await r.unmount();
  });
});
