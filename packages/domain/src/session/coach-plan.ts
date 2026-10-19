import {
  PLAN_LIMITS,
  type BuildFocus,
  type DraftPlan,
  type Exercise,
  type MuscleGroup,
  type PlanApplied,
  type PlanApplyMode,
  type PlanCheck,
  type PlanDayDraft,
  type PlanDraft,
  type PlanDraftVersion,
  type PlannedSet,
  type ProposePlanArgs,
  type ProposedPlanDay,
  type Routine,
  type RoutineExercise,
  type SetTemplate,
  type SplitDay,
  type TargetProvenance,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { HistorySession } from '../progression';
import { deriveId } from '../stable';
import { toIso, toMs } from '../time';
import { loadText } from '../display';
import { checkWorkoutProposal, draftSchemeText, draftWorkingSets, recheckDraftSlot, type WorkoutProposalContext } from './coach-draft';
import { setRoutineRotation } from './library';
import { deleteRoutine, isDeleted, isFromRoutine, isInRotation, type FinishedRef, type RoutineChange } from './routines';
import type { SubstituteContext } from './substitutes';

/**
 * Coach-built multi-day plans (Ben, 19 Oct). Pure.
 *
 * - `checkPlanProposal`: every day of a `propose_plan` call through the
 *   workout builder's own checks (`checkWorkoutProposal`: the gym, pain
 *   flags, limits, checked loads), plus the plan's own: days mapped to
 *   Ben's split days, names made by code, a day with nothing usable left out.
 * - The plan's lifecycle: versions, Apply (`Replace my workouts` or `Add
 *   alongside`), Undo (the setup before Apply back), each versioned and
 *   idempotent on its op ID (rule 5). Apply is a proposal's Apply (rule 3).
 * - Up next walks the plan's days (`planUpNext`, `planRoutineForSplitDay`).
 * - A day's first workout takes the plan's checked loads (`planFirstLoads`);
 *   after that, next-time targets as for any saved workout.
 *
 * Nothing here talks to a model or the network.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Names

/** `4-day plan`, `1-day plan`. */
export function planName(days: number): string {
  return `${String(days)}-day plan`;
}

/** A day name as stored: trimmed, at most 30 characters; never empty. */
function cleanName(raw: string, fallback: string): string {
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, PLAN_LIMITS.dayNameMax).trim();
  return t.length === 0 ? fallback : t;
}

/** `Push`, then `Push 2`, `Push 3` for later days with the same name. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n <= PLAN_LIMITS.maxDays + 1; n += 1) {
    const tail = ` ${String(n)}`;
    const candidate = `${name.slice(0, PLAN_LIMITS.dayNameMax - tail.length).trim()}${tail}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Checks

export interface PlanProposalContext {
  /** The split in use (Profile's, else Push/Pull/Legs): what `splitDayId` may name. */
  splitDays: readonly SplitDay[];
  /** One day's checks context (its main lift, its slot keys); called once per proposed day, by its place in the call. */
  dayContext(proposedIndex: number, splitDay: SplitDay | null): WorkoutProposalContext;
  /** One day's length in minutes (Ben's words win; code decides). */
  minutesFor(day: ProposedPlanDay): number;
  /** The muscle group most of a day's working sets train, for the `same muscles in a row` note. Absent: not checked. */
  topGroupOf?: (plan: DraftPlan) => MuscleGroup | null;
}

export type PlanProposalCheck = { status: 'ok' | 'partial'; days: PlanDayDraft[]; checks: PlanCheck[] } | { status: 'unusable'; days: []; checks: PlanCheck[] };

/**
 * `checkPlanProposal(args, ctx)`: each day checked as a workout draft
 * (`checkWorkoutProposal`); a day with nothing usable is left out with a
 * check line. A `splitDayId` that isn't one of Ben's split days is
 * dropped (the day keeps the coach's name). A split day's day is named as
 * the split day (`Push`), so Up next finds it; a second day for the same
 * split day is `Push 2`. Every line is app text. `unusable`: no day left.
 */
