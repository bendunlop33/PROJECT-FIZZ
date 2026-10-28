import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall, type ContextWorkout } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * ADR 0038 (Ben, 28 Oct: "It fails to make the changes I want. It gets very caught up in whether I have
 * equipment or barbells etc. Just doesn't work as you'd expect."). Through the app's services on real
 * SQLite with a scripted model:
 * - "give me a workout which builds up to 95 kg barbell row as the last set (with sets and weights)",
 *   from Today and mid-workout: the last set is exactly 95 kg, the ramp is achievable and lower, no question.
 * - From Today's coach while a workout is live: "add a set to rows", "use 30 kg for curls", a paraphrased
 *   swap: applied at once, with Undo.
 * - An exercise with no equipment row keeps its load; an exercise the gym's profile lacks is added, the gym
 *   learns it and today's kit is refreshed; a machine's max caps his weight with one line; pain blocks.
 * - The coach raising a change itself is still an offer.
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

describe('"builds up to 95 kg barbell row as the last set" (Ben, 28 Oct)', () => {
  it('from Today: the draft’s last row set is exactly 95 kg (above the 20% ceiling on his 70), with lighter warm-ups at Start; no question asked', async () => {
    const { s, gymId } = await ben();
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 70, reps: 8, rpe: 8 }, { load: 70, reps: 8, rpe: 8 }] }]);
    h.clockMs += 2 * DAY;
    model = new StepModel([
      (req) => {
        const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
        const data = block?.type === 'message' ? (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }) : null;
        const row = data?.build.usable.find((u) => u.name === 'Barbell row')?.catalogueId ?? 'missing';
        return toolCall('propose_workout', {
          name: 'Rows',
          exercises: [{ catalogueId: row, warmups: null, workingSets: 1, reps: { min: 3, max: 3 }, workSeconds: null, targetRpe: 9, topSet: null, restSeconds: null, superset: null, load: { value: 95, unit: 'kg', convention: 'total', basis: 'his top set', from: 'own_history', relatedCatalogueId: null } }],
          message: 'Ramp up, then the heavy set.',
        });
      },
      () => replyWith('Here it is.'),
    ]);
    const r = await say(s, BEN_95, { kind: 'today' });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_workout');
    expect(model.requests[0]?.instructions).toContain('A weight, reps or sets Ben names are used exactly');
    expect(r.toolLog.map((l) => l.tool)).not.toContain('ask_build_question');
    const card = r.cards.find((c) => c.record.detail.kind === 'build_workout')?.record;
    if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error(`no draft: ${JSON.stringify(r.toolLog)}`);
    const p: OverviewData | null = await s.overview.load({ target: { kind: 'coach_draft', draftId: card.detail.draftId }, gymId });
    if (p === null) throw new Error('no overview');
    const started = await s.overview.start({ startOf: p.startOf, gymId, opId: 'start-95', checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: p.view.previewKey, draft: p.draft === null ? null : { id: p.draft.id, expectedVersion: p.draft.version } });
    if (!started.ok) throw new Error(started.error.message);
    const sets = rowSets(started.aggregate, 'Barbell row');
    expect(sets.at(-1)?.planned.load).toEqual(kg(95));
    const ramp = sets.slice(0, -1);
    expect(ramp.length).toBeGreaterThan(0);
    for (const x of ramp) expect(x.planned.load?.value ?? 0).toBeLessThan(95);
  });

  it('mid-workout: the coach lays out the sets; the last is exactly 95, the ramp is achievable and lower; Undo puts them back', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    const before = rowSets(await aggregate(s, sessionId), 'Barbell row').map((x) => x.planned.load);
    model = new StepModel([edit((w) => [{ op: 'sets', sessionExerciseId: exOf(w, 'Barbell row').sessionExerciseId, sets: [target(61, 5), target(73, 3), target(84, 2), target(95, 1)] }], 'builds up to 95 kg'), () => replyWith('Go.')]);
    const r = await say(s, BEN_95, { kind: 'workout', sessionId });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('edit_today');
    const record = r.cards[0]?.record;
    expect(record?.status).toBe('committed');
    const sets = rowSets(await aggregate(s, sessionId), 'Barbell row');
    expect(sets.map((x) => x.planned.load?.value)).toEqual([60, 72.5, 85, 95]);
    if (record === undefined) throw new Error('no card');
    const undo = await s.coach.undo(record.actionId, `undo:${record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect(rowSets(await aggregate(s, sessionId), 'Barbell row').map((x) => x.planned.load)).toEqual(before);
  });
});

describe('from Today’s coach while a workout is live: the same tools, applied at once with Undo', () => {
  it('"add a set to rows": applied, with Undo; the thread stays Today’s', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    const n = rowSets(await aggregate(s, sessionId), 'Barbell row').length;
    model = new StepModel([edit((w) => [{ op: 'set_count', sessionExerciseId: exOf(w, 'Barbell row').sessionExerciseId, workingSets: n + 1 }], 'add a set to rows'), () => replyWith('Done.')]);
    const r = await say(s, 'add a set to rows', { kind: 'today' });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('edit_today');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(rowSets(await aggregate(s, sessionId), 'Barbell row')).toHaveLength(n + 1);
    const record = r.cards[0]?.record;
    if (record === undefined) throw new Error('no card');
    expect((await s.coach.undo(record.actionId, `undo:${record.actionId}`)).result.status).toBe('written');
    expect(rowSets(await aggregate(s, sessionId), 'Barbell row')).toHaveLength(n);
    expect((await s.coach.listThreads()).find((t) => t.id === r.threadId)?.sessionId).toBeNull();
  });

  it('"use 30 kg for curls": exactly 30 each, applied at once with Undo', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    model = new StepModel([edit((w) => exOf(w, 'Dumbbell curl').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(30, 'per_hand'), reps: null } })), 'use 30 kg for curls'), () => replyWith('Done.')]);
    const r = await say(s, 'use 30 kg for curls', { kind: 'today' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(rowSets(await aggregate(s, sessionId), 'Dumbbell curl').map((x) => x.planned.load)).toEqual(rowSets(await aggregate(s, sessionId), 'Dumbbell curl').map(() => kg(30, 'per_hand')));
  });

  it('a paraphrased swap is applied', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    model = new StepModel([edit((w) => [{ op: 'swap', sessionExerciseId: exOf(w, 'Dumbbell curl').sessionExerciseId, toExerciseId: 'dumbbell-hammer-curl' }], 'swap curls for hammer curls'), () => replyWith('Hammers it is.')]);
    const r = await say(s, 'can we do something else instead of the curls', { kind: 'today' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    const names = (await aggregate(s, sessionId)).exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseName);
    expect(names).toContain('Hammer curl');
  });

  it('the coach raising a change itself is still an offer, not applied', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    const before = (await aggregate(s, sessionId)).session.version;
    model = new StepModel([edit((w) => exOf(w, 'Dumbbell curl').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(15, 'per_hand'), reps: null } })), 'curls felt easy'), () => replyWith('Want me to go up?')]);
    const r = await say(s, 'Curls felt easy last week, good to see', { kind: 'today' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await aggregate(s, sessionId)).session.version).toBe(before);
  });
});

describe('kit and limits are handled quietly', () => {
  it('an imported exercise with no equipment row keeps the load as given', async () => {
    const { s, gymId } = await ben();
    const started = await s.workout.start({ gymId, opId: 'start-noeq', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    await addRow(s, sessionId, 'Barbell row', 'none');
    model = new StepModel([edit((w) => exOf(w, 'Barbell row').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(67.3), reps: null } })), 'make rows heavier'), () => replyWith('Done.')]);
    const r = await say(s, 'make rows a bit heavier please', { kind: 'workout', sessionId });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    for (const x of rowSets(await aggregate(s, sessionId), 'Barbell row')) expect(x.planned.load).toEqual(kg(67.3));
  });

  it('an exercise not in the gym’s profile is added, the gym learns it and today’s kit is refreshed; never a question', async () => {
    const { s, gymId } = await ben('home_dumbbells');
    const started = await s.workout.start({ gymId, opId: 'start-home', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    await addRow(s, sessionId, 'Dumbbell curl');
    expect((await aggregate(s, sessionId)).session.equipmentSnapshot.some((e) => e.kind === 'weight_stack')).toBe(false);
    model = new StepModel([edit(() => [{ op: 'add', exerciseId: 'cable-curl', workingSets: 3, reps: { min: 10, max: 12 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load: null }], 'add cable curls'), () => replyWith('Added.')]);
    const r = await say(s, 'add 3 sets of cable curls', { kind: 'workout', sessionId });
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['update_gym', 'committed'], ['edit_today', 'committed']]);
    const a = await aggregate(s, sessionId);
    expect(a.session.equipmentSnapshot.some((e) => e.kind === 'weight_stack')).toBe(true);
    const curl = a.exercises.find((e) => e.exerciseName === 'Cable curl');
    expect(curl?.equipmentId).not.toBeNull();
    expect((await s.gyms.detail(gymId))?.equipment.some((e) => e.equipment.kind === 'weight_stack')).toBe(true);
    const fed = model.requests[1]?.input.flatMap((i) => (i.type === 'function_call_output' ? [i.output] : [])).join('\n') ?? '';
    expect(fed).not.toMatch(/update_gym\?|in its profile/);
  });

  it('update_gym (Ben said it) during a live workout refreshes today’s kit, so the next add has its item', async () => {
    const { s, gymId } = await ben('home_dumbbells');
    const started = await s.workout.start({ gymId, opId: 'start-home-2', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    await addRow(s, sessionId, 'Dumbbell curl');
    model = new StepModel([() => toolCall('update_gym', { gymName: null, changes: [{ op: 'add', equipment: 'weight_stack' }], reason: 'Ben said so.', benAsked: true, benQuote: 'this gym has a cable station' }), () => replyWith('Noted.')]);
    const r = await say(s, 'this gym has a cable station', { kind: 'today' });
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['update_gym', 'committed']]);
    expect((await aggregate(s, sessionId)).session.equipmentSnapshot.some((e) => e.kind === 'weight_stack')).toBe(true);
  });

  it('a machine’s max is never exceeded: his weight is capped there, with one line', async () => {
    const { s, gymId } = await ben();
    const started = await s.workout.start({ gymId, opId: 'start-max', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    await addRow(s, sessionId, 'Leg extension');
    model = new StepModel([edit((w) => exOf(w, 'Leg extension').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(400, 'stack'), reps: null } })), 'put leg extensions on 400'), () => replyWith('Done.')]);
    const r = await say(s, 'put leg extensions on 400 kg', { kind: 'workout', sessionId });
    const record = r.cards[0]?.record;
    expect(record?.status).toBe('committed');
    const capped = record?.guardNotes.filter((n) => n.kind === 'capped') ?? [];
    expect(capped).toHaveLength(1);
    const loads = rowSets(await aggregate(s, sessionId), 'Leg extension').map((x) => x.planned.load?.value ?? 0);
    for (const v of loads) expect(v).toBeLessThan(400);
  });

  it('pain: a heavier weight he names on a flagged movement is blocked, with one line', async () => {
    const { s, sessionId } = await liveRowsAndCurls();
    const curl = (await aggregate(s, sessionId)).exercises.find((e) => e.exerciseName === 'Dumbbell curl');
    const flagged = await s.pain.flagMovement({ exerciseId: curl?.exerciseId ?? '', exerciseName: 'Dumbbell curl', opId: h.ids() });
    expect(flagged).toBeTruthy();
    const before = rowSets(await aggregate(s, sessionId), 'Dumbbell curl').map((x) => x.planned.load);
    model = new StepModel([edit((w) => exOf(w, 'Dumbbell curl').sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: kg(30, 'per_hand'), reps: null } })), 'use 30 kg for curls'), () => replyWith('Holding them.')]);
    const r = await say(s, 'use 30 kg for curls', { kind: 'workout', sessionId });
    expect(r.cards.map((c) => c.record.status)).toEqual(['rejected']);
    expect(r.cards[0]?.record.failure ?? '').toMatch(/pain/);
    expect(rowSets(await aggregate(s, sessionId), 'Dumbbell curl').map((x) => x.planned.load)).toEqual(before);
  });
});

describe('plans', () => {
  it('"change my plan to 4 days" with no plan in use goes to the plan builder (propose_plan, forced), never "no plan tool"', async () => {
    const { s } = await ben();
    model = new StepModel([() => replyWith('Here is a plan.'), () => replyWith('Here is a plan.'), () => replyWith('Here is a plan.')]);
    await say(s, 'change my plan to 4 days', { kind: 'today' });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan');
    // A text answer is held and the plan tool named (as a build is forced).
    const forced = model.requests.find((r) => typeof r.toolChoice === 'object');
    expect(forced?.toolChoice).toEqual({ type: 'function', name: 'propose_plan' });
  });
});
