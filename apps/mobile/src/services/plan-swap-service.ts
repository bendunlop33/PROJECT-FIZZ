import { PB_PREF_QUESTIONS, currentPlanVersion, deriveId, liveRoutines, notPreferredInPlan, painFlagCovering, pbAppliedBuilder, pbNotPreferred, pbNotPreferredReplacement, planRoutines, planSwapDirection, planSwapPreview, toMs, isArchivedExercise, type PlanSwapDayInput } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, ActionRecord, Exercise, PainFlag, PlanBuilderAnswers, PlanDraft, Routine, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { PlanSwapPrepared } from '@fizz/coach';

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
  editDayEveryWeek: (req: { routineId: string; expectedVersion: number; opId: string; edit: { kind: 'swap' | 'remove'; rowId: string; fromExerciseId: string; toExerciseId: string | null } }) => Promise<{ ok: true; actionId: string; routine: Routine; duplicate: boolean } | { ok: false; reason: string; message: string }>;
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
    async context(): Promise<{ days: { name: string; exercises: { catalogueId: string; name: string }[] }[]; notPreferred: { catalogueId: string; name: string }[] } | null> {
      const p = await owner();
      if (p === null) return null;
      const inUse = await planInUse(p);
      if (inUse === null) return null;
      const { of } = await pool(p);
      const cid = (id: string) => of(id)?.catalogueKey ?? id;
      const days = inUse.days.map((d) => ({ name: d.name, exercises: [...d.rows].sort((a, b) => a.order - b.order).map((r) => ({ catalogueId: cid(r.exerciseId), name: of(r.exerciseId)?.name ?? 'Exercise' })) }));
      const no = notPreferredIds(answersOf(inUse.plan), of);
      return { days, notPreferred: [...no.entries()].map(([id, key]) => ({ catalogueId: key, name: of(id)?.name ?? key })) };
    },

    /** The coach's `propose_plan_swap` (catalogueIds or exercise IDs). */
    async prepare(req: { remove: string; add: string }): Promise<PlanSwapPrepared> {
      const p = await owner();
      if (p === null) return { kind: 'refused', line: 'No plan in use' };
      return propose(p, req, { flip: true });
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
      const { of } = await pool(p);
      const no = notPreferredIds(answers, of);
      const flagged = await flagsNow(p);
      const out: NotPreferredInPlan[] = [];
      for (const hit of notPreferredInPlan(new Set(no.keys()), inUse.days)) {
        const e = of(hit.exerciseId);
        const key = no.get(hit.exerciseId) ?? e?.catalogueKey ?? hit.exerciseId;
        const alternatives = (deps.catalogueSubstitutions?.(key) ?? []).filter((k): k is string => k !== null);
        const usable = new Map<string, boolean>();
        for (const k of [...alternatives, ...pickedKeys(answers)]) {
          const x = of(k);
          usable.set(k, x !== null && !isArchivedExercise(x) && (await deps.usableHere(x).catch(() => false)));
        }
        const pick = pbNotPreferredReplacement(key, answers, { usable: (k) => usable.get(k) ?? false, held: (k) => flagged(of(k)?.id ?? k), alternatives });
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

    async card(actionId: string): Promise<PlanSwapCardState> {
      const x = await proposal(actionId);
      if (x === null) return { kind: 'gone' };
      const w = await writes(actionId, x.d);
      const live = await repos().sessions.get(x.d.today?.sessionId ?? NO_SESSION).catch(() => null);
      const today = x.d.today == null ? null : live?.processedOps[todayOpId(actionId)] !== undefined ? 'done' : live?.session.status === 'active' ? 'open' : null;
      const kind = w.length > 0 && w.every((a) => a.there && !a.undone) ? 'applied' : w.length > 0 && w.every((a) => a.there) ? 'undone' : 'open';
      return { kind, today };
    },

    /** Apply (Ben's tap): every day's one change, or none (a day changed since: `Out of date`, anything written put back). */
    async apply(actionId: string): Promise<{ ok: true } | { ok: false; line: string }> {
      const x = await proposal(actionId);
      if (x === null) return { ok: false, line: PLAN_SWAP_COPY.stale };
      const done: string[] = [];
      for (const day of x.d.days) {
        let expected = day.versionBefore;
        for (const [i, e] of day.edits.entries()) {
          const r = await deps.editDayEveryWeek({ routineId: day.routineId, expectedVersion: expected, opId: planSwapOpId(actionId, day.routineId, i), edit: { kind: e.kind, rowId: e.rowId, fromExerciseId: x.d.removeId, toExerciseId: e.kind === 'swap' ? x.d.addId : null } }).catch(() => ({ ok: false as const, reason: 'failed', message: PLAN_SWAP_COPY.failed }));
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

/** Every exercise his answers pick (an option or Other), Replace's first choice. */
function pickedKeys(a: Pick<PlanBuilderAnswers, 'prefs'>): string[] {
  return Object.entries(a.prefs).flatMap(([id, v]) => (v === 'either' ? [] : typeof v === 'object' ? [v.other] : [...(PB_PREF_QUESTIONS.find((q) => q.id === id)?.opts[v] ?? [])]));
}

export type PlanSwapService = ReturnType<typeof createPlanSwapService>;
