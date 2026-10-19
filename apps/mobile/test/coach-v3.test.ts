import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoOpId, type ModelEvent, type ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Coach v3, slice 1 (ADR 0027; Ben, 18 Oct, after build 156), through the app's services on
 * real SQLite with a scripted model:
 * - "Can't properly create based on constraints I give": a shoulder workout in his hotel gym,
 *   dumbbells only, then "make it 40". The draft is 40 min at the hotel gym, not 60 at Main gym.
 * - "Not adjusting during workout": `Too easy` after a warm-up, and "Working set" as the answer
 *   to the coach's question, change today's sets at once with Undo.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-18T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

interface BuildView {
  request: { quote: string; minutes: number; focus: string };
  gym: { name: string } | null;
  gyms?: string[];
  usable: { catalogueId: string; name: string; equipment: string }[];
}

function buildOf(req: ModelRequest | undefined): BuildView {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: BuildView };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}

const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 10, max: 12 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null });

/** The model builds dumbbell shoulder work from the usable list it was given, with its reading of length, focus and gym. */
const shoulders = (over: { minutes?: number | null; gymName?: string | null }) => (req: ModelRequest): ModelEvent[] => {
  const b = buildOf(req);
  const pick = (name: string) => b.usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_workout', { name: 'Shoulders', exercises: [ex(pick('Dumbbell shoulder press')), ex(pick('Lateral raise'))], message: 'Press first, then raises.', minutes: over.minutes ?? null, focus: 'shoulders', gymName: over.gymName ?? null });
};

async function twoGyms(): Promise<{ s: AppServices; mainId: string; hotelId: string }> {
  const { services: s } = await h.launch();
  const mainId = await setUpGym(h, s);
  const hotelId = h.ids();
  const saved = await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') });
  expect(saved).toEqual({ ok: true });
  expect((await s.yourData.currentGym())?.id).toBe(mainId);
  return { s, mainId, hotelId };
}