export function checkPlanProposal(args: ProposePlanArgs, ctx: PlanProposalContext): PlanProposalCheck {
  const checks: PlanCheck[] = [];
  const add = (c: PlanCheck): void => {
    checks.push({ ...c, text: c.text.slice(0, 200) });
  };
  if (args.days.length > PLAN_LIMITS.maxDays) add({ kind: 'too_many_days', dayIndex: null, text: `Kept the first ${String(PLAN_LIMITS.maxDays)} days` });
  const days: PlanDayDraft[] = [];
  const names = new Set<string>();
  const usedSplit = new Set<string>();
  for (const [i, d] of args.days.slice(0, PLAN_LIMITS.maxDays).entries()) {
    const split = d.splitDayId === null ? null : (ctx.splitDays.find((s) => s.id === d.splitDayId) ?? null);
    if (d.splitDayId !== null && split === null) add({ kind: 'split_unknown', dayIndex: days.length, text: `${cleanName(d.dayName, `Day ${String(i + 1)}`)} · not one of your split days` });
    const base = split !== null ? split.name : cleanName(d.dayName, `Day ${String(i + 1)}`);
    if (split !== null && cleanName(d.dayName, base).toLowerCase() !== split.name.toLowerCase() && !cleanName(d.dayName, base).toLowerCase().startsWith(split.name.toLowerCase())) {
      add({ kind: 'day_renamed', dayIndex: days.length, text: `${cleanName(d.dayName, base)} named ${split.name} · your split day` });
    }
    if (split !== null && usedSplit.has(split.id)) add({ kind: 'split_repeated', dayIndex: days.length, text: `${split.name} twice · both are ${split.name} days` });
    const check = checkWorkoutProposal({ name: null, exercises: d.exercises, message: '' }, ctx.dayContext(i, split));
    if (check.status === 'unusable') {
      add({ kind: 'day_dropped', dayIndex: null, text: `${base} left out · nothing usable here` });
      continue;
    }
    if (split !== null) usedSplit.add(split.id);
    const name = uniqueName(base, names);
    names.add(name.toLowerCase());
    const focus: BuildFocus = d.focus ?? (split !== null ? 'split_day' : 'coach_picks');
    days.push({ index: days.length, name, splitDayId: split?.id ?? null, focus, minutes: ctx.minutesFor(d), plan: check.plan, checks: check.checks.slice(0, 60) });
  }
  if (ctx.topGroupOf !== undefined) {
    for (let i = 1; i < days.length; i += 1) {
      const a = days[i - 1];
      const b = days[i];
      if (a === undefined || b === undefined) continue;
      const ga = ctx.topGroupOf(a.plan);
      if (ga !== null && ga === ctx.topGroupOf(b.plan)) add({ kind: 'same_muscles_in_a_row', dayIndex: b.index, text: `${a.name} and ${b.name} both mostly ${ga}` });
    }
  }
  if (days.length === 0) return { status: 'unusable', days: [], checks: checks.slice(0, 20) };
  const partial = checks.some((c) => c.kind === 'day_dropped') || days.some((d) => d.checks.some((c) => c.leftOut));
  return { status: partial ? 'partial' : 'ok', days, checks: checks.slice(0, 20) };
}

/** Exercises left out across the plan's days, and days left out. */
export function planLeftOut(version: Pick<PlanDraftVersion, 'days' | 'checks'>): { exercises: number; days: number } {
  return { exercises: version.days.reduce((n, d) => n + d.checks.filter((c) => c.leftOut).length, 0), days: version.checks.filter((c) => c.kind === 'day_dropped').length };
}

// ---------------------------------------------------------------------------
// Lifecycle (rule 5)

