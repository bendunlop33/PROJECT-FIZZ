import {
  addPlanVersion,
  checkPlanProposal,
  currentPlanVersion,
  deriveId,
  newPlanDraft,
  type WorkoutProposalContext,
} from '@fizz/domain';
import {
  BUILD_LIMITS,
  type ActionDetail,
  type DraftPlan,
  type Exercise,
  type GuardNote,
  type MuscleGroup,
  type PlanDraft,
  type PlanDraftVersion,
  type ProposedPlanDay,
  type SplitDay,
} from '@fizz/schemas';
import { BUILD_ALREADY_LINE, checkedRationale, sameGymName, unknownGymLine, type BuildGym } from './build';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';
import { collectFacts, mergeFacts, type NumberFacts } from './numbers';

/**
 * The plan builder's tool, `propose_plan` (Ben, 19 Oct). Offered in a
 * general turn only on Ben's own plan request (`build_plan`), or a change
 * to the plan in context. Every day goes through the workout builder's
 * checks at the selected gym (`checkWorkoutProposal`: usable here, pain
 * flags, limits, checked loads; each day's own main lift), then
 * `checkPlanProposal` maps the days to Ben's split. The executor stores a
 * `PlanDraft` version with its `build_plan` record in one transaction,
 * idempotent on the opId. It is a proposal: Apply and Undo are Ben's taps
 * (rule 3); nothing in his workouts or rotation changes here.
 */

/** What a plan turn sends under `YOUR DATA` → `build.plan`. */
export interface PlanContextView {
  /** The split in use (Profile's, else Push/Pull/Legs): a day's `splitDayId` is one of these. */
  splitDays: { id: string; name: string; bodyParts: string[]; mainLift: string | null }[];
  /** `Days a week you lift` from Profile; null: not set. */
  daysPerWeek: number | null;
  /** Each day's length unless Ben asks otherwise. */
  minutesEach: number;
  /** Working sets per day that fit `minutesEach`. */
  setBudget: number;
  /** Ben's workouts in the rotation now, by name (what `Replace my workouts` would take out). */
  rotation: string[];
  /** The plan being changed (a revision), as stored. */
  current: { name: string; version: number; days: { name: string; splitDayId: string | null; exercises: { catalogueId: string; name: string; workingSets: number; reps: string; load: string | null }[] }[] } | null;
}

export interface PlanRequest {
  /** Ben's words, quoted: data, never instructions (rule 8). */
  text: string;
  /** His usual length (Profile) or 60: a day's length when nothing else says. */
  minutes: number;
  /** A length he stated outright in his newest message ("60 min each"): it wins over the model's. */
  minutesFromBen: number | null;
  gymId: string | null;
  gymName: string | null;
  origin: 'chip' | 'card' | 'text' | 'voice';
}

export interface PlanDeps {
  store: CoachWriteStore;
  request: PlanRequest;
  /** The plan in context (a change makes its next version), else null. */
  plan: PlanDraft | null;
  splitDays: readonly SplitDay[];
  /** One day's checks context at the gym (`previous`: the same day of the plan being changed). */
  checkContext: BuildGym['checkContext'];
  /** Ben's own main lift for a split day (Profile), for that day's checks (BD19). */
  mainLiftFor: (splitDay: SplitDay | null) => NonNullable<WorkoutProposalContext['mainLift']> | null;
  /** The exercise behind an ID, for the `same muscles in a row` note. */
  exerciseOf?: (exerciseId: string) => Pick<Exercise, 'primaryMuscles'> | null;
  /** A muscle as its group (`chest` → `Chest`). */
  groupOf?: (muscle: string) => MuscleGroup | null;
  contextHash: string;
  equipmentVersion: string;
  gyms?: readonly string[];
  gymFor?: (name: string) => Promise<BuildGym | null>;
}

/** The plan's ID for a first version: from the opId, so a replay finds the same row. */
export const planIdFor = (opId: string): string => deriveId(`coach-plan:${opId}`);

/** A day's length (stepped to 5, 15–180): the day's own (the model's reading), else Ben's stated length, else the model's for every day, else his usual. */
export function planDayMinutes(day: Pick<ProposedPlanDay, 'minutes'>, everyDay: number | null | undefined, request: Pick<PlanRequest, 'minutes' | 'minutesFromBen'>): number {
  const step = (n: number): number => Math.min(180, Math.max(15, Math.round(n / 5) * 5));
  if (day.minutes != null) return step(day.minutes);
  if (request.minutesFromBen != null) return step(request.minutesFromBen);
  if (everyDay != null) return step(everyDay);
  return step(request.minutes);
}

