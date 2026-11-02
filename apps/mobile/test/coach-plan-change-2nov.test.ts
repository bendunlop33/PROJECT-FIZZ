import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 2 Nov) The coach's plan-level changes and rest settings end to end on real SQLite, offline (a scripted model):
 *
 * - "make next week a lighter week", "go to 4 days a week", "make the plan 8 weeks", "end this plan": each is a
 *   proposal card (nothing changes until Apply); Apply goes through the plan builder's `Apply changes` (or End) and
 *   keeps the block's start and week; a double Apply writes once; Undo puts the plan back; a proposal made on an older
 *   plan is refused (`Out of date`). Done workouts never change. The turn carries the plan tool, not the build tools.
 * - "rest 2 minutes on accessories", "turn on shorten main lift": applied at once with Undo because Ben asked; with a
 *   workout live the card offers `Today too?` (its own change and Undo; a logged set never changes). The coach's own
 *   idea changes nothing.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 19 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-19T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function nextMonday(): void {
  const now = new Date(h.clockMs);
  const back = (now.getUTCDay() + 6) % 7;
  h.clockMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7, 7);
}

/** A running 6-week Standard builder plan, 5 days, applied on Monday 19 Oct; a workout done in week 1; now Monday 26 Oct (week 2). */
async function running(patch: Partial<PlanBuilderAnswers> = {}): Promise<{ s: AppServices; gymId: string; planId: string; doneId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Back squat', sets: [{ load: 120, reps: 5, rpe: 8 }] },
  ]);
  h.clockMs += 3_600_000;
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a: PlanBuilderAnswers = { ...session.answers, weeks: 6, effort: 'standard', sessions: 5, split: null, ...patch };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error(`not built: ${built.reason}`);
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  // A plan day done in week 1.
  h.clockMs += 3_600_000;
  const data = await s.todaySession.load();
  const day = data?.days.find((d) => d.planId === built.planId);
  const controls = day === undefined ? undefined : data?.initial[day.key];
  if (data == null || day === undefined || controls === undefined) throw new Error('no plan day on Today');
  const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const st = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!st.ok) throw new Error('not started');
  await finishWorkout(h, s, st.aggregate.session.id);
  nextMonday();
  return { s, gymId, planId: built.planId, doneId: st.aggregate.session.id };
}

const say = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function block(s: AppServices) {
  const ov = await s.plans.overview();
  const b = ov?.block;
  if (ov == null || b == null) throw new Error('no block');
  // `since`: the block's start (its first Apply), which every change keeps (Ben, 30 Oct).
  return { planId: ov.planId, since: ov.since, current: b.current, of: b.views.length, deload: b.views[0]?.deloadWeeks ?? [], answers: b.answers, startsOn: b.startsOn ?? null, header: b.header };
}

const setsOf = async (s: AppServices, id: string): Promise<SessionAggregate['sets']> => (await s.workout.load(id))?.aggregate.sets ?? [];

