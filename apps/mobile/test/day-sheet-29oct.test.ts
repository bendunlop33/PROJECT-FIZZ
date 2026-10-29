import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import type { TodayDaySheet, TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym as commercialGym, type Harness } from './harness';

/**
 * (Ben, 29 Oct: day sheet; docs/design/day-sheet.md) Real SQLite, offline, no coach. Ben's week: a 6-day PPL plan on
 * Set days (Mon Push A, Tue Pull A, Wed Legs A, Thu Push B, Fri Pull B, Sat Legs B), Legs Mon 26 (squat, RDL, leg
 * press), Pull Tue 27 (rows first), Push A from the plan Wed 28. Thursday 29 is today.
 * - the day sheet: each day's plan day, status and exercises; Do today instead, Move to…, Skip, each with Undo;
 * - one-change edits: This week only touches this week's day only (never the template); Every week edits the
 *   template only (done workouts never change); one Undo each; duplicates replay, stale versions are refused;
 * - Ben's screenshot (build 478): leg press `BW`, the builder's superset warning on Today's card, `Legs` with an RDL
 *   main lift, the week's rings.
 */

let h: Harness;
beforeEach(() => {
  // Monday 26 Oct 2026, 07:00 in London (GMT).
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const THU = Date.parse('2026-10-29T08:00:00.000Z');

/** Ben's gym: the commercial preset with its machines too (his leg press is plate-loaded). */
async function setUpGym(_h: Harness, s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function applyPlan(s: AppServices): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
}

/** Ben's Monday to Wednesday, then Thursday 08:00. `appliedAt`: the plan applied then (a lead-in after Monday). */
async function bensWeek(s: AppServices, gymId: string, appliedAt: string | null = null): Promise<void> {
  if (appliedAt === null) await applyPlan(s);
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] },
    { exercise: 'Leg press', sets: [{ load: 140, reps: 10 }, { load: 140, reps: 10 }] },
  ]);
  h.clockMs = Date.parse('2026-10-27T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }, { load: 70, reps: 8 }] },
    { exercise: 'Pull-up', sets: [{ load: 0, reps: 8 }, { load: 0, reps: 8 }] },
  ]);
  if (appliedAt !== null) {
    h.clockMs = Date.parse(appliedAt);
    await applyPlan(s);
  }
  h.clockMs = Date.parse('2026-10-28T18:04:00.000Z');
  const d = await loaded(s);
  const day = d.days.find((x) => x.key === d.nextKey);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Up next');
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  await finishWorkout(h, s, r.aggregate.session.id);
  h.clockMs = THU;
}

const dayOf = (d: TodaySessionData, name: string) => {
  const x = d.days.find((y) => y.name === name);
  if (x === undefined) throw new Error(`no ${name}: ${d.days.map((y) => y.name).join(', ')}`);
  return x;
};
const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;
const tiles = (s: AppServices, d: TodaySessionData) =>
  s.todaySession.week(d, nextName(d)).map((t) => `${t.date.slice(8)} ${t.today ? 'today ' : ''}${t.state}${t.marks.length === 0 ? '' : ` ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(',')}`}`);
