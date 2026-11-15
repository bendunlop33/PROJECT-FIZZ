import { describe, expect, it } from 'vitest';

import { lockScreenLogOf, NBSP, parseLockScreenLog, reduceSession, toIso, toMs, type CommandOutcome } from '@fizz/domain';
import { apply, at, logCmd, ms, startFixture } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';

import { createRestAlertController, planRestAlert, type NotifierPort, type PlannedRestAlert } from '../src/alerts/rest-alerts';
import { createLiveActivityController, type LiveActivityPort, type WorkoutActivityProps } from '../src/live-activity/controller';
import { createLockScreenTapHandler, type TapQueuePort } from '../src/live-activity/taps';

/**
 * (Ben, 15 Nov, build 568) "Won't let me log on the lock screen, just Skip or
 * adjust timer; doesn't seem to update post rest pop-up." The Resting activity
 * must carry the Ready content and its Log for the rest's end with the stale
 * date at the deadline (start, ±15 s, Skip); the after-rest content must be
 * right when the next set is in the next exercise, a superset partner or a
 * timed set; and the rest-done alert's `Log …` action must log the planned set
 * once through the same versioned path and update the activity.
 */

const TZ = 'Pacific/Auckland';
const plain = (s: string) => s.replaceAll(NBSP, ' ');

function fakeActivities() {
  const running = new Map<string, { props: WorkoutActivityProps; staleAtMs: number | null }>();
  let n = 0;
  const port: LiveActivityPort = {
    available: () => true,
    listIds: () => [...running.keys()],
    start(props, staleAtMs) {
      n += 1;
      const id = `la-${String(n)}`;
      running.set(id, { props, staleAtMs });
      return id;
    },
    update(id, props, staleAtMs) {
      if (!running.has(id)) return Promise.reject(new Error('gone'));
      running.set(id, { props, staleAtMs });
      return Promise.resolve();
    },
    end(id) {
      running.delete(id);
      return Promise.resolve();
    },
  };
  return {
    port,
    only() {
      expect(running.size).toBe(1);
      const [a] = [...running.values()];
      if (!a) throw new Error('none');
      return a;
    },
  };
}

const controller = (port: LiveActivityPort) => createLiveActivityController(port, { tz: () => TZ, buttons: () => true, log: () => true });

/** Logs the workout's current set with its planned load and the top of its rep range, `seconds` after the start. */
function logActive(state: SessionAggregate, seconds: number): SessionAggregate {
  const set = state.sets.find((s) => s.id === state.session.activeSetId);
  if (!set) throw new Error('no active set');
  const reps = set.planned.reps?.max ?? null;
  return apply(state, logCmd(set.id, { load: set.planned.load, reps, durationS: set.planned.durationS ?? null, rpe: null, rir: null }, seconds));
}

const exerciseOfActive = (s: SessionAggregate) => s.exercises.find((e) => e.id === s.sets.find((x) => x.id === s.session.activeSetId)?.sessionExerciseId);

describe('Resting props and the stale date (rest start, ±15 s, Skip)', () => {
  it('rest start: stale at the deadline, the after-rest Ready and its Log for the next set, rest buttons, no live Log', async () => {
    const fake = fakeActivities();
    const la = controller(fake.port);
    const s = logActive(startFixture().state, 30);
    await la.reconcile(s, ms(31));
    const a = fake.only();
    const deadline = toMs(s.restTimer?.deadlineUtc ?? '');
    expect(a.staleAtMs).toBe(deadline);
    expect(a.props).toMatchObject({ state: 'resting', endMs: deadline, log: '', afterTitle: 'Ready · Bench press', afterSide: 'Set 2' });
    expect(a.props.tap).toMatch(/^fizz\.rest\|/);
    expect(plain(a.props.afterLogLabel)).toBe('Log 100 kg × 8');
    expect(parseLockScreenLog(a.props.afterLog)?.setId).toBe(s.session.activeSetId);
  });

  it('+15 s moves the stale date with the deadline and keeps the after-rest Log; −15 s back again', async () => {
    const fake = fakeActivities();
    const la = controller(fake.port);
    const s = logActive(startFixture().state, 30);
    await la.reconcile(s, ms(31));
    const before = fake.only();
    const timerId = s.restTimer?.id ?? '';
    const plus = apply(s, { type: 'adjust_rest', at: at(35), opId: 'plus15', timerId, deltaS: 15 });
    await la.reconcile(plus, ms(36));
    const after = fake.only();
    expect(after.staleAtMs).toBe(toMs(plus.restTimer?.deadlineUtc ?? ''));
    expect(after.staleAtMs).toBe((before.staleAtMs ?? 0) + 15_000);
    expect(after.props.endMs).toBe(after.staleAtMs);
    expect(after.props.afterLog).toBe(before.props.afterLog);
    // The buttons are redrawn for the new timer version (an older picture's tap is refused).
    expect(after.props.tap).not.toBe(before.props.tap);
    const minus = apply(plus, { type: 'adjust_rest', at: at(40), opId: 'minus15', timerId, deltaS: -15 });
    await la.reconcile(minus, ms(41));
    expect(fake.only().staleAtMs).toBe(before.staleAtMs);
  });

  it('Skip (in the app or from the Lock Screen) writes Ready with the live Log at once: no stale date, no countdown, no rest buttons', async () => {
    const fake = fakeActivities();
    const la = controller(fake.port);
    const s = logActive(startFixture().state, 30);
    await la.reconcile(s, ms(31));
    const resting = fake.only().props;
    const skipped = apply(s, { type: 'skip_rest', at: at(40), opId: 'skip', timerId: s.restTimer?.id ?? '' });
    await la.reconcile(skipped, ms(41));
    const a = fake.only();
    expect(a.staleAtMs).toBeNull();
    expect(a.props).toMatchObject({ state: 'ready', endMs: 0, tap: '', afterTitle: '', afterLog: '' });
    // The same Log the rest had written for its end.
    expect(a.props.log).toBe(resting.afterLog);
    expect(a.props.logLabel).toBe(resting.afterLogLabel);
  });
});

