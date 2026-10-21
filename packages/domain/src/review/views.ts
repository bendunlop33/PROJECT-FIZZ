import type { LoadConvention, MuscleGroup, ReviewFact, ReviewProposal, TrainingReview, WeightUnit } from '@fizz/schemas';
import { addDays } from '../calendar';
import { formatNumber, loadText, localDateText, NBSP } from '../display';
import { longDate, shortDate } from '../progress/exercise-view';
import { reviewProposalText } from './template-sets';
import type { GroupSets, LiftMetric, LiftTrend, ReviewWeekCount, WeeklyFacts } from './weekly';

/**
 * A stored weekly review read back (its facts as week data, the verdict, fact lines, past-week rows) for
 * Progress › Past weeks and the coach (workout-builder-v3 §6.1). Pure. The page itself is Progress v3
 * (`progress-page.ts`, agreed 21 Oct): goal-ordered sections, the Latest card and the 6-week consistency
 * bars are gone. Every number is from code's facts; an est. 1RM says so. Copy is minimal.
 */

/** What a view needs of the week: the live facts, or the facts stored on a review. */
export type ReviewWeekData = Pick<WeeklyFacts, 'monday' | 'complete' | 'basis' | 'week' | 'days' | 'missed' | 'missedCount' | 'weeks' | 'groups' | 'lifts' | 'runs' | 'rpe' | 'stalled' | 'feel' | 'edits'>;

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
  noRecentSets: 'No sets in 16 weeks',
  reviewed: 'Reviewed',
  reviewing: 'Reviewing…',
  noSets: 'No sets this week',
  goalNotSet: 'Goal not set',
  estimate: 'est. 1RM',
} as const;

