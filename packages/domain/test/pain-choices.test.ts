import { describe, expect, it } from 'vitest';
import { EXERCISE_SHORT_FORMS, exercisesLooselyNamedIn, exercisesNamedIn, painFlagChoices, shortFormMeans } from '../src/index';

/** Which movement `Pain` flags after Ben mentions pain to the coach (review S5, r2 S1; rule 9). */

const EX = [
  { exerciseId: 'squat', exerciseName: 'Back squat' },
  { exerciseId: 'bench', exerciseName: 'Bench press' },
  { exerciseId: 'rdl', exerciseName: 'Romanian deadlift' },
  { exerciseId: 'pulldown', exerciseName: 'Lat pulldown' },
  { exerciseId: 'legpress', exerciseName: 'Leg press' },
];

describe('exercisesLooselyNamedIn', () => {
  it('a distinctive word of the name, plural allowed', () => {
    expect(exercisesLooselyNamedIn('bench earlier hurt my shoulder', EX)).toEqual(['bench']);
    expect(exercisesLooselyNamedIn('squats felt off', EX)).toEqual(['squat']);
    expect(exercisesLooselyNamedIn('deadlifts tweaked something', EX)).toEqual(['rdl']);
    expect(exercisesLooselyNamedIn('pulldowns hurt', EX)).toEqual(['pulldown']);
  });

  it('never a body part or a general word', () => {
    expect(exercisesLooselyNamedIn('my back hurts', EX)).toEqual([]);
    expect(exercisesLooselyNamedIn('my leg hurts', EX)).toEqual([]);
    expect(exercisesLooselyNamedIn('my lats are sore', EX)).toEqual([]);
    expect(exercisesLooselyNamedIn('the press hurt', EX)).toEqual([]);
  });
});

describe('painFlagChoices', () => {
  it('in a workout: a whole name is flagged at once, even when another exercise is in focus', () => {
    expect(painFlagChoices('bench press earlier hurt my shoulder', EX, 'squat')).toEqual({ exerciseIds: ['bench'], pick: false });
  });

  it('in a workout: a short name is offered with the focus exercise, to pick from', () => {
    expect(painFlagChoices('bench earlier hurt my shoulder, go lighter', EX, 'squat')).toEqual({ exerciseIds: ['squat', 'bench'], pick: true });
    // Already the one in focus: still offered rather than guessed.
    expect(painFlagChoices('bench hurt', EX, 'bench')).toEqual({ exerciseIds: ['bench'], pick: true });
  });

  it('several whole names: chips', () => {
    expect(painFlagChoices('back squat and bench press both hurt', EX, 'pulldown')).toEqual({ exerciseIds: ['squat', 'bench'], pick: true });
  });

  it('nothing named: the focus exercise in a workout, else every movement to pick from', () => {
    // r3 S2: a body part alone may be from an earlier movement: chips, focus first.
    expect(painFlagChoices('my elbow hurts', EX, 'squat')).toEqual({ exerciseIds: ['squat', 'bench', 'rdl', 'pulldown', 'legpress'], pick: true });
    expect(painFlagChoices('ow', EX, 'squat')).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices(null, EX, 'squat')).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices('my elbow hurts', EX, null)).toEqual({ exerciseIds: EX.map((e) => e.exerciseId), pick: true });
    expect(painFlagChoices('my elbow hurts', [EX[0] ?? { exerciseId: '', exerciseName: '' }], null)).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices('ow', [], null)).toEqual({ exerciseIds: [], pick: false });
  });
});

