import { isArchivedExercise, liveRoutines, pbExercisePreferenceOf, pbNotPreferred, pbPlanPrefParts, pbPrefLikes, pbSetExercisePreference, pbSetPlanPrefs, planRoutines, type ExercisePreference, type PbPrefParts } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, Exercise, Routine, SetExercisePreferenceArgs, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { ExercisePrefPrepared, PlanSwapPrepared } from '@fizz/coach';

/**
 * (Ben, 2 Nov: "I don't like leg extensions, take them out") The coach's `set_exercise_preference`: one exercise's
 * preference on **Any preferences** of the plan in use (the plan builder's answers; Plan setup › Any preferences shows
 * the same ones, and the builder, the plan swap and Rebalance read them). Local only, no AI.
 *
 * `prepare` reads the plan in use, finds the exercise (a name or catalogueId, his own or the catalogue's, the plan's
 * first), makes the change (`pbSetExercisePreference`) as the plan's next version (`pbSetPlanPrefs`, rule 5) and, for a
 * newly not-preferred exercise his plan has, the plan swap out of every day that has it (`planSwap.swapOut`: the
 * `propose_plan_swap` engine, a proposal). Nothing is written here: the coach writes the preference with its record in
 * one transaction, then the proposal.
 */

export interface ExercisePrefsDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  catalogueExercises?: () => readonly Exercise[];
  /** Profile › Likes & dislikes writes (the coach's carry their own time). */
  now: () => ZonedTimestamp;
  /** The plan swap for a not-preferred exercise under the new preferences (plan-swap service). */
  swapOut: (req: { key: string; swapTo: string | null; answers: PbPrefParts }) => Promise<PlanSwapPrepared | null>;
}

export const EXERCISE_PREF_COPY = {
  word: (p: ExercisePreference): string => (p === 'not_preferred' ? 'not preferred' : p === 'preferred' ? 'preferred' : 'no preference'),
  noBuilderPlan: 'No plan from the plan builder is in use, so there are no plan preferences to set; a plan swap or a memory can still do it.',
  /** Profile › Training: the row, the screen and its two lists (Ben, 2 Nov). */
  title: 'Likes & dislikes',
  liked: 'Liked',
  notPreferred: 'Not preferred',
  add: 'Add',
  remove: 'Remove',
  none: 'None',
  /** The row with no builder plan in use: nothing to show or set (the preferences live on that plan's answers). */
  noPlan: 'No plan',
  notThisPlan: 'Not on this plan',
  counts: (liked: number, no: number): string => (liked + no === 0 ? 'None' : `${String(liked)} liked · ${String(no)} not preferred`),
  stale: 'Your plan changed just now; try again.',
  tooMany: 'Too many saved (30); remove one first.',
  failed: 'Couldn’t save.',
} as const;

export interface ExercisePrefItem {
  /** Catalogue key, or an exercise ID for one of his own (as the answers hold it). */
  key: string;
  name: string;
}

/**
 * Profile › Likes & dislikes (Ben, 2 Nov): the plan in use's Any preferences as two lists. `liked`: what the builder
 * favours (Others I like and the picked question options); `notPreferred`: what it leaves out (`never` and the options
 * not picked). `parts`: the answers' preference parts (Replace's offer reads them). `none`: no plan in use, or one the
 * plan builder didn't make (its preferences live on a builder plan's answers; there is no second store).
 */
export type ExercisePrefsView =
  | { kind: 'ready'; planId: string; version: number; liked: ExercisePrefItem[]; notPreferred: ExercisePrefItem[]; parts: PbPrefParts }
  | { kind: 'none'; why: 'no_plan' | 'not_builder' };

export type ExercisePrefsSetResult = { ok: true; view: ExercisePrefsView } | { ok: false; reason: 'stale' | 'too_many' | 'no_plan' | 'missing'; line: string; view: ExercisePrefsView | null };

/** "leg extensions" → "leg extension"; "Leg Extension" → "leg extension". */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\w{3,})s\b/g, '$1');
}