export type PlanLifeChange =
  | { kind: 'write'; next: PlanDraft; expectedVersion: number | null }
  | { kind: 'duplicate'; current: PlanDraft }
  | { kind: 'stale'; current: PlanDraft }
  | { kind: 'closed'; current: PlanDraft }
  | { kind: 'invalid'; reason: string };

export function planExpiry(createdUtc: string): string {
  return toIso(toMs(createdUtc) + PLAN_LIMITS.openDays * DAY_MS);
}

/** Open and not past its 14 days. */
export function planIsOpen(p: Pick<PlanDraft, 'status' | 'expiresAtUtc'>, nowUtc: string): boolean {
  return p.status === 'open' && toMs(nowUtc) < toMs(p.expiresAtUtc);
}

export function currentPlanVersion(p: Pick<PlanDraft, 'versions' | 'currentVersion'>): PlanDraftVersion {
  const v = p.versions.find((x) => x.n === p.currentVersion);
  if (v === undefined) throw new Error('The plan has no current version');
  return v;
}

function remember(opIds: readonly string[], opId: string): string[] {
  return [...opIds, opId].slice(-PLAN_LIMITS.maxOps);
}

function bump(p: PlanDraft, opId: string, atUtc: string, patch: Partial<PlanDraft>): PlanDraft {
  return { ...p, ...patch, opIds: remember(p.opIds, opId), version: p.version + 1, updatedAtUtc: atUtc };
}

/** A new plan from its first checked version. */
export function newPlanDraft(input: { id: string; ownerId: string; version: PlanDraftVersion; opId: string; at: ZonedTimestamp }): PlanDraft {
  const v = { ...input.version, n: 1, parentN: null, status: 'current' as const };
  return {
    id: input.id,
    ownerId: input.ownerId,
    status: 'open',
    name: planName(v.days.length),
    currentVersion: 1,
    versions: [v],
    applied: null,
    undoneAtUtc: null,
    opIds: [input.opId],
    createdAt: input.at,
    tz: input.at.tz,
    expiresAtUtc: planExpiry(input.at.utc),
    version: 1,
    updatedAtUtc: input.at.utc,
  };
}

/** A new version (Ben asked the coach to change the plan): current at once; only while the plan is open. */
export function addPlanVersion(current: PlanDraft, input: { version: PlanDraftVersion; expectedVersion: number; opId: string; at: ZonedTimestamp }): PlanLifeChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion) return { kind: 'stale', current };
  if (!planIsOpen(current, input.at.utc)) return { kind: 'closed', current };
  const n = Math.max(...current.versions.map((v) => v.n)) + 1;
  const v: PlanDraftVersion = { ...input.version, n, parentN: current.currentVersion, status: 'current' };
  const versions = [...current.versions.map((x) => (x.status === 'current' ? { ...x, status: 'replaced' as const } : x)), v].slice(-PLAN_LIMITS.maxVersions);
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { versions, currentVersion: n, name: planName(v.days.length) }), expectedVersion: current.version };
}

/** The 14-day expiry of an open plan; an applied plan stays. */
export function expirePlanDraft(current: PlanDraft, nowUtc: string): PlanDraft | null {
  if (current.status !== 'open' || toMs(nowUtc) < toMs(current.expiresAtUtc)) return null;
  return { ...current, status: 'expired', version: current.version + 1, updatedAtUtc: nowUtc };
}

// ---------------------------------------------------------------------------
// Apply: each day becomes a saved workout in the rotation

/** A plan day's workout ID: from the Apply's op ID, so a retry makes the same workout. */
export const planRoutineIdFor = (opId: string, dayIndex: number): string => deriveId(`plan-routine:${opId}:${String(dayIndex)}`);

/** A plan slot's row ID in the workout Apply made (stable, so the first workout can find the plan's checked loads). */
export const planSlotRowId = (planId: string, versionN: number, slotKey: string): string => deriveId(`plan-slot:${planId}:${String(versionN)}:${slotKey}`);

