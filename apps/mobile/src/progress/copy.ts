/**
 * Fixed sheet copy for Progress (progress.md §2.3, §2.4), kept here so the
 * check-23 test can read every word the sheets show.
 *
 * `How this is counted` is the one place the muscle method is explained. Its
 * last line in spec §2.4 ("This counts work done. It doesn't measure recovery
 * or fatigue.") is left out: check 23 and §0 forbid "recovery" and "fatigue"
 * on any Progress screen, and it is a reassurance line (minimal copy). Raised
 * with the designer (review progress-A SP1).
 */
export const HOW_COUNTED_LINES: readonly string[] = [
  'Sets are completed working sets rated RPE 6 or harder, or not rated. Warm-ups and easier sets aren’t counted.',
  'Body parts: a set counts 1 for the muscles an exercise mainly works and ½ for helpers. Bench press: 1 chest, ½ shoulders, ½ triceps.',
  'Push/Pull/Legs: each exercise belongs to one group, and each set counts 1 there.',
  'Sessions are workouts with at least 1 counted set for that group.',
  'Sets you marked spotted, painful or with form breaking still count here, because you did the work.',
];

export const TIME_SHEET_COPY = {
  title: 'Time in gym',
  overCap: 'OVER 4 H',
  noEnd: 'NO END TIME',
  imported: 'NO TIMES',
  footer: 'Time is start to finish, minus pauses, the same as each workout’s summary.',
  countIt: 'Count it',
  editTimes: 'Edit times',
} as const;
