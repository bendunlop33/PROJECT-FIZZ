import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';

import { cardView } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (12 Oct) Ben: "Why can't the ChatGPT link create sets in the app?" The
 * coach's `add_exercise_today`: "add 3 sets of lateral raises" adds a new
 * exercise to today's workout through the workout's own `add_exercise`
 * command, loads from Ben's history on this gym's equipment (blank with no
 * history, B6), applied at once with a card and one-tap Undo (rule 3), never
 * touching done sets (rule 2), versioned (rule 5). Real SQLite, scripted model.
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

/** Bench and lateral raises done two days ago; today's workout is bench only. */
async function benchWorkout(): Promise<{ s: AppServices; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }, { load: 10, reps: 12 }, { load: 10, reps: 12 }] },
  ]);
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

const say = (s: AppServices, sessionId: string, text: string, turnId = h.ids()) => s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId });

interface Addable {
  exerciseId: string;
  name: string;
}

function contextAddable(req: ModelRequest): Addable[] | undefined {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { addable?: Addable[] }).addable;
}

/** The model adds the named exercise from `addable`, with the workout version it read. */
const addFromContext = (name: string, over: Record<string, unknown> = {}) => (req: ModelRequest) => {
  const w = contextWorkout(req);
  const pick = contextAddable(req)?.find((a) => a.name === name);
  return toolCall('add_exercise_today', {
    baseVersion: w.version,
    exerciseId: pick?.exerciseId ?? 'missing',
    workingSets: 3,
    reps: { min: 10, max: 15 },
    workSeconds: null,
    targetRpe: 8,
    afterSessionExerciseId: null,
    supersetWithSessionExerciseId: null,
    reason: 'Ben asked for shoulders.',
    ...over,
  });
};

async function rowsOf(s: AppServices, sessionId: string) {
  const d = await s.workout.load(sessionId);
  const a = d?.aggregate;
  if (!a) throw new Error('no workout');
  return a.exercises.filter((e) => e.removed === undefined).map((e) => ({ row: e, sets: a.sets.filter((x) => x.sessionExerciseId === e.id && x.status !== 'deleted') }));
}

const plain = (t: string) => t.replaceAll(String.fromCharCode(160), ' ');

