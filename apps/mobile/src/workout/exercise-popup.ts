import { canAddWarmupNow, canRemoveExercise, clampBuilderRest, midSwapSlot, removeExerciseCommand, roundSteps, sessionRounds, setMoveSteps, snapTypedLoadEasier, supersetNextCommand, typeRestCommand, type RestKind, type TargetExplanation } from '@fizz/domain';
import { BUILD_LIMITS, type CommandOf, type Load, type SessionAggregate, type SetType, type SetValues, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';

import { loadSpoken, loadText, POPUP_COPY, REST_STEP_S, restText, SET_TYPE_LABEL, SET_TYPES, type PopupRestRow, type PopupSetRow, type PopupView } from '../ui/exercise-popup-model';
import type { RoundExercise } from './rounds';

/**
 * The exercise pop-up on the active workout (workout-table-v3 §7: the
 * builder's pop-up, same component): one session row as the shared
 * `PopupView`. Pure. Numbers, marks and target RPE come from the round page
 * (`buildRounds`, so the pop-up and the table agree) and the stored sets;
 * what can move, pair, warm up or swap comes from the domain's rules
 * (`roundSteps`, `supersetNextCommand`, `canAddWarmupNow`, `midSwapSlot`).
 * Done sets show what was logged; editing one is a correction (rule 2).
 */

const NBSP = ' ';
const plain = (s: string): string => s.replaceAll(NBSP, ' ');
const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** The RPE cell's number: `@9` → 9 (a target), `8` → 8 (logged); `RIR 2` and blanks → null. */
export function rpeNumber(text: string | null): number | null {
  if (text === null) return null;
  const m = /^@?\s*(\d+(?:\.\d+)?)$/.exec(plain(text).trim());
  return m === null ? null : Number(m[1]);
}

/** Rest rows by the set type they follow, in the builder's order; a superset has one: `After each round`. */
const REST_ROWS: readonly { type: SetType; label: string; kind: RestKind }[] = [
  { type: 'warmup', label: 'Warm-ups', kind: 'warmup' },
  { type: 'top', label: 'Top set', kind: 'top' },
  { type: 'backoff', label: 'Back-offs', kind: 'backoff' },
  { type: 'working', label: 'Working sets', kind: 'working' },
  { type: 'drop', label: 'Drop sets', kind: 'drop' },
];

function restRow(kind: string, limitKind: RestKind | 'round', label: string, seconds: number): PopupRestRow {
  return { kind, label, seconds, text: restText(seconds), canMinus: clampBuilderRest(limitKind, seconds - REST_STEP_S) < seconds, canPlus: clampBuilderRest(limitKind, seconds + REST_STEP_S) > seconds };
}

export interface SessionPopupInput {
  aggregate: SessionAggregate;
  /** The exercise as the round page shows it (its rows, numbers and target RPE). */
  exercise: RoundExercise;
  works: string | null;
  mayHurt: boolean;
}

export function sessionPopupView(p: SessionPopupInput): PopupView | null {
  const a = p.aggregate;
  const ex = a.exercises.find((e) => e.id === p.exercise.sessionExerciseId && e.removed === undefined);
  if (ex === undefined) return null;
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const reps = ex.measurement === 'reps';
  // Skipped and deleted sets aren't rows: drop them first, so `index` is the row's place in `rows` (review B1).
  const shown = p.exercise.rows.flatMap((r) => {
    const set = byId.get(r.setId);
    return set === undefined || set.status === 'deleted' || set.status === 'skipped' ? [] : [{ r, set }];
  });
  const rows = shown.map(({ r, set }, i): PopupSetRow => {
    const done = set.status === 'completed';
    const values = done ? set.actual : null;
    const loadOf = done ? (values?.load ?? null) : set.planned.load;
    const load = loadOf === null || loadOf.convention === 'bodyweight' ? null : loadOf.value;
    const range = set.planned.reps;
    const repsValue = !reps ? null : done ? (values?.reps ?? null) : range === null ? null : range.min;
    const repsText = !reps ? plain(r.row.cells.value) : done ? (repsValue === null ? '' : String(repsValue)) : range === null ? '' : range.min === range.max ? String(range.min) : `${String(range.min)}–${String(range.max)}`;
    const rpe = rpeNumber(r.rpe);
    const steps = setMoveSteps(a, set.id);
    const typeText = SET_TYPE_LABEL[set.setType];
    const spokenName = r.stepName;
    const loadWords = loadSpoken(load, ex.unit, loadOf?.convention ?? ex.loadConvention);
    return {
        key: set.id,
        index: i,
        mark: r.label,
        type: set.setType,
        typeText,
        reps: repsValue,
        repsText,
        kgText: loadText(load, ex.unit, loadOf?.convention ?? ex.loadConvention, ex.unit),
        load,
        rpeText: rpe === null ? '–' : trim(rpe),
        rpe,
        done,
        editable: reps,
        noRpe: set.setType === 'warmup' || (!done && set.setType === 'drop'),
        canDelete: true,
        canMoveUp: steps.up,
        canMoveDown: steps.down,
        draggable: !done && (steps.up || steps.down),
        accessibilityLabel: [spokenName, typeText, reps ? `${repsText} reps` : repsText, loadWords, rpe === null ? null : done ? `RPE ${trim(rpe)}` : `target RPE ${trim(rpe)}`, done ? 'done' : 'not done'].filter((x): x is string => x !== null && x !== '').join(', '),
        spokenName,
      };
  });
  const rounds = sessionRounds(a);
  const round = rounds.find((r) => r.members.some((m) => m.id === ex.id));
  const pendingOf = (id: string): WorkoutSet[] => a.sets.filter((s) => s.sessionExerciseId === id && s.status === 'pending').sort((x, y) => x.index - y.index);
  const pending = pendingOf(ex.id);
  let rests: PopupRestRow[];
  if (round !== undefined && round.members.length > 1) {
    const last = round.members.at(-1);
    const first = last === undefined ? undefined : pendingOf(last.id)[0];
    rests = first === undefined ? [] : [restRow('round', 'round', 'After each round', first.rest.seconds)];
  } else {
    rests = REST_ROWS.flatMap((x) => {
      const first = pending.find((s) => s.setType === x.type);
      return first === undefined ? [] : [restRow(x.type, x.kind, x.label, first.rest.seconds)];
    });
  }
  const moves = roundSteps(a, ex.id);
  const working = a.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted' && s.setType !== 'warmup').length;
  const probe = { opId: 'probe', at: a.session.startedAt };
  const suffix = ex.loadConvention === 'per_hand' ? ' each' : ex.loadConvention === 'assistance' ? ' assist' : '';
  return {
    name: ex.exerciseName,
    works: p.works,
    kgHeader: `${ex.unit === 'kg' ? 'Kg' : 'Lb'}${suffix}`,
    rows,
    canAddWarmup: canAddWarmupNow(a, ex.id),
    canAddSet: working > 0 && working < BUILD_LIMITS.maxWorkingSets,
    rests,
    canMoveUp: moves.up,
    canMoveDown: moves.down,
    canSupersetNext: supersetNextCommand(a, ex.id, probe) !== null,
    canUnlink: ex.supersetGroup !== null,
    mayHurt: p.mayHurt,
    canSwap: midSwapSlot(a, ex.id) !== null,
    deleteLabel: POPUP_COPY.remove,
    canDeleteExercise: canRemoveExercise(a, ex.id),
  };
}

/** `Why this weight?` lines from the stored target's provenance (`explainTarget`); `Not recorded` when there's none, never a guess (rule 6). */
export function whyWeightLines(exp: TargetExplanation | null): string[] {
  if (exp === null) return [];
  if (!exp.recorded && exp.rows.length === 0) return ['Not recorded'];
  const lines = exp.rows.flatMap((r) => r.lines.map((l, i) => plain(r.label !== null && i === 0 ? `${r.label}: ${l}` : l)));
  return exp.basisEdited === null ? lines : [...lines, plain(exp.basisEdited)];
}

/** The pop-up's refusal lines (shortest honest words; minimal copy). */
export const POPUP_REFUSAL = {
  max_warmups: 'At most 4 warm-ups',
  no_load: 'No load to warm up to',
  no_gap: 'No room for another warm-up',
  superset: 'No warm-ups in a superset',
  done: 'Nothing left to warm up for',
  not_found: 'Not in this workout',
  notLoadable: 'Not at this gym',
  lighter: 'Lighter than this gym can load',
  /** An assisted machine: easier is more assistance, and it has a most (N2). */
  moreAssist: 'More assistance than this machine gives',
  noTarget: 'Warm-ups have no target effort',
  changed: 'The workout changed. Try again.',
} as const;

/** A pop-up cell edit as the workout's own write: a logged set's correction (rule 2), a pending set's new target, or why not. */
export type PopupCellWrite =
  | { kind: 'correct'; setId: string; expectedSetVersion: number; patch: Partial<SetValues> }
  | { kind: 'planned'; setId: string; expectedSetVersion: number; patch: { reps?: { min: number; max: number }; load?: Load; targetRpe?: number }; note: string | null }
  | { kind: 'refused'; text: string };

/**
 * What a typed value in the pop-up sends (§7). Logged: the value Ben did, corrected as typed (no
 * rounding: it's what happened). Not done yet: the target; a kg rounds toward easier on the row's
 * item (rule 4; `Rounded to 97.5 kg` when it moved), never past its max; reps are exact; a warm-up
 * has no target effort.
 */
export function popupCellWrite(a: SessionAggregate, setId: string, field: 'reps' | 'kg' | 'rpe', value: number, bodyweightExercises?: ReadonlySet<string>): PopupCellWrite {
  const set = a.sets.find((s) => s.id === setId);
  const ex = set === undefined ? undefined : a.exercises.find((e) => e.id === set.sessionExerciseId);
  if (set === undefined || ex === undefined || set.status === 'deleted' || set.status === 'skipped') return { kind: 'refused', text: POPUP_REFUSAL.changed };
  if (field === 'reps' && (!Number.isInteger(value) || value < 1 || value > 100)) return { kind: 'refused', text: 'Reps 1–100' };
  if (field === 'rpe' && (value < 1 || value > 10 || Math.round(value * 2) !== value * 2)) return { kind: 'refused', text: 'RPE 1–10' };
  if (field === 'kg' && (value < 0 || ex.loadConvention === 'bodyweight')) return { kind: 'refused', text: POPUP_REFUSAL.notLoadable };
  if (set.status === 'completed') {
    const load = set.actual?.load ?? null;
    if (field === 'kg') return { kind: 'correct', setId, expectedSetVersion: set.version, patch: { load: { value, unit: load?.unit ?? ex.unit, convention: load?.convention ?? ex.loadConvention } } };
    return { kind: 'correct', setId, expectedSetVersion: set.version, patch: field === 'reps' ? { reps: value } : { rpe: value, rir: null } };
  }
  if (field === 'reps') return { kind: 'planned', setId, expectedSetVersion: set.version, patch: { reps: { min: value, max: value } }, note: null };
  if (field === 'rpe') {
    if (set.setType === 'warmup' || set.setType === 'drop') return { kind: 'refused', text: POPUP_REFUSAL.noTarget };
    return { kind: 'planned', setId, expectedSetVersion: set.version, patch: { targetRpe: value }, note: null };
  }
  const snapped = snapTypedLoadEasier(a, setId, value, bodyweightExercises);
  if (snapped === undefined || snapped === null) return { kind: 'refused', text: ex.loadConvention === 'assistance' ? POPUP_REFUSAL.moreAssist : POPUP_REFUSAL.lighter };
  const note = Math.abs(snapped - value) < 1e-9 ? null : `Rounded to ${trim(snapped)} ${ex.unit}`;
  return { kind: 'planned', setId, expectedSetVersion: set.version, patch: { load: { value: snapped, unit: ex.unit, convention: ex.loadConvention } }, note };
}

/** A rest row's step (15 s, within the builder's limits) as `set_rest_after`; null when it wouldn't change. */
export function popupRestCommand(a: SessionAggregate, sessionExerciseId: string, rest: Pick<PopupRestRow, 'kind' | 'seconds'>, dir: 1 | -1, op: { opId: string; at: ZonedTimestamp }): CommandOf<'set_rest_after'> | null {
  const type = rest.kind === 'round' ? 'round' : SET_TYPES.find((t) => t === rest.kind);
  if (type === undefined) return null;
  const limit = type === 'round' ? 'round' : (REST_ROWS.find((x) => x.type === type)?.kind ?? 'working');
  const seconds = clampBuilderRest(limit, rest.seconds + dir * REST_STEP_S);
  if (seconds === rest.seconds) return null;
  return typeRestCommand(a, sessionExerciseId, type, seconds, op);
}

/**
 * `Remove` (§7) worked out once, when Ben taps it (review B2/S3): the exact command the confirmation
 * sends, with the opId, version and logged count he was shown. With logged sets he is asked first
 * (`Keeps N logged sets`); a confirmation sent after the workout moved on is refused as stale (rule 5).
 * Null: nothing to remove.
 */
export type RemovePrompt = { kind: 'now'; command: CommandOf<'remove_exercise'>; name: string } | { kind: 'ask'; command: CommandOf<'remove_exercise'>; name: string; title: string; message: string };

export function removePrompt(a: SessionAggregate, sessionExerciseId: string, op: { opId: string; at: ZonedTimestamp }): RemovePrompt | null {
  const ex = a.exercises.find((e) => e.id === sessionExerciseId && e.removed === undefined);
  if (ex === undefined || !canRemoveExercise(a, ex.id)) return null;
  const { command, loggedSets } = removeExerciseCommand(a, ex.id, op);
  if (loggedSets === 0) return { kind: 'now', command, name: ex.exerciseName };
  return { kind: 'ask', command, name: ex.exerciseName, title: `Remove ${ex.exerciseName}?`, message: `Keeps ${String(loggedSets)} logged ${loggedSets === 1 ? 'set' : 'sets'}` };
}

export type ExerciseAction = 'swap' | 'move_up' | 'move_down' | 'superset_next' | 'unlink' | 'remove';

/**
 * An exercise header's VoiceOver actions on the round page (v3 §6–§7), the same as its `⋯` and the
 * pop-up: Swap (while it has sets to do), Move up / Move down (rounds not started), Superset with
 * next, Unlink, Remove.
 */
export function exerciseActions(a: SessionAggregate, sessionExerciseId: string): { name: ExerciseAction; label: string }[] {
  const ex = a.exercises.find((e) => e.id === sessionExerciseId && e.removed === undefined);
  if (ex === undefined) return [];
  const moves = roundSteps(a, ex.id);
  const probe = { opId: 'probe', at: a.session.startedAt };
  return [
    ...(midSwapSlot(a, ex.id) !== null ? [{ name: 'swap' as const, label: POPUP_COPY.swapExercise }] : []),
    ...(moves.up ? [{ name: 'move_up' as const, label: POPUP_COPY.moveUp }] : []),
    ...(moves.down ? [{ name: 'move_down' as const, label: POPUP_COPY.moveDown }] : []),
    ...(supersetNextCommand(a, ex.id, probe) !== null ? [{ name: 'superset_next' as const, label: POPUP_COPY.supersetNext }] : []),
    ...(ex.supersetGroup !== null ? [{ name: 'unlink' as const, label: POPUP_COPY.unlink }] : []),
    ...(canRemoveExercise(a, ex.id) ? [{ name: 'remove' as const, label: removeExerciseCommand(a, ex.id, probe).loggedSets > 0 ? 'Remove (keeps logged sets)' : POPUP_COPY.remove }] : []),
  ];
}
