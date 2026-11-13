import { describe, expect, it } from 'vitest';

import type { SessionAggregate } from '@fizz/schemas';
import {
  addDays,
  addMonths,
  buildProgressHomeView,
  countSessions,
  customProgressWindow,
  muscleFrequency,
  normaliseProgressRange,
  presetProgressRange,
  progressWindow,
  PROGRESS_MAX_PERIOD_DAYS,
  rangeText,
  rangeWords,
  activityGranularity,
  countAxisTicks,
  customRangeFromMonths,
  defaultCustomMonths,
  periodProgressWindow,
  pickerMonths,
  progressWindowAt,
  WEEKLY_POINTS_MAX_DAYS,
  timeInGym,
  toProgressSession,
  type MuscleInfo,
  type ProgressSession,
} from '../src/index';
import { toIso } from '../src/time';
import { at } from './fixtures';
import { apply, startFixture } from './session-fixture';

/**
 * Progress windows on real-looking history (Ben, 12 Oct 2026: "something is
 * wrong with the 30 day and 60 day overviews", and "flexibility to select
 * time period"): two years of imported FitNotes workouts (dates only, no
 * times) plus recent logged ones, Europe/London, windows ending on every day
 * of 2026 so far; part weeks at both ends; and the custom period.
 */

const MIN = 60_000;
let n = 0;

function session(date: string, imported: boolean, exerciseId = 'bench'): ProgressSession {
  // 18:30 BST / GMT is 17:30 / 18:30 UTC: the local date is the same either way.
  const startedMs = Date.parse(`${date}T17:30:00.000Z`);
  n += 1;
  return {
    sessionId: `s${String(n)}`,
    version: 1,
    source: imported ? 'import' : 'manual',
    name: imported ? null : 'Push A',
    gymId: imported ? null : 'gym-1',
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'Europe/London',
    date,
    dateOnly: imported,
    endedAtUtc: imported ? null : new Date(startedMs + 62 * MIN).toISOString(),
    durationMs: imported ? null : 62 * MIN,
    durationConfirmed: false,
    exercises: [
      {
        sessionExerciseId: `r${String(n)}`,
        exerciseId,
        exerciseName: exerciseId,
        equipmentId: imported ? null : 'bar-1',
        equipmentKind: imported ? null : 'barbell',
        gymId: null,
        convention: 'total',
        unit: 'kg',
        measurement: 'reps',
        laterality: 'bilateral',
        sets: [1, 2, 3].map((i) => ({ setId: `x${String(n)}-${String(i)}`, setType: 'working' as const, side: null, load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: i })),
      },
    ],
  };
}

const INFO = new Map<string, MuscleInfo>([
  ['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }],
  ['squat', { name: 'Back squat', movementPattern: 'squat', primaryMuscles: ['quads', 'glutes'] }],
]);

/** FitNotes Mon/Wed/Fri from 6 Jan 2025 to 30 Sep 2026 (imported), then the app from 2 Oct 2026 (logged). */
function history(): ProgressSession[] {
  const out: ProgressSession[] = [];
  for (let d = '2025-01-06', i = 0; d <= '2026-09-30'; d = addDays(d, 1), i += 1) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 1 || wd === 3 || wd === 5) out.push(session(d, true, i % 2 === 0 ? 'bench' : 'squat'));
  }
  for (const d of ['2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12']) out.push(session(d, false));
  return out;
}

const HISTORY = history();
const inside = (from: string, to: string) => HISTORY.filter((s) => s.date >= from && s.date <= to);

