import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { PlanBuilderAnswers, Routine, RoutineExercise, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { applyTemplateEdit, openTemplate, saveTemplate, type TemplateEditOp, type TemplateEditorCtx, type TemplateOpened } from '../src/workout/template-editor';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct, build 435: "If I add superset it doesn't then change the plan") Every way a superset (and any other
 * structure change) reaches a running 6-week Push/Pull/Legs plan, on real SQLite, offline:
 *  - the plan builder's Supersets = Yes: plan → its workouts → Today's card → Your workout → the workout → Summary →
 *    next time, and Library › Plan › day (this week and later weeks);
 *  - Library › Plan › day › Edit (the plan day's workout): saved, it is the plan day from now on (Today, later weeks);
 *    Undo; done weeks as they were (rule 2);
 *  - Today › Edit before Start: today only, unless Ben applies `Keep for next time?` (Skip changes nothing; Apply then
 *    Undo; a stale Apply is refused; a retry is one write; a force-close keeps it);
 *  - mid-workout `Superset with…`: offered by `Keep for next time?` the same way;
 *  - a new block week's sync keeps Ben's superset.
 * Root cause (before the fix): Today rebuilt a plan day from its muscle groups (`buildFromSetup` → auto pairs, default
 * set counts) instead of the plan day's stored exercises, so a superset, order or set count saved to the plan day never
 * reached Today; Keep for next time? ignored supersets and mid-workout edits; Library › Plan read only the stored
 * versions.
 */

const DAY = 86_400_000;
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

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** A running 6-week Push/Pull/Legs plan at 45 minutes, Supersets as asked, offline. */
async function ppl(s: AppServices, gymId: string, supersets = true): Promise<{ planId: string }> {
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Back squat', sets: [{ load: 120, reps: 5, rpe: 8 }] },
    { exercise: 'Barbell row', sets: [{ load: 80, reps: 8, rpe: 8 }] },
  ]);
  h.clockMs += 3_600_000;
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a: PlanBuilderAnswers = { ...session.answers, sessions: 3, split: 'ppl', minutes: 45, supersets, weeks: 6 };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error(`not built: ${built.reason}`);
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  return { planId: built.planId };
}

async function routineOf(s: AppServices, day: string): Promise<Routine> {
  const ov = await s.plans.overview();
  const d = ov?.days.find((x) => x.name.split('·')[0]?.trim() === day);
  const r = d === undefined ? null : ((await s.routines.editor({ routineId: d.routineId, gymId: null }))?.routine ?? null);
  if (r === null) throw new Error(`no ${day} workout`);
  return r;
}

/** Exercise names in order with their superset letter (`A`) or `-`, as a string per row. */
async function shapeOf(s: AppServices, exercises: readonly Pick<RoutineExercise, 'exerciseId' | 'supersetGroup' | 'order'>[]): Promise<string[]> {
  const info = await s.routines.exerciseInfo(exercises.map((e) => e.exerciseId));
  return [...exercises].sort((a, b) => a.order - b.order).map((e) => `${info[e.exerciseId]?.name ?? '?'}${e.supersetGroup === null ? '' : ` [ss]`}`);
}
/** Pairs as sets of names (letters aside), so two shapes compare by who is paired with whom. */
function pairsOfRoutine(names: Map<string, string>, exercises: readonly Pick<RoutineExercise, 'exerciseId' | 'supersetGroup'>[]): string[] {
  const by = new Map<string, string[]>();
  for (const e of exercises) if (e.supersetGroup !== null) by.set(e.supersetGroup, [...(by.get(e.supersetGroup) ?? []), names.get(e.exerciseId) ?? '?']);
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort().join(' + ')).sort();
}
const pairsOfSnap = (snap: BuilderSnapshot): string[] =>
  snap.workout.blocks
    .filter((b) => b.slots.length > 1)
    .map((b) => b.slots.map((x) => snap.facts[x.exerciseId]?.name ?? '?').sort().join(' + '))
    .sort();
const pairsOfSession = (a: SessionAggregate): string[] => {
  const by = new Map<string, string[]>();
  for (const e of a.exercises.filter((x) => x.removed === undefined)) if (e.supersetGroup !== null) by.set(e.supersetGroup, [...(by.get(e.supersetGroup) ?? []), e.exerciseName]);
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort().join(' + ')).sort();
};
async function namesOf(s: AppServices, ids: readonly string[]): Promise<Map<string, string>> {
  const info = await s.routines.exerciseInfo(ids);
  return new Map(ids.map((id) => [id, info[id]?.name ?? '?'] as const));
}

