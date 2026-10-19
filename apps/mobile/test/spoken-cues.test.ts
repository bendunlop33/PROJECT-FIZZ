import { describe, expect, it } from 'vitest';

import { apply, at, logCmd, ms, setsFor, startFixture, values, kg, BENCH, HANG } from '@fizz/domain/testing';
import { prefillDraft } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { createRestAlertController, type NotifierPort } from '../src/alerts/rest-alerts';
import { createSpokenCueController, planCues, type CuePorts, type CueSettings } from '../src/voice/cue-controller';
import { createSpeechArbiter } from '../src/voice/arbiter';
import { createReplyVoice, readRepliesOn, replyToSpeak, sheetReadOn } from '../src/voice/read-aloud';
import { cueModeOf, DEFAULT_VOICE_PREFS, parseVoicePrefs, toggleCues, voiceRowLine, withCueMode } from '../src/voice/settings';
import { workoutMenu } from '../src/workout/table';
import { defaultVoice, needsBetterVoiceHint, parseVoices, resolveVoice, voicesForLanguage } from '../src/voice/voices';
import { createPrefsHolder, parsePrefs } from '../src/device/prefs';

/** A fake phone clock with timers that run when time is advanced. */
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
    /** JS suspended until `t`: nothing runs meanwhile; due timers then run late. */
    suspendUntil(t: number) {
      now = t;
    },
  };
}

function rig(opts: { startMs?: number; settings?: Partial<CueSettings>; active?: boolean; available?: boolean; history?: CuePorts['history'] } = {}) {
  const clock = fakeClock(opts.startMs ?? ms(0));
  const said: string[] = [];
  const settings: CueSettings = { cuesOn: true, cueDetail: 'timer_and_set', ...opts.settings };
  const env = { active: opts.active ?? true, available: opts.available ?? true, settings };
  const controller = createSpokenCueController({
    speaker: {
      available: () => env.available,
      speak: (text) => {
        said.push(text);
        return Promise.resolve();
      },
    },
    clock,
    appActive: () => env.active,
    settings: () => env.settings,
    ...(opts.history ? { history: opts.history } : {}),
  });
  return { clock, said, env, controller };
}

function resting(): { state: SessionAggregate; logged: SessionAggregate } {
  const { state } = startFixture();
  const warm = setsFor(state, BENCH)[0]?.id ?? '';
  // Warm-up rest is 60 s: logged at 5 s, deadline at 65 s.
  return { state, logged: apply(state, logCmd(warm, values(kg(60), 10), 5)) };
}