describe('plan-level changes from the coach (Ben, 2 Nov)', () => {
  it('"make next week a lighter week": a proposal; Apply makes week 3 a deload week, block kept; double Apply writes once; Undo', async () => {
    const { s, planId } = await running();
    const was = await block(s);
    expect(was).toMatchObject({ planId, current: 2, of: 6, deload: [6] });

    model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'lighter_week', week: 'next' }, reason: 'Ben asked for a lighter week.' }), () => replyWith('Here is next week lighter.')]);
    const r = await say(s, 'make next week a lighter week');
    // The plan tool is here; the whole-plan rewrite and the workout builder are not (a targeted plan turn).
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toContain('propose_plan_change');
    expect(tools).not.toContain('propose_plan');
    expect(tools).not.toContain('propose_workout');
    expect(tools).not.toContain('update_rest_settings');
    expect(r.cards.map((c) => [c.record.status, c.record.detail.kind])).toEqual([['proposed', 'propose_plan_change']]);
    const card = r.cards[0];
    if (card?.record.detail.kind !== 'propose_plan_change') throw new Error('card');
    expect(card.record.detail.lines).toEqual(['Week 3 of 6 → Deload', '−10 % load, 1 set fewer']);
    // Nothing changed yet (rule 3).
    expect(await block(s)).toEqual(was);
    expect(await s.planChange.card(card.record.actionId)).toEqual({ kind: 'open' });

    expect(await s.planChange.apply(card.record.actionId)).toEqual({ ok: true });
    expect(await s.planChange.apply(card.record.actionId)).toEqual({ ok: true });
    const after = await block(s);
    expect(after).toMatchObject({ planId, since: was.since, current: 2, of: 6, deload: [3, 6], startsOn: was.startsOn });
    expect(after.answers.lighterWeeks).toEqual([3]);
    expect(await s.planChange.card(card.record.actionId)).toEqual({ kind: 'applied' });

    expect(await s.planChange.undo(card.record.actionId)).toBe(true);
    expect(await block(s)).toEqual(was);
    expect(await s.planChange.card(card.record.actionId)).toEqual({ kind: 'undone' });
  });

  it('"go to 4 days a week": the plan builder re-fits it from this week; the block start, the week and the done workout stay', async () => {
    const { s, planId, doneId } = await running();
    const was = await block(s);
    const plan0 = await s.plans.overview();
    const done0 = await setsOf(s, doneId);
    expect(done0.length).toBeGreaterThan(0);
    model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'days_per_week', days: 4, weekdays: null }, reason: 'Fewer days.' }), () => replyWith('Here it is on 4 days.')]);
    const r = await say(s, 'go to 4 days a week');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_plan');
    const card = r.cards[0];
    if (card?.record.detail.kind !== 'propose_plan_change') throw new Error('card');
    expect(card.record.detail.lines[0]).toBe('5 → 4 days a week');
    expect(await s.planChange.apply(card.record.actionId)).toEqual({ ok: true });
    const after = await block(s);
    expect(after).toMatchObject({ planId, since: was.since, current: 2, of: 6, startsOn: was.startsOn });
    expect(after.answers.sessions).toBe(4);
    // The workout done in week 1 is its own record and never changes (rule 2).
    expect(await setsOf(s, doneId)).toEqual(done0);
    const days = (await s.plans.overview())?.days.length ?? 0;
    expect(days).toBeLessThan(plan0?.days.length ?? 0);
    expect(await s.planChange.undo(card.record.actionId)).toBe(true);
    expect((await block(s)).answers.sessions).toBe(5);
  });

  it('"make the plan 8 weeks", then a proposal made on the older plan is refused (stale); the block start stays', async () => {
    const { s } = await running();
    const was = await block(s);
    model = new StepModel([
      () => toolCall('propose_plan_change', { change: { kind: 'length', weeks: 8 }, reason: 'Longer block.' }),
      () => replyWith('8 weeks.'),
      () => toolCall('propose_plan_change', { change: { kind: 'lighter_week', week: 'this' }, reason: 'Tired.' }),
      () => replyWith('This week lighter.'),
    ]);
    const longer = await say(s, 'make the plan 8 weeks');
    const lighter = await say(s, 'can this week be a deload?');
    const a = longer.cards[0];
    const b = lighter.cards[0];
    if (a === undefined || b === undefined) throw new Error('cards');
    expect(a.record.detail).toMatchObject({ kind: 'propose_plan_change', change: 'length', lines: ['6 → 8 weeks', 'Deload: week 6 → week 8'] });
    expect(await s.planChange.apply(a.record.actionId)).toEqual({ ok: true });
    expect(await block(s)).toMatchObject({ since: was.since, current: 2, of: 8, deload: [8], startsOn: was.startsOn });
    // Made on the plan before the length change: never applied to the newer plan (rule 5).
    expect(await s.planChange.apply(b.record.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect(await block(s)).toMatchObject({ of: 8, deload: [8] });
    expect(await s.planChange.card(b.record.actionId)).toEqual({ kind: 'open' });
  });

  it('"end this plan": End restores; Undo makes it the plan in use again', async () => {
    const { s, planId } = await running();
    model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'end' }, reason: 'Ben asked.' }), () => replyWith('Ready to end it.')]);
    const r = await say(s, 'end this plan');
    const card = r.cards[0];
    if (card?.record.detail.kind !== 'propose_plan_change') throw new Error('card');
    expect(card.record.detail.change).toBe('end');
    expect((await s.plans.inUse())?.planId).toBe(planId);
    expect(await s.planChange.apply(card.record.actionId)).toEqual({ ok: true });
    expect(await s.plans.inUse()).toBeNull();
    expect(await s.planChange.card(card.record.actionId)).toEqual({ kind: 'applied' });
    expect(await s.planChange.undo(card.record.actionId)).toBe(true);
    expect((await s.plans.inUse())?.planId).toBe(planId);
  });

  it('a refused change is one honest line on a card; nothing changes', async () => {
    const { s } = await running();
    const was = await block(s);
    model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'length', weeks: 10 }, reason: 'Ben asked.' }), () => replyWith('Plans come in 4, 6, 8 or 12 weeks.')]);
    const r = await say(s, 'make the plan 10 weeks');
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Plan not changed: Plan lengths are 4, 6, 8 or 12 weeks.']]);
    expect(await block(s)).toEqual(was);
  });
});

