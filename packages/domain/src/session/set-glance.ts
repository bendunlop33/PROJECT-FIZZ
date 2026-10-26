import type { SessionAggregate, SetType, WorkoutSet } from '@fizz/schemas';
import { formatNumber, NBSP, SET_TYPE_WORD, targetShort, valuesText, effortRir, rirOfRpe, rirWords } from '../display';
import { targetRpeOf } from '../coach/target-rpe';
import { DEFAULT_COACH_TRIGGER_THRESHOLDS, evaluateCoachTrigger } from '../coach/trigger';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets } from './gym-switch';
import { shownPlannedIn, showsBensValuesIn, type CarryOptions } from './carry';
import { buildExecutionOrder } from './order';
import { latestCommittedSetId } from './reducer';

/**
 * One set at a glance (F7, F8; Ben, build 151): what the rest screen's `Last
 * set` and `Next` blocks and the Focus view's set pager show. A done set
 * reads its actual result, a set not done yet its target (`@RPE 8` when it
 * has a target effort). Pure; the screen formats nothing.
 */
export interface SetGlance {
  setId: string;
  setVersion: number;
  sessionExerciseId: string;
  exerciseName: string;
  /** Its place among the exercise's live sets (warm-ups included), and how many there are. */
  setNumber: number;
  setCount: number;
  setType: SetType;
  /** `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop set`. */
  setTypeLabel: string;
  status: 'done' | 'pending' | 'skipped';
  /** The set Log logs now. */
  isCurrent: boolean;
  /** Done: `100 kg × 8` (effort apart). Not done: `100 kg × 6–8 @RPE 8`. Skipped: `Skipped`. */
  value: string;
  /** Done only: the effort Ben logged. */
  effort: { rpe: number | null; rir: number | null } | null;
  accessibilityLabel: string;
}

const TARGET_WORD = /^(Coach target|Target)\s/;

function statusOf(set: WorkoutSet): SetGlance['status'] | null {
  if (set.status === 'completed') return 'done';
  if (set.status === 'pending') return 'pending';
  if (set.status === 'skipped') return 'skipped';
  return null;
}

/**
 * `ruleTargetRpe`: the built-in rule's target RPE per session exercise (`ruleTargetRpes`), the default shown.
 * `carry.painFlagged`: movements with an active pain flag (no heavier load carries from the last set).
 */
export function setGlance(state: SessionAggregate, setId: string, ruleTargetRpe: Readonly<Record<string, number>> = {}, carry: CarryOptions = {}): SetGlance | null {
  const set = state.sets.find((s) => s.id === setId);
  if (!set) return null;
  const status = statusOf(set);
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (status === null || !ex) return null;
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  const own = blockSets(state, ex.id);
  const setNumber = own.findIndex((s) => s.id === set.id) + 1;
  let value: string;
  let effort: SetGlance['effort'] = null;
  let ownValues = false;
  if (status === 'done' && set.actual) {
    value = valuesText(set.actual, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq });
    effort = { rpe: set.actual.rpe, rir: set.actual.rir };
  } else if (status === 'skipped') {
    value = 'Skipped';
  } else {
    // Ben's own draft values over the target, as the table shows them (B2, 21 Oct).
    // A load carried from his last logged set is his too (21 Oct).
    ownValues = showsBensValuesIn(state, set, ex, carry);
    const target = targetShort({ ...shownPlannedIn(state, set, ex, carry), source: undefined }, { convention: ex.loadConvention, ...(eq ? { equipment: eq } : {}) });
    const rpe = targetRpeOf(set, ruleTargetRpe[ex.id] ?? null);
    const base = target === null ? 'No target' : target.replace(TARGET_WORD, '');
    value = rpe === null ? base : `${base} · RIR${NBSP}${formatNumber(rirOfRpe(rpe.rpe))}`;
  }
  const isCurrent = state.session.activeSetId === set.id;
  const typeLabel = SET_TYPE_WORD[set.setType];
  const plain = value.replaceAll(NBSP, ' ');
  const loggedRir = effort === null ? null : effortRir(effort);
  const effortWords = loggedRir === null ? '' : `, ${rirWords(loggedRir)}`;
  const stateWord = status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : isCurrent ? (ownValues ? 'current, your edit' : 'current, target') : ownValues ? 'your edit' : 'target';
  return {
    setId: set.id,
    setVersion: set.version,
    sessionExerciseId: ex.id,
    exerciseName: ex.exerciseName,
    setNumber,
    setCount: own.length,
    setType: set.setType,
    setTypeLabel: typeLabel,
    status,
    isCurrent,
    value,
    effort,
    accessibilityLabel: `${ex.exerciseName}, set ${String(setNumber)} of ${String(own.length)}, ${typeLabel}, ${stateWord} ${plain}${effortWords}`,
  };
}

