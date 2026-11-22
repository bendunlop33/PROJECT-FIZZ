import { describe, expect, it } from 'vitest';

import { apply, at, logCmd, ms, setsFor, startFixture, values, kg, BENCH } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';

import type { ScheduleCuesResult, ScheduledCue, SpeakOptions } from '../modules/audio-coach';
import { createSpokenCueController, nativeRestCues, planCues, type CuePorts, type CueSettings } from '../src/voice/cue-controller';
import { createNativeCueScheduler, type CueSchedulingModule } from '../src/voice/native-cues';

/**
 * Spoken rest cues in the background (Ben, 1 Nov; ADR 0040): the rest's cues
 * are handed to audio-coach, which speaks them natively when the app isn't
 * active. These cover the scheduling, cancelling and rescheduling logic and
 * the port calls, against a fake native module.
 */

function fakeClock(startMs: number) {
  let now = startMs;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn: () => void, delay: number): unknown {
      const id = next++;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(h: unknown) {
      timers.delete(h as number);
    },
    advanceTo(t: number) {
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = Math.max(now, due[1].at);
        timers.delete(due[0]);
        due[1].fn();
      }
      now = t;
    },
  };
}

type Call = { fn: 'schedule'; cues: ScheduledCue[]; options: SpeakOptions } | { fn: 'cancel' };

/** A fake audio-coach: records calls; `reply` is what scheduleRestCues answers. */
function fakeModule(reply: Partial<ScheduleCuesResult> = {}, opts: { fails?: boolean } = {}) {
  const calls: Call[] = [];
  const module: CueSchedulingModule = {
    scheduleRestCues(cues, options) {
      calls.push({ fn: 'schedule', cues, options });
      if (opts.fails === true) return Promise.reject(new Error('native boom'));
      return Promise.resolve({ scheduled: cues.length > 0, count: cues.length, holdRunning: false, ...reply });
    },
    cancelRestCues() {
      calls.push({ fn: 'cancel' });
      return Promise.resolve({ cancelled: 0, holdRunning: false });
    },
  };
  return { module, calls };
}

const SPEAK: SpeakOptions = { voice: 'com.apple.voice.premium.en-GB.Malcolm', language: 'en-GB', rate: 1.1, deactivateAfter: true };

function rig(opts: { startMs?: number; settings?: Partial<CueSettings>; active?: boolean; module?: CueSchedulingModule | null; history?: CuePorts['history'] } = {}) {
  const clock = fakeClock(opts.startMs ?? ms(0));
  const said: string[] = [];
  const initial: CueSettings = { cuesOn: true, cueDetail: 'timer_and_set', ...opts.settings };
  const env = { active: opts.active ?? true, settings: initial };
  const settings = (): CueSettings => env.settings;
  const fake = fakeModule();
  const native = createNativeCueScheduler(opts.module === undefined ? fake.module : opts.module, () => SPEAK);
  const controller = createSpokenCueController({
    speaker: {
      available: () => true,
      speak: (text) => {
        said.push(text);
        return Promise.resolve();
      },
    },
    clock,
    appActive: () => env.active,
    settings,
    native,
    ...(opts.history ? { history: opts.history } : {}),
  });
  return { clock, said, env, controller, native, calls: fake.calls };
}

function resting(): SessionAggregate {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0]?.id ?? '';
  // Warm-up rest is 60 s: logged at 5 s, deadline at 65 s.
  return apply(state, logCmd(warm, values(kg(60), 10), 5));
}

const NEXT_B2 = '15 seconds. Next: Bench press, set 2, 100 kilos for 8.';
const OVER = 'Rest over.';
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const scheduled = (c: Call | undefined) => (c?.fn === 'schedule' ? c.cues.map((x) => [x.text, x.fireAtMs, x.dropAfterMs]) : c?.fn);

