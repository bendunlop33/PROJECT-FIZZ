import { describe, expect, it } from 'vitest';
import { buildWeekTiles, planDayColourKey, todayDayRows, todayRestDay, TODAY_PICK_COPY } from '../src/index';

// Tue 27 Oct 2026; the week is Mon 26 – Sun 1 Nov.
const today = '2026-10-27';

describe('Today’s week tiles (redesign v3 option B, Ben 27 Oct)', () => {
  const tiles = buildWeekTiles({
    today,
    workouts: [
      { sessionId: 's1', localDate: '2026-10-26', title: 'Pull' },
      { sessionId: 'old', localDate: '2026-10-24', title: 'Legs' },
    ],
    activities: [
      { activityId: 'a1', localDate: '2026-10-26', kind: 'run', status: 'done', distanceM: 5000, durationS: 1800, effort: null },
      { activityId: 'a2', localDate: '2026-10-31', kind: 'run', status: 'planned', distanceM: 12_000, durationS: null, effort: null },
    ],
    plannedDays: [
      { localDate: '2026-10-29', name: 'Legs' },
      { localDate: '2026-10-26', name: 'Push' },
    ],
    chosen: 'Push',
  });
  it('seven tiles Mon–Sun of this week, letters and dates', () => {
    expect(tiles.map((t) => t.letter).join('')).toBe('MTWTFSS');
    expect(tiles.map((t) => t.dayOfMonth)).toEqual([26, 27, 28, 29, 30, 31, 1]);
    expect(tiles[1]?.today).toBe(true);
    expect(tiles[0]?.past).toBe(true);
  });
  it('done day: green, a dot in the plan day colour and a hollow ring per activity', () => {
    expect(tiles[0]?.state).toBe('done');
    expect(tiles[0]?.marks).toEqual([
      { shape: 'dot', colour: 'pull', planned: false },
      { shape: 'ring', colour: 'activity', planned: false },
    ]);
    expect(tiles[0]?.accessibilityLabel).toBe('Monday 26: Pull, done. Run, 5 kilometres');
    // A planned day in the past isn't shown (never inferred).
    expect(tiles[0]?.items.some((i) => i.kind === 'plan_day')).toBe(false);
  });
  it('today’s chosen workout and planned days: outlined, empty ring in the session colour', () => {
    expect(tiles[1]).toMatchObject({ state: 'planned', marks: [{ shape: 'ring', colour: 'push', planned: true }] });
    expect(tiles[1]?.accessibilityLabel).toBe('Today, Tuesday 27: Push, today’s workout'.replace('’', "'"));
    expect(tiles[3]).toMatchObject({ state: 'planned', marks: [{ shape: 'ring', colour: 'legs', planned: true }] });
    expect(tiles[5]).toMatchObject({ state: 'planned', marks: [{ shape: 'ring', colour: 'activity', planned: true }] });
    expect(tiles[2]).toMatchObject({ state: 'plain', marks: [], accessibilityLabel: 'Wednesday 28' });
  });
  it('done today: no planned ring for the pick', () => {
    const t = buildWeekTiles({ today, workouts: [{ sessionId: 's2', localDate: today, title: 'Push' }], activities: [], chosen: 'Push' });
    expect(t[1]?.marks).toEqual([{ shape: 'dot', colour: 'push', planned: false }]);
    expect(t[1]?.state).toBe('done');
  });
  it('plan day colours by name; non-plan workouts neutral', () => {
    expect(['Push', 'Push A', 'Chest', 'Pull B', 'Back', 'Legs', 'Upper', 'Lower', 'Full body', 'Workout', 'Arms'].map(planDayColourKey)).toEqual(['push', 'push', 'push', 'pull', 'pull', 'legs', 'upper', 'lower', 'full', 'neutral', 'neutral']);
  });
});

describe('Today’s workout sheet and rest day (option C)', () => {
  const days = [
    { key: 'push', name: 'Push' },
    { key: 'pull', name: 'Pull' },
    { key: 'legs', name: 'Legs' },
  ];
  it('rows: Up next, Done Mon, Thu', () => {
    const rows = todayDayRows({ days, nextKey: 'push', selectedKey: 'push', today, doneOn: { pull: '2026-10-26' }, plannedOn: { legs: '2026-10-29' } });
    expect(rows.map((r) => [r.name, r.status, r.selected])).toEqual([
      ['Push', 'Up next', true],
      ['Pull', 'Done Mon', false],
      ['Legs', 'Thu', false],
    ]);
    expect(rows[0]?.accessibilityLabel).toBe('Push, Up next, selected');
    expect(todayDayRows({ days, nextKey: null, selectedKey: null, today, doneOn: { push: today }, plannedOn: {} })[0]?.status).toBe('Done today');
  });
  it('a rest day only on Set days with nothing due today or before; Next is the earliest later day', () => {
    const r = todayRestDay({ setDays: true, doneToday: false, today, days, plannedOn: { legs: '2026-10-29', push: '2026-10-31' } });
    expect(r).toEqual({ nextKey: 'legs', text: 'Legs · Thu', accessibilityLabel: 'Rest day. Next, Legs, Thursday' });
    expect(todayRestDay({ setDays: true, doneToday: false, today, days, plannedOn: { push: today } })).toBeNull();
    // A day missed earlier this week is still due: not a rest day.
    expect(todayRestDay({ setDays: true, doneToday: false, today, days, plannedOn: { push: '2026-10-26', legs: '2026-10-29' } })).toBeNull();
    expect(todayRestDay({ setDays: false, doneToday: false, today, days, plannedOn: { legs: '2026-10-29' } })).toBeNull();
    expect(todayRestDay({ setDays: true, doneToday: true, today, days, plannedOn: { legs: '2026-10-29' } })).toBeNull();
  });
  it('plan week label', () => {
    expect(TODAY_PICK_COPY.planWeek('Week 3 of 6')).toBe('Plan week 3 of 6');
    expect(TODAY_PICK_COPY.planWeek('Week 6 of 6 · Deload')).toBe('Plan week 6 of 6 · Deload');
  });
});
