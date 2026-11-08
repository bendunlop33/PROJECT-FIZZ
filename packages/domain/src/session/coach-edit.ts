import { BUILD_LIMITS, coachEditStepOpId, type ActionDetail, type CoachEditStep, type CoachEditTodayCommand, type CommandOf, type EditTodayArgs, type EditTodayOp, type Exercise, type ExerciseTargetChanges, type GuardNote, type PainFlag, type SessionAggregate, type SessionExercise, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { isBenLoad, isIncrease, validateTodayAdjustment, type AdjustIntent, type BenLoad, type MessagePain } from '../coach/adjust';
import { dayMonthText } from '../display';
import { painFlagForMovement, rowIsMovement } from '../exercise-identity';
import { PAIN_AREA_WORD } from '../pain-flags';
import { deriveId } from '../stable';
import { toMs } from '../time';
import { checkCoachAdd, type CoachAddInput } from './coach-add';
import { BUILDER_REST_DEFAULTS } from '../builder/rest';
import { loadDirection, roundToAvailableLoad } from '../equipment';
import { currentGymEquipment, equipmentOfRow } from './equipment-snapshot';
import { buildSwapExerciseCommand, midSwapSlot, swapPainCarry } from './mid-swap';
import { doableHere, substituteTargets } from './substitutes';
import { supersetLinkSides } from './order';
import { afterSteps, isParityOp, parityOpSteps } from './coach-edit-parity';
import { COACH_HARD_CEILINGS, COACH_JUDGEMENT_LIMITS, loadStepTradeOff, painGoAheadTradeOff, volumeTradeOff, warmupTradeOff } from '../coach/coach-limits';
import { reduceSession } from './reducer';

/**
 * Coach v3 (ADR 0027, Ben 18 Oct): the coach's one tool for today's live workout, `edit_today`.
 * Pure. The model's ops are only a request; this decides everything and builds the workout's own
 * commands as one `coach_edit_today` operation:
 *
 * - The workout is active and at the version the coach read (rule 5).
 * - `set` ops (targets) go through `validateTodayAdjustment`: pending sets only, loads snapped to
 *   the equipment and bounded by its min/max (rule 4), increases held on pain (rule 9). As before,
 *   a set it can't change is noted and the rest still apply.
 * - `set_count`: more working sets copy the exercise's last one (an increase, so held on pain); fewer
 *   remove pending working sets from the end. Never below the sets already done (rule 2).
 * - `swap`: the checks of the Swap sheet (`rankSubstitutions`): a known exercise, measured the same,
 *   doable at this gym, not already in the workout, not pain-flagged; the row's pending sets move,
 *   each target from the substitute's own history fitted to this gym (`buildSwapExerciseCommand`).
 * - `add`: `checkCoachAdd` (known, not flagged, not already here, doable, clamped, loads from its
 *   own history fitted to this gym).
 * - `remove`: a row with nothing done leaves the workout (`remove_exercise`); otherwise its pending
 *   sets are skipped (`skip_exercise`). Done sets are never touched.
 * - `move`: `move_exercise` (a row with a set left).
 * - `superset` / `split_superset` (Ben, 19 Oct): `link_superset` / `split_superset` on rows already
 *   here (both with a set left). An `add` may name an exercise already in the workout: a second copy,
 *   e.g. a superset with itself at 0 (`load`).
 *
 * ADR 0038 (Ben, 28 Oct): an op that can't be done is left out with one line (a guard note) and the rest
 * applies, as one change with one Undo; only an edit where nothing can be done is refused. Two ops on the
 * same row that would fight (a swap and a set change, two moves) still refuse the edit (the model's slip).
 * `sets` lays out an exercise's remaining working sets ("build up to 95 as the last set"); weights Ben
 * named (`benLoads`) are kept as typed, the coach's own ramp is snapped and kept under his top set. IDs derive from the
 * opId, so a replay builds the same rows. Steps run in a fixed order: targets and counts, swaps,
 * removals, adds, moves, supersets.
 */

/** Local reads for one exercise an `add` or `swap` op names (the add tool's inputs). */
export type CoachEditExerciseInputs = Pick<CoachAddInput, 'exercise' | 'history' | 'substitute' | 'owner' | 'sameMovementIds'>;

export interface CoachEditInput {
  aggregate: SessionAggregate | null;
  args: EditTodayArgs;
  intent: AdjustIntent;
  opId: string;
  /** The coach record's ID (each changed target remembers it, for `Why?` and Undo). */
  actionId: string;
  at: ZonedTimestamp;
  painFlags: readonly PainFlag[];
  sessionPainUnspecified: boolean;
  gymName: string | null;
  messagePain: MessagePain | null;
  ruleTargetRpe?: Readonly<Record<string, number>> | undefined;
  /** Ben's `Adjust` on an offer about one row (CA1): only its targets and set count may change. */
  onlySessionExerciseId?: string | null;
  /** Reads for each `add` and `swap` op's exercise, by op index; null when it couldn't be read. */
  exercises: ReadonlyMap<number, CoachEditExerciseInputs | null>;
  /** ADR 0038: weights Ben named in his words this turn (`namedWeights`): used as typed. */
  benLoads?: readonly BenLoad[];
  /** ADR 0038: an add or swap to an exercise the gym's profile has nothing for goes ahead with no item (the caller learns the kit). */
  kitOptional?: boolean;
  /**
   * (Ben, 8 Nov: "If I agree to apply it there shouldn't be any limit") Ben asked for this change himself (his words
   * this turn): the coach's judgement limits (`COACH_JUDGEMENT_LIMITS`: the 20% load step, 8 direct sets a muscle a
   * session, the warm-up count) don't block or trim it, and the plan's `tradeOff` says which one it went past. False:
   * the coach's own offer, held to them. Absent: neither (the checks as before 8 Nov; no trade-off lines). The gym's
   * kit, a machine's max and done sets apply either way.
   */
  asked?: boolean;
  /** The muscle group an exercise's working sets count to directly (the per-session cap); null: none. Absent: no volume check. */
  directGroupOf?: (exerciseId: string) => string | null;
  /**
   * (Ben, 8 Nov) Ben told the coach to go ahead despite a pain hold (checked on his own words by the caller): on his
   * ask, the movements this edit changes aren't held today, and the card says so. Ignored on an offer.
   */
  painGoAhead?: boolean;
}

type Line = Extract<ActionDetail, { kind: 'edit_today' }>['lines'][number];

export type CoachEditPlan =
  | {
      status: 'ok';
      command: CommandOf<'coach_edit_today'>;
      lines: Line[];
      exercises: ExerciseTargetChanges[];
      added: NonNullable<Extract<ActionDetail, { kind: 'edit_today' }>['added']>;
      names: string[];
      guardNotes: GuardNote[];
      /** The exercises the edit adds or swaps to (the caller saves any not yet in Ben's exercises, in the same write). */
      used: Exercise[];
      /** (Ben, 8 Nov) The coach limits Ben's ask went past, one line each, for the card. */
      tradeOff: string[];
      /** (Ben, 8 Nov) The pain holds his go-ahead waved through (the caller clears them early with the change). */
      wavedFlags?: { id: string; version: number }[];
    }
  | { status: 'stale'; guardNotes: GuardNote[] }
  /** `already` (Ben, 1 Nov): nothing to do, not a failure: every set asked for already is that (`Already 100 kg`). */
  | { status: 'rejected'; failure: string; guardNotes: GuardNote[]; already?: true };

const working = (s: WorkoutSet): boolean => s.setType !== 'warmup';
const liveRow = (state: SessionAggregate, id: string): SessionExercise | undefined => state.exercises.find((e) => e.id === id && e.removed === undefined);

/** The row each op is about (for conflicts); null for an add. */
function rowOf(state: SessionAggregate, op: EditTodayOp): string | null {
  switch (op.op) {
    case 'set':
      return state.sets.find((s) => s.id === op.setId)?.sessionExerciseId ?? null;
    case 'set_count':
    case 'sets':
    case 'swap':
    case 'remove':
    case 'move':
    case 'superset':
    case 'split_superset':
    case 'main':
    case 'warmups':
    case 'set_details':
    case 'order_sets':
    case 'note':
    case 'load_mode':
      return op.sessionExerciseId;
    case 'remove_set':
      return state.sets.find((s) => s.id === op.setId)?.sessionExerciseId ?? null;
    case 'add':
      return null;
  }
}

/** Rows an op leans on without changing (an add's position or partner, a move's anchor). */
function anchorsOf(op: EditTodayOp): string[] {
  if (op.op === 'add') return [op.afterSessionExerciseId, op.supersetWithSessionExerciseId].filter((x): x is string => x !== null);
  if (op.op === 'move') return op.afterSessionExerciseId === null ? [] : [op.afterSessionExerciseId];
  if (op.op === 'superset') return [op.withSessionExerciseId];
  return [];
}

function planOnce(input: CoachEditInput): CoachEditPlan {
  const s = input.aggregate;
  const notes: GuardNote[] = [];
  const reject = (failure: string): CoachEditPlan => ({ status: 'rejected', failure: failure.slice(0, 200), guardNotes: notes });
  if (s === null || s.session.status !== 'active' || s.session.version !== input.args.baseVersion) return { status: 'stale', guardNotes: notes };
  const ops = input.args.ops;
  const nameOf = (id: string): string => s.exercises.find((e) => e.id === id)?.exerciseName ?? 'that exercise';

  // An offer's Adjust about one row: that row's targets and set count only (review S1).
  const only = input.onlySessionExerciseId ?? null;
  if (only !== null && ops.some((op) => (op.op !== 'set' && op.op !== 'set_count' && op.op !== 'sets' && op.op !== 'warmups') || rowOf(s, op) !== only)) return reject(`only ${nameOf(only)}`);

  // Rows that a swap or removal takes over can't be changed, moved or used as an anchor by another op.
  const taken = new Map<string, number>();
  const counted = new Set<string>();
  const moved = new Set<string>();
  const newIds = new Set<string>();
  for (const [i, op] of ops.entries()) {
    const row = rowOf(s, op);
    if (op.op === 'set' && row === null) return reject('the coach named a set that isn’t in this workout');
    if (op.op === 'swap' || op.op === 'remove') {
      if (taken.has(op.sessionExerciseId)) return reject(`two changes to ${nameOf(op.sessionExerciseId)} at once`);
      taken.set(op.sessionExerciseId, i);
    }
    if (op.op === 'set_count' || op.op === 'sets') {
      if (counted.has(op.sessionExerciseId)) return reject(`two set counts for ${nameOf(op.sessionExerciseId)}`);
      counted.add(op.sessionExerciseId);
    }
    if (op.op === 'move') {
      if (moved.has(op.sessionExerciseId)) return reject(`two moves of ${nameOf(op.sessionExerciseId)}`);
      moved.add(op.sessionExerciseId);
    }
    // Two swaps to one exercise would fight; an exercise added twice is two copies (Ben, 19 Oct).
    const id = op.op === 'swap' ? op.toExerciseId : null;
    if (id !== null) {
      if (newIds.has(id)) return reject('the same exercise twice');
      newIds.add(id);
    }
  }
  for (const [i, op] of ops.entries()) {
    const row = rowOf(s, op);
    const clash = [...(row === null ? [] : [row]), ...anchorsOf(op)].find((r) => taken.has(r) && taken.get(r) !== i);
    if (clash !== undefined) return reject(`two changes to ${nameOf(clash)} at once`);
  }
  // (Ben, 8 Nov) A new order of the sets, or `+ Weight`, with the same row's sets or targets changed too would fight.
  const resets = new Set(ops.filter((op) => op.op === 'set' || op.op === 'sets' || op.op === 'set_count' || op.op === 'warmups' || op.op === 'remove_set').map((op) => rowOf(s, op)));
  const fights = ops.find((op) => (op.op === 'order_sets' || op.op === 'load_mode') && resets.has(op.sessionExerciseId));
  if (fights !== undefined && (fights.op === 'order_sets' || fights.op === 'load_mode')) return reject(`two changes to ${nameOf(fights.sessionExerciseId)}’s sets at once`);

  const steps: CoachEditStep[] = [];
  /** ADR 0038: an op that can't be done is left out with its line; the rest applies. */
  const skipped: string[] = [];
  const skip = (line: string): void => {
    const text = line.slice(0, 200);
    skipped.push(text);
    notes.push({ kind: 'structural_dropped', setIds: [], text: `Not done: ${text}`.slice(0, 300) });
  };
  const nextOpId = (): string => coachEditStepOpId(input.opId, steps.length);
  const lines: Line[] = [];
  const names = new Set<string>();
  const used: Exercise[] = [];
  const added: NonNullable<Extract<ActionDetail, { kind: 'edit_today' }>['added']> = [];
  let exercises: ExerciseTargetChanges[] = [];

  // 1. Targets and set counts: one `adjust_pending_targets` step.
  const setOps = ops.filter((op): op is Extract<EditTodayOp, { op: 'set' }> => op.op === 'set');
  const countOps = ops.filter((op): op is Extract<EditTodayOp, { op: 'set_count' }> => op.op === 'set_count');
  const layoutOps = ops.filter((op): op is Extract<EditTodayOp, { op: 'sets' }> => op.op === 'sets');
  if (setOps.length > 0 || countOps.length > 0 || layoutOps.length > 0) {
    const rows = new Map<string, { sets: { setId: string; target: Extract<EditTodayOp, { op: 'set' }>['target'] }[]; more: number }>();
    const entry = (id: string) => rows.get(id) ?? rows.set(id, { sets: [], more: 0 }).get(id) ?? { sets: [], more: 0 };
    for (const op of setOps) entry(rowOf(s, op) ?? '').sets.push({ setId: op.setId, target: op.target });
    const fewer = new Map<string, WorkoutSet[]>();
    const countLines: Line[] = [];
    /** ADR 0038: new sets with their own targets (a `sets` op longer than what's left). */
    const addTargets: Record<string, Extract<EditTodayOp, { op: 'set' }>['target'][]> = {};
    for (const op of layoutOps) {
      const row = liveRow(s, op.sessionExerciseId);
      if (row === undefined) {
        skip('the coach named an exercise that isn’t in this workout');
        continue;
      }
      const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted' && x.status !== 'skipped' && working(x)).sort((a, b) => a.index - b.index);
      const pending = own.filter((x) => x.status === 'pending');
      const done = own.length - pending.length;
      const keep = Math.min(op.sets.length, pending.length);
      for (let i = 0; i < keep; i += 1) {
        const set = pending[i];
        const target = op.sets[i];
        if (set !== undefined && target !== undefined) entry(row.id).sets.push({ setId: set.id, target });
      }
      if (op.sets.length > pending.length) addTargets[row.id] = op.sets.slice(pending.length);
      else if (op.sets.length < pending.length) {
        const gone = pending.slice(op.sets.length).filter((x) => x.pairedWithSetId === null);
        if (gone.length > 0) fewer.set(row.id, gone);
      }
      const total = done + op.sets.length;
      if (total !== own.length) {
        countLines.push({ change: 'edit', text: `${row.exerciseName}: ${String(own.length)} → ${String(total)} sets` });
        names.add(row.exerciseName);
      }
      entry(row.id);
    }
    for (const op of countOps) {
      const row = liveRow(s, op.sessionExerciseId);
      if (row === undefined) {
        skip('the coach named an exercise that isn’t in this workout');
        continue;
      }
      const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted' && x.status !== 'skipped' && working(x)).sort((a, b) => a.index - b.index);
      const done = own.filter((x) => x.status !== 'pending').length;
      if (op.workingSets < done) {
        skip(`${row.exerciseName}: ${String(done)} ${done === 1 ? 'set is' : 'sets are'} already done`);
        continue;
      }
      if (op.workingSets === own.length) continue;
      if (op.workingSets > own.length) entry(row.id).more = op.workingSets - own.length;
      else {
        const pending = own.filter((x) => x.status === 'pending' && x.pairedWithSetId === null);
        fewer.set(row.id, pending.slice(pending.length - (own.length - op.workingSets)));
      }
      countLines.push({ change: 'edit', text: `${row.exerciseName}: ${String(own.length)} → ${String(op.workingSets)} sets` });
      names.add(row.exerciseName);
    }
    const adjustRows = [...rows.entries()].filter(([id, r]) => r.sets.length > 0 || r.more > 0 || addTargets[id] !== undefined).map(([sessionExerciseId, r]) => ({
      sessionExerciseId,
      sets: r.sets.filter((x) => ![...(fewer.get(sessionExerciseId) ?? [])].some((g) => g.id === x.setId)),
      addSet: r.more > 0 ? { load: null, reps: null, rpe: null } : null,
      removeSetId: null,
    }));
    const v =
      adjustRows.length === 0
        ? null
        : validateTodayAdjustment({
            aggregate: s,
            args: { baseVersion: input.args.baseVersion, exercises: adjustRows, reason: input.args.reason },
            intent: input.intent,
            opId: input.opId,
            painFlags: input.painFlags,
            sessionPainUnspecified: input.sessionPainUnspecified,
            gymName: input.gymName,
            messagePain: input.messagePain,
            ruleTargetRpe: input.ruleTargetRpe,
            benLoads: input.benLoads,
            addTargets,
          });
    if (v?.status === 'stale') return { status: 'stale', guardNotes: notes };
    if (v !== null) notes.push(...v.guardNotes);
    const plans = v?.status === 'apply' ? v.exercises : [];
    const typedIds = new Set(v?.status === 'apply' ? (v.asTypedSetIds ?? []) : []);
    // A set count the checks held (pain, a lighter session) is left out with its line, never quietly dropped.
    const heldLine = (rowId: string): string => (v?.status === 'unchanged' ? v.outcome.replace(/\s*(?:Sets unchanged|Nothing changed)\.?$/i, '') : `no more sets of ${nameOf(rowId)}`);
    for (const [rowId, r] of rows) {
      const wantedMore = r.more > 0 || (addTargets[rowId]?.length ?? 0) > 0;
      const gotMore = plans.some((p) => p.sessionExerciseId === rowId && (p.added !== null || (p.addedMore?.length ?? 0) > 0));
      if (wantedMore && !gotMore) {
        skip(heldLine(rowId));
        const line = countLines.findIndex((l) => l.text.startsWith(`${nameOf(rowId)}:`));
        if (line >= 0) countLines.splice(line, 1);
      }
    }
    const changes: CommandOf<'adjust_pending_targets'>['changes'] = [];
    const addSets: CommandOf<'adjust_pending_targets'>['addSets'] = [];
    const removeSetIds: string[] = [];
    const byRow = new Map<string, ExerciseTargetChanges>();
    const record = (rowId: string): ExerciseTargetChanges => byRow.get(rowId) ?? byRow.set(rowId, { sessionExerciseId: rowId, exerciseName: nameOf(rowId), changes: [] }).get(rowId) ?? { sessionExerciseId: rowId, exerciseName: nameOf(rowId), changes: [] };
    for (const p of plans) {
      const out = record(p.sessionExerciseId);
      for (const c of p.changes) {
        if (c.before === null || c.after === null) continue;
        changes.push({ setId: c.setId, target: c.after, ...(typedIds.has(c.setId) ? { loadAsTyped: true as const } : {}) });
        out.changes.push(c);
      }
      if (p.added !== null) {
        const more = rows.get(p.sessionExerciseId)?.more ?? 1;
        for (let k = 0; k < more; k += 1) {
          const setId = k === 0 ? p.added.setId : deriveId(`coach-edit-set:${input.opId}:${p.sessionExerciseId}:${String(k)}`);
          addSets.push({ newSetId: setId, copyFromSetId: p.added.copyFromSetId, target: p.added.after, ...(typedIds.has(p.added.setId) ? { loadAsTyped: true as const } : {}) });
          out.changes.push({ setId, setNumber: p.added.setNumber + k, before: null, after: p.added.after });
        }
      }
      for (const a of p.addedMore ?? []) {
        addSets.push({ newSetId: a.setId, copyFromSetId: a.copyFromSetId, target: a.after, ...(typedIds.has(a.setId) ? { loadAsTyped: true as const } : {}) });
        out.changes.push({ setId: a.setId, setNumber: a.setNumber, before: null, after: a.after });
      }
      names.add(p.exerciseName);
    }
    for (const [rowId, gone] of fewer) {
      const out = record(rowId);
      const live = s.sets.filter((x) => x.sessionExerciseId === rowId && x.status !== 'deleted').sort((a, b) => a.index - b.index);
      for (const g of gone) {
        removeSetIds.push(g.id);
        out.changes.push({ setId: g.id, setNumber: live.findIndex((x) => x.id === g.id) + 1, before: { load: g.planned.load, reps: g.planned.reps, ...(g.planned.rpe !== null ? { rpe: g.planned.rpe } : {}) }, after: null });
      }
    }
    exercises = [...byRow.values()].filter((e) => e.changes.length > 0);
    if (changes.length > 0 || addSets.length > 0 || removeSetIds.length > 0) {
      steps.push({ type: 'adjust_pending_targets', at: input.at, opId: nextOpId(), expectedVersion: input.args.baseVersion, actionId: input.actionId, reason: input.args.reason, changes, removeSetIds, addSets });
      lines.push(...countLines);
    } else if (ops.every((op) => op.op === 'set' || op.op === 'set_count' || op.op === 'sets')) {
      // (Ben, 1 Nov, build 500) "Stick to 100" when they are 100 kg: a no-op, said as one, never a failure.
      if (v?.status === 'unchanged' && v.already === true && skipped.length === 0) return { status: 'rejected', failure: v.outcome, guardNotes: notes, already: true };
      // Nothing structural, and no target changed: the checks' own line.
      return reject(skipped[0] ?? (v?.status === 'unchanged' ? v.outcome.replace(/\s*(?:Sets unchanged|Nothing changed)\.?$/i, '') : 'no change'));
    }
  }

  const nowMs = toMs(input.at.utc);
  const flagged = (exercise: Exercise, ids: readonly string[]): string | null => {
    const flag = painFlagForMovement(input.painFlags, exercise, ids, nowMs, input.at.tz);
    if (flag === null) return null;
    const area = flag.area === null ? '' : `${PAIN_AREA_WORD[flag.area]} `;
    return `${exercise.name}: ${area}flagged ${dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz)}`;
  };

  // 2. Swaps.
  for (const [i, op] of ops.entries()) {
    if (op.op !== 'swap') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    const slot = midSwapSlot(s, row.id);
    if (slot === null) {
      skip(`nothing left to swap: ${row.exerciseName} is done`);
      continue;
    }
    const got = input.exercises.get(i) ?? null;
    const exercise = got?.exercise ?? null;
    if (got === null || exercise === null) {
      skip('it isn’t one of your exercises');
      continue;
    }
    const ids = [exercise.id, ...(got.sameMovementIds ?? [])];
    if (exercise.id === row.exerciseId || s.exercises.some((e) => e.removed === undefined && rowIsMovement(e, exercise, ids))) {
      skip(`${exercise.name} is already in today’s workout`);
      continue;
    }
    if (exercise.measurement !== row.measurement) {
      skip(`${exercise.name} is measured differently`);
      continue;
    }
    if (input.kitOptional !== true && !doableHere(exercise, { ...got.substitute.gym, equipment: currentGymEquipment(s.session) })) {
      skip(`nothing for ${exercise.name} at ${got.substitute.gym.name}`);
      continue;
    }
    const pain = flagged(exercise, ids);
    if (pain !== null) {
      skip(pain);
      continue;
    }
    // Pain on the row being swapped holds the substitute today (B5, rule 9).
    const carried = swapPainCarry(s, row.id, input.painFlags);
    const sctx = { ...got.substitute, gym: { ...got.substitute.gym, equipment: currentGymEquipment(s.session) }, sessionPain: got.substitute.sessionPain.active ? got.substitute.sessionPain : carried };
    const plan = substituteTargets(slot, exercise, got.history, sctx);
    const opId = nextOpId();
    let n = 0;
    const built = buildSwapExerciseCommand({
      aggregate: s,
      sessionExerciseId: row.id,
      plan,
      gymName: got.substitute.gym.name,
      ownerUnit: got.owner.preferredUnit,
      painFlagged: new Set([...input.painFlags.filter((f) => f.status === 'active').map((f) => f.exerciseId), ...(carried.active ? [exercise.id] : [])]),
      ...(got.substitute.lastUsedHere ? { lastUsedHere: got.substitute.lastUsedHere } : {}),
      opId,
      at: input.at,
      newId: () => deriveId(`coach-edit-swap:${opId}:${String((n += 1))}`),
    });
    if (!built.ok) {
      skip(built.reason === 'measurement' ? `${exercise.name} is measured differently` : `nothing left to swap: ${row.exerciseName} is done`);
      continue;
    }
    steps.push(built.command);
    used.push(exercise);
    lines.push({ change: 'swap', text: `${row.exerciseName} → ${exercise.name}` });
    names.add(row.exerciseName).add(exercise.name);
  }

  // 3. Removals: pending sets only.
  for (const op of ops) {
    if (op.op !== 'remove') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted');
    if (!own.some((x) => x.status === 'pending')) {
      skip(`${row.exerciseName} is done`);
      continue;
    }
    const parted = row.continuesFromId !== undefined || s.exercises.some((e) => e.continuesFromId === row.id && e.removed === undefined);
    if (own.some((x) => x.status === 'completed') || parted) {
      steps.push({ type: 'skip_exercise', at: input.at, opId: nextOpId(), sessionExerciseId: row.id });
      lines.push({ change: 'remove', text: `Rest of ${row.exerciseName} skipped` });
    } else {
      steps.push({ type: 'remove_exercise', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, expectedVersion: input.args.baseVersion });
      lines.push({ change: 'remove', text: `Removed ${row.exerciseName}` });
    }
    names.add(row.exerciseName);
  }

  // 4. Adds. A second add after the same exercise goes after the first one, in the order asked.
  const placedAfter = new Map<string, string>();
  for (const [i, op] of ops.entries()) {
    if (op.op !== 'add') continue;
    const got = input.exercises.get(i) ?? null;
    if (got === null || got.exercise === null) {
      skip('it isn’t one of your exercises');
      continue;
    }
    const opId = nextOpId();
    const after = op.afterSessionExerciseId === null ? null : (placedAfter.get(op.afterSessionExerciseId) ?? op.afterSessionExerciseId);
    const check = checkCoachAdd({
      aggregate: s,
      args: { baseVersion: input.args.baseVersion, exerciseId: op.exerciseId, workingSets: op.workingSets, reps: op.reps, workSeconds: op.workSeconds, distanceMetres: op.distanceMetres ?? null, targetRpe: op.targetRpe, afterSessionExerciseId: op.afterSessionExerciseId, supersetWithSessionExerciseId: op.supersetWithSessionExerciseId, load: op.load ?? null, reason: input.args.reason },
      ...got,
      opId,
      at: input.at,
      ...(input.kitOptional === true ? { kitOptional: true } : {}),
      ...(op.load != null && op.load > 0 && isBenLoad({ value: op.load, unit: got.owner.preferredUnit, convention: 'total' }, input.benLoads) ? { benNamed: true } : {}),
    });
    if (check.status === 'stale') return { status: 'stale', guardNotes: notes };
    if (check.status === 'rejected') {
      notes.push(...check.guardNotes);
      skip(`${check.exerciseName ?? 'that exercise'}: ${check.failure}`);
      continue;
    }
    const command = after === null || op.supersetWithSessionExerciseId !== null ? check.command : { ...check.command, afterSessionExerciseId: after };
    if (op.afterSessionExerciseId !== null) placedAfter.set(op.afterSessionExerciseId, command.newSessionExerciseId);
    steps.push(command);
    used.push(got.exercise);
    const sum = check.summary;
    notes.push(...check.guardNotes.map((g) => ({ ...g, text: `${sum.exerciseName}: ${g.text}`.slice(0, 300) })));
    added.push({ exerciseName: sum.exerciseName, sets: sum.sets, target: sum.target, durationS: sum.durationS, ...(sum.distanceM !== undefined ? { distanceM: sum.distanceM } : {}), afterName: sum.afterName, supersetWithName: sum.supersetWithName });
    const where = sum.supersetWithName !== null ? ` · superset with ${sum.supersetWithName}` : sum.afterName !== null ? ` · after ${sum.afterName}` : '';
    lines.push({ change: 'add', text: `Added ${sum.exerciseName} · ${String(sum.sets)} ${sum.sets === 1 ? 'set' : 'sets'}${where}`.slice(0, 200) });
    names.add(sum.exerciseName);
  }

  // 5. Moves.
  for (const op of ops) {
    if (op.op !== 'move') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    if (!s.sets.some((x) => x.sessionExerciseId === row.id && x.status === 'pending')) {
      skip(`${row.exerciseName} is done`);
      continue;
    }
    const after = op.afterSessionExerciseId === null ? null : liveRow(s, op.afterSessionExerciseId);
    if (after === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    if (after !== null && after.id === row.id) {
      skip(`${row.exerciseName} can’t go after itself`);
      continue;
    }
    steps.push({ type: 'move_exercise', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, afterSessionExerciseId: after?.id ?? null, expectedVersion: input.args.baseVersion });
    lines.push({ change: 'reorder', text: after === null ? `${row.exerciseName} moved first` : `${row.exerciseName} moved after ${after.exerciseName}` });
    names.add(row.exerciseName);
  }

  // 6. Supersets (Ben, 19 Oct): two rows already here become one, or one is taken apart. Rows only, never a set.
  const grouped = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'superset' && op.op !== 'split_superset') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    if (grouped.has(row.id)) {
      skip(`two superset changes to ${row.exerciseName}`);
      continue;
    }
    grouped.add(row.id);
    if (op.op === 'split_superset') {
      if (row.supersetGroup === null) {
      skip(`${row.exerciseName} isn’t in a superset`);
      continue;
    }
      steps.push({ type: 'split_superset', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, expectedVersion: input.args.baseVersion });
      const others = s.exercises.filter((e) => e.removed === undefined && e.id !== row.id && e.supersetGroup === row.supersetGroup).map((e) => e.exerciseName);
      lines.push({ change: 'edit', text: `Superset split: ${[row.exerciseName, ...others].join(', ')}`.slice(0, 200) });
      names.add(row.exerciseName);
      continue;
    }
    const other = liveRow(s, op.withSessionExerciseId);
    if (other === undefined) {
      skip('the coach named an exercise that isn’t in this workout');
      continue;
    }
    if (other.id === row.id) {
      skip(`${row.exerciseName} can’t be in a superset with itself`);
      continue;
    }
    const doneRow = [row, other].find((r) => !s.sets.some((x) => x.sessionExerciseId === r.id && x.status === 'pending'));
    if (doneRow !== undefined) {
      skip(`${doneRow.exerciseName} is done`);
      continue;
    }
    if (row.supersetGroup !== null && other.supersetGroup !== null && row.supersetGroup !== other.supersetGroup) {
      skip(`${row.exerciseName} is already in a superset`);
      continue;
    }
    if (row.supersetGroup !== null && row.supersetGroup === other.supersetGroup) continue;
    steps.push({ type: 'link_superset', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, withSessionExerciseId: other.id, expectedVersion: input.args.baseVersion });
    // Named in the order they'll run: the one further along first (review B1).
    const { lead } = supersetLinkSides(s.exercises, s.sets, row, other);
    const [first, second] = lead.some((e) => e.id === row.id) ? [row, other] : [other, row];
    lines.push({ change: 'edit', text: `Superset: ${first.exerciseName} + ${second.exerciseName}`.slice(0, 200) });
    names.add(row.exerciseName).add(other.exerciseName);
  }

  // 7. (Ben, 1 Nov) `set_main_lift`: today's main lift, at most once per edit; no set changes (the workout's own step).
  const mainOp = ops.find((op): op is Extract<EditTodayOp, { op: 'main' }> => op.op === 'main');
  if (mainOp !== undefined) {
    const row = liveRow(s, mainOp.sessionExerciseId);
    if (row === undefined) skip('the coach named an exercise that isn’t in this workout');
    else if (s.session.planDay === undefined) skip('only a plan workout has a main lift to change');
    else if (row.measurement !== 'reps') skip(`${row.exerciseName} isn’t a lift`);
    else if (s.session.planDay.mainLiftExerciseId === row.exerciseId) skip(`${row.exerciseName} is already the main lift`);
    else {
      steps.push({ type: 'set_main_lift', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, expectedVersion: input.args.baseVersion });
      lines.push({ change: 'edit', text: `${row.exerciseName} · main lift`.slice(0, 200) });
      names.add(row.exerciseName);
    }
  }

  // 8. (Ben, 8 Nov) Warm-ups today: added in the warm-up block by load (`add_warmup`), or the pending ramp replaced.
  for (const op of ops) {
    if (op.op !== 'warmups') continue;
    const r = coachWarmupSteps(s, op, { at: input.at, opId: input.opId, first: steps.length }, { asked: input.asked === true, ...(input.benLoads === undefined ? {} : { benLoads: input.benLoads }) });
    for (const n of r.notes) skip(n);
    if (r.steps.length === 0) continue;
    steps.push(...r.steps);
    if (r.line !== null) lines.push({ change: 'edit', text: r.line.slice(0, 200) });
    names.add(nameOf(op.sessionExerciseId));
  }

  // 9. (Ben, 8 Nov, coach parity) The workout's own manual controls: a set out, a set's type, rest or time, the sets'
  // order, a note, `+ Weight`. Built on the workout as the steps above leave it, so versions and new sets line up.
  const parity = ops.filter(isParityOp);
  if (parity.length > 0) {
    const now = afterSteps(s, steps, { at: input.at, opId: input.opId, baseVersion: input.args.baseVersion, actionId: input.actionId });
    const r = parityOpSteps(now, parity, { at: input.at, opId: input.opId, first: steps.length });
    for (const n of r.notes) skip(n);
    steps.push(...r.steps);
    lines.push(...r.lines);
    for (const n of r.names) names.add(n);
  }

  if (steps.length === 0) return reject(skipped[0] ?? 'no change');
  return {
    status: 'ok',
    command: { type: 'coach_edit_today', at: input.at, opId: input.opId, expectedVersion: input.args.baseVersion, actionId: input.actionId, steps },
    lines,
    exercises,
    added,
    names: [...names],
    guardNotes: notes.slice(0, 40),
    used,
    tradeOff: [],
  };
}