describe('nativeRestCues (pure)', () => {
  it('the rest’s two cues with their words, fire times and drop times; never a timed set’s', () => {
    const logged = resting();
    const cues = nativeRestCues(planCues(logged), logged, { cuesOn: true, cueDetail: 'timer_and_set' }, ms(6));
    expect(cues.map((c) => [c.text, c.fireAtMs, c.dropAfterMs])).toEqual([
      [NEXT_B2, ms(50), ms(51.5)],
      [OVER, ms(65), ms(70)],
    ]);
    expect(cues[0]?.id).toBe(`rest:${logged.restTimer?.id ?? ''}:${logged.restTimer?.deadlineUtc ?? ''}:warn`);
    const timerOnly = nativeRestCues(planCues(logged), logged, { cuesOn: true, cueDetail: 'timer' }, ms(6));
    expect(timerOnly.map((c) => c.text)).toEqual(['15 seconds.', OVER]);
    expect(nativeRestCues(planCues(logged), logged, { cuesOn: false, cueDetail: 'timer' }, ms(6))).toEqual([]);
    const wi = { setId: 's', status: 'running', durationS: 60, deadlineUtc: new Date(ms(100)).toISOString() };
    const timed = planCues({ ...logged, restTimer: null, workInterval: wi } as unknown as SessionAggregate);
    expect(timed.length).toBeGreaterThan(0);
    expect(nativeRestCues(timed, logged, { cuesOn: true, cueDetail: 'timer' }, ms(6))).toEqual([]);
  });

  it('a cue already past its drop time is left out (relaunched late in the rest)', () => {
    const logged = resting();
    expect(nativeRestCues(planCues(logged), logged, { cuesOn: true, cueDetail: 'timer' }, ms(60)).map((c) => c.text)).toEqual([OVER]);
    expect(nativeRestCues(planCues(logged), logged, { cuesOn: true, cueDetail: 'timer' }, ms(71))).toEqual([]);
  });
});

