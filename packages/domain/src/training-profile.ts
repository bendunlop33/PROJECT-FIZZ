import type { HistoryLike } from './history-summary';
import {
  type BuildFocus,
  FitRestLevelSchema,
  muscleGroupOf,
  SplitBodyPartSchema,
  TRAINING_LIMITS,
  TrainingProfileSchema,
  type Exercise,
  type MuscleGroup,
  type PinnedNote,
  type SplitBodyPart,
  type SplitDay,
  type TrainingChange,
  type TrainingProfile,
  type TrainingSplit,
  type WeightEntry,
} from '@fizz/schemas';
import { withLiftTarget, withoutLiftTarget } from './lift-targets';
import { CHECK_IN_WEEKDAYS } from './checkin';
import { toMs } from './time';
import { convertMass, KG_PER_LB } from './units';

/**
 * Ben's training details and split (Ben 13 Oct: D5, D7, D8; F19). Pure:
 * every write is `applyTrainingChange` on the stored version (rule 5), and
 * everything the coach or the Build card reads is derived here.
 */

/** The two preset splits (Ben, 12–13 Oct): Chest and Shoulders include triceps, Back includes biceps. */
export const PRESET_SPLITS: Readonly<Record<'ppl' | 'clsb', readonly SplitDay[]>> = {
  ppl: [
    { id: 'push', name: 'Push', bodyParts: ['Chest', 'Shoulders', 'Triceps'] },
    { id: 'pull', name: 'Pull', bodyParts: ['Back', 'Biceps'] },
    { id: 'legs', name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
  ],
  clsb: [
    { id: 'chest', name: 'Chest', bodyParts: ['Chest', 'Triceps'] },
    { id: 'legs', name: 'Legs', bodyParts: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
    { id: 'shoulders', name: 'Shoulders', bodyParts: ['Shoulders', 'Triceps'] },
    { id: 'back', name: 'Back', bodyParts: ['Back', 'Biceps'] },
  ],
};

/** The split the Build card uses until Ben chooses one. */
export const DEFAULT_SPLIT: TrainingSplit = { kind: 'ppl', days: PRESET_SPLITS.ppl.map((d) => ({ ...d, bodyParts: [...d.bodyParts] })) };

export function newTrainingProfile(s: { id: string; ownerId: string; atUtc: string }): TrainingProfile {
  return {
    id: s.id,
    ownerId: s.ownerId,
    version: 1,
    createdAtUtc: s.atUtc,
    updatedAtUtc: s.atUtc,
    about: {},
    weights: [],
    checkInWeeks: TRAINING_LIMITS.checkInWeeksDefault,
    sessionMinutes: TRAINING_LIMITS.sessionMinDefault,
    selfNextTargets: false,
    recentOps: [],
  };
}

export interface TrainingWriteContext {
  opId: string;
  expectedVersion: number;
  atUtc: string;
  nowYear: number;
  /** Ben's local calendar date, `YYYY-MM-DD`: a weight can't be dated after it. */
  today: string;
}

export type TrainingWriteResult =
  | { ok: true; profile: TrainingProfile; replayed: boolean }
  | { ok: false; error: 'stale' | 'invalid'; currentVersion: number };

/** The latest birth year accepted: at least 10 years before `nowYear`. */
export const youngestBirthYear = (nowYear: number): number => nowYear - 10;

const intIn = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

/** A weight entry's mass in kg. */
export function weightKg(e: Pick<WeightEntry, 'value' | 'unit'>): number {
  return e.unit === 'kg' ? e.value : e.value * KG_PER_LB;
}

function validCustomDays(days: Extract<TrainingChange, { kind: 'custom_split' }>['days']): boolean {
  if (days.length < 1 || days.length > TRAINING_LIMITS.splitDaysMax) return false;
  const ids = new Set(days.map((d) => d.id));
  if (ids.size !== days.length) return false;
  return days.every((d) => d.id.length > 0 && d.name.trim().length > 0 && d.name.trim().length <= TRAINING_LIMITS.dayNameMax && d.bodyParts.length > 0 && new Set(d.bodyParts).size === d.bodyParts.length && d.bodyParts.every((b) => SplitBodyPartSchema.safeParse(b).success));
}

const byDate = (a: WeightEntry, b: WeightEntry): number => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.recordedAtUtc < b.recordedAtUtc ? -1 : a.recordedAtUtc > b.recordedAtUtc ? 1 : a.id.localeCompare(b.id));

/** Ben's main lift per day ID: the kept map, else (an older row) the split's days. */
function liftsOf(p: TrainingProfile): Record<string, string> {
  if (p.mainLifts !== undefined) return { ...p.mainLifts };
  const out: Record<string, string> = {};
  for (const d of p.split?.days ?? []) if (d.mainLiftExerciseId !== undefined) out[d.id] = d.mainLiftExerciseId;
  return out;
}

const stripLift = (d: Pick<SplitDay, 'id' | 'name' | 'bodyParts'>): SplitDay => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts] });

