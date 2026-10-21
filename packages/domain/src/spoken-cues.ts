import type { Load, LoadConvention, Measurement, RepRange, SessionAggregate, SetSide, SetType, WeightUnit } from '@fizz/schemas';

import { formatNumber, type LoadContext } from './display';
import { equipmentOfRow } from './session/equipment-snapshot';
import { blockSets } from './session/gym-switch';
import { prefillDraft, type ComparableSet } from './session/view';
import type { CarryOptions } from './session/carry';
import { isPlatesAddedKind } from './plates-added';

/**
 * Spoken workout cues (Ben, 19 Oct 2026; rest-state.md §5, design-system §8
 * "Spoken" column). Pure: the words only. When to speak is the app's cue
 * controller; how is the audio-coach module.
 *
 * Detail levels: `timer` says only "10 seconds" and "Rest done"; `timer_and_set`
 * adds the next set: "Rest done. Set 2, bench press, 80 kilos for 8."
 */

export type CueDetail = 'timer' | 'timer_and_set';

/** `80`, `97 and a half`, `21.25`: halves the way people say them. */
export function spokenNumber(value: number): string {
  const text = formatNumber(value);
  const whole = Math.trunc(value);
  if (whole >= 1 && Math.abs(value - whole - 0.5) < 1e-9) return `${String(whole)} and a half`;
  return text;
}

/** `kilos` / `pounds`; singular only for exactly 1. */
export function spokenUnit(unit: WeightUnit, value: number): string {
  const one = value === 1;
  return unit === 'kg' ? (one ? 'kilo' : 'kilos') : one ? 'pound' : 'pounds';
}

function mass(value: number, unit: WeightUnit): string {
  return `${spokenNumber(value)} ${spokenUnit(unit, value)}`;
}

/**
 * A load read aloud, with its unit and convention (design-system §8): `80 kilos`,
 * `30 kilos each`, `45 kilos on the stack`, `40 kilos of plates`, `20 kilos of
 * assistance`, `bodyweight plus 10 kilos`, `bodyweight`. Null: no load to say.
 */
export function spokenLoad(load: Load | null, convention: LoadConvention, equipment: LoadContext = null): string | null {
  if (convention === 'bodyweight' || load?.convention === 'bodyweight') return 'bodyweight';
  if (load === null) return convention === 'added' && !isPlatesAddedKind(equipment?.kind) ? 'bodyweight' : null;
  const n = mass(load.value, load.unit);
  switch (load.convention) {
    case 'total':
      return n;
    case 'per_hand':
      return `${n} each`;
    case 'stack':
      return `${n} on the stack`;
    case 'added':
      if (isPlatesAddedKind(equipment?.kind)) return `${n} of plates`;
      return load.value === 0 ? 'bodyweight' : `bodyweight plus ${n}`;
    case 'assistance':
      return `${n} of assistance`;
  }
}

