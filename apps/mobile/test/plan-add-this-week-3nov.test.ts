import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, pbRowLine } from '@fizz/domain';
import type { ActionRecord, Routine } from '@fizz/schemas';

import { workoutView } from '../src/builder/builder-view';
import { planSwapWhen } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 3 Nov, build 534) "Add an 8-minute bike warm-up first on my leg days" → Apply → "it showed up in week 3
 * onwards but not week 2". He was in week 2 of a 6-week Standard plan (week 1 done; Legs A today, not done). A coach
 * every-week change is on the plan day's workout from now on: this week's days not done yet too; done days never
 * change (rule 2). Real SQLite, the scripted model, made-up data. Every place Ben can look at week 2:
 * Library › Plan's week list (this week), the strip with week 2 picked, the plan day screen (no week, week 2 picked),
 * the week's day sheet, Today's card, Your workout and the started workout; also with week-2 changes stored first
 * (Move day, Skip this week, a this-week remove, a lighter week). Found: before the 3 Nov cardio fix, Today's card, the
 * day sheet and Your workout (the week-2 paths) dropped the bike while a picked later week drew it (`1 × 12`); no
 * stored week-2 record shadows the workout. A regression pin; the card now says `From this week`.
 */

const BIKE = catalogueExerciseId('exercise-bike');
const ADD = { add: 'exercise-bike', days: ['Legs A', 'Legs B'], after: null, workingSets: 1, reps: null, load: null, position: 'first', before: null, minutes: 8, distanceM: null, warmup: true, also: null, notIncluded: null, reason: 'Bike warm-up first on leg days.' };
const BIKE_ROW = 'Exercise bike · 8 min · Warm-up';

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 26 Oct 2026, 07:00 in London: week 1.
  h = createHarness('2026-10-26T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function template(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

async function today(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Today's card for a plan day, committed, started and finished. */
async function doDay(s: AppServices, gymId: string, at: string, routineId: string): Promise<void> {
  h.clockMs = Date.parse(at);
  const d = await today(s);
  const day = d.days.find((x) => x.templates.some((t) => t.routineId === routineId));
  const name = routineId;
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name} in ${d.days.map((x) => x.name).join(', ')}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  await finishWorkout(h, s, r.aggregate.session.id);
}

/** Ben's 6-week Standard plan, Mon–Fri (Push A, Pull A, Legs A, Upper B, Legs B); week 1 done; week 2's Mon and Tue done; now Wed 4 Nov (Legs A). */
async function weekTwo(s: AppServices, gymId: string): Promise<{ planId: string; days: Map<string, string> }> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const built = await s.planBuilder.save(session, { ...session.answers, split: 'ppl' as const, sessions: 5, schedule: 'set' as const, days: [0, 1, 2, 3, 4] }, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  const names: Record<string, string> = { Legs: 'Legs A', 'Push B': 'Upper B', 'Pull B': 'Legs B' };
  for (const d of (await s.plans.active())?.days ?? []) {
    const to = names[d.name];
    if (to === undefined) continue;
    const t = await template(s, d.routineId);
    const r = await s.routines.rename({ routineId: d.routineId, name: to, expectedVersion: t.version, opId: h.ids() });
    if (!r.ok) throw new Error(`rename ${d.name}`);
  }
  const days = new Map(((await s.plans.active())?.days ?? []).map((d) => [d.name, d.routineId]));
  const id = (n: string) => days.get(n) ?? n;
  const order = ['Push A', 'Pull A', 'Legs A', 'Upper B', 'Legs B'];
  for (const [i, name] of order.entries()) await doDay(s, gymId, `2026-10-${String(26 + i)}T17:00:00.000Z`, id(name));
  await doDay(s, gymId, '2026-11-02T17:00:00.000Z', id('Push A'));
  await doDay(s, gymId, '2026-11-03T17:00:00.000Z', id('Pull A'));
  h.clockMs = Date.parse('2026-11-04T08:00:00.000Z');
  return { planId: built.planId, days };
}

async function addBike(s: AppServices): Promise<ActionRecord> {
  model = new StepModel([() => toolCall('propose_plan_add', ADD), () => replyWith('Here it is for your plan.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Add an 8 minute bike warm-up first on my leg days', spoken: false }, turnId: h.ids() });
  expect(r.status).toBe('completed');
  const rec = r.cards[0]?.record;
  if (rec?.detail.kind !== 'propose_plan_swap') throw new Error(`no plan card: ${JSON.stringify(r.toolLog)}`);
  expect(await s.planSwap.apply(rec.actionId)).toEqual({ ok: true });
  return rec;
}

const first = (r: { name: string } & Parameters<typeof pbRowLine>[0] & { warmup?: true }) => `${r.name} · ${pbRowLine(r)}`;

/** The first row of a plan day in every view of this week (week 2) Ben can open. */
async function weekTwoViews(s: AppServices, gymId: string, routineId: string, name: string, opts: { start: boolean } = { start: false }): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ov = await s.plans.overview();
  const b = ov?.block;
  if (b == null) throw new Error('no block');
  expect(b.current).toBe(2);
  // Library › Plan: this week's list (and the strip with week 2 picked: the same view).
  const idx = ov?.days.find((d) => d.routineId === routineId)?.dayIndex ?? -1;
  const wk2 = b.views[1]?.days.find((d) => d.index === idx);
  out.libraryWeek = wk2?.rows[0] === undefined ? '' : first(wk2.rows[0]);
  const wk3 = b.views[2]?.days.find((d) => d.index === idx);
  out.libraryWeek3 = wk3?.rows[0] === undefined ? '' : first(wk3.rows[0]);
  // Library › Plan › the day: from this week (no week) and with week 2 picked.
  const day = await s.plans.planDay(routineId);
  out.planDay = `${day?.rows[0]?.name ?? ''} · ${day?.rows[0]?.line ?? ''}`;
  const picked = await s.plans.planDay(routineId, { targetsHit: false, week: 2 });
  out.planDayWeek2 = picked?.week == null ? `${picked?.rows[0]?.name ?? ''} · ${picked?.rows[0]?.line ?? ''}` : 'a week card';
  // Today: the card and the week's day sheet.
  const d = await today(s);
  const key = d.days.find((x) => x.templates.some((t) => t.routineId === routineId))?.key ?? '';
  const controls = d.initial[key];
  if (controls === undefined) throw new Error(`no controls for ${name}`);
  const card = s.todaySession.card(d, { dayKey: key, controls });
  out.card = `${card?.list[0]?.fullName ?? ''} | ${card?.list[0]?.sets ?? ''}`.replace(/\u00a0/g, ' ');
  const sheet = s.todaySession.daySheet(d, { dayKey: key }, d.nextKey, (x) => x);
  out.sheet = `${sheet.list[0]?.fullName ?? ''} | ${sheet.list[0]?.sets ?? ''}`.replace(/\u00a0/g, ' ');
  // Your workout from Today's card, then Start.
  const committed = await s.todaySession.commit(d, { dayKey: key, controls }, h.ids());
  if (!committed.ok) throw new Error(committed.message);
  const snap = await s.builder.read(committed.draftId);
  const yw = snap === null ? [] : workoutView(snap).rounds.flatMap((r) => r.rows);
  out.yourWorkout = `${yw[0]?.name ?? ''} · ${yw[0]?.topText ?? ''}`;
  if (opts.start) {
    const r = await s.todaySession.start({ draftId: committed.draftId, expectedVersion: committed.version, gymId, opId: h.ids(), checkIn: null });
    if (!r.ok) throw new Error('not started');
    const ex = [...r.aggregate.exercises].sort((a, b) => a.order - b.order)[0];
    const sets = r.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup');
    out.started = `${ex?.exerciseId === BIKE ? 'Exercise bike' : (ex?.exerciseId ?? '')} · ${String(sets[0]?.planned.durationS ?? 'no time')} s`;
  }
  return out;
}

