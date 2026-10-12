import type { Routine, RoutineExercise, SessionAggregate, SetTemplate, ZonedTimestamp } from '@fizz/schemas';
import { formatDuration, NBSP, repRangeText } from '../display';
import { deriveId } from '../stable';
import { editableExercises, editRoutine } from './library';
import type { RoutineChange } from './routines';
import type { ResolvedEdits } from './today-edits';
import { shapeOfTemplates, type ShapeBefore } from './today-shape';

/**
 * `Update Push A ›` (overview-today-edits §11.5, TE15): today's edits as one
 * change-review card, and Apply as one versioned routine write. Pure.
 *
 * Only Ben's own today edits that make sense for the template are listed:
 * swaps, added exercises, set counts, reps, the order, and skips (as
 * `Removed`, unchecked by default: a skip is often "machine taken").
 * Loads typed for today are never listed (they stay today's, TE-B8). Apply
 * goes through the editor's own `editRoutine` (validation, supersets, Main,
 * structure times, version and opId), so there is one way to change a
 * workout. Swapped and added exercises get `Auto` loads, never converted
 * from another exercise (rule 4).
 */

export type TemplateLineKind = 'swap' | 'add' | 'sets' | 'reps' | 'order' | 'remove';

export interface TemplateLine {
  /** Stable per card: `swap:<slotKey>`, `order`. */
  key: string;
  kind: TemplateLineKind;
  /** `Changed`, `Added`, `Sets`, `Reps`, `Order`, `Removed`. */
  label: string;
  /** `Bench press`, `Face pull · 3 × 12–15`, `Incline DB press 3 → 4`. */
  text: string;
  /** A swap's second line: `→ DB bench press`. */
  detail: string | null;
  /** Checked when the card opens (TE15: skips start unchecked). */
  checked: boolean;
  /** The draft edits Apply makes redundant (the template then matches). */
  editIds: string[];
  /** VoiceOver: `Changed, Bench press to DB bench press`. */
  accessibilityLabel: string;
}

const LABEL: Record<TemplateLineKind, string> = { swap: 'Changed', add: 'Added', sets: 'Sets', reps: 'Reps', order: 'Order', remove: 'Removed' };

/** Each slot's working sets and reps as today's plan shows them (warm-ups aside). */
export function todayShapes(aggregate: Pick<SessionAggregate, 'exercises' | 'sets'>, slotOf: Readonly<Record<string, string>>): Record<string, ShapeBefore> {
  const out: Record<string, ShapeBefore> = {};
  for (const ex of aggregate.exercises) {
    const key = slotOf[ex.id] ?? ex.id;
    const sets = aggregate.sets
      .filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted' && s.pairedWithSetId === null && s.setType !== 'warmup')
      .sort((a, b) => a.index - b.index);
    const first = sets[0];
    out[key] = { workingSets: sets.length, reps: first?.planned.reps ?? null, durationS: first?.planned.durationS ?? null };
  }
  return out;
}

const amountText = (s: Pick<ShapeBefore, 'reps' | 'durationS'>): string => (s.reps !== null ? repRangeText(s.reps) : s.durationS !== null ? formatDuration(s.durationS) : '—');
const sameAmount = (a: Pick<ShapeBefore, 'reps' | 'durationS'>, b: Pick<ShapeBefore, 'reps' | 'durationS'>): boolean =>
  a.durationS === b.durationS && (a.reps === null || b.reps === null ? a.reps === b.reps : a.reps.min === b.reps.min && a.reps.max === b.reps.max);

export interface TemplateLinesInput {
  routine: Routine;
  resolved: ResolvedEdits;
  /** Today's shapes (`todayShapes` of the overview's dry run). */
  today: Readonly<Record<string, ShapeBefore>>;
  nameOf: (exerciseId: string) => string;
}

