import { describe, expect, it } from 'vitest';

import type { TodayControls } from '@fizz/domain';

import { followUpNext, hasOwnDraftFor, type TodayCardState } from '../src/today/today-view';

/**
 * (Ben, 28 Oct) Up next re-checks when history changes (an import committed, a past workout logged, edited or deleted,
 * an Undo of those): Today's untouched Up next card is redrafted for the new Up next day; a day Ben picked, a card he
 * changed, or a day with his own edited draft (or a coach offer he applied) keeps his choice. The service's Up next
 * after an import is covered on real SQLite in plan-progress-28oct.test.ts.
 */

const controls = (main: string, minutes = 60): TodayControls => ({ mainLiftExerciseId: main, accessories: 'focused', minutes, abs: null, supersets: true, mix: 0 });
const initial = { 'plan:p:0': controls('bench'), 'plan:p:1': controls('row'), 'plan:p:2': controls('squat') };
const card = (dayKey: string, c: TodayControls): TodayCardState => ({ dayKey, controls: c, open: false, why: false });
const base = { prevNextKey: 'plan:p:1', nextKey: 'plan:p:2', picked: false, hasOwnDraft: false, initialWas: controls('row'), initial };

describe('followUpNext', () => {
  it('an untouched Up next card follows the new Up next day, with that day’s own controls', () => {
    expect(followUpNext(card('plan:p:1', controls('row')), base)).toEqual(card('plan:p:2', controls('squat')));
  });

  it('a day Ben picked, a card he changed, or a day with his own draft keeps his choice', () => {
    const cur = card('plan:p:1', controls('row'));
    expect(followUpNext(cur, { ...base, picked: true })).toBe(cur);
    expect(followUpNext(cur, { ...base, hasOwnDraft: true })).toBe(cur);
    const changed = card('plan:p:1', controls('row', 45));
    expect(followUpNext(changed, base)).toBe(changed);
    // Showing another day than Up next (he picked it earlier): stays.
    const other = card('plan:p:0', controls('bench'));
    expect(followUpNext(other, base)).toBe(other);
  });

  it('Up next unchanged, unknown or none: the card as it is', () => {
    const cur = card('plan:p:1', controls('row'));
    expect(followUpNext(cur, { ...base, nextKey: 'plan:p:1' })).toBe(cur);
    expect(followUpNext(cur, { ...base, prevNextKey: null })).toBe(cur);
    expect(followUpNext(cur, { ...base, nextKey: null })).toBe(cur);
    expect(followUpNext(cur, { ...base, initialWas: null })).toBe(cur);
    expect(followUpNext(cur, { ...base, nextKey: 'plan:p:9' })).toBe(cur);
  });

  it('an Undo of the import moves it back the same way', () => {
    const moved = followUpNext(card('plan:p:1', controls('row')), base);
    expect(followUpNext(moved, { ...base, prevNextKey: 'plan:p:2', nextKey: 'plan:p:1', initialWas: controls('squat') })).toEqual(card('plan:p:1', controls('row')));
  });
});

describe('hasOwnDraftFor', () => {
  it('reads the edited and coach-applied drafts by day', () => {
    expect(hasOwnDraftFor('plan:p:1', { edited: { 'plan:p:1|row': {} }, nudged: {} })).toBe(true);
    expect(hasOwnDraftFor('plan:p:1', { edited: {}, nudged: { 'plan:p:1|-': {} } })).toBe(true);
    expect(hasOwnDraftFor('plan:p:1', { edited: { 'plan:p:10|x': {} }, nudged: {} })).toBe(false);
  });
});
