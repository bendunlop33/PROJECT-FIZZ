import { z } from 'zod';
import { IdSchema, LoadConventionSchema, LoadSchema, OperationIdSchema, RepRangeSchema, RpeSchema, TimeZoneSchema, UtcTimestampSchema, WeightUnitSchema, ZonedTimestampSchema } from './common';
import { GymEquipmentKindSchema } from './equipment';
import { MainLiftIdSchema, PlanDayIndexSchema, RestSettingSchema, SetTypeSchema, SplitDayIdSchema } from './routine';
import { SplitBodyPartSchema } from './training-profile';
import { LocalDateSchema } from './import';

/**
 * Coach-built workouts (workout-builder.md v2.1). The coach proposes the
 * structure and (v2, Ben 12 Oct: B6 reversed) a working load per exercise
 * with a short basis, through the typed `propose_workout` tool; code checks
 * it (`checkWorkoutProposal`, `checkProposedLoad`) and stores a
 * `WorkoutDraft` version. A missing or rejected load falls back to the
 * built-in rule (BD6). Minutes come from the estimate and the fit, never
 * from the model (BD11). A draft is Your data, owner-scoped, kept 14 days (BD4).
 */

/** §8.3 limits. The tool's argument schema is wider so the checks can clamp and say so (WB13); these are what a draft may hold. */
export const BUILD_LIMITS = {
  maxExercises: 10,
  maxWarmups: 4,
  minWorkingSets: 1,
  maxWorkingSets: 10,
  minReps: 1,
  maxReps: 50,
  minWorkS: 5,
  maxWorkS: 600,
  /** Cardio (19 Oct): a row, ride or walk may run longer than a timed set. */
  maxCardioS: 7200,
  minRpe: 5,
  maxRpe: 10,
  minRestS: 30,
  /** (Ben, 20 Oct, Q7) Up to 6:00 (was 5:00). */
  maxRestS: 360,
  /** (Q7) The rest after the set a drop set follows ("Before a drop set"): 0:00–1:00. */
  maxRestBeforeDropS: 60,
  minSuperset: 2,
  maxSuperset: 4,
  /** (Workout builder v3 §4.7) Drop sets per exercise; they count against `maxWorkingSets`. */
  maxDropSets: 3,
  /** (§2.2) The builder's length, any minute. */
  minMinutes: 15,
  maxMinutes: 180,
  /** (Coach v3, ADR 0027) Was 240: room for a coach's reasons, with checked numbers. */
  messageMax: 600,
} as const;

/** How long a coach draft is kept (BD4). */
export const COACH_DRAFT_DAYS = 14;

/**
 * A build's focus (§4.1). `coach_picks` = no focus (a text request that names
 * none). The Build card's chips are the Settings split's days (F19):
 * Push/Pull/Legs, Chest/Legs/Shoulders/Back, or a custom day (`split_day`,
 * named by the request's `day`).
 */
