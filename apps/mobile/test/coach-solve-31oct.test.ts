import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { catalogueExerciseId } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { applyProgress, planSwapLines, startLiveTurn, thinkingLabel } from '../src/coach/sheet-view';
import { CONNECTED, contextWorkout, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 31 Oct, build 493) Real SQLite, the scripted model. Mid-workout on Pull A the coach found no direct arm work and
 * asked "Want me to swap hanging leg raises for curls today?". Ben: "Can we just add them in after the raises. Can u fix
 * the plan too?" Before: "No answer in time. Nothing changed." Now today's add is made first (straight after the
 * raises, with Undo), then the plan add comes as a proposal (each day before/after, Apply, Undo).
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Saturday 31 Oct 2026, 18:00 in London.
  h = createHarness('2026-10-31T18:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const HLR = 'bodyweight-hanging-leg-raise';
const CURL = 'dumbbell-curl';
const ASK = 'Can we just add them in after the raises. Can u fix the plan too?';

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

/** Ben's PPL plan applied; hanging leg raises added to the end of Pull A; Pull A started. */
async function bensPullDay(prefs: Record<string, 0 | 1> = {}): Promise<{ s: AppServices; days: Map<string, string>; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(s);
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5], prefs }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  const pullA = days.get('Pull A') ?? '';
  const pullB = days.get('Pull B') ?? '';
  for (const id of [pullA, pullB]) expect((await template(s, id)).exercises.map((e) => e.exerciseId)).not.toContain(catalogueExerciseId(CURL));
  const t = await template(s, pullA);
  if (!t.exercises.some((e) => e.exerciseId === catalogueExerciseId(HLR))) {
    const added = await s.plans.editDayEveryWeek({ routineId: pullA, expectedVersion: t.version, opId: h.ids(), edit: { kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: catalogueExerciseId(HLR), afterRowId: null } });
    if (!added.ok) throw new Error(added.message);
  }
  const started = await s.workout.start({ gymId, opId: 'start-pull-a', checkIn: null, routineOf: pullA });
  if (!started.ok) throw new Error(started.error.message);
  return { s, days, sessionId: started.aggregate.session.id };
}