/** Working sets (warm-ups left out) per direct muscle group, across the live rows; done sets count. */
function directSets(s: SessionAggregate, groupOf: (exerciseId: string) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of s.exercises) {
    if (row.removed !== undefined) continue;
    const g = groupOf(row.exerciseId);
    if (g === null) continue;
    const n = s.sets.filter((x) => x.sessionExerciseId === row.id && x.setType !== 'warmup' && x.status !== 'deleted' && x.status !== 'skipped' && x.pairedWithSetId === null).length;
    if (n > 0) out.set(g, (out.get(g) ?? 0) + n);
  }
  return out;
}

/** Groups the edit takes above the per-session cap (and above where they already were). */
function volumeOver(before: SessionAggregate, command: CoachEditTodayCommand, groupOf: (exerciseId: string) => string | null): { group: string; before: number; after: number }[] {
  const r = reduceSession(before, command);
  if (!r.ok || r.duplicate === true) return [];
  const was = directSets(before, groupOf);
  const now = directSets(r.state, groupOf);
  const cap = COACH_JUDGEMENT_LIMITS.sessionDirectSets;
  return [...now.entries()].filter(([g, n]) => n > cap && n > (was.get(g) ?? 0)).map(([group, after]) => ({ group, before: was.get(group) ?? 0, after }));
}

