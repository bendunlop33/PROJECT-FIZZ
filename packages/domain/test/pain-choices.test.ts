import { describe, expect, it } from 'vitest';
import { exercisesLooselyNamedIn, painFlagChoices } from '../src/index';

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
    expect(painFlagChoices('my elbow hurts', EX, 'squat')).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices(null, EX, 'squat')).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices('my elbow hurts', EX, null)).toEqual({ exerciseIds: EX.map((e) => e.exerciseId), pick: true });
    expect(painFlagChoices('my elbow hurts', [EX[0] ?? { exerciseId: '', exerciseName: '' }], null)).toEqual({ exerciseIds: ['squat'], pick: false });
    expect(painFlagChoices('ow', [], null)).toEqual({ exerciseIds: [], pick: false });
  });
});