describe('native rest-cue scheduling (Ben, 1 Nov)', () => {
  it('rest start hands both cues to native with the chosen voice; the same state again sends nothing', async () => {
    const logged = resting();
    const { controller, calls } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    await flush();
    expect(calls).toHaveLength(1);
    expect(scheduled(calls[0])).toEqual([
      [NEXT_B2, ms(50), ms(51.5)],
      [OVER, ms(65), ms(70)],
    ]);
    expect(calls[0]?.fn === 'schedule' ? calls[0].options : null).toEqual(SPEAK);
    controller.reconcile(logged);
    controller.reconcile(apply(logged, { type: 'tick', at: at(7) }));
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('on screen JS speaks; in the background JS stays quiet and the native schedule is the voice', async () => {
    const logged = resting();
    const fg = rig({ startMs: ms(6) });
    fg.controller.reconcile(logged);
    fg.clock.advanceTo(ms(70));
    expect(fg.said).toEqual([NEXT_B2, OVER]);

    const bg = rig({ startMs: ms(6), active: false });
    bg.controller.reconcile(logged);
    bg.clock.advanceTo(ms(70));
    await flush();
    expect(bg.said).toEqual([]);
    expect(scheduled(bg.calls[0])).toEqual([
      [NEXT_B2, ms(50), ms(51.5)],
      [OVER, ms(65), ms(70)],
    ]);
  });

  it('±30 s reschedules with the new times; Skip, Pause, Finish and Discard cancel', async () => {
    const logged = resting();
    const timerId = logged.restTimer?.id ?? '';
    const { controller, calls } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    const longer = apply(logged, { type: 'adjust_rest', at: at(10), opId: 'a', timerId, deltaS: 30 });
    controller.reconcile(longer);
    await flush();
    expect(scheduled(calls[1])).toEqual([
      [NEXT_B2, ms(80), ms(81.5)],
      [OVER, ms(95), ms(100)],
    ]);
    // A new deadline is a new id: native never treats it as the cue already spoken.
    const ids = (c: Call | undefined) => (c?.fn === 'schedule' ? c.cues.map((x) => x.id) : []);
    expect(ids(calls[1]).some((id) => ids(calls[0]).includes(id))).toBe(false);

    controller.reconcile(apply(longer, { type: 'skip_rest', at: at(20), opId: 's', timerId }));
    await flush();
    expect(calls[2]).toEqual({ fn: 'cancel' });

    for (const end of [
      (s: SessionAggregate) => apply(s, { type: 'pause', at: at(11), opId: 'p' }),
      (s: SessionAggregate): SessionAggregate => ({ ...s, session: { ...s.session, status: 'finished' } }),
      (): null => null,
    ]) {
      const r = rig({ startMs: ms(6) });
      r.controller.reconcile(logged);
      r.controller.reconcile(end(logged));
      await flush();
      expect(r.calls.map((c) => c.fn)).toEqual(['schedule', 'cancel']);
    }
  });

  it('cues turned off mid-rest cancel; back on, the rest’s remaining cues are scheduled again', async () => {
    const logged = resting();
    const { controller, calls, env, clock } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    clock.advanceTo(ms(56));
    env.settings = { ...env.settings, cuesOn: false };
    controller.settingsChanged();
    await flush();
    expect(calls[1]).toEqual({ fn: 'cancel' });
    env.settings = { ...env.settings, cuesOn: true, cueDetail: 'timer' };
    controller.settingsChanged();
    await flush();
    expect(scheduled(calls[2])).toEqual([[OVER, ms(65), ms(70)]]);
    // A voice or speed change resends, as the options travel with the schedule.
    controller.settingsChanged();
    await flush();
    expect(calls[3]?.fn).toBe('schedule');
  });

  it('a cue JS has spoken stays listed until its drop time (native never repeats an id)', async () => {
    const logged = resting();
    const { controller, calls, clock, said } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    clock.advanceTo(ms(50.5));
    expect(said).toEqual([NEXT_B2]);
    controller.reconcile(apply(logged, { type: 'tick', at: at(50.5) }));
    await flush();
    expect(calls).toHaveLength(1);
    // Past the warning's drop time it falls out: the end alone is sent.
    controller.reconcile(apply(logged, { type: 'tick', at: at(52) }));
    clock.advanceTo(ms(52));
    controller.reconcile(apply(logged, { type: 'tick', at: at(52) }));
    await flush();
    expect(scheduled(calls.at(-1))).toEqual([[OVER, ms(65), ms(70)]]);
  });

  it('history arriving with the same words sends nothing more', async () => {
    const logged = resting();
    const b1 = setsFor(logged, BENCH)[1];
    if (!b1) throw new Error('fixture');
    const { controller, calls } = rig({ startMs: ms(6), history: () => Promise.resolve([{ index: b1.index, values: values(kg(97.5), 8) }]) });
    controller.reconcile(logged);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('a fresh run speaks to native first: no rest → one cancel, so nothing left by an earlier run survives', async () => {
    const { controller, calls } = rig({ startMs: ms(6) });
    controller.reconcile(null);
    controller.reconcile(null);
    await flush();
    expect(calls).toEqual([{ fn: 'cancel' }]);
  });
});

describe('honest fallback: builds that can’t speak in the background', () => {
  it('an old build without the functions: nothing is called, JS still speaks on screen', async () => {
    const logged = resting();
    const { controller, said, clock, native } = rig({ startMs: ms(6), module: {} });
    expect(native.available()).toBe(false);
    controller.reconcile(logged);
    clock.advanceTo(ms(70));
    await flush();
    expect(said).toEqual([NEXT_B2, OVER]);
    expect(rig({ module: null }).native.available()).toBe(false);
  });

  it('no audio background mode: said once, then nothing more is sent', async () => {
    const logged = resting();
    const fake = fakeModule({ scheduled: false, count: 0, reason: 'noBackgroundMode' });
    const { controller, native } = rig({ startMs: ms(6), module: fake.module });
    controller.reconcile(logged);
    await flush();
    expect(native.status).toBe('no_background_mode');
    expect(native.available()).toBe(false);
    controller.reconcile(apply(logged, { type: 'skip_rest', at: at(20), opId: 's', timerId: logged.restTimer?.id ?? '' }));
    await flush();
    expect(fake.calls).toHaveLength(1);
  });

  it('a native failure never reaches the workout, and is kept for diagnostics', async () => {
    const logged = resting();
    const fake = fakeModule({}, { fails: true });
    const { controller, native, said, clock } = rig({ startMs: ms(6), module: fake.module });
    expect(() => {
      controller.reconcile(logged);
    }).not.toThrow();
    await flush();
    expect(native.status).toBe('error');
    expect(native.lastError).toBe('native boom');
    clock.advanceTo(ms(70));
    expect(said).toEqual([NEXT_B2, OVER]);
  });

  it('a hold that could not start is reported, the cues stay scheduled', async () => {
    const fake = fakeModule({ holdError: 'Could not activate the audio session' });
    const { controller, native } = rig({ startMs: ms(6), module: fake.module });
    controller.reconcile(resting());
    await flush();
    expect(native.status).toBe('scheduled');
    expect(native.lastError).toBe('Could not activate the audio session');
  });
});
