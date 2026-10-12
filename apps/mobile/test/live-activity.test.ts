import { afterEach, describe, expect, it } from 'vitest';

import { clockText, NBSP, toMs } from '@fizz/domain';
import { apply, at, BENCH, kg, logCmd, ms, setsFor, startFixture, values } from '@fizz/domain/testing';
import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { SessionAggregate } from '@fizz/schemas';

import { createRestAlertController, type NotifierPort } from '../src/alerts/rest-alerts';
import { createLiveActivityController, DEADLINE_RECHECK_MS, type ActivityClock, type LiveActivityPort, type WorkoutActivityProps } from '../src/live-activity/controller';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * The workout's Lock Screen Live Activity (lock-screen-and-alerts §2.1, §4.1,
 * §4.2; rest-state §4.7): started with the workout, Resting with a system
 * countdown to the deadline after each Log, replaced in place (one per
 * workout) on Skip, adjust, pause and resume, ended on Finish, Discard,
 * restore and Delete my data, adopted or ended after a force-close, and
 * skipped (notification only) when the build or iOS doesn't allow it.
 */

const FIXTURE_TZ = 'Pacific/Auckland';
const plain = (s: string) => s.replaceAll(NBSP, ' ');

interface FakeActivity {
  props: WorkoutActivityProps;
  staleAtMs: number | null;
  updates: number;
}

/** A fake ActivityKit: running activities by ID, every call made, Ben's swipe, and Settings › Live Activities. */
function fakeActivities(opts: { available?: boolean } = {}) {
  const running = new Map<string, FakeActivity>();
  const calls: string[] = [];
  let n = 0;
  const sys = { refuse: false, available: opts.available ?? true };
  const port: LiveActivityPort = {
    available: () => sys.available,
    listIds: () => [...running.keys()],
    start(props, staleAtMs) {
      if (sys.refuse) throw new Error('Live Activities are turned off for GymSmarter');
      n += 1;
      const id = `la-${String(n)}`;
      running.set(id, { props, staleAtMs, updates: 0 });
      calls.push(`start ${id} ${props.state}`);
      return id;
    },
    update(id, props, staleAtMs) {
      const a = running.get(id);
      if (!a) return Promise.reject(new Error('gone'));
      running.set(id, { props, staleAtMs, updates: a.updates + 1 });
      calls.push(`update ${id} ${props.state}`);
      return Promise.resolve();
    },
    end(id) {
      running.delete(id);
      calls.push(`end ${id}`);
      return Promise.resolve();
    },
  };
  return {
    port,
    running,
    calls,
    sys,
    only(): FakeActivity {
      expect(running.size).toBe(1);
      const [a] = [...running.values()];
      if (!a) throw new Error('none');
      return a;
    },
    /** Ben swipes the banner away (iOS ends it). */
    swipe(id: string) {
      running.delete(id);
    },
  };
}