/**
 * A new split, keeping what switching away would lose (review B2): the last
 * custom days, and every main lift by day ID (only for days that can come
 * back: the presets' and the kept custom days').
 */
function withSplit(p: TrainingProfile, kind: TrainingSplit['kind'], days: readonly Pick<SplitDay, 'id' | 'name' | 'bodyParts'>[], lifts: Record<string, string>): TrainingProfile {
  const customDays = kind === 'custom' ? days.map(stripLift) : p.split?.kind === 'custom' ? p.split.days.map(stripLift) : p.customDays;
  const keep = new Set([...PRESET_SPLITS.ppl, ...PRESET_SPLITS.clsb, ...(customDays ?? []), ...days].map((d) => d.id));
  const mainLifts = Object.fromEntries(Object.entries(lifts).filter(([id]) => keep.has(id)));
  const split: TrainingSplit = { kind, days: days.map((d) => ({ ...stripLift(d), ...(lifts[d.id] === undefined ? {} : { mainLiftExerciseId: lifts[d.id] }) })) };
  return { ...p, split, mainLifts, ...(customDays === undefined ? {} : { customDays }) };
}

/** The change applied to a copy, or null when it isn't valid. */
function changed(p: TrainingProfile, c: TrainingChange, atUtc: string, nowYear: number, today: string): TrainingProfile | null {
  const about = { ...p.about };
  switch (c.kind) {
    case 'birth_year':
      if (c.year === null) delete about.birthYear;
      else if (!intIn(c.year, TRAINING_LIMITS.birthYearMin, youngestBirthYear(nowYear))) return null;
      else about.birthYear = c.year;
      return { ...p, about };
    case 'gender':
      if (c.gender === null) delete about.gender;
      else about.gender = c.gender;
      return { ...p, about };
    case 'height':
      if (c.cm === null) delete about.heightCm;
      else if (!(c.cm >= TRAINING_LIMITS.heightCmMin && c.cm <= TRAINING_LIMITS.heightCmMax)) return null;
      else about.heightCm = Math.round(c.cm * 10) / 10;
      return { ...p, about };
    case 'experience':
      if (c.level === null) delete about.experience;
      else about.experience = c.level;
      return { ...p, about };
    case 'add_weight': {
      const kg = weightKg(c.entry);
      if (!(kg >= TRAINING_LIMITS.weightKgMin && kg <= TRAINING_LIMITS.weightKgMax)) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.entry.date) || c.entry.date > today) return null;
      if (p.weights.some((w) => w.id === c.entry.id)) return p;
      const weights = [...p.weights, { ...c.entry, value: Math.round(c.entry.value * 100) / 100, recordedAtUtc: atUtc }].sort(byDate);
      return { ...p, weights: weights.slice(-TRAINING_LIMITS.weightsMax) };
    }
    case 'delete_weight':
      return { ...p, weights: p.weights.filter((w) => w.id !== c.entryId) };
    case 'edit_weight': {
      const kg = weightKg(c);
      if (!(kg >= TRAINING_LIMITS.weightKgMin && kg <= TRAINING_LIMITS.weightKgMax)) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || c.date > today) return null;
      const have = p.weights.find((w) => w.id === c.entryId);
      if (have === undefined) return null;
      // Its entry time stays (when it was first logged): an edit corrects the value, it isn't a new weigh-in.
      const next = { ...have, value: Math.round(c.value * 100) / 100, unit: c.unit, date: c.date };
      return { ...p, weights: p.weights.map((w) => (w.id === c.entryId ? next : w)).sort(byDate) };
    }
    case 'goal': {
      const next = { ...p };
      if (c.goal === null) {
        delete next.goal;
        delete next.goalSetAtUtc;
      } else {
        next.goal = c.goal;
        next.goalSetAtUtc = atUtc;
      }
      return next;
    }
    case 'check_in_weeks':
      return intIn(c.weeks, TRAINING_LIMITS.checkInWeeksMin, TRAINING_LIMITS.checkInWeeksMax) ? { ...p, checkInWeeks: c.weeks } : null;
    case 'days_per_week': {
      if (c.days !== null && !intIn(c.days, TRAINING_LIMITS.daysMin, TRAINING_LIMITS.daysMax)) return null;
      const next = { ...p };
      if (c.days === null) delete next.daysPerWeek;
      else next.daysPerWeek = c.days;
      return next;
    }
    case 'session_minutes':
      return intIn(c.minutes, TRAINING_LIMITS.sessionMinMin, TRAINING_LIMITS.sessionMinMax) ? { ...p, sessionMinutes: c.minutes } : null;
    case 'preset_split':
      return withSplit(p, c.split, PRESET_SPLITS[c.split], liftsOf(p));
    case 'custom_split':
      if (!validCustomDays(c.days)) return null;
      return withSplit(p, 'custom', c.days.map((d) => ({ id: d.id, name: d.name.trim(), bodyParts: [...d.bodyParts] })), liftsOf(p));
    case 'main_lift': {
      const split = p.split ?? DEFAULT_SPLIT;
      if (!split.days.some((d) => d.id === c.dayId)) return null;
      const lifts = Object.fromEntries(Object.entries(liftsOf(p)).filter(([id]) => id !== c.dayId));
      return withSplit(p, split.kind, split.days, c.exerciseId === null ? lifts : { ...lifts, [c.dayId]: c.exerciseId });
    }
    case 'self_next_targets':
      return { ...p, selfNextTargets: c.on };
    case 'lift_targets_on':
      return { ...p, liftTargetsOn: c.on };
    case 'set_lift_target': {
      const list = withLiftTarget(p.liftTargets ?? [], c.target);
      return list === null ? null : { ...p, liftTargets: list };
    }
    case 'remove_lift_target':
      return { ...p, liftTargets: withoutLiftTarget(p.liftTargets ?? [], c.exerciseId) };
    case 'check_in_schedule': {
      // (Ben, 26 Oct) `days` needs at least one day; each day once, in week order.
      if (c.schedule.kind !== 'days') return { ...p, checkInSchedule: { kind: c.schedule.kind } };
      const weekdays = CHECK_IN_WEEKDAYS.filter((d) => c.schedule.kind === 'days' && c.schedule.weekdays.includes(d));
      return weekdays.length === 0 ? null : { ...p, checkInSchedule: { kind: 'days', weekdays } };
    }
    case 'fit_rest_level':
      return FitRestLevelSchema.safeParse(c.level).success ? { ...p, fitRestLevel: c.level } : null;
    case 'progress_lifts': {
      const ids = [...new Set(c.exerciseIds.map((x) => x.trim()))];
      if (ids.length > TRAINING_LIMITS.progressLiftsMax || ids.some((x) => x.length === 0 || x.length > 64)) return null;
      const next = { ...p };
      if (ids.length === 0) delete next.progressLifts;
      else next.progressLifts = ids;
      // Picked reps are kept only for lifts still shown; a new pick replaces the old one.
      const reps: Record<string, number> = {};
      for (const [id, n] of Object.entries({ ...(p.progressLiftReps ?? {}), ...(c.reps ?? {}) })) {
        if (!ids.includes(id)) continue;
        if (!Number.isInteger(n) || n < 1 || n > 30) return null;
        reps[id] = n;
      }
      if (Object.keys(reps).length === 0) delete next.progressLiftReps;
      else next.progressLiftReps = reps;
      return next;
    }
    case 'pin_note': {
      const text = c.text.trim();
      if (text === '' || text.length > TRAINING_LIMITS.pinnedNoteMax || c.exerciseId.trim() === '') return null;
      const rest = (p.pinnedNotes ?? []).filter((n) => !(n.exerciseId === c.exerciseId && n.gymId === c.gymId));
      if (rest.length >= TRAINING_LIMITS.pinnedNotesMax) return null;
      return { ...p, pinnedNotes: [...rest, { exerciseId: c.exerciseId, gymId: c.gymId, text, updatedAtUtc: atUtc }] };
    }
    case 'unpin_note': {
      const next = { ...p };
      const rest = (p.pinnedNotes ?? []).filter((n) => !(n.exerciseId === c.exerciseId && n.gymId === c.gymId));
      if (rest.length === 0) delete next.pinnedNotes;
      else next.pinnedNotes = rest;
      return next;
    }
  }
}