const say = (s: AppServices, text: string, threadId: string | null) => s.coach.send({ entry: { kind: 'today' }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const BEN_HOTEL = 'Can you make me a shoulder workout in my hotel gym, dumbbells only';

async function draftOf(s: AppServices, r: Awaited<ReturnType<typeof say>>) {
  const card = r.cards.find((c) => c.record.detail.kind === 'build_workout')?.record;
  if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error(`no draft: ${JSON.stringify(r.toolLog)}`);
  const d = await s.coachDrafts.get(card.detail.draftId);
  if (d === null) throw new Error('no stored draft');
  return { card: card.detail, draft: d };
}

describe('Ben’s report "Can’t properly create based on constraints I give" (build 156), reproduced', () => {
  it('a shoulder workout in his hotel gym, then "make it 40": a 40 min shoulder draft at the hotel gym', async () => {
    const { s, mainId, hotelId } = await twoGyms();
    model = new StepModel([shoulders({ gymName: 'Hotel gym' }), () => replyWith('Here it is.')]);
    const r1 = await say(s, BEN_HOTEL, null);
    // The context is the hotel gym's (his words named it), and lists his saved gyms.
    const b1 = buildOf(model.requests[0]);
    expect(b1.gym?.name).toBe('Hotel gym');
    expect(b1.gyms).toEqual(expect.arrayContaining(['Main Gym', 'Hotel gym']));
    expect(b1.usable.every((u) => !/barbell|cable|machine/i.test(u.equipment))).toBe(true);
    const first = await draftOf(s, r1);
    expect(first.card).toMatchObject({ gymName: 'Hotel gym' });
    expect(first.card.name.startsWith('Shoulders · ')).toBe(true);
    expect(first.draft.versions[0]?.request.gymId).toBe(hotelId);

    model = new StepModel([shoulders({ minutes: 40, gymName: 'Hotel gym' }), () => replyWith('Shorter now.')]);
    const r2 = await say(s, 'make it 40', r1.threadId);
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_workout');
    // "make it 40" names no gym; his earlier message in the thread did.
    expect(buildOf(model.requests[0]).gym?.name).toBe('Hotel gym');
    const second = await draftOf(s, r2);
    expect(second.card).toMatchObject({ name: 'Shoulders · 40 min', gymName: 'Hotel gym' });
    expect(second.draft.versions[0]).toMatchObject({ fitMinutes: 40, request: { minutes: 40, focus: 'shoulders', gymId: hotelId } });
    // The card shows the draft's own gym, whatever gym the sheet is on.
    const card = await s.coachDrafts.card({ draftId: second.draft.id, versionN: 1, gymId: mainId });
    expect(card).toMatchObject({ name: 'Shoulders · 40 min', gymName: 'Hotel gym' });
  });

  it('Ben’s literal number wins: the model says 45 on "make it 40", the draft is 40', async () => {
    const { s } = await twoGyms();
    model = new StepModel([shoulders({ gymName: 'Hotel gym' }), () => replyWith('Here it is.')]);
    const r1 = await say(s, BEN_HOTEL, null);
    model = new StepModel([shoulders({ minutes: 45, gymName: 'Hotel gym' }), () => replyWith('Shorter now.')]);
    const r2 = await say(s, 'make it 40', r1.threadId);
    expect((await draftOf(s, r2)).card.name).toBe('Shoulders · 40 min');
  });

  it('the model names a gym from the conversation that the context didn’t pick: the draft is checked at that gym', async () => {
    const { s, hotelId } = await twoGyms();
    model = new StepModel([shoulders({ minutes: 30, gymName: 'hotel' }), () => replyWith('Here it is.')]);
    const r = await say(s, 'Quick shoulder session please, I am travelling', null);
    // His words named no gym: the context is the gym in use.
    expect(buildOf(model.requests[0]).gym?.name).toBe('Main Gym');
    const d = await draftOf(s, r);
    expect(d.card).toMatchObject({ name: 'Shoulders · 30 min', gymName: 'Hotel gym' });
    expect(d.draft.versions[0]?.request.gymId).toBe(hotelId);
  });

  it('a gym he hasn’t saved is refused with his saved gyms; nothing is built', async () => {
    const { s } = await twoGyms();
    model = new StepModel([shoulders({ gymName: 'Airport gym' }), () => replyWith('Which gym?')]);
    const r = await say(s, BEN_HOTEL, null);
    expect(r.cards).toEqual([]);
    expect(r.toolLog.map((l) => [l.tool, l.outcome])).toEqual([['propose_workout', 'not_allowed']]);
    expect(r.toolLog[0]?.text).toContain('Saved gyms: "Main Gym", "Hotel gym"');
  });
});

/** Bench working sets logged, then an overhead-press warm-up logged last (Ben's build 156 workout). */
async function benchThenWarmup(): Promise<{ s: AppServices; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 2 * DAY;
  const started = await s.workout.start({ gymId, opId: 'start-v3', checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const add = async (name: string) => {
    const picks = await s.workout.pickerExercises(sessionId, name);
    const pick = picks.find((p) => p.exercise.name === name);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    return added.aggregate.exercises.at(-1)?.id ?? '';
  };
  const log = async (setId: string, load: number, reps: number, rpe: number) => {
    h.clockMs += 60_000;
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${setId}:0`, setId, values: { load: { value: load, unit: 'kg', convention: 'total' }, reps, durationS: null, rpe, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  };
  const bench = await add('Bench press');
  let agg = (await s.workout.load(sessionId))?.aggregate;
  const benchSet = agg?.sets.find((x) => x.sessionExerciseId === bench && x.status === 'pending');
  if (!benchSet) throw new Error('no bench set');
  await log(benchSet.id, 60, 10, 6);
  const press = await add('Overhead press');
  agg = (await s.workout.load(sessionId))?.aggregate;
  const warm = agg?.sets.find((x) => x.sessionExerciseId === press && x.status === 'pending')?.id ?? '';
  await log(warm, 40, 8, 5);
  // Marked as a warm-up, as Ben did on the set.
  const logged = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === warm);
  const r = await s.workout.dispatch(sessionId, { type: 'correct_set', at: h.now(), opId: h.ids(), setId: warm, expectedSetVersion: logged?.version ?? 1, patch: { setType: 'warmup' } });
  if (!r.ok) throw new Error(r.error.message);
  agg = (await s.workout.load(sessionId))?.aggregate;
  expect(agg?.sets.find((x) => x.id === warm)?.setType).toBe('warmup');
  return { s, sessionId };
}

interface Logged {
  exercise: string;
  kind: string;
  load: { value: number } | null;
  reps: number | null;
  rpe: number | null;
}

function lastOf(req: ModelRequest | undefined): { lastLogged: Logged | null; lastWorkingSet: Logged | null } {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: { lastLogged: Logged | null; lastWorkingSet: Logged | null } }).workout;
}

/** The model raises the pending sets of the exercise of the last working set it was told about, by 2.5 kg. */
const raiseLastWorking = (claim: Record<string, unknown> = {}) => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const name = lastOf(req).lastWorkingSet?.exercise;
  const ex = w.exercises.find((e) => e.name === name);
  const pending = ex?.sets.filter((x) => x.status === 'pending') ?? [];
  const heavier = { value: (pending[0]?.target.load?.value ?? 60) + 2.5, unit: 'kg', convention: 'total' };
  return toolCall('edit_today', { baseVersion: w.version, ops: pending.map((x) => ({ op: 'set', setId: x.setId, target: { load: heavier, reps: null } })), reason: 'Easy at RPE 6.', ...claim });
};

const pendingOf = async (s: AppServices, sessionId: string, exercise: string) => {
  const agg = (await s.workout.load(sessionId))?.aggregate;
  const row = agg?.exercises.find((e) => e.exerciseName === exercise);
  return (agg?.sets ?? []).filter((x) => x.sessionExerciseId === row?.id && x.status === 'pending').map((x) => x.planned.load?.value ?? null);
};

describe('Ben’s report "Not adjusting during workout" (build 156), reproduced', () => {
  it('the coach knows the last logged set (overhead-press warm-up) and the last working set (bench), with load, reps and RPE', async () => {
    const { s, sessionId } = await benchThenWarmup();
    model = new StepModel([() => replyWith('Bench looked easy.')]);
    await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'How was that?', spoken: false }, turnId: h.ids() });
    const last = lastOf(model.requests[0]);
    expect(last.lastLogged).toMatchObject({ exercise: 'Overhead press', kind: 'warm-up', load: { value: 40 }, reps: 8, rpe: 5 });
    expect(last.lastWorkingSet).toMatchObject({ exercise: 'Bench press', kind: 'working', load: { value: 60 }, reps: 10, rpe: 6 });
  });

  it('Too easy after the warm-up: the change is to bench, applied at once, and Undo puts it back', async () => {
    const { s, sessionId } = await benchThenWarmup();
    const before = await pendingOf(s, sessionId, 'Bench press');
    model = new StepModel([raiseLastWorking(), () => replyWith('Bench up a step.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_easy' }, turnId: h.ids() });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    const after = await pendingOf(s, sessionId, 'Bench press');
    expect(after).not.toEqual(before);
    const actionId = r.cards[0]?.record.actionId ?? '';
    expect((await s.coach.undo(actionId, undoOpId(actionId))).result.status).toBe('written');
    expect(await pendingOf(s, sessionId, 'Bench press')).toEqual(before);
  });

  it('"Working set" answering the coach’s question counts as asking: it applies at once with Undo', async () => {
    const { s, sessionId } = await benchThenWarmup();
    const before = await pendingOf(s, sessionId, 'Bench press');
    model = new StepModel([() => replyWith('Was that about the 40 kg overhead-press warm-up, or a working set?')]);
    const r1 = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'Too easy', spoken: false }, turnId: h.ids() });
    model = new StepModel([raiseLastWorking({ benAsked: true, benQuote: 'Working set' }), () => replyWith('Bench up a step.')]);
    const r2 = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: r1.threadId, input: { kind: 'words', text: 'Working set', spoken: false }, turnId: h.ids() });
    expect(r2.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r2.offer).toBeNull();
    expect(await pendingOf(s, sessionId, 'Bench press')).not.toEqual(before);
    const actionId = r2.cards[0]?.record.actionId ?? '';
    expect((await s.coach.undo(actionId, undoOpId(actionId))).result.status).toBe('written');
    expect(await pendingOf(s, sessionId, 'Bench press')).toEqual(before);
  });

  it('on every live turn the edit tool comes with the list of what can be added, whatever the words', async () => {
    const { s, sessionId } = await benchThenWarmup();
    model = new StepModel([() => replyWith('Sure.')]);
    await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'Anything else worth doing for shoulders?', spoken: false }, turnId: h.ids() });
    // Coach v3 slice 2: one tool, edit_today, adds as well as changing sets.
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('edit_today');
    const block = model.requests[0]?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    const addable = block?.type === 'message' ? (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { addable?: unknown[] }).addable : undefined;
    expect(addable?.length).toBeGreaterThan(0);
    expect(addable?.length).toBeLessThanOrEqual(60);
  });
});
