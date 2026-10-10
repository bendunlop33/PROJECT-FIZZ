import type {
  AdjustPendingSetsArgs,
  CoachTarget,
  EquipmentInstance,
  ExerciseTargetChanges,
  GuardNote,
  GuardNoteKind,
  Load,
  PainArea,
  PainFlag,
  RepRange,
  SessionAggregate,
  SessionExercise,
  SetTargetChange,
  WorkoutSet,
} from '@fizz/schemas';
import { formatNumber, loadText } from '../display';
import { compareDifficulty, loadDirection, roundToAvailableLoad, type RoundingPolicy } from '../equipment';
import { buildExecutionOrder } from '../session/order';
import { deriveId } from '../stable';
import { convertMass } from '../units';
import type { PainMention } from './pain-words';

/**
 * `validateTodayAdjustment` (ADR 0020 §4, coach-adjustments §2.6): the
 * deterministic guardrail between the coach's `adjust_pending_sets` call and
 * today's pending sets. Pure. The model can't override any of it:
 * - the call must be for the session version it read (rule 5);
 * - only pending sets change; done, skipped and deleted sets never do (rule 2);
 * - every load is snapped to what the session's equipment can make, capped at
 *   its max, in its own unit and convention, never extrapolated (rule 4);
 * - increases are dropped on pain-flagged movements, everywhere when the
 *   check-in said pain without a movement, in a lighter session, and when
 *   Ben's own message in this turn mentions pain or possible pain, before any
 *   flag exists or he has answered "Sore or pain?" (rule 9, review r5 B4).
 * Guard notes are app text; the model never writes them.
 */

/** Why the coach was asked. Sets the snapping direction (coach-adjustments §2.6 `Snapped`). */
export type AdjustIntent = 'too_hard' | 'too_easy' | 'lighter_session' | 'general';

export interface TodayAdjustmentInput {
  aggregate: SessionAggregate;
  args: AdjustPendingSetsArgs;
  intent: AdjustIntent;
  /** The tool call's operation ID; derives the ID of an added set so a replay adds the same row. */
  opId: string;
  painFlags: readonly PainFlag[];
  /** The session's check-in said `Pain` with no movement chosen (check-in CI8). */
  sessionPainUnspecified: boolean;
  /** For the cap note (`the most Main Gym's rack goes to`); null reads `this rack`. */
  gymName: string | null;
  /**
   * What Ben's own words in this turn said about pain (`classifyPainMention`
   * and `painBodyPart` on his message). Rule 9 says a pain *mention* stops
   * progression, not only a saved flag: "Way too easy, but my knee hurts"
   * must not let the coach raise anything before it flags (review r5 B4).
   * Null when the turn has no words from Ben (a chip or an accepted offer).
   */
  messagePain: MessagePain | null;
}

export interface MessagePain {
  mention: PainMention;
  /**
   * Catalogue exercise IDs Ben named in the same message. Empty means none
   * was named, so increases stop on every movement this turn.
   */
  exerciseIds: readonly string[];
  /** The body part he named ("knee"), for the note; null when none. */
  bodyPart: string | null;
}

export interface AddedSetPlan {
  /** Deterministic from the opId, so a replayed call creates the same row. */
  setId: string;
  setNumber: number;
  /** The live set the new one copies its type and rest from. */
  copyFromSetId: string;
  after: CoachTarget;
}

export interface ExerciseAdjustmentPlan extends ExerciseTargetChanges {
  added: AddedSetPlan | null;
  removed: { setId: string; setNumber: number; before: CoachTarget } | null;
}

export type TodayAdjustmentResult =
  | {
      status: 'apply';
      exercises: ExerciseAdjustmentPlan[];
      guardNotes: GuardNote[];
      /** Every set ID whose version the apply must check. */
      touchedSetIds: string[];
    }
  /** Nothing to apply; `outcome` is the app's line for the coach slot (no Undo). */
  | { status: 'unchanged'; outcome: string; guardNotes: GuardNote[] }
  | { status: 'stale'; outcome: string; guardNotes: GuardNote[] };

const STALE_OUTCOME = 'Your workout moved on before the coach answered. Nothing changed.';

const live = (s: WorkoutSet): boolean => s.status !== 'deleted';

function liveSetsInOrder(state: SessionAggregate, sessionExerciseId: string): WorkoutSet[] {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  return state.sets
    .filter((s) => s.sessionExerciseId === sessionExerciseId && live(s))
    .sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6));
}

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
}

