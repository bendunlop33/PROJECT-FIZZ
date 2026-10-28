import { coachEditPainHold, currentGymEquipment, deriveId, doableHere, namedWeightGymEdit, namedWeights, planCoachEdit, type CoachEditExerciseInputs } from '@fizz/domain';
import type { ActionDetail, ActionRecord, CoachEditTodayCommand, EditTodayOp, EquipmentInstance, Exercise, GuardNote, PainFlag, SessionAggregate, ZonedTimestamp } from '@fizz/schemas';
import { actionIdFor, newActionRecord, type CoachWriteStore, type ToolCallContext, type ToolExecutor, type ToolResult } from './executors';

/**
 * Coach v3 (ADR 0027, Ben 18 Oct: "Why isn't the coach more dynamic like AI would be?"): one
 * general tool for today's live workout, `edit_today`, in place of `adjust_pending_sets` and
 * `add_exercise_today`. The model sends ops (swap, add, remove, move, set count, set targets);
 * `planCoachEdit` checks every one against the workout, its gym's equipment and pain flags and
 * builds the workout's own commands as one `coach_edit_today` operation, written with its record
 * in one transaction, refused when the workout moved on since the coach read it (rule 5),
 * idempotent on the opId. Done sets are never touched (rule 2).
 *
 * When Ben didn't ask (rule 3, `verifyAsked`), the turn runs this with `propose`: the same checks,
 * and the exact command is saved as a `proposed` record, never applied. His `Adjust` applies that
 * stored command (`acceptEditOffer`) with no model call, refused as stale when the workout moved
 * on since the offer (rule 5). Undo (Ben's tap) is `revert_coach_edit`, all or nothing.
 */

