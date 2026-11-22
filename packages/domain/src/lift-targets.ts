import {
  LIFT_TARGET_LIMITS,
  LiftTargetConventionSchema,
  type EquipmentKind,
  type Exercise,
  type LiftTarget,
  type LiftTargetConvention,
  type LiftTargetKind,
  type LiftTargetWas,
  type Load,
  type SetType,
  type TrainingProfile,
  type WeightUnit,
} from '@fizz/schemas';
import { addDays, daysBetween } from './calendar';
import { formatNumber, localDateText, NBSP } from './display';
import { isSetCountable } from './exclusions';
import { estimateOneRepMax, roundEstimate } from './progress/e1rm';
import type { ExerciseMetric, SeriesKind } from './progress/exercise';
import type { ProgressSession } from './progress/projection';
import { toMs } from './time';
import { convertMass } from './units';
import { isPlatesAddedKind } from './plates-added';

/**
 * Lift targets (Ben approved 20 Oct: "Yeah let's do lift targets as something
 * that can be turned on or off"). Pure.
 *
 * - A setting, default off. Off: no lift-target view anywhere and the coach
 *   doesn't see them (`liftTargetsInUse`). The targets are kept.
 * - At most 3, one per exercise. `1RM` ("Bench 100 kg") or weight × reps
 *   ("Bench 90 kg × 5"), an optional date. kg/lb and the convention are
 *   explicit: a dumbbell target is per hand, a machine's is its stack.
 *   Assisted and bodyweight exercises have none.
 * - Shown against Ben's own logged sets: the est. 1RM (always `est.`, from
 *   the Epley estimate Progress uses) or his best set at the target's reps,
 *   in the last `LIFT_TARGET_RECENT_DAYS`; what he had when he set it; time
 *   left and how far to go. Never pass/fail; the one date (Progress v3, `at this rate`, est.) is `liftsView`'s.
 * - Hit: an actual logged set at or above the target since it was set (a
 *   single at the weight for 1RM; the weight for the reps for weight × reps).
 *   An estimate passing it never counts (rule 6). Worked out from the sets
 *   each time, so a corrected set is reflected.
 */

/** How far back `est. 1RM` and `Best:` look. */
export const LIFT_TARGET_RECENT_DAYS = 90;

/** Converted loads within this of the target count as at it (kg ↔ lb rounding). */
const AT_LEAST_EPS = 0.01;

export const LIFT_TARGET_COPY = {
  setting: 'Lift targets',
  label: 'Lift targets',
  add: 'Add target',
  edit: 'Edit',
  remove: 'Remove',
  removed: 'Target removed',
  saved: 'Target set',
  undo: 'Undo',
  oneRm: '1RM',
  weightReps: 'Weight × reps',
  full: 'Max 3 targets',
  none: 'No targets',
  /** Review S3: history couldn't be read, so where he is now (and any hit) is unknown. */
  unread: 'Couldn’t load',
} as const;

// ---------------------------------------------------------------------------
// The setting and the stored list

/** The targets shown and sent to the coach: none while the setting is off. */
export function liftTargetsInUse(p: Pick<TrainingProfile, 'liftTargetsOn' | 'liftTargets'> | null): LiftTarget[] {
  return p?.liftTargetsOn === true ? [...(p.liftTargets ?? [])] : [];
}

export const isLiftTargetConvention = (c: string): c is LiftTargetConvention => LiftTargetConventionSchema.safeParse(c).success;

const isLocalDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

/** Why a target can't be saved, or null when it can. */
export function liftTargetProblem(t: LiftTarget, others: readonly LiftTarget[]): 'convention' | 'load' | 'reps' | 'date' | 'full' | null {
  if (!isLiftTargetConvention(t.load.convention)) return 'convention';
  const kg = t.load.unit === 'kg' ? t.load.value : convertMass({ value: t.load.value, unit: 'lb' }, 'kg').value;
  if (!(t.load.value > 0) || !Number.isFinite(t.load.value) || kg > LIFT_TARGET_LIMITS.loadKgMax) return 'load';
  if (t.kind === 'one_rm' ? t.reps !== 1 : !(Number.isInteger(t.reps) && t.reps >= 1 && t.reps <= LIFT_TARGET_LIMITS.repsMax)) return 'reps';
  if (t.byDate !== undefined && (!isLocalDate(t.byDate) || t.byDate < t.setOnDate)) return 'date';
  if (others.filter((o) => o.exerciseId !== t.exerciseId).length >= LIFT_TARGET_LIMITS.max) return 'full';
  return null;
}

