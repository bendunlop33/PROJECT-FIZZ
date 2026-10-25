import {
  currentDraftVersion,
  currentGymEquipment,
  doableHere,
  inPickerScope,
  isArchivedExercise,
  mayHurtAccessibility,
  mayHurtConfirm,
  painFlagCovering,
  toMs,
  type PickerEntry,
  type PickerIndex,
  type PickerScope,
} from '@fizz/domain';
import type { SqliteRepositories } from '@fizz/persistence';
import type { EquipmentInstance, Exercise, PainFlag, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * (Ben, 25 Oct) The Swap / Add sheet's full list (workout-builder-v3 §2.5): every exercise the host can take
 * (the catalogue plus Ben's own, deleted ones left out), its search names (catalogue aliases and Ben's own), the
 * host gym's check (`doableHere`, as `Not at this gym` on Your workout's rows) and active pain flags (rule 9).
 * Read once when the sheet opens; search and chips are pure over it (`buildExercisePickerView`). Local reads only,
 * never the network or the coach (rule 1). Nothing is written.
 */

export interface ExercisePickerDeps {
  repos: () => SqliteRepositories;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  catalogueExercises: () => readonly Exercise[];
  catalogueAliases: (catalogueKey: string) => readonly string[];
}

type Gym = { id: string; name: string; equipment: readonly EquipmentInstance[] } | null;

export function createExercisePickerService(deps: ExercisePickerDeps) {
  const repos = deps.repos;

  async function gymById(gymId: string | null, equipment?: readonly EquipmentInstance[]): Promise<Gym> {
    if (gymId === null) return null;
    const g = await repos().gyms.get(gymId).catch(() => null);
    if (g === null) return null;
    return { id: g.id, name: g.name, equipment: equipment ?? (await repos().equipment.listByGym(g.id).catch(() => [] as EquipmentInstance[])) };
  }

  async function indexAt(p: UserProfile, gym: Gym, scope: PickerScope): Promise<PickerIndex> {
    const [saved, own, flags] = await Promise.all([
      repos().exercises.list().catch(() => [] as Exercise[]),
      repos().imports.aliases(p.id).catch(() => []),
      repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]),
    ]);
    const mine = saved.filter((e) => e.ownerId === null || e.ownerId === p.id);
    const have = new Set(mine.map((e) => e.id));
    // As Library › Exercises: Ben's saved rows (catalogue and his own), then the catalogue's not saved yet; a deleted one of his is gone.
    const all = [...mine.filter((e) => !isArchivedExercise(e)), ...deps.catalogueExercises().filter((e) => !have.has(e.id))];
    const ownNames = new Map<string, string[]>();
    for (const a of own) if (a.target.kind === 'exercise') ownNames.set(a.target.exerciseId, [...(ownNames.get(a.target.exerciseId) ?? []), a.name]);
    const at = deps.now();
    const nowMs = toMs(at.utc);
    const snapGym = gym === null ? null : { id: gym.id, name: gym.name, equipment: gym.equipment };
    const entries: PickerEntry[] = [];
    for (const exercise of all) {
      if (!inPickerScope(scope, exercise)) continue;
      const self = exercise.name.trim().toLowerCase();
      const aliases = [...new Set([...(exercise.catalogueKey ? deps.catalogueAliases(exercise.catalogueKey) : []), ...(ownNames.get(exercise.id) ?? [])])].filter((n) => n.trim().toLowerCase() !== self);
      const covering = flags.length === 0 ? null : painFlagCovering(flags, exercise.id, nowMs, at.tz);
      entries.push({
        exercise,
        aliases,
        here: snapGym === null || doableHere(exercise, snapGym),
        painFlag: covering === null ? null : { line: mayHurtConfirm({ ...covering.flag, exerciseName: exercise.name }).message, accessibilityLabel: mayHurtAccessibility(covering.flag) },
      });
    }
    return { entries, gym: gym === null ? null : { name: gym.name, equipment: gym.equipment } };
  }

  const empty: PickerIndex = { entries: [], gym: null };

  return {
    /** Your workout (a builder draft): at the draft's gym, as its rows' `Not at this gym`; strength exercises only. */
    async forDraft(draftId: string): Promise<PickerIndex> {
      const p = await deps.profile();
      if (p === null) return empty;
      const d = await repos().workoutDrafts.get(draftId).catch(() => null);
      if (d === null || d.ownerId !== p.id) return empty;
      return indexAt(p, await gymById(currentDraftVersion(d).request.gymId), { kind: 'builder' });
    },

    /** The one workout editor: at the editor's gym (null: none, nothing tagged); anything but distance. */
    async forTemplate(gymId: string | null): Promise<PickerIndex> {
      const p = await deps.profile();
      if (p === null) return empty;
      return indexAt(p, await gymById(gymId), { kind: 'template' });
    },

    /**
     * The workout in progress: at its gym as the workout has it now (its equipment snapshot, after any gym change).
     * Swap: the same measurement as the exercise being swapped; Add (`sessionExerciseId` null): anything.
     */
    async forSession(sessionId: string, sessionExerciseId: string | null): Promise<PickerIndex> {
      const p = await deps.profile();
      if (p === null) return empty;
      const a = await repos().sessions.get(sessionId).catch(() => null);
      if (a === null || a.session.ownerId !== p.id) return empty;
      const from = sessionExerciseId === null ? null : a.exercises.find((e) => e.id === sessionExerciseId);
      if (from === undefined) return empty;
      const measurement = from === null ? null : ((await repos().exercises.get(from.exerciseId).catch(() => null)) ?? deps.catalogueExercises().find((e) => e.id === from.exerciseId) ?? null)?.measurement;
      const scope: PickerScope = from === null ? { kind: 'session_add' } : { kind: 'session_swap', measurement: measurement ?? 'reps' };
      return indexAt(p, await gymById(a.session.gymId ?? null, currentGymEquipment(a.session)), scope);
    },
  };
}

export type ExercisePickerService = ReturnType<typeof createExercisePickerService>;