describe('rest settings from the coach (Ben, 2 Nov)', () => {
  /** A live workout from today's plan day (nothing logged yet). */
  async function live(s: AppServices, gymId: string): Promise<string> {
    const data = await s.todaySession.load();
    const day = data?.days[0];
    const controls = day === undefined ? undefined : data?.initial[day.key];
    if (data == null || day === undefined || controls === undefined) throw new Error('no day');
    const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
    if (!c.ok) throw new Error(c.message);
    const st = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
    if (!st.ok) throw new Error('not started');
    return st.aggregate.session.id;
  }
  const settings = async (s: AppServices) => {
    const p = (await s.training.snapshot())?.profile;
    return { restDefaultsS: p?.restDefaultsS ?? null, fitShortenMain: p?.fitShortenMain === true };
  };

  it('"rest 2 minutes on accessories" mid-workout: applied with Undo; `Today too?` moves pending isolation rests (own Undo); a logged set stays', async () => {
    const { s, gymId } = await running();
    const sessionId = await live(s, gymId);
    const agg0 = (await s.workout.load(sessionId))?.aggregate;
    if (agg0 === undefined) throw new Error('no workout');

    const said = 'rest 2 minutes on accessories';
    model = new StepModel([() => toolCall('update_rest_settings', { rests: [{ setType: 'workingCompound', seconds: 120 }, { setType: 'workingIsolation', seconds: 120 }], whenShort: null, shortenMain: null, benAsked: true, benQuote: said }), () => replyWith('Done.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: said, spoken: false }, turnId: h.ids() });
    const tools = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(tools).toContain('update_rest_settings');
    expect(tools).not.toContain('propose_plan_change');
    // His settings: applied at once (he asked), not today's sets (no edit_today ran).
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['committed', 'Isolation 1:30 → 2:00']]);
    expect(await settings(s)).toEqual({ restDefaultsS: { workingIsolation: 120 }, fitShortenMain: false });
    const card = r.cards[0];
    if (card?.record.detail.kind !== 'update_rest_settings') throw new Error('card');
    expect(card.record.detail.today).not.toBeNull();
    const agg1 = (await s.workout.load(sessionId))?.aggregate;
    expect(agg1?.sets.map((x) => x.rest.seconds)).toEqual(agg0.sets.map((x) => x.rest.seconds));

    // Today too: pending rests that were 1:30 on isolation work are now 2:00.
    expect(await s.restSettings.today(card.record.actionId)).toBe('open');
    expect(await s.restSettings.applyToday(card.record.actionId)).toBe(true);
    expect(await s.restSettings.today(card.record.actionId)).toBe('done');
    const agg2 = (await s.workout.load(sessionId))?.aggregate;
    if (agg2 === undefined) throw new Error('no workout');
    const moved = agg2.sets.filter((x, i) => x.rest.seconds !== agg0.sets[i]?.rest.seconds);
    expect(moved.length).toBeGreaterThan(0);
    for (const x of moved) {
      expect(x.status).toBe('pending');
      expect(x.rest.seconds).toBe(120);
      expect(agg0.sets.find((y) => y.id === x.id)?.rest.seconds).toBe(90);
    }
    // Ben logs one moved set; Undo of Today too puts back only the ones still pending (rule 2).
    const first = moved[0];
    const ex = agg2.exercises.find((e) => e.id === first?.sessionExerciseId);
    if (first === undefined || ex === undefined) throw new Error('no set');
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId: first.id, values: { load: first.planned.load ?? { value: 0, unit: ex.unit, convention: ex.loadConvention }, reps: first.planned.reps?.min ?? 10, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    expect(await s.restSettings.undoToday(card.record.actionId)).toBe(true);
    const agg3 = (await s.workout.load(sessionId))?.aggregate;
    if (agg3 === undefined) throw new Error('no workout');
    for (const x of moved) {
      const now = agg3.sets.find((y) => y.id === x.id);
      expect(now?.rest.seconds).toBe(x.id === first.id ? 120 : 90);
    }
    expect(agg3.sets.find((y) => y.id === first.id)?.status).toBe('completed');

    // The settings' own Undo on the card.
    const undo = await s.coach.undo(card.record.actionId, `undo:${card.record.actionId}`);
    expect(undo.result.status).toBe('written');
    expect(await settings(s)).toEqual({ restDefaultsS: null, fitShortenMain: false });
  });

  it('mid-workout, "make next week a lighter week" is the plan’s proposal, never forced into a change to today’s sets', async () => {
    const { s, gymId } = await running();
    const sessionId = await live(s, gymId);
    const before = (await s.workout.load(sessionId))?.aggregate.sets;
    model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'lighter_week', week: 'next' }, reason: 'Ben asked.' }), () => replyWith('Next week is lighter once you apply it.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: 'make next week a lighter week', spoken: false }, turnId: h.ids() });
    expect(model.requests.map((q) => q.toolChoice)).toEqual(['required', 'required']);
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan_change');
    expect(r.cards.map((c) => [c.record.status, c.record.detail.kind])).toEqual([['proposed', 'propose_plan_change']]);
    expect((await s.workout.load(sessionId))?.aggregate.sets).toEqual(before);
  });

  it('"turn on shorten main lift" applies (no Today too: no rest moves now); the coach’s own idea changes nothing', async () => {
    const { s } = await running();
    model = new StepModel([() => toolCall('update_rest_settings', { rests: [{ setType: 'workingIsolation', seconds: 60 }], whenShort: null, shortenMain: null, benAsked: false, benQuote: null }), () => replyWith('Want me to change your rest times?')]);
    const idea = await say(s, 'my rests feel long');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('update_rest_settings');
    expect(idea.cards).toEqual([]);
    expect(await settings(s)).toEqual({ restDefaultsS: null, fitShortenMain: false });

    const said = 'turn on shorten main lift';
    model = new StepModel([() => toolCall('update_rest_settings', { rests: [], whenShort: null, shortenMain: true, benAsked: true, benQuote: said }), () => replyWith('On.')]);
    const r = await say(s, said);
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['committed', 'Shorten main lift too: on']]);
    expect(r.cards[0]?.record.detail).toMatchObject({ kind: 'update_rest_settings', today: null });
    expect(await settings(s)).toEqual({ restDefaultsS: null, fitShortenMain: true });

    // Out of Rest times' limits: refused, nothing changes.
    model = new StepModel([() => toolCall('update_rest_settings', { rests: [{ setType: 'warmup', seconds: 100 }], whenShort: null, shortenMain: null, benAsked: true, benQuote: 'rest 100 seconds on warm-ups' }), () => replyWith('Rest times go in 15 s steps.')]);
    const bad = await say(s, 'rest 100 seconds on warm-ups');
    expect(bad.cards).toEqual([]);
    expect(await settings(s)).toEqual({ restDefaultsS: null, fitShortenMain: true });
  });
});

