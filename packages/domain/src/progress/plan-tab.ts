import { weekdayIndexOfDate } from '../calendar';
import { localDateText } from '../display';
import { PB_BLOCK_COPY, type PbBlockStripCell, type PbBlockView } from '../plan-builder/block';
import { pbWeekdayName } from '../plan-builder/edit';
import type { PlanOverview, PlanOverviewDay } from './plan-overview';

/**
 * Library › Plan v2 (Ben, 27 Oct: "don't really understand this page"; docs/design/plan-tab-v2.md). Pure view model
 * for the one page: a header (plan name, `Week 3 of 6 · deload in week 6`, the goal, the week chips with the current
 * week and the selected week as separate states) and **one** list of the selected week's days. It folds the old week
 * strip's day cards and the old rotation list together: each row has its state (✓ done with its date, Up next, to
 * do), the weekday on Set days plans, and the day's main lifts. Nothing is called missed (D19). No reads: every value
 * comes from `planOverview` and the block's week views the Plan tab already has.
 */

export const PLAN_TAB_VIEW_COPY = {
  week: (w: number, n: number) => `Week ${String(w)} of ${String(n)}`,
  deloadIn: (w: number) => `deload in week ${String(w)}`,
  deloadWeek: 'Deload week',
  blockDone: 'Block done',
  thisWeek: 'This week',
  weekN: (w: number) => `Week ${String(w)}`,
  deloadChip: (w: number) => `${String(w)} · Deload`,
  days: (text: string) => `${text} days`,
  sets: (text: string) => `${text} sets`,
  next: 'Next',
  more: 'More',
  dayActions: (name: string) => `${name}, more`,
  doToday: 'Do today',
  moveDay: 'Move day',
  /** The trailing swipe's short label. */
  move: 'Move',
  editPlan: 'Edit plan',
  startNext: 'Start next block',
  askCoach: 'Ask coach to change',
  editGoal: 'Edit goal',
  setGoal: 'Set goal',
  pause: 'Pause plan',
  /** (Redesign D1) The header ⋯ items. */
  pauseShort: 'Pause',
  askCoachShort: 'Ask coach',
  deload: 'Deload',
  resume: 'Resume',
  endPlan: 'End plan',
  endConfirm: 'End this plan?',
  cancel: 'Cancel',
} as const;