export const BuildFocusSchema = z.enum(['coach_picks', 'push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'chest', 'shoulders', 'back', 'split_day']);
export type BuildFocus = z.infer<typeof BuildFocusSchema>;

/** The Build card's length chips (§4.1), in minutes. */
export const BUILD_LENGTH_CHIPS = [30, 45, 60, 75, 90] as const;

// ---------------------------------------------------------------------------
// The tool (`propose_workout`, §8.3)

/**
 * A working load the coach proposes (§8.3). `basis` is data (≤ 60
 * characters), checked by `checkBasis`; `from` is the model's claim (code
 * re-derives `est.` itself). Bodyweight exercises send a null load.
 */
export const LoadProposalSchema = z.strictObject({
  value: z.number().positive().max(2000),
  unit: WeightUnitSchema,
  convention: z.enum(['total', 'per_hand', 'stack', 'added', 'assistance']),
  basis: z.string().max(60),
  from: z.enum(['own_history', 'personal_ratio', 'related_lift', 'estimate']),
  relatedCatalogueId: z.string().min(1).max(80).nullable(),
});
export type LoadProposal = z.infer<typeof LoadProposalSchema>;

/**
 * One exercise in the model's proposal. Strict: an extra field (a `weight`,
 * `minutes`, `gymId`, `equipmentId`, `exerciseName` …) fails the call (BD1,
 * WB3); the tool-call parser never drops it. Optional values are `null`
 * (strict function calling needs every field present; `load` may be absent
 * in calls made before v2, read as null).
 *
 * The number bounds here are only parse bounds: values outside §8.3 are
 * clamped by `checkWorkoutProposal` with a check line, so Ben sees what
 * changed (WB13).
 */
export const ProposedExerciseSchema = z.strictObject({
  /** Must be in the context's usable list (the selected gym's exercises). */
  catalogueId: z.string().min(1).max(80),
  warmups: z.int().min(0).max(100).nullable(),
  workingSets: z.int().min(0).max(100),
  /** Exactly one of `reps` / `workSeconds`. */
  reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }).nullable(),
  workSeconds: z.int().min(0).max(36_000).nullable(),
  /** Cardio only (19 Oct): a distance to aim for, in metres, next to `workSeconds`; null = none. Absent on calls made before it. */
  distanceMetres: z.number().min(0).max(100_000).nullable().optional(),
  /** Working sets' target RPE, 5–10 in half steps. Null: the built-in rule's (BD7). */
  targetRpe: z.number().min(0).max(20).nullable(),
  /** One top set before the working sets, with its own reps, RPE and (v2) load. */
  topSet: z.strictObject({ reps: z.strictObject({ min: z.int().min(0).max(1000), max: z.int().min(0).max(1000) }), targetRpe: z.number().min(0).max(20).nullable(), load: LoadProposalSchema.nullable().optional() }).nullable(),
  /** (v2, BD6) The working (back-off) sets' load; null = no opinion → the built-in rule. */
  load: LoadProposalSchema.nullable().optional(),
  /** Snapped to Ben's nearest rest preset. */
  restSeconds: z.int().min(0).max(3600).nullable(),
  /** Adjacent members share a letter. */
  superset: z.enum(['A', 'B', 'C']).nullable(),
});
export type ProposedExercise = z.infer<typeof ProposedExerciseSchema>;

/**
 * `ask_build_question` (workout-builder v2.1 BD17, §8.4): one clarifying
 * question with 2–4 tap answers. No `goal` topic (code-only, BD20), no
 * length, no pain. The parse bounds are wider than the rules so
 * `checkBuildQuestion` can refuse with a reason; the card shows only what
 * passed (≤ 80 characters, 2–4 answers of ≤ 24).
 */
export const BuildQuestionTopicSchema = z.enum(['main_lift', 'split', 'equipment_today', 'other']);
export type BuildQuestionTopic = z.infer<typeof BuildQuestionTopicSchema>;

export const AskBuildQuestionArgsSchema = z.strictObject({
  topic: BuildQuestionTopicSchema,
  question: z.string().min(1).max(200),
  /** `main_lift`: a catalogueId on each (code shows the catalogue name); others: null. */
  answers: z.array(z.strictObject({ label: z.string().min(1).max(60), catalogueId: z.string().min(1).max(80).nullable() })).min(1).max(8),
});
export type AskBuildQuestionArgs = z.infer<typeof AskBuildQuestionArgsSchema>;

/** Most clarifying questions per build request (BD17). */
export const MAX_BUILD_QUESTIONS = 2;

export const ProposeWorkoutArgsSchema = z.strictObject({
  /** Ignored for display (the name is code-made, BD2); kept in `rawArgs`. */
  name: z.string().max(120).nullable(),
  exercises: z.array(ProposedExerciseSchema).min(1).max(BUILD_LIMITS.maxExercises),
  /** Shown under the card after the claim check; at most 240 characters. */
  message: z.string().max(BUILD_LIMITS.messageMax),
  /**
   * (Coach v3, ADR 0027) The session length the model read from the conversation ("make it 40"),
   * 15–180. Checked by code (`buildMinutesFor`): a length Ben stated outright always wins. Null: none.
   */
  minutes: z.int().min(15).max(180).nullable().optional(),
  /** (Coach v3) The session's focus ("a shoulder workout" → `shoulders`). Null: the request's (or the coach's pick). */
  focus: BuildFocusSchema.exclude(['split_day']).nullable().optional(),
  /** (Coach v3) One of Ben's saved gyms by name (`build.gyms`). Code matches it; an unknown name is refused. Null: the selected gym. */
  gymName: z.string().min(1).max(120).nullable().optional(),
});
export type ProposeWorkoutArgs = z.infer<typeof ProposeWorkoutArgsSchema>;

