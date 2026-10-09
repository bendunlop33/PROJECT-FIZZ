import { describe, expect, it } from 'vitest';
import type { AliasTarget } from '@fizz/schemas';
import { equipmentInName, implementCue, implementsFor, matchName, nameKey, nameTokens, searchCandidates, type MatchCandidate } from '../src';
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

/** A candidate for these tests, from the shared fixture's first entry. */
const candidate = (over: Partial<MatchCandidate> & Pick<MatchCandidate, 'exerciseId' | 'name'>): MatchCandidate => ({ ...(CANDIDATES[0] as MatchCandidate), aliases: [], ...over });

describe('equipment words in a name (review r4 S3)', () => {
  it('reads the equipment a name names, and nothing from a name that names none', () => {
    const kinds = (name: string) => [...(equipmentInName(name) ?? [])].sort();
    expect(kinds('Flat Dumbbell Bench Press')).toEqual(['dumbbells']);
    expect(kinds('Single Arm DB Row')).toEqual(['dumbbells']);
    expect(kinds('Flat Barbell Bench Press')).toEqual(['barbell']);
    expect(kinds('EZ-Bar Skullcrusher')).toEqual(['ez_bar']);
    expect(kinds('Hex Bar Deadlift')).toEqual(['trap_bar']);
    expect(kinds('KB Swing')).toEqual(['kettlebell']);
    expect(kinds('Lat Pulldown (Pulley)')).toEqual(['weight_stack']);
    expect(kinds('Smith Machine Squat')).toEqual(['assisted_stack', 'plate_loaded_machine', 'weight_stack']);
    expect(kinds('Hammer Strength Row')).toEqual(['plate_loaded_machine', 'weight_stack']);
    expect(equipmentInName('Hammer Curl')).toBeNull();
    expect(equipmentInName('Flat Bench Press')).toBeNull();
  });

  it('never suggests an exercise whose equipment contradicts the name (FitNotes default names)', () => {
    // `Flat bench press` (a barbell name) and `Dumbbell bench press` tie on words: the barbell one is never suggested.
    expect(matchName('Flat Dumbbell Bench Press', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Dumbbell bench press'), via: 'words' });
    // The EZ-bar skull crusher (`Lying triceps extension`) is never a dumbbell exercise's suggestion.
    expect(matchName('Dumbbell Skullcrusher', CANDIDATES, none)).toEqual({ status: 'no_match', exerciseId: null, via: null, skip: false });
    expect(matchName('Lying Dumbbell Triceps Extension', CANDIDATES, none).exerciseId).not.toBe(idOf('EZ-bar skull crusher'));
    // A machine raise isn't the dumbbell lateral raise.
    expect(matchName('Lateral Machine Raise', CANDIDATES, none)).toMatchObject({ status: 'no_match' });
    // Names that agree, or name no equipment, are suggested as before.
    expect(matchName('Lateral Dumbbell Raise', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('Lateral raise') });
    expect(matchName('Skullcrusher', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: idOf('EZ-bar skull crusher') });
  });

  it('a tie is broken on equipment, never by name order; a tie equipment can’t break suggests nothing', () => {
    // `Bench press (custom)` has no equipment recorded and sorts first; the name says dumbbell, so the dumbbell exercise wins.
    const custom = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000c1', name: 'A flat bench press', aliases: ['Flat bench press'], catalogueKey: null, compatibleEquipment: [], defaultLoadConvention: 'total', implements: null });
    expect(matchName('Flat Dumbbell Bench Press', [custom, ...CANDIDATES], none)).toMatchObject({ status: 'check', exerciseId: idOf('Dumbbell bench press') });
    // `Shoulder Press` names no equipment: the dumbbell and machine presses tie, so nothing is suggested (it was the first by name).
    const machine = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000c2', name: 'Machine shoulder press', compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null });
    expect(matchName('Shoulder Press', [...CANDIDATES, machine], none)).toMatchObject({ status: 'no_match', exerciseId: null });
    expect(matchName('Dumbbell Shoulder Press', [...CANDIDATES, machine], none)).toMatchObject({ status: 'matched', exerciseId: idOf('Dumbbell shoulder press') });
    expect(matchName('Seated Machine Shoulder Press', [...CANDIDATES, machine], none)).toMatchObject({ status: 'check', exerciseId: machine.exerciseId });
    // The same name on two exercises: equipment decides; when it can't, nothing is suggested.
    const dbRow = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000c3', name: 'Row', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: 2 });
    const bbRow = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000c4', name: 'Row', compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', implements: null });
    expect(matchName('Row', [bbRow, dbRow], none)).toMatchObject({ status: 'no_match', exerciseId: null });
  });
});

