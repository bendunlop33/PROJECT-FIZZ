import {
  adviseSessionChange,
  currentGymEquipment,
  fitPlanToItem,
  makeSlot,
  pendingSetsOf,
  plannedFromBuilderRows,
  type BuilderAdvice,
  type CommandOutcome,
  type TargetExplanation,
} from '@fizz/domain';
import { builderFocusSections, BUILDER_GROUPS, type BuilderGroup, type EquipmentInstance, type PlannedSet, type SessionAggregate, type SetType, type UserProfile } from '@fizz/schemas';
import type { Store } from '@fizz/persistence';

import type { BuilderEnv, BuilderEnvPort } from '../builder/builder-env';
import type { ChoiceSection } from '../ui/swap-sheet-model';
import { whyWeightLines } from './exercise-popup';

/**
 * Same editing as the builder, mid-workout (workout-table-v3 §7): the
 * builder's Swap / Add sheet (muscle-group dropdown, this gym's exercises by
 * focus with their works line, `May hurt`), loads for an added or swapped
 * exercise from the builder's load sources (§9 Q12: coach target → plan →
 * built-in rule → est. max; pain holds them, rule 9) rounded on the gym's kit
 * (rule 4), `Why this weight?`, and the builder's "not recommended" advice on
 * Ben's own changes. Every write is the workout's own versioned command
 * through `workout`; nothing here waits on the network or the coach.
 */

export interface WorkoutEditDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  env: BuilderEnvPort;
  workout: {
    addExercise: (req: { sessionId: string; exerciseId: string; equipmentId: string | null; opId: string; plan?: { setType: SetType; planned: PlannedSet }[] }) => Promise<CommandOutcome>;
    swapExercise: (req: { sessionId: string; sessionExerciseId: string; exerciseId: string; opId: string; builderPlan?: { plan: { setType: SetType; planned: PlannedSet }[]; pin: EquipmentInstance | null } }) => Promise<CommandOutcome & { fromName?: string; toName?: string }>;
    explainTarget: (sessionId: string, setId: string) => Promise<TargetExplanation | null>;
  };
}

export interface ExerciseChoices {
  group: BuilderGroup;
  groups: BuilderGroup[];
  sections: ChoiceSection[];
}

/** The groups the dropdown offers, in the builder's order. */
const GROUPS: BuilderGroup[] = [...BUILDER_GROUPS];

