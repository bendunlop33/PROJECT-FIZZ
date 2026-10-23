import {
  PB_CORE,
  PB_EX,
  PB_OWN,
  PB_PREF_QUESTIONS,
  PB_TAG_OF,
  PB_TARGETS,
  fmt,
  pbChartMuscles,
  pbDayName,
  pbLoadText,
  pbMainWeekOneLine,
  pbStrengthBalance,
  pbSuggestedSplit,
  pbNextWeekStarts,
  type PbBalanceWord,
  type PbExercise,
  type PbLiftStart,
  type PbPlan,
  type PbPrefQuestion,
} from '@fizz/domain';
import type { PlanBuilderAnswers, PlanEffort, PlanFocus, PlanGroup, PlanSplit, PlanTarget, PlanWarmups } from '@fizz/schemas';

/**
 * The plan builder's screens as values (plan-builder.md, D7; minimal copy, Ben 10 Oct). Formatting only: every
 * number comes from the engine (`@fizz/domain` plan builder). Pure, so it is tested without React Native.
 */

export const PB_COPY = {
  goals: 'Gym goals',
  week: 'Your week',
  check: 'Check your lifts',
  plan: 'Your plan',
  prefs: 'Any preferences',
  length: 'Plan length',
  effort: 'Effort',
  focus: 'Main focus',
  priorities: 'Any priorities?',
  specific: 'Specific',
  add: '＋ Add',
  expect: (weeks: number) => `What to expect in ${String(weeks)} weeks`,
  sessions: 'Sessions a week',
  minutes: 'Session length (min)',
  split: 'Split',
  days: 'Days',
  anyDays: 'Any days',
  setDays: 'Set days',
  other: 'Other training',
  supersets: 'Supersets',
  warmups: 'Warm-ups',
  gym: 'Gym',
  noGym: 'No gym',
  useTypicalGym: 'Use a typical gym',
  next: 'Next',
  nextWeek: 'Next: your week',
  build: 'Build plan',
  apply: 'Apply plan',
  done: 'Done',
  back: '‹ Back',
  close: 'Close',
  yourPlan: '‹ Your plan',
  setsPerWeek: 'Sets per week',
  abs: (n: number) => `Abs: ${String(n)} sets a week`,
  change: 'Change',
  goalsRow: 'Goals',
  weekRow: 'Week',
  prefsRow: 'Any preferences',
  none: 'None',
  addLift: '＋ Add a lift',
  stillRight: 'Still right',
  save: 'Save',
  weight: 'Weight',
  reps: 'Reps',
  otherLift: 'Estimate from another lift',
  balance: 'Strength balance',
  lift: 'Lift',
  sixReps: '6 reps',
  oneRmEst: '1RM est.',
  est: 'est.',
  pickDays: (n: number) => `Pick ${String(n)} days`,
  upTo2: 'Up to 2',
  upTo4: 'Up to 4',
  applied: 'Plan applied',
  updated: 'Plan updated',
  undo: 'Undo',
  stale: 'This plan changed. Showing the latest.',
  failed: 'Couldn’t save. Try again.',
  empty: 'Nothing here fits this gym.',
  warmup: 'Warm-up',
  why: 'Why?',
  otherPick: 'Other',
  noPreference: 'No preference',
  heldForPain: 'Left out for pain',
  likes: 'Others I like',
} as const;