/** The list with `t` for its exercise (replacing that exercise's target in place), or null when it can't be saved. */
export function withLiftTarget(list: readonly LiftTarget[], t: LiftTarget): LiftTarget[] | null {
  if (liftTargetProblem(t, list) !== null) return null;
  const i = list.findIndex((o) => o.exerciseId === t.exerciseId);
  return i === -1 ? [...list, t] : list.map((o, k) => (k === i ? t : o));
}

export function withoutLiftTarget(list: readonly LiftTarget[], exerciseId: string): LiftTarget[] {
  return list.filter((o) => o.exerciseId !== exerciseId);
}

/** Room for a new target (on another exercise than `exerciseId`, when given). */
export function canAddLiftTarget(list: readonly LiftTarget[], exerciseId?: string): boolean {
  return list.some((o) => o.exerciseId === exerciseId) || list.length < LIFT_TARGET_LIMITS.max;
}

// ---------------------------------------------------------------------------
// Logged sets, as the targets read them

/** One completed working set with a load and reps (warm-ups and marked sets are left out). */
export interface LiftSet {
  exerciseId: string;
  /** Local date. */
  date: string;
  /** When it was logged (the workout's start for a date-only import). */
  atMs: number;
  /** An imported workout with a date and no times. */
  dateOnly: boolean;
  load: Load;
  reps: number;
  equipmentKind: EquipmentKind | null;
}

const WORKING: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

