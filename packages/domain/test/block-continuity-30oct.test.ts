import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft } from '@fizz/schemas';

import {
  applyPlan,
  assignPlanWeek,
  buildPlanFromAnswers,
  pbBlockOfPlan,
  pbBlockStartUtc,
  pbContinuedBlock,
  pbKeepBlockOf,
  pbNewPlanDraft,
  planDayLinkOf,
  restartPlan,
  type LinkPlanDay,
  type LinkWorkout,
  type PlanWeekSlotDay,
  type PlanWeekSlotWorkout,
} from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 30 Oct) Two bugs in one area.
 * 1. Edits never restart the block: a re-apply of the plan in use (a new plan document over the builder plan whose
 *    block runs) continues that block (`applied.block`): its start (so its lead-in, week numbers and deload) and the
 *    earlier documents' workouts. Only `Start again` copies and a block that may be finished start a new one. A plan
 *    re-applied before the fix gets its block's start back from the plans it superseded (`pbKeepBlockOf`).
 * 2. A Set days workout named for variants (`Pull`) is the variant scheduled on its own weekday (Tue → Pull A), then
 *    the main lift it led with; the week count (`assignPlanWeek`) reads the same.
 */

const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (utc: string) => ({ utc, tz: TZ });
const SET: Partial<PlanBuilderAnswers> = { split: 'ppl', sessions: 6, schedule: 'set', days: [0, 1, 2, 3, 4, 5] };

function draft(n: number, utc: string, over: Partial<PlanBuilderAnswers> = SET): PlanDraft {
  const a = answers(over);
  const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  return pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(n), at: at(utc) });
}

function apply(p: PlanDraft, n: number, utc: string, inUse: readonly PlanDraft[] = []): { plan: PlanDraft; superseded: PlanDraft[] } {
  const r = applyPlan(p, { expectedVersion: p.version, versionN: p.currentVersion, mode: 'replace', opId: op(n), at: at(utc), live: [], applied: inUse });
  if (r.kind !== 'write') throw new Error(r.kind);
  return { plan: r.next, superseded: r.supersede.map((x) => x.next) };
}

const ms = (iso: string) => Date.parse(iso);
const dayIndexOf = (p: PlanDraft, i: number) => ({ routineId: null, startedAtUtc: '', planDay: { planId: p.id, dayIndex: i } });
const ref = (p: PlanDraft, i: number, utc: string) => ({ ...dayIndexOf(p, i), startedAtUtc: utc });