function fakeClock(start: number) {
  const timers: { at: number; fn: () => void; h: number }[] = [];
  let next = 0;
  const clock: ActivityClock & { t: number; advance: (to: number) => void; pending: () => number } = {
    t: start,
    now: () => clock.t,
    setTimeout(fn, ms) {
      next += 1;
      timers.push({ at: clock.t + ms, fn, h: next });
      return next;
    },
    clearTimeout(h) {
      const i = timers.findIndex((x) => x.h === h);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(to) {
      clock.t = to;
      for (const x of [...timers].filter((y) => y.at <= to)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    },
    pending: () => timers.length,
  };
  return clock;
}

function loggedWarmup(): SessionAggregate {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0]?.id ?? '';
  return apply(state, logCmd(warm, values(kg(60), 10), 30));
}

describe('Live Activity controller (pure, over a fake ActivityKit)', () => {
  it('Start shows Ready; Log switches the same activity to Resting with the system countdown to the deadline, Until hh:mm and the next target', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const { state } = startFixture();
    await la.reconcile(state, ms(1));
    expect(fake.only().props).toMatchObject({ state: 'ready', title: 'Ready · Push A', startMs: 0, endMs: 0 });

    const resting = loggedWarmup();
    await la.reconcile(resting, ms(31));
    const deadline = toMs(resting.restTimer?.deadlineUtc ?? '');
    const a = fake.only();
    expect(a.props).toMatchObject({ state: 'resting', title: 'Rest', endMs: deadline, startMs: toMs(resting.restTimer?.startedAtUtc ?? '') });
    expect(a.staleAtMs).toBe(deadline);
    expect(plain(a.props.line1)).toBe(`Until ${clockText(deadline, FIXTURE_TZ)} · Bench press · Set 2 of 3 next`);
    expect(plain(a.props.line2)).toBe('Target 100 kg × 6–8');
    // One activity for the workout, updated in place: never one per rest.
    expect(fake.calls).toEqual(['start la-1 ready', 'update la-1 resting']);
  });

  it('the same state again changes nothing (no redundant update); a duplicate reconcile is idempotent', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const s = loggedWarmup();
    await la.reconcile(s, ms(31));
    await la.reconcile(s, ms(32));
    await la.reconcile(s, ms(33));
    expect(fake.calls).toEqual(['start la-1 resting']);
  });

  it('an older version of the workout arriving late is ignored (review ben-bugs S2); after a null an older one is taken again', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const { state: ready } = startFixture();
    const resting = loggedWarmup();
    expect(resting.session.version).toBeGreaterThan(ready.session.version);
    await la.reconcile(resting, ms(31));
    // A coach turn's re-read (or the launch read) of the earlier version lands after the Log.
    await la.reconcile(ready, ms(32));
    expect(fake.only().props).toMatchObject({ state: 'resting', endMs: toMs(resting.restTimer?.deadlineUtc ?? '') });
    expect(fake.calls).toEqual(['start la-1 resting']);
    // A restore (null) clears it: the restored data's workout may be an older version of the same one.
    await la.reconcile(null, ms(40));
    await la.reconcile(ready, ms(41));
    expect(fake.only().props.state).toBe('ready');
  });

  it('Skip, +30 s, Pause and Resume replace the content in place; Finish ends it', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    let s = loggedWarmup();
    await la.reconcile(s, ms(31));
    const timerId = s.restTimer?.id ?? '';

    const longer = apply(s, { type: 'adjust_rest', at: at(35), opId: 'plus', timerId, deltaS: 30 });
    await la.reconcile(longer, ms(36));
    expect(fake.only().props.endMs).toBe(toMs(longer.restTimer?.deadlineUtc ?? ''));

    const paused = apply(longer, { type: 'pause', at: at(40), opId: 'p' });
    await la.reconcile(paused, ms(41));
    expect(fake.only().props).toMatchObject({ state: 'paused', endMs: 0, side: '1:20' });
    expect(fake.only().staleAtMs).toBeNull();

    const resumed = apply(paused, { type: 'resume', at: at(100), opId: 'r' });
    await la.reconcile(resumed, ms(101));
    expect(fake.only().props.state).toBe('resting');
    expect(fake.only().props.endMs).toBe(toMs(resumed.restTimer?.deadlineUtc ?? ''));

    s = apply(resumed, { type: 'skip_rest', at: at(105), opId: 'skip', timerId });
    await la.reconcile(s, ms(106));
    expect(fake.only().props).toMatchObject({ state: 'ready', endMs: 0, side: 'Set 2' });

    const finished = apply(s, { type: 'finish', at: at(200), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    await la.reconcile(finished, ms(201));
    expect(fake.running.size).toBe(0);
    expect(fake.calls.filter((c) => c.startsWith('start'))).toEqual(['start la-1 resting']);
    expect(fake.calls.at(-1)).toBe('end la-1');
  });

  it('Discard ends it; the next workout gets its own (one per workout)', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const s = loggedWarmup();
    await la.reconcile(s, ms(31));
    const discarded = apply(s, { type: 'discard', at: at(40), opId: 'd', expectedVersion: s.session.version, confirmedLoggedSets: 1 });
    await la.reconcile(discarded, ms(41));
    expect(fake.running.size).toBe(0);
    // A different workout's state arriving while one is shown ends the old one first.
    await la.reconcile({ ...s, session: { ...s.session, id: 'third-workout' } }, ms(42));
    const other = { ...s, session: { ...s.session, id: 'another-workout' } };
    await la.reconcile(other, ms(43));
    expect(fake.running.size).toBe(1);
    expect(fake.calls.slice(-3)).toEqual(['start la-2 resting', 'end la-2', 'start la-3 resting']);
  });

  it('with the app running, the activity turns Ready a moment after the countdown ends (no 0:00 left showing as live)', async () => {
    const fake = fakeActivities();
    const s = loggedWarmup();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    const clock = fakeClock(ms(31));
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ, clock });
    await la.reconcile(s, ms(31));
    expect(clock.pending()).toBe(1);
    clock.advance(deadline + DEADLINE_RECHECK_MS);
    await la.reconcile(s, deadline + DEADLINE_RECHECK_MS); // drain the chain
    expect(fake.only().props.state).toBe('ready');
    // A new commit clears the old recheck before scheduling its own.
    await la.reconcile(s, deadline + DEADLINE_RECHECK_MS + 1);
    expect(clock.pending()).toBe(0);
  });

  it('after a force-close: the first reconcile adopts one running activity for the workout and ends strays', async () => {
    const fake = fakeActivities();
    const before = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const s = loggedWarmup();
    await before.reconcile(s, ms(31));
    // A stray from an older run (e.g. a workout finished while the app was killed).
    fake.running.set('stray', { props: fake.only().props, staleAtMs: null, updates: 0 });

    const after = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const skipped = apply(s, { type: 'skip_rest', at: at(50), opId: 'skip', timerId: s.restTimer?.id ?? '' });
    await after.reconcile(skipped, ms(51));
    expect([...fake.running.keys()]).toEqual(['la-1']);
    expect(fake.only().props.state).toBe('ready');
    expect(fake.calls.filter((c) => c.startsWith('start'))).toHaveLength(1);
  });

  it('after a relaunch with no workout in progress, every activity is ended; later a null reconcile leaves other activities alone (the probe’s)', async () => {
    const fake = fakeActivities();
    fake.running.set('old', { props: { state: 'resting', title: 'Rest', line1: '', line2: '', startMs: 1, endMs: 2, side: '', a11y: '' }, staleAtMs: null, updates: 0 });
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    await la.reconcile(null, ms(0));
    expect(fake.running.size).toBe(0);
    fake.running.set('probe', { props: { state: 'resting', title: 'Rest', line1: '', line2: '', startMs: 1, endMs: 2, side: '', a11y: '' }, staleAtMs: null, updates: 0 });
    await la.reconcile(null, ms(1));
    expect([...fake.running.keys()]).toEqual(['probe']);
  });

  it('swiped away: not started again for that workout this run; the notification still covers the rest', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const s = loggedWarmup();
    await la.reconcile(s, ms(31));
    fake.swipe('la-1');
    const skipped = apply(s, { type: 'skip_rest', at: at(40), opId: 'skip', timerId: s.restTimer?.id ?? '' });
    await la.reconcile(skipped, ms(41));
    expect(fake.running.size).toBe(0);
    expect(fake.calls).toEqual(['start la-1 resting']);
  });

  it('not in the build, or refused by iOS: skipped silently (status says so); logging and the rest notification are unaffected', async () => {
    const off = fakeActivities({ available: false });
    const notInBuild = createLiveActivityController(off.port, { tz: () => FIXTURE_TZ });
    await notInBuild.reconcile(loggedWarmup(), ms(31));
    expect(off.calls).toEqual([]);
    expect(notInBuild.status).toBe('not_in_build');

    const refused = fakeActivities();
    refused.sys.refuse = true;
    const la = createLiveActivityController(refused.port, { tz: () => FIXTURE_TZ });
    const pending: string[] = [];
    const notifier: NotifierPort = {
      schedule: (a) => {
        pending.push(a.title);
        return Promise.resolve();
      },
      cancel: () => Promise.resolve(),
      cancelAllWorkoutAlerts: () => Promise.resolve(),
    };
    const alerts = createRestAlertController(notifier, { liveActivity: la });
    await expect(alerts.reconcile(loggedWarmup(), ms(31))).resolves.toBeUndefined();
    expect(pending).toEqual(['Rest done']);
    expect(la.status).toBe('failed');
    expect(la.lastError).toContain('turned off');
  });

  it('Delete my data ends every activity except the workout in progress', async () => {
    const fake = fakeActivities();
    const la = createLiveActivityController(fake.port, { tz: () => FIXTURE_TZ });
    const s = loggedWarmup();
    await la.reconcile(s, ms(31));
    fake.running.set('stray', { props: fake.only().props, staleAtMs: null, updates: 0 });
    const notifier: NotifierPort = { schedule: () => Promise.resolve(), cancel: () => Promise.resolve(), cancelAllWorkoutAlerts: () => Promise.resolve() };
    const alerts = createRestAlertController(notifier, { liveActivity: la });
    await alerts.cancelAll(`fizz.rest.${s.session.id}`);
    expect([...fake.running.keys()]).toEqual(['la-1']);
    await alerts.cancelAll();
    expect(fake.running.size).toBe(0);
  });
});

