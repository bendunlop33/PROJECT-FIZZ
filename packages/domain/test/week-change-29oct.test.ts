import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft, PlanWeekExerciseEdit, Routine, RoutineExercise } from '@fizz/schemas';

import { applyPlan, buildPlanFromAnswers, oneExerciseChange, pbDayWithEdits, pbNewPlanDraft, pbSkipsOf, pbUndoWeekChange, pbWeekChange, pbWeekdaysThisWeek, pbWeekEditsOf, type PbEditBlock, type PbWeekChangeRequest } from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 29 Oct: day sheet; docs/design/day-sheet.md) The day sheet's this-week changes: Do today instead (two Set days
 * swap weekdays), Move to…, Skip this week and one exercise change, each one versioned, idempotent write with one
 * Undo (rule 5); done days refused (rule 2); this week only (the next week is the plan as it was); a this-week edit
 * keeps the row's sets, reps, rest, place and superset and changes nothing else.
 */

const at = (ms = NOW) => ({ utc: new Date(ms).toISOString(), tz: TZ });
const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

function running(a: PlanBuilderAnswers = answers({ abs: 10, schedule: 'set', days: [0, 1, 2, 3] })): { plan: PlanDraft; routines: Routine[] } {
  const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const draft = pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(1), at: at() });
  const r = applyPlan(draft, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: op(2), at: at(), live: [] });
  if (r.kind !== 'write') throw new Error(r.kind);
  return { plan: r.next, routines: r.create };
}

const block = (o: Partial<PbEditBlock> = {}): PbEditBlock => ({ week: 1, doneThisWeek: [], ...o });
function change(plan: PlanDraft, c: PbWeekChangeRequest, o: { n?: number; block?: PbEditBlock; today?: number; expectedVersion?: number } = {}) {
  return pbWeekChange(plan, { expectedVersion: o.expectedVersion ?? plan.version, opId: op(o.n ?? 50), at: at(), block: o.block ?? block(), todayWeekday: o.today ?? 0, change: c });
}
function written(c: ReturnType<typeof change>): PlanDraft {
  if (c.kind !== 'write') throw new Error(c.kind);
  return c.next;
}

