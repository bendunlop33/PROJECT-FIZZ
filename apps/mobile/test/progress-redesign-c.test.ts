import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_DAY_HEX, type FeedItem } from '@fizz/domain';

import { historyFeedFrom, historyTitle, historyView } from '../src/history/history-view';
import { barLook, markHex, tileLook } from '../src/progress/training-view';
import type { HistoryFeed } from '../src/services/history-services';
import type { RepeatCandidate } from '../src/services/workout-services';

/**
 * Redesign v3 C (Ben, 27 Oct): Progress is `Lifts | Training | Body` under one period bar, with `All workouts` top
 * right; Training's Month calendar; History becomes All workouts. View logic is pure; the screens only lay it out.
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('tileLook / markHex / barLook (C3, C4)', () => {
  it('light green with anything logged, the plain tile otherwise, no fill (faded, edged) in the future', () => {
    expect(tileLook({ state: 'done', isToday: false }, false)).toMatchObject({ fill: 'status.done.subtle', border: null, faded: false });
    expect(tileLook({ state: 'empty', isToday: false }, false)).toMatchObject({ fill: 'bg.surface', border: null });
    expect(tileLook({ state: 'future', isToday: false }, false)).toMatchObject({ fill: null, border: 'bg.surface', borderWidth: 1, day: 'text.tertiary', faded: true });
  });
  it('today outlined; a busy day showing its list in the accent', () => {
    expect(tileLook({ state: 'done', isToday: true }, false)).toMatchObject({ border: 'text.primary', borderWidth: 1.5 });
    expect(tileLook({ state: 'done', isToday: true }, true)).toMatchObject({ border: 'accent', borderWidth: 2 });
  });
  it('dots take the theme mode’s hex; a ring has none (an outline)', () => {
    expect(markHex({ kind: 'dot', colour: 'orange' }, 'dark')).toBe(PLAN_DAY_HEX.orange.dark);
    expect(markHex({ kind: 'dot', colour: 'neutral' }, 'light')).toBe(PLAN_DAY_HEX.neutral.light);
    expect(markHex({ kind: 'ring' }, 'dark')).toBeNull();
  });
  it('bars: height against the max, under-aim weeks greyed, an empty week a sliver', () => {
    expect(barLook({ count: 3, underAim: false }, 3)).toEqual({ height: 1, fill: 'accent' });
    expect(barLook({ count: 1, underAim: true }, 4)).toEqual({ height: 0.25, fill: 'text.tertiary' });
    expect(barLook({ count: 0, underAim: null }, 3).height).toBeGreaterThan(0);
  });
});

function item(date: string, kind: 'workout' | 'activity', id: string): FeedItem {
  const base = { key: `${kind[0] ?? 'x'}:${id}`, localDate: date, sortMs: Date.parse(`${date}T12:00:00Z`), when: date, title: 'Push', value: '50 min', accessibilityLabel: id };
  return kind === 'workout' ? { ...base, kind, sessionId: id, source: 'manual' } : { ...base, kind, activityId: id, source: 'ben' };
}

describe('History becomes All workouts (C6), and one month’s list (C3)', () => {
  const feed: HistoryFeed = {
    today: '2026-10-27',
    from: '2026-09-28',
    items: [item('2026-10-26', 'workout', 's2'), item('2026-10-12', 'activity', 'a1'), item('2026-09-30', 'workout', 's1')],
    workouts: { s1: { sessionId: 's1' } as RepeatCandidate, s2: { sessionId: 's2' } as RepeatCandidate },
    unreadable: 0,
    olderFrom: '2026-09-21',
  };
  it('titled All workouts; a month list is named for its month (with the year when not this year)', () => {
    expect(historyTitle(null, '2026-10-27')).toBe('All workouts');
    expect(historyTitle('2026-10', '2026-10-27')).toBe('October workouts');
    expect(historyTitle('2025-12', '2026-10-27')).toBe('December 2025 workouts');
  });
  it('a month list reads from the Monday on or before its 1st and lists only that month, with no Show more', () => {
    expect(historyFeedFrom('2026-10', undefined)).toBe('2026-09-28');
    expect(historyFeedFrom(null, '2026-08-03')).toBe('2026-08-03');
    const v = historyView(feed, 'all', false, '2026-10');
    expect(v.weeks.flatMap((w) => w.items.map((i) => i.key))).toEqual(['w:s2', 'a:a1']);
    expect(v.more).toBe(false);
    expect(v.selectable.map((r) => r.sessionId)).toEqual(['s2']);
    const all = historyView(feed, 'all', false);
    expect(all.more).toBe(true);
    expect(all.weeks.flatMap((w) => w.items)).toHaveLength(3);
    expect(historyView(feed, 'activities', false, '2026-09').empty).toBe('No activities yet.');
  });
});

describe('Progress screen structure (C1, C2, C5)', () => {
  const screen = code(read('screens', 'progress', 'ProgressScreen.tsx'));
  const training = code(read('screens', 'progress', 'TrainingTab.tsx'));
  const bar = code(read('progress', 'PeriodBar.tsx'));
  const nav = read('navigation', 'AppNavigator.tsx');

  it('C1: `Progress` and `All workouts` top right on every tab, opening the list inside Progress', () => {
    expect(screen).toContain('label="All workouts"');
    expect(screen).toContain("screen: 'ProgressHistory'");
    expect(nav).toContain('name="ProgressHistory" component={HistoryScreen}');
    expect(nav).toContain("headerBackTitle: 'Progress'");
  });

  it('C2: tabs `Lifts | Training | Body` and one period bar every tab follows; Month by default', () => {
    expect(screen).toContain("{ key: 'lifts', label: 'Lifts' }");
    expect(screen).toContain("{ key: 'training', label: 'Training' }");
    expect(screen).toContain("{ key: 'body', label: 'Body' }");
    expect(screen).toContain("useState<PeriodChoice>({ span: 'month', offset: 0 })");
    expect(screen).toContain('<PeriodBar bar={bar} onSpan={onSpan} onStep={onStep} />');
    expect(screen).toContain('shared={{ period: bar.preset, range: dates }}');
    expect(screen).toContain('<BodyweightCard active={tab === \'body\'} window={dates} />');
    expect(screen).toContain('<HealthTrends window={dates} />');
    expect(screen).toContain('choice={choice}');
    expect(bar).toContain('PERIOD_SPANS');
    expect(bar).toContain("accessibilityLabel={by < 0 ? 'Previous period' : 'Next period'}");
  });

  it('C5: no Overview tab, no This week card, no Coach’s changes, no Calendar segment, no period dropdown on Progress', () => {
    for (const gone of ['ReviewsSection', 'Overview', "'overview'", 'CalendarView', "label: 'Calendar'", 'PeriodPicker', 'ChangesSection', 'WeekCard']) {
      expect(screen, gone).not.toContain(gone);
      expect(training, gone).not.toContain(gone);
    }
  });

  it('C3: the month list row, totals, Consistency then Muscles · sets, in that order', () => {
    const at = (s: string) => training.indexOf(s);
    expect(at('view.month.workouts.label')).toBeGreaterThan(0);
    expect(at('<StatStrip items={view.totals')).toBeGreaterThan(at('view.month.workouts.label'));
    expect(at('<ConsistencyCard')).toBeGreaterThan(at('<StatStrip items={view.totals'));
    expect(at('<Muscles')).toBeGreaterThan(at('<ConsistencyCard'));
    expect(training).toContain('MUSCLES · SETS');
    expect(training).toContain('<Legend items={view.legend} />');
  });
});
