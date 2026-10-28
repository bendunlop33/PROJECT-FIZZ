import { describe, expect, it } from 'vitest';
import type { PlanDayLink, PlanDraft } from '@fizz/schemas';
import { answerPlanDayLink, daysNamed, linkRefs, planDayLinkOf, planDaysByDue, splitNameOf, undoPlanDayLink, type LinkPlanDay, type LinkWorkout, type PlanLinkEntry } from '../src/index';

/**
 * (Ben, 28 Oct) Imported and past-logged workouts count towards the plan: by name (`Pull …` → the Pull day; A/B
 * variants), else by the main lift and the exercises shared; unclear → a one-time `Count as Pull?` whose answer
 * (versioned, op ID, Undo) wins. The workout's sets never change (rule 2): the link is read beside it.
 */

const day = (routineId: string, name: string, dayIndex: number, main: string | null, exerciseIds: string[]): LinkPlanDay => ({ routineId, name, dayIndex, mainLiftExerciseId: main, exerciseIds });
const PPL = [day('r-push', 'Push', 0, 'bench', ['bench', 'incline', 'pushdown']), day('r-pull', 'Pull', 1, 'row', ['row', 'pulldown', 'curl']), day('r-legs', 'Legs', 2, 'squat', ['squat', 'rdl', 'leg_ext'])];
const AB = [day('r-pull-a', 'Pull A', 0, 'deadlift', ['deadlift', 'pulldown', 'curl']), day('r-push-a', 'Push A', 1, 'bench', ['bench', 'pushdown']), day('r-pull-b', 'Pull B', 2, 'row', ['row', 'pullup', 'hammer']), day('r-push-b', 'Push B', 3, 'ohp', ['ohp', 'dips'])];
const w = (title: string | null, exerciseIds: string[]): LinkWorkout => ({ sessionId: 's1', title, exerciseIds });
const linkedTo = (v: ReturnType<typeof planDayLinkOf>) => (v.kind === 'linked' ? `${v.day.routineId}/${v.by}` : v.kind === 'ask' ? `ask:${v.day.routineId}` : v.kind);

describe('split names', () => {
  it('reads the split word and the variant', () => {
    expect(splitNameOf('Pull · Barbell row')).toEqual({ base: 'pull', variant: null });
    expect(splitNameOf('Pull B')).toEqual({ base: 'pull', variant: 'b' });
    expect(splitNameOf('leg day')).toEqual({ base: 'legs', variant: null });
    expect(splitNameOf('Upper body')).toEqual({ base: 'upper', variant: null });
    expect(splitNameOf('Full body 2')).toEqual({ base: 'full body', variant: '2' });
    expect(splitNameOf('Chest & back')).toBeNull();
  });

  it('a name names a day: its own name exactly, else the same split word and variant', () => {
    expect(daysNamed('Pull · Barbell row', PPL).map((d) => d.name)).toEqual(['Pull']);
    expect(daysNamed('Pull', AB).map((d) => d.name)).toEqual(['Pull A', 'Pull B']);
    expect(daysNamed('Pull B · Row', AB).map((d) => d.name)).toEqual(['Pull B']);
    expect(daysNamed('Workout', PPL)).toEqual([]);
  });
});