describe('spoken cue timing (Ben, 19 Oct)', () => {
  it('"10 seconds" then "Rest done" with the next set, each once per rest', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    expect(planCues(logged).map((c) => [c.kind, c.fireAtMs])).toEqual([
      ['warning', ms(55)],
      ['rest_end', ms(65)],
    ]);
    clock.advanceTo(ms(54));
    expect(said).toEqual([]);
    clock.advanceTo(ms(55));
    expect(said).toEqual(['10 seconds.']);
    clock.advanceTo(ms(65));
    expect(said).toEqual(['10 seconds.', 'Rest done. Set 2, Bench press, 100 kilos for 8.']);
    // The same state again (a foreground read), or the screen's tick saving the expiry: nothing twice.
    controller.reconcile(logged);
    controller.reconcile(apply(logged, { type: 'tick', at: at(66) }));
    clock.advanceTo(ms(200));
    expect(said).toEqual(['10 seconds.', 'Rest done. Set 2, Bench press, 100 kilos for 8.']);
  });

  it('the screen ticking the expiry a moment before the cue timer fires does not cancel it', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(60) });
    controller.reconcile(logged);
    clock.advanceTo(ms(64.9));
    const expired = apply(logged, { type: 'tick', at: at(65) });
    expect(expired.restTimer?.status).toBe('expired');
    controller.reconcile(expired);
    clock.advanceTo(ms(65.2));
    // Joined at 1:00, 5 s after the warning's moment: the warning is dropped, the rest end still speaks.
    expect(said).toEqual(['Rest done. Set 2, Bench press, 100 kilos for 8.']);
  });

  it('says the card’s values: a draft saved during the rest, history for an open target field (review B1)', async () => {
    const { logged } = resting();
    const b1 = setsFor(logged, BENCH)[1];
    if (!b1) throw new Error('fixture');
    // Bench set 2 with the load left open: the card fills it from the last comparable session.
    const open = { ...logged, sets: logged.sets.map((x) => (x.id === b1.id ? { ...x, planned: { ...x.planned, load: null } } : x)) };
    const reads: string[] = [];
    const { clock, said, controller } = rig({
      startMs: ms(6),
      history: (_state, exId) => {
        reads.push(exId);
        return Promise.resolve([{ index: b1.index, values: values(kg(97.5), 8) }]);
      },
    });
    controller.reconcile(open);
    await Promise.resolve();
    clock.advanceTo(ms(30));
    // Ben changes the next set to 85 kg during the rest; the debounced draft is saved.
    const edited = apply(open, { type: 'save_draft', at: at(30), setId: b1.id, values: values(kg(85), 7) });
    controller.reconcile(edited);
    clock.advanceTo(ms(70));
    expect(said).toEqual(['10 seconds.', 'Rest done. Set 2, Bench press, 85 kilos for 7.']);
    // Read once per exercise row, ahead of the cue.
    expect(reads).toEqual([b1.sessionExerciseId]);
  });

  it('an open load says what the card prefills (this session’s last set before history)', async () => {
    const { logged } = resting();
    const b1 = setsFor(logged, BENCH)[1];
    if (!b1) throw new Error('fixture');
    const open = { ...logged, sets: logged.sets.map((x) => (x.id === b1.id ? { ...x, planned: { ...x.planned, load: null } } : x)) };
    const { clock, said, controller } = rig({ startMs: ms(6), history: () => Promise.resolve([{ index: b1.index, values: values(kg(97.5), 8) }]) });
    controller.reconcile(open);
    await Promise.resolve();
    await Promise.resolve();
    clock.advanceTo(ms(70));
    const card = prefillDraft(open, b1.id, [{ index: b1.index, values: values(kg(97.5), 8) }]).values;
    expect(card.load).toEqual(kg(60));
    expect(said.at(-1)).toBe('Rest done. Set 2, Bench press, 60 kilos for 8.');
  });

  it('timer only: no set details', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(6), settings: { cueDetail: 'timer' } });
    controller.reconcile(logged);
    clock.advanceTo(ms(70));
    expect(said).toEqual(['10 seconds.', 'Rest done.']);
  });

  it('cues off, app in the background, or no module: nothing is spoken', () => {
    const { logged } = resting();
    for (const o of [{ settings: { cuesOn: false } }, { active: false }, { available: false }]) {
      const { clock, said, controller } = rig({ startMs: ms(6), ...o });
      controller.reconcile(logged);
      clock.advanceTo(ms(70));
      expect(said).toEqual([]);
    }
  });

  it('turning cues off mid-rest silences the rest end; back on, the next rest speaks', () => {
    const { logged } = resting();
    const { clock, said, env, controller } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    clock.advanceTo(ms(56));
    env.settings = { ...env.settings, cuesOn: false };
    clock.advanceTo(ms(70));
    expect(said).toEqual(['10 seconds.']);
  });

  it('after a force-close, a deadline that already passed is never spoken', () => {
    const { logged } = resting();
    // Relaunch at 2:00: the stored rest ran out at 1:05 and was never ticked.
    const { clock, said, controller } = rig({ startMs: ms(120) });
    controller.reconcile(logged);
    expect(controller.pending).toEqual([]);
    clock.advanceTo(ms(300));
    expect(said).toEqual([]);
  });

  it('relaunched mid-rest: only the cues still ahead are scheduled', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(58) });
    controller.reconcile(logged);
    clock.advanceTo(ms(70));
    expect(said).toEqual(['Rest done. Set 2, Bench press, 100 kilos for 8.']);
  });

  it('a timer that fires late (JS suspended) is dropped after timing.lateCueDrop', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    // Suspended from 0:50 to 1:20: both timers run late.
    clock.advanceTo(ms(50));
    clock.suspendUntil(ms(80));
    clock.advanceTo(ms(80));
    expect(said).toEqual([]);
  });

  it('Skip, ±30 s, Pause and Finish reschedule or drop the cues', () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(6) });
    controller.reconcile(logged);
    const timerId = logged.restTimer?.id ?? '';
    const longer = apply(logged, { type: 'adjust_rest', at: at(10), opId: 'a', timerId, deltaS: 30 });
    controller.reconcile(longer);
    clock.advanceTo(ms(70));
    expect(said).toEqual([]);
    clock.advanceTo(ms(85));
    expect(said).toEqual(['10 seconds.']);
    const paused = apply(longer, { type: 'pause', at: at(86), opId: 'p' });
    controller.reconcile(paused);
    clock.advanceTo(ms(200));
    expect(said).toEqual(['10 seconds.']);
    expect(controller.pending).toEqual([]);

    const r2 = rig({ startMs: ms(6) });
    r2.controller.reconcile(logged);
    r2.controller.reconcile(apply(logged, { type: 'skip_rest', at: at(20), opId: 's', timerId }));
    r2.clock.advanceTo(ms(200));
    expect(r2.said).toEqual([]);
  });

  it('a timed set: "10 seconds" and "Time."; short ones get no warning', () => {
    const { logged } = resting();
    const hang = setsFor(logged, HANG)[0]?.id ?? '';
    const working = apply(logged, { type: 'start_work_interval', at: at(20), opId: 'w', setId: hang, durationS: 45 });
    const { clock, said, controller } = rig({ startMs: ms(20) });
    controller.reconcile(working);
    clock.advanceTo(ms(70));
    expect(said).toEqual(['10 seconds.', 'Time.']);
    const short = apply(logged, { type: 'start_work_interval', at: at(20), opId: 'w2', setId: hang, durationS: 15 });
    expect(planCues(short).map((c) => c.kind)).toEqual(['work_end']);
  });

  it('runs behind the alert controller’s version guard: an older state never brings a cue back', async () => {
    const { logged } = resting();
    const { clock, said, controller } = rig({ startMs: ms(6) });
    const notifier: NotifierPort = { schedule: () => Promise.resolve(), cancel: () => Promise.resolve(), cancelAllWorkoutAlerts: () => Promise.resolve() };
    const alerts = createRestAlertController(notifier, { spokenCues: controller });
    // Set 2 logged at 0:20 (ends that rest, starts a 3:00 one), then a late read of the older state arrives.
    const b2 = setsFor(logged, BENCH)[1]?.id ?? '';
    const newer = apply(logged, logCmd(b2, values(kg(100), 8), 20));
    await alerts.reconcile(newer, ms(20));
    await alerts.reconcile(logged, ms(21));
    clock.advanceTo(ms(100));
    expect(said).toEqual([]);
    clock.advanceTo(ms(200));
    expect(said).toEqual(['10 seconds.', 'Rest done. Set 3, Bench press, 100 kilos for 8.']);
  });
});