export function createWorkoutEditService(deps: WorkoutEditDeps) {
  const sessionOf = (sessionId: string): Promise<SessionAggregate | null> => deps.store().repos.sessions.get(sessionId).catch(() => null);

  async function envFor(a: SessionAggregate, exerciseIds: readonly string[], groups: readonly BuilderGroup[]): Promise<{ env: BuilderEnv; owner: UserProfile } | null> {
    const owner = await deps.profile();
    if (owner === null) return null;
    let n = 0;
    const env = await deps.env({ profile: owner, gymId: a.session.gymId, exerciseIds, groups, newKey: (id) => `${a.session.id}:${id}:${String((n += 1))}` });
    return { env, owner };
  }

  /**
   * The builder's rows for an exercise at this workout's gym, as planned sets fitted to the item the
   * session will log it on. Null when the builder can't plan it here (not a strength exercise, its
   * item isn't in today's equipment, another unit or convention): the caller falls back to the
   * workout's own path (the built-in rule).
   */
  function builderPlan(a: SessionAggregate, env: BuilderEnv, exerciseId: string, workingSets: number): { plan: { setType: SetType; planned: PlannedSet }[]; item: EquipmentInstance | null } | null {
    const exercise = env.exercise(exerciseId);
    if (exercise === null || exercise.measurement !== 'reps' || env.info(exerciseId) === null) return null;
    const slot = makeSlot(exerciseId, { main: false, workingSets: Math.max(1, workingSets) }, env.ctx);
    const want = env.ctx.loads(exerciseId).equipment;
    const here = currentGymEquipment(a.session);
    const item = want === null ? null : (here.find((e) => e.id === want.id) ?? null);
    if (want !== null && (item === null || item.unit !== slot.unit || item.loadConvention !== slot.convention)) return null;
    if (want === null && slot.convention !== 'bodyweight' && slot.rows.some((r) => r.load !== null)) return null;
    return { plan: fitPlanToItem(plannedFromBuilderRows(slot.rows, { unit: slot.unit, convention: slot.convention }), item), item };
  }

  return {
    /**
     * Swap / Add (builder §2.5): this gym's exercises of a group by focus with their works line,
     * minus what's in the workout; pain-flagged ones marked. The group defaults to the swapped
     * exercise's (Add: the workout's first exercise's).
     */
    async choices(sessionId: string, req: { sessionExerciseId: string | null; group?: BuilderGroup }): Promise<ExerciseChoices | null> {
      const a = await sessionOf(sessionId);
      if (a === null) return null;
      const live = a.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);
      const probe = await envFor(a, live.map((e) => e.exerciseId), []);
      if (probe === null) return null;
      const anchor = req.sessionExerciseId === null ? live[0] : live.find((e) => e.id === req.sessionExerciseId);
      const group: BuilderGroup = req.group ?? (anchor === undefined ? 'Chest' : (probe.env.info(anchor.exerciseId)?.group ?? 'Chest'));
      const got = await envFor(a, [], [group]);
      if (got === null) return null;
      const { env } = got;
      const inWorkout = new Set(live.map((e) => e.exerciseId));
      const ids = env.candidates(group).filter((id) => !inWorkout.has(id));
      const sections = builderFocusSections(
        ids.flatMap((id) => {
          const e = env.exercise(id);
          return e === null ? [] : [e];
        }),
        (e) => e,
        group,
      ).map((sec) => ({ focus: sec.focus, items: sec.items.map((e) => ({ exerciseId: e.id, name: e.name, works: env.worksOf(e.id), mayHurt: env.painFlagged(e.id), painLine: env.painLine(e.id) })) }));
      return { group, groups: GROUPS, sections };
    },

    /** `＋ Add exercise` (§7): the builder's 3 sets with its loads on this gym's item; Undo is `undo_op` on `opId`. */
    async add(sessionId: string, exerciseId: string, opId: string): Promise<CommandOutcome> {
      const a = await sessionOf(sessionId);
      const got = a === null ? null : await envFor(a, [exerciseId], []);
      const built = a === null || got === null ? null : builderPlan(a, got.env, exerciseId, 3);
      const fallbackItem = got?.env.ctx.loads(exerciseId).equipment ?? null;
      const here = a === null ? [] : currentGymEquipment(a.session);
      const equipmentId = built !== null ? (built.item?.id ?? null) : (here.find((e) => e.id === fallbackItem?.id)?.id ?? null);
      return deps.workout.addExercise({ sessionId, exerciseId, equipmentId, opId, ...(built === null ? {} : { plan: built.plan }) });
    },

    /** Swap (§7): the builder's loads for the substitute (pending sets only move; done ones stay, rule 2). */
    async swap(sessionId: string, sessionExerciseId: string, exerciseId: string, opId: string): Promise<CommandOutcome & { fromName?: string; toName?: string }> {
      const a = await sessionOf(sessionId);
      const got = a === null ? null : await envFor(a, [exerciseId], []);
      const working = a === null ? 0 : pendingSetsOf(a, sessionExerciseId).filter((s) => s.setType !== 'warmup').length;
      const built = a === null || got === null ? null : builderPlan(a, got.env, exerciseId, working);
      return deps.workout.swapExercise({ sessionId, sessionExerciseId, exerciseId, opId, ...(built === null ? {} : { builderPlan: { plan: built.plan, pin: built.item } }) });
    },

    /** `Why this weight?` (§2.4): where the next set's target came from, from what was stored with it (no rule runs). */
    async why(sessionId: string, sessionExerciseId: string): Promise<string[]> {
      const a = await sessionOf(sessionId);
      if (a === null) return [];
      const own = a.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted').sort((x, y) => x.index - y.index);
      const set = own.find((s) => s.status === 'pending' && s.setType !== 'warmup') ?? own.find((s) => s.status === 'pending') ?? own.at(-1);
      if (set === undefined) return [];
      return whyWeightLines(await deps.workout.explainTarget(sessionId, set.id).catch(() => null));
    },

    /** The builder's "not recommended" for what Ben's own change newly made (§7); null when nothing new. Never blocks. */
    async advice(before: SessionAggregate, after: SessionAggregate): Promise<BuilderAdvice | null> {
      const ids = [...new Set(after.exercises.map((e) => e.exerciseId))];
      const got = await envFor(after, ids, []).catch(() => null);
      return got === null ? null : adviseSessionChange(before, after, got.env.info);
    },
  };
}

export type WorkoutEditService = ReturnType<typeof createWorkoutEditService>;
