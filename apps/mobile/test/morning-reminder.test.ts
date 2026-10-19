import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { DEFAULT_MORNING_REMINDER, toMs, type MorningReminderSettings, type PlannedReminder } from '@fizz/domain';

import type { AlertPermission } from '../src/alerts/notifier';
import { morningReminderOf, parsePrefs, updatePrefs } from '../src/device/prefs';
import { readUpNextForecast } from '../src/reminders/forecast';
import { createMorningReminders, NOTIFICATIONS_OFF_LINE, showNotificationsOff, turnReminderOn, type ReminderPort } from '../src/reminders/morning';
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
  const state = { permission: 'undetermined' as AlertPermission, asked: 0 };
  const port: ReminderPort = {
    permission: () => Promise.resolve(state.permission),
    request: () => {
      state.asked += 1;
      state.permission = answer;
      return Promise.resolve(answer);
    },
    pending: () => Promise.resolve([...pending.keys(), 'fizz.rest.someone-else']),
    schedule: (r) => {
      pending.set(r.identifier, r);
      return Promise.resolve();
    },
    cancel: (id) => {
      pending.delete(id);
      return Promise.resolve();
    },
  };
  return { port, pending, state };
}

const sorted = (m: Map<string, PlannedReminder>) => [...m.values()].sort((a, b) => a.fireAtMs - b.fireAtMs);

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

function controller(s: AppServices, port: ReminderPort, settings: { current: MorningReminderSettings }) {
  return createMorningReminders({ port, forecast: () => readUpNextForecast(s), settings: () => settings.current, nowMs: () => h.clockMs, tz: () => h.now().tz });
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
    expect(r.map((x) => x.title)).toEqual(['Today: Push A', 'Today: Pull A', 'Today: Push A', 'Today: Pull A', 'Today: Push A', 'Today: Pull A', 'Today: Push A']);
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
    expect(sorted(pending).map((x) => [x.fireAtLocal.date, x.title])).toEqual([
      ['2026-10-21', 'Today: Push A'],
      ['2026-10-23', 'Today: Pull A'],
      ['2026-10-26', 'Today: Push A'],
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

  it('`Today: Pull` · `Day 2 of 4 · about N min · Main Gym` after day 1, then the plan’s days in order', async () => {
    const { s, gymId } = await benWithRotation();
    model = new StepModel([stub, () => replyWith('Here is your week.')]);
    const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
    const record = result.cards[0]?.record;
    if (record?.detail.kind !== 'build_plan') throw new Error('no plan');
    const card = await s.plans.card({ planId: record.detail.planId, versionN: 1 });
    if (card === null) throw new Error('card');
    const applied = await s.plans.apply({ planId: card.planId, versionN: 1, expectedVersion: card.planVersion, mode: 'replace', opId: 'apply' });
    expect(applied.ok).toBe(true);

    const { port, pending } = fakePort();
    const reminders = controller(s, port, { current: { ...DEFAULT_MORNING_REMINDER, on: true } });
    await reminders.refresh();
    expect(sorted(pending)[0]).toMatchObject({ title: 'Today: Push' });
    expect(sorted(pending)[0]?.body).toMatch(/^Day 1 of 4 · about \d+ min · Main Gym$/u);

    // Day 1 done this morning: tomorrow is day 2.
    const up = await s.next.preview(gymId);
    const started = await s.workout.start({ gymId, opId: 'day1', checkIn: null, routineOf: up?.routine?.id ?? '' });
    if (!started.ok) throw new Error(started.error.message);
    const id = started.aggregate.session.id;
    for (const set of started.aggregate.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup')) {
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total' }, reps: 9, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    const cur = await s.workout.load(id);
    const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: 'fin-day1', expectedVersion: cur?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    await reminders.refresh();

    const r = sorted(pending);
    expect(r[0]).toMatchObject({ fireAtLocal: { date: '2026-10-21' }, title: 'Today: Pull' });
    expect(r[0]?.body).toMatch(/^Day 2 of 4 · about \d+ min · Main Gym$/u);
    expect(r.map((x) => x.title)).toEqual(['Today: Pull', 'Today: Legs', 'Today: Upper', 'Today: Push', 'Today: Pull', 'Today: Legs']);
    expect(r.map((x) => x.body.split(' · ')[0])).toEqual(['Day 2 of 4', 'Day 3 of 4', 'Day 4 of 4', 'Day 1 of 4', 'Day 2 of 4', 'Day 3 of 4']);
  });
});
