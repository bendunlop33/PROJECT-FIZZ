import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NBSP, setGlance, setNavigation, type SetGlance, type SetNavigation } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { awayPrimary, claimsDrag, nextViewing, pagerView, swipeIntent, SWIPE_MIN_DX, type PrimaryKind } from '../src/workout/set-pager';

/** F7 / F8 (Ben, build 151): viewing other sets from Focus and rest, and the rest screen's two blocks. */

const nav = (o: Partial<SetNavigation> = {}): SetNavigation => ({ shownSetId: 'b', atCurrent: true, prevSetId: 'a', nextSetId: 'c', position: 2, total: 3, currentSetId: 'b', ...o });

const glance = (o: Partial<SetGlance> = {}): SetGlance => ({
  setId: 'b',
  setVersion: 1,
  sessionExerciseId: 'ex',
  exerciseName: 'Bench press',
  setNumber: 2,
  setCount: 3,
  setType: 'working',
  setTypeLabel: 'Working',
  status: 'pending',
  isCurrent: true,
  value: `100${NBSP}kg × 6–8`,
  effort: null,
  accessibilityLabel: 'Bench press, set 2 of 3',
  ...o,
});

describe('swipe', () => {
  it('left is the next set, right the previous; short or mostly vertical drags are neither (scrolling still works)', () => {
    expect(swipeIntent(-SWIPE_MIN_DX - 1, 5)).toBe('next');
    expect(swipeIntent(SWIPE_MIN_DX + 1, -5)).toBe('prev');
    expect(swipeIntent(-20, 0)).toBeNull();
    expect(swipeIntent(-60, 80)).toBeNull();
    expect(claimsDrag(30, 4)).toBe(true);
    expect(claimsDrag(10, 40)).toBe(false);
  });
});

describe('nextViewing: viewing never changes what Log logs', () => {
  it('‹ › move the viewed set; arriving back at the current set is the same as Now', () => {
    expect(nextViewing(nav(), { kind: 'next' })).toBe('c');
    expect(nextViewing(nav(), { kind: 'prev' })).toBe('a');
    expect(nextViewing(nav({ shownSetId: 'c', atCurrent: false, prevSetId: 'b', nextSetId: null }), { kind: 'prev' })).toBeNull();
    // At the end there's nowhere to go: it stays.
    expect(nextViewing(nav({ shownSetId: 'c', atCurrent: false, prevSetId: 'b', nextSetId: null }), { kind: 'next' })).toBe('c');
  });

  it('Now, a Log and Make current come back to the current set', () => {
    for (const kind of ['now', 'logged', 'made_current'] as const) expect(nextViewing(nav({ shownSetId: 'c', atCurrent: false }), { kind })).toBeNull();
  });
});

describe('pagerView', () => {
  it('the current set: title, type and Now; no Make current', () => {
    expect(pagerView(nav(), glance())).toMatchObject({ title: 'Bench press · Set 2 of 3', detail: 'Working · Now', canPrev: true, canNext: true, away: false, canMakeCurrent: false, canEdit: true });
  });

  it('another set not done yet: Make current and Now; a done one: Edit only; a skipped one: nothing to edit', () => {
    expect(pagerView(nav({ shownSetId: 'c', atCurrent: false }), glance({ setId: 'c', isCurrent: false }))).toMatchObject({ detail: 'Working', away: true, canMakeCurrent: true });
    expect(pagerView(nav({ shownSetId: 'a', atCurrent: false }), glance({ setId: 'a', isCurrent: false, status: 'done', setTypeLabel: 'Warm-up' }))).toMatchObject({ detail: 'Warm-up · Done', canMakeCurrent: false, canEdit: true });
    expect(pagerView(nav({ shownSetId: 'a', atCurrent: false }), glance({ status: 'skipped', isCurrent: false }))?.canEdit).toBe(false);
  });

  it('every set done: no Now to go back to', () => {
    expect(pagerView(nav({ currentSetId: null, atCurrent: false }), glance({ status: 'done', isCurrent: false }))?.away).toBe(false);
    expect(pagerView(nav(), null)).toBeNull();
  });

  it('works with the domain’s own navigation and glance', () => {
    const empty = { exercises: [], sets: [], session: { activeSetId: null, equipmentSnapshot: [] } } as unknown as SessionAggregate;
    const n = setNavigation(empty, null);
    expect(n).toMatchObject({ shownSetId: null, total: 0 });
    expect(pagerView(n, n.shownSetId === null ? null : setGlance(empty, n.shownSetId))).toBeNull();
  });
});

describe('awayPrimary: viewing another set never leaves Log live for values not on screen (review B2)', () => {
  it('away, Log / Enter / Start become Back to Set N; at the current set they stay', () => {
    for (const kind of ['log', 'enter', 'start_work'] as const) {
      expect(awayPrimary(kind, true, 2)).toEqual({ kind: 'back', label: 'Back to Set 2' });
      expect(awayPrimary(kind, false, 2)).toEqual({ kind: 'as_is' });
    }
  });
  it('Stop, Resume, Add exercise, Finish and Done don’t depend on the viewed set', () => {
    const others: PrimaryKind[] = ['stop_work', 'resume', 'add_exercise', 'finish', 'none'];
    for (const kind of others) expect(awayPrimary(kind, true, 2)).toEqual({ kind: 'as_is' });
  });
  it('Back goes to the current set (Now)', () => {
    expect(nextViewing(nav({ shownSetId: 'c', atCurrent: false }), { kind: 'now' })).toBeNull();
  });
});

describe('screens wire it (source checks; swipe feel and layout need a real iPhone)', () => {
  const SRC = join(__dirname, '..', 'src', 'screens', 'workout');
  const screen = readFileSync(join(SRC, 'WorkoutScreen.tsx'), 'utf8');
  const pager = readFileSync(join(SRC, 'SetPager.tsx'), 'utf8');
  it('rest shows Last set and Next under the timer, in Focus and in the full rest view', () => {
    expect(screen.match(/\{restBlocks\}/g)?.length).toBe(2);
    expect(pager).toContain('<Eyebrow>Last set</Eyebrow>');
    expect(screen).toContain("'Last set · Effort'");
  });
  it('the pager has 52 pt ‹ › buttons (design pass) and a Table button; Log still logs the current set', () => {
    expect(pager).toMatch(/width: 52, height: 52/);
    expect(pager).toContain('label="Table"');
    const log = screen.slice(screen.indexOf('async function log()'), screen.indexOf("type: 'log_set'") + 200);
    expect(log).toContain('setId: focus.setId');
    expect(log).not.toContain('viewing');
  });
  it('while away the bar is Back (also over the Table pill); the set card and the viewed card swipe too (B2, S3)', () => {
    expect(screen).toContain('awayPrimary(view.primary.kind, away,');
    expect(screen).toContain("pill === null || back.kind === 'back' ? primary");
    expect(screen.match(/<Swipeable onSwipe=\{movePager\}/g)?.length).toBe(2);
  });
  it('the current set opens Edit set: its Focus row is tappable and ⋯ has Edit set (B1)', () => {
    expect(screen).toContain("const tappable = status !== 'skipped';");
    expect(screen).toContain("if (action === 'edit_set') editSet(f.setId);");
    expect(screen).toContain("if (action === 'edit_set' && next !== null) editSet(next.id);");
    expect(screen.match(/canEditSet: /g)?.length).toBe(2);
  });
});
