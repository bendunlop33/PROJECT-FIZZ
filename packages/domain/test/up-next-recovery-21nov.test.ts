import { describe, expect, it } from 'vitest';
import type { MuscleGroup } from '@fizz/schemas';

import { behindPick, behindRecovering, planDaysTypeLastTrained, setDaysTieRank, upNextOrder, type BehindDay, type PlanDueDay, type PlanDueWorkout } from '../src/index';

/**
 * (Ben, 21 Nov, build 576: "if I missed two sessions it says Legs when I did legs 2 sessions ago and it should be
 * Pull") Set days: Mon Push A, Tue Pull A, Wed Legs A, Thu Push B, Fri Pull B, Sat Legs B. Last week all six (Mon 9 –
 * Sat 14). This week: Mon 16 Pull A, Thu 19 Legs A, Fri 20 a session that isn't a plan day (bench and rows; the strip
 * counts it as Push A). Sat 21 morning.
 */
const TZ = 'Europe/London';
const DAYS: PlanDueDay[] = [
  { routineId: 'pushA', name: 'Push A', bodyParts: ['Chest', 'Shoulders', 'Triceps'] },
  { routineId: 'pullA', name: 'Pull A', bodyParts: ['Back', 'Biceps'] },
  { routineId: 'legsA', name: 'Legs A', bodyParts: ['Quads', 'Glutes'] },
  { routineId: 'pushB', name: 'Push B', bodyParts: ['Chest', 'Shoulders', 'Triceps'] },
  { routineId: 'pullB', name: 'Pull B', bodyParts: ['Back', 'Biceps'] },
  { routineId: 'legsB', name: 'Legs B', bodyParts: ['Hamstrings', 'Glutes'] },
];
const WD: Record<string, number> = { pushA: 0, pullA: 1, legsA: 2, pushB: 3, pullB: 4, legsB: 5 };
const g = (o: Partial<Record<MuscleGroup, number>>) => new Map(Object.entries(o)) as Map<MuscleGroup, number>;
const GROUPS: Record<string, Map<MuscleGroup, number>> = {
  pushA: g({ Chest: 6, Shoulders: 3, Triceps: 3 }),
  pushB: g({ Chest: 6, Shoulders: 3, Triceps: 3 }),
  pullA: g({ Back: 8, Biceps: 3 }),
  pullB: g({ Back: 8, Biceps: 3 }),
  legsA: g({ Quads: 8, Glutes: 4 }),
  legsB: g({ Hamstrings: 6, Glutes: 4 }),
};
const plan = (day: string, date: string): PlanDueWorkout => ({ sessionId: `${day}-${date}`, routineId: day, startedAtUtc: `${date}T18:00:00.000Z`, groups: GROUPS[day] ?? new Map() });
const LAST_WEEK = ['pushA', 'pullA', 'legsA', 'pushB', 'pullB', 'legsB'].map((d, i) => plan(d, `2026-11-${String(9 + i).padStart(2, '0')}`));
/** Fri 20: 3 sets of bench, 2 of rows (40% back: a third of its sets, so the split rule says it trained pull too). */
const FRI_UPPER: PlanDueWorkout = { sessionId: 'fri', routineId: null, startedAtUtc: '2026-11-20T18:00:00.000Z', groups: g({ Chest: 3, Back: 2 }) };
const THIS_WEEK = [plan('pullA', '2026-11-16'), plan('legsA', '2026-11-19')];

function upNext(workouts: PlanDueWorkout[], done: string[], planning = 5): string[] {
  const last = planDaysTypeLastTrained(DAYS, workouts, TZ);
  return upNextOrder(DAYS.filter((d) => !done.includes(d.routineId)), (d) => ({ lastTrained: last.get(d.routineId) ?? null, state: 'open', tie: setDaysTieRank(WD[d.routineId] ?? null, planning) })).map((d) => d.routineId);
}

