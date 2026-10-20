import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { DEFAULT_MORNING_REMINDER, toMs, type MorningReminderSettings, type PlanOverview, type PlannedReminder } from '@fizz/domain';

import type { AlertPermission } from '../src/alerts/notifier';
import { morningReminderOf, parsePrefs, updatePrefs } from '../src/device/prefs';
import { showMorningReminderInForeground } from '../src/alerts/presentation';
import { planPaused, readUpNextForecast } from '../src/reminders/forecast';
import { createMorningReminders, createReminderTriggers, morningTapOpensToday, NOTIFICATIONS_OFF_LINE, showNotificationsOff, toggleMorningReminder, turnReminderOn, watchPermission, type ReminderPort } from '../src/reminders/morning';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Morning reminder end to end (Ben, 20 Oct): real services on real SQLite,
 * the notification port faked. Turning it on asks iOS once; the reminders
 * read Up next exactly as Today does; a time change and a finished workout
 * reschedule; a denied permission shows one line with Open Settings.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Sun 18 Oct 2026, 17:00 London.
  h = createHarness('2026-10-18T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function fakePort(answer: AlertPermission = 'granted') {
  const pending = new Map<string, PlannedReminder>();
  const state = { permission: 'undetermined' as AlertPermission, asked: 0, scheduled: 0, cancelled: 0 };
  const port: ReminderPort = {
    permission: () => Promise.resolve(state.permission),
    request: () => {
      state.asked += 1;
      state.permission = answer;
      return Promise.resolve(answer);
    },
    pending: () => Promise.resolve([...pending.keys(), 'fizz.rest.someone-else']),
    schedule: (r) => {
      state.scheduled += 1;
      pending.set(r.identifier, r);
      return Promise.resolve();
    },
    cancel: (id) => {
      state.cancelled += 1;
      pending.delete(id);
      return Promise.resolve();
    },
  };
  return { port, pending, state };
}

const sorted = (m: Map<string, PlannedReminder>) => [...m.values()].sort((a, b) => a.fireAtMs - b.fireAtMs);
/** The session a reminder names: `Today: Pull` (day 1) or `Time to train` with `Pull is next · …` (a predicted day, Ben 20 Oct). */
const named = (r: PlannedReminder): string => (r.title.startsWith('Today: ') ? r.title.slice('Today: '.length) : (r.body.split(' · ')[0] ?? '').replace(/ is next$/u, ''));

/** Push A and Pull A in the rotation; Pull done last, so Up next is Push A. Clock: Tue 20 Oct, 06:00 London. */
async function benWithRotation(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += 60_000;
  const pull = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
  const pushA = await s.routines.saveFromSession({ sessionId: push, name: 'Push A', opId: 'save-push', addToRotation: true });
  h.clockMs += 60_000;
  const pullA = await s.routines.saveFromSession({ sessionId: pull, name: 'Pull A', opId: 'save-pull', addToRotation: true });
  if (!pushA.ok || !pullA.ok) throw new Error('save');
  h.clockMs = toMs('2026-10-20T05:00:00.000Z');
  return { s, gymId };
}

function controller(s: AppServices, port: ReminderPort, settings: { current: MorningReminderSettings }, counts = { forecasts: 0 }) {
  return createMorningReminders({
    port,
    forecast: (at) => {
      counts.forecasts += 1;
      return readUpNextForecast(s, at);
    },
    settings: () => settings.current,
    nowMs: () => h.clockMs,
    tz: () => h.now().tz,
    workoutActive: async () => (await s.sessions.active()) !== null,
  });
}

/** Starts Up next's routine (or a Repeat of Up next) now; returns the session ID. */
async function startUpNext(s: AppServices, gymId: string, opId: string): Promise<string> {
  const up = await s.next.preview(gymId);
  const started = await s.workout.start(up?.routine ? { gymId, opId, checkIn: null, routineOf: up.routine.id } : { gymId, opId, checkIn: null, repeatOf: up?.sourceSessionId ?? '' });
  if (!started.ok) throw new Error(started.error.message);
  return started.aggregate.session.id;
}

