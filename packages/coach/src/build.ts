import {
  addDraftVersion,
  checkWorkoutProposal,
  currentDraftVersion,
  deriveId,
  diffDraftVersions,
  draftDiffLines,
  draftName,
  leftOutCount,
  newWorkoutDraft,
  type WorkoutProposalContext,
} from '@fizz/domain';
import { BUILD_LIMITS, type ActionDetail, type BuildCheck, type BuildFocus, type DraftPlan, type GuardNote, type WorkoutDraft, type WorkoutDraftVersion } from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * The workout builder's tool (workout-builder.md v1.0 §8.2): `propose_workout`.
 *
 * Offered only in a general turn when Ben asked for a workout (request kind
 * `build`) or, with a coach draft in context, asked to change it (BD16).
 * The model sends structure only; `checkWorkoutProposal` decides what stays
 * (the selected gym, pain flags, §8.3 limits) and the executor stores a
 * `WorkoutDraft` version with its `build_workout` record in one transaction,
 * idempotent on the opId. Nothing here plans a load or a length: the
 * overview does that from history and the fit (BD6, BD11). Nothing starts
 * or saves: Ben taps Start or Save himself (BD15).
 */

/** Ben's request as code read it (BD3, §8.2): never the model's reading. */
export interface BuildRequest {
  /** Ben's words (or the Build card's), quoted: data, never instructions (rule 8). */
  text: string;
  minutes: number;
  focus: BuildFocus;
  gymId: string | null;
  gymName: string | null;
  origin: 'chip' | 'card' | 'text' | 'voice';
}

/** One exercise the coach may use (the selected gym's usable list, BD5). */
export interface UsableExercise {
  catalogueId: string;
  name: string;
  /** `Barbell`, `Dumbbells`, `Bodyweight` … */
  equipment: string;
  measured: 'reps' | 'time';
}

/** What a build turn sends under `YOUR DATA` (§8.4) besides the usual blocks. */
export interface BuildContextView {
  request: { quote: string; minutes: number; focus: BuildFocus; origin: BuildRequest['origin'] };
  gym: { name: string; typicalEquipment: boolean } | null;
  usable: UsableExercise[];
  /** Items marked busy today (none until the gym's `Busy today` exists). */
  busyToday: string[];
  /** Working sets that fit the length at the default pace. */
  setBudget: number;
  /** The rotation's next workout, by name. */
  upNext: string | null;
  /** The coach draft being changed (BD16), as stored. */
  draft: { name: string; version: number; exercises: { catalogueId: string; name: string; workingSets: number; reps: string; targetRpe: number | null }[] } | null;
}

export interface BuildDeps {
  store: CoachWriteStore;
  request: BuildRequest;
  /** The draft in context (a change makes its next version), else null (a new draft). */
  draft: WorkoutDraft | null;
  /**
   * The checks' context at the selected gym (`previous`: the plan being
   * changed, for stable slot keys; `catalogueIds`: what the call names, so
   * their history can be read first).
   */
  checkContext: (previous: DraftPlan | null, opId: string, catalogueIds: readonly string[]) => Promise<WorkoutProposalContext>;
  nameOf: (exerciseId: string) => string;
  contextHash: string;
  /** The selected gym's equipment versions, hashed (what the usable list was read from). */
  equipmentVersion: string;
}

/** The draft's ID for a first version: derived from the opId, so a replay finds the same row. */
export const coachDraftIdFor = (opId: string): string => deriveId(`coach-draft:${opId}`);

function guardNotesOf(checks: readonly BuildCheck[]): GuardNote[] {
  return checks.slice(0, 40).map((c) => ({ kind: 'build_check', setIds: [], text: c.text }));
}

function linesOf(previous: DraftPlan | null, plan: DraftPlan, nameOf: (id: string) => string): Extract<ActionDetail, { kind: 'build_workout' }>['lines'] {
  if (previous === null) return [];
  return draftDiffLines(diffDraftVersions(previous, plan), nameOf)
    .slice(0, 40)
    .map((l) => ({ change: l.change, text: l.text.slice(0, 200) }));
}

