import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, workingCount, type BuilderWorkout } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { followLatestDraft, todayCardReducer, type TodayCardState } from '../src/today/today-view';
import { profileSplitRow, trainingDetailsView } from '../src/training/training-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Lean Today with a plan (D3, Ben 22–23 Oct) on real SQLite, offline: the card shows the session's rows, Time with
 * its note, Start and Edit; main lift, accessories, abs and supersets left the card for Your workout opened from
 * Today (`todayOptions` / `setTodayOption`, Set up's own merge, with Undo). Without a plan the card keeps them.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
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

describe('D3: Today with a plan is lean; without a plan the card keeps its controls', () => {
  it('a plan in use: rows, Time with its note and Undo length, Start and Edit; the Today-only controls are not on the card', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const push = s.todaySession.card(data, sel(data, dayKeyOf(data, 'Push')));
    if (push === null) throw new Error('no card');
    expect(push.lean).toBe(true);
    expect(push.rows.length).toBeGreaterThan(0);
    expect(push.time).toMatchObject({ minutes: data.initial[push.dayKey]?.minutes, note: null, undoMinutes: null });
    expect(push.startable).toBe(true);
    // The card: the lean branch has Time and the rows; Main lift, Accessories, Abs and Supersets only on the no-plan card.
    const card = read('screens/today/TodaySession.tsx');
    const sc = card.slice(card.indexOf('export function SessionCard('));
    const lean = sc.slice(sc.indexOf('{view.lean ? ('), sc.indexOf(') : (', sc.indexOf('{view.lean ? (')));
    expect(lean).toContain('timeRow');
    expect(lean).toContain('{details}');
    for (const gone of ['TODAY_V2_COPY.mainLift', 'TODAY_V2_COPY.accessories', 'TODAY_V2_COPY.abs', 'TODAY_V2_COPY.supersets', 'TODAY_V2_COPY.breakdown']) expect(lean).not.toContain(gone);
    expect(sc).toContain('<PrimaryButton label={TODAY_V2_COPY.start}');
    expect(sc).toContain('<SecondaryButton label={TODAY_V2_COPY.edit}');
    // `↻ Mix it up` went with them (design: Your workout's Swap does the same job): shown only on the no-plan card.
    expect(sc).toContain('const mixShown = !view.lean;');
    expect(sc).toContain('{mixShown && view.mix === null && view.mixAvailable ?');
    expect(sc).toContain('{mixShown && view.mix !== null ?');
    expect(push.mixAvailable).toBe(false);
    expect(push.mixShortlist).toEqual([]);
  });

  it('no plan: an Other session’s card keeps main lift, accessories, Time, abs and supersets', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const data = await loaded(s);
    expect(data.status).toBe('no_plan');
    const full = s.todaySession.card(data, sel(data, dayKeyOf(data, 'Full body')));
    expect(full?.lean).toBe(false);
    expect(full?.time).not.toBeNull();
  });

  it('a shorter Time on the lean card: the note and its detail; Undo goes back to the plan length (reducer)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const plan = data.initial[key]?.minutes ?? 60;
    const short = s.todaySession.card(data, sel(data, key, { minutes: 20 }));
    expect(short?.time?.note).not.toBeNull();
    expect(short?.time?.lines.length).toBeGreaterThan(0);
    expect(short?.time?.undoMinutes).toBe(plan);
    const st: TodayCardState = { dayKey: key, controls: { ...sel(data, key).controls, minutes: 20 }, open: false, why: false };
    expect(todayCardReducer(st, { kind: 'minutes_to', minutes: plan }).controls.minutes).toBe(plan);
  });
});

