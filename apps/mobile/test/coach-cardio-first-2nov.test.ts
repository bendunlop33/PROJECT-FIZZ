import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { planSwapLines } from '../src/coach/sheet-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov, build 513) Real SQLite, the scripted model. Ben: "bike for 8 minutes first on leg days, rowing for 4
 * minutes first on other days". Before: the coach offered incomplete plan adds, then said it couldn't encode the rule.
 * Now: one warm-up setting change (applied at once because he asked, Undo on the card), which every workout he starts
 * follows. And the plan-day path can add an exercise first, with minutes, to every leg day in one proposal (versioned:
 * a day changed since refuses it, nothing written).
 */

const ASK = 'bike for 8 minutes first on leg days, rowing for 4 minutes first on other days';
const BIKE = catalogueExerciseId('exercise-bike');
const ROWER = catalogueExerciseId('rowing-erg');

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

/** Ben's PPL plan, applied. */
async function bensPlan(): Promise<{ s: AppServices; gymId: string; days: Map<string, string> }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  return { s, gymId, days };
}

const orderedIds = (r: Routine) => [...r.exercises].sort((a, b) => a.order - b.order).map((e) => e.exerciseId);

describe('Ben’s message (build 513): one warm-up setting, not plan adds', () => {
  it('“bike for 8 minutes first on leg days, rowing for 4 minutes first on other days” → one change, applied with Undo; Start follows it', async () => {
    const { s, gymId, days } = await bensPlan();
    const before = new Map<string, Routine>();
    for (const [name, id] of days) before.set(name, await template(s, id));

    model = new StepModel([
      () =>
        toolCall('update_warmup_prefs', {
          simpleLoads: null,
          exercises: [],
          general: [
            { days: 'legs', exercise: 'bike', minutes: 8 },
            { days: 'other', exercise: 'rowing', minutes: 4 },
          ],
          benAsked: true,
          benQuote: ASK,
        }),
      () => replyWith('Every workout you start will open with it.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: ASK, spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const req = model.requests[0];
    // Offered with the routing line; the plan tools are there too, and the honesty line.
    expect(req?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['update_warmup_prefs', 'propose_plan_add']));
    expect(req?.instructions).toContain('A standing cardio-first rule');
    expect(req?.instructions).toContain('check that your tools can do all of what Ben asked');

    // Exactly one card: the setting, committed (he asked), one line per kind of day; no plan proposal.
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status, c.rendered.text])).toEqual([['update_warmup_prefs', 'committed', 'Leg days: Exercise bike 8 min first · Other days: Rowing machine 4 min first']]);
    expect((await s.warmupPrefs.view())?.generalLine).toBe('Leg days · Exercise bike 8 min · Other days · Rowing machine 4 min');
    // The plan itself never changed (the rule lives in his settings, so it survives plan edits and new plans).
    for (const [name, id] of days) expect(await template(s, id)).toEqual(before.get(name));

    // A plan day started from Library: Legs gets the bike first, Push the rower.
    const legsId = [...days.entries()].find(([n]) => /^legs/i.test(n))?.[1] ?? '';
    const legs = await s.workout.start({ gymId, opId: 'start-legs', checkIn: null, routineOf: legsId });
    if (!legs.ok) throw new Error(legs.error.message);
    const legRows = [...legs.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect(legRows[0]?.exerciseId).toBe(BIKE);
    expect(legs.aggregate.sets.filter((x) => x.sessionExerciseId === legRows[0]?.id).map((x) => x.planned.durationS)).toEqual([480]);
    const gone = await s.workout.dispatch(legs.aggregate.session.id, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: legs.aggregate.session.version, confirmedLoggedSets: 0 });
    if (!gone.ok) throw new Error(gone.error.message);
    h.clockMs += 86_400_000;
    const pushId = [...days.entries()].find(([n]) => /^push/i.test(n))?.[1] ?? '';
    const push = await s.workout.start({ gymId, opId: 'start-push', checkIn: null, routineOf: pushId });
    if (!push.ok) throw new Error(push.error.message);
    const pushRows = [...push.aggregate.exercises].sort((a, b) => a.order - b.order);
    expect(pushRows[0]?.exerciseId).toBe(ROWER);
    expect(push.aggregate.sets.filter((x) => x.sessionExerciseId === pushRows[0]?.id).map((x) => x.planned.durationS)).toEqual([240]);

    // Undo on the card: the setting back to Off.
    const card = r.cards[0];
    if (card === undefined) throw new Error('card');
    const undo = await s.coach.undo(card.record.actionId, `undo:${card.record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect((await s.warmupPrefs.view())?.generalLine).toBe('Off');
  });

  it('the coach’s own idea changes nothing (rule 3)', async () => {
    const { s } = await bensPlan();
    model = new StepModel([
      () => toolCall('update_warmup_prefs', { simpleLoads: null, exercises: [], general: [{ days: 'all', exercise: 'bike', minutes: 5 }], benAsked: false, benQuote: null }),
      () => replyWith('A short bike first could help. Want me to set that?'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'My knees feel stiff at the start of squats', spoken: false }, turnId: h.ids() });
    expect(r.cards).toEqual([]);
    expect((await s.warmupPrefs.view())?.generalLine).toBe('Off');
  });
});

describe('plan-day edit: add first, with minutes, to every leg day in one proposal', () => {
  it('first on Legs A and Legs B with 8:00; Apply writes both, Undo puts both back; other days untouched', async () => {
    const { s, days } = await bensPlan();
    const legDays = [...days.entries()].filter(([n]) => /^legs/i.test(n));
    expect(legDays.length).toBeGreaterThanOrEqual(1);
    const before = new Map<string, Routine>();
    for (const [name, id] of days) before.set(name, await template(s, id));

    model = new StepModel([
      () => toolCall('propose_plan_add', { add: 'exercise-bike', days: [], after: null, workingSets: 1, reps: null, load: null, position: 'first', before: null, minutes: 8, distanceM: null, dayType: 'legs', notIncluded: null, reason: 'Bike to warm up on leg days.' }),
      () => replyWith('Here it is for your leg days.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Put an 8 minute bike first on my leg days in the plan', spoken: false }, turnId: h.ids() });
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    expect(rec.detail.days.map((d) => d.routineName).sort()).toEqual(legDays.map(([n]) => n).sort());
    expect(planSwapLines(rec)).toEqual({ head: '+ Exercise bike · 8 min', days: rec.detail.days.map((d) => `${d.routineName}: first`) });
    for (const d of rec.detail.days) expect(d.after?.[0]).toBe('Exercise bike');
    // Nothing changed until Apply.
    for (const [name, id] of days) expect(await template(s, id)).toEqual(before.get(name));

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    for (const [name, id] of days) {
      const now = await template(s, id);
      if (!legDays.some(([n]) => n === name)) {
        expect(now).toEqual(before.get(name));
        continue;
      }
      expect(orderedIds(now)).toEqual([BIKE, ...orderedIds(before.get(name) ?? now)]);
      const bike = [...now.exercises].sort((a, b) => a.order - b.order)[0];
      expect(bike?.setTemplates.map((t) => [t.setType, t.targetDurationS, t.targetReps, t.targetLoad])).toEqual([['working', 480, null, null]]);
    }

    expect(await s.planSwap.undo(rec.actionId, h.ids())).toBe(true);
    for (const [name, id] of days) expect(orderedIds(await template(s, id))).toEqual(orderedIds(before.get(name) ?? (await template(s, id))));
  });

  it('a day changed since the proposal: Apply is refused as out of date and nothing is written (rule 5)', async () => {
    const { s, days } = await bensPlan();
    const legDays = [...days.entries()].filter(([n]) => /^legs/i.test(n));
    model = new StepModel([
      () => toolCall('propose_plan_add', { add: 'rowing-erg', days: legDays.map(([n]) => n), after: null, workingSets: 1, reps: null, load: null, position: 'first', before: null, minutes: 4, distanceM: 1000, dayType: null, notIncluded: 'only on alternate weeks', reason: 'Rower first.' }),
      () => replyWith('This does the rower; alternate weeks isn’t something I can set.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Rower for 4 minutes first on leg days in my plan, only on alternate weeks', spoken: false }, turnId: h.ids() });
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
    // Labelled partial on the card and in its text.
    expect(planSwapLines(rec)).toMatchObject({ head: '+ Rowing machine · 4 min · 1,000\u00a0m', partial: 'Partial · not included: only on alternate weeks' });
    expect(r.cards.find((c) => c.record.actionId === rec.actionId)?.rendered.text).toContain('Partial: not included only on alternate weeks.');

    // Ben edits the first leg day in the meantime (Library's Every week): its version moves on.
    const [firstName, firstId] = legDays[0] ?? ['', ''];
    const t = await template(s, firstId);
    const moved = await s.plans.editDayEveryWeek({ routineId: firstId, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: catalogueExerciseId('dumbbell-curl'), afterRowId: null } });
    if (!moved.ok) throw new Error(moved.message);
    const snapshot = new Map<string, Routine>();
    for (const [name, id] of days) snapshot.set(name, await template(s, id));

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    for (const [name, id] of days) expect(orderedIds(await template(s, id)), name).toEqual(orderedIds(snapshot.get(name) ?? t));
    expect(firstName).not.toBe('');
  });
});
