import type { WeightUnit } from '@fizz/schemas';
import { nameKey } from '../match';
import { workoutKeyOf, type SourceSetRow } from '../source-row';

/**
 * Values to check (AI13, §9.2.6), the soft half: an exercise's heaviest
 * working set in a workout that is more than double, or under half, its
 * heaviest in the previous workout in the file that has it (same unit) is a
 * question, with nothing selected: `Import as written` / `Skip`. A jump of
 * about 2.2× is the usual sign of a kg/lb mix-up. Pure. The hard limits
 * (`HARD_LIMITS`) are applied when rows are read.
 */

export interface ValueCheck {
  /** `${workoutKey}|${nameKey}`: the answer's key. */
  key: string;
  workoutKey: string;
  date: string;
  name: string;
  nameKey: string;
  /** The heaviest working set, as written. */
  value: number;
  reps: number;
  unit: WeightUnit;
  before: { value: number; reps: number; date: string };
  /** Sets of the exercise in that workout (what `Skip` skips). */
  sets: number;
}

export function valueCheckKey(workoutKey: string, key: string): string {
  return `${workoutKey}|${key}`;
}

interface Top {
  value: number;
  reps: number;
  unit: WeightUnit;
  date: string;
  sets: number;
  name: string;
}

/** The checks for rows that would be imported (strength rows not skipped), in file-date order. */
export function valueChecksOf(rows: readonly SourceSetRow[]): ValueCheck[] {
  const tops = new Map<string, Map<string, Top>>();
  const order: string[] = [];
  for (const r of rows) {
    if (r.rowClass !== 'strength' || r.date === null || r.reps === null) continue;
    const wk = workoutKeyOf(r);
    if (wk === null) continue;
    const key = nameKey(r.exercise);
    let byName = tops.get(wk);
    if (!byName) {
      byName = new Map();
      tops.set(wk, byName);
      order.push(wk);
    }
    const t = byName.get(key) ?? { value: 0, reps: 0, unit: 'kg' as WeightUnit, date: r.date, sets: 0, name: r.exercise };
    t.sets += 1;
    const w = r.weight;
    if (r.setType !== 'warmup' && w !== null && w.value > 0 && w.value > t.value) {
      t.value = w.value;
      t.reps = r.reps;
      t.unit = w.unit;
    }
    byName.set(key, t);
  }
  // Workouts in date order (then key), so "previous" is the previous workout in time.
  const dateOf = (wk: string): string => [...(tops.get(wk)?.values() ?? [])][0]?.date ?? '';
  order.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const last = new Map<string, Top>();
  const out: ValueCheck[] = [];
  for (const wk of order) {
    for (const [key, t] of tops.get(wk) ?? []) {
      if (t.value <= 0) continue;
      const prev = last.get(`${key}|${t.unit}`);
      if (prev && (t.value > prev.value * 2 || t.value < prev.value / 2)) {
        out.push({ key: valueCheckKey(wk, key), workoutKey: wk, date: t.date, name: t.name, nameKey: key, value: t.value, reps: t.reps, unit: t.unit, before: { value: prev.value, reps: prev.reps, date: prev.date }, sets: t.sets });
        // A flagged value isn't what the next workout is compared with: one slip doesn't flag the workout after it.
        continue;
      }
      last.set(`${key}|${t.unit}`, t);
    }
  }
  return out;
}
