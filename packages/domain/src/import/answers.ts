import type { BodyweightAnswer, GroupTotalAnswer, ImportAnswers, ImportBarKind, NameAnswer, PerHandAnswer, PerHandReading, TotalAnswer, WeightUnit } from '@fizz/schemas';

/**
 * One change to the import answers (data-import-export §2.5 steps 3a–3c).
 * Pure. Each change bumps the preview's `mappingVersion` in the service; a
 * commit against an older version is refused (rule 5).
 */
export type AnswerChange =
  | { kind: 'name'; key: string; answer: NameAnswer | null }
  | { kind: 'per_hand'; answer: PerHandAnswer }
  /** One exercise's reading (`one` / `each` / `both`); null goes back to the default (review r3 S1). */
  | { kind: 'per_hand_override'; key: string; answer: PerHandReading | null }
  /** The barbell group answer: only "Total as written". No group answer adds a bar weight (PM decision after review r7). */
  | { kind: 'total'; answer: GroupTotalAnswer }
  /** One exercise: total as written, or plates only (its bar's weight added); null goes back to the group answer. */
  | { kind: 'total_override'; key: string; answer: TotalAnswer | null }
  /** The bar one exercise's "plates only" adds; null goes back to the matched exercise's own bar. Only for an exercise answered "plates only" (review r8 S2). */
  | { kind: 'total_bar'; key: string; bar: ImportBarKind | null }
  /** A bar's weight for `plates_only` values (each bar kind has its own; review S1). */
  | { kind: 'bar_weight'; bar: ImportBarKind; unit: WeightUnit; value: number }
  /** null clears it: the question is open again (a re-mapped name whose question changed meaning; review r6.2 N4). */
  | { kind: 'bodyweight'; key: string; answer: BodyweightAnswer | null }
  | { kind: 'both_columns'; answer: WeightUnit }
  | { kind: 'effort_mode'; mode: 'notes_only' | 'review' }
  | { kind: 'effort_rows'; rows: readonly number[]; checked: boolean }
  | { kind: 'existing_dates'; answer: 'skip' | 'import' }
  | { kind: 'gym'; gymId: string | null }
  /** Values to check (AI13): one exercise in one workout, or every open one (`Import all as written`); null clears it. */
  | { kind: 'value_check'; key: string; answer: 'import' | 'skip' | null }
  | { kind: 'value_checks_all'; keys: readonly string[] };

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) if (k !== key) out[k] = v;
  return out;
}

function setOrClear<T>(record: Readonly<Record<string, T>>, key: string, value: T | null): Record<string, T> {
  return value === null ? without(record, key) : { ...record, [key]: value };
}

export function applyAnswerChange(a: ImportAnswers, c: AnswerChange): ImportAnswers {
  switch (c.kind) {
    case 'name':
      return { ...a, names: setOrClear(a.names, c.key, c.answer) };
    case 'per_hand':
      return { ...a, perHand: c.answer };
    case 'per_hand_override':
      return { ...a, perHandOverrides: setOrClear(a.perHandOverrides, c.key, c.answer) };
    case 'total':
      return { ...a, total: c.answer };
    case 'total_override':
      // A bar is only ever chosen for "plates only": any other answer drops it, so it can't change the exercise `Add new` makes or be remembered (review r8 S2).
      return { ...a, totalOverrides: setOrClear(a.totalOverrides, c.key, c.answer), totalBars: c.answer === 'plates_only' ? (a.totalBars ?? {}) : without(a.totalBars ?? {}, c.key) };
    case 'total_bar':
      return { ...a, totalBars: setOrClear(a.totalBars ?? {}, c.key, c.bar) };
    case 'bar_weight':
      return c.bar === 'barbell'
        ? { ...a, barWeight: { ...a.barWeight, [c.unit]: c.value } }
        : { ...a, otherBarWeight: { ...a.otherBarWeight, [c.bar]: { ...a.otherBarWeight[c.bar], [c.unit]: c.value } } };
    case 'bodyweight':
      return { ...a, bodyweight: setOrClear(a.bodyweight, c.key, c.answer) };
    case 'both_columns':
      return { ...a, bothColumns: c.answer };
    case 'effort_mode':
      return { ...a, effort: { ...a.effort, mode: c.mode } };
    case 'effort_rows': {
      const rows = new Set(a.effort.rows);
      for (const r of c.rows) {
        if (c.checked) rows.add(r);
        else rows.delete(r);
      }
      return { ...a, effort: { ...a.effort, rows: [...rows].sort((x, y) => x - y) } };
    }
    case 'existing_dates':
      return { ...a, existingDates: c.answer };
    case 'gym':
      return { ...a, gymId: c.gymId };
    case 'value_check':
      return { ...a, valueChecks: setOrClear(a.valueChecks ?? {}, c.key, c.answer) };
    case 'value_checks_all': {
      const next = { ...(a.valueChecks ?? {}) };
      for (const k of c.keys) next[k] ??= 'import';
      return { ...a, valueChecks: next };
    }
  }
}
