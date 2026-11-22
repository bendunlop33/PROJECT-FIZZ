import { describe, expect, it } from 'vitest';

import { asksPastWorkoutFix, buildTurnRegistry, COACH_NEVER, findTool, WORKOUT_FIX_LINE } from '../src/index';

/** (Ben, 2 Nov) `propose_workout_fix`: offered in every chat, only on Ben's words about fixing a past workout. */
describe('propose_workout_fix', () => {
  const gate = (over: Partial<Parameters<typeof buildTurnRegistry>[0]> = {}): Parameters<typeof buildTurnRegistry>[0] => ({ kind: 'general', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], ...over });
  const names = (g: Parameters<typeof buildTurnRegistry>[0]): string[] => buildTurnRegistry(g).tools.map((t) => t.name);

  it('Ben’s words about a past workout’s day, a duplicate or a pairing open it', () => {
    for (const said of [
      'that Tuesday pull was actually Monday',
      'delete the duplicate push workout from Saturday',
      'pair my Garmin run on Thursday with the planned run',
      'these two strength sessions are the same workout',
      'wrong date on yesterday’s legs',
      'move my push workout to Sunday',
      'I logged it twice',
      'unpair the Garmin workout',
    ]) {
      expect([said, asksPastWorkoutFix(said)]).toEqual([said, true]);
    }
  });

  it('ordinary training words don’t (the tool and its line stay out of the turn)', () => {
    for (const said of ['Bench felt heavy today', 'move bench after squats', 'How was my week?', 'Add curls to my plan', 'Swap leg press for hack squat', 'I’m on holiday till Monday']) {
      expect([said, asksPastWorkoutFix(said)]).toEqual([said, false]);
    }
  });

  it('offered in general and workout chats on those words only; never in the post-workout review', () => {
    expect(names(gate({ pastWorkoutWords: true }))).toContain('propose_workout_fix');
    expect(names(gate({ kind: 'workout', pastWorkoutWords: true }))).toContain('propose_workout_fix');
    expect(names(gate())).not.toContain('propose_workout_fix');
    expect(names(gate({ kind: 'summary', pastWorkoutWords: true }))).not.toContain('propose_workout_fix');
  });

  it('is a proposal (never a direct write), and the Never list still says so', () => {
    expect(findTool('propose_workout_fix')).toMatchObject({ effect: 'propose', writes: ['proposal'], needs: 'ben_request' });
    expect(COACH_NEVER).toContain('Delete or change a past workout without your Apply');
    expect(WORKOUT_FIX_LINE).toContain('two app workouts can’t be merged');
  });
});
