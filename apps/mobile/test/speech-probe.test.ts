import { describe, expect, it } from 'vitest';

import { PROBE_CONTEXTUAL_STRINGS, describeTranscript, summariseTranscript } from '../src/probe/speech-probe';

describe('speech probe', () => {
  it('biases recognition towards gym vocabulary', () => {
    expect(PROBE_CONTEXTUAL_STRINGS).toEqual(expect.arrayContaining(['bench', 'kilos', 'RPE', 'one fifteen']));
  });

  it('reports heard terms and numbers verbatim without interpreting them', () => {
    expect(summariseTranscript('Bench 100 kilos for eight')).toEqual({
      heardTerms: ['bench', 'kilos'],
      missingTerms: [],
      numbers: ['100', 'eight'],
    });
  });

  it('lists missing terms', () => {
    const s = summariseTranscript('bench one fifteen');
    expect(s.missingTerms).toEqual(['kilos']);
    expect(s.numbers).toEqual(['one', 'fifteen']);
    expect(describeTranscript('bench one fifteen')).toContain('Missing: kilos');
  });
});
