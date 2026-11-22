/**
 * Catalogue entry format v1 (research exercise-bank-and-visuals §4.2, plus the
 * optional batch-01 additions; ADR 0011). One JSON file per exercise in
 * `data/exercises/<key>.json`. Objects are strict: an unknown field is an
 * error, so typos can't slip through.
 *
 * Everything here is Coaching knowledge (CLAUDE.md rule 10): general content
 * that never says anything about Ben.
 */
import {
  CatalogueKeySchema,
  CatalogueMeasurementSchema,
  EquipmentKindSchema,
  ImplementCountSchema,
  LateralitySchema,
  LoadConventionSchema,
  MechanicSchema,
} from '@fizz/schemas';
import { z } from 'zod';
import { FamilySchema, LicenceSchema, MovementPatternSchema, MuscleSchema, StationSchema } from './vocab';

/** `YYYY-MM-DD` calendar date (checked-on, retrieved-on, approved-on). */
export const IsoDateSchema = z.iso.date();

const text = (max: number) => z.string().trim().min(1).max(max);

/** Cue copy rule: imperative, at most 60 characters, 2–4 per group. */
export const CUE_MAX_CHARS = 60;
const cueGroup = z.array(text(CUE_MAX_CHARS)).min(2).max(4);

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

const uniqueArray = <S extends z.ZodType>(item: S, max: number) =>
  z.array(item).max(max).refine(unique, { message: 'Values must be unique' });

export const CrossCheckSchema = z.strictObject({
  source: z.enum(['wger', 'repdb']),
  sourceId: text(120),
  licence: LicenceSchema,
  author: text(200),
});

export const ProvenanceSchema = z.strictObject({
  /** Who authored the record. `fizz` = written by us. */
  source: z.enum(['fizz', 'wger']),
  crossCheckedWith: z.array(CrossCheckSchema).max(10),
  /** Field paths whose text came from a licensed source, e.g. `aliases[1]`. */
  copiedFields: z.array(text(120)).max(50),
  retrievedOn: IsoDateSchema,
});

const ReviewStatusSchema = z.enum(['draft', 'checked', 'approved']);

export const ReviewSchema = z
  .strictObject({
    status: ReviewStatusSchema,
    /** Set only from Ben's own message, relayed by the PM (research §5.6). */
    benApprovedOn: IsoDateSchema.nullable(),
  })
  .refine((r) => (r.status === 'approved') === (r.benApprovedOn !== null), {
    message: 'benApprovedOn is set exactly when status is approved',
    path: ['benApprovedOn'],
  });

const basicFields = {
  schemaVersion: z.literal(1),
  key: CatalogueKeySchema,
  name: text(120),
  aliases: uniqueArray(text(120), 20),
  family: FamilySchema,
  movementPattern: MovementPatternSchema,
  mechanic: MechanicSchema,
  primaryMuscles: uniqueArray(MuscleSchema, 20).refine((m) => m.length > 0, { message: 'At least one primary muscle' }),
  secondaryMuscles: uniqueArray(MuscleSchema, 20),
  compatibleEquipment: uniqueArray(EquipmentKindSchema, 6).refine((e) => e.length > 0, {
    message: 'At least one equipment kind',
  }),
  requiresStation: uniqueArray(StationSchema, 5).optional(),
  defaultLoadConvention: LoadConventionSchema,
  measurement: CatalogueMeasurementSchema,
  laterality: LateralitySchema,
  /**
   * `per_hand` exercises only: done with one dumbbell or kettlebell, or two
   * (`ImplementCount`). Absent when the exercise is commonly done either way
   * (a single-leg RDL), so an importer asks rather than assumes.
   */
  implements: ImplementCountSchema.optional(),
  defaultRestS: z.int().min(0).max(900).optional(),
  provenance: ProvenanceSchema,
};

export const CuesSchema = z.strictObject({
  setup: cueGroup,
  execution: cueGroup,
  faults: cueGroup,
});

export const SafetySchema = z.strictObject({
  notes: z.array(text(300)).min(1).max(8),
  /** When to stop. Never names a condition or diagnoses (rule 9). */
  stopIf: z.array(text(120)).min(1).max(6),
});

export const VariationSchema = z.strictObject({
  /** Null when the variation has no catalogue entry (e.g. "Lighter sled"). */
  key: CatalogueKeySchema.nullable(),
  name: text(120),
  reason: text(240),
});