function policyFor(intent: AdjustIntent): RoundingPolicy {
  switch (intent) {
    case 'too_hard':
    case 'lighter_session':
      return 'easier';
    case 'too_easy':
      return 'harder';
    case 'general':
      return 'nearest';
  }
}

/** `sets 3–4`, `set 4`, `sets 2, 4`. */
export function setNumbersText(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return 'sets';
  if (sorted.length === 1) return `set ${String(sorted[0])}`;
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? 0;
  const contiguous = last - first === sorted.length - 1;
  return contiguous ? `sets ${String(first)}–${String(last)}` : `sets ${sorted.join(', ')}`;
}

function snapWhere(eq: EquipmentInstance): string {
  switch (eq.kind) {
    case 'barbell':
      return 'nearest your bar and plates allow';
    case 'plate_loaded_machine':
      return 'nearest your plates allow';
    case 'dumbbells':
      return 'nearest your dumbbell rack allows';
    case 'weight_stack':
      return 'nearest the stack allows';
    case 'assisted_stack':
      return 'nearest the assistance stack allows';
    case 'bodyweight_station':
      return 'nearest the equipment allows';
  }
}

function equipmentNoun(eq: EquipmentInstance): string {
  switch (eq.kind) {
    case 'barbell':
      return 'bar';
    case 'plate_loaded_machine':
      return 'machine';
    case 'dumbbells':
      return 'rack';
    case 'weight_stack':
    case 'assisted_stack':
      return 'stack';
    case 'bodyweight_station':
      return 'station';
  }
}

type LoadOutcome =
  | { ok: true; load: Load; note: { kind: GuardNoteKind; text: string } | null; extra: { kind: GuardNoteKind; text: string } | null }
  | { ok: false; note: { kind: GuardNoteKind; text: string } };

export function snapLoad(requested: Load, ex: SessionExercise, eq: EquipmentInstance | null, policy: RoundingPolicy, gymName: string | null): LoadOutcome {
  const asked = loadText(requested, requested.convention);
  if (ex.loadConvention === 'bodyweight') {
    if (requested.convention === 'bodyweight') return { ok: true, load: requested, note: null, extra: null };
    return { ok: false, note: { kind: 'convention_mismatch', text: `Couldn't use the coach's load: ${ex.exerciseName} is bodyweight. Load unchanged.` } };
  }
  if (requested.convention !== ex.loadConvention) {
    return {
      ok: false,
      note: { kind: 'convention_mismatch', text: `Couldn't use the coach's load: ${asked} doesn't match how ${ex.exerciseName} is loaded. Load unchanged.` },
    };
  }
  if (eq === null) {
    return { ok: false, note: { kind: 'no_equipment', text: `Couldn't check the coach's load for ${ex.exerciseName}: no equipment is set. Load unchanged.` } };
  }
  const r = roundToAvailableLoad(requested, eq, policy);
  if (!r.ok) {
    return { ok: false, note: { kind: 'no_achievable_load', text: `Couldn't use the coach's load: ${asked} isn't possible on this ${equipmentNoun(eq)}. Load unchanged.` } };
  }
  const direction = loadDirection(eq.loadConvention);
  const requestedInUnit = r.convertedRequest?.value ?? requested.value;
  const harderThanAsked = compareDifficulty(r.load.value, requestedInUnit, direction) > 0;
  const easierThanAsked = compareDifficulty(r.load.value, requestedInUnit, direction) < 0;
  // "Too hard" never rounds to something harder than the coach asked for (§2.6).
  if (policy === 'easier' && harderThanAsked) {
    return { ok: false, note: { kind: 'no_achievable_load', text: `Couldn't use the coach's load: ${asked} isn't possible on this ${equipmentNoun(eq)}. Load unchanged.` } };
  }
  const got = loadText(r.load, r.load.convention, eq);
  const extra =
    r.convertedRequest === null
      ? null
      : { kind: 'converted' as const, text: `The coach gave ${asked}; this ${equipmentNoun(eq)} is in ${eq.unit}, so it was converted.` };
  if (r.exact) return { ok: true, load: r.load, note: null, extra };
  if (r.bounded !== null && easierThanAsked) {
    const where = gymName === null ? `this ${equipmentNoun(eq)}` : `${gymName}'s ${equipmentNoun(eq)}`;
    const most = direction === 'resistance' ? 'the most' : 'the least assistance';
    return { ok: true, load: r.load, note: { kind: 'capped', text: `Capped at ${got}: ${most} ${where} goes to.` }, extra };
  }
  return { ok: true, load: r.load, note: { kind: 'snapped', text: `Rounded to ${got}: ${snapWhere(eq)}.` }, extra };
}