/**
 * An offer's ops with each increase in a group cut back so the group stays within the cap (or where it already was).
 * Latest ops give way first. Pure.
 */
function trimToCap(s: SessionAggregate, ops: readonly EditTodayOp[], over: readonly { group: string; before: number; after: number }[], groupOf: (exerciseId: string) => string | null, exerciseOfAdd: (i: number) => string | null): (EditTodayOp | null)[] {
  const out: EditTodayOp[] = [...ops];
  const own = (rowId: string): { all: number; pending: number } => {
    const sets = s.sets.filter((x) => x.sessionExerciseId === rowId && x.setType !== 'warmup' && x.status !== 'deleted' && x.status !== 'skipped');
    return { all: sets.length, pending: sets.filter((x) => x.status === 'pending').length };
  };
  for (const o of over) {
    let excess = o.after - Math.max(COACH_JUDGEMENT_LIMITS.sessionDirectSets, o.before);
    for (let i = out.length - 1; i >= 0 && excess > 0; i -= 1) {
      const op = out[i];
      if (op === undefined) continue;
      const rowGroup = (id: string): string | null => {
        const row = liveRow(s, id);
        return row === undefined ? null : groupOf(row.exerciseId);
      };
      if (op.op === 'set_count' && rowGroup(op.sessionExerciseId) === o.group) {
        const more = op.workingSets - own(op.sessionExerciseId).all;
        const cut = Math.min(excess, Math.max(0, more));
        out[i] = { ...op, workingSets: op.workingSets - cut };
        excess -= cut;
      } else if (op.op === 'sets' && rowGroup(op.sessionExerciseId) === o.group) {
        const more = op.sets.length - own(op.sessionExerciseId).pending;
        const cut = Math.min(excess, Math.max(0, more), op.sets.length - 1);
        out[i] = { ...op, sets: op.sets.slice(0, op.sets.length - cut) };
        excess -= cut;
      } else if (op.op === 'add') {
        const id = exerciseOfAdd(i);
        if (id === null || groupOf(id) !== o.group) continue;
        const cut = Math.min(excess, op.workingSets);
        out[i] = { ...op, workingSets: op.workingSets - cut };
        excess -= cut;
      }
    }
  }
  // An add cut to nothing doesn't happen at all (null keeps the op indexes, for the exercise reads).
  return out.map((op) => (op.op === 'add' && op.workingSets <= 0 ? null : op));
}

