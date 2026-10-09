import type { BodyweightAnswer, ImportAnswers, NameAnswer, PerHandAnswer, TotalAnswer, WeightUnit } from '@fizz/schemas';

/**
 * One change to the import answers (data-import-export §2.5 steps 3a–3c).
 * Pure. Each change bumps the preview's `mappingVersion` in the service; a
 * commit against an older version is refused (rule 5).
 */
export type AnswerChange =
  | { kind: 'name'; key: string; answer: NameAnswer | null }
  | { kind: 'per_hand'; answer: PerHandAnswer }
  | { kind: 'per_hand_override'; key: string; answer: PerHandAnswer | null }
  | { kind: 'total'; answer: TotalAnswer }
  | { kind: 'total_override'; key: string; answer: TotalAnswer | null }
  | { kind: 'bar_weight'; unit: WeightUnit; value: number }
  | { kind: 'bodyweight'; key: string; answer: BodyweightAnswer }
  | { kind: 'both_columns'; answer: WeightUnit }
  | { kind: 'effort_mode'; mode: 'notes_only' | 'review' }
  | { kind: 'effort_rows'; rows: readonly number[]; checked: boolean }
  | { kind: 'existing_dates'; answer: 'skip' | 'import' }
  | { kind: 'gym'; gymId: string | null };

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
      return { ...a, totalOverrides: setOrClear(a.totalOverrides, c.key, c.answer) };
    case 'bar_weight':
      return { ...a, barWeight: { ...a.barWeight, [c.unit]: c.value } };
    case 'bodyweight':
      return { ...a, bodyweight: { ...a.bodyweight, [c.key]: c.answer } };
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
  }
}