describe('add an exercise from chat', () => {
  it('"Add 3 sets of lateral raises": the tool is offered with what can be added here; the exercise is added with loads from history, a card with Undo; Undo takes it out', async () => {
    const { s, sessionId } = await benchWorkout();
    const before = await rowsOf(s, sessionId);
    model = new StepModel([addFromContext('Lateral raise'), () => replyWith('Go light on the first one.')]);
    const r = await say(s, sessionId, 'Add 3 sets of lateral raises');
    expect(r.status).toBe('completed');
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toEqual(expect.arrayContaining(['add_exercise_today', 'adjust_pending_sets']));
    const addable = contextAddable(model.requests[0] as ModelRequest) ?? [];
    expect(addable.some((a) => a.name === 'Lateral raise')).toBe(true);
    // Already in today's workout: not offered as an add.
    expect(addable.some((a) => a.name === 'Bench press')).toBe(false);

    const record = r.cards[0]?.record;
    expect(record).toMatchObject({ status: 'committed', detail: { kind: 'add_exercise_today', exerciseName: 'Lateral raise', sets: 3 } });
    if (!record) throw new Error('no card');
    const card = cardView(record);
    expect(card).toMatchObject({ status: { word: 'Added' }, canUndo: true });
    expect(plain(card.text)).toBe('Added Lateral raise: 3 × 10 kg each × 10–15 @ RPE 8.');
    expect(r.note).toBeNull();

    const after = await rowsOf(s, sessionId);
    const raise = after.find((x) => x.row.exerciseName === 'Lateral raise');
    expect(raise?.row.loadConvention).toBe('per_hand');
    expect(raise?.sets).toHaveLength(3);
    for (const set of raise?.sets ?? []) expect(set).toMatchObject({ status: 'pending', planned: { load: { value: 10, unit: 'kg', convention: 'per_hand' }, reps: { min: 10, max: 15 }, rpe: 8, source: 'coach' } });
    // Bench is exactly as it was.
    expect(after.find((x) => x.row.exerciseName === 'Bench press')).toEqual(before.find((x) => x.row.exerciseName === 'Bench press'));

    const undo = await s.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect(plain(cardView(undo.undo).text)).toBe('Undone: adding Lateral raise.');
    expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);
    // A double tap undoes once.
    expect((await s.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('replayed');
  });

  it('no history on that equipment: the load is blank (B6), never a guess', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([addFromContext('Cable curl', { reps: { min: 12, max: 15 }, targetRpe: null }), () => replyWith('Pick a weight you can do 15 with.')]);
    const r = await say(s, sessionId, 'Put in some cable curls');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('add_exercise_today');
    expect(r.cards[0]?.record).toMatchObject({ status: 'committed', detail: { kind: 'add_exercise_today', exerciseName: 'Cable curl', target: { load: null, reps: { min: 12, max: 15 } } } });
    const curl = (await rowsOf(s, sessionId)).find((x) => x.row.exerciseName === 'Cable curl');
    expect(curl?.sets.every((x) => x.planned.load === null)).toBe(true);
  });

  it('a reply with no tool call to an add request shows "No change made."; a question never gets the tool', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([() => replyWith('Curls are a good shout at the end.')]);
    const r = await say(s, sessionId, 'Put in some curls');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('add_exercise_today');
    expect(r.cards).toEqual([]);
    expect(r.note).toBe('No change made.');
    expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);

    model = new StepModel([() => replyWith('They would help.')]);
    const q = await say(s, sessionId, 'Should I add curls?');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('add_exercise_today');
    expect(contextAddable(model.requests[0] as ModelRequest)).toBeUndefined();
    expect(q.note).toBeNull();
  });

  it('a stale version is refused and nothing is added (rule 5); a replayed turn adds nothing twice', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([(req) => addFromContext('Lateral raise', { baseVersion: contextWorkout(req).version - 1 })(req), () => replyWith('Ok.')]);
    const st = await say(s, sessionId, 'add lateral raises');
    expect(st.cards[0]?.record.status).toBe('stale');
    expect(plain(cardView(st.cards[0]?.record ?? (undefined as never)).text)).toBe('Not added: your workout moved on.');
    expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);

    const turnId = h.ids();
    model = new StepModel([addFromContext('Lateral raise'), () => replyWith('Ok.')]);
    const first = await say(s, sessionId, 'add lateral raises', turnId);
    expect(first.cards[0]?.record.status).toBe('committed');
    const again = await say(s, sessionId, 'add lateral raises', turnId);
    expect(again.replayed).toBe(true);
    expect((await rowsOf(s, sessionId)).filter((x) => x.row.exerciseName === 'Lateral raise')).toHaveLength(1);
  });

  it('survives a force-close; after Ben logs a set on it, Undo is refused and the logged set stays (rule 2)', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([addFromContext('Lateral raise'), () => replyWith('Ok.')]);
    const r = await say(s, sessionId, 'add 3 sets of lateral raises');
    const record = r.cards[0]?.record;
    if (record?.status !== 'committed') throw new Error('not added');

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const raise = (await rowsOf(s2, sessionId)).find((x) => x.row.exerciseName === 'Lateral raise');
    expect(raise?.sets).toHaveLength(3);
    const first = raise?.sets.sort((a, b) => a.index - b.index)[0];
    if (!first) throw new Error('no set');
    h.clockMs += 120_000;
    const logged = await s2.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-raise', setId: first.id, values: { load: first.planned.load, reps: 12, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    const undo = await s2.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result).toMatchObject({ status: 'not_possible', reason: 'changed_since' });
    const still = (await rowsOf(s2, sessionId)).find((x) => x.row.exerciseName === 'Lateral raise');
    expect(still?.sets.find((x) => x.id === first.id)?.status).toBe('completed');
  });

  it('Undo works after a force-close too', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([addFromContext('Lateral raise'), () => replyWith('Ok.')]);
    const record = (await say(s, sessionId, 'add lateral raises')).cards[0]?.record;
    if (record?.status !== 'committed') throw new Error('not added');
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('written');
    expect((await rowsOf(s2, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);
  });
  it('two adds in one turn (review S1): the first returns the new version and row; the second uses them and both are added', async () => {
    const { s, sessionId } = await benchWorkout();
    const lastOutput = (req: ModelRequest): Record<string, unknown> => {
      const out = [...req.input].reverse().find((i) => i.type === 'function_call_output');
      if (out?.type !== 'function_call_output') throw new Error('no tool output');
      return JSON.parse(out.output) as Record<string, unknown>;
    };
    let firstOut: Record<string, unknown> = {};
    model = new StepModel([
      addFromContext('Lateral raise'),
      (req) => {
        firstOut = lastOutput(req);
        return addFromContext('Cable curl', { baseVersion: firstOut.sessionVersion, supersetWithSessionExerciseId: firstOut.sessionExerciseId })(req);
      },
      () => replyWith('Both in.'),
    ]);
    const r = await say(s, sessionId, 'add lateral raises and curls');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed', 'committed']);
    const rows = await rowsOf(s, sessionId);
    const raise = rows.find((x) => x.row.exerciseName === 'Lateral raise');
    expect(firstOut).toMatchObject({ status: 'committed', sessionExerciseId: raise?.row.id });
    const d = await s.workout.load(sessionId);
    expect(typeof firstOut.sessionVersion).toBe('number');
    expect(firstOut.sessionVersion).toBeLessThan(d?.aggregate.session.version ?? 0);
    expect(rows.map((x) => x.row.exerciseName)).toEqual(expect.arrayContaining(['Bench press', 'Lateral raise', 'Cable curl']));
    const curl = rows.find((x) => x.row.exerciseName === 'Cable curl');
    expect(curl?.row.supersetGroup ?? null).not.toBeNull();
    expect(curl?.row.supersetGroup).toBe(raise?.row.supersetGroup);
  });

  it('a next-time add (review B2) never offers or commits today’s add; it opens the proposal tool instead', async () => {
    const { s, sessionId } = await benchWorkout();
    for (const text of ['add curls next time', 'can you add lateral raises to my routine', 'add face pulls from now on']) {
      model = new StepModel([addFromContext('Lateral raise'), () => replyWith('Ok.')]);
      const r = await say(s, sessionId, text);
      const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
      expect(tools).not.toContain('add_exercise_today');
      expect(tools).toContain('propose_next_workout_change');
      expect(r.cards.some((c) => c.record.detail.kind === 'add_exercise_today' && c.record.status === 'committed')).toBe(false);
      expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);
    }
  });
  it('a plain today add (review r3 S1) never offers the proposal tool: a proposal-only reply is refused, nothing changes, and Ben sees "No change made."', async () => {
    const { s, sessionId } = await benchWorkout();
    model = new StepModel([
      (req) => toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: contextWorkout(req).version, changes: [{ change: 'remove', exerciseId: 'bench' }], reason: 'Make room for curls.' }),
      () => replyWith('Curls would fit at the end.'),
    ]);
    const r = await say(s, sessionId, 'put in some curls');
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toContain('add_exercise_today');
    expect(tools).not.toContain('propose_next_workout_change');
    expect(r.cards).toEqual([]);
    expect(r.note).toBe('No change made.');
    expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Bench press']);

    // An unclear scope ("to the plan") offers both; the model picks.
    model = new StepModel([() => replyWith('Ok.')]);
    await say(s, sessionId, 'add curls to the plan');
    expect(model.requests[0]?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['add_exercise_today', 'propose_next_workout_change']));
  });

  it('a refused or stale add saves no exercise row (review S3); the committed add saves it with the add', async () => {
    const { s, sessionId } = await benchWorkout();
    const savedCurl = async () => (await s.coachingKnowledge.exercises()).some((e) => e.name === 'Cable curl');
    expect(await savedCurl()).toBe(false);
    model = new StepModel([(req) => addFromContext('Cable curl', { baseVersion: contextWorkout(req).version - 1 })(req), () => replyWith('Ok.')]);
    expect((await say(s, sessionId, 'put in some cable curls')).cards[0]?.record.status).toBe('stale');
    expect(await savedCurl()).toBe(false);
    model = new StepModel([addFromContext('Cable curl', { afterSessionExerciseId: '00000000-0000-4000-8000-0000000000aa' }), () => replyWith('Ok.')]);
    expect((await say(s, sessionId, 'put in some cable curls')).cards[0]?.record.status).toBe('rejected');
    expect(await savedCurl()).toBe(false);
    model = new StepModel([addFromContext('Cable curl'), () => replyWith('Ok.')]);
    expect((await say(s, sessionId, 'put in some cable curls')).cards[0]?.record.status).toBe('committed');
    expect(await savedCurl()).toBe(true);
    const rows = await rowsOf(s, sessionId);
    expect(rows.map((x) => x.row.exerciseName)).toContain('Cable curl');
  });

  it('a FitNotes custom "Lateral Raise" in today’s workout (review S2): the catalogue lateral raise is not addable, and adding it is refused', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // FitNotes history with Ben's own "Lateral Raise", answered as a new exercise (a custom row, its own ID).
    const csv = ['Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time', '2026-09-20,Lateral Raise,Shoulders,10.0,12,,,'].join('\n');
    const opened = await s.imports.open({ name: 'FitNotes_Export_synthetic.csv', text: csv });
    if (opened.kind !== 'preview') throw new Error(opened.kind);
    let draft = opened.draft;
    for (const n of draft.analysis.names) {
      const r = await s.imports.answer(draft.draftId, draft.mappingVersion, { kind: 'name', key: n.key, answer: { kind: 'new', equipment: 'dumbbells' } });
      if (!r.ok) throw new Error(r.reason);
      draft = r.draft;
    }
    for (const e of draft.analysis.perHand?.exercises ?? []) {
      if (e.reading !== null) continue;
      const r = await s.imports.answer(draft.draftId, draft.mappingVersion, { kind: 'per_hand_override', key: e.key, answer: 'one' });
      if (!r.ok) throw new Error(r.reason);
      draft = r.draft;
    }
    if (draft.analysis.total?.open) {
      const r = await s.imports.answer(draft.draftId, draft.mappingVersion, { kind: 'total', answer: 'total' });
      if (!r.ok) throw new Error(r.reason);
      draft = r.draft;
    }
    const committed = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-1');
    if (!committed.ok) throw new Error(committed.reason);
    const custom = (await s.coachingKnowledge.exercises()).find((e) => e.name === 'Lateral Raise' && e.source === 'custom');
    if (!custom) throw new Error('no custom exercise');

    const started = await s.workout.start({ gymId, opId: 'start-custom', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const picks = await s.workout.pickerExercises(sessionId, 'Lateral Raise');
    const pick = picks.find((p) => p.exercise.id === custom.id);
    const added = await s.workout.addExercise({ sessionId, exerciseId: custom.id, equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-custom' });
    if (!added.ok) throw new Error(added.error.message);

    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        return toolCall('add_exercise_today', { baseVersion: w.version, exerciseId: 'dumbbell-lateral-raise', workingSets: 3, reps: { min: 10, max: 15 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, reason: 'Ben asked.' });
      },
      () => replyWith('Ok.'),
    ]);
    const r = await say(s, sessionId, 'add 3 sets of lateral raises');
    const addable = contextAddable(model.requests[0] as ModelRequest) ?? [];
    expect(addable.some((a) => /lateral raise/i.test(a.name) && !/cable/i.test(a.name))).toBe(false);
    expect(r.cards[0]?.record).toMatchObject({ status: 'rejected', failure: 'it’s already in today’s workout' });
    expect((await rowsOf(s, sessionId)).map((x) => x.row.exerciseName)).toEqual(['Lateral Raise']);
  });
});
