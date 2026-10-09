import { describe, expect, it } from 'vitest';

import { NBSP, toMs } from '@fizz/domain';
import { apply, at, logCmd, ms, setsFor, startFixture, values, kg, BENCH } from '@fizz/domain/testing';
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

    // Undo of the set that started this rest cancels it.
    const last = s.sets.find((x) => x.id === b2?.id);
    await step(apply(s, { type: 'undo_log', at: at(410), opId: 'undo-1', setId: b2?.id ?? '', expectedSetVersion: last?.version ?? 0 }), 410);
    expect(pendingAt()).toEqual([]);

    await step(apply(s, logCmd(b2?.id ?? '', values(kg(100), 7), 420, 'log-again')), 420);
    expect(pendingAt()).toEqual([ms(600)]);
    await step(apply(s, { type: 'finish', at: at(430), opId: 'fin', expectedVersion: s.session.version, endedAt: null }), 430);
    expect(pendingAt()).toEqual([]);
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

  it('a failing notifier never throws into logging', async () => {
    const { state } = startFixture();
    const s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const ctl = createRestAlertController({ schedule: () => Promise.reject(new Error('not allowed')), cancel: () => Promise.resolve() });
    await expect(ctl.reconcile(s, ms(10))).resolves.toBeUndefined();
    expect(ctl.lastError).toBe('not allowed');
  });
});
