import { describe, expect, it } from 'vitest';

import { finishMotion, listEnterMotion, logHaptic, pressFeedback, rowsToAnimate, screenAnimation, shouldPlayFinish, swapMotion, timerGlyphs } from '../src/theme/motion';
import { HAPTICS, MOTION, tokenNames } from '../src/theme/tokens';

/** premium-feel.md §4–§6: what each motion becomes, with and without Reduce Motion. */
describe('motion', () => {
  it('press: primary 0.97, pills 0.95, text fades; no scale under Reduce Motion (acceptance 13)', () => {
    expect(pressFeedback('primary', false)).toEqual({ scale: 0.97, opacity: 1 });
    expect(pressFeedback('pill', false)).toEqual({ scale: 0.95, opacity: 1 });
    expect(pressFeedback('text', false)).toEqual({ scale: 1, opacity: 0.55 });
    expect(pressFeedback('row', false)).toEqual({ scale: 1, opacity: 1 });
    for (const k of ['primary', 'pill', 'text', 'row'] as const) expect(pressFeedback(k, true).scale).toBe(1);
    expect(pressFeedback('text', true).opacity).toBe(0.55);
  });

  it('swap: 180 ms with an 8 pt rise; a 150 ms plain fade under Reduce Motion', () => {
    expect(swapMotion(false)).toEqual({ durationMs: 180, delayMs: 0, risePt: 8 });
    expect(swapMotion(true)).toEqual({ durationMs: 150, delayMs: 0, risePt: 0 });
  });

  it('list enter: 35 ms stagger capped at 6 rows; at once under Reduce Motion', () => {
    expect(listEnterMotion(0, false)).toEqual({ durationMs: 160, delayMs: 0, risePt: 6 });
    expect(listEnterMotion(2, false)?.delayMs).toBe(70);
    expect(listEnterMotion(5, false)?.delayMs).toBe(175);
    expect(listEnterMotion(12, false)?.delayMs).toBe(175);
    expect(listEnterMotion(0, true)).toBeNull();
  });

  it('rows animate only when added after the first draw', () => {
    expect(rowsToAnimate(new Set(), ['a', 'b'], true)).toEqual([]);
    expect(rowsToAnimate(new Set(['a', 'b']), ['a', 'b', 'c'], false)).toEqual(['c']);
    expect(rowsToAnimate(new Set(['a', 'b']), ['b', 'a'], false)).toEqual([]);
  });

  it('countdown: only changed glyphs fade; a length change or ±30 s fades the whole numeral; Reduce Motion swaps instantly (acceptance 14)', () => {
    expect(timerGlyphs('1:21', '1:20', { reduceMotion: false }).map((g) => g.changed)).toEqual([false, false, false, true]);
    expect(timerGlyphs('1:00', '0:59', { reduceMotion: false }).map((g) => g.changed)).toEqual([true, false, true, true]);
    expect(timerGlyphs('10:00', '9:59', { reduceMotion: false }).every((g) => g.changed)).toBe(true);
    expect(timerGlyphs('1:21', '1:51', { reduceMotion: false, whole: true }).every((g) => g.changed)).toBe(true);
    expect(timerGlyphs('1:21', '1:20', { reduceMotion: true }).some((g) => g.changed)).toBe(false);
    expect(timerGlyphs(null, '1:20', { reduceMotion: false }).some((g) => g.changed)).toBe(false);
    expect(timerGlyphs('1:20', '1:20', { reduceMotion: false, whole: true }).some((g) => g.changed)).toBe(false);
    expect(timerGlyphs('1:21', '1:20', { reduceMotion: false }).map((g) => g.char).join('')).toBe('1:20');
  });

  it('finish: the check draws for 420 ms, then the title; static under Reduce Motion (acceptance 18)', () => {
    expect(finishMotion(false)).toEqual({ strokeMs: 420, titleFadeMs: 200, titleDelayMs: 120 });
    expect(finishMotion(true)).toEqual({ strokeMs: 0, titleFadeMs: 0, titleDelayMs: 0 });
  });

  it('screens: Workout slides (fade under Reduce Motion); Summary always fades in 200 ms', () => {
    expect(screenAnimation('Workout', false)).toEqual({ animation: 'default' });
    expect(screenAnimation('Workout', true)).toEqual({ animation: 'fade', animationDuration: 200 });
    expect(screenAnimation('Summary', false)).toEqual({ animation: 'fade', animationDuration: 200 });
    expect(screenAnimation('Summary', true)).toEqual({ animation: 'fade', animationDuration: 200 });
  });

  it('haptics: a record log plays only the record haptic; finish once, only for a finished workout (acceptance 16)', () => {
    expect(logHaptic(false)).toBe('commit');
    expect(logHaptic(true)).toBe('record');
    const base = { sessionStatus: 'finished' as const, justFinished: true, played: new Set<string>(), sessionId: 's1' };
    expect(shouldPlayFinish(base)).toBe(true);
    expect(shouldPlayFinish({ ...base, played: new Set(['s1']) })).toBe(false);
    expect(shouldPlayFinish({ ...base, justFinished: false })).toBe(false);
    expect(shouldPlayFinish({ ...base, sessionStatus: 'discarded' })).toBe(false);
    expect(HAPTICS.record).toBeDefined();
    expect(HAPTICS.finish).toBeDefined();
  });

  it('only the finish token is over 200 ms (design-system principle 5 exception, Ben to approve)', () => {
    const over = Object.entries(MOTION).filter(([, v]) => Object.entries(v).some(([k, n]) => k.endsWith('Ms') && typeof n === 'number' && n > 200));
    expect(over.map(([k]) => k)).toEqual(['finish']);
    expect(tokenNames()).toContain('motion.swap');
  });
});