/** Logs every pending working set and finishes. */
async function logAndFinish(s: AppServices, id: string, opId: string): Promise<void> {
  const agg = await s.workout.load(id);
  if (!agg) throw new Error('no session');
  for (const set of agg.aggregate.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup')) {
    h.clockMs += 60_000;
    const load = set.planned.load ?? { value: 20, unit: 'kg' as const, convention: agg.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total' };
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  const cur = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId, expectedVersion: cur?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

describe('morning reminder', () => {
  it('off until Ben turns it on; turning on asks iOS once, then schedules what Today shows', async () => {
    const { s, gymId } = await benWithRotation();
    const { port, pending, state } = fakePort('granted');
    const settings = { current: DEFAULT_MORNING_REMINDER };
    const reminders = controller(s, port, settings);

    await reminders.refresh();
    expect(pending.size).toBe(0);
    expect(state.asked).toBe(0);

    // Ben turns it on in Profile › Morning reminder.
    expect(await turnReminderOn(port)).toBe('granted');
    settings.current = { ...settings.current, on: true };
    await reminders.refresh();
    expect(state.asked).toBe(1);

    const today = await s.next.preview(gymId);
    expect(today?.title).toBe('Push A');
    const r = sorted(pending);
    expect(r).toHaveLength(7);
    expect(r[0]).toMatchObject({ identifier: 'fizz.morning.2026-10-20', fireAtLocal: { date: '2026-10-20', hour: 7, minute: 0 }, title: 'Today: Push A' });
    expect(r[0]?.body).toMatch(/^about \d+ min · Main Gym$/u);
    // Later days walk the rotation, assuming each is done.
    expect(r.map((x) => x.title)).toEqual(['Today: Push A', 'Time to train', 'Time to train', 'Time to train', 'Time to train', 'Time to train', 'Time to train']);
    expect(r.map(named)).toEqual(['Push A', 'Pull A', 'Push A', 'Pull A', 'Push A', 'Pull A', 'Push A']);
    expect(r[1]?.body).toMatch(/^Pull A is next · about \d+ min · Main Gym$/u);
    // Turning it on again doesn't ask again.
    await turnReminderOn(port);
    expect(state.asked).toBe(1);
  });

  it('already allowed (rest alerts): on by default without asking', async () => {
    const { s } = await benWithRotation();
    const { port, pending, state } = fakePort();
    state.permission = 'granted';
    await controller(s, port, { current: DEFAULT_MORNING_REMINDER }).refresh();
    expect(pending.size).toBe(7);
    expect(state.asked).toBe(0);
  });

  it('changing the time to 06:30 replaces every pending reminder; other notifications are left alone', async () => {
    const { s } = await benWithRotation();
    const { port, pending } = fakePort();
    const settings = { current: { ...DEFAULT_MORNING_REMINDER, on: true } };
    const reminders = controller(s, port, settings);
    await reminders.refresh();
    expect(sorted(pending)[0]?.fireAtLocal).toEqual({ date: '2026-10-20', hour: 7, minute: 0 });

    // 06:00 now, so today’s 06:30 is still ahead.
    settings.current = { ...settings.current, hour: 6, minute: 30 };
    await reminders.refresh();
    const r = sorted(pending);
    expect(r).toHaveLength(7);
    expect(r.every((x) => x.fireAtLocal.hour === 6 && x.fireAtLocal.minute === 30)).toBe(true);
    expect(r[0]?.fireAtMs).toBe(toMs('2026-10-20T05:30:00.000Z'));

    // Fewer days: the dropped ones are cancelled.
    settings.current = { ...settings.current, days: ['mon', 'wed', 'fri'] };
    await reminders.refresh();
    expect(sorted(pending).map((x) => [x.fireAtLocal.date, x.title, named(x)])).toEqual([
      ['2026-10-21', 'Today: Push A', 'Push A'],
      ['2026-10-23', 'Time to train', 'Pull A'],
      ['2026-10-26', 'Time to train', 'Push A'],
    ]);
  });

  it('finishing a workout reschedules: none today, tomorrow is the new Up next', async () => {
    const { s, gymId } = await benWithRotation();
    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();
    expect(sorted(pending)[0]).toMatchObject({ fireAtLocal: { date: '2026-10-20' }, title: 'Today: Push A' });

    // An early Push A at 06:00, finished before 07:00.
    const routine = (await s.routines.list()).find((r) => r.name === 'Push A');
    if (!routine) throw new Error('no routine');
    const started = await s.workout.start({ gymId, opId: 'early', checkIn: null, routineOf: routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const id = started.aggregate.session.id;
    for (const set of started.aggregate.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup')) {
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    const cur = await s.workout.load(id);
    const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: 'fin', expectedVersion: cur?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);

    await reminders.refresh();
    const r = sorted(pending);
    expect(r[0]).toMatchObject({ identifier: 'fizz.morning.2026-10-21', title: 'Today: Pull A' });
    expect(pending.has('fizz.morning.2026-10-20')).toBe(false);
    expect(r).toHaveLength(6);
  });

  it('no Up next (nothing done yet): nothing is sent', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    expect(pending.size).toBe(0);
  });

  it('turning it off cancels them all', async () => {
    const { s } = await benWithRotation();
    const { port, pending } = fakePort();
    const settings = { current: { ...DEFAULT_MORNING_REMINDER, on: true } as MorningReminderSettings };
    const reminders = controller(s, port, settings);
    await reminders.refresh();
    expect(pending.size).toBe(7);
    settings.current = { ...settings.current, on: false };
    await reminders.refresh();
    expect(pending.size).toBe(0);
    h.clockMs += DAY;
  });

  it('permission denied: one line with Open Settings; the choice is kept', async () => {
    const { port, state } = fakePort('denied');
    expect(await turnReminderOn(port)).toBe('denied');
    expect(showNotificationsOff(true, 'denied')).toBe(true);
    expect(NOTIFICATIONS_OFF_LINE).toBe('Notifications are off in iPhone Settings');
    // Already denied: iOS can't ask again, so it isn't.
    await turnReminderOn(port);
    expect(state.asked).toBe(1);
    expect(showNotificationsOff(false, 'denied')).toBe(false);
    expect(showNotificationsOff(true, 'granted')).toBe(false);
  });

  it('settings are saved with this phone’s preferences', () => {
    const saved = updatePrefs(null, { morningReminder: { on: true, hour: 6, minute: 30, days: ['mon', 'tue'] } });
    expect(morningReminderOf(parsePrefs(JSON.stringify(saved)))).toEqual({ on: true, hour: 6, minute: 30, days: ['mon', 'tue'] });
    expect(morningReminderOf(parsePrefs(null))).toEqual(DEFAULT_MORNING_REMINDER);
  });
});

describe('morning reminder with a coach plan', () => {
  const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
  const DAYS: [string, string | null, string[]][] = [
    ['Push', 'push', ['Bench press']],
    ['Pull', 'pull', ['Lat pulldown']],
    ['Legs', 'legs', ['Back squat']],
    ['Upper', null, ['Overhead press']],
  ];
  const stub = (req: ModelRequest): ModelEvent[] => {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    if (block?.type !== 'message') throw new Error('no context');
    const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
    const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? 'missing';
    return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, names]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: names.map((n) => ex(idOf(n))) })), message: 'Four days.', minutes: null, gymName: null });
  };

  /** Ben asks the coach for the 4-day plan and applies it; returns the plan and its days by name. */
  async function applyPlan(s: AppServices): Promise<{ planId: string; version: number; dayId: (name: string) => string }> {
    model = new StepModel([stub, () => replyWith('Here is your week.')]);
    const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
    const record = result.cards[0]?.record;
    if (record?.detail.kind !== 'build_plan') throw new Error('no plan');
    const card = await s.plans.card({ planId: record.detail.planId, versionN: 1 });
    if (card === null) throw new Error('card');
    const applied = await s.plans.apply({ planId: card.planId, versionN: 1, expectedVersion: card.planVersion, mode: 'replace', opId: 'apply' });
    if (!applied.ok) throw new Error('apply');
    const overview = await s.plans.overview();
    if (overview === null) throw new Error('overview');
    const dayId = (name: string) => overview.days.find((d) => d.name === name)?.routineId ?? 'missing';
    return { planId: overview.planId, version: overview.planVersion, dayId };
  }

  const titles = (m: Map<string, PlannedReminder>) => sorted(m).map(named);
  const byDate = (m: Map<string, PlannedReminder>) => new Map(sorted(m).map((x) => [x.fireAtLocal.date, named(x)]));
  const planDay = (r: PlannedReminder) => r.body.split(' · ').find((p) => p.startsWith('Day ')) ?? '';

  it('day 1 is Up next by the adaptive rule (`Day 3 of 4`); days 2–7 follow the same rule, and doing day 1 makes day 2 the real Up next', async () => {
    const { s, gymId } = await benWithRotation();
    await applyPlan(s);
    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();

    // Bench (Push) and pulldowns (Pull) on Sunday, before the plan: Legs is due first, not day 1.
    expect((await s.next.preview(gymId))?.title).toBe('Legs');
    const before = sorted(pending);
    expect(before[0]).toMatchObject({ fireAtLocal: { date: '2026-10-20' }, title: 'Today: Legs' });
    expect(before[0]?.body).toMatch(/^Day 3 of 4 · about \d+ min · Main Gym$/u);
    // Never the day just done; Upper (never done) before Push and Pull (done Sunday); then each in turn.
    expect(titles(pending)).toEqual(['Legs', 'Upper', 'Push', 'Pull', 'Legs', 'Upper', 'Push']);
    expect(before.map(planDay)).toEqual(['Day 3 of 4', 'Day 4 of 4', 'Day 1 of 4', 'Day 2 of 4', 'Day 3 of 4', 'Day 4 of 4', 'Day 1 of 4']);

    // Legs done this morning: tomorrow on is what was predicted.
    await logAndFinish(s, await startUpNext(s, gymId, 'legs'), 'fin-legs');
    await reminders.refresh();
    expect((await s.next.preview(gymId))?.title).toBe('Upper');
    const was = new Map(before.map((x) => [x.fireAtLocal.date, named(x)]));
    const now = byDate(pending);
    expect(now.has('2026-10-20')).toBe(false);
    for (const [date, title] of now) if (was.has(date)) expect([date, title]).toEqual([date, was.get(date)]);
  });

  it('the run rule on predicted days (Ben, 20 Oct): no Legs the day before a planned long run; Legs on the run’s own day', async () => {
    const { s } = await benWithRotation();
    await applyPlan(s);
    // Ben plans a long run for Sunday 25 Oct.
    const run = await s.activities.add({ id: h.ids(), opId: 'plan-run', fields: { kind: 'run', status: 'planned', date: '2026-10-25', durationS: null, distanceM: 18_000, effort: 'long' } });
    expect(run.ok).toBe(true);
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    // Without the run: Legs, Upper, Push, Pull, Legs (Sat), Upper, Push. Saturday is the day before: Upper first.
    expect(titles(pending)).toEqual(['Legs', 'Upper', 'Push', 'Pull', 'Upper', 'Legs', 'Push']);
    expect(byDate(pending).get('2026-10-24')).toBe('Upper');
    expect(sorted(pending)[4]).toMatchObject({ title: 'Time to train' });
    expect(sorted(pending)[4]?.body).toMatch(/^Upper is next · Day 4 of 4 · about \d+ min · Main Gym$/u);

    // Ben cancels the run: Saturday is Legs again.
    if (!run.ok) throw new Error('run');
    const cancelled = await s.activities.remove({ activityId: run.activity.id, expectedVersion: run.activity.version, opId: 'cancel-run' });
    expect(cancelled.ok).toBe(true);
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    expect(byDate(pending).get('2026-10-24')).toBe('Legs');
  });

  it('a planned long run yesterday, never marked done, counts: today’s Up next and its reminder aren’t Legs', async () => {
    const { s, gymId } = await benWithRotation();
    await applyPlan(s);
    expect((await s.next.preview(gymId))?.title).toBe('Legs');
    const run = await s.activities.add({ id: h.ids(), opId: 'mon-run', fields: { kind: 'run', status: 'planned', date: '2026-10-19', durationS: null, distanceM: null, effort: 'long' } });
    expect(run.ok).toBe(true);
    const up = await s.next.preview(gymId);
    expect(up?.title).not.toBe('Legs');
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    expect(sorted(pending)[0]).toMatchObject({ fireAtLocal: { date: '2026-10-20' }, title: `Today: ${up?.title ?? ''}` });
  });

  it('legs trained off-plan: Legs isn’t predicted first, it waits its turn', async () => {
    const { s, gymId } = await benWithRotation();
    await applyPlan(s);
    // Mon evening: an off-plan squat session (not a plan day).
    h.clockMs = toMs('2026-10-19T17:00:00.000Z');
    await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
    h.clockMs = toMs('2026-10-20T05:00:00.000Z');
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    const t = titles(pending);
    expect(t[0]).toBe((await s.next.preview(gymId))?.title);
    expect(t.slice(0, 3)).not.toContain('Legs');
    expect(t).toEqual(['Upper', 'Push', 'Pull', 'Legs', 'Upper', 'Push', 'Pull']);
  });

  it('`Make next` pin: the pinned day first, then the rule (the pin is used up once its day is done)', async () => {
    const { s, gymId } = await benWithRotation();
    const plan = await applyPlan(s);
    const pinned = await s.plans.makeNext({ planId: plan.planId, routineId: plan.dayId('Pull'), expectedVersion: plan.version, opId: 'pin-pull' });
    expect(pinned.ok).toBe(true);
    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();
    expect((await s.next.preview(gymId))?.title).toBe('Pull');
    expect(titles(pending)).toEqual(['Pull', 'Legs', 'Upper', 'Push', 'Pull', 'Legs', 'Upper']);
    const predicted = byDate(pending);

    // Ben does Pull: the pin is used up and tomorrow is what was predicted.
    await logAndFinish(s, await startUpNext(s, gymId, 'pull'), 'fin-pull');
    await reminders.refresh();
    expect((await s.next.preview(gymId))?.title).toBe('Legs');
    for (const [date, title] of byDate(pending)) if (predicted.has(date)) expect([date, title]).toEqual([date, predicted.get(date)]);
  });

  it('review ben-runs-20oct B2: a `Make next` leg day on day 1 tomorrow stays put before a long run', async () => {
    const { s, gymId } = await benWithRotation();
    const plan = await applyPlan(s);
    const pinned = await s.plans.makeNext({ planId: plan.planId, routineId: plan.dayId('Legs'), expectedVersion: plan.version, opId: 'pin-legs' });
    expect(pinned.ok).toBe(true);
    // A long run Thu 22 Oct; Tue 07:30, so today's 07:00 has passed and day 1 is Wed, the day before the run.
    expect((await s.activities.add({ id: h.ids(), opId: 'thu-run', fields: { kind: 'run', status: 'planned', date: '2026-10-22', durationS: null, distanceM: null, effort: 'long' } })).ok).toBe(true);
    h.clockMs = toMs('2026-10-20T06:30:00.000Z');
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    expect(sorted(pending)[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Today: Legs' });
    // Wed morning: Up next keeps the pinned Legs first too.
    h.clockMs = toMs('2026-10-21T05:00:00.000Z');
    expect((await s.next.preview(gymId))?.title).toBe('Legs');
  });

  it('review ben-runs-20oct S3: a plan day 1 tomorrow is the day Up next will name tomorrow', async () => {
    const { s, gymId } = await benWithRotation();
    await applyPlan(s);
    expect((await s.next.preview(gymId))?.title).toBe('Legs');
    expect((await s.activities.add({ id: h.ids(), opId: 'thu-run', fields: { kind: 'run', status: 'planned', date: '2026-10-22', durationS: null, distanceM: null, effort: 'long' } })).ok).toBe(true);
    h.clockMs = toMs('2026-10-20T06:30:00.000Z');
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    const first = sorted(pending)[0];
    expect(first).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Time to train' });
    h.clockMs = toMs('2026-10-21T05:00:00.000Z');
    const wed = (await s.next.preview(gymId))?.title;
    expect(wed).not.toBe('Legs');
    expect(first === undefined ? '' : named(first)).toBe(wed);
  });

  it('S3 merge gate: paused through the plan service → no reminders; Resume → they return', async () => {
    const { s } = await benWithRotation();
    const plan = await applyPlan(s);
    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();
    expect(pending.size).toBe(7);

    const paused = await s.plans.pause({ planId: plan.planId, untilDate: null, expectedVersion: plan.version, opId: 'pause' });
    if (!paused.ok) throw new Error(paused.message);
    const overview = await s.plans.overview();
    expect(overview?.paused).toMatchObject({ untilDate: null });
    expect(planPaused(overview)).toBe(true);
    await reminders.refresh();
    expect(pending.size).toBe(0);

    const resumed = await s.plans.resumePause({ planId: plan.planId, expectedVersion: paused.plan.version, opId: 'resume' });
    if (!resumed.ok) throw new Error(resumed.message);
    expect(planPaused(await s.plans.overview())).toBe(false);
    await reminders.refresh();
    expect(pending.size).toBe(7);
    expect(sorted(pending)[0]).toMatchObject({ title: 'Today: Legs' });
    expect(sorted(pending)[0]?.body).toMatch(/^Day 3 of 4 · /u);
  });
});

