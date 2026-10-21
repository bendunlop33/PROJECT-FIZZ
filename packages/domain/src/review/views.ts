import type { LoadConvention, MuscleGroup, ReviewFact, ReviewProposal, TrainingGoal, TrainingReview, WeightUnit } from '@fizz/schemas';
import { addDays } from '../calendar';
import { formatNumber, loadText, localDateText, NBSP } from '../display';
import { longDate, shortDate } from '../progress/exercise-view';
import { reviewProposalText } from './template-sets';
import type { GroupSets, LiftMetric, LiftTrend, ReviewWeekCount, WeeklyFacts } from './weekly';

/**
 * Progress › Reviews view models (workout-builder-v3 §6.2; the approved visual prototype
 * `progress-reviews.html`, minus its fakes). Pure: screens lay these out and compute nothing. Every number
 * is from code's facts; an est. 1RM says so; there is no projection line and no predicted date anywhere
 * (lift-targets rule, rule 6); a status is a mark plus a word, never colour alone. Copy is minimal (values
 * and actions only). Every chart carries a VoiceOver summary and a table.
 */

/** What a view needs of the week: the live facts, or the facts stored on a review. */
export type ReviewWeekData = Pick<WeeklyFacts, 'monday' | 'complete' | 'basis' | 'week' | 'days' | 'missed' | 'weeks' | 'groups' | 'lifts' | 'runs' | 'rpe' | 'stalled' | 'feel' | 'edits'>;

export const REVIEW_COPY = {
  section: 'Reviews',
  latest: 'This week',
  goal: 'Goal',
  history: 'Past weeks',
  consistency: 'Sessions',
  sets: 'Sets per muscle',
  lifts: 'Lifts',
  liftsShown: 'Lifts shown',
  editLifts: 'Edit',
  addLift: 'Add lift',
  maxLifts: 'Max 6 lifts',
  notReviewed: 'Not reviewed',
  apply: 'Apply',
  skip: 'Skip',
  undo: 'Undo',
  applied: 'Applied',
  skipped: 'Skipped',
  undone: 'Undone',
  outOfDate: 'Out of date',
  table: 'Table',
  chart: 'Chart',
  legendDone: 'Sets done',
  legendRange: 'Goal range',
  legendPlan: 'Plan',
  noReview: 'No review yet',
  noLifts: 'No lifts logged yet',
  noSets: 'No sets this week',
  goalNotSet: 'Goal not set',
  estimate: 'est. 1RM',
} as const;

const STATUS_WORD: Readonly<Record<string, string>> = { offline: 'Offline', not_connected: 'Coach not connected', failed: 'Coach didn’t answer', pending: 'Pending' };

// ---------------------------------------------------------------------------
// Stored → week data

const GROUP_LABEL: Readonly<Partial<Record<MuscleGroup, string>>> = { Core: 'Abs' };
export const groupLabel = (g: MuscleGroup): string => GROUP_LABEL[g] ?? g;