/**
 * (Ben, 26 Oct) The pinned note an exercise shows at a gym: that gym's own pin, else the every-gym pin, else none.
 * Shown as typed (rule 8).
 */
export function pinnedNoteFor(notes: readonly PinnedNote[] | undefined, exerciseId: string, gymId: string | null): PinnedNote | null {
  const mine = (notes ?? []).filter((n) => n.exerciseId === exerciseId);
  return (gymId === null ? undefined : mine.find((n) => n.gymId === gymId)) ?? mine.find((n) => n.gymId === null) ?? null;
}

/**
 * One versioned, idempotent write (rule 5): a repeated `opId` returns the
 * stored profile unchanged; an `expectedVersion` that isn't the stored one is
 * `stale` and nothing changes; an out-of-range value (or a weight dated
 * after `today`, Ben's local `YYYY-MM-DD`) is `invalid`.
 */
export function applyTrainingChange(current: TrainingProfile, change: TrainingChange, w: TrainingWriteContext): TrainingWriteResult {
  if (current.recentOps.includes(w.opId)) return { ok: true, profile: current, replayed: true };
  if (w.expectedVersion !== current.version) return { ok: false, error: 'stale', currentVersion: current.version };
  const next = changed(current, change, w.atUtc, w.nowYear, w.today);
  if (next === null) return { ok: false, error: 'invalid', currentVersion: current.version };
  const out: TrainingProfile = { ...next, version: current.version + 1, updatedAtUtc: w.atUtc, recentOps: [...current.recentOps, w.opId].slice(-TRAINING_LIMITS.recentOpsMax) };
  return TrainingProfileSchema.safeParse(out).success ? { ok: true, profile: out, replayed: false } : { ok: false, error: 'invalid', currentVersion: current.version };
}