function templateOf(rowId: string, i: number, t: PlanDayDraft['plan']['slots'][number]['setTemplates'][number]): SetTemplate {
  return {
    id: deriveId(`plan-set:${rowId}:${String(i)}`),
    setType: t.setType,
    // `Auto` (WL7): the first workout takes the plan's checked loads (`planFirstLoads`), then next-time targets.
    targetLoad: null,
    targetReps: t.reps,
    targetDurationS: t.durationS,
    targetRpe: t.targetRpe,
    targetRir: null,
    restOverrideS: t.restS,
  };
}

/** One plan day as a saved workout (`source: 'coach'`, in the rotation at `rotationAtUtc`). */
export function routineFromPlanDay(input: { plan: Pick<PlanDraft, 'id' | 'ownerId'>; versionN: number; day: PlanDayDraft; id: string; opId: string; at: ZonedTimestamp; rotationAtUtc: string }): Routine {
  const exercises: RoutineExercise[] = [...input.day.plan.slots]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const rowId = planSlotRowId(input.plan.id, input.versionN, s.slotKey);
      return {
        id: rowId,
        exerciseId: s.exerciseId,
        equipmentId: s.checkedOn?.equipmentId ?? null,
        order: i,
        supersetGroup: s.supersetGroup,
        setTemplates: s.setTemplates.map((t, k) => templateOf(rowId, k, t)),
        restBySetType: {},
        transitionRestS: null,
        progressionRuleId: null,
        main: s.main,
      };
    });
  return {
    id: input.id,
    ownerId: input.plan.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.day.name,
    exercises,
    createdFromSessionId: null,
    lastOpId: input.opId,
    source: 'coach',
    inRotation: true,
    rotationAtUtc: input.rotationAtUtc,
    createdFromPlan: { planId: input.plan.id, dayIndex: input.day.index, versionN: input.versionN, splitDayId: input.day.splitDayId, atUtc: input.at.utc },
  };
}

export type PlanApplyChange =
  | {
      kind: 'write';
      next: PlanDraft;
      expectedVersion: number;
      /** New workouts, one per day, in day order. */
      create: Routine[];
      /** Workouts taken out of the rotation (`Replace my workouts`). */
      update: { next: Routine; expectedVersion: number }[];
    }
  | { kind: 'duplicate'; current: PlanDraft }
  /** The card was older than the plan (a newer version, or already applied or undone): nothing changes (rule 5). */
  | { kind: 'stale'; current: PlanDraft }
  | { kind: 'closed'; current: PlanDraft };

/**
 * Apply (rule 3: a proposal's Apply). Each day becomes a saved workout, in
 * the rotation in day order after anything already in it. `replace`: every
 * other workout in the rotation comes out of it (kept in Workouts). The
 * card's `expectedVersion` and `versionN` must still be the plan's: a newer
 * version, or an Apply or Undo since, makes it stale and nothing changes.
 * `live`: Ben's live workouts as stored now.
 */
export function applyPlan(current: PlanDraft, input: { expectedVersion: number; versionN: number; mode: PlanApplyMode; opId: string; at: ZonedTimestamp; live: readonly Routine[] }): PlanApplyChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.currentVersion !== input.versionN) return { kind: 'stale', current };
  if (!planIsOpen(current, input.at.utc)) return { kind: current.status === 'applied' ? 'stale' : 'closed', current };
  const v = currentPlanVersion(current);
  const atMs = toMs(input.at.utc);
  const create = v.days.map((day, i) =>
    routineFromPlanDay({ plan: current, versionN: v.n, day, id: planRoutineIdFor(input.opId, day.index), opId: input.opId, at: input.at, rotationAtUtc: toIso(atMs + i) }),
  );
  const made = new Set(create.map((r) => r.id));
  const update: { next: Routine; expectedVersion: number }[] = [];
  const rotationOff: PlanApplied['rotationOff'] = [];
  if (input.mode === 'replace') {
    for (const r of input.live) {
      if (made.has(r.id) || isDeleted(r) || !isInRotation(r)) continue;
      const c: RoutineChange = setRoutineRotation(r, false, r.version, `${input.opId}:off:${r.id}`, input.at);
      if (c.kind !== 'write') continue;
      update.push({ next: c.next, expectedVersion: c.expectedVersion });
      rotationOff.push({ routineId: r.id, name: r.name, rotationAtUtc: r.rotationAtUtc ?? null, versionBefore: r.version, versionAfter: c.next.version });
      if (rotationOff.length >= 40) break;
    }
  }
  const applied: PlanApplied = { mode: input.mode, versionN: v.n, opId: input.opId, atUtc: input.at.utc, made: create.map((r, i) => ({ dayIndex: v.days[i]?.index ?? i, routineId: r.id, version: r.version })), rotationOff };
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { status: 'applied', applied }), expectedVersion: current.version, create, update };
}