export const PB_WEEKS: readonly PlanBuilderAnswers['weeks'][] = [4, 6, 8, 12];
export const PB_EFFORTS: readonly { key: PlanEffort; label: string }[] = [
  { key: 'maintain', label: 'Maintain' },
  { key: 'standard', label: 'Standard' },
  { key: 'push', label: 'Push' },
];
export const PB_FOCUSES: readonly { key: PlanFocus; label: string }[] = [
  { key: 'strength', label: 'Strength' },
  { key: 'muscle', label: 'Muscle' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'fitness', label: 'Fitness' },
];
export const PB_GROUP_LIST: readonly PlanGroup[] = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core'];
export const PB_SPLITS: readonly { key: PlanSplit; label: string }[] = [
  { key: 'ul', label: 'Upper / Lower' },
  { key: 'ppl', label: 'Push / Pull / Legs' },
  { key: 'body', label: 'Chest / Legs / Shoulders / Back' },
  { key: 'full', label: 'Full body' },
];
export const PB_LENGTHS = [30, 35, 40, 45, 50, 55, 60] as const;
/** (Ben, 23 Oct) Your week › Warm-ups: the three options. */
export const PB_WARMUPS: readonly { key: PlanWarmups; label: string }[] = [
  { key: 'full', label: 'Full' },
  { key: 'short', label: 'Short' },
  { key: 'none', label: 'None' },
];
export const PB_ABS_OPTIONS = [0, 6, 10, 14, 18] as const;
export const PB_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const PB_SPORT_CHIPS = ['Running', 'Cycling', 'Swimming', 'Boxing', 'Football', 'HIIT', 'Climbing', 'Yoga'] as const;

/** Behind ⓘ only (minimal copy). */
export const PB_INFO = {
  focus: [
    ['Strength', 'Lift heavier on your main lifts. Heavy top sets of 3–6 reps, longer rests, fewer extras.'],
    ['Muscle', 'Build size. Mostly 6–15 reps, more sets per muscle, each muscle twice a week.'],
    ['Balanced', 'Strength and size together: heavy main lifts first, then muscle-building work.'],
    ['Fitness', 'All-round health. 8–15 reps at moderate effort, every muscle twice a week.'],
  ],
  effort: [
    ['Maintain', 'Keep what you have with less time and effort.'],
    ['Standard', 'Steady progress you can keep up.'],
    ['Push', 'Faster progress from harder training. Needs more recovery.'],
  ],
  priority: 'A priority gets more sets (top of its range), is trained at least twice a week, and comes straight after the main lift. Specific: makes sure one part gets trained, about 6 sets a week over 2 days.',
  balance: 'Each lift’s estimated 1RM divided by your bench press estimated 1RM, against a usual range from strength standards and coaching rules of thumb. Not a target.',
  supersets: 'Two exercises back to back, then rest. Only accessories are paired; the main lift and heavy barbell lifts keep full rest.',
} as const;

const focusWord = (f: PlanFocus): string => PB_FOCUSES.find((x) => x.key === f)?.label ?? f;
const effortWord = (e: PlanEffort): string => PB_EFFORTS.find((x) => x.key === e)?.label ?? e;

/** `6 weeks · Standard · Balanced · ★ Back`. */
export function goalsRowValue(a: PlanBuilderAnswers): string {
  return [`${String(a.weeks)} weeks`, effortWord(a.effort), focusWord(a.focus), ...(a.priorities.length > 0 ? [`★ ${a.priorities.join(', ')}`] : [])].join(' · ');
}

/** `4 days · 60 min · supersets · short warm-ups` (Full warm-ups, the default, isn't named). */
export function weekRowValue(a: PlanBuilderAnswers): string {
  const w = a.warmups ?? 'full';
  return [`${String(a.sessions)} days`, `${String(a.minutes)} min`, ...(a.supersets ? ['supersets'] : []), ...(w === 'short' ? ['short warm-ups'] : w === 'none' ? ['no warm-ups'] : [])].join(' · ');
}

/** `None`, `3 set`. */
export function prefsRowValue(a: PlanBuilderAnswers): string {
  const n = Object.values(a.prefs).filter((x) => x !== 'either').length + a.likes.length;
  return n === 0 ? PB_COPY.none : `${String(n)} set`;
}

