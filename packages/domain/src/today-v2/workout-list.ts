import type { LoadConvention, WeightUnit } from '@fizz/schemas';
import { infoOrDefault } from '../builder/arrange';
import type { BuilderInfoLookup, BuilderSlot, BuilderWorkout } from '../builder/types';
import { formatDuration, formatNumber, NBSP } from '../display';

/**
 * (Redesign v3 §A5, §B; Ben, 27 Oct) The compact read-only WorkoutList: `Exercise · Sets · Target kg`, one row per
 * exercise, used on Today's card, Library › Plan › day and a saved workout's page. Pure display rules, values only:
 * - per-dumbbell loads read `ea` (`24 ea`, header `KG EA` when every load is per hand); VoiceOver still says `each`;
 * - `Dumbbell` → `DB` in exercise names, in compact lists only (`Incline DB press`); Barbell is never shortened;
 * - Sets read `4 × 6–8` (working sets × the rep range, or the time of a timed set).
 * The coach's offered value for a row (`✦ 22 ea`) comes from the offer, never computed here (rule 3).
 */

export const WORKOUT_LIST_COPY = {
  exercise: 'Exercise',
  sets: 'Sets',
  /** `Target kg`; `Target lb`. */
  target: (unit: WeightUnit) => `Target ${unit}`,
  superset: 'Superset',
  showExercises: 'Show exercises',
  hideExercises: 'Hide exercises',
  /** `✦ 1 change`. */
  changes: (n: number) => `✦ ${String(n)} ${n === 1 ? 'change' : 'changes'}`,
  changesLabel: (n: number) => `${String(n)} ${n === 1 ? 'change' : 'changes'} from the coach for today. Opens the offer`,
} as const;

/** `Dumbbell` (any case, singular or plural) → `DB` as a whole word. Barbell, Kettlebell and the rest stay as they are. */
export function compactExerciseName(name: string): string {
  return name.replace(/\b[Dd][Uu][Mm][Bb][Bb][Ee][Ll][Ll](s?)\b/g, (_m, s: string) => `DB${s}`);
}

/**
 * A load line already in words (`3 × 8–10 · 22.5 kg each`, `24 each`) as compact lists show it: `each` after a number
 * or unit reads `ea`. VoiceOver labels keep the full words (built separately).
 */
export function compactEachText(text: string): string {
  return text.replace(/(\d|kg|lb)([\s\u00a0]+)each\b/g, '$1$2ea');
}

/** A target load as compact lists show it: `82.5`, `24 ea`, `assist 25`, `+10`, `BW`, `—`; another unit inline (`45 lb`). */
export function compactLoadText(value: number | null, unit: WeightUnit, convention: LoadConvention, headerUnit: WeightUnit, platesAdded = false): string {
  if (convention === 'bodyweight') return 'BW';
  // (Ben, 29 Oct: leg press read `BW`) Plates on a loaded machine (leg press, Smith): a kg target, never bodyweight.
  if (convention === 'added' && platesAdded) return value === null ? '—' : `${formatNumber(value)}${unit === headerUnit ? '' : `${NBSP}${unit}`}`;
  if (value === null) return convention === 'added' ? 'BW' : '—';
  const n = `${formatNumber(value)}${unit === headerUnit ? '' : `${NBSP}${unit}`}`;
  switch (convention) {
    case 'per_hand':
      return `${n}${NBSP}ea`;
    case 'assistance':
      return `assist${NBSP}${n}`;
    case 'added':
      return value === 0 ? 'BW' : `+${n}`;
    case 'total':
    case 'stack':
      return n;
  }
}

/** Spoken form: `24 kilograms each`, `assistance 25 kilograms`, `bodyweight plus 10 kilograms`. */
export function compactLoadSpoken(value: number | null, unit: WeightUnit, convention: LoadConvention, platesAdded = false): string {
  if (convention === 'bodyweight') return 'bodyweight';
  if (convention === 'added' && platesAdded) return value === null ? 'no load yet' : `${formatNumber(value)} ${unit === 'kg' ? 'kilograms' : 'pounds'}`;
  if (value === null) return convention === 'added' ? 'bodyweight' : 'no load yet';
  const u = unit === 'kg' ? 'kilograms' : 'pounds';
  const n = formatNumber(value);
  switch (convention) {
    case 'per_hand':
      return `${n} ${u} each`;
    case 'assistance':
      return `assistance ${n} ${u}`;
    case 'added':
      return value === 0 ? 'bodyweight' : `bodyweight plus ${n} ${u}`;
    case 'total':
    case 'stack':
      return `${n} ${u}`;
  }
}

/** Header for the target column: `Target kg`, or `Target kg ea` when every row with a load is per hand. */
export function workoutListTargetHeader(unit: WeightUnit, conventions: readonly LoadConvention[]): string {
  const loaded = conventions.filter((c) => c !== 'bodyweight');
  return loaded.length > 0 && loaded.every((c) => c === 'per_hand') ? `${WORKOUT_LIST_COPY.target(unit)} ea` : WORKOUT_LIST_COPY.target(unit);
}

/** `Target kg` → `Target` over `kg` (Ben, 27 Oct: the column stays narrow; the header is uppercase); `Target kg ea` → `kg ea`. */
export function workoutListTargetLines(target: string): [string, string] {
  const [first = '', ...rest] = target.split(' ');
  return [first, rest.join(' ')];
}

