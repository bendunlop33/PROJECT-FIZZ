import { afterEach, describe, expect, it } from 'vitest';

import { LOCK_SCREEN_TAP_MAX_AGE_MS, NBSP, toMs } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { LiveActivityPort, WorkoutActivityProps } from '../src/live-activity/controller';
import { createLastTimeCache } from '../src/live-activity/last-time-cache';
import { createLockScreenTapHandler, type RawLockScreenTap, type TapQueuePort } from '../src/live-activity/taps';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Lock Screen rest buttons and last time (Ben, 26 Oct 2026;
 * lock-screen-and-alerts §2.1, §2.2, §4.2), on the whole app over real
 * SQLite: `Last …` on the Live Activity and `last …` in the rest-done
 * notification; −15 s / +15 s / Skip taps queued by the (fake) intent and
 * drained through the same idempotent, versioned write path as the in-app
 * buttons; stale, duplicate, paused, too-old and foreign taps dropped; a tap
 * queued before a force-close handled after the relaunch; and never a set
 * logged from the Lock Screen.
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

/** The native queue as the patched intent leaves it (one entry per tap), persisted across a force-close like UserDefaults. */
function fakeQueue() {
  const entries = new Map<string, RawLockScreenTap>();
  const acks: string[] = [];
  let n = 0;
  const port: TapQueuePort & { failAck: boolean } = {
    failAck: false,
    available: () => true,
    list: () => [...entries.values()],
    ack(ids) {
      if (port.failAck) throw new Error('defaults unavailable');
      for (const id of ids) {
        entries.delete(id);
        acks.push(id);
      }
    },
  };
  return {
    port,
    entries,
    acks,
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

async function setUp() {
  const fake = fakeActivities();
  const lastTime = createLastTimeCache(() => h?.clockMs ?? 0);
  h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port, lastTime, liveActivityButtons: true });
  const harness = h;
  const { services: s } = await harness.launch();
  lastTime.setReader((state, exId) => s.workout.lastComparableSets(state, exId));
  const gymId = await setUpGym(harness, s);
  // Last time: bench 100 × 8, 100 × 7, 100 × 6.
  await logWorkout(harness, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 8 }, { load: 100, reps: 7 }, { load: 100, reps: 6 }] }]);
  harness.clockMs += 2 * 86_400_000;
  return { fake, lastTime, s, gymId, harness };
}