// ---------------------------------------------------------------------------
// The checked plan (`DraftPlan`, §8.2): routine-shaped, with checked loads (v2)

/**
 * A set template's checked load (v2, BD6): what `checkProposedLoad` decided.
 * `coach`: from Ben's own history; `coach_est`: an estimate (`est.`);
 * `rule`: planned by the built-in rule at plan time (`Rule`); `none`: no
 * load possible (`— · start light`). `basis` is code's reason line, built
 * from real reference sets and the final load (review r2 B1r); in drafts
 * written before that, `basisFromCoach: true` marks it as the coach's text.
 * `coachNote` is the coach's own basis when it passed `checkBasis` (data,
 * shown only behind `Why?` as `Coach's note`; review r4: words only, no
 * numbers, and re-checked at plan time).
 */
export const DraftLoadSourceSchema = z.enum(['coach', 'coach_est', 'rule', 'none', 'calc', 'ben', 'plan']);
export type DraftLoadSource = z.infer<typeof DraftLoadSourceSchema>;

/**
 * (v3 §4.4) Sources for the builder: `calc` (the reps/RPE formula from
 * the working load, labelled an estimate where it rests on est. max),
 * `ben` (a kg Ben typed, kept today only, Q6) and `plan` (the plan's
 * first-week load, `Plan, week 1`; §3.1 step 2, §9 Q12).
 */
export const DraftLoadSchema = z.object({
  load: LoadSchema.nullable(),
  source: DraftLoadSourceSchema,
  basis: z.string().max(80).nullable(),
  /** Drafts before r3 only (`basis` is the coach's text); written `false` now. */
  basisFromCoach: z.boolean(),
  coachNote: z.string().max(80).nullable().optional(),
  held: z.boolean(),
  notes: z.array(z.string().min(1).max(200)).max(8),
  /** A coach basis that failed the check (`Why?` → `NOT USED`). */
  notUsed: z.string().max(80).nullable(),
});
export type DraftLoad = z.infer<typeof DraftLoadSchema>;

/** The item a slot's load was checked on (B7). */
export const CheckedOnSchema = z.object({
  equipmentId: IdSchema,
  kind: GymEquipmentKindSchema,
  convention: LoadConventionSchema,
  unit: WeightUnitSchema,
  barKg: z.number().nonnegative().nullable(),
});
export type CheckedOnRecord = z.infer<typeof CheckedOnSchema>;

export const DraftSetTemplateSchema = z
  .object({
    setType: SetTypeSchema,
    reps: RepRangeSchema.nullable(),
    durationS: z.int().min(BUILD_LIMITS.minWorkS).max(BUILD_LIMITS.maxCardioS).nullable(),
    /** Cardio (19 Oct): a distance to aim for, in metres; absent on every other set. */
    distanceM: z.number().min(0).max(100_000).nullable().optional(),
    /** Working and top sets: the coach's (or the rule's, BD7). Warm-ups: null. */
    targetRpe: RpeSchema.nullable(),
    restS: z.int().min(0).max(BUILD_LIMITS.maxRestS).nullable(),
    /** (v2) The checked load; absent on warm-ups and on drafts made before v2 (the rule plans those). */
    load: DraftLoadSchema.optional(),
  })
  // Cardio (review S3): a distance alone is a whole target ("a 5k row"); every other set has reps or a work time.
  .refine((t) => (t.reps === null) !== (t.durationS === null && t.distanceM == null), { message: 'A set has reps or a work time, not both' })
  .refine((t) => t.distanceM == null || t.reps === null, { message: 'A distance goes with a work time, not reps' });
export type DraftSetTemplate = z.infer<typeof DraftSetTemplateSchema>;

/** (v3) A builder slot's rest kinds (§3.2): `before_drop` is the rest after the set a drop follows. */
export const BuilderRestKindSchema = z.enum(['warmup', 'top', 'backoff', 'working', 'drop', 'before_drop']);
export type BuilderRestKind = z.infer<typeof BuilderRestKindSchema>;

/** (v3) Where a builder slot's working load came from (§3.1, Q12). `typed` rows carry `ben` on their own load. */
export const BuilderSlotSourceSchema = z.enum(['coach_target', 'plan', 'rule', 'calc', 'none']);

