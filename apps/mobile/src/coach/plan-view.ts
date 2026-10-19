import type { PlanCardData, PlanDayData } from '../services/plan-services';

/**
 * The coach plan card in the sheet (Ben, 19 Oct): one card with every day;
 * tap a day to see its exercises, sets and loads; `Apply` asks `Replace my
 * workouts` or `Add alongside`; `Undo` after. Values only (minimal copy,
 * Ben 10 Oct): no rule labels, no reassurance lines. Pure; the screen only
 * draws it.
 */

export const PLAN_COPY = {
  apply: 'Apply',
  replace: 'Replace my workouts',
  add: 'Add alongside',
  undo: 'Undo',
  cancel: 'Cancel',
  edit: 'Edit',
  why: 'Why?',
  applied: 'Applied',
  est: 'est.',
  held: 'held',
} as const;

export interface PlanCardView {
  title: string;
  /** `4 days · Main Gym`. */
  subtitle: string;
  days: { index: number; name: string; line: string; leftOut: string | null; accessibilityLabel: string }[];
  /** The coach's reasons (claim- and number-checked), or null. */
  rationale: string | null;
  /** What the card's button row shows. */
  action: { kind: 'apply' } | { kind: 'undo'; text: string } | { kind: 'ended'; text: string };
  /** `Replace my workouts` takes these out of the rotation (they stay in Workouts); empty: nothing to replace. */
  replaces: string | null;
}

export function planCardView(d: PlanCardData): PlanCardView {
  const action: PlanCardView['action'] =
    d.state.kind === 'open'
      ? { kind: 'apply' }
      : d.state.kind === 'applied'
        ? { kind: 'undo', text: PLAN_COPY.applied }
        : d.state.kind === 'replaced'
          ? { kind: 'ended', text: `Replaced by version ${String(d.state.byN)}` }
          : d.state.kind === 'superseded'
            ? { kind: 'ended', text: 'Replaced by a newer plan' }
            : d.state.kind === 'ended'
              ? { kind: 'ended', text: 'Ended' }
              : d.state.kind === 'expired'
              ? { kind: 'ended', text: 'Expired' }
              : { kind: 'ended', text: 'Deleted' };
  return {
    title: d.name,
    subtitle: [`${String(d.days.length)} ${d.days.length === 1 ? 'day' : 'days'}`, d.gymName].filter((x): x is string => x !== null).join(' · '),
    days: d.days.map((x) => ({
      index: x.index,
      name: x.name,
      line: x.line,
      leftOut: x.leftOut > 0 ? `${String(x.leftOut)} left out` : null,
      accessibilityLabel: `${x.name}, ${x.line}${x.leftOut > 0 ? `, ${String(x.leftOut)} left out` : ''}. Show the day.`,
    })),
    rationale: d.rationale,
    action,
    replaces: d.replaces.length === 0 ? null : d.replaces.join(', '),
  };
}

export interface PlanDayView {
  title: string;
  rows: { key: string; name: string; scheme: string; load: string; marks: string[]; accessibilityLabel: string }[];
  /** `Edit` opens the saved workout (after Apply); before Apply, changes go through the coach. */
  routineId: string | null;
  checks: string[];
}

export function planDayView(d: PlanDayData): PlanDayView {
  return {
    title: `${d.name} · ${String(d.minutes)} min`,
    rows: d.rows.map((r, i) => {
      const marks = [...(r.estimate ? [PLAN_COPY.est] : []), ...(r.held ? [PLAN_COPY.held] : [])];
      return { key: `${r.exerciseId}:${String(i)}`, name: r.name, scheme: r.scheme, load: r.load, marks, accessibilityLabel: [r.name, r.scheme, r.load === '—' ? 'no load yet' : r.load, ...marks].join(', ') };
    }),
    routineId: d.routineId,
    checks: d.checks,
  };
}