describe('a re-apply over the running block continues it (Ben, 30 Oct)', () => {
  it('(b) applied Wed 28 (lead-in, week 1 = Mon 2 Nov); re-applied in week 2: the same start, week 2, the lead-in week’s and week 1’s workouts still count', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z').plan;
    const refs1 = [ref(first, 0, '2026-10-28T18:00:00.000Z'), ref(first, 1, '2026-11-03T18:00:00.000Z')];
    const before = pbBlockOfPlan(first, refs1, ms('2026-11-11T08:00:00.000Z'), TZ);
    expect(before).toMatchObject({ week: 2, of: 6, deload: false });
    expect(before?.leadIn).toBeUndefined();
    // Re-applied Wed 11 Nov (week 2) as a new plan document.
    const { plan: again, superseded } = apply(draft(3, '2026-11-11T09:00:00.000Z'), 4, '2026-11-11T09:00:00.000Z', [first]);
    expect(superseded.map((x) => x.status)).toEqual(['superseded']);
    expect(again.applied?.block?.startedAtUtc).toBe('2026-10-28T09:00:00.000Z');
    expect(pbBlockStartUtc(again)).toBe('2026-10-28T09:00:00.000Z');
    const after = pbBlockOfPlan(again, refs1, ms('2026-11-11T10:00:00.000Z'), TZ);
    expect(after).toMatchObject({ week: 2, of: 6, deload: false, mondays: ['2026-11-02', '2026-11-09'], daysDone: [[1], []] });
    expect(after?.leadIn).toBeUndefined();
    // The deload stays week 6: Mon 7 Dec once weeks 2–5 count.
    const weekly = ['2026-11-12', '2026-11-17', '2026-11-24', '2026-12-01'].map((d) => ref(again, 2, `${d}T18:00:00.000Z`));
    expect(pbBlockOfPlan(again, [...refs1, ...weekly], ms('2026-12-08T08:00:00.000Z'), TZ)).toMatchObject({ week: 6, deload: true });
  });

  it('in the lead-in week itself: still `Starts Mon 2 Nov`', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z').plan;
    const { plan: again } = apply(draft(3, '2026-10-29T09:00:00.000Z'), 4, '2026-10-29T09:00:00.000Z', [first]);
    expect(pbBlockOfPlan(again, [ref(first, 0, '2026-10-28T18:00:00.000Z')], ms('2026-10-30T19:00:00.000Z'), TZ)).toMatchObject({ week: 1, leadIn: { startsOn: '2026-11-02' }, daysDone: [[0]] });
  });

  it('a block that may be finished (Start next block), a Start again copy, a coach plan: a new block', () => {
    const first = apply(draft(1, '2026-10-26T07:00:00.000Z', { ...SET, weeks: 4 }), 2, '2026-10-26T07:00:00.000Z').plan;
    // 4 weeks after Mon 26 Oct: the block could be done, so the next plan starts its own.
    expect(pbContinuedBlock(draft(3, '2026-11-23T09:00:00.000Z'), first, '2026-11-23T09:00:00.000Z', TZ)).toBeNull();
    expect(pbContinuedBlock(draft(3, '2026-11-16T09:00:00.000Z'), first, '2026-11-16T09:00:00.000Z', TZ)).not.toBeNull();
    // Start again: a copy of an earlier plan is a different plan.
    const ended = { ...first, status: 'ended' as const, ended: { atUtc: '2026-10-27T07:00:00.000Z', opId: op(9), rotationOff: [] } } as unknown as PlanDraft;
    const inUse = apply(draft(5, '2026-10-28T07:00:00.000Z'), 6, '2026-10-28T07:00:00.000Z').plan;
    const r = restartPlan(ended, { expectedVersion: ended.version, mode: 'replace', opId: op(7), at: at('2026-10-29T07:00:00.000Z'), live: [], applied: [inUse] });
    if (r.kind !== 'write') throw new Error(r.kind);
    expect(r.apply.next.applied?.block).toBeUndefined();
    // A coach plan (no builder answers) never continues a builder block.
    const coach = draft(8, '2026-10-29T07:00:00.000Z');
    const noBuilder = { ...coach, versions: coach.versions.map((v) => ({ ...v, builder: undefined })) };
    expect(pbContinuedBlock(noBuilder, inUse, '2026-10-29T07:00:00.000Z', TZ)).toBeNull();
  });

  it('repair: a plan re-applied before the fix (no `applied.block`) gets the start of its chain, once', () => {
    const first = apply(draft(1, '2026-10-28T09:00:00.000Z'), 2, '2026-10-28T09:00:00.000Z').plan;
    const second = apply(draft(3, '2026-11-04T09:00:00.000Z'), 4, '2026-11-04T09:00:00.000Z', [first]);
    const third = apply(draft(5, '2026-11-11T09:00:00.000Z'), 6, '2026-11-11T09:00:00.000Z', [second.plan]);
    // As stored before the fix: no block on either re-apply.
    const strip = (p: PlanDraft): PlanDraft => ({ ...p, applied: p.applied === null ? null : { ...p.applied, block: undefined } });
    const all = [strip(second.superseded[0] ?? first), strip(third.superseded[0] ?? second.plan), strip(third.plan)];
    const now = all[2];
    if (now === undefined) throw new Error('no plan');
    expect(pbBlockOfPlan(now, [], ms('2026-11-12T08:00:00.000Z'), TZ)?.leadIn).toEqual({ startsOn: '2026-11-16' });
    const k = pbKeepBlockOf(now, all, TZ, '2026-11-12T08:00:00.000Z');
    expect(k?.next.applied?.block?.startedAtUtc).toBe('2026-10-28T09:00:00.000Z');
    expect(k?.next.applied?.block?.plans.map((p) => p.planId)).toEqual([first.id, second.plan.id]);
    expect(k?.next.version).toBe(now.version + 1);
    // The lead-in is Wed 28's again: no lead-in now (week 2; nothing counted yet, so the number holds at 1).
    const repaired = k?.next ?? now;
    expect(pbBlockOfPlan(repaired, [], ms('2026-11-12T08:00:00.000Z'), TZ)).toMatchObject({ week: 1 });
    expect(pbBlockOfPlan(repaired, [], ms('2026-11-12T08:00:00.000Z'), TZ)?.leadIn).toBeUndefined();
    // Idempotent: once stamped, nothing more.
    expect(pbKeepBlockOf(repaired, all, TZ, '2026-11-12T09:00:00.000Z')).toBeNull();
    // A plan applied with none before it: nothing to repair.
    expect(pbKeepBlockOf(first, [first], TZ, '2026-11-12T08:00:00.000Z')).toBeNull();
  });
});