/** Ben's working sets from Progress's projection (finished workouts only, corrections applied). `only`: these exercises. */
export function liftSetsOf(sessions: readonly ProgressSession[], only?: ReadonlySet<string>): LiftSet[] {
  const out: LiftSet[] = [];
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (only !== undefined && !only.has(ex.exerciseId)) continue;
      for (const set of ex.sets) {
        if (!WORKING.has(set.setType) || !isSetCountable(set, 'record') || set.load === null || set.reps === null || set.reps < 1) continue;
        const at = set.completedAtUtc === null ? s.startedMs : toMs(set.completedAtUtc);
        out.push({ exerciseId: ex.exerciseId, date: s.date, atMs: at, dateOnly: s.dateOnly, load: set.load, reps: set.reps, equipmentKind: ex.equipmentKind });
      }
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

type TargetTerms = Pick<LiftTarget, 'exerciseId'> & { load: Pick<LiftTarget['load'], 'unit' | 'convention' | 'plateLoaded'> };

/** The set's load in the target's unit, when it is the same exercise and convention (else null: never compared). */
export function loadInTargetTerms(s: LiftSet, t: TargetTerms): number | null {
  if (s.exerciseId !== t.exerciseId || s.load.convention !== t.load.convention) return null;
  if (t.load.convention === 'added' && (isPlatesAddedKind(s.equipmentKind)) !== (t.load.plateLoaded === true)) return null;
  return s.load.unit === t.load.unit ? s.load.value : convertMass({ value: s.load.value, unit: s.load.unit }, t.load.unit).value;
}

/** The best est. 1RM in `[from, to]` (local dates), in the target's terms. */
function bestEstimate(sets: readonly LiftSet[], t: TargetTerms, from: string, to: string, beforeMs = Infinity): { value: number; date: string } | null {
  let best: { value: number; date: string } | null = null;
  for (const s of sets) {
    if (s.date < from || s.date > to || s.atMs >= beforeMs) continue;
    const v = loadInTargetTerms(s, t);
    if (v === null) continue;
    const e = estimateOneRepMax({ value: v, unit: t.load.unit, convention: t.load.convention }, s.reps, s.equipmentKind);
    if (!e.eligible) continue;
    if (best === null || e.value > best.value || (e.value === best.value && s.date > best.date)) best = { value: e.value, date: s.date };
  }
  return best;
}

/** The heaviest set of at least `reps` in `[from, to]`, in the target's terms (ties: more reps, then the later). */
function bestSet(sets: readonly LiftSet[], t: TargetTerms, reps: number, from: string, to: string, beforeMs = Infinity): { value: number; reps: number; date: string } | null {
  let best: { value: number; reps: number; date: string } | null = null;
  for (const s of sets) {
    if (s.date < from || s.date > to || s.atMs >= beforeMs || s.reps < reps) continue;
    const raw = loadInTargetTerms(s, t);
    if (raw === null) continue;
    const v = roundEstimate(raw, t.load.unit);
    if (best === null || v > best.value || (v === best.value && (s.reps > best.reps || (s.reps === best.reps && s.date >= best.date)))) best = { value: v, reps: s.reps, date: s.date };
  }
  return best;
}

/** What Ben had when he set it (stored on the target): sets logged before `atMs`, in the recent window up to `today`. */
export function liftTargetWas(t: TargetTerms & Pick<LiftTarget, 'kind' | 'reps'>, sets: readonly LiftSet[], today: string, atMs: number): LiftTargetWas | null {
  const from = addDays(today, -LIFT_TARGET_RECENT_DAYS);
  if (t.kind === 'one_rm') {
    const e = bestEstimate(sets, t, from, today, atMs);
    return e === null ? null : { value: e.value, date: e.date, isEstimate: true };
  }
  const b = bestSet(sets, t, t.reps, from, today, atMs);
  return b === null ? null : { value: b.value, reps: b.reps, date: b.date, isEstimate: false };
}

/** The first logged set at or above the target since it was set, or null. Estimates never count. */
export function liftTargetHit(t: LiftTarget, sets: readonly LiftSet[]): { date: string } | null {
  const setMs = toMs(t.setAtUtc);
  for (const s of sets) {
    // A date-only import counts from the day after (its time is unknown).
    if (s.dateOnly ? s.date <= t.setOnDate : s.atMs < setMs) continue;
    const v = loadInTargetTerms(s, t);
    if (v !== null && v >= t.load.value - AT_LEAST_EPS && s.reps >= t.reps) return { date: s.date };
  }
  return null;
}

export interface LiftTargetStatus {
  /** `one_rm`: the best est. 1RM in the recent window (an estimate). */
  estimate: { value: number; date: string } | null;
  /** `weight_reps`: the heaviest set of at least the target's reps in the recent window (actual). */
  best: { value: number; reps: number; date: string } | null;
  hit: { date: string } | null;
  /** Days to the target date (negative once it has passed); null with no date. */
  daysLeft: number | null;
  /** How far the est. 1RM or best set is from the target, in its unit; null when hit, at or past it, or nothing logged. */
  toGo: number | null;
}

export function liftTargetStatus(t: LiftTarget, sets: readonly LiftSet[], today: string): LiftTargetStatus {
  const from = addDays(today, -LIFT_TARGET_RECENT_DAYS);
  const estimate = t.kind === 'one_rm' ? bestEstimate(sets, t, from, today) : null;
  const best = t.kind === 'weight_reps' ? bestSet(sets, t, t.reps, from, today) : null;
  const hit = liftTargetHit(t, sets);
  const now = t.kind === 'one_rm' ? (estimate?.value ?? null) : (best?.value ?? null);
  const gap = now === null ? null : roundEstimate(t.load.value - now, t.load.unit);
  return { estimate, best, hit, daysLeft: t.byDate === undefined ? null : daysBetween(today, t.byDate), toGo: hit === null && gap !== null && gap > 0 ? gap : null };
}

// ---------------------------------------------------------------------------
// Text (minimal copy: values, no rule words)

const unitText = (t: Pick<LiftTarget, 'load'>): string => {
  const u = t.load.unit;
  switch (t.load.convention) {
    case 'total':
      return u;
    case 'per_hand':
      return `${u}${NBSP}each`;
    case 'stack':
      return `${u}${NBSP}stack`;
    case 'added':
      return t.load.plateLoaded === true ? `${u}${NBSP}plates` : u;
  }
};

/** `100 kg`, `40 kg each`, `BW + 20 kg`. */
export function liftTargetLoadText(t: Pick<LiftTarget, 'load'>, value: number = t.load.value): string {
  const n = `${formatNumber(value)}${NBSP}${unitText(t)}`;
  return t.load.convention === 'added' && t.load.plateLoaded !== true ? `BW + ${n}` : n;
}

/** `100 kg` (1RM) or `90 kg × 5`. */
export function liftTargetValueText(t: Pick<LiftTarget, 'load' | 'kind' | 'reps'>): string {
  return t.kind === 'one_rm' ? liftTargetLoadText(t) : `${liftTargetLoadText(t)} × ${String(t.reps)}`;
}

/** `8 weeks left`, `5 days left`, `Due today`, `Due 1 Mar` once passed. */
export function liftTargetTimeLeft(daysLeft: number, byDate: string): string {
  if (daysLeft < 0) return `Due ${localDateText(byDate)}`;
  if (daysLeft === 0) return 'Due today';
  if (daysLeft < 7) return `${String(daysLeft)} ${daysLeft === 1 ? 'day' : 'days'} left`;
  const weeks = Math.floor(daysLeft / 7);
  return `${String(weeks)} ${weeks === 1 ? 'week' : 'weeks'} left`;
}

export interface LiftTargetLine {
  exerciseId: string;
  /** `Bench Press 100 kg` · `Bench Press 90 kg × 5`. */
  title: string;
  /** `est. 1RM 92 kg · was 88 kg on 13 Oct` · `Best: 85 kg × 5 on 17 Oct`; null with nothing logged. */
  detail: string | null;
  /** `8 weeks left · 8 kg to go`; null when hit or nothing to say. */
  progress: string | null;
  /** `Hit 2 Dec`. */
  hit: string | null;
  accessibilityLabel: string;
}

/** One target as the Your plan block and exercise detail show it. `name`: the exercise's name now (else the stored one). */
export function liftTargetLine(t: LiftTarget, s: LiftTargetStatus, name: string | null = null): LiftTargetLine {
  const title = `${name ?? t.exerciseName} ${liftTargetValueText(t)}`;
  let detail: string | null;
  if (t.kind === 'one_rm') {
    const parts = [
      s.estimate === null ? null : `est. 1RM ${liftTargetLoadText(t, s.estimate.value)}`,
      t.was === null ? null : `was ${liftTargetLoadText(t, t.was.value)} on ${localDateText(t.was.date)}`,
    ].filter((x): x is string => x !== null);
    detail = parts.length === 0 ? null : parts.join(' · ');
  } else {
    detail = s.best === null ? null : `Best: ${liftTargetLoadText(t, s.best.value)} × ${String(s.best.reps)} on ${localDateText(s.best.date)}`;
  }
  const hit = s.hit === null ? null : `Hit ${localDateText(s.hit.date)}`;
  const progressParts =
    s.hit !== null
      ? []
      : [s.daysLeft === null || t.byDate === undefined ? null : liftTargetTimeLeft(s.daysLeft, t.byDate), s.toGo === null ? null : `${t.kind === 'one_rm' ? '≈' : ''}${formatNumber(s.toGo)}${NBSP}${t.load.unit} to go`].filter((x): x is string => x !== null);
  // Review S5: a 1RM target's "to go" is from the estimate, so it reads as approximate (≈).
  const progress = progressParts.length === 0 ? null : progressParts.join(' · ');
  const words = [title, hit, detail?.replaceAll('est.', 'estimated') ?? null, progress?.replaceAll('≈', 'about ') ?? null].filter((x): x is string => x !== null).join('. ');
  return { exerciseId: t.exerciseId, title, detail, progress, hit, accessibilityLabel: words.replaceAll(NBSP, ' ') };
}

/**
 * (Review S3) A target whose history couldn't be read: the title and `Couldn’t load`, never an empty
 * "nothing logged" that would hide a hit or the est. 1RM (rule 6).
 */
export function liftTargetLineUnread(t: LiftTarget, name: string | null = null): LiftTargetLine {
  const title = `${name ?? t.exerciseName} ${liftTargetValueText(t)}`;
  return { exerciseId: t.exerciseId, title, detail: LIFT_TARGET_COPY.unread, progress: null, hit: null, accessibilityLabel: `${title}. ${LIFT_TARGET_COPY.unread}`.replaceAll(NBSP, ' ') };
}

// ---------------------------------------------------------------------------
// Choosing an exercise and building a target

/** An exercise Ben can set a target on: one he has logged load-based working sets for (his own included). */
export interface LiftTargetChoice {
  exerciseId: string;
  name: string;
  /** From his newest set (a dumbbell press is per hand, a machine its stack). */
  convention: LiftTargetConvention;
  unit: WeightUnit;
  plateLoaded: boolean;
  lastDate: string;
}

/** Exercises with load-based sets, newest first. Archived exercises are left out; unknown IDs keep their logged name. */
export function liftTargetChoices(sets: readonly LiftSet[], exercises: ReadonlyMap<string, Pick<Exercise, 'id' | 'name' | 'archivedAtUtc'>>, loggedNames: ReadonlyMap<string, string> = new Map()): LiftTargetChoice[] {
  const latest = new Map<string, LiftSet>();
  for (const s of sets) if (isLiftTargetConvention(s.load.convention)) latest.set(s.exerciseId, s);
  const out: LiftTargetChoice[] = [];
  for (const [id, s] of latest) {
    const e = exercises.get(id);
    if (e?.archivedAtUtc !== undefined) continue;
    const name = e?.name ?? loggedNames.get(id) ?? null;
    if (name === null || !isLiftTargetConvention(s.load.convention)) continue;
    out.push({ exerciseId: id, name, convention: s.load.convention, unit: s.load.unit, plateLoaded: isPlatesAddedKind(s.equipmentKind), lastDate: s.date });
  }
  return out.sort((a, b) => (a.lastDate !== b.lastDate ? (a.lastDate < b.lastDate ? 1 : -1) : a.name.localeCompare(b.name)));
}

export interface NewLiftTargetInput {
  id: string;
  choice: LiftTargetChoice;
  kind: LiftTargetKind;
  value: number;
  unit: WeightUnit;
  /** Ignored for 1RM (always 1). */
  reps: number;
  byDate: string | null;
  atUtc: string;
  /** Ben's local date now. */
  today: string;
  setBy: 'ben' | 'coach';
}

/** A new target with what Ben had when he set it. Checked when saved (`withLiftTarget`). */
export function newLiftTarget(i: NewLiftTargetInput, sets: readonly LiftSet[]): LiftTarget {
  const terms = { exerciseId: i.choice.exerciseId, load: { unit: i.unit, convention: i.choice.convention, ...(i.choice.plateLoaded ? { plateLoaded: true } : {}) } };
  const reps = i.kind === 'one_rm' ? 1 : i.reps;
  const value = Math.round(i.value * 100) / 100;
  return {
    id: i.id,
    exerciseId: i.choice.exerciseId,
    exerciseName: i.choice.name.slice(0, 120),
    kind: i.kind,
    load: { value, ...terms.load },
    reps,
    ...(i.byDate === null ? {} : { byDate: i.byDate }),
    setAtUtc: i.atUtc,
    setOnDate: i.today,
    was: liftTargetWas({ ...terms, kind: i.kind, reps }, sets, i.today, toMs(i.atUtc)),
    setBy: i.setBy,
  };
}

/**
 * (Review S1) The same goal saved again, or only its date changed: the existing target stays, with
 * its ID, when it was set, its "was" and so its hit; only the date is the new one. A different
 * weight, reps, kind, unit or convention is a new target.
 */
export function keepSameLiftTarget(next: LiftTarget, existing: LiftTarget | null | undefined): LiftTarget {
  if (existing === null || existing === undefined) return next;
  const same =
    existing.exerciseId === next.exerciseId &&
    existing.kind === next.kind &&
    existing.reps === next.reps &&
    existing.load.value === next.load.value &&
    existing.load.unit === next.load.unit &&
    existing.load.convention === next.load.convention &&
    (existing.load.plateLoaded === true) === (next.load.plateLoaded === true);
  if (!same) return next;
  const kept: LiftTarget = { ...existing };
  delete kept.byDate;
  return next.byDate === undefined ? kept : { ...kept, byDate: next.byDate };
}

/** The editor's number: a positive number (comma or point), else null. */
export function readLiftTargetNumber(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// The exercise detail chart's dotted line

/**
 * The target on the exercise detail chart, in the series' unit: a 1RM target
 * on the Est. 1RM measure, a weight × reps target on the Top set measure.
 * Progress has one series per exercise and kind (Ben, 20 Oct): the line goes on
 * the `load` series when its convention (the latest row's) is the target's,
 * so a per-hand target never sits on a total-barbell chart. A `BW +` weight ×
 * reps target goes on the BW + series' Top set (bodyweight and weighted are
 * one series, bodyweight as `+0`; Ben, 20 Oct). Null otherwise.
 */
export function liftTargetChartValue(t: LiftTarget | null, series: { exerciseId: string; kind?: SeriesKind; convention: string; unit: WeightUnit; metric: ExerciseMetric }): number | null {
  if (t === null || t.exerciseId !== series.exerciseId || t.load.convention !== series.convention) return null;
  const bwPlus = t.load.convention === 'added' && t.load.plateLoaded !== true;
  if (bwPlus ? series.kind !== 'added_bodyweight' || t.kind === 'one_rm' : series.kind !== undefined && series.kind !== 'load') return null;
  const wanted: ExerciseMetric = t.kind === 'one_rm' ? 'e1rm' : 'top_set';
  if (series.metric !== wanted) return null;
  return t.load.unit === series.unit ? t.load.value : convertMass({ value: t.load.value, unit: t.load.unit }, series.unit).value;
}

// ---------------------------------------------------------------------------
// The coach's view (Your data; only while the setting is on)

export interface LiftTargetCoachView {
  exercise: string;
  exerciseId: string;
  target: string;
  kind: 'one-rep max' | 'weight for reps';
  load: { value: number; unit: WeightUnit; convention: LiftTargetConvention };
  reps: number;
  by: string | null;
  setOn: string;
  /** An estimate, labelled so. */
  estimatedOneRepMaxNow?: { value: number; date: string; isEstimate: true };
  bestSetNow?: { value: number; reps: number; date: string };
  hit: string | null;
  /** Review S3: his history couldn't be read: where he is now and whether it is hit are unknown (not "none"). */
  historyUnreadable?: true;
}

export function liftTargetCoachView(t: LiftTarget, s: LiftTargetStatus, name: string | null = null): LiftTargetCoachView {
  return {
    exercise: name ?? t.exerciseName,
    exerciseId: t.exerciseId,
    target: liftTargetValueText(t).replaceAll(NBSP, ' '),
    kind: t.kind === 'one_rm' ? 'one-rep max' : 'weight for reps',
    load: { value: t.load.value, unit: t.load.unit, convention: t.load.convention },
    reps: t.reps,
    by: t.byDate ?? null,
    setOn: t.setOnDate,
    ...(s.estimate === null ? {} : { estimatedOneRepMaxNow: { ...s.estimate, isEstimate: true as const } }),
    ...(s.best === null ? {} : { bestSetNow: { ...s.best } }),
    hit: s.hit?.date ?? null,
  };
}

/** (Review S3) The coach's view of a target when his history couldn't be read: no current value, hit unknown. */
export function liftTargetCoachViewUnread(t: LiftTarget, name: string | null = null): LiftTargetCoachView {
  return { ...liftTargetCoachView(t, { estimate: null, best: null, hit: null, daysLeft: null, toGo: null }, name), historyUnreadable: true };
}
