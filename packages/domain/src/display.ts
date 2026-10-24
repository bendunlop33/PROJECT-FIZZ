import type { EquipmentInstance, Load, LoadConvention, Measurement, PlannedSet, RepRange, SetSide, SetType, SetValues, WeightUnit } from '@fizz/schemas';
import { localDateOf } from './calendar';
import { toMs } from './time';
import { fromScaled, toScaled } from './units';
import { isPlatesAddedKind } from './plates-added';

/**
 * Display text for loads, values and targets (design-system §3 and §8), so
 * the Log label, set rows, notifications and the summary all say exactly
 * what is saved. Pure. A no-break space sits between a number and its unit
 * and around `×`; no trailing `.0`. The decimal separator is `.` (locale
 * separators are a later polish item).
 */

export const NBSP = ' ';
const TIMES = `${NBSP}×${NBSP}`;

/** `100`, `102.5`, `21.25`: never a trailing `.0`. */
export function formatNumber(value: number): string {
  return String(fromScaled(toScaled(value)));
}

/** `0:45`, `1:30` (rest and work times). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** `50 m`, `400 m`, `1.5 km` (distance sets: sled push, carries). */
export function formatDistance(metres: number): string {
  const m = Math.max(0, metres);
  return m >= 1000 ? `${formatNumber(m / 1000)}${NBSP}km` : `${formatNumber(m)}${NBSP}m`;
}

/** Elapsed workout time: `m:ss` under an hour, `h:mm:ss` from an hour up. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${sec}` : `${String(m)}:${sec}`;
}

/* Cardio sets (19 Oct): time and distance as the machine shows them. Pace is in `cardio.ts`. */

/** `20:00`, `1:05:00`. */
export function cardioTimeText(durationS: number): string {
  return formatElapsed(Math.round(durationS) * 1000);
}