// ---------------------------------------------------------------------------
// Derived values

/** Age from a birth year alone: the age reached this calendar year (it can be one less until the birthday). */
export function ageFromBirthYear(birthYear: number, nowYear: number): number {
  return nowYear - birthYear;
}

/** The newest weight entry (by date, then when it was entered), or null. */
export function latestWeight(entries: readonly WeightEntry[]): WeightEntry | null {
  return [...entries].sort(byDate).at(-1) ?? null;
}

/** `5 ft 11 in` from centimetres. */
export function feetInches(cm: number): { ft: number; inch: number } {
  const total = Math.round(cm / 2.54);
  return { ft: Math.floor(total / 12), inch: total % 12 };
}

export function cmFromFeetInches(ft: number, inch: number): number {
  return Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
}

/** `180 cm · 5′11″`. */
export function heightText(cm: number): string {
  const { ft, inch } = feetInches(cm);
  return `${String(Math.round(cm))} cm · ${String(ft)}′${String(inch)}″`;
}

/** `82.5 kg`, or `182 lb · 82.6 kg` when shown in the other unit. */
export function weightText(e: Pick<WeightEntry, 'value' | 'unit'>, show: 'kg' | 'lb'): string {
  const v = e.unit === show ? e.value : convertMass({ value: e.value, unit: e.unit }, show).value;
  return `${String(Math.round(v * 10) / 10)} ${show}`;
}

/** The split in use: Ben's, else Push/Pull/Legs. */
export function splitInUse(p: Pick<TrainingProfile, 'split'> | null): TrainingSplit {
  return p?.split ?? DEFAULT_SPLIT;
}

/** The muscle groups a workout trained, by working sets on each exercise's first primary muscle. */
export function workoutMuscleGroups(exercises: readonly { primaryMuscles: readonly string[]; workingSets: number }[]): Map<MuscleGroup, number> {
  const out = new Map<MuscleGroup, number>();
  for (const e of exercises) {
    const first = e.primaryMuscles[0];
    const g = first === undefined ? null : muscleGroupOf(first);
    if (g !== null && e.workingSets > 0) out.set(g, (out.get(g) ?? 0) + e.workingSets);
  }
  return out;
}