describe('presets on two years of imported + logged history (every day of 2026 as today)', () => {
  it('sessions, previous, bars, time and muscle sessions all agree with a direct count', () => {
    for (let today = '2026-01-01'; today <= '2026-10-12'; today = addDays(today, 1)) {
      for (const key of ['1m', '3m', '6m', '1y'] as const) {
        const w = periodProgressWindow(today, key);
        const c = countSessions(HISTORY, w);
        const expected = inside(w.from, w.to);
        expect(c.count).toBe(expected.length);
        expect(c.previousCount).toBe(inside(w.previous.from, w.previous.to).length);
        expect([...(c.weeks ?? []), ...(c.months ?? [])].reduce((a, b) => a + b.count, 0)).toBe(expected.length);
        const t = timeInGym(HISTORY, w);
        expect(t.timedCount).toBe(expected.filter((s) => !s.dateOnly).length);
        expect(t.excluded.imported).toBe(expected.filter((s) => s.dateOnly).length);
        expect(t.totalMs).toBe(t.timedCount * 62 * MIN);
        const chest = muscleFrequency(HISTORY, INFO, w, 'body_part').rows.find((r) => r.key === 'Chest');
        expect(chest?.sessions).toBe(expected.filter((s) => s.exercises[0]?.exerciseId === 'bench').length);
      }
    }
  });
});

describe('part weeks at either end of 1 month and 60 days (today, Monday 12 Oct 2026)', () => {
  const today = '2026-10-12';

  it('1 month starts on a Sunday and ends on today’s Monday: both end points are one day, marked partial, and say so', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today, period: '1m', grouping: 'body_part' });
    if (home.dataState !== 'normal' || home.activity.chart.unit !== 'week') throw new Error('expected weekly points');
    const bars = home.activity.chart.points;
    expect(bars.map((b) => [b.label, b.count, b.partial])).toEqual([
      ['13 Sep', 0, true],
      ['14 Sep', 3, false],
      ['21 Sep', 3, false],
      ['28 Sep', 3, false],
      ['5 Oct', 3, false],
      ['12 Oct', 1, true],
    ]);
    expect(bars[0]?.listText).toBe('13 Sep only · 0');
    expect(bars[1]?.listText).toBe('Week from 14 Sep · 3');
    expect(bars[1]?.valueText).toBe('14–20\u00a0Sep · 3 sessions');
    expect(bars[0]?.valueText).toBe('13\u00a0Sep · 0 sessions');
    expect(home.activity.chart.words).toBe(
      'Sessions per week: 13 September only, 0; week from 14 September, 3; week from 21 September, 3; week from 28 September, 3; week from 5 October, 3; 12 October only, 1.',
    );
  });

  it('60 days starts on a Friday: the first point is Fri–Sun, worded as those dates, not as a week', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today, period: '1m', grouping: 'body_part', range: { from: '2026-08-14', to: today } });
    if (home.dataState !== 'normal' || home.activity.chart.unit !== 'week') throw new Error('expected weekly points');
    const first = home.activity.chart.points[0];
    expect(first).toMatchObject({ from: '2026-08-14', count: 1, partial: true, listText: '14–16 Aug · 1' });
    expect(home.activity.chart.words.startsWith('Sessions per week: 14 to 16 August, 1; week from 17 August, 3;')).toBe(true);
  });
});

