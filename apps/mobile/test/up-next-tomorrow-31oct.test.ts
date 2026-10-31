import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MORNING_REMINDER, planTabView, toMs } from '@fizz/domain';

import { readUpNextForecast } from '../src/reminders/forecast';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct) Real SQLite, offline apart from a scripted coach. Ben's 6-day Set days plan (Mon Push A, Tue Pull A,
 * Wed Legs, Thu Push B, Fri Pull B, Sat Legs B), applied Mon 26. Done: Legs Mon 26 (off-plan, squat first), Pull A Tue
 * 27, Push A Wed 28, Legs B Fri 30.
 * - Up next is the least recently trained type of the days left this week; the schedule breaks ties; once he has
 *   trained today it plans from tomorrow. Fri before training: Legs B (legs last Mon). Fri after Legs B and Sat: Pull B
 *   (pull last Tue, push last Wed).
 * - The week follows what he did: Push B moved to Fri, Legs B done Fri → Fri is Legs B's (never `Missed`), and Up next
 *   Pull B is Saturday's; Push B goes to the next free day (Sun).
 * Today's card, Library › Plan, the tiles, the day sheet, the morning reminder and the coach all read the one rule. An
 * open workout doesn't count; Ben's own `Make next` still wins; a force-close re-derives it.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-26T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

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

/** Starts the plan day from Today's card at `at`; finished a minute later unless `open`. */
async function startDay(s: AppServices, gymId: string, at: string, name: string, open = false): Promise<string> {
  h.clockMs = Date.parse(at);
  const d = await loaded(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  if (!open) {
    h.clockMs += 60_000;
    await finishWorkout(h, s, r.aggregate.session.id);
  }
  return r.aggregate.session.id;
}

const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;

/** Ben's week up to Thursday night: Legs Mon (off-plan), Pull A Tue, Push A Wed. */
async function monToThu(s: AppServices, gymId: string): Promise<void> {
  await applyPlan(s);
  h.clockMs = Date.parse('2026-10-26T18:00:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] },
  ]);
  await startDay(s, gymId, '2026-10-27T18:00:00.000Z', 'Pull A');
  await startDay(s, gymId, '2026-10-28T18:04:00.000Z', 'Push A');
}

/** The Up next the coach is given (YOUR DATA), from one scripted turn. */
async function coachUpNext(s: AppServices): Promise<string | null> {
  let seen: string | null = null;
  model = new StepModel([
    (req) => {
      const data = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
      const m = data?.type === 'message' ? /"upNext":"([^"]+)"/u.exec(data.content) : null;
      seen = m?.[1] ?? null;
      return replyWith('OK.');
    },
  ]);
  await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'what’s next?', spoken: false }, turnId: h.ids() });
  return seen;
}

/** Every reader of Up next: Today's card, Library › Plan's NEXT, the tiles, the morning reminder's first day, the coach. */
async function readers(s: AppServices, gymId: string) {
  const d = await loaded(s);
  const ov = await s.plans.overview();
  const tz = 'Europe/London';
  const forecast = await readUpNextForecast(s, { nowMs: h.clockMs, tz, settings: DEFAULT_MORNING_REMINDER });
  const preview = await s.next.preview(gymId);
  return {
    today: nextName(d),
    library: ov?.days.find((x) => x.state === 'next')?.name ?? null,
    preview: preview?.title ?? null,
    reminder: forecast.firstOn?.title ?? forecast.next?.title ?? null,
    coach: await coachUpNext(s),
    // Fri 30's tile with Up next as the card's day, not picked by Ben: never ringed once he has trained.
    friday: s.todaySession.week(d, nextName(d)).find((t) => t.date === '2026-10-30')?.marks.map((m) => `${m.shape}${m.planned ? ':planned' : ''}`),
  };
}

/** Library › Plan's This week rows as the screen builds them: `Pull B next Sat`. */
async function libraryRows(s: AppServices): Promise<string[]> {
  const ov = await s.plans.overview();
  const b = ov?.block ?? null;
  if (ov == null) return [];
  const view = planTabView({ overview: ov, block: b === null ? null : { views: b.views, current: b.current, done: b.done, editable: b.editable, actions: b.actions, startsOn: b.startsOn }, selected: null });
  return view.rows.map((r) => `${r.name} ${r.state} ${r.weekday === null ? '-' : String(r.weekday)}`);
}

/** Tiles from Fri on: `30 done dot:legs`, `31 today planned ring:pull`. */
const tileText = (t: ReturnType<AppServices['todaySession']['week']>) => t.slice(4).map((x) => `${x.date.slice(8)} ${x.today ? 'today ' : ''}${x.state}${x.marks.map((m) => ` ${m.shape}:${m.colour}`).join('')}`);

