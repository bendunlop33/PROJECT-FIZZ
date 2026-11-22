import { describe, expect, it } from 'vitest';

import type { TargetExplanation } from '@fizz/domain';

import { whyLinkLabel, whyPanelReducer, whyRowAccessibilityLabel, type WhyPanel } from '../src/workout/target-why';

/** active-workout.md §2.12 rule 5 (AW1): one panel, one set; closes on Hide, Log, another set or the keypad. */
const explanation: TargetExplanation = {
  setId: 's1',
  setVersion: 1,
  recorded: true,
  rows: [{ key: 'set_by', label: 'Set by', lines: ['Built-in rule · after Push A, 1 Oct'], kind: 'app' }],
  basisEdited: null,
};

const open = (setId: string): WhyPanel => whyPanelReducer(whyPanelReducer(null, { kind: 'toggle', setId }), { kind: 'loaded', setId, explanation });

describe('Why? panel rules', () => {
  it('Why? opens it for that set (loading, then the rows); Hide closes it', () => {
    const loading = whyPanelReducer(null, { kind: 'toggle', setId: 's1' });
    expect(loading).toEqual({ setId: 's1', status: 'loading' });
    expect(whyPanelReducer(loading, { kind: 'loaded', setId: 's1', explanation })).toEqual({ setId: 's1', status: 'ready', explanation });
    expect(whyPanelReducer(open('s1'), { kind: 'toggle', setId: 's1' })).toBeNull();
  });

  it('a failed read says so rather than showing nothing or guessing', () => {
    const loading = whyPanelReducer(null, { kind: 'toggle', setId: 's1' });
    expect(whyPanelReducer(loading, { kind: 'loaded', setId: 's1', explanation: null })).toEqual({ setId: 's1', status: 'failed' });
  });

  it('closes on Log, on the keypad, and when another set becomes active; stays when the same set re-renders', () => {
    expect(whyPanelReducer(open('s1'), { kind: 'logged' })).toBeNull();
    expect(whyPanelReducer(open('s1'), { kind: 'keypad_opened' })).toBeNull();
    expect(whyPanelReducer(open('s1'), { kind: 'active_set', setId: 's2' })).toBeNull();
    expect(whyPanelReducer(open('s1'), { kind: 'active_set', setId: null })).toBeNull();
    expect(whyPanelReducer(open('s1'), { kind: 'active_set', setId: 's1' })).toEqual(open('s1'));
  });

  it('one at a time: Why? on another set moves it there; a late answer for a closed or other panel is dropped', () => {
    expect(whyPanelReducer(open('s1'), { kind: 'toggle', setId: 's2' })).toEqual({ setId: 's2', status: 'loading' });
    expect(whyPanelReducer(null, { kind: 'loaded', setId: 's1', explanation })).toBeNull();
    const other = whyPanelReducer(null, { kind: 'toggle', setId: 's2' });
    expect(whyPanelReducer(other, { kind: 'loaded', setId: 's1', explanation })).toEqual(other);
    expect(whyPanelReducer(open('s1'), { kind: 'loaded', setId: 's1', explanation: null })).toEqual(open('s1'));
  });

  it('VoiceOver: the link and each row read as words', () => {
    expect(whyLinkLabel(false)).toBe('Why this number?');
    expect(whyLinkLabel(true)).toBe('Hide explanation');
    expect(whyRowAccessibilityLabel({ key: 'set_by', label: 'Set by', lines: ['Built-in rule · after Push A, 1 Oct'], kind: 'app' })).toBe('Set by: Built-in rule, after Push A, 1 Oct');
    expect(whyRowAccessibilityLabel({ key: 'last_time', label: 'Last time', lines: ['100 kg × 8, 8', '1 Oct · Main Gym'], kind: 'actual' })).toBe('Last time (what you did): 100 kg × 8, 8. 1 Oct, Main Gym');
    expect(whyRowAccessibilityLabel({ key: 'swapped', label: null, lines: ['Swapped before start · Bench press'], kind: 'app' })).toBe('Swapped before start, Bench press');
  });
});