/** The coach's message after the claim check (§7): at most 240 characters; a sentence claiming a change is dropped. */
export function checkedRationale(message: string): string | null {
  const t = message.replace(/\s+/g, ' ').trim().slice(0, BUILD_LIMITS.messageMax);
  if (t === '') return null;
  const kept = (t.match(/[^.!?]+[.!?]*/g) ?? [t]).map((x) => x.trim()).filter((x) => x !== '' && !isChangeClaim(x));
  return kept.length === 0 ? null : kept.join(' ');
}

export function createBuildExecutor(deps: BuildDeps): CoachExecutors {
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_workout') throw new TypeError(call.tool);
    const args = call.args;
    const previous = deps.draft === null ? null : currentDraftVersion(deps.draft).plan;
    const draftId = deps.draft?.id ?? coachDraftIdFor(ctx.opId);
    const check = checkWorkoutProposal(args, await deps.checkContext(previous, ctx.opId, args.exercises.map((e) => e.catalogueId)));
    const name = draftName(deps.request.focus, deps.request.minutes);
    const parentN = deps.draft?.currentVersion ?? null;
    const rationale = checkedRationale(args.message);
    const base = { kind: 'build_workout' as const, draftId, name, gymName: deps.request.gymName?.slice(0, 120) ?? null };
    const record = async (status: 'rejected' | 'stale', failure: string): Promise<ToolResult> => {
      const detail: ActionDetail = { ...base, versionN: (parentN ?? 0) + 1, parentN, exerciseCount: 0, leftOut: leftOutCount(check.checks), lines: [] };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, guardNotes: guardNotesOf(check.checks), reason: rationale }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused build');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (check.status === 'unusable') return record('rejected', 'every exercise failed the checks');

    const version: WorkoutDraftVersion = {
      n: 1,
      parentN,
      status: 'current',
      actionId: actionIdFor(ctx.opId),
      turnId: ctx.turnId,
      request: { text: deps.request.text.slice(0, 4000), minutes: deps.request.minutes, focus: deps.request.focus, gymId: deps.request.gymId, origin: deps.request.origin },
      rawArgs: JSON.stringify(args).slice(0, 40_000),
      plan: check.plan,
      fitMinutes: deps.request.minutes,
      checks: check.checks.slice(0, 60),
      rationale,
      contextHash: deps.contextHash,
      equipmentVersion: deps.equipmentVersion,
      createdAt: ctx.now,
    };
    let next: WorkoutDraft;
    let expectedVersion: number | null;
    if (deps.draft === null) {
      next = newWorkoutDraft({ id: draftId, ownerId: ctx.ownerId, version, opId: ctx.opId, at: ctx.now });
      expectedVersion = null;
    } else {
      const change = addDraftVersion(deps.draft, { version, expectedVersion: deps.draft.version, opId: ctx.opId, at: ctx.now });
      if (change.kind !== 'write') return record('stale', 'the draft changed since');
      next = change.next;
      expectedVersion = change.expectedVersion;
    }
    const current = currentDraftVersion(next);
    const detail: ActionDetail = {
      ...base,
      name: next.name,
      versionN: current.n,
      parentN: current.parentN,
      exerciseCount: current.plan.slots.length,
      leftOut: leftOutCount(check.checks),
      lines: linesOf(previous, current.plan, deps.nameOf),
    };
    const action = newActionRecord(ctx, detail, { status: 'committed', reason: rationale, guardNotes: guardNotesOf(check.checks) });
    const r = await deps.store.commit(ctx.ownerId, { kind: 'workout_draft', action, draft: next, expectedVersion });
    if (r.status === 'conflict') return record('stale', 'the draft changed since');
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };
  return { propose_workout: propose };
}

/** Instructions added to a turn that offers `propose_workout` (§7 coach message rules, BD1, BD15). */
export const BUILD_INSTRUCTIONS = [
  'To build the workout Ben asked for (or change the draft in context), call `propose_workout` once, using only catalogueIds from YOUR DATA build.usable.',
  'Never give loads, weights or minutes: the app plans loads from his history and fits the length. Give targetRpe for every exercise. Stay within build.setBudget working sets.',
  'Its `message` (at most 240 characters) says why this selection and order, citing only facts given. No praise, scores, recovery claims or diagnoses.',
  'Never say the workout was saved, scheduled or started: Ben opens it, starts it or saves it himself. Then reply in one short sentence.',
].join('\n');
