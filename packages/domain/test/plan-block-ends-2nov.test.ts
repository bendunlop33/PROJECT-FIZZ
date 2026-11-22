import { describe, expect, it } from 'vitest';

import { pbBlockEndsOn, pbBlockWeekOf } from '../src/index';

/** (Ben, 2 Nov; plan-summary.md) The plan summary's `ends Sun 6 Dec`: the block's last Sunday if every week is trained. */

const TZ = 'Europe/London';
const six = { weeks: 6 as const, effort: 'standard' as const };
const w = (iso: string) => ({ startedAtUtc: iso, dayIndex: 0 });

describe('pbBlockEndsOn', () => {
  it('week 3 of 6 (Monday 16 Nov): weeks 3–6 run to Sun 13 Dec', () => {
    const b = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-11-02T07:00:00.000Z', workouts: [w('2026-11-03T08:00:00Z'), w('2026-11-10T08:00:00Z')], nowMs: Date.parse('2026-11-17T08:00:00Z'), tz: TZ });
    expect(b.week).toBe(3);
    expect(pbBlockEndsOn(b)).toBe('2026-12-13');
  });

  it('an untrained week holds the number, so the end moves a week later', () => {
    const b = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-11-02T07:00:00.000Z', workouts: [w('2026-11-03T08:00:00Z'), w('2026-11-17T08:00:00Z')], nowMs: Date.parse('2026-11-24T08:00:00Z'), tz: TZ });
    expect(b.week).toBe(3);
    expect(pbBlockEndsOn(b)).toBe('2026-12-20');
  });

  it('the lead-in: week 1 starts next Monday, so a 6-week block ends 6 weeks after it', () => {
    const b = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-11-04T07:00:00.000Z', workouts: [], nowMs: Date.parse('2026-11-05T08:00:00Z'), tz: TZ });
    expect(b.leadIn?.startsOn).toBe('2026-11-09');
    expect(pbBlockEndsOn(b)).toBe('2026-12-20');
  });

  it('done: the last counted week’s Sunday; no weeks: null', () => {
    expect(pbBlockEndsOn({ week: 3, of: 2, done: true, mondays: ['2026-11-02', '2026-11-09'] })).toBe('2026-11-15');
    expect(pbBlockEndsOn({ week: 1, of: 6, done: false, mondays: [] })).toBeNull();
    expect(pbBlockEndsOn({ week: 1, of: 0, done: false, mondays: ['2026-11-02'] })).toBeNull();
  });
});
