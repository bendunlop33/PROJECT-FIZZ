import type { EquipmentInstance, Exercise, Load, PlannedSet, RepRange, Routine, RoutineExercise, SessionAggregate, SetTemplate, SetType, TargetProvenance, WorkoutSet } from '@fizz/schemas';
import { loadText, NBSP, repRangeText, targetShort } from '../display';
import { loadDirection } from '../equipment';
import { fitProvenance, startWarningNote, UNCHECKED_NOTE } from '../target-provenance';
import { convertMass } from '../units';
import { needsNoEquipment } from '../exercise-equipment';
import { deriveId } from '../stable';
import { startWorkoutWithMode, type StartWorkoutInput, type StartWorkoutOutput } from './create';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, partRootOf, partsOf } from './gym-switch';
import { setDisplayNumbers } from './order';
import type { SnapSetResult, SnapSlotResult } from './snap';
import { GENERIC_WORKOUT_NAME } from './first-run';
import { repeatNoteText } from './snap-text';
import { swapEquipmentId, type SwapPlan } from './swap-plan';
import { addedSlotShape, resizeWorkingSets, shapeOfTemplates, shapeTemplates, type ShapeBefore, type SlotShape } from './today-shape';

/**
 * `Repeat last workout` / `Start from a past workout` (routines.md RT4, §2.4,
 * §4.6): a new session whose sets are all **pending**, with each done set's
 * **actual** as the new **target** (`Target (as last time)`). Nothing is
 * marked done and progression isn't applied. Skipped and deleted sets aren't
 * copied; a left/right pair copies once.
 *
 * Every load goes through the same fit as a routine Start and a mid-workout
 * gym switch (`snapPlanToGym`, mode `repeat`; gym-switch GS1), so Repeat has
 * no equipment rules of its own (review B1 is closed by that shared path):
 * - the item last time is mapped to this gym's equipment (same item, else
 *   same kind, else another kind the exercise lists); none here means no
 *   load target, reps kept: `No Olympic bar at Hotel · Lisbon: no load
 *   target (last time 100 kg × 5).`;
 * - loads round toward easier and never above a max; one below the easiest
 *   load here is dropped, never rounded up;
 * - kg↔lb (review SP5): converted only through that rounding on today's
 *   equipment; with no equipment, a load in another unit is dropped.
 * Repeat never swaps an exercise by itself (gym-switch GS5).
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
  /** The gym's name, for notes (`No Olympic bar at Hotel · Lisbon …`); absent = "here". */
  gymName?: string;
  lastUsedHere?: StartWorkoutInput['lastUsedHere'];
  /**
   * Today's swaps (ADR 0022), by the source's part-root row ID: the slot is
   * planned as the substitute, from its own targets (or last time's reps with
   * no load), on its own item. Never from the original's loads.
   */
  swaps?: ReadonlyMap<string, SwapPlan>;
  /** Today's shape per part-root row ID or added slot key (overview-today-edits §11), applied after the targets. */
  shape?: ReadonlyMap<string, SlotShape>;
  /**
   * Exercises added today (§11), each with its own plan (`substituteTargets`
   * on its default shape) and its place: `rank` is in the same order as the
   * source rows' `order`.
   */
  /** `workingSets`: the count Ben chose when adding (exercise-library §10.2); absent = the plan's own. */
  added?: readonly { slotKey: string; rank: number; plan: SwapPlan; workingSets?: number }[];
  /**
   * A cut-short source (`cutShort`) planned as its full plan (review today-18oct S2): its skipped and
   * never-logged working sets come too, at the targets they had, after the done ones. Off: Repeat as RT4.
   */
  includeNotDone?: boolean;
}

export interface RepeatNote {
  exerciseName: string;
  text: string;
  /** `⚠` for a dropped load target, `ⓘ` for a fact (gym-switch §2.2 note rules). */
  tone: 'info' | 'warning';
}

/**
 * What Repeat leaves out, by exercise: skipped sets, and distance sets (a
 * set template has no distance target yet, so a sled push isn't copied
 * rather than copied wrong; review gaps S4).
 */
export type NotCopied = { kind: 'skipped'; exerciseName: string; skipped: number } | { kind: 'distance'; exerciseName: string; sets: number };