describe('Live Activity through the app services (real SQLite, force-close)', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.cleanup();
    h = null;
  });

  it('Start → Log → rest on the Lock Screen → force-close → relaunch adopts it → Finish ends it', async () => {
    const fake = fakeActivities();
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);

    const started = await s.workout.start({ gymId, opId: 'start-la', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    await h.settle(s);
    const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
    const pick = picks.find((p) => p.exercise.name === 'Bench press');
    if (!pick) throw new Error('no bench');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    await h.settle(s);
    expect(fake.only().props.state).toBe('ready');

    const set = added.aggregate.sets.find((x) => x.status === 'pending');
    const ex = added.aggregate.exercises[0];
    if (!set || !ex) throw new Error('no set');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, {
      type: 'log_set',
      at: h.now(),
      opId: `log:${set.id}:0`,
      setId: set.id,
      values: { load: { value: 60, unit: 'kg', convention: ex.loadConvention }, reps: 8, durationS: null, rpe: null, rir: null },
      restTimerId: h.ids(),
    });
    if (!logged.ok) throw new Error(logged.error.message);
    await h.settle(s);
    const deadline = toMs(logged.aggregate.restTimer?.deadlineUtc ?? '');
    expect(fake.only().props).toMatchObject({ state: 'resting', endMs: deadline });
    expect(fake.only().props.line1.startsWith(`Until ${clockText(deadline, TZ)}`)).toBe(true);
    // The rest-done notification is scheduled alongside it (the safety net, §4.1).
    expect([...h.pending.values()].map((a) => a.fireAtMs)).toEqual([deadline]);

    // Force-close mid-rest: the system keeps rendering the countdown; the relaunch adopts the same activity.
    await h.forceClose();
    h.clockMs = deadline + 5_000;
    const { services: s2 } = await h.launch();
    await h.settle(s2);
    await s2.sessions.active(); // the Root's launch reconcile happens on the phone; here startup's recovery reconcile runs
    expect(fake.running.size).toBe(1);
    expect(fake.calls.filter((c) => c.startsWith('start'))).toHaveLength(1);

    const v = (await s2.workout.load(sessionId))?.aggregate.session.version ?? 0;
    const fin = await s2.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-la', expectedVersion: v, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s2);
    expect(fake.running.size).toBe(0);
  });

  it('a normal logged workout leaves no activity behind', async () => {
    const fake = fakeActivities();
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    expect(fake.running.size).toBe(0);
    expect(fake.calls.filter((c) => c.startsWith('start'))).toHaveLength(1);
  });
});

