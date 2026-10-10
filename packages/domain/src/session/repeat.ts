import type { EquipmentInstance, Exercise, Load, PlannedSet, Routine, RoutineExercise, SessionAggregate, SetTemplate, SetType, TargetProvenance, WeightUnit, WorkoutSet } from '@fizz/schemas';
import { loadText, NBSP, repRangeText, targetShort } from '../display';
import { getAchievableLoads, loadDirection, roundToAvailableLoad } from '../equipment';
import { fitProvenance, startWarningNote } from '../target-provenance';
import { convertMass } from '../units';
import { startWorkout, type StartWarning, type StartWorkoutInput, type StartWorkoutOutput } from './create';
import { setDisplayNumbers } from './order';
import { GENERIC_WORKOUT_NAME } from './first-run';

/**
 * `Repeat last workout` / `Start from a past workout` (routines.md RT4, §2.4,
 * §4.6): a new session whose sets are all **pending**, with each done set's
 * **actual** as the new **target** (`Target (as last time)`). Nothing is
 * marked done and progression isn't applied. Skipped and deleted sets aren't
 * copied; a left/right pair copies once. At another gym each load goes
 * through the normal start-time check: rounded toward easier to what this
 * gym can make (never above a max), or dropped with a note when it was on a
 * different kind of equipment (rule 4).
 *
 * Equipment missing here (review B1): when the source exercise used
 * equipment and this gym has none of that kind, the load target is dropped
 * and the reps kept, with `No Olympic bar here: no load target (last time
 * 100 kg × 5).` A load is never planned without equipment to check it on.
 *
 * kg↔lb (PM decision, review SP5): a load is converted only when the
 * converted value is an achievable load on today's equipment, rounded toward
 * easier (`planTemplateLoad` with equipment). With no equipment to check it
 * against, a load in another unit is dropped with a note, never converted.
 * Rounding only goes toward easier: when the easiest load here is harder
 * than last time's, the load is dropped with a note instead.
 *
 * `Why?` (active-workout §2.12): each set records the set it was copied
 * from (`planned.provenance`, source `repeat`), with its own fit or drop
 * note, so the card can say where the number came from.
 */

export interface RepeatInput {
  opId: string;
  owner: StartWorkoutInput['owner'];
  gymId: string;
  source: SessionAggregate;
  /** The exercise list now (rest defaults); a missing one falls back to the source's snapshot. */
  exercises: ReadonlyMap<string, Exercise>;
  gymEquipment: readonly EquipmentInstance[];
  at: StartWorkoutInput['at'];
  newId: () => string;
  checkIn?: StartWorkoutInput['checkIn'];
  /**
   * "Start next session" (audit B2): per exercise ID, the built-in rule's
   * next targets (`plannedSetsFromTargets`), used instead of last time's
   * actuals and labelled `built_in_rule`. Exercises without an entry are
   * copied as last time. Loads still go through this gym's check (rule 4).
   */
  targets?: ReadonlyMap<string, readonly { setType: SetType; planned: PlannedSet }[]>;
  /** The new workout's name; default: the source's. */
  name?: string;
}

export interface RepeatNote {
  exerciseName: string;
  text: string;
}

export interface RepeatOutput extends StartWorkoutOutput {
  notes: RepeatNote[];
  /** `Not copied: 2 skipped sets (Cable fly)`. */
  notCopied: { exerciseName: string; skipped: number }[];
  /** Nothing to copy (no completed sets). */
  empty: boolean;
}

/** Equipment for a repeated exercise at this gym: the same item, else the first available of the same kind. */
export function pickEquipment(sourceEq: EquipmentInstance | null, gym: readonly EquipmentInstance[], exercise: Pick<Exercise, 'compatibleEquipment'>): EquipmentInstance | null {
  if (sourceEq === null) return null;
  const usable = gym.filter((e) => e.availability === 'available');
  const same = usable.find((e) => e.id === sourceEq.id);
  if (same) return same;
  return usable.find((e) => e.kind === sourceEq.kind && exercise.compatibleEquipment.includes(e.kind)) ?? null;
}