/**
 * (v3 §2.3–§2.4) What the builder needs to keep about a slot across a
 * force-close that the set templates don't hold: Ben touched it (merges and
 * fits leave it alone), he unlinked it (never re-paired), the pair it leads
 * was made by the builder (`autoPair`, re-paired by Supersets), its rep
 * range, Ben's own rest per kind and per round, and the load's origin.
 * Absent on coach slots.
 */
export const DraftSlotBuilderSchema = z.object({
  repRange: RepRangeSchema,
  /** Unit and convention of every row's load (the item's). */
  unit: WeightUnitSchema,
  convention: LoadConventionSchema,
  source: BuilderSlotSourceSchema,
  /** Est. max other sets derive from (an estimate, rule 6); null = none. In the slot's load unit. */
  anchorE1rm: z.number().positive().max(5000).nullable(),
  /** `Start light` cap when no load is known; null = none. */
  startLight: z.number().min(0).max(5000).nullable(),
  touched: z.literal(true).optional(),
  unlinked: z.literal(true).optional(),
  /** The plan-day template exercise this slot came from (kept through a swap). */
  origin: IdSchema.optional(),
  /** On a superset's first slot: the builder made this pair. */
  autoPair: z.literal(true).optional(),
  /** On a superset's first slot: Ben's `After each round` (seconds). */
  roundRestS: z.int().min(BUILD_LIMITS.minRestS).max(BUILD_LIMITS.maxRestS).optional(),
  /** Ben's own rest per kind (seconds). */
  restS: z.partialRecord(BuilderRestKindSchema, z.int().min(0).max(BUILD_LIMITS.maxRestS)).optional(),
});
export type DraftSlotBuilder = z.infer<typeof DraftSlotBuilderSchema>;

export const DraftSlotSchema = z.object({
  /** Stable for the draft's life: today's edits point at it (ADR 0022). Kept across versions for the same exercise. */
  slotKey: IdSchema,
  /** Ben's exercise (the catalogue entry resolved to his list). */
  exerciseId: IdSchema,
  /** The catalogue entry the coach named (provenance). */
  catalogueId: z.string().min(1).max(80),
  order: z.int().min(0),
  main: z.boolean(),
  supersetGroup: z.string().min(1).max(8).nullable(),
  setTemplates: z.array(DraftSetTemplateSchema).min(1).max(BUILD_LIMITS.maxWarmups + BUILD_LIMITS.maxWorkingSets + 1),
  /** (v2, B7) The item the loads were checked on; null/absent: none (older drafts re-check as `Rule`). */
  checkedOn: CheckedOnSchema.nullable().optional(),
  /** (v2, B5) The comparable history's version when checked. */
  checkedHistoryVersion: z.string().min(1).max(64).nullable().optional(),
  /**
   * (v3 §4.4) This slot's revision: every write that changes it bumps it. Proposals and review
   * suggestions carry `{ slotId, rev }` preconditions and are refused only when one moved. Absent: 1.
   */
  rev: z.int().min(1).optional(),
  /** (v3 §4.5) Rest per set type, as on `RoutineExercise`. Absent: the defaults. */
  restBySetType: z.partialRecord(SetTypeSchema, RestSettingSchema).optional(),
  /** (v3) The builder's own state for this slot; absent on coach slots. */
  builder: DraftSlotBuilderSchema.optional(),
}).superRefine((slot, ctx) => {
  const t = slot.setTemplates;
  const drops = t.filter((x) => x.setType === 'drop').length;
  if (t.filter((x) => x.setType === 'warmup').length > BUILD_LIMITS.maxWarmups) ctx.addIssue({ code: 'custom', message: `At most ${String(BUILD_LIMITS.maxWarmups)} warm-ups`, path: ['setTemplates'] });
  if (drops > BUILD_LIMITS.maxDropSets) ctx.addIssue({ code: 'custom', message: `At most ${String(BUILD_LIMITS.maxDropSets)} drop sets`, path: ['setTemplates'] });
  // Drops count against the working sets (§4.7). Checked only where drops exist, so older drafts read unchanged.
  if (drops > 0 && t.filter((x) => x.setType !== 'warmup').length > BUILD_LIMITS.maxWorkingSets) ctx.addIssue({ code: 'custom', message: `At most ${String(BUILD_LIMITS.maxWorkingSets)} sets, drops included`, path: ['setTemplates'] });
  // Q7: the rest after the set a drop follows is 0:00–1:00; a drop set's own rest and every other is 0:30 up to the max.
  t.forEach((x, i) => {
    if (x.restS === null) return;
    const beforeDrop = t[i + 1]?.setType === 'drop';
    const ok = beforeDrop ? x.restS <= BUILD_LIMITS.maxRestBeforeDropS : x.restS >= BUILD_LIMITS.minRestS && x.restS <= BUILD_LIMITS.maxRestS;
    if (!ok) ctx.addIssue({ code: 'custom', message: beforeDrop ? 'Rest before a drop set is 0:00–1:00' : 'Rest is 0:30–6:00', path: ['setTemplates', i, 'restS'] });
  });
});
export type DraftSlot = z.infer<typeof DraftSlotSchema>;

