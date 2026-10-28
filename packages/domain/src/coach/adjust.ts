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
import { boundWords, convertedWords } from '../session/fit-words';
import { buildExecutionOrder } from '../session/order';
import { currentGymEquipment, equipmentOfRow } from '../session/equipment-snapshot';
import { isWeightedBodyweight, loadCheckEquipment, rowMarkedBodyweight } from '../added-weight';
import { deriveId } from '../stable';
import { convertMass } from '../units';
import type { PainMention } from './pain-words';
import { targetRpeOf } from './target-rpe';

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
  /**
   * The built-in rule's target RPE per session exercise (`ruleTargetRpes`):
   * the fallback of each set's resolved target RPE (`targetRpeOf`), so a
   * raise above a built-in or RIR target counts as an increase (review
   * target-rpe S1). Omitted: only stored RPE/RIR targets count.
   */
  ruleTargetRpe?: Readonly<Record<string, number>> | undefined;
  /**
   * ADR 0038: weights Ben named in his own words this turn (`namedWeights`). A target load equal to one
   * is his, used as typed (`snapLoad` `asTyped`); the coach's other loads on that exercise in the same
   * call (its ramp-up) are snapped quietly and never go above his heaviest one.
   */
  benLoads?: readonly BenLoad[] | undefined;
  /**
   * ADR 0038: more new sets per session exercise, each with its own target (the `sets` op of
   * `edit_today`: "build up to 95 as the last set"). Checked like `addSet`, in order, after it.
   */
  addTargets?: Readonly<Record<string, readonly CoachTarget[]>> | undefined;
}

/** A weight Ben typed or said this turn; `unit` null when he gave none ("use 30 for curls"). */
export interface BenLoad {
  value: number;
  unit: Load['unit'] | null;
}

/** Is this load one Ben named himself (the same number, in his unit when he gave one)? */
export function isBenLoad(load: Load, benLoads: readonly BenLoad[] | undefined): boolean {
  return (benLoads ?? []).some((b) => Math.abs(b.value - load.value) < 1e-6 && (b.unit === null || b.unit === load.unit));
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
  /** ADR 0038: more new sets with their own targets (`addTargets`), after `added`. */
  addedMore?: AddedSetPlan[];
  removed: { setId: string; setNumber: number; before: CoachTarget } | null;
}

