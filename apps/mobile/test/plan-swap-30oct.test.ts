import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { catalogueExerciseId } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { CoachEntry } from '../src/coach/coach-service';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 30 Oct, build 486) Real SQLite, the scripted model. Ben's 6-day PPL plan from the plan builder with Quad extra
 * answered `Split squat`, so leg extension is not preferred; leg extension is still in Legs A and Legs B (added to the
 * days since), leg press in Legs B. Mid-workout on Legs A he asks the coach "swap leg press and leg extension in the
 * full plan". Before: "Want me to change this week?" · "Nothing changed · 1 line hidden", three times.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Friday 30 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-30T08:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const LE = 'machine-leg-extension';
const LP = 'machine-leg-press';

async function setUpGym(s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

/** A catalogue exercise's row ID by its catalogue key, as the Swap / Add sheet lists it. */
async function idOf(s: AppServices, gymId: string, key: string): Promise<string> {
  const e = (await s.exercisePicker.forTemplate(gymId)).entries.find((x) => x.exercise.id === catalogueExerciseId(key));
  if (e === undefined) throw new Error(`no ${key}`);
  return e.exercise.id;
}

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

interface Ben {
  s: AppServices;
  gymId: string;
  le: string;
  lp: string;
  days: Map<string, string>;
}

/** The plan applied (Quad extra → Split squat), then leg extension added to Legs A and Legs B (Every week), leg press in Legs B. */
async function bensPlan(): Promise<Ben> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(s);
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs: { quads: 1 as const } };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const le = await idOf(s, gymId, LE);
  const lp = await idOf(s, gymId, LP);
  const active = await s.plans.active();
  const days = new Map((active?.days ?? []).map((d) => [d.name, d.routineId]));
  const legs = [...days.entries()].filter(([n]) => n.startsWith('Legs'));
  expect(legs.map(([n]) => n)).toEqual(['Legs A', 'Legs B']);
  // New plans skip a not-preferred exercise (ranked last, so not planned here).
  for (const [, id] of legs) expect((await template(s, id)).exercises.map((e) => e.exerciseId)).not.toContain(le);
  // Ben's days since: leg extension added to both legs days; leg press in Legs B.
  for (const [name, id] of legs) {
    let t = await template(s, id);
    const add = async (exerciseId: string) => {
      const r = await s.plans.editDayEveryWeek({ routineId: id, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: exerciseId, afterRowId: null } });
      if (!r.ok) throw new Error(`${name}: ${r.message}`);
      t = r.routine;
    };
    await add(le);
    if (name === 'Legs B' && !t.exercises.some((e) => e.exerciseId === lp)) await add(lp);
    if (name === 'Legs A') expect(t.exercises.map((e) => e.exerciseId)).not.toContain(lp);
  }
  return { s, gymId, le, lp, days };
}

function yourData(req: ModelRequest | undefined): Record<string, unknown> {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as Record<string, unknown>;
}

