import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft } from '@fizz/schemas';

import { applyPlan, buildPlanFromAnswers, pbMovedOntoToday, pbNewPlanDraft, pbWeekChange, pbWeekdaysThisWeek, type PbEditBlock, type PbWeekChangeRequest } from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 31 Oct: "it should move everything") A day Ben moves onto today is Up next with `Moved by you · Undo`; Undo
 * (`unmove`) puts this week's move back, and a day the move displaced goes back too. Versioned and idempotent (rule 5).
 */

const at = () => ({ utc: new Date(NOW).toISOString(), tz: TZ });
const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function running(a: PlanBuilderAnswers = answers({ abs: 10, schedule: 'set', days: [0, 2, 4, 5] })): PlanDraft {
  const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const draft = pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(1), at: at() });
  const r = applyPlan(draft, { expectedVersion: 1, versionN: 1, mode: 'replace', opId: op(2), at: at(), live: [] });
  if (r.kind !== 'write') throw new Error(r.kind);
  return r.next;
}

const block = (o: Partial<PbEditBlock> = {}): PbEditBlock => ({ week: 1, doneThisWeek: [], ...o });
function write(plan: PlanDraft, c: PbWeekChangeRequest, n: number, today = 1, b = block()): PlanDraft {
  const r = pbWeekChange(plan, { expectedVersion: plan.version, opId: op(n), at: at(), block: b, todayWeekday: today, change: c });
  if (r.kind !== 'write') throw new Error(r.kind);
  return r.next;
}

describe('Moved by you · Undo', () => {
  it('Friday’s day moved onto Tuesday (today) reads as moved by you; Undo puts it back on Friday', () => {
    const plan = running();
    expect(pbMovedOntoToday(plan, block(), 2, 1)).toBe(false);
    const moved = write(plan, { kind: 'place', moves: [{ dayIndex: 2, weekday: 1 }] }, 10);
    expect(pbMovedOntoToday(moved, block(), 2, 1)).toBe(true);
    // Not today: not shown (another weekday, or next week).
    expect(pbMovedOntoToday(moved, block(), 2, 2)).toBe(false);
    expect(pbMovedOntoToday(moved, block({ week: 2 }), 2, 1)).toBe(false);
    const back = write(moved, { kind: 'unmove', dayIndex: 2 }, 11);
    expect(pbWeekdaysThisWeek(back, block())?.get(2)).toBe(4);
    expect(pbMovedOntoToday(back, block(), 2, 1)).toBe(false);
    expect(back.version).toBe(moved.version + 1);
  });

  it('a swap (Do today instead): Undo puts both days back', () => {
    const plan = running();
    // Wednesday's day (index 1) and Friday's (index 2) swap: Friday's day is on Wednesday (today).
    const swapped = write(plan, { kind: 'swap_days', dayIndex: 2, withDayIndex: 1 }, 20, 2);
    expect(pbMovedOntoToday(swapped, block(), 2, 2)).toBe(true);
    const back = write(swapped, { kind: 'unmove', dayIndex: 2 }, 21, 2);
    expect([...(pbWeekdaysThisWeek(back, block()) ?? [])]).toEqual([
      [0, 0],
      [1, 2],
      [2, 4],
      [3, 5],
    ]);
  });

  it('the same op ID replays; a stale version, a day with no move or a done day is refused', () => {
    const plan = running();
    const moved = write(plan, { kind: 'place', moves: [{ dayIndex: 2, weekday: 1 }] }, 30);
    const once = pbWeekChange(moved, { expectedVersion: moved.version, opId: op(31), at: at(), block: block(), todayWeekday: 1, change: { kind: 'unmove', dayIndex: 2 } });
    if (once.kind !== 'write') throw new Error(once.kind);
    expect(pbWeekChange(once.next, { expectedVersion: once.next.version, opId: op(31), at: at(), block: block(), todayWeekday: 1, change: { kind: 'unmove', dayIndex: 2 } }).kind).toBe('duplicate');
    expect(pbWeekChange(moved, { expectedVersion: moved.version - 1, opId: op(32), at: at(), block: block(), todayWeekday: 1, change: { kind: 'unmove', dayIndex: 2 } }).kind).toBe('stale');
    expect(pbWeekChange(moved, { expectedVersion: moved.version, opId: op(33), at: at(), block: block(), todayWeekday: 1, change: { kind: 'unmove', dayIndex: 1 } }).kind).toBe('invalid');
    expect(pbWeekChange(moved, { expectedVersion: moved.version, opId: op(34), at: at(), block: block({ doneThisWeek: [2] }), todayWeekday: 1, change: { kind: 'unmove', dayIndex: 2 } }).kind).toBe('invalid');
  });

  it('Any days: nothing to move, never moved by you', () => {
    const plan = running(answers({ abs: 10, schedule: 'any' }));
    expect(pbMovedOntoToday(plan, block(), 0, 0)).toBe(false);
    expect(pbWeekChange(plan, { expectedVersion: plan.version, opId: op(40), at: at(), block: block(), todayWeekday: 0, change: { kind: 'unmove', dayIndex: 0 } }).kind).toBe('invalid');
  });
});