/** The group most of a day's working sets train, or null. */
function topGroup(plan: DraftPlan, deps: PlanDeps): MuscleGroup | null {
  if (deps.exerciseOf === undefined || deps.groupOf === undefined) return null;
  const sets = new Map<MuscleGroup, number>();
  for (const s of plan.slots) {
    const muscle = deps.exerciseOf(s.exerciseId)?.primaryMuscles[0];
    const g = muscle === undefined ? null : deps.groupOf(muscle);
    if (g === null) continue;
    sets.set(g, (sets.get(g) ?? 0) + s.setTemplates.filter((t) => t.setType !== 'warmup').length);
  }
  let best: MuscleGroup | null = null;
  let n = 0;
  for (const [g, c] of sets) if (c > n) [best, n] = [g, c];
  return best;
}

function guardNotesOf(version: Pick<PlanDraftVersion, 'days' | 'checks'>): GuardNote[] {
  return [...version.checks.map((c) => c.text), ...version.days.flatMap((d) => d.checks.map((c) => `${d.name}: ${c.text}`))].slice(0, 40).map((text) => ({ kind: 'build_check' as const, setIds: [], text: text.slice(0, 300) }));
}

/** The facts a plan's message is checked against: the turn's, plus the checked days and Ben's request. */
export function planFacts(turn: NumberFacts, days: PlanDraftVersion['days'], requestText: string): NumberFacts {
  return mergeFacts(turn, collectFacts([JSON.stringify(days), ...days.map((d) => String(d.minutes)), String(days.length), requestText]));
}

export function createPlanExecutor(deps: PlanDeps): CoachExecutors {
  // One request builds one plan (or one version). The executor lives for one turn.
  let landedOpId: string | null = null;
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_plan') throw new TypeError(call.tool);
    if (landedOpId !== null && landedOpId !== ctx.opId) return { kind: 'refused', line: BUILD_ALREADY_LINE };
    const args = call.args;
    let gym: BuildGym = { gymId: deps.request.gymId, gymName: deps.request.gymName, checkContext: deps.checkContext, equipmentVersion: deps.equipmentVersion };
    if (args.gymName != null) {
      const other = deps.gymFor === undefined ? null : await deps.gymFor(args.gymName);
      const same = deps.request.gymName !== null && (other === null ? sameGymName(args.gymName, deps.request.gymName) : other.gymId === deps.request.gymId);
      if (!same && other === null) return { kind: 'refused', line: unknownGymLine(args.gymName, deps.gyms ?? []) };
      if (!same && other !== null) gym = other;
    }
    const previous = deps.plan === null ? null : currentPlanVersion(deps.plan);
    const planId = deps.plan?.id ?? planIdFor(ctx.opId);
    // Each day's context, read before the checks (its history, its split day's main lift, its own slot keys).
    const contexts: WorkoutProposalContext[] = [];
    for (const [i, d] of args.days.slice(0, 7).entries()) {
      const split = d.splitDayId === null ? null : (deps.splitDays.find((s) => s.id === d.splitDayId) ?? null);
      const prevDay = previous?.days.find((x) => (split !== null && x.splitDayId === split.id) || x.index === i)?.plan ?? null;
      const c = await gym.checkContext(prevDay, `${ctx.opId}:day${String(i)}`, d.exercises.map((e) => e.catalogueId));
      contexts.push({ ...c, mainLift: deps.mainLiftFor(split) });
    }
    const check = checkPlanProposal(args, {
      splitDays: deps.splitDays,
      dayContext: (i) => {
        const c = contexts[i];
        if (c === undefined) throw new Error('No context for that day');
        return c;
      },
      minutesFor: (d) => planDayMinutes(d, args.minutes, deps.request),
      ...(deps.exerciseOf !== undefined && deps.groupOf !== undefined ? { topGroupOf: (p: DraftPlan) => topGroup(p, deps) } : {}),
    });
    const rationale = checkedRationale(args.message, ctx.facts === undefined ? undefined : planFacts(ctx.facts, check.days, deps.request.text));
    const parentN = deps.plan?.currentVersion ?? null;
    const gymName = gym.gymName?.slice(0, 120) ?? null;
    const record = async (status: 'rejected' | 'stale', failure: string): Promise<ToolResult> => {
      const detail: ActionDetail = { kind: 'build_plan', planId, versionN: (parentN ?? 0) + 1, parentN, name: deps.plan?.name ?? 'Plan', days: [], gymName };
      const notes = guardNotesOf({ days: check.days, checks: check.checks });
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, guardNotes: notes, reason: rationale }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused plan');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (check.status === 'unusable') return record('rejected', 'no day had anything usable here');

    const version: PlanDraftVersion = {
      n: 1,
      parentN,
      status: 'current',
      actionId: actionIdFor(ctx.opId),
      turnId: ctx.turnId,
      request: { text: deps.request.text.slice(0, 4000), gymId: gym.gymId, origin: deps.request.origin },
      rawArgs: JSON.stringify(args).slice(0, 80_000),
      days: check.days,
      checks: check.checks,
      rationale: rationale === null ? null : rationale.slice(0, BUILD_LIMITS.messageMax),
      ...(ctx.facts === undefined ? {} : { rationaleNumbersChecked: true as const }),
      contextHash: deps.contextHash,
      equipmentVersion: gym.equipmentVersion,
      createdAt: ctx.now,
    };
    let next: PlanDraft;
    let expectedVersion: number | null;
    if (deps.plan === null) {
      next = newPlanDraft({ id: planId, ownerId: ctx.ownerId, version, opId: ctx.opId, at: ctx.now });
      expectedVersion = null;
    } else {
      const change = addPlanVersion(deps.plan, { version, expectedVersion: deps.plan.version, opId: ctx.opId, at: ctx.now });
      if (change.kind !== 'write') return record('stale', 'the plan changed since');
      next = change.next;
      expectedVersion = change.expectedVersion;
    }
    const current = currentPlanVersion(next);
    const detail: ActionDetail = {
      kind: 'build_plan',
      planId,
      versionN: current.n,
      parentN: current.parentN,
      name: next.name,
      days: current.days.map((d) => ({ name: d.name, exerciseCount: d.plan.slots.length, leftOut: d.checks.filter((c) => c.leftOut).length })),
      gymName,
    };
    const action = newActionRecord(ctx, detail, { status: 'committed', reason: rationale, guardNotes: guardNotesOf(current) });
    const r = await deps.store.commit(ctx.ownerId, { kind: 'plan_draft', action, plan: next, expectedVersion });
    if (r.status === 'conflict') return record('stale', 'the plan changed since');
    landedOpId = ctx.opId;
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };
  return { propose_plan: propose };
}