/** Today's add, straight after the raises (IDs from YOUR DATA). */
const addAfterRaises = (req: ModelRequest): ModelEvent[] => {
  const w = contextWorkout(req);
  const raises = w.exercises.find((e) => /hanging leg raise/i.test(e.name));
  if (raises === undefined) throw new Error(`no raises in ${w.exercises.map((e) => e.name).join(', ')}`);
  return toolCall('edit_today', {
    baseVersion: w.version,
    ops: [{ op: 'add', exerciseId: CURL, workingSets: 3, reps: { min: 10, max: 12 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: raises.sessionExerciseId, supersetWithSessionExerciseId: null }],
    reason: 'Ben asked for curls after the raises.',
    benAsked: true,
    benQuote: 'Can we just add them in after the raises',
  });
};
const planAdd = (): ModelEvent[] => toolCall('propose_plan_add', { add: CURL, days: ['Pull A', 'Pull B'], after: HLR, workingSets: 3, reps: { min: 10, max: 12 }, load: null, reason: 'No direct biceps work in the plan.' });

describe('Ben’s live Pull A chat (build 493): "add them in after the raises … fix the plan too"', () => {
  it('today’s add applies at once, after the raises, with Undo; the plan add follows as a proposal; Apply and Undo both work', async () => {
    const { s, days, sessionId } = await bensPullDay();
    const pullA = days.get('Pull A') ?? '';
    const pullB = days.get('Pull B') ?? '';
    const before = { a: await template(s, pullA), b: await template(s, pullB), push: await template(s, days.get('Push A') ?? '') };
    model = new StepModel([addAfterRaises, planAdd, () => replyWith('Keep the curls strict.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: ASK, spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    // Today first, light; the plan part after it.
    expect(model.requests.map((q) => q.effort)).toEqual(['low', 'high', 'high']);
    expect(model.requests[0]?.instructions).toContain('Ben asked for two things');
    expect(model.requests[0]?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['edit_today', 'propose_plan_add', 'propose_plan_swap']));

    // Today: committed (he asked), straight after the raises.
    const today = r.cards.find((c) => c.record.detail.kind === 'edit_today')?.record;
    expect(today?.status).toBe('committed');
    const rows = (await s.workout.load(sessionId))?.aggregate.exercises.filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order) ?? [];
    const names = rows.map((e) => e.exerciseName);
    expect(names[names.findIndex((n) => /hanging leg raise/i.test(n)) + 1]).toMatch(/curl/i);

    // The plan: a proposal, each day before/after; nothing changed until Apply (rule 3).
    const rec = r.cards.find((c) => c.record.detail.kind === 'propose_plan_swap')?.record;
    if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
    expect(rec.status).toBe('proposed');
    expect(rec.detail.op).toBe('add');
    expect(planSwapLines(rec)).toEqual({ head: '+ Dumbbell curl · 3 × 10–12', days: ['Pull A: after Hanging leg raise', 'Pull B: after Hanging leg raise'] });
    // Each day's before and after, for the card.
    for (const d of rec.detail.days) {
      expect(d.after?.length).toBe((d.before?.length ?? 0) + 1);
      expect(d.after?.[(d.after.indexOf('Hanging leg raise')) + 1]).toBe('Dumbbell curl');
    }
    expect(await template(s, pullA)).toEqual(before.a);
    expect(await s.planSwap.card(rec.actionId)).toEqual({ kind: 'open', today: null });

    // Apply: curls straight after the raises in both pull days, every week (a double tap writes once); other days untouched.
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
    for (const id of [pullA, pullB]) {
      const rowsNow = (await template(s, id)).exercises.sort((x, y) => x.order - y.order);
      const ids = rowsNow.map((e) => e.exerciseId);
      expect(ids.filter((x) => x === catalogueExerciseId(CURL))).toHaveLength(1);
      expect(ids[ids.indexOf(catalogueExerciseId(HLR)) + 1]).toBe(catalogueExerciseId(CURL));
      const curl = rowsNow.find((e) => e.exerciseId === catalogueExerciseId(CURL));
      expect(curl?.setTemplates.map((t) => t.targetReps)).toEqual([{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }]);
      // No weight named: none typed in; the workout plans it from history and the gym's kit.
      expect(curl?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    }
    expect(await template(s, days.get('Push A') ?? '')).toEqual(before.push);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'applied' });

    // Undo: both days back as they were.
    expect(await s.planSwap.undo(rec.actionId, h.ids())).toBe(true);
    expect((await template(s, pullA)).exercises).toEqual(before.a.exercises);
    expect((await template(s, pullB)).exercises).toEqual(before.b.exercises);
    expect(await s.planSwap.card(rec.actionId)).toMatchObject({ kind: 'undone' });
  });

  it('a slow plan part never blocks today’s change: the add stays with its card when the plan step times out', async () => {
    const { s, sessionId } = await bensPullDay();
    model = new StepModel([addAfterRaises, () => [{ type: 'error', error: 'timeout' }], () => [{ type: 'error', error: 'timeout' }]]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'words', text: ASK, spoken: false }, turnId: h.ids() });
    expect(r.cards.find((c) => c.record.detail.kind === 'edit_today')?.record.status).toBe('committed');
    const rows = (await s.workout.load(sessionId))?.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseName) ?? [];
    expect(rows.some((n) => /curl/i.test(n))).toBe(true);
    // Two requests after the add, never a third: the lighter retry, then an honest failure.
    expect(model.requests).toHaveLength(3);
    expect(r.error).toBe('timeout');
  });

  it('never an exercise Ben marked not preferred; an unknown plan day is refused with the days there are', async () => {
    // Quad extra → Split squat: leg extension is not preferred (Any preferences).
    const { s } = await bensPullDay({ quads: 1 });
    const no = await s.planSwap.prepareAdd({ add: 'machine-leg-extension', days: ['Legs A'], after: null, sets: 3, reps: null, load: null });
    expect(no).toMatchObject({ kind: 'refused', line: 'Leg extension is not preferred in your plan settings' });
    const unknown = await s.planSwap.prepareAdd({ add: CURL, days: ['Arms day'], after: null, sets: 3, reps: null, load: null });
    expect(unknown.kind === 'refused' ? unknown.line : null).toMatch(/^No plan day called Arms day; the days are Push A, Pull A/);
  });

  it('a weight Ben named is kept as typed in the plan rows (rule 4)', async () => {
    const { s } = await bensPullDay();
    const r = await s.planSwap.prepareAdd({ add: CURL, days: ['Pull B'], after: null, sets: 3, reps: { min: 10, max: 12 }, load: 12 });
    if (r.kind !== 'ok') throw new Error(r.line);
    expect(r.detail.load).toEqual({ value: 12, unit: 'kg', convention: 'per_hand' });
  });
});

describe('the running turn shows its long think (Ben, 31 Oct)', () => {
  it('`Thinking…` with the time so far while a high-effort step works; `Short answer…` on the retry after a timeout', () => {
    const live = startLiveTurn('t1', { kind: 'words', text: 'does the plan train enough biceps?', spoken: false }, 0);
    expect(thinkingLabel(live, 1000)).toBe('Coach · …');
    const hard = applyProgress(live, { kind: 'thinking', mode: 'hard' });
    expect(thinkingLabel(hard, 1000)).toBe('Thinking…');
    expect(thinkingLabel(hard, 42_000)).toBe('Thinking… 0:42');
    expect(thinkingLabel(applyProgress(hard, { kind: 'thinking', mode: 'short' }), 75_000)).toBe('Short answer… 1:15');
  });
});