/** A stored weekly review's facts as week data (names from Ben's exercises now; the logged name otherwise). */
export function weekDataOfReview(r: Pick<TrainingReview, 'subject' | 'facts'>, nameOf: (exerciseId: string) => string): ReviewWeekData | null {
  if (r.subject.kind !== 'weekly') return null;
  const monday = r.subject.weekMonday;
  const facts = r.facts;
  const of = <K extends ReviewFact['kind']>(k: K) => facts.filter((f): f is Extract<ReviewFact, { kind: K }> => f.kind === k);
  const weeks: ReviewWeekCount[] = of('week_sessions').map((w) => ({ monday: w.weekMonday, done: w.done, planned: w.planned, workouts: w.workouts, runs: w.runs }));
  const week = weeks.find((w) => w.monday === monday) ?? { monday, done: 0, planned: null, workouts: 0, runs: 0 };
  const days = of('week_day').map((d) => ({ name: d.name, done: d.done, date: d.localDate }));
  const groups: GroupSets[] = of('group_sets').map((g) => ({ group: g.group, sets: g.sets, planned: g.planned, range: g.range }));
  const lifts: LiftTrend[] = of('lift_trend').map((l) => {
    const metric: LiftMetric = l.metric ?? 'best_set';
    const first = l.points.find((p) => p.load !== null)?.load ?? null;
    const points = l.points.map((p) => ({ sessionId: p.sessionId, date: p.localDate, value: metric === 'e1rm' ? (p.estimate ?? 0) : metric === 'reps' ? p.reps : (p.load?.value ?? 0), load: p.load, reps: p.reps }));
    return {
      exerciseId: l.exerciseId,
      name: nameOf(l.exerciseId),
      metric,
      unit: metric === 'reps' ? null : (l.target?.unit ?? first?.unit ?? null),
      convention: metric === 'reps' ? null : (l.target?.convention ?? first?.convention ?? null),
      lowerIsBetter: l.lowerIsBetter ?? false,
      points,
      target: l.target === null ? null : { value: l.target.value, reps: l.targetReps ?? 1, kind: (l.targetReps ?? 1) > 1 ? 'weight_reps' : 'one_rm' },
      was: l.was ?? null,
      now: points.at(-1)?.value ?? null,
    };
  });
  const runs = of('runs')[0];
  const rpe = of('rpe_drift')[0];
  const feel = of('feel')[0];
  const planDays = days.length > 0 && of('sessions_vs_plan').length > 0;
  return {
    monday,
    complete: true,
    basis: planDays ? 'plan' : week.planned !== null ? 'aim' : 'none',
    week,
    days,
    missed: planDays ? days.filter((d) => !d.done).map((d) => d.name) : [],
    weeks,
    groups,
    lifts,
    runs: { count: runs?.count ?? 0, distanceM: runs?.distanceM ?? null },
    rpe: rpe === undefined ? null : { sessions: rpe.sessions, mean: rpe.meanRpe, target: rpe.targetRpe },
    stalled: of('stalled_lift').map((s) => ({ exerciseId: s.exerciseId, name: nameOf(s.exerciseId), sessions: s.sessions })),
    feel: { easy: feel?.easy ?? 0, good: feel?.good ?? 0, hard: feel?.hard ?? 0 },
    edits: [],
  };
}

// ---------------------------------------------------------------------------
// Words

/** `kg`, `kg each`, `kg stack`, `kg assist`, `kg added`. */
export function liftUnitText(unit: WeightUnit | null, convention: LoadConvention | null): string {
  if (unit === null) return 'reps';
  switch (convention) {
    case 'per_hand':
      return `${unit}${NBSP}each`;
    case 'stack':
      return `${unit}${NBSP}stack`;
    case 'assistance':
      return `${unit}${NBSP}assist`;
    case 'added':
      return `${unit}${NBSP}added`;
    case 'total':
    case 'bodyweight':
    case null:
      return unit;
  }
}

const valueText = (l: Pick<LiftTrend, 'unit' | 'convention'>, v: number): string => (l.unit === null ? `${formatNumber(v)}${NBSP}reps` : `${formatNumber(v)}${NBSP}${liftUnitText(l.unit, l.convention)}`);

export const METRIC_LABEL: Readonly<Record<LiftMetric, string>> = { e1rm: REVIEW_COPY.estimate, best_set: 'Best set', reps: 'Best reps' };

/** `3 of 4`, `3 workouts`. */
export function sessionsText(w: ReviewWeekCount): string {
  if (w.planned !== null) return `${String(w.done)} of ${String(w.planned)}`;
  return `${String(w.workouts)} ${w.workouts === 1 ? 'workout' : 'workouts'}`;
}

const runsText = (n: number): string => `${String(n)} ${n === 1 ? 'run' : 'runs'}`;

export type GroupStatus = 'below' | 'in' | 'above';