/** A slot's revision (absent = 1). */
export const slotRev = (slot: Pick<DraftSlot, 'rev'>): number => slot.rev ?? 1;

/**
 * The checked plan. (v3 §4.4) Zero slots are allowed while a builder draft is
 * open (the empty workout, Start disabled); a coach version, a plan day and a
 * started draft need at least one (refined where they're used). A superset
 * holds at most `maxSuperset` exercises.
 */
export const DraftPlanSchema = z.object({ slots: z.array(DraftSlotSchema).max(BUILD_LIMITS.maxExercises) }).superRefine((p, ctx) => {
  const size = new Map<string, number>();
  for (const s of p.slots) if (s.supersetGroup !== null) size.set(s.supersetGroup, (size.get(s.supersetGroup) ?? 0) + 1);
  for (const [g, n] of size) if (n > BUILD_LIMITS.maxSuperset) ctx.addIssue({ code: 'custom', message: `Superset ${g} has ${String(n)} exercises; at most ${String(BUILD_LIMITS.maxSuperset)}`, path: ['slots'] });
});
export type DraftPlan = z.infer<typeof DraftPlanSchema>;

/** A plan with at least one slot (coach versions, plan days, a started draft). */
export const NonEmptyDraftPlanSchema = DraftPlanSchema.refine((p) => p.slots.length >= 1, { message: 'A workout needs at least one exercise', path: ['slots'] });

/** A check written by code (BD9), never by the model. `leftOut`: the exercise isn't in the draft. */
export const BuildCheckSchema = z.object({
  kind: z.enum(['unknown', 'not_here_swapped', 'not_here_left_out', 'pain', 'duplicate', 'ungrouped', 'clamped', 'rest_snapped', 'rpe_missing', 'reps_changed', 'shape', 'load', 'main_kept']),
  catalogueId: z.string().max(80).nullable(),
  exerciseId: IdSchema.nullable(),
  /** App text, e.g. `Overhead press left out · shoulder flagged 6 Oct`. */
  text: z.string().min(1).max(200),
  leftOut: z.boolean(),
});
export type BuildCheck = z.infer<typeof BuildCheckSchema>;

export const BuildRequestOriginSchema = z.enum(['chip', 'card', 'text', 'voice']);

/** (v3 §4.4) A workout draft version's origin: a coach build (as before) or the builder (`builder`: Ben's own Set up and edits). */
export const WorkoutDraftOriginSchema = z.enum([...BuildRequestOriginSchema.options, 'builder']);
export type WorkoutDraftOrigin = z.infer<typeof WorkoutDraftOriginSchema>;

/** (v3 §2.2, §4.4) One muscle-group row on Set up: stored as body parts (`Legs` = its parts), 1–4 exercises. */
export const BuilderGroupCountSchema = z.object({
  parts: z.array(SplitBodyPartSchema).min(1).max(10),
  count: z.int().min(1).max(4),
});

/** (v3 §4.4) Set up as Ben left it. Group labels (`Legs`, `Abs`) are derived when read. */
export const BuilderSetupSchema = z.object({
  dayId: SplitDayIdSchema,
  minutes: z.int().min(BUILD_LIMITS.minMinutes).max(BUILD_LIMITS.maxMinutes),
  mainLiftExerciseId: MainLiftIdSchema.nullable(),
  supersets: z.boolean(),
  groups: z.array(BuilderGroupCountSchema).max(10),
  templateRoutineId: IdSchema.optional(),
  templateVersion: z.int().min(1).optional(),
  variationId: IdSchema.nullable().optional(),
  /** (v3 §2.0.2 3a) The fit ladder's rest level; absent = normal. */
  restLevel: z.enum(['normal', 'shorter', 'shortest']).optional(),
  /** (v3 §2.3) Ben changed a group count, so Set up shows `Use recommended` instead of `Recommended`. */
  groupsEdited: z.literal(true).optional(),
});
export type BuilderSetup = z.infer<typeof BuilderSetupSchema>;