/** `templateLinesFromEdits` (§11.9): the card's lines, in the spec's order, with their default checks. */
export function templateLinesFromEdits(input: TemplateLinesInput): TemplateLine[] {
  const { routine, resolved, today, nameOf } = input;
  const bySlot = new Map(editableExercises(routine).map((e) => [e.id, e]));
  const lines: TemplateLine[] = [];
  const line = (kind: TemplateLineKind, key: string, text: string, detail: string | null, editIds: string[], spoken: string): void => {
    lines.push({ key, kind, label: LABEL[kind], text, detail, checked: kind !== 'remove', editIds, accessibilityLabel: `${LABEL[kind]}, ${spoken}` });
  };
  const nowName = (slotKey: string): string => {
    const sw = resolved.swaps.get(slotKey);
    if (sw !== undefined) return nameOf(sw.toExerciseId);
    const add = resolved.added.get(slotKey);
    if (add !== undefined) return nameOf(add.exerciseId);
    const rex = bySlot.get(slotKey);
    return rex === undefined ? 'Exercise' : nameOf(rex.exerciseId);
  };
  for (const [slotKey, sw] of resolved.swaps) {
    const rex = bySlot.get(slotKey);
    if (rex === undefined) continue;
    const from = nameOf(rex.exerciseId);
    const to = nameOf(sw.toExerciseId);
    line('swap', `swap:${slotKey}`, from, `→${NBSP}${to}`, [sw.editId], `${from} to ${to}`);
  }
  for (const [slotKey, add] of resolved.added) {
    const shape = today[slotKey];
    const name = nameOf(add.exerciseId);
    const what = shape === undefined ? '' : ` · ${String(shape.workingSets)}${NBSP}×${NBSP}${amountText(shape)}`;
    // The added exercise's sets and reps go into the template with it.
    const with_ = [add.editId, ...[resolved.sets.get(slotKey)?.editId, resolved.reps.get(slotKey)?.editId].filter((x): x is string => x !== undefined)];
    line('add', `add:${slotKey}`, `${name}${what}`, null, with_, `${name}${what.replace(` · `, ', ').replaceAll(NBSP, ' ')}`);
  }
  for (const [slotKey, e] of resolved.sets) {
    const rex = bySlot.get(slotKey);
    const now = today[slotKey];
    if (rex === undefined || now === undefined) continue;
    const was = shapeOfTemplates(rex.setTemplates).workingSets;
    if (was === now.workingSets) continue;
    // The workout's own exercise: the line changes the slot whether or not its `Changed` line is ticked (review N2).
    const name = nameOf(rex.exerciseId);
    line('sets', `sets:${slotKey}`, `${name} ${String(was)}${NBSP}→${NBSP}${String(now.workingSets)}`, null, [e.editId], `${name}, ${String(was)} to ${String(now.workingSets)} sets`);
  }
  for (const [slotKey, e] of resolved.reps) {
    const rex = bySlot.get(slotKey);
    const now = today[slotKey];
    if (rex === undefined || now === undefined) continue;
    const was = shapeOfTemplates(rex.setTemplates);
    if (sameAmount(was, now)) continue;
    const name = nameOf(rex.exerciseId);
    line('reps', `reps:${slotKey}`, `${name} ${amountText(was)}${NBSP}→${NBSP}${amountText(now)}`, null, [e.editId], `${name}, ${amountText(was)} to ${amountText(now)}`.replaceAll('–', ' to '));
  }
  if (resolved.order !== null && resolved.orderEditId !== null) {
    const planned = [...routine.exercises].sort((a, b) => a.order - b.order).map((e) => e.id);
    const first = resolved.order[0];
    const text = first !== undefined && first !== planned[0] ? `${nowName(first)} first` : 'New order';
    line('order', 'order', text, null, [resolved.orderEditId], text);
  }
  for (const [slotKey, editId] of resolved.skipped) {
    if (!bySlot.has(slotKey)) continue;
    const name = nowName(slotKey);
    line('remove', `remove:${slotKey}`, name, null, [editId], name);
  }
  return lines;
}

export interface ApplyTodayEditsInput {
  current: Routine;
  /** The card's checked lines (Ben's ticks). */
  lines: readonly TemplateLine[];
  resolved: ResolvedEdits;
  today: Readonly<Record<string, ShapeBefore>>;
  expectedVersion: number;
  opId: string;
  at: ZonedTimestamp;
  isCompound: (exerciseId: string) => boolean;
}