export type PlanUndoChange =
  | { kind: 'write'; next: PlanDraft; expectedVersion: number; update: { next: Routine; expectedVersion: number }[] }
  | { kind: 'duplicate'; current: PlanDraft }
  | { kind: 'stale'; current: PlanDraft }
  /** A workout Apply made or took out was changed since (Ben edited it): nothing changes; `names` says which. */
  | { kind: 'changed_since'; current: PlanDraft; names: string[] };

/**
 * Undo of an Apply: the plan's workouts are deleted (tombstones, kept for
 * the history that names them) and the workouts Apply took out of the
 * rotation go back in their places. Only while each is still at the
 * version Apply left it; one Ben changed since refuses the whole Undo
 * (`changed_since`), so nothing he did is lost (rule 2). A workout he
 * deleted himself stays deleted. The plan is open again (Apply re-offers).
 */
export function undoPlanApply(current: PlanDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp; routines: ReadonlyMap<string, Routine | null> }): PlanUndoChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'applied' || current.applied === null) return { kind: 'stale', current };
  const a = current.applied;
  const update: { next: Routine; expectedVersion: number }[] = [];
  const changed: string[] = [];
  for (const m of a.made) {
    const r = input.routines.get(m.routineId) ?? null;
    if (r === null || isDeleted(r)) continue;
    if (r.version !== m.version) {
      changed.push(r.name);
      continue;
    }
    const c = deleteRoutine(r, r.version, `${input.opId}:delete:${r.id}`, input.at);
    if (c.kind === 'write') update.push({ next: c.next, expectedVersion: c.expectedVersion });
  }
  for (const off of a.rotationOff) {
    const r = input.routines.get(off.routineId) ?? null;
    if (r === null || isDeleted(r)) continue;
    if (r.version !== off.versionAfter) {
      changed.push(r.name);
      continue;
    }
    const c = setRoutineRotation(r, true, r.version, `${input.opId}:on:${r.id}`, input.at, off.rotationAtUtc);
    if (c.kind === 'write') update.push({ next: c.next, expectedVersion: c.expectedVersion });
  }
  if (changed.length > 0) return { kind: 'changed_since', current, names: [...new Set(changed)] };
  const reopen = toIso(Math.max(toMs(current.expiresAtUtc), toMs(input.at.utc) + PLAN_LIMITS.openDays * DAY_MS));
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { status: 'open', applied: null, undoneAtUtc: input.at.utc, expiresAtUtc: reopen }), expectedVersion: current.version, update };
}

// ---------------------------------------------------------------------------
// Up next with a plan (rotation, not dates)

/** The applied plan's live workouts, in day order. */
export function planRoutines<R extends Pick<Routine, 'id' | 'deletedAtUtc' | 'createdFromPlan'>>(plan: Pick<PlanDraft, 'id' | 'status' | 'applied'> | null, routines: readonly R[]): R[] {
  if (plan === null || plan.status !== 'applied' || plan.applied === null) return [];
  const byId = new Map(routines.map((r) => [r.id, r]));
  return plan.applied.made.flatMap((m) => {
    const r = byId.get(m.routineId);
    return r === undefined || isDeleted(r) || r.createdFromPlan?.planId !== plan.id ? [] : [r];
  });
}