describe('After-rest Ready content when the next set is elsewhere', () => {
  /** Logs sets until the current set is in an exercise that `pick` accepts; returns the state resting before it. */
  function restBefore(pick: (s: SessionAggregate) => boolean): SessionAggregate {
    let s = startFixture().state;
    for (let i = 0; i < 20; i += 1) {
      s = logActive(s, 30 + i * 300);
      if (s.restTimer?.status === 'running' && pick(s)) return s;
    }
    throw new Error('not reached');
  }

  async function restingProps(s: SessionAggregate) {
    const fake = fakeActivities();
    const nowMs = toMs(s.restTimer?.startedAtUtc ?? '') + 1_000;
    await controller(fake.port).reconcile(s, nowMs);
    return fake.only();
  }

  it('the next exercise: the after-rest title, line and Log name it, and match what Ready shows at the end', async () => {
    const s = restBefore((x) => exerciseOfActive(x)?.exerciseName !== 'Bench press');
    const a = await restingProps(s);
    const ex = exerciseOfActive(s);
    expect(a.props.afterTitle).toContain('Ready · ');
    expect(a.props.afterTitle).not.toContain('Bench');
    expect(a.props.afterLog).not.toBe('');
    expect(parseLockScreenLog(a.props.afterLog)?.setId).toBe(s.session.activeSetId);
    expect(ex).toBeDefined();
    // At the rest's end the app writes the same content (nothing jumps), with the same Log.
    const fake = fakeActivities();
    await controller(fake.port).reconcile(s, toMs(s.restTimer?.deadlineUtc ?? '') + 1);
    const ready = fake.only().props;
    expect([ready.title, ready.line1, ready.log, ready.logLabel]).toEqual([a.props.afterTitle, a.props.afterLine1, a.props.afterLog, a.props.afterLogLabel]);
  });

  it('a superset partner: the after-rest Log is for the partner’s set the workout moves to', async () => {
    // Log into the superset (row), then rest before its partner (face pulls) or the next round.
    const s = restBefore((x) => {
      const prev = x.sets.filter((y) => y.status === 'completed').at(-1);
      const prevEx = x.exercises.find((e) => e.id === prev?.sessionExerciseId);
      return prevEx?.supersetGroup === 'A';
    });
    const a = await restingProps(s);
    const next = s.sets.find((x) => x.id === s.session.activeSetId);
    const nextEx = s.exercises.find((e) => e.id === next?.sessionExerciseId);
    expect(nextEx?.supersetGroup).toBe('A');
    expect(a.props.afterTitle).not.toBe('');
    expect(parseLockScreenLog(a.props.afterLog)?.setId).toBe(next?.id);
    expect(parseLockScreenLog(a.props.afterLog)?.values.load?.convention).toBe('stack');
  });

  it('a timed set next: the after-rest Ready still shows (title, target) but has no Log (it needs the app)', async () => {
    const s = restBefore((x) => exerciseOfActive(x)?.measurement === 'duration');
    const a = await restingProps(s);
    expect(a.props.afterTitle).not.toBe('');
    expect(a.props.afterLog).toBe('');
    expect(a.props.afterLogLabel).toBe('');
  });
});

