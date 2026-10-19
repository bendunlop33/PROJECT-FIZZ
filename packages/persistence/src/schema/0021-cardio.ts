/**
 * Schema version 21: cardio sets (Ben, 19 Oct: "rowing machine or bike …
 * with a timer and distance"). Frozen once released. If another branch
 * takes number 20 first, this one is renumbered on merge (its SQL is
 * independent of theirs).
 *
 * - `session_exercises.measures_cardio`: 1 on a cardio exercise (a time and
 *   a distance per set). The `measurement` column's CHECK predates cardio
 *   and SQLite can't alter it (a rebuild would also drop migration 8's
 *   triggers), so, as migration 10 did for distance, a cardio row stores
 *   `measurement = 'duration'` with this flag set; the reader maps the pair
 *   back to `cardio`. Sets already store both numbers
 *   (`actual_duration_s`, `actual_distance_m`); drafts and targets carry
 *   them inside their JSON.
 * - The four catalogue machines that were `distance` (rowing machine, ski
 *   erg, treadmill run) or `duration` (air bike) become `cardio`, in
 *   history too, so one exercise keeps one history and one series. No set's
 *   values change: a distance set reads as `— · 2,000 m`, a timed one as
 *   `10:00`. Matched by catalogue ID (UUIDv5 of the key, written out here so
 *   this migration never changes) and only from those two measurements.
 * - Their saved exercise rows (Coaching knowledge, saved when Ben first
 *   added one) follow the catalogue, with the version bumped in the column
 *   and the document alike.
 *
 * rowing-erg 33ae601d-be6e-54ec-b93d-c2e37bd5677f, ski-erg
 * 1230c5d3-261c-5a3a-ad76-98c3802ee1c5, treadmill-run
 * 6bee590c-12d1-5961-b4b1-ab2d8c63b73f, air-bike
 * 34a700ae-ecb1-5c7d-ae66-e90ca73c7215.
 */
const CARDIO_IDS = `('33ae601d-be6e-54ec-b93d-c2e37bd5677f', '1230c5d3-261c-5a3a-ad76-98c3802ee1c5', '6bee590c-12d1-5961-b4b1-ab2d8c63b73f', '34a700ae-ecb1-5c7d-ae66-e90ca73c7215')`;

export const MIGRATION_0021 = `
ALTER TABLE session_exercises ADD COLUMN measures_cardio INTEGER CHECK (measures_cardio IS NULL OR (measures_cardio = 1 AND measurement = 'duration' AND measures_distance IS NULL));
UPDATE session_exercises SET measurement = 'duration', measures_distance = NULL, measures_cardio = 1
  WHERE exercise_id IN ${CARDIO_IDS} AND (measures_distance = 1 OR measurement = 'duration');
UPDATE exercises SET version = version + 1, data = json_set(data, '$.measurement', 'cardio', '$.version', version + 1)
  WHERE owner_id IS NULL AND id IN ${CARDIO_IDS} AND json_extract(data, '$.measurement') IN ('distance', 'duration');
`;
