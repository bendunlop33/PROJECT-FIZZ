import type { CheckedOnRecord, DraftLoad, DraftLoadSource, DraftPlan, DraftSetTemplate, DraftSlot, LoadConvention, WeightUnit } from '@fizz/schemas';
import { clampBuilderRest, restAfterRows, roundRestOf } from '../builder/rest';
import type { BuilderBlock, BuilderInfoLookup, BuilderLoadSourceKind, BuilderSetRow, BuilderSlot, BuilderWorkout, RestKind } from '../builder/types';
import { BUILDER_SET_RULES } from '../builder/set-rows';
import { deriveId } from '../stable';

/**
 * Today (v2) and the builder share one stored workout: the builder draft
 * (`WorkoutDraft`, origin `builder`, §4.4). These map the pure builder's
 * `BuilderWorkout` to the stored `DraftPlan` and back. Pure.
 *
 * MERGE NOTE: the builder stream (Set up / Your workout) writes the same
 * drafts; keep one mapping when the streams merge.
 *
 * - Every row becomes a set template with its load (warm-ups too), already
 *   rounded down at this gym by the builder (rule 4), and the item it was
 *   rounded on (`checkedOn`). Start pins these loads (`planCoachDraft`'s
 *   builder branch), so Today, the builder and the started workout agree.
 * - Rest per set is the rest after that set at the workout's rest level
 *   (§3.2, §4.5), clamped to Q7's limits; inside a superset only the last
 *   member rests (`After each round`), the others carry none (0 switch time, Q16).
 * - `plan` loads are stored as `rule`: `DraftLoadSourceSchema` has no `plan`
 *   value yet (S1 merge note in builder/types.ts; open).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A slot key the store accepts (a UUID): the builder's own when it is one, else derived from it. */
export function draftSlotKeyOf(key: string): string {
  return UUID.test(key) ? key.toLowerCase() : deriveId(`builder-slot:${key}`);
}

const SOURCE_TO_DRAFT: Readonly<Record<BuilderLoadSourceKind, DraftLoadSource>> = {
  coach_target: 'coach',
  plan: 'rule',
  rule: 'rule',
  calc: 'calc',
  none: 'none',
};

const DRAFT_TO_SOURCE: Readonly<Record<DraftLoadSource, BuilderLoadSourceKind>> = {
  coach: 'coach_target',
  coach_est: 'coach_target',
  rule: 'rule',
  calc: 'calc',
  ben: 'calc',
  none: 'none',
};

export interface DraftPlanFromWorkoutInput {
  workout: BuilderWorkout;
  info: BuilderInfoLookup;
  restPresetsS?: readonly number[];
  /** The catalogue key a slot's exercise came from (provenance); Ben's own exercise: its ID. */
  catalogueIdOf: (exerciseId: string) => string;
  /** The item this gym gave the exercise (its loads were rounded on it); null: none needed or none here. */
  checkedOnOf: (exerciseId: string) => CheckedOnRecord | null;
}

function loadOf(row: BuilderSetRow, slot: BuilderSlot): DraftLoad {
  const load = row.load === null ? null : slot.convention === 'bodyweight' ? { value: 0, unit: slot.unit, convention: slot.convention } : { value: row.load, unit: slot.unit, convention: slot.convention };
  return { load, source: row.typed === true ? 'ben' : SOURCE_TO_DRAFT[slot.source], basis: null, basisFromCoach: false, held: false, notes: [], notUsed: null };
}

function repsOf(row: BuilderSetRow, slot: BuilderSlot): { min: number; max: number } {
  if (row.type === 'working') return { min: row.reps, max: Math.max(row.reps, slot.repRange.max) };
  return { min: row.reps, max: row.reps };
}

/** The rest after each row, clamped to Q7 (before a drop 0–1:00; others 0:30–6:00). */
function restsOf(slot: BuilderSlot, block: BuilderBlock, w: BuilderWorkout, input: DraftPlanFromWorkoutInput): (number | null)[] {
  const solo = block.slots.length === 1;
  const last = block.slots[block.slots.length - 1] === slot;
  const own = restAfterRows(slot, input.info, w.restLevel, input.restPresetsS);
  const round = solo ? null : roundRestOf(block, w.restLevel, input.restPresetsS);
  return slot.rows.map((row, i) => {
    const next = slot.rows[i + 1];
    const kind: RestKind | 'round' = next?.type === 'drop' && row.type !== 'warmup' ? 'before_drop' : !solo && row.type !== 'warmup' ? 'round' : row.type;
    if (!solo && row.type !== 'warmup' && !last) return null;
    const s = kind === 'round' ? (round ?? own[i] ?? 0) : (own[i] ?? 0);
    return clampBuilderRest(kind, s);
  });
}