const loadShare = (before: number, after: number, dir: ReturnType<typeof loadDirection>): number => (before <= 0 ? 0 : dir === 'resistance' ? after / before - 1 : 1 - after / before);

/**
 * The coach's own load targets held to the 20% step over each set's target (an offer); `lines`: Ben's ask past it
 * (asked). Only a load in the set's own unit and convention is compared. Pure.
 */
function loadSteps(s: SessionAggregate, ops: readonly EditTodayOp[], asked: boolean, benLoads: readonly BenLoad[] | undefined): { ops: EditTodayOp[]; notes: GuardNote[]; lines: string[] } {
  const notes: GuardNote[] = [];
  const lines = new Map<string, string>();
  const step = COACH_JUDGEMENT_LIMITS.loadStep;
  const fit = (set: WorkoutSet | undefined, t: Extract<EditTodayOp, { op: 'set' }>['target']): Extract<EditTodayOp, { op: 'set' }>['target'] => {
    const before = set?.planned.load ?? null;
    const load = t.load;
    const row = set === undefined ? undefined : liveRow(s, set.sessionExerciseId);
    if (set === undefined || row === undefined || before === null || load === null || load.unit !== before.unit || load.convention !== before.convention || load.convention === 'bodyweight' || before.value <= 0) return t;
    const dir = loadDirection(load.convention);
    const share = loadShare(before.value, load.value, dir);
    if (share <= step + 1e-9) return t;
    if (asked) {
      const prev = lines.get(row.id);
      if (prev === undefined || share > Number(prev.split('|')[0])) lines.set(row.id, `${String(share)}|${loadStepTradeOff(row.exerciseName, share)}`);
      return t;
    }
    if (isBenLoad(load, benLoads)) return t;
    const capped = dir === 'resistance' ? before.value * (1 + step) : before.value * (1 - step);
    const eq = equipmentOfRow(s.session.equipmentSnapshot, row);
    const r = eq === null ? null : roundToAvailableLoad({ value: capped, unit: load.unit, convention: load.convention }, eq, 'easier');
    const value = r !== null && r.ok ? r.load.value : Math.round(capped * 100) / 100;
    notes.push({ kind: 'capped', setIds: [set.id], text: `${row.exerciseName}: capped at ${String(value)} ${load.unit} · ${String(Math.round(step * 100))}% step`.slice(0, 300) });
    return { ...t, load: { ...load, value } };
  };
  const out = ops.map((op): EditTodayOp => {
    if (op.op === 'set') return { ...op, target: fit(s.sets.find((x) => x.id === op.setId), op.target) };
    if (op.op === 'sets') {
      const pending = s.sets.filter((x) => x.sessionExerciseId === op.sessionExerciseId && x.status === 'pending' && x.setType !== 'warmup').sort((a, b) => a.index - b.index);
      const last = pending[pending.length - 1] ?? [...s.sets].filter((x) => x.sessionExerciseId === op.sessionExerciseId && x.setType !== 'warmup' && x.status !== 'deleted').sort((a, b) => b.index - a.index)[0];
      return { ...op, sets: op.sets.map((t, i) => fit(pending[i] ?? last, t)) };
    }
    return op;
  });
  return { ops: out, notes, lines: [...lines.values()].map((l) => l.slice(l.indexOf('|') + 1)) };
}

