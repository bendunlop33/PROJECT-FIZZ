/**
 * Schema version 30 (written on branch `claude/b3-data-20oct`; renumber on
 * merge if another branch took 30 first): workout builder v3 data (Ben
 * approved 20 Oct; workout-builder-v3.md §4, §6.1, §6.2). Frozen once
 * released.
 *
 * - `routines_plan_day`: a unique expression index over a live template's
 *   `planDay` (planId, dayIndex, main lift), so "one template per key"
 *   holds inside every write transaction, whichever path writes it. No
 *   column: existing rows have no `planDay` (their key is derived when
 *   read, never written on read), so nothing to backfill and every routine
 *   path writes exactly as before. A plan day is (plan, day index), not its
 *   split day: a plan may use a split day twice (Push/Pull/Legs/Push), and
 *   each of those days has its own templates (review b3-data B1).
 * - `workout_drafts_open_builder`: likewise, one **open** builder draft per
 *   (owner, plan, day index, split day, main lift, local date), resumed on
 *   reopen.
 *   Coach drafts have no `builderKey` and stay outside it.
 * - `sessions.plan_day`: the plan day a workout was started as (Up next
 *   credits plan + day index). NULL on every existing workout (they fall
 *   back to `routine_id`).
 * - `plan_day_variations`: saved variations, keyed by split day and main
 *   lift, not by plan (Your data). Tombstoned, so Undo of a delete works.
 * - `reviews`: pre-session, session, post-session, weekly and block
 *   reviews (Your data), facts apart from coach text in the document; one
 *   `current` review per (owner, kind, subject).
 *
 * `coach_actions` isn't rebuilt here: the v3 coach tools (`fill_setup`,
 * `propose_workout_edit`, `review_workout`) add their kinds with the coach
 * slice, as migrations 25–28 did.
 */
export const MIGRATION_0030 = `
CREATE UNIQUE INDEX routines_plan_day ON routines (
  owner_id,
  json_extract(data, '$.planDay.planId'),
  json_extract(data, '$.planDay.dayIndex'),
  coalesce(json_extract(data, '$.planDay.mainLiftExerciseId'), '-')
) WHERE json_extract(data, '$.planDay') IS NOT NULL AND json_extract(data, '$.deletedAtUtc') IS NULL;

CREATE UNIQUE INDEX workout_drafts_open_builder ON workout_drafts (
  owner_id,
  coalesce(json_extract(data, '$.builderKey.planId'), '-'),
  coalesce(json_extract(data, '$.builderKey.dayIndex'), -1),
  coalesce(json_extract(data, '$.builderKey.splitDayId'), '-'),
  coalesce(json_extract(data, '$.builderKey.mainLiftExerciseId'), '-'),
  json_extract(data, '$.builderKey.localDate')
) WHERE status = 'open' AND json_extract(data, '$.builderKey') IS NOT NULL;

ALTER TABLE sessions ADD COLUMN plan_day TEXT CHECK (plan_day IS NULL OR json_valid(plan_day));

CREATE TABLE plan_day_variations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  split_day_id TEXT NOT NULL,
  main_lift_key TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE INDEX plan_day_variations_key ON plan_day_variations (owner_id, split_day_id, main_lift_key, deleted);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pre_session', 'session', 'post_session', 'weekly', 'block')),
  subject_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'superseded')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at_utc TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data))
) STRICT;
CREATE UNIQUE INDEX reviews_current ON reviews (owner_id, kind, subject_key) WHERE status = 'current';
CREATE INDEX reviews_owner_kind ON reviews (owner_id, kind, updated_at_utc);
`;
