/**
 * Speech-recognition probe helpers (pure). The probe reports what was heard;
 * it does not parse loads. A deterministic parseSpokenSet belongs in
 * packages/domain (brief v0.2) and does not exist yet.
 */

/** Biasing vocabulary passed as `contextualStrings` (iOS). */
export const PROBE_CONTEXTUAL_STRINGS: readonly string[] = [
  'bench',
  'bench press',
  'squat',
  'deadlift',
  'kilos',
  'kg',
  'pounds',
  'reps',
  'RPE',
  'one hundred',
  'one fifteen',
  'a hundred and five',
  'point five',
];

export const PROBE_EXPECTED_TERMS: readonly string[] = ['bench', 'kilos'];

export interface TranscriptSummary {
  heardTerms: string[];
  missingTerms: string[];
  /** Digit groups and number words found, verbatim. Not interpreted. */
  numbers: string[];
}

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|point)\b/gi;

export function summariseTranscript(transcript: string): TranscriptSummary {
  const lower = transcript.toLowerCase();
  const heardTerms = PROBE_EXPECTED_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(lower));
  const missingTerms = PROBE_EXPECTED_TERMS.filter((t) => !heardTerms.includes(t));
  const digits = lower.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const words = lower.match(NUMBER_WORDS) ?? [];
  return { heardTerms, missingTerms, numbers: [...digits, ...words] };
}

export function describeTranscript(transcript: string): string[] {
  const s = summariseTranscript(transcript);
  return [
    `Transcript: "${transcript}"`,
    `Heard: ${s.heardTerms.length > 0 ? s.heardTerms.join(', ') : 'none of the expected terms'}`,
    ...(s.missingTerms.length > 0 ? [`Missing: ${s.missingTerms.join(', ')}`] : []),
    `Numbers as heard: ${s.numbers.length > 0 ? s.numbers.join(' ') : 'none'}`,
    'Ran with requiresOnDeviceRecognition: true (repeat in flight mode to confirm it is really on-device)',
  ];
}