/** `Not copied: 2 skipped sets (Cable fly), 3 distance sets (Sled push)`; null when nothing was left out. */
export function notCopiedText(list: readonly NotCopied[]): string | null {
  if (list.length === 0) return null;
  const part = (n: NotCopied) => {
    const count = n.kind === 'skipped' ? n.skipped : n.sets;
    const what = n.kind === 'skipped' ? 'skipped' : 'distance';
    return `${String(count)} ${what} ${count === 1 ? 'set' : 'sets'} (${n.exerciseName})`;
  };
  return `Not copied: ${list.map(part).join(', ')}`;
}

export interface RepeatOutput extends StartWorkoutOutput {
  notes: RepeatNote[];
  /** `Not copied: 2 skipped sets (Cable fly), Sled push (distance)` (`notCopiedText`). */
  notCopied: NotCopied[];
  /** Nothing to copy (no completed sets). */
  empty: boolean;
  /** The source part-root row each planned slot came from, by the plan's slot ID (`snap.slots[i].slotId`); an added slot's own key. */
  slotSources: Record<string, string>;
  /** Each slot as planned before today's shape (`shape` given only), by part-root row ID or added slot key. */
  shapedFrom?: Record<string, ShapeBefore>;
}

/** The pin an exercise from a FitNotes workout starts from: no item recorded, so the shared fit maps one by kind (B7). */
export function importPinId(exercise: Pick<Exercise, 'id'>): string {
  return deriveId(`fitnotes-pin:${exercise.id}`);
}

