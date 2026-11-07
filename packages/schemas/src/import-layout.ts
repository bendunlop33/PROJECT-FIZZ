import { z } from 'zod';
import { IdSchema, OperationIdSchema, RecordMetaSchema, WeightUnitSchema, ZonedTimestampSchema } from './common';

/**
 * Import from any app (data-import-export.md §9, ADR 0026). Everything here is
 * **Your data** (rule 10): the layout describes Ben's own file.
 *
 * The coach proposes a parser plan, `ImportMappingSpecV1`, in a closed
 * vocabulary. It has **no field that can carry a set, a load value, a load
 * convention, a record kind (done or planned) or a unit conversion** (check
 * 40): pure code (`applyImportSpec` in `@fizz/domain`) reads every row from
 * the file's own cells, and Ben's answers (`LayoutAnswers`) settle what the
 * file doesn't say. Optional values are `null`, never absent (strict
 * function calls), and unknown fields fail the parse.
 */

/** Separators a table may use (§9.3.1). */
export const TableDelimiterSchema = z.enum([',', ';', '\t']);
export type TableDelimiter = z.infer<typeof TableDelimiterSchema>;

/** A column, by its exact header cell and position. Code checks the two agree (check 2). */
export const ColumnRefSchema = z.strictObject({
  header: z.string().max(200),
  index: z.int().min(0).max(63),
});
export type ColumnRef = z.infer<typeof ColumnRefSchema>;

export const UnitTokenSchema = z.enum(['kg', 'kgs', 'lb', 'lbs']);
export type UnitToken = z.infer<typeof UnitTokenSchema>;

/**
 * Where the weight unit is written. Code checks it against the whole file
 * (check 3) and maps unit words itself; the model never converts anything.
 */
export const UnitEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('header_token'), column: ColumnRefSchema, token: UnitTokenSchema }),
  z.strictObject({ kind: z.literal('unit_column'), column: ColumnRefSchema }),
  z.strictObject({ kind: z.literal('none') }),
]);
export type UnitEvidence = z.infer<typeof UnitEvidenceSchema>;

/**
 * The closed list of date and time formats (§9.6.2). `day_month_unknown`: `03/04/2025`-style dates whose order the file doesn't settle.
 * `YYYY-MM-DDTHH:mm:ssZ`: an ISO instant with `Z` or `±HH:MM` (FitNotes 2's `StartTime`), read as that instant in the import's zone.
 */
export const DateFormatSchema = z.enum([
  'YYYY-MM-DD',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ssZ',
  'D MMM YYYY, HH:mm',
  'unix_seconds',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'day_month_unknown',
]);
export type DateFormat = z.infer<typeof DateFormatSchema>;

/**
 * How a set cell is written (§9.6.2):
 * - `load_x_reps` / `reps_x_load`: one set, `100x8` / `8x100`;
 * - `sets_x_reps`: `3x8`, the load in the load column;
 * - `sets_x_reps_at_load`: `3x8 @ 100`;
 * - `reps_list`: `8,8,6`, the load in the load column;
 * - `unknown`: none of these.
 * A cell's orientation (`3x8`: 3 sets of 8, or 8 sets of 3) is always Ben's answer (AI5).
 */
export const CellNotationSchema = z.enum(['load_x_reps', 'reps_x_load', 'sets_x_reps', 'sets_x_reps_at_load', 'reps_list', 'unknown']);
export type CellNotation = z.infer<typeof CellNotationSchema>;

/**
 * The table's shape. `sections_joined` (JEFIT's multi-section files) is not
 * in v1: the one-header sample can't show both sections (ADR 0026, open item).
 */
export const LayoutSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('row_per_set'), setOrder: ColumnRefSchema.nullable() }),
  z.strictObject({ kind: z.literal('row_per_exercise_packed'), sets: ColumnRefSchema, notation: CellNotationSchema }),
  z.strictObject({ kind: z.literal('wide_set_columns'), setColumns: z.array(ColumnRefSchema).min(1).max(20), notation: CellNotationSchema }),
]);
export type Layout = z.infer<typeof LayoutSchema>;

