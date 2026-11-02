import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';
import { catalogueExerciseId, directMuscleGroup, pbNotPreferred } from '@fizz/domain';
import type { ActionRecord, Exercise, PlanBuilderAnswers, Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { CoachEntry } from '../src/coach/coach-service';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';
import { bensPlanNoCurls } from './muscles-seed';

/**
 * (Ben, 2 Nov) Real SQLite, the real plan builder, the scripted model.
 * 1. "I don't like leg extensions, take them out": the preference is saved on Any preferences at once (Undo), and the
 *    same card offers the plan swap out of every day that has it (the `propose_plan_swap` engine: a proposal, Apply,
 *    Undo; a stale day refused).
 * 2. "am I doing enough biceps?", "rebalance my plan": Plan › Muscles' Rebalance from the coach, exactly the screen's
 *    card; Apply and Undo the screen's; a stale plan refused; the card survives a restart.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 2 Nov 2026, 08:00 in London.
  h = createHarness('2026-11-02T08:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const LE = 'machine-leg-extension';

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

/** Ben's 6-day PPL from the plan builder (Any preferences as given), with leg extension in Legs A and Legs B. */
async function bensPlan(prefs: PlanBuilderAnswers['prefs'] = {}): Promise<{ s: AppServices; days: Map<string, string>; le: string }> {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  const le = catalogueExerciseId(LE);
  for (const name of ['Legs A', 'Legs B']) {
    const id = days.get(name) ?? '';
    const t = await template(s, id);
    if (t.exercises.some((e) => e.exerciseId === le)) continue;
    const r = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: le, afterRowId: null } });
    if (!r.ok) throw new Error(r.message);
  }
  return { s, days, le };
}

/** The plan in use's Any preferences, as Plan setup's Edit plan opens them. */
async function prefsNow(s: AppServices): Promise<Pick<PlanBuilderAnswers, 'prefs' | 'likes' | 'never'>> {
  const active = await s.plans.active();
  const session = active === null ? null : await s.planBuilder.open({ editPlanId: active.planId });
  if (session === null) throw new Error('no builder plan');
  return { prefs: session.answers.prefs, likes: session.answers.likes, never: session.answers.never };
}

