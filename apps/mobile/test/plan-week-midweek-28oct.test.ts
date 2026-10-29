import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TODAY_PICK_COPY } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { ImportDraft } from '../src/import/import-service';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct, build 475) Real SQLite, offline, no coach. Ben's week: a 6-day PPL plan from the builder (Mon Push A,
 * Tue Pull A, Wed Legs, Thu Push B, Fri Pull B, Sat Legs B), a Legs workout Mon 26 (back squat, RDL), a Pull workout
 * Tue 27 (rows, pull-ups), Push A started from the plan Wed 28 at 18:04.
 * - one workout ticks one plan day (Legs, not Legs B too); the pull led with rows is Pull A, not Pull B;
 * - Push A started from the plan ticks Push A only once finished;
 * - Today's tiles: Mon/Tue done, Wed today with the Push ring, the days left planned (Set days on their weekdays; Any
 *   days one a day after today), never a past day;
 * - a plan started mid-week: week 1 is that week (training-blocks §4.1), the week counts from Monday, and expects only
 *   the days still possible.
 */

let h: Harness;
beforeEach(() => {
  // Monday 26 Oct 2026, 07:00 in London (GMT).
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function applyPlan(s: AppServices, schedule: 'set' | 'any'): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule, days: schedule === 'set' ? [0, 1, 2, 3, 4, 5] : [] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
}

/** Monday 18:00 Legs (squat first), Tuesday 18:00 Pull (rows first): both Empty workouts, off the plan. */
async function monAndTue(s: AppServices, gymId: string): Promise<void> {
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] },
  ]);
  h.clockMs = Date.parse('2026-10-27T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }, { load: 70, reps: 8 }] },
    { exercise: 'Pull-up', sets: [{ load: 0, reps: 8 }, { load: 0, reps: 8 }] },
  ]);
}

/** Wednesday 18:04: Today's Up next (Push A) started from the plan. */
async function startPushA(s: AppServices, gymId: string): Promise<string> {
  h.clockMs = Date.parse('2026-10-28T18:04:00.000Z');
  const d = await loaded(s);
  const day = d.days.find((x) => x.key === d.nextKey);
  expect(day?.dayIndex).toBe(0);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Up next');
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  return r.aggregate.session.id;
}

const tiles = async (s: AppServices, chosen: string | null) =>
  s.todaySession.week(await loaded(s), chosen).map((t) => `${t.date.slice(8)} ${t.today ? 'today ' : ''}${t.state}${t.marks.length === 0 ? '' : ` ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(',')}`}`);
const doneNames = async (s: AppServices) =>
  (await s.plans.overview())?.days
    .filter((d) => d.state === 'done')
    .map((d) => d.name)
    .sort() ?? [];

