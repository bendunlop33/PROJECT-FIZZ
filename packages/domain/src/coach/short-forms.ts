/**
 * Gym short forms Ben and the coach use for whole exercise names (review r2
 * N2, r3 S1). Shared by the pain-flag choices and the Summary note so "rdl"
 * means Romanian deadlift everywhere. Keys and values are lower case, words
 * separated by single spaces.
 */
export const EXERCISE_SHORT_FORMS: ReadonlyMap<string, string> = new Map([
  ['rdl', 'romanian deadlift'],
  ['rdls', 'romanian deadlift'],
  ['ohp', 'overhead press'],
  ['cgbp', 'close grip bench press'],
  ['sldl', 'stiff leg deadlift'],
  ['sldls', 'stiff leg deadlift'],
]);

/** True when `shortForm` stands for (part of) the exercise name, e.g. `rdl` for "Romanian deadlift". */
export function shortFormMeans(shortForm: string, exerciseName: string): boolean {
  const full = EXERCISE_SHORT_FORMS.get(shortForm);
  if (full === undefined) return false;
  const name = ` ${exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return name.includes(` ${full} `);
}