export function validReps(r: RepRange): boolean {
  return r.min >= 1 && r.max <= 100 && r.min <= r.max;
}

/** Positive when `after` asks for more than `before` (load by difficulty, or either end of the rep range). */
export function isIncrease(before: CoachTarget | null, after: CoachTarget, convention: SessionExercise['loadConvention']): boolean {
  const b = before ?? { load: null, reps: null };
  if (after.load !== null && after.load.convention !== 'bodyweight') {
    if (b.load === null) return true;
    const prev = b.load.unit === after.load.unit ? b.load.value : convertMass(b.load, after.load.unit).value;
    if (compareDifficulty(after.load.value, prev, loadDirection(convention)) > 0) return true;
  }
  if (after.reps !== null) {
    if (b.reps === null) return true;
    if (after.reps.min > b.reps.min || after.reps.max > b.reps.max) return true;
  }
  return false;
}

export function sameTarget(a: CoachTarget | null, b: CoachTarget): boolean {
  const x = a ?? { load: null, reps: null };
  const loadSame =
    (x.load === null && b.load === null) ||
    (x.load !== null && b.load !== null && x.load.unit === b.load.unit && x.load.convention === b.load.convention && formatNumber(x.load.value) === formatNumber(b.load.value));
  const repsSame = (x.reps === null && b.reps === null) || (x.reps !== null && b.reps !== null && x.reps.min === b.reps.min && x.reps.max === b.reps.max);
  return loadSame && repsSame;
}

function targetOf(set: WorkoutSet): CoachTarget {
  return { load: set.planned.load, reps: set.planned.reps };
}

export const AREA_WORD: Record<PainArea, string> = {
  shoulder: 'shoulder', elbow: 'elbow', wrist: 'wrist', neck: 'neck', back: 'back', hip: 'hip', knee: 'knee', ankle: 'ankle', other: '',
};

export function activeFlag(flags: readonly PainFlag[], exerciseId: string): PainFlag | null {
  return flags.find((f) => f.exerciseId === exerciseId && f.status === 'active') ?? null;
}

/**
 * Review r5 B4: pain or possible pain in Ben's message this turn blocks
 * increases on the movements he named, or on every movement when he named
 * none. `unclear` ("sore", "tight", "knee feels off") counts: CM6 asks
 * "Sore or pain?" first, and nothing goes up until he has answered.
 */
function messagePainBlock(m: MessagePain | null, ex: SessionExercise): { kind: GuardNoteKind; text: string; outcome: string } | null {
  if (m === null || (m.mention !== 'pain' && m.mention !== 'unclear')) return null;
  const what = m.bodyPart === null ? 'pain' : `your ${m.bodyPart}`;
  if (m.exerciseIds.length === 0) {
    return { kind: 'pain_unspecified', text: `Not increasing anything: you mentioned ${what}.`, outcome: `Not increasing anything: you mentioned ${what}. Sets unchanged.` };
  }
  if (!m.exerciseIds.includes(ex.exerciseId)) return null;
  return { kind: 'pain_blocked', text: `Not increasing ${ex.exerciseName}: you mentioned ${what}.`, outcome: `Not increasing ${ex.exerciseName}: you mentioned ${what}. Sets unchanged.` };
}

class Notes {
  private readonly byKey = new Map<string, GuardNote>();
  add(kind: GuardNoteKind, text: string, setIds: readonly string[]): void {
    const key = `${kind}|${text}`;
    const hit = this.byKey.get(key);
    if (hit) {
      for (const id of setIds) if (!hit.setIds.includes(id)) hit.setIds.push(id);
    } else {
      this.byKey.set(key, { kind, text, setIds: [...setIds] });
    }
  }
  list(): GuardNote[] {
    return [...this.byKey.values()];
  }
}

