/**
 * Progress › Lifts, top to bottom (Ben, 26 Oct 2026: "you have to scroll down too much to see the charts").
 * The lift chips sit at the top and the chart straight under them, so the selected lift's chart is in view
 * on opening the tab; the controls that change the chart (series, measure, period), the stat line, the
 * trailing average and the sessions table follow. `ExercisesTab` renders its sections in this order.
 * (Ben, 26 Oct: one exercise-progress screen) Exercise detail renders the same sections without the chips; an
 * active pain flag sits under the chart, the lift target under the stat line, then `BEST REPS` and `RECORDS`.
 */
export const LIFTS_TAB_SECTIONS = ['lifts', 'chart', 'pain', 'controls', 'stats', 'target', 'trailing', 'sessions', 'reps', 'records'] as const;

export type LiftsTabSection = (typeof LIFTS_TAB_SECTIONS)[number];

/** Above the tab's content: scroll top padding, the `Progress` title, the tab control and the gaps (pt). */
export const LIFTS_TAB_HEADER = 16 + 41 + 16 + 44 + 20;

/** The chart's height (`exercise-line-chart.tsx`). */
export const LIFTS_CHART_HEIGHT = 260;

/** Each section's height at the default text size, with the 16 pt gap after it (the sessions table: one row). */
const SECTION_HEIGHT: Record<LiftsTabSection, number> = { lifts: 44 + 16, chart: LIFTS_CHART_HEIGHT + 16, pain: 44 + 16, controls: 44 + 4 + 20 + 16, stats: 60 + 16, target: 0, trailing: 44 + 16, sessions: 64, reps: 44 + 44 + 16, records: 44 + 16 };

/** Where the chart's bottom edge sits in the scroll content (before any panel opens), for the iPhone check. */
export function liftsChartBottom(sections: readonly LiftsTabSection[] = LIFTS_TAB_SECTIONS): number {
  let y = LIFTS_TAB_HEADER;
  for (const s of sections) {
    if (s === 'chart') return y + LIFTS_CHART_HEIGHT;
    y += SECTION_HEIGHT[s];
  }
  return y;
}
