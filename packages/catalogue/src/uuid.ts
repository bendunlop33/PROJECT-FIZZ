/**
 * Catalogue IDs live in `@fizz/domain` (`catalogue-id.ts`) so the app's
 * starter exercise list and the catalogue share one scheme (ADR 0010
 * amendment, ADR 0011): `Exercise.id = UUIDv5(key, FIZZ_CATALOGUE_NAMESPACE)`.
 */
export { catalogueExerciseId, FIZZ_CATALOGUE_NAMESPACE, sha1, uuidV5 } from '@fizz/domain';
