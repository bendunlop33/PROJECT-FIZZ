import { describe, expect, it } from 'vitest';

import { NBSP, toMs } from '@fizz/domain';
import { apply, at, logCmd, ms, setsFor, startFixture, values, kg, BENCH, HANG } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';

import { createRestAlertController, decideAlertActions, planRestAlert, type NotifierPort, type PlannedRestAlert } from '../src/alerts/rest-alerts';

/** A fake phone: pending notifications by identifier, and every call made. */
function fakeNotifier() {
  const pending = new Map<string, PlannedRestAlert>();
  const calls: string[] = [];
  const port: NotifierPort = {
    schedule(a) {
      calls.push(`schedule ${a.key}`);
      pending.set(a.identifier, a); // same identifier replaces, as on iOS
      return Promise.resolve();
    },
    cancel(id) {
      calls.push(`cancel ${id}`);
      pending.delete(id);
      return Promise.resolve();
    },
    cancelAllWorkoutAlerts() {
      calls.push('cancel all');
      pending.clear();
      return Promise.resolve();
    },
  };
  return { port, pending, calls };
}

const plain = (s: string) => s.replaceAll(NBSP, ' ');

describe('planRestAlert (lock-screen-and-alerts §2.2, §4.1)', () => {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0]?.id ?? '';
  const logged = apply(state, logCmd(warm, values(kg(60), 10), 5));

  it('one alert at the deadline with the next set as a target', () => {
    const a = planRestAlert(logged, ms(10));
    expect(a).toMatchObject({ identifier: `fizz.rest.${state.session.id}`, title: 'Rest done', fireAtMs: ms(65) });
    expect(plain(a?.body ?? '')).toBe('Next: Bench press · 100 kg × 6–8 target');
  });

  it('nothing before a rest, while paused, after the deadline, or when finished', () => {
    expect(planRestAlert(state, ms(1))).toBeNull();
    expect(planRestAlert(apply(logged, { type: 'pause', at: at(10), opId: 'p' }), ms(11))).toBeNull();
    expect(planRestAlert(logged, ms(65))).toBeNull();
    const fin = apply(logged, { type: 'finish', at: at(20), opId: 'f', expectedVersion: logged.session.version, endedAt: null });
    expect(planRestAlert(fin, ms(21))).toBeNull();
    expect(planRestAlert(null, ms(21))).toBeNull();
  });

  it('a running work timer gets one alert at its 0 (review gaps S3); Stop, pause or the deadline passing cancel it', () => {
    const hang = setsFor(logged, HANG)[0]?.id ?? '';
    const working = apply(logged, { type: 'start_work_interval', at: at(20), opId: 'w', setId: hang, durationS: 45 });
    const a = planRestAlert(working, ms(21));
    expect(a).toMatchObject({ identifier: `fizz.rest.${state.session.id}`, title: 'Time', body: 'Dead hang · 0:45', fireAtMs: ms(65) });
    // Same identifier as the rest alert it replaces: never two at once.
    expect(a?.identifier).toBe(planRestAlert(logged, ms(10))?.identifier);
    expect(planRestAlert(working, ms(65))).toBeNull();
    expect(planRestAlert(apply(working, { type: 'stop_work_interval', at: at(30), opId: 's', setId: hang }), ms(31))).toBeNull();
    expect(planRestAlert(apply(working, { type: 'pause', at: at(30), opId: 'p' }), ms(31))).toBeNull();
  });

  it('decides cancel / replace / nothing', () => {
    const a = planRestAlert(logged, ms(10));
    if (!a) throw new Error('no alert');
    expect(decideAlertActions(null, a)).toEqual([{ kind: 'schedule', alert: a }]);
    expect(decideAlertActions({ identifier: a.identifier, key: a.key }, a)).toEqual([]);
    expect(decideAlertActions({ identifier: a.identifier, key: 'old' }, a)).toEqual([{ kind: 'schedule', alert: a }]);
    expect(decideAlertActions({ identifier: a.identifier, key: a.key }, null)).toEqual([{ kind: 'cancel', identifier: a.identifier }]);
    expect(decideAlertActions({ identifier: 'fizz.rest.other', key: 'k' }, a)).toEqual([{ kind: 'cancel', identifier: 'fizz.rest.other' }, { kind: 'schedule', alert: a }]);
  });
});