export interface WorkoutListRow {
  key: string;
  exerciseId: string;
  /** The compact name (`DB shoulder press`). */
  name: string;
  /** The full name, for VoiceOver and a row's sheet. */
  fullName: string;
  main: boolean;
  /** `4 × 6–8`, `3 × 0:45`. */
  sets: string;
  /** `82.5`, `24 ea`, `BW`, `—`. */
  target: string;
  /** The coach's offered value for today (`✦ 22 ea`), when an offer changes this row's load; else null. */
  coach: string | null;
  /** Rows sharing a superset block share this number; null: on its own. */
  superset: number | null;
  /** Pain-flagged (rule 9): held, never progressed. */
  held: boolean;
  accessibilityLabel: string;
}

const working = (s: BuilderSlot) => s.rows.filter((r) => r.type !== 'warmup');

/** `6–8`, `10`, `0:45` for a slot's working sets. */
export function slotRepsText(s: BuilderSlot): string {
  const rows = working(s);
  const timed = rows.find((r) => r.durationS !== undefined);
  if (timed?.durationS !== undefined) return formatDuration(timed.durationS);
  if (rows.length === 0) return s.repRange.min === s.repRange.max ? String(s.repRange.min) : `${String(s.repRange.min)}–${String(s.repRange.max)}`;
  const lo = Math.min(...rows.map((r) => r.reps));
  const hi = Math.max(...rows.map((r) => r.repsMax ?? r.reps));
  // The builder's rows carry the target (the range's bottom); the slot's range is what Ben aims for (`8–10`).
  const range = s.repRange;
  const inRange = lo >= range.min && hi <= range.max;
  const [from, to] = inRange ? [range.min, range.max] : [lo, hi];
  return from === to ? String(from) : `${String(from)}–${String(to)}`;
}

function topLoad(s: BuilderSlot): number | null {
  const loads = working(s)
    .map((r) => r.load)
    .filter((l): l is number => l !== null);
  if (loads.length === 0) return null;
  return s.convention === 'assistance' ? Math.min(...loads) : Math.max(...loads);
}

function spokenSets(s: BuilderSlot): string {
  const n = working(s).length;
  const reps = slotRepsText(s);
  const timed = reps.includes(':');
  return `${String(n)} ${n === 1 ? 'set' : 'sets'} of ${timed ? reps : reps.replace('–', ' to ')}${timed ? '' : ' reps'}`;
}

/** The coach's offered top load per slot key (in the slot's unit): `workoutListRows`'s `coach` input. */
export type CoachRowLoads = Readonly<Record<string, number>>;

/**
 * The slots whose top working load an offer changes, with the load after (`before` → `after` from code's own apply of
 * the offer, so snapped, bounded and pain-checked). Pure; nothing is applied here (rule 3).
 */
export function coachRowLoads(before: BuilderWorkout, after: BuilderWorkout): CoachRowLoads {
  const out: Record<string, number> = {};
  const was = new Map(before.blocks.flatMap((b) => b.slots).map((s) => [s.key, s] as const));
  for (const s of after.blocks.flatMap((b) => b.slots)) {
    const b = was.get(s.key);
    if (b === undefined || b.exerciseId !== s.exerciseId || b.unit !== s.unit || b.convention !== s.convention) continue;
    const now = topLoad(s);
    if (now !== null && now !== topLoad(b)) out[s.key] = now;
  }
  return out;
}

/** The workout's rows in order, supersets grouped by block. */
export function workoutListRows(w: BuilderWorkout, info: BuilderInfoLookup, unit: WeightUnit, o: { pained?: (exerciseId: string) => boolean; coach?: CoachRowLoads; /** (Ben, 29 Oct) Exercises whose first-time estimate (`startLight`) shows as `40 est.` when they have no target. */ estimateFor?: ReadonlySet<string> } = {}): WorkoutListRow[] {
  const out: WorkoutListRow[] = [];
  w.blocks.forEach((b, bi) => {
    const ss = b.slots.length > 1;
    for (const s of b.slots) {
      const fullName = infoOrDefault(info, s.exerciseId).name;
      const plates = info(s.exerciseId)?.platesAdded === true;
      const n = working(s).length;
      const own = topLoad(s);
      // No target of its own (no history): the first-time estimate, labelled (rule 6), for the exercises asked.
      const est = own === null && s.startLight !== null && s.convention !== 'bodyweight' && o.estimateFor?.has(s.exerciseId) === true;
      const value = est ? s.startLight : own;
      const coachValue = o.coach?.[s.key];
      const coach = coachValue === undefined ? null : `✦${NBSP}${compactLoadText(coachValue, s.unit, s.convention, unit, plates)}`;
      const held = o.pained?.(s.exerciseId) ?? false;
      out.push({
        key: s.key,
        exerciseId: s.exerciseId,
        name: compactExerciseName(fullName),
        fullName,
        main: s.main,
        sets: `${String(n)}${NBSP}×${NBSP}${slotRepsText(s)}`,
        target: est ? `${compactLoadText(value, s.unit, s.convention, unit, plates)} est.` : compactLoadText(value, s.unit, s.convention, unit, plates),
        coach,
        superset: ss ? bi : null,
        held,
        accessibilityLabel: [
          fullName,
          s.main ? 'main lift' : null,
          ss ? 'superset' : null,
          held ? 'pain flag, held' : null,
          spokenSets(s),
          `target ${compactLoadSpoken(value, s.unit, s.convention, plates)}${est ? ', estimate' : ''}`,
          coachValue === undefined ? null : `coach suggests ${compactLoadSpoken(coachValue, s.unit, s.convention, plates)}, tap to review`,
        ]
          .filter((x): x is string => x !== null)
          .join(', '),
      });
    }
  });
  return out;
}