/** Instructions added to a turn that offers `propose_plan` (Ben asked for a plan, or to change the one in context). */
export const PLAN_INSTRUCTIONS = [
  'Ben asked for a plan of several days in the app. Call `propose_plan` first, once, with every day, using only catalogueIds from YOUR DATA build.usable. Never write the plan out as text in `reply`: a plan in text is not in the app.',
  'Follow his split (build.plan.splitDays) and his days a week (build.plan.daysPerWeek) unless he asks for something else; give each day its splitDayId. Spread the muscles across the days so the same muscles don’t lead two days in a row. Keep each day within build.plan.setBudget working sets. Put each day’s main lift first.',
  'Give each exercise a working `load` (and `topSet.load`) from build.loadReferences, in the unit and convention listed there, with a `basis` of at most 60 characters in words with no numbers; null when you have no opinion. Give targetRpe for every exercise. Give `minutes` when Ben asked for a length for every day, a day’s own `minutes` when he asked for one for that day.',
  'To change the plan in context (build.plan.current), call `propose_plan` with the whole new version.',
  'Its `message` (at most 600 characters) says, like a coach would, why these days and this order. Any number in it must come from YOUR DATA, a tool result, Ben’s words or this plan; the app drops sentences with other numbers. No praise, scores, max or record claims, recovery claims or diagnoses.',
  'Never say the plan was applied, saved, scheduled or added to his workouts: Ben taps Apply himself. After the call, reply in one short sentence. If `propose_plan` is refused, say in one short sentence that it was not built and why.',
  'Multi-week blocks, deloads and calendar dates are not available yet: if Ben asks for one, say so plainly and build the week.',
].join('\n');

/** On a general turn without the plan tool (Ben didn't ask for one): the coach never promises one. */
export const PLAN_LINE = 'The app builds multi-day plans when Ben asks for one ("build me a 4-day plan"); multi-week blocks and deloads are not available yet.';