export function validateTodayAdjustment(input: TodayAdjustmentInput): TodayAdjustmentResult {
  const { aggregate: state, args } = input;
  const notes = new Notes();
  if (state.session.status !== 'active' || state.session.version !== args.baseVersion) {
    return { status: 'stale', outcome: STALE_OUTCOME, guardNotes: [] };
  }
  const policy = policyFor(input.intent);
  const plans: ExerciseAdjustmentPlan[] = [];
  const touched: string[] = [];
  const blockedOutcomes: string[] = [];
  let anyRequested = false;
  const requestedNumbers: number[] = [];
  const seenExercises = new Set<string>();

  for (const req of args.exercises) {
    const ex = state.exercises.find((e) => e.id === req.sessionExerciseId);
    if (!ex || seenExercises.has(req.sessionExerciseId)) {
      notes.add('unknown_target', 'Not changed: the coach named an exercise that isn’t in this workout.', []);
      continue;
    }
    seenExercises.add(ex.id);
    const sets = liveSetsInOrder(state, ex.id);
    const numberOf = (setId: string): number => sets.findIndex((s) => s.id === setId) + 1;
    const eq = equipmentOf(state, ex);
    const flag = activeFlag(input.painFlags, ex.exerciseId);
    const area = flag?.area ? AREA_WORD[flag.area] : '';
    const painPart = flag === null ? null : area ? `Not increasing ${ex.exerciseName}: you flagged ${area} pain.` : `Not increasing ${ex.exerciseName}: you flagged pain on it.`;
    const painAll = flag === null ? null : area ? `Not increasing: you flagged ${area} pain. Sets unchanged.` : `Not increasing: you flagged pain on ${ex.exerciseName}. Sets unchanged.`;
    const said = messagePainBlock(input.messagePain, ex);

    /** Null when increases are allowed; otherwise the guard note kind and texts. */
    const increaseBlock: { kind: GuardNoteKind; text: string; outcome: string } | null =
      painPart !== null && painAll !== null
        ? { kind: 'pain_blocked', text: painPart, outcome: painAll }
        : said !== null
          ? said
          : input.sessionPainUnspecified
          ? { kind: 'pain_unspecified', text: 'Not increasing anything today: you mentioned pain.', outcome: 'Not increasing anything today: you mentioned pain. Sets unchanged.' }
          : input.intent === 'lighter_session'
            ? { kind: 'lighter_no_increase', text: 'No increases in a lighter session.', outcome: 'No increases in a lighter session. Sets unchanged.' }
            : null;

    const changes: SetTargetChange[] = [];
    const removeId = req.removeSetId;
    const seenSets = new Set<string>();

    /** Resolve one requested target against the set's current target. Null = drop. */
    const resolve = (before: CoachTarget | null, ask: CoachTarget, setIds: string[]): CoachTarget | null => {
      let load = before?.load ?? null;
      // Snap notes only count when the change is kept.
      const pending: { kind: GuardNoteKind; text: string }[] = [];
      if (ask.load !== null) {
        const snapped = snapLoad(ask.load, ex, eq, policy, input.gymName);
        if (!snapped.ok) {
          notes.add(snapped.note.kind, snapped.note.text, setIds);
          blockedOutcomes.push(snapped.note.text.replace('Load unchanged.', 'Sets unchanged.'));
          return null;
        }
        if (snapped.note) pending.push(snapped.note);
        if (snapped.extra) pending.push(snapped.extra);
        load = snapped.load;
      }
      let reps = before?.reps ?? null;
      if (ask.reps !== null) {
        if (!validReps(ask.reps)) {
          notes.add('invalid_reps', `Not changed: ${String(ask.reps.min)}–${String(ask.reps.max)} reps isn't a usable target.`, setIds);
          return null;
        }
        reps = ask.reps;
      }
      const after: CoachTarget = { load, reps };
      if (increaseBlock !== null && isIncrease(before, after, ex.loadConvention)) {
        // Keep the part that isn't an increase (review S1): "100 × 6–8 → 95 × 8" under a pain flag keeps the
        // lighter load and the planned reps, rather than losing the lighter load too.
        const loadOnly: CoachTarget = { load, reps: before?.reps ?? null };
        const repsOnly: CoachTarget = { load: before?.load ?? null, reps };
        const keepLoad = !sameTarget(before, loadOnly) && !isIncrease(before, loadOnly, ex.loadConvention);
        const keepReps = !sameTarget(before, repsOnly) && !isIncrease(before, repsOnly, ex.loadConvention);
        if (!keepLoad && !keepReps) {
          notes.add(increaseBlock.kind, increaseBlock.text, setIds);
          blockedOutcomes.push(increaseBlock.outcome);
          return null;
        }
        const partial: CoachTarget = { load: keepLoad ? load : (before?.load ?? null), reps: keepReps ? reps : (before?.reps ?? null) };
        notes.add(increaseBlock.kind, `${increaseBlock.text} ${keepLoad ? 'Reps stay as planned.' : 'Load stays as planned.'}`, setIds);
        if (keepLoad) for (const n of pending) notes.add(n.kind, n.text, setIds);
        return partial;
      }
      if (!sameTarget(before, after)) for (const n of pending) notes.add(n.kind, n.text, setIds);
      return after;
    };

    for (const change of req.sets) {
      anyRequested = true;
      const set = state.sets.find((s) => s.id === change.setId);
      if (!set || set.sessionExerciseId !== ex.id || seenSets.has(set.id)) {
        notes.add('unknown_target', 'Not changed: the coach named a set that isn’t in this exercise.', []);
        continue;
      }
      seenSets.add(set.id);
      const n = numberOf(set.id);
      requestedNumbers.push(n);
      if (set.status === 'completed') {
        notes.add('completed_set_dropped', `Not changed: set ${String(n)} is already done.`, [set.id]);
        continue;
      }
      if (set.status !== 'pending') {
        notes.add('not_pending', `Not changed: set ${String(n > 0 ? n : set.index + 1)} isn't pending.`, [set.id]);
        continue;
      }
      if (set.id === removeId) continue;
      const before = targetOf(set);
      const after = resolve(before, change.target, [set.id]);
      if (after === null || sameTarget(before, after)) continue;
      changes.push({ setId: set.id, setNumber: n, before, after });
      touched.push(set.id);
    }

    let removed: ExerciseAdjustmentPlan['removed'] = null;
    if (removeId !== null) {
      anyRequested = true;
      const set = state.sets.find((s) => s.id === removeId);
      if (!set || set.sessionExerciseId !== ex.id) {
        notes.add('unknown_target', 'Not changed: the coach named a set that isn’t in this exercise.', []);
      } else if (set.status === 'completed') {
        notes.add('completed_set_dropped', `Not changed: set ${String(numberOf(set.id))} is already done.`, [set.id]);
      } else if (set.status !== 'pending') {
        const n = numberOf(set.id);
        notes.add('not_pending', `Not changed: set ${String(n > 0 ? n : set.index + 1)} isn't pending.`, [set.id]);
      } else {
        removed = { setId: set.id, setNumber: numberOf(set.id), before: targetOf(set) };
        touched.push(set.id);
      }
    }

    let added: AddedSetPlan | null = null;
    if (req.addSet !== null) {
      anyRequested = true;
      const template = [...sets].reverse().find((s) => s.setType !== 'warmup') ?? sets[sets.length - 1];
      if (template === undefined) {
        notes.add('unknown_target', `Not added: ${ex.exerciseName} has no set to copy.`, []);
      } else {
        const blocked = increaseBlock;
        if (blocked !== null) {
          notes.add(blocked.kind, blocked.text, []);
          blockedOutcomes.push(blocked.outcome);
        } else {
          const after = resolve(targetOf(template), req.addSet, []);
          if (after !== null) {
            const liveCount = sets.length - (removed === null ? 0 : 1);
            added = {
              setId: deriveId(`coach-add-set:${input.opId}:${ex.id}`),
              setNumber: liveCount + 1,
              copyFromSetId: template.id,
              after,
            };
            touched.push(template.id);
          }
        }
      }
    }

    if (changes.length > 0 || added !== null || removed !== null) {
      const recordChanges: SetTargetChange[] = [...changes];
      if (removed !== null) recordChanges.push({ setId: removed.setId, setNumber: removed.setNumber, before: removed.before, after: null });
      if (added !== null) recordChanges.push({ setId: added.setId, setNumber: added.setNumber, before: null, after: added.after });
      plans.push({ sessionExerciseId: ex.id, exerciseName: ex.exerciseName, changes: recordChanges, added, removed });
    }
  }

  const guardNotes = notes.list();
  if (plans.length > 0) return { status: 'apply', exercises: plans, guardNotes, touchedSetIds: [...new Set(touched)] };
  const firstBlocked = blockedOutcomes[0];
  if (firstBlocked !== undefined) return { status: 'unchanged', outcome: firstBlocked, guardNotes };
  const firstNote = guardNotes[0];
  if (firstNote !== undefined) return { status: 'unchanged', outcome: `${firstNote.text} Nothing changed.`, guardNotes };
  if (!anyRequested || requestedNumbers.length === 0) return { status: 'unchanged', outcome: 'Coach kept your sets as planned.', guardNotes };
  return { status: 'unchanged', outcome: `Coach kept ${setNumbersText(requestedNumbers)} as planned.`, guardNotes };
}