/**
 * Up next with a plan and no split (Ben, 19 Oct: "Up next walks through
 * them"): the day after the plan day done most recently since Apply, in
 * day order, wrapping round; day 1 before any. Null with no plan days.
 */
export function planUpNext<R extends Pick<Routine, 'id' | 'createdFromSessionId'>>(days: readonly R[], refs: readonly FinishedRef[], appliedAtUtc: string): R | null {
  if (days.length === 0) return null;
  const since = toMs(appliedAtUtc);
  const newest = [...refs].filter((f) => toMs(f.startedAtUtc) >= since).sort((a, b) => toMs(b.startedAtUtc) - toMs(a.startedAtUtc));
  for (const f of newest) {
    const at = days.findIndex((r) => isFromRoutine(f, r));
    if (at >= 0) return days[(at + 1) % days.length] ?? null;
  }
  return days[0] ?? null;
}

/**
 * A split day's plan workout, the one done least recently when two days
 * share a split day (never done first, then day order). Since review
 * plans-19oct B1 an applied plan drives Up next even with a split; this
 * is only the split fallback when no plan day can be started at the gym.
 */
export function planRoutineForSplitDay<R extends Pick<Routine, 'id' | 'createdFromSessionId' | 'createdFromPlan'>>(days: readonly R[], splitDayId: string, refs: readonly FinishedRef[]): R | null {
  const mine = days.filter((r) => r.createdFromPlan?.splitDayId === splitDayId);
  if (mine.length === 0) return null;
  const last = (r: R): number => Math.max(Number.NEGATIVE_INFINITY, ...refs.filter((f) => isFromRoutine(f, r)).map((f) => toMs(f.startedAtUtc)));
  return [...mine].sort((a, b) => last(a) - last(b))[0] ?? null;
}

// ---------------------------------------------------------------------------
// A plan day's first workout: the plan's checked loads

export interface PlanFirstLoadsInput {
  routine: Routine;
  plan: PlanDraft;
  exercises: ReadonlyMap<string, Exercise>;
  histories: ReadonlyMap<string, readonly HistorySession[]>;
  /** The gym being started at: its items, pain flags and session pain. */
  substitute: SubstituteContext;
  nowMs: number;
}

/**
 * Per row of a plan workout that has never been done: each set template's
 * planned set from the plan's stored coach load, re-checked now
 * (`recheckDraftSlot`: newer history, pain, the item at this gym), with
 * `source: coach` and its `Why?` (rule 3, rule 6: `est.` stays). A row
 * Ben changed since Apply, a slot whose load fell back, or a timed row has
 * none (the row's own templates, as any new workout). Empty when the
 * workout isn't a plan's or its plan version is gone.
 */