describe('one dumbbell or two, from the name (review r4 S1)', () => {
  it('reads words that say one implement or two', () => {
    for (const n of ['One-Arm Standing Dumbbell Press', 'Dumbbell Concentration Curl', 'Single Arm DB Row', '1-arm DB row', 'One Hand Dumbbell Snatch', 'Unilateral DB Press', 'Goblet Squats', 'Single-Leg RDL', 'Suitcase Carry']) expect(implementCue(n), n).toBe(1);
    for (const n of ['Two-Arm Dumbbell Row', 'Alternating Dumbbell Curl', 'Alt DB Curl', 'Double Kettlebell Press', '2 DB Lunge']) expect(implementCue(n), n).toBe(2);
    // One dumbbell can be held in both hands: `Two-hand` says nothing about the count.
    for (const n of ['Two-hand overhead dumbbell extension', 'Dumbbell Bench Press', 'Seated Dumbbell Press', 'Dumbbell Side Bend']) expect(implementCue(n), n).toBeNull();
    expect(implementCue('Single-Arm Alternating Press')).toBe('unclear');
  });

  it('a one-arm or concentration name never takes a two-dumbbell exercise’s count, however it was mapped', () => {
    const standing = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000d1', name: 'Standing dumbbell shoulder press', aliases: ['Standing dumbbell press'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: 2 });
    const curl = CANDIDATES.find((c) => c.name === 'Dumbbell curl') as MatchCandidate;
    expect(implementsFor('One-Arm Standing Dumbbell Press', standing)).toBeNull();
    expect(implementsFor('Dumbbell Concentration Curl', curl)).toBeNull();
    expect(implementsFor('Standing Dumbbell Press', standing)).toBe(2);
    expect(implementsFor('Alternating Dumbbell Curl', curl)).toBe(2);
    // A name that says nothing reads a pair as a pair (shown with its conversion before commit).
    expect(implementsFor('Dumbbell Preacher Curl', curl)).toBe(2);
  });

  it('one dumbbell only when the name says so, or is the catalogue’s own name for it', () => {
    const row = CANDIDATES.find((c) => c.name === 'One-arm dumbbell row') as MatchCandidate;
    const rowWithAlias = { ...row, aliases: ['Dumbbell row', 'DB row'] };
    const goblet = CANDIDATES.find((c) => c.name === 'Goblet squat') as MatchCandidate;
    const pullover = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000d2', name: 'Dumbbell pullover', aliases: ['DB pullover'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: 1 });
    expect(implementsFor('One Arm Dumbbell Row', row)).toBe(1);
    expect(implementsFor('Single Arm DB Row', row)).toBe(1);
    // `Dumbbell Row` is a name of the one-arm row, but it doesn't say one arm: some row with a pair.
    expect(implementsFor('Dumbbell Row', rowWithAlias)).toBeNull();
    expect(implementsFor('Two-Arm Dumbbell Row', row)).toBeNull();
    // Suggested as the goblet squat by its words only: asked.
    expect(implementsFor('Dumbbell Squat', goblet)).toBeNull();
    expect(implementsFor('Goblet Squats', goblet)).toBe(1);
    // The catalogue's own name, whose "one" isn't from a word: one dumbbell.
    expect(implementsFor('Dumbbell Pullover', pullover)).toBe(1);
    expect(implementsFor('DB Pullover', pullover)).toBe(1);
    expect(implementsFor('DB Pull Over', pullover)).toBeNull();
    // Nothing recorded: asked, whatever the name says.
    const zottman = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000d3', name: 'Zottman curl', catalogueKey: null, compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: null });
    expect(implementsFor('One-Arm Zottman Curl', zottman)).toBeNull();
  });
});
