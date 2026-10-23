import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct; review batch23-design SP6, v3summary SP8) `⋯ Save as a variation` on Your workout for a plan day: the
 * workout as Ben has it saved as a new variation of its template (extras on the template, §4.3), one write under an op
 * ID, Undo deletes it; the template's version is checked (rule 5); the 5-a-key limit and one name each hold. Real SQLite.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const PUSH = ['Bench press', 'Incline dumbbell press', 'Cable fly', 'Lateral raise', 'Triceps pushdown'];
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', PUSH],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const built = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 2-day plan', spoken: false }, turnId: h.ids() });
  const plan = built.cards[0]?.record;
  if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId };
}

async function editFromToday(s: AppServices): Promise<BuilderSnapshot> {
  const data: TodaySessionData | null = await s.todaySession.load();
  if (data === null) throw new Error('no Today');
  const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
  const controls = data.initial[key];
  if (controls === undefined) throw new Error('no controls');
  const c = await s.todaySession.commit(data, { dayKey: key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => snap.facts[x.exerciseId]?.name ?? '?');

async function withAdd(s: AppServices, snap: BuilderSnapshot): Promise<{ snap: BuilderSnapshot; added: string }> {
  const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: null });
  const pick = choices?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt);
  if (pick === undefined) throw new Error('nothing to add');
  const r = await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: pick.exerciseId }, { opId: h.ids(), basis: { version: snap.version } });
  if (r.status !== 'written') throw new Error(`add ${r.status}`);
  return { snap: r.snapshot, added: pick.name };
}

describe('⋯ Save as a variation (Ben, 23 Oct)', () => {
  it('offered for a plan day from Today’s Edit; saves the added exercise as a variation of the template; Set up lists it; opening it gives the workout back; Undo deletes it', async () => {
    const { s } = await benWithPlan();
    const snap = await editFromToday(s);
    expect(snap.canSaveVariation).toBe(true);
    const { snap: more, added } = await withAdd(s, snap);
    expect((await s.builder.variationPrefill(more.draftId))?.length).toBeGreaterThan(0);
    const r = await s.builder.saveAsVariation(more.draftId, { label: 'with extra', opId: 'var-1' });
    if (!r.ok) throw new Error(r.message);
    expect(r.undo).toEqual({ id: expect.any(String) as string, version: 1, label: 'with extra' });
    // A retry is the same save.
    expect(await s.builder.saveAsVariation(more.draftId, { label: 'with extra', opId: 'var-1' })).toEqual(r);
    // The draft itself is unchanged (Start stays today only).
    expect((await s.builder.read(more.draftId))?.version).toBe(more.version);
    const facts = await s.builder.setupFacts(more.setup);
    expect(facts.variations.map((v) => v.label)).toEqual(['with extra']);
    const routineId = more.planDay?.templateRoutineId ?? '';
    const opened = await s.builder.openTemplate({ routineId, variationId: r.undo.id }, 'open-var');
    if (opened.status !== 'written' && opened.status !== 'replayed') throw new Error('no open');
    expect(names(opened.snapshot)).toContain(added);
    const u = await s.builder.deleteVariation(r.undo.id, { opId: 'del-var-1', expectedVersion: r.undo.version });
    expect(u.ok).toBe(true);
    expect((await s.builder.setupFacts(more.setup)).variations).toEqual([]);
  });

  it('a name already used and the limit of 5 are refused; nothing is written', async () => {
    const { s } = await benWithPlan();
    const { snap } = await withAdd(s, await editFromToday(s));
    expect((await s.builder.saveAsVariation(snap.draftId, { label: 'v1', opId: 'lim-1' })).ok).toBe(true);
    expect(await s.builder.saveAsVariation(snap.draftId, { label: 'V1 ', opId: 'lim-dup' })).toEqual({ ok: false, message: 'Name already used' });
    for (const n of [2, 3, 4, 5]) expect((await s.builder.saveAsVariation(snap.draftId, { label: `v${String(n)}`, opId: `lim-${String(n)}` })).ok).toBe(true);
    expect(await s.builder.saveAsVariation(snap.draftId, { label: 'v6', opId: 'lim-6' })).toEqual({ ok: false, message: 'Limit reached' });
    expect((await s.builder.setupFacts(snap.setup)).variations).toHaveLength(5);
  });

  it('the template changed since the workout opened it: refused (rule 5), nothing saved', async () => {
    const { s } = await benWithPlan();
    const { snap } = await withAdd(s, await editFromToday(s));
    const routineId = snap.planDay?.templateRoutineId ?? '';
    const version = (await s.routines.editor({ routineId, gymId: null }))?.routine?.version ?? 0;
    const w = await s.library.addToWorkout({ exerciseId: catalogueExerciseId('bodyweight-plank'), shape: { workingSets: 2, warmups: 0, reps: null, durationS: 45, effort: { scale: 'rpe', value: null }, repsTouched: true }, to: { kind: 'routine', routineId, expectedVersion: version }, opId: 'plank-to-template' });
    expect(w?.ok).toBe(true);
    expect(await s.builder.saveAsVariation(snap.draftId, { label: 'late', opId: 'var-late' })).toEqual({ ok: false, message: 'Changed since · not kept' });
    expect((await s.builder.setupFacts(snap.setup)).variations).toEqual([]);
  });

  it('the plan day opened as stored (no change at all): `Same as the plan day`, nothing saved', async () => {
    const { s } = await benWithPlan();
    const push = (await s.plans.active())?.days[0]?.routineId ?? '';
    const opened = await s.builder.openTemplate({ routineId: push }, 'open-same');
    if (opened.status !== 'written' && opened.status !== 'replayed') throw new Error('no open');
    expect(opened.snapshot.canSaveVariation).toBe(true);
    expect(await s.builder.variationPrefill(opened.snapshot.draftId)).toBeNull();
    expect(await s.builder.saveAsVariation(opened.snapshot.draftId, { label: 'same', opId: 'var-same' })).toEqual({ ok: false, message: 'Same as the plan day' });
    expect((await s.builder.setupFacts(opened.snapshot.setup)).variations).toEqual([]);
  });

  it('not offered for a workout that isn’t a plan day (Build your own)', async () => {
    const { s } = await benWithPlan();
    const setup = await s.builder.initialSetup();
    const made = await s.builder.create({ ...setup, dayId: 'custom', dayName: 'Custom', groups: [{ group: 'Chest', count: 2 }], groupsEdited: true }, 'byo');
    if (made.status !== 'written' && made.status !== 'replayed') throw new Error('no draft');
    expect(made.snapshot.canSaveVariation).toBe(false);
  });
});
