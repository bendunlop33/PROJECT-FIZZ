import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, workingCount, type BuilderWorkout } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { todayOptionsView, workoutView } from '../src/builder/builder-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review todaylean fixes (23 Oct) on real SQLite, offline: Today's Time fit goes with the draft into Your workout
 * (B2), Today's options on Your workout load Today's own draft for the choice at Time with Ben's edits replayed
 * (S2/S3, §2.3a), the switches read the draft's own state (S1, S6), Abs off removes his own ab exercise too.
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

/** A second Push template, for the incline press (the plan day's two main lifts; Today's old Main lift chips). */
async function withInclineTemplate(s: AppServices, planId: string): Promise<AppServices> {
  const file = s.developer.databaseNames().current;
  await h.forceClose();
  const db = new DatabaseSync(join(h.dir, file));
  const rows = db.prepare('SELECT id, owner_id, updated_at_utc, data FROM routines').all() as { id: string; owner_id: string; updated_at_utc: string; data: string }[];
  const push = rows.find((r) => (JSON.parse(r.data) as { createdFromPlan?: { planId: string; splitDayId?: string } }).createdFromPlan?.splitDayId === 'push');
  if (push === undefined) throw new Error('no push template');
  const doc = JSON.parse(push.data) as { createdFromPlan?: unknown; exercises: { exerciseId: string; main?: boolean; order: number }[] } & Record<string, unknown>;
  const incline = doc.exercises[1]?.exerciseId;
  if (incline === undefined) throw new Error('no incline');
  const rest: Record<string, unknown> = { ...doc };
  delete rest.createdFromPlan;
  const id = 'b1c2d3e4-0000-4000-8000-000000000001';
  const clone = { ...rest, id, version: 1, name: 'Push · incline', planDay: { planId, dayIndex: 0, splitDayId: 'push', mainLiftExerciseId: incline, minutes: 60 }, exercises: [...doc.exercises.filter((e) => e.exerciseId === incline), ...doc.exercises.filter((e) => e.exerciseId !== incline)].map((e, i) => ({ ...e, order: i, main: e.exerciseId === incline })) };
  db.prepare('INSERT INTO routines (id, owner_id, version, updated_at_utc, data) VALUES (?, ?, ?, ?, ?)').run(id, push.owner_id, 1, push.updated_at_utc, JSON.stringify(clone));
  db.close();
  return (await h.launch()).services;
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
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => snap.facts[x.exerciseId]?.name ?? '?');
const pairs = (w: BuilderWorkout) => w.blocks.filter((b) => b.slots.length > 1);
const toastOf = (r: BuilderWriteResult) => (r.status === 'written' || r.status === 'replayed' ? r.toast : null);

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

describe('B2: a card Today fitted to its Time goes into Your workout with its fit', () => {
  it('Today Time 20 → Edit: Time 20 with Today’s note and Undo; Time 60 brings back the plan day’s full workout', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    const card20 = s.todaySession.card(data, sel(data, key, { minutes: 20 }));
    const full = s.todaySession.card(data, sel(data, key));
    const snap = await edit(s, data, sel(data, key, { minutes: 20 }));
    expect(snap.setup.minutes).toBe(20);
    expect(ids(snap)).toEqual(card20?.rows.map((r) => r.exerciseId));
    const t = workoutView(snap).time;
    expect(t.note).toBe(card20?.time?.note);
    expect(t.lines).toEqual(card20?.time?.lines);
    expect(t.undoMinutes).toBe(plan);
    const back = snapOf(await s.builder.setTime(snap.draftId, plan, { opId: 't-plan', expectedVersion: snap.version }));
    expect(ids(back)).toEqual(full?.rows.map((r) => r.exerciseId));
    expect(back.time).toBeNull();
    // Back on Today: the card is the plan day again, at the plan's length (nothing Ben changed).
    expect(names(back).length).toBeGreaterThan(1);
  });

  it('Start after a Today Time fit lists none of Time’s cuts (D1: Time never asks); the plan keeps its length', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const full = await edit(s, data, sel(data, key), 'edit-full');
    const fullPrompt = await s.builder.startPrompt(full.draftId);
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const data2 = await loaded(s2);
    const snap = await edit(s2, data2, sel(data2, key, { minutes: 30 }), 'edit-30');
    expect(snap.draftId).toBe(full.draftId);
    expect(workoutView(snap).time.note).not.toBeNull();
    const prompt = await s2.builder.startPrompt(snap.draftId);
    // Whatever Today's own draft differs from the template by (the same at 30 and at the plan's length), never a Time cut.
    expect(prompt?.lines ?? []).toEqual(fullPrompt?.lines ?? []);
    for (const l of prompt?.lines ?? []) expect(l.startsWith('Delete')).toBe(false);
  });

  it('Today’s Supersets choice is the draft’s, even when the fit left nothing paired (review S6)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const snap = await edit(s, data, sel(data, key, { supersets: true, minutes: 20 }));
    expect(pairs(snap.workout)).toHaveLength(0);
    expect(snap.setup.supersets).toBe(true);
    expect(snap.today?.supersets).toBe(true);
    expect((await s.builder.todayOptions(snap.draftId))?.supersets).toBe(true);
  });
});