const say = (s: AppServices, text: string, entry: CoachEntry, threadId: string | null = null) => s.coach.send({ entry, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const sentences = (r: { items: readonly { kind: string; text?: string }[] }) => r.items.flatMap((i) => (i.kind === 'sentence' && i.text !== undefined ? [i.text] : []));
/** The model reads Ben's words the wrong way round: leg press out, leg extension in (catalogueIds from YOUR DATA). */
const swapWrongWay = (req: ModelRequest): ModelEvent[] => {
  const d = yourData(req) as { plan?: { inUse?: { days?: { exercises: { catalogueId: string }[] }[] } } };
  const ids = (d.plan?.inUse?.days ?? []).flatMap((x) => x.exercises.map((e) => e.catalogueId));
  if (!ids.includes(LP) || !ids.includes(LE)) throw new Error('plan days not in context');
  return toolCall('propose_plan_swap', { remove: LP, add: LE, reason: 'Ben asked to swap them across his plan.' });
};

async function liveLegsA(b: Ben): Promise<string> {
  const started = await b.s.workout.start({ gymId: b.gymId, opId: 'start-legs-a', checkIn: null, routineOf: b.days.get('Legs A') ?? '' });
  if (!started.ok) throw new Error(started.error.message);
  return started.aggregate.session.id;
}

describe('Ben’s live-workout chat (build 486): "swap leg press and leg extension in the full plan"', () => {
  it('a proposal the right way round (leg extension out); Apply changes only that exercise in every plan day; Undo restores them', async () => {
    const b = await bensPlan();
    const { s, le, lp } = b;
    const live = await liveLegsA(b);
    const legsA = b.days.get('Legs A') ?? '';
    const legsB = b.days.get('Legs B') ?? '';
    const before = { a: await template(s, legsA), b: await template(s, legsB), push: await template(s, b.days.get('Push A') ?? '') };
    model = new StepModel([swapWrongWay, () => replyWith('Here it is for every week.')]);
    const r = await say(s, 'swap leg press and leg extension in the full plan', { kind: 'workout', sessionId: live });
    // Offered on the live workout's own sheet, with the plan days and what he marked not preferred.
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan_swap');
    expect(yourData(model.requests[0]).notPreferred).toEqual([{ catalogueId: LE, name: 'Leg extension', use: 'never put this in his plan or a workout' }]);
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    expect([rec.detail.removeName, rec.detail.addName, rec.detail.flipped]).toEqual(['Leg extension', 'Leg press', true]);
    expect(rec.detail.days.map((d) => [d.routineName, d.edits.map((e) => e.kind)])).toEqual([
      ['Legs A', ['swap']],
      ['Legs B', ['remove']],
    ]);
    expect(sentences(r).join(' ')).not.toContain('change this week');
    expect(r.note ?? '').not.toContain('Nothing changed');
    // Nothing changed until Apply (rule 3).
    expect(await template(s, legsA)).toEqual(before.a);
    const card = await s.planSwap.card(rec.actionId);
    expect(card).toEqual({ kind: 'open', today: 'open' });

    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    // A double tap writes once.
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    const afterA = await template(s, legsA);
    const afterB = await template(s, legsB);
    // Legs A: the leg extension row now does leg press; its sets, reps, rest, place and superset kept.
    const rowA = before.a.exercises.find((e) => e.exerciseId === le);
    const nowA = afterA.exercises.find((e) => e.id === rowA?.id);
    expect(nowA?.exerciseId).toBe(lp);
    expect([nowA?.order, nowA?.supersetGroup, nowA?.setTemplates.length, nowA?.restBySetType]).toEqual([rowA?.order, rowA?.supersetGroup, rowA?.setTemplates.length, rowA?.restBySetType]);
    expect(afterA.exercises.filter((e) => e.id !== rowA?.id)).toEqual(before.a.exercises.filter((e) => e.id !== rowA?.id));
    // Legs B: leg press was already there, so leg extension goes; the rest as it was.
    expect(afterB.exercises.map((e) => e.exerciseId)).not.toContain(le);
    expect(afterB.exercises.filter((e) => e.exerciseId === lp)).toHaveLength(1);
    expect(afterB.exercises.length).toBe(before.b.exercises.length - 1);
    // A day without it never changes.
    expect(await template(s, b.days.get('Push A') ?? '')).toEqual(before.push);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'applied' });

    // Today too: the live Legs A row (none done) swapped, its own change with Undo; done sets never touched.
    expect(await s.planSwap.today(rec.actionId)).toBe(true);
    const agg = await s.workout.load(live);
    expect(agg?.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId)).not.toContain(le);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ today: 'done' });
    expect(await s.planSwap.undoToday(rec.actionId)).toBe(true);
    expect((await s.workout.load(live))?.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId)).toContain(le);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ today: 'open' });

    // Undo: every day's template exactly as before.
    expect(await s.planSwap.undo(rec.actionId, 'undo-swap')).toBe(true);
    expect((await template(s, legsA)).exercises).toEqual(before.a.exercises);
    expect((await template(s, legsB)).exercises).toEqual(before.b.exercises);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'undone' });
  });

  it('a day changed since the proposal: Apply is refused as out of date and nothing is half-applied (rule 5)', async () => {
    const b = await bensPlan();
    const { s } = b;
    const legsA = b.days.get('Legs A') ?? '';
    model = new StepModel([swapWrongWay, () => replyWith('Here it is.')]);
    const r = await say(s, 'swap leg press and leg extension in the full plan', { kind: 'today' });
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec === undefined) throw new Error('no card');
    // Legs B changes after the proposal (the day sheet's Every week).
    const legsB = b.days.get('Legs B') ?? '';
    const tb = await template(s, legsB);
    const first = tb.exercises[0];
    if (first === undefined) throw new Error('empty');
    expect((await s.plans.editDayEveryWeek({ routineId: legsB, expectedVersion: tb.version, opId: 'other-change', edit: { kind: 'remove', rowId: first.id, fromExerciseId: first.exerciseId, toExerciseId: null, afterRowId: null } })).ok).toBe(true);
    const beforeA = await template(s, legsA);
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: false, line: 'Out of date. Ask again.' });
    expect((await template(s, legsA)).exercises).toEqual(beforeA.exercises);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'open' });
  });
});