describe('Ben’s week on a 6-day Set days plan', () => {
  it('Legs Mon and Pull Tue tick Legs and Pull A (2 of 6); Today plans Thu Push B, Fri Pull B, Sat Legs B; Push A ticks Push A only (3 of 6)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await applyPlan(s, 'set');
    await monAndTue(s, gymId);

    // Wednesday morning: Up next is Push A (after Legs, then Pull).
    h.clockMs = Date.parse('2026-10-28T08:00:00.000Z');
    let d = await loaded(s);
    expect(d.block?.text).toBe('Week 1 of 6');
    expect(d.days.find((x) => x.key === d.nextKey)?.dayIndex).toBe(0);
    let ov = await s.plans.overview();
    expect(ov?.daysThisWeek.text).toBe('2 of 6');
    expect(ov?.days.filter((x) => x.state === 'done').map((x) => [x.dayIndex, x.doneOn])).toEqual([
      [1, '2026-10-27'],
      [2, '2026-10-26'],
    ]);
    // Today's sheet: the same days done, on the days they were done.
    expect(Object.values(d.week.doneOn).sort()).toEqual(['2026-10-26', '2026-10-27']);

    const pushA = await startPushA(s, gymId);
    // In progress: Mon and Tue done, today ringed, Thu–Sat planned on their own weekdays, Sunday plain.
    expect(await tiles(s, 'Push A')).toEqual(['26 done dot:legs', '27 done dot:pull', '28 today planned ring:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    expect((await loaded(s)).block?.text).toBe('Week 1 of 6');

    await finishWorkout(h, s, pushA);
    ov = await s.plans.overview();
    expect(ov?.daysThisWeek.text).toBe('3 of 6');
    expect(ov?.days.filter((x) => x.state === 'done').map((x) => x.dayIndex)).toEqual([0, 1, 2]);
    d = await loaded(s);
    expect(await tiles(s, null)).toEqual(['26 done dot:legs', '27 done dot:pull', '28 today done dot:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    expect((await s.plans.consistency())?.planThisWeek?.text).toBe('3 of 6');
    // (Ben, 28 Oct) Set weekdays decide Up next: Wednesday's Legs is done (Monday's legs), Mon and Tue are done, so the
    // next scheduled day, Push B (Thu); it agrees with the tiles.
    expect(d.days.find((x) => x.key === d.nextKey)?.dayIndex).toBe(3);

    // A force-close re-derives the same week.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.plans.overview())?.daysThisWeek.text).toBe('3 of 6');
    expect((await loaded(s2)).block?.text).toBe('Week 1 of 6');
    // Next Monday: week 2.
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    expect((await loaded(s2)).block?.text).toBe('Week 2 of 6');
    expect(await doneNames(s2)).toEqual([]);
  });
});

describe('switching between Set days and Any days (Days and time) while Push A is in progress (Ben, 28 Oct)', () => {
  async function switchTo(s: AppServices, schedule: 'set' | 'any'): Promise<void> {
    const planId = (await s.plans.overview())?.block?.planId ?? '';
    const e = await s.planBuilder.open({ editPlanId: planId });
    if (e?.running == null) throw new Error('not running');
    const a = { ...e.answers, schedule, days: schedule === 'set' ? [0, 1, 2, 3, 4, 5] : [] };
    const r = await s.planBuilder.applyEdit(e, a, new Set(), { kind: 'from', week: e.running.week }, h.ids());
    if (!r.ok) throw new Error(r.message);
  }
  const open = async (s: AppServices) => {
    const w = await s.todaySession.weekWhileOpen({ planDay: { planId: (await s.plans.overview())?.block?.planId ?? '', dayIndex: 0 }, title: 'Push A' });
    return w?.tiles.map((t) => `${t.date.slice(8)} ${t.today ? 'today ' : ''}${t.state}${t.marks.length === 0 ? '' : ` ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(',')}`}`);
  };
  it('both ways the open workout’s week shows the days left planned (Thu Push B, Fri Pull B, Sat Legs B), today ringed; Up next follows the weekdays on Set days', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await applyPlan(s, 'any');
    await monAndTue(s, gymId);
    const pushA = await startPushA(s, gymId);
    const want = ['26 done dot:legs', '27 done dot:pull', '28 today planned ring:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain'];
    expect(await open(s)).toEqual(want);
    await switchTo(s, 'set');
    expect((await loaded(s)).week.setDays).toBe(true);
    expect(await open(s)).toEqual(want);
    await switchTo(s, 'any');
    expect((await loaded(s)).week.setDays).toBe(false);
    expect(await open(s)).toEqual(want);
    await switchTo(s, 'set');
    expect(await open(s)).toEqual(want);
    await finishWorkout(h, s, pushA);
    const d = await loaded(s);
    // Set days: Thu's Push B is next (tiles: Thu push ring).
    expect(d.days.find((x) => x.key === d.nextKey)?.dayIndex).toBe(3);
    // Thursday: today's scheduled day.
    h.clockMs = Date.parse('2026-10-29T08:00:00.000Z');
    const thu = await loaded(s);
    expect(thu.days.find((x) => x.key === thu.nextKey)?.dayIndex).toBe(3);
    // Friday with Thursday missed: Friday's Pull B first; once done, the missed Push B.
    h.clockMs = Date.parse('2026-10-30T08:00:00.000Z');
    const fri = await loaded(s);
    expect(fri.days.find((x) => x.key === fri.nextKey)?.dayIndex).toBe(4);
  });

  it('a restored backup keeps the Set days rings', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await applyPlan(s, 'set');
    await monAndTue(s, gymId);
    const made = await s.backups.backUpOnPhone('manual');
    if (!made.ok) throw new Error(made.error);
    const text = await s.restore.readOnPhone(made.record.fileName);
    if (text === null) throw new Error('no backup');
    // A workout after the backup, so the restore replaces something.
    h.clockMs = Date.parse('2026-10-28T06:00:00.000Z');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] }]);
    const p = await s.restore.prepare(text);
    if (!p.ok) throw new Error('preview');
    expect(await s.restore.restore(text, p.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    h.clockMs = Date.parse('2026-10-28T08:00:00.000Z');
    expect(await tiles(s, 'Push A')).toEqual(['26 done dot:legs', '27 done dot:pull', '28 today planned ring:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
  });
});

