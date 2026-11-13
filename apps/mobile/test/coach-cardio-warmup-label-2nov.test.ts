import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, toMs } from '@fizz/domain';
import type { ActionRecord, Routine } from '@fizz/schemas';

import { workoutView } from '../src/builder/builder-view';
import { planSwapLines } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { buildRounds } from '../src/workout/rounds';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov) Real SQLite, the scripted model. When Ben asks for cardio *as a warm-up* ("bike 8 min first on leg
 * days, row 4 min first on the others as a warm-up"), the added cardio is marked `Warm-up`: "yes if i ask for it. to
 * be clear the warm-up could be any cardio exercise". The mark is a row mark (its sets stay working sets, so Start
 * keeps the row): plan day → Your workout → Start → the live workout → finish → history. Apply sets it, Undo takes it
 * away. Without "warm-up" in his words the coach's flag is dropped; a lift is never marked this way.
 */

const BIKE = catalogueExerciseId('exercise-bike');
const ROWER = catalogueExerciseId('rowing-erg');
const TREADMILL = catalogueExerciseId('treadmill-run');
const LEG_DAYS = ['Legs A', 'Legs B'];
const OTHER_DAYS = ['Push A', 'Pull A', 'Upper B'];
const ASK = 'Bike 8 min first on leg days, row 4 min first on the others, as a warm-up';

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-02T08:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

/** Ben's five-day plan (Push A, Pull A, Legs A, Upper B, Legs B), as in coach-cardio-first-2nov. */
async function bensPlan(s: AppServices): Promise<Map<string, string>> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 5, schedule: 'set' as const, days: [0, 1, 2, 3, 4] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const names: Record<string, string> = { Legs: 'Legs A', 'Push B': 'Upper B', 'Pull B': 'Legs B' };
  for (const d of (await s.plans.active())?.days ?? []) {
    const to = names[d.name];
    if (to === undefined) continue;
    const t = await template(s, d.routineId);
    const r = await s.routines.rename({ routineId: d.routineId, name: to, expectedVersion: t.version, opId: h.ids() });
    if (!r.ok) throw new Error(`rename ${d.name}`);
  }
  return new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
}

const first = (r: Routine) => [...r.exercises].sort((a, b) => a.order - b.order)[0];

const CALL = {
  add: 'exercise-bike',
  days: LEG_DAYS,
  after: null,
  workingSets: 1,
  reps: null,
  load: null,
  position: 'first',
  before: null,
  minutes: 8,
  distanceM: null,
  warmup: true,
  also: [{ add: 'rowing-erg', days: OTHER_DAYS, position: 'first', before: null, after: null, workingSets: 1, reps: null, minutes: 4, distanceM: null, warmup: true }],
  notIncluded: null,
  reason: 'Cardio warm-up first: bike on leg days, rower on the rest.',
};