describe('morning reminder: review fixes (morning-20oct)', () => {
  it('B1: a freeform workout and no split: only today is reminded, never a split Ben never set up', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }] },
    ]);
    h.clockMs = toMs('2026-10-20T05:00:00.000Z');
    const up = await s.next.preview(gymId);
    expect(up?.routine).toBeNull();
    const { port, pending } = fakePort();
    await controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    const r = sorted(pending);
    expect(r.map((x) => [x.fireAtLocal.date, x.title])).toEqual([['2026-10-20', `Today: ${up?.title ?? ''}`]]);
    expect(r.some((x) => /Push|Pull|Legs/u.test(x.title))).toBe(false);
  });

  it('S1/S2: a workout started before the reminder takes today’s off, with no forecast; Finish recomputes in full', async () => {
    const { s, gymId } = await benWithRotation();
    const { port, pending, state } = fakePort();
    const counts = { forecasts: 0 };
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }, counts);
    await reminders.refresh();
    expect(pending.has('fizz.morning.2026-10-20')).toBe(true);
    expect(counts.forecasts).toBe(1);

    // 06:00: Ben starts; the start's write and every return to the app mid-workout only quieten today.
    const id = await startUpNext(s, gymId, 'early');
    await reminders.refresh();
    await reminders.refresh();
    expect(pending.has('fizz.morning.2026-10-20')).toBe(false);
    expect(pending.size).toBe(6);
    expect(counts.forecasts).toBe(1);
    const cancelsMidWorkout = state.cancelled;
    await reminders.refresh();
    expect(state.cancelled).toBe(cancelsMidWorkout);

    // A settings change mid-workout recomputes in full; today stays off (a workout started today).
    await reminders.refresh({ force: true });
    expect(counts.forecasts).toBe(2);
    expect(pending.has('fizz.morning.2026-10-20')).toBe(false);

    await logAndFinish(s, id, 'fin');
    await reminders.refresh();
    expect(counts.forecasts).toBe(3);
    expect(sorted(pending)[0]).toMatchObject({ identifier: 'fizz.morning.2026-10-21', title: 'Today: Pull A' });
  });

  it('S1 backstop: a morning reminder never shows over the workout screen', () => {
    expect(showMorningReminderInForeground({ appActive: true, workoutOnScreen: true })).toBe(false);
    expect(showMorningReminderInForeground({ appActive: true, workoutOnScreen: false })).toBe(true);
    expect(showMorningReminderInForeground({ appActive: false, workoutOnScreen: true })).toBe(true);
  });

  it('S5: unchanged plan writes nothing while iOS still has them; reschedules when iOS dropped them', async () => {
    const { s } = await benWithRotation();
    const { port, pending, state } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();
    expect(state.scheduled).toBe(7);
    await reminders.refresh();
    expect(state.scheduled).toBe(7);
    // iOS purged them (notifications reset in iPhone Settings).
    pending.clear();
    await reminders.refresh();
    expect(state.scheduled).toBe(14);
    expect(pending.size).toBe(7);
  });

  it('S3: a paused plan (PlanOverview.paused, as claude/plan-adapt-20oct reports it) sends nothing', async () => {
    const { s } = await benWithRotation();
    expect(planPaused(null)).toBe(false);
    const paused = { paused: { text: 'Paused', untilDate: '2026-11-03' } } as unknown as PlanOverview;
    expect(planPaused(paused)).toBe(true);
    expect(planPaused({ paused: null } as unknown as PlanOverview)).toBe(false);
    const sPaused: AppServices = { ...s, plans: { ...s.plans, overview: () => Promise.resolve(paused) } };
    const { port, pending } = fakePort();
    await controller(sPaused, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } }).refresh();
    expect(pending.size).toBe(0);
  });

  it('S4: the Host’s events: a burst of writes is one refresh after it settles; settings force; foreground is at once', () => {
    const calls: { force?: boolean }[] = [];
    const timers = new Map<number, () => void>();
    let n = 0;
    const t = createReminderTriggers({
      refresh: (o) => {
        calls.push(o ?? {});
        return Promise.resolve();
      },
      settleMs: 1500,
      setTimer: (fn) => {
        timers.set((n += 1), fn);
        return n;
      },
      clearTimer: (id) => timers.delete(id as number),
    });
    const flush = () => {
      const fns = [...timers.values()];
      timers.clear();
      for (const fn of fns) fn();
    };
    t.launched();
    flush();
    expect(calls).toEqual([{ force: false }]);
    t.dataChanged();
    t.dataChanged();
    t.dataChanged();
    expect(timers.size).toBe(1);
    flush();
    expect(calls).toHaveLength(2);
    t.settingsChanged();
    t.dataChanged();
    flush();
    expect(calls.at(-1)).toEqual({ force: true });
    t.foreground();
    expect(calls).toHaveLength(4);
    t.dataChanged();
    t.dispose();
    expect(timers.size).toBe(0);
  });

  it('S4: Finish → the write the screen reports → the Host’s settle → rescheduled (real services)', async () => {
    const { s, gymId } = await benWithRotation();
    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    const timers: (() => void)[] = [];
    let last: Promise<void> = Promise.resolve();
    const t = createReminderTriggers({
      refresh: (o) => (last = reminders.refresh(o)),
      settleMs: 1500,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined,
    });
    const flush = async () => {
      timers.splice(0).at(-1)?.();
      await last;
    };
    t.launched();
    await flush();
    expect(sorted(pending)[0]?.title).toBe('Today: Push A');
    const id = await startUpNext(s, gymId, 'early');
    t.dataChanged();
    await flush();
    expect(pending.has('fizz.morning.2026-10-20')).toBe(false);
    await logAndFinish(s, id, 'fin');
    t.dataChanged();
    await flush();
    expect(sorted(pending)[0]).toMatchObject({ identifier: 'fizz.morning.2026-10-21', title: 'Today: Pull A' });
  });

  it('S4: the switch saves first, then asks iOS; denied shows the one line', async () => {
    const order: string[] = [];
    const { port } = fakePort('denied');
    const traced: ReminderPort = {
      ...port,
      request: () => {
        order.push('ask');
        return port.request();
      },
    };
    const asked = await toggleMorningReminder(true, {
      save: (on) => order.push(`save ${String(on)}`),
      port: traced,
    });
    expect(order).toEqual(['save true', 'ask']);
    expect(asked).toBe('denied');
    expect(showNotificationsOff(true, asked ?? 'unknown')).toBe(true);
    expect(await toggleMorningReminder(false, { save: (on) => order.push(`save ${String(on)}`), port: traced })).toBeNull();
    expect(order).toEqual(['save true', 'ask', 'save false']);
  });

  it('S6: the permission line follows a round trip to iPhone Settings', async () => {
    let ios: AlertPermission = 'denied';
    let onActive: (() => void) | null = null;
    const seen: AlertPermission[] = [];
    const stop = watchPermission({
      read: () => Promise.resolve(ios),
      onActive: (fn) => {
        onActive = fn;
        return () => {
          onActive = null;
        };
      },
      set: (p) => seen.push(p),
    });
    await Promise.resolve();
    expect(seen).toEqual(['denied']);
    ios = 'granted';
    (onActive as (() => void) | null)?.();
    await Promise.resolve();
    expect(seen).toEqual(['denied', 'granted']);
    stop();
    expect(onActive).toBeNull();
  });

  it('S4: a tap on a morning reminder opens Today, not over a workout or before set-up', () => {
    const tap = { identifier: 'fizz.morning.2026-10-20', setupDone: true, navReady: true, currentRoute: 'Profile' };
    expect(morningTapOpensToday(tap)).toBe(true);
    expect(morningTapOpensToday({ ...tap, currentRoute: 'Workout' })).toBe(false);
    expect(morningTapOpensToday({ ...tap, setupDone: false })).toBe(false);
    expect(morningTapOpensToday({ ...tap, navReady: false })).toBe(false);
    expect(morningTapOpensToday({ ...tap, identifier: 'fizz.rest.abc' })).toBe(false);
  });

  it('S4: the screens and Host are glue over these rules (source checks)', () => {
    const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
    const host = src('reminders/MorningReminderHost.tsx');
    expect(host).toMatch(/createReminderTriggers\(/u);
    expect(host).toMatch(/workoutActive:/u);
    const screen = src('screens/profile/MorningReminderScreen.tsx');
    expect(screen).toMatch(/toggleMorningReminder\(/u);
    expect(screen).toMatch(/watchPermission\(/u);
    expect(screen).toMatch(/text=\{NOTIFICATIONS_OFF_LINE\}/u);
    expect(screen).toMatch(/label="Open Settings" onPress=\{\(\) => void Linking\.openSettings\(\)\}/u);
    expect(screen).toMatch(/accessibilityLabel=\{weekdayLong\(d\)\}/u);
    expect(src('navigation/AppNavigator.tsx')).toMatch(/morningTapOpensToday\(/u);
    expect(src('alerts/notifier.ts')).toMatch(/showMorningReminderInForeground\(/u);
    expect(src('reminders/forecast.ts')).not.toMatch(/buildCard/u);
  });
});
