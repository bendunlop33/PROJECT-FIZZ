import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelRequest } from '@fizz/coach';
import { requestChars, WHY_RULE_LINE } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel } from './coach-model';
import { FakeHealth } from './fake-health';
import { createHarness, type Harness } from './harness';
import { benWithHistory, DAY, MONDAY, todayData, withPlan, type Ben } from './render/seed';

/**
 * (Ben, 11 Nov, build 564, coach on Today) "Why did you give me pull on Tuesday?": first `No answer in time. Nothing
 * changed.`, then "I can't verify why it was originally placed there". Real SQLite, the scripted model. The coach now
 * gets this week's schedule with reasons (YOUR DATA week.schedule) and the why turn is light: low effort, no plan-change
 * tool, one request.
 */

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness(MONDAY, { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const WHY = 'Why did you give me pull on Tuesday?';

/** Start a plan day by name and log every working set as planned, then finish. */
async function doDay(ben: Ben, name: string): Promise<void> {
  const s: AppServices = ben.s;
  const d = await todayData(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId: ben.gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const id = r.aggregate.session.id;
  for (;;) {
    const a = (await s.workout.load(id))?.aggregate;
    const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
    if (a === undefined || set === undefined) break;
    const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: conv === 'bodyweight' ? 0 : 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
  }
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

function yourData(req: ModelRequest | undefined): { week?: { schedule?: string[] }; build?: unknown } {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  return block?.type === 'message' ? (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>) : {};
}

/**
 * A 5-day PPL on Set days: Mon Push A, Tue Pull A, Wed Legs, Thu Push B, Fri Pull B. Push A done Monday, nothing on
 * Tuesday, Legs moved by Ben to Saturday; Thursday 22 Oct.
 */
async function thursday(): Promise<{ ben: Ben; d: TodaySessionData }> {
  const ben = await benWithHistory(h);
  const planId = await withPlan(h, ben, { sessions: 5, split: 'ppl', schedule: 'set', days: [0, 1, 2, 3, 4] });
  await doDay(ben, 'Push A');
  h.clockMs = Date.parse(MONDAY) + 1 * DAY;
  const plan = await ben.s.plans.active();
  const legs = plan?.days.find((x) => x.name === 'Legs');
  const before = await todayData(ben.s);
  if (legs === undefined || before.planVersion === null) throw new Error('no legs');
  const legsIndex = before.days.find((x) => x.name === 'Legs')?.dayIndex ?? -1;
  const moved = await ben.s.plans.moveDay({ planId, dayIndex: legsIndex, weekday: 5, expectedVersion: before.planVersion, opId: h.ids() });
  if (!moved.ok) throw new Error('not moved');
  h.clockMs = Date.parse(MONDAY) + 3 * DAY;
  return { ben, d: await todayData(ben.s) };
}

describe('the coach can explain the schedule (Ben, 11 Nov)', () => {
  it('YOUR DATA week.schedule: Pull A scheduled Tue and missed, Legs moved by Ben, Push A done, how Today’s card was picked', async () => {
    const { ben } = await thursday();
    expect(await ben.s.todaySession.scheduleFact()).toEqual([
      'Push A: done Mon 19 Oct',
      'Pull A: scheduled Tue 20 Oct · missed: nothing logged that day and no free plan day left this week',
      'Legs: moved by Ben from Wed to Sat 24 Oct',
      'Push B: scheduled Thu 22 Oct · Up next',
      'Pull B: scheduled Fri 23 Oct',
      "Today's card: Up next = Push B: the day not done this week whose type was trained longest ago, schedule breaks ties (last trained: Pull A 19 Oct, Push B 19 Oct, Pull B 19 Oct); Legs moved later by Ben, so after the others.",
    ]);
  });

  it('"Why did you give me pull on Tuesday?": the model gets the fact and the why rule, at low effort, in one light request (no plan-change nudge, no build view)', async () => {
    const { ben } = await thursday();
    model = new StepModel([() => replyWith('Pull A is on Tuesdays in your plan, and nothing was logged that day.')]);
    const r = await ben.s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: WHY, spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    expect(model.requests).toHaveLength(1);
    const req = model.requests[0];
    expect(req?.effort).toBe('low');
    const data = yourData(req);
    expect(data.week?.schedule).toContain('Pull A: scheduled Tue 20 Oct · missed: nothing logged that day and no free plan day left this week');
    expect(req?.instructions).toContain(WHY_RULE_LINE);
    // Before: "on Tuesday" read as a Set days change (plan work): the plan-change tool, its reply held for a plan card.
    const names = req?.tools.map((t) => t.name) ?? [];
    expect(names).not.toContain('propose_plan_change');
    expect(names).not.toContain('propose_workout');
    expect(data.build).toBeUndefined();
    expect(names).toEqual(expect.arrayContaining(['get_recent_actions', 'propose_week', 'reply']));
    // Measured on this fixture before: two medium requests of 56,084 characters (the first reply held: "Answer held; asked
    // for the plan change."), and plan work gets no lighter retry. Now one low request of about 53,400 with the fact.
    expect(requestChars(req ?? { instructions: '', input: [], tools: [] })).toBeLessThan(55_000);
  });

  it('a Garmin strength workout on the missed Tuesday: the fact says so and points to Log a past workout', async () => {
    await thursday();
    await h.forceClose();
    const fake = new FakeHealth();
    const { services: s } = await h.launch({ health: { port: fake, buildIncludesHealth: true } });
    const tue = Date.parse('2026-10-20T17:00:00.000Z');
    fake.addGarmin({ activityType: 50, startMs: tue, endMs: tue + 47 * 60_000, sourceName: 'Connect' });
    await s.health.setSwitch('readActivities', true);
    await s.health.readNow();
    model = new StepModel([() => replyWith('Pull A is on Tuesdays. Garmin has a strength session that day.')]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: WHY, spoken: false }, turnId: h.ids() });
    const pull = yourData(model.requests[0]).week?.schedule?.find((l) => l.startsWith('Pull A'));
    expect(pull).toBe('Pull A: scheduled Tue 20 Oct · missed: nothing logged that day and no free plan day left this week; Health has Strength 47 min (Garmin) that day, not logged in the app: offer Today › Log a past workout');
  });
});