export interface EditTodayDeps {
  store: CoachWriteStore;
  /** The active workout as it is now (read fresh for each call). */
  loadSession(): Promise<SessionAggregate | null>;
  painFlags(): Promise<readonly PainFlag[]>;
  sessionPainUnspecified: boolean;
  gymName: string | null;
  /** Ben's `Adjust` on an offer about one row (CA1): only that row's targets and set count may change. */
  onlySessionExerciseId?: string | null;
  /** The built-in rule's target RPE per session exercise (review target-rpe S1). */
  ruleTargetRpe?: (s: SessionAggregate) => Promise<Readonly<Record<string, number>>>;
  /**
   * Local reads for one exercise an `add` or `swap` names, at the workout's current gym (the add
   * tool's inputs). `exerciseUnsaved`: a catalogue exercise not yet in Ben's exercises, saved with
   * the edit's own write. Absent: adds and swaps are refused.
   */
  inputs?: (exerciseId: string, aggregate: SessionAggregate) => Promise<(CoachEditExerciseInputs & { exerciseUnsaved?: boolean }) | null>;
  /** After a write: the workout screen and rest alerts follow the new state. */
  onSessionChanged?: (aggregate: SessionAggregate) => void;
  /**
   * ADR 0038 (Ben, 28 Oct: "It gets very caught up in whether I have equipment"): an add or swap names an
   * exercise this gym's profile has nothing for. The app learns the kit (the gym gains that equipment, with its
   * own card and Undo) and refreshes today's snapshot, like the manual "learn as you train". Its record, or null
   * when nothing could be learned (the exercise is then added with no item, loads as given).
   */
  learnKit?: (exercise: Exercise, aggregate: SessionAggregate, ctx: ToolCallContext) => Promise<ActionRecord | null>;
  /**
   * (Ben, 28 Oct: "if i name a weight specifically it probably means its there") The gym's saved items: a weight Ben
   * named that its profile can't make (a 31 kg dumbbell, a plate) is learned with the change, quietly, and its Undo
   * takes it back. Absent: nothing learned.
   */
  gymItems?: (gymId: string) => Promise<readonly EquipmentInstance[]>;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';

function exerciseIdOf(op: EditTodayOp): string | null {
  return op.op === 'add' ? op.exerciseId : op.op === 'swap' ? op.toExerciseId : null;
}

/** The reads for every add and swap op, by op index; unsaved catalogue exercises by ID. */
async function readInputs(deps: Pick<EditTodayDeps, 'inputs'>, ops: readonly EditTodayOp[], aggregate: SessionAggregate): Promise<{ byOp: Map<number, CoachEditExerciseInputs | null>; unsaved: Map<string, Exercise> }> {
  const byOp = new Map<number, CoachEditExerciseInputs | null>();
  const unsaved = new Map<string, Exercise>();
  for (const [i, op] of ops.entries()) {
    const id = exerciseIdOf(op);
    if (id === null) continue;
    const got = deps.inputs === undefined ? null : await deps.inputs(id, aggregate);
    if (got === null) {
      byOp.set(i, null);
      continue;
    }
    const { exerciseUnsaved, ...rest } = got;
    byOp.set(i, rest);
    if (exerciseUnsaved === true && got.exercise !== null) unsaved.set(got.exercise.id, got.exercise);
  }
  return { byOp, unsaved };
}

function editDetail(sessionId: string, baseVersion: number, over: Partial<Extract<ActionDetail, { kind: 'edit_today' }>> = {}): Extract<ActionDetail, { kind: 'edit_today' }> {
  return { kind: 'edit_today', sessionId, baseVersion, lines: [], exercises: [], names: [], command: null, ...over };
}

async function recordOnly(store: CoachWriteStore, ownerId: string, action: ActionRecord, what: string): Promise<ToolResult> {
  const r = await store.commit(ownerId, { kind: 'record', action });
  if (r.status === 'conflict') throw new Error(`Could not record the ${what}`);
  return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
}

export function createEditTodayExecutor(deps: EditTodayDeps): ToolExecutor {
  return async (call, ctx: ToolCallContext): Promise<ToolResult> => {
    if (call.tool !== 'edit_today') throw new TypeError(call.tool);
    const a = call.args;
    const aggregate = await deps.loadSession();
    const sessionId = aggregate?.session.id ?? NO_ID;
    const refuse = (status: 'stale' | 'rejected', failure: string | null, guardNotes: GuardNote[] = [], opId = ctx.opId): Promise<ToolResult> =>
      recordOnly(deps.store, ctx.ownerId, newActionRecord({ ...ctx, opId }, editDetail(sessionId, a.baseVersion), { status, failure: status === 'stale' ? null : failure, guardNotes, reason: a.reason }), 'refused edit');
    if (aggregate === null) return refuse('stale', null);
    // ADR 0038: a stale call gets the version as it is now, so the model can call once more against it.
    const staleNow = async (guardNotes: GuardNote[], opId = ctx.opId): Promise<ToolResult> => {
      const r = await refuse('stale', null, guardNotes, opId);
      const now = await deps.loadSession().catch(() => null);
      return r.kind === 'action' && now !== null && now.session.status === 'active' ? { ...r, retry: { baseVersion: now.session.version } } : r;
    };
    let current = aggregate;
    let args = a;
    const also: ActionRecord[] = [];
    const withAlso = (r: ToolResult): ToolResult => (r.kind === 'action' && also.length > 0 ? { ...r, also } : r);
    let first = await readInputs(deps, a.ops, current);
    // ADR 0038: learn the kit for an add or swap the gym's profile can't do yet (not on an offer: that waits for Ben).
    if (ctx.propose !== true && deps.learnKit !== undefined && current.session.version === a.baseVersion) {
      const missing = new Map<string, Exercise>();
      for (const got of first.byOp.values()) {
        const e = got?.exercise ?? null;
        if (e !== null && got !== null && !doableHere(e, { ...got.substitute.gym, equipment: currentGymEquipment(current.session) })) missing.set(e.id, e);
      }
      for (const e of missing.values()) {
        const rec = await deps.learnKit(e, current, ctx).catch(() => null);
        if (rec !== null) also.push(rec);
      }
      if (also.some((r) => r.status === 'committed')) {
        const fresh = await deps.loadSession().catch(() => null);
        // Today's own refresh moved the version: the call is rebased on it, nothing else changed in between.
        if (fresh !== null && fresh.session.status === 'active') {
          current = fresh;
          args = { ...a, baseVersion: fresh.session.version };
          first = await readInputs(deps, a.ops, current);
        }
      }
    }
    const { byOp, unsaved } = first;
    const plan = planCoachEdit({
      aggregate: current,
      args,
      intent: ctx.intent,
      opId: ctx.opId,
      actionId: actionIdFor(ctx.opId),
      at: ctx.now,
      painFlags: await deps.painFlags(),
      sessionPainUnspecified: deps.sessionPainUnspecified,
      gymName: deps.gymName,
      messagePain: ctx.messagePain,
      ruleTargetRpe: deps.ruleTargetRpe ? await deps.ruleTargetRpe(current).catch(() => undefined) : undefined,
      onlySessionExerciseId: deps.onlySessionExerciseId ?? null,
      exercises: byOp,
      benLoads: namedWeights(ctx.benWords),
      kitOptional: true,
    });
    if (plan.status === 'stale') return withAlso(await staleNow(plan.guardNotes));
    if (plan.status === 'rejected') return withAlso(await refuse('rejected', plan.failure, plan.guardNotes));
    const base = editDetail(sessionId, args.baseVersion, { lines: plan.lines, exercises: plan.exercises, ...(plan.added.length > 0 ? { added: plan.added } : {}), names: plan.names, command: plan.command });
    // Rule 3: an offer saves exactly what would apply, and nothing else.
    if (ctx.propose === true) {
      return recordOnly(deps.store, ctx.ownerId, newActionRecord(ctx, base, { status: 'proposed', guardNotes: plan.guardNotes, reason: a.reason }), 'offer');
    }
    // (Ben, 28 Oct) A weight he named that the gym's profile can't make: the gym learns it with the change (no line).
    const gymId = current.session.gymId;
    const items = gymId === null || deps.gymItems === undefined ? [] : await deps.gymItems(gymId).catch(() => [] as readonly EquipmentInstance[]);
    let n = 0;
    const learned = items.length === 0 ? null : namedWeightGymEdit({ aggregate: current, command: plan.command, items, atUtc: ctx.now.utc, newId: () => deriveId(`named-weight-item:${ctx.opId}:${String((n += 1))}`) });
    const detail = learned === null ? base : { ...base, learned };
    const action = newActionRecord(ctx, detail, {
      reason: a.reason,
      guardNotes: plan.guardNotes,
      entityVersions: [{ entity: 'session', id: sessionId, before: args.baseVersion, after: args.baseVersion + 1 }, ...(learned === null ? [] : learned.equipment.map((e) => ({ entity: 'equipment', id: e.after.id, before: e.before?.version ?? null, after: e.after.version })))],
    });
    const saveExercises = plan.used.filter((e) => unsaved.has(e.id));
    const w = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action, sessionId, command: plan.command, expectedSessionVersion: args.baseVersion, ...(saveExercises.length > 0 ? { saveExercises } : {}), ...(learned === null ? {} : { gymEdit: learned }) });
    if (w.status === 'conflict') {
      if (w.reason === 'stale_version') return withAlso(await staleNow(plan.guardNotes, `${ctx.opId}:refused`));
      return withAlso(await refuse('rejected', 'the workout refused it', plan.guardNotes, `${ctx.opId}:refused`));
    }
    if (w.status === 'written') {
      const fresh = await deps.loadSession().catch(() => null);
      if (fresh !== null) deps.onSessionChanged?.(fresh);
    }
    return withAlso({ kind: 'action', record: w.action, replayed: w.status === 'replayed' });
  };
}

