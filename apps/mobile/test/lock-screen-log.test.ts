import { afterEach, describe, expect, it } from 'vitest';

import { NBSP, parseLockScreenLog, toMs } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { LiveActivityPort, WorkoutActivityProps } from '../src/live-activity/controller';
import { createLastTimeCache } from '../src/live-activity/last-time-cache';
import { createLockLogNotices } from '../src/live-activity/lock-log-notice';
import { createLockScreenTapHandler, type RawLockScreenTap, type TapQueuePort } from '../src/live-activity/taps';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * `Log` on the Lock Screen (Ben, 27 Oct 2026; lock-screen-and-alerts §2.1,
 * §4.2, §4.7), on the whole app over real SQLite: the Ready state carries
 * `Log …` for the current set; a tap queued by the (fake) intent is drained
 * through the same idempotent, versioned `log_set` as the in-app button; the
 * next rest starts (deadline, notification, Live Activity) as after an in-app
 * Log; a double tap, a retry and a relaunch log once; a set logged or edited
 * in the app since is never logged again; and the next open offers
 * `Set 2 logged from Lock Screen · Undo`.
 */

const plain = (s: string) => s.replaceAll(NBSP, ' ');

function fakeActivities() {
  const running = new Map<string, { props: WorkoutActivityProps }>();
  let n = 0;
  const port: LiveActivityPort = {
    available: () => true,
    listIds: () => [...running.keys()],
    start(props) {
      n += 1;
      const id = `la-${String(n)}`;
      running.set(id, { props });
      return id;
    },
    update(id, props) {
      if (!running.has(id)) return Promise.reject(new Error('gone'));
      running.set(id, { props });
      return Promise.resolve();
    },
    end(id) {
      running.delete(id);
      return Promise.resolve();
    },
  };
  return {
    port,
    props(): WorkoutActivityProps {
      expect(running.size).toBe(1);
      const [a] = [...running.values()];
      if (!a) throw new Error('none');
      return a.props;
    },
  };
}

/** The native queue as the patched intent leaves it (one UserDefaults entry per tap); it survives a force-close. */
function fakeQueue() {
  const entries = new Map<string, RawLockScreenTap>();
  let n = 0;
  const port: TapQueuePort & { failAck: boolean } = {
    failAck: false,
    available: () => true,
    list: () => [...entries.values()],
    ack(ids) {
      if (port.failAck) throw new Error('defaults unavailable');
      for (const id of ids) entries.delete(id);
    },
  };
  return {
    port,
    entries,
    tap(target: string, atMs: number): string {
      n += 1;
      const id = `tap-${String(n)}`;
      entries.set(id, { id, source: 'RestCountdown', target, atMs });
      return id;
    },
  };
}

let h: Harness | null = null;
afterEach(async () => {
  await h?.cleanup();
  h = null;
});

async function setUp(opts: { log?: boolean } = {}) {
  const fake = fakeActivities();
  const lastTime = createLastTimeCache(() => h?.clockMs ?? 0);
  h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port, lastTime, liveActivityButtons: true, liveActivityLog: opts.log ?? true });
  const harness = h;
  const { services: s } = await harness.launch();
  lastTime.setReader((state, exId) => s.workout.lastComparableSets(state, exId));
  const gymId = await setUpGym(harness, s);
  await logWorkout(harness, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 8 }, { load: 100, reps: 7 }, { load: 100, reps: 6 }] }]);
  harness.clockMs += 2 * 86_400_000;
  return { fake, lastTime, s, gymId, harness };
}