const say = (s: AppServices, text: string, entry: CoachEntry = { kind: 'today' }, threadId: string | null = null) => s.coach.send({ entry, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const toolNames = (req: ModelRequest | undefined) => req?.tools.map((t) => t.name) ?? [];
const swapRecord = async (s: AppServices, id: string): Promise<Extract<ActionRecord['detail'], { kind: 'propose_plan_swap' }>> => {
  const r = await s.planSwap.record(id);
  if (r?.detail.kind !== 'propose_plan_swap') throw new Error('no swap');
  return r.detail;
};

describe('"I don’t like leg extensions, take them out" (Ben, 2 Nov)', () => {
  it('saves the preference at once with Undo; the same card offers the swap out of Legs A and Legs B; nothing in the plan changes until Apply', async () => {
    const { s, days, le } = await bensPlan();
    const legsA = days.get('Legs A') ?? '';
    const legsB = days.get('Legs B') ?? '';
    const before = { a: await template(s, legsA), b: await template(s, legsB) };
    expect(pbNotPreferred(await prefsNow(s)).has(LE)).toBe(false);
    const said = 'I don’t like leg extensions, take them out';
    model = new StepModel([() => toolCall('set_exercise_preference', { exercise: 'leg extensions', preference: 'not_preferred', swapTo: null, benAsked: true, benQuote: said }), () => replyWith('Done: marked not preferred, and here is the swap for your plan.')]);
    const r = await say(s, said);
    // Offered on his words, with its prompt line; Rebalance isn't (no muscle words): the turn doesn't grow.
    expect(toolNames(model.requests[0])).toContain('set_exercise_preference');
    expect(toolNames(model.requests[0])).not.toContain('propose_rebalance');
    expect(model.requests[0]?.instructions).toContain('set_exercise_preference');
    // One card: the preference (committed, Undo) carrying the swap proposal.
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status, c.rendered.text])).toEqual([['set_exercise_preference', 'committed', 'Leg extension: not preferred']]);
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'set_exercise_preference' || rec.detail.swapActionId === null) throw new Error(`no swap: ${JSON.stringify(r.toolLog)}`);
    expect(pbNotPreferred(await prefsNow(s)).has(LE)).toBe(true);
    // The swap: leg extension out of both days, the substitute for the same muscles, usable, never not preferred.
    const swap = await swapRecord(s, rec.detail.swapActionId);
    expect(swap.removeId).toBe(le);
    expect(swap.days.map((d) => d.routineName)).toEqual(['Legs A', 'Legs B']);
    const pool: Exercise[] = await s.coachingKnowledge.exercises();
    const sub = pool.find((e) => e.id === swap.addId);
    expect(directMuscleGroup(sub ?? null)).toBe(directMuscleGroup(pool.find((e) => e.id === le) ?? null));
    // Not the same movement on one leg: the builder's other options for that slot come before the movement family.
    expect(swap.addId).not.toBe(catalogueExerciseId('machine-single-leg-extension'));
    expect(pbNotPreferred(await prefsNow(s)).has(sub?.catalogueKey ?? '')).toBe(false);
    // Rule 3: the plan's days don't change until Apply.
    expect(await template(s, legsA)).toEqual(before.a);
    expect(await s.planSwap.card(rec.detail.swapActionId)).toMatchObject({ kind: 'open' });
    expect(await s.planSwap.apply(rec.detail.swapActionId)).toEqual({ ok: true });
    for (const id of [legsA, legsB]) expect((await template(s, id)).exercises.map((e) => e.exerciseId)).not.toContain(le);
    // The swap's own Undo puts the days back.
    expect(await s.planSwap.undo(rec.detail.swapActionId, 'undo-swap')).toBe(true);
    expect((await template(s, legsA)).exercises).toEqual(before.a.exercises);

    // The preference's Undo (the card's): back as it was, the plan's days untouched.
    const undo = await s.coach.undo(rec.actionId, `undo:${rec.actionId}`);
    expect(undo.result.status).toBe('written');
    expect(pbNotPreferred(await prefsNow(s)).has(LE)).toBe(false);
    // A second Undo writes nothing more.
    expect((await s.coach.undo(rec.actionId, `undo:${rec.actionId}`)).result.status).not.toBe('written');
  });

  it('the swap is refused as out of date when a day changed since (rule 5); the preference stands', async () => {
    const { s, days } = await bensPlan();
    const said = "I don't like leg extensions, take them out";
    model = new StepModel([() => toolCall('set_exercise_preference', { exercise: LE, preference: 'not_preferred', swapTo: null, benAsked: true, benQuote: said }), () => replyWith('Done.')]);
    const r = await say(s, said);
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'set_exercise_preference' || rec.detail.swapActionId === null) throw new Error('no swap');
    const legsB = days.get('Legs B') ?? '';
    const tb = await template(s, legsB);
    const first = tb.exercises[0];
    if (first === undefined) throw new Error('empty');
    expect((await s.plans.editDayEveryWeek({ routineId: legsB, expectedVersion: tb.version, opId: 'other', edit: { kind: 'remove', rowId: first.id, fromExerciseId: first.exerciseId, toExerciseId: null, afterRowId: null } })).ok).toBe(true);
    const beforeA = await template(s, days.get('Legs A') ?? '');
    expect(await s.planSwap.apply(rec.detail.swapActionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect((await template(s, days.get('Legs A') ?? '')).exercises).toEqual(beforeA.exercises);
    expect(pbNotPreferred(await prefsNow(s)).has(LE)).toBe(true);
  });

  it('already not preferred on Plan setup (Quad extra → Split squat): no second write, the swap is still offered as its card', async () => {
    const { s, le } = await bensPlan({ quads: 1 });
    const was = await prefsNow(s);
    const said = "I don't like leg extensions, take them out";
    model = new StepModel([() => toolCall('set_exercise_preference', { exercise: 'Leg extension', preference: 'not_preferred', swapTo: null, benAsked: true, benQuote: said }), () => replyWith('Here is the swap.')]);
    const r = await say(s, said);
    expect(await prefsNow(s)).toEqual(was);
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
    const d = r.cards[0]?.record.detail;
    // His own pick on that question is what goes in.
    expect(d?.kind === 'propose_plan_swap' ? [d.removeId, d.addId] : null).toEqual([le, catalogueExerciseId('dumbbell-bulgarian-split-squat')]);
  });

  it('a question isn’t a stated preference: the tool isn’t offered and nothing changes', async () => {
    const { s } = await bensPlan();
    const was = await prefsNow(s);
    model = new StepModel([() => replyWith('They’re fine if your knees are happy.')]);
    await say(s, 'Should I drop leg extensions?');
    expect(toolNames(model.requests[0])).not.toContain('set_exercise_preference');
    expect(await prefsNow(s)).toEqual(was);
  });

  it('a coach-picked substitute that isn’t for the same muscles is replaced by the app’s pick', async () => {
    const { s } = await bensPlan();
    const said = "I don't like leg extensions";
    model = new StepModel([() => toolCall('set_exercise_preference', { exercise: LE, preference: 'not_preferred', swapTo: 'dumbbell-bicep-curl', benAsked: true, benQuote: said }), () => replyWith('Done.')]);
    const r = await say(s, said);
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'set_exercise_preference' || rec.detail.swapActionId === null) throw new Error('no swap');
    const swap = await swapRecord(s, rec.detail.swapActionId);
    expect(swap.addName).not.toMatch(/curl/i);
  });
});

