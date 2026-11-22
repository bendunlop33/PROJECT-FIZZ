/**
 * Schema version 33 (22 Oct 2026, Ben: the Workout overview is retired; every
 * pre-start page is the builder's Your workout). Frozen once released.
 *
 * - `workout_drafts_open_builder` is rebuilt with the draft key's `from`
 *   (`builderKey.from.kind`, `builderKey.from.id`): a library workout, a past
 *   workout done again or a coach chat draft opened on Your workout has its
 *   own open draft per local date, resumed on reopen, apart from Set up's.
 *   Every existing builder draft has no `from` (`-`), so its key is unchanged
 *   and nothing is backfilled.
 */
export const MIGRATION_0033 = `
DROP INDEX IF EXISTS workout_drafts_open_builder;

CREATE UNIQUE INDEX workout_drafts_open_builder ON workout_drafts (
  owner_id,
  coalesce(json_extract(data, '$.builderKey.planId'), '-'),
  coalesce(json_extract(data, '$.builderKey.dayIndex'), -1),
  coalesce(json_extract(data, '$.builderKey.splitDayId'), '-'),
  coalesce(json_extract(data, '$.builderKey.mainLiftExerciseId'), '-'),
  json_extract(data, '$.builderKey.localDate'),
  coalesce(json_extract(data, '$.builderKey.from.kind'), '-'),
  coalesce(json_extract(data, '$.builderKey.from.id'), '-')
) WHERE status = 'open' AND json_extract(data, '$.builderKey') IS NOT NULL;
`;
