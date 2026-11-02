import { PB_PREF_QUESTIONS, currentPlanVersion, directMuscleGroup, type PbPrefParts, planDayEditPreview, type PlanDayEdit, deriveId, liveRoutines, notPreferredInPlan, painFlagCovering, pbAppliedBuilder, pbNotPreferred, pbNotPreferredReplacement, planAddPreview, planRoutines, planSwapDirection, planSwapPreview, toMs, isArchivedExercise, type PlanSwapDayInput } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, ActionRecord, Exercise, Load, PainFlag, PlanBuilderAnswers, PlanDraft, Routine, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { PlanAddPart, PlanAddRequest, PlanDayEditRequest, PlanSwapPrepared } from '@fizz/coach';

/** One checked add of a `propose_plan_add` proposal and its days. */
interface AddPartOut {
  addEx: Exercise;
  afterEx: Exercise | null;
  beforeEx: Exercise | null;
  first: boolean;
  sets: number;
  reps: { min: number; max: number } | null;
  load: Load | null;
  durationS?: number;
  distanceM?: number;
  days: { routineId: string; routineName: string; versionBefore: number; edits: { kind: 'add'; rowId: string; afterRowId: string | null; afterName: string | null; first?: boolean; beforeRowId?: string }[]; before: string[]; after: string[] }[];
}

/**
 * (Ben, 30 Oct, build 486: "won't change full plan … my preferences to remove leg extension in setting as non preferred
 * hasn't updated plan") One exercise out and another in, in every day of the plan in use, from now on. Local only.
 *
 * - `context`: what the coach sees (each plan day's exercises, his not-preferred exercises).
 * - `prepare`: the coach's `propose_plan_swap` checked against the plan as it is (`planSwapDirection`,
 *   `planSwapPreview`): never puts in an exercise he marked not preferred, nor one held for pain (rule 9). Nothing is
 *   written here; the coach saves the proposal.
 * - `inPlan` / `replace`: Settings' `In your plan: Legs A, Legs B · Replace` on a not-preferred exercise, and Replace's
 *   proposal (his own, no model), with the replacement picked for the same muscles.
 * - `card`, `apply`, `undo`: Apply writes each day's one change through `plans.editDayEveryWeek` (the day sheet's
 *   `Every week`: only that exercise changes, nothing re-fitted), op IDs derived from the proposal so a double tap or a
 *   restart writes once (rule 5); a day changed since refuses it and anything already written is put back. Undo is each
 *   day's routine revert. Done workouts never change (rule 2): they are their own records.
 * - `today`: `Today too` on the card swaps the live workout's row (none of its sets done), its own change with Undo.
 * - `prepareAdd` (Ben, 31 Oct, build 493): the coach's `propose_plan_add`, one exercise into the named plan days at a
 *   place (`planAddPreview`), checked the same way (not preferred, pain flag). Apply writes each day's add through the
 *   same `Every week` write; a load only when Ben named one (kept as typed; the gym learns it), else the workout plans
 *   it from his history. Undo is the same routine revert.
 * - `prepareDayEdit` (Ben, 1 Nov, build 500): the coach's `propose_plan_day_edit`, one plan day's order and its
 *   exercises' sets, reps, target RPE and main mark (`planDayEditPreview`), with the day's before/after and one line per
 *   change. Apply is one versioned write of the day (`plans.editDayRowsEveryWeek`); Undo the same routine revert.
 */

export type PlanSwapDetail = Extract<ActionDetail, { kind: 'propose_plan_swap' }>;

export interface PlanSwapServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  catalogueExercises?: () => readonly Exercise[];
  /** A catalogue entry's substitutions in catalogue order (Coaching knowledge): Replace's alternatives. */
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
  /** Whether the current gym can do it (no gym: yes). Replace's pick only; Ben's own ask is never refused on kit (ADR 0038). */
  usableHere: (exercise: Exercise) => Promise<boolean>;
  editDayEveryWeek: (req: { routineId: string; expectedVersion: number; opId: string; edit: { kind: 'swap' | 'remove' | 'add'; rowId: string; fromExerciseId: string | null; toExerciseId: string | null; afterRowId?: string | null; sets?: number; reps?: { min: number; max: number }; load?: Load | null; first?: boolean; beforeRowId?: string; durationS?: number; distanceM?: number } }) => Promise<{ ok: true; actionId: string; routine: Routine; duplicate: boolean } | { ok: false; reason: string; message: string }>;
  /** (Ben, 1 Nov) A whole plan-day change, every week (`plans.editDayRowsEveryWeek`). Absent: day edits aren't wired. */
  editDayRowsEveryWeek?: (req: { routineId: string; expectedVersion: number; opId: string; edit: PlanDayEdit; lines: readonly string[] }) => Promise<{ ok: true; actionId: string; routine: Routine; duplicate: boolean } | { ok: false; reason: string; message: string }>;
  revertRoutine: (req: { actionId: string; opId: string }) => Promise<{ ok: boolean }>;
  swapToday?: (req: { sessionId: string; sessionExerciseId: string; exerciseId: string; opId: string }) => Promise<{ ok: boolean }>;
  undoToday?: (req: { sessionId: string; targetOpId: string }) => Promise<{ ok: boolean }>;
}

export type PlanSwapCardState = { kind: 'open' | 'applied' | 'undone'; today: 'open' | 'done' | null } | { kind: 'gone' };