export type TodayAdjustmentResult =
  | {
      status: 'apply';
      exercises: ExerciseAdjustmentPlan[];
      guardNotes: GuardNote[];
      /** Every set ID whose version the apply must check. */
      touchedSetIds: string[];
      /** ADR 0038: set IDs (changed or added) whose load is a weight Ben named, kept as typed (`loadAsTyped`). */
      asTypedSetIds?: string[];
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
  // The row's own entry (after a gym switch the snapshot holds more than one gym's items).
  return equipmentOfRow(state.session.equipmentSnapshot, ex);
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

function equipmentNoun(eq: EquipmentInstance): string {
  switch (eq.kind) {
    case 'barbell':
    case 'ez_bar':
    case 'trap_bar':
      return 'bar';
    case 'plate_loaded_machine':
    case 'smith_machine':
      return 'machine';
    case 'dumbbells':
    case 'kettlebell':
      return 'rack';
    case 'weight_stack':
    case 'assisted_stack':
      return 'stack';
    case 'bodyweight_station':
    case 'bench':
    case 'rack':
      return 'station';
  }
}

type LoadOutcome =
  | { ok: true; load: Load; note: { kind: GuardNoteKind; text: string } | null; extra: { kind: GuardNoteKind; text: string } | null }
  | { ok: false; note: { kind: GuardNoteKind; text: string } };

/**
 * `weighted`: a bodyweight exercise with weight held or worn; `eq` is then the
 * gym's dumbbells and plates (`loadCheckEquipment`), not one item.
 *
 * ADR 0038 (Ben, 28 Oct: "It gets very caught up in whether I have equipment"):
 * - `asTyped`: a weight Ben named himself is used exactly as he typed it (no
 *   rounding to the rack), only kept inside what the item can physically do
 *   (never past a machine's max, rule 4), with one short line when it was.
 * - No equipment row (FitNotes imports, unknown kit): the load is kept as
 *   given, never refused.
 * - A load labelled with another convention is read in the exercise's own
 *   (the tool asks for the exercise's convention; a wrong label is the model's slip).
 */
export function snapLoad(requested: Load, ex: SessionExercise, eq: EquipmentInstance | null, policy: RoundingPolicy, weighted = false, opts: { asTyped?: boolean; lenient?: boolean } = {}): LoadOutcome {
  const where = (e: EquipmentInstance): string => (weighted ? 'with the weights here' : `on this ${equipmentNoun(e)}`);
  if (ex.loadConvention === 'bodyweight') {
    if (requested.convention === 'bodyweight') return { ok: true, load: requested, note: null, extra: null };
    return { ok: false, note: { kind: 'convention_mismatch', text: `${ex.exerciseName} is bodyweight.` } };
  }
  // `lenient` (today's sets, ADR 0038): the exercise's own convention, never a refusal over a label; no item to fit
  // it to, or an item loaded another way: kept as given. Otherwise (next session's targets) both are refused.
  if (opts.lenient !== true && requested.convention !== ex.loadConvention) {
    return { ok: false, note: { kind: 'convention_mismatch', text: `${loadText(requested, requested.convention)} doesn't match how ${ex.exerciseName} is loaded.` } };
  }
  if (opts.lenient !== true && eq === null) return { ok: false, note: { kind: 'no_equipment', text: `No equipment set for ${ex.exerciseName}.` } };
  const own: Load = requested.convention === ex.loadConvention ? requested : { ...requested, convention: ex.loadConvention };
  if (eq === null || own.convention !== eq.loadConvention) return { ok: true, load: own, note: null, extra: null };
  const asked = loadText(own, own.convention);
  const target = own;
  if (opts.asTyped === true) {
    const inUnit = target.unit === eq.unit ? target : { value: Math.round(convertMass(target, eq.unit).value * 100) / 100, unit: eq.unit, convention: target.convention };
    const r = roundToAvailableLoad(target, eq, 'nearest');
    if (r.ok && r.bounded !== null) {
      const got = loadText(r.load, r.load.convention, eq);
      const text = r.bounded === 'max' ? boundWords('max', got, loadDirection(eq.loadConvention) !== 'resistance') : boundWords('min', got, loadDirection(eq.loadConvention) !== 'resistance');
      return { ok: true, load: r.load, note: { kind: 'capped', text }, extra: null };
    }
    return { ok: true, load: inUnit, note: null, extra: null };
  }
  const r = roundToAvailableLoad(target, eq, policy);
  if (!r.ok) {
    return { ok: false, note: { kind: 'no_achievable_load', text: `${asked} isn't possible ${where(eq)}.` } };
  }
  const direction = loadDirection(eq.loadConvention);
  const requestedInUnit = r.convertedRequest?.value ?? target.value;
  const harderThanAsked = compareDifficulty(r.load.value, requestedInUnit, direction) > 0;
  const easierThanAsked = compareDifficulty(r.load.value, requestedInUnit, direction) < 0;
  // "Too hard" never rounds to something harder than the coach asked for (§2.6).
  if (policy === 'easier' && harderThanAsked) {
    return { ok: false, note: { kind: 'no_achievable_load', text: `${asked} isn't possible ${where(eq)}.` } };
  }
  const got = loadText(r.load, r.load.convention, eq);
  const extra =
    r.convertedRequest === null
      ? null
      : { kind: 'converted' as const, text: convertedWords(asked) };
  if (r.exact) return { ok: true, load: r.load, note: null, extra };
  if (r.bounded !== null && easierThanAsked) {
    // Short fit words (minimal-copy W13): the most a bar makes, or the least assistance a machine gives.
    const text = direction === 'resistance' ? boundWords('max', got, false) : boundWords('min', got, true);
    return { ok: true, load: r.load, note: { kind: 'capped', text }, extra };
  }
  return { ok: true, load: r.load, note: { kind: 'snapped', text: `Rounded to ${got}` }, extra };
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
  // A harder target RPE than the set had (CHANGELOG 2026-10-11): blocked by pain and in a lighter session too.
  if (after.rpe != null && b.rpe != null && after.rpe > b.rpe) return true;
  return false;
}

export function sameTarget(a: CoachTarget | null, b: CoachTarget): boolean {
  const x = a ?? { load: null, reps: null };
  const loadSame =
    (x.load === null && b.load === null) ||
    (x.load !== null && b.load !== null && x.load.unit === b.load.unit && x.load.convention === b.load.convention && formatNumber(x.load.value) === formatNumber(b.load.value));
  const repsSame = (x.reps === null && b.reps === null) || (x.reps !== null && b.reps !== null && x.reps.min === b.reps.min && x.reps.max === b.reps.max);
  // A target RPE only counts when `b` names one (null/absent = keep the current one).
  const rpeSame = b.rpe == null || b.rpe === (x.rpe ?? null);
  return loadSame && repsSame && rpeSame;
}

function targetOf(set: WorkoutSet): CoachTarget {
  return { load: set.planned.load, reps: set.planned.reps, ...(set.planned.rpe !== null ? { rpe: set.planned.rpe } : {}) };
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
  return { kind: 'pain_mentioned', text: `Not increasing ${ex.exerciseName}: you mentioned ${what}.`, outcome: `Not increasing ${ex.exerciseName}: you mentioned ${what}. Sets unchanged.` };
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
  const asTyped: string[] = [];

  for (const req of args.exercises) {
    const ex = state.exercises.find((e) => e.id === req.sessionExerciseId);
    if (!ex || seenExercises.has(req.sessionExerciseId)) {
      notes.add('unknown_target', 'Not changed: the coach named an exercise that isn’t in this workout.', []);
      continue;
    }
    seenExercises.add(ex.id);
    const sets = liveSetsInOrder(state, ex.id);
    const numberOf = (setId: string): number => sets.findIndex((s) => s.id === setId) + 1;
    const own = equipmentOf(state, ex);
    // Weight held or worn on a bodyweight exercise: the gym's dumbbells and plates (rule 4).
    const weighted = isWeightedBodyweight(ex, own, rowMarkedBodyweight(state.sets, ex.id));
    const eq = weighted ? loadCheckEquipment(ex, own, currentGymEquipment(state.session), state.session.gymId, true) : own;
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
    // ADR 0038: Ben's heaviest named weight on this exercise in this call caps the coach's own loads (its ramp-up).
    const dir = loadDirection(ex.loadConvention);
    const askedLoads = [...req.sets.map((c) => c.target.load), req.addSet?.load ?? null, ...(input.addTargets?.[ex.id] ?? []).map((t) => t.load)].filter((l): l is Load => l !== null && l.convention !== 'bodyweight');
    const benTop = askedLoads.filter((l) => isBenLoad(l, input.benLoads)).reduce<Load | null>((top, l) => (top === null || compareDifficulty(l.unit === top.unit ? l.value : convertMass(l, top.unit).value, top.value, dir) > 0 ? l : top), null);

    /**
     * Resolve one requested target against the set's current target. Null = drop.
     * `set`: the set it changes (or copies, for an added set), whose resolved
     * target RPE is what a coach `rpe` is compared with.
     */
    /** ADR 0038: whether the last `resolve` kept a load Ben named as typed. */
    const typed = { last: false };
    const resolve = (before: CoachTarget | null, ask: CoachTarget, setIds: string[], set: WorkoutSet): CoachTarget | null => {
      typed.last = false;
      let load = before?.load ?? null;
      // Snap notes only count when the change is kept.
      const pending: { kind: GuardNoteKind; text: string }[] = [];
      if (ask.load !== null) {
        const mine = isBenLoad(ask.load, input.benLoads);
        let wanted = ask.load;
        let how = policy;
        if (!mine && benTop !== null && wanted.convention !== 'bodyweight') {
          const topHere = wanted.unit === benTop.unit ? benTop.value : convertMass(benTop, wanted.unit).value;
          if (compareDifficulty(wanted.value, topHere, dir) > 0) {
            wanted = { ...wanted, value: topHere };
            how = 'easier';
          }
        }
        const snapped = snapLoad(wanted, ex, eq, how, weighted, { asTyped: mine, lenient: true });
        if (!snapped.ok) {
          notes.add(snapped.note.kind, snapped.note.text, setIds);
          blockedOutcomes.push(snapped.note.text.replace('Load unchanged.', 'Sets unchanged.'));
          return null;
        }
        if (snapped.note) pending.push(snapped.note);
        if (snapped.extra) pending.push(snapped.extra);
        load = snapped.load;
        typed.last = mine;
      }
      let reps = before?.reps ?? null;
      if (ask.reps !== null) {
        if (!validReps(ask.reps)) {
          notes.add('invalid_reps', `Not changed: ${String(ask.reps.min)}–${String(ask.reps.max)} reps isn't a usable target.`, setIds);
          return null;
        }
        reps = ask.reps;
      }
      // The set's target RPE as it is now (Ben's, the coach's, the plan's or the rule's; review target-rpe S1).
      const nowRpe = targetRpeOf(set, input.ruleTargetRpe?.[ex.id] ?? null);
      let rpe = ask.rpe ?? null;
      if (rpe !== null && set.planned.rpeOverride !== undefined && rpe !== set.planned.rpeOverride) {
        // Ben's own target RPE wins: the coach's isn't stored or shown (review target-rpe S2).
        notes.add('rpe_overridden', 'Your target RIR stays.', setIds);
        rpe = null;
      }
      // Restating the target in force is no change.
      if (rpe !== null && nowRpe !== null && rpe === nowRpe.rpe) rpe = null;
      const after: CoachTarget = { load, reps, ...(rpe !== null ? { rpe } : {}) };
      const beforeEffective: CoachTarget | null = before === null ? null : { ...before, ...(nowRpe !== null ? { rpe: nowRpe.rpe } : {}) };
      if (increaseBlock !== null && isIncrease(beforeEffective, after, ex.loadConvention)) {
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
      const after = resolve(before, change.target, [set.id], set);
      if (after === null || sameTarget(before, after)) continue;
      if (typed.last && after.load !== null) asTyped.push(set.id);
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
          const after = resolve(targetOf(template), req.addSet, [], template);
          if (after !== null) {
            const liveCount = sets.length - (removed === null ? 0 : 1);
            if (typed.last) asTyped.push(deriveId(`coach-add-set:${input.opId}:${ex.id}`));
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

    const addedMore: AddedSetPlan[] = [];
    const more = input.addTargets?.[ex.id] ?? [];
    if (more.length > 0) {
      anyRequested = true;
      const template = [...sets].reverse().find((s) => s.setType !== 'warmup') ?? sets[sets.length - 1];
      if (template === undefined) {
        notes.add('unknown_target', `Not added: ${ex.exerciseName} has no set to copy.`, []);
      } else if (increaseBlock !== null) {
        notes.add(increaseBlock.kind, increaseBlock.text, []);
        blockedOutcomes.push(increaseBlock.outcome);
      } else {
        const liveCount = sets.length - (removed === null ? 0 : 1) + (added === null ? 0 : 1);
        for (const [i, t] of more.entries()) {
          const resolved = resolve(targetOf(template), t, [], template);
          const after = resolved ?? targetOf(template);
          const setId = deriveId(`coach-add-set:${input.opId}:${ex.id}:${String(i + 1)}`);
          if (resolved !== null && typed.last) asTyped.push(setId);
          addedMore.push({ setId, setNumber: liveCount + 1 + i, copyFromSetId: template.id, after });
        }
        touched.push(template.id);
      }
    }

    if (changes.length > 0 || added !== null || removed !== null || addedMore.length > 0) {
      const recordChanges: SetTargetChange[] = [...changes];
      if (removed !== null) recordChanges.push({ setId: removed.setId, setNumber: removed.setNumber, before: removed.before, after: null });
      if (added !== null) recordChanges.push({ setId: added.setId, setNumber: added.setNumber, before: null, after: added.after });
      for (const a of addedMore) recordChanges.push({ setId: a.setId, setNumber: a.setNumber, before: null, after: a.after });
      plans.push({ sessionExerciseId: ex.id, exerciseName: ex.exerciseName, changes: recordChanges, added, removed, ...(addedMore.length > 0 ? { addedMore } : {}) });
    }
  }

  const guardNotes = notes.list();
  if (plans.length > 0) return { status: 'apply', exercises: plans, guardNotes, touchedSetIds: [...new Set(touched)], ...(asTyped.length > 0 ? { asTypedSetIds: [...new Set(asTyped)] } : {}) };
  const firstBlocked = blockedOutcomes[0];
  if (firstBlocked !== undefined) return { status: 'unchanged', outcome: firstBlocked, guardNotes };
  const firstNote = guardNotes[0];
  if (firstNote !== undefined) return { status: 'unchanged', outcome: `${firstNote.text} Nothing changed.`, guardNotes };
  if (!anyRequested || requestedNumbers.length === 0) return { status: 'unchanged', outcome: 'Coach kept your sets as planned.', guardNotes };
  return { status: 'unchanged', outcome: `Coach kept ${setNumbersText(requestedNumbers)} as planned.`, guardNotes };
}