export function groupStatus(g: Pick<GroupSets, 'sets' | 'range'>): GroupStatus | null {
  if (g.range === null) return null;
  return g.sets < g.range.min ? 'below' : g.sets > g.range.max ? 'above' : 'in';
}

const STATUS_MARK: Readonly<Record<GroupStatus, { mark: string; word: string }>> = { below: { mark: '▼', word: 'below' }, in: { mark: '✓', word: 'in range' }, above: { mark: '▲', word: 'above' } };

/** A lift's newest value with what it is: `est. 1RM 97.5 kg`, `Best set 100 kg × 5`, `Best reps 12`. */
export function liftNowText(l: LiftTrend): string | null {
  const p = l.points.at(-1);
  if (p === undefined) return null;
  if (l.metric === 'e1rm') return `${REVIEW_COPY.estimate} ${valueText(l, p.value)}`;
  if (l.metric === 'reps') return `Best reps ${String(p.reps)}`;
  return `Best set ${p.load === null ? valueText(l, p.value) : loadText(p.load, p.load.convention)}${NBSP}×${NBSP}${String(p.reps)}`;
}

/** `was 90 → now 97.5 → target 110 kg` (the target line's words); null without a target. */
export function wasNowTarget(l: LiftTrend): string | null {
  if (l.target === null) return null;
  const parts = [l.was === null ? null : `was ${formatNumber(l.was.value)}`, l.now === null ? null : `now ${formatNumber(l.now)}`, `target ${valueText(l, l.target.value)}${l.target.kind === 'weight_reps' ? `${NBSP}×${NBSP}${String(l.target.reps)}` : ''}`].filter((x): x is string => x !== null);
  return parts.join(' → ');
}

/**
 * The review's facts as short lines, most telling first: sessions (and runs), missed days, lifts, sets out
 * of range, stalls, RPE, feel. The card shows the first five; the full review shows all.
 */
export function reviewFactLines(d: ReviewWeekData): string[] {
  const out: string[] = [];
  const s = [sessionsText(d.week), d.week.planned !== null ? 'sessions' : null].filter(Boolean).join(' ');
  out.push(d.runs.count > 0 ? `${s} · ${runsText(d.runs.count)}` : s);
  if (d.missed.length > 0) out.push(`Missed: ${d.missed.join(', ')}`);
  for (const l of d.lifts) {
    const now = liftNowText(l);
    if (now !== null) out.push(`${l.name}: ${now}`);
  }
  for (const g of d.groups) {
    const st = groupStatus(g);
    if (st === 'below' || st === 'above') out.push(`${groupLabel(g.group)}: ${String(g.sets)} sets ${STATUS_MARK[st].mark} ${String(g.range?.min ?? 0)}–${String(g.range?.max ?? 0)}`);
  }
  for (const x of d.stalled) out.push(`${x.name}: no new best in ${String(x.sessions)} sessions`);
  if (d.rpe !== null) out.push(d.rpe.target === null ? `RPE ${formatNumber(d.rpe.mean)}` : `RPE ${formatNumber(d.rpe.mean)} · target ${formatNumber(d.rpe.target)}`);
  const felt = (['easy', 'good', 'hard'] as const).filter((k) => d.feel[k] > 0).map((k) => `${String(d.feel[k])} ${k}`);
  if (felt.length > 0) out.push(`Felt: ${felt.join(', ')}`);
  return out;
}

// ---------------------------------------------------------------------------
// Latest card, history row, full review

export interface ReviewProposalView {
  id: string;
  text: string;
  reason: string | null;
  status: ReviewProposal['status'];
  /** `Applied · Undo`, `Skipped`, `Out of date`; null while open (Apply / Skip shown). */
  statusText: string | null;
  canUndo: boolean;
  accessibilityLabel: string;
}

export interface ReviewCardView {
  reviewId: string;
  version: number;
  /** `w/c 13 Oct`. */
  week: string;
  /** The coach's verdict, or `Not reviewed · Offline`. */
  verdict: string;
  reviewed: boolean;
  /** The coach's lines that passed the number check. */
  lines: string[];
  facts: string[];
  proposals: ReviewProposalView[];
  accessibilityLabel: string;
}