/** What a set-type marker (`W`, `D`, `F`, `warmup`…) means. A coach's reading is a `Check` until Ben confirms it (AI3). */
export const MarkerMeaningSchema = z.enum(['warmup', 'working', 'drop', 'failure', 'not_a_set']);
export type MarkerMeaning = z.infer<typeof MarkerMeaningSchema>;

/** One sample row as the model read it: used only to test its own spec (check 7), then thrown away. */
export const SelfCheckRowSchema = z.strictObject({
  line: z.int().min(1),
  date: z.string().max(10),
  exercise: z.string().max(200),
  load: z.number().nullable(),
  reps: z.number().nullable(),
});
export type SelfCheckRow = z.infer<typeof SelfCheckRowSchema>;

export const UNSUPPORTED_REASONS = ['no_set_rows', 'layout_outside_vocabulary'] as const;

/**
 * The coach's parser plan for one table (§9.6.2). Strict: an unknown field
 * fails the parse. `selfCheck` must hold 3–5 rows unless the coach says the
 * file is `unsupported` (checked after the parse; strict mode can't).
 */
export const ImportMappingSpecV1Schema = z
  .strictObject({
    specVersion: z.literal(1),
    file: z.strictObject({ delimiter: TableDelimiterSchema, headerLine: z.int().min(1).max(1000), decimal: z.enum(['.', ',']) }),
    layout: LayoutSchema,
    workoutKey: z.array(ColumnRefSchema).max(4),
    date: z.strictObject({ column: ColumnRefSchema, format: DateFormatSchema }),
    exercise: ColumnRefSchema,
    load: z.strictObject({ column: ColumnRefSchema, unit: UnitEvidenceSchema }).nullable(),
    reps: ColumnRefSchema.nullable(),
    setType: z
      .strictObject({
        column: ColumnRefSchema,
        values: z.array(z.strictObject({ cell: z.string().max(40), meaning: MarkerMeaningSchema.nullable() })).max(20),
      })
      .nullable(),
    rpe: ColumnRefSchema.nullable(),
    notes: z.array(ColumnRefSchema).max(16),
    unmapped: z.array(ColumnRefSchema).max(64),
    selfCheck: z.array(SelfCheckRowSchema).max(5),
    unsupported: z.enum(UNSUPPORTED_REASONS).nullable(),
  })
  .refine((s) => s.unsupported !== null || s.selfCheck.length >= 3, { message: 'selfCheck needs 3 to 5 rows', path: ['selfCheck'] });
export type ImportMappingSpecV1 = z.infer<typeof ImportMappingSpecV1Schema>;

/** The text the request sends, byte for byte (§9.6.1; `JSON.stringify` of this is the user message). */
export const ImportSampleV1Schema = z.strictObject({
  kind: z.literal('gymsmarter_import_sample'),
  v: z.literal(1),
  delimiter: TableDelimiterSchema,
  sections: z.array(z.string().max(200)).max(8),
  header: z.array(z.string().max(200)).max(64),
  rows: z.array(z.strictObject({ line: z.int().min(1), cells: z.array(z.string().max(2000)).max(64) })).max(30),
});
export type ImportSampleV1 = z.infer<typeof ImportSampleV1Schema>;

/** The roles a column can take (the role sheet's fixed list, §9.2.5). Only `notes` may be held by several columns, and `one_set` in a wide layout. */
export const LayoutRoleSchema = z.enum([
  'date',
  'start_time',
  'workout',
  'exercise',
  'load',
  'unit',
  'reps',
  'sets_reps',
  'one_set',
  'all_sets',
  'set_type',
  'rpe',
  'notes',
  'not_imported',
]);
export type LayoutRole = z.infer<typeof LayoutRoleSchema>;

/** Ben's reading of an `x` cell (AI5): `3x8` = 3 sets of 8 or 8 sets of 3; `100x8` = 100 × 8 or 8 × 100. */
export const NotationAnswerSchema = z.enum(['sets_x_reps', 'reps_x_sets', 'load_x_reps', 'reps_x_load']);
export type NotationAnswer = z.infer<typeof NotationAnswerSchema>;

