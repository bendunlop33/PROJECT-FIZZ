import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft, Routine } from '@fizz/schemas';

import { applyPlan, buildPlanFromAnswers, pbCarryOnOpenOf, pbCarryWeekChanges, pbKeepBlockOf, pbNewPlanDraft } from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 31 Oct: "When I upload a new version it seems to forget that I have changed the order") This week's changes
 * (moves, skips, one-change edits) made on a plan document survive a re-apply that makes a new document within the
 * same block, and the 30 Oct block-start repair. Lead-in week (0): Push B (day 3) moved to Fri, Pull B (day 4) to Thu,
 * Legs A (day 2) skipped, one swap on Push B.
 */

const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (utc: string) => ({ utc, tz: TZ });
const SET: Partial<PlanBuilderAnswers> = { split: 'ppl', sessions: 6, schedule: 'set', days: [0, 1, 2, 3, 4, 5] };

function draft(n: number, utc: string): PlanDraft {
  const a = answers(SET);
  const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  return pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(n), at: at(utc) });
}

function apply(p: PlanDraft, n: number, utc: string, inUse: readonly PlanDraft[] = []): { plan: PlanDraft; superseded: PlanDraft[]; made: Routine[] } {
  const r = applyPlan(p, { expectedVersion: p.version, versionN: p.currentVersion, mode: 'replace', opId: op(n), at: at(utc), live: [], applied: inUse });
  if (r.kind !== 'write') throw new Error(r.kind);
  return { plan: r.next, superseded: r.supersede.map((x) => x.next), made: r.create };
}

/** Ben's lead-in week changes on `p` (its own rows for the swap). */
function withChanges(p: PlanDraft, made: readonly Routine[]): PlanDraft {
  const pushB = made.find((r) => r.createdFromPlan?.dayIndex === 3);
  const row = pushB?.exercises.find((e) => e.main !== true);
  if (row === undefined) throw new Error('no row');
  return {
    ...p,
    moves: [
      { week: 0, dayIndex: 3, weekday: 4 },
      { week: 0, dayIndex: 4, weekday: 3 },
    ],
    weekSkips: [{ week: 0, dayIndex: 2 }],
    weekEdits: [{ week: 0, dayIndex: 3, kind: 'swap', rowId: row.id, fromExerciseId: row.exerciseId, toExerciseId: 'cable-fly', opId: op(90), atUtc: '2026-10-29T07:00:00.000Z' }],
  };
}

const rowsOf = (made: readonly Routine[]) => (i: number) => made.find((r) => r.createdFromPlan?.dayIndex === i)?.exercises.map((e) => ({ id: e.id, exerciseId: e.exerciseId })) ?? null;

describe('this week’s changes carry over to a new plan document in the same block (Ben, 31 Oct)', () => {
  it('a re-apply in the lead-in: moves, skips and the swap come with it; the swap finds its row again by exercise', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z');
    const changed = withChanges(first.plan, first.made);
    const again = apply(draft(3, '2026-10-30T09:00:00.000Z'), 4, '2026-10-30T09:00:00.000Z', [changed]);
    expect(again.plan.applied?.block?.startedAtUtc).toBe('2026-10-28T09:00:00.000Z');
    expect(again.plan.moves).toEqual(changed.moves);
    expect(again.plan.weekSkips).toEqual(changed.weekSkips);
    const e = again.plan.weekEdits?.[0];
    const newRow = again.made.find((r) => r.createdFromPlan?.dayIndex === 3)?.exercises.find((x) => x.exerciseId === changed.weekEdits?.[0]?.fromExerciseId);
    expect(e).toMatchObject({ week: 0, dayIndex: 3, kind: 'swap', toExerciseId: 'cable-fly', rowId: newRow?.id });
    expect(e?.rowId).not.toBe(changed.weekEdits?.[0]?.rowId);
  });

  it('a new block (nothing running) carries nothing', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z');
    expect(first.plan.moves ?? []).toEqual([]);
  });

  it('the new document’s own changes win; days and rows it doesn’t have are dropped', () => {
    const merged = pbCarryWeekChanges(
      { moves: [{ week: 1, dayIndex: 0, weekday: 2 }, { week: 1, dayIndex: 9, weekday: 3 }], weekSkips: [{ week: 1, dayIndex: 9 }], weekEdits: [{ week: 1, dayIndex: 0, kind: 'remove', rowId: 'old', fromExerciseId: 'gone', toExerciseId: null, opId: op(1), atUtc: '2026-10-29T07:00:00.000Z' }] },
      { moves: [{ week: 1, dayIndex: 0, weekday: 5 }] },
      { dayIndexes: [0, 1], rowsOf: () => [{ id: 'r1', exerciseId: 'bench' }] },
    );
    expect(merged).toEqual({ moves: [{ week: 1, dayIndex: 0, weekday: 5 }], weekSkips: [], weekEdits: [] });
  });

  it('through the 30 Oct repair: a plan re-applied before the fix gets its block start, then (on open) the earlier document’s changes, once', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z');
    const changed = withChanges(first.plan, first.made);
    const second = apply(draft(3, '2026-10-30T09:00:00.000Z'), 4, '2026-10-30T09:00:00.000Z', [changed]);
    // As stored before the fix: no block, nothing carried; the earlier document superseded with its changes.
    const was = { ...second.plan, applied: second.plan.applied === null ? null : { ...second.plan.applied, block: undefined }, moves: [], weekSkips: [], weekEdits: [] } as PlanDraft;
    const all = [second.superseded[0] ?? changed, was];
    expect(pbCarryOnOpenOf(was, all, rowsOf(second.made), '2026-10-31T08:00:00.000Z')).toBeNull();
    const k = pbKeepBlockOf(was, all, TZ, '2026-10-31T08:00:00.000Z');
    if (k === null) throw new Error('no repair');
    const c = pbCarryOnOpenOf(k.next, [all[0] ?? changed, k.next], rowsOf(second.made), '2026-10-31T08:00:01.000Z');
    expect(c?.next.moves).toEqual(changed.moves);
    expect(c?.next.weekSkips).toEqual(changed.weekSkips);
    expect(c?.next.weekEdits?.[0]?.toExerciseId).toBe('cable-fly');
    expect(c?.next.version).toBe(k.next.version + 1);
    // Once: a later open (or Ben's own change after it, e.g. an Undo) is never overwritten.
    const after = c?.next ?? k.next;
    expect(pbCarryOnOpenOf({ ...after, moves: [] }, [all[0] ?? changed, after], rowsOf(second.made), '2026-10-31T09:00:00.000Z')).toBeNull();
  });
});
