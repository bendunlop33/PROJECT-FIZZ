import { describe, expect, it } from 'vitest';
import type { AliasTarget } from '@fizz/schemas';
import { barNamed, equipmentContradicts, equipmentInName, implementCue, implementsFor, matchName, nameKey, namesExercise, nameTokens, searchCandidates, type MatchCandidate } from '../src';
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
    // A Smith machine is its own kind: its `Machine` isn't a weight stack (review r5 S3).
    expect(kinds('Smith Machine Squat')).toEqual(['smith']);
    expect(kinds('Smith Squat')).toEqual(['smith']);
    expect(kinds('Hammer Strength Row')).toEqual(['plate_loaded_machine', 'weight_stack']);
    // `Machine` is a stack or plate-loaded machine, never an assisted one; only an assist word names that.
    expect(kinds('Triceps Dip Machine')).toEqual(['plate_loaded_machine', 'weight_stack']);
    expect(kinds('Assisted Dip Machine')).toEqual(['assisted_stack', 'plate_loaded_machine', 'weight_stack']);
    expect(kinds('Gravitron Pull Up')).toEqual(['assisted_stack']);
    expect(kinds('Band Assisted Pull Up')).toEqual(['assisted_stack', 'band']);
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

describe('machines, assisted machines and the Smith machine (review r5 S3)', () => {
  const assistedDip = { ...(CANDIDATES.find((c) => c.name === 'Assisted dip') as MatchCandidate), aliases: ['Assisted dip machine', 'Gravitron dip'] };
  const machineDip = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e2', name: 'Seated dip machine', aliases: [], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null });
  const machinePress = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e3', name: 'Machine shoulder press', aliases: [], compatibleEquipment: ['weight_stack', 'plate_loaded_machine'], defaultLoadConvention: 'stack', implements: null });
  const smithBench = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e4', name: 'Smith machine bench press', aliases: ['Smith bench press'], compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', implements: null });
  const list = [...CANDIDATES.filter((c) => c.exerciseId !== assistedDip.exerciseId), assistedDip, machinePress, smithBench];

  it('never suggests an assisted machine unless the name says so: a stack number is never read as assistance', () => {
    for (const n of ['Triceps Dip Machine', 'Dip Machine', 'Machine Dip', 'Dips', 'Weighted Dip']) expect(matchName(n, list, none).exerciseId, n).not.toBe(assistedDip.exerciseId);
    // Even when it is the only dip: a name with no equipment word gets no suggestion rather than the assisted one.
    const noDip = list.filter((c) => c.name !== 'Dip');
    for (const n of ['Dips', 'Triceps Dip', 'Weighted Dip']) expect(matchName(n, noDip, none), n).toMatchObject({ status: 'no_match' });
    // A seated dip machine in the list is the suggestion instead.
    expect(matchName('Triceps Dip Machine', [...list, machineDip], none)).toMatchObject({ status: 'check', exerciseId: machineDip.exerciseId });
    // Names that say assisted, or are its own names, still reach it.
    expect(matchName('Assisted Dips', list, none)).toMatchObject({ status: 'check', exerciseId: assistedDip.exerciseId });
    expect(matchName('Gravitron Dip', list, none)).toMatchObject({ status: 'matched', exerciseId: assistedDip.exerciseId });
  });

  it('a Smith machine name is only ever a Smith machine exercise; a Smith exercise is never a plain machine', () => {
    // FitNotes' default `Smith Machine Overhead Press`: not the stack shoulder press, nor the Smith bench press for sharing the words `Smith Machine`; no Smith press exists, so nothing.
    expect(matchName('Smith Machine Overhead Press', list, none)).toMatchObject({ status: 'no_match', exerciseId: null });
    expect(matchName('Smith Machine Row', list, none)).toMatchObject({ status: 'no_match' });
    expect(matchName('Smith Machine Close Grip Bench Press', list, none)).toMatchObject({ status: 'check', exerciseId: smithBench.exerciseId });
    expect(equipmentContradicts('Smith Machine Overhead Press', machinePress)).toBe(true);
    expect(equipmentContradicts('Smith Machine Bench', smithBench)).toBe(false);
    // `Machine Bench Press` names a machine, not a Smith machine.
    expect(equipmentContradicts('Machine Bench Press', smithBench)).toBe(true);
    expect(matchName('Machine Bench Press', list, none).exerciseId).not.toBe(smithBench.exerciseId);
    // A name that doesn't say Smith is never suggested as a Smith exercise; its own names still match.
    const smithSquat = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e5', name: 'Smith machine squat', aliases: ['Smith squat'], compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', implements: null });
    expect(matchName('Squats', [...list, smithSquat], none)).toMatchObject({ status: 'check', exerciseId: idOf('Back squat') });
    expect(matchName('Bench Presses', [...list, smithSquat], none).exerciseId).toBe(idOf('Bench press'));
    expect(matchName('Smith Squat', [...list, smithSquat], none)).toMatchObject({ status: 'matched', exerciseId: smithSquat.exerciseId });
    expect(matchName('Smith Machine Squats', [...list, smithSquat], none)).toMatchObject({ status: 'check', exerciseId: smithSquat.exerciseId });
  });

  it('a Smith name that also says Barbell is never a free-barbell exercise, and never gets the Olympic bar from its word (review r6 B2)', () => {
    const smithSquat = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e5', name: 'Smith machine squat', aliases: ['Smith squat'], compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', implements: null });
    const withSmith = [...list, smithSquat];
    const free = new Set(['Back squat', 'Bench press', 'Incline bench press', 'Barbell row', 'Deadlift'].map(idOf));
    // The review's names: a Smith exercise or nothing, never a free-barbell one.
    const names = [
      'Smith Machine Barbell Squat',
      'Barbell Smith Squat',
      'Barbell Squat (Smith)',
      'Smith Machine Squat (Barbell)',
      'BB Smith Squat',
      'Smith Barbell Bench Press',
      'Smith Machine Bench Press (Barbell)',
      'Barbell Bench Press (Smith Machine)',
      'Smith Machine Incline Barbell Press',
      'Smith Machine Barbell Row',
      'Smith Barbell Row',
      'Smith Machine Deadlift (Barbell)',
    ];
    for (const n of names) {
      const m = matchName(n, withSmith, none);
      expect(m.exerciseId === null || !free.has(m.exerciseId), `${n} → ${String(m.exerciseId)}`).toBe(true);
    }
    expect(matchName('Smith Machine Barbell Squat', withSmith, none)).toMatchObject({ status: 'check', exerciseId: smithSquat.exerciseId });
    expect(matchName('Smith Barbell Bench Press', withSmith, none)).toMatchObject({ status: 'check', exerciseId: smithBench.exerciseId });
    expect(matchName('Smith Machine Barbell Row', withSmith, none)).toMatchObject({ status: 'no_match', exerciseId: null });
    // Chosen by Ben as the free back squat (`Choose…`), the bar still isn't known from the name: asked on its own.
    const backSquat = CANDIDATES.find((c) => c.name === 'Back squat') as MatchCandidate;
    for (const n of names) expect(barNamed(n, backSquat, 'barbell'), n).toBe(false);
    expect(barNamed('Barbell Squat', backSquat, 'barbell')).toBe(true);
    // The same other name on a Smith and a free exercise: a Smith name goes to the Smith one, never the free one (equipment alone can't tell them apart here).
    const freeTwin = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e6', name: 'Barbell squat', aliases: ['Smith barbell squat'], compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', implements: null });
    const smithTwin = { ...smithSquat, aliases: ['Smith barbell squat'] };
    expect(matchName('Smith Barbell Squat', [freeTwin, smithTwin], none)).toMatchObject({ status: 'check', exerciseId: smithTwin.exerciseId, via: 'name' });
  });

  it('a name that says assisted is only an assisted or bodyweight exercise, even when it says Machine (review r6 B3)', () => {
    const lat = CANDIDATES.find((c) => c.name === 'Lat pulldown') as MatchCandidate;
    const row = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e7', name: 'Chest-supported machine row', aliases: ['Seated row machine'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null });
    const withRow = [...list, row];
    const loads = new Set([machinePress.exerciseId, row.exerciseId, lat.exerciseId, idOf('Seated cable row')]);
    for (const n of ['Assisted Shoulder Press Machine', 'Assisted Seated Row Machine', 'Assisted Lat Pull Machine', 'Assisted Lat Pulldown Machine', 'Machine Assisted Row']) {
      const m = matchName(n, withRow, none);
      const c = withRow.find((x) => x.exerciseId === m.exerciseId);
      expect(m.exerciseId === null || !loads.has(m.exerciseId), `${n} → ${String(c?.name)}`).toBe(true);
      expect(c === undefined || c.defaultLoadConvention === 'assistance' || c.defaultLoadConvention === 'bodyweight', `${n} → ${String(c?.name)}`).toBe(true);
    }
    // A stack exercise an earlier `Add new` made from an assisted name is never suggested for it either.
    const made = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000e8', name: 'Assisted Chin Up Machine', aliases: [], catalogueKey: null, compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null, importMade: true });
    expect(matchName('Assisted Chin Up Machine', [...list, made], none).exerciseId).not.toBe(made.exerciseId);
    // Realistic assisted names still reach the assisted exercises.
    expect(matchName('Assisted Pull Up Machine', list, none)).toMatchObject({ exerciseId: idOf('Assisted pull-up') });
    expect(matchName('Assisted Dip Machine', list, none)).toMatchObject({ status: 'matched', exerciseId: assistedDip.exerciseId });
    expect(matchName('Band Assisted Pull Up', list, none).exerciseId).toBe(idOf('Assisted pull-up'));
  });
});

