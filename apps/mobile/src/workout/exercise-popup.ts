import { canAddWarmupNow, clampBuilderRest, midSwapSlot, roundSteps, sessionRounds, setMoveSteps, supersetNextCommand, type RestKind, type TargetExplanation } from '@fizz/domain';
import { BUILD_LIMITS, type SessionAggregate, type SetType, type WorkoutSet } from '@fizz/schemas';

import { loadSpoken, loadText, POPUP_COPY, REST_STEP_S, restText, SET_TYPE_LABEL, type PopupRestRow, type PopupSetRow, type PopupView } from '../ui/exercise-popup-model';
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
  const rows = p.exercise.rows.flatMap((r, i): PopupSetRow[] => {
    const set = byId.get(r.setId);
    if (set === undefined || set.status === 'deleted' || set.status === 'skipped') return [];
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
    return [
      {
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
      },
    ];
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
  done: 'Nothing left to warm up for',
  not_found: 'Not in this workout',
  notLoadable: 'Not at this gym',
  lighter: 'Lighter than this gym can load',
  noTarget: 'Warm-ups have no target effort',
  changed: 'The workout changed. Try again.',
} as const;