/** The split boxes, ✦ on the suggested one; the selected one is Ben's pick, else the ✦. */
export function splitBoxes(a: PlanBuilderAnswers, profileSplit: 'ppl' | 'body' | null): { key: PlanSplit; label: string; selected: boolean }[] {
  const sug = pbSuggestedSplit(a.sessions, profileSplit);
  const pick = a.split ?? sug;
  return PB_SPLITS.map((s) => ({ key: s.key, label: `${s.key === sug ? '✦ ' : ''}${s.label}`, selected: s.key === pick }));
}

/** `Rotates · next week starts Legs`, or null on a whole cycle. */
export function rotatesLine(a: PlanBuilderAnswers, profileSplit: 'ppl' | 'body' | null): string | null {
  const next = pbNextWeekStarts(a.split ?? pbSuggestedSplit(a.sessions, profileSplit), a.sessions);
  return next === null ? null : `Rotates · next week starts ${next}`;
}

export interface PbRowView {
  key: string;
  /** Superset letter (`A1`), else null. */
  pair: string | null;
  name: string;
  main: boolean;
  /** Main lift: `1 × 6 + 2 × 8 · 102.5 / 95`; others: `3 × 10`. */
  scheme: string;
  /** Others: `30`, `24 each`, `BW`, `—`; main lifts: null (in the scheme). */
  kg: string | null;
  /** Estimated load (rule 6). */
  est: boolean;
}

export interface PbDayView {
  index: number;
  title: string;
  sub: string;
  right: string;
  rows: PbRowView[];
}

function rowOf(e: PbExercise, nameOf: (k: string) => string): PbRowView {
  const loaded = e.role === 'main' && e.main !== null;
  return {
    key: e.key,
    pair: e.pair,
    name: nameOf(e.key),
    main: e.role === 'main',
    scheme: loaded ? pbMainWeekOneLine(e) : `${String(e.sets)} × ${String(e.reps)}`,
    kg: loaded ? null : pbLoadText(e),
    est: e.estimate && e.load.kind === 'kg',
  };
}

/**
 * The day cards: `Mon · Upper A` (Set days) or `1 · Upper A` (Any days); the main lift under it, with the day's own
 * warm-up time when it has one (`Barbell bench press · warm-up 9′`, Ben 23 Oct); `5 ex · ~58′`, the day's minutes with
 * its warm-ups (the engine's estimate, not the session length).
 */
export function dayViews(plan: PbPlan, _a: PlanBuilderAnswers, nameOf: (k: string) => string): PbDayView[] {
  return plan.days.map((d) => {
    const main = d.exercises.find((e) => e.role === 'main');
    const lead = d.weekday === null ? String(d.index + 1) : (PB_WEEKDAYS[d.weekday] ?? String(d.index + 1));
    return {
      index: d.index,
      title: `${lead} · ${pbDayName(d)}`,
      sub: [main === undefined ? `${String(d.exercises.length)} exercises` : nameOf(main.key), ...(d.warmupS > 0 ? [`warm-up ${String(Math.max(1, Math.round(d.warmupS / 60)))}′`] : [])].join(' · '),
      right: `${String(d.exercises.length)} ex · ~${String(d.minutes)}′`,
      rows: d.exercises.map((e) => rowOf(e, nameOf)),
    };
  });
}

export interface PbVolumeRow {
  muscle: string;
  n: number;
  lo: number;
  hi: number;
  mark: '↓' | '↑' | null;
  priority: boolean;
}

/** Sets per week against each muscle's band; ↓ below, ↑ above; nothing hidden. */
export function volumeRows(plan: PbPlan, a: PlanBuilderAnswers): PbVolumeRow[] {
  return pbChartMuscles(a).map((m) => {
    const [lo, hi] = plan.ranges[m] ?? [0, 0];
    const n = plan.weekly[m] ?? 0;
    const priority = a.priorities.some((g) => (g === 'Legs' ? ['Quads', 'Hamstrings', 'Calves'] : g === 'Arms' ? ['Biceps', 'Triceps'] : [g]).includes(m)) || (a.specific as readonly string[]).includes(m);
    return { muscle: m, n, lo, hi, mark: n < lo ? '↓' : n > hi ? '↑' : null, priority };
  });
}

