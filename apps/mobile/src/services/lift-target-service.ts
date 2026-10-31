import {
  canAddLiftTarget,
  liftSetsOf,
  liftTargetChartValue,
  liftTargetChoices,
  liftTargetCoachView,
  liftTargetCoachViewUnread,
  liftTargetLine,
  liftTargetLineUnread,
  liftTargetProblem,
  liftTargetsInUse,
  liftTargetStatus,
  localDateOf,
  keepSameLiftTarget,
  newLiftTarget,
  toMs,
  type ExerciseDetailView,
  type ExerciseMetric,
  type LiftSet,
  type LiftTargetChoice,
  type LiftTargetCoachView,
  type LiftTargetLine,
  type ProgressSession,
} from '@fizz/domain';
import type { Exercise, LiftTarget, LiftTargetKind, SetLiftTargetArgs, TrainingProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';
import type { PreparedLiftTarget } from '@fizz/coach';

import type { TrainingService, TrainingWriteOutcome } from './training-service';

/**
 * Lift targets (Ben approved 20 Oct: "Yeah let's do lift targets as something that can be turned
 * on or off"). Your data, local only, no AI. Screens and the coach read the same values from
 * here; nothing is computed in a screen. Every write is one versioned training-profile change on
 * the version the screen showed, with the tap's operation ID (rule 5); Undo is one more.
 */

export interface LiftTargetServiceDeps {
  training: Pick<TrainingService, 'snapshot' | 'change'>;
  /** Finished workouts as Progress projects them, and Ben's local date. */
  history: () => Promise<{ sessions: readonly ProgressSession[]; today: string } | null>;
  /** Ben's exercises and the catalogue's, by ID (names now, archived ones). */
  exercises: () => Promise<ReadonlyMap<string, Exercise>>;
  now: () => ZonedTimestamp;
}

export interface LiftTargetsView {
  on: boolean;
  /** The training profile version the screen writes on. */
  version: number;
  lines: LiftTargetLine[];
  targets: LiftTarget[];
  canAdd: boolean;
  choices: LiftTargetChoice[];
  /** Review S3: history couldn't be read; rows show `Couldn’t load`, and nothing can be added. */
  historyUnreadable: boolean;
}

export interface ExerciseLiftTarget {
  on: boolean;
  version: number;
  target: LiftTarget | null;
  line: LiftTargetLine | null;
  /** This exercise can take a target (logged with a load; room for one). */
  choice: LiftTargetChoice | null;
  canAdd: boolean;
}

export type LiftTargetWrite = { ok: true; version: number; before: LiftTarget | null; after: LiftTarget | null } | { ok: false; reason: 'stale' | 'invalid' | 'full' | 'unknown_exercise' | 'no_profile' | 'failed' };

export interface LiftTargetRequest {
  exerciseId: string;
  kind: LiftTargetKind;
  value: number;
  unit: WeightUnit;
  reps: number;
  byDate: string | null;
  expectedVersion: number;
  opId: string;
}

export function createLiftTargetService(deps: LiftTargetServiceDeps) {
  async function read(): Promise<{ profile: TrainingProfile; sets: LiftSet[]; today: string; exercises: ReadonlyMap<string, Exercise>; loggedNames: Map<string, string>; historyUnreadable: boolean } | null> {
    const snap = await deps.training.snapshot();
    if (snap === null) return null;
    const [history, exercises] = await Promise.all([deps.history().catch(() => null), deps.exercises().catch(() => new Map<string, Exercise>())]);
    const sessions = history?.sessions ?? [];
    const loggedNames = new Map<string, string>();
    for (const s of sessions) for (const e of s.exercises) loggedNames.set(e.exerciseId, e.exerciseName);
    const now = deps.now();
    // Review S3: an unreadable history is unknown, never "nothing logged" (rule 6).
    return { profile: snap.profile, sets: liftSetsOf(sessions), today: history?.today ?? localDateOf(toMs(now.utc), now.tz), exercises, loggedNames, historyUnreadable: history === null };
  }

  const nameOf = (r: NonNullable<Awaited<ReturnType<typeof read>>>, id: string): string | null => r.exercises.get(id)?.name ?? r.loggedNames.get(id) ?? null;

  function lineOf(r: NonNullable<Awaited<ReturnType<typeof read>>>, t: LiftTarget): LiftTargetLine {
    return r.historyUnreadable ? liftTargetLineUnread(t, nameOf(r, t.exerciseId)) : liftTargetLine(t, liftTargetStatus(t, r.sets, r.today), nameOf(r, t.exerciseId));
  }

  function linesOf(r: NonNullable<Awaited<ReturnType<typeof read>>>): LiftTargetLine[] {
    return liftTargetsInUse(r.profile).map((t) => lineOf(r, t));
  }

  function outcome(w: TrainingWriteOutcome, before: LiftTarget | null, after: LiftTarget | null): LiftTargetWrite {
    if (w.ok) return { ok: true, version: w.profile.version, before, after };
    return { ok: false, reason: w.reason };
  }

  /** A target for one exercise, checked against Ben's history (its convention from his sets, what he had when set). */
  function build(r: NonNullable<Awaited<ReturnType<typeof read>>>, req: Omit<LiftTargetRequest, 'expectedVersion' | 'opId'> & { id: string; atUtc: string; setBy: 'ben' | 'coach' }): { target: LiftTarget; before: LiftTarget | null } | { error: 'unknown_exercise' | 'invalid' | 'full' } {
    const choice = liftTargetChoices(r.sets, r.exercises, r.loggedNames).find((c) => c.exerciseId === req.exerciseId) ?? null;
    if (choice === null) return { error: 'unknown_exercise' };
    const list = r.profile.liftTargets ?? [];
    const before = list.find((t) => t.exerciseId === req.exerciseId) ?? null;
    // Review S1: the same goal again (or only a new date) keeps when it was set, its "was" and its hit.
    const target = keepSameLiftTarget(newLiftTarget({ id: req.id, choice, kind: req.kind, value: req.value, unit: req.unit, reps: req.reps, byDate: req.byDate, atUtc: req.atUtc, today: r.today, setBy: req.setBy }, r.sets), before);
    const problem = liftTargetProblem(target, list);
    if (problem !== null) return { error: problem === 'full' ? 'full' : 'invalid' };
    return { target, before };
  }

  return {
    /** The Your plan block's rows, the setting, and what Add target offers. Null with no profile. */
    async view(): Promise<LiftTargetsView | null> {
      const r = await read();
      if (r === null) return null;
      const list = r.profile.liftTargets ?? [];
      return {
        on: r.profile.liftTargetsOn === true,
        version: r.profile.version,
        lines: linesOf(r),
        targets: liftTargetsInUse(r.profile),
        canAdd: list.length < 3 && !r.historyUnreadable,
        choices: liftTargetChoices(r.sets, r.exercises, r.loggedNames),
        historyUnreadable: r.historyUnreadable,
      };
    },

    /** Progress › exercise detail: its target and line (null while off). */
    async forExercise(exerciseId: string): Promise<ExerciseLiftTarget | null> {
      const r = await read();
      if (r === null) return null;
      const on = r.profile.liftTargetsOn === true;
      const target = liftTargetsInUse(r.profile).find((t) => t.exerciseId === exerciseId) ?? null;
      const line = target === null ? null : lineOf(r, target);
      const choice = liftTargetChoices(r.sets, r.exercises, r.loggedNames).find((c) => c.exerciseId === exerciseId) ?? null;
      return { on, version: r.profile.version, target, line, choice, canAdd: on && choice !== null && canAddLiftTarget(r.profile.liftTargets ?? [], exerciseId) };
    },

    /** The chart's dotted line for the series and measure shown (null: none). Pure on what `forExercise` returned. */
    chartValue(target: LiftTarget | null, series: ExerciseDetailView['seriesTerms'], metric: ExerciseMetric): number | null {
      return liftTargetChartValue(target, { ...series, metric });
    },

    /** The setting (Training details). Off hides every lift-target view; the targets are kept. */
    async setOn(on: boolean, expectedVersion: number, opId: string): Promise<TrainingWriteOutcome> {
      return deps.training.change({ kind: 'lift_targets_on', on }, expectedVersion, opId);
    },

    /** Ben's own target (the editor's Save). Replaces that exercise's target; refused when it would be a 4th. */
    async set(req: LiftTargetRequest): Promise<LiftTargetWrite> {
      const r = await read();
      if (r === null) return { ok: false, reason: 'no_profile' };
      if (r.historyUnreadable) return { ok: false, reason: 'failed' };
      const at = deps.now();
      const built = build(r, { ...req, id: req.opId, atUtc: at.utc, setBy: 'ben' });
      if ('error' in built) return { ok: false, reason: built.error };
      return outcome(await deps.training.change({ kind: 'set_lift_target', target: built.target }, req.expectedVersion, req.opId), built.before, built.target);
    },

    async remove(exerciseId: string, expectedVersion: number, opId: string): Promise<LiftTargetWrite> {
      const snap = await deps.training.snapshot();
      if (snap === null) return { ok: false, reason: 'no_profile' };
      const before = snap.profile.liftTargets?.find((t) => t.exerciseId === exerciseId) ?? null;
      return outcome(await deps.training.change({ kind: 'remove_lift_target', exerciseId }, expectedVersion, opId), before, null);
    },

    /** Undo on the toast: `previous` comes back exactly (or the exercise's target goes), on the version the write made. */
    async restore(exerciseId: string, previous: LiftTarget | null, expectedVersion: number, opId: string): Promise<LiftTargetWrite> {
      const change = previous === null ? ({ kind: 'remove_lift_target', exerciseId } as const) : ({ kind: 'set_lift_target', target: previous } as const);
      return outcome(await deps.training.change(change, expectedVersion, opId), null, previous);
    },

    /** Whether the coach may see and set targets (the setting). Unreadable: off. */
    async on(): Promise<boolean> {
      const snap = await deps.training.snapshot().catch(() => null);
      return snap?.profile.liftTargetsOn === true;
    },

    /** What the coach sees (only while on): each target with where Ben is now, the est. 1RM labelled. */
    async coachViews(): Promise<LiftTargetCoachView[]> {
      const r = await read();
      if (r === null) return [];
      return liftTargetsInUse(r.profile).map((t) => (r.historyUnreadable ? liftTargetCoachViewUnread(t, nameOf(r, t.exerciseId)) : liftTargetCoachView(t, liftTargetStatus(t, r.sets, r.today), nameOf(r, t.exerciseId))));
    },

    /**
     * `set_lift_target`'s checks (the coach executor): only while on; the exercise among those Ben
     * logs with a load (by ID, catalogue key or name); the profile version read now.
     */
    async prepare(args: SetLiftTargetArgs, at: { targetId: string; nowUtc: string }): Promise<{ ok: true; prepared: PreparedLiftTarget } | { ok: false; line: string }> {
      const r = await read();
      if (r === null || r.profile.liftTargetsOn !== true) return { ok: false, line: 'Not set: lift targets are off.' };
      if (r.historyUnreadable) return { ok: false, line: 'Not set: Ben’s history couldn’t be read just now. Say so; he can try again.' };
      const choices = liftTargetChoices(r.sets, r.exercises, r.loggedNames);
      const want = args.exercise.trim().toLowerCase();
      const byKey = (c: LiftTargetChoice) => c.exerciseId === args.exercise || r.exercises.get(c.exerciseId)?.catalogueKey === args.exercise;
      const exact = choices.filter((c) => byKey(c) || c.name.toLowerCase() === want);
      const loose = exact.length > 0 ? exact : choices.filter((c) => c.name.toLowerCase().includes(want) || want.includes(c.name.toLowerCase()));
      const choice = loose.length === 1 ? loose[0] : exact[0];
      if (choice === undefined) {
        return { ok: false, line: loose.length > 1 ? `Not set: "${args.exercise}" could be ${loose.map((c) => c.name).join(' or ')}. Ask Ben which.` : `Not set: "${args.exercise}" isn't one Ben has logged with a weight (assisted and bodyweight exercises have no lift targets).` };
      }
      const built = build(r, { exerciseId: choice.exerciseId, kind: args.kind, value: args.load, unit: args.unit, reps: args.kind === 'one_rm' ? 1 : (args.reps ?? 0), byDate: args.byDate, id: at.targetId, atUtc: at.nowUtc, setBy: 'coach' });
      if ('error' in built) {
        const line = built.error === 'full' ? 'Not set: Ben has 3 lift targets already (the most). Ask which to replace or remove.' : 'Not set: the values don’t fit a lift target (weight for reps needs reps; a date can’t be in the past).';
        return { ok: false, line };
      }
      return { ok: true, prepared: { target: built.target, before: built.before, expectedVersion: r.profile.version } };
    },
  };
}

export type LiftTargetService = ReturnType<typeof createLiftTargetService>;