export function startWorkoutFromSession(input: RepeatInput): RepeatOutput {
  const src = input.source;
  const imported = src.session.source === 'import';
  const notCopied: RepeatOutput['notCopied'] = [];
  const exercises = new Map<string, Exercise>();
  const routineExercises: RoutineExercise[] = [];
  /** The item each copied exercise was done on last time (it may be at another gym). */
  const knownEquipment = new Map<string, EquipmentInstance>();
  const sorted = [...src.exercises].sort((a, b) => a.order - b.order);
  // An exercise split across gyms (GS6) is one block of rows: it is copied once,
  // its parts' done sets in execution order (review B1).
  const roots = sorted.filter((sx) => partRootOf(src.exercises, sx.id) === sx.id);
  // Targets are per exercise: an exercise done in two slots repeats each slot's own numbers (review S7).
  // A block split across gyms is one slot, not two.
  const slots = new Map<string, number>();
  for (const sx of roots) slots.set(sx.exerciseId, (slots.get(sx.exerciseId) ?? 0) + 1);
  const targetsFor = (exerciseId: string) => ((slots.get(exerciseId) ?? 0) > 1 ? undefined : input.targets?.get(exerciseId));

  // What each template came from: the done set it copies, or the built-in rule's planned set (Start next session).
  const copied = new Map<string, { kind: 'copy'; set: WorkoutSet } | { kind: 'rule'; planned: PlannedSet } | { kind: 'plain' }>();
  const slotSources: Record<string, string> = {};
  /** Where each planned slot goes today (the source rows' `order`; an added one's `rank`). */
  const rankOf = new Map<string, number>();
  const shapedFrom: Record<string, ShapeBefore> = {};
  /** Today's shape (§11) on one slot's templates, after its targets: copies keep their `Why?`; Ben's load has none. */
  const shaped = (key: string, templates: SetTemplate[]): SetTemplate[] => {
    if (input.shape !== undefined) shapedFrom[key] = shapeOfTemplates(templates);
    const shape = input.shape?.get(key);
    if (shape === undefined) return templates;
    return shapeTemplates(templates, shape, {
      newId: input.newId,
      copied: (from, to) => {
        const c = copied.get(from);
        if (c !== undefined) copied.set(to, c);
      },
      ownLoad: (id) => copied.set(id, { kind: 'plain' }),
    });
  };

  for (const sx of roots) {
    const parts = partsOf(src.exercises, sx.id);
    const own = blockSets(src, sx.id);
    // A left/right pair is one prescribed set: the companion row isn't copied again.
    const done = own.filter((s) => s.status === 'completed' && s.actual !== null && s.pairedWithSetId === null);
    // A cut-short source's working sets not done, with a rep or time target (S2); none otherwise.
    const notDone = input.includeNotDone === true ? own.filter((s) => (s.status === 'skipped' || s.status === 'pending') && s.setType !== 'warmup' && s.pairedWithSetId === null && (s.planned.reps !== null || s.planned.durationS !== null)) : [];
    const skipped = own.filter((s) => s.status === 'skipped').length - notDone.filter((s) => s.status === 'skipped').length;
    if (skipped > 0) notCopied.push({ kind: 'skipped', exerciseName: sx.exerciseName, skipped });
    // Distance-only sets have no template field to copy into (review gaps S4): listed, not dropped silently.
    // Cardio (19 Oct) copies its time and distance as they were.
    const cardio = sx.measurement === 'cardio';
    const distanceOf = (v: { distanceM?: number | null | undefined } | null | undefined): number | null => (cardio ? (v?.distanceM ?? null) : null);
    const distanceOnly = cardio ? 0 : done.filter((s) => s.actual !== null && s.actual.reps === null && s.actual.durationS === null && s.actual.distanceM !== undefined && s.actual.distanceM !== null).length;
    if (distanceOnly > 0) notCopied.push({ kind: 'distance', exerciseName: sx.exerciseName, sets: distanceOnly });
    if (done.length === 0 && notDone.length === 0) continue;
    const swap = input.swaps?.get(sx.id);
    if (swap !== undefined) {
      // A swapped slot (ADR 0022): the substitute on its own item, with its own targets, or last time's reps with no load.
      exercises.set(swap.exercise.id, swap.exercise);
      if (swap.pin !== null) knownEquipment.set(swap.pin.id, swap.pin);
      const plan = swap.plan ?? [];
      const sources =
        plan.length > 0
          ? plan.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS, from: { kind: 'rule' as const, planned: p.planned } }))
          : done
              .filter((s) => s.setType !== 'warmup' && s.actual !== null && (s.actual.reps !== null || s.actual.durationS !== null))
              .map((s) => {
                const reps = s.actual?.reps ?? null;
                return { setType: s.setType, load: null, reps: reps === null ? null : { min: reps, max: reps }, durationS: reps === null ? (s.actual?.durationS ?? null) : null, from: { kind: 'plain' as const } };
              });
      const templates: SetTemplate[] = shaped(
        sx.id,
        sources.map((a) => {
          const templateId = input.newId();
          copied.set(templateId, a.from);
          return { id: templateId, setType: a.setType, targetLoad: a.load, targetReps: a.reps, targetDurationS: a.durationS, targetRpe: null, targetRir: null, restOverrideS: null };
        }),
      );
      if (templates.length === 0) continue;
      const rexId = input.newId();
      slotSources[rexId] = sx.id;
      rankOf.set(rexId, sx.order);
      routineExercises.push({
        id: rexId,
        exerciseId: swap.exercise.id,
        equipmentId: swapEquipmentId(swap),
        order: routineExercises.length,
        supersetGroup: sx.supersetGroup,
        setTemplates: templates,
        restBySetType: {},
        transitionRestS: sx.transitionRestS,
        progressionRuleId: null,
      });
      continue;
    }
    const known = input.exercises.get(sx.exerciseId);
    // The item it was last done on: the latest part that had equipment (a part with none,
    // e.g. bench at a gym with no bar, doesn't unpin the exercise).
    const sourceEq =
      [...parts]
        .reverse()
        .filter((p) => [...done, ...notDone].some((d) => d.sessionExerciseId === p.id))
        .map((p) => equipmentOfRow(src.session.equipmentSnapshot, p))
        .find((e) => e !== null) ?? null;
    const exercise: Exercise = known ?? {
      id: sx.exerciseId,
      ownerId: null,
      source: 'catalogue',
      name: sx.exerciseName,
      movementPattern: 'unknown',
      primaryMuscles: [],
      measurement: sx.measurement,
      laterality: sx.laterality,
      compatibleEquipment: sourceEq ? [sourceEq.kind] : [],
      defaultLoadConvention: sx.loadConvention,
      version: 1,
      createdAtUtc: src.session.startedAt.utc,
      updatedAtUtc: src.session.startedAt.utc,
    };
    exercises.set(exercise.id, exercise);
    if (sourceEq) knownEquipment.set(sourceEq.id, sourceEq);

    const doneWithReps = done.filter((s) => s.actual !== null && (s.actual.reps !== null || s.actual.durationS !== null || distanceOf(s.actual) !== null));
    const planned = targetsFor(sx.exerciseId);
    type Source = { setType: SetType; load: Load | null; reps: { min: number; max: number } | null; durationS: number | null; distanceM: number | null; from: { kind: 'copy'; set: WorkoutSet } | { kind: 'rule'; planned: PlannedSet } | { kind: 'plain' } };
    const sources: Source[] = [
      ...(planned && planned.length > 0
        ? planned.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS, distanceM: distanceOf(p.planned), from: { kind: 'rule' as const, planned: p.planned } }))
        : doneWithReps.flatMap((s) => (s.actual === null ? [] : [{ setType: s.setType, load: s.actual.load, reps: s.actual.reps === null ? null : { min: s.actual.reps, max: s.actual.reps }, durationS: s.actual.durationS, distanceM: distanceOf(s.actual), from: { kind: 'copy' as const, set: s } }]))),
      // The rest of a cut-short workout's plan, at its own targets (no `Why?` of a copy or the rule).
      ...[...notDone].sort((a, b) => a.index - b.index).map((s) => ({ setType: s.setType, load: s.planned.load, reps: s.planned.reps, durationS: s.planned.durationS, distanceM: distanceOf(s.planned), from: { kind: 'plain' as const } })),
    ];
    let templates: SetTemplate[] = [];
    for (const a of sources) {
      const templateId = input.newId();
      copied.set(templateId, a.from);
      templates.push({
        id: templateId,
        setType: a.setType,
        // The intended target (last time's actual, or the rule's next target); the shared fit decides what this gym can make.
        targetLoad: a.load,
        targetReps: a.reps,
        targetDurationS: a.durationS,
        ...(a.distanceM !== null ? { targetDistanceM: a.distanceM } : {}),
        targetRpe: null,
        targetRir: null,
        restOverrideS: null,
      });
    }
    templates = shaped(sx.id, templates);
    if (templates.length === 0) continue;
    const rexId = input.newId();
    slotSources[rexId] = sx.id;
    rankOf.set(rexId, sx.order);
    routineExercises.push({
      id: rexId,
      exerciseId: exercise.id,
      // Pinned to last time's item: `snapPlanToGym` maps it to this gym (GS3). A FitNotes
      // workout recorded no item (B7): a pin found nowhere, so the fit maps one by the
      // exercise's kinds and rounds toward easier, never above a max, or drops the load (rule 4).
      equipmentId: sourceEq?.id ?? (imported && !needsNoEquipment(exercise) ? importPinId(exercise) : null),
      order: routineExercises.length,
      supersetGroup: sx.supersetGroup,
      setTemplates: templates,
      restBySetType: {},
      transitionRestS: sx.transitionRestS,
      progressionRuleId: null,
      // Done with weight held or worn last time: again (Ben, 18 Oct).
      ...(sx.loadConvention === 'added' && exercise.defaultLoadConvention === 'bodyweight' ? { addedWeight: true } : {}),
    });
  }

  // Exercises added today (§11): their own targets, or the default shape with no load (never another exercise's).
  for (const a of input.added ?? []) {
    const sp = a.plan;
    exercises.set(sp.exercise.id, sp.exercise);
    if (sp.pin !== null) knownEquipment.set(sp.pin.id, sp.pin);
    const plan = sp.plan ?? [];
    type Source = { setType: SetType; load: Load | null; reps: RepRange | null; durationS: number | null; from: { kind: 'rule'; planned: PlannedSet } | { kind: 'plain' } };
    const sources = resizeWorkingSets<Source>(
      plan.length > 0
        ? plan.map((p) => ({ setType: p.setType, load: p.planned.load, reps: p.planned.reps, durationS: p.planned.durationS, from: { kind: 'rule' as const, planned: p.planned } }))
        : addedSlotShape(sp.exercise, sp.pin?.kind ?? null).templates.map((t) => ({ setType: t.setType, load: null, reps: t.reps, durationS: t.durationS, from: { kind: 'plain' as const } })),
      a.workingSets,
    );
    const templates = shaped(
      a.slotKey,
      sources.map((x) => {
        const templateId = input.newId();
        copied.set(templateId, x.from);
        return { id: templateId, setType: x.setType, targetLoad: x.load, targetReps: x.reps, targetDurationS: x.durationS, targetRpe: null, targetRir: null, restOverrideS: null };
      }),
    );
    if (templates.length === 0) continue;
    const rexId = input.newId();
    slotSources[rexId] = a.slotKey;
    rankOf.set(rexId, a.rank);
    routineExercises.push({ id: rexId, exerciseId: sp.exercise.id, equipmentId: swapEquipmentId(sp), order: routineExercises.length, supersetGroup: null, setTemplates: templates, restBySetType: {}, transitionRestS: null, progressionRuleId: null });
  }
  // Today's order: the source rows' (edited) order, added exercises at their place.
  if (input.added !== undefined && input.added.length > 0) {
    const sorted = routineExercises.map((r, i) => ({ r, i })).sort((x, y) => (rankOf.get(x.r.id) ?? 0) - (rankOf.get(y.r.id) ?? 0) || x.i - y.i);
    routineExercises.splice(0, routineExercises.length, ...sorted.map((x, i) => ({ ...x.r, order: i })));
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
  const out = startWorkoutWithMode(
    {
      opId: input.opId,
      owner: input.owner,
      gymId: input.gymId,
      routine,
      exercises: withRest,
      gymEquipment: input.gymEquipment,
      at: input.at,
      newId: input.newId,
      knownEquipment,
      ...(input.gymName !== undefined ? { gymName: input.gymName } : {}),
      ...(input.lastUsedHere ? { lastUsedHere: input.lastUsedHere } : {}),
      ...(input.checkIn !== undefined ? { checkIn: input.checkIn } : {}),
    },
    'repeat',
  );

  // One note per exercise per outcome, in workout order, from fixed wording (gym-switch §5).
  const notes: RepeatNote[] = [];
  const seen = new Set<string>();
  for (const slot of out.snap.slots) {
    for (const note of slot.notes) {
      const text = repeatNoteText(note, slot);
      if (text === null) continue;
      const key = `${slot.exerciseName}|${text}`;
      if (!seen.has(key)) notes.push({ exerciseName: slot.exerciseName, text, tone: note.kind === 'dropped' ? 'warning' : 'info' });
      seen.add(key);
    }
  }

  // `Why?`: each set's provenance, with how the shared fit treated its load here.
  const numbers = setDisplayNumbers(src.exercises, src.sets);
  const fitOf = new Map<string, { slot: SnapSlotResult; set: SnapSetResult }>();
  for (const slot of out.snap.slots) for (const set of slot.sets) fitOf.set(set.id, { slot, set });
  const warningOf = new Map(out.warnings.flatMap((w) => (w.kind === 'target_rounded' || w.kind === 'target_dropped' ? [[w.setTemplateId, w] as const] : [])));
  const fromOf = (setId: string) => {
    const templateId = out.setTemplateIds[setId];
    return templateId === undefined ? undefined : { templateId, from: copied.get(templateId) };
  };
  /** The equipment note for one set: said against last time's set, or the built-in rule's target. */
  const fitNote = (templateId: string, was: 'Last time' | 'Target'): string | null => {
    const fit = fitOf.get(templateId);
    const w = warningOf.get(templateId);
    if (fit === undefined || w === undefined) return null;
    const { slot, set } = fit;
    const wasLower = was === 'Target' ? 'the target' : 'last time';
    if (set.outcome === 'dropped' && set.intended !== null) {
      switch (set.reason) {
        case 'not_here':
          return `No load target: no ${slot.sourceEquipment?.name ?? 'equipment for it'} here.`;
        case 'unit_not_convertible':
          return `No load target: ${wasLower} was ${loadWord(set.intended)}, and there’s no equipment here to check a ${slot.unit} load on.`;
        case 'lightest_is_harder':
          if (set.lightest !== null) return `No load target: ${wasLower} was ${loadWord(set.intended)}, and the easiest here is ${loadWord(set.lightest)}.`;
          break;
        case 'convention_mismatch':
        case 'no_achievable_loads':
        case 'pain_flag':
        case undefined:
          break;
      }
    }
    return startWarningNote(w, slot.equipment, was);
  };
  const provenanceOf = (setId: string): TargetProvenance | null => {
    const found = fromOf(setId);
    const from = found?.from;
    if (found === undefined || from === undefined) return null;
    if (from.kind === 'plain') return null;
    if (from.kind === 'rule') {
      // A target from the built-in rule (Start next session, review B1.1): its own rule provenance, never `repeat`.
      // Without one it reads `Not recorded`, rather than a made-up explanation.
      const rule = from.planned.provenance;
      if (rule === undefined) return null;
      const fit = fitNote(found.templateId, 'Target');
      // r2 S1: a target fitted to a real item here was checked against it; the fit's note (or none, when exact) says how.
      const fitted = (fitOf.get(found.templateId)?.slot.equipment ?? null) !== null;
      const kept = fitted ? rule.guardNotes.filter((n) => n !== UNCHECKED_NOTE) : rule.guardNotes;
      return fitProvenance({ ...rule, guardNotes: fit === null ? kept : [...kept, fit] });
    }
    if (from.set.actual === null) return null;
    const number = numbers.get(from.set.id);
    const fit = fitNote(found.templateId, 'Last time');
    // The part of a split exercise this set was done on (gym-switch GS6): its own item and gym.
    const row = src.exercises.find((e) => e.id === from.set.sessionExerciseId);
    const switched = (src.session.gymChanges?.length ?? 0) > 0;
    const rowEq = row === undefined || !switched ? null : equipmentOfRow(src.session.equipmentSnapshot, row);
    return fitProvenance({
      source: 'repeat',
      setAt: input.at,
      routineName: src.session.routineName,
      requestedLoad: from.set.actual.load,
      basis: {
        sessionId: src.session.id,
        performedAt: src.session.startedAt,
        routineName: src.session.routineName,
        gymId: rowEq?.gymId ?? src.session.gymId,
        equipmentId: row?.equipmentId ?? null,
        sets: [{ setId: from.set.id, version: from.set.version, ...(number !== undefined ? { number } : {}), setType: from.set.setType, side: from.set.side, values: from.set.actual }],
      },
      guardNotes: fit === null ? [] : [fit],
    });
  };
  const aggregate: SessionAggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: null },
    sets: out.aggregate.sets.map((s) => {
      // The synthetic routine isn't the source: the set Ben did last time is, or the built-in rule's target.
      const from = fromOf(s.id)?.from;
      // A coach target for next time (D21) keeps its source and its own `Why?`.
      const source = from?.kind === 'rule' ? (from.planned.source === 'coach' ? 'coach' : 'built_in_rule') : from?.kind === 'plain' ? null : 'repeat';
      const planned: PlannedSet = { ...s.planned };
      // A swapped slot with no history of its own has reps only: no source to claim.
      if (source === null) delete planned.source;
      else planned.source = source;
      const provenance = provenanceOf(s.id);
      if (provenance === null) delete planned.provenance;
      else planned.provenance = provenance;
      return { ...s, planned };
    }),
  };
  return { aggregate, warnings: out.warnings, snap: out.snap, setTemplateIds: out.setTemplateIds, fits: out.fits, notes, notCopied, empty: routineExercises.length === 0, slotSources, ...(input.shape !== undefined ? { shapedFrom } : {}) };
}

/**
 * The names of a workout's exercises with at least one done set, in workout order,
 * once per exercise: an exercise split across gyms (GS6) is listed once (review B1).
 */
export function doneExerciseNames(state: SessionAggregate): string[] {
  const doneRows = new Set(state.sets.filter((s) => s.status === 'completed' && s.pairedWithSetId === null).map((s) => s.sessionExerciseId));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of [...state.exercises].sort((a, b) => a.order - b.order)) {
    if (!doneRows.has(e.id)) continue;
    const root = partRootOf(state.exercises, e.id);
    if (seen.has(root)) continue;
    seen.add(root);
    names.push(e.exerciseName);
  }
  return names;
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

/** One line per exercise for the Repeat preview: `3 sets · Target (as last time) 100 kg × 8, 8, 7`. */
export function repeatPreviewLines(state: SessionAggregate): { exerciseName: string; equipmentName: string | null; line: string }[] {
  return [...state.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
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
      const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
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

function loadWord(l: Load): string {
  return loadText(l, l.convention).replaceAll(NBSP, ' ');
}