describe('S2 / S3: an option on Your workout gives what Today’s card gives for that choice at that Time, Ben’s edits on top', () => {
  it('Today 20 → Edit → Abs on: fitted to 20 again; Accessories Varied at 20: fitted too (never over Time)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { minutes: 20, abs: false }));
    snap = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: true }, { opId: 'abs-20', expectedVersion: snap.version }));
    expect(snap.setup.minutes).toBe(20);
    expect(snap.minutes).toBeLessThanOrEqual(20);
    expect(ids(snap)).toEqual(s.todaySession.card(data, sel(data, key, { minutes: 20, abs: true }))?.rows.map((r) => r.exerciseId));
    // The abs Time left out are listed as Time's; Abs reads on.
    expect(snap.today?.abs).toBe(true);
    snap = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'accessories', style: 'varied' }, { opId: 'varied-20', expectedVersion: snap.version }));
    expect(snap.minutes).toBeLessThanOrEqual(20);
  });

  it('at 45 and at the plan’s length: Abs on, Varied and Supersets on equal Today’s card for that choice (exercises, sets and pairs)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    for (const minutes of [45, data.initial[key]?.minutes ?? 60]) {
      const changes: [Partial<TodaySelection['controls']>, Parameters<typeof s.builder.setTodayOption>[1]][] = [
        [{ abs: true }, { kind: 'abs', on: true }],
        [{ accessories: 'varied' }, { kind: 'accessories', style: 'varied' }],
        [{ supersets: true }, { kind: 'supersets', on: true }],
      ];
      for (const [over, change] of changes) {
        await h.forceClose();
        const s2 = (await h.launch()).services;
        const d2 = await loaded(s2);
        // A fresh draft each time: the day's draft from Today at this Time, with the plan's controls.
        const snap0 = await edit(s2, d2, sel(d2, key, { minutes, abs: false, accessories: 'focused', supersets: false }), `edit-${String(minutes)}-${change.kind}`);
        const r = snapOf(await s2.builder.setTodayOption(snap0.draftId, change, { opId: `opt-${String(minutes)}-${change.kind}`, expectedVersion: snap0.version }));
        const card = s2.todaySession.card(d2, sel(d2, key, { minutes, abs: false, accessories: 'focused', supersets: false, ...over }));
        if (card?.draft == null) throw new Error('no card');
        expect(shape(r.workout), `${String(minutes)} min, ${change.kind}`).toEqual(shape(card.draft.workout));
        expect(r.minutes).toBe(card.minutes);
        // Undo: exactly the workout before (rows, Time and the option).
        const back = snapOf(await s2.builder.undo(r.draftId, `opt-${String(minutes)}-${change.kind}`, `undo-${String(minutes)}-${change.kind}`));
        expect(shape(back.workout)).toEqual(shape(snap0.workout));
        expect(back.today).toEqual(snap0.today);
        expect(back.setup.minutes).toBe(minutes);
        // Start lists none of Time's cuts.
        for (const l of (await s2.builder.startPrompt(r.draftId))?.lines ?? []) expect(l.startsWith('Delete'), l).toBe(false);
      }
    }
  });

  it('acceptance (5): delete an accessory, then Abs on and off: it stays deleted; his own sets stay too', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { abs: false, supersets: false }));
    const acc = slotsOf(snap.workout.blocks).filter((x) => !x.main);
    const gone = acc[acc.length - 1];
    const mine = acc[0];
    if (gone === undefined || mine === undefined || gone.key === mine.key) throw new Error('need two accessories');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: gone.key }, { opId: 'del', basis: { version: snap.version } }));
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: mine.key }, { opId: 'set', basis: { version: snap.version } }));
    const on = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: true }, { opId: 'abs-on', expectedVersion: snap.version }));
    expect(ids(on)).not.toContain(gone.exerciseId);
    expect(workingCount(slotsOf(on.workout.blocks).find((x) => x.key === mine.key) ?? { rows: [] })).toBe(workingCount(mine) + 1);
    expect(on.today?.abs).toBe(true);
    const off = snapOf(await s.builder.setTodayOption(on.draftId, { kind: 'abs', on: false }, { opId: 'abs-off', expectedVersion: on.version }));
    expect(ids(off)).not.toContain(gone.exerciseId);
    expect(ids(off)).toEqual(ids(snap));
    expect(off.today?.abs).toBe(false);
  });

  it('Main lift: Today’s draft for that lift at Time, Ben’s deletion kept; toast `Main lift: Incline`; Undo puts Bench back', async () => {
    const first = await benWithPlan();
    const s = await withInclineTemplate(first.s, first.planId);
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const day = data.days.find((d) => d.key === key);
    const incline = day?.templates[1]?.mainLiftExerciseId ?? '';
    let snap = await edit(s, data, sel(data, key));
    const pushdown = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.group === 'Triceps');
    if (pushdown === undefined) throw new Error('no pushdown');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: pushdown.key }, { opId: 'del-pd', basis: { version: snap.version } }));
    const r = await s.builder.setTodayOption(snap.draftId, { kind: 'main_lift', exerciseId: incline }, { opId: 'main-incline', expectedVersion: snap.version });
    expect(toastOf(r)).toEqual({ text: 'Main lift: Incline', undoOpId: 'main-incline', why: null });
    const now = snapOf(r);
    const card = s.todaySession.card(data, sel(data, key, { mainLiftExerciseId: incline }));
    expect(ids(now)).toEqual((card?.rows ?? []).map((x) => x.exerciseId).filter((x) => x !== pushdown.exerciseId));
    expect(now.today?.mainLiftExerciseId).toBe(incline);
    const back = snapOf(await s.builder.undo(now.draftId, 'main-incline', 'undo-main'));
    expect(ids(back)).toEqual(ids(snap));
  });
});