/** Start, add bench, log the warm-ups and the first working set in the app; the rest for set 2 runs. */
async function startResting(harness: Harness, s: AppServices, gymId: string): Promise<SessionAggregate> {
  const started = await s.workout.start({ gymId, opId: 'start-log', checkIn: { kind: 'skipped', atUtc: harness.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  if (!pick) throw new Error('no bench');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: harness.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const ex = added.aggregate.exercises[0];
  let state = added.aggregate;
  for (const set of [...state.sets].filter((x) => x.sessionExerciseId === ex?.id).sort((a, b) => a.index - b.index)) {
    harness.clockMs += 60_000;
    const r = await s.workout.dispatch(sessionId, {
      type: 'log_set',
      at: harness.now(),
      opId: `log:${set.id}:0`,
      setId: set.id,
      values: { load: { value: set.setType === 'warmup' ? 60 : 100, unit: 'kg', convention: ex?.loadConvention ?? 'total' }, reps: 8, durationS: null, rpe: null, rir: null },
      restTimerId: harness.ids(),
    });
    if (!r.ok) throw new Error(r.error.message);
    state = r.aggregate;
    if (set.setType !== 'warmup') break;
  }
  await harness.settle(s);
  return state;
}

/** Then the rest is skipped in the app: Ready for set 2, with `Log …`. */
async function startReady(harness: Harness, s: AppServices, gymId: string): Promise<SessionAggregate> {
  const resting = await startResting(harness, s, gymId);
  const t = resting.restTimer;
  if (!t) throw new Error('no rest');
  harness.clockMs += 5_000;
  const r = await s.workout.dispatch(resting.session.id, { type: 'skip_rest', at: harness.now(), opId: 'skip-in-app', timerId: t.id });
  if (!r.ok) throw new Error(r.error.message);
  await harness.restAlerts?.reconcile(r.aggregate, harness.clockMs);
  await harness.settle(s);
  return r.aggregate;
}

function handler(harness: Harness, s: AppServices, queue: TapQueuePort, changes = { n: 0 }) {
  return createLockScreenTapHandler({
    queue,
    readActive: () => s.sessions.active(),
    dispatch: (id, cmd) => s.sessions.dispatch(id, cmd),
    settle: (state) => harness.restAlerts?.reconcile(state, harness.clockMs) ?? Promise.resolve(),
    now: () => harness.now(),
    onChanged: () => {
      changes.n += 1;
    },
  });
}

const completed = (a: SessionAggregate | null) => a?.sets.filter((x) => x.status === 'completed') ?? [];

describe('Lock Screen Log: what the Live Activity carries', () => {
  it('Ready shows `Log …` for the current set: its target string names the set and version and carries the values', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const props = fake.props();
    expect(props.state).toBe('ready');
    expect(plain(props.logLabel)).toMatch(/^Log \d+(\.\d+)? kg × \d+$/);
    expect(props.logA11y).toMatch(/^Log \d+(\.\d+)? kilograms, \d+ reps$/);
    const tap = parseLockScreenLog(props.log);
    const active = ready.sets.find((x) => x.id === ready.session.activeSetId);
    expect(tap).toMatchObject({ sessionId: ready.session.id, setId: active?.id, setVersion: active?.version });
    // Ready has no rest buttons.
    expect(props.tap).toBe('');
  });

  it('a running rest carries the next set’s Log for its end (drawn by the widget with the app suspended), not a live one', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const resting = await startResting(harness, s, gymId);
    const props = fake.props();
    expect(props.state).toBe('resting');
    expect(props.log).toBe('');
    expect(parseLockScreenLog(props.afterLog)?.setId).toBe(resting.session.activeSetId);
    expect(props.afterLogLabel).toMatch(/^Log /);
  });

  it('built with FIZZ_LA_LOG=0 (or no buttons): no Log anywhere; the rest buttons stay', async () => {
    const { fake, s, gymId, harness } = await setUp({ log: false });
    await startResting(harness, s, gymId);
    expect(fake.props().tap).not.toBe('');
    expect([fake.props().log, fake.props().afterLog, fake.props().afterLogLabel]).toEqual(['', '', '']);
  });
});

describe('Lock Screen Log: applying the tap', () => {
  it('logs the set as shown, at the tap time, and starts the next rest: deadline, notification and Live Activity', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const target = fake.props().log;
    const shown = parseLockScreenLog(target);
    const q = fakeQueue();
    const changes = { n: 0 };
    const tappedAt = harness.clockMs;
    const id = q.tap(target, tappedAt);
    harness.clockMs += 1_500;
    expect(await handler(harness, s, q.port, changes).drain()).toEqual([{ id, result: 'applied' }]);

    const after = await s.sessions.active();
    const set = after?.sets.find((x) => x.id === shown?.setId);
    expect(set?.status).toBe('completed');
    expect(set?.actual).toMatchObject({ load: shown?.values.load, reps: shown?.values.reps });
    expect(toMs(set?.completedAt?.utc ?? '')).toBe(tappedAt);
    expect(set?.completedByOpId).toBe(`lock:log:${shown?.setId ?? ''}:${String(shown?.setVersion ?? 0)}`);
    expect(completed(after)).toHaveLength(completed(ready).length + 1);
    // The rest for the next set runs from the tap, exactly as after an in-app Log.
    const t = after?.restTimer;
    expect(t?.status).toBe('running');
    expect(toMs(t?.startedAtUtc ?? '')).toBe(tappedAt);
    expect([...harness.pending.values()].map((a) => a.fireAtMs)).toEqual([toMs(t?.deadlineUtc ?? '')]);
    const props = fake.props();
    expect(props.state).toBe('resting');
    expect(props.endMs).toBe(toMs(t?.deadlineUtc ?? ''));
    expect(props.tap).toContain(t?.id ?? 'none');
    expect(q.entries.size).toBe(0);
    expect(changes.n).toBe(1);
  });

  it('a double tap (two queue entries) logs once; the second is already logged', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const target = fake.props().log;
    const q = fakeQueue();
    q.tap(target, harness.clockMs);
    q.tap(target, harness.clockMs + 200);
    const results = await handler(harness, s, q.port).drain();
    expect(results.map((r) => (r.result === 'ignored' ? r.reason : r.result))).toEqual(['applied', 'already_logged']);
    expect(completed(await s.sessions.active())).toHaveLength(completed(ready).length + 1);
    expect(q.entries.size).toBe(0);
  });

  it('a retry (the entry’s removal failed) is seen again and logs nothing more', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const q = fakeQueue();
    const taps = handler(harness, s, q.port);
    q.tap(fake.props().log, harness.clockMs);
    q.port.failAck = true;
    expect((await taps.drain()).map((r) => r.result)).toEqual(['applied']);
    expect(q.entries.size).toBe(1);
    q.port.failAck = false;
    expect((await taps.drain()).map((r) => r.result)).toEqual(['ignored']);
    expect(completed(await s.sessions.active())).toHaveLength(completed(ready).length + 1);
  });

  it('the same command sent twice through the write path is one write (operation ID)', async () => {
    const { fake, s, gymId, harness } = await setUp();
    await startReady(harness, s, gymId);
    const { lockScreenLogCommand } = await import('@fizz/domain');
    const tap = parseLockScreenLog(fake.props().log);
    if (!tap) throw new Error('no Log');
    const d = lockScreenLogCommand(await s.sessions.active(), tap, harness.now(), harness.clockMs);
    if (d.kind !== 'dispatch') throw new Error(d.reason);
    const first = await s.sessions.dispatch(tap.sessionId, d.command);
    const second = await s.sessions.dispatch(tap.sessionId, d.command);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
  });

  it('restart recovery: a Log queued while GymSmarter was killed is applied once at the next launch, at the tap time', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const q = fakeQueue();
    const tappedAt = harness.clockMs;
    q.tap(fake.props().log, tappedAt);
    await harness.forceClose();
    harness.clockMs += 10 * 60_000;
    const { services: s2 } = await harness.launch();
    await harness.settle(s2);
    expect((await handler(harness, s2, q.port).drain()).map((r) => r.result)).toEqual(['applied']);
    const after = await s2.sessions.active();
    expect(completed(after)).toHaveLength(completed(ready).length + 1);
    expect(toMs(completed(after).find((x) => x.completedByOpId?.startsWith('lock:log:'))?.completedAt?.utc ?? '')).toBe(tappedAt);
    // Its rest (from the tap) has run out by now: no rest alert is left for it.
    expect(harness.pending.size).toBe(0);
    expect(await handler(harness, s2, q.port).drain()).toEqual([]);
  });

  it('killed after the write but before the entry was removed: the next launch logs nothing more', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const q = fakeQueue();
    q.tap(fake.props().log, harness.clockMs);
    q.port.failAck = true;
    await handler(harness, s, q.port).drain();
    await harness.forceClose();
    q.port.failAck = false;
    harness.clockMs += 30_000;
    const { services: s2 } = await harness.launch();
    const [r] = await handler(harness, s2, q.port).drain();
    expect(r).toMatchObject({ result: 'ignored', reason: 'already_logged' });
    expect(completed(await s2.sessions.active())).toHaveLength(completed(ready).length + 1);
  });

  it('logged in the app first, or edited in the app since: the Lock Screen tap does nothing', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const target = fake.props().log;
    const tap = parseLockScreenLog(target);
    if (!tap) throw new Error('no Log');
    // Edited in the app (a saved draft): stale, nothing logged.
    const edited = await s.workout.dispatch(ready.session.id, { type: 'save_draft', at: harness.now(), setId: tap.setId, values: { load: { value: 105, unit: 'kg', convention: 'total' }, reps: 5, durationS: null, rpe: null, rir: null } });
    if (!edited.ok) throw new Error(edited.error.message);
    const q = fakeQueue();
    q.tap(target, harness.clockMs);
    const [r1] = await handler(harness, s, q.port).drain();
    expect(r1).toMatchObject({ result: 'ignored', reason: 'stale' });
    expect(completed(await s.sessions.active())).toHaveLength(completed(ready).length);
    // The Live Activity is redrawn with the edited values' Log.
    expect(plain(fake.props().logLabel)).toBe('Log 105 kg × 5');
    // Logged in the app: the old Lock Screen picture is already logged.
    harness.clockMs += 1_000;
    const logged = await s.workout.dispatch(ready.session.id, { type: 'log_set', at: harness.now(), opId: `log:${tap.setId}:0`, setId: tap.setId, values: { load: { value: 105, unit: 'kg', convention: 'total' }, reps: 5, durationS: null, rpe: null, rir: null }, restTimerId: harness.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    q.tap(target, harness.clockMs);
    const [r2] = await handler(harness, s, q.port).drain();
    expect(r2).toMatchObject({ result: 'ignored', reason: 'already_logged' });
    const after = await s.sessions.active();
    expect(after?.sets.find((x) => x.id === tap.setId)?.actual?.reps).toBe(5);
    expect(completed(after)).toHaveLength(completed(ready).length + 1);
  });

  it('the after-rest Log (tapped once the rest ran out, app suspended) logs the next set and starts its rest', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const resting = await startResting(harness, s, gymId);
    const target = fake.props().afterLog;
    const deadline = toMs(resting.restTimer?.deadlineUtc ?? '');
    harness.clockMs = deadline + 20_000;
    const q = fakeQueue();
    q.tap(target, harness.clockMs);
    harness.clockMs += 800;
    expect((await handler(harness, s, q.port).drain()).map((r) => r.result)).toEqual(['applied']);
    const after = await s.sessions.active();
    expect(after?.sets.find((x) => x.id === resting.session.activeSetId)?.status).toBe('completed');
    expect(after?.restTimer?.id).not.toBe(resting.restTimer?.id);
    expect(after?.restTimer?.status).toBe('running');
    expect(fake.props().state).toBe('resting');
  });

  it('paused, or another workout: nothing logged', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const ready = await startReady(harness, s, gymId);
    const target = fake.props().log;
    const paused = await s.workout.dispatch(ready.session.id, { type: 'pause', at: harness.now(), opId: 'pause-1' });
    if (!paused.ok) throw new Error(paused.error.message);
    const q = fakeQueue();
    q.tap(target, harness.clockMs);
    q.tap(target.replace(ready.session.id, '00000000-0000-4000-8000-00000000dead'), harness.clockMs);
    const results = await handler(harness, s, q.port).drain();
    expect(results.map((r) => (r.result === 'ignored' ? r.reason : r.result))).toEqual(['paused', 'other_workout']);
    expect(completed(await s.sessions.active())).toHaveLength(completed(ready).length);
  });
});