/**
 * (v3 §4.4) Which builder draft this is: one open draft per (owner, plan,
 * plan day index, split day, main lift, local date), resumed on reopen
 * (unique index `workout_drafts_open_builder`, migration 30). `planId` and
 * `dayIndex` are null together (a split day with no plan, or no day): a plan
 * that repeats a split day keeps its days' drafts apart (review b3-data B1).
 */
export const BuilderDraftKeySchema = z
  .object({
    planId: IdSchema.nullable(),
    dayIndex: PlanDayIndexSchema.nullable(),
    splitDayId: SplitDayIdSchema.nullable(),
    mainLiftExerciseId: MainLiftIdSchema.nullable(),
    localDate: LocalDateSchema,
  })
  .refine((k) => (k.planId === null) === (k.dayIndex === null), { message: 'A plan day is named with its index', path: ['dayIndex'] });
export type BuilderDraftKey = z.infer<typeof BuilderDraftKeySchema>;

/** The text key of a builder draft, as the unique index `workout_drafts_open_builder` holds it. */
export function builderDraftKeyText(k: BuilderDraftKey): string {
  return `${k.planId ?? '-'}|${k.dayIndex === null ? '-' : String(k.dayIndex)}|${k.splitDayId ?? '-'}|${k.mainLiftExerciseId ?? '-'}|${k.localDate}`;
}

/** The split day a Build card chip asked for (F19): its name and body parts. */
export const BuildDaySchema = z.object({
  name: z.string().trim().min(1).max(30),
  bodyParts: z.array(SplitBodyPartSchema).min(1).max(10),
});
export type BuildDay = z.infer<typeof BuildDaySchema>;

export const WorkoutDraftVersionSchema = z.object({
  n: z.int().min(1),
  parentN: z.int().min(1).nullable(),
  status: z.enum(['current', 'replaced']),
  actionId: IdSchema,
  turnId: z.string().min(1).max(64),
  request: z.object({
    /** Ben's words, quoted: data, never instructions (rule 8). */
    text: z.string().max(4000),
    minutes: z.int().min(15).max(180),
    focus: BuildFocusSchema,
    gymId: IdSchema.nullable(),
    origin: WorkoutDraftOriginSchema,
    /** (F19) The split day chosen on the Build card; absent on older drafts and text requests. */
    day: BuildDaySchema.optional(),
    /** (v3 §4.4) Set up, on a builder version (`origin: 'builder'`). */
    setup: BuilderSetupSchema.optional(),
  }),
  /** The model's arguments as received (data). */
  rawArgs: z.string().max(40_000),
  plan: DraftPlanSchema,
  /** The length the overview fits to (BD11): from Ben's words or chips, never the model's. */
  fitMinutes: z.int().min(15).max(180),
  checks: z.array(BuildCheckSchema).max(60),
  /** The coach's message after the claim check (null when it was hidden). */
  rationale: z.string().max(BUILD_LIMITS.messageMax).nullable(),
  /** (Coach v3) The rationale's numbers were checked against the facts at build time, so they may show. Absent: words only. */
  rationaleNumbersChecked: z.literal(true).optional(),
  contextHash: z.string().min(1).max(128),
  equipmentVersion: z.string().min(1).max(128),
  createdAt: ZonedTimestampSchema,
}).superRefine((v, ctx) => {
  const builder = v.request.origin === 'builder';
  // A coach version always holds a workout; a builder version may be empty while open (§4.4).
  if (!builder && v.plan.slots.length === 0) ctx.addIssue({ code: 'custom', message: 'A coach version needs at least one exercise', path: ['plan', 'slots'] });
  if (builder && v.request.setup === undefined) ctx.addIssue({ code: 'custom', message: 'A builder version records its set-up', path: ['request', 'setup'] });
  if (builder && (v.turnId !== 'manual' || v.rawArgs !== '')) ctx.addIssue({ code: 'custom', message: 'A builder version has no model turn', path: ['turnId'] });
  // A builder superset holds 2–4 exercises (§4.7). Older coach versions are left as stored (an ungrouped
  // check flags them), the same way the drop-set limits only bind where drops exist.
  if (builder) {
    const size = new Map<string, number>();
    for (const sl of v.plan.slots) if (sl.supersetGroup !== null) size.set(sl.supersetGroup, (size.get(sl.supersetGroup) ?? 0) + 1);
    for (const [g, n] of size) if (n < BUILD_LIMITS.minSuperset) ctx.addIssue({ code: 'custom', message: `Superset ${g} needs at least ${String(BUILD_LIMITS.minSuperset)} exercises`, path: ['plan', 'slots'] });
  }
});
export type WorkoutDraftVersion = z.infer<typeof WorkoutDraftVersionSchema>;

