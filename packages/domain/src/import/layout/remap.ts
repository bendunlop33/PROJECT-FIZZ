import type { ColumnRef, ImportMappingSpecV1, LayoutAnswers, NotationAnswer, LayoutRole } from '@fizz/schemas';

/**
 * A saved layout on a file whose columns were added or removed (Changed
 * columns, §9.2.7, check 56). Pure. Every column the layout reads is moved
 * to its index in the new header by its exact name; a removed optional
 * column (RPE, notes, set type, which workout) is dropped; a removed column
 * the layout needs (date, exercise, load, reps, set cells) makes it a new
 * layout (null). New columns get no role: each is asked, offline.
 */

export interface RemappedLayout {
  spec: ImportMappingSpecV1;
  answers: LayoutAnswers;
  /** Columns new in this file (by index): asked, nothing selected. */
  added: number[];
  /** Header cells of the layout that this file doesn't have (`"RPE" isn't in this file.`). */
  missing: string[];
}

export function remapLayout(spec: ImportMappingSpecV1, answers: LayoutAnswers, oldHeader: readonly string[], newHeader: readonly string[]): RemappedLayout | null {
  if (new Set(newHeader).size !== newHeader.length || new Set(oldHeader).size !== oldHeader.length) return null;
  const at = (ref: ColumnRef): ColumnRef | null => {
    const i = newHeader.indexOf(ref.header);
    return i === -1 ? null : { header: ref.header, index: i };
  };
  const need = (ref: ColumnRef): ColumnRef => {
    const r = at(ref);
    if (r === null) throw new Missing();
    return r;
  };
  const some = (refs: readonly ColumnRef[]): ColumnRef[] => refs.flatMap((r) => at(r) ?? []);
  class Missing extends Error {}
  let out: ImportMappingSpecV1;
  try {
    const layout: ImportMappingSpecV1['layout'] =
      spec.layout.kind === 'row_per_set'
        ? { kind: 'row_per_set', setOrder: spec.layout.setOrder === null ? null : at(spec.layout.setOrder) }
        : spec.layout.kind === 'row_per_exercise_packed'
          ? { kind: 'row_per_exercise_packed', sets: need(spec.layout.sets), notation: spec.layout.notation }
          : { kind: 'wide_set_columns', setColumns: spec.layout.setColumns.map(need), notation: spec.layout.notation };
    const load: ImportMappingSpecV1['load'] =
      spec.load === null
        ? null
        : {
            column: need(spec.load.column),
            unit:
              spec.load.unit.kind === 'header_token'
                ? { ...spec.load.unit, column: need(spec.load.unit.column) }
                : spec.load.unit.kind === 'unit_column'
                  ? { kind: 'unit_column', column: need(spec.load.unit.column) }
                  : spec.load.unit,
          };
    const setTypeCol = spec.setType === null ? null : at(spec.setType.column);
    out = {
      ...spec,
      layout,
      workoutKey: some(spec.workoutKey),
      date: { column: need(spec.date.column), format: spec.date.format },
      exercise: need(spec.exercise),
      load,
      reps: spec.reps === null ? null : need(spec.reps),
      setType: spec.setType === null || setTypeCol === null ? null : { column: setTypeCol, values: spec.setType.values },
      rpe: spec.rpe === null ? null : at(spec.rpe),
      notes: some(spec.notes),
      unmapped: some(spec.unmapped),
      // The self-check was the coach's reading of the old file; it isn't checked again.
      selfCheck: spec.selfCheck,
    };
  } catch (e) {
    if (e instanceof Missing) return null;
    throw e;
  }
  const moveKeys = <T>(record: Readonly<Record<string, T>>, keepRole?: (v: T) => boolean): Record<string, T> => {
    const next: Record<string, T> = {};
    for (const [k, v] of Object.entries(record)) {
      const h = oldHeader[Number(k)];
      const i = h === undefined ? -1 : newHeader.indexOf(h);
      if (i !== -1 && (keepRole?.(v) ?? true)) next[String(i)] = v;
    }
    return next;
  };
  const roles: Record<string, LayoutRole> = moveKeys(answers.roles);
  // A column Ben gave a role the layout needs (date, exercise, load, reps, set cells) must still be there; an optional one (RPE, notes) is dropped.
  const NEEDED: readonly LayoutRole[] = ['date', 'start_time', 'exercise', 'load', 'reps', 'sets_reps', 'one_set', 'all_sets'];
  for (const [k, role] of Object.entries(answers.roles)) {
    const h = oldHeader[Number(k)];
    if (h !== undefined && !newHeader.includes(h) && NEEDED.includes(role)) return null;
  }
  const notation: Record<string, NotationAnswer> = moveKeys(answers.notation);
  return {
    spec: out,
    answers: { ...answers, roles, notation },
    added: newHeader.flatMap((h, i) => (oldHeader.includes(h) ? [] : [i])),
    missing: oldHeader.filter((h) => !newHeader.includes(h)),
  };
}
