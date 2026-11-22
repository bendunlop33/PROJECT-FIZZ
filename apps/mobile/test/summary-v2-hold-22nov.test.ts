import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { summaryPlanLine } from '@fizz/domain';
import type { PlanBuilderAnswers } from '@fizz/schemas';

import { nextTimeView, type NextTimeRowView } from '../src/coach/next-time-view';
import type { AppServices } from '../src/services/app-services';
import { logPlanDay } from './block-seed';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 22 Nov; Summary v2) Next time's per-row `Undo` of the built-in rule's change, and the plan line / volume arrow
 * reads. Real SQLite and services, offline (no coach connected). Lat pulldown 2 × 10 at 55 kg: the rule's next target
 * is 60 kg; Undo keeps 55 for that one exercise, Start plans it, Redo puts 60 back. Versioned and idempotent: a repeat
 * tap replays, a tap on a row drawn before a newer write is refused, a hold the workout no longer fits is asked again.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-11-16T08:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function rowOf(s: AppServices, sessionId: string, name: string): Promise<NextTimeRowView | undefined> {
  const summary = await s.workout.summary(sessionId);
  const view = nextTimeView({
    title: summary?.title ?? '',
    builtIn: summary?.nextTime ?? null,
    from: summary?.nextFrom ?? {},
    coachRows: await s.coach.nextTargets(sessionId),
    ruleRows: await s.coach.ruleResets(sessionId),
    holdRows: await s.coach.ruleHolds(sessionId),
    stale: await s.coach.staleNextTargets(sessionId),
    availability: await s.coach.availability(),
    reviewing: false,
  });
  return view?.rows.find((r) => r.exerciseName === name);
}

const plannedLoads = async (s: AppServices, sessionId: string, name: string) => {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const ex = a?.exercises.find((e) => e.exerciseName === name);
  return (a?.sets ?? []).filter((x) => x.sessionExerciseId === ex?.id && x.setType === 'working').map((x) => x.planned.load?.value ?? null);
};