/**
 * (v3 §4.4) The state before the last undoable builder edit, kept on the
 * draft so Undo survives a force-close. Undo only from `atVersion` (the
 * version that edit left; rule 5). `Rebuilt · Undo` restores both pages:
 * the set-up and the plan of version `currentVersion`.
 */
export const BuilderUndoSchema = z.object({
  opId: OperationIdSchema,
  atVersion: z.int().min(1),
  snapshot: z.object({
    currentVersion: z.int().min(1),
    setup: BuilderSetupSchema.nullable(),
    plan: DraftPlanSchema,
  }),
});
export type BuilderUndo = z.infer<typeof BuilderUndoSchema>;

export const WorkoutDraftStatusSchema = z.enum(['open', 'started', 'discarded', 'expired']);
export type WorkoutDraftStatus = z.infer<typeof WorkoutDraftStatusSchema>;

/** Most operation IDs remembered for idempotency. */
export const MAX_WORKOUT_DRAFT_OPS = 200;
/** Most versions kept (each `Make it shorter` is one). */
export const MAX_WORKOUT_DRAFT_VERSIONS = 20;

/**
 * A coach-built workout before it's started (§8.2). `status` is `open`
 * until started, discarded or expired; a draft saved to Workouts stays open
 * (`routineId` set) so Ben may still start it. Every write bumps `version`
 * and records its `opId` (rule 5).
 */
export const WorkoutDraftSchema = z
  .object({
    id: IdSchema,
    ownerId: IdSchema,
    status: WorkoutDraftStatusSchema,
    /** Code-made: `Push · 45 min` (BD2). */
    name: z.string().min(1).max(120),
    currentVersion: z.int().min(1),
    versions: z.array(WorkoutDraftVersionSchema).min(1).max(MAX_WORKOUT_DRAFT_VERSIONS),
    sessionId: IdSchema.nullable(),
    startedAtUtc: UtcTimestampSchema.nullable(),
    routineId: IdSchema.nullable(),
    /** Discard is a status; Undo restores `open` (toast). */
    discardedAtUtc: UtcTimestampSchema.nullable(),
    opIds: z.array(OperationIdSchema).max(MAX_WORKOUT_DRAFT_OPS),
    createdAt: ZonedTimestampSchema,
    tz: TimeZoneSchema,
    /** Created + 14 days (BD4). */
    expiresAtUtc: UtcTimestampSchema,
    version: z.int().min(1),
    updatedAtUtc: UtcTimestampSchema,
    /** (v3 §4.4) A builder draft's key; absent on coach drafts. */
    builderKey: BuilderDraftKeySchema.optional(),
    /** (v3 §4.4) The last undoable edit's before-state; absent or null: nothing to undo. */
    undo: BuilderUndoSchema.nullable().optional(),
  })
  .refine((d) => d.versions.some((v) => v.n === d.currentVersion && v.status === 'current'), { message: 'The current version must exist', path: ['currentVersion'] })
  .refine((d) => (d.status === 'started') === (d.sessionId !== null), { message: 'Only a started draft names its session', path: ['sessionId'] })
  // §4.4: Start refuses an empty workout, so a started draft always holds one.
  .refine((d) => d.status !== 'started' || (d.versions.find((v) => v.n === d.currentVersion)?.plan.slots.length ?? 0) > 0, { message: 'A started draft has at least one exercise', path: ['versions'] });
export type WorkoutDraft = z.infer<typeof WorkoutDraftSchema>;

/** A session started from a coach draft (§6.3): provenance for `Why?`. */
export const SessionCoachDraftSchema = z.object({ draftId: IdSchema, version: z.int().min(1), name: z.string().min(1).max(120) });
export type SessionCoachDraft = z.infer<typeof SessionCoachDraftSchema>;
