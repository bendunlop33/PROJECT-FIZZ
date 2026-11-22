import { describe, expect, it } from 'vitest';
import {
  adjustRestTimer,
  createRestTimer,
  endRestTimer,
  expireRestTimerIfDue,
  pauseRestTimer,
  resolveRestPreset,
  restOverrunMs,
  restRemainingMs,
  resumeRestTimer,
  toMs,
} from '../src/index';
import { id, ms } from './fixtures';

const global = { seconds: 90, presetName: 'Standard' };

describe('resolveRestPreset', () => {
  const base = {
    setType: 'working' as const,
    exerciseName: 'Bench press',
    setOverrideS: null,
    routineSetTypePreset: null,
    exerciseDefaultS: null,
    globalDefault: global,
  };

  it('falls back to the global default', () => {
    expect(resolveRestPreset(base)).toEqual({ seconds: 90, source: 'global_default', sourceLabel: 'Standard (default)' });
  });

  it('exercise default beats global', () => {
    expect(resolveRestPreset({ ...base, exerciseDefaultS: 120 })).toMatchObject({ seconds: 120, source: 'exercise_default' });
  });

  it('routine set-type preset beats exercise default, with a readable label', () => {
    const r = resolveRestPreset({
      ...base,
      exerciseDefaultS: 120,
      routineSetTypePreset: { seconds: 180, presetName: 'Heavy' },
    });
    expect(r).toEqual({ seconds: 180, source: 'routine_set_type', sourceLabel: 'Heavy preset (Bench press, working sets)' });
  });

  it('explicit set override wins over everything, including zero', () => {
    const r = resolveRestPreset({
      ...base,
      setOverrideS: 0,
      exerciseDefaultS: 120,
      routineSetTypePreset: { seconds: 180 },
    });
    expect(r).toMatchObject({ seconds: 0, source: 'set_override' });
  });

  it('warm-ups and working sets resolve differently from the same routine exercise', () => {
    const presets = { warmup: { seconds: 60, presetName: 'Warm-up' }, working: { seconds: 180, presetName: 'Heavy' } };
    const warm = resolveRestPreset({ ...base, setType: 'warmup', routineSetTypePreset: presets.warmup });
    const work = resolveRestPreset({ ...base, setType: 'working', routineSetTypePreset: presets.working });
    expect(warm.seconds).toBe(60);
    expect(work.seconds).toBe(180);
    expect(warm.sourceLabel).toBe('Warm-up preset (Bench press, warm-up sets)');
  });
});

describe('rest timer math', () => {
  const timer = () =>
    createRestTimer({ id: id(1), sessionId: id(2), setId: id(3), kind: 'rest', durationS: 180, source: 'routine_set_type', nowMs: ms(0) });

  it('computes remaining time from the deadline', () => {
    const t = timer();
    expect(t.deadlineUtc).toBe('2026-10-08T06:03:00.000Z');
    expect(restRemainingMs(t, ms(60))).toBe(120_000);
    expect(restRemainingMs(t, ms(500))).toBe(0);
  });

  it('+30 s extends the deadline and bumps the version', () => {
    const t = adjustRestTimer(timer(), 30, ms(160));
    expect(restRemainingMs(t, ms(160))).toBe(50_000);
    expect(t.version).toBe(2);
    expect(t.status).toBe('running');
  });

  it('-30 s with 20 s left clamps to zero and ends as expired (not skipped)', () => {
    const t = adjustRestTimer(timer(), -30, ms(160));
    expect(t.status).toBe('expired');
    expect(restRemainingMs(t, ms(160))).toBe(0);
    expect(t.endedAtUtc).toBe('2026-10-08T06:02:40.000Z');
  });

  it('pause freezes the remaining time and resume restores it from now', () => {
    const paused = pauseRestTimer(timer(), ms(110)); // 1:10 left
    expect(paused.status).toBe('paused');
    expect(restRemainingMs(paused, ms(110))).toBe(70_000);
    expect(restRemainingMs(paused, ms(230))).toBe(70_000); // frozen during the pause
    const resumed = resumeRestTimer(paused, ms(230));
    expect(restRemainingMs(resumed, ms(230))).toBe(70_000);
    expect(toMs(resumed.deadlineUtc)).toBe(ms(300));
  });

  it('expiry marks the deadline as the end time, not the observation time', () => {
    const t = expireRestTimerIfDue(timer(), ms(400));
    expect(t.status).toBe('expired');
    expect(t.endedAtUtc).toBe('2026-10-08T06:03:00.000Z');
    expect(restOverrunMs(t, ms(400))).toBe(220_000);
    expect(expireRestTimerIfDue(timer(), ms(100))).toEqual(timer());
  });

  it('skip and early end record the reason', () => {
    expect(endRestTimer(timer(), 'skipped', ms(10)).status).toBe('skipped');
    expect(endRestTimer(timer(), 'ended_early', ms(10)).status).toBe('ended_early');
    expect(restRemainingMs(endRestTimer(timer(), 'skipped', ms(10)), ms(10))).toBe(0);
  });
});