const title = (date: string) => date;
const sheetOn = (s: AppServices, d: TodaySessionData, date: string): TodayDaySheet => s.todaySession.daySheet(d, { date }, d.nextKey, title);
const sheetOf = (s: AppServices, d: TodaySessionData, name: string): TodayDaySheet => s.todaySession.daySheet(d, { dayKey: dayOf(d, name).key }, d.nextKey, title);
const rows = (sh: TodayDaySheet) => sh.list.map((r) => `${r.fullName} ${r.sets} ${r.target}`);
async function planOf(s: AppServices) {
  const o = await s.plans.overview();
  const id = o?.block?.planId;
  if (id === undefined) throw new Error('no plan');
  const p = await s.planBuilder.open({ editPlanId: id });
  if (p === null) throw new Error('no plan');
  return { planId: id, version: o?.block?.planVersion ?? 0 };
}
/** A catalogue exercise by name, as the Swap / Add sheet lists it. */
async function pick(s: AppServices, gymId: string, name: string): Promise<{ exerciseId: string; here: boolean } | undefined> {
  const e = (await s.exercisePicker.forTemplate(gymId)).entries.find((x) => x.exercise.name === name);
  return e === undefined ? undefined : { exerciseId: e.exercise.id, here: e.here };
}
async function templateOf(s: AppServices, d: TodaySessionData, name: string) {
  const id = dayOf(d, name).templates[0]?.routineId;
  const r = id == null ? null : (await s.routines.editor({ routineId: id, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

describe('Ben’s week, Thursday 29 (build 478 screenshot)', () => {
  it('plan days read as the plan names them; Up next is Push B; the tiles: Thu Push B today, Fri Pull B, Sat Legs B; each day’s sheet', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(h, s));
    const d = await loaded(s);
    // Bug 3: two Legs days never both read `Legs`: the card's name is its own day's (Legs B leads with the RDL).
    expect(d.days.map((x) => x.name)).toEqual(['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B']);
    expect(nextName(d)).toBe('Push B');
    const legsA = s.todaySession.card(d, { dayKey: dayOf(d, 'Legs A').key, controls: d.initial[dayOf(d, 'Legs A').key] ?? d.initial[''] ?? (() => { throw new Error('x'); })() });
    const legsB = s.todaySession.card(d, { dayKey: dayOf(d, 'Legs B').key, controls: d.initial[dayOf(d, 'Legs B').key] ?? (() => { throw new Error('x'); })() });
    expect([legsA?.title, legsA?.list.find((r) => r.main)?.fullName]).toEqual(['Legs A', 'Back squat']);
    expect([legsB?.title, legsB?.list.find((r) => r.main)?.fullName]).toEqual(['Legs B', 'Romanian deadlift']);
    // Bug 4: one ring a day, each on its own weekday, never on a past day; Sunday plain.
    expect(tiles(s, d)).toEqual(['26 done dot:legs', '27 done dot:pull', '28 done dot:push', '29 today planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    // The sheets.
    const thu = sheetOn(s, d, '2026-10-29');
    expect([thu.title, thu.statusText, thu.actions.start, thu.actions.doToday]).toEqual(['Thu · Push B', 'Today', true, null]);
    expect(thu.list.length).toBeGreaterThan(0);
    const sat = sheetOn(s, d, '2026-10-31');
    expect([sat.title, sat.statusText, sat.actions.start, sat.actions.doToday]).toEqual(['Sat · Legs B', 'Planned', false, { kind: 'swap_days', withDayIndex: 3 }]);
    expect(sat.list[0]?.fullName).toBe('Romanian deadlift');
    expect(sat.actions.moveTo.map((m) => m.label)).toEqual(['Sun']);
    const mon = sheetOn(s, d, '2026-10-26');
    expect([mon.title, mon.statusText, mon.actions.edit, mon.list]).toEqual(['Mon · Legs A', 'Done', false, []]);
    const sun = sheetOn(s, d, '2026-11-01');
    expect([sun.title, sun.statusText]).toEqual(['2026-11-01', 'Rest']);
    // The card picker: every day with its weekday and status.
    expect(s.todaySession.planWeek(d, d.nextKey).map((x) => `${x.name} ${x.date ?? '-'} ${x.status}`)).toEqual([
      'Push A 2026-10-28 done',
      'Pull A 2026-10-27 done',
      'Legs A 2026-10-26 done',
      'Push B 2026-10-29 today',
      'Pull B 2026-10-30 planned',
      'Legs B 2026-10-31 planned',
    ]);
  });

  it('bug 4, the lead-in (the plan applied Tue 27 evening, as Ben’s was this week): the same rings and Up next', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(h, s), '2026-10-27T20:00:00.000Z');
    const d = await loaded(s);
    expect(d.block?.text).toBe('Starts Mon 2\u00a0Nov');
    expect(nextName(d)).toBe('Push B');
    expect(tiles(s, d)).toEqual(['26 done dot:legs', '27 done dot:pull', '28 done dot:push', '29 today planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    // A this-week change in the lead-in is the lead-in's only.
    const p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'skip', dayIndex: 4 } })).toMatchObject({ ok: true });
    expect(tiles(s, await loaded(s))[4]).toBe('30 plain');
    h.clockMs = Date.parse('2026-11-06T08:00:00.000Z');
    expect(tiles(s, await loaded(s))[4]).toMatch(/^06 today planned ring:pull$/);
  });

  it('bug 2: the builder’s superset advice never shows on Today’s card', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await commercialGym(h, s));
    const d = await loaded(s);
    // Supersets on: the builder pairs and advises (`It tires your legs…`, `Both work your quads…`) on some day.
    const cards = d.days.map((x) => {
      const controls = d.initial[x.key];
      if (controls === undefined) throw new Error('no controls');
      return s.todaySession.card(d, { dayKey: x.key, controls: { ...controls, supersets: true } });
    });
    const v = cards.find((c) => (c?.draft?.advice.length ?? 0) > 0);
    expect(v).toBeDefined();
    expect(v?.clashLine).toBeNull();
  });
});