describe('the loop (build 486): the hidden line, "Yes", "full plan"', () => {
  it('"can’t change your full plan from this chat" → "Want me to change your plan?"; "Yes" acts: the proposal card', async () => {
    const b = await bensPlan();
    const live = await liveLegsA(b);
    model = new StepModel([() => replyWith("You want leg press replaced with leg extensions throughout your full plan. I can't change your full plan from this chat.")]);
    const r1 = await say(b.s, 'Can we swap leg press for leg extension across the full plan', { kind: 'workout', sessionId: live });
    expect(sentences(r1)).toContain('Want me to change your plan?');
    expect(sentences(r1).join(' ')).not.toContain('change this week');
    model = new StepModel([swapWrongWay, () => replyWith('Here it is.')]);
    const r2 = await say(b.s, 'Yes', { kind: 'workout', sessionId: live }, r1.threadId);
    expect(model.requests[0]?.instructions).toContain('answers your last offer');
    expect(r2.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
  });

  it('"full plan" after the week offer never gets "change this week?" again', async () => {
    const b = await bensPlan();
    const live = await liveLegsA(b);
    model = new StepModel([() => replyWith("I don't have a weekly-plan editing tool available in this chat.")]);
    const r1 = await say(b.s, 'Can we swap leg press for leg extension', { kind: 'workout', sessionId: live });
    model = new StepModel([() => replyWith("You mean leg extensions instead of leg press throughout your full plan. I can't change the full plan from here.")]);
    const r2 = await say(b.s, 'full plan', { kind: 'workout', sessionId: live }, r1.threadId);
    expect(sentences(r2).join(' ')).not.toContain('change this week');
    expect(sentences(r2)).toContain('Want me to change your plan?');
  });

  it('the coach never puts a not-preferred exercise in: one honest line on its card', async () => {
    const b = await bensPlan();
    // Leg extension out of both days first (applied), so it is no longer in the plan to turn round.
    model = new StepModel([swapWrongWay, () => replyWith('Here it is.')]);
    const r = await say(b.s, 'swap leg press and leg extension in the full plan', { kind: 'today' });
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    expect(await b.s.planSwap.apply(rec?.actionId ?? '')).toEqual({ ok: true });
    model = new StepModel([() => toolCall('propose_plan_swap', { remove: LP, add: LE, reason: 'He asked.' }), () => replyWith('Leg extension is marked not preferred.')]);
    const again = await say(b.s, 'put leg extension back in instead of leg press across my plan', { kind: 'today' });
    expect(again.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Not changed: Leg extension is not preferred in your plan settings.']]);
    for (const id of [b.days.get('Legs A') ?? '', b.days.get('Legs B') ?? '']) expect((await template(b.s, id)).exercises.map((e) => e.exerciseId)).not.toContain(b.le);
  });
});

describe('Settings › Any preferences: "In your plan: Legs A, Legs B · Replace"', () => {
  it('leg extension not preferred and in the plan: the line, its replacement (his pick), and Replace gives the same proposal', async () => {
    const b = await bensPlan();
    const legsA = b.days.get('Legs A') ?? '';
    const lines = await b.s.planSwap.inPlan({ prefs: { quads: 1 }, likes: [], never: [] });
    expect(lines).toEqual([{ key: LE, name: 'Leg extension', days: ['Legs A', 'Legs B'], replacement: { key: 'dumbbell-bulgarian-split-squat', name: expect.any(String) as string } }]);
    // No preference: no line.
    expect(await b.s.planSwap.inPlan({ prefs: { quads: 'either' }, likes: [], never: [] })).toEqual([]);
    const made = await b.s.planSwap.replace({ key: LE, replacementKey: 'dumbbell-bulgarian-split-squat', opId: 'replace-1' });
    if (!made.ok) throw new Error(made.line);
    // A double tap makes one proposal.
    expect(await b.s.planSwap.replace({ key: LE, replacementKey: 'dumbbell-bulgarian-split-squat', opId: 'replace-1' })).toEqual(made);
    expect(await b.s.planSwap.card(made.actionId)).toMatchObject({ kind: 'open' });
    expect(await b.s.planSwap.apply(made.actionId)).toEqual({ ok: true });
    expect((await template(b.s, legsA)).exercises.map((e) => e.exerciseId)).not.toContain(b.le);
    expect(await b.s.planSwap.inPlan({ prefs: { quads: 1 }, likes: [], never: [] })).toEqual([]);
    expect(await b.s.planSwap.undo(made.actionId, 'undo-replace')).toBe(true);
    expect((await b.s.planSwap.inPlan({ prefs: { quads: 1 }, likes: [], never: [] })).map((l) => l.days)).toEqual([['Legs A', 'Legs B']]);
  });

  it('restart: a proposal applied before a force-close shows applied after, and its Undo still works', async () => {
    const b = await bensPlan();
    const made = await b.s.planSwap.replace({ key: LE, replacementKey: 'dumbbell-bulgarian-split-squat', opId: 'replace-r' });
    if (!made.ok) throw new Error(made.line);
    expect(await b.s.planSwap.apply(made.actionId)).toEqual({ ok: true });
    await h.forceClose();
    const { services: again } = await h.launch();
    expect(await again.planSwap.card(made.actionId)).toMatchObject({ kind: 'applied' });
    expect(await again.planSwap.undo(made.actionId, 'undo-after-restart')).toBe(true);
    expect(await again.planSwap.card(made.actionId)).toMatchObject({ kind: 'undone' });
  });
});