describe('Settings › Voice persistence', () => {
  it('defaults: cues on with set details, replies during workouts, default voice, normal speed', () => {
    expect(DEFAULT_VOICE_PREFS).toEqual({ cuesOn: true, cueDetail: 'timer_and_set', readReplies: 'workout', voiceId: null, rate: 1 });
    expect(parsePrefs(null).voice).toEqual(DEFAULT_VOICE_PREFS);
    expect(parsePrefs('{"voice":"x"}').voice).toEqual(DEFAULT_VOICE_PREFS);
  });

  it('parses what was saved and repairs what wasn’t valid', () => {
    expect(parseVoicePrefs({ cuesOn: false, cueDetail: 'timer', readReplies: 'always', voiceId: 'com.apple.voice.premium.en-GB.Serena', rate: 1.2 })).toEqual({
      cuesOn: false,
      cueDetail: 'timer',
      readReplies: 'always',
      voiceId: 'com.apple.voice.premium.en-GB.Serena',
      rate: 1.2,
    });
    expect(parseVoicePrefs({ cueDetail: 'loud', readReplies: 'sometimes', voiceId: 7, rate: 3 })).toEqual({ ...DEFAULT_VOICE_PREFS, rate: 1.2 });
    expect(parseVoicePrefs({ rate: 0.84 }).rate).toBe(0.8);
    expect(parseVoicePrefs({ rate: 'fast' }).rate).toBe(1);
  });

  it('Off / Timer only / Timer and set details; the quick toggle keeps the detail', () => {
    const off = withCueMode(DEFAULT_VOICE_PREFS, 'off');
    expect(cueModeOf(off)).toBe('off');
    expect(cueModeOf(toggleCues(off))).toBe('timer_and_set');
    const timer = withCueMode(DEFAULT_VOICE_PREFS, 'timer');
    expect(cueModeOf(timer)).toBe('timer');
    expect(cueModeOf(toggleCues(toggleCues(timer)))).toBe('timer');
    expect(cueModeOf(toggleCues(timer))).toBe('off');
  });

  it('saved to this phone’s preferences file and read back', async () => {
    const file = { text: null as string | null, read() { return Promise.resolve(this.text); }, write(t: string) { this.text = t; return Promise.resolve(); } };
    const holder = createPrefsHolder(file, () => undefined);
    await holder.load();
    await holder.update({ voice: { ...DEFAULT_VOICE_PREFS, cuesOn: false, rate: 0.9, voiceId: 'v1' } });
    expect(parsePrefs(file.text).voice).toEqual({ ...DEFAULT_VOICE_PREFS, cuesOn: false, rate: 0.9, voiceId: 'v1' });
  });
});

