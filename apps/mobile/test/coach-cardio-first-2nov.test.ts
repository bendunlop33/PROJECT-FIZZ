import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { planSwapLines } from '../src/coach/sheet-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov) Real SQLite, the scripted model. Ben: "bike for 8 minutes first on leg days, rowing for 4 minutes first
 * on other days". His correction of the first build (a `Cardio first` setting with code deciding leg days): "no i am
 * talking about the ability to add that with the coach for the plan. the coach should know when there are leg days. it
 * just needs the ability to add it". So: one plan proposal from the coach, which names the leg days itself (it reads
 * each day's exercises): the bike first in those, the rower first in the rest. Apply writes every day (versioned, a
 * double tap or a restart writes once), Undo puts every day back, a day changed since refuses it (rule 5). The days
 * then hold the cardio as a normal timed exercise, first, so each workout from them starts with it.
 */

const ASK = 'bike for 8 minutes first on leg days, rowing for 4 minutes first on other days';
const BIKE = catalogueExerciseId('exercise-bike');
const ROWER = catalogueExerciseId('rowing-erg');
const LEG_DAYS = ['Legs A', 'Legs B'];
const OTHER_DAYS = ['Push A', 'Pull A', 'Upper B'];

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

/**
 * Ben's five-day plan: Push A, Pull A, Legs A, Upper B, Legs B. The builder makes a five-day PPL (Push A, Pull A, Legs,
 * Push B, Pull B); the days are renamed to his names (the scripted model picks the leg days by name).
 */
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
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  expect([...days.keys()].sort()).toEqual([...LEG_DAYS, ...OTHER_DAYS].sort());
  return days;
}

const orderedIds = (r: Routine) => [...r.exercises].sort((a, b) => a.order - b.order).map((e) => e.exerciseId);

/** The coach's one call for Ben's message: the bike first on the days it judged leg days, the rower first on the rest. */
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
  also: [{ add: 'rowing-erg', days: OTHER_DAYS, position: 'first', before: null, after: null, workingSets: 1, reps: null, minutes: 4, distanceM: null }],
  notIncluded: null,
  reason: 'Cardio first: bike on leg days, rower on the rest.',
};

async function askBen(s: AppServices, call: object = CALL) {
  model = new StepModel([() => toolCall('propose_plan_add', call), () => replyWith('Here it is for your plan.')]);
  return s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: ASK, spoken: false }, turnId: h.ids() });
}