/** The touched movements' pain holds, waved through on Ben's go-ahead. */
function goAhead(input: CoachEditInput): { input: CoachEditInput; lines: string[]; flags: { id: string; version: number }[] } {
  const s = input.aggregate;
  if (s === null || input.painGoAhead !== true || input.asked !== true) return { input, lines: [], flags: [] };
  const nowMs = toMs(input.at.utc);
  const touched: { id: string; name: string }[] = [];
  for (const [i, op] of input.args.ops.entries()) {
    const row = rowOf(s, op);
    const r = row === null ? undefined : liveRow(s, row);
    if (r !== undefined) touched.push({ id: r.exerciseId, name: r.exerciseName });
    const e = op.op === 'add' || op.op === 'swap' ? input.exercises.get(i)?.exercise : null;
    if (e != null) touched.push({ id: e.id, name: e.name });
  }
  const waved = new Set<string>();
  const lines: string[] = [];
  for (const t of touched) {
    const f = painFlagForMovement(input.painFlags, t, [t.id], nowMs, input.at.tz);
    if (f === null || waved.has(f.id)) continue;
    waved.add(f.id);
    lines.push(painGoAheadTradeOff(t.name, f.area === null ? null : PAIN_AREA_WORD[f.area]));
  }
  const said = input.messagePain !== null && (input.messagePain.mention === 'pain' || input.messagePain.mention === 'unclear');
  if (lines.length === 0 && (said || input.sessionPainUnspecified)) lines.push(painGoAheadTradeOff(touched[0]?.name ?? 'Today', input.messagePain?.bodyPart ?? null));
  return { input: { ...input, painFlags: input.painFlags.filter((f) => !waved.has(f.id)), messagePain: null, sessionPainUnspecified: false }, lines, flags: input.painFlags.filter((f) => waved.has(f.id)).map((f) => ({ id: f.id, version: f.version })) };
}

