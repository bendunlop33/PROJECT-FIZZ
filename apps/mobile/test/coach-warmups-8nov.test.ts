import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 8 Nov, live Pull B) "Ok but there's not much of a warm up"; later "Why haven't u added a 80 too" and "Yes".
 * A problem he points out is the request: the coach's `edit_today` `warmups` op puts warm-ups on today's rows at once
 * (the workout's own `add_warmup`, in the warm-up block by load), loads snapped to the bar and plates, one Undo for the
 * batch; a done warm-up never changes (rule 2). Real SQLite, scripted model.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-08T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = (r: { ok: true; aggregate: SessionAggregate } | { ok: false; error: { message: string } }): SessionAggregate => {
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
};

/** Live: Barbell row, one 50 kg warm-up done, three working sets at 97.5 kg × 6. */
async function liveRows(s: AppServices): Promise<{ sessionId: string; rowId: string }> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Barbell row')).find((p) => p.exercise.name === 'Barbell row');
  if (pick === undefined) throw new Error('no row');
  let a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() }));
  const row = a.exercises.at(-1);
  if (row === undefined) throw new Error('no row');
  for (const x of a.sets.filter((y) => y.sessionExerciseId === row.id)) a = ok(await s.workout.dispatch(sessionId, { type: 'delete_set', at: h.now(), opId: h.ids(), setId: x.id, expectedSetVersion: x.version }));
  for (let i = 0; i < 3; i += 1) a = ok(await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: row.id, newSetId: h.ids(), setType: null }));
  for (const x of a.sets.filter((y) => y.sessionExerciseId === row.id && y.status === 'pending')) {
    a = ok(await s.workout.dispatch(sessionId, { type: 'edit_planned_set', at: h.now(), opId: h.ids(), setId: x.id, expectedSetVersion: x.version, patch: { load: { value: 97.5, unit: 'kg', convention: 'total' }, reps: { min: 6, max: 6 }, setType: 'working' } }));
  }
  a = ok(await s.workout.dispatch(sessionId, { type: 'add_warmup', at: h.now(), opId: h.ids(), sessionExerciseId: row.id, newSetId: h.ids(), planned: { load: { value: 50, unit: 'kg', convention: 'total' }, reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null }, restS: 60, expectedVersion: a.session.version }));
  const warm = a.sets.find((y) => y.sessionExerciseId === row.id && y.setType === 'warmup');
  if (warm === undefined) throw new Error('no warm-up');
  h.clockMs += 60_000;
  ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${warm.id}:0`, setId: warm.id, values: { load: { value: 50, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() }));
  return { sessionId, rowId: row.id };
}

const say = (s: AppServices, text: string, sessionId: string, threadId: string | null = null) => s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

/** The rows' warm-ups as [load, status], top to bottom, and the working sets' loads. */
async function rows(s: AppServices, sessionId: string, rowId: string): Promise<{ warm: [number | null, string][]; work: (number | null)[] }> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const own = (a?.sets ?? []).filter((x) => x.sessionExerciseId === rowId && x.status !== 'deleted').sort((x, y) => x.index - y.index);
  return {
    warm: own.filter((x) => x.setType === 'warmup').map((x) => [(x.actual?.load ?? x.planned.load)?.value ?? null, x.status]),
    work: own.filter((x) => x.setType !== 'warmup').map((x) => x.planned.load?.value ?? null),
  };
}

const warmupsCall = (sets: { load: number; reps: number }[], replace: boolean, quote: string) => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const ex = w.exercises.find((e) => e.name === 'Barbell row');
  if (ex === undefined) throw new Error('no row in context');
  return toolCall('edit_today', { baseVersion: w.version, ops: [{ op: 'warmups', sessionExerciseId: ex.sessionExerciseId, sets, replace }], reason: 'A real ramp to 97.5.', benAsked: true, benQuote: quote });
};

describe('warm-ups today from the coach (Ben, 8 Nov)', () => {
  it('"not much of a warm up": a ramp is added to today’s rows at once (no question back), snapped, above the working sets; one Undo', async () => {
    const { services: s } = await h.launch();
    const { sessionId, rowId } = await liveRows(s);
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed']], work: [97.5, 97.5, 97.5] });
    // 61 isn't a bar load: rounded down to 60. 50 is there already (done): not added twice.
    model = new StepModel([warmupsCall([{ load: 50, reps: 8 }, { load: 61, reps: 5 }, { load: 75, reps: 3 }, { load: 87.5, reps: 1 }], false, "there's not much of a warm up"), () => replyWith('Three more steps up to 97.5.')]);
    const r = await say(s, "Ok but there's not much of a warm up", sessionId);
    const instructions = model.requests[0]?.instructions ?? '';
    expect(instructions).toContain('not much of a warm-up');
    const card = r.cards.find((c) => c.record.detail.kind === 'edit_today')?.record;
    expect(card?.status).toBe('committed');
    expect(r.cards.map((c) => c.rendered.text).join('\n')).toContain('Barbell row warm-ups: 50, 60, 75, 87.5 kg');
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed'], [60, 'pending'], [75, 'pending'], [87.5, 'pending']], work: [97.5, 97.5, 97.5] });
    if (card === undefined) throw new Error('no card');
    expect((await s.coach.undo(card.actionId, `undo:${card.actionId}`)).result.status).toBe('written');
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed']], work: [97.5, 97.5, 97.5] });
  });

  it('"Why haven’t u added a 80 too" applies at once; after a question, a bare "Yes" applies the change described, never asks again', async () => {
    const { services: s } = await h.launch();
    const { sessionId, rowId } = await liveRows(s);
    model = new StepModel([warmupsCall([{ load: 60, reps: 5 }], true, 'not much of a warm up'), () => replyWith('60 kg first.')]);
    const first = await say(s, "Ok but there's not much of a warm up", sessionId);
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed'], [60, 'pending']], work: [97.5, 97.5, 97.5] });
    // The whole ramp in one call: 60 stays (already there), 80 is added; the done 50 never changes.
    model = new StepModel([warmupsCall([{ load: 60, reps: 5 }, { load: 80, reps: 3 }], true, "Why haven't u added a 80 too"), () => replyWith('80 kg added before your working sets.')]);
    const second = await say(s, "Why haven't u added a 80 too", sessionId, first.threadId);
    expect(second.cards.find((c) => c.record.detail.kind === 'edit_today')?.record.status).toBe('committed');
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed'], [60, 'pending'], [80, 'pending']], work: [97.5, 97.5, 97.5] });
    const card = second.cards.find((c) => c.record.detail.kind === 'edit_today')?.record;
    if (card === undefined) throw new Error('no card');
    expect((await s.coach.undo(card.actionId, `undo:${card.actionId}`)).result.status).toBe('written');
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed'], [60, 'pending']], work: [97.5, 97.5, 97.5] });
    // The coach asked instead of acting (the old way); Ben's "Yes" makes that change, applied, not offered.
    model = new StepModel([() => replyWith('Do you want the row warm-ups to include both 60 kg and 80 kg?')]);
    const asked = await say(s, 'Why no 80', sessionId, first.threadId);
    model = new StepModel([warmupsCall([{ load: 60, reps: 5 }, { load: 80, reps: 3 }], true, 'Yes'), () => replyWith('80 kg in.')]);
    const yes = await say(s, 'Yes', sessionId, asked.threadId);
    expect(model.requests[0]?.instructions).toContain('never ask again');
    expect(yes.cards.find((c) => c.record.detail.kind === 'edit_today')?.record.status).toBe('committed');
    expect(await rows(s, sessionId, rowId)).toEqual({ warm: [[50, 'completed'], [60, 'pending'], [80, 'pending']], work: [97.5, 97.5, 97.5] });
  });
});