/**
 * The rest of a workout's life at the services level (review ben-bugs S4):
 * an older state arriving late, Undo of the last set, a coach change during
 * rest, and a restore while the activity is showing.
 */
describe('Live Activity through the app services: late reads, Undo, coach changes, restore', () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.cleanup();
    h = null;
  });

  async function benchWorkout(harness: Harness, s: AppServices, gymId: string) {
    const started = await s.workout.start({ gymId, opId: 'start-la', checkIn: { kind: 'skipped', atUtc: harness.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
    const pick = picks.find((p) => p.exercise.name === 'Bench press');
    if (!pick) throw new Error('no bench');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: harness.ids() });
    if (!added.ok) throw new Error(added.error.message);
    await harness.settle(s);
    return { sessionId, ready: added.aggregate };
  }

  async function logFirst(harness: Harness, s: AppServices, a: SessionAggregate) {
    const set = a.sets.filter((x) => x.status === 'pending').sort((x, y) => x.index - y.index)[0];
    const ex = a.exercises[0];
    if (!set || !ex) throw new Error('no set');
    harness.clockMs += 60_000;
    const logged = await s.workout.dispatch(a.session.id, {
      type: 'log_set',
      at: harness.now(),
      opId: `log:${set.id}:0`,
      setId: set.id,
      values: { load: { value: 60, unit: 'kg', convention: ex.loadConvention }, reps: 8, durationS: null, rpe: null, rir: null },
      restTimerId: harness.ids(),
    });
    if (!logged.ok) throw new Error(logged.error.message);
    await harness.settle(s);
    return { logged: logged.aggregate, setId: set.id };
  }

  it('a launch/foreground read or coach re-read of the earlier version, landing after a Log, leaves Resting showing', async () => {
    const fake = fakeActivities();
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId } = await benchWorkout(h, s, gymId);
    const before = (await s.workout.load(sessionId))?.aggregate ?? null; // read at version n (Ready)
    const { logged } = await logFirst(h, s, before ?? (() => { throw new Error('none'); })());
    const deadline = toMs(logged.restTimer?.deadlineUtc ?? '');
    expect(fake.only().props).toMatchObject({ state: 'resting', endMs: deadline });

    await h.restAlerts?.reconcile(before, h.clockMs);
    expect(fake.only().props).toMatchObject({ state: 'resting', endMs: deadline });
    expect([...h.pending.values()].map((a) => a.fireAtMs)).toEqual([deadline]);
  });

  it('Undo of the last set puts the same activity back to Ready with no countdown', async () => {
    const fake = fakeActivities();
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { ready } = await benchWorkout(h, s, gymId);
    const readyLine2 = fake.only().props.line2;
    const { logged, setId } = await logFirst(h, s, ready);
    expect(fake.only().props.state).toBe('resting');
    const setVersion = logged.sets.find((x) => x.id === setId)?.version ?? 0;
    h.clockMs += 5_000;
    const undone = await s.workout.dispatch(logged.session.id, { type: 'undo_log', at: h.now(), opId: `undo:${setId}`, setId, expectedSetVersion: setVersion });
    if (!undone.ok) throw new Error(undone.error.message);
    await h.settle(s);
    expect(fake.only().props).toMatchObject({ state: 'ready', startMs: 0, endMs: 0, line2: readyLine2 });
    expect(fake.calls.filter((c) => c.startsWith('start'))).toHaveLength(1);
    expect(h.pending.size).toBe(0);
  });

  it('a restore while the activity shows ends it; the restored workout (an older version) is shown again on the next foreground', async () => {
    const fake = fakeActivities();
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    h.clockMs += 86_400_000;
    const { sessionId } = await benchWorkout(h, s, gymId);
    const made = await s.backups.backUpOnPhone('manual');
    if (!made.ok) throw new Error(made.error);
    const text = await s.restore.readOnPhone(made.record.fileName);
    if (text === null) throw new Error('no backup');
    h.clockMs += 600_000;
    const active = await s.sessions.active();
    if (!active) throw new Error('no workout');
    expect(await s.sessions.finish(active, 'finish-la')).toMatchObject({ ok: true });
    await h.settle(s);
    expect(fake.running.size).toBe(0);

    h.clockMs += 600_000;
    const p = await s.restore.prepare(text);
    if (!p.ok) throw new Error('preview failed');
    expect(await s.restore.restore(text, p.preview.stamp)).toMatchObject({ ok: true, status: 'restored' });
    // Root's foreground reconcile: the backup's unfinished workout, at a lower version than the one finished above.
    const restored = await s.sessions.active();
    expect(restored?.session.id).toBe(sessionId);
    await h.restAlerts?.reconcile(restored ?? null, h.clockMs);
    expect(fake.only().props.state).toBe('ready');

    // Undo restore while it shows: ended, nothing left on the Lock Screen.
    h.clockMs += 60_000;
    expect(await s.restore.undo()).toEqual({ ok: true });
    await h.settle(s);
    expect(fake.running.size).toBe(0);
    expect(h.pending.size).toBe(0);
  });

  it('a coach change during rest updates the next target in place; the countdown is unchanged', async () => {
    const fake = fakeActivities();
    let model: CoachModelPort = { stream: () => (async function* () {})() };
    h = createHarness('2026-10-12T17:00:00.000Z', {
      liveActivity: fake.port,
      coach: { model: () => model, connection: () => Promise.resolve({ status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } }) },
    });
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += 2 * 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    await h.settle(s);
    const { logged } = await logFirst(h, s, started.aggregate);
    const before = fake.only().props;
    expect(before.state).toBe('resting');
    const callsBefore = fake.calls.length;

    const steps: ((req: ModelRequest) => ModelEvent[])[] = [
      (req) => {
        const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
        if (block?.type !== 'message') throw new Error('no context');
        const w = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: { version: number; exercises: { sessionExerciseId: string; sets: { setId: string; status: string }[] }[] } }).workout;
        const ex = w.exercises[0];
        const pending = ex?.sets.filter((x) => x.status === 'pending') ?? [];
        const args = { baseVersion: w.version, exercises: [{ sessionExerciseId: ex?.sessionExerciseId, sets: pending.map((x) => ({ setId: x.setId, target: { load: { value: 52.5, unit: 'kg', convention: 'total' }, reps: null } })), addSet: null, removeSetId: null }], reason: 'Lighter.' };
        return [{ type: 'tool_call', callId: 'c-adjust', name: 'adjust_pending_sets', arguments: JSON.stringify(args) }, { type: 'completed' }];
      },
      () => [{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: JSON.stringify({ message: 'Lighter for the rest.', offer: null }) }, { type: 'completed' }],
    ];
    let n = 0;
    model = {
      async *stream(req: ModelRequest) {
        const events = steps[n]?.(req) ?? [{ type: 'error' as const, error: 'unavailable' as const }];
        n += 1;
        for (const e of events) {
          await Promise.resolve();
          yield e;
        }
      },
    };
    h.clockMs += 10_000;
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId: logged.session.id }, threadId: null, input: { kind: 'chip', chip: 'too_hard' }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    await h.settle(s);
    const after = fake.only().props;
    expect(after).toMatchObject({ state: 'resting', startMs: before.startMs, endMs: before.endMs });
    expect(plain(after.line2)).toContain('52.5 kg');
    expect(after.line2).not.toBe(before.line2);
    // Updated in place: no new activity for the coach's change.
    expect(fake.calls.slice(callsBefore).every((c) => c.startsWith('update la-'))).toBe(true);
  });
});
