import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { cardView } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Backlog §4.3 item 3 (coach-sheet §2.7, CS5): "log 100 for 8" and "set 2 was
 * 95" in chat go through the workout's own `log_set` / `correct_set`
 * commands, with the record in the same transaction, a card with Undo, and
 * only on Ben's own words. Real SQLite, scripted model.
 */

const DAY = 86_400_000;
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
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null, nextOf: first });
  if (!started.ok) throw new Error(started.error.message);
  return { s, sessionId: started.aggregate.session.id };
}

const say = (s: AppServices, sessionId: string, text: string) => s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

/** The model logs the first pending working set of the first exercise with these values. */
const logFirstPending = (load: number, reps: number, rpe: number | null = null) => (req: ModelRequest) => {
  const w = contextWorkout(req);
  const set = w.exercises[0]?.sets.find((x) => x.status === 'pending');
  return toolCall('log_set', { baseVersion: w.version, setId: set?.setId, load: { value: load, unit: 'kg', convention: 'total' }, reps, rpe });
};

async function working(s: AppServices, sessionId: string) {
  const d = await s.workout.load(sessionId);
  return (d?.aggregate.sets ?? []).filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
}

describe('log a set from chat', () => {
  it('"Log 62.5 for 8 at RPE 8": the Log button’s command, rest starts, a Logged card with Undo; Undo takes the log back', async () => {
    const { s, sessionId } = await benchWorkout();
    const before = await working(s, sessionId);
    h.clockMs += 60_000;
    model = new StepModel([logFirstPending(62.5, 8, 8), () => replyWith('Nice.')]);
    const r = await say(s, sessionId, 'Log 62.5 for 8 at RPE 8');
    expect(r.status).toBe('completed');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('log_set');
    const record = r.cards[0]?.record;
    expect(record).toMatchObject({ status: 'committed', detail: { kind: 'log_set', exerciseName: 'Bench press', values: { load: { value: 62.5, unit: 'kg' }, reps: 8, rpe: 8 } } });
    if (!record) throw new Error('no card');
    const card = cardView(record);
    expect(card).toMatchObject({ status: { word: 'Logged' }, canUndo: true });
    expect(card.text.replaceAll(String.fromCharCode(160), ' ')).toMatch(/^Logged set \d · Bench press: 62\.5 kg × 8 · RIR 2 \(actual\)\.$/);
    const d = await s.workout.load(sessionId);
    const set = d?.aggregate.sets.find((x) => x.id === before.find((b) => b.status === 'pending')?.id);
    expect(set).toMatchObject({ status: 'completed', actual: { load: { value: 62.5 }, reps: 8, rpe: 8 } });
    expect(d?.aggregate.restTimer?.status).toBe('running');
    // The rest alert follows, as after the Log button.
    expect([...h.pending.keys()].some((k) => k.startsWith('fizz.rest.'))).toBe(true);

    const undo = await s.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === set?.id)?.status).toBe('pending');
    // A double tap undoes once.
    expect((await s.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('replayed');
  });

  it('numbers Ben didn’t say are refused and nothing is logged; a plain question never gets the tool', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([logFirstPending(65, 8), () => replyWith('Done.')]);
    const r = await say(s, sessionId, 'Log 62.5 for 8');
    expect(r.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'say the weight and reps to log' });
    expect((await working(s, sessionId)).every((x) => x.status === 'pending')).toBe(true);

    model = new StepModel([logFirstPending(62.5, 8), () => replyWith('Done.')]);
    const q = await say(s, sessionId, 'I did 62.5 for 8, was that good?');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('log_set');
    expect(q.cards).toEqual([]);
    expect((await working(s, sessionId)).every((x) => x.status === 'pending')).toBe(true);
  });

  it('a stale version is refused (rule 5); after Ben logs the next set, Undo of the chat log is refused', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('log_set', { baseVersion: w.version + 1, setId: w.exercises[0]?.sets[0]?.setId, load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, rpe: null });
      },
      () => replyWith('Ok.'),
    ]);
    const st = await say(s, sessionId, 'log 60 for 8');
    expect(st.cards[0]?.record.status).toBe('stale');

    model = new StepModel([logFirstPending(60, 8), () => replyWith('Ok.')]);
    const r = await say(s, sessionId, 'log 60 for 8');
    const record = r.cards[0]?.record;
    if (record?.status !== 'committed') throw new Error('not logged');
    const next = (await working(s, sessionId)).find((x) => x.status === 'pending');
    if (!next) throw new Error('no next set');
    h.clockMs += 120_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-next', setId: next.id, values: { load: next.planned.load, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    const undo = await s.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result).toMatchObject({ status: 'not_possible', reason: 'changed_since' });
  });
});

describe('correct a logged set from chat', () => {
  it('"Set 1 was 57.5": before → after card; rest is untouched; Undo puts 60 back', async () => {
    const { s, sessionId } = await benchWorkout();
    const [s1] = await working(s, sessionId);
    if (!s1) throw new Error('no set');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: s1.id, values: { load: s1.planned.load, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const restBefore = logged.aggregate.restTimer;
    h.clockMs += 10_000;
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('correct_set', { baseVersion: w.version, setId: s1.id, load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null, rpe: null });
      },
      () => replyWith('Fixed.'),
    ]);
    const firstLoad = s1.planned.load?.value ?? 0;
    const r = await say(s, sessionId, `Set 1 was 57.5, not ${String(firstLoad)}`);
    const record = r.cards[0]?.record;
    expect(record).toMatchObject({ status: 'committed', detail: { kind: 'correct_set', before: { load: { value: firstLoad } }, after: { load: { value: 57.5 }, reps: 8 } } });
    if (!record) throw new Error('no card');
    expect(cardView(record).text).toContain('→ 57.5');
    const after = await s.workout.load(sessionId);
    expect(after?.aggregate.sets.find((x) => x.id === s1.id)?.actual?.load?.value).toBe(57.5);
    expect(after?.aggregate.restTimer).toMatchObject({ id: restBefore?.id, deadlineUtc: restBefore?.deadlineUtc });

    expect((await s.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('written');
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s1.id)?.actual?.load?.value).toBe(firstLoad);
  });

  it('a pending set can’t be "corrected"; a finished workout has no chat log or correction', async () => {
    const { s, sessionId } = await benchWorkout();
    const [s1] = await working(s, sessionId);
    model = new StepModel([
      (req) => toolCall('correct_set', { baseVersion: contextWorkout(req).version, setId: s1?.id, load: { value: 55, unit: 'kg', convention: 'total' }, reps: null, rpe: null }),
      () => replyWith('Ok.'),
    ]);
    const r = await say(s, sessionId, 'set 1 was 55');
    expect(r.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'set 1 isn’t logged yet' });

    const d = await s.workout.load(sessionId);
    h.clockMs += 60_000;
    await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin', expectedVersion: d?.aggregate.session.version ?? 0, endedAt: null });
    model = new StepModel([() => replyWith('Ok.')]);
    await say(s, sessionId, 'log 60 for 8');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('log_set');
  });
});