/** `builderWorkoutToDraftPlan`: the stored plan for a built workout (order, supersets A/B/…, set templates with loads). */
export function builderWorkoutToDraftPlan(input: DraftPlanFromWorkoutInput): DraftPlan {
  const slots: DraftSlot[] = [];
  let group = 0;
  for (const block of input.workout.blocks) {
    if (block.slots.length === 0) continue;
    const letter = block.slots.length > 1 ? String.fromCharCode(65 + (group++ % 26)) : null;
    for (const slot of block.slots) {
      const rests = restsOf(slot, block, input.workout, input);
      const setTemplates: DraftSetTemplate[] = slot.rows.map((row, i) => ({
        setType: row.type,
        reps: repsOf(row, slot),
        durationS: null,
        targetRpe: row.type === 'warmup' ? null : row.rpe,
        restS: rests[i] ?? null,
        load: loadOf(row, slot),
      }));
      const checkedOn = input.checkedOnOf(slot.exerciseId);
      slots.push({
        slotKey: draftSlotKeyOf(slot.key),
        exerciseId: slot.exerciseId,
        catalogueId: input.catalogueIdOf(slot.exerciseId).slice(0, 80),
        order: slots.length,
        main: slot.main,
        supersetGroup: letter,
        setTemplates,
        checkedOn,
        rev: 1,
      });
    }
  }
  return { slots };
}

// ---------------------------------------------------------------------------
// Back: a stored plan as the builder's shape (an edited draft on Today's card)

/**
 * `draftPlanAsBuilderWorkout`: a stored plan read back for display and the
 * §3.6 estimate (each slot keeps its stored rests as its own, so the
 * estimate uses them). Reps are each template's lower end.
 */
export function draftPlanAsBuilderWorkout(plan: DraftPlan): BuilderWorkout {
  const sorted = [...plan.slots].sort((a, b) => a.order - b.order);
  const blocks: BuilderBlock[] = [];
  for (const s of sorted) {
    const slot = slotOf(s);
    const prev = blocks[blocks.length - 1];
    const prevGroup = prev === undefined ? null : (sorted.find((x) => x.slotKey === prev.slots[0]?.key)?.supersetGroup ?? null);
    if (prev !== undefined && s.supersetGroup !== null && prevGroup === s.supersetGroup) {
      prev.slots.push(slot);
      const round = [...s.setTemplates].reverse().find((t) => t.setType !== 'warmup')?.restS;
      if (round !== null && round !== undefined) prev.roundRestS = round;
    } else {
      blocks.push({ slots: [slot], auto: false });
    }
  }
  return { blocks, restLevel: 'normal' };
}

function slotOf(s: DraftSlot): BuilderSlot {
  const firstLoad = s.setTemplates.find((t) => t.load?.load != null)?.load?.load ?? null;
  const unit: WeightUnit = firstLoad?.unit ?? s.checkedOn?.unit ?? 'kg';
  const convention: LoadConvention = firstLoad?.convention ?? s.checkedOn?.convention ?? 'total';
  const working = s.setTemplates.find((t) => t.setType === 'working' || t.setType === 'backoff') ?? s.setTemplates.find((t) => t.setType !== 'warmup');
  const range = working?.reps ?? (s.main ? BUILDER_SET_RULES.mainRange : BUILDER_SET_RULES.accessoryRange);
  const restS: Partial<Record<RestKind, number>> = {};
  s.setTemplates.forEach((t, i) => {
    if (t.restS === null) return;
    const kind: RestKind = s.setTemplates[i + 1]?.setType === 'drop' && t.setType !== 'warmup' ? 'before_drop' : t.setType;
    if (restS[kind] === undefined) restS[kind] = t.restS;
  });
  const stored = s.setTemplates.find((t) => t.setType !== 'warmup' && t.load !== undefined)?.load;
  return {
    key: s.slotKey,
    exerciseId: s.exerciseId,
    main: s.main,
    repRange: { min: range.min, max: range.max },
    rows: s.setTemplates.map((t) => ({ type: t.setType, reps: t.reps?.min ?? 0, load: t.load?.load?.value ?? null, rpe: t.setType === 'warmup' ? null : t.targetRpe, ...(t.load?.source === 'ben' ? { typed: true as const } : {}) })),
    unit,
    convention,
    source: stored === undefined ? 'none' : stored.load === null ? 'none' : DRAFT_TO_SOURCE[stored.source],
    startLight: null,
    anchorE1rm: null,
    ...(Object.keys(restS).length > 0 ? { restS } : {}),
  };
}