describe('Ben’s message: one plan proposal, the coach picks the leg days', () => {
  it('Apply puts the bike first on Legs A and Legs B and the rower first on the others; a second Apply and a restart write once; Undo puts every day back', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const days = await bensPlan(s);
    const before = new Map<string, Routine>();
    for (const [name, id] of days) before.set(name, await template(s, id));

    const r = await askBen(s);
    expect(r.status).toBe('completed');
    const req = model.requests[0];
    // Routed to the plan add (the routing line), and the coach sees each day's exercises to judge leg days.
    expect(req?.tools.map((t) => t.name)).toContain('propose_plan_add');
    expect(req?.instructions).toContain('Never update_warmup_prefs for this');
    const seen = JSON.stringify(req);
    for (const name of [...LEG_DAYS, ...OTHER_DAYS]) expect(seen).toContain(name);

    // One card, a proposal (nothing written yet), each day's change on it.
    expect(r.cards).toHaveLength(1);
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    expect(planSwapLines(rec)).toEqual({
      head: '+ Exercise bike · 8 min, Rowing machine · 4 min',
      days: [...LEG_DAYS.map((d) => `${d}: Exercise bike · 8 min, first`), ...OTHER_DAYS.map((d) => `${d}: Rowing machine · 4 min, first`)],
    });
    expect(r.cards[0]?.rendered.text).toBe('Every week: + Exercise bike 8 min first (Legs A, Legs B); + Rowing machine 4 min first (Push A, Pull A, Upper B).');
    for (const [name, id] of days) expect(await template(s, id)).toEqual(before.get(name));

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const check = async (svc: AppServices) => {
      for (const [name, id] of days) {
        const now = await template(svc, id);
        const cardio = LEG_DAYS.includes(name) ? BIKE : ROWER;
        expect(orderedIds(now), name).toEqual([cardio, ...orderedIds(before.get(name) ?? now)]);
        const head = [...now.exercises].sort((a, b) => a.order - b.order)[0];
        // One timed bout: no reps, no load, never a muscle set or a PB (cardio has neither).
        expect(head?.setTemplates.map((t) => [t.setType, t.targetDurationS, t.targetReps, t.targetLoad]), name).toEqual([['working', LEG_DAYS.includes(name) ? 480 : 240, null, null]]);
      }
    };
    await check(s);
    expect((await s.planSwap.card(rec.actionId)).kind).toBe('applied');
    // A double tap writes nothing more.
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    await check(s);

    // Force-close and relaunch: still applied once; Apply again (a retry after restart) writes nothing more.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.planSwap.card(rec.actionId)).kind).toBe('applied');
    expect(await s2.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    await check(s2);

    expect(await s2.planSwap.undo(rec.actionId, h.ids())).toBe(true);
    for (const [name, id] of days) expect(orderedIds(await template(s2, id)), name).toEqual(orderedIds(before.get(name) ?? (await template(s2, id))));
    expect((await s2.planSwap.card(rec.actionId)).kind).toBe('undone');
  });

  it('starting Legs A begins with Exercise bike 8:00; Upper B with the rower 4:00; one cardio each, nothing added at Start', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const days = await bensPlan(s);
    const r = await askBen(s);
    const rec = r.cards[0]?.record;
    if (rec === undefined) throw new Error('no card');
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });

    const legs = await s.workout.start({ gymId, opId: 'start-legs', checkIn: null, routineOf: days.get('Legs A') ?? '' });
    if (!legs.ok) throw new Error(legs.error.message);
    const rows = [...legs.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect(rows[0]?.exerciseId).toBe(BIKE);
    expect(rows.filter((x) => x.measurement === 'cardio').map((x) => x.exerciseId)).toEqual([BIKE]);
    const bikeSets = legs.aggregate.sets.filter((x) => x.sessionExerciseId === rows[0]?.id && x.status !== 'deleted');
    expect(bikeSets.map((x) => [x.planned.durationS, x.planned.load, x.planned.reps])).toEqual([[480, null, null]]);
    // It is the first set up.
    expect(legs.aggregate.session.activeSetId).toBe(bikeSets[0]?.id);
    const gone = await s.workout.dispatch(legs.aggregate.session.id, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: legs.aggregate.session.version, confirmedLoggedSets: 0 });
    if (!gone.ok) throw new Error(gone.error.message);

    h.clockMs += 86_400_000;
    const upper = await s.workout.start({ gymId, opId: 'start-upper', checkIn: null, routineOf: days.get('Upper B') ?? '' });
    if (!upper.ok) throw new Error(upper.error.message);
    const up = [...upper.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect(up[0]?.exerciseId).toBe(ROWER);
    expect(up.filter((x) => x.measurement === 'cardio').map((x) => x.exerciseId)).toEqual([ROWER]);
    expect(upper.aggregate.sets.filter((x) => x.sessionExerciseId === up[0]?.id).map((x) => x.planned.durationS)).toEqual([240]);
  });

  it('a day changed since the proposal: Apply is refused as out of date and nothing is written (rule 5)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const days = await bensPlan(s);
    const r = await askBen(s);
    const rec = r.cards[0]?.record;
    if (rec === undefined) throw new Error('no card');
    // Ben edits Upper B (one of the rower's days, written after the leg days) in the meantime.
    const id = days.get('Upper B') ?? '';
    const t = await template(s, id);
    const moved = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: catalogueExerciseId('dumbbell-curl'), afterRowId: null } });
    if (!moved.ok) throw new Error(moved.message);
    const snapshot = new Map<string, Routine>();
    for (const [name, rid] of days) snapshot.set(name, await template(s, rid));

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    // The days written before the stale one are put back: no day has the cardio.
    for (const [name, rid] of days) expect(orderedIds(await template(s, rid)), name).toEqual(orderedIds(snapshot.get(name) ?? t));
  });

  it('a day named for both adds is refused with one line; nothing proposed', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    await bensPlan(s);
    const r = await askBen(s, { ...CALL, also: [{ ...CALL.also[0], days: ['Push A', 'Legs B'] }] });
    const rec = r.cards[0]?.record;
    expect(rec?.status).toBe('rejected');
    expect(rec?.failure).toBe('Legs B is named for two adds; one add per day');
  });
});
