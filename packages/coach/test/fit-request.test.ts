import { describe, expect, it } from 'vitest';
import { fitShortens } from '@fizz/domain';
import { buildTodayFitRequest, type TodayFitContext } from '../src/fit';

/** The request's `Fit` / `Fill` wording follows the app's own unrounded comparison (review C S1). */
const ctx = (minutes: number, seconds: number): TodayFitContext => ({
  workout: 'Push A',
  minutes,
  estimateMinutes: Math.round(seconds / 6) / 10,
  shorten: fitShortens(minutes, seconds),
  paceSource: 'Your pace',
  goal: null,
  priorityGroups: [],
  painFlags: [],
  equipmentKinds: [],
  plan: [],
  ownExercises: [],
});
const userText = (c: TodayFitContext): string => {
  const m = buildTodayFitRequest(c, 'm').input.find((i) => i.type === 'message' && i.role === 'user');
  return m?.type === 'message' ? m.content : '';
};

describe('buildTodayFitRequest: shorten or fill', () => {
  it('46.5 min shown as ≈ 45, asked for 45: a shorten (`Fit`), with the unrounded estimate', () => {
    const c = ctx(45, 46.5 * 60);
    expect(c.shorten).toBe(true);
    expect(userText(c)).toBe('Fit today to 45 minutes.');
    const data = buildTodayFitRequest(c, 'm').input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    expect(data?.type === 'message' ? data.content : '').toContain('"estimateMinutes":46.5');
  });

  it('43.6 min shown as ≈ 45, asked for 45: a fill (`Fill`)', () => {
    const c = ctx(45, 43.6 * 60);
    expect(c.shorten).toBe(false);
    expect(userText(c)).toBe('Fill today to 45 minutes.');
  });

  it('exactly the plan length is not a shorten (the validator agrees)', () => {
    expect(fitShortens(45, 45 * 60)).toBe(false);
    expect(userText(ctx(45, 45 * 60))).toBe('Fill today to 45 minutes.');
  });
});
