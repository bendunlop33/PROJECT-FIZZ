import { describe, expect, it } from 'vitest';

import { CoachTurnBusyError, createRunningTurns, onThread, type RunningTurnEvent } from '../src/coach/running-turns';
import { createAppForeground, SUSPENDED_SLACK_MS, type HostClock } from '../src/coach/turn-lifecycle';
import { liveTurnOf } from '../src/coach/sheet-view';

/** (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") The running-turn store and the turn timers. */

const words = (text: string) => ({ kind: 'words' as const, text, spoken: false });

describe('running turns: one per thread, followed by any sheet on it', () => {
  it('start, thread, progress and finish reach subscribers in order; the live turn folds the progress', () => {
    const turns = createRunningTurns();
    const seen: RunningTurnEvent['kind'][] = [];
    const off = turns.subscribe((e) => seen.push(e.kind));
    turns.start({ turnId: 't1', threadId: null, scope: 'general', input: words('How long should I rest?'), startedAtMs: 1000 });
    expect(turns.runningOn(null, 'general')?.turnId).toBe('t1');
    turns.setThread('t1', 'th1');
    turns.setThread('t1', 'th1');
    turns.progress('t1', { kind: 'first_event' });
    turns.progress('t1', { kind: 'item', item: { kind: 'sentence', text: 'Rest two minutes.' } });
    const r = turns.get('t1');
    if (r === null) throw new Error('not running');
    expect(liveTurnOf(r)).toMatchObject({ turnId: 't1', benText: 'How long should I rest?', startedAtMs: 1000, firstEvent: true, sentences: ['Rest two minutes.'] });
    turns.finish('t1');
    expect(turns.isRunning('t1')).toBe(false);
    expect(seen).toEqual(['started', 'thread', 'progress', 'progress', 'finished']);
    off();
    turns.start({ turnId: 't2', threadId: 'th1', scope: 'general', input: words('Hi'), startedAtMs: 0 });
    expect(seen).toHaveLength(5);
  });

  it('a second start on the thread is refused (the same turn ID is not); another thread is free', () => {
    const turns = createRunningTurns();
    turns.start({ turnId: 't1', threadId: 'th1', scope: 'session:s1', input: words('Hi'), startedAtMs: 0 });
    expect(() => turns.start({ turnId: 't2', threadId: 'th1', scope: 'session:s1', input: words('Again'), startedAtMs: 0 })).toThrow(CoachTurnBusyError);
    // Before the thread is known the scope decides: the workout's thread.
    expect(() => turns.start({ turnId: 't3', threadId: null, scope: 'session:s1', input: words('Again'), startedAtMs: 0 })).toThrow(CoachTurnBusyError);
    expect(() => turns.start({ turnId: 't1', threadId: 'th1', scope: 'session:s1', input: words('Hi'), startedAtMs: 0 })).not.toThrow();
    expect(() => turns.start({ turnId: 't4', threadId: 'th2', scope: 'general', input: words('Hi'), startedAtMs: 0 })).not.toThrow();
    turns.finish('t1');
    expect(() => turns.start({ turnId: 't2', threadId: 'th1', scope: 'session:s1', input: words('Again'), startedAtMs: 0 })).not.toThrow();
  });

  it('onThread: known threads compare by ID; an unknown one by scope', () => {
    expect(onThread({ threadId: 'a', scope: 'general' }, 'a', 'general')).toBe(true);
    expect(onThread({ threadId: 'a', scope: 'general' }, 'b', 'general')).toBe(false);
    expect(onThread({ threadId: null, scope: 'general' }, 'b', 'general')).toBe(true);
    expect(onThread({ threadId: 'a', scope: 'session:s1' }, null, 'session:s1')).toBe(true);
    expect(onThread({ threadId: 'a', scope: 'session:s1' }, null, 'session:s2')).toBe(false);
  });

  it('a failing listener never stops the others or the turn', () => {
    const turns = createRunningTurns();
    const seen: string[] = [];
    turns.subscribe(() => {
      throw new Error('screen gone');
    });
    turns.subscribe((e) => seen.push(e.kind));
    turns.start({ turnId: 't1', threadId: 'th1', scope: 'general', input: words('Hi'), startedAtMs: 0 });
    turns.finish('t1', 'th1');
    expect(seen).toEqual(['started', 'finished']);
  });
});