const STATUS_WORD: Readonly<Record<string, string>> = { offline: 'Offline', not_connected: 'Coach not connected', failed: 'Coach didn’t answer' };

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
  // Missed days as code stored them, never re-derived from the dots (review b3-wave3-truth B4). A review
  // from before `week_status` names none.
  const status = of('week_status')[0];
  const planDays = days.length > 0 && of('sessions_vs_plan').length > 0;
  return {
    monday,
    complete: status?.complete ?? true,
    basis: status?.basis ?? (planDays ? 'plan' : week.planned !== null ? 'aim' : 'none'),
    week,
    days,
    missed: status?.missedNames ?? [],
    missedCount: status?.missed ?? 0,
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

/** The newest value alone, for after the metric's label: `97.5 kg`, `100 kg × 5`, `12 reps`. */
export function liftNowValue(l: LiftTrend): string | null {
  const p = l.points.at(-1);
  if (p === undefined) return null;
  return pointValueText(l, p);
}

function pointValueText(l: LiftTrend, p: LiftTrend['points'][number]): string {
  if (l.metric === 'e1rm') return valueText(l, p.value);
  if (l.metric === 'reps') return `${String(p.reps)}${NBSP}reps`;
  return `${p.load === null ? valueText(l, p.value) : loadText(p.load, p.load.convention)}${NBSP}×${NBSP}${String(p.reps)}`;
}

/** Whether a lift's `was` / `now` are estimates (an est. 1RM line, or a `was` stored as one). */
const isEstimateLine = (l: LiftTrend): boolean => l.metric === 'e1rm' || l.was?.isEstimate === true;

/**
 * `est. 1RM was 90 → now 97.5 → target 110 kg` (the target line's words, read alone by VoiceOver and in
 * tables, so an estimate says so; review b3-wave3-truth S1); null without a target.
 */
export function wasNowTarget(l: LiftTrend): string | null {
  if (l.target === null) return null;
  const parts = [l.was === null ? null : `was ${formatNumber(l.was.value)}`, l.now === null ? null : `now ${formatNumber(l.now)}`, `target ${valueText(l, l.target.value)}${l.target.kind === 'weight_reps' ? `${NBSP}×${NBSP}${String(l.target.reps)}` : ''}`].filter((x): x is string => x !== null);
  const line = parts.join(' → ');
  return isEstimateLine(l) && (l.was !== null || l.now !== null) ? `${REVIEW_COPY.estimate} ${line}` : line;
}

/** `Missed: Legs`, or with no names (a paused day that week) `Missed: 1 day`; null with none missed. */
export function missedText(d: Pick<ReviewWeekData, 'missed' | 'missedCount'>): string | null {
  if (d.missedCount <= 0) return null;
  if (d.missed.length > 0) return `Missed: ${d.missed.join(', ')}`;
  return `Missed: ${String(d.missedCount)} ${d.missedCount === 1 ? 'day' : 'days'}`;
}

/**
 * The review's facts as short lines, the flags first (review b3-wave3-ux S1): sessions (and runs), missed
 * days, sets out of range, stalls, RPE, feel, and only then each lift's value. The card shows the first
 * five; the full review shows all.
 */
export function reviewFactLines(d: ReviewWeekData): string[] {
  const out: string[] = [];
  const s = [sessionsText(d.week), d.week.planned !== null ? 'sessions' : null].filter(Boolean).join(' ');
  out.push(d.runs.count > 0 ? `${s} · ${runsText(d.runs.count)}` : s);
  const missed = missedText(d);
  if (missed !== null) out.push(missed);
  for (const g of d.groups) {
    const st = groupStatus(g);
    if (st === 'below' || st === 'above') out.push(`${groupLabel(g.group)}: ${String(g.sets)} sets ${STATUS_MARK[st].mark} ${String(g.range?.min ?? 0)}–${String(g.range?.max ?? 0)}`);
  }
  for (const x of d.stalled) out.push(`${x.name}: no new best in ${String(x.sessions)} sessions`);
  if (d.rpe !== null) out.push(d.rpe.target === null ? `RPE ${formatNumber(d.rpe.mean)}` : `RPE ${formatNumber(d.rpe.mean)} · target ${formatNumber(d.rpe.target)}`);
  const felt = (['easy', 'good', 'hard'] as const).filter((k) => d.feel[k] > 0).map((k) => `${String(d.feel[k])} ${k}`);
  if (felt.length > 0) out.push(`Felt: ${felt.join(', ')}`);
  for (const l of d.lifts) {
    const now = liftNowText(l);
    if (now !== null) out.push(`${l.name}: ${now}`);
  }
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

/**
 * The card's headline. The coach answered: its verdict, or (its verdict hidden by the number check) its
 * first line that passed, or `Reviewed`; never `Not reviewed` when it did review (rule 1; review
 * b3-wave3-ux B1). Otherwise why not, honestly: `Reviewing…` while the call is out, `Not reviewed · Offline`.
 */
export function verdictOf(r: Pick<TrainingReview, 'coach'>): { verdict: string; reviewed: boolean; lines: string[] } {
  const c = r.coach;
  if (c.status === 'reviewed') {
    if (c.verdict !== null) return { verdict: c.verdict, reviewed: true, lines: c.lines };
    const [first, ...rest] = c.lines;
    return first === undefined ? { verdict: REVIEW_COPY.reviewed, reviewed: true, lines: [] } : { verdict: first, reviewed: true, lines: rest };
  }
  if (c.status === 'pending') return { verdict: REVIEW_COPY.reviewing, reviewed: false, lines: [] };
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
  /** The week's facts: `w/c 6 Oct · 4 of 4` (review b3-wave3-ux S6: never a column of identical statuses). */
  title: string;
  /** The verdict, then what was missed: `Solid week · Legs missed`, `Not reviewed · Offline`. */
  detail: string;
  /** The first lift's points (oldest first); empty: no sparkline. */
  spark: number[];
  accessibilityLabel: string;
}

export function reviewHistoryRow(r: TrainingReview, d: ReviewWeekData, today: string): ReviewHistoryRow {
  const v = verdictOf(r);
  const sessions = `${sessionsText(d.week)}${d.runs.count > 0 ? ` · ${runsText(d.runs.count)}` : ''}`;
  const missed = missedText(d);
  const title = `w/c ${shortDate(d.monday, today)} · ${sessions}`;
  const detail = [v.verdict, missed].filter((x): x is string => x !== null).join(' · ');
  const lift = d.lifts.find((l) => l.points.length >= 2);
  // Up is stronger on the sparkline: an assisted lift's values are flipped (review b3-wave3-ux N4).
  const spark = lift === undefined ? [] : lift.points.map((p) => (lift.lowerIsBetter ? -p.value : p.value));
  const sparkWords = lift === undefined || lift.now === null ? null : `${lift.name}${lift.metric === 'e1rm' ? ` ${REVIEW_COPY.estimate}` : ''} ${formatNumber(lift.points[0]?.value ?? 0)} to ${formatNumber(lift.now)}`;
  return { reviewId: r.id, title, detail, spark, accessibilityLabel: [`Week of ${longDate(d.monday, today)}`, sessions, v.verdict, missed, sparkWords].filter((x): x is string => x !== null).join('. ').replaceAll(NBSP, ' ') };
}

// ---------------------------------------------------------------------------
// Charts

/** A sparkline's points in a W × H box (2 pt inset); flat data sits mid-height. */
export function sparkPoints(values: readonly number[], width: number, height: number): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const span = mx - mn;
  return values.map((v, i) => ({ x: 2 + (values.length === 1 ? (width - 4) / 2 : (i * (width - 4)) / (values.length - 1)), y: span === 0 ? height / 2 : 2 + (height - 4) * (1 - (v - mn) / span) }));
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