describe('planDayLinkOf', () => {
  it('by name: the Tue 27 Oct import `Pull · Barbell row` is the Pull day', () => {
    expect(linkedTo(planDayLinkOf(w('Pull · Barbell row', ['row', 'pulldown']), PPL))).toBe('r-pull/name');
  });

  it('A/B variants: the variant named wins; without one, the day whose main lift it did', () => {
    expect(linkedTo(planDayLinkOf(w('Pull B', ['deadlift']), AB))).toBe('r-pull-b/name');
    expect(linkedTo(planDayLinkOf(w('Pull · Barbell row', ['row', 'pullup']), AB))).toBe('r-pull-b/name');
    expect(linkedTo(planDayLinkOf(w('Pull', ['deadlift', 'curl']), AB))).toBe('r-pull-a/name');
    // Neither main lift, nothing to tell them apart: asked, never guessed.
    expect(linkedTo(planDayLinkOf(w('Pull', ['face_pull']), AB))).toBe('ask:r-pull-a');
  });

  it('no name: by the main lift and the exercises shared, clearly ahead', () => {
    expect(linkedTo(planDayLinkOf(w(null, ['squat', 'rdl', 'leg_ext', 'calf']), PPL))).toBe('r-legs/lift');
    expect(linkedTo(planDayLinkOf(w('Workout', ['row', 'pulldown', 'curl']), PPL))).toBe('r-pull/lift');
  });

  it('unclear: something in common but not enough → asked once; nothing in common → not a plan day question', () => {
    // The main lift but little else.
    expect(linkedTo(planDayLinkOf(w(null, ['bench', 'squat', 'row', 'calf', 'lunge']), PPL))).toMatch(/^ask:/);
    // Two shared accessories, no main lift.
    expect(linkedTo(planDayLinkOf(w(null, ['pulldown', 'curl', 'shrug', 'face_pull']), PPL))).toBe('ask:r-pull');
    expect(linkedTo(planDayLinkOf(w(null, ['run']), PPL))).toBe('none');
    expect(linkedTo(planDayLinkOf(w(null, ['curl']), PPL))).toBe('none');
  });

  it('Ben’s answer wins: Count (that day) or Not a plan day', () => {
    const count: PlanDayLink = { sessionId: 's1', answer: 'count', dayIndex: 2, routineId: 'r-legs', opId: 'op-1', atUtc: '2026-10-28T10:00:00.000Z' };
    expect(linkedTo(planDayLinkOf(w('Pull', ['row']), PPL, count))).toBe('r-legs/ben');
    expect(linkedTo(planDayLinkOf(w('Pull', ['row']), PPL, { ...count, answer: 'not_plan_day', dayIndex: null, routineId: null }))).toBe('not_plan_day');
  });

  it('Up next moves on: a Pull import linked as the Pull day makes Legs next (A/B: both Pull days rest)', () => {
    const groups = new Map();
    const days = [
      { routineId: 'r-push', name: 'Push', bodyParts: ['Chest' as const] },
      { routineId: 'r-pull', name: 'Pull', bodyParts: ['Back' as const] },
      { routineId: 'r-legs', name: 'Legs', bodyParts: ['Quads' as const] },
    ];
    const push = { sessionId: 'p', routineId: 'r-push', startedAtUtc: '2026-10-26T08:00:00.000Z', groups };
    // Unlinked (its muscles unknown): Pull is still next.
    expect(planDaysByDue(days, [push, { sessionId: 'imp', routineId: null, startedAtUtc: '2026-10-27T12:00:00.000Z', groups }])[0]?.day.routineId).toBe('r-pull');
    // Linked: read as the Pull day's.
    const link = planDayLinkOf(w('Pull · Barbell row', ['row']), PPL);
    const routineId = link.kind === 'linked' ? link.day.routineId : null;
    expect(planDaysByDue(days, [push, { sessionId: 'imp', routineId, startedAtUtc: '2026-10-27T12:00:00.000Z', groups }])[0]?.day.routineId).toBe('r-legs');
  });
});

describe('linkRefs', () => {
  it('a linked workout carries its day’s template; an unlinked import stays out; an unlinked past log stays as it was', () => {
    const links = new Map<string, PlanLinkEntry>([
      ['imp-linked', { kind: 'linked', day: PPL[1] ?? day('x', 'x', 0, null, []), by: 'name', imported: true }],
      ['imp-ask', { kind: 'ask', day: PPL[1] ?? day('x', 'x', 0, null, []), imported: true }],
      ['past-none', { kind: 'none', imported: false }],
    ]);
    const refs = [
      { sessionId: 'imp-linked', routineId: null },
      { sessionId: 'imp-ask', routineId: null },
      { sessionId: 'past-none', routineId: null },
      { sessionId: 'live', routineId: 'r-push' },
    ];
    expect(linkRefs(refs, links)).toEqual([
      { sessionId: 'imp-linked', routineId: 'r-pull' },
      { sessionId: 'past-none', routineId: null },
      { sessionId: 'live', routineId: 'r-push' },
    ]);
  });
});