/** rest-state §5: ≤ 90 s "90 seconds"; whole minutes "3 minutes"; otherwise "2 minutes 30"; hours "1 hour 10 minutes". */
export function spokenDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s <= 90) return `${String(s)} ${s === 1 ? 'second' : 'seconds'}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const minutes = (n: number) => `${String(n)} ${n === 1 ? 'minute' : 'minutes'}`;
  if (h > 0) {
    const hours = `${String(h)} ${h === 1 ? 'hour' : 'hours'}`;
    return m === 0 ? hours : `${hours} ${minutes(m)}`;
  }
  return sec === 0 ? minutes(m) : `${minutes(m)} ${String(sec)}`;
}

/** `400 metres`, `1.5 kilometres`. */
export function spokenDistance(metres: number): string {
  const m = Math.max(0, metres);
  if (m >= 1000) {
    const km = m / 1000;
    return `${spokenNumber(km)} ${km === 1 ? 'kilometre' : 'kilometres'}`;
  }
  return `${spokenNumber(m)} ${m === 1 ? 'metre' : 'metres'}`;
}

function spokenReps(r: RepRange): string {
  return r.min === r.max ? String(r.min) : `${String(r.min)} to ${String(r.max)}`;
}

/** What one set is, in words, for a cue. Everything already decided; nothing worked out here. */
export interface SpokenSetInput {
  exerciseName: string;
  /** The set's number in its exercise block (warm-ups included), as the card shows it. */
  number: number;
  setType: SetType;
  measurement: Measurement;
  unilateral: boolean;
  side: SetSide | null;
  convention: LoadConvention;
  equipment: LoadContext;
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
  distanceM: number | null;
}

/**
 * `Set 2, bench press, 80 kilos for 8` · `Warm-up, bench press, 40 kilos for 10` ·
 * `Set 1, push-up, 12 reps` · `Set 3, plank, for 45 seconds` · `Set 1, rowing,
 * for 20 minutes` · `Set 2, split squat, 20 kilos each for 8 each side`.
 */
export function spokenSetDetail(s: SpokenSetInput): string {
  const head = s.setType === 'warmup' ? 'Warm-up' : `Set ${String(s.number)}`;
  const side = s.side === 'left' ? ', left side' : s.side === 'right' ? ', right side' : '';
  const name = s.exerciseName.trim();
  // Plain bodyweight is never said: such a set is just its reps or time ("12 reps"); "bodyweight plus 10 kilos" is.
  const raw = spokenLoad(s.load, s.convention, s.equipment);
  const bodyweight = raw === 'bodyweight';
  const load = bodyweight ? null : raw;
  let amount: string | null = null;
  if (s.measurement === 'duration' && s.durationS !== null) amount = `for ${spokenDuration(s.durationS)}`;
  else if (s.measurement === 'distance' && s.distanceM !== null) amount = `for ${spokenDistance(s.distanceM)}`;
  else if (s.measurement === 'reps' && s.reps !== null) {
    // A chosen side is already said ("left side"); "each side" only when both sides are done.
    const each = s.unilateral && s.side === null ? ' each side' : '';
    // No load to say on a loaded exercise (none anywhere): left out, never phrased as a bodyweight set.
    amount = bodyweight ? `${spokenReps(s.reps)} reps${each}` : `for ${spokenReps(s.reps)}${each}`;
  }
  const what = [load, amount].filter((x): x is string => x !== null).join(' ');
  return `${head}${side}, ${name}${what === '' ? '' : `, ${what}`}`;
}

/**
 * The active set of a workout as `SpokenSetInput`, or null (none, or not found).
 * The values are the card's (`prefillDraft`, the same precedence as the Focus
 * card: saved draft → target field by field, open fields from this session or
 * `lastComparable` → empty), so the voice never says a load or reps the screen
 * doesn't show (review B1). A field with no value anywhere is left out.
 */
export function spokenSetOf(state: SessionAggregate, setId: string | null, lastComparable: readonly ComparableSet[] = [], carry: CarryOptions = {}): SpokenSetInput | null {
  if (setId === null) return null;
  const set = state.sets.find((s) => s.id === setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  const own = blockSets(state, ex.id);
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const v = prefillDraft(state, setId, lastComparable, carry).values;
  return {
    exerciseName: ex.exerciseName,
    number: Math.max(1, own.indexOf(set) + 1),
    setType: set.setType,
    measurement: ex.measurement,
    unilateral: ex.laterality === 'unilateral',
    side: set.side === 'both' ? null : set.side,
    convention: ex.loadConvention,
    equipment: eq,
    load: v.load,
    reps: v.reps === null ? null : { min: v.reps, max: v.reps },
    durationS: v.durationS,
    distanceM: v.distanceM ?? null,
  };
}

export type CueEvent = { kind: 'warning'; seconds: number } | { kind: 'rest_end'; next: SpokenSetInput | null } | { kind: 'work_end' };

/**
 * The words of one cue: `10 seconds.` · `Rest done.` · `Rest done. Set 2, bench
 * press, 80 kilos for 8.` · `Time.` The set detail is added only at
 * `timer_and_set`.
 */
export function cueText(event: CueEvent, detail: CueDetail): string {
  switch (event.kind) {
    case 'warning':
      return `${spokenDuration(event.seconds)}.`;
    case 'work_end':
      return 'Time.';
    case 'rest_end':
      return detail === 'timer_and_set' && event.next !== null ? `Rest done. ${spokenSetDetail(event.next)}.` : 'Rest done.';
  }
}
