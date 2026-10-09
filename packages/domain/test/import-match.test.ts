import { describe, expect, it } from 'vitest';
import type { AliasTarget } from '@fizz/schemas';
import { matchName, nameKey, nameTokens, searchCandidates, type MatchCandidate } from '../src';
import { CANDIDATES, idOf } from './import-fixtures';

/** Exercise name matching (data-import-export §2.5 step 3a). */
const none = new Map<string, AliasTarget>();

describe('name matching', () => {
  it('Matched: equal to a name or a catalogue name, ignoring case and spacing', () => {
    expect(matchName('dumbbell  CURL ', CANDIDATES, none)).toEqual({ status: 'matched', exerciseId: idOf('Dumbbell curl'), via: 'name', skip: false });
    expect(matchName('Flat Bench Press', CANDIDATES, none)).toMatchObject({ status: 'matched', exerciseId: idOf('Bench press') });
    expect(matchName('Romanian Deadlift', CANDIDATES, none)).toMatchObject({ status: 'matched', exerciseId: idOf('Romanian deadlift') });
  });

  it('Check: a suggestion from the words only, never auto-applied', () => {
    expect(matchName('Incline DB Press', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Incline dumbbell press'), via: 'words' });
    expect(matchName('Flat Barbell Bench Press', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Bench press') });
    expect(matchName('Lat Pulldown (Pulley)', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Lat pulldown') });
    expect(matchName('Seated Cable Row (Pulley)', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Seated cable row') });
    expect(matchName('Lateral Dumbbell Raise', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Lateral raise') });
    expect(matchName('Rope Push Down', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Triceps pushdown') });
    expect(matchName('Skullcrusher', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('EZ-bar skull crusher') });
    expect(matchName('Pull Up', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Pull-up') });
  });

  it('No match when too few words are shared', () => {
    expect(matchName('Hammer Strength Row', CANDIDATES, none)).toEqual({ status: 'no_match', exerciseId: null, via: null, skip: false });
    expect(matchName('Zercher carry', CANDIDATES, none)).toMatchObject({ status: 'no_match' });
  });

  it('a name shared by two exercises is a Check, not a Match', () => {
    const twins: MatchCandidate[] = [
      { ...CANDIDATES[0], exerciseId: '00000000-0000-4000-8000-0000000000a1', name: 'Row', aliases: [] } as MatchCandidate,
      { ...CANDIDATES[0], exerciseId: '00000000-0000-4000-8000-0000000000a2', name: 'Cable row', aliases: ['Row'] } as MatchCandidate,
    ];
    expect(matchName('row', twins, none)).toMatchObject({ status: 'check', exerciseId: '00000000-0000-4000-8000-0000000000a1' });
  });

  it('a saved alias (an earlier answer) wins, including Skip; a stale alias falls back to matching', () => {
    const saved = new Map<string, AliasTarget>([
      [nameKey('Hammer Strength Row'), { kind: 'exercise', exerciseId: idOf('Seated cable row') }],
      [nameKey('Zumba'), { kind: 'skip' }],
      [nameKey('Dumbbell Curl'), { kind: 'exercise', exerciseId: '00000000-0000-4000-8000-00000000dead' }],
    ]);
    expect(matchName('hammer strength row', CANDIDATES, saved)).toEqual({ status: 'matched', exerciseId: idOf('Seated cable row'), via: 'alias', skip: false });
    expect(matchName('Zumba', CANDIDATES, saved)).toEqual({ status: 'matched', exerciseId: null, via: 'alias', skip: true });
    expect(matchName('Dumbbell Curl', CANDIDATES, saved)).toMatchObject({ status: 'matched', via: 'name', exerciseId: idOf('Dumbbell curl') });
  });

  it('normalises words: abbreviations, joined words, plurals', () => {
    expect(nameTokens('DB Bicep Curls')).toEqual(['dumbbell', 'bicep', 'curl']);
    expect(nameTokens('Pull-up (assisted)')).toEqual(['pullup', 'assisted']);
    expect(nameTokens('OHP')).toEqual(['overhead', 'press']);
    expect(nameKey('  Flat   Bench\tPress ')).toBe('flat bench press');
  });

  it('two long names that start alike never share a key, and keys fit the 200-character limit (review N7)', () => {
    const start = 'Very long exercise name '.repeat(10);
    const a = nameKey(`${start} variant A`);
    const b = nameKey(`${start} variant B`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(200);
    expect(b.length).toBeLessThanOrEqual(200);
    expect(nameKey(`${start} variant A`)).toBe(a);
    expect(nameKey('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('Choose… search looks at names and other names', () => {
    expect(searchCandidates(CANDIDATES, 'skull').map((c) => c.name)).toEqual(['EZ-bar skull crusher']);
    expect(searchCandidates(CANDIDATES, 'flat ben').map((c) => c.name)).toEqual(['Bench press']);
  });
});