describe('Ben’s answer: versioned, op ID, Undo (rule 5)', () => {
  const plan = (): PlanDraft =>
    ({
      id: 'plan-1',
      ownerId: 'owner',
      status: 'applied',
      name: '3-day plan',
      currentVersion: 1,
      versions: [],
      applied: { versionN: 1, atUtc: '2026-10-20T08:00:00.000Z', opId: 'apply', made: [], rotationBefore: [] },
      undoneAtUtc: null,
      opIds: ['apply'],
      createdAt: { utc: '2026-10-20T08:00:00.000Z', tz: 'Europe/London' },
      tz: 'Europe/London',
      expiresAtUtc: '2026-11-03T08:00:00.000Z',
      version: 3,
      updatedAtUtc: '2026-10-20T08:00:00.000Z',
    }) as unknown as PlanDraft;
  const at = { utc: '2026-10-28T09:00:00.000Z' };

  it('Count writes one answer; a retry replays; an older version is refused; Undo puts back what was there', () => {
    const p = plan();
    const c = answerPlanDayLink(p, { expectedVersion: 3, opId: 'count-1', at, sessionId: 'imp', answer: 'count', dayIndex: 1, routineId: 'r-pull' });
    if (c.kind !== 'write') throw new Error(c.kind);
    expect(c.next.version).toBe(4);
    expect(c.next.dayLinks).toEqual([{ sessionId: 'imp', answer: 'count', dayIndex: 1, routineId: 'r-pull', opId: 'count-1', atUtc: at.utc }]);
    expect(answerPlanDayLink(c.next, { expectedVersion: 4, opId: 'count-1', at, sessionId: 'imp', answer: 'count', dayIndex: 1, routineId: 'r-pull' }).kind).toBe('duplicate');
    expect(answerPlanDayLink(c.next, { expectedVersion: 3, opId: 'other', at, sessionId: 'imp', answer: 'not_plan_day', dayIndex: null, routineId: null }).kind).toBe('stale');
    // Changed to Not a plan day, then Undo: Count again.
    const n = answerPlanDayLink(c.next, { expectedVersion: 4, opId: 'no-1', at, sessionId: 'imp', answer: 'not_plan_day', dayIndex: null, routineId: null });
    if (n.kind !== 'write') throw new Error(n.kind);
    expect(n.next.dayLinks?.map((l) => l.answer)).toEqual(['not_plan_day']);
    const u = undoPlanDayLink(n.next, { expectedVersion: 5, opId: 'undo-1', at, targetOpId: 'no-1' });
    if (u.kind !== 'write') throw new Error(u.kind);
    expect(u.next.dayLinks?.map((l) => l.answer)).toEqual(['count']);
    // A second Undo (or one from an older read) is stale; Undo of the first answer clears it.
    expect(undoPlanDayLink(u.next, { expectedVersion: 6, opId: 'undo-2', at, targetOpId: 'no-1' }).kind).toBe('stale');
    const u0 = undoPlanDayLink(c.next, { expectedVersion: 4, opId: 'undo-0', at, targetOpId: 'count-1' });
    expect(u0.kind === 'write' && u0.next.dayLinks).toEqual([]);
  });

  it('Count needs a plan day; a plan not in use is refused', () => {
    expect(answerPlanDayLink(plan(), { expectedVersion: 3, opId: 'x', at, sessionId: 'imp', answer: 'count', dayIndex: null, routineId: null }).kind).toBe('invalid');
    expect(answerPlanDayLink({ ...plan(), status: 'ended' } as PlanDraft, { expectedVersion: 3, opId: 'y', at, sessionId: 'imp', answer: 'not_plan_day', dayIndex: null, routineId: null }).kind).toBe('stale');
  });
});