describe('Plan setup › Any preferences: a dislike set there surfaces the same swap offer', () => {
  it('leg extension in never (as the coach writes it): `In your plan: Legs A, Legs B · Replace` with a same-muscle replacement, and Replace is the same proposal', async () => {
    const { s, le } = await bensPlan();
    const answers = { prefs: {}, likes: [], never: [LE] };
    const lines = await s.planSwap.inPlan(answers);
    expect(lines.map((l) => [l.key, l.days])).toEqual([[LE, ['Legs A', 'Legs B']]]);
    const pick = lines[0]?.replacement;
    if (pick == null) throw new Error('no replacement');
    const pool: Exercise[] = await s.coachingKnowledge.exercises();
    expect(directMuscleGroup(pool.find((e) => e.catalogueKey === pick.key) ?? null)).toBe(directMuscleGroup(pool.find((e) => e.id === le) ?? null));
    const made = await s.planSwap.replace({ key: LE, replacementKey: pick.key, opId: 'replace-never' });
    if (!made.ok) throw new Error(made.line);
    expect((await swapRecord(s, made.actionId)).days.map((d) => d.routineName)).toEqual(['Legs A', 'Legs B']);
  });
});

describe('Rebalance from the coach (Ben, 2 Nov): "am I doing enough biceps?", "rebalance my plan"', () => {
  it('the same proposal as Plan › Muscles for the same plan; Apply and Undo are the screen’s; restart keeps the card', async () => {
    const { s } = await bensPlanNoCurls(h);
    const screen = await s.planMuscles.rebalance();
    if (screen === null) throw new Error('no card');
    model = new StepModel([() => toolCall('propose_rebalance', { reason: 'Biceps get no direct sets.' }), () => replyWith('Biceps get 0 direct sets a week. Here is a rebalance.')]);
    const r = await say(s, 'am I doing enough biceps?');
    expect(toolNames(model.requests[0])).toContain('propose_rebalance');
    expect(toolNames(model.requests[0])).not.toContain('set_exercise_preference');
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_rebalance')?.record;
    if (rec?.detail.kind !== 'propose_rebalance') throw new Error(`no card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    // The coach and the screen never disagree: the same lines, bars and day lengths.
    expect(rec.detail.planVersion).toBe(screen.planVersion);
    expect(rec.detail.lines).toEqual(screen.lines.map((l) => ({ id: l.id, dayIndex: l.dayIndex, text: l.text })));
    expect(rec.detail.bars).toEqual(screen.bars.map((b) => ({ group: b.group, text: b.text, inRange: b.statusAfter === 'in' })));
    expect(rec.detail.minutes).toEqual(screen.minutes.map((m) => ({ dayIndex: m.dayIndex, text: m.text, over: m.over })));
    expect(rec.detail.why).toEqual(screen.why);
    const open = await s.planMuscles.coachCard(rec.detail, rec.actionId);
    expect(open).toEqual({ kind: 'open', card: screen });
    // Per-line skip reads the same as the screen's.
    const skip = new Set([screen.lines[0]?.id ?? '']);
    expect(await s.planMuscles.coachCard(rec.detail, rec.actionId, skip)).toEqual({ kind: 'open', card: await s.planMuscles.rebalance(skip) });

    const applied = await s.planMuscles.applyCoach(rec.detail, rec.actionId, []);
    expect(applied.ok).toBe(true);
    // A double tap writes once.
    expect(await s.planMuscles.applyCoach(rec.detail, rec.actionId, [])).toMatchObject({ ok: true });
    expect(await s.planMuscles.coachCard(rec.detail, rec.actionId)).toEqual({ kind: 'applied' });
    expect((await s.planMuscles.muscles())?.view.bars.find((b) => b.group === 'Biceps')?.direct).toBe(2);

    await h.forceClose();
    const { services: again } = await h.launch();
    expect(await again.planMuscles.coachCard(rec.detail, rec.actionId)).toEqual({ kind: 'applied' });
    expect((await again.planMuscles.undoCoach(rec.detail, rec.actionId)).ok).toBe(true);
    expect(await again.planMuscles.coachCard(rec.detail, rec.actionId)).toEqual({ kind: 'undone' });
    expect((await again.planMuscles.muscles())?.view.bars.find((b) => b.group === 'Biceps')?.direct).toBe(0);
  });

  it('"rebalance my plan" on a plan that moved on since: Out of date, never applied to the newer plan (rule 5)', async () => {
    const { s } = await bensPlanNoCurls(h);
    model = new StepModel([() => toolCall('propose_rebalance', { reason: 'Ben asked.' }), () => replyWith('Here it is.')]);
    const r = await say(s, 'rebalance my plan');
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_rebalance')?.record;
    if (rec?.detail.kind !== 'propose_rebalance') throw new Error('no card');
    // The plan moves on: the screen's own Rebalance applied first.
    const screen = await s.planMuscles.rebalance();
    if (screen === null) throw new Error('no card');
    expect((await s.planMuscles.apply({ planId: screen.planId, expectedVersion: screen.planVersion, rejected: [], opId: 'screen-apply' })).ok).toBe(true);
    const was = await s.planMuscles.muscles();
    expect(await s.planMuscles.coachCard(rec.detail, rec.actionId)).toEqual({ kind: 'stale' });
    expect(await s.planMuscles.applyCoach(rec.detail, rec.actionId, [])).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.planMuscles.muscles())?.view.bars).toEqual(was?.view.bars);
    // Its Undo can't undo someone else's edit.
    expect((await s.planMuscles.undoCoach(rec.detail, rec.actionId)).ok).toBe(false);
  });

  it('after Apply the coach’s proposal still follows the engine: a card only when the screen’s Rebalance has lines, else one honest line', async () => {
    const { s } = await bensPlanNoCurls(h);
    const screen = await s.planMuscles.rebalance();
    if (screen === null) throw new Error('no card');
    expect((await s.planMuscles.apply({ planId: screen.planId, expectedVersion: screen.planVersion, rejected: [], opId: 'a1' })).ok).toBe(true);
    // Not necessarily all in range after one +2; check the line the coach gets matches what the engine says.
    const next = await s.planMuscles.coachProposal();
    const card = await s.planMuscles.rebalance();
    if (card?.empty === true) expect(next.kind).toBe('refused');
    else expect(next.kind).toBe('ok');
  });
});
