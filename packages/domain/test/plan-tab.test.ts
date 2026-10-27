import { describe, expect, it } from 'vitest';

import {
  pbBlockWeekOf,
  planTabChips,
  planTabDayMenu,
  planTabDoneText,
  planTabEditAction,
  planTabLine,
  planTabMenu,
  planTabView,
  type PbBlockDay,
  type PbBlockStripCell,
  type PlanOverviewDay,
  type PlanTabBlock,
  type PlanTabInput,
} from '../src/index';

/**
 * (Ben, 27 Oct: "don't really understand this page") Library › Plan v2's view model (plan-tab-v2.md): the header line,
 * the week chips with current and selected kept apart, one list of the selected week's days with each day's state,
 * its weekday on Set days plans and main lifts, and the `⋯` menus keeping every action the old page had.
 */

const TZ = 'Europe/London';
/** Dates print `26 Oct` with a no-break space; the expectations here use a plain one. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' ')) as T;
const view = (input: PlanTabInput) => plain(planTabView(input));
const NAMES = ['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B'] as const;
const MAINS = ['Bench press', 'Deadlift', 'Squat', 'Overhead press', 'Barbell row'] as const;

const row = (name: string, main: boolean) => ({ key: name, exerciseId: name, name, main, line: '3 × 8', kg: main ? null : '30', est: false, superset: null });

function day(index: number, o: { done?: boolean; doneOn?: string | null; weekday?: number | null; noMain?: boolean } = {}): PbBlockDay {
  const rows = o.noMain === true ? [row('Leg curl', false), row('Calf raise', false), row('Plank', false)] : [row(MAINS[index] ?? 'Lift', true), row('Accessory', false)];
  return { index, name: NAMES[index] ?? `Day ${String(index + 1)}`, weekday: o.weekday ?? null, done: o.done ?? false, doneOn: o.doneOn ?? null, rows };
}

/** A 6-week Standard block (deload week 6) in week `current`, weeks before it done. */
function block(current: number, o: { done?: boolean; days?: (w: number) => PbBlockDay[]; actions?: PlanTabBlock['actions']; deloads?: number[]; weeks?: number } = {}): PlanTabBlock {
  const n = o.weeks ?? 6;
  const deloads = o.deloads ?? [n];
  const strip = (): PbBlockStripCell[] =>
    Array.from({ length: n }, (_, i) => {
      const w = i + 1;
      const state = o.done === true || w < current ? ('done' as const) : w === current ? ('current' as const) : ('todo' as const);
      return { week: w, deload: deloads.includes(w), state, selected: false, accessibilityLabel: '' };
    });
  return {
    views: Array.from({ length: n }, (_, i) => ({ strip: strip(), days: o.days?.(i + 1) ?? [0, 1, 2, 3, 4].map((d) => day(d)), note: deloads.includes(i + 1) ? 'Deload: lighter, fewer sets' : null, deloadWeeks: deloads })),
    current: Math.min(current, n),
    done: o.done ?? false,
    editable: o.done !== true,
    actions: o.actions ?? {},
  };
}

function oday(i: number, o: Partial<PlanOverviewDay> = {}): PlanOverviewDay {
  return { routineId: `r${String(i)}`, n: i + 1, name: NAMES[i] ?? '', state: 'todo', next: false, when: null, doneOn: null, dayIndex: i, accessibilityLabel: '', ...o };
}

function overview(days: PlanOverviewDay[] = [0, 1, 2, 3, 4].map((i) => oday(i))): PlanTabInput['overview'] {
  return {
    name: 'Push / Pull / Legs',
    since: 'Since 13 Oct',
    goal: { text: 'Goal: Strength · 5 days a week · 60 min', action: 'Edit' },
    days,
    daysThisWeek: { done: 1, of: 5, text: '1 of 5' },
    setsDone: { pct: 92, text: '92%' },
  };
}

describe('header line (planTabLine)', () => {
  it('`Week 3 of 6 · deload in week 6`; in the deload week `Deload week`; done `Block done`', () => {
    expect(planTabLine({ current: 3, done: false, of: 6, deloadWeeks: [6] })).toBe('Week 3 of 6 · deload in week 6');
    expect(planTabLine({ current: 6, done: false, of: 6, deloadWeeks: [6] })).toBe('Week 6 of 6 · Deload week');
    expect(planTabLine({ current: 6, done: true, of: 6, deloadWeeks: [6] })).toBe('Block done');
  });

  it('Push (every 4th): the next deload ahead; Maintain (none) or past the last: just the week', () => {
    expect(planTabLine({ current: 5, done: false, of: 12, deloadWeeks: [4, 8, 12] })).toBe('Week 5 of 12 · deload in week 8');
    expect(planTabLine({ current: 3, done: false, of: 6, deloadWeeks: [] })).toBe('Week 3 of 6');
    expect(planTabLine({ current: 5, done: false, of: 6, deloadWeeks: [4] })).toBe('Week 5 of 6');
  });
});

