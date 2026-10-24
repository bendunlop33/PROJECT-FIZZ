import { ageFromBirthYear, feetInches, localHourUtcMs, heightText, latestWeight, splitInUse, weightText, type MainLift } from '@fizz/domain';
import { SPLIT_BODY_PARTS, TRAINING_LIMITS, type Gender, type LiftingExperience, type SplitBodyPart, type SplitKind, type TrainingGoal, type TrainingProfile, type WeightUnit } from '@fizz/schemas';

import { formatCalendarDate, localDateKey } from '../format/dates';

/**
 * Profile › Training details and Split (Ben 13 Oct: D5, D7, D8; F19). Pure
 * views: values and actions only (minimal copy). Every value comes from the
 * stored profile and the training service; nothing here computes a target.
 */

export const TRAINING_COPY = {
  details: 'Training details',
  split: 'Split',
  aboutYou: 'ABOUT YOU',
  weight: 'WEIGHT',
  training: 'TRAINING',
  birthYear: 'Birth year',
  gender: 'Gender',
  height: 'Height',
  experience: 'Lifting experience',
  goal: 'Goal',
  checkIn: 'Check-in',
  days: 'Days a week',
  length: 'Session length',
  addWeight: 'Add weight',
  delete: 'Delete',
  deleted: 'Weight deleted',
  undo: 'Undo',
  notSet: 'Not set',
  save: 'Save',
  cancel: 'Cancel',
  stale: 'Changed elsewhere. Showing the latest.',
  invalid: 'Couldn’t save that value.',
  failed: 'Couldn’t save. Try again.',
  mainLift: 'Main lift',
  recommended: 'Recommended',
  none: 'None yet',
  addDay: 'Add day',
  removeDay: 'Remove day',
  dayName: 'Name',
  bodyParts: 'BODY PARTS',
  useRecommended: 'Use recommended',
  /** (D7) With a plan in use: the split, days a week and session length are the plan's. */
  setByPlan: 'Set by your plan',
  yourPlan: 'Your plan',
} as const;

export const GENDER_CHOICES: readonly { value: Gender | null; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: null, label: 'Not set' },
];

export const EXPERIENCE_CHOICES: readonly { value: LiftingExperience; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'experienced', label: 'Experienced' },
  { value: 'pro', label: 'Pro' },
];

export const GOAL_CHOICES: readonly { value: TrainingGoal; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'muscle', label: 'Muscle' },
  { value: 'both', label: 'Both' },
];

export const SPLIT_CHOICES: readonly { kind: SplitKind; label: string }[] = [
  { kind: 'ppl', label: 'Push/Pull/Legs' },
  { kind: 'clsb', label: 'Chest/Legs/Shoulders/Back' },
  { kind: 'custom', label: 'Custom' },
];

const labelOf = <T>(choices: readonly { value: T; label: string }[], v: T | undefined): string => (v === undefined ? TRAINING_COPY.notSet : (choices.find((c) => c.value === v)?.label ?? TRAINING_COPY.notSet));

export type TrainingRowKey = 'birthYear' | 'gender' | 'height' | 'experience' | 'goal' | 'checkIn' | 'days' | 'length';

export interface TrainingRow {
  key: TrainingRowKey;
  title: string;
  value: string;
  /** (D7) The plan in use owns it (`Set by your plan`): the row opens Library › Your plan, not an edit sheet. */
  byPlan?: true;
}

export interface WeightRowView {
  id: string;
  title: string;
  value: string;
  accessibilityLabel: string;
}

export interface TrainingDetailsView {
  about: TrainingRow[];
  weights: WeightRowView[];
  training: TrainingRow[];
  /** Profile hub subtitle: `34 · 82.5 kg · Strength`, or `Not set`. */
  summary: string;
}

/**
 * The Training details screen (values only). Weights newest first, shown in
 * Ben's unit. Check-in and Self next-time targets are stored but not shown
 * until the check-in prompt and Self sessions exist (review B1, S3).
 */
export function trainingDetailsView(p: TrainingProfile, s: { nowYear: number; unit: WeightUnit; /** (D7) A plan is in use: its days a week and session length are the plan's. */ planInUse?: boolean }): TrainingDetailsView {
  const a = p.about;
  const latest = latestWeight(p.weights);
  const weights = [...p.weights].reverse().map((w) => {
    const value = weightText(w, s.unit);
    const title = formatCalendarDate(w.date);
    return { id: w.id, title, value, accessibilityLabel: `${title}, ${value}` };
  });
  const summaryParts = [
    a.birthYear === undefined ? null : String(ageFromBirthYear(a.birthYear, s.nowYear)),
    latest === null ? null : weightText(latest, s.unit),
    p.goal === undefined ? null : labelOf(GOAL_CHOICES, p.goal),
  ].filter((x): x is string => x !== null);
  return {
    about: [
      { key: 'birthYear', title: TRAINING_COPY.birthYear, value: a.birthYear === undefined ? TRAINING_COPY.notSet : String(a.birthYear) },
      { key: 'gender', title: TRAINING_COPY.gender, value: labelOf(GENDER_CHOICES, a.gender) },
      { key: 'height', title: TRAINING_COPY.height, value: a.heightCm === undefined ? TRAINING_COPY.notSet : heightText(a.heightCm) },
      { key: 'experience', title: TRAINING_COPY.experience, value: labelOf(EXPERIENCE_CHOICES, a.experience) },
    ],
    weights,
    // (D7, Ben 22–23 Oct) One owner per setting: with a plan in use, days a week and session length are the plan's
    // (its Your week); the goal stays Ben's here (a change offers to update the plan).
    training: [
      { key: 'goal', title: TRAINING_COPY.goal, value: labelOf(GOAL_CHOICES, p.goal) },
      s.planInUse === true ? { key: 'days', title: TRAINING_COPY.days, value: TRAINING_COPY.setByPlan, byPlan: true } : { key: 'days', title: TRAINING_COPY.days, value: p.daysPerWeek === undefined ? TRAINING_COPY.notSet : String(p.daysPerWeek) },
      s.planInUse === true ? { key: 'length', title: TRAINING_COPY.length, value: TRAINING_COPY.setByPlan, byPlan: true } : { key: 'length', title: TRAINING_COPY.length, value: `${String(p.sessionMinutes)} min` },
    ],
    summary: summaryParts.length === 0 ? TRAINING_COPY.notSet : summaryParts.join(' · '),
  };
}

