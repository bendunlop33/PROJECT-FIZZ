import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoOpId } from '@fizz/coach';

import { threadRows } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, lowerPending, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Build 151 (14 Oct, PM decision pending Ben), through the app's services on real SQLite:
 * in a live workout the coach always has today's tools. Ben's own wording applies at once
 * with Undo; a change the coach raises on its own is an `Adjust` offer in the thread.
 */

const DAY = 86_400_000;
const BEN_151 = 'can you repopulate the weights based on my maximum working weight recently?';
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function benchWorkout(): Promise<{ s: AppServices; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const bench = picks.find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
  if (!added.ok) throw new Error(added.error.message);
  return { s, sessionId };
}

const say = (s: AppServices, sessionId: string, text: string, threadId: string | null = null) =>
  s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

const pendingLoads = async (s: AppServices, sessionId: string) =>
  ((await s.workout.load(sessionId))?.aggregate.sets ?? []).filter((x) => x.status === 'pending').map((x) => x.planned.load?.value ?? null);

describe('build 151 in the app: today-tools on every live turn', () => {
  it("Ben's wording: adjust_pending_sets and rename_workout are offered; the change applies at once and Undo puts it back", async () => {
    const { s, sessionId } = await benchWorkout();
    const before = await pendingLoads(s, sessionId);
    model = new StepModel([lowerPending('Your recent best.'), () => replyWith('Set from your recent sets.')]);
    const r = await say(s, sessionId, BEN_151);
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toEqual(expect.arrayContaining(['adjust_pending_sets', 'rename_workout']));
    // Coach v3 (ADR 0027): the list of what can be added goes on every live turn, so the add tool is always there.
    expect(tools).toContain('add_exercise_today');
    expect(model.requests[0]?.toolChoice).toBe('required');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    expect(await pendingLoads(s, sessionId)).not.toEqual(before);

    const actionId = r.cards[0]?.record.actionId ?? '';
    const u = await s.coach.undo(actionId, undoOpId(actionId));
    expect(u.result.status).toBe('written');
    expect(await pendingLoads(s, sessionId)).toEqual(before);
  });

  it('unprompted: nothing changes; the thread ends with an Adjust offer whose tap applies the change', async () => {
    const { s, sessionId } = await benchWorkout();
    const before = await pendingLoads(s, sessionId);
    model = new StepModel([lowerPending('Looked hard.'), () => replyWith('That looked hard. Want me to adjust?')]);
    const r = await say(s, sessionId, 'That felt rough');
    expect(r.cards).toEqual([]);
    expect(r.offer).toBe('adjust_today');
    expect(await pendingLoads(s, sessionId)).toEqual(before);
    const data = await s.coach.loadThread(r.threadId);
    if (data === null) throw new Error('no thread');
    const last = threadRows(data).at(-1);
    expect(last).toMatchObject({ kind: 'offer', input: { kind: 'accept_offer', offer: 'adjust_today' } });

    model = new StepModel([lowerPending('Looked hard.'), () => replyWith('Done.')]);
    const accepted = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, turnId: h.ids() });
    expect(accepted.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(await pendingLoads(s, sessionId)).not.toEqual(before);
    const after = await s.coach.loadThread(r.threadId);
    if (after === null) throw new Error('no thread');
    expect(threadRows(after).some((x) => x.kind === 'offer')).toBe(false);
  });

  it('rename in an open-ended workout is refused honestly by the workout’s own rule; nothing changes', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([(req) => toolCall('rename_workout', { baseVersion: contextWorkout(req).version, name: 'Chest, abs, triceps' }), () => replyWith('Okay.')]);
    const r = await say(s, sessionId, 'Change name of workout to Chest, abs, triceps');
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Not renamed: you can name this workout after you finish it.']]);
    expect((await s.workout.load(sessionId))?.aggregate.session.routineName).toBeNull();
  });
});