/** `4,800 m`, `850 m`, `10,250.5 m`: metres as the machine shows them, grouped by thousands. */
export function cardioDistanceText(metres: number): string {
  const [whole = '0', frac] = formatNumber(Math.max(0, metres)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${frac === undefined ? '' : `.${frac}`}${NBSP}m`;
}

/** `20:00 · 4,800 m`, `20:00`, `4,800 m`, or `—` with neither. */
export function cardioValuesText(values: Pick<SetValues, 'durationS' | 'distanceM'>): string {
  const parts: string[] = [];
  if (values.durationS !== null) parts.push(cardioTimeText(values.durationS));
  if (values.distanceM !== null && values.distanceM !== undefined) parts.push(cardioDistanceText(values.distanceM));
  return parts.length === 0 ? '—' : parts.join(' · ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `1 Oct`: the calendar day of a UTC instant in `tz` (design-system §3 dates), for domain-built sentences. */
export function dayMonthText(utc: string, tz: string): string {
  const [, month, day] = localDateOf(toMs(utc), tz).split('-');
  return `${String(Number(day))}${NBSP}${MONTHS[Number(month) - 1] ?? ''}`;
}

/** `3 Nov`: a local calendar date (`YYYY-MM-DD`), as `dayMonthText` prints an instant. */
export function localDateText(localDate: string): string {
  const [, month, day] = localDate.split('-');
  return `${String(Number(day))}${NBSP}${MONTHS[Number(month) - 1] ?? ''}`;
}

/** Summary durations: `54 min`, `1 h 04 min`. */
export function formatMinutes(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${String(h)}${NBSP}h ${String(m).padStart(2, '0')}${NBSP}min` : `${String(m)}${NBSP}min`;
}

/** Equipment kind hint: `added` reads `plates` on a plate-loaded machine, `BW + …` otherwise. */
export type LoadContext = Pick<EquipmentInstance, 'kind'> | null;

/** `100 kg`, `22.5 kg each`, `45 kg stack`, `40 kg plates`, `Assist 20 kg`, `BW + 10 kg`, `BW`. */
export function loadText(load: Load | null, convention: LoadConvention, equipment: LoadContext = null): string {
  if (convention === 'bodyweight' || load?.convention === 'bodyweight') return 'BW';
  if (load === null) return convention === 'added' && !isPlatesAddedKind(equipment?.kind) ? 'BW' : '—';
  const n = `${formatNumber(load.value)}${NBSP}${load.unit}`;
  switch (load.convention) {
    case 'total':
      return n;
    case 'per_hand':
      return `${n}${NBSP}each`;
    case 'stack':
      return `${n}${NBSP}stack`;
    case 'added':
      if (isPlatesAddedKind(equipment?.kind)) return `${n}${NBSP}plates`;
      return load.value === 0 ? 'BW' : `BW + ${n}`;
    case 'assistance':
      return `Assist ${n}`;
  }
}

/**
 * The load of a distance set (sled push, carries): what is on the sled or in
 * the hands, never `BW + …` (Ben's body isn't part of a sled load). Other
 * conventions read as `loadText`.
 */
export function distanceLoadText(load: Load | null, convention: LoadConvention, equipment: LoadContext = null): string | null {
  if (convention === 'bodyweight' || load === null || load.convention === 'bodyweight') return null;
  if (load.convention !== 'added' || isPlatesAddedKind(equipment?.kind)) return loadText(load, convention, equipment);
  return load.value === 0 ? null : `${formatNumber(load.value)}${NBSP}${load.unit}`;
}

/** The number field's label (active-workout §5). Null = no load field (bodyweight). */
export function loadFieldLabel(convention: LoadConvention, equipment: LoadContext = null): string | null {
  switch (convention) {
    case 'total':
      return 'Load';
    case 'per_hand':
      return 'Load each';
    case 'stack':
      return 'Stack';
    case 'assistance':
      return 'Assist';
    case 'added':
      return isPlatesAddedKind(equipment?.kind) ? 'Plates' : 'Added';
    case 'bodyweight':
      return null;
  }
}

/** Unit suffix shown inside the field (`kg`, `kg each`, `kg stack`). */
export function loadFieldUnit(unit: WeightUnit, convention: LoadConvention): string {
  return convention === 'per_hand' ? `${unit} each` : convention === 'stack' ? `${unit} stack` : unit;
}

export interface ValuesTextOptions {
  convention: LoadConvention;
  measurement: Measurement;
  equipment?: LoadContext;
  /** Unilateral only. */
  side?: SetSide | null;
  /** Compact form for tables: `100×8`. */
  compact?: boolean;
}

/** `100 kg × 8`, `BW × 12`, `0:45`, `40 kg × 50 m`, `20:00 · 4,800 m`; unilateral `… per side` or `Left · …`. */
export function valuesText(values: Pick<SetValues, 'load' | 'reps' | 'durationS' | 'distanceM'>, o: ValuesTextOptions): string {
  const times = o.compact ? '×' : TIMES;
  let body: string;
  if (o.measurement === 'cardio') {
    body = cardioValuesText(values);
  } else if (o.measurement === 'distance') {
    const d = values.distanceM === null || values.distanceM === undefined ? '—' : formatDistance(values.distanceM);
    const load = distanceLoadText(values.load, o.convention, o.equipment);
    body = load === null ? d : `${load}${times}${d}`;
  } else if (o.measurement === 'duration') {
    const d = formatDuration(values.durationS ?? 0);
    body = o.convention === 'bodyweight' || values.load === null ? d : `${loadText(values.load, o.convention, o.equipment)}${times}${d}`;
  } else {
    const reps = values.reps === null ? '—' : String(values.reps);
    const load = o.compact && values.load !== null && values.load.convention !== 'bodyweight' ? formatNumber(values.load.value) : loadText(values.load, o.convention, o.equipment);
    body = `${load}${times}${reps}`;
  }
  if (o.side === 'both') return `${body}${NBSP}per side`;
  if (o.side === 'left') return `Left · ${body}`;
  if (o.side === 'right') return `Right · ${body}`;
  return body;
}

export function repRangeText(r: RepRange): string {
  return r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`;
}

/**
 * `Target 100 kg · 6–8 reps @ RPE 8` (focused card) or null when the set has no target
 * at all (an exercise added to an empty workout).
 */
export function targetText(planned: PlannedSet, o: { convention: LoadConvention; equipment?: LoadContext; perSide?: boolean; rpe?: number | null; measurement?: Measurement }): string | null {
  if (o.measurement === 'cardio') {
    // Cardio (19 Oct): time and distance as the machine shows them; never a load.
    const text = cardioValuesText(planned);
    if (text === '—') return null;
    return `${planned.source === 'coach' ? 'Coach target' : 'Target'} ${text}`;
  }
  const parts: string[] = [];
  const isDistance = planned.distanceM !== undefined && planned.distanceM !== null;
  const load = planned.load === null ? null : isDistance ? distanceLoadText(planned.load, o.convention, o.equipment) : loadText(planned.load, o.convention, o.equipment);
  if (load !== null) parts.push(load);
  if (planned.reps !== null) parts.push(`${repRangeText(planned.reps)}${NBSP}reps${o.perSide ? `${NBSP}per side` : ''}`);
  if (planned.durationS !== null) parts.push(formatDuration(planned.durationS));
  if (planned.distanceM !== undefined && planned.distanceM !== null) parts.push(formatDistance(planned.distanceM));
  if (parts.length === 0) return null;
  // Rule 3: a coach target says so; any other source is behind `Why?` (`Set by`, minimal-copy D1).
  const word = planned.source === 'coach' ? 'Coach target' : 'Target';
  // The set's target RPE (`targetRpeOf`): `Target 100 kg · 3–6 reps @ RPE 8`.
  const rpe = o.rpe == null ? '' : ` @${NBSP}RPE${NBSP}${formatNumber(o.rpe)}`;
  return `${word} ${parts.join(' · ')}${rpe}`;
}

/** A table load cell: the number only (`100`), `BW` for nothing added, `—` for no load; null when the exercise has no load column. */
export function rowLoadCell(load: Load | null, convention: LoadConvention, eq: Pick<EquipmentInstance, 'kind'> | null): string | null {
  if (convention === 'bodyweight') return null;
  if (load === null) return convention === 'added' && !isPlatesAddedKind(eq?.kind) ? 'BW' : '—';
  if (load.convention === 'bodyweight') return 'BW';
  if (load.convention === 'added' && load.value === 0 && !isPlatesAddedKind(eq?.kind)) return 'BW';
  return formatNumber(load.value);
}

/** A table value cell for set values: `8`, `0:45`, `20 m`, `20:00 · 4,800 m`, or `—`. */
export function rowValueCell(v: SetValues, m: Measurement): string {
  if (m === 'cardio') return cardioValuesText(v);
  if (m === 'duration') return v.durationS === null ? '—' : formatDuration(v.durationS);
  if (m === 'distance') return v.distanceM === null || v.distanceM === undefined ? '—' : formatDistance(v.distanceM);
  return v.reps === null ? '—' : String(v.reps);
}

/**
 * The open table row's short target line (18 Oct, Ben: "the table stays a
 * table"): reps / time / distance and the target RPE, `3–6 @ 8.5`. The load
 * is in the row's own cell, so it isn't repeated. Null when there's nothing.
 */
export function targetBrief(planned: Pick<PlannedSet, 'reps' | 'durationS' | 'distanceM'>, rpe: number | null, measurement?: Measurement): string | null {
  if (measurement === 'cardio') {
    const text = cardioValuesText(planned);
    return text === '—' ? null : text;
  }
  const parts: string[] = [];
  if (planned.reps !== null) parts.push(repRangeText(planned.reps));
  if (planned.durationS !== null) parts.push(formatDuration(planned.durationS));
  if (planned.distanceM !== undefined && planned.distanceM !== null) parts.push(formatDistance(planned.distanceM));
  const head = parts.join(' · ');
  const tail = rpe === null ? '' : `@${NBSP}${formatNumber(rpe)}`;
  const text = [head, tail].filter((x) => x !== '').join(' ');
  return text === '' ? null : text;
}

/** Short target for list rows: `Target 100 kg × 6–8`. */
export function targetShort(planned: PlannedSet, o: { convention: LoadConvention; equipment?: LoadContext }): string | null {
  const distance = planned.distanceM === undefined || planned.distanceM === null ? null : formatDistance(planned.distanceM);
  if (planned.load === null && planned.reps === null && planned.durationS === null && distance === null) return null;
  // A time and a distance together is a cardio target (19 Oct): `Target 20:00 · 4,800 m`.
  if (planned.durationS !== null && distance !== null) return `${planned.source === 'coach' ? 'Coach target' : 'Target'} ${cardioValuesText(planned)}`;
  const load = planned.load === null ? null : distance !== null ? distanceLoadText(planned.load, o.convention, o.equipment) : loadText(planned.load, o.convention, o.equipment);
  const reps = planned.reps === null ? null : repRangeText(planned.reps);
  const dur = planned.durationS === null ? null : formatDuration(planned.durationS);
  const right = reps ?? dur ?? distance;
  const word = planned.source === 'coach' ? 'Coach target' : 'Target';
  if (load !== null && right !== null) return `${word} ${load}${TIMES}${right}`;
  if (load !== null) return `${word} ${load}`;
  return `${word} ${right ?? ''}${reps !== null ? `${NBSP}reps` : ''}`;
}

export const SET_TYPE_WORD: Record<SetType, string> = {
  warmup: 'Warm-up',
  working: 'Working',
  top: 'Top set',
  backoff: 'Back-off',
  drop: 'Drop set',
};

/** Set-type badges (design-system §7); working sets have none. */
export const SET_TYPE_BADGE: Record<SetType, string | null> = {
  warmup: 'W',
  working: null,
  top: 'T',
  backoff: 'B',
  drop: 'D',
};

export const EQUIPMENT_WORD: Record<EquipmentInstance['kind'], string> = {
  barbell: 'Barbell',
  dumbbells: 'Dumbbells',
  weight_stack: 'Cable / stack',
  assisted_stack: 'Assisted machine',
  plate_loaded_machine: 'Plate-loaded machine',
  bodyweight_station: 'Bodyweight',
  kettlebell: 'Kettlebells',
  ez_bar: 'EZ bar',
  trap_bar: 'Trap bar',
  smith_machine: 'Smith machine',
  bench: 'Bench',
  rack: 'Rack',
};