describe('This week only: one change, nothing else', () => {
  it('a swap on Legs B this week keeps sets, reps, rest, place, superset, the other exercises, the other days and the template; next week is the plan’s; Undo; restart keeps it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId);
    const d = await loaded(s);
    const before = sheetOf(s, d, 'Legs B');
    const template = await templateOf(s, d, 'Legs B');
    const otherCards = d.days.filter((x) => x.name !== 'Legs B').map((x) => JSON.stringify(sheetOf(s, d, x.name).list));
    // The day's second exercise (not its main lift): Hack squat on Ben's plan.
    const row = [...template.exercises].sort((a, b) => a.order - b.order).find((e) => e.main !== true && before.list.some((r) => r.exerciseId === e.exerciseId));
    if (row === undefined) throw new Error(`no row: ${rows(before).join(' | ')}`);
    const swappedName = before.list.find((r) => r.exerciseId === row.exerciseId)?.fullName ?? '';
    const legPress = await pick(s, gymId, 'Leg press');
    if (legPress === undefined) throw new Error('no leg press');
    const { planId, version } = await planOf(s);
    const opId = h.ids();
    const req = { planId, expectedVersion: version, opId, change: { kind: 'exercise' as const, edit: { dayIndex: 5, kind: 'swap' as const, rowId: row.id, fromExerciseId: row.exerciseId, toExerciseId: legPress.exerciseId } } };
    const w = await s.plans.weekChange(req);
    expect(w).toMatchObject({ ok: true, duplicate: false });
    // A retry of the same tap is the same write; the old version is refused.
    expect(await s.plans.weekChange(req)).toMatchObject({ ok: true, duplicate: true });
    expect(await s.plans.weekChange({ ...req, opId: h.ids() })).toMatchObject({ ok: false, reason: 'stale' });

    const after = await loaded(s);
    const sheet = sheetOf(s, after, 'Legs B');
    const i = before.list.findIndex((r) => r.exerciseId === row.exerciseId);
    expect(sheet.list.map((r) => r.fullName)).toEqual(before.list.map((r, k) => (k === i ? 'Leg press' : r.fullName)));
    // The row's set count stays (its reps read from his last leg press, as every card's do).
    expect(sheet.list[i]?.sets.split('\u00a0')[0]).toBe(before.list[i]?.sets.split('\u00a0')[0]);
    expect(sheet.list[i]?.superset).toBe(before.list[i]?.superset ?? null);
    expect(sheet.list.filter((_, k) => k !== i)).toEqual(before.list.filter((_, k) => k !== i));
    expect(sheet.changed).toEqual([legPress.exerciseId]);
    // Bug 1: leg press is a loaded machine: a kg target from his history, never `BW`.
    expect(sheet.list[i]?.target).toMatch(/^\d+(\.\d+)?$/);
    expect(sheet.list[i]?.target).not.toBe('BW');
    // The template, the other days and Today's Up next never moved.
    expect((await templateOf(s, after, 'Legs B')).exercises).toEqual(template.exercises);
    expect((await templateOf(s, after, 'Legs B')).version).toBe(template.version);
    expect(after.days.filter((x) => x.name !== 'Legs B').map((x) => JSON.stringify(sheetOf(s, after, x.name).list))).toEqual(otherCards);
    expect(nextName(after)).toBe('Push B');
    // The stored rows: rest and sets as the template had them.
    const tplRow = template.exercises.find((e) => e.id === row.id);
    expect(tplRow?.exerciseId).toBe(row.exerciseId);

    // A force-close keeps it (stored with the plan).
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await loaded(s2);
    expect(sheetOf(s2, again, 'Legs B').list[i]?.fullName).toBe('Leg press');
    // Next Monday: the plan as it was.
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    expect(sheetOf(s2, await loaded(s2), 'Legs B').list.map((r) => r.fullName)).toContain(swappedName);
    h.clockMs = THU + 60_000;
    // Undo: exactly the swap comes back out.
    const p = await planOf(s2);
    expect(await s2.plans.undoWeekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids() })).toMatchObject({ ok: true });
    expect(sheetOf(s2, await loaded(s2), 'Legs B').list).toEqual(before.list);
  });

  it('a this-week swap on today’s day before Start shows in the started workout, with no leftover old row', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId);
    const d = await loaded(s);
    const key = dayOf(d, 'Push B').key;
    const template = await templateOf(s, d, 'Push B');
    const row = [...template.exercises].sort((a, b) => a.order - b.order).find((e) => e.main !== true);
    if (row === undefined) throw new Error('no row');
    const cable = await pick(s, gymId, 'Cable fly');
    if (cable === undefined) throw new Error('no cable fly');
    const { planId, version } = await planOf(s);
    expect(await s.plans.weekChange({ planId, expectedVersion: version, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: 3, kind: 'swap', rowId: row.id, fromExerciseId: row.exerciseId, toExerciseId: cable.exerciseId } } })).toMatchObject({ ok: true });
    const after = await loaded(s);
    const controls = after.initial[key];
    if (controls === undefined) throw new Error('no controls');
    const c = await s.todaySession.commit(after, { dayKey: key, controls }, h.ids());
    if (!c.ok) throw new Error(c.message);
    const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
    if (!r.ok) throw new Error('not started');
    const ids = r.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId);
    expect(ids).toContain(cable.exerciseId);
    expect(ids).not.toContain(row.exerciseId);
    // Every row has its sets (no `0 of 0 sets`).
    for (const e of r.aggregate.exercises.filter((x) => x.removed === undefined)) expect(r.aggregate.sets.some((x) => x.sessionExerciseId === e.id)).toBe(true);
  });

  it('Remove and Add: exactly one change each, one Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId);
    const d = await loaded(s);
    const before = sheetOf(s, d, 'Pull B');
    const template = await templateOf(s, d, 'Pull B');
    const last = [...template.exercises].sort((a, b) => a.order - b.order).at(-1);
    if (last === undefined) throw new Error('no row');
    let p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: 4, kind: 'remove', rowId: last.id, fromExerciseId: last.exerciseId, toExerciseId: null } } })).toMatchObject({ ok: true });
    const removed = sheetOf(s, await loaded(s), 'Pull B');
    expect(removed.list.length).toBe(before.list.length - 1);
    expect(removed.list.map((r) => r.exerciseId)).not.toContain(last.exerciseId);
    p = await planOf(s);
    expect(await s.plans.undoWeekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids() })).toMatchObject({ ok: true });
    expect(sheetOf(s, await loaded(s), 'Pull B').list).toEqual(before.list);
    const face = await pick(s, gymId, 'Face pull');
    if (face === undefined) throw new Error('no face pull');
    p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: 4, kind: 'add', rowId: h.ids(), fromExerciseId: null, toExerciseId: face.exerciseId, afterRowId: null, sets: 3, reps: { min: 12, max: 15 } } } })).toMatchObject({ ok: true });
    const added = sheetOf(s, await loaded(s), 'Pull B');
    expect(added.list.map((r) => r.fullName)).toEqual([...before.list.map((r) => r.fullName), 'Face pull']);
    expect(added.list.at(-1)?.sets).toBe('3 × 12–15');
    expect((await templateOf(s, await loaded(s), 'Pull B')).exercises).toEqual(template.exercises);
  });
});