describe('S1 and the Abs switch: the options read the draft as it is after every write', () => {
  it('Supersets off → Undo: the snapshot says on again; a swipe-delete of the ab exercise turns Abs off', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { supersets: true, abs: true }));
    expect(snap.today).toMatchObject({ supersets: true, abs: true });
    const off = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: false }, { opId: 'ss-off', expectedVersion: snap.version }));
    expect(off.today?.supersets).toBe(false);
    snap = snapOf(await s.builder.undo(off.draftId, 'ss-off', 'undo-ss-off'));
    expect(snap.today?.supersets).toBe(true);
    // The switch's next tap (off) is a real change, not a replay.
    expect((await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: false }, { opId: 'ss-off-2', expectedVersion: snap.version })).status).toBe('written');
    const cur = await s.builder.read(snap.draftId);
    if (cur === null) throw new Error('gone');
    const ab = slotsOf(cur.workout.blocks).find((x) => cur.facts[x.exerciseId]?.group === 'Abs');
    if (ab === undefined) throw new Error('no abs');
    const swiped = snapOf(await s.builder.edit(cur.draftId, { kind: 'delete_exercise', slotKey: ab.key }, { opId: 'swipe-abs', basis: { version: cur.version } }));
    expect(swiped.today?.abs).toBe(false);
  });

  it('Abs off removes an ab exercise Ben added himself (the switch read on, and off did nothing)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { abs: false }));
    expect(snap.today?.abs).toBe(false);
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Abs' });
    const pick = choices?.sections[0]?.items[0]?.exerciseId;
    if (pick === undefined) throw new Error('no ab exercise');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: pick }, { opId: 'add-ab', basis: { version: snap.version } }));
    expect(snap.today?.abs).toBe(true);
    const off = await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: false }, { opId: 'abs-off-own', expectedVersion: snap.version });
    expect(off.status).toBe('written');
    expect(toastOf(off)?.text).toBe('Abs off');
    expect(ids(snapOf(off))).not.toContain(pick);
    expect(snapOf(off).today?.abs).toBe(false);
  });

  it('Your workout from a no-plan Today card has no Today options (the card keeps its own; review N3)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const data = await loaded(s);
    const snap = await edit(s, data, sel(data, dayKeyOf(data, 'Full body')));
    expect(await s.builder.todayOptions(snap.draftId)).toBeNull();
    expect(snap.today).toBeNull();
  });

  it('restart recovery and rule 5: an option change under an op ID writes once, survives a force-close, and a stale one is refused', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const snap = await edit(s, data, sel(data, key, { minutes: 30, abs: false }));
    const on = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: true }, { opId: 'abs-rc', expectedVersion: snap.version }));
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const read = await s2.builder.read(on.draftId);
    expect(read?.version).toBe(on.version);
    expect(read?.today).toEqual(on.today);
    expect(workoutView(read ?? on).time).toEqual(workoutView(on).time);
    expect((await s2.builder.setTodayOption(on.draftId, { kind: 'abs', on: true }, { opId: 'abs-rc', expectedVersion: on.version })).status).not.toBe('written');
    expect((await s2.builder.setTodayOption(on.draftId, { kind: 'abs', on: false }, { opId: 'abs-stale', expectedVersion: on.version - 1 })).status).toBe('stale');
    expect((await s2.builder.read(on.draftId))?.version).toBe(on.version);
  });
});