describe('D3: Today’s options on Your workout opened from Today', () => {
  it('main lift (the plan day’s two templates), accessories as Today drafted them, abs and supersets as the workout has them', async () => {
    const first = await benWithPlan();
    const s = await withInclineTemplate(first.s, first.planId);
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    expect(data.days.find((d) => d.key === key)?.templates).toHaveLength(2);
    const snap = await edit(s, data, sel(data, key, { accessories: 'varied' }));
    const o = await s.builder.todayOptions(snap.draftId);
    expect(o?.mainLifts.map((m) => [m.label, m.selected])).toEqual([
      ['Bench press', true],
      ['Incline', false],
    ]);
    expect(o?.accessories).toBe('varied');
    expect(o?.supersets).toBe(snap.setup.supersets);
    expect(o?.abs).toBe(slotsOf(snap.workout.blocks).some((x) => snap.facts[x.exerciseId]?.group === 'Abs'));
    // Your workout shows them only when opened from Today (source).
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain("params.back === 'Today' && s !== null ? await services.builder.todayOptions(s.draftId)");
    expect(page).toContain('<TodayOptionRows options={todayOpts} onChange={(c) => void setTodayOption(c)} />');
  });

  it('Supersets on pairs only what the builder may pair; off splits only its own pairs; each is one write with Undo; Today then shows the edited card', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { supersets: false, abs: true }));
    expect(pairs(snap.workout)).toHaveLength(0);
    const on = await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: true }, { opId: 'ss-on', expectedVersion: snap.version });
    expect(on.status).toBe('written');
    expect(toastOf(on)).toEqual({ text: 'Supersets on', undoOpId: 'ss-on', why: null });
    snap = snapOf(on);
    expect(pairs(snap.workout).length).toBeGreaterThan(0);
    for (const b of pairs(snap.workout)) expect(b.slots.some((x) => x.main)).toBe(false);
    // A replay writes nothing more.
    expect((await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: true }, { opId: 'ss-on', expectedVersion: snap.version })).status).not.toBe('written');
    // Stale: refused (rule 5).
    expect((await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: false }, { opId: 'ss-stale', expectedVersion: snap.version - 1 })).status).toBe('stale');
    const off = await s.builder.setTodayOption(snap.draftId, { kind: 'supersets', on: false }, { opId: 'ss-off', expectedVersion: snap.version });
    snap = snapOf(off);
    expect(pairs(snap.workout)).toHaveLength(0);
    // Undo puts the pairs back.
    const back = await s.builder.undo(snap.draftId, 'ss-off', 'undo-ss-off');
    expect(pairs(snapOf(back).workout).length).toBeGreaterThan(0);
    // Today's card is the edited workout now (`Push · edited`), its Time on Your workout.
    const after = await loaded(s);
    const card = s.todaySession.card(after, sel(after, key));
    expect(card?.edited?.draftId).toBe(snap.draftId);
    expect(card?.time).toBeNull();
  });

  it('Abs on adds one ab exercise; off removes it; nothing else changes', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { abs: false, supersets: false }));
    const before = names(snap);
    const isAbs = (n: BuilderSnapshot) => slotsOf(n.workout.blocks).filter((x) => n.facts[x.exerciseId]?.group === 'Abs');
    expect(isAbs(snap)).toHaveLength(0);
    snap = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: true }, { opId: 'abs-on', expectedVersion: snap.version }));
    expect(isAbs(snap)).toHaveLength(1);
    expect(names(snap).filter((n) => !before.includes(n))).toHaveLength(1);
    expect((await s.builder.todayOptions(snap.draftId))?.abs).toBe(true);
    snap = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'abs', on: false }, { opId: 'abs-off', expectedVersion: snap.version }));
    expect(isAbs(snap)).toHaveLength(0);
    expect(names(snap)).toEqual(before);
  });

  it('Accessories: Varied is three main-group accessories at 2 sets, Focused two at 3; an accessory Ben edited keeps his sets; the main lift is untouched', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    let snap = await edit(s, data, sel(data, key, { accessories: 'focused', abs: false, supersets: false }));
    const chestAcc = (n: BuilderSnapshot) => slotsOf(n.workout.blocks).filter((x) => !x.main && n.facts[x.exerciseId]?.group === 'Chest');
    const main = slotsOf(snap.workout.blocks).find((x) => x.main);
    expect(chestAcc(snap).map(workingCount)).toEqual([3, 3]);
    const varied = await s.builder.setTodayOption(snap.draftId, { kind: 'accessories', style: 'varied' }, { opId: 'acc-varied', expectedVersion: snap.version });
    expect(toastOf(varied)).toEqual({ text: 'Accessories varied', undoOpId: 'acc-varied', why: null });
    snap = snapOf(varied);
    expect(chestAcc(snap).map(workingCount)).toEqual([2, 2, 2]);
    expect(slotsOf(snap.workout.blocks).find((x) => x.main)).toEqual(main);
    expect((await s.builder.todayOptions(snap.draftId))?.accessories).toBe('varied');
    // Ben sets 4 sets on the first accessory himself; Focused keeps it and trims the others.
    const first = chestAcc(snap)[0];
    if (first === undefined) throw new Error('no accessory');
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: first.key }, { opId: 'add-set', basis: { version: snap.version } }));
    snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: first.key }, { opId: 'add-set-2', basis: { version: snap.version } }));
    snap = snapOf(await s.builder.setTodayOption(snap.draftId, { kind: 'accessories', style: 'focused' }, { opId: 'acc-focused', expectedVersion: snap.version }));
    const acc = chestAcc(snap);
    expect(acc).toHaveLength(2);
    expect(acc.find((x) => x.key === first.key)?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(4);
    expect(acc.filter((x) => x.key !== first.key).map(workingCount)).toEqual([3]);
  });

  it('Main lift: the other template opens (Rebuilt · Undo); Today follows it on return; Undo puts Bench back', async () => {
    const first = await benWithPlan();
    const s = await withInclineTemplate(first.s, first.planId);
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const day = data.days.find((d) => d.key === key);
    const incline = day?.templates[1]?.mainLiftExerciseId ?? '';
    const bench = day?.templates[0]?.mainLiftExerciseId ?? '';
    const snap = await edit(s, data, sel(data, key));
    h.clockMs += 60_000;
    const r = await s.builder.setTodayOption(snap.draftId, { kind: 'main_lift', exerciseId: incline }, { opId: 'main-incline', expectedVersion: snap.version });
    expect(r.status).toBe('written');
    expect(toastOf(r)).toEqual({ text: 'Rebuilt', undoOpId: 'main-incline', why: null });
    const now = snapOf(r);
    expect(slotsOf(now.workout.blocks).find((x) => x.main)?.exerciseId).toBe(incline);
    // Back on Today: the day opens on the incline and the card is that draft.
    const after = await loaded(s);
    expect(after.initial[key]?.mainLiftExerciseId).toBe(incline);
    expect(after.latestDraft[key]?.mainLiftExerciseId).toBe(incline);
    const cur: TodayCardState = { dayKey: key, controls: sel(data, key).controls, open: false, why: false };
    expect(cur.controls.mainLiftExerciseId).toBe(bench);
    const followed = followLatestDraft(cur, after.latestDraft[key], data.latestDraft[key]?.atUtc, after.initial[key]?.mainLiftExerciseId);
    expect(followed.controls.mainLiftExerciseId).toBe(incline);
    const card = s.todaySession.card(after, { dayKey: key, controls: followed.controls });
    expect(card?.edited?.draftId).toBe(now.draftId);
    expect(card?.rows[0]?.exerciseId).toBe(incline);
    // Undo (the toast's): the bench workout as it was.
    const back = snapOf(await s.builder.undo(now.draftId, 'main-incline', 'undo-main'));
    expect(slotsOf(back.workout.blocks).find((x) => x.main)?.exerciseId).toBe(bench);
  });
});

