import { longDate, shortDate, type ConsistencyView } from '@fizz/domain';

/**
 * Progress › `Consistency` (plan tracker v1, Ben 19 Oct): the last 8 weeks
 * against Profile's days-a-week aim, this week so far, and with a plan its
 * days done this week. Numbers and one mark each (never colour alone);
 * nothing is ever called missed (rotation, not dates). Pure.
 */
export interface ConsistencyCardView {
  title: string;
  /** `This week 2/3`, or `This week 2` with no aim. */
  thisWeek: string;
  /**
   * `label`: (design pass 6.1) the Monday's day of the month (`28`), so 8 columns fit at 375pt; the full
   * date is in `accessibilityLabel`. `rowLabel`: the short date (`28 Sep`) for the stacked rows at AX sizes.
   */
  weeks: { key: string; label: string; rowLabel: string; value: string; atAim: boolean | null; accessibilityLabel: string }[];
  /** `Weeks at your aim: 5 of 8`; null with no aim. */
  atAim: string | null;
  /** `Plan this week 3 of 4`; null without an applied plan. */
  plan: string | null;
}

export function consistencyCardView(c: ConsistencyView, today: string): ConsistencyCardView {
  return {
    title: 'Consistency',
    thisWeek: `This week ${c.thisWeek.text}`,
    weeks: c.weeks.map((w) => ({
      key: w.monday,
      label: String(Number(w.monday.slice(8, 10))),
      rowLabel: shortDate(w.monday, today),
      value: w.text,
      atAim: w.atAim,
      // With an aim the count is days trained (review S2), else workouts; the label says which.
      accessibilityLabel: `Week of ${longDate(w.monday, today)}: ${c.aim === null ? `${String(w.workouts)} ${w.workouts === 1 ? 'workout' : 'workouts'}` : `${String(w.days)} of ${String(c.aim)} days`}${w.atAim === true ? ', at your aim' : ''}`,
    })),
    atAim: c.atAimText,
    plan: c.planThisWeek === null ? null : `Plan this week ${c.planThisWeek.text}`,
  };
}