describe('Every week: the template from now on, done workouts untouched', () => {
  it('a swap on Legs B’s template keeps the row’s sets and place; Monday’s done workout is unchanged; Undo reverts the template', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId);
    const d = await loaded(s);
    const template = await templateOf(s, d, 'Legs A');
    const monday = d.week.workouts.find((w) => w.localDate === '2026-10-26');
    const monBefore = monday === undefined ? null : JSON.stringify((await s.workout.load(monday.sessionId))?.aggregate.exercises.map((e) => e.exerciseId));
    const row = [...template.exercises].sort((a, b) => a.order - b.order).find((e) => e.main !== true);
    if (row === undefined) throw new Error('no row');
    const hack = await pick(s, gymId, 'Leg press');
    if (hack === undefined) throw new Error('no leg press');
    const edit = { kind: 'swap' as const, rowId: row.id, fromExerciseId: row.exerciseId, toExerciseId: hack.exerciseId };
    const opId = h.ids();
    const w = await s.plans.editDayEveryWeek({ routineId: template.id, expectedVersion: template.version, opId, edit });
    if (!w.ok) throw new Error(w.message);
    expect((await s.plans.editDayEveryWeek({ routineId: template.id, expectedVersion: template.version, opId, edit })).ok).toBe(true);
    expect(await s.plans.editDayEveryWeek({ routineId: template.id, expectedVersion: template.version, opId: h.ids(), edit })).toMatchObject({ ok: false, reason: 'stale' });
    const now = (await s.routines.editor({ routineId: template.id, gymId: null }))?.routine;
    expect(now?.version).toBe(template.version + 1);
    const was = [...template.exercises].sort((a, b) => a.order - b.order);
    const got = [...(now?.exercises ?? [])].sort((a, b) => a.order - b.order);
    expect(got.map((e) => e.exerciseId)).toEqual(was.map((e) => (e.id === row.id ? hack.exerciseId : e.exerciseId)));
    const swapped = got.find((e) => e.id === row.id);
    expect(swapped?.setTemplates.map((t) => [t.setType, t.targetReps, t.restOverrideS])).toEqual(row.setTemplates.map((t) => [t.setType, t.targetReps, t.restOverrideS]));
    expect([swapped?.order, swapped?.supersetGroup, swapped?.restBySetType]).toEqual([row.order, row.supersetGroup, row.restBySetType]);
    // Done workouts are their own records (rule 2).
    if (monday !== undefined) expect(JSON.stringify((await s.workout.load(monday.sessionId))?.aggregate.exercises.map((e) => e.exerciseId))).toBe(monBefore);
    // Next week too (the template), and the plan's other days are as they were.
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    expect(sheetOf(s, await loaded(s), 'Legs A').list.map((r) => r.exerciseId)).toContain(hack.exerciseId);
    h.clockMs = THU + 60_000;
    const u = await s.routines.revert({ actionId: w.actionId, opId: h.ids() });
    expect(u.ok).toBe(true);
    expect(((await s.routines.editor({ routineId: template.id, gymId: null }))?.routine)?.exercises.map((e) => e.exerciseId).sort()).toEqual(template.exercises.map((e) => e.exerciseId).sort());
  });
});

