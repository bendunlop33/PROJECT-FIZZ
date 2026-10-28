import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct) Every coach surface sees the last 7 days, read from the local store; `get_recent_sessions` takes a
 * day. Real SQLite, scripted model; the plan route is not involved.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function yourData(req: ModelRequest | undefined): { lastDays?: { days: { when?: string; workouts: { exercises: string[] }[] }[] } } {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as never;
}

describe('the last 7 days in the coach (app wiring)', () => {
  it('a general turn sees yesterday’s workout in YOUR DATA, reads it in full by day, and the builder coach is wired too', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += 86_400_000;
    model = new StepModel([() => toolCall('get_recent_sessions', { count: 2, date: null, daysAgo: 1 }), () => replyWith('Bench went well yesterday.')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How was yesterday?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const days = yourData(model.requests[0]).lastDays?.days ?? [];
    const y = days.find((d) => d.when === 'yesterday');
    expect(y?.workouts[0]?.exercises.map((x) => x.replace(/\u00a0/g, ' '))).toEqual(['Bench press: 60 kg × 8 (2 sets)']);
    const out = model.requests[1]?.input.flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { status: string; data: { sessions: unknown[] } }] : []))[0];
    expect(out?.status).toBe('ok');
    expect(out?.data.sessions).toHaveLength(1);
    const described = await s.coach.describe({ kind: 'today' }, null);
    expect(described.yourData.find((d) => d.label === 'Last 7 days')?.detail).toBe('1 workout');
    expect(s.builderCoach.sees()).toEqual({ lastDays: true });
  });
});
