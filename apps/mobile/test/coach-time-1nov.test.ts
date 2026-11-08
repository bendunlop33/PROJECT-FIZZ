import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { requestChars } from '@fizz/coach';
import { catalogueExerciseId } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { cardView, planSwapLines } from '../src/coach/sheet-view';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 1 Nov, build 500) Real SQLite, the scripted model. Live on Push B (shoulder press first, bench after). Ben: "Let's
 * stick to 100 as easier to take off plates. I think we didn't adjust the plan considering the shoulders I just trained?
 * Going forwards plan B should be slightly different?" Before: "Couldn't apply. … Coach kept sets 4–5 as planned..
 * Nothing changed." and a turn still thinking. Now: today's part is `Already …` (no failure card), and the plan part is a
 * card for Push B (bench first, the press secondary) with Apply and Undo.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Sunday 1 Nov 2026, 18:00 in London.
  h = createHarness('2026-11-01T18:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const PRESS = 'dumbbell-seated-shoulder-press';
const INCLINE = 'dumbbell-incline-bench-press';
const BENCH = 'dumbbell-bench-press';
const RAISE = 'bodyweight-hanging-leg-raise';
const ASK_PLAN = 'Push B should be different since shoulders are pre-fatigued';
const ASK_TWO = "Let's stick to 22.5 as easier to grab. I think we didn't adjust the plan considering the shoulders I just trained? Going forwards plan B should be slightly different?";

async function setUpGym(s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

const order = (r: Routine): string[] => [...r.exercises].sort((a, b) => a.order - b.order).map((e) => e.exerciseId);

/** Ben's PPL plan applied and Push B started (shoulder press, incline press, bench, hanging leg raise). */
async function bensPushB(): Promise<{ s: AppServices; pushB: string; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(s);
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const pushB = ((await s.plans.active())?.days ?? []).find((d) => d.name === 'Push B')?.routineId ?? '';
  expect(order(await template(s, pushB))).toEqual([PRESS, INCLINE, BENCH, RAISE].map(catalogueExerciseId));
  const started = await s.workout.start({ gymId, opId: 'start-push-b', checkIn: null, routineOf: pushB });
  if (!started.ok) throw new Error(started.error.message);
  return { s, pushB, sessionId: started.aggregate.session.id };
}

/** The coach's fix for Push B: bench first while fresh, the press after it as a secondary lift at RPE 7. */
const dayEdit = (): ModelEvent[] =>
  toolCall('propose_plan_day_edit', { day: 'Push B', order: [BENCH, PRESS, INCLINE, RAISE], changes: [{ exercise: PRESS, workingSets: null, reps: null, targetRpe: 7, main: false, load: null }], reason: 'Bench first while fresh; the press after it.' });

/** Every pending working set of the shoulder press at `value` kg each. */
const pressAt = (value: number, quote: string) => (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const press = w.exercises.find((e) => /shoulder press/i.test(e.name));
  if (press === undefined) throw new Error('no press');
  const ops = press.sets.filter((x) => x.status === 'pending').map((x) => ({ op: 'set', setId: x.setId, target: { load: { value, unit: 'kg', convention: 'per_hand' }, reps: null, rpe: null } }));
  return toolCall('edit_today', { baseVersion: w.version, ops, reason: 'Ben asked.', benAsked: true, benQuote: quote });
};

const turn = (s: AppServices, sessionId: string, text: string, threadId: string | null = null) => s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

describe('Ben’s live Push B chat (build 500)', () => {
  it('"Push B should be different since shoulders are pre-fatigued": a plan-day card for Push B; Apply reorders it every week; Undo puts it back', async () => {
    const { s, pushB, sessionId } = await bensPushB();
    const before = await template(s, pushB);
    model = new StepModel([dayEdit, () => replyWith('Bench goes first while you’re fresh; the press follows as a secondary lift.')]);
    const r = await turn(s, sessionId, ASK_PLAN);
    expect(r.status).toBe('completed');
    // Plan work: medium effort, the plan-day tool offered, no build tools (a smaller request).
    expect(model.requests[0]?.effort).toBe('medium');
    const names = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['propose_plan_day_edit', 'propose_plan_swap', 'edit_today']));
    expect(names).not.toContain('propose_workout');
    expect(names).not.toContain('propose_plan');
    // The coach sees each day's sets and reps.
    const data = model.requests[0]?.input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    expect(data?.type === 'message' ? data.content : '').toContain('"name":"Dumbbell shoulder press","sets":3,"reps":"6"');

    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    expect(rec.detail.op).toBe('day_edit');
    expect(planSwapLines(rec)).toEqual({ head: 'Push B', days: ['Order: Dumbbell bench press, Dumbbell shoulder press, Incline dumbbell press, Hanging leg raise', 'Dumbbell shoulder press: RPE 8 → 7 · secondary'] });
    expect(rec.detail.days[0]?.after).toEqual(['Dumbbell bench press', 'Dumbbell shoulder press', 'Incline dumbbell press', 'Hanging leg raise']);
    // Nothing changed until Apply (rule 3).
    expect(await template(s, pushB)).toEqual(before);
    expect(await s.planSwap.card(rec.actionId)).toEqual({ kind: 'open', today: null });

    // Apply: Push B every week (a double tap writes once).
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const after = await template(s, pushB);
    expect(after.version).toBe(before.version + 1);
    expect(order(after)).toEqual([BENCH, PRESS, INCLINE, RAISE].map(catalogueExerciseId));
    const press = after.exercises.find((e) => e.exerciseId === catalogueExerciseId(PRESS));
    expect(press?.main).toBe(false);
    expect(press?.setTemplates.filter((t) => t.setType !== 'warmup').every((t) => t.targetRpe === 7)).toBe(true);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'applied' });

    // Undo: Push B as it was.
    expect(await s.planSwap.undo(rec.actionId, h.ids())).toBe(true);
    expect((await template(s, pushB)).exercises).toEqual(before.exercises);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'undone' });
  });

  it('a day changed since the proposal: Apply is refused as out of date, nothing written (rule 5)', async () => {
    const { s, pushB, sessionId } = await bensPushB();
    model = new StepModel([dayEdit, () => replyWith('Bench first.')]);
    const r = await turn(s, sessionId, ASK_PLAN);
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec === undefined) throw new Error('no card');
    const t = await template(s, pushB);
    const moved = await s.plans.editDayEveryWeek({ routineId: pushB, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'remove', rowId: t.exercises.find((e) => e.exerciseId === catalogueExerciseId(RAISE))?.id ?? '', fromExerciseId: catalogueExerciseId(RAISE), toExerciseId: null, afterRowId: null } });
    if (!moved.ok) throw new Error(moved.message);
    const now = await template(s, pushB);
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect(await template(s, pushB)).toEqual(now);
  });

  it('the two-part ask: today’s restatement reads `Already 22.5 kg each` (no failure card), then the Push B card', async () => {
    const { s, sessionId } = await bensPushB();
    // Earlier: the press set to 22.5 kg each.
    model = new StepModel([pressAt(22.5, 'make the shoulder press 22.5'), () => replyWith('Done.')]);
    const first = await turn(s, sessionId, 'make the shoulder press 22.5');
    expect(first.cards.find((c) => c.record.detail.kind === 'edit_today')?.record.status).toBe('committed');
    const version = (await s.workout.load(sessionId))?.aggregate.session.version;

    model = new StepModel([pressAt(22.5, 'stick to 22.5'), dayEdit, () => replyWith('Staying at 22.5. Push B gets bench first from next week.')]);
    const r = await turn(s, sessionId, ASK_TWO, first.threadId);
    expect(r.status).toBe('completed');
    // Today first and light; the plan part after it.
    expect(model.requests.map((q) => q.effort)).toEqual(['low', 'medium', 'medium']);
    const today = r.cards.find((c) => c.record.detail.kind === 'edit_today')?.record;
    if (today === undefined) throw new Error('no today card');
    const view = cardView(today);
    expect(view.status.word).toBe('No change');
    expect(view.text.replace(/\u00a0/g, ' ')).toBe('Already 22.5 kg each.');
    expect(view.text).not.toMatch(/Couldn|Nothing changed|\.\./);
    // Nothing written today.
    expect((await s.workout.load(sessionId))?.aggregate.session.version).toBe(version);
    // The plan part: the card.
    expect(r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record.status).toBe('proposed');
  });

  it('the plan turn sends far less than before: no build view, tools or addable list (token proxy)', async () => {
    const { s, sessionId } = await bensPushB();
    model = new StepModel([() => replyWith('ok')]);
    await turn(s, sessionId, 'how are the sets looking?');
    const quick = model.requests[0];
    model = new StepModel([dayEdit, () => replyWith('Bench first.')]);
    await turn(s, sessionId, ASK_TWO);
    const plan = model.requests[0];
    if (quick === undefined || plan === undefined) throw new Error('no request');
    const yourData = plan.input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    expect(yourData?.type === 'message' && yourData.content.includes('"build":')).toBe(false);
    // Measured on this fixture (1 Nov): about 97,000 characters (24k tokens) before the trim, then under 60,000.
    // (2 Nov) The playbook grew by the rules Ben approved (FQ/VC/ST, LW, WU1–12 and his amendments, run rules):
    // about 67,000 here. The cap is 70,000 so later growth is still caught.
    // (Ben, 8 Nov) Caught: the rules he approved that day in short form (PN1, the one-session pain hold; SF1–SF9), the
    // coach-parity `set_details` op and the one-line override rule add about 3,800: about 72,500 here. Raised to 74,000
    // for that growth only (PM to confirm); anything more still fails.
    expect(requestChars(plan)).toBeLessThan(74_000);
  });
});
