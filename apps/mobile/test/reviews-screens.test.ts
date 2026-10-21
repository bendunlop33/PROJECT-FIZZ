import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Progress v3 screens (progress-goals.md "Progress v3 (agreed)", prototype progress-simple.html):
 * layout-only checks on the source, since the rendered result goes on Ben's iPhone. The view models are
 * tested in `@fizz/domain` (progress-page.test.ts), the chart geometry in lifts-layout.test.ts.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('Progress v3 screens', () => {
  const charts = read('reviews', 'charts.tsx');
  const section = read('reviews', 'ReviewsSection.tsx');
  const progress = read('screens', 'progress', 'ProgressScreen.tsx');
  const detail = read('screens', 'progress', 'ReviewDetailScreen.tsx');

  it('Progress tabs `Overview | Lifts | Training`, Overview first and the default; its links open Lifts (on a lift) and Training', () => {
    expect(progress).toContain("useState<'overview' | 'lifts' | 'training'>('overview')");
    const tabs = ["{ key: 'overview', label: 'Overview' }", "{ key: 'lifts', label: 'Lifts' }", "{ key: 'training', label: 'Training' }"].map((t) => progress.indexOf(t));
    expect(tabs.every((i) => i > 0)).toBe(true);
    expect([...tabs].sort((a, b) => a - b)).toEqual(tabs);
    expect(progress).toContain('<ReviewsSection onOpenLifts={openLifts} onOpenTraining={openTraining} />');
    // `Open Bench ›` lands on that lift's page in Lifts (no workout picked); `Details ›` on Training's totals.
    expect(progress).toContain('setExercisesFocus((f) => ({ exerciseId, sessionId: null, sessionExerciseId: null, n: (f?.n ?? 0) + 1 }))');
    expect(progress).toContain("<ExercisesTab focus={exercisesFocus} />");
    expect(read('screens', 'progress', 'ExercisesTab.tsx')).toContain('focus.sessionId === null ? null');
    expect(charts).toContain('PROGRESS_COPY.allLiftsLink : PROGRESS_COPY.openLift(one.name)');
    expect(charts).toContain('onOpen(one === null ? null : one.exerciseId)');
    expect(charts).toContain('<SmallLink label={PROGRESS_COPY.details}');
    expect(section).toContain('<SectionHead title={PROGRESS_COPY.trends} right={PROGRESS_COPY.last8} />');
    // Today's `Reviews ›` lands on Overview.
    expect(progress).toContain("setTab('overview');");
  });

  it('This week: `THIS WEEK · 13–19 OCT` with a small Week | Month switch (44 pt to tap); Month is the 5-week calendar with its key', () => {
    expect(charts).toContain('`${PROGRESS_COPY.thisWeek} · ${range}` : PROGRESS_COPY.last5');
    expect(charts).toContain('accessibilityRole="tab"');
    expect(charts).toContain('accessibilityState={{ selected: on }}');
    expect(charts).toContain('hitSlop={{ top: 9, bottom: 9, left: 2, right: 2 }}');
    expect(charts).toContain('minHeight: 26, minWidth: 44');
    expect(charts).toContain("mode === 'month' ? (\n        <MonthCalendar");
    expect(charts).toContain('PROGRESS_COPY.calendarKey[i]');
    expect(charts).toContain("mode === 'month' && weeksOnPlan !== null");
    // Each row is one VoiceOver sentence; rows with a review open it.
    expect(charts).toContain('accessibilityLabel={r.accessibilityLabel}');
    expect(charts).toContain('Opens that week’s review');
    // Missed and planned sessions are listed after the row, never put on a day.
    expect(charts).toContain('r.open.map((o, i)');
    // `cardio`, not `runs`.
    expect(charts).toContain('view.cardio');
    expect(code(charts)).not.toMatch(/\bruns\b/);
  });

  it('one page for every goal: This week → Progress (Lifts, Muscles) → Coach’s changes at the bottom', () => {
    const order = ['<WeekCard', '<LiftsCard', '<MusclesCard', '<ChangesSection'].map((t) => section.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Dropped by the agreed design: goal-ordered sections, the Latest card, the 6-week consistency bars.
    for (const gone of ['goal.sections', 'ReviewCard', 'ConsistencyBlock', 'SetsBars', 'LiftTile', 'd.latest']) expect(code(section) + code(charts)).not.toContain(gone);
  });

  it('a done chip opens that workout’s Summary; a past week opens its review; Past weeks has its screen', () => {
    expect(section).toContain("navigation.navigate('Summary', { sessionId, back: true })");
    expect(section).toContain("screen: 'ProgressReview'");
    expect(section).toContain("screen: 'ProgressPastWeeks'");
    expect(read('navigation', 'AppNavigator.tsx')).toContain('name="ProgressPastWeeks"');
  });

  it('accessibility: VoiceOver summaries on every visual, 44 pt targets around small ones, Dynamic Type stacking', () => {
    expect(charts).toContain('accessibilityLabel={chip.accessibilityLabel}');
    expect(charts).toContain('accessibilityLabel={r.accessibilityLabel}');
    expect(charts).toContain('accessibilityLabel={one === null ? view.chartLabel : one.chartLabel}');
    // Lift rows, calendar rows, links: at least 44 pt even where the visual is smaller.
    expect(charts.match(/minHeight: 44/g)?.length).toBeGreaterThanOrEqual(3);
    expect(section.match(/minHeight: 44/g)?.length).toBeGreaterThanOrEqual(2);
    // Large text: chips two a row, muscle rows wrap.
    expect(charts).toContain('const perRow = ax ? 2 : 4;');
    expect(charts).toContain("flexWrap: ax ? 'wrap' : 'nowrap'");
    // No Skia: the table still lists every lift (the chart is skipped, never a blank box).
    expect(charts).toContain('&& Drawing !== null;');
  });

  it('Lifts: PB rings (tap → `PB · Bench 100 × 6 · week of 13 Oct`), a `PB` tag before Current, the key `Top set · ◎ PB · ○ est. · Edit`, load type and unit said', () => {
    expect(read('reviews', 'LiftsCanvas.tsx')).toContain('p.ring ? <Circle');
    expect(charts).toContain('const ring = ringAt(layout, locationX, locationY);');
    expect(charts).toContain('<LoadCell width={column} number={l.current} suffix={l.current === \'–\' ? null : l.loadSuffix} pb={l.latestPb} />');
    expect(charts).toContain("part === 'pb' ? (");
    expect(charts).toContain('${PROGRESS_COPY.topSet} · ${PROGRESS_COPY.pbKey} · ${PROGRESS_COPY.est}');
    expect(charts).toContain('A ring means a personal best.');
    // `each` / `stack` / `assist` beside Current and Target; kg or lb in the column header (CLAUDE.md: load convention explicit).
    expect(charts).toContain('<LoadCell width={column} number={l.targetText} suffix={l.target === null ? null : l.loadSuffix} pb={false} />');
    // The number is never cut off (review progress-v3b-design S1): no line limit on it; the parts wrap instead.
    const cell = charts.slice(charts.indexOf('function LoadCell'), charts.indexOf('function PbTag'));
    expect(cell).not.toContain('numberOfLines');
    expect(cell).toContain('liftCellLines({ width, number, suffix, pb, fontScale: scale })');
    expect(charts).toContain('`${PROGRESS_COPY.liftHead[2]} ${view.unit}`');
  });

  it('Summary lists new PBs (`New best · Bench 100 × 6`), from the service, local only', () => {
    const summary = read('screens', 'workout', 'SummaryScreen.tsx');
    expect(summary).toContain('s.reviews.sessionBests(sessionId).catch(() => [])');
    expect(summary).toContain('accessibilityLabel={b.accessibilityLabel}');
  });

  it('changes: small ones Undo / Redo, structural ones Apply / Keep as is; one op ID per tap; Got it is versioned', () => {
    expect(section).toContain('PROGRESS_COPY.apply');
    expect(section).toContain('PROGRESS_COPY.keep');
    expect(charts).toContain('PROGRESS_COPY.undo');
    expect(charts).toContain('PROGRESS_COPY.redo');
    expect(section).toContain('opId: newUuid()');
    expect(section).toContain('expectedVersion: view.version');
    expect(detail).toContain('<ChangeRow');
    // A change not made is never drawn as made: secondary colour, Apply while open (review progress-v3-design B1).
    expect(charts).toContain("color={made ? 'text.primary' : 'text.secondary'}");
    expect(charts).toContain('row.canApply && onApply !== undefined');
    expect(detail).toContain('actions.apply(r)');
    // Got it carries what Ben saw, so a status-only update since doesn't refuse it (review progress-v3-design S5).
    expect(section).toContain('contentKey: view.contentKey');
    expect(section).toContain('right={view.right}');
  });

  it('the Summary a chip opens shows `n of m planned reps` and what was short or skipped (review progress-v3-design S2)', () => {
    const summary = read('screens', 'workout', 'SummaryScreen.tsx');
    expect(summary).toContain('pvd.reps.text');
    expect(summary).toContain('pvd.reps.short');
  });

  it('the `at this rate` estimate is always labelled `est.`; minimal copy (no rule labels)', () => {
    expect(charts).toContain('one.focus.eta !== null ? (');
    expect(charts).toContain('PROGRESS_COPY.estWord');
    for (const src of [charts, section]) expect(code(src)).not.toMatch(/built-in rule|snapped to|Nothing changes unless/i);
  });

  it('the app reloads screens when a run stores a review or applies its changes', () => {
    expect(read('shell', 'context.tsx')).toContain('services.reviews.subscribe(changed)');
    expect(read('screens', 'TodayScreen.tsx')).toContain("params: { focus: 'reviews', n: (reviewsTaps += 1) }");
    expect(progress).toContain('scroll.current?.scrollTo({ y: 0, animated: false })');
  });
});