export function proposalView(p: ReviewProposal): ReviewProposalView {
  const text = reviewProposalText(p);
  const statusText = p.status === 'open' ? null : p.status === 'applied' ? REVIEW_COPY.applied : p.status === 'skipped' ? REVIEW_COPY.skipped : p.status === 'undone' ? REVIEW_COPY.undone : REVIEW_COPY.outOfDate;
  return { id: p.id, text, reason: p.reason, status: p.status, statusText, canUndo: p.status === 'applied' && p.actionId !== null, accessibilityLabel: [text, p.reason, statusText].filter((x): x is string => x !== null).join('. ').replaceAll(NBSP, ' ') };
}

function verdictOf(r: Pick<TrainingReview, 'coach'>): { verdict: string; reviewed: boolean; lines: string[] } {
  const c = r.coach;
  if (c.status === 'reviewed') return { verdict: c.verdict ?? REVIEW_COPY.notReviewed, reviewed: c.verdict !== null || c.lines.length > 0, lines: c.lines };
  if (c.status === 'silent') return { verdict: REVIEW_COPY.notReviewed, reviewed: false, lines: [] };
  return { verdict: `${REVIEW_COPY.notReviewed} · ${STATUS_WORD[c.status] ?? ''}`, reviewed: false, lines: [] };
}

export function reviewCardView(r: TrainingReview, d: ReviewWeekData, today: string, maxFacts = 5): ReviewCardView {
  const v = verdictOf(r);
  const week = `w/c ${shortDate(d.monday, today)}`;
  const facts = reviewFactLines(d).slice(0, maxFacts);
  const proposals = (r.proposals ?? []).map(proposalView);
  return {
    reviewId: r.id,
    version: r.version,
    week,
    verdict: v.verdict,
    reviewed: v.reviewed,
    lines: v.lines,
    facts,
    proposals,
    accessibilityLabel: [`Week of ${longDate(d.monday, today)}`, v.verdict, ...v.lines, ...facts].join('. ').replaceAll(NBSP, ' '),
  };
}

export interface ReviewHistoryRow {
  reviewId: string;
  title: string;
  /** `w/c 6 Oct · 4 of 4 · Legs missed`. */
  detail: string;
  /** The first lift's points (oldest first); empty: no sparkline. */
  spark: number[];
  accessibilityLabel: string;
}

export function reviewHistoryRow(r: TrainingReview, d: ReviewWeekData, today: string): ReviewHistoryRow {
  const v = verdictOf(r);
  const parts = [`w/c ${shortDate(d.monday, today)}`, sessionsText(d.week), d.missed.length > 0 ? `${d.missed.join(', ')} missed` : null].filter((x): x is string => x !== null);
  const lift = d.lifts.find((l) => l.points.length >= 2);
  const spark = lift?.points.map((p) => p.value) ?? [];
  const sparkWords = lift === undefined || lift.now === null ? null : `${lift.name} ${formatNumber(lift.points[0]?.value ?? 0)} to ${formatNumber(lift.now)}`;
  return { reviewId: r.id, title: v.verdict, detail: parts.join(' · '), spark, accessibilityLabel: [v.verdict, `Week of ${longDate(d.monday, today)}`, ...parts.slice(1), sparkWords].filter((x): x is string => x !== null).join('. ').replaceAll(NBSP, ' ') };
}

// ---------------------------------------------------------------------------
// Charts

export interface DotView {
  key: string;
  /** One letter (`C`), or `R` for a run. */
  label: string;
  kind: 'done' | 'todo' | 'run';
  accessibilityLabel: string;
}

export interface WeekBarView {
  key: string;
  /** Day of month of the Monday (`13`). */
  label: string;
  done: number;
  planned: number | null;
  runs: number;
  /** `3 of 4` / `3` with no plan. */
  value: string;
  accessibilityLabel: string;
}