const bikeEverywhere = (started: boolean) => ({
  libraryWeek: BIKE_ROW,
  libraryWeek3: BIKE_ROW,
  planDay: 'Exercise bike · 8 min',
  planDayWeek2: 'Exercise bike · 8 min',
  card: 'Exercise bike | 8 min',
  sheet: 'Exercise bike | 8 min',
  yourWorkout: 'Exercise bike · 8:00',
  ...(started ? { started: 'Exercise bike · 480 s' } : {}),
});

describe('Ben’s bike warm-up asked for in week 2: this week’s leg days not done have it in every view; done days never change', () => {
  it('Apply in week 2 (Legs A today): week 2 and on, every view; week 1 and this week’s done days as they were', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { days } = await weekTwo(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const legsB = days.get('Legs B') ?? '';
    const add = await addBike(s);
    // The card says from when: this week (its days not done yet).
    expect(planSwapWhen(add)).toBe('From this week');

    expect(await weekTwoViews(s, gymId, legsB, 'Legs B')).toEqual(bikeEverywhere(false));
    expect(await weekTwoViews(s, gymId, legsA, 'Legs A', { start: true })).toEqual(bikeEverywhere(true));

    // Done days: week 1's leg days and this week's done days show as they were.
    const ov = await s.plans.overview();
    for (const id of [legsA, legsB]) {
      const idx = ov?.days.find((d) => d.routineId === id)?.dayIndex ?? -1;
      expect(ov?.block?.views[0]?.days.find((d) => d.index === idx)?.rows.some((r) => r.exerciseId === BIKE)).toBe(false);
    }

    // "make it 10 min": the day-edit card says the same, and this week's Legs B has 10 min on Today's card.
    model = new StepModel([() => toolCall('propose_plan_day_edit', { day: 'Legs A', alsoDays: ['Legs B'], order: null, changes: [{ exercise: 'exercise-bike', workingSets: null, reps: null, targetRpe: null, main: null, load: null, minutes: 10, distanceM: null, warmup: null, first: null }], reason: 'Longer.' }), () => replyWith('Done.')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'make the bike 10 min', spoken: false }, turnId: h.ids() });
    const edit = r.cards[0]?.record;
    if (edit === undefined) throw new Error('no card');
    expect(planSwapWhen(edit)).toBe('From this week');
    expect(await s.planSwap.apply(edit.actionId)).toEqual({ ok: true });
    const views = await weekTwoViews(s, gymId, legsB, 'Legs B');
    expect([views.libraryWeek, views.card]).toEqual(['Exercise bike · 10 min · Warm-up', 'Exercise bike | 10 min']);
  });

  it('Legs A done today before the ask: this week’s Legs A stays as done, Legs B and next week’s Legs A have the bike', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { days } = await weekTwo(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const legsB = days.get('Legs B') ?? '';
    await doDay(s, gymId, '2026-11-04T08:00:00.000Z', legsA);
    h.clockMs = Date.parse('2026-11-04T12:00:00.000Z');
    await addBike(s);
    const ov = await s.plans.overview();
    const idx = (id: string) => ov?.days.find((d) => d.routineId === id)?.dayIndex ?? -1;
    const firstOf = (w: number, id: string) => ov?.block?.views[w - 1]?.days.find((d) => d.index === idx(id))?.rows[0]?.exerciseId;
    expect(ov?.block?.views[1]?.days.find((d) => d.index === idx(legsA))?.done).toBe(true);
    expect(firstOf(2, legsA)).not.toBe(BIKE);
    expect(firstOf(3, legsA)).toBe(BIKE);
    expect(firstOf(2, legsB)).toBe(BIKE);
    expect(await weekTwoViews(s, gymId, legsB, 'Legs B', { start: true })).toEqual(bikeEverywhere(true));
  });

  // A week-2 change stored before the ask (a this-week record on the plan, or a week version) never hides the add.
  const before: [string, (s: AppServices, ctx: { planId: string; legsA: string; legsB: string; idx: (id: string) => number }) => Promise<void>][] = [
    ['Move day (Legs B to Sat)', async (s, c) => {
      const plan = await s.plans.overview();
      expect(await s.plans.weekChange({ planId: c.planId, expectedVersion: plan?.block?.planVersion ?? 0, opId: h.ids(), change: { kind: 'move', dayIndex: c.idx(c.legsB), weekday: 5 } })).toMatchObject({ ok: true });
    }],
    ['Skip this week (Legs B)', async (s, c) => {
      const plan = await s.plans.overview();
      expect(await s.plans.weekChange({ planId: c.planId, expectedVersion: plan?.block?.planVersion ?? 0, opId: h.ids(), change: { kind: 'skip', dayIndex: c.idx(c.legsB) } })).toMatchObject({ ok: true });
    }],
    ['a this-week remove on Legs A', async (s, c) => {
      const plan = await s.plans.overview();
      const last = [...(await template(s, c.legsA)).exercises].sort((a, b) => a.order - b.order).at(-1);
      if (last === undefined) throw new Error('no row');
      expect(await s.plans.weekChange({ planId: c.planId, expectedVersion: plan?.block?.planVersion ?? 0, opId: h.ids(), change: { kind: 'exercise', edit: { dayIndex: c.idx(c.legsA), kind: 'remove', rowId: last.id, fromExerciseId: last.exerciseId, toExerciseId: null } } })).toMatchObject({ ok: true });
    }],
    ['a lighter week 2 (the coach’s plan change: a new week version)', async (s) => {
      model = new StepModel([() => toolCall('propose_plan_change', { change: { kind: 'lighter_week', week: 'this' }, reason: 'Tired.' }), () => replyWith('This week lighter.')]);
      const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'make this week a lighter week', spoken: false }, turnId: h.ids() });
      const card = r.cards[0]?.record;
      if (card?.detail.kind !== 'propose_plan_change') throw new Error(`no card: ${JSON.stringify(r.toolLog)}`);
      expect(await s.planChange.apply(card.actionId)).toEqual({ ok: true });
    }],
  ];
  it.each(before)('%s, then the ask: week 2’s leg days not done have the bike in every view', async (_, change) => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { planId, days } = await weekTwo(s, gymId);
    const legsA = days.get('Legs A') ?? '';
    const legsB = days.get('Legs B') ?? '';
    const ov = await s.plans.overview();
    const idx = (id: string) => ov?.days.find((d) => d.routineId === id)?.dayIndex ?? -1;
    await change(s, { planId, legsA, legsB, idx });
    await addBike(s);
    const after = await s.plans.overview();
    for (const id of [legsA, legsB]) for (const w of [2, 3]) expect([w, after?.block?.views[w - 1]?.days.find((d) => d.index === idx(id))?.rows[0]?.exerciseId]).toEqual([w, BIKE]);
    expect(await weekTwoViews(s, gymId, legsA, 'Legs A', { start: true })).toEqual(bikeEverywhere(true));
    // After a force-close (app open runs the week sync), still there.
    await h.settle(s);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await s2.plans.overview();
    for (const id of [legsA, legsB]) expect(again?.block?.views[1]?.days.find((d) => d.index === idx(id))?.rows[0]?.exerciseId).toBe(BIKE);
  });
});