/** Today's card for a plan day: its rows' pairs (by name) and minutes. */
async function todayCard(s: AppServices, day: string): Promise<{ pairs: string[]; names: string[]; minutes: number; key: string }> {
  const data = await loaded(s);
  const d = data.days.find((x) => x.name === day);
  const controls = d === undefined ? undefined : data.initial[d.key];
  if (d === undefined || controls === undefined) throw new Error(`no ${day}`);
  const card = s.todaySession.card(data, { dayKey: d.key, controls });
  if (card === null) throw new Error('no card');
  const groups = new Map<number, string[]>();
  for (const r of card.rows) if (r.superset !== null) groups.set(r.superset.block, [...(groups.get(r.superset.block) ?? []), r.name]);
  return { pairs: [...groups.values()].map((g) => [...g].sort().join(' + ')).sort(), names: card.rows.map((r) => r.name), minutes: card.minutes, key: d.key };
}

/** Today's card for a day committed and opened on Your workout (Today's `Edit`). */
async function editFromToday(s: AppServices, day: string): Promise<BuilderSnapshot> {
  const data = await loaded(s);
  const d = data.days.find((x) => x.name === day);
  const controls = d === undefined ? undefined : data.initial[d.key];
  if (d === undefined || controls === undefined) throw new Error(`no ${day}`);
  const c = await s.todaySession.commit(data, { dayKey: d.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}
const ok = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${r.message}`);
  return r.snapshot;
};
async function startAndFinish(s: AppServices, snap: BuilderSnapshot, gymId: string): Promise<string> {
  const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
  if (!r.ok) throw new Error(r.message);
  await finishWorkout(h, s, r.sessionId);
  return r.sessionId;
}

/** The plan day's workout opened in the one editor (Library › Plan › day › `Edit`), an edit, Save. */
async function editPlanDay(s: AppServices, routineId: string, ops: (page: { list: RoutineExercise[]; ctx: TemplateEditorCtx; nameOf: (id: string) => string }) => TemplateEditOp[]): Promise<{ routine: Routine; undo: unknown }> {
  const o: TemplateOpened | null = await openTemplate(s, { routineId });
  if (o === null) throw new Error('could not open');
  const ctx: TemplateEditorCtx = { info: o.info, facts: o.facts, gym: o.data.gym, unit: o.data.unit, globalDefault: o.data.globalDefault, effortScale: o.data.effortScale, stored: o.data.routine?.exercises ?? [] };
  let list = o.list;
  for (const op of ops({ list, ctx, nameOf: (id) => o.info[id]?.name ?? '?' })) list = applyTemplateEdit(list, op, ctx, () => h.ids()).list;
  const r = await saveTemplate(s.routines, { target: { kind: 'edit', routineId, copy: false }, edit: { name: o.name, exercises: list }, expectedVersion: o.data.routine?.version ?? null, opId: h.ids() });
  if (r.kind !== 'saved') throw new Error(`not saved: ${r.kind}`);
  return { routine: r.routine, undo: r.toast.undo };
}

function nextMonday(): void {
  const now = new Date(h.clockMs);
  const back = (now.getUTCDay() + 6) % 7;
  h.clockMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7, 7);
}

describe('Supersets on a running plan (Ben, 27 Oct, build 435)', () => {
  it('plan builder Supersets = Yes: the pairs are the plan day’s, on Today’s card, Your workout, the workout, Library › Plan (this week and later), and next time', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await ppl(s, gymId);
    for (const day of ['Push', 'Pull', 'Legs']) {
      const r = await routineOf(s, day);
      const names = await namesOf(s, r.exercises.map((e) => e.exerciseId));
      const planned = pairsOfRoutine(names, r.exercises);
      expect(planned.length).toBeGreaterThan(0);
      const card = await todayCard(s, day);
      expect(card.pairs).toEqual(planned);
      expect(card.names).toEqual((await shapeOf(s, r.exercises)).map((x) => x.replace(' [ss]', '')));
    }
    // Pull: Your workout (Today's Edit), Start, finish: the pairs ride through; nothing for Keep to offer.
    const pull = await routineOf(s, 'Pull');
    const pullNames = await namesOf(s, pull.exercises.map((e) => e.exerciseId));
    const snap = await editFromToday(s, 'Pull');
    expect(pairsOfSnap(snap)).toEqual(pairsOfRoutine(pullNames, pull.exercises));
    const sessionId = await startAndFinish(s, snap, gymId);
    const a = (await s.workout.load(sessionId))?.aggregate;
    if (a === undefined) throw new Error('no workout');
    expect(pairsOfSession(a)).toEqual(pairsOfRoutine(pullNames, pull.exercises));
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
    // Library › Plan › Pull: this week's rows and week 3's carry the superset labels.
    const now = await s.plans.planDay(pull.id, { targetsHit: false });
    expect(now?.rows.filter((r) => r.superset !== null).map((r) => r.superset)).toEqual(expect.arrayContaining(['A1', 'A2']));
    const w3 = await s.plans.planDay(pull.id, { targetsHit: false, week: 3 });
    expect(w3?.week?.rows.filter((r) => r.superset !== null).map((r) => r.name).sort()).toEqual(pairsOfRoutine(pullNames, pull.exercises).flatMap((p) => p.split(' + ')).sort());
    // Next time: the same pairs on Today's card.
    h.clockMs += DAY;
    expect((await todayCard(s, 'Pull')).pairs).toEqual(pairsOfRoutine(pullNames, pull.exercises));
  });

  it('a 45-minute plan: every day on Today is about 45 minutes or less at the plan’s own length', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await ppl(s, gymId);
    const data = await loaded(s);
    for (const day of ['Push', 'Pull', 'Legs']) {
      const d = data.days.find((x) => x.name === day);
      expect(d === undefined ? null : data.initial[d.key]?.minutes).toBe(45);
      expect((await todayCard(s, day)).minutes).toBeLessThanOrEqual(45);
    }
  });

  it('Library › Plan › day › Edit: a superset saved to the plan day is the plan day from now on (Today, Your workout, later weeks); Undo; a done week as it was', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    // Week 1: Legs done (a done day of a done week never changes).
    const legsSnap = await editFromToday(s, 'Legs');
    await startAndFinish(s, legsSnap, gymId);
    nextMonday();
    const push = await routineOf(s, 'Push');
    expect(push.exercises.every((e) => e.supersetGroup === null)).toBe(true);
    const week1Before = JSON.stringify((await s.plans.planDay((await routineOf(s, 'Legs')).id, { targetsHit: false, week: 1 }))?.week?.rows);
    // Edit › the last two exercises as a superset, one exercise moved up, a set more on the first accessory › Save.
    const sorted = [...push.exercises].sort((a, b) => a.order - b.order);
    const second = sorted[sorted.length - 2];
    const first = sorted[1];
    if (second === undefined || first === undefined) throw new Error('short day');
    const saved = await editPlanDay(s, push.id, () => [
      { kind: 'superset_next', slotId: second.id },
      { kind: 'add_set', slotId: first.id },
    ]);
    const names = await namesOf(s, saved.routine.exercises.map((e) => e.exerciseId));
    const pairs = pairsOfRoutine(names, saved.routine.exercises);
    expect(pairs).toHaveLength(1);
    // Today's card and Your workout have it; so does Library › Plan › day › `Open Push` (the builder on the plan day).
    expect((await todayCard(s, 'Push')).pairs).toEqual(pairs);
    const opened = await s.builder.openTemplate({ routineId: push.id }, h.ids());
    if (opened.status !== 'written' && opened.status !== 'replayed') throw new Error('not opened');
    expect(pairsOfSnap(opened.snapshot)).toEqual(pairs);
    const snap = await editFromToday(s, 'Push');
    expect(pairsOfSnap(snap)).toEqual(pairs);
    const firstSlot = slotsOf(snap.workout.blocks).find((x) => x.exerciseId === first.exerciseId);
    expect(firstSlot?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(first.setTemplates.filter((t) => t.setType !== 'warmup').length + 1);
    // Library › Plan › Push in later weeks: the superset; Legs in done week 1: as it was.
    const w4 = await s.plans.planDay(push.id, { targetsHit: false, week: 4 });
    expect(w4?.week?.rows.filter((r) => r.superset !== null).map((r) => r.name).sort()).toEqual(pairs[0]?.split(' + ').sort());
    expect(JSON.stringify((await s.plans.planDay((await routineOf(s, 'Legs')).id, { targetsHit: false, week: 1 }))?.week?.rows)).toBe(week1Before);
    // A new block week's sync keeps it.
    nextMonday();
    await s.plans.syncWeek();
    expect(pairsOfRoutine(names, (await routineOf(s, 'Push')).exercises)).toEqual(pairs);
    // Undo of the save: the plan day as before (only while unchanged since).
    const u = await s.routines.revert({ actionId: (saved.undo as { actionId: string }).actionId, opId: h.ids() });
    expect(u.ok).toBe(true);
    expect((await routineOf(s, 'Push')).exercises.every((e) => e.supersetGroup === null)).toBe(true);
    expect((await todayCard(s, 'Push')).pairs).toEqual([]);
  });

  it('Today › Edit: a superset is today only; Skip leaves the plan; Keep for next time? Apply keeps it (grouping and order), Undo, retry and stale; a force-close keeps it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    const before = await routineOf(s, 'Pull');
    const names = await namesOf(s, before.exercises.map((e) => e.exerciseId));
    // Your workout: the last two exercises paired.
    const pairUp = async (): Promise<{ snap: BuilderSnapshot; pair: string }> => {
      let snap = await editFromToday(s, 'Pull');
      const slots = slotsOf(snap.workout.blocks);
      const a = slots[slots.length - 2];
      const b = slots[slots.length - 1];
      if (a === undefined || b === undefined) throw new Error('short day');
      snap = ok(await s.builder.edit(snap.draftId, { kind: 'superset_next', slotKey: a.key }, { opId: h.ids(), basis: { version: snap.version } }));
      return { snap, pair: [snap.facts[a.exerciseId]?.name ?? '?', snap.facts[b.exerciseId]?.name ?? '?'].sort().join(' + ') };
    };
    // 1. Skip: the plan day is unchanged; next time has no superset.
    const one = await pairUp();
    expect((await todayCard(s, 'Pull')).pairs).toEqual([one.pair]);
    const s1 = await startAndFinish(s, one.snap, gymId);
    const offer = await s.builder.keepNextTimeOf(s1);
    expect(offer).toMatchObject({ state: 'open' });
    expect(offer?.state === 'open' ? offer.lines : []).toHaveLength(1);
    expect(offer?.state === 'open' ? offer.lines[0] : '').toMatch(/^Superset .+ with .+$/);
    expect(await s.builder.keepNextTime(s1, 'skip')).toEqual({ ok: true });
    expect((await routineOf(s, 'Pull')).version).toBe(before.version);
    h.clockMs += DAY;
    expect((await todayCard(s, 'Pull')).pairs).toEqual([]);
    // 2. Apply: the plan day keeps the pair; a retry is the same write; next time it's on Today.
    const two = await pairUp();
    const s2 = await startAndFinish(s, two.snap, gymId);
    expect(await s.builder.keepNextTime(s2, 'apply')).toEqual({ ok: true });
    const kept = await routineOf(s, 'Pull');
    expect(kept.version).toBe(before.version + 1);
    expect(pairsOfRoutine(names, kept.exercises)).toEqual([two.pair]);
    expect(await s.builder.keepNextTime(s2, 'apply')).toEqual({ ok: true });
    expect((await routineOf(s, 'Pull')).version).toBe(kept.version);
    await h.forceClose();
    const { services: s2b } = await h.launch();
    h.clockMs += DAY;
    expect((await todayCard(s2b, 'Pull')).pairs).toEqual([two.pair]);
    // Undo: as stored before; the card has no superset again.
    expect(await s2b.builder.undoKeepNextTime(s2)).toEqual({ ok: true });
    expect(pairsOfRoutine(names, (await routineOf(s2b, 'Pull')).exercises)).toEqual([]);
  });

  it('a stale Keep for next time? (the plan day changed since the workout started) is refused; nothing written', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    let snap = await editFromToday(s, 'Pull');
    const slots = slotsOf(snap.workout.blocks);
    const a = slots[slots.length - 2];
    if (a === undefined) throw new Error('short day');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'superset_next', slotKey: a.key }, { opId: h.ids(), basis: { version: snap.version } }));
    const sessionId = await startAndFinish(s, snap, gymId);
    const pull = await routineOf(s, 'Pull');
    await editPlanDay(s, pull.id, ({ list }) => [{ kind: 'add_set', slotId: [...list].sort((x, y) => x.order - y.order)[1]?.id ?? '' }]);
    const after = await routineOf(s, 'Pull');
    expect(await s.builder.keepNextTime(sessionId, 'apply')).toMatchObject({ ok: false, reason: 'stale' });
    expect((await routineOf(s, 'Pull')).version).toBe(after.version);
    await h.forceClose();
    ({ services: s } = await h.launch());
    expect((await routineOf(s, 'Pull')).exercises).toEqual(after.exercises);
  });

  it('mid-workout Superset with…: Keep for next time? offers it; Apply makes it the plan day’s, Skip doesn’t', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    const before = await routineOf(s, 'Push');
    const names = await namesOf(s, before.exercises.map((e) => e.exerciseId));
    const snap = await editFromToday(s, 'Push');
    const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
    if (!r.ok) throw new Error(r.message);
    const live = (await s.workout.load(r.sessionId))?.aggregate;
    if (live === undefined) throw new Error('no workout');
    const rows = live.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);
    const x = rows[rows.length - 2];
    const y = rows[rows.length - 1];
    if (x === undefined || y === undefined) throw new Error('short day');
    const choices = await s.workout.supersetChoices(r.sessionId, x.id);
    const linked = await s.workout.linkSuperset({ sessionId: r.sessionId, sessionExerciseId: x.id, withSessionExerciseId: y.id, expectedVersion: choices?.version ?? 0, opId: h.ids() });
    if (!linked.ok) throw new Error(linked.error.message);
    await finishWorkout(h, s, r.sessionId);
    const pair = [x.exerciseName, y.exerciseName].sort().join(' + ');
    const offer = await s.builder.keepNextTimeOf(r.sessionId);
    expect(offer?.state === 'open' ? offer.lines : []).toEqual([`Superset ${rows[rows.length - 2]?.exerciseName ?? ''} with ${rows[rows.length - 1]?.exerciseName ?? ''}`]);
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    expect(pairsOfRoutine(names, (await routineOf(s, 'Push')).exercises)).toEqual([pair]);
    h.clockMs += DAY;
    expect((await todayCard(s, 'Push')).pairs).toEqual([pair]);
  });

  it('mid-workout Superset with… a new exercise: Keep lists the add (in its superset); Apply adds it to the plan day paired', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    const snap = await editFromToday(s, 'Legs');
    const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
    if (!r.ok) throw new Error(r.message);
    const live = (await s.workout.load(r.sessionId))?.aggregate;
    const last = live?.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order).at(-1);
    if (last === undefined) throw new Error('no rows');
    const calf = (await s.workout.pickerExercises(r.sessionId, 'Seated calf raise', { withCatalogue: true })).find((p) => p.exercise.name === 'Seated calf raise');
    if (calf === undefined) throw new Error('no calf raise');
    const choices = await s.workout.supersetChoices(r.sessionId, last.id);
    const added = await s.workout.addExercise({ sessionId: r.sessionId, exerciseId: calf.exercise.id, equipmentId: calf.equipment[0]?.id ?? null, opId: h.ids(), shape: { workingSets: choices?.sets ?? 3 }, supersetWithSessionExerciseId: last.id });
    if (!added.ok) throw new Error(added.error.message);
    await finishWorkout(h, s, r.sessionId);
    const offer = await s.builder.keepNextTimeOf(r.sessionId);
    expect(offer?.state === 'open' ? offer.lines : []).toEqual(['Add Seated calf raise']);
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    const legs = await routineOf(s, 'Legs');
    const names = await namesOf(s, legs.exercises.map((e) => e.exerciseId));
    expect(pairsOfRoutine(names, legs.exercises)).toEqual([[last.exerciseName, 'Seated calf raise'].sort().join(' + ')]);
  });

  it('the coach’s mid-workout superset (edit_today) is today only: Keep for next time? never lists it (rule 3)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    await ppl(s, gymId, false);
    const before = await routineOf(s, 'Push');
    const snap = await editFromToday(s, 'Push');
    const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
    if (!r.ok) throw new Error(r.message);
    const live = (await s.workout.load(r.sessionId))?.aggregate;
    if (live === undefined) throw new Error('no workout');
    const rows = live.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);
    const x = rows[rows.length - 2];
    const y = rows[rows.length - 1];
    if (x === undefined || y === undefined) throw new Error('short day');
    model = new StepModel([() => toolCall('edit_today', { baseVersion: live.session.version, ops: [{ op: 'superset', sessionExerciseId: x.id, withSessionExerciseId: y.id }], reason: 'Ben asked to pair them.' }), () => replyWith('Paired.')]);
    const said = await s.coach.send({ entry: { kind: 'workout', sessionId: r.sessionId }, threadId: null, input: { kind: 'words', text: `Superset ${x.exerciseName} with ${y.exerciseName}`, spoken: false }, turnId: h.ids() });
    expect(said.cards[0]?.record).toMatchObject({ status: 'committed' });
    const paired = (await s.workout.load(r.sessionId))?.aggregate;
    expect(paired === undefined ? [] : pairsOfSession(paired)).toEqual([[x.exerciseName, y.exerciseName].sort().join(' + ')]);
    await finishWorkout(h, s, r.sessionId);
    expect(await s.builder.keepNextTimeOf(r.sessionId)).toBeNull();
    expect((await routineOf(s, 'Push')).version).toBe(before.version);
  });
});