/** A column index as a record key (`"4"`). */
const ColumnKeySchema = z.string().regex(/^\d{1,2}$/);

/**
 * Ben's answers on Check the layout (§9.2.5). `null` = not answered (nothing
 * is ever pre-selected). Each changes stored values, so each is his alone.
 */
export const LayoutAnswersSchema = z.object({
  /** `What is this file?` A plan imports nothing (AI4). */
  recordKind: z.enum(['done', 'plan']).nullable(),
  /** `Weight unit`: asked when the file has no unit word; also Ben's `Not right?` over a header token. */
  unit: WeightUnitSchema.nullable(),
  /** `Dates like "03/04/2025"`. */
  dateOrder: z.enum(['day_first', 'month_first']).nullable(),
  /** Per column (index): how its `x` cells read. */
  notation: z.record(ColumnKeySchema, NotationAnswerSchema),
  /** Per marker cell as written in the set-type column: its meaning. */
  markers: z.record(z.string().max(40), MarkerMeaningSchema),
  /** Per column (index): the role Ben chose or confirmed with `Use this`. */
  roles: z.record(ColumnKeySchema, LayoutRoleSchema),
});
export type LayoutAnswers = z.infer<typeof LayoutAnswersSchema>;

export const EMPTY_LAYOUT_ANSWERS: LayoutAnswers = { recordKind: null, unit: null, dateOrder: null, notation: {}, markers: {}, roles: {} };

/** What identifies a file's layout (§9.6.4): exact header cells, delimiter and section markers. */
export const LayoutFingerprintSchema = z.object({
  delimiter: TableDelimiterSchema,
  header: z.array(z.string().max(200)).max(64),
  sections: z.array(z.string().max(200)).max(8),
});
export type LayoutFingerprint = z.infer<typeof LayoutFingerprintSchema>;

/** Values the layout has seen, so anything new is asked and never absorbed (AI12). */
export const LayoutSeenSchema = z.object({
  /** Marker cells seen in the set-type column. */
  markers: z.array(z.string().max(40)).max(40),
  /** Exercise name keys that had negative weights. */
  negativeNames: z.array(z.string().max(200)).max(2000),
});
export type LayoutSeen = z.infer<typeof LayoutSeenSchema>;

/**
 * A saved import layout (`import_profiles`, Your data, AI12). In use only
 * while one of its `uses` is an import still in effect; `Undo this import`
 * takes it back. A row that fails this schema is never used (check 57).
 */
export const ImportProfileSchema = RecordMetaSchema.extend({
  name: z.string().trim().min(1).max(80),
  kind: z.literal('table'),
  fingerprint: LayoutFingerprintSchema,
  spec: ImportMappingSpecV1Schema,
  answers: LayoutAnswersSchema,
  seen: LayoutSeenSchema,
  /** Import job IDs that used it, oldest first. */
  uses: z.array(IdSchema).max(200),
  provenance: z.object({
    proposedBy: z.literal('coach'),
    route: z.literal('chatgpt_plan'),
    model: z.string().max(120).nullable(),
    specHash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: ZonedTimestampSchema,
    confirmedAt: ZonedTimestampSchema,
  }),
  /** `Delete layout` (with Undo): hidden and never used while set. */
  deletedAt: ZonedTimestampSchema.nullable(),
});
export type ImportProfile = z.infer<typeof ImportProfileSchema>;

/** Why a layout request didn't give a layout (§9.3.3). */
export const LayoutRequestFailureSchema = z.enum(['timeout', 'no_layout_returned', 'interrupted', 'stopped', 'provider_error', 'unsupported']);
export type LayoutRequestFailure = z.infer<typeof LayoutRequestFailureSchema>;

/** Coach states that stop a request before or during it (§9.3.2). No state switches route (rule 7). */
export const ImportCoachUnavailableSchema = z.enum(['not_connected', 'offline', 'signed_out', 'limit', 'unavailable', 'model_unavailable', 'not_eligible']);
export type ImportCoachUnavailable = z.infer<typeof ImportCoachUnavailableSchema>;