describe('Do today instead, Move to…, Skip this week: each with Undo; the tiles and Up next follow at once', () => {
  it('Do today instead: Legs B today, Push B on Saturday; Undo', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(h, s));
    let d = await loaded(s);
    const sat = sheetOn(s, d, '2026-10-31');
    if (sat.actions.doToday?.kind !== 'swap_days') throw new Error('no swap');
    let p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'swap_days', dayIndex: 5, withDayIndex: sat.actions.doToday.withDayIndex } })).toMatchObject({ ok: true });
    d = await loaded(s);
    expect(nextName(d)).toBe('Legs B');
    expect(tiles(s, d)).toEqual(['26 done dot:legs', '27 done dot:pull', '28 done dot:push', '29 today planned ring:legs', '30 planned ring:pull', '31 planned ring:push', '01 plain']);
    p = await planOf(s);
    expect(await s.plans.undoWeekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids() })).toMatchObject({ ok: true });
    d = await loaded(s);
    expect(nextName(d)).toBe('Push B');
    expect(tiles(s, d)[3]).toBe('29 today planned ring:push');
  });

  it('Move to…: Push B to Sunday; Undo', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(h, s));
    let d = await loaded(s);
    expect(sheetOn(s, d, '2026-10-29').actions.moveTo.map((m) => m.label)).toEqual(['Sun']);
    let p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'move', dayIndex: 3, weekday: 6 } })).toMatchObject({ ok: true });
    d = await loaded(s);
    expect(tiles(s, d).slice(4)).toEqual(['30 planned ring:pull', '31 planned ring:legs', '01 planned ring:push']);
    // Thursday has nothing left: a rest day; Up next is the next day on.
    expect(nextName(d)).toBe('Pull B');
    p = await planOf(s);
    expect(await s.plans.undoWeekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids() })).toMatchObject({ ok: true });
    expect(tiles(s, await loaded(s))[6]).toBe('01 plain');
  });

  it('Skip this week: Pull B off Friday (and never Up next); Undo; next week it’s back', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s, await setUpGym(h, s));
    let p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'skip', dayIndex: 4 } })).toMatchObject({ ok: true });
    let d = await loaded(s);
    expect(tiles(s, d)[4]).toBe('30 plain');
    // Library › Plan's count: the skipped day is out of this week's.
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('3 of 5');
    const fri = sheetOf(s, d, 'Pull B');
    expect([fri.title, fri.statusText, fri.actions.unskip, fri.actions.skip]).toEqual(['Fri · Pull B', 'Skipped', true, false]);
    // Friday: Pull B was the day; skipped, Legs B (Sat) is next.
    h.clockMs = Date.parse('2026-10-30T08:00:00.000Z');
    // Thursday's Push B missed, still first.
    expect(nextName(await loaded(s))).toBe('Push B');
    h.clockMs = THU + 60_000;
    p = await planOf(s);
    expect(await s.plans.undoWeekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids() })).toMatchObject({ ok: true });
    d = await loaded(s);
    expect(tiles(s, d)[4]).toBe('30 planned ring:pull');
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('3 of 6');
  });
});