/** A fake clock: timers fire only on `advance`. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: HostClock & { advance(ms: number): void; jump(ms: number): void; pending(): number } = {
    nowMs: () => now,
    setTimeout(fn, ms) {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    /** Time passes with the app running: due timers fire in order. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (next === undefined) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
      }
      now = end;
    },
    /** Time passes with the app suspended: nothing runs; overdue timers fire on the next `advance(0)`. */
    jump(ms) {
      now += ms;
    },
    pending: () => timers.size,
  };
  return clock;
}

describe('turn timers: time in the background doesn’t count', () => {
  it('a timer paused in the background fires after the rest of its time once back', () => {
    const clock = fakeClock();
    const fg = createAppForeground(clock);
    const fired: string[] = [];
    fg.timers.set(() => fired.push('stall'), 20_000);
    clock.advance(15_000);
    fg.setActive(false);
    expect(fg.backgroundCount()).toBe(1);
    expect(clock.pending()).toBe(0);
    clock.advance(10 * 60_000);
    expect(fired).toEqual([]);
    fg.setActive(true);
    clock.advance(4_999);
    expect(fired).toEqual([]);
    clock.advance(1);
    expect(fired).toEqual(['stall']);
  });

  it('a timer set while away starts counting on return; clear works paused or armed', () => {
    const clock = fakeClock();
    const fg = createAppForeground(clock, false);
    const fired: string[] = [];
    const a = fg.timers.set(() => fired.push('a'), 1_000);
    fg.timers.set(() => fired.push('b'), 2_000);
    clock.advance(60_000);
    fg.timers.clear(a);
    fg.setActive(true);
    clock.advance(1_999);
    expect(fired).toEqual([]);
    clock.advance(1);
    expect(fired).toEqual(['b']);
    const c = fg.timers.set(() => fired.push('c'), 500);
    fg.timers.clear(c);
    clock.advance(1_000);
    expect(fired).toEqual(['b']);
  });

  it('suspended without a background event: a timer woken far past due is armed again for its time', () => {
    const clock = fakeClock();
    const fg = createAppForeground(clock);
    const fired: string[] = [];
    fg.timers.set(() => fired.push('first event'), 20_000);
    clock.advance(1_000);
    clock.jump(5 * 60_000);
    clock.advance(0);
    expect(fired).toEqual([]);
    clock.advance(20_000);
    expect(fired).toEqual(['first event']);
    // A little late (a busy JS thread) still fires.
    fg.timers.set(() => fired.push('late'), 1_000);
    clock.jump(1_000 + SUSPENDED_SLACK_MS - 1);
    clock.advance(0);
    expect(fired).toEqual(['first event', 'late']);
  });

  it('whenActive resolves on return (or Stop); subscribers hear each change once', async () => {
    const clock = fakeClock();
    const fg = createAppForeground(clock);
    const heard: boolean[] = [];
    fg.subscribe((a) => heard.push(a));
    await fg.whenActive(new AbortController().signal);
    fg.setActive(false);
    fg.setActive(false);
    let back = false;
    const waiting = fg.whenActive(new AbortController().signal).then(() => {
      back = true;
    });
    await Promise.resolve();
    expect(back).toBe(false);
    fg.setActive(true);
    await waiting;
    expect(back).toBe(true);
    fg.setActive(false);
    const stop = new AbortController();
    const stopped = fg.whenActive(stop.signal);
    stop.abort();
    await stopped;
    expect(heard).toEqual([false, true, false]);
    expect(fg.backgroundCount()).toBe(2);
  });
});