/**
 * Which split day a workout was: the day whose body parts got the most of its
 * working sets (the earlier day on a tie). Null when none of it fits a day.
 */
export function matchSplitDay(split: TrainingSplit, groups: ReadonlyMap<MuscleGroup, number>): SplitDay | null {
  let best: { day: SplitDay; score: number } | null = null;
  for (const day of split.days) {
    const score = day.bodyParts.reduce((s, b) => s + (groups.get(b) ?? 0), 0);
    if (score > 0 && (best === null || score > best.score)) best = { day, score };
  }
  return best?.day ?? null;
}

/** F19: the day after the last workout's day in the split's order; the first day with no history (or no match). */
export function nextSplitDay(split: TrainingSplit, lastWorkout: ReadonlyMap<MuscleGroup, number> | null): SplitDay {
  const first = split.days[0];
  if (first === undefined) throw new RangeError('A split has at least one day');
  const last = lastWorkout === null ? null : matchSplitDay(split, lastWorkout);
  if (last === null) return first;
  const i = split.days.findIndex((d) => d.id === last.id);
  return split.days[(i + 1) % split.days.length] ?? first;
}

/** One exercise from Ben's history, as the main-lift recommendation reads it. */
export interface LiftHistory {
  exercise: Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'mechanic'>;
  /** Finished workouts it was in (the window is the caller's). */
  sessions: number;
  /** Heaviest working load in kg, when it has one. */
  bestKg: number | null;
}

/**
 * D7: the recommended main lift for a split day, from history. A compound
 * lift whose main muscle is one of the day's body parts; the day's first
 * body part first, then the most workouts, then the heaviest. Null with no
 * fitting history (nothing is made up; rule 6).
 */
export function recommendMainLift(day: Pick<SplitDay, 'bodyParts'>, history: readonly LiftHistory[]): LiftHistory['exercise'] | null {
  const lead = day.bodyParts[0];
  const fits = history
    .map((h) => {
      const first = h.exercise.primaryMuscles[0];
      return { h, group: first === undefined ? null : muscleGroupOf(first) };
    })
    .filter((x) => x.h.sessions > 0 && x.h.exercise.mechanic === 'compound' && x.group !== null && (day.bodyParts as readonly string[]).includes(x.group));
  fits.sort((a, b) => Number(b.group === lead) - Number(a.group === lead) || b.h.sessions - a.h.sessions || (b.h.bestKg ?? 0) - (a.h.bestKg ?? 0) || a.h.exercise.name.localeCompare(b.h.exercise.name));
  return fits[0]?.h.exercise ?? null;
}

export type MainLift = { exerciseId: string; name: string; source: 'yours' | 'recommended' } | null;

/** The main lift for a day: Ben's choice, else the recommendation. */
export function mainLiftFor(day: SplitDay, history: readonly LiftHistory[], nameOf: (exerciseId: string) => string | null): MainLift {
  if (day.mainLiftExerciseId !== undefined) {
    const name = nameOf(day.mainLiftExerciseId);
    if (name !== null) return { exerciseId: day.mainLiftExerciseId, name, source: 'yours' };
  }
  const r = recommendMainLift(day, history);
  return r === null ? null : { exerciseId: r.id, name: r.name, source: 'recommended' };
}