export interface ReviewConsistencyView {
  title: string;
  /** `3 of 4 · 2 runs`. */
  summary: string;
  dots: DotView[];
  /** Missed plan days, named. */
  missed: string | null;
  bars: WeekBarView[];
  /** The scale's top (the most planned or done in any week, at least 1). */
  scaleMax: number;
  /** VoiceOver summary of the bars. */
  words: string;
  /** Table view rows: week, done, planned, runs. */
  table: { key: string; week: string; sessions: string; runs: string }[];
}

export function reviewConsistencyView(d: ReviewWeekData, today: string): ReviewConsistencyView {
  const dots: DotView[] = d.days.map((x, i) => ({
    key: `d${String(i)}`,
    label: (x.name.trim()[0] ?? '•').toUpperCase(),
    kind: x.done ? 'done' : 'todo',
    accessibilityLabel: `${x.name}, ${x.done ? `done${x.date === null ? '' : ` ${longDate(x.date, today)}`}` : 'not done'}`,
  }));
  if (d.basis === 'aim' && d.week.planned !== null) {
    for (let i = d.week.done; i < d.week.planned; i += 1) dots.push({ key: `a${String(i)}`, label: '', kind: 'todo', accessibilityLabel: 'Not done' });
  }
  for (let i = 0; i < d.runs.count && i < 7; i += 1) dots.push({ key: `r${String(i)}`, label: 'R', kind: 'run', accessibilityLabel: 'Run' });
  const summary = [sessionsText(d.week), d.runs.count > 0 ? runsText(d.runs.count) : null].filter((x): x is string => x !== null).join(' · ');
  const bars: WeekBarView[] = d.weeks.map((w) => ({
    key: w.monday,
    label: String(Number(w.monday.slice(8, 10))),
    done: w.done,
    planned: w.planned,
    runs: w.runs,
    value: w.planned === null ? String(w.done) : `${String(w.done)} of ${String(w.planned)}`,
    accessibilityLabel: `Week of ${longDate(w.monday, today)}: ${w.planned === null ? `${String(w.workouts)} ${w.workouts === 1 ? 'workout' : 'workouts'}` : `${String(w.done)} of ${String(w.planned)} sessions`}${w.runs > 0 ? `, ${runsText(w.runs)}` : ''}`,
  }));
  const scaleMax = Math.max(1, ...d.weeks.map((w) => Math.max(w.done, w.planned ?? 0)));
  const judged = d.weeks.filter((w) => w.planned !== null);
  const met = judged.filter((w) => w.planned !== null && w.done >= w.planned).length;
  const words = judged.length === 0 ? `Last ${String(d.weeks.length)} weeks: ${d.weeks.map((w) => String(w.workouts)).join(', ')} workouts` : `Last ${String(d.weeks.length)} weeks: all planned sessions done in ${String(met)} of ${String(judged.length)}`;
  return {
    title: REVIEW_COPY.consistency,
    summary,
    dots,
    missed: d.missed.length > 0 ? `Missed: ${d.missed.join(', ')}` : null,
    bars,
    scaleMax,
    words,
    table: d.weeks.map((w) => ({ key: w.monday, week: shortDate(w.monday, today), sessions: w.planned === null ? String(w.workouts) : `${String(w.done)} of ${String(w.planned)}`, runs: String(w.runs) })),
  };
}

export interface SetsRowView {
  key: string;
  label: string;
  sets: number;
  planned: number | null;
  range: { min: number; max: number } | null;
  /** Fractions of the scale (0–1) for the bar, range band and plan tick. */
  fill: number;
  band: { from: number; to: number } | null;
  plannedAt: number | null;
  /** `✓` / `▼` / `▲` with its word, never colour alone. */
  mark: string | null;
  status: GroupStatus | null;
  accessibilityLabel: string;
}

