import { describe, expect, it } from 'vitest';

import {
  PROBE_CONTEXTUAL_STRINGS,
  RECOGNITION_FALLBACK_LOCALE,
  chooseRecognitionLocale,
  describeTranscript,
  summariseTranscript,
} from '../src/probe/speech-probe';

describe('speech probe', () => {
  it('biases recognition towards gym vocabulary, including both unit forms', () => {
    expect(PROBE_CONTEXTUAL_STRINGS).toEqual(expect.arrayContaining(['bench', 'kilos', 'kg', 'reps', 'RPE', 'one fifteen']));
  });

  it('reports heard terms and numbers verbatim without interpreting them', () => {
    expect(summariseTranscript('Bench 100 kilos for eight')).toEqual({
      heardTerms: ['bench', 'unit (kilos/kg): kilos'],
      missingTerms: [],
      numbers: ['100', 'eight'],
      mixedNumberForms: true,
    });
  });

  it('accepts "kg" as the unit, as the recogniser wrote it on build 7', () => {
    const s = summariseTranscript('Bench 100 kg for eight');
    expect(s.heardTerms).toEqual(['bench', 'unit (kilos/kg): kg']);
    expect(s.missingTerms).toEqual([]);
    expect(s.mixedNumberForms).toBe(true);
    const details = describeTranscript('Bench 100 kg for eight');
    expect(details).toContain('Numbers as heard: 100 eight (digits and words mixed)');
    expect(details.some((d) => d.startsWith('For parseSpokenSet') && d.includes('"kg"'))).toBe(true);
  });

  it('lists missing terms', () => {
    const s = summariseTranscript('bench one fifteen');
    expect(s.missingTerms).toEqual(['unit (kilos/kg)']);
    expect(s.numbers).toEqual(['one', 'fifteen']);
    expect(s.mixedNumberForms).toBe(false);
    expect(describeTranscript('bench one fifteen')).toContain('Missing: unit (kilos/kg)');
  });

  it('does not count a unit inside another word', () => {
    expect(summariseTranscript('bench 100 kgx').missingTerms).toEqual(['unit (kilos/kg)']);
  });
});

describe('chooseRecognitionLocale', () => {
  const SUPPORTED = ['en-US', 'en-GB', 'en-AU', 'fr-FR'];

  it("uses the device's locale (Ben: en-GB), not a hard-coded en-US", () => {
    expect(chooseRecognitionLocale(['en-GB'], SUPPORTED)).toEqual({ locale: 'en-GB', reason: 'device locale' });
  });

  it('takes the first supported preference, matching underscores and case', () => {
    expect(chooseRecognitionLocale(['cy-GB', 'en_au'], SUPPORTED)).toEqual({
      locale: 'en-AU',
      reason: 'device locale (preference: en_au)',
    });
  });

  it('falls back to en-GB when no device locale is supported', () => {
    const c = chooseRecognitionLocale(['cy-GB'], SUPPORTED);
    expect(c.locale).toBe(RECOGNITION_FALLBACK_LOCALE);
    expect(c.reason).toContain('device locales not supported (cy-GB)');
    expect(chooseRecognitionLocale([], SUPPORTED).locale).toBe('en-GB');
  });

  it('says so when even the fallback is not listed', () => {
    const c = chooseRecognitionLocale(['cy-GB'], ['fr-FR']);
    expect(c.locale).toBe('en-GB');
    expect(c.reason).toContain('nor the fallback');
  });

  it('uses the device locale as-is when the supported list is unavailable', () => {
    expect(chooseRecognitionLocale(['en-GB', 'en-US'], null)).toEqual({
      locale: 'en-GB',
      reason: 'device locale (the recogniser did not list its supported locales)',
    });
    expect(chooseRecognitionLocale([], null).locale).toBe('en-GB');
  });
});