/** Review r3 S1/S2: negation, "fine" positives, several names, short forms, body part only (rule 9). */
describe('painFlagChoices: what Ben actually says', () => {
  const W = [...EX, { exerciseId: 'ohp', exerciseName: 'Overhead press' }, { exerciseId: 'curl', exerciseName: 'EZ bar curl' }];
  const ALL = W.map((e) => e.exerciseId);
  const rest = (first: string, last: readonly string[] = []): string[] => [first, ...ALL.filter((id) => id !== first && !last.includes(id)), ...last];
  const cases: { says: string; focus: string | null; ids: string[]; pick: boolean }[] = [
    // The probe sentences.
    { says: 'back squat felt fine but my shoulder hurts on bench', focus: 'bench', ids: ['bench'], pick: true },
    { says: 'back squat felt fine but my shoulder hurts on bench', focus: 'squat', ids: ['bench'], pick: true },
    { says: 'not the bench press, my knee hurts on squats', focus: 'bench', ids: ['squat'], pick: true },
    { says: 'rdl tweaked my hamstring', focus: 'bench', ids: ['rdl'], pick: false },
    // Negation of a name.
    { says: 'my knee hurts on squats not bench', focus: 'pulldown', ids: ['squat', 'pulldown'], pick: true },
    { says: "it's not the bench press, it's the overhead press that hurts", focus: 'bench', ids: ['ohp'], pick: true },
    { says: 'no bench press without pain lately', focus: 'squat', ids: ['bench'], pick: false },
    { says: 'squats were ok, no pain', focus: 'squat', ids: rest('bench', ['squat']), pick: true },
    // Positives clear only their own clause.
    { says: 'bench felt good but squats hurt my knee', focus: 'pulldown', ids: ['squat', 'pulldown'], pick: true },
    { says: 'bench press was great, but the romanian deadlift tweaked my back', focus: 'rdl', ids: ['rdl'], pick: true },
    { says: "Bench press is fine. RDLs hurt", focus: 'bench', ids: ['rdl'], pick: true },
    { says: "back squat didn't hurt, bench press did", focus: 'squat', ids: ['bench'], pick: true },
    { says: 'bench felt fine but now it hurts', focus: 'squat', ids: rest('squat', ['bench']), pick: true },
    { says: 'bench is not fine, shoulder hurts', focus: 'squat', ids: ['squat', 'bench'], pick: true },
    { says: 'bench felt fine apart from my shoulder hurting', focus: 'squat', ids: ['squat', 'bench'], pick: true },
    // Several names.
    { says: 'bench press and overhead press both hurt my shoulder', focus: 'squat', ids: ['bench', 'ohp'], pick: true },
    { says: 'my shoulder hurts on bench press and pulldowns', focus: 'squat', ids: ['squat', 'bench', 'pulldown'], pick: true },
    // Short forms.
    { says: 'ohp pinched my shoulder', focus: 'bench', ids: ['ohp'], pick: false },
    { says: 'RDLs tweaked my back', focus: null, ids: ['rdl'], pick: false },
    { says: 'sldl hurt', focus: 'bench', ids: rest('bench'), pick: true },
    // One whole name, one tap.
    { says: 'my knee hurts on leg press', focus: 'squat', ids: ['legpress'], pick: false },
    { says: 'EZ bar curls are killing my elbow', focus: 'squat', ids: ['curl'], pick: false },
    // Body part only.
    { says: 'my shoulder hurts', focus: 'pulldown', ids: rest('pulldown'), pick: true },
    { says: 'lower back is sore', focus: 'squat', ids: rest('squat'), pick: true },
    { says: 'my shoulder hurts', focus: null, ids: ALL, pick: true },
    // Nothing named, nothing ruled out: the focus exercise.
    { says: 'that really hurt', focus: 'rdl', ids: ['rdl'], pick: false },
    // "back" is a body part, never Back squat; "press" never names a press.
    { says: 'my back hurts', focus: 'bench', ids: rest('bench'), pick: true },
    { says: 'the press hurt', focus: 'bench', ids: ['bench'], pick: false },
  ];

  it.each(cases)('$says (focus $focus)', ({ says, focus, ids, pick }) => {
    expect(painFlagChoices(says, W, focus)).toEqual({ exerciseIds: ids, pick });
  });

  it('a movement named with pain is always offered', () => {
    for (const { says, focus } of cases) {
      const r = painFlagChoices(says, W, focus);
      for (const id of exercisesNamedIn(says, W)) {
        const clearedElsewhere = /fine|ok|good|great|didn't hurt|\bnot the\b|\bnot bench\b/i.test(says);
        if (!clearedElsewhere) expect(r.exerciseIds).toContain(id);
      }
    }
  });

  it('a focus exercise outside the workout list is still offered', () => {
    expect(painFlagChoices('my shoulder hurts', EX, 'ohp')).toEqual({ exerciseIds: ['ohp', ...EX.map((e) => e.exerciseId)], pick: true });
  });
});

describe('exercise short forms', () => {
  it('stand for whole names, matched in both the pain choices and the Summary note', () => {
    expect(shortFormMeans('rdl', 'Romanian deadlift')).toBe(true);
    expect(shortFormMeans('rdl', 'Dumbbell Romanian deadlift')).toBe(true);
    expect(shortFormMeans('ohp', 'Overhead press')).toBe(true);
    expect(shortFormMeans('rdl', 'Deadlift')).toBe(false);
    expect(shortFormMeans('constructor', 'Romanian deadlift')).toBe(false);
    expect(EXERCISE_SHORT_FORMS.get('cgbp')).toBe('close grip bench press');
    expect(exercisesNamedIn('rdls tweaked my back', EX)).toEqual(['rdl']);
    expect(exercisesNamedIn('ohp felt off', EX)).toEqual([]);
  });
});