export function createExercisePrefsService(deps: ExercisePrefsDeps) {
  const repos = () => deps.store().repos;

  async function pool(p: UserProfile): Promise<Exercise[]> {
    const byId = new Map<string, Exercise>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) if ((e.ownerId === null || e.ownerId === p.id) && !isArchivedExercise(e)) byId.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()];
  }

  /** The exercise Ben named: by ID or catalogue key, else by name (the plan's own first). */
  function find(all: readonly Exercise[], inPlan: ReadonlySet<string>, named: string): Exercise | null {
    const exact = all.find((e) => e.id === named || e.catalogueKey === named);
    if (exact !== undefined) return exact;
    const want = norm(named);
    if (want === '') return null;
    const first = (xs: Exercise[]) => xs.find((e) => inPlan.has(e.id)) ?? xs[0] ?? null;
    const same = all.filter((e) => norm(e.name) === want);
    if (same.length > 0) return first(same);
    const contains = all.filter((e) => norm(e.name).includes(want) || want.includes(norm(e.name)));
    return contains.length === 0 ? null : first(contains.sort((a, b) => a.name.length - b.name.length));
  }

  async function viewFor(p: UserProfile): Promise<ExercisePrefsView> {
    const plan = await repos().planDrafts.applied(p.id);
    if (plan === null) return { kind: 'none', why: 'no_plan' };
    const parts = pbPlanPrefParts(plan);
    if (parts === null) return { kind: 'none', why: 'not_builder' };
    const all = await pool(p);
    const byKey = new Map<string, string>();
    for (const e of all) {
      if (e.catalogueKey != null && !byKey.has(e.catalogueKey)) byKey.set(e.catalogueKey, e.name);
      if (!byKey.has(e.id)) byKey.set(e.id, e.name);
    }
    const items = (keys: Iterable<string>): ExercisePrefItem[] =>
      [...new Set(keys)].map((key) => ({ key, name: byKey.get(key) ?? key })).sort((a, b) => a.name.localeCompare(b.name));
    const no = pbNotPreferred(parts);
    return { kind: 'ready', planId: plan.id, version: plan.version, liked: items(pbPrefLikes(parts).filter((k) => !no.has(k))), notPreferred: items(no), parts };
  }

  return {
    /**
     * Profile › Likes & dislikes: the plan in use's preferences, read from its answers (the same ones Plan setup's Any
     * preferences edits and the coach's `set_exercise_preference` writes).
     */
    async view(): Promise<ExercisePrefsView> {
      const p = await deps.profile();
      if (p === null) return { kind: 'none', why: 'no_plan' };
      return viewFor(p);
    },

    /**
     * Profile's add (`preferred` / `not_preferred`) and remove (`none`) for one exercise (an exercise ID from the
     * picker, or a key from a list): the same change as the coach's (`pbSetExercisePreference`), on the plan version
     * the screen read (rule 5: a newer plan is refused, never written over), once per `opId` (a retry after a
     * force-close writes nothing more).
     */
    async set(req: { exercise: string; preference: ExercisePreference; expectedVersion: number; opId: string }): Promise<ExercisePrefsSetResult> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'no_plan', line: EXERCISE_PREF_COPY.noPlan, view: null };
      const plan = await repos().planDrafts.applied(p.id);
      const parts = plan === null ? null : pbPlanPrefParts(plan);
      if (plan === null || parts === null) return { ok: false, reason: 'no_plan', line: EXERCISE_PREF_COPY.noPlan, view: await viewFor(p) };
      if (plan.opIds.includes(req.opId)) return { ok: true, view: await viewFor(p) };
      if (plan.version !== req.expectedVersion) return { ok: false, reason: 'stale', line: EXERCISE_PREF_COPY.stale, view: await viewFor(p) };
      const e = (await pool(p)).find((x) => x.id === req.exercise || x.catalogueKey === req.exercise);
      // A key the answers hold but no exercise has any more can still be removed.
      const key = e === undefined ? (req.preference === 'none' ? req.exercise : null) : (e.catalogueKey ?? e.id).slice(0, 80);
      if (key === null) return { ok: false, reason: 'missing', line: EXERCISE_PREF_COPY.failed, view: await viewFor(p) };
      const r = pbSetExercisePreference(parts, key, req.preference);
      if (r.kind === 'too_many') return { ok: false, reason: 'too_many', line: EXERCISE_PREF_COPY.tooMany, view: await viewFor(p) };
      if (r.kind === 'already') return { ok: true, view: await viewFor(p) };
      const at = deps.now();
      const w = await repos().planDrafts.write(p.id, plan.id, (current) => pbSetPlanPrefs(current, { expectedVersion: req.expectedVersion, opId: req.opId, at, parts: r.parts }));
      if (w.status === 'written' || w.status === 'replayed') return { ok: true, view: await viewFor(p) };
      return { ok: false, reason: 'stale', line: EXERCISE_PREF_COPY.stale, view: await viewFor(p) };
    },

    /** Whether the tool has anything to act on: a builder plan in use (its answers hold the preferences). */
    async available(): Promise<boolean> {
      const p = await deps.profile().catch(() => null);
      if (p === null) return false;
      const plan = await repos().planDrafts.applied(p.id).catch(() => null);
      return plan !== null && pbPlanPrefParts(plan) !== null;
    },

    async prepare(args: SetExercisePreferenceArgs, at: { opId: string; nowUtc: string; tz: string }): Promise<ExercisePrefPrepared> {
      const p = await deps.profile().catch(() => null);
      if (p === null) return { kind: 'refused', line: 'No profile yet.' };
      const plan = await repos().planDrafts.applied(p.id).catch(() => null);
      const parts = plan === null ? null : pbPlanPrefParts(plan);
      if (plan === null || parts === null) return { kind: 'refused', line: EXERCISE_PREF_COPY.noBuilderPlan };
      const routines = planRoutines(plan, liveRoutines(await repos().routines.listByOwner(p.id).catch(() => [] as Routine[])));
      const planIds = new Set(routines.flatMap((r) => r.exercises.map((e) => e.exerciseId)));
      const e = find(await pool(p), planIds, args.exercise);
      if (e === null) return { kind: 'refused', line: `No exercise called “${args.exercise.slice(0, 60)}”; use a name or catalogueId from plan.inUse.days or find_exercises.` };
      const key = (e.catalogueKey ?? e.id).slice(0, 80);
      const days = routines.filter((r) => r.exercises.some((x) => x.exerciseId === e.id)).map((r) => r.name.slice(0, 120));
      const r = pbSetExercisePreference(parts, key, args.preference);
      const swapIfOut = async (answers: PbPrefParts): Promise<Extract<ActionDetail, { kind: 'propose_plan_swap' }> | null> => {
        if (args.preference !== 'not_preferred' || days.length === 0) return null;
        const s = await deps.swapOut({ key, swapTo: args.swapTo, answers }).catch(() => null);
        return s?.kind === 'ok' ? s.detail : null;
      };
      if (r.kind === 'too_many') return { kind: 'refused', line: 'Too many likes or dislikes saved already (30); clear one first.' };
      if (r.kind === 'already') {
        const swap = await swapIfOut(parts);
        const where = days.length === 0 ? '' : ` It is in ${days.join(', ')}.`;
        return { kind: 'already', name: e.name, line: `${e.name} is already ${EXERCISE_PREF_COPY.word(pbExercisePreferenceOf(parts, key))}.${swap === null ? where : ''}`, swap };
      }
      const w = pbSetPlanPrefs(plan, { expectedVersion: plan.version, opId: at.opId, at: { utc: at.nowUtc, tz: at.tz }, parts: r.parts });
      if (w.kind !== 'write') return { kind: 'refused', line: 'Your plan changed just now; try again.' };
      const swap = await swapIfOut(r.parts);
      return {
        kind: 'ok',
        prepared: {
          plan: w.next,
          expectedVersion: w.expectedVersion,
          detail: { planId: plan.id, exerciseId: e.id.slice(0, 64), key, name: e.name.slice(0, 120), preference: args.preference, before: parts, after: r.parts, inPlan: days.slice(0, 14) },
          swap,
          noSwap: swap === null && args.preference === 'not_preferred' && days.length > 0 ? `Saved. ${e.name} is still in ${days.join(', ')}: no substitute for the same muscles fits here, so no swap was offered.` : null,
        },
      };
    },
  };
}

export type ExercisePrefsService = ReturnType<typeof createExercisePrefsService>;