export function startWorkoutFromSession(input: RepeatInput): RepeatOutput {
  const src = input.source;
  const notes: RepeatNote[] = [];
  const notCopied: RepeatOutput['notCopied'] = [];
  const exercises = new Map<string, Exercise>();
  const routineExercises: RoutineExercise[] = [];
  const sorted = [...src.exercises].sort((a, b) => a.order - b.order);
  // Targets are per exercise: an exercise done in two slots repeats each slot's own numbers (review S7).
  const slots = new Map<string, number>();
  for (const sx of sorted) slots.set(sx.exerciseId, (slots.get(sx.exerciseId) ?? 0) + 1);
  const targetsFor = (exerciseId: string) => ((slots.get(exerciseId) ?? 0) > 1 ? undefined : input.targets?.get(exerciseId));

  // What each template came from: the done set it copies, or the built-in rule's planned set (Start next session),
  // its equipment here, and why its load was dropped (if it was).
  const copied = new Map<string, { from: { kind: 'copy'; set: WorkoutSet } | { kind: 'rule'; planned: PlannedSet }; equipmentId: string | null; eq: EquipmentInstance | null; dropNote: string | null }>();

  for (const sx of sorted) {
    const own = src.sets.filter((s) => s.sessionExerciseId === sx.id).sort((a, b) => a.index - b.index);
    // A left/right pair is one prescribed set: the companion row isn't copied again.
    const done = own.filter((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null);
    const skipped = own.filter((s) => s.status === 'skipped').length;
    if (skipped > 0) notCopied.push({ exerciseName: sx.exerciseName, skipped });
    if (done.length === 0) continue;
    const known = input.exercises.get(sx.exerciseId);
    const exercise: Exercise = known ?? {
      id: sx.exerciseId,
      ownerId: null,
      source: 'catalogue',
      name: sx.exerciseName,
      movementPattern: 'unknown',
      primaryMuscles: [],
      measurement: sx.measurement,
      laterality: sx.laterality,
      compatibleEquipment: [],
      defaultLoadConvention: sx.loadConvention,
      version: 1,
      createdAtUtc: src.session.startedAt.utc,
      updatedAtUtc: src.session.startedAt.utc,
    };
    exercises.set(exercise.id, exercise);
    const sourceEq = sx.equipmentId === null ? null : (src.session.equipmentSnapshot.find((e) => e.id === sx.equipmentId) ?? null);
    const eq = pickEquipment(sourceEq, input.gymEquipment, { compatibleEquipment: known?.compatibleEquipment ?? (sourceEq ? [sourceEq.kind] : []) });
    // Equipment that isn't here: keep reps, drop every load (review B1, rule 4).
    const missingEq = eq === null ? sourceEq : null;
    const equipmentMissing = missingEq !== null;
    // No equipment either side: the session is in Ben's unit; another unit can't be checked, so it's dropped.
    const sessionUnit = eq?.unit ?? input.owner.preferredUnit;
    const doneWithReps = done.filter((s) => s.actual !== null && (s.actual.reps !== null || s.actual.durationS !== null));
    if (missingEq !== null) notes.push({ exerciseName: sx.exerciseName, text: missingEquipmentNote(missingEq.name, doneWithReps) });
    let unitDropped: Load | null = null;
    let harderDropped: { requested: Load; lightest: Load } | null = null;

    const planned = targetsFor(sx.exerciseId);
    type Source = { setType: SetType; load: Load | null; reps: { min: number; max: number } | null; durationS: number | null; from: { kind: 'copy'; set: WorkoutSet } | { kind: 'rule'; planned: PlannedSet } };
    const sources: Source[] =
      planned && planned.length > 0
        ? planned.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS, from: { kind: 'rule' as const, planned: p.planned } }))
        : doneWithReps.flatMap((s) => (s.actual === null ? [] : [{ setType: s.setType, load: s.actual.load, reps: s.actual.reps === null ? null : { min: s.actual.reps, max: s.actual.reps }, durationS: s.actual.durationS, from: { kind: 'copy' as const, set: s } }]));
    const templates: SetTemplate[] = [];
    for (const a of sources) {
      const fit = fitLoadHere(equipmentMissing ? null : a.load, eq, sessionUnit);
      if (fit.unitDropped) unitDropped ??= fit.unitDropped;
      if (fit.harderDropped) harderDropped ??= fit.harderDropped;
      const targetLoad = fit.load;
      // Why this set's load was dropped, for `Why?`: said against last time's set, or the built-in rule's target.
      const was = a.from.kind === 'rule' ? 'the target' : 'last time';
      const dropNote =
        missingEq !== null && a.load !== null
          ? `No load target: no ${missingEq.name} here.`
          : fit.unitDropped
            ? `No load target: ${was} was ${loadWord(fit.unitDropped)}, and there’s no equipment here to check a ${sessionUnit} load on.`
            : fit.harderDropped
              ? `No load target: ${was} was ${loadWord(fit.harderDropped.requested)}, and the easiest here is ${loadWord(fit.harderDropped.lightest)}.`
              : null;
      const templateId = input.newId();
      copied.set(templateId, { from: a.from, equipmentId: sx.equipmentId, eq, dropNote });
      templates.push({
        id: templateId,
        setType: a.setType,
        targetLoad,
        targetReps: a.reps,
        targetDurationS: a.durationS,
        targetRpe: null,
        targetRir: null,
        restOverrideS: null,
      });
    }
    notes.push(...droppedNotes(sx.exerciseName, sessionUnit, unitDropped, harderDropped));
    if (templates.length === 0) continue;
    routineExercises.push({
      id: input.newId(),
      exerciseId: exercise.id,
      equipmentId: eq?.id ?? null,
      order: routineExercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates,
      restBySetType: {},
      transitionRestS: sx.transitionRestS,
      progressionRuleId: null,
    });
  }

  const routine: Routine = {
    id: input.newId(),
    ownerId: input.owner.id,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name ?? src.session.routineName ?? GENERIC_WORKOUT_NAME,
    exercises: routineExercises,
  };
  // Ben's own per-exercise rest defaults come first (rest-state §2.4).
  const restOwner = input.owner.exerciseRestS ?? {};
  const withRest = new Map([...exercises].map(([k, e]) => [k, restOwner[k] === undefined ? e : { ...e, defaultRestS: restOwner[k] }]));
  const out = startWorkout({
    opId: input.opId,
    owner: input.owner,
    gymId: input.gymId,
    routine,
    exercises: withRest,
    gymEquipment: input.gymEquipment,
    at: input.at,
    newId: input.newId,
    ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
  });

  // Rounded or dropped loads become plain notes; every target is marked as copied.
  notes.push(...warningNotes(out.warnings, routineExercises, exercises));
  const numbers = setDisplayNumbers(src.exercises, src.sets);
  const warningOf = new Map(out.warnings.flatMap((w) => (w.kind === 'target_rounded' || w.kind === 'target_dropped' ? [[w.setTemplateId, w] as const] : [])));
  const fromOf = (setId: string) => {
    const templateId = out.setTemplateIds[setId];
    return templateId === undefined ? undefined : { templateId, entry: copied.get(templateId) };
  };
  const provenanceOf = (setId: string): TargetProvenance | null => {
    const found = fromOf(setId);
    const entry = found?.entry;
    if (found === undefined || entry === undefined) return null;
    const w = warningOf.get(found.templateId);
    const { from } = entry;
    if (from.kind === 'rule') {
      // A target from the built-in rule (Start next session, review B1.1): its own rule provenance, never `repeat`.
      // Without one it reads `Not recorded`, rather than a made-up explanation.
      const rule = from.planned.provenance;
      if (rule === undefined) return null;
      const fit = entry.dropNote ?? (w ? startWarningNote(w, entry.eq, 'Target') : null);
      return fitProvenance(fit === null ? rule : { ...rule, guardNotes: [...rule.guardNotes, fit] });
    }
    if (from.set.actual === null) return null;
    const number = numbers.get(from.set.id);
    const notes = [entry.dropNote ?? (w ? startWarningNote(w, entry.eq, 'Last time') : null)].filter((n): n is string => n !== null);
    return fitProvenance({
      source: 'repeat',
      setAt: input.at,
      routineName: src.session.routineName,
      requestedLoad: from.set.actual.load,
      basis: {
        sessionId: src.session.id,
        performedAt: src.session.startedAt,
        routineName: src.session.routineName,
        gymId: src.session.gymId,
        equipmentId: entry.equipmentId,
        sets: [{ setId: from.set.id, version: from.set.version, ...(number !== undefined ? { number } : {}), setType: from.set.setType, side: from.set.side, values: from.set.actual }],
      },
      guardNotes: notes,
    });
  };
  const aggregate: SessionAggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: null },
    sets: out.aggregate.sets.map((s) => {
      // The synthetic routine isn't the source: the set Ben did last time is, or the built-in rule's target.
      const fromRule = fromOf(s.id)?.entry?.from.kind === 'rule';
      const planned: PlannedSet = { ...s.planned, source: fromRule ? 'built_in_rule' : 'repeat' };
      const provenance = provenanceOf(s.id);
      if (provenance === null) delete planned.provenance;
      else planned.provenance = provenance;
      return { ...s, planned };
    }),
  };
  return { aggregate, warnings: out.warnings, setTemplateIds: out.setTemplateIds, notes, notCopied, empty: routineExercises.length === 0 };
}