describe('Rest-done alert: `Log …` action (Ben, 15 Nov)', () => {
  const carry = (state: SessionAggregate) => lockScreenLogOf(state, state.session.activeSetId, {});

  it('the alert carries the same Log as the activity’s after-rest Log; a work timer and a timed set carry none', async () => {
    const s = logActive(startFixture().state, 30);
    const alert = planRestAlert(s, ms(31), undefined, carry(s));
    const fake = fakeActivities();
    await controller(fake.port).reconcile(s, ms(31));
    expect(alert?.log?.target).toBe(fake.only().props.afterLog);
    expect(plain(alert?.log?.label ?? '')).toBe('Log 100 kg × 8');
    expect(planRestAlert(s, ms(31))?.log).toBeNull();
    // A Log for a different set than the alert names is never attached.
    const other = carry(s);
    expect(planRestAlert(s, ms(31), undefined, other === null ? null : { ...other, setId: 'not-this-set' })?.log).toBeNull();
  });

  it('the Log action changes the alert key, so a Log that arrives later reschedules it', () => {
    const s = logActive(startFixture().state, 30);
    expect(planRestAlert(s, ms(31), undefined, carry(s))?.key).not.toBe(planRestAlert(s, ms(31))?.key);
  });

  it('the action logs the planned set once, through the versioned log_set, and the activity turns to the next rest', async () => {
    const fake = fakeActivities();
    const la = controller(fake.port);
    const pending = new Map<string, PlannedRestAlert>();
    const notifier: NotifierPort = {
      schedule: (a) => {
        pending.set(a.identifier, a);
        return Promise.resolve();
      },
      cancel: (id) => {
        pending.delete(id);
        return Promise.resolve();
      },
      cancelAllWorkoutAlerts: () => Promise.resolve(),
    };
    const alerts = createRestAlertController(notifier, { liveActivity: la, restLog: (state) => carry(state) });
    let stored = logActive(startFixture().state, 30);
    await alerts.reconcile(stored, ms(31));
    const alert = [...pending.values()][0];
    const target = alert?.log?.target ?? '';
    expect(target).toMatch(/^fizz\.log\|/);

    // The rest ran out with the app suspended; Ben chooses `Log 100 kg × 8` on the rest-done alert.
    const deadline = toMs(stored.restTimer?.deadlineUtc ?? '');
    let nowMs = deadline + 4_000;
    const sent: string[] = [];
    const noQueue: TapQueuePort = { available: () => false, list: () => [], ack: () => undefined };
    const taps = createLockScreenTapHandler({
      queue: noQueue,
      readActive: () => Promise.resolve(stored),
      dispatch: (_id, cmd) => {
        sent.push(cmd.type === 'log_set' ? cmd.opId : cmd.type);
        const r = reduceSession(stored, cmd);
        if (!r.ok) return Promise.resolve({ ok: false, error: { code: r.error.code, message: r.error.message } } as CommandOutcome);
        stored = r.state;
        return Promise.resolve({ ok: true, aggregate: stored, events: r.events, duplicate: r.duplicate, superseded: false } satisfies CommandOutcome);
      },
      settle: (state) => alerts.reconcile(state, nowMs),
      now: () => ({ utc: toIso(nowMs), tz: TZ }),
      onChanged: () => undefined,
    });
    const planned = parseLockScreenLog(target);
    const first = await taps.apply({ id: `alert:${alert?.identifier ?? ''}`, target, atMs: nowMs });
    expect(first.result).toBe('applied');
    const set = stored.sets.find((x) => x.id === planned?.setId);
    expect(set?.status).toBe('completed');
    expect(set?.actual).toMatchObject({ load: planned?.values.load, reps: planned?.values.reps });
    expect(set?.completedByOpId).toBe(`lock:log:${planned?.setId ?? ''}:${String(planned?.setVersion ?? 0)}`);
    // The activity shows the next rest, counting, with its own after-rest Log.
    const a = fake.only();
    expect(a.props.state).toBe('resting');
    expect(a.staleAtMs).toBe(toMs(stored.restTimer?.deadlineUtc ?? ''));
    expect(parseLockScreenLog(a.props.afterLog)?.setId).toBe(stored.session.activeSetId);
    // The same action delivered again (the launch read and the listener), or the Lock Screen's Log of that set: one write.
    nowMs += 1_000;
    const completed = stored.sets.filter((x) => x.status === 'completed').length;
    const again = await taps.apply({ id: 'alert:again', target, atMs: nowMs });
    expect(again).toMatchObject({ result: 'ignored', reason: 'already_logged' });
    expect(stored.sets.filter((x) => x.status === 'completed')).toHaveLength(completed);
    expect(sent).toHaveLength(1);
  });

  it('an action for anything but a Log target is not ours and writes nothing', async () => {
    let calls = 0;
    const taps = createLockScreenTapHandler({
      queue: { available: () => false, list: () => [], ack: () => undefined },
      readActive: () => Promise.resolve(null),
      dispatch: () => {
        calls += 1;
        return Promise.reject(new Error('never'));
      },
      settle: () => Promise.resolve(),
      now: () => at(0),
      onChanged: () => undefined,
    });
    expect(await taps.apply({ id: 'x', target: 'fizz.rest|a|b|1|skip', atMs: 0 })).toMatchObject({ result: 'ignored', reason: 'not_ours' });
    expect(await taps.apply({ id: 'y', target: 42, atMs: 0 })).toMatchObject({ result: 'ignored', reason: 'not_ours' });
    expect(calls).toBe(0);
  });
});