describe('Set days: a variant done on its own weekday is that one (Ben, 30 Oct)', () => {
  const day = (routineId: string, name: string, dayIndex: number, main: string, exerciseIds: string[]): LinkPlanDay => ({ routineId, name, dayIndex, mainLiftExerciseId: main, exerciseIds });
  const DAYS = [
    day('push-a', 'Push A', 0, 'bench', ['bench', 'fly']),
    day('pull-a', 'Pull A', 1, 'row', ['row', 'rear_fly', 'lateral', 'hlr']),
    day('legs-a', 'Legs A', 2, 'squat', ['squat', 'rdl']),
    day('push-b', 'Push B', 3, 'ohp', ['ohp', 'dips']),
    day('pull-b', 'Pull B', 4, 'pullup', ['pullup', 'hammer']),
    day('legs-b', 'Legs B', 5, 'deadlift', ['deadlift', 'lunge']),
  ];
  const WEEKDAYS = new Map([0, 1, 2, 3, 4, 5].map((i) => [i, i] as const));
  const w = (title: string, exerciseIds: string[], lead: string, weekday: number): LinkWorkout => ({ sessionId: 's', title, exerciseIds, leadExerciseId: lead, weekday });
  const to = (v: ReturnType<typeof planDayLinkOf>) => (v.kind === 'linked' ? v.day.name : v.kind);

  it('Ben’s Tue 27 `Pull`: Pull A, whichever lift it led with; Friday’s `Pull`: Pull B', () => {
    expect(to(planDayLinkOf(w('Pull', ['row', 'pullup'], 'row', 1), DAYS, null, WEEKDAYS))).toBe('Pull A');
    expect(to(planDayLinkOf(w('Pull', ['pullup', 'row'], 'pullup', 1), DAYS, null, WEEKDAYS))).toBe('Pull A');
    expect(to(planDayLinkOf(w('Pull', ['row', 'pullup'], 'row', 4), DAYS, null, WEEKDAYS))).toBe('Pull B');
  });

  it('an explicit variant or Ben’s answer wins; off its weekday the lift it led with decides; Any days as before', () => {
    expect(to(planDayLinkOf(w('Pull B', ['row'], 'row', 1), DAYS, null, WEEKDAYS))).toBe('Pull B');
    expect(to(planDayLinkOf(w('Pull', ['row'], 'row', 1), DAYS, { sessionId: 's', answer: 'count', dayIndex: 4, routineId: 'pull-b', opId: 'o', atUtc: '2026-10-27T20:00:00.000Z' }, WEEKDAYS))).toBe('Pull B');
    // Sunday: no pull day scheduled, so the lift it led with (pull-ups → Pull B).
    expect(to(planDayLinkOf(w('Pull', ['pullup', 'row'], 'pullup', 6), DAYS, null, WEEKDAYS))).toBe('Pull B');
    // Any days (no weekdays): the 28 Oct rule (led with pull-ups → Pull B).
    expect(to(planDayLinkOf(w('Pull', ['pullup', 'row'], 'pullup', 1), DAYS, null, null))).toBe('Pull B');
  });

  it('assignPlanWeek: an off-plan pull on Tuesday fills Pull A even when it led with pull-ups', () => {
    const days: PlanWeekSlotDay[] = DAYS.map((d) => ({ routineId: d.routineId, name: d.name, bodyParts: d.name.startsWith('Pull') ? ['Back', 'Biceps'] : d.name.startsWith('Push') ? ['Chest', 'Shoulders', 'Triceps'] : ['Quads', 'Hamstrings'], mainLiftExerciseId: d.mainLiftExerciseId, weekday: d.dayIndex }));
    const pull: PlanWeekSlotWorkout = { sessionId: 'tue', routineId: null, startedAtUtc: '2026-10-27T18:00:00.000Z', groups: new Map([['Back', 6], ['Biceps', 2]]), leadExerciseId: 'pullup', weekday: 1 };
    expect([...assignPlanWeek(days, [pull]).keys()]).toEqual(['pull-a']);
    // Named for both variants (`variants`): the one on its weekday first.
    expect([...assignPlanWeek(days, [{ ...pull, variants: ['pull-a', 'pull-b'], weekday: 4 }]).keys()]).toEqual(['pull-b']);
  });
});