/** Settings' line for one not-preferred exercise in the plan in use. */
export interface NotPreferredInPlan {
  /** Catalogue key (Any preferences' ID). */
  key: string;
  name: string;
  /** `Legs A`, `Legs B`. */
  days: string[];
  /** What Replace puts in; null: nothing fits here (Replace isn't offered). */
  replacement: { key: string; name: string } | null;
}

export const PLAN_SWAP_COPY = {
  /** `In your plan: Legs A, Legs B` */
  inPlan: (days: readonly string[]) => `In your plan: ${days.join(', ')}`,
  replace: 'Replace',
  apply: 'Apply',
  undo: 'Undo',
  skip: 'Skip',
  todayToo: 'Today too',
  applied: 'Applied',
  undone: 'Undone',
  skipped: 'Skipped',
  todayDone: 'Today too: done',
  stale: 'Out of date. Ask again.',
  failed: 'Couldn’t save. Try again.',
} as const;

const NO_SESSION = '00000000-0000-4000-8000-000000000000';

/** The op ID of one day's write for a proposal: the same on a double tap or after a restart (rule 5). */
export const planSwapOpId = (actionId: string, routineId: string, i: number): string => `plan-swap:${actionId}:${routineId}:${String(i)}`;
/** The `update_routine` record that write leaves (`plans.editDayEveryWeek`'s action ID). */
export const planSwapWriteId = (actionId: string, routineId: string, i: number): string => deriveId(`plan-day-every-week:${planSwapOpId(actionId, routineId, i)}`);
const todayOpId = (actionId: string): string => `plan-swap-today:${actionId}`;

