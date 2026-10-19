import { coachEditStepOpId, type ActionDetail, type CoachEditStep, type CoachEditTodayCommand, type CommandOf, type EditTodayArgs, type EditTodayOp, type Exercise, type ExerciseTargetChanges, type GuardNote, type PainFlag, type SessionAggregate, type SessionExercise, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { isIncrease, validateTodayAdjustment, type AdjustIntent, type MessagePain } from '../coach/adjust';
import { dayMonthText } from '../display';
import { painFlagForMovement, rowIsMovement } from '../exercise-identity';
import { PAIN_AREA_WORD } from '../pain-flags';
import { deriveId } from '../stable';
import { toMs } from '../time';
import { checkCoachAdd, type CoachAddInput } from './coach-add';
import { currentGymEquipment } from './equipment-snapshot';
import { buildSwapExerciseCommand, midSwapSlot, swapPainCarry } from './mid-swap';
import { doableHere, substituteTargets } from './substitutes';

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
 *
 * A structural op that is refused refuses the whole edit (nothing half applies). Two ops on the same
 * row that would fight (a swap and a set change, two moves) are refused too. IDs derive from the
 * opId, so a replay builds the same rows. Steps run in a fixed order: targets and counts, swaps,
 * removals, adds, moves.
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
    }
  | { status: 'stale'; guardNotes: GuardNote[] }
  | { status: 'rejected'; failure: string; guardNotes: GuardNote[] };

const working = (s: WorkoutSet): boolean => s.setType !== 'warmup';
const liveRow = (state: SessionAggregate, id: string): SessionExercise | undefined => state.exercises.find((e) => e.id === id && e.removed === undefined);

/** The row each op is about (for conflicts); null for an add. */
function rowOf(state: SessionAggregate, op: EditTodayOp): string | null {
  switch (op.op) {
    case 'set':
      return state.sets.find((s) => s.id === op.setId)?.sessionExerciseId ?? null;
    case 'set_count':
    case 'swap':
    case 'remove':
    case 'move':
      return op.sessionExerciseId;
    case 'add':
      return null;
  }
}

/** Rows an op leans on without changing (an add's position or partner, a move's anchor). */
function anchorsOf(op: EditTodayOp): string[] {
  if (op.op === 'add') return [op.afterSessionExerciseId, op.supersetWithSessionExerciseId].filter((x): x is string => x !== null);
  if (op.op === 'move') return op.afterSessionExerciseId === null ? [] : [op.afterSessionExerciseId];
  return [];
}

