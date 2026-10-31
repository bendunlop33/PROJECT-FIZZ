import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MORNING_REMINDER, toMs } from '@fizz/domain';

import { readUpNextForecast } from '../src/reminders/forecast';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct: "Yes") Once Ben has finished a gym workout today, Up next plans from tomorrow. Real SQLite, offline
 * apart from a scripted coach. Ben's 6-day Set days plan (Mon Push A, Tue Pull A, Wed Legs, Thu Push B, Fri Pull B, Sat
 * Legs B), applied Mon 26. Done: Legs Mon 26 (off-plan, squat first), Pull A Tue 27, Push A Wed 28, Legs B Fri 30.
 * - Fri before training: Up next is Pull B (Friday's day).
 * - Fri after Legs B: Saturday's Legs B is done, so the earliest missed day, Push B (Thu).
 * Today's card, Library › Plan's NEXT, the tiles, the morning reminder and the coach all read the one order. An open
 * workout doesn't count; Ben's own `Make next` still wins; a force-close re-derives it.
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

describe('Up next plans from tomorrow after Ben’s workout today (Ben, 31 Oct)', () => {
  it('Fri before training: Pull B; after Legs B: Push B, in every reader; a force-close re-derives it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);

    // Fri 30, 06:00 London (before the 07:00 reminder): today's scheduled day.
    h.clockMs = toMs('2026-10-30T06:00:00.000Z');
    const before = await readers(s, gymId);
    expect(before).toEqual({ today: 'Pull B', library: 'Pull B', preview: 'Pull B', reminder: 'Pull B', coach: 'Pull B', friday: ['ring:planned'] });

    // Legs B on Friday (finished), then the evening.
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');
    h.clockMs = toMs('2026-10-30T19:00:00.000Z');
    const after = await readers(s, gymId);
    expect(after).toEqual({ today: 'Push B', library: 'Push B', preview: 'Push B', reminder: 'Push B', coach: 'Push B', friday: ['dot'] });

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await readers(s2, gymId);
    expect(again).toEqual(after);
  });

  it('a workout still open today does not count: Up next stays Pull B', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B', true);
    h.clockMs = toMs('2026-10-30T17:30:00.000Z');
    const d = await loaded(s);
    expect(d.doneToday).toBe(false);
    expect(nextName(d)).toBe('Pull B');
    expect((await s.next.preview(gymId))?.title).toBe('Pull B');
  });

  it('Ben’s own `Make next` still wins after a workout today', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await monToThu(s, gymId);
    await startDay(s, gymId, '2026-10-30T17:00:00.000Z', 'Legs B');
    h.clockMs = toMs('2026-10-30T19:00:00.000Z');
    const ov = await s.plans.overview();
    const pullB = ov?.days.find((x) => x.name === 'Pull B');
    if (ov == null || pullB === undefined) throw new Error('no plan');
    const pinned = await s.plans.makeNext({ planId: ov.planId, routineId: pullB.routineId, expectedVersion: ov.planVersion, opId: 'pin-pull-b' });
    expect(pinned.ok).toBe(true);
    expect(nextName(await loaded(s))).toBe('Pull B');
    expect((await s.plans.overview())?.days.find((x) => x.state === 'next')?.name).toBe('Pull B');
  });
});
