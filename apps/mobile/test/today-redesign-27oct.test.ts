import { describe, expect, it } from 'vitest';

import { buildWeekTiles, NBSP, workoutListTargetLines, type FeedItem, type WorkoutListRow } from '@fizz/domain';

import { progressPalette } from '../src/reviews/palette';
import { PREMIUM_DIRECTION, resolveTheme } from '../src/theme/tokens';
import { ACTIVITY_COLOUR, markStyle, PLAN_DAY_COLOURS, TILE_LAYOUT, tileStyle } from '../src/today/tile-style';
import { daySheetRows, daySheetTitle, doneCardRows, plannedDayDetail, todayCardLabel, todayCardRows, todayDateLine, todayRecentRows } from '../src/today/today-view';

/**
 * Redesign v3 (Ben, 27 Oct; docs/design/redesign-27oct.md §A, options B and C): Today's pure view rules. The screen only
 * lays these out.
 */

const plain = (t: string) => t.replaceAll(NBSP, ' ');
const row = (over: Partial<WorkoutListRow>): WorkoutListRow => ({ key: 'k', exerciseId: 'e', name: 'Bench press', fullName: 'Bench press', main: false, sets: '3 × 8', target: '80', coach: null, superset: null, held: false, accessibilityLabel: '', ...over });

describe('the card (option C)', () => {
  const view = { list: [row({ main: true, fullName: 'Barbell bench press' }), row({})], exerciseCount: 5, minutes: 47, time: { minutes: 45 }, leftOut: 0 };
  it('`Up next` on the plan’s next day; `Today` when Ben picked another', () => {
    expect(todayCardLabel('push', 'push')).toBe('Up next');
    expect(todayCardLabel('pull', 'push')).toBe('Today');
    expect(todayCardLabel('push', null)).toBe('Up next');
  });
  it('rows: Main lift, Exercises, Est. time (the live estimate), Gym', () => {
    expect(todayCardRows(view, 'Main Gym').map((r) => [r.label, plain(r.value), r.note ?? null])).toEqual([
      ['Main lift', 'Barbell bench press', null],
      ['Exercises', '5', null],
      ['Est. time', '45 min', null],
      ['Gym', 'Main Gym', null],
    ]);
  });
  it('`Exercises  5 (1 left out)` only when Time left one out; no main lift: no row', () => {
    const rows = todayCardRows({ ...view, list: [row({})], leftOut: 1 });
    expect(rows.map((r) => r.label)).toEqual(['Exercises', 'Est. time']);
    expect(rows[0]?.note).toBe('(1 left out)');
  });
  it('done card: Time and New best (none: no row; a date-only workout: no time)', () => {
    expect(doneCardRows(47 * 60_000, 1).map((r) => [r.label, plain(r.value)])).toEqual([
      ['Time', '47 min'],
      ['New best', '1'],
    ]);
    expect(doneCardRows(null, 0)).toEqual([]);
  });
  it('a planned day’s line: `Back squat · 5 exercises · 45 min`', () => {
    expect(plain(plannedDayDetail({ ...view, list: [row({ main: true, fullName: 'Back squat' })] }))).toBe('Back squat · 5 exercises · 45 min');
  });
  it('the header’s date line and a day sheet’s title', () => {
    expect(todayDateLine('2026-10-27T08:00:00.000Z', 'Europe/London')).toBe('27 October');
    expect(daySheetTitle('2026-10-26')).toBe('Mon 26 Oct');
  });
  it('the WorkoutList’s target header is two short lines', () => {
    expect(workoutListTargetLines('Target kg')).toEqual(['Target', 'kg']);
    expect(workoutListTargetLines('Target kg ea')).toEqual(['Target', 'kg ea']);
  });
});

const workout = (key: string, sessionId: string, title: string, value: string): FeedItem => ({ key, kind: 'workout', sessionId, source: 'manual', localDate: '2026-10-26', sortMs: 2, when: 'Mon 26 Oct', title, value, accessibilityLabel: `Monday 26 October, ${title}, ${value}` });
const activity = (key: string, activityId: string, fromHealth?: string): FeedItem => ({ key, kind: 'activity', activityId, source: 'ben', localDate: '2026-10-26', sortMs: 1, when: 'Mon 26 Oct', title: 'Run', value: '5.2 km · 28 min', accessibilityLabel: 'Monday 26 October, Run, 5.2 km · 28 min', ...(fromHealth === undefined ? {} : { fromHealth }) });