export function createPlanSwapService(deps: PlanSwapServiceDeps) {
  const repos = () => deps.store().repos;

  async function pool(p: UserProfile): Promise<{ all: Exercise[]; of: (idOrKey: string) => Exercise | null }> {
    const byId = new Map<string, Exercise>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) if (e.ownerId === null || e.ownerId === p.id) byId.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
    const byKey = new Map<string, Exercise>();
    for (const e of byId.values()) if (e.catalogueKey != null && !byKey.has(e.catalogueKey)) byKey.set(e.catalogueKey, e);
    return { all: [...byId.values()], of: (x) => byId.get(x) ?? byKey.get(x) ?? null };
  }

  async function planInUse(p: UserProfile): Promise<{ plan: PlanDraft; days: (PlanSwapDayInput & { routine: Routine })[] } | null> {
    const plan = await repos().planDrafts.applied(p.id).catch(() => null);
    if (plan === null) return null;
    const routines = planRoutines(plan, liveRoutines(await repos().routines.listByOwner(p.id).catch(() => [] as Routine[])));
    return { plan, days: routines.map((r) => ({ routineId: r.id, name: r.name, version: r.version, rows: r.exercises, routine: r })) };
  }

  /** The not-preferred set as exercise IDs: from these answers (Settings' on-screen ones) or the plan in use's. */
  function notPreferredIds(answers: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'> | null, of: (x: string) => Exercise | null): Map<string, string> {
    const out = new Map<string, string>();
    if (answers === null) return out;
    for (const key of pbNotPreferred(answers)) {
      const e = of(key);
      if (e !== null) out.set(e.id, key);
    }
    return out;
  }

  const answersOf = (plan: PlanDraft | null): PlanBuilderAnswers | null => (plan === null ? null : (pbAppliedBuilder(plan)?.builder.answers ?? currentPlanVersion(plan).builder?.answers ?? null));

  async function flagsNow(p: UserProfile): Promise<(id: string) => boolean> {
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const at = deps.now();
    return (id) => painFlagCovering(flags, id, toMs(at.utc), at.tz) !== null;
  }

  /** The live workout's row of the exercise going out, when none of its sets is done (`Today too`). */
  async function todayRow(p: UserProfile, removeId: string): Promise<PlanSwapDetail['today']> {
    const live = await repos().sessions.getActive(p.id).catch(() => null);
    if (live === null || live.session.status !== 'active') return null;
    const row = live.exercises.find((e) => e.exerciseId === removeId && e.removed === undefined);
    if (row === undefined) return null;
    const sets = live.sets.filter((s) => s.sessionExerciseId === row.id && s.status !== 'deleted');
    if (sets.length === 0 || sets.some((s) => s.status !== 'pending')) return null;
    return { sessionId: live.session.id, sessionExerciseId: row.id };
  }

  /** The proposal for `remove` → `add` (exercise IDs), after the checks; or why not, in one line. */
  async function propose(p: UserProfile, req: { remove: string; add: string }, opts: { flip: boolean }): Promise<PlanSwapPrepared> {
    const { of } = await pool(p);
    const inUse = await planInUse(p);
    const removeEx = of(req.remove);
    const addEx = of(req.add);
    const names = { remove: removeEx?.name ?? req.remove, add: addEx?.name ?? req.add };
    if (inUse === null) return { kind: 'refused', line: 'No plan in use', names };
    if (removeEx === null || addEx === null) return { kind: 'refused', line: `${removeEx === null ? req.remove : req.add} isn’t in Ben’s exercises; use a catalogueId from plan.inUse.days or find_exercises`, names };
    const no = notPreferredIds(answersOf(inUse.plan), of);
    const inPlan = (id: string) => inUse.days.some((d) => d.rows.some((r) => r.exerciseId === id));
    const dir = opts.flip ? planSwapDirection({ remove: removeEx.id, add: addEx.id, notPreferred: new Set(no.keys()), inPlan }) : { kind: 'ok' as const, remove: removeEx.id, add: addEx.id, flipped: false };
    if (dir.kind === 'refused') return { kind: 'refused', line: dir.reason === 'same' ? 'That is the same exercise' : `${addEx.name} is not preferred in your plan settings`, names };
    const goingOut = dir.flipped ? addEx : removeEx;
    const comingIn = dir.flipped ? removeEx : addEx;
    if ((await flagsNow(p))(comingIn.id)) return { kind: 'refused', line: `${comingIn.name} has a pain flag`, names };
    const preview = planSwapPreview(inUse.days, goingOut.id, comingIn.id);
    if (preview.kind !== 'ok') return { kind: 'refused', line: preview.kind === 'same' ? 'That is the same exercise' : `${goingOut.name} isn’t in any day of your plan`, names: { remove: goingOut.name, add: comingIn.name } };
    const today = await todayRow(p, goingOut.id);
    return {
      kind: 'ok',
      detail: {
        kind: 'propose_plan_swap',
        planId: inUse.plan.id,
        planName: inUse.plan.name.slice(0, 120),
        removeId: goingOut.id,
        removeName: goingOut.name.slice(0, 120),
        addId: comingIn.id,
        addName: comingIn.name.slice(0, 120),
        days: preview.days.map((d) => ({ routineId: d.routineId, routineName: d.routineName.slice(0, 120), versionBefore: d.versionBefore, edits: d.edits })),
        ...(dir.flipped ? { flipped: true } : {}),
        today,
      },
    };
  }

  /** One add of a `propose_plan_add` proposal, checked and placed in its days; or why not. Nothing is written. */
  async function addPart(p: UserProfile, of: (x: string) => Exercise | null, inUse: NonNullable<Awaited<ReturnType<typeof planInUse>>>, req: PlanAddPart & { load: number | null }): Promise<{ kind: 'refused'; line: string; names: { remove: string; add: string } } | { kind: 'ok'; part: AddPartOut }> {
    const addEx = of(req.add);
    const names = { remove: '', add: addEx?.name ?? req.add };
    if (addEx === null || isArchivedExercise(addEx)) return { kind: 'refused', line: `${req.add} isn’t in Ben’s exercises; use a catalogueId from plan.inUse.days, build.usable or find_exercises`, names };
    // (Ben, 2 Nov) Its place: first, last, straight before or after an exercise (after: the default).
    const position = req.position ?? 'after';
    const afterEx = req.after === null || position !== 'after' ? null : of(req.after);
    if (position === 'after' && req.after !== null && afterEx === null) return { kind: 'refused', line: `${req.after} isn’t an exercise in the plan; use a catalogueId from plan.inUse.days, or null for the end`, names };
    const beforeEx = position === 'before' && req.before != null ? of(req.before) : null;
    if (position === 'before' && beforeEx === null) return { kind: 'refused', line: `${req.before ?? 'before'} isn’t an exercise in the plan; use a catalogueId from plan.inUse.days`, names };
    if (notPreferredIds(answersOf(inUse.plan), of).has(addEx.id)) return { kind: 'refused', line: `${addEx.name} is not preferred in your plan settings`, names };
    if ((await flagsNow(p))(addEx.id)) return { kind: 'refused', line: `${addEx.name} has a pain flag`, names };
    // (Ben, 2 Nov) The days are the coach's pick, by name (it reads each day's exercises); code never decides leg days.
    const dayNames = [...new Set(req.days)];
    if (dayNames.length === 0) return { kind: 'refused', line: `Name the days; the days are ${inUse.days.map((d) => d.name).join(', ')}`, names };
    const preview = planAddPreview(inUse.days, { add: addEx.id, dayNames, after: afterEx?.id ?? null, position: position === 'last' ? 'after' : position, before: beforeEx?.id ?? null, rowIdOf: (routineId) => deriveId(`plan-add-row:${inUse.plan.id}:${routineId}:${addEx.id}:${String(inUse.days.find((d) => d.routineId === routineId)?.version ?? 0)}`) });
    if (preview.kind === 'unknown_days') return { kind: 'refused', line: `No plan day called ${preview.unknown.join(', ')}; the days are ${inUse.days.map((d) => d.name).join(', ')}`, names };
    if (preview.kind === 'already') return { kind: 'refused', line: `${addEx.name} is already in ${preview.days.join(', ')}`, names };
    const nameOf = (id: string): string => of(id)?.name ?? 'Exercise';
    const timed = addEx.measurement === 'cardio' || addEx.measurement === 'duration';
    const load: Load | null = req.load === null || timed ? null : { value: req.load, unit: p.preferredUnit, convention: addEx.defaultLoadConvention };
    // (Ben, 2 Nov) A cardio or timed add's work time (and a cardio distance), as asked; reps don't apply.
    const durationS = timed && req.minutes != null && req.minutes > 0 ? Math.min(14_400, Math.max(1, Math.round(req.minutes * 60))) : undefined;
    const distanceM = addEx.measurement === 'cardio' && req.distanceM != null && req.distanceM > 0 ? Math.min(100_000, Math.round(req.distanceM)) : undefined;
    const days = preview.days.map((d) => {
      const rows = [...(inUse.days.find((x) => x.routineId === d.routineId)?.rows ?? [])].sort((a, b) => a.order - b.order);
      const before = rows.map((r) => nameOf(r.exerciseId).slice(0, 120));
      const at = d.first === true ? 0 : d.beforeRowId !== undefined ? rows.findIndex((r) => r.id === d.beforeRowId) : d.afterRowId === null ? rows.length : rows.findIndex((r) => r.id === d.afterRowId) + 1;
      const after = [...before.slice(0, at), addEx.name.slice(0, 120), ...before.slice(at)];
      const afterName = d.afterRowId === null ? null : nameOf(rows.find((r) => r.id === d.afterRowId)?.exerciseId ?? '').slice(0, 120);
      const place = d.first === true ? { first: true } : d.beforeRowId !== undefined ? { beforeRowId: d.beforeRowId } : {};
      return { routineId: d.routineId, routineName: d.routineName.slice(0, 120), versionBefore: d.versionBefore, edits: [{ kind: 'add' as const, rowId: d.rowId, afterRowId: d.afterRowId, afterName, ...place }], before: before.slice(0, 30), after: after.slice(0, 30) };
    });
    return { kind: 'ok', part: { addEx, afterEx, beforeEx, first: position === 'first', sets: req.sets, reps: timed ? null : req.reps, load, ...(durationS === undefined ? {} : { durationS }), ...(distanceM === undefined ? {} : { distanceM }), days } };
  }

  /**
   * (Ben, 31 Oct) The proposal for adding `req.add` to the named days at its place, after the checks; or why not.
   * (Ben, 2 Nov: "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days") With `also`, more adds
   * in the same proposal, each into its own days (a day takes one add): one card, one Apply, one Undo. Their days carry
   * their own add (`days[].add`); the first add's days use the top-level fields.
   */
  async function proposeAdd(p: UserProfile, req: PlanAddRequest): Promise<PlanSwapPrepared> {
    const { of } = await pool(p);
    const inUse = await planInUse(p);
    if (inUse === null) return { kind: 'refused', line: 'No plan in use', names: { remove: '', add: of(req.add)?.name ?? req.add } };
    const parts: (PlanAddPart & { load: number | null })[] = [{ ...req, load: req.load }, ...(req.also ?? []).map((x) => ({ ...x, load: null }))];
    // A day named for two adds: refused (one add per day per proposal), so each day is one versioned write.
    const key = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
    const seen = new Set<string>();
    for (const part of parts) {
      for (const d of new Set(part.days.map(key))) {
        if (seen.has(d)) return { kind: 'refused', line: `${part.days.find((x) => key(x) === d) ?? d} is named for two adds; one add per day`, names: { remove: '', add: of(req.add)?.name ?? req.add } };
        seen.add(d);
      }
    }
    const out: AddPartOut[] = [];
    for (const part of parts) {
      const r = await addPart(p, of, inUse, part);
      if (r.kind === 'refused') return r;
      out.push(r.part);
    }
    const [head, ...more] = out;
    if (head === undefined) return { kind: 'refused', line: 'Nothing to add' };
    return {
      kind: 'ok',
      detail: {
        kind: 'propose_plan_swap',
        op: 'add',
        planId: inUse.plan.id,
        planName: inUse.plan.name.slice(0, 120),
        addId: head.addEx.id,
        addName: head.addEx.name.slice(0, 120),
        afterId: head.afterEx?.id ?? null,
        afterName: head.afterEx === null ? null : head.afterEx.name.slice(0, 120),
        sets: head.sets,
        reps: head.reps,
        load: head.load,
        ...(head.first ? { position: 'first' as const } : head.beforeEx !== null ? { position: 'before' as const, beforeId: head.beforeEx.id, beforeName: head.beforeEx.name.slice(0, 120) } : {}),
        ...(head.durationS === undefined ? {} : { durationS: head.durationS }),
        ...(head.distanceM === undefined ? {} : { distanceM: head.distanceM }),
        ...(req.notIncluded == null ? {} : { notIncluded: req.notIncluded.slice(0, 160) }),
        days: [
          ...head.days,
          ...more.flatMap((m) =>
            m.days.map((d) => ({
              ...d,
              add: {
                id: m.addEx.id,
                name: m.addEx.name.slice(0, 120),
                sets: m.sets,
                reps: m.reps,
                ...(m.durationS === undefined ? {} : { durationS: m.durationS }),
                ...(m.distanceM === undefined ? {} : { distanceM: m.distanceM }),
                ...(m.beforeEx === null ? {} : { beforeName: m.beforeEx.name.slice(0, 120) }),
              },
            })),
          ),
        ].slice(0, 28),
        today: null,
      },
    };
  }

  /** (Ben, 1 Nov) The proposal for one plan day's change, after the checks; or why not, in one line. */
  async function proposeDayEdit(p: UserProfile, req: PlanDayEditRequest): Promise<PlanSwapPrepared> {
    const { of } = await pool(p);
    const inUse = await planInUse(p);
    const names = { remove: '', add: req.day };
    if (inUse === null) return { kind: 'refused', line: 'No plan in use', names };
    const key = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
    const day = inUse.days.find((d) => key(d.name) === key(req.day));
    if (day === undefined) return { kind: 'refused', line: `No plan day called ${req.day}; the days are ${inUse.days.map((d) => d.name).join(', ')}`, names };
    const idOf = (x: string): string | null => of(x)?.id ?? null;
    const unknown = [...(req.order ?? []), ...req.changes.map((c) => c.exercise)].filter((x) => idOf(x) === null);
    if (unknown.length > 0) return { kind: 'refused', line: `${unknown.join(', ')} isn’t an exercise in ${day.name}; use catalogueIds from plan.inUse.days`, names };
    const rows = day.routine.exercises;
    const nameOf = (id: string): string => of(id)?.name ?? 'Exercise';
    const preview = planDayEditPreview(rows, {
      order: req.order === null ? null : req.order.map((x) => idOf(x) ?? x),
      changes: req.changes.map((c) => {
        const id = idOf(c.exercise) ?? c.exercise;
        return { exerciseId: id, sets: c.sets, reps: c.reps, targetRpe: c.targetRpe, main: c.main, load: c.load === null ? null : { value: c.load, unit: p.preferredUnit, convention: of(id)?.defaultLoadConvention ?? 'total' } };
      }),
    });
    if (preview.kind === 'order_mismatch') return { kind: 'refused', line: `The order must list every exercise of ${day.name} once: ${[...rows].sort((a, b) => a.order - b.order).map((r) => of(r.exerciseId)?.catalogueKey ?? r.exerciseId).join(', ')}`, names };
    if (preview.kind === 'not_in_day') return { kind: 'refused', line: `${preview.exerciseIds.map(nameOf).join(', ')} isn’t in ${day.name}`, names };
    if (preview.kind === 'splits_superset') return { kind: 'refused', line: `That order splits a superset in ${day.name}`, names };
    if (preview.kind === 'no_change') return { kind: 'refused', line: `${day.name} is already like that`, names };
    // The held-for-pain check (rule 9): never more work on a flagged movement.
    const flagged = await flagsNow(p);
    const more = preview.edit.rows.find((r) => {
      const row = rows.find((x) => x.id === r.rowId);
      return row !== undefined && flagged(row.exerciseId) && ((r.sets ?? 0) > row.setTemplates.filter((t) => t.setType !== 'warmup').length || r.load !== undefined || (r.targetRpe ?? 0) > (row.setTemplates.find((t) => t.setType !== 'warmup')?.targetRpe ?? 10));
    });
    if (more !== undefined) return { kind: 'refused', line: `${nameOf(rows.find((x) => x.id === more.rowId)?.exerciseId ?? '')} has a pain flag`, names };
    const sorted = [...rows].sort((a, b) => a.order - b.order);
    const before = sorted.map((r) => nameOf(r.exerciseId).slice(0, 120));
    const afterRows = preview.edit.order === null ? sorted : preview.edit.order.map((id) => sorted.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
    const after = afterRows.map((r) => nameOf(r.exerciseId).slice(0, 120));
    const lines = [...(preview.edit.order === null ? [] : [`Order: ${after.join(', ')}`]), ...preview.edit.rows.map((c) => dayEditLine(rows.find((x) => x.id === c.rowId), c, nameOf))].map((l) => l.slice(0, 200));
    const head = rows.find((x) => x.id === (preview.edit.rows[0]?.rowId ?? preview.edit.order?.[0]));
    return {
      kind: 'ok',
      detail: {
        kind: 'propose_plan_swap',
        op: 'day_edit',
        planId: inUse.plan.id,
        planName: inUse.plan.name.slice(0, 120),
        addId: head?.exerciseId ?? day.routineId,
        addName: (head === undefined ? day.name : nameOf(head.exerciseId)).slice(0, 120),
        days: [{ routineId: day.routineId, routineName: day.name.slice(0, 120), versionBefore: day.version, edits: [{ kind: 'edit', rowId: head?.id ?? sorted[0]?.id ?? day.routineId }], before: before.slice(0, 30), after: after.slice(0, 30) }],
        dayEdit: { order: preview.edit.order, rows: preview.edit.rows, lines },
        today: null,
      },
    };
  }

  /**
   * What replaces a not-preferred exercise (catalogue keys): his own pick on its question, else the first catalogue
   * substitute usable here, not held for pain, not itself not preferred and (2 Nov, the muscle balance) leading with the
   * same muscle group. Null: nothing fits.
   */
  async function replacementFor(p: UserProfile, of: (x: string) => Exercise | null, key: string, answers: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>, all: readonly Exercise[] = []): Promise<string | null> {
    const flagged = await flagsNow(p);
    const out = of(key);
    // (Ben, 2 Nov) Best first: the catalogue's substitutes, then the plan builder's other options for the same slot (Any
    // preferences' question), then the same movement family (get_substitutions' own sources).
    const slot = PB_PREF_QUESTIONS.filter((q) => q.opts.some((o) => o.includes(key))).flatMap((q) => [...q.opts.flat(), ...q.other]);
    const family = out?.family === undefined ? [] : all.filter((e) => e.family === out.family && e.id !== out.id && e.measurement === out.measurement).map((e) => e.catalogueKey ?? e.id).sort();
    const alternatives = [...new Set([...(deps.catalogueSubstitutions?.(key) ?? []).filter((k): k is string => k !== null), ...slot, ...family])].filter((k) => k !== key && (out === null || sameGroup(out, of(k))));
    const usable = new Map<string, boolean>();
    for (const k of [...alternatives, ...pickedKeys(answers)]) {
      const x = of(k);
      usable.set(k, x !== null && !isArchivedExercise(x) && (await deps.usableHere(x).catch(() => false)));
    }
    return pbNotPreferredReplacement(key, answers, { usable: (k) => usable.get(k) ?? false, held: (k) => flagged(of(k)?.id ?? k), alternatives });
  }

  async function owner(): Promise<UserProfile | null> {
    return deps.profile().catch(() => null);
  }

  async function proposal(actionId: string): Promise<{ p: UserProfile; record: ActionRecord; d: PlanSwapDetail } | null> {
    const p = await owner();
    const record = await repos().coach.getAction(actionId).catch(() => null);
    if (p === null || record === null || record.detail.kind !== 'propose_plan_swap' || record.status !== 'proposed') return null;
    return { p, record, d: record.detail };
  }

  /** Each day's writes for a proposal, in order, and whether each is there and still in use. */
  async function writes(actionId: string, d: PlanSwapDetail): Promise<{ id: string; there: boolean; undone: boolean }[]> {
    const out: { id: string; there: boolean; undone: boolean }[] = [];
    for (const day of d.days) {
      for (let i = 0; i < day.edits.length; i += 1) {
        const id = planSwapWriteId(actionId, day.routineId, i);
        const r = await repos().coach.getAction(id).catch(() => null);
        out.push({ id, there: r !== null && r.status === 'committed', undone: r?.undoneBy != null });
      }
    }
    return out;
  }

  async function revertAll(ids: readonly string[], opId: string): Promise<boolean> {
    let ok = true;
    for (const [i, id] of [...ids].reverse().entries()) {
      const r = await deps.revertRoutine({ actionId: id, opId: `${opId}:${String(i)}` }).catch(() => ({ ok: false }));
      ok = ok && r.ok;
    }
    return ok;
  }

  return {
    /** YOUR DATA: each plan day's exercises (catalogueIds) and his not-preferred exercises. Null: no plan in use. */
    async context(): Promise<{ days: { name: string; exercises: { catalogueId: string; name: string; sets?: number; reps?: string; targetRpe?: number; main?: boolean }[] }[]; notPreferred: { catalogueId: string; name: string }[] } | null> {
      const p = await owner();
      if (p === null) return null;
      const inUse = await planInUse(p);
      if (inUse === null) return null;
      const { of } = await pool(p);
      const cid = (id: string) => of(id)?.catalogueKey ?? id;
      // (Ben, 1 Nov) Each exercise's working sets, reps, target RPE and main mark: what `propose_plan_day_edit` changes.
      const days = inUse.days.map((d) => ({ name: d.name, exercises: [...d.routine.exercises].sort((a, b) => a.order - b.order).map((r) => ({ catalogueId: cid(r.exerciseId), name: of(r.exerciseId)?.name ?? 'Exercise', ...rowShape(r) })) }));
      const no = notPreferredIds(answersOf(inUse.plan), of);
      return { days, notPreferred: [...no.entries()].map(([id, key]) => ({ catalogueId: key, name: of(id)?.name ?? key })) };
    },

    /** The coach's `propose_plan_swap` (catalogueIds or exercise IDs). */
    async prepare(req: { remove: string; add: string }): Promise<PlanSwapPrepared> {
      const p = await owner();
      if (p === null) return { kind: 'refused', line: 'No plan in use' };
      return propose(p, req, { flip: true });
    },

    /** (Ben, 31 Oct) The coach's `propose_plan_add` (catalogueIds or exercise IDs). */
    async prepareAdd(req: PlanAddRequest): Promise<PlanSwapPrepared> {
      const p = await owner();
      if (p === null) return { kind: 'refused', line: 'No plan in use' };
      return proposeAdd(p, req);
    },

    /** (Ben, 1 Nov) The coach's `propose_plan_day_edit` (catalogueIds or exercise IDs). */
    async prepareDayEdit(req: PlanDayEditRequest): Promise<PlanSwapPrepared> {
      const p = await owner();
      if (p === null) return { kind: 'refused', line: 'No plan in use' };
      return proposeDayEdit(p, req);
    },

    /**
     * (Ben, 2 Nov) The coach's `set_exercise_preference` with not preferred: the plan swap that takes `key` out of every
     * plan day that has it, under the new preferences `answers`. The substitute: the coach's `swapTo` (from
     * get_substitutions) when it is usable here, not held for pain, not itself not preferred and trains the same muscle
     * group; else what Replace would pick. Never written here: the coach saves the proposal. Null: not in the plan, or
     * nothing fits.
     */
    async swapOut(req: { key: string; swapTo: string | null; answers: PbPrefParts }): Promise<PlanSwapPrepared | null> {
      const p = await owner();
      if (p === null) return null;
      const inUse = await planInUse(p);
      if (inUse === null) return null;
      const { all, of } = await pool(p);
      const out = of(req.key);
      if (out === null || !inUse.days.some((d) => d.rows.some((r) => r.exerciseId === out.id))) return null;
      const no = notPreferredIds(req.answers, of);
      const flagged = await flagsNow(p);
      const fits = async (x: Exercise | null): Promise<boolean> => x !== null && x.id !== out.id && !isArchivedExercise(x) && !no.has(x.id) && !flagged(x.id) && (await deps.usableHere(x).catch(() => false));
      const wanted = req.swapTo === null ? null : of(req.swapTo);
      let pick: Exercise | null = wanted !== null && (await fits(wanted)) && sameGroup(out, wanted) ? wanted : null;
      if (pick === null) {
        const r = await replacementFor(p, of, req.key, req.answers, all);
        pick = r === null ? null : of(r);
      }
      if (pick === null) return null;
      return propose(p, { remove: out.id, add: pick.id }, { flip: false });
    },

    /**
     * Settings (Any preferences): each exercise these answers mark not preferred that the plan in use has, its days and
     * what Replace would put in. Empty: none, or no plan in use.
     */
    async inPlan(answers: Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>): Promise<NotPreferredInPlan[]> {
      const p = await owner();
      if (p === null) return [];
      const inUse = await planInUse(p);
      if (inUse === null) return [];
      const { all, of } = await pool(p);
      const no = notPreferredIds(answers, of);
      const out: NotPreferredInPlan[] = [];
      for (const hit of notPreferredInPlan(new Set(no.keys()), inUse.days)) {
        const e = of(hit.exerciseId);
        const key = no.get(hit.exerciseId) ?? e?.catalogueKey ?? hit.exerciseId;
        const pick = await replacementFor(p, of, key, answers, all);
        out.push({ key, name: e?.name ?? key, days: hit.days, replacement: pick === null ? null : { key: pick, name: of(pick)?.name ?? pick } });
      }
      return out;
    },

    /** Settings' Replace: the same plan-wide swap proposal, made by Ben's tap (no model). Its action ID, or why not. */
    async replace(req: { key: string; replacementKey: string; opId: string }): Promise<{ ok: true; actionId: string } | { ok: false; line: string }> {
      const p = await owner();
      if (p === null) return { ok: false, line: PLAN_SWAP_COPY.stale };
      const actionId = deriveId(`plan-swap-replace:${req.opId}`);
      const existing = await repos().coach.getAction(actionId).catch(() => null);
      if (existing !== null) return { ok: true, actionId };
      const r = await propose(p, { remove: req.key, add: req.replacementKey }, { flip: false });
      if (r.kind === 'refused') return { ok: false, line: `${r.line}.` };
      const at = deps.now();
      const record: ActionRecord = { actionId, turnId: null, opId: req.opId, status: 'proposed', author: 'ben', detail: r.detail, failure: null, reason: null, evidenceRefs: [], guardNotes: [], entityVersions: [], undoneBy: null, createdAt: at };
      const saved = await repos().coach.commit(p.id, { kind: 'record', action: record });
      return saved.status === 'conflict' ? { ok: false, line: PLAN_SWAP_COPY.failed } : { ok: true, actionId };
    },

    /** The proposal's record (Settings shows its card after Replace). */
    async record(actionId: string): Promise<ActionRecord | null> {
      return (await proposal(actionId))?.record ?? null;
    },

    async card(actionId: string): Promise<PlanSwapCardState> {
      const x = await proposal(actionId);
      if (x === null) return { kind: 'gone' };
      const w = await writes(actionId, x.d);
      const live = await repos().sessions.get(x.d.today?.sessionId ?? NO_SESSION).catch(() => null);
      // Today too: done while the swap it made is in effect (Undo puts the row back); open while the row is still all to do.
      const row = live?.session.status === 'active' ? live.exercises.find((e) => e.id === x.d.today?.sessionExerciseId) : undefined;
      const rowSets = row === undefined ? [] : (live?.sets ?? []).filter((t) => t.sessionExerciseId === row.id && t.status !== 'deleted');
      const today = row === undefined ? null : row.removed?.opId === todayOpId(actionId) ? 'done' : row.removed === undefined && rowSets.length > 0 && rowSets.every((t) => t.status === 'pending') ? 'open' : null;
      const kind = w.length > 0 && w.every((a) => a.there && !a.undone) ? 'applied' : w.length > 0 && w.every((a) => a.there) ? 'undone' : 'open';
      return { kind, today };
    },

    /** Apply (Ben's tap): every day's one change, or none (a day changed since: `Out of date`, anything written put back). */
    async apply(actionId: string): Promise<{ ok: true } | { ok: false; line: string }> {
      const x = await proposal(actionId);
      if (x === null) return { ok: false, line: PLAN_SWAP_COPY.stale };
      // (Ben, 1 Nov) A day edit: one versioned write of the day (a double tap or a restart writes once, rule 5).
      if (x.d.op === 'day_edit') {
        const day = x.d.days[0];
        const edit = x.d.dayEdit;
        if (day === undefined || edit === undefined || deps.editDayRowsEveryWeek === undefined) return { ok: false, line: PLAN_SWAP_COPY.stale };
        const r = await deps.editDayRowsEveryWeek({ routineId: day.routineId, expectedVersion: day.versionBefore, opId: planSwapOpId(actionId, day.routineId, 0), edit: { order: edit.order, rows: edit.rows }, lines: edit.lines }).catch(() => ({ ok: false as const, reason: 'failed', message: PLAN_SWAP_COPY.failed }));
        return r.ok ? { ok: true } : { ok: false, line: r.reason === 'failed' ? PLAN_SWAP_COPY.failed : PLAN_SWAP_COPY.stale };
      }
      const done: string[] = [];
      for (const day of x.d.days) {
        let expected = day.versionBefore;
        const own = day.add === undefined ? { id: x.d.addId, sets: x.d.sets, reps: x.d.reps, load: x.d.load ?? null, durationS: x.d.durationS, distanceM: x.d.distanceM } : { ...day.add, load: null };
        for (const [i, e] of day.edits.entries()) {
          if (e.kind === 'edit') continue;
          const edit =
            e.kind === 'add'
              ? {
                  kind: 'add' as const,
                  rowId: e.rowId,
                  fromExerciseId: null,
                  // (Ben, 2 Nov) A day of a second add (`days[].add`) takes its own exercise and target.
                  toExerciseId: own.id,
                  afterRowId: e.afterRowId ?? null,
                  ...(own.sets === undefined ? {} : { sets: own.sets }),
                  ...(own.reps == null ? {} : { reps: own.reps }),
                  load: own.load,
                  // (Ben, 2 Nov) Its place in the day and a cardio or timed target.
                  ...(e.first === true ? { first: true } : {}),
                  ...(e.beforeRowId === undefined ? {} : { beforeRowId: e.beforeRowId }),
                  ...(own.durationS === undefined ? {} : { durationS: own.durationS }),
                  ...(own.distanceM === undefined ? {} : { distanceM: own.distanceM }),
                }
              : { kind: e.kind, rowId: e.rowId, fromExerciseId: x.d.removeId ?? null, toExerciseId: e.kind === 'swap' ? x.d.addId : null };
          const r = await deps.editDayEveryWeek({ routineId: day.routineId, expectedVersion: expected, opId: planSwapOpId(actionId, day.routineId, i), edit }).catch(() => ({ ok: false as const, reason: 'failed', message: PLAN_SWAP_COPY.failed }));
          if (!r.ok) {
            await revertAll(done, `plan-swap-rollback:${actionId}`);
            return { ok: false, line: r.reason === 'failed' ? PLAN_SWAP_COPY.failed : PLAN_SWAP_COPY.stale };
          }
          if (!r.duplicate) done.push(r.actionId);
          expected = r.routine.version;
        }
      }
      return { ok: true };
    },

    /** Undo of that Apply: each day's routine back as it was, only while nothing changed since. */
    async undo(actionId: string, opId: string): Promise<boolean> {
      const x = await proposal(actionId);
      if (x === null) return false;
      const w = await writes(actionId, x.d);
      if (!w.every((a) => a.there)) return false;
      return revertAll(w.filter((a) => !a.undone).map((a) => a.id), opId);
    },

    /** `Today too`: the live workout's row swapped now (its own change; Undo puts it back while none of it is done). */
    async today(actionId: string): Promise<boolean> {
      const x = await proposal(actionId);
      if (x?.d.today == null || deps.swapToday === undefined) return false;
      const r = await deps.swapToday({ sessionId: x.d.today.sessionId, sessionExerciseId: x.d.today.sessionExerciseId, exerciseId: x.d.addId, opId: todayOpId(actionId) }).catch(() => ({ ok: false }));
      return r.ok;
    },

    async undoToday(actionId: string): Promise<boolean> {
      const x = await proposal(actionId);
      if (x?.d.today == null || deps.undoToday === undefined) return false;
      const r = await deps.undoToday({ sessionId: x.d.today.sessionId, targetOpId: todayOpId(actionId) }).catch(() => ({ ok: false }));
      return r.ok;
    },
  };
}