describe('Up next: least recently trained of the days left this week, from tomorrow once trained today (Ben, 31 Oct)', () => {
  it('Fri before training: Legs B; after Legs B: Pull B, in every reader; a force-close re-derives it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);

    // Fri 30, 06:00 London (before the 07:00 reminder): legs were trained longest ago (Mon).
    h.clockMs = toMs('2026-10-30T06:00:00.000Z');
    expect(await readers(s, gymId)).toMatchObject({ today: 'Legs B', library: 'Legs B', preview: 'Legs B', reminder: 'Legs B', coach: 'Legs B' });

    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');
    h.clockMs = toMs('2026-10-30T19:00:00.000Z');
    const after = await readers(s, gymId);
    // Pull last Tue, push last Wed: Pull B, on Saturday's tile (Pull B's Fri went to Legs B, so it takes Legs B's Sat).
    expect(after).toEqual({ today: 'Pull B', library: 'Pull B', preview: 'Pull B', reminder: 'Pull B', coach: 'Pull B', friday: ['dot'] });
    expect(tileText(s.todaySession.week(await loaded(s), null))).toEqual(['30 today done dot:legs', '31 planned ring:pull', '01 plain']);

    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await readers(s2, gymId)).toEqual(after);
  });

  it('Ben’s exact week (Sat 31, 10:31): Push B moved to Fri, Legs B done Fri → Fri is Legs B’s, Up next Pull B on Sat, Push B Sun; every reader agrees', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);
    // Thu 29 morning: Push B and Pull B swap (Push B on Fri, Pull B on Thu); Thu then passes untrained.
    h.clockMs = toMs('2026-10-29T07:00:00.000Z');
    const ov = await s.plans.overview();
    if (ov == null) throw new Error('no plan');
    expect(await s.plans.weekChange({ planId: ov.planId, expectedVersion: ov.planVersion, opId: 'swap-push-b-fri', change: { kind: 'swap_days', dayIndex: 3, withDayIndex: 4 } })).toMatchObject({ ok: true });
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');

    h.clockMs = toMs('2026-10-31T10:31:00.000Z');
    const d = await loaded(s);
    expect(nextName(d)).toBe('Pull B');
    expect(tileText(s.todaySession.week(d, nextName(d)))).toEqual(['30 done dot:legs', '31 today planned ring:pull', '01 planned ring:push']);
    const fri = s.todaySession.daySheet(d, { date: '2026-10-30' }, d.nextKey, (x) => x);
    expect(`${fri.title} ${fri.statusText}`).toBe('Fri · Legs B Done');
    const sat = s.todaySession.daySheet(d, { date: '2026-10-31' }, d.nextKey, (x) => x);
    expect(sat.title).toBe('Sat · Pull B');
    expect(await libraryRows(s)).toEqual(['Push A done 2', 'Pull A done 1', 'Legs A done 0', 'Push B todo 6', 'Pull B next 5', 'Legs B done 4']);
    expect((await s.plans.overview())?.daysThisWeek.text).toBe('4 of 6');
    expect(await readers(s, gymId)).toMatchObject({ today: 'Pull B', library: 'Pull B', preview: 'Pull B', coach: 'Pull B' });

    // He does Pull B: Push B is the one left, on Sunday.
    await startDay(s, gymId, '2026-10-31T11:00:00.000Z', 'Pull B');
    h.clockMs = toMs('2026-10-31T13:00:00.000Z');
    const after = await loaded(s);
    expect(nextName(after)).toBe('Push B');
    expect(tileText(s.todaySession.week(after, null))).toEqual(['30 done dot:legs', '31 today done dot:pull', '01 planned ring:push']);
  });

  it('a workout still open today does not count: Up next stays Legs B', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B', true);
    h.clockMs = toMs('2026-10-30T17:30:00.000Z');
    const d = await loaded(s);
    expect(d.doneToday).toBe(false);
    expect(nextName(d)).toBe('Legs B');
    expect((await s.next.preview(gymId))?.title).toBe('Legs B');
  });

  it('Ben’s own `Make next` still wins after a workout today', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');
    h.clockMs = toMs('2026-10-30T19:00:00.000Z');
    const ov = await s.plans.overview();
    const pushB = ov?.days.find((x) => x.name === 'Push B');
    if (ov == null || pushB === undefined) throw new Error('no plan');
    const pinned = await s.plans.makeNext({ planId: ov.planId, routineId: pushB.routineId, expectedVersion: ov.planVersion, opId: 'pin-push-b' });
    expect(pinned.ok).toBe(true);
    expect(nextName(await loaded(s))).toBe('Push B');
    expect((await s.plans.overview())?.days.find((x) => x.state === 'next')?.name).toBe('Push B');
  });
});