export interface SetsBarsView {
  title: string;
  rows: SetsRowView[];
  scaleMax: number;
  legend: { done: string; range: string | null; plan: string | null };
  words: string;
  empty: string | null;
}

export function setsBarsView(groups: readonly GroupSets[]): SetsBarsView {
  const scaleMax = Math.max(10, ...groups.map((g) => Math.max(g.sets, g.planned ?? 0, g.range?.max ?? 0)));
  const rows = groups.map((g): SetsRowView => {
    const st = groupStatus(g);
    const label = groupLabel(g.group);
    const words = [`${label}: ${String(g.sets)} ${g.sets === 1 ? 'set' : 'sets'}`, g.planned === null ? null : `plan ${String(g.planned)}`, g.range === null ? null : `range ${String(g.range.min)} to ${String(g.range.max)}`, st === null ? null : STATUS_MARK[st].word].filter((x): x is string => x !== null);
    return {
      key: g.group,
      label,
      sets: g.sets,
      planned: g.planned,
      range: g.range,
      fill: Math.min(1, g.sets / scaleMax),
      band: g.range === null ? null : { from: Math.min(1, g.range.min / scaleMax), to: Math.min(1, g.range.max / scaleMax) },
      plannedAt: g.planned === null ? null : Math.min(1, g.planned / scaleMax),
      mark: st === null ? null : STATUS_MARK[st].mark,
      status: st,
      accessibilityLabel: words.join(', '),
    };
  });
  const out = rows.filter((r) => r.status === 'below' || r.status === 'above').map((r) => `${r.label} ${r.status === 'below' ? 'below' : 'above'}`);
  return {
    title: REVIEW_COPY.sets,
    rows,
    scaleMax,
    legend: { done: REVIEW_COPY.legendDone, range: groups.some((g) => g.range !== null) ? REVIEW_COPY.legendRange : null, plan: groups.some((g) => g.planned !== null) ? REVIEW_COPY.legendPlan : null },
    words: rows.length === 0 ? REVIEW_COPY.noSets : `${String(rows.length)} muscle groups${out.length === 0 ? '' : `; ${out.join(', ')}`}`,
    empty: rows.length === 0 ? REVIEW_COPY.noSets : null,
  };
}

export interface LiftChartView {
  exerciseId: string;
  title: string;
  /** `est. 1RM · kg`, `Best set · kg each`, `Best reps`. */
  metric: string;
  /** The newest value with what it is. */
  now: string | null;
  /** `was 90 → now 97.5 → target 110 kg`; null without a target. */
  progress: string | null;
  points: { key: string; date: string; value: number; breakBefore: false }[];
  from: string;
  to: string;
  /** The lift target's level (a dotted line); null without one. Never a projection. */
  target: number | null;
  /** Too few points for a line: the value alone. */
  sparse: boolean;
  words: string;
  table: { key: string; date: string; value: string; set: string }[];
}

export function liftChartView(l: LiftTrend, today: string): LiftChartView {
  const first = l.points[0];
  const last = l.points.at(-1);
  const metric = l.unit === null ? METRIC_LABEL[l.metric] : `${METRIC_LABEL[l.metric]} · ${liftUnitText(l.unit, l.convention)}`;
  const progress = wasNowTarget(l);
  const words = [
    `${l.name}, ${l.metric === 'e1rm' ? 'estimated one-rep max' : METRIC_LABEL[l.metric].toLowerCase()}`,
    first === undefined || last === undefined ? 'no sets logged' : l.points.length === 1 ? `${valueText(l, last.value)} on ${longDate(last.date, today)}` : `${String(l.points.length)} sessions, ${valueText(l, first.value)} on ${longDate(first.date, today)} to ${valueText(l, last.value)} on ${longDate(last.date, today)}`,
    l.target === null ? null : `target ${valueText(l, l.target.value)}`,
    l.lowerIsBetter ? 'less assistance is stronger' : null,
  ].filter((x): x is string => x !== null);
  return {
    exerciseId: l.exerciseId,
    title: l.name,
    metric,
    now: liftNowText(l),
    progress,
    points: l.points.map((p) => ({ key: p.sessionId, date: p.date, value: p.value, breakBefore: false as const })),
    from: first?.date ?? today,
    to: last === undefined ? today : last.date < today ? last.date : today,
    target: l.target?.value ?? null,
    sparse: l.points.length < 2,
    words: words.join('. ').replaceAll(NBSP, ' '),
    table: [...l.points].reverse().map((p) => ({ key: p.sessionId, date: shortDate(p.date, today), value: l.unit === null ? String(p.value) : formatNumber(p.value), set: p.load === null ? `${String(p.reps)} reps` : `${loadText(p.load, p.load.convention)}${NBSP}×${NBSP}${String(p.reps)}` })),
  };
}

