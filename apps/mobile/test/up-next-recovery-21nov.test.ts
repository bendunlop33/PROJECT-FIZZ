import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MORNING_REMINDER, toMs } from '@fizz/domain';

import { readUpNextForecast } from '../src/reminders/forecast';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 21 Nov, build 576: "if I missed two sessions it says Legs when I did legs 2 sessions ago and it should be
 * Pull") Real SQLite, offline apart from a scripted coach. A 6-day Set days plan (Mon Push A, Tue Pull A, Wed Legs A,
 * Thu Push B, Fri Pull B, Sat Legs B), applied Mon 2 Nov, two full weeks trained. Week of 16 Nov: Mon Pull A, Tue/Wed
 * missed, Thu Legs A, Fri a session that isn't a plan day (bench and rows: Today's strip counts it as Push A, orange),
 * Sat 21 morning.
 * - Before the fix, Fri's few rows counted as pull "trained Fri", so Legs B (legs Thu) came before Pull B (pull Mon):
 *   Up next Legs B on Sat, Pull B shown missed on Fri. Now an off-plan workout counts for the day it mainly trained.
 * - The behind offer (MS4) agrees: a day trained in the last 2 days never comes before one that wasn't.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-11-02T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
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

async function startDay(s: AppServices, gymId: string, at: string, name: string): Promise<void> {
  h.clockMs = Date.parse(at);
  const d = await loaded(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  h.clockMs += 60_000;
  await finishWorkout(h, s, r.aggregate.session.id);
}

const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;
const DAYS = ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'];

type Friday = 'upper' | 'push' | 'run' | 'nothing';

/** Two full weeks, then Mon 16 Pull A, Thu 19 Legs A and `fri` on Fri 20; the clock at Sat 21, 09:00 London. */
async function bensWeek(s: AppServices, gymId: string, fri: Friday): Promise<void> {
  await applyPlan(s);
  for (const dates of [['02', '03', '04', '05', '06', '07'], ['09', '10', '11', '12', '13', '14']]) {
    for (const [i, name] of DAYS.entries()) await startDay(s, gymId, `2026-11-${dates[i] ?? ''}T18:00:00.000Z`, name);
  }
  await startDay(s, gymId, '2026-11-16T18:00:00.000Z', 'Pull A');
  await startDay(s, gymId, '2026-11-19T18:00:00.000Z', 'Legs A');
  h.clockMs = Date.parse('2026-11-20T18:00:00.000Z');
  if (fri === 'push') await startDay(s, gymId, '2026-11-20T18:00:00.000Z', 'Push A');
  if (fri === 'upper') {
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 80, reps: 5 }, { load: 80, reps: 5 }, { load: 80, reps: 5 }] },
      { exercise: 'Barbell row', sets: [{ load: 70, reps: 8 }, { load: 70, reps: 8 }] },
    ]);
  }
  if (fri === 'run') expect((await s.activities.add({ id: h.ids(), opId: 'run-20', fields: { kind: 'run', status: 'done', date: '2026-11-20', durationS: 1800, distanceM: 6000, effort: null } })).ok).toBe(true);
  h.clockMs = toMs('2026-11-21T09:00:00.000Z');
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

/** Every reader of Up next, the behind offer's order and the week's coach schedule line for Up next. */
async function readers(s: AppServices, gymId: string) {
  const d = await loaded(s);
  const forecast = await readUpNextForecast(s, { nowMs: h.clockMs, tz: 'Europe/London', settings: DEFAULT_MORNING_REMINDER });
  const lines = await s.todaySession.scheduleFact();
  return {
    today: nextName(d),
    library: (await s.plans.overview())?.days.find((x) => x.state === 'next')?.name ?? null,
    preview: (await s.next.preview(gymId))?.title ?? null,
    reminder: forecast.firstOn?.title ?? forecast.next?.title ?? null,
    coach: await coachUpNext(s),
    behind: d.behind?.scores.map((x) => x.name) ?? null,
    builtIn: d.behind?.builtIn?.name ?? null,
    schedule: lines?.find((l) => /up next/iu.test(l)) ?? null,
  };
}

/** Thu–Sat tiles: `19 done dot:legs missed:push`. */
const tileText = (t: ReturnType<AppServices['todaySession']['week']>) => t.slice(3, 6).map((x) => `${x.date.slice(8)} ${x.state}${x.marks.map((m) => ` ${m.shape}:${m.colour}`).join('')}`);

describe('Up next after missed days: the most rested type first (Ben, 21 Nov, build 576)', () => {
  it('Ben’s week (Fri: bench and rows, not a plan day): Pull B, not Legs B, in every reader and the behind offer; a force-close re-derives it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId, 'upper');
    const r = await readers(s, gymId);
    expect(r.schedule).toMatch(/^Pull B: Sat 21 Nov: Up next\b/u);
    expect(r).toMatchObject({ today: 'Pull B', library: 'Pull B', preview: 'Pull B', reminder: 'Pull B', coach: 'Pull B', builtIn: null });
    // MS4: Legs (Thu) and Push (Fri) were trained in the last 2 days; Pull B first, as the card.
    expect(r.behind?.[0]).toBe('Pull B');
    // Pull B is Saturday's; Legs B (its own day) doesn't fit this week; Push B missed on Thu.
    const d = await loaded(s);
    expect(tileText(s.todaySession.week(d, nextName(d)))).toEqual(['19 done dot:legs missed:push', '20 done dot:push', '21 planned ring:pull missed:legs']);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(nextName(await loaded(s2))).toBe('Pull B');
  }, 30_000);

  it('Fri a Push A workout: Pull B; the behind offer agrees (no Legs B built-in)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId, 'push');
    const r = await readers(s, gymId);
    expect(r).toMatchObject({ today: 'Pull B', library: 'Pull B', preview: 'Pull B', reminder: 'Pull B', coach: 'Pull B', builtIn: null });
    expect(r.behind?.[0]).toBe('Pull B');
    expect(r.behind?.at(-1)).not.toBe('Pull B');
  }, 30_000);

  it.each(['run', 'nothing'] as const)('Fri %s: push (last trained the week before) is the most rested: Push A; legs (Thu) last', async (fri) => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId, fri);
    const r = await readers(s, gymId);
    expect(r).toMatchObject({ today: 'Push A', library: 'Push A', preview: 'Push A', reminder: 'Push A', coach: 'Push A', builtIn: null });
    expect(r.behind?.at(-1)).toBe('Legs B');
  }, 30_000);

  it('Ben’s own `Make next` Legs B still wins', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await bensWeek(s, gymId, 'upper');
    const ov = await s.plans.overview();
    const legsB = ov?.days.find((x) => x.name === 'Legs B');
    if (ov == null || legsB === undefined) throw new Error('no plan');
    expect((await s.plans.makeNext({ planId: ov.planId, routineId: legsB.routineId, expectedVersion: ov.planVersion, opId: 'pin-legs-b' })).ok).toBe(true);
    const d = await loaded(s);
    expect(nextName(d)).toBe('Legs B');
    expect((await s.next.preview(gymId))?.title).toBe('Legs B');
    // A day Ben chose himself: no `Adjust today?` offer (MS2).
    expect(d.behind?.gate.pickedToday).toBe(true);
  }, 30_000);
});