describe('todayOptionsView (pure): the rows read the snapshot’s state, never a list fetched earlier', () => {
  it('main lift chips, accessories, abs and supersets follow the snapshot; no Today state, no rows', async () => {
    const first = await benWithPlan();
    const s = await withInclineTemplate(first.s, first.planId);
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const snap = await edit(s, data, sel(data, key, { supersets: true, abs: true }));
    const list = await s.builder.todayOptions(snap.draftId);
    if (list === null || snap.today === null) throw new Error('no options');
    const stale = { ...list, abs: false, supersets: false, accessories: 'varied' as const, mainLifts: list.mainLifts.map((m) => ({ ...m, selected: !m.selected })) };
    const v = todayOptionsView(stale, snap);
    expect(v).toEqual({ mainLifts: list.mainLifts, accessories: snap.today.accessories, abs: true, supersets: true });
    expect(todayOptionsView(stale, { ...snap, today: null })).toBeNull();
    expect(todayOptionsView(null, snap)).toBeNull();
  });
});

describe('S4: an edited card with a plan keeps Time (D3: Time is one of the lean card’s parts)', () => {
  it('the draft’s Time, note and Undo on Today’s card; a step there is Your workout’s Time on that draft (Ben’s edits never cut)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    let snap = await edit(s, data, sel(data, key, { abs: false, supersets: false }));
    const mine = slotsOf(snap.workout.blocks).find((x) => !x.main);
    if (mine === undefined) throw new Error('no accessory');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: mine.key }, { opId: 'mine', basis: { version: snap.version } }));
    let card = s.todaySession.card(await loaded(s), sel(data, key));
    expect(card?.edited?.draftId).toBe(snap.draftId);
    expect(card?.time).toMatchObject({ minutes: plan, note: null, undoMinutes: null });
    // A step down on Today's card (the screen calls Your workout's Time on the draft).
    snap = snapOf(await s.builder.setTime(snap.draftId, 30, { opId: 'today-30', expectedVersion: snap.version }));
    const after = await loaded(s);
    card = s.todaySession.card(after, sel(after, key));
    expect(card?.edited?.draftId).toBe(snap.draftId);
    expect(card?.time?.minutes).toBe(30);
    expect(card?.time?.note).toBe(workoutView(snap).time.note);
    expect(card?.time?.lines).toEqual(workoutView(snap).time.lines);
    expect(card?.time?.undoMinutes).toBe(plan);
    expect(card?.rows.map((r) => r.exerciseId)).toEqual(ids(snap));
    // His edited accessory is never cut by Time (FT5).
    expect(workingCount(slotsOf(snap.workout.blocks).find((x) => x.key === mine.key) ?? { rows: [] })).toBe(workingCount(mine) + 1);
    // The screen: an edited card's steps and the detail's Undo go to Your workout's Time on the draft.
    const screen = readFileSync(join(__dirname, '..', 'src', 'screens', 'TodayScreen.tsx'), 'utf8');
    expect(screen).toContain('services.builder.setTime(e.draftId, minutes, { opId: newUuid(), expectedVersion: e.version })');
    expect(screen).toContain('if (view?.edited != null) void editedTime(minutes);');
  });
});