/** A check reason from `validateImportSpec` (the fixed list, §9.5). Strings are file text or code's numbers, never model text. */
export const SpecCheckFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schema') }),
  z.object({ kind: z.literal('unknown_column'), header: z.string().max(200) }),
  z.object({ kind: z.literal('two_roles'), header: z.string().max(200) }),
  z.object({ kind: z.literal('unit_token'), token: z.string().max(10) }),
  z.object({ kind: z.literal('unit_column'), header: z.string().max(200) }),
  z.object({ kind: z.literal('marker'), token: z.string().max(40) }),
  z.object({ kind: z.literal('date'), cell: z.string().max(200), row: z.int() }),
  z.object({ kind: z.literal('self_check'), row: z.int() }),
  z.object({ kind: z.literal('dry_run'), percent: z.int().min(0).max(100) }),
  z.object({ kind: z.literal('target_column'), header: z.string().max(200) }),
]);
export type SpecCheckFailure = z.infer<typeof SpecCheckFailureSchema>;

/**
 * One layout request (`import_layout_requests`, Your data, §9.6.4): stored
 * under its operation ID, so a repeat returns the stored result and sends
 * nothing, and a spec that arrived before an interruption is reused.
 */
/** The longest sample text a request record keeps (`sampleJson`). */
export const IMPORT_SAMPLE_JSON_MAX = 500_000;

export const ImportLayoutRequestSchema = RecordMetaSchema.extend({
  operationId: OperationIdSchema,
  sampleHash: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * The whole file's checksum (the sample is only some rows): a spec is
   * reused only for the same file. Null on records made before it was kept:
   * never reused.
   */
  fileHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  instructionsHash: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * The exact text sent (§9.6.4; review r3 N4): the sample JSON, byte for
   * byte, so there is a record of what left the phone (Your data). Null on
   * records made before it was kept, or a sample over the cap.
   */
  sampleJson: z.string().max(IMPORT_SAMPLE_JSON_MAX).nullable().default(null),
  route: z.literal('chatgpt_plan'),
  model: z.string().max(120),
  chars: z.int().min(0),
  state: z.enum(['sent', 'proposed', 'rejected', 'failed', 'unavailable']),
  failure: LayoutRequestFailureSchema.nullable(),
  unavailable: ImportCoachUnavailableSchema.nullable(),
  /** The validated spec (proposed or rejected), never model text. */
  spec: ImportMappingSpecV1Schema.nullable(),
  reasons: z.array(SpecCheckFailureSchema).max(20),
  sentAt: ZonedTimestampSchema,
  finishedAt: ZonedTimestampSchema.nullable(),
  /**
   * Ben finished with this layout: `Use this layout`, `Cancel` or `Read with
   * the coach again`. A closed spec is never reused (only one that arrived
   * and was never acted on, §9.3.3), so an undone or cancelled layout never
   * comes back as the coach's suggestion.
   */
  closedAt: ZonedTimestampSchema.nullable().default(null),
});
export type ImportLayoutRequest = z.infer<typeof ImportLayoutRequestSchema>;

/** What a layout import job records about its layout (§9.6.4). */
export const ImportJobLayoutSchema = z.object({
  /** `coach`: read with the coach this time; `saved`: a saved layout, offline. */
  kind: z.enum(['coach', 'saved']),
  profileId: IdSchema.nullable(),
  profileName: z.string().max(80).nullable(),
  layoutVersion: z.int().min(1),
  specHash: z.string().regex(/^[0-9a-f]{64}$/),
  sampleHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  instructionsHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  route: z.literal('chatgpt_plan').nullable(),
  model: z.string().max(120).nullable(),
  requestsSent: z.int().min(0),
  charsSent: z.int().min(0),
  /** `Save layout` was on: the profile this commit saved or versioned. */
  savedProfileId: IdSchema.nullable(),
  unit: WeightUnitSchema.nullable(),
  unitSource: z.enum(['header', 'unit_column', 'answer']).nullable(),
});
export type ImportJobLayout = z.infer<typeof ImportJobLayoutSchema>;