/** A slot's working sets at a count: more copy the last working set (as Auto), fewer drop from the end; warm-ups stay. */
function withWorkingCount(templates: readonly SetTemplate[], count: number, newId: () => string): SetTemplate[] {
  const working = templates.filter((t) => t.setType !== 'warmup');
  const last = working[working.length - 1];
  if (last === undefined || count === working.length) return [...templates];
  if (count > working.length) {
    const at = templates.indexOf(last) + 1;
    const extra = Array.from({ length: count - working.length }, () => ({ ...last, id: newId(), targetLoad: null }));
    return [...templates.slice(0, at), ...extra, ...templates.slice(at)];
  }
  const drop = new Set(working.slice(Math.max(1, count)).map((t) => t.id));
  return templates.filter((t) => !drop.has(t.id));
}

/**
 * `applyEditsToRoutine` (§11.9): the workout with the checked lines, as the
 * editor's `editRoutine` writes it (the next version; a retried opId is a
 * duplicate; an older version is stale and writes nothing, rule 5).
 */
export function applyEditsToRoutine(input: ApplyTodayEditsInput): RoutineChange {
  const { current, resolved, today, at, opId } = input;
  let n = 0;
  const newId = (): string => deriveId(`update-routine-template:${opId}:${String((n += 1))}`);
  const checked = new Set(input.lines.map((l) => l.key));
  let exercises: RoutineExercise[] = editableExercises(current);
  for (const [slotKey, sw] of resolved.swaps) {
    if (!checked.has(`swap:${slotKey}`)) continue;
    exercises = exercises.map((e) => (e.id === slotKey ? { ...e, exerciseId: sw.toExerciseId, equipmentId: null, progressionRuleId: null, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: null })) } : e));
  }
  for (const [slotKey] of resolved.skipped) if (checked.has(`remove:${slotKey}`)) exercises = exercises.filter((e) => e.id !== slotKey);
  for (const [slotKey, add] of resolved.added) {
    const shape = today[slotKey];
    if (!checked.has(`add:${slotKey}`) || shape === undefined || shape.workingSets < 1) continue;
    exercises.push({
      id: slotKey,
      exerciseId: add.exerciseId,
      equipmentId: null,
      order: exercises.length,
      supersetGroup: null,
      setTemplates: Array.from({ length: shape.workingSets }, () => ({ id: newId(), setType: 'working' as const, targetLoad: null, targetReps: shape.reps, targetDurationS: shape.reps === null ? shape.durationS : null, targetRpe: null, targetRir: null, restOverrideS: null })),
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
    });
  }
  for (const [slotKey] of resolved.sets) {
    const shape = today[slotKey];
    if (!checked.has(`sets:${slotKey}`) || shape === undefined) continue;
    exercises = exercises.map((e) => (e.id === slotKey ? { ...e, setTemplates: withWorkingCount(e.setTemplates, shape.workingSets, newId) } : e));
  }
  for (const [slotKey] of resolved.reps) {
    const shape = today[slotKey];
    if (!checked.has(`reps:${slotKey}`) || shape === undefined) continue;
    exercises = exercises.map((e) =>
      e.id === slotKey ? { ...e, setTemplates: e.setTemplates.map((t) => (t.setType === 'warmup' ? t : { ...t, targetReps: shape.reps, targetDurationS: shape.reps === null ? shape.durationS : null })) } : e,
    );
  }
  if (checked.has('order') && resolved.order !== null) {
    const rank = new Map(resolved.order.map((k, i) => [k, i]));
    exercises = exercises.map((e, i) => ({ e, i })).sort((a, b) => (rank.get(a.e.id) ?? resolved.order?.length ?? 0) - (rank.get(b.e.id) ?? resolved.order?.length ?? 0) || a.i - b.i).map((x) => x.e);
  }
  return editRoutine(current, { name: current.name, exercises }, input.expectedVersion, opId, at, input.isCompound);
}