/**
 * `No Olympic bar here: no load target (last time 100 kg × 5).`, said once,
 * about the top set: the hardest working set by its load convention (on an
 * assisted machine the least assistance), compared in one unit. Only sets
 * in the last working set's convention are compared; ties go to the later
 * set.
 */
function missingEquipmentNote(equipmentName: string, done: readonly WorkoutSet[]): string {
  const top = lastTimeTopSet(done);
  const a = top?.actual;
  if (!a?.load) return `No ${equipmentName} here.`;
  const amount = a.reps !== null ? ` × ${String(a.reps)}` : a.durationS !== null ? ` for ${String(a.durationS)} s` : '';
  return `No ${equipmentName} here: no load target (last time ${loadWord(a.load)}${amount}).`;
}

/** The hardest loaded set (working sets first) by convention: most resistance, or least assistance. */
export function lastTimeTopSet(done: readonly WorkoutSet[]): WorkoutSet | null {
  const loaded = done.filter((s) => s.actual?.load);
  const working = loaded.filter((s) => s.setType !== 'warmup');
  const pool = working.length > 0 ? working : loaded;
  const convention = pool.at(-1)?.actual?.load?.convention;
  if (convention === undefined) return null;
  const sameKind = pool.filter((s) => s.actual?.load?.convention === convention);
  const harder = loadDirection(convention) === 'assistance' ? -1 : 1;
  const kgOf = (s: WorkoutSet): number => {
    const l = s.actual?.load;
    return l ? convertMass(l, 'kg').value : 0;
  };
  let top: WorkoutSet | null = null;
  for (const s of sameKind) if (top === null || harder * (kgOf(s) - kgOf(top)) >= 0) top = s;
  return top;
}