const WEEKDAY_SAID = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** `Mon 20 Oct`: a local date with its weekday (a done day's trailing text). */
export function planTabDoneText(date: string): string {
  return `${pbWeekdayName(weekdayIndexOfDate(date))} ${localDateText(date)}`;
}

export interface PlanTabChip {
  week: number;
  /** `3`, `6 · Deload`. */
  label: string;
  done: boolean;
  /** The block's week now (a dot under the number); not the same as selected. */
  current: boolean;
  /** The week the list shows (filled). */
  selected: boolean;
  deload: boolean;
  accessibilityLabel: string;
}

/** A week strip cell as the chip row draws it (the plan tab and the plan builder's edit preview share it). */
export function planTabChips(strip: readonly Pick<PbBlockStripCell, 'week' | 'deload' | 'state'>[], selected: number): PlanTabChip[] {
  return strip.map((c) => {
    const done = c.state === 'done';
    const current = c.state === 'current';
    const sel = c.week === selected;
    const said = [`Week ${String(c.week)}`, ...(c.deload ? ['deload'] : []), ...(done ? ['done'] : []), ...(current ? ['current'] : [])];
    return { week: c.week, label: c.deload ? PLAN_TAB_VIEW_COPY.deloadChip(c.week) : String(c.week), done, current, selected: sel, deload: c.deload, accessibilityLabel: said.join(', ') };
  });
}

export type PlanTabRowState = 'done' | 'next' | 'todo';

export interface PlanTabRow {
  key: string;
  /** The builder plan's day; null on a coach plan. */
  dayIndex: number | null;
  /** The plan day's workout (opens the day); null: none live (the row doesn't open). */
  routineId: string | null;
  /** 1-based, in the list's order (the Up next ring's number). */
  n: number;
  name: string;
  state: PlanTabRowState;
  /** `Mon · Squat`, `Bench press, Incline press`; null: nothing to say. */
  sub: string | null;
  /** `Mon 20 Oct` (done that week), `Last 12 Oct` (coach plans); null: nothing. */
  trailing: string | null;
  /** Set days plans: its weekday that week (Mon = 0); null on Any days. */
  weekday: number | null;
  /** This week's not-done days of a running block: `Do today` (its Today key) and `Move day` (weekdays it can take; null on Any days). */
  actions: { todayKey: string; moveTo: number[] | null } | null;
  accessibilityLabel: string;
}

export interface PlanTabView {
  title: string;
  /** `Week 3 of 6 · deload in week 6`, `Week 6 of 6 · Deload week`, `Block done`, `Since 13 Oct` (no length). */
  line: string;
  goal: string | null;
  goalAction: typeof PLAN_TAB_VIEW_COPY.editGoal | typeof PLAN_TAB_VIEW_COPY.setGoal;
  /** Null on a coach plan (no length). */
  chips: PlanTabChip[] | null;
  /** The week the list shows (null: no weeks). */
  selected: number | null;
  /** `This week`, `Week 5`. */
  listTitle: string;
  /** `2 of 5 days · 92% sets` on this week; else null. */
  listMeta: string | null;
  /** `Deload: lighter, fewer sets` on a deload week; else null. */
  note: string | null;
  /** The selected week is this week: this week's change and activities show under the list. */
  thisWeek: boolean;
  blockDone: boolean;
  /** `Edit plan` in ⋯ (the block runs); a done block has `Start next block` instead. */
  editable: boolean;
  rows: PlanTabRow[];
}

export interface PlanTabBlock {
  views: readonly Pick<PbBlockView, 'strip' | 'days' | 'note' | 'deloadWeeks'>[];
  /** The block week now (the last once done). */
  current: number;
  done: boolean;
  editable: boolean;
  actions: Readonly<Record<number, { todayKey: string; moveTo: number[] | null }>>;
  /** (Ben, 28 Oct) The lead-in week of a plan applied after its Monday: the Monday week 1 starts. Absent or null: none. */
  startsOn?: string | null | undefined;
}

export interface PlanTabInput {
  overview: Pick<PlanOverview, 'name' | 'since' | 'goal' | 'days' | 'daysThisWeek' | 'setsDone'>;
  /** Null on a coach plan (no weeks). */
  block: PlanTabBlock | null;
  /** The week picked on the chips; null: the current week. */
  selected: number | null;
}

/** The header's line from the block (`Week 3 of 6 · deload in week 6`). */
export function planTabLine(block: Pick<PlanTabBlock, 'current' | 'done' | 'startsOn'> & { of: number; deloadWeeks: readonly number[] }): string {
  if (block.done) return PLAN_TAB_VIEW_COPY.blockDone;
  // (Ben, 28 Oct) The lead-in: `Starts Mon 2 Nov`.
  if (block.startsOn != null) return PB_BLOCK_COPY.starts(block.startsOn);
  const week = PLAN_TAB_VIEW_COPY.week(block.current, block.of);
  if (block.deloadWeeks.includes(block.current)) return `${week} · ${PLAN_TAB_VIEW_COPY.deloadWeek}`;
  const next = block.deloadWeeks.find((w) => w > block.current);
  return next === undefined ? week : `${week} · ${PLAN_TAB_VIEW_COPY.deloadIn(next)}`;
}

function metaOf(o: PlanTabInput['overview']): string {
  return [PLAN_TAB_VIEW_COPY.days(o.daysThisWeek.text), ...(o.setsDone === null ? [] : [PLAN_TAB_VIEW_COPY.sets(o.setsDone.text)])].join(' · ');
}

function said(name: string, weekday: number | null, state: PlanTabRowState, trailing: string | null, n: number, of: number): string {
  return [
    name,
    `day ${String(n)} of ${String(of)}`,
    ...(weekday === null ? [] : [WEEKDAY_SAID[weekday] ?? '']),
    ...(state === 'next' ? ['next'] : []),
    state === 'done' ? (trailing === null ? 'done' : `done ${trailing}`) : trailing !== null ? trailing : 'not done',
  ].join(', ');
}

export function planTabView(input: PlanTabInput): PlanTabView {
  const o = input.overview;
  const goalAction = o.goal.action === 'Edit' ? PLAN_TAB_VIEW_COPY.editGoal : PLAN_TAB_VIEW_COPY.setGoal;
  const b = input.block;
  const n = b?.views.length ?? 0;
  if (b === null || n === 0) {
    // A coach plan: its days as a rotation, this week's ticks (no weeks).
    const rows = o.days.map((d, i): PlanTabRow => {
      const trailing = d.doneOn !== null ? planTabDoneText(d.doneOn) : d.when;
      const state: PlanTabRowState = d.state;
      return { key: d.routineId, dayIndex: null, routineId: d.routineId, n: i + 1, name: d.name, state, sub: null, trailing, weekday: null, actions: null, accessibilityLabel: said(d.name, null, state, trailing, i + 1, o.days.length) };
    });
    return { title: o.name, line: o.since, goal: o.goal.text, goalAction, chips: null, selected: null, listTitle: PLAN_TAB_VIEW_COPY.thisWeek, listMeta: metaOf(o), note: null, thisWeek: true, blockDone: false, editable: false, rows };
  }
  const current = Math.max(1, Math.min(n, b.current));
  const selected = Math.max(1, Math.min(n, input.selected ?? current));
  const view = b.views[selected - 1] ?? b.views[0];
  const deloadWeeks = b.views[0]?.deloadWeeks ?? [];
  const isThisWeek = selected === current;
  // The running block's week now: Up next and this week's ticks (an off-plan workout that trained a day counts too).
  const live = isThisWeek && !b.done;
  const routineOf = new Map<number, PlanOverviewDay>();
  for (const d of o.days) if (d.dayIndex !== null && !routineOf.has(d.dayIndex)) routineOf.set(d.dayIndex, d);
  const doneOf = new Map<number, PlanOverviewDay>();
  for (const d of o.days) if (d.dayIndex !== null && d.state === 'done' && !doneOf.has(d.dayIndex)) doneOf.set(d.dayIndex, d);
  const nextIndex = o.days.find((d) => d.next)?.dayIndex ?? null;
  const days = view?.days ?? [];
  const rows = days.map((d, i): PlanTabRow => {
    const ticked = live ? doneOf.get(d.index) : undefined;
    const done = d.done || ticked !== undefined;
    const doneOn = done ? (d.doneOn ?? ticked?.doneOn ?? null) : null;
    const state: PlanTabRowState = done ? 'done' : live && nextIndex === d.index ? 'next' : 'todo';
    const mains = d.rows.filter((r) => r.main).map((r) => r.name);
    const lifts = (mains.length > 0 ? mains : d.rows.slice(0, 2).map((r) => r.name)).join(', ');
    const sub = [...(d.weekday === null ? [] : [pbWeekdayName(d.weekday)]), ...(lifts === '' ? [] : [lifts])].join(' · ');
    const trailing = doneOn === null ? null : planTabDoneText(doneOn);
    const action = live && !done ? (b.actions[d.index] ?? null) : null;
    return {
      key: String(d.index),
      dayIndex: d.index,
      routineId: routineOf.get(d.index)?.routineId ?? null,
      n: i + 1,
      name: d.name,
      state,
      sub: sub === '' ? null : sub,
      trailing,
      weekday: d.weekday,
      actions: action,
      accessibilityLabel: said(d.name, d.weekday, state, trailing, i + 1, days.length),
    };
  });
  return {
    title: o.name,
    line: planTabLine({ current, done: b.done, of: n, deloadWeeks, startsOn: b.startsOn }),
    goal: o.goal.text,
    goalAction,
    chips: planTabChips(view?.strip ?? [], selected),
    selected,
    listTitle: live ? PLAN_TAB_VIEW_COPY.thisWeek : PLAN_TAB_VIEW_COPY.weekN(selected),
    listMeta: live ? metaOf(o) : null,
    note: view?.note ?? null,
    thisWeek: isThisWeek,
    blockDone: b.done,
    editable: b.editable,
    rows,
  };
}

export type PlanTabMenuKind = 'pause' | 'resume' | 'coach';

/**
 * (Redesign 27 Oct, D1) The header's `⋯` (iOS action sheet): `Pause` / `Resume` and `Ask coach`. Everything else that
 * changes the plan (Days and time, Goal, a day's exercises, End plan) is behind the full-width `Edit plan` at the
 * bottom of the page (`changePlanView`). `view` is kept for callers; the goal action lives in Change plan now.
 */
export function planTabMenu(_view: Pick<PlanTabView, 'goalAction'>, paused: boolean): { kind: PlanTabMenuKind; label: string }[] {
  const C = PLAN_TAB_VIEW_COPY;
  return [paused ? { kind: 'resume' as const, label: C.resume } : { kind: 'pause' as const, label: C.pauseShort }, { kind: 'coach' as const, label: C.askCoachShort }];
}

export type PlanWeekCircleState = 'done' | 'current' | 'later';

export interface PlanWeekCircle {
  week: number;
  state: PlanWeekCircleState;
  /** The number inside the circle; null on a done week (a ✓). */
  text: string | null;
  /** Picked (and not this week): a ring around it; the list shows that week. */
  selected: boolean;
  /** `Deload` under a deload week; else null. */
  caption: string | null;
  accessibilityLabel: string;
}

/**
 * (Redesign 27 Oct, D1) The plan's weeks as evenly spread circles: done = ✓ (green), this week = filled with its
 * number, later = outlined with its number, `Deload` under a deload week. Tapping one shows that week (`selected`).
 * Never colour alone: each says its state.
 */
export function planWeekCircles(chips: readonly Pick<PlanTabChip, 'week' | 'done' | 'current' | 'selected' | 'deload'>[]): PlanWeekCircle[] {
  return chips.map((c) => {
    const state: PlanWeekCircleState = c.done ? 'done' : c.current ? 'current' : 'later';
    const said = [`Week ${String(c.week)}`, ...(state === 'done' ? ['done'] : state === 'current' ? ['this week'] : []), ...(c.deload ? ['deload'] : [])];
    return { week: c.week, state, text: state === 'done' ? null : String(c.week), selected: c.selected && !c.current, caption: c.deload ? PLAN_TAB_VIEW_COPY.deload : null, accessibilityLabel: said.join(', ') };
  });
}

/**
 * The header card's visible plan action: `Edit plan` while the block runs, `Start next block` once it is done; null
 * on a coach plan (no builder answers to edit; `Ask coach to change` in `⋯`).
 */
export function planTabEditAction(view: Pick<PlanTabView, 'editable' | 'blockDone'>): { kind: 'edit' | 'next'; label: string } | null {
  if (view.blockDone) return { kind: 'next', label: PLAN_TAB_VIEW_COPY.startNext };
  return view.editable ? { kind: 'edit', label: PLAN_TAB_VIEW_COPY.editPlan } : null;
}

/**
 * A day row's actions (this week's not-done days): `Do today` (the leading swipe), and `Move day` on Set days plans
 * (the trailing swipe); the same in the row's `⋯`, long-press and VoiceOver actions. Empty: none.
 */
export function planTabDayMenu(row: Pick<PlanTabRow, 'actions'>): { kind: 'today' | 'move'; label: string }[] {
  const a = row.actions;
  if (a === null) return [];
  return [{ kind: 'today', label: PLAN_TAB_VIEW_COPY.doToday }, ...(a.moveTo === null ? [] : [{ kind: 'move' as const, label: PLAN_TAB_VIEW_COPY.moveDay }])];
}
