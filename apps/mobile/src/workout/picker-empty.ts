/**
 * What the exercise picker says when it has no rows (review S4): loading,
 * couldn't load, nothing saved, or no match. Never stuck on "Loading".
 */
export type PickerLoad = 'loading' | 'ready' | 'failed';

export function pickerEmptyText(load: PickerLoad, query: string): string {
  const q = query.trim();
  if (load === 'loading') return 'Loading exercises…';
  if (load === 'failed') return 'Couldn’t load exercises. Go back and try again.';
  if (q === '') return 'No exercises yet.';
  return `No exercise matches “${q}”. Try a shorter word, like “press” or “row”.`;
}