describe('voices', () => {
  const raw = [
    { identifier: 'gb-compact', name: 'Daniel', language: 'en-GB', quality: 'default' },
    { identifier: 'gb-premium', name: 'Serena', language: 'en-GB', quality: 'premium' },
    { identifier: 'us-enh', name: 'Evan', language: 'en-US', quality: 'enhanced' },
    { identifier: 'au', name: 'Karen', language: 'en-AU', quality: 'default' },
    { identifier: 'fr', name: 'Thomas', language: 'fr-FR', quality: 'default' },
    { identifier: 'bells', name: 'Bells', language: 'en-US', quality: 'default', novelty: true },
    { name: 'broken' },
  ];

  it('lists voices in Ben’s language, his region first, best quality first; hides novelty voices', () => {
    const v = parseVoices(raw);
    expect(voicesForLanguage(v, 'en-GB').map((x) => x.id)).toEqual(['gb-premium', 'gb-compact', 'us-enh', 'au']);
    expect(parseVoices('nope')).toEqual([]);
  });

  it('default: best en-GB, else en-US, else the system voice', () => {
    const v = parseVoices(raw);
    expect(defaultVoice(v)?.id).toBe('gb-premium');
    expect(defaultVoice(v.filter((x) => x.language !== 'en-GB'))?.id).toBe('us-enh');
    expect(defaultVoice(v.filter((x) => !x.language.startsWith('en-GB') && x.language !== 'en-US'))).toBeNull();
  });

  it('a chosen voice removed from the phone falls back to the default and says so', () => {
    const v = parseVoices(raw);
    expect(resolveVoice(v, 'us-enh')).toEqual({ voice: v.find((x) => x.id === 'us-enh'), missing: false });
    expect(resolveVoice(v, 'gone')).toMatchObject({ voice: { id: 'gb-premium' }, missing: true });
  });

  it('the better-voices hint shows only with no Enhanced or Premium voice in the language', () => {
    const v = parseVoices(raw);
    expect(needsBetterVoiceHint(v, 'en-GB')).toBe(false);
    expect(needsBetterVoiceHint(v.filter((x) => x.quality === 'default'), 'en-GB')).toBe(true);
  });
});