/** (Ben, 1 Nov) A plan row's working sets, reps, target RPE and main mark, as the coach reads them. */
function rowShape(r: Routine['exercises'][number]): { sets: number; reps?: string; targetRpe?: number; main?: boolean } {
  const work = r.setTemplates.filter((t) => t.setType !== 'warmup');
  const reps = work[0]?.targetReps ?? null;
  const rpe = work[0]?.targetRpe ?? null;
  return { sets: work.length, ...(reps === null ? {} : { reps: reps.min === reps.max ? String(reps.min) : `${String(reps.min)}–${String(reps.max)}` }), ...(rpe === null ? {} : { targetRpe: rpe }), ...(r.main === undefined ? {} : { main: r.main }) };
}

/** (Ben, 1 Nov) One line per changed exercise: `Dumbbell bench press: 3 → 2 sets · RPE 8 → 7 · secondary`. */
function dayEditLine(row: Routine['exercises'][number] | undefined, c: PlanDayEdit['rows'][number], nameOf: (id: string) => string): string {
  if (row === undefined) return 'Exercise';
  const was = rowShape(row);
  const reps = (r: { min: number; max: number }) => (r.min === r.max ? String(r.min) : `${String(r.min)}–${String(r.max)}`);
  const parts = [
    ...(c.sets === undefined ? [] : [`${String(was.sets)} → ${String(c.sets)} sets`]),
    ...(c.reps === undefined ? [] : [`${was.reps === undefined ? '' : `${was.reps} → `}${reps(c.reps)} reps`]),
    ...(c.targetRpe === undefined ? [] : [`RPE ${was.targetRpe === undefined ? '' : `${String(was.targetRpe)} → `}${String(c.targetRpe)}`]),
    ...(c.load === undefined ? [] : [`@ ${String(c.load.value)} ${c.load.unit}${c.load.convention === 'per_hand' ? ' each' : ''}`]),
    ...(c.main === undefined ? [] : [c.main ? 'main lift' : 'secondary']),
  ];
  return `${nameOf(row.exerciseId)}: ${parts.join(' · ')}`;
}

/** (Ben, 2 Nov) The muscle balance: a substitute leads with the same muscle group (either unknown: allowed). */
function sameGroup(a: Exercise, b: Exercise | null): boolean {
  if (b === null) return false;
  const ga = directMuscleGroup(a);
  const gb = directMuscleGroup(b);
  return ga === null || gb === null || ga === gb;
}

/** Every exercise his answers pick (an option or Other), Replace's first choice. */
function pickedKeys(a: Pick<PlanBuilderAnswers, 'prefs'>): string[] {
  return Object.entries(a.prefs).flatMap(([id, v]) => (v === 'either' ? [] : typeof v === 'object' ? [v.other] : [...(PB_PREF_QUESTIONS.find((q) => q.id === id)?.opts[v] ?? [])]));
}

export type PlanSwapService = ReturnType<typeof createPlanSwapService>;