describe('suggestions and one-arm / two-arm words (review r5 N1)', () => {
  it('never suggests one dumbbell for a name that says two, or two for one that says one', () => {
    const doubleKb = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000f1', name: 'Kettlebell press', aliases: ['KB press', 'Single-arm kettlebell press'], compatibleEquipment: ['kettlebell'], defaultLoadConvention: 'per_hand', implements: 1 });
    expect(matchName('Two-Arm Dumbbell Row', CANDIDATES, none).exerciseId).not.toBe(idOf('One-arm dumbbell row'));
    expect(matchName('Double Kettlebell Press', [...CANDIDATES, doubleKb], none).exerciseId).not.toBe(doubleKb.exerciseId);
  });

  it('count words are left out of the comparison, and a tie goes to the exercise whose own name says the same count', () => {
    const singlePulldown = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000f5', name: 'Single-arm pulldown', aliases: ['Single-arm lat pulldown', 'One-arm lat pulldown'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null });
    const singleRow = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000f6', name: 'Single-arm cable row', aliases: ['Single-arm seated cable row', 'SA cable row'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', implements: null });
    const list = [...CANDIDATES, singlePulldown, singleRow];
    // Names from the real 2020 FitNotes export: the two-arm exercises, not "no match" from a tie with the single-arm ones.
    expect(matchName('Lat Pulldown (Pulley)', list, none)).toMatchObject({ status: 'check', exerciseId: idOf('Lat pulldown') });
    expect(matchName('Seated Cable Row (Pulley)', list, none)).toMatchObject({ status: 'check', exerciseId: idOf('Seated cable row') });
    // A name that says one arm: the single-arm exercise.
    expect(matchName('Single Arm Cable Row (Pulley)', list, none)).toMatchObject({ status: 'check', exerciseId: singleRow.exerciseId });
    expect(matchName('One Arm Lat Pulldown (Cable)', list, none)).toMatchObject({ status: 'check', exerciseId: singlePulldown.exerciseId });
  });

  it('a one-arm word never outweighs the movement', () => {
    // As in the catalogue: its other names say single-arm.
    const oneArmPress = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000f2', name: 'One-arm dumbbell shoulder press', aliases: ['Single-arm dumbbell press', 'Single-arm dumbbell shoulder press'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: 1 });
    const list = [...CANDIDATES, oneArmPress];
    expect(matchName('Dumbbell Bench Press (Single Arm)', list, none)).toMatchObject({ status: 'check', exerciseId: idOf('Dumbbell bench press') });
    expect(matchName('Single Arm Dumbbell Preacher Curl', list, none).exerciseId).not.toBe(idOf('One-arm dumbbell row'));
    // The count is still asked: the name says one, the bench press is two.
    expect(implementsFor('Dumbbell Bench Press (Single Arm)', CANDIDATES.find((c) => c.name === 'Dumbbell bench press') as MatchCandidate)).toBeNull();
  });
});