/** A sparkline's points in a W × H box (2 pt inset); flat data sits mid-height. */
export function sparkPoints(values: readonly number[], width: number, height: number): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const span = mx - mn;
  return values.map((v, i) => ({ x: 2 + (values.length === 1 ? (width - 4) / 2 : (i * (width - 4)) / (values.length - 1)), y: span === 0 ? height / 2 : 2 + (height - 4) * (1 - (v - mn) / span) }));
}

// ---------------------------------------------------------------------------
// Goal view (§6.2, Ben 21 Oct): consistency first; the training goal orders what follows

export type GoalSection = { kind: 'consistency'; view: ReviewConsistencyView } | { kind: 'sets'; view: SetsBarsView } | { kind: 'lifts'; charts: LiftChartView[]; empty: string | null };

export interface GoalView {
  /** `Muscle`, `Strength`, `Strength and muscle`, `Goal not set`. */
  goal: string;
  sections: GoalSection[];
}

const GOAL_WORD: Readonly<Record<TrainingGoal, string>> = { strength: 'Strength', muscle: 'Muscle', both: 'Strength and muscle' };

export function goalView(d: ReviewWeekData, goal: TrainingGoal | null, today: string): GoalView {
  const consistency: GoalSection = { kind: 'consistency', view: reviewConsistencyView(d, today) };
  const sets: GoalSection = { kind: 'sets', view: setsBarsView(d.groups) };
  const charts = d.lifts.map((l) => liftChartView(l, today));
  const lifts: GoalSection = { kind: 'lifts', charts, empty: charts.length === 0 ? REVIEW_COPY.noLifts : null };
  const rest = goal === 'muscle' ? [sets, lifts] : [lifts, sets];
  return { goal: goal === null ? REVIEW_COPY.goalNotSet : GOAL_WORD[goal], sections: [consistency, ...rest] };
}

/** `13–19 Oct`. */
export function weekRangeText(monday: string): string {
  const sunday = addDays(monday, 6);
  return monday.slice(5, 7) === sunday.slice(5, 7) ? `${String(Number(monday.slice(8, 10)))}–${localDateText(sunday)}` : `${localDateText(monday)} – ${localDateText(sunday)}`;
}

// ---------------------------------------------------------------------------
// Summary's `How did it feel?` (Ben, 21 Oct): one tap, stored with the workout as Ben gave it

export const FEEL_COPY = { question: 'How did it feel?' } as const;

export interface FeelOptionView {
  key: 'easy' | 'good' | 'hard';
  label: string;
  selected: boolean;
  /** The value to send on tap: this one, or null to clear when it is already chosen. */
  next: 'easy' | 'good' | 'hard' | null;
  accessibilityLabel: string;
}

export function feelOptions(current: 'easy' | 'good' | 'hard' | null): FeelOptionView[] {
  return (['easy', 'good', 'hard'] as const).map((k) => {
    const label = k === 'easy' ? 'Easy' : k === 'good' ? 'Good' : 'Hard';
    const selected = current === k;
    return { key: k, label, selected, next: selected ? null : k, accessibilityLabel: `${FEEL_COPY.question} ${label}` };
  });
}