describe('Lock Screen Log: the next open', () => {
  it('`Set 2 logged from Lock Screen · Undo` once, only in the foreground; Undo puts the set back and ends its rest', async () => {
    const { fake, s, gymId, harness } = await setUp();
    await startReady(harness, s, gymId);
    const q = fakeQueue();
    q.tap(fake.props().log, harness.clockMs);
    await handler(harness, s, q.port).drain();
    const notices = createLockLogNotices();
    const state = await s.sessions.active();
    // In the background (the tap woke the app): nothing, so it isn't missed.
    expect(notices.take(state, harness.clockMs, false)).toBeNull();
    harness.clockMs += 60_000;
    const n = notices.take(state, harness.clockMs, true);
    expect(n?.text).toMatch(/^Set \d logged from Lock Screen$/);
    expect(notices.take(state, harness.clockMs, true)).toBeNull();
    // A relaunch (new run) offers it again while it is still the last set and recent.
    expect(createLockLogNotices().take(state, harness.clockMs, true)?.opId).toBe(n?.opId);

    const set = state?.sets.find((x) => x.id === n?.setId);
    const undone = await s.workout.dispatch(state?.session.id ?? '', { type: 'undo_log', at: harness.now(), opId: n?.undoOpId ?? '', setId: n?.setId ?? '', expectedSetVersion: set?.version ?? 0 });
    expect(undone.ok).toBe(true);
    await harness.settle(s);
    const back = (await s.sessions.active())?.sets.find((x) => x.id === n?.setId);
    expect(back?.status).toBe('pending');
    expect(harness.pending.size).toBe(0);
    expect(fake.props().state).toBe('ready');
  });
});