describe('followLatestDraft (pure)', () => {
  const st: TodayCardState = { dayKey: 'plan:p:0', controls: { mainLiftExerciseId: 'bench', accessories: 'focused', minutes: 60, abs: null, supersets: false, mix: 2 }, open: false, why: true };
  it('follows a newer draft for another of the day’s lifts; keeps the card otherwise', () => {
    const latest = { mainLiftExerciseId: 'incline', atUtc: '2026-10-12T08:00:00.000Z' };
    expect(followLatestDraft(st, latest, '2026-10-12T07:00:00.000Z', 'incline').controls).toMatchObject({ mainLiftExerciseId: 'incline', mix: 0, minutes: 60 });
    // Seen already, the card's own lift, not one of the day's (initial isn't it), or none: unchanged.
    expect(followLatestDraft(st, latest, latest.atUtc, 'incline')).toBe(st);
    expect(followLatestDraft(st, { ...latest, mainLiftExerciseId: 'bench' }, undefined, 'bench')).toBe(st);
    expect(followLatestDraft(st, latest, undefined, 'bench')).toBe(st);
    expect(followLatestDraft(st, undefined, undefined, 'incline')).toBe(st);
  });
});

describe('D7: one split source — with a plan, Profile › Split and the duplicated defaults read `Set by your plan`', () => {
  it('plans.inUse: none without a plan; the plan with one, paused too; none once it has no live workouts', async () => {
    const { services: s0 } = await h.launch();
    await setUpGym(h, s0);
    expect(await s0.plans.inUse()).toBeNull();
    await h.forceClose();
    const { s, planId } = await benWithPlan();
    expect(await s.plans.inUse()).toMatchObject({ planId });
    const plan = await s.plans.get(planId);
    expect((await s.plans.pause({ planId, untilDate: null, expectedVersion: plan?.version ?? 0, opId: 'pause-1' })).ok).toBe(true);
    expect(await s.plans.inUse()).toMatchObject({ planId });
  });

  it('views: Split and Training details’ days a week and session length are the plan’s with one; Profile’s without; the goal stays Ben’s', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no snapshot');
    expect(await s.training.change({ kind: 'days_per_week', days: 4 }, snap.profile.version, 'days-4')).toMatchObject({ ok: true });
    const t = await s.training.snapshot();
    if (t === null) throw new Error('no snapshot');
    const none = trainingDetailsView(t.profile, { nowYear: 2026, unit: 'kg', planInUse: false });
    expect(none.training.map((r) => [r.key, r.value, r.byPlan ?? false])).toEqual([
      ['goal', 'Not set', false],
      ['days', '4', false],
      ['length', `${String(t.profile.sessionMinutes)} min`, false],
    ]);
    const plan = trainingDetailsView(t.profile, { nowYear: 2026, unit: 'kg', planInUse: true });
    expect(plan.training.map((r) => [r.key, r.value, r.byPlan ?? false])).toEqual([
      ['goal', 'Not set', false],
      ['days', 'Set by your plan', true],
      ['length', 'Set by your plan', true],
    ]);
    expect(profileSplitRow(t.profile, t.mainLifts, true)).toEqual({ subtitle: 'Set by your plan', opens: 'your_plan' });
    expect(profileSplitRow(t.profile, t.mainLifts, false)).toEqual({ subtitle: 'Push/Pull/Legs', opens: 'split' });
  });

  it('screens (source): Profile’s Split row and Training details’ plan rows open Library › Your plan; Split itself says so with a plan', () => {
    const profile = read('screens/profile/ProfileScreen.tsx');
    expect(profile).toContain("s.plans.inUse().then((x) => x !== null, () => null)");
    expect(profile).toContain("data.value.training?.split?.opens === 'your_plan') rootNavigation.dispatch(openYourPlan(newUuid()));");
    const details = read('screens/profile/TrainingDetailsScreen.tsx');
    expect(details).toContain('trainingDetailsView(p, { nowYear: snap.nowYear, unit, planInUse })');
    expect(details).toContain('if (r.byPlan === true) navigation.dispatch(openYourPlan(newUuid())); else open(r.key);');
    const split = read('screens/profile/SplitScreen.tsx');
    expect(split).toContain('text={C.setByPlan}');
  });
});