describe('Up next counts an off-plan workout for the day it mainly trained (Ben, 21 Nov)', () => {
  it('Ben’s week (Fri bench and rows): Pull B, not Legs B; pull last trained Mon', () => {
    const ws = [...LAST_WEEK, ...THIS_WEEK, FRI_UPPER];
    const last = planDaysTypeLastTrained(DAYS, ws, TZ);
    expect({ pull: last.get('pullB'), legs: last.get('legsB'), push: last.get('pushB') }).toEqual({ pull: '2026-11-16', legs: '2026-11-19', push: '2026-11-20' });
    expect(upNext(ws, ['pullA', 'legsA', 'pushA'])).toEqual(['pullB', 'legsB', 'pushB']);
  });
  it('Fri a Push A workout: the same; Fri nothing: push (last week) first, legs (Thu) last', () => {
    expect(upNext([...LAST_WEEK, ...THIS_WEEK, plan('pushA', '2026-11-20')], ['pullA', 'legsA', 'pushA'])[0]).toBe('pullB');
    expect(upNext([...LAST_WEEK, ...THIS_WEEK], ['pullA', 'legsA'])).toEqual(['pushA', 'pushB', 'pullB', 'legsB']);
  });
  it('a plan workout Ben turned into another day’s session still counts for both (31 Oct, unchanged)', () => {
    // Started as Push A, mostly rows: push and pull both trained.
    const turned: PlanDueWorkout = { ...plan('pushA', '2026-11-20'), groups: g({ Back: 8, Chest: 2 }) };
    const last = planDaysTypeLastTrained(DAYS, [...LAST_WEEK, turned], TZ);
    expect([last.get('pushB'), last.get('pullB')]).toEqual(['2026-11-20', '2026-11-20']);
  });
  it('an off-plan pull session counts as pull', () => {
    const rows: PlanDueWorkout = { sessionId: 'rows', routineId: null, startedAtUtc: '2026-11-20T18:00:00.000Z', groups: g({ Back: 6, Biceps: 2 }) };
    expect(planDaysTypeLastTrained(DAYS, [...LAST_WEEK, rows], TZ).get('pullA')).toBe('2026-11-20');
  });
});

describe('MS4: a day trained in the last 2 days never comes before one that wasn’t (Ben, 21 Nov)', () => {
  const day = (key: string, main: string, slots: [string, number][], typeLastTrained: string | null): BehindDay => ({ key, name: key, mainLiftIds: [main], slots: slots.map(([exerciseId, sets]) => ({ exerciseId, sets })), typeLastTrained });
  const GROUP: Record<string, string | undefined> = { rdl: 'Hamstrings', curl: 'Hamstrings', row: 'Back', bench: 'Chest' };
  const groupOf = (id: string) => GROUP[id] ?? null;
  // Up next order: Pull B, Legs B, Push B. Legs B's RDL and hamstrings are new this week (MS4-1, MS4-2 would win).
  const days = [day('pullB', 'row', [['row', 6]], '2026-11-16'), day('legsB', 'rdl', [['rdl', 4], ['curl', 3]], '2026-11-19'), day('pushB', 'bench', [['bench', 6]], '2026-11-20')];
  const facts = { weekDirect: new Map([['Back', 8], ['Chest', 3]]), mainTrained: new Set(['row']), yesterdayDirect: new Map([['Chest', 3]]) };
  it('Ben’s Sat 21: Pull B first (legs Thu, push Fri still recovering)', () => {
    const s = behindPick({ days, later: () => [], facts: { ...facts, today: '2026-11-21' }, groupOf });
    expect(s.map((x) => x.key)).toEqual(['pullB', 'legsB', 'pushB']);
    expect(s.map((x) => x.recovering)).toEqual([false, true, true]);
  });
  it('legs three days ago is rested: MS4’s order as approved (main lifts first)', () => {
    const s = behindPick({ days, later: () => [], facts: { ...facts, today: '2026-11-22' }, groupOf });
    expect(s[0]?.key).toBe('legsB');
  });
  it('no date given: MS4 as before', () => {
    expect(behindPick({ days, later: () => [], facts, groupOf })[0]?.key).toBe('legsB');
  });
  it('recovering: today, yesterday and the day before; not three days ago or never', () => {
    expect(['2026-11-21', '2026-11-20', '2026-11-19', '2026-11-18'].map((d) => behindRecovering(d, '2026-11-21'))).toEqual([true, true, true, false]);
    expect(behindRecovering(null, '2026-11-21')).toBe(false);
  });
});
