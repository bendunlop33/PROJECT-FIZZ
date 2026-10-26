import { BUILD_LIMITS, type AddExerciseTodayArgs, type CoachTarget, type CommandOf, type Exercise, type GuardNote, type Load, type PlannedSet, type RepRange, type SessionAggregate, type UserProfile, type ZonedTimestamp } from '@fizz/schemas';
import { builtInRepRange, ruleCategory } from '../default-rule';
import { dayMonthText, formatDuration, repRangeText, formatNumber, rirOfRpe } from '../display';
import { painFlagForMovement } from '../exercise-identity';
import { PAIN_AREA_WORD } from '../pain-flags';
import type { HistorySession } from '../progression';
import { deriveId } from '../stable';
import { toMs } from '../time';
import { buildAddExerciseCommand } from './create';
import { currentGymEquipment } from './equipment-snapshot';
import { plannedSnapOf, snapPlanToGym } from './snap';
import { doableHere, substituteTargets, type SubstituteContext } from './substitutes';
import { swapSource } from './swap-plan';
import { CARDIO_DEFAULT_S } from '../cardio';

/**
 * The coach's `add_exercise_today` (12 Oct; CLAUDE.md rule 3: when Ben asks,
 * today's change applies at once with Undo). Pure. The model's arguments are
 * only a request; this decides everything, in order:
 *
 * 1. The workout is active and still at the version the coach read (rule 5).
 * 2. The exercise is one of Ben's or the catalogue's, measured in reps or time.
 * 3. Not pain-flagged (rule 9): refused, never substituted. The same movement
 *    under another ID or name counts (`sameMovementIds`, review S2).
 * 4. (Ben, 19 Oct) An exercise already in today's workout is added as a second
 *    copy with its own sets (e.g. a superset with itself at 0).
 * 5. Doable at the workout's current gym (rule 4).
 * 6. The position or superset partner is a live row (a partner needs a set left).
 * 7. Sets, reps or work time and target RPE are clamped to the builder's
 *    limits, each with a note (`BUILD_LIMITS`, like `propose_workout`).
 * 8. Loads: Ben's own load when he gave one (`load`: 0 = no weight, on no
 *    equipment, so the copy's sets stand alone), else the exercise's **own** comparable history through the built-in
 *    rule (`substituteTargets`, the path a swap or an overview add takes),
 *    fitted with the shared `snapPlanToGym` (mode `start`) on this gym's
 *    items: achievable, within min/max, never past a machine's max. No
 *    history on that equipment, or a load that can't be made here: blank (B6).
 *
 * The result is the workout's own `add_exercise` command (via
 * `buildAddExerciseCommand`), with IDs derived from the opId so a replay
 * builds the same rows. Completed sets are never touched: the command only
 * adds a row with pending sets.
 */

export interface CoachAddInput {
  aggregate: SessionAggregate | null;
  args: AddExerciseTodayArgs;
  /** `args.exerciseId` resolved (Ben's exercise, else the catalogue's), or null. */
  exercise: Exercise | null;
  /** The exercise's own finished history (Ben's workouts). */
  history: readonly HistorySession[];
  /** At the workout's current gym: its items, pain flags, check-in pain, Ben's unit. */
  substitute: SubstituteContext;
  /**
   * Review S2: other IDs of the same movement (same catalogue key or name, e.g. a FitNotes custom
   * "Lateral Raise" for the catalogue's "Lateral raise"). A row or pain flag on any of them counts.
   */
  sameMovementIds?: readonly string[];
  owner: UserProfile;
  opId: string;
  at: ZonedTimestamp;
}

export interface CoachAddSummary {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  target: CoachTarget;
  durationS: number | null;
  /** Cardio (review S3): the distance target asked for; absent otherwise. */
  distanceM?: number;
  equipmentName: string | null;
  afterName: string | null;
  supersetWithName: string | null;
}