describe('Next time: per-row Undo of the built-in rule (Ben, 22 Nov)', () => {
  it('Undo keeps today’s target for that one exercise; Start plans it; Redo / Undo again; repeats replay; stale taps refused', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [
      { exercise: 'Lat pulldown', sets: [{ load: 55, reps: 10, rpe: 8 }, { load: 55, reps: 10, rpe: 8 }] },
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] },
    ]);

    const row = await rowOf(s, sessionId, 'Lat pulldown');
    expect(row?.line.text).toBe('55 → 60 kg');
    expect(row?.actions.map((a) => a.label)).toEqual(['Undo']);
    const hold = row?.hold;
    if (hold === undefined) throw new Error('no hold offered');
    expect(hold.hold.load?.value).toBe(55);
    expect(hold.rule.load?.value).toBe(60);

    // Undo: written once; the same tap again (a double tap, the same view) replays, never a second row.
    expect(await s.coach.tapRuleHold(sessionId, hold, 'undo')).toEqual({ status: 'written' });
    expect(await s.coach.tapRuleHold(sessionId, hold, 'undo')).toEqual({ status: 'replayed' });
    const holds = await s.coach.ruleHolds(sessionId);
    expect(holds.map((x) => [x.exerciseName, x.status, x.origin, x.target.load?.value, x.builtIn?.load?.value])).toEqual([['Lat pulldown', 'applied', 'hold', 55, 60]]);
    // Not the coach's: never a coach row, Undo all or a coach change.
    expect(await s.coach.nextTargets(sessionId)).toEqual([]);

    // The row now reads today's target with Redo; bench (its own row) is untouched.
    const held = await rowOf(s, sessionId, 'Lat pulldown');
    expect(held?.line.text).toMatch(/^Same · /);
    expect(held?.actions.map((a) => a.label)).toEqual(['Redo']);
    expect((await rowOf(s, sessionId, 'Bench press'))?.hold?.row ?? null).toBeNull();

    // Redo, then Undo again, each against the row as read (versioned).
    const redo = held?.hold;
    if (redo === undefined) throw new Error('no hold');
    expect(await s.coach.tapRuleHold(sessionId, redo, 'use_coach')).toEqual({ status: 'written' });
    expect((await s.coach.ruleHolds(sessionId))[0]?.status).toBe('proposed');
    // A tap from the view drawn before the Redo (an Undo on an applied row): refused, never applied to newer state.
    expect(await s.coach.tapRuleHold(sessionId, redo, 'undo')).toEqual({ status: 'not_possible', reason: 'changed_since' });
    const again = (await rowOf(s, sessionId, 'Lat pulldown'))?.hold;
    expect((await rowOf(s, sessionId, 'Lat pulldown'))?.line.text).toBe('55 → 60 kg');
    if (again === undefined) throw new Error('no hold');
    expect(await s.coach.tapRuleHold(sessionId, again, 'undo')).toEqual({ status: 'written' });
    expect((await s.coach.ruleHolds(sessionId))[0]?.status).toBe('applied');

    // Start next session from this workout: 55 kg for lat pulldown (the hold), the rule's own for bench.
    h.clockMs += 2 * 86_400_000;
    const next = await s.workout.start({ gymId, opId: 'start-next', checkIn: null, nextOf: sessionId });
    if (!next.ok) throw new Error(next.error.message);
    expect(new Set(await plannedLoads(s, next.aggregate.session.id, 'Lat pulldown'))).toEqual(new Set([55]));
    // Used: the row has no buttons any more.
    const used = await rowOf(s, sessionId, 'Lat pulldown');
    expect(used?.actions).toEqual([]);
    expect(used?.trailing).toBe('Used');
  });

  it('a set corrected after the Undo: the hold no longer fits; the row offers Undo again and writes at the version seen', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const sessionId = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 59, reps: 10, rpe: 8 }, { load: 59, reps: 10, rpe: 8 }] }]);
    const hold = (await rowOf(s, sessionId, 'Lat pulldown'))?.hold;
    if (hold === undefined) throw new Error('no hold');
    expect((await s.coach.tapRuleHold(sessionId, hold, 'undo')).status).toBe('written');

    // Correct one set (11 reps): the sets the hold was saved on changed.
    const set = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.status === 'completed');
    if (set === undefined) throw new Error('no set');
    const fixed = await s.workout.correctSet({ sessionId, setId: set.id, expectedSetVersion: set.version, patch: { reps: 11 }, opId: 'fix-1' });
    expect(fixed.ok).toBe(true);
    const ids = await s.coach.staleNextTargets(sessionId);
    expect(ids.size).toBe(1);
    const row = await rowOf(s, sessionId, 'Lat pulldown');
    expect(row?.actions.map((a) => a.label)).toEqual(['Undo']);
    expect(row?.hold?.again).toBe(true);
    const again = row?.hold;
    if (again === undefined) throw new Error('no hold');
    expect((await s.coach.tapRuleHold(sessionId, again, 'undo')).status).toBe('written');
    const holds = await s.coach.ruleHolds(sessionId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.version).toBe(2);
    expect((await s.coach.staleNextTargets(sessionId)).size).toBe(0);
    // The same tap again (the view drawn before that write): replays it, never a second write.
    expect((await s.coach.tapRuleHold(sessionId, again, 'undo')).status).toBe('replayed');
  });
});

describe('Plan line and the volume arrow (Ben, 22 Nov)', () => {
  it('a plan day: `Week 1 of 6 · 1 of 3 days done`; the same plan day next week: its volume is the one compared', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    // Mon 16 Nov: a 6-week, 3-day builder plan, applied on its Monday (no lead-in).
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no plan builder');
    const answers: PlanBuilderAnswers = { ...session.answers, sessions: 3, split: 'ppl', weeks: 6 };
    const built = await s.planBuilder.save(session, answers, null, h.ids());
    if (!built.ok) throw new Error(built.reason);
    expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);
    const day = (await s.todaySession.load())?.days.filter((x) => x.planId === built.planId).sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0))[0]?.templates[0];
    if (day?.routineId == null || day.mainLiftExerciseId === null) throw new Error('no plan day');

    h.clockMs = Date.parse('2026-11-17T17:00:00.000Z');
    const first = await logPlanDay(h, s, gymId, day.routineId, day.mainLiftExerciseId, 60, () => 8);
    const e1 = await s.workout.summaryExtras(first);
    expect(summaryPlanLine(e1.plan)).toBe('Week 1 of 6 · 1 of 3 days done');
    // Nothing comparable before it: no arrow.
    expect(e1.previousVolumeKg).toBeNull();

    h.clockMs = Date.parse('2026-11-24T17:00:00.000Z');
    const second = await logPlanDay(h, s, gymId, day.routineId, day.mainLiftExerciseId, 62.5, () => 8);
    const e2 = await s.workout.summaryExtras(second);
    expect(summaryPlanLine(e2.plan)).toBe('Week 2 of 6 · 1 of 3 days done');
    expect(e2.previousVolumeKg).toBe(3 * 60 * 8);

    // An off-plan workout with no plan day or saved workout before it: no comparison.
    const off = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 59, reps: 10 }] }]);
    expect((await s.workout.summaryExtras(off)).previousVolumeKg).toBeNull();
  });
});