function loadWord(l: Load | { value: number; unit: WeightUnit; convention: Load['convention'] }): string {
  return loadText(l, l.convention).replaceAll(NBSP, ' ');
}

/**
 * A copied or planned load checked against this gym before it becomes a
 * template (rule 4). Without equipment, a load in another unit is dropped
 * (never converted unchecked). Rounding only goes toward easier: when the
 * easiest load here is harder than the target, the target is dropped.
 */
export function fitLoadHere(
  load: Load | null,
  eq: EquipmentInstance | null,
  sessionUnit: WeightUnit,
): { load: Load | null; unitDropped: Load | null; harderDropped: { requested: Load; lightest: Load } | null } {
  if (load === null) return { load: null, unitDropped: null, harderDropped: null };
  if (eq === null) return load.unit !== sessionUnit ? { load: null, unitDropped: load, harderDropped: null } : { load, unitDropped: null, harderDropped: null };
  const r = roundToAvailableLoad(load, eq, 'easier');
  const direction = getAchievableLoads(eq).direction;
  if (r.ok && ((direction === 'resistance' && r.bounded === 'min') || (direction === 'assistance' && r.bounded === 'max'))) {
    return { load: null, unitDropped: null, harderDropped: { requested: load, lightest: r.load } };
  }
  return { load, unitDropped: null, harderDropped: null };
}