describe('coach replies read aloud', () => {
  it('during workouts (default): on only over a live workout; Always; Off', () => {
    expect(readRepliesOn('workout', true)).toBe(true);
    expect(readRepliesOn('workout', false)).toBe(false);
    expect(readRepliesOn('always', false)).toBe(true);
    expect(readRepliesOn('off', true)).toBe(false);
  });

  it('the sheet’s speaker overrides for that sheet only; the setting (and the next workout’s default) is untouched (review S5)', () => {
    // Muted mid-workout: off in this sheet...
    expect(sheetReadOn('workout', true, false)).toBe(false);
    // ...and the next sheet over a workout starts from the setting again: on.
    expect(sheetReadOn('workout', true, null)).toBe(true);
    // Turned on outside a workout: on in this sheet only; the setting stays During workouts.
    expect(sheetReadOn('workout', false, true)).toBe(true);
    expect(sheetReadOn('workout', false, null)).toBe(false);
    expect(sheetReadOn('off', true, null)).toBe(false);
  });

  it('speaks a completed, new turn’s sentences only, shortened', () => {
    const items = [{ kind: 'sentence' as const, text: 'Nice set. Try 82.5 kg × 8 next. Then rest.' }, { kind: 'action_line', actionId: 'a' }];
    const open = { open: true, typing: false };
    expect(replyToSpeak({ status: 'completed', replayed: false, items }, true, open)).toBe('Nice set. Try 82 and a half kilos for 8 next.');
    expect(replyToSpeak({ status: 'completed', replayed: false, items }, false, open)).toBeNull();
    expect(replyToSpeak({ status: 'completed', replayed: true, items }, true, open)).toBeNull();
    expect(replyToSpeak({ status: 'failed', replayed: false, items }, true, open)).toBeNull();
    expect(replyToSpeak({ status: 'completed', replayed: false, items: [{ kind: 'action_line' }] }, true, open)).toBeNull();
  });

  it('a reply that arrives after the sheet closed, or while Ben is typing, is never spoken (review B2)', () => {
    const items = [{ kind: 'sentence' as const, text: 'Nice set.' }];
    const r = { status: 'completed', replayed: false, items };
    expect(replyToSpeak(r, true, { open: false, typing: false })).toBeNull();
    expect(replyToSpeak(r, true, { open: true, typing: true })).toBeNull();
    expect(replyToSpeak(r, true, { open: true, typing: false })).toBe('Nice set.');
  });

  it('a new reply stops the last one; typing or closing stops only a reply still speaking', async () => {
    const log: string[] = [];
    let finish: (() => void) | null = null;
    const voice = createReplyVoice({
      available: () => true,
      speak: (t) => {
        log.push(`speak ${t}`);
        return new Promise<void>((r) => {
          finish = r;
        });
      },
      stop: () => {
        log.push('stop');
        finish?.();
        return Promise.resolve();
      },
    });
    const first = voice.say('one');
    expect(voice.speaking).toBe(true);
    const second = voice.say('two');
    await Promise.resolve();
    await first;
    expect(log).toEqual(['speak one', 'stop', 'speak two']);
    await voice.hush();
    await second;
    expect(log).toEqual(['speak one', 'stop', 'speak two', 'stop']);
    // Nothing of ours speaking (a rest cue might be): hush doesn't stop the speaker.
    await voice.hush();
    expect(log.filter((l) => l === 'stop')).toHaveLength(2);
  });

  it('no module: nothing is spoken', async () => {
    const log: string[] = [];
    const voice = createReplyVoice({ available: () => false, speak: () => (log.push('speak'), Promise.resolve()), stop: () => Promise.resolve() });
    await voice.say('hello');
    expect(log).toEqual([]);
  });
});