export type CoachAddCheck =
  | { status: 'ok'; command: CommandOf<'add_exercise'>; summary: CoachAddSummary; guardNotes: GuardNote[] }
  | { status: 'stale'; exerciseName: string | null; guardNotes: GuardNote[] }
  | { status: 'rejected'; failure: string; exerciseName: string | null; guardNotes: GuardNote[] };

const L = BUILD_LIMITS;

const clampInt = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)));
const clampRpe = (v: number): number => Math.min(L.maxRpe, Math.max(L.minRpe, Math.round(v * 2) / 2));

/** The new row's ID for this call (the record names it before the write). */
export function coachAddRowId(opId: string): string {
  return deriveId(`coach-add-row:${opId}`);
}

function sameRange(a: RepRange | null, b: RepRange | null): boolean {
  return a === null || b === null ? a === b : a.min === b.min && a.max === b.max;
}

export function checkCoachAdd(input: CoachAddInput): CoachAddCheck {
  const { aggregate: s, args, exercise } = input;
  const notes: GuardNote[] = [];
  const note = (kind: GuardNote['kind'], text: string): void => {
    notes.push({ kind, setIds: [], text: text.slice(0, 300) });
  };
  const name = exercise?.name ?? null;
  const reject = (failure: string): CoachAddCheck => ({ status: 'rejected', failure: failure.slice(0, 200), exerciseName: name, guardNotes: notes });

  // 1. Rule 5: the workout as the coach read it.
  if (s === null || s.session.status !== 'active' || s.session.version !== args.baseVersion) return { status: 'stale', exerciseName: name, guardNotes: notes };

  // 2. A known exercise, measured in reps or time.
  if (exercise === null) return reject('it isn’t one of your exercises');
  if (exercise.measurement === 'distance') return reject(`${exercise.name} is measured by distance`);

  // 3. Rule 9: a flagged movement is never added by the coach.
  const nowMs = toMs(input.at.utc);
  const movementIds = [exercise.id, ...(input.sameMovementIds ?? [])];
  const flag = painFlagForMovement(input.substitute.painFlags, exercise, movementIds, nowMs, input.at.tz);
  if (flag !== null) {
    const area = flag.area === null ? '' : `${PAIN_AREA_WORD[flag.area]} `;
    return reject(`${area}flagged ${dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz)}`);
  }

  // 4. (Ben, 19 Oct: "Even if it's the same exercise with different or no weight") An exercise already in
  // today's workout is added as a second copy with its own sets (one more set there is `set_count`).
  const live = s.exercises.filter((e) => e.removed === undefined);

  // 5. Rule 4: something to do it on at this gym.
  const gym = { ...input.substitute.gym, equipment: currentGymEquipment(s.session) };
  if (!doableHere(exercise, gym)) return reject(`nothing for it at ${gym.name}`);

  // 6. Position or superset partner.
  let after: string | undefined;
  let partner: string | undefined;
  let afterName: string | null = null;
  let supersetWithName: string | null = null;
  if (args.supersetWithSessionExerciseId !== null) {
    const p = live.find((e) => e.id === args.supersetWithSessionExerciseId);
    if (p === undefined) return reject('the exercise to pair it with isn’t in today’s workout');
    if (!s.sets.some((x) => x.sessionExerciseId === p.id && x.status === 'pending')) return reject(`${p.exerciseName} is done`);
    partner = p.id;
    supersetWithName = p.exerciseName;
  } else if (args.afterSessionExerciseId !== null) {
    const a = live.find((e) => e.id === args.afterSessionExerciseId);
    if (a === undefined) return reject('the exercise to put it after isn’t in today’s workout');
    after = a.id;
    afterName = a.exerciseName;
  }

  // 7. Shape, clamped like a built workout.
  const sets = clampInt(args.workingSets, L.minWorkingSets, L.maxWorkingSets);
  if (sets !== args.workingSets) note('too_many_sets', `Sets ${String(args.workingSets)} → ${String(sets)}`);
  const cardio = exercise.measurement === 'cardio';
  const timed = exercise.measurement === 'duration' || cardio;
  let reps: RepRange | null = null;
  let durationS: number | null = null;
  let distanceM: number | null = null;
  const convention = exercise.defaultLoadConvention;
  if (cardio) {
    // Cardio (19 Oct): a time and, when asked, a distance; never reps or a load. A distance alone gets no time
    // (review S3: "add a 5k row" has no time to aim for); with neither, 10 minutes.
    distanceM = args.distanceMetres == null || args.distanceMetres <= 0 ? null : Math.round(Math.min(100_000, args.distanceMetres));
    durationS = args.workSeconds === null && distanceM !== null ? null : clampInt(args.workSeconds ?? CARDIO_DEFAULT_S, L.minWorkS, L.maxCardioS);
    if (args.workSeconds !== null && durationS !== args.workSeconds) note('invalid_reps', `Work ${formatDuration(args.workSeconds)} → ${formatDuration(durationS ?? 0)}`);
  } else if (timed) {
    durationS = clampInt(args.workSeconds ?? 45, L.minWorkS, L.maxWorkS);
    if (args.workSeconds !== null && durationS !== args.workSeconds) note('invalid_reps', `Work ${formatDuration(args.workSeconds)} → ${formatDuration(durationS)}`);
  } else if (args.reps === null) {
    reps = builtInRepRange(ruleCategory(exercise, null, convention));
  } else {
    const lo = Math.min(args.reps.min, args.reps.max);
    const hi = Math.max(args.reps.min, args.reps.max);
    reps = { min: clampInt(lo, L.minReps, L.maxReps), max: clampInt(hi, L.minReps, L.maxReps) };
    if (!sameRange(reps, args.reps)) note('invalid_reps', `Reps ${repRangeText(args.reps)} → ${repRangeText(reps)}`);
  }
  let rpe: number | null = null;
  // No effort target on cardio (review N4): its time and distance are the target.
  if (args.targetRpe !== null && !cardio) {
    rpe = clampRpe(args.targetRpe);
    if (rpe !== args.targetRpe) note('invalid_reps', `RIR ${formatNumber(10 - args.targetRpe)} → ${formatNumber(rirOfRpe(rpe))}`);
  }

  // 8. Loads from the exercise's own history (B6: none → blank), fitted to this gym.
  const templates = Array.from({ length: sets }, () => ({ setType: 'working' as const, reps, durationS }));
  const plan = substituteTargets({ workingSets: sets, templates }, exercise, input.history, { ...input.substitute, gym });
  const fromPlan = (plan.plan ?? []).filter((p) => p.setType !== 'warmup');
  const planned = templates.map((t, i): PlannedSet => {
    const p = fromPlan[i] ?? fromPlan.at(-1);
    const base: PlannedSet = p === undefined ? { load: null, reps: t.reps, durationS: t.durationS, rpe: null, rir: null } : { ...p.planned };
    const out: PlannedSet = { ...base, reps: t.reps, durationS: t.durationS, ...(distanceM !== null ? { distanceM } : {}), rpe: cardio ? null : (rpe ?? base.rpe), rir: cardio || rpe !== null ? null : base.rir, source: 'coach' };
    if (cardio && distanceM === null) delete out.distanceM;
    delete out.rpeOverride;
    delete out.coach;
    delete out.snap;
    return out;
  });
  // Ben's own load for the sets ("at 0"): 0 is no weight, on no equipment, so the copy's sets stand alone;
  // any other load is fitted to this gym's item below like a planned one. A bodyweight exercise has none to set.
  const asked = args.load ?? null;
  const noWeight = asked === 0 && convention !== 'bodyweight' && !timed;
  if (asked !== null && asked > 0 && !timed) {
    if (convention === 'bodyweight') note('build_check', '+ Weight to add weight');
    else for (const p of planned) p.load = { value: asked, unit: input.owner.preferredUnit, convention };
  }
  const planReps = fromPlan[0]?.planned.reps ?? null;
  if (!timed && planReps !== null && !sameRange(planReps, reps)) note('build_check', `Reps changed from last time · load not adjusted`);
  const ids = (() => {
    let n = 0;
    return () => {
      n += 1;
      return deriveId(`coach-add-set:${input.opId}:${String(n)}`);
    };
  })();
  const setIds = planned.map(() => ids());
  const snapped = snapPlanToGym({
    mode: 'start',
    slots: [
      {
        slotId: 'coach-add',
        exercise: { id: exercise.id, name: exercise.name, compatibleEquipment: exercise.compatibleEquipment, defaultLoadConvention: convention },
        sourceEquipment: s.session.gymId === null ? null : swapSource(exercise, plan.pin, s.session.gymId),
        unit: input.owner.preferredUnit,
        convention,
        sets: planned.map((p, i) => ({ id: setIds[i] ?? '', setType: 'working' as const, intended: p.load, current: null, reps: p.reps, durationS: p.durationS })),
      },
    ],
    gym,
    ...(input.substitute.lastUsedHere ? { lastUsedHere: input.substitute.lastUsedHere } : {}),
    ownerUnit: input.owner.preferredUnit,
  });
  const slot = noWeight ? undefined : snapped.slots[0];
  const equipment = slot?.equipment ?? null;
  // The reducer stores loads in the row's own unit and convention: the item's, else Ben's unit and the exercise's.
  const unit = equipment?.unit ?? input.owner.preferredUnit;
  const rowConvention = equipment?.loadConvention ?? convention;
  let dropped = 0;
  const fitted = planned.map((p, i): PlannedSet => {
    if (noWeight) {
      const out: PlannedSet = { ...p, load: { value: 0, unit, convention: rowConvention } };
      delete out.snap;
      return out;
    }
    const f = slot?.sets[i];
    let load: Load | null = f === undefined || f.outcome === 'dropped' ? null : f.load;
    if (p.load !== null && load === null) dropped += 1;
    if (load !== null && (load.unit !== unit || load.convention !== rowConvention)) {
      load = null;
      dropped += 1;
    }
    const snap = f !== undefined && slot !== undefined && load !== null ? plannedSnapOf(f, slot, 'start', gym.id) : null;
    return { ...p, load, ...(snap === null ? {} : { snap }) };
  });
  if (dropped > 0) note('no_achievable_load', `Load left blank · can't be made on ${equipment?.name ?? 'this equipment'}`);
  else if (!timed && !noWeight && fitted.every((p) => p.load === null) && exercise.defaultLoadConvention !== 'bodyweight') note('build_check', 'No history on this equipment · load left blank');

  const generated = [...setIds];
  const rowId = coachAddRowId(input.opId);
  const newId = (): string => generated.shift() ?? rowId;
  const command: CommandOf<'add_exercise'> = {
    ...buildAddExerciseCommand({
      opId: input.opId,
      owner: input.owner,
      exercise,
      equipmentId: equipment?.id ?? null,
      at: input.at,
      newId,
      plan: fitted.map((p) => ({ setType: 'working' as const, planned: p })),
      exerciseRestS: input.owner.exerciseRestS?.[exercise.id] ?? null,
    }),
    ...(after === undefined ? {} : { afterSessionExerciseId: after }),
    ...(partner === undefined ? {} : { supersetWithSessionExerciseId: partner }),
  };
  const first = fitted[0];
  return {
    status: 'ok',
    command,
    guardNotes: notes,
    summary: {
      sessionExerciseId: command.newSessionExerciseId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      sets,
      target: { load: first?.load ?? null, reps: first?.reps ?? null, rpe: first?.rpe ?? null },
      durationS,
      ...(distanceM !== null ? { distanceM } : {}),
      equipmentName: equipment?.name ?? null,
      afterName,
      supersetWithName,
    },
  };
}