async function startAndLogFirstWorkingSet(harness: Harness, s: AppServices, gymId: string): Promise<SessionAggregate> {
  const started = await s.workout.start({ gymId, opId: 'start-taps', checkIn: { kind: 'skipped', atUtc: harness.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const pick = picks.find((p) => p.exercise.name === 'Bench press');
  if (!pick) throw new Error('no bench');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: harness.ids() });
  if (!added.ok) throw new Error(added.error.message);
  const ex = added.aggregate.exercises[0];
  let state = added.aggregate;
  // Warm-ups (if the built-in rule planned any) first, then the first working set.
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

function handler(harness: Harness, s: AppServices, queue: TapQueuePort, changes: { n: number }) {
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

const deadlineOf = (a: SessionAggregate | null) => toMs(a?.restTimer?.deadlineUtc ?? '');
const completed = (a: SessionAggregate | null) => a?.sets.filter((x) => x.status === 'completed').length ?? 0;

describe('Lock Screen: last time for the next set (Ben, 26 Oct)', () => {
  it('the Live Activity shows `Last 100 kg × 7` under set 2’s target; the rest-done notification says `last 100 kg × 7`', async () => {
    const { fake, s, gymId, harness } = await setUp();
    await startAndLogFirstWorkingSet(harness, s, gymId);
    // The history read lands after the first reconcile; the same state is reconciled again with it.
    await harness.settle(s);
    const props = fake.props();
    expect(props.state).toBe('resting');
    expect(plain(props.line3)).toBe('Last 100 kg × 7');
    expect(props.a11y).toContain('Last time 100 kilograms, 7 reps.');
    const [alert] = [...harness.pending.values()];
    expect(plain(alert?.body ?? '')).toMatch(/^Bench press · set \d · target .+ · last 100 kg × 7$/);
  });

  it('a first workout has no last time: no line, nothing invented', async () => {
    const fake = fakeActivities();
    const lastTime = createLastTimeCache(() => h?.clockMs ?? 0);
    h = createHarness('2026-10-12T17:00:00.000Z', { liveActivity: fake.port, lastTime });
    const harness = h;
    const { services: s } = await harness.launch();
    lastTime.setReader((state, exId) => s.workout.lastComparableSets(state, exId));
    const gymId = await setUpGym(harness, s);
    await startAndLogFirstWorkingSet(harness, s, gymId);
    await harness.settle(s);
    expect(fake.props().line3).toBe('');
    expect([...harness.pending.values()][0]?.body).not.toContain('last');
  });
});

describe('Lock Screen rest buttons (Ben, 26 Oct)', () => {
  it('a running rest carries the button target (session, timer, version); buttons off in the build: none', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const t = state.restTimer;
    expect(fake.props().tap).toBe(`fizz.rest|${state.session.id}|${t?.id ?? ''}|${String(t?.version ?? 0)}`);
  });

  it('+15 s from the Lock Screen moves the rest, the notification and the countdown together; the intent’s entry is removed after', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const before = deadlineOf(state);
    const q = fakeQueue();
    const changes = { n: 0 };
    const id = q.tap(`${fake.props().tap}|plus15`, harness.clockMs);
    harness.clockMs += 1_000;
    const results = await handler(harness, s, q.port, changes).drain();
    expect(results).toEqual([{ id, result: 'applied' }]);
    const after = await s.sessions.active();
    expect(deadlineOf(after)).toBe(before + 15_000);
    expect(fake.props().endMs).toBe(before + 15_000);
    expect([...harness.pending.values()].map((a) => a.fireAtMs)).toEqual([before + 15_000]);
    // Redrawn for the new version, so the next tap acts on it.
    expect(fake.props().tap.endsWith(`|${String(after?.restTimer?.version ?? 0)}`)).toBe(true);
    expect(q.entries.size).toBe(0);
    expect(changes.n).toBe(1);
    expect(completed(after)).toBe(completed(state));
  });

  it('−15 s then Skip: the rest ends, the activity goes Ready, no notification is left; no set is logged', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const q = fakeQueue();
    const changes = { n: 0 };
    const taps = handler(harness, s, q.port, changes);
    q.tap(`${fake.props().tap}|minus15`, harness.clockMs);
    await taps.drain();
    expect(deadlineOf(await s.sessions.active())).toBe(deadlineOf(state) - 15_000);
    q.tap(`${fake.props().tap}|skip`, harness.clockMs);
    const [r] = await taps.drain();
    expect(r?.result).toBe('applied');
    const after = await s.sessions.active();
    expect(after?.restTimer?.status).toBe('skipped');
    expect(fake.props().state).toBe('ready');
    expect(fake.props().tap).toBe('');
    expect(harness.pending.size).toBe(0);
    expect(completed(after)).toBe(completed(state));
  });

  it('the same tap delivered twice is one change (rule 5)', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const q = fakeQueue();
    const target = `${fake.props().tap}|plus15`;
    q.tap(target, harness.clockMs);
    q.tap(target, harness.clockMs + 1);
    const results = await handler(harness, s, q.port, { n: 0 }).drain();
    expect(results.map((r) => r.result)).toEqual(['applied', 'ignored']);
    expect(results[1]).toMatchObject({ reason: 'stale' });
    expect(deadlineOf(await s.sessions.active())).toBe(deadlineOf(state) + 15_000);
    expect(q.entries.size).toBe(0);
  });

  it('an entry whose removal failed is seen again on the next drain and still changes the rest once', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const q = fakeQueue();
    const taps = handler(harness, s, q.port, { n: 0 });
    q.tap(`${fake.props().tap}|plus15`, harness.clockMs);
    q.port.failAck = true;
    expect((await taps.drain()).map((r) => r.result)).toEqual(['applied']);
    expect(q.entries.size).toBe(1);
    q.port.failAck = false;
    expect((await taps.drain()).map((r) => r.result)).toEqual(['ignored']);
    expect(deadlineOf(await s.sessions.active())).toBe(deadlineOf(state) + 15_000);
    expect(q.entries.size).toBe(0);
  });

  it('a tap on an older picture of the rest (moved in the app since) is refused, never applied to the newer rest', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const oldTarget = `${fake.props().tap}|minus15`;
    const t = state.restTimer;
    if (!t) throw new Error('no rest');
    const moved = await s.workout.dispatch(state.session.id, { type: 'adjust_rest', at: harness.now(), opId: 'in-app-30', timerId: t.id, deltaS: 30 });
    if (!moved.ok) throw new Error(moved.error.message);
    await harness.settle(s);
    const q = fakeQueue();
    q.tap(oldTarget, harness.clockMs);
    const [r] = await handler(harness, s, q.port, { n: 0 }).drain();
    expect(r).toMatchObject({ result: 'ignored', reason: 'stale' });
    expect(deadlineOf(await s.sessions.active())).toBe(deadlineOf(state) + 30_000);
  });

  it('paused, too old, another workout or not ours: dropped and removed; the activity is redrawn from the truth', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const base = fake.props().tap;
    const q = fakeQueue();
    const taps = handler(harness, s, q.port, { n: 0 });

    q.tap(`${base}|plus15`, harness.clockMs - LOCK_SCREEN_TAP_MAX_AGE_MS - 1);
    q.tap(base.replace(state.session.id, '00000000-0000-4000-8000-00000000dead') + '|plus15', harness.clockMs);
    q.tap('__expo_widgets_target_0', harness.clockMs);
    const r1 = await taps.drain();
    expect(r1.map((r) => (r.result === 'ignored' ? r.reason : r.result))).toEqual(['too_old', 'other_workout', 'not_ours']);

    const paused = await s.workout.dispatch(state.session.id, { type: 'pause', at: harness.now(), opId: 'pause-1' });
    if (!paused.ok) throw new Error(paused.error.message);
    await harness.settle(s);
    q.tap(`${base}|skip`, harness.clockMs);
    const [r2] = await taps.drain();
    expect(r2).toMatchObject({ result: 'ignored', reason: 'paused' });
    expect(fake.props().state).toBe('paused');
    expect(q.entries.size).toBe(0);
    expect(deadlineOf(await s.sessions.active())).toBe(deadlineOf(state));
  });

  it('restart recovery: a tap queued while the app was closed is handled after the relaunch (within a minute), once', async () => {
    const { fake, s, gymId, harness } = await setUp();
    const state = await startAndLogFirstWorkingSet(harness, s, gymId);
    const q = fakeQueue();
    q.tap(`${fake.props().tap}|plus15`, harness.clockMs);
    await harness.forceClose();
    harness.clockMs += 5_000;
    const { services: s2 } = await harness.launch();
    await harness.settle(s2);
    const results = await handler(harness, s2, q.port, { n: 0 }).drain();
    expect(results.map((r) => r.result)).toEqual(['applied']);
    expect(deadlineOf(await s2.sessions.active())).toBe(deadlineOf(state) + 15_000);
    // A second launch's drain finds nothing to do.
    expect(await handler(harness, s2, q.port, { n: 0 }).drain()).toEqual([]);
  });

  it('a build without the native queue does nothing', async () => {
    const { s } = await setUp();
    const queue: TapQueuePort = {
      available: () => false,
      list: () => {
        throw new Error('not in build');
      },
      ack: () => undefined,
    };
    expect(await handler(h as Harness, s, queue, { n: 0 }).drain()).toEqual([]);
  });
});