/** Exercises Ben can pick as a day's main lift: compound ones whose main muscle is one of the day's body parts, by name. */
export function mainLiftOptions<E extends Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'mechanic'>>(day: Pick<SplitDay, 'bodyParts'>, exercises: readonly E[]): E[] {
  return exercises
    .filter((e) => {
      const first = e.primaryMuscles[0];
      const g = first === undefined ? null : muscleGroupOf(first);
      return e.mechanic === 'compound' && g !== null && (day.bodyParts as readonly string[]).includes(g);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether the goal check-in is due: `checkInWeeks` since the goal was set or confirmed. */
export function goalCheckInDue(p: Pick<TrainingProfile, 'goal' | 'goalSetAtUtc' | 'checkInWeeks'>, nowUtc: string): boolean {
  if (p.goal === undefined || p.goalSetAtUtc === undefined) return false;
  return toMs(nowUtc) - toMs(p.goalSetAtUtc) >= p.checkInWeeks * 7 * 86_400_000;
}

/** True for a split body part list made of valid parts (for UI pickers). */
export const isSplitBodyPart = (s: string): s is SplitBodyPart => SplitBodyPartSchema.safeParse(s).success;

const PRESET_FOCUS: Readonly<Record<string, BuildFocus>> = { push: 'push', pull: 'pull', legs: 'legs', chest: 'chest', shoulders: 'shoulders', back: 'back' };

/** F19: a split day's build focus; a custom day is `split_day`, named by its own name. */
export function splitDayFocus(split: Pick<TrainingSplit, 'kind'>, day: Pick<SplitDay, 'id'>): BuildFocus {
  return split.kind !== 'custom' ? (PRESET_FOCUS[day.id] ?? 'split_day') : 'split_day';
}

type ExerciseInfo = Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'mechanic'>;

/** Completed working sets per session exercise row (warm-ups don't count). */
function workingSetsBy(a: HistoryLike): Map<string, { sets: number; bestKg: number | null }> {
  const out = new Map<string, { sets: number; bestKg: number | null }>();
  for (const s of a.sets) {
    if (s.status !== 'completed' || s.setType === 'warmup') continue;
    const cur = out.get(s.sessionExerciseId) ?? { sets: 0, bestKg: null };
    const l = s.actual?.load ?? null;
    const kg = l === null || l.convention === 'bodyweight' || l.convention === 'assistance' ? null : l.unit === 'kg' ? l.value : l.value * KG_PER_LB;
    out.set(s.sessionExerciseId, { sets: cur.sets + 1, bestKg: kg === null ? cur.bestKg : Math.max(cur.bestKg ?? 0, kg) });
  }
  return out;
}

/** Ben's lifts from finished workouts, for `recommendMainLift`: how many workouts each was in and its heaviest working load. */
export function liftHistoryFrom(sessions: readonly HistoryLike[], exerciseOf: (id: string) => ExerciseInfo | null): LiftHistory[] {
  const by = new Map<string, LiftHistory>();
  for (const a of sessions) {
    const sets = workingSetsBy(a);
    const seen = new Set<string>();
    for (const ex of a.exercises) {
      const w = sets.get(ex.id);
      const info = exerciseOf(ex.exerciseId);
      if (w === undefined || info === null || seen.has(info.id)) continue;
      seen.add(info.id);
      const cur = by.get(info.id) ?? { exercise: info, sessions: 0, bestKg: null };
      by.set(info.id, { exercise: info, sessions: cur.sessions + 1, bestKg: w.bestKg === null ? cur.bestKg : Math.max(cur.bestKg ?? 0, w.bestKg) });
    }
  }
  return [...by.values()];
}

/**
 * The muscle groups of the newest finished workout (by start) that matches a
 * day of `split`, for `nextSplitDay`; a workout that fits no day (Core only,
 * say) is skipped so the rotation doesn't reset (review S6). Null with none.
 */
export function lastSplitWorkoutGroups(split: TrainingSplit, sessions: readonly HistoryLike[], exerciseOf: (id: string) => ExerciseInfo | null): Map<MuscleGroup, number> | null {
  const newestFirst = [...sessions].sort((a, b) => (a.session.startedAt.utc < b.session.startedAt.utc ? 1 : a.session.startedAt.utc > b.session.startedAt.utc ? -1 : 0));
  for (const a of newestFirst) {
    const groups = workoutGroupsOf(a, exerciseOf);
    if (matchSplitDay(split, groups) !== null) return groups;
  }
  return null;
}

/** The muscle groups one finished workout trained: completed working sets on each exercise's first primary muscle. */
export function workoutGroupsOf(a: HistoryLike, exerciseOf: (id: string) => Pick<Exercise, 'primaryMuscles'> | null): Map<MuscleGroup, number> {
  const sets = workingSetsBy(a);
  return workoutMuscleGroups(a.exercises.map((ex) => ({ primaryMuscles: exerciseOf(ex.exerciseId)?.primaryMuscles ?? [], workingSets: sets.get(ex.id)?.sets ?? 0 })));
}
