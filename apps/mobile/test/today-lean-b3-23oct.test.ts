
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, workingCount, type BuilderWorkout } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { workoutView } from '../src/builder/builder-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review todaylean re-review 1 (23 Oct) on real SQLite, offline. B3: a card Today filled above the plan's length goes
 * into Your workout with its fill recorded as Time's: Time at or below the plan's length gives Today's card at that
 * Time, more Time brings the fill back (never past it), and Start never offers the fill for the plan (D1). R1: an option
 * change on top of Ben's edits is refitted around them (FT5).
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 12 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const DAYS: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }], ['Triceps pushdown', { load: kgLoad(30, 'stack') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
];

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId, planId };
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no data');
  return d;
}
const sel = (data: TodaySessionData, dayKey: string, over: Partial<TodaySelection['controls']> = {}): TodaySelection => {
  const c = data.initial[dayKey];
  if (c === undefined) throw new Error(`no controls for ${dayKey}`);
  return { dayKey, controls: { ...c, ...over } };
};
const dayKeyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? data.others.find((d) => d.name === name)?.key ?? '';
const snapOf = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.snapshot === null) throw new Error(`no snapshot: ${r.status}`);
  return r.snapshot;
};

/** Today's `Edit`: the card committed as today's draft, then Your workout on it (as the screen does). */
async function edit(s: AppServices, data: TodaySessionData, selection: TodaySelection, opId = 'edit-1'): Promise<BuilderSnapshot> {
  const c = await s.todaySession.commit(data, selection, opId);
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}


const ids = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => x.exerciseId);
const shape = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((x) => `${x.exerciseId}×${String(workingCount(x))}`).join('+'));


const cardAt = (s: AppServices, data: TodaySessionData, key: string, minutes: number) => {
  const c = s.todaySession.card(data, sel(data, key, { minutes }));
  if (c?.draft == null) throw new Error(`no card at ${String(minutes)}`);
  return c;
};