/** The notes said when `fitLoadHere` dropped a load. */
export function droppedNotes(exerciseName: string, sessionUnit: WeightUnit, unitDropped: Load | null, harderDropped: { requested: Load; lightest: Load } | null): RepeatNote[] {
  const notes: RepeatNote[] = [];
  if (unitDropped !== null) {
    notes.push({ exerciseName, text: `No load target: last time was ${loadWord(unitDropped)}, and there's no equipment here to check a ${sessionUnit} load on.` });
  }
  if (harderDropped !== null) {
    notes.push({ exerciseName, text: `No load target: last time was ${loadWord(harderDropped.requested)}, and the easiest here is ${loadWord(harderDropped.lightest)}.` });
  }
  return notes;
}

/** `startWorkout`'s rounding warnings as plain notes, one per exercise and text. */
export function warningNotes(warnings: readonly StartWarning[], routineExercises: readonly RoutineExercise[], exercises: ReadonlyMap<string, Pick<Exercise, 'name'>>): RepeatNote[] {
  const notes: RepeatNote[] = [];
  const nameOfTemplate = new Map<string, string>();
  for (const rex of routineExercises) for (const t of rex.setTemplates) nameOfTemplate.set(t.id, exercises.get(rex.exerciseId)?.name ?? 'Exercise');
  const seen = new Set<string>();
  for (const w of warnings) {
    if (w.kind !== 'target_rounded' && w.kind !== 'target_dropped') continue;
    const name = nameOfTemplate.get(w.setTemplateId) ?? 'Exercise';
    const text =
      w.kind === 'target_rounded'
        ? w.bounded === 'max'
          ? `Rounded down from ${loadWord(w.requested)}: this gym stops at ${loadWord(w.planned)}.`
          : `Rounded from ${loadWord(w.requested)} to ${loadWord(w.planned)} to match this gym.`
        : w.reason === 'unit_not_convertible'
          ? `No load target: ${loadWord(w.requested)} is in another unit.`
          : w.reason === 'no_achievable_loads'
            ? `No load target: this gym has no loads set up for ${loadWord(w.requested)}.`
            : `No load target: the ${loadWord(w.requested)} was on different equipment.`;
    const key = `${name}|${text}`;
    if (!seen.has(key)) notes.push({ exerciseName: name, text });
    seen.add(key);
  }
  return notes;
}

/** One line per exercise for the Repeat preview: `3 sets · Target (as last time) 100 kg × 8, 8, 7`. */
export function repeatPreviewLines(state: SessionAggregate): { exerciseName: string; equipmentName: string | null; line: string }[] {
  return [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const eq = ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
      const sets = state.sets.filter((s) => s.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
      const parts = sets.map((s) => {
        const load = s.planned.load ? loadText(s.planned.load, ex.loadConvention, eq) : null;
        const reps = s.planned.reps ? repRangeText(s.planned.reps) : null;
        const badge = s.setType === 'warmup' ? 'W ' : '';
        return `${badge}${load ?? ''}${load && reps ? `${NBSP}×${NBSP}` : ''}${reps ?? ''}`.trim();
      });
      return { exerciseName: ex.exerciseName, equipmentName: eq?.name ?? null, line: `${String(sets.length)} ${sets.length === 1 ? 'set' : 'sets'} · ${parts.join(' · ')}` };
    });
}

/**
 * Today's Up next rows (premium-feel §2.3): `Target 100 kg × 6–8 · 3 sets`,
 * from the planned (already snapped) values the Start would create. The
 * first working set stands for the exercise; warm-ups aren't counted. The
 * word `Target` is always there: these are plans, not results.
 */
export function targetSummaryLines(state: SessionAggregate): { exerciseName: string; line: string }[] {
  return [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const eq = ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
      const sets = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted' && s.setType !== 'warmup').sort((a, b) => a.index - b.index);
      const n = `${String(sets.length)} ${sets.length === 1 ? 'set' : 'sets'}`;
      // A top set then back-offs reads `Target 100 kg × 3, then 85 kg × 6–8` (review N10): each change of target, in order.
      const texts: string[] = [];
      for (const s of sets) {
        const t = targetShort(s.planned, { convention: ex.loadConvention, equipment: eq });
        if (t !== null && texts.at(-1) !== t) texts.push(t);
      }
      const target = texts.length === 0 ? null : texts.map((t, i) => (i === 0 ? t : t.replace(/^Target /, ''))).join(', then ');
      return { exerciseName: ex.exerciseName, line: target === null ? `No target · ${n}` : `${target} · ${n}` };
    });
}
