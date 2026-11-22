/**
 * Speech-recognition probe helpers (pure). The probe reports what was heard;
 * it does not parse loads. A deterministic parseSpokenSet belongs in
 * packages/domain (brief v0.2) and does not exist yet.
 *
 * Build 7 (iOS 26.6.1, en-US) heard "Bench 100 kg for eight": the recogniser
 * writes the unit as "kg", not "kilos", and mixes digits ("100") with number
 * words ("eight") in one utterance. parseSpokenSet must accept both forms.
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

/**
 * Used when none of the device's preferred locales is supported by the
 * recogniser. Ben is in the UK.
 */
export const RECOGNITION_FALLBACK_LOCALE = 'en-GB';

export interface LocaleChoice {
  locale: string;
  reason: string;
}

function normaliseTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

/**
 * Picks the recognition locale: the first of the device's preferred locales
 * (expo-localization, in order) that the recogniser supports, else en-GB.
 * `supported` is null when the recogniser couldn't list its locales.
 */
export function chooseRecognitionLocale(deviceTags: readonly string[], supported: readonly string[] | null): LocaleChoice {
  if (supported === null) {
    const first = deviceTags[0];
    return first === undefined
      ? { locale: RECOGNITION_FALLBACK_LOCALE, reason: 'no device locale and no supported-locale list; using the fallback' }
      : { locale: first, reason: 'device locale (the recogniser did not list its supported locales)' };
  }
  const byNormalised = new Map(supported.map((s) => [normaliseTag(s), s]));
  for (const tag of deviceTags) {
    const match = byNormalised.get(normaliseTag(tag));
    if (match !== undefined) {
      return { locale: match, reason: tag === deviceTags[0] ? 'device locale' : `device locale (preference: ${tag})` };
    }
  }
  const fallback = byNormalised.get(normaliseTag(RECOGNITION_FALLBACK_LOCALE));
  const tried = deviceTags.length === 0 ? 'none' : deviceTags.join(', ');
  return fallback !== undefined
    ? { locale: fallback, reason: `device locales not supported (${tried}); using the fallback` }
    : {
        locale: RECOGNITION_FALLBACK_LOCALE,
        reason: `neither the device locales (${tried}) nor the fallback are in the supported list; the recogniser will say if it can't`,
      };
}

/** Terms Ben is asked to say; any alternative counts (the recogniser writes "kg"). */
export const PROBE_EXPECTED_TERMS: readonly { label: string; alternatives: readonly string[] }[] = [
  { label: 'bench', alternatives: ['bench'] },
  { label: 'unit (kilos/kg)', alternatives: ['kilos', 'kilo', 'kilograms', 'kg', 'kgs'] },
];

export interface TranscriptSummary {
  /** Labels of expected terms that were heard, with the form heard, e.g. "unit (kilos/kg): kg". */
  heardTerms: string[];
  missingTerms: string[];
  /** Digit groups and number words found, verbatim. Not interpreted. */
  numbers: string[];
  /** True when one utterance contains both digits and number words. */
  mixedNumberForms: boolean;
}

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point)\b/gi;

export function summariseTranscript(transcript: string): TranscriptSummary {
  const lower = transcript.toLowerCase();
  const heardTerms: string[] = [];
  const missingTerms: string[] = [];
  for (const term of PROBE_EXPECTED_TERMS) {
    const form = term.alternatives.find((a) => new RegExp(`\\b${a}\\b`, 'i').test(lower));
    if (form === undefined) missingTerms.push(term.label);
    else heardTerms.push(term.label === form ? form : `${term.label}: ${form}`);
  }
  const digits = lower.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const words = lower.match(NUMBER_WORDS) ?? [];
  return { heardTerms, missingTerms, numbers: [...digits, ...words], mixedNumberForms: digits.length > 0 && words.length > 0 };
}

export function describeTranscript(transcript: string): string[] {
  const s = summariseTranscript(transcript);
  return [
    `Transcript: "${transcript}"`,
    `Heard: ${s.heardTerms.length > 0 ? s.heardTerms.join(', ') : 'none of the expected terms'}`,
    ...(s.missingTerms.length > 0 ? [`Missing: ${s.missingTerms.join(', ')}`] : []),
    `Numbers as heard: ${s.numbers.length > 0 ? s.numbers.join(' ') : 'none'}${s.mixedNumberForms ? ' (digits and words mixed)' : ''}`,
    'For parseSpokenSet (not built yet): the recogniser writes "kg" rather than "kilos" and mixes digits with number words, so the parser must accept both',
    'Ran with requiresOnDeviceRecognition: true (repeat in flight mode to confirm it is really on-device)',
  ];
}
