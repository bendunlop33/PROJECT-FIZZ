import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall, type ContextWorkout } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct: "if i name a weight specifically it probably means its there") Real SQLite, scripted model. A weight
 * Ben names to the coach that the gym's profile can't make is kept as typed and the gym learns it quietly: a 31 kg
 * dumbbell on a rack without one, the plate a barbell total needs. One Undo takes back the change and the learn.
 * Future snapping uses it. A machine's max still caps; a stack step is kept as typed, not learned.
 */

const DAY = 86_400_000;
const BEN_95 = 'give me a workout which builds up to 95 kg barbell row as the last set (with sets and weights)';
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function ben(preset: 'commercial' | 'home_dumbbells' = 'commercial'): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s, preset);
  return { s, gymId };
}

/** Rows (70 × 8) and curls (12.5 each × 10) two days ago, then today's workout started with both. */
async function liveRowsAndCurls(): Promise<{ s: AppServices; gymId: string; sessionId: string }> {
  const { s, gymId } = await ben();
  await logWorkout(h, s, gymId, [
    { exercise: 'Barbell row', sets: [{ load: 70, reps: 8, rpe: 8 }, { load: 70, reps: 8, rpe: 8 }, { load: 70, reps: 8, rpe: 8 }] },
    { exercise: 'Dumbbell curl', sets: [{ load: 12.5, reps: 10, rpe: 8 }, { load: 12.5, reps: 10, rpe: 8 }] },
  ]);
  h.clockMs += 2 * DAY;
  const started = await s.workout.start({ gymId, opId: 'start-live', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const name of ['Barbell row', 'Dumbbell curl']) await addRow(s, sessionId, name);
  return { s, gymId, sessionId };
}

async function addRow(s: AppServices, sessionId: string, name: string, equipment: 'first' | 'none' = 'first'): Promise<void> {
  const picks = await s.workout.pickerExercises(sessionId, name);
  const pick = picks.find((p) => p.exercise.name === name);
  if (pick === undefined) throw new Error(`no ${name}`);
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: equipment === 'none' ? null : (pick.equipment[0]?.id ?? null), opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
}

const say = (s: AppServices, text: string, entry: { kind: 'today' } | { kind: 'workout'; sessionId: string }) => s.coach.send({ entry, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function aggregate(s: AppServices, sessionId: string): Promise<SessionAggregate> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  if (!a) throw new Error('no workout');
  return a;
}

function rowSets(a: SessionAggregate, name: string) {
  const row = a.exercises.find((e) => e.exerciseName === name && e.removed === undefined);
  return a.sets.filter((x) => x.sessionExerciseId === row?.id && x.status !== 'deleted').sort((x, y) => x.index - y.index);
}

const exOf = (w: ContextWorkout, name: string) => {
  const e = w.exercises.find((x) => x.name === name);
  if (e === undefined) throw new Error(`no ${name} in the context: ${w.exercises.map((x) => x.name).join(', ')}`);
  return e;
};

/** The model's edit, from the workout it was given (real IDs and version). */
const edit = (ops: (w: ContextWorkout) => unknown[], quote: string) => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  return toolCall('edit_today', { baseVersion: w.version, ops: ops(w), reason: 'Ben asked.', benAsked: true, benQuote: quote });
};
const kg = (value: number, convention = 'total') => ({ value, unit: 'kg', convention });
const target = (value: number, reps: number, convention = 'total') => ({ load: kg(value, convention), reps: { min: reps, max: reps }, rpe: null });


async function items(s: AppServices, gymId: string) {
  return (await s.gyms.detail(gymId))?.equipment.map((e) => e.equipment) ?? [];
}
const rack = async (s: AppServices, gymId: string) => (await items(s, gymId)).find((e) => e.kind === 'dumbbells');
const bar = async (s: AppServices, gymId: string) => (await items(s, gymId)).find((e) => e.kind === 'barbell');

describe('a weight Ben names is learned by the gym (Ben, 28 Oct)', () => {
  it('"use 31 kg dumbbells for curls": exactly 31 each; the rack gains 31; no extra line; Undo takes both back', async () => {
    const { s, gymId, sessionId } = await liveRowsAndCurls();
    const was = await rack(s, gymId);
    if (was?.kind !== 'dumbbells') throw new Error('no rack');
    expect(was.loads).not.toContain(31);
    model = new StepModel([edit((w) => exOf(w, 'Dumbbell curl').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(31, 'per_hand'), reps: null } })), 'use 31 kg dumbbells for curls'), () => replyWith('Done.')]);
    const r = await say(s, 'use 31 kg dumbbells for curls', { kind: 'today' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    const record = r.cards[0]?.record;
    if (record?.detail.kind !== 'edit_today') throw new Error('no edit');
    // The one-line result is the edit's own; nothing about the gym.
    expect(record.detail.lines.map((l) => JSON.stringify(l)).join(' ')).not.toMatch(/added|dumbbells here/i);
    expect(record.detail.learned?.lines).toEqual(['Added 31 kg dumbbells']);
    expect(rowSets(await aggregate(s, sessionId), 'Dumbbell curl').every((x) => x.planned.load?.value === 31)).toBe(true);
    const now = await rack(s, gymId);
    expect(now?.kind === 'dumbbells' ? now.loads : []).toContain(31);
    const undo = await s.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result.status).toBe('written');
    const back = await rack(s, gymId);
    expect(back?.kind === 'dumbbells' ? back.loads : []).not.toContain(31);
    expect(rowSets(await aggregate(s, sessionId), 'Dumbbell curl').some((x) => x.planned.load?.value === 31)).toBe(false);
  });

  it('a barbell total the plates can’t make (71 kg rows): kept as typed, the gym learns the plate it needs', async () => {
    const { s, gymId, sessionId } = await liveRowsAndCurls();
    const before = await bar(s, gymId);
    if (before?.kind !== 'barbell') throw new Error('no bar');
    model = new StepModel([edit((w) => [{ op: 'set', setId: exOf(w, 'Barbell row').sets.find((x) => x.status === 'pending')?.setId ?? '', target: { load: kg(71), reps: null } }], 'make it 71 kg on rows'), () => replyWith('Done.')]);
    const r = await say(s, 'make it 71 kg on rows', { kind: 'today' });
    const record = r.cards[0]?.record;
    expect(record?.status).toBe('committed');
    expect(rowSets(await aggregate(s, sessionId), 'Barbell row')[0]?.planned.load).toEqual(kg(71));
    const after = await bar(s, gymId);
    const masses = (e: typeof after) => (e?.kind === 'barbell' ? e.plates.filter((p) => p.count > 0).map((p) => p.mass) : []);
    expect(masses(after).length).toBe(masses(before).length + 1);
    expect(record?.detail.kind === 'edit_today' ? record.detail.learned?.lines[0] : null).toMatch(/^Added 0\.5 kg plates$/);
  });

  it('nothing to learn when the gym already makes it: no learned edit', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    model = new StepModel([edit((w) => exOf(w, 'Dumbbell curl').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(30, 'per_hand'), reps: null } })), 'use 30 kg for curls'), () => replyWith('Done.')]);
    const r = await say(s, 'use 30 kg for curls', { kind: 'workout', sessionId });
    const record = r.cards[0]?.record;
    expect(record?.detail.kind === 'edit_today' ? record.detail.learned : 'x').toBeUndefined();
  });
});