/** The opId of Ben's accept of one offer: a double tap applies once. */
export function acceptOfferOpId(proposalActionId: string): string {
  return `accept:${proposalActionId}`;
}

/** The latest offer of an edit (`proposed`, with its command) among a turn's records, if any. */
export function editOfferIn(records: readonly ActionRecord[]): ActionRecord | null {
  return [...records].reverse().find((r) => r.status === 'proposed' && r.detail.kind === 'edit_today' && r.detail.command !== null) ?? null;
}

/**
 * Ben's `Adjust` (or a bare "yes") on the coach's offer: the stored command applies exactly as
 * offered, under a record of its own (`proposalId` names the offer), with no model call. Refused as
 * stale when the workout moved on since the offer (rule 5); an exercise the edit adds or swaps to
 * that isn't in Ben's exercises yet is saved in the same write. Pain is read again (review B1,
 * rule 9): a flag set since the offer refuses an increase, more sets, an add or a swap it covers.
 */
export async function acceptEditOffer(
  deps: Pick<EditTodayDeps, 'store' | 'loadSession' | 'inputs' | 'onSessionChanged' | 'painFlags' | 'sessionPainUnspecified'>,
  proposal: ActionRecord,
  ctx: { ownerId: string; turnId: string; now: ZonedTimestamp },
): Promise<ToolResult> {
  const d = proposal.detail;
  if (d.kind !== 'edit_today' || d.command === null || proposal.status !== 'proposed') return { kind: 'refused', line: 'There is no offer to apply.' };
  const opId = acceptOfferOpId(proposal.actionId);
  const actionId = actionIdFor(opId);
  // The record's own ID marks the changed targets (for `Why?` and Undo); every value, ID and step is the offer's.
  const command: CoachEditTodayCommand = { ...d.command, at: ctx.now, actionId, steps: d.command.steps.map((x) => (x.type === 'adjust_pending_targets' ? { ...x, actionId } : x)) };
  const detail = { ...d, command, proposalId: proposal.actionId };
  const base = { turnId: ctx.turnId, opId, now: ctx.now };
  const refuse = (status: 'stale' | 'rejected', failure: string | null): Promise<ToolResult> =>
    recordOnly(deps.store, ctx.ownerId, newActionRecord({ ...base, opId: `${opId}:refused` }, { ...detail, command: null }, { status, failure, guardNotes: proposal.guardNotes, reason: proposal.reason }), 'refused accept');
  const aggregate = await deps.loadSession();
  // The version is checked in the write itself (rule 5), after the opId: a double tap replays the first accept, not a refusal.
  if (aggregate === null || aggregate.session.id !== d.sessionId) return refuse('stale', null);
  const held = coachEditPainHold({ aggregate, command, painFlags: await deps.painFlags(), sessionPainUnspecified: deps.sessionPainUnspecified, offeredAtUtc: proposal.createdAt.utc, at: ctx.now });
  if (held !== null) return refuse('rejected', held);
  const saveExercises: Exercise[] = [];
  for (const step of command.steps) {
    if (step.type !== 'add_exercise' && step.type !== 'swap_exercise') continue;
    const got = deps.inputs === undefined ? null : await deps.inputs(step.exercise.exerciseId, aggregate);
    if (got?.exerciseUnsaved === true && got.exercise !== null) saveExercises.push(got.exercise);
  }
  const action = newActionRecord(base, detail, {
    reason: proposal.reason,
    guardNotes: proposal.guardNotes,
    entityVersions: [{ entity: 'session', id: d.sessionId, before: d.baseVersion, after: d.baseVersion + 1 }],
  });
  const w = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action, sessionId: d.sessionId, command, expectedSessionVersion: d.baseVersion, ...(saveExercises.length > 0 ? { saveExercises } : {}) });
  if (w.status === 'conflict') return refuse(w.reason === 'stale_version' ? 'stale' : 'rejected', w.reason === 'stale_version' ? null : 'the workout refused it');
  if (w.status === 'written') {
    const fresh = await deps.loadSession().catch(() => null);
    if (fresh !== null) deps.onSessionChanged?.(fresh);
  }
  return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
}