describe('Do today instead, Move to…, Skip (Set days, this week only)', () => {
  it('Do today instead swaps two days’ weekdays this week; next week is the plan’s; Undo puts both back', () => {
    const { plan } = running();
    expect([...(pbWeekdaysThisWeek(plan, block()) ?? [])]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    const p = written(change(plan, { kind: 'swap_days', dayIndex: 3, withDayIndex: 1 }));
    expect([...(pbWeekdaysThisWeek(p, block()) ?? [])]).toEqual([[0, 0], [1, 3], [2, 2], [3, 1]]);
    expect([...(pbWeekdaysThisWeek(p, block({ week: 2 })) ?? [])]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    const u = pbUndoWeekChange(p, { expectedVersion: p.version, opId: op(51), at: at() });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect([...(pbWeekdaysThisWeek(u.next, block()) ?? [])]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    // Undo once only; a stale Undo changes nothing.
    expect(pbUndoWeekChange(u.next, { expectedVersion: u.next.version, opId: op(52), at: at() }).kind).toBe('stale');
  });

  it('the lead-in’s changes are week 0’s, never week 1’s', () => {
    const { plan } = running();
    const p = written(change(plan, { kind: 'move', dayIndex: 2, weekday: 5 }, { block: block({ leadIn: true }), today: 2 }));
    expect(pbWeekdaysThisWeek(p, block({ leadIn: true }))?.get(2)).toBe(5);
    expect(pbWeekdaysThisWeek(p, block({ week: 1 }))?.get(2)).toBe(2);
  });

  it('Move to… a free weekday today or later; a gone weekday, one held by a day still to do, or a done day is refused', () => {
    const { plan } = running();
    expect(written(change(plan, { kind: 'move', dayIndex: 1, weekday: 5 }, { today: 1 })).moves).toEqual([{ week: 1, dayIndex: 1, weekday: 5 }]);
    expect(change(plan, { kind: 'move', dayIndex: 1, weekday: 0 }, { today: 1 }).kind).toBe('invalid');
    expect(change(plan, { kind: 'move', dayIndex: 1, weekday: 3 }, { today: 1 }).kind).toBe('invalid');
    // Day 3 done (Thu's day done Mon): its weekday is free.
    expect(change(plan, { kind: 'move', dayIndex: 1, weekday: 3 }, { today: 1, block: block({ doneThisWeek: [3] }) }).kind).toBe('write');
    expect(change(plan, { kind: 'move', dayIndex: 3, weekday: 5 }, { block: block({ doneThisWeek: [3] }) }).kind).toBe('invalid');
  });

  it('Skip this week leaves the day out of this week only; Undo brings it back', () => {
    const { plan } = running();
    const p = written(change(plan, { kind: 'skip', dayIndex: 2 }));
    expect(pbSkipsOf(p, 1)).toEqual(new Set([2]));
    expect(pbWeekdaysThisWeek(p, block())?.has(2)).toBe(false);
    expect(pbWeekdaysThisWeek(p, block({ week: 2 }))?.has(2)).toBe(true);
    expect(change(p, { kind: 'skip', dayIndex: 2 }, { n: 60 }).kind).toBe('invalid');
    const u = pbUndoWeekChange(p, { expectedVersion: p.version, opId: op(61), at: at() });
    expect(u.kind === 'write' ? pbSkipsOf(u.next, 1).size : -1).toBe(0);
  });

  it('idempotent by op ID, stale versions refused, Any days can’t swap weekdays', () => {
    const { plan } = running();
    const p = written(change(plan, { kind: 'skip', dayIndex: 2 }));
    expect(change(p, { kind: 'skip', dayIndex: 1 }).kind).toBe('duplicate');
    expect(change(p, { kind: 'skip', dayIndex: 1 }, { n: 70, expectedVersion: plan.version }).kind).toBe('stale');
    const any = running(answers({ abs: 10 })).plan;
    expect(change(any, { kind: 'swap_days', dayIndex: 0, withDayIndex: 1 }).kind).toBe('invalid');
    expect(change(any, { kind: 'skip', dayIndex: 1 }).kind).toBe('write');
  });
});

describe('one exercise change, this week only', () => {
  const row = (n: number, exerciseId: string, o: Partial<RoutineExercise> = {}): RoutineExercise => ({
    id: id(n),
    exerciseId,
    equipmentId: id(900 + n),
    order: n,
    supersetGroup: null,
    setTemplates: [
      { id: id(100 + n * 10), setType: 'warmup', targetLoad: null, targetReps: { min: 5, max: 5 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: 60 },
      { id: id(101 + n * 10), setType: 'working', targetLoad: null, targetReps: { min: 6, max: 8 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null },
      { id: id(102 + n * 10), setType: 'working', targetLoad: null, targetReps: { min: 6, max: 8 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: 150 },
    ],
    restBySetType: { working: { seconds: 150 } },
    transitionRestS: null,
    progressionRuleId: null,
    ...o,
  });
  const day = [row(0, 'squat', { main: true }), row(1, 'rdl', { supersetGroup: 'A' }), row(2, 'curl', { supersetGroup: 'A' }), row(3, 'calf')];
  const edit = (o: Partial<PlanWeekExerciseEdit>): PlanWeekExerciseEdit => ({ week: 1, dayIndex: 2, kind: 'swap', rowId: id(1), fromExerciseId: 'rdl', toExerciseId: 'good-morning', opId: op(80), atUtc: at().utc, ...o });

  it('Swap keeps the row’s sets, reps, rest, place and superset; nothing else changes', () => {
    const { rows, changed } = pbDayWithEdits(day, [edit({})]);
    expect(rows.map((r) => r.exerciseId)).toEqual(['squat', 'good-morning', 'curl', 'calf']);
    const was = day[1];
    const now = rows[1];
    expect(now).toMatchObject({ id: was?.id, order: 1, supersetGroup: 'A', restBySetType: was?.restBySetType });
    expect(now?.setTemplates.map((t) => [t.setType, t.targetReps, t.restOverrideS])).toEqual(was?.setTemplates.map((t) => [t.setType, t.targetReps, t.restOverrideS]));
    expect(rows.filter((_, i) => i !== 1)).toEqual(day.filter((_, i) => i !== 1));
    expect([...changed]).toEqual([id(1)]);
  });

  it('a typed weight goes on the working sets as typed (kg and lb, per hand), never on the warm-ups', () => {
    const kg = oneExerciseChange(day, edit({ load: { value: 31, unit: 'kg', convention: 'per_hand' } }))[1];
    expect(kg?.setTemplates.map((t) => t.targetLoad?.value ?? null)).toEqual([null, 31, 31]);
    expect(kg?.setTemplates[1]?.targetLoad).toEqual({ value: 31, unit: 'kg', convention: 'per_hand' });
    const lb = oneExerciseChange(day, edit({ load: { value: 135, unit: 'lb', convention: 'total' } }))[1];
    expect(lb?.setTemplates[2]?.targetLoad).toEqual({ value: 135, unit: 'lb', convention: 'total' });
  });

  it('Remove leaves one row out; Add puts one row after its place (no superset, not a main lift)', () => {
    const removed = pbDayWithEdits(day, [edit({ kind: 'remove', rowId: id(3), fromExerciseId: 'calf', toExerciseId: null })]);
    expect(removed.rows.map((r) => r.exerciseId)).toEqual(['squat', 'rdl', 'curl']);
    expect(removed.removed).toEqual(['calf']);
    const added = pbDayWithEdits(day, [edit({ kind: 'add', rowId: id(9), fromExerciseId: null, toExerciseId: 'leg-press', afterRowId: id(0), sets: 3, reps: { min: 10, max: 12 } })]);
    expect(added.rows.map((r) => r.exerciseId)).toEqual(['squat', 'leg-press', 'rdl', 'curl', 'calf']);
    expect(added.rows[1]).toMatchObject({ supersetGroup: null, main: false });
    expect(added.rows[1]?.setTemplates.map((t) => t.targetReps)).toEqual([{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }]);
    expect(added.rows[2]).toMatchObject({ supersetGroup: 'A' });
  });

  it('a second change to the same row replaces the first; swapping back is no change; a done day is refused', () => {
    const { plan } = running();
    const p1 = written(change(plan, { kind: 'exercise', edit: { dayIndex: 2, kind: 'swap', rowId: id(1), fromExerciseId: 'rdl', toExerciseId: 'good-morning' } }, { n: 81 }));
    const p2 = written(change(p1, { kind: 'exercise', edit: { dayIndex: 2, kind: 'swap', rowId: id(1), fromExerciseId: 'good-morning', toExerciseId: 'hip-thrust' } }, { n: 82 }));
    expect(pbWeekEditsOf(p2, 1, 2).map((e) => [e.fromExerciseId, e.toExerciseId])).toEqual([['rdl', 'hip-thrust']]);
    const p3 = written(change(p2, { kind: 'exercise', edit: { dayIndex: 2, kind: 'swap', rowId: id(1), fromExerciseId: 'hip-thrust', toExerciseId: 'rdl' } }, { n: 83 }));
    expect(pbWeekEditsOf(p3, 1, 2)).toEqual([]);
    expect(pbWeekEditsOf(p2, 2, 2)).toEqual([]);
    expect(change(plan, { kind: 'exercise', edit: { dayIndex: 2, kind: 'remove', rowId: id(1), fromExerciseId: 'rdl', toExerciseId: null } }, { block: block({ doneThisWeek: [2] }) }).kind).toBe('invalid');
    // One Undo reverts exactly the last change.
    const u = pbUndoWeekChange(p2, { expectedVersion: p2.version, opId: op(84), at: at() });
    expect(u.kind === 'write' ? pbWeekEditsOf(u.next, 1, 2).map((e) => e.toExerciseId) : null).toEqual(['good-morning']);
  });
});