export const VariationsSchema = z.strictObject({
  regressions: z.array(VariationSchema).max(6),
  progressions: z.array(VariationSchema).max(6),
  substitutions: z.array(VariationSchema).max(8),
});

export const KeyPositionSchema = z.strictObject({
  label: text(40),
  describe: text(400),
  /** Approximate drawing targets (batch-01 conventions), not form standards. */
  approxAnglesDeg: z.record(z.string().regex(/^[a-zA-Z]+$/), z.number().min(-180).max(360)).optional(),
});

/** Rep tempo: direction the load or hands move, not eccentric/concentric. */
export const RepTempoSchema = z.strictObject({
  downMs: z.int().min(0).max(10_000),
  holdMs: z.int().min(0).max(10_000),
  upMs: z.int().min(0).max(10_000),
});
/** Stride tempo for locomotion (sled push, carries). */
export const StrideTempoSchema = z.strictObject({
  stepMs: z.int().min(100).max(5_000),
  stepsPerCycle: z.int().min(1).max(8),
});
export const TempoSchema = z.union([RepTempoSchema, StrideTempoSchema]);
export type Tempo = z.infer<typeof TempoSchema>;

export const GuideViewSchema = z.enum(['side', 'front']);
export type GuideView = z.infer<typeof GuideViewSchema>;

export const GuideBriefSchema = z.strictObject({
  view: GuideViewSchema,
  cameraNote: text(400).optional(),
  keyPositions: z
    .array(KeyPositionSchema)
    .min(2)
    .max(8)
    .refine((ps) => unique(ps.map((p) => p.label)), { message: 'Key-position labels must be unique' }),
  /** Contact constraints that are better solved by IK than given as angles. */
  ikHints: z.array(text(240)).max(8).optional(),
  barPath: text(240).optional(),
  tempo: TempoSchema,
  props: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(10),
  emphasise: z.array(text(160)).max(8),
  doNotShow: z.array(text(160)).max(10),
});
export type GuideBrief = z.infer<typeof GuideBriefSchema>;

export const SourceSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  title: text(400).optional(),
  checkedOn: IsoDateSchema,
  /** Which entry fields the source supports, e.g. `cues.execution[1]`. */
  supports: text(400),
  /** Abstract-only, commercial, or seen only through a search listing. */
  note: text(400).optional(),
});

export const UncertainSchema = z.strictObject({
  field: text(160),
  note: text(600),
});

export const BasicEntrySchema = z.strictObject({
  ...basicFields,
  tier: z.literal('basic'),
  review: ReviewSchema.optional(),
});

export const RichEntrySchema = z.strictObject({
  ...basicFields,
  tier: z.literal('rich'),
  cues: CuesSchema,
  safety: SafetySchema,
  variations: VariationsSchema.optional(),
  guideBrief: GuideBriefSchema,
  sources: z.array(SourceSchema).min(1).max(12),
  uncertain: z.array(UncertainSchema).max(20).optional(),
  review: ReviewSchema,
});

export const CatalogueEntrySchema = z
  .discriminatedUnion('tier', [BasicEntrySchema, RichEntrySchema])
  .superRefine((e, ctx) => {
    const primary = new Set<string>(e.primaryMuscles);
    e.secondaryMuscles.forEach((m, i) => {
      if (primary.has(m)) {
        ctx.addIssue({ code: 'custom', message: `${m} is listed as both primary and secondary`, path: ['secondaryMuscles', i] });
      }
    });
    if (e.provenance.copiedFields.length > 0 && e.provenance.crossCheckedWith.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'copiedFields needs the licensed source (licence and author) in crossCheckedWith',
        path: ['provenance', 'copiedFields'],
      });
    }
    if (e.aliases.some((a) => a.toLowerCase() === e.name.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: 'An alias repeats the name', path: ['aliases'] });
    }
    if (e.implements !== undefined && e.defaultLoadConvention !== 'per_hand') {
      ctx.addIssue({ code: 'custom', message: 'implements is only for per_hand (dumbbell or kettlebell) exercises', path: ['implements'] });
    }
  });

export type BasicEntry = z.infer<typeof BasicEntrySchema>;
export type RichEntry = z.infer<typeof RichEntrySchema>;
export type CatalogueEntry = z.infer<typeof CatalogueEntrySchema>;
export type Variation = z.infer<typeof VariationSchema>;