/**
 * The rest screen's two halves under the timer (F8): the set just done
 * (`Last set`, compact, editable, with its effort) and the next set Log
 * will log (prominent). Either is null when there's none.
 */
export function restSetsView(state: SessionAggregate, ruleTargetRpe: Readonly<Record<string, number>> = {}, carry: CarryOptions = {}): { last: SetGlance | null; next: SetGlance | null } {
  const lastId = latestCommittedSetId(state);
  const nextId = state.session.activeSetId;
  return {
    last: lastId === null ? null : setGlance(state, lastId, ruleTargetRpe, carry),
    next: nextId === null ? null : setGlance(state, nextId, ruleTargetRpe, carry),
  };
}

export interface SetNavigation {
  /** The set shown: the viewed one, else the current one; null when the workout has no set. */
  shownSetId: string | null;
  /** True when the set shown is the one Log logs (viewing another never changes that). */
  atCurrent: boolean;
  prevSetId: string | null;
  nextSetId: string | null;
  /** 1-based place in the whole workout's order, and the count. */
  position: number;
  total: number;
  /** Where `Now` jumps back to (null when every set is done). */
  currentSetId: string | null;
}

/**
 * Prev / next across the whole workout (F7): every live set in the order
 * it's done (done, skipped and pending; supersets by round). Viewing is a
 * screen state only: it never changes the active set, so Log keeps logging
 * the current one until Ben taps `Make current`. A viewed set that's gone
 * (deleted) falls back to the current one.
 */
export function setNavigation(state: SessionAggregate, viewingSetId: string | null): SetNavigation {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const current = state.session.activeSetId;
  const fallback = current ?? order.at(-1) ?? null;
  const shown = viewingSetId !== null && order.includes(viewingSetId) ? viewingSetId : fallback;
  const at = shown === null ? -1 : order.indexOf(shown);
  return {
    shownSetId: shown,
    atCurrent: shown !== null && shown === current,
    prevSetId: at > 0 ? (order[at - 1] ?? null) : null,
    nextSetId: at >= 0 && at < order.length - 1 ? (order[at + 1] ?? null) : null,
    position: at + 1,
    total: order.length,
    currentSetId: current,
  };
}

/**
 * What the workout's coach chips are about (14 Oct): the current exercise
 * (else the one last logged), and whether the set just logged was off its
 * target (`evaluateCoachTrigger`: much harder, short on reps, or much easier),
 * so `Adjust the rest?` leads. Off-target only counts while sets are left.
 */
export function workoutChatContext(state: SessionAggregate, ruleTargetRpe: Readonly<Record<string, number>> = {}): { exerciseName: string | null; offTarget: boolean } {
  const lastId = latestCommittedSetId(state);
  const active = state.sets.find((s) => s.id === state.session.activeSetId);
  const last = lastId === null ? undefined : state.sets.find((s) => s.id === lastId);
  const exOf = (s: WorkoutSet | undefined) => (s === undefined ? undefined : state.exercises.find((e) => e.id === s.sessionExerciseId));
  const ex = exOf(active) ?? exOf(last);
  let offTarget = false;
  const lastEx = exOf(last);
  if (last !== undefined && lastEx !== undefined && state.sets.some((s) => s.status === 'pending')) {
    const n = blockSets(state, lastEx.id).findIndex((s) => s.id === last.id) + 1;
    offTarget = evaluateCoachTrigger(last, n, DEFAULT_COACH_TRIGGER_THRESHOLDS, targetRpeOf(last, ruleTargetRpe[lastEx.id] ?? null)?.rpe ?? null, { deload: state.session.deload !== undefined }) !== null;
  }
  return { exerciseName: ex?.exerciseName ?? null, offTarget };
}
