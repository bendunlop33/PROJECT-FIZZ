import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, lowerPending, replyWith, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Ben, 24 Nov (Push B): "How have you decided the weights for today's session vis a vis previous?" had its explanation
 * hidden, and "Why was this error here" after an Applied card got "I didn't make a change". Real SQLite, scripted model.
 */
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-24T10:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
async function benchToday(): Promise<{ s: AppServices; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 7 * DAY;
  const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const bench = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
  if (!added.ok) throw new Error(added.error.message);
  return { s, sessionId };
}
const say = (s: AppServices, sessionId: string, text: string, threadId: string | null = null) =>
  s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const shownText = (r: Awaited<ReturnType<typeof say>>): string => JSON.stringify(r);

describe('Ben’s two questions', () => {
  it('an explanation of today’s weights from his history is shown whole, with no "lines hidden" note', async () => {
    const { s, sessionId } = await benchToday();
    model = new StepModel([() => replyWith('Your last session was 60 kg × 8 on all three sets, so today starts from 60 kg because you have not reached the top of the range yet. Nothing about today’s order changed that.')]);
    const r = await say(s, sessionId, 'How have you decided the weights for today’s session vis a vis previous?');
    expect(r.status).toBe('completed');
    const text = shownText(r);
    expect(text).toContain('Your last session was 60 kg');
    expect(text).not.toMatch(/lines? hidden/);
    expect(text).not.toContain('Nothing changed');
  });

  it('after an Applied card, the next turn’s context lists it (so "why was this error here" can’t get "I made no change")', async () => {
    const { s, sessionId } = await benchToday();
    model = new StepModel([lowerPending('Your recent best.'), () => replyWith('Done.'), () => replyWith('That target followed your last session, because it was 60 kg × 8.')]);
    const first = await say(s, sessionId, 'Make today’s bench a bit lighter please');
    expect(first.cards.map((c) => c.record.status)).toEqual(['committed']);
    const second = await say(s, sessionId, 'Why was this error here', first.threadId);
    expect(second.status).toBe('completed');
    const req = model.requests.at(-1);
    const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    const data = JSON.parse(block?.type === 'message' ? block.content.slice(block.content.indexOf('\n') + 1) : '{}') as { changesThisChat?: string[] };
    expect(data.changesThisChat?.[0]).toMatch(/^Applied: Changed /);
    expect(JSON.stringify(req?.instructions)).toMatch(/never say it wasn’t/);
  });
});