describe('rest alert controller through a whole loop', () => {
  it('keeps exactly one pending alert at the right time, through ±30, Skip, early Log, Pause, Undo and Finish', async () => {
    const phone = fakeNotifier();
    const ctl = createRestAlertController(phone.port);
    const { state } = startFixture();
    const [w, b1, b2] = setsFor(state, BENCH);
    const pendingAt = () => [...phone.pending.values()].map((p) => p.fireAtMs);
    let s: SessionAggregate = state;
    const step = async (next: SessionAggregate, nowS: number) => {
      s = next;
      await ctl.reconcile(s, ms(nowS));
      expect(phone.pending.size).toBeLessThanOrEqual(1);
    };

    await step(apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 5)), 5);
    expect(pendingAt()).toEqual([ms(65)]);
    const timerId = s.restTimer?.id ?? '';
    await step(apply(s, { type: 'adjust_rest', at: at(10), opId: 'plus', timerId, deltaS: 30 }), 10);
    expect(pendingAt()).toEqual([ms(95)]);
    // Effort chip / correction: rest unchanged, so the alert is unchanged (but the call is harmless).
    await step(apply(s, { type: 'skip_rest', at: at(20), opId: 'skip', timerId }), 20);
    expect(pendingAt()).toEqual([]);

    // Log during rest ends that rest early and starts the next one: one alert, the new one.
    await step(apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 30)), 30);
    expect(pendingAt()).toEqual([ms(210)]);
    await step(apply(s, logCmd(b2?.id ?? '', values(kg(100), 7), 60)), 60);
    expect(pendingAt()).toEqual([ms(240)]);

    // Pause cancels; Resume reschedules for the remaining time.
    await step(apply(s, { type: 'pause', at: at(100), opId: 'pause-1' }), 100);
    expect(pendingAt()).toEqual([]);
    await step(apply(s, { type: 'resume', at: at(400), opId: 'resume-1' }), 400);
    expect(pendingAt()).toEqual([ms(540)]);

    // Undo of the set that started this rest cancels it and puts back B1's rest, which the
    // log at 60 s replaced, at its deadline (workout-table-v3 §3): 210 s + the 300 s paused.
    const last = s.sets.find((x) => x.id === b2?.id);
    await step(apply(s, { type: 'undo_log', at: at(410), opId: 'undo-1', setId: b2?.id ?? '', expectedSetVersion: last?.version ?? 0 }), 410);
    expect(pendingAt()).toEqual([ms(510)]);

    await step(apply(s, logCmd(b2?.id ?? '', values(kg(100), 7), 420, 'log-again')), 420);
    expect(pendingAt()).toEqual([ms(600)]);
    await step(apply(s, { type: 'finish', at: at(430), opId: 'fin', expectedVersion: s.session.version, endedAt: null }), 430);
    expect(pendingAt()).toEqual([]);
    expect(ctl.lastError).toBeNull();
  });

  it('unticking an accidental tick reschedules the alert to the earlier rest’s original deadline, or cancels it when that rest has run out (workout-table-v3 §3)', async () => {
    const phone = fakeNotifier();
    const ctl = createRestAlertController(phone.port);
    const { state } = startFixture();
    const [w, b1] = setsFor(state, BENCH);
    const pendingAt = () => [...phone.pending.values()].map((p) => p.fireAtMs);
    let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 5));
    s = apply(s, { type: 'adjust_rest', at: at(10), opId: 'plus', timerId: s.restTimer?.id ?? '', deltaS: 30 });
    await ctl.reconcile(s, ms(10));
    expect(pendingAt()).toEqual([ms(95)]);
    const ticked = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 20));
    await ctl.reconcile(ticked, ms(20));
    expect(pendingAt()).toEqual([ms(200)]);
    const untick = (t: number, opId: string) => apply(ticked, { type: 'undo_log', at: at(t), opId, setId: b1?.id ?? '', expectedSetVersion: 2 });

    const back = untick(25, 'undo-1');
    await ctl.reconcile(back, ms(25));
    expect(pendingAt()).toEqual([ms(95)]);
    expect(phone.calls.at(-1)).toBe(`schedule ${back.restTimer?.id ?? ''}:${String(back.restTimer?.version)}:${b1?.id ?? ''}:${String(back.session.version)}`);

    // In another run: unticked only after that rest's deadline. No rest, no late alert.
    const phone2 = fakeNotifier();
    const ctl2 = createRestAlertController(phone2.port);
    await ctl2.reconcile(ticked, ms(20));
    await ctl2.reconcile(untick(100, 'undo-2'), ms(100));
    expect(phone2.pending.size).toBe(0);
    expect(ctl.lastError).toBeNull();
  });

  it('after a force-close: a running rest is rescheduled once (replaced by identifier), an ended one is cancelled', async () => {
    const { state } = startFixture();
    const s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const phone = fakeNotifier();
    phone.pending.set(`fizz.rest.${s.session.id}`, { identifier: `fizz.rest.${s.session.id}`, key: 'from-before-the-crash', fireAtMs: ms(65), title: 'Rest done', body: '' });
    await createRestAlertController(phone.port).reconcile(s, ms(30));
    expect([...phone.pending.values()].map((p) => p.fireAtMs)).toEqual([ms(65)]);

    const afterDeadline = fakeNotifier();
    await createRestAlertController(afterDeadline.port).reconcile(s, toMs(s.restTimer?.deadlineUtc ?? '') + 1000);
    expect(afterDeadline.calls).toEqual([`cancel fizz.rest.${s.session.id}`]);
  });

  it('an older version of the workout arriving after a Log can’t cancel the rest alert (review ben-bugs S2); a null clears the guard', async () => {
    const fake = fakeNotifier();
    const c = createRestAlertController(fake.port);
    const { state } = startFixture();
    const logged = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    await c.reconcile(logged, ms(10));
    await c.reconcile(state, ms(11)); // the coach turn's (or the launch) read from before the Log
    expect([...fake.pending.values()].map((a) => a.fireAtMs)).toEqual([ms(65)]);
    await c.reconcile(null, ms(12));
    expect(fake.pending.size).toBe(0);
    await c.reconcile(logged, ms(13));
    expect(fake.pending.size).toBe(1);
  });

  it('a read that started before a commit and lands after it is dropped, even a null or another workout (review ben-bugs r2 N1)', async () => {
    const fake = fakeNotifier();
    const c = createRestAlertController(fake.port);
    const { state } = startFixture();
    const logged = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const deferred = () => {
      let land: (a: SessionAggregate | null) => void = () => undefined;
      const read = () =>
        new Promise<SessionAggregate | null>((r) => {
          land = r;
        });
      return { read, land: (a: SessionAggregate | null) => { land(a); } };
    };
    const a = deferred();
    const lateNull = c.reconcileFromRead(a.read, () => ms(9));
    await c.reconcile(logged, ms(10));
    a.land(null);
    await lateNull;
    expect([...fake.pending.values()].map((x) => x.fireAtMs)).toEqual([ms(65)]);

    // Another workout's state, read earlier, is dropped too (the version guard can't compare across workouts).
    const other = startFixture().state;
    const b = deferred();
    const lateOther = c.reconcileFromRead(b.read, () => ms(11));
    await c.reconcile(logged, ms(12));
    b.land({ ...other, session: { ...other.session, id: 'another-workout' } });
    await lateOther;
    expect([...fake.pending.keys()]).toEqual([`fizz.rest.${logged.session.id}`]);

    // A read started after the last commit applies; a failing read never throws.
    await c.reconcileFromRead(() => Promise.resolve(null), () => ms(13));
    expect(fake.pending.size).toBe(0);
    await expect(c.reconcileFromRead(() => Promise.reject(new Error('locked')), () => ms(14))).resolves.toBeUndefined();
  });

  it('a failing notifier never throws into logging', async () => {
    const { state } = startFixture();
    const s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const ctl = createRestAlertController({ schedule: () => Promise.reject(new Error('not allowed')), cancel: () => Promise.resolve(), cancelAllWorkoutAlerts: () => Promise.resolve() });
    await expect(ctl.reconcile(s, ms(10))).resolves.toBeUndefined();
    expect(ctl.lastError).toBe('not allowed');
  });

  it('cancelAll removes an alert scheduled before a relaunch, which reconcile(null) can’t see (review r2 S1)', async () => {
    const { state } = startFixture();
    const s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const phone = fakeNotifier();
    await createRestAlertController(phone.port).reconcile(s, ms(10));
    expect(phone.pending.size).toBe(1);
    // A new run knows nothing: reconcile(null) issues no cancel.
    const relaunched = createRestAlertController(phone.port);
    await relaunched.reconcile(null, ms(11));
    expect(phone.pending.size).toBe(1);
    await relaunched.cancelAll();
    expect(phone.pending.size).toBe(0);
    expect(relaunched.scheduled).toBeNull();
  });

  it('cancelAll throws when the phone refuses, unlike reconcile', async () => {
    const ctl = createRestAlertController({ schedule: () => Promise.resolve(), cancel: () => Promise.resolve(), cancelAllWorkoutAlerts: () => Promise.reject(new Error('1 scheduled alert(s) couldn’t be cancelled')) });
    await expect(ctl.cancelAll()).rejects.toThrow(/couldn’t be cancelled/);
    expect(ctl.lastError).toMatch(/couldn’t be cancelled/);
    // The chain carries on.
    await expect(ctl.reconcile(null, ms(1))).resolves.toBeUndefined();
  });
});