describe('B3: a card Today filled above the plan’s length goes into Your workout with the fill as Time’s', () => {
  it('Today 90 → Edit: the filled card with Today’s note; Time 60 is Today’s card at 60 (the plan day, not over)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    const card90 = cardAt(s, data, key, 90);
    const card60 = cardAt(s, data, key, plan);
    // The fixture really fills at 90.
    expect(slotsOf(card90.draft?.workout.blocks ?? []).length).toBeGreaterThan(slotsOf(card60.draft?.workout.blocks ?? []).length);
    const snap = await edit(s, data, sel(data, key, { minutes: 90 }));
    expect(shape(snap.workout)).toEqual(shape(card90.draft?.workout ?? { blocks: [], restLevel: 'normal' }));
    const t = workoutView(snap).time;
    expect(t.note).toBe(card90.time?.note);
    expect(t.undoMinutes).toBe(plan);
    const at60 = snapOf(await s.builder.setTime(snap.draftId, plan, { opId: 't-60', expectedVersion: snap.version }));
    expect(shape(at60.workout)).toEqual(shape(card60.draft?.workout ?? { blocks: [], restLevel: 'normal' }));
    expect(at60.over).toBe(false);
    expect(at60.minutes).toBe(card60.minutes);
    // Undo: the filled card again.
    const undone = snapOf(await s.builder.undo(at60.draftId, 't-60', 'undo-t-60'));
    expect(shape(undone.workout)).toEqual(shape(snap.workout));
  });

  it('Today 90 → Edit → Time 30 is Today’s card at 30; the note names only the plan day’s exercises', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    const card30 = cardAt(s, data, key, 30);
    const planIds = new Set(slotsOf(cardAt(s, data, key, plan).draft?.workout.blocks ?? []).map((x) => x.exerciseId));
    const snap = await edit(s, data, sel(data, key, { minutes: 90 }));
    const at30 = snapOf(await s.builder.setTime(snap.draftId, 30, { opId: 't-30', expectedVersion: snap.version }));
    expect(shape(at30.workout)).toEqual(shape(card30.draft?.workout ?? { blocks: [], restLevel: 'normal' }));
    const t = workoutView(at30).time;
    expect(t.note).toBe(card30.time?.note);
    expect(t.lines).toEqual(card30.time?.lines);
    for (const st of at30.time?.changes ?? []) if (st.kind === 'drop' || st.kind === 'sets') expect(planIds.has(st.exerciseId), st.exerciseId).toBe(true);
    // And more Time from there: the plan day at its length, then the fill back at 90 (never past it at 120).
    const at60 = snapOf(await s.builder.setTime(at30.draftId, plan, { opId: 't-60b', expectedVersion: at30.version }));
    expect(shape(at60.workout)).toEqual(shape(cardAt(s, data, key, plan).draft?.workout ?? { blocks: [], restLevel: 'normal' }));
    const at75 = snapOf(await s.builder.setTime(at60.draftId, 75, { opId: 't-75', expectedVersion: at60.version }));
    expect(shape(at75.workout)).toEqual(shape(cardAt(s, data, key, 75).draft?.workout ?? { blocks: [], restLevel: 'normal' }));
    const at90 = snapOf(await s.builder.setTime(at75.draftId, 90, { opId: 't-90', expectedVersion: at75.version }));
    expect(shape(at90.workout)).toEqual(shape(snap.workout));
    const at120 = snapOf(await s.builder.setTime(at90.draftId, 120, { opId: 't-120', expectedVersion: at90.version }));
    expect(shape(at120.workout)).toEqual(shape(snap.workout));
  });

  it('Start after Today 90 lists none of Time’s additions (D1: Time never asks), and the plan keeps its length', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const full = await edit(s, data, sel(data, key), 'edit-full');
    const fullPrompt = await s.builder.startPrompt(full.draftId);
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const data2 = await loaded(s2);
    const snap = await edit(s2, data2, sel(data2, key, { minutes: 90 }), 'edit-90');
    expect(snap.draftId).toBe(full.draftId);
    const prompt = await s2.builder.startPrompt(snap.draftId);
    expect(prompt?.lines ?? []).toEqual(fullPrompt?.lines ?? []);
    // After a restart, the same (the record is stored with the draft).
    await h.forceClose();
    const s3 = (await h.launch()).services;
    expect((await s3.builder.startPrompt(snap.draftId))?.lines ?? []).toEqual(fullPrompt?.lines ?? []);
  });

  it('Ben’s edit on the filled card stays through Time 60 and back; the fill never counts as his', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    let snap = await edit(s, data, sel(data, key, { minutes: 90 }));
    const main = slotsOf(snap.workout.blocks).find((x) => x.main);
    if (main === undefined) throw new Error('no main');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: main.key }, { opId: 'main-set', basis: { version: snap.version } }));
    const mainSets = workingCount(slotsOf(snap.workout.blocks).find((x) => x.main) ?? { rows: [] });
    const at60 = snapOf(await s.builder.setTime(snap.draftId, plan, { opId: 't-60', expectedVersion: snap.version }));
    expect(workingCount(slotsOf(at60.workout.blocks).find((x) => x.main) ?? { rows: [] })).toBe(mainSets);
    const card60 = cardAt(s, data, key, plan).draft?.workout ?? { blocks: [], restLevel: 'normal' };
    expect(ids(at60)).toEqual(slotsOf(card60.blocks).map((x) => x.exerciseId));
    // Start at 90 asks what it asks at the plan's length (his extra main-lift set), never the fill.
    const at60Lines = (await s.builder.startPrompt(at60.draftId))?.lines ?? [];
    const at90 = snapOf(await s.builder.setTime(at60.draftId, 90, { opId: 't-90', expectedVersion: at60.version }));
    expect(workingCount(slotsOf(at90.workout.blocks).find((x) => x.main) ?? { rows: [] })).toBe(mainSets);
    expect(slotsOf(at90.workout.blocks).length).toBeGreaterThan(slotsOf(at60.workout.blocks).length);
    expect((await s.builder.startPrompt(at90.draftId))?.lines ?? []).toEqual(at60Lines);
    expect(at60Lines.some((l) => l.includes('sets') && l.includes(String(mainSets)))).toBe(true);
  });
});

describe('R1 (FT5): an option change on top of Ben’s edits is refitted around them', () => {
  it('Today 30 → Edit → +1 set on an accessory → Abs on → Varied: within 30 each time, his set kept, Undo exact', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { minutes: 30, abs: false, accessories: 'focused' }));
    const acc = slotsOf(snap.workout.blocks).find((x) => !x.main);
    if (acc === undefined) throw new Error('no accessory');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: acc.key }, { opId: 'acc-set', basis: { version: snap.version } }));
    const mine = workingCount(slotsOf(snap.workout.blocks).find((x) => x.key === acc.key) ?? { rows: [] });
    const abs = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: true }, { opId: 'abs-on', expectedVersion: snap.version }));
    expect(abs.setup.minutes).toBe(30);
    expect(abs.minutes).toBeLessThanOrEqual(30);
    expect(workingCount(slotsOf(abs.workout.blocks).find((x) => x.key === acc.key) ?? { rows: [] })).toBe(mine);
    const varied = snapOf(await s.builder.setTodayOption(abs.draftId, { kind: 'accessories', style: 'varied' }, { opId: 'varied', expectedVersion: abs.version }));
    expect(varied.minutes).toBeLessThanOrEqual(30);
    // Time's cuts are listed as Time's (note), and Start lists none of them.
    for (const l of (await s.builder.startPrompt(varied.draftId))?.lines ?? []) expect(l.startsWith('Delete'), l).toBe(false);
    const back = snapOf(await s.builder.undo(varied.draftId, 'varied', 'undo-varied'));
    expect(shape(back.workout)).toEqual(shape(abs.workout));
  });
});