export function planFirstLoads(input: PlanFirstLoadsInput): Map<string, { exerciseId: string; sets: (PlannedSet | null)[] }> {
  const out = new Map<string, { exerciseId: string; sets: (PlannedSet | null)[] }>();
  const link = input.routine.createdFromPlan;
  if (link === undefined || link.planId !== input.plan.id) return out;
  const version = input.plan.versions.find((v) => v.n === link.versionN);
  const day = version?.days.find((d) => d.index === link.dayIndex);
  if (version === undefined || day === undefined) return out;
  for (const slot of day.plan.slots) {
    const rowId = planSlotRowId(input.plan.id, version.n, slot.slotKey);
    const rex = input.routine.exercises.find((e) => e.id === rowId);
    if (rex === undefined || rex.exerciseId !== slot.exerciseId) continue;
    if (rex.structureChangedAtUtc !== undefined && toMs(rex.structureChangedAtUtc) > toMs(link.atUtc)) continue;
    if (rex.setTemplates.length !== slot.setTemplates.length || rex.setTemplates.some((t, i) => t.setType !== slot.setTemplates[i]?.setType || t.targetLoad !== null)) continue;
    const exercise = input.exercises.get(slot.exerciseId);
    if (exercise === undefined) continue;
    const re = recheckDraftSlot(slot, exercise, input.histories.get(exercise.id) ?? [], input.substitute, version.createdAt.utc, input.nowMs);
    if (re?.kind !== 'coach') continue;
    const sets = slot.setTemplates.map((t, i): PlannedSet | null => {
      const c = re.checks.get(i);
      if (t.setType === 'warmup' || c === undefined || c.load === null) return null;
      const provenance: TargetProvenance = {
        source: 'coach',
        setAt: version.createdAt,
        routineName: input.routine.name,
        requestedLoad: c.load,
        basis: null,
        coach: { actionId: version.actionId, scope: 'build', reason: c.coachNote },
        ...(c.source === 'coach_est' ? { estimate: true as const } : {}),
        ...(c.held ? { held: true as const } : {}),
        guardNotes: [...(c.basis === null ? [] : [c.basis]), ...c.notes].slice(0, 10).map((n) => n.slice(0, 300)),
      };
      return { load: c.load, reps: t.reps, durationS: t.durationS, rpe: t.targetRpe, rir: null, source: 'coach', provenance };
    });
    if (sets.some((s) => s !== null)) out.set(rex.id, { exerciseId: rex.exerciseId, sets });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plan card

export interface PlanDayLine {
  index: number;
  name: string;
  exercises: number;
  workingSets: number;
  minutes: number;
  leftOut: number;
}

/** One line per day: `Push · 5 exercises · 16 sets`. */
export function planDayLines(version: Pick<PlanDraftVersion, 'days'>): PlanDayLine[] {
  return version.days.map((d) => ({
    index: d.index,
    name: d.name,
    exercises: d.plan.slots.length,
    workingSets: d.plan.slots.reduce((n, s) => n + draftWorkingSets(s), 0),
    minutes: d.minutes,
    leftOut: d.checks.filter((c) => c.leftOut).length,
  }));
}

export interface PlanDayRow {
  exerciseId: string;
  name: string;
  /** `3 × 8–10`, `2 × 0:45`. */
  scheme: string;
  /** The checked working load (`100 kg`, `22.5 kg each`, `Assist 30 kg`); `—` when none (planned at Start from history). A top set leads: `Top 105 kg · 95 kg`. */
  load: string;
  /** `est.`: no comparable history of his own backs it (rule 6). */
  estimate: boolean;
  /** Held for pain (rule 9). */
  held: boolean;
  main: boolean;
  superset: string | null;
}

/** A plan day's rows as the plan card's day view shows them: values from the stored, checked day only. */
export function planDayRows(day: Pick<PlanDayDraft, 'plan'>, exerciseOf: (exerciseId: string) => Pick<Exercise, 'name' | 'defaultLoadConvention'> | null): PlanDayRow[] {
  return [...day.plan.slots]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const ex = exerciseOf(s.exerciseId);
      const convention = ex?.defaultLoadConvention ?? 'total';
      const top = s.setTemplates.find((t) => t.setType === 'top')?.load ?? null;
      const work = s.setTemplates.find((t) => t.setType !== 'warmup' && t.setType !== 'top')?.load ?? null;
      const text = (l: typeof work): string => loadText(l?.load ?? null, convention);
      const load = top !== null && top.load !== null ? `Top ${text(top)} · ${text(work)}` : text(work);
      const loads = [top, work].filter((l): l is NonNullable<typeof l> => l !== null && l.load !== null);
      return {
        exerciseId: s.exerciseId,
        name: ex?.name ?? 'Exercise',
        scheme: draftSchemeText(s),
        load,
        estimate: loads.some((l) => l.source === 'coach_est'),
        held: loads.some((l) => l.held),
        main: s.main,
        superset: s.supersetGroup,
      };
    });
}