describe('one dumbbell or two, from the name (review r4 S1)', () => {
  it('reads words that say one implement or two', () => {
    for (const n of ['One-Arm Standing Dumbbell Press', 'Dumbbell Concentration Curl', 'Single Arm DB Row', '1-arm DB row', 'One Hand Dumbbell Snatch', 'Unilateral DB Press', 'Goblet Squats', 'Single-Leg RDL', 'Suitcase Carry']) expect(implementCue(n), n).toBe(1);
    for (const n of ['Two-Arm Dumbbell Row', 'Alternating Dumbbell Curl', 'Alt DB Curl', 'Double Kettlebell Press', '2 DB Lunge']) expect(implementCue(n), n).toBe(2);
    // One dumbbell can be held in both hands: `Two-hand` says nothing about the count.
    for (const n of ['Two-hand overhead dumbbell extension', 'Dumbbell Bench Press', 'Seated Dumbbell Press', 'Dumbbell Side Bend']) expect(implementCue(n), n).toBeNull();
    expect(implementCue('Single-Arm Alternating Press')).toBe('unclear');
    // An alternate grip says nothing about the count (review r6 N3).
    for (const n of ['Alternate Grip Dumbbell Row', 'Alt Grip DB Row', 'Alternating-Grip Dumbbell Shrug']) expect(implementCue(n), n).toBeNull();
    expect(implementCue('Alternating Dumbbell Curl (Neutral Grip)')).toBe(2);
  });

  it('a one-arm or concentration name never takes a two-dumbbell exercise’s count, however it was mapped', () => {
    const standing = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000d1', name: 'Standing dumbbell shoulder press', aliases: ['Standing dumbbell press'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', implements: 2 });
    const curl = CANDIDATES.find((c) => c.name === 'Dumbbell curl') as MatchCandidate;
    expect(implementsFor('One-Arm Standing Dumbbell Press', standing)).toBeNull();
    expect(implementsFor('Dumbbell Concentration Curl', curl)).toBeNull();
    expect(implementsFor('Standing Dumbbell Press', standing)).toBe(2);
    expect(implementsFor('Alternating Dumbbell Curl', curl)).toBe(2);
  });

  it('a pair is a pair only from the exercise’s own name or a two-arm word, never from a suggestion (review r5 S1)', () => {
    const curl = CANDIDATES.find((c) => c.name === 'Dumbbell curl') as MatchCandidate;
    const raise = CANDIDATES.find((c) => c.name === 'Lateral raise') as MatchCandidate;
    // FitNotes' defaults suggested as the pair by their words: asked, whichever way they were mapped.
    expect(matchName('Dumbbell Preacher Curl', CANDIDATES, none)).toMatchObject({ status: 'check', exerciseId: curl.exerciseId });
    expect(implementsFor('Dumbbell Preacher Curl', curl)).toBeNull();
    expect(implementsFor('Front Dumbbell Raise', raise)).toBeNull();
    expect(implementsFor('Dumbbell Side Bend', raise)).toBeNull();
    expect(implementsFor('Dumbbell Wrist Curl', curl)).toBeNull();
    expect(implementsFor('DB Curl', curl)).toBeNull();
    // Its own names: a pair.
    expect(implementsFor('Dumbbell Curl', curl)).toBe(2);
    expect(implementsFor('dumbbell  lateral RAISE', raise)).toBe(2);
    // A two-arm word agreeing with the catalogue: a pair (source (c)).
    expect(implementsFor('Alternating Dumbbell Preacher Curl', curl)).toBe(2);
  });

  it('an exercise an earlier import made from the name is never that name’s own exercise (review r5 S2)', () => {
    const made = candidate({ exerciseId: '00000000-0000-4000-8000-0000000000f3', name: 'Zottman Curl', catalogueKey: null, compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', implements: null, importMade: true });
    const mine = { ...made, exerciseId: '00000000-0000-4000-8000-0000000000f4', importMade: false };
    expect(namesExercise('Zottman Curl', made)).toBe(false);
    expect(namesExercise('Zottman Curl', mine)).toBe(true);
    // Suggested, never Matched, by its name; its bar isn't known from the name either.
    expect(matchName('Zottman Curl', [...CANDIDATES, made], none)).toMatchObject({ status: 'check', exerciseId: made.exerciseId, via: 'words' });
    expect(barNamed('Zottman Curl', made, 'barbell')).toBe(false);
    expect(barNamed('Barbell Zottman Curl', made, 'barbell')).toBe(true);
    // Through the remembered answer while its import is in effect.
    expect(matchName('Zottman Curl', [...CANDIDATES, made], new Map([[nameKey('Zottman Curl'), { kind: 'exercise', exerciseId: made.exerciseId }]]))).toMatchObject({ status: 'matched', via: 'alias' });
  });

  it('a bar is known from the exercise’s own name or a bar word, never from a suggestion (PM decision, review r5)', () => {
    const bench = CANDIDATES.find((c) => c.name === 'Bench press') as MatchCandidate;
    const ez = CANDIDATES.find((c) => c.name === 'EZ-bar skull crusher') as MatchCandidate;
    expect(barNamed('Bench Press', bench, 'barbell')).toBe(true);
    expect(barNamed('Flat Bench', bench, 'barbell')).toBe(true);
    expect(barNamed('Flat Barbell Bench Press', bench, 'barbell')).toBe(true);
    expect(barNamed('Log Press', bench, 'barbell')).toBe(false);
    expect(barNamed('Decline Bench Press', bench, 'barbell')).toBe(false);
    expect(barNamed('EZ-Bar Skullcrusher', ez, 'ez_bar')).toBe(true);
    expect(barNamed('Skullcrusher', ez, 'ez_bar')).toBe(false);
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