export function planCoachEdit(input: CoachEditInput): CoachEditPlan {
  const s = input.aggregate;
  const notes: GuardNote[] = [];
  const reject = (failure: string): CoachEditPlan => ({ status: 'rejected', failure: failure.slice(0, 200), guardNotes: notes });
  if (s === null || s.session.status !== 'active' || s.session.version !== input.args.baseVersion) return { status: 'stale', guardNotes: notes };
  const ops = input.args.ops;
  const nameOf = (id: string): string => s.exercises.find((e) => e.id === id)?.exerciseName ?? 'that exercise';

  // An offer's Adjust about one row: that row's targets and set count only (review S1).
  const only = input.onlySessionExerciseId ?? null;
  if (only !== null && ops.some((op) => (op.op !== 'set' && op.op !== 'set_count') || rowOf(s, op) !== only)) return reject(`only ${nameOf(only)}`);

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
    if (op.op === 'set_count') {
      if (counted.has(op.sessionExerciseId)) return reject(`two set counts for ${nameOf(op.sessionExerciseId)}`);
      counted.add(op.sessionExerciseId);
    }
    if (op.op === 'move') {
      if (moved.has(op.sessionExerciseId)) return reject(`two moves of ${nameOf(op.sessionExerciseId)}`);
      moved.add(op.sessionExerciseId);
    }
    const id = op.op === 'add' ? op.exerciseId : op.op === 'swap' ? op.toExerciseId : null;
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

  const steps: CoachEditStep[] = [];
  const nextOpId = (): string => coachEditStepOpId(input.opId, steps.length);
  const lines: Line[] = [];
  const names = new Set<string>();
  const used: Exercise[] = [];
  const added: NonNullable<Extract<ActionDetail, { kind: 'edit_today' }>['added']> = [];
  let exercises: ExerciseTargetChanges[] = [];

  // 1. Targets and set counts: one `adjust_pending_targets` step.
  const setOps = ops.filter((op): op is Extract<EditTodayOp, { op: 'set' }> => op.op === 'set');
  const countOps = ops.filter((op): op is Extract<EditTodayOp, { op: 'set_count' }> => op.op === 'set_count');
  if (setOps.length > 0 || countOps.length > 0) {
    const rows = new Map<string, { sets: { setId: string; target: Extract<EditTodayOp, { op: 'set' }>['target'] }[]; more: number }>();
    const entry = (id: string) => rows.get(id) ?? rows.set(id, { sets: [], more: 0 }).get(id) ?? { sets: [], more: 0 };
    for (const op of setOps) entry(rowOf(s, op) ?? '').sets.push({ setId: op.setId, target: op.target });
    const fewer = new Map<string, WorkoutSet[]>();
    const countLines: Line[] = [];
    for (const op of countOps) {
      const row = liveRow(s, op.sessionExerciseId);
      if (row === undefined) return reject('the coach named an exercise that isn’t in this workout');
      const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted' && x.status !== 'skipped' && working(x)).sort((a, b) => a.index - b.index);
      const done = own.filter((x) => x.status !== 'pending').length;
      if (op.workingSets < done) return reject(`${row.exerciseName}: ${String(done)} ${done === 1 ? 'set is' : 'sets are'} already done`);
      if (op.workingSets === own.length) continue;
      if (op.workingSets > own.length) entry(row.id).more = op.workingSets - own.length;
      else {
        const pending = own.filter((x) => x.status === 'pending' && x.pairedWithSetId === null);
        fewer.set(row.id, pending.slice(pending.length - (own.length - op.workingSets)));
      }
      countLines.push({ change: 'edit', text: `${row.exerciseName}: ${String(own.length)} → ${String(op.workingSets)} sets` });
      names.add(row.exerciseName);
    }
    const adjustRows = [...rows.entries()].filter(([, r]) => r.sets.length > 0 || r.more > 0).map(([sessionExerciseId, r]) => ({
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
          });
    if (v?.status === 'stale') return { status: 'stale', guardNotes: notes };
    if (v !== null) notes.push(...v.guardNotes);
    const plans = v?.status === 'apply' ? v.exercises : [];
    // A set count the checks held (pain, a lighter session) is refused rather than quietly dropped.
    for (const [rowId, r] of rows) {
      if (r.more > 0 && !plans.some((p) => p.sessionExerciseId === rowId && p.added !== null)) {
        return reject(v?.status === 'unchanged' ? v.outcome.replace(/\s*(?:Sets unchanged|Nothing changed)\.?$/i, '') : `no more sets of ${nameOf(rowId)}`);
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
        changes.push({ setId: c.setId, target: c.after });
        out.changes.push(c);
      }
      if (p.added !== null) {
        const more = rows.get(p.sessionExerciseId)?.more ?? 1;
        for (let k = 0; k < more; k += 1) {
          const setId = k === 0 ? p.added.setId : deriveId(`coach-edit-set:${input.opId}:${p.sessionExerciseId}:${String(k)}`);
          addSets.push({ newSetId: setId, copyFromSetId: p.added.copyFromSetId, target: p.added.after });
          out.changes.push({ setId, setNumber: p.added.setNumber + k, before: null, after: p.added.after });
        }
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
    } else if (ops.every((op) => op.op === 'set' || op.op === 'set_count')) {
      // Nothing structural, and no target changed: the checks' own line.
      return reject(v?.status === 'unchanged' ? v.outcome.replace(/\s*(?:Sets unchanged|Nothing changed)\.?$/i, '') : 'no change');
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
    if (row === undefined) return reject('the coach named an exercise that isn’t in this workout');
    const slot = midSwapSlot(s, row.id);
    if (slot === null) return reject(`nothing left to swap: ${row.exerciseName} is done`);
    const got = input.exercises.get(i) ?? null;
    const exercise = got?.exercise ?? null;
    if (got === null || exercise === null) return reject('it isn’t one of your exercises');
    const ids = [exercise.id, ...(got.sameMovementIds ?? [])];
    if (exercise.id === row.exerciseId || s.exercises.some((e) => e.removed === undefined && rowIsMovement(e, exercise, ids))) return reject(`${exercise.name} is already in today’s workout`);
    if (exercise.measurement !== row.measurement) return reject(`${exercise.name} is measured differently`);
    if (!doableHere(exercise, { ...got.substitute.gym, equipment: currentGymEquipment(s.session) })) return reject(`nothing for ${exercise.name} at ${got.substitute.gym.name}`);
    const pain = flagged(exercise, ids);
    if (pain !== null) return reject(pain);
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
    if (!built.ok) return reject(built.reason === 'measurement' ? `${exercise.name} is measured differently` : `nothing left to swap: ${row.exerciseName} is done`);
    steps.push(built.command);
    used.push(exercise);
    lines.push({ change: 'swap', text: `${row.exerciseName} → ${exercise.name}` });
    names.add(row.exerciseName).add(exercise.name);
  }

  // 3. Removals: pending sets only.
  for (const op of ops) {
    if (op.op !== 'remove') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) return reject('the coach named an exercise that isn’t in this workout');
    const own = s.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted');
    if (!own.some((x) => x.status === 'pending')) return reject(`${row.exerciseName} is done`);
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
    if (got === null || got.exercise === null) return reject('it isn’t one of your exercises');
    const opId = nextOpId();
    const after = op.afterSessionExerciseId === null ? null : (placedAfter.get(op.afterSessionExerciseId) ?? op.afterSessionExerciseId);
    const check = checkCoachAdd({
      aggregate: s,
      args: { baseVersion: input.args.baseVersion, exerciseId: op.exerciseId, workingSets: op.workingSets, reps: op.reps, workSeconds: op.workSeconds, distanceMetres: op.distanceMetres ?? null, targetRpe: op.targetRpe, afterSessionExerciseId: op.afterSessionExerciseId, supersetWithSessionExerciseId: op.supersetWithSessionExerciseId, reason: input.args.reason },
      ...got,
      opId,
      at: input.at,
    });
    if (check.status === 'stale') return { status: 'stale', guardNotes: notes };
    if (check.status === 'rejected') {
      notes.push(...check.guardNotes);
      return reject(`${check.exerciseName ?? 'that exercise'}: ${check.failure}`);
    }
    const command = after === null || op.supersetWithSessionExerciseId !== null ? check.command : { ...check.command, afterSessionExerciseId: after };
    if (op.afterSessionExerciseId !== null) placedAfter.set(op.afterSessionExerciseId, command.newSessionExerciseId);
    steps.push(command);
    used.push(got.exercise);
    const sum = check.summary;
    notes.push(...check.guardNotes.map((g) => ({ ...g, text: `${sum.exerciseName}: ${g.text}`.slice(0, 300) })));
    added.push({ exerciseName: sum.exerciseName, sets: sum.sets, target: sum.target, durationS: sum.durationS, afterName: sum.afterName, supersetWithName: sum.supersetWithName });
    const where = sum.supersetWithName !== null ? ` · superset with ${sum.supersetWithName}` : sum.afterName !== null ? ` · after ${sum.afterName}` : '';
    lines.push({ change: 'add', text: `Added ${sum.exerciseName} · ${String(sum.sets)} ${sum.sets === 1 ? 'set' : 'sets'}${where}`.slice(0, 200) });
    names.add(sum.exerciseName);
  }

  // 5. Moves.
  for (const op of ops) {
    if (op.op !== 'move') continue;
    const row = liveRow(s, op.sessionExerciseId);
    if (row === undefined) return reject('the coach named an exercise that isn’t in this workout');
    if (!s.sets.some((x) => x.sessionExerciseId === row.id && x.status === 'pending')) return reject(`${row.exerciseName} is done`);
    const after = op.afterSessionExerciseId === null ? null : liveRow(s, op.afterSessionExerciseId);
    if (after === undefined) return reject('the coach named an exercise that isn’t in this workout');
    if (after !== null && after.id === row.id) return reject(`${row.exerciseName} can’t go after itself`);
    steps.push({ type: 'move_exercise', at: input.at, opId: nextOpId(), sessionExerciseId: row.id, afterSessionExerciseId: after?.id ?? null, expectedVersion: input.args.baseVersion });
    lines.push({ change: 'reorder', text: after === null ? `${row.exerciseName} moved first` : `${row.exerciseName} moved after ${after.exerciseName}` });
    names.add(row.exerciseName);
  }

  if (steps.length === 0) return reject('no change');
  return {
    status: 'ok',
    command: { type: 'coach_edit_today', at: input.at, opId: input.opId, expectedVersion: input.args.baseVersion, actionId: input.actionId, steps },
    lines,
    exercises,
    added,
    names: [...names],
    guardNotes: notes.slice(0, 40),
    used,
  };
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
      case 'remove_exercise':
      case 'skip_exercise':
      case 'move_exercise':
        break;
    }
  }
  return null;
}