/** Year picker bounds and the starting year (the stored one, else 30 years ago). */
export function birthYearPicker(stored: number | undefined, nowYear: number): { min: number; max: number; start: number } {
  const max = nowYear - 10;
  return { min: TRAINING_LIMITS.birthYearMin, max, start: stored ?? Math.min(max, nowYear - 30) };
}

/** Height picker: cm with the ft/in it reads as. */
export function heightPicker(cm: number): { label: string; limits: { min: number; max: number } } {
  const { ft, inch } = feetInches(cm);
  return { label: `${String(Math.round(cm))} cm · ${String(ft)}′${String(inch)}″`, limits: { min: TRAINING_LIMITS.heightCmMin, max: TRAINING_LIMITS.heightCmMax } };
}

/**
 * The Add weight sheet's entry, read from what Ben typed: a positive number
 * (comma or point) and a calendar date not after `today`. Null when it can't be read; range
 * checks happen in the domain write.
 */
export function readWeightEntry(text: string, date: string, today: string): { value: number; date: string } | null {
  const v = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || localDateKey(localHourUtcMs(date, 12, 'UTC'), 'UTC') !== date || date > today) return null;
  return { value: v, date };
}

export interface SplitDayView {
  id: string;
  name: string;
  bodyParts: string;
  mainLift: string;
  /** `Recommended` under a recommended main lift; null for Ben's own choice or none. */
  mainLiftNote: string | null;
}

export interface SplitView {
  choices: { kind: SplitKind; label: string; selected: boolean }[];
  days: SplitDayView[];
  editable: boolean;
  canAddDay: boolean;
  /** Profile hub subtitle: `Push/Pull/Legs`, or the custom day names. */
  summary: string;
}

/** The Split screen: the choice, each day with its body parts and main lift. */
export function splitView(p: TrainingProfile | null, mainLifts: Readonly<Record<string, MainLift>>): SplitView {
  const split = splitInUse(p);
  const days = split.days.map((d) => {
    const m = mainLifts[d.id] ?? null;
    return { id: d.id, name: d.name, bodyParts: d.bodyParts.join(', '), mainLift: m === null ? TRAINING_COPY.none : m.name, mainLiftNote: m?.source === 'recommended' ? TRAINING_COPY.recommended : null };
  });
  return {
    choices: SPLIT_CHOICES.map((c) => ({ ...c, selected: c.kind === split.kind })),
    days,
    editable: split.kind === 'custom',
    canAddDay: split.kind === 'custom' && split.days.length < TRAINING_LIMITS.splitDaysMax,
    summary: split.kind === 'custom' ? split.days.map((d) => d.name).join('/') : (SPLIT_CHOICES.find((c) => c.kind === split.kind)?.label ?? ''),
  };
}

/**
 * (D7, Ben 22–23 Oct: one split source) Profile's `Split` row: without a plan, the split (it drives Up next); with a
 * plan in use, `Set by your plan`, and the row opens Library › Your plan.
 */
export function profileSplitRow(p: TrainingProfile | null, mainLifts: Readonly<Record<string, MainLift>>, planInUse: boolean): { subtitle: string; opens: 'split' | 'your_plan' } {
  return planInUse ? { subtitle: TRAINING_COPY.setByPlan, opens: 'your_plan' } : { subtitle: splitView(p, mainLifts).summary, opens: 'split' };
}

/** The body-part checklist for a custom day. */
export function bodyPartChoices(selected: readonly SplitBodyPart[]): { part: SplitBodyPart; checked: boolean }[] {
  return SPLIT_BODY_PARTS.map((part) => ({ part, checked: selected.includes(part) }));
}

/**
 * The days a custom split starts from: the custom days in use, else his last
 * custom days (kept while a preset was in use; review B2), else the current preset's.
 */
export function customStartDays(p: TrainingProfile | null): { id: string; name: string; bodyParts: SplitBodyPart[] }[] {
  const days = p?.split?.kind !== 'custom' && p?.customDays !== undefined ? p.customDays : splitInUse(p).days;
  return days.map((d) => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts] }));
}