export interface PbCheckRow {
  key: string;
  name: string;
  six: string;
  oneRm: string;
  /** Grey: an estimate. */
  est: boolean;
  /** Amber dot: stale and not confirmed, or nothing yet. */
  open: boolean;
}

const kgText = (n: number | null, perHand: boolean): string => (n === null ? '—' : `${fmt(n)}${perHand ? ' each' : ''}`);

/** Check your lifts rows: Lift · 6 reps · 1RM est. */
export function checkRows(lifts: readonly PbLiftStart[], nameOf: (k: string) => string, perHand: (k: string) => boolean): PbCheckRow[] {
  return lifts.map((l) => ({ key: l.key, name: nameOf(l.key), six: kgText(l.six, perHand(l.key)), oneRm: kgText(l.oneRm, perHand(l.key)), est: l.estimate, open: l.open }));
}

/** The lift sheet's line: `Last set: 120 × 5 · 3 Aug`, `Estimated from …`, `You entered`, `No history`. */
export function liftFromLine(l: PbLiftStart, nameOf: (k: string) => string, dateText: (utc: string) => string): string {
  const f = l.from;
  if (f === null) return 'No history. Enter a recent set.';
  if (f.kind === 'entered') return 'You entered';
  if (f.kind === 'similar') return `Estimated from ${nameOf(f.fromKey)} ${fmt(f.value)} × ${String(f.reps)}`;
  return `Last set: ${fmt(f.value)} × ${String(f.reps)} · ${dateText(f.atUtc)}`;
}

export function balanceRows(lifts: readonly PbLiftStart[], nameOf: (k: string) => string): { key: string; name: string; word: PbBalanceWord; warn: boolean }[] {
  return pbStrengthBalance(lifts).map((b) => ({ key: b.key, name: nameOf(b.key), word: b.word, warn: b.word === 'Below' }));
}

/** Specific targets offered: those this gym has an exercise for. */
export function targetChoices(usable: (key: string) => boolean): PlanTarget[] {
  const has = (t: PlanTarget): boolean => {
    if (t === 'Obliques') return usable(PB_CORE.woodchop);
    const own = (PB_OWN as readonly string[]).includes(t) ? PB_EX[t as (typeof PB_OWN)[number]] : null;
    if (own !== null) return own.some((x) => usable(x.key));
    const m = PB_TAG_OF[t];
    if (m === undefined || m === 'Core') return false;
    return PB_EX[m].some((x) => (x.tags ?? []).includes(t) && usable(x.key));
  };
  return Object.values(PB_TARGETS).flat().filter(has);
}

/** Any preferences questions shown (Hips only with a legs priority or a hips target), by group. */
export function prefQuestions(a: PlanBuilderAnswers): { group: string; questions: PbPrefQuestion[] }[] {
  const hips = a.priorities.includes('Legs') || a.specific.some((t) => t === 'Glutes' || t === 'Adductors' || t === 'Abductors');
  const qs = PB_PREF_QUESTIONS.filter((q) => q.hips !== true || hips);
  return (['Chest', 'Legs', 'Back', 'Shoulders'] as const).map((g) => ({ group: g, questions: qs.filter((q) => q.group === g) })).filter((x) => x.questions.length > 0);
}

/** Whether a preference answer is the Other pick, and its name. */
export function otherOf(a: PlanBuilderAnswers, qId: string): string | null {
  const x = a.prefs[qId];
  return typeof x === 'object' ? x.other : null;
}


/** `Others I like ＋ Add`: every exercise the engine picks from, by muscle, that this gym has. */
export function likeGroups(usable: (key: string) => boolean): { muscle: string; keys: string[] }[] {
  return Object.entries(PB_EX)
    .map(([muscle, list]) => ({ muscle, keys: list.map((x) => x.key).filter(usable) }))
    .filter((g) => g.keys.length > 0);
}