/** A fake module: one queue; `stop` cancels everything (as the Swift `stop()` does). */
function fakeModule() {
  const log: string[] = [];
  const queue: { text: string; done: () => void }[] = [];
  let current: { text: string; done: () => void } | null = null;
  const next = () => {
    current = queue.shift() ?? null;
    if (current) log.push(`start ${current.text}`);
  };
  return {
    log,
    raw: {
      available: () => true,
      speak: (text: string) =>
        new Promise<void>((resolve) => {
          queue.push({ text, done: resolve });
          if (current === null) next();
        }),
      stop: () => {
        log.push('stop');
        for (const u of [current, ...queue]) if (u) { log.push(`cancel ${u.text}`); u.done(); }
        queue.length = 0;
        current = null;
        return Promise.resolve();
      },
    },
    /** The utterance speaking now finishes. */
    finish() {
      const c = current;
      if (!c) return;
      log.push(`end ${c.text}`);
      c.done();
      next();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('cues win over coach replies (review S1)', () => {
  it('a rest cue stops a reply that is speaking and speaks at once, not late behind it', async () => {
    const m = fakeModule();
    const speaker = createSpeechArbiter(m.raw);
    void speaker.speak('long reply', 'reply');
    await flush();
    void speaker.speak('Rest done.', 'cue');
    await flush();
    expect(m.log).toEqual(['start long reply', 'stop', 'cancel long reply', 'start Rest done.']);
  });

  it('typing (stop) while a cue speaks never cuts the cue; the waiting reply is dropped', async () => {
    const m = fakeModule();
    const speaker = createSpeechArbiter(m.raw);
    void speaker.speak('Rest done.', 'cue');
    await flush();
    void speaker.speak('a reply', 'reply');
    await flush();
    await speaker.stop();
    m.finish();
    await flush();
    expect(m.log).toEqual(['start Rest done.', 'end Rest done.']);
  });

  it('a reply waits for a cue to finish, then speaks; stopping it then stops only the reply', async () => {
    const m = fakeModule();
    const speaker = createSpeechArbiter(m.raw);
    void speaker.speak('10 seconds.', 'cue');
    await flush();
    void speaker.speak('a reply', 'reply');
    await flush();
    expect(m.log).toEqual(['start 10 seconds.']);
    m.finish();
    await flush();
    expect(m.log).toEqual(['start 10 seconds.', 'end 10 seconds.', 'start a reply']);
    await speaker.stop();
    expect(m.log.slice(-2)).toEqual(['stop', 'cancel a reply']);
  });

  it('stop with nothing of ours speaking never calls the module', async () => {
    const m = fakeModule();
    const speaker = createSpeechArbiter(m.raw);
    await speaker.stop();
    expect(m.log).toEqual([]);
  });

  it('the sheet’s reply voice over the arbiter: hush while a cue is queued keeps the cue', async () => {
    const m = fakeModule();
    const speaker = createSpeechArbiter(m.raw);
    const voice = createReplyVoice(speaker);
    void voice.say('Good work.');
    await flush();
    void speaker.speak('Rest done.', 'cue');
    await flush();
    await voice.hush();
    await flush();
    expect(m.log).toEqual(['start Good work.', 'stop', 'cancel Good work.', 'start Rest done.']);
  });
});

describe('quick toggle in the workout ⋯ menu', () => {
  it('shows the opposite of the setting, before Ask the coach; absent when this build can’t speak', () => {
    const base = { view: 'table' as const, paused: false, openEnded: false, ax: false, gymName: null };
    expect(workoutMenu({ ...base, cuesOn: true }).map((m) => m.label)).toContain('Turn off spoken cues');
    expect(workoutMenu({ ...base, cuesOn: false }).map((m) => m.label)).toContain('Turn on spoken cues');
    const labels = workoutMenu({ ...base, cuesOn: true }).map((m) => m.id);
    expect(labels.indexOf('cues')).toBe(labels.indexOf('coach') - 1);
    expect(workoutMenu(base).some((m) => m.id === 'cues')).toBe(false);
  });

  it('the Profile row reads the setting', () => {
    expect(voiceRowLine(DEFAULT_VOICE_PREFS, true)).toBe('Cues · Timer and set details');
    expect(voiceRowLine(toggleCues(DEFAULT_VOICE_PREFS), true)).toBe('Cues off');
    expect(voiceRowLine(DEFAULT_VOICE_PREFS, false)).toBe('Not in this build');
  });
});