/**
 * `planCoachEdit`: `edit_today`'s ops checked and built as one `coach_edit_today` (see the file's header). (Ben, 8 Nov)
 * On Ben's own ask the coach's judgement limits give way and `tradeOff` says which one; on the coach's own offer the
 * 20% load step and the per-session cap trim it, with a line each.
 */
export function planCoachEdit(input: CoachEditInput): CoachEditPlan {
  const asked = input.asked === true;
  const offer = input.asked === false;
  const s = input.aggregate;
  if (s === null) return planOnce(input);
  const waved = goAhead(input);
  const loads = asked || offer ? loadSteps(s, waved.input.args.ops, asked, input.benLoads) : { ops: [...waved.input.args.ops], notes: [], lines: [] };
  let ready: CoachEditInput = { ...waved.input, args: { ...waved.input.args, ops: loads.ops } };
  let plan = planOnce(ready);
  const tradeOff = [...waved.lines, ...loads.lines];
  const groupOf = input.directGroupOf;
  if (plan.status === 'ok' && groupOf !== undefined) {
    const over = volumeOver(s, plan.command, groupOf);
    if (over.length > 0 && asked) tradeOff.push(...over.map((o) => volumeTradeOff(o.group, o.after)));
    else if (over.length > 0 && offer) {
      // The coach's own offer stays within the cap: each increase in that group is cut back, and said once.
      const trimmed = trimToCap(s, ready.args.ops, over, groupOf, (i) => {
        const op = ready.args.ops[i];
        return op?.op === 'add' ? (input.exercises.get(i)?.exercise?.id ?? op.exerciseId) : null;
      });
      const capNotes: GuardNote[] = over.map((o) => ({ kind: 'structural_dropped', setIds: [], text: `Not done: ${o.group} above ${String(COACH_JUDGEMENT_LIMITS.sessionDirectSets)} sets a session`.slice(0, 300) }));
      // An add the trim dropped shifts the op indexes: the exercise reads follow their ops.
      const ops: EditTodayOp[] = [];
      const kept = new Map<number, CoachEditExerciseInputs | null>();
      trimmed.forEach((op, i) => {
        if (op === null) return;
        if (input.exercises.has(i)) kept.set(ops.length, input.exercises.get(i) ?? null);
        ops.push(op);
      });
      ready = { ...ready, args: { ...ready.args, ops }, exercises: kept };
      plan = ops.length === 0 ? { status: 'rejected', failure: `${over[0]?.group ?? 'that group'} is at ${String(COACH_JUDGEMENT_LIMITS.sessionDirectSets)} sets a session`, guardNotes: capNotes } : planOnce(ready);
      if (plan.status !== 'stale') plan = { ...plan, guardNotes: [...plan.guardNotes, ...capNotes].slice(0, 40) };
    }
  }
  // Warm-ups past the usual count, on his ask.
  if (plan.status === 'ok' && asked) {
    for (const op of ready.args.ops) {
      if (op.op !== 'warmups') continue;
      const after = afterSteps(s, plan.command.steps, { at: input.at, opId: input.opId, baseVersion: input.args.baseVersion, actionId: input.actionId });
      const n = after.sets.filter((x) => x.sessionExerciseId === op.sessionExerciseId && x.setType === 'warmup' && x.status !== 'deleted' && x.status !== 'skipped').length;
      if (n > COACH_JUDGEMENT_LIMITS.warmups) tradeOff.push(warmupTradeOff(liveRow(s, op.sessionExerciseId)?.exerciseName ?? 'That exercise', n));
    }
  }
  if (plan.status === 'stale') return plan;
  if (plan.status === 'rejected') return { ...plan, guardNotes: [...plan.guardNotes, ...loads.notes].slice(0, 40) };
  return { ...plan, guardNotes: [...loads.notes, ...plan.guardNotes].slice(0, 40), tradeOff: [...new Set(tradeOff)].slice(0, 4).map((t) => t.slice(0, 200)), ...(waved.flags.length > 0 ? { wavedFlags: waved.flags } : {}) };
}