async function ask(s: AppServices, text: string, call: object): Promise<ActionRecord> {
  model = new StepModel([() => toolCall('propose_plan_add', call), () => replyWith('Here it is for your plan.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
  expect(r.status).toBe('completed');
  const rec = r.cards[0]?.record;
  if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
  return rec;
}

describe('Ben asks for cardio as a warm-up: the rows are marked Warm-up from the plan to history', () => {
  it('card says warm-up; Apply marks the rows; plan day, Your workout and the live workout show Warm-up; history keeps it; Undo removes it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await bensPlan(s);
    const rec = await ask(s, ASK, CALL);
    expect(rec.status).toBe('proposed');
    // The tool description and the routing line tell the coach when to set it (any cardio, only when asked).
    expect(JSON.stringify(model.requests[0]?.tools.find((t) => t.name === 'propose_plan_add'))).toContain('warmup');
    expect(planSwapLines(rec)).toEqual({
      head: '+ Exercise bike · 8 min, Rowing machine · 4 min',
      days: [...LEG_DAYS.map((d) => `${d}: Exercise bike · 8 min, first, warm-up`), ...OTHER_DAYS.map((d) => `${d}: Rowing machine · 4 min, first, warm-up`)],
    });

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const legsId = days.get('Legs A') ?? '';
    for (const [name, id] of days) {
      const head = first(await template(s, id));
      expect(head?.exerciseId, name).toBe(LEG_DAYS.includes(name) ? BIKE : ROWER);
      expect(head?.warmup, name).toBe(true);
      // Still one working bout: never a warm-up set (Start would drop the row), never a PB or a muscle set.
      expect(head?.setTemplates.map((t) => t.setType), name).toEqual(['working']);
    }

    // Library › Plan › Legs A: the bike's meta reads Warm-up.
    const day = await s.plans.planDay(legsId);
    expect(day?.rows[0]?.name).toBe('Exercise bike');
    expect(day?.rows[0]?.sub).toBe('Warm-up');
    expect(day?.rows.slice(1).every((r) => r.sub === null || !r.sub.startsWith('Warm-up'))).toBe(true);

    // Your workout for Legs A: the bike first, 8:00, `Warm-up` in its meta line; nothing else marked.
    const opened = await s.builder.openTarget({ kind: 'routine', routineId: legsId }, h.ids());
    const snap = opened.snapshot;
    if (snap === null) throw new Error('Your workout did not open');
    const page = workoutView(snap);
    const rows = page.rounds.flatMap((r) => r.rows);
    expect(rows[0]?.name).toBe('Exercise bike');
    expect(rows[0]?.topText).toBe('8:00');
    expect(rows[0]?.works?.endsWith('Warm-up')).toBe(true);
    expect(rows[0]?.accessibilityLabel).toContain('Warm-up');
    expect(rows.slice(1).some((r) => r.works?.includes('Warm-up') === true)).toBe(false);

    // Start: the active first exercise is the bike, marked, with `Warm-up` in its header meta.
    const started = await s.builder.start(snap.draftId, { opId: 'start-legs-a', expectedVersion: snap.version, gymId, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const data = await s.workout.load(started.sessionId);
    if (data == null) throw new Error('no workout');
    const live = [...data.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect(live[0]?.exerciseId).toBe(BIKE);
    expect(live[0]?.warmup).toBe(true);
    expect(live.slice(1).some((e) => e.warmup === true)).toBe(false);
    const bikeSets = data.aggregate.sets.filter((x) => x.sessionExerciseId === live[0]?.id && x.status !== 'deleted');
    expect(bikeSets.map((x) => [x.setType, x.planned.durationS])).toEqual([['working', 480]]);
    expect(data.aggregate.session.activeSetId).toBe(bikeSets[0]?.id);
    const rounds = buildRounds(s.workout.tableView(data, toMs(h.now().utc), null), (id) => data.worksLines?.[id] ?? null, null);
    const head = rounds[0]?.exercises[0];
    expect(head?.name).toBe('Exercise bike');
    expect(head?.subline?.endsWith('Warm-up')).toBe(true);
    expect(head?.isCurrent).toBe(true);

    // Log the bike, finish: history keeps the mark, also after a force-close.
    const set = bikeSets[0];
    if (set === undefined) throw new Error('no bike set');
    h.clockMs += 480_000;
    const logged = await s.workout.dispatch(started.sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values: { load: null, reps: null, durationS: 480, distanceM: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const fin = await s.workout.dispatch(started.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: logged.aggregate.session.version, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const done = await s2.workout.load(started.sessionId);
    expect(done?.aggregate.session.status).toBe('finished');
    const doneBike = done?.aggregate.exercises.find((e) => e.exerciseId === BIKE);
    expect(doneBike?.warmup).toBe(true);
    expect(done?.aggregate.sets.find((x) => x.sessionExerciseId === doneBike?.id)?.status).toBe('completed');

    // Undo: every day's cardio row (and its mark) is gone; the finished workout keeps its own record (rule 2).
    expect(await s2.planSwap.undo(rec.actionId, h.ids())).toBe(true);
    for (const [name, id] of days) {
      const t = await template(s2, id);
      expect(t.exercises.some((e) => e.warmup === true), name).toBe(false);
      expect(t.exercises.some((e) => e.exerciseId === BIKE || e.exerciseId === ROWER), name).toBe(false);
    }
    expect((await s2.workout.load(started.sessionId))?.aggregate.exercises.find((e) => e.exerciseId === BIKE)?.warmup).toBe(true);
  });

  it('Today’s Start (routineOf) of Legs B carries the mark too', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await bensPlan(s);
    const rec = await ask(s, ASK, CALL);
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const r = await s.workout.start({ gymId, opId: 'start-legs-b', checkIn: null, routineOf: days.get('Legs B') ?? '' });
    if (!r.ok) throw new Error(r.error.message);
    const rows = [...r.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect([rows[0]?.exerciseId, rows[0]?.warmup]).toEqual([BIKE, true]);
  });

  it('“add a 10 min row at the end”: no warm-up in his words, so no mark even if the coach sends one', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const days = await bensPlan(s);
    const rec = await ask(s, 'Add a 10 min row at the end of Legs A', { ...CALL, add: 'rowing-erg', days: ['Legs A'], position: 'last', minutes: 10, warmup: true, also: null });
    if (rec.detail.kind !== 'propose_plan_swap') throw new Error('no card');
    expect(rec.detail.warmup).toBeUndefined();
    expect(planSwapLines(rec)).toEqual({ head: '+ Rowing machine · 10 min', days: ['Legs A: at the end'] });
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const t = await template(s, days.get('Legs A') ?? '');
    const row = [...t.exercises].sort((a, b) => a.order - b.order).at(-1);
    expect([row?.exerciseId, row?.warmup]).toEqual([ROWER, undefined]);
    const day = await s.plans.planDay(days.get('Legs A') ?? '');
    expect(day?.rows.some((r) => r.sub?.startsWith('Warm-up') === true)).toBe(false);
  });

  it('any cardio can be the warm-up: a treadmill first on Push A is marked; a lift asked as a warm-up is not', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await bensPlan(s);
    const rec = await ask(s, 'Put 5 min on the treadmill first on Push A as a warm-up', { ...CALL, add: 'treadmill-run', days: ['Push A'], minutes: 5, also: null });
    expect(planSwapLines(rec)?.days).toEqual(['Push A: first, warm-up']);
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const push = first(await template(s, days.get('Push A') ?? ''));
    expect([push?.exerciseId, push?.warmup]).toEqual([TREADMILL, true]);
    const started = await s.workout.start({ gymId, opId: 'start-push', checkIn: null, routineOf: days.get('Push A') ?? '' });
    if (!started.ok) throw new Error(started.error.message);
    const lead = [...started.aggregate.exercises].sort((a, b) => a.order - b.order)[0];
    expect([lead?.exerciseId, lead?.warmup]).toEqual([TREADMILL, true]);
    const discard = await s.workout.dispatch(started.aggregate.session.id, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: started.aggregate.session.version, confirmedLoggedSets: 0 });
    if (!discard.ok) throw new Error(discard.error.message);

    // A lift can't be a warm-up row: the flag is left off and it is a normal exercise.
    const lift = await ask(s, 'Add curls first on Pull A as a warm-up', { ...CALL, add: 'dumbbell-curl', days: ['Pull A'], workingSets: 2, reps: { min: 12, max: 15 }, minutes: null, also: null });
    if (lift.detail.kind !== 'propose_plan_swap') throw new Error('no card');
    expect(lift.detail.warmup).toBeUndefined();
    expect(await s.planSwap.apply(lift.actionId)).toEqual({ ok: true });
    const curl = first(await template(s, days.get('Pull A') ?? ''));
    expect([curl?.exerciseId, curl?.warmup]).toEqual([catalogueExerciseId('dumbbell-curl'), undefined]);
  });
});