describe('a weight Ben types is kept as typed and the gym learns it (rule 4)', () => {
  it('31 kg per dumbbell on a swapped-in dumbbell exercise this week: the card shows 31 ea; the rack learns 31; Undo takes both back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId);
    const d = await loaded(s);
    const template = await templateOf(s, d, 'Push B');
    const row = [...template.exercises].sort((a, b) => a.order - b.order).find((e) => e.main !== true);
    if (row === undefined) throw new Error('no row');
    const fly = await pick(s, gymId, 'Dumbbell fly');
    if (fly === undefined) throw new Error('no dumbbell fly');
    const racks = async () => (await s.gyms.detail(gymId))?.equipment.filter((i) => i.equipment.kind === 'dumbbells').flatMap((i) => (i.equipment.kind === 'dumbbells' ? i.equipment.loads : [])) ?? [];
    expect(await racks()).not.toContain(31);
    let p = await planOf(s);
    expect(await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: 3, kind: 'swap', rowId: row.id, fromExerciseId: row.exerciseId, toExerciseId: fly.exerciseId } } })).toMatchObject({ ok: true });
    p = await planOf(s);
    // The screen sends the number; the convention is the exercise's own (per dumbbell).
    const typed = await s.plans.weekChange({ planId: p.planId, expectedVersion: p.version, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: 3, kind: 'swap', rowId: row.id, fromExerciseId: fly.exerciseId, toExerciseId: fly.exerciseId, load: { value: 31, unit: 'kg', convention: 'total' } } } });
    if (!typed.ok) throw new Error(typed.message);
    expect(typed.learned).not.toBeNull();
    expect(await racks()).toContain(31);
    const sheet = sheetOf(s, await loaded(s), 'Push B');
    expect(sheet.list.find((r) => r.exerciseId === fly.exerciseId)?.target).toBe('31 ea');
    const learned = typed.learned;
    if (learned == null) throw new Error('nothing learned');
    expect(await s.plans.undoWeekChange({ planId: typed.plan.id, expectedVersion: typed.plan.version, opId: h.ids() })).toMatchObject({ ok: true });
    expect(await s.gyms.undoEdit(learned)).toEqual({ ok: true });
    expect(await racks()).not.toContain(31);
  });
});