describe('custom period', () => {
  it('a window from–to inclusive, the previous one the same length just before it', () => {
    const w = customProgressWindow({ from: '2026-08-01', to: '2026-08-31' });
    expect(w).toEqual({ days: 31, preset: null, from: '2026-08-01', to: '2026-08-31', previous: { from: '2026-07-01', to: '2026-07-31' } });
    expect(periodProgressWindow('2026-10-12', '1m')).toMatchObject({ preset: '1m', days: 30, from: '2026-09-13', previous: { from: '2026-08-14', to: '2026-09-12' } });
  });

  it('normalise: never past today, from ≤ to, at most ~3 years, bad dates refused', () => {
    expect(normaliseProgressRange({ from: '2026-09-01', to: '2026-12-01' }, '2026-10-12')).toEqual({ from: '2026-09-01', to: '2026-10-12' });
    expect(normaliseProgressRange({ from: '2026-10-20', to: '2026-10-01' }, '2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-12' });
    expect(normaliseProgressRange({ from: '2026-10-10', to: '2026-10-02' }, '2026-10-12')).toEqual({ from: '2026-10-02', to: '2026-10-10' });
    // Both after today: today only.
    expect(normaliseProgressRange({ from: '2026-12-01', to: '2026-11-01' }, '2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-12' });
    const long = normaliseProgressRange({ from: '2015-01-01', to: '2026-10-12' }, '2026-10-12');
    expect(long?.to).toBe('2026-10-12');
    expect(long?.from).toBe(addDays('2026-10-12', -(PROGRESS_MAX_PERIOD_DAYS - 1)));
    expect(normaliseProgressRange({ from: '2026-02-30', to: '2026-03-01' }, '2026-10-12')).toBeNull();
    expect(normaliseProgressRange({ from: 'yesterday', to: '2026-03-01' }, '2026-10-12')).toBeNull();
  });

  it('presets end today: 1 month, 3 months, 6 months, 1 year (as exercise detail’s ranges)', () => {
    expect(presetProgressRange('2026-10-13', '1m')).toEqual({ from: '2026-09-14', to: '2026-10-13' });
    expect(presetProgressRange('2026-03-31', '1m')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(presetProgressRange('2026-10-12', '3m')).toEqual({ from: '2026-07-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-10-12', '6m')).toEqual({ from: '2026-04-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-10-12', '1y')).toEqual({ from: '2025-10-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-03-31', '3m')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('Custom defaults: Start 18 months ago, End this month (so it ends today); picked months span whole months, never past today', () => {
    expect(defaultCustomMonths('2026-10-13')).toEqual({ start: '2025-04', end: '2026-10' });
    expect(defaultCustomMonths('2026-08-31')).toEqual({ start: '2025-02', end: '2026-08' });
    const d = defaultCustomMonths('2026-10-13');
    expect(customRangeFromMonths(d.start, d.end, '2026-10-13')).toEqual({ from: '2025-04-01', to: '2026-10-13' });
    expect(customRangeFromMonths('2026-02', '2026-02', '2026-10-13')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // Reversed months are swapped.
    expect(customRangeFromMonths('2026-06', '2026-03', '2026-10-13')).toEqual({ from: '2026-03-01', to: '2026-06-30' });
    // The longest period still applies: the start moves, the end stays.
    expect(customRangeFromMonths('2015-01', '2026-10', '2026-10-13')?.from).toBe(addDays('2026-10-13', -(PROGRESS_MAX_PERIOD_DAYS - 1)));
  });

  it('the month lists run from the first workout’s month (at most ~3 years back) to this month', () => {
    expect(pickerMonths('2026-07-20', '2026-10-13')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    const long = pickerMonths('2010-01-01', '2026-10-13');
    expect(long[0]).toBe('2023-10');
    expect(long.at(-1)).toBe('2026-10');
    expect(pickerMonths('2026-10-13', '2026-10-13')).toEqual(['2026-10']);
  });

  it('granularity: up to 6 months weekly, 1 year and longer custom monthly', () => {
    expect(activityGranularity(30)).toBe('week');
    expect(activityGranularity(WEEKLY_POINTS_MAX_DAYS)).toBe('week');
    expect(activityGranularity(WEEKLY_POINTS_MAX_DAYS + 1)).toBe('month');
    expect(activityGranularity(365)).toBe('month');
    const quarter = countSessions(HISTORY, periodProgressWindow('2026-10-12', '3m'));
    expect(quarter.months).toBeNull();
    expect(quarter.weeks?.length).toBe(14);
    expect(quarter.weeks?.reduce((a, w) => a + w.count, 0)).toBe(quarter.count);
    const half = countSessions(HISTORY, periodProgressWindow('2026-10-12', '6m'));
    expect(half.months).toBeNull();
    expect(half.weeks?.reduce((a, w) => a + w.count, 0)).toBe(half.count);
    const seven = countSessions(HISTORY, customProgressWindow({ from: '2026-03-01', to: '2026-09-30' }));
    expect(seven.weeks).toBeNull();
    expect(seven.months?.length).toBe(7);
    const year = countSessions(HISTORY, periodProgressWindow('2026-10-12', '1y'));
    expect(year.weeks).toBeNull();
    expect(year.months?.length).toBe(13);
    expect(year.months?.[0]).toMatchObject({ from: '2025-10-13', to: '2025-10-31', partial: true });
    expect(year.months?.[1]).toMatchObject({ from: '2025-11-01', to: '2025-11-30', partial: false });
    expect(year.months?.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-12', partial: true });
    expect(year.months?.reduce((a, m) => a + m.count, 0)).toBe(year.count);
    expect(year.count).toBe(inside('2025-10-13', '2026-10-12').length);
    expect(year.perWeek).not.toBeNull();
    const custom18 = countSessions(HISTORY, customProgressWindow({ from: '2025-04-01', to: '2026-10-13' }));
    expect(custom18.months?.length).toBe(19);
  });

  it('line points: one per week or month, labelled, valued for the tap, with a few whole-number Y gridlines from 0', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', period: '1y', grouping: 'body_part' });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    const { chart } = home.activity;
    expect(chart.unit).toBe('month');
    expect(chart.points).toHaveLength(13);
    expect(chart.points[1]).toMatchObject({ label: 'Nov 25', partial: false });
    expect(chart.points[1]?.valueText.endsWith(' sessions')).toBe(true);
    expect(chart.points[1]?.valueText.startsWith('Nov\u00a02025 · ')).toBe(true);
    expect(chart.points[0]?.valueText.startsWith('13–31\u00a0Oct\u00a02025 · ')).toBe(true);
    expect(chart.yTicks[0]).toBe(0);
    expect(chart.yTicks.at(-1)).toBeGreaterThanOrEqual(Math.max(...chart.points.map((p) => p.count)));
    expect(chart.yTicks.length).toBeLessThanOrEqual(5);
    expect(home.windowLabel).toBe('1 year');
    expect(home.activity.comparison.startsWith('Previous year: ')).toBe(true);
    const six = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', period: '6m', grouping: 'body_part' });
    expect(six.dataState === 'normal' && six.activity.chart.unit).toBe('week');
    expect(six.dataState === 'normal' && six.activity.comparison.startsWith('Previous 6 months: ')).toBe(true);
  });

  it('Y gridlines: 0 to at least 3, at most four steps of 1, 2, 5 or 10', () => {
    expect(countAxisTicks(0)).toEqual([0, 1, 2, 3]);
    expect(countAxisTicks(3)).toEqual([0, 1, 2, 3]);
    expect(countAxisTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(countAxisTicks(5)).toEqual([0, 2, 4, 6]);
    expect(countAxisTicks(9)).toEqual([0, 5, 10]);
    expect(countAxisTicks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(countAxisTicks(23)).toEqual([0, 10, 20, 30]);
  });

  it('presets and the previous period are in Ben’s timezone, ending today there', () => {
    const late = Date.parse('2026-10-12T23:30:00.000Z');
    expect(progressWindowAt(late, 'Europe/London', '1m')).toMatchObject({ from: '2026-09-14', to: '2026-10-13', previous: { from: '2026-08-15', to: '2026-09-13' } });
    expect(progressWindowAt(late, 'America/Los_Angeles', '1m')).toMatchObject({ from: '2026-09-13', to: '2026-10-12' });
    expect(progressWindowAt(late, 'Europe/London', '3m')).toMatchObject({ from: '2026-07-14', to: '2026-10-13', days: 92 });
    expect(progressWindowAt(late, 'Europe/London', '6m')).toMatchObject({ from: '2026-04-14', to: '2026-10-13', days: 183 });
    const y = progressWindowAt(late, 'Europe/London', '1y');
    expect(y).toMatchObject({ from: '2025-10-14', to: '2026-10-13', days: 365, previous: { from: '2024-10-14', to: '2025-10-13' } });
  });

  it('the home on a past period names its dates (never "last") and labels months with the year when it crosses one', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', period: '1m', grouping: 'body_part', range: { from: '2025-11-01', to: '2026-04-30' }, bests: { tracked: new Set(), claims: [] } });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.window).toMatchObject({ preset: null, from: '2025-11-01', to: '2026-04-30', days: 181 });
    expect(home.datesLine).toBe('1\u00a0Nov\u00a02025 – 30\u00a0Apr\u00a02026');
    expect(home.datesWords).toBe('1 November 2025 to 30 April 2026');
    expect(home.activity.comparison.startsWith('Previous 181 days: ')).toBe(true);
    expect(home.activity.sheet.countLine).toBe('1\u00a0Nov\u00a02025 – 30\u00a0Apr\u00a02026: 0 of 77 sessions');
    expect(home.records.empty).toBe('No new records, 1\u00a0Nov\u00a02025 – 30\u00a0Apr\u00a02026.');

    const yearly = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', period: '1m', grouping: 'body_part', range: presetProgressRange('2026-10-12', '1y') });
    if (yearly.dataState !== 'normal' || yearly.activity.chart.unit !== 'month') throw new Error('expected monthly points');
    expect(yearly.activity.chart.points.map((b) => b.label).slice(0, 3)).toEqual(['Oct 25', 'Nov 25', 'Dec 25']);
    expect(yearly.activity.chart.words.startsWith('Sessions per month: 13 to 31 October 2025, ')).toBe(true);
  });
});

describe('a period’s dates carry the year when they need it (review ben-bugs B1)', () => {
  const today = '2026-10-12';
  const home = (range: { from: string; to: string }) => {
    const v = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today, period: '1m', grouping: 'body_part', range });
    if (v.dataState !== 'normal') throw new Error('expected normal');
    return v;
  };

  it('1 year: both ends name their year, never `13 Oct – 12 Oct`', () => {
    const v = home(presetProgressRange(today, '1y'));
    expect(v.datesLine).toBe('13\u00a0Oct\u00a02025 – 12\u00a0Oct\u00a02026');
    expect(v.datesWords).toBe('13 October 2025 to 12 October 2026');
  });

  it('a month from last year names the year, so it never reads as this September', () => {
    const last = home({ from: '2025-09-01', to: '2025-09-30' });
    const now = home({ from: '2026-09-01', to: '2026-09-30' });
    expect(last.datesLine).toBe('1\u00a0Sep – 30\u00a0Sep\u00a02025');
    expect(last.datesWords).toBe('1 September to 30 September 2025');
    expect(last.activity.sheet.countLine.startsWith('1\u00a0Sep – 30\u00a0Sep\u00a02025: ')).toBe(true);
    expect(now.datesLine).toBe('1\u00a0Sep – 30\u00a0Sep');
    expect(now.datesLine).not.toBe(last.datesLine);
  });

  it('a range over New Year names both years', () => {
    expect(rangeText({ from: '2025-12-29', to: '2026-01-04' }, today)).toBe('29\u00a0Dec\u00a02025 – 4\u00a0Jan\u00a02026');
    // Early January's presets name both years; at large text sizes the line can only wrap at the dash,
    // never inside a date (review ben-bugs r2 N3).
    const jan = rangeText(progressWindow('2027-01-05', 30), '2027-01-05');
    expect(jan).toBe('7\u00a0Dec\u00a02026 – 5\u00a0Jan\u00a02027');
    expect(jan.split(' ')).toEqual(['7\u00a0Dec\u00a02026', '–', '5\u00a0Jan\u00a02027']);
    expect(rangeWords({ from: '2025-12-29', to: '2026-01-04' }, today)).toBe('29 December 2025 to 4 January 2026');
  });

  it('this year’s presets ending today keep the short form; with no known today the year is always named', () => {
    expect(rangeText(presetProgressRange(today, '3m'), today)).toBe('13\u00a0Jul – 12\u00a0Oct');
    expect(rangeText(progressWindow(today, 30), today)).toBe('13\u00a0Sep – 12\u00a0Oct');
    expect(rangeText({ from: '2026-09-01', to: '2026-09-30' }, '')).toBe('1\u00a0Sep – 30\u00a0Sep\u00a02026');
  });
});

describe('each preset keeps one point unit whatever today’s date (review ben-bugs S1)', () => {
  it('1, 3 and 6 months are always weekly; 1 year always monthly, every day of 2025–2026', () => {
    for (let today = '2025-01-01'; today <= '2026-12-31'; today = addDays(today, 1)) {
      for (const key of ['1m', '3m', '6m'] as const) {
        const c = countSessions([], periodProgressWindow(today, key));
        expect(c.weeks !== null && c.months === null, `${key} on ${today}`).toBe(true);
      }
      const y = countSessions([], periodProgressWindow(today, '1y'));
      expect(y.months !== null && y.weeks === null, `1y on ${today}`).toBe(true);
    }
  });
});

/**
 * The reviewer's hand count (review ben-bugs, S4), through the owner-zone
 * projection: logged workouts near midnight in BST and GMT, imported ones on
 * the same local dates. Europe/London; today Mon 2 Nov 2026 (BST ended 25 Oct).
 */
describe('30 and 60 days across the DST end, through toProgressSession', () => {
  const OWNER_TZ = 'Europe/London';
  let k = 0;
  function base(): SessionAggregate {
    const s = startFixture().state;
    return apply(s, { type: 'finish', at: at(60 * 60), opId: 'f', expectedVersion: s.session.version, endedAt: null });
  }
  function logged(utc: string): SessionAggregate {
    const agg = base();
    k += 1;
    const end = toIso(Date.parse(utc) + 60 * MIN);
    return { ...agg, session: { ...agg.session, id: `logged-${String(k)}`, startedAt: { utc, tz: OWNER_TZ }, endedAt: { utc: end, tz: OWNER_TZ } } };
  }
  function imported(localDate: string): SessionAggregate {
    const agg = base();
    k += 1;
    return { ...agg, session: { ...agg.session, id: `imported-${String(k)}`, source: 'import' as const, localDate, startedAt: { utc: `${localDate}T12:00:00.000Z`, tz: OWNER_TZ } } };
  }
  const NOW = Date.parse('2026-11-02T12:00:00.000Z');
  const stored = [
    logged('2026-10-25T23:30:00.000Z'), // A: Sun 25 Oct (GMT)
    logged('2026-10-04T23:30:00.000Z'), // B: Mon 5 Oct 00:30 BST
    logged('2026-10-03T22:30:00.000Z'), // C: Sat 3 Oct 23:30 BST
    imported('2026-10-04'), // D
    imported('2026-09-02'), // E
    logged('2026-09-03T23:15:00.000Z'), // F: Fri 4 Sep 00:15 BST
    imported('2026-08-31'), // G
    logged('2026-11-01T23:59:00.000Z'), // H: Sun 1 Nov (GMT)
    logged('2026-11-02T00:30:00.000Z'), // I: Mon 2 Nov, today
  ];
  const sessions = stored.map((a) => toProgressSession(a, OWNER_TZ, NOW)).filter((x): x is ProgressSession => x !== null);
  const today = '2026-11-02';

  it('the local dates are the owner zone’s, not UTC’s', () => {
    expect(sessions.map((x) => x.date)).toEqual(['2026-10-25', '2026-10-05', '2026-10-03', '2026-10-04', '2026-09-02', '2026-09-04', '2026-08-31', '2026-11-01', '2026-11-02']);
  });

  it('30 days: 5 sessions, previous 2, part weeks at both ends, 4 of 5 timed', () => {
    const w = progressWindow(today, 30);
    expect([w.from, w.to]).toEqual(['2026-10-04', '2026-11-02']);
    const c = countSessions(sessions, w);
    expect([c.count, c.previousCount, c.perWeek]).toEqual([5, 2, 1.2]);
    expect(c.weeks?.map((b) => [b.from, b.count, b.partial])).toEqual([
      ['2026-10-04', 1, true],
      ['2026-10-05', 1, false],
      ['2026-10-12', 0, false],
      ['2026-10-19', 1, false],
      ['2026-10-26', 1, false],
      ['2026-11-02', 1, true],
    ]);
    expect(timeInGym(sessions, w).timedCount).toBe(4);
  });

  it('60 days: 7 sessions, previous 2, a Fri–Sun first bar, 6 of 7 timed', () => {
    const w = progressWindow(today, 60);
    const c = countSessions(sessions, w);
    expect([c.count, c.previousCount, c.perWeek]).toEqual([7, 2, 0.8]);
    expect(c.weeks?.map((b) => b.count)).toEqual([1, 0, 0, 0, 2, 1, 0, 1, 1, 1]);
    expect(c.weeks?.[0]).toMatchObject({ from: '2026-09-04', to: '2026-09-06', partial: true });
    expect(timeInGym(sessions, w).timedCount).toBe(6);
  });
});