const RAMP_CONVENTIONS: ReadonlySet<string> = new Set(['total', 'per_hand', 'stack']);
const fmtLoad = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * (Ben, 8 Nov) One `warmups` op as the workout's own commands. Pure. Each load is rounded down to the row's item
 * (rule 4) and must sit under the first working load; a load already among the warm-ups that stay isn't added twice;
 * at most `BUILD_LIMITS.maxWarmups` in all. `replace` takes out pending warm-ups not asked for; done ones stay (rule 2).
 * Not in a superset (a warm-up there would count as a round, as `＋ Warm-up`).
 */
export function coachWarmupSteps(
  s: SessionAggregate,
  op: Extract<EditTodayOp, { op: 'warmups' }>,
  /** `first`: the index of this op's first step in the whole edit (step op IDs follow it). */
  ids: { at: ZonedTimestamp; opId: string; first: number },
  /**
   * (Ben, 8 Nov) `asked`: Ben asked for these warm-ups himself, so the usual count gives way (up to the data ceiling).
   * `benLoads`: weights he named this turn: such a warm-up is kept as he typed it (only a machine's max moves it, rule
   * 4) and the gym learns it with the change; the coach's own loads are rounded down to the kit, under the working load.
   */
  opts: { asked?: boolean; benLoads?: readonly BenLoad[] } = {},
): { steps: CoachEditStep[]; notes: string[]; line: string | null } {
  const notes: string[] = [];
  const none = (note: string) => ({ steps: [], notes: [note], line: null });
  const row = liveRow(s, op.sessionExerciseId);
  if (row === undefined) return none('the coach named an exercise that isn’t in this workout');
  if (row.supersetGroup !== null) return none(`no warm-ups inside a superset: ${row.exerciseName}`);
  const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted' && x.status !== 'skipped').sort((a, b) => a.index - b.index);
  const loadOf = (x: WorkoutSet) => x.actual?.load ?? x.draft?.load ?? x.planned.load;
  const work = own.find(working);
  const top = work === undefined ? null : loadOf(work);
  const eq = equipmentOfRow(s.session.equipmentSnapshot, row);
  if (top === null || eq === null || !RAMP_CONVENTIONS.has(top.convention) || loadDirection(top.convention) !== 'resistance' || top.convention !== eq.loadConvention || top.unit !== row.unit) {
    return none(`${row.exerciseName} has no working load to warm up to`);
  }
  const roundDown = (v: number): number | null => {
    const r = roundToAvailableLoad({ value: v, unit: top.unit, convention: top.convention }, eq, 'down');
    return r.ok && r.load.value <= v + 1e-9 ? r.load.value : null;
  };
  const warm = own.filter((x) => x.setType === 'warmup');
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const wanted: { load: number; reps: number; typed?: true }[] = [];
  for (const w of op.sets) {
    if (w.load > 0 && isBenLoad({ value: w.load, unit: top.unit, convention: top.convention }, opts.benLoads)) {
      // His own weight: as typed, never past the item's max (rule 4).
      const r = roundToAvailableLoad({ value: w.load, unit: top.unit, convention: top.convention }, eq, 'nearest');
      const v = r.ok && r.bounded === 'max' ? r.load.value : w.load;
      if (r.ok && r.bounded === 'max') notes.push(`${fmtLoad(w.load)} ${top.unit} is past the most ${row.exerciseName}’s item goes to: ${fmtLoad(v)} ${top.unit}`);
      if (!wanted.some((x) => same(x.load, v))) wanted.push({ load: v, reps: w.reps, ...(r.ok && r.bounded === 'max' ? {} : { typed: true as const }) });
      continue;
    }
    const v = roundDown(w.load);
    if (v === null || v <= 0) {
      notes.push(`a ${fmtLoad(w.load)} ${top.unit} warm-up on ${row.exerciseName}`);
      continue;
    }
    if (v >= top.value - 1e-6) {
      notes.push(`${fmtLoad(w.load)} ${top.unit} isn’t below ${row.exerciseName}’s ${fmtLoad(top.value)} ${top.unit}`);
      continue;
    }
    if (!wanted.some((x) => same(x.load, v))) wanted.push({ load: v, reps: w.reps });
  }
  // Pending warm-ups at a load asked for stay as they are; with `replace`, the other pending ones go.
  const pendingWarm = warm.filter((x) => x.status === 'pending');
  const drop = op.replace ? pendingWarm.filter((x) => !wanted.some((w) => same(w.load, loadOf(x)?.value ?? -1))) : [];
  const stays = warm.filter((x) => !drop.includes(x));
  const add = wanted.filter((w) => !stays.some((x) => same(loadOf(x)?.value ?? -1, w.load))).sort((a, b) => a.load - b.load);
  const most = opts.asked === true ? COACH_HARD_CEILINGS.warmupsPerExercise : BUILD_LIMITS.maxWarmups;
  const room = Math.max(0, most - stays.length);
  if (add.length > room) notes.push(`at most ${String(most)} warm-ups on ${row.exerciseName}`);
  const adding = add.slice(0, room);
  if (adding.length === 0 && drop.length === 0) {
    return { steps: [], notes: notes.length > 0 ? notes : [`${row.exerciseName}’s warm-ups are already that`], line: null };
  }
  const steps: CoachEditStep[] = [];
  const nextOpId = (): string => coachEditStepOpId(ids.opId, ids.first + steps.length);
  for (const x of drop) steps.push({ type: 'delete_set', at: ids.at, opId: nextOpId(), setId: x.id, expectedSetVersion: x.version });
  const restS = warm[0]?.rest.seconds ?? BUILDER_REST_DEFAULTS.warmup;
  for (const w of adding) {
    steps.push({
      type: 'add_warmup',
      at: ids.at,
      opId: nextOpId(),
      sessionExerciseId: row.id,
      newSetId: deriveId(`${ids.opId}:warmup:${row.id}:${fmtLoad(w.load)}`),
      planned: { load: { value: w.load, unit: top.unit, convention: top.convention }, reps: { min: w.reps, max: w.reps }, durationS: null, rpe: null, rir: null },
      restS,
      expectedVersion: s.session.version,
      ...(w.typed === true ? { loadAsTyped: true as const } : {}),
    });
  }
  const after = [...stays.map((x) => loadOf(x)?.value ?? 0), ...adding.map((w) => w.load)].filter((v) => v > 0).sort((a, b) => a - b);
  return { steps, notes, line: `${row.exerciseName} warm-ups: ${after.map(fmtLoad).join(', ')} ${top.unit}` };
}