describe('a tapped day and Recent (Ben, 27 Oct)', () => {
  const feed = [workout('w:s1', 's1', 'Pull', '54 min · 17 sets'), activity('a:a1', 'a1', 'Garmin')];
  const tiles = buildWeekTiles({
    today: '2026-10-27',
    workouts: [{ sessionId: 's1', localDate: '2026-10-26', title: 'Pull' }],
    activities: [{ activityId: 'a1', localDate: '2026-10-26', kind: 'run', status: 'done', distanceM: 5200, durationS: 1680, effort: null }],
    plannedDays: [{ localDate: '2026-10-29', name: 'Legs' }],
    chosen: 'Push',
  });
  it('done day: the workout (→ Summary) and the activity (→ it), with History’s values; ♥ for Health’s', () => {
    const rows = daySheetRows(tiles[0] ?? { items: [], marks: [] }, feed, () => null);
    expect(rows.map((r) => [r.title, r.detail, r.health, r.open?.kind ?? null, r.mark.shape])).toEqual([
      ['Pull', '54 min · 17 sets', false, 'summary', 'dot'],
      ['Run', '5.2 km · 28 min', true, 'activity', 'ring'],
    ]);
    expect(rows[1]?.accessibilityLabel).toContain('from Apple Health');
  });
  it('planned day: `Legs · planned` with its card’s line, opening the plan day; empty day: no rows (no sheet)', () => {
    const rows = daySheetRows(tiles[3] ?? { items: [], marks: [] }, feed, (name) => (name === 'Legs' ? 'Back squat · 5 exercises · 45 min' : null));
    expect(rows).toMatchObject([{ title: 'Legs · planned', detail: 'Back squat · 5 exercises · 45 min', open: { kind: 'plan_day', dayName: 'Legs' } }]);
    expect(daySheetRows(tiles[2] ?? { items: [], marks: [] }, feed, () => null)).toEqual([]);
  });
  it('Recent: the last three, `Mon 26 · 54 min · 17 sets`, led by the tile marker', () => {
    const many = [...feed, workout('w:s2', 's2', 'Legs', '58 min'), workout('w:s3', 's3', 'Push', '50 min')];
    const rows = todayRecentRows(many);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.title, r.line, r.mark.shape, r.mark.colour, r.health])).toEqual([
      ['Pull', 'Mon 26 · 54 min · 17 sets', 'dot', 'pull', false],
      ['Run', 'Mon 26 · 5.2 km · 28 min', 'ring', 'activity', true],
      ['Legs', 'Mon 26 · 58 min', 'dot', 'legs', false],
    ]);
  });
});

describe('tile style (option B)', () => {
  for (const scheme of ['dark', 'light'] as const) {
    const theme = resolveTheme(PREMIUM_DIRECTION, scheme);
    it(`${scheme}: done green, planned outlined, today outlined 1.5 pt in the primary text colour`, () => {
      const pal = progressPalette(theme);
      expect(tileStyle({ state: 'done', today: false, past: true }, theme)).toMatchObject({ backgroundColor: pal.doneFill, borderWidth: 0 });
      expect(tileStyle({ state: 'planned', today: false, past: false }, theme)).toMatchObject({ backgroundColor: 'transparent', borderWidth: 1 });
      expect(tileStyle({ state: 'planned', today: true, past: false }, theme)).toMatchObject({ borderWidth: TILE_LAYOUT.todayBorder, borderColor: theme.colors['text.primary'] });
      expect(markStyle({ shape: 'dot', colour: 'push', planned: false }, theme)).toMatchObject({ backgroundColor: PLAN_DAY_COLOURS.push[scheme], borderWidth: 0 });
      expect(markStyle({ shape: 'ring', colour: 'activity', planned: false }, theme)).toMatchObject({ backgroundColor: 'transparent', borderColor: ACTIVITY_COLOUR[scheme] });
    });
  }
  it('≈64 pt tiles, 7 pt gaps, 11 pt letter, 15 pt date', () => {
    expect(TILE_LAYOUT).toMatchObject({ height: 64, gap: 7, letterSize: 11, dateSize: 15 });
  });
});