describe('week chips: current and selected are separate states', () => {
  it('opens on the current week: current and selected on the same chip; the deload chip says so', () => {
    const v = view({ overview: overview(), block: block(3), selected: null });
    expect(v.selected).toBe(3);
    expect(v.chips?.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6 · Deload']);
    expect(v.chips?.find((c) => c.week === 3)).toMatchObject({ current: true, selected: true, done: false });
    expect(v.chips?.filter((c) => c.done).map((c) => c.week)).toEqual([1, 2]);
  });

  it('picking week 5: week 5 is selected, week 3 stays current; VoiceOver hears both', () => {
    const v = view({ overview: overview(), block: block(3), selected: 5 });
    expect(v.chips?.find((c) => c.week === 5)).toMatchObject({ current: false, selected: true });
    expect(v.chips?.find((c) => c.week === 3)).toMatchObject({ current: true, selected: false, accessibilityLabel: 'Week 3, current' });
    expect(v.chips?.find((c) => c.week === 6)?.accessibilityLabel).toBe('Week 6, deload');
    expect(v.chips?.find((c) => c.week === 1)?.accessibilityLabel).toBe('Week 1, done');
  });

  it('a week out of range is clamped; the shared chip builder agrees with the strip', () => {
    expect(view({ overview: overview(), block: block(3), selected: 99 }).selected).toBe(6);
    expect(view({ overview: overview(), block: block(3), selected: 0 }).selected).toBe(1);
    const chips = planTabChips([{ week: 1, deload: false, state: 'done' }, { week: 2, deload: true, state: 'current' }], 1);
    expect(chips).toEqual([
      { week: 1, label: '1', done: true, current: false, selected: true, deload: false, accessibilityLabel: 'Week 1, done' },
      { week: 2, label: '2 · Deload', done: false, current: true, selected: false, deload: true, accessibilityLabel: 'Week 2, deload, current' },
    ]);
  });
});

describe('one list of days (states, dates, weekday, main lifts)', () => {
  it('this week: ✓ with its date, Up next with its ring number, to do; header `This week` with days and sets', () => {
    const days = [oday(0), oday(1), oday(2, { state: 'done', doneOn: '2026-10-26', when: 'Mon' }), oday(3, { state: 'next', next: true }), oday(4)];
    const b = block(1, { days: (w) => (w === 1 ? [day(0), day(1), day(2, { done: true, doneOn: '2026-10-26' }), day(3), day(4)] : [0, 1, 2, 3, 4].map((d) => day(d))) });
    const v = view({ overview: overview(days), block: b, selected: null });
    expect(v.title).toBe('Push / Pull / Legs');
    expect(v.line).toBe('Week 1 of 6 · deload in week 6');
    expect(v.listTitle).toBe('This week');
    expect(v.listMeta).toBe('1 of 5 days · 92% sets');
    expect(v.thisWeek).toBe(true);
    expect(v.rows.map((r) => [r.name, r.state, r.trailing])).toEqual([
      ['Push A', 'todo', null],
      ['Pull A', 'todo', null],
      ['Legs', 'done', 'Mon 26 Oct'],
      ['Push B', 'next', null],
      ['Pull B', 'todo', null],
    ]);
    expect(v.rows[3]).toMatchObject({ n: 4, routineId: 'r3', sub: 'Overhead press' });
    expect(v.rows[2]?.accessibilityLabel).toBe('Legs, day 3 of 5, done Mon 26 Oct');
    expect(v.rows[3]?.accessibilityLabel).toBe('Push B, day 4 of 5, next, not done');
  });

  it('each day appears once (the old page listed them twice)', () => {
    const v = view({ overview: overview(), block: block(2), selected: null });
    expect(v.rows.map((r) => r.name)).toEqual([...NAMES]);
    expect(new Set(v.rows.map((r) => r.key)).size).toBe(5);
  });

  it('an off-plan workout that ticked a day this week ticks it here too (with its date)', () => {
    const days = [oday(0, { state: 'done', doneOn: '2026-10-28', when: 'Wed' }), oday(1), oday(2), oday(3), oday(4)];
    const v = view({ overview: overview(days), block: block(1), selected: null });
    expect(v.rows[0]).toMatchObject({ state: 'done', trailing: 'Wed 28 Oct' });
  });

  it('Set days plans: the weekday leads the secondary line; a day with no main lift shows its first two exercises', () => {
    const b = block(2, { days: () => [day(0, { weekday: 0 }), day(1, { weekday: 1 }), day(2, { weekday: 3, noMain: true })] });
    const v = view({ overview: overview(), block: b, selected: null });
    expect(v.rows.map((r) => r.sub)).toEqual(['Mon · Bench press', 'Tue · Deadlift', 'Thu · Leg curl, Calf raise']);
    expect(v.rows[0]?.accessibilityLabel).toContain('Monday');
    expect(v.rows[2]?.weekday).toBe(3);
  });

  it('another week: `Week 5`, no Up next, no this-week ticks, no actions, no meta; the deload week has its note', () => {
    const days = [oday(0, { state: 'done', doneOn: '2026-10-26' }), oday(1, { state: 'next', next: true }), oday(2), oday(3), oday(4)];
    const actions = { 1: { todayKey: 'plan:p:1', moveTo: null } };
    const later = view({ overview: overview(days), block: block(1, { actions }), selected: 5 });
    expect(later.listTitle).toBe('Week 5');
    expect(later.listMeta).toBeNull();
    expect(later.thisWeek).toBe(false);
    expect(later.rows.every((r) => r.state === 'todo' && r.actions === null && r.trailing === null)).toBe(true);
    expect(later.note).toBeNull();
    const deload = view({ overview: overview(days), block: block(1), selected: 6 });
    expect(deload.note).toBe('Deload: lighter, fewer sets');
  });

  it('a done week: its own ticks and dates; days not done are plain (never called missed)', () => {
    const b = block(3, { days: (w) => (w === 1 ? [day(0, { done: true, doneOn: '2026-10-13' }), day(1), day(2, { done: true, doneOn: '2026-10-16' })] : [day(0), day(1), day(2)]) });
    const v = view({ overview: overview(), block: b, selected: 1 });
    expect(v.rows.map((r) => [r.state, r.trailing])).toEqual([
      ['done', 'Tue 13 Oct'],
      ['todo', null],
      ['done', 'Fri 16 Oct'],
    ]);
    expect(v.rows[1]?.accessibilityLabel).toBe('Pull A, day 2 of 3, not done');
    expect(JSON.stringify(v)).not.toMatch(/missed/i);
  });

  it('this week’s not-done days carry their actions (Do today, Move day on Set days); done days never do (rule 2)', () => {
    const b = block(1, { days: () => [day(0, { done: true, doneOn: '2026-10-26', weekday: 0 }), day(1, { weekday: 2 }), day(2, { weekday: 4 })], actions: { 1: { todayKey: 'plan:p:1', moveTo: [1, 2, 3] }, 2: { todayKey: 'plan:p:2', moveTo: null } } });
    const v = view({ overview: overview(), block: b, selected: null });
    expect(v.rows.map((r) => r.actions)).toEqual([null, { todayKey: 'plan:p:1', moveTo: [1, 2, 3] }, { todayKey: 'plan:p:2', moveTo: null }]);
    expect(planTabDayMenu(v.rows[0] ?? { actions: null })).toEqual([]);
    expect(planTabDayMenu(v.rows[1] ?? { actions: null }).map((x) => x.kind)).toEqual(['today', 'move']);
    expect(planTabDayMenu(v.rows[2] ?? { actions: null }).map((x) => x.kind)).toEqual(['today']);
  });

  it('each row opens its own workout; a plan day with two workouts opens the first; one with none does not open', () => {
    const days = [oday(0), oday(1, { routineId: 'r1a' }), oday(1, { routineId: 'r1b', n: 3 }), oday(3)];
    const v = view({ overview: overview(days), block: block(1, { days: () => [day(0), day(1), day(2)] }), selected: null });
    expect(v.rows.map((r) => r.routineId)).toEqual(['r0', 'r1a', null]);
  });

  it('paused: no Up next (the overview has none), the rows still show', () => {
    const v = view({ overview: overview(), block: block(2), selected: null });
    expect(v.rows.some((r) => r.state === 'next')).toBe(false);
    expect(v.rows).toHaveLength(5);
  });

  it('block done: `Block done`, the last week shown, no Up next or actions; ⋯ offers Start next block, not Edit plan', () => {
    const days = [oday(0, { state: 'next', next: true }), oday(1), oday(2), oday(3), oday(4)];
    const v = view({ overview: overview(days), block: block(7, { done: true, actions: { 0: { todayKey: 'k', moveTo: null } } }), selected: null });
    expect(v.line).toBe('Block done');
    expect(v.blockDone).toBe(true);
    expect(v.selected).toBe(6);
    expect(v.chips?.every((c) => c.done && !c.current)).toBe(true);
    expect(v.rows.every((r) => r.state !== 'next' && r.actions === null)).toBe(true);
    expect(planTabEditAction(v)).toEqual({ kind: 'next', label: 'Start next block' });
    expect(planTabMenu(v, false).map((x) => x.kind)).toEqual(['pause', 'coach', 'goal', 'end']);
  });
});

describe('coach plans (no length)', () => {
  it('no chips; the line is `Since …`; the rotation’s ticks, Up next and `Last …` in one list', () => {
    const days = [oday(0, { state: 'done', doneOn: '2026-10-27', when: 'Tue', dayIndex: null }), oday(1, { state: 'next', next: true, when: 'Last 21 Oct', dayIndex: null }), oday(2, { dayIndex: null })];
    const v = view({ overview: overview(days), block: null, selected: 4 });
    expect(v).toMatchObject({ line: 'Since 13 Oct', chips: null, selected: null, listTitle: 'This week', listMeta: '1 of 5 days · 92% sets', thisWeek: true, editable: false });
    expect(v.rows.map((r) => [r.state, r.trailing])).toEqual([
      ['done', 'Tue 27 Oct'],
      ['next', 'Last 21 Oct'],
      ['todo', null],
    ]);
    expect(planTabEditAction(v)).toBeNull();
    expect(planTabMenu(v, false).map((x) => x.kind)).toEqual(['pause', 'coach', 'goal', 'end']);
  });
});

describe('every action stays reachable: Edit plan visible, the rest in ⋯ (UX review 27 Oct §P4)', () => {
  it('running block: `Edit plan` on the card; ⋯ has Pause plan, Ask coach to change, Edit goal, End plan; paused: Resume; no goal: Set goal', () => {
    const v = view({ overview: overview(), block: block(2), selected: null });
    expect(planTabEditAction(v)).toEqual({ kind: 'edit', label: 'Edit plan' });
    expect(planTabMenu(v, false).map((x) => x.label)).toEqual(['Pause plan', 'Ask coach to change', 'Edit goal', 'End plan']);
    expect(planTabMenu(v, true).map((x) => x.label)).toEqual(['Resume', 'Ask coach to change', 'Edit goal', 'End plan']);
    const noGoal = view({ overview: { ...overview(), goal: { text: null, action: 'Set goal' } }, block: block(2), selected: null });
    expect(noGoal.goal).toBeNull();
    expect(planTabMenu(noGoal, false).map((x) => x.label)).toContain('Set goal');
  });
});

describe('done dates', () => {
  it('`Mon 26 Oct` from a local date', () => {
    expect(plain(planTabDoneText('2026-10-26'))).toBe('Mon 26 Oct');
    expect(plain(planTabDoneText('2026-11-01'))).toBe('Sun 1 Nov');
  });

  it('the block keeps the first local date each plan day was done that week (zone-aware)', () => {
    const b = pbBlockWeekOf({
      answers: { weeks: 6, effort: 'standard' },
      appliedAtUtc: '2026-10-14T09:00:00.000Z',
      // 22:30 UTC on Sat 17 Oct is 23:30 Saturday in London (BST); the later Push A doesn't move its date.
      workouts: [
        { startedAtUtc: '2026-10-16T08:00:00Z', dayIndex: 0 },
        { startedAtUtc: '2026-10-17T08:00:00Z', dayIndex: 0 },
        { startedAtUtc: '2026-10-17T22:30:00Z', dayIndex: 1 },
        { startedAtUtc: '2026-10-20T08:00:00Z', dayIndex: null },
      ],
      nowMs: Date.parse('2026-10-21T08:00:00Z'),
      tz: TZ,
    });
    expect(b.doneOn).toEqual([{ 0: '2026-10-16', 1: '2026-10-17' }, {}]);
  });
});