/**
 * Review coach-v3 B1 (rule 9): Ben's `Adjust` on a stored offer, checked against pain as it is now.
 * A flag can be set after the offer (the workout's `Pain` tap saves a flag, not the workout, so its
 * version doesn't move). Null when the stored command may still apply; otherwise the line saying
 * why not. Held: a higher target or more sets on a flagged movement (or on any movement when the
 * check-in said pain with none chosen), an add of or swap to a flagged movement, and a swap away
 * from a row flagged after the offer (`offeredAtUtc`: its substitute's targets weren't held for
 * that pain; a swap offered because of a flag already there was planned with it).
 */
export function coachEditPainHold(input: { aggregate: SessionAggregate; command: CoachEditTodayCommand; painFlags: readonly PainFlag[]; sessionPainUnspecified: boolean; offeredAtUtc: string; at: ZonedTimestamp }): string | null {
  const s = input.aggregate;
  const nowMs = toMs(input.at.utc);
  const tz = input.at.tz;
  const flagOn = (id: string, name: string): PainFlag | null => painFlagForMovement(input.painFlags, { id, name }, [id], nowMs, tz);
  const said = (name: string, f: PainFlag): string => `${name}: ${f.area === null ? '' : `${PAIN_AREA_WORD[f.area]} `}flagged ${dayMonthText(f.reportedAt.utc, f.reportedAt.tz)}`;
  const rowOfSet = (setId: string): SessionExercise | undefined => {
    const set = s.sets.find((x) => x.id === setId);
    return set === undefined ? undefined : s.exercises.find((e) => e.id === set.sessionExerciseId);
  };
  const harder = (row: SessionExercise): string | null => {
    const f = flagOn(row.exerciseId, row.exerciseName);
    if (f !== null) return said(row.exerciseName, f);
    return input.sessionPainUnspecified ? 'you mentioned pain today' : null;
  };
  for (const step of input.command.steps) {
    switch (step.type) {
      case 'adjust_pending_targets': {
        for (const c of step.changes) {
          const set = s.sets.find((x) => x.id === c.setId);
          const row = rowOfSet(c.setId);
          if (set === undefined || row === undefined) continue;
          const before = { load: set.planned.load, reps: set.planned.reps, ...(set.planned.rpe !== null ? { rpe: set.planned.rpe } : {}) };
          if (!isIncrease(before, c.target, row.loadConvention)) continue;
          const why = harder(row);
          if (why !== null) return why;
        }
        for (const a of step.addSets) {
          const row = rowOfSet(a.copyFromSetId);
          if (row === undefined) continue;
          const why = harder(row);
          if (why !== null) return why;
        }
        break;
      }
      case 'swap_exercise': {
        const to = flagOn(step.exercise.exerciseId, step.exercise.name);
        if (to !== null) return said(step.exercise.name, to);
        const from = s.exercises.find((e) => e.id === step.sessionExerciseId);
        const since = input.painFlags.filter((f) => toMs(f.reportedAt.utc) > toMs(input.offeredAtUtc));
        const was = from === undefined ? null : painFlagForMovement(since, { id: from.exerciseId, name: from.exerciseName }, [from.exerciseId], nowMs, tz);
        if (from !== undefined && was !== null) return said(from.exerciseName, was);
        break;
      }
      case 'add_exercise': {
        const f = flagOn(step.exercise.exerciseId, step.exercise.name);
        if (f !== null) return said(step.exercise.name, f);
        break;
      }
      case 'edit_planned_set': {
        // (2 Nov, coachplan) Mostly a rest change; one that raises the target load or reps is held like an adjust (rule 9).
        const set = s.sets.find((x) => x.id === step.setId);
        const row = rowOfSet(step.setId);
        if (set === undefined || row === undefined) break;
        const p = step.patch;
        if ((p.load === undefined || p.load === null) && (p.reps === undefined || p.reps === null)) break;
        const before = { load: set.planned.load, reps: set.planned.reps, ...(set.planned.rpe !== null ? { rpe: set.planned.rpe } : {}) };
        const after = { load: p.load ?? set.planned.load, reps: p.reps ?? set.planned.reps, ...(set.planned.rpe !== null ? { rpe: set.planned.rpe } : {}) };
        if (!isIncrease(before, after, row.loadConvention)) break;
        const why = harder(row);
        if (why !== null) return why;
        break;
      }
      case 'remove_exercise':
      case 'skip_exercise':
      case 'move_exercise':
      case 'link_superset':
      case 'split_superset':
      case 'set_main_lift':
      case 'add_warmup':
      case 'delete_set':
      case 'reorder_sets':
      case 'set_note':
      case 'set_load_mode':
        // (Ben, 8 Nov) A warm-up added or taken out, the sets' order, a note or `+ Weight` never makes the working sets harder.
        break;
    }
  }
  return null;
}