describe('the same week on a 6-day Any days plan', () => {
  it('no dates, so the days left go one a day after today: Thu, Fri, Sat; Sunday plain; nothing on a past day', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await applyPlan(s, 'any');
    await monAndTue(s, gymId);
    const pushA = await startPushA(s, gymId);
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('2 of 6');
    // (Ben, 29 Oct) The card's day reads as the plan names it (Push A), so it holds today and the rest follow.
    expect(await tiles(s, 'Push A')).toEqual(['26 done dot:legs', '27 done dot:pull', '28 today planned ring:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    await finishWorkout(h, s, pushA);
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('3 of 6');
    // Done today: the 3 left from tomorrow.
    expect(await tiles(s, null)).toEqual(['26 done dot:legs', '27 done dot:pull', '28 today done dot:push', '29 planned ring:push', '30 planned ring:pull', '31 planned ring:legs', '01 plain']);
    // Saturday with 3 left: only Sunday is left to show one on.
    h.clockMs = Date.parse('2026-10-31T08:00:00.000Z');
    const sat = await tiles(s, null);
    expect(sat.slice(0, 5).every((t) => !t.includes('planned'))).toBe(true);
    expect(sat[6]).toMatch(/^01 planned ring:/);
  });
});

describe('a plan started mid-week (Wed 28), after Legs Mon and Pull Tue: a lead-in (Ben, 28 Oct)', () => {
  it('this week is the lead-in (`Starts Mon 2 Nov` on Today and Library); Mon and Tue count for it (2 of 5); week 1 of 6 starts Mon 2 Nov', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monAndTue(s, gymId);
    h.clockMs = Date.parse('2026-10-28T09:00:00.000Z');
    await applyPlan(s, 'set');
    const d = await loaded(s);
    expect(d.block?.text).toBe('Starts Mon 2\u00a0Nov');
    expect(TODAY_PICK_COPY.planWeek(d.block?.text ?? '')).toBe('Plan starts Mon 2\u00a0Nov');
    expect((await s.plans.overview())?.block?.startsOn).toBe('2026-11-02');
    // Legs and Pull A done; Push A's Monday has gone, so the week expects Wed–Sat's days left: Push B, Pull B, Legs B.
    const ov = await s.plans.overview();
    expect(ov?.daysThisWeek.text).toBe('2 of 5');
    expect(ov?.days.filter((x) => x.state === 'done').map((x) => x.dayIndex)).toEqual([1, 2]);
    const pushA = await startPushA(s, gymId);
    await finishWorkout(h, s, pushA);
    // Push A done after all (its Monday had gone): it counts, so the lead-in week is whole again.
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('3 of 6');
    // A force-close re-derives it (nothing stored, no migration).
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await loaded(s2)).block?.text).toBe('Starts Mon 2\u00a0Nov');
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    expect((await loaded(s2)).block?.text).toBe('Week 1 of 6');
    expect((await s2.plans.overview())?.block?.startsOn).toBeNull();
    expect(await doneNames(s2)).toEqual([]);
  });
});

describe('Move day in the lead-in (Ben, 28 Oct)', () => {
  it('moves the day this week only: week 1 keeps the plan’s weekday', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    h.clockMs = Date.parse('2026-10-28T09:00:00.000Z');
    await applyPlan(s, 'set');
    let ov = await s.plans.overview();
    const planId = ov?.block?.planId ?? '';
    // Legs B (Sat, day 6) to Sunday in the lead-in.
    const r = await s.plans.moveDay({ planId, dayIndex: 5, weekday: 6, expectedVersion: ov?.block?.planVersion ?? 0, opId: h.ids() });
    expect(r.ok).toBe(true);
    let d = await loaded(s);
    expect(d.week.planned.find((x) => x.key.endsWith(':5'))?.localDate).toBe('2026-11-01');
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    d = await loaded(s);
    expect(d.block?.text).toBe('Week 1 of 6');
    expect(d.week.planned.find((x) => x.key.endsWith(':5'))?.localDate).toBe('2026-11-07');
    ov = await s.plans.overview();
    expect(ov?.block?.views[0]?.days.find((x) => x.index === 5)?.weekday).toBe(5);
  });
});

const HEADER = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
async function importFile(s: AppServices, rows: string[], opId: string): Promise<void> {
  const opened = await s.imports.open({ name: `FitNotes_${opId}.csv`, text: [HEADER, ...rows].join('\n') });
  if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
  let draft: ImportDraft = opened.draft;
  const step = async (change: Parameters<AppServices['imports']['answer']>[2]) => {
    const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
    if (!r.ok) throw new Error(r.reason);
    draft = r.draft;
  };
  for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) if (n.match.exerciseId) await step({ kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
  if (draft.analysis.total?.open) await step({ kind: 'total', answer: 'total' });
  if (draft.analysis.perHand?.open) await step({ kind: 'per_hand', answer: 'each' });
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, opId);
  if (!r.ok) throw new Error(r.reason);
}

describe('an imported pull on the Set days plan (Ben’s Tue 27 import)', () => {
  it('led with rows: Pull A (whose main lift is the row), not Pull B; nothing asked; one plan day', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await applyPlan(s, 'set');
    h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
    await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] }]);
    h.clockMs = Date.parse('2026-10-28T08:00:00.000Z');
    await importFile(s, ['2026-10-27,Barbell Row,Back,70.0,8,,,', '2026-10-27,Barbell Row,Back,70.0,8,,,', '2026-10-27,Lat Pulldown,Back,60.0,10,,,', '2026-10-27,Lat Pulldown,Back,60.0,10,,,'], 'import-pull');
    const ov = await s.plans.overview();
    expect(ov?.daysThisWeek.text).toBe('2 of 6');
    expect(ov?.days.filter((x) => x.state === 'done').map((x) => [x.dayIndex, x.doneOn])).toEqual([
      [1, '2026-10-27'],
      [2, '2026-10-26'],
    ]);
    const feed = await s.history.feed();
    const row = feed.items.find((i) => i.kind === 'workout' && i.localDate === '2026-10-27');
    expect(row?.kind === 'workout' ? await s.plans.dayLinkAsk(row.sessionId) : 'none').toBeNull();
    const d = await loaded(s);
    expect(d.days.find((x) => x.key === d.nextKey)?.dayIndex).toBe(0);
  });
});
