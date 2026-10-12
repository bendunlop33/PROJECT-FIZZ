import { describe, expect, it } from 'vitest';

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
  stepPeriodDate,
  timeInGym,
  type MuscleInfo,
  type ProgressSession,
} from '../src/index';

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
      for (const days of [7, 14, 30, 60] as const) {
        const w = progressWindow(today, days);
        const c = countSessions(HISTORY, w);
        const expected = inside(w.from, w.to);
        expect(c.count).toBe(expected.length);
        expect(c.previousCount).toBe(inside(w.previous.from, w.previous.to).length);
        expect([...(c.days ?? []), ...(c.weeks ?? []), ...(c.months ?? [])].reduce((a, b) => a + b.count, 0)).toBe(expected.length);
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

describe('part weeks at either end of 30 and 60 days (today, Monday 12 Oct 2026)', () => {
  const today = '2026-10-12';

  it('30 days starts on a Sunday and ends on today’s Monday: both end bars are one day, marked partial, and say so', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today, days: 30, grouping: 'body_part' });
    if (home.dataState !== 'normal' || home.activity.bars.kind !== 'weeks') throw new Error('expected week bars');
    const bars = home.activity.bars.bars;
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
    expect(home.activity.bars.words).toBe(
      'Sessions per week: 13 September only, 0; week from 14 September, 3; week from 21 September, 3; week from 28 September, 3; week from 5 October, 3; 12 October only, 1.',
    );
  });

  it('60 days starts on a Friday: the first bar is Fri–Sun, worded as those dates, not as a week', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today, days: 60, grouping: 'body_part' });
    if (home.dataState !== 'normal' || home.activity.bars.kind !== 'weeks') throw new Error('expected week bars');
    const first = home.activity.bars.bars[0];
    expect(first).toMatchObject({ from: '2026-08-14', count: 1, partial: true, listText: '14–16 Aug · 1' });
    expect(home.activity.bars.words.startsWith('Sessions per week: 14 to 16 August, 1; week from 17 August, 3;')).toBe(true);
  });
});

describe('custom period', () => {
  it('a window from–to inclusive, the previous one the same length just before it', () => {
    const w = customProgressWindow({ from: '2026-08-01', to: '2026-08-31' });
    expect(w).toEqual({ days: 31, preset: null, from: '2026-08-01', to: '2026-08-31', previous: { from: '2026-07-01', to: '2026-07-31' } });
    expect(progressWindow('2026-10-12', 30).preset).toBe(30);
  });

  it('normalise: never past today, from ≤ to, at most ~3 years, bad dates refused', () => {
    expect(normaliseProgressRange({ from: '2026-09-01', to: '2026-12-01' }, '2026-10-12')).toEqual({ from: '2026-09-01', to: '2026-10-12' });
    expect(normaliseProgressRange({ from: '2026-10-20', to: '2026-10-01' }, '2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    const long = normaliseProgressRange({ from: '2015-01-01', to: '2026-10-12' }, '2026-10-12');
    expect(long?.to).toBe('2026-10-12');
    expect(long?.from).toBe(addDays('2026-10-12', -(PROGRESS_MAX_PERIOD_DAYS - 1)));
    expect(normaliseProgressRange({ from: '2026-02-30', to: '2026-03-01' }, '2026-10-12')).toBeNull();
    expect(normaliseProgressRange({ from: 'yesterday', to: '2026-03-01' }, '2026-10-12')).toBeNull();
  });

  it('presets end today: 3 months, 6 months, 1 year (as exercise detail’s ranges)', () => {
    expect(presetProgressRange('2026-10-12', '3m')).toEqual({ from: '2026-07-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-10-12', '6m')).toEqual({ from: '2026-04-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-10-12', '1y')).toEqual({ from: '2025-10-13', to: '2026-10-12' });
    expect(presetProgressRange('2026-03-31', '3m')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('the date steppers move a week or a month and stay inside the bounds', () => {
    const bounds = { from: '2025-01-06', to: '2026-10-12' };
    expect(stepPeriodDate('2026-10-12', { unit: 'week', by: -1 }, bounds)).toBe('2026-10-05');
    expect(stepPeriodDate('2026-10-12', { unit: 'month', by: -1 }, bounds)).toBe('2026-09-12');
    expect(stepPeriodDate('2026-10-12', { unit: 'week', by: 1 }, bounds)).toBe('2026-10-12');
    expect(stepPeriodDate('2025-01-20', { unit: 'month', by: -1 }, bounds)).toBe('2025-01-06');
  });

  it('up to 26 weeks: week bars; longer: one bar per month, partial months marked, bars still add up', () => {
    const quarter = countSessions(HISTORY, customProgressWindow(presetProgressRange('2026-10-12', '3m')));
    expect(quarter.weeks?.length).toBe(14);
    expect(quarter.months).toBeNull();
    const half = countSessions(HISTORY, customProgressWindow(presetProgressRange('2026-10-12', '6m')));
    expect(half.weeks).toBeNull();
    expect(half.months?.length).toBe(7);
    const year = countSessions(HISTORY, customProgressWindow(presetProgressRange('2026-10-12', '1y')));
    expect(year.weeks).toBeNull();
    expect(year.months?.length).toBe(13);
    expect(year.months?.[0]).toMatchObject({ from: '2025-10-13', to: '2025-10-31', partial: true });
    expect(year.months?.[1]).toMatchObject({ from: '2025-11-01', to: '2025-11-30', partial: false });
    expect(year.months?.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-12', partial: true });
    expect(year.months?.reduce((a, m) => a + m.count, 0)).toBe(year.count);
    expect(year.count).toBe(inside('2025-10-13', '2026-10-12').length);
    expect(year.perWeek).not.toBeNull();
  });

  it('the home on a past period names its dates (never "last"), labels months with the year when it crosses one, and bolds no day', () => {
    const home = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', days: 30, grouping: 'body_part', range: { from: '2025-11-01', to: '2026-04-30' } });
    if (home.dataState !== 'normal') throw new Error('expected normal');
    expect(home.window).toMatchObject({ preset: null, from: '2025-11-01', to: '2026-04-30', days: 181 });
    expect(home.datesLine).toBe('1 Nov – 30 Apr');
    expect(home.activity.comparison.startsWith('Previous 181 days: ')).toBe(true);
    expect(home.activity.sheet.countLine).toBe('1 Nov – 30 Apr: 0 of 77 sessions');
    expect(home.records.empty).toBe('No new records, 1 Nov – 30 Apr.');

    const yearly = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', days: 30, grouping: 'body_part', range: presetProgressRange('2026-10-12', '1y') });
    if (yearly.dataState !== 'normal' || yearly.activity.bars.kind !== 'months') throw new Error('expected month bars');
    expect(yearly.activity.bars.bars.map((b) => b.label).slice(0, 3)).toEqual(['Oct 25', 'Nov 25', 'Dec 25']);
    expect(yearly.activity.bars.words.startsWith('Sessions per month: 13 to 31 October 2025, ')).toBe(true);

    const short = buildProgressHomeView({ sessions: HISTORY, exercises: INFO, today: '2026-10-12', days: 30, grouping: 'body_part', range: { from: '2026-09-01', to: '2026-09-10' } });
    if (short.dataState !== 'normal' || short.activity.bars.kind !== 'days') throw new Error('expected day cells');
    expect(short.activity.bars.rows.flatMap((r) => r.cells).some((c) => c.isToday)).toBe(false);
    expect(short.activity.bars.words.startsWith('1 September to 10 September: ')).toBe(true);
  });
});
